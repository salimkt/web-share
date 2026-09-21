import { Avatar, getFileIcon, formatBytes } from './shared';

export function IncomingRequest({ requests, onAccept, onDecline }) {
  return (
    <div className="toast-container" aria-live="assertive" aria-atomic="false">
      {requests.map((req) => (
        <RequestToast
          key={req.fromId + req.filename}
          request={req}
          onAccept={() => onAccept(req)}
          onDecline={() => onDecline(req)}
        />
      ))}
    </div>
  );
}

function RequestToast({ request, onAccept, onDecline }) {
  const { fromName, fromColor, filename, size, type } = request;
  const fileIcon = getFileIcon(filename, type);

  return (
    <div
      className="incoming-toast"
      role="dialog"
      aria-label={`Incoming file from ${fromName}`}
      aria-modal="false"
      id={`toast-${request.fromId}`}
    >
      <div className="toast-header">
        <Avatar name={fromName} color={fromColor} showOnline={false} />
        <div className="toast-text">
          <div className="toast-from">{fromName}</div>
          <div className="toast-message">wants to send you a file</div>
        </div>
      </div>

      <div className="toast-fileinfo">
        <div className="toast-fileinfo-icon">{fileIcon}</div>
        <div className="toast-fileinfo-name" title={filename}>{filename}</div>
        <div className="toast-fileinfo-size">{formatBytes(size)}</div>
      </div>

      <div className="toast-actions">
        <button
          className="btn btn-ghost btn-danger"
          onClick={onDecline}
          id={`btn-decline-${request.fromId}`}
          aria-label="Decline file transfer"
        >
          ✕ Decline
        </button>
        <button
          className="btn btn-primary"
          onClick={onAccept}
          id={`btn-accept-${request.fromId}`}
          aria-label="Accept file transfer"
          autoFocus
        >
          ↓ Accept
        </button>
      </div>
    </div>
  );
}
