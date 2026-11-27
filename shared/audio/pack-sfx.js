/* Ubu voice preview, collision chimes, pack opening foley, and coin/sizzle effects. */
'use strict';
const { decaySeconds, parseVoiceInfo } = require('./theory.js');
const { panFromField, getPan, routePanner, getAudioContext, sharedChains, createMasterChain, superPlayback, getActivePlayback, setActivePlayback, isOfflineContext, stopAll, getAudioMode } = require('./buses.js');
const { playTone, strike, grainNoise, noiseGrain, blip, electricSnap } = require('./synth.js');
function playVoice(voice, customCtx = null, options = {}) {
  if (!options.overlap) stopAll();
  const ctx = customCtx || getAudioContext();
  if (!ctx) return { stop() {} };

  const parsed = parseVoiceInfo(voice);
  const master = createMasterChain(ctx, null, parsed.decaySeconds * 1.5 + 0.1);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = options.volume ?? 1.0;

  // A friendly signature voice chirp / call
  const toneHandle = playTone(ctx, dest, {
    instrument: parsed.instrumentIndex,
    freq: parsed.rootFreq,
    startTime: now,
    duration: parsed.decaySeconds,
    decay: parsed.decaySeconds,
    timbreMod: parsed.timbreMod,
    pitchBend: 2.5, // subtle upward scoop into pitch gives personality!
    volume,
    cleanupNode: dest !== master ? dest : null
  });

  const handle = {
    stop() {
      toneHandle.stop();
      if (getActivePlayback() === handle) setActivePlayback(null);
    }
  };
  if (!options.overlap) setActivePlayback(handle);
  return handle;
}

function playCollision(voice, options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return { stop() {} };

  const parsed = parseVoiceInfo(voice);
  const master = createMasterChain(ctx, null, Math.min(parsed.decaySeconds, 0.22) * 1.5 + 0.1);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.05, Math.min(1.0, options.volume ?? 1.0));

  // Collision sound: snappy, responsive impact chirp with scaled loudness
  const duration = Math.min(parsed.decaySeconds, 0.22);
  const toneHandle = playTone(ctx, dest, {
    instrument: parsed.instrumentIndex,
    freq: parsed.rootFreq,
    startTime: now,
    duration: duration,
    decay: duration,
    timbreMod: parsed.timbreMod,
    pitchBend: 1.8,
    volume,
    soft: 0.005,
    cleanupNode: dest !== master ? dest : null
  });
  return toneHandle;
}

// Impact envelope: a 3 ms rise instead of an instant start, then the usual quick decay.

