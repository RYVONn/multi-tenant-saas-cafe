/**
 * image-path.util.js
 *
 * Single source of truth for upload path handling across ALL controllers.
 *
 * RULE: The database ALWAYS stores just the filename — never a full disk
 * path and never a URL.  The frontend reconstructs the full URL using
 * VITE_API_URL + /uploads/<folder>/<filename>.
 *
 * Usage (in any controller that receives req.file from Multer):
 *
 *   const { saveFilename } = require('../utils/image-path.util');
 *   const filename = saveFilename(req.file);   // null if no file
 *   // store `filename` in the DB field
 *
 * This fixes the two bugs that cause images to disappear:
 *  1. req.file.path stores the full disk path (e.g. /app/uploads/waste/1234.jpg).
 *     After redeployment the container root changes and the path is stale.
 *  2. Some controllers store "/uploads/folder/file.jpg" (a URL-style path).
 *     Others store "uploads/folder/file.jpg" (no leading slash).
 *     The frontend's URL builder was inconsistent about which prefix to strip.
 *
 * By storing ONLY the filename we make the URL construction explicit and
 * stable regardless of where the container mounts the uploads directory.
 */

'use strict';

const path = require('path');

/**
 * Extract just the base filename from a Multer file object.
 * Returns null when no file was uploaded so controllers can safely do:
 *   data: { image: saveFilename(req.file) }
 * without an extra null-check.
 *
 * @param {import('multer').File | undefined} multerFile
 * @returns {string | null}
 */
function saveFilename(multerFile) {
  if (!multerFile) return null;
  // multerFile.filename is set by diskStorage and is already just the basename.
  // multerFile.path  is the full disk path — we deliberately ignore it.
  return multerFile.filename ?? path.basename(multerFile.path);
}

/**
 * Build a public URL from a stored filename + folder name.
 * Used server-side when you need to return a full URL in a JSON response.
 *
 * @param {string | null | undefined} filename  - value stored in DB
 * @param {string} folder                       - e.g. 'waste', 'receipts'
 * @param {string} [baseUrl]                    - e.g. process.env.PUBLIC_URL
 * @returns {string | null}
 */
function buildUrl(filename, folder, baseUrl = '') {
  if (!filename) return null;
  // If someone accidentally stored a full URL already, return as-is.
  if (filename.startsWith('http://') || filename.startsWith('https://')) {
    return filename;
  }
  // Strip any accidental leading path segments — keep only the basename.
  const name = path.basename(filename);
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/uploads/${folder}/${name}`;
}

module.exports = { saveFilename, buildUrl };