/**
 * Returns the list of available images from the `puzzle-library` Cloudinary folder.
 * Used by the image picker page (/play).
 *
 * GET /api/room-images
 * Returns: [{ url, width, height }, ...]
 */
export default async function handler(req, res) {
  const auth = Buffer.from(
    `${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`
  ).toString('base64');

  // Cloudinary Admin API uses `prefix` (not `folder`) when listing resources.
  // We also defensively filter results by `public_id`/`secure_url` to ensure
  // `/play` never displays images outside `puzzle-library`.
  const expectedBase = 'puzzle-library';
  const expectedPrefix = `${expectedBase}/`;

  const r = await fetch(
    `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/resources/image/upload?prefix=${encodeURIComponent(expectedPrefix)}&max_results=500`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const data = await r.json();
  const resources = data.resources || [];

  const isPuzzleLibraryImage = (img) => {
    const publicId = String(img?.public_id || '');
    const secureUrl = String(img?.secure_url || '');
    if (publicId.startsWith(expectedPrefix)) return true;
    if (publicId === expectedBase) return true;
    // Fallback heuristics in case `public_id` format differs across setups.
    return secureUrl.includes(`/${expectedBase}/`) ||
      secureUrl.includes(expectedPrefix) ||
      secureUrl.includes(`/${expectedBase}`) ||
      secureUrl.includes(expectedBase);
  };

  const filtered = resources.filter(isPuzzleLibraryImage);
  if (filtered.length === 0 && resources.length > 0) {
    // If filtering removes everything, don't silently show the wrong library.
    // Returning an empty list will surface "No images available" in the UI.
    return res.json([]);
  }

  if (filtered.length !== resources.length) {
    console.warn(
      `[room-images] filtered Cloudinary resources to puzzle-library: ${resources.length} -> ${filtered.length}`
    );
  }

  const images = filtered.map(img => ({
    url: img.secure_url,
    width: img.width,
    height: img.height,
  }));

  res.setHeader('Cache-Control', 'public, max-age=300'); // 5-min cache
  res.json(images);
}
