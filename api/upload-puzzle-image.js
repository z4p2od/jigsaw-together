/**
 * Same-origin image upload → Cloudinary (server forwards the file).
 * In-app browsers (Instagram, Messenger, etc.) often block direct POSTs to api.cloudinary.com;
 * this route keeps the browser talking only to your deployment.
 *
 * Body: raw bytes. Content-Type should be the image MIME (e.g. image/jpeg).
 *
 * Max body size: PUZZLE_UPLOAD_MAX_BYTES or 4MB (fits Vercel Hobby request limits).
 */
function readBodyBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const ok = (buf) => {
      if (settled) return;
      settled = true;
      resolve(buf);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        fail(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { code: 'PAYLOAD_TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const preset = process.env.CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !preset) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const maxBytes = parseInt(process.env.PUZZLE_UPLOAD_MAX_BYTES || '4194304', 10);

  let buffer;
  try {
    buffer = await readBodyBuffer(req, maxBytes);
  } catch (e) {
    if (e.code === 'PAYLOAD_TOO_LARGE') {
      return res.status(413).json({
        error: `Image too large for upload (max ${Math.round(maxBytes / (1024 * 1024))}MB on this host). Try a smaller photo.`,
      });
    }
    return res.status(400).json({ error: 'Could not read upload body' });
  }

  if (!buffer || buffer.length === 0) {
    return res.status(400).json({ error: 'Empty body' });
  }

  const rawCt = req.headers['content-type'] || 'application/octet-stream';
  const contentType = String(rawCt).split(';')[0].trim().toLowerCase();
  const safeMime = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(contentType)
    ? contentType.replace('image/jpg', 'image/jpeg')
    : 'image/jpeg';

  const dataUri = `data:${safeMime};base64,${buffer.toString('base64')}`;
  const fd = new FormData();
  fd.append('upload_preset', preset);
  fd.append('file', dataUri);

  let cRes;
  try {
    cRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: fd,
    });
  } catch {
    return res.status(502).json({ error: 'Could not reach image storage' });
  }

  const data = await cRes.json().catch(() => ({}));
  if (!cRes.ok) {
    return res.status(cRes.status >= 400 && cRes.status < 600 ? cRes.status : 502).json({
      error: data.error?.message || 'Cloudinary upload failed',
    });
  }

  return res.status(200).json({
    secure_url: data.secure_url,
    public_id: data.public_id,
  });
}
