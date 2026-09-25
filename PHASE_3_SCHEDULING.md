# Phase 3: recurring meetings

Implemented recurring creation with daily, weekly, monthly, weekdays, and custom interval/weekday options. Ending rules are never, inclusive local date, or count (1-1000). Intervals are 1-365. The first date must match the selected weekdays and must be an unambiguous valid local time. Later nonexistent local times and missing monthly dates are skipped without consuming the count; duplicated clock times use the first instant. Weeks start Monday. No recurrence editing/cancellation, calendars, emails, reminders, or automatic meeting starts were added.

The existing meetings record remains the series identity: scheduled_at is its first occurrence, time_zone retains the IANA zone, and recurrence_rule holds the validated calendar rule. ID, code and URL never change for occurrences. The host can view upcoming dates and explicitly start an occurrence. The generic Start next occurrence action selects the first unfinished occurrence from today in the meeting timezone. Occurrences are materialized in bounded pages when requested, not by a background worker. Past unstarted occurrences are retained; the default upcoming page excludes prior local dates. Exhausted series retain their parent/history but cannot manufacture new sessions.

The existing reusable-session lifecycle is extended to recurring meetings. Each occurrence has separate admission, attendance, recording association and session room scope. Ending an occurrence is terminal for that child and returns its parent to scheduled. Another occurrence can then start. Concurrent starts are serialized on the parent; stale session actions retain their existing protections. One-time, reusable and legacy behavior remains covered by regression tests.

## Migration and deployment

Created backend/drizzle/0007_recurring_meetings.sql and appended its journal entry. Not applied to any database. No real .env files, packages, or existing data were changed.

Changes: add recurring enum value; add nullable meetings.recurrence_rule JSONB; add nullable child scheduled_at and original_scheduled_at; permit null child start_request_id and started_at for occurrences which have not started; add unique index on parent + original scheduled time. Existing defaults and stored rows remain unchanged. The original timestamp gives a stable identity for future exception/reminder mapping; actual start/end remain separate. A future calendar integration can map the parent anchor + IANA timezone + rule to DTSTART/TZID/RRULE and include the existing YLAAM link.

Before deploying the code to Supabase, verify the migration ledger and actual schema include prior migrations, especially 0005 and 0006, then apply 0007 through the project's migration process. Do not blindly run all pending migrations: the working tree already includes unrelated 0004_email_auth work. Do not reapply SQL already applied manually without reconciling the migration ledger. This phase's handwritten migration deliberately avoids generating a diff from stale snapshots (only 0000/0001 snapshots exist). No manual data edits/backfills are needed.

## Files changed in Phase 3

- backend/drizzle/meta/_journal.json
- backend/src/db/schema.ts
- backend/src/services/meeting-schedule.service.ts
- backend/src/services/meeting-occurrence.service.ts
- backend/src/services/meeting.service.ts
- backend/src/services/chat-attachment.service.ts
- backend/src/services/recording.service.ts
- backend/src/realtime/whiteboard.ts
- backend/src/routers/meetings.ts
- backend/tests/meeting-occurrences.test.ts
- frontend/src/App.tsx
- frontend/src/components/ScheduleModal.tsx
- frontend/src/components/ScheduledMeetingsView.tsx
- frontend/src/components/FavoritesView.tsx
- frontend/src/components/JoinModal.tsx
- frontend/src/components/meeting/MeetingRoom.tsx
- frontend/src/lib/meetingSchedule.ts

## Files created in Phase 3

- backend/drizzle/0007_recurring_meetings.sql
- backend/src/services/recurrence.service.ts
- backend/tests/recurrence.test.ts
- frontend/src/components/RecurrenceControls.tsx
- frontend/src/components/RecurringOccurrences.tsx
- frontend/src/lib/startHostedMeeting.ts
- PHASE_3_SCHEDULING.md

Some changed files were already untracked or modified by earlier phases. Unrelated existing working-tree changes were preserved.

## Validation

- Backend npm run typecheck: passed.
- Frontend npm run lint (TypeScript check): passed.
- Backend and frontend npm run build: passed.
- node --import tsx --test tests/meeting-occurrences.test.ts tests/meeting-scheduling.test.ts tests/recurrence.test.ts tests/auth.test.ts: 44 passed.
- Tests cover timezone conversion, DST gaps/overlaps, month-end skipping, weekly/custom rules, inclusive endings/count exhaustion, stable parent and child identity, host authorization, duplicate starts, fresh admission, stale tokens, and previous phases.

Remaining validation: no live PostgreSQL migration or browser/conferencing end-to-end test was run. Persistence tests use a serialized SQL-predicate-aware database double, not a real PostgreSQL instance. The frontend build retains its existing bundle-size warning. Calendar synchronization, reminders, and recurring edit/cancel operations remain later phases.
