// Socket.IO must require a valid JWT and derive rooms from it (audit F3).
const http = require('http');
const express = require('express');
const { io: connect } = require('socket.io-client');
const { attachSocket } = require('../src/socket');
const { token, customerToken } = require('./helpers');

let server, io, url;

beforeAll(async () => {
  const app = express();
  app.set('allowedOrigins', ['http://localhost:5173']);
  server = http.createServer(app);
  io = attachSocket(server, app);
  await new Promise((r) => server.listen(0, r));
  url = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  io.close();
  await new Promise((r) => server.close(r));
});

const open = (auth) => new Promise((resolve) => {
  const s = connect(url, { auth, reconnection: false, transports: ['websocket'] });
  s.on('connect', () => resolve({ ok: true, s }));
  s.on('connect_error', (e) => { s.close(); resolve({ ok: false, error: e.message }); });
});

describe('Socket.IO authentication', () => {
  it('rejects an anonymous client', async () => {
    const r = await open({});
    expect(r.ok).toBe(false);
  });

  it('rejects a forged token', async () => {
    const r = await open({ token: 'abc.def.ghi' });
    expect(r.ok).toBe(false);
  });

  it('does not let a client join role:owner by asking for it', async () => {
    const { ok, s } = await open({ token: customerToken() });
    expect(ok).toBe(true);
    s.emit('join_room', 'role:owner');
    await new Promise((r) => setTimeout(r, 150));
    expect(io.sockets.adapter.rooms.get('role:owner')?.size ?? 0).toBe(0);
    s.close();
  });

  it('puts a staff token into its own role room', async () => {
    const { ok, s } = await open({ token: token({ id: 'staff-1', role: 'owner' }) });
    expect(ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(io.sockets.adapter.rooms.get('role:owner')?.size).toBe(1);
    s.close();
  });
});
