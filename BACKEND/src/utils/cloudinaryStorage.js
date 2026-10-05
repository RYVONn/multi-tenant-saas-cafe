/**
 * cloudinaryStorage.js
 *
 * Factory for Multer storage engines that upload straight to Cloudinary
 * instead of the local disk. Replaces the old multer.diskStorage() pattern
 * used across product/category/offer image uploads.
 *
 * NOTE: we deliberately do NOT use the `multer-storage-cloudinary` npm
 * package — its latest release (v4) still declares a peer dependency on
 * cloudinary@^1.x, which conflicts with the cloudinary@^2.x SDK this
 * project uses (npm ERESOLVE). This file is a small, dependency-free
 * Multer storage engine that streams the upload directly to Cloudinary
 * using the official `cloudinary` package's upload_stream API — no extra
 * package needed.
 *
 * Usage:
 *   const { makeCloudinaryUpload } = require('../utils/cloudinaryStorage');
 *   exports.upload = makeCloudinaryUpload('bleu/products');
 *   // then, same as before:
 *   exports.upload.single('image')
 *
 * After upload, this sets on req.file:
 *   req.file.path      → the full secure_url (what we used to build manually)
 *   req.file.filename  → the Cloudinary public_id (needed to delete later)
 */

'use strict';

const multer = require('multer');
const { cloudinary } = require('./cloudinary');

class CloudinaryStorageEngine {
  constructor({ folder, transformation }) {
    this.folder = folder;
    this.transformation = transformation;
  }

  _handleFile(req, file, cb) {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: this.folder,
        transformation: this.transformation,
        resource_type: 'image',
      },
      (error, result) => {
        if (error) return cb(error);
        cb(null, {
          path: result.secure_url,   // full CDN URL — store this as image_url
          filename: result.public_id, // needed later for cloudinary.uploader.destroy()
          size: result.bytes,
        });
      }
    );

    file.stream.on('error', cb);
    file.stream.pipe(uploadStream);
  }

  _removeFile(req, file, cb) {
    if (!file.filename) return cb(null);
    cloudinary.uploader.destroy(file.filename, () => cb(null));
  }
}

/**
 * @param {string} folder     Cloudinary folder, e.g. 'bleu/products'
 * @param {object} [opts]
 * @param {number} [opts.maxSizeMB=20]
 */
function makeCloudinaryUpload(folder, opts = {}) {
  const maxSizeMB = opts.maxSizeMB ?? 20;

  const storage = new CloudinaryStorageEngine({
    folder,
    // Keeps huge phone-camera uploads from blowing up storage/CDN cost —
    // images are downscaled (never upscaled) on the way in.
    transformation: [{ width: 2000, height: 2000, crop: 'limit' }],
  });

  return multer({
    storage,
    limits: { fileSize: maxSizeMB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = /jpeg|jpg|png|webp/;
      const ext = file.originalname.split('.').pop()?.toLowerCase() || '';
      cb(null, allowed.test(ext));
    },
  });
}

module.exports = { makeCloudinaryUpload };
