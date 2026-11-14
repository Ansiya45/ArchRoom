ALTER TABLE meetings ADD COLUMN transcript_access varchar(10) NOT NULL DEFAULT 'all' CHECK (transcript_access IN ('all', 'host'));
