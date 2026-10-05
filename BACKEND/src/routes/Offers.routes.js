const express     = require("express");
const router      = express.Router();
const verifyToken = require("../middlewares/auth.middleware");
const { makeCloudinaryUpload } = require("../utils/cloudinaryStorage");

const {
  getOffers,
  getAllOffersAdmin,
  createBundleOffer,
  createPointsProductOffer,
  updateOffer,
  toggleOfferActive,
  deleteOffer,
} = require("../controllers/Offers.controller");

// ─── Upload — offer images go straight to Cloudinary (was local disk) ─────────
const upload = makeCloudinaryUpload("bleu/offers", { maxSizeMB: 5 });

const requireRole = require("../middlewares/role.middleware");

// ─── Routes ───────────────────────────────────────────────────────────────────
router.get("/",                getOffers);
router.get("/admin",           verifyToken, requireRole("owner", "manager"), getAllOffersAdmin);
router.post("/bundle",         verifyToken, requireRole("owner", "manager"), upload.single("image"), createBundleOffer);
router.post("/points-product", verifyToken, requireRole("owner", "manager"), createPointsProductOffer);
router.patch("/:id",           verifyToken, requireRole("owner", "manager"), upload.single("image"), updateOffer);
router.patch("/:id/toggle",    verifyToken, requireRole("owner", "manager"), toggleOfferActive);
router.delete("/:id",          verifyToken, requireRole("owner", "manager"), deleteOffer);

module.exports = router;

