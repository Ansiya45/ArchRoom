import assert from 'node:assert/strict';
import { test } from 'node:test';
import postgres from 'postgres';
import { migrateDatabase } from '../../src/db/migrate.js';

const url='postgres://ylaam_test_admin@127.0.0.1:55453/ylaam_staging_disposable_5d2c_capability';
test('authenticated capability verifies the actual disposable database and defaults off',{timeout:120000},async()=>{
  assert.equal(process.env.DATABASE_URL,url);assert.equal(process.env.NODE_ENV,'test');assert.equal(process.env.DOTENV_CONFIG_PATH,'tests/.unused');
  console.log('Disposable target: host=127.0.0.1 port=55453 database=ylaam_staging_disposable_5d2c_capability');
  const sql=postgres(url,{max:2});let closeApp=async()=>{};
  try {
    const [identity]=await sql`select current_database() as name,current_setting('data_directory') as directory,inet_server_addr()::text as host,inet_server_port() as port`;
    assert.equal(identity.name,'ylaam_staging_disposable_5d2c_capability');assert.equal(identity.host,'127.0.0.1/32');assert.equal(identity.port,55453);
    assert.equal(identity.directory.replaceAll('\\','/').toLowerCase(),'d:/development/archroom/.codex-pg-verification-5d2c');
    assert.equal((await sql`select to_regclass('public.users') as value`)[0].value,null);
    await migrateDatabase(url);await migrateDatabase(url);
    assert.equal((await sql`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n,23);
    const {env}=await import('../../src/env.js');
    assert.equal(env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED,false);assert.equal(env.LOCAL_RECORDING_STAGING_ENABLED,false);
    const {recordingsRouter}=await import('../../src/routers/recordings.js');
    const {client}=await import('../../src/db/index.js');closeApp=()=>client.end({timeout:5});
    const {encryptRefreshToken}=await import('../../src/services/drive-security.service.js');
    const admin='00000000-0000-4000-8000-000000000111',key=Buffer.alloc(32,3);
    const caller=recordingsRouter.createCaller({isAuthenticated:true,user:{id:admin,email:'admin@example.invalid'}} as never);
    const anonymous=recordingsRouter.createCaller({isAuthenticated:false,user:null} as never);
    await assert.rejects(anonymous.companyUploadCapability(),/Authentication required/);
    assert.deepEqual(await caller.companyUploadCapability(),{available:false});
    // These are in-memory test doubles only; no environment variables or files change.
    Object.assign(env,{COMPANY_DRIVE_UPLOAD_JOBS_ENABLED:true,LOCAL_RECORDING_STAGING_ENABLED:true,
      GOOGLE_CLIENT_ID:'mock-client',GOOGLE_CLIENT_SECRET:'mock-secret',GOOGLE_OAUTH_CALLBACK_URL:'http://localhost/google-drive/oauth/callback',
      GOOGLE_INTEGRATION_ADMIN_USER_ID:admin,GOOGLE_INTEGRATION_TOKEN_KEY:key.toString('base64')});
    assert.deepEqual(await caller.companyUploadCapability(),{available:false});
    await sql`insert into users(id,email,password_hash,full_name) values(${admin},'capability@example.invalid','test','Test')`;
    await sql`insert into drive_integration_credentials(id,google_account_email,encrypted_refresh_token,connected_by_user_id)
      values(1,'company@example.invalid',${encryptRefreshToken('synthetic-token',key)},${admin})`;
    assert.deepEqual(await caller.companyUploadCapability(),{available:true});
    env.LOCAL_RECORDING_STAGING_ENABLED=false;assert.deepEqual(await caller.companyUploadCapability(),{available:false});
    env.LOCAL_RECORDING_STAGING_ENABLED=true;env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED=false;assert.deepEqual(await caller.companyUploadCapability(),{available:false});
    env.COMPANY_DRIVE_UPLOAD_JOBS_ENABLED=true;env.NODE_ENV='production';assert.deepEqual(await caller.companyUploadCapability(),{available:false});
    env.NODE_ENV='test';env.DATABASE_URL='postgres://test@127.0.0.1/development';assert.deepEqual(await caller.companyUploadCapability(),{available:false});
  }finally{await closeApp();await sql.end();}
});
