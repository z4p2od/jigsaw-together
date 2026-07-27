# Feedback Fix Brief

- Feedback ID: `-OyZ2pjewPx4HHLbAnE3`
- Type: `bug`
- CreatedAt: `2026-07-27T14:51:37.591Z`
- Screen: `puzzle`
- Puzzle ID: `7fa8f1af-70dd-4e89-b946-80e04815918c`
- Room ID: `n/a`
- URL: https://www.pu8l.io/?id=7fa8f1af-70dd-4e89-b946-80e04815918c

## User report
two pieces are stack/ parented together but they dont match

## Context
Screen: puzzle · Puzzle: 7fa8f1af-70dd-4e89-b946-80e04815918c

## Fix checklist
- [x] Reproduce issue (confirm root cause)
- [x] Implement fix
- [x] Add/update tests where possible
- [x] Verify on affected screens
- [ ] Close out related feedback

---
Auto-seeded by `Jigsaw Together` feedback triage agent.

## What changed & why

On the reported hard-mode puzzle, pieces 82 and 83 shared a `groupId` but had
mismatched rotations (`180` vs `0`) and non-aligned positions — so they moved as
one parented group while the tabs/images clearly did not match (and could look
stacked after later group rotates).

Root cause: double-click / double-tap on a face-up piece called
`revealPiece({ correctRotation: true })`, which reassigned **one** piece’s
rotation (random quarter-turn in hard mode) while leaving it in the connected
group. Help text already said double-tap should rotate a piece **or group**.

Changes:
- Hard-mode double-click / double-tap now call `rotateAtIndex` so the whole
  connected group rotates together (co-op + VS).
- Face-down reveals inside a drag set use one shared target rotation so a group
  cannot be flipped into mixed orientations.
- On load, `sanitizePieceGroupIds` clears inconsistent / orphan `groupId`s and
  persists the repair; live rotation echoes that leave a group mixed also
  dissolve that group.
- Added `js/puzzle-groups.js` + Vitest coverage, including the live mismatched
  pair shape from puzzle `7fa8f1af-…`.

## Suggested next steps
- Start by checking the reported screen UI/state flow.
- Compare expected vs actual behavior and inspect snapping/locks if relevant.
- Confirm any regression around the last known change.

> Seed title: two pieces are stack/ parented together but they dont match
