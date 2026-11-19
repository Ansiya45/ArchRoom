CREATE TABLE company_recording_private_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES company_recording_upload_jobs(id),
  recording_id uuid NOT NULL UNIQUE,
  drive_file_id text NOT NULL,
  destination_folder_id text NOT NULL,
  company_account_email varchar(255) NOT NULL,
  credential_generation uuid NOT NULL,
  policy_mode text NOT NULL CHECK (policy_mode = 'private'),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applying','verified','blocked','reconciliation_required')),
  lease_token uuid,
  lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
  lease_until timestamptz,
  reconciliation_status text NOT NULL DEFAULT 'not_required' CHECK (reconciliation_status IN ('not_required','required','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, policy_version)
);
--> statement-breakpoint
CREATE INDEX company_recording_private_policies_lease_idx ON company_recording_private_policies(status, lease_until);
CREATE TABLE company_recording_private_readers (
  policy_id uuid NOT NULL REFERENCES company_recording_private_policies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  google_subject text NOT NULL,
  google_email varchar(255) NOT NULL,
  role text NOT NULL CHECK (role = 'reader'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, user_id),
  UNIQUE (policy_id, google_subject),
  UNIQUE (policy_id, google_email)
);
CREATE TABLE company_recording_private_acl_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES company_recording_private_policies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  google_subject text NOT NULL,
  google_email varchar(255) NOT NULL,
  desired_role text NOT NULL CHECK (desired_role = 'reader'),
  permission_id text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','in_progress','applied','retryable','reconciliation_required','revoked')),
  fencing_epoch bigint NOT NULL DEFAULT 0 CHECK (fencing_epoch >= 0),
  lease_token uuid,
  lease_until timestamptz,
  provider_result text,
  failure_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, user_id)
);
CREATE TABLE company_recording_private_acl_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES company_recording_private_acl_operations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES company_recording_private_policies(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('intent_created','lease_acquired','applied','retryable','reconciliation_required','revoked')),
  permission_id text,
  fencing_epoch bigint NOT NULL CHECK (fencing_epoch >= 0),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX company_recording_private_acl_audit_policy_idx ON company_recording_private_acl_audit(policy_id, created_at);
