import { useEffect, useRef, useState } from 'react';
import { trpc } from '../lib/trpc';

const control = 'w-full rounded-[8px] border border-slate-700 bg-slate-900 px-3 py-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 disabled:opacity-50';
export default function BatchRegistrationPage({ verify = false }: { verify?: boolean }) {
  const [token, setToken] = useState(() => window.location.hash.slice(1));
  const [linkVersion, setLinkVersion] = useState(0);
  const [batch, setBatch] = useState(''), [name, setName] = useState(''), [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [done, setDone] = useState(false);
  const working = useRef(false), requestEpoch = useRef(0);
  const valid = /^[A-Za-z0-9_-]{43}$/.test(token);
  useEffect(() => {
    const changed = () => {
      requestEpoch.current++; working.current = false;
      setToken(window.location.hash.slice(1)); setLinkVersion(value => value + 1); setBatch(''); setName(''); setEmail(''); setBusy(false); setMessage(''); setError(''); setDone(false);
    };
    window.addEventListener('hashchange', changed);
    return () => { requestEpoch.current++; window.removeEventListener('hashchange', changed); };
  }, []);
  useEffect(() => {
    let active = true;
    // Tokens stay out of server paths, referrers and browser history after opening.
    window.history.replaceState(window.history.state, '', window.location.pathname);
    if (!valid) { setError('Invalid link. Ask your batch manager for a new link.'); return; }
    if (!verify) void trpc.batchRegistration.identify.mutate({ token }).then(result => { if (active) setBatch(result.batchName); })
      .catch(() => { if (active) setError('This link is unavailable or expired. Ask your batch manager for a new link.'); });
    return () => { active = false; };
  }, [token, valid, verify, linkVersion]);
  const submit = async (bindAccount = false) => {
    if (working.current || !valid) return;
    working.current = true; setBusy(true); setError(''); setMessage('');
    const current = requestEpoch.current;
    try {
      const result = verify && bindAccount
        ? await trpc.batchRegistration.verifyAndBind.mutate({ token })
        : verify ? await trpc.batchRegistration.verify.mutate({ token }) : await trpc.batchRegistration.register.mutate({ token, name: name.trim(), email: email.trim() });
      if (current !== requestEpoch.current) return;
      setMessage('message' in result ? result.message : result.approvalRequired
        ? 'Email verified and enrollment linked to your account. Manager approval is still required.'
        : 'Email verified and enrollment linked to your account.');
      if (verify) setDone(true);
    } catch {
      if (current !== requestEpoch.current) return;
      setError(verify && bindAccount ? 'Could not link enrollment. Sign in with the verified account for this email and use a fresh verification link.' : verify ? 'Verification could not be completed. The link may be expired, disabled, or already used. Reopen the registration link to request a new email.' : 'Registration could not be submitted. Please wait before retrying, or ask your manager for a new link.');
    } finally { if (current === requestEpoch.current) { working.current = false; setBusy(false); } }
  };
  return <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100">
    <section className="mx-auto max-w-md space-y-4 rounded-[8px] border border-slate-700 bg-slate-900 p-6">
      <p className="font-semibold text-purple-300">YLAAM-MEET</p>
      <h1 className="text-2xl font-bold">{verify ? 'Verify your email' : 'Batch registration'}</h1>
      {batch && <p className="text-slate-300">{batch}</p>}
      <p className="text-sm text-slate-400">Email verification and manager approval are separate. Neither verifies a Google account or grants recording access. This does not create a sign-in account.</p>
      {!verify && valid && !batch && !error && <p role="status">Checking registration link…</p>}
      {valid && !done && (verify || batch) && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
        {!verify && <><label className="block text-sm">Name<input className={control} autoComplete="name" required maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
          <label className="block text-sm">Email<input className={control} type="email" autoComplete="email" required maxLength={255} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label></>}
        <button disabled={busy} className={`${control} bg-purple-600`}>{busy ? 'Please wait…' : verify ? 'Verify email' : 'Request email verification'}</button>
        {verify && <button type="button" disabled={busy} className={control} onClick={() => void submit(true)}>Verify and link my signed-in account</button>}
      </form>}
      {message && <p role="status" className="text-sm text-slate-300">{message}</p>}
      {error && <p role="alert" className="text-sm text-slate-300">{error}</p>}
      <a href="/" className="inline-block text-sm text-purple-300 underline">Return to YLAAM Meet</a>
    </section>
  </main>;
}
