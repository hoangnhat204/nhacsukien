// Service Worker cho Trình Phát Nhạc Sự Kiện NIX BÙI
const CACHE_NAME = 'nhac-su-kien-v1';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './audio-engine.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg'
];

// Cài đặt Service Worker và lưu cache các tài nguyên cốt lõi
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Cache addAll warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Kích hoạt SW và dọn dẹp cache cũ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Chiến lược Fetch: Network First, fallback to Cache khi mất mạng
self.addEventListener('fetch', (event) => {
  // Bỏ qua các yêu cầu không phải GET hoặc chrome-extension
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Nếu lấy thành công từ mạng, cập nhật vào cache cho tài nguyên cùng domain
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Khi mất mạng hoặc không kết nối được, trả về từ cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Nếu yêu cầu trang HTML điều hướng thì trả về trang chủ
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
