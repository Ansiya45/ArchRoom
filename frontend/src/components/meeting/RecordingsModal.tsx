import { RecordingPlayer } from './RecordingPlayer';
import React, { useCallback, useEffect, useState } from 'react';
import { CloudUpload, Download, Film, Loader2, X } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import type { RecordingPreview } from '@/hooks/useScreenRecorder';
import type { CompanyUploadStatus } from '@/hooks/useCompanyRecordingUpload';
import { CompanyRecordingUploadFeedback } from './CompanyRecordingUploadFeedback';

type SavedRecording = Awaited<ReturnType<typeof trpc.recordings.getForMeeting.query>>['recordings'][number];

interface RecordingsModalProps {
  isOpen: boolean;
  meetingCode: string;
  preview: RecordingPreview | null;
  onClose: () => void;
  onDiscardPreview: () => void;
  allowUpload?: boolean;
  localRecovery?: boolean;
  companyUploads?: CompanyUploadStatus[];
  onCompanyRetry?: (recordingId: string) => void;
  savedFolderId?: string | null;
  onCompanyUpload?: (folderId: string | null, saveForFuture: boolean) => void | Promise<void>;
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
  allowUpload = false,
  localRecovery = false,
  companyUploads = [],
  onCompanyRetry,
  savedFolderId = null,
  onCompanyUpload,
}) => {
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [companyUploadCapability, setCompanyUploadCapability] = useState<'checking' | 'available' | 'unavailable'>('checking');
  const [folderState, setFolderState] = useState<{ connected: boolean; folders: { id: string; name: string }[] } | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(savedFolderId);
  const [saveFolder, setSaveFolder] = useState(false);

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
    if (!isOpen) return;
    setSelectedFolderId(savedFolderId);
    setSaveFolder(false);
    let active = true;
    void trpc.recordingFolders.list.query()
      .then(result => { if (active) setFolderState({ connected: result.connected, folders: result.folders }); })
      .catch(() => { if (active) setFolderState({ connected: false, folders: [] }); });
    return () => { active = false; };
  }, [isOpen, savedFolderId]);

  useEffect(() => {
    if (!isOpen || !preview || !allowUpload) {
      setCompanyUploadCapability('unavailable');
      return;
    }
    const controller = new AbortController();
    setCompanyUploadCapability('checking');
    void trpc.recordings.companyUploadCapability.query(undefined, { signal: controller.signal })
      .then(result => setCompanyUploadCapability(result.available ? 'available' : 'unavailable'))
      .catch(() => {
        if (!controller.signal.aborted) setCompanyUploadCapability('unavailable');
      });
    return () => controller.abort();
  }, [allowUpload, isOpen, preview?.recordingId]);

  const downloadSaved = async (recordingId: string) => {
    try {
      const result = await trpc.recordings.downloadUrl.mutate({ recordingId });
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to download recording.');
    }
  };

  const currentUpload = preview ? companyUploads.find(status => status.recordingId === preview.recordingId) : undefined;
  const uploadBusy = Boolean(currentUpload && !['retryable_failure', 'unavailable', 'metadata_unavailable', 'manual_reconciliation'].includes(currentUpload.stage));
  const destinationLocked = Boolean(currentUpload?.jobId);
  const savedFolderMissing = Boolean(savedFolderId && folderState?.connected && !folderState.folders.some(folder => folder.id === savedFolderId));

  return (
    <div className={`${isOpen ? 'flex' : 'hidden'} fixed inset-0 z-[120] items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm`}>
      <div role="dialog" aria-modal="true" aria-label="Host recordings" className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Meeting recordings</h2>
            <p className="text-xs text-slate-500">Private host access Â· {meetingCode}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="Close recordings">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          <CompanyRecordingUploadFeedback statuses={companyUploads} onRetry={onCompanyRetry ?? (() => {})} />
          {preview && (
            <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
              <h3 className="mb-3 text-sm font-bold text-slate-900">Recording preview</h3>
              {localRecovery && <p className="mb-3 text-xs text-slate-600">{preview.fileName} · {meetingCode}{preview.occurrenceId ? ` · Session ${preview.occurrenceId}` : ''} · {preview.blob.size} bytes</p>}
              <p className="mb-3 text-xs text-slate-600">{companyUploads.length ? 'Company upload progress is shown above. ' : 'Upload uses the configured company recordings folder. '}Closing this dialog keeps the recording on this page; leaving or refreshing the page can lose it unless local recovery is enabled.</p>
              <RecordingPlayer src={preview.url} durationSeconds={preview.durationSeconds} />
              {allowUpload && <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                <label htmlFor="recording-upload-folder" className="block text-xs font-semibold text-slate-700">Company Drive destination</label>
                <select id="recording-upload-folder" value={selectedFolderId ?? ''} onChange={event => {
                  setSelectedFolderId(event.target.value || null);
                  setSaveFolder(false);
                }} disabled={!folderState?.connected || uploadBusy || destinationLocked}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-800 disabled:opacity-60">
                  <option value="">ylaam-meet-recording-sessions</option>
                  {savedFolderMissing && <option value={savedFolderId!}>Saved folder unavailable</option>}
                  {folderState?.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                {!folderState?.connected && <p className="mt-2 text-xs text-amber-700">Authorized company folders could not be loaded. Reconnect or verify Company Drive before uploading.</p>}
                {savedFolderMissing && selectedFolderId === savedFolderId && <p className="mt-2 text-xs text-red-700">The saved folder is unavailable. Choose another authorized folder; the recording will not be redirected automatically.</p>}
                {destinationLocked && <p className="mt-2 text-xs text-slate-600">This recording already has an upload job for its original folder. Its destination cannot be changed.</p>}
                {!savedFolderId && selectedFolderId && <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={saveFolder} onChange={event => setSaveFolder(event.target.checked)} /> Use this folder for future occurrences
                </label>}
              </div>}
              <div className="mt-4 flex flex-wrap gap-2">
                {allowUpload && onCompanyUpload && <button type="button" onClick={() => void onCompanyUpload(selectedFolderId, saveFolder || Boolean(savedFolderId && selectedFolderId !== savedFolderId))}
                  disabled={companyUploadCapability !== 'available' || !folderState?.connected || uploadBusy || destinationLocked || (savedFolderMissing && selectedFolderId === savedFolderId)}
                  className="flex items-center gap-2 rounded-[8px] bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><CloudUpload className="h-4 w-4" /> Upload to Drive</button>}
                <button onClick={() => { downloadLocal(preview); setMessage('Download requested. Verify the file was saved on your computer before discarding this copy.'); }} className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <Download className="h-4 w-4" /> Download to computer
                </button>
                {!allowUpload && <p className="text-xs text-slate-600">This incomplete recording may not play correctly. Download it for best-effort recovery.</p>}
                <button onClick={() => {
                  if (window.confirm('Discard this recording from this page? Download it or finish an upload first. This cannot be undone.')) onDiscardPreview();
                }} className="px-3 py-2 text-sm font-semibold text-slate-500 hover:text-red-600">Discard</button>
              </div>
              {allowUpload && companyUploadCapability === 'unavailable' && <p role="status" className="mt-3 text-xs text-slate-600">Company Drive uploads are currently unavailable.</p>}
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
