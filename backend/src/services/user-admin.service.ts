import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../db/index.js';
import { userInvitations, userPermissions, users } from '../db/schema.js';
import { env } from '../env.js';
import { sendEmail } from './email.service.js';
import {
  FEATURES,
  featureAllowed,
  getUserAccess,
  invalidateAccess,
  isFeatureKey,
  isFeatureLevel,
  type FeatureLevel,
  type FeatureKey,
  type PermissionMap,
  type UserRole,
} from './permission.service.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function userInvitationLink(publicUrl: string | undefined, token: string): string {
  if (!publicUrl) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'User invitations require APP_PUBLIC_URL on the backend.',
    });
  }
  const link = new URL(publicUrl);
  link.searchParams.set('invite', token);
  return link.toString();
}

export function sanitizePermissions(raw: Record<string, string> | undefined | null): PermissionMap {
  const permissions: PermissionMap = {};
  if (!raw) return permissions;
  for (const [feature, level] of Object.entries(raw)) {
    if (isFeatureKey(feature) && isFeatureLevel(level)) permissions[feature] = level;
  }
  return permissions;
}

export class UserAdminService {
  async myAccess(userId: string) {
    const access = await getUserAccess(userId);
    return { role: access.role, disabled: access.disabled, permissions: access.permissions, features: FEATURES };
  }

