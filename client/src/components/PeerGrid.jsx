import { useEffect, useState } from 'react';
import { PeerCard } from './PeerCard';

export function PeerGrid({ peers, connected, onSendFile }) {
  // If the signaling server can't be reached, explain why instead of spinning
  // forever — that's what a visitor sees on a statically hosted build with no
  // signaling server available.
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    if (connected) {
      setUnreachable(false);
      return undefined;
    }
    const timer = setTimeout(() => setUnreachable(true), 10000);
    return () => clearTimeout(timer);
  }, [connected]);

  if (!connected) {
    return (
      <div className="connecting-state" aria-live="polite">
        <div className="spinner" aria-label="Connecting" />
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
          Connecting to network…
        </p>
        {unreachable && (
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: '13px',
              maxWidth: '42ch',
              textAlign: 'center',
              lineHeight: 1.6,
            }}
          >
            No signaling server on this network. WebShare runs on your own WiFi —
            start it on one device, then open that device&rsquo;s address here.
          </p>
        )}
      </div>
    );
  }

  if (peers.length === 0) {
    return (
      <div className="empty-state" aria-live="polite">
        <div className="empty-state-icon" aria-hidden="true">📡</div>
        <h3>Waiting for others…</h3>
        <p>
          Open WebShare on another device connected to the same WiFi network.
          They'll appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <section
      className="peer-grid"
      aria-label="Available peers on this network"
      id="peer-grid"
    >
      {peers.map((peer) => (
        <PeerCard key={peer.id} peer={peer} onSendFile={onSendFile} />
      ))}
    </section>
  );
}
