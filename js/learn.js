/*
 * «Шахматное Королевство» — learn.js
 * The learning part: lessons map, lesson play (stars / task / info levels), puzzles grid and puzzle play.
 *
 * Global: Learn
 *   Learn.openLessons()              — lessons map (#screen-lessons): the road through the chapters of the kingdom
 *   Learn.openPuzzles(setId?)        — puzzles screen (#screen-puzzles): the set picker (big cards), or the grid of
 *                                      one set when setId is given
 *   Learn.openLesson(group, level?)  — a lesson level (#screen-lesson); group = id or index
 *   Learn.openPuzzle(index, setId?)  — a puzzle (#screen-puzzle); 0-based index inside the set (default: the
 *                                      «Мат в 1 ход» set = Lessons.PUZZLES); index may also be a puzzle id ('m2-3');
 *                                      setId 'trainer' (an endless set) opens the trainer
 *   Learn.leave()                    — stop timers / voice / boards (called by App before leaving a learn screen)
 *
 * Uses (SPEC): Chess, ChessAI, Lessons, PieceArt, Sound, Voice, FX, BoardView (via App.createBoard), App.
 * Every call into another module is feature-checked so a missing piece degrades gracefully
 * (content v2 — puzzle sets, mate in 2, «win a piece», 'safe' / 'fork' tasks — works with the v1 data too;
 * content v3 — mate in N, «Спасайся!», endgames, the endless trainer, 'solution' tasks — works without its files).
 * Progress keys never change: profile.lessons['<groupId>:<levelIndex>'], profile.puzzles[String(puzzleId)].
 * Per-device conveniences (localStorage): the last opened puzzle set 'chessKingdom.v1.puzzleSet', the trainer
 * streak {streak, best} 'chessKingdom.v1.trainer'; read only: 'chessKingdom.v1.freshContent' (written by app.js).
 */
