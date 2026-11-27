/* Board/goal impacts, fireball explosions, saves, fireworks, supers, fouls, and kickoff jingle. */
'use strict';
const { noteFrequency } = require('./theory.js');
const { getPan, routePanner, getAudioContext, createMasterChain, superPlayback, magnetTimes, getActivePlayback, setActivePlayback, stopAll, getAudioMode } = require('./buses.js');
const { playTone, strike, grainNoise, noiseGrain, blip } = require('./synth.js');
function playWallHit(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const master = createMasterChain(ctx, null, 0.12);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.04, Math.min(1.0, options.volume ?? 0.5));
  const hard = Math.min(1, Math.max(0, (volume - 0.22) / 0.65));
  const speed = Number(options.speed || 0);
  const thock = speed > 0
    ? Math.min(1, Math.max(0, (speed - 340) / 200))
    : Math.min(1, Math.max(0, (volume - 0.58) / 0.28));

  // 1. Dasher board flex body (light & medium hits)
  const body = ctx.createOscillator(), bodyFilter = ctx.createBiquadFilter(), bodyGain = ctx.createGain();
  body.type = 'triangle';
  body.frequency.setValueAtTime(185, now);
  body.frequency.exponentialRampToValueAtTime(88, now + 0.056);
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.setValueAtTime(640, now);
  strike(bodyGain, 0.36 * volume, now, now + 0.068);
  body.connect(bodyFilter); bodyFilter.connect(bodyGain); bodyGain.connect(dest);
  body.start(now); body.stop(now + 0.08);

  // 2. Gentle HDPE board partial
  const cavity = ctx.createOscillator(), cavityGain = ctx.createGain();
  cavity.type = 'sine';
  cavity.frequency.setValueAtTime(435, now);
  cavity.frequency.exponentialRampToValueAtTime(230, now + 0.03);
  strike(cavityGain, (0.13 + 0.12 * hard) * volume, now, now + 0.036);
  cavity.connect(cavityGain); cavityGain.connect(dest);
  cavity.start(now); cavity.stop(now + 0.045);

  // 3. Restrained board/plexiglass slap on medium-hard impacts
  if (hard > 0.05) {
    noiseGrain(ctx, dest, now, 0.026, { freq: 980, to: 470, q: 2.4, level: 0.22 * hard * volume });
    noiseGrain(ctx, dest, now, 0.014, { freq: 2150, to: 1150, q: 2.0, level: 0.12 * hard * volume });
  }

  // 4. Deep hollow dasher-box "THOCK" reserved strictly for truly hard board hits
  if (thock > 0) {
    const thockLevel = thock * volume;

    // "TH-" attack knock transient (fast pitch-drop impact + woody/HDPE face knock)
    const knock = ctx.createOscillator(), knockGain = ctx.createGain();
    knock.type = 'sine';
    knock.frequency.setValueAtTime(820, now);
    knock.frequency.exponentialRampToValueAtTime(165, now + 0.011);
    strike(knockGain, 0.48 * thockLevel, now, now + 0.014, 0.0005);
    knock.connect(knockGain); knockGain.connect(dest);
    knock.start(now); knock.stop(now + 0.018);

    noiseGrain(ctx, dest, now, 0.016, { freq: 1250, to: 310, q: 1.8, level: 0.34 * thockLevel });

    // "-OCK" hollow coupled dasher-box cavity resonance (bandpass-shaped hollow woody/HDPE box mode)
    const box = ctx.createOscillator(), boxFilter = ctx.createBiquadFilter(), boxGain = ctx.createGain();
    box.type = 'triangle';
    box.frequency.setValueAtTime(360, now + 0.002);
    box.frequency.exponentialRampToValueAtTime(192, now + 0.054);
    boxFilter.type = 'bandpass';
    boxFilter.Q.setValueAtTime(3.1, now + 0.002);
    boxFilter.frequency.setValueAtTime(320, now + 0.002);
    boxFilter.frequency.exponentialRampToValueAtTime(205, now + 0.058);
    strike(boxGain, 0.58 * thockLevel, now + 0.002, now + 0.068, 0.0015);
    box.connect(boxFilter); boxFilter.connect(boxGain); boxGain.connect(dest);
    box.start(now + 0.002); box.stop(now + 0.076);

    // Upper "-ock" cavity formant
    const formant = ctx.createOscillator(), formantGain = ctx.createGain();
    formant.type = 'sine';
    formant.frequency.setValueAtTime(540, now + 0.001);
    formant.frequency.exponentialRampToValueAtTime(275, now + 0.038);
    strike(formantGain, 0.34 * thockLevel, now + 0.001, now + 0.046, 0.0012);
    formant.connect(formantGain); formantGain.connect(dest);
    formant.start(now + 0.001); formant.stop(now + 0.052);

    // Deep structural board-frame low thump
    const frame = ctx.createOscillator(), frameGain = ctx.createGain();
    frame.type = 'sine';
    frame.frequency.setValueAtTime(132, now);
    frame.frequency.exponentialRampToValueAtTime(52, now + 0.078);
    strike(frameGain, 0.46 * thockLevel, now, now + 0.088, 0.0015);
    frame.connect(frameGain); frameGain.connect(dest);
    frame.start(now); frame.stop(now + 0.096);
  }
}