function playBallHit(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const snap = Boolean(options.snap);
  const poke = Boolean(options.poke);
  const graze = snap ? 0 : Math.max(0, Math.min(1, Number(options.graze) || 0));
  const square = Math.max(0, 1 - graze * 0.88);
  const skim = Math.max(0, (graze - 0.30) / 0.70);
  const master = createMasterChain(ctx, null, snap ? 0.12 : 0.095);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.04, Math.min(1.0, options.volume ?? 0.8));

  // 1. Center-of-mass vulcanized puck body (strong on square hits, recedes on paper-thin grazes)
  if (square > 0.08) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const startHz = snap ? 285 : (228 + 24 * square);
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(76 + 18 * (1 - square), now + 0.048);
    strike(gain, (0.14 + 0.58 * square) * volume, now, now + (0.042 + 0.028 * square));
    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.08);

    // Dry woody/stick-face tap attack transient on square contacts
    const tap = ctx.createOscillator(), tapGain = ctx.createGain();
    tap.type = 'sine';
    tap.frequency.setValueAtTime(940 + 180 * square, now);
    tap.frequency.exponentialRampToValueAtTime(215, now + 0.012);
    strike(tapGain, 0.34 * square * volume, now, now + 0.015);
    tap.connect(tapGain);
    tapGain.connect(dest);
    tap.start(now);
    tap.stop(now + 0.022);

    noiseGrain(ctx, dest, now, 0.015, {
      freq: 1580, to: 660, q: 1.9,
      level: 0.22 * square * volume
    });
  }

  // 2. Thin sideways edge "shik" when clipping/grazing the ball tangentially
  if (skim > 0.04) {
    const shikDur = 0.026 + 0.016 * skim;
    const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = grainNoise(ctx);
    band.type = 'bandpass';
    band.Q.setValueAtTime(3.1 + 0.9 * skim, now);
    band.frequency.setValueAtTime(2450 + 550 * skim, now);
    band.frequency.exponentialRampToValueAtTime(4200 + 600 * skim, now + shikDur * 0.42);
    band.frequency.exponentialRampToValueAtTime(1850, now + shikDur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.38 * skim * volume, now + 0.0025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + shikDur);
    src.connect(band);
    band.connect(gain);
    gain.connect(dest);
    src.start(now, Math.random() * 0.75);
    src.stop(now + shikDur + 0.015);

    noiseGrain(ctx, dest, now + 0.002, 0.020, {
      type: 'highpass', freq: 3800, to: 2900, q: 1.3,
      level: 0.18 * skim * volume
    });
  }

  // 3. Crisp extended-Reach blade-tip click when poke-checking outside body radius
  if (poke && !snap) {
    blip(ctx, dest, now, 0.018, 1560, 960, 0.16 * volume);
  }

  if (snap) {
    const crack = ctx.createOscillator(), crackGain = ctx.createGain();
    crack.type = 'sine';
    crack.frequency.setValueAtTime(1150, now);
    crack.frequency.exponentialRampToValueAtTime(260, now + 0.042);
    strike(crackGain, 0.45 * volume, now, now + 0.048);
    crack.connect(crackGain);
    crackGain.connect(dest);
    crack.start(now);
    crack.stop(now + 0.055);
    noiseGrain(ctx, dest, now, 0.028, { freq: 2900, to: 1100, q: 1.8, level: 0.42 * volume });
  }
}

// One second of white noise per audio context; grains read random slices of it.

