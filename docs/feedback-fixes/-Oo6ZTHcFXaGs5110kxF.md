# Feedback Fix Brief

- Feedback ID: `-Oo6ZTHcFXaGs5110kxF`
- Type: `bug`
- CreatedAt: `2026-03-19T19:28:14.669Z`
- Screen: `landing`
- Puzzle ID: `n/a`
- Room ID: `n/a`
- URL: https://jigsaw-together-git-feedback-oo6y6xu-auto-fix-z4p2ods-projects.vercel.app/

## User report
Feedback button doesn't open issues in github (maybe idea doesn't do as well)

## Context
Screen: landing

## What I changed (and why)
- Updated `api/feedback.js` so GitHub automation runs not only for `bug` submissions, but also for `idea` and `feedback` submissions. Previously, “Idea/Feedback” types never reached the GitHub issue creation branch, which meant the landing feedback button could fail to open issues in GitHub.
- Tweaked the GitHub issue title to match the report type (`Bug report` vs `Idea` vs `Feedback`) for clearer triage.

## Fix checklist
- [ ] Reproduce issue (confirm root cause)
- [x] Implement fix
- [x] Add/update tests where possible
- [ ] Verify on affected screens
- [ ] Close out related feedback

---
Auto-seeded by `Jigsaw Together` feedback triage agent.

## Suggested next steps
- Start by checking the reported screen UI/state flow.
- Compare expected vs actual behavior and inspect snapping/locks if relevant.
- Confirm any regression around the last known change.

> Seed title: Feedback button doesn't open issues in github (maybe idea doesn't do as well)