const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { destroyByPublicId, publicIdFromUrl } = require("../utils/cloudinary");

// ─── GET ALL OFFERS (public) ──────────────────────────────────────────────────
const getOffers = async (req, res) => {
  try {
    const bundles = await prisma.offers.findMany({
      where: { is_active: true, status: "published", offer_type: "bundle" },
      include: {
        offer_items: {
          include: {
            products: { include: { sizes: true } },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    const pointProducts = await prisma.offers.findMany({
      where: { is_active: true, status: "published", offer_type: "points_product" },
      include: {
        offer_items: {
          include: {
            products: { include: { sizes: true } },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    res.json({ bundles, pointProducts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch offers" });
  }
};

// ─── GET ALL OFFERS (dashboard - includes inactive) ───────────────────────────
const getAllOffersAdmin = async (req, res) => {
  try {
    const offers = await prisma.offers.findMany({
      include: {
        offer_items: {
          include: {
            products: {
              select: { id: true, name: true, image_url: true },
            },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    res.json({ offers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch offers" });
  }
};

// ─── CREATE BUNDLE OFFER ──────────────────────────────────────────────────────
const createBundleOffer = async (req, res) => {
  try {
    const { title, description, price, points_price, egp_value, status, items } = req.body;
    const imageFile = req.file;

    if (!title || !price || !items) {
      return res.status(400).json({ error: "title, price, and items are required" });
    }

    let parsedItems;
    try {
      parsedItems = typeof items === "string" ? JSON.parse(items) : items;
    } catch {
      return res.status(400).json({ error: "Invalid items format" });
    }

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      return res.status(400).json({ error: "At least one item is required" });
    }

    const image_url = imageFile ? imageFile.path : null; // Cloudinary secure_url

    const offer = await prisma.offers.create({
      data: {
        title,
        description: description || null,
        offer_type: "bundle",
        price: parseFloat(price),
        points_price: points_price ? parseInt(points_price) : null,
        egp_value: egp_value !== undefined && egp_value !== null && egp_value !== "" ? parseFloat(egp_value) : null,
        status: status || "published",
        image_url,
        is_active: true,
        offer_items: {
          create: parsedItems.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity || 1,
            size_name: item.size_name || null,
          })),
        },
      },
      include: {
        offer_items: {
          include: {
            products: {
              select: { id: true, name: true, image_url: true },
            },
          },
        },
      },
    });

    res.status(201).json({ offer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create bundle offer" });
  }
};

// ─── CREATE POINTS PRODUCT OFFER ──────────────────────────────────────────────
const createPointsProductOffer = async (req, res) => {
  try {
    const { product_id, points_price, egp_value, status, size_name } = req.body;

    if (!product_id || !points_price) {
      return res.status(400).json({ error: "product_id and points_price are required" });
    }

    const product = await prisma.products.findUnique({
      where: { id: product_id },
      include: { sizes: true },
    });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const existing = await prisma.offers.findFirst({
      where: {
        offer_type: "points_product",
        offer_items: { some: { product_id } },
      },
    });

    if (existing) {
      return res.status(409).json({ error: "Points offer already exists for this product" });
    }

    const offer = await prisma.offers.create({
      data: {
        title: product.name,
        offer_type: "points_product",
        points_price: parseInt(points_price),
        egp_value: egp_value !== undefined && egp_value !== null && egp_value !== "" ? parseFloat(egp_value) : null,
        status: status || "published",
        is_active: true,
        offer_items: {
          create: [{ product_id, quantity: 1, size_name: size_name || null }],
        },
      },
      include: {
        offer_items: {
          include: {
            products: {
              include: {
                sizes: true,
              },
            },
          },
        },
      },
    });

    res.status(201).json({ offer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create points product offer" });
  }
};

// ─── UPDATE OFFER ─────────────────────────────────────────────────────────────
const updateOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, price, points_price, egp_value, status, is_active, items } = req.body;
    const imageFile = req.file;

    const existing = await prisma.offers.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Offer not found" });

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (price !== undefined) updateData.price = parseFloat(price);
    if (points_price !== undefined) updateData.points_price = points_price ? parseInt(points_price) : null;
    if (egp_value !== undefined) updateData.egp_value = egp_value !== null && egp_value !== "" ? parseFloat(egp_value) : null;
    if (status !== undefined) updateData.status = status;
    if (is_active !== undefined) updateData.is_active = is_active === "true" || is_active === true;

    if (imageFile) {
      if (existing.image_url) {
        await destroyByPublicId(publicIdFromUrl(existing.image_url));
      }
      updateData.image_url = imageFile.path; // Cloudinary secure_url
    }

    if (items) {
      let parsedItems;
      try {
        parsedItems = typeof items === "string" ? JSON.parse(items) : items;
      } catch {
        return res.status(400).json({ error: "Invalid items format" });
      }

      await prisma.offer_items.deleteMany({ where: { offer_id: id } });
      updateData.offer_items = {
        create: parsedItems.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity || 1,
          size_name: item.size_name || null,
        })),
      };
    }

    const offer = await prisma.offers.update({
      where: { id },
      data: updateData,
      include: {
        offer_items: {
          include: {
            products: {
              select: { id: true, name: true, image_url: true },
            },
          },
        },
      },
    });

    res.json({ offer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update offer" });
  }
};

// ─── TOGGLE OFFER ACTIVE STATE ────────────────────────────────────────────────
const toggleOfferActive = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.offers.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Offer not found" });

    const offer = await prisma.offers.update({
      where: { id },
      data: { is_active: !existing.is_active },
    });

    res.json({ offer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to toggle offer" });
  }
};

// ─── DELETE OFFER ─────────────────────────────────────────────────────────────
const deleteOffer = async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.offers.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Offer not found" });

    if (existing.image_url) {
      await destroyByPublicId(publicIdFromUrl(existing.image_url));
    }

    await prisma.offer_items.deleteMany({ where: { offer_id: id } });
    await prisma.offers.delete({ where: { id } });

    res.json({ message: "Offer deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete offer" });
  }
};

module.exports = {
  getOffers,
  getAllOffersAdmin,
  createBundleOffer,
  createPointsProductOffer,
  updateOffer,
  toggleOfferActive,
  deleteOffer,
};