// Flaming ball impact: a rushing, blossoming flaming woosh — like a sudden surge of fire
// sweeping across the contact point rather than a percussive impact knock.
function playFireImpact(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const master = createMasterChain(ctx, null, 0.38);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.05, Math.min(1.0, options.volume ?? 0.8));

  // 1. Primary blooming flame roar (smooth swell and sweeping resonance without percussive snap)
  const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
  src.buffer = grainNoise(ctx);
  filter.type = 'lowpass';
  filter.Q.setValueAtTime(1.4, now);
  filter.frequency.setValueAtTime(520, now);
  filter.frequency.exponentialRampToValueAtTime(2600, now + 0.055);
  filter.frequency.exponentialRampToValueAtTime(240, now + 0.44);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.42 * volume, now + 0.048);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);
  src.connect(filter); filter.connect(gain); gain.connect(dest);
  src.start(now, Math.random() * 0.6); src.stop(now + 0.48);

  // 2. High-frequency flame air rush / turbulent heat flare
  const wispSrc = ctx.createBufferSource(), wispFilter = ctx.createBiquadFilter(), wispGain = ctx.createGain();
  wispSrc.buffer = grainNoise(ctx);
  wispFilter.type = 'bandpass';
  wispFilter.Q.setValueAtTime(1.1, now);
  wispFilter.frequency.setValueAtTime(1400, now);
  wispFilter.frequency.exponentialRampToValueAtTime(3200, now + 0.04);
  wispFilter.frequency.exponentialRampToValueAtTime(650, now + 0.36);
  wispGain.gain.setValueAtTime(0.0001, now);
  wispGain.gain.linearRampToValueAtTime(0.24 * volume, now + 0.035);
  wispGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
  wispSrc.connect(wispFilter); wispFilter.connect(wispGain); wispGain.connect(dest);
  wispSrc.start(now, Math.random() * 0.6); wispSrc.stop(now + 0.40);

  // 3. Gentle warm body breath (soft low-frequency fire swell, no click/thud)
  const breath = ctx.createOscillator(), breathGain = ctx.createGain();
  breath.type = 'sine';
  breath.frequency.setValueAtTime(68, now);
  breath.frequency.exponentialRampToValueAtTime(42, now + 0.28);
  breathGain.gain.setValueAtTime(0.0001, now);
  breathGain.gain.linearRampToValueAtTime(0.14 * volume, now + 0.05);
  breathGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
  breath.connect(breathGain); breathGain.connect(dest);
  breath.start(now); breath.stop(now + 0.34);
}

// Goal-line save: a crisp, rewarding metallic blade "shing / tink" (gentler when saving an own-team touch).
function playSave(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const own = Boolean(options.own);
  const master = createMasterChain(ctx, null, own ? 0.2 : 0.32);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.05, Math.min(1.0, options.volume ?? (own ? 0.65 : 0.85)));

  if (own) {
    for (const [hz, part, decay] of [[1318, 0.26, 0.15], [2960, 0.13, 0.08]]) {
      blip(ctx, dest, now, decay, hz * 1.01, hz, part * volume);
    }
    noiseGrain(ctx, dest, now, 0.045, { freq: 3400, to: 2400, q: 4.0, level: 0.1 * volume });
    return;
  }

  // Bright steel "tink" partials + upward harmonic "shing" shimmer
  for (const [from, to, part, decay] of [
    [1740, 1760, 0.34, 0.26],
    [2580, 2640, 0.24, 0.22],
    [4787, 4760, 0.18, 0.14],
    [7180, 7120, 0.09, 0.075]
  ]) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + 0.022);
    strike(gain, part * volume, now, now + decay);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + decay + 0.02);
  }
  noiseGrain(ctx, dest, now, 0.085, { freq: 3100, to: 6200, q: 4.8, level: 0.18 * volume });
}

