# Phase 2 authentication E2E

## Environment decision

Inspection on 2026-09-26 found that `backend/.env` configures PostgreSQL at `aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`, through Drizzle/postgres-js. No dedicated test environment was identified. Resend is configured. `NODE_ENV` defaults to development, which does NOT establish that the hosted database is safe for tests. The active application's authentication uses its own `users` and `authCodes` tables, password hashes and JWTs, not Supabase Auth.

Playwright serves the frontend at `http://127.0.0.1:5174` with `VITE_API_BASE_URL=/api`. Without interception, Vite would proxy API requests to `http://127.0.0.1:3001`; a backend started normally there would load the existing backend .env. Therefore no live backend/auth/database requests were allowed or run for this phase. No real .env was modified.

## What runs safely now

```sh
# From frontend; Playwright is already installed.
npm run test:e2e -- e2e/auth.mock.spec.ts e2e/smoke.spec.ts --project=chromium
npm run test:e2e:typecheck
```

Use `npm.cmd` on Windows if PowerShell blocks npm.ps1. The suite asserts the required logout/privacy behavior. The original failure assertions are preserved after the application fixes; no failures are skipped or marked expected.

`auth.mock.spec.ts` exercises the real browser UI with in-memory mocked tRPC responses. Its fixture generates random, disposable input values per test using the reserved `.invalid` domain. These are NOT accounts, passwords, or JWTs valid against any server. No real credentials or environment secrets are read by the fixture. The token is an opaque synthetic value. This proves frontend behavior, not backend credential verification, password hashing, JWT validation, or database authorization.

The fixture intercepts every API request before Vite can proxy it. Only login, account lookup, a read-only account-list sentinel, and explicitly enabled mock signup responses are allowed. Every other API method fails the test. External HTTP traffic and non-Vite WebSockets are blocked; service workers are disabled. There are no route.fetch calls and no requests to a real backend. The existing Phase 1 smoke guard remains unchanged.

Coverage:

- Login modal loads (existing smoke test).
- Accepted synthetic login and localStorage session values.
- Incorrect-password message and successful retry.
- Nonexistent-email message.
- Required email, required password, malformed-email native validation with no API calls.
- Logout clears storage and remains logged out on reload.
- Session survives Settings/Home navigation and is revalidated on reload.
- Rejected/expired session is cleared after reload.
- Cached private account data must disappear after logout (privacy regression).
- Logout must update another open tab (privacy regression).
- Signup password strength/confirmation validation without API calls.
- Mock signup response advances to verification UI; no account/code/email is created.

The app has no separate /login or protected dashboard route: login is a modal on `/` and account views are React tabs. The privacy test only displays a generated sentinel in the existing account list, then logs out. It does not create, schedule, start, edit, or delete meetings or test scheduling functionality. Settings navigation is used without activating any media controls.

## Required before real credential tests

Real valid/incorrect-password/nonexistent-user tests are BLOCKED by missing verified test-environment configuration. No live-test runner or signup provisioning was activated. Please configure/provide:

1. A separate disposable local/test PostgreSQL database or explicitly identified non-production Supabase project, using the existing schema. Do not point tests at the current unclassified hosted database.
2. A backend process using that database and a dedicated test JWT secret. Supply `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=test`, `PORT=3001`, and local CORS origins via an isolated test environment. Disable loading the real backend .env using `DOTENV_CONFIG_PATH` pointing to your separate test-only environment file. Exclude Resend, Supabase service-role, LiveKit and AI keys, and do not start the notification worker.
3. An already provisioned, email-verified test account in that database. Account provisioning/migrations are not performed by this phase.
4. Test-specific shell/CI variables for the next live phase: `E2E_TEST_EMAIL`, `E2E_TEST_PASSWORD`, and `E2E_NONEXISTENT_EMAIL` (a valid-format address confirmed absent from that isolated database). Incorrect passwords can be generated at runtime. Do not commit these values or put production credentials in them.
5. Confirm the exact backend URL and which isolated database/project that process uses before allowing any live execution. With the current proxy, the backend URL is `http://127.0.0.1:3001`; a different target requires a reviewed test-only connection configuration.

No variables are required to run the current mocked tests. The three credential variables above are configuration requirements for the deferred live phase, not currently consumed by the mocked suite. `E2E_AUTH_STORAGE_STATE` remains optional for the existing future storage-state fixture; it is not used here. `CI` retains its standard Playwright behavior. Real signup and email verification/reset delivery remain deferred even once login credentials are supplied.

## Findings from source inspection (before the approved fixes)

- `AuthService.verifyEmail` checks/consumes a code only when `emailVerifiedAt` is absent, then returns a session unconditionally. The public router accepts any six-digit code. For an already verified address, this appears to issue a JWT without proving code/password possession. This is a high-priority authentication bypass finding from source inspection, not a live exploit test. No endpoint was contacted and no fix was made.
- AuthModal labels are not linked to inputs, and the modal has no dialog semantics (previously reported). Tests use existing placeholders/native attributes rather than modifying the app.

