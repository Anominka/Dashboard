"use strict";

/* Makes the app start without a network (there is often no signal in a car).
 *
 * Every file is stored on the first visit. After that each request tries the network first,
 * so a new version arrives as soon as the phone is online, and falls back to the stored copy
 * when it is not. tests/check_files.js makes sure FILES lists every file of the app.
 */

const CACHE = "dashboard-files";

const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "theme.css",
  "style.css",
  "telemetry.js",
  "simulated_source.js",
  "gps_reader.js",
  "motion.js",
  "performance.js",
  "trip_tracker.js",
  "store.js",
  "widgets.js",
  "keep_awake.js",
  "live_page.js",
  "trip_page.js",
  "performance_page.js",
  "history_page.js",
  "diagnostics_page.js",
  "settings_page.js",
  "app.js",
  "fonts/BarlowSemiCondensed-Medium.ttf",
  "fonts/BarlowSemiCondensed-SemiBold.ttf",
  "fonts/BarlowSemiCondensed-Bold.ttf",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // offline: the stored copy; "/?sim" and "/?demo" are the same page as "/"
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
