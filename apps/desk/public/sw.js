// Shell-only service worker. Only same-origin GET requests for /assets/* and the navigation to / are handled;
// everything else (API, stream, authorized requests, non-GET) is left to the network untouched.
const CACHE = "openag-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.headers.has("authorization")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (req.mode === "navigate" && url.pathname === "/") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          if (res.ok) cache.put("/", res.clone());
          return res;
        } catch {
          const cached = await cache.match("/");
          if (cached) return cached;
          throw new Error("offline and no cached shell");
        }
      })(),
    );
  }
});
