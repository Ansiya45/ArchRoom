CREATE TABLE batch_student_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id text NOT NULL REFERENCES recording_batch_folders(folder_id) ON DELETE CASCADE,
  student_name varchar(120) NOT NULL,
  student_email varchar(255) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  removed_at timestamptz,
  removed_by uuid,
  CONSTRAINT batch_enrollment_email_normalized CHECK (student_email = lower(btrim(student_email)) AND length(student_email) > 0),
  CONSTRAINT batch_enrollment_status_metadata CHECK ((status = 'pending' AND approved_by IS NULL AND removed_at IS NULL AND removed_by IS NULL) OR (status = 'approved' AND approved_by IS NOT NULL AND removed_at IS NULL AND removed_by IS NULL) OR (status = 'removed' AND removed_at IS NOT NULL AND removed_by IS NOT NULL)),
  CONSTRAINT batch_student_enrollments_folder_email_idx UNIQUE (folder_id, student_email)
);
--> statement-breakpoint
CREATE TABLE batch_student_enrollment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES batch_student_enrollments(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('added', 'approved', 'removed', 'reapproved')),
  actor_user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX batch_student_enrollment_events_enrollment_idx ON batch_student_enrollment_events(enrollment_id, occurred_at, id);
