/**
 * Server-less signaling over BroadcastChannel.
 *
 * Used when no signaling server can be reached — most importantly on a static
 * host like GitHub Pages, where there is nothing to run a server. Tabs of the
 * same browser on the same origin discover each other and exchange the WebRTC
 * handshake directly, so transfers between tabs work with no backend at all.
 * The file bytes still travel over a real RTCDataChannel.
 *
 * Scope: same browser, same origin. Pairing two separate devices still needs a
 * real signaling server — that's the self-hosted LAN mode in the README.
 *
 * This class deliberately mirrors what server/index.js does with each client
 * event, so the rest of the app can't tell which transport is underneath.
 */

const CHANNEL_NAME = 'webshare-signaling';
const HEARTBEAT_MS = 2000;
const PEER_TIMEOUT_MS = 7000;

// Kept in sync with the server so names and colors feel the same either way.
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

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function detectDeviceType() {
  const ua = navigator.userAgent.toLowerCase();
  // iPadOS reports a desktop UA, so fall back to touch points.
  if (/ipad/.test(ua) || (/macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'tablet';
  if (/tablet/.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini/.test(ua)) return 'mobile';
  return 'desktop';
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `local-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function isLocalSignalingSupported() {
  return typeof BroadcastChannel !== 'undefined';
}

/**
 * BroadcastChannel uses structured clone, which refuses platform objects such
 * as RTCIceCandidate — postMessage throws DataCloneError on them. socket.io
 * never hit this because JSON.stringify calls toJSON() for us. Convert to
 * plain data before sending.
 */
function toPlain(value) {
  if (value && typeof value.toJSON === 'function') return value.toJSON();
  return value;
}

export class LocalSignaling {
  constructor({ onSelf, onPeers, onSignal } = {}) {
    this.onSelf = onSelf;
    this.onPeers = onPeers;
    this.onSignal = onSignal;

    this.self = {
      id: makeId(),
      name: `${pick(ADJECTIVES)} ${pick(NOUNS)}`,
      color: pick(AVATAR_COLORS),
      deviceType: detectDeviceType(),
    };

    this.peers = new Map(); // id → { id, name, color, deviceType, lastSeen }
    this.channel = null;
    this.beatTimer = null;
    this.sweepTimer = null;
    this.announceLeave = () => this.post({ t: 'bye', id: this.self.id });
  }

  start() {
    if (!isLocalSignalingSupported() || this.channel) return false;

    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (event) => this.receive(event.data);

    this.onSelf?.({ ...this.self });
    this.post({ t: 'hello', peer: this.self });

    this.beatTimer = setInterval(() => this.post({ t: 'beat', peer: this.self }), HEARTBEAT_MS);
    this.sweepTimer = setInterval(() => this.prune(), HEARTBEAT_MS);

    // pagehide is the reliable one on iOS Safari; beforeunload covers the rest.
    window.addEventListener('pagehide', this.announceLeave);
    window.addEventListener('beforeunload', this.announceLeave);
    return true;
  }

  stop() {
    if (!this.channel) return;
    this.announceLeave();
    clearInterval(this.beatTimer);
    clearInterval(this.sweepTimer);
    window.removeEventListener('pagehide', this.announceLeave);
    window.removeEventListener('beforeunload', this.announceLeave);
    this.channel.close();
    this.channel = null;
    this.peers.clear();
  }

  post(message) {
    if (!this.channel) return;
    try {
      this.channel.postMessage(message);
    } catch (err) {
      // Usually a value structured clone can't handle. Never swallow this
      // silently: it breaks signaling in a way that looks like a hang.
      console.error('LocalSignaling: could not post', message?.t, message?.event ?? '', err);
    }
  }

  /** Record a peer we heard from; publish only when the roster actually changes. */
  touch(peer) {
    if (!peer?.id || peer.id === this.self.id) return;
    const isNew = !this.peers.has(peer.id);
    this.peers.set(peer.id, { ...peer, lastSeen: Date.now() });
    if (isNew) this.publish();
  }

  publish() {
    const list = [...this.peers.values()].map(({ id, name, color, deviceType }) => ({
      id,
      name,
      color,
      deviceType,
    }));
    this.onPeers?.(list);
  }

  prune() {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  receive(message) {
    if (!message || typeof message !== 'object') return;

    switch (message.t) {
      case 'hello':
        this.touch(message.peer);
        // Answer directly so the newcomer learns about us immediately.
        this.post({ t: 'welcome', peer: this.self, to: message.peer?.id });
        break;
      case 'welcome':
        if (message.to === this.self.id) this.touch(message.peer);
        break;
      case 'beat':
        this.touch(message.peer);
        break;
      case 'bye':
        if (this.peers.delete(message.id)) this.publish();
        break;
      case 'sig':
        if (message.to === this.self.id) this.onSignal?.(message.event, message.payload);
        break;
      default:
        break;
    }
  }

  /**
   * Same contract as socket.emit on the server build: takes the client-side
   * event and delivers the server's corresponding event to the target peer.
   */
  emit(event, data = {}) {
    const to = data.targetId;

    switch (event) {
      case 'send-request':
        this.signal(to, 'incoming-request', {
          fromId: this.self.id,
          fromName: this.self.name,
          fromColor: this.self.color,
          filename: data.filename,
          size: data.size,
          type: data.type,
          transferId: data.transferId,
        });
        break;
      case 'request-response':
        this.signal(to, 'request-response', {
          fromId: this.self.id,
          accepted: data.accepted,
          filename: data.filename,
        });
        break;
      case 'webrtc-offer':
        this.signal(to, 'webrtc-offer', { fromId: this.self.id, offer: toPlain(data.offer) });
        break;
      case 'webrtc-answer':
        this.signal(to, 'webrtc-answer', { fromId: this.self.id, answer: toPlain(data.answer) });
        break;
      case 'webrtc-ice':
        this.signal(to, 'webrtc-ice', { fromId: this.self.id, candidate: toPlain(data.candidate) });
        break;
      default:
        break;
    }
  }

  signal(to, event, payload) {
    if (!to) return;
    this.post({ t: 'sig', to, from: this.self.id, event, payload });
  }
}
