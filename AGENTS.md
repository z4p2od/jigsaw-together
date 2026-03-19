# Agents

## Cursor Cloud specific instructions

### Overview

Jigsaw Together is a real-time multiplayer jigsaw puzzle web app. It is a vanilla JS project with **zero npm dependencies**, no `package.json`, no build step, and no bundler. Frontend code is plain ES modules served directly; Firebase SDK is loaded from CDN.

### Running the dev server

The documented dev command is `npx vercel dev`, which serves static files **and** runs the Vercel serverless functions under `/api/*`. This requires Vercel CLI authentication (`vercel login` or a `VERCEL_TOKEN` env var).

For static-only serving (no API routes), you can use `http-server -p 3000 -c-1 --cors` from the workspace root. The standalone `/test-chaos.html` page works without API routes and is useful for testing chaos-mode puzzle mechanics.

### Environment variables

The app requires 12 environment variables for full functionality (see `README.md` > Environment Variables). Without these, API routes return `undefined` values and Firebase/Cloudinary integrations will not work. The landing page UI still renders.

### No linter, no tests, no build

There are no automated tests, no linter configuration, and no build step. Code quality checks are limited to manual review. The `test-chaos.html` page is the closest thing to a test harness — it exercises the chaos-mode visual effects standalone.

### Key files

- `vercel.json` — URL rewrites (`/puzzle` → `/puzzle.html`, etc.) and cron schedules
- `api/*.js` — Vercel serverless functions (ESM `export default function handler`)
- `js/firebase.js` — all Firebase read/write helpers; fetches config from `/api/config` at import time
- `js/jigsaw.js` — pure functions for edge generation and canvas-based piece cutting
