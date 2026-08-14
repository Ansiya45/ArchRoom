import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signJwt } from '../utils/jwt.js';

export type SignupInput = {
  fullName: string;
  email: string;
  password: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export class AuthService {
  async signup(input: SignupInput) {
    const fullName = input.fullName.trim();
    const normalizedEmail = input.email.trim().toLowerCase();

    if (!fullName || fullName.length < 2) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Full name is required' });
    }

    const existing = await db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    });

    if (existing) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Email already registered' });
    }

    const passwordHash = await hashPassword(input.password);

    let created: typeof users.$inferSelect;

    try {
      [created] = await db
        .insert(users)
        .values({
          fullName,
          email: normalizedEmail,
          passwordHash,
        })
        .returning();
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new TRPCError({ code: 'CONFLICT', message: 'Email already registered' });
      }

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unable to create account',
        cause: error,
      });
    }

    const token = signJwt({
      sub: created.id,
      email: created.email,
      name: created.fullName,
    });

    return {
      ok: true,
      token,
      user: {
        id: created.id,
        email: created.email,
        fullName: created.fullName,
      },
    };
  }

  async login(input: LoginInput) {
    const normalizedEmail = input.email.trim().toLowerCase();

    const record = await db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    });

    if (!record) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
    }

    const passwordMatches = await verifyPassword(input.password, record.passwordHash);

    if (!passwordMatches) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid email or password' });
    }

    const token = signJwt({
      sub: record.id,
      email: record.email,
      name: record.fullName,
    });

    return {
      ok: true,
      token,
      user: {
        id: record.id,
        email: record.email,
        fullName: record.fullName,
      },
    };
  }

  async me(userId: string) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User session is no longer valid' });
    }

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
    };
  }
}
