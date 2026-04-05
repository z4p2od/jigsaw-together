# Agents

## Cursor Cloud specific instructions

### Overview

Jigsaw Together is a real-time multiplayer jigsaw puzzle web app. **Production** remains vanilla JS: plain ES modules under `js/` and Vercel serverless handlers under `api/`, with **no production build or bundler** (Vercel should keep the build command empty until you intentionally adopt Phase C).

**Local / CI** use **npm devDependencies** only: ESLint, Vitest, and TypeScript (`tsc --noEmit` on a small `types/` tree for now). This does not change how static assets are deployed.

### Running the dev server

The documented dev command is `npx vercel dev`, which serves static files **and** runs the Vercel serverless functions under `/api/*`. This requires Vercel CLI authentication (`vercel login` or a `VERCEL_TOKEN` env var).

For static-only serving (no API routes), you can use `http-server -p 3000 -c-1 --cors` from the workspace root. The standalone `/test-chaos.html` page works without API routes and is useful for testing chaos-mode puzzle mechanics.

### Quality checks (npm)

From the repo root (after `npm ci` or `npm install`):

- `npm run lint` — ESLint on `js/` (browser) and `api/` (Node)
- `npm run lint:fix` — auto-fix where supported
- `npm test` — Vitest unit tests (`test/*.test.js`), pure modules first (`jigsaw.js`, `mobile-quality.js`)
- `npm run typecheck` — `tsc --noEmit` (currently `types/` only; widen `tsconfig` when migrating files to `.ts`)

GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, lint, test, and typecheck on pushes and PRs to `main`.

### Environment variables

The app requires 12 environment variables for full functionality (see `README.md` > Environment Variables). Without these, API routes return `undefined` values and Firebase/Cloudinary integrations will not work. The landing page UI still renders.

### Key files

- `vercel.json` — URL rewrites (`/puzzle` → `/puzzle.html`, etc.) and cron schedules
- `api/*.js` — Vercel serverless functions (ESM `export default function handler`)
- `api/structured-log.js` — JSON-per-line `console.error` helper for function logs
- `api/client-error.js` — optional POST target for `js/client-observe.js` (truncated payloads, no PII)
- `js/firebase.js` — all Firebase read/write helpers; fetches config from `/api/config` at import time
- `js/jigsaw.js` — pure functions for edge generation and canvas-based piece cutting
- `js/client-observe.js` — registers `error` / `unhandledrejection` when `window.__JT_CLIENT_ERROR_ENDPOINT` is set

### `puzzle.js` split (future refactor)

`js/puzzle.js` is a large module. A practical split (same behavior, clearer boundaries) would be:

1. **Board / zoom** — scale, pan, viewport math, resize observers
2. **Pointer / drag** — pick, group drag, rotation gestures, snap helpers
3. **Firebase / sync** — subscriptions, writes, presence, timers
4. **UI** — modals, chat, loading overlay, help copy

Extract pure helpers into small modules first so Vitest can cover them without a browser harness.
