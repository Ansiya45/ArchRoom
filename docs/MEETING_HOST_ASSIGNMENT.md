# Persistent session host assignment

The creator remains `meetings.host_user_id`. The nullable
`meetings.assigned_host_user_id` identifies one additional signed-in, verified,
enabled workspace user who may open and lead this meeting's sessions. The
assignment remains across recurring/reusable sessions. It does not grant a
company role, folder permission, recording consent, or recording feature access.

Only a super admin who owns the meeting can create/change the assignment.
Changes are rejected during a live session. Setting it to null revokes future
host access; active participant roles are reconciled in the same transaction.
Existing session-only host promotion continues separately.

The scheduling form provides **Session host**. The owner can reopen **Session
host settings** and use **Save host assignment** before a session starts.
Share the existing meeting link; no invitation email is sent by this action.

## Migration safety

`drizzle/convergence/meeting-host-assignment-v1.sql` is a forward extension,
tracked separately by `drizzle.meeting_host_assignment_runs`. No historical
SQL, journal timestamps, or historical ledger entries are rewritten.

The normal disposable migration runner applies this extension after verified
convergence. Startup requires it. The coordinator validates both authentic
convergence evidence and the extension's pinned artifact/schema/security
fingerprints. Unknown targets, drift, missing/changed evidence and production
remain blocked. The extension runs atomically under the coordinator advisory
lock and validates foreign keys before and after changes.

The extension was exercised on new fresh/feature-derived and senior-derived
disposable PostgreSQL databases, including interruption rollback, safe retry,
repeat execution, assignment authorization, admission, owner preservation,
revocation and schema drift. Production remains blocked pending deployment
lineage review and explicit migration approval.
