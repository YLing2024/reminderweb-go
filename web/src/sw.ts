/// <reference lib="webworker" />
/**
 * 自定义 Service Worker（vite-plugin-pwa injectManifest 策略）。
 *
 * - 预缓存构建产物，离线可用（generateSW 之外保留自定义通知兜底能力）。
 * - 页面不可见 / 已关闭时，由页面 postMessage 触发展示系统通知。
 * - SPA 深链离线导航回退到 index.html。
 */
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// 新版本立即接管：否则新 SW 要等到所有标签页都关闭才激活，用户会一直拿到旧构建的预缓存。
self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

interface ShowNotificationMessage {
  type: 'SHOW_NOTIFICATION';
  title: string;
  body: string;
  tag?: string;
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as ShowNotificationMessage | undefined;
  if (data !== undefined && data.type === 'SHOW_NOTIFICATION') {
    event.waitUntil(
      self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.tag,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
      }),
    );
  }
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return (client as WindowClient).focus();
      }
      return self.clients.openWindow('/');
    }),
  );
});

// SPA 深链：离线时导航请求回退到已预缓存的 index.html。
self.addEventListener('fetch', (event: FetchEvent) => {
  if (event.request.mode !== 'navigate') return;
  const url = new URL(event.request.url);
  // 精确 /index.html 交给 workbox 预缓存，避免重复 respondWith。
  if (url.pathname.endsWith('/index.html')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) return response;
        return caches.match('/index.html').then((cached) => cached ?? response);
      })
      .catch(async () => {
        const cached = await caches.match('/index.html');
        return cached ?? Response.error();
      }),
  );
});
