// Tiene l'app salvata sul telefono, così si apre anche senza rete.
const VERSION = '202611262046';
const CACHE = `viaggi-moto-${VERSION}`;
const FILES = ['./', 'index.html', `app.js?v=${VERSION}`, 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' scavalca la cache del browser, così non salviamo file di una versione vecchia.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Firebase passa diretto
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((r) => r || fetch(e.request)));
    return;
  }
  // Se manca la versione esatta, va bene anche quella salvata con un altro numero di versione.
  e.respondWith(
    caches.match(e.request)
      .then((r) => r || caches.match(e.request, { ignoreSearch: true }))
      .then((r) => r || fetch(e.request)),
  );
});
