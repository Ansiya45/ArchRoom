'use client';

import React, { useEffect, useState } from 'react';
import { TRPCClientError } from '@trpc/client';
import { ArrowRight, Eye, EyeOff, Lock, LogIn, Mail, User, UserPlus, X } from 'lucide-react';
import { storeSession, type SessionUser } from '../lib/auth';
import { trpc } from '../lib/trpc';

interface AuthModalProps { isOpen: boolean; mode: 'login' | 'signup'; onClose: () => void; onSuccess: (user: SessionUser) => void }
type View = 'login' | 'signup' | 'verify' | 'forgot' | 'reset';
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, mode, onClose, onSuccess }) => {
  const [view, setView] = useState<View>(mode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setView(mode);
    if (!isOpen) { setError(''); setMessage(''); setCode(''); setPassword(''); setConfirmPassword(''); }
  }, [mode, isOpen]);

  if (!isOpen) return null;
  const needsNewPassword = view === 'signup' || view === 'reset';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(''); setMessage('');
    if (needsNewPassword && !passwordRegex.test(password)) return setError('Use 8+ characters with uppercase, lowercase, and a number.');
    if (needsNewPassword && password !== confirmPassword) return setError('Passwords do not match.');
    setSubmitting(true);
    try {
      if (view === 'signup') {
        await trpc.auth.signup.mutate({ fullName: name, email, password });
        setPassword(''); setConfirmPassword(''); setView('verify'); setMessage('We sent a 6-digit verification code to your email.');
      } else if (view === 'verify') {
        const result = await trpc.auth.verifyEmail.mutate({ email, code });
        storeSession(result.token, result.user, result.refreshToken); onSuccess(result.user); onClose();
      } else if (view === 'forgot') {
        const result = await trpc.auth.requestPasswordReset.mutate({ email });
        setCode(''); setPassword(''); setConfirmPassword(''); setView('reset'); setMessage(result.message);
      } else if (view === 'reset') {
        await trpc.auth.resetPassword.mutate({ email, code, password });
        setView('login'); setCode(''); setPassword(''); setConfirmPassword(''); setMessage('Password updated. You can now sign in.');
      } else {
        const result = await trpc.auth.login.mutate({ email, password });
        storeSession(result.token, result.user, result.refreshToken); onSuccess(result.user); onClose();
      }
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : 'Something went wrong.';
      // Login checks the password before returning this unverified-account error.
      // Opening the dialog grants no session and never sends an email itself.
      if (view === 'login' && caught instanceof TRPCClientError && caught.data?.code === 'FORBIDDEN' &&
          detail === 'Your registration is incomplete. Complete the email verification from sign up before logging in.') {
        setPassword(''); setConfirmPassword(''); setCode(''); setView('verify');
        setMessage('Your email still needs verification. Enter your latest code, or choose Resend code if it has expired.');
        return;
      }
      if (view === 'signup' && caught instanceof TRPCClientError && caught.data?.code === 'CONFLICT') {
        setMessage('Already registered? Choose “Already have an account? Sign in” below. Sign in with your password to continue email verification if needed.');
      }
      setError(detail);
    }
    finally { setSubmitting(false); }
  };

  const title = { login: 'Welcome back', signup: 'Create your account', verify: 'Verify your email', forgot: 'Forgot your password?', reset: 'Choose a new password' }[view];
  const description = { login: 'Sign in to access your meetings.', signup: 'We will verify your email before activating your account.', verify: `Enter the code sent to ${email}.`, forgot: 'Enter your account email to receive a reset code.', reset: `Enter the reset code sent to ${email}.` }[view];

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
    <div className="relative w-full max-w-md rounded-3xl border border-slate-100 bg-white p-6 shadow-2xl sm:p-7">
      <button onClick={onClose} aria-label="Close" className="absolute right-5 top-5 rounded-xl p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-600">{view === 'login' ? <LogIn /> : view === 'signup' ? <UserPlus /> : <Mail />}</div>
      <h3 className="mb-1 text-xl font-bold text-slate-900">{title}</h3><p className="mb-6 text-sm text-slate-500">{description}</p>
      <form onSubmit={submit} className="space-y-4">
        {view === 'signup' && <Field label="Full name" icon={<User />}><input required minLength={2} value={name} onChange={e => setName(e.target.value)} placeholder="Jordan Miller" className="input" /></Field>}
        {(view === 'login' || view === 'signup' || view === 'forgot') && <Field label="Email" icon={<Mail />}><input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" className="input" /></Field>}
        {(view === 'verify' || view === 'reset') && <Field label="6-digit code" icon={<Mail />}><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="input tracking-[0.35em]" /></Field>}
        {(view === 'login' || needsNewPassword) && <Field label={view === 'reset' ? 'New password' : 'Password'} icon={<Lock />}><input required type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete={view === 'login' ? 'current-password' : 'new-password'} className="input pr-12" /><button type="button" onClick={() => setShowPassword(value => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></Field>}
        {needsNewPassword && <Field label="Confirm password" icon={<Lock />}><input required type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" className="input" /></Field>}
        {view === 'login' && <button type="button" disabled={submitting} onClick={() => { setView('forgot'); setError(''); setMessage(''); }} className="text-xs font-semibold text-blue-600 hover:underline">Forgot password?</button>}
        {view === 'forgot' && <button type="button" disabled={submitting} onClick={event => {
          if (!event.currentTarget.form?.reportValidity()) return;
          setCode(''); setPassword(''); setConfirmPassword(''); setError(''); setMessage(''); setView('reset');
        }} className="text-xs font-semibold text-blue-600 hover:underline">I already have a reset code</button>}
        {message && <p className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">{message}</p>}{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        <button disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 text-sm font-semibold text-white disabled:bg-blue-400"><span>{submitting ? 'Please wait...' : view === 'login' ? 'Sign in' : view === 'signup' ? 'Create account' : view === 'verify' ? 'Verify email' : view === 'forgot' ? 'Send reset code' : 'Reset password'}</span><ArrowRight className="h-4 w-4" /></button>
      </form>
      <div className="mt-5 text-center text-xs text-slate-500">
        {view === 'verify' && <button type="button" disabled={submitting} onClick={async () => { if (submitting) return; setSubmitting(true); setError(''); setMessage(''); try { const result = await trpc.auth.resendVerification.mutate({ email }); setCode(''); setMessage(result.message); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to resend code.'); } finally { setSubmitting(false); } }} className="font-semibold text-blue-600 hover:underline disabled:opacity-50">{submitting ? 'Please wait...' : 'Resend code'}</button>}
        {(view === 'forgot' || view === 'reset') && <button onClick={() => setView('login')} className="font-semibold text-blue-600 hover:underline">Back to sign in</button>}
        {(view === 'login' || view === 'signup') && <button onClick={() => { setView(view === 'login' ? 'signup' : 'login'); setError(''); setMessage(''); }} className="font-semibold text-blue-600 hover:underline">{view === 'login' ? 'Create a free account' : 'Already have an account? Sign in'}</button>}
      </div>
    </div>
  </div>;
};

const Field = ({ label, icon, children }: { label: string; icon: React.ReactElement; children: React.ReactNode }) => <div><label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-700">{label}</label><div className="relative">{React.cloneElement(icon, { className: 'absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' } as React.HTMLAttributes<SVGElement>)}{children}</div></div>;

export default AuthModal;
