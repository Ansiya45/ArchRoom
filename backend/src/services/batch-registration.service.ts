import { createHash, createHmac, randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { batchRegistrationLinks as links, batchRegistrationVerifications as verifications, batchStudentEnrollments as enrollments, batchStudentEnrollmentEvents as events, batchEnrollmentAccountBindings as bindings, companyRecordingPrivatePolicies as policies, users, recordingBatchFolders as folders } from '../db/schema.js';
import { BatchStudentEnrollmentService } from './batch-student-enrollment.service.js';
import { sendEmail } from './email.service.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = () => new TRPCError({ code: 'BAD_REQUEST', message: 'This link is invalid, disabled, or expired. Ask your batch manager for a new link.' });
const receipt = { message: 'If your request can be processed, a verification email will arrive shortly. Check your inbox and spam folder. You may retry later.' };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class BatchRegistrationService {
  private readonly managers: BatchStudentEnrollmentService;
  constructor(administratorId: string | undefined, private readonly publicUrl: string | undefined,
    private readonly rateKey: string, private readonly sender = sendEmail) {
    this.managers = new BatchStudentEnrollmentService(administratorId);
  }
  private url(path: string, token: string) {
    if (!this.publicUrl) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Registration email links are not configured.' });
    const base = new URL(this.publicUrl);
    if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))))
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Registration email links are not configured.' });
    const url = new URL(path, base); url.hash = token; return url.toString();
  }
  // Durable, atomic limits shared across instances. Do not trust X-Forwarded-For.
  // A reverse proxy may share one socket address; this conservatively limits it.
  private async throttle(subject: string, maximum: number, seconds: number) {
    const key = createHmac('sha256', this.rateKey).update(subject).digest('hex');
    const result = await db.execute(sql`insert into batch_registration_limits(key_hash, attempts) values (${key},1)
      on conflict(key_hash) do update set
      attempts=case when batch_registration_limits.window_started_at <= clock_timestamp() - ${seconds} * interval '1 second' then 1 else batch_registration_limits.attempts+1 end,
      window_started_at=case when batch_registration_limits.window_started_at <= clock_timestamp() - ${seconds} * interval '1 second' then clock_timestamp() else batch_registration_limits.window_started_at end
      where batch_registration_limits.window_started_at <= clock_timestamp() - ${seconds} * interval '1 second' or batch_registration_limits.attempts < ${maximum} returning key_hash`);
    if (!result.length) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please try again later.' });
  }
  async linkStatus(folderId: string, actorId: string) {
    return db.transaction(async tx => {
      await this.managers.authorizeManager(tx, folderId, actorId);
      const [link] = await tx.select({ expiresAt: links.expiresAt, disabledAt: links.disabledAt }).from(links).where(eq(links.folderId, folderId));
      return { active: Boolean(link && !link.disabledAt && link.expiresAt.getTime() > Date.now()), expiresAt: link?.expiresAt ?? null };
    });
  }
  async generate(folderId: string, actorId: string, days: number) {
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Expiration must be between 1 and 30 days.' });
    const token = randomBytes(32).toString('base64url');
    const registrationUrl = this.url('/batch/register', token);
    return db.transaction(async tx => {
      await this.managers.authorizeManager(tx, folderId, actorId);
      const value = { folderId, tokenHash: digest(token), createdBy: actorId, createdAt: new Date(), disabledAt: null, expiresAt: new Date(Date.now() + days * 86400000) };
      await tx.insert(links).values(value).onConflictDoUpdate({ target: links.folderId, set: value });
      return { registrationUrl, expiresAt: value.expiresAt };
    });
  }
  async disable(folderId: string, actorId: string) {
    return db.transaction(async tx => {
      await this.managers.authorizeManager(tx, folderId, actorId);
      await tx.update(links).set({ disabledAt: new Date() }).where(and(eq(links.folderId, folderId), isNull(links.disabledAt)));
      return { ok: true };
    });
  }
  private async liveLink(tx: Transaction, hash: string) {
    // Lock order agrees with manager operations and approval: folder, link, enrollment.
    const [found] = await tx.select({ folderId: links.folderId }).from(links).where(eq(links.tokenHash, hash));
    if (!found) throw invalid();
    const [folder] = await tx.select().from(folders).where(eq(folders.folderId, found.folderId)).for('update');
    const [link] = await tx.select().from(links).where(and(eq(links.tokenHash, hash), isNull(links.disabledAt), gt(links.expiresAt, sql`clock_timestamp()`))).for('update');
    if (!folder || !link) throw invalid();
    return folder;
  }
  async identify(token: string, address: string) {
    await this.throttle(`info:${address}`, 60, 60);
    return db.transaction(async tx => { const folder = await this.liveLink(tx, digest(token)); return { batchName: folder.name }; });
  }
  async register(token: string, name: string, emailInput: string, address: string) {
    await this.throttle(`submit:${address}`, 10, 600);
    const email = emailInput.trim().toLowerCase(), hash = digest(token);
    // Link validity is not an email-existence signal.
    await db.transaction(async tx => { await this.liveLink(tx, hash); });
    try { await this.throttle(`recipient:${email}`, 3, 3600); await this.throttle(`batch:${hash}`, 100, 3600); }
    catch (error) { if (error instanceof TRPCError && error.code === 'TOO_MANY_REQUESTS') return receipt; throw error; }
    const verificationToken = randomBytes(32).toString('base64url');
    const verificationUrl = this.url('/batch/verify', verificationToken);
    await db.transaction(async tx => {
      const folder = await this.liveLink(tx, hash);
      let [student] = await tx.select().from(enrollments).where(and(eq(enrollments.folderId, folder.folderId), eq(enrollments.studentEmail, email))).for('update');
      if (!student) {
        [student] = await tx.insert(enrollments).values({ folderId: folder.folderId, studentName: name.trim(), studentEmail: email, source: 'registration' }).returning();
        await tx.insert(events).values({ enrollmentId: student.id, action: 'registered', actorUserId: null });
      }
      // No overwrite of manual enrollment, approval or removal. No account is created or linked by email.
      await tx.insert(verifications).values({ tokenHash: digest(verificationToken), enrollmentId: student.id, linkHash: hash,
        requestedName: name.trim(), expiresAt: new Date(Date.now() + 15 * 60000) });
    });
    try {
      // Only an application-generated URL is included; no untrusted name or batch HTML.
      await this.sender({ to: email, subject: 'Verify your YLAAM Meet batch registration', html:
        `<p>Confirm this email address for your batch enrollment request.</p><p><a href="${verificationUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">Verify email</a></p><p>This link expires in 15 minutes and can be used once. Email verification does not approve enrollment or grant recording access. Ignore this email if you did not request it.</p>` });
    } catch {
      // Same public response on provider failure. Never log the token, email or provider response.
      console.warn('Batch registration email delivery could not be confirmed.');
    }
    return receipt;
  }
  async verify(token: string, address: string) {
    await this.throttle(`verify:${address}`, 20, 600);
    return db.transaction(async tx => {
      const hash = digest(token);
      const [candidate] = await tx.select().from(verifications).where(eq(verifications.tokenHash, hash));
      if (!candidate) throw invalid();
      const folder = await this.liveLink(tx, candidate.linkHash);
      const [student] = await tx.select().from(enrollments).where(and(eq(enrollments.id, candidate.enrollmentId), eq(enrollments.folderId, folder.folderId))).for('update');
      if (!student) throw invalid();
      const [consumed] = await tx.update(verifications).set({ consumedAt: new Date() }).where(and(eq(verifications.tokenHash, hash), isNull(verifications.consumedAt), gt(verifications.expiresAt, sql`clock_timestamp()`))).returning();
      if (!consumed) throw invalid();
      if (!student.emailVerifiedAt) {
        await tx.update(enrollments).set({ emailVerifiedAt: new Date(), updatedAt: new Date(),
          ...(student.source === 'registration' ? { studentName: consumed.requestedName } : {}) }).where(eq(enrollments.id, student.id));
        await tx.insert(events).values({ enrollmentId: student.id, action: 'email_verified', actorUserId: null });
      }
      return { message: 'Email verified. Manager approval is required for pending enrollment. Verification does not restore removed enrollment or grant recording access.' };
    });
  }

  // Possession of a fresh, single-use enrollment email token is checked in the
  // same transaction as the authenticated verified account and binding. Matching
  // email alone, prior email verification, and manager approval are insufficient.
  async verifyAndBind(token: string, userId: string, address: string) {
    await this.throttle(`verify:${address}`, 20, 600);
    return db.transaction(async tx => {
      const hash = digest(token);
      const [candidate] = await tx.select().from(verifications).where(eq(verifications.tokenHash, hash));
      if (!candidate) throw invalid();
      const folder = await this.liveLink(tx, candidate.linkHash);
      const [student] = await tx.select().from(enrollments).where(and(eq(enrollments.id, candidate.enrollmentId), eq(enrollments.folderId, folder.folderId))).for('update');
      const [account] = await tx.select({ id: users.id, email: users.email, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId)).for('update');
      if (!student || !account?.verified || account.email.trim().toLowerCase() !== student.studentEmail || student.status === 'removed') throw invalid();
      const [existing] = await tx.select().from(bindings).where(eq(bindings.enrollmentId, student.id)).for('update');
      if (existing && existing.userId !== account.id) throw invalid();
      const [consumed] = await tx.update(verifications).set({ consumedAt: new Date() }).where(and(eq(verifications.tokenHash, hash), isNull(verifications.consumedAt), gt(verifications.expiresAt, sql`clock_timestamp()`))).returning();
      if (!consumed) throw invalid();
      if (!student.emailVerifiedAt) {
        await tx.update(enrollments).set({ emailVerifiedAt: new Date(), updatedAt: new Date(),
          ...(student.source === 'registration' ? { studentName: consumed.requestedName } : {}) }).where(eq(enrollments.id, student.id));
        await tx.insert(events).values({ enrollmentId: student.id, action: 'email_verified', actorUserId: null });
      }
      if (!existing) {
        await tx.insert(bindings).values({ enrollmentId: student.id, userId: account.id });
        if (student.status === 'approved') await tx.update(policies).set({ status:'reconciliation_required', reconciliationStatus:'required', updatedAt:new Date() })
          .where(and(eq(policies.destinationFolderId, folder.folderId), eq(policies.policyMode, 'restricted'), eq(policies.isActive, true)));
      }
      return { bound: true as const, approvalRequired: student.status !== 'approved' };
    });
  }
}
