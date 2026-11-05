/* LUMEN © 2026 Rustem Tukhbetov. All rights reserved. https://creativeoglu.com */
// Keeps a copy of the app on the device, so after one visit it opens with no internet.
// The copy is used first and refreshed in the background, so a new version shows on the next launch.

const CACHE = 'lumen-0.6.0';
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './css/app.css',
  './js/audio.js',
  './js/clock.js',
  './js/lights/adapters.js',
  './js/lights/ble-probe.js',
  './js/lights/color.js',
  './js/lights/engine.js',
  './js/lights/modes.js',
  './js/lights/scheduler.js',
  './js/main.js',
  './js/ui.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    return (await fresh) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }));
});
