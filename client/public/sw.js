/* WebShare service worker — offline support.
 *
 * Once a device has loaded the app once, it keeps working with no internet at
 * all. That's the whole point: peers are discovered through a signaling server
 * on the local network, and the file bytes travel directly device-to-device
 * over WiFi via WebRTC. Nothing but the app shell ever needs to be fetched,
 * so caching the shell is enough to go fully offline.
 *
 * Strategy: cache-first for same-origin GETs. Bump CACHE to ship an update.
 */

const CACHE = 'webshare-v2';

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for existing tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never touch signaling traffic (socket.io polling) or cross-origin requests
  // such as the Google Fonts stylesheet — the CSS ships a full local font
  // fallback stack, so missing fonts degrade gracefully offline.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/socket.io')) return;

  // The app shell: network-first, so a new deploy is picked up as soon as the
  // device is online. Cache-first here would pin every returning visitor to
  // whatever build they first loaded.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            const cache = await caches.open(CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch (err) {
          const cached =
            (await caches.match(request)) ||
            (await caches.match(new URL('index.html', self.registration.scope).href));
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  // Build assets carry a content hash in their name, so they're immutable —
  // cache-first is both safe and the fastest path offline.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response && response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
