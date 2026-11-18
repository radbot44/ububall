/* Goal Anthem chord voicing, loop variations, signature pre-beat drops, and backing tracks. */
'use strict';
const { SCALES } = require('./theory.js');
const { playTone, grainNoise } = require('./synth.js');
function padVoicing(tones, previous = null) {
  const sorted = [...tones].sort((a, b) => a - b);
  if (!previous) return sorted;
  let best = sorted, bestCost = Infinity;
  for (let inversion = 0; inversion < 3; inversion++) {
    const voiced = sorted.slice(inversion).concat(sorted.slice(0, inversion).map(n => n + 12));
    for (const octave of [-12, 0, 12]) {
      const candidate = voiced.map(n => n + octave);
      if (candidate[0] < -12 || candidate[2] > 24) continue;
      const cost = candidate.reduce((sum, n, i) => sum + Math.abs(n - previous[i]), 0);
      if (cost < bestCost) { best = candidate; bestCost = cost; }
    }
  }
  return best;
}

// Fanfare harmony, built only from the DNA scale. A scale's distinct notes, e.g. Major is
// [0, 2, 4, 5, 7, 9, 11] semitones above the root and the pentatonic scales have five.
function scalePitches(scaleIndex) {
  return [...new Set(SCALES[scaleIndex].degrees.map(semi => semi % 12))].sort((a, b) => a - b);
}
// A note's position counted in scale steps (octaves included), and back again.
function scaleIndexOf(pitches, semitone) {
  const pc = ((semitone % 12) + 12) % 12;
  return Math.max(0, pitches.indexOf(pc)) + pitches.length * Math.floor(semitone / 12);
}
function scaleSemitone(pitches, index) {
  const n = pitches.length;
  return pitches[((index % n) + n) % n] + 12 * Math.floor(index / n);
}

const HARMONY_PREFERENCES = [
  [0, 3, 4, 5, 1, 2, 6], // 0: Heroic (I-IV-V)
  [0, 4, 5, 3, 1, 2, 6], // 1: Anthemic (I-V-vi-IV)
  [5, 3, 6, 0, 1, 4, 2], // 2: Dark Drive (vi-IV-VII)
  [0, 3, 4, 5, 1, 2, 6], // 3: Rink Pedal (upper triads over tonic pedal bass)
  [0, 4, 3, 1, 5, 2, 6], // 4: Quartal Synth (stacked 4th/sus voicings)
  [3, 4, 0, 6, 1, 5, 2], // 5: Blues Turn (IV-V-I)
  [1, 3, 5, 0, 4, 2, 6], // 6: Modal Float (ii-IV-vi)
  [0, 1, 2, 3, 4, 5, 6]  // 7: Stepwise Lift
];
function chordFor(pitches, semitone, harmonyIdx = 0, beatHint = 0) {
  const h = (harmonyIdx | 0) & 7;
  const n = pitches.length, step = ((scaleIndexOf(pitches, semitone) % n) + n) % n;
  if (h === 4 && n >= 4) {
    // Quartal/sus voicing [0, 3, 4] in scale steps that always contains the melody pitch class.
    const roots = [step, step - 3, step - 4].map(r => ((r % n) + n) % n);
    const pref = HARMONY_PREFERENCES[4];
    const root = pref.find(r => r < n && roots.includes(r)) ?? roots[0];
    return { root, tones: [0, 3, 4].map(k => pitches[(root + k) % n]), pedal: false };
  }
  const roots = [step, step - 2, step - 4].map(r => ((r % n) + n) % n);
  let pref = HARMONY_PREFERENCES[h];
  if (h === 7) {
    const rot = (beatHint | 0) % pref.length;
    pref = pref.slice(rot).concat(pref.slice(0, rot));
  }
  const root = pref.find(r => r < n && roots.includes(r)) ?? roots[0];
  return { root, tones: [0, 2, 4].map(k => pitches[(root + k) % n]), pedal: h === 3 };
}

// Loop variations, chosen from the DNA so an ubu's song develops the same way every time: a
// four-loop cycle of the original melody, variation A, the original, then variation B.
const shift = (p, n, steps) => n.isRest ? n : { ...n, semi: scaleSemitone(p, scaleIndexOf(p, n.semi) + steps) };
const VARIATIONS = [
  (notes, p) => notes.map(n => shift(p, n, 2)), // a third higher
  (notes, p) => notes.map(n => shift(p, n, 4)), // a fifth higher
  (notes, p) => { // mirrored: steps up become steps down around the first note
    const pivot = scaleIndexOf(p, notes.find(n => !n.isRest)?.semi ?? 0);
    return notes.map(n => n.isRest ? n : { ...n, semi: scaleSemitone(p, 2 * pivot - scaleIndexOf(p, n.semi)) });
  },
  notes => [...notes].reverse(), // played backwards
  (notes, p) => notes.map((n, i) => i < notes.length / 2 ? n : shift(p, n, 1)) // second half answers a step higher
];
function voiceSeed(voice) {
  let hash = 2166136261;
  const mix = value => { hash = Math.imul(hash ^ (value & 255), 16777619) >>> 0; };
  for (const key of ['instrument', 'pitch', 'decay', 'timbreMod', 'scale', 'tempo', 'groove']) mix(voice[key] | 0);
  for (const note of voice.notes || []) { mix(note.degree | 0); mix(note.duration | 0); }
  if (Array.isArray(voice.answerNotes) && voice.answerNotes.length) {
    for (const key of ['phraseForm', 'backingTexture', 'drumBass', 'harmonyProg', 'leadExpr', 'acousticStage', 'signatureGate']) mix(voice[key] | 0);
    for (const note of voice.answerNotes) { mix(note.degree | 0); mix(note.duration | 0); }
  }
  return hash;
}
function loopVariations(voice) {
  const seed = voiceSeed(voice), a = seed % VARIATIONS.length;
  return [null, VARIATIONS[a], null, VARIATIONS[(a + 1 + (seed >>> 8) % (VARIATIONS.length - 1)) % VARIATIONS.length]];
}

