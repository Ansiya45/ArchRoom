-- Forward delta for a verified senior-only schema; historical ledger entries are not inserted.

-- Reviewed feature delta source: 0013_meeting_recording_settings
ALTER TABLE meetings ADD COLUMN recording_folder_id text;
--> statement-breakpoint
ALTER TABLE meetings ADD COLUMN recording_access_policy text NOT NULL DEFAULT 'private';
--> statement-breakpoint
ALTER TABLE meetings ADD CONSTRAINT meetings_recording_access_policy_check CHECK (recording_access_policy IN ('private', 'restricted', 'anyone_with_link'));


-- Reviewed feature delta source: 0014_drive_security_foundation
CREATE TABLE recording_batch_folders (
  folder_id text PRIMARY KEY,
  name varchar(255) NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recording_batch_folder_id_check CHECK (folder_id ~ '^[A-Za-z0-9_-]{10,128}$')
);
--> statement-breakpoint
CREATE TABLE recording_batch_folder_permissions (
  folder_id text NOT NULL REFERENCES recording_batch_folders(folder_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL CHECK (role IN ('manager', 'trainer', 'viewer')),
  PRIMARY KEY (folder_id, user_id)
);
--> statement-breakpoint
CREATE INDEX recording_batch_folder_permissions_user_idx ON recording_batch_folder_permissions(user_id);
--> statement-breakpoint
CREATE TABLE drive_integration_credentials (
  id integer PRIMARY KEY CHECK (id = 1),
  google_account_email varchar(255) NOT NULL,
  encrypted_refresh_token text NOT NULL,
  connected_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);


-- Reviewed feature delta source: 0015_recording_folder_creators
CREATE TABLE recording_folder_creators (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);


-- Reviewed feature delta source: 0016_drive_credential_generation
CREATE TABLE drive_integration_generation (
  id integer PRIMARY KEY CHECK (id = 1),
  generation uuid NOT NULL
);
--> statement-breakpoint
INSERT INTO drive_integration_generation (id, generation) VALUES (1, '00000000-0000-4000-8000-000000000000');


-- Reviewed feature delta source: 0017_company_recording_upload_jobs
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


-- Reviewed feature delta source: 0018_local_recording_staging_retention
-- Local disposable tests only. No application routes or runtime activation.
CREATE SCHEMA local_recording_staging;
--> statement-breakpoint
REVOKE ALL ON SCHEMA local_recording_staging FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE local_recording_staging.capacity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes BETWEEN 0 AND 536870912)
);
INSERT INTO local_recording_staging.capacity VALUES (true, 0);
--> statement-breakpoint
CREATE TABLE local_recording_staging.recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Historical identifiers deliberately have NO foreign keys to deletable entities.
  source_job_id uuid NOT NULL UNIQUE,
  recording_id uuid NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL,
  meeting_id uuid NOT NULL,
  occurrence_id uuid,
  mime_type text NOT NULL CHECK (mime_type IN ('video/webm', 'video/mp4')),
  byte_length bigint NOT NULL CHECK (byte_length BETWEEN 1 AND 134217728),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE local_recording_staging.chunks (
  staging_id uuid NOT NULL REFERENCES local_recording_staging.recordings(id) ON DELETE RESTRICT,
  byte_offset bigint NOT NULL CHECK (byte_offset >= 0 AND byte_offset % 262144 = 0),
  contents bytea NOT NULL CHECK (octet_length(contents) BETWEEN 1 AND 8388608),
  byte_length integer GENERATED ALWAYS AS (octet_length(contents)) STORED,
  sha256 text GENERATED ALWAYS AS (encode(sha256(contents), 'hex')) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staging_id, byte_offset)
);
--> statement-breakpoint
CREATE FUNCTION local_recording_staging.require_disposable_test() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('ylaam.local_staging_test', true) IS DISTINCT FROM 'enabled'
     OR current_database() !~ '^ylaam_staging_disposable_[a-z0-9_]+$'
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= inet '127.0.0.0/8' OR inet_server_addr() = inet '::1') THEN
    RAISE EXCEPTION 'LOCAL_STAGING_DISABLED';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION local_recording_staging.capture_job() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE job public.company_recording_upload_jobs%ROWTYPE;
