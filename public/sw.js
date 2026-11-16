/* PyPal service worker.
 * GitHub Pages cannot send COOP/COEP headers, and SharedArrayBuffer (used for
 * Stop and input()) needs cross-origin isolation. This worker re-serves every
 * response with the right headers. Phase 3 adds offline caching here too. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.status === 0 || res.type === 'opaque') return res;
        const headers = new Headers(res.headers);
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      })
      .catch((err) => Response.error() || err),
  );
});
