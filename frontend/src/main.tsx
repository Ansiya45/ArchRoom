import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom';
import App from './App';
import { MeetingRoom } from './components/meeting/MeetingRoom';
import './app/globals.css';

function MeetingPage() {
  const { meetingCode = '' } = useParams<{ meetingCode: string }>();

  return <MeetingRoom meetingCode={meetingCode} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/meet/:meetingCode" element={<MeetingPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
