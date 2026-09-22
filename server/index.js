const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 1e8, // 100MB — only for signaling messages, not file data
});

// ─── Peer Name Generation ────────────────────────────────────────────────────

const ADJECTIVES = [
  'Swift', 'Silent', 'Cosmic', 'Neon', 'Lunar', 'Solar', 'Arctic',
  'Crystal', 'Ember', 'Frozen', 'Golden', 'Hollow', 'Ivory', 'Jade',
  'Kinetic', 'Lush', 'Misty', 'Noble', 'Ocean', 'Prism',
];

const NOUNS = [
  'Falcon', 'Phoenix', 'Comet', 'Nebula', 'Glacier', 'Spark', 'Tide',
  'Prism', 'Cipher', 'Drifter', 'Echo', 'Flare', 'Ghost', 'Hawk',
  'Iris', 'Javelin', 'Kite', 'Lance', 'Mist', 'Nova',
];

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generatePeerName() {
  return `${randomElement(ADJECTIVES)} ${randomElement(NOUNS)}`;
}

function generateAvatarColor() {
  return randomElement(AVATAR_COLORS);
}

/**
 * Generate a peer name that isn't already taken within the given room.
 * Retries a few times on collision, then falls back to a plain random name.
 */
function generateUniquePeerName(room) {
  const taken = new Set(getPeersInRoom(room).map((p) => p.name));
  for (let attempt = 0; attempt < 10; attempt++) {
    const name = generatePeerName();
    if (!taken.has(name)) return name;
  }
  return generatePeerName();
}

// ─── IP / Room Utilities ─────────────────────────────────────────────────────

/**
 * Extract the /24 subnet from an IP address.
 * e.g. "192.168.1.42" → "192.168.1"
 * Clients sharing the same subnet are placed in the same room.
 */
function getSubnet(ip) {
  // Handle IPv4-mapped IPv6 (::ffff:192.168.x.x)
  const clean = ip.replace(/^::ffff:/, '');
  if (clean === '::1' || clean === '127.0.0.1') return 'localhost';
  const parts = clean.split('.');
  if (parts.length === 4) return parts.slice(0, 3).join('.');
  return 'default';
}

/**
 * Decide which room a client belongs to.
 *
 * Default: a single shared room. Any device that can reach this server is by
 * definition already on the same local network — reaching a private LAN
 * address is only possible from inside that network — so there is nothing to
 * separate.
 *
 * Subnet grouping used to be the default and broke the most common setup:
 * the device running the server opens http://localhost:3001 and is placed in
 * a "localhost" room, while a phone joining over WiFi lands in e.g.
 * "172.20.10", so the two never see each other. It also can't describe a
 * phone hotspot, which hands out a /28 (172.20.10.0/28), not a /24.
 *
 * Set GROUP_BY_SUBNET=1 only when hosting this signaling server publicly,
 * where grouping clients by their public /24 keeps unrelated WiFi networks
 * apart.
 */
const GROUP_BY_SUBNET = process.env.GROUP_BY_SUBNET === '1';

function getRoom(ip) {
  return GROUP_BY_SUBNET ? getSubnet(ip) : 'lan';
}

/**
 * Extract the client IP robustly across proxy setups and OSes.
 * `x-forwarded-for` may be a comma-separated string OR an array of values;
 * take the first entry either way, falling back to the socket address.
 */
function getClientIP(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  let raw = '';
  if (Array.isArray(forwarded)) {
    raw = forwarded.join(',');
  } else if (typeof forwarded === 'string') {
    raw = forwarded;
  }
  const first = raw.split(',')[0].trim();
  return first || socket.handshake.address || '';
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        ips.push(alias.address);
      }
    }
  }
  return ips;
}

// ─── Peer Store ──────────────────────────────────────────────────────────────

/** Map of socketId → peer info */
const peers = new Map();

function getPeersInRoom(room) {
  return [...peers.values()].filter((p) => p.room === room);
}

function broadcastPeerList(room) {
  const list = getPeersInRoom(room).map(({ id, name, color, deviceType }) => ({
    id,
    name,
    color,
    deviceType,
  }));
  io.to(room).emit('peers-updated', list);
}

// ─── Device Type Detection ───────────────────────────────────────────────────

function detectDeviceType(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(ua)) {
    return 'mobile';
  }
  if (/tablet|ipad/.test(ua)) return 'tablet';
  return 'desktop';
}

// ─── Input Validation ────────────────────────────────────────────────────────

/** True when `value` is a usable, non-empty string (e.g. a target socket id). */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

// ─── HTTP Routes ─────────────────────────────────────────────────────────────

// Lightweight health check for uptime monitors / load balancers.
app.get('/health', (req, res) => res.json({ ok: true, peers: peers.size }));

// ─── Static Client (offline / LAN mode) ──────────────────────────────────────
//
// When the client has been built (`npm run build --prefix client`), serve it
// from this same origin. That makes the app fully self-contained: every device
// on the WiFi opens http://<this-ip>:3001 and gets BOTH the UI and the
// signaling channel from one plain-HTTP origin. No internet is required.
//
// This is why the app can't run offline from an HTTPS host like GitHub Pages:
// a secure page is not allowed to open a ws:// connection to a LAN IP
// (mixed content), and a private IP can't hold a valid TLS certificate.

