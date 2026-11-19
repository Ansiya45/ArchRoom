-- A binding requires an authenticated verified account AND a fresh single-use
-- enrollment email proof. Existing enrollments are intentionally not backfilled.
CREATE TABLE batch_enrollment_account_bindings (
  enrollment_id uuid PRIMARY KEY REFERENCES batch_student_enrollments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bound_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX batch_enrollment_account_bindings_user_idx ON batch_enrollment_account_bindings(user_id, enrollment_id);
