$ErrorActionPreference = 'Stop'
$db = "ylaam_phase6c_test_$([guid]::NewGuid().ToString('N').Substring(0,12))"
$role = "ylaam_test_runner_$([guid]::NewGuid().ToString('N').Substring(0,12))"
$password = [guid]::NewGuid().ToString('N')
$pg = 'C:\Program Files\PostgreSQL\17\bin'
$createdDb = $false
$createdRole = $false
$compiled = Join-Path (Get-Location).Path ('.disposable-acl-' + [guid]::NewGuid().ToString('N'))
$compiledCreated = $false
function Assert-NativeSuccess($step) { if ($LASTEXITCODE -ne 0) { throw "$step failed (exit $LASTEXITCODE)" } }
try {
  & "$pg\createuser.exe" -h 127.0.0.1 -U postgres $role
  Assert-NativeSuccess 'create test role'
  $createdRole = $true
  & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "alter role $role password '$password';"
  Assert-NativeSuccess 'configure test role'
  & "$pg\createdb.exe" -h 127.0.0.1 -U postgres -O $role $db
  Assert-NativeSuccess 'create disposable database'
  $createdDb = $true
  $env:TEST_DATABASE_URL = "postgres://${role}:$password@127.0.0.1:5432/$db"
  node tests/verify-node-db.mjs
  Assert-NativeSuccess 'verify Node database connection'
  $env:DATABASE_URL = $env:TEST_DATABASE_URL
  $env:DISPOSABLE_DATABASE_URL = $env:TEST_DATABASE_URL
  $env:NODE_ENV = 'test'
  $env:DOTENV_CONFIG_PATH = 'tests/.unused'
  Get-ChildItem drizzle -Filter '*.sql' | Sort-Object Name | ForEach-Object { & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $db -v ON_ERROR_STOP=1 -f $_.FullName | Out-Null; Assert-NativeSuccess 'apply disposable migration' }
  & "$pg\psql.exe" -h 127.0.0.1 -U postgres -d $db -v ON_ERROR_STOP=1 -c "grant usage on schema public to $role; grant all privileges on all tables in schema public to $role; grant all privileges on all sequences in schema public to $role; grant usage on schema local_recording_staging to $role; grant all privileges on all tables in schema local_recording_staging to $role;"
  Assert-NativeSuccess 'grant disposable permissions'
  New-Item -ItemType Directory -Path $compiled | Out-Null
  $compiledCreated = $true
  npx.cmd tsc -p tests/tsconfig.disposable.json --outDir $compiled
  Assert-NativeSuccess 'compile disposable tests'
  node --test (Join-Path $compiled 'tests/disposable/company-recording-private-acl.test.js')
  Assert-NativeSuccess 'run disposable tests'
} finally {
  if ($compiledCreated -and $compiled -eq (Join-Path (Get-Location).Path ([IO.Path]::GetFileName($compiled))) -and [IO.Path]::GetFileName($compiled) -match '^\.disposable-acl-[a-f0-9]{32}$') { Remove-Item -LiteralPath $compiled -Recurse -Force }
  if ($createdDb -and $db -match '^ylaam_phase6c_test_[a-f0-9]{12}$') { & "$pg\dropdb.exe" -h 127.0.0.1 -U postgres $db; Assert-NativeSuccess 'drop disposable database' }
  if ($createdRole -and $role -match '^ylaam_test_runner_[a-f0-9]{12}$') { & "$pg\dropuser.exe" -h 127.0.0.1 -U postgres $role; Assert-NativeSuccess 'drop temporary role' }
}
