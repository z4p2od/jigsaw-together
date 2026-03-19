# Feedback Fix Brief

- Feedback ID: `-Oo6Y6XuhUjgVAFaVJql`
- Type: `bug`
- CreatedAt: `2026-03-19T19:22:19.452Z`
- Screen: `landing`
- Puzzle ID: `n/a`
- Room ID: `n/a`
- URL: https://jigsaw-together-git-feat-vs-team-vs-team-z4p2ods-projects.vercel.app/

## User report
Bug menu, idea. and feedback have the. same text on :what happened" as bug

## Context
Screen: landing

## Fix checklist
- [ ] Reproduce issue (confirm root cause)
- [x] Implement fix
- [x] Add/update tests where possible
- [ ] Verify on affected screens
- [ ] Close out related feedback

## Summary of changes
- Updated `js/feedback.js` so the main textarea label and placeholder change based on the selected report type (Bug / Idea / Feedback) instead of always using the Bug wording.
- Added a pure helper (`js/feedback-copy.js`) with a small Node unit test (`js/feedback-copy.test.mjs`) to prevent regressions in the per-type copy.

---
Auto-seeded by `Jigsaw Together` feedback triage agent.

## Suggested next steps
- Start by checking the reported screen UI/state flow.
- Compare expected vs actual behavior and inspect snapping/locks if relevant.
- Confirm any regression around the last known change.

> Seed title: Bug menu, idea. and feedback have the. same text on :what happened" as bug