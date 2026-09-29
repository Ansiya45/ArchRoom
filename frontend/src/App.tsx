import { startHostedMeeting } from './lib/startHostedMeeting';
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from './components/Header';
import Sidebar, { SidebarTab } from './components/Sidebar';
import Hero from './components/Hero';
import Footer from './components/Footer';
import JoinModal from './components/JoinModal';
import ScheduleModal from './components/ScheduleModal';
import ScheduledMeetingsView from './components/ScheduledMeetingsView';
import FavoritesView, { MeetingItem } from './components/FavoritesView';
import SettingsView from './components/SettingsView';
import SettingsModal from './components/SettingsModal';
import AuthModal from './components/AuthModal';
import { CheckCircle2 } from 'lucide-react';
import { clearStoredSession, getAuthToken, getStoredUser, subscribeToSessionRemoval } from './lib/auth';
import { trpc } from './lib/trpc';
import { formatMeetingTime, startMeetingOnce, type MeetingRecord } from './lib/meetingSchedule';
import { storeMeetingSession } from './lib/meetingSession';

export default function App() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SidebarTab>('home');
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<MeetingRecord | null>(null);
  const pendingStarts = useRef(new Set<string>());
  const sessionGeneration = useRef(0);
  const [startingCode, setStartingCode] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [openJoinAfterAuth, setOpenJoinAfterAuth] = useState(false);
  const [isAccountLoading, setIsAccountLoading] = useState(false);

  // User Auth state (null by default so Sign Up and Login are displayed)
  const [user, setUser] = useState<{ name: string; email: string; isLoggedIn: boolean } | null>(() => {
    const stored = getStoredUser();
    return stored
      ? { name: stored.fullName, email: stored.email, isLoggedIn: true }
      : null;
  });

  const [authModalState, setAuthModalState] = useState<{
    isOpen: boolean;
    mode: 'login' | 'signup';
  }>({ isOpen: false, mode: 'login' });

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
  }, []);

  useEffect(() => subscribeToSessionRemoval(clearAccountUI), [clearAccountUI]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const generation = sessionGeneration.current;
    const token = getAuthToken();
    const isCurrent = () => !cancelled && generation === sessionGeneration.current && token === getAuthToken();

    async function loadAccount() {
      setIsAccountLoading(true);
      try {
        const [account, meetingList] = await Promise.all([
          trpc.auth.me.query(),
          trpc.meetings.list.query(),
        ]);

        if (!isCurrent()) return;

        setUser({
          name: account.user.fullName,
          email: account.user.email,
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
            isFavorite: false,
          }))
        );
        setIsAccountLoading(false);
      } catch (error) {
        if (!isCurrent()) return;
        console.error(error);
        clearStoredSession();
        setUser(null);
        setMeetings([]);
        setCurrentMeeting(null);
        setIsAccountLoading(false);
        showToast('Your session expired. Please sign in again.', 'info');
      }
    }

    void loadAccount();

    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  const requestCreateMeeting = () => {
    if (!user) {
      setAuthModalState({ isOpen: true, mode: 'login' });
      showToast('Please sign in before creating a meeting.', 'info');
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

  const handleToggleFavorite = (id: string) => {
    setMeetings((prev) =>
      prev.map((m) => {
        if (m.id === id) {
          const nextFav = !m.isFavorite;
          showToast(nextFav ? `Added "${m.title}" to Favorites` : `Removed from Favorites`);
          return { ...m, isFavorite: nextFav };
        }
        return m;
      })
    );
  };

  const handleDeleteMeeting = (id: string) => {
    const target = meetings.find((m) => m.id === id);
    setMeetings((prev) => prev.filter((m) => m.id !== id));
    if (target) {
      showToast(`Meeting "${target.title}" deleted.`);
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
          clearStoredSession();
          setUser(null);
          showToast('Signed out successfully.');
        }}
      />

      <div className="flex-1 flex min-h-0 w-full overflow-hidden">
        {/* Fixed Left Sidebar */}
        <Sidebar activeTab={activeTab} setActiveTab={handleSidebarTabChange} />

        {/* Main Content Area */}
        <main className="flex-1 min-h-0 pb-16 sm:pb-0 sm:pl-[72px] flex flex-col justify-between h-[calc(100vh-56px)] overflow-hidden">
          <div data-testid="dashboard-scroll" className="flex-1 min-h-0 flex flex-col justify-start overflow-y-auto overflow-x-hidden py-2 sm:py-4">
            {user && isAccountLoading ? (
              <div role="status" className="m-auto text-sm font-semibold text-slate-500">Loading your dashboard...</div>
            ) : <>
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

            {/* Tab 5: Settings View */}
            {activeTab === 'settings' && (
              <SettingsView onShowToast={(msg) => showToast(msg)} />
            )}
            </>}
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
        onUpdated={(record) => {
          setMeetings((current) => current.map((item) => item.id === record.id
            ? { ...item, record, time: formatMeetingTime(record) } : item));
          showToast(`Meeting "${record.title}" rescheduled. The link is unchanged.`);
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

      <AuthModal
        key={sessionGeneration.current}
        isOpen={authModalState.isOpen}
        mode={authModalState.mode}
        onClose={() => setAuthModalState({ isOpen: false, mode: 'login' })}
        onSuccess={(authenticatedUser) => {
          setUser({
            name: authenticatedUser.fullName,
            email: authenticatedUser.email,
            isLoggedIn: true,
          });
          showToast(`Signed in successfully as ${authenticatedUser.email}`);
          if (openJoinAfterAuth) {
            setOpenJoinAfterAuth(false);
            setIsJoinOpen(true);
          }
        }}
      />
    </div>
  );
}