// Goal firework shell burst: explosive outdoor mortar detonation + sharp shell crack + cascading star crackle for big shells.
function playFirework(options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const isBig = Boolean(options.ring || options.big);
  const duration = isBig ? 1.15 : 0.68;
  const master = createMasterChain(ctx, null, duration + 0.1);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.04, Math.min(1.2, options.volume ?? 0.6));
  const pan = getPan(options);
  const pitch = (0.92 + Math.random() * 0.18) * (isBig ? 0.92 : 1.05);

  // 1. Explosive low-end detonation thump (concussive shell burst)
  const boom = ctx.createOscillator(), boomGain = ctx.createGain();
  const boomDecay = isBig ? 0.28 : 0.18;
  boom.type = 'triangle';
  boom.frequency.setValueAtTime((isBig ? 160 : 190) * pitch, now);
  boom.frequency.exponentialRampToValueAtTime(36, now + boomDecay);
  strike(boomGain, (isBig ? 0.58 : 0.44) * volume, now, now + boomDecay);
  boom.connect(boomGain); boomGain.connect(dest);
  boom.start(now); boom.stop(now + boomDecay + 0.02);

  // 2. High-pressure aerial explosion snap (loud "POW!")
  noiseGrain(ctx, dest, now, isBig ? 0.075 : 0.055, {
    freq: (isBig ? 1400 : 1750) * pitch,
    to: 260,
    q: 1.2,
    level: (isBig ? 0.64 : 0.52) * volume
  });

  // 3. Sharp supersonic shell-crack transient (initial detonation snap)
  noiseGrain(ctx, dest, now, 0.024, {
    freq: 3600 * pitch,
    to: 1200,
    q: 2.0,
    level: (isBig ? 0.55 : 0.42) * volume
  });

  // 4. Expanding shockwave fireball rumble through the sky
  noiseGrain(ctx, dest, now + 0.008, isBig ? 0.26 : 0.16, {
    freq: (isBig ? 480 : 620) * pitch,
    to: 85,
    q: 0.85,
    level: (isBig ? 0.46 : 0.32) * volume
  });

  // 5. Pyrotechnic star crackle: each micro-star detonation is a sub-millisecond N-wave
  // firecracker snap (mid-focused pressure crack + fast downward shockwave pop + open-air slap),
  // firing after the stars streak outward rather than a uniform high-bandpass foil crinkle.
  const firecrackerSnap = (delay, strength, sparkPan, echo = false) => {
    const start = now + delay;
    const snapLen = 0.011 + Math.random() * 0.007;
    const startFreq = (1150 + Math.random() * 850) * pitch;
    const endFreq = 320 + Math.random() * 160;

    const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = grainNoise(ctx);
    band.type = 'bandpass';
    band.Q.setValueAtTime(0.8 + Math.random() * 0.25, start);
    band.frequency.setValueAtTime(startFreq, start);
    band.frequency.exponentialRampToValueAtTime(endFreq, start + snapLen);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(0.42 * strength * volume, start + 0.0005);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + snapLen);
    src.connect(band); band.connect(gain);

    // Percussive N-wave shockwave pop (rapid downward pitch drop gives explosive gunpowder body)
    const pop = ctx.createOscillator(), popGain = ctx.createGain();
    const popLen = 0.007 + Math.random() * 0.004;
    pop.type = 'sine';
    pop.frequency.setValueAtTime((1050 + Math.random() * 650) * pitch, start);
    pop.frequency.exponentialRampToValueAtTime(175 + Math.random() * 85, start + popLen);
    popGain.gain.setValueAtTime(0.0001, start);
    popGain.gain.linearRampToValueAtTime(0.34 * strength * volume, start + 0.0005);
    popGain.gain.exponentialRampToValueAtTime(0.0001, start + popLen);
    pop.connect(popGain);

    let out = master;
    if (sparkPan && ctx.createStereoPanner) {
      out = ctx.createStereoPanner();
      out.pan.setValueAtTime(sparkPan, start);
      out.connect(master);
    }
    gain.connect(out);
    popGain.connect(out);
    src.start(start, Math.random() * 0.85);
    src.stop(start + snapLen + 0.01);
    pop.start(start);
    pop.stop(start + popLen + 0.01);

    if (echo) {
      const tailStart = start + 0.004, tailLen = 0.036 + Math.random() * 0.018;
      const tail = ctx.createBufferSource(), tailBand = ctx.createBiquadFilter(), tailGain = ctx.createGain();
      tail.buffer = grainNoise(ctx);
      tailBand.type = 'bandpass';
      tailBand.Q.setValueAtTime(0.75, tailStart);
      tailBand.frequency.setValueAtTime(720 * pitch, tailStart);
      tailBand.frequency.exponentialRampToValueAtTime(240, tailStart + tailLen);
      tailGain.gain.setValueAtTime(0.0001, tailStart);
      tailGain.gain.linearRampToValueAtTime(0.11 * strength * volume, tailStart + 0.002);
      tailGain.gain.exponentialRampToValueAtTime(0.0001, tailStart + tailLen);
      tail.connect(tailBand); tailBand.connect(tailGain); tailGain.connect(out);
      tail.start(tailStart, Math.random() * 0.85);
      tail.stop(tailStart + tailLen + 0.01);
    }
  };

  if (isBig) {
    // Big shells: irregular staccato firecracker clusters after a brief outward star-flight hang time
    const clusterOffsets = [0.16, 0.21, 0.23, 0.29, 0.34, 0.36, 0.43, 0.49, 0.51, 0.59, 0.66, 0.68, 0.78, 0.89];
    for (let i = 0; i < clusterOffsets.length; i++) {
      const delay = clusterOffsets[i] + (Math.random() - 0.5) * 0.014;
      const sparkSpread = getAudioMode() === 'mono' ? 0 : (Math.random() - 0.5) * 0.48;
      const sparkPan = Math.max(-0.75, Math.min(0.75, pan + sparkSpread));
      const envelope = Math.sin(Math.PI * ((i + 0.8) / (clusterOffsets.length + 1))) ** 0.55;
      const strength = (0.68 + Math.random() * 0.36) * Math.max(0.35, envelope);
      firecrackerSnap(delay, strength, sparkPan, i % 3 === 0);
    }
  } else {
    // Standard shells: 4 crisp, spaced-out star-tip snaps after the main burst
    const stdOffsets = [0.17, 0.26, 0.37, 0.49];
    for (let i = 0; i < stdOffsets.length; i++) {
      const delay = stdOffsets[i] + (Math.random() - 0.5) * 0.02;
      const sparkSpread = getAudioMode() === 'mono' ? 0 : (Math.random() - 0.5) * 0.34;
      const sparkPan = Math.max(-0.75, Math.min(0.75, pan + sparkSpread));
      const strength = (0.58 - i * 0.09) * (0.85 + Math.random() * 0.25);
      firecrackerSnap(delay, strength, sparkPan, false);
    }
  }
}

