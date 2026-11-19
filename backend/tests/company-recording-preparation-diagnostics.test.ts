import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompanyRecordingDriveIntentService, CompanyRecordingPreparationError } from '../src/services/company-recording-drive-intent.service.js';
import { CompanyRecordingUploadOrchestrator } from '../src/services/company-recording-upload-orchestrator.js';
import { CompanyRecordingSessionStartError } from '../src/services/company-recording-resumable-transport.js';

const jobId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const config = { nodeEnv: 'test', jobsEnabled: true, localEnabled: true,
  databaseUrl: 'postgres://test@127.0.0.1/ylaam_staging_disposable_diagnostics' };
type Failure = 'job' | 'destination' | 'blocked' | 'moved' | 'credential' | 'allocation' | 'invalidId' | 'changed' | 'persist' | undefined;

function fixture(failure?: Failure) {
  let accessCalls = 0;
  let allocations = 0;
  const query = async (strings: TemplateStringsArray) => {
    const statement = strings.join('?');
    if (statement.includes('from company_recording_upload_jobs')) {
      if (failure === 'job') throw new Error('private database detail');
      return [{ id: jobId, recording_id: jobId, owner_user_id: ownerId, state: 'pending',
        byte_length: 4, destination_folder_id: 'folder' }];
    }
    if (statement.includes('from local_recording_staging.recordings')) return [{ id: 'stage' }];
    if (statement.includes('from company_recording_transfer_intents')) return [];
    if (statement.includes('insert into company_recording_transfer_intents')) {
      if (failure === 'persist') throw new Error('private SQL detail');
      return [{ drive_file_id: 'generatedFileId123' }];
    }
    return [];
  };
  const sql = Object.assign(query, { begin: (action: (tx: typeof query) => Promise<unknown>) => action(query) });
  const service = new CompanyRecordingDriveIntentService(sql as any, config,
    async () => {}, async () => {
      if (failure === 'destination') throw new Error('private folder metadata');
      return { status: failure === 'blocked' ? 'BLOCKED' : 'SAFE', destinationId: failure === 'moved' ? 'differentFolder' : 'folder' };
    }, async () => {
      accessCalls++;
      if (failure === 'credential') throw new Error('private refresh token');
      return { accountEmail: 'company@example.invalid', credentialGeneration: failure === 'changed' && accessCalls > 1 ? 'new' : 'old', accessToken: 'private access token' };
    }, { allocateFileId: async () => {
      allocations++;
      if (failure === 'allocation') throw new Error('private Google response');
      return failure === 'invalidId' ? 'bad' : 'generatedFileId123';
    } } as any, Buffer.alloc(32));
  return { service, get allocations() { return allocations; } };
}

test('preparation failures expose only classified stage codes', async () => {
  const cases: Array<[Failure, string, number]> = [
    ['job', 'PREPARE_JOB_UNAVAILABLE', 0],
    ['destination', 'PREPARE_DESTINATION_UNVERIFIABLE', 0],
    ['blocked', 'PREPARE_DESTINATION_BLOCKED', 0],
    ['moved', 'PREPARE_DESTINATION_CHANGED', 0],
    ['credential', 'PREPARE_CREDENTIAL_UNAVAILABLE', 0],
    ['allocation', 'PREPARE_DRIVE_ID_ALLOCATION_FAILED', 1],
    ['invalidId', 'PREPARE_DRIVE_ID_ALLOCATION_FAILED', 1],
    ['changed', 'PREPARE_CREDENTIAL_CHANGED', 1],
    ['persist', 'PREPARE_INTENT_PERSIST_FAILED', 1],
  ];
  for (const [failure, code, allocations] of cases) {
    const state = fixture(failure);
    await assert.rejects(state.service.reserve(jobId, ownerId), error => {
      assert.ok(error instanceof CompanyRecordingPreparationError);
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /private|token|folder|Google|SQL/i);
      return true;
    });
    assert.equal(state.allocations, allocations, failure);
  }
});

test('successful reservation keeps the existing durable file-ID path', async () => {
  const state = fixture();
  assert.deepEqual(await state.service.reserve(jobId, ownerId), { driveFileId: 'generatedFileId123', sessionReady: false });
  assert.equal(state.allocations, 1);
});

