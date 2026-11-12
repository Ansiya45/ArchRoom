ALTER TABLE batch_student_enrollments ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','registration'));
ALTER TABLE batch_student_enrollments ADD COLUMN email_verified_at timestamptz;
--> statement-breakpoint
ALTER TABLE batch_student_enrollment_events ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE batch_student_enrollment_events DROP CONSTRAINT batch_student_enrollment_events_action_check;
ALTER TABLE batch_student_enrollment_events ADD CONSTRAINT batch_student_enrollment_events_action_check CHECK (action IN ('added','approved','removed','reapproved','registered','email_verified'));
ALTER TABLE batch_student_enrollment_events ADD CONSTRAINT batch_student_enrollment_event_actor_check CHECK ((action IN ('registered','email_verified') AND actor_user_id IS NULL) OR (action NOT IN ('registered','email_verified') AND actor_user_id IS NOT NULL));
--> statement-breakpoint
CREATE TABLE batch_registration_links (
 folder_id text PRIMARY KEY REFERENCES recording_batch_folders(folder_id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 disabled_at timestamptz,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE batch_registration_verifications (
 token_hash text PRIMARY KEY,
 enrollment_id uuid NOT NULL REFERENCES batch_student_enrollments(id) ON DELETE CASCADE,
 link_hash text NOT NULL,
 requested_name varchar(120) NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX batch_registration_verifications_enrollment_idx ON batch_registration_verifications(enrollment_id);
--> statement-breakpoint
CREATE TABLE batch_registration_limits (
 key_hash text PRIMARY KEY,
 window_started_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL CHECK (attempts > 0)
);
--> statement-breakpoint
-- Account-scoped foundation only. No route may write verified claims until a
-- separately reviewed OpenID Connect account-linking flow exists.
CREATE TABLE student_google_identities (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 google_subject text UNIQUE,
 google_email text,
 verified_at timestamptz,
 CONSTRAINT student_google_identity_unverified CHECK (google_subject IS NULL AND google_email IS NULL AND verified_at IS NULL)
);
