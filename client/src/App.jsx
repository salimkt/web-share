import { useEffect, useState, useCallback, useRef } from 'react';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { PeerGrid } from './components/PeerGrid';
import { TransferDrawer } from './components/TransferDrawer';
import { IncomingRequest } from './components/IncomingRequest';
import { ConnectPanel } from './components/ConnectPanel';
import { Avatar } from './components/shared';
import './styles/index.css';

export default function App() {
  const { connected, selfInfo, peers, on, emit, socketRef, mode } = useSocket();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState([]);

  // Pending sends: transferId → { peerId, file } waiting for receiver's accept
  const pendingSendsRef = useRef({});

  const {
    transfers,
    sendFile,
    startSendingFile,
    handleIncomingAccepted,
    registerListeners,
    updateTransfer,
  } = useWebRTC({ emit, on });

  // ─── Register Socket Listeners ───────────────────────────────────────────

  useEffect(() => {
    registerListeners();

    // Someone wants to send us a file
    on('incoming-request', (req) => {
      setIncomingRequests((prev) => {
        // Avoid duplicate toasts
        const exists = prev.some((r) => r.fromId === req.fromId && r.filename === req.filename);
        return exists ? prev : [...prev, req];
      });
    });

    // The receiver responded to our send request
    on('request-response', ({ fromId, accepted, filename }) => {
      // Find the pending transfer
      const pending = Object.entries(pendingSendsRef.current).find(
        ([, v]) => v.peerId === fromId
      );
      if (!pending) return;
      const [transferId, { file }] = pending;

      if (accepted) {
        delete pendingSendsRef.current[transferId];
        startSendingFile(fromId, file, transferId);
        setDrawerOpen(true);
      } else {
        delete pendingSendsRef.current[transferId];
        // Receiver declined — mark the pending transfer so it doesn't
        // hang at "Waiting" forever.
        updateTransfer(transferId, { status: 'declined' });
        setDrawerOpen(true);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open drawer when we have transfers
  useEffect(() => {
    if (transfers.length > 0) setDrawerOpen(true);
  }, [transfers.length]);

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleSendFile = useCallback(async (peerId, file) => {
    const transferId = await sendFile(peerId, file);
    pendingSendsRef.current[transferId] = { peerId, file };
    setDrawerOpen(true);
  }, [sendFile]);

  const handleAccept = useCallback((req) => {
    const { fromId, filename, size, type, transferId } = req;
    setIncomingRequests((prev) => prev.filter((r) => r !== req));

    // Tell the sender we accepted
    emit('request-response', { targetId: fromId, accepted: true, filename });

    // Register receiver-side transfer entry (WebRTC offer will arrive soon)
    handleIncomingAccepted(fromId, transferId || `recv-${Date.now()}`, filename, size, type);
    setDrawerOpen(true);
  }, [emit, handleIncomingAccepted]);

  const handleDecline = useCallback((req) => {
    setIncomingRequests((prev) => prev.filter((r) => r !== req));
    emit('request-response', { targetId: req.fromId, accepted: false });
  }, [emit]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-brand">
          <div className="header-logo" aria-hidden="true">📡</div>
          <div>
            <div className="header-title">WebShare</div>
            <div className="header-subtitle">Local Network File Transfer</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Transfer history button */}
          {transfers.length > 0 && (
            <button
              className="btn btn-ghost"
              style={{ padding: '8px 14px', fontSize: '12px' }}
              onClick={() => setDrawerOpen(true)}
              id="btn-open-transfers"
              aria-label={`View ${transfers.length} transfers`}
            >
              ⇅ {transfers.length} transfer{transfers.length !== 1 ? 's' : ''}
            </button>
          )}

          {/* Self card */}
          {selfInfo && (
            <div className="self-card" aria-label={`Your device: ${selfInfo.name}`}>
              <Avatar
                name={selfInfo.name}
                color={selfInfo.color}
                size="normal"
                showOnline={false}
              />
              <div>
                <div className="self-card-label">You</div>
                <div className="self-card-name">{selfInfo.name}</div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main className="main-content">
        {/* Info banner */}
        <div className="info-banner" role="note">
          <span className="info-banner-icon">{mode === 'local' ? '🪟' : '💡'}</span>
          {mode === 'local' ? (
            <span>
              <strong>Tab mode</strong> — no signaling server here, so WebShare is pairing
              tabs in this browser. Open this page in a second tab and it'll appear below.
              To share between real devices, run WebShare on your own WiFi.
            </span>
          ) : (
            <span>
              Open <strong>WebShare</strong> on any device on this WiFi network — they'll appear below.
              Click a peer to send them a file directly, no cloud involved.
            </span>
          )}
        </div>

        {/* How another device joins this host (LAN mode only) */}
        <ConnectPanel mode={mode} />

        {/* Peer section */}
        <section aria-labelledby="peers-heading">
          <div className="section-heading">
            <div className="pulse-dot" aria-hidden="true" />
            <h2 id="peers-heading">
              Nearby Devices
            </h2>
            {peers.length > 0 && (
              <span className="badge" aria-label={`${peers.length} devices found`}>
                {peers.length}
              </span>
            )}
          </div>

          <PeerGrid
            peers={peers}
            connected={connected}
            mode={mode}
            onSendFile={handleSendFile}
          />
        </section>
      </main>

      {/* ── Incoming Requests (Toasts) ──────────────────────────────────── */}
      <IncomingRequest
        requests={incomingRequests}
        onAccept={handleAccept}
        onDecline={handleDecline}
      />

      {/* ── Transfer Drawer ─────────────────────────────────────────────── */}
      <TransferDrawer
        transfers={transfers}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
