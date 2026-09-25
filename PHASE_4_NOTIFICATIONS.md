# Phase 4: calendar, invitations and reminders

Implemented the optional, account-free calendar path discussed during this phase. Google OAuth and connected calendar synchronization are not implemented. Calendar copies explicitly do not synchronize subsequent changes. No Phase 5 occurrence editing/cancellation was added.

## User behavior

In Scheduled Meetings, the host can open **Calendar, invitations & reminders**:

- Open a Google Calendar draft for the one-time meeting or entire recurring series. The draft retains the local wall-clock time, IANA timezone, recurrence interval/weekdays/count/until, and the existing YLAAM Meet URL in location and description. No Google API call, Google token, or Google Meet conference creation is requested. The user reviews/saves the draft in Google Calendar.
- Download an `.ics` event. For recurring meetings this is explicitly the next calendar occurrence only, exported as an exact UTC instant. It is not an indefinitely recurring ICS feed. One-time exports keep their UID when rescheduled. No duration is invented where YLAAM has none.
- Send invitations to up to 20 addresses per action, 100 per meeting. Hosts must verify their email first. Recipients are normalized and deduplicated. Existing addresses are not repeatedly emailed by double-clicks/repeated submissions. Delivery status can be refreshed.
- Opt into the host's own email reminders. Invitees can opt in/out using a signed preference link in their invitation. Reminders are off for invitees until they choose to enable them. A preference link can manage that one invitation, view its meeting/calendar link, and never grants admission, login or host permissions. Tokens use a separate HMAC purpose; rotating JWT_SECRET invalidates old links.

Invitations are independent of meeting_participants. All joining still uses the current authentication, waiting room and host admission flow. No changes were made to LiveKit, recording, media or authentication flows in this phase.

## Scheduling and reliability

The worker is a separate process, not part of the meeting server. It never starts meetings. It discovers opted-in scheduled meetings, lazily materializes a bounded two-occurrence window for recurring series, and queues reminders during the ten minutes before the occurrence. Reusable/no-fixed-time and instant rooms never generate scheduled reminders.

Reminder identity includes invitation ID, occurrence ID (for recurring meetings), and the exact scheduled instant. The existing meetings record remains the source of truth. Rescheduling invalidates the old reminder; the new time gets a new delivery identity without changing the meeting ID/code/link. Recurring reminders reference meeting_occurrences rather than whichever session happens to be active.

Before sending, the worker locks the parent, preference and delivery rows, and checks the current schedule/status/preference again. Started, ended, expired, unsubscribed or stale reminders are skipped. Re-enabling before the scheduled start can reactivate a skipped, unsent reminder. Sent reminders are never requeued. Reminders missed while the worker is offline are sent only if the meeting is still in its pre-start window, never after its scheduled start. The worker polls after each pass with a 30-second pause, so timing is approximate and depends on queue/provider availability.

The exact email payload is committed before the first provider call. Retries reuse that payload and a stable Resend idempotency key. Claims delay eligibility for one minute; row locks and attempt numbers suppress parallel or stale claims. The sender has a 15-second timeout. Retry lifetime stays below 23 hours, with at most ten attempts. Invitations expire 23 hours after enqueue; reminders expire at their occurrence start. Failures do not modify meeting or admission state. No guarantee of recipient inbox delivery is made: sent means the provider accepted the request. Expired/failed invitations are shown in status; automated resend of those invitations is intentionally unavailable to avoid ambiguous duplicate sends.

Resend documents a 24-hour idempotency-key retention window: https://resend.com/changelog/idempotency-keys . Google Calendar's recurrence model uses named timezones and recurrence rules: https://developers.google.com/workspace/calendar/api/v3/reference/events . The account-free draft URL remains a user-reviewed browser integration, not a connected Calendar API integration.

## Additive migration

Created `backend/drizzle/0008_meeting_notifications.sql`; appended journal entry 8. Not applied to Supabase or any live database.

