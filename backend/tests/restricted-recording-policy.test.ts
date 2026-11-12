import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sql } from 'postgres';
import { CompanyRecordingPrivatePolicyIntentBuilder } from '../src/services/company-recording-private-policy-intent-builder.js';
import type { CompanyRecordingPrivateAclService } from '../src/services/company-recording-private-acl.service.js';

type Student = { user_id:string; google_subject:string|null; google_email:string|null; folder:string; status:string; bound:boolean };
function fixture(students: Student[], destination = 'batch-a', onIdentityLock?: () => void) {
  let saved: any;
  const sqlFn = async (parts: TemplateStringsArray) => {
    const query = parts.join('?');
    if (query.includes('from recording_batch_folders')) return [{folder_id:'batch-a'}];
    if (query.includes('from company_recording_upload_jobs j')) return [{ id:'job', recording_id:'recording', drive_file_id:'file', destination_folder_id:destination, access_policy:'restricted', recording_folder_id:'batch-a', host_user_id:'host' }];
    if (query.includes('select b.user_id from batch_student_enrollments')) return [{user_id:'host'}, ...students.filter(s=>s.folder==='batch-a' && s.status==='approved' && s.bound).map(s=>({user_id:s.user_id}))];
    if (query.includes('select id from users')) return [];
    if (query.includes('select user_id from student_google_identities')) { onIdentityLock?.(); return []; }
    if (query.includes('from batch_student_enrollments e')) {
      assert.match(query, /e\.folder_id=\?/); assert.match(query, /e\.status='approved'/); assert.doesNotMatch(query, /meeting_participants/i);
      return [{ user_id:'host', google_subject:'host-sub', google_email:'host@example.test', user_verified:true, kind:'creator' },
        ...students.filter(s => s.folder === 'batch-a' && s.status === 'approved' && s.bound).map(s => ({ ...s, user_verified:true, kind:'student' }))];
    }
    throw new Error('Unexpected query');
  };
  const sql = Object.assign(sqlFn, { begin: async (fn: (tx: unknown) => unknown) => fn(sqlFn) }) as unknown as Sql;
  const acl = { createIntent: async (input: unknown) => { saved = input; return { policyId:'policy' }; } } as unknown as CompanyRecordingPrivateAclService;
  const builder = new CompanyRecordingPrivatePolicyIntentBuilder(sql, acl, { account: async () => ({ accountEmail:'company@example.test', credentialGeneration:'generation' }), validateDestination: async () => ({ status:'SAFE', destinationId:destination }) });
  return { builder, saved: () => saved };
}
const student = (overrides: Partial<Student> = {}): Student => ({ user_id:'student', google_subject:'student-sub', google_email:'student@example.test', folder:'batch-a', status:'approved', bound:true, ...overrides });

test('includes an approved bound student without consulting attendance', async () => {
  const f = fixture([student()]); await f.builder.buildRestricted('job', 'host');
  assert.deepEqual(f.saved().recipients.map((r: { userId:string }) => r.userId), ['host', 'student']);
});
test('excludes pending, removed, unbound and other-batch students', async () => {
  const f = fixture([student({ status:'pending' }), student({ status:'removed' }), student({ bound:false }), student({ folder:'batch-b' })]);
  await f.builder.buildRestricted('job', 'host'); assert.deepEqual(f.saved().recipients.map((r: { userId:string }) => r.userId), ['host']);
});
test('fails closed for a bound approved student without verified Google identity', async () => {
  const f = fixture([student({ google_subject:null, google_email:null })]);
  await assert.rejects(f.builder.buildRestricted('job', 'host'), /no verified Google identity/); assert.equal(f.saved(), undefined);
});
test('rejects destination outside the meeting batch', async () => {
  const f = fixture([student()], 'batch-b'); await assert.rejects(f.builder.buildRestricted('job', 'host'), /authorized batch/);
});
test('uses the final roster when a student is removed before the snapshot is read', async () => {
  const s = student(); const f = fixture([s], 'batch-a', () => { s.status = 'removed'; });
  await f.builder.buildRestricted('job', 'host'); assert.deepEqual(f.saved().recipients.map((r: { userId:string }) => r.userId), ['host']);
});
test('fails if an identity is unlinked before the final snapshot', async () => {
  const s = student(); const f = fixture([s], 'batch-a', () => { s.google_subject = null; s.google_email = null; });
  await assert.rejects(f.builder.buildRestricted('job', 'host'), /no verified Google identity/); assert.equal(f.saved(), undefined);
});