function playGoalHit(type = 'post', options = {}) {
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const spinNorm = type === 'post' ? Math.min(1, Math.max(0, (Number(options.spin) || 0) / 24)) : 0;
  const speedNorm = type === 'post' ? Math.min(1, Math.max(0, (Number(options.speed) || 0) / 720)) : 0;
  const inflect = spinNorm * (0.4 + 0.6 * speedNorm);
  const postDecay = 0.28 + 0.12 * inflect;
  const master = createMasterChain(ctx, null, type === 'post' ? postDecay + 0.04 : 0.3);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;
  const volume = Math.max(0.05, Math.min(1.0, options.volume ?? 0.8));

  if (type === 'post') {
    const carrier = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const gain = ctx.createGain();

    const baseCarrier = 1650 * (1 + 0.14 * inflect);
    const baseMod = 2780 * (1 + 0.18 * inflect);
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(baseCarrier, now);
    if (inflect > 0.05) {
      carrier.frequency.exponentialRampToValueAtTime(baseCarrier * (1 + 0.07 * inflect), now + 0.045);
      carrier.frequency.exponentialRampToValueAtTime(baseCarrier * (1 + 0.02 * inflect), now + postDecay);
    }
    mod.type = 'sine';
    mod.frequency.setValueAtTime(baseMod, now);

    modGain.gain.setValueAtTime(900 + 350 * inflect, now);
    modGain.gain.exponentialRampToValueAtTime(0.1, now + 0.12 + 0.06 * inflect);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);

    strike(gain, 0.5 * volume, now, now + postDecay);

    carrier.connect(gain);
    gain.connect(dest);
    carrier.start(now);
    mod.start(now);
    carrier.stop(now + postDecay + 0.02);
    mod.stop(now + postDecay + 0.02);

    // Singing metallic "zing-ping" overtone shimmer when Post English spin bites
    if (inflect > 0.1) {
      const zing = ctx.createOscillator(), zingGain = ctx.createGain();
      const zingFreq = 3520 * (1 + 0.12 * inflect);
      const zingDecay = Math.min(postDecay, 0.18 + 0.10 * inflect);
      zing.type = 'sine';
      zing.frequency.setValueAtTime(zingFreq, now);
      zing.frequency.exponentialRampToValueAtTime(zingFreq * (1 + 0.11 * inflect), now + 0.038);
      zing.frequency.exponentialRampToValueAtTime(zingFreq * 0.99, now + zingDecay);
      strike(zingGain, 0.18 * inflect * volume, now, now + zingDecay);
      zing.connect(zingGain);
      zingGain.connect(dest);
      zing.start(now);
      zing.stop(now + zingDecay + 0.02);
    }
  } else {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.09);

    strike(gain, 0.5 * volume, now, now + 0.12);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.13);
  }
}


