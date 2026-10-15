import { useEffect } from 'react';
import { Link } from 'react-router-dom';

const sections: Array<[string, string[]]> = [
  [
    "About this policy",
    [
      "YLAAM Meet is a video conferencing platform owned and operated by Archon Solutions. This Privacy Policy explains how we collect, use, store, share, and protect personal information when you access or use our services.",
      "This policy covers YLAAM Meet at https://meet.ylaam.com, including account registration, meetings, collaboration, recordings, and supported integrations."
    ]
  ],
  [
    "Information we collect and process",
    [
      "We process your name, email address, account identifier, password hash, verification status, and authentication information. Meeting information includes titles, meeting codes, schedules, time zones, host details, invitations, participant names and identifiers, admission status, and participation timestamps.",
      "We process content you share through enabled features, including microphone audio, camera video, shared screens, chat messages, attachments, whiteboards, and recordings. Technical connection and error information is also processed to deliver and troubleshoot the service.",
      "Hosts may provide invitees' email addresses, and participants may include information about others in shared content. Connecting Google Drive also involves Google account and selected-folder information."
    ]
  ],
  [
    "Account registration and authentication",
    [
      "We use your name and email address to register and identify your account. Verification and password-reset messages are sent through our email provider.",
      "Passwords are stored as hashes rather than plaintext. Verification and password-reset codes are time-limited, and their stored records contain hashes. We use session credentials to authenticate requests and maintain sign-in.",
      "Signing out clears the current browser's account session information and attempts to revoke its server session. Password changes invalidate existing persistent login sessions. Signing out does not delete your account or meeting records."
    ]
  ],
  [
    "Meeting participation",
    [
      "Creating and managing a meeting requires a registered account. A person with a shared meeting link may request to join as a guest without creating an account by providing a display name. We process meeting and attendance information to schedule meetings, manage host admission, connect participants, and maintain meeting records.",
      "Your display name, participation, and shared content may be visible to hosts and other participants. The meeting creator can give an admitted participant co-host controls for the current meeting session; the creator remains a host. Hosts manage admission and meeting controls. Supported summary distribution allows hosts to access registered attendee names and email addresses. An invitation does not itself grant admission."
    ]
  ],
  [
    "Microphone, camera, and screen sharing",
    [
      "Your browser requests microphone, camera, or screen-access permission where needed. Enabled media is transmitted through LiveKit infrastructure to provide meeting communication.",
      "Screen sharing can reveal anything visible in the selected screen, window, or tab. You can stop sharing and manage device permissions through the application and your browser. Background effects use browser processing with externally downloaded software assets.",
      "We do not describe meetings as end-to-end encrypted."
    ]
  ],
  [
    "Meeting recordings",
    [
      "Hosts can initiate screen recordings through browser capture controls. Depending on the selected source and permissions, a recording can include screen content, shared audio, and microphone audio.",
      "A recording preview is initially held in the host's browser. The host can download it, upload it to private Supabase Storage, or export it to Google Drive. For Supabase uploads, we store metadata including the meeting association, filename, format, size, duration, storage location, and upload status.",
      "Saved-recording access through the application is restricted to the meeting creator and authorized co-hosts for their meeting session. Temporary download links permit access to their holders while valid. Authorized administrators and storage providers may also have access needed to operate the service.",
      "The current application does not provide a shared recording indicator or explicit recording-permission controls for every participant. The host's browser capture permission is not permission from other participants. Discuss recording arrangements with the host before sharing information you do not want recorded.",
      "Discarding a browser preview does not delete copies already uploaded or downloaded. Exported copies follow the access settings of their destinations."
    ]
  ],
  [
    "AI transcription and meeting summaries",
    [
      "AI transcription is off when you enter a meeting. A host may request it during a meeting. Each current participant is asked to agree or decline, and speech capture starts only after everyone present has agreed. A participant who joins later must also agree before capture can continue. Declining or withdrawing permission pauses capture for everyone until all current participants agree again. A host can stop transcription.",
      "When enabled, the requesting host's browser combines meeting audio and sends short audio clips through YLAAM Meet to OpenAI for transcription. Transcript text is displayed to participants during the meeting and may be used to generate an English summary through OpenAI. Mixed audio does not identify individual speakers, and a host can review, download, or email the transcript and summary to selected registered attendees after leaving the call.",
      "AI-generated text can be inaccurate or incomplete and should be reviewed before use or sharing. We do not promise that AI providers retain no data."
    ]
  ],
  [
    "Chat, attachments, and whiteboards",
    [
      "Chat messages and attachment references are delivered through LiveKit. Current chat history is held in browser memory rather than a persistent application chat archive.",
      "Uploaded attachments are stored separately in private Supabase Storage. Authorized admitted participants can obtain temporary download links.",
      "Shared whiteboard snapshots pass through our backend and are held in server memory while clients remain connected to the whiteboard room. This room state is removed when its last client disconnects. Participants may retain their own copies of shared content."
    ]
  ],
  [
    "How personal information is used",
    [
      "We use information to create and authenticate accounts, provide meetings and collaboration, enforce access controls, store or export recordings when requested, provide available summary features, diagnose failures, and respond to support and privacy requests.",
      "We also use information to send verification messages, password-reset messages, meeting invitations, optional reminders, and summaries selected for email distribution. Invitation and delivery records can include recipient addresses, message content, and delivery status."
    ]
  ],
  [
    "Third-party services and integrations",
    [
      "YLAAM Meet uses Supabase for its configured database and file storage, LiveKit for meeting communication, Resend for email delivery, and Render for frontend hosting. Google supports optional Drive authorization and recording exports. When participants enable AI transcription, OpenAI processes speech clips for transcription and transcript text for summaries.",
      "The interface requests generated avatars from DiceBear, images from Unsplash, and software/model assets from jsDelivr. DiceBear avatar requests may include participant names or identifiers. These services receive connection information when your browser contacts them.",
      "If you choose calendar export or a calendar link, meeting details are supplied to the selected calendar destination. External services process information under their applicable terms and privacy policies."
    ]
  ],
  [
    "Google Drive integration",
    [
      "Connecting Google Drive is optional. We request only https://www.googleapis.com/auth/drive.file for this integration. This grants access to files created by or explicitly opened or selected for use with the app, rather than unrestricted access to your entire Drive. The permission can allow creating, viewing, editing, and deleting those authorized files; the implemented integration uploads recordings and checks metadata, and does not implement Drive file deletion or downloading existing file contents.",
      "We obtain your Google account email address and Drive account identifier to identify the connected account. Google Picker lets you choose a folder. We read the selected folder ID, name, type, trash status, and whether you can add files. We also use generated recording file IDs, upload progress, and file size and parent-folder metadata to complete or resume an upload and check for duplicate or conflicting files.",
      "The selected recording, its filename, format, size, and destination folder are sent directly from your browser to Google. Files follow the destination folder permissions; people with access to that folder may be able to access the recording. The backend checks your host authorization using the meeting/session identifiers, but this integration does not send Google access tokens, Google account details, or Drive folder/file metadata to the YLAAM Meet backend.",
      "The integration uses Google account and Drive information only to connect the selected account, choose and validate a destination, and perform or verify the recording export. It does not send information obtained from Google Drive to OpenAI or the email provider, and does not implement sale of that information, advertising use, or AI-model training. Choosing a separate Supabase upload stores another copy of your recording independently of the Drive export.",
      "Google access tokens, account details, selected-folder information, and upload state are held in browser memory, not persisted by this integration in localStorage or the application database. They are discarded when the page is unloaded; the token also has an expiry. Closing only the destination panel does not necessarily clear them. Uploaded recordings remain in Google Drive until managed or deleted there; clearing browser state or deleting your YLAAM Meet account does not delete Drive files. Google handles its own storage and retention.",
      "There is no in-app Disconnect Google Drive button. To remove authorization, open your Google Account connections page, select the connection for this app, and remove its access. Save any unsaved recording before closing or refreshing the YLAAM Meet page to clear its in-memory connection. Closing the page does not itself revoke Google authorization. Reconnecting later may require authorization again.",
      "To delete an exported recording, manage it in Google Drive, including its trash where appropriate. Copies shared with or downloaded by others may remain. For access, correction, or deletion requests concerning information held by Archon Solutions, email noreply@archonsolution.in. Revoking authorization does not recall previously uploaded or distributed files."
    ]
  ],
  [
    "Browser storage and authentication",
    [
      "YLAAM Meet uses localStorage to retain authentication credentials, basic account information, and meeting-session details. Older meeting-session information may also be read from sessionStorage.",
      "The application's sign-in flow uses authorization tokens rather than application-issued login cookies. Connected third-party services may use their own cookies or browser storage.",
      "Clearing browser storage removes local information and may sign you out. It does not delete server records, uploaded files, or exported copies."
    ]
  ],
  [
    "Data security and access",
    [
      "The application uses password hashing, server-side authorization, meeting admission controls, private storage buckets, and time-limited file links to limit access.",
      "Hosts and participants have different permissions. Recipients can retain shared information, and downloaded, emailed, or exported copies are subject to their destinations' controls. Authorized administrative and service-provider access may be necessary to operate the service. No system can guarantee absolute security."
    ]
  ],
  [
    "Data retention and deletion",
    [
      "The application does not implement a general automatic deletion schedule for accounts, meeting records, invitations, saved recordings, or attachments. Ending a meeting does not automatically delete these records or files. AI permission decisions for a meeting session are stored with meeting records.",
      "Code expiry is different from deletion of a verification or reset-code record. Browser-held content, uploaded files, provider records, and exported copies can have different lifecycles. The current application does not provide a database transcript or summary archive; this does not guarantee absence of provider-held or recipient-held copies.",
      "Self-service account deletion is not currently available. Removing a meeting from the dashboard display does not delete its underlying records.",
      "You may request deletion by emailing noreply@archonsolution.in. Requests are reviewed according to applicable requirements, identity verification where appropriate, the affected information, other participants' interests, and technical limitations.",
      "Provider-held data and backups may require separate handling. Recordings in Google Drive, downloaded files, and recipient emails may remain under another person's control. We do not promise universal deletion of every copy."
    ]
  ],
  [
    "User privacy choices and requests",
    [
      "You can control browser media permissions, stop sharing media, sign out, manage available reminder preferences, and manage files in your own Google Drive.",
      "Depending on applicable law, you may have rights concerning access, correction, deletion, restriction, objection, or portability of your personal information.",
      "Send privacy requests to noreply@archonsolution.in. Include your account email if you have one, or your guest display name and relevant meeting details, together with a description of the request. We may need to verify your identity. Do not send passwords, verification codes, or access tokens."
    ]
  ],
  [
    "International data processing",
    [
      "Our providers may process information outside the country where you use YLAAM Meet. This policy does not promise storage exclusively within a particular country."
    ]
  ],
  [
    "Children's information",
    [
      "The current registration process does not verify age or provide a parental-consent mechanism. If you have concerns about a child's information in YLAAM Meet, contact Archon Solutions using the privacy contact below."
    ]
  ],
  [
    "Changes to this policy",
    [
      "We may update this policy to reflect changes to the service and its data practices. Please review this page for the current policy."
    ]
  ],
  [
    "Contact information",
    [
      "YLAAM Meet is owned and operated by Archon Solutions. For privacy questions or requests, contact noreply@archonsolution.in. This address accepts and is monitored for privacy-related correspondence."
    ]
  ]
];

