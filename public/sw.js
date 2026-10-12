/*
 * HOLLOW website service worker: shows the order and offer notifications the
 * server sends (Web Push) and opens the right page when one is tapped.
 * It doesn't cache anything; the site always loads fresh from the network.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "HOLLOW";
  const options = {
    body: data.body || "",
    icon: "/brand/icon-192.png",
    badge: "/brand/badge-96.png",
    dir: "auto",
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/menu" },
  };
  // A newer update for the same order replaces the older notification.
  if (data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/menu";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        // The page routes there itself, without reloading.
        open.postMessage({ type: "hollow:open", url });
        return open.focus();
      }
      return self.clients.openWindow(url);
    })(),
  );
});
