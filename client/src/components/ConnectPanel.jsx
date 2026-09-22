import { useEffect, useState } from 'react';

/**
 * Shows the address other devices should open to join this host.
 *
 * Only a real server knows its own LAN addresses, so this asks the server for
 * them. On a static host (the Pages build) the endpoint doesn't exist and the
 * panel simply stays hidden.
 */
export function ConnectPanel({ mode }) {
  const [info, setInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (mode !== 'server') {
      setInfo(null);
      return undefined;
    }

    let cancelled = false;
    fetch('/api/host-info')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.primary) setInfo(data);
      })
      .catch(() => {
        // Not served by our own server — nothing to show.
      });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  if (!info) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(info.primary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard needs a secure context; the address is on screen anyway.
    }
  }

  return (
    <section className={`connect-panel ${open ? 'open' : ''}`} aria-label="Connect another device">
      <button
        className="connect-panel-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="connect-panel-title">
          <span aria-hidden="true">📲</span> Connect another device
        </span>
        <span className="connect-panel-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="connect-panel-body">
          <div className="connect-panel-qr" aria-hidden="true">
            {/* Server-rendered SVG: keeps a QR library out of the bundle. */}
            <div dangerouslySetInnerHTML={{ __html: info.qrSvg }} />
          </div>

          <div className="connect-panel-info">
            <p className="connect-panel-hint">
              On the other device, join this WiFi and open this address — or scan the code.
            </p>

            <button className="connect-panel-url" onClick={copy} title="Copy address">
              <code>{info.primary}</code>
              <span className="connect-panel-copy">{copied ? '✓ Copied' : 'Copy'}</span>
            </button>

            {info.urls.length > 1 && (
              <details className="connect-panel-alt">
                <summary>Other addresses ({info.urls.length - 1})</summary>
                <ul>
                  {info.urls
                    .filter((u) => u !== info.primary)
                    .map((u) => (
                      <li key={u}><code>{u}</code></li>
                    ))}
                </ul>
                <p>
                  Use whichever matches the network both devices are on.
                </p>
              </details>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
