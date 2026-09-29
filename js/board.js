/*
 * «Шахматное Королевство» — интерактивная доска (global BoardView). SPEC §7.
 *
 *   var view = new BoardView(hostEl, { orientation, theme, faces, showLegal, showCoords, interactive,
 *                                      canSelect, getMoves, onMove, onSelect, onDeselect, onIllegal, onSquareClick });
 *
 * DOM:  host → .bv (theme-<id>, orient-w|b, is-interactive, no-faces, no-coords)
 *              → .bv-frame (.bv-ranks, .bv-files, .bv-board)
 *                .bv-board → .bv-squares (64 × .bv-sq[data-sq]), .bv-decor (marks, stars), .bv-pieces (.bv-piece),
 *                            svg.bv-arrows, .bv-over (flying stars), .bv-promo (promotion picker)
 *
 * Squares are 0x88 integers (a8 = 0, h1 = 119). Public methods also accept square names ('e4').
 * The board never changes the position on its own: after onMove the controller calls applyMove().
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var SVGNS = 'http://www.w3.org/2000/svg';

  var WHITE = 8, BLACK = 16;
  var PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  var F_CAPTURE = 1, F_EP = 2, F_CASTLE = 4;
  var TYPE_CHARS = ' pnbrqk';
  var FILES = 'abcdefgh';

  var DRAG_THRESHOLD = 6;      // px before a press becomes a drag
  var SETTLE_MS = 300;         // applyMove / undoMove promise resolves after this
  var SLIDE_MS = 260;          // must match the .bv-piece transition
  var UNAPPLIED_MS = 650;      // piece returns home if the controller did not apply the move
  var SPIN_MS = 600;           // flip animation
  var EYE_DRAG_MS = 150;       // while dragging, the other pieces' eyes follow at most this often
  var EYE_MIN_STEP = 0.35;     // skip look changes smaller than this (SVG units) to avoid needless restyles

  var THEMES = [
    { id: 'ocean', name: 'Океан', light: '#e3f4ff', dark: '#5aa9e6', frame: '#2f6fb0' },
    { id: 'mint', name: 'Мятная', light: '#eafbf0', dark: '#5cc98a', frame: '#2e8b57' },
    { id: 'candy', name: 'Конфетная', light: '#ffe6f1', dark: '#ff8fbd', frame: '#d9468a' },
    { id: 'sunny', name: 'Солнечная', light: '#fff4d6', dark: '#f6b04a', frame: '#d9822b' },
    { id: 'grape', name: 'Виноградная', light: '#f0e9ff', dark: '#a08cf0', frame: '#6c4fd6' },
    { id: 'wood', name: 'Деревянная', light: '#f0d9b5', dark: '#b58863', frame: '#7a5230' }
  ];

  var PROMO_ORDER = [QUEEN, ROOK, BISHOP, KNIGHT];
  var PROMO_LABELS = {};
  PROMO_LABELS[QUEEN] = 'Ферзь';
  PROMO_LABELS[ROOK] = 'Ладья';
  PROMO_LABELS[BISHOP] = 'Слон';
  PROMO_LABELS[KNIGHT] = 'Конь';

  var PIECE_STATES = ['happy', 'scared', 'dizzy'];
  var PULSE_KINDS = ['hint', 'danger', 'good'];
  var ARROW_KINDS = ['hint', 'danger', 'info'];

  // Fallback glyphs when PieceArt is not loaded (keeps the board usable).
  var GLYPHS = {
    w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
    b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
  };

  var instanceCounter = 0;

  // ------------------------------------------------------------------ helpers

  function toSq(v) {
    if (typeof v === 'number') {
      return (v >= 0 && v < 128 && !(v & 0x88) && v === Math.floor(v)) ? v : -1;
    }
    if (typeof v === 'string' && /^[a-h][1-8]$/i.test(v)) {
      v = v.toLowerCase();
      return (8 - Number(v.charAt(1))) * 16 + FILES.indexOf(v.charAt(0));
    }
    return -1;
  }

  function validCode(code) {
    code = code | 0;
    var t = code & 7, c = code & 24;
    return (t >= PAWN && t <= KING && (c === WHITE || c === BLACK)) ? code : 0;
  }

  function colorOf(code) { return (code & 24) === BLACK ? 'b' : 'w'; }
  function typeOf(code) { return TYPE_CHARS.charAt(code & 7) || 'p'; }

  function boardOf(chess) {
    if (!chess) return null;
    var b = chess.board !== undefined ? chess.board : chess;
    return (b && typeof b.length === 'number' && b.length >= 120) ? b : null;
  }

  function themeId(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return id;
    return THEMES[0].id;
  }

  function reducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function mk(tag, cls) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function removeEl(e) {
    if (e && e.parentNode) e.parentNode.removeChild(e);
  }

  function safeCall(fn, ctx, args) {
    if (typeof fn !== 'function') return undefined;
    try {
      return fn.apply(ctx || null, args || []);
    } catch (err) {
      if (global.console && global.console.error) global.console.error('[BoardView]', err);
      return undefined;
    }
  }

  function playSound(name) {
    var S = global.Sound;
    if (S && typeof S.play === 'function') {
      try { S.play(name); } catch (e) { /* sound is optional */ }
    }
  }

  function unlockSound() {
    var S = global.Sound;
    if (S && typeof S.unlock === 'function') {
      try { S.unlock(); } catch (e) { /* optional */ }
    }
  }

  function fxBurst(x, y, opts) {
    var F = global.FX;
    if (F && typeof F.burst === 'function') {
      try { F.burst(x, y, opts); } catch (e) { /* fx is optional */ }
    }
  }

  function pieceMarkup(code) {
    var c = colorOf(code), t = typeOf(code);
    var PA = global.PieceArt;
    if (PA && typeof PA.svg === 'function') {
      try {
        var s = PA.svg(c, t);
        if (s) return s;
      } catch (e) { /* fall back to glyphs */ }
    }
    return '<span class="bv-glyph bv-glyph-' + c + '">' + GLYPHS[c][t] + '</span>';
  }

  function starMarkup() {
    var PA = global.PieceArt;
    if (PA && typeof PA.star === 'function') {
      try {
        var s = PA.star();
        if (s) return s;
      } catch (e) { /* fall back */ }
    }
    return '<span class="bv-glyph bv-glyph-star">★</span>';
  }

  function r1(v) { return Math.round(v * 10) / 10; }

  function restartAnim(e, cls, ms) {
    var inner = e._inner;
    if (!inner) return;
    var key = '_tok_' + cls;
    var tok = (e[key] || 0) + 1;
    e[key] = tok;
    inner.classList.remove(cls);
    void inner.offsetWidth; // restart the CSS animation
    inner.classList.add(cls);
    setTimeout(function () {
      if (e[key] === tok) inner.classList.remove(cls);
    }, ms);
  }

  // ------------------------------------------------------------------ BoardView

  function BoardView(host, opts) {
    if (!(this instanceof BoardView)) return new BoardView(host, opts);
    if (!host || typeof host.appendChild !== 'function') {
      throw new TypeError('BoardView: hostEl must be a DOM element');
    }
    opts = opts || {};

    this._id = ++instanceCounter;
    this.host = host;
    this.opts = {
      canSelect: opts.canSelect,
      getMoves: opts.getMoves,
      onMove: opts.onMove,
      onSelect: opts.onSelect,
      onDeselect: opts.onDeselect,
      onIllegal: opts.onIllegal,
      onSquareClick: opts.onSquareClick
    };

    this.orientation = opts.orientation === 'b' ? 'b' : 'w';
    this.theme = themeId(opts.theme);
    this.faces = opts.faces !== false;
    this.showLegal = opts.showLegal !== false;
    this.showCoords = opts.showCoords !== false;
    this.interactive = opts.interactive !== false;
    this.selected = -1;

    this._pieces = new Array(128);   // sq -> .bv-piece element
    this._selEl = null;
    this._selByApi = false;          // selected via select(): the first click on it keeps it selected
    this._moves = [];
    this._targets = {};              // to-sq -> [Move]
    this._targetMarks = {};          // to-sq -> mark element
    this._selMark = null;
    this._lastMove = null;
    this._lastMarks = [];
    this._check = -1;
    this._checkMark = null;
    this._danger = [];
    this._dangerMarks = [];
    this._pulses = {};               // sq -> mark
    this._stars = {};                // sq -> mark
    this._arrows = [];               // {from, to, kind, g}
    this._hoverMark = null;
    this._hoverSq = -1;              // drag hover square
    this._hoverT = -1;               // target mark with .is-hover
    this._mouseSq = -2;
    this._press = null;
    this._promo = null;
    this._version = 0;
    this._pendingTimer = 0;
    this._spinTimer = 0;
    this._spinUntil = 0;
    this._eyeRaf = 0;
    this._eyeOthersAt = 0;           // last eye update of the non-dragged pieces during a drag
    this._eyeTrail = 0;              // trailing eye tick timer
    this._ptr = null;
    this._lookActive = false;
    this._destroyed = false;

    // A host can hold only one board: destroy a previous BoardView living there.
    var kids = host.children || [];
    for (var i = kids.length - 1; i >= 0; i--) {
      var old = kids[i];
      if (old && old._bv && old._bv !== this && typeof old._bv.destroy === 'function') old._bv.destroy();
    }

    var PA = global.PieceArt;
    if (PA && typeof PA.install === 'function') {
      try { PA.install(); } catch (e) { /* optional */ }
    }

    this._build();
    this._bind();
  }

  BoardView.THEMES = THEMES;

  var P = BoardView.prototype;

  // ------------------------------------------------------------------ DOM construction

  P._build = function () {
    var root = mk('div', 'bv');
    root._bv = this;
    this.root = root;

    var frame = mk('div', 'bv-frame');
    var ranks = mk('div', 'bv-ranks');
    var files = mk('div', 'bv-files');
    ranks.setAttribute('aria-hidden', 'true');
    files.setAttribute('aria-hidden', 'true');
    this._rankEls = [];
    this._fileEls = [];
    for (var i = 0; i < 8; i++) {
      var rs = mk('span', 'bv-coord');
      var fs = mk('span', 'bv-coord');
      ranks.appendChild(rs);
      files.appendChild(fs);
      this._rankEls.push(rs);
      this._fileEls.push(fs);
    }

    var board = mk('div', 'bv-board');
    board.setAttribute('aria-label', 'Шахматная доска');
    board.setAttribute('role', 'application');

    var squares = mk('div', 'bv-squares');
    this._sqEls = [];
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        var s = mk('div', 'bv-sq ' + ((x + y) % 2 ? 'is-dark' : 'is-light'));
        squares.appendChild(s);
        this._sqEls.push(s);
      }
    }

    var decor = mk('div', 'bv-decor');
    var pieces = mk('div', 'bv-pieces');

    var arrows = doc.createElementNS(SVGNS, 'svg');
    arrows.setAttribute('class', 'bv-arrows');
    arrows.setAttribute('viewBox', '0 0 800 800');
    arrows.setAttribute('aria-hidden', 'true');
    arrows.setAttribute('focusable', 'false');
    this._glowId = 'bv' + this._id + '-glow';
    var defs = doc.createElementNS(SVGNS, 'defs');
    defs.innerHTML =
      '<filter id="' + this._glowId + '" filterUnits="userSpaceOnUse" x="-100" y="-100" width="1000" height="1000"' +
      ' color-interpolation-filters="sRGB">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    arrows.appendChild(defs);
    var arrowLayer = doc.createElementNS(SVGNS, 'g');
    arrows.appendChild(arrowLayer);

    var over = mk('div', 'bv-over');
    var promo = mk('div', 'bv-promo');

    board.appendChild(squares);
    board.appendChild(decor);
    board.appendChild(pieces);
    board.appendChild(arrows);
    board.appendChild(over);
    board.appendChild(promo);

    frame.appendChild(ranks);
    frame.appendChild(files);
    frame.appendChild(board);
    root.appendChild(frame);

    this._frameEl = frame;
    this._boardEl = board;
    this._squaresEl = squares;
    this._decorEl = decor;
    this._piecesEl = pieces;
    this._arrowsEl = arrows;
    this._arrowLayer = arrowLayer;
    this._overEl = over;
    this._promoEl = promo;

    this._updateRootClasses();
    this._renderCoords();
    this._labelSquares();
    this.host.appendChild(root);
  };

  P._updateRootClasses = function () {
    var cls = 'bv theme-' + this.theme + ' orient-' + this.orientation;
    if (this.interactive) cls += ' is-interactive';
    if (!this.faces) cls += ' no-faces';
    if (!this.showCoords) cls += ' no-coords';
    if (this._promo) cls += ' is-promoting';
    if (this._press && this._press.dragging) cls += ' is-dragging';
    this.root.className = cls;
  };

  P._renderCoords = function () {
    var w = this.orientation === 'w';
    for (var i = 0; i < 8; i++) {
      this._fileEls[i].textContent = FILES.charAt(w ? i : 7 - i);
      this._rankEls[i].textContent = String(w ? 8 - i : i + 1);
    }
  };

  P._labelSquares = function () {
    for (var y = 0; y < 8; y++) {
      for (var x = 0; x < 8; x++) {
        this._sqEls[y * 8 + x].setAttribute('data-sq', String(this._sqAt(x, y)));
      }
    }
  };

  // ------------------------------------------------------------------ geometry

  P._xy = function (sq) {
    var r = sq >> 4, c = sq & 7;
    return this.orientation === 'w' ? { x: c, y: r } : { x: 7 - c, y: 7 - r };
  };

  P._sqAt = function (x, y) {
    if (x < 0 || x > 7 || y < 0 || y > 7) return -1;
    return this.orientation === 'w' ? y * 16 + x : (7 - y) * 16 + (7 - x);
  };

  P._sqFromPoint = function (cx, cy) {
    var r = this._boardEl.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    var x = Math.floor((cx - r.left) / r.width * 8);
    var y = Math.floor((cy - r.top) / r.height * 8);
    return this._sqAt(x, y);
  };

  P._codeAt = function (sq) {
    var e = sq >= 0 ? this._pieces[sq] : null;
    return e ? e._code : 0;
  };

  P._eachPiece = function (fn) {
    for (var sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var e = this._pieces[sq];
      if (e) fn.call(this, e, sq);
    }
  };

  P._place = function (e, sq) {
    var p = this._xy(sq);
    e._sq = sq;
    e._x = p.x;
    e._y = p.y;
    e.style.transform = 'translate(' + (p.x * 100) + '%,' + (p.y * 100) + '%)';
  };

  P._placeInstant = function (e, sq) {
    e.classList.add('bv-notrans');
    this._place(e, sq);
    void e.offsetWidth;
    e.classList.remove('bv-notrans');
  };

  P._isAt = function (e, sq) {
    var p = this._xy(sq);
    return e._x === p.x && e._y === p.y && !e.classList.contains('is-dragging');
  };

  // ------------------------------------------------------------------ pieces

  P._createPiece = function (code, sq) {
    var e = mk('div', 'bv-piece');
    var inner = mk('div', 'bv-piece-inner');
    var art = mk('div', 'bv-piece-art');
    inner.appendChild(art);
    e.appendChild(inner);
    e._inner = inner;
    e._art = art;
    e._state = null;
    e._auto = false;
    e._tipped = false;
    e._stateTimer = 0;
    e.style.setProperty('--blink-delay', (-Math.random() * 7).toFixed(2) + 's');
    this._setCode(e, code);
    this._place(e, sq);
    e.setAttribute('data-sq', String(sq));
    this._piecesEl.appendChild(e);
    return e;
  };

  P._setCode = function (e, code) {
    e._code = code;
    e.setAttribute('data-code', String(code));
    var c = colorOf(code);
    e.classList.toggle('side-w', c === 'w');
    e.classList.toggle('side-b', c === 'b');
    if (e._artCode !== code) {
      e._art.innerHTML = pieceMarkup(code);
      e._artCode = code;
    }
  };

  P._movePieceInMap = function (e, from, to) {
    if (this._pieces[from] === e) this._pieces[from] = null;
    this._pieces[to] = e;
    e._sq = to;
    e.setAttribute('data-sq', String(to));
  };

  P._sync = function (board) {
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var sq = r * 16 + c;
        var code = validCode(board[sq]);
        var e = this._pieces[sq];
        if (!code) {
          if (e) {
            if (this._selEl === e) this._clearSelection();
            this._pieces[sq] = null;
            removeEl(e);
          }
          continue;
        }
        if (!e) {
          this._pieces[sq] = this._createPiece(code, sq);
          continue;
        }
        if (e._code !== code || e._artCode !== code) this._setCode(e, code);
        if (!e.classList.contains('is-dragging') && !this._isAt(e, sq)) this._place(e, sq);
      }
    }
    this._refreshAuto();
  };

  // Put every piece back on its square. Callers that need it instant wrap this in .bv-instant.
  P._relayout = function () {
    this._eachPiece(function (e, sq) {
      if (e.classList.contains('is-dragging')) return;
      e.classList.remove('is-moving');
      if (!this._isAt(e, sq)) this._place(e, sq);
    });
  };

  P._hop = function (e, knight) {
    if (reducedMotion()) return;
    restartAnim(e, knight ? 'bv-jump' : 'bv-hop', 380);
  };

  P._poof = function (e, delay, withFx) {
    var self = this;
    e.classList.add('is-captured');
    e.classList.remove('is-selected', 'is-moving');
    if (!withFx) {
      removeEl(e);
      return;
    }
    var run = function () {
      if (!e.parentNode) return;
      if (!self._destroyed) {
        var c = self.squareCenter(e._sq);
        fxBurst(c.x, c.y, { count: 16, shape: 'circle', speed: 0.55, colors: ['#ffffff', '#f1eefc', '#dcd6f2', '#c9c2e6'] });
        fxBurst(c.x, c.y, { count: 7, shape: 'star', speed: 0.8, colors: ['#ffd84d', '#ffb400', '#fff1a8'] });
      }
      restartAnim(e, 'bv-poof', 2000);
      setTimeout(function () { removeEl(e); }, reducedMotion() ? 160 : 460);
    };
    if (delay > 0) setTimeout(run, delay); else run();
  };

  P._swapArt = function (e, sparkle) {
    if (!e || e._artCode === e._code) return;
    e._art.innerHTML = pieceMarkup(e._code);
    e._artCode = e._code;
    restartAnim(e, 'bv-pop', 480);
    if (sparkle && e.parentNode && !this._destroyed) {
      var c = this.squareCenter(e._sq);
      fxBurst(c.x, c.y, { count: 30, shape: 'star', speed: 1, colors: ['#ffe27a', '#ffc93c', '#ff6fae', '#6c63ff', '#ffffff'] });
    }
  };

  // ------------------------------------------------------------------ piece states

  P._applyState = function (e) {
    var st = e._state;
    e.classList.toggle('is-happy', st === 'happy');
    e.classList.toggle('is-dizzy', st === 'dizzy' || !!e._tipped);
    e.classList.toggle('is-scared', st === 'scared' || (!st && !!e._auto));
  };

  P._setElState = function (e, state, dur) {
    if (PIECE_STATES.indexOf(state) < 0) state = null;
    if (e._stateTimer) {
      clearTimeout(e._stateTimer);
      e._stateTimer = 0;
    }
    e._state = state;
    if (state && dur > 0) {
      var self = this;
      e._stateTimer = setTimeout(function () {
        e._stateTimer = 0;
        if (e._state === state) {
          e._state = null;
          self._applyState(e);
        }
      }, dur);
    }
    this._applyState(e);
  };

  P._refreshAuto = function () {
    var danger = {};
    for (var i = 0; i < this._danger.length; i++) danger[this._danger[i]] = true;
    var check = this._check;
    this._eachPiece(function (e, sq) {
      var auto = sq === check || !!danger[sq];
      if (e._auto !== auto) {
        e._auto = auto;
        this._applyState(e);
      }
    });
  };

  P._untip = function (e) {
    if (!e._tipped) return;
    e._tipped = false;
    e.classList.remove('is-tipped');
    if (e._state === 'dizzy') this._setElState(e, null);
    else this._applyState(e);
  };

  P._resetStates = function () {
    this._eachPiece(function (e) {
      e._tipped = false;
      e.classList.remove('is-tipped', 'is-moving');
      this._setElState(e, null);
    });
  };

  // ------------------------------------------------------------------ marks (decor layer)

  P._placeMark = function (m, sq) {
    var p = this._xy(sq);
    m._sq = sq;
    m.style.transform = 'translate(' + (p.x * 100) + '%,' + (p.y * 100) + '%)';
  };

  P._mark = function (cls, sq, html) {
    // square colour does not depend on orientation: a8 (row 0, col 0) is light
    var m = mk('div', 'bv-mark ' + cls + (((sq >> 4) + (sq & 7)) % 2 ? ' on-dark' : ' on-light'));
    if (html) m.innerHTML = html;
    this._placeMark(m, sq);
    this._decorEl.appendChild(m);
    return m;
  };

  P._isCaptureTarget = function (to) {
    var list = this._targets[to] || [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.captured || ((m.flags | 0) & (F_CAPTURE | F_EP))) return true;
    }
    return !!this._codeAt(to);
  };

  P._removeSelMarks = function () {
    removeEl(this._selMark);
    this._selMark = null;
    for (var k in this._targetMarks) {
      if (Object.prototype.hasOwnProperty.call(this._targetMarks, k)) removeEl(this._targetMarks[k]);
    }
    this._targetMarks = {};
    this._hoverT = -1;
  };

  P._renderSelMarks = function () {
    this._removeSelMarks();
    if (this.selected < 0) return;
    this._selMark = this._mark('bv-sel', this.selected);
    if (!this.showLegal) return;
    var from = this._xy(this.selected);
    var keys = Object.keys(this._targets).map(Number);
    var self = this;
    // pop in from the nearest dot outward
    keys.sort(function (a, b) {
      var pa = self._xy(a), pb = self._xy(b);
      return (Math.abs(pa.x - from.x) + Math.abs(pa.y - from.y)) - (Math.abs(pb.x - from.x) + Math.abs(pb.y - from.y));
    });
    for (var i = 0; i < keys.length; i++) {
      var to = keys[i];
      // a lesson star would hide a dot: such targets get a ring that shows around the star
      var ring = this._isCaptureTarget(to) || !!this._stars[to];
      var m = this._mark(ring ? 'bv-target bv-capture' : 'bv-target bv-dot', to);
      m.style.setProperty('--d', Math.min(i * 16, 260) + 'ms');
      this._targetMarks[to] = m;
    }
  };

  P._setHoverTarget = function (sq) {
    if (sq === this._hoverT) return;
    var old = this._targetMarks[this._hoverT];
    if (old) old.classList.remove('is-hover');
    this._hoverT = sq;
    var m = sq >= 0 ? this._targetMarks[sq] : null;
    if (m) m.classList.add('is-hover');
  };

  P._setDragHover = function (sq) {
    if (sq !== this._hoverSq) {
      this._hoverSq = sq;
      if (sq < 0) {
        removeEl(this._hoverMark);
        this._hoverMark = null;
      } else if (!this._hoverMark) {
        this._hoverMark = this._mark('bv-hover', sq);
      } else {
        this._placeMark(this._hoverMark, sq);
      }
    }
    this._setHoverTarget(sq >= 0 && this._targets[sq] ? sq : -1);
  };

  // ------------------------------------------------------------------ selection

  P._canSelect = function (sq, code) {
    if (!this.interactive || !code) return false;
    if (typeof this.opts.canSelect !== 'function') return true;
    return !!safeCall(this.opts.canSelect, null, [sq, code]);
  };

  P._select = function (sq, silent) {
    var e = this._pieces[sq];
    if (!e) return false;
    if (this.selected === sq) return true;
    this._clearSelection();
    this.selected = sq;
    this._selEl = e;
    e.classList.add('is-selected');

    var list = safeCall(this.opts.getMoves, null, [sq]);
    var moves = [];
    var targets = {};
    if (list && typeof list.length === 'number') {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (!m) continue;
        var f = m.from === undefined ? sq : toSq(m.from);
        var to = toSq(m.to);
        if (f !== sq || to < 0 || to === sq) continue;
        moves.push(m);
        (targets[to] || (targets[to] = [])).push(m);
      }
    }
    this._moves = moves;
    this._targets = targets;
    this._mouseSq = -2;
    this._renderSelMarks();
    if (!silent) {
      playSound('select');
      safeCall(this.opts.onSelect, null, [sq]);
    }
    return true;
  };

  P._clearSelection = function () {
    if (this._selEl) this._selEl.classList.remove('is-selected');
    this._selEl = null;
    this.selected = -1;
    this._selByApi = false;
    this._moves = [];
    this._targets = {};
    this._removeSelMarks();
    this._setDragHover(-1);
    this._mouseSq = -2;
  };

  P._userDeselect = function () {
    if (this.selected < 0) return;
    this._clearSelection();
    safeCall(this.opts.onDeselect, null, []);
  };

  // ------------------------------------------------------------------ input

  P._bind = function () {
    var self = this;
    var h = this._h = {
      down: function (e) { self._onDown(e); },
      move: function (e) { self._onMove(e); },
      up: function (e) { self._onUp(e); },
      cancel: function (e) { self._onCancel(e); },
      leave: function () { self._onLeave(); },
      prevent: function (e) { e.preventDefault(); },
      winMove: function (e) { self._onWinMove(e); },
      winOut: function (e) { if (!e.relatedTarget) self._resetLook(); },
      blur: function () { self._cancelPress(); self._resetLook(); },
      key: function (e) { self._onKey(e); },
      promoDown: function (e) { self._onPromoDown(e); },
      promoClick: function (e) { self._onPromoClick(e); },
      eyeTick: function () { self._eyeTick(); }
    };
    var b = this._boardEl;
    b.addEventListener('pointerdown', h.down);
    b.addEventListener('pointermove', h.move);
    b.addEventListener('pointerup', h.up);
    b.addEventListener('pointercancel', h.cancel);
    b.addEventListener('lostpointercapture', h.cancel);
    b.addEventListener('pointerleave', h.leave);
    b.addEventListener('contextmenu', h.prevent);
    b.addEventListener('dragstart', h.prevent);
    this._promoEl.addEventListener('pointerdown', h.promoDown);
    this._promoEl.addEventListener('click', h.promoClick);
    global.addEventListener('pointermove', h.winMove, { passive: true });
    global.addEventListener('pointerout', h.winOut, { passive: true });
    global.addEventListener('blur', h.blur);
    doc.addEventListener('keydown', h.key);
  };

  P._unbind = function () {
    var h = this._h;
    if (!h) return;
    var b = this._boardEl;
    b.removeEventListener('pointerdown', h.down);
    b.removeEventListener('pointermove', h.move);
    b.removeEventListener('pointerup', h.up);
    b.removeEventListener('pointercancel', h.cancel);
    b.removeEventListener('lostpointercapture', h.cancel);
    b.removeEventListener('pointerleave', h.leave);
    b.removeEventListener('contextmenu', h.prevent);
    b.removeEventListener('dragstart', h.prevent);
    this._promoEl.removeEventListener('pointerdown', h.promoDown);
    this._promoEl.removeEventListener('click', h.promoClick);
    global.removeEventListener('pointermove', h.winMove, { passive: true });
    global.removeEventListener('pointerout', h.winOut, { passive: true });
    global.removeEventListener('blur', h.blur);
    doc.removeEventListener('keydown', h.key);
    this._h = null;
  };

  P._onDown = function (e) {
    if (this._destroyed || this._promo) return;
    if (e.isPrimary === false) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this._press) {
      if (this._press.id !== e.pointerId) return;   // another finger is busy
      this._cancelPress();                          // stale press (missed pointerup)
    }
    unlockSound();
    if (!this.interactive) return;
    if (Date.now() < this._spinUntil) return;
    var sq = this._sqFromPoint(e.clientX, e.clientY);
    if (sq < 0) return;
    if (e.cancelable) e.preventDefault();

    // 1) a legal target of the selected piece → move (click-click)
    if (this.selected >= 0 && this._targets[sq]) {
      this._tryMove(this.selected, sq, false);
      return;
    }

    var code = this._codeAt(sq);

    // 2) a piece the user may pick up → select (or keep) and arm dragging
    if (code && this._canSelect(sq, code)) {
      // a piece pre-selected via select() (lessons) is not toggled off by the child's first click on it
      var wasSelected = this.selected === sq && !this._selByApi;
      this._selByApi = false;
      if (!wasSelected && !this._select(sq, false)) return;
      if (this.selected !== sq) return;   // callbacks changed the selection
      this._press = {
        id: e.pointerId,
        sq: sq,
        x: e.clientX,
        y: e.clientY,
        el: this._pieces[sq],
        wasSelected: wasSelected,
        dragging: false,
        touch: e.pointerType === 'touch' || e.pointerType === 'pen'
      };
      try { this._boardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      return;
    }

    // 3) anywhere else
    if (this.selected >= 0) {
      var from = this.selected;
      var fromCode = this._codeAt(from);
      var emptyOrEnemy = !code || (code & 24) !== (fromCode & 24);
      this._userDeselect();
      if (emptyOrEnemy) {
        this.shakePiece(from);
        playSound('illegal');
        safeCall(this.opts.onIllegal, null, [from, sq]);
      }
      return;
    }
    safeCall(this.opts.onSquareClick, null, [sq]);
  };

  P._onMove = function (e) {
    if (this._destroyed) return;
    var p = this._press;
    if (p && e.pointerId === p.id) {
      if (!p.dragging) {
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
        if (!p.el || this._pieces[p.sq] !== p.el) {
          this._cancelPress();
          return;
        }
        p.dragging = true;
        p.el.classList.remove('is-moving');
        p.el.classList.add('is-dragging');
        this.root.classList.add('is-dragging');
        this._setHoverTarget(-1);
      }
      if (e.cancelable) e.preventDefault();
      this._dragTo(p, e.clientX, e.clientY);
      return;
    }
    if (!p && e.pointerType === 'mouse') this._mouseHover(this._sqFromPoint(e.clientX, e.clientY));
  };

  P._dragLift = function (p) {
    if (!p.touch) return 0;
    var r = this._boardEl.getBoundingClientRect();
    return r.width / 8 * 0.35;   // lift the piece above the finger so the child can see it
  };

  // Square under a dragged piece: the lifted point, or the finger's own square when the lift pushes the point
  // past the top edge (finger in the upper part of a top-rank square). A finger off the board stays off (-1).
  P._dragSq = function (p, cx, cy) {
    var lift = this._dragLift(p);
    var sq = this._sqFromPoint(cx, cy - lift);
    if (sq < 0 && lift) {
      var f = this._sqFromPoint(cx, cy);
      if (f >= 0) sq = f;
    }
    return sq;
  };

  P._dragTo = function (p, cx, cy) {
    var r = this._boardEl.getBoundingClientRect();
    if (!r.width) return;
    var s = r.width / 8;
    var lift = this._dragLift(p);
    var px = cx - r.left - s / 2;
    var py = cy - r.top - s / 2 - lift;
    p.el.style.transform = 'translate(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
    this._setDragHover(this._dragSq(p, cx, cy));
  };

  P._endDragVisual = function (el) {
    if (el) el.classList.remove('is-dragging');
    this.root.classList.remove('is-dragging');
    this._eyeOthersAt = 0;   // the next eye tick refreshes every piece
    this._setDragHover(-1);
  };

  P._returnPiece = function (el, sq) {
    this._endDragVisual(el);
    if (el && this._pieces[sq] === el) this._place(el, sq);
  };

  P._releaseCapture = function (id) {
    try {
      if (this._boardEl.hasPointerCapture && this._boardEl.hasPointerCapture(id)) this._boardEl.releasePointerCapture(id);
    } catch (err) { /* ignore */ }
  };

  P._onUp = function (e) {
    var p = this._press;
    if (!p || e.pointerId !== p.id) return;
    this._press = null;
    this._releaseCapture(p.id);
    if (this._destroyed) return;

    if (!p.dragging) {
      if (p.wasSelected && this.selected === p.sq) this._userDeselect();
      return;
    }

    var sq = this._dragSq(p, e.clientX, e.clientY);
    var from = p.sq;
    if (this._pieces[from] !== p.el) {          // position changed under the finger
      this._endDragVisual(p.el);
      return;
    }
    if (sq < 0 || sq === from) {                 // back home / off the board: stays selected
      this._returnPiece(p.el, from);
      return;
    }
    if (this.selected === from && this._targets[sq]) {
      this._tryMove(from, sq, true);
      return;
    }
    this._returnPiece(p.el, from);
    this.shakePiece(from);
    playSound('illegal');
    safeCall(this.opts.onIllegal, null, [from, sq]);
  };

  P._onCancel = function (e) {
    var p = this._press;
    if (!p || e.pointerId !== p.id) return;
    this._cancelPress();
  };

  P._cancelPress = function () {
    var p = this._press;
    if (!p) return;
    this._press = null;
    this._releaseCapture(p.id);
    if (p.dragging) this._returnPiece(p.el, p.sq);
  };

  P._onLeave = function () {
    if (this._press) return;
    this._mouseSq = -2;
    this._boardEl.style.cursor = '';
    this._setHoverTarget(-1);
  };

  P._mouseHover = function (sq) {
    if (sq === this._mouseSq) return;
    this._mouseSq = sq;
    var cursor = '';
    var isTarget = this.selected >= 0 && sq >= 0 && !!this._targets[sq];
    if (this.interactive && sq >= 0 && !this._promo) {
      if (isTarget) cursor = 'pointer';
      else {
        var code = this._codeAt(sq);
        if (code && this._canSelect(sq, code)) cursor = 'grab';
      }
    }
    this._boardEl.style.cursor = cursor;
    this._setHoverTarget(isTarget ? sq : -1);
  };

  P._onKey = function (e) {
    if (this._destroyed) return;
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (this._promo) {
      e.preventDefault();
      this._cancelPromo();
    } else if (this._press && this._press.dragging) {
      this._cancelPress();
    } else if (this.selected >= 0 && this._isVisible()) {
      this._userDeselect();
    }
  };

  P._isVisible = function () {
    var r = this._boardEl.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // ------------------------------------------------------------------ making a move

  P._tryMove = function (from, to, dragged) {
    var cands = this._targets[to] || [];
    var promos = [];
    for (var i = 0; i < cands.length; i++) {
      var pr = cands[i].promotion | 0;
      if (pr && promos.indexOf(pr) < 0) promos.push(pr);
    }
    if (promos.length) {
      this._openPromo(from, to, promos, dragged);
      return;
    }
    this._commit(from, to, 0, dragged);
  };

  P._commit = function (from, to, promotion, dragged) {
    var e = this._pieces[from];
    this._clearSelection();
    if (e && dragged) {
      this._endDragVisual(e);
      e.classList.add('is-moving');                   // stay above a piece that is about to be captured
      if (!this._isAt(e, to)) this._placeInstant(e, to); // show the piece where it was dropped
    }
    var ver = this._version;
    // `dragged` is an extra hint for the controller; applyMove also detects it on its own
    safeCall(this.opts.onMove, null, [{ from: from, to: to, promotion: promotion | 0, dragged: !!dragged }]);
    if (this._destroyed || this._version !== ver) return;
    // The controller has not applied the move (yet): if it never does, bring displaced pieces home.
    var self = this;
    clearTimeout(this._pendingTimer);
    this._pendingTimer = setTimeout(function () {
      self._pendingTimer = 0;
      if (!self._destroyed && self._version === ver && !self._press && !self._promo) self._relayout();
    }, UNAPPLIED_MS);
  };

  // ------------------------------------------------------------------ promotion picker

  P._openPromo = function (from, to, types, dragged) {
    var e = this._pieces[from];
    var color = e ? colorOf(e._code) : ((to >> 4) === 0 ? 'w' : 'b');
    var list = [];
    for (var i = 0; i < PROMO_ORDER.length; i++) if (types.indexOf(PROMO_ORDER[i]) >= 0) list.push(PROMO_ORDER[i]);
    if (!list.length) list.push(QUEEN);

    if (e) {
      if (dragged) {
        this._endDragVisual(e);
        e.classList.add('is-moving');
        this._placeInstant(e, to);
      } else {
        e.classList.add('is-moving');
        this._place(e, to);
        this._hop(e, false);
      }
    }
    this._promo = { from: from, to: to, el: e, color: color, dragged: !!dragged };
    this.root.classList.add('is-promoting');
    this._setHoverTarget(-1);

    var p = this._xy(to);
    var below = p.y < 4;
    var html = '<div class="bv-promo-card ' + (below ? 'is-below' : 'is-above') + '" role="dialog" aria-modal="true"' +
      ' aria-label="Выбери новую фигуру">' +
      '<button type="button" class="bv-promo-close" data-act="cancel" aria-label="Отмена">✕</button>' +
      '<div class="bv-promo-title">Во что превратится пешка?</div><div class="bv-promo-opts">';
    for (var j = 0; j < list.length; j++) {
      var t = list[j];
      var code = (color === 'b' ? BLACK : WHITE) | t;
      html += '<button type="button" class="bv-promo-opt' + (t === QUEEN ? ' is-best' : '') + '" data-type="' + t + '">' +
        '<span class="bv-promo-art">' + pieceMarkup(code) + '</span>' +
        '<span class="bv-promo-label">' + PROMO_LABELS[t] + '</span>' +
        (t === QUEEN ? '<span class="bv-promo-badge" aria-hidden="true">★</span>' : '') +
        '</button>';
    }
    html += '</div></div>';
    this._promoEl.innerHTML = html;
    this._promoEl.classList.add('is-open');

    var card = this._promoEl.firstChild;
    var W = 88;
    var center = (p.x + 0.5) * 12.5;
    var left = Math.max(1.5, Math.min(100 - W - 1.5, center - W / 2));
    card.style.width = W + '%';
    card.style.left = left + '%';
    card.style.setProperty('--tip', ((center - left) / W * 100).toFixed(2) + '%');
    if (below) card.style.top = ((p.y + 1) * 12.5 + 2.5) + '%';
    else card.style.bottom = ((8 - p.y) * 12.5 + 2.5) + '%';

    playSound('pop');
  };

  P._closePromo = function () {
    if (!this._promo) return null;
    var pr = this._promo;
    this._promo = null;
    this.root.classList.remove('is-promoting');
    this._promoEl.classList.remove('is-open');
    this._promoEl.innerHTML = '';
    return pr;
  };

  P._cancelPromo = function () {
    var pr = this._closePromo();
    if (!pr || !pr.el) return;
    var el = pr.el;
    if (this._pieces[pr.from] === el) this._place(el, pr.from);
    setTimeout(function () {
      if (!el.classList.contains('is-dragging')) el.classList.remove('is-moving');
    }, SLIDE_MS + 40);
  };

  P._onPromoDown = function (e) {
    if (!this._promo) return;
    var t = e.target;
    if (t && t.closest && t.closest('.bv-promo-card')) return;   // buttons handle the click
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    this._cancelPromo();
  };

  P._onPromoClick = function (e) {
    if (!this._promo) return;
    var t = e.target && e.target.closest ? e.target.closest('[data-type],[data-act]') : null;
    if (!t) return;
    if (t.getAttribute('data-act') === 'cancel') {
      this._cancelPromo();
      return;
    }
    var type = Number(t.getAttribute('data-type')) | 0;
    if (!PROMO_LABELS[type]) return;
    var pr = this._closePromo();
    if (pr) this._commit(pr.from, pr.to, type, pr.dragged);
  };

  // ------------------------------------------------------------------ eyes follow the pointer

  P._onWinMove = function (e) {
    if (this._destroyed || !this.faces) return;
    this._ptr = { x: e.clientX, y: e.clientY };
    if (!this._eyeRaf && global.requestAnimationFrame) this._eyeRaf = global.requestAnimationFrame(this._h.eyeTick);
  };

  P._eyeTick = function () {
    this._eyeRaf = 0;
    if (this._destroyed || !this.faces || !this._ptr) return;
    var r = this._boardEl.getBoundingClientRect();
    if (!r.width) return;
    var s = r.width / 8, range = s * 1.6, ptr = this._ptr;
    var drag = this._press && this._press.dragging ? this._press.el : null;
    // Restyling every piece SVG each frame is costly: while dragging, the other pieces follow ~7 times a second
    // (their pupil transition smooths the steps), and tiny look changes are skipped altogether.
    var now = Date.now();
    var doOthers = !drag || !this._eyeOthersAt || now - this._eyeOthersAt >= EYE_DRAG_MS;
    if (doOthers) this._eyeOthersAt = drag ? now : 0;
    this._eachPiece(function (e) {
      var lx = 0, ly = 0;
      if (e === drag) {
        ly = -1.1;
      } else {
        if (!doOthers) return;
        var dx = ptr.x - (r.left + (e._x + 0.5) * s);
        var dy = ptr.y - (r.top + (e._y + 0.45) * s);
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > 2) {
          var f = Math.min(1, d / range) * 1.3 / d;
          lx = r1(Math.max(-1.3, Math.min(1.3, dx * f)));
          ly = r1(Math.max(-1.3, Math.min(1.3, dy * f)));
        }
        if (e._lx !== undefined && Math.abs(e._lx - lx) < EYE_MIN_STEP && Math.abs(e._ly - ly) < EYE_MIN_STEP) return;
      }
      if (e._lx !== lx || e._ly !== ly) {
        e._lx = lx;
        e._ly = ly;
        e.style.setProperty('--look-x', String(lx));
        e.style.setProperty('--look-y', String(ly));
      }
    });
    this._lookActive = true;
    // others were skipped: one trailing tick so their eyes settle once the pointer stops
    if (!doOthers && !this._eyeTrail) {
      var self = this;
      this._eyeTrail = setTimeout(function () {
        self._eyeTrail = 0;
        if (!self._destroyed && !self._eyeRaf && self._ptr) self._eyeTick();
      }, EYE_DRAG_MS + 10);
    }
  };

  P._resetLook = function () {
    this._ptr = null;
    this._eyeOthersAt = 0;
    clearTimeout(this._eyeTrail);
    this._eyeTrail = 0;
    if (this._eyeRaf && global.cancelAnimationFrame) global.cancelAnimationFrame(this._eyeRaf);
    this._eyeRaf = 0;
    if (!this._lookActive) return;
    this._lookActive = false;
    this._eachPiece(function (e) {
      e._lx = e._ly = undefined;
      e.style.removeProperty('--look-x');
      e.style.removeProperty('--look-y');
    });
  };

  // ------------------------------------------------------------------ public API: position

  P.setPosition = function (chess, o) {
    if (this._destroyed) return;
    o = o || {};
    this._version++;
    clearTimeout(this._pendingTimer);
    this._pendingTimer = 0;
    this._cancelPress();
    this._closePromo();
    this._clearSelection();
    this._resetStates();
    var board = boardOf(chess);
    this.root.classList.add('bv-instant');
    if (board) {
      this._sync(board);
    } else {
      this._eachPiece(function (e, sq) {
        this._pieces[sq] = null;
        removeEl(e);
      });
    }
    this._relayout();
    void this.root.offsetWidth;
    this.root.classList.remove('bv-instant');
    var lm = o.lastMove;
    if (lm && toSq(lm.from) >= 0 && toSq(lm.to) >= 0) this.setLastMove(lm.from, lm.to);
    else this.clearLastMove();
  };

  P.applyMove = function (move, chessAfter, o) {
    if (this._destroyed) return Promise.resolve();
    o = o || {};
    var self = this;
    var animate = o.animate !== false;
    var reduced = reducedMotion();
    var ver = ++this._version;
    clearTimeout(this._pendingTimer);
    this._pendingTimer = 0;
    this._cancelPress();
    this._closePromo();
    this._clearSelection();
    var board = boardOf(chessAfter);
    var from = toSq(move && move.from), to = toSq(move && move.to);
    var mover = from >= 0 ? this._pieces[from] : null;

    if (from < 0 || to < 0 || from === to || !mover) {
      if (board) this._syncInstant(board);
      if (from >= 0 && to >= 0 && from !== to) this.setLastMove(from, to);
      return Promise.resolve();
    }

    this._eachPiece(function (e) { this._untip(e); });

    var moverCode = mover._code;
    var type = moverCode & 7;
    var flags = move.flags | 0;
    var sameRow = (from >> 4) === (to >> 4);
    var isCastle = type === KING && sameRow && ((flags & F_CASTLE) || Math.abs((from & 7) - (to & 7)) === 2);
    var isEP = type === PAWN && (from & 7) !== (to & 7) &&
      ((flags & F_EP) || (!this._pieces[to] && !(board && validCode(board[(from & 0x70) | (to & 7)]))));
    var capSq = isEP ? ((from & 0x70) | (to & 7)) : to;
    var capEl = capSq !== from ? this._pieces[capSq] : null;
    if (capEl && isEP && validCode(capEl._code) && (capEl._code & 7) !== PAWN) capEl = null;
    if (capEl) this._pieces[capSq] = null;

    var atTarget = this._isAt(mover, to);
    this._movePieceInMap(mover, from, to);

    // promotion: data-code now, the art is swapped after the slide
    var newCode = moverCode;
    var promo = move.promotion | 0;
    if (type === PAWN && promo >= KNIGHT && promo <= QUEEN) newCode = (moverCode & 24) | promo;
    else if (board && validCode(board[to]) && validCode(board[to]) !== moverCode && (board[to] & 24) === (moverCode & 24)) {
      newCode = validCode(board[to]);
    }
    if (newCode !== moverCode) {
      mover._code = newCode;
      mover.setAttribute('data-code', String(newCode));
      mover.classList.toggle('side-w', colorOf(newCode) === 'w');
      mover.classList.toggle('side-b', colorOf(newCode) === 'b');
    }

    // castling: the rook slides too
    var rookEl = null, rookTo = -1;
    if (isCastle) {
      var row = from & 0x70;
      var kingSide = (to & 7) > (from & 7);
      var rookFrom = row | (kingSide ? 7 : 0);
      rookTo = row | (kingSide ? 5 : 3);
      rookEl = this._pieces[rookFrom];
      if (rookEl && (rookEl._code & 7) === ROOK && rookFrom !== rookTo && !this._pieces[rookTo]) {
        this._movePieceInMap(rookEl, rookFrom, rookTo);
      } else {
        rookEl = null;
      }
    }

    var slide = animate && !atTarget && !o.dragged;
    mover.classList.remove('is-dragging');
    if (slide) {
      mover.classList.add('is-moving');
      this._place(mover, to);
      this._hop(mover, type === KNIGHT);
    } else {
      this._placeInstant(mover, to);
    }
    if (rookEl) {
      if (animate) {
        rookEl.classList.add('is-moving');
        this._place(rookEl, rookTo);
        this._hop(rookEl, false);
      } else {
        this._placeInstant(rookEl, rookTo);
      }
    }
    if (capEl) this._poof(capEl, animate ? (slide ? (reduced ? 60 : 170) : 30) : 0, animate);

    this.setLastMove(from, to);
    this._refreshAuto();

    var finish = function () {
      mover.classList.remove('is-moving');
      if (rookEl) rookEl.classList.remove('is-moving');
      if (self._destroyed) return;
      if (mover._artCode !== mover._code && self._pieces[mover._sq] === mover) self._swapArt(mover, animate);
      if (self._version === ver && board) self._sync(board);
    };

    if (!animate) {
      finish();
      return Promise.resolve();
    }
    if (newCode !== moverCode) {
      setTimeout(function () {
        if (!self._destroyed && self._pieces[mover._sq] === mover) self._swapArt(mover, true);
      }, slide ? (reduced ? 120 : SLIDE_MS) : 60);
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        finish();
        resolve();
      }, reduced ? 160 : SETTLE_MS);
    });
  };

  P._syncInstant = function (board) {
    this.root.classList.add('bv-instant');
    this._sync(board);
    this._relayout();
    void this.root.offsetWidth;
    this.root.classList.remove('bv-instant');
  };

  P.undoMove = function (move, chessAfter, o) {
    if (this._destroyed) return Promise.resolve();
    o = o || {};
    var self = this;
    var animate = o.animate !== false;
    var reduced = reducedMotion();
    var ver = ++this._version;
    clearTimeout(this._pendingTimer);
    this._pendingTimer = 0;
    this._cancelPress();
    this._closePromo();
    this._clearSelection();
    this._resetStates();   // the king stands up again, winners stop celebrating

    var board = boardOf(chessAfter);
    var from = toSq(move && move.from), to = toSq(move && move.to);
    var e = to >= 0 ? this._pieces[to] : null;

    // previous last move from the engine history, if available
    var prev = null;
    if (chessAfter && typeof chessAfter.history === 'function') {
      var h = safeCall(chessAfter.history, chessAfter, []);
      if (h && h.length) prev = h[h.length - 1];
    }
    var setPrevLast = function () {
      if (prev && toSq(prev.from) >= 0 && toSq(prev.to) >= 0) self.setLastMove(prev.from, prev.to);
      else self.clearLastMove();
    };

    if (from < 0 || to < 0 || from === to || !e || !board || this._pieces[from]) {
      if (board) this._syncInstant(board);
      setPrevLast();
      return Promise.resolve();
    }

    var origCode = validCode(board[from]) || validCode(move.piece) || e._code;
    var type = origCode & 7;
    var flags = move.flags | 0;
    this._movePieceInMap(e, to, from);
    if (origCode !== e._code) this._setCode(e, origCode);   // un-promote right away

    // castling rook back
    var rookEl = null, rookFrom = -1;
    var sameRow = (from >> 4) === (to >> 4);
    if (type === KING && sameRow && ((flags & F_CASTLE) || Math.abs((from & 7) - (to & 7)) === 2)) {
      var row = from & 0x70;
      var kingSide = (to & 7) > (from & 7);
      rookFrom = row | (kingSide ? 7 : 0);
      var rookNow = row | (kingSide ? 5 : 3);
      rookEl = this._pieces[rookNow];
      if (rookEl && (rookEl._code & 7) === ROOK && !this._pieces[rookFrom]) this._movePieceInMap(rookEl, rookNow, rookFrom);
      else rookEl = null;
    }

    // captured piece comes back
    var isEP = type === PAWN && (from & 7) !== (to & 7) && ((flags & F_EP) || !validCode(board[to]));
    var capSq = isEP ? ((from & 0x70) | (to & 7)) : to;
    var capCode = validCode(board[capSq]) || (isEP ? 0 : validCode(move.captured));
    var capEl = null;
    if (capCode && !this._pieces[capSq]) {
      capEl = this._createPiece(capCode, capSq);
      this._pieces[capSq] = capEl;
      if (animate) {
        capEl.classList.add('is-appearing');
        capEl._inner.style.animationDelay = (reduced ? 0 : 120) + 'ms';
        setTimeout(function () {
          capEl.classList.remove('is-appearing');
          capEl._inner.style.animationDelay = '';
        }, 700);
      }
    }

    if (animate) {
      e.classList.add('is-moving');
      this._place(e, from);
      this._hop(e, type === KNIGHT);
      if (rookEl) {
        rookEl.classList.add('is-moving');
        this._place(rookEl, rookFrom);
      }
    } else {
      this._placeInstant(e, from);
      if (rookEl) this._placeInstant(rookEl, rookFrom);
    }
    setPrevLast();
    this._refreshAuto();

    var finish = function () {
      e.classList.remove('is-moving');
      if (rookEl) rookEl.classList.remove('is-moving');
      if (!self._destroyed && self._version === ver) self._sync(board);
    };
    if (!animate) {
      finish();
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        finish();
        resolve();
      }, reduced ? 160 : SETTLE_MS);
    });
  };

  // ------------------------------------------------------------------ public API: settings

  P.setOrientation = function (o) {
    if (this._destroyed) return;
    o = o === 'b' ? 'b' : 'w';
    if (o === this.orientation) return;
    this._cancelPress();
    this._cancelPromo();
    this.orientation = o;
    this._updateRootClasses();
    this._renderCoords();
    this._labelSquares();

    this.root.classList.add('bv-instant');
    this._relayout();
    var marks = this._decorEl.children;
    for (var i = 0; i < marks.length; i++) if (marks[i]._sq !== undefined) this._placeMark(marks[i], marks[i]._sq);
    var flying = this._overEl.children;
    for (var j = 0; j < flying.length; j++) if (flying[j]._sq !== undefined) this._placeMark(flying[j], flying[j]._sq);
    for (var k = 0; k < this._arrows.length; k++) this._drawArrow(this._arrows[k]);
    void this.root.offsetWidth;
    this.root.classList.remove('bv-instant');
    this._mouseSq = -2;

    // playful 180° spin (pieces counter-rotate so they stay upright)
    if (!reducedMotion() && this._isVisible()) {
      var b = this._boardEl, self = this;
      b.classList.remove('bv-spin');
      void b.offsetWidth;
      b.classList.add('bv-spin');
      this._spinUntil = Date.now() + SPIN_MS;
      clearTimeout(this._spinTimer);
      this._spinTimer = setTimeout(function () {
        self._spinTimer = 0;
        b.classList.remove('bv-spin');
      }, SPIN_MS + 40);
    }
  };

  P.flip = function () {
    this.setOrientation(this.orientation === 'w' ? 'b' : 'w');
  };

  P.setTheme = function (id) {
    if (this._destroyed) return;
    this.theme = themeId(id);
    this._updateRootClasses();
  };

  P.setFaces = function (on) {
    if (this._destroyed) return;
    this.faces = !!on;
    if (!this.faces) this._resetLook();
    this._updateRootClasses();
  };

  P.setShowLegal = function (on) {
    if (this._destroyed) return;
    this.showLegal = !!on;
    this._renderSelMarks();
  };

  P.setShowCoords = function (on) {
    if (this._destroyed) return;
    this.showCoords = !!on;
    this._updateRootClasses();
  };

  P.setInteractive = function (on) {
    if (this._destroyed) return;
    this.interactive = !!on;
    if (!this.interactive) {
      this._cancelPress();
      this._cancelPromo();
      this._clearSelection();
      this._boardEl.style.cursor = '';
    }
    this._mouseSq = -2;
    this._updateRootClasses();
  };

  // ------------------------------------------------------------------ public API: highlights

  P.setLastMove = function (from, to) {
    if (this._destroyed) return;
    for (var i = 0; i < this._lastMarks.length; i++) removeEl(this._lastMarks[i]);
    this._lastMarks = [];
    from = toSq(from);
    to = toSq(to);
    if (from < 0 || to < 0) {
      this._lastMove = null;
      return;
    }
    this._lastMove = { from: from, to: to };
    this._lastMarks.push(this._mark('bv-last bv-last-from', from));
    this._lastMarks.push(this._mark('bv-last bv-last-to', to));
  };

  P.clearLastMove = function () {
    this.setLastMove(-1, -1);
  };

  P.setCheck = function (sq) {
    if (this._destroyed) return;
    sq = toSq(sq);
    if (sq !== this._check) {
      removeEl(this._checkMark);
      this._checkMark = null;
      this._check = sq;
      if (sq >= 0) this._checkMark = this._mark('bv-check', sq);
    }
    this._refreshAuto();
  };

  P.setDanger = function (list) {
    if (this._destroyed) return;
    for (var i = 0; i < this._dangerMarks.length; i++) removeEl(this._dangerMarks[i]);
    this._dangerMarks = [];
    this._danger = [];
    if (list && typeof list.length === 'number') {
      for (var j = 0; j < list.length; j++) {
        var item = list[j];
        var sq = toSq(item && typeof item === 'object' ? item.sq : item);
        if (sq < 0 || this._danger.indexOf(sq) >= 0) continue;
        this._danger.push(sq);
        this._dangerMarks.push(this._mark('bv-danger', sq, '<i></i>'));
      }
    }
    this._refreshAuto();
  };

  P.setPieceState = function (sq, state, durationMs) {
    if (this._destroyed) return;
    var e = this._pieces[toSq(sq)] || null;
    if (!e) return;
    this._setElState(e, state || null, durationMs | 0);
  };

  P.setSideState = function (side, state, durationMs) {
    if (this._destroyed) return;
    var want = side === 'b' || side === BLACK ? 'b' : (side === 'w' || side === WHITE ? 'w' : null);
    if (!want) return;
    this._eachPiece(function (e) {
      if (colorOf(e._code) === want) this._setElState(e, state || null, durationMs | 0);
    });
  };

  P.tipKing = function (sq) {
    if (this._destroyed) return;
    sq = toSq(sq);
    var e = sq >= 0 ? this._pieces[sq] : null;
    if (!e) return;
    if (this._selEl === e) this._clearSelection();
    e._tipped = true;
    e.classList.remove('is-tipped');
    void e.offsetWidth;
    e.classList.add('is-tipped');
    this._setElState(e, 'dizzy', 0);
    if (!reducedMotion()) {
      var self = this;
      setTimeout(function () {
        if (self._destroyed || !e._tipped || !e.parentNode) return;
        var c = self.squareCenter(e._sq);
        var r = self._boardEl.getBoundingClientRect();
        fxBurst(c.x + r.width / 16, c.y + r.width / 40, { count: 12, shape: 'circle', speed: 0.5, colors: ['#ffffff', '#e8e4f7', '#d4cdef'] });
        fxBurst(c.x, c.y - r.width / 32, { count: 6, shape: 'star', speed: 0.45, colors: ['#ffe27a', '#ffc93c'] });
      }, 560);
    }
  };

  P.shakePiece = function (sq) {
    if (this._destroyed) return;
    sq = toSq(sq);
    var e = sq >= 0 ? this._pieces[sq] : null;
    if (e) restartAnim(e, 'bv-shake', 560);
  };

  // ------------------------------------------------------------------ public API: arrows

  P.showArrow = function (from, to, o) {
    if (this._destroyed) return;
    o = o || {};
    from = toSq(from);
    to = toSq(to);
    if (from < 0 || to < 0 || from === to) return;
    var kind = ARROW_KINDS.indexOf(o.kind) >= 0 ? o.kind : 'hint';
    for (var i = this._arrows.length - 1; i >= 0; i--) {
      var a0 = this._arrows[i];
      if (a0.from === from && a0.to === to) {
        removeEl(a0.g);
        this._arrows.splice(i, 1);
      }
    }
    var g = doc.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'bv-arrow bv-arrow-' + kind);
    var a = { from: from, to: to, kind: kind, g: g };
    this._drawArrow(a);
    this._arrowLayer.appendChild(g);
    this._arrows.push(a);
  };

  P.clearArrows = function () {
    if (this._destroyed) return;
    for (var i = 0; i < this._arrows.length; i++) removeEl(this._arrows[i].g);
    this._arrows = [];
  };

  P._drawArrow = function (a) {
    var A = this._xy(a.from), B = this._xy(a.to);
    var pts = [[A.x * 100 + 50, A.y * 100 + 50]];
    var adx = Math.abs(B.x - A.x), ady = Math.abs(B.y - A.y);
    if (adx * ady === 2) {
      // knight: L-shaped, long leg first
      pts.push(adx === 2 ? [B.x * 100 + 50, A.y * 100 + 50] : [A.x * 100 + 50, B.y * 100 + 50]);
    }
    pts.push([B.x * 100 + 50, B.y * 100 + 50]);

    var n = pts.length;
    var Pp = pts[n - 2], Q = pts[n - 1];
    var ux = Q[0] - Pp[0], uy = Q[1] - Pp[1];
    var ul = Math.sqrt(ux * ux + uy * uy) || 1;
    ux /= ul;
    uy /= ul;
    var HEAD = 40, HALF = 25, TIP_BACK = 8, START = 16;
    var tip = [Q[0] - ux * TIP_BACK, Q[1] - uy * TIP_BACK];
    var base = [tip[0] - ux * HEAD, tip[1] - uy * HEAD];

    var S = pts[0], N = pts[1];
    var vx = N[0] - S[0], vy = N[1] - S[1];
    var vl = Math.sqrt(vx * vx + vy * vy) || 1;
    var line = pts.slice();
    line[0] = [S[0] + vx / vl * START, S[1] + vy / vl * START];
    line[n - 1] = [base[0] + ux * 3, base[1] + uy * 3];

    var fmt = function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); };
    var d = 'M' + line.map(fmt).join(' L');
    var px = -uy, py = ux;
    var head = [tip, [base[0] + px * HALF, base[1] + py * HALF], [base[0] - px * HALF, base[1] - py * HALF]]
      .map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var shape = '<path d="' + d + '"/><polygon points="' + head + '"/>';
    a.g.innerHTML = '<g class="bv-arrow-bg">' + shape + '</g>' +
      '<g class="bv-arrow-fg"' + (a.kind === 'hint' ? ' filter="url(#' + this._glowId + ')"' : '') + '>' + shape + '</g>';
  };

  // ------------------------------------------------------------------ public API: pulses & stars

  P.pulseSquare = function (sq, kind) {
    if (this._destroyed) return;
    sq = toSq(sq);
    if (sq < 0) return;
    kind = PULSE_KINDS.indexOf(kind) >= 0 ? kind : 'hint';
    removeEl(this._pulses[sq]);
    this._pulses[sq] = this._mark('bv-pulse bv-pulse-' + kind, sq, '<i></i><i></i><i></i>');
  };

  P.clearPulses = function () {
    if (this._destroyed) return;
    for (var k in this._pulses) {
      if (Object.prototype.hasOwnProperty.call(this._pulses, k)) removeEl(this._pulses[k]);
    }
    this._pulses = {};
  };

  P.setStars = function (list) {
    if (this._destroyed) return;
    this._removeStars();
    if (list && typeof list.length === 'number') {
      var art = starMarkup();
      for (var i = 0; i < list.length; i++) {
        var sq = toSq(list[i]);
        if (sq < 0 || this._stars[sq]) continue;
        var m = this._mark('bv-star', sq, '<div class="bv-star-float">' + art + '</div>');
        m.firstChild.style.animationDelay = (-Math.random() * 3).toFixed(2) + 's';
        this._stars[sq] = m;
      }
    }
    if (this.selected >= 0) this._renderSelMarks();   // targets on stars use rings
  };

  P.collectStar = function (sq) {
    if (this._destroyed) return Promise.resolve();
    sq = toSq(sq);
    var m = sq >= 0 ? this._stars[sq] : null;
    if (!m) return Promise.resolve();
    delete this._stars[sq];
    this._overEl.appendChild(m);
    m.firstChild.style.animationDelay = '';
    m.classList.add('is-collected');
    var c = this.squareCenter(sq);
    fxBurst(c.x, c.y, { count: 22, shape: 'star', speed: 1, colors: ['#ffe27a', '#ffc93c', '#ffb400', '#fff6c9'] });
    var ms = reducedMotion() ? 200 : 650;
    return new Promise(function (resolve) {
      setTimeout(function () {
        removeEl(m);
        resolve();
      }, ms);
    });
  };

  P._removeStars = function () {
    for (var k in this._stars) {
      if (Object.prototype.hasOwnProperty.call(this._stars, k)) removeEl(this._stars[k]);
    }
    this._stars = {};
  };

  P.clearStars = function () {
    if (this._destroyed) return;
    this._removeStars();
    if (this.selected >= 0) this._renderSelMarks();
  };

  // ------------------------------------------------------------------ public API: misc

  P.deselect = function () {
    if (this._destroyed) return;
    this._cancelPress();
    this._cancelPromo();
    this._clearSelection();
  };

  // Extra (not in SPEC): programmatic selection without callbacks/sound, e.g. to keep a lesson piece selected.
  // The user's first click on a piece selected this way keeps it selected (click-click still works).
  P.select = function (sq) {
    if (this._destroyed || !this.interactive) return false;
    sq = toSq(sq);
    if (sq < 0 || !this._pieces[sq]) return false;
    if (sq === this.selected) {
      // Already selected: leave a drag in progress or an open promotion picker alone (both belong to this piece).
      if (!this._press && !this._promo) this._selByApi = true;
      return true;
    }
    this._cancelPress();
    this._cancelPromo();
    var ok = this._select(sq, true);
    if (ok) this._selByApi = true;
    return ok;
  };

  P.squareCenter = function (sq) {
    var r = this._boardEl.getBoundingClientRect();
    sq = toSq(sq);
    if (sq < 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    var p = this._xy(sq), s = r.width / 8;
    return { x: r.left + (p.x + 0.5) * s, y: r.top + (p.y + 0.5) * (r.height / 8) };
  };

  P.destroy = function () {
    if (this._destroyed) return;
    this._cancelPress();
    this._closePromo();
    this._resetLook();
    this._destroyed = true;
    this._unbind();
    clearTimeout(this._pendingTimer);
    clearTimeout(this._spinTimer);
    this._pendingTimer = this._spinTimer = 0;
    this._eachPiece(function (e) {
      if (e._stateTimer) clearTimeout(e._stateTimer);
      e._stateTimer = 0;
    });
    this.root._bv = null;
    removeEl(this.root);
    this._pieces = new Array(128);
    this._arrows = [];
    this._stars = {};
    this._pulses = {};
    this.selected = -1;
  };

  global.BoardView = BoardView;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