const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
const hasClientBuild = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));

if (hasClientBuild) {
  app.use(express.static(CLIENT_DIST));

  // SPA fallback — serve index.html for any other GET so deep links work.
  // socket.io handles its own /socket.io/ path before Express sees it, but we
  // guard anyway to be safe.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  // Friendly root response so a browser hitting the server directly isn't a 404.
  app.get('/', (req, res) =>
    res.send(
      'WebShare signaling server is running. Build the client ' +
        '(`npm run build --prefix client`) to serve the app from this origin.'
    )
  );
}

// ─── Socket.io ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  try {
    const ip = getClientIP(socket);
    const room = getRoom(ip);
    const userAgent = socket.handshake.headers['user-agent'] || '';

    const peer = {
      id: socket.id,
      name: generateUniquePeerName(room),
      color: generateAvatarColor(),
      room,
      deviceType: detectDeviceType(userAgent),
      ip,
    };

    peers.set(socket.id, peer);
    socket.join(room);

    console.log(`[+] ${peer.name} joined (${ip} → room: ${room})`);

    // Send the new peer its own info
    socket.emit('self-info', {
      id: peer.id,
      name: peer.name,
      color: peer.color,
      deviceType: peer.deviceType,
    });

    // Broadcast updated peer list to everyone in the room
    broadcastPeerList(room);
  } catch (err) {
    console.error(`[!] Connection setup failed for ${socket.id}:`, err.message);
  }

  // ── File Transfer Signaling ──────────────────────────────────────────────

  /** Sender requests to send a file to a specific peer */
  socket.on('send-request', (payload) => {
    try {
      const { targetId, filename, size, type, transferId } = payload || {};
      if (!isNonEmptyString(targetId)) return;
      const sender = peers.get(socket.id);
      if (!sender) return;
      io.to(targetId).emit('incoming-request', {
        fromId: socket.id,
        fromName: sender.name,
        fromColor: sender.color,
        filename,
        size,
        type,
        transferId,
      });
    } catch (err) {
      console.error(`[!] Error in 'send-request' from ${socket.id}:`, err.message);
    }
  });

  /** Receiver accepts or declines */
  socket.on('request-response', (payload) => {
    try {
      const { targetId, accepted, filename } = payload || {};
      if (!isNonEmptyString(targetId)) return;
      io.to(targetId).emit('request-response', {
        fromId: socket.id,
        accepted,
        filename,
      });
    } catch (err) {
      console.error(`[!] Error in 'request-response' from ${socket.id}:`, err.message);
    }
  });

  // ── WebRTC Signaling (offer / answer / ice) ──────────────────────────────

  socket.on('webrtc-offer', (payload) => {
    try {
      const { targetId, offer } = payload || {};
      if (!isNonEmptyString(targetId)) return;
      io.to(targetId).emit('webrtc-offer', { fromId: socket.id, offer });
    } catch (err) {
      console.error(`[!] Error in 'webrtc-offer' from ${socket.id}:`, err.message);
    }
  });

  socket.on('webrtc-answer', (payload) => {
    try {
      const { targetId, answer } = payload || {};
      if (!isNonEmptyString(targetId)) return;
      io.to(targetId).emit('webrtc-answer', { fromId: socket.id, answer });
    } catch (err) {
      console.error(`[!] Error in 'webrtc-answer' from ${socket.id}:`, err.message);
    }
  });

  socket.on('webrtc-ice', (payload) => {
    try {
      const { targetId, candidate } = payload || {};
      if (!isNonEmptyString(targetId)) return;
      io.to(targetId).emit('webrtc-ice', { fromId: socket.id, candidate });
    } catch (err) {
      console.error(`[!] Error in 'webrtc-ice' from ${socket.id}:`, err.message);
    }
  });

  // ── Disconnect ───────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    try {
      const p = peers.get(socket.id);
      if (p) {
        console.log(`[-] ${p.name} left (${p.ip})`);
        peers.delete(socket.id);
        broadcastPeerList(p.room);
      }
    } catch (err) {
      console.error(`[!] Error in 'disconnect' from ${socket.id}:`, err.message);
    }
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  const localIPs = getLocalIPs();
  console.log('\n🚀 WebShare signaling server running');
  console.log(`   Local:   http://localhost:${PORT}`);
  localIPs.forEach((ip) => {
    console.log(`   Network: http://${ip}:${PORT}`);
  });
  if (hasClientBuild) {
    console.log('\n   ✅ This device is the HOST — it serves the app to everyone else.');
    console.log('   Open a Network URL above on every device, including this one.');
    console.log('   No internet required — files transfer directly over WiFi.');
    console.log(
      `\n   Peer grouping: ${
        GROUP_BY_SUBNET ? 'per /24 subnet (public hosting mode)' : 'single LAN room (default)'
      }\n`
    );
  } else {
    console.log('\n   Dev client: http://<your-ip>:5173');
    console.log('   Tip: `npm run build --prefix client` to serve the app from this port.\n');
  }
});
