import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
process.env.DOTENV_CONFIG_PATH = 'tests/.nonexistent-cohost-env';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-only';
const { db } = await import('../src/db/index.js');
const { canManageMeetingSession } = await import('../src/services/meeting-host-access.js');

test('creator retains host access; co-host access is limited to the promoted session', async () => {
  const owner = randomUUID(), cohost = randomUUID(), occurrence = randomUUID(), other = randomUUID();
  const meeting = { id: randomUUID(), hostUserId: owner } as any;
  const original = db.query.meetingParticipants.findFirst;
  const dialect = new PgDialect();
  db.query.meetingParticipants.findFirst = (async ({ where }: any) => {
    const params = dialect.sqlToQuery(where).params;
    return params.includes(cohost) && params.includes(occurrence) ? { id: randomUUID(), role: 'host' } : null;
  }) as any;
  try {
    assert.equal(await canManageMeetingSession(meeting, owner, occurrence), true);
    assert.equal(await canManageMeetingSession(meeting, cohost, occurrence), true);
    assert.equal(await canManageMeetingSession(meeting, cohost, other), false);
    assert.equal(await canManageMeetingSession(meeting, other, occurrence), false);
  } finally { db.query.meetingParticipants.findFirst = original; }
});
