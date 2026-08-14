import { createHTTPServer } from '@trpc/server/adapters/standalone';
import cors from 'cors';
import { env } from './env.js';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';

const allowedOrigins = new Set(
  env.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const server = createHTTPServer({
  router: appRouter,
  createContext,
  middleware: cors({
    origin(requestOrigin, callback) {
      if (!requestOrigin || allowedOrigins.has(requestOrigin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${requestOrigin} is not allowed`));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
});

server.listen(env.PORT, () => {
  console.log(`ArchRoom tRPC backend listening on http://localhost:${env.PORT}`);
});
