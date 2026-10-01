import { z } from 'zod';
import { t } from '../trpc/init.js';
import { AuthService } from '../services/auth.service.js';
import { protectedProcedure } from '../trpc/protected.js';
import { refreshSession, revokeSession } from '../services/auth-session.service.js';

const authService = new AuthService();
const newPassword = z.string().regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/, 'Use 8+ characters with uppercase, lowercase, and a number.');

export const authRouter = t.router({
  refresh: t.procedure
    .input(z.object({ refreshToken: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(({ input }) => refreshSession(input.refreshToken)),
  logout: t.procedure
    .input(z.object({ refreshToken: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(({ input }) => revokeSession(input.refreshToken)),
  signup: t.procedure
    .input(
      z.object({
        fullName: z.string().min(2),
        email: z.string().email(),
        // Match AuthModal's signup policy, including its character semantics.
        password: newPassword,
      })
    )
    .mutation(async ({ input }) => {
      return authService.signup(input);
    }),

  login: t.procedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1, 'Password is required'),
      })
    )
    .mutation(async ({ input }) => {
      return authService.login(input);
    }),

  verifyEmail: t.procedure
    .input(z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) }))
    .mutation(({ input }) => authService.verifyEmail(input.email, input.code)),

  resendVerification: t.procedure
    .input(z.object({ email: z.string().email() }))
    .mutation(({ input }) => authService.resendVerification(input.email)),

  requestPasswordReset: t.procedure
    .input(z.object({ email: z.string().email() }))
    .mutation(({ input }) => authService.requestPasswordReset(input.email)),

  resetPassword: t.procedure
    .input(z.object({
      email: z.string().email(),
      code: z.string().regex(/^\d{6}$/),
      password: newPassword,
    }))
    .mutation(({ input }) => authService.resetPassword(input.email, input.code, input.password)),

  me: protectedProcedure.query(async ({ ctx }) => {
    return authService.me(ctx.user!.id);
  }),
});
