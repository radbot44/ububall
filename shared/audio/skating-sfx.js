/* Continuous skating, spin, puck-slide, carve, slipstream, and spin-strike synthesis. */
'use strict';
const { getPan, routePanner, getAudioContext, sharedChains, createMasterChain, motionLoops, activeMotionContexts, extendLoopTimer, isOfflineContext, interpRamp, currentLoopGain } = require('./buses.js');
const { strike, grainNoise, noiseGrain, smoothNoise } = require('./synth.js');
function ubuMoveParams(speed, mass, radius, slot, volume) {
  const s = Math.min(1, Math.max(0, (speed - 28) / 620));
  const sizeRatio = Math.max(0.6, Math.min(2.4, (radius || 25) / 25));
  const massRatio = Math.max(0.75, Math.min(2.2, (mass || 3) / 3));
  const slotDetune = 1 + (((slot | 0) % 6) - 2.5) * 0.011;
  const freq = (162 + 64 * s) * Math.pow(sizeRatio, -0.58) * Math.pow(massRatio, -0.22) * slotDetune;
  const wobbleHz = (5.2 + 5.0 * s) * Math.pow(sizeRatio, -0.42);
  const wobbleDepth = freq * (0.032 + 0.024 * s) * Math.pow(massRatio, 0.55) * Math.pow(sizeRatio, 0.22);
  const cutoff = Math.min(2200, freq * (1.85 + 1.25 * Math.min(1.65, massRatio) + 0.85 * s));
  const q = 1.15 + 0.85 * Math.max(0, Math.min(1.2, massRatio - 0.75));
  const weightScale = 0.86 + 0.18 * Math.min(1.8, (massRatio + sizeRatio) * 0.5);
  const level = (0.018 + 0.036 * Math.pow(s, 0.85)) * weightScale * Math.max(0, Math.min(1.5, volume));
  return { freq, wobbleHz, wobbleDepth, cutoff, q, level };
}

function playUbuMove(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return { stop() {} };
  const speed = Number(options.speed ?? 420);
  const mass = Number(options.mass ?? 3);
  const radius = Number(options.radius ?? 25);
  const slot = options.slot ?? (typeof options.id === 'number' ? options.id : 0);
  const volume = options.volume ?? 1;

  if (options.id !== undefined && options.id !== null) {
    const loopKey = 'move:' + options.id;
    let map = motionLoops.get(ctx);
    if (speed <= 28 || volume <= 0) {
      map?.get(loopKey)?.stop();
      return { stop() {} };
    }
    if (!map) { map = new Map(); motionLoops.set(ctx, map); }
    activeMotionContexts.add(ctx);
    const now = ctx.currentTime;
    const p = ubuMoveParams(speed, mass, radius, slot, volume);
    let entry = map.get(loopKey);
    if (!entry || entry.stopped) {
      const cleanup = [], master = createMasterChain(ctx, cleanup);
      const osc = ctx.createOscillator(), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
      const filter = ctx.createBiquadFilter(), outGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(p.freq, now);
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(p.wobbleHz, now);
      lfoGain.gain.setValueAtTime(p.wobbleDepth, now);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(p.cutoff, now);
      filter.Q.setValueAtTime(p.q, now);
      outGain.gain.setValueAtTime(0, now);
      let panner = null;
      const initialPan = getPan(options);
      if (ctx.createStereoPanner) {
        panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(initialPan, now);
        lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
        osc.connect(filter); filter.connect(outGain); outGain.connect(panner); panner.connect(master);
        cleanup.push(panner);
      } else {
        lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
        osc.connect(filter); filter.connect(outGain); outGain.connect(master);
      }
      osc.onended = () => {
        for (const n of [osc, lfo, lfoGain, filter, outGain, ...cleanup]) { try { n.disconnect(); } catch {} }
      };
      osc.start(now); lfo.start(now);
      entry = {
        stopped: false, timer: null, sources: [osc, lfo], osc, lfo, lfoGain, filter, outGain, panner,
        freq0: p.freq, freq: p.freq, wobbleHz0: p.wobbleHz, wobbleHz: p.wobbleHz,
        wobbleDepth0: p.wobbleDepth, wobbleDepth: p.wobbleDepth, cutoff0: p.cutoff, cutoff: p.cutoff,
        paramT0: now, paramT1: now,
        t0: now, g0: 0, tPeak: now, gPeak: 0, tZero: now,
        stop() {
          if (entry.stopped) return;
          entry.stopped = true;
          if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
          if (entry.panner) { try { entry.panner.disconnect(); } catch {} }
          map.delete(loopKey);
          if (!map.size) activeMotionContexts.delete(ctx);
          try {
            const t = ctx.currentTime, g = currentLoopGain(entry, t);
            outGain.gain.cancelScheduledValues(t);
            outGain.gain.setValueAtTime(g, t);
            outGain.gain.linearRampToValueAtTime(0, t + 0.025);
            osc.stop(t + 0.03); lfo.stop(t + 0.03);
          } catch {}
        }
      };
      map.set(loopKey, entry);
    } else {
      const rampEnd = now + 0.04;
      const curFreq = interpRamp(entry.paramT0, entry.freq0, entry.paramT1, entry.freq, now);
      const curWobble = interpRamp(entry.paramT0, entry.wobbleHz0, entry.paramT1, entry.wobbleHz, now);
      const curDepth = interpRamp(entry.paramT0, entry.wobbleDepth0, entry.paramT1, entry.wobbleDepth, now);
      const curCutoff = interpRamp(entry.paramT0, entry.cutoff0, entry.paramT1, entry.cutoff, now);
      if (entry.panner) {
        const curPan = getPan(options);
        entry.panner.pan.cancelScheduledValues(now);
        entry.panner.pan.setValueAtTime(curPan, now);
      }
      entry.osc.frequency.cancelScheduledValues(now);
      entry.osc.frequency.setValueAtTime(curFreq, now);
      entry.osc.frequency.linearRampToValueAtTime(p.freq, rampEnd);
      entry.lfo.frequency.cancelScheduledValues(now);
      entry.lfo.frequency.setValueAtTime(curWobble, now);
      entry.lfo.frequency.linearRampToValueAtTime(p.wobbleHz, rampEnd);
      entry.lfoGain.gain.cancelScheduledValues(now);
      entry.lfoGain.gain.setValueAtTime(curDepth, now);
      entry.lfoGain.gain.linearRampToValueAtTime(p.wobbleDepth, rampEnd);
      entry.filter.frequency.cancelScheduledValues(now);
      entry.filter.frequency.setValueAtTime(curCutoff, now);
      entry.filter.frequency.linearRampToValueAtTime(p.cutoff, rampEnd);
      entry.filter.Q.setValueAtTime(p.q, now);
      entry.freq0 = curFreq; entry.freq = p.freq;
      entry.wobbleHz0 = curWobble; entry.wobbleHz = p.wobbleHz;
      entry.wobbleDepth0 = curDepth; entry.wobbleDepth = p.wobbleDepth;
      entry.cutoff0 = curCutoff; entry.cutoff = p.cutoff;
      entry.paramT0 = now; entry.paramT1 = rampEnd;
    }
    const cur = currentLoopGain(entry, now), tPeak = now + 0.035, tZero = now + 0.16;
    entry.outGain.gain.cancelScheduledValues(now);
    entry.outGain.gain.setValueAtTime(cur, now);
    entry.outGain.gain.linearRampToValueAtTime(p.level, tPeak);
    entry.outGain.gain.linearRampToValueAtTime(0, tZero);
    entry.t0 = now; entry.g0 = cur; entry.tPeak = tPeak; entry.gPeak = p.level; entry.tZero = tZero;
    if (!isOfflineContext(ctx)) {
      extendLoopTimer(entry, 220);
    }
    return { stop: () => entry.stop() };
  }

  // Standalone one-shot audition (e.g. Effects Demo button or direct test)
  const duration = Math.max(0.18, Math.min(2.5, Number(options.duration) || 0.85));
  const master = createMasterChain(ctx, null, duration + 0.06);
  const now = ctx.currentTime;
  const pLow = ubuMoveParams(Math.max(90, speed * 0.55), mass, radius, slot, volume);
  const pPeak = ubuMoveParams(speed, mass, radius, slot, volume);
  const osc = ctx.createOscillator(), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
  const filter = ctx.createBiquadFilter(), outGain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(pLow.freq, now);
  osc.frequency.linearRampToValueAtTime(pPeak.freq, now + duration * 0.45);
  osc.frequency.linearRampToValueAtTime(pLow.freq, now + duration);
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(pLow.wobbleHz, now);
  lfo.frequency.linearRampToValueAtTime(pPeak.wobbleHz, now + duration * 0.45);
  lfo.frequency.linearRampToValueAtTime(pLow.wobbleHz, now + duration);
  lfoGain.gain.setValueAtTime(pPeak.wobbleDepth, now);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(pPeak.cutoff, now);
  filter.Q.setValueAtTime(pPeak.q, now);
  // Audition plays gently at the same subtle scale as in-game movement
  const dest = routePanner(ctx, master, options);
  const previewBoost = options.preview ? 1.6 : 1.3;
  outGain.gain.setValueAtTime(0.0001, now);
  outGain.gain.linearRampToValueAtTime(Math.min(0.135, pPeak.level * previewBoost), now + Math.min(0.08, duration * 0.2));
  outGain.gain.linearRampToValueAtTime(Math.min(0.1125, pPeak.level * previewBoost * 0.8), now + duration * 0.72);
  outGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  lfo.connect(lfoGain); lfoGain.connect(osc.frequency);
  osc.connect(filter); filter.connect(outGain); outGain.connect(dest);
  osc.start(now); lfo.start(now);
  osc.stop(now + duration + 0.02); lfo.stop(now + duration + 0.02);
  return {
    stop() {
      try {
        const t = ctx.currentTime;
        outGain.gain.cancelScheduledValues(t);
        outGain.gain.setValueAtTime(Math.max(0.0001, outGain.gain.value || 0.0001), t);
        outGain.gain.linearRampToValueAtTime(0.0001, t + 0.015);
        osc.stop(t + 0.02); lfo.stop(t + 0.02);
      } catch {}
    }
  };
}

