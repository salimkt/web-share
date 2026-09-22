import { useCallback, useRef, useState } from 'react';

const CHUNK_SIZE = 65536; // 64 KB per chunk

const ICE_SERVERS = [
  // Local STUN — works on LAN without internet
  { urls: 'stun:stun.l.google.com:19302' },
];

// Prefixed fallback for older WebKit builds (some iOS Safari versions).
// Modern browsers expose RTCPeerConnection unprefixed.
const PC = window.RTCPeerConnection || window.webkitRTCPeerConnection;

// Statuses that mean the transfer is over for good. Once a transfer reaches
// one, a later status change must not move it back out: whichever peer closes
// the data channel first fires an error on the other side, which otherwise
// clobbers an already-successful 'done' with 'failed'.
const TERMINAL_STATUSES = ['done', 'declined'];

/**
 * Manages all WebRTC peer connections for file transfers.
 * One RTCPeerConnection per active transfer.
 */
export function useWebRTC({ emit, on }) {
  const [transfers, setTransfers] = useState([]);
  const pcsRef = useRef({}); // peerId → RTCPeerConnection
  const sendBufferRef = useRef({}); // transferId → { file, offset, channel }
  const receiveBufferRef = useRef({}); // transferId → { chunks, received, total, meta }
  const pendingCandidatesRef = useRef({}); // peerId → [ICE candidates buffered before remoteDescription]

  // ─── Transfer State Helpers ──────────────────────────────────────────────

  const addTransfer = useCallback((transfer) => {
    setTransfers((prev) => [transfer, ...prev]);
  }, []);

  const updateTransfer = useCallback((id, updates) => {
    setTransfers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        // Ignore a status change that would undo a finished transfer.
        if (
          updates.status &&
          updates.status !== t.status &&
          TERMINAL_STATUSES.includes(t.status)
        ) {
          return t;
        }
        return { ...t, ...updates };
      })
    );
  }, []);

  // ─── WebRTC Connection Factory ───────────────────────────────────────────

  function createPeerConnection(peerId) {
    const pc = new PC({ iceServers: ICE_SERVERS });
    pcsRef.current[peerId] = pc;

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        emit('webrtc-ice', { targetId: peerId, candidate });
      }
    };

    return pc;
  }

  function closePeerConnection(peerId) {
    pcsRef.current[peerId]?.close();
    delete pcsRef.current[peerId];
    delete pendingCandidatesRef.current[peerId];
  }

  // Add any ICE candidates that arrived before setRemoteDescription, then clear
  // the buffer for that peer. Called right after a remote description is applied.
  async function flushPendingCandidates(peerId, pc) {
    const pending = pendingCandidatesRef.current[peerId];
    if (!pending || !pending.length) return;
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Silently ignore — can happen on renegotiation
      }
    }
    delete pendingCandidatesRef.current[peerId];
  }

  // ─── Register Socket Listeners ───────────────────────────────────────────

  function registerListeners() {
    on('webrtc-offer', async ({ fromId, offer }) => {
      let pc = pcsRef.current[fromId];
      if (!pc) {
        pc = createPeerConnection(fromId);
        // Receiver-side: wait for data channel
        pc.ondatachannel = ({ channel }) => {
          setupReceiveChannel(channel, fromId);
        };
      }
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      // Remote description is set — apply any ICE candidates that raced ahead
      await flushPendingCandidates(fromId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      emit('webrtc-answer', { targetId: fromId, answer });
    });

    on('webrtc-answer', async ({ fromId, answer }) => {
      const pc = pcsRef.current[fromId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        // Remote description is set — apply any ICE candidates that raced ahead
        await flushPendingCandidates(fromId, pc);
      }
    });

    on('webrtc-ice', async ({ fromId, candidate }) => {
      if (!candidate) return;
      const pc = pcsRef.current[fromId];
      // Candidates can arrive before setRemoteDescription has run. Only add
      // immediately once the remote description exists; otherwise buffer the
      // candidate and flush it once the description is applied.
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Silently ignore — can happen on renegotiation
        }
      } else {
        if (!pendingCandidatesRef.current[fromId]) {
          pendingCandidatesRef.current[fromId] = [];
        }
        pendingCandidatesRef.current[fromId].push(candidate);
      }
    });
  }

  // ─── Send Side ───────────────────────────────────────────────────────────

  async function sendFile(peerId, file) {
    const transferId = `${Date.now()}-${peerId}`;

    addTransfer({
      id: transferId,
      direction: 'send',
      filename: file.name,
      size: file.size,
      type: file.type,
      peerId,
      progress: 0,
      status: 'waiting', // waiting for accept
    });

    // Notify the receiver
    emit('send-request', {
      targetId: peerId,
      filename: file.name,
      size: file.size,
      type: file.type,
      transferId,
    });

    return transferId;
  }

  async function startSendingFile(peerId, file, transferId) {
    const pc = createPeerConnection(peerId);
    const channel = pc.createDataChannel('file-transfer', { ordered: true });

    // Send file metadata first, then chunks
    channel.onopen = () => {
      const meta = JSON.stringify({
        filename: file.name,
        size: file.size,
        type: file.type,
        transferId,
      });
      channel.send(meta);
      sendBufferRef.current[transferId] = { file, offset: 0, channel, peerId };
      updateTransfer(transferId, { status: 'sending', progress: 0 });
      sendNextChunk(transferId);
    };

    channel.onerror = (e) => {
      console.error('DataChannel error (send):', e);
      updateTransfer(transferId, { status: 'failed' });
      closePeerConnection(peerId);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    emit('webrtc-offer', { targetId: peerId, offer });
  }

  function sendNextChunk(transferId) {
    const state = sendBufferRef.current[transferId];
    if (!state) return;
    const { file, channel, peerId } = state;

    // Respect DataChannel buffer to avoid overwhelming it
    if (channel.bufferedAmount > CHUNK_SIZE * 8) {
      channel.onbufferedamountlow = () => sendNextChunk(transferId);
      channel.bufferedAmountLowThreshold = CHUNK_SIZE * 4;
      return;
    }

    const start = state.offset;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const slice = file.slice(start, end);

    const reader = new FileReader();
    reader.onload = (e) => {
      if (channel.readyState !== 'open') return;
      channel.send(e.target.result);
      state.offset = end;
      const progress = Math.round((end / file.size) * 100);
      updateTransfer(transferId, { progress });

      if (end < file.size) {
        sendNextChunk(transferId);
      } else {
        updateTransfer(transferId, { status: 'done', progress: 100 });
        delete sendBufferRef.current[transferId];
        // Small delay before closing to let the channel flush. Capture the
        // current pc so that if the user starts a NEW transfer to the same peer
        // within this window (replacing pcsRef[peerId]), we don't tear it down.
        const pcToClose = pcsRef.current[peerId];
        setTimeout(() => {
          if (pcsRef.current[peerId] === pcToClose) {
            closePeerConnection(peerId);
          }
        }, 1000);
      }
    };
    reader.readAsArrayBuffer(slice);
  }

  // ─── Receive Side ────────────────────────────────────────────────────────

  function setupReceiveChannel(channel, fromId) {
    let transferId = null;
    let meta = null;

    // Force binary chunks to arrive as ArrayBuffers. Some browsers
    // (Safari/Firefox) may default a data channel to 'blob', which makes
    // incoming chunks Blobs whose .byteLength is undefined → progress becomes
    // NaN and the transfer never completes. Must be set before onmessage.
    channel.binaryType = 'arraybuffer';

    channel.onmessage = ({ data }) => {
      // First message is JSON metadata
      if (typeof data === 'string') {
        try {
          meta = JSON.parse(data);
          transferId = meta.transferId;
          receiveBufferRef.current[transferId] = {
            chunks: [],
            received: 0,
            total: meta.size,
          };
          updateTransfer(transferId, { status: 'receiving', progress: 0 });
        } catch {
          // Not JSON — shouldn't happen
        }
        return;
      }

      // Subsequent messages are binary chunks
      if (!transferId) return;
      const state = receiveBufferRef.current[transferId];
      if (!state) return;

      if (data instanceof ArrayBuffer) {
        appendChunk(transferId, fromId, meta, data);
      } else {
        // Defensive fallback: a chunk arrived as a Blob (or typed-array view)
        // despite requesting 'arraybuffer'. Convert to an ArrayBuffer so its
        // bytes are still counted. Chained on state.queue to preserve the
        // arrival order of chunks across the async conversion.
        state.queue = (state.queue || Promise.resolve()).then(async () => {
          let buffer = null;
          if (data && typeof data.arrayBuffer === 'function') {
            try {
              buffer = await data.arrayBuffer(); // Blob / File (modern)
            } catch {
              buffer = null;
            }
          } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
            // Older Safari lacking Blob.arrayBuffer(): fall back to FileReader.
            buffer = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => resolve(null);
              reader.readAsArrayBuffer(data);
            });
          } else if (ArrayBuffer.isView(data)) {
            buffer = data.buffer.slice(
              data.byteOffset,
              data.byteOffset + data.byteLength
            ); // typed-array view
          }
          if (buffer) appendChunk(transferId, fromId, meta, buffer);
        });
      }
    };

    channel.onerror = (e) => {
      console.error('DataChannel error (recv):', e);
      if (transferId) updateTransfer(transferId, { status: 'failed' });
    };
  }

  // Append one received binary chunk: count its bytes, update progress, and
  // finalize the download once the whole file has arrived.
  function appendChunk(transferId, fromId, meta, buffer) {
    const state = receiveBufferRef.current[transferId];
    if (!state) return;

    state.chunks.push(buffer);
    state.received += buffer.byteLength;
    const progress = Math.round((state.received / state.total) * 100);
    updateTransfer(transferId, { progress });

    if (state.received >= state.total) {
      // Reassemble and trigger download
      const blob = new Blob(state.chunks, { type: meta.type });
      triggerDownload(blob, meta.filename);
      updateTransfer(transferId, { status: 'done', progress: 100 });
      delete receiveBufferRef.current[transferId];
      // Let the sender observe the transfer finishing before tearing the
      // connection down — closing instantly raises an error on its side.
      // Guarded so a newer transfer to the same peer isn't closed.
      const pcToClose = pcsRef.current[fromId];
      setTimeout(() => {
        if (pcsRef.current[fromId] === pcToClose) closePeerConnection(fromId);
      }, 1000);
    }
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // ─── Incoming Request Handler ────────────────────────────────────────────

  function handleIncomingAccepted(fromId, transferId, filename, size, type) {
    // Add to our transfer list as receiver before the WebRTC offer arrives
    addTransfer({
      id: transferId,
      direction: 'receive',
      filename,
      size,
      type,
      peerId: fromId,
      progress: 0,
      status: 'connecting',
    });
  }

  return {
    transfers,
    sendFile,
    startSendingFile,
    handleIncomingAccepted,
    registerListeners,
    updateTransfer,
  };
}
