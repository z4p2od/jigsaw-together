export function withTimeout(promise, ms, label = 'operation') {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

export async function getImageDimensions(file, { timeoutMs = 8000 } = {}) {
  if (!(file instanceof Blob)) throw new Error('Expected a File/Blob');

  // Fast path where supported (avoids DOM Image decode quirks).
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await withTimeout(createImageBitmap(file), timeoutMs, 'image decode');
      return { width: bmp.width, height: bmp.height };
    } catch {
      // Fall through to Image() path.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await withTimeout(loadImage(url), timeoutMs, 'image load');
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