// Spinning ubu wobble: continuous loop modulated by spin speed |omega|, inaudible below threshold
// and rising smoothly from near-silence at low spin to a faster, louder gyroscopic wobble at high spin.
function ubuSpinParams(omega, radius, slot, volume) {
  const absSpin = Math.abs(omega || 0);
  const p = Math.min(1, Math.max(0, (absSpin - 2.8) / 15.5));
  const sizeRatio = Math.max(0.6, Math.min(2.4, (radius || 25) / 25));
  const slotDetune = 1 + (((slot | 0) % 6) - 2.5) * 0.009;
  const freq = (242 + 158 * Math.pow(p, 0.95)) * Math.pow(sizeRatio, -0.45) * slotDetune;
  const swirlHz = (3.2 + 12.8 * Math.pow(p, 1.1)) * Math.pow(sizeRatio, -0.35);
  const swirlDepth = freq * (0.018 + 0.052 * Math.pow(p, 1.05));
  const bandFreq = Math.min(2800, freq * (1.15 + 0.85 * p));
  const level = (0.0008 + 0.029 * Math.pow(p, 1.35)) * Math.max(0, Math.min(1.5, volume));
  return { freq, swirlHz, swirlDepth, bandFreq, level };
}

function playSpin(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return { stop() {} };
  const omega = Number(options.omega ?? 14);
  const radius = Number(options.radius ?? 25);
  const slot = options.slot ?? (typeof options.id === 'number' ? options.id : 0);
  const volume = options.volume ?? 1;

  if (options.id !== undefined && options.id !== null) {
    const loopKey = 'spin:' + options.id;
    let map = motionLoops.get(ctx);
    if (Math.abs(omega) < 2.8 || volume <= 0) {
      map?.get(loopKey)?.stop();
      return { stop() {} };
    }
    if (!map) { map = new Map(); motionLoops.set(ctx, map); }
    activeMotionContexts.add(ctx);
    const now = ctx.currentTime;
    const p = ubuSpinParams(omega, radius, slot, volume);
    let entry = map.get(loopKey);
    const isNew = !entry || entry.stopped;
    if (isNew) {
      const cleanup = [], master = createMasterChain(ctx, cleanup);
      const osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator(), g2 = ctx.createGain();
      const lfo = ctx.createOscillator(), lfoGain = ctx.createGain(), filterLfo = ctx.createGain();
      const filter = ctx.createBiquadFilter(), outGain = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(p.freq, now);
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(p.freq * 1.5, now);
      g2.gain.setValueAtTime(0.24, now);
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(p.swirlHz, now);
      lfoGain.gain.setValueAtTime(p.swirlDepth, now);
      filterLfo.gain.setValueAtTime(p.freq * 0.24, now);
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(p.bandFreq, now);
      filter.Q.setValueAtTime(0.95, now);
      outGain.gain.setValueAtTime(0, now);
      let panner = null;
      const initialPan = getPan(options);
      if (ctx.createStereoPanner) {
        panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(initialPan, now);
        lfo.connect(lfoGain); lfoGain.connect(osc1.frequency); lfoGain.connect(osc2.frequency);
        lfo.connect(filterLfo); filterLfo.connect(filter.frequency);
        osc1.connect(filter); osc2.connect(g2); g2.connect(filter);
        filter.connect(outGain); outGain.connect(panner); panner.connect(master);
        cleanup.push(panner);
      } else {
        lfo.connect(lfoGain); lfoGain.connect(osc1.frequency); lfoGain.connect(osc2.frequency);
        lfo.connect(filterLfo); filterLfo.connect(filter.frequency);
        osc1.connect(filter); osc2.connect(g2); g2.connect(filter);
        filter.connect(outGain); outGain.connect(master);
      }
      osc1.onended = () => {
        for (const n of [osc1, osc2, g2, lfo, lfoGain, filterLfo, filter, outGain, ...cleanup]) { try { n.disconnect(); } catch {} }
      };
      osc1.start(now); osc2.start(now); lfo.start(now);
      entry = {
        stopped: false, timer: null, sources: [osc1, osc2, lfo], osc1, osc2, lfo, lfoGain, filterLfo, filter, outGain, panner,
        freq0: p.freq, freq: p.freq, swirlHz0: p.swirlHz, swirlHz: p.swirlHz,
        swirlDepth0: p.swirlDepth, swirlDepth: p.swirlDepth, bandFreq0: p.bandFreq, bandFreq: p.bandFreq,
        paramT0: now, paramT1: now,
        t0: now, g0: 0, tPeak: now, gPeak: 0, tZero: now,
        stop() {
          if (entry.stopped) return;
          entry.stopped = true;
          if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
          if (entry.panner) { try { entry.panner.disconnect(); } catch {} }
          map.delete(loopKey);
          if (!map.size) activeMotionContexts.delete(ctx);
          try {
            const t = ctx.currentTime, g = currentLoopGain(entry, t);
            outGain.gain.cancelScheduledValues(t);
            outGain.gain.setValueAtTime(g, t);
            outGain.gain.linearRampToValueAtTime(0, t + 0.025);
            osc1.stop(t + 0.03); osc2.stop(t + 0.03); lfo.stop(t + 0.03);
          } catch {}
        }
      };
      map.set(loopKey, entry);
    } else {
      const rampEnd = now + 0.04;
      const curFreq = interpRamp(entry.paramT0, entry.freq0, entry.paramT1, entry.freq, now);
      const curSwirl = interpRamp(entry.paramT0, entry.swirlHz0, entry.paramT1, entry.swirlHz, now);
      const curDepth = interpRamp(entry.paramT0, entry.swirlDepth0, entry.paramT1, entry.swirlDepth, now);
      const curBand = interpRamp(entry.paramT0, entry.bandFreq0, entry.paramT1, entry.bandFreq, now);
      if (entry.panner) {
        const curPan = getPan(options);
        entry.panner.pan.cancelScheduledValues(now);
        entry.panner.pan.setValueAtTime(curPan, now);
      }
      entry.osc1.frequency.cancelScheduledValues(now);
      entry.osc1.frequency.setValueAtTime(curFreq, now);
      entry.osc1.frequency.linearRampToValueAtTime(p.freq, rampEnd);
      entry.osc2.frequency.cancelScheduledValues(now);
      entry.osc2.frequency.setValueAtTime(curFreq * 1.5, now);
      entry.osc2.frequency.linearRampToValueAtTime(p.freq * 1.5, rampEnd);
      entry.lfo.frequency.cancelScheduledValues(now);
      entry.lfo.frequency.setValueAtTime(curSwirl, now);
      entry.lfo.frequency.linearRampToValueAtTime(p.swirlHz, rampEnd);
      entry.lfoGain.gain.cancelScheduledValues(now);
      entry.lfoGain.gain.setValueAtTime(curDepth, now);
      entry.lfoGain.gain.linearRampToValueAtTime(p.swirlDepth, rampEnd);
      entry.filterLfo.gain.setValueAtTime(p.freq * 0.24, now);
      entry.filter.frequency.cancelScheduledValues(now);
      entry.filter.frequency.setValueAtTime(curBand, now);
      entry.filter.frequency.linearRampToValueAtTime(p.bandFreq, rampEnd);
      entry.freq0 = curFreq; entry.freq = p.freq;
      entry.swirlHz0 = curSwirl; entry.swirlHz = p.swirlHz;
      entry.swirlDepth0 = curDepth; entry.swirlDepth = p.swirlDepth;
      entry.bandFreq0 = curBand; entry.bandFreq = p.bandFreq;
      entry.paramT0 = now; entry.paramT1 = rampEnd;
    }
    const cur = currentLoopGain(entry, now), tPeak = now + (isNew ? 0.075 : 0.035), tZero = now + 0.16;
    entry.outGain.gain.cancelScheduledValues(now);
    entry.outGain.gain.setValueAtTime(cur, now);
    entry.outGain.gain.linearRampToValueAtTime(p.level, tPeak);
    entry.outGain.gain.linearRampToValueAtTime(0, tZero);
    entry.t0 = now; entry.g0 = cur; entry.tPeak = tPeak; entry.gPeak = p.level; entry.tZero = tZero;
    if (!isOfflineContext(ctx)) {
      extendLoopTimer(entry, 220);
    }
    return { stop: () => entry.stop() };
  }

  // Standalone one-shot spin wobble audition (sweeps low -> peak -> low like ubu movement)
  const duration = Math.max(0.18, Math.min(2.5, Number(options.duration) || 0.85));
  const master = createMasterChain(ctx, null, duration + 0.06);
  const now = ctx.currentTime;
  const pLow = ubuSpinParams(Math.max(3.5, Math.abs(omega) * 0.42), radius, slot, volume);
  const pPeak = ubuSpinParams(omega, radius, slot, volume);
  const osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator(), g2 = ctx.createGain();
  const lfo = ctx.createOscillator(), lfoGain = ctx.createGain(), filter = ctx.createBiquadFilter(), outGain = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(pLow.freq, now);
  osc1.frequency.linearRampToValueAtTime(pPeak.freq, now + duration * 0.45);
  osc1.frequency.linearRampToValueAtTime(pLow.freq, now + duration);
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(pLow.freq * 1.5, now);
  osc2.frequency.linearRampToValueAtTime(pPeak.freq * 1.5, now + duration * 0.45);
  osc2.frequency.linearRampToValueAtTime(pLow.freq * 1.5, now + duration);
  g2.gain.setValueAtTime(0.24, now);
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(pLow.swirlHz, now);
  lfo.frequency.linearRampToValueAtTime(pPeak.swirlHz, now + duration * 0.45);
  lfo.frequency.linearRampToValueAtTime(pLow.swirlHz, now + duration);
  lfoGain.gain.setValueAtTime(pLow.swirlDepth, now);
  lfoGain.gain.linearRampToValueAtTime(pPeak.swirlDepth, now + duration * 0.45);
  lfoGain.gain.linearRampToValueAtTime(pLow.swirlDepth, now + duration);
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(pLow.bandFreq, now);
  filter.frequency.linearRampToValueAtTime(pPeak.bandFreq, now + duration * 0.45);
  filter.frequency.linearRampToValueAtTime(pLow.bandFreq, now + duration);
  filter.Q.setValueAtTime(0.95, now);
  const dest = routePanner(ctx, master, options);
  const previewBoost = options.preview ? 1.5 : 1.25;
  outGain.gain.setValueAtTime(0.0001, now);
  outGain.gain.linearRampToValueAtTime(Math.min(0.085, pPeak.level * previewBoost), now + duration * 0.42);
  outGain.gain.linearRampToValueAtTime(Math.min(0.065, pPeak.level * previewBoost * 0.75), now + duration * 0.72);
  outGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  lfo.connect(lfoGain); lfoGain.connect(osc1.frequency); lfoGain.connect(osc2.frequency);
  osc1.connect(filter); osc2.connect(g2); g2.connect(filter);
  filter.connect(outGain); outGain.connect(dest);
  osc1.start(now); osc2.start(now); lfo.start(now);
  osc1.stop(now + duration + 0.02); osc2.stop(now + duration + 0.02); lfo.stop(now + duration + 0.02);
  return {
    stop() {
      try {
        const t = ctx.currentTime;
        outGain.gain.cancelScheduledValues(t);
        outGain.gain.setValueAtTime(Math.max(0.0001, outGain.gain.value || 0.0001), t);
        outGain.gain.linearRampToValueAtTime(0.0001, t + 0.015);
        osc1.stop(t + 0.02); osc2.stop(t + 0.02); lfo.stop(t + 0.02);
      } catch {}
    }
  };
}

