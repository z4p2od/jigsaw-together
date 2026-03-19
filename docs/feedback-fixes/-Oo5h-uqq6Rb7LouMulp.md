## Landing screen feedback auto-fix: write consistent identifiers

Fixed the landing page feedback submission flow so feedback records written to Firebase include stable identifiers (`id` / `feedbackId`) used for downstream doc naming, along with the required context (`screen` and `path`).

Why: the auto-fix/triage pipeline that turns feedback into PRs relies on `feedbackId` stored in the record (not the Firebase child key from `POST /feedback.json`) to generate the corresponding doc update under `docs/feedback-fixes/`.

