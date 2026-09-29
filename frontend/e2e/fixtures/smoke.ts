import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ protectSmoke: void }>({
  protectSmoke: [async ({ context, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const forbidden: string[] = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const isAPI = url.pathname === '/api' || url.pathname.startsWith('/api/');
      const isDataRequest = ['xhr', 'fetch'].includes(request.resourceType());
      if (isAPI || isDataRequest || !['GET', 'HEAD'].includes(request.method())) {
        // Record only method/type, never URL query strings or request bodies.
        forbidden.push(`${request.method()} ${request.resourceType()}`);
        await route.abort('blockedbyclient');
      } else if (url.origin !== origin) {
        // Remote fonts/images are unnecessary for this UI smoke test.
        await route.abort('blockedbyclient');
      } else {
        await route.continue();
      }
    });
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url());
      // Permit only Vite's local hot-reload socket, never conferencing sockets.
      if (url.host === new URL(origin).host && url.pathname === '/') socket.connectToServer();
      else { forbidden.push('WebSocket'); socket.close(); }
    });
    await use();
    expect(forbidden, 'The logged-out smoke flow must not attempt API calls or mutations').toEqual([]);
  }, { auto: true }],
});
export { expect };
