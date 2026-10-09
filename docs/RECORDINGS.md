# Recording setup and verification

Hosts can record a shared screen or tab, preview the result, download it locally, upload it to private Supabase Storage, or upload it to a Google Drive folder. Stopping or leaving a meeting finalizes the recording before showing the summary. Save and discard the current preview before starting another recording.

## Google Drive

Set these public browser configuration values in `frontend/.env`, then restart the frontend:

- `VITE_GOOGLE_DRIVE_CLIENT_ID`: web OAuth client ID.
- `VITE_GOOGLE_DRIVE_API_KEY`: browser API key restricted to your frontend origins and the Google Picker API.
- `VITE_GOOGLE_DRIVE_APP_ID`: Google Cloud project number (not its project ID).

Enable Google Drive API and Google Picker API in the same Cloud project. Configure the OAuth consent screen and authorized JavaScript origins for local development and production; add test users if the app is in testing. The connection requests `drive.file` access. Paste a folder link and click Upload to Google Drive. The button opens Google sign-in when needed, then uploads automatically. If the app does not yet have access to that folder, it opens the folder picker; select the same folder to grant access and continue. Cancelling or selecting a different folder stops the upload. Previously authorized folders upload directly. Files inherit the destination folder's sharing. Google access tokens stay in browser memory.

### Obtain the configuration

1. Open Google Cloud Console and select or create one project. Enable **Google Drive API** and **Google Picker API** in APIs & Services → Library.
2. Configure the app in **Google Auth Platform**. Add your Google account as a test user while the external app is in testing. Configure the `https://www.googleapis.com/auth/drive.file` scope.
3. Create an OAuth client with application type **Web application**. Add the frontend's exact origin under Authorized JavaScript origins (for example, `http://localhost:5173`, plus your production origin). Copy its client ID into `VITE_GOOGLE_DRIVE_CLIENT_ID`. No client secret belongs in the frontend.
4. Create a browser API key for Picker and set `VITE_GOOGLE_DRIVE_API_KEY`. Restrict the key to Google Picker API and configure website referrers for your frontend and `https://docs.google.com/*`, as required by Google's Picker iframe guidance.
5. Copy the project's numeric **Project number** from project settings into `VITE_GOOGLE_DRIVE_APP_ID`. This must be the same project as the OAuth client and API key.
6. Restart Vite after updating `frontend/.env`. For deployment, set the values in the frontend build environment and rebuild.

References: https://developers.google.com/workspace/drive/picker/guides/web-picker and https://developers.google.com/workspace/drive/api/guides/api-specific-auth

Drive uploads use resumable chunks. Keep the page open; retry after a connection failure, or reconnect the same Google account if access expires. Drive exports appear through the returned Drive link; the saved recordings list contains Supabase recordings.

Reference: https://developers.google.com/workspace/drive/api/guides/manage-uploads

## Supabase

Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET` on the backend. Apply the project's database migrations. The recording service prepares a private bucket. Ensure its storage limits support the expected recording sizes. Completion verifies stored file size; retry checks for an already received file and renews the signed upload URL when needed.

Reference: https://supabase.com/docs/reference/javascript/file-buckets-info

## Verification

- Frontend: `npm.cmd run build` and `node --test tests/googleDriveRecording.test.ts (Node 24+)` from `frontend`.
- Backend: `npm.cmd run typecheck` from `backend`.
- In Chrome/Edge, record a tab with audio sharing enabled; verify local and remote voices in playback. Screen/system audio availability depends on the browser and chosen capture source.
- Stop from both the meeting button and the browser sharing control. Check that the preview plays and camera/microphone recording indicators stop.
- End the meeting while recording and verify the preview remains accessible from the summary.
- Download, upload to Supabase, and export the same preview to Drive. Confirm Supabase downloads and folder access in Drive.
- Interrupt an upload and retry; ensure it produces one completed file. Test reconnecting an expired Google session and rejecting an inaccessible folder.

Recordings remain in browser memory until discarded or the page closes. Long recordings require sufficient device memory. Real screen capture, Google OAuth, and storage uploads require manual verification with configured accounts.

New VP9 recordings use a resolution/frame-rate-aware video bitrate target (2 Mbps at 1080p30). Capture resolution, frame rate, and audio settings are unchanged. Higher-resolution and high-frame-rate captures get larger budgets; fallback codecs retain browser defaults. Size savings and perceived quality depend on the content and browser, so compare text, motion, and audio in real recordings. Existing recordings are unchanged.
