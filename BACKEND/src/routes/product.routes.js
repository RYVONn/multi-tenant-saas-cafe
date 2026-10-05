const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const controller = require('../controllers/product.controller');
const auth       = require('../middlewares/auth.middleware');
const requireRole = require('../middlewares/role.middleware');
const managers = requireRole('owner', 'manager', 'inventory_manager');

router.get('/',           auth.optional, controller.getProducts);
router.get('/categories', auth.optional, controller.getCategories);
router.get('/featured',   controller.getFeatured);
router.post('/publish-all', auth, managers, controller.publishAllDrafts);
router.get('/:id',        auth.optional, controller.getProductById);

const uploadMiddleware = (req, res, next) => {
  controller.upload.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ error: 'Image too large. Max 20MB.' });
    if (err) return res.status(400).json({ error: 'Invalid file.' });
    next();
  });
};

router.post('/',   auth, managers, uploadMiddleware, controller.createProduct);

// ← ده كان ناقص — سبب الـ 404
router.patch('/:id', auth, managers, uploadMiddleware, controller.updateProductImage);
router.put('/:id', auth, managers, uploadMiddleware, controller.updateProduct);

router.delete('/:id',         auth, managers, controller.deleteProduct);
router.patch('/:id/sizes',    auth, managers, controller.updateProductSizes);
router.patch('/:id/extras',   auth, managers, controller.updateProductExtras);
router.patch('/:id/featured', auth, managers, controller.toggleFeatured);
router.patch('/:id/status',   auth, managers, controller.updateStatus);

// ── Categories (create/delete straight into the `categories` table) ──────────
const categoryUploadMiddleware = (req, res, next) => {
  controller.uploadCategoryImage.single('image')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
      return res.status(400).json({ error: 'Image too large. Max 20MB.' });
    if (err) return res.status(400).json({ error: 'Invalid file.' });
    next();
  });
};

router.post('/categories',         auth, managers, categoryUploadMiddleware, controller.createCategory);
// Must come before '/categories/:id' — otherwise Express treats "reorder" as an :id
router.patch('/categories/reorder', auth, managers, controller.reorderCategories);
router.patch('/categories/:id/status', auth, managers, controller.updateCategoryStatus);
router.patch('/categories/:id',    auth, managers, categoryUploadMiddleware, controller.updateCategory);
router.delete('/categories/:id',   auth, managers, controller.deleteCategory);

module.exports = router;