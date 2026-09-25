import { z } from 'zod';
import { t } from '../trpc/init.js';
import { AuthService } from '../services/auth.service.js';
import { protectedProcedure } from '../trpc/protected.js';

const authService = new AuthService();

export const authRouter = t.router({
  signup: t.procedure
    .input(
      z.object({
        fullName: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8),
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
      password: z.string().min(8).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
    }))
    .mutation(({ input }) => authService.resetPassword(input.email, input.code, input.password)),

  me: protectedProcedure.query(async ({ ctx }) => {
    return authService.me(ctx.user!.id);
  }),
});
