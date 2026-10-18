const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3030;

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Smart LAN IP discovery (prioritizes Wi-Fi / active LAN over virtual adapters)
function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const isVirtual = /virtual|vbox|vmware|vethernet/i.test(name);
    const isWifi = /wi-fi|wlan|wireless/i.test(name);

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Exclude typical 192.168.56.x (VirtualBox default) from top priority
        const isVboxSubnet = iface.address.startsWith('192.168.56.');
        let priority = 1;

        if (isWifi) priority = 10;
        else if (!isVirtual && !isVboxSubnet) priority = 5;
        else priority = 0;

        candidates.push({ address: iface.address, priority, name });
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.length > 0 ? candidates[0].address : 'localhost';
}

// Endpoint to provide network pairing information to client
app.get('/api/network-info', (req, res) => {
  const networkIp = getLocalNetworkIp();
  res.json({
    localIp: networkIp,
    port: PORT,
    localUrl: `http://localhost:${PORT}`,
    networkUrl: `http://${networkIp}:${PORT}`
  });
});

// Endpoint to generate QR code SVG for any URL / text
app.get('/api/qr', async (req, res) => {
  const text = req.query.text;
  if (!text) {
    return res.status(400).send('Missing text query parameter');
  }

  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 2,
      color: {
        dark: '#00f0ff',
        light: '#070a11'
      }
    });
    res.type('image/svg+xml').send(svg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// In-Memory Signaling Rooms: Map<roomId, Set<WebSocket>>
const rooms = new Map();

// Generate random 6-character room code (readable uppercase alphanumeric)
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous I, O, 0, 1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

wss.on('connection', (ws) => {
  let currentRoom = null;
  let peerId = null;

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (messageText) => {
    try {
      const message = JSON.parse(messageText);
      const { type, payload } = message;

      switch (type) {
        case 'create-room': {
          let roomId;
          do {
            roomId = generateRoomCode();
          } while (rooms.has(roomId));

          peerId = 'peer_' + Math.random().toString(36).substring(2, 9);
          ws.peerId = peerId;
          ws.roomId = roomId;
          currentRoom = roomId;

          const roomPeers = new Set([ws]);
          rooms.set(roomId, roomPeers);

          ws.send(JSON.stringify({
            type: 'room-created',
            payload: {
              roomId,
              peerId,
              isInitiator: true
            }
          }));
          break;
        }

        case 'join-room': {
          const targetRoom = (payload.roomId || '').trim().toUpperCase();
          if (!rooms.has(targetRoom)) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: `Room "${targetRoom}" does not exist. Check the code and try again.` }
            }));
            return;
          }

          const roomPeers = rooms.get(targetRoom);
          if (roomPeers.size >= 2) {
            ws.send(JSON.stringify({
              type: 'error',
              payload: { message: `Room "${targetRoom}" is already full (maximum 2 devices per direct P2P transfer).` }
            }));
            return;
          }

          peerId = 'peer_' + Math.random().toString(36).substring(2, 9);
          ws.peerId = peerId;
          ws.roomId = targetRoom;
          currentRoom = targetRoom;

          roomPeers.add(ws);

          ws.send(JSON.stringify({
            type: 'room-joined',
            payload: {
              roomId: targetRoom,
              peerId,
              isInitiator: false
            }
          }));

          // Notify both peers in the room that pairing is ready for WebRTC
          for (const client of roomPeers) {
            client.send(JSON.stringify({
              type: 'peer-ready',
              payload: {
                initiatorId: [...roomPeers][0].peerId,
                joinedId: peerId
              }
            }));
          }
          break;
        }

        case 'signal': {
          // Relay WebRTC SDP offer, answer, or ICE candidate to the other peer in the room
          if (!currentRoom || !rooms.has(currentRoom)) return;
          const roomPeers = rooms.get(currentRoom);
          for (const client of roomPeers) {
            if (client !== ws && client.readyState === ws.OPEN) {
              client.send(JSON.stringify({
                type: 'signal',
                payload: payload
              }));
            }
          }
          break;
        }

        case 'leave-room': {
          cleanUpPeer(ws);
          break;
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    cleanUpPeer(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket peer error:', err);
    cleanUpPeer(ws);
  });
});

function cleanUpPeer(ws) {
  if (ws.roomId && rooms.has(ws.roomId)) {
    const roomPeers = rooms.get(ws.roomId);
    roomPeers.delete(ws);

    // Notify remaining peer if any
    for (const client of roomPeers) {
      if (client.readyState === ws.OPEN) {
        client.send(JSON.stringify({
          type: 'peer-disconnected',
          payload: { peerId: ws.peerId }
        }));
      }
    }

    if (roomPeers.size === 0) {
      rooms.delete(ws.roomId);
    }
    ws.roomId = null;
  }
}

// Keep-alive heartbeat interval
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

// Start HTTP + Signaling Server
server.listen(PORT, '0.0.0.0', () => {
  const networkIp = getLocalNetworkIp();
  console.log(`\n======================================================`);
  console.log(`🚀 P2P Encrypted File Dropper Signaling Server`);
  console.log(`======================================================`);
  console.log(`Local Access:    http://localhost:${PORT}`);
  console.log(`LAN (Mobile/P2P): http://${networkIp}:${PORT}`);
  console.log(`Signaling WS:    ws://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
