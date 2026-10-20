# YLAAM Meet functional audit

This is a coverage checklist, not a claim that every individual control has been tested. A row groups a flow or family of controls; the total number of distinct controls is not yet established. PASS applies only to the described scenario and test mode. Backend unit tests use doubles unless stated otherwise. Local integration uses a dedicated local PostgreSQL database; media and external services are blocked or simulated.

| # | Feature / control and expected behavior | Actual frontend / backend evidence | Result and mode |
|---|---|---|---|
| 1 | Desktop dashboard navigation opens account sections | Sections render; API responses simulated | PASS, mocked browser |
| 2 | Mobile dashboard navigation opens sections | Tested at mobile viewport; responses simulated | PASS, mocked browser |
| 3 | Signed-out dashboard protects account content | Private views gated in browser; backend not exercised | PASS, mocked browser |
| 4 | Empty, slow and failed account data show appropriate states | Empty states and account failure/retry scenarios exercised; API simulated | PASS, mocked browser |
| 5 | Favorite and hide controls persist and enforce ownership | Not fully exercised against local database | NOT TESTED |
| 6 | Create reusable meeting, show correct link and enter room | Correct create input in mock; two-browser local test created one reusable DB record and entered room | PASS, local DB and mocked browser |
| 7 | Rapid create submissions produce one meeting | Mock records one request; real concurrent DB behavior not verified here | PASS, mocked browser |
| 8 | Duplicate code, retry, form close and keyboard submission | Error, new code, retry and reset checked; backend simulated | PASS, mocked browser |
| 9 | Copy meeting link puts correct link on clipboard | Clipboard contents not verified | NOT TESTED |
| 10 | Schedule repeating weekdays | Selected weekdays sent to simulated create API; no real persistence checked | PASS, mocked browser |
| 11 | One-time schedule and validation | Full form and local database persistence not verified | NOT TESTED |
| 12 | Start and manage recurring occurrences | Original reported error not reproduced or ruled out; local/production behavior not verified | NOT TESTED |
| 13 | Invitations and reminder controls | Host panel, mocked invitation and reminder calls exercised; actual delivery not tested | PASS, mocked browser |
| 14 | Notification preferences token link and reminder delivery | Real email is prohibited; token route integration not verified | BLOCKED, external email |
| 15 | Invalid, unknown, ended and malformed meeting links | Corresponding UI errors and fallback checked; API simulated | PASS, mocked browser |
| 16 | Guest joins and waits for host | Two independent browsers hit local backend and database, guest waits | PASS, local DB; media blocked |
| 17 | Host sees request and admits without guest refresh | Dialog appeared and admission recorded; local working tree includes pre-existing uncommitted room changes | PASS, local DB; media blocked |
| 18 | Denial and transient admission failures | Mock tests cover denial, failure warning and stalled polling recovery; real network failure not tested | PASS, mocked browser |
| 19 | Host-only admission and meeting management reject unauthorized people | Some backend authorization unit tests use doubles; adversarial two-browser DB integration not established | NOT TESTED, end-to-end |
| 20 | Real participant audio/video and reconnection | LiveKit connection intentionally blocked; UI admission is not proof of media | BLOCKED, real LiveKit |
| 21 | Microphone, camera, screen share and remote participants | Individual controls and remote media not validated against LiveKit or real hardware | BLOCKED, real LiveKit/hardware |
| 22 | Chat, attachments, polls and host participant controls | Full multi-user behavior and storage integration not verified | NOT TESTED |
| 23 | Leave and end for host and guest | Full local role and DB effects not tested | NOT TESTED |
| 24 | Meeting history and details, errors and mobile | Browser checks detail and retry with simulated history responses | PASS, mocked browser |
| 25 | Recording start, pause, playback and seek | Synthetic in-memory media exercised in isolated harness; real meeting/storage integration not verified | PASS, synthetic harness |
| 26 | Recording permission, upload, download and Google Drive | No real recordings or external storage actions performed; end-to-end permissions not established | BLOCKED, external integration |
| 27 | AI off on entry; no automatic capture | Disabled-state browser test checked no capture/upload; host control has separate backend unit coverage | PASS, mocked browser and backend doubles |
| 28 | Each participant agrees or declines transcription | Current active backend service permits host activation without participant decisions; old privacy test also expects different text | FAIL, code inspection and failing existing test |
| 29 | Privacy page and home navigation | Navigation, viewport, keyboard and disclosure tests passed; one existing content assertion failed | FAIL, mocked browser |
| 30 | Save and apply device settings | UI reports success, component state resets; fixed device names and simulated microphone meter in source | FAIL, browser regression and code inspection |
| 31 | Terms and Security footer links | Both clicks are prevented and do not navigate | FAIL, browser regression and code inspection |
| 32 | Profile updates and remaining account controls | No complete profile/save end-to-end verification | NOT TESTED |
| 33 | Duplicate requests, response times, console errors and memory across all flows | No comprehensive load, timing, memory or console audit performed; polling intervals identified in code | NOT TESTED |

Important API mappings: dashboard uses `auth.me`, `meetings.list`, and `meetings.setPreference`; creation/scheduling uses `meetings.create`, `reschedule`, `occurrences`, and `start`; guest admission uses `getByCode`, `join`, `admissionStatus`, `pendingAdmissions`, and `decideAdmission`; room membership and media use `participants`, `rejoin`, `leave`, `end`, and `livekitToken`; history uses `history` and `historyDetail`; invitations use `meetingNotifications` procedures; recording uses `recordings` procedures; transcription uses `aiStatus`, `requestAiTranscription`, `stopAiTranscription`, `aiCaptureHeartbeat`, `transcribeSpeech`, `generateSummary`, and `shareTranscript`. Mapping is source inspection, not proof each call works end-to-end.

No production database was written, no real email or paid AI action was initiated, and no real recording was created during this audit. Local meeting records created for testing remain in the isolated local database.
