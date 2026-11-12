# Company recording upload orchestration

The authenticated recordings procedures request processing, return owner-scoped progress, and retry only a job in the existing `retryable` state when no Drive session creation has been attempted. They do not accept destination, file ID, permission, or progress claims from the client.

The orchestration reuses the upload job, retained PostgreSQL chunks, immutable SHA-256 attestation, transfer intent, worker lease/offset, Drive verification, and History publication records. Progress is derived from those persisted records. After a process restart, a bounded startup/periodic scan discovers fully staged pending jobs and resumes them. The initiating request returns after scheduling work; it does not remain open for a complete recording transfer.

The scan runs only when both existing flags are explicitly enabled outside production, and every stage still enforces the loopback disposable-database guard. Both flags remain off by default. Production uploads remain unavailable; lifting the local-only staging guard and deploying a production worker are separate approval work.

Each process has an in-memory duplicate-suppression set. Cross-instance correctness continues to depend on the existing database lease/fencing, intent creation CAS, and verification/publication lease. If the process is stopped while Google is handling a request, PostgreSQL fencing prevents stale database writes but cannot cancel or fence a request already accepted by Google. Ambiguous initiation or file outcomes remain reconciliation-required and are not blindly retried.

The polling loop is tied to the API process lifetime. Durable state allows another running instance to resume after restart, but it does not guarantee scheduling during downtime or on infrastructure that suspends all backend processes. Production needs a separately approved always-on worker or scheduler arrangement before enabling this pipeline there.
