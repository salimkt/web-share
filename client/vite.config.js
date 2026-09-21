import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // '/' for local + self-hosted LAN use. The GitHub Pages build sets
  // VITE_BASE=/web-share/ because Pages serves the site from a subpath.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Accessible from other devices on the LAN
    port: 5173,
    proxy: {
      '/socket.io': {
        // Use 127.0.0.1 (not "localhost"): on Node 17+ "localhost" resolves to
        // IPv6 ::1 first, but the signaling server listens on IPv4 (0.0.0.0),
        // which makes the WebSocket proxy fail with ECONNREFUSED ::1:3001.
        target: 'http://127.0.0.1:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