// Pre-beat-1 1/32 Signature Drop intro cues (Goal Horn, Air Siren, Crowd Chant, Synth Riser).
function scheduleSignatureDrop(ctx, dest, dropIndex, start, leadSec, rootFreq, pitches) {
  const sources = [], rawSources = [];
  let latestStop = start + leadSec;
  const pushRaw = (node, stopAt) => {
    sources.push(node);
    rawSources.push({ node, stopAt });
    if (stopAt > latestStop) latestStop = stopAt;
  };
  const kind = (dropIndex | 0) & 3;
  if (kind === 0) {
    // 0: Goal Horn — thick stadium brass foghorn triad stack punching into Beat 1
    let hornBase = rootFreq;
    while (hornBase > 175) hornBase /= 2;
    while (hornBase < 85) hornBase *= 2;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(950, start);
    filter.frequency.linearRampToValueAtTime(1650, start + leadSec * 0.7);
    filter.connect(dest.pad);
    for (const [ratio, det, vol] of [[1, -9, 0.22], [1, 9, 0.22], [1.498, 4, 0.16], [2, -5, 0.14]]) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(hornBase * ratio, start);
      osc.detune.setValueAtTime(det, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(vol, start + 0.025);
      g.gain.setValueAtTime(vol, start + leadSec * 0.78);
      g.gain.exponentialRampToValueAtTime(0.0001, start + leadSec + 0.06);
      osc.connect(g); g.connect(filter);
      osc.start(start); osc.stop(start + leadSec + 0.08);
      pushRaw(osc, start + leadSec + 0.08);
    }
    rawSources[rawSources.length - 1].node.onended = () => { try { filter.disconnect(); } catch {} };
  } else if (kind === 1) {
    // 1: Air Siren — rising dual-voice arena siren sweeping an octave into Beat 1
    let sirenFreq = rootFreq;
    while (sirenFreq > 520) sirenFreq /= 2;
    while (sirenFreq < 220) sirenFreq *= 2;
    for (const [mult, det, vol] of [[0.5, -7, 0.18], [0.75, 7, 0.13]]) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(sirenFreq * mult, start);
      osc.frequency.exponentialRampToValueAtTime(sirenFreq * mult * 2, start + leadSec * 0.92);
      osc.detune.setValueAtTime(det, start);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.linearRampToValueAtTime(vol, start + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, start + leadSec + 0.04);
      osc.connect(g); g.connect(dest.pad);
      osc.start(start); osc.stop(start + leadSec + 0.06);
      pushRaw(osc, start + leadSec + 0.06);
    }
  } else if (kind === 2) {
    // 2: Crowd Chant — 3-count stadium clap + formant shout ("HEY! HEY! HEY!")
    const noiseBuf = grainNoise(ctx);
    const step = leadSec / 3;
    for (let c = 0; c < 3; c++) {
      const at = start + c * step;
      const dur = Math.min(0.11, step * 0.8);
      const burst = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
      burst.buffer = noiseBuf;
      bp.type = 'bandpass'; bp.frequency.setValueAtTime(1150 + c * 140, at); bp.Q.setValueAtTime(2.2, at);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.16 + c * 0.03, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      burst.connect(bp); bp.connect(g); g.connect(dest.pad);
      burst.start(at); burst.stop(at + dur + 0.02);
      burst.onended = () => { try { bp.disconnect(); g.disconnect(); } catch {} };
      pushRaw(burst, at + dur + 0.02);

      const stomp = ctx.createOscillator(), sg = ctx.createGain();
      stomp.type = 'sine'; stomp.frequency.setValueAtTime(135, at);
      stomp.frequency.exponentialRampToValueAtTime(58, at + 0.09);
      sg.gain.setValueAtTime(0.0001, at);
      sg.gain.linearRampToValueAtTime(0.28, at + 0.005);
      sg.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
      stomp.connect(sg); sg.connect(dest.dry);
      stomp.start(at); stomp.stop(at + 0.12);
      pushRaw(stomp, at + 0.12);
    }
  } else {
    // 3: Synth Riser — rapid 8-note upward scale run into Beat 1
    let riserRoot = rootFreq;
    while (riserRoot > 440) riserRoot /= 2;
    const steps = 8, dt = leadSec / steps;
    for (let s = 0; s < steps; s++) {
      const at = start + s * dt;
      const semi = scaleSemitone(pitches, s);
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(riserRoot * Math.pow(2, semi / 12), at);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(0.08 + s * 0.012, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dt * 1.15);
      osc.connect(g); g.connect(dest.pad);
      osc.start(at); osc.stop(at + dt * 1.2 + 0.02);
      pushRaw(osc, at + dt * 1.2 + 0.02);
    }
  }
  return {
    endTime: latestStop,
    stop() { for (const src of sources) { try { src.stop(); } catch {} } }
  };
}