test('invalid session encryption key blocks before any Google session request', async () => {
  let providerCalls = 0;
  const sql = async (parts: TemplateStringsArray) => {
    if (parts.join('?').includes('select id,destination_folder_id from company_recording_upload_jobs'))
      return [{ id: jobId, destination_folder_id: 'authorizedFolder123' }];
    throw new Error('No further database access is expected.');
  };
  const db = Object.assign(sql, { begin: async () => { throw new Error('No transaction is expected.'); } });
  const service = new CompanyRecordingDriveIntentService(db as any, config, async () => {},
    async () => ({ status: 'SAFE', destinationId: 'authorizedFolder123' }),
    async () => ({ accountEmail: 'company@example.invalid', credentialGeneration: 'generation', accessToken: 'private token' }),
    { beginSession: async () => { providerCalls++; throw new Error('must not call Drive'); } } as any,
    Buffer.alloc(31));
  await assert.rejects(service.beginSession(jobId, ownerId), /Company recording transfer is unavailable/);
  assert.equal(providerCalls, 0);
});

test('orchestrator persists a classified code without logging provider details', async () => {
  const writes: unknown[][] = [];
  const sql = async (_strings: TemplateStringsArray, ...values: unknown[]) => { writes.push(values); return []; };
  const orchestrator = new CompanyRecordingUploadOrchestrator(sql as any, config, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any);
  orchestrator.process = async () => { throw new CompanyRecordingPreparationError('PREPARE_DESTINATION_UNVERIFIABLE'); };
  const originalWarn = console.warn;
  const logged: unknown[][] = [];
  console.warn = (...args: unknown[]) => { logged.push(args); };
  try {
    orchestrator.schedule(jobId, ownerId);
    await new Promise(resolve => setImmediate(resolve));
  } finally { console.warn = originalWarn; }
  assert.equal(writes.length, 2);
  assert.equal(writes[0]?.[0], 'PREPARE_DESTINATION_UNVERIFIABLE');
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0]?.[1], { jobId, reasonCode: 'PREPARE_DESTINATION_UNVERIFIABLE' });
});

test('retry rejects an ambiguous or already failed session without a server error or a new Drive attempt', async () => {
  for (const [state, unsafe, code] of [
    ['failed', false, 'CONFLICT'], ['retryable', true, 'PRECONDITION_FAILED'],
  ] as const) {
    const queries: string[] = [];
    const sql = async (parts: TemplateStringsArray) => {
      const statement = parts.join('?'); queries.push(statement);
      if (statement.includes('select state from company_recording_upload_jobs')) return [{ state }];
      if (statement.includes('select 1 from company_recording_transfer_intents')) return unsafe ? [{ present: 1 }] : [];
      throw new Error('Unexpected database access');
    };
    const jobs = { status: async () => ({ id: jobId }) };
    const orchestrator = new CompanyRecordingUploadOrchestrator(sql as any, config, jobs as any,
      {} as any, {} as any, {} as any, {} as any, {} as any);
    await assert.rejects(orchestrator.retry(jobId, ownerId), error => {
      assert.equal((error as { code?: string }).code, code);
      return true;
    });
    assert.ok(queries.every(query => !query.includes('update company_recording_upload_jobs')));
  }
});

test('post-claim invalid session logs only safe Location rejection details', async () => {
  const generation = '33333333-3333-4333-8333-333333333333';
  const intent = { job_id: jobId, recording_id: jobId, owner_user_id: ownerId,
    drive_file_id: 'generatedFileId123', company_account_email: 'company@example.invalid',
    credential_generation: generation, destination_folder_id: 'authorizedFolder123',
    encrypted_session: null, session_creation_attempted: false, lease_epoch: 0 };
  const job = { id: jobId, recording_id: jobId, owner_user_id: ownerId, state: 'pending', byte_length: 4,
    destination_folder_id: 'authorizedFolder123', mime_type: 'video/mp4', recording_filename: 'Recording.mp4' };
  let claimed = false;
  let attempted = false;
  const sql = async (parts: TemplateStringsArray) => {
    const statement = parts.join('?');
    if (statement.includes('select id,destination_folder_id from company_recording_upload_jobs')) return [job];
    if (statement.includes('select * from company_recording_upload_jobs')) return [job];
    if (statement.includes('from local_recording_staging.recordings')) return [{ id: 'stage' }];
    if (statement.includes('select * from company_recording_transfer_intents')) return [intent];
    if (statement.includes('set session_creation_attempted=true')) {
      claimed = true;
      attempted = true;
      return [{ ...intent, session_creation_attempted: true, lease_epoch: 1 }];
    }
    if (statement.includes('set session_creation_attempted=false')) {
      attempted = false;
      return [{ job_id: jobId }];
    }
    return [];
  };
  const db = Object.assign(sql, { begin: (action: (tx: typeof sql) => Promise<unknown>) => action(sql) });
  const service = new CompanyRecordingDriveIntentService(db as any, config, async () => {},
    async () => ({ status: 'SAFE', destinationId: 'authorizedFolder123' }),
    async () => ({ accountEmail: 'company@example.invalid', credentialGeneration: generation, accessToken: 'private token' }),
    { beginSession: async () => { throw new CompanyRecordingSessionStartError('invalid_session', 200,
      { locationPresent: true, https: true, allowedGoogleHost: true, rejection: 'invalid_upload_id' }); } } as any,
    Buffer.alloc(32));
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  let failure: unknown;
  try {
    try { await service.beginSession(jobId, ownerId); }
    catch (error) { failure = error; }
  } finally { console.warn = original; }
  assert.ok(failure instanceof CompanyRecordingSessionStartError);
  assert.equal(claimed, true);
  assert.equal(attempted, true, 'an attempted Google request must stay blocked for reconciliation');
  assert.deepEqual(warnings.find(([event]) => event === 'Company recording session preparation failed')?.[1],
    { stage: 'drive_session_request', kind: 'invalid_session', httpStatus: 200,
      locationPresent: true, https: true, allowedGoogleHost: true, rejection: 'invalid_upload_id' });
  assert.doesNotMatch(JSON.stringify(warnings), /private token|authorizedFolder123|company@example.invalid/);
});

