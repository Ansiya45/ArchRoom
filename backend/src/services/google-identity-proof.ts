import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';

// Protocol primitive only. The caller must use pinned Google JWKS and atomically
// consume a server-side, account/session-bound OAuth attempt. This does NOT link
// an account, authorize an enrollment, or make a proof replay-resistant by itself.
export function newGoogleIdentityChallenge() {
  const verifier = randomBytes(32).toString('base64url');
  return { state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'),
    verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), method: 'S256' as const };
}

type SigningKey = JsonWebKey & { kid?: string; alg?: string; use?: string };
export function verifyGoogleIdentityProof(input: {
  idToken: string; audience: string; nonce: string; keys: SigningKey[]; nowSeconds?: number;
}): { subject: string; email: string; issuer: 'https://accounts.google.com' } {
  const reject = (): never => { throw new Error('Google identity proof is invalid.'); };
  try {
    if (!input.audience || !/^[A-Za-z0-9_-]{43}$/.test(input.nonce) || input.idToken.length > 16384) reject();
    const parts = input.idToken.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) reject();
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.jku || header.jwk || header.x5u || header.crit) reject();
    const keys = input.keys.filter(key => key.kid === header.kid && key.kty === 'RSA' &&
      (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
    if (keys.length !== 1) reject();
    const key = createPublicKey({ key: keys[0], format: 'jwk' });
    if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
      !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) reject();
    const claim = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(now) || !['https://accounts.google.com', 'accounts.google.com'].includes(claim.iss) ||
      claim.aud !== input.audience || (claim.azp !== undefined && claim.azp !== input.audience) || claim.nonce !== input.nonce ||
      !Number.isSafeInteger(claim.exp) || claim.exp <= now || !Number.isSafeInteger(claim.iat) ||
      claim.iat > now + 60 || claim.iat < now - 600 ||
      (claim.nbf !== undefined && (!Number.isSafeInteger(claim.nbf) || claim.nbf > now)) ||
      typeof claim.sub !== 'string' || !claim.sub || claim.sub.length > 255 || claim.email_verified !== true ||
      typeof claim.email !== 'string' || claim.email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claim.email)) reject();
    return { subject: claim.sub, email: claim.email.toLowerCase(), issuer: 'https://accounts.google.com' };
  } catch { return reject(); }
}