// Hockey puck sliding on ice: quiet, low-friction glide with no abrasive/sandy grain.
// Uses gentle lowpass-filtered noise layers to synthesize smooth vulcanized rubber
// gliding across polished ice, kept subtle underneath gameplay.
function playPuckSlide(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const speed = Number(options.speed ?? 480);
  if (speed < 28) return;
  const duration = Math.max(0.1, Math.min(2.0, Number(options.duration) || 0.18));
  const master = createMasterChain(ctx, null, duration + 0.05);
  const now = ctx.currentTime;
  const s = Math.min(1, Math.max(0, (speed - 28) / 720));
  const spinShare = Math.min(1, Math.abs(options.spin || 0) / 20);
  const volume = Math.max(0.02, Math.min(1.2, options.volume ?? 1.0));
  const pan = getPan(options);
  const iceFreq = 540 + 320 * s + 60 * spinShare;
  const bodyFreq = 260 + 160 * s;
  const boost = duration > 0.4 ? 1.15 : 1.0;
  smoothNoise(ctx, master, now, duration, {
    type: 'lowpass',
    freq: iceFreq * 0.94, mid: iceFreq * 1.05, to: iceFreq * 0.90,
    q: 0.75,
    level: (0.0011 + 0.0033 * Math.pow(s, 1.1)) * volume * boost,
    pan
  });
  smoothNoise(ctx, master, now, duration, {
    type: 'lowpass',
    freq: bodyFreq * 0.96, mid: bodyFreq * 1.04, to: bodyFreq * 0.94,
    q: 0.85,
    level: (0.0007 + 0.0021 * Math.pow(s, 1.1)) * volume * boost,
    pan
  });
}

