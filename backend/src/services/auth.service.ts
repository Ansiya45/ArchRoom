import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../db/index.js';
import { authCodes, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signJwt } from '../utils/jwt.js';
import { passwordResetEmail, sendEmail, verificationEmail } from './email.service.js';

type Purpose = 'verify_email' | 'reset_password';
export type SignupInput = { fullName: string; email: string; password: string };
export type LoginInput = { email: string; password: string };

export class AuthService {
  async signup(input: SignupInput) {
    const fullName = input.fullName.trim();
    const email = normalizeEmail(input.email);
    if (fullName.length < 2) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Full name is required' });
    if (await this.findUser(email)) throw new TRPCError({ code: 'CONFLICT', message: 'Email already registered' });
    const passwordHash = await hashPassword(input.password);
    let created: typeof users.$inferSelect;
    try {
      [created] = await db.insert(users).values({ fullName, email, passwordHash }).returning();
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new TRPCError({ code: 'CONFLICT', message: 'Email already registered' });
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unable to create account', cause: error });
    }
    await this.sendCode(created, 'verify_email');
    return { ok: true, verificationRequired: true as const, email: created.email };
  }

  async verifyEmail(emailInput: string, code: string) {
    const user = await this.requireUser(normalizeEmail(emailInput));
    if (!user.emailVerifiedAt) {
      await this.consumeCode(user.id, 'verify_email', code);
      await db.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
    }
    return this.session(user);
  }

  async resendVerification(emailInput: string) {
    const user = await this.requireUser(normalizeEmail(emailInput));
    if (user.emailVerifiedAt) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This email is already verified. Please sign in.' });
    await this.sendCode(user, 'verify_email');
    return { ok: true, message: 'A new verification code was sent to your email.' };
  }

  async requestPasswordReset(emailInput: string) {
    const user = await this.requireUser(normalizeEmail(emailInput));
    await this.sendCode(user, 'reset_password');
    return { ok: true, message: 'A reset code has been sent to your email.' };
  }

  async resetPassword(emailInput: string, code: string, password: string) {
    const user = await this.requireUser(normalizeEmail(emailInput));
    await this.consumeCode(user.id, 'reset_password', code);
    await db.update(users).set({
      passwordHash: await hashPassword(password),
      emailVerifiedAt: user.emailVerifiedAt || new Date(),
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));
    return { ok: true };
  }

  async login(input: LoginInput) {
    const record = await this.findUser(normalizeEmail(input.email));
    if (!record) throw new TRPCError({ code: 'NOT_FOUND', message: 'Email ID is not registered.' });
    if (!(await verifyPassword(input.password, record.passwordHash))) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Wrong password. Please try again.' });
    if (!record.emailVerifiedAt) throw new TRPCError({ code: 'FORBIDDEN', message: 'Your registration is incomplete. Complete the email verification from sign up before logging in.' });
    return this.session(record);
  }

  async me(userId: string) {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User session is no longer valid' });
    return { ok: true, user: { id: user.id, email: user.email, fullName: user.fullName } };
  }

  private async sendCode(user: typeof users.$inferSelect, purpose: Purpose) {
    const code = randomInt(100000, 1000000).toString();
    const email = purpose === 'verify_email' ? verificationEmail(user.fullName, code) : passwordResetEmail(user.fullName, code);
    await db.transaction(async (tx) => {
      await tx.delete(authCodes).where(and(eq(authCodes.userId, user.id), eq(authCodes.purpose, purpose)));
      await tx.insert(authCodes).values({ userId: user.id, purpose, codeHash: digest(code), expiresAt: new Date(Date.now() + 600000) });
      await sendEmail({ to: user.email, ...email });
    });
  }

  private async consumeCode(userId: string, purpose: Purpose, code: string) {
    const record = await db.query.authCodes.findFirst({ where: and(eq(authCodes.userId, userId), eq(authCodes.purpose, purpose)), orderBy: [desc(authCodes.createdAt)] });
    const supplied = Buffer.from(digest(code));
    const stored = record ? Buffer.from(record.codeHash) : Buffer.alloc(supplied.length);
    if (!record || record.expiresAt <= new Date() || stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The code is invalid or has expired.' });
    await db.delete(authCodes).where(eq(authCodes.id, record.id));
  }

  private findUser(email: string) { return db.query.users.findFirst({ where: eq(users.email, email) }); }
  private async requireUser(email: string) {
    const user = await this.findUser(email);
    if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Email ID is not registered.' });
    return user;
  }
  private session(user: typeof users.$inferSelect) {
    const token = signJwt({ sub: user.id, email: user.email, name: user.fullName });
    return { ok: true, token, user: { id: user.id, email: user.email, fullName: user.fullName } };
  }
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
