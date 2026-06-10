const http = require('http');
const fs = require('fs');
const path = require('path');

let WebSocketServer;
try {
  WebSocketServer = require('ws').WebSocketServer;
} catch (e) {
  console.error('\n  ERROR: ws package not found. Run: npm install\n');
  process.exit(1);
}

const PORT = process.env.PORT || 8080;
const rooms = new Map();
const GAME_W = 1000;

function genId() {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0x10000).toString(16)}`;
}

function sendSafe(ws, obj) {
  try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) { }
}

// ===== HTTP SERVER (serves game files) =====
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';

  // Only serve index.html (single file game)
  const filePath = path.join(__dirname, url);
  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

// ===== WEBSOCKET SERVER (game rooms) =====
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws._room = null;
  ws._idx = -1;
  ws._id = genId();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'create') {
      const code = msg.code;
      const name = msg.name || 'Host';
      if (rooms.has(code)) {
        sendSafe(ws, { type: 'error', msg: 'Room code taken — try again' });
        return;
      }
      const room = {
        code,
        hostId: ws._id,
        clients: [],
        maxPlayers: 2,
        phase: 'lobby',
        ts: Date.now()
      };
      const client = { id: ws._id, ws, name, role: 'player' };
      room.clients.push(client);
      rooms.set(code, room);
      ws._room = code; ws._idx = 0;
      sendSafe(ws, { type: 'created', code, id: ws._id });
      // Broadcast lobby state
      const players = room.clients.map(c => ({ id: c.id, name: c.name, role: c.role }));
      for (const c of room.clients) sendSafe(c.ws, { type: 'lobby_update', players, hostId: room.hostId, maxPlayers: room.maxPlayers });
      console.log(`[+] Room ${code} created  (${rooms.size} active)`);
    }

    else if (msg.type === 'join') {
      const code = msg.code;
      const name = msg.name || 'Player';
      const room = rooms.get(code);
      if (!room) {
        sendSafe(ws, { type: 'error', msg: 'Room not found — check the code' });
        return;
      }
      // Determine role: player if players < maxPlayers else spectator
      const playerCount = room.clients.filter(c => c.role === 'player').length;
      const role = (playerCount < room.maxPlayers) ? 'player' : 'spectator';
      const client = { id: ws._id, ws, name, role };
      room.clients.push(client);
      ws._room = code;
      ws._idx = room.clients.length - 1;
      sendSafe(ws, { type: 'joined', id: ws._id });
      // Notify host
      const hostClient = room.clients.find(c => c.id === room.hostId);
      if (hostClient && hostClient.ws.readyState === 1) sendSafe(hostClient.ws, { type: 'peer_joined' });
      // Broadcast lobby state
      const players = room.clients.map(c => ({ id: c.id, name: c.name, role: c.role }));
      for (const c of room.clients) sendSafe(c.ws, { type: 'lobby_update', players, hostId: room.hostId, maxPlayers: room.maxPlayers });
      console.log(`[+] Player joined room ${code}`);
    }

    else if (msg.type === 'game') {
      // Relay game data to other clients in the room
      const room = rooms.get(ws._room);
      if (!room) return;
      for (const c of room.clients) {
        if (c.ws !== ws && c.ws.readyState === 1) sendSafe(c.ws, { type: 'game', from: ws._id, data: msg.data });
      }
    }

    else if (msg.type === 'set_settings') {
      const room = rooms.get(ws._room);
      if (!room) return;
      if (ws._id !== room.hostId) return; // only host
      const maxPlayers = parseInt(msg.maxPlayers) || room.maxPlayers;
      room.maxPlayers = Math.max(1, Math.min(4, maxPlayers));
      // Reassign roles: ensure earliest clients are players up to maxPlayers
      let playersAssigned = 0;
      for (const c of room.clients) {
        if (playersAssigned < room.maxPlayers) { c.role = 'player'; playersAssigned++; }
        else c.role = 'spectator';
      }
      const players = room.clients.map(c => ({ id: c.id, name: c.name, role: c.role }));
      for (const c of room.clients) sendSafe(c.ws, { type: 'lobby_update', players, hostId: room.hostId, maxPlayers: room.maxPlayers });
    }

    else if (msg.type === 'rename') {
      const room = rooms.get(ws._room);
      if (!room) return;
      const client = room.clients.find(c => c.id === ws._id);
      if (!client) return;
      const nextName = String(msg.name || '').trim().slice(0, 16);
      if (!nextName) return;
      client.name = nextName;
      const players = room.clients.map(c => ({ id: c.id, name: c.name, role: c.role }));
      for (const c of room.clients) sendSafe(c.ws, { type: 'lobby_update', players, hostId: room.hostId, maxPlayers: room.maxPlayers });
    }

    else if (msg.type === 'start_match') {
      const room = rooms.get(ws._room);
      if (!room) return;
      if (ws._id !== room.hostId) return; // only host
      room.phase = 'match';
      // Decide players for the match
      const all = [...room.clients];
      let selected = [];
      if (msg.random) {
        // shuffle and take first maxPlayers
        const arr = all.slice();
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]];
        }
        selected = arr.slice(0, room.maxPlayers);
      } else {
        selected = all.filter(c => c.role === 'player').slice(0, room.maxPlayers);
      }
      // Assign player indexes
      const assignments = all.map(c => {
        const idx = selected.findIndex(s => s.id === c.id);
        return { id: c.id, role: (idx >= 0 ? 'player' : 'spectator'), idx: (idx >= 0 ? idx : -1) };
      });
      // Generate seed/settings for round
      const s = {
        w0: 100 + Math.random() * 30, w1: 100 + Math.random() * 30,
        y0: Math.floor(280 + Math.random() * 200), y1: Math.floor(280 + Math.random() * 200),
        x0: Math.floor(5 + Math.random() * 40), x1: Math.floor(GAME_W - (5 + Math.random() * 40)),
        h0: Math.floor(1 + Math.random() * 4), h1: Math.floor(1 + Math.random() * 4)
      };
      // Notify all clients to start with assignments and seed
      for (const c of room.clients) sendSafe(c.ws, { type: 'start', s, assignments });
    }
  });

  ws.on('close', () => {
    if (ws._room) {
      const room = rooms.get(ws._room);
      if (room) {
        // Remove client
        room.clients = room.clients.filter(c => c.id !== ws._id);
        if (room.phase === 'match') {
          for (const c of room.clients) sendSafe(c.ws, { type: 'peer_left' });
        }
        // If host left, promote first client
        if (room.hostId === ws._id && room.clients.length > 0) {
          room.hostId = room.clients[0].id;
        }
        // Broadcast updated lobby
        const players = room.clients.map(c => ({ id: c.id, name: c.name, role: c.role }));
        for (const c of room.clients) sendSafe(c.ws, { type: 'lobby_update', players, hostId: room.hostId, maxPlayers: room.maxPlayers });
        if (room.clients.length === 0) {
          rooms.delete(ws._room);
          console.log(`[-] Room ${ws._room} closed  (${rooms.size} active)`);
        }
      }
    }
  });
});

// Cleanup stale rooms every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.ts > 60 * 60 * 1000) {
      for (const c of room.clients) {
        if (c.ws && c.ws.readyState === 1) c.ws.close();
      }
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => {
  console.log('');
  console.log('  ==========================================');
  console.log('   RAGDOLL ARCHERS — Server Running!');
  console.log('  ==========================================');
  console.log('');
  console.log(`   Open:  http://localhost:${PORT}`);
  console.log('');
  console.log('   Share your dev tunnel URL with your friend!');
  console.log('   Both players open the same URL.');
  console.log('  ==========================================');
  console.log('');
});