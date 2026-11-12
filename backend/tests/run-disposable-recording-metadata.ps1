$ErrorActionPreference = 'Stop'
$db = "ylaam_staging_disposable_$([guid]::NewGuid().ToString('N').Substring(0,12))"
$role = "ylaam_test_runner_$([guid]::NewGuid().ToString('N').Substring(0,12))"
$password = [guid]::NewGuid().ToString('N')
$pg = 'C:\Program Files\PostgreSQL\17\bin'
$createdDb = $false
$createdRole = $false
$compiled = Join-Path (Get-Location).Path ('.recording-integration-' + [guid]::NewGuid().ToString('N') + '.mjs')
function Assert-NativeSuccess($step) { if ($LASTEXITCODE -ne 0) { throw "$step failed (exit $LASTEXITCODE)" } }
try {
  & "$pg\createuser.exe" -h 127.0.0.1 -U postgres $role
  Assert-NativeSuccess 'create disposable role'
  $createdRole = $true
  & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "alter role $role password '$password';" | Out-Null
  Assert-NativeSuccess 'configure disposable role'
  & "$pg\createdb.exe" -h 127.0.0.1 -U postgres -O $role $db
  Assert-NativeSuccess 'create disposable database'
  $createdDb = $true
  $env:TEST_DATABASE_URL = "postgres://${role}:$password@127.0.0.1:5432/$db"
  node tests/verify-node-db.mjs
  Assert-NativeSuccess 'verify disposable connection'
  $env:DATABASE_URL = $env:TEST_DATABASE_URL
  $env:DISPOSABLE_DATABASE_URL = $env:TEST_DATABASE_URL
  $env:NODE_ENV = 'test'
  $env:DOTENV_CONFIG_PATH = 'tests/.unused'
  $env:JWT_SECRET = 'disposable-test-only'
  $env:SUPABASE_URL = ''
  $env:SUPABASE_SERVICE_ROLE_KEY = ''
  Get-ChildItem drizzle -Filter '*.sql' | Where-Object { $_.Name -match '^00(0[0-9]|1[0-9]|2[0-9])_' } | Sort-Object Name | ForEach-Object {
    & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $db -v ON_ERROR_STOP=1 -f $_.FullName | Out-Null
    Assert-NativeSuccess 'apply existing disposable migration'
  }
  & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $db -v ON_ERROR_STOP=1 -c "grant usage on schema public to $role; grant all privileges on all tables in schema public to $role; grant all privileges on all sequences in schema public to $role; grant usage on schema local_recording_staging to $role; grant all privileges on all tables in schema local_recording_staging to $role; grant execute on all functions in schema local_recording_staging to $role;" | Out-Null
  Assert-NativeSuccess 'grant disposable permissions'
  # Model the backend's table-owner role without granting cluster-wide BYPASSRLS.
  & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $db -v ON_ERROR_STOP=1 -c "alter table public.meeting_history_items owner to $role;" | Out-Null
  Assert-NativeSuccess 'set disposable history owner'
  node tests/disposable/recording-metadata.mjs seed
  Assert-NativeSuccess 'seed pre-migration job'
  & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $db -v ON_ERROR_STOP=1 -f 'drizzle/0031_recording_filename_metadata.sql' | Out-Null
  Assert-NativeSuccess 'apply migration 0031'
  node --test tests/disposable/recording-metadata.mjs
  Assert-NativeSuccess 'run metadata migration assertions'
  & ..\frontend\node_modules\.bin\esbuild.cmd tests/disposable/recording-history-guarded.test.ts --bundle --packages=external --platform=node --format=esm --outfile=$compiled
  Assert-NativeSuccess 'compile guarded integration test'
  node --test $compiled
  Assert-NativeSuccess 'run guarded integration test'
} finally {
  if ((Split-Path $compiled -Parent) -eq (Get-Location).Path -and (Split-Path $compiled -Leaf) -match '^\.recording-integration-[a-f0-9]{32}\.mjs$' -and (Test-Path -LiteralPath $compiled)) { Remove-Item -LiteralPath $compiled -Force }
  if ($createdDb -and $db -match '^ylaam_staging_disposable_[a-f0-9]{12}$') { & "$pg\dropdb.exe" -h 127.0.0.1 -U postgres $db; Assert-NativeSuccess 'drop disposable database' }
  if ($createdRole -and $role -match '^ylaam_test_runner_[a-f0-9]{12}$') { & "$pg\dropuser.exe" -h 127.0.0.1 -U postgres $role; Assert-NativeSuccess 'drop disposable role' }
}
