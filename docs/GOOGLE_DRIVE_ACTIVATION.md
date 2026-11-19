# Google Drive activation guide

Source checked: 27 October 2026. This is the current activation guide; earlier `DRIVE_STAGE_*` documents describe historical stages, including OAuth cookie instructions that have since changed.

## What is ready

Backend OAuth, encrypted refresh-token storage, administrator-only Google Picker setup, root verification, direct-child folder listing/creation, explicit folder-creator grants, and meeting destination persistence are implemented and mock-tested. Real Google authorization and Drive behavior have **not** been verified. This guide is preparation, not permission to change production.

The root URL remains defined only in `backend/src/config/recordingDrive.ts`. Open that file to identify the intended `ylaam-meet-recording-sessions` folder; do not copy its ID into another configuration or replace the URL. The backend verifies identity and capabilities, not the folder's display name or its Restricted sharing setting. The owner must check Restricted in Drive.

## 1. Google Cloud Console — prepare the project

First open Google Cloud Console's project selector and identify the company-controlled project used by the existing Google Drive integration. Confirm you have permission to manage it before changing anything. Keep the backend OAuth client, Picker API key and Picker project number in the same project.

After configuration approval:

1. Under **APIs & Services → Library**, enable **Google Drive API** and **Google Picker API**. No LiveKit, transcription, or paid recording service is needed.
2. Under **Google Auth Platform**, configure Branding, Audience and Data Access. Request only `https://www.googleapis.com/auth/drive.file` for this integration. Do not add full-Drive scopes.
3. Choose **Internal** only if the project belongs to a Google Workspace/Cloud Identity organization and the authorizing account belongs to that organization. Company-only use does not by itself make a personal Gmail account eligible for Internal. Otherwise use **External**, initially Testing, and add the owner's Google email as a test user. External Testing refresh tokens for this Drive scope expire after seven days; plan the appropriate publishing/verification configuration before expecting ongoing unattended access. Consent can also be revoked later. [Google audience guidance](https://support.google.com/cloud/answer/15549945) and [token expiry guidance](https://developers.google.com/identity/protocols/oauth2).
4. Under **Clients**, use a **Web application** OAuth client. Reuse the existing client only if the company controls its project and secret and it supports these settings; preserve its existing origins/redirects. Otherwise create a backend Web application client in the same Picker project.
5. Add Authorized JavaScript origin: `https://meet.ylaam.com` (no path).
6. Add this exact Authorized redirect URI: `https://ylaam-meet.onrender.com/google-drive/oauth/callback`. It is a backend URL, with no trailing slash, query string, or `/api` prefix.
7. Under **APIs & Services → Credentials**, prepare a browser API key. Use Websites restrictions allowing `https://meet.ylaam.com/*` and `https://docs.google.com/*`. Restrict its APIs to Google Picker API; also allow Google Drive API if this key is used for direct Drive calls. Record the numeric Cloud **project number**, not project ID, for Picker's app ID. [Official Picker setup](https://developers.google.com/workspace/drive/picker/guides/web-picker).

The OAuth client secret belongs only on the backend. The browser API key is public build configuration and must have restrictions.

## 2. Identify the YLAAM integration administrator

Use one existing, verified YLAAM Meet account belonging to the trusted integration administrator, preferably the owner. This is a YLAAM user UUID, not a Google account ID, email address, meeting ID or participant ID.

1. Sign into YLAAM Meet as that person.
2. Open browser Developer Tools → Network, reload the dashboard, and locate the `auth.me` request (it may be part of a tRPC batch).
3. In its **Response**, locate `result.data.user` for `auth.me`. Confirm the email and name, then copy only `user.id`.
4. Use that UUID for `GOOGLE_INTEGRATION_ADMIN_USER_ID`. Do not share request headers, session tokens or an exported HAR file.

The source is `authService.me`, which returns `{ ok: true, user: { id, email, fullName } }`. Do not guess an ID. Ordinary hosts and batch managers cannot connect, replace, verify or disconnect the integration. A fresh YLAAM login provides the persistent session required for setup.

## 3. Render backend configuration — requires approval

Set these on the backend Web Service only, after approval. Preserve all existing database, authentication, mail and LiveKit settings.

