/* TUMBLER — audio.js
 * Tiny WebAudio synth so the repo ships no audio files. Every sound is a few
 * oscillator blips: mechanical clicks, a dial tick, the vault-crack thunk,
 * an alarm buzz, and a loot chime. Honours a global on/off toggle.
 */
(function () {
  "use strict";
  var TUMBLER = (window.TUMBLER = window.TUMBLER || {});
  var ctx = null;
  var enabled = false;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function blip(opts) {
    if (!enabled) return;
    var c = ensure();
    if (!c) return;
    var t0 = c.currentTime + (opts.delay || 0);
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(opts.f0, t0);
    if (opts.f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.f1), t0 + opts.dur);
    var peak = opts.gain == null ? 0.08 : opts.gain;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
  }

  function noise(dur, gain) {
    if (!enabled) return;
    var c = ensure();
    if (!c) return;
    var frames = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, frames, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    var src = c.createBufferSource();
    src.buffer = buf;
    var g = c.createGain();
    g.gain.value = gain == null ? 0.12 : gain;
    var hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    src.connect(hp).connect(g).connect(c.destination);
    src.start();
  }

  /* ---- ambient drone: a subtle, on-theme "vault room" pad. Tied to the
   *      sound toggle; fades in/out so there are no clicks. No audio files. ---- */
  var ambient = null;
  function startAmbient() {
    if (!enabled || ambient) return;
    var c = ensure();
    if (!c) return;
    var t = c.currentTime;
    var master = c.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.exponentialRampToValueAtTime(0.05, t + 3); // slow fade-in
    var lp = c.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 300; lp.Q.value = 0.6;
    lp.connect(master); master.connect(c.destination);
    var oscs = [];
    [[55, "triangle", 0.32], [82.5, "triangle", 0.3], [110, "sine", 0.14]].forEach(function (d) {
      var o = c.createOscillator(); o.type = d[1]; o.frequency.value = d[0];
      var g = c.createGain(); g.gain.value = d[2];
      o.connect(g).connect(lp); o.start(); oscs.push(o);
    });
    var lfo = c.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.05;
    var lfoG = c.createGain(); lfoG.gain.value = 110;
    lfo.connect(lfoG).connect(lp.frequency); lfo.start(); // slow movement on the filter
    ambient = { master: master, oscs: oscs, lfo: lfo };
  }
  function stopAmbient() {
    if (!ambient || !ctx) return;
    var a = ambient; ambient = null;
    var t = ctx.currentTime;
    try {
      a.master.gain.cancelScheduledValues(t);
      a.master.gain.setValueAtTime(Math.max(0.0001, a.master.gain.value), t);
      a.master.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    } catch (e) {}
    setTimeout(function () { try { a.oscs.forEach(function (o) { o.stop(); }); a.lfo.stop(); } catch (e) {} }, 900);
  }

  var Audio = {
    setEnabled: function (v) {
      enabled = !!v;
      // don't create the AudioContext here — wait for the first real sound,
      // which always follows a user gesture (avoids the autoplay warning).
      if (!enabled) stopAmbient();
    },
    startAmbient: startAmbient,
    stopAmbient: stopAmbient,
    isEnabled: function () {
      return enabled;
    },
    key: function () {
      blip({ type: "square", f0: 220, f1: 180, dur: 0.04, gain: 0.04 });
    },
    tick: function () {
      blip({ type: "triangle", f0: 880, f1: 1320, dur: 0.06, gain: 0.06 });
    },
    near: function () {
      blip({ type: "triangle", f0: 560, dur: 0.07, gain: 0.05 });
    },
    error: function () {
      blip({ type: "sawtooth", f0: 150, f1: 90, dur: 0.18, gain: 0.06 });
    },
    crack: function () {
      // ratcheting dial + a low thunk
      for (var i = 0; i < 5; i++) blip({ type: "square", f0: 300 + i * 60, dur: 0.05, gain: 0.05, delay: i * 0.05 });
      blip({ type: "sine", f0: 130, f1: 60, dur: 0.5, gain: 0.12, delay: 0.28 });
      noise(0.25, 0.08);
    },
    loot: function () {
      blip({ type: "sine", f0: 740, dur: 0.08, gain: 0.06 });
      blip({ type: "sine", f0: 988, dur: 0.1, gain: 0.06, delay: 0.06 });
      blip({ type: "sine", f0: 1319, dur: 0.12, gain: 0.05, delay: 0.13 });
    },
    alarm: function () {
      blip({ type: "sawtooth", f0: 660, f1: 440, dur: 0.22, gain: 0.07 });
      blip({ type: "sawtooth", f0: 660, f1: 440, dur: 0.22, gain: 0.07, delay: 0.26 });
    },
    bust: function () {
      blip({ type: "sawtooth", f0: 300, f1: 70, dur: 0.6, gain: 0.1 });
      noise(0.4, 0.1);
    },
    whoosh: function () {
      blip({ type: "sine", f0: 200, f1: 600, dur: 0.18, gain: 0.04 });
    },
    sabotage: function () {
      blip({ type: "sawtooth", f0: 420, f1: 120, dur: 0.3, gain: 0.07 });
    },
  };

  TUMBLER.Audio = Audio;
})();
