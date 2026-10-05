/**
 * cloudinary.js
 *
 * Single source of truth for the Cloudinary SDK configuration.
 * Requires these env vars (see .env.example):
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 */

'use strict';

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.warn('[Cloudinary] Missing CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET in .env — image uploads will fail.');
}

/**
 * Best-effort delete of a previously uploaded image, given the public_id
 * multer-storage-cloudinary attached to req.file (exposed as `filename`).
 * Never throws — a failed cleanup should never break the main request.
 */
async function destroyByPublicId(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('[Cloudinary] destroy error:', err.message);
  }
}

/**
 * Recover a Cloudinary public_id from a stored secure_url, for old records
 * that only saved the URL (not the public_id) before this migration.
 * e.g. https://res.cloudinary.com/<cloud>/image/upload/v169.../bleu/products/abc123.jpg
 *   → bleu/products/abc123
 */
function publicIdFromUrl(url) {
  if (!url || !url.includes('res.cloudinary.com')) return null;
  try {
    const afterUpload = url.split('/upload/')[1]; // v169.../bleu/products/abc123.jpg
    if (!afterUpload) return null;
    const withoutVersion = afterUpload.replace(/^v\d+\//, '');
    return withoutVersion.replace(/\.[a-zA-Z0-9]+$/, '');
  } catch {
    return null;
  }
}

module.exports = { cloudinary, destroyByPublicId, publicIdFromUrl };