function playSuper(key, phase = key === 'magnet' ? 'pull' : 'impact', options = {}) {
  const phases = { stalwart: ['launch', 'impact'], knockout: ['impact'], sticky: ['impact'],
    cannonball: ['impact'], magnet: ['pull'], colossus: ['launch'], shockwave: ['impact'], ghost: ['launch', 'phase'] };
  const silent = { stop() {} };
  if (!phases[key]?.includes(phase)) return silent;
  const volume = Number.isFinite(options.volume) ? Math.max(0, Math.min(1, options.volume)) : 0.8;
  if (!volume) return silent;
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return silent;
  const now = ctx.currentTime;
  if (key === 'magnet') {
    if (now - (magnetTimes.get(ctx) ?? -Infinity) < .18) return silent;
    magnetTimes.set(ctx, now);
  }
  const nodes = [], oscillators = [];
  const master = createMasterChain(ctx, nodes);
  const dest = routePanner(ctx, master, options, nodes);
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(volume, now);
  bus.connect(dest);
  nodes.push(bus);
  let ended = 0, stopped = false;
  const handle = { stop() {
    if (stopped) return;
    stopped = true;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setValueAtTime(volume, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(0, ctx.currentTime + .015);
    for (const osc of oscillators) { try { osc.stop(ctx.currentTime + .02); } catch {} }
    superPlayback.delete(handle);
  } };
  function oscillator(type, from, to, duration, dest, detune = 0, offset = 0) {
    const start = now + offset, osc = ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    osc.detune.setValueAtTime(detune, start);
    osc.connect(dest); nodes.push(osc); oscillators.push(osc);
    osc.onended = () => {
      if (++ended === oscillators.length) {
        for (const node of nodes) node.disconnect();
        superPlayback.delete(handle);
      }
    };
    osc.start(start); osc.stop(start + duration + .01);
    return osc;
  }
  function toneAt(offset, type, from, to, duration, level, attack = .003, filter = null, detune = 0) {
    const start = now + offset, gain = ctx.createGain(); nodes.push(gain);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + attack);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    gain.connect(bus);
    let dest = gain;
    if (filter) {
      dest = ctx.createBiquadFilter(); nodes.push(dest);
      dest.type = filter[0]; dest.frequency.setValueAtTime(filter[1], start);
      dest.frequency.exponentialRampToValueAtTime(filter[2], start + duration);
      dest.Q.setValueAtTime(filter[3], start); dest.connect(gain);
    }
    return oscillator(type, from, to, duration, dest, detune, offset);
  }
  function tone(type, from, to, duration, level, attack = .003, filter = null, detune = 0) {
    return toneAt(0, type, from, to, duration, level, attack, filter, detune);
  }
  // Filtered noise from `offset` seconds in: the body of squishes, crackles, blasts and crashes.
  function noise(offset, duration, level, type, from, to, q = 1, attack = .002) {
    const start = now + offset, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    nodes.push(source, filter, gain); oscillators.push(source);
    source.buffer = grainNoise(ctx);
    filter.type = type; filter.Q.setValueAtTime(q, start);
    filter.frequency.setValueAtTime(from, start); filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(level, start + attack);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(filter); filter.connect(gain); gain.connect(bus);
    source.onended = () => {
      if (++ended === oscillators.length) { for (const n of nodes) n.disconnect(); superPlayback.delete(handle); }
    };
    source.start(start, Math.random() * .5); source.stop(start + duration + .01);
  }
  function modulate(carrier, type, hz, depth, duration, offset = 0) {
    const start = now + offset, gain = ctx.createGain(); nodes.push(gain);
    gain.gain.setValueAtTime(depth, start);
    gain.gain.exponentialRampToValueAtTime(.01, start + duration);
    gain.connect(carrier.frequency);
    oscillator(type, hz, hz, duration, gain, 0, offset);
  }
  // Each super's signature sound.
  if (key === 'stalwart') {
    // Clanking steel: inharmonic metal partials ringing off a sharp strike; a lighter clank on each hit.
    const hit = phase === 'impact', scale = hit ? .45 : 1;
    [[523, .2, .55], [1371, .12, .4], [2211, .07, .28], [3187, .04, .2]].forEach(([hz, level, decay]) =>
      tone('sine', hz, hz * .995, decay * scale + .04, level * (hit ? .7 : 1), .001));
    noise(0, .03, hit ? .15 : .25, 'highpass', 3500, 2500, .7);
  } else if (key === 'knockout') {
    // A heavyweight arcade "POW!": deep gut-punch sub drop, upper-bass chest thump, leather-glove
    // smack crack, and a punchy detuned power-bark sting.
    toneAt(0, 'sine', 180, 36, .42, .94, .0015);
    toneAt(0, 'triangle', 320, 58, .22, .68, .002, ['lowpass', 1150, 190, 2.2]);
    toneAt(.005, 'sawtooth', 440, 116, .24, .34, .003, ['lowpass', 2800, 320, 3.0], -7);
    toneAt(.005, 'sawtooth', 660, 174, .20, .24, .003, ['lowpass', 2800, 360, 2.8], 7);
    noise(0, .085, .74, 'bandpass', 1150, 340, 1.15, .0015);
    noise(0, .042, .54, 'bandpass', 2900, 950, 1.5, .001);
    toneAt(.014, 'sine', 1320, 1280, .35, .075, .004);
  } else if (key === 'sticky') {
    // A playful, elastic slimy goop splat: warm rubbery glomp + upward suction scoop + bouncy jelly
    // bubble pops, avoiding harsh high-kHz wet crackles.
    toneAt(0, 'sine', 215, 76, .12, .58, .003);
    noise(0, .11, .48, 'bandpass', 720, 240, 2.8, .004);
    const glorp = toneAt(.02, 'triangle', 175, 520, .19, .42, .012, ['bandpass', 320, 980, 4.2]);
    modulate(glorp, 'sine', 19, 28, .19, .02);
    toneAt(.055, 'sine', 290, 640, .065, .3, .004);
    toneAt(.115, 'sine', 390, 820, .055, .24, .004);
    toneAt(.165, 'sine', 340, 710, .048, .16, .004);
  } else if (key === 'cannonball') {
    // An explosion: a burst that darkens as it fades, over a low boom.
    noise(0, .7, .4, 'lowpass', 4200, 140, .7);
    tone('sine', 75, 30, .55, .5, .003);
  } else if (key === 'magnet') {
    // A wobbling tractor beam: a hum with a slow vibrato that rises in pitch and pulse rate as the ball draws closer.
    const closeness = Math.min(1, Math.max(0, Number(options.closeness) || 0));
    const baseHz = 215 + 65 * closeness;
    const carrier = tone('sine', baseHz, baseHz * (0.98 + 0.04 * closeness), .24, .1 + .035 * closeness, .035);
    modulate(carrier, 'sine', 7 + 5 * closeness, 22 + 12 * closeness, .24);
    tone('triangle', baseHz * 1.5, baseHz * 1.48, .24, .03 + .015 * closeness, .035);
  } else if (key === 'colossus') {
    // A thunderous titan awakening: sky-splitting lightning crack, audible low-brass/sub giant stomp,
    // and rolling multi-wave arena thunder rumble.
    noise(0, .15, .68, 'bandpass', 2500, 380, .85, .002);
    noise(.015, .11, .46, 'bandpass', 1200, 240, 1.1, .003);
    toneAt(0, 'sine', 88, 31, .88, .88, .004);
    toneAt(0, 'sawtooth', 112, 44, .78, .44, .008, ['lowpass', 720, 115, 2.4], -8);
    toneAt(.01, 'triangle', 56, 28, .82, .48, .01, ['lowpass', 420, 85, 1.8], 8);
    noise(.03, .88, .56, 'lowpass', 920, 75, .9, .012);
    noise(.16, .76, .42, 'bandpass', 380, 88, 1.2, .055);
    noise(.32, .60, .34, 'lowpass', 540, 68, .8, .07);
  } else if (key === 'shockwave') {
    // Kinetic sonic force-repulsor: tight vacuum pre-snap into a clean sub-sonic concussion drop,
    // sleek air-pressure wave, and dispersive sci-fi harmonic ring shimmer.
    toneAt(0, 'sine', 190, 960, .022, .42, .002);
    toneAt(.014, 'sine', 360, 40, .46, .86, .002);
    toneAt(.014, 'triangle', 540, 78, .28, .38, .003, ['lowpass', 1500, 160, 2.0]);
    noise(.01, .40, .42, 'bandpass', 2400, 210, 2.4, .004);
    const r1 = toneAt(.018, 'sine', 587, 392, .50, .20, .008);
    const r2 = toneAt(.024, 'sine', 880, 587, .48, .16, .010, null, 7);
    const r3 = toneAt(.030, 'sine', 1318, 880, .44, .11, .012, null, -7);
    modulate(r1, 'sine', 14, 18, .50, .018);
    modulate(r2, 'sine', 16, 24, .48, .024);
  } else if (key === 'ghost') {
    if (phase === 'phase') {
      // Ectoplasmic pass-through shimmer when phasing through a blocker
      const wisp = tone('sine', 880, 1320, .24, .075, .015);
      modulate(wisp, 'sine', 22, 45, .24);
      tone('triangle', 1320, 990, .22, .04, .02);
      noise(0, .18, .09, 'bandpass', 1650, 2800, 2.8, .01);
    } else {
      // Like the magnet's beam, but faster and higher, drifting down as it fades.
      const carrier = tone('sine', 700, 600, .7, .09, .05);
      modulate(carrier, 'sine', 16, 55, .7);
      tone('sine', 1050, 900, .7, .03, .06);
    }
  }
  superPlayback.add(handle);
  return handle;
}

