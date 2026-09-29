import { recordingVideoBitrate } from '@/lib/recordingEncoding';
import { useCallback, useEffect, useRef, useState } from 'react';

export type RecordingPreview = {
  blob: Blob;
  url: string;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
  occurrenceId?: string;
};

function preferredMimeType() {
  const choices = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return choices.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

export function useScreenRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [preview, setPreview] = useState<RecordingPreview | null>(null);
  const previewRef = useRef<RecordingPreview | null>(null);
  const stopWaiters = useRef<Array<(preview: RecordingPreview | null) => void>>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  const stopTracks = useCallback(() => {
    streamsRef.current.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    streamsRef.current = [];
    if (audioContextRef.current) void audioContextRef.current.close().catch(() => {});
    audioContextRef.current = null;
  }, []);

  const stop = useCallback((): Promise<RecordingPreview | null> => {
    const recorder = recorderRef.current;
    generationRef.current += 1;
    if (!recorder) { stopTracks(); return Promise.resolve(previewRef.current); }
    return new Promise(resolve => {
      stopWaiters.current.push(resolve);
      if (recorder.state !== 'inactive') recorder.stop();
    });
  }, [stopTracks]);

  const start = useCallback(async (occurrenceId?: string) => {
    if (startingRef.current || recorderRef.current) return;
    if (previewRef.current) throw new Error('Save and discard the previous recording before starting another.');
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Screen recording is not supported in this browser. Use the latest Chrome or Edge.');
    }

    startingRef.current = true;
    const generation = generationRef.current;
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (generation !== generationRef.current) {
        display.getTracks().forEach(track => track.stop());
        return;
      }
      streamsRef.current = [display];
      let microphone: MediaStream | null = null;
      try {
        microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        // The host may continue with screen/system audio if microphone permission is denied.
      }
      if (generation !== generationRef.current) {
        microphone?.getTracks().forEach(track => track.stop());
        stopTracks();
        return;
      }
      if (microphone) streamsRef.current.push(microphone);
      if (display.getVideoTracks()[0]?.readyState !== 'live') throw new Error('Screen sharing ended before recording started.');

      const combined = new MediaStream(display.getVideoTracks());
      const audioTracks = [...display.getAudioTracks(), ...(microphone?.getAudioTracks() || [])];
      if (audioTracks.length === 1) combined.addTrack(audioTracks[0]);
      if (audioTracks.length > 1) {
        const context = new AudioContext();
        audioContextRef.current = context;
        await context.resume();
        if (generation !== generationRef.current) { stopTracks(); return; }
        const destination = context.createMediaStreamDestination();
        [display, microphone!].filter(Boolean).forEach((stream) => {
          if (stream.getAudioTracks().length) context.createMediaStreamSource(stream).connect(destination);
        });
        destination.stream.getAudioTracks().forEach((track) => combined.addTrack(track));
      }

      streamsRef.current = [display, ...(microphone ? [microphone] : []), combined];
      chunksRef.current = [];
      const mimeType = preferredMimeType();
      const videoBitsPerSecond = recordingVideoBitrate(mimeType, combined.getVideoTracks()[0].getSettings());
      const recorder = new MediaRecorder(combined, {
        ...(mimeType ? { mimeType } : {}),
        ...(videoBitsPerSecond ? { videoBitsPerSecond } : {}),
      });
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setRecordingMs(0);
      setIsRecording(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: (recorder.mimeType || 'video/webm').split(';')[0] });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const finished = { occurrenceId, blob, url: URL.createObjectURL(blob), fileName: `meeting-recording-${stamp}.webm`, mimeType: blob.type, durationSeconds };
        previewRef.current = finished;
        setPreview(finished);
        stopWaiters.current.splice(0).forEach(resolve => resolve(finished));
        recorderRef.current = null;
        chunksRef.current = [];
        setIsRecording(false);
        stopTracks();
      };
      display.getVideoTracks()[0].addEventListener('ended', () => void stop(), { once: true });
      recorder.start(1000);
    } catch (error) {
      recorderRef.current = null;
      setIsRecording(false);
      stopTracks();
      throw error;
    } finally {
      startingRef.current = false;
    }
  }, [stop, stopTracks]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setRecordingMs(Date.now() - startedAtRef.current), 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => () => {
    generationRef.current += 1;
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorderRef.current = null;
    }
    stopWaiters.current.splice(0).forEach(resolve => resolve(null));
    stopTracks();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
  }, [stopTracks]);

  useEffect(() => {
    if (!isRecording && !preview) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [isRecording, preview]);

  const clearPreview = useCallback(() => {
    previewRef.current = null;
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  return { isRecording, recordingMs, preview, start, stop, clearPreview };
}
