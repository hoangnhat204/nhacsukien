// Service Worker cho Trình Phát Nhạc Sự Kiện NIX BÙI
// Phiên bản v14 - Hỗ trợ cài đặt PWA trên iPhone, iPad, Android và Desktop
const CACHE_NAME = 'nhac-su-kien-v14';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './audio-engine.js',
  './audio-db.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg'
];

// 1. Cài đặt Service Worker và lưu cache từng tài nguyên độc lập
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Dùng Promise.allSettled để dù bất kỳ file nào có sự cố thì các file còn lại vẫn lưu thành công
      const cachePromises = ASSETS_TO_CACHE.map(async (asset) => {
        try {
          const response = await fetch(asset, { cache: 'no-cache' });
          if (response && response.status === 200) {
            await cache.put(asset, response);
          }
        } catch (err) {
          console.warn('[SW] Cảnh báo nạp cache cho asset:', asset, err);
        }
      });
      await Promise.allSettled(cachePromises);
    }).then(() => self.skipWaiting())
  );
});

// 2. Kích hoạt SW và dọn dẹp triệt để các cache phiên bản cũ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Xóa cache cũ:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Xử lý bắt yêu cầu Fetch (Chiến lược Cache First & Stale-While-Revalidate)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;

  // A. Xử lý Google Fonts: Cache-first, nếu offline trả về CSS an toàn không làm treo trình duyệt
  if (url.origin.includes('fonts.googleapis.com') || url.origin.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((networkResp) => {
          if (networkResp && networkResp.status === 200) {
            const clone = networkResp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResp;
        }).catch(() => {
          // Trả về CSS rỗng để trình duyệt không chờ đợi hay báo lỗi màn hình trắng
          return new Response('/* Offline fallback for Google Fonts */', {
            status: 200,
            headers: { 'Content-Type': 'text/css' }
          });
        });
      })
    );
    return;
  }

  // B. Xử lý yêu cầu điều hướng (Khi mở PWA từ màn hình hoặc tải lại trang F5)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
        if (cachedResponse) {
          // Trả về ngay lập tức trang trong cache (0ms), đồng thời cập nhật ngầm nếu có mạng
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }

        // Nếu chưa có trong cache, fetch từ mạng
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(async () => {
            // Khi không có mạng, fallback về file index.html đã lưu trong cache
            return (
              (await caches.match('./index.html', { ignoreSearch: true })) ||
              (await caches.match('./', { ignoreSearch: true })) ||
              (await caches.match('index.html', { ignoreSearch: true }))
            );
          });
      })
    );
    return;
  }

  // C. Xử lý các tài nguyên tĩnh nội bộ (CSS, JS, Icon, Manifest...)
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      // Ưu tiên lấy từ cache ngay lập tức (Cache First) để hoạt động ngoại tuyến 100%
      if (cachedResponse) {
        // Cập nhật ngầm trong nền (Stale-While-Revalidate) nếu đang có mạng
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      // Nếu chưa có trong cache, tải từ mạng và tự động lưu vào cache cho lần sau
      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Trả về phản hồi lỗi chuẩn khi mất mạng và file không có trong cache
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
    })
  );
});
