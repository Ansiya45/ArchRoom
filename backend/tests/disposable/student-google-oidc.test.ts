import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { StudentGoogleOidcService } from '../../src/services/student-google-oidc.service.js';

const database = 'postgres://ylaam_test_admin@127.0.0.1:55460/ylaam_staging_disposable_student_oidc';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
test('student OIDC with mocked Google on a fresh disposable database', { timeout: 120000 }, async t => {
  if (process.env.DATABASE_URL !== database || process.env.NODE_ENV !== 'test' || process.env.DOTENV_CONFIG_PATH !== 'tests/.unused') throw new Error('Unsafe target');
  console.log('Disposable PostgreSQL target: host=127.0.0.1 port=55460 database=ylaam_staging_disposable_student_oidc');
  const sql = postgres(database, { max: 4 });
  try {
    const [target] = await sql`select current_database() name,inet_server_addr()::text host,inet_server_port() port,current_setting('data_directory') directory`;
    assert.equal(target.name, 'ylaam_staging_disposable_student_oidc'); assert.equal(target.host, '127.0.0.1/32'); assert.equal(target.port, 55460);
    assert.equal(target.directory.replaceAll('\\', '/').toLowerCase(), 'd:/development/archroom/.codex-pg-student-oidc');
    const [empty] = await sql`select to_regclass('public.users') users`; assert.equal(empty.users, null);
    const { migrateDatabase } = await import('../../src/db/migrate.js'); await migrateDatabase(database); await migrateDatabase(database);
    const alice = randomUUID(), bob = randomUUID(), admin = randomUUID(), aliceSid = randomUUID(), bobSid = randomUUID();
    await sql`insert into users(id,email,password_hash,full_name,email_verified_at) values
      (${admin},'admin@example.invalid','pw','Admin',now()),(${alice},'alice@example.invalid','pw','Alice',now()),(${bob},'bob@example.invalid','pw','Bob',now())`;
    await sql`insert into auth_sessions(id,user_id,token_hash,password_version) values
      (${aliceSid},${alice},${hash('alice-token')},${hash('pw')}),(${bobSid},${bob},${hash('bob-token')},${hash('pw')})`;
    await sql`insert into recording_batch_folders(folder_id,name,created_by_user_id) values ('oidcBatch12345','Batch',${admin})`;
    const [a] = await sql`insert into batch_student_enrollments(folder_id,student_name,student_email,status,approved_by,email_verified_at)
      values('oidcBatch12345','Alice','alice@example.invalid','approved',${admin},now()) returning id`;
    const [b] = await sql`insert into batch_student_enrollments(folder_id,student_name,student_email,status,approved_by,email_verified_at)
      values('oidcBatch12345','Bob','bob@example.invalid','approved',${admin},now()) returning id`;
    await sql`insert into batch_enrollment_account_bindings(enrollment_id,user_id) values (${a.id},${alice}),(${b.id},${bob})`;
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    let nonce = '', subject = 'subject-alice', email = 'alice@gmail.invalid', calls = 0, wrongNonce = false;
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key', alg: 'RS256', use: 'sig' };
    const fetcher = (async (url: string | URL | Request) => {
      calls++;
      if (String(url) === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
      assert.equal(String(url), 'https://oauth2.googleapis.com/token');
      const now = Math.floor(Date.now()/1000);
      const head = Buffer.from(JSON.stringify({ alg:'RS256', kid:'key' })).toString('base64url');
      const body = Buffer.from(JSON.stringify({ iss:'https://accounts.google.com',aud:'student-client',sub:subject,email,
        email_verified:true,nonce:wrongNonce ? 'wrong' : nonce,iat:now,exp:now+600 })).toString('base64url');
      return Response.json({ id_token:`${head}.${body}.${sign('RSA-SHA256',Buffer.from(`${head}.${body}`),privateKey).toString('base64url')}`, access_token:'never-stored' });
    }) as typeof fetch;
    const service = new StudentGoogleOidcService(sql, { clientId:'student-client',clientSecret:'mock',callbackUrl:'http://localhost:5173/student-google/callback',companyClientId:'company-client' }, fetcher);
    const owner = { userId:alice,sessionId:aliceSid }, other = { userId:bob,sessionId:bobSid };
    const start = async (who = owner) => { const url = new URL((await service.start(who)).authorizationUrl);
      assert.equal(url.origin, 'https://accounts.google.com'); assert.equal(url.searchParams.get('scope'),'openid email');
      nonce = url.searchParams.get('nonce')!; return url.searchParams.get('state')!; };
    await t.test('valid proof links and stores no OAuth tokens; replay fails', async () => {
      const state = await start(); assert.deepEqual(await service.complete(owner,state,'mock-code'),{linked:true});
      assert.equal((await service.status(owner)).status,'verified'); await assert.rejects(service.complete(owner,state,'mock-code'));
      const [identity] = await sql`select * from student_google_identities where user_id=${alice}`;
      assert.equal(identity.google_subject,'subject-alice'); assert.ok(!JSON.stringify(identity).includes('never-stored'));
    });
    await t.test('state cannot be consumed by another account or session', async () => {
      const state=await start(); const before=calls; await assert.rejects(service.complete(other,state,'mock-code')); assert.equal(calls,before);
      await service.complete(owner,state,'mock-code');
    });
    await t.test('invalid nonce and expiry fail closed', async () => {
      let state=await start(); wrongNonce=true; await assert.rejects(service.complete(owner,state,'mock-code')); wrongNonce=false;
      await assert.rejects(service.complete(owner,state,'mock-code'));
      state=await start(); await sql`update student_google_oidc_attempts set expires_at=now()-interval '1 second' where user_id=${alice}`;
      await assert.rejects(service.complete(owner,state,'mock-code'));
    });
    await t.test('unlink invalidates pending attempts and subject remains reserved', async () => {
      const state=await start(); await service.unlink(owner); assert.equal((await service.status(owner)).status,'unverified');
      await assert.rejects(service.complete(owner,state,'mock-code'));
      const bobState=await start(other); await assert.rejects(service.complete(other,bobState,'mock-code'));
      const again=await start(); await service.complete(owner,again,'mock-code');
      const events=await sql`select action from student_google_identity_events where user_id=${alice}`;
      assert.ok(events.some(e=>e.action==='unlinked')); assert.ok(events.some(e=>e.action==='linked'));
    });
    await t.test('removed enrollment and deleted session prevent linking', async () => {
      await sql`update batch_student_enrollments set status='removed',removed_at=now(),removed_by=${admin} where id=${a.id}`;
      await assert.rejects(service.start(owner));
      await sql`delete from auth_sessions where id=${bobSid}`; await assert.rejects(service.start(other));
    });
  } finally { await sql.end({timeout:5}); }
});
