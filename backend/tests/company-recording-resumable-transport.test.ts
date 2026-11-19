import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CompanyRecordingResumableTransport, CompanyRecordingSessionStartError } from '../src/services/company-recording-resumable-transport.js';
import { recordingDriveRootId } from '../src/config/recordingDrive.js';

const session='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock_session_123';
test('session creation places the new file directly in the selected root or SAP MM folder', async () => {
  for (const folderId of [recordingDriveRootId(), '1SOsGSLZDpKrQ2OxAbKflTw2LQVZWvx2_']) {
    let calls=0;
    const transport=new CompanyRecordingResumableTransport(async (_url,init) => {
      calls++;
      assert.deepEqual(JSON.parse(String(init?.body)).parents,[folderId]);
      return new Response(null,{status:200,headers:{Location:session}});
    });
    assert.equal(await transport.beginSession('mock-token',{fileId:'allocatedFile123',folderId,
      mimeType:'video/mp4',byteLength:4,name:'Recording.mp4'}),session);
    assert.equal(calls,1);
  }
});
test('Drive v3 resumable transport uses pre-generated ID, safe metadata and confirmed offsets', async () => {
  const calls: Array<{url:string;init:RequestInit}> = [];
  const responses = [
    new Response(JSON.stringify({ids:['allocatedFile123']}),{status:200}),
    new Response(null,{status:200,headers:{Location:session}}),
    new Response(null,{status:308,headers:{Range:'bytes=0-262143'}}),
    new Response(null,{status:308,headers:{Range:'bytes=0-262143'}}),
    new Response(null,{status:200}),
  ];
  const transport=new CompanyRecordingResumableTransport(async (url,init)=>{
    calls.push({url:String(url),init: init!});return responses.shift()!;
  });
  assert.equal(await transport.allocateFileId('mock-token'),'allocatedFile123');
  assert.equal(await transport.beginSession('mock-token',{fileId:'allocatedFile123',folderId:'authorizedRoot123',
    mimeType:'video/webm',byteLength:262147,name:'Class - 2026-11-07 - 20-45 - 11111111-1111-4111-8111-111111111111.webm'}),session);
  assert.deepEqual(await transport.queryOffset('mock-token',session,262147),{state:'incomplete',confirmedOffset:262144});
  assert.deepEqual(await transport.sendChunk('mock-token',session,Buffer.alloc(262144),0,262147),{state:'incomplete',confirmedOffset:262144});
  assert.deepEqual(await transport.sendChunk('mock-token',session,Buffer.from('end'),262144,262147),{state:'complete_unverified'});
  assert.ok(calls.every(call=>call.init.redirect==='manual' && (call.init.headers as Record<string,string>).Authorization==='Bearer mock-token'));
  assert.equal(calls[0].url,'https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files');
  const body=JSON.parse(String(calls[1].init.body));assert.deepEqual(body.parents,['authorizedRoot123']);assert.equal(body.id,'allocatedFile123');assert.equal(body.name,'Class - 2026-11-07 - 20-45 - 11111111-1111-4111-8111-111111111111.webm');
  assert.equal((calls[3].init.headers as Record<string,string>)['Content-Range'],'bytes 0-262143/262147');
  assert.equal((calls[4].init.headers as Record<string,string>)['Content-Range'],'bytes 262144-262146/262147');
});
test('Drive transport blocks redirects, invalid sessions, unsafe metadata and classifies failures',async()=>{
  const responses=[new Response(null,{status:302,headers:{Location:'https://evil.invalid'}}),
    new Response(null,{status:200,headers:{Location:'https://evil.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=x'}}),
    new Response(null,{status:404}),new Response(null,{status:410}),new Response(null,{status:503}),new Response(null,{status:429})];
  let count=0;const transport=new CompanyRecordingResumableTransport(async()=>{count++;return responses.shift()!;});
  const input={fileId:'allocatedFile123',folderId:'authorizedRoot123',mimeType:'video/mp4' as const,byteLength:3,
    name:'recording-11111111-1111-4111-8111-111111111111.mp4'};
  await assert.rejects(transport.beginSession('mock',input));
  await assert.rejects(transport.beginSession('mock',input));
  assert.deepEqual(await transport.queryOffset('mock',session,3),{state:'session_expired'});
  assert.deepEqual(await transport.queryOffset('mock',session,3),{state:'session_expired'});
  assert.deepEqual(await transport.queryOffset('mock',session,3),{state:'retryable'});
  assert.deepEqual(await transport.queryOffset('mock',session,3),{state:'retryable'});
  await assert.rejects(transport.sendChunk('mock','https://evil.invalid/',Buffer.from('abc'),0,3));
  await assert.rejects(transport.beginSession('mock',{...input,folderId:'bad'}));
  await assert.rejects(transport.beginSession('mock',{...input,name:'../unsafe.mp4'}));
  await assert.rejects(transport.beginSession('mock',{...input,name:'wrong.webm'}));
  await assert.rejects(transport.sendChunk('mock',session,Buffer.alloc(1),0,262144));
  assert.equal(count,6);
});
test('Drive completion response rejects a different file ID',async()=>{
  const transport=new CompanyRecordingResumableTransport(async()=>new Response(JSON.stringify({id:'unexpectedFile999'}),{status:200}));
  await assert.rejects(transport.queryOffset('mock',session,3,'allocatedFile123'),/unexpected file ID/);
  await assert.rejects(transport.sendChunk('mock',session,Buffer.from('abc'),0,3,'allocatedFile123'),/unexpected file ID/);
});

