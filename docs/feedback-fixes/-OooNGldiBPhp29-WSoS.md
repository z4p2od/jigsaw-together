# Feedback Fix Brief

- Feedback ID: `-OooNGldiBPhp29-WSoS`
- Type: `bug`
- CreatedAt: `2026-03-28T12:17:52.451Z`
- Screen: `landing`
- Puzzle ID: `n/a`
- Room ID: `n/a`
- URL: https://jigsaw-together.vercel.app/

## User report
When I try to upload an image and start on my mobile from messenger or watch app and not from dedicated browser it gets stuck on loading or creating puzzle. When I use safari it works though

## Context
Screen: landing

## Fix checklist
- [x] Reproduce issue (confirm root cause)
- [x] Implement fix
- [x] Add/update tests where possible
- [ ] Verify on affected screens
- [ ] Close out related feedback

## What changed
- **Avoid base64 re-encoding on landing**: `js/app.js` now keeps the original selected `File` and previews via `URL.createObjectURL()` instead of `FileReader` → canvas → base64. This prevents large in-memory strings that can stall iOS in-app browsers (Messenger/Watch webviews).
- **More robust image decoding**: added `js/image-utils.js` with `getImageDimensions()` using `createImageBitmap()` when available and a DOM `Image()` fallback, both with timeouts.
- **No more “stuck loading”**: added explicit timeouts around Cloudinary config fetch, Cloudinary upload, and Firebase `createPuzzle()` so failures surface as actionable errors.

## Sanity check
- Added `test-image-utils.html` to quickly verify `getImageDimensions()` works with a chosen photo (no base64 conversion).

---
Auto-seeded by `Jigsaw Together` feedback triage agent.

## Suggested next steps
- Start by checking the reported screen UI/state flow.
- Compare expected vs actual behavior and inspect snapping/locks if relevant.
- Confirm any regression around the last known change.

> Seed title: When I try to upload an image and start on my mobile from messenger or watch app and not from dedicated browser it gets 