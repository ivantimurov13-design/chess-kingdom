/*
 * «Шахматное Королевство» — service worker (home-screen app on the iPad, offline play).
 *
 * VERSION is stamped by tools/build-web.py with a hash of the published files; it stays 'dev' in the source tree.
 * Every URL is relative to this file, so the app works both at the site root and under a sub-path such as
 * /chess-kingdom/ on GitHub Pages.
 *
 * One launch always runs ONE version: the page and every file it loads later (the AI worker too) come from the
 * precache of the worker that controls the page, never half from the network.
 *
 *   install   precache every app file (fresh from the network, bypassing the HTTP cache; all or nothing).
 *             The very first install takes over at once; an update WAITS while the old version is open;
 *   update    the browser fetches sw.js on every launch (updateViaCache 'none'; js/pwa.js also asks whenever the
 *             app comes back to the foreground). A new VERSION installs in the background and is applied by
 *             js/pwa.js at a quiet moment (message 'SKIP_WAITING', then one reload), or on the next cold launch;
 *   activate  delete this app's caches of older versions, control the open pages;
 *   fetch     navigations + app files: cache first from this version's precache (the network only for a file
 *             that is missing there, and it is not stored); another address inside the app folder while offline
 *             opens the app; Google Fonts: stale-while-revalidate;
 *             everything else (non-GET, other sites, files that are not part of the app) is not touched.
 */
'use strict';

const VERSION = 'b2dbf71d2910';

const PRECACHE = [
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'css/board.css',
  'css/learn.css',
  'css/transfer.css',
  'js/engine.js',
  'js/ai.js',
  'js/ai-worker.js',
  'js/lessons.js',
  'js/content-v3-lessons.js',
  'js/content-v3-mates.js',
  'js/content-v3-tactics.js',
  'js/puzzle-pool.js',
  'js/pieces.js',
  'js/sound.js',
  'js/fx.js',
  'js/board.js',
  'js/learn.js',
  'js/cloud.js',
  'js/transfer.js',
  'js/pwa.js',
  'js/app.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/favicon-32.png'
];

const NETWORK_TIMEOUT_MS = 3000;      // only for addresses that are not app files (offline fallback)
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const FONT_CACHE_MAX = 40;

// The folder this worker lives in (= the app folder): https://host/chess-kingdom/ or http://127.0.0.1:port/
const BASE = new URL('./', self.location.href);
const BASE_PATH = BASE.pathname;
// Cache names carry the app folder, so another copy of the game on the same origin keeps its own caches.
const CACHE_PREFIX = 'chess-kingdom:' + BASE_PATH + ':';
const APP_CACHE = CACHE_PREFIX + 'app:' + VERSION;
const FONT_CACHE = CACHE_PREFIX + 'fonts';
const INDEX_URL = new URL('index.html', BASE).href;
const APP_FILES = new Set(PRECACHE.map(function (p) { return new URL(p, BASE).href; }));

// ------------------------------------------------------------------------------------------------ install
// No skipWaiting here: a page that is open keeps its own version until js/pwa.js applies the update.
self.addEventListener('install', function (event) {
  event.waitUntil(precache());
});

// js/pwa.js sends this to the waiting worker at a quiet moment and reloads the page once it has taken over.
self.addEventListener('message', function (event) {
  const data = event.data;
  if (data && data.type === 'SKIP_WAITING') self.skipWaiting();
});

function freshRequest(href) {
  try { return new Request(href, { cache: 'reload', credentials: 'same-origin' }); } catch (e) { return new Request(href); }
}

// addAll is atomic: either every file is stored or the install fails and the previous version keeps working.
// One retry smooths over a flaky connection during the very first visit.
function precache() {
  return caches.open(APP_CACHE).then(function (cache) {
    const all = function () { return cache.addAll(PRECACHE.map(function (p) { return freshRequest(new URL(p, BASE).href); })); };
    return all().catch(function () {
      return new Promise(function (resolve) { setTimeout(resolve, 1500); }).then(all);
    });
  });
}

// ----------------------------------------------------------------------------------------------- activate
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key.indexOf(CACHE_PREFIX) === 0 && key !== APP_CACHE && key !== FONT_CACHE) return caches.delete(key);
          return null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

// -------------------------------------------------------------------------------------------------- fetch
self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf(BASE_PATH) !== 0) return;          // not the game's folder
    if (req.mode === 'navigate') {
      event.respondWith(handleNavigation(event, url));
      return;
    }
    const key = url.origin + url.pathname;                       // app files are cached without query strings
    if (APP_FILES.has(key)) event.respondWith(cacheFirst(key, req));
    return;
  }

  if (FONT_HOSTS.indexOf(url.hostname) >= 0) event.respondWith(staleWhileRevalidate(event));
});

function isIndexPath(url) {
  return url.pathname === BASE_PATH || url.pathname === BASE_PATH + 'index.html';
}

// A Response that can be served for a navigation (iOS Safari refuses redirected responses from a worker).
function servable(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.blob().then(function (body) {
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () { reject(new Error('timeout')); }, ms);
    promise.then(
      function (v) { clearTimeout(timer); resolve(v); },
      function (e) { clearTimeout(timer); reject(e); }
    );
  });
}

// This version's own copy of an app file (never another version's: that could mix two versions in one page).
function fromCache(key) {
  return caches.open(APP_CACHE)
    .then(function (c) { return c.match(key, { ignoreSearch: true }); })
    .catch(function () { return undefined; });
}

// App files: this version's precached copy; the network only when the copy is missing (e.g. the storage was
// cleared) — that answer is served but not stored, so the precache stays one consistent version.
function cacheFirst(key, request) {
  return fromCache(key).then(function (hit) { return hit || fetch(request); });
}

function handleNavigation(event, url) {
  const file = url.origin + url.pathname;
  if (APP_FILES.has(file) && file !== INDEX_URL) return cacheFirst(file, event.request);   // e.g. the manifest opened in a tab
  if (isIndexPath(url)) {
    return fromCache(INDEX_URL).then(function (hit) {
      return hit ? servable(hit) : fetch(event.request);
    });
  }
  // another address inside the app folder: the network (GitHub's own answer); offline or very slow → the app itself
  // (its relative file links only work from the folder root), keeping the query (?pwa=1)
  const network = fetch(event.request);
  event.waitUntil(network.then(function () { }, function () { }));
  return withTimeout(network, NETWORK_TIMEOUT_MS).catch(function () {
    return fromCache(INDEX_URL).then(function (hit) {
      return hit ? Response.redirect(BASE.href + url.search, 302) : network;
    });
  });
}

// Google Fonts: the cached copy right away, refreshed in the background; network on the first visit.
function staleWhileRevalidate(event) {
  const req = event.request;
  return caches.open(FONT_CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) {
      const network = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          event.waitUntil(cache.put(req, copy).then(function () { return trim(cache, FONT_CACHE_MAX); }).catch(function () { }));
        }
        return res;
      });
      if (hit) {
        event.waitUntil(network.then(function () { }, function () { }));
        return hit;
      }
      return network;
    });
  });
}

function trim(cache, max) {
  return cache.keys().then(function (keys) {
    if (keys.length <= max) return null;
    return Promise.all(keys.slice(0, keys.length - max).map(function (k) { return cache.delete(k); }));
  });
}
