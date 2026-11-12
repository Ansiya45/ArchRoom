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
