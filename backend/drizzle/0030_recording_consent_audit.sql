-- Separate from AI consent. Only authenticated account sessions are supported;
-- guest consent remains unavailable until a verifiable guest session exists.
CREATE TABLE meeting_recording_consent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  occurrence_id uuid REFERENCES meeting_occurrences(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX meeting_recording_consent_active_idx ON meeting_recording_consent_requests(meeting_id) WHERE stopped_at IS NULL;
--> statement-breakpoint
CREATE TABLE meeting_recording_consent_responses (
  request_id uuid NOT NULL REFERENCES meeting_recording_consent_requests(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES meeting_participants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  -- Preserve the session identifier for audit without blocking normal logout.
  auth_session_id uuid NOT NULL,
  agreed boolean NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, participant_id)
);