// Dry skate-blade rasp that follows finger movement while aiming: rasps on brisk drags,
// whispers on tiny angle/power corrections, and drops dead silent the instant the finger holds still.
function aimScrapeParams(dragSpeed, power, volume) {
  const s = Math.min(1, Math.max(0, (dragSpeed - 12) / 950));
  const p = Math.min(1, Math.max(0, Number(power) || 0));
  const freq = (1180 + 1620 * Math.pow(s, 0.82)) * (0.92 + 0.18 * p);
  const q = 1.9 + 0.85 * p;
  const hissFreq = 2850 + 1450 * s;
  const level = (0.005 + 0.062 * Math.pow(s, 0.92)) * (0.78 + 0.28 * p) * Math.max(0, Math.min(1.5, volume));
  return { freq, q, hissFreq, level };
}

function playAimScrape(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return { stop() {} };
  const dragSpeed = Number(options.speed ?? 480);
  const power = Number(options.power ?? 0.65);
  const volume = options.volume ?? 1;

  if (options.id !== undefined && options.id !== null) {
    const loopKey = 'aim:' + options.id;
    let map = motionLoops.get(ctx);
    if (dragSpeed <= 14 || volume <= 0) {
      map?.get(loopKey)?.stop();
      return { stop() {} };
    }
    if (!map) { map = new Map(); motionLoops.set(ctx, map); }
    activeMotionContexts.add(ctx);
    const now = ctx.currentTime;
    const p = aimScrapeParams(dragSpeed, power, volume);
    let entry = map.get(loopKey);
    if (!entry || entry.stopped) {
      const cleanup = [], master = createMasterChain(ctx, cleanup);
      const src = ctx.createBufferSource(), band = ctx.createBiquadFilter();
      const crisp = ctx.createBiquadFilter(), crispGain = ctx.createGain(), outGain = ctx.createGain();
      src.buffer = grainNoise(ctx);
      src.loop = true;
      band.type = 'bandpass';
      band.frequency.setValueAtTime(p.freq, now);
      band.Q.setValueAtTime(p.q, now);
      crisp.type = 'highpass';
      crisp.frequency.setValueAtTime(p.hissFreq, now);
      crisp.Q.setValueAtTime(0.85, now);
      crispGain.gain.setValueAtTime(0.32, now);
      outGain.gain.setValueAtTime(0, now);

      src.connect(band);
      band.connect(outGain);
      src.connect(crisp);
      crisp.connect(crispGain);
      crispGain.connect(outGain);

      let panner = null;
      const initialPan = getPan(options);
      if (ctx.createStereoPanner) {
        panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(initialPan, now);
        outGain.connect(panner);
        panner.connect(master);
        cleanup.push(panner);
      } else {
        outGain.connect(master);
      }
      src.onended = () => {
        for (const n of [src, band, crisp, crispGain, outGain, ...cleanup]) { try { n.disconnect(); } catch {} }
      };
      src.start(now, Math.random() * 0.75);
      entry = {
        stopped: false, timer: null, sources: [src], src, band, crisp, outGain, panner,
        freq0: p.freq, freq: p.freq, hiss0: p.hissFreq, hiss: p.hissFreq,
        paramT0: now, paramT1: now,
        t0: now, g0: 0, tPeak: now, gPeak: 0, tZero: now,
        stop() {
          if (entry.stopped) return;
          entry.stopped = true;
          if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
          if (entry.panner) { try { entry.panner.disconnect(); } catch {} }
          map.delete(loopKey);
          if (!map.size) activeMotionContexts.delete(ctx);
          try {
            const t = ctx.currentTime, g = currentLoopGain(entry, t);
            outGain.gain.cancelScheduledValues(t);
            outGain.gain.setValueAtTime(g, t);
            outGain.gain.linearRampToValueAtTime(0, t + 0.020);
            src.stop(t + 0.025);
          } catch {}
        }
      };
      map.set(loopKey, entry);
    } else {
      const rampEnd = now + 0.028;
      const curFreq = interpRamp(entry.paramT0, entry.freq0, entry.paramT1, entry.freq, now);
      const curHiss = interpRamp(entry.paramT0, entry.hiss0, entry.paramT1, entry.hiss, now);
      if (entry.panner) {
        const curPan = getPan(options);
        entry.panner.pan.cancelScheduledValues(now);
        entry.panner.pan.setValueAtTime(curPan, now);
      }
      entry.band.frequency.cancelScheduledValues(now);
      entry.band.frequency.setValueAtTime(curFreq, now);
      entry.band.frequency.linearRampToValueAtTime(p.freq, rampEnd);
      entry.band.Q.setValueAtTime(p.q, now);
      entry.crisp.frequency.cancelScheduledValues(now);
      entry.crisp.frequency.setValueAtTime(curHiss, now);
      entry.crisp.frequency.linearRampToValueAtTime(p.hissFreq, rampEnd);
      entry.freq0 = curFreq; entry.freq = p.freq;
      entry.hiss0 = curHiss; entry.hiss = p.hissFreq;
      entry.paramT0 = now; entry.paramT1 = rampEnd;
    }
    const cur = currentLoopGain(entry, now), tPeak = now + 0.016, tZero = now + 0.068;
    entry.outGain.gain.cancelScheduledValues(now);
    entry.outGain.gain.setValueAtTime(cur, now);
    entry.outGain.gain.linearRampToValueAtTime(p.level, tPeak);
    entry.outGain.gain.linearRampToValueAtTime(0, tZero);
    entry.t0 = now; entry.g0 = cur; entry.tPeak = tPeak; entry.gPeak = p.level; entry.tZero = tZero;
    if (!isOfflineContext(ctx)) {
      extendLoopTimer(entry, 65);
    }
    return { stop: () => entry.stop() };
  }

  // Standalone two-gesture audition (brisk pull rasp -> brief hold silence -> tiny whisper correction)
  const master = createMasterChain(ctx, null, 0.65);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const pFast = aimScrapeParams(760, 0.85, volume);
  const pFine = aimScrapeParams(135, 0.88, volume);
  noiseGrain(ctx, dest, now, 0.20, { freq: pFast.freq * 0.85, to: pFast.freq * 1.15, q: pFast.q, level: pFast.level * 1.8 });
  noiseGrain(ctx, dest, now + 0.01, 0.16, { type: 'highpass', freq: pFast.hissFreq, to: pFast.hissFreq * 0.9, q: 0.9, level: pFast.level * 0.85 });
  noiseGrain(ctx, dest, now + 0.31, 0.14, { freq: pFine.freq, to: pFine.freq * 0.92, q: pFine.q + 0.5, level: pFine.level * 2.1 });
  return { stop() {} };
}

