/* Precache URL policy (mirrored in lib/offlineAssets.ts): same origin only,
 * no username or password, no '..' or backslashes in the decoded input path,
 * and only /audio/, /ir/, or exactly /packs.json. Check before URL normalization.
 * Icons and Next static files are cached by fetch, never accepted via messages.
 */
const CACHE_VERSION = "kairos-offline-v1";
const APP_ROUTES = ["/", "/pomodoro", "/timer", "/stopwatch", "/settings", "/credit"];

function isPrecacheableUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const path = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    if (path.includes("..") || path.includes("\\")) return false;
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin && !url.username && !url.password &&
      (url.pathname.startsWith("/audio/") || url.pathname.startsWith("/ir/") ||
        url.pathname === "/packs.json");
  } catch {
    return false;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.status !== 206) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const home = await cache.match("/");
      if (home) return home;
    }
    throw error;
  }
}

// Preload every screen and its JS/CSS/font dependencies, including unvisited screens.
async function cacheAppShell() {
  const seen = new Set();
  async function saveAsset(value) {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin || seen.has(url.href)) return;
    seen.add(url.href);
    const response = await cacheFirst(url.href);
    if (!response.ok) throw new Error(`Cannot cache ${url.pathname}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/css")) return;
    const source = await response.text();
    const dependencies = source.matchAll(/(?:src|href)=["']([^"']+)["']|url\(["']?([^\s)"']+)/g);
    for (const match of dependencies) {
      const asset = new URL(match[1] || match[2], url);
      if (asset.pathname.startsWith("/_next/static/")) await saveAsset(asset.href);
    }
  }
  for (const route of APP_ROUTES) {
    await saveAsset(route);
    // Static export uses text payloads for client-side navigation.
    await cacheFirst(route === "/" ? "/index.txt" : `${route}.txt`);
  }
  await cacheFirst("/packs.json");
  await cacheFirst("/icons/icon-192.png");
  await cacheFirst("/icons/icon-512.png");
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE_VERSION) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  } else if (url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") || isPrecacheableUrl(request.url)) {
    event.respondWith(cacheFirst(request));
  } else if (url.pathname.endsWith(".txt")) {
    // Next's cache-busting query must not prevent reuse of the exported payload.
    event.respondWith(networkFirst(new Request(url.origin + url.pathname)));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "precache" || !Array.isArray(event.data.urls)) return;
  event.waitUntil((async () => {
    for (const url of event.data.urls) {
      if (!isPrecacheableUrl(url)) continue;
      try {
        await cacheFirst(url);
      } catch {
        // A missing asset must not prevent the remaining themes from being saved.
      }
    }
  })());
});
