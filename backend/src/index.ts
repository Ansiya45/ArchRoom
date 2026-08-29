import { createHTTPServer } from '@trpc/server/adapters/standalone';
import cors from 'cors';
import { env } from './env.js';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';
import { attachWhiteboardServer } from './realtime/whiteboard.js';

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

attachWhiteboardServer(server);

server.listen(env.PORT, () => {
  console.log(`YLAAM-MEET tRPC backend listening on http://localhost:${env.PORT}`);
});
