import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

// Default to the origin the page was served from. When the Node server serves
// the built client (the offline/LAN mode), that origin IS the signaling server,
// so this works with no internet and no configuration.
//
// VITE_SIGNALING_URL is only needed when the UI is hosted somewhere else (e.g.
// a GitHub Pages showcase), where it must point at a publicly reachable
// wss:// signaling server.
const SOCKET_URL = import.meta.env.VITE_SIGNALING_URL || window.location.origin;

export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [selfInfo, setSelfInfo] = useState(null);
  const [peers, setPeers] = useState([]);
  const listenersRef = useRef({});

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('self-info', setSelfInfo);
    socket.on('peers-updated', (list) => {
      // Exclude ourselves from the peer list
      setPeers((prev) => {
        const selfId = socketRef.current?.id;
        return list.filter((p) => p.id !== selfId);
      });
    });

    // Forward all signaling events to registered listeners
    const events = [
      'incoming-request',
      'request-response',
      'webrtc-offer',
      'webrtc-answer',
      'webrtc-ice',
    ];
    events.forEach((event) => {
      socket.on(event, (data) => {
        listenersRef.current[event]?.(data);
      });
    });

    return () => socket.disconnect();
  }, []);

  const on = useCallback((event, handler) => {
    listenersRef.current[event] = handler;
  }, []);

  const emit = useCallback((event, data) => {
    socketRef.current?.emit(event, data);
  }, []);

  return { connected, selfInfo, peers, on, emit, socketRef };
}
