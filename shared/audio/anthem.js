/* Acoustic arena stages and master Goal Anthem fanfare playback. */
'use strict';
const { decaySeconds, parseVoiceInfo } = require('./theory.js');
const { contextBuses, getAudioContext, getActivePlayback, setActivePlayback, isOfflineContext, stopAll, getMusicVolume, getAudioMode } = require('./buses.js');
const { playTone } = require('./synth.js');
const { scalePitches, scaleIndexOf, scaleSemitone, chordFor, loopVariations, scheduleSignatureDrop, accompany } = require('./anthem-accompany.js');
const STAGE_CONFIGS = [
  { seconds: 1.4, curve: 3.0, dry: 0.85, wet: 0.22, low: 70, high: 6500, rLow: 220, rHigh: 4200, pan: 0.15 }, // 0: Studio Room
  { seconds: 1.75, curve: 2.4, dry: 0.80, wet: 0.30, low: 85, high: 6800, rLow: 280, rHigh: 5400, pan: 0.22, slap: 0.042 }, // 1: Ice Rink PA
  { seconds: 0.32, curve: 4.5, dry: 0.94, wet: 0.12, low: 110, high: 5200, rLow: 300, rHigh: 3600, pan: 0.10 }, // 2: Arcade Cab
  { seconds: 2.3, curve: 2.1, dry: 0.76, wet: 0.34, low: 65, high: 6400, rLow: 180, rHigh: 4800, pan: 0.24 }, // 3: Stadium Hall
  { seconds: 0.48, curve: 1.1, dry: 0.84, wet: 0.28, low: 75, high: 6500, rLow: 250, rHigh: 5600, pan: 0.18, gated: true }, // 4: Gated 80s
  { seconds: 0.90, curve: 2.8, dry: 0.82, wet: 0.24, low: 190, high: 3800, rLow: 320, rHigh: 3200, pan: 0.12 }, // 5: Jumbotron
  { seconds: 2.1, curve: 2.2, dry: 0.78, wet: 0.36, low: 70, high: 7200, rLow: 320, rHigh: 6200, pan: 0.25, shimmer: true }, // 6: Shimmer Hall
  { seconds: 1.25, curve: 2.7, dry: 0.84, wet: 0.28, low: 75, high: 6600, rLow: 240, rHigh: 5000, pan: 0.38, pingPong: true } // 7: Wide Ping-Pong
];
const roomImpulses = new WeakMap();
function fanfareRoom(ctx, stageIndex = 0) {
  const idx = (stageIndex | 0) & 7;
  let byStage = roomImpulses.get(ctx);
  if (!byStage) { byStage = new Array(8); roomImpulses.set(ctx, byStage); }
  if (byStage[idx]) return byStage[idx];
  const cfg = STAGE_CONFIGS[idx];
  const length = Math.max(64, Math.round(ctx.sampleRate * cfg.seconds));
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    let seed = (0x55425530 + idx * 977 + channel * 7919) >>> 0;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let z = seed;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 2147483648 - 1;
    };
    for (let i = 0; i < length; i++) {
      const u = i / length;
      let env = (1 - u) ** cfg.curve;
      if (cfg.gated) env = u < 0.82 ? 0.9 - u * 0.2 : ((1 - u) / 0.18) ** 2.5 * 0.74;
      if (cfg.shimmer) env *= 0.82 + 0.18 * Math.sin(i * 0.015 + channel * 1.4);
      if (cfg.pingPong) {
        const tap = Math.floor((i / ctx.sampleRate) / 0.11);
        env *= (tap % 2 === channel) ? 1.25 : 0.45;
      }
      data[i] = rand() * env;
    }
    if (cfg.slap) {
      for (const [mult, amp] of [[1, 0.55], [2, 0.32]]) {
        const tapIdx = Math.min(length - 1, Math.round(ctx.sampleRate * cfg.slap * mult) + channel * 17);
        data[tapIdx] = Math.max(-1, Math.min(1, data[tapIdx] + (channel ? -amp : amp)));
      }
    }
  }
  byStage[idx] = impulse;
  return impulse;
}

