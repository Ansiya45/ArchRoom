# Local mock Drive media worker (0021)

The worker is a manually invoked backend service. There is no route, timer,
startup hook or frontend caller. It requires the existing two feature flags,
the disposable-only PostgreSQL URL, the SQL local-test guard, a live authorized
job, matching 0019 verified staging, a 0020 encrypted session intent, a current
company account and a fresh SAFE result for the exact saved destination.

0021 adds a transfer state, Drive-confirmed offset, lease token, monotonically
increasing fencing epoch and lease deadline to the existing transfer intent.
The worker claims one job in a PostgreSQL transaction. Other workers see it as
busy. Each database progress write checks token, epoch and deadline; stale
workers cannot overwrite a successor. A worker sends at most one 8 MiB staging
chunk per invocation, and the provider request has a 20-second timeout against
a 90-second lease. The caller may invoke another step after the lease is
released. Staged bytes are read only through the existing verified source and
the 0018 rows remain immutable.

Every invocation queries the persisted resumable session for Drive's confirmed
offset before sending. It never trusts the last request sent or a browser
offset. A valid offset may advance the durable intent offset. Behind, unaligned,
out-of-range, conflicting, expired or unavailable replies stop in reconciliation
state. Lost acknowledgments are resolved by a later offset query. An uncertain
final response or expired session is investigated through GET of the same
pre-generated Drive file ID. A matching ID moves the intent to
`awaiting_drive_verification`; absence or uncertainty leaves
`reconcile_required`. A missing encrypted session is never replaced blindly.
No automatic new file ID or new session is created by the worker.

The 0017 upload job remains pending, its separate Drive-confirmed offset remains
unchanged, and Meeting History is not published. The next phase must verify
Drive metadata, expected parent, MIME, size, non-trashed state and sharing before
marking the job complete or publishing a link. The worker does not delete
PostgreSQL chunks, intent rows, or browser recovery data.

The test transport uses mocked Google responses only. A stalled process can
outlive a lease in an extreme pause; a second worker might then send the same
immutable bytes to the same session. Fencing prevents stale database writes,
and each invocation reconciles Drive's offset, but Google does not support our
lease epoch. Production activation needs separate assessment and approval,
especially because 0018 explicitly forbids non-disposable or production
staging. No environment value was enabled in this phase.
