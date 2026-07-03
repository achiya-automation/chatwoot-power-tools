// Service Worker מינימלי — נדרש להתקנה כ-PWA + fallback offline לקליפה.
// ⚠️ לא נוגע ב-/drip-api (תמיד רשת) — רק ניווטים מקבלים fallback ל-shell.
const CACHE = 'drip-shell-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.add('/index.html')).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then((ks) =>
        Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
  }
});
