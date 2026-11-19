# Company Drive resumable transfer intent (0020)

This is an isolated, mock-tested backend foundation. No router, worker, or frontend
initiates it. The production and disposable-database guards in 0018 and the local
ingestion service remain unchanged. Both upload and local staging flags default off.
No real Google Drive account was contacted during implementation or tests.

Google documents pre-generated IDs and 409 on a successful duplicate create, and
resumable sessions with HTTP 308 plus a confirmed `Range`. The transport models
those responses and disables redirects. It sends a fixed file ID, MIME, length,
name, and one previously validated destination parent on session initiation. It
never treats HTTP 200/201 as verified Drive completion.

The service requires a live, authorized job and a matching 0019 server-verified
staging record. It calls the existing Phase 5B privacy gate before reserving a
file ID and again immediately before the one permitted session-initiation attempt.
SAFE must match the job's saved destination. The company account email and
credential generation are stored with the pre-generated file ID. Only the backend
sees provider access tokens and the AES-256-GCM encrypted session URI. The session
envelope binds job, recording, owner, Drive ID, account and generation.

0020 stores transfer intents independently of job foreign keys. If an account,
meeting, session, or job is deleted, its historical intent persists without a
normal-user access path. Session initiation sets a durable attempted bit BEFORE
the external request. If a provider response or DB write is lost, the bit blocks
automatic reinitiation; a future approved reconciliation process must inspect the
same pre-generated Drive ID. Concurrent workers may allocate unused IDs, but only
one file ID and one attempted session can be committed per job.

The transport supports ID allocation, session initiation, Drive offset queries,
and one bounded aligned chunk request. No worker yet moves verified staging bytes
to Drive. `readVerifiedChunk` provides an internal, bounded source but does not
send bytes. Database-coordinated transfer leases/fencing, Drive file metadata
verification, permission rechecks during transfer, automatic uncertain-outcome
reconciliation, terminal job state, Meeting History publication and frontend
initiation remain for later phases. A successful session-initiation response is
not evidence that media was uploaded or shared.

The existing Drive connection must be used by a future runtime adapter. The
service currently accepts a backend-only access callback; tests inject a mock
company account and token. It must not be exposed to clients before the remaining
transfer coordination and account adapter are implemented and tested.
