// Service worker: makes repeat visits instant and keeps the site usable offline or on a weak signal.
//   App files (HTML, CSS, JS, fonts): served from the phone's cache straight away, refreshed in the background.
//   Data (JSON): fetched fresh when the network answers within a few seconds, otherwise the saved copy is used.
//   Lap telemetry: rarely changes, so the saved copy is used first.
const SHELL = "plg-shell-v4";
const DATA = "plg-data-v1";
const SHELL_FILES = [
  "./", "index.html", "css/style.css",
  "js/app.js", "js/ui.js", "js/charts.js", "js/icons.js", "js/avatars.js", "js/strategy.js", "js/snapshot.js",
  "js/pages/home.js", "js/pages/races.js", "js/pages/race.js", "js/pages/compare.js", "js/pages/form.js",
  "js/pages/standings.js", "js/pages/drivers.js", "js/pages/learn.js", "js/pages/accuracy.js",
  "fonts/atkinson-hyperlegible-latin-400-normal.woff2", "fonts/atkinson-hyperlegible-latin-700-normal.woff2",
  "fonts/big-shoulders-display-latin-700-normal.woff2", "fonts/big-shoulders-display-latin-800-normal.woff2",
];
const NETWORK_TIMEOUT_MS = 3500;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || fresh;
  });
}

function networkFirst(req) {
  return caches.open(DATA).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
    if (!cached) return network;
    const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
    return Promise.race([network.catch(() => cached), timeout]);
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes("/data/")) {
    e.respondWith(url.pathname.includes("/tel/") ? staleWhileRevalidate(req, DATA) : networkFirst(req));
  } else {
    e.respondWith(staleWhileRevalidate(req, SHELL));
  }
});
