// SightLoop Admin service worker.
//
// It does one thing: when a page navigation cannot reach the Admin server
// (Docker stopped, container restarting), answer with a small offline page
// instead of the browser error screen. That matters for the installed app,
// which has no address bar to retry from.
//
// It deliberately caches no scripts, styles or API responses. The Admin is
// served by a Vite dev server whose module URLs are not versioned, so caching
// them would serve stale code, and every screen needs the live Daemon anyway.

const CACHE = "sightloop-admin-offline-v1";
const OFFLINE_URL = "/offline.html";
const ICON_URL = "/icons/icon.svg";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // cache: "reload" bypasses the HTTP cache so an update really refetches.
      await cache.addAll(
        [OFFLINE_URL, ICON_URL].map(
          (url) => new Request(url, { cache: "reload" }),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("sightloop-admin-") && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** The cached URL to answer with when the network fails, or null to stay out of the way. */
function fallbackFor(request) {
  if (request.mode === "navigate") return OFFLINE_URL;
  const url = new URL(request.url);
  // The offline page's icon is the only subresource served from the cache.
  if (url.origin === self.location.origin && url.pathname === ICON_URL) {
    return ICON_URL;
  }
  return null;
}

self.addEventListener("fetch", (event) => {
  const fallback = fallbackFor(event.request);
  if (!fallback) return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(fallback)) ?? Response.error();
      }
    })(),
  );
});
