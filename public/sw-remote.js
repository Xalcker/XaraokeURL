// Service worker del control remoto: solo cachea los assets estáticos de /remote.html
// para que Chrome/Android lo ofrezca como app instalable. Todo lo demás (API, WebSocket,
// login, /logout) pasa directo a la red, sin tocarlo.
const CACHE_NAME = "xaraoke-remote-v1";
const ASSETS = [
    "/remote.html",
    "/remote-manifest.webmanifest",
    "/css/tokens.css",
    "/css/icons.css",
    "/css/remote.css",
    "/js/icons.js",
    "/js/i18n.js",
    "/js/shared.js",
    "/js/reconnect.js",
    "/js/tour.js",
    "/js/jsQR.js",
    "/js/registerRemoteSW.js",
    "/remote.js",
    "/img/logo.svg",
    "/img/icon-192.png",
    "/img/icon-512.png",
    "/img/favicon-32.png",
    "/img/apple-touch-icon.png",
    "/notification.mp3",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (!ASSETS.includes(url.pathname)) return;

    event.respondWith(
        fetch(request)
            .then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                return response;
            })
            .catch(() => caches.match(request))
    );
});