// Ice hockey hard brake, Pulse outside-edge cut & corner rim-around skate shave (~140-175 ms).
function playCarve(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const brake = Boolean(options.brake);
  const cut = Math.min(1, Math.max(0, Number(options.cut) || 0));
  const master = createMasterChain(ctx, null, 0.22);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.03, Math.min(1.0, options.volume ?? 0.42));
  const speedNorm = Math.min(1, Math.max(0, (Number(options.speed) || 320) / 620));
  const rimmed = Boolean(options.rimmed);
  const pitchMul = 0.92 + 0.28 * speedNorm + (rimmed ? 0.08 : 0) + 0.10 * cut;

  if (brake) {
    // Decisive Pulse Guard hockey-stop: twin steel edges bite hard and pitch downward to a dead stop
    const stopDur = 0.135;
    const spray = ctx.createBufferSource(), sprayFilter = ctx.createBiquadFilter(), sprayGain = ctx.createGain();
    spray.buffer = grainNoise(ctx);
    sprayFilter.type = 'bandpass';
    sprayFilter.Q.setValueAtTime(1.75, now);
    sprayFilter.frequency.setValueAtTime(2480 * pitchMul, now);
    sprayFilter.frequency.exponentialRampToValueAtTime(760 * pitchMul, now + stopDur);
    sprayGain.gain.setValueAtTime(0.0001, now);
    sprayGain.gain.linearRampToValueAtTime(0.20 * volume, now + 0.008);
    sprayGain.gain.linearRampToValueAtTime(0.13 * volume, now + 0.048);
    sprayGain.gain.exponentialRampToValueAtTime(0.0001, now + stopDur);
    spray.connect(sprayFilter); sprayFilter.connect(sprayGain); sprayGain.connect(dest);
    spray.start(now, Math.random() * 0.7);
    spray.stop(now + stopDur + 0.015);

    // Forward snow-plume hiss + twin-blade anchor thud
    noiseGrain(ctx, dest, now + 0.004, 0.11, { freq: 3400 * pitchMul, to: 1150 * pitchMul, q: 1.1, level: 0.11 * volume });
    noiseGrain(ctx, dest, now, 0.055, { freq: 360, to: 145, q: 2.0, level: 0.12 * volume });
    return;
  }

  // 1. Restrained steel-blade edge shave sweep (rises higher on fast corner rim-arounds & lateral Pulse cuts)
  const spray = ctx.createBufferSource(), sprayFilter = ctx.createBiquadFilter(), sprayGain = ctx.createGain();
  spray.buffer = grainNoise(ctx);
  sprayFilter.type = 'bandpass';
  sprayFilter.Q.setValueAtTime(rimmed ? 1.85 : (1.6 + 0.55 * cut), now);
  sprayFilter.frequency.setValueAtTime((1350 + 180 * cut) * pitchMul, now);
  sprayFilter.frequency.exponentialRampToValueAtTime((rimmed ? 2680 : (2350 + 320 * cut)) * pitchMul, now + (rimmed ? 0.065 : 0.045));
  sprayFilter.frequency.exponentialRampToValueAtTime((rimmed ? 1320 : 1050) * pitchMul, now + 0.165);
  sprayGain.gain.setValueAtTime(0.0001, now);
  sprayGain.gain.linearRampToValueAtTime((0.13 + 0.045 * cut) * volume, now + 0.012);
  sprayGain.gain.linearRampToValueAtTime((0.095 + 0.025 * cut) * volume, now + 0.05);
  sprayGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.165);
  spray.connect(sprayFilter); sprayFilter.connect(sprayGain); sprayGain.connect(dest);
  spray.start(now, Math.random() * 0.7);
  spray.stop(now + 0.18);

  // 2. Soft shaved-ice snow spray
  noiseGrain(ctx, dest, now + 0.006, 0.13, { freq: 2900 * pitchMul, to: 1500 * pitchMul, q: 1.0, level: (0.065 + 0.025 * cut) * volume });

  // 3. Subtle ice-crystal shave texture in the initial bite
  for (let i = 0; i < 3; i++) {
    const t = now + i * 0.014 + Math.random() * 0.005;
    noiseGrain(ctx, dest, t, 0.014, {
      freq: (1150 + i * 240 + Math.random() * 250) * pitchMul,
      to: (900 + i * 140) * pitchMul,
      q: 2.6,
      level: (0.075 - i * 0.018) * (1 + 0.25 * cut) * volume
    });
  }

  // 4. Gentle low-mid skate pressure weight
  noiseGrain(ctx, dest, now, 0.075, { freq: 420 * (0.95 + 0.15 * speedNorm), to: 250, q: 2.2, level: (0.07 + 0.03 * cut) * volume });
}

