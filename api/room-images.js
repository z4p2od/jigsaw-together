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

  // Default to “no filtering” if helper cannot be loaded in the current runtime.
  let filterResourcesByFolder = (resources) => Array.isArray(resources) ? resources : [];
  try {
    const mod = await import('./cloudinary-folder-utils.mjs');
    filterResourcesByFolder = mod?.filterResourcesByFolder || filterResourcesByFolder;
  } catch {
    // ignore
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
    // Try `folder` first (more intuitive), then `prefix` as a fallback.
    resources = await fetchResources(
      `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?folder=${encodeURIComponent(folder)}&max_results=500`
    );
    if (resources.length === 0) {
      resources = await fetchResources(
        `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?prefix=${encodeURIComponent(folder)}&max_results=500`
      );
    }
  }

  // Optional post-filtering for safety. If it filters everything out, fall back.
  let filtered = [];
  try {
    filtered = filterResourcesByFolder(resources, folder);
    if (!Array.isArray(filtered) || filtered.length === 0) filtered = resources;
  } catch {
    filtered = resources;
  }

  const images = filtered
    // Some Cloudinary responses store width/height as strings.
    .filter(img => Boolean(img?.secure_url))
    .map(img => ({
      url: img.secure_url,
      width: typeof img?.width === 'number' ? img.width : Number(img?.width),
      height: typeof img?.height === 'number' ? img.height : Number(img?.height),
    }))
    .filter(img => Number.isFinite(img.width) && Number.isFinite(img.height));

  res.setHeader('Cache-Control', 'public, max-age=300'); // 5-min cache
  res.json(images);
}
