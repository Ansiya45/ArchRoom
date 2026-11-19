import { useCallback, useEffect, useRef, useState } from 'react';
import { createCompositeMeetingRecorder, type RecorderAudioInput, type RecorderTile } from '@/lib/compositeMeetingRecorder';
import { IncrementalDriveUpload, uploadSpooledToDrive } from '@/lib/incrementalDriveUpload';
import { checkDriveFolder, connectDrive, loadDrive, pickDriveFolder, type DriveConnection } from '@/lib/googleDriveRecording';
import {
  appendChunk, assembleSpoolBlob, createSpool, deleteSpool, getAllChunks, getSpool,
  listUnfinishedSpools, updateSpool, type SpooledRecording,
} from '@/lib/recordingSpool';
import { trpc } from '@/lib/trpc';
import type { RecordingPreview } from './useScreenRecorder';

const DRIVE_CONFIG = {
  clientId: import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID || '',
  apiKey: import.meta.env.VITE_GOOGLE_DRIVE_API_KEY || '',
  appId: import.meta.env.VITE_GOOGLE_DRIVE_APP_ID || '',
};
const DRIVE_CONFIGURED = Boolean(DRIVE_CONFIG.clientId && DRIVE_CONFIG.apiKey && DRIVE_CONFIG.appId);
const FOLDER_KEY = 'ylaam-drive-folder-id';

export function savedDriveFolderId() {
  try { return window.localStorage.getItem(FOLDER_KEY) || ''; } catch { return ''; }
}
export function storeDriveFolderId(id: string) {
  try { id ? window.localStorage.setItem(FOLDER_KEY, id) : window.localStorage.removeItem(FOLDER_KEY); } catch { /* storage unavailable */ }
}

export type DriveRecordingState =
  | 'unconfigured'   // VITE_GOOGLE_DRIVE_* not set; Drive path unavailable
  | 'no-folder'      // configured but no destination folder chosen yet
  | 'connecting'     // waiting for the host's Google sign-in
  | 'streaming'      // chunks are being uploaded during the call
  | 'finalizing'     // finishing the upload after stop
  | 'done'           // file exists in Drive and its link was saved to history
  | 'spooled'        // upload could not run; the full file is held on device
  | 'error';

export type RecoveryItem = SpooledRecording & { sizeLabel: string };

/**
 * Meeting recorder that (a) composites the actual room — all participant
 * video tiles plus mixed audio — instead of relying on a screen-share pick,
 * and (b) durably spools every chunk to IndexedDB while streaming them to
 * Google Drive, so a crash mid-call loses seconds rather than the recording.
 */