BEGIN
  PERFORM local_recording_staging.require_disposable_test();
  SELECT * INTO STRICT job FROM public.company_recording_upload_jobs WHERE id = NEW.source_job_id FOR SHARE;
  NEW.recording_id := job.recording_id;
  NEW.owner_user_id := job.owner_user_id;
  NEW.meeting_id := job.meeting_id;
  NEW.occurrence_id := job.occurrence_id;
  NEW.mime_type := job.mime_type;
  NEW.byte_length := job.byte_length;
  NEW.sha256 := job.sha256;
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER staging_capture_job BEFORE INSERT ON local_recording_staging.recordings
FOR EACH ROW EXECUTE FUNCTION local_recording_staging.capture_job();
--> statement-breakpoint
CREATE FUNCTION local_recording_staging.reserve_chunk() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE expected bigint; accepted bigint; amount bigint := octet_length(NEW.contents);
BEGIN
  PERFORM local_recording_staging.require_disposable_test();
  SELECT byte_length INTO STRICT expected FROM local_recording_staging.recordings WHERE id = NEW.staging_id FOR UPDATE;
  SELECT coalesce(sum(byte_length), 0) INTO accepted FROM local_recording_staging.chunks WHERE staging_id = NEW.staging_id;
  IF NEW.byte_offset <> accepted - amount OR amount < 1 OR amount > 8388608
     OR NEW.byte_offset + amount > expected
     OR (NEW.byte_offset + amount < expected AND amount % 262144 <> 0) THEN
    RAISE EXCEPTION 'INVALID_STAGING_CHUNK';
  END IF;
  -- Conditional UPDATE locks the singleton across instances; rollback releases reservation.
  UPDATE local_recording_staging.capacity SET used_bytes = used_bytes + amount
    WHERE singleton AND used_bytes <= 536870912 - amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'STAGING_CAPACITY_EXHAUSTED'; END IF;
  NEW.created_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER staging_reserve_chunk AFTER INSERT ON local_recording_staging.chunks
FOR EACH ROW EXECUTE FUNCTION local_recording_staging.reserve_chunk();
--> statement-breakpoint
CREATE FUNCTION local_recording_staging.prevent_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'STAGING_RETENTION_REQUIRES_SEPARATE_APPROVAL';
END $$;
CREATE TRIGGER staging_recordings_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON local_recording_staging.recordings
FOR EACH STATEMENT EXECUTE FUNCTION local_recording_staging.prevent_mutation();
CREATE TRIGGER staging_chunks_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON local_recording_staging.chunks
FOR EACH STATEMENT EXECUTE FUNCTION local_recording_staging.prevent_mutation();
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA local_recording_staging FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA local_recording_staging FROM PUBLIC;


-- Reviewed feature delta source: 0019_local_recording_ingestion_verification
-- An attestation of staged bytes only; never a Google Drive upload result.
CREATE TABLE local_recording_staging.verifications (
  staging_id uuid PRIMARY KEY REFERENCES local_recording_staging.recordings(id) ON DELETE RESTRICT,
  byte_length bigint NOT NULL CHECK (byte_length BETWEEN 1 AND 134217728),
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION local_recording_staging.validate_attestation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE recording local_recording_staging.recordings%ROWTYPE; accepted bigint;
BEGIN
  PERFORM local_recording_staging.require_disposable_test();
  SELECT * INTO STRICT recording FROM local_recording_staging.recordings WHERE id = NEW.staging_id FOR UPDATE;
  SELECT coalesce(sum(byte_length), 0) INTO accepted FROM local_recording_staging.chunks WHERE staging_id = NEW.staging_id;
  IF NEW.byte_length <> recording.byte_length OR accepted <> recording.byte_length OR NEW.sha256 <> recording.sha256 THEN
    RAISE EXCEPTION 'INVALID_STAGING_ATTESTATION';
  END IF;
  NEW.verified_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER staging_validate_attestation BEFORE INSERT ON local_recording_staging.verifications
FOR EACH ROW EXECUTE FUNCTION local_recording_staging.validate_attestation();
CREATE TRIGGER staging_verifications_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON local_recording_staging.verifications
FOR EACH STATEMENT EXECUTE FUNCTION local_recording_staging.prevent_mutation();
--> statement-breakpoint
CREATE FUNCTION local_recording_staging.prevent_verified_append() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM local_recording_staging.recordings WHERE id = NEW.staging_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM local_recording_staging.verifications WHERE staging_id = NEW.staging_id) THEN
    RAISE EXCEPTION 'STAGING_ALREADY_VERIFIED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staging_prevent_verified_append BEFORE INSERT ON local_recording_staging.chunks
