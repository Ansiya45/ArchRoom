import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';

// This suite is opt-in and can only target the isolated local fixture.
const backend='http://127.0.0.1:55455';
const database='postgres://ylaam_test_admin@127.0.0.1:55454/ylaam_staging_disposable_5d3_e2e';
const owner='00000000-0000-4000-8000-000000000101',session='00000000-0000-4000-8000-000000000102';
const other='00000000-0000-4000-8000-000000000104',otherSession='00000000-0000-4000-8000-000000000105';
const meeting='00000000-0000-4000-8000-000000000103';
const root='1Txkb851QSUC4rsvhCNrpd2X_Pu3q36Xw',batch='mockBatchFolder001',unsafe='mockUnsafeFolder01';
function token(sub:string,sid:string) {
  const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({sub,sid,email:'host@example.invalid',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `${head}.${payload}.${createHmac('sha256','local-recording-e2e-only').update(`${head}.${payload}`).digest('base64url')}`;
}

test('real backend stages, verifies, and publishes distinct recordings to private root and batch folder', async ({ page, request }) => {
  test.skip(process.env.YLAAM_RECORDING_LOCAL_E2E !== '1','Requires the isolated disposable local fixture.');
  test.setTimeout(120000);
  const require=createRequire(import.meta.url);
  const postgres=require('../../backend/node_modules/postgres') as typeof import('../../backend/node_modules/postgres');
  const sql=postgres(database,{max:2});
  const responses:Promise<string>[]=[];
  let chunkRequests=0,dropChunkReply=true;
  try {
    const [identity]=await sql`select current_database() as name,current_setting('data_directory') as directory,inet_server_addr()::text as host,inet_server_port() as port`;
    expect(identity.name).toBe('ylaam_staging_disposable_5d3_e2e');expect(identity.host).toBe('127.0.0.1/32');expect(identity.port).toBe(55454);
    expect(identity.directory.replaceAll('\\','/').toLowerCase()).toBe('d:/development/archroom/.codex-pg-recording-5d3');
    page.on('response',response=>{if(response.url().includes('/api/'))responses.push(response.text().catch(()=>''));});
    await page.route('**/integration-recording*',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
      await import('/e2e/fixtures/company-upload-integration-harness.tsx');</script>`}));
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url());const response=await route.fetch({url:`${backend}${url.pathname.replace(/^\/api/,'')}${url.search}`});
      if(url.pathname.endsWith('/chunks')){chunkRequests++;if(dropChunkReply){dropChunkReply=false;await route.abort('failed');return;}}
      await route.fulfill({response});
    });
    await page.addInitScript(({jwt,ownerId})=>{
      localStorage.setItem('ylaam_meet_token',jwt);localStorage.setItem('ylaam_meet_user',JSON.stringify({id:ownerId,email:'host@example.invalid',fullName:'Test Host'}));
      class Recorder {
        static isTypeSupported(type:string){return type.startsWith('video/webm');}
        state='inactive';mimeType='video/webm';ondataavailable:((event:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;
        start(){this.state='recording';this.ondataavailable?.({data:new Blob(['canonical-'],{type:this.mimeType})});}
        pause(){this.state='paused';}resume(){this.state='recording';}
        stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['bytes'],{type:this.mimeType})});this.onstop?.();}
      }
      Object.defineProperty(window,'MediaRecorder',{value:Recorder});
    },{jwt:token(owner,session),ownerId:owner});
    await page.goto('/integration-recording');
    await page.getByRole('button',{name:'Start',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('recording');
    await page.getByRole('button',{name:'Pause',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('paused');
    await page.getByRole('button',{name:'Resume',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('recording');
    await page.getByRole('button',{name:'Stop',exact:true}).dblclick();
    await expect(page.getByText('Upload interrupted. Keep the recording and retry.')).toBeVisible();
    await page.getByRole('button',{name:'Retry upload'}).click();
    await expect(page.getByText('Saved to company Drive and available in Meeting History')).toHaveCount(1,{timeout:60000});
    expect(chunkRequests).toBe(1);
    const first=await sql`select j.id,j.recording_id,j.destination_folder_id,j.verified_drive_file_id,j.state,i.drive_file_id,v.outcome
      from company_recording_upload_jobs j join company_recording_transfer_intents i on i.job_id=j.id join company_recording_drive_verifications v on v.job_id=j.id`;
    expect(first).toHaveLength(1);expect(first[0].destination_folder_id).toBe(root);expect(first[0].state).toBe('completed');expect(first[0].outcome).toBe('verified');expect(first[0].verified_drive_file_id).toBe(first[0].drive_file_id);
    const [staged]=await sql`select encode(c.contents,'escape') as bytes from local_recording_staging.chunks c join local_recording_staging.recordings r on r.id=c.staging_id where r.source_job_id=${first[0].id}`;
    expect(staged.bytes).toBe('canonical-bytes');
    expect((await request.get(`${backend}/recording-staging/jobs/${first[0].id}/recordings/${first[0].recording_id}/progress`)).status()).toBe(401);
    expect((await request.get(`${backend}/recording-staging/jobs/${first[0].id}/recordings/${first[0].recording_id}/progress`,{headers:{Authorization:`Bearer ${token(other,otherSession)}`}})).status()).toBe(404);
    await sql`update meetings set recording_folder_id=${batch} where id=${meeting}`;
    await page.getByRole('button',{name:'Discard preview'}).click();await page.getByRole('button',{name:'Start',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('recording');
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await expect(page.getByText('Saved to company Drive and available in Meeting History')).toHaveCount(2,{timeout:60000});
    const jobs=await sql`select recording_id,destination_folder_id,verified_drive_file_id,state from company_recording_upload_jobs order by created_at`;
    expect(jobs).toHaveLength(2);expect(jobs[1].destination_folder_id).toBe(batch);expect(jobs[1].recording_id).not.toBe(jobs[0].recording_id);expect(jobs[1].verified_drive_file_id).not.toBe(jobs[0].verified_drive_file_id);
    const history=await page.evaluate(async id=>{const path='/src/lib/trpc.ts';const {trpc}=await import(/* @vite-ignore */ path);return trpc.meetings.historyDetail.query({meetingId:id});},meeting);
    expect(history.items.filter((item:{kind:string})=>item.kind==='drive')).toHaveLength(2);
    await sql`update meetings set recording_folder_id=${unsafe} where id=${meeting}`;
    await page.getByRole('button',{name:'Discard preview'}).click();await page.getByRole('button',{name:'Start',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('recording');
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await expect(page.getByText('Upload interrupted. Keep the recording and retry.')).toBeVisible({timeout:60000});
    const [counts]=await sql`select (select count(*)::int from company_recording_upload_jobs) as jobs,(select count(*)::int from company_recording_transfer_intents) as intents,(select count(*)::int from meeting_history_items where kind='drive') as history`;
    expect(counts).toEqual({jobs:3,intents:2,history:2});
    for(const body of await Promise.all(responses)){expect(body).not.toContain('synthetic-company-access');expect(body).not.toContain('synthetic-refresh-token');expect(body).not.toContain('upload_id=mock_session_');}
  } finally {await sql.end();}
});

test('real meeting screen starts automatic upload after a host stops recording', async ({ page }) => {
  test.skip(process.env.YLAAM_RECORDING_LOCAL_E2E !== '1','Requires the isolated disposable local fixture.');
  test.setTimeout(90000);
  const require=createRequire(import.meta.url);
  const postgres=require('../../backend/node_modules/postgres') as typeof import('../../backend/node_modules/postgres');
  const sql=postgres(database,{max:1});
  try {
    const [identity]=await sql`select current_database() as name,inet_server_addr()::text as host,inet_server_port() as port`;
    expect(identity.name).toBe('ylaam_staging_disposable_5d3_e2e');expect(identity.host).toBe('127.0.0.1/32');expect(identity.port).toBe(55454);
    await sql`insert into meetings(id,meeting_code,title,host_user_id) values('00000000-0000-4000-8000-000000000106','YLM-FULL23','Real screen test',${owner})`;
    await sql`insert into meeting_participants(meeting_id,user_id,role,admission) values('00000000-0000-4000-8000-000000000106',${owner},'host','admitted')`;
    await page.routeWebSocket('**/api/whiteboard',()=>{});
    await page.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:`${backend}${url.pathname.replace(/^\/api/,'')}${url.search}`});await route.fulfill({response});});
    await page.addInitScript(({jwt,ownerId})=>{
      localStorage.setItem('ylaam_meet_token',jwt);localStorage.setItem('ylaam_meet_user',JSON.stringify({id:ownerId,email:'host@example.invalid',fullName:'Test Host'}));
      Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:async()=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;return canvas.captureStream(15);}});
      class Recorder {
        static isTypeSupported(type:string){return type.startsWith('video/webm');}
        state='inactive';mimeType='video/webm';ondataavailable:((event:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;
        start(){this.state='recording';this.ondataavailable?.({data:new Blob(['screen-'],{type:this.mimeType})});}
        pause(){this.state='paused';}resume(){this.state='recording';}
        stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['bytes'],{type:this.mimeType})});this.onstop?.();}
      }
      Object.defineProperty(window,'MediaRecorder',{value:Recorder});
    },{jwt:token(owner,session),ownerId:owner});
    await page.goto('/meet/YLM-FULL23');
    const displayName=page.getByLabel('Your Display Name');
    if(await displayName.count())await displayName.fill('Test Host');
    await page.getByRole('button',{name:'Join Meeting Now',exact:true}).click();
    await page.getByRole('button',{name:'Show meeting toolbar',exact:true}).click();
    await page.getByRole('button',{name:'Start recording',exact:true}).click();
    await expect(page.getByRole('button',{name:'Pause recording',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Pause recording',exact:true}).click();
    await page.getByRole('button',{name:'Resume recording',exact:true}).click();
    await page.getByRole('button',{name:'Stop recording',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Host recordings'});
    await expect(dialog.getByText('Saved to company Drive and available in Meeting History')).toBeVisible({timeout:60000});
    const [row]=await sql`select j.state,count(h.id)::int as history from company_recording_upload_jobs j join meeting_history_items h on h.meeting_id=j.meeting_id where j.meeting_id='00000000-0000-4000-8000-000000000106' group by j.id`;
    expect(row).toMatchObject({state:'completed',history:1});
  } finally {await sql.end();}
});

test('encrypted local recording resumes the same job after the browser tab closes', async ({ page, context }) => {
  test.skip(process.env.YLAAM_RECORDING_LOCAL_E2E !== '1','Requires the isolated disposable local fixture.');
  test.setTimeout(120000);
  const require=createRequire(import.meta.url);
  const postgres=require('../../backend/node_modules/postgres') as typeof import('../../backend/node_modules/postgres');
  const sql=postgres(database,{max:1});
  let release!:()=>void, accepted!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  const acknowledged=new Promise<void>(resolve=>{accepted=resolve;});
  let held=false;
  try {
    const [identity]=await sql`select current_database() as name,inet_server_addr()::text as host,inet_server_port() as port`;
    expect(identity.name).toBe('ylaam_staging_disposable_5d3_e2e');expect(identity.host).toBe('127.0.0.1/32');expect(identity.port).toBe(55454);
    await sql`update meetings set recording_folder_id=null where id=${meeting}`;
    await context.route('**/integration-recording*',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
      await import('/e2e/fixtures/company-upload-integration-harness.tsx');</script>`}));
    await context.route('**/api/**',async route=>{
      const url=new URL(route.request().url());const response=await route.fetch({url:`${backend}${url.pathname.replace(/^\/api/,'')}${url.search}`});
      if(url.pathname.endsWith('/chunks')&&!held){held=true;accepted();await hold;try{await route.fulfill({response});}catch{return;}return;}
      await route.fulfill({response});
    });
    await context.addInitScript(({jwt,ownerId})=>{
      localStorage.setItem('ylaam_meet_token',jwt);localStorage.setItem('ylaam_meet_user',JSON.stringify({id:ownerId,email:'host@example.invalid',fullName:'Test Host'}));
      class Recorder {
        static isTypeSupported(type:string){return type.startsWith('video/webm');}
        state='inactive';mimeType='video/webm';ondataavailable:((event:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;
        start(){this.state='recording';this.ondataavailable?.({data:new Blob(['canonical-'],{type:this.mimeType})});}
        pause(){this.state='paused';}resume(){this.state='recording';}
        stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['bytes'],{type:this.mimeType})});this.onstop?.();}
      }
      Object.defineProperty(window,'MediaRecorder',{value:Recorder});
    },{jwt:token(owner,session),ownerId:owner});
    await page.goto('/integration-recording');
    await page.getByRole('button',{name:'Enable encrypted recovery'}).click();
    await page.getByRole('button',{name:'Start',exact:true}).click();await expect(page.getByTestId('state')).toHaveText('recording');
    await page.getByRole('button',{name:'Stop',exact:true}).click();
    await expect(page.getByText('Encrypted recording saved on this device.')).toBeVisible();
    const recordingId=await page.evaluate(()=>((window as unknown as {latestRecordingPreview:{recordingId:string}}).latestRecordingPreview.recordingId));
    await Promise.race([acknowledged,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Chunk was not staged')),30000))]);
    await page.close();release();
    const reopened=await context.newPage();await reopened.goto('/integration-recording');
    await reopened.getByRole('button',{name:'Local Recordings',exact:true}).click();
    await reopened.getByRole('button',{name:'Unlock',exact:true}).click();
    await reopened.getByLabel('Recovery passphrase').fill('disposable-recovery-passphrase');
    await reopened.getByRole('button',{name:'Review recording'}).click();
    await reopened.getByRole('button',{name:'Resume company upload'}).click();
    await expect(reopened.getByText('Saved to company Drive and available in Meeting History')).toBeVisible({timeout:60000});
    const [row]=await sql`select count(*)::int as jobs,min(state) as state from company_recording_upload_jobs where recording_id=${recordingId}`;
    expect(row).toEqual({jobs:1,state:'completed'});
    const [counts]=await sql`select (select count(*)::int from meeting_history_items where dedupe_key=${'company-drive:'+recordingId}) as history,(select count(*)::int from local_recording_staging.chunks c join local_recording_staging.recordings r on r.id=c.staging_id join company_recording_upload_jobs j on j.id=r.source_job_id where j.recording_id=${recordingId}) as chunks`;
    expect(counts).toEqual({history:1,chunks:1});
  } finally {release();await sql.end();}
});
