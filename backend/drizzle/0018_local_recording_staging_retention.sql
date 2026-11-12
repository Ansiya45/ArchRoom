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
