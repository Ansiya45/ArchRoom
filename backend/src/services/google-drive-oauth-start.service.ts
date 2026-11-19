import { TRPCError } from '@trpc/server';
import { isSessionActive } from './auth-session.service.js';
import { assertIntegrationAdministrator } from './drive-security.service.js';
import type { GoogleDriveOAuthService } from './google-drive-oauth.service.js';
import { verifyJwt, type JwtPayload } from '../utils/jwt.js';

export function oauthStateCookie(value: string, callbackUrl: string, clear = false): string {
  const callback = new URL(callbackUrl);
  return `ylaam_drive_oauth=${clear ? '' : value}; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 300}; Path=${callback.pathname}${callback.protocol === 'https:' ? '; Secure' : ''}`;
}

export function googleOAuthResultPage(publicUrl: string, success: boolean): string {
  let target: URL;
  try { target = new URL('/', publicUrl); }
  catch { throw new Error('Invalid application return URL.'); }
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('Invalid application return URL.');
  }
  const href = target.toString().replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const title = success ? 'Google Drive authorized' : 'Google Drive authorization failed';
  const message = success
    ? 'Google authorization was received. Return to YLAAM Meet to select and verify the recording root.'
    : 'Google authorization could not be completed. Return to YLAAM Meet and retry.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1024;color:#f8fafc;font-family:system-ui,sans-serif}.card{width:min(90vw,34rem);padding:2rem;border:1px solid #30385d;border-radius:1rem;background:#11172d;box-shadow:0 1rem 3rem #0005}h1{margin:0 0 .75rem;font-size:1.5rem}p{margin:0 0 1.5rem;color:#cbd5e1;line-height:1.6}a{display:inline-block;border-radius:.7rem;background:#7c3aed;color:white;padding:.8rem 1.1rem;text-decoration:none;font-weight:700}a:focus-visible{outline:3px solid #c4b5fd;outline-offset:3px}</style></head><body><main class="card"><h1>${title}</h1><p>${message}</p><a href="${href}">Return to YLAAM Meet</a></main></body></html>`;
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
