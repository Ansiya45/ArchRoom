import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompanyRecordingUploadOrchestrator } from '../src/services/company-recording-upload-orchestrator.js';
import { CompanyRecordingHistoryPublicationService } from '../src/services/company-recording-history-publication.service.js';

test('verified transfer reaches publication without invoking permission mutations', async () => {
  const calls:string[]=[];
  const sql=async (parts:TemplateStringsArray) => {
    const query=parts.join('?');
    if (query.includes('select r.id,j.recording_id')) return [{id:'stage',recording_id:'recording',byte_length:4,accepted:4,verified:'stage'}];
    if (query.includes('select j.state,j.error_code')) return [{state:'pending',byte_length:4,recording_id:'recording',staged_bytes:4,staged_verified:true,transfer_state:'awaiting_drive_verification',drive_confirmed_offset:4}];
    if (query.includes('select session_creation_attempted,encrypted_session,transfer_state')) return [{transfer_state:'awaiting_drive_verification'}];
    throw new Error('Unexpected query');
  };
  const jobs={status:async()=>({recordingId:'recording',byteLength:4})};
  const verification={verify:async()=>{calls.push('inspect');return {state:'verified'};}};
  const publication={publish:async()=>{calls.push('publish');return {state:'published'};}};
  const instance=new CompanyRecordingUploadOrchestrator(sql as any,{nodeEnv:'test',jobsEnabled:true,localEnabled:true,databaseUrl:'postgres://localhost@127.0.0.1/ylaam_staging_disposable_test'},jobs as any,{} as any,{} as any,verification as any,publication as any,{} as any);
  assert.deepEqual(await instance.process('job','owner'),{state:'published'});
  assert.deepEqual(calls,['inspect','publish']);
});

test('an inconclusive post-transfer inspection is retried without another Drive session or file', async () => {
  const calls:string[]=[];
  const sql=async (parts:TemplateStringsArray) => {
    const query=parts.join('?');
    if (query.includes('select r.id,j.recording_id')) return [{id:'stage',recording_id:'recording',byte_length:4,accepted:4,verified:'stage'}];
    if (query.includes('select j.state,j.error_code')) return [{state:'pending',byte_length:4,recording_id:'recording',staged_bytes:4,staged_verified:true,transfer_state:'awaiting_drive_verification',drive_confirmed_offset:4}];
    if (query.includes('select session_creation_attempted,encrypted_session,transfer_state')) return [{transfer_state:'awaiting_drive_verification'}];
    throw new Error('Unexpected query');
  };
  const verification={verify:async()=>{calls.push('inspect');return {state:calls.length===1?'inconclusive':'verified'};}};
  const publication={publish:async()=>{calls.push('publish');return {state:'published'};}};
  const noSecondUpload={reserve:async()=>{throw new Error('No second file ID');},beginSession:async()=>{throw new Error('No second session');}};
  const noSecondTransfer={step:async()=>{throw new Error('No second transfer');}};
  const instance=new CompanyRecordingUploadOrchestrator(sql as any,{nodeEnv:'test',jobsEnabled:true,localEnabled:true,databaseUrl:'postgres://localhost@127.0.0.1/ylaam_staging_disposable_test'},
    {status:async()=>({recordingId:'recording',byteLength:4})} as any,noSecondUpload as any,noSecondTransfer as any,verification as any,publication as any,{} as any);
  assert.deepEqual(await instance.process('job','owner'),{state:'published'});
  assert.deepEqual(calls,['inspect','inspect','publish']);
});

test('persistent inconclusive inspection stays blocked after bounded read-only retries', async () => {
  let inspections=0,manual=0;
  const sql=async (parts:TemplateStringsArray) => {
    const query=parts.join('?');
    if (query.includes('select r.id,j.recording_id')) return [{id:'stage',recording_id:'recording',byte_length:4,accepted:4,verified:'stage'}];
    if (query.includes('select j.state,j.error_code')) return [{state:'pending',byte_length:4,recording_id:'recording',staged_bytes:4,staged_verified:true,transfer_state:'awaiting_drive_verification',drive_confirmed_offset:4}];
    if (query.includes('select session_creation_attempted,encrypted_session,transfer_state')) return [{transfer_state:'awaiting_drive_verification'}];
    if (query.includes("set state='failed'")) {manual++;return [];}
    throw new Error('Unexpected query');
  };
  const instance=new CompanyRecordingUploadOrchestrator(sql as any,{nodeEnv:'test',jobsEnabled:true,localEnabled:true,databaseUrl:'postgres://localhost@127.0.0.1/ylaam_staging_disposable_test'},
    {status:async()=>({recordingId:'recording',byteLength:4})} as any,
    {reserve:async()=>{throw new Error('No second file ID');}} as any,{step:async()=>{throw new Error('No second transfer');}} as any,
    {verify:async()=>{inspections++;return {state:'inconclusive'};}} as any,{publish:async()=>{throw new Error('Unverified publication');}} as any,{} as any);
  assert.deepEqual(await instance.process('job','owner'),{state:'inconclusive'});
  assert.equal(inspections,3);
  assert.equal(manual,1);
});

test('a pending inconclusive inspection remains in progress and can complete after a worker restart', async () => {
  const calls:string[]=[];
  let jobState='pending';
  const sql=async (parts:TemplateStringsArray) => {
    const query=parts.join('?');
    if (query.includes('select r.id,j.recording_id')) return [{id:'stage',recording_id:'recording',byte_length:4,accepted:4,verified:'stage'}];
    if (query.includes('select j.state,j.error_code')) return [{state:jobState,byte_length:4,recording_id:'recording',staged_bytes:4,staged_verified:true,
      drive_verification:'inconclusive',transfer_state:'awaiting_drive_verification',drive_confirmed_offset:4}];
    if (query.includes('select session_creation_attempted,encrypted_session,transfer_state')) return [{transfer_state:'awaiting_drive_verification'}];
    throw new Error('Unexpected query');
  };
  const instance=new CompanyRecordingUploadOrchestrator(sql as any,{nodeEnv:'test',jobsEnabled:true,localEnabled:true,databaseUrl:'postgres://localhost@127.0.0.1/ylaam_staging_disposable_test'},
    {status:async()=>({recordingId:'recording',byteLength:4})} as any,
    {reserve:async()=>{throw new Error('No new file ID');}} as any,{step:async()=>{throw new Error('No second transfer');}} as any,
    {verify:async()=>{calls.push('inspect');return {state:'verified'};}} as any,
    {publish:async()=>{calls.push('publish');return {state:'published'};}} as any,{} as any);
  assert.equal((await instance.status('job','owner')).stage,'awaiting_drive_verification');
  assert.deepEqual(await instance.process('job','owner'),{state:'published'});
  assert.deepEqual(calls,['inspect','publish']);
  jobState='failed';
  assert.equal((await instance.status('job','owner')).stage,'manual_reconciliation');
});

test('closed readiness guard blocks History publication before provider inspection', async () => {
  let inspections=0;
  const service=new CompanyRecordingHistoryPublicationService({} as any,{nodeEnv:'test',jobsEnabled:true,localEnabled:true,databaseUrl:'postgres://localhost@127.0.0.1/ylaam_staging_disposable_test'},
    async()=>{},async()=>({status:'SAFE',destinationId:'folder'}),async()=>({accountEmail:'company@example.invalid',credentialGeneration:'generation',accessToken:'mock'}),
    {inspect:async()=>{inspections++;return {status:'UNVERIFIABLE',reason:'mock'};}} as any);
  await assert.rejects(service.publish('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'),/publication is unavailable/);
  assert.equal(inspections,0);
});