function createFanfareChain(ctx, stageIndex = 0) {
  const cfg = STAGE_CONFIGS[(stageIndex | 0) & 7];
  const input = ctx.createGain(), lowCut = ctx.createBiquadFilter(), highCut = ctx.createBiquadFilter();
  const dry = ctx.createGain(), wet = ctx.createGain(), room = ctx.createConvolver();
  const roomLowCut = ctx.createBiquadFilter(), roomHighCut = ctx.createBiquadFilter();
  const compressor = ctx.createDynamicsCompressor(), master = ctx.createGain(), t = ctx.currentTime;
  const chainNodes = [input, lowCut, highCut, dry, wet, room, roomLowCut, roomHighCut, compressor, master];
  lowCut.type = 'highpass'; lowCut.frequency.setValueAtTime(cfg.low, t);
  highCut.type = 'lowpass'; highCut.frequency.setValueAtTime(cfg.high, t); highCut.Q.setValueAtTime(0.5, t);
  room.buffer = fanfareRoom(ctx, stageIndex);
  roomLowCut.type = 'highpass'; roomLowCut.frequency.setValueAtTime(cfg.rLow, t);
  roomHighCut.type = 'lowpass'; roomHighCut.frequency.setValueAtTime(cfg.rHigh, t);
  dry.gain.setValueAtTime(cfg.dry, t); wet.gain.setValueAtTime(cfg.wet, t);
  compressor.threshold.setValueAtTime(-18, t); compressor.knee.setValueAtTime(24, t);
  compressor.ratio.setValueAtTime(3, t); compressor.attack.setValueAtTime(0.01, t); compressor.release.setValueAtTime(0.3, t);
  const buses = contextBuses.get(ctx);
  const targetBus = buses ? buses.musicGain : null;
  const initialGain = targetBus ? 0.24 : (0.24 * getMusicVolume());
  master.gain.setValueAtTime(initialGain, t);
  input.connect(lowCut); lowCut.connect(highCut);
  highCut.connect(dry); dry.connect(compressor);
  roomLowCut.connect(roomHighCut); roomHighCut.connect(room); room.connect(wet); wet.connect(compressor);
  compressor.connect(master);
  if (targetBus) {
    master.connect(targetBus);
  } else {
    master.connect(ctx.destination);
  }
  // Each part shares the dry mix, but only lead and pad feed the filtered room.
  const part = amount => {
    const node = ctx.createGain();
    node.connect(input);
    chainNodes.push(node);
    if (amount) {
      const send = ctx.createGain();
      send.gain.setValueAtTime(amount, t); node.connect(send); send.connect(roomLowCut);
      chainNodes.push(send);
    }
    return node;
  };
  const lead = part(0.7), pad = part(1), percussion = part(0);
  let disconnected = false, releaseGuard = null;
  const disconnectAll = () => {
    if (disconnected) return;
    disconnected = true;
    if (releaseGuard) { try { releaseGuard.disconnect(); } catch {} releaseGuard = null; }
    for (const n of chainNodes) { try { n.disconnect(); } catch {} }
  };
  const disconnectAfter = seconds => {
    if (disconnected) return;
    if (releaseGuard) { try { releaseGuard.stop(); releaseGuard.disconnect(); } catch {} releaseGuard = null; }
    if (typeof ctx.createConstantSource === 'function') {
      const timer = ctx.createConstantSource();
      timer.offset.value = 0;
      timer.connect(master);
      timer.onended = disconnectAll;
      timer.start(ctx.currentTime);
      timer.stop(ctx.currentTime + Math.max(0.01, seconds));
      releaseGuard = timer;
    } else if (!isOfflineContext(ctx)) {
      setTimeout(disconnectAll, Math.max(10, seconds * 1000));
    }
  };
  // Stopping fades the whole chain out in 30 ms, so the reverb tail ends with the notes.
  input.silence = () => {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.03);
    disconnectAfter(0.05);
  };
  return { lead, pad, dry: percussion, panWidth: cfg.pan, tailSeconds: cfg.seconds + 0.15, silence: input.silence, disconnectAfter, disconnectAll };
}

