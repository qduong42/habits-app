/// <reference lib="webworker" />
// Custom service worker (vite-plugin-pwa `injectManifest` strategy). One SW
// per scope, so this file does BOTH jobs: the app-shell precaching that the
// previous generateSW config produced, plus the push handlers for the daily
// nudge (spec "Daily Nudge Flow" step 3: tapping opens the Today tab).

import { clientsClaim } from 'workbox-core';
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

// registerType 'autoUpdate' semantics: a new SW activates immediately and
// takes over open tabs (what generateSW's skipWaiting/clientsClaim did).
self.skipWaiting();
clientsClaim();

// App shell only — the build assets injected at build time. The API stays
// network-only: /api is denylisted from the SPA navigation fallback and has
// no runtime caching rules.
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api/] }),
);

interface NudgePayload {
  title: string;
  body?: string;
  url?: string;
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload: NudgePayload;
  try {
    payload = event.data.json() as NudgePayload;
  } catch {
    return; // not our JSON payload — ignore
  }
  if (!payload.title) return;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  event.waitUntil(
    (async () => {
      // Focus an open app window when there is one, otherwise open a new one.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => 'focus' in client);
      if (existing) {
        await existing.focus();
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
