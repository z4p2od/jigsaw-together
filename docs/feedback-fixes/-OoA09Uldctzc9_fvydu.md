# Feedback Fix Brief

- Feedback ID: `-OoA09Uldctzc9_fvydu`
- Type: `bug`
- CreatedAt: `2026-03-20T11:32:27.429Z`
- Screen: `vs`
- Puzzle ID: `n/a`
- Room ID: `8fea6a3f-5c90-4098-b157-ed4553c15231`
- URL: https://jigsaw-together.vercel.app/vs.html?room=8fea6a3f-5c90-4098-b157-ed4553c15231

## User report
There is no way to go back from the VS Mode waiting screen.

## Context
Screen: vs · Room: 8fea6a3f-5c90-4098-b157-ed4553c15231

## Fix checklist
- [x] Reproduce issue (confirm root cause)
- [x] Implement fix
- [x] Add/update tests where possible
- [x] Verify on affected screens
- [x] Close out related feedback

---
Auto-seeded by `Jigsaw Together` feedback triage agent.

## Suggested next steps
- Start by checking the reported screen UI/state flow.
- Compare expected vs actual behavior and inspect snapping/locks if relevant.
- Confirm any regression around the last known change.

> Seed title: There is no way to go back from the VS Mode waiting screen.

## What I changed (and why)

- Added a “← Back” link to the VS waiting overlays in `/vs.html`:
  - `#vs-lobby` (1v1 waiting)
  - `#vs-team-lobby` (team waiting)
- The back link returns users to `/vs-rooms.html`, matching the existing back navigation pattern used on the rooms screen.
- Added small CSS styling for consistent placement (`.vs-lobby-back-link`).
- Added a Node sanity test (`js/vs-waiting-back.test.mjs`) to ensure the back links are present in `vs.html`, preventing this UI regression from reappearing.