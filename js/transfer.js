/*
 * transfer.js — «Перенести прогресс» (global `Transfer`, node-exportable).
 *
 * Moves the child's progress between the builds that keep separate storage (local Mac version, claude.ai
 * artifact, iPad home-screen app on GitHub Pages) with a text code a parent copies on one device and pastes
 * on another (Notes, Messages, AirDrop, Universal Clipboard…).
 *
 *   Transfer.encode(profile) -> 'ШК1-<base64url(UTF-8 JSON of the profile)>-<checksum>'
 *   Transfer.decode(code)    -> { ok: true, profile } | { ok: false, error: '<friendly Russian message>' }
 *   Transfer.importInto(localProfile, incoming) -> merged profile (new object; inputs are never changed)
 *   Transfer.summary(profile) -> { stars, achievements, lessons, puzzles, name }   (counts for a preview)
 *   Transfer.sameProgress(a, b) -> true when b has nothing a lacks or differs in (stars, awards, lesson and
 *                              puzzle results, stats, name; settings and award dates are ignored)
 *
 * Copy/paste safety: after the prefix the code uses only [A-Za-z0-9_-] and the checksum is 8 hex digits
 * (CRC-32 of the body), so there is nothing for iOS autocorrect / smart punctuation to rewrite. decode()
 * still forgives the usual damage: spaces and line breaks anywhere, quotes around the code, zero-width or
 * no-break spaces, «smart» dashes (— for --, – for -), text around the code, a lost prefix. Any other change
 * (a cut-off end, a changed letter) fails the checksum and is rejected — a damaged code never imports.
 *
 * Merge: progress only grows (CloudSync.merge rules: stars / lesson stars / puzzle stars / stats = max,
 * awards = union with the earliest date). Stars: lesson and puzzle stars are exactly the sums of the best-result
 * maps, so the stars one side earned for results the other side lacks are added on top (a child who played on
 * both devices keeps both); stars from games played on the other device cannot be told apart and stay max.
 * The result is stable: importing the same code again, or the merged code back, changes nothing. resetAt («Сбросить прогресс»): a reset only ever wipes the storage
 * of the build where it was pressed, and an import is an explicit parent action, so neither side is dropped
 * because the other was reset later — both are merged under this device's own resetAt, which the result
 * keeps. For the claude.ai cloud copy (js/cloud.js) an import therefore looks exactly like progress earned
 * on this device: its reset rules keep working, and a code from another build can never make the cloud
 * treat this user's other devices as stale (a foreign, newer resetAt is not adopted).
 * The device keeps its own settings (sound, theme, …) unless it has no progress yet.
 */
