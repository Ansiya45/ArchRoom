import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('only exact verified recording evidence deletes the matching completed backup', async ({ page }) => {
  const owner='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222', meeting='33333333-3333-4333-8333-333333333333';
  const bytes='canonical recording bytes', digest=createHash('sha256').update(bytes).digest('hex');
  let confirmation:any = { verified:true,recordingId:id,ownerId:owner,meetingId:meeting,occurrenceId:null,jobId:'job',historyId:'history',
    driveFileId:'file1234567890',destinationFolderId:'folder1234567890',destinationIsRoot:false,
    historyUrl:'https://drive.google.com/file/d/file1234567890/view',byteLength:bytes.length,sha256:digest,mimeType:'video/webm' };
  await page.route('**/api/**', route => {
    const req=route.request(), url=new URL(req.url()), paths=decodeURIComponent(url.pathname.split('/').pop()!).split(',');
    const results=paths.map(path=>({result:{data:path==='auth.me'?{user:{id:owner}}:confirmation}}));
    return route.fulfill({json:url.searchParams.get('batch')==='1'?results:results[0]});
  });
  await page.goto('/e2e/fixtures/recording-backup.html');
  await page.evaluate(async ({owner,id,meeting,bytes})=>{
    localStorage.setItem('ylaam_meet_token','test');localStorage.setItem('ylaam_meet_user',JSON.stringify({id:owner}));
    const path='/src/lib/recordingBackup.ts';const store=await import(/* @vite-ignore */ path);
    const writer=await store.RecordingBackupWriter.create({id,ownerId:owner,meetingId:meeting,meetingCode:'YLM-TEST',meetingName:'Test',fileName:'test.webm',mimeType:'video/webm',startedAt:new Date().toISOString()},()=>{});
    writer.append(new Blob([bytes]));if(!await writer.finish(3))throw new Error('backup failed');
    await store.recordBackupUploadIntent(owner,id,'folder1234567890');
    const unrelated=await store.RecordingBackupWriter.create({id:'55555555-5555-4555-8555-555555555555',ownerId:owner,meetingId:meeting,meetingCode:'YLM-TEST',meetingName:'Other',fileName:'other.webm',mimeType:'video/webm',startedAt:new Date().toISOString()},()=>{});
    unrelated.append(new Blob(['other']));if(!await unrelated.finish(1))throw new Error('backup failed');
  },{owner,id,meeting,bytes});
  const reconcile=()=>page.evaluate(async ({owner,id})=>{const path='/src/lib/recordingBackupCleanup.ts';return (await import(/* @vite-ignore */ path)).reconcileConfirmedBackup(owner,id);},{owner,id});
  confirmation={...confirmation,destinationFolderId:'wrongFolder12345'};expect(await reconcile()).toBe(false);
  confirmation={...confirmation,destinationFolderId:'folder1234567890',sha256:'f'.repeat(64)};expect(await reconcile()).toBe(false);
  confirmation={...confirmation,sha256:digest,meetingId:'44444444-4444-4444-8444-444444444444'};expect(await reconcile()).toBe(false);
  confirmation={...confirmation,meetingId:meeting,ownerId:'other'};expect(await reconcile()).toBe(false);
  await page.reload();
  confirmation={...confirmation,ownerId:owner};expect(await reconcile()).toBe(true);
  expect(await reconcile()).toBe(false);
  const remaining=await page.evaluate(async owner=>{const path='/src/lib/recordingBackup.ts';return (await import(/* @vite-ignore */ path)).listRecordingBackups(owner);},owner);
  expect(remaining.map((row: {id:string})=>row.id)).toEqual(['55555555-5555-4555-8555-555555555555']);
});
