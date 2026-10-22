/* Boplo Flight service worker: network first, so new deploys show straight away; the last good copy of the app shell is kept for when you're offline. API calls are never cached. */
const CACHE = 'boplo-shell-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })()));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || /^\/(flight|auth|api|darts|move)\//.test(url.pathname)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      throw err;
    }
  })());
});
// phone notifications: lesson reminders, forecasts, community messages and answers
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Boplo Flight', { body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: d.tag || undefined, data: { url: d.url || '/flight-app.html#overview' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/flight-app.html', self.location.origin).href;
  e.waitUntil((async () => { const all = await clients.matchAll({ type: 'window', includeUncontrolled: true }); for (const c of all) { if (new URL(c.url).pathname === new URL(url).pathname) { await c.focus(); c.navigate(url).catch(() => { }); return; } } await clients.openWindow(url); })());
});
