/* Atlas PWA worker: caches only public, non-sensitive assets. */
const ATLAS_SW_VERSION = "atlas-pwa-v1";
const STATIC_CACHE = `${ATLAS_SW_VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [
  OFFLINE_URL,
  "/icons/atlas-192.png",
  "/icons/atlas-512.png",
  "/icons/atlas-maskable-192.png",
  "/icons/atlas-maskable-512.png",
  "/icons/atlas-apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("atlas-pwa-") && key !== STATIC_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage({ type: "ATLAS_SW_VERSION", version: ATLAS_SW_VERSION });
  }
  if (event.data?.type === "CLEAR_STATIC_CACHE") {
    event.waitUntil(
      caches.delete(STATIC_CACHE)
        .then(() => caches.open(STATIC_CACHE))
        .then((cache) => cache.addAll(PRECACHE)),
    );
  }
});

function isSafeStaticAsset(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/assets/atlas/") ||
    url.pathname.startsWith("/login/") ||
    ["/favicon.ico", "/file.svg", "/globe.svg", "/next.svg", "/vercel.svg", "/window.svg"]
      .includes(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (!isSafeStaticAsset(url)) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    }),
  );
});

// Push is prepared but permission/subscription is only requested by explicit user action.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(payload.title || "Atlas", {
    body: payload.body || "Você tem uma atualização no Atlas.",
    icon: "/icons/atlas-192.png",
    badge: "/icons/atlas-badge.png",
    data: { url: typeof payload.url === "string" ? payload.url : "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  const safeUrl = target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    return existing ? existing.focus().then(() => existing.navigate(safeUrl)) : clients.openWindow(safeUrl);
  }));
});
