Meeting summaries
=================

The host's browser captures microphone audio available to it (the host and remote attendees), without changing or stopping LiveKit's source tracks. It sends short audio clips to the authenticated backend, which uses OpenAI transcription with automatic language detection. The Responses API produces a concise English summary of the discussion, decisions and explicitly stated actions. Chat is not input to this summary.

Clicking Leave or End as the host flushes the last clip, waits for outstanding transcription, performs the existing leave/end operation, and opens the summary screen. Leaving still only leaves; ending still ends the meeting. Download creates a summary-only UTF-8 text file. Send sends only to checked attendees' account email addresses; no emails are sent automatically. Recurring/reusable attendee lookup uses the captured occurrence ID even after the session ends. Pending/denied attendees and other occurrences are excluded. Old unclassified meetings have no occurrence identity, so their recipient history remains associated with the parent meeting.

Configuration (manual)
----------------------
1. Create an OpenAI API key in your OpenAI project with API billing and access to the configured models. Add it only to the backend environment as OPENAI_API_KEY. Never put it in frontend/VITE variables or commit it.
2. Optional backend overrides: OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe and OPENAI_SUMMARY_MODEL=gpt-4.1-mini (these are the defaults).
3. Keep the existing RESEND_API_KEY if it is valid and has sending permission for your sender domain. Set TRANSCRIPT_EMAIL_FROM to an address on your Resend-verified domain, e.g. YLAAM Meet <summaries@your-verified-domain>. This is an example, not a working sender address. Complete the DNS verification instructions shown by Resend. EMAIL_FROM continues to serve authentication emails independently.
4. Restart the backend after environment changes and rebuild/deploy the updated frontend/backend together. No new package, migration, worker or database change is needed.

Official references:
- https://developers.openai.com/api/docs/guides/speech-to-text
- https://developers.openai.com/api/docs/guides/text
- https://resend.com/docs/dashboard/domains/introduction
- https://resend.com/docs/dashboard/emails/idempotency-keys

Validation and limits
---------------------
- Validation: all 90 backend/regression/capture tests passed. Backend and frontend production builds passed (frontend retains the existing >500 kB chunk warning). Type checks passed. Tests mock OpenAI, Resend, database queries, and browser audio APIs. No live AI requests or emails were sent during implementation.
- Local configuration inspection found OPENAI_API_KEY missing/empty. RESEND_API_KEY and TRANSCRIPT_EMAIL_FROM are present but were not validated with a live request.
- Live acceptance test: host and another account speak in English and another supported language, state an explicit decision/action, then host clicks Leave. Check the English summary, download it, select only one attendee, send and verify that mailbox and Resend delivery log. Repeat with End, muted host/remote speaker, a recurring session, and a deliberately unavailable API. Check browser capture warnings.
- Audio must be received by the host while this page is open. Earlier speech, speech after host departure, a browser refresh/tab close/crash, and disconnected audio cannot be recovered. Summaries are in memory, not stored in the database; download/send before closing the summary screen.
- Audio quality, overlapping speakers, unsupported languages, and occasional split sentences affect recognition. The AI is instructed not to invent facts; the host should review the result before sharing. Browser suspension or provider failures are reported as incomplete-capture warnings and included in exports/email.
- Audio buffers and input length are bounded; overload/length limits produce an incomplete warning. Clips are normally 15-25 seconds and processed concurrently in capture order. Raw audio is not persisted by this application. OpenAI's own API data policies still apply; store:false on summary responses is not a claim of zero provider retention.
- Resend acceptance is not a guarantee of inbox delivery. Partial failures retain failed recipients for retry; stable idempotency keys prevent duplicate accepted emails within Resend's 24-hour window. No durable delivery ledger was introduced for these manually sent summaries.

Files changed for this task
---------------------------
Existing: backend/.env.example; backend/src/env.ts; backend/src/routers/meetings.ts; backend/src/services/meeting.service.ts (removed the old full-transcript sender); backend/tests/meeting-occurrences.test.ts; frontend/src/components/meeting/MeetingRoom.tsx; frontend/src/components/meeting/TranscriptModal.tsx.
New: backend/src/services/meeting-summary.service.ts; backend/tests/meeting-summary.test.ts; backend/tests/meeting-summary-capture.test.ts; frontend/src/hooks/useMeetingSummaryCapture.ts; frontend/src/lib/meetingSummaryCapture.ts; MEETING_SUMMARIES.md.

The workspace also contains pre-existing scheduling/auth/media edits. They were not reverted. Real .env files were not modified.
