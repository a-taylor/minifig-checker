// Bump VERSION whenever any file below changes so phones pick up the update.
const VERSION = "v4";
const CACHE = `minifig-checker-${VERSION}`;
const FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-180.png",
  "icons/icon-512.png",
  "vendor/zxing-reader.js",
  "vendor/zxing_reader.wasm",
];

self.addEventListener("install", (e) => {
  // cache: "reload" skips the browser's HTTP cache, which could otherwise hand back stale files.
  const requests = FILES.map((f) => new Request(f, { cache: "reload" }));
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
