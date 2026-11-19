import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, login, type AuthMock } from './fixtures/auth-mock';

const batch = 'batchFolder001';
async function setup(page: Page, auth: AuthMock, allowed = true) {
  auth.driveConnected = true;
  auth.recordingFolders = [{ id: batch, name: 'Batch A' }, { id: 'batchFolder002', name: 'Batch B' }];
  auth.editableMeeting = { id: randomUUID(), title: 'Training', meetingCode: 'YLM-ABC234', hostUserId: auth.user.id,
    status: 'scheduled', scheduleType: 'one_time', scheduledAt: '2026-12-29T05:00:00.000Z', timeZone: 'Asia/Calcutta',
    recordingFolderId: null, recordingAccessPolicy: 'private', createdAt: '2026-11-01T05:00:00.000Z' };
  const state = { allowed, fail: false, students: [] as any[], calls: [] as { path: string; input: any }[] };
  await page.route(/\/api\/recordingFolders\.(listStudents|addStudent|approveStudent|removeStudent)/, async route => {
    const url = new URL(route.request().url());
    const paths = url.pathname.slice('/api/'.length).split(',');
    const inputs = route.request().method() === 'POST' ? route.request().postDataJSON() : JSON.parse(url.searchParams.get('input') ?? '{}');
    const results = paths.map((path, index) => {
      const input = url.searchParams.get('batch') === '1' ? inputs[index] : inputs;
      state.calls.push({ path, input });
      if (!state.allowed || input.folderId !== batch || state.fail) return { error: { message: 'Unavailable', code: -32003,
        data: { code: state.fail ? 'INTERNAL_SERVER_ERROR' : 'FORBIDDEN', httpStatus: state.fail ? 500 : 403, path } } };
      if (path.endsWith('listStudents')) return { result: { data: { students: state.students, events: [] } } };
      if (path.endsWith('addStudent')) state.students.push({ id: randomUUID(), studentName: input.name, studentEmail: input.email,
        status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), removedAt: null });
      else {
        const student = state.students.find(student => student.id === input.enrollmentId);
        student.status = path.endsWith('approveStudent') ? 'approved' : 'removed';
        student.updatedAt = new Date().toISOString(); student.removedAt = student.status === 'removed' ? new Date().toISOString() : null;
      }
      return { result: { data: state.students.at(-1) } };
    });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.get('batch') === '1' ? results : results[0]) });
  });
  await login(page, auth);
  await page.getByRole('complementary').getByRole('button', { name: 'Scheduled Meetings' }).click();
  await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reschedule Meeting' });
  await dialog.getByRole('button', { name: /Settings Recording preview/ }).click();
  await dialog.getByLabel('Select batch/course folder').selectOption(batch);
  return { state, dialog };
}