// Continuous tailgating wind: smooth overlapping rushing-air stream when triggered repeatedly
// during slipstream drafting, or a sustained wind gust when auditioned standalone.
function playSlipstream(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const duration = Math.max(0.14, Math.min(2.2, Number(options.duration) || 0.22));
  const master = createMasterChain(ctx, null, duration + 0.05);
  const now = ctx.currentTime;
  const draft = Math.min(1, Math.max(0, Number(options.draft ?? 0.7)));
  const volume = Math.max(0.04, Math.min(1.0, options.volume ?? (0.3 + 0.42 * draft)));
  const boost = duration > 0.4 ? 1.35 : 1.0;
  const pan = getPan(options);

  // Warm aerodynamic air-pocket rush
  const baseAir = 440 + 240 * draft;
  smoothNoise(ctx, master, now, duration, {
    freq: baseAir, mid: baseAir * 1.32, to: baseAir * 1.04,
    q: 1.35, level: 0.17 * volume * boost, pan
  });
  // Silky upper wind-sheath whistle
  const sheen = 1220 + 680 * draft;
  smoothNoise(ctx, master, now, duration, {
    freq: sheen * 0.92, mid: sheen * 1.24, to: sheen,
    q: 2.35, level: 0.09 * volume * boost, pan
  });
}

