import { startHostedMeeting } from './lib/startHostedMeeting';
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TRPCClientError } from '@trpc/client';
import { logoutSession } from './lib/sessionRenewal';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Header from './components/Header';
import Sidebar, { SidebarTab } from './components/Sidebar';
import Hero from './components/Hero';
import Footer from './components/Footer';
import JoinModal from './components/JoinModal';
import ScheduleModal from './components/ScheduleModal';
import ScheduledMeetingsView from './components/ScheduledMeetingsView';
import FavoritesView, { MeetingItem } from './components/FavoritesView';
import SettingsView from './components/SettingsView';
import DriveIntegrationPanel from './components/DriveIntegrationPanel';
import StudentGoogleIdentity from './components/StudentGoogleIdentity';
const MeetingHistoryView = React.lazy(() => import('./components/MeetingHistoryView'));
const UserManagementView = React.lazy(() => import('./components/UserManagementView'));
import SettingsModal from './components/SettingsModal';
import AuthModal from './components/AuthModal';
import { CheckCircle2 } from 'lucide-react';
import { clearStoredSession, getSessionIdentity, getStoredUser, subscribeToSessionRemoval, type SessionUser } from './lib/auth';
import { clearAccessCache, usePermissions } from './hooks/usePermissions';
import { trpc } from './lib/trpc';
import { formatMeetingTime, startMeetingOnce, type MeetingRecord } from './lib/meetingSchedule';
import { storeMeetingSession } from './lib/meetingSession';
import { extractMeetingCode } from './lib/meetingCode';

