import { TRPCError } from '@trpc/server';
import { isSessionActive } from './auth-session.service.js';
import { assertIntegrationAdministrator } from './drive-security.service.js';
import type { GoogleDriveOAuthService } from './google-drive-oauth.service.js';
import { verifyJwt, type JwtPayload } from '../utils/jwt.js';

export function oauthStateCookie(value: string, callbackUrl: string, clear = false): string {
  const callback = new URL(callbackUrl);
  return `ylaam_drive_oauth=${clear ? '' : value}; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 300}; Path=${callback.pathname}${callback.protocol === 'https:' ? '; Secure' : ''}`;
}

export async function startGoogleOAuthFromNavigation(
  token: string | null, origin: string | undefined, allowedOrigins: ReadonlySet<string>, administratorId: string | undefined,
  oauth: Pick<GoogleDriveOAuthService, 'start'>,
  verify: (token: string) => JwtPayload = verifyJwt,
  sessionActive: (payload: JwtPayload) => Promise<boolean> = isSessionActive,
) {
  if (!origin || !allowedOrigins.has(origin) || !token) throw new TRPCError({ code: 'FORBIDDEN', message: 'Google setup is unavailable.' });
  let payload: JwtPayload;
  try { payload = verify(token); }
  catch { throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Administrator session is required.' }); }
  assertIntegrationAdministrator(payload.sub, administratorId);
  if (!payload.sid || !await sessionActive(payload)) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'A current administrator session is required.' });
  return oauth.start(payload.sub, payload.sid);
}
