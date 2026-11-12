import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { test } from 'node:test';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';
import { LocalRecordingIngestion } from '../../src/services/local-recording-ingestion.service.js';
import { createLocalIngestionHandler } from '../../src/services/local-recording-ingestion.http.js';

const url = 'postgres://ylaam_test_admin@127.0.0.1:55449/ylaam_staging_disposable_0019';
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
test('0019 local ingestion and durable verification', { timeout: 180000 }, async t => {
  assert.equal(process.env.DATABASE_URL, url); assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DOTENV_CONFIG_PATH, 'tests/.unused');
  console.log('Disposable target: host=127.0.0.1 port=55449 database=ylaam_staging_disposable_0019');
  const sql = postgres(url, { max: 2 }), other = postgres(url, { max: 2 });
  let closeApp = async () => {};
  try {
    const [identity] = await sql`select current_database() as name, current_setting('data_directory') as directory, inet_server_addr()::text as host, inet_server_port() as port`;
    assert.equal(identity.name, 'ylaam_staging_disposable_0019'); assert.equal(identity.host, '127.0.0.1/32'); assert.equal(identity.port, 55449);
    assert.equal(identity.directory.replaceAll('\\','/').toLowerCase(), 'd:/development/archroom/.codex-pg-ingestion-0019');
    assert.equal((await sql`select to_regclass('public.users') as value`)[0].value, null);
    await migrateDatabase(url); await migrateDatabase(url);
    assert.equal((await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n, 22);
    const { CompanyRecordingJobsService } = await import('../../src/services/company-recording-jobs.service.js');
    const { client } = await import('../../src/db/index.js'); closeApp = () => client.end({ timeout: 5 });
    const { env } = await import('../../src/env.js');
    assert.equal(env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED, false); assert.equal(env.LOCAL_RECORDING_STAGING_ENABLED, false);
    const { authenticateStagingRequest } = await import('../../src/services/local-recording-ingestion.runtime.js');
    const { signJwt } = await import('../../src/utils/jwt.js');
    const jobs = new CompanyRecordingJobsService(true, async () => { throw new Error('Drive must not be called'); });
    const config = { nodeEnv: 'test', jobsEnabled: true, localEnabled: true, databaseUrl: url };
    const authorize = (id: string, user: string) => jobs.status(id, user);
    const service = new LocalRecordingIngestion(sql, config, authorize), second = new LocalRecordingIngestion(other, config, authorize);
    const fixture = async (data: Buffer, scheduled = false, shared?: { userId: string; meeting: string }, digest = hash(data), size = data.length) => {
      const userId = shared?.userId ?? randomUUID(), meeting = shared?.meeting ?? randomUUID(), jobId = randomUUID(), recordingId = randomUUID();
      if (!shared) {
        await sql`insert into users(id,email,password_hash,full_name,email_verified_at) values(${userId},${userId+'@example.invalid'},'test','Test',now())`;
        await sql`insert into meetings(id,meeting_code,title,host_user_id,schedule_type) values(${meeting},${meeting.toUpperCase()},'Test',${userId},${scheduled?'reusable':null})`;
      }
      const occurrence = scheduled ? randomUUID() : null;
      if (occurrence) await sql`insert into meeting_occurrences(id,meeting_id,status) values(${occurrence},${meeting},'ended')`;
      await sql`insert into company_recording_upload_jobs(id,recording_id,owner_user_id,meeting_id,occurrence_id,destination_folder_id,access_policy,mime_type,byte_length,sha256)
        values(${jobId},${recordingId},${userId},${meeting},${occurrence},'testFolder123','private','video/webm',${size},${digest})`;
      return { jobId, recordingId, userId, meeting, occurrence };
    };
    const data = Buffer.concat([Buffer.alloc(262144, 7), Buffer.from('end')]);
    const f = await fixture(data);
    const range = (start: number, length: number, total = data.length) => `bytes ${start}-${start+length-1}/${total}`;
    await t.test('off gates, job ownership, stable recording binding, host and session authorization', async () => {
      await assert.rejects(new LocalRecordingIngestion(sql,{...config,jobsEnabled:false},authorize).status(f), /LOCAL_STAGING_DISABLED/);
      await assert.rejects(service.status({...f,userId:randomUUID()}));
      await assert.rejects(service.status({...f,recordingId:randomUUID()}));
      const alien = await fixture(Buffer.from('abc'));
      await sql`update company_recording_upload_jobs set owner_user_id=${alien.userId} where id=${f.jobId}`;
      await assert.rejects(service.status({...f,userId:alien.userId}));
      await sql`update company_recording_upload_jobs set owner_user_id=${f.userId} where id=${f.jobId}`;
      const scheduled = await fixture(Buffer.from('abc'), true);
      await service.ingest(scheduled,'bytes 0-2/3',Buffer.from('abc')); assert.equal((await service.verify(scheduled)).ingestionState,'verified');
      await sql`delete from meeting_occurrences where id=${scheduled.occurrence}`;
      await assert.rejects(service.status(scheduled));
    });
    await t.test('bounds, alignment, gaps, sequential bytes, identical and conflicting retries', async () => {
      await assert.rejects(service.ingest(f,range(262144,3),Buffer.from('end')));
      await assert.rejects(service.ingest(f,range(0,3),Buffer.from('abc')));
      await assert.rejects(service.ingest(f,'bytes -1-2/3',Buffer.from('abc')));
      await assert.rejects(service.ingest(f,range(0,262144),Buffer.alloc(1)));
      assert.equal((await service.status(f)).ingestionOffset,0);
      assert.equal((await service.ingest(f,range(0,262144),data.subarray(0,262144))).ingestionOffset,262144);
      assert.equal((await second.ingest(f,range(0,262144),data.subarray(0,262144))).ingestionOffset,262144);
      await assert.rejects(service.ingest(f,range(0,262144),Buffer.alloc(262144,8)),/CONFLICTING_CHUNK/);
      await assert.rejects(service.ingest(f,range(1,262144),data.subarray(0,262144)));
      await assert.rejects(service.verify(f),/RECORDING_INCOMPLETE/);
    });
    await t.test('separate instances, restart, durable SHA-256, immutable verification, independent cycles', async () => {
      const results = await Promise.all([service.ingest(f,range(262144,3),Buffer.from('end')),second.ingest(f,range(262144,3),Buffer.from('end'))]);
      assert.ok(results.every(r=>r.ingestionOffset===data.length));
      const verified = await second.verify(f); assert.equal(verified.ingestionState,'verified');
      const restarted = new LocalRecordingIngestion(other,config,authorize);
      assert.equal((await restarted.status(f)).ingestionState,'verified');
      assert.deepEqual(await restarted.verify(f),verified);
      await assert.rejects(restarted.ingest(f,range(262144,3),Buffer.from('bad')),/CONFLICTING_CHUNK/);
      assert.equal((await restarted.ingest(f,range(262144,3),Buffer.from('end'))).ingestionState,'verified');
      const [stage] = await sql`select id from local_recording_staging.recordings where source_job_id=${f.jobId}`;
      await assert.rejects(sql`update local_recording_staging.verifications set sha256=${'b'.repeat(64)} where staging_id=${stage.id}`);
      const cycle = await fixture(Buffer.from('new'),false,f);
      await service.ingest(cycle,'bytes 0-2/3',Buffer.from('new')); await service.verify(cycle);
      assert.notEqual(cycle.recordingId,f.recordingId);
      assert.equal((await sql`select state,confirmed_offset from company_recording_upload_jobs where id=${f.jobId}`)[0].state,'pending');
      assert.equal(Number((await sql`select confirmed_offset from company_recording_upload_jobs where id=${f.jobId}`)[0].confirmed_offset),0);
    });
    await t.test('incorrect digest retains bytes without attestation; per-file limit and atomic quota failure', async () => {
      const bad = await fixture(Buffer.from('bad'),false,undefined,hash(Buffer.from('abc')));
      await service.ingest(bad,'bytes 0-2/3',Buffer.from('bad'));
      await assert.rejects(service.verify(bad),/RECORDING_INTEGRITY_FAILED/);
      assert.equal((await service.status(bad)).ingestionOffset,3);
      assert.equal((await service.status(bad)).ingestionState,'unverified');
      const tooLarge = await fixture(Buffer.from('abc'),false,undefined,'a'.repeat(64),134217729);
      await assert.rejects(service.status(tooLarge),/RECORDING_TOO_LARGE/);
      const cap = await fixture(Buffer.from('abc'));
      await sql`update local_recording_staging.capacity set used_bytes=536870912`;
      await assert.rejects(service.ingest(cap,'bytes 0-2/3',Buffer.from('abc')),/STAGING_CAPACITY_EXHAUSTED/);
      assert.equal((await service.status(cap)).ingestionOffset,0);
      assert.equal((await sql`select count(*)::int as n from local_recording_staging.recordings where source_job_id=${cap.jobId}`)[0].n,0);
      await sql`update local_recording_staging.capacity set used_bytes=(select sum(byte_length) from local_recording_staging.chunks)`;
      await service.ingest(cap,'bytes 0-2/3',Buffer.from('abc'));
      // A database failure after hashing must not leave a durable success marker.
      await sql`alter table local_recording_staging.verifications add constraint test_reject_attestation check (false) not valid`;
      try { await assert.rejects(service.verify(cap), /STAGING_TRANSACTION_FAILED/); }
      finally { await sql`alter table local_recording_staging.verifications drop constraint test_reject_attestation`; }
      assert.equal((await service.status(cap)).ingestionState,'unverified');
      assert.equal((await service.verify(cap)).ingestionState,'verified');
    });
    await t.test('HTTP real JWT auth, strict headers, abort, logout and progress endpoints', async () => {
      const h = await fixture(data);
      let onAuthenticated = () => {};
      const handler = createLocalIngestionHandler(service,async req => {
        const result = await authenticateStagingRequest(req);
        if (req.headers['x-test-slow']) onAuthenticated();
        return result;
      },new Set(['http://localhost:5173']));
      const server = createServer((req,res)=>void handler(req,res));
      await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
      const port = (server.address() as {port:number}).port;
      const token = signJwt({sub:h.userId,email:'test@example.invalid'});
      const path = `/recording-staging/jobs/${h.jobId}/recordings/${h.recordingId}`;
      const call = (action: string, headers: Record<string,string> = {}, body?: Buffer, auth = token) => new Promise<{status:number;body:any}>((resolve,reject)=>{
        const req=request({host:'127.0.0.1',port,path:path+'/'+action,method:action==='progress'?'GET':'POST',headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...headers}},res=>{
          const parts: Buffer[]=[];res.on('data',b=>parts.push(b));res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(Buffer.concat(parts).toString())}));
        });req.on('error',reject);req.end(body);
      });
      try {
        assert.equal((await call('progress',{},undefined,'')).status,401);
        assert.equal((await call('progress',{},undefined,'invalid')).status,401);
        assert.equal((await call('progress',{Origin:'https://untrusted.invalid'})).status,403);
        assert.equal((await call('progress',{},undefined,signJwt({sub:randomUUID(),email:'other@example.invalid'}))).status,404);
        assert.equal((await call('chunks',{'Content-Type':'text/plain'},Buffer.from('abc'))).status,400);
        assert.equal((await call('chunks',{'Content-Type':'application/octet-stream','Content-Length':'3','Content-Range':range(0,262144)},Buffer.from('abc'))).status,400);
        await new Promise<void>(resolve=>{
          const req=request({host:'127.0.0.1',port,path:path+'/chunks',method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','Content-Length':'262144','Content-Range':range(0,262144)}});
          req.on('error',()=>resolve());req.write(Buffer.alloc(10));setTimeout(()=>req.destroy(new Error('test abort')),100);
        });
        assert.equal((await call('progress')).body.ingestionOffset,0);
        const sessionId=randomUUID();
        await sql`insert into auth_sessions(id,user_id,token_hash,password_version) values(${sessionId},${h.userId},${hash(Buffer.from(sessionId))},${hash(Buffer.from('test'))})`;
        const sessionToken=signJwt({sub:h.userId,email:'test@example.invalid',sid:sessionId});
        assert.equal((await call('progress',{},undefined,sessionToken)).status,200);
        let entered!: () => void;
        const authenticated = new Promise<void>(resolve=>{entered=resolve;}); onAuthenticated=entered;
        let slow!: ReturnType<typeof request>;
        const slowResponse = new Promise<number>((resolve,reject)=>{
          slow=request({host:'127.0.0.1',port,path:path+'/chunks',method:'POST',headers:{Authorization:'Bearer '+sessionToken,'x-test-slow':'1','Content-Type':'application/octet-stream','Content-Length':'262144','Content-Range':range(0,262144)}},res=>{
            res.resume();res.on('end',()=>resolve(res.statusCode!));
          });slow.on('error',reject);slow.write(data.subarray(0,10));
        });
        await authenticated;
        await sql`delete from auth_sessions where id=${sessionId}`;
        slow.end(data.subarray(10,262144));
        assert.equal(await slowResponse,401);
        assert.equal((await call('progress')).body.ingestionOffset,0);
        assert.equal((await call('progress',{},undefined,sessionToken)).status,401);
        // A connected client that never finishes its body is cut off at 30 seconds.
        const started=Date.now();
        await new Promise<void>((resolve,reject)=>{
          const req=request({host:'127.0.0.1',port,path:path+'/chunks',method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream','Content-Length':'262144','Content-Range':range(0,262144)}},()=>reject(new Error('Expected deadline disconnect')));
          req.on('error',()=>resolve());req.write(Buffer.alloc(10));
        });
        assert.ok(Date.now()-started >= 29000 && Date.now()-started < 45000);
        assert.equal((await call('progress')).body.ingestionOffset,0);
        assert.equal((await call('chunks',{'Content-Type':'application/octet-stream','Content-Length':'262144','Content-Range':range(0,262144)},data.subarray(0,262144))).status,200);
        assert.equal((await call('verify')).status,409);
        assert.equal((await call('chunks',{'Content-Type':'application/octet-stream','Content-Length':'3','Content-Range':range(262144,3)},Buffer.from('end'))).status,200);
        assert.equal((await call('verify')).body.ingestionState,'verified');
      } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
    });
    await t.test('parent deletion retains verified bytes and quota while denying endpoint access', async () => {
      const before=Number((await sql`select used_bytes from local_recording_staging.capacity`)[0].used_bytes);
      await sql`delete from users where id=${f.userId}`;
      await assert.rejects(service.status(f)); await assert.rejects(service.verify(f));
      assert.equal(Number((await sql`select used_bytes from local_recording_staging.capacity`)[0].used_bytes),before);
      assert.equal((await sql`select count(*)::int as n from local_recording_staging.verifications v join local_recording_staging.recordings r on r.id=v.staging_id where r.source_job_id=${f.jobId}`)[0].n,1);
    });
  } finally { await closeApp(); await sql.end(); await other.end(); }
});
