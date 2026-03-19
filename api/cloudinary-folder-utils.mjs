/**
 * Cloudinary Admin API listing of resources uses "prefix" (not "folder") when
 * scoping assets. Unfortunately, even when we pass the correct prefix,
 * the response can still include unexpected resources depending on Cloudinary
 * settings and query parameters.
 *
 * To make the app resilient, we post-filter returned resources by the target
 * folder using any of: `folder`, `public_id` (which usually contains the
 * folder path), or the URL path.
 */

export function normalizeFolder(folder) {
  const f = folder == null ? '' : String(folder);
  // Trim leading/trailing slashes only; keep internal path segments intact.
  return f.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function isResourceInFolder(resource, folder) {
  const target = normalizeFolder(folder);
  if (!target) return false;

  const resFolder = normalizeFolder(resource?.folder);
  if (resFolder) {
    return resFolder === target || resFolder.startsWith(target + '/');
  }

  const publicId = String(resource?.public_id ?? '');
  if (publicId) {
    return publicId === target || publicId.startsWith(target + '/');
  }

  const url = String(resource?.secure_url ?? '');
  if (url) {
    return url.includes('/' + target + '/') || url.includes('/' + target);
  }

  return false;
}

export function filterResourcesByFolder(resources, folder) {
  const arr = Array.isArray(resources) ? resources : [];
  return arr.filter(r => isResourceInFolder(r, folder));
}

