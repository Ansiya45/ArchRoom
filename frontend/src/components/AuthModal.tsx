'use client';

import React, { useState, useEffect} from 'react';
import { X, LogIn, UserPlus, Mail, Lock, User, ArrowRight } from 'lucide-react';
import { storeSession, type SessionUser } from '../lib/auth';
import { trpc } from '../lib/trpc';

interface AuthModalProps {
  isOpen: boolean;
  mode: 'login' | 'signup';
  onClose: () => void;
  onSuccess: (user: SessionUser) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  mode,
  onClose,
  onSuccess,
}) => {
  const [isLogin, setIsLogin] = useState(mode === 'login');
  useEffect(() => {
  setIsLogin(mode === 'login');
}, [mode]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  const isPasswordValid = passwordRegex.test(password);

  const doPasswordsMatch = 
    password === confirmPassword && confirmPassword !== "";
  const [name, setName] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password || isSubmitting) return;

    if (!isLogin) {
      if (name.trim().length < 2) {
        alert('Please enter your full name.');
        return;
      }

      if (!isPasswordValid) {
        alert('Password must contain at least 8 characters, including uppercase, lowercase, and a number.');
        return;
      }

      if (!doPasswordsMatch) {
        alert('Password and confirm password do not match.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      if (isLogin) {
        const result = await trpc.auth.login.mutate({
          email,
          password,
        });
        storeSession(result.token, result.user);
        onSuccess(result.user);
      } else {
        const result = await trpc.auth.signup.mutate({
          fullName: name,
          email,
          password,
        });
        storeSession(result.token, result.user);
        onSuccess(result.user);
      }

      onClose();
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-slate-100 relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4 border border-blue-100">
          {isLogin ? <LogIn className="w-6 h-6 stroke-[2.2]" /> : <UserPlus className="w-6 h-6 stroke-[2.2]" />}
        </div>

        <h3 className="text-xl font-bold text-slate-900 mb-1">
          {isLogin ? 'Welcome back to ArchRoom' : 'Create your ArchRoom Account'}
        </h3>
        <p className="text-sm text-slate-500 mb-6">
          {isLogin
            ? 'Sign in to access your scheduled meetings and saved rooms.'
            : 'Join thousands of professionals hosting crystal-clear video calls.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  placeholder="e.g. Jordan Miller"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 text-slate-900 text-sm focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Work Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 text-slate-900 text-sm focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 text-slate-900 text-sm focus:outline-none"
              />
            </div>
          </div>

          {!isLogin && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="Retype your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 text-slate-900 text-sm focus:outline-none"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-semibold text-sm shadow-md shadow-blue-500/25 flex items-center justify-center gap-2 active:scale-98 transition-all cursor-pointer"
          >
            <span>{isSubmitting ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Free Account'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-5 text-center text-xs text-slate-500">
          {isLogin ? (
            <span>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => setIsLogin(false)}
                className="text-blue-600 font-semibold hover:underline cursor-pointer"
              >
                Sign Up free
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setIsLogin(true)}
                className="text-blue-600 font-semibold hover:underline cursor-pointer"
              >
                Log In
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
