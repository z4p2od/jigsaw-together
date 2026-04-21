# Feedback Fix Brief

- Feedback ID: `-OqjT8C8JNkmz5qqX73o`
- Type: `bug`
- CreatedAt: `2026-04-21T09:56:47.828Z`
- Screen: `puzzle`
- Puzzle ID: `6f1a1421-fdb3-4cf9-a54a-22fd1ff6e2d0`
- Room ID: `n/a`
- URL: https://jigsaw-together-git-feat-mobile-gamepla-203887-z4p2ods-projects.vercel.app/puzzle.html?id=6f1a1421-fdb3-4cf9-a54a-22fd1ff6e2d0

## User report
When two or more pieces are connected together, but have the wrong rotation, when I try to rotate them they rotate individualy in a wrong way

## Context
Screen: puzzle · Puzzle: 6f1a1421-fdb3-4cf9-a54a-22fd1ff6e2d0

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

> Seed title: When two or more pieces are connected together, but have the wrong rotation, when I try to rotate them they rotate indiv

## What I changed
- Fixed group-rotation math so connected pieces rotate as one rigid body even if their stored rotations were inconsistent:
  - Added `js/puzzle-rotation.js` with pure helpers for 90-degree clockwise group rotation.
  - Updated `rotateAtIndex` in `js/puzzle.js` to rotate each piece by `+90` from its own current rotation (normalized), instead of forcing one shared absolute rotation value for the entire group.
  - Updated Firebase group rotation write path to accept and persist per-piece rotation values in the same batch as positions.

## Why this fixes the report
- The bug occurred when a connected group contained mixed/stale rotation values: rotating the group wrote one rotation for all pieces, which made pieces appear to rotate individually or drift into an incorrect orientation relationship.
- The new logic preserves each piece's relative orientation by applying a consistent quarter-turn to every piece and writing the per-piece result atomically with its new position.

## Tests / verification
- Added `test/puzzle-rotation.test.js` to cover the regression:
  - Verifies quarter-turn rotation keeps the group rigid while adding `+90` to each piece’s own rotation.
  - Verifies rotation normalization behavior (including negative/overflow inputs).
- Ran `npm test` successfully.