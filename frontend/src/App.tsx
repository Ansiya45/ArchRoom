'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
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

export default function App() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SidebarTab>('home');
  const [isJoinOpen, setIsJoinOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // User Auth state (null by default so Sign Up and Login are displayed)
  const [user, setUser] = useState<{ name: string; email: string; isLoggedIn: boolean } | null>(null);

  const [authModalState, setAuthModalState] = useState<{
    isOpen: boolean;
    mode: 'login' | 'signup';
  }>({ isOpen: false, mode: 'login' });

  // Scheduled & Favorite Meetings list
  const [meetings, setMeetings] = useState<MeetingItem[]>([
    {
      id: 'm2',
      title: 'Design Critique & UI Motion Specs',
      code: 'arch-402-991',
      time: 'Tomorrow • 10:30 AM - 11:30 AM',
      participantsCount: 5,
      hostName: 'Mike Chen',
      isFavorite: true,
    },
    {
      id: 'm3',
      title: 'Client Demo: WebRTC & Spatial Audio',
      code: 'arch-118-203',
      time: 'Thursday, July 23 • 4:00 PM',
      participantsCount: 12,
      hostName: 'Emma Watson',
      isFavorite: false,
    },
  ]);

  // Active meeting running in MeetingCard
  const [currentMeeting, setCurrentMeeting] = useState<{
    title: string;
    code: string;
    hostName: string;
    isLive: boolean;
  } | null>({
    title: 'Design Critique & UI Motion Specs',
    code: 'arch-402-991',
    hostName: 'Mike Chen',
    isLive: true,
  });

  // Notification Banner Toast State
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'info';
  } | null>(null);

  const showToast = (message: string, type: 'success' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSidebarTabChange = (tab: SidebarTab) => {
    setActiveTab(tab);
    if (tab === 'create') {
      setIsCreateOpen(true);
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

  const handleStartMeeting = (meeting: MeetingItem) => {
    setCurrentMeeting({
      title: meeting.title,
      code: meeting.code,
      hostName: meeting.hostName,
      isLive: true,
    });
    setActiveTab('home');
    showToast(`Connected to meeting room: ${meeting.code}`);
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
        onOpenJoin={() => setIsJoinOpen(true)}
        onOpenCreate={() => setIsCreateOpen(true)}
        onOpenAuth={(mode) => setAuthModalState({ isOpen: true, mode })}
        onLogout={() => {
          setUser(null);
          showToast('Signed out successfully.');
        }}
      />

      <div className="flex-1 flex w-full overflow-hidden">
        {/* Fixed Left Sidebar */}
        <Sidebar activeTab={activeTab} setActiveTab={handleSidebarTabChange} />

        {/* Main Content Area */}
        <main className="flex-1 sm:pl-[72px] flex flex-col justify-between h-[calc(100vh-56px)] overflow-hidden">
          <div className="flex-1 flex flex-col justify-center overflow-y-auto py-2 sm:py-4">
            {/* Tab 1 & Tab 2: Home View */}
            {(activeTab === 'home' || activeTab === 'create') && (
              <Hero
                currentMeeting={currentMeeting}
                onJoinMeeting={() => setIsJoinOpen(true)}
                onCreateMeeting={() => setIsCreateOpen(true)}
                onLeaveMeeting={() => {
                  showToast('Left meeting call.');
                  setCurrentMeeting(null);
                }}
              />
            )}

            {/* Tab 3: Scheduled Meetings View */}
            {activeTab === 'scheduled' && (
              <ScheduledMeetingsView
                meetings={meetings}
                onStartMeeting={handleStartMeeting}
                onToggleFavorite={handleToggleFavorite}
                onDeleteMeeting={handleDeleteMeeting}
                onOpenCreateModal={() => setIsCreateOpen(true)}
              />
            )}

            {/* Tab 4: Favorites View */}
            {activeTab === 'favorite' && (
              <FavoritesView
                meetings={meetings}
                onStartMeeting={handleStartMeeting}
                onToggleFavorite={handleToggleFavorite}
                onOpenCreateModal={() => setIsCreateOpen(true)}
              />
            )}

            {/* Tab 5: Settings View */}
            {activeTab === 'settings' && (
              <SettingsView onShowToast={(msg) => showToast(msg)} />
            )}
          </div>

          {/* Footer */}
          <Footer />
        </main>
      </div>

      {/* Interactive Modals */}
      <JoinModal
        isOpen={isJoinOpen}
        onClose={() => setIsJoinOpen(false)}
        onJoinSuccess={(code, name) => {
          setCurrentMeeting({
            title: `Instant Meeting Room (${code})`,
            code,
            hostName: name,
            isLive: true,
          });
          setActiveTab('home');
          router.push(`/meet/${code}`);
          showToast(`Successfully joined room ${code} as ${name}`);
        }}
      />

      <ScheduleModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={(m) => {
          const newMeeting: MeetingItem = {
            id: `m_${Date.now()}`,
            title: m.title,
            code: m.code,
            time: m.time,
            participantsCount: 1,
            hostName: user?.name || 'You',
            isFavorite: false,
          };
          setMeetings((prev) => [newMeeting, ...prev]);
          setCurrentMeeting({
            title: m.title,
            code: m.code,
            hostName: user?.name || 'You',
            isLive: true,
          });
          setActiveTab('home');
          showToast(`Meeting "${m.title}" created! Code: ${m.code}`);
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <AuthModal
        isOpen={authModalState.isOpen}
        mode={authModalState.mode}
        onClose={() => setAuthModalState({ isOpen: false, mode: 'login' })}
        onSuccess={(email) => {
          setUser({
            name: email.split('@')[0],
            email,
            isLoggedIn: true,
          });
          showToast(`Signed in successfully as ${email}`);
        }}
      />
    </div>
  );
}
