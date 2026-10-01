import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../db/index.js';
import { authSessions, users } from '../db/schema.js';
import { signJwt, type JwtPayload } from '../utils/jwt.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

// A device session lasts until logout or a password change. Only a digest of
// the random credential is stored in the database; access JWTs remain short lived.
export async function createPersistentSession(user: typeof users.$inferSelect) {
  const refreshToken = randomBytes(32).toString('hex');
  const [session] = await db.insert(authSessions).values({
    userId: user.id, tokenHash: digest(refreshToken), passwordVersion: digest(user.passwordHash),
  }).returning({ id: authSessions.id });
  return { sessionId: session.id, refreshToken };
}

async function sessionUser(session: typeof authSessions.$inferSelect | undefined) {
  if (!session) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  return user?.emailVerifiedAt && session.passwordVersion === digest(user.passwordHash) ? user : null;
}

export async function refreshSession(refreshToken: string) {
  const session = await db.query.authSessions.findFirst({ where: eq(authSessions.tokenHash, digest(refreshToken)) });
  const user = await sessionUser(session);
  if (!user || !session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Please sign in again.' });
  return {
    token: signJwt({ sub: user.id, email: user.email, name: user.fullName, sid: session.id }),
    user: { id: user.id, email: user.email, fullName: user.fullName },
  };
}

export async function revokeSession(refreshToken: string) {
  await db.delete(authSessions).where(eq(authSessions.tokenHash, digest(refreshToken)));
  return { ok: true };
}

export async function isSessionActive(payload: JwtPayload) {
  // Previously issued JWTs remain valid until their original expiry.
  if (!payload.sid) return true;
  const session = await db.query.authSessions.findFirst({ where: eq(authSessions.id, payload.sid) });
  return session?.userId === payload.sub && !!(await sessionUser(session));
}
