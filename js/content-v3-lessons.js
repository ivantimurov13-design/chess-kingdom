/*
 * «Шахматное Королевство» — v3 lesson groups (SPEC §11.3), appended after the v2 'maze' group at load time.
 *
 *   opening   «Как начинать игру»      4 tasks, goal 'solution' (every good answer listed; failFor = the level's own
 *                                      words for a particular wrong move, e.g. a knight to the rim)
 *   pin       «Связка»                 4 tasks, goal 'solution' (engine-verified: wins ≥ 2 pawns, the rest ≥ 1.5 worse;
 *                                      not the pins of the «Выиграй фигуру» puzzles w-9 / w-10 the child has solved)
 *   discover  «Открытое нападение»     3 tasks, goal 'solution' (engine-verified; bishop, knight, then a pawn uncovers)
 *   trade     «Выгодный размен»        4 tasks, goal 'solution' (the best capture, engine-verified)
 *   stalemate «Не зевни пат!»          3 tasks, goal 'mate' (a mate in 1 exists, many natural moves stalemate)
 *   maze2     «Лабиринты-2»            5 stars levels (par 10–11; the last one: a pawn that must become a queen)
 *   knight2   «Прогулки коня»          3 stars levels (par 8–10)
 *
 * Saved progress refers to 'groupId:levelIndex': never reorder, re-id or remove anything here once shipped —
 * only append (new levels at the end of a group, new groups after the last one).
 * Browser: needs the global Lessons (js/lessons.js loads first). Node: require('./lessons.js').
 * Checked by tests/content-v3-lessons.test.js.
 */
