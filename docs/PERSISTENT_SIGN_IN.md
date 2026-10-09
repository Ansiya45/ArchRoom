# Persistent sign-in deployment

Account sessions are separate from meeting sessions. Leaving or ending a meeting does not log out the account. Login and email verification now issue a short-lived access JWT plus a persistent device credential. The browser stores them in localStorage and renews access automatically before API requests (including when returning the next day). Concurrent requests in one tab share a renewal. Logout clears browser state immediately, revokes the device credential on the server, and cannot be undone by a late renewal response.

Device credentials have no automatic time expiry. Their SHA-256 digests are stored in `auth_sessions`; raw values must never be logged. Logout revokes that device, password changes invalidate all prior device sessions, and deleting the user cascades to sessions. Access tokens tied to a revoked session are also rejected. Temporary network, server, or database failures retain browser credentials and offer a retry.

## Deploy

1. From `backend`, run `npm ci`, `npm run build`, then `npm start`. The `prestart` script applies pending migrations before launching the server and stops the release if migration fails. Include the `drizzle` folder alongside `dist` in the deployment artifact. Migration runners share a transaction-scoped database lock so concurrent replicas cannot apply the same migration twice.
2. Deploy the backend, then the frontend. Keep the existing `JWT_SECRET` stable and keep `JWT_EXPIRES_IN=1h`; access expiry no longer requires a manual login.
3. Users signed in before this feature need to sign in once to receive a persistent device credential. Previously issued JWTs retain their original expiry; expired tokens cannot establish a new session.
4. Verify signup/login, close and reopen the app, leave/end a meeting, and explicitly log out. A browser with cleared site data, private browsing, or a different device still needs its own login.

If the browser is offline when Logout is pressed, local sign-out still completes, but server revocation cannot be confirmed. The UI reports that failure. No database migration or production deployment is performed by the local tests.

## Release checks

- If the hosting platform bypasses `npm start` (for example, runs `node dist/index.js`), configure `node dist/db/migrate-cli.js` as its release command. For local development, use `npm run db:migrate` before `npm run dev`. The backend always checks the migration journal and every authentication column before opening its port, even when launched directly.
- Configure the host's readiness probe to `GET /health/ready`. Expect HTTP 200 with `{"ready":true}`. Database/schema failures return HTTP 503 without database details. Route traffic to the new instance only after this probe passes. Keep the previous healthy instance serving during a failed release.
- Production startup also requires `RESEND_API_KEY`; verify the configured sender with the email provider. The readiness probe checks the database, not email delivery or provider credentials.
- GitHub's **Authentication checks** workflow runs backend tests and real PostgreSQL integration tests on pushes and pull requests. Make its `authentication` job a required branch check and configure hosting to deploy only successful checks. Adding the workflow alone does not change repository protection or hosting settings.
- Integration tests simulate the previous schema, concurrent migration runners, repeated releases, signup, verification, login, refresh, logout, password reset, replay rejection, and a missing session table. Email delivery alone is mocked. They require a fresh local database named `archroom_auth_test` supplied through `TEST_DATABASE_URL`; they refuse to use the normal `.env` database. Run `npm run test:integration` separately from unit tests.
- After deployment, use a dedicated test account to verify real email delivery, login, reload/session renewal, and logout through the public site. Never put real credentials in CI logs. This manual/provider check is still necessary; database tests cannot prove mail delivery.
- Watch structured `rpc_server_error` events in backend logs. These intentionally exclude request inputs, SQL and tokens. Configure your hosting provider's alerting for repeated errors or readiness failures.

If verification succeeded but session creation or its response failed, the verification screen now offers **Back to sign in**, preserving the email address so the user can recover without another signup.
