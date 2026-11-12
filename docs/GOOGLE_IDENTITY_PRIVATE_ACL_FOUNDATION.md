# Phase 6B.4 / 6C: incomplete, inactive foundation

The new helpers do not link accounts, mutate Drive permissions, or enforce a new
publication policy. Existing runtime behavior is unchanged. No migration is added.

`google-identity-proof.ts` generates state, nonce and S256 PKCE material and validates
RS256 Google ID-token signatures against caller-supplied trusted signing keys. It
validates issuer, audience, authorized party, time claims, nonce, subject and verified
email. Its ten-minute issue-time window is intentionally conservative. It returns
identity claims, not access/refresh tokens. It is NOT replay protection by itself.

Before using it, implement a separate student OIDC client configuration, pinned
Google discovery/JWKS retrieval, an authenticated account/session-bound attempt
record, expiring one-use state consumption, callback binding, and transactional
subject uniqueness. Never use token-supplied key URLs or the company Drive client.
Verified registration email alone is insufficient: enrollment-to-account ownership
is not currently established. Account linking, unlink/relink audit and downstream
revocation reconciliation remain unimplemented. No identity is marked verified.

`private-recording-policy.ts` is a pure compiler for a trusted server-side snapshot.
It requires verified identities for creator, durable recording host and authorized
batch managers, and rejects temporary-host elevation and ambiguous identities.
Restricted and link modes are unsupported. READY_FOR_ACL means intended recipients
are resolved, NOT that sharing is verified. Inputs are not an authentication boundary.

Before integrating this compiler, implement durable account/enrollment bindings,
transactional authorization and a versioned per-recording ACL operation ledger.
Serialize mutations and audit permission IDs; reconcile uncertain provider outcomes
before retrying. Preserve the existing strict destination gate. Independently verify
each intended reader and the complete effective ACL, including inherited access,
alongside existing file identity/checksum checks. Publication must require a matching
verified policy version and current identities/credentials. Unsupported policies
must be blocked in that publication path. None of this integration is implemented
by these helpers; existing company-owner-only verification is not host-reader ACL
enforcement. Do not enable uploads on the strength of these foundation tests.

Real-provider configuration and verification, disposable PostgreSQL tests for the
future persistence/locking implementation, and mocked full-flow ACL integration tests
are still required. No Google scopes, permissions, flags, environment settings,
existing migrations, recording data or frontend controls are changed here.
