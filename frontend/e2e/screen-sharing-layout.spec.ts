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
    if (count !== 2) expect(Math.abs(first!.width - first!.height)).toBeLessThan(2);
    if (count === 2) {
      const panel = await page.getByTestId('presentation-participants').evaluate(element => element.getBoundingClientRect().toJSON());
      const boxes = await tiles.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
      expect(Math.abs(boxes[0].x - boxes[1].x)).toBeLessThan(2);
      expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height);
      expect(boxes[0].width).toBeGreaterThan(panel.width * 0.95);
      expect(Math.abs(boxes[0].height - boxes[1].height)).toBeLessThan(2);
    }
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

test('three presentation participants use one large square above two smaller squares', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await renderGrid(page, 3);
  const boxes = await page.getByTestId('presentation-tile').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
  expect(boxes).toHaveLength(3);
  expect(Math.abs(boxes[0].width - boxes[0].height)).toBeLessThan(2);
  expect(Math.abs(boxes[1].width - boxes[1].height)).toBeLessThan(2);
  expect(Math.abs(boxes[2].width - boxes[2].height)).toBeLessThan(2);
  expect(boxes[0].width).toBeGreaterThan(boxes[1].width * 1.5);
  expect(Math.abs(boxes[1].y - boxes[2].y)).toBeLessThan(2);
});

test('speaker view pins a secondary participant as the main tile and exposes one pin button on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>;
    const reactModule = await load('/node_modules/.vite/deps/react.js');
    const React = reactModule.default ?? reactModule;
    const reactDomModule = await load('/node_modules/.vite/deps/react-dom_client.js');
    const { createRoot } = reactDomModule.default ?? reactDomModule;
    const { VideoGrid } = await load('/src/components/meeting/VideoGrid.tsx');
    const participants = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `Participant ${i + 1}`,
      avatar: '', role: i === 0 ? 'host' : 'attendee', isMuted: true, isCameraOn: false,
      isSpeaking: false, isHandRaised: false, isPinned: false, isScreenSharing: false,
      connectionQuality: 'good', audioLevel: 0 }));
    const host = document.createElement('div'); host.id = 'grid-test';
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '999', display: 'flex', width: '100vw', height: '100vh', background: '#0b1020', padding: '12px', boxSizing: 'border-box' });
    document.body.append(host);
    function Harness() {
      const [pinned, setPinned] = React.useState(null as string | null);
      return React.createElement(VideoGrid, { participants, activeSpeakerId: 'p0', pinnedParticipantId: pinned,
        layoutMode: 'speaker', onTogglePin: (id: string) => setPinned((current: string | null) => current === id ? null : id),
        onSelectSpeaker: () => {} });
    }
    createRoot(host).render(React.createElement(Harness));
  });
  const secondaryBoxes = await page.getByTestId('speaker-secondary-tile').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
  expect(secondaryBoxes).toHaveLength(3);
  expect(secondaryBoxes.every(box => Math.abs(box.width - box.height) < 2)).toBe(true);
  expect(secondaryBoxes[0].width).toBeGreaterThan(secondaryBoxes[1].width * 1.5);
  expect(Math.abs(secondaryBoxes[1].y - secondaryBoxes[2].y)).toBeLessThan(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const secondary = page.getByTestId('speaker-secondary-tile').filter({ has: page.getByText('Participant 4', { exact: true }) });
  const pin = secondary.getByRole('button', { name: 'Pin Participant 4' });
  await expect(pin).toBeVisible();
  await pin.click();
  await expect(page.getByTestId('speaker-main')).toHaveAttribute('data-participant-id', 'p3');
  await expect(page.getByTestId('speaker-main').getByRole('button', { name: 'Unpin Participant 4' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('speaker-main').getByRole('button')).toHaveCount(1);
});
