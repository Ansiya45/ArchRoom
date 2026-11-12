CREATE TABLE company_recording_upload_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  occurrence_id uuid REFERENCES meeting_occurrences(id) ON DELETE CASCADE,
  destination_folder_id text NOT NULL CHECK (length(destination_folder_id) BETWEEN 10 AND 128),
  access_policy text NOT NULL CHECK (access_policy IN ('private', 'restricted', 'anyone_with_link')),
  mime_type text NOT NULL CHECK (mime_type IN ('video/webm', 'video/mp4')),
  byte_length bigint NOT NULL CHECK (byte_length > 0 AND byte_length <= 21474836480),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  drive_file_id text UNIQUE,
  encrypted_session text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'uploading', 'retryable', 'verifying', 'completed', 'failed')),
  confirmed_offset bigint NOT NULL DEFAULT 0 CHECK (confirmed_offset >= 0 AND confirmed_offset <= byte_length),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'),
  verified_drive_file_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((state = 'completed' AND drive_file_id IS NOT NULL AND verified_drive_file_id IS NOT NULL AND drive_file_id = verified_drive_file_id AND confirmed_offset = byte_length AND completed_at IS NOT NULL) OR
         (state <> 'completed' AND verified_drive_file_id IS NULL AND completed_at IS NULL))
);
--> statement-breakpoint
CREATE INDEX company_recording_upload_jobs_owner_idx ON company_recording_upload_jobs (owner_user_id, created_at);
--> statement-breakpoint
CREATE INDEX company_recording_upload_jobs_meeting_idx ON company_recording_upload_jobs (meeting_id);
