// Mesynx AI Service Worker
// Strategy:
//   Static assets (/_next/static/, icons, fonts) → cache-first (fingerprinted, safe forever)
//   Everything else (navigation, API routes)     → network-first (never serve stale auth/data)

const CACHE_NAME = "mesynx-ai-v1";

const STATIC_PATTERNS = [
    /^\/_next\/static\//,
    /\.(png|jpg|jpeg|svg|ico|webp|woff2?|ttf|otf)(\?.*)?$/,
];

function isStaticAsset(url) {
    const path = new URL(url).pathname + new URL(url).search;
    return STATIC_PATTERNS.some((re) => re.test(path));
}

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    // Purge old caches when a new SW version activates.
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => k !== CACHE_NAME)
                        .map((k) => caches.delete(k)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    // Only intercept GET requests from this origin.
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    if (isStaticAsset(event.request.url)) {
        // Cache-first: Next.js static assets are content-hashed — safe to cache forever.
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) =>
                cache.match(event.request).then((cached) => {
                    if (cached) return cached;
                    return fetch(event.request).then((response) => {
                        if (response.ok) cache.put(event.request, response.clone());
                        return response;
                    });
                }),
            ),
        );
    } else {
        // Network-first: HTML pages and API routes must always be fresh
        // so auth state, live data, and server-rendered content stay correct.
        event.respondWith(
            fetch(event.request).catch(() =>
                caches
                    .match(event.request)
                    .then((cached) => cached ?? Response.error()),
            ),
        );
    }
});