test('a failed post-claim preflight rearms only before the Drive request', async () => {
  const generation = '33333333-3333-4333-8333-333333333333';
  const job = { id: jobId, recording_id: jobId, owner_user_id: ownerId, state: 'pending', byte_length: 4,
    destination_folder_id: 'authorizedFolder123', mime_type: 'video/mp4', recording_filename: 'Recording.mp4' };
  for (const rearmSucceeds of [true, false]) {
    const intent = { job_id: jobId, recording_id: jobId, owner_user_id: ownerId,
      drive_file_id: 'generatedFileId123', company_account_email: 'company@example.invalid',
      credential_generation: generation, destination_folder_id: job.destination_folder_id,
      encrypted_session: null, session_creation_attempted: false, lease_epoch: 0 };
    let destinationChecks = 0;
    let providerCalls = 0;
    let attempted = false;
    const sql = async (parts: TemplateStringsArray) => {
      const statement = parts.join('?');
      if (statement.includes('select id,destination_folder_id from company_recording_upload_jobs')) return [job];
      if (statement.includes('select * from company_recording_upload_jobs')) return [job];
      if (statement.includes('from local_recording_staging.recordings')) return [{ id: 'stage' }];
      if (statement.includes('select * from company_recording_transfer_intents')) return [intent];
      if (statement.includes('set session_creation_attempted=true')) {
        attempted = true;
        return [{ ...intent, session_creation_attempted: true, lease_epoch: 1 }];
      }
      if (statement.includes('set session_creation_attempted=false')) {
        if (rearmSucceeds) { attempted = false; return [{ job_id: jobId }]; }
        return [];
      }
      return [];
    };
    const db = Object.assign(sql, { begin: (action: (tx: typeof sql) => Promise<unknown>) => action(sql) });
    const service = new CompanyRecordingDriveIntentService(db as any, config, async () => {},
      async () => {
        destinationChecks++;
        return { status: destinationChecks === 2 ? 'UNVERIFIABLE' : 'SAFE', destinationId: job.destination_folder_id };
      },
      async () => ({ accountEmail: 'company@example.invalid', credentialGeneration: generation, accessToken: 'private token' }),
      { beginSession: async () => { providerCalls++; throw new Error('must not call Drive'); } } as any,
      Buffer.alloc(32));
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      await assert.rejects(service.beginSession(jobId, ownerId), error => {
        assert.ok(error instanceof CompanyRecordingPreparationError);
        assert.equal(error.code, rearmSucceeds ? 'PREPARE_DESTINATION_UNVERIFIABLE' : 'PREPARE_INTENT_PERSIST_FAILED');
        return true;
      });
    } finally { console.warn = original; }
    assert.equal(providerCalls, 0);
    assert.equal(attempted, !rearmSucceeds);
    assert.deepEqual(warnings[0]?.[1], rearmSucceeds
      ? { stage: 'destination_recheck', kind: 'preparation_rejected' }
      : { stage: 'pre_request_rearm', kind: 'persistence_failure' });
    assert.doesNotMatch(JSON.stringify(warnings), /private token|authorizedFolder123|company@example.invalid/);
  }
});
