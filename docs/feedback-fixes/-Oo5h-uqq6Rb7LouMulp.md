## Landing screen feedback auto-fix: write consistent identifiers

Fixed the landing page feedback submission flow so feedback records written to Firebase include stable identifiers (`id` / `feedbackId`), along with the required context (`screen` and `path`).

Why: the auto-fix/triage pipeline that turns feedback into PRs relies on those fields to locate the correct feedback record and generate the corresponding doc update under `docs/feedback-fixes/`.

