# Google Drive Stage A security foundation

Stage A adds no OAuth callback, Drive API client, folder endpoint, sharing operation, or upload path. The configured recording root remains in `backend/src/config/recordingDrive.ts` alone. Existing browser-initiated manual Drive uploads are separate and do not authorize the backend.

## Application authorization

Set `GOOGLE_INTEGRATION_ADMIN_USER_ID` to the UUID of one existing, verified YLAAM Meet user in the backend's runtime environment. Until configured, every integration-credential replacement attempt is denied. The administrator ID is checked against the authenticated application user ID; meeting creator or host status does not grant this permission. Stage B must add an authenticated setup endpoint and recheck this ID at initiation and callback completion. If the designated user changes, update the server configuration deliberately.

The additive `0014_drive_security_foundation.sql` migration adds a registry of direct child batch folder IDs and a per-user role for each folder: `manager`, `trainer`, or `viewer`. The root is represented by a null meeting destination; authenticated meeting creators may use it for general recordings. A protected batch folder requires a matching assignment. Managers can manage, view, and upload; trainers can view and upload; viewers can only view. Unassigned users have no protected-batch access. These are application permissions, not Google Drive ACLs. Stage B must verify a folder against the live configured root before registering its ID, and must enforce these checks in every new endpoint. Stage A creates no assignment endpoint or UI.

## Credential storage

The singleton `drive_integration_credentials` table stores an AES-256-GCM encrypted refresh token and the connected account email. It stores no plaintext token. The backend service rejects replacement unless the authenticated caller matches the configured integration administrator. Set `GOOGLE_INTEGRATION_TOKEN_KEY` in the backend runtime secret manager to a **random 32-byte key encoded as standard Base64**. The key is separate from the database and is required to decrypt credentials across Render restarts. Keep the same key across deployments and replicas; losing it makes the stored token unreadable. Plan key rotation before changing it. Neither this key nor a Google client secret belongs in frontend configuration or repository files.

This database-backed approach persists across ordinary Render restarts, assuming the application database remains available. Database administrators, backend process operators, and anyone with the encryption key plus database access remain trusted. Restrict database access and backups accordingly. The encryption service does not expose a token through any API in Stage A.

## Stage B prerequisites

Configure a Google OAuth Web application client with the backend's exact HTTPS callback URI, a backend-only client secret, and `drive.file` scope. The company owner must authorize through Google; no password is collected by YLAAM Meet. The backend flow must use one-time state bound to the administrator session, PKCE where supported, and offline access. Only after the owner explicitly selects the shared configured root for this OAuth app may the backend verify `files.get`, direct-child listing, and create capability. Sharing a folder with a Google account does not by itself grant `drive.file` access to the app. Keep the root Restricted and fail closed if verification fails. Do not enable folder APIs, Google permissions, or uploads until those checks and their authorization tests pass.
