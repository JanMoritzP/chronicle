// Minimal service worker: makes the app installable (needed for the share target). Data caching lives in IndexedDB.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
