import { test, expect } from '@playwright/test';

test('recovery lists only authorized host backups and retains interrupted data', async ({ page }) => {
  await page.route('**/backup-panel-harness', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/recording-backups-panel-harness.tsx');</script>` }));
  await page.route('**/api/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const batched = new URL(request.url()).searchParams.get('batch') === '1';
    const inputs = request.postDataJSON() as Record<string, unknown> | null;
    const paths = decodeURIComponent(path.split('/').pop()!).split(',');
    const results = paths.map((item, index) => {
      const denied = (JSON.stringify(batched ? inputs?.[index] : inputs) ?? '').includes('YLM-DENY');
      return denied ? { error: { message: 'Forbidden', code: -32003, data: { code: 'FORBIDDEN', httpStatus: 403 } } }
        : { result: { data: item === 'auth.me' ? { user: { id: 'host' } } : { ok: true } } };
    });
    return route.fulfill({ json: batched ? results : results[0] });
  });
  await page.goto('/backup-panel-harness');
  await page.evaluate(async () => {
    localStorage.setItem('ylaam_meet_token', 'test'); localStorage.setItem('ylaam_meet_user', JSON.stringify({ id: 'host' }));
    const path = '/src/lib/recordingBackup.ts'; const { RecordingBackupWriter } = await import(/* @vite-ignore */ path);
    for (const [id, ownerId, meetingCode] of [['allowed', 'host', 'YLM-OK'], ['denied', 'host', 'YLM-DENY'], ['other', 'other', 'YLM-OK']]) {
      const writer = await RecordingBackupWriter.create({ id, ownerId, meetingCode, meetingName: id, fileName: `${id}.webm`, mimeType: 'video/webm', startedAt: new Date().toISOString() }, () => {});
      writer.append(new Blob(['partial']));
      if (id !== 'allowed') await writer.finish(1);
    }
  });
  await expect.poll(() => page.evaluate(async () => { const path = '/src/lib/recordingBackup.ts'; return (await import(/* @vite-ignore */ path)).listRecordingBackups('host').then((rows: any[]) => rows.find(row => row.id === 'allowed')?.count); })).toBe(1);
  await page.getByRole('button', { name: 'Recover Recordings', exact: true }).click();
  const section = page.getByRole('region', { name: 'Recover Recordings' });
  await expect(section.getByText('allowed', { exact: false })).toBeVisible();
  await expect(section.getByText('denied', { exact: false })).toHaveCount(0);
  await expect(section.getByText('other', { exact: false })).toHaveCount(0);
  await section.getByRole('button', { name: 'Review backup' }).click();
  await expect(section.getByText('Partial recording — playback is not guaranteed.')).toBeVisible();
  await expect(section.getByRole('link', { name: 'Download backup' })).toBeVisible();
  await expect(section.getByRole('button', { name: /Upload/ })).toHaveCount(0);
});

test('completed browser backup uses the existing manual upload review and selected folder', async ({ page }) => {
  const owner='11111111-1111-4111-8111-111111111111', meeting='22222222-2222-4222-8222-222222222222', recording='33333333-3333-4333-8333-333333333333';
  const first='folderAAAAAAAAAAAAAA', second='folderBBBBBBBBBBBBBB'; let jobs=0;
  await page.route('**/backup-panel-harness', route => route.fulfill({ contentType:'text/html',body:`<div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/e2e/fixtures/recording-backups-panel-harness.tsx');</script>` }));
  await page.route('**/api/**', route => {
    const req=route.request(), url=new URL(req.url()), paths=decodeURIComponent(url.pathname.split('/').pop()!).split(',');
    const results=paths.map(path=>{
      if(path==='recordings.createCompanyJob') { jobs++; return {error:{message:'Synthetic stop',code:-32603,data:{code:'INTERNAL_SERVER_ERROR',httpStatus:500}}}; }
      const data=path==='auth.me'?{user:{id:owner}}:path==='meetings.getByCode'?{meeting:{id:meeting,recordingFolderId:first}}:
        path==='recordingFolders.list'?{connected:true,folders:[{id:first,name:'Folder A'},{id:second,name:'Folder B'}]}:
        path==='recordings.companyUploadCapability'?{available:true}:path==='recordings.getForMeeting'?{recordings:[]}:
        path==='recordings.verifiedCompanyRecording'?null:{ok:true};
      return {result:{data}};
    });
    return route.fulfill({json:url.searchParams.get('batch')==='1'?results:results[0]});
  });
  await page.goto('/backup-panel-harness');
  await page.evaluate(async ({owner,meeting,recording})=>{
    localStorage.setItem('ylaam_meet_token','test');localStorage.setItem('ylaam_meet_user',JSON.stringify({id:owner}));
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d')!;
    context.fillStyle='red';context.fillRect(0,0,160,90);
    const stream=canvas.captureStream(10), recorder=new MediaRecorder(stream,{mimeType:'video/webm'}), chunks:Blob[]=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.start();await new Promise(resolve=>setTimeout(resolve,700));
    await new Promise<void>(resolve=>{recorder.onstop=()=>resolve();recorder.stop();});stream.getTracks().forEach(track=>track.stop());
    const path='/src/lib/recordingBackup.ts', store=await import(/* @vite-ignore */ path);
    const writer=await store.RecordingBackupWriter.create({id:recording,ownerId:owner,meetingId:meeting,meetingCode:'YLM-TEST',meetingName:'Completed meeting',fileName:'meeting.webm',mimeType:'video/webm',startedAt:new Date().toISOString()},()=>{});
    chunks.forEach(chunk=>writer.append(chunk));if(!await writer.finish(1))throw new Error('backup failed');
  },{owner,meeting,recording});
  await page.getByRole('button',{name:'Recover Recordings',exact:true}).click();
  await page.getByRole('button',{name:'Review backup'}).click();
  await page.getByRole('button',{name:'Open upload review'}).click();
  const dialog=page.getByRole('dialog',{name:'Host recordings'}), folder=dialog.getByLabel('Company Drive destination');
  await expect(folder).toHaveValue(first);expect(jobs).toBe(0);
  await folder.selectOption(second);expect(jobs).toBe(0);
  await dialog.getByRole('button',{name:'Upload to Drive'}).click();
  await expect.poll(()=>jobs).toBe(1);
});