// Spin strike & hip clip: pronounced accelerating aerodynamic whip ("hwhip-") that either resolves
// as a pure whip-slice (options.crack === false, for Hip Clips) or snaps into a supersonic N-wave bullwhip crack.
function playSpinStrike(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const withCrack = options.crack !== false;
  const master = createMasterChain(ctx, null, withCrack ? 0.22 : 0.14);
  const dest = routePanner(ctx, master, options);
  if (!sharedChains.has(ctx)) master.frequency.setValueAtTime(12500, ctx.currentTime);
  const now = ctx.currentTime;
  const volume = Math.max(0.05, Math.min(1.0, options.volume ?? 0.85));
  const spinNorm = Math.min(1, Math.max(0.25, (Math.abs(options.spin) || 14) / 18));
  const crackAt = now + (withCrack ? 0.068 : 0.058);

  // 1a. Heavy braided-cord loop air displacement ("HWHH-") unrolling into the tip
  const whoosh = ctx.createBufferSource(), whooshBand = ctx.createBiquadFilter(), whooshGain = ctx.createGain();
  whoosh.buffer = grainNoise(ctx);
  whooshBand.type = 'bandpass';
  whooshBand.Q.setValueAtTime(1.45, now);
  whooshBand.frequency.setValueAtTime(210, now);
  whooshBand.frequency.exponentialRampToValueAtTime(560, now + 0.036);
  whooshBand.frequency.exponentialRampToValueAtTime(1480 + 320 * spinNorm, crackAt + 0.008);
  whooshGain.gain.setValueAtTime(0.0001, now);
  whooshGain.gain.linearRampToValueAtTime(0.32 * volume, now + 0.028);
  whooshGain.gain.exponentialRampToValueAtTime(0.54 * volume, crackAt);
  whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + (withCrack ? 0.082 : 0.108));
  whoosh.connect(whooshBand); whooshBand.connect(whooshGain); whooshGain.connect(dest);
  whoosh.start(now, Math.random() * 0.7);
  whoosh.stop(now + (withCrack ? 0.088 : 0.115));

  // 1b. Accelerating tapered whip-tip air shear ("-WHIP!")
  const swish = ctx.createBufferSource(), swishBand = ctx.createBiquadFilter(), swishGain = ctx.createGain();
  swish.buffer = grainNoise(ctx);
  swishBand.type = 'bandpass';
  swishBand.Q.setValueAtTime(2.35, now + 0.014);
  swishBand.frequency.setValueAtTime(580, now + 0.014);
  swishBand.frequency.exponentialRampToValueAtTime(2850 + 550 * spinNorm, crackAt + 0.004);
  swishGain.gain.setValueAtTime(0.0001, now + 0.014);
  swishGain.gain.linearRampToValueAtTime(0.44 * volume, crackAt);
  swishGain.gain.exponentialRampToValueAtTime(0.0001, now + (withCrack ? 0.078 : 0.102));
  swish.connect(swishBand); swishBand.connect(swishGain); swishGain.connect(dest);
  swish.start(now + 0.014, Math.random() * 0.7);
  swish.stop(now + (withCrack ? 0.084 : 0.11));

  if (!withCrack) {
    noiseGrain(ctx, dest, now + 0.042, 0.055, { freq: 1150, to: 380, q: 1.6, level: 0.22 * volume });
    return;
  }

  // 2. Supersonic whip-tip "CRACK!" N-wave shockfront at 68 ms
  const snapFreq = 3100 + 700 * spinNorm;

  const crack = ctx.createBufferSource(), crackBand = ctx.createBiquadFilter(), crackGain = ctx.createGain();
  crack.buffer = grainNoise(ctx);
  crackBand.type = 'bandpass';
  crackBand.Q.setValueAtTime(0.72, crackAt);
  crackBand.frequency.setValueAtTime(snapFreq, crackAt);
  crackBand.frequency.exponentialRampToValueAtTime(820, crackAt + 0.022);
  crackGain.gain.setValueAtTime(0.0001, crackAt);
  crackGain.gain.linearRampToValueAtTime(0.96 * volume, crackAt + 0.0004);
  crackGain.gain.exponentialRampToValueAtTime(0.0001, crackAt + 0.022);
  crack.connect(crackBand); crackBand.connect(crackGain); crackGain.connect(dest);
  crack.start(crackAt, Math.random() * 0.7);
  crack.stop(crackAt + 0.028);

  const tip = ctx.createBufferSource(), tipHp = ctx.createBiquadFilter(), tipGain = ctx.createGain();
  tip.buffer = grainNoise(ctx);
  tipHp.type = 'highpass';
  tipHp.Q.setValueAtTime(1.25, crackAt);
  tipHp.frequency.setValueAtTime(3400, crackAt);
  tipGain.gain.setValueAtTime(0.0001, crackAt);
  tipGain.gain.linearRampToValueAtTime(0.76 * volume, crackAt + 0.0004);
  tipGain.gain.exponentialRampToValueAtTime(0.0001, crackAt + 0.012);
  tip.connect(tipHp); tipHp.connect(tipGain); tipGain.connect(dest);
  tip.start(crackAt, Math.random() * 0.7);
  tip.stop(crackAt + 0.018);

  // Trailing N-wave expansion snap 5 ms after the leading shockfront
  const s2 = crackAt + 0.005;
  const doubleSnap = ctx.createBufferSource(), dsBand = ctx.createBiquadFilter(), dsGain = ctx.createGain();
  doubleSnap.buffer = grainNoise(ctx);
  dsBand.type = 'bandpass';
  dsBand.Q.setValueAtTime(1.15, s2);
  dsBand.frequency.setValueAtTime(2650 + 450 * spinNorm, s2);
  dsBand.frequency.exponentialRampToValueAtTime(960, s2 + 0.014);
  dsGain.gain.setValueAtTime(0.0001, s2);
  dsGain.gain.linearRampToValueAtTime(0.58 * volume, s2 + 0.0004);
  dsGain.gain.exponentialRampToValueAtTime(0.0001, s2 + 0.014);
  doubleSnap.connect(dsBand); dsBand.connect(dsGain); dsGain.connect(dest);
  doubleSnap.start(s2, Math.random() * 0.7);
  doubleSnap.stop(s2 + 0.02);

  // Sub-20 ms N-wave shock impulse oscillators for physical snap punch
  const pop = ctx.createOscillator(), popGain = ctx.createGain();
  pop.type = 'triangle';
  pop.frequency.setValueAtTime(980, crackAt);
  pop.frequency.exponentialRampToValueAtTime(145, crackAt + 0.011);
  popGain.gain.setValueAtTime(0.0001, crackAt);
  popGain.gain.linearRampToValueAtTime(0.58 * volume, crackAt + 0.0005);
  popGain.gain.exponentialRampToValueAtTime(0.0001, crackAt + 0.013);
  pop.connect(popGain); popGain.connect(dest);
  pop.start(crackAt);
  pop.stop(crackAt + 0.016);

  const snapOsc = ctx.createOscillator(), snapOscGain = ctx.createGain();
  snapOsc.type = 'sine';
  snapOsc.frequency.setValueAtTime(2650, crackAt);
  snapOsc.frequency.exponentialRampToValueAtTime(360, crackAt + 0.007);
  snapOscGain.gain.setValueAtTime(0.0001, crackAt);
  snapOscGain.gain.linearRampToValueAtTime(0.52 * volume, crackAt + 0.0004);
  snapOscGain.gain.exponentialRampToValueAtTime(0.0001, crackAt + 0.009);
  snapOsc.connect(snapOscGain); snapOscGain.connect(dest);
  snapOsc.start(crackAt);
  snapOsc.stop(crackAt + 0.012);

  // 3. Tight arena slapback air-tail off the crack
  const tAt = crackAt + 0.006;
  const tail = ctx.createBufferSource(), tailFilter = ctx.createBiquadFilter(), tailGain = ctx.createGain();
  tail.buffer = grainNoise(ctx);
  tailFilter.type = 'bandpass';
  tailFilter.Q.setValueAtTime(1.2, tAt);
  tailFilter.frequency.setValueAtTime(1850, tAt);
  tailFilter.frequency.exponentialRampToValueAtTime(520, tAt + 0.086);
  tailGain.gain.setValueAtTime(0.0001, tAt);
  tailGain.gain.linearRampToValueAtTime(0.22 * volume, tAt + 0.005);
  tailGain.gain.exponentialRampToValueAtTime(0.0001, tAt + 0.088);
  tail.connect(tailFilter); tailFilter.connect(tailGain); tailGain.connect(dest);
  tail.start(tAt, Math.random() * 0.7);
  tail.stop(tAt + 0.1);
}

// Celebratory ubu twirl layered on top of the bullwhip strike when spin >= 10 rad/s:
// upward gyroscopic flutter + airy spin-sheen shimmer around the striking ubu.
function playSpinTwirl(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const master = createMasterChain(ctx, null, 0.28);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.05, Math.min(1.0, options.volume ?? 0.85));
  const spinNorm = Math.min(1, Math.max(0.25, (Math.abs(options.spin) || 14) / 20));
  const dur = 0.24;

  const carrier = ctx.createOscillator(), overtone = ctx.createOscillator();
  const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
  const toneGain = ctx.createGain(), overGain = ctx.createGain();
  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(380 + 90 * spinNorm, now);
  carrier.frequency.exponentialRampToValueAtTime(760 + 260 * spinNorm, now + dur * 0.72);
  carrier.frequency.exponentialRampToValueAtTime(620 + 180 * spinNorm, now + dur);

  overtone.type = 'triangle';
  overtone.frequency.setValueAtTime(760 + 180 * spinNorm, now);
  overtone.frequency.exponentialRampToValueAtTime(1480 + 420 * spinNorm, now + dur * 0.72);
  overtone.frequency.exponentialRampToValueAtTime(1180 + 300 * spinNorm, now + dur);

  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(22 + 12 * spinNorm, now);
  lfo.frequency.linearRampToValueAtTime(34 + 14 * spinNorm, now + dur);
  lfoGain.gain.setValueAtTime(65 + 45 * spinNorm, now);

  toneGain.gain.setValueAtTime(0.0001, now);
  toneGain.gain.linearRampToValueAtTime(0.22 * volume, now + 0.02);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  overGain.gain.setValueAtTime(0.0001, now);
  overGain.gain.linearRampToValueAtTime(0.11 * volume, now + 0.025);
  overGain.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.92);

  lfo.connect(lfoGain);
  lfoGain.connect(carrier.frequency);
  lfoGain.connect(overtone.frequency);
  carrier.connect(toneGain); toneGain.connect(dest);
  overtone.connect(overGain); overGain.connect(dest);

  carrier.start(now); overtone.start(now); lfo.start(now);
  carrier.stop(now + dur + 0.02); overtone.stop(now + dur + 0.02); lfo.stop(now + dur + 0.02);

  noiseGrain(ctx, dest, now, dur * 0.85, {
    type: 'bandpass',
    freq: 1200 + 300 * spinNorm,
    mid: 2400 + 500 * spinNorm,
    to: 1650 + 300 * spinNorm,
    q: 2.8,
    level: 0.18 * volume
  });
}

