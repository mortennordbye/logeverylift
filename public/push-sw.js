/*
 * Service worker for ride step alerts (docs/plans/bike-ride-logger.md, 4.7).
 *
 * Push only: no fetch handler, no caching. Registered with the scope "/push/"
 * when the rider turns step alerts on (src/lib/push-client.ts), so it controls
 * no page and never changes how the app loads. Plain JavaScript in public/,
 * so it is served as it is in dev, e2e and prod (the Serwist worker in
 * src/app/sw.ts is not emitted by the Turbopack build).
 *
 * The payload is { title, body, tag, url } (`PushPayload` in
 * src/lib/utils/ride-pushes.ts). Every push shows a notification: Safari can
 * take push access away from a site whose push shows nothing.
 */

/** The notification for a push payload; a payload that does not parse still shows one. */
function notificationFromPayload(data) {
  let p = null;
  try {
    p = data ? data.json() : null;
  } catch {
    p = null;
  }
  const title = p && typeof p.title === "string" && p.title ? p.title : "LogEveryLift";
  const url = p && typeof p.url === "string" && p.url.startsWith("/") ? p.url : "/";
  const options = {
    body: p && typeof p.body === "string" ? p.body : "",
    icon: "/icon-192x192.png",
    badge: "/icon-192x192.png",
    data: { url },
  };
  if (p && typeof p.tag === "string" && p.tag) {
    // One tag per ride: a new alert replaces the one before, and still sounds.
    options.tag = p.tag;
    options.renotify = true;
  }
  return { title, options };
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("push", (event) => {
  const { title, options } = notificationFromPayload(event.data);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url === target);
      if (open && "focus" in open) return open.focus();
      return self.clients.openWindow(target);
    }),
  );
});
