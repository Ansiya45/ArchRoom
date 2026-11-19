import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import { newGoogleIdentityChallenge, verifyGoogleIdentityProof } from './google-identity-proof.js';

type Config = { clientId?: string; clientSecret?: string; callbackUrl?: string; companyClientId?: string };
type Owner = { userId: string; sessionId: string };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (): never => { throw new Error('Google identity linking is unavailable.'); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const opaque = /^[A-Za-z0-9_-]{43}$/;

// Identity-only client. Company Drive credentials and tokens are never used.
export class StudentGoogleOidcService {
  constructor(private readonly sql: Sql, private readonly config: Config, private readonly fetcher: typeof fetch = fetch) {}

  private configuration() {
    const { clientId, clientSecret, callbackUrl, companyClientId } = this.config;
    if (!clientId || !clientSecret || !callbackUrl || !companyClientId || clientId === companyClientId) return fail();
    let url: URL;
    try { url = new URL(callbackUrl); } catch { return fail(); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/student-google/callback' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) return fail();
    return { clientId, clientSecret, callbackUrl };
  }
  private owner(owner: Owner) { if (!uuid.test(owner.userId) || !uuid.test(owner.sessionId)) fail(); }

  // Account session and verified YLAAM ownership are checked under lock. Batch
  // enrollment is resolved separately from durable recording authorization.
  private async eligible(tx: any, owner: Owner) {
    const rows = await tx`select u.id from users u join auth_sessions s on s.user_id=u.id
      where u.id=${owner.userId} and s.id=${owner.sessionId} and u.email_verified_at is not null
      and s.password_version=encode(sha256(convert_to(u.password_hash,'UTF8')),'hex')
      for update of u,s`;
    if (!rows.length) fail();
  }

  async start(owner: Owner) {
    this.owner(owner); const config = this.configuration(); const challenge = newGoogleIdentityChallenge();
    await this.sql.begin(async tx => {
      await this.eligible(tx, owner);
      // Starting a new attempt supersedes earlier attempts for this account.
      await tx`delete from student_google_oidc_attempts where user_id=${owner.userId}`;
      await tx`insert into student_google_oidc_attempts(state_hash,user_id,session_id,nonce,verifier,expires_at)
        values(${digest(challenge.state)},${owner.userId},${owner.sessionId},${challenge.nonce},${challenge.verifier},now()+interval '10 minutes')`;
    });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.callbackUrl, response_type: 'code',
      scope: 'openid email', state: challenge.state, nonce: challenge.nonce, code_challenge: challenge.challenge, code_challenge_method: 'S256' }).toString();
    return { authorizationUrl: url.toString() };
  }

  private async json(url: string, init: RequestInit): Promise<any> {
    const response = await this.fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.body) return fail();
    const reader = response.body.getReader(); const parts: Buffer[] = []; let total = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length;
        if (total > 256 * 1024) return fail(); parts.push(Buffer.from(value)); }
      return JSON.parse(Buffer.concat(parts, total).toString('utf8'));
    } finally { reader.releaseLock(); }
  }

  async complete(owner: Owner, state: string, code: string) {
    this.owner(owner); const config = this.configuration();
    if (!opaque.test(state) || !code || code.length > 4096) fail();
    // Commit consumption BEFORE provider access: all failure paths require a
    // fresh attempt, and concurrent callbacks cannot replay the same state.
    const attempt = await this.sql.begin(async tx => {
      await this.eligible(tx, owner);
      const [row] = await tx`update student_google_oidc_attempts set consumed_at=clock_timestamp()
        where state_hash=${digest(state)} and user_id=${owner.userId} and session_id=${owner.sessionId}
        and consumed_at is null and expires_at>clock_timestamp() returning nonce,verifier`;
      if (!row) fail(); return row;
    });
    const response = await this.json('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code,
        client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.callbackUrl,
        code_verifier: attempt.verifier, grant_type: 'authorization_code' }) });
    if (typeof response.id_token !== 'string') fail();
    const jwks = await this.json('https://www.googleapis.com/oauth2/v3/certs', { method: 'GET' });
    if (!Array.isArray(jwks.keys) || jwks.keys.length > 50) fail();
    const proof = verifyGoogleIdentityProof({ idToken: response.id_token, audience: config.clientId, nonce: attempt.nonce, keys: jwks.keys });
    try {
      await this.sql.begin(async tx => {
        await this.eligible(tx, owner);
        const [liveAttempt] = await tx`select state_hash from student_google_oidc_attempts where state_hash=${digest(state)}
          and user_id=${owner.userId} and session_id=${owner.sessionId} and consumed_at is not null
          and expires_at>clock_timestamp() for update`;
        if (!liveAttempt) fail();
        const [reservation] = await tx`insert into student_google_subject_reservations(google_subject,user_id) values(${proof.subject},${owner.userId})
          on conflict(google_subject) do update set user_id=student_google_subject_reservations.user_id
          where student_google_subject_reservations.user_id=excluded.user_id returning user_id`;
        if (!reservation) fail();
        const [existing] = await tx`select google_subject from student_google_identities where user_id=${owner.userId} for update`;
        // A different subject requires explicit unlink first.
        if (existing?.google_subject && existing.google_subject !== proof.subject) fail();
        await tx`insert into student_google_identities(user_id,google_subject,google_email,verified_at)
          values(${owner.userId},${proof.subject},${proof.email},now()) on conflict(user_id) do update
          set google_subject=excluded.google_subject,google_email=excluded.google_email,verified_at=excluded.verified_at`;
        await tx`insert into student_google_identity_events(user_id,action,subject_hash) values(${owner.userId},'linked',${digest(proof.subject)})`;
        await tx`update company_recording_private_policies p set status='reconciliation_required', reconciliation_status='required', updated_at=clock_timestamp()
          where exists (select 1 from company_recording_private_readers r where r.policy_id=p.id and r.user_id=${owner.userId})`;
        await tx`delete from student_google_oidc_attempts where state_hash=${digest(state)}`;
      });
    } catch { return fail(); }
    return { linked: true as const };
  }

  async status(owner: Owner) {
    this.owner(owner);
    const [user] = await this.sql`select google_email,verified_at from student_google_identities where user_id=${owner.userId}`;
    let available = false; try { this.configuration(); available = true; } catch { /* not configured */ }
    return { status: user?.verified_at ? 'verified' as const : 'unverified' as const,
      email: user?.verified_at ? user.google_email as string : null, linkingAvailable: available };
  }

  async unlink(owner: Owner) {
    this.owner(owner);
    await this.sql.begin(async tx => {
      // A live session is required even if the enrollment was subsequently removed.
      const [session] = await tx`select s.id from auth_sessions s join users u on u.id=s.user_id
        where s.id=${owner.sessionId} and s.user_id=${owner.userId} and u.email_verified_at is not null
        and s.password_version=encode(sha256(convert_to(u.password_hash,'UTF8')),'hex') for update of s,u`;
      if (!session) fail();
      const [identity] = await tx`select google_subject from student_google_identities where user_id=${owner.userId} for update`;
      await tx`delete from student_google_oidc_attempts where user_id=${owner.userId}`;
      if (identity?.google_subject) {
        await tx`update student_google_identities set google_subject=null,google_email=null,verified_at=null where user_id=${owner.userId}`;
        await tx`insert into student_google_identity_events(user_id,action,subject_hash) values(${owner.userId},'unlinked',${digest(identity.google_subject)})`;
        await tx`update company_recording_private_policies p set status='reconciliation_required', reconciliation_status='required', updated_at=clock_timestamp()
          where exists (select 1 from company_recording_private_readers r where r.policy_id=p.id and r.user_id=${owner.userId})`;
      }
    });
    return { linked: false as const };
  }
}
