import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { getStoredUser } from '@/lib/auth';
import type { RecoverySetup } from '@/hooks/useScreenRecorder';

export function LocalRecoverySetup({ meetingCode, active, disabled, onChange }: {
  meetingCode: string; active: boolean; disabled: boolean; onChange: (setup: RecoverySetup | null) => void;
}) {
  const [open, setOpen] = useState(false), [passphrase, setPassphrase] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const owner = getStoredUser()?.id;
    const check = () => { if (!owner || getStoredUser()?.id !== owner) { setPassphrase(''); setConfirmation(''); setOpen(false); onChange(null); } };
    const timer = window.setInterval(check, 1000);
    window.addEventListener('storage', check); window.addEventListener('ylaam-session-removed', check);
    return () => { window.clearInterval(timer); window.removeEventListener('storage', check); window.removeEventListener('ylaam-session-removed', check); };
  }, [open]);
  const enable = async () => {
    if (passphrase.length < 12 || passphrase !== confirmation) { setError('Enter matching recovery passphrases of at least 12 characters.'); return; }
    setBusy(true); setError('');
    try {
      const { user } = await trpc.auth.me.query();
      if (getStoredUser()?.id !== user.id) throw new Error('Your account changed. Sign in again.');
      void navigator.storage?.persist?.().catch(() => false);
      onChange({ ownerId: user.id, passphrase, meetingCode, verifyOwner: async () => (await trpc.auth.me.query()).user.id === user.id && getStoredUser()?.id === user.id });
      setPassphrase(''); setConfirmation(''); setOpen(false);
    } catch { onChange(null); setError('Your account could not be verified. Recording without local recovery is still available.'); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" disabled={disabled} onClick={() => { setOpen(true); setError(''); }} className="rounded-[8px] border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-white disabled:opacity-50">{active ? 'Local recovery ready' : 'Set up local recovery'}</button>
    {open && <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="local-recovery-title" className="w-full max-w-md space-y-3 rounded-[8px] border border-white/10 bg-slate-900 p-5 text-white">
        <h2 id="local-recovery-title" className="font-semibold">Encrypted local recovery</h2>
        <p className="text-sm text-slate-300">Optional for the next recording. Choose a strong passphrase of at least 12 characters and remember it: it cannot be recovered. Browser data clearing or private browsing may remove local recordings.</p>
        <label className="block text-sm">Recovery passphrase<input type="password" autoComplete="new-password" value={passphrase} onChange={event => setPassphrase(event.target.value)} className="mt-1 w-full rounded-[8px] border border-white/10 bg-slate-950 p-2 text-white" /></label>
        <label className="block text-sm">Confirm passphrase<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-1 w-full rounded-[8px] border border-white/10 bg-slate-950 p-2 text-white" /></label>
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void enable()} className="rounded-[8px] bg-violet-600 px-3 py-2 text-sm disabled:opacity-50">Enable for next recording</button>
          {active && <button type="button" onClick={() => { onChange(null); setOpen(false); setPassphrase(''); setConfirmation(''); }} className="rounded-[8px] border border-white/10 px-3 py-2 text-sm">Disable recovery</button>}
          <button type="button" onClick={() => { setOpen(false); setPassphrase(''); setConfirmation(''); }} className="rounded-[8px] border border-white/10 px-3 py-2 text-sm">Cancel</button>
        </div>
      </div>
    </div>}
  </>;
}
