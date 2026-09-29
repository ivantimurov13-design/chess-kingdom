/*
 * «Шахматное Королевство» — app shell & game controller (global `App`).
 *
 * Owns: screens, top bar, home / opponents / game / awards screens, settings, profile storage, rewards,
 * achievements, mascot component, modal/toast primitives and the AI client (Worker with main-thread fallback).
 *
 * Contract used by learn.js (see SPEC §8):
 *   App.profile, App.settings (= App.profile.settings), App.save()
 *   App.showScreen(name)          'home'|'opponents'|'game'|'lessons'|'lesson'|'puzzles'|'puzzle'|'awards'
 *   App.addStars(n, from)         from: element or {x, y}
 *   App.unlock(achievementId)
 *   App.createMascot(hostEl) -> { say(text, {mood, speak}), setMood(m), el }
 *   App.createBoard(hostEl, opts) -> BoardView (settings applied and kept in sync) | null if BoardView is missing
 *   App.modal({emoji, title, html, buttons, onClose, dismissable}) -> { close(), el }
 *   App.toast(text, {emoji})
 *   App.childName()
 *
 * Every other module is feature-checked, so a missing/broken module never takes the whole app down.
 */
(function (global) {
  'use strict';

  var doc = global.document;
  if (!doc) return; // not a browser window (e.g. a worker) — nothing to do

  // =================================================================================================
  // Small utilities
  // =================================================================================================
  function $(sel, root) { return (root || doc).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }
  function h(tag, cls, html) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }
  function reducedMotion() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  var warned = {};
  function logErr(where, e) {
    try {
      var key = where + ':' + (e && e.message);
      if (warned[key]) return;
      warned[key] = true;
      console.warn('[App] ' + where + ':', e);
    } catch (_) { /* ignore */ }
  }
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function nonNeg(v, d) { v = Number(v); return (isFinite(v) && v >= 0) ? v : d; }

  // =================================================================================================
  // Chess constants (SPEC §2) — read from the engine when present, spec defaults otherwise
  // =================================================================================================
  var CH = global.Chess;
  var WHITE = (CH && CH.WHITE) || 8, BLACK = (CH && CH.BLACK) || 16;
  var PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  var FLAG = (CH && CH.FLAG) || { CAPTURE: 1, EP: 2, CASTLE: 4, DOUBLE: 8, PROMO: 16 };
  var VALUE = (CH && CH.VALUE) || [0, 100, 320, 330, 500, 900, 0];
  var TYPE_CH = ['', 'p', 'n', 'b', 'r', 'q', 'k'];
  function engineReady() { return typeof global.Chess === 'function'; }
  function colorCh(c) { return c === BLACK ? 'b' : 'w'; }
  function sqName(sq) { return 'abcdefgh'.charAt(sq & 7) + (8 - (sq >> 4)); }
  function sqFromName(s) {
    if (typeof s !== 'string' || s.length !== 2) return -1;
    var c = 'abcdefgh'.indexOf(s.charAt(0)), r = 8 - parseInt(s.charAt(1), 10);
    return (c < 0 || !(r >= 0 && r < 8)) ? -1 : r * 16 + c;
  }
  function toSq(v) { return typeof v === 'string' ? sqFromName(v) : (typeof v === 'number' ? v : -1); }
  function promoType(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v & 7;
    if (typeof v === 'string') return Math.max(0, TYPE_CH.indexOf(v.toLowerCase()));
    return 0;
  }

  // Russian piece names (Lessons.NAMES when available)
  var NAMES_FALLBACK = {
    p: { nom: 'пешка', acc: 'пешку', gen: 'пешки', ins: 'пешкой', Nom: 'Пешка', g: 'f' },
    n: { nom: 'конь', acc: 'коня', gen: 'коня', ins: 'конём', Nom: 'Конь', g: 'm' },
    b: { nom: 'слон', acc: 'слона', gen: 'слона', ins: 'слоном', Nom: 'Слон', g: 'm' },
    r: { nom: 'ладья', acc: 'ладью', gen: 'ладьи', ins: 'ладьёй', Nom: 'Ладья', g: 'f' },
    q: { nom: 'ферзь', acc: 'ферзя', gen: 'ферзя', ins: 'ферзём', Nom: 'Ферзь', g: 'm' },
    k: { nom: 'король', acc: 'короля', gen: 'короля', ins: 'королём', Nom: 'Король', g: 'm' }
  };
  function N(t) {
    var ch = typeof t === 'number' ? TYPE_CH[t & 7] : String(t || '').toLowerCase();
    var L = global.Lessons && global.Lessons.NAMES;
    var n = (L && L[ch]) || NAMES_FALLBACK[ch] || NAMES_FALLBACK.p;
    if (!n.Nom) n = Object.assign({}, NAMES_FALLBACK[ch] || NAMES_FALLBACK.p, n);
    return n;
  }
  function possAcc(n) { return n.g === 'f' ? 'твою' : 'твоего'; }

  // =================================================================================================
  // Wrappers around optional modules
  // =================================================================================================
  function snd(name) {
    try { if (global.Sound && typeof global.Sound.play === 'function') global.Sound.play(name); } catch (e) { logErr('Sound.play', e); }
  }
  function speak(text, opts) {
    try {
      if (!App.settings.voice) return;
      if (global.Voice && typeof global.Voice.say === 'function') global.Voice.say(text, opts || {});
    } catch (e) { logErr('Voice.say', e); }
  }
  function stopVoice() { try { if (global.Voice && global.Voice.stop) global.Voice.stop(); } catch (e) { /* ignore */ } }
  function voiceAvailable() {
    try { return !!(global.Voice && typeof global.Voice.available === 'function' && global.Voice.available()); } catch (e) { return false; }
  }
  var fx = {
    confetti: function (o) { try { if (global.FX && global.FX.confetti) global.FX.confetti(o || {}); } catch (e) { logErr('FX.confetti', e); } },
    burst: function (x, y, o) { try { if (global.FX && global.FX.burst) global.FX.burst(x, y, o || {}); } catch (e) { logErr('FX.burst', e); } },
    floatText: function (x, y, t, o) { try { if (global.FX && global.FX.floatText) global.FX.floatText(x, y, t, o || {}); } catch (e) { logErr('FX.floatText', e); } },
    fireworks: function (ms) { try { if (global.FX && global.FX.fireworks) global.FX.fireworks(ms); } catch (e) { logErr('FX.fireworks', e); } }
  };
  var GLYPHS = { w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' }, b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' } };
  function glyph(c, t) {
    return '<span class="glyph" style="display:inline-block;line-height:1;font-size:1.2em">' + ((GLYPHS[c] || {})[t] || '') + '</span>';
  }
  var art = {
    icon: function (c, t) {
      try { if (global.PieceArt && global.PieceArt.icon) return global.PieceArt.icon(c, t); } catch (e) { logErr('PieceArt.icon', e); }
      return glyph(c, t);
    },
    mascot: function () {
      try { if (global.PieceArt && global.PieceArt.mascot) return global.PieceArt.mascot(); } catch (e) { logErr('PieceArt.mascot', e); }
      return '<div class="mascot-fallback" aria-hidden="true">🐴</div>';
    }
  };

  // =================================================================================================
  // Profile & storage
  // =================================================================================================
  var STORE_KEY = 'chessKingdom.v1';
  function defaultSettings() {
    return { sound: true, voice: true, theme: 'ocean', faces: true, showLegal: true, danger: true, safety: true, flipPvp: false };
  }
  function defaultStats() { return { games: 0, wins: { 1: 0, 2: 0, 3: 0, 4: 0 }, draws: 0, losses: 0, pvpGames: 0, hints: 0 }; }
  function defaultProfile() {
    return { v: 1, name: '', stars: 0, achievements: {}, lessons: {}, puzzles: {}, stats: defaultStats(), settings: defaultSettings() };
  }
  function sanitizeProfile(raw) {
    var p = defaultProfile(), k;
    if (!isObj(raw)) return p;
    // keep unknown extra fields (forward compatibility, extras written by other modules)
    for (k in raw) if (Object.prototype.hasOwnProperty.call(raw, k) && !(k in p)) p[k] = raw[k];
    if (typeof raw.name === 'string') p.name = raw.name.slice(0, 24);
    p.stars = Math.floor(nonNeg(raw.stars, 0));
    if (isObj(raw.achievements)) {
      for (k in raw.achievements) {
        var v = raw.achievements[k];
        if (v === true) p.achievements[k] = Date.now();
        else if (nonNeg(v, 0) > 0) p.achievements[k] = Number(v);
      }
    }
    if (isObj(raw.lessons)) for (k in raw.lessons) p.lessons[k] = nonNeg(raw.lessons[k], 0);
    if (isObj(raw.puzzles)) for (k in raw.puzzles) p.puzzles[k] = nonNeg(raw.puzzles[k], 0);
    if (isObj(raw.stats)) {
      var s = raw.stats;
      ['games', 'draws', 'losses', 'pvpGames', 'hints'].forEach(function (key) { p.stats[key] = Math.floor(nonNeg(s[key], 0)); });
      if (isObj(s.wins)) [1, 2, 3, 4].forEach(function (l) { p.stats.wins[l] = Math.floor(nonNeg(s.wins[l], 0)); });
    }
    if (isObj(raw.settings)) {
      var d = defaultSettings();
      for (k in d) if (typeof raw.settings[k] === typeof d[k]) p.settings[k] = raw.settings[k];
    }
    p.v = 1;
    return p;
  }
  function loadProfile() {
    var raw = null;
    try {
      var s = global.localStorage ? global.localStorage.getItem(STORE_KEY) : null;
      if (s) raw = JSON.parse(s);
    } catch (e) { raw = null; }
    return sanitizeProfile(raw);
  }
  function saveProfile() {
    try { if (global.CloudSync) global.CloudSync.push(App.profile); } catch (e) { logErr('CloudSync.push', e); }
    try {
      if (global.localStorage) global.localStorage.setItem(STORE_KEY, JSON.stringify(App.profile));
      return true;
    } catch (e) { return false; }
  }
  function childName() {
    var n = (App.profile && typeof App.profile.name === 'string') ? App.profile.name.trim() : '';
    return n || 'друг';
  }

  // =================================================================================================
  // Data: achievements, opponents
  // =================================================================================================
  var ACHIEVEMENTS = [
    { id: 'first_move', emoji: '👣', title: 'Первый ход', desc: 'Сделай первый ход в партии' },
    { id: 'first_win', emoji: '🏆', title: 'Первая победа', desc: 'Выиграй партию у компьютера' },
    { id: 'beat_1', emoji: '🐣', title: 'Победил Цыплёнка', desc: 'Выиграй у Цыплёнка Пика' },
    { id: 'beat_2', emoji: '🦊', title: 'Победил Лисёнка', desc: 'Выиграй у Лисёнка Рыжика' },
    { id: 'beat_3', emoji: '🐻', title: 'Победил Мишку', desc: 'Выиграй у Мишки Топтыжки' },
    { id: 'beat_4', emoji: '🦉', title: 'Победил Сову', desc: 'Выиграй у Совы Мудрёны' },
    { id: 'castle', emoji: '🏰', title: 'Король в домике', desc: 'Сделай рокировку в партии' },
    { id: 'promote', emoji: '👑', title: 'Пешка-королева', desc: 'Проведи пешку до последней линии' },
    { id: 'en_passant', emoji: '🥷', title: 'Хитрая пешка', desc: 'Возьми пешку на проходе' },
    { id: 'capture_queen', emoji: '🎯', title: 'Охотник на ферзя', desc: 'Съешь ферзя соперника' },
    { id: 'first_check', emoji: '⚡', title: 'Шах!', desc: 'Объяви шах в партии' },
    { id: 'no_hints_win', emoji: '💪', title: 'Сам с усам', desc: 'Выиграй партию без подсказок' },
    { id: 'pvp', emoji: '🤝', title: 'Дружеская партия', desc: 'Сыграй партию вдвоём до конца' },
    { id: 'stars_50', emoji: '⭐', title: '50 звёзд', desc: 'Собери 50 звёздочек' },
    { id: 'stars_150', emoji: '🌟', title: '150 звёзд', desc: 'Собери 150 звёздочек' },
    { id: 'lesson_first', emoji: '🎓', title: 'Первый урок', desc: 'Пройди первый урок' },
    { id: 'lessons_all', emoji: '🧑‍🎓', title: 'Знаток фигур', desc: 'Пройди все уроки' },
    { id: 'puzzle_first', emoji: '🧩', title: 'Первая задачка', desc: 'Реши первую задачку' },
    { id: 'puzzles_5', emoji: '🧠', title: 'Пять задачек', desc: 'Реши пять задачек' },
    { id: 'puzzles_all', emoji: '🥇', title: 'Мастер мата', desc: 'Реши все задачки «Мат в 1 ход»' },
    // content v2 (appended; ids are stable — already unlocked awards are never revoked)
    { id: 'mate2_first', emoji: '🎯', title: 'Два хода до мата', desc: 'Реши первую задачку «Мат в 2 хода»' },
    { id: 'mate2_all', emoji: '🏅', title: 'Мастер двух ходов', desc: 'Реши все задачки «Мат в 2 хода»' },
    { id: 'win_first', emoji: '🍴', title: 'Первая добыча', desc: 'Выиграй фигуру в задачке' },
    { id: 'win_all', emoji: '⚔️', title: 'Юный тактик', desc: 'Реши все задачки «Выиграй фигуру»' },
    { id: 'fork_lesson', emoji: '🔱', title: 'Вилка!', desc: 'Пройди урок «Вилка»' }
  ];
  var ACH_MAP = {};
  ACHIEVEMENTS.forEach(function (a) { ACH_MAP[a.id] = a; });

  var WIN_STARS = { 1: 2, 2: 3, 3: 5, 4: 8 };
  var OPPONENTS = [
    { level: 1, emoji: '🐣', name: 'Цыплёнок Пик', short: 'Цыплёнок', acc: 'Цыплёнка Пика', ins: 'Цыплёнком Пиком', g: 'm',
      desc: 'Только вылупился и учится играть', diff: 'Легко', bg: 'linear-gradient(140deg,#fff3b0,#ffd84d)',
      lines: {
        hello: ['Пи-пи! Давай играть!', 'Пи! Я уже готов!'], capture: ['Пи-пи! Ням!', 'Ой, я съел!'],
        ouch: ['Пи… ой!', 'Пи-пи, моя фигурка!'], check: ['Пи! Шах!'], win: ['Пи-пи! Я выиграл!'],
        lose: ['Пи… Ты молодец!'], draw: ['Пи-пи! Ничья!'], think: ['Пи… куда же пойти?']
      } },
    { level: 2, emoji: '🦊', name: 'Лисёнок Рыжик', short: 'Лисёнок', acc: 'Лисёнка Рыжика', ins: 'Лисёнком Рыжиком', g: 'm',
      desc: 'Хитрый, но торопливый', diff: 'Нормально', bg: 'linear-gradient(140deg,#ffe0c4,#ff9b57)',
      lines: {
        hello: ['Хи-хи! Посмотрим, кто хитрее!', 'Хи-хи, начинаем!'], capture: ['Хи-хи, ам!', 'Моё!'],
        ouch: ['Ай, мой хвостик!', 'Ой-ой!'], check: ['Шах! Хи-хи!'], win: ['Хи-хи! Победа!'],
        lose: ['Ох, ты хитрее меня!'], draw: ['Ничья? Хи-хи, неплохо!'], think: ['Хм-м, хитро…']
      } },
    { level: 3, emoji: '🐻', name: 'Мишка Топтыжка', short: 'Мишка', acc: 'Мишку Топтыжку', ins: 'Мишкой Топтыжкой', g: 'm',
      desc: 'Думает на ход вперёд', diff: 'Трудно', bg: 'linear-gradient(140deg,#f1dccb,#c89067)',
      lines: {
        hello: ['Ну что, сыграем?', 'Р-р-р! Я готов!'], capture: ['Ам! Вкусно!', 'Р-р, моё!'],
        ouch: ['Ох-ох!', 'Эх, прозевал!'], check: ['Шах! Р-р-р!'], win: ['Р-р! Я победил!'],
        lose: ['Ох, ты сильный! Молодец!'], draw: ['Ничья! Хорошо сыграли!'], think: ['Хм-м-м…']
      } },
    { level: 4, emoji: '🦉', name: 'Сова Мудрёна', short: 'Сова', acc: 'Сову Мудрёну', ins: 'Совой Мудрёной', g: 'f',
      desc: 'Самая умная в лесу', diff: 'Очень трудно', bg: 'linear-gradient(140deg,#e5ddff,#9d8cf5)',
      lines: {
        hello: ['Угу! Покажи, чему ты научился.', 'Угу-угу, начнём!'], capture: ['Угу. Спасибо!', 'Угу, забираю.'],
        ouch: ['Ух! Неожиданно!', 'Угу… хороший ход!'], check: ['Угу! Шах!'], win: ['Угу! В этот раз победила я.'],
        lose: ['Угу-угу! Ты победил мудрую сову!'], draw: ['Угу. Ничья!'], think: ['Угу… подумаю…']
      } }
  ];
  function oppByLevel(l) { return OPPONENTS[Math.min(4, Math.max(1, Number(l) || 1)) - 1]; }

  var FACTS = [
    'Знаешь? Конь — единственная фигура, которая умеет перепрыгивать через другие!',
    'Пешка, которая дойдёт до конца доски, может стать ферзём!',
    'Ферзь — самая сильная фигура. Береги его!',
    'Белые всегда ходят первыми.',
    'Короля нельзя съесть. Если ему некуда спрятаться от шаха — это мат!',
    'Слон всю игру ходит по клеткам одного цвета.',
    'Рокировка — это когда король прячется в домик, а ладья его охраняет.',
    'Ладья очень любит открытые линии, где ей никто не мешает.',
    'Шахматам больше тысячи лет!',
    'Пешки ходят только вперёд, а бьют наискосок.',
    'Нажимай на меня — я знаю ещё много интересного!'
  ];

  // =================================================================================================
  // App object (created early so learn.js can read App.profile at any time)
  // =================================================================================================
  var App = {
    version: '1.0',
    profile: loadProfile(),
    save: saveProfile,
    childName: childName,
    ACHIEVEMENTS: ACHIEVEMENTS,
    OPPONENTS: OPPONENTS
  };
  Object.defineProperty(App, 'settings', {
    enumerable: true,
    get: function () { return App.profile.settings; }
  });

  // =================================================================================================
  // Toasts
  // =================================================================================================
  function toast(text, opts) {
    opts = opts || {};
    var root = $('#toast-root') || doc.body;
    var t = h('div', 'toast');
    t.setAttribute('role', 'status');
    if (opts.emoji) t.appendChild(h('span', 'toast-emoji', esc(opts.emoji)));
    var tx = h('span', 'toast-text');
    tx.textContent = String(text == null ? '' : text);
    t.appendChild(tx);
    root.appendChild(t);
    while (root.children.length > 3) root.removeChild(root.firstChild);
    var tm = setTimeout(hide, opts.duration || 3200);
    function hide() {
      clearTimeout(tm);
      if (!t.parentNode || t.classList.contains('out')) return;
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 380);
    }
    t.addEventListener('click', hide);
    return { close: hide };
  }

  // =================================================================================================
  // Modals
  // =================================================================================================
  var modalStack = [];
  var modalSeq = 0;
  function modal(opts) {
    opts = opts || {};
    var dismissable = opts.dismissable !== false;
    var closed = false;
    var root = $('#modal-root') || doc.body;
    var prevFocus = doc.activeElement;
    var back = h('div', 'modal-backdrop');
    var box = h('div', 'modal' + (opts.className ? ' ' + opts.className : ''));
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    var html = '';
    if (opts.emoji) html += '<div class="modal-emoji" aria-hidden="true">' + esc(opts.emoji) + '</div>';
    if (opts.title) {
      var tid = 'modal-title-' + (++modalSeq);
      html += '<h2 class="modal-title" id="' + tid + '">' + esc(opts.title) + '</h2>';
      box.setAttribute('aria-labelledby', tid);
    }
    if (opts.html) html += '<div class="modal-body">' + opts.html + '</div>';
    box.innerHTML = html;

    var handle = {
      el: box,
      close: function () { close('api'); },
      get closed() { return closed; }
    };
    var entry = { dismissable: dismissable, close: close };

    if (dismissable) {
      var x = h('button', 'modal-close', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', 'Закрыть');
      x.addEventListener('click', function () { snd('click'); close('dismiss'); });
      box.appendChild(x);
    }
    var buttons = Array.isArray(opts.buttons) ? opts.buttons : [];
    if (buttons.length) {
      var row = h('div', 'modal-buttons');
      buttons.forEach(function (b) {
        if (!b) return;
        var btn = h('button', 'btn btn-' + (b.kind || 'secondary') + (b.big ? ' btn-big' : ''));
        btn.type = 'button';
        btn.textContent = b.label == null ? 'Хорошо' : String(b.label);
        btn.addEventListener('click', function (ev) {
          ev.preventDefault();
          if (closed) return;
          snd('click');
          if (!b.keepOpen) close('button');
          if (typeof b.onClick === 'function') {
            try { b.onClick(handle, ev); } catch (e) { logErr('modal button', e); }
          }
        });
        row.appendChild(btn);
      });
      box.appendChild(row);
    }
    back.appendChild(box);
    var downOnBack = false;
    back.addEventListener('pointerdown', function (ev) { downOnBack = ev.target === back; });
    back.addEventListener('click', function (ev) {
      if (ev.target === back && downOnBack && dismissable) close('dismiss');
    });
    root.appendChild(back);
    modalStack.push(entry);

    function close(reason) {
      if (closed) return;
      closed = true;
      var i = modalStack.indexOf(entry);
      if (i >= 0) modalStack.splice(i, 1);
      back.classList.add('closing');
      setTimeout(function () { if (back.parentNode) back.parentNode.removeChild(back); }, 230);
      if (!modalStack.length && prevFocus && typeof prevFocus.focus === 'function' && doc.contains(prevFocus)) {
        try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
      if (reason === 'dismiss' && typeof opts.onClose === 'function') {
        try { opts.onClose(handle); } catch (e) { logErr('modal onClose', e); }
      }
    }

    // move focus into the dialog (keyboard users can Tab to the buttons) without a distracting focus ring
    box.setAttribute('tabindex', '-1');
    setTimeout(function () {
      if (closed) return;
      var f = box.querySelector('[autofocus]') || box;
      try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }, 60);
    return handle;
  }

  // =================================================================================================
  // Mascot component
  // =================================================================================================
  var MOODS = ['happy', 'think', 'warn', 'wow', 'sad'];
  function createMascot(hostEl, opts) {
    opts = opts || {};
    var root = h('div', 'mascot mood-happy' + (opts.row ? ' mascot-row' : ''));
    root.innerHTML =
      '<div class="mascot-bubble is-empty" role="status" aria-live="polite"><div class="mascot-text"></div></div>' +
      '<div class="mascot-figure"><div class="mascot-bob"><div class="mascot-pose">' + art.mascot() + '</div></div></div>';
    if (hostEl) hostEl.appendChild(root);
    var bubble = root.querySelector('.mascot-bubble');
    var textEl = root.querySelector('.mascot-text');
    var pose = root.querySelector('.mascot-pose');
    var figure = root.querySelector('.mascot-figure');
    var mood = 'happy', happyTimer = 0, talkTimer = 0, lastText = '';

    function setMood(m) {
      if (MOODS.indexOf(m) < 0) m = 'happy';
      root.classList.remove('mood-' + mood);
      mood = m;
      root.classList.add('mood-' + mood);
      clearTimeout(happyTimer);
      pose.classList.remove('is-happy', 'is-scared');
      pose.style.removeProperty('--look-x');
      pose.style.removeProperty('--look-y');
      if (m === 'happy' || m === 'wow') {
        pose.classList.add('is-happy');
        happyTimer = setTimeout(function () { pose.classList.remove('is-happy'); }, m === 'wow' ? 900 : 1600);
      } else if (m === 'warn') {
        pose.classList.add('is-scared');
      } else if (m === 'think') {
        pose.style.setProperty('--look-x', '1.1');
        pose.style.setProperty('--look-y', '-1.2');
      } else if (m === 'sad') {
        pose.style.setProperty('--look-y', '1.2');
      }
    }

    function say(text, o) {
      o = o || {};
      var t = text == null ? '' : String(text);
      setMood(o.mood || 'happy');
      textEl.textContent = t;
      if (mood === 'think') {
        var dots = h('span', 'think-dots', '<i></i><i></i><i></i>');
        dots.setAttribute('aria-hidden', 'true');
        textEl.appendChild(dots);
      }
      bubble.classList.toggle('is-empty', !t && mood !== 'think');
      bubble.classList.remove('pop');
      void bubble.offsetWidth; // restart the pop-in animation
      bubble.classList.add('pop');
      if (t && t !== lastText) {
        root.classList.remove('talk');
        void root.offsetWidth;
        root.classList.add('talk');
        clearTimeout(talkTimer);
        talkTimer = setTimeout(function () { root.classList.remove('talk'); }, 700);
      }
      lastText = t;
      if (t && o.speak !== false) speak(t);
    }

    function clear() {
      textEl.textContent = '';
      bubble.classList.add('is-empty');
      lastText = '';
    }

    figure.addEventListener('click', function () {
      if (typeof opts.onClick === 'function') { try { opts.onClick(); } catch (e) { logErr('mascot click', e); } }
      else {
        root.classList.remove('talk');
        void root.offsetWidth;
        root.classList.add('talk');
        snd('pop');
      }
    });

    return {
      el: root,
      say: say,
      setMood: setMood,
      clear: clear,
      get text() { return lastText; },
      get mood() { return mood; }
    };
  }

  // =================================================================================================
  // Boards registry & settings
  // =================================================================================================
  var boards = [];
  function createBoard(hostEl, opts) {
    if (typeof global.BoardView !== 'function' || !hostEl) {
      logErr('createBoard', new Error('BoardView is not available'));
      return null;
    }
    var s = App.settings;
    var o = Object.assign({}, opts || {}, { theme: s.theme, faces: s.faces, showLegal: s.showLegal });
    var view;
    try { view = new global.BoardView(hostEl, o); } catch (e) { logErr('new BoardView', e); return null; }
    var rec = { view: view, host: hostEl };
    boards.push(rec);
    var origDestroy = view.destroy;
    view.destroy = function () {
      var i = boards.indexOf(rec);
      if (i >= 0) boards.splice(i, 1);
      if (typeof origDestroy === 'function') return origDestroy.apply(view, arguments);
    };
    return view;
  }
  function syncBoards() {
    var s = App.settings;
    boards = boards.filter(function (rec) { return rec.host && rec.host.isConnected !== false; });
    boards.forEach(function (rec) {
      var v = rec.view;
      try { if (v.setTheme) v.setTheme(s.theme); } catch (e) { logErr('setTheme', e); }
      try { if (v.setFaces) v.setFaces(!!s.faces); } catch (e) { logErr('setFaces', e); }
      try { if (v.setShowLegal) v.setShowLegal(!!s.showLegal); } catch (e) { logErr('setShowLegal', e); }
    });
  }
  function applySettings(opts) {
    var s = App.settings;
    try { if (global.Sound && global.Sound.setEnabled) global.Sound.setEnabled(!!s.sound); } catch (e) { logErr('Sound.setEnabled', e); }
    try { if (global.Voice && global.Voice.setEnabled) global.Voice.setEnabled(!!s.voice); } catch (e) { logErr('Voice.setEnabled', e); }
    syncBoards();
    updateSoundButton();
    if (!opts || !opts.initial) {
      App.save();
      gameSettingsChanged();
    }
  }
  function updateSoundButton() {
    var b = $('#btn-sound');
    if (!b) return;
    var on = !!(App.settings.sound || App.settings.voice);
    b.textContent = on ? '🔊' : '🔇';
    b.classList.toggle('is-off', !on);
    b.setAttribute('aria-label', on ? 'Выключить звук' : 'Включить звук');
    b.title = on ? 'Выключить звук' : 'Включить звук';
  }

  // =================================================================================================
  // Stars & achievements
  // =================================================================================================
  var shownStars = 0, starRaf = 0;
  function renderStarCount(animate) {
    var el = $('#star-count');
    if (!el) return;
    var target = App.profile.stars;
    if (starRaf) cancelAnimationFrame(starRaf);
    starRaf = 0;
    if (!animate || reducedMotion() || typeof requestAnimationFrame !== 'function') {
      shownStars = target;
      el.textContent = String(target);
    } else {
      var from = shownStars, t0 = now(), dur = 700;
      var step = function () {
        var k = Math.min(1, (now() - t0) / dur);
        var v = Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3)));
        el.textContent = String(v);
        shownStars = v;
        starRaf = k < 1 ? requestAnimationFrame(step) : 0;
      };
      starRaf = requestAnimationFrame(step);
    }
    if (animate) bump($('#btn-stars'));
  }
  function bump(el) {
    if (!el) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  function pointOf(from) {
    try {
      if (from && typeof from.getBoundingClientRect === 'function') {
        var r = from.getBoundingClientRect();
        if (r.width || r.height) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      } else if (from && isFinite(from.x) && isFinite(from.y)) {
        return { x: Number(from.x), y: Number(from.y) };
      }
    } catch (e) { /* ignore */ }
    return { x: (global.innerWidth || 800) / 2, y: (global.innerHeight || 600) / 2 };
  }
  function flyStars(pt, count, done) {
    var target = $('#btn-stars');
    var finished = false;
    var finish = function () { if (!finished) { finished = true; done(); } };
    if (!target || reducedMotion()) { finish(); return; }
    var r = target.getBoundingClientRect();
    var tx = r.left + Math.min(26, r.width / 2), ty = r.top + r.height / 2;
    var arrived = 0;
    setTimeout(finish, 1800); // safety: never lose the counter update
    for (var i = 0; i < count; i++) {
      (function (i) {
        setTimeout(function () {
          var s = h('div', 'fly-star', '⭐');
          s.setAttribute('aria-hidden', 'true');
          var sx = pt.x + (Math.random() - 0.5) * 70, sy = pt.y + (Math.random() - 0.5) * 50;
          s.style.transform = 'translate(' + (sx - 15) + 'px,' + (sy - 15) + 'px) scale(.7)';
          doc.body.appendChild(s);
          void s.offsetWidth;
          s.style.transform = 'translate(' + (tx - 15) + 'px,' + (ty - 15) + 'px) scale(1.1)';
          s.style.opacity = '0.4';
          setTimeout(function () {
            if (s.parentNode) s.parentNode.removeChild(s);
            arrived++;
            bump(target);
            if (arrived >= count) finish();
          }, 870);
        }, i * 110);
      })(i);
    }
  }
  function addStars(n, from) {
    n = Math.floor(Number(n) || 0);
    if (n <= 0) return;
    App.profile.stars = Math.floor(nonNeg(App.profile.stars, 0)) + n;
    App.save();
    var pt = pointOf(from);
    fx.floatText(pt.x, pt.y - 10, '+' + n + ' ⭐', { color: '#ffb400', size: 32 });
    snd('star');
    flyStars(pt, Math.min(n, 6), function () {
      renderStarCount(true);
      refreshStarDependents();
      checkStarAchievements();
    });
  }
  function checkStarAchievements() {
    var s = App.profile.stars;
    if (s >= 50) unlock('stars_50');
    if (s >= 150) unlock('stars_150');
  }
  function refreshStarDependents() {
    if (currentScreen === 'home') renderHome();
    else if (currentScreen === 'awards') renderAwards();
  }

  // Achievement toasts wait while a modal is open or a game-end modal is about to open (they would cover it);
  // the end modal itself takes the fresh game achievements out of the queue and shows them inside.
  var achQueue = [], achBusy = false, achTimer = 0, achBatchConfetti = false;
  function scheduleAch(ms) {
    if (achTimer) return;
    achTimer = setTimeout(function () { achTimer = 0; showNextAch(); }, ms);
  }
  function unlock(id) {
    if (!id || typeof id !== 'string') return false;
    var a = App.profile.achievements;
    if (a[id]) return false;
    a[id] = Date.now();
    App.save();
    achQueue.push(ACH_MAP[id] || { id: id, emoji: '🏅', title: 'Новая награда' });
    if (!achBusy) scheduleAch(450);
    if (currentScreen === 'awards') renderAwards();
    return true;
  }
  function showNextAch() {
    if (achBusy) return;
    if (!achQueue.length) { achBatchConfetti = false; return; }
    if (modalStack.length || G.endPending) { scheduleAch(600); return; }
    achBusy = true;
    var def = achQueue.shift();
    snd('achievement');
    var ttl = String(def.title || '');
    toast('Новая награда: «' + ttl + '»' + (/[!?]$/.test(ttl) ? '' : '!'), { emoji: def.emoji, duration: 3600 });
    // one confetti per batch of toasts, and none right after a win celebration
    if (!achBatchConfetti && now() - G.celebratedAt > 3000) fx.confetti({ count: 90 });
    achBatchConfetti = true;
    setTimeout(function () { achBusy = false; showNextAch(); }, 1300);
  }

  // =================================================================================================
  // AI client: Web Worker with main-thread fallback, request ids, stale-response protection
  // =================================================================================================
  var AIClient = (function () {
    var worker = null, broken = false, seq = 0;
    var pending = {}; // id -> { resolve, fen, level, watchdog, local }

    function init() {
      if (worker || broken) return;
      if (typeof global.Worker !== 'function' || !global.location || global.location.protocol === 'file:') { broken = true; return; }
      try {
        worker = new global.Worker('js/ai-worker.js');
        worker.onmessage = function (ev) {
          var d = ev && ev.data;
          if (!d || !pending[d.id]) return;
          finish(d.id, { move: d.move || null, score: d.score });
        };
        worker.onerror = function (ev) {
          try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) { /* ignore */ }
          fail();
        };
        worker.onmessageerror = function () { fail(); };
      } catch (e) {
        worker = null;
        broken = true;
      }
    }
    function fail() {
      broken = true;
      if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
      Object.keys(pending).forEach(function (id) { runLocal(Number(id)); });
    }
    function finish(id, res) {
      var p = pending[id];
      if (!p) return;
      delete pending[id];
      clearTimeout(p.watchdog);
      p.resolve(res);
    }
    function runLocal(id) {
      var p = pending[id];
      if (!p || p.local) return;
      p.local = true;
      clearTimeout(p.watchdog);
      setTimeout(function () {
        if (!pending[id]) return; // cancelled meanwhile
        var res = { move: null };
        try {
          if (engineReady() && global.ChessAI && typeof global.ChessAI.chooseMove === 'function') {
            var c = p.chess || new global.Chess(p.fen);
            var r = global.ChessAI.chooseMove(c, p.level);
            if (r) res = { move: { from: r.from, to: r.to, promotion: r.promotion || 0 }, score: r.score };
          }
        } catch (e) { logErr('ChessAI.chooseMove', e); }
        finish(id, res);
      }, 30);
    }
    // chess (optional): the game engine — its history lets the AI see repeated positions (threefold draws)
    function request(fen, level, chess) {
      init();
      var id = ++seq;
      var game = null;
      try {
        if (chess && typeof chess.history === 'function' && typeof chess.clone === 'function') {
          game = {
            chess: chess.clone(),
            moves: chess.history().map(function (m) { return { from: m.from, to: m.to, promotion: m.promotion || 0 }; })
          };
        }
      } catch (e) { game = null; }
      return new Promise(function (resolve) {
        var p = { resolve: resolve, fen: fen, level: level, watchdog: 0, local: false, chess: game && game.chess };
        pending[id] = p;
        if (worker && !broken) {
          var msg = { id: id, fen: fen, level: level };
          if (game) { msg.startFen = global.Chess.START_FEN; msg.moves = game.moves; }   // games always start from the initial position
          try { worker.postMessage(msg); } catch (e) { fail(); return; }
          p.watchdog = setTimeout(function () { if (pending[id]) runLocal(id); }, 9000);
        } else {
          runLocal(id);
        }
      });
    }
    function cancel() {
      var hadWorkerJob = false;
      Object.keys(pending).forEach(function (id) {
        var p = pending[id];
        clearTimeout(p.watchdog);
        if (!p.local) hadWorkerJob = true;
        p.resolve({ cancelled: true, move: null });
      });
      pending = {};
      // abort a long search right away: recreate the worker lazily on the next request
      if (hadWorkerJob && worker) {
        try { worker.terminate(); } catch (e) { /* ignore */ }
        worker = null;
      }
    }
    return {
      request: request,
      cancel: cancel,
      get usingWorker() { return !!worker && !broken; }
    };
  })();

  // =================================================================================================
  // Screens
  // =================================================================================================
  var SCREENS = ['home', 'opponents', 'game', 'lessons', 'lesson', 'puzzles', 'puzzle', 'awards'];
  var LEARN_SCREENS = ['lessons', 'lesson', 'puzzles', 'puzzle'];
  var currentScreen = null;
  var lastGreetAt = 0, gestureSeen = false;

  function showScreen(name) {
    if (SCREENS.indexOf(name) < 0) name = 'home';
    if (name === 'game' && !G.chess) name = 'opponents';
    var prev = currentScreen;
    if (prev === name) {
      if (name === 'home') renderHome();
      else if (name === 'opponents') renderOpponents();
      else if (name === 'awards') renderAwards();
      return;
    }
    if (prev && LEARN_SCREENS.indexOf(prev) >= 0 && LEARN_SCREENS.indexOf(name) < 0) {
      try { if (global.Learn && typeof global.Learn.leave === 'function') global.Learn.leave(); } catch (e) { logErr('Learn.leave', e); }
    }
    if (prev === 'game') leaveGame();

    currentScreen = name;
    $$('#screens > .screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + name); });
    doc.body.setAttribute('data-screen', name);
    try { global.scrollTo(0, 0); } catch (e) { /* ignore */ }

    if (name === 'home') {
      renderHome(true);
      if (prev && gestureSeen && Date.now() - lastGreetAt > 180000) {
        lastGreetAt = Date.now();
        if (homeMascot) speak(homeMascot.text);
      }
    } else if (name === 'opponents') renderOpponents();
    else if (name === 'awards') renderAwards();
    else if (name === 'game') onGameShown();
  }

  function openLearn(kind) {
    var L = global.Learn;
    var fn = L && (kind === 'puzzles' ? L.openPuzzles : L.openLessons);
    if (typeof fn !== 'function') {
      toast('Этот раздел скоро появится!', { emoji: '🛠️' });
      return;
    }
    try { fn.call(L); } catch (e) {
      logErr('Learn.open', e);
      toast('Ой! Этот раздел сейчас не открылся. Попробуй ещё раз.', { emoji: '🙈' });
      return;
    }
    if (LEARN_SCREENS.indexOf(currentScreen) < 0) showScreen(kind === 'puzzles' ? 'puzzles' : 'lessons');
  }

  // =================================================================================================
  // Background decor & title
  // =================================================================================================
  function buildBackground() {
    var host = $('#bg-pieces');
    if (!host || host.childElementCount) return;
    var items = [
      { c: 'w', t: 'n', x: '3%', y: '16%', s: 170, d: 46, o: 0.17, dx: 40, dy: -50 },
      { c: 'b', t: 'q', x: '85%', y: '9%', s: 150, d: 52, o: 0.14, dx: -30, dy: 45 },
      { c: 'w', t: 'r', x: '80%', y: '60%', s: 180, d: 58, o: 0.15, dx: -45, dy: -35 },
      { c: 'b', t: 'b', x: '9%', y: '68%', s: 140, d: 44, o: 0.14, dx: 35, dy: 30 },
      { c: 'w', t: 'k', x: '47%', y: '80%', s: 130, d: 62, o: 0.12, dx: -25, dy: -45 },
      { c: 'b', t: 'p', x: '31%', y: '30%', s: 90, d: 40, o: 0.1, dx: 30, dy: 40 },
      { c: 'w', t: 'p', x: '63%', y: '28%', s: 84, d: 48, o: 0.1, dx: -35, dy: 35 },
      { c: 'b', t: 'n', x: '92%', y: '38%', s: 120, d: 54, o: 0.13, dx: -40, dy: -30 }
    ];
    var html = '';
    items.forEach(function (it, i) {
      html += '<div class="bg-piece" style="--x:' + it.x + ';--y:' + it.y + ';--s:' + it.s + 'px;--d:' + it.d + 's;--o:' + it.o +
        ';--delay:-' + (i * 7) + 's;--dx:' + it.dx + 'px;--dy:' + it.dy + 'px;--r0:' + (i % 2 ? -10 : 8) + 'deg;--r1:' + (i % 2 ? 9 : -7) + 'deg">' +
        art.icon(it.c, it.t) + '</div>';
    });
    host.innerHTML = html;
  }
  function buildTitle() {
    var t = $('#big-title');
    if (!t || t.getAttribute('data-built')) return;
    var colors = ['#ff7a59', '#6c63ff', '#20b86a', '#f5a000', '#ff5fa2', '#2f9ceb'];
    var i = 0;
    var html = '<span class="t-crown" aria-hidden="true">👑</span>';
    'Шахматное Королевство'.split(' ').forEach(function (word) {
      html += '<span class="t-word" aria-hidden="true">';
      Array.from(word).forEach(function (ch) {
        html += '<span class="t-letter" style="--i:' + i + ';--lc:' + colors[i % colors.length] + '">' + esc(ch) + '</span>';
        i++;
      });
      html += '</span> ';
    });
    t.innerHTML = html;
    t.setAttribute('data-built', '1');
  }
  function buildTileDecos() {
    $$('[data-deco]').forEach(function (el) {
      var parts = (el.getAttribute('data-deco') || 'w:n').split(':');
      el.innerHTML = art.icon(parts[0], parts[1]);
    });
  }

  // =================================================================================================
  // Learn progress helpers (use Lessons data when available)
  // =================================================================================================
  function lessonProgress() {
    var groups = (global.Lessons && Array.isArray(global.Lessons.GROUPS)) ? global.Lessons.GROUPS : null;
    var done = 0, total = 0, stars = 0, groupsDone = 0;
    var L = App.profile.lessons || {};
    if (groups) {
      groups.forEach(function (g) {
        var levels = Array.isArray(g.levels) ? g.levels : [];
        var all = levels.length > 0;
        levels.forEach(function (lv, i) {
          total++;
          var v = nonNeg(L[g.id + ':' + i], 0);
          if (v > 0) { done++; stars += Math.min(3, v); } else all = false;
        });
        if (all) groupsDone++;
      });
    } else {
      Object.keys(L).forEach(function (k) { if (L[k] > 0) { done++; stars += Math.min(3, L[k]); } });
    }
    return { done: done, total: total, stars: stars, groupsDone: groupsDone, groupsTotal: groups ? groups.length : 0 };
  }
  // every puzzle of every set (Lessons.allPuzzles, v2) with a fallback to the mate-in-1 list (v1)
  function allPuzzleList() {
    var L = global.Lessons;
    if (!L) return null;
    if (typeof L.allPuzzles === 'function') {
      try {
        var all = L.allPuzzles();
        if (Array.isArray(all) && all.length) return all;
      } catch (e) { logErr('Lessons.allPuzzles', e); }
    }
    return Array.isArray(L.PUZZLES) ? L.PUZZLES : null;
  }
  function puzzleSets() {
    var L = global.Lessons;
    if (!L || !Array.isArray(L.PUZZLE_SETS)) return [];
    return L.PUZZLE_SETS.filter(function (s) { return s && Array.isArray(s.puzzles) && s.puzzles.length > 0; });
  }
  function countSolved(list, P) {
    var n = 0;
    list.forEach(function (pz) { if (pz && nonNeg(P[String(pz.id)], 0) > 0) n++; });
    return n;
  }
  function puzzleProgress() {
    var list = allPuzzleList();
    var P = App.profile.puzzles || {};
    var done = 0;
    if (list) done = countSolved(list, P);
    else Object.keys(P).forEach(function (k) { if (P[k] > 0) done++; });
    var sets = puzzleSets().map(function (s) {
      return { id: String(s.id || ''), title: String(s.title || ''), emoji: String(s.emoji || '🧩'),
        done: countSolved(s.puzzles, P), total: s.puzzles.length };
    });
    return { done: done, total: list ? list.length : 0, sets: sets };
  }
  // puzzles tile subtitle follows the available sets (index.html holds the v2 text as the pre-script default)
  function puzzlesTileSub(sets) {
    var has = {};
    sets.forEach(function (s) { has[s.id] = true; });
    if (has.mate2 && has.win) return 'Мат в 1 и 2 хода, вилки';
    if (has.mate2) return 'Мат в 1 и 2 хода';
    if (has.win) return 'Мат в 1 ход и вилки';
    return 'Мат в 1 ход';
  }
  function achCount() {
    var a = App.profile.achievements, n = 0;
    ACHIEVEMENTS.forEach(function (x) { if (a[x.id]) n++; });
    return n;
  }
  function totalWins() {
    var w = App.profile.stats.wins || {};
    return [1, 2, 3, 4].reduce(function (s, l) { return s + nonNeg(w[l], 0); }, 0);
  }

  // =================================================================================================
  // Home screen
  // =================================================================================================
  var homeMascot = null, factIdx = -1;
  function nextFact() {
    factIdx = (factIdx + 1) % FACTS.length;
    snd('pop');
    if (homeMascot) homeMascot.say(FACTS[factIdx], { mood: 'wow', speak: true });
  }
  function renderHome(entering) {
    var p = App.profile;
    if (homeMascot && (entering || !homeMascot.text || homeMascot.text.indexOf('Привет, ') === 0)) {
      homeMascot.say('Привет, ' + childName() + '! Во что сыграем?', { mood: 'happy', speak: false });
    }

    var s = p.stars;
    var starsWord = plural(s, 'звезда', 'звезды', 'звёзд');
    var next = s < 50 ? 50 : (s < 150 ? 150 : 0);
    var progHtml;
    if (next) {
      var base = next === 50 ? 0 : 50;
      var pct = Math.max(3, Math.min(100, Math.round((s - base) / (next - base) * 100)));
      var left = next - s;
      progHtml = '<div class="hp-line">До награды «' + next + ' звёзд» ' + plural(left, 'осталась', 'осталось', 'осталось') + ' ' +
        left + ' ' + plural(left, 'звезда', 'звезды', 'звёзд') + '</div>' +
        '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="--p:' + pct + '%"></span></div>';
    } else {
      progHtml = '<div class="hp-line">Ты собрал все звёздные награды — настоящий чемпион! 🏅</div>';
    }
    var lp = lessonProgress(), pp = puzzleProgress();
    var mini = '<div class="hp-mini">' +
      '<span class="chip">🏆 Наград: ' + achCount() + ' из ' + ACHIEVEMENTS.length + '</span>' +
      (lp.total ? '<span class="chip">🎓 Уровней: ' + lp.done + ' из ' + lp.total + '</span>' : '') +
      (pp.total ? '<span class="chip">🧩 Задачек: ' + pp.done + ' из ' + pp.total + '</span>' : '') +
      '</div>';
    var hp = $('#home-progress');
    if (hp) {
      hp.innerHTML = '<div class="hp-stars"><span class="big-star" aria-hidden="true">⭐</span><span>У тебя ' + s + ' ' + starsWord + '</span></div>' +
        progHtml + mini;
    }

    // tile metas
    var wins = totalWins();
    setMeta('ai', wins > 0 ? '🏆 Побед: ' + wins : 'Начни с Цыплёнка!');
    var pg = p.stats.pvpGames;
    setMeta('pvp', pg > 0 ? plural(pg, 'Сыграна', 'Сыграно', 'Сыграно') + ' ' + pg + ' ' + plural(pg, 'партия', 'партии', 'партий') : '');
    setMeta('lessons', lp.total ? 'Пройдено уровней: ' + lp.done + ' из ' + lp.total : '');
    setMeta('puzzles', pp.total ? 'Решено: ' + pp.done + ' из ' + pp.total : '');
    setMeta('awards', 'Наград: ' + achCount() + ' из ' + ACHIEVEMENTS.length);
    var pzSub = puzzlesTileSub(pp.sets);
    var pzSubEl = pzSub ? $('.tile-puzzles .tile-sub') : null;
    if (pzSubEl && pzSubEl.textContent !== pzSub) pzSubEl.textContent = pzSub;
    try { renderA2hsHint(); } catch (e) { logErr('renderA2hsHint', e); }

    // "continue" banner (an unfinished game in memory or restored from storage after a reload)
    var banner = $('#continue-banner');
    if (banner) {
      var unfinished = !!(G.chess && !G.over && G.chess.history().length > 0);
      banner.hidden = !unfinished;
      if (unfinished) {
        var ai = G.mode === 'ai', o = oppByLevel(G.level);
        var ico = $('#continue-ico');
        if (ico) {
          ico.textContent = ai ? o.emoji : '👫';
          ico.style.setProperty('--av-bg', ai ? o.bg : 'linear-gradient(140deg,#8b7dff,#4f8dff)');
        }
        $('#continue-text').innerHTML = ai
          ? '<b>Партия с ' + esc(o.ins) + '</b> ещё не закончена. Доиграем?'
          : '<b>Партия вдвоём</b> ещё не закончена. Доиграем?';
      }
    }
  }
  function setMeta(key, text) {
    var el = $('[data-meta="' + key + '"]');
    if (el) el.textContent = text || '';
  }

  // =================================================================================================
  // Opponents screen
  // =================================================================================================
  var COLOR_NOTES = { w: 'Белые ходят первыми.', b: 'Первым сходит соперник.', random: 'Цвет выберет волшебный кубик!' };
  function colorPref() {
    var c = App.profile.lastColor;
    return (c === 'w' || c === 'b' || c === 'random') ? c : 'w';
  }
  function renderOpponents() {
    var pref = colorPref();
    $$('#color-choice .seg').forEach(function (b) {
      b.setAttribute('aria-checked', b.getAttribute('data-color') === pref ? 'true' : 'false');
    });
    var note = $('#color-note');
    if (note) note.textContent = COLOR_NOTES[pref];
    var grid = $('#opp-grid');
    if (!grid) return;
    var wins = App.profile.stats.wins || {};
    grid.innerHTML = OPPONENTS.map(function (o) {
      var w = nonNeg(wins[o.level], 0);
      var dots = '';
      for (var i = 1; i <= 4; i++) dots += '<i' + (i <= o.level ? ' class="on"' : '') + '></i>';
      return '<button type="button" class="opp-card" data-level="' + o.level + '" aria-label="Играть с соперником ' + esc(o.name) + '">' +
        '<span class="opp-avatar" aria-hidden="true">' + o.emoji + '</span>' +
        '<span class="opp-head">' +
        '<span class="opp-name">' + esc(o.name) + '</span>' +
        '<span class="opp-level"><span class="dots" aria-hidden="true">' + dots + '</span>' + esc(o.diff) + '</span>' +
        '<span class="opp-desc">' + esc(o.desc) + '</span>' +
        '<span class="opp-meta"><span class="chip">🏆 ' + (w > 0 ? 'Побед: ' + w : 'Побед пока нет') + '</span>' +
        '<span class="chip">⭐ +' + WIN_STARS[o.level] + ' за победу</span></span>' +
        '</span>' +
        '<span class="btn btn-primary opp-play">Играть! ▶️</span>' +
        '</button>';
    }).join('');
  }

  // =================================================================================================
  // GAME
  // =================================================================================================
  var G = {
    view: null, chess: null, mascot: null,
    mode: 'ai', level: 1, human: WHITE, colorPref: 'w',
    over: false, result: null, busy: false, thinking: false, paused: null, hintBusy: false,
    epoch: 0, timers: [], hintsUsed: 0, needsResume: false, pendingStars: 0,
    // what this game has already paid out: outcome 'loss'|'draw'|'win'|null (not ended yet) + stars given
    paid: { outcome: null, stars: 0 },
    endPending: false, celebratedAt: -1e9, reactUntil: 0, restored: null,
    tips: {}, lastTipHm: -99, lastNudgeHm: -99, neutralI: 0, lastHint: null, lastDangerKey: '',
    lastIllegal: { text: '', at: 0 }, lastClickMsgAt: 0, sayTimers: {}
  };

  function later(fn, ms) {
    var id = setTimeout(function () {
      var i = G.timers.indexOf(id);
      if (i >= 0) G.timers.splice(i, 1);
      try { fn(); } catch (e) { logErr('game timer', e); }
    }, ms);
    G.timers.push(id);
    return id;
  }
  // async game flows never leak an unhandled rejection: log it and put the controller back into a sane state
  function guard(fn, name) {
    return function () {
      var r;
      try { r = fn.apply(null, arguments); } catch (e) { recover(name, e); return undefined; }
      if (r && typeof r.then === 'function') r.then(null, function (e) { recover(name, e); });
      return r;
    };
  }
  function recover(name, e) {
    logErr(name, e);
    G.busy = false;
    G.thinking = false;
    G.hintBusy = false;
    try { renderAll(); } catch (_) { /* ignore */ }
  }
  function clearGameTimers() {
    G.timers.forEach(function (id) { clearTimeout(id); });
    G.timers = [];
  }
  function vcall(method) {
    var v = G.view;
    if (!v || typeof v[method] !== 'function') return undefined;
    try { return v[method].apply(v, Array.prototype.slice.call(arguments, 1)); } catch (e) { logErr('view.' + method, e); return undefined; }
  }
  function status() {
    try { return G.chess.status(); } catch (e) { logErr('status', e); return { over: false, reason: null, winner: null, check: false }; }
  }
  function hanging(color) {
    try { return G.chess.hangingPieces(color) || []; } catch (e) { logErr('hangingPieces', e); return []; }
  }
  // Like hangingPieces, but only with captures the rules really allow (a pinned piece or a side in check cannot
  // take). Loss is recomputed from the legal capturers; `from` = the cheapest legal capturer (for the arrow).
  function legalHanging(color) {
    var list = hanging(color);
    var chess = G.chess;
    if (!list.length || !chess) return [];
    var enemy;
    try {
      if (chess.turn === (color ^ 24)) {
        enemy = chess.moves();
      } else {
        var f = chess.fen().split(' ');   // same position with the other side to move
        f[1] = f[1] === 'w' ? 'b' : 'w';
        if (f.length > 3) f[3] = '-';
        enemy = new global.Chess(f.join(' ')).moves();
      }
    } catch (e) {
      logErr('legalHanging', e);
      return list;
    }
    var out = [];
    list.forEach(function (x) {
      var val = VALUE[x.piece & 7] || 0;
      var defended = false;
      try { defended = (chess.attackers(x.sq, color) || []).length > 0; } catch (e) { defended = x.loss < val; }
      var min = Infinity, from = -1;
      enemy.forEach(function (m) {
        if (m.to !== x.sq || !m.captured) return;
        var t = m.piece & 7;
        var v = t === KING ? (defended ? Infinity : 10000) : (VALUE[t] || 0);
        if (v < min) { min = v; from = m.from; }
      });
      if (from < 0 || min === Infinity) return;
      var loss = defended ? val - min : val;
      if (loss > 0) out.push({ sq: x.sq, piece: x.piece, loss: loss, from: from });
    });
    out.sort(function (a, b) { return b.loss - a.loss; });
    return out;
  }
  function matesInOne() {
    try { return G.chess.mateInOne() || []; } catch (e) { logErr('mateInOne', e); return []; }
  }
  function lastMoveOf(chess) {
    try { var hst = chess.history(); return hst.length ? hst[hst.length - 1] : null; } catch (e) { return null; }
  }
  function humanMoveCount() {
    if (!G.chess) return 0;
    return G.chess.history().filter(function (m) { return (m.piece & 24) === G.human; }).length;
  }
  function isHumanTurn() {
    return !!G.chess && (G.mode === 'pvp' || G.chess.turn === G.human);
  }
  function canHumanAct() {
    return !!(G.chess && G.view && !G.over && !G.busy && !G.thinking && !G.paused && currentScreen === 'game' && isHumanTurn());
  }
  function opp() { return oppByLevel(G.level); }

  // ------------------------------------------------------------------ saved game (survives a reload)
  // localStorage 'chessKingdom.v1.game': { v, mode, level, human, colorPref, startFen, moves:['e2e4','e7e8q',…],
  //   hintsUsed, orientation, paid:{outcome, stars}, paused:{text, arrow, sq}|null, savedAt }.
  // Written after every change of an unfinished game, removed when the game ends or a new one starts.
  var GAME_KEY = STORE_KEY + '.game';
  var lastGameJson = null;
  function uci(m) {
    return sqName(m.from) + sqName(m.to) + ((m.flags & FLAG.PROMO) && m.promotion ? TYPE_CH[m.promotion & 7] : '');
  }
  function clearSavedGame() {
    if (lastGameJson === '') return;
    lastGameJson = '';
    try { if (global.localStorage) global.localStorage.removeItem(GAME_KEY); } catch (e) { /* ignore */ }
  }
  function persistGame() {
    var chess = G.chess;
    if (!chess || G.restored) return;   // a restored game is not touched until it is shown
    var hist;
    try { hist = chess.history(); } catch (e) { return; }
    if (G.over || !hist.length) { clearSavedGame(); return; }
    var p = G.paused;
    var data = {
      v: 1, mode: G.mode, level: G.level, human: G.human, colorPref: G.colorPref,
      startFen: (global.Chess && global.Chess.START_FEN) || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      moves: hist.map(uci),
      hintsUsed: G.hintsUsed,
      orientation: (G.view && G.view.orientation) || null,
      paid: G.paid && G.paid.outcome ? { outcome: G.paid.outcome, stars: G.paid.stars } : null,
      paused: p ? { text: p.text, arrow: p.arrow || null, sq: p.sq } : null
    };
    var json = JSON.stringify(data);
    if (json === lastGameJson) return;
    lastGameJson = json;
    try {
      data.savedAt = Date.now();
      if (global.localStorage) global.localStorage.setItem(GAME_KEY, JSON.stringify(data));
    } catch (e) { /* storage full / blocked: the game just won't survive a reload */ }
  }
  function loadSavedGame() {
    var d = null;
    try {
      var raw = global.localStorage ? global.localStorage.getItem(GAME_KEY) : null;
      if (raw) d = JSON.parse(raw);
    } catch (e) { d = null; }
    if (!isObj(d) || !engineReady()) return null;
    if ((d.mode !== 'ai' && d.mode !== 'pvp') || !Array.isArray(d.moves) || !d.moves.length) return null;
    var chess = new global.Chess();
    if (typeof d.startFen === 'string' && d.startFen !== global.Chess.START_FEN) return null;   // games start from the initial position
    for (var i = 0; i < d.moves.length; i++) {
      var s = d.moves[i];
      if (typeof s !== 'string' || !/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(s)) return null;
      var mv = { from: sqFromName(s.slice(0, 2)), to: sqFromName(s.slice(2, 4)) };
      if (s.length > 4) mv.promotion = promoType(s.charAt(4));
      var ok = null;
      try { ok = chess.move(mv); } catch (e) { ok = null; }
      if (!ok) return null;
    }
    var st;
    try { st = chess.status(); } catch (e) { return null; }
    if (st.over) return null;
    return { chess: chess, data: d };
  }
  // at boot: bring an unfinished game back into memory; the home screen then offers «▶️ Продолжить партию»
  function restoreSavedGame() {
    if (G.chess) return false;
    var r = loadSavedGame();
    if (!r) { clearSavedGame(); return false; }
    var d = r.data;
    G.chess = r.chess;
    G.mode = d.mode;
    G.level = Math.min(4, Math.max(1, Number(d.level) || 1));
    G.human = d.mode === 'ai' && Number(d.human) === BLACK ? BLACK : WHITE;
    G.colorPref = (d.colorPref === 'w' || d.colorPref === 'b' || d.colorPref === 'random') ? d.colorPref : colorCh(G.human);
    G.over = false; G.result = null; G.busy = false; G.thinking = false; G.hintBusy = false;
    G.hintsUsed = Math.floor(nonNeg(d.hintsUsed, 0));
    var RANKS = { loss: 1, draw: 1, win: 1 };
    G.paid = (isObj(d.paid) && RANKS[d.paid.outcome]) ? { outcome: d.paid.outcome, stars: Math.floor(nonNeg(d.paid.stars, 0)) } : { outcome: null, stars: 0 };
    G.pendingStars = 0; G.endPending = false; G.reactUntil = 0;
    G.tips = {}; G.lastTipHm = -99; G.lastNudgeHm = -99; G.lastHint = null; G.neutralI = 0; G.lastDangerKey = '';
    G.paused = null;
    var last = lastMoveOf(G.chess);
    var pz = d.paused;
    if (App.settings.safety && isObj(pz) && typeof pz.text === 'string' && pz.text && last &&
        (G.mode === 'pvp' || (last.piece & 24) === G.human)) {
      var arrow = isObj(pz.arrow) && typeof pz.arrow.from === 'number' && typeof pz.arrow.to === 'number'
        ? { from: pz.arrow.from, to: pz.arrow.to } : null;
      G.paused = { move: last, st: status(), text: pz.text.slice(0, 200), arrow: arrow, sq: typeof pz.sq === 'number' ? pz.sq : -1 };
    }
    G.restored = { orientation: d.orientation === 'w' || d.orientation === 'b' ? d.orientation : null };
    G.needsResume = true;
    lastGameJson = null;
    return true;
  }

  // ---------------------------------------------------------------------------------- board setup
  function ensureBoard() {
    if (G.view) return G.view;
    var host = $('#game-board');
    if (!host) return null;
    G.view = createBoard(host, {
      orientation: 'w',
      interactive: true,
      showCoords: true,
      canSelect: function (sq, piece) {
        if (!canHumanAct()) return false;
        var p = piece || G.chess.get(sq);
        return !!p && (p & 24) === G.chess.turn;
      },
      getMoves: function (sq) {
        try { return G.chess ? G.chess.moves({ from: sq }) : []; } catch (e) { logErr('moves', e); return []; }
      },
      onMove: function (p) { handleUserMove(p); },
      onIllegal: function (from, to) { onIllegal(from, to, true); }, // the board already shook the piece + played 'illegal'
      onSelect: function (sq) { onSelectPiece(sq); },
      onDeselect: function () { },
      onSquareClick: function (sq) { onSquareClick(sq); }
    });
    if (!G.view) {
      host.innerHTML = '<div class="board-missing">🙈 Ой! Доска не загрузилась. Обнови страницу.</div>';
    }
    return G.view;
  }

  // --------------------------------------------------------------------------------- cancellation
  // keepPause: leaving the game screen keeps an unanswered «Страховка» question (it is shown again on return)
  function cancelAll(keepPause) {
    G.epoch++;
    AIClient.cancel();
    clearGameTimers();
    G.thinking = false;
    G.hintBusy = false;
    G.endPending = false;
    G.reactUntil = 0;
    hideSafety();   // the bar lives outside the screens: always hide it when leaving
    if (!keepPause) G.paused = null;
    flushPendingStars();
  }
  function flushPendingStars() {
    if (G.pendingStars > 0) {
      var n = G.pendingStars;
      G.pendingStars = 0;
      addStars(n, null);
    }
  }
  function leaveGame() {
    cancelAll(true);
    vcall('clearArrows');
    vcall('clearPulses');
    vcall('deselect');
    stopVoice();
    G.needsResume = !!(G.chess && !G.over);
    renderStrips();
  }
  function onGameShown() {
    if (G.needsResume) {
      G.needsResume = false;
      resumeGame();
    }
  }
  // a game restored from storage after a reload: the board view is set up on the first visit of the game screen
  function setupRestoredView() {
    var r = G.restored;
    G.restored = null;
    ensureBoard();
    var orient;
    if (G.mode === 'pvp' && App.settings.flipPvp) orient = colorCh(G.paused && G.paused.move ? (G.paused.move.piece & 24) : G.chess.turn);
    else if (r && (r.orientation === 'w' || r.orientation === 'b')) orient = r.orientation;
    else orient = G.mode === 'ai' ? colorCh(G.human) : 'w';
    vcall('setOrientation', orient);
    vcall('clearArrows');
    vcall('clearPulses');
    vcall('setDanger', []);
    vcall('setCheck', -1);
    vcall('setSideState', 'w', null);
    vcall('setSideState', 'b', null);
    vcall('setInteractive', true);
    $$('.strip-say').forEach(function (b) { b.classList.remove('show'); b.textContent = ''; });
    renderModeChips();
  }
  function resumeGame() {
    var chess = G.chess;
    if (!chess) return;
    if (G.restored) setupRestoredView();
    vcall('setPosition', chess, { lastMove: lastMoveOf(chess) });
    syncCheck();
    renderAll();
    var st = status();
    if (st.over && !G.over) { endGame(st); return; }
    if (G.over) return;
    if (G.paused) {   // the child left (or reloaded) while the safety net was asking: ask again
      showSafetyPause(G.paused, false);
      return;
    }
    if (G.mode === 'ai' && chess.turn !== G.human) {
      G.mascot.say('С возвращением! Продолжаем партию.', { mood: 'happy', speak: false });
      aiTurn();
    } else {
      startHumanTurn(null, { pri: 5, text: 'С возвращением! Продолжаем партию.' + (G.mode === 'ai' ? ' Твой ход!' : ''), mood: 'happy', speak: false });
    }
  }

  // ---------------------------------------------------------------------------------- start game
  function startGame(opts) {
    opts = opts || {};
    if (!engineReady()) {
      toast('Ой! Шахматный движок не загрузился. Обнови страницу.', { emoji: '🙈' });
      return;
    }
    cancelAll();
    var mode = opts.mode === 'pvp' ? 'pvp' : 'ai';
    G.mode = mode;
    if (opts.level) G.level = Math.min(4, Math.max(1, Number(opts.level) || 1));
    if (opts.color) G.colorPref = opts.color;
    if (mode === 'ai') {
      var cp = G.colorPref;
      G.human = cp === 'b' ? BLACK : (cp === 'random' ? (Math.random() < 0.5 ? WHITE : BLACK) : WHITE);
    } else {
      G.human = WHITE;
    }
    try { G.chess = new global.Chess(); } catch (e) { logErr('new Chess', e); toast('Ой! Не получилось начать партию.', { emoji: '🙈' }); return; }
    G.over = false; G.result = null; G.busy = false; G.thinking = false; G.paused = null; G.hintBusy = false;
    G.hintsUsed = 0; G.paid = { outcome: null, stars: 0 }; G.pendingStars = 0; G.needsResume = false;
    G.endPending = false; G.reactUntil = 0; G.restored = null;
    G.tips = {}; G.lastTipHm = -99; G.lastNudgeHm = -99; G.lastHint = null; G.neutralI = 0; G.lastDangerKey = '';
    hideSafety();
    $$('.strip-say').forEach(function (b) { b.classList.remove('show'); b.textContent = ''; });

    showScreen('game');
    ensureBoard();
    var orient = mode === 'ai' ? colorCh(G.human) : 'w';
    vcall('setOrientation', orient);
    vcall('clearArrows');
    vcall('clearPulses');
    vcall('setDanger', []);
    vcall('setCheck', -1);
    vcall('clearLastMove');
    vcall('setSideState', 'w', null);
    vcall('setSideState', 'b', null);
    vcall('setPosition', G.chess, {});
    vcall('setInteractive', true);
    renderModeChips();
    renderAll();

    var name = childName();
    if (mode === 'ai') {
      var o = opp();
      var text = G.human === WHITE
        ? 'Удачи, ' + name + '! Ты играешь белыми — твои фигуры внизу. Начни с пешки в центре!'
        : 'Удачи, ' + name + '! Ты играешь чёрными. ' + (o.g === 'f' ? 'Первой' : 'Первым') + ' ходит ' + o.short + '.';
      G.mascot.say(text, { mood: 'happy', speak: true });
      oppSay('hello', 300);
      if (G.chess.turn !== G.human) later(aiTurn, 1100);
    } else {
      G.mascot.say('Играем вдвоём! Первыми ходят белые. Удачи обоим!', { mood: 'happy', speak: true });
    }
    snd('whoosh');
  }

  function renderModeChips() {
    var el = $('#game-mode');
    if (!el) return;
    if (G.mode === 'ai') {
      var o = opp();
      el.innerHTML = '<span class="chip">' + o.emoji + ' ' + esc(o.name) + '</span>' +
        '<span class="chip">⭐ +' + WIN_STARS[o.level] + ' за победу</span>';
    } else {
      el.innerHTML = '<span class="chip">👫 Игра вдвоём</span><span class="chip">⭐ +1 за партию</span>';
    }
  }

  // ------------------------------------------------------------------------------ rendering bits
  function sideInfo(color) {
    if (G.mode === 'ai') {
      if (color === G.human) {
        var nm = (App.profile.name || '').trim();
        return {
          avatar: nm ? esc(nm.charAt(0).toUpperCase()) : '🙂',
          name: nm || 'Ты', sub: color === WHITE ? 'белые' : 'чёрные',
          bg: 'linear-gradient(140deg,#4fdc8a,#14a89c)', ai: false
        };
      }
      var o = opp();
      return { avatar: o.emoji, name: o.name, sub: color === WHITE ? 'белые' : 'чёрные', bg: o.bg, ai: true };
    }
    return {
      avatar: art.icon(colorCh(color), 'k'),
      name: color === WHITE ? 'Белые' : 'Чёрные', sub: '',
      bg: color === WHITE ? 'linear-gradient(140deg,#ffffff,#ffe7a8)' : 'linear-gradient(140deg,#9384d4,#3b2d6e)', ai: false
    };
  }
  function ensureStripDom(el) {
    if (el.querySelector('.strip-avatar')) return;
    el.innerHTML = '<div class="strip-avatar"></div>' +
      '<div class="strip-info"><div class="strip-name"></div><div class="strip-caps"></div></div>' +
      '<div class="strip-status"></div><div class="strip-say" aria-live="polite"></div>';
  }
  function capturedBy(color) {
    var out = [];
    if (!G.chess) return out;
    G.chess.history().forEach(function (m) { if ((m.piece & 24) === color && m.captured) out.push(m.captured); });
    out.sort(function (a, b) { return (a & 7) - (b & 7); });
    return out;
  }
  function materialOf(color) {
    var chess = G.chess;
    try { if (typeof chess.material === 'function') return chess.material(color); } catch (e) { /* fall through */ }
    var sum = 0;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = chess.board[sq];
      if (p && (p & 24) === color) sum += VALUE[p & 7] || 0;
    }
    return sum;
  }
  function renderStrip(el, color) {
    if (!el) return;
    ensureStripDom(el);
    var chess = G.chess;
    var info = sideInfo(color);
    // during the safety-net question the game waits for the side that just moved, not for its opponent
    var owner = (G.paused && !G.over)
      ? (G.mode === 'pvp' ? ((G.paused.move && G.paused.move.piece) & 24) : G.human)
      : (chess ? chess.turn : 0);
    var turn = !!chess && !G.over && owner === color;
    var thinking = turn && info.ai && G.thinking;
    el.classList.toggle('is-turn', turn);
    el.classList.toggle('thinking', thinking);
    el.setAttribute('data-color', colorCh(color));

    var av = el.querySelector('.strip-avatar');
    if (av.getAttribute('data-av') !== info.avatar) { av.innerHTML = info.avatar; av.setAttribute('data-av', info.avatar); }
    av.style.setProperty('--av-bg', info.bg);
    el.querySelector('.strip-name').innerHTML = esc(info.name) +
      (info.sub ? ' <span class="strip-color">(' + esc(info.sub) + ')</span>' : '');

    var caps = capturedBy(color), capsHtml = '', prevT = 0;
    caps.forEach(function (p) {
      var t = p & 7;
      if (prevT && t !== prevT) capsHtml += '<span class="cap-gap"></span>';
      capsHtml += '<span class="cap">' + art.icon(colorCh(p & 24), TYPE_CH[t]) + '</span>';
      prevT = t;
    });
    var adv = chess ? Math.round((materialOf(color) - materialOf(color ^ 24)) / 100) : 0;
    if (adv > 0) capsHtml += '<span class="strip-adv">+' + adv + '</span>';
    el.querySelector('.strip-caps').innerHTML = capsHtml;

    var st = el.querySelector('.strip-status');
    var text = '';
    if (chess && G.over && G.result) {
      if (G.result.reason === 'checkmate') text = G.result.winner === color ? '🏆 Победа!' : '';
      else text = '🤝 Ничья';
    } else if (turn) {
      if (G.mode === 'ai') text = color === G.human ? (G.paused ? 'Подумай…' : 'Твой ход!') : (G.thinking ? 'Думает' : 'Ходит…');
      else if (G.paused) text = 'Подумай…';
      else text = color === WHITE ? 'Ход белых' : 'Ход чёрных';
    }
    st.innerHTML = thinking ? esc(text) + '<span class="think-dots" aria-hidden="true"><i></i><i></i><i></i></span>' : esc(text);
  }
  function stripFor(color) {
    var orient = (G.view && G.view.orientation) || (G.mode === 'ai' ? colorCh(G.human) : 'w');
    var bottomColor = orient === 'b' ? BLACK : WHITE;
    return color === bottomColor ? $('#strip-bottom') : $('#strip-top');
  }
  function renderStrips() {
    if (!G.chess) return;
    var orient = (G.view && G.view.orientation) || (G.mode === 'ai' ? colorCh(G.human) : 'w');
    var bottom = orient === 'b' ? BLACK : WHITE;
    renderStrip($('#strip-bottom'), bottom);
    renderStrip($('#strip-top'), bottom ^ 24);
  }
  function oppSay(kind, delay) {
    if (G.mode !== 'ai') return;
    var lines = opp().lines[kind];
    if (!lines || !lines.length) return;
    var text = pick(lines);
    var show = function () {
      var el = stripFor(G.human ^ 24);
      if (!el) return;
      ensureStripDom(el);
      var bubble = el.querySelector('.strip-say');
      bubble.textContent = text;
      bubble.classList.add('show');
      clearTimeout(G.sayTimers.opp);
      G.sayTimers.opp = setTimeout(function () { bubble.classList.remove('show'); }, 2600);
    };
    if (delay) later(show, delay); else show();
  }
  function plyHtml(m, isLast) {
    var c = colorCh(m.piece & 24), t = TYPE_CH[m.piece & 7];
    var tag = '';
    if (m.flags & FLAG.CASTLE) tag += ' 🏰';
    if (m.flags & FLAG.PROMO) tag += ' 👑';
    var san = m.san || '';
    if (san.indexOf('#') >= 0) tag += ' 🏆';
    else if (san.indexOf('+') >= 0) tag += ' ⚡';
    return '<span class="ply' + (m.captured ? ' cap' : '') + (isLast ? ' last' : '') + '" title="' + esc(san) + '">' +
      '<span class="mini" aria-hidden="true">' + art.icon(c, t) + '</span>' +
      sqName(m.from) + '→' + sqName(m.to) + (tag ? '<span class="tag">' + tag + '</span>' : '') + '</span>';
  }
  function renderMoves() {
    var list = $('#moves-list');
    if (!list || !G.chess) return;
    var hist = G.chess.history();
    if (!hist.length) {
      list.innerHTML = '<div class="moves-empty">Пока ходов нет. Первыми ходят белые!</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < hist.length; i += 2) {
      html += '<div class="move-row"><span class="move-no">' + (i / 2 + 1) + '.</span>' +
        plyHtml(hist[i], i === hist.length - 1) +
        (hist[i + 1] ? plyHtml(hist[i + 1], i + 1 === hist.length - 1) : '<span></span>') + '</div>';
    }
    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
  }
  function updateControls() {
    var chess = G.chess;
    var hint = $('#btn-hint'), undo = $('#btn-undo');
    if (!hint || !undo) return;
    var canHint = !!chess && !G.over && !G.busy && !G.thinking && !G.paused && isHumanTurn();
    hint.disabled = !canHint;
    hint.classList.toggle('is-busy', !!G.hintBusy);
    var hasOwn = !!chess && chess.history().some(function (m) { return G.mode === 'pvp' || (m.piece & 24) === G.human; });
    undo.disabled = !hasOwn || G.busy;
  }
  function renderGameOverCard() {
    var card = $('#game-over-card');
    if (!card) return;
    if (!G.over || !G.result) { card.hidden = true; card.innerHTML = ''; return; }
    var r = G.result, emoji, title;
    if (r.reason === 'checkmate') {
      if (G.mode === 'pvp') { emoji = '🏆'; title = r.winner === WHITE ? 'Победили белые!' : 'Победили чёрные!'; }
      else if (r.winner === G.human) { emoji = '🏆'; title = 'Ты победил!'; }
      else { emoji = '🌈'; title = 'Партия окончена'; }
    } else { emoji = '🤝'; title = 'Ничья!'; }
    card.innerHTML = '<div class="go-emoji" aria-hidden="true">' + emoji + '</div><div class="go-title">' + esc(title) + '</div>' +
      '<div class="go-text">Можно посмотреть доску или начать заново.</div>' +
      '<button type="button" class="btn btn-green" id="go-new">✨ Новая игра</button>';
    card.hidden = false;
    var b = $('#go-new');
    if (b) b.addEventListener('click', function () { snd('click'); restartSame(); });
  }
  function renderAll() {
    renderStrips();
    renderMoves();
    updateControls();
    renderGameOverCard();
    persistGame();
  }
  function syncCheck() {
    var chess = G.chess;
    if (!chess) return;
    var inCheck = false;
    try { inCheck = chess.inCheck(); } catch (e) { inCheck = false; }
    var k = chess.kings ? chess.kings[chess.turn] : -1;
    vcall('setCheck', inCheck && k >= 0 ? k : -1);
  }
  function updateDanger() {
    if (!G.chess || !G.view) return;
    if (!App.settings.danger || G.over || !isHumanTurn() || G.thinking) { vcall('setDanger', []); return; }
    vcall('setDanger', legalHanging(G.chess.turn).map(function (x) { return x.sq; }));
  }

  // ------------------------------------------------------------------------------ mascot messages
  function pickBest(cands) {
    var best = null;
    cands.forEach(function (c) { if (c && c.text && (!best || c.pri > best.pri)) best = c; });
    return best;
  }
  function showCand(best) {
    if (!best) return;
    if (typeof best.onShow === 'function') { try { best.onShow(); } catch (e) { /* ignore */ } }
    G.mascot.say(best.text, { mood: best.mood || 'happy', speak: !!best.speak });
  }
  var REACT_MS = 2800;   // praise for the child's move stays at least this long (unless something important happens)
  var CAPTURE_PRAISE = [
    function (n) { return 'Ням! Ты съел ' + n.acc + '!'; },
    function (n) { return 'Ам! ' + cap(n.acc) + ' соперника — в копилку!'; },
    function (n) { return 'Отлично! Ты забрал ' + n.acc + '!'; },
    function (n) { return 'Вкуснятина! Ты съел ' + n.acc + '!'; }
  ];
  function reactToMove(m, st) {
    var pvp = G.mode === 'pvp';
    var mover = m.piece & 24;
    var sideNom = mover === WHITE ? 'Белые' : 'Чёрные';
    var capT = m.captured ? (m.captured & 7) : 0;
    var capN = capT ? N(capT) : null;
    var list = [];
    if (st.check) {
      var kingDat = (mover ^ 24) === WHITE ? 'белому' : 'чёрному';
      list.push({
        pri: 70, mood: 'wow', speak: true,
        text: pvp ? 'Шах ' + kingDat + ' королю!' : (capN ? 'Шах! Да ещё и ' + capN.acc + ' съел — здорово!' : 'Шах! Отлично!')
      });
    }
    if (capT === QUEEN) {
      list.push({ pri: 65, mood: 'wow', speak: true, text: pvp ? sideNom + ' съели ферзя!' : 'Ого! Ты съел ферзя — самую сильную фигуру!' });
    }
    if (m.flags & FLAG.PROMO) {
      list.push({ pri: 60, mood: 'wow', speak: true, text: 'Пешка дошла до конца и стала ' + N(m.promotion || QUEEN).ins + '!' });
    }
    if (m.flags & FLAG.EP) list.push({ pri: 55, mood: 'wow', speak: true, text: 'Взятие на проходе — хитрый приём!' });
    if (m.flags & FLAG.CASTLE) list.push({ pri: 50, mood: 'happy', speak: true, text: 'Рокировка! Король спрятался в домик.' });
    if (capN && capT !== QUEEN) {
      list.push({
        pri: 40, mood: 'wow', speak: VALUE[capT] >= 300,
        text: pvp ? sideNom + ' съели ' + capN.acc + '!' : pick(CAPTURE_PRAISE)(capN)
      });
    }
    if (!pvp && G.lastHint && G.lastHint.from === m.from && G.lastHint.to === m.to) {
      list.push({ pri: 30, mood: 'happy', speak: false, text: 'Молодец! Хороший ход!' });
    }
    var best = null;
    list.forEach(function (c) { if (!best || c.pri > best.pri) best = c; });
    return best;
  }
  function openingTip() {
    if (G.mode !== 'ai' || !G.chess) return null;
    var chess = G.chess, me = G.human;
    var hist = chess.history();
    var hm = hist.filter(function (m) { return (m.piece & 24) === me; }).length;
    if (hm > 14 || hm - G.lastTipHm < 3) return null;
    var home = me === WHITE ? 7 : 0;
    var minorsHome = [1, 2, 5, 6].filter(function (col) {
      var p = chess.get(home * 16 + col);
      return p && (p & 24) === me && ((p & 7) === KNIGHT || (p & 7) === BISHOP);
    }).length;
    var key = null, tip = null;
    if (!G.tips.center && hm >= 1 && hm <= 2) {
      var centerPawn = hist.some(function (m) {
        var f = m.from & 7;
        return (m.piece & 24) === me && (m.piece & 7) === PAWN && (f === 3 || f === 4);
      });
      if (!centerPawn) {
        key = 'center';
        tip = 'Совет: поставь пешку в центр — на ' + (me === WHITE ? 'e4 или d4' : 'e5 или d5') + '. Центр — самое важное место!';
      }
    }
    if (!tip && !G.tips.queen && hm >= 1 && hm <= 5 && minorsHome >= 3) {
      var queenMoved = hist.some(function (m) { return (m.piece & 24) === me && (m.piece & 7) === QUEEN; });
      if (queenMoved) {
        key = 'queen';
        tip = 'Совет: не спеши гулять ферзём — его могут прогнать. Сначала выведи коней и слонов!';
      }
    }
    if (!tip && !G.tips.develop && hm >= 2 && hm <= 9 && minorsHome >= 2) {
      key = 'develop';
      tip = 'Совет: выводи коней и слонов — пусть помогают в бою!';
    }
    if (!tip && !G.tips.castle && hm >= 3 && hm <= 14) {
      var canCastle = false;
      try { canCastle = chess.moves().some(function (m) { return m.flags & FLAG.CASTLE; }); } catch (e) { canCastle = false; }
      if (canCastle && !chess.inCheck()) {
        key = 'castle';
        tip = 'Совет: сделай рокировку — спрячь короля в домик!';
      }
    }
    if (!tip) return null;
    return { pri: 20, text: tip, mood: 'wow', speak: true, onShow: function () { G.tips[key] = true; G.lastTipHm = hm; } };
  }
  function nudgeMsg() {
    if (G.mode !== 'ai' || G.level > 2 || !G.chess) return null;
    var hm = humanMoveCount();
    if (hm - G.lastNudgeHm < 2) return null;
    var targets = hanging(G.human ^ 24).filter(function (x) { return VALUE[x.piece & 7] >= 300; });
    if (!targets.length) return null;
    var can = false;
    try {
      can = G.chess.moves().some(function (m) { return m.captured && targets.some(function (x) { return x.sq === m.to; }); });
    } catch (e) { can = false; }
    if (!can) return null;
    return { pri: 35, text: 'Хм… кажется, соперник что-то оставил без защиты 👀', mood: 'think', speak: false,
      onShow: function () { G.lastNudgeHm = hm; } };
  }
  function turnStartMessages(prev) {
    var chess = G.chess, me = chess.turn, pvp = G.mode === 'pvp', out = [];
    var inCheck = false;
    try { inCheck = chess.inCheck(); } catch (e) { inCheck = false; }
    if (inCheck) {
      out.push({ pri: 80, mood: 'warn', speak: true,
        text: pvp ? 'Шах ' + (me === WHITE ? 'белому' : 'чёрному') + ' королю! Спасай короля.' : 'Шах тебе! Спасай короля!' });
    }
    if (App.settings.danger) {
      var big = legalHanging(me).filter(function (x) { return VALUE[x.piece & 7] >= 300; });
      if (big.length) {
        big.sort(function (a, b) { return (VALUE[b.piece & 7] - VALUE[a.piece & 7]) || (b.loss - a.loss); });
        var n = N(big[0].piece & 7);
        var dKey = big[0].piece + '@' + big[0].sq;
        var repeated = dKey === G.lastDangerKey; // same warning as last turn: keep the ring, don't nag
        G.lastDangerKey = dKey;
        out.push({ pri: repeated ? 15 : 70, mood: 'warn', speak: !repeated,
          text: 'Осторожно! ' + cap(possAcc(n)) + ' ' + n.acc + ' на ' + sqName(big[0].sq) + ' хотят съесть!' });
      } else {
        G.lastDangerKey = '';
      }
    }
    if (prev && !pvp && (prev.piece & 24) !== G.human) {
      var o = opp();
      if (prev.flags & FLAG.PROMO) {
        out.push({ pri: 55, mood: 'wow', speak: true, text: 'Ой! Пешка соперника стала ' + N(prev.promotion || QUEEN).ins + '.' });
      }
      if (prev.captured) {
        var ct = prev.captured & 7, cn = N(ct), verb = o.g === 'f' ? 'съела' : 'съел';
        if (VALUE[ct] >= 300) {
          out.push({ pri: 50, mood: 'sad', speak: true, text: pick([
            'Ой, ' + o.short + ' ' + verb + ' ' + possAcc(cn) + ' ' + cn.acc + '. Ничего, играем дальше!',
            o.short + ' ' + verb + ' ' + possAcc(cn) + ' ' + cn.acc + '. Будь внимательнее — ты справишься!'
          ]) });
        } else {
          out.push({ pri: 30, mood: 'happy', speak: false, text: pick([
            o.short + ' ' + verb + ' твою пешку. Не беда!',
            'Пешку съели — ничего страшного!'
          ]) });
        }
      }
      if (prev.flags & FLAG.CASTLE) {
        var fem = o.g === 'f';
        out.push({ pri: 25, mood: 'think', speak: false,
          text: o.short + ' ' + (fem ? 'сделала' : 'сделал') + ' рокировку и ' + (fem ? 'спрятала' : 'спрятал') + ' короля в домик.' });
      }
    }
    out.push(nudgeMsg());
    out.push(openingTip());
    var neutral = pvp
      ? ['Ход ' + (me === WHITE ? 'белых' : 'чёрных') + '!']
      : ['Твой ход!', 'Теперь ходишь ты!', 'Твой ход — подумай хорошенько!', 'Твой ход, ' + childName() + '!'];
    out.push({ pri: 1, mood: 'happy', speak: false, text: neutral[(G.neutralI++) % neutral.length] });
    return out;
  }
  function startHumanTurn(prev, extra) {
    if (!G.chess || G.over) return;
    updateDanger();
    var cands = turnStartMessages(prev);
    if (extra) cands.push(extra);
    var best = pickBest(cands);
    renderAll();
    if (!best) return;
    var wait = G.reactUntil - now();
    if (best.pri < 50 && wait > 0) {
      // don't replace the praise for the child's last move too soon with a neutral line or a tip
      var e0 = G.epoch, n0 = G.chess.history().length, chess = G.chess;
      later(function () {
        if (e0 !== G.epoch || G.chess !== chess || G.over || G.paused || !isHumanTurn() || chess.history().length !== n0) return;
        showCand(best);
      }, wait);
      return;
    }
    showCand(best);
  }

  // ------------------------------------------------------------------------------ move handling
  function playMoveSound(m, st) {
    if (m.flags & FLAG.PROMO) snd('promote');
    else if (m.flags & FLAG.CASTLE) snd('castle');
    else if (m.captured) snd('capture');
    else snd('move');
    if (st.check && !st.over) later(function () { snd('check'); }, 170);
  }
  function moveFx(m) {
    var big = (m.captured && VALUE[m.captured & 7] >= 300) || (m.flags & FLAG.PROMO);
    if (!big || !G.view || typeof G.view.squareCenter !== 'function' || currentScreen !== 'game') return;
    try {
      var p = G.view.squareCenter(m.to);
      if (p) fx.burst(p.x, p.y, { count: 22, shape: 'star', colors: ['#ffc93c', '#ff7a59', '#ff6fae', '#6c63ff'] });
    } catch (e) { logErr('squareCenter', e); }
  }
  function trackMoveAchievements(m, st) {
    unlock('first_move');
    if (st.check || (st.over && st.reason === 'checkmate')) unlock('first_check');
    if (m.flags & FLAG.CASTLE) unlock('castle');
    if (m.flags & FLAG.PROMO) unlock('promote');
    if (m.flags & FLAG.EP) unlock('en_passant');
    if (m.captured && (m.captured & 7) === QUEEN) unlock('capture_queen');
  }

  var handleUserMove = guard(handleUserMoveImpl, 'handleUserMove');
  async function handleUserMoveImpl(p) {
    var chess = G.chess;
    if (!chess || !G.view || !p) return;
    var from = toSq(p.from), to = toSq(p.to);
    if (!canHumanAct()) {
      vcall('setPosition', chess, { lastMove: lastMoveOf(chess) });
      return;
    }
    var mover = chess.turn;
    var before = {};   // square -> what the opponent could win there before this move (safety net compares)
    if (App.settings.safety) {
      legalHanging(mover).forEach(function (x) { before[x.sq] = x.loss; });
    }
    var promo = promoType(p.promotion);
    var m = null;
    try { m = chess.move(promo ? { from: from, to: to, promotion: promo } : { from: from, to: to }); } catch (e) { logErr('chess.move', e); m = null; }
    if (!m) {
      vcall('setPosition', chess, { lastMove: lastMoveOf(chess) });
      onIllegal(from, to);
      return;
    }
    var e0 = G.epoch;
    if (G.hintBusy) { G.hintBusy = false; AIClient.cancel(); } // the pending hint is stale now
    vcall('clearArrows');
    vcall('clearPulses');
    vcall('setDanger', []);
    G.busy = true;
    updateControls();
    try {
      await G.view.applyMove(m, chess, { dragged: !!p.dragged });
    } catch (err) {
      logErr('applyMove', err);
      vcall('setPosition', chess, { lastMove: m });
    } finally {
      G.busy = false;
    }
    if (e0 !== G.epoch) return;
    afterMove(m, { before: before });
  }

  // the praise / achievements / opponent reaction for the child's move (not while the safety net questions it)
  function humanMoveRewards(m, st) {
    trackMoveAchievements(m, st);
    moveFx(m);
    if (G.mode === 'ai' && m.captured) oppSay('ouch', 250);
  }
  function afterMove(m, ctx) {
    ctx = ctx || {};
    var mover = m.piece & 24;
    var humanMove = G.mode === 'pvp' || mover === G.human;
    var st = status();
    syncCheck();
    renderAll();
    playMoveSound(m, st);
    // safety net first: a move the child may take back earns no award, burst or «ouch» yet
    if (humanMove && !st.over && App.settings.safety && safetyCheck(m, mover, ctx.before || {}, st)) return;
    if (humanMove) {
      humanMoveRewards(m, st);
    } else {
      if (st.check && !st.over) oppSay('check', 200);
      else if (m.captured) oppSay('capture', 200);
    }
    if (st.over) { endGame(st); return; }

    if (humanMove) proceedAfterHuman(m, st);
    else startHumanTurn(m);
  }

  // keepText: the mascot has just said something that should stay (e.g. after «Оставить так»)
  function proceedAfterHuman(m, st, keepText) {
    var react = m ? reactToMove(m, st || status()) : null;
    G.lastHint = null;
    if (G.mode === 'ai') {
      if (react) {
        G.mascot.say(react.text, { mood: react.mood, speak: react.speak });
        G.reactUntil = now() + REACT_MS;
      } else if (!keepText) {
        G.mascot.say('', { mood: 'think', speak: false });
      }
      aiTurn();
    } else {
      if (App.settings.flipPvp) {
        var e0 = G.epoch;
        later(function () {
          if (e0 !== G.epoch || !G.chess || G.over) return;
          var want = colorCh(G.chess.turn);
          if (G.view && G.view.orientation !== want) {
            vcall('setOrientation', want);
            snd('whoosh');
            renderStrips();
          }
        }, 550);
      }
      startHumanTurn(m, react);
    }
  }

  // ---------------------------------------------------------------------------------------- AI
  function findLegal(mv) {
    if (!mv || !G.chess) return null;
    var from = toSq(mv.from), to = toSq(mv.to);
    if (from < 0 || to < 0) return null;
    var promo = promoType(mv.promotion) || QUEEN;
    var ms;
    try { ms = G.chess.moves({ from: from }); } catch (e) { return null; }
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.to !== to) continue;
      if ((m.flags & FLAG.PROMO) && m.promotion !== promo) continue;
      return m;
    }
    return null;
  }
  function fallbackMove(level) {
    var chess = G.chess;
    if (!chess) return null;
    try {
      if (global.ChessAI && typeof global.ChessAI.chooseMove === 'function') {
        var r = global.ChessAI.chooseMove(chess.clone(), level);
        var fm = findLegal(r);
        if (fm) return fm;
      }
    } catch (e) { logErr('fallback chooseMove', e); }
    var ms = [];
    try { ms = chess.moves(); } catch (e) { ms = []; }
    if (!ms.length) return null;
    var caps = ms.filter(function (m) { return m.captured; });
    return pick(caps.length && Math.random() < 0.6 ? caps : ms);
  }

  var aiTurn = guard(aiTurnImpl, 'aiTurn');
  async function aiTurnImpl() {
    var chess = G.chess;
    if (!chess || G.over || G.mode !== 'ai' || chess.turn === G.human || G.thinking || G.paused || G.busy) return;
    if (currentScreen !== 'game') { G.needsResume = true; return; }
    var e0 = G.epoch, fen = chess.fen(), t0 = now();
    G.thinking = true;
    updateDanger();
    renderStrips();
    updateControls();
    if (Math.random() < 0.25) oppSay('think', 500);

    var res = null;
    try { res = await AIClient.request(fen, G.level, chess); } catch (e) { res = null; }
    if (e0 !== G.epoch || G.chess !== chess || res && res.cancelled) return;
    var wait = 600 - (now() - t0);
    if (wait > 0) await sleep(wait);
    if (e0 !== G.epoch || G.chess !== chess || chess.fen() !== fen) return;

    var mv = findLegal(res && res.move) || fallbackMove(G.level);
    G.thinking = false;
    if (!mv) {
      var st0 = status();
      if (st0.over) endGame(st0); else renderAll();
      return;
    }
    var m = null;
    try { m = chess.move(mv); } catch (e) { logErr('ai move', e); m = null; }
    if (!m) { renderAll(); return; }
    G.busy = true;
    renderStrips();
    try {
      await G.view.applyMove(m, chess, {});
    } catch (err) {
      logErr('applyMove(ai)', err);
      vcall('setPosition', chess, { lastMove: m });
    } finally {
      G.busy = false;
    }
    if (e0 !== G.epoch) return;
    afterMove(m, {});
  }

  // ------------------------------------------------------------------------------- safety net
  // before: square -> loss the opponent could already win there before the move (legalHanging of the mover)
  function safetyCheck(m, mover, before, st) {
    before = before || {};
    var threats = matesInOne();
    if (threats.length) {
      pauseSafety(m, st, 'Ой! Если так сходить, соперник поставит мат!', { from: threats[0].from, to: threats[0].to }, threats[0].to);
      return true;
    }
    var capVal = m.captured ? (VALUE[m.captured & 7] || 0) : 0;
    var worst = null, worstNet = 0;
    legalHanging(mover).forEach(function (x) {
      // the moved piece (also a fresh queen after a promotion): moving an attacked piece to another attacked
      // square is the blunder itself, so its old square doesn't count. Other pieces: only what got worse
      // (a removed defender, a discovered attack), so a piece left hanging exactly as before doesn't nag.
      var net = x.sq === m.to ? x.loss - capVal : x.loss - (before[x.sq] || 0) - capVal;
      if (net < 200) return;
      if (!worst || net > worstNet || (net === worstNet && VALUE[x.piece & 7] > VALUE[worst.piece & 7])) {
        worst = x;
        worstNet = net;
      }
    });
    if (!worst) return false;
    var n = N(worst.piece & 7);
    pauseSafety(m, st, 'Ой! Так ' + possAcc(n) + ' ' + n.acc + ' могут съесть. Хочешь переходить?',
      worst.from >= 0 ? { from: worst.from, to: worst.sq } : null, worst.sq);
    return true;
  }
  function pauseSafety(m, st, text, arrow, sq) {
    G.paused = { move: m, st: st || status(), text: text, arrow: arrow || null, sq: typeof sq === 'number' ? sq : -1 };
    showSafetyPause(G.paused, true);
  }
  // shows the «Страховка» question (first time or again after the child left the game / reloaded the page)
  function showSafetyPause(p, fresh) {
    if (!p) return;
    vcall('deselect');
    vcall('clearArrows');
    vcall('clearPulses');
    vcall('setDanger', []);
    if (p.arrow) vcall('showArrow', p.arrow.from, p.arrow.to, { kind: 'danger' });
    if (p.sq >= 0) vcall('pulseSquare', p.sq, 'danger');
    $$('.strip-say.show').forEach(function (b) { b.classList.remove('show'); });   // no opponent chatter over the question
    if (fresh) snd('notify');
    G.mascot.say(p.text, { mood: 'warn', speak: true });
    var bar = $('#safety-bar');
    if (bar) {
      $('#safety-text').textContent = p.text;
      bar.hidden = false;
      // restart the pop-in animation
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
    }
    renderAll();
  }
  function hideSafety() {
    var bar = $('#safety-bar');
    if (bar) bar.hidden = true;
  }
  var safetyUndo = guard(safetyUndoImpl, 'safetyUndo');
  async function safetyUndoImpl() {
    if (!G.paused || !G.chess) return;
    G.paused = null;
    hideSafety();
    vcall('clearArrows');
    vcall('clearPulses');
    var um = null;
    try { um = G.chess.undo(); } catch (e) { um = null; }
    if (um) {
      var e0 = G.epoch;
      G.busy = true;
      updateControls();
      try { await G.view.undoMove(um, G.chess); } catch (err) { vcall('setPosition', G.chess, { lastMove: lastMoveOf(G.chess) }); } finally { G.busy = false; }
      if (e0 !== G.epoch) return;
    }
    syncCheck();
    snd('whoosh');
    startHumanTurn(null, { pri: 90, text: 'Правильно! Подумай ещё немножко 🙂', mood: 'happy', speak: false });
  }
  function safetyKeep() {
    var p = G.paused;
    if (!p) return;
    G.paused = null;
    hideSafety();
    vcall('clearArrows');
    vcall('clearPulses');
    snd('click');
    // the move stays: now it may earn its awards (no praise for a blunder though)
    if (p.move) humanMoveRewards(p.move, p.st || status());
    renderAll();
    if (G.mode === 'ai') G.mascot.say('Хорошо, играем дальше!', { mood: 'happy', speak: false });
    proceedAfterHuman(null, null, true);
  }

  // ---------------------------------------------------------------------------- illegal / clicks
  function castleReason(chess, from, to, color) {
    var kingSide = (to & 7) > (from & 7);
    var right = color === WHITE ? (kingSide ? 1 : 2) : (kingSide ? 4 : 8);
    if (typeof chess.castling === 'number' && !(chess.castling & right)) return 'Рокировку сделать нельзя: король или ладья уже ходили.';
    if (chess.inCheck(color)) return 'Когда королю шах, рокироваться нельзя!';
    var row = from >> 4;
    var cols = kingSide ? [5, 6] : [1, 2, 3];
    if (cols.some(function (c) { return chess.get(row * 16 + c); })) return 'Для рокировки между королём и ладьёй не должно быть фигур.';
    return 'Король не может проходить через клетку, которую бьёт соперник.';
  }
  function pieceRule(t, c, from, to) {
    var dr = (to >> 4) - (from >> 4), dc = (to & 7) - (from & 7);
    var adr = Math.abs(dr), adc = Math.abs(dc);
    switch (t) {
      case PAWN: {
        var fwd = c === WHITE ? -1 : 1, startRow = c === WHITE ? 6 : 1;
        if (dr === 0 || (dr > 0 ? 1 : -1) !== fwd) return 'Пешка ходит только вперёд — назад и вбок нельзя!';
        if (dc === 0) {
          if (adr === 1 || (adr === 2 && (from >> 4) === startRow)) return 'Пешка не может ходить вперёд, если перед ней кто-то стоит.';
          if (adr === 2) return 'На две клетки пешка может шагнуть только с начальной клетки.';
          return 'Пешка ходит вперёд на одну клетку (с начальной клетки — можно на две).';
        }
        if (adc === 1 && adr === 1) return 'Пешка бьёт наискосок, только если там стоит фигура соперника.';
        return 'Пешка ходит вперёд на одну клетку, а бьёт наискосок.';
      }
      case KNIGHT: return 'Конь ходит буквой «Г»: две клетки прямо и одну вбок.';
      case BISHOP: return adr === adc ? 'Слон не умеет перепрыгивать через фигуры!' : 'Слон ходит только по диагонали.';
      case ROOK: return (dr === 0 || dc === 0) ? 'Ладья не умеет перепрыгивать через фигуры!' : 'Ладья ходит только по прямым линиям.';
      case QUEEN: return (dr === 0 || dc === 0 || adr === adc) ? 'Ферзь не умеет перепрыгивать через фигуры!' : 'Ферзь ходит по прямым линиям и по диагоналям.';
      case KING: return 'Король ходит только на одну клетку в любую сторону.';
      default: return 'Так эта фигура не ходит.';
    }
  }
  function explainIllegal(chess, from, to) {
    if (from < 0 || to < 0 || from === to) return null;
    var p = chess.get(from);
    if (!p) return null;
    var c = p & 24, t = p & 7;
    if (c !== chess.turn) return null;
    var target = chess.get(to);
    if (t === KING && (from >> 4) === (to >> 4) && Math.abs((to & 7) - (from & 7)) === 2 && (from & 7) === 4) {
      return castleReason(chess, from, to, c);
    }
    if (target && (target & 24) === c) return 'Там стоит твоя фигура. На свою фигуру ходить нельзя!';
    var pseudo = false;
    try { pseudo = chess.genMoves().some(function (m) { return m.from === from && m.to === to; }); } catch (e) { pseudo = false; }
    var inCheck = false;
    try { inCheck = chess.inCheck(c); } catch (e) { inCheck = false; }
    if (pseudo) {
      if (t === KING) return inCheck ? 'Туда нельзя — там король тоже будет под шахом!' : 'Королю туда нельзя — там его побьют!';
      if (inCheck) return 'Твоему королю шах! Сначала спаси короля.';
      return 'Так нельзя — твой король окажется под шахом!';
    }
    if (inCheck) return 'Твоему королю шах! Сначала спаси короля.';
    return pieceRule(t, c, from, to);
  }
  function onIllegal(from, to, fromBoard) {
    var chess = G.chess;
    if (!chess || G.over || G.paused) return;
    from = toSq(from); to = toSq(to);
    var text = null;
    try { text = explainIllegal(chess, from, to); } catch (e) { logErr('explainIllegal', e); }
    if (!text) return;
    if (!fromBoard) {
      snd('illegal');
      vcall('shakePiece', from);
    }
    var t = Date.now();
    var repeat = G.lastIllegal.text === text && t - G.lastIllegal.at < 6000;
    G.lastIllegal = { text: text, at: t };
    G.mascot.say(text, { mood: 'warn', speak: !repeat });
  }
  function onSelectPiece(sq) {
    var chess = G.chess;   // the board plays 'select' itself
    if (!chess) return;
    var ms = [];
    try { ms = chess.moves({ from: sq }); } catch (e) { ms = []; }
    if (!ms.length) {
      var p = chess.get(sq), n = N(p & 7);
      var inCheck = false;
      try { inCheck = chess.inCheck(); } catch (e) { inCheck = false; }
      G.mascot.say(inCheck ? 'Твоему королю шах! Этой фигурой его не спасти.' : 'У ' + n.gen + ' сейчас нет ходов. Выбери другую фигуру!',
        { mood: 'think', speak: false });
    }
  }
  function onSquareClick(sq) {
    var chess = G.chess;
    if (!chess || sq < 0) return;
    var t = Date.now();
    if (t - G.lastClickMsgAt < 1500) return;
    var p = chess.get(sq), text = null;
    if (G.over) text = 'Партия окончена. Нажми «✨ Новая игра», чтобы сыграть ещё!';
    else if (G.paused) text = 'Сначала реши: переходить или оставить так?';
    else if (!p) return;
    else if (G.mode === 'ai' && (p & 24) !== G.human) text = 'Это фигура соперника. Ты играешь ' + (G.human === WHITE ? 'белыми' : 'чёрными') + '!';
    else if (G.mode === 'ai' && chess.turn !== G.human) text = 'Подожди, сейчас ходит ' + opp().short + '…';
    else if (G.mode === 'pvp' && (p & 24) !== chess.turn) text = 'Сейчас ход ' + (chess.turn === WHITE ? 'белых' : 'чёрных') + '!';
    if (!text) return;
    G.lastClickMsgAt = t;
    G.mascot.say(text, { mood: 'think', speak: false });
  }

  // -------------------------------------------------------------------------------------- hint
  function givesCheck(m) {
    try {
      var c = G.chess.clone();
      var r = c.move({ from: m.from, to: m.to, promotion: m.promotion || undefined });
      return !!r && c.inCheck();
    } catch (e) { return false; }
  }
  function explainHint(m, isMate) {
    var chess = G.chess;
    if (isMate) return 'Ура, здесь можно поставить мат! Смотри на стрелку 👀';
    var t = m.piece & 7, n = N(t);
    var inCheck = false;
    try { inCheck = chess.inCheck(); } catch (e) { inCheck = false; }
    if (inCheck) return 'Твоему королю шах! Вот как спастись.';
    if (m.captured) return 'Можно съесть ' + N(m.captured & 7).acc + ' ' + n.ins + '!';
    if (legalHanging(chess.turn).some(function (x) { return x.sq === m.from; })) {
      return (n.g === 'f' ? 'Твоя ' : 'Твой ') + n.nom + ' под атакой — уведи ' + (n.g === 'f' ? 'её' : 'его') + '!';
    }
    if (m.flags & FLAG.CASTLE) return 'Сделай рокировку — спрячь короля в домик!';
    if (m.flags & FLAG.PROMO) return 'Проведи пешку в ферзи!';
    if (givesCheck(m)) return 'Поставь шах ' + n.ins + '!';
    var backRow = chess.turn === WHITE ? 7 : 0;
    if ((t === KNIGHT || t === BISHOP) && (m.from >> 4) === backRow && (chess.fullmove || 1) <= 12) return 'Выведи ' + n.acc + ' в игру!';
    return 'Попробуй так: ' + n.Nom + ' ' + sqName(m.from) + ' → ' + sqName(m.to);
  }
  var onHint = guard(onHintImpl, 'onHint');
  async function onHintImpl() {
    var chess = G.chess;
    if (!chess || G.over || G.hintBusy) return;
    if (G.paused) { G.mascot.say('Сначала реши: переходить или оставить так?', { mood: 'think', speak: false }); return; }
    if (!canHumanAct()) {
      if (G.thinking) G.mascot.say('Подожди, ' + opp().short + ' ещё думает…', { mood: 'think', speak: false });
      return;
    }
    var fen = chess.fen(), e0 = G.epoch;
    var mates = matesInOne();
    var mv = mates.length ? mates[0] : null;
    if (!mv) {
      G.hintBusy = true;
      updateControls();
      G.mascot.say('Сейчас подумаю', { mood: 'think', speak: false });
      var res = null;
      try { res = await AIClient.request(fen, 'hint', chess); } catch (e) { res = null; }
      if (e0 !== G.epoch || G.chess !== chess || chess.fen() !== fen || G.over) {
        G.hintBusy = false;
        updateControls();
        return;
      }
      mv = findLegal(res && res.move) || fallbackMove('hint');
      G.hintBusy = false;
    }
    if (!mv) { updateControls(); return; }
    G.hintsUsed++;
    App.profile.stats.hints = Math.floor(nonNeg(App.profile.stats.hints, 0)) + 1;
    App.save();
    persistGame();
    G.lastHint = { from: mv.from, to: mv.to };
    vcall('clearArrows');
    vcall('clearPulses');
    vcall('showArrow', mv.from, mv.to, { kind: 'hint' });
    vcall('pulseSquare', mv.from, 'hint');
    snd('hint');
    G.mascot.say(explainHint(mv, mates.length > 0), { mood: 'wow', speak: true });
    updateControls();
  }

  // --------------------------------------------------------------------------- undo, flip, new
  var onUndo = guard(onUndoImpl, 'onUndo');
  async function onUndoImpl() {
    var chess = G.chess;
    if (!chess || G.busy) return;
    if (G.paused) { safetyUndo(); return; }
    var hist = chess.history();
    var hasOwn = hist.some(function (m) { return G.mode === 'pvp' || (m.piece & 24) === G.human; });
    if (!hasOwn) {
      G.mascot.say(G.mode === 'ai' ? 'Ты ещё не сделал ни одного хода.' : 'Пока нечего отменять.', { mood: 'think', speak: false });
      return;
    }
    cancelAll();
    var wasOver = G.over;
    G.over = false;
    G.result = null;
    vcall('clearArrows');
    vcall('clearPulses');
    vcall('setDanger', []);
    vcall('deselect');
    var e0 = G.epoch;
    G.busy = true;
    updateControls();
    try {
      var humanUndone = false;
      while (chess.history().length) {
        var m = chess.undo();
        if (!m) break;
        if (wasOver) vcall('setPosition', chess, { lastMove: lastMoveOf(chess) });
        else {
          try { await G.view.undoMove(m, chess); } catch (err) { vcall('setPosition', chess, { lastMove: lastMoveOf(chess) }); }
          if (e0 !== G.epoch) return;
        }
        if (G.mode === 'pvp') break;
        if ((m.piece & 24) === G.human) humanUndone = true;
        if (humanUndone && chess.turn === G.human) break;
      }
    } finally {
      G.busy = false;
    }
    if (e0 !== G.epoch) return;
    if (wasOver) {
      vcall('setSideState', 'w', null);
      vcall('setSideState', 'b', null);
      vcall('setPosition', chess, { lastMove: lastMoveOf(chess) });
    }
    syncCheck();
    snd('whoosh');
    if (G.mode === 'pvp' && App.settings.flipPvp) vcall('setOrientation', colorCh(chess.turn));
    if (G.mode === 'ai' && chess.turn !== G.human) {
      renderAll();
      aiTurn();
      return;
    }
    startHumanTurn(null, { pri: 85, text: 'Ход отменён. Попробуй по-другому!', mood: 'happy', speak: false });
  }
  function onFlip() {
    if (!G.view) return;
    vcall('flip');
    snd('whoosh');
    renderStrips();
    persistGame();
  }
  function restartSame() {
    if (G.mode === 'pvp') startGame({ mode: 'pvp' });
    else startGame({ mode: 'ai', level: G.level, color: G.colorPref });
  }
  function onNewGame() {
    var chess = G.chess;
    if (chess && !G.over && chess.history().length > 0) {
      modal({
        emoji: '✨', title: 'Начать новую партию?',
        html: '<p>Эта партия ещё не закончена.</p>',
        buttons: [
          { label: 'Да, новая игра', kind: 'green', onClick: restartSame },
          { label: 'Нет, играем дальше', kind: 'ghost' }
        ]
      });
    } else {
      restartSame();
    }
  }

  // ----------------------------------------------------------------------------------- the end
  function drawText(reason) {
    switch (reason) {
      case 'stalemate': return 'Пат! Королю некуда ходить, но шаха нет. Это ничья.';
      case 'insufficient': return 'На доске осталось слишком мало фигур — мат поставить нельзя. Ничья!';
      case 'threefold': return 'Одна и та же позиция повторилась три раза. Это ничья!';
      case 'fifty': return 'Целых 50 ходов никто никого не съел и пешки не ходили. Это ничья!';
      default: return 'Это ничья!';
    }
  }
  function endGame(st) {
    if (G.over || !G.chess) return;
    var chess = G.chess;
    G.over = true;
    G.thinking = false;
    G.hintBusy = false;
    G.result = st;
    G.paused = null;
    hideSafety();
    vcall('clearArrows');
    vcall('clearPulses');
    vcall('setDanger', []);
    vcall('deselect');

    var pvp = G.mode === 'pvp';
    var outcome = st.reason === 'checkmate' ? (pvp ? 'win' : (st.winner === G.human ? 'win' : 'loss')) : 'draw';
    // Rewards are paid once per game, but a better result after «↩️ Ход назад» (loss → draw/win, draw → win)
    // upgrades what was paid: the stats move to the new bucket and the missing stars are added.
    var RANK = { loss: 0, draw: 1, win: 2 };
    var fullStars = pvp ? 1 : (outcome === 'win' ? (WIN_STARS[G.level] || 2) : (outcome === 'draw' ? 1 : 0));
    var paid = G.paid || { outcome: null, stars: 0 };
    var s = App.profile.stats;
    var stars = 0, firstEnd = paid.outcome === null, paysWin = false;
    if (firstEnd) {
      if (pvp) s.pvpGames = (s.pvpGames || 0) + 1;
      else {
        s.games = (s.games || 0) + 1;
        if (outcome === 'win') s.wins[G.level] = (s.wins[G.level] || 0) + 1;
        else if (outcome === 'draw') s.draws = (s.draws || 0) + 1;
        else s.losses = (s.losses || 0) + 1;
      }
      stars = fullStars;
      G.paid = { outcome: outcome, stars: stars };
      paysWin = !pvp && outcome === 'win';
      App.save();
    } else if (!pvp && RANK[outcome] > RANK[paid.outcome]) {
      if (paid.outcome === 'loss') s.losses = Math.max(0, (s.losses || 0) - 1);
      else if (paid.outcome === 'draw') s.draws = Math.max(0, (s.draws || 0) - 1);
      if (outcome === 'win') s.wins[G.level] = (s.wins[G.level] || 0) + 1;
      else s.draws = (s.draws || 0) + 1;
      stars = Math.max(0, fullStars - (paid.stars || 0));
      G.paid = { outcome: outcome, stars: (paid.stars || 0) + stars };
      paysWin = outcome === 'win';
      App.save();
    }
    G.pendingStars = stars;
    G.endPending = true;   // hold achievement toasts: the end modal shows the new awards itself
    if (outcome === 'win' && (pvp || st.winner === G.human)) G.celebratedAt = now();

    if (st.reason === 'checkmate') {
      var loser = st.winner ^ 24;
      var ksq = chess.kings ? chess.kings[loser] : -1;
      later(function () {
        if (ksq >= 0) vcall('tipKing', ksq);
        vcall('setSideState', colorCh(st.winner), 'happy');
      }, 380);
    }
    if (outcome === 'win') {
      later(function () {
        snd('win');
        fx.confetti();
        if (pvp || st.winner === G.human) fx.fireworks(2600);
      }, 450);
    } else if (outcome === 'loss') later(function () { snd('lose'); }, 450);
    else later(function () { snd('draw'); }, 350);

    if (pvp && firstEnd) unlock('pvp');
    if (paysWin) {
      unlock('first_win');
      unlock('beat_' + G.level);
      if (!G.hintsUsed) unlock('no_hints_win');
    }

    if (!pvp) oppSay(outcome === 'win' ? 'lose' : (outcome === 'loss' ? 'win' : 'draw'), 500);
    var mText, mMood;
    if (pvp) {
      mText = outcome === 'win' ? 'Мат! ' + (st.winner === WHITE ? 'Победили белые!' : 'Победили чёрные!') : drawText(st.reason);
      mMood = 'wow';
    } else if (outcome === 'win') { mText = 'Ура! Мат! Ты победил! 🎉'; mMood = 'wow'; }
    else if (outcome === 'loss') { mText = 'Эх, мат. Ничего — в следующий раз получится!'; mMood = 'sad'; }
    else { mText = drawText(st.reason); mMood = 'think'; }
    G.mascot.say(mText, { mood: mMood, speak: false });
    renderAll();
    var e0 = G.epoch;
    later(function () { if (e0 === G.epoch) showEndModal(outcome, st, stars); }, st.reason === 'checkmate' ? 1700 : 1000);
  }
  function showEndModal(outcome, st, stars) {
    if (!G.over || currentScreen !== 'game') { G.endPending = false; flushPendingStars(); return; }
    var pvp = G.mode === 'pvp', o = opp(), name = childName();
    var emoji, title, text;
    if (pvp) {
      if (outcome === 'win') { emoji = '🏆'; title = st.winner === WHITE ? 'Победили белые!' : 'Победили чёрные!'; text = 'Мат! Отличная партия. Пожмите друг другу руки 🤝'; }
      else { emoji = '🤝'; title = 'Ничья!'; text = drawText(st.reason); }
    } else if (outcome === 'win') {
      emoji = '🏆'; title = 'Победа!'; text = 'Ты победил ' + o.acc + '! Ура, ' + name + '!';
    } else if (outcome === 'loss') {
      emoji = '🌈'; title = 'Ничего страшного!';
      text = 'В этот раз ' + (o.g === 'f' ? 'победила' : 'победил') + ' ' + o.name + '. Каждая партия делает тебя сильнее!';
    } else {
      emoji = '🤝'; title = 'Ничья!'; text = drawText(st.reason);
    }
    var extra = '';
    var alreadyPaid = stars === 0 && !!G.paid && G.paid.stars > 0;
    if (stars > 0 && G.pendingStars > 0) {
      var starSpans = '';
      for (var i = 0; i < Math.min(stars, 8); i++) starSpans += '<span class="es-star" style="--i:' + i + '">⭐</span>';
      extra = '<div class="end-stars" id="end-stars">+' + stars + ' ' + starSpans + '</div>';
    } else if (alreadyPaid) {
      extra = '<p class="end-note">Звёздочки за эту партию ты уже получил.</p>';
    } else if (outcome === 'loss') {
      extra = '<p class="end-note">Звёздочки ждут тебя в следующей партии! Нажми «Посмотреть доску», а потом «↩️ Ход назад», чтобы найти ошибку.</p>';
    }
    // new awards of this game are shown right here instead of as toasts over the modal
    var newAch = achQueue.splice(0);
    if (newAch.length) {
      extra += '<div class="end-ach"><div class="end-ach-title">' + (newAch.length > 1 ? 'Новые награды:' : 'Новая награда:') + '</div>' +
        '<div class="end-ach-list">' + newAch.map(function (a, k) {
          return '<span class="end-ach-item" style="--i:' + k + '"><span class="end-ach-ico" aria-hidden="true">' + esc(a.emoji) + '</span>' +
            '<span class="end-ach-name">' + esc(a.title) + '</span></span>';
        }).join('') + '</div></div>';
    }
    var buttons = pvp
      ? [
        { label: '🔁 Новая партия', kind: 'primary', onClick: function () { startGame({ mode: 'pvp' }); } },
        { label: '🏠 В меню', kind: 'ghost', onClick: function () { showScreen('home'); } },
        { label: '👀 Посмотреть доску', kind: 'ghost', onClick: lookAtBoard }
      ]
      : [
        { label: '🔁 Ещё раз', kind: 'primary', onClick: restartSame },
        { label: '🐾 Другой соперник', kind: 'secondary', onClick: function () { showScreen('opponents'); } },
        { label: '🏠 В меню', kind: 'ghost', onClick: function () { showScreen('home'); } },
        { label: '👀 Посмотреть доску', kind: 'ghost', onClick: lookAtBoard }
      ];
    var hnd = modal({
      emoji: emoji, title: title, className: 'modal-end',
      html: '<p>' + esc(text) + '</p>' + extra,
      buttons: buttons,
      onClose: lookAtBoard
    });
    G.endPending = false;   // later awards (e.g. «50 звёзд») wait in the queue until this modal is closed
    if (newAch.length) setTimeout(function () { snd('achievement'); }, stars > 0 ? 1500 : 700);
    speak(title + ' ' + text);
    if (G.pendingStars > 0) {
      var n = G.pendingStars;
      G.pendingStars = 0;
      setTimeout(function () { addStars(n, hnd.el.querySelector('#end-stars') || null); }, 750);
    }
  }
  function lookAtBoard() {
    if (!G.mascot) return;
    G.mascot.say('Посмотри на доску. Можно нажать «↩️ Ход назад» или «✨ Новая игра».', { mood: 'happy', speak: false });
  }

  // ------------------------------------------------------------------------ settings → game
  function gameSettingsChanged() {
    if (!G.chess || !G.view) return;
    updateDanger();
    if (!App.settings.safety && G.paused) safetyKeep();
    if (G.mode === 'pvp' && App.settings.flipPvp && !G.over) {
      var want = colorCh(G.chess.turn);
      if (G.view.orientation !== want) { vcall('setOrientation', want); renderStrips(); }
    }
    renderStrips();
  }

  // =================================================================================================
  // Awards screen
  // =================================================================================================
  function fmtDate(ts) {
    try {
      var d = new Date(ts);
      var o = { day: 'numeric', month: 'long' };
      if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
      return d.toLocaleDateString('ru-RU', o);
    } catch (e) { return ''; }
  }
  function renderAwards() {
    var p = App.profile, s = p.stats;
    var chip = $('#awards-stars');
    if (chip) chip.textContent = '⭐ ' + p.stars;
    var stats = $('#awards-stats');
    if (stats) {
      var wins = s.wins || {};
      var winsHtml = OPPONENTS.map(function (o) {
        var w = nonNeg(wins[o.level], 0);
        return '<div class="win-item" title="' + esc(o.name) + '"><span class="mini-av" style="background:' + o.bg + '">' + o.emoji + '</span>' +
          '<span><span class="win-n">' + w + '</span> <span class="stat-sub">' + plural(w, 'победа', 'победы', 'побед') + '</span></span></div>';
      }).join('');
      var lp = lessonProgress(), pp = puzzleProgress();
      var lpPct = lp.total ? Math.round(lp.done / lp.total * 100) : 0;
      var ppPct = pp.total ? Math.round(pp.done / pp.total * 100) : 0;
      // big number = whole lessons passed (the map shows lessons); the finer level count goes below
      var byGroups = lp.groupsTotal > 0;
      var lBig = byGroups ? lp.groupsDone : lp.done, lTotal = byGroups ? lp.groupsTotal : lp.total;
      stats.innerHTML =
        '<div class="card stat-card"><h3>🏆 Победы</h3><div class="wins-list">' + winsHtml + '</div></div>' +
        '<div class="card stat-card"><h3>🎓 Уроки</h3>' +
        (lp.total
          ? '<div class="stat-big">' + lBig + ' <span class="stat-sub">из ' + lTotal + '</span></div>' +
            '<div class="progress"><span style="--p:' + lpPct + '%"></span></div>' +
            (byGroups ? '<div class="stat-sub">Уровней: ' + lp.done + ' из ' + lp.total + '</div>' : '') +
            '<div class="stat-sub">Звёздочек за уроки: ' + lp.stars + '</div>'
          : '<div class="stat-sub">Уроки скоро появятся!</div>') +
        '</div>' +
        '<div class="card stat-card"><h3>🧩 Задачки</h3>' +
        (pp.total
          ? '<div class="stat-big">' + pp.done + ' <span class="stat-sub">из ' + pp.total + '</span></div>' +
            '<div class="progress"><span style="--p:' + ppPct + '%"></span></div>' +
            '<div class="stat-sub">' + (pp.done
              ? plural(pp.done, 'Решена', 'Решено', 'Решено') + ' ' + pp.done + ' ' + plural(pp.done, 'задачка', 'задачки', 'задачек')
              : 'Реши первую задачку!') + '</div>' +
            (pp.sets.length > 1
              ? '<ul class="stat-sets">' + pp.sets.map(function (st) {
                  var full = st.done >= st.total;
                  return '<li class="stat-set' + (full ? ' is-done' : '') + '">' +
                    '<span class="stat-set-ico" aria-hidden="true">' + esc(st.emoji) + '</span>' +
                    '<span class="stat-set-name">' + esc(st.title) + '</span>' +
                    '<span class="stat-set-n">' + (full ? '✅ ' : '') + st.done + ' из ' + st.total + '</span></li>';
                }).join('') + '</ul>'
              : '')
          : '<div class="stat-sub">Задачки скоро появятся!</div>') +
        '</div>' +
        '<div class="card stat-card"><h3>♟️ Партии</h3>' +
        '<div class="stat-big">' + (s.games + s.pvpGames) + ' <span class="stat-sub">' + plural(s.games + s.pvpGames, 'партия', 'партии', 'партий') + '</span></div>' +
        '<div class="stat-sub">С компьютером: ' + s.games + ' · вдвоём: ' + s.pvpGames + '</div>' +
        '<div class="stat-sub">Ничьих: ' + s.draws + ' · подсказок: ' + s.hints + '</div>' +
        '</div>';
    }
    var grid = $('#awards-grid');
    if (grid) {
      grid.innerHTML = ACHIEVEMENTS.map(function (a, i) {
        var ts = p.achievements[a.id];
        if (ts) {
          return '<div class="badge unlocked" style="--i:' + i + '"><div class="badge-ico" aria-hidden="true">' + a.emoji + '</div>' +
            '<div class="badge-title">' + esc(a.title) + '</div><div class="badge-desc">' + esc(a.desc) + '</div>' +
            '<div class="badge-date">🗓️ ' + esc(fmtDate(ts)) + '</div></div>';
        }
        return '<div class="badge locked" style="--i:' + i + '"><div class="badge-ico" aria-hidden="true">?</div>' +
          '<div class="badge-title">' + esc(a.title) + '</div><div class="badge-desc">Как получить: ' + esc(a.desc.charAt(0).toLowerCase() + a.desc.slice(1)) + '</div></div>';
      }).join('');
    }
  }

  // =================================================================================================
  // Settings modal
  // =================================================================================================
  var SETTING_ROWS = [
    { key: 'sound', emoji: '🔊', label: 'Звук' },
    { key: 'voice', emoji: '🗣️', label: 'Голос', note: 'Огонёк читает подсказки вслух' },
    { key: 'faces', emoji: '😊', label: 'Весёлые фигуры', note: 'Фигурки с глазками' },
    { key: 'showLegal', emoji: '👣', label: 'Показывать ходы', note: 'Точки там, куда можно пойти' },
    { key: 'danger', emoji: '🚨', label: 'Подсвечивать опасность', note: 'Показывать фигуры, которые могут съесть' },
    { key: 'safety', emoji: '🛟', label: 'Страховка от ошибок', note: 'Предупреждать, если ход плохой' },
    { key: 'flipPvp', emoji: '🔄', label: 'Переворачивать доску в игре вдвоём', note: 'Каждый видит свои фигуры внизу' }
  ];
  var FALLBACK_THEMES = [
    { id: 'ocean', name: 'Океан', light: '#e3f4ff', dark: '#5aa9e6', frame: '#2f6fb0' }
  ];
  function openSettings() {
    var s = App.settings;
    var voiceOk = voiceAvailable();
    var rows = SETTING_ROWS.map(function (r) {
      var disabled = r.key === 'voice' && !voiceOk;
      var note = disabled ? 'На этом устройстве нет русского голоса' : (r.note || '');
      return '<button type="button" class="set-row" role="switch" data-key="' + r.key + '" aria-checked="' + (!!s[r.key] && !disabled) + '"' +
        (disabled ? ' aria-disabled="true"' : '') + '>' +
        '<span class="set-emoji" aria-hidden="true">' + r.emoji + '</span>' +
        '<span class="set-text"><span>' + esc(r.label) + '</span>' + (note ? '<span class="set-note">' + esc(note) + '</span>' : '') + '</span>' +
        '<span class="switch" aria-hidden="true"></span></button>';
    }).join('');
    var themes = (global.BoardView && Array.isArray(global.BoardView.THEMES) && global.BoardView.THEMES.length) ? global.BoardView.THEMES : FALLBACK_THEMES;
    var themesHtml = themes.map(function (t) {
      return '<button type="button" class="theme-sw" role="radio" data-theme="' + esc(t.id) + '" aria-checked="' + (t.id === s.theme) + '">' +
        '<span class="theme-mini" style="--li:' + esc(t.light || '#eee') + ';--dk:' + esc(t.dark || '#999') + ';--fr:' + esc(t.frame || '#666') + '">' +
        '<i></i><i></i><i></i><i></i></span><span>' + esc(t.name || t.id) + '</span></button>';
    }).join('');
    var html =
      '<div class="settings">' +
      '<label><span class="set-label-big">Как тебя зовут?</span>' +
      '<input class="text-input" id="set-name" type="text" maxlength="20" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Твоё имя" value="' + esc(App.profile.name || '') + '"></label>' +
      '<div class="set-group">' + rows + '</div>' +
      '<div><span class="set-label-big">🎨 Доска</span><div class="themes" role="radiogroup" aria-label="Цвет доски">' + themesHtml + '</div></div>' +
      transferSectionHtml() +
      '<div class="set-reset"><button type="button" class="btn btn-danger" id="set-reset">🗑️ Сбросить прогресс</button></div>' +
      '</div>';
    var m = modal({ emoji: '⚙️', title: 'Настройки', className: 'modal-settings', html: html, buttons: [{ label: 'Готово 👍', kind: 'primary' }] });
    var root = m.el;
    wireTransferSection(root, m);

    var nameInput = root.querySelector('#set-name');
    var nameTimer = 0;
    nameInput.addEventListener('input', function () {
      clearTimeout(nameTimer);
      nameTimer = setTimeout(function () {
        App.profile.name = nameInput.value.replace(/[<>]/g, '').trim().slice(0, 20);
        App.save();
        if (currentScreen === 'home') renderHome();
        renderStrips();
      }, 250);
    });
    nameInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') nameInput.blur(); });

    $$('.set-row', root).forEach(function (row) {
      row.addEventListener('click', function () {
        if (row.getAttribute('aria-disabled') === 'true') return;
        var key = row.getAttribute('data-key');
        s[key] = !s[key];
        row.setAttribute('aria-checked', String(!!s[key]));
        applySettings();
        snd('click');
        if (key === 'voice' && s.voice) speak('Привет! Теперь я буду говорить.');
      });
    });
    // voices may load asynchronously: enable the row as soon as a Russian voice appears
    if (!voiceOk && global.Voice && typeof global.Voice.ready === 'function') {
      try {
        global.Voice.ready(function (ok) {
          if (!ok || m.closed) return;
          var row = root.querySelector('.set-row[data-key="voice"]');
          if (!row) return;
          row.removeAttribute('aria-disabled');
          row.setAttribute('aria-checked', String(!!s.voice));
          var note = row.querySelector('.set-note');
          if (note) note.textContent = 'Огонёк читает подсказки вслух';
        });
      } catch (e) { /* ignore */ }
    }
    $$('.theme-sw', root).forEach(function (b) {
      b.addEventListener('click', function () {
        s.theme = b.getAttribute('data-theme');
        $$('.theme-sw', root).forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
        applySettings();
        snd('pop');
      });
    });
    root.querySelector('#set-reset').addEventListener('click', function () {
      snd('click');
      // parent gate: the destructive button is the plain one and needs an answer a young child can't guess
      var a = 11 + Math.floor(Math.random() * 9), b = 3 + Math.floor(Math.random() * 7);
      var answer = String(a * b);
      var hnd = modal({
        emoji: '🗑️', title: 'Точно сбросить?', className: 'modal-reset',
        html: '<p>Пропадут все звёзды, награды, уроки и задачки.</p><p>Имя и настройки останутся.</p>' +
          '<div class="reset-gate"><label for="reset-gate">Для взрослых: сколько будет ' + a + ' × ' + b + '?</label>' +
          '<input class="text-input" id="reset-gate" type="text" inputmode="numeric" autocomplete="off" maxlength="4" data-answer="' + answer + '">' +
          '<p class="reset-gate-hint" id="reset-gate-hint" hidden>Неверно. Попроси взрослого 🙂</p></div>',
        buttons: [
          { label: 'Нет, оставить', kind: 'primary' },
          {
            label: 'Да, сбросить', kind: 'danger', keepOpen: true, onClick: function (h2) {
              var input = h2.el.querySelector('#reset-gate');
              var val = input ? input.value.replace(/\s+/g, '') : '';
              if (val === answer) {
                h2.close();
                m.close();
                resetProgress();
                return;
              }
              var hint = h2.el.querySelector('#reset-gate-hint');
              if (hint) hint.hidden = false;
              if (input) {
                input.classList.remove('gate-shake');
                void input.offsetWidth;
                input.classList.add('gate-shake');
                try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
              }
              snd('wrong');
            }
          }
        ]
      });
      var gate = hnd.el.querySelector('#reset-gate');
      if (gate) {
        gate.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            var btn = hnd.el.querySelector('.btn-danger');
            if (btn) btn.click();
          }
        });
      }
    });
  }
  // =================================================================================================
  // «Перенести прогресс» (SPEC §10.2): a text code (js/transfer.js) carries the progress between the
  // local Mac version, the claude.ai artifact and the iPad home-screen app. Parent-facing texts.
  // =================================================================================================
  var TR_COPIED = '✅ Код скопирован. Открой игру там, куда переносишь, и нажми ⚙️ → «📥 Вставить код». ' +
    'На другое устройство отправь код себе: Заметки, Сообщения, AirDrop.';
  var TR_MANUAL = 'Скопируй код из поля выше (на iPad: нажми на код и подержи → «Выбрать все» → «Скопировать»; на Mac: ⌘A, ⌘C), ' +
    'а там, куда переносишь, открой ⚙️ → «📥 Вставить код».';
  var TR_MANUAL_SHARE = 'Нажми «📨 Отправить…» или скопируй код из поля выше (на iPad: нажми на код и подержи → «Выбрать все» → «Скопировать»), ' +
    'а там, куда переносишь, открой ⚙️ → «📥 Вставить код».';
  // iPadOS gives the Home Screen app its own storage (SPEC §10.4): progress made in Safari is not in the icon
  var TR_ICON_NOTE = 'Для взрослых: звёзды отсюда в иконку сами не перейдут. Сначала ⚙️ → «📤 Скопировать код прогресса», ' +
    'потом в иконке ⚙️ → «📥 Вставить код».';
  function transferApi() {
    var T = global.Transfer;
    return (T && typeof T.encode === 'function' && typeof T.decode === 'function' && typeof T.importInto === 'function') ? T : null;
  }
  function transferSectionHtml() {
    if (!transferApi()) return '';
    return '<div class="set-transfer">' +
      '<span class="set-label-big">📲 Перенести прогресс</span>' +
      '<p class="tr-note">Для взрослых: звёзды, награды, уроки и задачки можно перенести на другое устройство или из Safari ' +
      'в иконку на экране «Домой» — у них разная память. Прогресс объединится: награды сохранятся, у каждого урока ' +
      'и задачки останется лучший результат.</p>' +
      '<div class="tr-actions">' +
      '<button type="button" class="btn btn-secondary" id="tr-copy">📤 Скопировать код прогресса</button>' +
      '<button type="button" class="btn btn-ghost" id="tr-paste">📥 Вставить код</button>' +
      '</div>' +
      '<div class="tr-out" id="tr-out" hidden>' +
      '<textarea class="tr-code" id="tr-code" rows="3" readonly autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Код прогресса"></textarea>' +
      '<p class="tr-status" id="tr-status" role="status"></p>' +
      '<button type="button" class="btn btn-ghost tr-share" id="tr-share" hidden>📨 Отправить…</button>' +
      '</div>' +
      '</div>';
  }
  function selectCode(ta) {
    try { ta.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    try { ta.select(); ta.setSelectionRange(0, ta.value.length); } catch (e) { /* ignore */ }
  }
  function legacyCopy(ta) {
    selectCode(ta);
    // iOS may ignore the selection; then execCommand can still say «copied» with nothing copied — show the manual way
    var whole = false;
    try { whole = ta.selectionStart === 0 && ta.selectionEnd === ta.value.length && ta.value.length > 0; } catch (e) { whole = false; }
    if (!whole) return false;
    try { return !!(doc.execCommand && doc.execCommand('copy')); } catch (e) { return false; }
  }
  function wireTransferSection(root, settingsModal) {
    var T = transferApi();
    var copyBtn = root.querySelector('#tr-copy'), pasteBtn = root.querySelector('#tr-paste');
    if (!T || !copyBtn || !pasteBtn) return;
    var out = root.querySelector('#tr-out'), ta = root.querySelector('#tr-code');
    var st = root.querySelector('#tr-status'), shareBtn = root.querySelector('#tr-share');
    var reveal = function () {
      try { out.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
    };
    var report = function (copied) {
      st.textContent = copied ? TR_COPIED : (shareBtn.hidden ? TR_MANUAL : TR_MANUAL_SHARE);
      st.classList.toggle('is-ok', !!copied);
      if (copied) snd('pop'); else selectCode(ta);
      reveal();
    };
    copyBtn.addEventListener('click', function () {
      snd('click');
      var code;
      try { code = T.encode(App.profile); } catch (e) {
        logErr('Transfer.encode', e);
        toast('Не получилось сделать код. Попробуй ещё раз.', { emoji: '🙈' });
        return;
      }
      ta.value = code;
      out.hidden = false;
      st.textContent = '';
      st.classList.remove('is-ok');
      var canShare = false;
      try { canShare = !!(global.navigator && typeof global.navigator.share === 'function'); } catch (e) { canShare = false; }
      shareBtn.hidden = !canShare;
      // the clipboard call must happen right inside the click (iOS Safari user-gesture rule)
      var clip = null, pr = null;
      try { clip = global.navigator && global.navigator.clipboard; } catch (e) { clip = null; }
      if (clip && typeof clip.writeText === 'function') {
        try { pr = clip.writeText(code); } catch (e) { pr = null; }
      }
      if (pr && typeof pr.then === 'function') {
        pr.then(function () { report(true); }, function () { report(legacyCopy(ta)); });
      } else {
        report(legacyCopy(ta));
      }
      reveal();
    });
    ta.addEventListener('click', function () { selectCode(ta); });
    shareBtn.addEventListener('click', function () {
      snd('click');
      var p = null;
      try { p = global.navigator.share({ title: 'Шахматное Королевство — код прогресса', text: ta.value }); } catch (e) { p = null; shareBtn.hidden = true; report(false); }
      if (p && typeof p.then === 'function') {
        p.then(null, function (e) {
          if (e && e.name === 'AbortError') return;          // the parent closed the share sheet
          shareBtn.hidden = true;                              // sharing is blocked here (e.g. inside an iframe)
          report(false);
        });
      }
    });
    pasteBtn.addEventListener('click', function () {
      snd('click');
      openImportCode(settingsModal);
    });
  }

  // counts shown in the import preview (awards: only the ones this version knows, like the home screen)
  function profileCounts(p) {
    var c = { stars: 0, ach: 0, lessons: 0, puzzles: 0, name: '' };
    if (!isObj(p)) return c;
    c.stars = Math.floor(nonNeg(p.stars, 0));
    var a = isObj(p.achievements) ? p.achievements : {};
    ACHIEVEMENTS.forEach(function (x) { if (nonNeg(a[x.id], 0) > 0) c.ach++; });
    if (isObj(p.lessons)) Object.keys(p.lessons).forEach(function (k) { if (nonNeg(p.lessons[k], 0) > 0) c.lessons++; });
    if (isObj(p.puzzles)) Object.keys(p.puzzles).forEach(function (k) { if (nonNeg(p.puzzles[k], 0) > 0) c.puzzles++; });
    c.name = typeof p.name === 'string' ? p.name.trim() : '';
    return c;
  }

  // parentModal (settings or the welcome) closes after a successful import; onImported() runs after it.
  function openImportCode(parentModal, onImported) {
    var T = transferApi();
    if (!T) return;
    var canRead = false;
    try { canRead = !!(global.navigator && global.navigator.clipboard && typeof global.navigator.clipboard.readText === 'function'); } catch (e) { canRead = false; }
    var decoded = null, decodedFor = null, nothingNew = false;
    var hnd = modal({
      emoji: '📥', title: 'Вставить код', className: 'modal-transfer',
      html: '<p class="tr-lead">Вставь сюда код прогресса с другого устройства.</p>' +
        '<textarea class="text-input tr-input" id="tr-in" rows="4" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" ' +
        'placeholder="ШК1-…" aria-label="Код прогресса"></textarea>' +
        (canRead ? '<button type="button" class="btn btn-ghost tr-read" id="tr-read">📋 Вставить из буфера</button>' : '') +
        '<p class="tr-error" id="tr-err" role="alert" hidden></p>' +
        '<div class="tr-preview" id="tr-prev" aria-live="polite" hidden></div>',
      buttons: [
        { label: 'Отмена', kind: 'ghost' },
        { label: 'Загрузить', kind: 'primary', keepOpen: true, onClick: function () { onPrimary(); } }
      ]
    });
    var box = hnd.el;
    var ta = box.querySelector('#tr-in'), err = box.querySelector('#tr-err'), prev = box.querySelector('#tr-prev');
    var primary = box.querySelector('.modal-buttons .btn-primary');
    if (!ta || !primary) return;

    function setPrimary(state) {        // 'load' | 'ready' | 'done' (the code adds nothing: just close)
      primary.textContent = state === 'ready' ? '✅ Перенести' : (state === 'done' ? 'Понятно 👍' : 'Загрузить');
      primary.classList.toggle('btn-green', state === 'ready');
      primary.classList.toggle('btn-primary', state !== 'ready');
    }
    function showNote(text) {
      err.textContent = text;
      err.hidden = false;
    }
    function showError(text) {
      showNote(text);
      ta.classList.remove('gate-shake');
      void ta.offsetWidth;
      ta.classList.add('gate-shake');
      snd('wrong');
    }
    function reset() {
      decoded = null; decodedFor = null; nothingNew = false;
      ta.classList.remove('gate-shake');
      prev.hidden = true; prev.innerHTML = '';
      err.hidden = true;
      setPrimary('load');
    }
    function revealPreview() {
      try { prev.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
    }
    // pasted = the code arrived by paste / «Вставить из буфера»: close the iPad keyboard so the preview and the
    // «✅ Перенести» button are not hidden under it
    function check(pasted) {
      var r = T.decode(ta.value);
      if (!r.ok) { reset(); showError(r.error); return; }
      decoded = r.profile; decodedFor = ta.value;
      err.hidden = true;
      ta.classList.remove('gate-shake');
      var c = profileCounts(decoded), after = null;
      try { after = T.importInto(App.profile, decoded); } catch (e) { logErr('Transfer.importInto', e); }
      var any = c.stars || c.ach || c.lessons || c.puzzles;
      nothingNew = !!(after && typeof T.sameProgress === 'function' && T.sameProgress(App.profile, after));
      var here = (App.profile.name || '').trim();
      var otherName = !nothingNew && here && c.name && here.toLowerCase() !== c.name.toLowerCase();
      var note = nothingNew
        ? (any ? 'Всё из этого кода уже есть на этом устройстве 👍' : 'В этом коде пока нет прогресса.')
        : (any ? 'Всё, что уже есть на этом устройстве, останется.' + (after ? ' После переноса здесь будет ⭐ ' + Math.floor(nonNeg(after.stars, 0)) + '.' : '')
          : 'В этом коде пока нет прогресса.');
      prev.innerHTML = '<div class="tr-prev-title">В коде' + (c.name ? ' — ' + esc(c.name) : '') + ':</div>' +
        '<div class="tr-chips"><span class="chip">⭐ ' + c.stars + '</span><span class="chip">🏆 наград: ' + c.ach + '</span>' +
        '<span class="chip">🎓 уровней: ' + c.lessons + '</span><span class="chip">🧩 задачек: ' + c.puzzles + '</span></div>' +
        '<p class="tr-prev-note' + (nothingNew ? ' is-same' : '') + '">' + note + '</p>' +
        (otherName ? '<p class="tr-warn">Осторожно: в коде другое имя — «' + esc(c.name) + '», а здесь — «' + esc(here) + '». ' +
          'Прогресс объединится.</p>' : '');
      prev.hidden = false;
      setPrimary(nothingNew ? 'done' : 'ready');
      snd('pop');
      if (pasted) { try { ta.blur(); } catch (e) { /* ignore */ } }
      revealPreview();
      if (pasted) setTimeout(function () { if (!hnd.closed) revealPreview(); }, 450);   // after the keyboard has gone
    }
    function onPrimary() {
      if (decoded && ta.value === decodedFor) {
        if (nothingNew) hnd.close();
        else doImport();
      } else check(false);
    }
    function doImport() {
      var incoming = decoded, merged;
      try { merged = T.importInto(App.profile, incoming); } catch (e) {
        logErr('Transfer.importInto', e);
        showError('Не получилось перенести. Попробуй ещё раз.');
        return;
      }
      // one-level copy of the progress before the import (a parent can restore it by hand), like «Сбросить прогресс»
      try { if (global.localStorage) global.localStorage.setItem(STORE_KEY + '.backup-import', JSON.stringify(App.profile)); } catch (e) { /* ignore */ }
      applyImportedProfile(merged);
      keepImportAfterCloud(T, incoming);
      hnd.close();
      if (parentModal && !parentModal.closed) parentModal.close();
      toast('Прогресс перенесён! ⭐ ' + App.profile.stars, { emoji: '🎉', duration: 4200 });
      snd('levelComplete');
      fx.confetti({ count: 110 });
      setTimeout(checkStarAchievements, 900);
      if (typeof onImported === 'function') {
        try { onImported(); } catch (e) { logErr('onImported', e); }
      }
    }

    ta.addEventListener('input', function () {
      if (decoded && ta.value !== decodedFor) reset();
      else err.hidden = true;
    });
    ta.addEventListener('paste', function () {
      setTimeout(function () { if (!hnd.closed && ta.value.trim()) check(true); }, 0);
    });
    var readBtn = box.querySelector('#tr-read');
    if (readBtn) {
      readBtn.addEventListener('click', function () {
        snd('click');
        var p = null;
        try { p = global.navigator.clipboard.readText(); } catch (e) { p = null; }
        var manual = function () { readBtn.hidden = true; showNote('Нажми на поле и выбери «Вставить».'); try { ta.focus(); } catch (e) { /* ignore */ } };
        if (!p || typeof p.then !== 'function') { manual(); return; }
        p.then(function (text) {
          if (hnd.closed) return;
          if (!text || !String(text).trim()) { showNote('В буфере пусто. Сначала скопируй код на другом устройстве.'); return; }
          ta.value = String(text);
          check(true);
        }, manual);
      });
    }
    setTimeout(function () { if (!hnd.closed) { try { ta.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }, 120);
  }

  // claude.ai artifact: an import made while the first read of the cloud copy is still running must survive it.
  // When that copy wins (progress was reset on another device), the code is merged in again on top of it.
  function keepImportAfterCloud(T, incoming) {
    var CS = global.CloudSync;
    if (!CS || CS.settled !== false || typeof CS.whenSettled !== 'function') return;
    CS.whenSettled().then(function () {
      var again;
      try { again = T.importInto(App.profile, incoming); } catch (e) { logErr('Transfer.importInto', e); return; }
      if (typeof T.sameProgress === 'function' && T.sameProgress(App.profile, again)) return;
      applyImportedProfile(again);
    });
  }

  // Adopt a merged profile (import) and redraw everything that shows progress.
  function applyImportedProfile(merged) {
    App.profile = sanitizeProfile(merged);
    App.save();
    applySettings({ initial: true });
    try { gameSettingsChanged(); } catch (e) { logErr('gameSettingsChanged', e); }
    refreshProfileViews(true);
  }
  function refreshProfileViews(animateStars) {
    renderStarCount(!!animateStars);
    var L = global.Learn;
    try {
      if (currentScreen === 'home') renderHome();
      else if (currentScreen === 'awards') renderAwards();
      else if (currentScreen === 'opponents') renderOpponents();
      else if (currentScreen === 'lessons' && L && typeof L.openLessons === 'function') L.openLessons();
      else if (currentScreen === 'puzzles' && L && typeof L.openPuzzles === 'function') L.openPuzzles();
    } catch (e) { logErr('refreshProfileViews', e); }
  }

  // «Добавь игру на экран Домой» — iOS Safari on the published site only (PWA.canInstallHint), dismissable.
  var A2HS_KEY = STORE_KEY + '.a2hs';
  var a2hsHidden = false;
  function a2hsWanted() {
    if (a2hsHidden) return false;
    try { if (global.localStorage && global.localStorage.getItem(A2HS_KEY)) return false; } catch (e) { /* storage blocked */ }
    try { return !!(global.PWA && typeof global.PWA.canInstallHint === 'function' && global.PWA.canInstallHint()); } catch (e) { return false; }
  }
  function hasProgressHere() {
    var T = global.Transfer;
    try { if (T && typeof T.hasProgress === 'function') return !!T.hasProgress(App.profile); } catch (e) { /* ignore */ }
    return nonNeg(App.profile.stars, 0) > 0;
  }
  // grown-ups' line: the installed icon starts with its own (empty) storage — say how to bring the stars along
  function a2hsNote(el) {
    var want = transferApi() && hasProgressHere();
    var note = el.querySelector('.a2hs-note');
    if (want && !note) {
      note = h('span', 'a2hs-note');
      note.textContent = TR_ICON_NOTE;
      var text = el.querySelector('.a2hs-text');
      if (text) text.appendChild(note);
    } else if (!want && note && note.parentNode) note.parentNode.removeChild(note);
  }
  function renderA2hsHint() {
    var el = $('#a2hs-hint');
    if (!a2hsWanted()) { if (el && el.parentNode) el.parentNode.removeChild(el); return; }
    if (el) { a2hsNote(el); return; }
    var home = $('#screen-home');
    if (!home) return;
    el = h('div', 'a2hs-hint');
    el.id = 'a2hs-hint';
    el.setAttribute('role', 'note');
    el.innerHTML = '<span class="a2hs-ico" aria-hidden="true">📲</span>' +
      '<span class="a2hs-text"><b>Добавь игру на экран «Домой»</b>' +
      '<span>Нажми «Поделиться» <span class="a2hs-share" aria-hidden="true">⬆️</span> → «На экран „Домой“». Игра будет открываться как настоящее приложение!</span></span>' +
      '<button type="button" class="a2hs-close" aria-label="Скрыть подсказку" title="Скрыть">✕</button>';
    a2hsNote(el);
    var anchor = $('.home-hero', home);
    if (anchor) home.insertBefore(el, anchor); else home.appendChild(el);
    el.querySelector('.a2hs-close').addEventListener('click', function () {
      snd('click');
      a2hsHidden = true;
      try { if (global.localStorage) global.localStorage.setItem(A2HS_KEY, String(Date.now())); } catch (e) { /* ignore */ }
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    });
  }

  var KEEP_ON_RESET = ['v', 'name', 'settings', 'welcomed', 'lastColor'];
  var DEFAULT_CHILD_NAME = '';
  function resetProgress() {
    var p = App.profile;
    // one-level backup for manual recovery by a parent (localStorage 'chessKingdom.v1.backup')
    try { if (global.localStorage) global.localStorage.setItem(STORE_KEY + '.backup', JSON.stringify(p)); } catch (e) { /* ignore */ }
    Object.keys(p).forEach(function (k) { if (KEEP_ON_RESET.indexOf(k) < 0) delete p[k]; });
    p.stars = 0;
    p.achievements = {};
    p.lessons = {};
    p.puzzles = {};
    p.stats = defaultStats();
    p.resetAt = Date.now();
    App.save();
    renderStarCount(false);
    var L = global.Learn;
    if (currentScreen === 'home') renderHome();
    else if (currentScreen === 'awards') renderAwards();
    else if (currentScreen === 'opponents') renderOpponents();
    else if (currentScreen === 'lessons' && L && typeof L.openLessons === 'function') {
      try { L.openLessons(); } catch (e) { logErr('Learn.openLessons', e); }   // re-renders the map in place
    } else if (currentScreen === 'puzzles' && L && typeof L.openPuzzles === 'function') {
      try { L.openPuzzles(); } catch (e) { logErr('Learn.openPuzzles', e); }
    }
    // inside a lesson/puzzle the level is not interrupted; the map/grid is fresh when the child goes back
    toast('Прогресс сброшен. Начинаем сначала!', { emoji: '🌱' });
  }

  // =================================================================================================
  // First launch
  // =================================================================================================
  function showWelcome() {
    var go = function (hnd) {
      var input = hnd.el.querySelector('#welcome-name');
      var name = input ? input.value.replace(/[<>]/g, '').trim().slice(0, 20) : '';
      App.profile.name = name;
      App.profile.welcomed = true;
      App.save();
      hnd.close();
      renderHome();
      lastGreetAt = Date.now();
      if (homeMascot) {
        homeMascot.say(name ? 'Привет, ' + name + '! Я Огонёк. Давай играть в шахматы!' : 'Привет! Я Огонёк. Давай играть в шахматы!',
          { mood: 'wow', speak: true });
      }
      fx.confetti({ count: 120 });
      snd('levelComplete');
    };
    // the Home Screen app (and the published site in iPad Safari) starts with empty storage: offer the transfer code
    var offerCode = false;
    try {
      offerCode = !!(transferApi() && !hasProgressHere() && global.PWA &&
        ((typeof global.PWA.isStandalone === 'function' && global.PWA.isStandalone()) ||
         (typeof global.PWA.canInstallHint === 'function' && global.PWA.canInstallHint())));
    } catch (e) { offerCode = false; }
    var hnd = modal({
      className: 'modal-welcome',
      dismissable: false,
      html: '<div class="welcome-mascot">' + art.mascot() + '</div>' +
        '<p class="welcome-say">Привет! Я конь Огонёк. Как тебя зовут?</p>' +
        '<input class="text-input welcome-input" id="welcome-name" type="text" maxlength="20" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Напиши своё имя" aria-label="Твоё имя">' +
        (offerCode ? '<div class="welcome-code"><p>Уже играл в Safari или на другом устройстве? Взрослый перенесёт твои звёзды:</p>' +
          '<button type="button" class="btn btn-ghost" id="welcome-code">📥 У меня есть код прогресса</button></div>' : ''),
      buttons: [
        { label: 'Поехали! 🚀', kind: 'primary', big: true, keepOpen: true, onClick: function (hd) { go(hd); } },
        { label: 'Пропустить', kind: 'ghost', onClick: function () { App.profile.welcomed = true; App.save(); } }
      ]
    });
    var codeBtn = hnd.el.querySelector('#welcome-code');
    if (codeBtn) {
      codeBtn.addEventListener('click', function () {
        snd('click');
        openImportCode(hnd, function () {
          App.profile.welcomed = true;
          App.save();
          renderHome();
          lastGreetAt = Date.now();
          var n = (App.profile.name || '').trim();
          if (homeMascot) homeMascot.say(n ? 'Привет, ' + n + '! Твои звёзды уже здесь. Играем?' : 'Твои звёзды уже здесь. Играем?', { mood: 'wow', speak: true });
        });
      });
    }
    var input = hnd.el.querySelector('#welcome-name');
    if (input && !input.value) input.value = (App.profile.name || '').trim() || DEFAULT_CHILD_NAME;
    if (input) {
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); go(hnd); } });
      setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 120);
    }
  }

  // =================================================================================================
  // Wiring & boot
  // =================================================================================================
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function wire() {
    on($('#btn-home'), 'click', function () { snd('click'); showScreen('home'); });
    on($('#tb-logo'), 'click', function () { snd('click'); showScreen('home'); });
    on($('#btn-stars'), 'click', function () { snd('click'); showScreen('awards'); });
    on($('#btn-settings'), 'click', function () { snd('click'); openSettings(); });
    on($('#btn-sound'), 'click', function () {
      var s = App.settings;
      var turnOn = !(s.sound || s.voice);
      s.sound = turnOn;
      s.voice = turnOn;
      applySettings();
      if (turnOn) snd('pop'); else stopVoice();
      toast(turnOn ? 'Звук включён' : 'Звук выключен', { emoji: turnOn ? '🔊' : '🔇', duration: 1800 });
    });

    $$('#home-tiles .tile').forEach(function (tile) {
      tile.addEventListener('click', function () {
        snd('click');
        var a = tile.getAttribute('data-action');
        if (a === 'ai') showScreen('opponents');
        else if (a === 'pvp') startGame({ mode: 'pvp' });
        else if (a === 'lessons') openLearn('lessons');
        else if (a === 'puzzles') openLearn('puzzles');
        else if (a === 'awards') showScreen('awards');
      });
    });
    on($('#btn-continue'), 'click', function () { snd('click'); showScreen('game'); });
    $$('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () { snd('click'); showScreen(b.getAttribute('data-go')); });
    });

    $$('#color-choice .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        App.profile.lastColor = b.getAttribute('data-color');
        App.save();
        snd('pop');
        renderOpponents();
      });
    });
    on($('#opp-grid'), 'click', function (ev) {
      var card = ev.target && ev.target.closest ? ev.target.closest('.opp-card') : null;
      if (!card) return;
      snd('click');
      startGame({ mode: 'ai', level: Number(card.getAttribute('data-level')) || 1, color: colorPref() });
    });

    on($('#btn-hint'), 'click', function () { onHint(); });
    on($('#btn-undo'), 'click', function () { snd('click'); onUndo(); });
    on($('#btn-flip'), 'click', function () { onFlip(); });
    on($('#btn-new'), 'click', function () { snd('click'); onNewGame(); });
    on($('#safety-undo'), 'click', function () { snd('click'); safetyUndo(); });
    on($('#safety-keep'), 'click', function () { safetyKeep(); });

    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && modalStack.length) {
        var top = modalStack[modalStack.length - 1];
        if (top.dismissable) { ev.preventDefault(); top.close('dismiss'); }
      }
    });

    // audio unlock on the first user gestures (autoplay policy)
    var gestures = 0;
    var unlockAudio = function () {
      gestureSeen = true;
      try { if (global.Sound && global.Sound.unlock) global.Sound.unlock(); } catch (e) { logErr('Sound.unlock', e); }
      if (++gestures >= 4) {
        ['pointerdown', 'keydown', 'touchend'].forEach(function (t) { doc.removeEventListener(t, unlockAudio, true); });
      }
    };
    ['pointerdown', 'keydown', 'touchend'].forEach(function (t) { doc.addEventListener(t, unlockAudio, true); });
  }

  function boot() {
    try { if (global.PieceArt && global.PieceArt.install) global.PieceArt.install(); } catch (e) { logErr('PieceArt.install', e); }
    applySettings({ initial: true });
    var steps = [
      buildBackground, buildTitle, buildTileDecos,
      function () { homeMascot = createMascot($('#home-mascot'), { row: true, onClick: nextFact }); },
      function () { G.mascot = createMascot($('#game-mascot')); },
      wire
    ];
    steps.forEach(function (fn) { try { fn(); } catch (e) { logErr('boot', e); } });
    if (!G.mascot) G.mascot = { say: function () { }, setMood: function () { }, clear: function () { }, el: null, text: '' };
    renderStarCount(false);
    try { restoreSavedGame(); } catch (e) { logErr('restoreSavedGame', e); G.chess = null; G.restored = null; G.needsResume = false; }
    showScreen('home');
    if (!engineReady()) logErr('boot', new Error('engine.js (Chess) is missing'));
    var needsWelcome = function () { return !(App.profile.name || '').trim() && !App.profile.welcomed; };
    if (global.CloudSync && typeof global.CloudSync.init === 'function') {
      try { global.CloudSync.init({ getProfile: function () { return App.profile; }, apply: applyCloudProfile }); }
      catch (e) { logErr('CloudSync.init', e); }
      global.CloudSync.whenSettled(3000).then(function () { if (needsWelcome()) setTimeout(showWelcome, 250); });
    } else if (needsWelcome()) setTimeout(showWelcome, 650);
  }

  // js/pwa.js applies a downloaded update (one reload) only at such a moment: a menu screen, no dialog, no toast or
  // award waiting to be shown — nothing in progress can be lost (a started game is saved anyway).
  function safeToReload() {
    if (currentScreen !== 'home' && currentScreen !== 'awards' && currentScreen !== 'opponents') return false;
    if (modalStack.length || achQueue.length || achBusy) return false;
    var tr = $('#toast-root');
    return !(tr && tr.children.length);
  }

  // Progress merged from the claude.ai database (published page only): adopt it and redraw what shows it.
  function applyCloudProfile(merged) {
    App.profile = sanitizeProfile(merged);
    try { if (global.localStorage) global.localStorage.setItem(STORE_KEY, JSON.stringify(App.profile)); } catch (e) { /* ignore */ }
    applySettings({ initial: true });
    refreshProfileViews(false);
  }

  // =================================================================================================
  // Public API
  // =================================================================================================
  App.showScreen = showScreen;
  App.addStars = addStars;
  App.unlock = unlock;
  App.createMascot = createMascot;
  App.createBoard = createBoard;
  App.modal = modal;
  App.toast = toast;
  App.startGame = startGame;
  App.openSettings = openSettings;
  App.safeToReload = safeToReload;
  Object.defineProperty(App, 'screen', { enumerable: true, get: function () { return currentScreen; } });

  global.App = App;

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
