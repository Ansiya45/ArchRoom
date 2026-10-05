import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { subscribeToSessionRemoval } from './lib/auth';
import { MeetingNotificationPreferences } from './components/MeetingNotificationPreferences';
import App from './App';
import { MeetingRoom } from './components/meeting/MeetingRoom';
import './app/globals.css';

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
      <Routes>
        <Route path="/meeting-notifications" element={<MeetingNotificationPreferences />} />
        <Route path="/" element={<App />} />
        <Route path="/meet/:meetingCode" element={<MeetingPage />} />
        <Route path="/meet" element={<MeetingPage />} />
        <Route path="*" element={<RouteMessage title="Page not found" message="This page does not exist." />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
