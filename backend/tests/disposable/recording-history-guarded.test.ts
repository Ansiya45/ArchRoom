import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { client } from '../../src/db/index.js';
import { recordingDriveRootId } from '../../src/config/recordingDrive.js';
import { CompanyRecordingJobsService } from '../../src/services/company-recording-jobs.service.js';
import { LocalRecordingIngestion } from '../../src/services/local-recording-ingestion.service.js';
import { CompanyRecordingDriveIntentService } from '../../src/services/company-recording-drive-intent.service.js';
import { CompanyRecordingTransferWorker } from '../../src/services/company-recording-transfer-worker.js';
import { CompanyRecordingDriveVerificationService } from '../../src/services/company-recording-drive-verification.service.js';
import { CompanyRecordingHistoryPublicationService } from '../../src/services/company-recording-history-publication.service.js';
import { CompanyRecordingUploadOrchestrator } from '../../src/services/company-recording-upload-orchestrator.js';
import { CompanyRecordingDriveFileInspector } from '../../src/services/company-recording-drive-file-inspector.js';
import { CompanyRecordingResumableTransport } from '../../src/services/company-recording-resumable-transport.js';
import { MeetingHistoryService } from '../../src/services/meeting-history.service.js';
import { RecordingService } from '../../src/services/recording.service.js';
import { CompanyDrivePrivacyInspector, RecordingDestinationPrivacyService } from '../../src/services/recording-destination-privacy.service.js';
import { IntegrationCredentialService } from '../../src/services/drive-security.service.js';
import { memoryCredentialRepository } from '../drive-credential-memory.js';

