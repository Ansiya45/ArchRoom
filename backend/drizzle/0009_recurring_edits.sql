-- Preserve parent identities, original dates, attendance and recording history.
ALTER TABLE "meetings" ADD COLUMN "recurrence_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "recurrence_history" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "recurrence_cancelled_at" timestamptz;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "recurrence_edited_at" timestamptz;--> statement-breakpoint
ALTER TABLE "meeting_occurrences" ADD COLUMN "recurrence_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_occurrences" ADD COLUMN "time_zone" varchar(100);--> statement-breakpoint
ALTER TABLE "meeting_occurrences" ADD COLUMN "cancelled_at" timestamptz;--> statement-breakpoint
ALTER TABLE "meeting_occurrences" ADD COLUMN "cancellation_reason" varchar(30);--> statement-breakpoint
-- Revised schedules can reuse a clock instant without colliding with preserved history.
DROP INDEX "occurrences_original_start_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "occurrences_original_start_uidx" ON "meeting_occurrences" ("meeting_id", "recurrence_revision", "original_scheduled_at");
