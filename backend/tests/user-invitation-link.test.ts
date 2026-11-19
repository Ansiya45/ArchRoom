import test from 'node:test';
import assert from 'node:assert/strict';

// Supply only the required configuration before importing the service. These
// tests exercise URL construction and do not connect to the database.
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:1/unused';
process.env.JWT_SECRET ??= 'test-only';

const { userInvitationLink } = await import('../src/services/user-admin.service.js');

test('user invitation link is rooted at the configured public application URL', () => {
  assert.equal(
    userInvitationLink('https://meet.example.test/app', 'token-value'),
    'https://meet.example.test/app?invite=token-value',
  );
});

test('user invitation link preserves existing public URL parameters', () => {
  assert.equal(
    userInvitationLink('https://meet.example.test/?source=admin', 'token-value'),
    'https://meet.example.test/?source=admin&invite=token-value',
  );
});

test('user invitation creation fails closed when APP_PUBLIC_URL is unavailable', () => {
  assert.throws(
    () => userInvitationLink(undefined, 'token-value'),
    (error: unknown) => error instanceof Error && error.message === 'User invitations require APP_PUBLIC_URL on the backend.',
  );
});
