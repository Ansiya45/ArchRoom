import { useCallback, useEffect, useRef, useState } from 'react';

export type RecordingPreview = {
  blob: Blob;
  url: string;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
};

function preferredMimeType() {
  const choices = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return choices.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export function useScreenRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [preview, setPreview] = useState<RecordingPreview | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  const stopTracks = useCallback(() => {
    streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    streamsRef.current = [];
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Screen recording is not supported in this browser. Use the latest Chrome or Edge.');
    }

    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    let microphone: MediaStream | null = null;
    try {
      microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // The host may continue with screen/system audio if microphone permission is denied.
    }

    const combined = new MediaStream(display.getVideoTracks());
    const audioTracks = [...display.getAudioTracks(), ...(microphone?.getAudioTracks() || [])];
    if (audioTracks.length === 1) combined.addTrack(audioTracks[0]);
    if (audioTracks.length > 1) {
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      [display, microphone!].filter(Boolean).forEach((stream) => {
        if (stream.getAudioTracks().length) context.createMediaStreamSource(stream).connect(destination);
      });
      destination.stream.getAudioTracks().forEach((track) => combined.addTrack(track));
      combined.getVideoTracks()[0].addEventListener('ended', () => void context.close(), { once: true });
    }

    streamsRef.current = [display, ...(microphone ? [microphone] : []), combined];
    chunksRef.current = [];
    const mimeType = preferredMimeType();
    const recorder = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setRecordingMs(0);
    setIsRecording(true);

    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      setPreview({ blob, url: URL.createObjectURL(blob), fileName: `meeting-recording-${stamp}.webm`, mimeType: blob.type, durationSeconds });
      setIsRecording(false);
      stopTracks();
    };
    display.getVideoTracks()[0].addEventListener('ended', stop, { once: true });
    recorder.start(1000);
  }, [stop, stopTracks]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setRecordingMs(Date.now() - startedAtRef.current), 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => () => {
    stopTracks();
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview, stopTracks]);

  const clearPreview = useCallback(() => {
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  return { isRecording, recordingMs, preview, start, stop, clearPreview };
}
