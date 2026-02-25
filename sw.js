const CACHE_NAME = 'event-leader-v1';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/config.js',
    './js/db.js',
    './js/app.js',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((res) => res || fetch(e.request))
    );
});
