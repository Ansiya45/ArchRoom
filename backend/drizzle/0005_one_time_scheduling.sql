-- Additive only: NULL preserves legacy/instant behavior and unknown timezones.
CREATE TYPE "public"."meeting_schedule_type" AS ENUM('one_time');--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "schedule_type" "meeting_schedule_type";--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "time_zone" varchar(100);