export default function PrivacyPolicy() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Privacy Policy | YLAAM Meet';
    window.scrollTo(0, 0);
    return () => { document.title = previous; };
  }, []);
  const linkClass = 'text-violet-200 underline underline-offset-4 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300';
  return <div className="min-h-screen bg-[#080b19] text-[#e5e7eb]">
    <a href="#policy-content" className="sr-only focus:not-sr-only focus:block focus:p-4 focus:bg-violet-800">Skip to policy</a>
    <header className="border-b border-white/15 px-5 py-5 sm:px-8">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
        <Link to="/" className={`text-lg font-bold tracking-wide ${linkClass}`}>YLAAM Meet</Link>
        <Link to="/" className={linkClass}>Return home</Link>
      </div>
    </header>
    <main id="policy-content" tabIndex={-1} className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
      <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-violet-200">Archon Solutions</p>
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">Privacy Policy</h1>
      <p className="mt-5 rounded-xl border border-violet-300/30 p-4 text-sm leading-6">Effective date: 14 October 2026.</p>
      <p className="mt-5 max-w-3xl text-lg leading-8">How YLAAM Meet handles your information, meeting content, and privacy choices.</p>
      <nav aria-label="Policy sections" className="my-10 rounded-2xl border border-white/15 bg-[#11162b] p-5 sm:p-7">
        <p className="mb-4 font-semibold text-white">On this page</p>
        <ol className="grid gap-3 text-sm leading-6 sm:grid-cols-2">
          {sections.map(([title], index) => <li key={title}><a className={linkClass} href={`#policy-section-${index + 1}`}>{index + 1}. {title}</a></li>)}
        </ol>
      </nav>
      <article className="max-w-3xl space-y-10">
        {sections.map(([title, paragraphs], index) => <section key={title} id={`policy-section-${index + 1}`} aria-labelledby={`policy-heading-${index + 1}`} className="scroll-mt-6">
          <h2 id={`policy-heading-${index + 1}`} className="mb-4 text-xl font-semibold text-white sm:text-2xl">{index + 1}. {title}</h2>
          <div className="space-y-4 text-base leading-8 break-words">{paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)}</div>
          {index === 10 && <p className="mt-4 leading-8"><a className={linkClass} href="https://myaccount.google.com/connections">Manage Google Account connections</a></p>}
        </section>)}
        <a className={`inline-block break-all ${linkClass}`} href="mailto:noreply@archonsolution.in">noreply@archonsolution.in</a>
      </article>
    </main>
  </div>;
}
