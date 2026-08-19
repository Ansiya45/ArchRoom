CREATE TYPE "public"."participant_admission" AS ENUM('pending', 'admitted', 'denied');--> statement-breakpoint
ALTER TABLE "meeting_participants" ADD COLUMN "admission" "participant_admission" DEFAULT 'admitted' NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_participants" ALTER COLUMN "admission" SET DEFAULT 'pending';