test('Google session URI with additional opaque query parameters is retained for status and upload requests', async () => {
  const googleSession = `${session}&upload_protocol=resumable&session_hint=opaque_value`;
  const calls: string[] = [];
  const responses = [new Response(null, { status: 200, headers: { Location: googleSession } }),
    new Response(null, { status: 308 }), new Response(null, { status: 200 })];
  const transport = new CompanyRecordingResumableTransport(async (url, init) => {
    assert.equal(init?.redirect, 'manual');
    calls.push(String(url));
    return responses.shift()!;
  });
  assert.equal(await transport.beginSession('mock-token', { fileId: 'allocatedFile123', folderId: 'authorizedRoot123',
    mimeType: 'video/mp4', byteLength: 3, name: 'Recording.mp4' }), googleSession);
  assert.deepEqual(await transport.queryOffset('mock-token', googleSession, 3), { state: 'incomplete', confirmedOffset: 0 });
  assert.deepEqual(await transport.sendChunk('mock-token', googleSession, Buffer.from('abc'), 0, 3),
    { state: 'complete_unverified' });
  assert.deepEqual(calls, ['https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    googleSession, googleSession]);
});

test('session creation failures expose a safe category and status without provider details', async () => {
  const input = { fileId:'allocatedFile123', folderId:'authorizedRoot123', mimeType:'video/mp4' as const,
    byteLength:3, name:'recording-11111111-1111-4111-8111-111111111111.mp4' };
  const cases: Array<[typeof fetch, string, number | undefined]> = [
    [async () => new Response('private response', { status:403 }), 'http_failure', 403],
    [async () => new Response(null, { status:200, headers:{ Location:'https://private.invalid/session' } }), 'invalid_session', 200],
    [async () => { throw new Error('private token'); }, 'request_failure', undefined],
  ];
  for (const [fetcher, kind, httpStatus] of cases) {
    const transport = new CompanyRecordingResumableTransport(fetcher);
    await assert.rejects(transport.beginSession('private token', input), error => {
      assert.ok(error instanceof CompanyRecordingSessionStartError);
      assert.equal(error.kind, kind); assert.equal(error.httpStatus, httpStatus);
      assert.doesNotMatch(error.message, /private|token|response|session URL/i);
      return true;
    });
  }
  const transport = new CompanyRecordingResumableTransport(async () => { throw new Error('must not call provider'); });
  await assert.rejects(transport.beginSession('private token', { ...input, folderId:'bad' }), error => {
    assert.ok(error instanceof CompanyRecordingSessionStartError);
    assert.equal(error.kind, 'invalid_metadata');
    return true;
  });
});

test('session initiation classifies rejected Location headers without exposing their values', async () => {
  const input = { fileId:'allocatedFile123', folderId:'authorizedRoot123', mimeType:'video/mp4' as const,
    byteLength:3, name:'recording-11111111-1111-4111-8111-111111111111.mp4' };
  const cases: Array<[string | null, string, boolean | null, boolean | null]> = [
    [null, 'missing_location', null, null],
    ['http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private123', 'non_https', false, true],
    ['https://evil.invalid/upload/drive/v3/files?uploadType=resumable&upload_id=private123', 'unexpected_host', true, false],
    ['https://www.googleapis.com:444/upload/drive/v3/files?uploadType=resumable&upload_id=private123', 'unexpected_port', true, true],
    ['https://user@www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private123', 'embedded_credentials', true, true],
    ['https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private123#private', 'fragment', true, true],
    ['https://www.googleapis.com/drive/v3/files?uploadType=resumable&upload_id=private123', 'unexpected_path', true, true],
    ['https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&uploadType=media&upload_id=private123', 'invalid_upload_type', true, true],
    ['https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private123&upload_id=other', 'invalid_upload_id', true, true],
    ['https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=private%2Fid', 'invalid_upload_id', true, true],
  ];
  for (const [location, rejection, https, allowedGoogleHost] of cases) {
    const transport = new CompanyRecordingResumableTransport(async () => new Response(null, {
      status: 200, headers: location === null ? {} : { Location: location },
    }));
    await assert.rejects(transport.beginSession('private token', input), error => {
      assert.ok(error instanceof CompanyRecordingSessionStartError);
      assert.equal(error.kind, 'invalid_session');
      assert.equal(error.httpStatus, 200);
      assert.deepEqual(error.sessionDiagnostic, {
        locationPresent: location !== null, https, allowedGoogleHost, rejection,
      });
      assert.doesNotMatch(JSON.stringify(error), /private123|private token|evil\.invalid|upload\/drive/);
      return true;
    });
  }
});
