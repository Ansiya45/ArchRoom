import { createHTTPServer } from '@trpc/server/adapters/standalone';
import cors from 'cors';
import { env } from './env.js';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';
import { attachWhiteboardServer } from './realtime/whiteboard.js';
import { assertDatabaseReady } from './db/readiness.js';
import { client } from './db/index.js';
import { googleDriveOAuth } from './services/google-drive-integration.runtime.js';
import { googleOAuthResultPage, oauthStateCookie, startGoogleOAuthFromNavigation } from './services/google-drive-oauth-start.service.js';
import { localIngestionHandler } from './services/local-recording-ingestion.runtime.js';
import { startCompanyRecordingUploadOrchestration } from './services/company-recording-upload-orchestrator.runtime.js';

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

const handleLocalIngestion = localIngestionHandler(allowedOrigins);
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
    if (req.url?.startsWith('/recording-staging/')) {
      void handleLocalIngestion(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/google-drive/oauth/start') {
      void (async () => {
        if (!env.GOOGLE_OAUTH_CALLBACK_URL || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))
          throw new Error('Invalid Google setup request.');
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += part.length;
          if (size > 8192) throw new Error('Google setup request is too large.');
          chunks.push(part);
        }
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        if (form.getAll('token').length !== 1) throw new Error('Invalid Google setup request.');
        const result = await startGoogleOAuthFromNavigation(form.get('token'), req.headers.origin, allowedOrigins,
          env.GOOGLE_INTEGRATION_ADMIN_USER_ID, googleDriveOAuth());
        res.writeHead(303, { Location: result.authorizationUrl,
          'Set-Cookie': oauthStateCookie(result.cookie, env.GOOGLE_OAUTH_CALLBACK_URL),
          'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        res.end();
      })().catch(() => {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Google authorization could not be started. Return to YLAAM Meet and retry.');
      });
      return;
    }
    if (env.GOOGLE_OAUTH_CALLBACK_URL && req.url && req.method === 'GET') {
      const callback = new URL(env.GOOGLE_OAUTH_CALLBACK_URL);
      const applicationReturnUrl = env.APP_PUBLIC_URL ?? callback.origin;
      const requestUrl = new URL(req.url, 'http://localhost');
      if (requestUrl.pathname === callback.pathname) {
        const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('ylaam_drive_oauth='))?.slice('ylaam_drive_oauth='.length) ?? '';
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Set-Cookie', oauthStateCookie('', env.GOOGLE_OAUTH_CALLBACK_URL, true));
        void Promise.resolve().then(() => googleDriveOAuth().complete({ state: requestUrl.searchParams.get('state') ?? '', cookie,
          code: requestUrl.searchParams.get('code') ?? undefined, error: requestUrl.searchParams.get('error') ?? undefined })
        )
          .then(() => { res.writeHead(200); res.end(googleOAuthResultPage(applicationReturnUrl, true)); })
          .catch((error: unknown) => {
            console.error('Google Drive OAuth callback failed', {
              message: error instanceof Error ? error.message : 'Unknown OAuth callback failure.',
            });
            res.writeHead(400);
            res.end(googleOAuthResultPage(applicationReturnUrl, false));
          });
        return;
      }
    }
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
startCompanyRecordingUploadOrchestration();

server.listen(env.PORT, env.NODE_ENV === 'test' ? '127.0.0.1' : undefined, () => {
  console.log(`YLAAM-MEET tRPC backend listening on http://localhost:${env.PORT}`);
});
