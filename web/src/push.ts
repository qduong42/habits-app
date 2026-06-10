// Web-push client helpers for the daily nudge (Profile → Notifications).
// The service worker (src/sw.ts) is only registered in production builds, so
// in `npm run dev` enabling push fails with a clear message.

import { apiFetch } from './api';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

/** VAPID public keys are base64url; PushManager wants raw bytes. */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** The browser's current push subscription, or null (also when unsupported). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Ask for permission, subscribe with the server's VAPID key, and store the
 * subscription server-side. Throws with a readable message on every failure
 * path (no SW in dev, permission denied, server 503 push_disabled — the
 * latter as an ApiError with code 'push_disabled').
 */
export async function enablePush(vapidKey: string): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    throw new Error('Service worker not registered (production build only)');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted');
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });
  await apiFetch('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription.toJSON()),
  });
}

/** Unsubscribe locally and forget the subscription server-side. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) await subscription.unsubscribe();
  await apiFetch('/push/subscribe', { method: 'DELETE' });
}
