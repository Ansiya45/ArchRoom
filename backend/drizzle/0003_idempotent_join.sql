ALTER TABLE "meeting_participants" ADD COLUMN "join_request_id" uuid;--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "meeting_id", "user_id"
    ORDER BY "joined_at" DESC, "id" DESC
  ) AS duplicate_number
  FROM "meeting_participants"
  WHERE "user_id" IS NOT NULL AND "left_at" IS NULL
)
UPDATE "meeting_participants"
SET "left_at" = now()
WHERE "id" IN (SELECT "id" FROM ranked WHERE duplicate_number > 1);--> statement-breakpoint
CREATE UNIQUE INDEX "participants_meeting_request_uidx" ON "meeting_participants" USING btree ("meeting_id", "join_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_active_user_uidx" ON "meeting_participants" USING btree ("meeting_id", "user_id") WHERE "user_id" IS NOT NULL AND "left_at" IS NULL;
