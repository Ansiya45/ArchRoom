import { useEffect, useRef, useState } from 'react';
import { trpc } from '../lib/trpc';

const button = 'rounded-[8px] border border-slate-200 px-3 py-2 text-xs text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 disabled:opacity-50';
export default function BatchRegistrationLinks({ folderId, onDenied }: { folderId: string; onDenied: () => void }) {
  const [active, setActive] = useState(false), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [link, setLink] = useState(''), [days, setDays] = useState(7), [expires, setExpires] = useState(''), [message, setMessage] = useState('');
  const alive = useRef(true), working = useRef(false);
  const fail = (cause: unknown) => {
    setLink(''); setMessage('Registration links are unavailable. Please retry.');
    const code = (cause as { data?: { code?: string } })?.data?.code;
    if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED' || code === 'NOT_FOUND') onDenied();
  };
  const refresh = async () => {
    try {
      const result = await trpc.batchRegistration.linkStatus.query({ folderId });
      if (alive.current) { setReady(true); setActive(result.active); setExpires(result.expiresAt ? new Date(result.expiresAt).toLocaleString() : ''); }
    } catch (cause) { if (alive.current) fail(cause); }
  };
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, []);
  const change = async (disable: boolean) => {
    if (working.current) return;
    if (active && !window.confirm(disable ? 'Disable this registration link and its pending email-verification links?' : 'Replace this registration link? The previous link and its pending email-verification links will stop working.')) return;
    working.current = true; setBusy(true); setMessage('');
    try {
      if (disable) { await trpc.batchRegistration.disableLink.mutate({ folderId }); if (alive.current) setLink(''); }
      else { const result = await trpc.batchRegistration.generateLink.mutate({ folderId, expiresInDays: days }); if (alive.current) setLink(result.registrationUrl); }
      if (alive.current) { await refresh(); setMessage(disable ? 'Registration link disabled.' : 'Registration link created. Copy it to share manually.'); }
    } catch (cause) { if (alive.current) fail(cause); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  };
  return <section aria-label="Batch registration link" className="space-y-2 rounded-[8px] border border-slate-200 p-3">
    <h6 className="font-semibold text-white">Student registration link</h6>
    <p className="text-xs text-slate-500">Share manually in WhatsApp. Students must verify their email and await manager approval. No Google Drive access is granted.</p>
    {ready ? <p className="text-xs text-slate-500">{active ? `Active until ${expires}` : 'No active registration link.'}</p> : <button type="button" className={button} onClick={() => void refresh()}>Check registration link</button>}
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-slate-500">Link expires in <select aria-label="Registration link expiration" disabled={busy} value={days} onChange={event => setDays(Number(event.target.value))} className={`${button} bg-slate-50`}><option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option></select></label>
      <button type="button" disabled={busy || !ready} className={button} onClick={() => void change(false)}>{active ? 'Regenerate registration link' : 'Generate registration link'}</button>
      {active && <button type="button" disabled={busy} className={button} onClick={() => void change(true)}>Disable registration link</button>}
    </div>
    {link && <div className="flex flex-wrap gap-2"><input aria-label="Registration link" readOnly value={link} className={`${button} min-w-0 flex-1 bg-slate-50`} onFocus={event => event.target.select()} />
      <button type="button" className={button} onClick={() => void navigator.clipboard.writeText(link).then(() => { if (alive.current) setMessage('Registration link copied.'); }).catch(() => { if (alive.current) setMessage('Copy failed. Select the link and copy it manually.'); })}>Copy Registration Link</button></div>}
    {active && !link && <p className="text-xs text-slate-500">For security, saved tokens cannot be retrieved. Regenerate only if you need a new copy.</p>}
    {message && <p role="status" className="text-xs text-slate-500">{message}</p>}
  </section>;
}
