import { useEffect, useState } from 'react';
import { trpc } from '../lib/trpc';
import { loadDrive, pickDriveFolder } from '../lib/googleDriveRecording';
import { getValidAccessToken } from '../lib/sessionRenewal';

type Status = Awaited<ReturnType<typeof trpc.googleDriveIntegration.status.query>>;

export default function DriveIntegrationPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    try { setStatus(await trpc.googleDriveIntegration.status.query()); setError(''); }
    catch {
      setStatus(current => current?.isAdministrator ? { ...current, connected: false, pending: false, connectionState: 'status_unavailable', accountEmail: null } : current);
      setError('Unable to refresh Google Drive status. Please retry.');
    }
  };
  useEffect(() => { void refresh(); }, []);
  if (!status?.isAdministrator) return null;
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Google Drive setup failed.'); }
    finally { setBusy(false); }
  };
  const start = () => void run(async () => {
    const { startUrl } = await trpc.googleDriveIntegration.start.mutate();
    const token = await getValidAccessToken();
    if (!token) throw new Error('A current administrator session is required. Sign in again and retry.');
    // A top-level form POST lets the backend set its short-lived Lax state
    // cookie in a first-party navigation, even when cross-site cookies are blocked.
    const form = document.createElement('form');
    form.method = 'POST'; form.action = startUrl; form.style.display = 'none';
    const field = document.createElement('input');
    field.type = 'hidden'; field.name = 'token'; field.value = token;
    form.appendChild(field); document.body.appendChild(form); form.submit();
  });
  const selectRoot = () => void run(async () => {
    const apiKey = import.meta.env.VITE_GOOGLE_DRIVE_API_KEY;
    const appId = import.meta.env.VITE_GOOGLE_DRIVE_APP_ID;
    if (!apiKey || !appId) throw new Error('Google Picker API key and app ID are not configured.');
    const { accessToken, expiresIn } = await trpc.googleDriveIntegration.pickerAccess.mutate();
    await loadDrive();
    const selected = await pickDriveFolder({ clientId: '', apiKey, appId },
      { token: accessToken, expiresAt: Date.now() + expiresIn * 1000, accountId: '', email: '' });
    if (!selected) return;
    await trpc.googleDriveIntegration.verifyRoot.mutate({ selectedFolderId: selected.id });
  });
  return <section aria-label="Google Drive integration" className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
    <h3 className="font-semibold text-slate-900">Company recording folder</h3>
    <p role="status" className="text-sm text-slate-600">{status.connected ? 'Connected and verified' : status.pending ? 'Google authorized. Select the configured recording root with Google Picker. An existing saved connection is kept until the replacement is verified. If setup expired or the server restarted, authorize again.' : status.connectionState === 'authorization_unavailable' ? 'The saved Google authorization could not be refreshed. It may have expired, been revoked, or be temporarily unavailable. Retry or authorize again.' : status.connectionState === 'root_unverified' ? 'The Recording Sessions root could not be verified. It may be missing, inaccessible, or temporarily unavailable. Retry or select the configured root again.' : status.connectionState === 'status_unavailable' ? 'Connection status is unavailable. Check the integration configuration and retry.' : 'Google Drive is not connected. Authorize the company account to begin.'}</p>
    {status.accountEmail && <p className="text-sm text-slate-600">{status.pending ? 'Account awaiting root selection' : status.connected ? 'Connected account' : 'Saved account'}: {status.accountEmail}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={start} className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">{status.connected ? 'Replace Google connection' : 'Authorize Google account'}</button>
      {(status.pending || status.connected || status.connectionState === 'root_unverified') && <button type="button" disabled={busy} onClick={selectRoot} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Select recording root</button>}
      <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Refresh status</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <p className="text-xs text-slate-500">Folder access is limited by the backend to the configured recording root. Uploads and Drive sharing are not enabled here.</p>
  </section>;
}