(function (global) {
  'use strict';

  var L = global && global.Lessons;
  if (!L && typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    try { L = require('./lessons.js'); } catch (e) { L = null; }
  }

  var RULE = 'Так ходить нельзя! Попробуй другой ход.';

  var GROUPS_V3 = [
    {
      id: 'opening', title: 'Как начинать игру', piece: 'p', emoji: '🚀', color: '#26de81', v: 3,
      intro: 'Как начать партию? Займи центр пешкой, выведи коней и слонов, а потом спрячь короля рокировкой!',
      rule: RULE,
      levels: [
        {
          type: 'task', v: 3, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', goal: 'solution',
          solutions: ['e2e4', 'd2d4'],
          text: 'Первый ход! Шагни пешкой на две клетки вперёд — прямо в центр доски.',
          fail: 'Нужна пешка в самом центре! Шагни на две клетки пешкой, которая стоит перед королём или перед ферзём.',
          win: 'Отлично! Пешка заняла центр доски.',
          hint: { from: 'e2', to: 'e4' }
        },
        {
          type: 'task', v: 3, fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2', goal: 'solution',
          solutions: ['g1f3', 'b1c3'], lastMove: { from: 'e7', to: 'e5' },
          text: 'Соперник тоже занял центр. Теперь выведи коня — поближе к центру!',
          fail: 'Сейчас выведи коня! Прыгни им вперёд, поближе к центру доски.',
          failFor: {
            g1h3: 'С края доски конь достаёт мало клеток. Прыгни им поближе к центру!',
            b1a3: 'С края доски конь достаёт мало клеток. Прыгни им поближе к центру!',
            g1e2: 'Отсюда конь мешает выйти слону и ферзю. Поставь его на клетку получше — ближе к центру!'
          },
          win: 'Конь вышел в бой и смотрит в центр!',
          hint: { from: 'g1', to: 'f3' }
        },
        {
          type: 'task', v: 3, fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', goal: 'solution',
          solutions: ['f1c4', 'f1b5'], lastMove: { from: 'b8', to: 'c6' },
          text: 'Твой конь уже в игре. Теперь выведи слона! Найди клетку, откуда он смотрит на сторону соперника.',
          fail: 'Поищи для слона клетку получше — откуда он смотрит прямо на сторону соперника.',
          win: 'Отлично! Слон вышел и смотрит на лагерь соперника.',
          hint: { from: 'f1', to: 'c4' }
        },
        {
          type: 'task', v: 3, fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', goal: 'solution',
          solutions: ['e1g1'], lastMove: { from: 'f8', to: 'c5' },
          text: 'Конь и слон уже вышли. Пора спрятать короля — сделай рокировку!',
          fail: 'Сейчас главное — спрятать короля. Передвинь короля на две клетки к ладье!',
          win: 'Рокировка! Король в домике, а ладья готова к бою.',
          hint: { from: 'e1', to: 'g1' }
        }
      ]
    },
    {
      id: 'pin', title: 'Связка', piece: 'b', emoji: '📌', color: '#8854d0', v: 3,
      intro: 'Связка — это когда фигура прикрывает своего короля. Уйти ей нельзя: тогда королю был бы шах!',
      rule: RULE,
      levels: [
        {
          type: 'task', v: 3, fen: '7k/pp5p/5rpP/8/8/4B3/PP3PP1/6K1 w - - 0 1', goal: 'solution',
          solutions: ['e3d4'],
          text: 'Поставь слона так, чтобы за чёрной ладьёй оказался король. Ладья не умеет ходить наискосок!',
          fail: 'Найди диагональ, на которой стоят и ладья, и король. Поставь на неё слона!',
          win: 'Связка! Ладья не может уйти, а съесть слона она не умеет. Ладья твоя!',
          hint: { from: 'e3', to: 'd4' }
        },
        {
          type: 'task', v: 3, fen: '8/2q4k/P5p1/5p2/8/8/5PPP/1R4K1 w - - 0 1', goal: 'solution',
          solutions: ['b1b7'],
          text: 'Чёрный ферзь и король стоят в одном ряду. Встань в этот ряд ладьёй — ферзь не сможет уйти!',
          fail: 'Найди ряд, где стоят и ферзь, и король. Встань туда ладьёй так, чтобы её защищала пешка!',
          win: 'Связка! Ферзь не может уйти. А если он съест ладью, пешка съест ферзя.',
          hint: { from: 'b1', to: 'b7' }
        },
        {
          type: 'task', v: 3, fen: '4k3/pp3ppp/3p4/4n3/8/3P4/PPP2PPP/4R1K1 w - - 0 1', goal: 'solution',
          solutions: ['f2f4', 'd3d4'],
          text: 'Чёрный конь связан: за ним стоит король. Нападай на коня пешкой — ему некуда бежать!',
          fail: 'Конь связан и не может уйти. Нападай на него пешкой!',
          win: 'Отлично! Связанный конь не может убежать — ты его выиграешь.',
          hint: { from: 'f2', to: 'f4' }
        },
        {
          type: 'task', v: 3, fen: '3r2k1/pp3pp1/7n/8/8/8/PP5P/2B3RK w - - 0 1', goal: 'solution',
          solutions: ['c1h6'],
          text: 'Кажется, чёрная пешка защищает коня. Но она связана ладьёй — за ней стоит король! Выиграй фигуру.',
          fail: 'Посмотри на пешку перед чёрным королём: она связана и не может бить. Кого она будто бы защищает?',
          win: 'Верно! Связанная пешка не может съесть слона — иначе её королю будет шах.',
          hint: { from: 'c1', to: 'h6' }
        }
      ]
    },
    {
      id: 'discover', title: 'Открытое нападение', piece: 'r', emoji: '🔦', color: '#0fb9b1', v: 3,
      intro: 'Открытое нападение: одна фигура отходит в сторону и открывает дорогу другой. Получаются сразу две угрозы!',
      rule: RULE,
      levels: [
        {
          type: 'task', v: 3, fen: 'q5k1/1p4pp/8/8/B7/8/5PPP/R5K1 w - - 0 1', goal: 'solution',
          solutions: ['a4b3'],
          text: 'Твой слон загораживает ладью. Отведи слона с шахом — и ладья нападёт на ферзя!',
          fail: 'Слон должен уйти с шахом! Тогда соперник спасает короля, а ферзя съест ладья.',
          win: 'Шах слоном, а ладья нападает на ферзя. Ферзь пропал!',
          hint: { from: 'a4', to: 'b3' }
        },
        {
          type: 'task', v: 3, fen: '3q4/5pkp/6p1/8/3N4/8/5PPP/3R2K1 w - - 0 1', goal: 'solution',
          solutions: ['d4e6', 'd4f5'],
          text: 'Конь загораживает ладью. Прыгни конём с шахом — и ладья нападёт на ферзя!',
          fail: 'Конь должен прыгнуть с шахом! Иначе ферзь просто съест ладью или убежит.',
          win: 'Шах конём, а ладья нападает на ферзя. Две угрозы сразу!',
          hint: { from: 'd4', to: 'f5' }
        },
        {
          type: 'task', v: 3, fen: '7k/pp3p1p/4q1p1/8/3P4/8/PB3PPP/6K1 w - - 0 1', goal: 'solution',
          solutions: ['d4d5'],
          text: 'Пешка загораживает слону дорогу к королю. Шагни ею вперёд: шах объявит слон, а пешка нападёт на ферзя!',
          fail: 'Сдвинь пешку, которая стоит на пути слона к чёрному королю. Пусть шах объявит слон!',
          win: 'Открытый шах! Слон напал на короля, а пешка — на ферзя. Ферзь пропал!',
          hint: { from: 'd4', to: 'd5' }
        }
      ]
    },
    {
      id: 'trade', title: 'Выгодный размен', piece: 'n', emoji: '⚖️', color: '#f7b731', v: 3,
      intro: 'Размен — это когда ты съедаешь фигуру, а соперник съедает твою. Выгодно отдать дешёвую фигуру за дорогую!',
      rule: RULE,
      levels: [
        {
          type: 'task', v: 3, fen: '6k1/2q2ppp/4p3/3n4/4P3/8/5PPP/3Q2K1 w - - 0 1', goal: 'solution',
          solutions: ['e4d5'],
          text: 'Коня можно съесть пешкой или ферзём. Но конь защищён! Чем выгоднее его съесть?',
          fail: 'Конь защищён пешкой. Если съесть его ферзём, ты отдашь ферзя за коня! Бери пешкой — она дешевле.',
          win: 'Выгодный размен: пешка стоит 1 монетку, а конь — 3!',
          hint: { from: 'e4', to: 'd5' }
        },
        {
          type: 'task', v: 3, fen: '2r3k1/5pp1/4p2p/3q4/8/5Q1P/5PP1/3R2K1 w - - 0 1', goal: 'solution',
          solutions: ['d1d5'],
          text: 'Чёрный ферзь защищён пешкой. Съешь его так, чтобы размен был выгодным!',
          fail: 'Ферзь за ферзя — это просто равный размен. А если ферзя съест ладья, ты отдашь 5 монеток за 9!',
          win: 'Ладья за ферзя — выгодный размен: 5 монеток за 9!',
          hint: { from: 'd1', to: 'd5' }
        },
        {
          type: 'task', v: 3, fen: '6k1/5ppp/3p4/4r3/3P4/5NB1/5PPP/6K1 w - - 0 1', goal: 'solution',
          solutions: ['d4e5'],
          text: 'Ладью можно съесть тремя разными фигурами. Какой выгоднее всего?',
          fail: 'Ладья защищена пешкой. Бери её самой дешёвой фигурой — пешкой!',
          win: 'Правильно! Пешка стоит 1 монетку, а ладья — 5. Самый выгодный размен!',
          hint: { from: 'd4', to: 'e5' }
        },
        {
          type: 'task', v: 3, fen: '6k1/5pp1/4p2p/3r4/1b6/7P/Q1N2PP1/6K1 w - - 0 1', goal: 'solution',
          solutions: ['c2b4'],
          text: 'Ферзь может съесть ладью, а конь — слона. Проверь, кто из них защищён!',
          fail: 'Ладья защищена пешкой — за неё отдашь ферзя! А слона никто не защищает.',
          win: 'Верно! Слон стоял без защиты — ты выиграл его даром.',
          hint: { from: 'c2', to: 'b4' }
        }
      ]
    },
    {
      id: 'stalemate', title: 'Не зевни пат!', piece: 'k', emoji: '🥱', color: '#eb3b5a', v: 3,
      intro: 'Пат — это когда шаха нет, а ходить нечем: ни королём, ни другими фигурами. Это ничья — ставь мат, а не пат!',
      rule: RULE,
      levels: [
        {
          type: 'task', v: 3, fen: '7k/8/6K1/5Q2/8/8/8/8 w - - 0 1', goal: 'mate',
          text: 'Поставь мат в 1 ход! Но осторожно: не запри короля без шаха.',
          fail: 'Это не мат. Нужен шах, от которого королю не спрятаться! А без шаха можно устроить пат — это ничья.',
          hint: { from: 'f5', to: 'f8' }
        },
        {
          type: 'task', v: 3, fen: '7k/5K2/6B1/8/8/8/1R6/8 w - - 0 1', goal: 'mate',
          text: 'Чёрному королю уже некуда ходить! Почти любой ход без шаха устроит пат. Найди мат!',
          fail: 'Это не мат. Королю было некуда ходить, поэтому нужен шах, от которого не спрятаться!',
          hint: { from: 'b2', to: 'b8' }
        },
        {
          type: 'task', v: 3, fen: '7k/6p1/4Q1P1/8/8/8/6K1/8 w - - 0 1', goal: 'mate',
          text: 'У чёрных есть пешка, но она застряла и не может ходить. Поставь мат и не устрой пат!',
          fail: 'Это не мат. Помни: застрявшая пешка не спасёт от пата. Нужен шах, от которого не спрятаться!',
          hint: { from: 'e6', to: 'e8' }
        }
      ]
    },
    {
      id: 'maze2', title: 'Лабиринты-2', piece: 'q', emoji: '🧭', color: '#3867d6', v: 3,
      intro: 'Новые лабиринты — длиннее и хитрее! Найди дорогу, собери звёздочки и съешь чёрные фигуры.',
      rule: 'Так ходить нельзя! Вспомни, как ходит эта фигура.',
      levels: [
        {
          type: 'stars', v: 3, piece: 'R', start: 'a1', stars: ['h8', 'a3', 'e4'],
          walls: ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7',
            'b4', 'b5', 'b6', 'g3', 'g4', 'g5', 'g6', 'd3', 'e3', 'd4', 'd5', 'e5'],
          enemies: [{ sq: 'c6', piece: 'n' }, { sq: 'f3', piece: 'p' }],
          text: 'Улитка! Веди ладью по спирали до самой серединки.'
        },
        {
          type: 'stars', v: 3, piece: 'B', start: 'c1', stars: ['a5', 'd8', 'h2'],
          walls: ['a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'h3', 'a6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6'],
          enemies: [{ sq: 'e5', piece: 'n' }, { sq: 'a7', piece: 'r' }],
          text: 'Пешки построили этажи. Ищи дырочки в полу, чтобы подняться выше!'
        },
        {
          type: 'stars', v: 3, piece: 'Q', start: 'a1', stars: ['c2', 'f7', 'b6', 'g3'],
          walls: ['a4', 'c4', 'd4', 'e4', 'f4', 'h4', 'd2', 'd3', 'd5', 'd6', 'd7'],
          enemies: [{ sq: 'e2', piece: 'n' }],
          text: 'Четыре комнаты — в каждой по звёздочке. Найди двери и обойди все комнаты!'
        },
        {
          type: 'stars', v: 3, piece: 'K', start: 'a7', stars: ['d6', 'f2', 'b3'],
          walls: ['a6', 'b6', 'b5', 'c5', 'c4', 'd4', 'd3', 'e3', 'e2'],
          enemies: [{ sq: 'e5', piece: 'n' }, { sq: 'd1', piece: 'r' }],
          text: 'Король спускается по лесенке! Обойди её и собери всё, что вокруг.'
        },
        {
          type: 'stars', v: 3, piece: 'P', start: 'c2', stars: ['a1', 'h2', 'h8'],
          walls: ['b2', 'b3', 'c3', 'd4', 'e7', 'g7', 'g6'],
          enemies: [{ sq: 'd3', piece: 'p' }, { sq: 'e4', piece: 'n' }, { sq: 'f7', piece: 'b' }],
          text: 'Пешка идёт в ферзи! Прокладывай путь, съедая чёрные фигуры, а потом собери звёздочки ферзём.'
        }
      ]
    },
    {
      id: 'knight2', title: 'Прогулки коня', piece: 'n', emoji: '🐎', color: '#fd9644', v: 3,
      intro: 'Конь отправляется на прогулку! Он прыгает буквой «Г» и перелетает через любые стенки.',
      rule: 'Конь так не ходит! Он прыгает буквой «Г».',
      levels: [
        {
          type: 'stars', v: 3, piece: 'N', start: 'g1', stars: ['c3', 'b5', 'c7', 'e7', 'f5', 'e3'],
          text: 'Звёздочки водят хоровод. Обскачи их все!'
        },
        {
          type: 'stars', v: 3, piece: 'N', start: 'd4', stars: ['c2', 'b6', 'f7', 'g4'],
          walls: ['c3', 'd3', 'e3', 'f3', 'c6', 'd6', 'e6', 'f6', 'c4', 'c5', 'f4', 'f5'],
          enemies: [{ sq: 'e5', piece: 'q' }],
          text: 'Конь в загоне! Перепрыгни через забор, собери звёздочки и съешь ферзя.'
        },
        {
          type: 'stars', v: 3, piece: 'N', start: 'a1', stars: ['b6', 'e8', 'f5', 'b2'],
          walls: ['c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'd7', 'e7', 'f7'],
          enemies: [{ sq: 'a4', piece: 'r' }, { sq: 'g7', piece: 'b' }],
          text: 'Пешки выстроились буквой «Г» — прямо как ход коня! Собери звёздочки и съешь чёрные фигуры.'
        }
      ]
    }
  ];

  /* register once: a second load of this file (all ids already there) changes nothing */
  function register() {
    if (!L || typeof L.addGroups !== 'function' || !Array.isArray(L.GROUPS)) return [];
    var have = {};
    L.GROUPS.forEach(function (g) { if (g && g.id) have[g.id] = true; });
    var missing = GROUPS_V3.filter(function (g) { return !have[g.id]; });
    if (!missing.length) return [];
    return L.addGroups(GROUPS_V3);   // partly registered → addGroups throws on the duplicate id (never silently mixed)
  }

  var added = [];
  try {
    added = register();
  } catch (e) {
    if (typeof console !== 'undefined' && console.error) console.error('content-v3-lessons:', e);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { groups: GROUPS_V3, added: added, ids: GROUPS_V3.map(function (g) { return g.id; }) };
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