(function (global) {
  'use strict';

  var VERSION = 1;
  var PREFIX = 'ШК' + VERSION + '-';
  var MAX_INPUT = 300000;       // characters; a full profile code is ~3 KB
  var MESSAGES = {
    empty: 'Сначала вставь код прогресса.',
    notCode: 'Это не код прогресса.',
    broken: 'Код неполный — скопируй его целиком ещё раз.',
    newer: 'Этот код из новой версии игры. Обнови игру и попробуй ещё раз.'
  };
  var KNOWN_KEYS = ['stars', 'achievements', 'lessons', 'puzzles', 'stats', 'settings'];

  // ------------------------------------------------------------------------------------------ helpers
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function num(v) { return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0; }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function badKey(k) { return k === '__proto__' || k === 'constructor' || k === 'prototype'; }
  function safeKey(k) { return typeof k === 'string' && k.length > 0 && k.length <= 64 && !badKey(k); }

  function hasProgress(p) {
    if (!isObj(p)) return false;
    return num(p.stars) > 0 || (isObj(p.achievements) && Object.keys(p.achievements).length > 0) ||
      (isObj(p.lessons) && Object.keys(p.lessons).length > 0) || (isObj(p.puzzles) && Object.keys(p.puzzles).length > 0);
  }

  // ------------------------------------------------------------------------------------ UTF-8, base64url
  function utf8Encode(str) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
    var bin = unescape(encodeURIComponent(str)), out = new Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function utf8Decode(bytes) {     // throws on invalid UTF-8
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(bin));
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var B64_INDEX = {};
  for (var bi = 0; bi < B64.length; bi++) B64_INDEX[B64.charAt(bi)] = bi;

  function b64urlEncode(bytes) {
    var out = '', n = bytes.length, i = 0, v;
    for (; i + 2 < n; i += 3) {
      v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64.charAt((v >> 18) & 63) + B64.charAt((v >> 12) & 63) + B64.charAt((v >> 6) & 63) + B64.charAt(v & 63);
    }
    if (n - i === 1) {
      v = bytes[i] << 16;
      out += B64.charAt((v >> 18) & 63) + B64.charAt((v >> 12) & 63);
    } else if (n - i === 2) {
      v = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64.charAt((v >> 18) & 63) + B64.charAt((v >> 12) & 63) + B64.charAt((v >> 6) & 63);
    }
    return out;
  }
  function b64urlDecode(str) {     // -> Uint8Array | null
    var n = str.length;
    if (n % 4 === 1) return null;
    var outLen = Math.floor(n * 3 / 4), out = new Uint8Array(outLen), o = 0, buf = 0, bits = 0;
    for (var i = 0; i < n; i++) {
      var c = B64_INDEX[str.charAt(i)];
      if (c === undefined) return null;
      buf = ((buf << 6) | c) & 0xFFFFFF;
      bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
    }
    if (buf & ((1 << bits) - 1)) return null;   // non-canonical tail: the code was altered
    return o === outLen ? out : out.subarray(0, o);
  }

  // --------------------------------------------------------------------------------------- checksum
  var CRC_TABLE = (function () {
    var t = [], c, n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(ascii) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < ascii.length; i++) crc = CRC_TABLE[(crc ^ ascii.charCodeAt(i)) & 255] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function checksum(body) { return ('0000000' + crc32(VERSION + ':' + body).toString(16)).slice(-8); }

  // --------------------------------------------------------------------------------- profile cleanup
  // Keeps every valid value exactly as it is (so encode → decode is lossless) and drops what could never
  // come from the game. Returns null when the object is not a progress profile at all.
  function numMap(src, intOnly) {
    var out = {};
    if (!isObj(src)) return out;
    Object.keys(src).forEach(function (k) {
      var v = src[k];
      if (!safeKey(k) || typeof v !== 'number' || !isFinite(v) || v < 0) return;
      out[k] = intOnly ? Math.floor(v) : v;
    });
    return out;
  }
  function cleanProfile(raw) {
    if (!isObj(raw)) return null;
    var found = KNOWN_KEYS.some(function (k) { return own(raw, k); });
    if (!found) return null;
    if (own(raw, 'v') && raw.v !== VERSION) return null;
    var p = {};
    Object.keys(raw).forEach(function (k) {       // unknown extras written by other modules travel along
      if (safeKey(k) && raw[k] !== undefined) p[k] = clone(raw[k]);
    });
    if (own(raw, 'name')) p.name = typeof raw.name === 'string' ? raw.name.replace(/[<>]/g, '').slice(0, 24) : '';   // same rule as the name field
    if (own(raw, 'stars')) p.stars = Math.floor(num(raw.stars));
    if (own(raw, 'resetAt')) { if (num(raw.resetAt)) p.resetAt = num(raw.resetAt); else delete p.resetAt; }
    if (own(raw, 'achievements')) {
      p.achievements = {};
      if (isObj(raw.achievements)) {
        Object.keys(raw.achievements).forEach(function (k) {
          var v = raw.achievements[k];
          if (!safeKey(k)) return;
          if (v === true) p.achievements[k] = Date.now();
          else if (num(v)) p.achievements[k] = v;
        });
      }
    }
    if (own(raw, 'lessons')) p.lessons = numMap(raw.lessons);
    if (own(raw, 'puzzles')) p.puzzles = numMap(raw.puzzles);
    if (own(raw, 'stats')) {
      var s = isObj(raw.stats) ? raw.stats : {}, st = {};
      Object.keys(s).forEach(function (k) {
        if (!safeKey(k)) return;
        if (k === 'wins') st.wins = numMap(s.wins, true);
        else if (typeof s[k] === 'number' && isFinite(s[k]) && s[k] >= 0) st[k] = Math.floor(s[k]);
      });
      p.stats = st;
    }
    if (own(raw, 'settings')) {
      var set = {};
      if (isObj(raw.settings)) {
        Object.keys(raw.settings).forEach(function (k) {
          var v = raw.settings[k];
          if (safeKey(k) && (typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && isFinite(v)))) set[k] = v;
        });
      }
      p.settings = set;
    }
    return p;
  }

  // ---------------------------------------------------------------------------------------- encode
  function encode(profile) {
    var p = isObj(profile) ? JSON.parse(JSON.stringify(profile)) : { v: VERSION, stars: 0 };
    Object.keys(p).forEach(function (k) { if (badKey(k)) delete p[k]; });
    var body = b64urlEncode(utf8Encode(JSON.stringify(p)));
    return PREFIX + body + '-' + checksum(body);
  }

  // ---------------------------------------------------------------------------------------- decode
  // character classes are built from code points (no invisible characters inside the source file)
  function charClass(list) {
    return list.map(function (c) {
      return Array.isArray(c) ? String.fromCharCode(c[0]) + '-' + String.fromCharCode(c[1]) : String.fromCharCode(c);
    }).join('');
  }
  // spaces, line breaks, no-break / zero-width spaces, soft hyphen, bidi marks, BOM
  var INVISIBLE = new RegExp('[\\s' + charClass([0xA0, 0xAD, 0x180E, [0x200B, 0x200F], 0x2028, 0x2029, [0x202A, 0x202E],
    [0x2060, 0x2064], 0xFEFF]) + ']+', 'g');
  // straight, typographic and full-width quotes: " ' ` « » ‘ ’ ‚ ‛ “ ” „ ‟ ‹ › 〈 〉
  var QUOTES = new RegExp('[' + charClass([0x22, 0x27, 0x60, 0xAB, 0xBB, [0x2018, 0x201F], 0x2039, 0x203A, 0x3008, 0x3009,
    0xFF02, 0xFF07]) + ']', 'g');
  var DASH1 = new RegExp('[' + charClass([[0x2010, 0x2013], 0x2212, 0xFE58, 0xFE63, 0xFF0D]) + ']', 'g');   // → '-'
  var DASH2 = new RegExp('[' + charClass([0x2014, 0x2015]) + ']', 'g');   // smart punctuation turns '--' into '—'
  var PREFIX_RE = /[Шш][КкKk](\d{1,3})-/;   // 'ШК1-' (also lower case / Latin K)
  var BODY_RE = /^[A-Za-z0-9_-]+/;

  function fail(kind) { return { ok: false, error: MESSAGES[kind] }; }

  // 'body-checksum…' → profile | 'broken' | 'notCode'. The checksum is found by position, not by the last
  // dash, so letters glued on after the code (text that followed it in a message) do not matter.
  function parseRun(run) {
    var re = /-([0-9a-fA-F]{8})/g, m, body = null;
    while ((m = re.exec(run))) {
      if (m.index > 0 && checksum(run.slice(0, m.index)) === m[1].toLowerCase()) { body = run.slice(0, m.index); break; }
      re.lastIndex = m.index + 1;
    }
    if (body === null) return 'broken';
    var bytes = b64urlDecode(body);
    if (!bytes) return 'notCode';
    var data;
    try { data = JSON.parse(utf8Decode(bytes)); } catch (e) { return 'notCode'; }
    return cleanProfile(data) || 'notCode';
  }

  function decode(code) {
    if (code === null || code === undefined) return fail('empty');
    var s = String(code);
    if (s.length > MAX_INPUT) return fail('notCode');
    s = s.replace(INVISIBLE, '').replace(QUOTES, '').replace(DASH1, '-').replace(DASH2, '--');
    if (!s) return fail('empty');

    var m = PREFIX_RE.exec(s), res;
    if (m) {
      if (Number(m[1]) > VERSION) return fail('newer');
      if (Number(m[1]) !== VERSION) return fail('notCode');
      var run = BODY_RE.exec(s.slice(m.index + m[0].length));
      if (!run) return fail('broken');
      res = parseRun(run[0]);
      if (typeof res === 'string') {
        // a second paste glued on without a separator: 'ШК1-…-1a2b3c4dШК1-…' is handled by BODY_RE;
        // a later complete code in the same text still counts
        var rest = s.slice(m.index + m[0].length + run[0].length);
        if (PREFIX_RE.test(rest)) {
          var again = decode(rest);
          if (again.ok) return again;
        }
        return fail(res);
      }
      return { ok: true, profile: res };
    }
    // the prefix got lost while selecting by hand: accept a bare 'body-checksum' that passes the checksum
    var bare = BODY_RE.exec(s.replace(/^-+/, ''));   // the JSON body always starts with 'eyJ', never with '-'
    if (bare && bare[0].length > 16) {
      res = parseRun(bare[0]);
      if (typeof res !== 'string') return { ok: true, profile: res };
      if (bare[0].slice(0, 3) === 'eyJ') return fail(res);
    }
    return fail('notCode');
  }

  // ------------------------------------------------------------------------------------------ merge
  function maxMap(a, b) {
    var out = {}, k;
    if (isObj(a)) for (k in a) if (own(a, k) && safeKey(k)) out[k] = num(a[k]);
    if (isObj(b)) for (k in b) if (own(b, k) && safeKey(k)) out[k] = Math.max(out[k] || 0, num(b[k]));
    return out;
  }
  function unionAch(a, b) {
    var out = {}, k;
    if (isObj(a)) for (k in a) if (own(a, k) && safeKey(k) && num(a[k])) out[k] = num(a[k]);
    if (isObj(b)) for (k in b) if (own(b, k) && safeKey(k) && num(b[k])) out[k] = out[k] ? Math.min(out[k], num(b[k])) : num(b[k]);
    return out;
  }
  function mergeStats(a, b) {
    a = isObj(a) ? a : {}; b = isObj(b) ? b : {};
    var out = {};
    ['games', 'draws', 'losses', 'pvpGames', 'hints'].forEach(function (k) { out[k] = Math.max(num(a[k]), num(b[k])); });
    out.wins = maxMap(a.wins, b.wins);
    return out;
  }
  // Same rules as CloudSync.merge (js/cloud.js) — used when cloud.js is not loaded.
  function localMerge(local, remote) {
    local = isObj(local) ? local : {};
    remote = isObj(remote) ? remote : {};
    var lr = num(local.resetAt), rr = num(remote.resetAt);
    if (rr > lr) { var r = clone(remote); if (isObj(local.settings)) r.settings = clone(local.settings); return r; }
    if (lr > rr) return clone(local);
    var out = clone(local), k;
    for (k in remote) if (own(remote, k) && !(k in out)) out[k] = clone(remote[k]);
    out.name = (typeof local.name === 'string' && local.name.trim()) ? local.name
      : (typeof remote.name === 'string' ? remote.name : '');
    out.welcomed = !!(local.welcomed || remote.welcomed);
    out.stars = Math.max(num(local.stars), num(remote.stars));
    out.achievements = unionAch(local.achievements, remote.achievements);
    out.lessons = maxMap(local.lessons, remote.lessons);
    out.puzzles = maxMap(local.puzzles, remote.puzzles);
    out.stats = mergeStats(local.stats, remote.stats);
    if (!hasProgress(local) && !(typeof local.name === 'string' && local.name.trim()) && isObj(remote.settings)) {
      out.settings = clone(remote.settings);
    }
    return out;
  }

  function mergeFn() {
    var cs = global.CloudSync;
    return (cs && typeof cs.merge === 'function') ? cs.merge : localMerge;
  }

  // Lesson + puzzle stars that `b` has beyond `a`. Each map holds the best result (a lesson level gives up to 3
  // stars, a puzzle up to 2, an improvement pays the difference), so the stars earned there are exactly the sum.
  var MAX_RESULT = { lessons: 3, puzzles: 2 };
  function extraStars(a, b) {
    var g = 0;
    ['lessons', 'puzzles'].forEach(function (f) {
      var A = isObj(a[f]) ? a[f] : {}, B = isObj(b[f]) ? b[f] : {}, cap = MAX_RESULT[f];
      Object.keys(B).forEach(function (k) {
        if (!safeKey(k)) return;
        var have = own(A, k) ? Math.min(cap, Math.floor(num(A[k]))) : 0;
        g += Math.max(0, Math.min(cap, Math.floor(num(B[k]))) - have);
      });
    });
    return g;
  }

  function importInto(localProfile, incoming) {
    var local = isObj(localProfile) ? clone(localProfile) : {};
    var inc = cleanProfile(incoming);
    if (!inc) return local;
    // both sides under this device's reset time → CloudSync.merge does max/union and drops nothing
    var lr = num(local.resetAt);
    var a = clone(local), b = clone(inc);
    if (lr) { a.resetAt = lr; b.resetAt = lr; } else { delete a.resetAt; delete b.resetAt; }
    var merged = mergeFn()(a, b);
    if (!isObj(merged)) merged = localMerge(a, b);
    merged.stars = Math.floor(Math.max(num(merged.stars), num(a.stars) + extraStars(a, b), num(b.stars) + extraStars(b, a)));
    // settings follow this device unless it has no progress yet (then the code's settings come along)
    if (!hasProgress(local) && isObj(inc.settings)) {
      merged.settings = Object.assign({}, isObj(local.settings) ? local.settings : {}, clone(inc.settings));
    } else if (isObj(local.settings)) {
      merged.settings = clone(local.settings);
    }
    if (lr) merged.resetAt = lr; else delete merged.resetAt;
    return merged;
  }

  function countPositive(m) {
    var n = 0;
    if (isObj(m)) Object.keys(m).forEach(function (k) { if (num(m[k])) n++; });
    return n;
  }
  function summary(p) {
    p = isObj(p) ? p : {};
    return {
      stars: Math.floor(num(p.stars)),
      achievements: countPositive(p.achievements),
      lessons: countPositive(p.lessons),
      puzzles: countPositive(p.puzzles),
      name: typeof p.name === 'string' ? p.name.trim() : ''
    };
  }

  function sameNums(x, y) {
    x = isObj(x) ? x : {}; y = isObj(y) ? y : {};
    var keys = Object.keys(x).concat(Object.keys(y));
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k !== 'wins' && num(x[k]) !== num(y[k])) return false;
    }
    return true;
  }
  function sameProgress(a, b) {
    a = isObj(a) ? a : {}; b = isObj(b) ? b : {};
    if (Math.floor(num(a.stars)) !== Math.floor(num(b.stars))) return false;
    var nameA = typeof a.name === 'string' ? a.name.trim() : '', nameB = typeof b.name === 'string' ? b.name.trim() : '';
    if (nameA !== nameB) return false;
    var achA = isObj(a.achievements) ? a.achievements : {}, achB = isObj(b.achievements) ? b.achievements : {};
    var ids = Object.keys(achA).concat(Object.keys(achB));
    for (var i = 0; i < ids.length; i++) if (!num(achA[ids[i]]) !== !num(achB[ids[i]])) return false;
    var sa = isObj(a.stats) ? a.stats : {}, sb = isObj(b.stats) ? b.stats : {};
    return sameNums(a.lessons, b.lessons) && sameNums(a.puzzles, b.puzzles) && sameNums(sa, sb) && sameNums(sa.wins, sb.wins);
  }

  var Transfer = {
    PREFIX: PREFIX,
    MESSAGES: MESSAGES,
    encode: encode,
    decode: decode,
    importInto: importInto,
    summary: summary,
    sameProgress: sameProgress,
    hasProgress: hasProgress,
    localMerge: localMerge,
    checksum: checksum
  };

  global.Transfer = Transfer;
  if (typeof module !== 'undefined' && module.exports) module.exports = Transfer;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
