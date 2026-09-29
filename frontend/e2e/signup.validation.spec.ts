import { randomUUID } from 'node:crypto';
import { test, expect } from './fixtures/smoke';

async function open(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
}

test('signup form exposes required registration fields', async ({ page }) => {
  await open(page);
  await expect(page.getByPlaceholder('Jordan Miller')).toBeVisible();
  await expect(page.getByPlaceholder('name@company.com')).toBeVisible();
  await expect(page.locator('input[autocomplete="new-password"]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible();
});

for (const missing of ['name', 'email', 'password', 'confirmation']) {
  test(`signup requires ${missing} without submitting to the backend`, async ({ page }) => {
    await open(page);
    const inputs = {
      name: page.getByPlaceholder('Jordan Miller'), email: page.getByPlaceholder('name@company.com'),
      password: page.locator('input[autocomplete="new-password"]').nth(0),
      confirmation: page.locator('input[autocomplete="new-password"]').nth(1),
    };
    const password = `Aa1-${randomUUID()}`;
    for (const [key, input] of Object.entries(inputs)) {
      if (key !== missing) await input.fill(key === 'name' ? 'YLAAM E2E validation' : key === 'email' ? `${randomUUID()}@example.invalid` : password);
    }
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    expect(await inputs[missing as keyof typeof inputs].evaluate((e: HTMLInputElement) => e.validity.valueMissing)).toBe(true);
  });
}

test('signup rejects malformed email without submitting', async ({ page }) => {
  await open(page);
  await page.getByPlaceholder('Jordan Miller').fill('YLAAM E2E validation');
  await page.getByPlaceholder('name@company.com').fill(randomUUID());
  for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(`Aa1-${randomUUID()}`);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  expect(await page.getByPlaceholder('name@company.com').evaluate((e: HTMLInputElement) => e.validity.typeMismatch)).toBe(true);
});

for (const requirement of ['length', 'uppercase', 'lowercase', 'digit']) {
  test(`signup enforces password ${requirement}`, async ({ page }) => {
    await open(page);
    await page.getByPlaceholder('Jordan Miller').fill('YLAAM E2E validation');
    await page.getByPlaceholder('name@company.com').fill(`${randomUUID()}@example.invalid`);
    const password = requirement === 'length' ? `Aa1${randomUUID().slice(0, 2)}` :
      requirement === 'uppercase' ? `a1-${randomUUID()}` :
      requirement === 'lowercase' ? `A1-${randomUUID().toUpperCase()}` :
      `Aa${randomUUID().replace(/[0-9-]/g, '')}abcdefgh`;
    for (const input of await page.locator('input[autocomplete="new-password"]').all()) await input.fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Use 8+ characters with uppercase, lowercase, and a number.');
  });
}

test('signup rejects password confirmation mismatch', async ({ page }) => {
  await open(page);
  await page.getByPlaceholder('Jordan Miller').fill('YLAAM E2E validation');
  await page.getByPlaceholder('name@company.com').fill(`${randomUUID()}@example.invalid`);
  await page.locator('input[autocomplete="new-password"]').nth(0).fill(`Aa1-${randomUUID()}`);
  await page.locator('input[autocomplete="new-password"]').nth(1).fill(`Aa1-${randomUUID()}`);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Passwords do not match.');
});