| Variable | Required value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Backend Web application OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | That client's secret; backend secret only |
| `GOOGLE_OAUTH_CALLBACK_URL` | `https://ylaam-meet.onrender.com/google-drive/oauth/callback` |
| `GOOGLE_INTEGRATION_ADMIN_USER_ID` | Verified YLAAM user UUID from step 2 |
| `GOOGLE_INTEGRATION_TOKEN_KEY` | Cryptographically random 32 bytes, encoded as standard Base64; backend secret only |
| `CORS_ALLOWED_ORIGINS` | Include exact origin `https://meet.ylaam.com` in the comma-separated allowlist; preserve other required origins; no wildcard |

Generate the encryption key privately with a cryptographically secure secret generator. Keep it in secure secret management with a recovery copy, never in source, chat or frontend configuration. Keep the same key across restarts and deployments. Changing/losing it makes existing credentials unreadable; do not casually regenerate it.

These Google variables are optional until integration setup. Leave unused variables unset rather than entering placeholder UUIDs/URLs. Invalid configured values can fail environment validation. Missing setup keeps Drive controls unavailable while ordinary root-default meeting creation remains supported.

Use one stable backend instance during authorization and Picker verification. OAuth state and pending consent live in process memory; a restart or another replica requires starting again. Successfully verified refresh tokens persist encrypted in PostgreSQL across Render restarts. Multiple-instance setup needs shared state or reliable routing before activation.

The current cross-origin flow is deliberate: authenticated tRPC `googleDriveIntegration.start` returns the backend start URL; the browser submits its YLAAM access token in a top-level POST body to `/google-drive/oauth/start`. The backend checks the exact Origin, administrator and active session, then sets a five-minute HttpOnly, host-only, Secure, SameSite=Lax callback cookie before redirecting to Google. The GET callback validates cookie, single-use state, PKCE and the initiating session. This does not require wildcard CORS or third-party fetch cookies. Never log POST bodies or authorization headers at a proxy.

## 4. Render frontend configuration — requires rebuild/deployment approval

These are Vite **build-time** variables on the frontend service. Changes require rebuilding the frontend.

| Variable | Required value |
| --- | --- |
| `VITE_API_BASE_URL` | For direct calls to the supplied backend: `https://ylaam-meet.onrender.com` (no `/api`; the backend serves tRPC at its root). Preserve a working `/api` setup only if your frontend already has a verified reverse proxy. |
| `VITE_GOOGLE_DRIVE_API_KEY` | Restricted Picker browser API key from step 1 |
| `VITE_GOOGLE_DRIVE_APP_ID` | Numeric project number for the backend OAuth client's project |

`VITE_GOOGLE_DRIVE_CLIENT_ID` belongs to the existing **manual browser upload** flow; the new backend connection panel does not read it. Preserve its existing value and behavior. The two Picker variables are shared with manual uploads: do not point them at an incompatible project while leaving the manual client in another project. Resolve a project mismatch before deployment.

Never add `GOOGLE_CLIENT_SECRET`, `GOOGLE_INTEGRATION_TOKEN_KEY`, database credentials or refresh tokens to any `VITE_*` variable.

## 5. Database and release approval gate

Before deploying the new code, explicitly approve the production release and migration plan. The real migration command is `npm run db:migrate` from `backend`; it uses `DATABASE_URL` and the Drizzle journal. Required additions are 0013 (meeting recording settings), 0014 (credentials and folder permissions), and 0015 (explicit folder creators).

An authorized operator must first inspect the deployment database's existing migration history and schema, take the agreed backup, and confirm that running the repository runner is appropriate. Do not run it on a database whose schema was manually migrated without matching `drizzle.__drizzle_migrations` history. Do not assume local migration success establishes production history. The fresh local runner and pre-0013 upgrade have passed; no production migration was performed.

After approval, apply the reviewed migration plan and deploy backend/frontend with the configuration above. Configuration changes, deployments, migrations and real owner authorization are separate actions requiring approval. None was performed while preparing this guide.

## 6. Owner authorization and root verification — approved live trial only

