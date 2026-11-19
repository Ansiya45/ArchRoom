ALTER TABLE meetings ADD COLUMN recording_folder_id text;
--> statement-breakpoint
ALTER TABLE meetings ADD COLUMN recording_access_policy text NOT NULL DEFAULT 'private';
--> statement-breakpoint
ALTER TABLE meetings ADD CONSTRAINT meetings_recording_access_policy_check CHECK (recording_access_policy IN ('private', 'restricted', 'anyone_with_link'));
