import { useEffect, useState } from 'react';
import { trpc } from '../lib/trpc';

type Status = Awaited<ReturnType<typeof trpc.studentGoogleIdentity.status.query>>;
const button = 'rounded-[8px] border border-slate-600 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 disabled:opacity-50';
export default function StudentGoogleIdentity() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = async () => { try { setStatus(await trpc.studentGoogleIdentity.status.query()); } catch { setStatus(null); } };
  useEffect(() => { void refresh(); }, []);
  if (!status) return null;
  const connect = async () => { setBusy(true); setError(''); try {
    const { authorizationUrl } = await trpc.studentGoogleIdentity.connect.mutate();
    if (new URL(authorizationUrl).origin !== 'https://accounts.google.com') throw new Error('Invalid destination');
    window.location.assign(authorizationUrl);
  } catch { setError('Unable to connect. A signed-in account with an approved linked batch enrollment is required.'); setBusy(false); } };
  const unlink = async () => { if (!window.confirm('Disconnect this Google identity? Recording access is not granted by this connection.')) return;
    setBusy(true); setError(''); try { await trpc.studentGoogleIdentity.unlink.mutate(); await refresh(); }
    catch { setError('Unable to disconnect. Please sign in again and retry.'); } finally { setBusy(false); } };
  return <section aria-label="Student Google identity" className="rounded-[8px] border border-slate-700 bg-slate-900 p-5 text-slate-100 space-y-3">
    <h3 className="font-semibold">Student Google identity</h3>
    <p role="status" className="text-sm text-slate-300">{status.status === 'verified' ? `Connected: ${status.email}` : 'No Google identity connected.'}</p>
    <p className="text-sm text-slate-400">Connecting verifies your Google identity. It does not grant recording access.</p>
    {status.status === 'verified' ? <button type="button" className={button} disabled={busy} onClick={() => void unlink()}>Disconnect</button>
      : <button type="button" className={button} disabled={busy || !status.linkingAvailable} onClick={() => void connect()}>Connect Google</button>}
    {!status.linkingAvailable && <p className="text-sm text-slate-400">Google identity linking is not configured.</p>}
    {error && <p role="alert" className="text-sm text-slate-300">{error}</p>}
  </section>;
}