1. The owner checks the configured folder in Google Drive: correct folder, **General access: Restricted**, and no unintended inherited/root sharing. If using another approved Google account, it needs explicit access with listing/creation capability. Do not share the entire Drive.
2. In the owner's trusted browser, sign into the explicitly designated YLAAM administrator account. Open **Settings → Company recording folder**.
3. Click **Authorize Google account**. The owner selects their Google account and enters any Google password only on Google's official sign-in page. The developer and YLAAM never need that password. Do not give another person the administrator's YLAAM password either.
4. After consent, the backend callback displays a text confirmation. Manually return to `https://meet.ylaam.com`, open Settings and click **Refresh status**. There is no automatic callback redirect to the app.
5. Within five minutes of callback completion, click **Select recording root** and select exactly the folder configured in `recordingDrive.ts`. Google Picker can show other folders to the owner during selection; do not select personal folders. The backend rejects a different ID before reading that folder's metadata.
6. Expect **Connected and verified** only after backend verification. Checks require exact root ID, folder MIME type, not trashed, `isAppAuthorized`, `canListChildren`, and `canAddChildren`. Sharing a link alone is not OAuth authorization. On failure remain disconnected and investigate; do not broaden scope or make the folder public. If the pending setup expires or the backend restarts, repeat authorization.

Picker provides explicit per-file authorization under `drive.file`; the backend verifies using its own token. A selected root is not proof that every pre-existing descendant is available to this OAuth app. The first live listing must establish which existing direct children Google returns. Missing children are a permission/app-authorization question, not a reason to add broad scopes. This is an outstanding live acceptance check, not a mock-test guarantee.

## 7. Safe first folder-listing check

After explicit live-read approval and successful root verification, open Schedule Meeting → Recording Settings → **Refresh Folders**. Do not click Create New Batch Folder during a read-only trial. An empty root can legitimately return no batch folders; no folders are fabricated.

The integration administrator can see verified direct children. Other users see only registered folders assigned to them as manager or trainer. Viewers and unassigned users cannot select protected batches. Keep the central root selected by default: the meeting saves `recording_folder_id = NULL`, with no extra default subfolder. Use a clearly synthetic meeting only after approval to write a test meeting; verify persistence by reopening settings.

Creation needs separate live-write approval. The integration administrator can create a child. Other creators require an explicit `recordingFolders.setCreatorGrant` administrator API grant; being manager of an existing folder is insufficient. There is no grant-management UI. New folders receive a registry entry and a manager assignment for their creator only. Assigning other managers/trainers/viewers and registering existing folders still need a reviewed administrative workflow; do not improvise production SQL.

If Drive creation succeeds but database registration fails, the UI reports the folder ID and asks you not to retry. The backend logs `recording_folder_registration_failed`. Stop and have an administrator reconcile registry/permissions after checking Drive and database state; there is no automatic repair or deletion.

## What activation does not provide

- **Existing manual recording/upload:** browser recording and the separate manual Upload to Google Drive flow remain available under their existing configuration. The user separately authorizes Google, chooses a folder and starts the upload; the component can save the resulting link to Meeting History. That path does not consume the new meeting-wide destination or enforce the new backend batch permissions/root boundary. Do not present it as company-managed uploading.
- **Company-managed upload:** no backend upload path currently routes recordings to the saved root/batch destination using the encrypted integration credential. This still needs implementation and authorization checks.
- **Automatic recording/upload:** no automatic server recording, background uploader or LiveKit Egress is activated by this setup.
- **Sharing:** `private`, `restricted`, and `anyone_with_link` are saved preferences only. No trainer/student Google ACL provisioning, public-link activation or download/copy/print restriction is implemented. App roles do not create Drive permissions. Inherited permissions can prevent true privacy; a direct Drive Editor may modify/delete files. Screen capture cannot be prevented by sharing settings.
- **Privacy boundary:** backend folder operations are fixed to the configured root/direct children; OAuth credentials can technically access other files explicitly opened with the app. Picker and the separate legacy manual uploader are not proof of a Drive-wide credential restriction.

## Readiness conclusion

Ready for a separately approved, controlled OAuth/Picker/root/listing trial after configuration, migration review and deployment. Not yet a complete company recording-upload/sharing system. Two known protected meeting-link test assertions remain unresolved test-suite failures; investigation found locator ambiguity and a transient mock timing issue, not Drive regressions. Live account capabilities, Restricted sharing, existing-child visibility and actual deployed configuration remain to be verified by the approved trial.
