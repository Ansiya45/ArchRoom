# Email verification coverage and manual boundary

## Final real result — 2026-09-28

The dedicated E2E mailbox received the real Resend verification email. Its received code was submitted through the browser/Vite proxy/backend and accepted; email_verified_at was populated, the code row was consumed, replay was rejected, and the account remains verified. The lost generated signup password was recovered through the normal forgot-password lifecycle rather than by editing the database. Historical boundary notes below describe the state before this completion.

## Cooldown implemented and controlled real test prepared

Verification-code sends now lock the account row, reject verified accounts under the lock, and check that account's verify_email records against database clock time. A record newer than 60 seconds produces TOO_MANY_REQUESTS before deletion/insertion/email. New verification records explicitly use clock_timestamp() for created_at, avoiding stale transaction-start timestamps after lock waits. Code expiry remains ten minutes and verification consumption is unchanged. No schema migration is needed. The earlier proposal below is historical.

Five isolated cooldown tests cover first send, rejection at 59.999 seconds, acceptance at 60 seconds, concurrent callers and account/purpose isolation. Database concurrency is modeled with a lock-aware test double; no live concurrency emails are sent.

Prepared real runner (NOT executed) uses playwright.verification.config.ts and verification.real.spec.ts. It supports exactly one explicit action and has no automatic retries or email resend. Credentials, code, traces and screenshots are not logged/saved. The existing account is checked for the dedicated E2E name and unverified state before any action. Verification requires its actual original E2E_SIGNUP_PASSWORD and the manually received E2E_VERIFICATION_CODE; the password is checked before consuming the code. Account activation, consumption, replay rejection, real auth.me, reload, logout and subsequent login are covered. Only the unrelated homepage meeting-list response is mocked empty; no real meeting endpoint is called.

From PowerShell, when ready to check the dedicated mailbox, trigger exactly one resend request:

```powershell
cd D:\Development\ArchRoom\frontend
$env:E2E_VERIFICATION_ACTION = 'resend'
npx.cmd playwright test --config playwright.verification.config.ts
Remove-Item Env:E2E_VERIFICATION_ACTION
```

Then save the latest received six-digit code as E2E_VERIFICATION_CODE in the Git-ignored frontend/.env.e2e.local and tell the assistant it is configured. Do not paste the code into chat. It expires after ten minutes. Do not rerun resend repeatedly. Final verification must wait for that confirmation; later it uses E2E_VERIFICATION_ACTION='verify' with the same command.

Current blocker: E2E_SIGNUP_PASSWORD is absent. It must be the existing signup account's original password, not E2E_TEST_PASSWORD unless that was actually used. The previous signup runner generated an unsaved random password when none was configured. If that fallback was used, the password cannot be recovered, and the requested subsequent-login check cannot run for this account without a separately authorized plan. Do not reset/change passwords or create another account automatically. Resolve this before requesting a fresh email so the code does not expire while resolving test data.

## Re-entry fix

The navigation gap described in the historical inspection below is now fixed. Sign in with the unverified account's correct password to reopen verification, including after closing the dialog or reloading. The frontend recognizes only the existing password-validated unverified-login error, clears password/code inputs, and opens verification without granting a session or sending email. Duplicate signup retains its error and adds guidance to use sign-in. Verified login and backend code validation are unchanged. Real verification remains pending the manual received-code step.

Re-entry regressions: `npm.cmd run test:e2e -- e2e/verification-reentry.mock.spec.ts --project=chromium`.

### Resend cooldown proposal (not implemented)

Use the existing auth_codes.created_at to enforce a 60-second per-account verification resend cooldown. Within one transaction, lock the dedicated users row, recheck unverified status, check the latest verify_email code creation time using database time, then replace the code and send only when permitted. Return TOO_MANY_REQUESTS while cooling down. The row lock makes concurrent requests across backend instances serialize, even if no code exists. Reuse the existing transaction rollback on provider failure. This requires no schema change; it is a per-recipient send cooldown, not a comprehensive IP/failed-attempt abuse limiter. Add isolated boundary, concurrent-request and provider-failure tests before implementation is shipped. No cooldown code is included in this change.

Run isolated verification browser coverage from frontend:

```powershell
npm.cmd run test:e2e -- e2e/verification.mock.spec.ts --project=chromium
```

All API responses in this suite are synthetic; no signup, email send or database write escapes the fixture. Browser tests cover the post-signup UI, empty/incomplete codes, incorrect/expired/already-verified error presentation, successful session storage, and in-flight resend disabling/input clearing. Error-response mocks test UI handling, not backend enforcement. Existing backend auth-verification.test.ts separately tests actual service/router logic with an in-memory database double: valid/invalid/expired codes, activation, consumption, replay, already-verified bypass prevention, concurrent consumption and rollback. Existing auth.test.ts tests resend rejection/replacement/provider failure with fake accounts/providers.

## Inspected flow

The backend generates six digits using crypto.randomInt, stores only SHA-256 in auth_codes with purpose verify_email and ten-minute expiry, and sends through Resend. Verification rejects already-verified accounts, consumes the unexpired code with an atomic conditional DELETE, and updates email_verified_at/updated_at in one transaction. It returns a signed session which the browser stores before closing the dialog. Resend replaces only that user's verification code in a transaction; provider failure rolls it back. Missing/verified recipients are rejected. The UI disables resend while pending; no server cooldown, attempt limit or rate limiter was found in the application source. No repeated real sends were exercised.

## Real mailbox boundary — 2026-09-27

Scoped read-only inspection confirmed that E2E_SIGNUP_EMAIL identifies the E2E-labelled account, email_verified_at is still null, and its one verification record has expired. No database rows were changed. No new email was sent. The prior signup run confirmed Resend accepted its send; actual inbox delivery is still unconfirmed. No mailbox automation is configured in the repository. Database hashes are not email-delivery evidence and were not used to recover a code.

There is also an application navigation gap: the verification view is reachable only after successful signup within the same open dialog. Closing/reloading loses it; login with an unverified account only reports an error, while re-registering returns duplicate email. Therefore the existing account cannot resume real browser verification through the current UI. No fake signup response or direct database activation should be used to hide this limitation. Report and obtain approval for a focused resume-verification UI fix before claiming full browser E2E coverage for this existing account.

## Next manual step

First approve addressing the resume-verification UI gap if full browser coverage for the existing account is required. Then coordinate one resend to E2E_SIGNUP_EMAIL when you are ready to check that mailbox. Open the actual received email yourself and save its latest six-digit code locally as E2E_VERIFICATION_CODE in D:\Development\ArchRoom\frontend\.env.e2e.local. That file is already Git-ignored. Do not paste the code or any mailbox password into chat, use a VITE_ variable, or commit the value. Remove the code after the controlled run. A newly received code must be submitted within ten minutes; the old signup code is already expired.

E2E_VERIFICATION_CODE is the proposed input for the pending real test, not consumed by the mocked command above. The real test is deliberately not implemented/run past this boundary. Once the UI gap and mailbox step are resolved, a real test must disable traces/screenshots/video, submit the received code once, inspect only this account for activation/consumption, and test replay/already-verified rejection without logging the code or session. Do not send another email until the manual step is coordinated.

Real correct-code verification, database activation, consumption/replay, inbox delivery, and real resend remain NOT RUN for this phase. No schema, migrations or application behavior were changed.
