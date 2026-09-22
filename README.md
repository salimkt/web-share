# 📡 WebShare

**Local network file sharing — no cloud, no accounts, no limits.**

Transfer files directly between devices on the same WiFi using WebRTC. Files are sent peer-to-peer in the browser; they never touch a server.

## How It Works

```
Device A ←──── WebRTC DataChannel (file bytes) ────→ Device B
    │                                                      │
    └────────── Signaling Server (WebSocket) ──────────────┘
                  (only handshake metadata, no files)
```

1. Open WebShare on multiple devices on the same WiFi
2. Devices appear in each other's peer grid automatically
3. Click a peer → pick a file → they get an Accept/Decline prompt
4. On accept, a direct WebRTC connection is established
5. The file transfers browser-to-browser and auto-downloads on the receiver

The signaling server only relays the WebRTC handshake (a few KB of SDP/ICE metadata). Once the peers connect, ICE selects local `192.168.x.x` host candidates, so **file bytes travel directly across your WiFi** and never leave the network.

## Quick Start (development)

```bash
# Install all dependencies
npm run install:all

# Start both server and client
npm run dev
```

Then open **http://localhost:5173** in your browser.

## Offline / LAN Mode (recommended)

This is the mode that needs **no internet at all**. One device runs the server, which serves both the UI and the signaling channel from a single origin:

```bash
npm run install:all
npm run build --prefix client   # build the UI
npm start --prefix server       # serve UI + signaling on :3001
```

The server prints its LAN addresses on startup. Open one of them on any device on the same WiFi:

```
http://192.168.1.42:3001
```

Everything works with the router completely offline. The app also registers a service worker, so after the first load each device can reopen it without any connection at all.

### Who is the host?

The host is whichever device **runs the server** — it needs Node.js. That is a
separate role from whichever device provides the WiFi.

A common setup is a phone sharing its hotspot while a laptop hosts the app:

| Role | Device | What it does |
|------|--------|--------------|
| Hotspot | Phone | Provides the WiFi network |
| Host | Laptop | Runs `npm start --prefix server` |
| Clients | Phone, laptop, anyone else | Open `http://<laptop-ip>:3001` |

A phone can't be the host, because a mobile browser can't run Node. Open the
host's address on **every** device — including the host itself. Using
`http://localhost:3001` on the host works too; all clients of one server share
a single peer room regardless of which address they arrived on.

Find your local IP manually if needed:

```bash
# macOS / Linux
ipconfig getifaddr en0   # or ip addr

# Windows
ipconfig
```

## A Note on GitHub Pages

The client is deployed to GitHub Pages as a **showcase of the UI** — it is not a working transfer app, and it can't be:

- Pages is HTTPS-only, and a secure page is forbidden from opening a `ws://192.168.x.x` connection (mixed content).
- A private LAN IP can't hold a valid TLS certificate, so the local server can't be HTTPS either.
- WebRTC always needs a signaling channel to discover peers, and with no internet that channel has to live on the LAN.

So for real transfers, use **Offline / LAN Mode** above. To make a hosted build functional instead, deploy `server/` somewhere with HTTPS and set a repository variable `VITE_SIGNALING_URL` to its `wss://` URL — the Pages workflow picks it up automatically.

## Project Structure

```
web-share/
├── server/          # Signaling server (Express + Socket.io), also serves the built client
│   └── index.js
├── client/          # React frontend (Vite)
│   ├── public/
│   │   ├── sw.js                   # Service worker (offline support)
│   │   └── manifest.webmanifest    # PWA manifest
│   ├── src/
│   │   ├── hooks/
│   │   │   ├── useSocket.js    # Socket.io connection & peer list
│   │   │   └── useWebRTC.js    # RTCPeerConnection + file chunking
│   │   ├── components/
│   │   │   ├── PeerCard.jsx
│   │   │   ├── PeerGrid.jsx
│   │   │   ├── TransferDrawer.jsx
│   │   │   ├── IncomingRequest.jsx
│   │   │   └── shared.jsx
│   │   ├── styles/index.css
│   │   └── App.jsx
│   └── index.html
└── package.json     # Root with concurrently
```

## Ports

| Service | Port |
|---------|------|
| Signaling Server (+ built client) | `3001` |
| Vite Dev Server | `5173` |

Both are accessible from other devices on your LAN.

## Compatibility

Works across iOS Safari, Android Chrome, and desktop Chrome / Firefox / Safari / Edge:

- Responsive mobile-first layout with a light and dark theme
- Safe-area insets for notched iPhones, `100dvh` to avoid the iOS URL-bar jump
- 44px minimum tap targets and `:active` states for touch (no hover-only affordances)
- Installable as a PWA with offline support

## Tech Stack

- **Frontend**: React 18 + Vite
- **Signaling**: Socket.io (Express)
- **File Transfer**: WebRTC `RTCDataChannel` (P2P, 64KB chunks)
- **Peer Discovery**: IP subnet grouping via Socket.io rooms
