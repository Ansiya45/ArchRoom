# Playwright E2E foundation

## Repository placement

Playwright lives in `frontend`: there is no root package or workspace configuration. The active application starts from `frontend/index.html` and `src/main.tsx` using Vite and React Router. Routes are `/`, `/meet/:meetingCode`, and `/meeting-notifications`. The frontend npm scripts start Vite on 5173, build with TypeScript/Vite, and preview on 4173. `backend` is a separate npm package; `npm run dev` starts its tRPC server with `tsx watch src/index.ts` on 3001. The Vite `/api` proxy targets that server. Older Next.js and Django files also exist, but the current npm development commands do not start them.

The existing `frontend/tests/*.test.ts` and `backend/tests/*.test.ts` suites use Node's test runner. They are separate from `frontend/e2e`; Playwright only discovers `e2e/**/*.spec.ts`. Existing tests and application code are unchanged by this setup.

## Install and run

From `frontend`:

```sh
npm ci
npx playwright install chromium
npm run test:e2e
```

Run only the smoke test:

```sh
npm run test:e2e -- e2e/smoke.spec.ts --project=chromium
```

Interactive mode: `npm run test:e2e:ui`. Type-check the test infrastructure: `npm run test:e2e:typecheck`. On PowerShell systems that block npm.ps1, use `npm.cmd` and `npx.cmd` in place of `npm` and `npx`.

Only `@playwright/test` is added as a direct development dependency; its runner includes the required Playwright dependencies. Chromium is the only configured/installed browser family. npm/package-lock.json is used because this repository already tracks it and npm is available. The older frontend bun.lock already differs from package.json; it is retained, not regenerated. Use npm for this documented workflow.

## Server and isolation

Playwright reuses the existing `npm run dev` command with `--host 127.0.0.1 --port 5174 --strictPort --mode e2e`. The dedicated local port avoids interfering with development on 5173. It starts and stops its own server and refuses to reuse an existing process on 5174. Free that port if startup fails. There is no remote/production base-URL override.

The smoke test does not start the backend: the logged-out landing page and opening the login modal require no backend. It uses an empty browser session, verifies the brand and login fields, and never submits a form. Its automatic fixture blocks API/fetch/XHR calls, non-read HTTP methods, external HTTP resources, and non-Vite WebSockets. An attempted API call or mutation fails the test. Service workers are disabled so they cannot bypass routing. The actual application UI is loaded; authentication responses are not mocked.

Vite normally reads `.env` files. The test server overrides `VITE_API_BASE_URL=/api` in its process environment so an existing external API URL cannot direct this smoke flow to a production API. The browser network guard blocks `/api` before it reaches Vite's proxy. No real `.env` file is written. No backend, notification worker, migrations, account creation, email submissions, or Supabase operations are run by Playwright.

Reports go to `playwright-report/`; failure screenshots/traces go to `test-results/`. These and `blob-report/`, `playwright/.cache/`, and `playwright/.auth/` are ignored. Actual test source is tracked. Treat future authenticated traces and storage-state files as credentials; do not share or commit them.

## Authentication foundation — not executed in this phase

The current login form calls `auth.login` through tRPC. The backend validates an existing user's password and requires `emailVerifiedAt`; successful login returns a JWT and `{ id, email, fullName }`. The frontend stores these in localStorage under `ylaam_meet_token` and `ylaam_meet_user`. API requests send the JWT as a Bearer token. The logged-in homepage subsequently calls `auth.me` and `meetings.list`. Tokens expire according to backend `JWT_EXPIRES_IN` (default one hour).

Signup, resend verification, and password reset can write database records and send Resend emails. None is part of the smoke flow. Do not use signup to create an E2E account against the real environment.

`e2e/fixtures/authenticated.ts` exports an opt-in `authenticatedTest` fixture for the next phase. No current spec imports it. It restores browser state only; it does not generate tokens, bypass backend authentication, sign in, or provision users. There is deliberately no automatically executed auth setup project.

Environment variables:

| Variable | Needed now? | Purpose |
| --- | --- | --- |
| `CI` | No | Standard CI flag: forbids test.only and enables one retry. |
| `E2E_AUTH_STORAGE_STATE` | No | Future fixture only: absolute path, or path relative to frontend, to an existing Playwright storage-state JSON for an isolated test account. Prefer `playwright/.auth/user.json`. |

No test email/password, API key, Supabase key, Resend key, or LiveKit key is required for the smoke test. `E2E_AUTH_STORAGE_STATE` is not loaded from a real .env file; set it in the shell/CI environment when future authenticated tests are explicitly enabled. No credentials or state were created during this setup.

Before activating authenticated tests in the next approved phase, provide an isolated test database/backend with an already verified test account and disabled/excluded external email/media services. Start that backend using the existing backend `npm run dev` command with test-only environment variables (including a dedicated `DATABASE_URL` and `JWT_SECRET`), never the production .env. The existing Vite proxy expects backend port 3001. Capture state for the same frontend origin, and refresh it when its JWT expires. Test-backend startup/auth-state generation and scheduling/conferencing/email automation are intentionally not implemented yet.

## Observations

The existing AuthModal Field labels are not associated with their inputs using htmlFor/id, and its container lacks dialog semantics. The smoke test uses the existing heading, email placeholder, and password autocomplete attribute; application accessibility changes are deferred rather than made to satisfy tests.

The frontend's existing production build emits a large-chunk warning. This setup does not change bundling or application functionality.

Playwright references: [webServer configuration](https://playwright.dev/docs/test-webserver), [browser installation](https://playwright.dev/docs/browsers).

## Validation of this foundation

- Chromium smoke: passed (one test), including the no-API/no-mutation assertion.
- Existing frontend Node tests: 7 passed.
- Existing backend Node tests: 90 passed with persistence/email/provider doubles. Real dotenv loading was disabled during validation.
- Frontend lint/type check, E2E type check, frontend production build, backend type check, and backend production build passed.
- The legacy Django suite was preserved but not run; this change targets the active npm/Vite/tRPC application.

On the restricted Windows agent, tsx could not read OS user information and Playwright could not clean up its managed server process tree inside the sandbox. Running those commands with the required execution permission resolves the environment restriction; no application workaround was added. The existing Vite chunk-size warning remains.

## Phase 2 authentication

See [AUTHENTICATION.md](AUTHENTICATION.md) for the isolated mocked-API authentication suite, environment audit, live-test configuration requirements, and application findings. No live credential or email tests have been enabled.

## Phase 2B real authentication

The separate opt-in real backend suite is documented in [REAL_AUTHENTICATION.md](REAL_AUTHENTICATION.md). Run `npm run test:e2e:real` only against the authorized development database. Default E2E runs continue to use mocked APIs.

## Signup-only testing

See [SIGNUP.md](SIGNUP.md) and run `npm run test:e2e:signup`. The new-user test requires a fresh, owned `E2E_SIGNUP_EMAIL` and preserves the normal verification-email trigger; it stops before verification.
