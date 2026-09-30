/*
 * «Шахматное Королевство» — lessons and puzzles (content + solvers).
 *
 * Global: Lessons (browser), module.exports (node).
 *
 *   Lessons.NAMES                 Russian piece names by type char (with grammatical cases and gender)
 *   Lessons.GROUPS                lesson groups in map order (piece moves, values, check, escape, mate, castle, special,
 *                                 then v2: defend, fork, maze)
 *   Lessons.PUZZLES               "Мат в 1 ход" puzzles (ids 1..30, all White to move; kind 'mate1' implied)
 *   Lessons.PUZZLES_MATE2         "Мат в 2 хода" puzzles (ids 'm2-1'..)
 *   Lessons.PUZZLES_WIN           "Выиграй фигуру" puzzles (ids 'w-1'..)
 *   Lessons.PUZZLE_SETS           [{id, title, emoji, color, text, puzzles}] — mate1, mate2, win
 *   Lessons.buildStarsPosition(level, collectedMask?) -> Chess     board of a stars level (no kings, White to move)
 *   Lessons.solveStars(level, state?) -> { par, path:[{from,to,promotion}] } | null
 *   Lessons.checkGoal(level, chessBefore, move, chessAfter) -> boolean
 *   Lessons.rateStars(moves, par) -> 1..3
 *   Lessons.puzzleKind(puzzleOrId) -> p.kind || 'mate1'  ('mate1'|'mate2'|'mate3'|'win'|'save'|'endgame')
 *   Lessons.allPuzzles() -> every puzzle of every set (appended sets included)
 *   Lessons.puzzleById(id) -> puzzle | null;   Lessons.puzzleSet(setId) -> set | null
 *   Lessons.isMate2Move(chessBefore, move) -> boolean;  Lessons.bestDefense(chessAfterWhiteMove) -> Move | null
 *   Lessons.hangingLegal(chess, color) -> [{sq, piece, loss}]   like Chess#hangingPieces, legal captures only
 *
 * v3 core (SPEC §11.1) — the content itself lives in separate files that register at load time:
 *   Lessons.CONTENT_VERSION = 3
 *   Lessons.addGroups(groups)             append lesson groups (GROUPS is mutated in place); duplicate id → throws
 *   Lessons.addPuzzles(setId, puzzles)    append puzzles to an existing set; ids unique across ALL sets → else throws
 *   Lessons.addPuzzleSet(set)             append {id,title,emoji,color,text,puzzles,endless?}; duplicate id → throws
 *   Lessons.isMateInMove(chessBefore, move, n) -> boolean   mate now, or every reply leaves a forced mate in n−1
 *   Lessons.mateInN(chess, n) -> Move[]   moves of the side to move forcing mate in ≤ n (each with .mateIn, .san)
 *   Lessons.bestDefenseN(chessAfter, n) -> Move | null   the reply leaving the fewest forcing continuations
 *   Lessons.endgameReply(chess) -> Move | null           strong deterministic defence (ChessAI) for 'endgame' play
 *   checkGoal goal 'solution'             the move is one of level.solutions (UCI 'e2e4', 'e7e8q')
 *
 * Saved progress refers to groups by 'groupId:levelIndex' and to puzzles by id: existing entries are frozen
 * (tests/fixtures/content-v1.json and content-v2.json), new content is only appended.
 *
 * Square names in the content ('a1', 'e4') are human-written; solveStars returns 0x88 square numbers
 * (like engine moves) and the promotion as a type number (0 when there is none).
 */
