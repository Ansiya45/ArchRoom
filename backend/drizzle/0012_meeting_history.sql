CREATE TABLE meeting_history_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  occurrence_id uuid REFERENCES meeting_occurrences(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL CHECK (kind IN ('transcript', 'summary', 'drive')),
  dedupe_key varchar(200) NOT NULL,
  content text NOT NULL,
  label varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Revoke old unanimous-consent requests so the new host-only setting starts off for every active room.
UPDATE meeting_ai_requests SET stopped_at = now() WHERE stopped_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX meeting_history_dedupe_uidx ON meeting_history_items(meeting_id, dedupe_key);
--> statement-breakpoint
CREATE INDEX meeting_history_meeting_idx ON meeting_history_items(meeting_id);
--> statement-breakpoint
ALTER TABLE meeting_history_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE meeting_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  favorite boolean NOT NULL DEFAULT false,
  hidden boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, meeting_id)
);
--> statement-breakpoint
CREATE INDEX meeting_preferences_user_idx ON meeting_preferences(user_id);
--> statement-breakpoint
ALTER TABLE meeting_preferences ENABLE ROW LEVEL SECURITY;
