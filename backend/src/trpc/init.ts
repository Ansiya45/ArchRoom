import { initTRPC } from '@trpc/server';
import type { Context } from './context.js';

export const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    if (error.code !== 'INTERNAL_SERVER_ERROR') {
      return shape;
    }

    return {
      ...shape,
      message: 'An unexpected server error occurred',
    };
  },
});