(function (global) {
  'use strict';

  const doc = global.document || null;

  /* ============================================================================================ constants */

  const WHITE = 8, BLACK = 16;
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const FLAG_DEFAULT = { CAPTURE: 1, EP: 2, CASTLE: 4, DOUBLE: 8, PROMO: 16 };
  const TYPE_CHARS = 'pnbrqk';
  const SCREENS = ['lessons', 'lesson', 'puzzles', 'puzzle'];
  const SOLVE_LIMIT = 150000;
  const TAP_GUARD_MS = 400;   // buttons of a freshly opened lesson / puzzle ignore taps this soon (double tap)

  // fallback icons (a group's own `emoji` from lessons.js wins)
  const GROUP_EMOJI = {
    values: '💰', check: '⚡', escape: '🛡️', mate: '🏁', castle: '🏰', special: '✨',
    defend: '☂️', fork: '🔱', maze: '🌀'
  };
  const PIECE_GROUPS = ['rook', 'bishop', 'queen', 'king', 'knight', 'pawn'];
  // the groups of content v1: for a child who played v1, any other group is shown as «Новое!» until its first star
  const V1_GROUPS = ['rook', 'bishop', 'queen', 'king', 'knight', 'pawn', 'values', 'check', 'escape', 'mate', 'castle', 'special'];
  const V1_PUZZLES = 18;   // «Мат в 1 ход» ids 1..18 are content v1, ids 19+ were added in v2
  // content v2 went live on 2026-09-28 after 20:20 MSK: an award unlocked before that proves the child played v1
  const V2_SINCE = Date.UTC(2026, 8, 28, 17, 20);
  const VAL = [0, 100, 320, 330, 500, 900, 0];

  const SET_KEY = 'chessKingdom.v1.puzzleSet';
  const TRAINER_KEY = 'chessKingdom.v1.trainer';
  // written by app.js: the content version this device's profile started from scratch with (see veteran3)
  const FRESH_KEY = 'chessKingdom.v1.freshContent';
  const KINDS = ['mate1', 'mate2', 'mate3', 'win', 'save', 'endgame'];
  const MATE_N = { mate1: 1, mate2: 2, mate3: 3 };
  const SET_DEFAULTS = {
    mate1: { title: 'Мат в 1 ход', emoji: '🏁', color: '#2ecc71', text: 'Поставь мат за один ход!' },
    mate2: { title: 'Мат в 2 хода', emoji: '🎯', color: '#6c63ff', text: 'Сначала хитрый ход, потом — мат!' },
    win: { title: 'Выиграй фигуру', emoji: '⚔️', color: '#ff7a59', text: 'Найди ход, который выиграет фигуру соперника!' },
    mate3: { title: 'Мат в 3 хода', emoji: '🏆', color: '#ff6fae', text: 'Три хода — и король пойман!' },
    save: { title: 'Спасайся!', emoji: '🛡️', color: '#3fa9f5', text: 'Соперник что-то задумал. Найди спасительный ход!' },
    endgame: { title: 'Мат одинокому королю', emoji: '👑', color: '#ffb400', text: 'Играй до победы против одинокого короля!' },
    trainer: { title: 'Тренажёр', emoji: '🔥', color: '#ff7a59', text: 'Задачки без конца! Сколько решишь подряд?' }
  };
  const KIND_TASK = {
    mate1: 'Поставь мат в 1 ход!', mate2: 'Поставь мат в 2 хода!', mate3: 'Поставь мат в 3 хода!',
    win: 'Выиграй фигуру соперника!', save: 'Спасайся! Найди ход, который отобьёт угрозу.',
    endgame: 'Поставь мат одинокому королю!'
  };
  const KIND_INTRO = {
    mate1: 'В каждой задачке можно поставить мат за один ход.',
    mate2: 'Здесь мат ставится за два хода: сначала хитрый ход, соперник ответит — и мат!',
    mate3: 'Здесь мат ставится за три хода. Каждый твой ход должен загонять короля всё дальше!',
    win: 'Здесь нужно найти ход, после которого соперник потеряет фигуру!',
    save: 'Здесь соперник угрожает! Красная стрелка покажет, что он задумал. Найди ход, который спасёт твои фигуры.',
    endgame: 'Здесь ты играешь с соперником до самой победы: поставь мат одинокому королю или проведи пешку в ферзи!'
  };
  const KIND_MASTER = {
    mate1: 'Ты — настоящий мастер мата!', mate2: 'Ты — мастер двух ходов!', mate3: 'Ты — гроссмейстер мата!',
    win: 'Ты — юный тактик!', save: 'Ты — супер-защитник!', endgame: 'Ты — мастер эндшпиля!'
  };
  // lesson map chapters (group ids of content v1/v2); groups of content v3 and unknown ones go to the last chapter
  const CHAPTERS = [
    { title: 'Знакомство с фигурами', emoji: '♟️', ids: ['rook', 'bishop', 'queen', 'king', 'knight', 'pawn'] },
    { title: 'Правила игры', emoji: '📜', ids: ['values', 'check', 'escape', 'mate', 'castle', 'special'] },
    { title: 'Первые хитрости', emoji: '🔱', ids: ['defend', 'fork', 'maze'] },
    { title: 'Секреты чемпионов', emoji: '🏆', ids: [] }
  ];
  const TRAINER_WINDOW = 8;                  // a trainer puzzle is picked among the first unsolved ones (easy → hard)
  const STREAK_PARTY = [5, 10, 20];          // small celebrations (then every 10 more)
  const FALLBACK_COLORS = ['#ff7a59', '#6c63ff', '#ff6fae', '#ffb400', '#2ecc71', '#3fa9f5'];

  const FALLBACK_NAMES = {
    p: { nom: 'пешка', acc: 'пешку', gen: 'пешки', ins: 'пешкой', Nom: 'Пешка', g: 'f' },
    n: { nom: 'конь', acc: 'коня', gen: 'коня', ins: 'конём', Nom: 'Конь', g: 'm' },
    b: { nom: 'слон', acc: 'слона', gen: 'слона', ins: 'слоном', Nom: 'Слон', g: 'm' },
    r: { nom: 'ладья', acc: 'ладью', gen: 'ладьи', ins: 'ладьёй', Nom: 'Ладья', g: 'f' },
    q: { nom: 'ферзь', acc: 'ферзя', gen: 'ферзя', ins: 'ферзём', Nom: 'Ферзь', g: 'm' },
    k: { nom: 'король', acc: 'короля', gen: 'короля', ins: 'королём', Nom: 'Король', g: 'm' }
  };

  const FALLBACK_RULES = {
    r: 'Ладья так не ходит! Она ходит только по прямым линиям.',
    b: 'Слон так не ходит! Он ходит только наискосок.',
    q: 'Ферзь так не ходит! Он ходит по прямым линиям и наискосок.',
    k: 'Король так не ходит! Он шагает только на одну клетку.',
    n: 'Конь так не ходит! Он прыгает буквой «Г».',
    p: 'Пешка так не ходит! Она идёт только вперёд, а ест наискосок.'
  };

  const GOALS = {
    check: { emoji: '⚡', label: 'Поставь шах', fail: 'Это не шах. Нужно напасть на чёрного короля!', win: 'Шах! Король под ударом.' },
    mate: { emoji: '🏁', label: 'Поставь мат', fail: 'Это не мат. Попробуй ещё раз!', win: 'Мат! Королю некуда деться.' },
    escape: { emoji: '🛡️', label: 'Спаси короля', fail: 'Король всё ещё под шахом. Спаси его!', win: 'Король спасён!' },
    'escape-king': { emoji: '🏃', label: 'Уведи короля', fail: 'Сейчас нужно увести самого короля на безопасную клетку!', win: 'Король убежал от шаха!' },
    'escape-block': { emoji: '🧱', label: 'Закройся от шаха', fail: 'Поставь свою фигуру между королём и тем, кто нападает!', win: 'Ты закрыл короля от шаха!' },
    'escape-capture': { emoji: '🎯', label: 'Съешь нападающего', fail: 'Нужно съесть фигуру, которая объявила шах!', win: 'Ты съел фигуру, которая нападала на короля!' },
    castle: { emoji: '🏰', label: 'Сделай рокировку', fail: 'Нужна рокировка: нажми на короля и передвинь его на две клетки к ладье.', win: 'Рокировка! Король спрятался в домик.' },
    'castle-k': { emoji: '🏰', label: 'Короткая рокировка', fail: 'Нужна короткая рокировка: король идёт на две клетки к ближней ладье.', win: 'Короткая рокировка! Король в домике.' },
    'castle-q': { emoji: '🏰', label: 'Длинная рокировка', fail: 'Нужна длинная рокировка: король идёт на две клетки к дальней ладье.', win: 'Длинная рокировка! Король в домике.' },
    promote: { emoji: '👑', label: 'Преврати пешку', fail: 'Доведи пешку до самого края доски!', win: 'Пешка дошла до края и превратилась!' },
    'promote-q': { emoji: '👑', label: 'Сделай ферзя', fail: 'Доведи пешку до края доски и выбери ферзя!', win: 'Пешка стала ферзём!' },
    ep: { emoji: '🥷', label: 'Взятие на проходе', fail: 'Съешь пешку на проходе: сходи наискосок прямо за её спину!', win: 'Взятие на проходе! Хитрый приём.' },
    capture: { emoji: '🍽️', label: 'Съешь фигуру', fail: 'Нужно съесть фигуру соперника!', win: 'Ам! Вкусно!' },
    safe: {
      emoji: '☂️', label: 'Защити фигуру',
      fail: 'Ой, твою фигуру всё ещё могут съесть! Уведи её, защити или съешь того, кто нападает.',
      win: 'Молодец! Теперь твои фигуры в безопасности.'
    },
    fork: { emoji: '🔱', label: 'Сделай вилку', fail: 'Найди клетку, откуда фигура нападёт сразу на две!', win: 'Вилка! Твоя фигура напала сразу на две!' },
    solution: { emoji: '💡', label: 'Найди лучший ход', fail: 'Так можно, но есть ход получше. Подумай ещё!', win: 'Отличный ход!' }
  };

  const DIFF = {
    1: { cls: 'd1', label: 'Легко' },
    2: { cls: 'd2', label: 'Посложнее' },
    3: { cls: 'd3', label: 'Трудно' }
  };

  const HINT_TIP = 'Если трудно — нажми «💡 Подсказка»!';

  const CHEERS = ['Есть звёздочка!', 'Отлично!', 'Ещё одна!', 'Так держать!', 'Здорово!', 'Ура!'];
  const DECO = ['🌳', '🌷', '🍄', '🌼', '🌲', '🌸', '🌻', '🌿'];

  const GLYPHS = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
  };

  const EMPTY_STAR = '<svg class="lr-star-empty" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<path d="M50 9 L61.8 35.5 L90.5 38.3 L68.9 57.4 L75.2 85.7 L50 71 L24.8 85.7 L31.1 57.4 L9.5 38.3 L38.2 35.5 Z" ' +
    'fill="#ece9fb" stroke="#cfc8f1" stroke-width="6" stroke-linejoin="round"/></svg>';

  /* ============================================================================================ state */

  const S = {
    epoch: 0,            // bumps on every screen (re)render / leave → stale async callbacks bail out
    screen: null,        // learn screen currently rendered by us
    inShow: false,       // inside our own App.showScreen call
    view: null,          // current BoardView
    mascot: null,        // current mascot {say, setMood, el}
    modal: null,         // current modal handle
    timers: new Set(),
    disposers: [],
    lesson: null,        // lesson play context
    puzzle: null,        // puzzle play context
    lastLesson: null,
    lastPuzzle: null,    // { idx, set } of the last opened puzzle
    puzSet: null,        // id of the puzzle set shown on the puzzles screen (also kept in localStorage)
    greetedMap: false,
    greetedPuzzles: false,
    trainer: null,       // { streak, best } (localStorage) + { queue, last } for this session
    hintAI: null         // engine hints for endgames: { worker, seq, waiting }
  };
  const parCache = new Map();
  const lastTell = { text: '', t: 0 };
  let prevActive = new Set();
  let cheerIdx = 0;
  let fallbackProfile = null;

  /* ============================================================================================ utils */

  function warn(e) {
    try { if (global.console && typeof global.console.warn === 'function') global.console.warn('[Learn]', e); } catch (_) { /* ignore */ }
  }

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { warn(e); return fallback; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function num(v, d) { const n = Number(v); return isFinite(n) ? n : d; }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function movesWord(n) { return n + ' ' + plural(n, 'ход', 'хода', 'ходов'); }

  function starsVal(v, max) { return clamp(Math.floor(num(v, 0)), 0, max); }

  function now() { return Date.now(); }

  function later(fn, ms) {
    const ep = S.epoch;
    const id = setTimeout(function () {
      S.timers.delete(id);
      if (ep !== S.epoch) return;
      const r = safe(fn);
      if (r && typeof r.then === 'function') r.then(null, warn);
    }, ms);
    S.timers.add(id);
    return id;
  }

  function clearTimers() {
    S.timers.forEach(function (id) { clearTimeout(id); });
    S.timers.clear();
  }

  function raf(fn) {
    if (typeof global.requestAnimationFrame === 'function') return global.requestAnimationFrame(fn);
    return setTimeout(fn, 16);
  }

  /* resolves when p settles or after ms — never rejects, never hangs */
  function settle(p, ms) {
    return new Promise(function (resolve) {
      let done = false;
      const finish = function () { if (!done) { done = true; clearTimeout(t); resolve(); } };
      const t = setTimeout(finish, ms || 2600);
      if (p && typeof p.then === 'function') {
        p.then(finish, function (e) { warn(e); finish(); });
      } else {
        finish();
      }
    });
  }

  function hexToRgb(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mixRgb(a, b, t) {
    return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); });
  }

  function rgbStr(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  function colorVars(color, i) {
    const rgb = hexToRgb(color) || hexToRgb(FALLBACK_COLORS[Math.abs(i | 0) % FALLBACK_COLORS.length]);
    return '--g:' + rgbStr(rgb) +
      ';--g-dark:' + rgbStr(mixRgb(rgb, [40, 24, 70], 0.34)) +
      ';--g-light:' + rgbStr(mixRgb(rgb, [255, 255, 255], 0.5)) +
      ';--g-soft:' + rgbStr(mixRgb(rgb, [255, 255, 255], 0.86));
  }

  /* ============================================================================================ chess helpers */

  function CH() { return global.Chess || null; }

  function FLAG() { const C = CH(); return (C && C.FLAG) || FLAG_DEFAULT; }

  function onBoard(sq) { return typeof sq === 'number' && sq >= 0 && sq < 128 && !(sq & 0x88); }

  function sqName(sq) { return onBoard(sq) ? 'abcdefgh'.charAt(sq & 7) + (8 - (sq >> 4)) : ''; }

  /* 'e7e8q' → {from:'e7', to:'e8', promotion:'q'} (for normMove) | null */
  function uciToMove(s) {
    const t = String(s == null ? '' : s).trim().toLowerCase();
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t)) return null;
    return { from: t.slice(0, 2), to: t.slice(2, 4), promotion: t.charAt(4) || 0 };
  }

  /* a move given as UCI string or {from, to, promotion} → {from, to, promotion} with 0x88 squares | null */
  function anyMove(x) {
    if (!x) return null;
    return normMove(typeof x === 'string' ? uciToMove(x) : x);
  }

  function valueOf(p) { return VAL[p & 7] || 0; }

  /* for sorting: the king is worth the most */
  function rankOf(p) { return (p & 7) === KING ? 10000 : valueOf(p); }

  function sqRow(sq) { return sq >> 4; }

  function sqCol(sq) { return sq & 7; }

  function sqFromName(name) {
    const s = String(name || '').trim().toLowerCase();
    if (s.length !== 2) return -1;
    const f = s.charCodeAt(0) - 97, r = s.charCodeAt(1) - 49;
    if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
    return (7 - r) * 16 + f;
  }

  function toSq(x) {
    if (typeof x === 'number') return onBoard(x) ? x : -1;
    if (typeof x === 'string') return sqFromName(x);
    return -1;
  }

  function typeFromChar(c) {
    const i = TYPE_CHARS.indexOf(String(c || '').trim().toLowerCase());
    return i >= 0 ? i + 1 : 0;
  }

  function typeChar(t) { return TYPE_CHARS.charAt((t & 7) - 1) || 'p'; }

  function toType(x) {
    if (typeof x === 'number') return x & 7;
    if (typeof x === 'string') return typeFromChar(x);
    return 0;
  }

  function getP(chess, sq) {
    if (!chess || !onBoard(sq)) return 0;
    try {
      if (typeof chess.get === 'function') return chess.get(sq) | 0;
      return chess.board ? chess.board[sq] | 0 : 0;
    } catch (e) { return 0; }
  }

  function countColor(chess, color) {
    let n = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = getP(chess, sq);
      if (p && (p & 24) === color) n++;
    }
    return n;
  }

  function kingSq(chess, color) {
    const k = chess && chess.kings ? chess.kings[color] : undefined;
    if (onBoard(k) && getP(chess, k) === (color | KING)) return k;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      if (getP(chess, sq) === (color | KING)) return sq;
    }
    return -1;
  }

  function inCheck(chess) { return !!safe(function () { return chess.inCheck(); }, false); }

  function isMate(chess) {
    return !!safe(function () {
      if (typeof chess.status === 'function') {
        const st = chess.status();
        if (st && st.reason === 'checkmate') return true;
      }
      return typeof chess.isCheckmate === 'function' ? chess.isCheckmate() : false;
    }, false);
  }

  function legalMoves(chess, from) {
    return safe(function () { return chess.moves(from === undefined ? undefined : { from: from }) || []; }, []);
  }

  function pseudoMoves(chess, sq) {
    return safe(function () { return chess.pieceMoves(sq) || []; }, []);
  }

  function pathBlocked(chess, from, to) {
    const dr = Math.sign(sqRow(to) - sqRow(from)), dc = Math.sign(sqCol(to) - sqCol(from));
    let sq = from + dr * 16 + dc;
    let guard = 0;
    while (sq !== to && onBoard(sq) && guard++ < 8) {
      if (getP(chess, sq)) return true;
      sq += dr * 16 + dc;
    }
    return false;
  }

  /* lesson boards have no kings: after a White move force White to move again (engine API first) */
  function normalizeTurn(chess) {
    if (!chess) return;
    if (chess.turn === WHITE && chess.ep === -1) return;
    const ok = safe(function () {
      const f = String(chess.fen()).split(/\s+/);
      if (f.length < 4) return false;
      f[1] = 'w';
      f[3] = '-';
      return chess.load(f.join(' ')) !== false;
    }, false);
    if (!ok || chess.turn !== WHITE) {
      chess.turn = WHITE;
      chess.ep = -1;
    }
  }

  function moveSound(m) {
    const F = FLAG();
    const flags = m.flags | 0;
    if (flags & F.PROMO) snd('promote');
    else if (flags & F.CASTLE) snd('castle');
    else if (m.captured || (flags & F.EP)) snd('capture');
    else snd('move');
  }

  function normMove(h) {
    if (!h) return null;
    const from = toSq(h.from), to = toSq(h.to);
    if (!onBoard(from) || !onBoard(to)) return null;
    return { from: from, to: to, promotion: toType(h.promotion) || 0 };
  }

  /* ============================================================================================ module access */

  function app() { return global.App || null; }

  function lessonsLib() { return global.Lessons || null; }

  function groups() {
    const L = lessonsLib();
    return L && Array.isArray(L.GROUPS) ? L.GROUPS.filter(Boolean) : [];
  }

  function puzzlesList() {
    const L = lessonsLib();
    return L && Array.isArray(L.PUZZLES) ? L.PUZZLES.filter(function (p) { return p && p.fen; }) : [];
  }

  function levelsOf(g) { return g && Array.isArray(g.levels) ? g.levels.filter(Boolean) : []; }

  /*
   * Puzzle sets: Lessons.PUZZLE_SETS (content v2) or, with older data, one «Мат в 1 ход» set from Lessons.PUZZLES.
   * → [{ id, title, emoji, color, text, puzzles }]   (only sets with at least one valid puzzle)
   */
  function puzzleSets() {
    const L = lessonsLib();
    const out = [];
    const seen = {};
    if (L && Array.isArray(L.PUZZLE_SETS)) {
      L.PUZZLE_SETS.forEach(function (s, i) {
        if (!s || !Array.isArray(s.puzzles)) return;
        const list = s.puzzles.filter(function (p) { return p && p.fen; });
        const id = String(s.id != null ? s.id : 'set-' + i);
        if (!list.length || seen[id]) return;
        seen[id] = true;
        const d = SET_DEFAULTS[id] || {};
        out.push({
          id: id,
          title: String(s.title || d.title || 'Задачки'),
          emoji: String(s.emoji || d.emoji || '🧩'),
          color: s.color || d.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
          text: String(s.text || d.text || ''),
          puzzles: list,
          endless: !!s.endless,
          v: num(s.v, 0)
        });
      });
    }
    if (!out.length) {
      const list = puzzlesList();
      if (list.length) out.push(Object.assign({ id: 'mate1', puzzles: list }, SET_DEFAULTS.mate1));
    }
    return out;
  }

  function findSet(sets, id) {
    if (id == null) return null;
    return sets.find(function (s) { return s.id === String(id); }) || null;
  }

  /* the set Learn.openPuzzle(index) means without a set id: «Мат в 1 ход» (Lessons.PUZZLES) */
  function mainSet(sets) {
    const L = lessonsLib();
    return findSet(sets, 'mate1') ||
      sets.find(function (s) { return L && s.puzzles.length && L.PUZZLES && L.PUZZLES.indexOf(s.puzzles[0]) >= 0; }) ||
      sets[0] || null;
  }

  /* 'mate1' | 'mate2' | 'mate3' | 'win' | 'save' | 'endgame' */
  function puzzleKind(pz, set) {
    if (pz && KINDS.indexOf(pz.kind) >= 0) return pz.kind;
    const L = lessonsLib();
    if (L && typeof L.puzzleKind === 'function') {
      const k = safe(function () { return L.puzzleKind(pz); }, null);
      if (KINDS.indexOf(k) >= 0 && (k !== 'mate1' || !set || !(KINDS.indexOf(set.id) >= 0))) return k;
    }
    if (set && KINDS.indexOf(set.id) >= 0) return set.id;
    if (pz && Array.isArray(pz.solutions)) return pz.threat ? 'save' : 'win';
    return 'mate1';
  }

  /* content v3 marks its groups, puzzles and sets with v: 3 */
  function isV3(x) { return !!x && num(x.v, 0) >= 3; }

  /* the sets that are not endless (the trainer re-uses mate-in-1 / «win» kinds: it must not count for their awards) */
  function finiteSets() { return puzzleSets().filter(function (s) { return !s.endless; }); }

  function trainerSet(sets) {
    return (sets || puzzleSets()).find(function (s) { return s.endless; }) || null;
  }

  /* every puzzle of every set (for totals) */
  function allPuzzles() {
    const L = lessonsLib();
    if (L && typeof L.allPuzzles === 'function') {
      const r = safe(function () { return L.allPuzzles(); }, null);
      if (Array.isArray(r)) {
        const list = r.filter(function (p) { return p && p.fen; });
        if (list.length) return list;
      }
    }
    let list = [];
    puzzleSets().forEach(function (s) { list = list.concat(s.puzzles); });
    return list;
  }

  function loadSetId() {
    try {
      const v = global.localStorage ? global.localStorage.getItem(SET_KEY) : null;
      return v ? String(v) : null;
    } catch (e) { return null; }
  }

  function storeSetId(id) {
    S.puzSet = String(id);
    try { if (global.localStorage) global.localStorage.setItem(SET_KEY, String(id)); } catch (e) { /* storage may be blocked */ }
  }

  function nameOf(t) {
    const c = typeof t === 'number' ? typeChar(t) : (String(t || 'p').toLowerCase().charAt(0) || 'p');
    const L = lessonsLib();
    const fromLib = L && L.NAMES && L.NAMES[c];
    return Object.assign({}, FALLBACK_NAMES[c] || FALLBACK_NAMES.p, fromLib || {});
  }

  function ate(nm) { return nm.g === 'f' ? 'съела' : 'съел'; }

  function profile() {
    const A = app();
    let p = A && A.profile && typeof A.profile === 'object' ? A.profile : null;
    if (!p) {
      if (!fallbackProfile) fallbackProfile = { lessons: {}, puzzles: {}, stars: 0 };
      p = fallbackProfile;
    }
    if (!p.lessons || typeof p.lessons !== 'object') p.lessons = {};
    if (!p.puzzles || typeof p.puzzles !== 'object') p.puzzles = {};
    return p;
  }

  function save() {
    const A = app();
    if (A && typeof A.save === 'function') safe(function () { A.save(); });
  }

  function addStars(n, from) {
    if (!(n > 0)) return;
    const A = app();
    if (A && typeof A.addStars === 'function') {
      safe(function () { A.addStars(n, from); });
    } else {
      const p = profile();
      p.stars = num(p.stars, 0) + n;
      save();
    }
  }

  function unlock(id) {
    const A = app();
    if (A && typeof A.unlock === 'function') safe(function () { A.unlock(id); });
  }

  function toast(text, emoji) {
    const A = app();
    if (A && typeof A.toast === 'function') safe(function () { A.toast(text, emoji ? { emoji: emoji } : {}); });
  }

  function childName() {
    return safe(function () {
      const A = app();
      const n = A && typeof A.childName === 'function' ? A.childName() : '';
      return (n && String(n).trim()) || 'друг';
    }, 'друг');
  }

  function snd(name) {
    safe(function () { if (global.Sound && typeof global.Sound.play === 'function') global.Sound.play(name); });
  }

  function fx(name) {
    const args = Array.prototype.slice.call(arguments, 1);
    return safe(function () {
      const F = global.FX;
      return F && typeof F[name] === 'function' ? F[name].apply(F, args) : undefined;
    });
  }

  function voiceSay(text, opts) {
    safe(function () { if (global.Voice && typeof global.Voice.say === 'function') global.Voice.say(text, opts || {}); });
  }

  function voiceStop() {
    safe(function () { if (global.Voice && typeof global.Voice.stop === 'function') global.Voice.stop(); });
  }

  /* 🔊 button: read the text aloud (or explain why it can't) */
  function speakNow(text) {
    const Vc = global.Voice;
    if (!Vc || typeof Vc.say !== 'function') return;
    if (Vc.enabled === false) { toast('Голос выключен. Его можно включить в настройках.', '🔇'); return; }
    const ok = typeof Vc.available === 'function' ? safe(function () { return Vc.available(); }, true) : true;
    if (!ok) { toast('На этом устройстве нет русского голоса.', '🔇'); return; }
    voiceSay(text, { interrupt: true });
  }

  function installArt() {
    safe(function () { if (global.PieceArt && typeof global.PieceArt.install === 'function') global.PieceArt.install(); });
  }

  function pieceSvg(color, t, plain) {
    const c = typeof t === 'number' ? typeChar(t) : String(t || 'p').toLowerCase().charAt(0);
    const PA = global.PieceArt;
    if (PA) {
      const fn = plain ? PA.icon : PA.svg;
      if (typeof fn === 'function') {
        const s = safe(function () { return fn.call(PA, color, c); }, '');
        if (s) return s;
      }
    }
    const set = GLYPHS[color === 'b' ? 'b' : 'w'];
    return '<span class="lr-glyph lr-glyph-' + (color === 'b' ? 'b' : 'w') + '">' + (set[c] || '') + '</span>';
  }

  function starArt() {
    const PA = global.PieceArt;
    if (PA && typeof PA.star === 'function') {
      const s = safe(function () { return PA.star(); }, '');
      if (s) return s;
    }
    return '<span class="lr-glyph-star">★</span>';
  }

  function mascotArt() {
    const PA = global.PieceArt;
    if (PA && typeof PA.mascot === 'function') {
      const s = safe(function () { return PA.mascot(); }, '');
      if (s) return s;
    }
    return '<span class="lr-emoji">🐴</span>';
  }

  function groupIcon(g) {
    const e = g ? (g.emoji || GROUP_EMOJI[g.id] || '') : '';
    if (e) return '<span class="lr-emoji" aria-hidden="true">' + esc(e) + '</span>';
    const c = String((g && g.piece) || 'p').toLowerCase().charAt(0);
    return pieceSvg('w', TYPE_CHARS.indexOf(c) >= 0 ? c : 'p');
  }

  function themeColors() {
    const A = app();
    const id = (A && A.settings && A.settings.theme) ||
      (A && A.profile && A.profile.settings && A.profile.settings.theme) || 'ocean';
    const BV = global.BoardView;
    const list = BV && Array.isArray(BV.THEMES) ? BV.THEMES : [];
    const t = list.find(function (x) { return x && x.id === id; }) || list[0];
    return { light: (t && t.light) || '#e3f4ff', dark: (t && t.dark) || '#5aa9e6' };
  }

  /* ============================================================================================ progress */

  function levelKey(g, i) { return String(g && g.id) + ':' + i; }

  function levelStars(g, i) { return starsVal(profile().lessons[levelKey(g, i)], 3); }

  function groupStars(g) {
    return levelsOf(g).reduce(function (s, _, i) { return s + levelStars(g, i); }, 0);
  }

  function groupDone(g) {
    const ls = levelsOf(g);
    return ls.length > 0 && ls.every(function (_, i) { return levelStars(g, i) >= 1; });
  }

  function allLessonsDone() {
    const gs = groups();
    return gs.length > 0 && gs.every(groupDone);
  }

  /* progress key of a puzzle: String(id) (ids may be numbers 1..30 or strings 'm2-1', 'w-1') */
  function puzzleKey(pz, i) { return String(pz && pz.id != null ? pz.id : i + 1); }

  function puzzleStars(pz, i) { return starsVal(profile().puzzles[puzzleKey(pz, i)], 2); }

  /* → { solved, total } over a list of puzzles (each id counted once) */
  function countSolved(list) {
    const seen = new Set();
    let solved = 0;
    (list || []).forEach(function (pz, i) {
      const k = puzzleKey(pz, i);
      if (seen.has(k)) return;
      seen.add(k);
      if (puzzleStars(pz, i) > 0) solved++;
    });
    return { solved: solved, total: seen.size };
  }

  /* progress over the puzzles of one kind in the finite sets (the trainer's puzzles don't count here) */
  function kindProgress(kind) {
    let list = [];
    finiteSets().forEach(function (s) {
      list = list.concat(s.puzzles.filter(function (pz) { return puzzleKind(pz, s) === kind; }));
    });
    return countSolved(list);
  }

  function setProgress(id) {
    const s = findSet(puzzleSets(), id);
    return s ? countSolved(s.puzzles) : { solved: 0, total: 0 };
  }

  /*
   * «Новое!» for content v3: shown to a child who already has progress in the older content (a returning player),
   * on every v3 group / set until it has its first star (a child who starts fresh sees no badges at all).
   */
  function veteran3() {
    // a child who started with content v3 on this device (first launch or a reset): nothing of it is «new» to them
    if (freshStartVersion() >= 3) return false;
    return !!safe(function () {
      if (groups().some(function (g) { return !isV3(g) && groupStars(g) > 0; })) return true;
      return finiteSets().some(function (s) {
        return !isV3(s) && s.puzzles.some(function (pz, i) { return !isV3(pz) && puzzleStars(pz, i) > 0; });
      });
    }, false);
  }

  function freshStartVersion() {
    try {
      const v = Number(global.localStorage ? global.localStorage.getItem(FRESH_KEY) : 0);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (e) { return 0; }
  }

  /* the v3 puzzles appended to an older set (mate-in-1 31+, mate-in-2 'm2-11'+, «win» 'w-13'+) */
  function addedV3(set) {
    return set && !isV3(set) && !set.endless ? set.puzzles.filter(isV3) : [];
  }

  /* vet: veteran3() — a whole v3 set: nothing solved yet; an older set: none of its appended v3 puzzles solved */
  function isNewSet(set, vet) {
    if (!vet || !set) return false;
    if (isV3(set)) return countSolved(set.puzzles).solved === 0;
    const added = addedV3(set);
    return added.length > 0 && countSolved(added).solved === 0;
  }

  /*
   * Did this child play before content v2 (and not start fresh with v2, as a sibling, on a new device or after
   * «Сбросить прогресс»)? Decided from award unlock times — no new stored data. Only such a child gets the
   * «Новое!» badges and the «появились новые…» greetings.
   */
  function returningV1() {
    return !!safe(function () {
      const a = profile().achievements;
      if (!a || typeof a !== 'object') return false;
      return Object.keys(a).some(function (k) {
        const t = Number(a[k]);
        return isFinite(t) && t > 0 && t < V2_SINCE;
      });
    }, false);
  }

  /* «Мат в 1 ход» puzzles added in v2 (ids 19+) — new for a child who knew the v1 list */
  function isAddedMate1(pz) {
    const n = Number(pz && pz.id);
    return isFinite(n) && n > V1_PUZZLES && puzzleKind(pz) === 'mate1';
  }

  /* the added «Мат в 1 ход» puzzles of a set while none of them is solved yet (else []) */
  function unseenAddedMate1(set) {
    if (!set || set.id !== 'mate1') return [];
    const added = set.puzzles.filter(isAddedMate1);
    return added.length && countSolved(added).solved === 0 ? added : [];
  }

  /* news = a returning v1 child with solved puzzles: a set is «Новое!» while nothing of its v2 part is solved */
  function isFreshSet(set, news) {
    if (!news) return false;
    if (set.id === 'mate1') return unseenAddedMate1(set).length > 0;
    return countSolved(set.puzzles).solved === 0;
  }

  function rateStars(moves, par) {
    const L = lessonsLib();
    if (L && typeof L.rateStars === 'function') {
      const r = safe(function () { return L.rateStars(moves, par); }, null);
      if (r >= 1 && r <= 3) return r | 0;
    }
    if (moves <= par) return 3;
    if (moves <= par + 2) return 2;
    return 1;
  }

  function ratingHtml(n, max) {
    let h = '<span class="star-rating" aria-label="Звёзд: ' + n + ' из ' + max + '">';
    for (let i = 0; i < max; i++) h += '<i' + (i < n ? ' class="on"' : '') + '>★</i>';
    return h + '</span>';
  }

  function diffHtml(d) {
    let h = '<span class="lr-diff" title="Сложность">';
    for (let i = 1; i <= 3; i++) h += '<i' + (i <= d ? ' class="on"' : '') + '></i>';
    return h + '<em>' + esc(DIFF[d].label) + '</em></span>';
  }

  /* ============================================================================================ screens plumbing */

  function section(name) {
    let el = doc.getElementById('screen-' + name);
    if (!el) {
      el = doc.createElement('section');
      el.className = 'screen';
      el.id = 'screen-' + name;
      (doc.querySelector('main') || doc.body).appendChild(el);
    }
    return el;
  }

  function activeScreens() {
    const out = new Set();
    if (!doc) return out;
    SCREENS.forEach(function (n) {
      const el = doc.getElementById('screen-' + n);
      if (el && el.classList.contains('active')) out.add(n);
    });
    return out;
  }

  function cleanup() {
    S.epoch++;
    clearTimers();
    voiceStop();
    closeModal();
    const ds = S.disposers.splice(0);
    ds.forEach(function (fn) { safe(fn); });
    const v = S.view;
    S.view = null;
    if (v && typeof v.destroy === 'function') safe(function () { v.destroy(); });
    S.mascot = null;
    S.lesson = null;
    S.puzzle = null;
    S.screen = null;
  }

  /* switch to one of our sections (via App) and reset everything that belonged to the previous one */
  function enter(name) {
    cleanup();
    const el = section(name);
    if (!el.classList.contains('active')) {
      const A = app();
      if (A && typeof A.showScreen === 'function') {
        S.inShow = true;
        try { A.showScreen(name); } catch (e) { warn(e); } finally { S.inShow = false; }
      } else {
        doc.querySelectorAll('.screen.active').forEach(function (s) { s.classList.remove('active'); });
        el.classList.add('active');
      }
    }
    S.screen = name;
    prevActive = activeScreens();
    return el;
  }

  function onDispose(fn) { S.disposers.push(fn); }

  function V(method) {
    const v = S.view;
    if (!v || typeof v[method] !== 'function') return undefined;
    const args = Array.prototype.slice.call(arguments, 1);
    return safe(function () { return v[method].apply(v, args); });
  }

  function makeBoard(host, opts) {
    const A = app();
    if (A && typeof A.createBoard === 'function') return safe(function () { return A.createBoard(host, opts); }, null);
    if (typeof global.BoardView === 'function') {
      return safe(function () {
        return new global.BoardView(host, Object.assign({ theme: 'ocean', faces: true, showLegal: true, showCoords: true }, opts));
      }, null);
    }
    return null;
  }

  /* row = figure left, bubble right (App's createMascot accepts {row}) */
  function makeMascot(host, row) {
    if (!host) return null;
    const A = app();
    const m = A && typeof A.createMascot === 'function' ? safe(function () { return A.createMascot(host, { row: !!row }); }, null) : null;
    if (m && row) rowMascot(m);
    if (m && typeof m.say === 'function') return m;
    host.innerHTML = '<div class="lr-fb-mascot"><div class="lr-fb-mascot-art">' + mascotArt() +
      '</div><div class="lr-fb-bubble" aria-live="polite"></div></div>';
    const bubble = host.querySelector('.lr-fb-bubble');
    return {
      el: host.firstElementChild,
      say: function (text, o) {
        bubble.textContent = String(text || '');
        if (!o || o.speak !== false) voiceSay(text);
      },
      setMood: function () { /* the fallback mascot has a single mood */ }
    };
  }

  /* App's shared mascot has a row variant (figure left, bubble right) — used on the map and the puzzles grid */
  function rowMascot(m) {
    const el = m && m.el;
    if (el && el.classList && el.classList.contains('mascot')) el.classList.add('mascot-row');
  }

  function say(text, opts) {
    const m = S.mascot;
    if (!m || !text) return;
    const o = Object.assign({ mood: 'happy', speak: true }, opts || {});
    safe(function () { m.say(String(text), o); });
  }

  /* say, but don't repeat the same phrase aloud again and again */
  function tell(text, mood, speak) {
    if (!text) return;
    const t = now();
    const repeat = text === lastTell.text && t - lastTell.t < 3500;
    lastTell.text = text;
    lastTell.t = t;
    say(text, { mood: mood || 'think', speak: speak !== false && !repeat });
  }

  /* ---------------------------------------------------------------------------------------- modal */

  function openModal(opts) {
    closeModal();
    const ep = S.epoch;
    let handle = null;
    let byButton = false;
    const buttons = (opts.buttons || []).map(function (b) {
      return {
        label: b.label,
        kind: b.kind || 'primary',
        onClick: function () {
          if (byButton) return;
          byButton = true;
          const h = handle;
          if (S.modal === h) S.modal = null;
          if (h && typeof h.close === 'function') safe(function () { h.close(); });
          if (ep === S.epoch && typeof b.onClick === 'function') safe(b.onClick);
        }
      };
    });
    const cfg = {
      emoji: opts.emoji,
      title: opts.title,
      html: opts.html,
      buttons: buttons,
      dismissable: opts.dismissable !== false,
      onClose: function () {
        if (S.modal === handle) S.modal = null;
        if (byButton || ep !== S.epoch) return;
        if (typeof opts.onClose === 'function') safe(opts.onClose);
      }
    };
    const A = app();
    if (A && typeof A.modal === 'function') {
      handle = safe(function () { return A.modal(cfg); }, null);
    } else {
      handle = fallbackModal(cfg);
    }
    S.modal = handle || null;
    return handle;
  }

  function closeModal() {
    const h = S.modal;
    S.modal = null;
    if (h && typeof h.close === 'function') safe(function () { h.close(); });
  }

  function fallbackModal(cfg) {
    const wrap = doc.createElement('div');
    wrap.className = 'lr-fb-modal';
    wrap.innerHTML = '<div class="lr-fb-card" role="dialog" aria-modal="true">' +
      (cfg.emoji ? '<div class="lr-fb-emoji">' + esc(cfg.emoji) + '</div>' : '') +
      '<h3 class="lr-fb-title">' + esc(cfg.title || '') + '</h3>' +
      '<div class="lr-fb-body">' + (cfg.html || '') + '</div><div class="lr-fb-actions"></div></div>';
    const actions = wrap.querySelector('.lr-fb-actions');
    let closed = false;
    const handle = {
      close: function () {
        if (closed) return;
        closed = true;
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        if (typeof cfg.onClose === 'function') safe(cfg.onClose);
      }
    };
    (cfg.buttons || []).forEach(function (b) {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-big btn-' + (b.kind || 'primary');
      btn.textContent = b.label;
      btn.addEventListener('click', function () { safe(b.onClick); });
      actions.appendChild(btn);
    });
    if (cfg.dismissable !== false) {
      wrap.addEventListener('click', function (e) { if (e.target === wrap) handle.close(); });
    }
    doc.body.appendChild(wrap);
    return handle;
  }

  function resultHtml(n, max, lines, gained) {
    let stars = '<div class="lr-rstars">';
    for (let i = 0; i < max; i++) {
      const mid = max === 3 && i === 1 ? ' mid' : '';
      stars += '<span class="lr-rstar' + (i < n ? ' on' : ' off') + mid + '" style="--d:' + i + '">' +
        (i < n ? starArt() : EMPTY_STAR) + '</span>';
    }
    stars += '</div>';
    const text = lines.map(function (l) { return '<p class="lr-result-text">' + esc(l) + '</p>'; }).join('');
    const reward = gained > 0 ? '<div class="lr-result-reward">+' + gained + ' ⭐</div>' : '';
    return '<div class="lr-result">' + stars + text + reward + '</div>';
  }

  function starSounds(n) {
    for (let i = 0; i < n; i++) later(function () { snd('star'); }, 480 + i * 300);
  }

  function emptyState(el, text) {
    el.innerHTML = '<div class="lr-empty card"><div class="lr-empty-emoji">🧸</div><p>' + esc(text) + '</p></div>';
  }

  function observeResize(el, fn) {
    let pending = false;
    const run = function () {
      if (pending) return;
      pending = true;
      raf(function () { pending = false; safe(fn); });
    };
    if (typeof global.ResizeObserver === 'function') {
      const ro = new global.ResizeObserver(run);
      ro.observe(el);
      onDispose(function () { ro.disconnect(); });
    } else {
      global.addEventListener('resize', run);
      onDispose(function () { global.removeEventListener('resize', run); });
    }
  }

  /* ============================================================================================ lessons map */

  function renderMap(opts) {
    opts = opts || {};
    const el = enter('lessons');
    const ep = S.epoch;
    installArt();
    const gs = groups();
    if (!gs.length) {
      emptyState(el, 'Уроки ещё не загрузились. Попробуй обновить страницу!');
      return;
    }
    let earned = 0, total = 0;
    const info = gs.map(function (g, i) {
      const n = levelsOf(g).length;
      const s = groupStars(g);
      earned += s;
      total += n * 3;
      return { g: g, i: i, n: n, s: s, done: groupDone(g) };
    });
    const nextIdx = info.findIndex(function (x) { return !x.done; });
    const pct = total ? Math.round(earned * 100 / total) : 0;
    // «Новое!» until the first star: the lessons added after v1 for a child who played v1 (a child who started with
    // v2 has always seen them), and the v3 lessons for any child who already has progress in the older content
    const vet = earned > 0 && returningV1();
    const vet3 = veteran3();
    info.forEach(function (x) {
      x.isNew = x.s === 0 && ((vet && V1_GROUPS.indexOf(String(x.g.id)) < 0) || (vet3 && isV3(x.g)));
    });

    const nodeHtml = function (x) {
      const full = x.n > 0 && x.s >= x.n * 3;
      const cls = 'lr-node' + (x.done ? ' is-done' : '') + (x.i === nextIdx ? ' is-next' : '') + (full ? ' is-full' : '') +
        (x.isNew ? ' is-new' : '');
      return '<button type="button" class="' + cls + '" data-gi="' + x.i + '" style="' + colorVars(x.g.color, x.i) + ';--i:' + x.i + '"' +
        ' aria-label="Урок ' + (x.i + 1) + ': ' + esc(x.g.title) + '. Звёзд: ' + x.s + ' из ' + (x.n * 3) + (x.isNew ? '. Новый урок' : '') + '">' +
        '<span class="lr-node-inner">' +
          '<span class="lr-node-disc">' +
            '<span class="lr-node-num">' + (x.i + 1) + '</span>' +
            '<span class="lr-node-icon">' + groupIcon(x.g) + '</span>' +
            (x.done ? '<span class="lr-node-check" aria-hidden="true">✓</span>' : '') +
            (x.isNew ? '<span class="lr-node-new" aria-hidden="true">Новое!</span>' : '') +
          '</span>' +
          '<span class="lr-node-title">' + esc(x.g.title) + '</span>' +
          '<span class="lr-node-stars"><i>★</i> ' + x.s + '/' + (x.n * 3) + '</span>' +
        '</span>' +
        (x.i === nextIdx ? '<span class="lr-node-flag" aria-hidden="true">Сюда!</span>' : '') +
        '</button>';
    };

    const runs = chapterRuns(info);
    const chaptersHtml = runs.map(function (run, k) {
      const ch = CHAPTERS[run.ch];
      let s = 0, t = 0;
      run.items.forEach(function (x) { s += x.s; t += x.n * 3; });
      const done = run.items.every(function (x) { return x.done; });
      const fresh = run.items.some(function (x) { return x.isNew; });
      const cur = run.items.some(function (x) { return x.i === nextIdx; });
      return '<section class="lr-chapter lr-ch-' + run.ch + (done ? ' is-done' : '') + (cur ? ' is-cur' : '') + (fresh ? ' is-new' : '') + '"' +
          ' style="--k:' + k + '" aria-label="Часть ' + (k + 1) + ': ' + esc(ch.title) + '">' +
        '<header class="lr-ch-head">' +
          '<span class="lr-ch-emoji" aria-hidden="true">' + esc(ch.emoji) + '</span>' +
          '<span class="lr-ch-main"><span class="lr-ch-num">Часть ' + (k + 1) + '</span>' +
            '<span class="lr-ch-title">' + esc(ch.title) + '</span></span>' +
          (fresh ? '<span class="lr-ch-new" aria-hidden="true">Новое!</span>' : '') +
          '<span class="lr-ch-stars" title="Звёзды за эту часть">' + (done ? '<b class="lr-ch-check" aria-hidden="true">✓</b>' : '') +
            '<i>★</i> ' + s + '/' + t + '</span>' +
        '</header>' +
        '<div class="lr-map" data-run="' + k + '">' +
          '<div class="lr-deco" aria-hidden="true"></div>' +
          '<svg class="lr-road" aria-hidden="true" focusable="false"></svg>' +
          '<div class="lr-nodes">' + run.items.map(nodeHtml).join('') + '</div>' +
        '</div>' +
      '</section>';
    }).join('');

    el.innerHTML =
      '<div class="lr-wrap lr-map-screen">' +
        '<header class="screen-header lr-top">' +
          '<h2 class="lr-top-title">Как ходят фигуры</h2>' +
          '<div class="lr-top-actions">' +
            '<div class="chip lr-progress" title="Звёзды за уроки">' +
              '<span class="lr-progress-ico">⭐</span><span><b>' + earned + '</b> из ' + total + '</span>' +
              '<span class="lr-progress-bar"><i style="width:' + pct + '%"></i></span>' +
            '</div>' +
            '<button type="button" class="btn btn-secondary lr-to-puzzles">🧩 Задачки</button>' +
          '</div>' +
        '</header>' +
        '<div class="lr-top-mascot"></div>' +
        '<div class="lr-chapters">' + chaptersHtml + '</div>' +
      '</div>';

    el.querySelector('.lr-to-puzzles').addEventListener('click', function () { snd('click'); renderPuzzles(); });
    el.querySelectorAll('.lr-node').forEach(function (btn) {
      btn.addEventListener('click', function () {
        snd('click');
        openGroup(num(btn.getAttribute('data-gi'), 0));
      });
    });

    S.mascot = makeMascot(el.querySelector('.lr-top-mascot'), true);

    const maps = Array.prototype.slice.call(el.querySelectorAll('.lr-map'));
    let lastW = -1;
    const doLayout = function () {
      if (ep !== S.epoch || !maps.length) return;
      const w = maps[0].clientWidth;
      if (!w || w === lastW) return;
      lastW = w;
      maps.forEach(function (map, k) {
        const items = runs[k].items;
        const first = items[0].i, last = items[items.length - 1].i;
        // index of the next lesson inside this chapter: -1 = all of it is behind the child, 0 = all still ahead
        const local = nextIdx < 0 || nextIdx > last ? -1 : nextIdx < first ? 0 : nextIdx - first;
        layoutMap(map, local, k === maps.length - 1, nextIdx < 0);
      });
    };
    doLayout();
    if (maps.length) observeResize(maps[0], doLayout);

    if (opts.celebrate != null) {
      later(function () { celebrateGroup(el, opts.celebrate); }, 350);
    } else {
      const gr = mapGreeting(info, nextIdx, earned);
      say(gr.text, { mood: gr.mood, speak: !S.greetedMap });
      S.greetedMap = true;
      // the first unfinished lesson may be far down the road (22 lessons): bring it into view
      if (nextIdx > 0) later(function () { scrollToNode(el, nextIdx); }, 450);
    }
  }

  /* consecutive groups of the same chapter → [{ ch: index in CHAPTERS, items: [info…] }] (in map order) */
  function chapterRuns(info) {
    const lastCh = CHAPTERS.length - 1;
    const runs = [];
    let prev = 0;
    info.forEach(function (x) {
      const id = String(x.g.id);
      let c = CHAPTERS.findIndex(function (ch) { return ch.ids.indexOf(id) >= 0; });
      if (c < 0) c = isV3(x.g) ? lastCh : prev;
      prev = c;
      const run = runs[runs.length - 1];
      if (run && run.ch === c) run.items.push(x);
      else runs.push({ ch: c, items: [x] });
    });
    return runs;
  }

  function chapterTitleOf(gi) {
    const runs = chapterRuns(groups().map(function (g, i) { return { g: g, i: i }; }));
    const run = runs.find(function (r) { return r.items.some(function (x) { return x.i === gi; }); });
    return run ? { title: CHAPTERS[run.ch].title, run: run, runs: runs } : null;
  }

  function mapGreeting(info, nextIdx, earned) {
    const name = childName();
    if (nextIdx === -1) {
      return { text: 'Ура, ' + name + '! Ты прошёл все уроки! Можно повторить любой — или решить задачки.', mood: 'wow' };
    }
    const g = info[nextIdx].g;
    if (earned === 0) {
      return { text: 'Привет, ' + name + '! Я Огонёк. Давай узнаем, как ходят фигуры! Начнём с урока «' + g.title + '».', mood: 'happy' };
    }
    if (info[nextIdx].isNew) {
      return { text: 'С возвращением, ' + name + '! Смотри, появились новые уроки! Начнём с урока «' + g.title + '».', mood: 'wow' };
    }
    return { text: 'С возвращением, ' + name + '! Следующий урок — «' + g.title + '». Нажми на него!', mood: 'happy' };
  }

  function scrollToNode(map, i) {
    const node = map.querySelector('.lr-node[data-gi="' + i + '"]');
    if (!node || typeof node.getBoundingClientRect !== 'function') return;
    const r = node.getBoundingClientRect();
    const vh = global.innerHeight || 800;
    if (r.top < 60 || r.bottom > vh - 20) {
      safe(function () { node.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    }
  }

  function celebrateGroup(map, gi) {
    const g = groups()[gi];
    if (!g) return;
    const node = map.querySelector('.lr-node[data-gi="' + gi + '"]');
    if (node) node.classList.add('is-celebrate');
    scrollToNode(map, gi);
    if (groupDone(g)) {
      fx('fireworks', 2600);
      snd('win');
      const ch = chapterTitleOf(gi);
      const chDone = ch && ch.runs.length > 1 && ch.run.items.every(function (x) { return groupDone(x.g); });
      if (allLessonsDone()) {
        say('Ура! Ты прошёл все уроки! Теперь ты знаешь все секреты Шахматного Королевства!', { mood: 'wow' });
      } else if (chDone) {
        const nextRun = ch.runs[ch.runs.indexOf(ch.run) + 1];
        say('Ура! Вся часть «' + ch.title + '» пройдена!' +
          (nextRun && !nextRun.items.every(function (x) { return groupDone(x.g); }) ?
            ' Впереди часть «' + CHAPTERS[nextRun.ch].title + '»!' : ' Выбирай следующий урок!'), { mood: 'wow' });
      } else {
        say('Ура! Урок «' + g.title + '» пройден! Выбирай следующий!', { mood: 'wow' });
      }
    } else {
      say('Урок «' + g.title + '» почти пройден! Загляни в уровни без звёздочек.', { mood: 'think' });
    }
  }

  /*
   * One chapter's road: nodes in rows (serpentine), the road through them, scenery.
   * nextIdx: index of the next lesson inside this chapter (-1 = all done); withFinish: the last chapter — the road
   * ends at the castle of the kingdom (won = every lesson of the map is done).
   */
  function layoutMap(map, nextIdx, withFinish, won) {
    const W = map.clientWidth;
    if (!W) return;
    const nodes = Array.prototype.slice.call(map.querySelectorAll('.lr-node'));
    const n = nodes.length;
    const cols = W >= 860 ? 4 : W >= 560 ? 3 : 2;
    const disc = W < 440 ? 84 : 104;
    const rowH = disc + 136;
    const cellW = W / cols;
    const top = 46;
    const rows = Math.max(1, Math.ceil(n / cols));
    const H = top + rows * rowH;

    map.style.setProperty('--disc', disc + 'px');
    map.style.setProperty('--cell-w', Math.floor(cellW) + 'px');
    map.style.height = H + 'px';

    const pts = nodes.map(function (el, i) {
      const r = Math.floor(i / cols), k = i % cols;
      const c = r % 2 ? cols - 1 - k : k;
      const x = cellW * (c + 0.5);
      const y = top + r * rowH + disc / 2 + (k % 2 ? 18 : 0);
      el.style.left = x.toFixed(1) + 'px';
      el.style.top = y.toFixed(1) + 'px';
      return { x: x, y: y, r: r };
    });

    // a free spot after the last lesson on its row: the road ends at the castle of the kingdom
    let finish = null;
    if (withFinish !== false && n > 0 && n % cols !== 0) {
      const r = Math.floor(n / cols), k = n % cols;
      const c = r % 2 ? cols - 1 - k : k;
      finish = { x: cellW * (c + 0.5), y: top + r * rowH + disc / 2 + (k % 2 ? 18 : 0), r: r };
    }

    const f = function (v) { return v.toFixed(1); };
    const segs = [];
    const all = finish ? pts.concat([finish]) : pts;
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i], b = all[i + 1];
      if (a.r === b.r) {
        const mx = (a.x + b.x) / 2;
        segs.push('M' + f(a.x) + ' ' + f(a.y) + ' C' + f(mx) + ' ' + f(a.y) + ' ' + f(mx) + ' ' + f(b.y) + ' ' + f(b.x) + ' ' + f(b.y));
      } else {
        const kx = Math.min(cellW * 0.5, rowH * 0.55) * (a.r % 2 ? -1 : 1);
        segs.push('M' + f(a.x) + ' ' + f(a.y) + ' C' + f(a.x + kx) + ' ' + f(a.y) + ' ' + f(b.x + kx) + ' ' + f(b.y) + ' ' + f(b.x) + ' ' + f(b.y));
      }
    }
    const doneUpTo = nextIdx < 0 ? segs.length : nextIdx;
    const dAll = segs.join(' ');
    const svg = map.querySelector('.lr-road');
    if (svg) {
      svg.setAttribute('viewBox', '0 0 ' + f(W) + ' ' + H);
      svg.setAttribute('width', f(W));
      svg.setAttribute('height', String(H));
      svg.innerHTML = dAll ?
        '<path class="lr-road-shadow" d="' + dAll + '" transform="translate(0 7)"/>' +
        '<path class="lr-road-edge" d="' + dAll + '"/>' +
        '<path class="lr-road-base" d="' + dAll + '"/>' +
        '<path class="lr-road-done" d="' + segs.slice(0, doneUpTo).join(' ') + '"/>' +
        '<path class="lr-road-todo" d="' + segs.slice(doneUpTo).join(' ') + '"/>' : '';
    }

    const holder = map.querySelector('.lr-nodes');
    let fin = holder && holder.querySelector('.lr-finish');
    if (finish && holder) {
      if (!fin) {
        fin = doc.createElement('span');
        fin.className = 'lr-finish';
        fin.setAttribute('aria-hidden', 'true');
        fin.innerHTML = '<span class="lr-finish-art">🏰</span><span class="lr-finish-flag">🚩</span>';
        holder.appendChild(fin);
      }
      fin.classList.toggle('is-won', won === undefined ? nextIdx < 0 : !!won);
      fin.style.left = f(finish.x) + 'px';
      fin.style.top = f(finish.y) + 'px';
    } else if (fin && fin.parentNode) {
      fin.parentNode.removeChild(fin);
    }

    // scenery: in the free spots between rows (column borders) and on the side without a road turn
    const deco = map.querySelector('.lr-deco');
    if (deco) {
      let h = '<span class="lr-cloud c1">☁️</span><span class="lr-cloud c2">☁️</span>';
      let k = 0;
      for (let r = 1; r < rows; r++) {
        const yb = top + r * rowH - 16;
        for (let c = 1; c < cols; c++) {
          h += '<span class="lr-deco-item" style="left:' + f(c * cellW) + 'px;top:' + f(yb) + 'px;--k:' + k + '">' + DECO[k % DECO.length] + '</span>';
          k++;
        }
        if (cellW >= 200) {
          const leftFree = (r - 1) % 2 === 0;
          const x = leftFree ? cellW * 0.13 : W - cellW * 0.13;
          h += '<span class="lr-deco-item" style="left:' + f(x) + 'px;top:' + f(yb - rowH * 0.35) + 'px;--k:' + k + '">' + DECO[(k + 3) % DECO.length] + '</span>';
          k++;
        }
      }
      for (let i = 0; i < 14; i++) {
        const x = ((i * 37 + 11) % 97) / 97 * 100;
        const y = ((i * 53 + 29) % 89) / 89 * 100;
        h += '<span class="lr-twinkle" style="left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) + '%;--k:' + i + '">✦</span>';
      }
      deco.innerHTML = h;
    }
  }

  function openGroup(gi) {
    const g = groups()[gi];
    if (!g) { renderMap(); return; }
    const ls = levelsOf(g);
    let li = ls.findIndex(function (_, i) { return levelStars(g, i) < 1; });
    if (li < 0) li = 0;
    openLevel(gi, li);
  }

  /* ============================================================================================ lesson screen */

  function levelText(lvl) {
    if (!lvl) return '';
    if (lvl.text) return String(lvl.text);
    if (lvl.type === 'info') return 'Узнай, сколько стоит каждая фигура!';
    if (lvl.type === 'task') {
      const G = GOALS[lvl.goal];
      return G ? G.label + '!' : 'Сделай правильный ход!';
    }
    const ns = (lvl.stars || []).length, ne = (lvl.enemies || []).length;
    if (ns && ne) return 'Собери все звёздочки и съешь чужие фигуры!';
    if (ne) return 'Съешь все чужие фигуры!';
    return 'Собери все звёздочки!';
  }

  function alive(ctx) {
    return !!ctx && ctx.ep === S.epoch && (S.lesson === ctx || S.puzzle === ctx);
  }

  /* the 2nd tap of a double tap that opened this screen (e.g. on «➜ Следующая») must not press a button of the
     new screen that happens to be at the same spot — children often double-tap */
  function tooSoon(ctx) { return !!ctx && now() - (ctx.openedAt || 0) < TAP_GUARD_MS; }

  function openLevel(gi, li) {
    const gs = groups();
    const g = gs[gi];
    if (!g) { renderMap(); return; }
    const levels = levelsOf(g);
    if (!levels.length) { renderMap(); toast('В этом уроке пока нет уровней.', '🙈'); return; }
    li = clamp(Math.floor(num(li, 0)), 0, levels.length - 1);
    const lvl = levels[li];
    const el = enter('lesson');
    installArt();
    const kind = lvl.type === 'task' || lvl.type === 'info' ? lvl.type : 'stars';
    const ctx = {
      ep: S.epoch, gi: gi, li: li, g: g, lvl: lvl, kind: kind, levels: levels,
      key: levelKey(g, li), root: null, busy: false, done: false, openedAt: now()
    };
    S.lesson = ctx;
    S.lastLesson = { gi: gi, li: li };

    const dots = levels.map(function (_, i) {
      const s = levelStars(g, i);
      return '<button type="button" class="lr-dot' + (s ? ' done' : '') + (i === li ? ' cur' : '') + '" data-li="' + i + '"' +
        ' aria-label="Уровень ' + (i + 1) + '" title="Уровень ' + (i + 1) + '">' + (i + 1) +
        '<small>' + '★'.repeat(s) + '</small></button>';
    }).join('');
    const text = levelText(lvl);

    el.innerHTML =
      '<div class="lr-play lr-kind-' + kind + '" style="' + colorVars(g.color, gi) + '">' +
        '<header class="screen-header lr-head">' +
          '<button type="button" class="btn btn-ghost lr-back">← Карта</button>' +
          '<h2 class="lr-head-title"><span class="lr-head-icon">' + groupIcon(g) + '</span><span class="lr-head-name">' + esc(g.title) + '</span></h2>' +
          '<nav class="lr-dots" aria-label="Уровни">' + dots + '</nav>' +
        '</header>' +
        '<div class="lr-body">' +
          '<div class="card lr-task">' +
            '<div class="lr-task-main">' +
              '<span class="lr-task-badge">Уровень ' + (li + 1) + ' из ' + levels.length + '</span>' +
              '<p class="lr-task-text">' + esc(text) + '</p>' +
            '</div>' +
            '<button type="button" class="btn btn-icon lr-say" aria-label="Послушать задание" title="Послушать">🔊</button>' +
          '</div>' +
          '<div class="lr-mascot"></div>' +
          '<div class="lr-stage">' + (kind === 'info' ? '' : '<div class="board-host lr-board"></div>') + '</div>' +
          (kind === 'info' ? '' :
            '<div class="panel lr-controls">' +
              '<div class="lr-meter"></div>' +
              '<button type="button" class="btn btn-yellow btn-big lr-hint">💡 Подсказка</button>' +
              '<button type="button" class="btn btn-secondary btn-big lr-restart">↻ Заново</button>' +
            '</div>') +
        '</div>' +
      '</div>';
    ctx.root = el.querySelector('.lr-play');

    el.querySelector('.lr-back').addEventListener('click', function () { if (tooSoon(ctx)) return; snd('click'); renderMap(); });
    el.querySelectorAll('.lr-dot').forEach(function (b) {
      b.addEventListener('click', function () {
        if (tooSoon(ctx)) return;
        snd('click');
        openLevel(gi, num(b.getAttribute('data-li'), 0));
      });
    });
    el.querySelector('.lr-say').addEventListener('click', function () { speakNow(text); });

    S.mascot = makeMascot(el.querySelector('.lr-mascot'));

    if (kind === 'info') {
      renderInfo(ctx, el.querySelector('.lr-stage'));
    } else {
      el.querySelector('.lr-hint').addEventListener('click', function () { if (!tooSoon(ctx)) lessonHint(ctx); });
      el.querySelector('.lr-restart').addEventListener('click', function () { if (!tooSoon(ctx)) restartLevel(ctx); });
      const host = el.querySelector('.lr-board');
      ctx.host = host;
      S.view = makeBoard(host, {
        orientation: 'w',
        interactive: true,
        canSelect: function (sq, piece) { return lessonCanSelect(ctx, sq, piece); },
        getMoves: function (sq) { return lessonGetMoves(ctx, sq); },
        onMove: function (mv) { lessonMove(ctx, mv); },
        onIllegal: function (from, to) { lessonIllegal(ctx, from, to, true); },
        onSquareClick: function (sq) { lessonSquareClick(ctx, sq); }
      });
      if (!S.view) {
        emptyState(el.querySelector('.lr-stage'), 'Доска не загрузилась. Попробуй обновить страницу!');
        return;
      }
      const ok = kind === 'stars' ? setupStars(ctx) : setupTask(ctx);
      if (!ok) {
        say('Ой! Этот уровень не открылся. Выбери другой.', { mood: 'sad' });
        return;
      }
    }

    // introduction: the group intro on the first level, then the task itself
    if (li === 0 && g.intro) {
      say(g.intro, { mood: 'happy' });
      if (kind !== 'info') voiceSay(text, { interrupt: false });
    } else if (kind === 'info') {
      say('Нажми на любую фигуру — я расскажу про неё!', { mood: 'happy' });
    } else {
      say(text, { mood: 'happy' });
    }
  }

  function refreshDots(ctx) {
    if (!ctx.root) return;
    ctx.root.querySelectorAll('.lr-dot').forEach(function (b) {
      const i = num(b.getAttribute('data-li'), 0);
      const s = levelStars(ctx.g, i);
      b.classList.toggle('done', s > 0);
      const small = b.querySelector('small');
      if (small) small.textContent = '★'.repeat(s);
    });
  }

  function updateMeter(ctx) {
    const box = ctx.root && ctx.root.querySelector('.lr-meter');
    if (!box) return;
    if (ctx.kind === 'stars') {
      const par = ctx.par;
      const over = par != null && ctx.moves > par;
      const parTxt = par == null ? '…' : String(par);
      const nS = ctx.starSqs.length, gotS = nS - ctx.remaining.size;
      const nE = ctx.enemySqs.length, gotE = nE - enemiesLeft(ctx);
      box.innerHTML =
        '<div class="lr-meter-line" aria-label="Ходов: ' + ctx.moves + ' · Лучше всего: ' + parTxt + '">' +
          '<span class="lr-meter-moves' + (over ? ' over' : '') + '">Ходов: <b>' + ctx.moves + '</b></span>' +
          '<span class="lr-meter-sep">·</span>' +
          '<span class="lr-meter-par">Лучше всего: <b>' + parTxt + '</b></span>' +
        '</div>' +
        ((nS || nE) ? '<div class="lr-meter-targets">' +
          (nS ? '<span class="lr-tg' + (gotS === nS ? ' ok' : '') + '">⭐ ' + gotS + '/' + nS + '</span>' : '') +
          (nE ? '<span class="lr-tg' + (gotE === nE ? ' ok' : '') + '">🍽️ ' + gotE + '/' + nE + '</span>' : '') +
        '</div>' : '') +
        '<div class="lr-best"><span>Рекорд:</span>' + ratingHtml(levelStars(ctx.g, ctx.li), 3) + '</div>';
    } else {
      const G = GOALS[ctx.goal] || { emoji: '🎯', label: 'Задание' };
      box.innerHTML =
        '<div class="lr-goal"><span>' + G.emoji + '</span> ' + esc(G.label) + '</div>' +
        '<div class="lr-best"><span>Рекорд:</span>' + ratingHtml(levelStars(ctx.g, ctx.li), 3) + '</div>';
    }
  }

  function attention(ctx, selector, on) {
    const b = ctx.root && ctx.root.querySelector(selector);
    if (b) b.classList.toggle('lr-attn', !!on);
  }

  function lessonCanSelect(ctx, sq) {
    if (!alive(ctx) || ctx.busy || ctx.done || !ctx.chess) return false;
    if (ctx.kind === 'stars') return sq === ctx.pieceSq;
    const p = getP(ctx.chess, sq);
    return !!p && (p & 24) === ctx.chess.turn;
  }

  function lessonGetMoves(ctx, sq) {
    if (!alive(ctx) || ctx.busy || ctx.done || !ctx.chess) return [];
    if (ctx.kind === 'stars') return sq === ctx.pieceSq ? pseudoMoves(ctx.chess, sq) : [];
    return legalMoves(ctx.chess, sq);
  }

  function lessonMove(ctx, mv) {
    if (!alive(ctx)) return;
    const p = ctx.kind === 'stars' ? starsMove(ctx, mv) : taskMove(ctx, mv);
    p.catch(function (e) { warn(e); if (alive(ctx) && !ctx.done) ctx.busy = false; });
  }

  function restartLevel(ctx) {
    if (!alive(ctx)) return;
    closeModal();
    clearTimers();
    snd('whoosh');
    attention(ctx, '.lr-restart', false);
    attention(ctx, '.lr-hint', false);
    const ok = ctx.kind === 'stars' ? setupStars(ctx) : setupTask(ctx);
    if (ok) say('Начнём сначала! ' + levelText(ctx.lvl), { mood: 'happy', speak: false });
  }

  function goNext(ctx) {
    if (ctx.li + 1 < ctx.levels.length) openLevel(ctx.gi, ctx.li + 1);
    else renderMap({ celebrate: ctx.gi });
  }

  function hostFrom(ctx) {
    return (ctx && ctx.host) || { x: (global.innerWidth || 800) / 2, y: (global.innerHeight || 600) / 2 };
  }

  function saveLevel(ctx, stars) {
    const p = profile();
    const prev = starsVal(p.lessons[ctx.key], 3);
    let gained = 0;
    if (stars > prev) {
      p.lessons[ctx.key] = stars;
      gained = stars - prev;
    }
    save();
    if (gained > 0) addStars(gained, hostFrom(ctx));
    if (groupDone(ctx.g)) unlock('lesson_first');   // «Первый урок» = a whole lesson (group), not its first level
    if (allLessonsDone()) unlock('lessons_all');
    const fork = groups().find(function (g) { return g.id === 'fork'; });
    if (fork && groupDone(fork)) unlock('fork_lesson');   // 🔱 «Вилка!»: every level of the fork lesson has a star
    const v3 = groups().filter(isV3);
    if (v3.length && v3.every(groupDone)) unlock('lessons_v3');   // 🌟 «Все новые уроки»
    refreshDots(ctx);
    return { gained: gained, prev: prev };
  }

  function showLevelResult(ctx, r) {
    if (!alive(ctx)) return;
    const last = ctx.li + 1 >= ctx.levels.length;
    openModal({
      emoji: r.emoji,
      title: r.title,
      html: resultHtml(r.stars, 3, r.lines, r.gained),
      buttons: [
        { label: 'Дальше ➜', kind: 'green', onClick: function () { goNext(ctx); } },
        { label: '↻ Ещё раз', kind: 'secondary', onClick: function () { restartLevel(ctx); } }
      ],
      onClose: function () {
        tell(last ? 'Нажми «← Карта», чтобы выбрать следующий урок!' : 'Нажми на следующий кружок с цифрой — там новый уровень!', 'happy', false);
      }
    });
    starSounds(r.stars);
  }

  /* ---------------------------------------------------------------------------------------- illegal-move explanations */

  function ruleFor(t) {
    const c = typeChar(t);
    const g = groups().find(function (x) {
      return PIECE_GROUPS.indexOf(x.id) >= 0 && String(x.piece || '').toLowerCase() === c && x.rule;
    });
    return (g && g.rule) || FALLBACK_RULES[c] || 'Так ходить нельзя!';
  }

  function hasCastleRight(chess, color, kingSide) {
    const C = CH();
    const R = (C && C.CASTLE) || { WK: 1, WQ: 2, BK: 4, BQ: 8 };
    const bit = color === WHITE ? (kingSide ? R.WK : R.WQ) : (kingSide ? R.BK : R.BQ);
    return !!(num(chess && chess.castling, 0) & bit);
  }

  /* mode: 'stars' (lesson board, no kings) or 'game' (real position) */
  function explainIllegal(chess, from, to, mode) {
    const p = getP(chess, from);
    if (!p) return '';
    const t = p & 7, color = p & 24;
    const game = mode !== 'stars';
    const check = game && inCheck(chess);
    if (!onBoard(to) || to === from) return check ? 'Сейчас шах! Надо спасать короля.' : ruleFor(t);
    const target = getP(chess, to);
    if (target && (target & 24) === color) return 'Туда нельзя — там стоит своя фигура!';
    const dr = sqRow(to) - sqRow(from), dc = sqCol(to) - sqCol(from);
    const adr = Math.abs(dr), adc = Math.abs(dc);
    // two squares sideways from the king's home square = a castling try (never in the no-kings lesson boards)
    const castleTry = game && t === KING && dr === 0 && adc === 2 && sqCol(from) === 4 && sqRow(from) === (color === WHITE ? 7 : 0);
    const pseudo = game ? pseudoMoves(chess, from).filter(function (m) { return m.to === to; }) : [];
    if (check) {
      // the piece can go there, but the king stays in check — say why this very move doesn't help
      if (pseudo.some(function (m) { return (m.flags | 0) & FLAG().CASTLE; }) || (castleTry && hasCastleRight(chess, color, dc > 0))) {
        return 'Когда королю шах, рокироваться нельзя!';
      }
      if (pseudo.length) return t === KING ? 'Туда нельзя — там король тоже будет под шахом!' : 'Этот ход не спасает короля от шаха!';
      return 'Сейчас шах! Надо спасать короля.';
    }
    if (pseudo.length) {
      return t === KING ? 'Туда нельзя — там король попадёт под удар!' : 'Так нельзя — твой король окажется под ударом!';
    }
    const straight = dr === 0 || dc === 0, diag = adr === adc;
    if (t === ROOK || t === BISHOP || t === QUEEN) {
      const fits = t === ROOK ? straight : t === BISHOP ? diag : (straight || diag);
      if (fits && pathBlocked(chess, from, to)) return 'Путь закрыт! Перепрыгивать через фигуры умеет только конь.';
    }
    if (t === PAWN) {
      const fwd = color === WHITE ? -1 : 1;
      if (dr * fwd <= 0) return 'Пешки ходят только вперёд!';
      if (dc === 0 && dr === fwd && target) return 'Пешка не ест прямо — только наискосок!';
      if (dc === 0 && dr === 2 * fwd) {
        if (target || pathBlocked(chess, from, to)) return 'Путь закрыт — пешка не умеет перепрыгивать!';
        return 'На две клетки пешка может шагнуть только самым первым ходом!';
      }
      if (adc === 1 && dr === fwd && !target) return 'Наискосок пешка ходит, только когда ест чужую фигуру!';
    }
    if (castleTry) return 'Рокировку сейчас сделать нельзя.';
    return ruleFor(t);
  }

  /* fromBoard: the board has already shaken the piece and played 'illegal' */
  function lessonIllegal(ctx, from, to, fromBoard) {
    if (!alive(ctx) || ctx.busy || ctx.done || !ctx.chess) return;
    from = toSq(from);
    to = toSq(to);
    if (!onBoard(from) || !getP(ctx.chess, from)) return;
    if (!fromBoard) {
      V('shakePiece', from);
      snd('illegal');
    }
    let text;
    if (ctx.kind === 'stars') {
      text = explainIllegal(ctx.chess, from, to, 'stars');
      const own = String(ctx.g.piece || '').toLowerCase() === typeChar(ctx.pieceType);
      if (own && ctx.g.rule && text === ruleFor(ctx.pieceType)) text = ctx.g.rule;
      // the board dropped the selection: pick the lesson piece up again so its legal-move dots stay visible
      later(function () { if (alive(ctx) && !ctx.busy && !ctx.done) V('select', ctx.pieceSq); }, 450);
    } else {
      text = explainIllegal(ctx.chess, from, to, 'game');
    }
    tell(text, 'warn');
  }

  function lessonSquareClick(ctx, sq) {
    if (!alive(ctx) || ctx.busy || ctx.done || !ctx.chess) return;
    sq = toSq(sq);
    if (!onBoard(sq)) return;
    const p = getP(ctx.chess, sq);
    if (ctx.kind === 'stars') {
      const nm = nameOf(ctx.pieceType);
      if (p && (p & 24) === WHITE && sq !== ctx.pieceSq) tell('Эта пешка — стенка, её не двигают. Ходи ' + nm.ins + '!', 'think');
      else if (p && (p & 24) === BLACK) tell('Эту фигуру надо съесть! Сначала нажми на ' + nm.acc + '.', 'think');
      else tell('Сначала нажми на ' + nm.acc + ', а потом — на клетку, куда хочешь пойти.', 'think');
      V('pulseSquare', ctx.pieceSq, 'hint');
    } else {
      playSquareClick(ctx.chess, sq);
    }
  }

  function playSquareClick(chess, sq) {
    const p = getP(chess, sq);
    if (p && (p & 24) !== chess.turn) tell('Это фигура соперника. Ходи белыми фигурами!', 'think');
    else if (!p) tell('Нажми на белую фигуру, а потом — на клетку, куда хочешь пойти.', 'think');
    else tell('Этой фигурой сейчас не сходить. Попробуй другую!', 'think');
  }

  /* ---------------------------------------------------------------------------------------- stars levels */

  function buildStarsLocal(lvl) {
    const C = CH();
    if (!C) return null;
    const c = safe(function () { return new C('8/8/8/8/8/8/8/8 w - - 0 1'); }, null);
    if (!c) return null;
    const put = function (sq, p) { if (onBoard(sq) && p) safe(function () { c.put(sq, p); }); };
    (lvl.walls || []).forEach(function (w) { put(toSq(w), WHITE | PAWN); });
    (lvl.enemies || []).forEach(function (e) { if (e) put(toSq(e.sq), BLACK | (typeFromChar(e.piece) || PAWN)); });
    put(toSq(lvl.start), WHITE | (typeFromChar(lvl.piece) || ROOK));
    return c;
  }

  function setupStars(ctx) {
    const lvl = ctx.lvl;
    const L = lessonsLib();
    let chess = null;
    if (L && typeof L.buildStarsPosition === 'function') chess = safe(function () { return L.buildStarsPosition(lvl); }, null);
    if (!chess || typeof chess.pieceMoves !== 'function') chess = buildStarsLocal(lvl);
    if (!chess) return false;
    normalizeTurn(chess);

    let type = typeFromChar(lvl.piece) || ROOK;
    let sq = toSq(lvl.start);
    if (getP(chess, sq) !== (WHITE | type)) {
      // find the lesson piece: a white piece that is not a wall pawn
      const walls = (lvl.walls || []).map(toSq);
      sq = -1;
      for (let s = 0; s < 128 && sq < 0; s++) {
        if (s & 0x88) continue;
        const p = getP(chess, s);
        if (p && (p & 24) === WHITE && walls.indexOf(s) < 0) { sq = s; type = p & 7; }
      }
      if (sq < 0) return false;
    }

    ctx.chess = chess;
    ctx.baseChess = safe(function () { return chess.clone(); }, null);
    ctx.startSq = sq;
    ctx.pieceSq = sq;
    ctx.pieceType = type;
    ctx.starSqs = [];
    (lvl.stars || []).forEach(function (s) {
      const q = toSq(s);
      if (onBoard(q) && ctx.starSqs.indexOf(q) < 0) ctx.starSqs.push(q);
    });
    ctx.enemySqs = (lvl.enemies || []).map(function (e) { return toSq(e && e.sq); }).filter(onBoard);
    ctx.remaining = new Set(ctx.starSqs);
    ctx.moves = 0;
    ctx.done = false;
    ctx.busy = false;
    ctx.gen = (ctx.gen | 0) + 1;   // a new attempt: a move still animating from the old one must not touch this one
    ctx.pendingHint = false;
    ctx.hintUsed = false;
    ctx.stuckWarned = false;

    V('setInteractive', true);
    V('deselect');
    V('clearArrows');
    V('clearPulses');
    V('clearStars');
    V('setCheck', -1);
    V('clearLastMove');
    V('setPosition', chess, {});
    V('setStars', Array.from(ctx.remaining));
    later(function () { if (alive(ctx) && !ctx.busy && !ctx.done) V('select', ctx.pieceSq); }, 60);

    ctx.par = parCache.has(ctx.key) ? parCache.get(ctx.key) : null;
    updateMeter(ctx);
    if (ctx.par == null) {
      later(function () {
        if (!alive(ctx)) return;
        ctx.par = computePar(ctx);
        updateMeter(ctx);
      }, 150);
    }
    return true;
  }

  function enemiesLeft(ctx) {
    let n = 0;
    ctx.enemySqs.forEach(function (sq) {
      const p = getP(ctx.chess, sq);
      if (p && (p & 24) === BLACK) n++;
    });
    return n;
  }

  function currentMask(ctx) {
    let mask = 0;
    const nS = ctx.starSqs.length;
    ctx.starSqs.forEach(function (sq, i) { if (!ctx.remaining.has(sq)) mask |= 1 << i; });
    ctx.enemySqs.forEach(function (sq, j) {
      const p = getP(ctx.chess, sq);
      if (!(p && (p & 24) === BLACK)) mask |= 1 << (nS + j);
    });
    return mask;
  }

  function stateOf(ctx) { return { sq: ctx.pieceSq, type: ctx.pieceType, mask: currentMask(ctx) }; }

  /*
   * Own BFS over (piece square, piece type, collected mask) on the walls-only board — used when Lessons.solveStars
   * is missing or gives something unusable, and to detect a dead end (a pawn that walked past a star).
   * Returns {par, path} | null (unsolvable) | undefined (unknown: search too big / no engine).
   */
  function localSolve(ctx, state) {
    const base = ctx.baseChess;
    if (!base || typeof base.clone !== 'function' || !state) return undefined;
    const scratch = safe(function () { return base.clone(); }, null);
    if (!scratch) return undefined;
    const stars = ctx.starSqs;
    const enemies = ctx.enemySqs.map(function (sq) { return { sq: sq, piece: getP(base, sq) }; });
    const nS = stars.length, nT = nS + enemies.length;
    if (nT > 20) return undefined;
    const full = nT ? (1 << nT) - 1 : 0;
    let mask0 = state.mask | 0;
    enemies.forEach(function (e, j) { if (!e.piece || (e.piece & 24) !== BLACK) mask0 |= 1 << (nS + j); });
    if (mask0 === full) return { par: 0, path: [] };
    try {
      scratch.remove(ctx.startSq);
      enemies.forEach(function (e) { scratch.remove(e.sq); });
    } catch (e) { warn(e); return undefined; }
    if (getP(scratch, state.sq)) return undefined;

    const starIdx = new Map();
    stars.forEach(function (s, i) { starIdx.set(s, i); });
    const enemyIdx = new Map();
    enemies.forEach(function (e, j) { enemyIdx.set(e.sq, nS + j); });
    const keyOf = function (sq, type, mask) { return (mask * 8 + type) * 128 + sq; };

    const startKey = keyOf(state.sq, state.type, mask0);
    const parent = new Map();
    parent.set(startKey, null);
    const queue = [{ sq: state.sq, type: state.type, mask: mask0, key: startKey }];
    const rebuild = function (k) {
      const path = [];
      let cur = parent.get(k);
      while (cur) {
        path.push(cur.move);
        cur = parent.get(cur.prev);
      }
      return path.reverse();
    };
    try {
      for (let qi = 0; qi < queue.length; qi++) {
        const st = queue[qi];
        for (let j = 0; j < enemies.length; j++) {
          if (enemies[j].piece && !(st.mask & (1 << (nS + j)))) scratch.put(enemies[j].sq, enemies[j].piece);
        }
        scratch.put(st.sq, WHITE | st.type);
        const ms = scratch.pieceMoves(st.sq) || [];
        scratch.remove(st.sq);
        for (let j = 0; j < enemies.length; j++) scratch.remove(enemies[j].sq);
        for (let i = 0; i < ms.length; i++) {
          const m = ms[i];
          const nt = m.promotion ? (m.promotion & 7) : st.type;
          let nm = st.mask;
          const si = starIdx.get(m.to);
          if (si !== undefined) nm |= 1 << si;
          const ei = enemyIdx.get(m.to);
          if (ei !== undefined && m.captured) nm |= 1 << ei;
          const k = keyOf(m.to, nt, nm);
          if (parent.has(k)) continue;
          parent.set(k, { prev: st.key, move: { from: m.from, to: m.to, promotion: m.promotion || 0 } });
          if (nm === full) {
            const path = rebuild(k);
            return { par: path.length, path: path };
          }
          if (parent.size > SOLVE_LIMIT) return undefined;
          queue.push({ sq: m.to, type: nt, mask: nm, key: k });
        }
      }
    } catch (e) {
      warn(e);
      return undefined;
    }
    return null;
  }

  function computePar(ctx) {
    if (parCache.has(ctx.key)) return parCache.get(ctx.key);
    let par = null;
    const L = lessonsLib();
    if (L && typeof L.solveStars === 'function') {
      const r = safe(function () { return L.solveStars(ctx.lvl); }, null);
      if (r && num(r.par, 0) >= 1) par = Math.floor(r.par);
    }
    if (par == null) {
      const r = localSolve(ctx, { sq: ctx.startSq, type: typeFromChar(ctx.lvl.piece) || ctx.pieceType, mask: 0 });
      if (r && r.par >= 1) par = r.par;
    }
    if (par != null) parCache.set(ctx.key, par);
    return par;
  }

  function validStarStep(ctx, step) {
    const m = normMove(step);
    if (!m || m.from !== ctx.pieceSq) return null;
    const ok = pseudoMoves(ctx.chess, ctx.pieceSq).some(function (x) { return x.to === m.to; });
    return ok ? m : null;
  }

  function starsHint(ctx) {
    const state = stateOf(ctx);
    let step = null;
    const L = lessonsLib();
    if (L && typeof L.solveStars === 'function') {
      const r = safe(function () { return L.solveStars(ctx.lvl, state); }, null);
      step = r && Array.isArray(r.path) ? validStarStep(ctx, r.path[0]) : null;
    }
    let local;
    if (!step) {
      local = localSolve(ctx, state);
      step = local && local.path ? validStarStep(ctx, local.path[0]) : null;
    }
    ctx.hintUsed = true;
    V('clearArrows');
    V('clearPulses');
    if (!step) {
      if (local === null) stuckMessage(ctx);
      else tell('Попробуй сходить так, чтобы встать на звёздочку!', 'think');
      return;
    }
    snd('hint');
    V('showArrow', step.from, step.to, { kind: 'hint' });
    V('pulseSquare', step.to, 'hint');
    tell(ctx.remaining.has(step.to) || enemyAt(ctx, step.to) ? 'Смотри на стрелку — сходи туда!' :
      'Смотри на стрелку! Этот ход поможет добраться до цели.', 'think');
  }

  function enemyAt(ctx, sq) {
    const p = getP(ctx.chess, sq);
    return !!p && (p & 24) === BLACK;
  }

  function stuckMessage(ctx) {
    attention(ctx, '.lr-restart', true);
    if (ctx.pieceType === PAWN) {
      tell('Ой! Пешка ходит только вперёд — отсюда ей уже не собрать всё. Нажми «↻ Заново»!', 'sad');
    } else {
      tell('Ой! Отсюда уже не собрать все звёздочки. Нажми «↻ Заново»!', 'sad');
    }
  }

  function starsCheer(ctx) {
    const left = ctx.remaining.size;
    const enemies = enemiesLeft(ctx);
    if (left === 0 && enemies > 0) return 'Звёздочки собраны! Теперь съешь чужие фигуры!';
    if (left === 1) return 'Осталась последняя звёздочка!';
    const c = CHEERS[cheerIdx % CHEERS.length];
    cheerIdx++;
    return c;
  }

  async function starsMove(ctx, mv) {
    if (!alive(ctx) || ctx.busy || ctx.done) return;
    const chess = ctx.chess;
    const from = toSq(mv && mv.from), to = toSq(mv && mv.to);
    if (from !== ctx.pieceSq || !onBoard(to)) return;
    const promo = toType(mv && mv.promotion) || 0;
    let m = null;
    try { m = chess.move({ from: from, to: to, promotion: promo || undefined }); } catch (e) { m = null; }
    if (!m) {
      const cands = pseudoMoves(chess, from).filter(function (x) { return x.to === to; });
      const want = promo || QUEEN;
      const pick = cands.find(function (x) { return !x.promotion || x.promotion === want; }) || cands[0];
      if (!pick) { lessonIllegal(ctx, from, to); return; }
      const ok = safe(function () { chess.make(pick); return true; }, false);
      if (!ok) return;
      m = pick;
    }
    normalizeTurn(chess);
    ctx.busy = true;
    V('clearArrows');
    V('clearPulses');
    attention(ctx, '.lr-hint', false);
    moveSound(m);
    const gen = ctx.gen;
    await settle(V('applyMove', m, chess), 2600);
    // «↻ Заново» during the slide: setupStars already reset busy/selection — this old move must not land
    if (!alive(ctx) || ctx.gen !== gen) return;
    try {
      ctx.pieceSq = m.to;
      if (m.promotion) ctx.pieceType = m.promotion & 7;
      ctx.moves++;
      const c = V('squareCenter', m.to);
      let spoke = false;
      let gotStar = false;
      if (ctx.remaining.has(m.to)) {
        ctx.remaining.delete(m.to);
        gotStar = true;
        V('collectStar', m.to);
        snd('star');
        if (c) fx('burst', c.x, c.y, { shape: 'star', count: 22 });
        V('setPieceState', m.to, 'happy', 1000);
      }
      if (m.captured) {
        const me = nameOf(m.piece & 7), prey = nameOf(m.captured & 7);
        if (c) fx('burst', c.x, c.y, { shape: 'circle', count: 14 });
        say('Ам! ' + me.Nom + ' ' + ate(me) + ' ' + prey.acc + '!', { mood: 'wow' });
        spoke = true;
      }
      if (m.promotion) {
        const nn = nameOf(m.promotion & 7);
        say('Ура! Пешка превратилась в ' + nn.acc + '! Теперь ходи ' + nn.ins + '.', { mood: 'wow' });
        spoke = true;
      }
      updateMeter(ctx);
      if (ctx.remaining.size === 0 && countColor(chess, BLACK) === 0) {
        finishStars(ctx);
        return;
      }
      if (!spoke && gotStar) say(starsCheer(ctx), { mood: 'happy', speak: false });
      if (!ctx.stuckWarned && localSolve(ctx, stateOf(ctx)) === null) {
        ctx.stuckWarned = true;
        stuckMessage(ctx);
      }
    } finally {
      if (alive(ctx) && !ctx.done) {
        ctx.busy = false;
        V('select', ctx.pieceSq);
        runPendingHint(ctx);
      }
    }
  }

  function finishStars(ctx) {
    ctx.done = true;
    ctx.busy = false;
    dropPendingHint(ctx);
    V('setInteractive', false);
    V('clearArrows');
    V('clearPulses');
    let par = ctx.par;
    if (par == null) { par = computePar(ctx); ctx.par = par; }
    if (par == null || par < 1) par = ctx.moves;
    const stars = rateStars(ctx.moves, par);
    snd('levelComplete');
    fx('confetti');
    V('setSideState', 'w', 'happy', 2600);
    const res = saveLevel(ctx, stars);
    updateMeter(ctx);
    let title, emoji, line;
    if (stars >= 3) {
      title = 'Супер!';
      emoji = '🏆';
      line = 'Ты справился за ' + movesWord(ctx.moves) + ' — это лучший результат!';
    } else {
      title = stars === 2 ? 'Молодец!' : 'Получилось!';
      emoji = stars === 2 ? '🎉' : '👍';
      line = 'Ты справился за ' + movesWord(ctx.moves) + '. А можно быстрее — за ' + movesWord(par) + '. Попробуешь?';
    }
    say(title + ' ' + line, { mood: 'wow' });
    later(function () {
      showLevelResult(ctx, { stars: stars, title: title, emoji: emoji, lines: [line], gained: res.gained });
    }, 1000);
  }

  /* ---------------------------------------------------------------------------------------- task levels */

  function setupTask(ctx) {
    const C = CH();
    const lvl = ctx.lvl;
    if (!C) return false;
    const chess = safe(function () { return new C(lvl.fen); }, null);
    if (!chess || chess.loadError) return false;
    ctx.chess = chess;
    ctx.goal = String(lvl.goal || '');
    ctx.mistakes = 0;
    ctx.hintStep = 0;
    ctx.hintUsed = false;
    ctx.done = false;
    ctx.busy = false;
    ctx.gen = (ctx.gen | 0) + 1;
    ctx.pendingHint = false;
    const lm = lvl.lastMove ? normMove(lvl.lastMove) : null;
    ctx.lastMove = lm ? { from: lm.from, to: lm.to } : null;
    // «Защити фигуру»: the piece in trouble looks scared from the start (red ring)
    ctx.dangerSqs = ctx.goal === 'safe' ? hangingSqs(chess, chess.turn) : [];

    V('setInteractive', true);
    V('deselect');
    V('clearArrows');
    V('clearPulses');
    V('clearStars');
    V('clearLastMove');
    V('setPosition', chess, ctx.lastMove ? { lastMove: ctx.lastMove } : {});
    restoreMarks(ctx);
    updateMeter(ctx);
    return true;
  }

  function restoreMarks(ctx) {
    if (ctx.lastMove) V('setLastMove', ctx.lastMove.from, ctx.lastMove.to);
    else V('clearLastMove');
    V('setDanger', ctx.dangerSqs || []);
    refreshCheck(ctx.chess);
  }

  /* ---------------------------------------------------------------------------------------- threats & forks */

  function hangingSqs(chess, color) {
    return (safe(function () { return chess.hangingPieces(color); }, []) || [])
      .map(function (h) { return h && h.sq; })
      .filter(onBoard);
  }

  /*
   * The piece of `color` the opponent can win (the most valuable one, a legal capture preferred) and who takes it.
   * onlySq: look only at that square.   → { sq, piece, from } | null   (from = -1 when unknown)
   */
  function threatOn(chess, color, onlySq) {
    const list = (safe(function () { return chess.hangingPieces(color); }, []) || []).filter(function (h) {
      return h && onBoard(h.sq) && (onlySq === undefined || h.sq === onlySq);
    });
    if (!list.length) return null;
    const legal = chess.turn !== color ? legalMoves(chess) : [];
    let pick = null, from = -1;
    for (let i = 0; i < list.length && !pick; i++) {
      const takers = legal.filter(function (x) { return x.to === list[i].sq && x.captured; })
        .sort(function (a, b) { return rankOf(a.piece) - rankOf(b.piece); });
      if (takers.length) { pick = list[i]; from = takers[0].from; }
    }
    if (!pick) {
      pick = list[0];
      const att = (safe(function () { return chess.attackers(pick.sq, color ^ 24); }, []) || []).slice()
        .sort(function (a, b) { return rankOf(getP(chess, a)) - rankOf(getP(chess, b)); });
      from = att.length ? att[0] : -1;
    }
    return { sq: pick.sq, piece: getP(chess, pick.sq) || pick.piece, from: from };
  }

  /* enemy pieces the piece on sq attacks that make a fork: the king, pieces worth ≥ 300 or more than the attacker */
  function forkTargets(chess, sq) {
    const p = getP(chess, sq);
    if (!p) return [];
    const color = p & 24, them = color ^ 24;
    const out = [];
    for (let t = 0; t < 128; t++) {
      if (t & 0x88) continue;
      const q = getP(chess, t);
      if (!q || (q & 24) !== them) continue;
      const hits = safe(function () { return chess.attackers(t, color); }, []) || [];
      if (hits.indexOf(sq) < 0) continue;
      if ((q & 7) === KING || valueOf(q) >= 300 || valueOf(q) > valueOf(p)) out.push({ sq: t, piece: q });
    }
    return out.sort(function (a, b) { return rankOf(b.piece) - rankOf(a.piece); });
  }

  function possAcc(nm) { return nm.g === 'f' ? 'твою' : 'твоего'; }

  function pronAcc(nm) { return nm.g === 'f' ? 'её' : 'его'; }

  function pronNom(nm) { return nm.g === 'f' ? 'она' : 'он'; }

  const PAIR_ACC = { p: 'две пешки', n: 'двух коней', b: 'двух слонов', r: 'две ладьи', q: 'двух ферзей' };

  /* «короля и ферзя», «две ладьи», «коня, слона и ладью» */
  function targetsAcc(ts) {
    const cs = ts.map(function (t) { return typeChar(t.piece); });
    if (cs.length === 2 && cs[0] === cs[1] && PAIR_ACC[cs[0]]) return PAIR_ACC[cs[0]];
    const names = cs.map(function (c) { return nameOf(c).acc; });
    if (names.length < 2) return names.join('');
    return names.slice(0, -1).join(', ') + ' и ' + names[names.length - 1];
  }

  /* a 'safe' move that still leaves a piece to be eaten: words + marks (the scared piece and who takes it) */
  function safeFailInfo(before, m, after) {
    const th = threatOn(after, WHITE);
    if (!th) return { text: GOALS.safe.fail, marks: [], slow: false };
    const nm = nameOf(th.piece & 7);
    const was = before ? hangingSqs(before, WHITE) : [];
    const arrow = onBoard(th.from);
    let text;
    if (th.sq === m.to && was.indexOf(m.from) >= 0) {
      text = 'Ой, здесь ' + nm.acc + ' тоже могут съесть! Найди безопасную клетку.';
    } else if (was.indexOf(th.sq) >= 0) {
      text = 'Ой, ' + possAcc(nm) + ' ' + nm.acc + ' всё ещё могут съесть! Уведи ' + pronAcc(nm) +
        ', защити или съешь того, кто нападает.';
    } else {
      text = 'Ой, теперь могут съесть ' + possAcc(nm) + ' ' + nm.acc + '!' + (arrow ? ' Смотри на красную стрелку.' : '');
    }
    const marks = [{ danger: th.sq }];
    if (arrow) marks.push({ from: th.from, to: th.sq });
    return { text: text, marks: marks, slow: true };
  }

  /*
   * a move that is not a fork: the piece can be eaten there (eaten: true — a legal capture wins it), or it
   * attacks only one target
   */
  function forkFailInfo(before, m, after) {
    const p = getP(after, m.to);
    if (!p) return { text: GOALS.fork.fail, marks: [], slow: false };
    const nm = nameOf(p & 7);
    const th = threatOn(after, p & 24, m.to);
    const takers = th && after.turn !== (p & 24) ?
      legalMoves(after).filter(function (x) { return x.to === m.to && x.captured; }) : [];
    if (th && takers.length) {
      const marks = [{ danger: m.to }];
      if (onBoard(th.from)) marks.push({ from: th.from, to: m.to });
      return {
        text: 'Ой, здесь ' + nm.acc + ' съедят! Найди клетку, откуда ' + pronNom(nm) + ' нападёт сразу на две фигуры.',
        marks: marks, slow: true, eaten: true
      };
    }
    const ts = forkTargets(after, m.to);
    if (ts.length === 1) {
      return {
        text: nm.Nom + ' нападает только на ' + nameOf(ts[0].piece & 7).acc + '. Найди клетку, откуда ' + pronNom(nm) +
          ' нападёт сразу на две!',
        marks: [{ from: m.to, to: ts[0].sq, kind: 'info' }], slow: true
      };
    }
    return { text: GOALS.fork.fail, marks: [], slow: false };
  }

  function safeWinText(before, m) {
    const was = before ? hangingSqs(before, WHITE) : [];
    if (m.captured && before) {
      const hit = was.some(function (sq) {
        return (safe(function () { return before.attackers(sq, BLACK); }, []) || []).indexOf(m.to) >= 0;
      });
      if (hit) return 'Ам! Ты съел того, кто нападал!';
    }
    if (was.indexOf(m.from) >= 0) {
      const nm = nameOf(m.piece & 7);
      return nm.Nom + (nm.g === 'f' ? ' убежала' : ' убежал') + ' в безопасное место!';
    }
    if (was.length) return 'Ты защитил свою фигуру! Теперь её не съесть просто так.';
    return GOALS.safe.win;
  }

  function forkWinText(m, after) {
    const ts = forkTargets(after, m.to);
    if (ts.length < 2) return GOALS.fork.win;
    return 'Вилка! ' + nameOf(getP(after, m.to) & 7).Nom + ' нападает сразу на ' + targetsAcc(ts) + '!';
  }

  function refreshCheck(chess) {
    V('setCheck', inCheck(chess) ? kingSq(chess, chess.turn) : -1);
  }

  /* goal check: Lessons.checkGoal first, own implementation as a fallback */
  function goalMet(ctx, before, m, after) {
    // 'solution' (content v3: «Как начинать игру», «Связка»…): one of the level's listed answers (UCI)
    if (ctx.goal === 'solution' && Array.isArray(ctx.lvl.solutions)) return isSolution(ctx.lvl, m);
    const L = lessonsLib();
    if (L && typeof L.checkGoal === 'function') {
      try { return !!L.checkGoal(ctx.lvl, before, m, after); } catch (e) { warn(e); }
    }
    const F = FLAG();
    const flags = m.flags | 0;
    const t = m.piece & 7;
    switch (ctx.goal) {
      case 'check': return inCheck(after);
      case 'mate': return isMate(after);
      case 'escape': return inCheck(before) && !safe(function () { return after.inCheck(before.turn); }, true);
      case 'escape-king': return t === KING;
      case 'escape-block': {
        if (t === KING) return false;
        const k = kingSq(before, before.turn);
        const checkers = safe(function () { return before.attackers(k, before.turn ^ 24); }, []) || [];
        return checkers.indexOf(m.to) < 0;
      }
      case 'escape-capture': {
        if (!m.captured) return false;
        const k = kingSq(before, before.turn);
        const checkers = safe(function () { return before.attackers(k, before.turn ^ 24); }, []) || [];
        return checkers.indexOf(m.to) >= 0;
      }
      case 'castle': return !!(flags & F.CASTLE);
      case 'castle-k': return !!(flags & F.CASTLE) && sqCol(m.to) === 6;
      case 'castle-q': return !!(flags & F.CASTLE) && sqCol(m.to) === 2;
      case 'promote': return !!(flags & F.PROMO);
      case 'promote-q': return !!(flags & F.PROMO) && (m.promotion & 7) === QUEEN;
      case 'ep': return !!(flags & F.EP);
      case 'capture': {
        const target = toSq(ctx.lvl.target);
        return !!m.captured && (!onBoard(target) || m.to === target);
      }
      case 'safe': {
        // nothing of ours can be taken with a legal capture
        const legal = legalMoves(after);
        const hang = safe(function () { return after.hangingPieces(m.piece & 24); }, []) || [];
        return !hang.some(function (h) { return legal.some(function (x) { return x.to === h.sq && x.captured; }); });
      }
      case 'fork':
        return forkTargets(after, m.to).length >= 2 && !threatOn(after, m.piece & 24, m.to);
      default: return false;
    }
  }

  function isStalemate(chess) {
    return !!safe(function () {
      if (typeof chess.isStalemate === 'function') return chess.isStalemate();
      return !chess.inCheck() && legalMoves(chess).length === 0;
    }, false);
  }

  /*
   * A "mate" attempt that is not mate (after = position after the move, the defender to move):
   * why not, in words + marks for the board. Order: stalemate → check (king runs / capture / block) → no check.
   * → { text, marks: [{sq} | {from, to}], slow }   (slow = a longer text / marks worth looking at a bit longer)
   */
  /* firstOfTwo: the 1st move of a mate in 2 — a quiet move may be right there, so a stalemate is not «needs a check» */
  function notMateInfo(after, firstOfTwo) {
    const defender = after.turn;
    if (isStalemate(after)) {
      const k = kingSq(after, defender);
      return {
        text: 'Ой, это пат! ' + (defender === WHITE ? 'Белому' : 'Чёрному') +
          ' королю некуда ходить, но шаха нет — это ничья. ' +
          (firstOfTwo ? 'Оставь королю хотя бы одну клетку!' : 'Нужен ход с шахом!'),
        marks: k >= 0 ? [{ sq: k }] : [],
        slow: true
      };
    }
    if (!inCheck(after)) return { text: GOALS.mate.fail, marks: [], slow: false };
    return Object.assign(checkNotMate(after), { slow: true });
  }

  /* check but not mate: can the king run away, can the checking piece be eaten, or can the check be blocked? */
  function checkNotMate(after) {
    const F = FLAG();
    const defender = after.turn;
    const replies = legalMoves(after);
    const kingRuns = replies.filter(function (x) { return (x.piece & 7) === KING; });
    if (kingRuns.length) {
      const seen = [];
      kingRuns.forEach(function (x) { if (seen.indexOf(x.to) < 0) seen.push(x.to); });
      return {
        text: 'Это шах, но не мат — король может убежать. Попробуй ещё!',
        marks: seen.map(function (sq) { return { sq: sq }; })
      };
    }
    const ksq = kingSq(after, defender);
    const checkers = ksq >= 0 ? (safe(function () { return after.attackers(ksq, defender ^ 24); }, []) || []) : [];
    const caps = replies.filter(function (x) {
      // en passant: the checking pawn stands next to the square the capturing pawn lands on
      const hit = ((x.flags | 0) & F.EP) ? x.to + (defender === WHITE ? 16 : -16) : x.to;
      return checkers.indexOf(hit) >= 0;
    });
    if (caps.length) {
      return {
        text: 'Это шах, но не мат — твою фигуру можно съесть. Попробуй ещё!',
        marks: [{ from: caps[0].from, to: caps[0].to }]
      };
    }
    return {
      text: 'Это шах, но не мат — ' + (defender === WHITE ? 'белые' : 'чёрные') + ' могут закрыться от шаха. Попробуй ещё!',
      marks: replies.length ? [{ sq: replies[0].from }] : []
    };
  }

  /* marks: {sq} → red pulse, {danger} → scared piece with a red ring, {from, to, kind?} → arrow (danger by default) */
  function showMarks(marks) {
    (marks || []).forEach(function (mk) {
      if (mk.danger !== undefined) V('setDanger', [mk.danger]);
      else if (mk.sq !== undefined) V('pulseSquare', mk.sq, 'danger');
      else V('showArrow', mk.from, mk.to, { kind: mk.kind || 'danger' });
    });
  }

  /* a level's own words for one particular wrong move: lvl.failFor = { 'g1h3': 'С края доски…' } (UCI keys) */
  function ownFailText(lvl, m) {
    const map = lvl && lvl.failFor;
    if (!map || typeof map !== 'object' || !m || !onBoard(m.from) || !onBoard(m.to)) return '';
    const key = sqName(m.from) + sqName(m.to) + (m.promotion ? TYPE_CHARS.charAt((m.promotion & 7) - 1) : '');
    const own = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    return typeof own === 'string' && own ? own : '';
  }

  function taskFailText(ctx, before, m, after) {
    const lvl = ctx.lvl;
    // a stalemate is a draw, whatever the task was: say so (this is what «Не зевни пат!» is about)
    if (after && isStalemate(after)) return notMateInfo(after).text;
    // the level explains this very move (e.g. a knight to the rim in «Как начинать игру»)
    const own = ownFailText(lvl, m);
    if (own) return own;
    if (ctx.goal === 'fork') {
      // the piece simply gets eaten there: say exactly that (the board marks who eats it). The level's own
      // «Это не вилка…» would be wrong for a real double attack that only fails because the piece is lost.
      const info = forkFailInfo(before, m, after);
      if (info.eaten || !lvl.fail) return info.text;
    }
    if (lvl.fail) return String(lvl.fail);
    const t = m.piece & 7;
    switch (ctx.goal) {
      case 'mate':
        return notMateInfo(after).text;
      case 'escape-block':
        if (t === KING) return 'Королём ходить не нужно — закройся от шаха другой фигурой!';
        if (m.captured) return 'Съесть тоже можно, но сейчас попробуй закрыться от шаха другой фигурой!';
        break;
      case 'escape-capture':
        if (t === KING && !m.captured) return 'Королём убегать не нужно — съешь того, кто напал!';
        break;
      case 'promote-q':
        if (m.promotion && (m.promotion & 7) !== QUEEN) return 'Пешка превратилась, но лучше выбрать ферзя — он самый сильный!';
        break;
      case 'capture': {
        const target = toSq(lvl.target);
        const p = onBoard(target) ? getP(before, target) : 0;
        if (p) return 'Нужно съесть ' + nameOf(p & 7).acc + '!';
        break;
      }
      case 'safe':
        return safeFailInfo(before, m, after).text;
      case 'solution':
        return solutionFailInfo(m, after).text;
      default: break;
    }
    return (GOALS[ctx.goal] && GOALS[ctx.goal].fail) || 'Не получилось. Попробуй ещё раз!';
  }

  /* a 'solution' task answered with another move: the moved piece can simply be eaten there, or «there's better» */
  function solutionFailInfo(m, after) {
    const p = getP(after, m.to);
    const th = p ? threatOn(after, p & 24, m.to) : null;
    const takers = th && after.turn !== (p & 24) ?
      legalMoves(after).filter(function (x) { return x.to === m.to && x.captured; }) : [];
    if (th && takers.length) {
      const marks = [{ danger: m.to }];
      if (onBoard(th.from)) marks.push({ from: th.from, to: m.to });
      return { text: 'Ой, здесь ' + nameOf(p & 7).acc + ' съедят! Попробуй другой ход.', marks: marks, slow: true };
    }
    return { text: GOALS.solution.fail, marks: [], slow: false };
  }

  /* before (the position before the move) is optional */
  function taskWinText(ctx, m, after, before) {
    const goal = ctx.goal;
    if (ctx.lvl && typeof ctx.lvl.win === 'string' && ctx.lvl.win) return ctx.lvl.win;
    if ((goal === 'promote' || goal === 'promote-q') && m.promotion) {
      return 'Пешка дошла до края и превратилась в ' + nameOf(m.promotion & 7).acc + '!';
    }
    if (goal === 'capture' && m.captured) return 'Ам! Ты съел ' + nameOf(m.captured & 7).acc + '!';
    if (goal === 'safe') return safeWinText(before, m);
    if (goal === 'fork' && !isMate(after)) return forkWinText(m, after);
    if (isMate(after)) return GOALS.mate.win;
    return (GOALS[goal] && GOALS[goal].win) || 'Получилось!';
  }

  async function taskMove(ctx, mv) {
    if (!alive(ctx) || ctx.busy || ctx.done) return;
    const chess = ctx.chess;
    const from = toSq(mv && mv.from), to = toSq(mv && mv.to);
    if (!onBoard(from) || !onBoard(to)) return;
    const promo = toType(mv && mv.promotion) || 0;
    const before = safe(function () { return chess.clone(); }, null);
    if (!before) return;
    let m = null;
    try { m = chess.move({ from: from, to: to, promotion: promo || undefined }); } catch (e) { m = null; }
    if (!m) { lessonIllegal(ctx, from, to); return; }
    ctx.busy = true;
    V('clearArrows');
    V('clearPulses');
    V('setDanger', []);
    attention(ctx, '.lr-hint', false);
    moveSound(m);
    const gen = ctx.gen;
    await settle(V('applyMove', m, chess), 2600);
    // «↻ Заново» during the slide: setupTask already reset everything — this old move must not count
    if (!alive(ctx) || ctx.gen !== gen) return;
    const check = inCheck(chess);
    refreshCheck(chess);
    if (check) snd('check');
    if (goalMet(ctx, before, m, chess)) {
      taskSuccess(ctx, m, before);
      return;
    }
    // wrong: explain, then take the move back
    ctx.mistakes++;
    snd('wrong');
    tell(withHintTip(ctx, taskFailText(ctx, before, m, chess)), 'think');
    let slow = false, marked = false;
    if (isStalemate(chess) || (ctx.goal === 'mate' && !ctx.lvl.fail)) {
      const info = notMateInfo(chess);
      showMarks(info.marks);
      slow = info.slow;
    } else if (ctx.goal === 'solution') {
      const info = solutionFailInfo(m, chess);
      showMarks(info.marks);
      marked = info.marks.length > 0;
      slow = info.slow || !!ctx.lvl.fail;
    } else if (ctx.goal === 'safe' || ctx.goal === 'fork') {
      // who can still eat what (safe) / what the piece attacks or who eats it (fork): marks even with lvl.fail
      const info = ctx.goal === 'safe' ? safeFailInfo(before, m, chess) : forkFailInfo(before, m, chess);
      showMarks(info.marks);
      marked = info.marks.length > 0;
      slow = info.slow;
    }
    later(async function () {
      if (!alive(ctx) || ctx.gen !== gen) return;
      safe(function () { chess.undo(); });
      await settle(V('undoMove', m, chess), 1600);
      if (!alive(ctx) || ctx.gen !== gen) return;
      V('clearPulses');
      V('clearArrows');
      restoreMarks(ctx);
      ctx.busy = false;
      afterRevert(ctx);
    }, marked ? 2100 : slow ? 1600 : 1300);
  }

  function taskSuccess(ctx, m, before) {
    const chess = ctx.chess;
    ctx.done = true;
    ctx.busy = false;
    dropPendingHint(ctx);
    V('setInteractive', false);
    V('setDanger', []);
    const mate = isMate(chess);
    if (mate) {
      const k = kingSq(chess, chess.turn);
      if (k >= 0) V('tipKing', k);
      snd('win');
    } else {
      snd('levelComplete');
    }
    fx('confetti');
    V('setSideState', (m.piece & 24) === BLACK ? 'b' : 'w', 'happy', 2600);
    if (ctx.goal === 'fork' && !mate) {
      // show the fork: arrows to both (all) targets, the victims are scared
      forkTargets(chess, m.to).forEach(function (t) {
        V('showArrow', m.to, t.sq, { kind: 'info' });
        V('setPieceState', t.sq, 'scared', 2600);
      });
    }
    const stars = ctx.mistakes >= 3 ? 1 : (ctx.mistakes > 0 || ctx.hintUsed) ? 2 : 3;
    const res = saveLevel(ctx, stars);
    updateMeter(ctx);
    const win = taskWinText(ctx, m, chess, before);
    let title, emoji, extra;
    if (stars === 3) { title = 'Супер!'; emoji = mate ? '👑' : '🏆'; extra = 'С первой попытки — ты молодец!'; }
    else if (stars === 2) {
      title = 'Молодец!'; emoji = '🎉';
      extra = ctx.hintUsed ? 'В следующий раз попробуй без подсказки!' : 'Иногда нужно попробовать ещё разок — это нормально.';
    } else { title = 'Получилось!'; emoji = '👍'; extra = 'Ты не сдавался — это здорово!'; }
    say(win, { mood: 'wow' });
    later(function () {
      showLevelResult(ctx, { stars: stars, title: title, emoji: emoji, lines: [win, extra], gained: res.gained });
    }, mate ? 1400 : 1100);
  }

  function findGoalMove(ctx) {
    const chess = ctx.chess;
    const list = legalMoves(chess);
    let best = null;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const before = safe(function () { return chess.clone(); }, null);
      const after = safe(function () { return chess.clone(); }, null);
      if (!before || !after) return null;
      const made = safe(function () { return after.move({ from: m.from, to: m.to, promotion: m.promotion || undefined }); }, null);
      if (!made) continue;
      if (goalMet(ctx, before, made, after)) {
        if (!made.promotion || (made.promotion & 7) === QUEEN) return { from: m.from, to: m.to, promotion: m.promotion || 0 };
        if (!best) best = { from: m.from, to: m.to, promotion: m.promotion || 0 };
      }
    }
    return best;
  }

  /* raw: {from, to, promotion?} or a UCI string; used when it is a legal move, otherwise finder() */
  function hintMoveFor(chess, raw, finder) {
    const h = anyMove(raw);
    if (h && legalMoves(chess, h.from).some(function (x) { return x.to === h.to; })) return h;
    return finder ? finder() : null;
  }

  function taskHint(ctx) {
    const h = hintMoveFor(ctx.chess, ctx.lvl.hint, function () { return findGoalMove(ctx); });
    if (!h) { tell('Подумай, какая фигура может помочь!', 'think'); return; }
    ctx.hintUsed = true;
    showHintStep(ctx, h);
  }

  function showHintStep(ctx, h) {
    snd('hint');
    attention(ctx, '.lr-hint', false);
    V('clearArrows');
    V('clearPulses');
    if (ctx.kind === 'puzzle') restorePuzzleMarks(ctx);   // «Спасайся!»: the threat stays in sight
    V('pulseSquare', h.from, 'hint');
    if (ctx.hintStep === 0) {
      ctx.hintStep = 1;
      tell('Попробуй сходить этой фигурой!', 'think');
    } else {
      ctx.hintStep = 2;
      V('showArrow', h.from, h.to, { kind: 'hint' });
      // an under-promotion is part of the answer (e.g. a rook instead of a queen, so that it is not stalemate)
      const promo = h.promotion ? (toType(h.promotion) & 7) : 0;
      tell(promo && promo !== QUEEN ? 'Смотри на стрелку — сходи вот так и выбери ' + nameOf(promo).acc + '!' :
        'Смотри на стрелку — сходи вот так!', 'think');
    }
  }

  /* from the 2nd mistake on the explanation itself suggests the hint (so it stays visible and is spoken again) */
  function withHintTip(ctx, text) {
    return ctx.mistakes >= 2 && !ctx.hintUsed ? text + ' ' + HINT_TIP : text;
  }

  /* hint pressed while a move is animating / being taken back: remember it and give it when the board is free */
  function queueHint(ctx) {
    ctx.pendingHint = true;
    snd('click');
    attention(ctx, '.lr-hint', true);
  }

  function dropPendingHint(ctx) {
    if (ctx.pendingHint) attention(ctx, '.lr-hint', false);
    ctx.pendingHint = false;
  }

  /* → true when a remembered hint was given now */
  function runPendingHint(ctx) {
    if (!ctx.pendingHint) return false;
    dropPendingHint(ctx);
    if (!alive(ctx) || ctx.busy || ctx.done) return false;
    if (ctx.kind === 'puzzle') puzzleHint(ctx);
    else lessonHint(ctx);
    return true;
  }

  /* a wrong move was taken back (task / puzzle): the remembered hint, or a nudge towards the hint button */
  function afterRevert(ctx) {
    lastTell.t = 0;   // the next mistake is a new event: its explanation may be spoken again
    if (runPendingHint(ctx)) return;
    if (ctx.mistakes >= 2 && !ctx.hintUsed) attention(ctx, '.lr-hint', true);
  }

  function lessonHint(ctx) {
    if (!alive(ctx)) return;
    if (ctx.busy && !ctx.done) { queueHint(ctx); return; }
    if (ctx.done) {
      tell('Уровень пройден! Нажми «↻ Заново» или выбери другой уровень.', 'happy');
      return;
    }
    if (ctx.kind === 'stars') starsHint(ctx);
    else taskHint(ctx);
  }

  /* ---------------------------------------------------------------------------------------- info level */

  function renderInfo(ctx, stage) {
    const lvl = ctx.lvl;
    const items = Array.isArray(lvl.items) ? lvl.items.filter(Boolean) : [];
    const values = {};
    const cards = items.map(function (it, i) {
      const c = String(it.piece || 'p').toLowerCase().charAt(0);
      const nm = nameOf(c);
      const v = Number(it.value);
      const valid = isFinite(v) && v > 0;
      if (valid) values[c] = v;
      let coins = '';
      if (valid) {
        for (let k = 0; k < Math.min(v, 10); k++) coins += '<i class="lr-coin" style="--c:' + k + '"></i>';
      } else {
        coins = '<span class="lr-crown">👑</span>';
      }
      const valueText = valid ? v + ' ' + plural(v, 'монетка', 'монетки', 'монеток') : 'Бесценный!';
      return '<button type="button" class="lr-coin-card" data-i="' + i + '" style="--i:' + i + '">' +
        '<span class="lr-coin-piece">' + pieceSvg('w', c) + '</span>' +
        '<span class="lr-coin-name">' + esc(nm.Nom) + '</span>' +
        '<span class="lr-coins">' + coins + '</span>' +
        '<span class="lr-coin-value">' + esc(valueText) + '</span>' +
        (it.text ? '<span class="lr-coin-text">' + esc(it.text) + '</span>' : '') +
        '</button>';
    }).join('');

    let example = '';
    if (values.n && values.b && values.r) {
      const sum = values.n + values.b;
      example = '<div class="lr-info-example">' +
        '<span class="lr-ex-group"><span class="lr-ex-piece">' + pieceSvg('w', 'n') + '</span><b>+</b>' +
        '<span class="lr-ex-piece">' + pieceSvg('w', 'b') + '</span><b>= ' + sum + '</b><i class="lr-coin big"></i></span>' +
        '<span class="lr-ex-vs">' + (sum > values.r ? '&gt;' : sum < values.r ? '&lt;' : '=') + '</span>' +
        '<span class="lr-ex-group"><span class="lr-ex-piece">' + pieceSvg('w', 'r') + '</span><b>= ' + values.r + '</b><i class="lr-coin big"></i></span>' +
        '<p class="lr-ex-text">Конь + слон = ' + sum + ', а ладья = ' + values.r + '. ' +
        (sum > values.r ? 'Конь и слон вместе стоят больше!' : sum < values.r ? 'Ладья стоит больше!' : 'Поровну!') + '</p>' +
        '</div>';
    }

    stage.innerHTML =
      '<div class="lr-info">' +
        '<h3 class="lr-info-title">' + esc(lvl.title || 'Сколько стоят фигуры?') + '</h3>' +
        '<p class="lr-info-sub">Чем сильнее фигура, тем больше монеток она стоит.</p>' +
        '<div class="lr-info-grid' + (items.length <= 6 ? ' is-row' : '') + '" style="--n:' + Math.max(1, items.length) +
          ';--cols:' + (items.length <= 3 ? Math.max(1, items.length) : items.length === 4 ? 2 : 3) + '">' + cards + '</div>' +
        example +
        '<div class="lr-info-actions"><button type="button" class="btn btn-green btn-big lr-info-ok">Понятно! ➜</button></div>' +
      '</div>';
    ctx.host = stage.querySelector('.lr-info');

    stage.querySelectorAll('.lr-coin-card').forEach(function (card) {
      card.addEventListener('click', function () {
        const it = items[num(card.getAttribute('data-i'), 0)];
        if (!it) return;
        const c = String(it.piece || 'p').toLowerCase().charAt(0);
        const nm = nameOf(c);
        const v = Number(it.value);
        const valueText = isFinite(v) && v > 0 ? v + ' ' + plural(v, 'монетка', 'монетки', 'монеток') : 'бесценный';
        snd('pop');
        card.classList.remove('lr-bounce');
        void card.offsetWidth;
        card.classList.add('lr-bounce');
        say(nm.Nom + ' — ' + valueText + '. ' + (it.text || ''), { mood: 'happy' });
      });
    });

    const ok = stage.querySelector('.lr-info-ok');
    ok.addEventListener('click', function () {
      if (!alive(ctx) || ctx.done) return;
      ctx.done = true;
      ok.disabled = true;
      snd('levelComplete');
      const r = ok.getBoundingClientRect ? ok.getBoundingClientRect() : null;
      if (r) fx('burst', r.left + r.width / 2, r.top + r.height / 2, { shape: 'star', count: 30 });
      saveLevel(ctx, 3);
      say('Молодец! Теперь ты знаешь, сколько стоят фигуры!', { mood: 'wow', speak: false });
      later(function () { goNext(ctx); }, 1100);
    });
  }

  /* ============================================================================================ puzzles grid */

  function miniBoardHtml(fen, th) {
    const rows = String(fen || '').split(/\s+/)[0].split('/');
    let pcs = '';
    for (let r = 0; r < 8 && r < rows.length; r++) {
      let c = 0;
      const row = rows[r];
      for (let i = 0; i < row.length && c < 8; i++) {
        const ch = row.charAt(i);
        if (ch >= '1' && ch <= '8') { c += ch.charCodeAt(0) - 48; continue; }
        const t = ch.toLowerCase();
        if (TYPE_CHARS.indexOf(t) >= 0) {
          pcs += '<i style="left:' + (c * 12.5) + '%;top:' + (r * 12.5) + '%">' + pieceSvg(ch === t ? 'b' : 'w', t, true) + '</i>';
        }
        c++;
      }
    }
    return '<span class="lr-mini" style="--light:' + esc(th.light) + ';--dark:' + esc(th.dark) + '" aria-hidden="true">' + pcs + '</span>';
  }

  function setKind(set) {
    if (KINDS.indexOf(set.id) >= 0) return set.id;
    return puzzleKind(set.puzzles[0], set);
  }

  function joinAnd(items) {
    if (items.length < 2) return items.join('');
    return items.slice(0, -1).join(', ') + ' и ' + items[items.length - 1];
  }

  /* what the mascot says when a set is picked */
  function setIntro(set) {
    if (set.endless) return '«' + set.title + '». ' + (set.text || SET_DEFAULTS.trainer.text);
    const c = countSolved(set.puzzles);
    const head = '«' + set.title + '». ';
    if (c.total && c.solved >= c.total) return head + 'Здесь всё решено! Можно решить задачки ещё раз.';
    return head + (KIND_INTRO[setKind(set)] || set.text || 'Выбирай задачку!');
  }

  /* is the set shown as «Новое!» (content v2 news for a returning v1 child, or content v3 news)? */
  function setFresh(set, view) {
    const c = countSolved(set.puzzles);
    if (!set.endless && c.total > 0 && c.solved >= c.total) return false;
    return isNewSet(set, view.vet3) || isFreshSet(set, view.news);
  }

  /* the card the «Сюда!» flag points at: a whole new set (the next step up), else a set with new puzzles, else the
     last one (if unfinished), else the first unfinished */
  function suggestedSet(view) {
    const unfinished = function (s) {
      const c = countSolved(s.puzzles);
      return !s.endless && c.solved < c.total;
    };
    const fresh = view.sets.find(function (s) { return !s.endless && isV3(s) && setFresh(s, view); }) ||
      view.sets.find(function (s) { return setFresh(s, view); });
    if (fresh) return fresh;
    const last = findSet(view.sets, view.stored);
    if (last && (last.endless || unfinished(last))) return last;
    return view.sets.find(unfinished) || trainerSet(view.sets) || null;
  }

  function setCardHtml(set, i, view, flag) {
    const c = countSolved(set.puzzles);
    const pct = c.total ? Math.round(c.solved * 100 / c.total) : 0;
    const done = !set.endless && c.total > 0 && c.solved >= c.total;
    const fresh = setFresh(set, view);
    let streak = '';
    if (set.endless) {
      const t = trainerState();
      streak = '<span class="lr-sc-streak"><span class="lr-sc-chip">🔥 Серия: <b>' + t.streak + '</b></span>' +
        '<span class="lr-sc-chip">🏅 Рекорд: <b>' + t.best + '</b></span></span>';
    }
    return '<button type="button" class="lr-set-card' + (set.endless ? ' is-endless' : '') + (done ? ' is-done' : '') +
        (fresh ? ' is-new' : '') + (flag ? ' is-next' : '') + (view.stored === set.id ? ' is-last' : '') + '"' +
        ' data-set="' + esc(set.id) + '" style="' + colorVars(set.color, i) + ';--i:' + i + '"' +
        ' aria-label="' + esc(set.title) + '. Решено ' + c.solved + ' из ' + c.total + (fresh ? '. Новое' : '') + '">' +
      '<span class="lr-sc-emoji" aria-hidden="true">' + esc(set.emoji) + '</span>' +
      '<span class="lr-sc-main">' +
        '<span class="lr-sc-title">' + esc(set.title) + '</span>' +
        (set.text ? '<span class="lr-sc-text">' + esc(set.text) + '</span>' : '') +
      '</span>' +
      streak +
      '<span class="lr-sc-count"><span class="lr-sc-word">Решено </span><b>' + c.solved + '</b> из ' + c.total + '</span>' +
      '<span class="lr-sc-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' +
      (set.endless ? '<span class="lr-sc-play" aria-hidden="true">Играть ▶</span>' : '') +
      (done ? '<span class="lr-sc-check" aria-hidden="true">✓</span>' : '') +
      (fresh ? '<span class="lr-sc-new" aria-hidden="true">Новое!</span>' : '') +
      (flag ? '<span class="lr-sc-flag" aria-hidden="true">Сюда!</span>' : '') +
      '</button>';
  }

  /* news: a returning v1 child — the unsolved «Мат в 1 ход» puzzles added in v2 get a «Новое!» sticker;
     vet3: a returning child — so do the unsolved v3 puzzles appended to the older sets */
  function tilesHtml(set, news, vet3) {
    const th = themeColors();
    const nextIdx = set.puzzles.findIndex(function (pz, i) { return !puzzleStars(pz, i); });
    const markAdded = !!news && set.id === 'mate1';
    const mark3 = !!vet3 && !isV3(set);
    return set.puzzles.map(function (pz, i) {
      const d = clamp(Math.round(num(pz.difficulty, 1)), 1, 3);
      const s = puzzleStars(pz, i);
      const title = pz.title || set.title;
      const added = !s && ((markAdded && isAddedMate1(pz)) || (mark3 && isV3(pz)));
      let stars = '';
      for (let k = 0; k < 2; k++) stars += '<i' + (k < s ? ' class="on"' : '') + '>★</i>';
      return '<button type="button" class="lr-tile ' + DIFF[d].cls + (s ? ' is-solved' : '') + (i === nextIdx ? ' is-next' : '') + '"' +
        ' data-i="' + i + '" style="--i:' + Math.min(i, 30) + '" aria-label="Задачка ' + (i + 1) + ': ' + esc(title) +
        (s ? ', решена' : added ? ', новая' : '') + '">' +
        '<span class="lr-tile-num">' + (i + 1) + '</span>' +
        (s ? '<span class="lr-tile-check" aria-hidden="true">✓</span>' : '') +
        (added ? '<span class="lr-tile-new" aria-hidden="true">Новое!</span>' : '') +
        miniBoardHtml(pz.fen, th) +
        '<span class="lr-tile-title">' + esc(title) + '</span>' +
        '<span class="lr-tile-meta">' + diffHtml(d) + '<span class="lr-tile-stars">' + stars + '</span></span>' +
        '</button>';
    }).join('');
  }

  function panelHtml(set, news, vet3) {
    const c = countSolved(set.puzzles);
    const text = set.text || (SET_DEFAULTS[set.id] && SET_DEFAULTS[set.id].text) || '';
    return '<div class="lr-set-head">' +
        '<span class="lr-set-head-emoji" aria-hidden="true">' + esc(set.emoji) + '</span>' +
        '<div class="lr-set-head-main">' +
          '<h3 class="lr-set-head-title">' + esc(set.title) + '</h3>' +
          (text ? '<p class="lr-set-head-text">' + esc(text) + '</p>' : '') +
        '</div>' +
        '<span class="chip lr-set-head-count">Решено <b>' + c.solved + '</b> из ' + c.total + '</span>' +
      '</div>' +
      '<div class="lr-grid">' + tilesHtml(set, news, vet3) + '</div>';
  }

  /*
   * Puzzles screen: overall progress and the mascot on top; below either the set picker (one big card per set:
   * emoji, title, «Решено X из N», «Новое!», the trainer's streak) or the grid of one set («← Все задачки» goes
   * back). opts.set = open that set's grid (e.g. back from one of its puzzles); opts.celebrate = came here after the
   * last puzzle of that set. With a single set (old data) its grid is shown right away.
   */
  function renderPuzzles(opts) {
    opts = opts || {};
    const el = enter('puzzles');
    installArt();
    const sets = puzzleSets();
    if (!sets.length) {
      emptyState(el, 'Задачки ещё не загрузились. Попробуй обновить страницу!');
      return;
    }
    const stored = S.puzSet || loadSetId();
    const single = sets.length < 2;
    let set = single ? sets[0] : findSet(sets, opts.set);
    if (set && set.endless && !single) set = null;   // the trainer has no grid: its card waits on the picker
    const all = countSolved(allPuzzles());
    const pct = all.total ? Math.round(all.solved * 100 / all.total) : 0;
    // «Новое!» badges: content v2 news only for a child who played v1 (see returningV1), v3 news for any child with
    // progress in the older content (see veteran3)
    const news = all.solved > 0 && returningV1();
    const view = { el: el, sets: sets, set: null, single: single, news: news, vet3: veteran3(), stored: stored, ep: S.epoch };

    el.innerHTML =
      '<div class="lr-wrap lr-puz-screen">' +
        '<header class="screen-header lr-top">' +
          '<h2 class="lr-top-title">Задачки</h2>' +
          '<div class="lr-top-actions">' +
            '<div class="chip lr-progress" title="Решённые задачки">' +
              '<span class="lr-progress-ico">🧩</span><span>Решено <b>' + all.solved + '</b> из ' + all.total + '</span>' +
              '<span class="lr-progress-bar"><i style="width:' + pct + '%"></i></span>' +
            '</div>' +
            '<button type="button" class="btn btn-secondary lr-to-lessons">📚 Уроки</button>' +
          '</div>' +
        '</header>' +
        '<div class="lr-top-mascot"></div>' +
        '<div class="lr-puz-body"></div>' +
      '</div>';

    el.querySelector('.lr-to-lessons').addEventListener('click', function () { snd('click'); renderMap(); });
    S.mascot = makeMascot(el.querySelector('.lr-top-mascot'), true);

    if (!set) {
      showPicker(view);
      const g = pickerGreeting(view);
      say(g.text, { mood: g.mood, speak: !S.greetedPuzzles });
      S.greetedPuzzles = true;
      return;
    }
    // new sets marked «Новое!» wait above the grid (single-set data only has the grid): no jump to the next tile then
    showSet(view, set, { scroll: true });
    if (opts.celebrate) {
      later(function () { celebrateSet(view, set); }, 350);
      return;
    }
    const g = puzzlesGreeting(sets, set, all, !!stored, news);
    say(g.text, { mood: g.mood, speak: !S.greetedPuzzles });
    S.greetedPuzzles = true;
  }

  /* the picker: the regular sets first, the endless trainer last (it spans the rest of the last row) */
  function showPicker(view) {
    view.set = null;
    const body = view.el.querySelector('.lr-puz-body');
    if (!body) return;
    const regular = view.sets.filter(function (s) { return !s.endless; });
    const endless = view.sets.filter(function (s) { return s.endless; });
    const order = regular.concat(endless);
    const sug = suggestedSet(view);
    body.innerHTML = '<nav class="lr-picker" aria-label="Наборы задачек" style="--n:' + regular.length + '">' +
      order.map(function (s) { return setCardHtml(s, view.sets.indexOf(s), view, s === sug); }).join('') + '</nav>';
    const picker = body.querySelector('.lr-picker');
    picker.querySelectorAll('.lr-set-card').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (view.ep !== S.epoch) return;
        const s = findSet(view.sets, btn.getAttribute('data-set'));
        if (!s) return;
        snd('click');
        if (s.endless) { openTrainer(s.id); return; }
        showSet(view, s, { scroll: true, top: true });
        tell(setIntro(s), 'happy');
      });
    });
    let lastW = -1;
    const fit = function () {
      if (view.ep !== S.epoch || view.set) return;
      const W = picker.clientWidth;
      if (!W || W === lastW) return;
      lastW = W;
      layoutPicker(picker, W, regular.length);
    };
    fit();
    observeResize(picker, fit);
  }

  /* columns by width; an endless card fills the rest of the last row (or a whole row) */
  function layoutPicker(picker, W, nRegular) {
    const cols = W >= 900 ? 4 : W >= 560 ? 3 : 2;
    picker.style.setProperty('--cols', String(cols));
    const rest = nRegular % cols;
    const span = rest ? cols - rest : cols;
    picker.querySelectorAll('.lr-set-card.is-endless').forEach(function (c) {
      c.style.gridColumn = 'span ' + span;
      c.classList.toggle('is-wide', span >= 2);
    });
  }

  /* o.scroll: bring the next unsolved tile into view; o.top: came from the picker — start at the top */
  function showSet(view, set, o) {
    view.set = set;
    storeSetId(set.id);
    view.stored = set.id;
    const body = view.el.querySelector('.lr-puz-body');
    if (!body) return;
    body.innerHTML = (view.single ? '' :
        '<div class="lr-set-nav"><button type="button" class="btn btn-ghost lr-to-picker">← Все задачки</button></div>') +
      '<section class="lr-set-panel" data-set="' + esc(set.id) + '" style="' + colorVars(set.color, view.sets.indexOf(set)) + '">' +
        panelHtml(set, view.news, view.vet3) + '</section>';
    const back = body.querySelector('.lr-to-picker');
    if (back) {
      back.addEventListener('click', function () {
        if (view.ep !== S.epoch) return;
        snd('click');
        showPicker(view);
        safe(function () { global.scrollTo(0, 0); });
        tell('Выбирай набор задачек!', 'happy', false);
      });
    }
    body.querySelectorAll('.lr-tile').forEach(function (t) {
      t.addEventListener('click', function () {
        snd('click');
        openPuzzle(num(t.getAttribute('data-i'), 0), set.id);
      });
    });
    if (o && o.top) safe(function () { global.scrollTo(0, 0); });
    const nextIdx = set.puzzles.findIndex(function (pz, i) { return !puzzleStars(pz, i); });
    if (nextIdx > 3 && o && o.scroll) later(function () { scrollToTile(view, nextIdx); }, 450);
  }

  function scrollToTile(view, i) {
    const tile = view.el.querySelector('.lr-tile[data-i="' + i + '"]');
    if (tile && tile.getBoundingClientRect().bottom > (global.innerHeight || 800)) {
      safe(function () { tile.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    }
  }

  /*
   * The first visit of a returning v1 child to the puzzles screen with sets: name the new sets and the new
   * «Мат в 1 ход» puzzles (content v2). → text | ''
   */
  function newsGreeting(sets, name, seenSets, news) {
    if (seenSets || !news || sets.length < 2) return '';
    const fresh = sets.filter(function (s) { return s.id !== 'mate1' && !isV3(s) && !s.endless && isFreshSet(s, news); });
    const m1 = findSet(sets, 'mate1');
    const n = m1 ? unseenAddedMate1(m1).length : 0;
    const m1Title = '«' + (m1 ? m1.title : SET_DEFAULTS.mate1.title) + '»';
    if (fresh.length) {
      return 'Смотри, ' + name + ', появились новые задачки: ' +
        joinAnd(fresh.map(function (s) { return '«' + s.title + '»'; })) + '!' +
        (n ? ' И ещё ' + n + ' ' + plural(n, 'новая задачка', 'новые задачки', 'новых задачек') + ' ' + m1Title + '.' : '') +
        ' Нажми и попробуй!';
    }
    if (!n) return '';
    if (n === 1) return 'Смотри, ' + name + ', появилась новая задачка ' + m1Title + '! Она ждёт тебя в конце списка.';
    return 'Смотри, ' + name + ', появились новые задачки ' + m1Title + ' — целых ' + n + '! Они ждут тебя в конце списка.';
  }

  /* content v3 news for a returning child (see veteran3): the new sets, and the new puzzles in the older sets */
  function newsV3Greeting(sets, name, vet3) {
    if (!vet3) return '';
    const fresh = sets.filter(function (s) { return isV3(s) && isNewSet(s, vet3); });
    let added = 0;
    sets.forEach(function (s) {
      const a = addedV3(s);
      if (a.length) added += a.length - countSolved(a).solved;
    });
    const more = added ? ' И ещё ' + added + ' ' + plural(added, 'новая задачка', 'новые задачки', 'новых задачек') +
      ' в старых наборах!' : '';
    if (fresh.length) {
      return 'Смотри, ' + name + ', сколько нового! ' + joinAnd(fresh.map(function (s) { return '«' + s.title + '»'; })) +
        (fresh.length > 1 ? ' ждут тебя.' : ' ждёт тебя.') + more;
    }
    if (!added) return '';
    return 'Смотри, ' + name + '! В наборах ' + plural(added, 'появилась', 'появились', 'появилось') + ' ' + added + ' ' +
      plural(added, 'новая задачка', 'новые задачки', 'новых задачек') + '. Они с наклейкой «Новое!».';
  }

  /* what the mascot says on the picker */
  function pickerGreeting(view) {
    const name = childName();
    const all = countSolved(allPuzzles());
    if (all.solved === 0) {
      const first = view.sets.find(function (s) { return !s.endless; }) || view.sets[0];
      return { text: 'Задачки — это загадки, ' + name + '! Нажми на набор. Начни с задачек «' + first.title + '»!', mood: 'happy' };
    }
    const n3 = newsV3Greeting(view.sets, name, view.vet3);
    if (n3) return { text: n3, mood: 'wow' };
    const n2 = newsGreeting(view.sets, name, !!view.stored, view.news);
    if (n2) return { text: n2, mood: 'wow' };
    const open = finiteSets().filter(function (s) { const c = countSolved(s.puzzles); return c.solved < c.total; });
    const tr = trainerSet(view.sets);
    if (!open.length) {
      return {
        text: 'Ты решил все задачки, ' + name + '! Ты — настоящий мастер!' + (tr ? ' А в тренажёре задачки не кончаются никогда!' : ''),
        mood: 'wow'
      };
    }
    return { text: 'Выбирай набор задачек, ' + name + '! ' + (tr ? 'А в тренажёре можно решать задачки без конца.' : ''), mood: 'happy' };
  }

  /* seenSets: the puzzles screen with sets was opened before; news: a returning v1 child (see renderPuzzles) */
  function puzzlesGreeting(sets, set, all, seenSets, news) {
    const name = childName();
    const c = countSolved(set.puzzles);
    if (all.total && all.solved >= all.total) {
      return { text: 'Ты решил все задачки! Ты — настоящий мастер! Можно решить их ещё раз.', mood: 'wow' };
    }
    if (all.solved === 0) {
      return { text: 'Задачки — это загадки, ' + name + '! ' + (KIND_INTRO[setKind(set)] || '') + ' Начнём с первой?', mood: 'happy' };
    }
    const news1 = newsGreeting(sets, name, seenSets, news);
    if (news1) return { text: news1, mood: 'wow' };
    if (c.total && c.solved >= c.total) {
      return {
        text: 'Здесь всё решено! ' + (sets.length > 1 ? 'Выбери другие задачки — или реши эти ещё раз.' : 'Можно решить задачки ещё раз.'),
        mood: 'wow'
      };
    }
    if (c.solved === 0) return { text: setIntro(set) + ' Начнём с первой?', mood: 'happy' };
    return { text: 'Решено ' + c.solved + ' из ' + c.total + '! Выбирай следующую задачку.', mood: 'happy' };
  }

  /* after «➜ Следующая» on the last puzzle of a set */
  function celebrateSet(view, set) {
    const c = countSolved(set.puzzles);
    const done = c.total > 0 && c.solved >= c.total;
    const others = view.sets.filter(function (s) {
      if (s === set || s.endless) return false;
      const x = countSolved(s.puzzles);
      return x.solved < x.total;
    });
    if (done) {
      fx('fireworks', 2600);
      snd('win');
      say('Ура! Ты решил все задачки «' + set.title + '»! ' +
        (others.length ? 'Попробуй задачки «' + others[0].title + '»!' : (KIND_MASTER[setKind(set)] || '')), { mood: 'wow' });
    } else {
      fx('confetti');
      snd('levelComplete');
      say('Это была последняя задачка! Решено ' + c.solved + ' из ' + c.total + '. Нерешённые задачки ждут тебя!', { mood: 'happy' });
      const j = set.puzzles.findIndex(function (pz, i) { return !puzzleStars(pz, i); });
      if (j >= 0) later(function () { scrollToTile(view, j); }, 500);
    }
  }

  /* ============================================================================================ puzzle screen */

  const KIND_VOICE = {
    mate1: 'Мат — это когда на короля напали, а убежать, закрыться или съесть того, кто напал, нельзя.',
    mate2: 'Сначала сделай хитрый ход. Соперник ответит, а потом ты поставишь мат!',
    mate3: 'Здесь три твоих хода. После каждого соперник ответит. Загоняй короля, пока ему некуда будет деться!',
    win: 'Найди ход, после которого соперник обязательно потеряет фигуру!',
    save: 'Сначала посмотри на красную стрелку — это угроза соперника. Потом найди ход, который её отобьёт!',
    endgame: 'Соперник будет отвечать на каждый твой ход. Прижимай короля к краю доски — там ему можно поставить мат!'
  };

  function endgameGoal(pz) { return pz && pz.goal === 'promote' ? 'promote' : 'mate'; }

  function puzzleTaskText(pz, pkind) {
    if (pz.text) return String(pz.text);
    if (pkind === 'endgame' && endgameGoal(pz) === 'promote') return 'Проведи пешку в ферзи!';
    return KIND_TASK[pkind] || KIND_TASK.mate1;
  }

  /* idx: 0-based index in the set (or a puzzle id like 'm2-3'); setId: default = «Мат в 1 ход» */
  function openPuzzle(idx, setId) {
    const sets = puzzleSets();
    if (!sets.length) { renderPuzzles(); return; }
    let set = findSet(sets, setId);
    if (typeof idx === 'string' && !/^\s*\d+\s*$/.test(idx)) {
      let found = null;
      (set ? [set] : sets).forEach(function (s) {
        if (found) return;
        const j = s.puzzles.findIndex(function (p) { return String(p.id) === idx; });
        if (j >= 0) found = { set: s, idx: j };
      });
      if (!found) { renderPuzzles({ set: set ? set.id : undefined }); return; }
      set = found.set;
      idx = found.idx;
    }
    if (!set) set = mainSet(sets);
    const list = set.puzzles;
    idx = ((Math.floor(num(idx, 0)) % list.length) + list.length) % list.length;
    const pz = list[idx];
    const pkind = puzzleKind(pz, set);
    const trainer = !!set.endless;
    const el = enter('puzzle');
    installArt();
    storeSetId(set.id);
    if (trainer) trainerState().last = String(pz.id);
    const d = clamp(Math.round(num(pz.difficulty, 1)), 1, 3);
    const text = puzzleTaskText(pz, pkind);
    const ctx = {
      ep: S.epoch, idx: idx, pz: pz, set: set, list: list, pkind: pkind, kind: 'puzzle', text: text, trainer: trainer,
      root: null, busy: false, done: false, step: 1, reply: null, openedAt: now()
    };
    S.puzzle = ctx;
    S.lastPuzzle = { idx: idx, set: set.id };
    const title = 'Задачка ' + (idx + 1) + ' · ' + (pz.title || set.title);
    const color = d === 1 ? '#2ecc71' : d === 2 ? '#6c63ff' : '#ff6fae';

    el.innerHTML =
      '<div class="lr-play lr-kind-puzzle lr-pk-' + pkind + (trainer ? ' lr-trainer' : '') + '" style="' + colorVars(color, 0) + '">' +
        '<header class="screen-header lr-head">' +
          '<button type="button" class="btn btn-ghost lr-back">← Задачки</button>' +
          '<h2 class="lr-head-title"><span class="lr-head-icon"><span class="lr-emoji">' + esc(set.emoji) + '</span></span>' +
            '<span class="lr-head-name">' + esc(title) + '</span></h2>' +
          '<div class="lr-head-extra">' + diffHtml(d) + '</div>' +
        '</header>' +
        '<div class="lr-body">' +
          '<div class="card lr-task">' +
            '<div class="lr-task-main">' +
              '<span class="lr-task-badge">' + esc(set.title) + '</span>' +
              '<p class="lr-task-text">' + esc(text) + '</p>' +
              (pkind === 'endgame' ? '<p class="lr-eg-mini" aria-hidden="true"></p>' : '') +
            '</div>' +
            '<button type="button" class="btn btn-icon lr-say" aria-label="Послушать задание" title="Послушать">🔊</button>' +
          '</div>' +
          '<div class="lr-mascot"></div>' +
          '<div class="lr-stage"><div class="board-host lr-board"></div></div>' +
          '<div class="panel lr-controls lr-controls-3">' +
            '<div class="lr-meter"></div>' +
            '<button type="button" class="btn btn-yellow btn-big lr-hint">💡 Подсказка</button>' +
            '<button type="button" class="btn btn-secondary btn-big lr-restart">↻ Заново</button>' +
            '<button type="button" class="btn btn-green btn-big lr-next">' + (trainer ? 'Ещё задачка ➜' : '➜ Следующая') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    ctx.root = el.querySelector('.lr-play');
    ctx.host = el.querySelector('.lr-board');

    el.querySelector('.lr-back').addEventListener('click', function () {
      if (tooSoon(ctx)) return;
      snd('click');
      renderPuzzles(trainer ? {} : { set: set.id });
    });
    el.querySelector('.lr-say').addEventListener('click', function () { speakNow(text); });
    el.querySelector('.lr-hint').addEventListener('click', function () { if (!tooSoon(ctx)) puzzleHint(ctx); });
    el.querySelector('.lr-restart').addEventListener('click', function () { if (!tooSoon(ctx)) restartPuzzle(ctx); });
    el.querySelector('.lr-next').addEventListener('click', function () {
      if (tooSoon(ctx)) return;
      snd('click');
      nextPuzzle(ctx, false);
    });

    S.mascot = makeMascot(el.querySelector('.lr-mascot'));
    S.view = makeBoard(ctx.host, {
      orientation: 'w',
      interactive: true,
      canSelect: function (sq) {
        if (!alive(ctx) || ctx.busy || ctx.done || ctx.over || !ctx.chess) return false;
        const p = getP(ctx.chess, sq);
        return !!p && (p & 24) === ctx.chess.turn;
      },
      getMoves: function (sq) {
        if (!alive(ctx) || ctx.busy || ctx.done || ctx.over || !ctx.chess) return [];
        return legalMoves(ctx.chess, sq);
      },
      onMove: function (mv) {
        puzzleMove(ctx, mv).catch(function (e) { warn(e); if (alive(ctx) && !ctx.done) ctx.busy = false; });
      },
      onIllegal: function (from, to) { puzzleIllegal(ctx, from, to, true); },
      onSquareClick: function (sq) {
        if (!alive(ctx) || ctx.busy || ctx.done || ctx.over || !ctx.chess) return;
        sq = toSq(sq);
        if (onBoard(sq)) playSquareClick(ctx.chess, sq);
      }
    });
    if (!S.view) {
      emptyState(el.querySelector('.lr-stage'), 'Доска не загрузилась. Попробуй обновить страницу!');
      return;
    }
    if (!setupPuzzle(ctx)) {
      say('Ой! Эта задачка не открылась. Выбери другую.', { mood: 'sad' });
      return;
    }
    if (pkind === 'save' && ctx.threat) {
      say(ctx.threat.text, { mood: 'warn' });
    } else if (pkind === 'endgame') {
      // the task card already shows the (long) text: the bubble gets a short line, the voice reads the whole task
      say(endgameStartLine(ctx), { mood: 'happy', speak: false });
      voiceSay(text);
    } else if (trainer) {
      const t = trainerState();
      say(t.streak >= 2 ? text + ' Серия: ' + t.streak + ' подряд!' : text, { mood: 'happy' });
    } else {
      say(text, { mood: 'happy' });
    }
    if (!trainer && idx === 0 && kindProgress(pkind).solved === 0 && KIND_VOICE[pkind]) {
      voiceSay(KIND_VOICE[pkind], { interrupt: false });
    }
  }

  function setupPuzzle(ctx) {
    const C = CH();
    if (!C) return false;
    const chess = safe(function () { return new C(ctx.pz.fen); }, null);
    if (!chess || chess.loadError) return false;
    // the trainer's streak grows only for a puzzle solved cleanly: a hint or a mistake before «↻ Заново» still counts
    if (ctx.trainer) {
      ctx.hintEver = !!(ctx.hintEver || ctx.hintUsed);
      ctx.missEver = !!(ctx.missEver || ctx.mistakes > 0);
    }
    ctx.chess = chess;
    ctx.step = 1;
    ctx.reply = null;
    ctx.hintStep = 0;
    ctx.hintUsed = false;
    ctx.mistakes = 0;
    ctx.done = false;
    ctx.over = false;          // an endgame that was lost (the board stays until «↻ Заново»)
    ctx.busy = false;
    ctx.thinking = false;      // endgame: Black is thinking
    ctx.moves = 0;             // endgame: White moves made
    ctx.hintMove = null;       // endgame: the engine hint for a position {fen, move}
    ctx.hintWait = null;
    ctx.gen = (ctx.gen | 0) + 1;   // a new attempt: moves / replies still running from the old one must not land
    ctx.pendingHint = false;
    if (ctx.pkind === 'endgame') {
      ctx.goalKind = endgameGoal(ctx.pz);
      ctx.maxMoves = Math.max(1, Math.floor(num(ctx.pz.maxMoves, 30)));
      ctx.par = clamp(Math.floor(num(ctx.pz.par, ctx.maxMoves)), 1, ctx.maxMoves);
      ctx.officers = officers(chess);
    }
    ctx.threat = ctx.pkind === 'save' ? threatInfo(ctx.pz, chess) : null;
    V('setInteractive', true);
    V('deselect');
    V('clearArrows');
    V('clearPulses');
    V('clearStars');
    V('setDanger', []);
    V('clearLastMove');
    V('setPosition', chess, {});
    refreshCheck(chess);
    restorePuzzleMarks(ctx);
    updatePuzzleMeter(ctx);
    return true;
  }

  /* marks that belong to the position itself: the threat of a «Спасайся!» puzzle */
  function restorePuzzleMarks(ctx) {
    const th = ctx.threat;
    if (!th || ctx.done || ctx.step !== 1) return;
    V('showArrow', th.from, th.to, { kind: 'danger' });
    if (th.scared >= 0) V('setDanger', [th.scared]);
  }

  function restartPuzzle(ctx) {
    if (!alive(ctx)) return;
    closeModal();
    clearTimers();
    snd('whoosh');
    attention(ctx, '.lr-restart', false);
    attention(ctx, '.lr-hint', false);
    if (setupPuzzle(ctx)) {
      say('Начнём сначала! ' + (ctx.threat ? ctx.threat.text : ctx.pkind === 'endgame' ? endgameStartLine(ctx) : ctx.text),
        { mood: 'happy', speak: false });
    }
  }

  /* the mascot's short line when an endgame starts (a long bubble would run below the fold on a landscape iPad) */
  function endgameStartLine(ctx) {
    return ctx.goalKind === 'promote' ? 'Твой ход! Веди пешку в ферзи.' : 'Твой ход! Прижимай короля к краю.';
  }

  /* «➜ Следующая»: the next puzzle of the same set; after the last one — a celebration on the grid.
     preferUnsolved (the result modal): the next one that is not solved yet, if there is one. The trainer: another one */
  function nextPuzzle(ctx, preferUnsolved) {
    if (ctx.trainer) { openTrainer(ctx.set.id); return; }
    const list = ctx.list, n = list.length;
    if (preferUnsolved) {
      for (let k = 1; k < n; k++) {
        const j = (ctx.idx + k) % n;
        if (!puzzleStars(list[j], j)) { openPuzzle(j, ctx.set.id); return; }
      }
    }
    if (ctx.idx + 1 < n) openPuzzle(ctx.idx + 1, ctx.set.id);
    else renderPuzzles({ set: ctx.set.id, celebrate: true });
  }

  function replyOf(pz) { return pz && pz.reply ? pz.reply : null; }

  function mateN(ctx) { return MATE_N[ctx.pkind] || 1; }

  /* moves still needed to mate, counting the child's current one */
  function remainingOf(ctx) { return Math.max(1, mateN(ctx) - ctx.step + 1); }

  function totalSteps(ctx) {
    if (MATE_N[ctx.pkind] > 1) return MATE_N[ctx.pkind];
    if (ctx.pkind === 'win' && replyOf(ctx.pz)) return 2;
    return 1;
  }

  function updatePuzzleMeter(ctx) {
    const box = ctx.root && ctx.root.querySelector('.lr-meter');
    if (!box) return;
    if (ctx.pkind === 'endgame') {
      box.innerHTML = endgameMeterHtml(ctx);
      // the stacked (portrait) layout has the meter below the board: a short status line above it, in the task card
      const mini = ctx.root.querySelector('.lr-eg-mini');
      if (mini) {
        const max = ctx.maxMoves, cur = ctx.done || ctx.over ? ctx.moves : Math.min(ctx.moves + 1, max);
        // the «думает…» line is always there (hidden when idle): the card and the board below it never jump
        mini.innerHTML = '<b>Ход ' + cur + ' из ' + max + '</b>' +
          '<span class="lr-eg-mini-think' + (ctx.thinking ? ' on' : '') + '">🤔 Соперник думает…</span>';
      }
      return;
    }
    const s = puzzleStars(ctx.pz, ctx.idx);
    const steps = totalSteps(ctx);
    let stepsHtml = '';
    if (steps > 1) {
      const cur = ctx.done ? steps + 1 : ctx.step;
      let dots = '';
      for (let i = 1; i <= steps; i++) dots += '<i class="' + (i < cur ? 'done' : i === cur ? 'on' : '') + '"></i>';
      stepsHtml = '<div class="lr-steps">' + dots + '<span>' + (ctx.done ? 'Готово!' : 'Ход ' + ctx.step + ' из ' + steps) + '</span></div>';
    }
    if (ctx.trainer) {
      const t = trainerState();
      const c = countSolved(ctx.list);
      box.innerHTML =
        '<div class="lr-goal"><span>' + esc(ctx.set.emoji) + '</span> ' + esc(ctx.set.title) + '</div>' +
        stepsHtml +
        '<div class="lr-tr-line"><span class="lr-tr-streak' + (t.streak >= 5 ? ' hot' : '') + '">🔥 Серия: <b>' + t.streak + '</b></span>' +
          '<span class="lr-tr-best">🏅 Рекорд: <b>' + t.best + '</b></span></div>' +
        '<div class="lr-tr-count">Решено <b>' + c.solved + '</b> из ' + c.total + '</div>' +
        '<p class="lr-meter-note">' + (s ? 'Эта задачка уже решена!' : 'За новую задачку — звёздочка ⭐') + '</p>';
      return;
    }
    box.innerHTML =
      '<div class="lr-goal"><span>' + esc(ctx.set.emoji) + '</span> ' + esc(ctx.set.title) + '</div>' +
      stepsHtml +
      '<div class="lr-best"><span>Рекорд:</span>' + ratingHtml(s, 2) + '</div>' +
      '<p class="lr-meter-note">' + (s ? 'Эта задачка уже решена!' : 'Без подсказки — 2 звезды') + '</p>';
  }

  function endgameMeterHtml(ctx) {
    const s = puzzleStars(ctx.pz, ctx.idx);
    const max = ctx.maxMoves;
    const finished = ctx.done || ctx.over;
    const cur = finished ? ctx.moves : Math.min(ctx.moves + 1, max);
    const left = max - ctx.moves;
    const pct = Math.round(Math.min(ctx.moves, max) * 100 / max);
    const parPct = Math.round(ctx.par * 100 / max);
    const goal = ctx.goalKind === 'promote' ? '<span>👑</span> Цель: пешка — в ферзи' : '<span>🎯</span> Цель: мат';
    return '<div class="lr-goal">' + goal + '</div>' +
      '<div class="lr-eg-count' + (!finished && left <= 5 ? ' warn' : '') + '" aria-label="Ход ' + cur + ' из ' + max + '">Ход <b>' + cur + '</b> из ' + max + '</div>' +
      '<div class="lr-eg-bar" aria-hidden="true"><i style="width:' + pct + '%"></i><em style="left:' + parPct + '%">⭐</em></div>' +
      '<div class="lr-eg-think' + (ctx.thinking ? ' on' : '') + '" aria-live="polite">' + (ctx.thinking ? '🤔 Соперник думает<span class="lr-dots3"><i>.</i><i>.</i><i>.</i></span>' : '&nbsp;') + '</div>' +
      '<div class="lr-best"><span>Рекорд:</span>' + ratingHtml(s, 2) + '</div>' +
      '<p class="lr-meter-note">2 звезды — если справишься за ' + movesWord(ctx.par) + ' без подсказки</p>';
  }

  function puzzleIllegal(ctx, from, to, fromBoard) {
    if (!alive(ctx) || ctx.busy || ctx.done || ctx.over || !ctx.chess) return;
    from = toSq(from);
    to = toSq(to);
    if (!onBoard(from) || !getP(ctx.chess, from)) return;
    if (!fromBoard) {
      V('shakePiece', from);
      snd('illegal');
    }
    tell(explainIllegal(ctx.chess, from, to, 'game'), 'warn');
  }

  function mateLine(m) {
    const F = FLAG();
    if (m.promotion) return 'Пешка превратилась в ' + nameOf(m.promotion & 7).acc + ' и поставила мат!';
    if ((m.flags | 0) & F.CASTLE) return 'Мат рокировкой — вот это да!';
    return 'Ты поставил мат ' + nameOf(m.piece & 7).ins + '!';
  }

  /* ---------------------------------------------------------------------------------------- puzzle logic helpers */

  /* the legal move (from `legal`) that x means: UCI string / {from, to, promotion} / engine move → plain move | null */
  function pickLegal(legal, x) {
    const n = anyMove(x);
    if (!n) return null;
    const cands = legal.filter(function (y) { return y.from === n.from && y.to === n.to; });
    if (!cands.length) return null;
    const want = n.promotion || QUEEN;
    const y = cands.find(function (c) { return !c.promotion || (c.promotion & 7) === want; }) || cands[0];
    return { from: y.from, to: y.to, promotion: y.promotion ? (y.promotion & 7) : 0, piece: y.piece, captured: y.captured };
  }

  /* mate in 2: does EVERY black answer leave a mate in 1? (own check, used when Lessons.isMate2Move is missing) */
  function everyReplyMates(after) {
    const replies = legalMoves(after);
    if (!replies.length) return isMate(after);
    const scratch = safe(function () { return after.clone(); }, null);
    if (!scratch) return false;
    for (let i = 0; i < replies.length; i++) {
      const r = replies[i];
      const made = safe(function () { return scratch.move({ from: r.from, to: r.to, promotion: r.promotion || undefined }); }, null);
      if (!made) continue;
      const mates = safe(function () { return scratch.mateInOne(); }, []) || [];
      safe(function () { scratch.undo(); });
      if (!mates.length) return false;
    }
    return true;
  }

  /* is the child's first move in a mate-in-2 puzzle a right one? (before/after = positions around the move) */
  function mate2Ok(before, m, after) {
    if (isMate(after)) return true;
    if (!legalMoves(after).length) return false;   // stalemate is a draw, not a mate
    const L = lessonsLib();
    if (L && typeof L.isMate2Move === 'function') {
      const r = safe(function () {
        return L.isMate2Move(before.clone(), { from: m.from, to: m.to, promotion: m.promotion ? (m.promotion & 7) : 0 });
      }, null);
      if (r !== null && r !== undefined) return !!r;
    }
    return everyReplyMates(after);
  }

  /*
   * Own forced-mate search (only when Lessons.isMateInMove / mateInN are missing; small boards): does the side to
   * move force mate in ≤ n? budget.left counts positions; when it runs out the answer is «yes» (lenient).
   */
  function forcesMateLocal(chess, n, budget) {
    if (--budget.left < 0) return true;
    const ms = legalMoves(chess);
    for (let i = 0; i < ms.length; i++) {
      const x = ms[i];
      const made = safe(function () { return chess.move({ from: x.from, to: x.to, promotion: x.promotion || undefined }); }, null);
      if (!made) continue;
      let ok;
      if (isMate(chess)) ok = true;
      else if (n <= 1) ok = false;
      else ok = repliesAllForce(chess, n - 1, budget);
      safe(function () { chess.undo(); });
      if (ok) return true;
    }
    return false;
  }

  function repliesAllForce(chess, n, budget) {
    const rs = legalMoves(chess);
    if (!rs.length) return isMate(chess);
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      const made = safe(function () { return chess.move({ from: r.from, to: r.to, promotion: r.promotion || undefined }); }, null);
      if (!made) continue;
      const ok = forcesMateLocal(chess, n, budget);
      safe(function () { chess.undo(); });
      if (!ok) return false;
    }
    return true;
  }

  /* White's move m (before → after) in a mate in n: mates now, or every reply leaves a forced mate in n − 1 */
  function mateInMoveOk(before, m, after, n) {
    if (isMate(after)) return true;
    if (n <= 1 || !legalMoves(after).length) return false;
    const L = lessonsLib();
    if (L && typeof L.isMateInMove === 'function') {
      const r = safe(function () {
        return L.isMateInMove(before.clone(), { from: m.from, to: m.to, promotion: m.promotion ? (m.promotion & 7) : 0 }, n);
      }, null);
      if (r !== null && r !== undefined) return !!r;
    }
    if (n === 2) return mate2Ok(before, m, after);
    const scratch = safe(function () { return after.clone(); }, null);
    return scratch ? repliesAllForce(scratch, n - 1, { left: 60000 }) : true;
  }

  /* moves of the side to move that force mate in ≤ n, the quickest first (Lessons.mateInN; own search as a fallback) */
  function mateMoves(chess, n) {
    if (n <= 1) return safe(function () { return chess.mateInOne(); }, []) || [];
    const L = lessonsLib();
    if (L && typeof L.mateInN === 'function') {
      const r = safe(function () { return L.mateInN(chess.clone(), n); }, null);
      if (Array.isArray(r)) {
        return r.filter(Boolean).slice().sort(function (a, b) { return num(a.mateIn, n) - num(b.mateIn, n); });
      }
    }
    return legalMoves(chess).filter(function (x) {
      const before = safe(function () { return chess.clone(); }, null);
      const after = safe(function () { return chess.clone(); }, null);
      if (!before || !after) return false;
      const made = safe(function () { return after.move({ from: x.from, to: x.to, promotion: x.promotion || undefined }); }, null);
      return !!made && mateInMoveOk(before, made, after, n);
    });
  }

  /* after a wrong first move: a black answer that escapes the mate (a king move preferred) | null */
  function escapeReply(after) {
    return escapeReplyN(after, 1);
  }

  /* after a wrong move with n moves left for White afterwards: a reply leaving White no mate in ≤ n (king move first) */
  function escapeReplyN(after, n) {
    const replies = legalMoves(after);
    const scratch = safe(function () { return after.clone(); }, null);
    if (!scratch) return null;
    let best = null, bestRank = -1;
    for (let i = 0; i < replies.length && bestRank < 2; i++) {
      const r = replies[i];
      const made = safe(function () { return scratch.move({ from: r.from, to: r.to, promotion: r.promotion || undefined }); }, null);
      if (!made) continue;
      const mates = mateMoves(scratch, n).length;
      safe(function () { scratch.undo(); });
      if (mates) continue;
      const rank = (r.piece & 7) === KING ? 2 : r.captured ? 1 : 0;
      if (rank > bestRank) { best = r; bestRank = rank; }
    }
    return best;
  }

  /* Black's answer in a mate-in-2 puzzle: Lessons.bestDefense, or the reply leaving White the fewest mates */
  function blackDefense(chess) {
    const legal = legalMoves(chess);
    if (!legal.length) return null;
    const L = lessonsLib();
    if (L && typeof L.bestDefense === 'function') {
      const hit = pickLegal(legal, safe(function () { return L.bestDefense(chess.clone()); }, null));
      if (hit) return hit;
    }
    const scratch = safe(function () { return chess.clone(); }, null);
    let best = legal[0], bestN = Infinity;
    if (scratch) {
      legal.forEach(function (r) {
        const made = safe(function () { return scratch.move({ from: r.from, to: r.to, promotion: r.promotion || undefined }); }, null);
        if (!made) return;
        const n = (safe(function () { return scratch.mateInOne(); }, []) || []).length;
        safe(function () { scratch.undo(); });
        if (n < bestN) { bestN = n; best = r; }
      });
    }
    return pickLegal(legal, best);
  }

  /* Black's answer when White still has n moves to mate (counting the one just made): Lessons.bestDefenseN */
  function defenseN(chess, n) {
    const legal = legalMoves(chess);
    if (!legal.length) return null;
    const L = lessonsLib();
    if (L && typeof L.bestDefenseN === 'function') {
      const hit = pickLegal(legal, safe(function () { return L.bestDefenseN(chess.clone(), n); }, null));
      if (hit) return hit;
    }
    if (n <= 2) return blackDefense(chess);
    const scratch = safe(function () { return chess.clone(); }, null);
    let best = legal[0], bestN = Infinity;
    if (scratch) {
      legal.forEach(function (r) {
        const made = safe(function () { return scratch.move({ from: r.from, to: r.to, promotion: r.promotion || undefined }); }, null);
        if (!made) return;
        const k = mateMoves(scratch, n - 1).length;
        safe(function () { scratch.undo(); });
        if (k < bestN) { bestN = k; best = r; }
      });
    }
    return pickLegal(legal, best);
  }

  /* a right first move for a mate-in-2 puzzle (for the hint when p.hint is missing or unusable) */
  function findMate2Move(chess) {
    const legal = legalMoves(chess);
    for (let i = 0; i < legal.length; i++) {
      const x = legal[i];
      const before = safe(function () { return chess.clone(); }, null);
      const after = safe(function () { return chess.clone(); }, null);
      if (!before || !after) return null;
      const made = safe(function () { return after.move({ from: x.from, to: x.to, promotion: x.promotion || undefined }); }, null);
      if (made && mate2Ok(before, made, after)) return { from: x.from, to: x.to, promotion: x.promotion ? (x.promotion & 7) : 0 };
    }
    return null;
  }

  /* a move that keeps the forced mate with n moves left (the quickest), for hints */
  function mateHintMove(chess, n) {
    const ms = mateMoves(chess, n);
    if (ms.length) return normMove(ms[0]);
    return n === 2 ? findMate2Move(chess) : null;
  }

  function solutionsOf(pz) {
    if (Array.isArray(pz.solutions)) return pz.solutions.filter(Boolean);
    return pz.solution ? [pz.solution] : [];
  }

  /* first move of a «win a piece» puzzle / a 'solution' task: one of the listed solutions (UCI, promotion included) */
  function isSolution(pz, m) {
    const sols = solutionsOf(pz);
    if (!sols.length) return true;
    const promo = m.promotion ? (m.promotion & 7) : 0;
    return sols.some(function (s) {
      const n = anyMove(s);
      if (!n || n.from !== m.from || n.to !== m.to) return false;
      return n.promotion ? n.promotion === promo : (!promo || promo === QUEEN);
    });
  }

  function finishMin(pz) {
    const v = num(pz && pz.finish && pz.finish.minValue, 300);
    return v > 0 ? v : 300;
  }

  /* the best finishing move of a «win a piece» puzzle: a mate, else the most valuable capture (cheapest taker) */
  function bestFinish(ctx) {
    const chess = ctx.chess;
    const mates = safe(function () { return chess.mateInOne(); }, []) || [];
    if (mates.length) return normMove(mates[0]);
    const minV = finishMin(ctx.pz);
    const caps = legalMoves(chess).filter(function (x) { return x.captured; }).sort(function (a, b) {
      return valueOf(b.captured) - valueOf(a.captured) || rankOf(a.piece) - rankOf(b.piece);
    });
    const pick = caps.find(function (x) { return valueOf(x.captured) >= minV; }) || caps[0];
    return pick ? { from: pick.from, to: pick.to, promotion: pick.promotion ? (pick.promotion & 7) : 0 } : null;
  }

  /* a copy of the position with the other side to move (to look at the opponent's threat) | null */
  function withTurn(chess, color) {
    const C = CH();
    if (!C) return null;
    return safe(function () {
      const f = String(chess.fen()).split(/\s+/);
      f[1] = color === BLACK ? 'b' : 'w';
      f[3] = '-';
      const c = new C(f.join(' '));
      return c.turn === color ? c : null;
    }, null);
  }

  /*
   * «Спасайся!»: what Black threatens on the start position (pz.threat = the threatening move) —
   * → { from, to, text, mate, scared } (scared: the square of the white piece in danger, or -1) | null
   */
  function threatInfo(pz, chess) {
    const t = pz && pz.threat ? anyMove(pz.threat) : null;
    if (!t) return null;
    const out = { from: t.from, to: t.to, text: 'Соперник что-то задумал! Смотри на красную стрелку.', mate: false, scared: -1 };
    const victim = getP(chess, t.to);
    if (victim && (victim & 24) === WHITE) out.scared = t.to;
    const c = withTurn(chess, BLACK);
    const mv = c ? safe(function () { return c.move({ from: t.from, to: t.to, promotion: t.promotion || undefined }); }, null) : null;
    if (!mv) return out;
    if (isMate(c)) {
      out.mate = true;
      out.scared = kingSq(chess, WHITE);
      out.text = 'Соперник угрожает поставить мат! Смотри на красную стрелку.';
      return out;
    }
    if (mv.captured) {
      const nm = nameOf(mv.captured & 7);
      out.text = 'Соперник угрожает съесть ' + possAcc(nm) + ' ' + nm.acc + '! Смотри на красную стрелку.';
      return out;
    }
    const ts = forkTargets(c, t.to).filter(function (x) { return (x.piece & 7) === KING || valueOf(x.piece) >= 300; });
    if (ts.length >= 2) out.text = 'Соперник угрожает вилкой! Смотри на красную стрелку.';
    return out;
  }

  /* after a wrong «Спасайся!» move (Black to move): how Black punishes it → { text, marks, sure } */
  function punishment(after, th) {
    const mates = safe(function () { return after.mateInOne(); }, []) || [];
    if (mates.length) {
      return { text: 'Ой! Тогда соперник поставит мат. Смотри на красную стрелку!', marks: [{ from: mates[0].from, to: mates[0].to }], sure: true };
    }
    const legal = legalMoves(after);
    const again = th ? legal.find(function (x) { return x.from === th.from && x.to === th.to; }) : null;
    if (again && again.captured) {
      const nm = nameOf(again.captured & 7);
      return {
        text: 'Ой! Угроза осталась: соперник съест ' + possAcc(nm) + ' ' + nm.acc + '!',
        marks: [{ danger: again.to }, { from: again.from, to: again.to }], sure: true
      };
    }
    const h = threatOn(after, WHITE);
    if (h && valueOf(h.piece) >= 300) {
      const nm = nameOf(h.piece & 7);
      const marks = [{ danger: h.sq }];
      if (onBoard(h.from)) marks.push({ from: h.from, to: h.sq });
      return { text: 'Ой! Тогда соперник съест ' + possAcc(nm) + ' ' + nm.acc + '!', marks: marks, sure: true };
    }
    if (again) return { text: 'Ой! Угроза осталась. Смотри на красную стрелку!', marks: [{ from: again.from, to: again.to }], sure: false };
    return { text: 'Так угрозу не отбить. Попробуй другой ход!', marks: th ? [{ from: th.from, to: th.to }] : [], sure: false };
  }

  function saveWinLine(ctx, m) {
    const th = ctx.threat;
    if (th && m.captured && m.to === th.from) return 'Ам! Ты съел фигуру, которая угрожала!';
    if (th && th.mate) return 'Ты спас короля от мата!';
    if (th && m.from === th.to) {
      const nm = nameOf(m.piece & 7);
      return nm.Nom + (nm.g === 'f' ? ' убежала' : ' убежал') + ' от угрозы!';
    }
    return 'Угроза отбита! Соперник ничего не выиграет.';
  }

  /* white pieces other than the king and pawns (a promoted pawn adds one) */
  function officers(chess) {
    let n = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) continue;
      const p = getP(chess, sq);
      if (p && (p & 24) === WHITE && (p & 7) !== KING && (p & 7) !== PAWN) n++;
    }
    return n;
  }

  /* 'stalemate' | 'repeat' | 'draw' | '' */
  function drawReason(chess) {
    const st = safe(function () { return typeof chess.status === 'function' ? chess.status() : null; }, null);
    if (st && st.over && st.reason !== 'checkmate') {
      if (st.reason === 'stalemate') return 'stalemate';
      if (st.reason === 'threefold') return 'repeat';
      return 'draw';
    }
    if (!st && isStalemate(chess)) return 'stalemate';
    return '';
  }

  /* ---------------------------------------------------------------------------------------- puzzle moves */

  async function puzzleMove(ctx, mv) {
    if (!alive(ctx) || ctx.busy || ctx.done || ctx.over) return;
    const chess = ctx.chess;
    const from = toSq(mv && mv.from), to = toSq(mv && mv.to);
    if (!onBoard(from) || !onBoard(to)) return;
    const promo = toType(mv && mv.promotion) || 0;
    const before = safe(function () { return chess.clone(); }, null);
    if (!before) return;
    let m = null;
    try { m = chess.move({ from: from, to: to, promotion: promo || undefined }); } catch (e) { m = null; }
    if (!m) { puzzleIllegal(ctx, from, to); return; }
    ctx.busy = true;
    V('clearArrows');
    V('clearPulses');
    V('setDanger', []);
    attention(ctx, '.lr-hint', false);
    moveSound(m);
    const gen = ctx.gen;
    await settle(V('applyMove', m, chess), 2600);
    // «↻ Заново» or leaving during the slide: this old move must not count
    if (!alive(ctx) || ctx.gen !== gen) return;
    refreshCheck(chess);
    if (ctx.pkind === 'endgame') { endgameAfterWhite(ctx, m, gen); return; }
    if (isMate(chess)) {
      puzzleSuccess(ctx, m);
      return;
    }
    if (MATE_N[ctx.pkind] > 1) mateStep(ctx, before, m, gen);
    else if (ctx.pkind === 'save') saveMove(ctx, m, gen);
    else if (ctx.pkind === 'win' && ctx.step === 1) winFirst(ctx, m, gen);
    else if (ctx.pkind === 'win') winFinish(ctx, m, gen);
    else mateMiss(ctx, m, gen);
  }

  /* a wrong move: count it, sound, the trainer's streak starts over (said kindly), the explanation */
  function missed(ctx, text) {
    ctx.mistakes++;
    snd('wrong');
    let extra = '';
    if (ctx.trainer && ctx.mistakes === 1) {
      const t = trainerState();
      if (t.streak > 0) {
        t.streak = 0;
        storeTrainer();
        updatePuzzleMeter(ctx);
        extra = ' Серия начнётся заново — не беда!';
      }
    }
    tell(withHintTip(ctx, text + extra), 'think');
  }

  /* take the child's last move back after an explanation (the position before it: the start or Black's answer) */
  function revertPuzzleMove(ctx, m, gen, delay) {
    const chess = ctx.chess;
    later(async function () {
      if (!alive(ctx) || ctx.gen !== gen) return;
      safe(function () { chess.undo(); });
      await settle(V('undoMove', m, chess), 1600);
      if (!alive(ctx) || ctx.gen !== gen) return;
      V('clearPulses');
      V('clearArrows');
      V('setDanger', []);
      if (ctx.reply) V('setLastMove', ctx.reply.from, ctx.reply.to);
      else V('clearLastMove');
      refreshCheck(chess);
      restorePuzzleMarks(ctx);
      ctx.busy = false;
      afterRevert(ctx);
    }, delay);
  }

  /* a mating try that is not mate (mate-in-1 puzzles, the last move of mate in 2 / 3) */
  function mateMiss(ctx, m, gen) {
    // why it isn't mate: stalemate / the king can run (its squares) / the checker can be eaten / the check can be blocked
    const info = notMateInfo(ctx.chess);
    missed(ctx, info.text);
    showMarks(info.marks);
    revertPuzzleMove(ctx, m, gen, info.slow ? 1600 : 1300);
  }

  /* Black answers on the board (not interactive meanwhile).
     → the made move · null when the puzzle was left / restarted · false when the move could not be made */
  async function playBlack(ctx, r, gen) {
    const chess = ctx.chess;
    let mv = null;
    try { mv = chess.move({ from: r.from, to: r.to, promotion: r.promotion || undefined }); } catch (e) { mv = null; }
    if (!mv) return false;
    V('deselect');
    moveSound(mv);
    await settle(V('applyMove', mv, chess), 2600);
    if (!alive(ctx) || ctx.gen !== gen) return null;
    ctx.reply = { from: mv.from, to: mv.to };
    const check = inCheck(chess);
    refreshCheck(chess);
    if (check) snd('check');
    return mv;
  }

  /* the next step begins (Black has answered): the board is the child's again */
  function startNextStep(ctx, text) {
    ctx.step++;
    ctx.hintStep = 0;
    ctx.busy = false;
    updatePuzzleMeter(ctx);
    say(text, { mood: 'wow', speak: false });
    voiceSay(text, { interrupt: false });   // after «Хороший ход!…», not instead of it
    runPendingHint(ctx);
  }

  function replyFailed(ctx) {
    ctx.busy = false;
    ctx.thinking = false;
    attention(ctx, '.lr-restart', true);
    tell('Ой! Что-то пошло не так. Нажми «↻ Заново».', 'sad');
  }

  /*
   * Mate in N (2 or 3), a move that is not mate yet: it must keep a forced mate with the moves left
   * (Lessons.isMateInMove). Right → Black defends (Lessons.bestDefenseN) → the next step; wrong → why + take it back.
   */
  function mateStep(ctx, before, m, gen) {
    const chess = ctx.chess;
    const r = remainingOf(ctx);
    if (r <= 1) { mateMiss(ctx, m, gen); return; }
    if (!mateInMoveOk(before, m, chess, r)) {
      let text = 'Так соперник убежит. Попробуй другой ход!', marks = [], delay = 1500;
      if (!legalMoves(chess).length) {
        const info = notMateInfo(chess, true);   // stalemate (the right move may well be a quiet one)
        text = info.text;
        marks = info.marks;
        delay = 1800;
      } else {
        const run = escapeReplyN(chess, r - 1);
        if (run) {
          marks = [{ from: run.from, to: run.to }];
          delay = 2000;
          if ((run.piece & 7) !== KING) {
            text = run.captured ? 'Так соперник съест ' + nameOf(run.captured & 7).acc + ' и спасётся. Попробуй другой ход!' :
              'Так соперник спасётся. Попробуй другой ход!';
          }
        }
        if (ctx.step === 1 && ctx.pz.fail) text = String(ctx.pz.fail);
      }
      missed(ctx, text);
      showMarks(marks);
      revertPuzzleMove(ctx, m, gen, delay);
      return;
    }
    // a right move: Black answers, then the child goes on
    if (inCheck(chess)) snd('check');
    V('setPieceState', m.to, 'happy', 1400);
    say(ctx.step === 1 ? 'Хороший ход! Посмотрим, что ответит соперник…' : 'Отлично! Что теперь ответит соперник?', { mood: 'happy' });
    later(async function () {
      if (!alive(ctx) || ctx.gen !== gen) return;
      const reply = defenseN(chess, r);
      if (!reply) { replyFailed(ctx); return; }
      const mv = await playBlack(ctx, reply, gen);
      if (mv === null) return;
      if (!mv) { replyFailed(ctx); return; }
      const left = r - 1;
      startNextStep(ctx, left <= 1 ? 'Теперь поставь мат!' : 'Твой ход! До мата ' + plural(left, 'остался', 'осталось', 'осталось') + ' ' + movesWord(left) + '.');
    }, 700);
  }

  function winFirst(ctx, m, gen) {
    const chess = ctx.chess, pz = ctx.pz;
    if (!isSolution(pz, m)) {
      const th = threatOn(chess, m.piece & 24, m.to);
      let text, marks = [];
      if (th) {
        text = 'Ой, здесь ' + nameOf(getP(chess, m.to) & 7).acc + ' съедят! Попробуй другой ход.';
        marks = [{ danger: m.to }];
        if (onBoard(th.from)) marks.push({ from: th.from, to: m.to });
      } else {
        text = pz.fail ? String(pz.fail) : 'Так фигуру не выиграть. Попробуй другой ход!';
      }
      missed(ctx, text);
      showMarks(marks);
      revertPuzzleMove(ctx, m, gen, marks.length ? 2000 : 1500);
      return;
    }
    const r = replyOf(pz) ? pickLegal(legalMoves(chess), replyOf(pz)) : null;
    if (!r) {
      puzzleSuccess(ctx, m);
      return;
    }
    if (inCheck(chess)) snd('check');
    V('setPieceState', m.to, 'happy', 1400);
    say('Отличный ход! Что ответит соперник?', { mood: 'happy' });
    later(async function () {
      if (!alive(ctx) || ctx.gen !== gen) return;
      const mv = await playBlack(ctx, r, gen);
      if (mv === null) return;
      if (!mv) { replyFailed(ctx); return; }
      let text = 'Соперник ответил. А теперь забирай добычу!';
      if ((mv.piece & 7) === KING) text = 'Король соперника убежал. А теперь забирай добычу!';
      else if (mv.captured) {
        const nm = nameOf(mv.captured & 7);
        text = 'Соперник съел ' + possAcc(nm) + ' ' + nm.acc + '… А теперь забирай добычу!';
      }
      startNextStep(ctx, text);
    }, 700);
  }

  function winFinish(ctx, m, gen) {
    if (m.captured && valueOf(m.captured) >= finishMin(ctx.pz)) {
      puzzleSuccess(ctx, m);
      return;
    }
    missed(ctx, m.captured ? 'Это маленькая добыча. Найди фигуру побольше!' :
      'Сейчас нужно забрать фигуру соперника! Посмотри, кого можно съесть.');
    revertPuzzleMove(ctx, m, gen, 1400);
  }

  /* «Спасайся!»: only the listed moves hold; anything else → what Black does then (the threat arrow again) */
  function saveMove(ctx, m, gen) {
    if (isSolution(ctx.pz, m)) {
      puzzleSuccess(ctx, m);
      return;
    }
    const pun = punishment(ctx.chess, ctx.threat);
    missed(ctx, pun.sure || !ctx.pz.fail ? pun.text : String(ctx.pz.fail));
    showMarks(pun.marks);
    revertPuzzleMove(ctx, m, gen, 2200);
  }

  /* ---------------------------------------------------------------------------------------- endgames */

  /* the child's move is on the board: goal? draw? out of moves? → else Black thinks a moment and answers */
  function endgameAfterWhite(ctx, m, gen) {
    const chess = ctx.chess;
    const F = FLAG();
    ctx.moves++;
    // the bubble still shows a hint line about THIS move («Смотри на стрелку…», «Сейчас подумаю…»)
    const hintTalk = ctx.hintStep > 0 || ctx.hintWait != null;
    ctx.hintStep = 0;
    ctx.hintMove = null;
    ctx.hintWait = null;
    // «Проведи пешку в ферзи!»: a knight / rook / bishop is not the goal (a knight is even a dead draw) — say so kindly
    if (ctx.goalKind === 'promote' && ((m.flags | 0) & F.PROMO) && (m.promotion & 7) !== QUEEN) {
      endgameFail(ctx, 'underpromo', m);
      return;
    }
    if (ctx.goalKind === 'mate' ? isMate(chess) :
      (((m.flags | 0) & F.PROMO) && !threatOn(chess, WHITE, m.to) && !isStalemate(chess))) {
      endgameWin(ctx, m);
      return;
    }
    const draw = drawReason(chess);
    if (draw) { endgameFail(ctx, draw); return; }
    if (ctx.moves >= ctx.maxMoves) { endgameFail(ctx, 'moves'); return; }
    ctx.thinking = true;
    updatePuzzleMeter(ctx);
    later(async function () {
      if (!alive(ctx) || ctx.gen !== gen) return;
      const r = endgameReplyMove(chess);   // a real search: may take up to a second (the «думает…» is on screen)
      if (!alive(ctx) || ctx.gen !== gen) return;
      ctx.thinking = false;
      if (!r) { updatePuzzleMeter(ctx); replyFailed(ctx); return; }
      const mv = await playBlack(ctx, r, gen);
      if (mv === null) return;
      if (!mv) { updatePuzzleMeter(ctx); replyFailed(ctx); return; }
      if (mv.captured && (mv.captured & 24) === WHITE) { endgameFail(ctx, 'lost', mv); return; }
      const d = drawReason(chess);
      if (d) { endgameFail(ctx, d); return; }
      if (ctx.goalKind === 'promote' && officers(chess) > ctx.officers) { endgameWin(ctx, null); return; }
      ctx.busy = false;
      updatePuzzleMeter(ctx);
      // the arrow / pulse of that hint is gone now: don't leave its words in the bubble (quietly, no voice)
      if (hintTalk) say(endgameStartLine(ctx), { mood: 'happy', speak: false });
      endgameTip(ctx);
      runPendingHint(ctx);
    }, 520);
  }

  /* Black's defence: Lessons.endgameReply (strong, deterministic); the engine or any legal move as a fallback */
  function endgameReplyMove(chess) {
    const legal = legalMoves(chess);
    if (!legal.length) return null;
    const L = lessonsLib();
    if (L && typeof L.endgameReply === 'function') {
      const hit = pickLegal(legal, safe(function () { return L.endgameReply(chess.clone()); }, null));
      if (hit) return hit;
    }
    const AI = global.ChessAI;
    if (AI && typeof AI.chooseMove === 'function') {
      const hit = pickLegal(legal, safe(function () { return AI.chooseMove(chess.clone(), 'hint'); }, null));
      if (hit) return hit;
    }
    return pickLegal(legal, legal[Math.floor(Math.random() * legal.length)]);
  }

  function endgameTip(ctx) {
    const left = ctx.maxMoves - ctx.moves;
    if (left === 5 || left === 10) {
      tell('Осталось ' + movesWord(left) + '! ' + (ctx.goalKind === 'promote' ? 'Веди пешку вперёд!' : 'Прижимай короля к краю!'),
        left === 5 ? 'warn' : 'think');
    }
  }

  function endgameFail(ctx, reason, mv) {
    ctx.over = true;
    ctx.busy = false;
    ctx.thinking = false;
    dropPendingHint(ctx);
    V('setInteractive', false);
    const promote = ctx.goalKind === 'promote';
    let text, emoji = '💪';
    if (reason === 'stalemate') {
      const k = kingSq(ctx.chess, BLACK);
      if (k >= 0) V('pulseSquare', k, 'danger');
      text = 'Ой, это пат — ничья! Королю соперника некуда ходить, но шаха нет. Оставляй ему хотя бы одну клетку!';
      emoji = '🤝';
      snd('draw');
    } else if (reason === 'repeat') {
      text = 'Позиция повторилась три раза — это ничья. Не ходи туда-обратно, прижимай короля!';
      emoji = '🤝';
      snd('draw');
    } else if (reason === 'lost' && mv) {
      const nm = nameOf(mv.captured & 7);
      V('setPieceState', mv.to, 'happy', 2000);
      text = 'Ой, соперник съел ' + possAcc(nm) + ' ' + nm.acc + '! ' +
        ((mv.captured & 7) === PAWN ? 'Веди пешку вместе с королём — он её защитит.' : 'Держи фигуры подальше от чужого короля.');
      emoji = '🙈';
      snd('wrong');
    } else if (reason === 'underpromo' && mv) {
      V('pulseSquare', mv.to, 'danger');
      text = 'Пешка превратилась в ' + nameOf(mv.promotion & 7).acc + ', а нужен ферзь! Нажми «↻ Заново» и выбери ферзя — он самый сильный.';
      emoji = '👑';
      snd('wrong');
    } else if (reason === 'moves') {
      text = promote ? 'Ходы закончились, а пешка ещё не стала ферзём. Помогай ей королём — и всё получится!' :
        'Ходы закончились, а мата пока нет. Прижимай короля к краю доски — и всё получится!';
      emoji = '⏳';
      snd('wrong');
    } else {
      text = 'Это ничья. Попробуй ещё раз!';
      emoji = '🤝';
      snd('draw');
    }
    updatePuzzleMeter(ctx);
    say(text, { mood: 'sad' });
    attention(ctx, '.lr-restart', true);
    later(function () {
      if (!alive(ctx) || !ctx.over) return;
      openModal({
        emoji: emoji,
        title: 'Попробуй ещё раз!',
        html: '<div class="lr-result"><p class="lr-result-text">' + esc(text) + '</p></div>',
        buttons: [
          { label: '↻ Заново', kind: 'primary', onClick: function () { restartPuzzle(ctx); } },
          { label: 'К задачкам', kind: 'ghost', onClick: function () { renderPuzzles({ set: ctx.set.id }); } }
        ],
        onClose: function () { tell('Нажми «↻ Заново» — у тебя получится!', 'happy', false); }
      });
    }, 1700);
  }

  function endgameWin(ctx, m) {
    const chess = ctx.chess;
    ctx.done = true;
    ctx.busy = false;
    ctx.thinking = false;
    dropPendingHint(ctx);
    V('setInteractive', false);
    const mate = isMate(chess);
    if (mate) {
      const k = kingSq(chess, chess.turn);
      if (k >= 0) V('tipKing', k);
      snd('win');
    } else {
      snd('levelComplete');
      const c = m ? V('squareCenter', m.to) : null;
      if (c) fx('burst', c.x, c.y, { shape: 'star', count: 30 });
    }
    fx('confetti');
    V('setSideState', 'w', 'happy', 3000);
    const fast = ctx.moves <= ctx.par;
    const stars = fast && !ctx.hintUsed ? 2 : 1;
    const rec = recordPuzzle(ctx, stars);
    const lines = [(mate ? 'Мат за ' : 'Пешка стала ферзём за ') + movesWord(ctx.moves) + '!'];
    if (ctx.hintUsed) lines.push('С подсказкой — одна звезда. Попробуй потом сам!');
    else lines.push(fast ? 'Это очень быстро — лучший результат!' : 'А можно быстрее — за ' + movesWord(ctx.par) + '. Попробуешь?');
    if (rec.allDone) {
      lines.push('Ты решил все задачки «' + ctx.set.title + '»! ' + (KIND_MASTER.endgame || ''));
      later(function () { fx('fireworks', 2600); }, 700);
    }
    say((mate ? 'Мат! ' : 'Ура! ') + lines[0], { mood: 'wow' });
    later(function () {
      if (!alive(ctx)) return;
      openModal({
        emoji: mate ? '👑' : '🎉',
        title: mate ? 'Мат! 🎉' : 'Новый ферзь! 🎉',
        html: resultHtml(stars, 2, lines, rec.gained),
        buttons: [
          { label: 'Следующая задачка ➜', kind: 'green', onClick: function () { nextPuzzle(ctx, true); } },
          { label: '↻ Ещё раз', kind: 'secondary', onClick: function () { restartPuzzle(ctx); } }
        ],
        onClose: function () { tell('Нажми «➜ Следующая», чтобы сыграть новую задачку!', 'happy', false); }
      });
      starSounds(stars);
    }, 1500);
  }

  /* ---------------------------------------------------------------------------------------- engine hints (endgames) */

  /* the hint engine: ChessAI in a worker (js/ai-worker.js) so the board stays responsive; the main thread after a
     setTimeout when workers are unavailable (file://, the artifact) or the worker fails */
  function hintAI() {
    if (S.hintAI) return S.hintAI;
    const A = { worker: null, seq: 0, waiting: {} };
    S.hintAI = A;
    const fail = function () {
      const w = A.worker;
      A.worker = null;
      if (w) safe(function () { w.terminate(); });
      Object.keys(A.waiting).forEach(function (k) {
        const cb = A.waiting[k];
        delete A.waiting[k];
        setTimeout(function () { cb(undefined); }, 0);
      });
    };
    if (typeof global.Worker === 'function' && global.location && global.location.protocol !== 'file:') {
      try {
        A.worker = new global.Worker('js/ai-worker.js');
        A.worker.onmessage = function (ev) {
          const d = ev && ev.data;
          const cb = d && A.waiting[d.id];
          if (!cb) return;
          delete A.waiting[d.id];
          cb(d.error ? undefined : (d.move || null));
        };
        A.worker.onerror = function (ev) {
          safe(function () { if (ev && ev.preventDefault) ev.preventDefault(); });
          fail();
        };
      } catch (e) {
        A.worker = null;
      }
    }
    return A;
  }

  /* game = { fen, startFen, moves: [{from, to, promotion}] }: the whole game, so the engine knows the positions that
     were already on the board (a hint must never walk into a draw by repetition) */
  function localHint(game) {
    const AI = global.ChessAI, C = CH();
    if (!AI || typeof AI.chooseMove !== 'function' || !C) return null;
    return safe(function () {
      let c = new C(game.startFen || game.fen);
      if (game.startFen) {
        const ok = game.moves.every(function (m) { return !!c.move(m); });
        if (!ok || c.fen() !== game.fen) c = new C(game.fen);
      }
      const r = AI.chooseMove(c, 'hint');
      return r ? { from: r.from, to: r.to, promotion: r.promotion || 0 } : null;
    }, null);
  }

  /* → Promise of the engine's best move {from, to, promotion} | null for the side to move (game: see localHint) */
  function engineHint(game) {
    return new Promise(function (resolve) {
      const A = hintAI();
      const local = function () { setTimeout(function () { resolve(localHint(game)); }, 30); };
      if (!A.worker) { local(); return; }
      const id = ++A.seq;
      const t = setTimeout(function () {
        if (!A.waiting[id]) return;
        delete A.waiting[id];
        local();
      }, 7000);
      A.waiting[id] = function (mv) {
        clearTimeout(t);
        if (mv === undefined) local();
        else resolve(mv);
      };
      try {
        A.worker.postMessage({ id: id, fen: game.fen, startFen: game.startFen, moves: game.moves, level: 'hint' });
      } catch (e) {
        delete A.waiting[id];
        clearTimeout(t);
        local();
      }
    });
  }

  /* endgame hint: the engine's best move (a mate in 1 at once); the board stays playable while it thinks */
  function endgameHint(ctx) {
    const chess = ctx.chess;
    const fen = safe(function () { return chess.fen(); }, '');
    const use = function (mv) {
      const h = pickLegal(legalMoves(chess), mv);
      if (!h) { tell(ctx.goalKind === 'promote' ? 'Веди пешку вперёд вместе с королём!' : 'Прижимай короля к краю доски!', 'think'); return; }
      ctx.hintUsed = true;
      showHintStep(ctx, h);
      updatePuzzleMeter(ctx);
    };
    if (ctx.hintMove && ctx.hintMove.fen === fen) { use(ctx.hintMove.move); return; }
    const mates = safe(function () { return chess.mateInOne(); }, []) || [];
    if (mates.length) {
      ctx.hintMove = { fen: fen, move: normMove(mates[0]) };
      use(ctx.hintMove.move);
      return;
    }
    if (ctx.hintWait === fen) { snd('click'); return; }
    ctx.hintWait = fen;
    snd('click');
    tell('Сейчас подумаю…', 'think', false);
    const gen = ctx.gen, moves = ctx.moves;
    const history = (safe(function () { return chess.history(); }, []) || []).map(function (m) {
      return { from: m.from, to: m.to, promotion: m.promotion ? (m.promotion & 7) : 0 };
    });
    engineHint({ fen: fen, startFen: ctx.pz.fen, moves: history }).then(function (mv) {
      if (!alive(ctx) || ctx.gen !== gen || ctx.moves !== moves || ctx.done || ctx.over) return;
      ctx.hintWait = null;
      if (!mv) { tell(ctx.goalKind === 'promote' ? 'Веди пешку вперёд вместе с королём!' : 'Прижимай короля к краю доски!', 'think'); return; }
      ctx.hintMove = { fen: fen, move: mv };
      if (ctx.busy) { queueHint(ctx); return; }
      use(mv);
    });
  }

  /* ---------------------------------------------------------------------------------------- trainer */

  function trainerState() {
    if (!S.trainer) {
      let streak = 0, best = 0;
      try {
        const raw = global.localStorage ? global.localStorage.getItem(TRAINER_KEY) : null;
        const o = raw ? JSON.parse(raw) : null;
        if (o && typeof o === 'object') {
          streak = Math.max(0, Math.floor(num(o.streak, 0)));
          best = Math.max(streak, Math.floor(num(o.best, 0)));
        }
      } catch (e) { /* storage may be blocked or broken: start from zero */ }
      S.trainer = { streak: streak, best: best, queue: [], last: null };
    }
    return S.trainer;
  }

  function storeTrainer() {
    const t = trainerState();
    try {
      if (global.localStorage) global.localStorage.setItem(TRAINER_KEY, JSON.stringify({ streak: t.streak, best: t.best }));
    } catch (e) { /* storage may be blocked */ }
  }

  /* the next trainer puzzle: a random one of the first unsolved (the pool goes easy → hard), then shuffled replays */
  function pickTrainer(set) {
    const t = trainerState();
    const list = set.puzzles;
    const unsolved = [];
    for (let i = 0; i < list.length && unsolved.length <= TRAINER_WINDOW; i++) {
      if (!puzzleStars(list[i], i)) unsolved.push(i);
    }
    let pool = unsolved.filter(function (i) { return String(list[i].id) !== t.last; }).slice(0, TRAINER_WINDOW);
    if (!pool.length) pool = unsolved;
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
    if (!t.queue.length || t.queue.some(function (i) { return i >= list.length; })) {
      t.queue = list.map(function (_, i) { return i; });
      for (let i = t.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const x = t.queue[i]; t.queue[i] = t.queue[j]; t.queue[j] = x;
      }
    }
    let i = t.queue.shift();
    if (list.length > 1 && String(list[i].id) === t.last) {
      t.queue.push(i);
      i = t.queue.shift();
    }
    return i;
  }

  function openTrainer(setId) {
    const sets = puzzleSets();
    const set = findSet(sets, setId);
    const tr = set && set.endless ? set : trainerSet(sets);
    if (!tr) { renderPuzzles(); return; }
    openPuzzle(pickTrainer(tr), tr.id);
  }

  function streakTitle(n) {
    if (n === 5) return '5 подряд! Ты в ударе!';
    if (n === 10) return '10 подряд! Как молния!';
    if (n === 20) return '20 подряд! Невероятно!';
    return n + ' подряд! Вот это да!';
  }

  /* a solved trainer puzzle: +1 ⭐ the first time, the streak grows (not with a hint), little parties at 5/10/20 */
  function trainerSuccess(ctx, m, mate) {
    const t = trainerState();
    const p = profile();
    const key = puzzleKey(ctx.pz, ctx.idx);
    const first = !starsVal(p.puzzles[key], 2);
    if (first) p.puzzles[key] = 1;
    save();
    if (first) addStars(1, hostFrom(ctx));
    const hinted = !!(ctx.hintUsed || ctx.hintEver);
    const clean = !ctx.mistakes && !ctx.missEver && !hinted;
    let record = false;
    if (clean) {
      t.streak++;
      if (t.streak > t.best) { t.best = t.streak; record = t.streak >= 3; }
    }
    storeTrainer();
    puzzleAchievements();
    updatePuzzleMeter(ctx);
    const party = clean && (STREAK_PARTY.indexOf(t.streak) >= 0 || (t.streak > 20 && t.streak % 10 === 0));
    const lines = [puzzleWinLine(m, mate)];
    if (clean) {
      lines.push(t.streak === 1 ? 'Серия началась — решай дальше!' : record ? 'Это твой новый рекорд!' : 'Так держать!');
    } else if (hinted) {
      lines.push('С подсказкой серия не растёт. Следующую попробуй сам!');
    } else {
      lines.push('Серия начнётся с новой задачки. У тебя получится!');
    }
    if (party) {
      later(function () { fx('fireworks', 2600); snd('achievement'); }, 600);
    }
    const c = countSolved(ctx.list);
    say((party ? streakTitle(t.streak) + ' ' : '') + (mate ? 'Мат! ' : '') + lines[0], { mood: 'wow' });
    later(function () {
      if (!alive(ctx)) return;
      openModal({
        emoji: party ? '🔥' : mate ? '🏆' : '⚔️',
        title: party ? streakTitle(t.streak) : mate ? 'Мат! 🎉' : 'Решено! 🎉',
        // «🔥 0 задачек подряд» would greet a solved puzzle with a zero: the big streak only when there is one
        html: '<div class="lr-result lr-tr-result">' +
          (t.streak > 0 ? '<div class="lr-tr-big' + (party ? ' party' : '') + '"><span>🔥</span><b>' + t.streak + '</b><em>' +
            plural(t.streak, 'задачка', 'задачки', 'задачек') + ' подряд</em></div>' : '') +
          lines.map(function (l) { return '<p class="lr-result-text">' + esc(l) + '</p>'; }).join('') +
          '<p class="lr-result-text lr-tr-sub">Решено ' + c.solved + ' из ' + c.total + ' · рекорд: ' + t.best + '</p>' +
          (first ? '<div class="lr-result-reward">+1 ⭐</div>' : '') +
          '</div>',
        buttons: [
          { label: 'Ещё задачка ➜', kind: 'green', onClick: function () { openTrainer(ctx.set.id); } },
          { label: 'К задачкам', kind: 'ghost', onClick: function () { renderPuzzles(); } }
        ],
        onClose: function () { tell('Нажми «Ещё задачка ➜» — продолжим тренировку!', 'happy', false); }
      });
    }, 1300);
  }

  /* ---------------------------------------------------------------------------------------- results */

  /* «Мат рокировкой»: the puzzle is about castling, but a plain move mated too → «А ещё можно было рокировкой!» */
  function castleMateMissed(ctx, m) {
    const F = FLAG();
    const h = ctx && ctx.pz && ctx.pz.hint ? anyMove(ctx.pz.hint) : null;
    if (!h || !m || ((m.flags | 0) & F.CASTLE)) return '';
    const start = safe(function () { const C = CH(); return C ? new C(ctx.pz.fen) : null; }, null);
    const p = start ? getP(start, h.from) : 0;
    if (!p || (p & 7) !== KING || Math.abs((h.to & 7) - (h.from & 7)) !== 2) return '';
    return 'А ещё можно было поставить мат рокировкой — попробуй!';
  }

  function puzzleWinLine(m, mate) {
    if (mate) return mateLine(m);
    if (m.captured) return 'Ам! Ты забрал ' + nameOf(m.captured & 7).acc + '!';
    return 'Отличный ход! Теперь соперник обязательно потеряет фигуру.';
  }

  /* achievements after a solved puzzle (App.unlock ignores the ones already unlocked) */
  function puzzleAchievements() {
    unlock('puzzle_first');
    if (countSolved(allPuzzles()).solved >= 5) unlock('puzzles_5');
    const m1 = kindProgress('mate1');
    if (m1.total && m1.solved >= m1.total) unlock('puzzles_all');   // «Мастер мата» = all mate-in-1 puzzles
    [['mate2', 'mate2_first', 'mate2_all'], ['win', 'win_first', 'win_all'], ['mate3', 'mate3_first', 'mate3_all'],
      ['save', 'save_first', 'save_all'], ['endgame', 'endgame_first', 'endgame_all']].forEach(function (a) {
      const k = kindProgress(a[0]);
      if (k.solved >= 1) unlock(a[1]);
      if (k.total && k.solved >= k.total) unlock(a[2]);
    });
    const tr = trainerSet();
    if (tr) {
      const c = countSolved(tr.puzzles);
      if (c.solved >= 10) unlock('trainer_10');
      if (c.solved >= 50) unlock('trainer_50');
    }
    if (trainerState().best >= 10) unlock('trainer_streak_10');
  }

  /* saves the result (the better one wins), adds the new stars, awards → { gained, allDone: the set just completed } */
  function recordPuzzle(ctx, stars) {
    const p = profile();
    const key = puzzleKey(ctx.pz, ctx.idx);
    const prev = starsVal(p.puzzles[key], 2);
    const was = countSolved(ctx.list);
    let gained = 0;
    if (stars > prev) {
      p.puzzles[key] = stars;
      gained = stars - prev;
    }
    save();
    if (gained > 0) addStars(gained, hostFrom(ctx));
    const got = countSolved(ctx.list);
    puzzleAchievements();
    updatePuzzleMeter(ctx);
    return { gained: gained, allDone: was.solved < was.total && got.solved >= got.total };
  }

  /* «Спасайся!» solved: the threatened square shines, a shield floats up */
  function showDefused(ctx) {
    const th = ctx.threat;
    if (!th) return;
    V('pulseSquare', th.to, 'good');
    const c = V('squareCenter', th.to);
    if (c) fx('floatText', c.x, c.y - 10, '🛡️', { size: 44 });
  }

  function puzzleSuccess(ctx, m) {
    const chess = ctx.chess;
    ctx.done = true;
    ctx.busy = false;
    dropPendingHint(ctx);
    V('setInteractive', false);
    V('setDanger', []);
    const mate = isMate(chess);
    if (mate) {
      const k = kingSq(chess, chess.turn);
      if (k >= 0) V('tipKing', k);
      snd('win');
    } else {
      snd('levelComplete');
      const c = V('squareCenter', m.to);
      if (c) fx('burst', c.x, c.y, { shape: 'star', count: 26 });
    }
    fx('confetti');
    V('setSideState', 'w', 'happy', 3000);
    const isSave = ctx.pkind === 'save';
    if (isSave) showDefused(ctx);
    if (ctx.trainer) { trainerSuccess(ctx, m, mate); return; }

    const stars = ctx.hintUsed ? 1 : 2;
    const rec = recordPuzzle(ctx, stars);
    const line = isSave && !mate ? saveWinLine(ctx, m) : puzzleWinLine(m, mate);
    const lines = [line, stars === 2 ? 'Сам, без подсказки — две звезды!' : 'С подсказкой — одна звезда. Реши потом сам — и получишь ещё одну!'];
    const castleToo = mate ? castleMateMissed(ctx, m) : '';
    if (castleToo) lines.splice(1, 0, castleToo);
    if (rec.allDone) {
      lines.push('Ты решил все задачки «' + ctx.set.title + '»! ' + (KIND_MASTER[ctx.pkind] || ''));
      later(function () { fx('fireworks', 2600); }, 700);
    }
    say(mate ? 'Мат! ' + line : line, { mood: 'wow' });
    later(function () {
      if (!alive(ctx)) return;
      openModal({
        emoji: mate ? '🏆' : isSave ? '🛡️' : '⚔️',
        title: mate ? 'Мат! 🎉' : isSave ? 'Спасено! 🎉' : 'Фигура твоя! 🎉',
        html: resultHtml(stars, 2, lines, rec.gained),
        buttons: [
          { label: 'Следующая задачка ➜', kind: 'green', onClick: function () { nextPuzzle(ctx, true); } },
          { label: 'К задачкам', kind: 'ghost', onClick: function () { renderPuzzles({ set: ctx.set.id }); } }
        ],
        onClose: function () { tell('Нажми «➜ Следующая», чтобы решить новую задачку!', 'happy', false); }
      });
      starSounds(stars);
    }, 1400);
  }

  /* hints per step: the 1st press pulses the piece to move, the 2nd shows the arrow */
  function puzzleHint(ctx) {
    if (!alive(ctx)) return;
    if (ctx.over) { tell('Нажми «↻ Заново» — и попробуй ещё раз!', 'happy'); return; }
    if (ctx.busy && !ctx.done) { queueHint(ctx); return; }
    if (ctx.done) { tell(ctx.trainer ? 'Задачка решена! Нажми «Ещё задачка ➜».' : 'Задачка решена! Нажми «➜ Следующая».', 'happy'); return; }
    const chess = ctx.chess, pz = ctx.pz;
    if (ctx.pkind === 'endgame') { endgameHint(ctx); return; }
    const firstMate = function () {
      const ms = safe(function () { return chess.mateInOne(); }, []) || [];
      return ms.length ? normMove(ms[0]) : null;
    };
    const fromList = function (sols) {
      return function () {
        const legal = legalMoves(chess);
        for (let i = 0; i < sols.length; i++) {
          const x = pickLegal(legal, sols[i]);
          if (x) return x;
        }
        return null;
      };
    };
    let h = null, none = 'Ищи ход, после которого королю некуда деться!';
    if (MATE_N[ctx.pkind] > 1) {
      const r = remainingOf(ctx);
      const finder = r <= 1 ? firstMate : function () { return mateHintMove(chess, r); };
      h = hintMoveFor(chess, ctx.step === 1 ? pz.hint : null, finder);
      none = 'Ищи ход, после которого королю соперника станет совсем тесно!';
    } else if (ctx.pkind === 'save') {
      const sols = solutionsOf(pz);
      h = hintMoveFor(chess, sols[0] || pz.hint, fromList(sols));
      none = 'Посмотри на красную стрелку: как помешать сопернику?';
    } else if (ctx.pkind === 'win' && ctx.step === 1) {
      const sols = solutionsOf(pz);
      h = hintMoveFor(chess, sols[0] || pz.hint, fromList(sols));
      none = 'Поищи ход, который нападает на фигуры соперника!';
    } else if (ctx.pkind === 'win') {
      h = bestFinish(ctx);
      none = 'Посмотри, какую фигуру соперника можно съесть!';
    } else {
      h = hintMoveFor(chess, ctx.step === 1 ? pz.hint : null, firstMate);
    }
    if (!h) { tell(none, 'think'); return; }
    ctx.hintUsed = true;
    showHintStep(ctx, h);
  }

  /* ============================================================================================ global hooks */

  function dialogOpen() {
    const sel = '[role="dialog"], [aria-modal="true"], dialog[open], .modal-backdrop, .modal-overlay, .lr-fb-modal, [class*="promo"]';
    const els = doc.querySelectorAll(sel);
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e.getClientRects && e.getClientRects().length) {
        const cs = global.getComputedStyle ? global.getComputedStyle(e) : null;
        if (!cs || (cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0')) return true;
      }
    }
    return false;
  }

  function onKey(e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (e.defaultPrevented || S.modal) return;
    const ae = doc.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return;
    const active = activeScreens();
    let target = null;
    if (active.has('lesson') && S.screen === 'lesson') target = 'map';
    else if (active.has('puzzle') && S.screen === 'puzzle') target = 'grid';
    if (!target || dialogOpen()) return;
    if (S.view && typeof S.view.selected === 'number' && S.view.selected >= 0) return;   // the board deselects first
    e.preventDefault();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    snd('click');
    if (target === 'map') renderMap();
    else renderPuzzles({ set: S.lastPuzzle ? S.lastPuzzle.set : undefined });
  }

  /* if App shows one of our sections by itself (e.g. its back button), render fresh content for it */
  function onSectionsChanged() {
    const current = activeScreens();
    const became = [];
    current.forEach(function (n) { if (!prevActive.has(n)) became.push(n); });
    prevActive = current;
    if (S.inShow || !became.length) return;
    const n = became[became.length - 1];
    if (n === S.screen) return;
    if (n === 'lessons') renderMap();
    else if (n === 'puzzles') renderPuzzles();
    else if (n === 'lesson') {
      if (S.lastLesson) openLevel(S.lastLesson.gi, S.lastLesson.li);
      else renderMap();
    } else if (n === 'puzzle') {
      if (S.lastPuzzle) openPuzzle(S.lastPuzzle.idx, S.lastPuzzle.set);
      else renderPuzzles();
    }
  }

  function watchSections() {
    if (typeof global.MutationObserver !== 'function') return;
    const mo = new global.MutationObserver(function () { safe(onSectionsChanged); });
    SCREENS.forEach(function (n) {
      const el = doc.getElementById('screen-' + n);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    prevActive = activeScreens();
  }

  /* ============================================================================================ public API */

  function findGroupIndex(group) {
    const gs = groups();
    if (typeof group === 'number') return group >= 0 && group < gs.length ? group : -1;
    return gs.findIndex(function (g) { return g.id === group; });
  }

  const Learn = {
    openLessons: function () {
      if (S.inShow || !doc) return;
      safe(function () { renderMap({}); });
    },
    openPuzzles: function (setId) {
      if (S.inShow || !doc) return;
      safe(function () { renderPuzzles({ set: setId }); });
    },
    openLesson: function (group, level) {
      if (S.inShow || !doc) return;
      safe(function () {
        const gi = findGroupIndex(group);
        if (gi < 0) { renderMap({}); return; }
        if (level == null) openGroup(gi);
        else openLevel(gi, level);
      });
    },
    openPuzzle: function (index, setId) {
      if (S.inShow || !doc) return;
      safe(function () { openPuzzle(index, setId); });
    },
    leave: function () {
      safe(cleanup);
    }
  };

  // small hook for node tests of the pure helpers (not part of the app contract)
  Object.defineProperty(Learn, '_internals', {
    enumerable: false,
    value: {
      plural: plural, movesWord: movesWord, toSq: toSq, localSolve: localSolve, explainIllegal: explainIllegal,
      normalizeTurn: normalizeTurn, levelText: levelText, taskFailText: taskFailText, taskWinText: taskWinText,
      goalMet: goalMet, mateLine: mateLine, colorVars: colorVars, miniBoardHtml: miniBoardHtml, GOALS: GOALS,
      puzzleSets: puzzleSets, puzzleKind: puzzleKind, allPuzzles: allPuzzles, puzzleKey: puzzleKey,
      uciToMove: uciToMove, pickLegal: pickLegal, mate2Ok: mate2Ok, escapeReply: escapeReply, blackDefense: blackDefense,
      findMate2Move: findMate2Move, isSolution: isSolution, threatOn: threatOn, forkTargets: forkTargets,
      safeFailInfo: safeFailInfo, forkFailInfo: forkFailInfo, targetsAcc: targetsAcc, notMateInfo: notMateInfo,
      returningV1: returningV1, isFreshSet: isFreshSet, newsGreeting: newsGreeting, tooSoon: tooSoon,
      isV3: isV3, veteran3: veteran3, isNewSet: isNewSet, newsV3Greeting: newsV3Greeting, chapterRuns: chapterRuns,
      mateInMoveOk: mateInMoveOk, mateMoves: mateMoves, defenseN: defenseN, escapeReplyN: escapeReplyN,
      threatInfo: threatInfo, punishment: punishment, drawReason: drawReason, pickTrainer: pickTrainer,
      trainerState: trainerState, solutionFailInfo: solutionFailInfo, CHAPTERS: CHAPTERS,
      ownFailText: ownFailText, castleMateMissed: castleMateMissed,
      state: function () { return S; }
    }
  });

  if (doc) {
    doc.addEventListener('keydown', onKey);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { safe(watchSections); });
    else safe(watchSections);
  }

  global.Learn = Learn;
  if (typeof module !== 'undefined' && module.exports) module.exports = Learn;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
