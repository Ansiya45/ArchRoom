# Local authenticated recording ingestion (0019)

This is PostgreSQL staging only. No Google file/session creation, media transfer,
sharing, frontend upload initiation, or Meeting History publication is implemented.
Existing recording controls, manual upload and encrypted recovery are unchanged.

## Activation and safety

Both `COMPANY_DRIVE_UPLOAD_JOBS_ENABLED` and `LOCAL_RECORDING_STAGING_ENABLED` default
to false. No environment files are changed. Staging also requires NODE_ENV=test or
development and a literal loopback PostgreSQL URL without connection query overrides,
with database name `ylaam_staging_disposable_[a-z0-9_]+`. Each transaction checks the
actual PostgreSQL connection using 0018's guard and sets test activation transaction
locally. Production fails closed even with flags enabled. Do not apply migrations
or activate these endpoints on existing databases; production staging is unapproved.

## Protocol

Base path: `/recording-staging/jobs/:jobId/recordings/:recordingId`.

* POST `/chunks`: Authorization bearer token, Content-Type application/octet-stream,
  Content-Length, and Content-Range `bytes START-END/TOTAL`; body is one original
  canonical MediaRecorder chunk range. Compression/chunked HTTP framing is rejected.
* GET `/progress`: no body. Returns job/recording IDs, MIME, total byteLength,
  ingestionOffset, ingestionState (unverified/verified), verifiedAt.
* POST `/verify`: no body. Streams stored chunks through SHA-256 and returns progress.

These endpoints reuse existing JWT/session validation and company-job host/session
authorization. Authorization is repeated under database locks. Slow chunk requests
recheck the session after reading the body. Cross-origin requests require an allowed
origin; authorization is never taken from cookies. OPTIONS is a gated CORS preflight,
not data access. Errors are sanitized and responses are no-store. No endpoint reads
recording bytes back to a browser, and no credentials/session URLs are returned.

Bodies are bounded at 8 MiB; at most four requests are active per process. Each
request has a 30-second wall-clock deadline (90 seconds for verification), database
lock/statement timeouts, and bounded buffering. Verification has a 60-second loop
deadline and reads one persisted chunk at a time. An aborted/incomplete body is not
inserted. A connection lost after commit is an uncertain acknowledgement; query
progress or retry identical bytes. Never infer acceptance from bytes sent.

## Coordination and integrity

Locks follow meeting, occurrence, participant, job, staging-row order. Job locking
coordinates separate backend instances. The staging identity must exactly match
the job's owner, recording, meeting/session, MIME, length and digest. Offsets derive
from committed immutable chunks rather than a second mutable counter: insertion
and visible progress are atomic. Drive's confirmed_offset is never changed.

An identical retry compares the complete stored chunk bytes and does not reserve
additional capacity. A different duplicate, gap, overlap or invalid alignment fails.
0018 retains its fixed aggregate/per-file/chunk caps and atomic singleton quota.

Verification checks contiguous offsets, stored chunk length/digest, total byte count
and SHA-256 against the original immutable staging snapshot and current job. Only
then does it insert an immutable 0019 verification record in the same transaction.
An incomplete file, wrong digest or failed database write retains chunks without
success. A verified recording cannot accept new chunks; identical retries only read
existing data. No in-memory digest checkpoint is trusted across requests or restarts.

The server proves byte identity with the job's canonical digest. It cannot establish
that a malicious authorized client genuinely sourced a blob from MediaRecorder or
did not declare a repaired preview as its original job metadata. Future frontend
integration must use Phase 5A's canonicalBlob/eligible recovery bytes and digest,
not the repaired preview. This phase adds no frontend transfer caller.

Future Drive transfer must reauthorize the live job, revalidate destination privacy,
and read these exact immutable verified staging rows; browser or preview bytes are
not a substitute. Staging verification is never proof of Drive success.

## Retention

0019 references the independent 0018 staging identity, not a deletable application
row. Parent deletion preserves chunks, quota and verification. Ordinary endpoints
require a live authorized job and cannot expose orphaned entries. Nothing automatically
deletes data, including failed/incomplete recordings. Database plaintext, WAL and
backup considerations from LOCAL_RECORDING_STAGING_RETENTION.md still apply.

0019 adds only the verification table and validation/immutability triggers. Existing
migrations and encrypted credentials remain unchanged. Database owners can bypass
database protections; they remain a trusted operational boundary.
