/* Service worker — offline support when hosted.
   Same-origin: network-first (updates always win), cache fallback offline.
   CDN libraries (version-pinned): cache-first. */
const CACHE = 'vcfgen-v3';
const SHELL = [
  '.', 'index.html', 'css/style.css', 'manifest.json', 'assets/icon.svg',
  'js/vcard.js', 'js/form.js', 'js/preview.js', 'js/qr.js', 'js/ocr.js',
  'js/card-detect.js', 'js/card-parser.js', 'js/scanner.js', 'js/ai-scan.js',
  'js/contacts.js', 'js/bulk.js', 'js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (url.origin === location.origin) {
    // network-first: fresh app when online, cached shell offline
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html')))
    );
  } else if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com' ||
             url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // pinned library versions & OCR language data: cache-first
    e.respondWith(
      caches.match(e.request).then(hit => hit ||
        fetch(e.request).then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
      )
    );
  }
});