// Guard Beat 1 (planning toggle): two close-set skate edges planting into the ice when Guard is armed,
// or a light un-weighting blade release when Guard is cleared.
function playGuardToggle(on = true, options = {}) {
  const volume = Number.isFinite(options.volume) ? Math.max(0, Math.min(1.5, options.volume)) : 0.75;
  if (!volume) return;
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const master = createMasterChain(ctx, null, 0.16);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;

  if (!on) {
    noiseGrain(ctx, dest, now, 0.052, { freq: 1380, to: 720, q: 2.1, level: 0.095 * volume });
    blip(ctx, dest, now, 0.038, 210, 145, 0.075 * volume);
    return;
  }

  // Twin staggered skate-edge bites (~19 ms apart) + compact low boot-plant weight
  for (const [offset, freqFrom, freqTo, grainLvl, thudFrom, thudTo, thudLvl] of [
    [0.000, 2050, 960, 0.19, 176, 78, 0.20],
    [0.019, 2480, 1140, 0.23, 215, 92, 0.16]
  ]) {
    const t = now + offset;
    noiseGrain(ctx, dest, t, 0.024, { freq: freqFrom, to: freqTo, q: 2.6, level: grainLvl * volume });
    const boot = ctx.createOscillator(), bootGain = ctx.createGain();
    boot.type = 'triangle';
    boot.frequency.setValueAtTime(thudFrom, t);
    boot.frequency.exponentialRampToValueAtTime(thudTo, t + 0.032);
    strike(bootGain, thudLvl * volume, t, t + 0.038);
    boot.connect(bootGain);
    bootGain.connect(dest);
    boot.start(t);
    boot.stop(t + 0.045);
  }
  // Subtle cold-steel edge lock glint
  blip(ctx, dest, now + 0.019, 0.028, 1420, 1180, 0.048 * volume);
}