function playPack(kind, options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const hold = kind === 'scamper' || kind === 'charge' || (kind === 'reveal' && (options.charged || options.material)) || (kind === 'deal' && (options.charge > 0 || options.charges?.some(c => c > 0)))
    ? 0.68
    : 0.44;
  const master = createMasterChain(ctx, null, hold);
  const now = ctx.currentTime;
  const clampStage = v => Math.max(0, Math.min(5, Math.trunc(v) || 0));
  if (kind === 'deal') {
    const slotCharges = Array.isArray(options.charges) ? options.charges.map(clampStage) : null;
    const fallbackCharge = clampStage(options.charge);
    for (let i = 0; i < 3; i++) {
      const pan = (i - 1) * 0.5, landAt = now + i * 0.12;
      noiseGrain(ctx, master, landAt, 0.09, { freq: 2600, to: 900, level: 0.5, pan });
      const st = slotCharges ? slotCharges[i] : (i === 1 ? fallbackCharge : 0);
      if (st > 0) {
        const lvl = 0.07 + st * 0.032;
        blip(ctx, master, landAt + 0.035, 0.09 + st * 0.014, 180 + st * 22, 310 + st * 48, lvl * 0.75, pan);
        for (let s = 0; s < st; s++) {
          electricSnap(ctx, master, landAt + 0.045 + s * 0.028 + Math.random() * 0.012, lvl, pan);
        }
      }
    }
  } else if (kind === 'pick') {
    blip(ctx, master, now, 0.14, 420, 940, 0.45);
    noiseGrain(ctx, master, now, 0.05, { freq: 3200, to: 1800, level: 0.25 });
    const st = clampStage(options.charge ?? options.stage);
    if (st > 0) {
      const lvl = 0.09 + st * 0.035;
      blip(ctx, master, now + 0.015, 0.16, 220, 480 + st * 85, lvl * 0.85);
      for (let s = 0; s <= st; s++) {
        electricSnap(ctx, master, now + 0.03 + s * 0.026 + Math.random() * 0.01, lvl, (Math.random() - 0.5) * 0.45);
      }
    }
  } else if (kind === 'charge') {
    const st = Math.max(1, clampStage(options.stage ?? options.charge ?? 3));
    const lvl = 0.09 + st * 0.038;
    blip(ctx, master, now, 0.14 + st * 0.03, 155, 290 + st * 68, lvl * 0.9);
    blip(ctx, master, now + 0.04, 0.12 + st * 0.025, 340, 680 + st * 110, lvl * 0.48);
    const snaps = 1 + st * 2;
    for (let s = 0; s < snaps; s++) {
      electricSnap(ctx, master, now + 0.02 + s * (0.28 / snaps) + Math.random() * 0.014, lvl, (Math.random() - 0.5) * 0.6);
    }
  } else if (kind === 'crack') {
    // An eggshell tap: a light tick, with more small crackles as the crack spreads.
    const stage = options.stage || 1;
    noiseGrain(ctx, master, now, 0.004, { freq: 3600, q: 2, level: 0.3 });
    blip(ctx, master, now, 0.02, 1700, 1400, 0.08);
    for (let i = 1; i < stage * 2; i++) noiseGrain(ctx, master, now + 0.01 + Math.random() * 0.05 * stage, 0.003, { freq: 2600 + Math.random() * 3000, q: 2, level: 0.12 + 0.04 * stage });
    const st = clampStage(options.charge);
    if (st > 0) electricSnap(ctx, master, now + 0.014, 0.08 + st * 0.028);
  } else if (kind === 'reveal') {
    blip(ctx, master, now, 0.11, 520, 1040, 0.28);
    blip(ctx, master, now + 0.055, 0.16, 780, 1320, 0.2);
    noiseGrain(ctx, master, now, 0.04, { freq: 4200, to: 2400, level: 0.12 });
    if (options.charged) {
      blip(ctx, master, now + 0.085, 0.15, 660, 1760, 0.18);
      for (let s = 0; s < 4; s++) {
        electricSnap(ctx, master, now + 0.07 + s * 0.045 + Math.random() * 0.012, 0.16 - s * 0.02, (s - 1.5) * 0.22);
      }
    }
    if (options.material) {
      const baseOffset = options.charged ? 0.13 : 0.075;
      [[1568, 2093, -0.25], [1976, 2637, 0.2], [2349, 3136, 0]].forEach(([f0, f1, pan], idx) => {
        const t = now + baseOffset + idx * 0.05;
        blip(ctx, master, t, 0.13, f0, f1, 0.13 - idx * 0.02, pan);
        noiseGrain(ctx, master, t, 0.024, { freq: 6800, to: 9200, q: 3.2, level: 0.075, pan });
      });
    }
  } else if (kind === 'scamper') {
    const n = Math.max(1, Math.min(5, options.count || 5));
    for (let i = 0; i < n; i++) {
      const t = now + i * 0.055, pan = n > 1 ? (i / (n - 1) - 0.5) * 1.2 : 0;
      blip(ctx, master, t, 0.065, 480 + i * 75, 880 + i * 110, 0.22, pan);
      noiseGrain(ctx, master, t + 0.015, 0.035, { freq: 3400, to: 1600, level: 0.16, pan });
    }
  }
}

