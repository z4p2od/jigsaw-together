# Feedback Fix Brief

- Feedback ID: `-Oo5kuCGEEdwLx9ZNM34`
- Type: `bug`
- CreatedAt: `2026-03-19T15:42:57.610Z`
- Screen: `vs`
- Puzzle ID: `n/a`
- Room ID: `936d6b35-ebe8-440b-bbca-2a3b1ba21705`
- URL: https://jigsaw-together-git-feature-feedback-widget-z4p2ods-projects.vercel.app/vs.html?room=936d6b35-ebe8-440b-bbca-2a3b1ba21705

## User report
When I'm waiting for an oponent and there are the icons of you vs the other initially I'm on the left side but when oponent joins it shows me on the right side. think it should be consistent

## Context
Screen: vs · Room: 936d6b35-ebe8-440b-bbca-2a3b1ba21705

## Fix checklist
- [ ] Reproduce issue (confirm root cause)
- [x] Implement fix
- [x] Add/update tests where possible
- [ ] Verify on affected screens
- [ ] Close out related feedback

## Fix summary
- Fixed VS lobby left/right consistency by removing reliance on `Object.keys(players)` ordering.
  - Added `getLobbySlotPids()` (`js/vs-lobby-slots.js`) to pin the current user (“you”) to lobby slot 0 (left) across Firebase snapshots.
- Added a small sanity/unit test (`js/vs-lobby-slots.test.mjs`) covering the “opponent inserted first” case that previously caused the avatar swap.

---
Auto-seeded by `Jigsaw Together` feedback triage agent.

## Suggested next steps
- Start by checking the reported screen UI/state flow.
- Compare expected vs actual behavior and inspect snapping/locks if relevant.
- Confirm any regression around the last known change.

> Seed title: When I'm waiting for an oponent and there are the icons of you vs the other initially I'm on the left side but when opon