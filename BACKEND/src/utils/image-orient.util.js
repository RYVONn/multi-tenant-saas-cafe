/**
 * image-orient.util.js
 *
 * Fixes the "product image shows rotated/mirrored on the website" bug.
 *
 * Root cause: phone cameras save photos with the pixel data in landscape
 * orientation plus an EXIF "Orientation" tag telling viewers how to rotate
 * it for display. Multer just writes the raw bytes to disk — it never
 * looks at that tag. Most browsers respect EXIF orientation for <img>,
 * but not all paths do (canvas draws, some image proxies/resizers, older
 * browsers), so the image can appear rotated or mirrored depending on
 * where it's rendered.
 *
 * Fix: immediately after Multer saves the file, re-encode it through
 * sharp with `.rotate()` (no args) — this bakes the EXIF orientation
 * into the actual pixel data and strips the orientation tag, so every
 * consumer (browser, resizer, thumbnailer) now sees a normal, upright
 * image with no ambiguity.
 *
 * Usage (in any controller after req.file is saved by Multer):
 *
 *   const { normalizeOrientation } = require('../utils/image-orient.util');
 *   if (req.file) await normalizeOrientation(req.file.path);
 */

'use strict';

const sharp = require('sharp');
const fs = require('fs');

/**
 * Re-encodes an image file in place, baking in EXIF orientation so it
 * always displays upright regardless of viewer. Safe no-op on failure
 * (keeps original file rather than breaking the upload).
 *
 * @param {string | undefined | null} filepath - absolute/relative disk path to the saved image
 */
async function normalizeOrientation(filepath) {
  if (!filepath) return;

  const tmpPath = `${filepath}.orient.tmp`;

  try {
    // .rotate() with no args reads the EXIF Orientation tag and applies it,
    // then sharp strips the tag from the output since it's no longer needed.
    await sharp(filepath).rotate().toFile(tmpPath);
    fs.renameSync(tmpPath, filepath);
  } catch (err) {
    console.error('[image-orient] failed to normalize', filepath, err.message);
    // Clean up the tmp file if it was partially written
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

module.exports = { normalizeOrientation };