export default function App() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invitedMeeting = searchParams.get('join');
  const inviteParam = searchParams.get('invite');
  const [activeTab, setActiveTab] = useState<SidebarTab>('home');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<MeetingRecord | null>(null);
  const pendingStarts = useRef(new Set<string>());
  const sessionGeneration = useRef(0);
  const [startingCode, setStartingCode] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [openJoinAfterAuth, setOpenJoinAfterAuth] = useState(false);
  const [isAccountLoading, setIsAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountAttempt, setAccountAttempt] = useState(0);

  // User Auth state (null by default so Sign Up and Login are displayed)
  const [user, setUser] = useState<{ id?: string; name: string; email: string; role?: string; isLoggedIn: boolean } | null>(() => {
    const stored = getStoredUser();
    return stored
      ? { id: stored.id, name: stored.fullName, email: stored.email, role: stored.role, isLoggedIn: true }
      : null;
  });

  const { access, can, refresh: refreshAccess } = usePermissions(user?.id);
  const sessionUser: SessionUser | null = user ? { id: user.id ?? '', email: user.email, fullName: user.name, role: user.role } : null;

  const isTabVisible = useCallback((tab: SidebarTab) => {
    // Logged-out dashboard entries open the existing sign-in prompt.
    if (!user) return tab !== 'users';
    switch (tab) {
      case 'create': return can('meetings.instant', 'write') || can('meetings.scheduled', 'write');
      case 'scheduled': return can('meetings.scheduled', 'read');
      case 'favorite': return can('meetings.instant', 'read') || can('meetings.scheduled', 'read');
      case 'history': return can('history', 'read');
      case 'users': return can('user_management', 'read');
      default: return true;
    }
  }, [user, can]);

  useEffect(() => {
    if (!isTabVisible(activeTab)) setActiveTab('home');
  }, [activeTab, isTabVisible]);

  const [authModalState, setAuthModalState] = useState<{
    isOpen: boolean;
    mode: 'login' | 'signup';
  }>({ isOpen: false, mode: 'login' });
  const [accountSwitchInvitation, setAccountSwitchInvitation] = useState<{
    token: string;
    email: string;
    role: 'superadmin' | 'admin' | 'user';
  } | null>(null);

  useEffect(() => {
    if (!invitedMeeting) return;
    const code = extractMeetingCode(invitedMeeting) || invitedMeeting;
    navigate(`/meet/${encodeURIComponent(code)}`, { replace: true });
  }, [invitedMeeting, navigate]);

  useEffect(() => {
    if (!inviteParam) return;
    let active = true;
    if (!user) {
      setInviteToken(inviteParam);
      setAuthModalState({ isOpen: true, mode: 'signup' });
      navigate('/', { replace: true });
      return;
    }
    void trpc.users.verifyInvitation.query({ token: inviteParam }).then((invitation) => {
      if (active) setAccountSwitchInvitation({ token: inviteParam, email: invitation.email, role: invitation.role });
    }).catch(() => {
      if (active) {
        setAccountSwitchInvitation(null);
        navigate('/', { replace: true });
      }
    });
    return () => { active = false; };
  }, [inviteParam, user, navigate]);

  // Scheduled & Favorite Meetings list
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);

  // Active meeting running in MeetingCard
  const [currentMeeting, setCurrentMeeting] = useState<{
    title: string;
    code: string;
    hostName: string;
    isLive: boolean;
  } | null>(null);

  // Notification Banner Toast State
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'info';
  } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const clearAccountUI = useCallback(() => {
    sessionGeneration.current += 1;
    clearAccessCache();
    setInviteToken(null);
    setUser(null);
    setMeetings([]);
    setCurrentMeeting(null);
    setEditingMeeting(null);
    setIsCreateOpen(false);
    setIsJoinOpen(false);
    setIsSettingsOpen(false);
    setOpenJoinAfterAuth(false);
    setAuthModalState({ isOpen: false, mode: 'login' });
    setStartingCode(null);
    pendingStarts.current.clear();
    setActiveTab('home');
    setToast(null);
    setIsAccountLoading(false);
    setAccountError('');
  }, []);

  useEffect(() => subscribeToSessionRemoval(clearAccountUI), [clearAccountUI]);

  useEffect(() => {
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return;

    const preloadMeeting = () => { void import('./components/meeting/MeetingRoom'); };
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(preloadMeeting, { timeout: 4_000 });
      return () => idleWindow.cancelIdleCallback?.(idleId);
    }
    const timer = globalThis.setTimeout(preloadMeeting, 1_500);
    return () => globalThis.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const generation = sessionGeneration.current;
    const identity = getSessionIdentity();
    const isCurrent = () => !cancelled && generation === sessionGeneration.current && identity === getSessionIdentity();

    async function loadAccount() {
      setIsAccountLoading(true);
      setAccountError('');
      try {
        const [account, meetingList] = await Promise.all([
          trpc.auth.me.query(),
          trpc.meetings.list.query(),
        ]);

        if (!isCurrent()) return;

        setUser({
          id: account.user.id,
          name: account.user.fullName,
          email: account.user.email,
          role: (account.user as { role?: string }).role,
          isLoggedIn: true,
        });

        setMeetings(
          meetingList.meetings.map((meeting) => ({
            id: meeting.id,
            title: meeting.title,
            code: meeting.meetingCode,
            time: formatMeetingTime(meeting),
            record: meeting,
            participantsCount: 1,
            hostName: account.user.fullName,
            isFavorite: meeting.isFavorite,
          }))
        );
        setIsAccountLoading(false);
      } catch (error) {
        if (!isCurrent()) return;
        console.error(error);
        setIsAccountLoading(false);
        if (error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED') {
          clearStoredSession();
          showToast('Your session expired. Please sign in again.', 'info');
        } else {
          setAccountError('Unable to load your dashboard. You are still signed in.');
        }
      }
    }

    void loadAccount();

    return () => {
      cancelled = true;
    };
  }, [user?.email, accountAttempt]);

  const requestCreateMeeting = () => {
    if (!user) {
      setAuthModalState({ isOpen: true, mode: 'login' });
      showToast('Please sign in before creating a meeting.', 'info');
      return;
    }
    if (!can('meetings.instant', 'write') && !can('meetings.scheduled', 'write')) {
      showToast('You do not have permission to create meetings. Contact your administrator.', 'info');
      return;
    }

    setEditingMeeting(null);
    setIsCreateOpen(true);
  };

  const requestJoinMeeting = () => {
    if (!user) {
      setOpenJoinAfterAuth(true);
      setAuthModalState({ isOpen: true, mode: 'signup' });
      showToast('Create an account or sign in before joining a meeting.', 'info');
      return;
    }
    setIsJoinOpen(true);
  };

  const handleSidebarTabChange = (tab: SidebarTab) => {
    if (!user && tab !== 'home') {
      setAuthModalState({ isOpen: true, mode: 'login' });
      showToast('Please sign in to access your dashboard.', 'info');
      return;
    }
    setActiveTab(tab);
    if (tab === 'create') {
      requestCreateMeeting();
    }
  };

  const handleToggleFavorite = async (id: string) => {
    const target = meetings.find(meeting => meeting.id === id);
    if (!target) return;
    const favorite = !target.isFavorite;
    setMeetings(current => current.map(meeting => meeting.id === id ? { ...meeting, isFavorite: favorite } : meeting));
    try {
      await trpc.meetings.setPreference.mutate({ meetingId: id, favorite });
      showToast(favorite ? `Added "${target.title}" to Favorites` : `Removed from Favorites`);
    } catch {
      setMeetings(current => current.map(meeting => meeting.id === id ? { ...meeting, isFavorite: !favorite } : meeting));
      showToast('Could not save the Favorites change. Please retry.', 'info');
    }
  };

  const handleDeleteMeeting = async (id: string) => {
    const target = meetings.find((m) => m.id === id);
    if (!target) return;
    setMeetings((prev) => prev.filter((m) => m.id !== id));
    try {
      await trpc.meetings.setPreference.mutate({ meetingId: id, hidden: true });
      showToast(`Meeting "${target.title}" removed from your dashboard.`);
    } catch {
      setMeetings(current => current.some(meeting => meeting.id === id) ? current : [target, ...current]);
      showToast('Could not remove the meeting from your dashboard. Please retry.', 'info');
    }
  };

  const handleStartMeeting = async (meeting: MeetingItem, occurrenceId?: string) => {
    if (!user) {
      setAuthModalState({ isOpen: true, mode: 'login' });
      showToast('Please sign in before starting a meeting.', 'info');
      return;
    }
    try {
      await startMeetingOnce(pendingStarts.current, meeting.code, async () => {
        setStartingCode(meeting.code);
        const { meeting: current } = await trpc.meetings.getByCode.query({ meetingCode: meeting.code });
        await startHostedMeeting(current, occurrenceId);
      }, () => {
        setCurrentMeeting({ title: meeting.title, code: meeting.code, hostName: meeting.hostName, isLive: true });
        setMeetings((current) => current.map((item) => item.id === meeting.id && item.record
          ? { ...item, record: { ...item.record, status: 'live' } } : item));
        setActiveTab('home');
        navigate(`/meet/${meeting.code}`);
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to start meeting.', 'info');
    } finally {
      if (!pendingStarts.current.has(meeting.code)) setStartingCode((code) => code === meeting.code ? null : code);
    }
  };

  return (
    <div className="h-screen overflow-hidden bg-slate-50 bg-arch-radial flex flex-col text-slate-900 selection:bg-blue-500 selection:text-white">
      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed top-16 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700/80 flex items-center gap-2.5 animate-in slide-in-from-top duration-200">
          <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0" />
          <span className="text-xs sm:text-sm font-semibold">{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <Header
        user={user}
        onOpenJoin={requestJoinMeeting}
        onOpenCreate={requestCreateMeeting}
        onOpenAuth={(mode) => setAuthModalState({ isOpen: true, mode })}
        onLogout={() => {
          void logoutSession().catch(() => {
            showToast('Signed out on this browser. Unable to confirm sign-out with the server.', 'info');
          });
          showToast('Signed out successfully.');
        }}
      />

      <div className="flex-1 flex min-h-0 w-full overflow-hidden">
        {/* Fixed Left Sidebar */}
        <Sidebar activeTab={activeTab} setActiveTab={handleSidebarTabChange} isTabVisible={isTabVisible} />

        {/* Main Content Area */}
        <main className="flex-1 min-h-0 pb-16 sm:pb-0 sm:pl-[72px] flex flex-col justify-between h-[calc(100vh-56px)] overflow-hidden">
          <div data-testid="dashboard-scroll" className="flex-1 min-h-0 flex flex-col justify-start overflow-y-auto overflow-x-hidden py-2 sm:py-4">
            {user && isAccountLoading && (
              <div role="status" className="mx-auto mb-2 rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-slate-500 shadow-sm">Loading your dashboard...</div>
            )}
            {user && accountError && (
              <div role="alert" className="mx-auto mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-slate-600">
                <p>{accountError}</p>
                <button className="mt-3 font-semibold text-blue-600" onClick={() => setAccountAttempt(value => value + 1)}>Try again</button>
              </div>
            )}
            <>
            {/* Tab 1 & Tab 2: Home View */}
            {(activeTab === 'home' || activeTab === 'create') && (
              <Hero
                currentMeeting={user ? currentMeeting : null}
                onJoinMeeting={requestJoinMeeting}
                onCreateMeeting={requestCreateMeeting}
                onLeaveMeeting={() => {
                  showToast('Left meeting call.');
                  setCurrentMeeting(null);
                }}
              />
            )}

            {/* Tab 3: Scheduled Meetings View */}
            {activeTab === 'scheduled' && (
              <ScheduledMeetingsView
                hostUserId={getStoredUser()?.id}
                onRescheduleMeeting={(record) => { setEditingMeeting(record); setIsCreateOpen(true); }}
                meetings={user ? meetings : []}
                startingCode={startingCode}
                onMeetingChanged={(record) => setMeetings(current => current.map(item => item.id === record.id ? { ...item, record, time: formatMeetingTime(record) } : item))}
                onStartMeeting={handleStartMeeting}
                onToggleFavorite={handleToggleFavorite}
                onDeleteMeeting={handleDeleteMeeting}
                onOpenCreateModal={requestCreateMeeting}
              />
            )}

            {/* Tab 4: Favorites View */}
            {activeTab === 'favorite' && (
              <FavoritesView
                meetings={user ? meetings : []}
                startingCode={startingCode}
                onMeetingChanged={(record) => setMeetings(current => current.map(item => item.id === record.id ? { ...item, record, time: formatMeetingTime(record) } : item))}
                onStartMeeting={handleStartMeeting}
                onToggleFavorite={handleToggleFavorite}
                onOpenCreateModal={requestCreateMeeting}
              />
            )}

            {activeTab === 'history' && user && <React.Suspense fallback={<p role="status">Loading meeting history…</p>}><MeetingHistoryView key={user.email} /></React.Suspense>}
            {activeTab === 'users' && user && sessionUser && access && (
              <React.Suspense fallback={<p role="status">Loading user management…</p>}>
                <UserManagementView user={sessionUser} access={access} onAccessChanged={refreshAccess} />
              </React.Suspense>
            )}
            {/* Tab 5: Settings View */}
            {activeTab === 'settings' && (
              <><SettingsView onShowToast={(msg) => showToast(msg)} /><DriveIntegrationPanel /><StudentGoogleIdentity /></>
            )}
            </>
          </div>

          {/* Footer */}
          <Footer />
        </main>
      </div>

      {/* Interactive Modals */}
      {user && <JoinModal
        isOpen={isJoinOpen}
        accountName={user?.name || ''}
        onClose={() => setIsJoinOpen(false)}
        onJoinSuccess={(code, name, participantId, joinRequestId, occurrenceId) => {
          storeMeetingSession(code, { displayName: name, participantId, joinRequestId, occurrenceId });
          setCurrentMeeting({
            title: `Instant Meeting Room (${code})`,
            code,
            hostName: name,
            isLive: true,
          });
          setActiveTab('home');
          navigate(`/meet/${code}`);
          showToast(`Successfully joined room ${code} as ${name}`);
        }}
      />}

      {user && <ScheduleModal
        isOpen={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); setEditingMeeting(null); }}
        editingMeeting={editingMeeting}
        onUpdated={(record, action) => {
          setMeetings((current) => current.map((item) => item.id === record.id
            ? { ...item, record, time: formatMeetingTime(record) } : item));
          showToast(action === 'recordingSettings' ? 'Recording settings saved.' : `Meeting "${record.title}" rescheduled. The link is unchanged.`);
        }}
        onCreated={(record) => {
          storeMeetingSession(record.meetingCode, { displayName: user?.name || 'You' });
          const newMeeting: MeetingItem = {
            id: record.id, title: record.title, code: record.meetingCode,
            time: formatMeetingTime(record), record, participantsCount: 1,
            hostName: user?.name || 'You', isFavorite: false,
          };
          setMeetings((prev) => [newMeeting, ...prev.filter((item) => item.id !== record.id)]);
          if (record.status === 'live') {
            setCurrentMeeting({ title: record.title, code: record.meetingCode, hostName: user?.name || 'You', isLive: true });
            setActiveTab('home');
          } else setActiveTab('scheduled');
          showToast(`Meeting "${record.title}" created! Code: ${record.meetingCode}`);
        }}
      />}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {user && accountSwitchInvitation && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" aria-labelledby="account-switch-invitation-title"
            className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 id="account-switch-invitation-title" className="text-xl font-bold text-slate-900">Switch account to accept invitation</h2>
            <p className="mt-3 text-sm text-slate-600">
              You are signed in as <strong>{user.email}</strong>. This invitation is for <strong>{accountSwitchInvitation.email}</strong>.
            </p>
            <p className="mt-2 text-sm text-slate-500">Sign out of the current account before creating the invited {accountSwitchInvitation.role} account.</p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                onClick={() => { setAccountSwitchInvitation(null); navigate('/', { replace: true }); }}>
                Keep current account
              </button>
              <button type="button" className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"
                onClick={() => {
                  const invitation = accountSwitchInvitation;
                  setAccountSwitchInvitation(null);
                  void logoutSession().catch(() => undefined).finally(() => {
                    setInviteToken(invitation.token);
                    setAuthModalState({ isOpen: true, mode: 'signup' });
                    navigate('/', { replace: true });
                  });
                }}>
                Sign out and accept invitation
              </button>
            </div>
          </section>
        </div>
      )}

      <AuthModal
        key={sessionGeneration.current}
        isOpen={authModalState.isOpen}
        mode={authModalState.mode}
        inviteToken={inviteToken}
        onClose={() => setAuthModalState({ isOpen: false, mode: 'login' })}
        onSuccess={(authenticatedUser) => {
          setUser({
            id: authenticatedUser.id,
            name: authenticatedUser.fullName,
            email: authenticatedUser.email,
            role: authenticatedUser.role,
            isLoggedIn: true,
          });
          showToast(`Signed in successfully as ${authenticatedUser.email}`);
          if (invitedMeeting) {
            navigate(`/meet/${encodeURIComponent(invitedMeeting)}`, { replace: true });
            return;
          }
          if (openJoinAfterAuth) {
            setOpenJoinAfterAuth(false);
            setIsJoinOpen(true);
          }
        }}
      />
    </div>
  );
}
