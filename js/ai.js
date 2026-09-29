/*
 * «Шахматное Королевство» — computer opponents.
 *
 * Negamax alpha-beta (PVS) + quiescence search, transposition table, MVV-LVA / killer / history
 * move ordering, check extension, mate-distance scores, repetition and fifty-move draws in search,
 * piece-square tables with an endgame king table and a mop-up term (so a lone king really gets mated).
 *
 * Global: ChessAI (browser / worker), module.exports (node). Needs Chess (js/engine.js).
 */
(function (global) {
  'use strict';

  var WHITE = 8, BLACK = 16;
  var PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  var F_PROMO = 16;
  var VALUE = [0, 100, 320, 330, 500, 900, 0];

  var MATE = 100000;
  var MATE_BOUND = MATE - 1000;
  var INF = 1000000;
  var MAX_PLY = 96;
  var QMAX = 8;
  var HARD_LIMIT_MS = 2200;        // absolute cap for a timed search (depth ≤ 3 may run over timeMs)
  var MIN_FULL_DEPTH = 3;          // timed searches always complete this depth

  /* blunder: probability of a hasty, uniformly random legal move instead of the searched one
     (a gentler ramp for beginners; it may even miss its own mate in one). Level 4 and 'hint' never blunder. */
  var LEVELS = {
    1: { random: true },
    2: { depth: 1, noise: 150, blunder: 0.3 },
    3: { depth: 2, noise: 45, blunder: 0.1 },
    4: { depth: 4, timeMs: 1500, noise: 0 },
    hint: { depth: 4, timeMs: 1100, noise: 0 }
  };

  function getChess() {
    var C = global.Chess;
    if (!C && typeof require === 'function') {
      try { C = require('./engine.js'); } catch (e) { C = null; }
    }
    return C || null;
  }

  var now = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  /* ================================================================ evaluation */
  /* tables from White's point of view, first line = rank 8 (row 0), like the board */
  var T_PAWN = [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0
  ];
  var T_KNIGHT = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
  ];
  var T_BISHOP = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
  ];
  var T_ROOK = [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0
  ];
  var T_QUEEN = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20
  ];
  var T_KING_MG = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20
  ];
  var T_KING_EG = [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50
  ];
  var PIECE_TABLES = [null, T_PAWN, T_KNIGHT, T_BISHOP, T_ROOK, T_QUEEN];

  /* material + table value per 0x88 square; black uses the vertically mirrored table */
  var PSQ_W = [], PSQ_B = [];
  var KMG_W = new Int16Array(128), KMG_B = new Int16Array(128);
  var KEG_W = new Int16Array(128), KEG_B = new Int16Array(128);
  var CENTER_DIST = new Int8Array(128);
  (function () {
    for (var t = 0; t <= 5; t++) { PSQ_W.push(new Int16Array(128)); PSQ_B.push(new Int16Array(128)); }
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        var sq = r * 16 + c, wi = r * 8 + c, bi = (7 - r) * 8 + c;
        for (t = 1; t <= 5; t++) {
          PSQ_W[t][sq] = VALUE[t] + PIECE_TABLES[t][wi];
          PSQ_B[t][sq] = VALUE[t] + PIECE_TABLES[t][bi];
        }
        KMG_W[sq] = T_KING_MG[wi]; KMG_B[sq] = T_KING_MG[bi];
        KEG_W[sq] = T_KING_EG[wi]; KEG_B[sq] = T_KING_EG[bi];
        var fd = c < 4 ? 3 - c : c - 4, rd = r < 4 ? 3 - r : r - 4;
        CENTER_DIST[sq] = fd + rd;
      }
    }
  })();

  var PASSED_MG = [0, 5, 10, 15, 25, 40, 60, 0];
  var PASSED_EG = [0, 10, 20, 35, 55, 85, 120, 0];

  var wPawnCnt = new Int8Array(8), bPawnCnt = new Int8Array(8);
  var wMaxRow = new Int8Array(8), bMinRow = new Int8Array(8);
  var wPawnSq = new Int16Array(16), bPawnSq = new Int16Array(16);
  var wRookSq = new Int16Array(16), bRookSq = new Int16Array(16);

  function mopUp(winnerK, loserK) {
    var md = Math.abs((winnerK >> 4) - (loserK >> 4)) + Math.abs((winnerK & 7) - (loserK & 7));
    return 10 * CENTER_DIST[loserK] + 4 * (14 - md);
  }

  /* static evaluation in centipawns, White's point of view */
  function evaluate(chess) {
    var b = chess.board;
    var score = 0, npmW = 0, npmB = 0, nwP = 0, nbP = 0, nwR = 0, nbR = 0, bishW = 0, bishB = 0;
    var wk = -1, bk = -1, sq, p, t, f, r, i;
    for (f = 0; f < 8; f++) { wPawnCnt[f] = 0; bPawnCnt[f] = 0; wMaxRow[f] = -1; bMinRow[f] = 8; }

    for (sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      p = b[sq];
      if (!p) continue;
      t = p & 7;
      if (p & WHITE) {
        if (t === KING) { wk = sq; continue; }
        score += PSQ_W[t][sq];
        if (t === PAWN) {
          f = sq & 7; r = sq >> 4;
          wPawnCnt[f]++;
          if (r > wMaxRow[f]) wMaxRow[f] = r;
          if (nwP < 16) wPawnSq[nwP++] = sq;
        } else {
          npmW += VALUE[t];
          if (t === BISHOP) bishW++;
          else if (t === ROOK && nwR < 16) wRookSq[nwR++] = sq;
        }
      } else {
        if (t === KING) { bk = sq; continue; }
        score -= PSQ_B[t][sq];
        if (t === PAWN) {
          f = sq & 7; r = sq >> 4;
          bPawnCnt[f]++;
          if (r < bMinRow[f]) bMinRow[f] = r;
          if (nbP < 16) bPawnSq[nbP++] = sq;
        } else {
          npmB += VALUE[t];
          if (t === BISHOP) bishB++;
          else if (t === ROOK && nbR < 16) bRookSq[nbR++] = sq;
        }
      }
    }

    var endgame = npmW <= 1300 && npmB <= 1300;
    if (wk >= 0) score += endgame ? KEG_W[wk] : KMG_W[wk];
    if (bk >= 0) score -= endgame ? KEG_B[bk] : KMG_B[bk];
    if (bishW >= 2) score += 30;
    if (bishB >= 2) score -= 30;
    var passed = endgame ? PASSED_EG : PASSED_MG;

    for (i = 0; i < nwP; i++) {
      sq = wPawnSq[i]; f = sq & 7; r = sq >> 4;
      if (wPawnCnt[f] > 1) score -= 10;
      var wl = f > 0 ? wPawnCnt[f - 1] : 0, wr = f < 7 ? wPawnCnt[f + 1] : 0;
      if (!wl && !wr) score -= 12;
      if (bMinRow[f] >= r && (f === 0 || bMinRow[f - 1] >= r) && (f === 7 || bMinRow[f + 1] >= r)) {
        score += passed[6 - r];
      }
    }
    for (i = 0; i < nbP; i++) {
      sq = bPawnSq[i]; f = sq & 7; r = sq >> 4;
      if (bPawnCnt[f] > 1) score += 10;
      var bl = f > 0 ? bPawnCnt[f - 1] : 0, br = f < 7 ? bPawnCnt[f + 1] : 0;
      if (!bl && !br) score += 12;
      if (wMaxRow[f] <= r && (f === 0 || wMaxRow[f - 1] <= r) && (f === 7 || wMaxRow[f + 1] <= r)) {
        score -= passed[r - 1];
      }
    }
    for (i = 0; i < nwR; i++) {
      f = wRookSq[i] & 7;
      if (!wPawnCnt[f]) score += bPawnCnt[f] ? 8 : 15;
    }
    for (i = 0; i < nbR; i++) {
      f = bRookSq[i] & 7;
      if (!bPawnCnt[f]) score -= wPawnCnt[f] ? 8 : 15;
    }

    if (endgame && wk >= 0 && bk >= 0) {
      var diff = (npmW + 100 * nwP) - (npmB + 100 * nbP);
      if (diff >= 400) score += mopUp(wk, bk);
      else if (diff <= -400) score -= mopUp(bk, wk);
    }

    /* a side without pawns and with at most one minor piece cannot win */
    if (score > 0 && nwP === 0 && npmW < 500) score = 0;
    else if (score < 0 && nbP === 0 && npmB < 500) score = 0;
    return score;
  }

  function evalSide(c) {
    var s = evaluate(c);
    return c.turn === WHITE ? s : -s;
  }

  /* ================================================================ search state */
  var TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  var TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;
  var ttLo = null, ttHi, ttScore, ttMove, ttDepth, ttFlag;

  function ttReset() {
    if (!ttLo) {
      ttLo = new Int32Array(TT_SIZE);
      ttHi = new Int32Array(TT_SIZE);
      ttScore = new Int32Array(TT_SIZE);
      ttMove = new Int32Array(TT_SIZE);
      ttDepth = new Int8Array(TT_SIZE);
      ttFlag = new Uint8Array(TT_SIZE);
    } else {
      ttFlag.fill(0);
    }
  }

  var killer1 = new Int32Array(MAX_PLY + 2), killer2 = new Int32Array(MAX_PLY + 2);
  var hist = new Int32Array(128 * 128);
  var scoreBufs = [];
  for (var sb = 0; sb < MAX_PLY + 2; sb++) scoreBufs.push(new Int32Array(256));

  var sC = null, sNodes = 0, sStop = false, sCanStop = false, sDeadline = 0, sHard = 0, sMaxExt = 0;

  function enc(m) { return m.from | (m.to << 8) | ((m.promotion | 0) << 16); }

  function checkTime() {
    var t = now();
    if (t >= sHard || (sCanStop && t >= sDeadline)) sStop = true;
  }

  function resetHeuristics() {
    killer1.fill(0);
    killer2.fill(0);
    hist.fill(0);
  }

  function scoreMoves(moves, scores, n, ply, ttm) {
    var k1 = killer1[ply], k2 = killer2[ply];
    for (var i = 0; i < n; i++) {
      var m = moves[i], e = enc(m), s;
      if (e === ttm) s = 10000000;
      else if (m.flags & F_PROMO) s = m.promotion === QUEEN ? 5000000 + VALUE[m.captured & 7] : -1000;
      else if (m.captured) s = 1000000 + (m.captured & 7) * 16 - (m.piece & 7);
      else if (e === k1) s = 900000;
      else if (e === k2) s = 800000;
      else s = hist[(m.from << 7) | m.to];
      scores[i] = s;
    }
  }

  function pickNext(moves, scores, start, n) {
    var bi = start, bs = scores[start];
    for (var j = start + 1; j < n; j++) {
      if (scores[j] > bs) { bs = scores[j]; bi = j; }
    }
    if (bi !== start) {
      var tm = moves[start]; moves[start] = moves[bi]; moves[bi] = tm;
      var ts = scores[start]; scores[start] = scores[bi]; scores[bi] = ts;
    }
  }

  function quiesce(alpha, beta, ply, qd) {
    var c = sC;
    if ((++sNodes & 1023) === 0) checkTime();
    if (sStop) return 0;
    var stand = evalSide(c);
    if (stand >= beta) return stand;
    if (qd >= QMAX || ply >= MAX_PLY) return stand;
    if (stand > alpha) alpha = stand;
    var moves = c.genMoves(true), n = moves.length;
    if (!n) return alpha;
    if (n > 256) n = 256;
    var scores = scoreBufs[ply];
    scoreMoves(moves, scores, n, ply, 0);
    var us = c.turn;
    for (var i = 0; i < n; i++) {
      pickNext(moves, scores, i, n);
      var m = moves[i];
      if (m.flags & F_PROMO) {
        if (m.promotion !== QUEEN) continue;
      } else if (stand + VALUE[m.captured & 7] + 200 <= alpha) {
        continue;
      }
      c.make(m);
      var k = c.kings[us];
      if (k !== -1 && c._att(k, us ^ 24)) { c.unmake(); continue; }
      var score = -quiesce(-beta, -alpha, ply + 1, qd + 1);
      c.unmake();
      if (sStop) return 0;
      if (score > alpha) {
        if (score >= beta) return score;
        alpha = score;
      }
    }
    return alpha;
  }

  function negamax(depth, alpha, beta, ply) {
    var c = sC;
    if ((++sNodes & 1023) === 0) checkTime();
    if (sStop) return 0;

    var us = c.turn, them = us ^ 24;
    var kSq = c.kings[us];
    var inCheck = kSq !== -1 && c._att(kSq, them);
    if (c.halfmove >= 100) return (inCheck && !c._hasLegal()) ? -MATE + ply : 0;
    if (c.repetitions() > 0) return 0;
    var mAlpha = -MATE + ply, mBeta = MATE - ply - 1;
    if (alpha < mAlpha) alpha = mAlpha;
    if (beta > mBeta) beta = mBeta;
    if (alpha >= beta) return alpha;

    if (inCheck && ply < sMaxExt) depth++;
    if (depth <= 0) return quiesce(alpha, beta, ply, 0);
    if (ply >= MAX_PLY) return evalSide(c);

    var lo = c.hashLo, hi = c.hashHi, idx = lo & TT_MASK, ttm = 0;
    if (ttFlag[idx] && ttLo[idx] === lo && ttHi[idx] === hi) {
      ttm = ttMove[idx];
      if (ttDepth[idx] >= depth) {
        var ts = ttScore[idx];
        if (ts >= MATE_BOUND) ts -= ply;
        else if (ts <= -MATE_BOUND) ts += ply;
        var fl = ttFlag[idx];
        if (fl === TT_EXACT) return ts;
        if (fl === TT_LOWER && ts >= beta) return ts;
        if (fl === TT_UPPER && ts <= alpha) return ts;
      }
    }

    var moves = c.genMoves(false), n = moves.length;
    if (n > 256) n = 256;
    var scores = scoreBufs[ply];
    scoreMoves(moves, scores, n, ply, ttm);

    var best = -INF, bestEnc = 0, legal = 0, origAlpha = alpha;
    for (var i = 0; i < n; i++) {
      pickNext(moves, scores, i, n);
      var m = moves[i];
      c.make(m);
      var k = c.kings[us];
      if (k !== -1 && c._att(k, them)) { c.unmake(); continue; }
      legal++;
      var score;
      if (legal === 1) {
        score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      } else {
        score = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1);
        if (!sStop && score > alpha && score < beta) score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      }
      c.unmake();
      if (sStop) return 0;
      if (score > best) {
        best = score;
        bestEnc = enc(m);
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            if (!m.captured && !(m.flags & F_PROMO)) {
              if (killer1[ply] !== bestEnc) { killer2[ply] = killer1[ply]; killer1[ply] = bestEnc; }
              var hi2 = (m.from << 7) | m.to;
              hist[hi2] += depth * depth;
              if (hist[hi2] > 700000) for (var h = 0; h < hist.length; h++) hist[h] >>= 1;
            }
            break;
          }
        }
      }
    }
    if (!legal) return inCheck ? -MATE + ply : 0;

    var flag = best <= origAlpha ? TT_UPPER : (best >= beta ? TT_LOWER : TT_EXACT);
    var stored = best;
    if (stored >= MATE_BOUND) stored += ply;
    else if (stored <= -MATE_BOUND) stored -= ply;
    ttLo[idx] = lo;
    ttHi[idx] = hi;
    ttScore[idx] = stored;
    ttMove[idx] = bestEnc;
    ttDepth[idx] = depth > 127 ? 127 : depth;
    ttFlag[idx] = flag;
    return best;
  }

  /* ================================================================ root drivers */
  function beginSearch(c, timeMs) {
    var t = now();
    sC = c;
    sNodes = 0;
    sStop = false;
    sCanStop = false;
    sDeadline = timeMs > 0 ? t + timeMs : Infinity;
    sHard = t + Math.max(HARD_LIMIT_MS, timeMs > 0 ? timeMs + 300 : 0);
    ttReset();
    resetHeuristics();
    return t;
  }

  /* legal root moves, ordered: queen promotions, captures (MVV-LVA), the rest */
  function rootMoves(c) {
    var ms = c.moves();
    var sc = new Array(ms.length);
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.flags & F_PROMO) sc[i] = m.promotion === QUEEN ? 5000 : -5000;
      else if (m.captured) sc[i] = 1000 + (m.captured & 7) * 16 - (m.piece & 7);
      else sc[i] = 0;
    }
    var idx = ms.map(function (_, j) { return j; });
    idx.sort(function (a, b) { return sc[b] - sc[a] || a - b; });
    return idx.map(function (j) { return ms[j]; });
  }

  /* one iteration with a full window at the root (PVS for later moves); null when interrupted */
  function searchRoot(c, root, depth, scores) {
    var alpha = -INF, beta = INF, best = -INF, bestIdx = 0;
    sMaxExt = depth * 2 + 4;
    for (var i = 0; i < root.length; i++) {
      var m = root[i], sc;
      c.make(m);
      if (i === 0) {
        sc = -negamax(depth - 1, -beta, -alpha, 1);
      } else {
        sc = -negamax(depth - 1, -alpha - 1, -alpha, 1);
        if (!sStop && sc > alpha) sc = -negamax(depth - 1, -beta, -alpha, 1);
      }
      c.unmake();
      if (sStop) return null;
      scores[i] = sc;
      if (sc > best) {
        best = sc;
        bestIdx = i;
        if (sc > alpha) alpha = sc;
      }
    }
    return { idx: bestIdx, score: best };
  }

  /* iterative deepening; returns the best move of the deepest completed iteration */
  function searchBest(c, cfg) {
    var timeMs = cfg.timeMs > 0 ? cfg.timeMs : 0;
    var maxDepth = Math.max(1, Math.min(cfg.depth | 0 || 1, 32));
    var start = beginSearch(c, timeMs);
    var root = rootMoves(c);
    var scores = new Array(root.length);
    var best = root[0], bestScore = 0, bestDepth = 0;
    for (var d = 1; d <= maxDepth; d++) {
      sCanStop = timeMs > 0 && d > MIN_FULL_DEPTH;
      var r = searchRoot(c, root, d, scores);
      if (!r) break;
      best = root[r.idx];
      bestScore = r.score;
      bestDepth = d;
      /* best move first, the others by their (bound) scores */
      var order = root.map(function (_, j) { return j; });
      order.sort(function (a, b) {
        if (a === r.idx) return -1;
        if (b === r.idx) return 1;
        return scores[b] - scores[a] || a - b;
      });
      root = order.map(function (j) { return root[j]; });
      scores = order.map(function (j) { return scores[j]; });
      if (Math.abs(bestScore) >= MATE_BOUND) break;
      if (timeMs > 0 && d >= MIN_FULL_DEPTH && now() - start > timeMs * 0.45) break;
    }
    return { move: best, score: bestScore, depth: bestDepth };
  }

  /* exact score for every root move, then max(score + random noise); a mate in one is never missed.
     An underpromotion is only considered when it is clearly better (> 50 cp) than promoting to a queen. */
  function searchNoisy(c, depth, noise, rand) {
    beginSearch(c, 0);
    var root = rootMoves(c);
    var d = Math.max(1, depth | 0);
    sMaxExt = d * 2 + 4;
    var n = root.length, scores = new Array(n), done = 0, i;
    for (i = 0; i < n; i++) {
      var m = root[i], sc;
      c.make(m);
      if (!c._hasLegal()) {
        sc = c.inCheck() ? MATE - 1 : 0;
        c.unmake();
        if (sc > 0) return { move: m, score: sc, depth: 1 };
      } else {
        sc = -negamax(d - 1, -INF, INF, 1);
        c.unmake();
        if (sStop) break;
      }
      scores[i] = sc;
      done = i + 1;
    }
    var bestMove = null, bestVal = -Infinity, bestScore = 0;
    for (i = 0; i < done; i++) {
      var mv = root[i];
      if ((mv.flags & F_PROMO) && mv.promotion !== QUEEN) {
        var beaten = false;
        for (var j = 0; j < done; j++) {
          var q = root[j];
          if (q.from === mv.from && q.to === mv.to && q.promotion === QUEEN && scores[j] + 50 >= scores[i]) beaten = true;
        }
        if (beaten) continue;
      }
      var v = Math.abs(scores[i]) >= MATE_BOUND ? scores[i] : scores[i] + (rand() * 2 - 1) * noise;
      if (v > bestVal) {
        bestVal = v;
        bestMove = mv;
        bestScore = scores[i];
      }
    }
    if (!bestMove) bestMove = root[0];
    return { move: bestMove, score: bestScore, depth: d };
  }

  /* level 1: random legal move, captures three times as likely (queen promotions only).
     capWeight 1 = uniform (used for the blunders of levels 2 and 3). */
  function randomMove(c, rand, capWeight) {
    var cw = capWeight > 0 ? capWeight : 3;
    var ms = c.moves().filter(function (m) { return !(m.flags & F_PROMO) || m.promotion === QUEEN; });
    if (!ms.length) return null;
    var total = 0, i;
    var w = new Array(ms.length);
    for (i = 0; i < ms.length; i++) {
      w[i] = ms[i].captured ? cw : 1;
      total += w[i];
    }
    var x = rand() * total, pick = ms[ms.length - 1];
    for (i = 0; i < ms.length; i++) {
      x -= w[i];
      if (x < 0) { pick = ms[i]; break; }
    }
    c.make(pick);
    var score = -evalSide(c);
    c.unmake();
    return { move: pick, score: score, depth: 0 };
  }

  function resolveLevel(level) {
    if (level && typeof level === 'object') return { key: 'custom', cfg: level };
    var key = level === 'hint' ? 'hint' : String(parseInt(level, 10));
    if (!LEVELS[key]) key = '3';
    return { key: key, cfg: LEVELS[key] };
  }

  function safeRandom() {
    var r = ChessAI.random;
    if (typeof r !== 'function') return Math.random;
    return function () {
      var v = +r();
      return v >= 0 && v < 1 ? v : Math.random();
    };
  }

  /* ================================================================ public API */
  function chooseMoveFen(fen, level) {
    var C = getChess();
    if (!C || typeof fen !== 'string') return null;
    var c = new C();
    if (!c.load(fen)) return null;
    return ChessAI.chooseMove(c, level);
  }

  var ChessAI = {
    LEVELS: LEVELS,
    MATE: MATE,
    /* replaceable random source (tests); must return [0, 1) */
    random: Math.random,
    /* info about the last search: { level, depth, nodes, ms } */
    lastSearch: null,

    evaluate: function (chess) {
      if (!chess || !chess.board) return 0;
      return evaluate(chess);
    },

    /* same as chooseMove for a FEN string (null for an invalid FEN) */
    chooseMoveFen: chooseMoveFen,

    /* sync; never changes `chess`. level: 1..4, 'hint' or a config object like LEVELS[x].
       Returns { from, to, promotion, score, depth, san } (score in centipawns from the point of view
       of the side to move; about ±MATE for forced mates) or null when there is no legal move. */
    chooseMove: function (chess, level) {
      if (!chess || typeof chess.clone !== 'function') return null;
      var t0 = now();
      sNodes = 0;
      var c = chess.clone();
      var legal = c.moves();
      if (!legal.length) return null;
      var lv = resolveLevel(level), cfg = lv.cfg, rand = safeRandom();
      var res, blundered = false;
      try {
        if (cfg.random) {
          res = randomMove(c, rand, 3);
        } else if (legal.length === 1) {
          beginSearch(c, 0);
          sMaxExt = 6;
          c.make(legal[0]);
          var s1 = -negamax(1, -INF, INF, 1);
          c.unmake();
          res = { move: legal[0], score: s1, depth: 2 };
        } else if (cfg.blunder > 0 && rand() < cfg.blunder) {
          /* hasty: a uniformly random legal move (queen promotions only), no search at all */
          res = randomMove(c, rand, 1);
          blundered = true;
        } else if (cfg.noise > 0) {
          res = searchNoisy(c, cfg.depth || 1, cfg.noise, rand);
        } else if (lv.key === '4' && c.fullmove <= 4 && c.pieceCount() >= 24) {
          /* the Owl varies its opening a little */
          res = searchNoisy(c, Math.min(3, cfg.depth || 3), 15, rand);
        } else {
          res = searchBest(c, cfg);
        }
      } finally {
        sC = null;
      }
      if (!res || !res.move) return null;
      var m = res.move;
      ChessAI.lastSearch = { level: lv.key, depth: res.depth, nodes: blundered ? 0 : sNodes, ms: Math.round(now() - t0), blunder: blundered };
      return {
        from: m.from,
        to: m.to,
        promotion: m.promotion | 0,
        score: res.score ? res.score : 0,
        depth: res.depth,
        san: c._san(m)
      };
    }
  };

  global.ChessAI = ChessAI;
  if (typeof module !== 'undefined' && module.exports) module.exports = ChessAI;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
