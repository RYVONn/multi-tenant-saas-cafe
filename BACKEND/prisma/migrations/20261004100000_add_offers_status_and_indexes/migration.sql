-- Offers: the controller filters on status = 'published' (fixes GET /api/offers 500)
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "status" VARCHAR(20) NOT NULL DEFAULT 'published';

-- Indexes for hot lookups (customer order history, size lookups)
CREATE INDEX IF NOT EXISTS "idx_orders_customer_id" ON "orders"("customer_id");
CREATE INDEX IF NOT EXISTS "idx_product_sizes_product_id" ON "product_sizes"("product_id");
