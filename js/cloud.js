/*
 * cloud.js — keeps the child's progress (stars, awards, lessons, puzzles, stats) in the viewer's private
 * artifact database when the game runs as a published claude.ai page, so progress survives cleared
 * browser data and is the same on the iPad and the Mac.
 *
 * Locally (localhost / file://) there is no window.claude, so CloudSync stays idle and the game works
 * from localStorage exactly as before.
 *
 * Merge rule: progress only grows (stars/lesson stars/puzzle stars/stats = max, awards = union), except
 * after «Сбросить прогресс»: the side with the newer resetAt wins outright.
 */
(function (global) {
  'use strict';

  var DOC_NAME = 'chess-kingdom';      // data/users/<id>/chess-kingdom  (4 segments = a document)
  var PUSH_DELAY = 1200;

  var ref = null;            // DocumentReference of this viewer's progress
  var ready = false;         // initial read + merge finished
  var writing = false;
  var pending = null;        // latest profile waiting to be written
  var timer = 0;
  var settleWaiters = [];
  var settled = false;

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function num(v) { return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function hasProgress(p) {
    if (!isObj(p)) return false;
    return num(p.stars) > 0 || (isObj(p.achievements) && Object.keys(p.achievements).length > 0) ||
      (isObj(p.lessons) && Object.keys(p.lessons).length > 0) || (isObj(p.puzzles) && Object.keys(p.puzzles).length > 0);
  }

  function maxMap(a, b) {
    var out = {}, k;
    if (isObj(a)) for (k in a) out[k] = num(a[k]);
    if (isObj(b)) for (k in b) out[k] = Math.max(out[k] || 0, num(b[k]));
    return out;
  }

  // Awards: union; keep the earliest unlock time.
  function unionAch(a, b) {
    var out = {}, k;
    if (isObj(a)) for (k in a) if (num(a[k])) out[k] = num(a[k]);
    if (isObj(b)) for (k in b) if (num(b[k])) out[k] = out[k] ? Math.min(out[k], num(b[k])) : num(b[k]);
    return out;
  }

  function mergeStats(a, b) {
    a = isObj(a) ? a : {}; b = isObj(b) ? b : {};
    var out = {};
    ['games', 'draws', 'losses', 'pvpGames', 'hints'].forEach(function (k) { out[k] = Math.max(num(a[k]), num(b[k])); });
    out.wins = maxMap(a.wins, b.wins);
    return out;
  }

  // local = this device, remote = the database copy. Returns a new object (never mutates inputs).
  function merge(local, remote) {
    local = isObj(local) ? local : {};
    remote = isObj(remote) ? remote : {};
    var lr = num(local.resetAt), rr = num(remote.resetAt);
    if (rr > lr) return keepDeviceSettings(clone(remote), local);   // progress was reset on another device
    if (lr > rr) return clone(local);                              // reset here; the database copy is older

    var out = clone(local), k;
    for (k in remote) if (!(k in out)) out[k] = clone(remote[k]);   // fields this device doesn't know yet
    out.name = (typeof local.name === 'string' && local.name.trim()) ? local.name
      : (typeof remote.name === 'string' ? remote.name : '');
    out.welcomed = !!(local.welcomed || remote.welcomed);
    out.stars = Math.max(num(local.stars), num(remote.stars));
    out.achievements = unionAch(local.achievements, remote.achievements);
    out.lessons = maxMap(local.lessons, remote.lessons);
    out.puzzles = maxMap(local.puzzles, remote.puzzles);
    out.stats = mergeStats(local.stats, remote.stats);
    // Settings (sound, theme, …) follow the device, unless this device has never been used.
    if (!hasProgress(local) && !(typeof local.name === 'string' && local.name.trim()) && isObj(remote.settings)) {
      out.settings = clone(remote.settings);
    }
    return out;
  }

  function keepDeviceSettings(p, local) {
    if (isObj(local.settings)) p.settings = clone(local.settings);
    return p;
  }

  function same(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  function settle() {
    if (settled) return;
    settled = true;
    var w = settleWaiters; settleWaiters = [];
    w.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
  }

  function flush() {
    timer = 0;
    if (!ref || !ready || writing || !pending) return;
    var body = { v: 1, updatedAt: Date.now(), profile: pending };
    pending = null;
    writing = true;
    ref.set(body).then(function () {
      writing = false;
      if (pending) schedule();
    }, function (e) {
      writing = false;
      var code = e && e.code;
      if (code === 'unavailable' && !pending) { pending = body.profile; schedule(4000 + Math.random() * 3000); }
      else if (code === 'revoked' || code === 'not_granted' || code === 'invalid_argument' ||
               code === 'capability_disabled' || code === 'capability_removed') {
        ref = null;   // no private storage for this visit — localStorage still works
      } else if (pending) schedule();
    });
  }

  function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, ms || PUSH_DELAY);
  }

  var CloudSync = {
    /** true once the database copy has been read and merged */
    get active() { return !!ref && ready; },

    /** true once the first read is over (merged, not available, or no database at all) */
    get settled() { return settled; },

    /**
     * opts.getProfile() -> current profile object; opts.apply(mergedProfile) replaces it and refreshes the UI.
     * Safe to call anywhere: without window.claude it just settles immediately.
     */
    init: function (opts) {
      var c = global.claude;
      if (!opts || !c || typeof c.use !== 'function') { settle(); return; }
      Promise.all([c.use('db'), c.use('user')]).then(function (r) {
        var db = r[0], user = r[1];
        if (!db || !user || typeof user.id !== 'function') { settle(); return null; }
        return user.id().then(function (id) {
          if (!id) { settle(); return null; }
          ref = db.doc('data/users/' + id + '/' + DOC_NAME);
          var read = function () { return ref.get(); };
          return read().catch(function (e) {
            if (e && e.code === 'unavailable') {
              return new Promise(function (res) { setTimeout(res, 800 + Math.random() * 700); }).then(read);
            }
            throw e;
          });
        });
      }).then(function (snap) {
        if (!snap || !ref) { settle(); return; }
        var remote = snap.exists && isObj(snap.data()) ? snap.data().profile : null;
        var local = opts.getProfile();
        var merged = isObj(remote) ? merge(local, remote) : clone(local);
        if (!same(merged, local)) {
          try { opts.apply(merged); } catch (e) { /* the UI refresh must not stop syncing */ }
        }
        ready = true;
        settle();
        if (!isObj(remote) || !same(merged, remote)) { pending = clone(opts.getProfile()); schedule(300); }
      }).catch(function () {
        ref = null;
        settle();
      });
    },

    /** Queue the current profile for writing (debounced, one write at a time). */
    push: function (profile) {
      if (!ref) return;
      try { pending = clone(profile); } catch (e) { return; }
      if (ready) schedule();
    },

    /** Resolves when the first merge is done, the database is unavailable, or after `timeoutMs`. */
    whenSettled: function (timeoutMs) {
      return new Promise(function (resolve) {
        if (settled) { resolve(); return; }
        settleWaiters.push(resolve);
        if (timeoutMs) setTimeout(resolve, timeoutMs);
      });
    },

    merge: merge
  };

  global.CloudSync = CloudSync;
  if (typeof module !== 'undefined' && module.exports) module.exports = CloudSync;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
