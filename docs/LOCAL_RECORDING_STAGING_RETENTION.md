# Local recording staging retention foundation (0018)

This document describes the original 0018 foundation. The subsequent local-only
HTTP ingestion and verification layer is documented in
[LOCAL_RECORDING_INGESTION.md](LOCAL_RECORDING_INGESTION.md); its activation defaults
remain off. The retention, quota and sensitive-data rules below still apply.

This schema is for disposable local tests only, not approved for production. No
application service, endpoint, upload or cleanup job uses it. The existing company
upload flag remains off. Do not deploy/apply 0018 to existing databases in this phase.

Inserts require a loopback TCP PostgreSQL server, database name matching
`ylaam_staging_disposable_[a-z0-9_]+`, and explicit connection setting
`ylaam.local_staging_test = 'enabled'`. This is a test guard, not a security boundary
against the database owner. Future runtime ingestion must additionally reject
production and require explicit local-test configuration and job authorization.
No such runtime activation exists in this foundation.

## Retention

The private `local_recording_staging` schema contains `recordings`, `chunks`, and
one `capacity` row. A recording has an independent UUID. Insertion locks and reads
an existing upload job and snapshots its IDs, MIME, length and digest server-side.
It retains historical job/recording/owner/meeting/occurrence UUIDs, not names,
emails, titles, credentials, Drive sessions or recording access tokens. These UUIDs
are still pseudonymous personal information; the bytes themselves are sensitive.

Historical references deliberately have no foreign keys to live application rows.
Deleting a job, meeting, occurrence/session, or account therefore retains staging
without blocking or changing existing cascades. Missing source jobs make entries
orphaned; UUIDs are audit evidence, never authorization for recovery. No normal-user
API exposes staging or orphaned recordings. Any future recovery requires a separately
approved policy, and must not infer ownership from reused identities.

Chunks reference the independent staging identity with RESTRICT. Updates, deletes
and truncation of either retention table are rejected. Incomplete recordings remain
indefinitely. No timeout, automatic cleanup or deletion API exists. Cleanup requires
a later approved policy and coordinated accounting changes. Privileged database
owners can override database protections; restrict their access operationally.

## Quota and transactions

Fixed limits: 512 MiB aggregate binary payload, 128 MiB declared per recording,
8 MiB per chunk, 256 KiB alignment except the final length. SQL checks/triggers enforce
limits without configurable overrides. Per-recording row locks serialize inserts;
offsets must equal already stored byte length. A server-generated chunk SHA-256 and
length describe the actual bytea, not client claims. Full-file verification is NOT
implemented yet, and nothing here marks a recording verified or uploaded.

An AFTER INSERT trigger reserves capacity with a conditional UPDATE of a singleton
row. PostgreSQL locks and rechecks that row across connections. Reservation and
chunk insertion commit or roll back together. Unique-key failures and ON CONFLICT
DO NOTHING cannot leak a reservation. Orphans continue consuming capacity because
their bytes and reservations remain. Exhaustion returns STAGING_CAPACITY_EXHAUSTED
and preserves all earlier data. Application errors will need sanitizing in future
ingestion endpoints. Deadlocks/serialization errors must be retried as whole
transactions, never as partially accepted operations.

512 MiB measures payload, not disk usage. PostgreSQL rows, indexes, TOAST storage,
WAL, replicas, backups and temporary space increase real storage and I/O costs.
Database/backup storage is not application-encrypted by this migration. Restrict
filesystem/database access; encrypt storage/backups if later approved. There is no
public schema grant. No browser passphrases or encryption keys are stored here.

## Tests and next phase

`backend/tests/disposable/staging-retention.test.ts` accepts only its hardcoded new
cluster, verifies host/port/database/data directory and an empty schema, migrates
twice, and tests deletion retention, limits, quota, rollback and concurrent writers.
The capacity-boundary test seeds the singleton as a privileged test fixture rather
than allocating 512 MiB, then reconciles it to actual retained chunks.

Next: explicit runtime local-only gates, authenticated bounded ingestion, identical
retry comparison, request deadlines, full-file SHA-256 verification and restart
tests. No Drive file creation, transfer, sharing, or verified History publication is
part of this foundation.
