import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DOTENV_CONFIG_PATH = 'tests/.nonexistent-signup-password-env';
process.env.DATABASE_URL = 'postgres://localhost:5432/unused';
process.env.JWT_SECRET = 'signup-policy-unit-test-only';
const { AuthService } = await import('../src/services/auth.service.js');
const { authRouter } = await import('../src/routers/auth.js');

const message = 'Use 8+ characters with uppercase, lowercase, and a number.';
for (const [requirement, password] of [
  ['required password', ''],
  ['minimum length', 'Abcdef1'],
  ['uppercase', 'abcdefg1'],
  ['lowercase', 'ABCDEFG1'],
  ['digit', 'Abcdefgh'],
  ['frontend line-break semantics', 'Abcdef1\ng'],
] as const) {
  test(`signup API rejects missing ${requirement} before calling the service`, async () => {
    const original = AuthService.prototype.signup;
    let calls = 0;
    AuthService.prototype.signup = async () => { calls++; throw new Error('Service must not run'); };
    try {
      const caller = authRouter.createCaller({ user: null } as never);
      await assert.rejects(caller.signup({ fullName: 'Policy Test', email: 'policy@example.invalid', password }),
        (error: any) => error.code === 'BAD_REQUEST' && error.message.includes(message));
      assert.equal(calls, 0, 'Invalid input must never reach database/email work');
    } finally { AuthService.prototype.signup = original; }
  });
}

test('signup API accepts a minimum-length password without requiring symbols and passes it unchanged', async () => {
  const original = AuthService.prototype.signup;
  const input = { fullName: 'Policy Test', email: 'policy@example.invalid', password: 'Abcdefg1' };
  let calls = 0;
  AuthService.prototype.signup = async received => {
    calls++;
    assert.deepEqual(received, input);
    return { ok: true, verificationRequired: true, email: received.email };
  };
  try {
    const caller = authRouter.createCaller({ user: null } as never);
    assert.deepEqual(await caller.signup(input), { ok: true, verificationRequired: true, email: input.email });
    assert.equal(calls, 1);
  } finally { AuthService.prototype.signup = original; }
});
