import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DOTENV_CONFIG_PATH = 'tests/.unused-google-start-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'mock-oauth-start-secret';
const { oauthStateCookie, startGoogleOAuthFromNavigation } = await import('../src/services/google-drive-oauth-start.service.js');

const administratorId = '11111111-1111-4111-8111-111111111111';
const managerId = '22222222-2222-4222-8222-222222222222';
const allowed = new Set(['https://meet.ylaam.com']);
const payload = { sub: administratorId, sid: 'mock-active-session', email: 'admin@example.invalid' };

test('top-level setup requires the allowed frontend origin, administrator JWT and active session', async () => {
  const calls: Array<[string, string]> = [];
  const oauth = { start: (userId: string, sessionId: string) => {
    calls.push([userId, sessionId]); return { authorizationUrl: 'https://accounts.google.invalid/mock', cookie: 'synthetic-state-cookie' };
  } };
  const verify = () => payload;
  const active = async () => true;
  assert.deepEqual(await startGoogleOAuthFromNavigation('synthetic-jwt', 'https://meet.ylaam.com', allowed, administratorId,
    oauth, verify, active), { authorizationUrl: 'https://accounts.google.invalid/mock', cookie: 'synthetic-state-cookie' });
  assert.deepEqual(calls, [[administratorId, payload.sid]]);
  await assert.rejects(startGoogleOAuthFromNavigation('synthetic-jwt', 'https://evil.invalid', allowed, administratorId, oauth, verify, active), { code: 'FORBIDDEN' });
  await assert.rejects(startGoogleOAuthFromNavigation(null, 'https://meet.ylaam.com', allowed, administratorId, oauth, verify, active), { code: 'FORBIDDEN' });
  await assert.rejects(startGoogleOAuthFromNavigation('synthetic-jwt', 'https://meet.ylaam.com', allowed, administratorId, oauth,
    () => ({ ...payload, sub: managerId }), active), { code: 'FORBIDDEN' });
  await assert.rejects(startGoogleOAuthFromNavigation('synthetic-jwt', 'https://meet.ylaam.com', allowed, undefined, oauth, verify, active), { code: 'FORBIDDEN' });
  await assert.rejects(startGoogleOAuthFromNavigation('synthetic-jwt', 'https://meet.ylaam.com', allowed, administratorId, oauth,
    () => ({ ...payload, sid: undefined }), active), { code: 'UNAUTHORIZED' });
  await assert.rejects(startGoogleOAuthFromNavigation('synthetic-jwt', 'https://meet.ylaam.com', allowed, administratorId, oauth,
    verify, async () => false), { code: 'UNAUTHORIZED' });
  assert.equal(calls.length, 1);
});

test('state cookie stays HttpOnly, short-lived, host-only and scoped to callback', () => {
  const secure = oauthStateCookie('synthetic-state-cookie', 'https://ylaam-meet.onrender.com/google-drive/oauth/callback');
  assert.match(secure, /^ylaam_drive_oauth=synthetic-state-cookie;/);
  assert.match(secure, /HttpOnly; SameSite=Lax; Max-Age=300; Path=\/google-drive\/oauth\/callback; Secure$/);
  assert.doesNotMatch(secure, /Domain=/);
  assert.match(oauthStateCookie('', 'https://ylaam-meet.onrender.com/google-drive/oauth/callback', true), /Max-Age=0/);
  assert.doesNotMatch(oauthStateCookie('synthetic', 'http://127.0.0.1:3001/google-drive/oauth/callback'), /Secure/);
});