test('manager adds, approves, confirms removal and reapproves without submitting the meeting', async ({ page, authMock }) => {
  const { state, dialog } = await setup(page, authMock);
  await dialog.getByRole('button', { name: 'Students', exact: true }).click();
  const panel = dialog.getByRole('region', { name: 'Students — Batch A' });
  await expect(panel.getByText('No students enrolled in this batch.')).toBeVisible();
  await panel.getByLabel('Student name').fill('Ada Student');
  await panel.getByLabel('Student email').fill('ada@example.invalid');
  await panel.getByLabel('Student email').press('Enter');
  await expect(panel.getByText('ada@example.invalid', { exact: true })).toBeVisible();
  expect(authMock.rescheduleCalls).toHaveLength(0);
  await panel.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(panel.getByText(/Status: approved/)).toBeVisible();
  await panel.getByRole('button', { name: 'Remove', exact: true }).click();
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(state.calls.filter(call => call.path.endsWith('removeStudent'))).toHaveLength(0);
  await panel.getByRole('button', { name: 'Remove', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirm removal' }).click();
  await expect(panel.getByText(/Status: removed/)).toBeVisible();
  await panel.getByRole('button', { name: 'Reapprove', exact: true }).click();
  await expect(panel.getByText(/Status: approved/)).toBeVisible();
  await expect(panel.getByText(/Enrollment does not verify a Google account/)).toBeVisible();
  for (const element of await panel.locator('button,input,li').all()) expect(await element.evaluate(el => getComputedStyle(el).borderRadius)).toBe('8px');
  // Empty required student inputs are detached from the existing meeting form.
  await dialog.getByRole('button', { name: 'Save Schedule', exact: true }).click();
  await expect.poll(() => authMock.rescheduleCalls.length).toBe(1);
});

for (const role of ['trainer', 'viewer', 'unrelated manager']) test(`${role} cannot see Students controls or email lists`, async ({ page, authMock }) => {
  const { state, dialog } = await setup(page, authMock, false);
  await expect.poll(() => state.calls.length).toBeGreaterThan(0);
  await expect(dialog.getByText('Checking student management access…')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Students', exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Student email')).toHaveCount(0);
});

test('administrator can manage a batch; switching batches clears student details', async ({ page, authMock }) => {
  authMock.driveAdmin = true;
  const { dialog } = await setup(page, authMock);
  await dialog.getByRole('button', { name: 'Students', exact: true }).click();
  await dialog.getByLabel('Student name').fill('Private draft');
  await dialog.getByLabel('Select batch/course folder').selectOption('batchFolder002');
  await expect(dialog.getByRole('button', { name: 'Hide Students' })).toHaveCount(0);
  await expect(dialog.locator('input[value="Private draft"]')).toHaveCount(0);
});

test('list error clears private data, supports retry, and session removal hides controls', async ({ page, authMock }) => {
  const { state, dialog } = await setup(page, authMock);
  await dialog.getByRole('button', { name: 'Students', exact: true }).click();
  state.fail = true;
  await dialog.getByRole('button', { name: 'Refresh students' }).click();
  await expect(dialog.getByText(/Student management is unavailable/)).toBeVisible();
  await expect(dialog.getByLabel('Student email')).toHaveCount(0);
  state.fail = false;
  await dialog.getByRole('button', { name: 'Retry student access' }).click();
  await expect(dialog.getByRole('button', { name: 'Students', exact: true })).toBeVisible();
  await page.evaluate(() => { localStorage.removeItem('ylaam_meet_token'); window.dispatchEvent(new Event('ylaam-session-removed')); });
  await expect(page.getByRole('button', { name: 'Students', exact: true })).toHaveCount(0);
});

test('permission denial during approval clears student emails and management controls', async ({ page, authMock }) => {
  const { state, dialog } = await setup(page, authMock);
  await dialog.getByRole('button', { name: 'Students', exact: true }).click();
  await dialog.getByLabel('Student name').fill('Private student');
  await dialog.getByLabel('Student email').fill('private@example.invalid');
  await dialog.getByRole('button', { name: 'Add Student', exact: true }).click();
  await expect(dialog.getByText('private@example.invalid', { exact: true })).toBeVisible();
  state.allowed = false;
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog.getByText(/Student management access is no longer available/)).toBeVisible();
  await expect(dialog.getByText('private@example.invalid', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});

test('Students section works with keyboard on a narrow screen', async ({ page, authMock }) => {
  const { dialog } = await setup(page, authMock);
  // Existing login helper targets the desktop navigation; resize the component under test after login.
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = dialog.getByRole('button', { name: 'Students', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  const panel = dialog.getByRole('region', { name: 'Students — Batch A' });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('Student name')).toBeVisible();
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('manager generates, copies, regenerates and disables a registration link',async({page,authMock})=>{
  let active=false, generation=0,disabled=0;
  await page.route('**/api/batchRegistration.*',async route=>{
    const results=new URL(route.request().url()).pathname.split(',').map(path=>{
      let data:unknown;
      if(path.endsWith('generateLink')) { active=true;generation++;data={registrationUrl:`http://localhost/batch/register#${String(generation).repeat(43)}`,expiresAt:'2026-12-01T00:00:00.000Z'}; }
      else if(path.endsWith('disableLink')) {active=false;disabled++;data={ok:true};}
      else data={active,expiresAt:active?'2026-12-01T00:00:00.000Z':null};
      return {result:{data}};
    });
    await route.fulfill({contentType:'application/json',body:JSON.stringify(results)});
  });
  const {dialog}=await setup(page,authMock);await dialog.getByRole('button',{name:'Students',exact:true}).click();
  const panel=dialog.getByRole('region',{name:'Batch registration link'});
  await panel.getByRole('button',{name:'Generate registration link',exact:true}).click();
  await expect(panel.getByLabel('Registration link',{exact:true})).toHaveValue(`http://localhost/batch/register#${'1'.repeat(43)}`);
  await panel.getByRole('button',{name:'Copy Registration Link'}).click();
  await expect(panel.getByRole('status')).toContainText(/copied|Select the link/);
  page.on('dialog',dialog=>void dialog.accept());
  await panel.getByRole('button',{name:'Regenerate registration link'}).click();
  await expect(panel.getByLabel('Registration link',{exact:true})).toHaveValue(`http://localhost/batch/register#${'2'.repeat(43)}`);
  await panel.getByRole('button',{name:'Disable registration link'}).click();
  await expect(panel.getByText('No active registration link.')).toBeVisible();expect(disabled).toBe(1);
});

test('public registration cannot be approved in the UI until email verification',async({page,authMock})=>{
  const {state,dialog}=await setup(page,authMock);
  state.students.push({id:randomUUID(),studentName:'Applicant',studentEmail:'applicant@example.invalid',source:'registration',emailVerifiedAt:null,status:'pending',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),removedAt:null});
  await dialog.getByRole('button',{name:'Students',exact:true}).click();await dialog.getByRole('button',{name:'Refresh students'}).click();
  await expect(dialog.getByText('Email submitted — awaiting verification',{exact:false})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Approve',exact:true})).toBeDisabled();
  state.students[0].emailVerifiedAt=new Date().toISOString();await dialog.getByRole('button',{name:'Refresh students'}).click();
  await expect(dialog.getByRole('button',{name:'Approve',exact:true})).toBeEnabled();
});
