const { PrismaClient } = require('@prisma/client');
const { makeCloudinaryUpload } = require('../utils/cloudinaryStorage');
const { destroyByPublicId, publicIdFromUrl } = require('../utils/cloudinary');

const VALID_TEMPERATURES = ['hot', 'cold'];

const prisma = new PrismaClient();

// ── Upload config — images now go straight to Cloudinary ───────────────────────
// AZT: previously multer.diskStorage() wrote to uploads/products on local disk.
// Moved to Cloudinary so images survive redeploys and are served off their CDN.
// req.file.path     → full secure_url (use this as image_url, no more manual
//                      `${protocol}://${host}/uploads/...` string-building)
// req.file.filename → Cloudinary public_id (needed to delete the old image)
exports.upload = makeCloudinaryUpload('bleu/products');

// ── Upload config for category images ───────────────────────────────────────────
exports.uploadCategoryImage = makeCloudinaryUpload('bleu/categories');

// ── GET /api/products ──────────────────────────────────────────────────────────
// Returns all available products with their sizes and extras
exports.getProducts = async (req, res) => {
  try {
    const isAdmin = req.query.admin === 'true' && !!req.user; // staff only
    // AZT: a draft category hides everything inside it from customers, even
    // a product that is itself marked "published" — so building out a new
    // category doesn't leak its products before the category goes live.
    const whereClause = isAdmin
      ? { available: true }
      : { available: true, isActive: true, status: 'published', categories: { status: 'published' } };

    const products = await prisma.products.findMany({
      where: whereClause,
      include: {
        categories: true,
        sizes: { orderBy: { sort_order: 'asc' } },
        product_extras: {
          include: {
            extra: {
              include: { extra_category: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Flatten extras for easier frontend consumption
    const mapped = products.map(p => ({
      ...p,
      extras: p.product_extras.map(pe => pe.extra),
      product_extras: undefined,
    }));

    res.json(mapped);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

// ── GET /api/products/categories ──────────────────────────────────────────────
// Returns categories with their products (including sizes + extras)
exports.getCategories = async (req, res) => {
  try {
    const isAdmin = req.query.admin === 'true' && !!req.user; // staff only
    const whereClause = isAdmin
      ? { available: true }
      : { available: true, isActive: true, status: 'published' };

    const categories = await prisma.categories.findMany({
      // AZT: draft categories are dashboard-only — hidden from the customer
      // site entirely until you flip them to published.
      where: isAdmin ? undefined : { status: 'published' },
      include: {
        products: {
          where: whereClause,
          include: {
            sizes: { orderBy: { sort_order: 'asc' } },
            product_extras: {
              include: {
                extra: {
                  include: { extra_category: true },
                },
              },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });

    // Flatten extras
    const mapped = categories.map(cat => ({
      ...cat,
      products: cat.products.map(p => ({
        ...p,
        extras: p.product_extras.map(pe => pe.extra),
        product_extras: undefined,
      })),
    }));

    res.json(mapped);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
};

// ── GET /api/products/:id ──────────────────────────────────────────────────────
exports.getProductById = async (req, res) => {
  try {
    const isStaff = !!req.user;
    const product = await prisma.products.findFirst({
      where: {
        id: req.params.id,
        ...(isStaff ? {} : { available: true, isActive: true, status: 'published', categories: { status: 'published' } }),
      },
      include: {
        categories: true,
        sizes: { orderBy: { sort_order: 'asc' } },
        product_extras: {
          include: {
            extra: {
              include: { extra_category: true },
            },
          },
        },
      },
    });

    if (!product) return res.status(404).json({ message: 'Product not found' });

    res.json({
      ...product,
      extras: product.product_extras.map(pe => pe.extra),
      product_extras: undefined,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

// ── POST /api/products ────────────────────────────────────────────────────────
// Body: { name, category_id, description?, sizes: [{name, price, sort_order?}], extra_ids?: string[] }
// File: image (optional)
exports.createProduct = async (req, res) => {
  try {
    const { name, category_id, description, coming_soon, status, temperature } = req.body;

    if (!name || !category_id) {
      return res.status(400).json({ error: 'name and category_id are required' });
    }

    if (temperature && !VALID_TEMPERATURES.includes(temperature)) {
      return res.status(400).json({ error: "temperature must be 'hot' or 'cold'" });
    }

    // Parse sizes
    let sizes = [];
    try {
      sizes = typeof req.body.sizes === 'string'
        ? JSON.parse(req.body.sizes)
        : (req.body.sizes || []);
    } catch {
      return res.status(400).json({ error: 'Invalid sizes format' });
    }

    if (!Array.isArray(sizes) || sizes.length === 0) {
      return res.status(400).json({ error: 'At least one size with a price is required' });
    }

    // Parse extra_ids (optional)
    let extra_ids = [];
    try {
      extra_ids = typeof req.body.extra_ids === 'string'
        ? JSON.parse(req.body.extra_ids)
        : (req.body.extra_ids || []);
    } catch {
      extra_ids = [];
    }

    // req.file.path is the Cloudinary secure_url once uploaded
    const image_url = req.file ? req.file.path : null;

    const product = await prisma.products.create({
      data: {
        name,
        category_id,
        description: description || null,
        image_url,
        available: true,
        coming_soon: coming_soon === 'true' || coming_soon === true || false,
        status: status || 'published',
        temperature: temperature || null,
        sizes: {
          create: sizes.map((s, i) => ({
            name:       s.name,
            price:      Number(s.price),
            sort_order: s.sort_order ?? i,
          })),
        },
        product_extras: extra_ids.length > 0
          ? { create: extra_ids.map(extra_id => ({ extra_id })) }
          : undefined,
      },
      include: {
        sizes: { orderBy: { sort_order: 'asc' } },
        product_extras: { include: { extra: true } },
      },
    });

    res.status(201).json({
      ...product,
      extras: product.product_extras.map(pe => pe.extra),
      product_extras: undefined,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create product' });
  }
};

// ── PATCH /api/products/:id/sizes ─────────────────────────────────────────────
// Replace all sizes for a product (used from dashboard to edit sizes/prices)
// Body: { sizes: [{id?, name, price, sort_order?}] }
exports.updateProductSizes = async (req, res) => {
  try {
    const { id } = req.params;
    let sizes = [];
    try {
      sizes = typeof req.body.sizes === 'string'
        ? JSON.parse(req.body.sizes)
        : (req.body.sizes || []);
    } catch {
      return res.status(400).json({ error: 'Invalid sizes format' });
    }

    if (!Array.isArray(sizes) || sizes.length === 0) {
      return res.status(400).json({ error: 'At least one size is required' });
    }

    // Delete old sizes and recreate
    await prisma.$transaction([
      prisma.product_sizes.deleteMany({ where: { product_id: id } }),
      prisma.product_sizes.createMany({
        data: sizes.map((s, i) => ({
          product_id: id,
          name:       s.name,
          price:      Number(s.price),
          sort_order: s.sort_order ?? i,
        })),
      }),
    ]);

    const updated = await prisma.products.findUnique({
      where: { id },
      include: {
        sizes: { orderBy: { sort_order: 'asc' } },
        product_extras: { include: { extra: true } },
      },
    });

    res.json({
      ...updated,
      extras: updated.product_extras.map(pe => pe.extra),
      product_extras: undefined,
    });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    console.error(error);
    res.status(500).json({ error: 'Failed to update sizes' });
  }
};

// ── PATCH /api/products/:id/extras ────────────────────────────────────────────
// Replace extras assigned to a product
// Body: { extra_ids: string[] }
exports.updateProductExtras = async (req, res) => {
  try {
    const { id }       = req.params;
    const { extra_ids = [] } = req.body;

    await prisma.$transaction([
      prisma.product_extras.deleteMany({ where: { product_id: id } }),
      ...(extra_ids.length > 0
        ? [prisma.product_extras.createMany({
            data: extra_ids.map(extra_id => ({ product_id: id, extra_id })),
          })]
        : []),
    ]);

    const updated = await prisma.products.findUnique({
      where: { id },
      include: {
        sizes: { orderBy: { sort_order: 'asc' } },
        product_extras: { include: { extra: true } },
      },
    });

    res.json({
      ...updated,
      extras: updated.product_extras.map(pe => pe.extra),
      product_extras: undefined,
    });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    console.error(error);
    res.status(500).json({ error: 'Failed to update extras' });
  }
};

// ── DELETE /api/products/:id ───────────────────────────────────────────────────
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await prisma.products.findUnique({ where: { id } });
    if (product?.image_url) {
      await destroyByPublicId(publicIdFromUrl(product.image_url));
    }

    await prisma.products.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    res.status(500).json({ error: 'Failed to delete product' });
  }
};
// GET /api/products/featured
// ── GET /api/products/featured ────────────────────────────────────────────────
exports.getFeatured = async (req, res) => {
  try {
    const isAdmin = req.query.admin === 'true' && !!req.user; // staff only
    const whereClause = isAdmin 
      ? { is_featured: true, available: true } 
      : { is_featured: true, available: true, isActive: true, status: 'published' };

    const products = await prisma.products.findMany({
      where: whereClause,
      include: {
        categories: true,
        sizes: { orderBy: { sort_order: 'asc' } },
        product_extras: {
          include: {
            extra: { include: { extra_category: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json(products.map(p => ({
      ...p,
      extras: p.product_extras.map(pe => pe.extra),
      product_extras: undefined,
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch featured products' });
  }
};

// ── PATCH /api/products/:id/featured ──────────────────────────────────────────
exports.toggleFeatured = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await prisma.products.findUnique({ where: { id } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const updated = await prisma.products.update({
      where: { id },
      data: { is_featured: !product.is_featured },
    });

    res.json({ id: updated.id, is_featured: updated.is_featured });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to toggle featured' });
  }
};

// ── PATCH /api/products/:id/status ────────────────────────────────────────────
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const product = await prisma.products.findUnique({ where: { id } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const updated = await prisma.products.update({
      where: { id },
      data: { status },
    });

    res.json({ id: updated.id, status: updated.status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update status' });
  }
};

exports.publishAllDrafts = async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const drafts = await tx.products.findMany({
        where: { status: 'draft' },
        select: { id: true }
      });

      if (drafts.length === 0) {
        return { count: 0 };
      }

      const updateResult = await tx.products.updateMany({
        where: { status: 'draft' },
        data: { status: 'published' }
      });

      return { count: updateResult.count };
    });

    res.json({ success: true, count: result.count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to publish draft products' });
  }
};
exports.updateProductImage = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const oldProduct = await prisma.products.findUnique({ where: { id } });
    const image_url = req.file.path; // Cloudinary secure_url

    const product = await prisma.products.update({
      where: { id },
      data:  { image_url },
    });

    if (oldProduct && oldProduct.image_url) {
      await destroyByPublicId(publicIdFromUrl(oldProduct.image_url));
    }

    res.json({ id: product.id, image_url: product.image_url });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Product not found' });
    console.error('[products] updateProductImage error:', err);
    res.status(500).json({ error: 'Failed to update image' });
  }
};

// ── PUT /api/products/:id ──────────────────────────────────────────────────────
exports.updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category_id, description, isActive, status, is_featured, coming_soon, temperature } = req.body;

    if (temperature !== undefined && temperature !== '' && !VALID_TEMPERATURES.includes(temperature)) {
      return res.status(400).json({ error: "temperature must be 'hot' or 'cold'" });
    }

    let sizes = [];
    try {
      sizes = typeof req.body.sizes === 'string' ? JSON.parse(req.body.sizes) : (req.body.sizes || []);
    } catch {
      return res.status(400).json({ error: 'Invalid sizes format' });
    }

    let extra_ids = [];
    try {
      extra_ids = typeof req.body.extra_ids === 'string' ? JSON.parse(req.body.extra_ids) : (req.body.extra_ids || []);
    } catch {
      extra_ids = [];
    }

    const data = {};
    if (name) data.name = name;
    if (category_id) data.category_id = category_id;
    if (description !== undefined) data.description = description;
    if (isActive !== undefined) data.isActive = isActive === 'true' || isActive === true;
    if (is_featured !== undefined) data.is_featured = is_featured === 'true' || is_featured === true;
    if (status) data.status = status;
    if (coming_soon !== undefined) data.coming_soon = coming_soon === 'true' || coming_soon === true;
    if (temperature !== undefined) data.temperature = temperature || null;

    let oldImageUrl = null;
    if (req.file) {
      const oldProduct = await prisma.products.findUnique({ where: { id } });
      if (oldProduct && oldProduct.image_url) {
        oldImageUrl = oldProduct.image_url;
      }
      data.image_url = req.file.path; // Cloudinary secure_url
    }

    await prisma.$transaction([
      prisma.products.update({ where: { id }, data }),
      ...(sizes.length > 0 ? [
        prisma.product_sizes.deleteMany({ where: { product_id: id } }),
        prisma.product_sizes.createMany({
          data: sizes.map((s, i) => ({
            product_id: id,
            name: s.name,
            price: Number(s.price),
            sort_order: s.sort_order ?? i,
          })),
        })
      ] : []),
      prisma.product_extras.deleteMany({ where: { product_id: id } }),
      ...(extra_ids.length > 0 ? [
        prisma.product_extras.createMany({
          data: extra_ids.map(extra_id => ({ product_id: id, extra_id })),
        })
      ] : [])
    ]);

    const updated = await prisma.products.findUnique({
      where: { id },
      include: {
        sizes: { orderBy: { sort_order: 'asc' } },
        product_extras: { include: { extra: true } },
      },
    });
    if (oldImageUrl) {
      await destroyByPublicId(publicIdFromUrl(oldImageUrl));
    }

    res.json({
      ...updated,
      extras: updated.product_extras.map(pe => pe.extra),
      product_extras: undefined,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update product' });
  }
};
// ── POST /api/products/categories ─────────────────────────────────────────────
// Create a new category (name + optional image) — inserts straight into `categories`.
// Body: { name }, File: image (optional)
exports.createCategory = async (req, res) => {
  try {
    const { name, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (status !== undefined && !['draft', 'published'].includes(status)) {
      return res.status(400).json({ error: "status must be 'draft' or 'published'" });
    }

    const image_url = req.file ? req.file.path : null; // Cloudinary secure_url

    // New categories go to the end of the menu by default — reorder from
    // the dashboard afterwards if you want it somewhere else.
    const { _max } = await prisma.categories.aggregate({ _max: { sort_order: true } });
    const nextSortOrder = (_max.sort_order ?? -1) + 1;

    const category = await prisma.categories.create({
      data: {
        name: name.trim(),
        image_url,
        sort_order: nextSortOrder,
        // AZT: lets you build out a whole category of products before
        // showing it to customers — default is 'draft' so a freshly created
        // category doesn't go live until you explicitly publish it.
        status: status || 'draft',
      },
    });

    res.status(201).json({ ...category, products: [] });
  } catch (error) {
    console.error('[categories] createCategory error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
};

// ── PATCH /api/products/categories/reorder ────────────────────────────────────
// Body: { order: string[] }  — full list of category ids in the desired order.
// Sets sort_order = index in that array for each one.
exports.reorderCategories = async (req, res) => {
  try {
    const { order } = req.body;

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: 'order must be a non-empty array of category ids' });
    }

    await prisma.$transaction(
      order.map((id, index) =>
        prisma.categories.update({
          where: { id },
          data: { sort_order: index },
        })
      )
    );

    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'One of the category ids was not found' });
    console.error('[categories] reorderCategories error:', error);
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
};

// ── PATCH /api/products/categories/:id ────────────────────────────────────────
// Update a category's name and/or image.
// Body: { name? }, File: image (optional)
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, status } = req.body;

    const existing = await prisma.categories.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const data = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: 'name cannot be empty' });
      data.name = name.trim();
    }
    if (status !== undefined) {
      if (!['draft', 'published'].includes(status)) {
        return res.status(400).json({ error: "status must be 'draft' or 'published'" });
      }
      data.status = status;
    }

    let oldImageUrl = null;
    if (req.file) {
      if (existing.image_url) {
        oldImageUrl = existing.image_url;
      }
      data.image_url = req.file.path; // Cloudinary secure_url
    }

    const updated = await prisma.categories.update({ where: { id }, data });

    if (oldImageUrl) {
      await destroyByPublicId(publicIdFromUrl(oldImageUrl));
    }

    res.json(updated);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
    console.error('[categories] updateCategory error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
};

// ── PATCH /api/products/categories/:id/status ─────────────────────────────────
// Quick draft ⇄ published toggle for a category — same idea as
// updateStatus() for products, just one click from the dashboard's category
// header instead of opening the edit modal.
// Body: { status: 'draft' | 'published' }
exports.updateCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['draft', 'published'].includes(status)) {
      return res.status(400).json({ error: "status must be 'draft' or 'published'" });
    }

    const category = await prisma.categories.update({
      where: { id },
      data: { status },
    });

    res.json(category);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
    console.error('[categories] updateCategoryStatus error:', error);
    res.status(500).json({ error: 'Failed to update category status' });
  }
};

// ── DELETE /api/products/categories/:id ───────────────────────────────────────
// Only allowed when the category has no products left in it.
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const productsCount = await prisma.products.count({ where: { category_id: id } });
    if (productsCount > 0) {
      return res.status(409).json({ error: 'Cannot delete a category that still has products in it. Move or delete its products first.' });
    }

    const category = await prisma.categories.findUnique({ where: { id } });
    if (!category) return res.status(404).json({ error: 'Category not found' });

    if (category.image_url) {
      await destroyByPublicId(publicIdFromUrl(category.image_url));
    }

    await prisma.categories.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Category not found' });
    console.error('[categories] deleteCategory error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
};
