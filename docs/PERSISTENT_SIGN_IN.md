# Persistent sign-in deployment

Account sessions are separate from meeting sessions. Leaving or ending a meeting does not log out the account. Login and email verification now issue a short-lived access JWT plus a persistent device credential. The browser stores them in localStorage and renews access automatically before API requests (including when returning the next day). Concurrent requests in one tab share a renewal. Logout clears browser state immediately, revokes the device credential on the server, and cannot be undone by a late renewal response.

Device credentials have no automatic time expiry. Their SHA-256 digests are stored in `auth_sessions`; raw values must never be logged. Logout revokes that device, password changes invalidate all prior device sessions, and deleting the user cascades to sessions. Access tokens tied to a revoked session are also rejected. Temporary network, server, or database failures retain browser credentials and offer a retry.

## Deploy

1. Apply the backend database migration with `npm run drizzle:migrate` from `backend` using the production database configuration. This adds `auth_sessions` without changing meeting data.
2. Deploy the backend, then the frontend. Keep the existing `JWT_SECRET` stable and keep `JWT_EXPIRES_IN=1h`; access expiry no longer requires a manual login.
3. Users signed in before this feature need to sign in once to receive a persistent device credential. Previously issued JWTs retain their original expiry; expired tokens cannot establish a new session.
4. Verify signup/login, close and reopen the app, leave/end a meeting, and explicitly log out. A browser with cleared site data, private browsing, or a different device still needs its own login.

If the browser is offline when Logout is pressed, local sign-out still completes, but server revocation cannot be confirmed. The UI reports that failure. No database migration or production deployment is performed by the local tests.
