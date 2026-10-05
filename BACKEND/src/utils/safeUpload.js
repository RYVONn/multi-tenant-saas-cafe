// Hardened multer factory for local-disk image uploads.
//  - image MIME types only
//  - 5 MB size limit
//  - extension chosen by the SERVER from the MIME type (never from the client filename)
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/gif':  '.gif',
};

function makeImageUpload(dir, { maxSizeMB = 5 } = {}) {
  const absDir = path.isAbsolute(dir) ? dir : path.join(__dirname, '..', '..', dir);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });

  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, absDir),
      filename: (_req, file, cb) =>
        cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT_BY_MIME[file.mimetype]}`),
    }),
    limits: { fileSize: maxSizeMB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) =>
      EXT_BY_MIME[file.mimetype] ? cb(null, true) : cb(new Error('Only image files are allowed (jpeg, png, webp, gif)')),
  });
}

module.exports = { makeImageUpload };
