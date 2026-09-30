/*
 * «Шахматное Королевство» — v3 mate puzzles (SPEC §11.3), registered into Lessons at load time.
 *
 *   mate1  ids 31..50         appended to «Мат в 1 ход» (Lessons.PUZZLES)
 *   mate2  ids 'm2-11'..'m2-25' appended to «Мат в 2 хода» (Lessons.PUZZLES_MATE2)
 *   mate3  new set «Мат в 3 хода» 🏆, ids 'm3-1'..'m3-8' (≤ 10 pieces each, so the runtime mate search stays fast)
 *
 * All White to move, easy → harder inside each block. mate1: the hint mates (any mating move is accepted).
 * mate2 / mate3: no shorter mate exists and the hint is the only first move that forces mate (Lessons.isMateInMove).
 * Saved progress refers to puzzles by id: never change, reorder, re-id or remove anything here once shipped —
 * only append. Browser: needs the global Lessons (js/lessons.js loads first). Node: require('./lessons.js').
 * Checked by tests/content-v3-mates.test.js.
 */
(function (global) {
  'use strict';

  var L = global && global.Lessons;
  if (!L && typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    try { L = require('./lessons.js'); } catch (e) { L = null; }
  }

  /* ---------------------------------------------------------------- mate in 1 (ids 31..50) */

  var MATE1_V3 = [
    {
      id: 31, kind: 'mate1', v: 3, fen: '4k3/8/4K3/8/8/8/8/R7 w - - 0 1', difficulty: 1,
      title: 'Король напротив короля', text: 'Короли стоят друг напротив друга. Поставь мат ладьёй!',
      hint: { from: 'a1', to: 'a8' }
    },
    {
      id: 32, kind: 'mate1', v: 3, fen: 'rnbqkbnr/ppppp2p/5p2/6p1/3PP3/8/PPP2PPP/RNBQKBNR w KQkq g6 0 3', difficulty: 1,
      title: 'Мат на третьем ходу', text: 'Чёрные сделали два плохих хода пешками. Накажи их — поставь мат ферзём!',
      hint: { from: 'd1', to: 'h5' }
    },
    {
      id: 33, kind: 'mate1', v: 3, fen: '8/8/8/7k/8/8/R7/K5R1 w - - 0 1', difficulty: 1,
      title: 'Ладьи на соседних линиях', text: 'Король прижат к краю доски. Одна ладья его сторожит, а другая поставит мат!',
      hint: { from: 'a2', to: 'h2' }
    },
    {
      id: 34, kind: 'mate1', v: 3, fen: '8/Q7/8/5K1k/8/8/8/8 w - - 0 1', difficulty: 1,
      title: 'Ферзь у края доски', text: 'Твой король уже подошёл близко. Поставь мат ферзём!',
      hint: { from: 'a7', to: 'h7' }
    },
    {
      id: 35, kind: 'mate1', v: 3, fen: 'rnbq1bnr/ppppkppp/8/4p2Q/4P3/8/PPPP1PPP/RNB1KBNR w KQ - 2 3', difficulty: 1,
      title: 'Король вышел погулять', text: 'Чёрный король слишком рано вышел из домика. Поставь мат ферзём!',
      hint: { from: 'h5', to: 'e5' }
    },
    {
      id: 36, kind: 'mate1', v: 3, fen: '8/7p/5K1k/7p/6P1/8/8/8 w - - 0 1', difficulty: 2,
      title: 'Пешечный мат', text: 'Чёрного короля окружили. Поставь мат самой маленькой фигурой!',
      hint: { from: 'g4', to: 'g5' }
    },
    {
      id: 37, kind: 'mate1', v: 3, fen: '2rkr3/2p1p3/8/8/8/8/5PPP/R3K3 w Q - 0 1', difficulty: 2,
      title: 'Мат рокировкой', text: 'Поставь мат! А сможешь сделать это рокировкой — спрятать короля и объявить мат одним ходом?',
      hint: { from: 'e1', to: 'c1' }
    },
    {
      id: 38, kind: 'mate1', v: 3, fen: 'r5k1/5p1p/8/5N2/3Q4/8/5PPP/6K1 w - - 0 1', difficulty: 2,
      title: 'Конь прикрывает ферзя', text: 'Конь защищает клетку рядом с чёрным королём. Поставь туда ферзя!',
      hint: { from: 'd4', to: 'g7' }
    },
    {
      id: 39, kind: 'mate1', v: 3, fen: 'k7/8/1K6/4B3/8/8/4B3/8 w - - 0 1', difficulty: 2,
      title: 'Слоны загнали в угол', text: 'Король и один слон уже заперли чёрного короля в углу. Поставь мат вторым слоном!',
      hint: { from: 'e2', to: 'f3' }
    },
    {
      id: 40, kind: 'mate1', v: 3, fen: '7k/4N3/6K1/8/8/8/8/2B5 w - - 0 1', difficulty: 2,
      title: 'Слон и конь', text: 'Конь и король сторожат клетки у чёрного короля. Поставь мат слоном!',
      hint: { from: 'c1', to: 'b2' }
    },
    {
      id: 41, kind: 'mate1', v: 3, fen: '7k/4N3/6K1/4N3/8/8/8/8 w - - 0 1', difficulty: 2,
      title: 'Два коня', text: 'Два коня тоже умеют ставить мат! Найди нужный прыжок.',
      hint: { from: 'e5', to: 'f7' }
    },
    {
      id: 42, kind: 'mate1', v: 3, fen: '5rk1/pp6/6P1/7Q/8/8/8/6K1 w - - 0 1', difficulty: 2,
      title: 'Мат Дамиано', text: 'Белая пешка подобралась к самому королю и готова помочь ферзю. Поставь мат!',
      hint: { from: 'h5', to: 'h7' }
    },
    {
      id: 43, kind: 'mate1', v: 3, fen: '3r2k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1', difficulty: 2,
      title: 'Мат со взятием', text: 'Съешь чёрную ладью так, чтобы получился мат!',
      hint: { from: 'd2', to: 'd8' }
    },
    {
      id: 44, kind: 'mate1', v: 3, fen: '6k1/5p2/8/8/8/8/8/B1K4R w - - 0 1', difficulty: 3,
      title: 'Слон с длинной диагонали', text: 'Слон издалека смотрит в угол доски. Поставь мат ладьёй!',
      hint: { from: 'h1', to: 'h8' }
    },
    {
      id: 45, kind: 'mate1', v: 3, fen: '2r3k1/3P1ppp/8/8/8/8/5PPP/6K1 w - - 0 1', difficulty: 3,
      title: 'Превращение со взятием', text: 'Пешка может съесть ладью и сразу стать новой фигурой. Поставь мат!',
      hint: { from: 'd7', to: 'c8', promotion: 'q' }
    },
    {
      id: 46, kind: 'mate1', v: 3, fen: 'R3B2k/6pp/8/8/4b3/8/8/6K1 w - - 0 1', difficulty: 3,
      title: 'Мат из засады', text: 'Отведи слона — и ладья объявит шах. Но смотри, чтобы чёрный слон не съел твою ладью!',
      hint: { from: 'e8', to: 'c6' }
    },
    {
      id: 47, kind: 'mate1', v: 3, fen: '3qkb2/3p1p2/3P4/8/4N3/8/8/4R1K1 w - - 0 1', difficulty: 3,
      title: 'Мат двойным шахом', text: 'Прыгни конём так, чтобы шах объявили сразу две фигуры!',
      hint: { from: 'e4', to: 'f6' }
    },
    {
      id: 48, kind: 'mate1', v: 3, fen: '8/4N2k/8/5PpP/6N1/8/1B6/6K1 w - g6 0 1', difficulty: 3,
      title: 'Взятие на проходе', text: 'Чёрная пешка только что шагнула на две клетки. Возьми её на проходе — это мат!',
      hint: { from: 'f5', to: 'g6' }
    },
    {
      id: 49, kind: 'mate1', v: 3, fen: '6k1/5rpp/8/8/8/1B6/5PPP/2R3K1 w - - 0 1', difficulty: 3,
      title: 'Ладья связана', text: 'Чёрная ладья связана: за ней на диагонали слона стоит её король. Поставь мат!',
      hint: { from: 'c1', to: 'c8' }
    },
    {
      id: 50, kind: 'mate1', v: 3, fen: 'r1bqkb1r/pp1npppp/2p2n2/8/3PN3/8/PPP1QPPP/R1B1KBNR w KQkq - 3 6', difficulty: 3,
      title: 'Спёртый мат в дебюте', text: 'Короля окружили его же фигуры, а пешку связал твой ферзь. Поставь мат конём!',
      hint: { from: 'e4', to: 'd6' }
    }
  ];

  /* ---------------------------------------------------------------- mate in 2 (ids 'm2-11'..'m2-25') */

  var MATE2_V3 = [
    {
      id: 'm2-11', kind: 'mate2', v: 3, fen: '8/3k4/6R1/8/8/8/R1K5/8 w - - 0 1', difficulty: 1,
      title: 'Лесенка издалека', text: 'Ладьи стоят далеко, но умеют шагать лесенкой! Сначала шах, а потом мат.',
      hint: { from: 'a2', to: 'a7' }
    },
    {
      id: 'm2-12', kind: 'mate2', v: 3, fen: '8/7k/4R3/8/8/8/8/Q3K3 w - - 0 1', difficulty: 1,
      title: 'Ферзь и ладья лесенкой', text: 'Ферзь и ладья тоже умеют шагать лесенкой. Объяви шах, а следующим ходом поставь мат!',
      hint: { from: 'a1', to: 'a7' }
    },
    {
      id: 'm2-13', kind: 'mate2', v: 3, fen: '5r1k/RR6/8/8/8/8/5PPP/6K1 w - - 0 1', difficulty: 1,
      title: 'Ладьи на седьмой', text: 'Две ладьи ворвались к чёрному королю. Объяви шах, а потом поставь мат!',
      hint: { from: 'b7', to: 'h7' }
    },
    {
      id: 'm2-14', kind: 'mate2', v: 3, fen: '8/6P1/7k/8/8/8/1K6/1R6 w - - 0 1', difficulty: 1,
      title: 'Сначала ферзь, потом мат', text: 'Проведи пешку в ферзи. А следующим ходом поставь мат ладьёй!',
      hint: { from: 'g7', to: 'g8', promotion: 'q' }
    },
    {
      id: 'm2-15', kind: 'mate2', v: 3, fen: '5k2/8/8/8/8/6R1/7R/5K2 w - - 0 1', difficulty: 2,
      title: 'Ладьи запирают короля', text: 'Сначала запри короля на последней линии, а потом поставь мат!',
      hint: { from: 'h2', to: 'h7' }
    },
    {
      id: 'm2-16', kind: 'mate2', v: 3, fen: 'Q4rk1/pp3ppp/8/5N2/8/8/5PP1/6K1 w - - 0 1', difficulty: 2,
      title: 'Шах конём, мат ферзём', text: 'Объяви шах конём — король убежит в угол. А там его поймает ферзь!',
      hint: { from: 'f5', to: 'e7' }
    },
    {
      id: 'm2-17', kind: 'mate2', v: 3, fen: '5rk1/pp3p1p/7B/8/6N1/8/7K/6R1 w - - 0 1', difficulty: 2,
      title: 'Двойной шах', text: 'Прыгни конём — и шах объявят сразу конь и ладья! А потом поставь мат.',
      hint: { from: 'g4', to: 'f6' }
    },
    {
      id: 'm2-18', kind: 'mate2', v: 3, fen: '2kr4/pp1n1ppp/2n5/8/5B2/5Q2/4BPPP/6K1 w - - 0 1', difficulty: 2,
      title: 'Мат Бодена', text: 'Отдай ферзя, и два слона поставят мат крест-накрест!',
      hint: { from: 'f3', to: 'c6' }
    },
    {
      id: 'm2-19', kind: 'mate2', v: 3, fen: '5r1k/pp2Nppp/8/8/8/3Q1R2/5PPP/6K1 w - - 0 1', difficulty: 2,
      title: 'Жертва ферзя на h7', text: 'Конь уже сторожит клетки у короля. Отдай ферзя — и ладья поставит мат!',
      hint: { from: 'd3', to: 'h7' }
    },
    {
      id: 'm2-20', kind: 'mate2', v: 3, fen: 'rn1qkbnr/ppp2p1p/3p2p1/4N3/2B1P3/2N5/PPPP1PPP/R1BbK2R w KQkq - 0 6', difficulty: 2,
      title: 'Ловушка Легаля', text: 'Помнишь «Мат Легаля»? Чёрный слон съел твоего ферзя. Найди этот мат на ход раньше — в 2 хода!',
      hint: { from: 'c4', to: 'f7' }
    },
    {
      id: 'm2-21', kind: 'mate2', v: 3, fen: '4kb1r/p2n1ppp/4q3/4p1B1/4P3/1Q6/PPP2PPP/2KR4 w k - 0 16', difficulty: 3,
      title: 'Оперная партия', text: 'Так закончилась знаменитая партия Пола Морфи. Отдай ферзя — и ладья поставит мат!',
      hint: { from: 'b3', to: 'b8' }
    },
    {
      id: 'm2-22', kind: 'mate2', v: 3, fen: '6k1/5ppp/8/8/8/6Q1/5PPP/2r1R1K1 w - - 0 1', difficulty: 3,
      title: 'Кто быстрее?', text: 'Чёрная ладья грозит поставить мат твоему королю. Но ходишь ты! Мат в 2 хода.',
      hint: { from: 'g3', to: 'b8' }
    },
    {
      id: 'm2-23', kind: 'mate2', v: 3, fen: '6k1/5ppp/2q5/8/Q7/8/5PPP/4R1K1 w - - 0 1', difficulty: 3,
      title: 'Отвлечение', text: 'Съесть ферзя — хорошо, а поставить мат — ещё лучше! Отвлеки чёрного ферзя ладьёй.',
      hint: { from: 'e1', to: 'e8' }
    },
    {
      id: 'm2-24', kind: 'mate2', v: 3, fen: '8/k1P5/2K5/8/8/8/8/8 w - - 0 1', difficulty: 3,
      title: 'Ладья лучше ферзя', text: 'Осторожно, пат! Подумай, в какую фигуру превратить пешку. Мат в 2 хода!',
      hint: { from: 'c7', to: 'c8', promotion: 'r' }
    },
    {
      id: 'm2-25', kind: 'mate2', v: 3, fen: 'kbK5/pp6/1P6/8/8/8/8/R7 w - - 0 1', difficulty: 3,
      title: 'Задача Морфи', text: 'Эту задачу придумал знаменитый шахматист Пол Морфи. Иногда ладью не жалко отдать!',
      hint: { from: 'a1', to: 'a6' }
    }
  ];

  /* ---------------------------------------------------------------- mate in 3 (new set, ids 'm3-1'..'m3-8') */

  var MATE3 = [
    {
      id: 'm3-1', kind: 'mate3', v: 3, fen: '7K/8/4k3/6R1/8/R7/8/8 w - - 0 1', difficulty: 1,
      title: 'Лесенка из центра', text: 'Король далеко от края. Ладьи по очереди объявляют шахи и лесенкой гонят его к краю доски!',
      hint: { from: 'a3', to: 'a6' }
    },
    {
      id: 'm3-2', kind: 'mate3', v: 3, fen: '8/8/4k3/8/6RQ/2K5/8/8 w - - 0 1', difficulty: 1,
      title: 'Ферзь и ладья шагают', text: 'Ферзь и ладья по очереди объявляют шахи и гонят короля к краю. Мат в 3 хода!',
      hint: { from: 'g4', to: 'g6' }
    },
    {
      id: 'm3-3', kind: 'mate3', v: 3, fen: '5rk1/1RR3pp/8/8/8/8/8/6K1 w - - 0 1', difficulty: 2,
      title: 'Ладьи-обжоры', text: 'Ладьи съедают чёрные пешки и объявляют шахи. Мат в 3 хода!',
      hint: { from: 'c7', to: 'g7' }
    },
    {
      id: 'm3-4', kind: 'mate3', v: 3, fen: '5rk1/pp3pp1/6B1/8/8/8/8/5QKR w - - 0 1', difficulty: 2,
      title: 'Жертва ладьи', text: 'Отдай ладью, чтобы заманить короля в угол. А там его поймает ферзь!',
      hint: { from: 'h1', to: 'h8' }
    },
    {
      id: 'm3-5', kind: 'mate3', v: 3, fen: '4r1k1/5Npp/8/8/2Q5/8/6PP/6K1 w - - 0 1', difficulty: 2,
      title: 'Спёртый мат в 3 хода', text: 'Двойной шах, потом жертва ферзя — и конь поставит спёртый мат!',
      hint: { from: 'f7', to: 'h6' }
    },
    {
      id: 'm3-6', kind: 'mate3', v: 3, fen: '5rk1/5ppp/8/3N4/4Q3/3R4/8/6K1 w - - 0 1', difficulty: 3,
      title: 'Мат Анастасии в 3 хода', text: 'Прыгни конём с шахом, потом отдай ферзя — и ладья поставит мат!',
      hint: { from: 'd5', to: 'e7' }
    },
    {
      id: 'm3-7', kind: 'mate3', v: 3, fen: '5r1k/5p1p/6n1/8/8/Q1R5/1B6/6K1 w - - 0 1', difficulty: 3,
      title: 'Мат Морфи в 3 хода', text: 'Ферзь съест ладью с шахом, а потом ладья и слон поставят мат!',
      hint: { from: 'a3', to: 'f8' }
    },
    {
      id: 'm3-8', kind: 'mate3', v: 3, fen: '1nb1k3/1p3p2/2p5/8/8/3Q4/3B4/2KR4 w - - 0 1', difficulty: 3,
      title: 'Идея Рети', text: 'Так играл Рихард Рети в знаменитой партии против Тартаковера. Отдай ферзя — и поставь мат в 3 хода!',
      hint: { from: 'd3', to: 'd8' }
    }
  ];

  var SET_MATE3 = {
    id: 'mate3', title: 'Мат в 3 хода', emoji: '🏆', color: '#ff6fae', v: 3,
    text: 'Три хода — и король пойман! Чёрные будут защищаться.',
    puzzles: MATE3
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
   * elsewhere, a set 'mate3' from somewhere else) is found BEFORE anything is added: it throws and adds nothing.
   */
  function register() {
    if (!L || typeof L.addPuzzles !== 'function' || typeof L.addPuzzleSet !== 'function') return null;
    var mine = MATE1_V3.concat(MATE2_V3, MATE3);
    var present = mine.filter(function (p) { return inUse(p.id); });
    var haveSet = setExists(SET_MATE3.id);
    if (present.length === mine.length && haveSet) return null;     // this file was loaded before
    if (present.length || haveSet) {
      throw new Error('content-v3-mates: already registered elsewhere: ' +
        present.map(function (p) { return String(p.id); }).concat(haveSet ? ['set mate3'] : []).join(', '));
    }
    L.addPuzzles('mate1', MATE1_V3);
    L.addPuzzles('mate2', MATE2_V3);
    L.addPuzzleSet(SET_MATE3);
    return { mate1: MATE1_V3.length, mate2: MATE2_V3.length, mate3: MATE3.length };
  }

  var added = null;
  try {
    added = register();
  } catch (e) {
    if (typeof console !== 'undefined' && console.error) console.error('content-v3-mates:', e);
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mate1: MATE1_V3, mate2: MATE2_V3, mate3: MATE3, mate3Set: SET_MATE3, added: added };
  }
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
