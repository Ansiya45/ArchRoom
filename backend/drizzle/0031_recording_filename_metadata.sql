-- Nullable for pre-existing upload jobs. New frontend uploads provide the
-- recording start time; the server snapshots the meeting title and timezone.
ALTER TABLE company_recording_upload_jobs ADD COLUMN recording_started_at timestamptz;
ALTER TABLE company_recording_upload_jobs ADD COLUMN recording_title varchar(255);
ALTER TABLE company_recording_upload_jobs ADD COLUMN recording_time_zone varchar(100);
ALTER TABLE company_recording_upload_jobs ADD COLUMN recording_filename text;
