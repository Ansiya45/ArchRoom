# Phase 2B — real authentication

The user explicitly authorized the currently configured Supabase/PostgreSQL database as a development database. The real suite uses that database through the existing YLAAM backend; it never uses the mocked auth fixture.

## Run

From `frontend`:

```powershell
npm.cmd run test:e2e:real
```

On other shells, `npm run test:e2e:real` is equivalent. Playwright and Chromium are already installed. Both server ports must be free. Do not point `backend/.env` at production when running this command: the real suite deliberately uses its current `DATABASE_URL` and `JWT_SECRET`.

Required credentials are loaded from the Git-ignored `frontend/.env.e2e.local` (shell variables override file values):

- `E2E_TEST_EMAIL`: one existing, verified YLAAM user.
- `E2E_TEST_PASSWORD`: that user's password.
- `E2E_NONEXISTENT_EMAIL`: valid-format email that is absent from the development database.

No credentials are committed. This is a YLAAM `users` account, not a Supabase Auth account. Missing variables fail before server startup. No user provisioning is performed.

## Real connection path

Playwright Chromium -> frontend `http://127.0.0.1:5175` -> Vite `/api` proxy -> existing tRPC backend `http://127.0.0.1:3002` -> the database configured in `backend/.env`.

`playwright.real.config.ts` runs the existing backend `npm run dev` command on an isolated port and the existing frontend `npm run dev` command with `vite.e2e.config.ts`. That small Vite config extends the normal config and changes only the proxy target. Neither server is reused; Playwright starts/stops both. Normal development ports 5173/3001 are unchanged.

The backend receives the authorized database/JWT settings explicitly; real dotenv loading is disabled for that child process. Supabase Storage, Resend, LiveKit, and OpenAI provider credentials are excluded, and no notification worker is started. The database URL is never logged or edited.

## Allowed operations and data effects

The browser request guard permits only:

- `POST auth.login`: reads the dedicated user's row; bcrypt compares the password; the backend signs a JWT. It does not update login timestamps or user records.
- `GET auth.me`: reads the authenticated user.
- `GET meetings.list`: the homepage's existing account-data load reads `meetings` and `meeting_participants`; it performs no creation, scheduling, or conferencing actions.

Every other API request and non-Vite WebSocket is blocked and fails the test. External resources/data requests are blocked. The health readiness check does not access the database. The allowed auth responses are genuine backend responses; no route.fulfill is used by the real suite.

Session persistence/logout changes browser localStorage only. No database records are created, updated, or deleted by these tests. This conclusion follows from the endpoint allowlist and inspected service implementations; it is not a global audit of concurrent activity by other database clients.

Real traces, screenshots, video, and HTML reporting are disabled to avoid retaining credentials/tokens/private account data. `test-results-real/` and `playwright/.auth/` are Git-ignored. No reusable auth-state file is generated. Do not enable diagnostic network logging or traces with real credentials without reviewing exposure.

## Coverage and results

On 2026-09-26 all three real browser tests passed:

1. Successful verified-account login, real `auth.me`, authenticated UI, real account-data response, page reload/session persistence, logout/UI removal, session absence after reload, and successful login again.
2. Incorrect password rejected as UNAUTHORIZED with the intended UI error; no browser session created.
3. Configured nonexistent email rejected as NOT_FOUND with the intended UI error; no browser session created.

Supabase PostgreSQL was contacted through the backend. Application database reads: `users`, `meetings`, and `meeting_participants` (including the driver's normal connection/type metadata queries). Application database writes: none. Existing records modified: none by this suite. Emails sent: none. No schema/migration changes or application behavior changes were made.

The default `npm run test:e2e` excludes `*.real.spec.ts`, preserving the credential-free mocked suite. To rerun mocked auth and smoke:

```powershell
npm.cmd run test:e2e -- e2e/auth.mock.spec.ts e2e/smoke.spec.ts --project=chromium
```

The suite uses no signup, verification delivery, password reset, scheduling mutations, LiveKit, invitations, reminders, or calendar integration. The existing mocked backend/frontend tests remain intact.

Validation for this phase: real auth 3/3 PASS; existing mocked auth + smoke 17/17 PASS; existing frontend tests 7/7 PASS; frontend/backend/E2E typechecks PASS; frontend production build PASS (existing chunk-size warning). No application bug was discovered and no application source was modified.
