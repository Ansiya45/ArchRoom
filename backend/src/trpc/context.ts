import type { CreateHTTPContextOptions } from '@trpc/server/adapters/standalone';
import { verifyJwt, getBearerToken } from '../utils/jwt.js';
import { env } from '../env.js';
import { isSessionActive } from '../services/auth-session.service.js';

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
    let payload;
    try {
      payload = verifyJwt(bearer);
    } catch { /* Missing or expired access token. */ }
    // Database outages must propagate as server errors, not invalid sessions.
    if (payload && await isSessionActive(payload)) {
      user = {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
      };
      isAuthenticated = true;
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