// Pack openings, scheduled from the moment the unwrap animation starts so each sound lands on
// its visual step. Phases are fractions of the animation and match pack-scene.js; activity in a
// phase follows its smoothstep speed, which peaks halfway through.
function playUnwrap(type, seconds, options = {}) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const master = createMasterChain(ctx, null, Math.max(seconds, 0.95) + 0.3);
  // Foil and wet crackle live up to 12 kHz; open a private chain's usual 7.5 kHz softening.
  if (!sharedChains.has(ctx)) master.frequency.setValueAtTime(16000, ctx.currentTime);
  const now = ctx.currentTime + 0.02;
  const at = fraction => now + fraction * seconds;
  const rand = (low, high) => low + Math.random() * (high - low);
  // Scatter grains through a phase at up to `rate` per second, densest where the motion is fastest.
  const scatter = (from, to, rate, make) => {
    const step = 0.005;
    for (let t = at(from); t < at(to); t += step) {
      const x = (t - at(from)) / (at(to) - at(from)), speed = 4 * x * (1 - x);
      if (Math.random() < rate * speed * step) make(t, speed);
    }
  };
  if (type === 'plastic') {
    // Cellophane: a sprinkle of soft crinkles as the twisted ends unwind, and a few more as the
    // film peels back. Lower, broader grains keep it gentle rather than sharp.
    const crinkle = (t, speed) => noiseGrain(ctx, master, t, rand(0.008, 0.018), {
      freq: rand(1800, 4200), q: rand(1, 2.5), level: rand(0.2, 0.42) * (0.6 + speed * 0.4), pan: rand(-0.4, 0.4)
    });
    scatter(0.08, 0.38, 20, crinkle);
    scatter(0.62, 0.85, 16, crinkle);
  } else if (type === 'foil') {
    // Foil, modelled on a recording of thin foil: one quick rip of very bright, fluttering hiss
    // (most energy 3-12 kHz) with tiny crackles riding on it, about fifty a second.
    const start = at(0.14), length = 0.32;
    for (let t = start; t < start + length; t += 0.012) {
      const x = (t - start) / length, swell = Math.sin(Math.PI * x) ** 0.7;
      noiseGrain(ctx, master, t, 0.016, { freq: rand(6000, 9500), q: 0.7, level: 0.09 * swell * rand(0.4, 1) });
    }
    for (let t = start; t < start + length; t += rand(0.012, 0.034)) {
      const x = (t - start) / length;
      noiseGrain(ctx, master, t, rand(0.002, 0.005), { freq: rand(4000, 11000), q: rand(1, 2.5), level: rand(0.09, 0.24) * Math.sin(Math.PI * x) ** 0.5, pan: rand(-0.3, 0.3) });
    }
  } else if (type === 'blob') {
    // Blob, modelled on a recording of squished slime: one wet squelch as the goo stretches.
    // Real squishes are bright, not boomy (most energy 1.5-8 kHz): a dense cluster of tiny
    // pops, thin-film bubbles bursting as short rising chirps among wet crackles, swelling in
    // a few uneven lumps. Then a bubbly bloop as each lobe becomes an ubu.
    const start = at(0.14), length = 0.75;
    const lumps = [0.15, 0.45, 0.75].map(centre => centre + rand(-0.06, 0.06));
    const density = x => lumps.reduce((sum, c) => sum + Math.exp(-(((x - c) / 0.11) ** 2)), 0);
    for (let t = start; t < start + length; t += 0.003) {
      const x = (t - start) / length, d = Math.min(1, density(x));
      if (Math.random() > d * 0.3) continue;
      const pan = rand(-0.3, 0.3);
      if (Math.random() < 0.55) {
        const pitch = rand(1400, 4200);
        blip(ctx, master, t, rand(0.004, 0.01), pitch, pitch * rand(1.3, 1.8), rand(0.04, 0.11) * d, pan);
      } else {
        noiseGrain(ctx, master, t, rand(0.003, 0.008), { freq: rand(1800, 9500), q: rand(1.5, 4), level: rand(0.08, 0.2) * d, pan });
      }
    }
    for (let i = 0; i < 5; i++) blip(ctx, master, at(0.67 + i * 0.03), 0.09, 320, 640, 0.22, (i - 2) * 0.3);
  } else if (type === 'gumball') {
    // Gumball capsule: a light ratchet of clicks as the dome twists, a hollow pop as it comes
    // apart, and a soft rattle as the gumballs jump.
    for (let i = 0; i < 9; i++) noiseGrain(ctx, master, at(0.06 + i * 0.03), 0.003, { freq: 3200, q: 3, level: 0.14 });
    blip(ctx, master, at(0.35), 0.08, 260, 680, 0.28);
    noiseGrain(ctx, master, at(0.35), 0.03, { freq: 1800, q: 1, level: 0.12 });
    [0.4, 0.43, 0.47, 0.5].forEach(fraction => blip(ctx, master, at(fraction), 0.02, rand(900, 1200), rand(700, 850), 0.07, rand(-0.3, 0.3)));
  } else if (type === 'egg') {
    // Egg hatching (after the player's taps): the shell gives with a little crunch and the cap
    // pops off.
    for (let i = 0; i < 5; i++) noiseGrain(ctx, master, at(0.01) + i * 0.012, 0.003, { freq: rand(2600, 5200), q: 2, level: 0.16, pan: rand(-0.3, 0.3) });
    blip(ctx, master, at(0.06), 0.07, 300, 620, 0.2);
  } else if (type === 'gift') {
    // Gift box: a soft satin slide as the ribbon slips off, then a papery pop as the lid lifts.
    noiseGrain(ctx, master, at(0.05), 0.24 * seconds, { freq: 1400, to: 2600, q: 0.9, level: 0.05 });
    blip(ctx, master, at(0.29), 0.09, 180, 420, 0.26);
    noiseGrain(ctx, master, at(0.29), 0.05, { freq: 900, q: 1, level: 0.12, type: 'lowpass' });
  } else if (type === 'cookie') {
    // Fortune cookie: a short, crisp crunch as it snaps, a few crumbs, and the soft flick of the
    // fortune slip unrolling.
    for (let i = 0; i < 16; i++) noiseGrain(ctx, master, at(0.27) + rand(0, 0.07), rand(0.002, 0.006), { freq: rand(800, 3500), q: 1, level: rand(0.18, 0.36), pan: rand(-0.3, 0.3) });
    for (let i = 0; i < 5; i++) noiseGrain(ctx, master, at(rand(0.3, 0.45)), 0.003, { freq: rand(2500, 4500), q: 2, level: 0.08, pan: rand(-0.5, 0.5) });
    noiseGrain(ctx, master, at(0.32), 0.18, { freq: 2200, to: 1500, q: 0.8, level: 0.04 });
  } else if (type === 'envelope') {
    // Envelope: the wax seal cracks with a small snap, the paper flap swishes open, and the card
    // slides out.
    blip(ctx, master, at(0.07), 0.03, 900, 500, 0.12);
    for (let i = 0; i < 6; i++) noiseGrain(ctx, master, at(0.07) + rand(0, 0.04), 0.003, { freq: rand(1500, 4000), q: 1.5, level: 0.16 });
    noiseGrain(ctx, master, at(0.2), 0.2 * seconds, { freq: 1200, to: 2200, q: 0.9, level: 0.04 });
    noiseGrain(ctx, master, at(0.4), 0.18 * seconds, { freq: 2500, to: 1800, q: 0.9, level: 0.035 });
  }
  const charge = Math.max(0, Math.min(5, Math.trunc(options.charge) || 0));
  if (charge > 0) {
    const lvl = 0.07 + charge * 0.032;
    scatter(0.05, 0.58, 4 + charge * 5, (t, speed) => {
      electricSnap(ctx, master, t, lvl * (0.65 + speed * 0.35), rand(-0.45, 0.45));
    });
    const burstAt = at(type === 'cookie' ? 0.28 : type === 'plastic' ? 0.52 : 0.22);
    blip(ctx, master, burstAt, Math.min(0.22, 0.1 + charge * 0.02), 210, 540 + charge * 110, lvl * 0.8);
  }
}

