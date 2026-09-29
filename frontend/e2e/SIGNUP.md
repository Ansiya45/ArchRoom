# Signup-only browser coverage

Run from `frontend`:

```powershell
npm.cmd run test:e2e:signup
```

This suite uses the authorized development database in `backend/.env`. It preserves the existing registration endpoint and Resend verification-email trigger. It never enters a code, calls verifyEmail/resendVerification, reads an inbox, or proceeds to other features.

## Dedicated recipient configuration

Add `E2E_SIGNUP_EMAIL` to the already Git-ignored `frontend/.env.e2e.local`. Use a fresh dedicated email address or alias you control. It must differ from both `E2E_TEST_EMAIL` and `E2E_NONEXISTENT_EMAIL`, and must not already exist in YLAAM's users table. The application's normal signup email will be sent there. No invented recipient or unrelated account is used.

Optional: `E2E_SIGNUP_PASSWORD` in the same local file if you want to retain knowledge of the test account's password. Otherwise the test generates a strong random password in memory and does not save it. Never prefix either value with VITE_. No credentials belong in chat or committed source.

Without `E2E_SIGNUP_EMAIL`, the successful new-user case is explicitly SKIPPED. Form validation and duplicate-email coverage still run. Once set, the test creates exactly one user with a name starting `YLAAM E2E signup ` followed by a unique run identifier. This record and its verification-code record are retained. No automated cleanup is performed. For another successful-signup run, supply a new alias; the test refuses to overwrite/delete an existing account.

## Behavior and boundaries

- Local browser tests cover opening the form, four required fields, malformed email, short passwords, missing uppercase/lowercase/digits, and confirmation mismatch. Their fixture blocks all API calls.
- The real duplicate test uses only the existing dedicated E2E account, expects CONFLICT, and compares exact user/code snapshots before/after without printing them.
- The real new-user test checks absence before submission, accepts only auth.signup to the approved recipient, and inspects the resulting row. It checks bcrypt cost 10, bcrypt comparison against the submitted password, inequality with plaintext, null email_verified_at, and one verification-code row.
- Direct inspection uses BEGIN READ ONLY and email-/user-ID-scoped SELECTs. Tests never directly insert, update, or delete database records. Only the application's signup implementation performs the authorized signup writes.
- The dedicated signup config extends the real-auth infrastructure and restores the current backend RESEND_API_KEY/EMAIL_FROM only for its backend child. It does not alter Resend/DNS settings or real .env files. Normal login tests still exclude email credentials.
- API interception permits only auth.signup for the two configured test addresses and an E2E-labelled name. Other API endpoints, external browser requests and conferencing sockets are blocked.
- Retries are disabled. Real traces/screenshots/video are disabled and `test-results-signup/` is Git-ignored.

A successful registration response means the existing sendEmail call returned successfully; it does not prove inbox delivery. Signup has not been bypassed or modified for tests. Existing authentication tests remain intact.

## Source-inspection findings (application unchanged)

1. Password-policy mismatch (now fixed): the signup router now uses AuthModal's exact regex and validation message: at least eight characters, ASCII uppercase, ASCII lowercase and a digit. Invalid direct API submissions receive BAD_REQUEST before the signup service executes. Seven isolated backend regression tests cover each requirement, empty input, line-break semantics and a valid minimum-length password without symbols. Bcrypt hashing is unchanged.
2. Failure-state behavior: signup inserts the user before running the verification-code/email transaction. If email sending fails, the user remains unverified while code creation rolls back, and retrying signup returns duplicate-email conflict. This is a source-inspected partial-registration risk; it was not deliberately triggered against Resend. Recovery/fixes are outside this signup test change.

No application fixes, schema changes or migrations are included.

## Run results — 2026-09-27

Signup: 12 PASS, 1 SKIPPED. Form opening, all four required fields, invalid email, four password requirements, confirmation mismatch, and real duplicate-email rejection passed. The skipped case covers successful creation, bcrypt storage, unverified state, and the natural verification-email trigger: E2E_SIGNUP_EMAIL is not configured. Those outcomes are NOT claimed as tested.

Development Supabase was contacted for duplicate detection and scoped read-only snapshots of the dedicated existing account and its auth-code rows. Before/after snapshots matched. Zero database records were created, modified, or deleted, and no verification email was triggered. No verification endpoint was called.

Existing mocked authentication + smoke: 17/17 PASS. Existing frontend tests: 7/7 PASS. Frontend lint/typecheck and E2E typecheck: PASS.

The first attempted run exposed a test configuration bug: passing two configs to defineConfig concatenated webServer arrays and tried starting duplicate servers. It was corrected by composing a single config object. No application behavior was changed.

### Follow-up after configuring the signup recipient — 2026-09-27

Complete signup suite: **13/13 PASS**, with no skips. Real signup succeeded through the frontend, Vite proxy, backend and authorized development PostgreSQL database. Scoped read-only inspection confirmed the dedicated user, a matching bcrypt cost-10 password hash distinct from plaintext, null email_verified_at, and exactly one verify_email code record. The browser showed the verification prompt without receiving an authenticated session.

The normal verification-email send completed successfully. Inbox delivery was not checked, and no verification was attempted. One dedicated users row and one auth_codes row were created and retained. Existing duplicate-account snapshots matched; no unrelated records were modified or deleted. The signup implementation's code replacement DELETE was scoped to the newly created user's verification codes, with no prior codes to remove.

Regressions: mocked authentication plus smoke **17/17 PASS**; real authentication **3/3 PASS**; existing backend auth.test.ts unit tests with fake accounts **7/7 PASS**; frontend unit tests **7/7 PASS**. Frontend, backend and E2E typechecks all passed. Real authentication exercised existing login and account reads only; no signup or email was triggered by those regressions. No new application bugs were observed; the source-inspection findings above remain unchanged.

Only this results document was edited during the follow-up. No application code, test assertions, environment files, schema or migrations were changed.

For another full signup run, configure a **fresh owned E2E_SIGNUP_EMAIL alias** in frontend/.env.e2e.local first. The successful account is retained, so repeating with the same address intentionally fails the absence precondition without submitting signup. Do not reuse E2E_NONEXISTENT_EMAIL.
