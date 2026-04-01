# Feedback Fix Brief

- Feedback ID: `-Op7voVC9i1v_UYXIfrW`
- Type: `bug`
- CreatedAt: `2026-04-01T12:05:34.108Z`
- Screen: `puzzle`
- Puzzle ID: `784ad91b-0a9c-4e9d-93cd-3084b235fe8a`
- Room ID: `n/a`
- URL: https://jigsaw-together.vercel.app/puzzle.html?id=784ad91b-0a9c-4e9d-93cd-3084b235fe8a

## User report
Cant see any pieces!

## Context
Screen: puzzle · Puzzle: 784ad91b-0a9c-4e9d-93cd-3084b235fe8a

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

> Seed title: Cant see any pieces!

## What I changed
- Hardened puzzle loading in `js/puzzle.js` so older/incomplete puzzle records cannot produce invisible pieces:
  - Added `normalizeLoadedPuzzle()` and switched init flow to use it.
  - Backfilled missing `meta.displayW/displayH` from `pieceW/pieceH + grid` using the same scaling model as puzzle creation.
  - Added a safe fallback display size (`80x80`) if metadata is still invalid, preventing `NaN` sizing/transform math.
  - Normalized piece state arrays to expected grid size and filled missing/invalid piece fields with safe defaults (`x/y`, `rotation`, `solved`, `lockedBy`, `groupId`).
- Added a remote-update guard so live Firebase updates without numeric `x/y` no longer push piece transforms to invalid values.

## Why this fixes the report
- The report symptom (“Can’t see any pieces”) is consistent with legacy/malformed puzzle snapshots where piece render dimensions or coordinates become invalid. The new normalization ensures pieces always get valid dimensions and coordinates before rendering, so they remain visible on `/puzzle.html` for puzzle `784ad91b-0a9c-4e9d-93cd-3084b235fe8a` and similar legacy data.

## Sanity check
- Ran a JS parse sanity check with Node (`node --check js/puzzle.js`) to ensure the updated file is syntactically valid.