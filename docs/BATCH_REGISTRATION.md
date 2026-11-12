# Batch registration and Google identity foundation

Migration 0024 extends the existing enrollment model. Existing rows are manual
enrollments and retain their approval behavior. Public rows are pending with an
independent email verification timestamp; managers cannot approve public rows
until verification succeeds. Neither approval nor verification grants Drive access.
Verification never changes approval/removal, links an application account, or
changes a manually supplied student name. Public audit events have no manager actor.

Managers use the existing Students panel. Links expire in 1–30 days (default 7).
The raw 256-bit token is returned once; only its hash is stored. Copy and share it
manually. Regeneration/disablement invalidates the previous registration link and
outstanding verification tokens issued through it, without modifying enrollments.
The public page exposes only the batch display name. Verification requires an
explicit POST initiated by a button, not a GET or automatic email-link visit.
Tokens are URL fragments and removed from browser history after opening. Reopen
the original link after refresh. Do not log request bodies or raw tokens.

Email delivery reuses the existing Resend sender. APP_PUBLIC_URL must be a trusted
HTTPS application URL (HTTP loopback is allowed for tests). RESEND_API_KEY and a
verified EMAIL_FROM sender require separate deployment verification. No settings
are changed here. Provider failure and duplicate registrations receive the same
generic receipt. Email delivery is not guaranteed; retrying registration sends a
new 15-minute single-use token subject to limits. Tokens are consumed atomically
with the verification timestamp and audit event. No real mail is sent in tests.

PostgreSQL enforces multi-instance request limits: 10 submissions/10 minutes per
socket address, 20 verification attempts/10 minutes, 60 identification requests/
minute, 3 email requests/hour per normalized recipient, and 100 emails/hour per
link. Recipient/link throttling returns the generic receipt. Keys are HMACs, not
raw IPs/emails. Forwarded IP headers are deliberately not trusted: a proxy can
cause users to share a conservative limit. Trusted proxy/edge abuse protection
needs deployment review. Link, verification, and limiter records need an approved
retention policy; no automatic cleanup is added. Enrollment audit data retains
the existing batch-deletion cascade behavior.

Google identity linking is NOT implemented: password/email login does not establish
a Google subject. A separate account-keyed table and authenticated status abstraction
remain unverified; the database currently rejects non-null verified claims. No
student Google tokens or Drive scopes are requested. Future account-linked OIDC
needs its own client/redirect setup, state/PKCE/nonce and session binding, issuer,
audience, signature and email_verified validation, a unique Google subject mapping,
and an explicit authenticated enrollment claim policy. That requires separate
review and an additive migration before verified identities can be recorded.

Before Phase 6C: approve migration rollout, validate email delivery with approved
resources, implement trustworthy account/Google linking, and define membership
revocation and ACL reconciliation. Company Drive OAuth and publication are unchanged.
