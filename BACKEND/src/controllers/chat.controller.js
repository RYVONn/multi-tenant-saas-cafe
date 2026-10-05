// controllers/chat.controller.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── Helper: resolve sender name ──────────────────────────────────────────────
async function resolveName(userId, role) {
  try {
    const sh = await prisma.shifts.findUnique({
      where: { id: userId }, select: { shift_name: true }
    });
    if (sh && sh.shift_name) return sh.shift_name;

    if (role === 'inventory_manager') {
      const r = await prisma.inventoryManager.findUnique({
        where: { id: userId }, select: { name: true }
      });
      return r?.name ?? 'Inventory Manager';
    }
    return role;
  } catch { return role; }
}

// ─── Helper: unread count for a participant ───────────────────────────────────
function unreadCount(conversation, userId) {
  const participant = conversation.participants.find(p => p.userId === userId);
  if (!participant || !participant.lastReadAt) return conversation.messages.length;
  return conversation.messages.filter(
    m => new Date(m.createdAt) > new Date(participant.lastReadAt)
  ).length;
}

// ─── GET /api/chat/conversations ──────────────────────────────────────────────
const getConversations = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const search = req.query.search?.toLowerCase() ?? '';

    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { some: { userId } }
      },
      include: {
        participants: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1   // last message preview
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    let result = conversations.map(conv => {
      const other = conv.participants.filter(p => p.userId !== userId);
      const lastMsg = conv.messages[0] ?? null;
      const unread = unreadCount(
        { ...conv, messages: conv.messages },
        userId
      );

      return {
        id:            conv.id,
        name:          conv.name ?? other.map(p => p.userName).join(', '),
        isGroup:       conv.isGroup,
        isBroadcast:   conv.isBroadcast,
        participants:  conv.participants,
        lastMessage:   lastMsg ? { body: lastMsg.body, createdAt: lastMsg.createdAt, senderName: lastMsg.senderName } : null,
        unreadCount:   unread,
        updatedAt:     conv.updatedAt,
      };
    });

    if (search) {
      result = result.filter(c =>
        c.name.toLowerCase().includes(search) ||
        c.lastMessage?.body.toLowerCase().includes(search)
      );
    }

    res.json({ conversations: result });
  } catch (err) {
    console.error('getConversations:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/chat/conversations ─────────────────────────────────────────────
// Body: { participantIds: string[], name?: string, isBroadcast?: boolean }
const createConversation = async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const { participantIds = [], name, isBroadcast = false } = req.body;

    const allIds = [...new Set([userId, ...participantIds])];
    const isGroup = allIds.length > 2 || isBroadcast;

    // For DMs: reuse existing conversation between exactly these two users
    if (!isGroup) {
      const existing = await prisma.conversation.findFirst({
        where: {
          isGroup: false,
          participants: { every: { userId: { in: allIds } } }
        },
        include: { participants: true, messages: { take: 0 } }
      });
      if (existing) {
        const other = existing.participants.filter(p => p.userId !== userId);
        return res.json({
          id:          existing.id,
          name:        other.map(p => p.userName).join(', '),
          isGroup:     false,
          isBroadcast: false,
          participants: existing.participants,
          lastMessage: null,
          unreadCount: 0,
          updatedAt:   existing.updatedAt,
        });
      }
    }

    // Resolve all participant names
    const senderName = await resolveName(userId, role);

    // Build participants list with names (others resolve from DB)
    const participantData = await Promise.all(
      allIds.map(async (pid) => {
        if (pid === userId) return { userId: pid, userRole: role, userName: senderName };
        // Try both tables (shifts preferred)
        let pRole = 'staff', pName = 'Staff';
        try {
          const sh = await prisma.shifts.findUnique({ where: { id: pid }, select: { shift_name: true, role: true } });
          if (sh) { pRole = sh.role; pName = sh.shift_name; }
          else {
            const inv = await prisma.inventoryManager.findUnique({ where: { id: pid }, select: { name: true } });
            if (inv) { pName = inv.name; }
          }
        } catch { /* keep defaults */ }

        return { userId: pid, userRole: pRole, userName: pName };
      })
    );

    const conv = await prisma.conversation.create({
      data: {
        name:        isBroadcast ? (name ?? 'Broadcast') : (isGroup ? name : null),
        isGroup,
        isBroadcast,
        participants: { create: participantData }
      },
      include: { participants: true }
    });

    res.status(201).json({
      id:          conv.id,
      name:        conv.name ?? participantData.filter(p => p.userId !== userId).map(p => p.userName).join(', '),
      isGroup:     conv.isGroup,
      isBroadcast: conv.isBroadcast,
      participants: conv.participants,
      lastMessage: null,
      unreadCount: 0,
      updatedAt:   conv.updatedAt,
    });
  } catch (err) {
    console.error('createConversation:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/chat/conversations/:id/messages ─────────────────────────────────
const getMessages = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { id: conversationId } = req.params;
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);

    // Verify user is a participant
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } }
    });
    if (!participant) return res.status(403).json({ error: 'Not a participant' });

    const [total, messages] = await prisma.$transaction([
      prisma.directMessage.count({ where: { conversationId, isDeleted: false } }),
      prisma.directMessage.findMany({
        where: { conversationId, isDeleted: false },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      })
    ]);

    // Mark conversation as read
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: new Date() }
    });

   const mappedMessages = messages;

    res.json({
      messages: mappedMessages,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('getMessages:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/chat/conversations/:id/messages ────────────────────────────────
const sendMessage = async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const { id: conversationId } = req.params;
    const { body } = req.body;

    if (!body?.trim()) return res.status(400).json({ error: 'body is required' });

    // Verify participant
    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } }
    });
    if (!participant) return res.status(403).json({ error: 'Not a participant' });

    const senderName = await resolveName(userId, role);
    let effectiveRole = role;
    try {
      const sh = await prisma.shifts.findUnique({ where: { id: userId }, select: { role: true } });
      if (sh && sh.role) effectiveRole = sh.role;
    } catch {}

    const [message] = await prisma.$transaction([
      prisma.directMessage.create({
        data: { conversationId, senderId: userId, senderName, senderRole: effectiveRole, body: body.trim() }
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() }
      }),
      // Mark as read for sender immediately
      prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId, userId } },
        data: { lastReadAt: new Date() }
      })
    ]);

    // Emit via socket to all participants
    const io = req.app.get('io');
    if (io) {
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: true }
      });
      conv?.participants.forEach(p => {
        io.to(`user:${p.userId}`).emit('new_message', {
          conversationId,
          message
        });
      });
    }

    res.status(201).json(message);
  } catch (err) {
    console.error('sendMessage:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── DELETE /api/chat/messages/:id ───────────────────────────────────────────
const deleteMessage = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const msg = await prisma.directMessage.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Not found' });
    if (msg.senderId !== userId) return res.status(403).json({ error: 'Forbidden' });

    await prisma.directMessage.update({
      where: { id: req.params.id },
      data: { isDeleted: true }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── GET /api/chat/users — list all accounts for new DM ──────────────────────
const getUsers = async (req, res) => {
  try {
    const { id: userId } = req.user;

    const [managers, shifts] = await Promise.all([
      prisma.inventoryManager.findMany({ select: { id: true, name: true } }),
      prisma.shifts.findMany({ select: { id: true, shift_name: true, role: true } })
    ]);

    const shiftNames = new Set(shifts.map(s => s.shift_name.toLowerCase()));

    const users = [
      ...shifts.map(s => ({ id: s.id, name: s.shift_name, role: s.role })),
      ...managers
          .filter(m => !shiftNames.has(m.name.toLowerCase()))
          .map(m => {
             let r = 'staff';
             if (m.name.toLowerCase() === 'development') r = 'manager';
             if (m.name.toLowerCase() === 'yousef') r = 'owner';
             return { id: m.id, name: m.name, role: r };
          })
    ]
    .filter(u => u.id !== userId);

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── POST /api/chat/typing ────────────────────────────────────────────────────
const emitTyping = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { conversationId, isTyping } = req.body;

    const io = req.app.get('io');
    if (io) {
      // Notify other participants
      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId, userId: { not: userId } }
      });
      participants.forEach(p => {
        io.to(`user:${p.userId}`).emit('typing', { conversationId, userId, isTyping });
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { getConversations, createConversation, getMessages, sendMessage, deleteMessage, getUsers, emitTyping };