// server/controllers/suppliers.controller.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /api/inventory/suppliers
const getAll = async (req, res) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { purchaseReceipts: true, stockItems: true } },
      },
    });

    // FIX: include amountPaid + paymentStatus so we can compute real outstanding
    const receipts = await prisma.purchaseReceipt.findMany({
      where:   { status: 'approved' },          // only approved receipts count
      select:  {
        supplierId:    true,
        totalCost:     true,
        amountPaid:    true,                    // ← was missing
        paymentStatus: true,                    // ← was missing
        createdAt:     true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by supplierId and compute all payment totals in one pass
    const bySupplier = {};
    for (const r of receipts) {
      if (!r.supplierId) continue;
      if (!bySupplier[r.supplierId]) {
        bySupplier[r.supplierId] = {
          total:        0,
          paid:         0,
          outstanding:  0,
          paidCount:    0,
          partialCount: 0,
          unpaidCount:  0,
          last:         r.createdAt.toISOString(),
        };
      }
      const cost = r.totalCost  ?? 0;
      const paid = r.amountPaid ?? 0;

      bySupplier[r.supplierId].total       += cost;
      bySupplier[r.supplierId].paid        += paid;
      bySupplier[r.supplierId].outstanding += Math.max(0, cost - paid); // ← real formula

      if      (r.paymentStatus === 'paid')           bySupplier[r.supplierId].paidCount++;
      else if (r.paymentStatus === 'partially_paid') bySupplier[r.supplierId].partialCount++;
      else                                           bySupplier[r.supplierId].unpaidCount++;
    }

    const enriched = suppliers.map(s => ({
      ...s,
      totalPurchases:   bySupplier[s.id]?.total        ?? 0,
      totalPaid:        bySupplier[s.id]?.paid         ?? 0,   // ← new
      totalOutstanding: bySupplier[s.id]?.outstanding  ?? 0,   // ← new
      paidCount:        bySupplier[s.id]?.paidCount    ?? 0,   // ← new
      partialCount:     bySupplier[s.id]?.partialCount ?? 0,   // ← new
      unpaidCount:      bySupplier[s.id]?.unpaidCount  ?? 0,   // ← new
      lastPurchaseDate: bySupplier[s.id]?.last         ?? null,
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[suppliers] getAll error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/inventory/suppliers/:id
const getById = async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { purchaseReceipts: true, stockItems: true } },
        purchaseReceipts: {
          where:   { status: 'approved' },       // only show approved receipts
          orderBy: { createdAt: 'desc' },
          include: {
            items: {
              include: {
                item: { select: { id: true, name: true, unit: true } },
              },
            },
            payments: {                          // ← was missing
              orderBy: { paidAt: 'asc' },
              select:  { id: true, amount: true, method: true, note: true, paidAt: true },
            },
          },
        },
        stockItems: {
          select:  { id: true, name: true, unit: true, quantity: true },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    // Enrich each receipt with a computed `remaining` field
    const enrichedReceipts = supplier.purchaseReceipts.map(r => ({
      ...r,
      remaining: Math.max(0, (r.totalCost ?? 0) - (r.amountPaid ?? 0)),
    }));

    // Pre-compute payment summary so the frontend doesn't have to guess
    const paymentSummary = enrichedReceipts.reduce(
      (acc, r) => {
        acc.totalPurchases  += r.totalCost   ?? 0;
        acc.totalPaid       += r.amountPaid  ?? 0;
        acc.totalOutstanding += r.remaining;
        if      (r.paymentStatus === 'paid')           acc.paidCount++;
        else if (r.paymentStatus === 'partially_paid') acc.partialCount++;
        else                                           acc.unpaidCount++;
        return acc;
      },
      {
        totalPurchases:   0,
        totalPaid:        0,
        totalOutstanding: 0,
        paidCount:        0,
        partialCount:     0,
        unpaidCount:      0,
      }
    );

    res.json({
      ...supplier,
      purchaseReceipts: enrichedReceipts,
      paymentSummary,               // ← new: ready-made totals for the UI
    });
  } catch (err) {
    console.error('[suppliers] getById error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/inventory/suppliers
const create = async (req, res) => {
  try {
    const { name, phone, email, address, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const supplier = await prisma.supplier.create({
      data: { name, phone, email, address, notes },
    });
    res.status(201).json(supplier);
  } catch (err) {
    console.error('[suppliers] create error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/inventory/suppliers/:id
const update = async (req, res) => {
  try {
    const { name, phone, email, address, notes } = req.body;
    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: {
        ...(name    !== undefined && { name }),
        ...(phone   !== undefined && { phone }),
        ...(email   !== undefined && { email }),
        ...(address !== undefined && { address }),
        ...(notes   !== undefined && { notes }),
      },
    });
    res.json(supplier);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    console.error('[suppliers] update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/inventory/suppliers/:id
const remove = async (req, res) => {
  try {
    await prisma.supplier.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    console.error('[suppliers] remove error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getAll, getById, create, update, remove };