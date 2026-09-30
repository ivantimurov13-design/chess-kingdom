/*
 * «Шахматное Королевство» — v3 tactics (SPEC §11.2 / §11.3), registered into Lessons at load time.
 *
 *   win      ids 'w-13'..'w-27'  appended to «Выиграй фигуру» (Lessons.PUZZLES_WIN): forks (knight, king, pawn,
 *            queen, bishop), a trapped knight, a pinned knight that cannot take, a skewer, discovered attack / check,
 *            double check, removing the defender, an overloaded pawn, a double threat, a deflection
 *   save     new set «Спасайся!» 🛡️, ids 's-1'..'s-10': Black threatens mate or a big win (threat = Black's move);
 *            solutions = EVERY move that holds (engine-verified), anything else loses ≥ 300 or allows mate
 *   endgame  new set «Мат одинокому королю» 👑, ids 'e-1'..'e-9': K+Q, K+2R («лесенка»), K+R v K (goal 'mate')
 *            and K+P v K (goal 'promote'), played against Lessons.endgameReply; par / maxMoves from engine games
 *
 * All White to move, easy → harder inside each block. Saved progress refers to puzzles by id: never change,
 * reorder, re-id or remove anything here once shipped — only append. Browser: needs the global Lessons
 * (js/lessons.js loads first). Node: require('./lessons.js'). Checked by tests/content-v3-tactics.test.js.
 */
