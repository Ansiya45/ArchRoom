ALTER TABLE company_recording_private_policies DROP CONSTRAINT IF EXISTS company_recording_private_policies_job_id_key;
ALTER TABLE company_recording_private_policies DROP CONSTRAINT IF EXISTS company_recording_private_policies_recording_id_key;
ALTER TABLE company_recording_private_policies ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE company_recording_private_policies ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE company_recording_private_policies ADD COLUMN IF NOT EXISTS superseded_by uuid;
CREATE UNIQUE INDEX IF NOT EXISTS company_recording_policy_active_job_uidx ON company_recording_private_policies(job_id) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS company_recording_policy_version_uidx ON company_recording_private_policies(job_id, policy_version);
CREATE TABLE company_recording_anyone_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES company_recording_upload_jobs(id) ON DELETE CASCADE,
  recording_id uuid NOT NULL,
  host_user_id uuid NOT NULL REFERENCES users(id),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  UNIQUE(job_id, policy_version)
);
CREATE INDEX company_recording_anyone_confirmations_host_idx ON company_recording_anyone_confirmations(host_user_id, confirmed_at);
