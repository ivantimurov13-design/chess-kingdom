/*
 * «Шахматное Королевство» — chess rules engine.
 *
 * 0x88 board (Int8Array(128)), sq = row * 16 + col, row 0 = rank 8, col 0 = file a.
 * Pieces are ints color | type (WHITE = 8, BLACK = 16; PAWN = 1 … KING = 6).
 * Pseudo-legal generation + make/unmake legality test, incremental Zobrist hashing
 * (used for repetition detection), SAN, FEN, perft and game-level history.
 * Positions without kings (lesson boards) are fully supported.
 *
 * Global: Chess (browser / worker), module.exports (node).
 */
(function (global) {
  'use strict';

  var WHITE = 8, BLACK = 16;
  var PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  var F_CAPTURE = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8, F_PROMO = 16;
  var C_WK = 1, C_WQ = 2, C_BK = 4, C_BQ = 8;
  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var VALUE = [0, 100, 320, 330, 500, 900, 0];

  var KNIGHT_OFF = [-33, -31, -18, -14, 14, 18, 31, 33];
  var BISHOP_DIR = [-17, -15, 15, 17];
  var ROOK_DIR = [-16, -1, 1, 16];
  var KING_OFF = [-17, -16, -15, -1, 1, 15, 16, 17];

  var SQ_A8 = 0, SQ_E8 = 4, SQ_H8 = 7, SQ_A1 = 112, SQ_E1 = 116, SQ_H1 = 119;

  var TYPE_CHARS = ' pnbrqk';
  var SAN_CHARS = ['', '', 'N', 'B', 'R', 'Q', 'K'];
  var FILES = 'abcdefgh';
  var PROMO_ORDER = [QUEEN, ROOK, BISHOP, KNIGHT];
  var NO_LOAD = {};

  /* castling rights removed when a piece moves from or to a square */
  var CASTLE_CLEAR = new Int8Array(128);
  CASTLE_CLEAR[SQ_A1] = C_WQ;
  CASTLE_CLEAR[SQ_H1] = C_WK;
  CASTLE_CLEAR[SQ_E1] = C_WK | C_WQ;
  CASTLE_CLEAR[SQ_A8] = C_BQ;
  CASTLE_CLEAR[SQ_H8] = C_BK;
  CASTLE_CLEAR[SQ_E8] = C_BK | C_BQ;

  /* ---------------------------------------------------------------- Zobrist keys (64 bit as two int32) */
  var zSeed = 0x2545F491;
  function rnd32() {
    zSeed ^= zSeed << 13;
    zSeed ^= zSeed >>> 17;
    zSeed ^= zSeed << 5;
    return zSeed | 0;
  }
  var Z_PIECE_LO = new Int32Array(23 * 128), Z_PIECE_HI = new Int32Array(23 * 128);
  (function () {
    for (var i = 0; i < Z_PIECE_LO.length; i++) { Z_PIECE_LO[i] = rnd32(); Z_PIECE_HI[i] = rnd32(); }
  })();
  var Z_CASTLE_LO = new Int32Array(16), Z_CASTLE_HI = new Int32Array(16);
  (function () {
    for (var i = 1; i < 16; i++) { Z_CASTLE_LO[i] = rnd32(); Z_CASTLE_HI[i] = rnd32(); }
  })();
  var Z_EP_LO = new Int32Array(8), Z_EP_HI = new Int32Array(8);
  (function () {
    for (var i = 0; i < 8; i++) { Z_EP_LO[i] = rnd32(); Z_EP_HI[i] = rnd32(); }
  })();
  var Z_TURN_LO = rnd32(), Z_TURN_HI = rnd32();

  /* ---------------------------------------------------------------- helpers */
  function newMove(from, to, piece, captured, promotion, flags) {
    return { from: from, to: to, piece: piece, captured: captured, promotion: promotion, flags: flags };
  }

  function newKings() {
    var k = new Array(17);
    for (var i = 0; i < 17; i++) k[i] = -1;
    return k;
  }

  function onBoard(sq) {
    return typeof sq === 'number' && sq >= 0 && sq < 128 && (sq | 0) === sq && !(sq & 0x88);
  }

  function sqName(sq) {
    if (!onBoard(sq)) return '';
    return FILES.charAt(sq & 7) + (8 - (sq >> 4));
  }

  function sqFromName(name) {
    if (typeof name !== 'string' || name.length !== 2) return -1;
    var f = name.toLowerCase().charCodeAt(0) - 97;
    var r = name.charCodeAt(1) - 49;
    if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
    return (7 - r) * 16 + f;
  }

  /* square argument: 0x88 int or 'e4' */
  function toSq(v) {
    if (typeof v === 'number') return onBoard(v) ? v : -1;
    if (typeof v === 'string') return sqFromName(v);
    return -1;
  }

  function typeFromChar(ch) {
    if (typeof ch !== 'string' || ch.length < 1) return 0;
    var i = TYPE_CHARS.indexOf(ch.charAt(0).toLowerCase());
    return i > 0 ? i : 0;
  }

  function pieceFromChar(ch) {
    if (typeof ch !== 'string' || ch.length !== 1) return 0;
    var t = typeFromChar(ch);
    if (!t) return 0;
    return (ch === ch.toUpperCase() ? WHITE : BLACK) | t;
  }

  function pieceChar(p) {
    var t = p & 7;
    if (!p || t < 1 || t > 6) return '';
    var c = TYPE_CHARS.charAt(t);
    return (p & 24) === WHITE ? c.toUpperCase() : c;
  }

  function validPiece(p) {
    if (typeof p !== 'number') return false;
    var t = p & 7, c = p & 24;
    return t >= 1 && t <= 6 && (c === WHITE || c === BLACK) && (p & ~31) === 0;
  }

  /* promotion argument: type int or char ('q', 'N', …) → 2..5, otherwise 0 */
  function normPromo(v) {
    var t = 0;
    if (typeof v === 'number') t = v & 7;
    else if (typeof v === 'string') t = typeFromChar(v);
    return (t >= KNIGHT && t <= QUEEN) ? t : 0;
  }

  function sanitizeCastling(b, cr) {
    if (b[SQ_E1] !== (WHITE | KING)) cr &= ~(C_WK | C_WQ);
    if (b[SQ_H1] !== (WHITE | ROOK)) cr &= ~C_WK;
    if (b[SQ_A1] !== (WHITE | ROOK)) cr &= ~C_WQ;
    if (b[SQ_E8] !== (BLACK | KING)) cr &= ~(C_BK | C_BQ);
    if (b[SQ_H8] !== (BLACK | ROOK)) cr &= ~C_BK;
    if (b[SQ_A8] !== (BLACK | ROOK)) cr &= ~C_BQ;
    return cr;
  }

  /* ep square must be the square just passed by an enemy pawn that made a double step */
  function validEp(b, ep, turn) {
    if (!onBoard(ep)) return -1;
    if (turn === WHITE) {
      if ((ep >> 4) !== 2 || b[ep] || b[ep - 16] || b[ep + 16] !== (BLACK | PAWN)) return -1;
    } else {
      if ((ep >> 4) !== 5 || b[ep] || b[ep + 16] || b[ep - 16] !== (WHITE | PAWN)) return -1;
    }
    return ep;
  }

  /* ================================================================ Chess */
  function Chess(fen) {
    this.board = new Int8Array(128);
    this.turn = WHITE;
    this.castling = 0;
    this.ep = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kings = newKings();
    this.hashLo = 0;
    this.hashHi = 0;
    this.loadError = false;
    this._ply = 0;
    this._uMove = [];
    this._uCap = [];
    this._uCastling = [];
    this._uEp = [];
    this._uHalf = [];
    this._uFull = [];
    this._uHL = [];
    this._uHH = [];
    this._history = [];
    if (fen === NO_LOAD) return;
    if (fen === undefined || fen === null) fen = START_FEN;
    if (!this.load(fen)) {
      this.load(START_FEN);
      this.loadError = true;
    }
  }

  Chess.WHITE = WHITE;
  Chess.BLACK = BLACK;
  Chess.PAWN = PAWN;
  Chess.KNIGHT = KNIGHT;
  Chess.BISHOP = BISHOP;
  Chess.ROOK = ROOK;
  Chess.QUEEN = QUEEN;
  Chess.KING = KING;
  Chess.FLAG = { CAPTURE: F_CAPTURE, EP: F_EP, CASTLE: F_CASTLE, DOUBLE: F_DOUBLE, PROMO: F_PROMO };
  Chess.CASTLE = { WK: C_WK, WQ: C_WQ, BK: C_BK, BQ: C_BQ };
  Chess.START_FEN = START_FEN;
  Chess.VALUE = VALUE;
  Chess.sqName = sqName;
  Chess.sqFromName = sqFromName;
  Chess.row = function (sq) { return sq >> 4; };
  Chess.col = function (sq) { return sq & 7; };
  Chess.sq = function (row, col) { return row * 16 + col; };
  Chess.isSquare = onBoard;
  Chess.typeChar = function (type) {
    var t = type & 7;
    return t >= 1 && t <= 6 ? TYPE_CHARS.charAt(t) : '';
  };
  Chess.typeFromChar = typeFromChar;
  Chess.colorChar = function (color) { return color === BLACK ? 'b' : 'w'; };
  Chess.colorFromChar = function (ch) { return ch === 'b' || ch === 'B' ? BLACK : WHITE; };
  Chess.pieceChar = pieceChar;
  Chess.pieceFromChar = pieceFromChar;
  /* all 64 squares in board order a8, b8 … h1 */
  Chess.SQUARES = (function () {
    var out = [];
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) out.push(r * 16 + c);
    return out;
  })();

  var P = Chess.prototype;

  /* ---------------------------------------------------------------- FEN */
  P.load = function (fen) {
    if (typeof fen !== 'string') return false;
    var parts = fen.trim().split(/\s+/);
    if (!parts.length || !parts[0]) return false;
    var rows = parts[0].split('/');
    if (rows.length !== 8) return false;
    var b = new Int8Array(128), kings = newKings();
    for (var r = 0; r < 8; r++) {
      var row = rows[r], col = 0;
      for (var i = 0; i < row.length; i++) {
        var ch = row.charAt(i);
        if (ch >= '1' && ch <= '8') {
          col += ch.charCodeAt(0) - 48;
          if (col > 8) return false;
          continue;
        }
        var p = pieceFromChar(ch);
        if (!p || col > 7) return false;
        var sq = r * 16 + col;
        b[sq] = p;
        if ((p & 7) === KING) {
          if (kings[p & 24] !== -1) return false;
          kings[p & 24] = sq;
        }
        col++;
      }
      if (col !== 8) return false;
    }
    var turnStr = parts.length > 1 ? parts[1] : 'w';
    var turn;
    if (turnStr === 'w' || turnStr === 'W') turn = WHITE;
    else if (turnStr === 'b' || turnStr === 'B') turn = BLACK;
    else return false;

    var cr = 0;
    var cs = parts.length > 2 ? parts[2] : '-';
    if (cs !== '-') {
      for (var j = 0; j < cs.length; j++) {
        var c = cs.charAt(j);
        if (c === 'K') cr |= C_WK;
        else if (c === 'Q') cr |= C_WQ;
        else if (c === 'k') cr |= C_BK;
        else if (c === 'q') cr |= C_BQ;
        else return false;
      }
    }
    cr = sanitizeCastling(b, cr);

    var ep = -1;
    var es = parts.length > 3 ? parts[3] : '-';
    if (es !== '-') {
      var e = sqFromName(es);
      if (e < 0) return false;
      ep = validEp(b, e, turn);
    }
    var half = parts.length > 4 ? parseInt(parts[4], 10) : 0;
    if (!isFinite(half) || half < 0) half = 0;
    var full = parts.length > 5 ? parseInt(parts[5], 10) : 1;
    if (!isFinite(full) || full < 1) full = 1;

    this.board.set(b);
    this.kings = kings;
    this.turn = turn;
    this.castling = cr;
    this.ep = ep;
    this.halfmove = half;
    this.fullmove = full;
    this._ply = 0;
    this._uMove.length = 0;
    this._uCap.length = 0;
    this._uCastling.length = 0;
    this._uEp.length = 0;
    this._uHalf.length = 0;
    this._uFull.length = 0;
    this._uHL.length = 0;
    this._uHH.length = 0;
    this._history = [];
    this._rehash();
    return true;
  };

  P.reset = function () { this.load(START_FEN); };

  P.fen = function () {
    var b = this.board, s = '';
    for (var r = 0; r < 8; r++) {
      var empty = 0;
      for (var c = 0; c < 8; c++) {
        var p = b[r * 16 + c];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        s += pieceChar(p);
      }
      if (empty) s += empty;
      if (r < 7) s += '/';
    }
    var cs = '';
    if (this.castling & C_WK) cs += 'K';
    if (this.castling & C_WQ) cs += 'Q';
    if (this.castling & C_BK) cs += 'k';
    if (this.castling & C_BQ) cs += 'q';
    return s + ' ' + (this.turn === WHITE ? 'w' : 'b') + ' ' + (cs || '-') + ' ' +
      (this.ep === -1 ? '-' : sqName(this.ep)) + ' ' + this.halfmove + ' ' + this.fullmove;
  };

  /* ---------------------------------------------------------------- hashing */
  /* the ep file is part of the key only when a pawn of the side to move could capture en passant */
  P._epCapturable = function () {
    var ep = this.ep, b = this.board, s;
    if (ep < 0) return false;
    if (this.turn === WHITE) {
      s = ep + 15; if (!(s & 0x88) && b[s] === (WHITE | PAWN)) return true;
      s = ep + 17; if (!(s & 0x88) && b[s] === (WHITE | PAWN)) return true;
    } else {
      s = ep - 15; if (!(s & 0x88) && b[s] === (BLACK | PAWN)) return true;
      s = ep - 17; if (!(s & 0x88) && b[s] === (BLACK | PAWN)) return true;
    }
    return false;
  };

  P._hashFromScratch = function () {
    var lo = 0, hi = 0, b = this.board;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = b[sq];
      if (p) { lo ^= Z_PIECE_LO[p * 128 + sq]; hi ^= Z_PIECE_HI[p * 128 + sq]; }
    }
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];
    if (this.ep !== -1 && this._epCapturable()) { lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7]; }
    if (this.turn === BLACK) { lo ^= Z_TURN_LO; hi ^= Z_TURN_HI; }
    return [lo, hi];
  };

  P._rehash = function () {
    var h = this._hashFromScratch();
    this.hashLo = h[0];
    this.hashHi = h[1];
  };

  /* ---------------------------------------------------------------- board access */
  P.get = function (sq) {
    sq = toSq(sq);
    return sq < 0 ? 0 : this.board[sq];
  };

  /* returns false when the square/piece is invalid or a second king of the same color would appear */
  P.put = function (sq, piece) {
    sq = toSq(sq);
    if (typeof piece === 'string') piece = pieceFromChar(piece);
    if (sq < 0 || !validPiece(piece)) return false;
    var color = piece & 24;
    if ((piece & 7) === KING && this.kings[color] !== -1 && this.kings[color] !== sq) return false;
    var old = this.board[sq];
    if (old && (old & 7) === KING && this.kings[old & 24] === sq) this.kings[old & 24] = -1;
    this.board[sq] = piece;
    if ((piece & 7) === KING) this.kings[color] = sq;
    this._afterEdit();
    return true;
  };

  /* returns the removed piece (0 when the square was empty) */
  P.remove = function (sq) {
    sq = toSq(sq);
    if (sq < 0) return 0;
    var old = this.board[sq];
    if (!old) return 0;
    this.board[sq] = 0;
    if ((old & 7) === KING && this.kings[old & 24] === sq) this.kings[old & 24] = -1;
    this._afterEdit();
    return old;
  };

  P.clear = function () {
    this.load('8/8/8/8/8/8/8/8 w - - 0 1');
  };

  P._afterEdit = function () {
    this.castling = sanitizeCastling(this.board, this.castling);
    if (this.ep !== -1) this.ep = validEp(this.board, this.ep, this.turn);
    this._rehash();
  };

  /* ---------------------------------------------------------------- attacks */
  P._att = function (sq, by) {
    var b = this.board, s, i, d, p;
    if (by === WHITE) {
      s = sq + 15; if (!(s & 0x88) && b[s] === 9) return true;
      s = sq + 17; if (!(s & 0x88) && b[s] === 9) return true;
    } else {
      s = sq - 15; if (!(s & 0x88) && b[s] === 17) return true;
      s = sq - 17; if (!(s & 0x88) && b[s] === 17) return true;
    }
    var kn = by | KNIGHT, kg = by | KING, rk = by | ROOK, bs = by | BISHOP, qn = by | QUEEN;
    for (i = 0; i < 8; i++) {
      s = sq + KNIGHT_OFF[i];
      if (!(s & 0x88) && b[s] === kn) return true;
    }
    for (i = 0; i < 4; i++) {
      d = ROOK_DIR[i]; s = sq + d;
      while (!(s & 0x88)) {
        p = b[s];
        if (p) { if (p === rk || p === qn) return true; break; }
        s += d;
      }
    }
    for (i = 0; i < 4; i++) {
      d = BISHOP_DIR[i]; s = sq + d;
      while (!(s & 0x88)) {
        p = b[s];
        if (p) { if (p === bs || p === qn) return true; break; }
        s += d;
      }
    }
    for (i = 0; i < 8; i++) {
      s = sq + KING_OFF[i];
      if (!(s & 0x88) && b[s] === kg) return true;
    }
    return false;
  };

  P.attacked = function (sq, byColor) {
    sq = toSq(sq);
    if (sq < 0 || (byColor !== WHITE && byColor !== BLACK)) return false;
    return this._att(sq, byColor);
  };

  P.attackers = function (sq, byColor) {
    sq = toSq(sq);
    var out = [];
    if (sq < 0 || (byColor !== WHITE && byColor !== BLACK)) return out;
    var b = this.board, by = byColor, s, i, d, p;
    var pw = by | PAWN;
    if (by === WHITE) {
      s = sq + 15; if (!(s & 0x88) && b[s] === pw) out.push(s);
      s = sq + 17; if (!(s & 0x88) && b[s] === pw) out.push(s);
    } else {
      s = sq - 15; if (!(s & 0x88) && b[s] === pw) out.push(s);
      s = sq - 17; if (!(s & 0x88) && b[s] === pw) out.push(s);
    }
    for (i = 0; i < 8; i++) {
      s = sq + KNIGHT_OFF[i];
      if (!(s & 0x88) && b[s] === (by | KNIGHT)) out.push(s);
    }
    for (i = 0; i < 4; i++) {
      d = BISHOP_DIR[i]; s = sq + d;
      while (!(s & 0x88)) {
        p = b[s];
        if (p) { if (p === (by | BISHOP) || p === (by | QUEEN)) out.push(s); break; }
        s += d;
      }
    }
    for (i = 0; i < 4; i++) {
      d = ROOK_DIR[i]; s = sq + d;
      while (!(s & 0x88)) {
        p = b[s];
        if (p) { if (p === (by | ROOK) || p === (by | QUEEN)) out.push(s); break; }
        s += d;
      }
    }
    for (i = 0; i < 8; i++) {
      s = sq + KING_OFF[i];
      if (!(s & 0x88) && b[s] === (by | KING)) out.push(s);
    }
    return out;
  };

  P.inCheck = function (color) {
    if (color === undefined || color === null) color = this.turn;
    if (color !== WHITE && color !== BLACK) return false;
    var k = this.kings[color];
    return k !== -1 && this._att(k, color ^ 24);
  };

  /* after make(): is the king of `color` safe? (true when that side has no king) */
  P._kingSafe = function (color) {
    var k = this.kings[color];
    return k === -1 || !this._att(k, color ^ 24);
  };

  /* ---------------------------------------------------------------- move generation */
  function addPawnMove(list, from, to, piece, captured, flags, promoRow) {
    if ((to >> 4) === promoRow) {
      for (var i = 0; i < 4; i++) list.push(newMove(from, to, piece, captured, PROMO_ORDER[i], flags | F_PROMO));
    } else {
      list.push(newMove(from, to, piece, captured, 0, flags));
    }
  }

  /* pseudo-legal moves of the side to move; only >= 0 restricts generation to one square */
  P._gen = function (list, capturesOnly, only) {
    var b = this.board, us = this.turn, them = us ^ 24;
    var start = 0, end = 119;
    if (only >= 0) { start = only; end = only; }
    for (var sq = start; sq <= end; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = b[sq];
      if (!p || (p & 24) !== us) continue;
      var t = p & 7, to, c, i, d;
      if (t === PAWN) {
        var dir = us === WHITE ? -16 : 16;
        var promoRow = us === WHITE ? 0 : 7;
        var startRow = us === WHITE ? 6 : 1;
        to = sq + dir;
        if (!(to & 0x88) && !b[to]) {
          if ((to >> 4) === promoRow) {
            addPawnMove(list, sq, to, p, 0, 0, promoRow);
          } else if (!capturesOnly) {
            list.push(newMove(sq, to, p, 0, 0, 0));
            if ((sq >> 4) === startRow) {
              var to2 = to + dir;
              if (!(to2 & 0x88) && !b[to2]) list.push(newMove(sq, to2, p, 0, 0, F_DOUBLE));
            }
          }
        }
        for (i = -1; i <= 1; i += 2) {
          to = sq + dir + i;
          if (to & 0x88) continue;
          c = b[to];
          if (c) {
            if ((c & 24) === them) addPawnMove(list, sq, to, p, c, F_CAPTURE, promoRow);
          } else if (to === this.ep) {
            list.push(newMove(sq, to, p, them | PAWN, 0, F_CAPTURE | F_EP));
          }
        }
      } else if (t === KNIGHT || t === KING) {
        var offs = t === KNIGHT ? KNIGHT_OFF : KING_OFF;
        for (i = 0; i < 8; i++) {
          to = sq + offs[i];
          if (to & 0x88) continue;
          c = b[to];
          if (!c) { if (!capturesOnly) list.push(newMove(sq, to, p, 0, 0, 0)); }
          else if ((c & 24) === them) list.push(newMove(sq, to, p, c, 0, F_CAPTURE));
        }
        if (t === KING && !capturesOnly && this.castling) this._genCastles(list, sq, p);
      } else {
        var dirs = t === BISHOP ? BISHOP_DIR : (t === ROOK ? ROOK_DIR : KING_OFF);
        var nd = dirs.length;
        for (i = 0; i < nd; i++) {
          d = dirs[i];
          to = sq + d;
          while (!(to & 0x88)) {
            c = b[to];
            if (!c) {
              if (!capturesOnly) list.push(newMove(sq, to, p, 0, 0, 0));
            } else {
              if ((c & 24) === them) list.push(newMove(sq, to, p, c, 0, F_CAPTURE));
              break;
            }
            to += d;
          }
        }
      }
    }
    return list;
  };

  P._genCastles = function (list, sq, p) {
    var b = this.board, cr = this.castling, us = p & 24, them = us ^ 24;
    if (us === WHITE) {
      if (sq !== SQ_E1 || !(cr & (C_WK | C_WQ))) return;
      if ((cr & C_WK) && !b[117] && !b[118] && b[SQ_H1] === (WHITE | ROOK) &&
          !this._att(SQ_E1, them) && !this._att(117, them) && !this._att(118, them)) {
        list.push(newMove(SQ_E1, 118, p, 0, 0, F_CASTLE));
      }
      if ((cr & C_WQ) && !b[115] && !b[114] && !b[113] && b[SQ_A1] === (WHITE | ROOK) &&
          !this._att(SQ_E1, them) && !this._att(115, them) && !this._att(114, them)) {
        list.push(newMove(SQ_E1, 114, p, 0, 0, F_CASTLE));
      }
    } else {
      if (sq !== SQ_E8 || !(cr & (C_BK | C_BQ))) return;
      if ((cr & C_BK) && !b[5] && !b[6] && b[SQ_H8] === (BLACK | ROOK) &&
          !this._att(SQ_E8, them) && !this._att(5, them) && !this._att(6, them)) {
        list.push(newMove(SQ_E8, 6, p, 0, 0, F_CASTLE));
      }
      if ((cr & C_BQ) && !b[3] && !b[2] && !b[1] && b[SQ_A8] === (BLACK | ROOK) &&
          !this._att(SQ_E8, them) && !this._att(3, them) && !this._att(2, them)) {
        list.push(newMove(SQ_E8, 2, p, 0, 0, F_CASTLE));
      }
    }
  };

  P.genMoves = function (capturesOnly) {
    return this._gen([], !!capturesOnly, -1);
  };

  /* ---------------------------------------------------------------- make / unmake */
  P.make = function (m) {
    var b = this.board, from = m.from, to = m.to, flags = m.flags | 0;
    var us = this.turn, them = us ^ 24;
    var piece = b[from];
    var i = this._ply;
    var lo = this.hashLo, hi = this.hashHi;
    var capSq = to;
    if (flags & F_EP) capSq = us === WHITE ? to + 16 : to - 16;
    var captured = b[capSq];

    this._uMove[i] = m;
    this._uCap[i] = captured;
    this._uCastling[i] = this.castling;
    this._uEp[i] = this.ep;
    this._uHalf[i] = this.halfmove;
    this._uFull[i] = this.fullmove;
    this._uHL[i] = lo;
    this._uHH[i] = hi;
    this._ply = i + 1;

    if (this.ep !== -1) {
      if (this._epCapturable()) { lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7]; }
      this.ep = -1;
    }

    var idx = piece * 128;
    lo ^= Z_PIECE_LO[idx + from]; hi ^= Z_PIECE_HI[idx + from];
    b[from] = 0;
    if (captured) {
      idx = captured * 128 + capSq;
      lo ^= Z_PIECE_LO[idx]; hi ^= Z_PIECE_HI[idx];
      b[capSq] = 0;
      if ((captured & 7) === KING && this.kings[them] === capSq) this.kings[them] = -1;
    }
    var placed = piece;
    if (flags & F_PROMO) placed = us | (normPromo(m.promotion) || QUEEN);
    b[to] = placed;
    idx = placed * 128 + to;
    lo ^= Z_PIECE_LO[idx]; hi ^= Z_PIECE_HI[idx];

    if ((piece & 7) === KING) {
      this.kings[us] = to;
      if (flags & F_CASTLE) {
        var rf, rt;
        if (to > from) { rf = to + 1; rt = to - 1; } else { rf = to - 2; rt = to + 1; }
        var rook = b[rf];
        b[rf] = 0;
        b[rt] = rook;
        lo ^= Z_PIECE_LO[rook * 128 + rf] ^ Z_PIECE_LO[rook * 128 + rt];
        hi ^= Z_PIECE_HI[rook * 128 + rf] ^ Z_PIECE_HI[rook * 128 + rt];
      }
    }

    var cr = this.castling;
    if (cr) {
      var ncr = cr & ~(CASTLE_CLEAR[from] | CASTLE_CLEAR[to]);
      if (ncr !== cr) {
        lo ^= Z_CASTLE_LO[cr] ^ Z_CASTLE_LO[ncr];
        hi ^= Z_CASTLE_HI[cr] ^ Z_CASTLE_HI[ncr];
        this.castling = ncr;
      }
    }

    if ((piece & 7) === PAWN || captured) this.halfmove = 0;
    else this.halfmove++;
    if (us === BLACK) this.fullmove++;

    this.turn = them;
    lo ^= Z_TURN_LO; hi ^= Z_TURN_HI;

    if (flags & F_DOUBLE) {
      this.ep = (from + to) >> 1;
      if (this._epCapturable()) { lo ^= Z_EP_LO[this.ep & 7]; hi ^= Z_EP_HI[this.ep & 7]; }
    }
    this.hashLo = lo;
    this.hashHi = hi;
  };

  P.unmake = function () {
    if (this._ply <= 0) return null;
    var i = --this._ply;
    var m = this._uMove[i];
    var b = this.board, from = m.from, to = m.to, flags = m.flags | 0;
    var them = this.turn, us = them ^ 24;
    var captured = this._uCap[i];
    var piece = b[to];
    if (flags & F_PROMO) piece = us | PAWN;
    b[from] = piece;
    if (flags & F_EP) {
      b[to] = 0;
      b[us === WHITE ? to + 16 : to - 16] = captured;
    } else {
      b[to] = captured;
      if (captured && (captured & 7) === KING) this.kings[them] = to;
    }
    if ((piece & 7) === KING) {
      this.kings[us] = from;
      if (flags & F_CASTLE) {
        var rf, rt;
        if (to > from) { rf = to + 1; rt = to - 1; } else { rf = to - 2; rt = to + 1; }
        b[rf] = b[rt];
        b[rt] = 0;
      }
    }
    this.turn = us;
    this.castling = this._uCastling[i];
    this.ep = this._uEp[i];
    this.halfmove = this._uHalf[i];
    this.fullmove = this._uFull[i];
    this.hashLo = this._uHL[i];
    this.hashHi = this._uHH[i];
    this._uMove[i] = null;
    return m;
  };

  /* number of earlier occurrences of the current position (same side to move) since the last
     irreversible move — includes positions from the game history and from make() calls */
  P.repetitions = function () {
    var lo = this.hashLo, hi = this.hashHi, n = 0;
    var stop = this._ply - this.halfmove;
    if (stop < 0) stop = 0;
    var HL = this._uHL, HH = this._uHH;
    for (var k = this._ply - 2; k >= stop; k -= 2) {
      if (HL[k] === lo && HH[k] === hi) n++;
    }
    return n;
  };

  /* ---------------------------------------------------------------- legal moves */
  P._legalFilter = function (list) {
    var out = [], us = this.turn;
    for (var i = 0; i < list.length; i++) {
      this.make(list[i]);
      if (this._kingSafe(us)) out.push(list[i]);
      this.unmake();
    }
    return out;
  };

  P.moves = function (opts) {
    var only = -1;
    if (opts && opts.from !== undefined && opts.from !== null) {
      only = toSq(opts.from);
      if (only < 0) return [];
    }
    return this._legalFilter(this._gen([], false, only));
  };

  P._hasLegal = function () {
    var list = this._gen([], false, -1), us = this.turn;
    for (var i = 0; i < list.length; i++) {
      this.make(list[i]);
      var ok = this._kingSafe(us);
      this.unmake();
      if (ok) return true;
    }
    return false;
  };

  /* pseudo-legal moves of the piece on sq, whatever the side to move, ignoring check (lessons) */
  P.pieceMoves = function (sq) {
    sq = toSq(sq);
    if (sq < 0) return [];
    var p = this.board[sq];
    if (!p) return [];
    var color = p & 24, oldTurn = this.turn, oldEp = this.ep;
    var list = [];
    this.turn = color;
    if (color !== oldTurn) this.ep = -1;
    try {
      this._gen(list, false, sq);
    } finally {
      this.turn = oldTurn;
      this.ep = oldEp;
    }
    return list;
  };

  P.needsPromotion = function (from, to) {
    from = toSq(from);
    to = toSq(to);
    if (from < 0 || to < 0) return false;
    var p = this.board[from];
    if ((p & 7) !== PAWN) return false;
    return (to >> 4) === ((p & 24) === WHITE ? 0 : 7);
  };

  /* legal move object matching from/to(/promotion; missing promotion → queen) or null */
  P._findLegal = function (from, to, promotion) {
    from = toSq(from);
    to = toSq(to);
    if (from < 0 || to < 0) return null;
    var promo = normPromo(promotion) || QUEEN;
    var cands = this.moves({ from: from });
    for (var i = 0; i < cands.length; i++) {
      var m = cands[i];
      if (m.to !== to) continue;
      if ((m.flags & F_PROMO) && m.promotion !== promo) continue;
      return m;
    }
    return null;
  };

  /* SAN of a known legal move object */
  P._san = function (m) {
    var b = this.board, from = m.from, to = m.to, piece = b[from], t = piece & 7, s;
    var isCap = !!(m.flags & F_EP) || !!b[to];
    if (m.flags & F_CASTLE) {
      s = to > from ? 'O-O' : 'O-O-O';
    } else if (t === PAWN) {
      s = isCap ? FILES.charAt(from & 7) + 'x' + sqName(to) : sqName(to);
      if (m.flags & F_PROMO) s += '=' + SAN_CHARS[normPromo(m.promotion) || QUEEN];
    } else {
      s = SAN_CHARS[t];
      var list = this._gen([], false, -1), us = this.turn;
      var amb = false, sameFile = false, sameRank = false;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o.to !== to || o.from === from || b[o.from] !== piece || (o.flags & F_CASTLE)) continue;
        this.make(o);
        var ok = this._kingSafe(us);
        this.unmake();
        if (!ok) continue;
        amb = true;
        if ((o.from & 7) === (from & 7)) sameFile = true;
        if ((o.from >> 4) === (from >> 4)) sameRank = true;
      }
      if (amb) {
        if (!sameFile) s += FILES.charAt(from & 7);
        else if (!sameRank) s += (8 - (from >> 4));
        else s += FILES.charAt(from & 7) + (8 - (from >> 4));
      }
      if (isCap) s += 'x';
      s += sqName(to);
    }
    this.make(m);
    if (this.inCheck()) s += this._hasLegal() ? '+' : '#';
    this.unmake();
    return s;
  };

  P.san = function (m) {
    if (!m) return '';
    var lm = this._findLegal(m.from, m.to, m.promotion);
    return lm ? this._san(lm) : '';
  };

  function stripSan(s) {
    return String(s).replace(/[+#!?]/g, '').replace(/0/g, 'O').replace(/=/g, '').trim();
  }

  P._moveFromString = function (str) {
    var s = str.trim();
    var mm = /^([a-hA-H][1-8])\s*[-x]?\s*([a-hA-H][1-8])\s*=?\s*([qrbnQRBN])?$/.exec(s);
    if (mm) {
      var lm = this._findLegal(mm[1].toLowerCase(), mm[2].toLowerCase(), mm[3] || 0);
      if (lm) return lm;
    }
    var want = stripSan(s);
    if (!want) return null;
    var all = this.moves();
    for (var i = 0; i < all.length; i++) {
      if (stripSan(this._san(all[i])) === want) return all[i];
    }
    return null;
  };

  /* game-level move: validates, records history (+ repetition data), returns Move with .san or null */
  P.move = function (arg) {
    var lm = null;
    if (typeof arg === 'string') lm = this._moveFromString(arg);
    else if (arg && typeof arg === 'object') lm = this._findLegal(arg.from, arg.to, arg.promotion);
    if (!lm) return null;
    var rec = {
      from: lm.from, to: lm.to, piece: lm.piece, captured: lm.captured,
      promotion: lm.promotion, flags: lm.flags, san: this._san(lm)
    };
    this.make(rec);
    this._history.push(rec);
    return rec;
  };

  P.undo = function () {
    if (!this._history.length || this._ply <= 0) return null;
    var m = this.unmake();
    this._history.pop();
    return m;
  };

  P.history = function () {
    return this._history.slice();
  };

  P.lastMove = function () {
    return this._history.length ? this._history[this._history.length - 1] : null;
  };

  /* ---------------------------------------------------------------- game state */
  P.isCheckmate = function () {
    return this.inCheck() && !this._hasLegal();
  };

  P.isStalemate = function () {
    return !this.inCheck() && !this._hasLegal();
  };

  P.isInsufficientMaterial = function () {
    var b = this.board, knights = 0, light = 0, dark = 0;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = b[sq];
      if (!p) continue;
      var t = p & 7;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      if (t === KNIGHT) knights++;
      else if (t === BISHOP) {
        if (((sq >> 4) + (sq & 7)) & 1) dark++;
        else light++;
      }
    }
    if (knights + light + dark <= 1) return true;
    return knights === 0 && (light === 0 || dark === 0);
  };

  P.isThreefold = function () {
    return this.repetitions() >= 2;
  };

  P.isFiftyMove = function () {
    return this.halfmove >= 100;
  };

  P.isGameOver = function () {
    return this.status().over;
  };

  P.status = function () {
    var check = this.inCheck();
    var res = { over: false, reason: null, winner: null, check: check };
    if (!this._hasLegal()) {
      res.over = true;
      if (check) { res.reason = 'checkmate'; res.winner = this.turn ^ 24; }
      else res.reason = 'stalemate';
      return res;
    }
    if (this.kings[WHITE] === -1 || this.kings[BLACK] === -1) return res;
    if (this.isInsufficientMaterial()) res.reason = 'insufficient';
    else if (this.isThreefold()) res.reason = 'threefold';
    else if (this.isFiftyMove()) res.reason = 'fifty';
    if (res.reason) res.over = true;
    return res;
  };

  /* ---------------------------------------------------------------- analysis helpers */
  P.perft = function (depth) {
    if (depth <= 0) return 1;
    var list = this._gen([], false, -1), us = this.turn, n = 0;
    for (var i = 0; i < list.length; i++) {
      this.make(list[i]);
      if (this._kingSafe(us)) n += depth === 1 ? 1 : this.perft(depth - 1);
      this.unmake();
    }
    return n;
  };

  /* pieces of `color` (not the king) that the opponent can win: [{sq, piece, loss}], biggest loss first */
  P.hangingPieces = function (color) {
    var out = [];
    if (color !== WHITE && color !== BLACK) return out;
    var b = this.board, them = color ^ 24;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = b[sq];
      if (!p || (p & 24) !== color || (p & 7) === KING) continue;
      var att = this.attackers(sq, them);
      if (!att.length) continue;
      var val = VALUE[p & 7], loss;
      var def = this.attackers(sq, color);
      if (!def.length) {
        loss = val;
      } else {
        var minA = Infinity;
        for (var i = 0; i < att.length; i++) {
          var at = b[att[i]] & 7;
          if (at === KING) continue;
          if (VALUE[at] < minA) minA = VALUE[at];
        }
        if (minA === Infinity) continue;
        loss = val - minA;
      }
      if (loss > 0) out.push({ sq: sq, piece: p, loss: loss });
    }
    out.sort(function (a, c) { return c.loss - a.loss; });
    return out;
  };

  /* legal moves of the side to move that checkmate at once (each with .san) */
  P.mateInOne = function () {
    var ms = this.moves(), out = [];
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      this.make(m);
      var mate = this.inCheck() && !this._hasLegal();
      this.unmake();
      if (mate) {
        m.san = this._san(m);
        out.push(m);
      }
    }
    return out;
  };

  /* number of pieces (kings included) of `color`, or of both colors when omitted */
  P.pieceCount = function (color) {
    var b = this.board, n = 0;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = b[sq];
      if (p && (color === undefined || color === null || (p & 24) === color)) n++;
    }
    return n;
  };

  /* sum of VALUE of the pieces of `color` (both colors when omitted) */
  P.material = function (color) {
    var b = this.board, n = 0;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = b[sq];
      if (p && (color === undefined || color === null || (p & 24) === color)) n += VALUE[p & 7];
    }
    return n;
  };

  /* ---------------------------------------------------------------- copy / debug */
  P.clone = function () {
    var c = new Chess(NO_LOAD);
    c.board.set(this.board);
    c.turn = this.turn;
    c.castling = this.castling;
    c.ep = this.ep;
    c.halfmove = this.halfmove;
    c.fullmove = this.fullmove;
    c.kings = this.kings.slice();
    c.hashLo = this.hashLo;
    c.hashHi = this.hashHi;
    c.loadError = this.loadError;
    var n = this._ply;
    c._ply = n;
    c._uMove = this._uMove.slice(0, n);
    c._uCap = this._uCap.slice(0, n);
    c._uCastling = this._uCastling.slice(0, n);
    c._uEp = this._uEp.slice(0, n);
    c._uHalf = this._uHalf.slice(0, n);
    c._uFull = this._uFull.slice(0, n);
    c._uHL = this._uHL.slice(0, n);
    c._uHH = this._uHH.slice(0, n);
    c._history = this._history.slice();
    return c;
  };

  P.ascii = function () {
    var s = '';
    for (var r = 0; r < 8; r++) {
      s += (8 - r) + ' ';
      for (var c = 0; c < 8; c++) {
        var p = this.board[r * 16 + c];
        s += (p ? pieceChar(p) : '.') + ' ';
      }
      s += '\n';
    }
    return s + '  a b c d e f g h\n';
  };

  global.Chess = Chess;
  if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
