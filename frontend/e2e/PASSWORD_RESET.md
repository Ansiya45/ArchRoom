# Forgot password and password reset

Existing Playwright infrastructure is reused. No real environment file or schema is changed.

## Application changes

- Reset code consumption and password update now share one transaction. A failed/missing user update rolls back consumption. Bcrypt hashing completes before the transaction; expiration is checked when consuming the code.
- Signup and reset use the exact same backend password regex as AuthModal: minimum eight characters with ASCII uppercase, lowercase and digit, preserving existing character semantics.
- Forgot-password returns the same successful generic response for existing/missing addresses, cooldown suppression and email-provider failure. Provider failure is logged server-side without recipient/provider secrets. Successful generic responses alone are not proof an email was sent. This hides account existence from response bodies/statuses, not a guarantee against statistical latency analysis.
- Reset email requests use the existing per-user database row lock and a 60-second cooldown scoped to reset_password. Verification cooldown remains separate. No migration is required. This is a recipient cooldown, not a full IP/global abuse limiter.
- The forgot-password form has an 'I already have a reset code' entry point. It requires a valid email and opens the existing reset form without generating another email.

## Commands

From frontend:

```powershell
npm.cmd run test:e2e
npx.cmd playwright test --config playwright.reset.config.ts
```

The real reset runner needs E2E_SIGNUP_EMAIL, E2E_PASSWORD_RESET_CODE and E2E_NEW_PASSWORD in the already Git-ignored frontend/.env.e2e.local. Optional E2E_OLD_PASSWORD (or original E2E_SIGNUP_PASSWORD) must match the account before reset to exercise real old-password rejection. Never paste these values into chat. Trace, screenshots and video are disabled; sensitive inputs are excluded from failure messages.

If the generated signup password was lost, a second controlled reset can complete the live old-password assertion. Keep E2E_NEW_PASSWORD as the now-current password and add a different policy-compliant E2E_FINAL_PASSWORD. The runner then treats E2E_NEW_PASSWORD as the known old password and E2E_FINAL_PASSWORD as the replacement, without requiring E2E_OLD_PASSWORD.

Only the E2E-labelled, verified signup account can be reset. The received code is submitted through the real UI, Vite proxy and backend. Database inspection verifies changed bcrypt hash, matching new password, unchanged verification timestamp and code consumption. Replay, new login, real auth.me, reload, logout and logged-out reload are checked. The unrelated meeting-list response is isolated in memory; no real meeting operations are performed. No email is sent by the normal reset run. No retries or automatic cleanup occur.

If the original password is unavailable, the real test records old-password login rejection as NOT RUN; changed hashes alone are not equivalent evidence. Backend tests with known old/new passwords cover the rejection logic. Do not label the complete real reset lifecycle finished without resolving this gap.

To request exactly one fresh email after expiry, run only when the mailbox can be checked promptly:

```powershell
$env:E2E_RESET_ACTION = 'request'
npx.cmd playwright test --config playwright.reset.config.ts
Remove-Item Env:E2E_RESET_ACTION
```

This action verifies that a fresh dedicated reset-code row committed after the normal send, rather than treating the generic forgot response as delivery proof. It does not reset the password. Save the received code locally and continue within ten minutes. Inbox receipt is confirmed only by the user providing the actually received code, not by reading a database hash.

## JWT/session security finding

Current JWTs are stateless signed tokens. Context verifies the signature/expiry and does not compare a credential version. Password reset therefore does not revoke already-issued valid JWTs. An isolated regression documents this existing behavior. Logout removes browser state, not copies of the bearer token held elsewhere.

Smallest robust remediation proposal: add a credential/session version (or a password-changed timestamp with precise issuance semantics), include it in newly issued JWTs, increment it atomically on reset, and reject older versions in request authentication. That needs a reviewed schema change and policy for legacy tokens and database lookups/caching. No migration, new session system, token-policy change or automatic revocation is implemented here. Do not use users.updated_at as a drop-in revocation marker: unrelated updates also change it and JWT iat has second-level precision.

## Current boundary

## Final real results — 2026-09-28

The first live reset attempt stopped at its expiry precondition before submitting or changing any account. A fresh received mailbox code then completed a real reset, proving bcrypt storage, consumption/replay rejection, final-password login, real auth.me, reload persistence, logout and logged-out reload. Because the generated signup password was unavailable, a second controlled mailbox reset used the first known replacement as the old password and a separate final password. The old password was rejected by the real backend and the final password authenticated successfully. This closes the live old/new-password assertion without database password edits.

The original signup email, two later verification resends, and three password-reset emails were accepted by Resend across the full signup/authentication workflow. Inbox receipt was confirmed for both verification resends and all three reset emails by locally configuring the received codes; receipt of the original signup email itself was not independently confirmed. One verification code and one reset code expired before submission and caused no account/password change. The successful verification code and both successful reset codes were consumed. The dedicated account remains verified with the final bcrypt password and no auth-code rows. No unrelated users or application records were changed.

Final automated validation: isolated Playwright **57/57 PASS**; real verified-login suite **3/3 PASS**; real duplicate signup **1/1 PASS**; final real reset **1/1 PASS**; complete backend **134/134 PASS**; frontend unit **7/7 PASS**. Frontend/backend/E2E typechecks and frontend/backend production builds passed. The existing Vite large-chunk warning remains non-fatal. Historical signup **13/13 PASS** and real verification/replay results remain valid; their one-time data-changing cases are intentionally not rerun after account activation.

Account/authentication E2E is complete except for the documented stateless-JWT revocation design finding, which requires an approved schema/token-architecture change and is outside this implementation.
