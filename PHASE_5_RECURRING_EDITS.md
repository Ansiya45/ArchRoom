# Phase 5: recurring occurrence editing and cancellation

Implemented host-only operations for recurring meetings:

- **Edit this occurrence:** change its date, time and IANA timezone. Keep the same occurrence ID, original scheduled instant, parent meeting ID/code/URL, and all other occurrences.
- **Edit this and future:** select an unstarted future occurrence in the latest revision and supply the new first date/time/timezone and recurrence rule. Archive the earlier rule with an exclusive cutoff at the selected original occurrence. Replace that original occurrence and later entries in that revision, including later custom edits/cancellations. Earlier materialized and unmaterialized dates continue using their archived rule. The new count limit counts from the new first occurrence. The parent meeting ID/code/link remain unchanged.
- **Cancel this occurrence:** retain a cancellation marker on its child record. It cannot start, receive a scheduled reminder, or be regenerated. Other occurrences remain available.
- **Cancel recurring series:** terminally mark the parent series cancelled and mark remaining unstarted children cancelled. Preserve completed children, participant/recording history and the meeting link. No later occurrence can be generated or started. Cancellation can be safely retried; no restoration/undo operation was added.

Controls are in **Occurrences & series settings** on scheduled/favorite meeting cards. Edits and cancellations have explicit scope and confirmation text. A date filter and timestamp/ID cursor allow browsing moved occurrences, including multiple on the same day without skipping them.

## Safety and scheduling semantics

All changes verify the authenticated host and execute under the same parent row lock used by occurrence start/end. An expected parent updated_at value rejects stale forms and competing edits. A non-host or a child belonging to another meeting cannot be edited. Individual edits/cancellations are limited to future, scheduled, unstarted, uncancelled occurrences.

End the live occurrence before editing the future series or cancelling the series. A future-edit range containing a started/completed child is rejected. Earlier retained revisions can be edited individually, but a further future split must originate in the latest revision. The new first occurrence cannot precede the selected original civil day in the existing series timezone; earlier clock times on that same day are allowed. Up to 100 future schedule revisions are retained per parent. These limits avoid rewriting completed history or applying an ambiguous range edit.

Cancellation is recorded separately from the existing scheduled/live/ended session status, preserving legacy, one-time and reusable lifecycle behavior. Revision zero represents all existing schedules; no legacy meeting is reclassified. Existing child timezone values which were not stored are interpreted from their archived revision timezone, with no timestamp rewrite.

## Reminders and calendar integration

The worker materializes a bounded upcoming window and checks persisted child times, so an occurrence moved far away from its original date still gets the correct reminder. Reminder identity remains child ID plus scheduled instant. The final send check rejects cancelled/superseded children and cancelled parents. Old-date reminders are skipped and new-date reminders use the same child with a new delivery key. Earlier children keep their original revision timezone even after a series timezone change.

A cancelled series exposes no new calendar export and cannot receive new invitations or enable reminders. Recipient preference pages show the cancelled-series state. Already-sent emails and calendar copies cannot be recalled or synchronized by the account-free Phase 4 integration; the host is explicitly told to notify invitees.

For a series with edits/cancellations, calendar links/export now represent only the next available occurrence, using its actual date/time/timezone and stable child UID. They do not publish a misleading unchanged RRULE. The UI explains this limitation. Untouched series retain the Phase 4 Google Calendar series draft. Connected Google OAuth synchronization, automatic change/cancellation emails, recurrence exception ICS feeds and cancellation undo remain outside this implementation.

## Migration

Created **backend/drizzle/0009_recurring_edits.sql**, journal entry 9. Not applied to Supabase or any live database.

- meetings: recurrence_revision (integer, default 0), recurrence_history (JSONB, default empty array), recurrence_cancelled_at and recurrence_edited_at (nullable timestamptz).
- meeting_occurrences: recurrence_revision (integer, default 0), time_zone (nullable), cancelled_at (nullable timestamptz), cancellation_reason (nullable).
- Replace the original parent/original-start unique index with parent/revision/original-start uniqueness. This permits a new revision to reuse a scheduled instant while preserving the old child record and foreign-key history. No row or table is deleted. The existing one-live-occurrence and start-request uniqueness indexes remain.

The migration is scoped to Phase 5. Existing handwritten migrations and the stale generated snapshot state (0000/0001 only) were inspected; no full-schema generation or unrelated auth/email changes were included.

Before deployment, verify the real Supabase schema and migration ledger have all prior migrations through 0008 applied/recorded. Apply 0009 through the normal migration process before deploying the new backend and notification worker. Use a coordinated deployment/maintenance window so old backend/worker versions do not ignore the new cancellation fields. Do not replay already-applied SQL or reset data. No manual data edits, new credentials, real .env changes, or package installation are needed.

## Files changed in Phase 5

- backend/drizzle/meta/_journal.json
- backend/src/db/schema.ts
- backend/src/routers/meetings.ts
- backend/src/services/meeting-occurrence.service.ts
- backend/src/services/meeting-calendar.service.ts
- backend/src/services/meeting-notification.service.ts
- backend/src/services/meeting-reminder.service.ts
- backend/tests/meeting-occurrences.test.ts
- backend/tests/meeting-notifications.test.ts
- frontend/src/App.tsx
- frontend/src/components/ScheduledMeetingsView.tsx
- frontend/src/components/FavoritesView.tsx
- frontend/src/components/RecurringOccurrences.tsx
- frontend/src/components/MeetingCalendarLinks.tsx
- frontend/src/components/MeetingNotifications.tsx
- frontend/src/components/MeetingNotificationPreferences.tsx
- frontend/src/lib/meetingSchedule.ts
- frontend/src/lib/startHostedMeeting.ts

## Files created in Phase 5

- backend/drizzle/0009_recurring_edits.sql
- backend/src/services/recurrence-series.service.ts
- PHASE_5_RECURRING_EDITS.md

Existing unrelated working-tree changes were preserved. No LiveKit, authentication, media, chat, whiteboard, participant admission, recordings, or real environment files were changed in this phase.

## Checks

- Backend TypeScript check: passed.
- Frontend lint (TypeScript check): passed.
- Backend and frontend production builds: passed. Existing frontend bundle-size warning remains.
- Full scheduling/auth regression suite: 74 tests passed, including 15 new Phase 5 tests.
- Command: `node --import tsx --test tests/meeting-occurrences.test.ts tests/meeting-notifications.test.ts tests/meeting-scheduling.test.ts tests/recurrence.test.ts tests/auth.test.ts`.

Coverage includes stable occurrence/parent identities, moved-date discovery, timezone preservation, cancellation persistence, terminal series cancellation, future splits preserving completed and unmaterialized history, same-instant revision replacement, stale/concurrent writes, host/anonymous authorization, same-day pagination, reminders after moves, cancellation/supersession suppression, and calendar exception exports. Database tests use serialized SQL-predicate-aware mocks; they do not replace live PostgreSQL transaction/migration validation.

No migration, real email delivery, Google event creation, browser end-to-end test, or live conferencing test was performed. Validate those deployment paths after migration, especially a two-tab edit/start conflict and worker behavior after cancellation. Existing external calendar copies require manual updates.
