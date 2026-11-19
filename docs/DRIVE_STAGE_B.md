# Google Drive Stage B: backend OAuth preparation

Stage B provides backend OAuth endpoints and a root-limited Drive client. No Google account has been authorized, no live Drive call has been made, and no folder UI, user folder API, automatic upload, or sharing API is enabled.

## Google Cloud Console setup before a later live authorization

1. In the company-controlled Google Cloud project, enable the Google Drive API and configure the OAuth consent screen for the company's internal use. Add only `https://www.googleapis.com/auth/drive.file` to this integration's requested scopes. If the app is in Testing mode, add the owner's Google account as a test user. Do not enable broad Drive scopes.
2. Create a **Web application** OAuth client, or reuse the existing frontend Web application client only if its owner, consent configuration, and client secret can be verified and the backend callback can be added. Add the exact backend redirect URI `https://BACKEND_ORIGIN/google-drive/oauth/callback` under Authorized redirect URIs. For local testing use `http://127.0.0.1:PORT/google-drive/oauth/callback` with a matching registered local redirect URI. The backend callback path is fixed.
3. Keep the client secret on the backend. The existing browser manual-upload configuration remains independent. The company owner will use Google's official consent screen; no Google password is entered into YLAAM Meet.
4. Use the admin-only Picker step to explicitly select the configured root under the same OAuth client and `drive.file` grant. The selected ID must equal the ID derived from `backend/src/config/recordingDrive.ts`. The backend then calls Drive `files.get` and requires `isAppAuthorized`, folder MIME type, an untrashed folder, and `canListChildren` plus `canAddChildren`. A shared URL or account-level folder share alone is not treated as app authorization. The Picker UI is still Stage C work.

The OAuth start request and callback must use the **same browser origin** so its short-lived HttpOnly `SameSite=Lax` cookie is sent on Google's redirect. If the frontend proxies the API under a different origin from the callback, route both through the same public origin before live use. HTTPS is required except for local loopback testing.

## Backend runtime variables

- `GOOGLE_CLIENT_ID`: Web application OAuth client ID.
- `GOOGLE_CLIENT_SECRET`: backend-only client secret.
- `GOOGLE_OAUTH_CALLBACK_URL`: exact public backend callback URL ending in `/google-drive/oauth/callback`.
- `GOOGLE_INTEGRATION_ADMIN_USER_ID`: UUID of the one explicitly authorized, verified YLAAM Meet administrator.
- `GOOGLE_INTEGRATION_TOKEN_KEY`: 32 random bytes encoded in standard Base64, retained across deployments and replicas.

These values belong in backend runtime secret/config management, not frontend build variables or repository `.env` files. Missing configuration disables the flow. Do not set production values or authorize the company account until a separate approved live setup.

## Security behavior and remaining steps

`googleDriveIntegration.start` requires an authenticated administrator with a current persistent session. It creates a five-minute, single-use state and S256 PKCE verifier. The callback consumes state, checks its same-browser cookie and active initiating session, and exchanges the authorization code. A new refresh token remains pending in backend process memory for five minutes. Only successful backend root verification encrypts and persists it in the Stage A singleton table. Failed replacement leaves an existing connection intact. Google errors and missing refresh tokens fail without storing a new credential. Refreshes may rotate the stored refresh token. `disconnect` removes only the local stored credential; it does not revoke the Google grant remotely.

`pickerAccess` is administrator-only and returns a short-lived **access** token for the future Google Picker UI. No refresh token reaches JavaScript. `verifyRoot` requires backend Drive verification. No persistent `ready` flag is used: future folder operations must recheck root authorization and capabilities. The prepared backend folder client can read only the configured root, list its direct children, and create only direct children. It has no router endpoint in Stage B.

OAuth state is held in process memory. A restart or callback to a different replica rejects the flow and requires a retry; it does not weaken authorization. Before a live rollout with multiple replicas, use a shared single-use state store or route the flow consistently. Backend operators and the explicitly authorized administrator remain trusted; `drive.file` can technically access other files the owner later opens with the app, so the backend's fixed-root restrictions remain necessary.
