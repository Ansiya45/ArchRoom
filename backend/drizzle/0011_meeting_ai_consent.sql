CREATE TABLE "meeting_ai_requests" (
  "meeting_id" uuid PRIMARY KEY NOT NULL REFERENCES "meetings"("id") ON DELETE cascade,
  "occurrence_id" uuid REFERENCES "meeting_occurrences"("id"),
  "request_id" uuid NOT NULL,
  "requested_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_heartbeat_at" timestamp with time zone,
  "stopped_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meeting_ai_consents" (
  "request_id" uuid NOT NULL,
  "participant_id" uuid NOT NULL REFERENCES "meeting_participants"("id") ON DELETE cascade,
  "agreed" boolean NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "meeting_ai_consents_request_participant_pk" PRIMARY KEY ("request_id", "participant_id")
);