FOR EACH ROW EXECUTE FUNCTION local_recording_staging.prevent_verified_append();
--> statement-breakpoint
REVOKE ALL ON local_recording_staging.verifications FROM PUBLIC;
REVOKE ALL ON FUNCTION local_recording_staging.validate_attestation() FROM PUBLIC;
REVOKE ALL ON FUNCTION local_recording_staging.prevent_verified_append() FROM PUBLIC;


-- Reviewed feature delta source: 0020_company_recording_transfer_intent
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


-- Reviewed feature delta source: 0021_company_recording_transfer_coordination
-- Local disposable-test coordination only. No worker is enabled by this migration.
ALTER TABLE company_recording_transfer_intents
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN drive_confirmed_offset bigint NOT NULL DEFAULT 0 CHECK (drive_confirmed_offset >= 0),
  ADD COLUMN transfer_state text NOT NULL DEFAULT 'ready'
    CHECK (transfer_state IN ('ready', 'reconcile_required', 'awaiting_drive_verification')),
  ADD CONSTRAINT company_recording_transfer_lease_pair CHECK ((lease_token IS NULL) = (lease_until IS NULL));
--> statement-breakpoint
CREATE INDEX company_recording_transfer_intents_lease_idx
  ON company_recording_transfer_intents (lease_until) WHERE lease_token IS NOT NULL;


-- Reviewed feature delta source: 0022_company_recording_drive_verifications
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


-- Reviewed feature delta source: 0023_batch_student_enrollments
CREATE TABLE batch_student_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id text NOT NULL REFERENCES recording_batch_folders(folder_id) ON DELETE CASCADE,
  student_name varchar(120) NOT NULL,
  student_email varchar(255) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  removed_at timestamptz,
  removed_by uuid,
  CONSTRAINT batch_enrollment_email_normalized CHECK (student_email = lower(btrim(student_email)) AND length(student_email) > 0),
  CONSTRAINT batch_enrollment_status_metadata CHECK ((status = 'pending' AND approved_by IS NULL AND removed_at IS NULL AND removed_by IS NULL) OR (status = 'approved' AND approved_by IS NOT NULL AND removed_at IS NULL AND removed_by IS NULL) OR (status = 'removed' AND removed_at IS NOT NULL AND removed_by IS NOT NULL)),
  CONSTRAINT batch_student_enrollments_folder_email_idx UNIQUE (folder_id, student_email)
);
--> statement-breakpoint
CREATE TABLE batch_student_enrollment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES batch_student_enrollments(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('added', 'approved', 'removed', 'reapproved')),
  actor_user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX batch_student_enrollment_events_enrollment_idx ON batch_student_enrollment_events(enrollment_id, occurred_at, id);


