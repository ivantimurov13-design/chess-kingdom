/*
 * «Шахматное Королевство» — home-screen app layer (global PWA).
 *
 * Registers sw.js (offline play) only where it belongs:
 *   top-level page AND ( https: on a host that is not claude.ai / claudeusercontent  OR  the URL has ?pwa=1 )
 * so the published GitHub Pages site becomes an offline-capable iPad home-screen app, while the local Mac version
 * (http://localhost:8765) and the claude.ai artifact never get a service worker. ?pwa=1 turns it on for local tests.
 * On a plain local http page (no ?pwa=1) a worker left over from such a test is removed again, so the Mac version
 * always shows the current files.
 *
 *   PWA.isStandalone()   -> true when started from the Home Screen (display-mode standalone / navigator.standalone)
 *   PWA.canInstallHint() -> true in iOS/iPadOS Safari (not yet on the Home Screen) on the published site
 *   PWA.enabled()        -> true when this page uses the service worker
 *   PWA.ready            -> Promise<ServiceWorkerRegistration|null>
 *
 * Updates (sw.js serves every launch from ONE precached version): a new version downloads in the background and
 * waits. It is applied here at a quiet moment — the app is on screen, App.safeToReload() says nothing is in
 * progress (home / awards / opponents, no dialog, no toast) and nobody has touched it for UPDATE_IDLE_MS (already
 * true when the app comes back to the foreground after a while) — by one reload, with no message. If such a moment
 * does not come, the next cold launch starts with the new version.
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var nav = global.navigator || {};
  var loc = global.location || {};

  function isTop() {
    try { return global.top === global; } catch (e) { return false; }   // cross-origin parent → framed
  }

  function isClaudeHost(host) {
    host = String(host || '').toLowerCase();
    return host === 'claude.ai' || /\.claude\.ai$/.test(host) || host.indexOf('claudeusercontent') >= 0;
  }

  function hasTestFlag() {
    try { return /(?:^|[?&])pwa=1(?:&|$)/.test(String(loc.search || '').replace(/^\?/, '')); } catch (e) { return false; }
  }

  // The published site (https, not claude.ai) or a local test with ?pwa=1 — always top-level only.
  function enabled() {
    if (!isTop()) return false;
    var proto = loc.protocol, host = loc.hostname;
    if (proto !== 'https:' && proto !== 'http:') return false;          // file:// has no service workers
    if (isClaudeHost(host)) return false;                              // never on the claude.ai artifact
    return proto === 'https:' || hasTestFlag();
  }

  function isStandalone() {
    try { if (nav.standalone === true) return true; } catch (e) { /* ignore */ }
    try {
      return !!(global.matchMedia && (global.matchMedia('(display-mode: standalone)').matches ||
        global.matchMedia('(display-mode: fullscreen)').matches));
    } catch (e) { return false; }
  }

  function isIOS() {
    var ua = String(nav.userAgent || '');
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    // iPadOS 13+ Safari reports itself as a Mac; a touch screen gives it away
    return /Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1;
  }

  // «Добавь игру на экран Домой» makes sense only in iOS/iPadOS Safari on the published site, not yet installed.
  function canInstallHint() {
    if (!isIOS() || isStandalone() || !isTop()) return false;
    var ua = String(nav.userAgent || '');
    if (/CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|GSA\//.test(ua)) return false;   // other iOS browsers: different menus
    return loc.protocol === 'https:' && !isClaudeHost(loc.hostname);
  }

  function swSupported() {
    try { return 'serviceWorker' in nav && !!nav.serviceWorker && typeof nav.serviceWorker.register === 'function'; }
    catch (e) { return false; }
  }

  // sw.js lives in the app folder (one level above js/); resolve it from this script so sub-paths just work.
  var scriptSrc = '';
  try { scriptSrc = (doc && doc.currentScript && doc.currentScript.src) || ''; } catch (e) { scriptSrc = ''; }
  function swUrl() {
    try {
      if (scriptSrc && /\/js\/pwa\.js(?:[?#].*)?$/.test(scriptSrc)) return new URL('../sw.js', scriptSrc).href;
      return new URL('sw.js', (doc && doc.baseURI) || loc.href).href;
    } catch (e) { return 'sw.js'; }
  }

  function persistStorage() {
    try {
      var st = nav.storage;
      if (!st || typeof st.persist !== 'function') return;
      var ask = function () { try { var p = st.persist(); if (p && p.catch) p.catch(function () { }); } catch (e) { /* ignore */ } };
      if (typeof st.persisted === 'function') {
        var q = st.persisted();
        if (q && q.then) q.then(function (yes) { if (!yes) ask(); }, ask); else ask();
      } else ask();
    } catch (e) { /* ignore */ }
  }

  var resolveReady;
  var ready = new Promise(function (resolve) { resolveReady = resolve; });
  var registration = null;

  // ------------------------------------------------------------------ updates: one reload at a quiet moment
  var UPDATE_IDLE_MS = 10000;          // no touch / key for this long (the first 10 s after a launch count as busy)
  var UPDATE_POLL_MS = 2000;
  var RELOAD_KEY = 'chessKingdom.v1.swReload';   // sessionStorage: time of the last update reload (never loops)
  var RELOAD_GAP_MS = 30000;
  var lastInput = Date.now();
  var hadController = false;           // this page was served by a worker (so a controller change = a new version)
  var applying = false;                // SKIP_WAITING sent from this page
  var stale = false;                   // another window applied an update while this page was open
  var reloading = false;
  var pollTimer = 0;

  function noteInput() { lastInput = Date.now(); }

  function waitingUpdate() {
    var reg = registration;
    return !!(reg && reg.waiting && reg.active);   // a new version waits behind the one running this page
  }

  function quietMoment() {
    try { if (doc.visibilityState === 'hidden') return false; } catch (e) { return false; }
    if (Date.now() - lastInput < UPDATE_IDLE_MS) return false;
    var A = global.App;
    if (!A || typeof A.safeToReload !== 'function') return false;   // no way to tell: wait for the next launch
    try { return !!A.safeToReload(); } catch (e) { return false; }
  }

  function reloadedRecently() {
    try {
      var t = Number(global.sessionStorage && global.sessionStorage.getItem(RELOAD_KEY));
      return isFinite(t) && t > 0 && Date.now() - t < RELOAD_GAP_MS;
    } catch (e) { return false; }
  }

  function reloadOnce() {
    if (reloading) return;
    reloading = true;
    try { if (global.sessionStorage) global.sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch (e) { /* ignore */ }
    try { loc.reload(); } catch (e) { /* ignore */ }
  }

  function applyUpdate() {
    if (stale) { reloadOnce(); return; }
    var w = registration && registration.waiting;
    if (!w || applying) return;
    applying = true;
    try { w.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { applying = false; }   // → controllerchange → reload
    // that worker may have been replaced by an even newer one before taking over: then try again later
    setTimeout(function () { if (applying && !reloading) { applying = false; scheduleUpdateCheck(); } }, 10000);
  }

  function tick() {
    pollTimer = 0;
    if (reloading || applying || !(stale || waitingUpdate())) return;
    if (quietMoment() && !reloadedRecently()) { applyUpdate(); return; }
    scheduleUpdateCheck();
  }

  function scheduleUpdateCheck() {
    if (pollTimer || reloading) return;
    try { if (doc.visibilityState === 'hidden') return; } catch (e) { return; }   // resumed on 'visible'
    pollTimer = setTimeout(tick, UPDATE_POLL_MS);
  }

  function watchInstalling(reg) {
    var w = reg && reg.installing;
    if (!w || typeof w.addEventListener !== 'function') return;
    w.addEventListener('statechange', function () {
      if (w.state === 'installed') scheduleUpdateCheck();
    });
  }

  function watchUpdates(reg) {
    try {
      nav.serviceWorker.addEventListener('controllerchange', function () {
        if (applying) { reloadOnce(); return; }                  // the update this page asked for is in charge now
        if (!hadController) { hadController = true; return; }   // the very first install took over: nothing to redo
        stale = true;                                            // taken over from another window
        scheduleUpdateCheck();
      });
    } catch (e) { /* ignore */ }
    try { reg.addEventListener('updatefound', function () { watchInstalling(reg); }); } catch (e) { /* ignore */ }
    if (reg.installing) watchInstalling(reg);
    scheduleUpdateCheck();
  }

  function register() {
    var url = swUrl();
    var scope;
    try { scope = new URL('./', url).href; } catch (e) { scope = './'; }
    var p;
    try {
      p = nav.serviceWorker.register(url, { scope: scope, updateViaCache: 'none' });
    } catch (e) {
      resolveReady(null);
      return;
    }
    p.then(function (reg) {
      registration = reg;
      resolveReady(reg);
      watchUpdates(reg);
      // look for a new version whenever the app comes back to the foreground (iPad apps stay alive for days)
      try {
        doc.addEventListener('visibilitychange', function () {
          if (doc.visibilityState !== 'visible') {
            if (pollTimer) { clearTimeout(pollTimer); pollTimer = 0; }
            return;
          }
          if (registration && typeof registration.update === 'function') {
            try { var u = registration.update(); if (u && u.catch) u.catch(function () { }); } catch (e) { /* ignore */ }
          }
          scheduleUpdateCheck();
        });
      } catch (e) { /* ignore */ }
    }, function () { resolveReady(null); });
  }

  // Local plain-http page without ?pwa=1: drop a worker that a ?pwa=1 test left behind (the Mac version stays live).
  function removeTestWorker() {
    try {
      if (!isTop() || loc.protocol !== 'http:' || hasTestFlag() || !swSupported()) return;
      if (typeof nav.serviceWorker.getRegistrations !== 'function') return;
      var mine = swUrl();
      nav.serviceWorker.getRegistrations().then(function (regs) {
        (regs || []).forEach(function (reg) {
          var w = reg && (reg.active || reg.waiting || reg.installing);
          if (w && w.scriptURL === mine) { try { reg.unregister(); } catch (e) { /* ignore */ } }
        });
      }).catch(function () { });
    } catch (e) { /* ignore */ }
  }

  var on = false;
  function boot() {
    on = enabled() && swSupported();
    if (!on) {
      resolveReady(null);
      removeTestWorker();
      return;
    }
    try { hadController = !!nav.serviceWorker.controller; } catch (e) { hadController = false; }
    persistStorage();
    register();
  }

  function markStandalone() {
    try { if (isStandalone() && doc && doc.documentElement) doc.documentElement.classList.add('pwa-standalone'); } catch (e) { /* ignore */ }
  }

  var PWA = {
    isStandalone: isStandalone,
    canInstallHint: canInstallHint,
    enabled: function () { return on; },
    ready: ready,
    get registration() { return registration; }
  };

  global.PWA = PWA;

  if (doc && global.addEventListener) {
    markStandalone();
    try {
      ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (t) {
        doc.addEventListener(t, noteInput, { capture: true, passive: true });
      });
    } catch (e) { /* ignore */ }
    // register after the page has loaded, so installing the worker never competes with the first screen
    if (doc.readyState === 'complete') setTimeout(boot, 0);
    else global.addEventListener('load', function () { setTimeout(boot, 0); });
  } else {
    resolveReady(null);
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
