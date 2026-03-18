/**
 * Temporary debug endpoint — remove after debugging.
 * GET /api/debug-cloudinary
 */
export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET || process.env.POTD_SECRET;
  if (req.headers['authorization'] !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const auth = Buffer.from(
    `${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`
  ).toString('base64');
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;

  // 1. List all folders at root
  const foldersRes = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/folders`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const folders = await foldersRes.json();

  // 2. Try resources/image/upload with prefix=potd-pool
  const r1 = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/resources/image/upload?prefix=potd-pool&max_results=5`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const d1 = await r1.json();

  // 3. Try resources/image/upload with prefix=potd-pool/
  const r2 = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/resources/image/upload?prefix=potd-pool/&max_results=5`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const d2 = await r2.json();

  // 4. List first 5 images with no filter to see public_ids
  const r3 = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/resources/image/upload?max_results=5`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const d3 = await r3.json();

  // 5. Try folder= parameter
  const r4 = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/resources/image/upload?folder=potd-pool&max_results=5`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const d4 = await r4.json();

  // 6. Try the folders/{name}/resources endpoint
  const r5 = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/folders/potd-pool`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const d5 = await r5.json();

  res.json({
    folders: folders.folders || folders,
    prefix_no_slash: { total: d1.resources?.length, samples: d1.resources?.map(r => r.public_id) },
    prefix_with_slash: { total: d2.resources?.length, samples: d2.resources?.map(r => r.public_id) },
    all_first5: d3.resources?.map(r => r.public_id),
    folder_param: { total: d4.resources?.length, samples: d4.resources?.map(r => r.public_id) },
    folder_endpoint: d5,
  });
}