-- Reviewed feature delta source: 0024_batch_registration
ALTER TABLE batch_student_enrollments ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','registration'));
ALTER TABLE batch_student_enrollments ADD COLUMN email_verified_at timestamptz;
--> statement-breakpoint
ALTER TABLE batch_student_enrollment_events ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE batch_student_enrollment_events DROP CONSTRAINT batch_student_enrollment_events_action_check;
ALTER TABLE batch_student_enrollment_events ADD CONSTRAINT batch_student_enrollment_events_action_check CHECK (action IN ('added','approved','removed','reapproved','registered','email_verified'));
ALTER TABLE batch_student_enrollment_events ADD CONSTRAINT batch_student_enrollment_event_actor_check CHECK ((action IN ('registered','email_verified') AND actor_user_id IS NULL) OR (action NOT IN ('registered','email_verified') AND actor_user_id IS NOT NULL));
--> statement-breakpoint
CREATE TABLE batch_registration_links (
 folder_id text PRIMARY KEY REFERENCES recording_batch_folders(folder_id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 disabled_at timestamptz,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE batch_registration_verifications (
 token_hash text PRIMARY KEY,
 enrollment_id uuid NOT NULL REFERENCES batch_student_enrollments(id) ON DELETE CASCADE,
 link_hash text NOT NULL,
 requested_name varchar(120) NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX batch_registration_verifications_enrollment_idx ON batch_registration_verifications(enrollment_id);
--> statement-breakpoint
CREATE TABLE batch_registration_limits (
 key_hash text PRIMARY KEY,
 window_started_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL CHECK (attempts > 0)
);
--> statement-breakpoint
-- Account-scoped foundation only. No route may write verified claims until a
-- separately reviewed OpenID Connect account-linking flow exists.
CREATE TABLE student_google_identities (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 google_subject text UNIQUE,
 google_email text,
 verified_at timestamptz,
 CONSTRAINT student_google_identity_unverified CHECK (google_subject IS NULL AND google_email IS NULL AND verified_at IS NULL)
);


-- Reviewed feature delta source: 0025_batch_enrollment_account_bindings
-- A binding requires an authenticated verified account AND a fresh single-use
-- enrollment email proof. Existing enrollments are intentionally not backfilled.
CREATE TABLE batch_enrollment_account_bindings (
  enrollment_id uuid PRIMARY KEY REFERENCES batch_student_enrollments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bound_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX batch_enrollment_account_bindings_user_idx ON batch_enrollment_account_bindings(user_id, enrollment_id);


-- Reviewed feature delta source: 0026_student_google_oidc
-- Separate student OIDC identity and one-use, session-bound authorization attempts.
ALTER TABLE student_google_identities DROP CONSTRAINT student_google_identity_unverified;
ALTER TABLE student_google_identities ADD CONSTRAINT student_google_identity_complete CHECK (
 (google_subject IS NULL AND google_email IS NULL AND verified_at IS NULL) OR
 (google_subject IS NOT NULL AND google_email IS NOT NULL AND verified_at IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE student_google_subject_reservations (
 google_subject text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id, google_subject)
);
CREATE TABLE student_google_oidc_attempts (
 state_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
 nonce text NOT NULL,
 verifier text NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_google_oidc_attempts_user_idx ON student_google_oidc_attempts(user_id, created_at);
CREATE TABLE student_google_identity_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 action text NOT NULL CHECK (action IN ('linked','unlinked')),
 subject_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);


-- Reviewed feature delta source: 0027_private_recording_acl_coordination
CREATE TABLE company_recording_private_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES company_recording_upload_jobs(id),
  recording_id uuid NOT NULL UNIQUE,
  drive_file_id text NOT NULL,
  destination_folder_id text NOT NULL,
  company_account_email varchar(255) NOT NULL,
  credential_generation uuid NOT NULL,
  policy_mode text NOT NULL CHECK (policy_mode = 'private'),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applying','verified','blocked','reconciliation_required')),
  lease_token uuid,
  lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  lease_until timestamptz,
  reconciliation_status text NOT NULL DEFAULT 'not_required' CHECK (reconciliation_status IN ('not_required','required','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, policy_version)
);
--> statement-breakpoint
CREATE INDEX company_recording_private_policies_lease_idx ON company_recording_private_policies(status, lease_until);
CREATE TABLE company_recording_private_readers (
  policy_id uuid NOT NULL REFERENCES company_recording_private_policies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  google_subject text NOT NULL,
  google_email varchar(255) NOT NULL,
  role text NOT NULL CHECK (role = 'reader'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, user_id),
  UNIQUE (policy_id, google_subject),
  UNIQUE (policy_id, google_email)
);
CREATE TABLE company_recording_private_acl_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES company_recording_private_policies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  google_subject text NOT NULL,
  google_email varchar(255) NOT NULL,
  desired_role text NOT NULL CHECK (desired_role = 'reader'),
  permission_id text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','in_progress','applied','retryable','reconciliation_required','revoked')),
  fencing_epoch bigint NOT NULL DEFAULT 0 CHECK (fencing_epoch >= 0),
  lease_token uuid,
  lease_until timestamptz,
  provider_result text,
  failure_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, user_id)
);
CREATE TABLE company_recording_private_acl_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES company_recording_private_acl_operations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES company_recording_private_policies(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('intent_created','lease_acquired','applied','retryable','reconciliation_required','revoked')),
  permission_id text,
  fencing_epoch bigint NOT NULL CHECK (fencing_epoch >= 0),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX company_recording_private_acl_audit_policy_idx ON company_recording_private_acl_audit(policy_id, created_at);


-- Reviewed feature delta source: 0028_recording_sharing_modes
ALTER TABLE company_recording_private_policies DROP CONSTRAINT IF EXISTS company_recording_private_policies_policy_mode_check;
ALTER TABLE company_recording_private_policies ADD CONSTRAINT company_recording_private_policies_policy_mode_check CHECK (policy_mode IN ('private','restricted','anyone_with_link'));
ALTER TABLE company_recording_private_policies ADD COLUMN IF NOT EXISTS host_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE company_recording_private_policies ADD COLUMN IF NOT EXISTS public_permission_id text;
ALTER TABLE company_recording_private_policies ADD COLUMN IF NOT EXISTS sharing_version integer NOT NULL DEFAULT 1 CHECK (sharing_version > 0);
ALTER TABLE company_recording_private_acl_operations ADD COLUMN IF NOT EXISTS operation_kind text NOT NULL DEFAULT 'direct_reader' CHECK (operation_kind IN ('direct_reader','anyone_reader'));
ALTER TABLE company_recording_private_acl_operations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE company_recording_private_acl_operations ALTER COLUMN google_subject DROP NOT NULL;
ALTER TABLE company_recording_private_acl_operations ALTER COLUMN google_email DROP NOT NULL;
CREATE INDEX IF NOT EXISTS company_recording_private_policies_mode_idx ON company_recording_private_policies(policy_mode, status);


-- Reviewed feature delta source: 0029_recording_sharing_policy_versions
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


-- Reviewed feature delta source: 0031_recording_filename_metadata
-- Nullable for pre-existing upload jobs. New frontend uploads provide the
-- recording start time; the server snapshots the meeting title and timezone.
ALTER TABLE company_recording_upload_jobs ADD COLUMN recording_started_at timestamptz;
ALTER TABLE company_recording_upload_jobs ADD COLUMN recording_title varchar(255);
ALTER TABLE company_recording_upload_jobs ADD COLUMN recording_time_zone varchar(100);
ALTER TABLE company_recording_upload_jobs ADD COLUMN recording_filename text;


-- Reviewed feature delta source: 0032_secure_backend_recording_student_tables
-- These tables are accessed by the backend, not by browser Supabase clients.
-- The migration runner applies this together with pending table creation in one
-- transaction, so default API grants never become visible between migrations.
DO $$
DECLARE
  table_name text;
  api_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'recording_batch_folders', 'recording_batch_folder_permissions',
    'drive_integration_credentials', 'recording_folder_creators',
    'drive_integration_generation', 'company_recording_upload_jobs',
    'company_recording_transfer_intents', 'company_recording_drive_verifications',
    'batch_student_enrollments', 'batch_student_enrollment_events',
    'batch_registration_links', 'batch_registration_verifications',
    'batch_registration_limits', 'student_google_identities',
    'batch_enrollment_account_bindings', 'student_google_subject_reservations',
    'student_google_oidc_attempts', 'student_google_identity_events',
    'company_recording_private_policies', 'company_recording_private_readers',
    'company_recording_private_acl_operations', 'company_recording_private_acl_audit',
    'company_recording_anyone_confirmations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, api_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;


-- The feature branch contains 0030_recording_consent_audit.sql but its journal
-- never included it. Create its objects here; do not forge a 0030 ledger row.
CREATE TABLE meeting_recording_consent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  occurrence_id uuid REFERENCES meeting_occurrences(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz
);
CREATE UNIQUE INDEX meeting_recording_consent_active_idx ON meeting_recording_consent_requests(meeting_id) WHERE stopped_at IS NULL;
CREATE TABLE meeting_recording_consent_responses (
  request_id uuid NOT NULL REFERENCES meeting_recording_consent_requests(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES meeting_participants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  auth_session_id uuid NOT NULL,
  agreed boolean NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, participant_id)
);
-- These audit records are backend-only, as with the feature's other sensitive tables.
ALTER TABLE meeting_recording_consent_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_recording_consent_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE meeting_recording_consent_requests, meeting_recording_consent_responses FROM PUBLIC;
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.meeting_recording_consent_requests, public.meeting_recording_consent_responses FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
