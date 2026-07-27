// Vinsieme Service Worker
// =======================
//
// Zwei Aufgaben, beide nachtraeglich entstanden:
//
// 1. WEB-PUSH (2026-07-26). Die Trinkreife-Erinnerungen wurden bis dahin
//    von tool/deploy-pwa.sh an Flutters `flutter_service_worker.js`
//    angehaengt. Neuere Flutter-Versionen liefern das als VERALTETEN,
//    SICH SELBST DEREGISTRIERENDEN Stub aus -- sein `activate` ruft
//    `self.registration.unregister()`. Handler auf einem Worker, der sich
//    abbaut, feuern nie; die Erinnerungen waren still tot.
//
// 2. OFFLINE-BETRIEB (2026-07-27). Aus demselben Grund speicherte
//    NICHTS die App-Huelle zwischen: Flutters Stub cacht nicht, und
//    dieser Worker hatte bewusst keinen Fetch-Handler. Der Bestand liegt
//    zwar lokal (sqlite in IndexedDB), aber wer den Tab schloss und ohne
//    Verbindung zurueckkam, sah die Offline-Seite des Browsers. Auf
//    vinsieme.app steht seit jeher „funktioniert offline", und die
//    Einfuehrung sagt „Nachschlagen, entnehmen und umlagern klappt auch
//    ohne Empfang". Genau das ging nicht.
//
// Strategie: NETWORK FIRST, Cache als Rueckfall.
//
// Nicht cache-first, obwohl das schneller waere: hier wird mehrmals
// taeglich ausgerollt, und ein Cache, der gewinnt, haelt Nutzer auf
// altem Stand fest -- ein Fehler, den man erst bemerkt, wenn jemand einen
// laengst behobenen Fehler meldet. Online gewinnt immer das Netz; der
// Cache traegt genau den Fall, fuer den er da ist.

const CACHE = 'vinsieme-shell-v1';

// Die Huelle, die einen Kaltstart ohne Verbindung traegt. Bewusst kurz:
// alles Weitere kommt beim ersten Online-Besuch von selbst in den Cache
// (siehe `fetch` unten). Ein langer Precache waere eine Liste, die bei
// jeder Flutter-Aktualisierung stillschweigend falsch wird.
const SHELL = [
  '/app/',
  '/app/index.html',
  '/manifest.json',
  '/favicon.png',
];

self.addEventListener('install', (event) => {
  // Sofort uebernehmen statt zu warten, bis jeder Tab geschlossen ist --
  // sonst kann ein frisches Push-Abo bis zum naechsten Besuch unbrauchbar
  // bleiben.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // `reload`, damit der Precache nicht seinerseits aus dem
      // HTTP-Cache des Browsers kommt und Veraltetes einfriert.
      cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))
        .catch(() => {
          // Ein fehlgeschlagener Precache darf die Installation nicht
          // verhindern -- der Worker ist auch ohne ihn nuetzlich, er
          // fuellt sich dann eben unterwegs.
        })
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Caches frueherer Fassungen wegraeumen (CACHE traegt die Version).
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('vinsieme-shell-') && name !== CACHE)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

/// Was ueberhaupt zwischengespeichert werden darf.
///
/// Ausgeschlossen bleiben: fremde Hosts (Supabase, PowerSync -- deren
/// Antworten sind nutzerbezogen und teils personenbezogen, die haben in
/// einem geteilten Cache nichts verloren), alles ausser GET, und
/// Bereichsanfragen (Range), weil eine Teilantwort als vollstaendige
/// zurueckzugeben Videos und grosse Dateien zerlegt.
function isCacheable(request) {
  if (request.method !== 'GET') return false;
  if (request.headers.has('range')) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return url.protocol === 'https:' || url.protocol === 'http:';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!isCacheable(request)) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        // Nur vollstaendige, eigene Antworten ablegen. `opaque` (status 0)
        // und Fehlerseiten wuerden sonst als gueltiger Inhalt
        // zurueckgegeben.
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      } catch (_) {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Ein Seitenaufruf ohne Treffer faellt auf die App-Huelle zurueck
        // -- besser die App mit lokalem Bestand als die Fehlerseite des
        // Browsers.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/app/');
          if (shell) return shell;
        }
        throw _;
      }
    })()
  );
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
