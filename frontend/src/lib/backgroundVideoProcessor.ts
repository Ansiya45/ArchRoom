type Segmentation = { setOptions(options: { modelSelection: number }): void; onResults(cb: (results: any) => void): void; send(input: { image: HTMLVideoElement }): Promise<void>; close?(): Promise<void> };
let scriptPromise: Promise<void> | null = null;
function loadSegmentation() {
  if (window.SelfieSegmentation) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js'; script.async = true; script.onload = () => window.SelfieSegmentation ? resolve() : reject(new Error('Background effects unavailable')); script.onerror = () => reject(new Error('Unable to load background effects')); document.head.appendChild(script); });
  return scriptPromise;
}
const BACKGROUNDS: Record<string, string> = {
  office: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1280&auto=format&fit=crop&q=80',
  skyline: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1280&auto=format&fit=crop&q=80',
  studio: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1280&auto=format&fit=crop&q=80',
};
/** The processed canvas track is published through LiveKit, so remote tiles receive the same effect as the local preview. */
export function createBackgroundVideoProcessor(background: 'blur' | 'office' | 'skyline' | 'studio') {
  let video: HTMLVideoElement | undefined; let canvas: HTMLCanvasElement | undefined; let maskCanvas: HTMLCanvasElement | undefined; let output: MediaStreamTrack | undefined; let segmentation: Segmentation | undefined; let frame = 0; let stopped = false; let processing = false; let replacement: HTMLImageElement | undefined;
  const processor: any = { name: 'ylaam-background-effects', processedTrack: undefined,
    async init({ track }: { track: MediaStreamTrack }) {
      stopped = false; video = document.createElement('video'); video.muted = true; video.playsInline = true; video.autoplay = true; video.style.display = 'none'; video.srcObject = new MediaStream([track]); await video.play();
      canvas = document.createElement('canvas'); canvas.width = video.videoWidth || 1280; canvas.height = video.videoHeight || 720; maskCanvas = document.createElement('canvas'); maskCanvas.width = canvas.width; maskCanvas.height = canvas.height; output = canvas.captureStream(30).getVideoTracks()[0]; processor.processedTrack = output;
      if (background !== 'blur') { replacement = new Image(); replacement.crossOrigin = 'anonymous'; replacement.src = BACKGROUNDS[background]; try { await replacement.decode(); } catch { replacement = undefined; } }
      await loadSegmentation(); const Constructor = window.SelfieSegmentation; if (!Constructor) throw new Error('Background segmentation unavailable'); const seg = new Constructor({ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}` }); segmentation = seg; seg.setOptions({ modelSelection: 1 });
      seg.onResults((results: any) => { if (!canvas || !maskCanvas || !video || stopped) return; const ctx = canvas.getContext('2d'); const maskCtx = maskCanvas.getContext('2d'); if (!ctx || !maskCtx) return; const w = canvas.width, h = canvas.height; ctx.clearRect(0, 0, w, h); ctx.save(); if (replacement) ctx.drawImage(replacement, 0, 0, w, h); else { ctx.filter = 'blur(16px)'; ctx.drawImage(video, 0, 0, w, h); } ctx.restore(); maskCtx.globalCompositeOperation = 'source-over'; maskCtx.clearRect(0, 0, w, h); maskCtx.drawImage(results.segmentationMask, 0, 0, w, h); maskCtx.globalCompositeOperation = 'source-in'; maskCtx.drawImage(video, 0, 0, w, h); ctx.drawImage(maskCanvas, 0, 0); });
      const tick = async () => { if (stopped) return; if (!processing && video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) { processing = true; try { await segmentation?.send({ image: video }); } catch (error) { console.warn('[background-effects] frame failed', error); } finally { processing = false; } } frame = requestAnimationFrame(() => void tick()); }; void tick();
    },
    async restart(opts: { track: MediaStreamTrack }) { await processor.destroy(); await processor.init(opts); },
    async destroy() { stopped = true; cancelAnimationFrame(frame); output?.stop(); output = undefined; processor.processedTrack = undefined; await segmentation?.close?.(); segmentation = undefined; video?.pause(); if (video) video.srcObject = null; video = undefined; canvas = undefined; maskCanvas = undefined; replacement = undefined; },
  }; return processor;
}
