import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const backendRequire = createRequire(new URL('../../../backend/package.json', import.meta.url));
const postgres = backendRequire('postgres') as typeof import('../../../backend/node_modules/postgres');
const bcrypt = backendRequire('bcryptjs') as typeof import('../../../backend/node_modules/bcryptjs');

export function signupSettings() {
  const values = parse(readFileSync(new URL('../../.env.e2e.local', import.meta.url)));
  return {
    email: (process.env.E2E_SIGNUP_EMAIL || values.E2E_SIGNUP_EMAIL || '').trim().toLowerCase(),
    password: process.env.E2E_SIGNUP_PASSWORD || values.E2E_SIGNUP_PASSWORD,
  };
}

// Inspection only; the browser/backend performs signup. Never print rows/hashes.
export async function inspectSignup(email: string) {
  const backend = parse(readFileSync(new URL('../../../backend/.env', import.meta.url)));
  const sql = postgres(backend.DATABASE_URL, { max: 1, connect_timeout: 10, idle_timeout: 1 });
  try {
    return await sql.begin('read only', async tx => {
      const rows = await tx`select id, email, full_name, password_hash, email_verified_at, created_at, updated_at from users where email = ${email}`;
      if (!rows.length) return null;
      const user = rows[0];
      const codes = await tx`select id, purpose, code_hash, expires_at from auth_codes where user_id = ${user.id} order by created_at desc`;
      return { user, codes };
    });
  } catch { throw new Error('Read-only signup inspection failed; database details withheld.'); }
  finally { await sql.end({ timeout: 5 }); }
}

export async function securePassword(hash: string, password: string) {
  return hash !== password && /^\$2[aby]\$10\$/.test(hash) && await bcrypt.compare(password, hash);
}
