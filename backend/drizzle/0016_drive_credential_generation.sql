CREATE TABLE drive_integration_generation (
  id integer PRIMARY KEY CHECK (id = 1),
  generation uuid NOT NULL
);
--> statement-breakpoint
INSERT INTO drive_integration_generation (id, generation) VALUES (1, '00000000-0000-4000-8000-000000000000');
