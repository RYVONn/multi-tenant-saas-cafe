const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// Disable sharp cache to prevent memory leaks
sharp.cache(false);

// Create cache directory if it doesn't exist
const cacheDir = path.join(__dirname, '../../uploads/cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

router.get('/', async (req, res) => {
  try {
    const { src, w, q } = req.query;

    if (!src) {
      return res.status(400).json({ error: 'src parameter is required' });
    }

    // Sanitize and validate src path to prevent directory traversal
    const safeSrc = path.normalize(src).replace(/^(\.\.(\/|\\|$))+/, '');
    
    // Determine the absolute path of the original image
    // Note: Assuming src usually starts with '/uploads/'
    let originalPath;
    if (safeSrc.startsWith('/uploads/') || safeSrc.startsWith('uploads/')) {
      const relativePath = safeSrc.startsWith('/') ? safeSrc.slice(1) : safeSrc;
      originalPath = path.join(__dirname, '../../', relativePath);
    } else {
      return res.status(400).json({ error: 'Invalid src path' });
    }

    // Must stay inside the uploads directory (blocks ../ traversal)
    const uploadsRoot = path.resolve(__dirname, '../../uploads') + path.sep;
    if (!path.resolve(originalPath).startsWith(uploadsRoot)) {
      return res.status(400).json({ error: 'Invalid src path' });
    }

    if (!fs.existsSync(originalPath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Parse options
    // Clamp to a fixed set of widths / quality range so a client can't force
    // unbounded distinct variants into the disk cache.
    const ALLOWED_WIDTHS = [100, 200, 300, 400, 600, 800, 1000, 1200, 1600];
    const requestedW = w ? parseInt(w, 10) : null;
    const width = requestedW && requestedW > 0
      ? (ALLOWED_WIDTHS.find((a) => a >= requestedW) ?? ALLOWED_WIDTHS[ALLOWED_WIDTHS.length - 1])
      : null;
    const parsedQ = q ? parseInt(q, 10) : 80;
    const quality = Math.min(90, Math.max(40, Number.isFinite(parsedQ) ? parsedQ : 80));

    // We convert everything to webp for better compression
    const ext = '.webp';
    const filename = path.basename(originalPath, path.extname(originalPath));
    
    // Generate a unique cache filename based on options
    // Include a hash of the full relative path so same-named files in different folders don't collide
    const pathHash = require('crypto').createHash('sha1').update(path.relative(uploadsRoot, originalPath)).digest('hex').slice(0, 10);
    const cacheFilename = `${filename}_${pathHash}_w${width || 'auto'}_q${quality}${ext}`;
    const cachePath = path.join(cacheDir, cacheFilename);

    // Set aggressive cache headers
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', 'image/webp');

    // If cached version exists, serve it directly
    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      // Optional: Check if cache is older than original? 
      // Usually product images don't change without the filename changing (since multer adds timestamp).
      return res.sendFile(cachePath);
    }

    // Process image with sharp
    let transform = sharp(originalPath);

    if (width) {
      transform = transform.resize({
        width,
        withoutEnlargement: true, // Don't enlarge smaller images
        fit: 'cover',
      });
    }

    transform = transform.webp({ quality });

    // Stream to response and save to cache simultaneously
    // Actually, saving and then sending is safer to avoid incomplete cache files
    await transform.toFile(cachePath);
    
    return res.sendFile(cachePath);

  } catch (error) {
    console.error('Image optimization error:', error);
    res.status(500).json({ error: 'Failed to optimize image' });
  }
});

module.exports = router;
