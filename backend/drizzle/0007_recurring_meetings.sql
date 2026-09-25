-- Keep the existing meetings parent and all legacy timestamps unchanged.
ALTER TYPE "public"."meeting_schedule_type" ADD VALUE 'recurring';--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "recurrence_rule" jsonb;--> statement-breakpoint
ALTER TABLE "meeting_occurrences" ADD COLUMN "scheduled_at" timestamptz;--> statement-breakpoint
ALTER TABLE "meeting_occurrences" ADD COLUMN "original_scheduled_at" timestamptz;--> statement-breakpoint
ALTER TABLE "meeting_occurrences" ALTER COLUMN "start_request_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_occurrences" ALTER COLUMN "started_at" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_original_start_uidx" ON "meeting_occurrences" ("meeting_id", "original_scheduled_at");
