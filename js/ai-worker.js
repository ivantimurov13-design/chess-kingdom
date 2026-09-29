/*
 * «Шахматное Королевство» — AI web worker.
 *
 * Request:  { id, fen, level }                         level: 1..4 or 'hint'
 *           optional: startFen + moves:[{from,to,promotion}] — the game from its start, so the AI
 *           also knows about repeated positions (used only when replaying it gives the same `fen`).
 * Response: { id, move: {from, to, promotion} | null, score }   (+ error: string when something failed)
 */
(function (global) {
  'use strict';

  /* only inside a worker (never hijack a page's onmessage if this file is included by mistake) */
  if (typeof global.importScripts !== 'function') return;

  var loadError = null;
  try {
    if (typeof global.Chess === 'undefined' || typeof global.ChessAI === 'undefined') {
      global.importScripts('engine.js', 'ai.js');
    }
  } catch (e) {
    loadError = e;
  }

  function buildPosition(data) {
    var Chess = global.Chess;
    var chess = new Chess();
    var fen = typeof data.fen === 'string' ? data.fen : '';
    if (typeof data.startFen === 'string' && Array.isArray(data.moves)) {
      var ok = chess.load(data.startFen);
      for (var i = 0; ok && i < data.moves.length; i++) {
        if (!chess.move(data.moves[i])) ok = false;
      }
      if (ok && (!fen || chess.fen() === fen)) return chess;
    }
    if (!fen) fen = Chess.START_FEN;
    if (!chess.load(fen)) throw new Error('bad FEN: ' + fen);
    return chess;
  }

  global.onmessage = function (ev) {
    var data = (ev && ev.data) || {};
    var id = data.id;
    try {
      if (loadError) throw loadError;
      var chess = buildPosition(data);
      var level = data.level === undefined || data.level === null ? 2 : data.level;
      var r = global.ChessAI.chooseMove(chess, level);
      global.postMessage({
        id: id,
        move: r ? { from: r.from, to: r.to, promotion: r.promotion } : null,
        score: r ? r.score : 0
      });
    } catch (err) {
      global.postMessage({
        id: id,
        move: null,
        score: 0,
        error: String((err && err.message) || err)
      });
    }
  };
})(typeof self !== 'undefined' ? self : globalThis);
