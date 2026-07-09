/**
 * Notification abstraction layer.
 *
 * Currently uses the browser Notification API (works in-app / same web view).
 * To add out-of-app push later:
 *   1. Register a Service Worker in `registerServiceWorker()`
 *   2. Subscribe to push via `pushManager.subscribe()`
 *   3. Send via your server in `sendNotification()` using the subscription
 *
 * All callers use only `requestPermission()` and `sendNotification()` —
 * the upgrade to push requires no changes outside this file.
 */

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function notificationsGranted(): boolean {
  return typeof window !== "undefined" && Notification.permission === "granted";
}

export function sendNotification(title: string, body: string): void {
  if (!notificationsGranted()) return;
  try {
    new Notification(title, { body, icon: "/icon-192x192.png", badge: "/icon-192x192.png" });
  } catch {
    // Some browsers throw if called outside a user gesture — silently ignore
  }
}
