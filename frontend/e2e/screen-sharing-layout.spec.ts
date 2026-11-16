import { test, expect } from '@playwright/test';

async function renderGrid(page: import('@playwright/test').Page, count: number, presenter = 0) {
  await page.goto('/');
  await page.evaluate(async ({ count, presenter }) => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>;
    const reactModule = await load('/node_modules/.vite/deps/react.js');
    const React = reactModule.default ?? reactModule;
    const reactDomModule = await load('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = reactDomModule.default ?? reactDomModule;
    const { VideoGrid } = await load('/src/components/meeting/VideoGrid.tsx');
    const participants = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Participant ${i + 1}`,
      avatar: '', role: i === presenter ? 'host' : 'attendee', isMuted: i !== presenter, isCameraOn: false,
      isSpeaking: false, isHandRaised: false, isPinned: false, isScreenSharing: i === presenter,
      connectionQuality: 'good', audioLevel: 0 }));
    const streams: Record<string, MediaStream> = {};
    const screenStreams: Record<string, MediaStream> = { [participants[presenter].id]: new MediaStream() };
    const host = document.createElement('div'); host.id = 'grid-test';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '999', width: '100vw', height: '100vh', background: '#0b1020', padding: '24px', boxSizing: 'border-box' });
    document.body.append(host);
    createRoot(host).render(React.createElement(VideoGrid, { participants, activeSpeakerId: participants[presenter].id,
      pinnedParticipantId: null, layoutMode: 'grid', onTogglePin: () => {}, onSelectSpeaker: () => {},
      remoteStreams: streams, remoteScreenStreams: screenStreams,
      remoteScreenShares: { [participants[presenter].id]: true } }));
  }, { count, presenter });
}

for (const count of [2, 3, 4, 6]) {
  test(`presentation layout shows all ${count} independent camera tiles`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await renderGrid(page, count);
    await expect(page.getByTestId('presentation-layout')).toBeVisible();
    await expect(page.getByTestId('presentation-tile')).toHaveCount(count);
    const tiles = page.getByTestId('presentation-tile');
    const first = await tiles.first().boundingBox();
    expect(first).not.toBeNull();
    expect(Math.abs(first!.width - first!.height)).toBeLessThan(2);
    if (count >= 5) await expect(page.getByTestId('presentation-participants')).toHaveCSS('overflow-y', 'auto');
    if (count === 4) {
      const metrics = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const stage = box('[data-testid="presentation-screen"]');
        const people = box('[data-testid="presentation-participants"]');
        const tile = box('[data-testid="presentation-tile"]');
        return { stageWidth: stage.width, peopleWidth: people.width, contentWidth: stage.width + people.width,
          tileWidth: tile.width, tileHeight: tile.height, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(metrics.peopleWidth / metrics.contentWidth).toBeGreaterThanOrEqual(0.30);
      expect(metrics.peopleWidth / metrics.contentWidth).toBeLessThanOrEqual(0.36);
      expect(metrics.stageWidth / metrics.contentWidth).toBeGreaterThanOrEqual(0.64);
      expect(metrics.tileWidth).toBeGreaterThanOrEqual(170);
      expect(Math.abs(metrics.tileWidth - metrics.tileHeight)).toBeLessThan(2);
      expect(metrics.overflow).toBe(false);
      await page.locator('#grid-test').screenshot({ path: 'test-results/screen-sharing-layout-c-1440x900.png' });
      console.log(`Layout C @1440x900: screen=${Math.round(metrics.stageWidth)}px, participants=${Math.round(metrics.peopleWidth)}px, tiles=${Math.round(metrics.tileWidth)}x${Math.round(metrics.tileHeight)}px`);
    }
  });
}

test('presentation and square participant tiles fit a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await renderGrid(page, 3);
  await expect(page.getByTestId('presentation-layout')).toBeVisible();
  const rect = await page.getByTestId('presentation-layout').evaluate(el => el.getBoundingClientRect().toJSON());
  expect(rect.width).toBeLessThanOrEqual(390);
  await expect(page.getByTestId('presentation-tile')).toHaveCount(3);
});
