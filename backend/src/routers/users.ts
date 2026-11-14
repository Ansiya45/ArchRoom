import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../trpc/init.js';
import { protectedProcedure } from '../trpc/protected.js';
import { requireFeature, requireSuperadmin } from '../services/permission.service.js';
import { findValidInvitation, UserAdminService } from '../services/user-admin.service.js';

const service = new UserAdminService();
const permissionInput = z.record(z.string(), z.enum(['none', 'read', 'write', 'full']));

export const usersRouter = t.router({
  myAccess: protectedProcedure.query(({ ctx }) => service.myAccess(ctx.user!.id)),

  verifyInvitation: t.procedure
    .input(z.object({ token: z.string().min(1).max(200) }))
    .query(async ({ input }) => {
      const invitation = await findValidInvitation(input.token);
      if (!invitation) throw new TRPCError({ code: 'NOT_FOUND', message: 'This invitation link is invalid or has expired.' });
      return { email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString() };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    await requireFeature(ctx.user!.id, 'user_management', 'read');
    return service.listUsers();
  }),

  invite: protectedProcedure
    .input(z.object({
      email: z.string().email().max(255),
      role: z.enum(['admin', 'user']).default('user'),
      permissions: permissionInput.optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await requireFeature(ctx.user!.id, 'user_management', 'write');
      return service.invite(ctx.user!.id, input);
    }),

  listInvitations: protectedProcedure.query(async ({ ctx }) => {
    await requireFeature(ctx.user!.id, 'user_management', 'read');
    return service.listInvitations();
  }),

  resendInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireFeature(ctx.user!.id, 'user_management', 'write');
      return service.resendInvitation(ctx.user!.id, input.invitationId);
    }),

  revokeInvitation: protectedProcedure
    .input(z.object({ invitationId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await requireFeature(ctx.user!.id, 'user_management', 'write');
      return service.revokeInvitation(input.invitationId);
    }),

  setRole: protectedProcedure
    .input(z.object({ userId: z.string().uuid(), role: z.enum(['superadmin', 'admin', 'user']) }))
    .mutation(async ({ input, ctx }) => {
      await requireSuperadmin(ctx.user!.id);
      return service.setRole(ctx.user!.id, input.userId, input.role);
    }),

  setPermissions: protectedProcedure
    .input(z.object({ userId: z.string().uuid(), permissions: permissionInput }))
    .mutation(async ({ input, ctx }) => {
      await requireFeature(ctx.user!.id, 'user_management', 'write');
      return service.setPermissions(ctx.user!.id, input.userId, input.permissions);
    }),

  setDisabled: protectedProcedure
    .input(z.object({ userId: z.string().uuid(), disabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await requireFeature(ctx.user!.id, 'user_management', 'full');
      return service.setDisabled(ctx.user!.id, input.userId, input.disabled);
    }),
});
