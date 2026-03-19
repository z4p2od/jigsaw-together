/**
 * Returns the list of available images from the puzzle-library Cloudinary folder.
 * Used by the image picker page (/play).
 *
 * GET /api/room-images
 * Returns: [{ url, width, height }, ...]
 */
export default async function handler(req, res) {
  const auth = Buffer.from(
    `${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`
  ).toString('base64');

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const folder = 'puzzle-library';

  const target = String(folder);
  const normalize = (f) => String(f ?? '').replace(/^\/+/, '').replace(/\/+$/, '');

  function isResourceInPuzzleLibrary(resource) {
    if (!resource) return false;
    const resFolder = normalize(resource?.folder);
    if (resFolder) return resFolder === target || resFolder.startsWith(target + '/');

    const publicId = String(resource?.public_id ?? '');
    if (publicId) return publicId === target || publicId.startsWith(target + '/');

    const url = String(resource?.secure_url ?? '');
    if (url) return url.includes('/' + target + '/') || url.includes('/' + target);

    return false;
  }

  async function fetchResources(url) {
    const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    const text = await r.text().catch(() => '');
    try {
      const data = JSON.parse(text);
      const resources = data?.resources || [];
      return Array.isArray(resources) ? resources : [];
    } catch {
      return [];
    }
  }

  let resources = [];
  if (cloudName) {
    // IMPORTANT: only use `prefix` for scoping.
    // `folder=` isn't consistently honored by Cloudinary's resources listing,
    // which is why we were leaking non-puzzle-library images to `/play`.
    const prefixA = `${folder}/`;
    const prefixB = folder;
    resources = await fetchResources(
      `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?prefix=${encodeURIComponent(prefixA)}&max_results=500`
    );
    if (resources.length === 0) {
      resources = await fetchResources(
        `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?prefix=${encodeURIComponent(prefixB)}&max_results=500`
      );
    }
  }

  // Strict post-filtering: only puzzle-library resources should be exposed to /play.
  // If filtering results in 0, we return 0 (and /play will show "No images available"),
  // rather than leaking unrelated images.
  const filtered = (resources || []).filter(isResourceInPuzzleLibrary);

  console.log('room-images debug', {
    cloudName,
    fetched: resources.length,
    filtered: filtered.length,
    sample: resources[0]
      ? { public_id: resources[0].public_id, folder: resources[0].folder, url: resources[0].secure_url }
      : null,
  });

  const images = filtered
    // Some Cloudinary responses store width/height as strings.
    .filter(img => Boolean(img?.secure_url))
    .map(img => ({
      url: img.secure_url,
      width: typeof img?.width === 'number' ? img.width : Number(img?.width),
      height: typeof img?.height === 'number' ? img.height : Number(img?.height),
    }))
    .filter(img => Number.isFinite(img.width) && Number.isFinite(img.height));

  // Avoid browser caching masking changes while debugging.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json(images);
}
