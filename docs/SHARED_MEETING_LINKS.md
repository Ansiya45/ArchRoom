# Shared meeting links

## Root cause and production configuration

On 2026-10-05, unauthenticated HTTP GET requests returned:

| URL | HTTP status | Response |
| --- | --- | --- |
| `https://meet.ylaam.com/` | 200 | Vite-built HTML with the React root and JS/CSS assets |
| `https://meet.ylaam.com/meet/YLM-W8Z3SE` | 404 | `text/plain; charset=utf-8`, body `Not Found` |

Both responses included Render's `rndr-id` header. The meeting-path response never loaded React, so authentication and meeting existence were not responsible for this plain-text 404. The deployed origin is not serving the SPA entry point for deep links. No Render Blueprint, rewrite file, or server routing configuration exists in this repository; dashboard configuration cannot be verified from the repository.

In the Render **frontend Static Site** serving `meet.ylaam.com`, open **Redirects/Rewrites** (under Settings if grouped there) and add:

| Source | Destination | Action |
| --- | --- | --- |
| `/*` | `/index.html` | **Rewrite** |

Keep any existing, more-specific API/proxy rules ahead of the SPA fallback. Use Rewrite, not Redirect, to preserve `/meet/YLM-W8Z3SE`. Existing asset files continue to be served normally. For this repository, a static-site configuration uses root directory `frontend`, build command `npm ci && npm run build`, and publish directory `dist`; verify the existing service settings instead of creating another service. The Vite development `/api` proxy is not a production proxy: retain the existing production API configuration.

Reference: https://render.com/docs/redirects-rewrites

**No hosting settings have been changed.** The user subsequently authorized completing configuration and deployment. Publication to company `main` is being prepared; Render account access is still required to apply/verify the fallback and confirm deployment. The public deep link will continue to return 404 until the hosting fallback is corrected. After configuration/deployment, verify a fresh browser tab and reload at the exact public meeting URL; both document requests must return the SPA HTML with HTTP 200.

## Application behavior

- The `/meet/:meetingCode` route renders the existing `MeetingRoom` / `WaitingRoom` pre-join experience for signed-out and signed-in visitors. It no longer redirects anonymous visitors to homepage signup.
- The URL itself holds the destination. No new authentication system, meeting join implementation, token URL parameter, or persistent credential mechanism was added.
- Anonymous visitors see only the requested code and generic join UI. No meeting metadata or admission requests are made before authentication.
- Join Meeting opens the existing `AuthModal`. Login or completed email verification continues the same `handleJoin` admission request. Incorrect passwords, verification rejection, and modal cancellation preserve the URL. Header login/signup without a Join action leaves the normal explicit join button available.
- Account validation, refresh, and existing participant-session restoration still use the existing APIs. A rejected account session stays at the meeting URL. Session removal in another tab remounts the meeting view, clearing private UI and active client connections.
- Newly joining attendees remain pending until the backend returns admitted. A denied request does not start media. Existing authorized rejoin and host admission behavior are preserved.
- Current six-character codes and older grouped codes are accepted; lowercase codes normalize to uppercase. `/meet/`, `/meet/INVALID`, and the literal `/meet/nonexistent-valid-format-code` are malformed. `/meet/YLM-ZZZZZZ` is an example of a syntactically valid code used with a mocked not-found response.
- Unknown application paths show Page not found. Malformed codes show Invalid meeting link. Authenticated lookup failures show Meeting not found or a retryable loading error. Ended one-time/legacy meetings and cancelled series cannot join; reusable/recurring room start behavior is unchanged.
- The legacy `/?join=CODE` invitation redirects to the canonical meeting route without opening an unrelated homepage modal.

## Tests

From `frontend`:

```sh
npm run test:e2e -- e2e/meeting-link.mock.spec.ts
npm run test:e2e
npx playwright test --config playwright.meeting-link.config.ts
npm run lint
npm run test:e2e:typecheck
node --import tsx --test tests/*.test.ts
npm run build
```

The meeting-link preview config builds the app with an isolated `/api` URL and runs the same shared-link tests against Vite's production preview. It proves the built application's routing, direct opening and refresh behavior with a working SPA fallback; it does not prove or change Render's configuration.

All browser auth, verification, meeting and admission responses in these suites are mocked. The fixtures block real API/email/media traffic. The admission test checks that media credentials are requested only after mocked host admission; it does not connect to a real LiveKit room. The separate backend security tests exercise actual router/service authorization with database doubles. Existing backend verification tests cover rejection before email verification.

Real credential/email/provider suites are intentionally not invoked for this frontend routing fix. No database operations, migrations, real accounts, meeting records or emails are needed for these checks. Earlier uncommitted authentication/deployment changes in the workspace were preserved.

## Verification results — 2026-10-05

| Final check | PASS | FAIL | NOT RUN |
| --- | ---: | ---: | ---: |
| Full isolated Playwright regression suite, including all 19 shared-link cases | 99 | 0 | 0 |
| Built-SPA shared-link Playwright suite | 19 | 0 | 0 |
| Backend unit/regression/security tests | 141 | 0 | 0 |
| Frontend unit tests | 7 | 0 | 0 |
| Frontend, backend, E2E typechecks | 3 | 0 | 0 |
| Frontend and backend production builds | 2 | 0 | 0 |
| Opt-in real-account browser tests | 0 | 0 | 10 |
| Previously added database migration integration test | 0 | 0 | 1 |

The first full browser run had 98 passes and one `page.reload: net::ERR_ABORTED` in the existing delayed-renewal/logout test after its logout assertions passed. That test passed three consecutive unchanged reruns, followed by the complete 99/99 passing run. No existing assertions were removed or relaxed. The production build still emits its existing non-fatal large-chunk warning.

The 19 shared-link cases cover requested scenarios A–M: public landing, Join-triggered authentication, sign-in continuation, cancellation, wrong-password retry, signup validation and rejected/successful verification, existing login, refresh before and after requesting admission, a fresh tab, malformed/missing/unknown paths, nonexistent valid-format meetings, ended/cancelled meetings, logout, admission/denial, expired sessions, and legacy invitation links. Media and email providers are mocked; real calls and email delivery were not tested.

Modified for this task: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/components/meeting/MeetingRoom.tsx`, `frontend/src/components/meeting/WaitingRoom.tsx`, `frontend/e2e/meeting-link.mock.spec.ts`, `frontend/e2e/tsconfig.json`, and `frontend/README.md`.

Created for this task: `backend/tests/meeting-link-security.test.ts`, `frontend/playwright.meeting-link.config.ts`, and this document.

Database operations performed: **0**. Real emails sent: **0**. Deployments/pushes performed: **0**. Login and signup/verification both preserve the requested meeting code. Direct opening and refresh pass in development and built-SPA preview; the live Render URL remains dependent on the unapplied rewrite and a future authorized deployment of these frontend changes.