(function (global) {
  'use strict';

  var L = global && global.Lessons;
  if (!L && typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    try { L = require('./lessons.js'); } catch (e) { L = null; }
  }

  /* ---------------------------------------------------------------- win material (w-13..w-27) */

  /* solutions: first moves (UCI); reply: Black's best defence (legal after every solution); then the child
     captures a piece worth ≥ finish.minValue (or mates). Without reply the first move solves the puzzle. */
  var WIN_V3 = [
    {
      id: 'w-13', kind: 'win', v: 3, fen: '2r3k1/pp3ppp/8/3q1N2/8/8/PP3PPP/1R4K1 w - - 0 1', difficulty: 2,
      title: 'Семейная вилка', text: 'Прыгни конём с шахом и напади сразу на короля, ферзя и ладью!',
      solutions: ['f5e7'], reply: 'g8f8', finish: { minValue: 900 },
      fail: 'Ищи прыжок конём с шахом. Оттуда конь должен достать и ферзя!'
    },
    {
      id: 'w-14', kind: 'win', v: 3, fen: '1nb5/8/2pK3k/7p/P7/2P5/8/8 w - - 0 1', difficulty: 2,
      title: 'Король нападает', text: 'Король тоже умеет нападать! Шагни им так, чтобы напасть сразу на коня и слона.',
      solutions: ['d6c7'], reply: 'c8e6', finish: { minValue: 300 },
      fail: 'Найди клетку рядом и с конём, и со слоном. Туда и шагни королём!'
    },
    {
      id: 'w-15', kind: 'win', v: 3, fen: '8/pp1r1kpp/8/3PP3/8/8/PP3PPP/6K1 w - - 0 1', difficulty: 2,
      title: 'Пешка с шахом', text: 'Шагни пешкой вперёд: шах королю и нападение на ладью!',
      solutions: ['e5e6'], reply: 'f7e8', finish: { minValue: 500 },
      fail: 'Пешка e5 может объявить шах. Посмотри, на кого ещё она тогда нападёт!'
    },
    {
      id: 'w-16', kind: 'win', v: 3, fen: 'rnb1k2r/ppp2ppp/8/8/7b/2P5/PP3PPP/R2Q1RK1 w - - 0 1', difficulty: 2,
      title: 'Далёкая вилка ферзём', text: 'Объяви шах ферзём издалека так, чтобы заодно напасть на слона!',
      solutions: ['d1a4'], reply: 'c7c6', finish: { minValue: 300 },
      fail: 'Ищи шах ферзём, после которого он нападает и на слона h4.'
    },
    {
      id: 'w-17', kind: 'win', v: 3, fen: '1r2k3/5p1p/p7/8/8/1PB1P1n1/P7/1K6 w - - 0 1', difficulty: 2,
      title: 'Вилка слоном', text: 'Поставь слона туда, где он нападёт сразу на ладью и на коня!',
      solutions: ['c3e5'], reply: 'b8c8', finish: { minValue: 300 },
      fail: 'Найди клетку, откуда слон видит и ладью b8, и коня g3.'
    },
    {
      id: 'w-18', kind: 'win', v: 3, fen: '8/5p2/pk2p3/1p6/1P3P2/P6K/8/7n w - - 0 1', difficulty: 2,
      title: 'Конь в углу', text: 'Чёрный конь забрался в угол. Подойди королём так, чтобы коню некуда было убежать!',
      solutions: ['h3g2'], reply: 'b6c6', finish: { minValue: 300 },
      fail: 'Конь может прыгнуть только на f2 или g3. Встань королём так, чтобы закрыть обе клетки и напасть на коня.'
    },
    {
      id: 'w-19', kind: 'win', v: 3, fen: 'r3k2r/pp1n1p1p/6p1/1B6/8/6Q1/PP3PPP/6K1 w - - 0 1', difficulty: 3,
      title: 'Связанный конь не бьёт', text: 'Чёрный конь связан: за ним стоит король. Значит, бить он не может! Объяви шах ферзём и напади на ладью.',
      solutions: ['g3e5'], reply: 'e8f8', finish: { minValue: 500 },
      fail: 'Конь d7 связан и не бьёт. Найди шах ферзём, который заодно нападает на ладью h8!'
    },
    {
      id: 'w-20', kind: 'win', v: 3, fen: '7r/5p1p/p5p1/1p2k3/8/Q7/P4PPP/6K1 w - - 0 1', difficulty: 3,
      title: 'Шах по диагонали', text: 'Объяви шах ферзём по длинной диагонали. Король отойдёт — и ладья за ним пропадёт!',
      solutions: ['a3c3', 'a3b2'], reply: 'e5d5', finish: { minValue: 500 },
      fail: 'Чёрный король и ладья h8 стоят на одной диагонали. Объяви шах по этой диагонали!'
    },
    {
      id: 'w-21', kind: 'win', v: 3, fen: 'r4rk1/pp1q1ppp/8/8/8/3B4/PP3PPP/3R2K1 w - - 0 1', difficulty: 3,
      title: 'Слон открывает ладью', text: 'Твоя ладья и чёрный ферзь стоят на одной линии, но мешает слон. Уведи его так, чтобы ферзю было некогда убегать!',
      solutions: ['d3h7'], reply: 'g8h7', finish: { minValue: 900 },
      fail: 'Сделай ход слоном с шахом. Тогда ладья d1 нападёт на ферзя, а ему некогда будет убегать.'
    },
    {
      id: 'w-22', kind: 'win', v: 3, fen: 'r3k3/ppp3pp/1q6/4N3/8/8/PPP2PPP/4R1K1 w - - 0 1', difficulty: 3,
      title: 'Открытый шах', text: 'Уведи коня с линии — и ладья объявит шах. А конь пусть нападёт на ферзя!',
      solutions: ['e5c4'], reply: 'e8d7', finish: { minValue: 900 },
      fail: 'Конь должен уйти с линии «e» так, чтобы напасть на ферзя b6.'
    },
    {
      id: 'w-23', kind: 'win', v: 3, fen: '4k2r/ppp2ppp/8/8/4N1q1/8/PP3PPP/R3R1K1 w - - 0 1', difficulty: 3,
      title: 'Шах сразу двумя', text: 'Прыгни конём так, чтобы шах объявили и конь, и ладья! От такого шаха можно только убежать.',
      solutions: ['e4f6'], reply: 'e8d8', finish: { minValue: 900 },
      fail: 'Ищи прыжок конём с шахом, который открывает ладью e1 и нападает на ферзя.'
    },
    {
      id: 'w-24', kind: 'win', v: 3, fen: '5rk1/pp3ppp/5n2/3b2B1/8/P7/1P3PPP/3R2K1 w - - 0 1', difficulty: 3,
      title: 'Убери защитника', text: 'Конь защищает слона. Съешь коня — и слон останется без защиты!',
      solutions: ['g5f6'],
      fail: 'Ладья хочет съесть слона d5, но его защищает конь f6. Сначала убери коня!'
    },
    {
      id: 'w-25', kind: 'win', v: 3, fen: 'r5k1/pp3ppp/4p3/3n1b2/8/7B/PP3PPP/3R2K1 w - - 0 1', difficulty: 3,
      title: 'Одна пешка на двоих', text: 'Пешка e6 защищает и коня, и слона. Съешь одного — второй останется без защиты!',
      solutions: ['h3f5'],
      fail: 'Одна пешка не защитит сразу двоих. Съешь слона f5 слоном — и посмотри, что станет с конём!'
    },
    {
      id: 'w-26', kind: 'win', v: 3, fen: '2r3k1/pp2pppp/b7/8/8/8/PB3PPP/3Q2K1 w - - 0 1', difficulty: 3,
      title: 'Мат или ладья', text: 'Сделай ход ферзём, который грозит матом и нападает на ладью. От двух угроз не спастись!',
      solutions: ['d1g4'], reply: 'c8c1', finish: { minValue: 500 },
      fail: 'Ищи клетку, откуда ферзь вместе со слоном грозит матом на g7 и заодно нападает на ладью c8.'
    },
    {
      id: 'w-27', kind: 'win', v: 3, fen: 'r5k1/1pP2pp1/7p/8/8/8/5PPP/3R2K1 w - - 0 1', difficulty: 3,
      title: 'Путь для пешки', text: 'Пешка c7 почти стала ферзём, но ладья a8 сторожит клетку c8. Отвлеки ладью!',
      solutions: ['d1d8'], reply: 'a8d8', finish: { minValue: 500 },
      fail: 'Объяви шах ладьёй на последней линии. Если чёрная ладья её съест — пешка пройдёт!'
    }
  ];

  /* ---------------------------------------------------------------- «Спасайся!» (s-1..s-10) */

  /* threat: Black's main threat (shown as a red arrow); solutions: every move that holds */
  var SAVE = [
    {
      id: 's-1', kind: 'save', v: 3, fen: '4r1k1/pp3ppp/8/8/8/8/PPR2PPP/6K1 w - - 0 1', difficulty: 1,
      title: 'Форточка для короля', text: 'Чёрная ладья грозит матом на e1. Сделай королю форточку или защити первую линию!',
      threat: { from: 'e8', to: 'e1' },
      solutions: ['h2h3', 'h2h4', 'g2g3', 'g2g4', 'f2f3', 'f2f4', 'g1f1', 'c2c1'],
      fail: 'Ладья пойдёт на e1 — и мат: королю некуда уйти. Подвинь пешку перед королём!'
    },
    {
      id: 's-2', kind: 'save', v: 3, fen: 'r4rk1/pp3ppp/2n5/8/3Q4/8/PPP2PPP/R4RK1 w - - 0 1', difficulty: 1,
      title: 'Беги, ферзь!', text: 'Чёрный конь напал на твоего ферзя! Уведи ферзя туда, где его никто не съест.',
      threat: { from: 'c6', to: 'd4' },
      solutions: ['d4a4', 'd4c3', 'd4c4', 'd4c5', 'd4d1', 'd4d2', 'd4d3', 'd4d5', 'd4d6', 'd4d7', 'd4e3', 'd4e4',
        'd4f4', 'd4g4', 'd4h4'],
      fail: 'Ферзь под ударом коня. Найди для него безопасную клетку!'
    },
    {
      id: 's-3', kind: 'save', v: 3, fen: '8/7R/1k6/8/8/4K3/2p2PP1/8 w - - 0 1', difficulty: 1,
      title: 'Стоп, пешка!', text: 'Чёрная пешка вот-вот станет ферзём! Не пусти её на c1.',
      threat: { from: 'c2', to: 'c1' },
      solutions: ['e3d2', 'h7h1', 'h7h6'],
      fail: 'Пешка шагнёт на c1 и станет ферзём. Встань королём рядом с c1 или защити эту клетку ладьёй!'
    },
    {
      id: 's-4', kind: 'save', v: 3, fen: '3r2k1/pp3ppp/8/4p3/3n4/2Q5/PP3PPP/5RK1 w - - 0 1', difficulty: 2,
      title: 'Берегись вилки', text: 'Чёрный конь хочет прыгнуть на e2: шах королю и удар по ферзю! Помешай этой вилке.',
      threat: { from: 'd4', to: 'e2' },
      solutions: ['c3a3', 'c3a5', 'c3b4', 'c3c4', 'c3c5', 'c3c7', 'c3d3', 'c3e1', 'c3e3', 'c3h3', 'f1d1', 'f1e1', 'g1h1'],
      fail: 'Конь прыгнет на e2 с шахом и нападёт на ферзя. Уведи ферзя в безопасное место!'
    },
    {
      id: 's-5', kind: 'save', v: 3, fen: 'r7/5p2/1p3kp1/7p/8/1P3P2/2K4R/8 w - - 0 1', difficulty: 2,
      title: 'Шах с подвохом', text: 'Чёрная ладья хочет объявить шах на a2. Король отойдёт — и она съест твою ладью! Помешай.',
      threat: { from: 'a8', to: 'a2' },
      solutions: ['c2b1', 'c2b2', 'c2c1', 'c2c3', 'c2d3', 'h2d2', 'h2e2', 'h2h1', 'h2h3', 'h2h4'],
      fail: 'Король и ладья стоят на одной линии. Уведи с неё короля или ладью!'
    },
    {
      id: 's-6', kind: 'save', v: 3, fen: 'r5k1/5ppp/8/8/6nq/8/PP2BPPP/R4RK1 w - - 0 1', difficulty: 2,
      title: 'Прогони коня', text: 'Ферзь и конь грозят матом на h2. Разберись с конём!',
      threat: { from: 'h4', to: 'h2' },
      solutions: ['e2g4', 'h2h3'],
      fail: 'Конь g4 помогает ферзю поставить мат на h2. Съешь коня или прогони его!'
    },
    {
      id: 's-7', kind: 'save', v: 3, fen: '6k1/1b3ppp/8/6q1/8/2N5/PP2BPPP/5RK1 w - - 0 1', difficulty: 2,
      title: 'Опасная диагональ', text: 'Ферзь и слон целятся в пешку g2 — там будет мат. Защитись!',
      threat: { from: 'g5', to: 'g2' },
      solutions: ['g2g3', 'g2g4', 'f2f3'],
      fail: 'Ферзь съест пешку g2, а слон его поддержит — мат! Закрой пешкой дорогу ферзю или слону.'
    },
    {
      id: 's-8', kind: 'save', v: 3, fen: '7k/6pp/8/8/8/Q6p/5qPP/7K w - - 0 1', difficulty: 3,
      title: 'Шах в ответ', text: 'Чёрные грозят матом на g2. Но сейчас твой ход — объяви шах первым!',
      threat: { from: 'f2', to: 'g2' },
      solutions: ['a3a8'],
      fail: 'Защищаться тут нечем. Найди шах, после которого мат поставишь ты!'
    },
    {
      id: 's-9', kind: 'save', v: 3, fen: '4r1k1/pp3ppp/2n5/8/3Q4/1N6/PP3PPP/6K1 w - - 0 1', difficulty: 3,
      title: 'Две беды сразу', text: 'Конь напал на ферзя, а ладья грозит матом на e1. Спаси ферзя так, чтобы он защитил и короля!',
      threat: { from: 'e8', to: 'e1' },
      solutions: ['d4c3', 'd4d1', 'd4d2'],
      fail: 'Уведи ферзя туда, откуда он будет сторожить клетку e1.'
    },
    {
      id: 's-10', kind: 'save', v: 3, fen: '3r2k1/pbb2ppp/8/8/8/1P2B3/P4PPP/6K1 w - - 0 1', difficulty: 3,
      title: 'Правильная форточка', text: 'Ладья грозит матом на d1. Нужна форточка, но осторожно: слоны сторожат g2 и h2!',
      threat: { from: 'd8', to: 'd1' },
      solutions: ['f2f3', 'f2f4'],
      fail: 'Слоны держат g2 и h2 — туда королю нельзя. Найди форточку, которую слоны не видят!'
    }
  ];

  /* ---------------------------------------------------------------- «Мат одинокому королю» (e-1..e-9) */

  /* par: moves of a strong engine against Lessons.endgameReply + a small slack; maxMoves: generous limit (K+R v K
     more: always following the hint mates e-9 only in 31 moves, so a child who plays some moves alone needs room) */
  var ENDGAME = [
    {
      id: 'e-1', kind: 'endgame', v: 3, fen: 'k7/8/8/8/3K4/8/8/6Q1 w - - 0 1', difficulty: 1,
      title: 'Король в углу', text: 'Чёрный король уже в углу. Подведи своего короля и поставь мат ферзём. Только не сделай пат!',
      goal: 'mate', par: 5, maxMoves: 20
    },
    {
      id: 'e-2', kind: 'endgame', v: 3, fen: '8/8/3k4/8/8/8/8/RR4K1 w - - 0 1', difficulty: 1,
      title: 'Лесенка к краю', text: 'Две ладьи шагают лесенкой: одна держит линию, другая объявляет шах. Так чёрный король окажется на краю — и мат!',
      goal: 'mate', par: 8, maxMoves: 22
    },
    {
      id: 'e-3', kind: 'endgame', v: 3, fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', difficulty: 1,
      title: 'Король впереди пешки', text: 'Твой король стоит впереди пешки — это очень сильно! Проведи пешку в ферзи и не отдай её.',
      goal: 'promote', par: 6, maxMoves: 20
    },
    {
      id: 'e-4', kind: 'endgame', v: 3, fen: '8/8/2k5/8/8/8/8/5QK1 w - - 0 1', difficulty: 2,
      title: 'Ферзь гонит короля', text: 'Прижимай короля ферзём к краю доски, а потом позови на помощь своего короля!',
      goal: 'mate', par: 10, maxMoves: 26
    },
    {
      id: 'e-5', kind: 'endgame', v: 3, fen: '8/8/8/4k3/8/8/8/R5RK w - - 0 1', difficulty: 2,
      title: 'Осторожная лесенка', text: 'Снова лесенка! Держи ладьи подальше от чёрного короля, чтобы он их не съел.',
      goal: 'mate', par: 9, maxMoves: 24
    },
    {
      id: 'e-6', kind: 'endgame', v: 3, fen: '2k5/8/8/8/5K2/8/4P3/8 w - - 0 1', difficulty: 2,
      title: 'Сначала король', text: 'Чёрный король спешит к пешке. Сначала выведи вперёд своего короля — пусть он расчищает пешке дорогу!',
      goal: 'promote', par: 11, maxMoves: 28
    },
    {
      id: 'e-7', kind: 'endgame', v: 3, fen: '8/8/8/4k3/8/8/8/K6Q w - - 0 1', difficulty: 3,
      title: 'Долгая погоня', text: 'Чёрный король в центре, а твой далеко. Ферзь прижимает, король помогает. Только не сделай пат!',
      goal: 'mate', par: 15, maxMoves: 36
    },
    {
      id: 'e-8', kind: 'endgame', v: 3, fen: '3k4/8/8/8/8/8/8/3K3R w - - 0 1', difficulty: 3,
      title: 'Мат ладьёй на краю', text: 'Чёрный король у края. Отрежь его ладьёй, поставь своего короля напротив — и объяви шах по краю!',
      goal: 'mate', par: 11, maxMoves: 40
    },
    {
      id: 'e-9', kind: 'endgame', v: 3, fen: '8/8/8/3k4/8/8/8/R6K w - - 0 1', difficulty: 3,
      title: 'Одна ладья', text: 'Мат одной ладьёй — самый трудный! Ладья отрезает короля, твой король подходит ближе. Прижимай его к краю!',
      goal: 'mate', par: 15, maxMoves: 50
    }
  ];

  var SET_SAVE = {
    id: 'save', v: 3, title: 'Спасайся!', emoji: '🛡️', color: '#3fa9f5',
    text: 'Соперник что-то задумал! Найди ход, который отобьёт угрозу.',
    puzzles: SAVE
  };

  var SET_ENDGAME = {
    id: 'endgame', v: 3, title: 'Мат одинокому королю', emoji: '👑', color: '#ffb400',
    text: 'Играй до победы: поставь мат одинокому королю или проведи пешку в ферзи!',
    puzzles: ENDGAME
  };

  /* ---------------------------------------------------------------- registration */

  function inUse(id) {
    if (typeof L.puzzleById === 'function') return !!L.puzzleById(id);
    var all = typeof L.allPuzzles === 'function' ? L.allPuzzles() : [];
    for (var i = 0; i < all.length; i++) if (all[i] && String(all[i].id) === String(id)) return true;
    return false;
  }

  function setExists(id) {
    if (typeof L.puzzleSet === 'function') return !!L.puzzleSet(id);
    return (L.PUZZLE_SETS || []).some(function (s) { return s && s.id === id; });
  }

  /*
   * Register once. A second load of this file (everything already there) changes nothing. Any clash (an id used
   * elsewhere, a set 'save' / 'endgame' from somewhere else) is found BEFORE anything is added: it throws and adds
   * nothing.
   */
  function register() {
    if (!L || typeof L.addPuzzles !== 'function' || typeof L.addPuzzleSet !== 'function') return null;
    var mine = WIN_V3.concat(SAVE, ENDGAME);
    var present = mine.filter(function (p) { return inUse(p.id); });
    var sets = [SET_SAVE.id, SET_ENDGAME.id].filter(setExists);
    if (present.length === mine.length && sets.length === 2) return null;     // this file was loaded before
    if (present.length || sets.length) {
      throw new Error('content-v3-tactics: already registered elsewhere: ' +
        present.map(function (p) { return String(p.id); }).concat(sets.map(function (s) { return 'set ' + s; })).join(', '));
    }
    L.addPuzzles('win', WIN_V3);
    L.addPuzzleSet(SET_SAVE);
    L.addPuzzleSet(SET_ENDGAME);
    return { win: WIN_V3.length, save: SAVE.length, endgame: ENDGAME.length };
  }

  var added = null;
  try {
    added = register();
  } catch (e) {
    if (typeof console !== 'undefined' && console.error) console.error('content-v3-tactics:', e);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { win: WIN_V3, save: SAVE, endgame: ENDGAME, saveSet: SET_SAVE, endgameSet: SET_ENDGAME, added: added };
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