- `meeting_invitations`: parent meeting ID, normalized email, reminder preference, creation timestamp; unique parent/email.
- `meeting_deliveries`: invitation/parent/optional occurrence references, unique delivery key, kind, scheduled/due/expiry timestamps, status, attempt count, first attempt, frozen payload and sent timestamp; pending/due index.

No new scheduled-meeting parent table, old-data rewrite, participant backfill, or modifications to real `.env` files. No packages installed. Existing uncommitted work and prior migrations are preserved. The migration was hand-scoped because generated snapshots still lag the existing handwritten migrations; it does not include auth/email schema changes from 0004.

## Manual deployment steps

1. Review the Supabase schema and Drizzle migration ledger. Confirm previous migrations through 0007 are already applied/recorded before applying 0008 using the project's normal migration process. Do not blindly replay migrations, particularly the existing unrelated 0004_email_auth migration. No manual data edits are needed.
2. Configure `APP_PUBLIC_URL` with the deployed frontend origin; keep the existing `RESEND_API_KEY` and verified `EMAIL_FROM`. Optional `MEETING_EMAIL_FROM` overrides the sender only for meeting notifications. Examples are in backend/.env.example; no real environment files were edited. Keep these server-side. A production Resend sender/domain must be configured to send to actual invitees.
3. Deploy frontend/backend and route `/meeting-notifications` to the frontend SPA, as for other client routes.
4. Run the separate worker after migration/configuration: `npm run notifications:worker` in backend for development, or `node dist/meeting-notification-worker.js` under a production process supervisor after build. Alternatively, schedule `npm run notifications:once` (or the compiled worker with `--once`) every minute. Do not run both modes unnecessarily. Starting the worker WILL process queued email; it was not started against real data during this implementation.
5. Verify one test invitation and an opted-in one-time/recurring reminder in your deployment. Check the actual email inbox and optional calendar draft/import. Ensure rescheduling and disabling reminders suppress the old delivery. Google OAuth credentials are not required for this implementation.

## Files changed in Phase 4

- backend/.env.example
- backend/package.json
- backend/drizzle/meta/_journal.json
- backend/src/db/schema.ts
- backend/src/env.ts
- backend/src/trpc/router.ts
- frontend/src/main.tsx
- frontend/src/components/ScheduledMeetingsView.tsx

## Files created in Phase 4

- backend/drizzle/0008_meeting_notifications.sql
- backend/src/services/meeting-calendar.service.ts
- backend/src/services/meeting-notification.service.ts
- backend/src/services/meeting-reminder.service.ts
- backend/src/routers/meeting-notifications.ts
- backend/src/meeting-notification-worker.ts
- backend/tests/meeting-notifications.test.ts
- frontend/src/components/MeetingCalendarLinks.tsx
- frontend/src/components/MeetingNotifications.tsx
- frontend/src/components/MeetingNotificationPreferences.tsx
- PHASE_4_NOTIFICATIONS.md

## Verification and limits

Backend typecheck, frontend lint (TypeScript), and backend/frontend production builds pass. The frontend retains its existing large-bundle warning.

Regression command: `node --import tsx --test tests/meeting-notifications.test.ts tests/meeting-occurrences.test.ts tests/meeting-scheduling.test.ts tests/recurrence.test.ts tests/auth.test.ts`.

59 tests pass, including 15 new tests covering Google draft/ICS content, timezone/endings, stable UID, HTML/calendar escaping, preference capability validation, host ownership and verification, invitation deduplication, one-time and recurring reminders, no-fixed-time exclusions, stable parent identity, rescheduling, opt-out/re-enable, expiry, duplicate claims, provider retries and frozen payload/idempotency keys. Email calls and persistence are mocked; the persistence double evaluates SQL predicates and serializes transactions but does not replace a real PostgreSQL concurrency test.

No real messages were sent, migration applied, Google event created, or production worker launched. Live database/browser/provider checks remain deployment validation. Connected Google Calendar OAuth/synchronization, full recurring ICS subscription/export, and Phase 5 recurring editing/cancellation remain unimplemented.
