import { createHTTPServer } from '@trpc/server/adapters/standalone';
import cors from 'cors';
import { env } from './env.js';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';
import { attachWhiteboardServer } from './realtime/whiteboard.js';
import { assertDatabaseReady } from './db/readiness.js';
import { client } from './db/index.js';

try {
  await assertDatabaseReady();
  if (env.NODE_ENV === 'production' && !env.RESEND_API_KEY) {
    throw new Error('Email configuration is missing.');
  }
} catch {
  console.error('Backend startup stopped: check database connectivity, apply npm run db:migrate, and configure RESEND_API_KEY in production.');
  await client.end({ timeout: 5 });
  process.exit(1);
}

const allowedOrigins = new Set(
  env.CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const server = createHTTPServer({
  router: appRouter,
  createContext,
  onError({ error, path }) {
    if (error.code === 'INTERNAL_SERVER_ERROR') {
      // Never log SQL, input, provider responses or credentials.
      console.error(JSON.stringify({ event: 'rpc_server_error', procedure: path, code: error.code }));
    }
  },
  middleware(req, res, next) {
    if (req.method === 'GET' && req.url === '/health/ready') {
      void assertDatabaseReady().then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end('{"ready":true}');
      }).catch(() => {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end('{"ready":false}');
      });
      return;
    }
    cors({
      origin(requestOrigin, callback) {
        if (!requestOrigin || allowedOrigins.has(requestOrigin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${requestOrigin} is not allowed`));
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })(req, res, next);
  },
});

attachWhiteboardServer(server);

server.listen(env.PORT, () => {
  console.log(`YLAAM-MEET tRPC backend listening on http://localhost:${env.PORT}`);
});