export function useMeetingRecorder(
  meetingCode: string,
  getTiles: () => RecorderTile[],
  getAudio: () => RecorderAudioInput,
) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [preview, setPreview] = useState<RecordingPreview | null>(null);
  const [driveState, setDriveState] = useState<DriveRecordingState>(DRIVE_CONFIGURED ? 'no-folder' : 'unconfigured');
  const [driveMessage, setDriveMessage] = useState('');
  const [recoveries, setRecoveries] = useState<RecoveryItem[]>([]);
  const [recoveryBusy, setRecoveryBusy] = useState('');

  const recorderRef = useRef<ReturnType<typeof createCompositeMeetingRecorder> | null>(null);
  const spoolIdRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const uploadRef = useRef<IncrementalDriveUpload | null>(null);
  const pendingRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const startingRef = useRef(false);
  const previewRef = useRef<RecordingPreview | null>(null);
  const occurrenceRef = useRef<string | undefined>(undefined);
  const connectionRef = useRef<DriveConnection | null>(null);

  const elapsedMs = useCallback(() => elapsedRef.current + (startedAtRef.current === null ? 0 : performance.now() - startedAtRef.current), []);

  const refreshRecoveries = useCallback(async () => {
    try {
      const items = await listUnfinishedSpools();
      setRecoveries(items.map(item => ({ ...item, sizeLabel: `${Math.max(1, Math.round(item.totalBytes / 1024 / 1024))} MB` })));
    } catch { /* IndexedDB may be unavailable; recovery is best-effort */ }
  }, []);

  useEffect(() => { void refreshRecoveries(); }, [refreshRecoveries]);

  // Preload the Google scripts so the OAuth popup still fires inside the
  // host's click gesture when recording starts.
  useEffect(() => { if (DRIVE_CONFIGURED) void loadDrive().catch(() => undefined); }, []);

  const spool = useCallback((blob: Blob) => {
    const spoolId = spoolIdRef.current;
    if (!spoolId) return;
    const seq = seqRef.current++;
    void appendChunk(spoolId, seq, blob).catch(() => setDriveMessage('Recording could not be saved on this device.'));
    const upload = uploadRef.current;
    if (upload && !upload.error) upload.push(blob);
    else pendingRef.current.push(blob);
  }, []);

  // Streams already-recorded bytes into Drive once the session exists, then
  // keeps streaming live chunks. Called from start() inside the host's click
  // gesture so the Google sign-in popup is allowed.
  const armDriveUpload = useCallback((spoolId: string, fileName: string, mimeType: string) => {
    if (!DRIVE_CONFIGURED) { setDriveState('unconfigured'); return; }
    const folderId = savedDriveFolderId();
    if (!folderId) { setDriveState('no-folder'); setDriveMessage('Choose a Google Drive folder once in Recordings to stream future recordings there automatically.'); return; }
    setDriveState('connecting');
    void (async () => {
      try {
        await loadDrive();
        const connection = await connectDrive(DRIVE_CONFIG);
        connectionRef.current = connection;
        const folder = await checkDriveFolder(connection, folderId).catch(() => null);
        if (!folder) { storeDriveFolderId(''); setDriveState('no-folder'); setDriveMessage('The saved Drive folder is no longer accessible. Pick it again in Recordings.'); return; }
        const upload = await IncrementalDriveUpload.open(connection, folder.id, fileName, mimeType);
        uploadRef.current = upload;
        await updateSpool(spoolId, { driveFileId: upload.targetFileId, driveFolderId: folder.id });
        pendingRef.current.splice(0).forEach(blob => upload.push(blob));
        setDriveState('streaming');
        setDriveMessage('');
      } catch (error) {
        // Recording continues spooling locally; the file can still be uploaded
        // from the preview after the meeting or recovered on the next visit.
        setDriveState('spooled');
        setDriveMessage(error instanceof Error ? error.message : 'Google Drive could not be reached. The recording is safe on this device and can be uploaded afterward.');
      }
    })();
  }, []);

  const start = useCallback(async (occurrenceId?: string) => {
    if (startingRef.current || recorderRef.current) return;
    if (previewRef.current) throw new Error('Save and discard the previous recording before starting another.');
    if (typeof MediaRecorder === 'undefined') throw new Error('Recording is not supported in this browser. Use the latest Chrome or Edge.');
    startingRef.current = true;
    try {
      // Build the recorder first so the spool and the Drive file name use the
      // container this browser actually produces (mp4 on Safari, webm elsewhere).
      const recorder = createCompositeMeetingRecorder({
        getTiles,
        getAudio,
        onChunk: spool,
        onError: message => setDriveMessage(message),
      });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const extension = recorder.mimeType.split(';')[0].endsWith('mp4') ? 'mp4' : 'webm';
      const fileName = `meeting-recording-${stamp}.${extension}`;
      const spoolRecord = await createSpool({ id: crypto.randomUUID(), meetingCode, occurrenceId, fileName, mimeType: recorder.mimeType, startedAt: Date.now() });
      spoolIdRef.current = spoolRecord.id;
      occurrenceRef.current = occurrenceId;
      seqRef.current = 0;
      pendingRef.current = [];
      recorderRef.current = recorder;
      // Fire the Drive connect inside the click gesture; it must not delay or
      // block the actual recording start.
      armDriveUpload(spoolRecord.id, fileName, recorder.mimeType);
      recorder.start();
      startedAtRef.current = performance.now();
      elapsedRef.current = 0;
      setRecordingMs(0);
      setIsPaused(false);
      setIsRecording(true);
    } catch (error) {
      recorderRef.current = null;
      throw error;
    } finally {
      startingRef.current = false;
    }
  }, [meetingCode, getTiles, getAudio, spool, armDriveUpload]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorder.pause();
    elapsedRef.current = elapsedMs();
    startedAtRef.current = null;
    setRecordingMs(elapsedRef.current);
    setIsPaused(true);
  }, [elapsedMs]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorder.resume();
    startedAtRef.current = performance.now();
    setIsPaused(false);
  }, []);

  const stop = useCallback(async (): Promise<RecordingPreview | null> => {
    const recorder = recorderRef.current;
    const spoolId = spoolIdRef.current;
    if (!recorder) return previewRef.current;
    await recorder.stop();
    recorderRef.current = null;
    elapsedRef.current = elapsedMs();
    startedAtRef.current = null;
    setIsRecording(false);
    setIsPaused(false);
    if (spoolId) await updateSpool(spoolId, { stoppedAt: Date.now() }).catch(() => undefined);
    const blob = spoolId ? await assembleSpoolBlob(spoolId) : null;
    if (!blob || !blob.size) { setDriveMessage('Nothing was captured. The recording is empty.'); return null; }
    const record = spoolId ? await getSpool(spoolId).catch(() => undefined) : undefined;
    const durationSeconds = Math.max(1, Math.round(elapsedRef.current / 1000));
    const finished: RecordingPreview = {
      blob, canonicalBlob: null, url: URL.createObjectURL(blob),
      fileName: record?.fileName || `meeting-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`,
      mimeType: record?.mimeType || blob.type, durationSeconds, occurrenceId: occurrenceRef.current,
    };
    previewRef.current = finished;
    setPreview(finished);
    const upload = uploadRef.current;
    uploadRef.current = null;
    if (upload && !upload.error) {
      setDriveState('finalizing');
      try {
        const result = await upload.finish();
        await updateSpool(spoolId!, { driveUrl: result.url, uploadedBytes: result.size }).catch(() => undefined);
        try {
          await trpc.recordings.saveDriveReference.mutate({ meetingCode, occurrenceId: occurrenceRef.current, url: result.url, fileName: finished.fileName });
          await updateSpool(spoolId!, { finalized: true }).catch(() => undefined);
          if (spoolId) await deleteSpool(spoolId).catch(() => undefined);
          setDriveState('done');
          setDriveMessage('Recording saved to Google Drive and linked in meeting history.');
        } catch {
          setDriveState('done');
          setDriveMessage('Recording is in Google Drive, but saving its link to meeting history failed. The Drive file is unaffected.');
          if (spoolId) await deleteSpool(spoolId).catch(() => undefined);
        }
      } catch (error) {
        setDriveState('spooled');
        setDriveMessage(error instanceof Error ? error.message : 'The Drive upload did not finish. The full recording is still on this device — upload it from the preview or after reloading.');
      }
    } else {
      setDriveState(current => (current === 'streaming' || current === 'finalizing') ? 'spooled' : current);
    }
    void refreshRecoveries();
    return finished;
  }, [elapsedMs, meetingCode, refreshRecoveries]);

  const clearPreview = useCallback(() => {
    const spoolId = spoolIdRef.current;
    spoolIdRef.current = null;
    previewRef.current = null;
    setPreview(current => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    if (spoolId) void deleteSpool(spoolId).then(refreshRecoveries).catch(() => undefined);
    setDriveState(DRIVE_CONFIGURED ? (savedDriveFolderId() ? 'no-folder' : 'no-folder') : 'unconfigured');
    setDriveMessage('');
  }, [refreshRecoveries]);

  // Recover a recording whose upload never finished (crash / closed tab):
  // replays the on-device chunks into a fresh Drive session.
  const resumeRecovery = useCallback(async (spoolId: string, folderId?: string) => {
    if (recoveryBusy) return;
    setRecoveryBusy(spoolId);
    try {
      const record = await getSpool(spoolId);
      if (!record) { setRecoveries(current => current.filter(item => item.id !== spoolId)); return; }
      await loadDrive();
      const connection = connectionRef.current && Date.now() < connectionRef.current.expiresAt
        ? connectionRef.current : await connectDrive(DRIVE_CONFIG);
      connectionRef.current = connection;
      let folder = folderId || record.driveFolderId || savedDriveFolderId();
      if (folder) {
        folder = (await checkDriveFolder(connection, folder).catch(() => null))?.id || '';
        if (!folder) storeDriveFolderId('');
      }
      if (!folder) {
        const picked = await pickDriveFolder(DRIVE_CONFIG, connection);
        if (!picked) throw new Error('Choose a Google Drive folder to upload the recovered recording.');
        storeDriveFolderId(picked.id);
        folder = picked.id;
      }
      await checkDriveFolder(connection, folder);
      const chunks = await getAllChunks(spoolId);
      if (!chunks.length) throw new Error('The saved recording is empty.');
      const fileName = record.fileName.replace(/\.(webm|mp4)$/i, '') + '-recovered.' + ((record.mimeType || '').includes('mp4') ? 'mp4' : 'webm');
      const result = await uploadSpooledToDrive(connection, folder, fileName, record.mimeType, chunks);
      try {
        await trpc.recordings.saveDriveReference.mutate({ meetingCode: record.meetingCode, occurrenceId: record.occurrenceId ?? undefined, url: result.url, fileName });
      } catch { /* the Drive file exists; the history link is best-effort */ }
      await updateSpool(spoolId, { finalized: true, driveUrl: result.url }).catch(() => undefined);
      await deleteSpool(spoolId).catch(() => undefined);
      await refreshRecoveries();
    } finally {
      setRecoveryBusy('');
    }
  }, [recoveryBusy, refreshRecoveries]);

  const downloadRecovery = useCallback(async (spoolId: string) => {
    const record = await getSpool(spoolId);
    const blob = await assembleSpoolBlob(spoolId);
    if (!blob) return;
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = record?.fileName || 'meeting-recording.webm';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 30_000);
  }, []);

  const discardRecovery = useCallback(async (spoolId: string) => {
    await deleteSpool(spoolId).catch(() => undefined);
    await refreshRecoveries();
  }, [refreshRecoveries]);

  useEffect(() => {
    if (!isRecording || isPaused) return;
    const timer = window.setInterval(() => setRecordingMs(elapsedMs()), 250);
    return () => window.clearInterval(timer);
  }, [isRecording, isPaused, elapsedMs]);

  // Warn before unloading while a recording or preview could still be lost.
  useEffect(() => {
    if (!isRecording && !preview && !recoveries.length) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [isRecording, preview, recoveries.length]);

  useEffect(() => () => {
    recorderRef.current?.stop();
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
  }, []);

  return {
    isRecording, isPaused, recordingMs, preview,
    start, pause, resume, stop, clearPreview,
    driveState, driveMessage,
    recoveries, recoveryBusy, resumeRecovery, downloadRecovery, discardRecovery,
  };
}