  async listUsers() {
    const [allUsers, allPermissions] = await Promise.all([
      db.query.users.findMany({ orderBy: users.createdAt }),
      db.query.userPermissions.findMany(),
    ]);
    const inviterNames = new Map(allUsers.map((user) => [user.id, user.fullName]));
    const permissionsByUser = new Map<string, PermissionMap>();
    for (const row of allPermissions) {
      if (!isFeatureKey(row.feature) || !isFeatureLevel(row.level)) continue;
      const existing = permissionsByUser.get(row.userId) ?? {};
      existing[row.feature] = row.level;
      permissionsByUser.set(row.userId, existing);
    }
    return allUsers.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as UserRole,
      disabled: !!user.disabledAt,
      invitedByName: user.invitedBy ? inviterNames.get(user.invitedBy) ?? null : null,
      createdAt: user.createdAt.toISOString(),
      permissions: permissionsByUser.get(user.id) ?? {},
    }));
  }

  async invite(actorId: string, input: { email: string; role: 'admin' | 'user'; permissions?: Record<string, string> }) {
    const email = normalizeEmail(input.email);
    // Validate configuration before changing invitation state. Never email an
    // unusable `undefined/?invite=...` link when a process missed its runtime
    // public-URL configuration.
    const token = randomBytes(32).toString('hex');
    const invitationLink = userInvitationLink(env.APP_PUBLIC_URL, token);
    if (await db.query.users.findFirst({ where: eq(users.email, email) })) {
      throw new TRPCError({ code: 'CONFLICT', message: 'A user with this email is already registered.' });
    }
    const actor = await db.query.users.findFirst({ where: eq(users.id, actorId) });
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    // Replace any outstanding invitation for the same address so the newest link is the valid one.
    await db.delete(userInvitations).where(and(eq(userInvitations.email, email), isNull(userInvitations.acceptedAt)));
    const [invitation] = await db.insert(userInvitations).values({
      email,
      role: input.role,
      tokenHash: digest(token),
      invitedBy: actorId,
      permissions: sanitizePermissions(input.permissions),
      expiresAt,
    }).returning();
    try {
      await sendEmail({
        to: email,
        subject: 'You have been invited to YLAAM-MEET',
        html: inviteEmailHtml(actor?.fullName ?? 'Your administrator', invitationLink, input.role),
      });
    } catch (error) {
      await db.delete(userInvitations).where(eq(userInvitations.id, invitation.id));
      throw error;
    }
    return { ok: true as const, expiresAt: expiresAt.toISOString() };
  }

  async listInvitations() {
    const invitations = await db.query.userInvitations.findMany({ where: isNull(userInvitations.acceptedAt), orderBy: userInvitations.createdAt });
    const inviters = await db.query.users.findMany();
    const names = new Map(inviters.map((user) => [user.id, user.fullName]));
    return invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      invitedByName: names.get(invitation.invitedBy) ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
      expired: invitation.expiresAt <= new Date(),
    }));
  }

  async resendInvitation(actorId: string, invitationId: string) {
    const invitation = await db.query.userInvitations.findFirst({ where: and(eq(userInvitations.id, invitationId), isNull(userInvitations.acceptedAt)) });
    if (!invitation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found or already accepted.' });
    const token = randomBytes(32).toString('hex');
    const invitationLink = userInvitationLink(env.APP_PUBLIC_URL, token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await db.update(userInvitations).set({ tokenHash: digest(token), expiresAt }).where(eq(userInvitations.id, invitation.id));
    const actor = await db.query.users.findFirst({ where: eq(users.id, actorId) });
    await sendEmail({
      to: invitation.email,
      subject: 'You have been invited to YLAAM-MEET',
      html: inviteEmailHtml(actor?.fullName ?? 'Your administrator', invitationLink, invitation.role),
    });
    return { ok: true as const, expiresAt: expiresAt.toISOString() };
  }

  async revokeInvitation(invitationId: string) {
    const removed = await db.delete(userInvitations)
      .where(and(eq(userInvitations.id, invitationId), isNull(userInvitations.acceptedAt)))
      .returning({ id: userInvitations.id });
    if (!removed.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found or already accepted.' });
    return { ok: true as const };
  }

  async setRole(actorId: string, userId: string, role: UserRole) {
    if (actorId === userId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot change your own role.' });
    const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
    if (target.role === 'superadmin' && role !== 'superadmin') {
      const others = await db.query.users.findMany({ where: eq(users.role, 'superadmin') });
      if (others.length <= 1) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The workspace needs at least one super admin.' });
    }
    await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
    invalidateAccess(userId);
    return { ok: true as const };
  }

  async setPermissions(actorId: string, userId: string, raw: Record<string, string>) {
    const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
    if (target.role === 'superadmin') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Super admins always have full access to every feature.' });
    const permissions = sanitizePermissions(raw);
    await db.transaction(async (tx) => {
      await tx.delete(userPermissions).where(eq(userPermissions.userId, userId));
      if (Object.keys(permissions).length) {
        await tx.insert(userPermissions).values(
          Object.entries(permissions).map(([feature, level]) => ({ userId, feature, level }))
        );
      }
    });
    invalidateAccess(userId);
    return { ok: true as const };
  }

  async setDisabled(actorId: string, userId: string, disabled: boolean) {
    if (actorId === userId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot disable your own account.' });
    const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
    if (target.role === 'superadmin') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Super admin accounts cannot be disabled.' });
    await db.update(users).set({ disabledAt: disabled ? new Date() : null, updatedAt: new Date() }).where(eq(users.id, userId));
    invalidateAccess(userId);
    return { ok: true as const };
  }
}

export async function findValidInvitation(token: string, email?: string) {
  const invitation = await db.query.userInvitations.findFirst({
    where: and(
      eq(userInvitations.tokenHash, digest(token)),
      isNull(userInvitations.acceptedAt),
      gt(userInvitations.expiresAt, new Date()),
    ),
  });
  if (!invitation) return null;
  if (email !== undefined && normalizeEmail(email) !== invitation.email) return null;
  return invitation;
}

async function canManageUserManagement(userId: string, need: FeatureLevel) {
  const access = await getUserAccess(userId);
  if (access.disabled) return false;
  return featureAllowed(access, 'user_management', need);
}

export { canManageUserManagement };

function inviteEmailHtml(inviterName: string, link: string, role: UserRole) {
  const escaped = inviterName.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]!);
  const escapedLink = link.replace(/"/g, '&quot;');
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>You are invited to YLAAM-MEET</h2><p>${escaped} invited you to join their YLAAM-MEET workspace as a <strong>${role}</strong>.</p><p><a href="${escapedLink}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px">Accept invitation</a></p><p>Or paste this link in your browser:<br>${link}</p><p>This invitation expires in 7 days.</p></div>`;
}
