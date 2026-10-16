# Meeting history rollout

Migration `0012_meeting_history.sql` adds text and recording-reference storage. It has been prepared locally, not applied to the configured database. Apply through the existing migration process before using the updated backend. The backend's existing `prestart` also runs pending migrations; review the deployment before starting it against production.

- History reads require authentication and the meeting creator's identity. Session co-hosts may save exports through existing recording authorization, but cannot read another creator's history.
- The new table has row-level security enabled with no public client policies. Access is through the backend database connection, like other protected application operations.
- Transcript clips and generated summaries are saved after successful provider processing. No audio blobs or Google tokens are archived. A storage failure returns usable text plus a visible warning to download it.
- Drive export stores only the file link and filename after upload. Saving a reference is retryable without uploading again. Drive permissions and file existence are not guaranteed by a stored reference.
- Repeated writes use deduplication keys. Reusable and recurring meetings retain occurrence identifiers; legacy one-time content has no occurrence identifier.
- Favorites and dashboard removal are stored per user in `meeting_preferences`. Dashboard removal hides the card for that user; it does not delete the meeting, history, participants, recordings, or external files.
- Host transcription selection becomes a database `meeting_ai_requests` record only after the host joins. The checkbox itself is a pre-join draft and defaults off whenever the join page opens.
- Existing unsaved transcripts, summaries, and Drive exports cannot be backfilled automatically. Existing meeting/session and Supabase recording metadata remains available.
- Deletion requests must include `meeting_history_items`. Deleting the associated meeting or occurrence cascades to these rows. Deleting a history reference does not delete the external Drive file. No automatic retention period has been introduced.

Before production rollout, review the updated participant notice and privacy policy, and test persistence against a disposable database with the migration applied. Local automated tests use mocked database/provider responses; they do not validate production storage or send email/audio to third parties.
