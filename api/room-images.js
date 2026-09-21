/**
 * Returns the list of available images from the puzzle-library Cloudinary folder.
 *
 * GET /api/room-images
 * Returns: [{ url, width, height, publicId }, ...]
 */
import { listPuzzleLibraryImages } from '../lib/puzzle-library.js';

export default async function handler(req, res) {
  try {
    const images = await listPuzzleLibraryImages();
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json(images);
  } catch (err) {
    console.error('room-images', err);
    return res.status(500).json({ error: 'Failed to list library images' });
  }
}
