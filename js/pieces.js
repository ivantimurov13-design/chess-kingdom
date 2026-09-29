/*
 * «Шахматное Королевство» — piece art (global `PieceArt`).
 *
 * Cute cartoon Staunton pieces with faces, the mascot «Огонёк» and the lesson star.
 * Everything is inline SVG generated as strings; shared gradients live in one hidden
 * <svg><defs> (ids prefixed "pa-") and face-state CSS lives in <style id="pa-style">.
 *
 * API (see SPEC §5):
 *   PieceArt.install()            idempotent, injects defs + style (auto-called by the generators)
 *   PieceArt.svg(color, type)     'w'|'b', 'p'|'n'|'b'|'r'|'q'|'k' -> SVG string with a face
 *   PieceArt.icon(color, type)    same silhouette without a face (small icons)
 *   PieceArt.mascot()             the mascot «Огонёк» (orange knight with a scarf)
 *   PieceArt.star()               golden lesson star with a tiny face
 */
(function (global) {
  'use strict';

  var SW = 3.2;              // main outline width (viewBox units)
  var TYPES = 'pnbrqk';

  // ---------------------------------------------------------------------------------------------
  // Palettes. Every gradient paint has a solid fallback so a piece never disappears, even if the
  // shared defs are missing (e.g. rendered before install()).
  // ---------------------------------------------------------------------------------------------
  var PAL = {
    w: {
      body: 'url(#pa-w-body) #f7ead0',
      head: 'url(#pa-w-head) #f7ead0',
      acc: 'url(#pa-w-acc) #fbc54a',
      ball: 'url(#pa-w-ball) #fbc54a',
      line: '#3b2a1a',
      face: '#3b2a1a',
      pupil: '#2a1a0e',
      mouthIn: '#8a3b2c',
      cheek: '#ff7f9e',
      cheekOp: 0.5,
      shineOp: 0.62,
      earIn: '#ffb3c4',
      mustache: '#4a2f1c',
      gem: '#ff5f9e',
      gem2: '#7ad7ff',
      slit: '#f5a623'
    },
    b: {
      body: 'url(#pa-b-body) #4a3d7e',
      head: 'url(#pa-b-head) #4a3d7e',
      acc: 'url(#pa-b-acc) #f07cbc',
      ball: 'url(#pa-b-ball) #f07cbc',
      line: '#140c26',
      face: '#fbeaff',
      pupil: '#1a1030',
      mouthIn: '#3a1233',
      cheek: '#ff7cc8',
      cheekOp: 0.55,
      shineOp: 0.34,
      earIn: '#ff9fd6',
      mustache: '#fbeaff',
      gem: '#ffe27a',
      gem2: '#8ff0ff',
      slit: '#ffa6db'
    }
  };

  // ---------------------------------------------------------------------------------------------
  // Small SVG helpers
  // ---------------------------------------------------------------------------------------------
  function n(v) {
    return String(Math.round(v * 100) / 100);
  }

  function attrs(o) {
    var s = '';
    for (var k in o) {
      if (Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null && o[k] !== '') {
        s += ' ' + k + '="' + o[k] + '"';
      }
    }
    return s;
  }

  function tag(name, o, inner) {
    return '<' + name + attrs(o) + (inner === undefined ? '/>' : '>' + inner + '</' + name + '>');
  }

  function path(d, fill, stroke, sw, extra) {
    var o = { d: d, fill: fill || 'none' };
    if (stroke) { o.stroke = stroke; o['stroke-width'] = n(sw === undefined ? SW : sw); }
    if (extra) for (var k in extra) o[k] = extra[k];
    return tag('path', o);
  }

  function circle(cx, cy, r, fill, stroke, sw, extra) {
    var o = { cx: n(cx), cy: n(cy), r: n(r), fill: fill || 'none' };
    if (stroke) { o.stroke = stroke; o['stroke-width'] = n(sw === undefined ? SW : sw); }
    if (extra) for (var k in extra) o[k] = extra[k];
    return tag('circle', o);
  }

  function ellipse(cx, cy, rx, ry, fill, stroke, sw, extra) {
    var o = { cx: n(cx), cy: n(cy), rx: n(rx), ry: n(ry), fill: fill || 'none' };
    if (stroke) { o.stroke = stroke; o['stroke-width'] = n(sw === undefined ? SW : sw); }
    if (extra) for (var k in extra) o[k] = extra[k];
    return tag('ellipse', o);
  }

  function rect(x, y, w, h, r, fill, stroke, sw) {
    var o = { x: n(x), y: n(y), width: n(w), height: n(h), rx: n(r), fill: fill || 'none' };
    if (stroke) { o.stroke = stroke; o['stroke-width'] = n(sw === undefined ? SW : sw); }
    return tag('rect', o);
  }

  // Glossy white highlight.
  function shine(d, op) {
    return path(d, '#ffffff', null, 0, { opacity: n(op), 'class': 'pa-shine' });
  }

  // Soft ground shadow under a piece.
  function shadow(cx, rx) {
    return ellipse(cx, 91.2, rx, 3.6, '#1b1030', null, 0, { opacity: '0.16', 'class': 'pa-shadow' });
  }

  // ---------------------------------------------------------------------------------------------
  // Faces
  // ---------------------------------------------------------------------------------------------
  function eye(cx, cy, r, P) {
    return '<g class="eye">' +
      circle(cx, cy, r, '#ffffff', P.line, Math.max(0.9, r * 0.28), { 'class': 'sclera' }) +
      circle(cx - r * 0.04, cy + r * 0.1, r * 0.64, P.pupil, null, 0, { 'class': 'pupil' }) +
      circle(cx + r * 0.2, cy - r * 0.2, r * 0.26, '#ffffff', null, 0, { 'class': 'glint' }) +
      '</g>';
  }

  function eyeHappy(cx, cy, r, P) {
    return path('M' + n(cx - r) + ' ' + n(cy + r * 0.45) + ' Q' + n(cx) + ' ' + n(cy - r * 1.15) + ' ' +
      n(cx + r) + ' ' + n(cy + r * 0.45), 'none', P.face, Math.max(1.6, r * 0.55),
      { 'class': 'eye-happy', 'stroke-linecap': 'round' });
  }

  function eyeX(cx, cy, r, P) {
    var a = r * 0.78;
    return path('M' + n(cx - a) + ' ' + n(cy - a) + ' L' + n(cx + a) + ' ' + n(cy + a) +
      ' M' + n(cx + a) + ' ' + n(cy - a) + ' L' + n(cx - a) + ' ' + n(cy + a), 'none', P.face,
      Math.max(1.6, r * 0.5), { 'class': 'eye-x', 'stroke-linecap': 'round' });
  }

  function mouthSmile(cx, cy, w, P, sw) {
    return path('M' + n(cx - w) + ' ' + n(cy) + ' Q' + n(cx) + ' ' + n(cy + w * 1.05) + ' ' + n(cx + w) + ' ' + n(cy),
      'none', P.face, sw || 2.1, { 'class': 'mouth-smile', 'stroke-linecap': 'round' });
  }

  function mouthO(cx, cy, s, P) {
    return ellipse(cx, cy + s * 0.3, s * 0.72, s * 0.95, P.mouthIn, P.face, 1.3, { 'class': 'mouth-o' });
  }

  function cheek(cx, cy, rx, ry, P) {
    return ellipse(cx, cy, rx, ry, P.cheek, null, 0, { opacity: n(P.cheekOp), 'class': 'cheek' });
  }

  function sweat(cx, cy, s) {
    s = s || 1;
    var d = 'M' + n(cx) + ' ' + n(cy - 5 * s) +
      ' C' + n(cx + 2.6 * s) + ' ' + n(cy - 1.4 * s) + ',' + n(cx + 3.4 * s) + ' ' + n(cy + 1.2 * s) + ',' + n(cx + 3.4 * s) + ' ' + n(cy + 2 * s) +
      ' C' + n(cx + 3.4 * s) + ' ' + n(cy + 4 * s) + ',' + n(cx + 1.8 * s) + ' ' + n(cy + 5.2 * s) + ',' + n(cx) + ' ' + n(cy + 5.2 * s) +
      ' C' + n(cx - 1.8 * s) + ' ' + n(cy + 5.2 * s) + ',' + n(cx - 3.4 * s) + ' ' + n(cy + 4 * s) + ',' + n(cx - 3.4 * s) + ' ' + n(cy + 2 * s) +
      ' C' + n(cx - 3.4 * s) + ' ' + n(cy + 1.2 * s) + ',' + n(cx - 2.6 * s) + ' ' + n(cy - 1.4 * s) + ',' + n(cx) + ' ' + n(cy - 5 * s) + ' Z';
    return '<g class="sweat">' +
      path(d, '#a9e2ff', '#2f7fc4', 1.2) +
      ellipse(cx - 1.2 * s, cy + 1.8 * s, 0.9 * s, 1.5 * s, '#ffffff', null, 0, { opacity: '0.85' }) +
      '</g>';
  }

  /*
   * f = { eyes:[[x,y],...], r, mouth:[x,y,w], msw, mo, cheeks:[[x,y],...], crx, cry, lashes, extra, sweat:[x,y,s] }
   */
  function face(f, P) {
    var s = '<g class="face pa-face">';
    var i;
    var cheeks = f.cheeks || [];
    for (i = 0; i < cheeks.length; i++) s += cheek(cheeks[i][0], cheeks[i][1], f.crx || 3.3, f.cry || 2.1, P);
    for (i = 0; i < f.eyes.length; i++) {
      var e = f.eyes[i];
      s += eye(e[0], e[1], f.r, P);
      s += eyeHappy(e[0], e[1], f.r, P);
      s += eyeX(e[0], e[1], f.r, P);
    }
    if (f.lashes) s += f.lashes;
    if (f.extra) s += f.extra;
    var m = f.mouth;
    s += mouthSmile(m[0], m[1], m[2], P, f.msw);
    s += mouthO(m[0], m[1] + 0.6, f.mo || 2.4, P);
    if (f.sweat) s += sweat(f.sweat[0], f.sweat[1], f.sweat[2]);
    return s + '</g>';
  }

  // ---------------------------------------------------------------------------------------------
  // Pieces. Each builder returns { shadow, art, face } SVG strings.
  // ---------------------------------------------------------------------------------------------
  function base(x1, x2, P, y1, y2) {
    y1 = y1 === undefined ? 80 : y1;
    y2 = y2 === undefined ? 91 : y2;
    return rect(x1, y1, x2 - x1, y2 - y1, 5.2, P.body, P.line) +
      shine('M' + n(x1 + 5) + ' ' + n(y1 + 2.6) + ' H' + n(x1 + 17) + ' Q' + n(x1 + 18.4) + ' ' + n(y1 + 3.6) + ' ' +
        n(x1 + 17) + ' ' + n(y1 + 4.6) + ' H' + n(x1 + 5) + ' Q' + n(x1 + 3.6) + ' ' + n(y1 + 3.6) + ' ' + n(x1 + 5) + ' ' + n(y1 + 2.6) + ' Z',
        P.shineOp * 0.8);
  }

  function pawn(P) {
    var art =
      path('M38 56 C37 66,31 73,29 81 L71 81 C69 73,63 66,62 56 Z', P.body, P.line) +
      shine('M38.8 63 C37.5 69,35 73,33.4 77 Q35.2 78,36.6 76.6 C38.4 72.6,40.2 68.6,41.3 64 Q40.2 62.2,38.8 63 Z', P.shineOp * 0.8) +
      base(25, 75, P) +
      circle(50, 37, 16, P.head, P.line) +
      shine('M37.6 33.2 C38.6 27.6,43 23.8,48.2 23.4 Q50.2 23.6,49.2 25.4 C45 26.6,41.8 29.6,40.6 33.6 Q39 35.2,37.6 33.2 Z', P.shineOp) +
      ellipse(50, 56, 16, 5, P.acc, P.line) +
      shine('M38 55 Q44 52.6,51 52.6 Q52 53.6,51 54.4 Q44.5 54.6,39.4 56.4 Q37.4 56.4,38 55 Z', P.shineOp * 0.7);
    var fc = face({
      eyes: [[44.2, 37.6], [55.8, 37.6]], r: 3.7,
      mouth: [50, 44.2, 3.2],
      cheeks: [[38.4, 43.2], [61.6, 43.2]],
      sweat: [64.5, 27.5, 0.9]
    }, P);
    return { shadow: shadow(50, 27), art: art, face: fc };
  }

  function rook(P) {
    var art =
      path('M27 35 V17 Q27 15 29 15 H36 Q38 15 38 17 V22 H44 V17 Q44 15 46 15 H54 Q56 15 56 17 V22 H62 V17 Q62 15 64 15 H71 Q73 15 73 17 V35 Z',
        P.body, P.line) +
      shine('M30.2 18.4 Q30.2 17.6 31 17.6 H33.4 Q34.2 17.6 34.2 18.4 V21.6 Q32.2 22.4 30.2 21.6 Z', P.shineOp) +
      path('M32 42 L68 42 L71 73 L29 73 Z', P.body, P.line) +
      shine('M34.6 46 L37.8 46 L36.2 68.6 Q34.4 69.6,32.6 68.6 Z', P.shineOp * 0.75) +
      rect(27, 34, 46, 9, 4, P.acc, P.line) +
      shine('M31 36.6 H47 Q48.2 37.4 47 38.2 H31 Q29.8 37.4 31 36.6 Z', P.shineOp * 0.8) +
      rect(25, 72, 50, 9, 4.2, P.acc, P.line) +
      shine('M29 74.6 H43 Q44.2 75.4 43 76.2 H29 Q27.8 75.4 29 74.6 Z', P.shineOp * 0.8) +
      base(20, 80, P);
    var fc = face({
      eyes: [[43, 53.6], [57, 53.6]], r: 4,
      mouth: [50, 61, 3.4],
      cheeks: [[37, 60], [63, 60]],
      mo: 2.6,
      sweat: [64.5, 47, 0.95]
    }, P);
    return { shadow: shadow(50, 32), art: art, face: fc };
  }

  function bishop(P) {
    var art =
      path('M40 64 C40 72,33 77,30 82 L70 82 C67 77,60 72,60 64 Z', P.body, P.line) +
      shine('M39.2 69.4 C37.8 73,35.8 75.4,34.4 77.6 Q36 78.6,37.4 77.4 C39.2 75.2,40.8 72.6,41.8 69.6 Q40.6 68.4,39.2 69.4 Z', P.shineOp * 0.8) +
      base(21, 79, P) +
      circle(50, 11.6, 5.2, P.ball, P.line) +
      path('M50 15.5 C66.5 26.5,70.5 44,62.5 58.5 Q50 63.5 37.5 58.5 C29.5 44,33.5 26.5,50 15.5 Z', P.head, P.line) +
      shine('M36.4 42.4 C36 34.4,39.6 27.2,45.6 21.8 Q47.8 21.2,47.2 23.4 C42.6 28.6,40 35,39.6 42.2 Q38 44.2,36.4 42.4 Z', P.shineOp) +
      path('M58 25.4 L49.6 37.4', 'none', P.line, 4.8, { 'stroke-linecap': 'round' }) +
      path('M58 25.4 L49.6 37.4', 'none', P.slit, 1.9, { 'stroke-linecap': 'round' }) +
      ellipse(50, 64.5, 15.5, 4.8, P.acc, P.line) +
      shine('M38.4 63.5 Q44 61.2,50.8 61.2 Q51.8 62.2,50.8 62.9 Q44.6 63.1,39.6 64.9 Q37.6 64.9,38.4 63.5 Z', P.shineOp * 0.7) +
      shine('M48.2 9.2 Q49.2 7.8,50.8 8.2 Q51.4 9,50.6 9.6 Q49.6 9.8,49 10.6 Q48 10.6,48.2 9.2 Z', 0.8);
    var fc = face({
      eyes: [[44.2, 46.6], [55.8, 46.6]], r: 3.9,
      mouth: [50, 53.4, 3],
      cheeks: [[38.6, 52.2], [61.4, 52.2]],
      crx: 3, cry: 1.9,
      mo: 2.2,
      sweat: [64.2, 35.5, 0.85]
    }, P);
    return { shadow: shadow(50, 31), art: art, face: fc };
  }

  var KNIGHT_BODY = 'M31 82 C31 72,38 64,46 57 C40 59,33 61,27 61 C20 61,16 55,19 49 C23 42,30 35,37 28 ' +
    'C40 22,44 19,48 18 L51 8 L57 18 C70 22,79 38,77 58 C76 68,73 75,73 82 Z';
  var KNIGHT_MANE = 'M57 18 C70 22,79 38,77 58 C76 68,73 75,73 82 L65 82 ' +
    'Q63.6 77,66.4 73.4 Q62.6 70,65.6 64.6 Q61.8 61,64.6 55.6 Q61 51.6,63.2 46.4 Q59.6 42.6,61 37.4 ' +
    'Q57.4 34,57.8 29 Q54.4 26.2,54.4 21.8 Z';

  function knight(P) {
    var art =
      path('M42.4 21.6 L43.8 10.2 L50.2 18.2 Z', P.body, P.line, 2.8) +
      path(KNIGHT_BODY, P.body) +
      path(KNIGHT_MANE, P.acc) +
      path('M50.4 12.6 L52.8 17.8 L49.4 18.6 Z', P.earIn, null, 0, { opacity: '0.9' }) +
      path(KNIGHT_BODY, 'none', P.line, SW) +
      shine('M31.6 34.4 C35 30,39.4 25.2,44.2 22.2 Q46 21.8,45.2 23.6 C41.2 27,37.6 31,34.6 35.6 Q32.6 36.8,31.6 34.4 Z', P.shineOp) +
      shine('M37.4 70 C38.8 66.4,41.4 63.6,44.6 61.4 Q46 61.4,45.4 62.8 C42.8 65,41 67.6,39.8 70.6 Q38.2 71.6,37.4 70 Z', P.shineOp * 0.7) +
      path('M44.6 57.2 C45.4 53.4,45 50.4,43 47.6', 'none', P.line, 2, { 'stroke-linecap': 'round', opacity: '0.55' }) +
      ellipse(22.6, 51.2, 1.7, 2.3, P.line, null, 0, { transform: 'rotate(-25 22.6 51.2)' }) +
      base(20, 80, P);
    var fc = face({
      eyes: [[41, 34.6]], r: 4.9,
      mouth: [27.6, 56.2, 2.6],
      msw: 1.9,
      mo: 1.8,
      cheeks: [[34.6, 45.2]],
      crx: 3.4, cry: 2.2,
      sweat: [30, 26, 0.85]
    }, P);
    return { shadow: shadow(50, 31), art: art, face: fc };
  }

  // Two short upward eyelashes on the outer top of an eye (side = -1 left eye, +1 right eye).
  function lashes(cx, cy, r, side, P) {
    var d = '';
    var angles = [150, 124];
    for (var i = 0; i < angles.length; i++) {
      var a = (side < 0 ? angles[i] : 180 - angles[i]) * Math.PI / 180;
      var dx = Math.cos(a);
      var dy = -Math.sin(a);
      d += 'M' + n(cx + dx * (r + 0.5)) + ' ' + n(cy + dy * (r + 0.5)) +
        ' L' + n(cx + dx * (r + 2.1)) + ' ' + n(cy + dy * (r + 2.1)) + ' ';
    }
    return path(d.trim(), 'none', P.face, 1.25, { 'stroke-linecap': 'round', 'class': 'lashes' });
  }

  // Head, collar and body shared by the queen and the king.
  var ROYAL_HEAD = { cx: 50, cy: 48.5, r: 15.5 };

  function royalBody(P, wide) {
    var w = wide ? 1 : 0;
    return path('M' + (37 - w) + ' 65 C' + (36 - w) + ' 73,' + (27 - 2 * w) + ' 77.5,' + (24 - 2 * w) + ' 82 L' + (76 + 2 * w) +
      ' 82 C' + (73 + 2 * w) + ' 77.5,' + (64 + w) + ' 73,' + (63 + w) + ' 65 Z', P.body, P.line) +
      shine('M' + n(35.6 - w) + ' 70.6 C' + n(33.8 - w) + ' 73.8,' + n(31 - 2 * w) + ' 76,' + n(28.8 - 2 * w) + ' 77.8 Q' +
        n(30.4 - 2 * w) + ' 79,' + n(32 - 2 * w) + ' 77.8 C' + n(34.6 - w) + ' 76,' + n(36.8 - w) + ' 73.6,' + n(38.2 - w) +
        ' 71.2 Q' + n(37 - w) + ' 69.6,' + n(35.6 - w) + ' 70.6 Z', P.shineOp * 0.8) +
      base(19 - 1.5 * w, 81 + 1.5 * w, P);
  }

  function royalHead(P) {
    return circle(ROYAL_HEAD.cx, ROYAL_HEAD.cy, ROYAL_HEAD.r, P.head, P.line);
  }

  function royalCollar(P, wide) {
    var rx = wide ? 17.5 : 17;
    return ellipse(50, 65.5, rx, 5, P.acc, P.line) +
      shine('M' + n(50 - rx + 3.2) + ' 64.6 Q' + n(50 - rx + 9.4) + ' 62.2,' + n(50.8) + ' 62.2 Q51.8 63.2,50.8 64 Q' +
        n(50 - rx + 10) + ' 64.2,' + n(50 - rx + 4.6) + ' 66 Q' + n(50 - rx + 2.6) + ' 66,' + n(50 - rx + 3.2) + ' 64.6 Z', P.shineOp * 0.7);
  }

  function headShine(P) {
    return shine('M37.4 49.2 Q37.6 44.2,40.6 41.6 Q42 41.4,41.8 42.8 Q40 45.2,39.8 49 Q38.6 50.6,37.4 49.2 Z', P.shineOp);
  }

  function queen(P) {
    var tips = [[31, 19], [40.5, 14], [50, 11], [59.5, 14], [69, 19]];
    var balls = '';
    for (var i = 0; i < tips.length; i++) {
      balls += circle(tips[i][0], tips[i][1], i === 2 ? 3.7 : 3.1, P.ball, P.line, 2.4);
    }
    var art =
      royalBody(P, false) +
      royalHead(P) +
      headShine(P) +
      path('M35.5 39 L31 19 L37 29 L40.5 14 L45.2 28 L50 11 L54.8 28 L59.5 14 L63 29 L69 19 L64.5 39 Q50 43 35.5 39 Z',
        P.acc, P.line, 2.8) +
      shine('M37.2 36.8 L34.4 25.4 L37.6 30.2 Q38.4 33.6,39 36.2 Q38.2 37.6,37.2 36.8 Z', P.shineOp * 0.8) +
      balls +
      ellipse(50, 34.6, 2.5, 3.1, P.gem, P.line, 1.5) +
      circle(49.3, 33.6, 0.75, '#ffffff', null, 0, { opacity: '0.9' }) +
      royalCollar(P, false);
    var fc = face({
      eyes: [[44.2, 50.2], [55.8, 50.2]], r: 3.8,
      mouth: [50, 56.6, 2.8],
      cheeks: [[38.6, 55.4], [61.4, 55.4]],
      crx: 2.9, cry: 1.9,
      mo: 2.1,
      lashes: lashes(44.2, 50.2, 3.8, -1, P) + lashes(55.8, 50.2, 3.8, 1, P),
      sweat: [64.4, 45.5, 0.8]
    }, P);
    return { shadow: shadow(50, 32), art: art, face: fc };
  }

  function king(P) {
    var art =
      royalBody(P, true) +
      royalHead(P) +
      headShine(P) +
      path('M47.2 4 H52.8 V9.6 H58.4 V15.2 H52.8 V23.5 H47.2 V15.2 H41.6 V9.6 H47.2 Z', P.acc, P.line, 2.8) +
      shine('M48.8 6.2 H50.4 V11.4 H48.8 Z', P.shineOp) +
      path('M35.5 39 L32.5 24 Q41.5 30 50 22.5 Q58.5 30 67.5 24 L64.5 39 Q50 43 35.5 39 Z', P.acc, P.line, 2.8) +
      shine('M37.2 36.4 L35.6 28 Q37.6 29.2,39.4 29.8 L38.8 36.8 Q37.8 37.6,37.2 36.4 Z', P.shineOp * 0.8) +
      circle(50, 32.6, 2.6, P.gem, P.line, 1.5) +
      circle(42, 34, 1.8, P.gem2, P.line, 1.3) +
      circle(58, 34, 1.8, P.gem2, P.line, 1.3) +
      circle(49.3, 31.8, 0.75, '#ffffff', null, 0, { opacity: '0.9' }) +
      royalCollar(P, true);
    var mustache = path('M50 54.1 C47.6 52.5,43.8 52.5,41.8 54.3 C40.8 55.2,40.2 54.5,39.6 53.7 C39.4 56.5,42 57.9,44.8 57.3 ' +
      'C47 56.9,48.8 55.9,50 55.1 C51.2 55.9,53 56.9,55.2 57.3 C58 57.9,60.6 56.5,60.4 53.7 C59.8 54.5,59.2 55.2,58.2 54.3 ' +
      'C56.2 52.5,52.4 52.5,50 54.1 Z', P.mustache, null, 0, { 'class': 'mustache' });
    var fc = face({
      eyes: [[44.2, 48.8], [55.8, 48.8]], r: 3.7,
      mouth: [50, 57.6, 2.2],
      msw: 1.8,
      cheeks: [[37.8, 53.2], [62.2, 53.2]],
      crx: 2.6, cry: 1.7,
      mo: 1.6,
      extra: mustache,
      sweat: [64.6, 44.5, 0.8]
    }, P);
    return { shadow: shadow(50, 33), art: art, face: fc };
  }

  var BUILDERS = { p: pawn, n: knight, b: bishop, r: rook, q: queen, k: king };

  // ---------------------------------------------------------------------------------------------
  // Mascot «Огонёк» — orange knight facing RIGHT with a red scarf.
  // ---------------------------------------------------------------------------------------------
  var M = {
    line: '#6b3410', face: '#4a1f06', pupil: '#2a1206', mouthIn: '#9a2f1c',
    cheek: '#ff5f7e', cheekOp: 0.55, shineOp: 0.55
  };

  var MASCOT_BODY = 'M26 85 C25 74,22 64,22 54 C22 38,28 26,38 20 L40 5 L49 15.5 C57 12.5,68 17,74 27 ' +
    'C79 34,86 40,88 47 C90 55,86 62,78 63 C72 64,66 63,62 62 C64 70,70 77,72 85 Z';
  var MASCOT_MANE = 'M38 20 C28 26,22 38,22 54 C22 64,25 74,26 85 L34.5 85 Q32.4 80.4,35.4 76.4 Q31.6 72.4,34.6 67.6 ' +
    'Q30.8 63,34 58 Q30.6 52.6,34.4 48.2 Q31.8 42.4,36.4 38.6 Q35 32.6,40.6 29.6 Q40.2 23.6,43 20 Z';

  function mascot() {
    var scarf = 'url(#pa-m-scarf) #e8384f';
    var art =
      ellipse(50, 92, 33, 3.4, '#3a1a06', null, 0, { opacity: '0.16', 'class': 'pa-shadow' }) +
      // far ear (behind the head)
      path('M31.6 24.6 L30.4 10.6 L39.6 19 Z', 'url(#pa-m-body) #ff9a4d', M.line, 2.8) +
      path(MASCOT_BODY, 'url(#pa-m-body) #ff9a4d') +
      path(MASCOT_MANE, 'url(#pa-m-mane) #2ec4b6') +
      path('M41.2 10.2 L46.2 15.8 L41.6 18.4 Z', '#ffb3a6', null, 0, { opacity: '0.95' }) +
      path(MASCOT_BODY, 'none', M.line, SW) +
      // forelock tuft
      path('M44.6 17.8 Q47.8 11.8,54.8 13.2 Q52 15,52.2 18 Q55.6 17.2,57.4 19.4 Q51.6 20.2,48.2 23.4 Q47.4 19.8,44.6 17.8 Z',
        'url(#pa-m-mane) #2ec4b6', M.line, 2.2) +
      shine('M53.4 22.2 Q60.4 19.4,67.6 23.4 Q68.8 25,67 25.2 Q60.8 22.8,54.8 24.6 Q52.6 24.2,53.4 22.2 Z', M.shineOp) +
      shine('M79.6 42.2 Q82.8 44.2,84.6 47.6 Q84.4 49.2,83 48.4 Q81.4 45.6,78.8 43.8 Q78.4 42.4,79.6 42.2 Z', M.shineOp * 0.8) +
      shine('M60.4 74.6 Q63.6 77.4,65 81.6 Q64.4 82.8,63.2 82 Q61.8 78.4,59.4 76 Q59.2 74.6,60.4 74.6 Z', M.shineOp * 0.7) +
      path('M62.4 61.6 C61 57.4,61.8 53.6,64.6 50.4', 'none', M.line, 2, { 'stroke-linecap': 'round', opacity: '0.45' }) +
      ellipse(82.6, 47.6, 1.8, 2.4, M.line, null, 0, { transform: 'rotate(25 82.6 47.6)' }) +
      rect(18, 84, 64, 8.4, 4.2, 'url(#pa-m-body) #ff9a4d', M.line, SW) +
      shine('M23 86.2 H36 Q37.2 87 36 87.8 H23 Q21.8 87 23 86.2 Z', M.shineOp * 0.8) +
      // scarf: hanging end behind the neck, band around the neck, knot at the back
      path('M25.2 64.4 C18.6 66.6,13.8 71.4,11.8 79.4 L20 81 C20.6 75.6,23 72,27 70.2 Z', scarf, M.line, 2.6) +
      path('M12.8 76 L20.8 77.6', 'none', '#ffd35c', 2.2, { 'stroke-linecap': 'round' }) +
      path('M13 81.4 L12.2 84 M15.8 81.8 L15.4 84.6 M18.6 82.4 L18.6 85', 'none', M.line, 1.6, { 'stroke-linecap': 'round' }) +
      path('M20.4 59.4 C33.6 64.6,52.6 64.4,66.4 57.6 L69 67 C54.4 74,34.6 74.2,21.4 69.6 Z', scarf, M.line, 2.8) +
      path('M25.2 63.4 C37 66.8,52 66.6,63 62', 'none', '#ffffff', 1.7, { opacity: '0.35', 'stroke-linecap': 'round' }) +
      path('M30.6 65.8 L31.4 71.8 M39.6 67.2 L40 73.2 M48.8 67.4 L48.8 73.2 M57.8 65.8 L57.8 71.4', 'none', '#b01f33', 1.3,
        { opacity: '0.5', 'stroke-linecap': 'round' }) +
      circle(24.2, 64.8, 4.4, scarf, M.line, 2.4) +
      circle(23, 63.4, 1.2, '#ffffff', null, 0, { opacity: '0.45' });
    var fc =
      '<g class="face pa-face">' +
      cheek(68.4, 46.4, 4.2, 2.7, M) +
      '<g class="eye">' +
      circle(59.6, 34, 7, '#ffffff', M.line, 1.6, { 'class': 'sclera' }) +
      circle(60.6, 35, 4.6, M.pupil, null, 0, { 'class': 'pupil' }) +
      circle(62.4, 32.8, 1.8, '#ffffff', null, 0, { 'class': 'glint' }) +
      circle(58.8, 37.2, 0.8, '#ffffff', null, 0, { 'class': 'glint', opacity: '0.8' }) +
      '</g>' +
      eyeHappy(59.6, 35, 6, M) +
      eyeX(59.6, 34, 5, M) +
      path('M53.6 25.6 Q58.8 23.2,64.8 25.4', 'none', M.line, 1.9, { 'stroke-linecap': 'round', 'class': 'brow' }) +
      mouthSmile(77.6, 56.2, 4, M, 2.2) +
      mouthO(78, 56.6, 2.4, M) +
      sweat(47.6, 30.5, 1) +
      '</g>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="mascot-svg" aria-hidden="true" focusable="false">' +
      '<g class="pa-art" stroke-linejoin="round" stroke-linecap="round">' + art + fc + '</g></svg>';
  }

  // ---------------------------------------------------------------------------------------------
  // Lesson star
  // ---------------------------------------------------------------------------------------------
  var STAR_PATH = (function () {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = (-90 + i * 36) * Math.PI / 180;
      var r = i % 2 === 0 ? 40 : 21.5;
      pts.push(n(50 + r * Math.cos(a)) + ' ' + n(54 + r * Math.sin(a)));
    }
    return 'M' + pts.join(' L') + ' Z';
  })();

  function star() {
    var S = { line: '#c97a00', face: '#6b3a00', pupil: '#4a2800', mouthIn: '#a0401e', cheek: '#ff7a8a', cheekOp: 0.6 };
    var art =
      path(STAR_PATH, '#c97a00', '#c97a00', 11, { 'stroke-linejoin': 'round' }) +
      path(STAR_PATH, 'url(#pa-star) #ffc93c', 'url(#pa-star) #ffc93c', 5.2, { 'stroke-linejoin': 'round' }) +
      shine('M44.4 22.4 Q47.4 17.2,50 17.4 Q51.4 18.2,50.2 20 L46.6 26.6 Q44.8 27.4,44.4 25.8 Z', 0.7) +
      shine('M22.4 42.2 Q18.8 41.4,19.4 39.8 Q20.2 38.6,23 38.8 L31 39.4 Q32 40.6,31 41.6 Z', 0.55);
    var fc =
      '<g class="face pa-face">' +
      cheek(39.6, 60, 3.6, 2.3, S) + cheek(60.4, 60, 3.6, 2.3, S) +
      '<g class="eye">' +
      ellipse(43.6, 52.6, 2.9, 3.6, S.pupil, null, 0, { 'class': 'pupil' }) +
      circle(44.6, 51.2, 1.1, '#ffffff', null, 0, { 'class': 'glint' }) +
      '</g>' +
      '<g class="eye">' +
      ellipse(56.4, 52.6, 2.9, 3.6, S.pupil, null, 0, { 'class': 'pupil' }) +
      circle(57.4, 51.2, 1.1, '#ffffff', null, 0, { 'class': 'glint' }) +
      '</g>' +
      eyeHappy(43.6, 53, 3, S) + eyeHappy(56.4, 53, 3, S) +
      eyeX(43.6, 52.6, 2.8, S) + eyeX(56.4, 52.6, 2.8, S) +
      mouthSmile(50, 59, 3.2, S, 2.1) +
      mouthO(50, 59.4, 2.2, S) +
      '</g>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="star-svg" aria-hidden="true" focusable="false">' +
      '<g class="pa-art" stroke-linejoin="round" stroke-linecap="round">' + art + fc + '</g></svg>';
  }

  // ---------------------------------------------------------------------------------------------
  // Shared defs + CSS
  // ---------------------------------------------------------------------------------------------
  function lin(id, stops, x1, y1, x2, y2) {
    var s = '<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">';
    for (var i = 0; i < stops.length; i++) s += '<stop offset="' + stops[i][0] + '" stop-color="' + stops[i][1] + '"/>';
    return s + '</linearGradient>';
  }

  function rad(id, stops, cx, cy, r) {
    var s = '<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fx="' + cx + '" fy="' + cy + '">';
    for (var i = 0; i < stops.length; i++) s += '<stop offset="' + stops[i][0] + '" stop-color="' + stops[i][1] + '"/>';
    return s + '</radialGradient>';
  }

  var DEFS =
    lin('pa-w-body', [[0, '#ffffff'], [0.5, '#fbf2de'], [1, '#efdcb2']], 0.1, 0, 0.75, 1) +
    rad('pa-w-head', [[0, '#ffffff'], [0.55, '#fcf4e3'], [1, '#efdcb2']], 0.38, 0.32, 0.78) +
    lin('pa-w-acc', [[0, '#ffe27a'], [1, '#f5a623']], 0, 0, 0.35, 1) +
    rad('pa-w-ball', [[0, '#fff6c8'], [0.45, '#ffe27a'], [1, '#f5a623']], 0.36, 0.32, 0.75) +
    lin('pa-b-body', [[0, '#7c6bbd'], [0.45, '#5a4a98'], [1, '#271c4a']], 0.1, 0, 0.75, 1) +
    rad('pa-b-head', [[0, '#9384d4'], [0.5, '#62539f'], [1, '#2c2052']], 0.38, 0.32, 0.8) +
    lin('pa-b-acc', [[0, '#ffa6db'], [1, '#e0529c']], 0, 0, 0.35, 1) +
    rad('pa-b-ball', [[0, '#ffe0f2'], [0.45, '#ffa6db'], [1, '#e0529c']], 0.36, 0.32, 0.75) +
    lin('pa-m-body', [[0, '#ffc26b'], [1, '#ff7a3d']], 0.1, 0, 0.7, 1) +
    lin('pa-m-mane', [[0, '#6ee6da'], [1, '#1fa396']], 0, 0, 0.4, 1) +
    lin('pa-m-scarf', [[0, '#ff6b6b'], [1, '#d62839']], 0, 0, 0, 1) +
    lin('pa-star', [[0, '#ffe066'], [1, '#ffb400']], 0, 0, 0, 1);

  var CSS = [
    ':where(svg.pc,svg.mascot-svg,svg.star-svg){display:block;width:100%;height:100%;overflow:visible}',
    ':where(svg.pc-icon){display:inline-block;width:1.25em;height:1.25em;vertical-align:-.25em}',
    '.pa-face .eye-happy,.pa-face .eye-x,.pa-face .mouth-o,.pa-face .sweat{display:none}',
    '.is-happy .pa-face .eye{display:none}',
    '.is-happy .pa-face .eye-happy{display:inline}',
    '.is-happy .pa-face .cheek{opacity:.8}',
    '.is-scared .pa-face .mouth-smile{display:none}',
    '.is-scared .pa-face .mouth-o,.is-scared .pa-face .sweat{display:inline}',
    '.is-dizzy .pa-face .eye,.is-dizzy .pa-face .eye-happy,.is-dizzy .pa-face .mouth-smile{display:none}',
    '.is-dizzy .pa-face .eye-x,.is-dizzy .pa-face .mouth-o{display:inline}',
    '.no-faces .pa-face{display:none}',
    '.pa-face .eye{transform-box:fill-box;transform-origin:center;' +
      'animation:pa-blink 6.2s ease-in-out infinite;animation-delay:var(--blink-delay,0s)}',
    '.pa-face .pupil,.pa-face .glint{transform:translate(calc(var(--look-x,0)*1px),calc(var(--look-y,0)*1px));' +
      'transition:transform .22s ease-out}',
    '@keyframes pa-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}98%{transform:scaleY(1)}}',
    '.is-scared .pa-art{transform-box:view-box;transform-origin:50% 90%;animation:pa-shiver 1.8s ease-in-out infinite}',
    '@keyframes pa-shiver{0%,30%,100%{transform:rotate(0)}5%{transform:rotate(-2.6deg)}10%{transform:rotate(2.6deg)}' +
      '15%{transform:rotate(-2deg)}20%{transform:rotate(1.6deg)}25%{transform:rotate(-.8deg)}}',
    '.is-scared .pa-face .sweat{animation:pa-sweat 1.8s ease-in-out infinite}',
    '@keyframes pa-sweat{0%,100%{transform:translateY(0)}50%{transform:translateY(1.4px)}}',
    '@media (prefers-reduced-motion:reduce){.is-scared .pa-art,.is-scared .pa-face .sweat{animation:none}' +
      '.pa-face .pupil,.pa-face .glint{transition:none}}'
  ].join('\n');

  // ---------------------------------------------------------------------------------------------
  // install()
  // ---------------------------------------------------------------------------------------------
  var waiting = false;

  function install() {
    if (typeof document === 'undefined' || !document || !document.createElement) return false;
    try {
      if (!document.getElementById('pa-style')) {
        var st = document.createElement('style');
        st.id = 'pa-style';
        st.textContent = CSS;
        (document.head || document.documentElement).appendChild(st);
      }
      if (!document.getElementById('pa-defs')) {
        if (!document.body) {
          if (!waiting && document.addEventListener) {
            waiting = true;
            document.addEventListener('DOMContentLoaded', function () {
              waiting = false;
              install();
            });
          }
          return false;
        }
        var holder = document.createElement('div');
        holder.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" id="pa-defs" width="0" height="0" ' +
          'style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none" aria-hidden="true" focusable="false">' +
          '<defs>' + DEFS + '</defs></svg>';
        var svgEl = holder.firstChild;
        if (svgEl) document.body.insertBefore(svgEl, document.body.firstChild);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function ensure() {
    if (typeof document === 'undefined' || !document || !document.getElementById) return;
    if (!document.getElementById('pa-defs') || !document.getElementById('pa-style')) install();
  }

  // ---------------------------------------------------------------------------------------------
  // Public generators
  // ---------------------------------------------------------------------------------------------
  function normColor(c) {
    if (c === 'w' || c === 'b') return c;
    if (c === 8) return 'w';
    if (c === 16) return 'b';
    if (typeof c === 'string') {
      var s = c.toLowerCase();
      if (s === 'white' || s === 'w') return 'w';
      if (s === 'black' || s === 'b') return 'b';
    }
    return null;
  }

  function normType(t) {
    if (typeof t === 'number' && t >= 1 && t <= 6) return TYPES.charAt(t - 1);
    if (typeof t === 'string' && t.length === 1) {
      var s = t.toLowerCase();
      if (TYPES.indexOf(s) >= 0) return s;
    }
    return null;
  }

  var cache = {};

  function build(color, type, withFace) {
    var c = normColor(color);
    var t = normType(type);
    if (!c || !t) return '';
    var key = c + t + (withFace ? 'f' : 'i');
    if (cache[key]) return cache[key];
    var parts = BUILDERS[t](PAL[c]);
    var inner = withFace ? parts.shadow + parts.art + parts.face : parts.art;
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="pc pc-' + c + ' pc-' + t +
      (withFace ? '' : ' pc-icon') + '" aria-hidden="true" focusable="false">' +
      '<g class="pa-art" stroke-linejoin="round" stroke-linecap="round">' + inner + '</g></svg>';
    cache[key] = out;
    return out;
  }

  var mascotCache = '';
  var starCache = '';

  var PieceArt = {
    install: install,
    svg: function (color, type) {
      ensure();
      return build(color, type, true);
    },
    icon: function (color, type) {
      ensure();
      return build(color, type, false);
    },
    mascot: function () {
      ensure();
      if (!mascotCache) mascotCache = mascot();
      return mascotCache;
    },
    star: function () {
      ensure();
      if (!starCache) starCache = star();
      return starCache;
    },
    // Raw markup, e.g. for standalone previews / exported images.
    defsMarkup: function () { return DEFS; },
    cssText: function () { return CSS; }
  };

  global.PieceArt = PieceArt;
  if (typeof module !== 'undefined' && module.exports) module.exports = PieceArt;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
