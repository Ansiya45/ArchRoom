import { test, expect } from './fixtures/auth-mock';
test('published background track keeps foreground and replacement visible across frames', async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route => route.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="blue"/></svg>' }));
  await page.goto('/');
  await page.evaluate(async () => {
    const w = window as any;
    const source = document.createElement('canvas'); source.width = 320; source.height = 180;
    const paint = () => { source.getContext('2d')!.fillStyle = 'red'; source.getContext('2d')!.fillRect(0, 0, 320, 180); w.paintFrame = requestAnimationFrame(paint); }; paint();
    w.source = source.captureStream(30);
    w.SelfieSegmentation = class {
      cb: any; setOptions() {} onResults(cb: any) { this.cb = cb; } async close() {}
      async send() { const mask = document.createElement('canvas'); mask.width = 320; mask.height = 180; const ctx = mask.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 160, 180); this.cb({ segmentationMask: mask }); }
    };
    const modulePath = '/src/lib/backgroundVideoProcessor.ts';
    const { createBackgroundVideoProcessor } = await import(/* @vite-ignore */ modulePath);
    w.processor = createBackgroundVideoProcessor('office');
    await w.processor.init({ track: w.source.getVideoTracks()[0] });
    const video = document.createElement('video'); video.id = 'published-output'; video.muted = true; video.autoplay = true; video.srcObject = new MediaStream([w.processor.processedTrack]); document.body.append(video); await video.play();
  });
  const sample = () => page.evaluate(() => { const video = document.querySelector<HTMLVideoElement>('#published-output')!; const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180; const ctx = canvas.getContext('2d')!; ctx.drawImage(video, 0, 0, 320, 180); return [ctx.getImageData(40, 90, 1, 1).data[0], ctx.getImageData(280, 90, 1, 1).data[2]]; });
  await expect.poll(sample).toEqual([255, 255]);
  await page.waitForTimeout(300);
  expect(await sample()).toEqual([255, 255]);
  await page.evaluate(async () => { const w = window as any; await w.processor.destroy(); cancelAnimationFrame(w.paintFrame); w.source.getTracks().forEach((track: MediaStreamTrack) => track.stop()); });
});
test('switching backgrounds retains the camera and restores original video', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const w = window as any;
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { default: React } = await load('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await load('/node_modules/.vite/deps/react-dom_client.js');
    const { CameraVideo } = await load('/src/components/meeting/CameraVideo.tsx');
    w.models = 0;
    w.SelfieSegmentation = class {
      constructor() { w.models++; }
      setOptions() {} onResults() {} async send() {} async close() {}
    };
    const source = document.createElement('canvas'); source.width = 320; source.height = 180;
    const ctx = source.getContext('2d')!;
    w.paint = (color: string) => { ctx.fillStyle = color; ctx.fillRect(0, 0, 320, 180); };
    w.paint('red');
    w.camera = source.captureStream(30);
    const host = document.createElement('div'); host.id = 'camera-test'; host.style.cssText = 'position:fixed;inset:0;width:640px;height:360px;z-index:9999'; document.body.append(host);
    const root = createRoot(host);
    w.selectBg = (bg: string) => root.render(React.createElement(CameraVideo, { isCameraOn: true, activeBg: bg, mediaStream: w.camera }));
    w.selectBg('none');
  });
  const video = page.locator('#camera-test video').last();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  for (const bg of ['blur', 'office', 'none', 'blur', 'none']) {
    await page.evaluate(bg => (window as any).selectBg(bg), bg);
    if (bg === 'none') {
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !!v.srcObject && v.readyState >= 2 && !v.paused)).toBe(true);
    } else {
      await expect.poll(() => page.locator('#camera-test canvas').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(c.width / 2, c.height / 2, 1, 1).data[0])).toBeGreaterThan(150);
    }
  }
  await page.evaluate(() => (window as any).paint('lime'));
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => {
    const c = document.createElement('canvas'); c.width = 10; c.height = 10;
    const ctx = c.getContext('2d')!; ctx.drawImage(v, 0, 0, 10, 10);
    return ctx.getImageData(5, 5, 1, 1).data[1];
  })).toBeGreaterThan(150);
  expect(await page.evaluate(() => (window as any).models)).toBe(1);
  expect(await page.evaluate(() => (window as any).camera.getVideoTracks()[0].readyState)).toBe('live');
});
