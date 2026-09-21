/**
 * List Cloudinary images in puzzle-library.
 * Shared by /api/room-images and /api/admin seed (kept outside api/ for Hobby function count).
 */
const FOLDER = 'puzzle-library';

function normalize(f) {
  return String(f ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function isPuzzleLibraryResource(resource) {
  if (!resource) return false;
  const target = FOLDER;

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

async function searchResourcesByAssetFolder(cloudName, auth) {
  const expression = `resource_type:image AND asset_folder:${FOLDER}/*`;
  const resp = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/resources/search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ expression, max_results: 500 }),
    }
  );
  const text = await resp.text().catch(() => '');
  if (!resp.ok) throw new Error(`Cloudinary search failed: ${resp.status} ${text}`);
  const data = JSON.parse(text);
  return Array.isArray(data?.resources) ? data.resources : [];
}

async function fetchResourcesUploadPrefix(cloudName, auth, prefix) {
  const resp = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?prefix=${encodeURIComponent(prefix)}&max_results=500`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const text = await resp.text().catch(() => '');
  if (!resp.ok) throw new Error(`Cloudinary upload listing failed: ${resp.status}`);
  const data = JSON.parse(text);
  return Array.isArray(data?.resources) ? data.resources : [];
}

/**
 * @returns {Promise<Array<{ url: string, width: number, height: number, publicId: string }>>}
 */
export async function listPuzzleLibraryImages() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return [];

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

  let resources = [];
  try {
    resources = await searchResourcesByAssetFolder(cloudName, auth);
  } catch {
    try {
      resources = await fetchResourcesUploadPrefix(cloudName, auth, `${FOLDER}/`);
      if (resources.length === 0) {
        resources = await fetchResourcesUploadPrefix(cloudName, auth, FOLDER);
      }
    } catch {
      resources = [];
    }
  }

  return (resources || [])
    .filter(isPuzzleLibraryResource)
    .filter((img) => Boolean(img?.secure_url))
    .map((img) => ({
      url: img.secure_url,
      publicId: String(img.public_id || ''),
      width: typeof img?.width === 'number' ? img.width : Number(img?.width),
      height: typeof img?.height === 'number' ? img.height : Number(img?.height),
    }))
    .filter((img) => img.publicId && Number.isFinite(img.width) && Number.isFinite(img.height));
}
