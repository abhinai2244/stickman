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

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'create') {
      const code = msg.code;
      if (rooms.has(code)) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Room code taken — try again' }));
        return;
      }
      rooms.set(code, { players: [ws], ts: Date.now() });
      ws._room = code;
      ws._idx = 0;
      ws.send(JSON.stringify({ type: 'created', code }));
      console.log(`[+] Room ${code} created  (${rooms.size} active)`);
    }

    else if (msg.type === 'join') {
      const code = msg.code;
      const room = rooms.get(code);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Room not found — check the code' }));
        return;
      }
      if (room.players.length >= 2) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Room is full' }));
        return;
      }
      room.players.push(ws);
      ws._room = code;
      ws._idx = 1;
      ws.send(JSON.stringify({ type: 'joined' }));
      // Tell host that opponent joined
      if (room.players[0].readyState === 1) {
        room.players[0].send(JSON.stringify({ type: 'peer_joined' }));
      }
      console.log(`[+] Player joined room ${code}`);
    }

    else if (msg.type === 'game') {
      // Relay game data to the other player in the room
      const room = rooms.get(ws._room);
      if (!room) return;
      const rawStr = raw.toString();
      for (const p of room.players) {
        if (p !== ws && p.readyState === 1) {
          p.send(rawStr);
        }
      }
    }
  });

  ws.on('close', () => {
    if (ws._room) {
      const room = rooms.get(ws._room);
      if (room) {
        for (const p of room.players) {
          if (p !== ws && p.readyState === 1) {
            p.send(JSON.stringify({ type: 'peer_left' }));
          }
        }
        rooms.delete(ws._room);
        console.log(`[-] Room ${ws._room} closed  (${rooms.size} active)`);
      }
    }
  });
});

// Cleanup stale rooms every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.ts > 60 * 60 * 1000) {
      for (const p of room.players) {
        if (p.readyState === 1) p.close();
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
