/*
 * «Шахматное Королевство» — звуки и голос.
 *
 * Sound: все звуки синтезируются через WebAudio (никаких файлов). Мягкие, приятные, негромкие.
 * Voice: озвучка текста русским голосом через speechSynthesis (только если есть русский голос).
 *
 * Globals: Sound, Voice.
 */
(function (global) {
  'use strict';

  var nav = global.navigator || null;

  function nowMs() {
    try {
      if (global.performance && typeof global.performance.now === 'function') return global.performance.now();
    } catch (e) { /* ignore */ }
    return Date.now();
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ------------------------------------------------------------------------------------------------------------
   * User activation tracking (autoplay policies: AudioContext and speechSynthesis need a user gesture).
   * ---------------------------------------------------------------------------------------------------------- */

  var hadGesture = false;

  function gestureOK() {
    try {
      var ua = nav && nav.userActivation;
      if (ua && typeof ua.hasBeenActive === 'boolean') return !!(ua.isActive || ua.hasBeenActive);
    } catch (e) { /* ignore */ }
    return hadGesture;
  }

  function isTouchDevice() {
    try {
      return ('ontouchstart' in global) || !!(nav && nav.maxTouchPoints > 0);
    } catch (e) { return false; }
  }

  /* ============================================================================================================
   * SOUND
   * ========================================================================================================== */

  var AC = global.AudioContext || global.webkitAudioContext || null;

  var NAMES = ['move', 'capture', 'check', 'castle', 'promote', 'select', 'illegal', 'hint', 'star', 'win', 'lose',
    'draw', 'click', 'achievement', 'levelComplete', 'wrong', 'notify', 'whoosh', 'pop', 'tick'];

  var MASTER_GAIN = 0.5;
  var MAX_VOICES = 128;         // a new sound is skipped while this many sources are still playing
  var HARD_MAX_VOICES = 240;    // absolute safety cap on simultaneously scheduled sources
  var RATE_LIMIT_MS = 40;       // the same sound name is ignored within this window
  var RESUME_GRACE_MS = 350;    // a sound requested while the context was resuming is dropped if it would be late

  var ctx = null;
  var master = null;
  var noiseBuf = null;
  var T0 = 0;                   // base time of the sound currently being rendered
  var soundEnabled = true;
  var activeVoices = 0;
  var lastPlay = {};
  var silentPrimed = false;

  function setParam(param, value) {
    try { if (param) param.value = value; } catch (e) { /* ignore */ }
  }

  function makeNoiseBuffer(c) {
    try {
      var len = Math.max(1, Math.floor(c.sampleRate || 44100));
      var buf = c.createBuffer(1, len, c.sampleRate || 44100);
      var data = buf.getChannelData(0);
      for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    } catch (e) {
      return null;
    }
  }

  function createContext() {
    if (ctx && ctx.state !== 'closed') return ctx;
    ctx = null; master = null; noiseBuf = null;
    if (!AC) return null;
    var c = null;
    try {
      try { c = new AC({ latencyHint: 'interactive' }); } catch (e1) { c = new AC(); }
      var m = c.createGain();
      m.gain.value = MASTER_GAIN;
      var comp = null;
      if (typeof c.createDynamicsCompressor === 'function') {
        comp = c.createDynamicsCompressor();
        setParam(comp.threshold, -20);
        setParam(comp.knee, 18);
        setParam(comp.ratio, 3.5);
        setParam(comp.attack, 0.004);
        setParam(comp.release, 0.22);
      }
      if (comp) { m.connect(comp); comp.connect(c.destination); } else { m.connect(c.destination); }
      ctx = c;
      master = m;
      noiseBuf = makeNoiseBuffer(c);
    } catch (e) {
      try { if (c && typeof c.close === 'function') c.close(); } catch (e2) { /* ignore */ }
      ctx = null; master = null; noiseBuf = null;
    }
    return ctx;
  }

  // Old iOS needs a (silent) buffer to be started inside a user gesture before audio works.
  function primeSilent(c) {
    if (silentPrimed || !c) return;
    silentPrimed = true;
    try {
      var b = c.createBuffer(1, 1, c.sampleRate || 44100);
      var s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
      s.onended = function () { try { s.disconnect(); } catch (e) { /* ignore */ } };
    } catch (e) { /* ignore */ }
  }

  function resumeContext(c) {
    try {
      if (c && c.state !== 'running' && typeof c.resume === 'function') {
        var p = c.resume();
        if (p && typeof p.then === 'function') p.then(null, function () { /* ignore */ });
        return p;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* ----- envelope helper ----- */
  function envelope(param, t, attack, dur, vol, hold) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(vol, t + attack);
    if (hold > 0) param.setValueAtTime(vol, t + attack + (dur - attack) * Math.min(0.95, hold));
    param.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function connectOut(c, node, t, dur, o) {
    // optional stereo panning (with optional sweep), then master
    if ((o.pan || o.panTo) && typeof c.createStereoPanner === 'function') {
      var p = c.createStereoPanner();
      var p0 = Math.max(-1, Math.min(1, o.pan || 0));
      p.pan.setValueAtTime(p0, t);
      if (typeof o.panTo === 'number') p.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, o.panTo)), t + dur);
      node.connect(p);
      p.connect(master);
      return p;
    }
    node.connect(master);
    return null;
  }

  function applyFilter(c, f, t, spec) {
    f.type = spec.type || 'lowpass';
    f.frequency.setValueAtTime(Math.max(20, spec.freq || 1200), t);
    setParam(f.Q, spec.q != null ? spec.q : 0.8);
    if (spec.steps && spec.steps.length) {
      for (var i = 0; i < spec.steps.length; i++) {
        var st = spec.steps[i];
        f.frequency.exponentialRampToValueAtTime(Math.max(20, st[1]), t + Math.max(0.001, st[0]));
      }
    }
  }

  /**
   * tone(freq, dur, {type, vol, attack, hold, slideTo, slideTime, delay, vibrato, detune, filter, pan, panTo})
   *   vibrato: number (depth in cents, 6 Hz) or {rate, depth, delay}
   *   filter:  {type, freq, q, steps:[[timeOffset, freq], ...]}
   */
  function tone(freq, dur, o) {
    o = o || {};
    var c = ctx;
    if (!c || !master || activeVoices >= HARD_MAX_VOICES) return;
    var vol = o.vol != null ? o.vol : 0.3;
    if (!(vol > 0) || !(freq > 0)) return;
    var t = T0 + Math.max(0, o.delay || 0);
    var attack = Math.max(0.001, o.attack != null ? o.attack : 0.005);
    dur = Math.max(attack + 0.02, dur || 0.2);

    var osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.slideTo > 0) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + Math.min(dur, o.slideTime || dur));
    if (o.detune && osc.detune) osc.detune.setValueAtTime(o.detune, t);

    var g = c.createGain();
    envelope(g.gain, t, attack, dur, vol, o.hold || 0);

    var nodes = [osc, g];
    var head = osc;
    if (o.filter) {
      var f = c.createBiquadFilter();
      applyFilter(c, f, t, o.filter);
      head.connect(f);
      head = f;
      nodes.push(f);
    }
    head.connect(g);
    var pan = connectOut(c, g, t, dur, o);
    if (pan) nodes.push(pan);

    var lfo = null;
    if (o.vibrato && osc.detune) {
      var vib = typeof o.vibrato === 'number' ? { depth: o.vibrato } : o.vibrato;
      lfo = c.createOscillator();
      var lg = c.createGain();
      lfo.frequency.setValueAtTime(vib.rate || 6, t);
      var vStart = Math.min(t + dur - 0.01, t + Math.max(0, vib.delay || 0));
      lg.gain.setValueAtTime(0, t);
      lg.gain.setValueAtTime(0, vStart);
      lg.gain.linearRampToValueAtTime(vib.depth || 20, Math.min(t + dur, vStart + 0.08));
      lfo.connect(lg);
      lg.connect(osc.detune);
      nodes.push(lfo, lg);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }

    activeVoices++;
    var released = false;
    osc.onended = function () {
      if (released) return;
      released = true;
      activeVoices = Math.max(0, activeVoices - 1);
      for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) { /* ignore */ } }
    };
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /**
   * noise(dur, {vol, filterType, freq, freqTo, sweepTime, q, delay, attack, hold, pan, panTo})
   */
  function noise(dur, o) {
    o = o || {};
    var c = ctx;
    if (!c || !master || !noiseBuf || activeVoices >= HARD_MAX_VOICES) return;
    var vol = o.vol != null ? o.vol : 0.2;
    if (!(vol > 0)) return;
    var t = T0 + Math.max(0, o.delay || 0);
    var attack = Math.max(0.001, o.attack != null ? o.attack : 0.002);
    dur = Math.max(attack + 0.005, dur || 0.05);

    var src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var f = c.createBiquadFilter();
    f.type = o.filterType || 'bandpass';
    f.frequency.setValueAtTime(Math.max(20, o.freq || 1000), t);
    if (o.freqTo > 0) f.frequency.exponentialRampToValueAtTime(o.freqTo, t + Math.min(dur, o.sweepTime || dur));
    setParam(f.Q, o.q != null ? o.q : 1);
    var g = c.createGain();
    envelope(g.gain, t, attack, dur, vol, o.hold || 0);
    src.connect(f);
    f.connect(g);
    var pan = connectOut(c, g, t, dur, o);
    var nodes = [src, f, g];
    if (pan) nodes.push(pan);

    activeVoices++;
    var released = false;
    src.onended = function () {
      if (released) return;
      released = true;
      activeVoices = Math.max(0, activeVoices - 1);
      for (var i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) { /* ignore */ } }
    };
    var bufDur = noiseBuf.duration || 1;
    src.start(t, Math.random() * Math.max(0, bufDur - 0.1));
    src.stop(t + dur + 0.05);
  }

  /* ----- instrument helpers ----- */

  // soft wooden "tok" (piece put on the board)
  function tok(delay, mul, strength) {
    var m = mul || 1;
    var s = strength || 1;
    noise(0.05, { vol: 0.34 * s, filterType: 'bandpass', freq: 1500 * m, q: 2.4, delay: delay, attack: 0.001 });
    tone(220 * m, 0.11, { type: 'sine', vol: 0.5 * s, slideTo: 140 * m, slideTime: 0.08, attack: 0.002, delay: delay });
    // short woody body resonance (keeps the "tok" audible on small laptop / tablet speakers)
    tone(720 * m, 0.045, { type: 'sine', vol: 0.16 * s, slideTo: 540 * m, slideTime: 0.04, attack: 0.001, delay: delay });
  }

  // bell: sine with inharmonic partials
  function bell(freq, dur, vol, delay, pan) {
    var d = delay || 0;
    tone(freq, dur, { type: 'sine', vol: vol, attack: 0.003, delay: d, pan: pan });
    tone(freq * 2, dur * 0.55, { type: 'sine', vol: vol * 0.28, attack: 0.003, delay: d, pan: pan });
    tone(freq * 2.76, dur * 0.3, { type: 'sine', vol: vol * 0.12, attack: 0.002, delay: d, pan: pan });
    tone(freq * 5.4, dur * 0.14, { type: 'sine', vol: vol * 0.05, attack: 0.002, delay: d, pan: pan });
  }

  // bright, friendly "brass-ish" note for fanfares and jingles
  function horn(freq, dur, delay, vol, extra) {
    var e = extra || {};
    var v = vol || 0.18;
    tone(freq, dur, { type: 'triangle', vol: v, attack: 0.012, hold: 0.45, delay: delay, vibrato: e.vibrato });
    tone(freq, dur, {
      type: 'square', vol: v * 0.16, attack: 0.015, hold: 0.4, delay: delay,
      filter: { type: 'lowpass', freq: Math.min(6000, freq * 3), q: 0.7 }, vibrato: e.vibrato
    });
    tone(freq * 2, dur * 0.7, { type: 'sine', vol: v * 0.2, attack: 0.012, delay: delay });
  }

  var PENTA = [1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093, 2349.32, 2637.02];

  // twinkly sparkles: high pentatonic sine pings, gently panned
  function sparkle(delay, n, vol, step) {
    var d = delay || 0;
    var count = n || 5;
    var v = vol || 0.075;
    var st = step || 0.055;
    var idx = Math.floor(Math.random() * 3);
    for (var i = 0; i < count; i++) {
      idx = Math.min(PENTA.length - 1, idx + 1 + (Math.random() < 0.35 ? 1 : 0));
      if (i > 0 && idx >= PENTA.length - 1 && Math.random() < 0.5) idx = 2 + Math.floor(Math.random() * 3);
      var f = PENTA[idx];
      var at = d + i * st + rand(0, 0.015);
      var pan = rand(-0.6, 0.6);
      tone(f, rand(0.18, 0.3), { type: 'sine', vol: v * rand(0.75, 1.1), attack: 0.002, delay: at, pan: pan });
      tone(f * 2, 0.08, { type: 'sine', vol: v * 0.2, attack: 0.001, delay: at, pan: pan });
    }
  }

  function variation(amount) { return 1 + (Math.random() - 0.5) * (amount || 0.06); }

  /* ----- sound library ----- */

  var SOUNDS = {
    move: function () {
      tok(0, variation(0.06), 1);
    },

    capture: function () {
      var m = variation(0.05);
      noise(0.075, { vol: 0.5, filterType: 'bandpass', freq: 1800 * m, q: 1.6, attack: 0.001 });
      noise(0.025, { vol: 0.16, filterType: 'highpass', freq: 4200, q: 0.7, attack: 0.001 });
      tone(200 * m, 0.15, { type: 'sine', vol: 0.55, slideTo: 105 * m, slideTime: 0.11, attack: 0.002 });
      // the little "pop" with a pitch drop
      tone(980 * m, 0.1, { type: 'sine', vol: 0.2, slideTo: 300 * m, slideTime: 0.08, attack: 0.003, delay: 0.035 });
    },

    check: function () {
      tone(987.77, 0.17, { type: 'triangle', vol: 0.22, attack: 0.005, hold: 0.35 });
      tone(493.88, 0.15, { type: 'sine', vol: 0.08, attack: 0.005 });
      tone(1318.51, 0.3, { type: 'triangle', vol: 0.22, attack: 0.005, hold: 0.3, delay: 0.14 });
      tone(659.25, 0.26, { type: 'sine', vol: 0.08, attack: 0.005, delay: 0.14 });
    },

    castle: function () {
      tok(0, 1.02, 0.95);
      tok(0.09, 0.9, 0.9);
    },

    promote: function () {
      var arp = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      for (var i = 0; i < arp.length; i++) {
        var last = i === arp.length - 1;
        var d = i * 0.075;
        tone(arp[i], last ? 0.85 : 0.34, {
          type: 'triangle', vol: 0.15, attack: 0.006, hold: last ? 0.35 : 0.1, delay: d,
          vibrato: last ? { rate: 6, depth: 14, delay: 0.15 } : null
        });
        tone(arp[i] * 2, last ? 0.5 : 0.22, { type: 'sine', vol: 0.045, attack: 0.004, delay: d });
      }
      // shimmer
      noise(0.75, { vol: 0.04, filterType: 'highpass', freq: 6500, q: 0.7, attack: 0.25, delay: 0.18, pan: -0.3, panTo: 0.3 });
      sparkle(0.32, 7, 0.06, 0.06);
    },

    select: function () {
      tone(1150, 0.05, { type: 'sine', vol: 0.13, slideTo: 820, slideTime: 0.04, attack: 0.002 });
      noise(0.012, { vol: 0.05, filterType: 'highpass', freq: 4200, q: 0.7, attack: 0.001 });
    },

    illegal: function () {
      noise(0.03, { vol: 0.1, filterType: 'lowpass', freq: 500, q: 0.8, attack: 0.001 });
      tone(260, 0.22, { type: 'sine', vol: 0.3, slideTo: 170, slideTime: 0.16, attack: 0.004 });
      tone(520, 0.14, { type: 'triangle', vol: 0.09, slideTo: 340, slideTime: 0.12, attack: 0.004 });
    },

    hint: function () {
      sparkle(0, 6, 0.075, 0.06);
      tone(783.99, 0.5, { type: 'sine', vol: 0.05, attack: 0.05, hold: 0.3 });
    },

    star: function () {
      // coin "bling": two quick notes up
      tone(987.77, 0.085, { type: 'triangle', vol: 0.16, attack: 0.002, hold: 0.6 });
      tone(987.77, 0.085, { type: 'square', vol: 0.03, attack: 0.002, hold: 0.6, filter: { type: 'lowpass', freq: 3200, q: 0.7 } });
      tone(1318.51, 0.42, { type: 'triangle', vol: 0.16, attack: 0.002, hold: 0.15, delay: 0.08 });
      tone(1318.51, 0.3, { type: 'square', vol: 0.03, attack: 0.002, delay: 0.08, filter: { type: 'lowpass', freq: 3600, q: 0.7 } });
      sparkle(0.14, 4, 0.055, 0.05);
    },

    win: function () {
      // melody: C5 E5 G5 C6 . G5 C6 (+ chord)
      var mel = [[523.25, 0, 0.15], [659.25, 0.13, 0.15], [783.99, 0.26, 0.15], [1046.5, 0.39, 0.26],
        [783.99, 0.66, 0.13], [1046.5, 0.79, 0.85]];
      for (var i = 0; i < mel.length; i++) {
        var last = i === mel.length - 1;
        horn(mel[i][0], mel[i][2], mel[i][1], 0.17, last ? { vibrato: { rate: 5.5, depth: 12, delay: 0.2 } } : null);
      }
      // bass
      tone(130.81, 0.34, { type: 'sine', vol: 0.24, attack: 0.01, hold: 0.3 });
      tone(196, 0.3, { type: 'sine', vol: 0.22, attack: 0.01, hold: 0.3, delay: 0.39 });
      tone(130.81, 0.85, { type: 'sine', vol: 0.26, attack: 0.01, hold: 0.4, delay: 0.79 });
      // final chord
      var chord = [261.63, 329.63, 392, 523.25, 659.25];
      for (var j = 0; j < chord.length; j++) {
        tone(chord[j], 0.85, { type: 'triangle', vol: 0.055, attack: 0.03, hold: 0.45, delay: 0.79, vibrato: { rate: 5, depth: 6 } });
      }
      sparkle(0.9, 6, 0.06, 0.06);
    },

    lose: function () {
      // playful "wah-wah-wah-waaah" (trombone-ish, filter wah)
      var notes = [293.66, 277.18, 261.63, 246.94];
      for (var i = 0; i < notes.length; i++) {
        var last = i === notes.length - 1;
        var d = i * 0.3;
        var dur = last ? 1.0 : 0.28;
        var steps = last
          ? [[0.1, 1500], [0.32, 520], [0.5, 1300], [0.95, 380]]
          : [[0.09, 1500], [0.26, 480]];
        var common = {
          attack: 0.03, hold: last ? 0.55 : 0.5, delay: d,
          slideTo: last ? notes[i] * 0.93 : null, slideTime: last ? 0.95 : null,
          vibrato: last ? { rate: 6.5, depth: 38, delay: 0.25 } : null
        };
        tone(notes[i], dur, merge(common, { type: 'sawtooth', vol: 0.15, filter: { type: 'lowpass', freq: 380, q: 5, steps: steps } }));
        tone(notes[i], dur, merge(common, { type: 'triangle', vol: 0.1 }));
      }
    },

    draw: function () {
      var c1 = [349.23, 440, 523.25];
      var c2 = [329.63, 392, 523.25];
      for (var i = 0; i < 3; i++) {
        tone(c1[i], 0.6, { type: 'triangle', vol: 0.085, attack: 0.04, hold: 0.45 });
        tone(c1[i] * 2, 0.4, { type: 'sine', vol: 0.02, attack: 0.04 });
        tone(c2[i], 0.95, { type: 'triangle', vol: 0.085, attack: 0.04, hold: 0.45, delay: 0.5 });
        tone(c2[i] * 2, 0.6, { type: 'sine', vol: 0.02, attack: 0.04, delay: 0.5 });
      }
      tone(174.61, 0.6, { type: 'sine', vol: 0.15, attack: 0.03, hold: 0.4 });
      tone(130.81, 0.95, { type: 'sine', vol: 0.15, attack: 0.03, hold: 0.4, delay: 0.5 });
    },

    click: function () {
      tone(620, 0.07, { type: 'sine', vol: 0.2, slideTo: 980, slideTime: 0.035, attack: 0.002 });
      noise(0.01, { vol: 0.04, filterType: 'highpass', freq: 3200, q: 0.7, attack: 0.001 });
    },

    achievement: function () {
      var notes = [783.99, 987.77, 1174.66, 1567.98];
      for (var i = 0; i < notes.length; i++) {
        var last = i === notes.length - 1;
        bell(notes[i], last ? 1.1 : 0.6, last ? 0.15 : 0.12, i * 0.09, (i - 1.5) * 0.25);
      }
      var pad = [392, 493.88, 587.33];
      for (var j = 0; j < pad.length; j++) {
        tone(pad[j], 1.0, { type: 'triangle', vol: 0.045, attack: 0.08, hold: 0.4, delay: 0.1 });
      }
      sparkle(0.38, 6, 0.06, 0.055);
    },

    levelComplete: function () {
      var mel = [[523.25, 0, 0.12], [659.25, 0.1, 0.12], [783.99, 0.2, 0.14], [659.25, 0.34, 0.1],
        [783.99, 0.44, 0.1], [1046.5, 0.55, 0.55]];
      for (var i = 0; i < mel.length; i++) {
        var last = i === mel.length - 1;
        horn(mel[i][0], mel[i][2], mel[i][1], 0.15, last ? { vibrato: { rate: 6, depth: 10, delay: 0.15 } } : null);
      }
      tone(261.63, 0.3, { type: 'sine', vol: 0.2, attack: 0.01, hold: 0.3 });
      tone(196, 0.2, { type: 'sine', vol: 0.18, attack: 0.01, hold: 0.3, delay: 0.34 });
      tone(261.63, 0.55, { type: 'sine', vol: 0.22, attack: 0.01, hold: 0.35, delay: 0.55 });
      sparkle(0.62, 4, 0.05, 0.06);
    },

    wrong: function () {
      // gentle "uh-oh"
      tone(587.33, 0.17, { type: 'triangle', vol: 0.19, attack: 0.012, hold: 0.45, slideTo: 570 });
      tone(293.66, 0.15, { type: 'sine', vol: 0.07, attack: 0.012 });
      tone(440, 0.34, { type: 'triangle', vol: 0.19, attack: 0.015, hold: 0.35, slideTo: 415, delay: 0.19, vibrato: { rate: 5, depth: 10, delay: 0.1 } });
      tone(220, 0.3, { type: 'sine', vol: 0.07, attack: 0.015, delay: 0.19 });
    },

    notify: function () {
      bell(880, 1.0, 0.14, 0);
      bell(1318.51, 0.85, 0.08, 0.11);
    },

    whoosh: function () {
      noise(0.5, {
        vol: 0.28, filterType: 'bandpass', freq: 320, freqTo: 3200, sweepTime: 0.45, q: 1.3,
        attack: 0.2, pan: -0.5, panTo: 0.5
      });
    },

    pop: function () {
      var m = variation(0.08);
      tone(380 * m, 0.09, { type: 'sine', vol: 0.28, slideTo: 1400 * m, slideTime: 0.055, attack: 0.002 });
      noise(0.012, { vol: 0.05, filterType: 'bandpass', freq: 2500, q: 1, attack: 0.001, delay: 0.045 });
    },

    tick: function () {
      noise(0.012, { vol: 0.11, filterType: 'highpass', freq: 6000, q: 0.7, attack: 0.001 });
      tone(2400, 0.02, { type: 'sine', vol: 0.045, attack: 0.001 });
    }
  };

  function merge(a, b) {
    var r = {};
    var k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) r[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) r[k] = b[k];
    return r;
  }

  function render(name) {
    var fn = SOUNDS[name];
    if (!fn || !ctx || !master || activeVoices >= MAX_VOICES) return;   // too busy: skip the whole sound
    try {
      T0 = ctx.currentTime + 0.012;
      fn();
    } catch (e) { /* never throw from a sound */ }
  }

  var Sound = {
    NAMES: NAMES.slice(),

    setEnabled: function (on) {
      soundEnabled = !!on;
      try {
        if (!soundEnabled) {
          if (ctx && ctx.state === 'running' && typeof ctx.suspend === 'function') {
            var p = ctx.suspend();
            if (p && typeof p.then === 'function') p.then(null, function () { /* ignore */ });
          }
        } else {
          Sound.unlock();
        }
      } catch (e) { /* ignore */ }
    },

    unlock: function () {
      try {
        if (!soundEnabled || !AC) return;
        if (!ctx) {
          if (!gestureOK()) return;     // do not create the context before any user gesture (autoplay policy)
          createContext();
        }
        if (!ctx) return;
        resumeContext(ctx);
        primeSilent(ctx);
      } catch (e) { /* ignore */ }
    },

    play: function (name) {
      try {
        if (!soundEnabled || !AC || typeof name !== 'string' || !SOUNDS.hasOwnProperty(name)) return;
        var t = nowMs();
        if (lastPlay[name] != null && t - lastPlay[name] < RATE_LIMIT_MS) return;
        if (!ctx || ctx.state === 'closed') {
          if (!gestureOK()) return;
          createContext();
          if (!ctx) return;
        }
        lastPlay[name] = t;
        if (ctx.state === 'running') {
          render(name);
          return;
        }
        // suspended / interrupted: try to resume, then play only if it is still on time
        var p = resumeContext(ctx);
        if (p && typeof p.then === 'function') {
          p.then(function () {
            if (soundEnabled && ctx && ctx.state === 'running' && nowMs() - t < RESUME_GRACE_MS) render(name);
          }, function () { /* ignore */ });
        } else if (ctx.state === 'running') {
          render(name);
        }
      } catch (e) { /* never throw */ }
    },

    // for diagnostics
    get supported() { return !!AC; },
    get state() { return ctx ? ctx.state : 'none'; }
  };

  Object.defineProperty(Sound, 'enabled', {
    enumerable: true,
    get: function () { return soundEnabled; },
    set: function (v) { Sound.setEnabled(v); }
  });

  /* ============================================================================================================
   * VOICE
   * ========================================================================================================== */

  var synth = null;
  try { synth = global.speechSynthesis || null; } catch (e) { synth = null; }
  var Utter = global.SpeechSynthesisUtterance || null;

  var voiceEnabled = true;
  var ruVoice = null;
  var voicesLoaded = false;
  var voiceSeq = 0;
  var startTimer = null;
  var startQueue = [];
  var liveUtterances = [];      // keep references (Chrome may garbage-collect utterances and never fire onend)
  var waitingText = null;       // text requested before voices were loaded
  var waitingAt = 0;
  var preGestureText = null;    // text requested before the first user gesture (speech needs activation)
  var preGestureAt = 0;
  var readyCallbacks = [];
  var speechPrimed = false;

  var VOICE_RATE = 1.0;
  var VOICE_PITCH = 1.1;
  var WAIT_VOICES_MS = 4000;
  var PRE_GESTURE_MAX_AGE_MS = 15000;

  var FILES_RU = { a: 'а', b: 'бэ', c: 'цэ', d: 'дэ', e: 'е', f: 'эф', g: 'жэ', h: 'аш' };

  var RX_PICTO = null;
  var RX_EXTRA = null;
  try {
    RX_PICTO = new RegExp('\\p{Extended_Pictographic}', 'gu');
    RX_EXTRA = new RegExp('[\\u{1F1E6}-\\u{1F1FF}\\u{1F3FB}-\\u{1F3FF}\\u{E0020}-\\u{E007F}]', 'gu');
  } catch (e) {
    RX_PICTO = null;
    RX_EXTRA = null;
  }

  function cleanText(text) {
    if (text == null) return '';
    var s = String(text);
    // arrows between squares: "e2→e4" → "e2 на e4"
    s = s.replace(/\s*(?:→|⟶|⇒|➜|➔|➝|➞|➡|->|=>)\s*/g, ' на ');
    // emoji and pictographs
    if (RX_PICTO) {
      s = s.replace(RX_PICTO, ' ');
      s = s.replace(RX_EXTRA, '');
    } else {
      s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ');
      s = s.replace(/[←-⇿⌀-⏿①-⓿■-➿⤀-⥿⬀-⯿]/g, ' ');
    }
    // variation selectors, zero width joiner, keycap
    s = s.replace(/[︀-️‍⃣]/g, '');
    // chess glyphs, stars, bullets and markup-ish symbols
    s = s.replace(/[♔-♟★☆✦✧✨•·*_#~^|<>\[\]{}\\`]/g, ' ');
    // square names are pronounced the Russian chess way: "e4" → "е 4", "f3" → "эф 3"
    s = s.replace(/(^|[^A-Za-z0-9])([a-h])([1-8])(?![A-Za-z0-9])/g, function (m, pre, file, rank) {
      return pre + FILES_RU[file] + ' ' + rank;
    });
    // tidy spaces and punctuation
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/\s+([,.!?…:;)»])/g, '$1');
    s = s.replace(/([(«])\s+/g, '$1');
    s = s.replace(/^[\s,.;:!?)»-]+/, '');
    s = s.trim();
    if (!/[0-9A-Za-zЀ-ӿ]/.test(s)) return '';
    return s;
  }

  function splitChunks(text) {
    // Chrome can cut long utterances (≈15 s); speak sentence groups of ≤ 180 chars
    if (text.length <= 180) return [text];
    var parts = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
    var chunks = [];
    var cur = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if ((cur + p).length > 180 && cur) { chunks.push(cur.trim()); cur = ''; }
      if (p.length > 180) {
        var words = p.split(' ');
        for (var w = 0; w < words.length; w++) {
          if ((cur + ' ' + words[w]).length > 180 && cur) { chunks.push(cur.trim()); cur = ''; }
          cur += (cur ? ' ' : '') + words[w];
        }
      } else {
        cur += p;
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks;
  }

  function normLang(v) { return String((v && v.lang) || '').toLowerCase().replace('_', '-'); }

  function scoreVoice(v) {
    var lang = normLang(v);
    var name = String(v.name || '');
    var lname = name.toLowerCase();
    var isRu = lang.indexOf('ru') === 0 || /русск|russian/.test(lname) || /milena|милена/.test(lname);
    if (!isRu) return -1;
    if (lang && lang.indexOf('ru') !== 0) return -1;   // a named voice with a non-Russian language: never
    var s = 10;
    if (/milena|милена/.test(lname)) s += 100;
    if (/enhanced|premium|улучш|высок/.test(lname)) s += 25;
    if (/google/.test(lname)) s += 70;
    if (/katya|катя|irina|ирина|svetlana|светлана|dariya|дария|alena|алёна|алена/.test(lname)) s += 40;
    if (/yuri|юрий|pavel|павел|dmitry|дмитрий/.test(lname)) s += 20;
    if (lang === 'ru-ru') s += 5;
    if (v.localService) s += 4;
    if (v['default']) s += 2;
    return s;
  }

  function pickVoice() {
    if (!synth) return null;
    var list = [];
    try { list = synth.getVoices() || []; } catch (e) { list = []; }
    if (list.length) voicesLoaded = true;
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < list.length; i++) {
      var sc = scoreVoice(list[i]);
      if (sc > bestScore) { bestScore = sc; best = list[i]; }
    }
    if (best || voicesLoaded) ruVoice = best;
    return ruVoice;
  }

  function onVoicesChanged() {
    pickVoice();
    if (voicesLoaded) {
      var cbs = readyCallbacks;
      readyCallbacks = [];
      for (var i = 0; i < cbs.length; i++) { try { cbs[i](!!ruVoice); } catch (e) { /* ignore */ } }
      if (waitingText != null) {
        var txt = waitingText;
        var age = nowMs() - waitingAt;
        waitingText = null;
        if (age < WAIT_VOICES_MS) deliver(txt, true);
      }
    }
  }

  if (synth) {
    try {
      if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', onVoicesChanged);
      else {
        var prevHandler = synth.onvoiceschanged;
        synth.onvoiceschanged = function (ev) {
          if (typeof prevHandler === 'function') { try { prevHandler.call(synth, ev); } catch (e) { /* ignore */ } }
          onVoicesChanged();
        };
      }
    } catch (e) { /* ignore */ }
    pickVoice();
    // Safari sometimes never fires voiceschanged: poll a few times
    [150, 600, 1500, 3500].forEach(function (ms, i, all) {
      setTimeout(function () {
        if (!voicesLoaded || !ruVoice) onVoicesChanged();
        if (i === all.length - 1 && !voicesLoaded) {
          // no voices at all: settle as "unavailable" (a later voiceschanged can still bring one)
          voicesLoaded = true;
          onVoicesChanged();
        }
      }, ms);
    });
  }

  function forget(u) {
    var i = liveUtterances.indexOf(u);
    if (i >= 0) liveUtterances.splice(i, 1);
  }

  function speakChunks(chunks) {
    if (!synth || !Utter || !ruVoice) return;
    try { if (synth.paused) synth.resume(); } catch (e) { /* ignore */ }
    for (var i = 0; i < chunks.length; i++) {
      var u;
      try { u = new Utter(chunks[i]); } catch (e) { return; }
      try {
        u.voice = ruVoice;
        u.lang = ruVoice.lang || 'ru-RU';
        u.rate = VOICE_RATE;
        u.pitch = VOICE_PITCH;
        u.volume = 1;
      } catch (e) { /* ignore */ }
      (function (utt) {
        utt.onend = function () { forget(utt); };
        utt.onerror = function () { forget(utt); };
      })(u);
      liveUtterances.push(u);
      if (liveUtterances.length > 20) liveUtterances.shift();
      try { synth.speak(u); } catch (e) { forget(u); }
    }
  }

  function flushStart() {
    startTimer = null;
    var q = startQueue;
    startQueue = [];
    if (!voiceEnabled || !q.length) return;
    speakChunks(q);
  }

  // speak now if possible; before the first user gesture keep the latest phrase for the first tap
  function deliver(clean, interrupt) {
    if (!voiceEnabled || !ruVoice) return;          // never read Russian with a non-Russian voice
    if (!gestureOK()) {
      preGestureText = clean;
      preGestureAt = nowMs();
      return;
    }
    speakClean(clean, interrupt);
  }

  function speakClean(clean, interrupt) {
    if (!synth || !Utter || !ruVoice || !voiceEnabled) return;
    var chunks = splitChunks(clean);
    if (interrupt) {
      var busy = false;
      try { busy = !!(synth.speaking || synth.pending); } catch (e) { busy = false; }
      if (startTimer) { clearTimeout(startTimer); startTimer = null; busy = true; }
      startQueue = [];
      if (busy) {
        // Safari drops an utterance spoken right after cancel(): cancel, then wait a moment
        try { synth.cancel(); } catch (e) { /* ignore */ }
        liveUtterances = [];
        startQueue = chunks;
        startTimer = setTimeout(flushStart, 110);
        return;
      }
      speakChunks(chunks);
    } else if (startTimer) {
      startQueue = startQueue.concat(chunks);
    } else {
      speakChunks(chunks);
    }
  }

  function primeSpeech() {
    // iOS/iPadOS: the first utterance must be started inside a user gesture
    if (speechPrimed || !synth || !Utter || !isTouchDevice() || !gestureOK()) return;
    speechPrimed = true;
    try {
      var u = new Utter(' ');
      u.volume = 0;
      if (ruVoice) { u.voice = ruVoice; u.lang = ruVoice.lang || 'ru-RU'; }
      synth.speak(u);
    } catch (e) { /* ignore */ }
  }

  var Voice = {
    setEnabled: function (on) {
      voiceEnabled = !!on;
      if (!voiceEnabled) Voice.stop();
    },

    available: function () {
      if (!synth || !Utter) return false;
      if (!ruVoice) pickVoice();
      return !!ruVoice;
    },

    // cb(available) once the voice list is known (immediately if it already is)
    ready: function (cb) {
      if (typeof cb !== 'function') return;
      if (!synth || !Utter) { try { cb(false); } catch (e) { /* ignore */ } return; }
      if (!voicesLoaded) pickVoice();
      if (voicesLoaded) { try { cb(!!ruVoice); } catch (e) { /* ignore */ } return; }
      readyCallbacks.push(cb);
    },

    say: function (text, opts) {
      try {
        if (!voiceEnabled || !synth || !Utter) return;
        var clean = cleanText(text);
        if (!clean) return;
        var interrupt = !(opts && opts.interrupt === false);
        voiceSeq++;
        if (!voicesLoaded || !ruVoice) pickVoice();
        if (!voicesLoaded) {
          // voices still loading (Chrome): remember the latest phrase and speak it when they arrive
          waitingText = clean;
          waitingAt = nowMs();
          return;
        }
        deliver(clean, interrupt);
      } catch (e) { /* never throw */ }
    },

    stop: function () {
      try {
        voiceSeq++;
        waitingText = null;
        preGestureText = null;
        if (startTimer) { clearTimeout(startTimer); startTimer = null; }
        startQueue = [];
        liveUtterances = [];
        if (synth) synth.cancel();
      } catch (e) { /* ignore */ }
    },

    // for tests / other modules: the text exactly as it would be spoken
    clean: cleanText,

    get voiceName() { return ruVoice ? String(ruVoice.name || '') : ''; },
    get speaking() {
      try { return !!(synth && (synth.speaking || synth.pending)) || !!startTimer; } catch (e) { return false; }
    }
  };

  Object.defineProperty(Voice, 'enabled', {
    enumerable: true,
    get: function () { return voiceEnabled; },
    set: function (v) { Voice.setEnabled(v); }
  });

  /* ============================================================================================================
   * Gesture listeners: unlock audio / speech as early as possible.
   * ========================================================================================================== */

  function onGesture(ev) {
    var type = ev && ev.type;
    if (type === 'keydown' && (ev.key === 'Escape' || ev.key === 'Tab' || ev.ctrlKey || ev.metaKey || ev.altKey)) return;
    hadGesture = true;
    if (soundEnabled) Sound.unlock();
    // the end of a gesture (tap / click / key): the app's own handlers for it run right after this listener
    if (type === 'pointerdown' || type === 'mousedown') return;
    if (voiceEnabled) primeSpeech();
    if (preGestureText != null && gestureOK()) {
      var seqAtGesture = voiceSeq;
      var txt = preGestureText;
      var age = nowMs() - preGestureAt;
      preGestureText = null;
      if (age < PRE_GESTURE_MAX_AGE_MS) {
        setTimeout(function () {
          // only if the app did not say something new in response to this very tap
          if (voiceSeq === seqAtGesture && voiceEnabled && ruVoice) speakClean(txt, true);
        }, 80);
      }
    }
  }

  try {
    if (typeof global.addEventListener === 'function' && global.document) {
      ['pointerdown', 'pointerup', 'mousedown', 'touchend', 'keydown', 'click'].forEach(function (type) {
        global.addEventListener(type, onGesture, { capture: true, passive: true });
      });
      // Chrome keeps speaking queued utterances after reload: stop on page hide
      global.addEventListener('pagehide', function () {
        try { if (synth) synth.cancel(); } catch (e) { /* ignore */ }
      });
    }
  } catch (e) { /* ignore */ }

  global.Sound = Sound;
  global.Voice = Voice;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Sound: Sound, Voice: Voice };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
