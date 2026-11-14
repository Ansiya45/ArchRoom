CREATE TYPE user_role AS ENUM ('superadmin', 'admin', 'user');
--> statement-breakpoint
CREATE TYPE feature_level AS ENUM ('none', 'read', 'write', 'full');
--> statement-breakpoint
ALTER TABLE users ADD COLUMN role user_role NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE users ADD COLUMN disabled_at timestamptz;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN invited_by uuid REFERENCES users(id);
--> statement-breakpoint
CREATE TABLE user_permissions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature varchar(40) NOT NULL,
  level feature_level NOT NULL DEFAULT 'none',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature)
);
--> statement-breakpoint
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'user',
  token_hash varchar(64) NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id),
  permissions jsonb,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX user_invitations_email_idx ON user_invitations(email);
--> statement-breakpoint
ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;
