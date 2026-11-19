import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, after } from 'node:test';
import postgres from 'postgres';

const target = new URL(process.env.DISPOSABLE_DATABASE_URL || '');
if (process.env.NODE_ENV !== 'test' || target.hostname !== '127.0.0.1' ||
    !/^ylaam_security_disposable_[a-f0-9]{12}$/.test(target.pathname.slice(1)) ||
    !/^ylaam_security_owner_[a-f0-9]{12}$/.test(target.username)) throw new Error('Unsafe disposable database target');
const db = postgres(target.toString(), { max: 1 });
after(async () => db.end({ timeout: 5 }));
const tables = [
  'recording_batch_folders', 'recording_batch_folder_permissions', 'drive_integration_credentials',
  'recording_folder_creators', 'drive_integration_generation', 'company_recording_upload_jobs',
  'company_recording_transfer_intents', 'company_recording_drive_verifications',
  'batch_student_enrollments', 'batch_student_enrollment_events', 'batch_registration_links',
  'batch_registration_verifications', 'batch_registration_limits', 'student_google_identities',
  'batch_enrollment_account_bindings', 'student_google_subject_reservations',
  'student_google_oidc_attempts', 'student_google_identity_events', 'company_recording_private_policies',
  'company_recording_private_readers', 'company_recording_private_acl_operations',
  'company_recording_private_acl_audit', 'company_recording_anyone_confirmations',
];

test('security inventory covers every public table in migrations 0013–0031', async () => {
  const journal = JSON.parse(await readFile(new URL('../../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  const created = [];
  for (const entry of journal.entries.filter(entry => entry.idx >= 13 && entry.idx <= 30)) {
    const text = await readFile(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/^CREATE TABLE\s+(?:public\.)?([a-z_][a-z_0-9]*)\s*\(/gim)) created.push(match[1]);
  }
  assert.deepEqual([...new Set(created)].sort(), [...tables].sort());
});

test('disposable database identity and protected table inventory', async () => {
  const [identity] = await db`select current_database() as name, current_user as role, inet_server_addr()::text as host`;
  assert.equal(identity.name, target.pathname.slice(1));
  assert.equal(identity.role, target.username);
  assert.equal(identity.host, '127.0.0.1/32');
  const rows = await db`select c.relname, c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname = any(${tables}) and c.relkind='r'`;
  assert.equal(rows.length, tables.length);
  for (const row of rows) {
    assert.equal(row.relrowsecurity, true, row.relname);
    assert.equal(row.relforcerowsecurity, false, row.relname);
    assert.equal(row.owner, target.username, row.relname);
  }
});

for (const role of ['anon', 'authenticated']) {
  test(`${role} has no direct privileges on protected tables`, async () => {
    for (const table of tables) {
      const [row] = await db`select has_table_privilege(${role}, ${'public.' + table}, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as allowed`;
      assert.equal(row.allowed, false, `${role}: ${table}`);
      await assert.rejects(db.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        await tx.unsafe(`select 1 from public."${table}" limit 0`);
      }), error => error.code === '42501', `${role}: ${table}`);
    }
  });
}

test('RLS blocks rows even if a browser role later receives SELECT', async () => {
  const rollback = new Error('rollback temporary grant');
  await assert.rejects(db.begin(async tx => {
    await tx`grant select on public.drive_integration_generation to anon`;
    await tx`set local role anon`;
    const rows = await tx`select id from public.drive_integration_generation`;
    assert.equal(rows.length, 0);
    throw rollback;
  }), error => error === rollback);
});

test('table owner and postgres retain access and readiness remains closed', async () => {
  for (const table of tables) {
    const [row] = await db`select has_table_privilege('postgres', ${'public.' + table}, 'SELECT,INSERT,UPDATE,DELETE') as allowed`;
    assert.equal(row.allowed, true, table);
    const [owner] = await db`select has_table_privilege(current_user, ${'public.' + table}, 'SELECT,INSERT,UPDATE,DELETE') as allowed`;
    assert.equal(owner.allowed, true, table);
    await db.unsafe(`select 1 from public."${table}" limit 0`);
  }
  const updated = await db`update drive_integration_generation set generation = generation where id = 1 returning id`;
  assert.equal(updated.length, 1);
  const { companyRecordingSharingReadiness } = await import('../../dist/services/company-recording-sharing-readiness.js');
  assert.equal(companyRecordingSharingReadiness().ready, false);
});
