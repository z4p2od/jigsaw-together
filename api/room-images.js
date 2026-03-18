/**
 * Returns the list of available images from the potd-pool Cloudinary folder.
 * Used by the image picker page (/play).
 *
 * GET /api/room-images
 * Returns: [{ url, width, height }, ...]
 */
export default async function handler(req, res) {
  const auth = Buffer.from(
    `${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`
  ).toString('base64');

  const r = await fetch(
    `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/resources/image/upload?folder=potd-pool&max_results=500`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const data = await r.json();
  const resources = data.resources || [];

  const images = resources.map(img => ({
    url:    img.secure_url,
    width:  img.width,
    height: img.height,
  }));

  res.setHeader('Cache-Control', 'public, max-age=300'); // 5-min cache
  res.json(images);
}
