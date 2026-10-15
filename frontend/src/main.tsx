import React, { lazy, Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { subscribeToSessionRemoval } from './lib/auth';
import App from './App';
import './app/globals.css';

const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy'));
const MeetingNotificationPreferences = lazy(() => import('./components/MeetingNotificationPreferences')
  .then(module => ({ default: module.MeetingNotificationPreferences })));
const MeetingRoom = lazy(() => import('./components/meeting/MeetingRoom')
  .then(module => ({ default: module.MeetingRoom })));

function PageFallback() {
  return <main role="status" className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
    <div className="flex items-center gap-3 font-semibold">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-300 border-t-transparent" aria-hidden="true" />
      Loading YLAAM Meet…
    </div>
  </main>;
}

function MeetingPage() {
  const { meetingCode = '' } = useParams<{ meetingCode: string }>();
  const code = meetingCode.trim().toUpperCase();
  const [sessionGeneration, setSessionGeneration] = useState(0);
  useEffect(() => subscribeToSessionRemoval(() => setSessionGeneration(value => value + 1)), []);
  // Accept current generated codes and the older grouped links already shared.
  if (!/^YLM-(?:[A-Z0-9]{6}|[A-Z0-9]{3,4}-[A-Z0-9]{3})$/.test(code)) {
    return <RouteMessage title="Invalid meeting link" message="The meeting code is missing or malformed. Ask the host for the complete meeting link." />;
  }
  if (meetingCode !== code) return <Navigate to={`/meet/${code}`} replace />;
  return <MeetingRoom key={`${code}:${sessionGeneration}`} meetingCode={code} />;
}

function RouteMessage({ title, message }: { title: string; message: string }) {
  return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 className="text-2xl font-bold">{title}</h1><p>{message}</p><a href="/" className="underline">Return home</a>
  </main>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/meeting-notifications" element={<MeetingNotificationPreferences />} />
          <Route path="/" element={<App />} />
          <Route path="/meet/:meetingCode" element={<MeetingPage />} />
          <Route path="/meet" element={<MeetingPage />} />
          <Route path="*" element={<RouteMessage title="Page not found" message="This page does not exist." />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);
