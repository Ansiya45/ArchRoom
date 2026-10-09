import { test, expect } from '@playwright/test';

for (const resumeBeforeStop of [false, true]) {
  test(`recording excludes paused time and stops ${resumeBeforeStop ? 'after resuming' : 'while paused'}`, async ({ page }) => {
    await page.route('**/recording-harness', route => route.fulfill({
      contentType: 'text/html',
      body: `<div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import('/e2e/fixtures/recording-harness.tsx');
      </script>`,
    }));
    await page.goto('/recording-harness');
    await page.getByRole('button', { name: 'Start recording', exact: true }).click();
    const elapsed = page.getByTestId('elapsed');
    await expect.poll(async () => Number(await elapsed.textContent())).toBeGreaterThan(1000);
    await page.getByRole('button', { name: 'Pause recording', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resume recording', exact: true })).toBeVisible();
    const pausedAt = Number(await elapsed.textContent());
    await page.waitForTimeout(1500);
    await expect(elapsed).toHaveText(String(pausedAt));
    if (resumeBeforeStop) {
      await page.getByRole('button', { name: 'Resume recording', exact: true }).click();
      await expect.poll(async () => Number(await elapsed.textContent())).toBeGreaterThan(pausedAt + 1000);
      await page.getByRole('button', { name: 'Pause recording', exact: true }).click();
      const pausedAgain = await elapsed.textContent();
      await page.waitForTimeout(500);
      await expect(elapsed).toHaveText(pausedAgain!);
      await page.getByRole('button', { name: 'Resume recording', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
    const preview = page.getByTestId('preview');
    await expect(preview).toHaveText('Ready');
    expect(Number(await preview.getAttribute('data-size'))).toBeGreaterThan(0);
    expect(Number(await preview.getAttribute('data-duration')))
      .toBe(Math.max(1, Math.round(Number(await elapsed.textContent()) / 1000)));
    await expect(page.getByRole('button', { name: 'Pause recording', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Resume recording', exact: true })).toBeHidden();
  });
}
