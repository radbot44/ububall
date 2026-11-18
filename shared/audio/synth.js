/* 16-instrument procedural WebAudio synthesizer and transient grain primitives. */
'use strict';
const pulseWaves = new WeakMap();
function playTone(ctx, dest, params) {
  const {
    instrument = 0,
    freq = 440,
    startTime = ctx.currentTime,
    duration = 0.3,
    decay = 0.3,
    timbreMod = 0,
    pitchBend = 0, // semitone upward pitch scoop for voice inflection
    volume = 1.0,
    soft = 0, // seconds to fade in over, so sharp instrument attacks never click
    cleanupNode = null
  } = params;

  const stopNodes = [];
  const envGain = ctx.createGain();
  envGain.gain.setValueAtTime(0.0001, startTime);

  const targetDecay = Math.max(0.05, Math.min(decay, duration * 1.5));
  const endTime = startTime + targetDecay + 0.05;

  // Connect envelope through a volume scaler to destination
  const volGain = ctx.createGain();
  const clampedVol = Math.max(0.01, Math.min(2.0, volume));
  volGain.gain.setValueAtTime(clampedVol, startTime);

  if (soft) {
    const guard = ctx.createGain();
    guard.gain.setValueAtTime(0, startTime);
    guard.gain.linearRampToValueAtTime(1, startTime + soft);
    envGain.connect(guard);
    guard.connect(volGain);
  } else {
    envGain.connect(volGain);
  }
  volGain.connect(dest);

  // 2-bit timbreMod bitflags: bit 0 adds detune chorus, bit 1 boosts overtone/filter resonance (3 combines both).
  const detuneCents = (timbreMod & 1) ? 7 : 0;
  const resonanceBoost = (timbreMod & 2) ? 4 : 0;
  const bendDur = Math.min(0.045, targetDecay * 0.35);
  const setScoopedFreq = (osc, baseFreq) => {
    if (pitchBend) {
      osc.frequency.setValueAtTime(Math.max(20, baseFreq * Math.pow(2, -pitchBend / 12)), startTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, baseFreq), startTime + bendDur);
    } else {
      osc.frequency.setValueAtTime(baseFreq, startTime);
    }
  };

  switch (instrument) {
    // 0: Soft Bell (rounded strike with a gently lingering, inharmonic ring)
    case 0: {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sine';
      osc2.type = 'sine';
      setScoopedFreq(osc1, freq);
      setScoopedFreq(osc2, freq * 2.76);
      if (detuneCents) osc2.detune.setValueAtTime(detuneCents * 1.5, startTime);

      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.22 + (resonanceBoost ? 0.06 : 0), startTime);
      g2.gain.exponentialRampToValueAtTime(0.025, startTime + targetDecay);

      osc1.connect(envGain);
      osc2.connect(g2);
      g2.connect(envGain);

      envGain.gain.linearRampToValueAtTime(0.65, startTime + 0.012);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

      osc1.start(startTime);
      osc2.start(startTime);
      osc1.stop(endTime);
      osc2.stop(endTime);
      stopNodes.push(osc1, osc2);
      break;
    }

    // 1: Woodblock (two short cavity resonances, with almost no pitch sweep)
    case 1: {
      const ring = Math.min(0.11, targetDecay * 0.55);
      const bendFactor = pitchBend ? Math.pow(2, -pitchBend / 12) : 1.04;
      for (const [ratio, level, length] of [[1, 0.65, ring], [2.35, 0.3 + (resonanceBoost ? 0.08 : 0), ring * 0.45]]) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(Math.max(20, freq * ratio * bendFactor), startTime);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * ratio), startTime + (pitchBend ? Math.min(0.025, ring * 0.5) : 0.008));
        if (ratio > 1 && detuneCents) osc.detune.setValueAtTime(detuneCents * 2, startTime);
        gain.gain.setValueAtTime(level, startTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + length);
        osc.connect(gain); gain.connect(envGain);
        osc.start(startTime); osc.stop(endTime); stopNodes.push(osc);
      }
      envGain.gain.linearRampToValueAtTime(0.8, startTime + 0.002);
      envGain.gain.setValueAtTime(0.8, startTime + ring);
      envGain.gain.linearRampToValueAtTime(0, startTime + ring + 0.005);
      break;
    }

    // 2: Resonant Pluck (saw wave with resonant lowpass filter sweep)
    case 2: {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      setScoopedFreq(osc, freq);
      if (detuneCents) osc.detune.setValueAtTime(detuneCents, startTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(4800, freq * 6), startTime);
      filter.frequency.exponentialRampToValueAtTime(Math.max(150, freq * 0.8), startTime + targetDecay * 0.7);
      filter.Q.setValueAtTime(4.0 + resonanceBoost, startTime);

      osc.connect(filter);
      filter.connect(envGain);

      envGain.gain.linearRampToValueAtTime(0.5, startTime + 0.006);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

      osc.start(startTime);
      osc.stop(endTime);
      stopNodes.push(osc);
      break;
    }

    // 3: Crystal Chime (dual glassy sine with detune)
    case 3: {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'sine'; o2.type = 'sine';
      setScoopedFreq(o1, freq);
      setScoopedFreq(o2, freq * 2.5);
      o1.detune.setValueAtTime(-4 - detuneCents * 0.5, startTime);
      o2.detune.setValueAtTime(6 + detuneCents, startTime);

      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.4 + (resonanceBoost ? 0.08 : 0), startTime);
      g2.gain.exponentialRampToValueAtTime(0.025, startTime + targetDecay * 0.6);

      o1.connect(envGain);
      o2.connect(g2);
      g2.connect(envGain);

      envGain.gain.linearRampToValueAtTime(0.6, startTime + 0.015);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

      o1.start(startTime); o2.start(startTime);
      o1.stop(endTime); o2.stop(endTime);
      stopNodes.push(o1, o2);
      break;
    }

    // 4: Square Chip (8-bit square with vibrato)
    case 4: {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      setScoopedFreq(osc, freq);
      if (detuneCents) osc.detune.setValueAtTime(detuneCents, startTime);

      // Subtle vibrato
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(6.0 + (resonanceBoost ? 1.5 : 0), startTime);
      lfoGain.gain.setValueAtTime(0, startTime);
      lfoGain.gain.setValueAtTime(0, startTime + Math.min(0.06, targetDecay * 0.5));
      lfoGain.gain.linearRampToValueAtTime(freq * 0.012, startTime + Math.min(0.18, targetDecay));
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      osc.connect(envGain);

      envGain.gain.linearRampToValueAtTime(0.35, startTime + 0.004);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay * 0.8);

      osc.start(startTime); lfo.start(startTime);
      osc.stop(endTime); lfo.stop(endTime);
      stopNodes.push(osc, lfo);
      break;
    }

    // 5: Pulse Pluck (25% duty pulse, with a short, modest filter closure)
    case 5: {
      if (!pulseWaves.has(ctx)) {
        const real = new Float32Array(33), imag = new Float32Array(33);
        for (let n = 1; n < real.length; n++) {
          real[n] = Math.sin(n * Math.PI / 2) / n;
          imag[n] = (1 - Math.cos(n * Math.PI / 2)) / n;
        }
        pulseWaves.set(ctx, ctx.createPeriodicWave(real, imag));
      }
      const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter();
      osc.setPeriodicWave(pulseWaves.get(ctx));
      setScoopedFreq(osc, freq);
      if (detuneCents) osc.detune.setValueAtTime(detuneCents, startTime);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(6500, freq * 9), startTime);
      filter.frequency.exponentialRampToValueAtTime(Math.max(180, freq * 2), startTime + targetDecay * 0.4);
      filter.Q.value = 0.7 + resonanceBoost * 0.15;
      osc.connect(filter); filter.connect(envGain);
      envGain.gain.linearRampToValueAtTime(0.42, startTime + 0.003);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay * 0.8);
      osc.start(startTime); osc.stop(endTime); stopNodes.push(osc);
      break;
    }

    // 6: Warm Pad (a rounded swell; the quiet octave adds colour without a second chord tone)
    case 6: {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), overtone = ctx.createGain();
      o1.type = 'sine'; o2.type = 'sine';
      setScoopedFreq(o1, freq);
      setScoopedFreq(o2, freq * 2);
      if (detuneCents) o2.detune.setValueAtTime(detuneCents, startTime);
      overtone.gain.value = 0.18 + (resonanceBoost ? 0.07 : 0);
      o1.connect(envGain); o2.connect(overtone); overtone.connect(envGain);
      const attack = Math.min(0.09, targetDecay * 0.3);
      envGain.gain.linearRampToValueAtTime(0.5, startTime + attack);
      envGain.gain.linearRampToValueAtTime(0.38, startTime + targetDecay * 0.6);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);
      o1.start(startTime); o2.start(startTime);
      o1.stop(endTime); o2.stop(endTime); stopNodes.push(o1, o2);
      break;
    }

    // 7: Sub Pluck (a rounded low knock with a tiny pitch transient, no bell overtones)
    case 7: {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const subFreq = freq > 320 ? freq * 0.5 : freq;
      const transient = (1.35 + (resonanceBoost ? 0.15 : 0)) * (pitchBend ? Math.pow(2, -pitchBend / 24) : 1);
      osc.frequency.setValueAtTime(Math.max(20, subFreq * transient), startTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, subFreq), startTime + 0.018);
      if (detuneCents) osc.detune.setValueAtTime(detuneCents, startTime);
      osc.connect(envGain);
      envGain.gain.linearRampToValueAtTime(0.8, startTime + 0.004);
      envGain.gain.exponentialRampToValueAtTime(0.2, startTime + targetDecay * 0.18);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay * 0.75);
      osc.start(startTime); osc.stop(endTime); stopNodes.push(osc);
      break;
    }

    // 8: Kalimba (a bright, brief tine buzz followed by a small, clean pluck)
    case 8: {
      const body = ctx.createOscillator(), tine = ctx.createOscillator(), tineGain = ctx.createGain();
      body.type = 'sine'; tine.type = 'triangle';
      setScoopedFreq(body, freq);
      setScoopedFreq(tine, freq * 5.4);
      if (detuneCents) tine.detune.setValueAtTime(detuneCents * 2, startTime);
      tineGain.gain.setValueAtTime(0.32 + (resonanceBoost ? 0.08 : 0), startTime);
      tineGain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(0.028, targetDecay * 0.3));
      body.connect(envGain); tine.connect(tineGain); tineGain.connect(envGain);
      envGain.gain.linearRampToValueAtTime(0.6, startTime + 0.002);
      envGain.gain.exponentialRampToValueAtTime(0.16, startTime + targetDecay * 0.18);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);
      body.start(startTime); tine.start(startTime);
      body.stop(endTime); tine.stop(endTime); stopNodes.push(body, tine);
      break;
    }

    // 9: Marimba (soft wooden mallet body with a rapidly fading fourth-harmonic knock)
    case 9: {
      const body = ctx.createOscillator(), strike = ctx.createOscillator(), strikeGain = ctx.createGain();
      body.type = 'sine'; strike.type = 'sine';
      setScoopedFreq(body, freq);
      setScoopedFreq(strike, freq * 4);
      if (detuneCents) strike.detune.setValueAtTime(detuneCents * 2, startTime);
      strikeGain.gain.setValueAtTime(0.38 + (resonanceBoost ? 0.08 : 0), startTime);
      strikeGain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(0.045, targetDecay * 0.4));
      body.connect(envGain); strike.connect(strikeGain); strikeGain.connect(envGain);
      const ring = Math.min(0.32, targetDecay * 0.7);
      envGain.gain.linearRampToValueAtTime(0.7, startTime + 0.006);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + ring);
      body.start(startTime); strike.start(startTime);
      body.stop(endTime); strike.stop(endTime); stopNodes.push(body, strike);
      break;
    }

    // 10: Vibraphone (a metallic upper partial and a rounded tremolo ring)
    case 10: {
      const osc = ctx.createOscillator();
      const trem = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();

      osc.type = 'sine';
      setScoopedFreq(osc, freq);

      const overtone = ctx.createOscillator(), overtoneGain = ctx.createGain();
      overtone.type = 'sine';
      setScoopedFreq(overtone, freq * 3);
      if (detuneCents) overtone.detune.setValueAtTime(detuneCents * 1.5, startTime);
      overtoneGain.gain.setValueAtTime(0.24, startTime);
      overtoneGain.gain.exponentialRampToValueAtTime(0.015, startTime + targetDecay * 0.55);
      overtone.connect(overtoneGain); overtoneGain.connect(trem);

      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(5.4, startTime);
      lfoGain.gain.setValueAtTime(0.25 + (resonanceBoost ? 0.07 : 0), startTime);
      trem.gain.setValueAtTime(0.75, startTime);

      lfo.connect(lfoGain);
      lfoGain.connect(trem.gain);

      osc.connect(trem);
      trem.connect(envGain);

      envGain.gain.linearRampToValueAtTime(0.6, startTime + 0.01);
      envGain.gain.exponentialRampToValueAtTime(0.18, startTime + targetDecay * 0.5);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

      overtone.start(startTime); overtone.stop(endTime); stopNodes.push(overtone);
      osc.start(startTime); lfo.start(startTime);
      osc.stop(endTime); lfo.stop(endTime);
      stopNodes.push(osc, lfo);
      break;
    }

    // 11: Brass Ping (sawtooth with quick envelope filter)
    case 11: {
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      setScoopedFreq(osc, freq);
      if (detuneCents) osc.detune.setValueAtTime(detuneCents, startTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(freq * 1.2, startTime);
      filter.frequency.linearRampToValueAtTime(Math.min(3600, freq * 4.5), startTime + 0.035);
      filter.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 1.1), startTime + targetDecay);
      filter.Q.setValueAtTime(3.2 + resonanceBoost, startTime);

      osc.connect(filter);
      filter.connect(envGain);

      envGain.gain.linearRampToValueAtTime(0.45, startTime + 0.015);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

      osc.start(startTime);
      osc.stop(endTime);
      stopNodes.push(osc);
      break;
    }

    // 12: Electric Piano (a restrained FM tine attack settling into a mellow body)
    case 12: {
      const carrier = ctx.createOscillator(), tine = ctx.createOscillator(), depth = ctx.createGain();
      carrier.type = 'sine'; tine.type = 'sine';
      setScoopedFreq(carrier, freq);
      setScoopedFreq(tine, freq * 3);
      if (detuneCents) tine.detune.setValueAtTime(detuneCents, startTime);
      depth.gain.setValueAtTime(freq * (0.65 + (resonanceBoost ? 0.2 : 0)), startTime);
      depth.gain.exponentialRampToValueAtTime(freq * 0.035, startTime + targetDecay * 0.4);
      tine.connect(depth); depth.connect(carrier.frequency); carrier.connect(envGain);
      envGain.gain.linearRampToValueAtTime(0.62, startTime + 0.005);
      envGain.gain.exponentialRampToValueAtTime(0.2, startTime + targetDecay * 0.3);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);
      carrier.start(startTime); tine.start(startTime);
      carrier.stop(endTime); tine.stop(endTime); stopNodes.push(carrier, tine);
      break;
    }

    // 13: Synth Bass (saw + square with resonant lowpass bite)
    case 13: {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      o1.type = 'sawtooth'; o2.type = 'square';
      setScoopedFreq(o1, freq);
      setScoopedFreq(o2, freq);
      o2.detune.setValueAtTime(detuneCents + 8, startTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(3200, freq * 5), startTime);
      filter.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.9), startTime + targetDecay * 0.6);
      filter.Q.setValueAtTime(2.5 + resonanceBoost * 0.5, startTime);

      o1.connect(filter);
      const squareLevel = ctx.createGain();
      squareLevel.gain.value = 0.4;
      o2.connect(squareLevel); squareLevel.connect(filter);
      filter.connect(envGain);

      envGain.gain.linearRampToValueAtTime(0.42, startTime + 0.008);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

      o1.start(startTime); o2.start(startTime);
      o1.stop(endTime); o2.stop(endTime);
      stopNodes.push(o1, o2);
      break;
    }

    // 14: Robot Vowel (steady pitch under two moving vowel resonances: a short "yow")
    case 14: {
      const osc = ctx.createOscillator(), body = ctx.createGain();
      osc.type = 'square';
      setScoopedFreq(osc, freq);
      if (detuneCents) osc.detune.setValueAtTime(detuneCents, startTime);
      body.gain.value = 0.12;
      osc.connect(body); body.connect(envGain);
      // Keep a little dry fundamental so high notes retain their melody even when
      // their harmonics sit above the vowel bands.
      const vowelEnd = startTime + targetDecay * 0.65;
      for (const [from, to, level] of [[450, 900, 0.8], [2200, 1200, 0.4]]) {
        const filter = ctx.createBiquadFilter(), gain = ctx.createGain();
        filter.type = 'bandpass'; filter.Q.value = 3 + resonanceBoost * 0.25;
        filter.frequency.setValueAtTime(from, startTime);
        filter.frequency.exponentialRampToValueAtTime(to, vowelEnd);
        gain.gain.value = level;
        osc.connect(filter); filter.connect(gain); gain.connect(envGain);
      }
      envGain.gain.linearRampToValueAtTime(0.65, startTime + 0.008);
      envGain.gain.linearRampToValueAtTime(0.45, vowelEnd);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);
      osc.start(startTime); osc.stop(endTime); stopNodes.push(osc);
      break;
    }

    // 15: Space Zap (retro downward pitch sweep)
    case 15:
    default: {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const startRatio = (3.2 + (resonanceBoost ? 0.4 : 0)) * (pitchBend ? Math.pow(2, pitchBend / 24) : 1);
      osc.frequency.setValueAtTime(freq * startRatio, startTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.6), startTime + 0.08);
      if (detuneCents) osc.detune.setValueAtTime(detuneCents * 2, startTime);

      osc.connect(envGain);

      envGain.gain.linearRampToValueAtTime(0.6, startTime + 0.004);
      envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(0.22, targetDecay * 0.5));

      osc.start(startTime);
      osc.stop(endTime);
      stopNodes.push(osc);
      break;
    }
  }

  if (stopNodes[0]) {
    stopNodes[0].onended = () => {
      try {
        volGain.disconnect();
        if (cleanupNode) cleanupNode.disconnect();
      } catch {}
    };
  }

  return {
    endTime,
    stop() {
      try {
        const t = ctx.currentTime;
        envGain.gain.cancelScheduledValues(t);
        envGain.gain.setValueAtTime(Math.max(0.0001, envGain.gain.value || 0.0001), t);
        envGain.gain.linearRampToValueAtTime(0.0001, t + 0.01);
        volGain.gain.cancelScheduledValues(t);
        volGain.gain.setValueAtTime(Math.max(0.0001, volGain.gain.value || clampedVol), t);
        volGain.gain.linearRampToValueAtTime(0.0001, t + 0.01);
        for (const node of stopNodes) {
          try { node.stop(t + 0.015); } catch {}
        }
      } catch {}
    }
  };
}