const address=process.env.DISPOSABLE_DATABASE_URL ?? '';
test('real job and staging stay unpublished with production readiness closed', {timeout:30000},async t=>{
  const parsed=new URL(address);
  if (process.env.NODE_ENV!=='test' || process.env.DATABASE_URL!==address || process.env.DOTENV_CONFIG_PATH!=='tests/.unused' || parsed.hostname!=='127.0.0.1' ||
      !/^ylaam_staging_disposable_[a-f0-9]{12}$/.test(parsed.pathname.slice(1)) || !/^ylaam_test_runner_[a-f0-9]{12}$/.test(parsed.username)) throw new Error('Unsafe disposable database target.');
  try {
    const [identity]=await client`select current_database() as name,current_user as role,inet_server_addr()::text as host`;
    assert.equal(identity.name,parsed.pathname.slice(1)); assert.equal(identity.role,parsed.username); assert.equal(identity.host,'127.0.0.1/32');
    const owner=randomUUID(), meeting=randomUUID(), recordingId=randomUUID();
    await client`insert into users(id,email,password_hash,full_name) values (${owner},${`host-${owner}@example.invalid`},'test','Host')`;
    await client`insert into meetings(id,meeting_code,title,host_user_id,time_zone) values (${meeting},'YLM-GUARDED','Guarded meeting',${owner},'Asia/Kolkata')`;
    const bytes=Buffer.from('canonical recording bytes'), sha256=createHash('sha256').update(bytes).digest('hex');
    const started='2026-01-02T03:04:00.000Z';
    const input={recordingId,meetingCode:'YLM-GUARDED',mimeType:'video/webm' as const,byteLength:bytes.length,sha256,recordingStartedAt:started};
    const jobs=new CompanyRecordingJobsService(true);
    const created=await jobs.create(input,owner);
    await t.test('job identity, metadata, configured folder and duplicate creation',async()=>{
      assert.equal((await jobs.create(input,owner)).id,created.id);
      const [row]=await client`select * from company_recording_upload_jobs where id=${created.id}`;
      assert.equal(row.destination_folder_id,recordingDriveRootId()); assert.equal(row.recording_title,'Guarded meeting');
      assert.equal(new Date(row.recording_started_at).toISOString(),started); assert.equal(row.recording_time_zone,'Asia/Kolkata');
      assert.equal(row.recording_filename,`Guarded meeting - 2026-01-02 - 08-34 - ${recordingId}.webm`);
      assert.equal(row.mime_type,'video/webm');
      await assert.rejects(jobs.create({...input,sha256:'a'.repeat(64)},owner));
      await assert.rejects(jobs.create(input,randomUUID()));
    });
    await t.test('a manually selected authorized folder is durably snapshotted without changing the meeting default',async()=>{
      const folderId='authorizedFolder123', selectedRecording=randomUUID();
      const selectedJobs=new CompanyRecordingJobsService(true,async(_input,_user,destination)=>({status:'SAFE' as const,destinationId:destination,checkedAt:'test'}),
        ()=>({ready:true,reason:'test'}),async(_user,requested)=>requested);
      const selected=await selectedJobs.create({...input,recordingId:selectedRecording,destinationFolderId:folderId},owner);
      const [row]=await client`select destination_folder_id from company_recording_upload_jobs where id=${selected.id}`;
      assert.equal(row.destination_folder_id,folderId);
      const [meetingRow]=await client`select recording_folder_id from meetings where id=${meeting}`;
      assert.equal(meetingRow.recording_folder_id,null);
      assert.equal((await selectedJobs.create({...input,recordingId:selectedRecording,destinationFolderId:folderId},owner)).id,selected.id);
    });
    const config={nodeEnv:'test',jobsEnabled:true,localEnabled:true,databaseUrl:address};
    const authorize=(id:string,user:string)=>jobs.status(id,user);
    const privacy=(id:string,user:string)=>jobs.validateImmediatelyBeforeFileCreation(id,user);
    const ingestion=new LocalRecordingIngestion(client,config,authorize);
    const binding={jobId:created.id,recordingId,userId:owner};
    await t.test('canonical staging, retry and byte verification are durable',async()=>{
      const range=`bytes 0-${bytes.length-1}/${bytes.length}`;
      assert.equal((await ingestion.ingest(binding,range,bytes)).ingestionOffset,bytes.length);
      assert.equal((await ingestion.ingest(binding,range,bytes)).ingestionOffset,bytes.length);
      await assert.rejects(ingestion.ingest(binding,range,Buffer.alloc(bytes.length,1)));
      assert.equal((await ingestion.verify(binding)).ingestionState,'verified');
      const [chunks]=await client`select count(*)::int as n from local_recording_staging.chunks c join local_recording_staging.recordings r on r.id=c.staging_id where r.source_job_id=${created.id}`;
      assert.equal(chunks.n,1);
    });
    await t.test('closed readiness prevents provider calls and real History publication',async()=>{
      let driveCalls=0;
      const fetcher:typeof fetch=async()=>{driveCalls++;throw new Error('Unexpected mocked provider call');};
      const access=async()=>({accountEmail:'company@example.invalid',credentialGeneration:randomUUID(),accessToken:'mock'});
      const transport=new CompanyRecordingResumableTransport(fetcher), inspector=new CompanyRecordingDriveFileInspector(fetcher);
      const intent=new CompanyRecordingDriveIntentService(client,config,authorize,privacy,access,transport,randomBytes(32));
      const worker=new CompanyRecordingTransferWorker(client,config,authorize,privacy,access,intent,transport);
      const verification=new CompanyRecordingDriveVerificationService(client,config,authorize,privacy,access,inspector);
      const publication=new CompanyRecordingHistoryPublicationService(client,config,authorize,privacy,access,inspector);
      const orchestrator=new CompanyRecordingUploadOrchestrator(client,config,jobs,intent,worker,verification,publication,ingestion);
      assert.equal((await privacy(created.id,owner)).status,'BLOCKED');
      await assert.rejects(orchestrator.process(created.id,owner));
      await assert.rejects(publication.publish(created.id,owner),/publication is unavailable/);
      assert.equal(driveCalls,0);
      const [job]=await client`select state,drive_file_id from company_recording_upload_jobs where id=${created.id}`;
      assert.equal(job.state,'pending'); assert.equal(job.drive_file_id,null);
      const history=await new MeetingHistoryService().detail(meeting,owner);
      assert.equal(history.items.filter(item=>item.kind==='drive').length,0);
      await assert.rejects(new MeetingHistoryService().detail(meeting,randomUUID()));
    });
    await t.test('real transfer, independent inspection and History use stateful mocked Drive',async t=>{
      const company='company@example.invalid', root=recordingDriveRootId(), myRoot='mock_company_root_123';
      const folderMime='application/vnd.google-apps.folder';
      const folder=(id:string,parents:string[])=>({id,mimeType:folderMime,trashed:false,parents,version:'1',ownedByMe:true,isAppAuthorized:true,capabilities:{canAddChildren:true,canListChildren:true,canShare:true}});
      const ownerPermission={id:'owner-permission',type:'user',role:'owner',emailAddress:company};
      const sharedPermission={id:'shared-group',type:'group',role:'reader',emailAddress:'team@example.invalid'};
      const memory=memoryCredentialRepository(),credentials=new IntegrationCredentialService(memory.repository,owner,randomBytes(32));
      await credentials.replace(owner,company,'mock-refresh',await credentials.generation());
      const account=await credentials.loadForBackend(); if(!account) throw new Error('Mock credential unavailable');
      const access=async()=>({accountEmail:company,credentialGeneration:account.generation,accessToken:'mock-token'});
      const oauth={exchangeCode:async()=>({}),refresh:async()=>({access_token:'mock-token'}),accountEmail:async()=>company,rootMetadata:async()=>folder(root,[myRoot])};
      const files=new Map<string,{id:string;name:string;mimeType:string;parents:string[];data:Buffer}>();
      const sessions=new Map<string,{id:string;name:string;mimeType:string;parents:string[];data:Buffer}>();
      let allocated=0, createdFiles=0, permissionMutations=0, failUpload=false, badChecksum=false;
      const provider:typeof fetch=async(input,init)=>{
        const url=new URL(String(input)); const method=init?.method ?? 'GET';
        assert.equal(url.hostname,'www.googleapis.com');
        if(url.pathname.endsWith('/permissions')) {
          if(method!=='GET'){permissionMutations++;throw new Error('Unexpected permission mutation');}
          const id=url.pathname.split('/').at(-2);
          return Response.json({permissions:id===myRoot?[ownerPermission]:[ownerPermission,sharedPermission]});
        }
        if(url.pathname.endsWith('/generateIds')) return Response.json({ids:[`mock_file_${String(++allocated).padStart(12,'0')}`]});
        if(url.pathname==='/upload/drive/v3/files' && method==='POST') {
          const body=JSON.parse(String(init?.body)); assert.deepEqual(body.parents,[root]);
          const uploadId=`session_${body.id}`; sessions.set(uploadId,{...body,data:Buffer.alloc(0)});
          return new Response(null,{status:200,headers:{Location:`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${uploadId}`}});
        }
        if(url.pathname==='/upload/drive/v3/files' && method==='PUT') {
          const session=sessions.get(url.searchParams.get('upload_id') || ''); if(!session) throw new Error('Missing mock session');
          const range=(init?.headers as Record<string,string>)['Content-Range'];
          if(range.startsWith('bytes */')) return new Response(null,{status:308,headers:session.data.length?{Range:`bytes=0-${session.data.length-1}`}:{}});
          if(failUpload) return new Response(null,{status:503});
          assert.equal(Number(/^bytes (\d+)-/.exec(range)?.[1]),session.data.length);
          session.data=Buffer.concat([session.data,Buffer.from(init?.body as Uint8Array)]);
          if(session.data.length===Number(range.split('/')[1])) { files.set(session.id,{...session});createdFiles++;return Response.json({id:session.id}); }
          return new Response(null,{status:308,headers:{Range:`bytes=0-${session.data.length-1}`}});
        }
        const id=url.pathname.split('/').at(-1);
        if(id==='root') return Response.json(folder(myRoot,[]));
        if(id===root) return Response.json(folder(root,[myRoot]));
        const file=files.get(id || ''); if(!file) return new Response(null,{status:404});
        if(url.searchParams.get('fields')==='id') return Response.json({id:file.id});
        return Response.json({id:file.id,size:String(file.data.length),mimeType:file.mimeType,parents:file.parents,trashed:false,
          sha256Checksum:badChecksum?'b'.repeat(64):createHash('sha256').update(file.data).digest('hex'),ownedByMe:true,version:'1',owners:[{emailAddress:company}],inheritedPermissionsDisabled:false});
      };
      const folderInspector=new CompanyDrivePrivacyInspector({clientId:'mock',clientSecret:'mock',callbackUrl:'https://example.invalid/callback',administratorId:owner},oauth,credentials,provider);
      const destination=new RecordingDestinationPrivacyService({authorize:(code,occurrence,user)=>new RecordingService().authorizeExport({meetingCode:code,occurrenceId:occurrence},user),mayUseFolder:async()=>false,inspect:(r,f,named)=>folderInspector.inspect(r,f,named)});
      const ready=()=>({ready:true,reason:'injected test decision'});
      const readyJobs=new CompanyRecordingJobsService(true,(input,user)=>destination.validateCompanyRoot(input,user),ready);
      const authorizeReady=(id:string,user:string)=>readyJobs.status(id,user), privacyReady=(id:string,user:string)=>readyJobs.validateImmediatelyBeforeFileCreation(id,user);
      const testIngestion=new LocalRecordingIngestion(client,config,authorizeReady), transport=new CompanyRecordingResumableTransport(provider),inspector=new CompanyRecordingDriveFileInspector(provider);
      const intent=new CompanyRecordingDriveIntentService(client,config,authorizeReady,privacyReady,access,transport,randomBytes(32));
      const worker=new CompanyRecordingTransferWorker(client,config,authorizeReady,privacyReady,access,intent,transport);
      const verifier=new CompanyRecordingDriveVerificationService(client,config,authorizeReady,privacyReady,access,inspector);
      const publication=new CompanyRecordingHistoryPublicationService(client,config,authorizeReady,privacyReady,access,inspector,ready);
      let publicationError:unknown;
      const publish=publication.publish.bind(publication);
      publication.publish=async(id,user)=>{try{return await publish(id,user);}catch(error){publicationError=error;throw error;}};
      const orchestrator=new CompanyRecordingUploadOrchestrator(client,config,readyJobs,intent,worker,verifier,publication,testIngestion);
      const makeJob=async(text:string)=>{
        const data=Buffer.from(text),rid=randomUUID();
        const info={...input,recordingId:rid,byteLength:data.length,sha256:createHash('sha256').update(data).digest('hex')};
        const job=await readyJobs.create(info,owner), binding={jobId:job.id,recordingId:rid,userId:owner};
        await testIngestion.ingest(binding,`bytes 0-${data.length-1}/${data.length}`,data);
        await testIngestion.verify(binding);
        return {job,rid,data,info};
      };
      await t.test('successful verified file is published once and retrieved by host',async()=>{
        const f=await makeJob('successful mocked recording');
        const result=await orchestrator.process(f.job.id,owner); if(result.state!=='published'&&publicationError) throw publicationError; assert.equal(result.state,'published');
        const [row]=await client`select state,recording_filename,verified_drive_file_id from company_recording_upload_jobs where id=${f.job.id}`;
        assert.equal(row.state,'completed'); const file=files.get(row.verified_drive_file_id); assert.ok(file);
        assert.deepEqual(file.parents,[root]); assert.deepEqual(file.data,f.data); assert.equal(file.mimeType,'video/webm'); assert.equal(file.name,row.recording_filename);
        const [attestation]=await client`select outcome,expected_sha256,observed_sha256 from company_recording_drive_verifications where job_id=${f.job.id}`;
        assert.equal(attestation.outcome,'verified'); assert.equal(attestation.expected_sha256,f.info.sha256); assert.equal(attestation.observed_sha256,f.info.sha256);
        const history=await new MeetingHistoryService().detail(meeting,owner);
        const items=history.items.filter(item=>item.dedupeKey===`company-drive:${f.rid}`); assert.equal(items.length,1);
        assert.equal(items[0].label,file.name); assert.equal(items[0].content,`https://drive.google.com/file/d/${file.id}/view`);
        const before={allocated,createdFiles}; assert.equal((await readyJobs.create(f.info,owner)).id,f.job.id);
        assert.equal((await orchestrator.process(f.job.id,owner)).state,'completed');
        await assert.rejects(publication.publish(f.job.id,owner)); assert.deepEqual({allocated,createdFiles},before);
        assert.equal((await new MeetingHistoryService().detail(meeting,owner)).items.filter(item=>item.dedupeKey===`company-drive:${f.rid}`).length,1);
      });
      await t.test('failed upload and failed independent verification never publish',async()=>{
        const failed=await makeJob('upload failure');failUpload=true;
        assert.equal((await orchestrator.process(failed.job.id,owner)).state,'retryable');failUpload=false;
        assert.equal((await new MeetingHistoryService().detail(meeting,owner)).items.some(item=>item.dedupeKey===`company-drive:${failed.rid}`),false);
        const allocatedBeforeRetry=allocated, createdBeforeRetry=createdFiles;
        await orchestrator.retry(failed.job.id,owner);
        let progress=await orchestrator.status(failed.job.id,owner);
        for(let attempt=0;attempt<100 && progress.stage!=='completed';attempt++) {
          await new Promise(resolve=>setTimeout(resolve,30)); progress=await orchestrator.status(failed.job.id,owner);
        }
        assert.equal(progress.stage,'completed'); assert.equal(allocated,allocatedBeforeRetry); assert.equal(createdFiles,createdBeforeRetry+1);
        assert.equal((await new MeetingHistoryService().detail(meeting,owner)).items.filter(item=>item.dedupeKey===`company-drive:${failed.rid}`).length,1);
        const corrupt=await makeJob('checksum mismatch');badChecksum=true;
        assert.equal((await orchestrator.process(corrupt.job.id,owner)).state,'blocked');badChecksum=false;
        assert.equal((await new MeetingHistoryService().detail(meeting,owner)).items.some(item=>item.dedupeKey===`company-drive:${corrupt.rid}`),false);
      });
      assert.equal(permissionMutations,0);
    });
  } finally { await client.end({timeout:5}); }
});
