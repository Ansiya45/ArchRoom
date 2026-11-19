-- Forward extension. Historical ledgers and meeting ownership stay unchanged.
ALTER TABLE public.meetings ADD COLUMN assigned_host_user_id uuid
  REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX meetings_assigned_host_idx ON public.meetings(assigned_host_user_id);
CREATE TABLE drizzle.meeting_host_assignment_runs (
  id text PRIMARY KEY,
  migration_hash text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
