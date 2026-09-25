-- Phase 4 only: invitation preferences and durable delivery bookkeeping.
CREATE TABLE "meeting_invitations" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "meeting_id" uuid NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
 "email" varchar(255) NOT NULL,
 "reminders_enabled" boolean DEFAULT false NOT NULL,
 "created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_invitations_email_uidx" ON "meeting_invitations" ("meeting_id", "email");--> statement-breakpoint
CREATE TABLE "meeting_deliveries" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "invitation_id" uuid NOT NULL REFERENCES "meeting_invitations"("id") ON DELETE CASCADE,
 "meeting_id" uuid NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
 "occurrence_id" uuid REFERENCES "meeting_occurrences"("id"),
 "delivery_key" varchar(255) NOT NULL UNIQUE,
 "kind" varchar(20) NOT NULL,
 "scheduled_at" timestamptz,
 "due_at" timestamptz NOT NULL,
 "expires_at" timestamptz NOT NULL,
 "status" varchar(20) DEFAULT 'pending' NOT NULL,
 "attempts" integer DEFAULT 0 NOT NULL,
 "first_attempt_at" timestamptz,
 "payload" jsonb,
 "sent_at" timestamptz
);--> statement-breakpoint
CREATE INDEX "meeting_deliveries_due_idx" ON "meeting_deliveries" ("status", "due_at");
