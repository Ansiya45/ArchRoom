-- No backfill: legacy and one-time meetings keep NULL occurrence references.
ALTER TYPE "public"."meeting_schedule_type" ADD VALUE 'reusable';--> statement-breakpoint
CREATE TABLE "meeting_occurrences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "meeting_id" uuid NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "start_request_id" uuid NOT NULL,
  "status" "meeting_status" DEFAULT 'live' NOT NULL,
  "started_at" timestamptz DEFAULT now() NOT NULL,
  "ended_at" timestamptz
);--> statement-breakpoint
CREATE INDEX "occurrences_meeting_idx" ON "meeting_occurrences" ("meeting_id");--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_start_request_uidx" ON "meeting_occurrences" ("meeting_id", "start_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_one_live_uidx" ON "meeting_occurrences" ("meeting_id") WHERE "status" = 'live';--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "active_occurrence_id" uuid REFERENCES "meeting_occurrences"("id");--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD COLUMN "occurrence_id" uuid REFERENCES "meeting_occurrences"("id");--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "occurrence_id" uuid REFERENCES "meeting_occurrences"("id");--> statement-breakpoint
-- Preserve legacy request uniqueness while allowing the same request ID in different sessions.
DROP INDEX "participants_meeting_request_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "participants_meeting_request_uidx" ON "meeting_participants" ("meeting_id", "join_request_id") WHERE "occurrence_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "participants_occurrence_request_uidx" ON "meeting_participants" ("occurrence_id", "join_request_id");--> statement-breakpoint
CREATE INDEX "participants_occurrence_idx" ON "meeting_participants" ("occurrence_id");--> statement-breakpoint
CREATE INDEX "recordings_occurrence_idx" ON "recordings" ("occurrence_id");
