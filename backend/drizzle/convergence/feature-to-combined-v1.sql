-- Forward-only feature-lineage additions. Run only after full preflight validation.
CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'user');
CREATE TYPE feature_level AS ENUM ('none', 'read', 'write', 'full');
ALTER TABLE users ADD COLUMN role user_role NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN disabled_at timestamptz;
ALTER TABLE users ADD COLUMN invited_by uuid REFERENCES users(id);
CREATE TABLE user_permissions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature varchar(40) NOT NULL,
  level feature_level NOT NULL DEFAULT 'none',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature)
);
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
CREATE TABLE user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  token_hash varchar(64) NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id),
  permissions jsonb,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_invitations_email_idx ON user_invitations(email);
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ADD COLUMN transcript_access varchar(10) NOT NULL DEFAULT 'all' CHECK (transcript_access IN ('all', 'host'));
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
