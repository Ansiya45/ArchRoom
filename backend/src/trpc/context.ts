import type { CreateHTTPContextOptions } from '@trpc/server/adapters/standalone';
import { TRPCError } from '@trpc/server';
import { verifyJwt, getBearerToken } from '../utils/jwt.js';
import { env } from '../env.js';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

export interface Context {
  req: CreateHTTPContextOptions['req'];
  res: CreateHTTPContextOptions['res'];
  jwtSecret: string;
  isAuthenticated: boolean;
  user: AuthUser | null;
}

export async function createContext(opts: CreateHTTPContextOptions): Promise<Context> {
  const bearer = getBearerToken(opts.req.headers.authorization);

  let user: AuthUser | null = null;
  let isAuthenticated = false;

  if (bearer) {
    try {
      const payload = verifyJwt(bearer);
      user = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
      };
      isAuthenticated = true;
    } catch {
      isAuthenticated = false;
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    jwtSecret: env.JWT_SECRET,
    isAuthenticated,
    user,
  };
}
