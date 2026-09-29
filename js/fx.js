/*
 * «Шахматное Королевство» — визуальные эффекты: конфетти, взрывы звёздочек, салют, всплывающий текст.
 *
 * One lazily created full-screen canvas overlay (pointer-events: none), DPR-aware, resized with the window.
 * The requestAnimationFrame loop runs only while particles exist. prefers-reduced-motion → far fewer particles.
 *
 * Global: FX.
 */
(function (global) {
  'use strict';

  var doc = global.document || null;

  var PALETTE = ['#ff7a59', '#ffc93c', '#2ecc71', '#3fa9f5', '#6c63ff', '#ff6fae', '#ffffff'];
  var MAX_PARTICLES = 1400;
  var FRAME_MS = 1000 / 60;

  var canvas = null;
  var c2d = null;
  var dpr = 1;
  var W = 0;
  var H = 0;
  var particles = [];
  var rafId = 0;
  var lastTs = 0;
  var timers = [];
  var floats = [];
  var listening = false;

  var raf = typeof global.requestAnimationFrame === 'function'
    ? function (cb) { return global.requestAnimationFrame(cb); }
    : function (cb) { return setTimeout(function () { cb(nowMs()); }, 16); };
  var caf = typeof global.cancelAnimationFrame === 'function'
    ? function (id) { global.cancelAnimationFrame(id); }
    : function (id) { clearTimeout(id); };

  function nowMs() {
    try {
      if (global.performance && typeof global.performance.now === 'function') return global.performance.now();
    } catch (e) { /* ignore */ }
    return Date.now();
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function num(v, d) {
    if (v == null || v === '') return d;
    v = Number(v);
    return isFinite(v) ? v : d;
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function reducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function scaled(count, min) {
    var n = Math.max(0, Math.round(num(count, 0)));
    if (reducedMotion()) n = Math.round(n * 0.2);
    return Math.max(min || 0, Math.min(n, 800));
  }

  function colorsFrom(list) {
    if (Array.isArray(list)) {
      var ok = list.filter(function (c) { return typeof c === 'string' && c; });
      if (ok.length) return ok;
    } else if (typeof list === 'string' && list) {
      return [list];
    }
    return PALETTE;
  }

  function measure() {
    var de = doc && doc.documentElement;
    W = Math.max(1, num(global.innerWidth, 0) || (de && de.clientWidth) || 800);
    H = Math.max(1, num(global.innerHeight, 0) || (de && de.clientHeight) || 600);
  }

  /* ----- canvas overlay ----- */

  function resize() {
    if (!canvas) return;
    measure();
    dpr = clamp(num(global.devicePixelRatio, 1) || 1, 1, 2);
    var cw = Math.max(1, Math.round(W * dpr));
    var ch = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }

  function ensureCanvas() {
    if (!doc || !doc.body || typeof doc.createElement !== 'function') return false;
    if (!canvas) {
      var cv = doc.createElement('canvas');
      var ctx = null;
      try { ctx = cv.getContext && cv.getContext('2d'); } catch (e) { ctx = null; }
      if (!ctx) return false;
      cv.className = 'fx-canvas';
      cv.setAttribute('aria-hidden', 'true');
      var st = cv.style;
      st.position = 'fixed';
      st.left = '0';
      st.top = '0';
      st.inset = '0';
      st.pointerEvents = 'none';
      st.zIndex = '9999';
      st.display = 'none';
      canvas = cv;
      c2d = ctx;
    }
    if (canvas.parentNode !== doc.body) doc.body.appendChild(canvas);
    if (!listening && typeof global.addEventListener === 'function') {
      listening = true;
      global.addEventListener('resize', resize);
      global.addEventListener('orientationchange', resize);
    }
    resize();
    return true;
  }

  function startLoop() {
    if (rafId || !canvas) return;
    canvas.style.display = 'block';
    lastTs = 0;
    rafId = raf(frame);
  }

  function goIdle() {
    lastTs = 0;
    if (!canvas || !c2d) return;
    try {
      c2d.setTransform(1, 0, 0, 1, 0, 0);
      c2d.clearRect(0, 0, canvas.width, canvas.height);
    } catch (e) { /* ignore */ }
    canvas.style.display = 'none';
  }

  function frame(ts) {
    rafId = 0;
    try {
      var t = num(ts, nowMs());
      var dtMs = lastTs ? clamp(t - lastTs, 0, 50) : FRAME_MS;
      lastTs = t;
      update(dtMs);
      draw();
    } catch (e) {
      particles = [];
    }
    if (particles.length) rafId = raf(frame);
    else goIdle();
  }

  /* ----- particles -----
   * p = { x, y, vx, vy, g, drag, maxVy, rot, vr, tilt, vt, wob, wobS, wobA, size, color, shape,
   *       life, age, fade, delay, twinkle, phase, shrink, rocket, trailColor, onDeath } */

  function add(p) {
    if (particles.length >= MAX_PARTICLES) return null;
    p.age = 0;
    p.rot = p.rot || 0;
    p.vr = p.vr || 0;
    p.tilt = p.tilt || 0;
    p.vt = p.vt || 0;
    p.drag = p.drag == null ? 0.99 : p.drag;
    p.g = p.g || 0;
    p.fade = p.fade || 400;
    p.delay = p.delay || 0;
    p.phase = p.phase || Math.random() * 6.283;
    particles.push(p);
    return p;
  }

  function update(dtMs) {
    var dt = dtMs / FRAME_MS;
    var spawned = [];
    var alive = [];
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (p.delay > 0) {
        p.delay -= dtMs;
        alive.push(p);
        continue;
      }
      var k = Math.pow(p.drag, dt);
      p.vx *= k;
      p.vy *= k;
      p.vy += p.g * dt;
      // soft terminal velocity: the initial throw keeps its momentum for a moment, then flutters down
      if (p.maxVy && p.vy > p.maxVy) p.vy = p.maxVy + (p.vy - p.maxVy) * Math.pow(0.93, dt);
      var wx = 0;
      if (p.wobA) {
        p.wob += p.wobS * dt;
        wx = Math.sin(p.wob) * p.wobA;
      }
      p.x += (p.vx + wx) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.tilt += p.vt * dt;
      p.age += dtMs;

      var dead = p.age >= p.life;
      if (p.rocket) {
        // trail sparks
        if (Math.random() < 0.9) {
          spawned.push({
            x: p.x + rand(-1.5, 1.5), y: p.y + rand(2, 6), vx: rand(-0.4, 0.4), vy: rand(0.2, 1.2),
            g: 0.03, drag: 0.94, size: rand(1.6, 3.2), color: p.trailColor || '#fff3c4', shape: 'circle',
            life: rand(260, 480), fade: 260, twinkle: true
          });
        }
        if (p.vy >= -1.2) dead = true;          // reached the top of its flight → explode
      }
      if (!dead && p.y > H + 60 && p.vy >= 0) dead = true;
      if (!dead && (p.x < -150 || p.x > W + 150) && p.age > 600) dead = true;

      if (dead) {
        if (typeof p.onDeath === 'function') {
          try { p.onDeath(p, spawned); } catch (e) { /* ignore */ }
        }
      } else {
        alive.push(p);
      }
    }
    particles = alive;
    for (var j = 0; j < spawned.length; j++) add(spawned[j]);
  }

  function pathStar(ctx, r) {
    var inner = r * 0.48;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rr = i % 2 === 0 ? r : inner;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  function pathHeart(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.95);
    ctx.bezierCurveTo(-r * 1.25, r * 0.15, -r * 0.95, -r * 1.05, 0, -r * 0.42);
    ctx.bezierCurveTo(r * 0.95, -r * 1.05, r * 1.25, r * 0.15, 0, r * 0.95);
    ctx.closePath();
  }

  function draw() {
    if (!c2d || !canvas) return;
    var ctx = c2d;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (p.delay > 0) continue;
      var a = 1;
      var left = p.life - p.age;
      if (left < p.fade) a = Math.max(0, left / p.fade);
      if (p.twinkle) a *= 0.55 + 0.45 * Math.sin(p.age * 0.03 + p.phase);
      if (a <= 0.01) continue;
      var s = p.size;
      if (p.shrink) s *= 0.45 + 0.55 * Math.max(0, 1 - p.age / p.life);
      if (s <= 0.2) continue;

      var cos = Math.cos(p.rot);
      var sin = Math.sin(p.rot);
      var sy = p.vt ? Math.cos(p.tilt) : 1;          // confetti "flip" in 3D
      if (Math.abs(sy) < 0.08) sy = sy < 0 ? -0.08 : 0.08;
      ctx.setTransform(dpr * cos, dpr * sin, -dpr * sin * sy, dpr * cos * sy, dpr * p.x, dpr * p.y);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      var r = s / 2;
      switch (p.shape) {
        case 'rect':
          ctx.fillRect(-r, -r * 0.55, s, s * 0.55);
          break;
        case 'square':
          ctx.fillRect(-r, -r, s, s);
          break;
        case 'star':
          pathStar(ctx, r);
          ctx.fill();
          break;
        case 'heart':
          pathHeart(ctx, r);
          ctx.fill();
          break;
        default:
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, 6.2832);
          ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ----- effects ----- */

  function confetti(opts) {
    try {
      opts = opts || {};
      if (!ensureCanvas()) return;
      var px = num(opts.x, null);
      var py = num(opts.y, null);
      var hasPoint = px !== null && py !== null;
      var x0 = hasPoint ? px : W / 2;
      var y0 = hasPoint ? py : -14;
      var n = scaled(opts.count == null ? 160 : opts.count, 1);
      var colors = colorsFrom(opts.colors);
      var k = clamp(Math.min(W, H * 1.4) / 900, 0.6, 1.5);
      for (var i = 0; i < n; i++) {
        var ang, sp;
        if (hasPoint) {
          ang = -Math.PI / 2 + rand(-1.05, 1.05);          // party popper: up and out, then falls
          sp = rand(6, 17) * k;
        } else {
          ang = Math.PI / 2 + rand(-1.3, 1.3);             // from the top center: spray down and out
          sp = rand(3, 16) * k;
        }
        var shapeRoll = Math.random();
        var shape = shapeRoll < 0.58 ? 'rect' : (shapeRoll < 0.82 ? 'circle' : 'star');
        add({
          x: x0 + rand(-8, 8), y: y0 + rand(-6, 6),
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          g: rand(0.13, 0.2), drag: rand(0.955, 0.975), maxVy: rand(2.6, 4.2),
          rot: rand(0, 6.283), vr: rand(-0.14, 0.14),
          tilt: rand(0, 6.283), vt: shape === 'circle' ? 0 : rand(0.06, 0.2),
          wob: rand(0, 6.283), wobS: rand(0.04, 0.09), wobA: rand(0.3, 1.3),
          size: shape === 'rect' ? rand(9, 15) : (shape === 'star' ? rand(10, 16) : rand(6, 10)),
          color: pick(colors), shape: shape,
          life: rand(4800, 7200), fade: 900,
          delay: hasPoint ? rand(0, 60) : rand(0, 260)
        });
      }
      startLoop();
    } catch (e) { /* never throw */ }
  }

  function burst(x, y, opts) {
    try {
      opts = opts || {};
      if (!ensureCanvas()) return;
      x = num(x, W / 2);
      y = num(y, H / 2);
      var n = scaled(opts.count == null ? 26 : opts.count, 4);
      var colors = colorsFrom(opts.colors);
      var speed = clamp(num(opts.speed, 1), 0.1, 5);
      var shapes = ['star', 'circle', 'square', 'heart'];
      var shape = opts.shape || 'star';
      for (var i = 0; i < n; i++) {
        var ang = (i / n) * Math.PI * 2 + rand(-0.25, 0.25);
        var sp = rand(2.8, 8.5) * speed;
        var shp = shape === 'mix' ? pick(shapes) : (shapes.indexOf(shape) >= 0 ? shape : 'star');
        add({
          x: x, y: y,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1.2 * speed,
          g: 0.16, drag: 0.915,
          rot: rand(0, 6.283), vr: rand(-0.22, 0.22),
          size: shp === 'circle' ? rand(6, 11) : rand(9, 16),
          color: pick(colors), shape: shp,
          life: rand(650, 1100), fade: 450, shrink: true
        });
      }
      // a few tiny glints for sparkle
      var glints = Math.round(n / 3);
      for (var j = 0; j < glints; j++) {
        var a2 = rand(0, 6.283);
        var s2 = rand(1.5, 5.5) * speed;
        add({
          x: x, y: y, vx: Math.cos(a2) * s2, vy: Math.sin(a2) * s2, g: 0.05, drag: 0.92,
          size: rand(2.5, 4.5), color: '#ffffff', shape: 'circle', life: rand(400, 750), fade: 300, twinkle: true
        });
      }
      startLoop();
    } catch (e) { /* never throw */ }
  }

  function explode(x, y, big) {
    var reduced = reducedMotion();
    var n = reduced ? 12 : (big ? 64 : 46);
    var main = pick(PALETTE.slice(0, 6));
    var second = pick(PALETTE.slice(0, 6));
    var out = [];
    var ringSpeed = rand(4.2, 6.2);
    for (var i = 0; i < n; i++) {
      var ang = (i / n) * Math.PI * 2 + rand(-0.08, 0.08);
      var sp = ringSpeed * rand(0.55, 1.05);
      out.push({
        x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        g: 0.07, drag: 0.955,
        rot: rand(0, 6.283), vr: rand(-0.15, 0.15),
        size: Math.random() < 0.25 ? rand(8, 12) : rand(4, 7),
        color: Math.random() < 0.7 ? main : (Math.random() < 0.5 ? second : '#ffffff'),
        shape: Math.random() < 0.25 ? 'star' : 'circle',
        life: rand(1000, 1600), fade: 700, twinkle: Math.random() < 0.4, shrink: true
      });
    }
    return out;
  }

  function launchRocket(tx, ty) {
    var reduced = reducedMotion();
    if (reduced) {
      var parts = explode(tx, ty, false);
      for (var i = 0; i < parts.length; i++) add(parts[i]);
      return;
    }
    var g = 0.22;
    var startY = H + 12;
    var dist = Math.max(80, startY - ty);
    var vy = -Math.sqrt(2 * g * dist);
    var sx = tx + rand(-50, 50);
    var frames = Math.abs(vy) / g;
    add({
      x: sx, y: startY, vx: (tx - sx) / frames, vy: vy, g: g, drag: 1,
      size: 5, color: '#fff7d6', shape: 'circle', life: 4000, fade: 100,
      rocket: true, trailColor: pick(['#fff3c4', '#ffe08a', '#ffffff']),
      onDeath: function (p, spawned) {
        var pieces = explode(p.x, p.y, Math.random() < 0.3);
        for (var j = 0; j < pieces.length; j++) spawned.push(pieces[j]);
      }
    });
  }

  function fireworks(durationMs) {
    try {
      if (!ensureCanvas()) return;
      var dur = clamp(num(durationMs, 2500), 300, 20000);
      var reduced = reducedMotion();
      var every = reduced ? 800 : 330;
      var shots = Math.max(1, Math.floor(dur / every));
      for (var i = 0; i < shots; i++) {
        (function (idx) {
          var delay = idx === 0 ? 0 : idx * every + rand(-80, 80);
          var id = setTimeout(function () {
            var k = timers.indexOf(id);
            if (k >= 0) timers.splice(k, 1);
            try {
              if (doc && doc.hidden) return;      // don't pile up while the tab is hidden
              if (!ensureCanvas()) return;
              launchRocket(rand(0.14, 0.86) * W, rand(0.12, 0.45) * H);
              if (!reduced && Math.random() < 0.3) launchRocket(rand(0.14, 0.86) * W, rand(0.12, 0.45) * H);
              startLoop();
            } catch (e) { /* ignore */ }
          }, Math.max(0, delay));
          timers.push(id);
        })(i);
      }
    } catch (e) { /* never throw */ }
  }

  function floatText(x, y, text, opts) {
    try {
      opts = opts || {};
      if (!doc || !doc.body || typeof doc.createElement !== 'function') return null;
      measure();
      var size = clamp(num(opts.size, 28), 8, 200);
      var color = typeof opts.color === 'string' && opts.color ? opts.color : '#ffb400';
      var stroke = typeof opts.stroke === 'string' && opts.stroke ? opts.stroke : '#ffffff';
      var reduced = reducedMotion();
      var px = clamp(num(x, W / 2), 24, Math.max(24, W - 24));
      var py = clamp(num(y, H / 2), size, Math.max(size, H - 8));

      var el = doc.createElement('span');
      el.className = 'fx-float-text';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = text == null ? '' : String(text);
      var w = Math.max(1.5, Math.round(size / 12 * 10) / 10);
      var outline = [];
      var dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.2], [0, 1.2], [-1.2, 0], [1.2, 0]];
      for (var i = 0; i < dirs.length; i++) {
        outline.push((dirs[i][0] * w).toFixed(1) + 'px ' + (dirs[i][1] * w).toFixed(1) + 'px 0 ' + stroke);
      }
      outline.push('0 ' + (w * 2).toFixed(1) + 'px ' + (w * 3).toFixed(1) + 'px rgba(45,42,74,.35)');
      var st = el.style;
      st.position = 'fixed';
      st.left = px + 'px';
      st.top = py + 'px';
      st.zIndex = '10000';
      st.pointerEvents = 'none';
      st.userSelect = 'none';
      st.webkitUserSelect = 'none';
      st.whiteSpace = 'nowrap';
      st.fontFamily = "var(--font, 'Nunito', 'Trebuchet MS', system-ui, sans-serif)";
      st.fontWeight = '900';
      st.fontSize = size + 'px';
      st.lineHeight = '1';
      st.color = color;
      st.textShadow = outline.join(', ');
      st.transform = 'translate(-50%, -50%)';
      st.willChange = 'transform, opacity';
      doc.body.appendChild(el);
      floats.push(el);

      var rise = reduced ? 22 : 60;
      var duration = reduced ? 1000 : 1350;
      var removed = false;
      var remove = function () {
        if (removed) return;
        removed = true;
        var k = floats.indexOf(el);
        if (k >= 0) floats.splice(k, 1);
        try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) { /* ignore */ }
      };

      var animated = false;
      if (typeof el.animate === 'function') {
        try {
          var frames = reduced
            ? [
              { transform: 'translate(-50%, -50%)', opacity: 0 },
              { transform: 'translate(-50%, -50%)', opacity: 1, offset: 0.15 },
              { transform: 'translate(-50%, calc(-50% - ' + rise + 'px))', opacity: 0 }
            ]
            : [
              { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
              { transform: 'translate(-50%, calc(-50% - 6px)) scale(1.18)', opacity: 1, offset: 0.14 },
              { transform: 'translate(-50%, calc(-50% - 14px)) scale(1)', opacity: 1, offset: 0.32 },
              { transform: 'translate(-50%, calc(-50% - ' + rise + 'px)) scale(0.95)', opacity: 0 }
            ];
          var anim = el.animate(frames, { duration: duration, easing: 'cubic-bezier(.22,.8,.3,1)', fill: 'forwards' });
          if (anim) {
            anim.onfinish = remove;
            anim.oncancel = remove;
            animated = true;
          }
        } catch (e) { animated = false; }
      }
      if (!animated) {
        st.opacity = '1';
        st.transition = 'transform ' + duration + 'ms cubic-bezier(.22,.8,.3,1), opacity ' + duration + 'ms ease-in';
        // next frame: move up and fade out
        raf(function () {
          raf(function () {
            st.transform = 'translate(-50%, calc(-50% - ' + rise + 'px))';
            st.opacity = '0';
          });
        });
      }
      setTimeout(remove, duration + 500);     // safety net
      return el;
    } catch (e) {
      return null;
    }
  }

  function clear() {
    try {
      for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      timers = [];
      particles = [];
      if (rafId) { caf(rafId); rafId = 0; }
      goIdle();
      var fl = floats.slice();
      floats = [];
      for (var j = 0; j < fl.length; j++) {
        try { if (fl[j].parentNode) fl[j].parentNode.removeChild(fl[j]); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }

  var FX = {
    PALETTE: PALETTE.slice(),
    confetti: confetti,
    burst: burst,
    floatText: floatText,
    fireworks: fireworks,
    clear: clear,
    get active() { return particles.length > 0 || timers.length > 0; },
    get reducedMotion() { return reducedMotion(); }
  };

  global.FX = FX;
  if (typeof module !== 'undefined' && module.exports) module.exports = FX;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