// Guard Beat 2 (absorbing an impact in play): scaled low-mid braced knock + shield shell resonance
// + heel-blade ice anchor grit so strong defensive reads carry physical weight anywhere on the rink.
function playGuardHit(options = {}) {
  const volume = Number.isFinite(options.volume) ? Math.max(0, Math.min(1.5, options.volume)) : 0.85;
  if (!volume) return;
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const strength = Math.max(0.06, Math.min(1.0, Number(options.strength) ?? 0.55));
  const graze = Math.max(0, Math.min(1, Number(options.graze) || 0));
  const square = 1 - 0.42 * graze;
  const hold = 0.07 + 0.08 * strength;
  const master = createMasterChain(ctx, null, hold + 0.05);
  const dest = routePanner(ctx, master, options);
  const now = ctx.currentTime;

  // 1. Planted low knock (barely murmurs on a soft poke, lands with heavy chest-thud on a hard drive)
  const knockDur = 0.048 + 0.052 * strength;
  const knock = ctx.createOscillator(), knockGain = ctx.createGain();
  knock.type = 'triangle';
  knock.frequency.setValueAtTime((148 + 42 * strength) * (0.92 + 0.08 * square), now);
  knock.frequency.exponentialRampToValueAtTime(48 + 14 * (1 - strength), now + knockDur);
  strike(knockGain, (0.14 + 0.48 * strength) * square * volume, now, now + knockDur);
  knock.connect(knockGain);
  knockGain.connect(dest);
  knock.start(now);
  knock.stop(now + knockDur + 0.015);

  // 2. Braced shield face transient & hollow pad shell
  const shell = ctx.createOscillator(), shellFilter = ctx.createBiquadFilter(), shellGain = ctx.createGain();
  const shellDur = 0.036 + 0.034 * strength;
  shell.type = 'triangle';
  shell.frequency.setValueAtTime(390 + 110 * strength, now);
  shell.frequency.exponentialRampToValueAtTime(185, now + shellDur);
  shellFilter.type = 'bandpass';
  shellFilter.Q.setValueAtTime(2.7, now);
  shellFilter.frequency.setValueAtTime(360 + 90 * strength, now);
  strike(shellGain, (0.10 + 0.30 * strength) * volume, now, now + shellDur);
  shell.connect(shellFilter);
  shellFilter.connect(shellGain);
  shellGain.connect(dest);
  shell.start(now);
  shell.stop(now + shellDur + 0.015);

  // 3. Heel-blade ice anchor grit on medium-to-heavy stops (defender holding their ground)
  if (strength > 0.24) {
    const grit = (strength - 0.24) / 0.76;
    noiseGrain(ctx, dest, now + 0.004, 0.045 + 0.045 * grit, {
      freq: 1550 + 450 * grit,
      to: 680,
      q: 2.1,
      level: 0.20 * grit * volume
    });
  }
}

// An iron save: a heavy metallic clank with a sharp hiss of steam rushing through it.
function playIronSave(options = {}) {
  const volume = Number.isFinite(options.volume) ? Math.max(0, Math.min(1.5, options.volume)) : 1;
  if (!volume) return;
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const master = createMasterChain(ctx, null, 0.4), now = ctx.currentTime + 0.005;
  const dest = routePanner(ctx, master, options);
  for (const [hz, level, decay] of [[587, .25, .45], [1480, .15, .32], [2480, .09, .22]]) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(hz, now);
    gain.gain.setValueAtTime(level * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(gain); gain.connect(dest);
    osc.start(now); osc.stop(now + decay + 0.01);
  }
  try {
    const noiseSource = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), steamGain = ctx.createGain();
    noiseSource.buffer = grainNoise(ctx);
    filter.type = 'bandpass'; filter.Q.setValueAtTime(1.8, now);
    filter.frequency.setValueAtTime(3600, now); filter.frequency.exponentialRampToValueAtTime(800, now + 0.35);
    steamGain.gain.setValueAtTime(0.001, now);
    steamGain.gain.linearRampToValueAtTime(0.35 * volume, now + 0.015);
    steamGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    noiseSource.connect(filter); filter.connect(steamGain); steamGain.connect(dest);
    noiseSource.start(now); noiseSource.stop(now + 0.36);
  } catch {}
}

// Fouls: a soft two-note "doot doot" when a warning first appears, like a system alert, and a light
// referee's whistle for a yellow card. Both stay short and quiet so a stalled scrum never nags.
function playFoul(kind = 'warning', options = {}) {
  const volume = Number.isFinite(options.volume) ? Math.max(0, Math.min(1.5, options.volume)) : 1;
  if (!volume) return;
  const ctx = options.ctx || getAudioContext();
  if (!ctx) return;
  const master = createMasterChain(ctx, null, 0.4), now = ctx.currentTime + 0.01;
  const dest = routePanner(ctx, master, options);
  if (kind === 'warning') {
    const peak = Math.max(0.0002, 0.12 * volume);
    for (const [at, freq] of [[0, 784], [0.16, 659]]) {
      const start = now + at, gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      gain.gain.setValueAtTime(peak, start + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      gain.connect(dest);
      for (const [type, ratio, level] of [['sine', 1, 1], ['triangle', 2, 0.12]]) {
        const osc = ctx.createOscillator(), part = ctx.createGain();
        osc.type = type; osc.frequency.setValueAtTime(freq * ratio, start);
        part.gain.setValueAtTime(level, start);
        osc.connect(part); part.connect(gain);
        osc.start(start); osc.stop(start + 0.16);
      }
    }
    return;
  }
  // The whistle: a high tone rising slightly, trilled by the pea, with a breath of air under it.
  const osc = ctx.createOscillator(), trill = ctx.createOscillator(), depth = ctx.createGain(), gain = ctx.createGain(), end = now + 0.34;
  osc.type = 'sine';
  osc.frequency.setValueAtTime(2050, now);
  osc.frequency.linearRampToValueAtTime(2250, now + 0.06);
  trill.frequency.setValueAtTime(26, now); depth.gain.setValueAtTime(55, now);
  trill.connect(depth); depth.connect(osc.frequency);
  const whistlePeak = Math.max(0.0002, 0.08 * volume);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(whistlePeak, now + 0.025);
  gain.gain.setValueAtTime(whistlePeak, now + 0.24);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain); gain.connect(dest);
  osc.start(now); trill.start(now); osc.stop(end + 0.02); trill.stop(end + 0.02);
  noiseGrain(ctx, dest, now, 0.3, { freq: 2200, q: 1.5, level: 0.02 * volume });
}

