import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { getAuthToken } from './lib/auth';
import { MeetingNotificationPreferences } from './components/MeetingNotificationPreferences';
import App from './App';
import { MeetingRoom } from './components/meeting/MeetingRoom';
import './app/globals.css';

function MeetingPage() {
  const { meetingCode = '' } = useParams<{ meetingCode: string }>();

  if (!getAuthToken()) return <Navigate to={`/?join=${encodeURIComponent(meetingCode)}`} replace />;
  return <MeetingRoom meetingCode={meetingCode} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/meeting-notifications" element={<MeetingNotificationPreferences />} />
        <Route path="/" element={<App />} />
        <Route path="/meet/:meetingCode" element={<MeetingPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
