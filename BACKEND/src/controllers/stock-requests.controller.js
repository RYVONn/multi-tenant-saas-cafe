/**
 * stock-requests.controller.js
 *
 * Fixes vs original:
 *  1. createNotification called on new request  → inventory_manager notified
 *  2. createNotification called on respond      → staff notified of approval/rejection
 *  3. io emitted on both actions for real-time badge update
 *  4. packageCount kept in sync on stock deduction
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAllRequests = async (req, res) => {
  try {
    const { shiftId, status, from, to } = req.query;
    const where = {
      ...(shiftId && { shiftId }),
      ...(status && status !== 'all' && { status }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) }),
        },
      }),
    };

    const requests = await prisma.stockRequest.findMany({
      where,
      include: {
        items:    { include: { item: true } },
        shift:    { select: { id: true, type: true, status: true } },
        response: { include: { manager: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(requests);
  } catch (err) {
    console.error('getAllRequests error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const getRequest = async (req, res) => {
  try {
    const request = await prisma.stockRequest.findUnique({
      where: { id: req.params.id },
      include: {
        items:    { include: { item: true } },
        shift:    { select: { id: true, type: true, status: true } },
        response: { include: { manager: { select: { id: true, name: true } } } },
      },
    });
    if (!request) return res.status(404).json({ error: 'Request not found' });
    res.json(request);
  } catch (err) {
    console.error('getRequest error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const createRequest = async (req, res) => {
  try {
    const { shiftId, notes, items } = req.body;

    if (!shiftId)
      return res.status(400).json({ error: 'shiftId is required' });
    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'items array is required' });

    // Validate: each item needs either itemId OR customName
    for (const i of items) {
      const hasItem = i.itemId || (i.customName && i.customName.trim());
      if (!hasItem)
        return res.status(400).json({ error: 'Each item needs itemId or customName' });
      if (!i.quantity || i.quantity <= 0)
        return res.status(400).json({ error: 'Each item needs quantity > 0' });
    }

    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: { staff: { select: { id: true, shift_name: true } } },
    });
    if (!shift)
      return res.status(404).json({ error: 'Shift not found' });
    if (shift.status !== 'open')
      return res.status(400).json({ error: 'Cannot send request for a closed shift' });

    // Split into inventory items vs custom items
    const inventoryItems = items.filter(i => i.itemId && !i.customName?.trim());
    const customItems    = items.filter(i => !i.itemId &&  i.customName?.trim());

    const request = await prisma.stockRequest.create({
      data: {
        shiftId,
        notes,
        status: 'pending',
        items: {
          create: [
            // Inventory items — itemId set, customName null
            ...inventoryItems.map(i => ({
              itemId:     i.itemId,
              customName: null,
              quantity:   i.quantity,
            })),
            // Custom items — itemId null, customName set
            ...customItems.map(i => ({
              itemId:     null,
              customName: i.customName.trim(),
              quantity:   i.quantity,
            })),
          ],
        },
      },
      include: {
        items: { include: { item: true } },
        shift: { select: { id: true, type: true } },
      },
    });

    // ── Notify inventory managers ─────────────────────────────────────────────
    try {
      const { createNotification } = require('./notifications.controller');
      const io = req.app.get('io');
      const staffName = shift.staff?.shift_name ?? 'Staff';

      const itemSummary = request.items
        .slice(0, 2)
        .map(i => {
          const name = i.item?.name ?? i.customName ?? 'item';
          const unit = i.item?.unit ? ` ${i.item.unit}` : '';
          return `${i.quantity}${unit} ${name}`;
        })
        .join(', ') + (request.items.length > 2 ? ` +${request.items.length - 2} more` : '');

      await createNotification(io, {
        recipientId:   'broadcast',
        recipientRole: 'inventory_manager',
        type:          'stock_request_new',
        title:         `New stock request — ${shift.type} shift`,
        body:          `${staffName} needs: ${itemSummary}`,
        data:          { requestId: request.id, shiftId },
      });

      await createNotification(io, {
        recipientId:   'broadcast',
        recipientRole: 'manager',
        type:          'stock_request_new',
        title:         `New stock request — ${shift.type} shift`,
        body:          `${staffName} needs: ${itemSummary}`,
        data:          { requestId: request.id, shiftId },
      });
    } catch (notifErr) {
      console.error('Notification error (non-fatal):', notifErr);
    }

    res.status(201).json(request);
  } catch (err) {
    if (err.code === 'P2025')
      return res.status(404).json({ error: 'Stock item not found' });
    console.error('createRequest error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const respondToRequest = async (req, res) => {
  try {
    const { id }     = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['approved', 'partial', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    // ── Resolve a valid InventoryManager FK ──────────────────────────────
    // req.inventoryManagerId is set by inventoryAuth middleware:
    //   - inventory_manager → their own ID (always valid FK)
    //   - owner             → first InventoryManager as proxy
    const managerId = req.inventoryManagerId;

    if (!managerId) {
      return res.status(400).json({
        error: 'No InventoryManager account found. An inventory manager must be created before approvals can be recorded.',
      });
    }

    const request = await prisma.stockRequest.findUnique({
      where:   { id },
      include: { items: { include: { item: true } }, response: true },
    });

    if (!request)
      return res.status(404).json({ error: 'Stock request not found' });
    if (request.response)
      return res.status(409).json({ error: 'Request already has a response' });

    const actorName = req.user.name ?? 'Manager';

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create response — managerId is guaranteed to be a valid InventoryManager FK
      const response = await tx.stockRequestResponse.create({
        data: {
          requestId: id,
          managerId,           // ← FK-safe always
          status,
          notes: notes || null,
        },
      });

      // 2. Update request status
      await tx.stockRequest.update({
        where: { id },
        data:  { status },
      });

      // 3. If approved/partial — issue stock to shift
      if (status === 'approved' || status === 'partial') {
        const itemsToIssue = request.items.filter(i => i.itemId && i.item);

        if (itemsToIssue.length > 0) {
          // Create issuance record
          const issuance = await tx.shiftIssuance.create({
            data: {
              shiftId:   request.shiftId,
              managerId,
              notes:     `Auto-issued from stock request ${id}`,
              items: {
                create: itemsToIssue.map(i => ({
                  itemId:   i.itemId,
                  quantity: i.quantity,
                })),
              },
            },
          });

          // Deduct stock + write movements
          for (const reqItem of itemsToIssue) {
            const current = await tx.stockItem.findUnique({ where: { id: reqItem.itemId } });
            if (!current) continue;

            const qtyBefore = current.packageCount ?? current.quantity;
            const deduct    = Math.min(reqItem.quantity, qtyBefore); // never go below 0
            const qtyAfter  = Math.max(0, qtyBefore - deduct);

            await tx.stockItem.update({
              where: { id: reqItem.itemId },
              data: {
                packageCount: { decrement: deduct },
                quantity:     { decrement: deduct },
              },
            });

            await tx.inventoryMovement.create({
              data: {
                itemId:      reqItem.itemId,
                type:        'ISSUANCE',
                quantity:    -deduct,
                qtyBefore,
                qtyAfter,
                actorId:     managerId,
                actorRole:   req.user.role,
                actorName,
                referenceId: issuance.id,
                notes:       `Stock request ${id} — ${status}`,
              },
            });
          }
        }
      }

      return response;
    });

    // Notification (non-fatal)
    try {
      const { createNotification } = require('./notifications.controller');
      const io = req.app.get('io');
      const statusEmoji = status === 'approved' ? '✅' : status === 'partial' ? '⚠️' : '❌';

      await createNotification(io, {
        recipientId:   request.shiftId,
        recipientRole: 'staff',
        type:          'stock_request_response',
        title:         `${statusEmoji} Stock request ${status}`,
        body:          `Your stock request was ${status} by ${actorName}${notes ? `: ${notes}` : ''}`,
        data:          { requestId: id, status },
      });
    } catch (notifErr) {
      console.error('[requests] notification error (non-fatal):', notifErr);
    }

    res.json({ message: `Request ${status}`, response: result });

  } catch (err) {
    console.error('respondToRequest error:', err);
    if (err.code === 'P2003') {
      return res.status(400).json({
        error: 'Foreign key constraint: managerId does not exist in InventoryManager table.',
        detail: err.message,
      });
    }
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
};

const deleteRequest = async (req, res) => {
  try {
    const request = await prisma.stockRequest.findUnique({ where: { id: req.params.id } });
    if (!request)
      return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending')
      return res.status(400).json({ error: 'Can only delete pending requests' });

    await prisma.stockRequest.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('deleteRequest error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getAllRequests, getRequest, createRequest, respondToRequest, deleteRequest };