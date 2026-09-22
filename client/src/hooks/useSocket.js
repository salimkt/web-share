import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { LocalSignaling } from '../lib/localSignaling';

// Default to the origin the page was served from. When the Node server serves
// the built client (the offline/LAN mode), that origin IS the signaling server,
// so this works with no internet and no configuration.
//
// VITE_SIGNALING_URL is only needed when the UI is hosted somewhere else (e.g.
// a GitHub Pages showcase), where it must point at a publicly reachable
// wss:// signaling server.
const SOCKET_URL = import.meta.env.VITE_SIGNALING_URL || window.location.origin;

// How long to wait for a signaling server before falling back to pairing tabs
// within this browser. A LAN server answers in well under this.
const SERVER_TIMEOUT_MS = 3000;

const SIGNAL_EVENTS = [
  'incoming-request',
  'request-response',
  'webrtc-offer',
  'webrtc-answer',
  'webrtc-ice',
];

/**
 * Connects to a signaling server when one is reachable, and otherwise falls
 * back to BroadcastChannel signaling between tabs of this browser.
 *
 * `mode` reports which transport is live:
 *   'connecting' — still looking for a server
 *   'server'     — a real signaling server; reaches other devices
 *   'local'      — tabs of this browser only (e.g. on a static host)
 *
 * A server always wins when one shows up, because it can reach other devices.
 */
export function useSocket() {
  const socketRef = useRef(null);
  const localRef = useRef(null);
  const listenersRef = useRef({});
  const modeRef = useRef('connecting');

  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState('connecting');
  const [selfInfo, setSelfInfo] = useState(null);
  const [peers, setPeers] = useState([]);

  useEffect(() => {
    let fallbackTimer = null;

    const enterMode = (next) => {
      modeRef.current = next;
      setMode(next);
    };

    const startLocal = () => {
      if (modeRef.current === 'server' || localRef.current) return;

      const local = new LocalSignaling({
        onSelf: (info) => setSelfInfo(info),
        onPeers: (list) => setPeers(list),
        onSignal: (event, payload) => listenersRef.current[event]?.(payload),
      });

      if (!local.start()) return; // No BroadcastChannel — stay "connecting".

      localRef.current = local;
      enterMode('local');
      setConnected(true);
    };

    const stopLocal = () => {
      localRef.current?.stop();
      localRef.current = null;
    };

    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      clearTimeout(fallbackTimer);
      stopLocal();
      setPeers([]);
      enterMode('server');
      setConnected(true);
    });

    socket.on('disconnect', () => {
      if (modeRef.current !== 'server') return;
      setPeers([]);
      setConnected(false);
      enterMode('connecting');
      fallbackTimer = setTimeout(startLocal, SERVER_TIMEOUT_MS);
    });

    socket.on('self-info', (info) => {
      if (modeRef.current === 'server') setSelfInfo(info);
    });

    socket.on('peers-updated', (list) => {
      if (modeRef.current !== 'server') return;
      const selfId = socketRef.current?.id;
      setPeers(list.filter((p) => p.id !== selfId));
    });

    SIGNAL_EVENTS.forEach((event) => {
      socket.on(event, (data) => {
        if (modeRef.current === 'server') listenersRef.current[event]?.(data);
      });
    });

    fallbackTimer = setTimeout(startLocal, SERVER_TIMEOUT_MS);

    return () => {
      clearTimeout(fallbackTimer);
      stopLocal();
      socket.disconnect();
    };
  }, []);

  const on = useCallback((event, handler) => {
    listenersRef.current[event] = handler;
  }, []);

  const emit = useCallback((event, data) => {
    if (modeRef.current === 'local') localRef.current?.emit(event, data);
    else socketRef.current?.emit(event, data);
  }, []);

  return { connected, selfInfo, peers, on, emit, socketRef, mode };
}
