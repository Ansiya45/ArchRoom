import { test, expect } from './fixtures/auth-mock';

const token = 'x'.repeat(43);
test('public registration uses a token-bound POST and reports email verification separately', async ({ page }) => {
  const calls: any[] = [];
  await page.route('**/api/batchRegistration.*', async route => {
    const url = new URL(route.request().url()), path = url.pathname.slice('/api/'.length);
    expect(route.request().method()).toBe('POST');expect(url.search).not.toContain(token);
    const inputs=route.request().postDataJSON();
    const results=path.split(',').map((procedure,index)=>{
      const input=inputs[index];calls.push({path:procedure,input});
      const data=procedure.endsWith('identify')?{batchName:'Training Batch'}:{message:'Check your email to verify. Manager approval is still required.'};
      return {result:{data}};
    });
    await route.fulfill({contentType:'application/json',body:JSON.stringify(results)});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/batch/register#${token}`);
  await expect(page.getByText('Training Batch',{exact:true})).toBeVisible();
  expect(page.url()).not.toContain(token);
  await page.getByLabel('Name',{exact:true}).fill('Student');await page.getByLabel('Email',{exact:true}).fill('student@example.invalid');
  await page.getByRole('button',{name:'Request email verification'}).click();
  await expect(page.getByRole('status')).toContainText('Manager approval is still required');
  expect(calls.find(call=>call.path.endsWith('register')).input).toEqual({token,name:'Student',email:'student@example.invalid'});
  await expect(page.getByText(/This does not create a sign-in account/)).toBeVisible();
  expect(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('opening a verification link does not consume it until the student confirms', async ({ page }) => {
  let calls=0;
  await page.route('**/api/batchRegistration.verify*',async route=>{
    calls++;expect(route.request().postDataJSON()['0']).toEqual({token});
    await route.fulfill({contentType:'application/json',body:JSON.stringify([{result:{data:{message:'Email verified. Manager approval is required for pending enrollment.'}}}])});
  });
  await page.goto(`/batch/verify#${token}`);
  const button=page.getByRole('button',{name:'Verify email',exact:true});await expect(button).toBeVisible();expect(calls).toBe(0);
  await button.click();await expect(page.getByRole('status')).toContainText('Manager approval is required');expect(calls).toBe(1);
  await expect(button).toHaveCount(0);expect(page.url()).not.toContain(token);
});

test('invalid and expired registration links expose no student details', async ({ page }) => {
  await page.goto('/batch/register#bad');await expect(page.getByRole('alert')).toContainText('Invalid link');await expect(page.getByLabel('Email',{exact:true})).toHaveCount(0);
  await page.route('**/api/batchRegistration.identify*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([{error:{message:'Expired',code:-32600,data:{code:'BAD_REQUEST',httpStatus:400}}}])}));
  await page.goto(`/batch/register#${token}`);await expect(page.getByRole('alert')).toContainText('unavailable or expired');await expect(page.getByLabel('Email',{exact:true})).toHaveCount(0);
});

test('expired or reused verification tokens show a recoverable error without success',async({page})=>{
  await page.route('**/api/batchRegistration.verify*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([{error:{message:'Used',code:-32600,data:{code:'BAD_REQUEST',httpStatus:400}}}])}));
  await page.goto(`/batch/verify#${token}`);await page.getByRole('button',{name:'Verify email',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('expired, disabled, or already used');await expect(page.getByRole('status')).toHaveCount(0);
});
