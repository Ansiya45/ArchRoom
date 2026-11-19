// Isolated browser integration fixture. This file is never imported by the app.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';

const databaseUrl='postgres://ylaam_test_admin@127.0.0.1:55454/ylaam_staging_disposable_5d3_e2e';
const owner='00000000-0000-4000-8000-000000000101',sessionId='00000000-0000-4000-8000-000000000102';
const other='00000000-0000-4000-8000-000000000104',otherSession='00000000-0000-4000-8000-000000000105';
const root='1Txkb851QSUC4rsvhCNrpd2X_Pu3q36Xw',myRoot='mockCompanyRoot001',batch='mockBatchFolder001',unsafe='mockUnsafeFolder01';
assert.equal(process.env.DATABASE_URL,databaseUrl);assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DOTENV_CONFIG_PATH,'tests/.unused');
assert.equal(process.env.PORT,'55455');
console.log('Disposable target: host=127.0.0.1 port=55454 database=ylaam_staging_disposable_5d3_e2e');
const sql=postgres(databaseUrl,{max:2});
const [identity]=await sql`select current_database() as name,current_setting('data_directory') as directory,inet_server_addr()::text as host,inet_server_port() as port`;
assert.equal(identity.name,'ylaam_staging_disposable_5d3_e2e');assert.equal(identity.host,'127.0.0.1/32');assert.equal(identity.port,55454);
assert.equal(identity.directory.replaceAll('\\','/').toLowerCase(),'d:/development/archroom/.codex-pg-recording-5d3');
assert.equal((await sql`select to_regclass('public.users') as value`)[0].value,null);
await migrateDatabase(databaseUrl);
const {encryptRefreshToken}=await import('../../src/services/drive-security.service.js');
const key=Buffer.alloc(32,7);
assert.equal(process.env.GOOGLE_INTEGRATION_TOKEN_KEY,key.toString('base64'));
await sql`insert into users(id,email,password_hash,full_name,email_verified_at) values(${owner},'host@example.invalid','mock-password','Test Host',now())`;
await sql`insert into users(id,email,password_hash,full_name,email_verified_at) values(${other},'other@example.invalid','mock-password','Other User',now())`;
await sql`insert into auth_sessions(id,user_id,token_hash,password_version) values(${sessionId},${owner},${'1'.repeat(64)},${createHash('sha256').update('mock-password').digest('hex')})`;
await sql`insert into auth_sessions(id,user_id,token_hash,password_version) values(${otherSession},${other},${'2'.repeat(64)},${createHash('sha256').update('mock-password').digest('hex')})`;
await sql`insert into meetings(id,meeting_code,title,host_user_id) values('00000000-0000-4000-8000-000000000103','YLM-ABC234','Mock meeting',${owner})`;
await sql`insert into recording_batch_folders(folder_id,name,created_by_user_id) values(${batch},'Test batch',${owner}),(${unsafe},'Unsafe test batch',${owner})`;
await sql`insert into drive_integration_credentials(id,google_account_email,encrypted_refresh_token,connected_by_user_id) values(1,'company@example.invalid',${encryptRefreshToken('synthetic-refresh-token',key)},${owner})`;
await sql.end();

type RemoteFile={id:string;parent:string;mimeType:string;total:number;bytes:Buffer};
const files=new Map<string,RemoteFile>(),sessions=new Map<string,RemoteFile>();let counter=0;
const folder=(id:string)=>({ id:id==='root'?myRoot:id,mimeType:'application/vnd.google-apps.folder',trashed:false,
  parents:id==='root'?[]:id===root?[myRoot]:[root],ownedByMe:true,isAppAuthorized:true,version:'1',capabilities:{canAddChildren:true,canListChildren:true,canShare:true} });
