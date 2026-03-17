export default function handler(req, res) {
  res.json({
    cloudName:    process.env.CLOUDINARY_CLOUD_NAME,
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET,
  });
}
