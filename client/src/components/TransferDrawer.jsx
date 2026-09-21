import { getFileIcon, formatBytes } from './shared';

const STATUS_LABELS = {
  waiting: 'Waiting',
  connecting: 'Connecting',
  sending: 'Sending',
  receiving: 'Receiving',
  done: 'Done',
  failed: 'Failed',
  declined: 'Declined',
};

export function TransferDrawer({ transfers, open, onClose }) {
  const hasTransfers = transfers.length > 0;

  return (
    <aside
      className={`transfer-drawer ${open && hasTransfers ? 'open' : ''}`}
      aria-label="File transfers"
      aria-hidden={!open || !hasTransfers}
    >
      <div className="transfer-drawer-inner">
        <div className="drawer-handle-row" onClick={onClose} role="button" aria-label="Close transfer drawer" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClose()}>
          <div className="drawer-handle" />
          <div className="drawer-title">
            <span>⇅</span>
            Transfers
            <span className="drawer-count">{transfers.length}</span>
          </div>
          <button className="drawer-close" aria-label="Close">✕</button>
        </div>

        <div className="transfer-list" role="list">
          {transfers.map((t) => (
            <TransferItem key={t.id} transfer={t} />
          ))}
        </div>
      </div>
    </aside>
  );
}

function TransferItem({ transfer }) {
  const { filename, size, progress, status, direction } = transfer;
  const icon = getFileIcon(filename, transfer.type);
  const isDone = status === 'done';
  const isFailed = status === 'failed';
  const isDeclined = status === 'declined';
  const isTerminal = isDone || isFailed || isDeclined;

  // 'declined' & 'failed' both render a red badge and hide the progress bar.
  const badgeStatus = isDone
    ? 'done'
    : isFailed
    ? 'failed'
    : isDeclined
    ? 'declined'
    : status === 'waiting'
    ? 'waiting'
    : status === 'connecting'
    ? 'connecting'
    : direction === 'send'
    ? 'sending'
    : 'receiving';

  return (
    <div className="transfer-item" role="listitem">
      <div className="transfer-item-header">
        <div className="transfer-file-icon" aria-hidden="true">{icon}</div>
        <div className="transfer-file-info">
          <div className="transfer-filename" title={filename}>{filename}</div>
          <div className="transfer-meta">
            {direction === 'send' ? '↑ Sending' : '↓ Receiving'} · {formatBytes(size)}
            {!isTerminal && progress > 0 && ` · ${progress}%`}
          </div>
        </div>
        <span className={`transfer-status-badge status-${badgeStatus}`}>
          {STATUS_LABELS[status] || status}
        </span>
      </div>

      {!isFailed && !isDeclined && (
        <div className="progress-bar-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={`progress-bar-fill ${isDone ? 'done' : ''}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
