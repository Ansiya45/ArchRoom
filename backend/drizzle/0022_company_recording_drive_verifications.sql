-- Independent Drive verification outcomes. This does not complete upload jobs
-- or publish any Meeting History reference.
CREATE TABLE company_recording_drive_verifications (
  job_id uuid PRIMARY KEY,
  recording_id uuid NOT NULL,
  drive_file_id text NOT NULL CHECK (drive_file_id ~ '^[A-Za-z0-9_-]{10,128}$'),
  destination_folder_id text NOT NULL,
  expected_byte_length bigint NOT NULL CHECK (expected_byte_length > 0),
  observed_byte_length bigint,
  expected_mime_type text NOT NULL,
  observed_mime_type text,
  expected_sha256 varchar(64) NOT NULL CHECK (expected_sha256 ~ '^[a-f0-9]{64}$'),
  observed_sha256 varchar(64),
  company_account_email text NOT NULL,
  credential_generation uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('verified','blocked','inconclusive')),
  failure_code text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome = 'verified') = (failure_code IS NULL))
);
--> statement-breakpoint
CREATE INDEX company_recording_drive_verifications_recording_idx
  ON company_recording_drive_verifications(recording_id, verified_at DESC);
