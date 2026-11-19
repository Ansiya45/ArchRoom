import { useEffect, useState } from 'react';
import { trpc } from '../lib/trpc';

// Capture once and immediately remove the OAuth code from the visible URL.
const params = new URLSearchParams(window.location.search);
const state = params.get('state') ?? '', code = params.get('code') ?? '';
window.history.replaceState(window.history.state, '', window.location.pathname);
let pending: Promise<unknown> | undefined;
export default function StudentGoogleCallback() {
  const [message, setMessage] = useState('Verifying Google identity…');
  useEffect(() => {
    if (!pending) pending = trpc.studentGoogleIdentity.callback.mutate({ state, code });
    let active = true;
    void pending.then(() => { if (active) setMessage('Google identity connected. This does not grant recording access.'); })
      .catch(() => { if (active) setMessage('Unable to connect Google identity. Sign in to the same account and try again.'); });
    return () => { active = false; };
  }, []);
  return <main className="min-h-screen bg-slate-950 p-8 text-slate-100"><p role="status">{message}</p><a href="/" className="text-purple-300 underline">Return to YLAAM Meet</a></main>;
}
