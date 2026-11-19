import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import { newGoogleIdentityChallenge, verifyGoogleIdentityProof } from '../src/services/google-identity-proof.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: 'mock-key', alg: 'RS256', use: 'sig' }];
const nonce = newGoogleIdentityChallenge().nonce;
const claims = { iss: 'https://accounts.google.com', aud: 'student-client', sub: 'google-subject',
  email: 'Student@example.com', email_verified: true, nonce, iat: 1000, exp: 1600 };
function token(changes = {}, headerChanges = {}) {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'mock-key', ...headerChanges })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...claims, ...changes })).toString('base64url');
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
}
const check = (idToken: string, overrides = {}) => verifyGoogleIdentityProof({ idToken, keys, nonce,
  audience: 'student-client', nowSeconds: 1100, ...overrides });

test('generates independent state, nonce and S256 PKCE challenges', () => {
  const a = newGoogleIdentityChallenge(), b = newGoogleIdentityChallenge();
  assert.notEqual(a.state, b.state); assert.notEqual(a.nonce, b.nonce); assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.state, a.nonce);
  assert.equal(a.challenge, createHash('sha256').update(a.verifier).digest('base64url'));
  assert.equal(a.method, 'S256');
});
test('validates a signed Google identity proof without returning provider tokens', () => {
  assert.deepEqual(check(token()), { subject: 'google-subject', email: 'student@example.com', issuer: 'https://accounts.google.com' });
  assert.equal(check(token({ iss: 'accounts.google.com' })).subject, 'google-subject');
});
test('rejects incorrect issuer, audience, nonce, time and unverified claims', () => {
  for (const change of [{ iss: 'https://attacker.invalid' }, { aud: 'company-drive-client' }, { aud: ['student-client'] },
    { azp: 'other-client' }, { nonce: newGoogleIdentityChallenge().nonce }, { exp: 1100 }, { iat: 1161 }, { iat: 499 },
    { nbf: 1101 }, { email_verified: false }, { email_verified: 'true' }, { sub: '' }, { email: 'invalid' }]) {
    assert.throws(() => check(token(change)), /Google identity proof is invalid/);
  }
});
test('rejects algorithm confusion, attacker-controlled keys and ambiguous key selection', () => {
  for (const change of [{ alg: 'none' }, { alg: 'HS256' }, { kid: 'unknown' }, { jku: 'https://attacker.invalid' },
    { jwk: keys[0] }, { x5u: 'https://attacker.invalid' }, { crit: ['x'] }]) assert.throws(() => check(token({}, change)));
  assert.throws(() => check(token(), { keys: [] }));
  assert.throws(() => check(token(), { keys: [...keys, ...keys] }));
});
test('rejects tampered signatures and malformed or oversized tokens with sanitized errors', () => {
  const parts = token().split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: 'other-person' })).toString('base64url');
  for (const value of [parts.join('.'), '', 'a.b.c', 'x'.repeat(16385)])
    assert.throws(() => check(value), { message: 'Google identity proof is invalid.' });
});
