<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c1890c77-143c-4fa4-bdfc-9385c7fe1e2c

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## End-to-end testing

Chromium smoke tests and future authentication fixture guidance are documented in [e2e/README.md](e2e/README.md). Run `npm run test:e2e` from this directory after installing the Playwright Chromium browser.

## Render deployment: direct meeting links

For the frontend Render Static Site, add this rule under Redirects/Rewrites:

| Source | Destination | Action |
| --- | --- | --- |
| `/*` | `/index.html` | Rewrite |

Keep any specific API proxy rules before this catch-all rule. The rewrite serves the React app for direct links such as `/meet/YLM-1234-ABC`, retaining the URL so React Router can resolve the meeting. Without it, Render can return Not Found before authentication runs.

Signed-out meeting visitors are sent to `/?join=<meetingCode>` with signup open. After signup and email verification, or login, they return to that meeting's waiting room. Signed-in visitors continue directly to the meeting. Deploy the frontend changes and configure the Render rule; changing application code alone does not configure the hosting service.

Reference: https://render.com/docs/redirects-rewrites