// Active playback tracker for stop()

function strike(gain, level, now, end) {
  const peak = Number.isFinite(level) ? Math.max(0.0001, level) : 0.0001;
  const safeEnd = Math.max(now + 0.001, end);
  const attack = Math.min(0.003, (safeEnd - now) * 0.35);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, safeEnd);
}


const grainNoiseBuffers = new WeakMap();
function grainNoise(ctx) {
  if (!grainNoiseBuffers.has(ctx)) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    grainNoiseBuffers.set(ctx, buffer);
  }
  return grainNoiseBuffers.get(ctx);
}
// A filtered noise grain: the building block of crinkles, rips and squelches.
function noiseGrain(ctx, dest, start, length, { freq, to = freq, q = 1.2, level, type = 'bandpass', pan = 0 }) {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = grainNoise(ctx);
  filter.type = type;
  filter.Q.setValueAtTime(q, start);
  filter.frequency.setValueAtTime(freq, start);
  if (to !== freq) filter.frequency.exponentialRampToValueAtTime(to, start + length);
  strike(gain, level, start, start + length);
  source.connect(filter);
  filter.connect(gain);
  let out = gain;
  if (pan && ctx.createStereoPanner) {
    out = ctx.createStereoPanner();
    out.pan.setValueAtTime(pan, start);
    gain.connect(out);
  }
  out.connect(dest);
  source.start(start, Math.random() * 0.9);
  source.stop(start + length + 0.02);
}
// A short pitched blip: pops, plops and bloops.
function blip(ctx, dest, start, length, from, to, level, pan = 0) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + length);
  strike(gain, level, start, start + length);
  osc.connect(gain);
  let out = gain;
  if (pan && ctx.createStereoPanner) {
    out = ctx.createStereoPanner();
    out.pan.setValueAtTime(pan, start);
    gain.connect(out);
  }
  out.connect(dest);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

