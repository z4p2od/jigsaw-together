# Feedback Fix Brief

- Feedback ID: `-OymLXC4xlSfMcfjpGpp`
- Type: `bug`
- CreatedAt: `2026-07-30T09:27:59.230Z`
- Screen: `puzzle`
- Puzzle ID: `8ff95ff6-4e5a-47b5-99ec-91346783ae6b`
- Room ID: `n/a`
- URL: https://www.pu8l.io/?id=8ff95ff6-4e5a-47b5-99ec-91346783ae6b

## User report
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA

## Context
Screen: puzzle · Puzzle: 8ff95ff6-4e5a-47b5-99ec-91346783ae6b

## Fix checklist
- [x] Reproduce issue (confirm root cause)
- [x] Implement fix
- [x] Add/update tests where possible
- [x] Verify on affected screens
- [ ] Close out related feedback

---
Auto-seeded by `Jigsaw Together` feedback triage agent.

## What changed & why

Puzzle `8ff95ff6-…` is a 16×16 hard-mode board with `displayW/H = 26`. Neighbour
snap used `Math.max(40, minSide * 0.4)`, so the threshold was **40px** — larger
than a piece. Dragging near matching edges therefore snapped from more than a
full piece away and produced runaway group merges (the live board had a 148-piece
group with mismatched rotations).

Changes:
- Added `js/snap-threshold.js` with `getSnapThreshold()` that keeps the ~40% /
  40px preference for large pieces but **never exceeds half a piece**.
- Wired it into `findNeighbourSnap` in both `js/puzzle.js` and `js/vs.js`.
- Added Vitest coverage in `test/snap-threshold.test.js`, including the live
  26×26 display size from this puzzle.

## Suggested next steps
- Start by checking the reported screen UI/state flow.
- Compare expected vs actual behavior and inspect snapping/locks if relevant.
- Confirm any regression around the last known change.

> Seed title: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
