/**
 * Service worker for the PWA.
 *
 * Hand written (vite-plugin-pwa `injectManifest` strategy) because we need something a
 * generated worker cannot do: accept a **POST multipart/form-data** upload, which is how
 * Android delivers a photo that another app shares with us (Web Share Target).
 *
 * Everything else is the classic app-shell dance: precache the build output, serve
 * navigations from the cache when offline, and leave third-party traffic (OSM tiles,
 * Nominatim) untouched.
 */

import { putSharedPhoto } from './modules/inbox.js';

/** Replaced at build time with the list of assets to precache. */
const PRECACHE = self.__WB_MANIFEST || [];
const CACHE_NAME = 'image-coordinate-shell';
/** Must match `manifest.share_target.action` in vite.config.js. */
const SHARE_PATH = 'share-target';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const urls = PRECACHE.map((entry) => (typeof entry === 'string' ? entry : entry.url)).filter(
        Boolean,
      );
      // addAll rejects the whole install when one file is missing, so tolerate gaps.
      await Promise.all(urls.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. A photo shared from another app arrives as a POST to the share target.
  if (request.method === 'POST' && url.pathname.endsWith(SHARE_PATH)) {
    event.respondWith(handleShareTarget(request));
    return;
  }

  // 2. Never touch cross-origin traffic (map tiles, geocoding) or non-GET requests.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // 3. Navigations: network first, cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // 4. Assets: cache first (they are hashed by the build), network as a fallback.
  event.respondWith(handleAsset(request));
});

/**
 * Reads the shared file, parks it in the inbox and sends the user into the app.
 *
 * @returns {Promise<Response>}
 */
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('photo');
    if (file && typeof file === 'object' && file.size > 0) {
      await putSharedPhoto(file, { name: file.name ?? null, type: file.type ?? null });
    }
  } catch (error) {
    console.warn('[sw] share-target: the shared photo could not be read', error);
  }
  return Response.redirect('./?shared=1', 303);
}

async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const shellUrl = new URL('index.html', self.registration.scope).href;

  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(shellUrl, response.clone());
    return response;
  } catch {
    const cached = await cache.match(shellUrl);
    return cached ?? Response.error();
  }
}

async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Only same-origin, successful, non-opaque responses are worth caching.
  if (response && response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}
