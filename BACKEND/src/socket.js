const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// Attaches an authenticated Socket.IO server to `server`.
// Every socket must present a valid JWT in handshake.auth.token; rooms are
// derived from the verified token — client-supplied room names are ignored.
function attachSocket(server, app) {
  const io = new Server(server, {
    cors: { origin: app.get('allowedOrigins'), credentials: true },
    pingTimeout: 120000,
    pingInterval: 30000,
  });

  app.set('io', io);

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Unauthorized'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.userId = decoded.id;
      socket.data.role   = String(decoded.role ?? '').toLowerCase();
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, role } = socket.data;
    socket.join(`user:${userId}`);
    if (role && role !== 'customer') socket.join(`role:${role}`);

    // Legacy clients still emit join_room; rooms now come from the token only.
    socket.on('join_room', () => {});
  });

  return io;
}

module.exports = { attachSocket };