globalThis.fetch=async (input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
  if(url.hostname==='oauth2.googleapis.com'&&url.pathname==='/token')return Response.json({access_token:'synthetic-company-access'});
  if(url.hostname!=='www.googleapis.com')throw new Error('External requests are prohibited in this test.');
  if(url.pathname==='/drive/v3/about')return Response.json({user:{emailAddress:'company@example.invalid'}});
  if(url.pathname==='/drive/v3/files/generateIds')return Response.json({ids:[`mockDriveFile${String(++counter).padStart(5,'0')}`]});
  if(url.pathname==='/upload/drive/v3/files'&&init?.method==='POST'){
    const metadata=JSON.parse(String(init.body)) as {id:string;parents:string[];mimeType:string};
    assert.equal(metadata.parents.length,1);assert.ok([root,batch].includes(metadata.parents[0]));
    const headers=new Headers(init.headers);const file={id:metadata.id,parent:metadata.parents[0],mimeType:metadata.mimeType,total:Number(headers.get('X-Upload-Content-Length')),bytes:Buffer.alloc(0)};
    const session=`mock_session_${counter}`;sessions.set(session,file);
    return new Response(null,{status:200,headers:{location:`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${session}`}});
  }
  if(url.pathname==='/upload/drive/v3/files'&&init?.method==='PUT'){
    const file=sessions.get(url.searchParams.get('upload_id')??'');if(!file)return new Response(null,{status:410});
    const range=new Headers(init.headers).get('Content-Range')??'';
    if(range.startsWith('bytes */'))return file.bytes.length===file.total?Response.json({id:file.id}):new Response(null,{status:308,headers:file.bytes.length?{Range:`bytes=0-${file.bytes.length-1}`}:{}});
    const start=Number(/^bytes (\d+)-/.exec(range)?.[1]);assert.equal(start,file.bytes.length);
    file.bytes=Buffer.concat([file.bytes,Buffer.from(init.body as Uint8Array)]);
    if(file.bytes.length===file.total){files.set(file.id,file);return Response.json({id:file.id});}
    return new Response(null,{status:308,headers:{Range:`bytes=0-${file.bytes.length-1}`}});
  }
  const match=/^\/drive\/v3\/files\/([^/]+)(\/permissions)?$/.exec(url.pathname);
  if(match){
    const id=decodeURIComponent(match[1]);
    if(match[2])return Response.json({permissions:id===unsafe?[{id:'public-id',type:'anyone',role:'reader'}]:[{id:'owner-id',type:'user',role:'owner',emailAddress:'company@example.invalid'}]});
    if(['root',root,batch,unsafe].includes(id))return Response.json(folder(id));
    const file=files.get(id);if(!file)return new Response(null,{status:404});
    return Response.json({id:file.id,size:String(file.total),mimeType:file.mimeType,parents:[file.parent],trashed:false,
      sha256Checksum:createHash('sha256').update(file.bytes).digest('hex'),ownedByMe:true,version:'1',owners:[{emailAddress:'company@example.invalid'}],inheritedPermissionsDisabled:false});
  }
  throw new Error('Unexpected mocked Google endpoint.');
};
const [{createHTTPServer},{appRouter},{createContext},{localIngestionHandler},{startCompanyRecordingUploadOrchestration},{default:cors}] = await Promise.all([
  import('@trpc/server/adapters/standalone'),import('../../src/trpc/router.js'),import('../../src/trpc/context.js'),
  import('../../src/services/local-recording-ingestion.runtime.js'),import('../../src/services/company-recording-upload-orchestrator.runtime.js'),import('cors'),
]);
const handle=localIngestionHandler(new Set(['http://127.0.0.1:5174']));
const server=createHTTPServer({router:appRouter,createContext,middleware(req,res,next){
  if(req.url?.startsWith('/recording-staging/')){void handle(req,res);return;}
  cors({origin:'http://127.0.0.1:5174',methods:['GET','POST','OPTIONS'],allowedHeaders:['Content-Type','Authorization']})(req,res,next);
}});
startCompanyRecordingUploadOrchestration();
server.listen(55455,'127.0.0.1',()=>console.log('Mock-backed recording test server listening on 127.0.0.1:55455'));
