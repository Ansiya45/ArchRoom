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
