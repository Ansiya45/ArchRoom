import { DriveRecordingUpload } from './DriveRecordingUpload';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CloudUpload, Download, Film, Loader2, X } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import type { RecordingPreview } from '@/hooks/useScreenRecorder';

type SavedRecording = Awaited<ReturnType<typeof trpc.recordings.getForMeeting.query>>['recordings'][number];

interface RecordingsModalProps {
  isOpen: boolean;
  meetingCode: string;
  preview: RecordingPreview | null;
  onClose: () => void;
  onDiscardPreview: () => void;
}

function downloadLocal(preview: RecordingPreview) {
  const anchor = document.createElement('a');
  anchor.href = preview.url;
  anchor.download = preview.fileName;
  anchor.click();
}

export const RecordingsModal: React.FC<RecordingsModalProps> = ({
  isOpen,
  meetingCode,
  preview,
  onClose,
  onDiscardPreview,
}) => {
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [savedPreview, setSavedPreview] = useState('');
  const uploadLock = useRef(false);
  const uploadAttempt = useRef<{ previewUrl: string; created: Awaited<ReturnType<typeof trpc.recordings.createUpload.mutate>>; transferred: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadRecordings = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await trpc.recordings.getForMeeting.query({ meetingCode });
      setRecordings(result.recordings);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load recordings.');
    } finally {
      setIsLoading(false);
    }
  }, [meetingCode]);

  useEffect(() => {
    if (isOpen) void loadRecordings();
  }, [isOpen, loadRecordings]);

  useEffect(() => {
    if (!isUploading && !driveBusy) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [isUploading, driveBusy]);

  const uploadPreview = async () => {
    if (!preview || uploadLock.current || driveBusy || savedPreview === preview.url) return;
    uploadLock.current = true;
    setIsUploading(true);
    setMessage(null);
    try {
      if (uploadAttempt.current?.previewUrl !== preview.url) {
        const created = await trpc.recordings.createUpload.mutate({
          meetingCode,
          occurrenceId: preview.occurrenceId,
          fileName: preview.fileName,
          mimeType: preview.mimeType || 'video/webm',
          fileSize: preview.blob.size,
          durationSeconds: preview.durationSeconds,
        });
        uploadAttempt.current = { previewUrl: preview.url, created, transferred: false };
      } else if (!uploadAttempt.current.transferred) {
        const retry = await trpc.recordings.retryUpload.mutate({ recordingId: uploadAttempt.current.created.recording.id });
        uploadAttempt.current.transferred = retry.transferred;
        if (retry.uploadUrl) uploadAttempt.current.created.uploadUrl = retry.uploadUrl;
      }
      const attempt = uploadAttempt.current;
      if (!attempt.transferred) {
        const body = new FormData();
        body.append('cacheControl', '3600');
        body.append('', preview.blob, preview.fileName);
        const response = await fetch(attempt.created.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body, signal: AbortSignal.timeout(300000) });
        if (!response.ok) throw new Error(`Supabase upload failed (${response.status}). Keep the recording and retry, or download it.`);
        attempt.transferred = true;
      }
      await trpc.recordings.complete.mutate({ recordingId: attempt.created.recording.id });
      setSavedPreview(preview.url);
      setMessage('Recording saved privately to Supabase.');
      await loadRecordings();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to upload recording.');
    } finally {
      uploadLock.current = false;
      setIsUploading(false);
    }
  };

  const downloadSaved = async (recordingId: string) => {
    try {
      const result = await trpc.recordings.downloadUrl.mutate({ recordingId });
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to download recording.');
    }
  };

  return (
    <div className={`${isOpen ? 'flex' : 'hidden'} fixed inset-0 z-[120] items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm`}>
      <div role="dialog" aria-modal="true" aria-label="Host recordings" className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Meeting recordings</h2>
            <p className="text-xs text-slate-500">Private host access Â· {meetingCode}</p>
          </div>
          <button disabled={isUploading || driveBusy} onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="Close recordings">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          {preview && (
            <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-900">Recording preview</h3>
              <p className="mb-3 text-xs text-slate-600">Choose where to save. Nothing uploads automatically. You can use more than one option; keep this page open until finished.</p>
              <video src={preview.url} controls className="aspect-video w-full rounded-xl bg-black" />
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => downloadLocal(preview)} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <Download className="h-4 w-4" /> Download to computer
                </button>
                <button onClick={() => void uploadPreview()} disabled={isUploading || driveBusy || savedPreview === preview.url} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60">
                  {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                  {isUploading ? 'Uploading...' : savedPreview === preview.url ? 'Uploaded to Supabase' : 'Upload to Supabase'}
                </button>
                <DriveRecordingUpload key={preview.url} preview={preview} meetingCode={meetingCode} disabled={isUploading} onBusyChange={setDriveBusy} />
                <button onClick={onDiscardPreview} disabled={isUploading || driveBusy} className="px-3 py-2 text-sm font-semibold text-slate-500 hover:text-red-600">Discard</button>
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-3 text-sm font-bold text-slate-900">Saved recordings</h3>
            {message && <p className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">{message}</p>}
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>
            ) : recordings.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 py-9 text-center text-sm text-slate-500">No recordings saved for this meeting yet.</div>
            ) : (
              <div className="space-y-2">
                {recordings.map((recording) => (
                  <div key={recording.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-3">
                    <div className="rounded-xl bg-blue-50 p-2 text-blue-600"><Film className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{recording.fileName}</p>
                      {recording.occurrenceId && <p className="text-xs text-slate-500">Room session: {recording.occurrenceId.slice(0, 8)}</p>}
                      <p className="text-xs text-slate-500">{Math.round((recording.fileSize || 0) / 1024 / 1024 * 10) / 10} MB Â· {recording.durationSeconds || 0}s</p>
                    </div>
                    <button onClick={() => void downloadSaved(recording.id)} className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">
                      <Download className="h-4 w-4" /> Download
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
