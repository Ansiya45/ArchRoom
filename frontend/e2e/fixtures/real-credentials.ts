import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

export function realCredentials() {
  const file = fileURLToPath(new URL('../../.env.e2e.local', import.meta.url));
  let values: Record<string, string>;
  try { values = parse(readFileSync(file)); }
  catch { throw new Error('Create frontend/.env.e2e.local with the three E2E credential variables.'); }
  const required = (key: string) => {
    const value = process.env[key] || values[key];
    if (!value?.trim()) throw new Error(`Missing ${key} in the E2E environment.`);
    return value;
  };
  const email = required('E2E_TEST_EMAIL').trim().toLowerCase();
  const password = required('E2E_TEST_PASSWORD');
  const nonexistent = required('E2E_NONEXISTENT_EMAIL').trim().toLowerCase();
  if (email === nonexistent) throw new Error('E2E_NONEXISTENT_EMAIL must differ from the test account.');
  return { email, password, nonexistent };
}
