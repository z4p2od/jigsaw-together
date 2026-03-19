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

  const normalize = (f) => String(f ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
  const target = String(folder);

  function isPuzzleLibraryResource(resource) {
    if (!resource) return false;

    // Cloudinary search resources use `asset_folder` (per docs). Older listing uses `folder`.
    const af = normalize(resource?.asset_folder);
    if (af) return af === target || af.startsWith(target + '/');

    const f = normalize(resource?.folder);
    if (f) return f === target || f.startsWith(target + '/');

    const publicId = String(resource?.public_id ?? '');
    if (publicId) return publicId === target || publicId.startsWith(target + '/');

    const url = String(resource?.secure_url ?? '');
    if (url) return url.includes('/' + target + '/') || url.includes('/' + target);

    return false;
  }

  async function searchResourcesByAssetFolder() {
    // Admin Search API (more reliable than resources/image/upload with prefix/folder).
    // If your Cloudinary tier doesn't support this, it will throw and we'll fall back.
    const expression = `resource_type:image AND asset_folder:${target}/*`;
    const resp = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/resources/search`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          expression,
          max_results: 500,
        }),
      }
    );

    const text = await resp.text().catch(() => '');
    if (!resp.ok) throw new Error(`Cloudinary search failed: ${resp.status} ${text}`);

    const data = JSON.parse(text);
    return Array.isArray(data?.resources) ? data.resources : [];
  }

  async function fetchResourcesUploadPrefix(prefix) {
    const resp = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?prefix=${encodeURIComponent(prefix)}&max_results=500`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    const text = await resp.text().catch(() => '');
    if (!resp.ok) throw new Error(`Cloudinary upload listing failed: ${resp.status}`);

    const data = JSON.parse(text);
    return Array.isArray(data?.resources) ? data.resources : [];
  }

  let resources = [];
  try {
    if (cloudName) resources = await searchResourcesByAssetFolder();
  } catch (err) {
    // Fallback to the legacy upload listing endpoint (still strictly filtered below).
    try {
      const prefixA = `${folder}/`;
      const prefixB = folder;
      resources = await fetchResourcesUploadPrefix(prefixA);
      if (resources.length === 0) resources = await fetchResourcesUploadPrefix(prefixB);
    } catch (fallbackErr) {
      console.error('room-images fallback failed', { err, fallbackErr });
      resources = [];
    }
  }

  const filtered = (resources || []).filter(isPuzzleLibraryResource);

  console.log('room-images debug', {
    cloudName,
    fetched: resources.length,
    filtered: filtered.length,
    sample: resources[0]
      ? { public_id: resources[0].public_id, asset_folder: resources[0].asset_folder, folder: resources[0].folder, url: resources[0].secure_url }
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
