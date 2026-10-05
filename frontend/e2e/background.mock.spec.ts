import { test, expect } from './fixtures/auth-mock';
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