Execution results and reproduced regressions are recorded after running the suite. Browser artifacts contain only synthetic values; do not reuse this artifact policy for real credentials without reviewing trace/screenshot exposure.

## Results — 2026-09-26

Chromium: **12 PASS, 2 FAIL** (13 new auth cases plus the existing smoke test). The two failures are retained as normal failing regression tests.

| Scenario | Result / classification |
| --- | --- |
| Login UI loads | PASS |
| Accepted synthetic credentials | PASS — mocked API; real credentials BLOCKED by configuration |
| Incorrect password + retry | PASS — mocked API; real password verification BLOCKED by configuration |
| Nonexistent email | PASS — mocked API; real database lookup BLOCKED by configuration |
| Required email | PASS — native browser validation |
| Required password | PASS — native browser validation |
| Malformed email | PASS — native browser validation |
| Logout clears storage and survives reload | PASS |
| Navigation/reload preserves and revalidates session | PASS — mocked API |
| Rejected session cleared after reload | PASS — mocked API |
| Private account data hidden after logout | FAIL — application state/privacy bug |
| Logout reflected in another open tab | FAIL — application session synchronization bug |
| Signup strength/confirmation validation | PASS — local validation |
| Signup advances to verification UI | PASS — mocked response only; real signup/delivery NOT RUN |

Failure 1: after a successful UI logout and confirmed removal of both localStorage auth keys, the generated private account-list heading remains visible for the entire 10-second assertion timeout. `App.tsx` clears storage and user state but does not clear the loaded meetings/account data or reset/guard the active view. This demonstrates cached UI exposure, not a bypass of backend authorization. The later navigation assertion is not reached because the first privacy assertion fails.

Failure 2: two pages share the same browser context/origin; after logout in the first, both localStorage auth keys are confirmed absent in the second, yet its signed-in profile remains and Login does not appear within 10 seconds. `App.tsx` initializes account state from storage but has no storage-event synchronization. No assumption about server-side JWT revocation is made.

No test or environment failure occurred in the auth browser suite. Live credential scenarios remain configuration-blocked, not passing. No application fixes were made or assertions weakened. Existing source inspection findings above remain separate from these two browser reproductions.

No Supabase/database server was contacted, no persistent database record was created/modified/deleted, and no Resend/email request was sent. Existing backend regression tests use in-memory persistence/provider doubles, not a live service.

Regression validation: existing frontend tests 7/7 PASS; existing backend tests 90/90 PASS with real dotenv loading disabled and mocked providers; frontend lint, E2E typecheck, backend typecheck, and both production builds PASS. The existing frontend large-chunk warning remains. No Playwright packages were reinstalled, and configuration, application source, migrations, schema, and real .env files were unchanged in Phase 2. Files added: auth.mock.spec.ts, fixtures/auth-mock.ts, AUTHENTICATION.md. File updated: e2e/README.md.


## Approved authentication fixes ? 2026-09-26

The previous results above describe the pre-fix baseline. The confirmed verification bypass and logout privacy issues have now been fixed without changing schema or migrations.

- `App.tsx`: one session-removal cleanup clears account data, current meeting display, private editing/join state, pending UI state, active tab, and toasts. Private data is also gated on the current user. Private modals unmount, and the auth modal gets a fresh instance so old form details do not survive logout. Account-load responses are checked against the current token and session generation to prevent stale responses repopulating data after logout.
- `lib/auth.ts`: session clearing dispatches a same-tab event; a storage-event subscription observes logout/token/user removal and storage clearing in other tabs. Persisted users without a token no longer initialize an authenticated UI. Normal login/session persistence remains unchanged.
- `auth.service.ts`: verification completes registration only. Missing/malformed codes are rejected and already-verified accounts must use password login, consistent with the existing resend/login flow. Unverified accounts require a matching, unexpired, single-use verification code. Code deletion and account activation run in one transaction; DELETE rechecks the hash and expiry and must return a consumed row before proceeding. This prevents concurrent reuse and rolls back consumption if activation fails. The shared code-consumption helper also retains single-use protection for reset codes; no password-reset email test was introduced.

Regressions added:

- Backend: valid, invalid, expired, already-verified invalid, already-verified matching leftover code, missing/empty code at both router/service boundaries, replay, parallel verification, expiry during consumption, activation rollback (10 tests).
- Browser: original logout privacy assertions retained; cross-tab case now also checks private-data removal; token removal and localStorage.clear in another tab; retained auth form cleanup and successful fresh login.

All browser APIs remain mocked/blocked, and all backend persistence/provider calls use test doubles. No production Supabase access, live database updates, Resend email, or schema/migration changes were performed. Scheduling E2E remains out of scope.

Final post-fix validation: Chromium authentication + smoke 17/17 PASS (16 auth + 1 smoke); backend authentication 17/17 PASS; complete backend suite 100/100 PASS (includes authentication); existing frontend tests 7/7 PASS; frontend/backend/E2E typechecks PASS; frontend/backend production builds PASS. Existing Vite chunk-size warning only. All services remained mocked; no live verification request was made.