// Accompaniment under the melody: backing texture (pad/organ/arp/brass/fifths/choir/comp/pluck)
// plus drum & bass groove (16 patterns). Texture 0 + Groove 0 reproduces the original backing exactly.
function accompany(ctx, dest, plan) {
  const {
    start, end, secondsPerBeat, chords, padRoot, bassRoot, onsets, looping,
    backingIndex = 0, drumBassIndex = 0, pitches = [0, 2, 4, 5, 7, 9, 11]
  } = plan;
  const sources = [], rawSources = [], cleanups = [];
  const maxStop = looping ? end - 0.004 : Infinity;
  const capStop = t => Math.min(maxStop, t);
  const pushRaw = (node, stopAt) => {
    sources.push(node);
    rawSources.push({ node, stopAt });
    if (stopAt > latestStop) latestStop = stopAt;
  };

  const firstNote = onsets[0], finalNote = onsets[onsets.length - 1];
  const lift = at => !firstNote ? 0 : Math.max(0, Math.min(1,
    (at - firstNote.at) / Math.max(secondsPerBeat * 0.5, finalNote.at - firstNote.at)));

  const pad = ctx.createBiquadFilter();
  pad.type = 'lowpass';
  const basePadFreq = backingIndex === 3 ? 850 : backingIndex === 4 ? 1450 : backingIndex === 5 ? 1900 : 1100;
  pad.frequency.setValueAtTime(basePadFreq, start);
  pad.connect(dest.pad);
  cleanups.push(pad);
  if (finalNote) pad.frequency.linearRampToValueAtTime(Math.min(3200, basePadFreq + 500), finalNote.at);

  let voicing = plan.previousVoicing, latestStop = Math.min(maxStop, end);

  chords.forEach((chord, k) => {
    const last = k === chords.length - 1;
    const from = chord.at;
    const until = capStop(last ? end + (looping ? -0.02 : 0.65) : chord.until + 0.1);
    if (until <= from + 0.015) return;
    voicing = padVoicing(chord.tones, voicing);
    chord.voicing = voicing;

    if (backingIndex === 0) {
      // 0: Warm Strings (baseline detuned triangle pad)
      for (const tone of voicing) for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.setValueAtTime(padRoot * Math.pow(2, tone / 12), from); osc.detune.setValueAtTime(detune, from);
        const attackEnd = from + Math.min(0.08, (until - from) * 0.25);
        const releaseStart = Math.max(attackEnd, until - (last ? 0.5 : 0.1));
        gain.gain.setValueAtTime(0.0001, from); gain.gain.linearRampToValueAtTime(0.027 + 0.011 * lift(from), attackEnd);
        gain.gain.linearRampToValueAtTime(0.027 + 0.011 * lift(releaseStart), releaseStart);
        gain.gain.exponentialRampToValueAtTime(0.0001, until);
        osc.connect(gain); gain.connect(pad);
        const stopAt = capStop(until + 0.05);
        osc.start(from); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    } else if (backingIndex === 1) {
      // 1: Rink Organ (drawbar stadium organ: 8', 4', and 2-2/3' harmonics with rotary chorus)
      for (const tone of voicing) {
        const baseF = padRoot * Math.pow(2, tone / 12);
        for (const [mult, det, lvl] of [[1, -5, 0.032], [2, 6, 0.022], [2.996, 0, 0.014]]) {
          const osc = ctx.createOscillator(), gain = ctx.createGain();
          osc.type = mult === 1 ? 'triangle' : 'sine';
          osc.frequency.setValueAtTime(baseF * mult, from);
          osc.detune.setValueAtTime(det, from);
          const attackEnd = from + Math.min(0.018, (until - from) * 0.2);
          const releaseStart = Math.max(attackEnd, until - 0.06);
          const peak = lvl * (1 + 0.28 * lift(from));
          gain.gain.setValueAtTime(0.0001, from);
          gain.gain.linearRampToValueAtTime(peak, attackEnd);
          gain.gain.setValueAtTime(peak, releaseStart);
          gain.gain.exponentialRampToValueAtTime(0.0001, until);
          osc.connect(gain); gain.connect(pad);
          const stopAt = capStop(until + 0.03);
          osc.start(from); osc.stop(stopAt);
          pushRaw(osc, stopAt);
        }
      }
    } else if (backingIndex === 2) {
      // 2: Chip Arp (fast 16th-note retro square chord arpeggiator)
      const stepDur = secondsPerBeat * 0.25;
      const arpTones = [voicing[0], voicing[1], voicing[2], voicing[0] + 12];
      const chordEnd = Math.min(capStop(chord.until), until);
      for (let idx = 0, at = from; at < chordEnd - 0.01; idx++, at = from + idx * stepDur) {
        const noteEnd = capStop(Math.min(chordEnd, at + stepDur * 0.88));
        if (noteEnd <= at + 0.01) break;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(padRoot * 2 * Math.pow(2, arpTones[idx & 3] / 12), at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.028 + 0.01 * lift(at), at + Math.min(0.006, (noteEnd - at) * 0.3));
        gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
        osc.connect(gain); gain.connect(pad);
        const stopAt = capStop(noteEnd + 0.02);
        osc.start(at); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    } else if (backingIndex === 3) {
      // 3: Brass Section (ensemble sawtooth swell per chord)
      const swell = ctx.createBiquadFilter();
      swell.type = 'lowpass';
      swell.frequency.setValueAtTime(480, from);
      swell.frequency.linearRampToValueAtTime(1950, from + Math.min(0.16, (until - from) * 0.45));
      swell.connect(dest.pad);
      cleanups.push(swell);
      for (const tone of voicing) for (const detune of [-8, 8]) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(padRoot * Math.pow(2, tone / 12), from);
        osc.detune.setValueAtTime(detune, from);
        const attackEnd = from + Math.min(0.055, (until - from) * 0.25);
        const releaseStart = Math.max(attackEnd, until - 0.12);
        gain.gain.setValueAtTime(0.0001, from);
        gain.gain.linearRampToValueAtTime(0.022 + 0.01 * lift(from), attackEnd);
        gain.gain.linearRampToValueAtTime(0.019 + 0.009 * lift(releaseStart), releaseStart);
        gain.gain.exponentialRampToValueAtTime(0.0001, until);
        osc.connect(gain); gain.connect(swell);
        const stopAt = capStop(until + 0.04);
        osc.start(from); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    } else if (backingIndex === 4) {
      // 4: Power Fifths (root + fifth + octave saw/square stadium power chords)
      const rootSemi = chord.tones[0];
      const powerTones = [rootSemi, rootSemi + 7, rootSemi + 12];
      for (const [ti, tone] of powerTones.entries()) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = ti === 1 ? 'square' : 'sawtooth';
        osc.frequency.setValueAtTime(padRoot * Math.pow(2, tone / 12), from);
        osc.detune.setValueAtTime(ti * 5 - 5, from);
        const attackEnd = from + Math.min(0.015, (until - from) * 0.2);
        gain.gain.setValueAtTime(0.0001, from);
        gain.gain.linearRampToValueAtTime(0.03 + 0.01 * lift(from), attackEnd);
        gain.gain.exponentialRampToValueAtTime(0.0001, until);
        osc.connect(gain); gain.connect(pad);
        const stopAt = capStop(until + 0.03);
        osc.start(from); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    } else if (backingIndex === 5) {
      // 5: Glassy Choir (vowel formant pad with airy upper shimmer)
      const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
      f1.type = 'bandpass'; f1.frequency.setValueAtTime(820, from); f1.Q.setValueAtTime(2.4, from);
      f2.type = 'bandpass'; f2.frequency.setValueAtTime(2150, from); f2.Q.setValueAtTime(2.8, from);
      f1.connect(dest.pad); f2.connect(dest.pad);
      cleanups.push(f1, f2);
      for (const tone of voicing) {
        const osc = ctx.createOscillator(), shimmer = ctx.createOscillator(), g = ctx.createGain(), sg = ctx.createGain();
        const f = padRoot * Math.pow(2, tone / 12);
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f, from); osc.detune.setValueAtTime(-4, from);
        shimmer.type = 'sine'; shimmer.frequency.setValueAtTime(f * 2, from); shimmer.detune.setValueAtTime(5, from);
        const attackEnd = from + Math.min(0.1, (until - from) * 0.3);
        const releaseStart = Math.max(attackEnd, until - 0.14);
        g.gain.setValueAtTime(0.0001, from); g.gain.linearRampToValueAtTime(0.048, attackEnd);
        g.gain.setValueAtTime(0.048, releaseStart); g.gain.exponentialRampToValueAtTime(0.0001, until);
        sg.gain.setValueAtTime(0.0001, from); sg.gain.linearRampToValueAtTime(0.016, attackEnd);
        sg.gain.exponentialRampToValueAtTime(0.0001, until);
        osc.connect(g); g.connect(f1); g.connect(f2);
        shimmer.connect(sg); sg.connect(pad);
        const stopAt = capStop(until + 0.04);
        osc.start(from); osc.stop(stopAt);
        shimmer.start(from); shimmer.stop(stopAt);
        pushRaw(osc, stopAt); pushRaw(shimmer, stopAt);
      }
    } else if (backingIndex === 6) {
      // 6: Electric Comp (rhythmic Rhodes/EP chord stabs on beats)
      const chordEnd = Math.min(capStop(chord.until), until);
      for (let b = 0, at = from; at < chordEnd - 0.015; b++, at = from + b * secondsPerBeat) {
        const dur = Math.min(secondsPerBeat * 0.78, chordEnd - at);
        if (dur <= 0.02) break;
        for (const tone of voicing) {
          const h = playTone(ctx, pad, {
            instrument: 12,
            freq: padRoot * Math.pow(2, tone / 12),
            startTime: at,
            duration: dur,
            decay: dur,
            volume: 0.11 + (b === 0 ? 0.03 : 0),
            soft: 0.005
          });
          sources.push(h);
          if (h.endTime > latestStop) latestStop = Math.min(maxStop, h.endTime);
        }
      }
    } else {
      // 7: FM Pluck Grid (eighth-note resonant synth chord pulses)
      const eighth = secondsPerBeat * 0.5;
      const chordEnd = Math.min(capStop(chord.until), until);
      for (let s = 0, at = from; at < chordEnd - 0.015; s++, at = from + s * eighth) {
        const dur = Math.min(eighth * 0.72, chordEnd - at);
        if (dur <= 0.02) break;
        for (const tone of voicing) {
          const osc = ctx.createOscillator(), g = ctx.createGain();
          osc.type = s % 2 ? 'triangle' : 'sawtooth';
          osc.frequency.setValueAtTime(padRoot * 2 * Math.pow(2, tone / 12), at);
          g.gain.setValueAtTime(0.0001, at);
          g.gain.linearRampToValueAtTime(s % 2 ? 0.022 : 0.032, at + 0.006);
          g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
          osc.connect(g); g.connect(pad);
          const stopAt = capStop(at + dur + 0.02);
          osc.start(at); osc.stop(stopAt);
          pushRaw(osc, stopAt);
        }
      }
    }

    // Bassline synthesis per chord according to drumBassIndex (0..15)
    const bassSemiBase = chord.pedal ? 0 : chord.tones[0];
    const baseBassFreq = (() => {
      let f = bassRoot * Math.pow(2, bassSemiBase / 12);
      while (f > 160) f /= 2;
      return f;
    })();

    if (drumBassIndex === 0 || drumBassIndex === 1 || drumBassIndex === 3 || drumBassIndex === 12) {
      // Quarter-beat sine bass pulse (exact baseline when drumBassIndex === 0)
      for (let pulse = 0, at = from; at < chord.until - 0.01; pulse++, at = from + pulse * secondsPerBeat) {
        const ring = Math.min(chord.until - at, secondsPerBeat * 0.85, maxStop - at - 0.01);
        if (ring <= 0.015) break;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(baseBassFreq, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(pulse ? 0.2 : 0.26, at + Math.min(0.012, ring / 2));
        gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
        osc.connect(gain); gain.connect(dest.dry);
        const stopAt = capStop(at + ring + 0.05);
        osc.start(at); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    } else if (drumBassIndex === 2 || drumBassIndex === 13) {
      // Octave disco / electro bounce (eighth or 16th octave alternation)
      const step = drumBassIndex === 13 ? secondsPerBeat * 0.25 : secondsPerBeat * 0.5;
      for (let s = 0, at = from; at < chord.until - 0.01; s++, at = from + s * step) {
        const ring = Math.min(chord.until - at, step * 0.85, maxStop - at - 0.01);
        if (ring <= 0.012) break;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = drumBassIndex === 13 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(baseBassFreq * (s % 2 ? 2 : 1), at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(drumBassIndex === 13 ? 0.14 : 0.22, at + Math.min(0.008, ring / 2));
        gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
        osc.connect(gain); gain.connect(dest.dry);
        const stopAt = capStop(at + ring + 0.03);
        osc.start(at); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    } else if (drumBassIndex === 4) {
      // 8-Bit Chiptune eighth-note triangle bass
      const step = secondsPerBeat * 0.5;
      for (let s = 0, at = from; at < chord.until - 0.01; s++, at = from + s * step) {
        const ring = Math.min(chord.until - at, step * 0.8, maxStop - at - 0.01);
        if (ring <= 0.012) break;
        const fifth = chord.tones[2] ?? (bassSemiBase + 7);
        let f = bassRoot * Math.pow(2, (s % 4 === 3 ? fifth : bassSemiBase) / 12);
        while (f > 190) f /= 2;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.setValueAtTime(f, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.24, at + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
        osc.connect(gain); gain.connect(dest.dry);
        const stopAt = capStop(at + ring + 0.02);
        osc.start(at); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    } else if (drumBassIndex === 5 || drumBassIndex === 10) {
      // Root-Fifth Tuba / Oom-pah bass
      for (let pulse = 0, at = from; at < chord.until - 0.01; pulse++, at = from + pulse * secondsPerBeat) {
        const ring = Math.min(chord.until - at, secondsPerBeat * 0.75, maxStop - at - 0.01);
        if (ring <= 0.015) break;
        const semi = pulse % 2 === 0 ? bassSemiBase : (chord.tones[2] ?? (bassSemiBase + 7));
        let f = bassRoot * Math.pow(2, semi / 12);
        while (f > 180) f /= 2;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.setValueAtTime(f, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.24, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
        osc.connect(gain); gain.connect(dest.dry);
        const stopAt = capStop(at + ring + 0.03);
        osc.start(at); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    } else if (drumBassIndex === 6 || drumBassIndex === 14 || drumBassIndex === 15) {
      // Sustained 808 / Pedal Sub Drone across the whole chord
      const ring = Math.min(chord.until - from, maxStop - from - 0.015);
      if (ring > 0.02) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(drumBassIndex === 6 ? baseBassFreq * 1.25 : baseBassFreq, from);
        if (drumBassIndex === 6) osc.frequency.exponentialRampToValueAtTime(baseBassFreq, from + Math.min(0.09, ring * 0.4));
        gain.gain.setValueAtTime(0.0001, from);
        gain.gain.linearRampToValueAtTime(drumBassIndex === 15 ? 0.19 : 0.25, from + Math.min(0.025, ring * 0.3));
        gain.gain.exponentialRampToValueAtTime(0.0001, from + ring);
        osc.connect(gain); gain.connect(dest.dry);
        const stopAt = capStop(from + ring + 0.03);
        osc.start(from); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    } else if (drumBassIndex === 7 || drumBassIndex === 11) {
      // Pumping eighth-note Synthwave / Punk bass chug
      const step = secondsPerBeat * 0.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(520, from); lp.connect(dest.dry);
      cleanups.push(lp);
      for (let s = 0, at = from; at < chord.until - 0.01; s++, at = from + s * step) {
        const ring = Math.min(chord.until - at, step * 0.82, maxStop - at - 0.01);
        if (ring <= 0.012) break;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(baseBassFreq, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(s % 2 === 0 ? 0.2 : 0.15, at + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
        osc.connect(gain); gain.connect(lp);
        const stopAt = capStop(at + ring + 0.02);
        osc.start(at); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    } else {
      // 8 (Walking Rink) & 9 (Funk Slap): scale-walking / syncopated bass notes
      const walkTones = [chord.tones[0], chord.tones[1] ?? chord.tones[0], chord.tones[2] ?? chord.tones[0], scaleSemitone(pitches, scaleIndexOf(pitches, chord.tones[0]) + 5)];
      const step = drumBassIndex === 9 ? secondsPerBeat * 0.5 : secondsPerBeat;
      for (let s = 0, at = from; at < chord.until - 0.01; s++, at = from + s * step) {
        const ring = Math.min(chord.until - at, step * (drumBassIndex === 9 ? 0.62 : 0.88), maxStop - at - 0.01);
        if (ring <= 0.012) break;
        let f = bassRoot * Math.pow(2, walkTones[s % walkTones.length] / 12);
        while (f > 195) f /= 2;
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = drumBassIndex === 9 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(drumBassIndex === 9 ? f * 1.18 : f, at);
        if (drumBassIndex === 9) osc.frequency.exponentialRampToValueAtTime(f, at + Math.min(0.018, ring * 0.4));
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.23, at + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
        osc.connect(gain); gain.connect(dest.dry);
        const stopAt = capStop(at + ring + 0.02);
        osc.start(at); osc.stop(stopAt);
        pushRaw(osc, stopAt);
      }
    }
  });

  // Opening call & finale brass arrival accents (preserved on all textures, extra bold on Brass Section)
  const accents = [];
  if (firstNote && finalNote.at - firstNote.at >= secondsPerBeat * 0.5 && onsets[1].at - firstNote.at >= 0.08) accents.push(firstNote);
  if (finalNote) accents.push(finalNote);
  for (const note of accents) {
    const finale = note === finalNote;
    const chord = [...chords].reverse().find(c => c.at <= note.at + 1e-9) || chords[0];
    if (!chord?.voicing) continue;
    const duration = finale ? Math.min(0.6, secondsPerBeat * 0.9, end - note.at + (looping ? 0 : 0.25))
      : Math.min(0.22, (onsets[1].at - note.at) * 0.65);
    if (duration <= 0.02) continue;
    const tones = [...chord.voicing];
    if (finale) tones.push(((note.semi % 12) + 12) % 12 + 12);
    for (const tone of tones) {
      const h = playTone(ctx, dest.pad, {
        instrument: 11, freq: padRoot * Math.pow(2, tone / 12), startTime: note.at,
        duration, decay: duration, volume: finale ? 0.28 : 0.2, soft: 0.006
      });
      sources.push(h);
      if (h.endTime > latestStop) latestStop = Math.min(maxStop, h.endTime);
    }
  }

  // Percussion & Drum Kit synthesis according to drumBassIndex (0..15)
  if (drumBassIndex !== 15) {
    const noiseBuf = grainNoise(ctx);
    const hatFilter = ctx.createBiquadFilter();
    hatFilter.type = 'highpass'; hatFilter.frequency.setValueAtTime(3500, start); hatFilter.connect(dest.dry);
    cleanups.push(hatFilter);

    const addKick = (at, peak = 0.35, startFreq = 150, endFreq = 80, dur = 0.18, wave = 'sine') => {
      if (at >= maxStop - 0.02) return;
      const d = Math.min(dur, maxStop - at - 0.01);
      if (d <= 0.01) return;
      const kick = ctx.createOscillator(), gain = ctx.createGain();
      kick.type = wave;
      kick.frequency.setValueAtTime(startFreq, at);
      kick.frequency.exponentialRampToValueAtTime(endFreq, at + Math.min(0.12, d * 0.75));
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(peak, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + d);
      kick.connect(gain); gain.connect(dest.dry);
      const stopAt = capStop(at + d + 0.02);
      kick.start(at); kick.stop(stopAt);
      pushRaw(kick, stopAt);
    };

    const addHat = (at, peak = 0.03, dur = 0.04) => {
      if (at >= maxStop - 0.015) return;
      const d = Math.min(dur, maxStop - at - 0.008);
      if (d <= 0.008) return;
      const hat = ctx.createBufferSource(), gain = ctx.createGain();
      hat.buffer = noiseBuf;
      gain.gain.setValueAtTime(peak, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + d);
      hat.connect(gain); gain.connect(hatFilter);
      const stopAt = capStop(at + d + 0.02);
      hat.start(at); hat.stop(stopAt);
      pushRaw(hat, stopAt);
    };

    const snareFilter = drumBassIndex > 0 ? ctx.createBiquadFilter() : null;
    if (snareFilter) {
      snareFilter.type = 'bandpass';
      snareFilter.frequency.setValueAtTime(drumBassIndex === 1 || drumBassIndex === 13 ? 1350 : 1850, start);
      snareFilter.Q.setValueAtTime(1.1, start);
      snareFilter.connect(dest.dry);
      cleanups.push(snareFilter);
    }
    const addSnare = (at, peak = 0.14, dur = 0.11, bodyFreq = 195) => {
      if (!snareFilter || at >= maxStop - 0.02) return;
      const d = Math.min(dur, maxStop - at - 0.01);
      if (d <= 0.01) return;
      const n = ctx.createBufferSource(), ng = ctx.createGain();
      n.buffer = noiseBuf;
      ng.gain.setValueAtTime(0.0001, at);
      ng.gain.linearRampToValueAtTime(peak, at + 0.003);
      ng.gain.exponentialRampToValueAtTime(0.0001, at + d);
      n.connect(ng); ng.connect(snareFilter);
      const stopAt = capStop(at + d + 0.02);
      n.start(at); n.stop(stopAt);
      pushRaw(n, stopAt);
      if (bodyFreq > 0) {
        const body = ctx.createOscillator(), bg = ctx.createGain();
        body.type = 'triangle';
        body.frequency.setValueAtTime(bodyFreq, at);
        body.frequency.exponentialRampToValueAtTime(Math.max(60, bodyFreq * 0.55), at + Math.min(0.05, d * 0.6));
        bg.gain.setValueAtTime(0.0001, at);
        bg.gain.linearRampToValueAtTime(peak * 0.65, at + 0.003);
        bg.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(0.07, d));
        body.connect(bg); bg.connect(dest.dry);
        body.start(at); body.stop(stopAt);
        pushRaw(body, stopAt);
      }
    };

    if (drumBassIndex === 0) {
      // 0: Exact baseline hat on every beat + kick on bookend accents
      for (let beat = 0, at = start; at < end - 0.01; beat++, at = start + beat * secondsPerBeat) {
        addHat(at, beat % 4 ? 0.025 : 0.04, 0.04);
      }
      for (const at of accents.map(note => note.at)) addKick(at, 0.35, 150, 80, 0.18);
    } else if (drumBassIndex === 1) {
      // 1: Arena Stomp-Clap (boom-boom-CLAP)
      for (let beat = 0, at = start; at < end - 0.01; beat++, at = start + beat * secondsPerBeat) {
        if (beat % 2 === 0) {
          addKick(at, 0.36, 140, 62, 0.19);
          if (at + secondsPerBeat * 0.5 < end - 0.02) addKick(at + secondsPerBeat * 0.5, 0.32, 135, 60, 0.17);
        } else {
          addSnare(at, 0.18, 0.13, 0); // clap burst
        }
      }
    } else if (drumBassIndex === 2 || drumBassIndex === 13) {
      // 2 & 13: Four-on-Floor / Electro (kick every beat, offbeat open hat, clap/snare on 2 & 4)
      for (let beat = 0, at = start; at < end - 0.01; beat++, at = start + beat * secondsPerBeat) {
        addKick(at, 0.34, 155, 58, 0.17);
        if (beat % 2 === 1) addSnare(at, 0.14, 0.1, drumBassIndex === 13 ? 0 : 185);
        if (at + secondsPerBeat * 0.5 < end - 0.015) addHat(at + secondsPerBeat * 0.5, 0.055, 0.08);
      }
    } else if (drumBassIndex === 3 || drumBassIndex === 9) {
      // 3 & 9: Breakbeat / Funk (syncopated kick on 1 & 2.5, crisp snare on 2 & 4, 8th hats)
      const half = secondsPerBeat * 0.5;
      for (let s = 0, at = start; at < end - 0.01; s++, at = start + s * half) {
        const stepInBar = s % 8;
        addHat(at, s % 2 === 0 ? 0.035 : 0.022, 0.035);
        if (stepInBar === 0 || stepInBar === 5) addKick(at, 0.34, 150, 62, 0.16);
        if (stepInBar === 2 || stepInBar === 6) addSnare(at, 0.16, 0.1, 200);
        else if (drumBassIndex === 9 && stepInBar === 7) addSnare(at, 0.06, 0.05, 220);
      }
    } else if (drumBassIndex === 4) {
      // 4: 8-Bit Chiptune kit
      const half = secondsPerBeat * 0.5;
      for (let s = 0, at = start; at < end - 0.01; s++, at = start + s * half) {
        addHat(at, 0.03, 0.025);
        if (s % 4 === 0) addKick(at, 0.26, 210, 55, 0.11, 'square');
        if (s % 4 === 2) addSnare(at, 0.12, 0.07, 0);
      }
    } else if (drumBassIndex === 5) {
      // 5: Marching Snare rudimental 16ths
      const q = secondsPerBeat * 0.25;
      for (let s = 0, at = start; at < end - 0.01; s++, at = start + s * q) {
        const accent = s % 4 === 0;
        addSnare(at, accent ? 0.15 : 0.055, accent ? 0.08 : 0.04, accent ? 230 : 0);
        if (s % 8 === 0) addKick(at, 0.3, 130, 65, 0.16);
      }
    } else if (drumBassIndex === 6) {
      // 6: Halftime Boom (808 kick on beat 1, heavy snare on beat 3, rapid 16th hats)
      const q = secondsPerBeat * 0.25;
      for (let s = 0, at = start; at < end - 0.01; s++, at = start + s * q) {
        addHat(at, s % 2 === 0 ? 0.036 : 0.02, 0.025);
        if (s % 16 === 0 || s % 16 === 6) addKick(at, 0.38, 135, 48, 0.24);
        if (s % 16 === 8) addSnare(at, 0.19, 0.15, 180);
      }
    } else if (drumBassIndex === 7) {
      // 7: Synthwave Drive (gated snare + bar-end tom fill)
      for (let beat = 0, at = start; at < end - 0.01; beat++, at = start + beat * secondsPerBeat) {
        addHat(at, 0.035, 0.045);
        if (beat % 2 === 0) addKick(at, 0.35, 150, 58, 0.18);
        else addSnare(at, 0.18, 0.16, 175);
        if (beat % 4 === 3 && at + secondsPerBeat * 0.5 < end - 0.02) {
          addKick(at + secondsPerBeat * 0.5, 0.24, 190, 95, 0.12);
        }
      }
    } else if (drumBassIndex === 8 || drumBassIndex === 10) {
      // 8 (Walking Rink) & 10 (Polka Bounce)
      for (let beat = 0, at = start; at < end - 0.01; beat++, at = start + beat * secondsPerBeat) {
        addHat(at, 0.042, drumBassIndex === 8 ? 0.09 : 0.04);
        if (beat % 2 === 0) addKick(at, 0.3, 145, 70, 0.15);
        else addSnare(at, 0.12, 0.075, 240);
        if (at + secondsPerBeat * 0.5 < end - 0.015) {
          addHat(at + secondsPerBeat * 0.5, drumBassIndex === 10 ? 0.055 : 0.025, 0.05);
        }
      }
    } else if (drumBassIndex === 11) {
      // 11: Double-Time Punk sprint
      const half = secondsPerBeat * 0.5;
      for (let s = 0, at = start; at < end - 0.01; s++, at = start + s * half) {
        addHat(at, 0.04, 0.04);
        if (s % 2 === 0) addKick(at, 0.32, 160, 68, 0.12);
        else addSnare(at, 0.15, 0.085, 210);
      }
    } else if (drumBassIndex === 12) {
      // 12: Tribal Toms stadium floor-tom pattern
      const half = secondsPerBeat * 0.5;
      const tomFreqs = [115, 145, 115, 175, 130, 115, 165, 195];
      for (let s = 0, at = start; at < end - 0.01; s++, at = start + s * half) {
        const tf = tomFreqs[s & 7];
        addKick(at, s % 2 === 0 ? 0.28 : 0.18, tf * 1.35, tf, 0.14);
      }
    } else if (drumBassIndex === 14) {
      // 14: Anthem Tympani booms on chord arrivals + finale
      for (const c of chords) addKick(c.at, 0.34, 125, 65, 0.26);
      for (const at of accents.map(note => note.at)) addKick(at, 0.35, 150, 72, 0.22);
    }
  }

  const disconnectCleanups = () => {
    for (const node of cleanups) { try { node.disconnect(); } catch {} }
  };
  const lastRaw = rawSources.reduce((best, item) => (!best || item.stopAt > best.stopAt ? item : best), null);
  if (lastRaw) {
    lastRaw.node.onended = disconnectCleanups;
  } else {
    disconnectCleanups();
  }
  return {
    voicing,
    endTime: latestStop,
    stop() {
      for (const source of sources) { try { source.stop(); } catch {} }
      disconnectCleanups();
    }
  };
}

// options.loop repeats the phrase seamlessly until stopped. Each repeat is scheduled on the audio
// clock an even number of beats after the last (the melody plus a rest of about four average notes,
// rounded up), and the accompaniment runs through the rest, so the loop stays on one beat.

module.exports = {
  padVoicing, scalePitches, scaleIndexOf, scaleSemitone, HARMONY_PREFERENCES, chordFor, shift, VARIATIONS, voiceSeed, loopVariations, scheduleSignatureDrop, accompany
};
