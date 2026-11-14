'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, ChevronDown, Mail, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { trpc } from '../lib/trpc';
import type { SessionUser } from '../lib/auth';
import {
  FEATURE_KEYS,
  LEVEL_LABELS,
  ROLE_LABELS,
  defaultLevel,
  hasFeature,
  type AccessState,
  type FeatureKey,
  type FeatureLevel,
  type PermissionMap,
  type UserRole,
} from '../lib/permissions';

interface ManagedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  disabled: boolean;
  invitedByName: string | null;
  createdAt: string;
  permissions: PermissionMap;
}

interface Invitation {
  id: string;
  email: string;
  role: UserRole;
  invitedByName: string | null;
  expiresAt: string;
  expired: boolean;
}

interface Props {
  user: SessionUser;
  access: AccessState;
  onAccessChanged: () => void;
}

const LEVELS: FeatureLevel[] = ['none', 'read', 'write', 'full'];
const selectClass = 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 focus:border-blue-500 focus:outline-none';
const buttonClass = 'rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-blue-300';

export const UserManagementView: React.FC<Props> = ({ user, access, onAccessChanged }) => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [inviting, setInviting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<Record<string, PermissionMap>>({});
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);

  const isSuperAdmin = access.role === 'superadmin';
  const canDisable = hasFeature(access, 'user_management', 'full');

  const load = useCallback(async () => {
    try {
      const [userRows, invitationRows] = await Promise.all([
        trpc.users.list.query(),
        trpc.users.listInvitations.query(),
      ]);
      setUsers(userRows as ManagedUser[]);
      setInvitations(invitationRows as Invitation[]);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (action: () => Promise<unknown>, success: string) => {
    setError(''); setNotice('');
    try { await action(); setNotice(success); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Something went wrong.'); }
  }, [load]);

  const sendInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inviting || !inviteEmail.trim()) return;
    setInviting(true);
    await run(
      () => trpc.users.invite.mutate({ email: inviteEmail.trim(), role: inviteRole }),
      `Invitation sent to ${inviteEmail.trim()}.`,
    );
    setInviteEmail('');
    setInviting(false);
  };

  const permissionsFor = (row: ManagedUser): PermissionMap => draftPermissions[row.id] ?? row.permissions;
  const setPermissionLevel = (row: ManagedUser, key: FeatureKey, level: FeatureLevel) => {
    const current = { ...permissionsFor(row) };
    if (level === defaultLevel(key)) delete current[key]; else current[key] = level;
    setDraftPermissions((draft) => ({ ...draft, [row.id]: current }));
  };

  const savePermissions = (row: ManagedUser) => {
    setBusyUserId(row.id);
    void run(
      () => trpc.users.setPermissions.mutate({ userId: row.id, permissions: permissionsFor(row) as Record<string, FeatureLevel> }),
      `Permissions updated for ${row.fullName}.`,
    ).then(() => {
      setDraftPermissions((draft) => { const next = { ...draft }; delete next[row.id]; return next; });
      setBusyUserId(null);
      onAccessChanged();
    });
  };

  const changeRole = (row: ManagedUser, role: UserRole) => {
    setBusyUserId(row.id);
    void run(() => trpc.users.setRole.mutate({ userId: row.id, role }), `${row.fullName} is now ${ROLE_LABELS[role]}.`)
      .then(() => { setBusyUserId(null); onAccessChanged(); });
  };

  const toggleDisabled = (row: ManagedUser) => {
    setBusyUserId(row.id);
    void run(
      () => trpc.users.setDisabled.mutate({ userId: row.id, disabled: !row.disabled }),
      row.disabled ? `${row.fullName} re-enabled.` : `${row.fullName} disabled.`,
    ).then(() => setBusyUserId(null));
  };

  const grouped = useMemo(() => ({
    owners: users.filter((row) => row.role === 'superadmin'),
    members: users.filter((row) => row.role !== 'superadmin'),
  }), [users]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Users className="h-5 w-5" /></div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">User management</h1>
          <p className="text-sm text-slate-500">Invite employees, assign roles, and control feature access.</p>
        </div>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

      {/* Invite */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600"><UserPlus className="h-4 w-4" /> Invite an employee</h2>
        <form onSubmit={sendInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold text-slate-500">Work email</span>
            <input required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="teammate@company.com"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold text-slate-500">Role</span>
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'admin' | 'user')} className={selectClass}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button disabled={inviting} className={buttonClass}>{inviting ? 'Sending…' : 'Send invite'}</button>
        </form>
        <p className="mt-2 text-xs text-slate-400">Only invited emails can create an account. Invitees verify their email before signing in.</p>
      </section>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600"><Mail className="h-4 w-4" /> Pending invitations</h2>
          <ul className="divide-y divide-slate-100">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{invitation.email}</p>
                  <p className="text-xs text-slate-400">
                    {ROLE_LABELS[invitation.role]} · invited by {invitation.invitedByName ?? 'admin'} · {invitation.expired ? 'expired' : `expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
                  </p>
                </div>
                <button disabled={busyInvitationId === invitation.id} onClick={() => { setBusyInvitationId(invitation.id); void run(() => trpc.users.resendInvitation.mutate({ invitationId: invitation.id }), `Invitation resent to ${invitation.email}.`).then(() => setBusyInvitationId(null)); }}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  <RefreshCw className="h-3.5 w-3.5" /> Resend
                </button>
                <button disabled={busyInvitationId === invitation.id} onClick={() => { setBusyInvitationId(invitation.id); void run(() => trpc.users.revokeInvitation.mutate({ invitationId: invitation.id }), `Invitation to ${invitation.email} revoked.`).then(() => setBusyInvitationId(null)); }}
                  className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  <Trash2 className="h-3.5 w-3.5" /> Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Users */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-600"><ShieldCheck className="h-4 w-4" /> Workspace members</h2>
        {loading ? <p className="py-6 text-center text-sm text-slate-400">Loading…</p> : (
          <ul className="divide-y divide-slate-100">
            {[...grouped.owners, ...grouped.members].map((row) => {
              const isSelf = row.id === user.id;
              const expanded = expandedId === row.id;
              const drafts = draftPermissions[row.id];
              const dirty = !!drafts;
              return (
                <li key={row.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {row.fullName} {isSelf && <span className="text-xs font-medium text-slate-400">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {row.email}{row.invitedByName ? ` · invited by ${row.invitedByName}` : ''}
                      </p>
                    </div>
                    {row.disabled && <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600">Disabled</span>}
                    {isSuperAdmin && !isSelf ? (
                      <select value={row.role} disabled={busyUserId === row.id} onChange={(event) => changeRole(row, event.target.value as UserRole)} className={selectClass}>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                        <option value="superadmin">Super admin</option>
                      </select>
                    ) : (
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${row.role === 'superadmin' ? 'bg-violet-50 text-violet-700' : row.role === 'admin' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                        {ROLE_LABELS[row.role]}
                      </span>
                    )}
                    {row.role !== 'superadmin' && (
                      <button onClick={() => setExpandedId(expanded ? null : row.id)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                        Permissions <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                    )}
                    {canDisable && !isSelf && row.role !== 'superadmin' && (
                      <button disabled={busyUserId === row.id} onClick={() => toggleDisabled(row)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${row.disabled ? 'border-emerald-200 text-emerald-600 hover:bg-emerald-50' : 'border-red-200 text-red-600 hover:bg-red-50'}`}>
                        {row.disabled ? <><CheckCircle2 className="h-3.5 w-3.5" /> Enable</> : <><Ban className="h-3.5 w-3.5" /> Disable</>}
                      </button>
                    )}
                  </div>

                  {expanded && row.role !== 'superadmin' && (
                    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {FEATURE_KEYS.map((key) => {
                          const feature = access.features.find((item) => item.key === key);
                          const current = permissionsFor(row)[key] ?? defaultLevel(key);
                          return (
                            <label key={key} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                              <span className="text-xs font-semibold text-slate-700">{feature?.label ?? key}</span>
                              <select value={current} onChange={(event) => setPermissionLevel(row, key, event.target.value as FeatureLevel)} className={selectClass}>
                                {LEVELS.map((level) => <option key={level} value={level}>{LEVEL_LABELS[level]}</option>)}
                              </select>
                            </label>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-[11px] text-slate-400">Full access includes every action; write allows creating and editing; read is view-only.</p>
                        <button disabled={!dirty || busyUserId === row.id} onClick={() => savePermissions(row)} className={buttonClass}>
                          {busyUserId === row.id ? 'Saving…' : 'Save permissions'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};

export default UserManagementView;