// Conservative fanfare-only trims for the brighter/layered voices. The shared voice and
// collision synthesizer, DNA envelopes and instrument identities are unchanged.
const FANFARE_LEVELS = [1, 1, 0.9, 0.9, 0.8, 0.9, 0.9, 1, 1, 1, 1, 0.85, 1, 0.8, 1, 0.9];

// Keep three ordered pad voices near their previous pitches, choosing octave placements
// without changing chord pitch classes. Bounded register prevents drift over long loops.

function playFanfare(voice, customCtx = null, onNoteCallback = null, options = {}) {
  stopAll();
  const ctx = customCtx || getAudioContext();
  if (!ctx) return { stop() {} };

  const parsed = parseVoiceInfo(voice);
  const master = createFanfareChain(ctx, parsed.acousticStageIndex);
  const secondsPerBeat = 60 / parsed.tempoBpm;
  const introLead = parsed.hasSignatureDrop && options.includeDrop !== false
    ? Math.min(0.42, Math.max(0.24, secondsPerBeat * 0.75))
    : 0;
  const now = ctx.currentTime + 0.05;

  const activeNodes = [];
  const timers = new Set();

  const pitches = scalePitches(parsed.scaleIndex), variations = loopVariations(voice);
  const fit = (freq, low) => { while (freq >= low * 2) freq /= 2; while (freq < low) freq *= 2; return freq; };
  const padRoot = fit(parsed.rootFreq, 130), bassRoot = fit(parsed.rootFreq, 80);
  const sequenceSource = parsed.anthemNotes;
  const baseNotes = sequenceSource.map(n => ({ ...n, semi: n.isRest ? null : n.midi - parsed.rootMidi }));
  let previousVoicing = null;

  if (introLead > 0) {
    activeNodes.push(scheduleSignatureDrop(ctx, master, parsed.signatureDropIndex, now, introLead, parsed.rootFreq, pitches));
  }

  function pruneFinished() {
    const t = ctx.currentTime;
    let keep = 0;
    for (let i = 0; i < activeNodes.length; i++) {
      if (!(activeNodes[i].endTime <= t)) activeNodes[keep++] = activeNodes[i];
    }
    activeNodes.length = keep;
  }

  function scheduleLeadVoice(freq, startTime, duration, decay, panVal, pitchBend = 0, volScale = 1, detuneExtra = 0) {
    let dest = master.lead, panner = null;
    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(getAudioMode() === 'mono' ? 0 : panVal, startTime);
      panner.connect(master.lead);
      dest = panner;
    }
    const handle = playTone(ctx, dest, {
      instrument: parsed.instrumentIndex,
      freq,
      startTime,
      duration,
      decay,
      timbreMod: detuneExtra ? (parsed.timbreMod | 1) : parsed.timbreMod,
      pitchBend,
      volume: FANFARE_LEVELS[parsed.instrumentIndex] * volScale,
      soft: 0.012,
      cleanupNode: panner
    });
    activeNodes.push(handle);
    return handle;
  }

  function phrase(phraseStart, accompanyUntil = null, variation = null) {
    const notes = variation ? variation(baseNotes, pitches) : baseNotes;
    let currentTime = phraseStart, beat = 0, prevSemi = null;
    const onsets = [];
    const expr = parsed.leadExprIndex;

    notes.forEach((note, i) => {
      let swingOffset = 0;
      if (parsed.grooveIndex === 1 && (i % 2 === 1)) {
        swingOffset = secondsPerBeat * 0.12;
      } else if (parsed.grooveIndex === 2 && (i % 2 === 1)) {
        swingOffset = secondsPerBeat * 0.22;
      }

      const noteStartTime = currentTime + swingOffset;
      const nominalDuration = note.beats * secondsPerBeat;
      const playDuration = parsed.grooveIndex === 3 ? nominalDuration * 0.55 : nominalDuration * 0.92;

      if (!note.isRest) {
        const basePan = (i % 2 ? master.panWidth : -master.panWidth);
        let freq = parsed.rootFreq * Math.pow(2, note.semi / 12);
        while (freq > 2600) freq /= 2;
        const noteDecay = Math.min(parsed.decaySeconds, playDuration * 1.5);

        let bend = 0;
        if (expr === 1 && prevSemi !== null) {
          bend = Math.max(-12, Math.min(12, note.semi - prevSemi));
        } else if (expr === 4 && note.beats >= 0.5) {
          bend = 2;
        }

        if (expr === 6 && note.duration === 2 && playDuration >= 0.16) {
          // 6: Held Trill — rapid upper-neighbor ornament across the first half, settling on the target pitch
          const upperSemi = scaleSemitone(pitches, scaleIndexOf(pitches, note.semi) + 1);
          let upperFreq = parsed.rootFreq * Math.pow(2, upperSemi / 12);
          while (upperFreq > 2600) upperFreq /= 2;
          const seg = playDuration * 0.22;
          scheduleLeadVoice(freq, noteStartTime, seg, seg, basePan, 0, 0.92);
          scheduleLeadVoice(upperFreq, noteStartTime + seg, seg, seg, -basePan, 0, 0.85);
          scheduleLeadVoice(freq, noteStartTime + seg * 2, playDuration - seg * 2, noteDecay, basePan, 0, 1);
        } else {
          scheduleLeadVoice(freq, noteStartTime, playDuration, noteDecay, basePan, bend, expr === 7 ? 0.88 : 1, expr === 7 ? 1 : 0);
        }

        if (expr === 2) {
          // 2: Twin-Lead 3rds — harmonized diatonic 3rd panned opposite
          const thirdSemi = scaleSemitone(pitches, scaleIndexOf(pitches, note.semi) + 2);
          let thirdFreq = parsed.rootFreq * Math.pow(2, thirdSemi / 12);
          while (thirdFreq > 2600) thirdFreq /= 2;
          scheduleLeadVoice(thirdFreq, noteStartTime, playDuration, noteDecay, -basePan, bend, 0.52);
        } else if (expr === 3) {
          // 3: Octave Stack — upper octave (or lower if already high) unison reinforcement
          const octFreq = freq * 2 <= 2600 ? freq * 2 : freq * 0.5;
          scheduleLeadVoice(octFreq, noteStartTime, playDuration, noteDecay, -basePan * 0.7, bend, 0.45);
        } else if (expr === 5) {
          // 5: Dotted Echo — quieter stereo-flipped delay tap (clamped inside loop window if looping)
          const echoTime = noteStartTime + secondsPerBeat * 0.75;
          if (!accompanyUntil || echoTime + 0.08 < accompanyUntil) {
            scheduleLeadVoice(freq, echoTime, playDuration * 0.65, noteDecay * 0.65, -basePan, 0, 0.36);
          }
        } else if (expr === 7) {
          // 7: Vibrato Swell — detuned octave/unison shimmer companion
          scheduleLeadVoice(freq * 1.0055, noteStartTime + 0.008, playDuration * 0.95, noteDecay, -basePan, 0, 0.5, 1);
        }

        prevSemi = note.semi;
        onsets.push({ beat, at: noteStartTime, semi: note.semi });
      }

      if (typeof onNoteCallback === 'function' && !isOfflineContext(ctx)) {
        const delayMs = Math.max(0, (noteStartTime - ctx.currentTime) * 1000);
        const callbackIdx = note.index;
        const timerId = setTimeout(() => {
          timers.delete(timerId);
          onNoteCallback(callbackIdx, sequenceSource[callbackIdx]);
        }, delayMs);
        timers.add(timerId);
      }

      currentTime += nominalDuration;
      beat += note.beats;
    });

    const until = accompanyUntil ?? currentTime, chords = [], boundaries = [];
    const finalNote = onsets[onsets.length - 1];
    for (let b = 0; phraseStart + b * secondsPerBeat < until - 0.01; b++) boundaries.push(phraseStart + b * secondsPerBeat);
    if (finalNote && !boundaries.some(at => Math.abs(at - finalNote.at) < 1e-9)) boundaries.push(finalNote.at);
    boundaries.sort((a, b) => a - b);
    for (let k = 0; k < boundaries.length; k++) {
      const at = boundaries[k], b = (at - phraseStart) / secondsPerBeat;
      const sounding = [...onsets].reverse().find(o => o.beat <= b + 1e-9) ?? onsets[0];
      const chord = finalNote && at >= finalNote.at - 1e-9 ? chordFor(pitches, finalNote.semi, parsed.harmonyProgIndex, k)
        : b < beat && sounding ? chordFor(pitches, sounding.semi, parsed.harmonyProgIndex, k)
        : chordFor(pitches, 0, parsed.harmonyProgIndex, k);
      const next = boundaries[k + 1] ?? until;
      const previous = chords[chords.length - 1];
      if (previous && previous.root === chord.root && previous.pedal === chord.pedal) previous.until = next;
      else chords.push({ ...chord, at, until: next });
    }
    const backing = accompany(ctx, master, {
      start: phraseStart,
      end: until,
      secondsPerBeat,
      chords,
      padRoot,
      bassRoot,
      previousVoicing,
      onsets,
      looping: !!options.loop,
      backingIndex: parsed.backingTextureIndex,
      drumBassIndex: parsed.drumBassIndex,
      pitches
    });
    previousVoicing = backing.voicing;
    activeNodes.push(backing);
    return currentTime;
  }

  let finished = false;
  const firstPhraseStart = now + introLead;
  if (options.loop) {
    const melodyBeats = sequenceSource.reduce((sum, n) => sum + n.beats, 0);
    const loopBeats = melodyBeats + 4 * melodyBeats / Math.max(1, sequenceSource.length);
    const period = Math.ceil(loopBeats / 2) * 2 * secondsPerBeat;
    let next = firstPhraseStart, repeat = 0;
    const queue = () => {
      pruneFinished();
      while (next < ctx.currentTime + period + introLead) {
        phrase(next, next + period, variations[repeat++ % variations.length]);
        next += period;
      }
      if (!isOfflineContext(ctx)) {
        const id = setTimeout(() => { timers.delete(id); queue(); }, period * 500);
        timers.add(id);
      }
    };
    queue();
  } else {
    const end = phrase(firstPhraseStart);
    master.disconnectAfter(Math.max(0.5, end - ctx.currentTime + master.tailSeconds));
    if (typeof onNoteCallback === 'function' && !isOfflineContext(ctx)) {
      const finishDelayMs = Math.max(0, (end - ctx.currentTime + 0.2) * 1000);
      const finishTimer = setTimeout(() => {
        timers.delete(finishTimer);
        finished = true;
        onNoteCallback(-1, null);
      }, finishDelayMs);
      timers.add(finishTimer);
    }
  }

  const handle = {
    stop() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const node of activeNodes) node.stop();
      activeNodes.length = 0;
      master.silence();
      if (!finished && typeof onNoteCallback === 'function') onNoteCallback(-1, null);
      finished = true;
      if (getActivePlayback() === handle) setActivePlayback(null);
    }
  };
  setActivePlayback(handle);
  return handle;
}

module.exports = { scalePitches, chordFor, loopVariations, playFanfare };
