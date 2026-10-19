type Segmentation = { setOptions(options: { modelSelection: number }): void; onResults(cb: (results: any) => void): void; send(input: { image: HTMLVideoElement }): Promise<void>; close?(): Promise<void> };

let scriptPromise: Promise<void> | null = null;
function loadSegmentation() {
  if (window.SelfieSegmentation) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js';
    script.async = true; script.onload = () => resolve(); script.onerror = () => reject(new Error('Unable to load background effects'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function createBackgroundVideoProcessor(background: 'blur' | 'office' | 'skyline' | 'studio') {
  let video: HTMLVideoElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let output: MediaStreamTrack | undefined;
  let segmentation: Segmentation | undefined;
  let frame = 0;
  let stopped = false;
  let processing = false;
  const processor: any = {
    name: 'ylaam-background-effects',
    processedTrack: undefined,
    async init({ track }: { track: MediaStreamTrack }) {
      video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = new MediaStream([track]);
      await video.play();
      canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const stream = canvas.captureStream(30); output = stream.getVideoTracks()[0]; processor.processedTrack = output;
      await loadSegmentation();
      const SegmentationConstructor = (window as any).SelfieSegmentation;
      segmentation = new SegmentationConstructor({ locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}` });
      const seg: Segmentation = segmentation!;
      seg.setOptions({ modelSelection: 1 });
      seg.onResults((results) => {
        if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return;
        const w = canvas.width, h = canvas.height; ctx.clearRect(0, 0, w, h);
        ctx.save(); ctx.filter = 'blur(16px)'; ctx.drawImage(video!, 0, 0, w, h); ctx.restore();
        const mask = document.createElement('canvas'); mask.width = w; mask.height = h; const maskCtx = mask.getContext('2d');
        if (!maskCtx) return; maskCtx.drawImage(results.segmentationMask, 0, 0, w, h); maskCtx.globalCompositeOperation = 'source-in'; maskCtx.drawImage(video!, 0, 0, w, h); ctx.drawImage(mask, 0, 0);
      });
      const tick = async () => { if (stopped) return; if (!processing && video && video.readyState >= 2) { processing = true; try { await seg.send({ image: video }); } finally { processing = false; } } frame = requestAnimationFrame(() => void tick()); };
      void tick();
    },
    async restart(opts: { track: MediaStreamTrack }) { await processor.destroy(); stopped = false; await processor.init(opts); },
    async destroy() { stopped = true; cancelAnimationFrame(frame); output?.stop(); output = undefined; processor.processedTrack = undefined; await segmentation?.close?.(); segmentation = undefined; video?.pause(); (video?.srcObject as MediaStream | null)?.getTracks().forEach((track: MediaStreamTrack) => track.stop()); video = undefined; canvas = undefined; },
  };
  return processor;
}
