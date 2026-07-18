'use strict';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration.unregister();
      } catch (e) {
        console.warn('Failed to unregister the service worker:', e);
      }

      try {
        const clients = await self.clients.matchAll({
          type: 'window',
        });
        // Reload clients to ensure they are not using the old service worker.
        clients.forEach((client) => {
          if (client.url && 'navigate' in client) {
            client.navigate(client.url);
          }
        });
      } catch (e) {
        console.warn('Failed to navigate some service worker clients:', e);
      }
    })()
  );
});

// ---- takeover (appended by tool/deploy-pwa.sh) ----------------------
// Activate freshly installed updates immediately and refresh open
// clients once, instead of waiting for every window to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: "window" });
    for (const client of windows) {
      try { await client.navigate(client.url); } catch (_) {}
    }
  })());
});

// Web push (Paket 7): show the drink-window reminder sent by the
// drink-window-push Edge Function ({title, body, url} JSON payload,
// tolerant of a missing/unparseable body), and focus an existing app
// window on tap - or open a fresh one.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification(
    data.title || "Vinsieme",
    {
      body: data.body || "",
      icon: "icons/Icon-192.png",
      data: { url: data.url || "/" },
    },
  ));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll(
      { type: "window", includeUncontrolled: true },
    );
    for (const client of windows) {
      if ("focus" in client) { return client.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
