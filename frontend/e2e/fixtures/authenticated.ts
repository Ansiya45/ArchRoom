import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base } from '@playwright/test';

// Foundation only: no current spec imports this fixture and it never logs in,
// registers accounts, sends verification mail, or seeds a database.
// Future authenticated specs must use an isolated test backend/account.
export const authenticatedTest = base.extend({
  storageState: async ({}, use) => {
    const statePath = process.env.E2E_AUTH_STORAGE_STATE;
    if (!statePath) throw new Error('Set E2E_AUTH_STORAGE_STATE to an isolated test account storage-state file.');
    const absolutePath = resolve(statePath);
    if (!existsSync(absolutePath)) throw new Error('E2E_AUTH_STORAGE_STATE file does not exist.');
    await use(absolutePath);
  },
});
export { expect } from '@playwright/test';
