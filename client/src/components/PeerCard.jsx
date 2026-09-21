import { useRef } from 'react';
import { Avatar, getDeviceIcon } from './shared';

export function PeerCard({ peer, onSendFile }) {
  const fileInputRef = useRef(null);

  function handleClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onSendFile(peer.id, files[0]);
    }
    // Reset so same file can be re-selected
    e.target.value = '';
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      handleClick();
    }
  }

  return (
    <article
      className="peer-card"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`Send file to ${peer.name}`}
      onKeyDown={handleKeyDown}
      id={`peer-${peer.id}`}
    >
      {/* Glow ring matching peer color */}
      <div
        className="peer-card-glow"
        style={{ borderColor: peer.color, boxShadow: `0 0 20px ${peer.color}40` }}
      />

      <Avatar
        name={peer.name}
        color={peer.color}
        size="large"
        showOnline
      />

      <div className="peer-card-info">
        <div className="peer-name">{peer.name}</div>
        <div className="peer-device">
          <span>{getDeviceIcon(peer.deviceType)}</span>
          <span style={{ textTransform: 'capitalize' }}>{peer.deviceType}</span>
        </div>
      </div>

      <div className="peer-action">Tap to send →</div>

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />
    </article>
  );
}
