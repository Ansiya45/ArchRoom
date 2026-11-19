CREATE TABLE recording_batch_folders (
  folder_id text PRIMARY KEY,
  name varchar(255) NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recording_batch_folder_id_check CHECK (folder_id ~ '^[A-Za-z0-9_-]{10,128}$')
);
--> statement-breakpoint
CREATE TABLE recording_batch_folder_permissions (
  folder_id text NOT NULL REFERENCES recording_batch_folders(folder_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL CHECK (role IN ('manager', 'trainer', 'viewer')),
  PRIMARY KEY (folder_id, user_id)
);
--> statement-breakpoint
CREATE INDEX recording_batch_folder_permissions_user_idx ON recording_batch_folder_permissions(user_id);
--> statement-breakpoint
CREATE TABLE drive_integration_credentials (
  id integer PRIMARY KEY CHECK (id = 1),
  google_account_email varchar(255) NOT NULL,
  encrypted_refresh_token text NOT NULL,
  connected_by_user_id uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
