-- Local test foundation. No migration here enables Google Drive transfers.
CREATE TABLE company_recording_transfer_intents (
  job_id uuid PRIMARY KEY,
  recording_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  drive_file_id text NOT NULL UNIQUE CHECK (drive_file_id ~ '^[A-Za-z0-9_-]{10,128}$'),
  company_account_email text NOT NULL CHECK (length(company_account_email) BETWEEN 3 AND 254),
  credential_generation uuid NOT NULL,
  destination_folder_id text NOT NULL,
  -- True before the first external session-initiation attempt. If its response
  -- or subsequent DB write is lost, never create a second session blindly.
  session_creation_attempted boolean NOT NULL DEFAULT false,
  encrypted_session text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (encrypted_session IS NULL OR session_creation_attempted)
);
--> statement-breakpoint
CREATE INDEX company_recording_transfer_intents_owner_idx ON company_recording_transfer_intents(owner_user_id);
