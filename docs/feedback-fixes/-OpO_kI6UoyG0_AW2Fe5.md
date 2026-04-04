# Feedback Fix Brief

- Feedback ID: `-OpO_kI6UoyG0_AW2Fe5`
- Type: `bug`
- CreatedAt: `2026-04-04T17:42:42.352Z`
- Screen: `landing`
- Puzzle ID: `n/a`
- Room ID: `n/a`
- URL: https://www.pu8l.io/rooms

## User report
Cant find open room in the loby when someone created a puzzle

## Context
Screen: landing

## Fix checklist
- [x] Reproduce issue (confirm root cause)
- [x] Implement fix
- [x] Add/update tests where possible
- [x] Verify on affected screens
- [ ] Close out related feedback

---
Auto-seeded by `Jigsaw Together` feedback triage agent.

## What changed & why

On `/rooms`, the lobby list is populated by subscribing to `rooms-index` in Firebase RTDB.
The subscription was being registered immediately at module load, but the Firebase DB
instance (`_db`) is created asynchronously after `/api/config` returns. If the `/rooms`
page ran before `_db` was ready, the subscription could silently fail and the lobby would
stay empty even though a public room had been created.

I updated the room index subscription helper to wait for Firebase initialization before
attaching `onValue`, matching the already-hardened pattern used elsewhere in the file.
I also made the `/rooms` renderer tolerant of partially-populated index rows (e.g. missing
`imageUrl` or `solvedCount`) and extracted the “open rooms” selection into a small pure
helper with a standalone sanity-check page.

## Suggested next steps
- Start by checking the reported screen UI/state flow.
- Compare expected vs actual behavior and inspect snapping/locks if relevant.
- Confirm any regression around the last known change.

> Seed title: Cant find open room in the loby when someone created a puzzle