(function (global) {
  'use strict';

  /* ================================================================ engine access */

  var requiredChess = null;

  /* the Chess constructor: the global one (browser / worker) or require('./engine.js') under node */
  function C() {
    if (global && typeof global.Chess === 'function') return global.Chess;
    if (requiredChess) return requiredChess;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try {
        requiredChess = require('./engine.js');
      } catch (e) {
        requiredChess = null;
      }
    }
    return requiredChess;
  }

  var requiredAI = null;

  /* ChessAI: the global one (browser / worker) or require('./ai.js') under node; null when unavailable */
  function getAI() {
    if (global && global.ChessAI && typeof global.ChessAI.chooseMove === 'function') return global.ChessAI;
    if (requiredAI) return requiredAI;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try {
        requiredAI = require('./ai.js');
      } catch (e) {
        requiredAI = null;
      }
    }
    return requiredAI && typeof requiredAI.chooseMove === 'function' ? requiredAI : null;
  }

  var CONTENT_VERSION = 3;
  var WHITE = 8, BLACK = 16;
  var PAWN = 1, ROOK = 4, QUEEN = 5, KING = 6;
  var F_EP = 2, F_CASTLE = 4, F_PROMO = 16;
  var VALUE = [0, 100, 320, 330, 500, 900, 0];   // fallback when the engine has no Chess.VALUE
  var TYPE_CHARS = ' pnbrqk';
  var EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';
  var MAX_TARGETS = 20;          // bit mask limit for the stars solver
  var MAX_STATES = 2000000;      // safety limit for the stars solver

  function onBoard(sq) {
    return typeof sq === 'number' && sq >= 0 && sq < 128 && (sq | 0) === sq && !(sq & 0x88);
  }

  function sqFromName(name) {
    if (typeof name !== 'string') return -1;
    var s = name.trim().toLowerCase();
    if (s.length !== 2) return -1;
    var f = s.charCodeAt(0) - 97, r = s.charCodeAt(1) - 49;
    if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
    return (7 - r) * 16 + f;
  }

  /* 0x88 number or 'e4' → 0x88 number, -1 when invalid */
  function toSq(v) {
    if (typeof v === 'number') return onBoard(v) ? v : -1;
    if (typeof v === 'string') return sqFromName(v);
    return -1;
  }

  /* 'q' / 'Q' / 5 → 5; anything else → 0 */
  function toType(v) {
    if (typeof v === 'number') {
      var t = v & 7;
      return t >= 1 && t <= 6 ? t : 0;
    }
    if (typeof v === 'string' && v.length) {
      var i = TYPE_CHARS.indexOf(v.trim().charAt(0).toLowerCase());
      return i > 0 ? i : 0;
    }
    return 0;
  }

  /* ================================================================ names */

  var NAMES = {
    p: { nom: 'пешка', acc: 'пешку', gen: 'пешки', ins: 'пешкой', Nom: 'Пешка', g: 'f' },
    n: { nom: 'конь', acc: 'коня', gen: 'коня', ins: 'конём', Nom: 'Конь', g: 'm' },
    b: { nom: 'слон', acc: 'слона', gen: 'слона', ins: 'слоном', Nom: 'Слон', g: 'm' },
    r: { nom: 'ладья', acc: 'ладью', gen: 'ладьи', ins: 'ладьёй', Nom: 'Ладья', g: 'f' },
    q: { nom: 'ферзь', acc: 'ферзя', gen: 'ферзя', ins: 'ферзём', Nom: 'Ферзь', g: 'm' },
    k: { nom: 'король', acc: 'короля', gen: 'короля', ins: 'королём', Nom: 'Король', g: 'm' }
  };

  /* ================================================================ lesson groups */

  var GROUPS = [
    {
      id: 'rook', title: 'Ладья', piece: 'r', color: '#ff7a59',
      intro: 'Ладья ходит по прямым линиям — вверх, вниз, влево и вправо, на сколько угодно клеток!',
      rule: 'Ладья так не ходит! Она ходит только по прямым линиям.',
      levels: [
        {
          type: 'stars', piece: 'R', start: 'a1', stars: ['a5', 'e5'],
          text: 'Собери все звёздочки! Нажми на ладью, а потом — на клетку, куда хочешь пойти.'
        },
        {
          type: 'stars', piece: 'R', start: 'h1', stars: ['h7', 'b7', 'b3', 'f3'],
          text: 'Четыре звёздочки! Ладья может пройти через всю доску за один ход.'
        },
        {
          type: 'stars', piece: 'R', start: 'a1', stars: ['a4', 'e5'],
          walls: ['a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3'],
          text: 'Пешки-стенки загораживают дорогу. Найди в стенке проход!'
        },
        {
          type: 'stars', piece: 'R', start: 'a1', stars: [],
          enemies: [{ sq: 'a6', piece: 'p' }, { sq: 'f6', piece: 'p' }, { sq: 'f3', piece: 'p' }, { sq: 'h3', piece: 'p' }],
          text: 'Съешь все чёрные пешки! Чтобы съесть фигуру, встань на её клетку.'
        }
      ]
    },
    {
      id: 'bishop', title: 'Слон', piece: 'b', color: '#6c63ff',
      intro: 'Слон ходит наискосок, на сколько угодно клеток. Он всегда остаётся на клетках своего цвета!',
      rule: 'Слон так не ходит! Он ходит только наискосок.',
      levels: [
        {
          type: 'stars', piece: 'B', start: 'c1', stars: ['a3', 'd6'],
          text: 'Собери звёздочки! Слон ходит только наискосок.'
        },
        {
          type: 'stars', piece: 'B', start: 'f1', stars: ['d3', 'b5', 'e8', 'h5'],
          text: 'Четыре звёздочки — и все на светлых клетках, как и твой слон!'
        },
        {
          type: 'stars', piece: 'B', start: 'f1', stars: ['h3', 'a6'],
          walls: ['e2', 'c4'],
          enemies: [{ sq: 'd7', piece: 'n' }],
          text: 'Стенки мешают! Найди обходной путь, собери звёздочки и съешь чёрного коня.'
        }
      ]
    },
    {
      id: 'queen', title: 'Ферзь', piece: 'q', color: '#ff5fa2',
      intro: 'Ферзь — самая сильная фигура! Он ходит как ладья и как слон: по прямым линиям и наискосок.',
      rule: 'Ферзь так не ходит! Он ходит по прямым линиям и наискосок.',
      levels: [
        {
          type: 'stars', piece: 'Q', start: 'd1', stars: ['d4', 'g7', 'g2'],
          text: 'Собери звёздочки! Ферзь ходит и по прямой, и наискосок.'
        },
        {
          type: 'stars', piece: 'Q', start: 'd1', stars: ['b3', 'b7', 'f7', 'h5', 'e2', 'a6'],
          text: 'Шесть звёздочек! Для ферзя это легко.'
        },
        {
          type: 'stars', piece: 'Q', start: 'd1', stars: ['h8'],
          enemies: [{ sq: 'd4', piece: 'p' }, { sq: 'a4', piece: 'r' }, { sq: 'd7', piece: 'b' }, { sq: 'h7', piece: 'n' }],
          text: 'Съешь все чёрные фигуры и собери звёздочку!'
        }
      ]
    },
    {
      id: 'king', title: 'Король', piece: 'k', color: '#ffa726',
      intro: 'Король — самая главная фигура! Он ходит в любую сторону, но только на одну клетку.',
      rule: 'Король так не ходит! Он делает только один шаг.',
      levels: [
        {
          type: 'stars', piece: 'K', start: 'e1', stars: ['e2', 'e3', 'f4'],
          text: 'Собери звёздочки! Король шагает на одну клетку в любую сторону.'
        },
        {
          type: 'stars', piece: 'K', start: 'd4', stars: ['c3', 'd3', 'e3', 'e4', 'e5', 'd5', 'c5', 'c4'],
          text: 'Звёздочки водят хоровод! Пройди по кругу и собери их все.'
        },
        {
          type: 'stars', piece: 'K', start: 'e2', stars: ['e6'],
          walls: ['d4', 'e4', 'f4'],
          enemies: [{ sq: 'd3', piece: 'p' }, { sq: 'f5', piece: 'n' }],
          text: 'Король тоже умеет есть! Обойди стенку, съешь чёрные фигуры и собери звёздочку.'
        }
      ]
    },
    {
      id: 'knight', title: 'Конь', piece: 'n', color: '#2ecc71',
      intro: 'Конь ходит буквой «Г»: две клетки прямо и одну вбок. А ещё он умеет перепрыгивать через фигуры!',
      rule: 'Конь так не ходит! Он прыгает буквой «Г».',
      levels: [
        {
          type: 'stars', piece: 'N', start: 'b1', stars: ['c3', 'e4'],
          text: 'Собери звёздочки! Конь прыгает буквой «Г».'
        },
        {
          type: 'stars', piece: 'N', start: 'g1', stars: ['f3', 'g5', 'e6', 'c5'],
          text: 'Четыре звёздочки! Прыгай от одной к другой.'
        },
        {
          type: 'stars', piece: 'N', start: 'd4', stars: ['f5', 'g7', 'e8', 'c7'],
          walls: ['c3', 'd3', 'e3', 'c4', 'e4', 'c5', 'd5', 'e5'],
          text: 'Конь окружён пешками-стенками. Но он умеет перепрыгивать!'
        }
      ]
    },
    {
      id: 'pawn', title: 'Пешка', piece: 'p', color: '#3fa9f5',
      intro: 'Пешка ходит только вперёд, на одну клетку. Самым первым ходом можно шагнуть сразу на две! А бьёт пешка наискосок.',
      rule: 'Пешка так не ходит! Она шагает только вперёд, а бьёт наискосок.',
      levels: [
        {
          type: 'stars', piece: 'P', start: 'e2', stars: ['e4', 'e6'],
          text: 'Собери звёздочки! Помни: первым ходом пешка может шагнуть сразу на две клетки.'
        },
        {
          type: 'stars', piece: 'P', start: 'a2', stars: [],
          enemies: [{ sq: 'b3', piece: 'p' }, { sq: 'c4', piece: 'p' }, { sq: 'd5', piece: 'p' }],
          text: 'Пешка бьёт наискосок! Съешь все чёрные пешки.'
        },
        {
          type: 'stars', piece: 'P', start: 'g5', stars: ['g8', 'a2'],
          text: 'Доведи пешку до края доски и преврати её в ферзя! А потом собери последнюю звёздочку.'
        }
      ]
    },
    {
      id: 'values', title: 'Ценность фигур', piece: 'q', emoji: '💰', color: '#f4c20d',
      intro: 'Фигуры бывают сильные и слабые. Давай узнаем, сколько монеток стоит каждая!',
      rule: 'Так ходить нельзя! Попробуй другой ход.',
      levels: [
        {
          type: 'info', title: 'Сколько стоят фигуры?',
          text: 'Каждая фигура стоит сколько-то монеток. Не отдавай дорогую фигуру за дешёвую!',
          items: [
            { piece: 'p', value: 1, text: 'Маленькая, но смелая. Может стать ферзём!' },
            { piece: 'n', value: 3, text: 'Прыгает буквой «Г».' },
            { piece: 'b', value: 3, text: 'Стоит столько же, сколько конь.' },
            { piece: 'r', value: 5, text: 'Сильная фигура: ходит по прямым линиям.' },
            { piece: 'q', value: 9, text: 'Самая сильная фигура!' },
            { piece: 'k', value: 0, text: 'Его нельзя потерять! Береги короля больше всего.' }
          ]
        },
        {
          type: 'task', fen: '4k3/8/2q1p3/8/3N4/8/8/4K3 w - - 0 1', goal: 'capture', target: 'c6',
          text: 'Конь может съесть пешку или ферзя. Кого выгоднее съесть?',
          fail: 'Ферзь стоит 9 монеток, а пешка — только 1. Съешь ферзя!',
          hint: { from: 'd4', to: 'c6' }
        },
        {
          type: 'task', fen: '4k3/8/8/3r1n2/4P3/8/8/4K3 w - - 0 1', goal: 'capture', target: 'd5',
          text: 'Пешка может съесть ладью или коня. Кто из них дороже?',
          fail: 'Ладья стоит 5 монеток, а конь — только 3. Съешь ладью!',
          hint: { from: 'e4', to: 'd5' }
        }
      ]
    },
    {
      id: 'check', title: 'Шах', piece: 'k', emoji: '⚡', color: '#ff4d6d',
      intro: 'Шах — это когда фигура нападает на короля. Объяви шах чёрному королю!',
      rule: 'Так ходить нельзя! Найди ход, который нападает на короля.',
      levels: [
        {
          type: 'task', fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', goal: 'check',
          text: 'Объяви шах ладьёй! Ладья нападает по прямой линии.',
          fail: 'Это не шах. Поставь ладью на одну линию с чёрным королём!',
          hint: { from: 'a1', to: 'a8' }
        },
        {
          type: 'task', fen: '4k3/8/8/8/4N3/8/8/4K3 w - - 0 1', goal: 'check',
          text: 'Объяви шах конём! Прыгни так, чтобы конь напал на короля.',
          fail: 'Это не шах. Найди клетку, откуда конь следующим прыжком попадёт на короля!',
          hint: { from: 'e4', to: 'f6' }
        },
        {
          type: 'task', fen: '4k3/8/8/8/8/8/8/4KB2 w - - 0 1', goal: 'check',
          text: 'Объяви шах слоном! Слон нападает наискосок.',
          fail: 'Это не шах. Поставь слона на одну диагональ с чёрным королём!',
          hint: { from: 'f1', to: 'b5' }
        },
        {
          type: 'task', fen: '4k3/8/8/8/8/8/8/3QK3 w - - 0 1', goal: 'check',
          text: 'Объяви шах ферзём! Способов несколько — найди любой.',
          fail: 'Это не шах. Ферзь должен напасть на короля по прямой линии или наискосок!',
          hint: { from: 'd1', to: 'h5' }
        }
      ]
    },
    {
      id: 'escape', title: 'Спасаем короля', piece: 'k', emoji: '🛡️', color: '#1abc9c',
      intro: 'Если твоему королю шах, его надо спасать! Можно убежать, закрыться или съесть того, кто напал.',
      rule: 'Так нельзя — королю всё ещё шах! Спаси его.',
      levels: [
        {
          type: 'task', fen: '4k3/8/8/8/8/8/8/r3K3 w - - 0 1', goal: 'escape-king',
          text: 'Шах! Чёрная ладья напала на короля. Уведи короля с опасной линии!',
          hint: { from: 'e1', to: 'e2' }
        },
        {
          type: 'task', fen: '4k3/8/8/8/8/8/3N4/r3K3 w - - 0 1', goal: 'escape-block',
          text: 'Шах! Закрой короля: поставь коня между ладьёй и королём.',
          fail: 'Королём убегать не нужно — закройся от шаха конём!',
          hint: { from: 'd2', to: 'b1' }
        },
        {
          type: 'task', fen: '4k3/8/8/8/8/3N4/5q2/4K3 w - - 0 1', goal: 'escape-capture',
          text: 'Шах от ферзя! Съешь ферзя, который напал на короля.',
          fail: 'Убегать не нужно — съешь ферзя, который напал!',
          hint: { from: 'd3', to: 'f2' }
        }
      ]
    },
    {
      id: 'mate', title: 'Мат', piece: 'q', emoji: '🏁', color: '#a55eea',
      intro: 'Мат — это шах, от которого нельзя спастись. Кто поставил мат, тот и победил!',
      rule: 'Так ходить нельзя! Попробуй другой ход.',
      levels: [
        {
          type: 'task', fen: '6k1/8/6K1/8/8/8/8/R7 w - - 0 1', goal: 'mate',
          text: 'Поставь мат ладьёй! Твой король уже помогает — он сторожит клетки перед чёрным королём.',
          hint: { from: 'a1', to: 'a8' }
        },
        {
          type: 'task', fen: '7k/Q7/6K1/8/8/8/8/8 w - - 0 1', goal: 'mate',
          text: 'Поставь мат ферзём! У чёрного короля не должно остаться ни одной свободной клетки.',
          hint: { from: 'a7', to: 'g7' }
        }
      ]
    },
    {
      id: 'castle', title: 'Рокировка', piece: 'r', emoji: '🏰', color: '#4a69ff',
      intro: 'Рокировка — особый ход короля и ладьи. Король шагает на две клетки к ладье, а ладья перепрыгивает через него и встаёт рядом.',
      rule: 'Так ходить нельзя! Для рокировки передвинь короля на две клетки к ладье.',
      levels: [
        {
          type: 'task', fen: '4k3/8/8/8/8/8/PPPPPPPP/R3K2R w KQ - 0 1', goal: 'castle-k',
          text: 'Сделай короткую рокировку! Нажми на короля и передвинь его на две клетки вправо.',
          hint: { from: 'e1', to: 'g1' }
        },
        {
          type: 'task', fen: '4k3/8/8/8/8/8/PPPPPPPP/R3K2R w KQ - 0 1', goal: 'castle-q',
          text: 'А теперь длинная рокировка! Передвинь короля на две клетки влево — ладья перепрыгнет через него.',
          hint: { from: 'e1', to: 'c1' }
        }
      ]
    },
    {
      id: 'special', title: 'Особые ходы', piece: 'p', emoji: '✨', color: '#8bc34a',
      intro: 'Пешка умеет два особых хода: превращаться в другую фигуру и брать на проходе!',
      rule: 'Так ходить нельзя! Попробуй другой ход.',
      levels: [
        {
          type: 'task', fen: '8/3P1k2/8/8/8/8/8/4K3 w - - 0 1', goal: 'promote-q',
          text: 'Доведи пешку до последней линии и преврати её в ферзя!',
          hint: { from: 'd7', to: 'd8', promotion: 'q' }
        },
        {
          type: 'task', fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', goal: 'ep',
          lastMove: { from: 'd7', to: 'd5' },
          text: 'Чёрная пешка прыгнула на две клетки и встала рядом с твоей. Съешь её на проходе: сходи наискосок, за её спину!',
          hint: { from: 'e5', to: 'd6' }
        }
      ]
    },

    /* ---- v2 (2026-09-28): appended groups. Everything above is frozen (saved progress refers to it). ---- */
    {
      id: 'defend', title: 'Защити фигуру', piece: 'r', emoji: '☂️', color: '#00b4d8',
      intro: 'Если на твою фигуру напали, её можно спасти: увести, защитить или съесть того, кто напал!',
      rule: 'Так ходить нельзя! Попробуй другой ход.',
      levels: [
        {
          type: 'task', fen: '6k1/8/5b2/8/3R4/8/8/6K1 w - - 0 1', goal: 'safe',
          text: 'Чёрный слон напал на ладью. Уведи ладью туда, где слон её не достанет!',
          fail: 'Ладью всё ещё могут съесть! Уведи её на безопасную клетку.',
          hint: { from: 'd4', to: 'a4' }
        },
        {
          type: 'task', fen: '4k3/8/2n1p3/4P3/8/8/5P2/6K1 w - - 0 1', goal: 'safe',
          text: 'Чёрный конь хочет съесть твою пешку, а убежать ей некуда. Защити её другой пешкой!',
          fail: 'Пешку всё ещё могут съесть! Защити её другой пешкой.',
          hint: { from: 'f2', to: 'f4' }
        },
        {
          type: 'task', fen: '8/8/7k/8/3n4/4P3/2R1B3/6K1 w - - 0 1', goal: 'safe',
          text: 'Чёрный конь напал сразу на ладью и на слона! Съешь его пешкой.',
          fail: 'Конь всё ещё может съесть твою фигуру! Съешь его пешкой.',
          hint: { from: 'e3', to: 'd4' }
        }
      ]
    },
    {
      id: 'fork', title: 'Вилка', piece: 'n', emoji: '🔱', color: '#e056fd',
      intro: 'Вилка — это когда одна фигура нападает сразу на две. Соперник спасёт только одну, а другую ты съешь!',
      rule: 'Так ходить нельзя! Попробуй другой ход.',
      levels: [
        {
          type: 'task', fen: '2q3k1/8/8/3N4/8/8/8/6K1 w - - 0 1', goal: 'fork',
          text: 'Прыгни конём так, чтобы он напал сразу на короля и на ферзя!',
          fail: 'Это не вилка. Найди клетку, откуда конь достанет и короля, и ферзя!',
          hint: { from: 'd5', to: 'e7' }
        },
        {
          type: 'task', fen: '6k1/1r4p1/1p3p2/5r2/2P1N3/7P/5PP1/6K1 w - - 0 1', goal: 'fork',
          text: 'Найди клетку, откуда конь нападёт сразу на обе ладьи!',
          fail: 'Это не вилка. Конь должен напасть сразу на две ладьи!',
          hint: { from: 'e4', to: 'd6' }
        },
        {
          type: 'task', fen: '6k1/8/2n1b3/8/3PP3/8/8/6K1 w - - 0 1', goal: 'fork',
          text: 'Пешка тоже умеет делать вилку! Шагни пешкой так, чтобы она напала на коня и на слона.',
          fail: 'Это не вилка. Пешка должна напасть сразу на две фигуры!',
          hint: { from: 'd4', to: 'd5' }
        },
        {
          type: 'task', fen: '4k3/8/8/r7/8/8/5PPP/3Q2K1 w - - 0 1', goal: 'fork',
          text: 'Ферзь может напасть сразу на двоих! Объяви шах и заодно напади на ладью.',
          fail: 'Это не вилка. Ферзь должен напасть и на короля, и на ладью — и так, чтобы его не съели!',
          hint: { from: 'd1', to: 'e1' }
        }
      ]
    },
    {
      id: 'maze', title: 'Лабиринты', piece: 'p', emoji: '🌀', color: '#d35400',
      intro: 'Пешки-стенки построили лабиринты! Найди дорогу, собери все звёздочки и съешь чёрные фигуры.',
      rule: 'Так ходить нельзя! Вспомни, как ходит эта фигура.',
      levels: [
        {
          type: 'stars', piece: 'R', start: 'a1', stars: ['h3', 'a5', 'a7'],
          walls: ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
            'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6'],
          enemies: [{ sq: 'd3', piece: 'p' }, { sq: 'e7', piece: 'n' }],
          text: 'Змейка! Веди ладью по извилистой дорожке, собери звёздочки и съешь чёрные фигуры.'
        },
        {
          type: 'stars', piece: 'B', start: 'f1', stars: ['e8', 'a4'],
          walls: ['d7', 'e7', 'c6', 'd6', 'e6', 'f6', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'd4', 'e4'],
          enemies: [{ sq: 'h7', piece: 'p' }, { sq: 'c2', piece: 'n' }],
          text: 'Пешки выстроились ёлочкой. Обойди её, съешь чёрные фигуры и достань звезду с верхушки!'
        },
        {
          type: 'stars', piece: 'N', start: 'a1', stars: ['e5', 'a8'],
          walls: ['c3', 'd3', 'e3', 'f3', 'c4', 'f4', 'c5', 'f5', 'c6', 'd6', 'e6', 'f6'],
          enemies: [{ sq: 'd4', piece: 'r' }],
          text: 'Пешки построили крепость. Конь перепрыгнет через стены! Съешь ладью и собери звёздочки.'
        },
        {
          type: 'stars', piece: 'Q', start: 'd1', stars: ['d4', 'e5'],
          walls: ['b7', 'c7', 'f7', 'g7', 'a6', 'd6', 'e6', 'h6', 'a5', 'h5', 'b4', 'g4', 'c3', 'f3', 'd2', 'e2'],
          enemies: [{ sq: 'a8', piece: 'r' }, { sq: 'h8', piece: 'r' }],
          text: 'Сердечко из пешек! Найди щёлочку, собери звёздочки внутри и съешь обе ладьи.'
        },
        {
          type: 'stars', piece: 'K', start: 'a1', stars: ['d5', 'e5'],
          walls: ['c2', 'd2', 'f2', 'c3', 'f3', 'c4', 'f4', 'c5', 'f5', 'c6', 'd6', 'e6', 'f6'],
          enemies: [{ sq: 'e3', piece: 'n' }, { sq: 'd4', piece: 'p' }],
          text: 'Король идёт в свой замок! Войди в ворота, съешь чужие фигуры и забери звёздочки.'
        }
      ]
    }
  ];

  /* ================================================================ puzzles: mate in 1, White to move */

  var PUZZLES = [
    {
      id: 1, fen: 'k7/8/1K6/8/8/8/8/7R w - - 0 1', difficulty: 1,
      title: 'Ладья и король', text: 'Король уже помог. Поставь мат ладьёй!',
      hint: { from: 'h1', to: 'h8' }
    },
    {
      id: 2, fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', difficulty: 1,
      title: 'Мат на краю доски', text: 'Чёрные пешки заперли своего короля. Поставь мат в 1 ход!',
      hint: { from: 'a1', to: 'a8' }
    },
    {
      id: 3, fen: '6k1/5ppp/8/8/8/8/8/3Q2K1 w - - 0 1', difficulty: 1,
      title: 'Ферзь на краю доски', text: 'Королю некуда шагнуть вперёд. Поставь мат ферзём!',
      hint: { from: 'd1', to: 'd8' }
    },
    {
      id: 4, fen: 'k7/pp6/8/8/8/8/8/3R2K1 w - - 0 1', difficulty: 1,
      title: 'Мат в углу', text: 'Король спрятался в углу. Поставь мат ладьёй!',
      hint: { from: 'd1', to: 'd8' }
    },
    {
      id: 5, fen: 'k7/7Q/1K6/8/8/8/8/8 w - - 0 1', difficulty: 1,
      title: 'Ферзь и король', text: 'Ферзь и король работают вместе. Поставь мат в 1 ход!',
      hint: { from: 'h7', to: 'b7' }
    },
    {
      id: 6, fen: '7k/R7/8/8/8/8/8/1R4K1 w - - 0 1', difficulty: 1,
      title: 'Две ладьи', text: 'Одна ладья уже держит линию. Поставь мат второй ладьёй!',
      hint: { from: 'b1', to: 'b8' }
    },
    {
      id: 7, fen: '4k3/8/4K3/8/8/Q7/8/8 w - - 0 1', difficulty: 2,
      title: 'Ферзь рядом с королём', text: 'Поставь ферзя так, чтобы твой король его защищал. Мат в 1 ход!',
      hint: { from: 'a3', to: 'e7' }
    },
    {
      id: 8, fen: '7k/7p/8/6NQ/8/8/8/6K1 w - - 0 1', difficulty: 2,
      title: 'Ферзь и конь', text: 'Конь защищает ферзя. Поставь мат в 1 ход!',
      hint: { from: 'h5', to: 'h7' }
    },
    {
      id: 9, fen: '7k/6pp/8/8/8/8/1B6/6QK w - - 0 1', difficulty: 2,
      title: 'Ферзь и слон', text: 'Слон смотрит на короля издалека. Поставь мат ферзём!',
      hint: { from: 'g1', to: 'g7' }
    },
    {
      id: 10, fen: '5rk1/5pp1/8/7Q/8/3B4/8/6K1 w - - 0 1', difficulty: 2,
      title: 'Слон помогает ферзю', text: 'Найди клетку рядом с королём, которую защищает слон!',
      hint: { from: 'h5', to: 'h7' }
    },
    {
      id: 11, fen: '7k/5K1p/6P1/8/8/8/8/8 w - - 0 1', difficulty: 2,
      title: 'Пешка ставит мат', text: 'Даже маленькая пешка может поставить мат! Найди этот ход.',
      hint: { from: 'g6', to: 'g7' }
    },
    {
      id: 12, fen: '6k1/4Pppp/8/8/8/8/8/6K1 w - - 0 1', difficulty: 2,
      title: 'Новый ферзь', text: 'Пешка почти дошла до края доски. Поставь мат в 1 ход!',
      hint: { from: 'e7', to: 'e8', promotion: 'q' }
    },
    {
      id: 13, fen: '7k/8/5N2/8/8/8/8/6RK w - - 0 1', difficulty: 2,
      title: 'Конь помогает ладье', text: 'Конь сторожит клетки рядом с королём. Поставь мат ладьёй!',
      hint: { from: 'g1', to: 'g8' }
    },
    {
      id: 14, fen: '7k/R7/5N2/8/8/8/8/6K1 w - - 0 1', difficulty: 2,
      title: 'Ладья и конь', text: 'Ладья и конь — отличная команда. Поставь мат в 1 ход!',
      hint: { from: 'a7', to: 'h7' }
    },
    {
      id: 15, fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', difficulty: 3,
      title: 'Детский мат', text: 'Ферзь и слон целятся в одну клетку. Поставь мат в 1 ход!',
      hint: { from: 'h5', to: 'f7' }
    },
    {
      id: 16, fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', difficulty: 3,
      title: 'Спёртый мат', text: 'Чёрный король окружён своими же фигурами. Поставь мат конём!',
      hint: { from: 'g5', to: 'f7' }
    },
    {
      id: 17, fen: '3rkr2/8/8/8/8/1Q6/8/6K1 w - - 0 1', difficulty: 3,
      title: 'Мат «эполеты»', text: 'Ладьи стоят по бокам от короля, как эполеты на плечах. Поставь мат ферзём!',
      hint: { from: 'b3', to: 'e6' }
    },
    {
      id: 18, fen: '5r2/4N1pk/8/8/8/3R4/8/6K1 w - - 0 1', difficulty: 3,
      title: 'Мат Анастасии', text: 'Конь сторожит клетки вокруг короля. Поставь мат ладьёй!',
      hint: { from: 'd3', to: 'h3' }
    },

    /* ---- v2 (2026-09-28): appended mate-in-1 puzzles, again easy → harder. Ids 1..18 above are frozen. ---- */
    {
      id: 19, fen: '6bk/7p/8/8/8/8/8/2B3K1 w - - 0 1', difficulty: 1,
      title: 'Слон ставит мат', text: 'Слон тоже умеет ставить мат! Найди длинную диагональ, которая ведёт прямо к королю.',
      hint: { from: 'c1', to: 'b2' }
    },
    {
      id: 20, fen: '7k/1P6/6Q1/8/8/8/8/K7 w - - 0 1', difficulty: 1,
      title: 'Два ферзя', text: 'Пешка почти дошла до края доски. Сделай второго ферзя — и сразу будет мат!',
      hint: { from: 'b7', to: 'b8', promotion: 'q' }
    },
    {
      id: 21, fen: '5r1k/6pp/8/8/8/3Q4/8/6KR w - - 0 1', difficulty: 1,
      title: 'Ферзь и ладья', text: 'Ладья стоит сзади и защищает ферзя. Поставь мат в 1 ход!',
      hint: { from: 'd3', to: 'h7' }
    },
    {
      id: 22, fen: '7k/6p1/8/8/2B5/8/8/3Q2K1 w - - 0 1', difficulty: 2,
      title: 'Мат Греко', text: 'Слон сторожит клетку рядом с королём. Поставь мат ферзём!',
      hint: { from: 'd1', to: 'h5' }
    },
    {
      id: 23, fen: '7k/7p/8/8/7B/8/8/2K3R1 w - - 0 1', difficulty: 2,
      title: 'Мат Морфи', text: 'Ладья держит соседнюю линию. Поставь мат слоном!',
      hint: { from: 'h4', to: 'f6' }
    },
    {
      id: 24, fen: '6k1/5p1p/5P1Q/8/8/8/8/6K1 w - - 0 1', difficulty: 2,
      title: 'Пешка помогает ферзю', text: 'Белая пешка защитит ферзя. Поставь мат в 1 ход!',
      hint: { from: 'h6', to: 'g7' }
    },
    {
      id: 25, fen: '4kb2/5p2/8/6B1/8/8/8/3R2K1 w - - 0 1', difficulty: 2,
      title: 'Оперный мат', text: 'Слон издалека защищает ладью. Поставь мат ладьёй!',
      hint: { from: 'd1', to: 'd8' }
    },
    {
      id: 26, fen: '2b1k3/3p1p2/8/3N4/8/Q7/8/6K1 w - - 0 1', difficulty: 2,
      title: 'Мат перед носом', text: 'Конь защитит ферзя. Поставь мат прямо перед носом у короля!',
      hint: { from: 'a3', to: 'e7' }
    },
    {
      id: 27, fen: '2kr4/p2p4/8/8/5B2/8/4B3/6K1 w - - 0 1', difficulty: 3,
      title: 'Два слона', text: 'Один слон уже сторожит клетки. Поставь мат вторым слоном!',
      hint: { from: 'e2', to: 'a6' }
    },
    {
      id: 28, fen: '6nr/5Ppk/6pp/8/8/8/8/1K6 w - - 0 1', difficulty: 3,
      title: 'Хитрое превращение', text: 'Не спеши делать ферзя! Подумай, какая фигура поставит мат.',
      hint: { from: 'f7', to: 'f8', promotion: 'n' }
    },
    {
      id: 29, fen: '5rk1/8/8/6N1/8/3B4/1B6/6K1 w - - 0 1', difficulty: 3,
      title: 'Мат Блэкберна', text: 'Два слона и конь — дружная команда. Поставь мат в 1 ход!',
      hint: { from: 'd3', to: 'h7' }
    },
    {
      id: 30, fen: 'rn1q1bnr/ppp1kB1p/3p2p1/4N3/4P3/2N5/PPPP1PPP/R1BbK2R w KQ - 1 7', difficulty: 3,
      title: 'Мат Легаля', text: 'Чёрные съели ферзя и радуются. А ты поставь мат в 1 ход!',
      hint: { from: 'c3', to: 'd5' }
    }
  ];

  /* ================================================================ puzzles: mate in 2, White to move */

  /* no mate in 1 at the start; forced mate in 2 (see isMate2Move / bestDefense) */
  var PUZZLES_MATE2 = [
    {
      id: 'm2-1', kind: 'mate2', fen: '8/4k3/R7/8/8/8/8/1R4K1 w - - 0 1', difficulty: 1,
      title: 'Лесенка', text: 'Две ладьи шагают по лесенке: одна объявляет шах, другая ставит мат. Мат в 2 хода!',
      hint: { from: 'b1', to: 'b7' }
    },
    {
      id: 'm2-2', kind: 'mate2', fen: '7k/p7/5PK1/8/8/8/8/8 w - - 0 1', difficulty: 1,
      title: 'Пешка идёт в ферзи', text: 'Пешка мечтает стать ферзём. Помоги ей и поставь мат в 2 хода!',
      hint: { from: 'f6', to: 'f7' }
    },
    {
      id: 'm2-3', kind: 'mate2', fen: '7k/8/5K2/8/8/8/8/6R1 w - - 0 1', difficulty: 1,
      title: 'Король помогает', text: 'Сначала подведи короля поближе, а потом поставь мат ладьёй!',
      hint: { from: 'f6', to: 'f7' }
    },
    {
      id: 'm2-4', kind: 'mate2', fen: '5k2/8/4K3/8/8/8/8/1R6 w - - 0 1', difficulty: 2,
      title: 'Тихий ход ладьёй', text: 'Не спеши объявлять шах! Сделай тихий ход ладьёй, а потом поставь мат.',
      hint: { from: 'b1', to: 'g1' }
    },
    {
      id: 'm2-5', kind: 'mate2', fen: '3k4/8/1K6/8/8/8/5Q2/8 w - - 0 1', difficulty: 2,
      title: 'Тихий ход ферзём', text: 'Запри короля ферзём, чтобы у него осталась одна клетка. А потом поставь мат!',
      hint: { from: 'f2', to: 'f7' }
    },
    {
      id: 'm2-6', kind: 'mate2', fen: '6k1/6pp/8/8/K7/3B1R2/8/8 w - - 0 1', difficulty: 2,
      title: 'Слон и ладья', text: 'Слон прогонит короля в угол, а ладья поставит мат!',
      hint: { from: 'd3', to: 'c4' }
    },
    {
      id: 'm2-7', kind: 'mate2', fen: '3r2k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1', difficulty: 2,
      title: 'Прорыв ладей', text: 'Чёрная ладья одна сторожит последнюю линию. Две белые ладьи сильнее — поставь мат в 2 хода!',
      hint: { from: 'e2', to: 'e8' }
    },
    {
      id: 'm2-8', kind: 'mate2', fen: '6k1/5ppp/8/2K3N1/8/8/5Q2/8 w - - 0 1', difficulty: 2,
      title: 'Шах, а потом мат', text: 'Конь поддержит ферзя. Объяви шах, а следующим ходом поставь мат!',
      hint: { from: 'f2', to: 'f7' }
    },
    {
      id: 'm2-9', kind: 'mate2', fen: 'r2r2k1/5ppp/8/8/3Q4/8/5PPP/3R2K1 w - - 0 1', difficulty: 3,
      title: 'Жертва ферзя', text: 'Отдай ферзя, чтобы ладья смогла поставить мат!',
      hint: { from: 'd4', to: 'd8' }
    },
    {
      id: 'm2-10', kind: 'mate2', fen: '4r2k/6pp/7N/3Q4/8/8/8/6K1 w - - 0 1', difficulty: 3,
      title: 'Спёртый мат в 2 хода', text: 'Отдай ферзя, и конь поставит мат! Чёрного короля запрут его же фигуры.',
      hint: { from: 'd5', to: 'g8' }
    }
  ];

  /* ================================================================ puzzles: win material, White to move */

  /* solutions: first moves in UCI; reply: Black's answer (legal after every solution); then the child finishes
     with a capture worth ≥ finish.minValue (or a mate). Without reply the first move solves the puzzle. */
  var PUZZLES_WIN = [
    {
      id: 'w-1', kind: 'win', fen: '6k1/5pp1/7p/3n4/8/8/5PPP/3R2K1 w - - 0 1', difficulty: 1,
      title: 'Съешь коня', text: 'Чёрный конь остался без защиты. Съешь его!',
      solutions: ['d1d5'],
      fail: 'Посмотри: чёрного коня никто не защищает. Какая твоя фигура может его съесть?'
    },
    {
      id: 'w-2', kind: 'win', fen: '6k1/2p2p1p/3p1b2/8/4N3/8/5PPP/6K1 w - - 0 1', difficulty: 1,
      title: 'Кого съесть?', text: 'Конь может съесть пешку или слона. Съешь того, кого никто не защищает!',
      solutions: ['e4f6'],
      fail: 'Пешку защищает другая пешка, а слона не защищает никто. Съешь слона!'
    },
    {
      id: 'w-3', kind: 'win', fen: 'q3k3/8/8/3N4/8/8/5PPP/6K1 w - - 0 1', difficulty: 1,
      title: 'Вилка конём', text: 'Прыгни конём так, чтобы напасть сразу на короля и на ферзя!',
      solutions: ['d5c7'], reply: 'e8d7', finish: { minValue: 900 },
      fail: 'Ищи прыжок, после которого конь объявит шах и нападёт на ферзя!'
    },
    {
      id: 'w-4', kind: 'win', fen: '3r4/6kp/6p1/2N5/8/8/5PPP/6K1 w - - 0 1', difficulty: 2,
      title: 'Королевская вилка', text: 'Объяви шах конём и одновременно напади на ладью!',
      solutions: ['c5e6'], reply: 'g7f7', finish: { minValue: 500 },
      fail: 'Ищи прыжок с шахом, который нападает и на ладью!'
    },
    {
      id: 'w-5', kind: 'win', fen: '6k1/5ppp/8/2n1b3/8/4P3/3P1PPP/6K1 w - - 0 1', difficulty: 2,
      title: 'Вилка пешкой', text: 'Шагни пешкой так, чтобы она напала сразу на две фигуры!',
      solutions: ['d2d4'], reply: 'c5d7', finish: { minValue: 300 },
      fail: 'Пешка должна напасть сразу на коня и на слона. Вспомни: первым ходом пешка может шагнуть на две клетки!'
    },
    {
      id: 'w-6', kind: 'win', fen: '4k3/2r1p1r1/2p5/5Pp1/3N4/8/5PPP/6K1 w - - 0 1', difficulty: 2,
      title: 'Конь и две ладьи', text: 'Прыгни конём так, чтобы напасть сразу на обе ладьи!',
      solutions: ['d4e6'], reply: 'c7b7', finish: { minValue: 500 },
      fail: 'Найди клетку, откуда конь достанет обе ладьи!'
    },
    {
      id: 'w-7', kind: 'win', fen: '6k1/5pp1/7p/r7/8/8/5PPP/3Q2K1 w - - 0 1', difficulty: 2,
      title: 'Шах и ладья', text: 'Объяви шах ферзём так, чтобы заодно напасть на ладью!',
      solutions: ['d1d8'], reply: 'g8h7', finish: { minValue: 500 },
      fail: 'Ищи шах, после которого ферзь нападает и на ладью!'
    },
    {
      id: 'w-8', kind: 'win', fen: '6k1/2p2pp1/7p/n5b1/8/8/5PPP/3Q2K1 w - - 0 1', difficulty: 2,
      title: 'Ферзь нападает на двоих', text: 'Поставь ферзя так, чтобы он напал сразу на коня и на слона!',
      solutions: ['d1d5'], reply: 'g5f6', finish: { minValue: 300 },
      fail: 'Ищи клетку в центре доски, откуда ферзь нападёт и на коня, и на слона. Коню тогда некуда будет убежать!'
    },
    {
      id: 'w-9', kind: 'win', fen: '4k3/pp6/8/4q3/8/8/PP3K2/3R4 w - - 0 1', difficulty: 3,
      title: 'Ферзю не уйти', text: 'Чёрный ферзь стоит прямо перед своим королём. Напади на него ладьёй — ферзю не уйти!',
      solutions: ['d1e1'], reply: 'e5e1', finish: { minValue: 900 },
      fail: 'Поставь ладью на одну линию с ферзём и королём!'
    },
    {
      id: 'w-10', kind: 'win', fen: '4k3/3q4/8/8/P7/8/5PPP/5BK1 w - - 0 1', difficulty: 3,
      title: 'Слон ловит ферзя', text: 'Чёрный ферзь закрывает своего короля. Напади на ферзя слоном!',
      solutions: ['f1b5'], reply: 'd7b5', finish: { minValue: 900 },
      fail: 'Поставь слона на одну диагональ с ферзём и королём, туда, где его защищает пешка!'
    },
    {
      id: 'w-11', kind: 'win', fen: '7q/8/5k2/8/8/8/5PPP/4B1K1 w - - 0 1', difficulty: 3,
      title: 'Шах и добыча', text: 'Объяви шах слоном. Король отойдёт — и ты съешь ферзя, который прятался за ним!',
      solutions: ['e1c3'], reply: 'f6f5', finish: { minValue: 900 },
      fail: 'Ищи шах слоном по той диагонали, где за королём стоит ферзь!'
    },
    {
      id: 'w-12', kind: 'win', fen: '4q3/8/8/8/4k3/8/6PP/R6K w - - 0 1', difficulty: 3,
      title: 'Ферзь за спиной короля', text: 'Объяви шах ладьёй. Король уйдёт — и откроет ферзя!',
      solutions: ['a1e1'], reply: 'e4d5', finish: { minValue: 900 },
      fail: 'Ищи шах ладьёй по той линии, где за королём прячется ферзь!'
    }
  ];

  var PUZZLE_SETS = [
    {
      id: 'mate1', title: 'Мат в 1 ход', emoji: '🏁', color: '#ff7a59',
      text: 'Найди один ход, который ставит мат!',
      puzzles: PUZZLES
    },
    {
      id: 'mate2', title: 'Мат в 2 хода', emoji: '🎯', color: '#6c63ff',
      text: 'Сначала хитрый ход, а потом мат! Чёрные будут защищаться.',
      puzzles: PUZZLES_MATE2
    },
    {
      id: 'win', title: 'Выиграй фигуру', emoji: '⚔️', color: '#2ecc71',
      text: 'Хитрые ходы: найди ход, после которого соперник потеряет фигуру!',
      puzzles: PUZZLES_WIN
    }
  ];

  /* ================================================================ stars levels */

  /* parsed description of a stars level: {type, start, stars:[sq], walls:[sq], enemies:[{sq, piece}]} or null */
  function parseStars(level) {
    if (!level || typeof level !== 'object') return null;
    var type = toType(level.piece) || ROOK;
    var start = toSq(level.start);
    if (start < 0) return null;
    var seen = {};
    seen[start] = true;
    var walls = [];
    (Array.isArray(level.walls) ? level.walls : []).forEach(function (w) {
      var s = toSq(w);
      if (s >= 0 && !seen[s]) { seen[s] = true; walls.push(s); }
    });
    var enemies = [];
    (Array.isArray(level.enemies) ? level.enemies : []).forEach(function (e) {
      if (!e) return;
      var s = toSq(e.sq);
      var t = toType(e.piece) || PAWN;
      if (t === KING) t = QUEEN;   // a king can never be captured — never used as a target
      if (s >= 0 && !seen[s]) { seen[s] = true; enemies.push({ sq: s, piece: BLACK | t }); }
    });
    var stars = [];
    (Array.isArray(level.stars) ? level.stars : []).forEach(function (st) {
      var s = toSq(st);
      if (s >= 0 && !seen[s]) { seen[s] = true; stars.push(s); }
    });
    return { type: type, start: start, stars: stars, walls: walls, enemies: enemies };
  }

  function emptyBoard() {
    var Ch = C();
    if (!Ch) return null;
    var c = new Ch(EMPTY_FEN);
    c.turn = WHITE;
    return c;
  }

  /*
   * Board of a stars level: walls (white pawns), enemies (black pieces) that are not captured in
   * collectedMask (bit index = number of stars + enemy index), the lesson piece on its start square.
   * No kings, White to move. Returns null when the engine or the level is missing.
   */
  function buildStarsPosition(level, collectedMask) {
    var d = parseStars(level);
    var c = emptyBoard();
    if (!d || !c) return null;
    var mask = typeof collectedMask === 'number' && isFinite(collectedMask) ? collectedMask | 0 : 0;
    var nS = d.stars.length;
    d.walls.forEach(function (s) { c.put(s, WHITE | PAWN); });
    d.enemies.forEach(function (e, j) {
      if (!(mask & (1 << (nS + j)))) c.put(e.sq, e.piece);
    });
    c.put(d.start, WHITE | d.type);
    c.turn = WHITE;
    return c;
  }

  /*
   * Shortest way to collect every target (stars first, then enemies) with the single lesson piece.
   * BFS over (square, piece type, collected mask). Walls always stand; enemies stand until captured;
   * stars never block. A pawn reaching the last rank may become any of the four pieces.
   * state = {sq, type, mask} continues from the current situation (for hints).
   * Returns { par, path:[{from, to, promotion}] } (squares as 0x88 numbers), or null when impossible.
   */
  function solveStars(level, state) {
    var d = parseStars(level);
    if (!d) return null;
    var nS = d.stars.length, nE = d.enemies.length, nT = nS + nE;
    if (nT > MAX_TARGETS) return null;
    var full = nT ? (1 << nT) - 1 : 0;

    var sq0 = d.start, type0 = d.type, mask0 = 0;
    if (state && typeof state === 'object') {
      if (state.sq !== undefined && state.sq !== null) sq0 = toSq(state.sq);
      if (state.type !== undefined && state.type !== null) type0 = toType(state.type) || d.type;
      if (typeof state.mask === 'number' && isFinite(state.mask)) mask0 = (state.mask | 0) & full;
    }
    if (sq0 < 0) return null;
    if (d.walls.indexOf(sq0) >= 0) return null;

    /* target index by square (stars first, then enemies) */
    var targetAt = {};
    d.stars.forEach(function (s, i) { targetAt[s] = i; });
    d.enemies.forEach(function (e, j) { targetAt[e.sq] = nS + j; });
    /* standing on a target means it is collected */
    if (targetAt[sq0] !== undefined) mask0 |= 1 << targetAt[sq0];
    if (mask0 === full) return { par: 0, path: [] };

    var board = emptyBoard();
    if (!board) return null;
    d.walls.forEach(function (s) { board.put(s, WHITE | PAWN); });

    /* moves of (sq, type) for a set of captured enemies, cached */
    var moveCache = {};
    function movesFor(sq, type, mask) {
      var captured = nE ? (mask >> nS) & ((1 << nE) - 1) : 0;
      var key = (captured * 8 + type) * 128 + sq;
      var hit = moveCache[key];
      if (hit) return hit;
      var j;
      for (j = 0; j < nE; j++) if (!(captured & (1 << j))) board.put(d.enemies[j].sq, d.enemies[j].piece);
      board.put(sq, WHITE | type);
      var ms = board.pieceMoves(sq) || [];
      board.remove(sq);
      for (j = 0; j < nE; j++) if (!(captured & (1 << j))) board.remove(d.enemies[j].sq);
      var out = [];
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.captured && (m.captured & 24) !== BLACK) continue;
        out.push({ to: m.to, promotion: (m.flags & F_PROMO) ? (m.promotion & 7) : 0 });
      }
      moveCache[key] = out;
      return out;
    }

    var keyOf = function (sq, type, mask) { return (mask * 8 + type) * 128 + sq; };
    var startKey = keyOf(sq0, type0, mask0);
    var parent = {};
    parent[startKey] = null;
    var states = 1;
    var qSq = [sq0], qType = [type0], qMask = [mask0], qKey = [startKey];

    function pathTo(key) {
      var path = [];
      var node = parent[key];
      while (node) {
        path.push(node.move);
        node = parent[node.prev];
      }
      path.reverse();
      return path;
    }

    for (var qi = 0; qi < qSq.length; qi++) {
      var sq = qSq[qi], type = qType[qi], mask = qMask[qi], key = qKey[qi];
      var ms = movesFor(sq, type, mask);
      /* moves that collect something first — shortest paths then prefer visible progress (nicer hints) */
      var ordered = [], rest = [];
      for (var i = 0; i < ms.length; i++) {
        var ti = targetAt[ms[i].to];
        if (ti !== undefined && !(mask & (1 << ti))) ordered.push(ms[i]);
        else rest.push(ms[i]);
      }
      ordered = ordered.concat(rest);
      for (var k = 0; k < ordered.length; k++) {
        var m = ordered[k];
        var nt = m.promotion || type;
        var nm = mask;
        var tIdx = targetAt[m.to];
        if (tIdx !== undefined) nm |= 1 << tIdx;
        var nk = keyOf(m.to, nt, nm);
        if (parent[nk] !== undefined) continue;
        parent[nk] = { prev: key, move: { from: sq, to: m.to, promotion: m.promotion } };
        if (nm === full) {
          var path = pathTo(nk);
          return { par: path.length, path: path };
        }
        if (++states > MAX_STATES) return null;
        qSq.push(m.to); qType.push(nt); qMask.push(nm); qKey.push(nk);
      }
    }
    return null;
  }

  /* ================================================================ task goals */

  /* the engine Move (with flags) for a {from, to, promotion} in `before`, or null */
  function resolveMove(before, move) {
    if (!before || !move || typeof before.moves !== 'function') return null;
    var from = toSq(move.from), to = toSq(move.to);
    if (from < 0 || to < 0) return null;
    var promo = toType(move.promotion);
    var list = before.moves({ from: from });
    var fallback = null;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.to !== to) continue;
      if (m.flags & F_PROMO) {
        if ((m.promotion & 7) === (promo || QUEEN)) return m;
        if (!fallback) fallback = m;
        continue;
      }
      return m;
    }
    return fallback;
  }

  function capturedSquare(before, m) {
    if (!(m.flags & F_EP)) return m.to;
    return before.turn === WHITE ? m.to + 16 : m.to - 16;
  }

  function pieceValue(type) {
    var Ch = C();
    var v = Ch && Ch.VALUE ? Ch.VALUE : VALUE;
    return v[type & 7] || 0;
  }

  /*
   * Legal captures of `byColor` in pos, by captured square: { [sq]: [capturer type, ...] }.
   * Pins and checks are respected (only moves that are legal for byColor count).
   */
  function legalCaptures(pos, byColor) {
    var p = pos;
    if (p.turn !== byColor) {
      p = pos.clone();
      p.turn = byColor;
      p.ep = -1;
    }
    var out = {};
    var list = p.moves();
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m.captured) continue;
      var s = capturedSquare(p, m);
      (out[s] || (out[s] = [])).push(m.piece & 7);
    }
    return out;
  }

  /*
   * What `color` loses on sq when the opponent captures there (the engine's hangingPieces rule, but with
   * legal captures only): the full value when the piece is undefended, else value − cheapest legal capturer.
   */
  function lossOn(pos, sq, color, caps) {
    var p = pos.get(sq);
    if (!p || (p & 24) !== color) return 0;
    var list = caps[sq];
    if (!list || !list.length) return 0;
    var val = pieceValue(p & 7);
    var defenders = pos.attackers(sq, color) || [];
    if (!defenders.length) return val;
    var minA = Infinity;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === KING) continue;
      var v = pieceValue(list[i]);
      if (v < minA) minA = v;
    }
    return minA === Infinity ? 0 : Math.max(0, val - minA);
  }

  /* pieces of `color` (kings excluded) the opponent can win right now with a legal capture */
  function hangingLegal(pos, color) {
    var caps = legalCaptures(pos, color ^ 24);
    var out = [];
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = pos.get(sq);
      if (!p || (p & 24) !== color || (p & 7) === KING) continue;
      var loss = lossOn(pos, sq, color, caps);
      if (loss > 0) out.push({ sq: sq, piece: p, loss: loss });
    }
    return out;
  }

  /*
   * 'fork': after the move the moved piece (on m.to) attacks at least two enemy targets — the king, a piece
   * worth ≥ 300, or any piece worth more than the attacker — and it cannot be captured for free.
   */
  function isFork(after, to, us) {
    var piece = after.get(to);
    if (!piece || (piece & 24) !== us) return false;
    var them = us ^ 24;
    var atVal = (piece & 7) === KING ? Infinity : pieceValue(piece & 7);
    var targets = 0;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = after.get(sq);
      if (!p || (p & 24) !== them) continue;
      var t = p & 7;
      var isTarget = t === KING || pieceValue(t) >= 300 || pieceValue(t) > atVal;
      if (!isTarget) continue;
      if ((after.attackers(sq, us) || []).indexOf(to) >= 0) targets++;
    }
    if (targets < 2) return false;
    return lossOn(after, to, us, legalCaptures(after, them)) <= 0;
  }

  /*
   * Did `move` (made in chessBefore, giving chessAfter) reach the goal of a task level?
   * move may be an engine Move or just {from, to, promotion}; chessAfter is computed when missing.
   */
  function checkGoal(level, chessBefore, move, chessAfter) {
    if (!level || !chessBefore || !move) return false;
    var goal = String(level.goal || '');
    var m = resolveMove(chessBefore, move);
    if (!m) return false;
    var after = chessAfter;
    if (!after || typeof after.inCheck !== 'function') {
      after = chessBefore.clone();
      if (!after.move({ from: m.from, to: m.to, promotion: m.promotion })) return false;
    }
    var us = chessBefore.turn, them = us ^ 24;
    var t = m.piece & 7;
    var flags = m.flags | 0;
    var ownKingSafe = !after.inCheck(us);
    if (!ownKingSafe) return false;

    switch (goal) {
      case 'check':
        return after.inCheck();
      case 'mate':
        return after.isCheckmate();
      case 'escape':
        return chessBefore.inCheck();
      case 'escape-king':
        return chessBefore.inCheck() && t === KING;
      case 'escape-block':
      case 'escape-capture': {
        if (!chessBefore.inCheck()) return false;
        var ksq = chessBefore.kings ? chessBefore.kings[us] : -1;
        if (ksq === undefined || ksq < 0) return false;
        var checkers = chessBefore.attackers(ksq, them) || [];
        var takesChecker = !!m.captured && checkers.indexOf(capturedSquare(chessBefore, m)) >= 0;
        if (goal === 'escape-capture') return takesChecker;
        return t !== KING && !takesChecker;
      }
      case 'castle':
        return !!(flags & F_CASTLE);
      case 'castle-k':
        return !!(flags & F_CASTLE) && (m.to & 7) === 6;
      case 'castle-q':
        return !!(flags & F_CASTLE) && (m.to & 7) === 2;
      case 'promote':
        return !!(flags & F_PROMO);
      case 'promote-q':
        return !!(flags & F_PROMO) && (m.promotion & 7) === QUEEN;
      case 'ep':
        return !!(flags & F_EP);
      case 'capture': {
        if (!m.captured) return false;
        var target = toSq(level.target);
        return target < 0 || capturedSquare(chessBefore, m) === target;
      }
      case 'safe':
        return hangingLegal(after, us).length === 0;
      case 'fork':
        return isFork(after, m.to, us);
      case 'solution': {
        var sols = Array.isArray(level.solutions) ? level.solutions : (level.hint ? [level.hint] : []);
        for (var si = 0; si < sols.length; si++) if (solutionMatches(sols[si], m)) return true;
        return false;
      }
      default:
        return false;
    }
  }

  /* 'e2e4' for an engine move (promotion letter included: 'e7e8q') */
  function uciOf(m) {
    var s = sqName(m.from) + sqName(m.to);
    return (m.flags & F_PROMO) ? s + TYPE_CHARS.charAt(m.promotion & 7) : s;
  }

  function sqName(sq) {
    return 'abcdefgh'.charAt(sq & 7) + (8 - (sq >> 4));
  }

  /*
   * Does the engine move m match a listed solution? A solution is a UCI string ('e2e4', 'e7e8q', any case) or
   * {from, to, promotion}. A promotion must name the same piece (a solution without a letter means the queen,
   * like Chess#move); a solution with a letter never matches a move that does not promote.
   */
  function solutionMatches(sol, m) {
    var from, to, promo;
    if (typeof sol === 'string') {
      var s = sol.trim().toLowerCase();
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(s)) return false;
      from = sqFromName(s.slice(0, 2));
      to = sqFromName(s.slice(2, 4));
      promo = s.length > 4 ? toType(s.charAt(4)) : 0;
    } else if (sol && typeof sol === 'object') {
      from = toSq(sol.from);
      to = toSq(sol.to);
      promo = toType(sol.promotion);
    } else {
      return false;
    }
    if (from < 0 || from !== m.from || to !== m.to) return false;
    if (m.flags & F_PROMO) return (promo || QUEEN) === (m.promotion & 7);
    return !promo;
  }

  /* ================================================================ puzzle sets */

  /* id prefixes of the sets (used only when a puzzle object has no kind, or for an id that is not registered) */
  var KIND_PREFIXES = [[/^m2-/, 'mate2'], [/^m3-/, 'mate3'], [/^w-/, 'win'], [/^s-/, 'save'], [/^e-/, 'endgame']];

  function kindFromId(id) {
    var s = String(id);
    for (var i = 0; i < KIND_PREFIXES.length; i++) if (KIND_PREFIXES[i][0].test(s)) return KIND_PREFIXES[i][1];
    return 'mate1';
  }

  /*
   * The kind of a puzzle: p.kind || 'mate1' ('mate1'|'mate2'|'mate3'|'win'|'save'|'endgame').
   * Also takes a puzzle id (number or string): the registered puzzle's kind, else a guess by the id prefix.
   */
  function puzzleKind(p) {
    if (p && typeof p === 'object') {
      if (typeof p.kind === 'string' && p.kind) return p.kind;
      return p.id === undefined || p.id === null ? 'mate1' : kindFromId(p.id);
    }
    var found = puzzleById(p);
    if (found) return typeof found.kind === 'string' && found.kind ? found.kind : kindFromId(found.id);
    return kindFromId(p);
  }

  /* every puzzle of every set, in set order (for totals); sets added with addPuzzleSet included */
  function allPuzzles() {
    var out = [];
    PUZZLE_SETS.forEach(function (set) { out = out.concat(set.puzzles || []); });
    return out;
  }

  /* the puzzle with this id (number or string, as stored in profile.puzzles keys) or null */
  function puzzleById(id) {
    var key = String(id);
    for (var s = 0; s < PUZZLE_SETS.length; s++) {
      var list = PUZZLE_SETS[s].puzzles || [];
      for (var i = 0; i < list.length; i++) if (String(list[i].id) === key) return list[i];
    }
    return null;
  }

  /* the puzzle set with this id or null */
  function puzzleSet(setId) {
    var key = String(setId);
    for (var i = 0; i < PUZZLE_SETS.length; i++) if (String(PUZZLE_SETS[i].id) === key) return PUZZLE_SETS[i];
    return null;
  }

  /* ================================================================ registration of new content (v3) */
  /*
   * New content lives in its own files and is appended here at load time. GROUPS, PUZZLE_SETS and every set's
   * puzzles array are mutated in place, so everyone holding Lessons.GROUPS / Lessons.PUZZLES / … sees it.
   * Nothing that exists is ever replaced or reordered (saved progress refers to it by position and id).
   * Each call validates the whole batch first: on an error it throws and adds nothing.
   */

  function listOf(v, what) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') return [v];
    throw new TypeError('Lessons.' + what + ': expected an array of objects');
  }

  /* profile key (String(id)) → set id, for every registered puzzle */
  function puzzleIdsInUse() {
    var used = {};
    PUZZLE_SETS.forEach(function (set) {
      (set.puzzles || []).forEach(function (p) {
        if (p && p.id !== undefined && p.id !== null) used[String(p.id)] = String(set.id);
      });
    });
    return used;
  }

  function checkNewPuzzles(list, used, where) {
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (!p || typeof p !== 'object') throw new TypeError(where + ': puzzle #' + i + ' is not an object');
      if (p.id === undefined || p.id === null || String(p.id) === '') {
        throw new TypeError(where + ': puzzle #' + i + ' has no id');
      }
      var key = String(p.id);
      if (Object.prototype.hasOwnProperty.call(used, key)) {
        throw new Error(where + ': duplicate puzzle id "' + key + '" (already in set "' + used[key] + '")');
      }
      if (seen[key]) throw new Error(where + ': duplicate puzzle id "' + key + '" in the same batch');
      seen[key] = true;
    }
  }

  /* append lesson groups after the existing ones; returns the added groups */
  function addGroups(groups) {
    var list = listOf(groups, 'addGroups');
    var ids = {};
    GROUPS.forEach(function (g) { ids[g.id] = true; });
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (!g || typeof g !== 'object') throw new TypeError('Lessons.addGroups: group #' + i + ' is not an object');
      if (typeof g.id !== 'string' || !g.id) throw new TypeError('Lessons.addGroups: group #' + i + ' has no id');
      if (!Array.isArray(g.levels)) throw new TypeError('Lessons.addGroups: group "' + g.id + '" has no levels array');
      if (Object.prototype.hasOwnProperty.call(ids, g.id)) {
        throw new Error('Lessons.addGroups: duplicate group id "' + g.id + '"');
      }
      ids[g.id] = true;
    }
    for (var j = 0; j < list.length; j++) GROUPS.push(list[j]);
    return list.slice();
  }

  /* append puzzles to an existing set (e.g. 'mate1' → Lessons.PUZZLES); returns the set */
  function addPuzzles(setId, puzzles) {
    var set = puzzleSet(setId);
    if (!set) throw new Error('Lessons.addPuzzles: unknown puzzle set "' + setId + '"');
    var list = listOf(puzzles, 'addPuzzles');
    if (!Array.isArray(set.puzzles)) set.puzzles = [];
    checkNewPuzzles(list, puzzleIdsInUse(), 'Lessons.addPuzzles(' + set.id + ')');
    for (var i = 0; i < list.length; i++) set.puzzles.push(list[i]);
    return set;
  }

  /* append a new puzzle set {id, title, emoji, color, text, puzzles, endless?}; returns the set */
  function addPuzzleSet(set) {
    if (!set || typeof set !== 'object' || Array.isArray(set)) throw new TypeError('Lessons.addPuzzleSet: expected a set object');
    if (typeof set.id !== 'string' || !set.id) throw new TypeError('Lessons.addPuzzleSet: the set has no id');
    if (puzzleSet(set.id)) throw new Error('Lessons.addPuzzleSet: duplicate set id "' + set.id + '"');
    if (set.puzzles === undefined || set.puzzles === null) set.puzzles = [];
    if (!Array.isArray(set.puzzles)) throw new TypeError('Lessons.addPuzzleSet: puzzles of "' + set.id + '" must be an array');
    checkNewPuzzles(set.puzzles, puzzleIdsInUse(), 'Lessons.addPuzzleSet(' + set.id + ')');
    PUZZLE_SETS.push(set);
    return set;
  }

  /*
   * Mate in 2: is `move` (White's first move in chessBefore) correct? True when it mates at once, or when
   * EVERY legal reply leaves a mate in 1. A move that stalemates is not correct. chessBefore is not changed.
   */
  function isMate2Move(chessBefore, move) {
    if (!chessBefore || !move || typeof chessBefore.clone !== 'function') return false;
    var m = resolveMove(chessBefore, move);
    if (!m) return false;
    var a = chessBefore.clone();
    if (!a.move({ from: m.from, to: m.to, promotion: m.promotion })) return false;
    if (a.isCheckmate()) return true;
    var replies = a.moves();
    if (!replies.length) return false;
    for (var i = 0; i < replies.length; i++) {
      a.make(replies[i]);
      var mates = a.mateInOne().length;
      a.unmake();
      if (!mates) return false;
    }
    return true;
  }

  /*
   * Black's answer in a mate-in-2 puzzle: the legal reply that leaves White the fewest mating moves
   * (a reply with none refutes a wrong first move). Ties: bigger capture first, then the lowest from / to /
   * promotion, so the choice is deterministic. Returns the engine Move (with .san) or null (no legal reply).
   */
  function bestDefense(chessAfter) {
    if (!chessAfter || typeof chessAfter.moves !== 'function') return null;
    var a = chessAfter.clone();
    var replies = a.moves();
    var best = null, bestKey = null;
    for (var i = 0; i < replies.length; i++) {
      var r = replies[i];
      a.make(r);
      var mates = a.mateInOne().length;
      a.unmake();
      var key = [mates, -(r.captured ? pieceValue(r.captured & 7) : 0), r.from, r.to, r.promotion | 0];
      var better = !bestKey;
      for (var k = 0; !better && k < key.length; k++) {
        if (key[k] !== bestKey[k]) { better = key[k] < bestKey[k]; break; }
      }
      if (better) { best = r; bestKey = key; }
    }
    if (best && typeof a.san === 'function') {
      try { best.san = a.san(best); } catch (e) { /* SAN is only a nicety */ }
    }
    return best;
  }

  /* ================================================================ mate in N (v3) */
  /*
   * "Mate in ≤ k" is decided by a small exact search over make/unmake (no evaluation, no depth limit other than
   * k): the attacker tries checks first (a mate in 1 can only be a check), then captures, then quiet moves; the
   * defender tries the reply that refuted a sibling first (killer), then captures, then the rest, and stops at the
   * first reply that escapes. Results are cached per position (Zobrist hash) as "mates in ≤ t" / "not in ≤ f",
   * which is exact because "mate in ≤ k" only grows with k. Repetition and the fifty-move rule are ignored (as in
   * isMate2Move). The searched position is always restored.
   */
  var MAX_MATE_N = 5;

  function mateDepth(n, dflt) {
    var k = Math.floor(Number(n));
    if (!isFinite(k)) k = dflt;
    return k < 1 ? 1 : (k > MAX_MATE_N ? MAX_MATE_N : k);
  }

  function hasLegalMove(c) {
    return typeof c._hasLegal === 'function' ? c._hasLegal() : c.moves().length > 0;
  }

  function moveCode(m) {
    return ((m.from * 128 + m.to) * 8) + (m.promotion & 7);
  }

  function MateSearch(c) {
    this.c = c;
    this.tt = typeof Map === 'function' ? new Map() : null;
    this.ttObj = this.tt ? null : {};
    this.killer = [];
    this.nodes = 0;
  }

  MateSearch.prototype.ttGet = function (key) {
    return this.tt ? this.tt.get(key) : this.ttObj[key];
  };

  MateSearch.prototype.ttPut = function (key, k, res) {
    var e = this.ttGet(key);
    if (!e) {
      e = { t: Infinity, f: 0 };
      if (this.tt) this.tt.set(key, e); else this.ttObj[key] = e;
    }
    if (res) { if (k < e.t) e.t = k; } else if (k > e.f) e.f = k;
  };

  /* legal moves of the side to move, without .san */
  MateSearch.prototype.legal = function () {
    var c = this.c, us = c.turn, list = c.genMoves(false), out = [];
    for (var i = 0; i < list.length; i++) {
      c.make(list[i]);
      if (!c.inCheck(us)) out.push(list[i]);
      c.unmake();
    }
    return out;
  };

  /* side to move (the attacker) can force mate in ≤ k of its own moves */
  MateSearch.prototype.canMate = function (k) {
    var c = this.c;
    var key = c.hashLo + ':' + c.hashHi;
    var e = this.ttGet(key);
    if (e) {
      if (e.t <= k) return true;
      if (e.f >= k) return false;
    }
    var res = this.searchMate(k);
    this.ttPut(key, k, res);
    return res;
  };

  MateSearch.prototype.searchMate = function (k) {
    var c = this.c, us = c.turn, them = us ^ 24;
    var list = c.genMoves(false);
    var checks = [], caps = [], quiet = [];
    var i, m;
    this.nodes++;
    for (i = 0; i < list.length; i++) {
      m = list[i];
      c.make(m);
      if (!c.inCheck(us)) {
        if (c.inCheck(them)) {
          if (!hasLegalMove(c)) { c.unmake(); return true; }      // mate at once
          if (k > 1) checks.push(m);
        } else if (k > 1) {
          if (m.captured || (m.flags & F_PROMO)) caps.push(m); else quiet.push(m);
        }
      }
      c.unmake();
    }
    if (k <= 1) return false;
    caps.sort(function (a, b) { return pieceValue(b.captured & 7) - pieceValue(a.captured & 7); });
    var order = checks.concat(caps, quiet);
    for (i = 0; i < order.length; i++) {
      c.make(order[i]);
      var ok = this.forces(k);
      c.unmake();
      if (ok) return true;
    }
    return false;
  };

  /*
   * The attacker has just moved (defender to move): is it mate, or does every reply leave the attacker a
   * forced mate in ≤ k − 1? No legal reply without check = stalemate = false.
   */
  MateSearch.prototype.forces = function (k) {
    var c = this.c, us = c.turn;
    if (k <= 1) return c.inCheck(us) && !hasLegalMove(c);
    var list = c.genMoves(false);
    var kill = this.killer[k];
    var first = [], caps = [], rest = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (kill !== undefined && moveCode(m) === kill) first.push(m);
      else if (m.captured) caps.push(m);
      else rest.push(m);
    }
    caps.sort(function (a, b) { return pieceValue(b.captured & 7) - pieceValue(a.captured & 7); });
    var order = first.concat(caps, rest);
    var legal = 0;
    for (var j = 0; j < order.length; j++) {
      var r = order[j];
      c.make(r);
      if (c.inCheck(us)) { c.unmake(); continue; }
      legal++;
      var ok = this.canMate(k - 1);
      c.unmake();
      if (!ok) {
        this.killer[k] = moveCode(r);
        return false;
      }
    }
    return legal > 0 || c.inCheck(us);
  };

  /* moves of the side to move forcing mate in ≤ k, each with .mateIn (the fastest forced mate, 1..k) */
  MateSearch.prototype.rootMates = function (k) {
    var c = this.c, out = [];
    if (k < 1) return out;
    var list = this.legal();
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      c.make(m);
      var best = 0;
      for (var j = 1; j <= k && !best; j++) if (this.forces(j)) best = j;
      c.unmake();
      if (best) {
        m.mateIn = best;
        out.push(m);
      }
    }
    return out;
  };

  function sanOf(c, m) {
    if (typeof c.san === 'function') {
      try { m.san = c.san(m); } catch (e) { /* SAN is only a nicety */ }
    }
    return m;
  }

  /*
   * Mate in n: is `move` (made by the side to move in chessBefore) correct? True when it mates at once, or when
   * (n > 1) EVERY legal reply leaves a move that is again isMateInMove(…, n − 1). A stalemating or illegal move
   * is wrong. n = 2 is exactly isMate2Move. chessBefore is not changed. n is clamped to 1..5 (fast for n ≤ 3).
   */
  function isMateInMove(chessBefore, move, n) {
    if (!chessBefore || !move || typeof chessBefore.clone !== 'function') return false;
    var m = resolveMove(chessBefore, move);
    if (!m) return false;
    var c = chessBefore.clone();
    c.make(m);
    return new MateSearch(c).forces(mateDepth(n, 1));
  }

  /*
   * The legal moves of the side to move that force mate in ≤ n (n clamped to 1..5, fast for n ≤ 3 on small
   * boards), in the engine's move order. Each Move has .san and .mateIn = the fastest forced mate (1..n) — a hint
   * should prefer the smallest. chess is not changed.
   */
  function mateInN(chess, n) {
    if (!chess || typeof chess.clone !== 'function') return [];
    var c = chess.clone();
    var out = new MateSearch(c).rootMates(mateDepth(n, 1));
    for (var i = 0; i < out.length; i++) sanOf(c, out[i]);
    return out;
  }

  /*
   * Black's answer in a mate-in-n puzzle (chessAfter = after White's move, n = White moves left including the one
   * just made): the legal reply that leaves White the fewest moves forcing mate in ≤ n − 1 (a reply leaving none
   * refutes a wrong move). Ties: the reply after which White's fastest mate is longest, then the bigger capture,
   * then the lowest from / to / promotion — deterministic. n = 2 (the default) behaves exactly like bestDefense.
   * Returns the engine Move (with .san) or null when there is no legal reply. chessAfter is not changed.
   */
  function bestDefenseN(chessAfter, n) {
    if (!chessAfter || typeof chessAfter.moves !== 'function') return null;
    var k = mateDepth(n, 2) - 1;
    var a = chessAfter.clone();
    var S = new MateSearch(a);
    var replies = a.moves();
    var best = null, bestKey = null;
    for (var i = 0; i < replies.length; i++) {
      var r = replies[i];
      a.make(r);
      var sols = S.rootMates(k);
      a.unmake();
      var fastest = Infinity;
      for (var j = 0; j < sols.length; j++) if (sols[j].mateIn < fastest) fastest = sols[j].mateIn;
      var key = [sols.length, -fastest, -(r.captured ? pieceValue(r.captured & 7) : 0), r.from, r.to, r.promotion | 0];
      var better = !bestKey;
      for (var q = 0; !better && q < key.length; q++) {
        if (key[q] !== bestKey[q]) { better = key[q] < bestKey[q]; break; }
      }
      if (better) { best = r; bestKey = key; }
    }
    return best ? sanOf(a, best) : null;
  }

  /* ================================================================ endgame defence (v3) */

  var ENDGAME_WIN = 1000000;       // the defender mates (practically never happens in these endgames)

  function materialOf(c, color) {
    if (typeof c.material === 'function') return c.material(color);
    var s = 0;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = c.get(sq);
      if (p && (p & 24) === color) s += pieceValue(p & 7);
    }
    return s;
  }

  /* fixed-depth ChessAI config for the attacker's answer to every defender move: together with the defender's own
     move this is the 'hint' depth (a timed search would not be deterministic); one ply more with very few pieces */
  function endgameCfg(ai, c) {
    var hint = ai.LEVELS && ai.LEVELS.hint ? ai.LEVELS.hint : { depth: 4 };
    var d = Math.max(2, (hint.depth | 0 || 4) - 1);
    var pieces = typeof c.pieceCount === 'function' ? c.pieceCount() : 32;
    if (pieces <= 4) d++;
    return { depth: d, noise: 0 };
  }

  /* without ChessAI: avoid a mate in one, keep material, keep the king central */
  function fallbackEndgameScore(c, us) {
    var them = us ^ 24;
    if (c.mateInOne().length) return -ENDGAME_WIN / 2;
    var loss = 0;
    hangingLegal(c, us).forEach(function (h) { if (h.loss > loss) loss = h.loss; });
    var k = c.kings ? c.kings[us] : -1;
    var centre = k >= 0 ? Math.abs((k & 7) - 3.5) + Math.abs((k >> 4) - 3.5) : 0;
    return materialOf(c, us) - materialOf(c, them) - loss - centre * 10;
  }

  /*
   * The defender's move in 'endgame' practice (the side to move in chess, normally Black with a lone king):
   * every legal move is scored by a fixed-depth ChessAI search of the attacker's best answer (hint strength), so
   * it avoids mate as long as it can (a mate in one is never walked into when avoidable), grabs pieces left
   * hanging, and takes a stalemate or a dead draw when offered. Ties: more own material left, then the lowest
   * from / to / promotion — the same position always gets the same move. chess is not changed; ChessAI.lastSearch
   * is restored. Returns the engine Move (with .san) or null when there is no legal move.
   */
  function endgameReply(chess) {
    if (!chess || typeof chess.clone !== 'function' || typeof chess.moves !== 'function') return null;
    var a = chess.clone();
    var list = a.moves();
    if (!list.length) return null;
    var us = a.turn, them = us ^ 24;
    var ai = getAI();
    var saved = ai ? ai.lastSearch : null;
    var cfg = ai ? endgameCfg(ai, a) : null;
    var best = null, bestKey = null;
    try {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        a.make(m);
        var score;
        if (!hasLegalMove(a)) {
          score = a.inCheck(them) ? ENDGAME_WIN : 0;          // we mate / stalemate (a draw)
        } else if (typeof a.isInsufficientMaterial === 'function' && a.isInsufficientMaterial()) {
          score = 0;                                           // e.g. the last pawn taken: a dead draw
        } else if (ai) {
          var r = ai.chooseMove(a, cfg);
          score = r ? -r.score : 0;
        } else {
          score = fallbackEndgameScore(a, us);
        }
        var mat = materialOf(a, us) - materialOf(a, them);
        a.unmake();
        var key = [-score, -mat, m.from, m.to, m.promotion | 0];
        var better = !bestKey;
        for (var q = 0; !better && q < key.length; q++) {
          if (key[q] !== bestKey[q]) { better = key[q] < bestKey[q]; break; }
        }
        if (better) { best = m; bestKey = key; }
      }
    } finally {
      if (ai) ai.lastSearch = saved;
    }
    return best ? sanOf(a, best) : null;
  }

  /* ================================================================ rating */

  /* 3 stars if moves ≤ par, 2 if ≤ par + 2, else 1 (3 when par is unknown) */
  function rateStars(moves, par) {
    var n = Number(moves);
    var p = par === null || par === undefined || par === '' ? NaN : Number(par);
    if (!isFinite(n) || n < 0) return 1;
    if (!isFinite(p) || p < 0) return 3;
    if (n <= p) return 3;
    if (n <= p + 2) return 2;
    return 1;
  }

  /* ================================================================ export */

  var Lessons = {
    NAMES: NAMES,
    GROUPS: GROUPS,
    PUZZLES: PUZZLES,
    PUZZLES_MATE2: PUZZLES_MATE2,
    PUZZLES_WIN: PUZZLES_WIN,
    PUZZLE_SETS: PUZZLE_SETS,
    buildStarsPosition: buildStarsPosition,
    solveStars: solveStars,
    checkGoal: checkGoal,
    rateStars: rateStars,
    puzzleKind: puzzleKind,
    allPuzzles: allPuzzles,
    puzzleById: puzzleById,
    isMate2Move: isMate2Move,
    bestDefense: bestDefense,
    hangingLegal: hangingLegal,
    /* v3 core (SPEC §11.1) */
    CONTENT_VERSION: CONTENT_VERSION,
    addGroups: addGroups,
    addPuzzles: addPuzzles,
    addPuzzleSet: addPuzzleSet,
    puzzleSet: puzzleSet,
    isMateInMove: isMateInMove,
    mateInN: mateInN,
    bestDefenseN: bestDefenseN,
    endgameReply: endgameReply
  };

  global.Lessons = Lessons;
  if (typeof module !== 'undefined' && module.exports) module.exports = Lessons;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