function playGameStart(options = {}) {
  const isCtx = options && typeof options.createOscillator === 'function';
  const opts = isCtx ? { ctx: options } : (options || {});
  if (!opts.overlap) stopAll();
  const ctx = opts.ctx || getAudioContext();
  if (!ctx) return { stop() {} };

  const volume = Number.isFinite(opts.volume)
    ? Math.max(0.01, Math.min(1.5, opts.volume))
    : 0.95;

  const master = createMasterChain(ctx, null, 2.2, 'music');
  const step = 60 / 150 / 4; // 16th-note grid at 150 BPM (0.10s per step)
  const now = ctx.currentTime + 0.03;
  const activeNodes = [];

  function schedule(instrument, midi, startStep, stepLen, decaySec, vol, timbreMod = 0, pitchBend = 0) {
    const handle = playTone(ctx, master, {
      instrument,
      freq: noteFrequency(midi),
      startTime: now + startStep * step,
      duration: stepLen * step,
      decay: decaySec,
      timbreMod,
      pitchBend,
      volume: vol * volume
    });
    activeNodes.push(handle);
  }

  // 1. Lead Fanfare: Brass Ping (11) + Square Chip (4)
  const leadMelody = [
    [67,  0, 1.0, 0.14, 0.75, 0.45, 0],   // G4
    [72,  1, 1.0, 0.14, 0.80, 0.45, 0],   // C5
    [74,  2, 1.0, 0.14, 0.85, 0.50, 0],   // D5
    [76,  3, 1.0, 0.16, 0.90, 0.50, 0],   // E5
    [79,  4, 1.8, 0.24, 0.95, 0.55, 1.0], // G5 (accented call)
    [76,  6, 1.0, 0.15, 0.80, 0.45, 0],   // E5
    [81,  7, 1.8, 0.24, 1.00, 0.55, 1.0], // A5 (heroic lift)
    [79,  9, 1.8, 0.24, 0.95, 0.50, 0],   // G5
    [84, 11, 7.0, 0.85, 1.05, 0.60, 1.5]  // C6 (triumphant apex)
  ];

  for (const [midi, s, len, dec, bVol, cVol, bend] of leadMelody) {
    schedule(11, midi, s, len, dec, bVol, 2, bend);
    schedule(4,  midi, s, len, dec, cVol, 1, 0);
  }

  // 2. Harmony Stabs: Electric Piano (12) on IV-V cadence & Warm Pad (6) + Brass (11) on I Cadd9 finale
  const harmonyStabs = [
    [12, 65,  4, 2.5, 0.28, 0.55, 1],
    [12, 72,  4, 2.5, 0.28, 0.50, 1],
    [12, 67,  7, 3.5, 0.35, 0.60, 1],
    [12, 71,  7, 3.5, 0.35, 0.55, 1],
    [12, 74,  7, 3.5, 0.35, 0.55, 1],
    [6,  60, 11, 7.5, 0.90, 0.65, 1],
    [6,  64, 11, 7.5, 0.90, 0.60, 1],
    [6,  67, 11, 7.5, 0.90, 0.60, 1],
    [11, 76, 11, 6.5, 0.78, 0.65, 2],
    [11, 79, 11, 6.5, 0.78, 0.65, 2]
  ];

  for (const [inst, midi, s, len, dec, vol, mod] of harmonyStabs) {
    schedule(inst, midi, s, len, dec, vol, mod);
  }

  // 3. Bassline: Synth Bass (13) + Sub Pluck (7) anchor
  const bassNotes = [
    [13, 48,  0, 3.5, 0.32, 0.85, 2], // C3 pickup pedal
    [13, 41,  4, 2.8, 0.28, 0.90, 2], // F2 (IV)
    [13, 43,  7, 3.8, 0.35, 0.95, 2], // G2 (V)
    [13, 36, 11, 7.0, 0.80, 1.00, 2], // C2 (I root bite)
    [7,  48, 11, 7.0, 0.85, 0.95, 0]  // C3 Sub Pluck punch
  ];

  for (const [inst, midi, s, len, dec, vol, mod] of bassNotes) {
    schedule(inst, midi, s, len, dec, vol, mod);
  }

  // 4. Woodblock (1) face-off ticks + Resonant Pluck (2) & Crystal Chime (3) finale accents
  for (const [s, midi] of [[0, 72], [2, 76], [4, 79], [7, 81]]) {
    schedule(1, midi, s, 0.5, 0.09, 0.45, 2);
  }
  schedule(2, 84, 11,   5.0, 0.65, 0.55, 2);
  schedule(3, 79, 11.5, 4.0, 0.55, 0.50, 1);
  schedule(3, 86, 12.2, 4.0, 0.55, 0.50, 1);
  schedule(3, 96, 13.0, 5.0, 0.70, 0.55, 1);

  const handle = {
    stop() {
      for (const node of activeNodes) node.stop();
      if (getActivePlayback() === handle) setActivePlayback(null);
    }
  };
  if (!opts.overlap) setActivePlayback(handle);
  return handle;
}

// Fanfare & Anthem finishing: deterministic room impulses per acoustic stage, gentle bus
// compression, and clean ConstantSource release timers so OfflineAudioContext MP4 exports match live playback.

module.exports = { playWallHit, playFireImpact, playSave, playFirework, playGoalHit, playSuper, playGuardToggle, playGuardHit, playIronSave, playFoul, playGameStart };
