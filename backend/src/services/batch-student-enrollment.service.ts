import { TRPCError } from '@trpc/server';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { batchStudentEnrollmentEvents, batchStudentEnrollments, companyRecordingPrivatePolicies, recordingBatchFolderPermissions, recordingBatchFolders, users } from '../db/schema.js';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class BatchStudentEnrollmentService {
  constructor(private readonly administratorId: string | undefined) {}

  async authorizeManager(tx: Transaction, folderId: string, actorId: string) {
    // Lock the folder and permission row in the same transaction as the action.
    const [folder] = await tx.select().from(recordingBatchFolders).where(eq(recordingBatchFolders.folderId, folderId)).for('update');
    if (!folder) throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found.' });
    const [actor] = await tx.select({ email: users.email }).from(users).where(eq(users.id, actorId)).for('update');
    if (!actor) throw new TRPCError({ code: 'FORBIDDEN', message: 'Batch management access is required.' });
    if (actorId !== this.administratorId) {
      const [permission] = await tx.select().from(recordingBatchFolderPermissions).where(and(
        eq(recordingBatchFolderPermissions.folderId, folderId), eq(recordingBatchFolderPermissions.userId, actorId),
      )).for('update');
      if (permission?.role !== 'manager') throw new TRPCError({ code: 'FORBIDDEN', message: 'Batch management access is required.' });
    }
    return actor.email.trim().toLowerCase();
  }

  async list(folderId: string, actorId: string) {
    return db.transaction(async tx => {
      await this.authorizeManager(tx, folderId, actorId);
      const students = await tx.select().from(batchStudentEnrollments).where(eq(batchStudentEnrollments.folderId, folderId)).orderBy(asc(batchStudentEnrollments.studentEmail));
      const events = await tx.select({ enrollmentId: batchStudentEnrollmentEvents.enrollmentId, action: batchStudentEnrollmentEvents.action,
        actorUserId: batchStudentEnrollmentEvents.actorUserId, occurredAt: batchStudentEnrollmentEvents.occurredAt })
        .from(batchStudentEnrollmentEvents).innerJoin(batchStudentEnrollments, eq(batchStudentEnrollments.id, batchStudentEnrollmentEvents.enrollmentId))
        .where(eq(batchStudentEnrollments.folderId, folderId)).orderBy(asc(batchStudentEnrollmentEvents.occurredAt), asc(batchStudentEnrollmentEvents.id));
      return { students, events };
    });
  }

  async add(folderId: string, studentName: string, studentEmail: string, actorId: string) {
    const email = studentEmail.trim().toLowerCase();
    return db.transaction(async tx => {
      await this.authorizeManager(tx, folderId, actorId);
      const [existing] = await tx.select().from(batchStudentEnrollments).where(and(eq(batchStudentEnrollments.folderId, folderId), eq(batchStudentEnrollments.studentEmail, email))).for('update');
      if (existing) return existing; // A removed entry requires explicit reapproval.
      const [student] = await tx.insert(batchStudentEnrollments).values({ folderId, studentName: studentName.trim(), studentEmail: email }).returning();
      await tx.insert(batchStudentEnrollmentEvents).values({ enrollmentId: student.id, action: 'added', actorUserId: actorId });
      return student;
    });
  }

  async transition(folderId: string, enrollmentId: string, action: 'approve' | 'remove', actorId: string) {
    return db.transaction(async tx => {
      const actorEmail = await this.authorizeManager(tx, folderId, actorId);
      const [student] = await tx.select().from(batchStudentEnrollments).where(and(eq(batchStudentEnrollments.id, enrollmentId), eq(batchStudentEnrollments.folderId, folderId))).for('update');
      if (!student) throw new TRPCError({ code: 'NOT_FOUND', message: 'Enrollment not found.' });
      if (action === 'approve' && student.source === 'registration' && !student.emailVerifiedAt)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'The student must verify their email before approval.' });
      if (action === 'approve' && actorEmail === student.studentEmail) throw new TRPCError({ code: 'FORBIDDEN', message: 'Students cannot approve their own enrollment.' });
      if ((action === 'approve' && student.status === 'approved') || (action === 'remove' && student.status === 'removed')) return student;
      const [updated] = await tx.update(batchStudentEnrollments).set(action === 'approve'
        ? { status: 'approved', approvedBy: actorId, removedAt: null, removedBy: null, updatedAt: new Date() }
        : { status: 'removed', removedAt: new Date(), removedBy: actorId, updatedAt: new Date() })
        .where(eq(batchStudentEnrollments.id, student.id)).returning();
      await tx.insert(batchStudentEnrollmentEvents).values({ enrollmentId: student.id,
        action: action === 'remove' ? 'removed' : student.status === 'removed' ? 'reapproved' : 'approved', actorUserId: actorId });
      // Enrollment changes affect the durable Restricted recipient snapshot.
      // This only blocks publication; it never claims Drive access was revoked.
      await tx.update(companyRecordingPrivatePolicies).set({ status: 'reconciliation_required', reconciliationStatus: 'required', updatedAt: new Date() })
        .where(and(eq(companyRecordingPrivatePolicies.destinationFolderId, folderId), eq(companyRecordingPrivatePolicies.policyMode, 'restricted')));
      return updated;
    });
  }
}