// A crisp Volt electric arc snap: filtered high-band static tick + descending spark chirp.
function electricSnap(ctx, dest, start, level = 0.22, pan = 0) {
  const dur = 0.007 + Math.random() * 0.011;
  noiseGrain(ctx, dest, start, dur, {
    freq: 4600 + Math.random() * 4200,
    to: 1800 + Math.random() * 1400,
    q: 2.6,
    level: Math.min(0.65, level * 1.15),
    pan
  });
  blip(ctx, dest, start, 0.016 + Math.random() * 0.016, 1750 + Math.random() * 1500, 420 + Math.random() * 260, level * 0.55, pan);
}

// Pack shop sounds: 'deal' flicks three packs onto the ice, 'pick' pops the chosen pack to
// centre, 'charge' previews a Charged Pack stage (1-5), 'crack' taps an egg (options.stage 1-3),
// 'reveal' chimes on spotlight reveal (with electric/sparkle accents for charged/material ubus),
// and 'scamper' skitters the opened ubus away.

function smoothNoise(ctx, dest, start, length, { freq, mid = freq, to = freq, q = 1.4, level, type = 'bandpass', pan = 0 }) {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = grainNoise(ctx);
  if (length > 0.75) source.loop = true;
  filter.type = type;
  filter.Q.setValueAtTime(q, start);
  filter.frequency.setValueAtTime(freq, start);
  if (mid !== freq) filter.frequency.exponentialRampToValueAtTime(mid, start + length * 0.45);
  if (to !== mid) filter.frequency.exponentialRampToValueAtTime(to, start + length);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(level, start + length * 0.45);
  gain.gain.linearRampToValueAtTime(0.0001, start + length);
  source.connect(filter);
  filter.connect(gain);
  let out = gain;
  if (pan && ctx.createStereoPanner) {
    out = ctx.createStereoPanner();
    out.pan.setValueAtTime(pan, start);
    gain.connect(out);
  }
  out.connect(dest);
  source.start(start, Math.random() * 0.75);
  source.stop(start + length + 0.02);
  return source;
}

// Subtle moving-ubu wobble: pitch and loudness rise slightly with speed, while size lowers resonant
// pitch & slows wobble rate, and mass deepens FM excursion & low-mid harmonic warmth. Kept light so
// all 6 skaters can move simultaneously without muddying the mix.

module.exports = {
  pulseWaves, playTone, strike, grainNoiseBuffers, grainNoise, noiseGrain, blip, electricSnap, smoothNoise
};
