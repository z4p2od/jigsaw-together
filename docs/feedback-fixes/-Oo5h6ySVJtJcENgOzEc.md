# -Oo5h6ySVJtJcENgOzEc

Fixed the “Pick an Image” picker showing Cloudinary images that are *not* from the `puzzle-library` folder.

**What changed**
- Updated `/api/room-images` to list Cloudinary resources using the correct `prefix` filter for `puzzle-library`.
- Added a defensive server-side filter to ensure only assets belonging to `puzzle-library` are returned to `/play` even if the Cloudinary listing query is loose.

**Why**
- The picker relies on `/api/room-images`; with the previous Cloudinary listing/filtering, the endpoint could return images outside the intended library.
