import { preferredRecordingMimeType, recordingVideoBitrate, repairWebmBlob, RECORDING_AUDIO_BITRATE, RECORDING_FRAME_RATE } from '@/lib/recordingEncoding';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fixWebmDuration } from '@fix-webm-duration/fix';
import { LocalRecordingWriter } from '@/lib/localRecordingStore';
import { getStoredUser } from '@/lib/auth';
import { recordingFilename } from '@/lib/recordingFilename';
import { RecordingBackupWriter } from '@/lib/recordingBackup';
import { createMeetingRecordingSource, type MeetingRecordingInput } from '@/lib/meetingRecordingSource';

export type RecoverySetup = { ownerId: string; passphrase: string; meetingCode: string; verifyOwner: () => Promise<boolean> };
export type BackupSetup = { ownerId: string; meetingCode: string; meetingId?: string };

export type RecordingPreview = {
  blob: Blob;
  recordingId?: string;
  recordingStartedAt?: string;
  // Original finalized MediaRecorder bytes; preview metadata repair may differ.
  // Null means the recording was incomplete and must not be used for upload.
  canonicalBlob: Blob | null;
  url: string;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
  occurrenceId?: string;
};

export function useScreenRecorder(localStream: MediaStream | null = null, micOn = false, meetingTitle = 'Meeting', meetingTimeZone?: string | null,
  getMeetingInput?: () => MeetingRecordingInput) {
  const [localStatus, setLocalStatus] = useState('');
  const localWriterRef = useRef<LocalRecordingWriter | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef('');
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const microphoneRef = useRef({ localStream, micOn });
  microphoneRef.current = { localStream, micOn };
  const syncMicrophoneRef = useRef<(() => void) | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [preview, setPreview] = useState<RecordingPreview | null>(null);
  const previewRef = useRef<RecordingPreview | null>(null);
  const stopWaiters = useRef<Array<(preview: RecordingPreview | null) => void>>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const compositeRef = useRef<ReturnType<typeof createMeetingRecordingSource> | null>(null);

  const elapsedMs = useCallback(() => elapsedRef.current + (
    startedAtRef.current === null ? 0 : performance.now() - startedAtRef.current
  ), []);

  const freezeTimer = useCallback(() => {
    elapsedRef.current = elapsedMs();
    startedAtRef.current = null;
    setRecordingMs(elapsedRef.current);
  }, [elapsedMs]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== 'recording') return;
    recorder.pause();
    freezeTimer();
    setIsPaused(true);
  }, [freezeTimer]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== 'paused') return;
    recorder.resume();
    startedAtRef.current = performance.now();
    setIsPaused(false);
  }, []);

  const stopTracks = useCallback(() => {
    compositeRef.current?.close(); compositeRef.current = null;
    syncMicrophoneRef.current = null;
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
      if (!stoppingRef.current) {
        stoppingRef.current = true;
        setIsFinalizing(true);
        freezeTimer();
        if (recorder.state !== 'inactive') recorder.stop();
      }
    });
  }, [stopTracks, freezeTimer]);

  const start = useCallback(async (occurrenceId?: string, recovery?: RecoverySetup, backup?: BackupSetup) => {
    if (startingRef.current || recorderRef.current) return;
    if (previewRef.current) throw new Error('Save and discard the previous recording before starting another.');
    if ((!getMeetingInput && !navigator.mediaDevices?.getDisplayMedia) || typeof MediaRecorder === 'undefined') {
      throw new Error('Screen recording is not supported in this browser. Use the latest Chrome or Edge.');
    }

    startingRef.current = true;
    stoppingRef.current = false;
    errorRef.current = ''; setError('');
    const generation = generationRef.current;
    try {
      let combined: MediaStream;
      let display: MediaStream | null = null;
      if (getMeetingInput) {
        const source = createMeetingRecordingSource(getMeetingInput);
        compositeRef.current = source;
        combined = source.stream;
      } else {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: RECORDING_FRAME_RATE, max: 20 } }, audio: true });
      if (generation !== generationRef.current) {
        display.getTracks().forEach(track => track.stop());
        return;
      }
      streamsRef.current = [display];
      if (display.getVideoTracks()[0]?.readyState !== 'live') throw new Error('Screen sharing ended before recording started.');
      combined = new MediaStream(display.getVideoTracks());
      // Own only the display and mixed output. Never stop or modify LiveKit tracks.
      const context = new AudioContext();
      audioContextRef.current = context;
      await context.resume();
      if (generation !== generationRef.current) { stopTracks(); return; }
      const destination = context.createMediaStreamDestination();
      if (display.getAudioTracks().length) context.createMediaStreamSource(display).connect(destination);
      let microphoneSource: MediaStreamAudioSourceNode | null = null;
      let microphoneTrack: MediaStreamTrack | undefined;
      const gain = context.createGain();
      gain.connect(destination);
      syncMicrophoneRef.current = () => {
        const input = microphoneRef.current;
        const track = input.localStream?.getAudioTracks().find(track => track.readyState === 'live');
        gain.gain.value = input.micOn ? 1 : 0;
        if (track === microphoneTrack) return;
        microphoneSource?.disconnect();
        microphoneTrack = track;
        microphoneSource = track ? context.createMediaStreamSource(new MediaStream([track])) : null;
        microphoneSource?.connect(gain);
      };
      syncMicrophoneRef.current();
      destination.stream.getAudioTracks().forEach(track => combined.addTrack(track));
      streamsRef.current = [display, combined];
      }
      chunksRef.current = [];
      const mimeType = preferredRecordingMimeType(type => MediaRecorder.isTypeSupported(type));
      const videoBitsPerSecond = recordingVideoBitrate(mimeType, combined.getVideoTracks()[0].getSettings());
      const recorder = new MediaRecorder(combined, {
        ...(mimeType ? { mimeType } : {}),
        ...(videoBitsPerSecond ? { videoBitsPerSecond } : {}),
        ...(combined.getAudioTracks().length ? { audioBitsPerSecond: RECORDING_AUDIO_BITRATE } : {}),
      });
      const recordingId = crypto.randomUUID();
      const actualMime = (recorder.mimeType || 'video/webm').split(';')[0];
      const recordingStartedAt = new Date().toISOString();
      const fileName = recordingFilename(meetingTitle, meetingTimeZone, new Date(recordingStartedAt), recordingId, actualMime);
      let backupWriter: RecordingBackupWriter | null = null;
      let backupFailed = false;
      if (backup) {
        try {
          if (getStoredUser()?.id !== backup.ownerId) throw new Error('Account changed.');
          backupWriter = await RecordingBackupWriter.create({ id: recordingId, ownerId: backup.ownerId,
            meetingCode: backup.meetingCode, meetingId: backup.meetingId, meetingName: meetingTitle, occurrenceId, fileName, mimeType: actualMime, startedAt: recordingStartedAt },
          () => { backupFailed = true; setLocalStatus('Browser backup failed or storage is full. Keep this page open and download the recording.'); });
          setLocalStatus('Browser backup is active.');
        } catch { backupFailed = true; setLocalStatus('Browser backup is unavailable. Keep this page open and download the recording.'); }
      }
      let writer: LocalRecordingWriter | null = null;
      if (recovery) {
        try {
          if (!await recovery.verifyOwner() || getStoredUser()?.id !== recovery.ownerId) throw new Error('Account could not be verified.');
          writer = await LocalRecordingWriter.create(recovery.ownerId, recovery.passphrase,
            { meetingCode: recovery.meetingCode, occurrenceId, fileName, mimeType: actualMime, durationSeconds: 0, uploadRecordingId: recordingId, recordingStartedAt },
            () => setLocalStatus('Local recovery failed. Keep this page open and download the recording.'));
          if (getStoredUser()?.id !== recovery.ownerId) { writer.lock(); writer = null; setLocalStatus('Account changed. Local recovery was locked.'); }
          else { localWriterRef.current = writer; if (!backupFailed) setLocalStatus('Encrypted local recovery is active.'); }
        } catch {
          if (!backupFailed) setLocalStatus('Local recovery is unavailable. Keep this page open and download the recording.');
        } finally { recovery.passphrase = ''; }
      } else if (!backup) setLocalStatus('');
      if (generation !== generationRef.current) { writer?.lock(); stopTracks(); return; }
      recorderRef.current = recorder;
      startedAtRef.current = performance.now();
      elapsedRef.current = 0;
      setRecordingMs(0);
      setIsPaused(false);
      setIsRecording(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size) { chunksRef.current.push(event.data); writer?.append(event.data); backupWriter?.append(event.data); }
      };
      recorder.onerror = () => {
        errorRef.current = 'Recording failed. Any captured data will be offered for download; it may be incomplete.';
        setError(errorRef.current);
        void stop();
      };
      recorder.onstop = async () => {
        setIsFinalizing(true);
        freezeTimer();
        const durationSeconds = Math.max(1, Math.round(elapsedRef.current / 1000));
        if (backupWriter && !errorRef.current) {
          const saved = await backupWriter.finish(durationSeconds).catch(() => false);
          if (!saved) setLocalStatus('Browser backup is incomplete. Keep this page open and download the recording.');
        }
        const originalBlob = new Blob(chunksRef.current, { type: (recorder.mimeType || 'video/webm').split(';')[0] });
        // Fix Chromium WebM duration metadata only for the fallback format.
        const blob = originalBlob.type === 'video/webm'
          ? await repairWebmBlob(originalBlob, elapsedRef.current,
              (value, duration) => fixWebmDuration(value, duration, { logger: false }))
          : originalBlob;
        if (writer && recovery && !errorRef.current && blob.size) {
          const saved = await Promise.race([
            writer.finish({ meetingCode: recovery.meetingCode, occurrenceId, fileName, mimeType: blob.type || actualMime, durationSeconds, uploadRecordingId: recordingId, recordingStartedAt }),
            new Promise<false>(resolve => setTimeout(() => resolve(false), 15000)),
          ]);
          if (!saved) writer.lock();
          if (!backupFailed) setLocalStatus(saved ? 'Encrypted recording saved on this device.' : 'Local recovery could not be completed. Keep this page open and download the recording.');
          localWriterRef.current = null;
        } else if (writer) { writer.lock(); localWriterRef.current = null; setLocalStatus('The recording is incomplete. Its saved local chunks may be recoverable.'); }
        if (!mountedRef.current) return;
        if (!blob.size) {
          errorRef.current = 'No recording data was captured. Nothing was saved or uploaded.';
          setError(errorRef.current);
        }
        const finished = { occurrenceId, recordingId, recordingStartedAt, blob, canonicalBlob: errorRef.current ? null : originalBlob, url: URL.createObjectURL(blob), fileName, mimeType: blob.type, durationSeconds };
        previewRef.current = blob.size ? finished : null;
        if (!blob.size) URL.revokeObjectURL(finished.url);
        setPreview(previewRef.current);
        stopWaiters.current.splice(0).forEach(resolve => resolve(previewRef.current));
        recorderRef.current = null;
        chunksRef.current = [];
        setIsRecording(false);
        setIsPaused(false);
        setIsFinalizing(false);
        stoppingRef.current = false;
        stopTracks();
      };
      display?.getVideoTracks()[0]?.addEventListener('ended', () => void stop(), { once: true });
      recorder.start(2000);
    } catch (error) {
      if (localWriterRef.current) {
        localWriterRef.current.lock(); localWriterRef.current = null;
        setLocalStatus('Local recovery stopped because the recording could not start.');
      }
      recorderRef.current = null;
      setIsRecording(false);
      setIsPaused(false);
      stopTracks();
      throw error;
    } finally {
      startingRef.current = false;
    }
  }, [stop, stopTracks, freezeTimer, meetingTitle, meetingTimeZone, getMeetingInput]);

  useEffect(() => {
    if (!isRecording || isPaused) return;
    const timer = window.setInterval(() => setRecordingMs(elapsedMs()), 250);
    return () => window.clearInterval(timer);
  }, [isRecording, isPaused, elapsedMs]);

  useEffect(() => {
    syncMicrophoneRef.current?.();
    const sync = () => syncMicrophoneRef.current?.();
    localStream?.addEventListener('addtrack', sync);
    localStream?.addEventListener('removetrack', sync);
    return () => {
      localStream?.removeEventListener('addtrack', sync);
      localStream?.removeEventListener('removetrack', sync);
    };
  }, [localStream, micOn, isRecording]);

  useEffect(() => { mountedRef.current = true; return () => {
    mountedRef.current = false;
    localWriterRef.current?.lock();
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
  }; }, [stopTracks]);

  useEffect(() => {
    if (!isRecording && !preview) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [isRecording, preview]);

  const clearPreview = useCallback(() => {
    previewRef.current = null;
    errorRef.current = ''; setError('');
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  return { localStatus, lockLocalRecovery: () => { localWriterRef.current?.lock(); localWriterRef.current = null; setLocalStatus('Local recovery was locked. Keep this page open and download the recording.'); }, isFinalizing, error, hasRecording: () => Boolean(recorderRef.current || previewRef.current || startingRef.current || errorRef.current), isRecording, isPaused, recordingMs, preview, start, pause, resume, stop, clearPreview };
}
