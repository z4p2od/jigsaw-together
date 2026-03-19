# Feedback -Oo5gCxC2Id_zqNuiXAO

## Fix: “Pick an Image” showed images outside `puzzle-library`

The `/api/room-images` endpoint (used by the `/play` “Pick an Image” screen) listed Cloudinary assets using the wrong query parameter (`folder=`). Cloudinary’s Admin API scoping is `prefix=`, and the old call could return unexpected assets.

Changes:
- Updated `/api/room-images` (and the shared puzzle-image pool used by `/api/vs-create`) to list via Cloudinary `prefix=puzzle-library`.
- Added a strict post-filter to keep only assets that belong to the `puzzle-library` folder (by `folder`/`public_id`).
- Added `api/room-images-sanity.mjs` to sanity-check the filtering logic.

