# Feedback Fix Brief

- Feedback ID: `-OyJ7p5P4o2vJNXnre_4`
- Type: `bug`
- CreatedAt: `2026-07-24T12:39:30.172Z`
- Screen: `puzzle`
- Puzzle ID: `510ed81e-c7ce-4a05-8f50-94c8c624298d`
- Room ID: `n/a`
- URL: https://www.pu8l.io/?id=510ed81e-c7ce-4a05-8f50-94c8c624298d

## User report
:((((((((((((((((((((((((( xalase.....

## Context
Screen: puzzle · Puzzle: 510ed81e-c7ce-4a05-8f50-94c8c624298d

## Fix checklist
- [x] Reproduce issue (confirm root cause)
- [x] Implement fix
- [x] Add/update tests where possible
- [x] Verify on affected screens
- [ ] Close out related feedback

---
Auto-seeded by `Jigsaw Together` feedback triage agent.

## What changed & why

The report (“χάλασε” / “it broke”) pointed at a shared home-shell puzzle URL for an
already-complete 16×16 hard puzzle. Opening `/?id=…` for a finished board never
ran completion reconciliation: `checkCompletion()` only fired on live snap/remote
solved events, so joiners saw a dead solved board (pieces `pointer-events: none`)
with no “Puzzle Complete!” banner. Separately, “Play another puzzle” set inline
`display:none` on `#celebration`, which permanently overrode `#celebration.show`
after the next solve.

Changes:
- Added `js/puzzle-completion.js` helpers (`isPuzzleComplete`, celebration
  show/reset, welcome CTA label) with Vitest coverage.
- After init, call `checkCompletion({ recordScore: false })` so already-complete
  puzzles show the banner without writing a new POTD score.
- Reset celebration via class + clearing inline styles on teardown / “Play
  another”; show clears stale inline hide before adding `.show`.
- Welcome CTA says “Open Puzzle” for shared `/?id=` links instead of
  “Play Today's Puzzle”.
- Module-load errors now unhide the play loading overlay / welcome status.

## Suggested next steps
- Start by checking the reported screen UI/state flow.
- Compare expected vs actual behavior and inspect snapping/locks if relevant.
- Confirm any regression around the last known change.

> Seed title: :((((((((((((((((((((((((( xalase.....
