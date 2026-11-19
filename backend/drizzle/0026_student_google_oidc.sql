-- Separate student OIDC identity and one-use, session-bound authorization attempts.
ALTER TABLE student_google_identities DROP CONSTRAINT student_google_identity_unverified;
ALTER TABLE student_google_identities ADD CONSTRAINT student_google_identity_complete CHECK (
 (google_subject IS NULL AND google_email IS NULL AND verified_at IS NULL) OR
 (google_subject IS NOT NULL AND google_email IS NOT NULL AND verified_at IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE student_google_subject_reservations (
 google_subject text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id, google_subject)
);
CREATE TABLE student_google_oidc_attempts (
 state_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
 nonce text NOT NULL,
 verifier text NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX student_google_oidc_attempts_user_idx ON student_google_oidc_attempts(user_id, created_at);
CREATE TABLE student_google_identity_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 action text NOT NULL CHECK (action IN ('linked','unlinked')),
 subject_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