// Coin tinks: each strike is a bright, inharmonic metal ping. 'flick' throws the coin;
// 'land' rattles it to rest with quickening, fading bounces.
function playCoin(kind = 'land', options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const master = createMasterChain(ctx, null, 0.4);
  const now = ctx.currentTime;
  const base = kind === 'flick' ? 2600 : 2300;
  const hits = kind === 'flick' ? [[0, 0.5]] : [[0, 0.7], [0.13, 0.38], [0.22, 0.2], [0.28, 0.1]];
  for (const [at, level] of hits) {
    for (const [ratio, part, decay] of [[1, 1, 0.2], [2.76, 0.42, 0.09], [5.4, 0.18, 0.05]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + at;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base * ratio, start);
      strike(gain, 0.5 * level * part, start, start + decay + 0.02);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start);
      osc.stop(start + decay + 0.05);
    }
  }
}

// A burning ball: a faint, narrow hiss with sparse little fire pops.
function playSizzle(options = {}) {
  const volume = Number.isFinite(options.volume) ? Math.max(0, options.volume) : 1;
  if (!volume) return { stop() {}, setPan() {} };
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return { stop() {}, setPan() {} };
  const cleanup = [], master = createMasterChain(ctx, cleanup);
  const hiss = ctx.createBufferSource(), band = ctx.createBiquadFilter(), level = ctx.createGain();
  const output = ctx.createGain();
  hiss.buffer = grainNoise(ctx); hiss.loop = true;
  band.type = 'bandpass'; band.frequency.value = 1100; band.Q.value = 1.2;
  level.gain.value = 0.035;
  output.gain.setValueAtTime(0, ctx.currentTime);
  output.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.12);
  hiss.connect(band); band.connect(level); level.connect(output);
  let panner = null;
  const initialPan = getPan(options);
  if (ctx.createStereoPanner) {
    panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(initialPan, ctx.currentTime);
    output.connect(panner);
    panner.connect(master);
    cleanup.push(panner);
  } else {
    output.connect(master);
  }
  hiss.onended = () => {
    for (const node of [hiss, band, level, output, ...cleanup]) node.disconnect();
  };
  hiss.start(ctx.currentTime, Math.random() * 0.9);
  let crackles;
  const scheduledCrackles = [];
  const isOffline = isOfflineContext(ctx);
  const scheduleCrackle = (time) => {
    const count = Math.random() < 0.15 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const isPop = Math.random() < 0.25;
      const start = time + k * (0.012 + Math.random() * 0.025);
      const len = isPop ? 0.025 : 0.009;
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      source.buffer = grainNoise(ctx);
      filter.type = 'bandpass'; filter.Q.value = 1.4;
      filter.frequency.value = isPop ? 900 : 2400;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime((isPop ? 0.16 : 0.1) * (0.8 + Math.random() * 0.4), start + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + len);
      source.connect(filter); filter.connect(gain); gain.connect(output);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start(start, Math.random() * 0.8); source.stop(start + len + 0.01);
      if (isOffline) scheduledCrackles.push({ source, start });
    }
  };
  if (isOffline) {
    let t = ctx.currentTime + 0.06;
    const end = ctx.currentTime + (options.duration || 10);
    while (t < end) {
      scheduleCrackle(t);
      t += 0.18 + Math.random() * 0.3;
    }
  } else {
    const crackle = () => {
      scheduleCrackle(ctx.currentTime);
      crackles = setTimeout(crackle, 180 + Math.random() * 300);
    };
    crackles = setTimeout(crackle, 60);
  }
  const handle = {
    setPan(panVal) {
      if (panner && getAudioMode() !== 'mono') {
        try {
          const clamped = Math.max(-0.75, Math.min(0.75, Number(panVal) || 0));
          panner.pan.cancelScheduledValues(ctx.currentTime);
          panner.pan.setValueAtTime(clamped, ctx.currentTime);
        } catch {}
      }
    },
    setCoords(x, y) {
      if (panner) {
        try {
          const pan = panFromField(x, y);
          panner.pan.cancelScheduledValues(ctx.currentTime);
          panner.pan.setValueAtTime(pan, ctx.currentTime);
        } catch {}
      }
    },
    stop() {
      if (!superPlayback.delete(handle)) return;
      if (crackles) clearTimeout(crackles);
      const now = ctx.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(output.gain.value, now);
      output.gain.linearRampToValueAtTime(0, now + 0.15);
      hiss.stop(now + 0.16);
      for (const item of scheduledCrackles) {
        if (item.start > now + 0.16) { try { item.source.stop(item.start); } catch {} }
      }
    }
  };
  superPlayback.add(handle);
  return handle;
}

// Smoothly crossfaded filtered noise grain for continuous wind and puck-on-ice glides.

module.exports = { playVoice, playCollision, playBallHit, playPack, playUnwrap, playCoin, playSizzle };
