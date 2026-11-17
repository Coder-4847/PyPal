/* PyPal service worker (generated into dist/sw.js at build time; see scripts/vite-plugin-pypal.ts).
 *
 * Two jobs:
 * 1. Cross-origin isolation. GitHub Pages cannot send COOP/COEP headers, and SharedArrayBuffer
 *    (Stop and input()) needs them, so every response is re-served with the right headers.
 * 2. Offline. The app shell, the pinned Pyodide core and any package wheel that was used once are
 *    cached, so PyPal works with no connection after the first visit.
 */
const VERSION = '__VERSION__';
const PYODIDE_VERSION = '__PYODIDE_VERSION__';
const PRECACHE = __PRECACHE__;

const ROOT = new URL('./', self.location.href).href;
const SHELL = `pypal-shell-${VERSION}`;
const PYODIDE = `pypal-pyodide-${PYODIDE_VERSION}`; // survives app updates: it only changes with Pyodide itself
const WHEELS = 'pypal-wheels-v1'; // packages from the Pyodide CDN, keyed by their versioned URL
const META = 'pypal-meta';
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await cache.addAll([ROOT, ...PRECACHE.map((p) => new URL(p, ROOT).href)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep the previous shell too: a page that is still open may lazy-load its old, hashed chunks.
      const meta = await caches.open(META);
      const prev = await meta.match('versions');
      const known = prev ? await prev.json().catch(() => []) : [];
      const keep = [VERSION, ...known.filter((v) => v !== VERSION)].slice(0, 2);
      await meta.put('versions', new Response(JSON.stringify(keep)));
      for (const name of await caches.keys()) {
        if (name.startsWith('pypal-shell-') && !keep.some((v) => name === `pypal-shell-${v}`)) await caches.delete(name);
        if (name.startsWith('pypal-pyodide-') && name !== PYODIDE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** Re-serve a response with the headers that make the page cross-origin isolated. */
function isolate(res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const cacheable = (res) => res && res.ok && res.status === 200 && (res.type === 'basic' || res.type === 'cors');

// Files are keyed by URL alone: a Vary header (some servers send Vary: Origin) must not cause a miss
// just because a script load and a fetch() differ in their request headers.
const MATCH = { ignoreVary: true };

async function cacheFirst(req, cacheName, lookupAll) {
  const hit = lookupAll ? await caches.match(req, MATCH) : await (await caches.open(cacheName)).match(req, MATCH);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), NAV_TIMEOUT_MS)),
    ]);
    if (cacheable(res)) cache.put(fallbackKey ?? req, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(fallbackKey ?? req, { ignoreSearch: true, ...MATCH })) ?? (await caches.match(fallbackKey ?? req, { ignoreSearch: true, ...MATCH }));
    if (hit) return hit;
    // A slow (not failed) network and nothing cached: wait for the real answer.
    return fetch(req).catch(() => { throw err; });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POSTs (such as the optional AI call) go straight to the network
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (!url.href.startsWith(ROOT)) return;
    const rel = url.href.slice(ROOT.length);
    event.respondWith(
      (async () => {
        let res;
        if (req.mode === 'navigate') res = await networkFirst(req, SHELL, ROOT);
        else if (rel.startsWith('pyodide/')) res = await cacheFirst(req, PYODIDE, false);
        else if (rel.startsWith('assets/')) res = await cacheFirst(req, SHELL, true);
        else if (rel === 'sw.js') res = await fetch(req);
        else res = await networkFirst(req, SHELL);
        return isolate(res);
      })().catch(() => Response.error()),
    );
    return;
  }

  // Python packages (numpy and friends) come from the Pyodide CDN; keep each one once it has been used.
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('/pyodide/')) {
    event.respondWith(cacheFirst(req, WHEELS, false).catch(() => Response.error()));
  }
});