// Hockey dasher-board bounce: polite flex on light/medium hits, plus a deep hollow woody/HDPE
// dasher-box "thock" reserved strictly for truly hard board hits.

// Launch skate push-off: completes the loaded-shot spring when a skater fires from rest or surges ahead,
// scaling pitch and crunch by mass (crisp featherweight toe-push vs. deep heavyweight twin-blade dig).
function playLaunchPush(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const p = Math.max(0.12, Math.min(1, Number(options.power ?? 0.78)));
  const massRatio = Math.max(0.70, Math.min(2.2, (Number(options.mass) || 3) / 3));
  const sizeRatio = Math.max(0.65, Math.min(2.2, (Number(options.radius) || 25) / 25));
  const heavy = Math.max(0, Math.min(1, (massRatio * 0.75 + sizeRatio * 0.25 - 0.80) / 0.85));
  const dur = 0.068 + 0.038 * heavy + 0.018 * p;
  const master = createMasterChain(ctx, null, dur + 0.04);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.04, Math.min(1.0, options.volume ?? (0.28 + 0.44 * p)));

  // 1. Twin-blade ice bite ("shk!") — crisp & airy for sprinters, gritty & lower for bruisers
  const startHz = (2240 - 780 * heavy) * (0.92 + 0.16 * p);
  const endHz = (1160 - 520 * heavy) * (0.90 + 0.14 * p);
  const pushSrc = ctx.createBufferSource(), pushBand = ctx.createBiquadFilter(), pushGain = ctx.createGain();
  pushSrc.buffer = grainNoise(ctx);
  pushBand.type = 'bandpass';
  pushBand.Q.setValueAtTime(2.05 - 0.35 * heavy, now);
  pushBand.frequency.setValueAtTime(startHz, now);
  pushBand.frequency.exponentialRampToValueAtTime(Math.max(180, endHz), now + dur);
  pushGain.gain.setValueAtTime(0.0001, now);
  pushGain.gain.linearRampToValueAtTime((0.20 + 0.08 * p) * volume, now + 0.006);
  pushGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  pushSrc.connect(pushBand); pushBand.connect(pushGain); pushGain.connect(dest);
  pushSrc.start(now, Math.random() * 0.75);
  pushSrc.stop(now + dur + 0.015);

  // 2. Boot-push impulse body: quick toe snap on light ubus, deep ice-dig thud on heavyweights
  const kick = ctx.createOscillator(), kickGain = ctx.createGain();
  kick.type = 'triangle';
  const kickStart = 265 - 122 * heavy;
  const kickEnd = Math.max(38, 124 - 68 * heavy);
  const kickDur = 0.036 + 0.036 * heavy;
  kick.frequency.setValueAtTime(kickStart, now);
  kick.frequency.exponentialRampToValueAtTime(kickEnd, now + kickDur);
  strike(kickGain, (0.14 + 0.24 * heavy) * (0.55 + 0.45 * p) * volume, now, now + kickDur + 0.008, 0.0015);
  kick.connect(kickGain); kickGain.connect(dest);
  kick.start(now); kick.stop(now + kickDur + 0.016);

  // 3. Staggered second-blade heel nick crystal grain
  noiseGrain(ctx, dest, now + 0.014, 0.022 + 0.014 * heavy, {
    freq: (2850 - 920 * heavy),
    to: Math.max(420, 1480 - 540 * heavy),
    q: 2.3,
    level: (0.11 + 0.06 * heavy) * volume
  });
}

// Precision watch-crown spin dial tick: soft escapement click that rises subtly with |spin|,
// with a distinct warm brass/wood zero-center detent click when crossing or resetting to 0.
function playSpinTick(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const center = Boolean(options.center);
  const absSpin = Math.min(1, Math.max(0, Math.abs(Number(options.spin) || 0)));
  const master = createMasterChain(ctx, null, 0.045);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.03, Math.min(1.0, options.volume ?? 0.55));

  if (center) {
    const det = ctx.createOscillator(), detGain = ctx.createGain();
    det.type = 'triangle';
    det.frequency.setValueAtTime(840, now);
    det.frequency.exponentialRampToValueAtTime(385, now + 0.017);
    strike(detGain, 0.24 * volume, now, now + 0.020, 0.0008);
    det.connect(detGain); detGain.connect(dest);
    det.start(now); det.stop(now + 0.026);
    noiseGrain(ctx, dest, now, 0.009, { freq: 1680, to: 920, q: 2.6, level: 0.11 * volume });
    return;
  }

  const tick = ctx.createOscillator(), tickGain = ctx.createGain();
  tick.type = 'sine';
  const f0 = 2480 + 980 * absSpin;
  const f1 = 1240 + 420 * absSpin;
  tick.frequency.setValueAtTime(f0, now);
  tick.frequency.exponentialRampToValueAtTime(f1, now + 0.0085);
  strike(tickGain, (0.14 + 0.06 * absSpin) * volume, now, now + 0.010, 0.0005);
  tick.connect(tickGain); tickGain.connect(dest);
  tick.start(now); tick.stop(now + 0.015);

  noiseGrain(ctx, dest, now, 0.006, {
    type: 'bandpass',
    freq: 3650 + 900 * absSpin,
    to: 2150 + 500 * absSpin,
    q: 3.4,
    level: 0.095 * volume
  });
}

module.exports = { playUbuMove, playSpin, playPuckSlide, playAimScrape, playLaunchPush, playSpinTick, playCarve, playSlipstream, playSpinStrike, playSpinTwirl };
