// Vinsieme push worker (2026-07-26)
// ==================================
//
// Why this file exists: the drink-window reminders (Paket 7) used to be
// appended to Flutter's own `flutter_service_worker.js` by
// tool/deploy-pwa.sh. Recent Flutter versions ship that file as a
// DEPRECATED SELF-UNREGISTERING STUB — its `activate` handler calls
// `self.registration.unregister()`. Appending push handlers to a worker
// that tears itself down means web push silently stopped working: the
// subscription's registration disappears moments after activation.
//
// This worker is ours, has no fetch handler, caches nothing, and never
// unregisters. `PushService` (lib/src/push/push_service_web.dart) reaches
// it through `navigator.serviceWorker.ready`, so nothing on the Dart side
// needs to know which worker answered.

self.addEventListener('install', () => {
  // Take over immediately rather than waiting for every tab to close --
  // otherwise a fresh subscription can sit unusable until the next visit.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Drink-window reminder sent by the drink-window-push Edge Function as a
// {title, body, url} JSON payload. Tolerant of a missing or unparseable
// body so a malformed push still surfaces something rather than nothing.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Vinsieme', {
      body: data.body || '',
      icon: '/icons/Icon-192.png',
      badge: '/icons/Icon-192.png',
      // The app now lives under /app/ (the site root is the landing page),
      // so a tapped reminder must open the app, not the marketing page.
      data: { url: data.url || '/app/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/app/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })()
  );
});
