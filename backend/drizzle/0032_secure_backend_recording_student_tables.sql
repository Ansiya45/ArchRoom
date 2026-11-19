-- These tables are accessed by the backend, not by browser Supabase clients.
-- The migration runner applies this together with pending table creation in one
-- transaction, so default API grants never become visible between migrations.
DO $$
DECLARE
  table_name text;
  api_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'recording_batch_folders', 'recording_batch_folder_permissions',
    'drive_integration_credentials', 'recording_folder_creators',
    'drive_integration_generation', 'company_recording_upload_jobs',
    'company_recording_transfer_intents', 'company_recording_drive_verifications',
    'batch_student_enrollments', 'batch_student_enrollment_events',
    'batch_registration_links', 'batch_registration_verifications',
    'batch_registration_limits', 'student_google_identities',
    'batch_enrollment_account_bindings', 'student_google_subject_reservations',
    'student_google_oidc_attempts', 'student_google_identity_events',
    'company_recording_private_policies', 'company_recording_private_readers',
    'company_recording_private_acl_operations', 'company_recording_private_acl_audit',
    'company_recording_anyone_confirmations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, api_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;
