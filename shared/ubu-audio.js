'use strict';
(() => {
  const INSTRUMENTS = [
    'Soft Bell',      // 0: Rounded bell with a lingering inharmonic ring
    'Woodblock',      // 1: Dry, hollow wooden knock
    'Resonant Pluck', // 2: Resonant sawtooth filter sweep
    'Crystal Chime',  // 3: Glassy dual sine with shimmer
    'Square Chip',    // 4: Retro 8-bit square wave with vibrato
    'Pulse Pluck',    // 5: Narrow pulse with a crisp, closing filter
    'Warm Pad',       // 6: Soft sine swell with a quiet octave
    'Sub Pluck',      // 7: Deep punchy sine with transient
    'Kalimba',        // 8: Plucked tine with a brief, bright buzz
    'Marimba',        // 9: Hollow wooden mallet pop
    'Vibraphone',     // 10: Metallic mallet tone with tremolo
    'Brass Ping',     // 11: Sawtooth with envelope filter swell
    'Electric Piano', // 12: Bell transient + Rhodes tine warmth
    'Synth Bass',     // 13: Punchy filtered saw/square bite
    'Robot Vowel',    // 14: Hollow talking pulse with moving vowel resonances
    'Space Zap'       // 15: Retro arcade downward pitch drop
  ];

  const SCALES = [
    { name: 'Major', degrees: [0, 2, 4, 5, 7, 9, 11, 12] },
    { name: 'Minor', degrees: [0, 2, 3, 5, 7, 8, 10, 12] },
    { name: 'Major Pentatonic', degrees: [0, 2, 4, 7, 9, 12, 14, 16] },
    { name: 'Minor Blues', degrees: [0, 3, 5, 7, 10, 12, 15, 17] },
    { name: 'Dorian', degrees: [0, 2, 3, 5, 7, 9, 10, 12] },
    { name: 'Insen', degrees: [0, 1, 5, 7, 10, 12, 13, 17] },
    { name: 'Synthwave', degrees: [0, 2, 4, 6, 7, 9, 11, 12] },
    { name: 'Retro Arcade', degrees: [0, 2, 4, 7, 11, 12, 14, 16] }
  ];

  const TEMPOS = [84, 96, 108, 120, 132, 144, 156, 168];
  const GROOVES = ['Straight', 'Light Swing', 'Shuffle', 'Staccato'];
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // 6-bit pitch (0-63) maps to MIDI note 36 (C2, ~65.4 Hz) to 99 (D#7, ~2489 Hz)
  function midiNote(pitchIndex) {
    const clamped = Math.max(0, Math.min(63, pitchIndex | 0));
    return 36 + clamped;
  }

  function noteFrequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function noteName(midi) {
    const semitone = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return `${NOTE_NAMES[semitone]}${octave}`;
  }

  function decaySeconds(decayIndex) {
    const clamped = Math.max(0, Math.min(15, decayIndex | 0));
    return 0.12 + clamped * 0.06;
  }

  function scaleDegreeSemitones(scaleIndex, degree) {
    const scale = SCALES[(scaleIndex | 0) & 7];
    return scale.degrees[(degree | 0) & 7];
  }

  function parseVoiceInfo(voice) {
    voice = voice || {};
    const instIdx = (voice.instrument | 0) & 15;
    const pitchIdx = Math.max(0, Math.min(63, voice.pitch | 0));
    const scaleIdx = (voice.scale | 0) & 7;
    const tempoIdx = (voice.tempo | 0) & 7;
    const grooveIdx = (voice.groove | 0) & 3;
    const decaySec = decaySeconds(voice.decay);
    const rootMidi = midiNote(pitchIdx);
    const rootFreq = noteFrequency(rootMidi);
    const rootName = noteName(rootMidi);

    const notes = Array.isArray(voice.notes) ? voice.notes : [];
    const parsedNotes = notes.map((n, i) => {
      const degree = (n.degree | 0) & 7;
      const duration = (n.duration | 0) & 3;
      const isRest = duration === 3;
      let midi = null, freq = null, name = 'Rest';
      if (!isRest) {
        const semi = scaleDegreeSemitones(scaleIdx, degree);
        midi = rootMidi + semi;
        freq = noteFrequency(midi);
        name = noteName(midi);
      }
      // Duration in beats: 0 -> 16th (0.25 beat), 1 -> 8th (0.5 beat), 2 -> Quarter (1.0 beat), 3 -> 8th rest (0.5 beat)
      const beats = duration === 0 ? 0.25 : duration === 1 ? 0.5 : duration === 2 ? 1.0 : 0.5;
      return { index: i, degree, duration, isRest, midi, freq, name, beats };
    });

    return {
      instrument: INSTRUMENTS[instIdx],
      instrumentIndex: instIdx,
      pitchIndex: pitchIdx,
      rootMidi,
      rootFreq,
      rootName,
      decaySeconds: decaySec,
      timbreMod: (voice.timbreMod | 0) & 3,
      scale: SCALES[scaleIdx].name,
      scaleIndex: scaleIdx,
      tempoBpm: TEMPOS[tempoIdx],
      tempoIndex: tempoIdx,
      groove: GROOVES[grooveIdx],
      grooveIndex: grooveIdx,
      notes: parsedNotes
    };
  }

  // Audio synthesis engine
  let sharedContext = null;
  let userUnlocked = false;

  function hasUserGesture() {
    if (typeof window === 'undefined') return false;
    return userUnlocked || Boolean(window.navigator?.userActivation?.hasBeenActive);
  }

  if (typeof window !== 'undefined') {
    const unlock = () => {
      userUnlocked = true;
      if (sharedContext && sharedContext.state === 'suspended') {
        sharedContext.resume().catch(() => {});
      }
    };
    window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    window.addEventListener('keydown', unlock, { capture: true, passive: true });
  }

  let soundVolume = 0.8;
  let musicVolume = 0.8;
  let audioMode = 'stereo'; // 'stereo' or 'mono'
  let currentOrientation = false; // false: landscape, true: portrait

  const contextBuses = new WeakMap();
  const registeredBusContexts = new Set();

  function updateBusMode(masterGain, mode) {
    if (!masterGain) return;
    try {
      if (mode === 'mono') {
        masterGain.channelCount = 1;
        masterGain.channelCountMode = 'explicit';
        masterGain.channelInterpretation = 'speakers';
      } else {
        masterGain.channelCount = 2;
        masterGain.channelCountMode = 'max';
        masterGain.channelInterpretation = 'speakers';
      }
    } catch {}
  }

  function setupAudioBuses(ctx) {
    if (!ctx) return null;
    if (contextBuses.has(ctx)) return contextBuses.get(ctx);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(1.0, ctx.currentTime);
    updateBusMode(masterGain, audioMode);
    masterGain.connect(ctx.destination);

    const sfxGain = ctx.createGain();
    sfxGain.gain.setValueAtTime(soundVolume, ctx.currentTime);
    sfxGain.connect(masterGain);

    const musicGain = ctx.createGain();
    musicGain.gain.setValueAtTime(musicVolume, ctx.currentTime);
    musicGain.connect(masterGain);

    const buses = { masterGain, sfxGain, musicGain };
    contextBuses.set(ctx, buses);
    registeredBusContexts.add(ctx);
    return buses;
  }

  function setSoundVolume(v) {
    soundVolume = Math.max(0, Math.min(1, Number(v) || 0));
    for (const ctx of registeredBusContexts) {
      if (ctx.state === 'closed') { registeredBusContexts.delete(ctx); continue; }
      if (contextBuses.has(ctx)) {
        const buses = contextBuses.get(ctx);
        try {
          buses.sfxGain.gain.cancelScheduledValues(ctx.currentTime);
          buses.sfxGain.gain.setValueAtTime(soundVolume, ctx.currentTime);
        } catch {}
      }
    }
    if (soundVolume === 0) stopMotion();
  }

  function getSoundVolume() { return soundVolume; }

  function setMusicVolume(v) {
    musicVolume = Math.max(0, Math.min(1, Number(v) || 0));
    for (const ctx of registeredBusContexts) {
      if (ctx.state === 'closed') { registeredBusContexts.delete(ctx); continue; }
      if (contextBuses.has(ctx)) {
        const buses = contextBuses.get(ctx);
        try {
          buses.musicGain.gain.cancelScheduledValues(ctx.currentTime);
          buses.musicGain.gain.setValueAtTime(musicVolume, ctx.currentTime);
        } catch {}
      }
    }
    if (musicVolume === 0 && activePlayback) {
      activePlayback.stop();
      activePlayback = null;
    }
  }

  function getMusicVolume() { return musicVolume; }

  function setAudioMode(mode) {
    audioMode = mode === 'mono' ? 'mono' : 'stereo';
    for (const ctx of registeredBusContexts) {
      if (ctx.state === 'closed') { registeredBusContexts.delete(ctx); continue; }
      if (contextBuses.has(ctx)) {
        const buses = contextBuses.get(ctx);
        updateBusMode(buses.masterGain, audioMode);
      }
    }
    if (audioMode === 'mono') {
      for (const ctx of activeMotionContexts) {
        const map = motionLoops.get(ctx);
        if (map) {
          for (const entry of map.values()) {
            if (entry.panner) {
              try {
                entry.panner.pan.cancelScheduledValues(ctx.currentTime);
                entry.panner.pan.setValueAtTime(0, ctx.currentTime);
              } catch {}
            }
          }
        }
      }
    }
  }

  function getAudioMode() { return audioMode; }
  function isStereo() { return audioMode === 'stereo'; }

  function setOrientation(isPortrait) {
    currentOrientation = Boolean(isPortrait);
  }

  function isPortrait() { return currentOrientation; }

  // Calculates spatial stereo pan in [-0.75, 0.75].
  // Landscape: x from 0 (home goal, left) to 1000 (away goal, right).
  // Portrait: y from 0 (top boards, left of screen) to 600 (bottom boards, right of screen).
  function panFromField(x, y, isPortrait = currentOrientation) {
    if (audioMode === 'mono') return 0;
    let raw = 0;
    if (isPortrait) {
      if (typeof y === 'number' && Number.isFinite(y)) {
        raw = (y - 300) / 300;
      }
    } else {
      if (typeof x === 'number' && Number.isFinite(x)) {
        raw = (x - 500) / 500;
      }
    }
    const clamped = Math.max(-1, Math.min(1, raw));
    return clamped * 0.75;
  }

  function getPan(options = {}) {
    if (audioMode === 'mono') return 0;
    if (typeof options.pan === 'number' && Number.isFinite(options.pan)) {
      return Math.max(-0.75, Math.min(0.75, options.pan));
    }
    const isP = options.portrait ?? currentOrientation;
    if (typeof options.x === 'number' || typeof options.y === 'number') {
      return panFromField(options.x, options.y, isP);
    }
    return 0;
  }

  function routePanner(ctx, targetDest, options = {}, cleanup = null) {
    const pan = getPan(options);
    if (pan !== 0 && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(pan, ctx.currentTime);
      panner.connect(targetDest);
      if (cleanup) cleanup.push(panner);
      return panner;
    }
    return targetDest;
  }

  function getAudioContext(force = false) {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!force && !hasUserGesture()) return null;
    if (!sharedContext || sharedContext.state === 'closed') {
      sharedContext = new AudioCtx();
      setupAudioBuses(sharedContext);
    }
    if (sharedContext.state === 'suspended') {
      sharedContext.resume().catch(() => {});
    }
    return sharedContext;
  }

  // In-game sounds: a gentle high-cut takes the edge off bright transients, and moderate compression
  // keeps hits even without squashing them. Given a short sound's length in `seconds`, the chain lets
  // go once it has rung out (plus the compressor's release): a chain left connected keeps costing
  // the audio graph every block, and a match plays thousands of hits.
  // A context can share one chain among its sounds (see shareMasterChain).
  const sharedChains = new WeakMap();
  function createMasterChain(ctx, cleanup = null, seconds = 0, bus = 'sfx') {
    if (sharedChains.has(ctx)) return sharedChains.get(ctx);
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.setValueAtTime(7500, ctx.currentTime);
    soften.Q.setValueAtTime(0.5, ctx.currentTime);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.knee.setValueAtTime(30, ctx.currentTime);
    compressor.ratio.setValueAtTime(4, ctx.currentTime);
    compressor.attack.setValueAtTime(0.005, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    const masterGain = ctx.createGain();
    const buses = contextBuses.get(ctx);
    const targetBus = buses ? (bus === 'music' ? buses.musicGain : buses.sfxGain) : null;
    const initialGain = targetBus ? 0.22 : (0.22 * (bus === 'music' ? musicVolume : soundVolume));
    masterGain.gain.setValueAtTime(initialGain, ctx.currentTime);

    soften.connect(compressor);
    compressor.connect(masterGain);
    if (targetBus) {
      masterGain.connect(targetBus);
    } else {
      masterGain.connect(ctx.destination);
    }
    if (cleanup) cleanup.push(soften, compressor, masterGain);
    if (seconds) {
      const timer = ctx.createConstantSource();
      timer.offset.value = 0; timer.connect(masterGain);
      timer.onended = () => { for (const node of [timer, soften, compressor, masterGain]) node.disconnect(); };
      timer.start(ctx.currentTime); timer.stop(ctx.currentTime + seconds + 0.3);
    }
    return soften;
  }

  // Sends every later sound on `ctx` through one chain, compressing their mix rather than each sound:
  // far cheaper where thousands are rendered at once (a video export), where a chain per sound
  // dominated the render.
  function shareMasterChain(ctx) {
    sharedChains.delete(ctx);
    sharedChains.set(ctx, createMasterChain(ctx));
  }

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
  let activePlayback = null;
  const motionLoops = new WeakMap();
  const activeMotionContexts = new Set();
  const perfNow = () => (typeof performance === 'object' && typeof performance.now === 'function') ? performance.now() : Date.now();
  function extendLoopTimer(entry, ms = 220) {
    entry.stopAt = perfNow() + ms;
    if (entry.timer) return;
    const check = () => {
      entry.timer = null;
      if (entry.stopped) return;
      const rem = entry.stopAt - perfNow();
      if (rem > 4) {
        entry.timer = setTimeout(check, Math.ceil(rem));
        entry.timer?.unref?.();
      } else {
        entry.stop();
      }
    };
    entry.timer = setTimeout(check, ms);
    entry.timer?.unref?.();
  }

  function isOfflineContext(ctx) {
    return (typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext) ||
      ctx?.constructor?.name === 'OfflineAudioContext';
  }

  function interpRamp(t0, v0, t1, v1, now) {
    if (now <= t0 || t1 <= t0) return now <= t0 ? v0 : v1;
    if (now >= t1) return v1;
    return v0 + (v1 - v0) * ((now - t0) / (t1 - t0));
  }

  function currentLoopGain(entry, now) {
    if (now <= entry.t0) return entry.g0;
    if (now <= entry.tPeak) {
      const span = entry.tPeak - entry.t0;
      return span > 0 ? entry.g0 + (entry.gPeak - entry.g0) * ((now - entry.t0) / span) : entry.gPeak;
    }
    if (now < entry.tZero) {
      const span = entry.tZero - entry.tPeak;
      return span > 0 ? entry.gPeak * (1 - (now - entry.tPeak) / span) : 0;
    }
    return 0;
  }

  function stopMotion(customCtx = null) {
    if (customCtx) {
      const map = motionLoops.get(customCtx);
      if (map) for (const entry of [...map.values()]) entry.stop();
      return;
    }
    for (const ctx of [...activeMotionContexts]) {
      const map = motionLoops.get(ctx);
      if (map) for (const entry of [...map.values()]) entry.stop();
      activeMotionContexts.delete(ctx);
    }
  }

  function stopAll() {
    stopMotion();
    for (const handle of superPlayback) handle.stop();
    if (activePlayback) {
      activePlayback.stop();
      activePlayback = null;
    }
  }

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
        if (activePlayback === handle) activePlayback = null;
      }
    };
    if (!options.overlap) activePlayback = handle;
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
  function strike(gain, level, now, end) {
    const peak = Number.isFinite(level) ? Math.max(0.0001, level) : 0.0001;
    const safeEnd = Math.max(now + 0.001, end);
    const attack = Math.min(0.003, (safeEnd - now) * 0.35);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, safeEnd);
  }

  function playBallHit(options = {}) {
    const ctx = options.ctx || getAudioContext();
    if (!ctx) return;
    const snap = Boolean(options.snap);
    const master = createMasterChain(ctx, null, snap ? 0.11 : 0.08);
    const dest = routePanner(ctx, master, options);
    const now = ctx.currentTime;
    const volume = Math.max(0.04, Math.min(1.0, options.volume ?? 0.8));

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(snap ? 280 : 220, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.05);

    strike(gain, 0.7 * volume, now, now + 0.07);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(now);
    osc.stop(now + 0.08);

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
        if (panner && audioMode !== 'mono') {
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

  // Ice hockey hard brake & corner rim-around skate shave: restrained steel-edge shave and soft
  // snow spray (~170 ms), kept polite in the mix.
  function playCarve(options = {}) {
    const ctx = options.ctx || getAudioContext();
    if (!ctx) return;
    const master = createMasterChain(ctx, null, 0.2);
    const dest = routePanner(ctx, master, options);
    const now = ctx.currentTime;
    const volume = Math.max(0.03, Math.min(1.0, options.volume ?? 0.42));
    const speedNorm = Math.min(1, Math.max(0, (Number(options.speed) || 320) / 620));
    const rimmed = Boolean(options.rimmed);
    const pitchMul = 0.92 + 0.28 * speedNorm + (rimmed ? 0.08 : 0);

    // 1. Restrained steel-blade edge shave sweep (rises higher on fast corner rim-arounds)
    const spray = ctx.createBufferSource(), sprayFilter = ctx.createBiquadFilter(), sprayGain = ctx.createGain();
    spray.buffer = grainNoise(ctx);
    sprayFilter.type = 'bandpass';
    sprayFilter.Q.setValueAtTime(rimmed ? 1.85 : 1.6, now);
    sprayFilter.frequency.setValueAtTime(1350 * pitchMul, now);
    sprayFilter.frequency.exponentialRampToValueAtTime((rimmed ? 2680 : 2350) * pitchMul, now + (rimmed ? 0.065 : 0.045));
    sprayFilter.frequency.exponentialRampToValueAtTime((rimmed ? 1320 : 1050) * pitchMul, now + 0.165);
    sprayGain.gain.setValueAtTime(0.0001, now);
    sprayGain.gain.linearRampToValueAtTime(0.13 * volume, now + 0.012);
    sprayGain.gain.linearRampToValueAtTime(0.095 * volume, now + 0.05);
    sprayGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.165);
    spray.connect(sprayFilter); sprayFilter.connect(sprayGain); sprayGain.connect(dest);
    spray.start(now, Math.random() * 0.7);
    spray.stop(now + 0.18);

    // 2. Soft shaved-ice snow spray
    noiseGrain(ctx, dest, now + 0.006, 0.13, { freq: 2900 * pitchMul, to: 1500 * pitchMul, q: 1.0, level: 0.065 * volume });

    // 3. Subtle ice-crystal shave texture in the initial bite
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.014 + Math.random() * 0.005;
      noiseGrain(ctx, dest, t, 0.014, {
        freq: (1150 + i * 240 + Math.random() * 250) * pitchMul,
        to: (900 + i * 140) * pitchMul,
        q: 2.6,
        level: (0.075 - i * 0.018) * volume
      });
    }

    // 4. Gentle low-mid skate pressure weight
    noiseGrain(ctx, dest, now, 0.075, { freq: 420 * (0.95 + 0.15 * speedNorm), to: 250, q: 2.2, level: 0.07 * volume });
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

  // Hockey dasher-board bounce: polite flex on light/medium hits, plus a deep hollow woody/HDPE
  // dasher-box "thock" reserved strictly for truly hard board hits.
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
        const sparkSpread = audioMode === 'mono' ? 0 : (Math.random() - 0.5) * 0.48;
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
        const sparkSpread = audioMode === 'mono' ? 0 : (Math.random() - 0.5) * 0.34;
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

  const superPlayback = new Set();
  const magnetTimes = new WeakMap();
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
        if (activePlayback === handle) activePlayback = null;
      }
    };
    if (!opts.overlap) activePlayback = handle;
    return handle;
  }

  // Fanfare finishing: trims rumble and harsh highs, compresses gently instead of pumping, and adds a
  // short generated room reverb. Notes, timing, instrument and decay all still come from the DNA.
  const roomImpulses = new WeakMap();
  function fanfareRoom(ctx) {
    let impulse = roomImpulses.get(ctx);
    if (impulse) return impulse;
    const length = Math.round(ctx.sampleRate * 1.4);
    impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    roomImpulses.set(ctx, impulse);
    return impulse;
  }
  function createFanfareChain(ctx) {
    const input = ctx.createGain(), lowCut = ctx.createBiquadFilter(), highCut = ctx.createBiquadFilter();
    const dry = ctx.createGain(), wet = ctx.createGain(), room = ctx.createConvolver();
    const roomLowCut = ctx.createBiquadFilter(), roomHighCut = ctx.createBiquadFilter();
    const compressor = ctx.createDynamicsCompressor(), master = ctx.createGain(), t = ctx.currentTime;
    const chainNodes = [input, lowCut, highCut, dry, wet, room, roomLowCut, roomHighCut, compressor, master];
    lowCut.type = 'highpass'; lowCut.frequency.setValueAtTime(70, t);
    highCut.type = 'lowpass'; highCut.frequency.setValueAtTime(6500, t); highCut.Q.setValueAtTime(0.5, t);
    room.buffer = fanfareRoom(ctx);
    roomLowCut.type = 'highpass'; roomLowCut.frequency.setValueAtTime(220, t);
    roomHighCut.type = 'lowpass'; roomHighCut.frequency.setValueAtTime(4200, t);
    dry.gain.setValueAtTime(0.85, t); wet.gain.setValueAtTime(0.22, t);
    compressor.threshold.setValueAtTime(-18, t); compressor.knee.setValueAtTime(24, t);
    compressor.ratio.setValueAtTime(3, t); compressor.attack.setValueAtTime(0.01, t); compressor.release.setValueAtTime(0.3, t);
    const buses = contextBuses.get(ctx);
    const targetBus = buses ? buses.musicGain : null;
    const initialGain = targetBus ? 0.24 : (0.24 * musicVolume);
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
    return { lead, pad, dry: percussion, silence: input.silence, disconnectAfter, disconnectAll };
  }

  // Conservative fanfare-only trims for the brighter/layered voices. The shared voice and
  // collision synthesizer, DNA envelopes and instrument identities are unchanged.
  const FANFARE_LEVELS = [1, 1, 0.9, 0.9, 0.8, 0.9, 0.9, 1, 1, 1, 1, 0.85, 1, 0.8, 1, 0.9];

  // Keep three ordered pad voices near their previous pitches, choosing octave placements
  // without changing chord pitch classes. Bounded register prevents drift over long loops.
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
  // The chord under a melody note is a scale triad (every other scale note) that contains it,
  // preferring the home chord, then the chords built on the 4th and 5th notes, as most songs do.
  const CHORD_PREFERENCE = [0, 3, 4, 5, 1, 2, 6];
  function chordFor(pitches, semitone) {
    const n = pitches.length, step = ((scaleIndexOf(pitches, semitone) % n) + n) % n;
    const roots = [step, step - 2, step - 4].map(r => ((r % n) + n) % n);
    const root = CHORD_PREFERENCE.find(r => r < n && roots.includes(r)) ?? roots[0];
    return { root, tones: [0, 2, 4].map(k => pitches[(root + k) % n]) };
  }
  // Loop variations, chosen from the DNA so an ubu's song develops the same way every time: a
  // four-loop cycle of the original melody, variation A, the original, then variation B. Each
  // keeps the melody's rhythm and scale; the chords follow whatever the melody becomes.
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
    return hash;
  }
  function loopVariations(voice) {
    const seed = voiceSeed(voice), a = seed % VARIATIONS.length;
    return [null, VARIATIONS[a], null, VARIATIONS[(a + 1 + (seed >>> 8) % (VARIATIONS.length - 1)) % VARIATIONS.length]];
  }

  // Accompaniment under the melody: a soft pad follows the chords, with a bass pulse and quiet
  // percussion on each beat. Brass accents frame the sounding melody, while the pad opens up
  // toward its final note. These are backing voices; the DNA lead is never rewritten.
  function accompany(ctx, dest, plan) {
    const { start, end, secondsPerBeat, chords, padRoot, bassRoot, onsets, looping } = plan, sources = [], rawSources = [];
    const firstNote = onsets[0], finalNote = onsets[onsets.length - 1];
    const lift = at => !firstNote ? 0 : Math.max(0, Math.min(1,
      (at - firstNote.at) / Math.max(secondsPerBeat * 0.5, finalNote.at - firstNote.at)));
    const pad = ctx.createBiquadFilter();
    pad.type = 'lowpass'; pad.frequency.setValueAtTime(1100, start); pad.connect(dest.pad);
    if (finalNote) pad.frequency.linearRampToValueAtTime(1600, finalNote.at);
    let voicing = plan.previousVoicing, latestStop = end;
    chords.forEach((chord, k) => {
      const last = k === chords.length - 1, from = chord.at, until = last ? end + (looping ? 0 : 0.65) : chord.until + 0.1;
      // Pad: two slightly detuned triangles per chord note, crossfading into the next chord.
      voicing = padVoicing(chord.tones, voicing);
      chord.voicing = voicing;
      for (const tone of voicing) for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.setValueAtTime(padRoot * Math.pow(2, tone / 12), from); osc.detune.setValueAtTime(detune, from);
        const attackEnd = from + Math.min(0.08, (until - from) * 0.25);
        const releaseStart = Math.max(attackEnd, until - (last ? 0.5 : 0.1));
        gain.gain.setValueAtTime(0.0001, from); gain.gain.linearRampToValueAtTime(0.027 + 0.011 * lift(from), attackEnd);
        gain.gain.linearRampToValueAtTime(0.027 + 0.011 * lift(releaseStart), releaseStart);
        gain.gain.exponentialRampToValueAtTime(0.0001, until);
        osc.connect(gain); gain.connect(pad); osc.start(from); osc.stop(until + 0.05);
        sources.push(osc); rawSources.push({ node: osc, stopAt: until + 0.05 });
        if (until + 0.05 > latestStop) latestStop = until + 0.05;
      }
      // Bass has its own beat pulse even when successive pad chords were merged.
      for (let pulse = 0, at = from; at < chord.until - 0.01; pulse++, at = from + pulse * secondsPerBeat) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        const ring = Math.min(chord.until - at, secondsPerBeat * 0.85);
        let freq = bassRoot * Math.pow(2, chord.tones[0] / 12);
        if (freq > 160) freq /= 2;
        osc.type = 'sine'; osc.frequency.setValueAtTime(freq, at);
        gain.gain.setValueAtTime(0.0001, at); gain.gain.linearRampToValueAtTime(pulse ? 0.2 : 0.26, at + Math.min(0.012, ring / 2));
        gain.gain.exponentialRampToValueAtTime(0.0001, at + ring);
        osc.connect(gain); gain.connect(dest.dry); osc.start(at); osc.stop(at + ring + 0.05);
        sources.push(osc); rawSources.push({ node: osc, stopAt: at + ring + 0.05 });
        if (at + ring + 0.05 > latestStop) latestStop = at + ring + 0.05;
      }
    });
    // Short opening call, fuller arrival. A single/very short phrase gets just the arrival,
    // and an all-rest phrase gets neither. Use the actual swung onsets, not a beat estimate.
    const accents = [];
    // playTone has a 50 ms minimum decay; skip a call that would smear a tight shuffle pair.
    if (firstNote && finalNote.at - firstNote.at >= secondsPerBeat * 0.5 && onsets[1].at - firstNote.at >= 0.08) accents.push(firstNote);
    if (finalNote) accents.push(finalNote);
    for (const note of accents) {
      const finale = note === finalNote;
      const chord = [...chords].reverse().find(c => c.at <= note.at + 1e-9) || chords[0];
      if (!chord?.voicing) continue;
      const duration = finale ? Math.min(0.6, secondsPerBeat * 0.9, end - note.at + (looping ? 0 : 0.25))
        : Math.min(0.22, (onsets[1].at - note.at) * 0.65);
      const tones = [...chord.voicing];
      // An upper octave of the final melody pitch supplies the lift without adding a new degree.
      if (finale) tones.push(((note.semi % 12) + 12) % 12 + 12);
      for (const tone of tones) {
        const h = playTone(ctx, dest.pad, {
          instrument: 11, freq: padRoot * Math.pow(2, tone / 12), startTime: note.at,
          duration, decay: duration, volume: finale ? 0.28 : 0.2, soft: 0.006
        });
        sources.push(h);
        if (h.endTime > latestStop) latestStop = h.endTime;
      }
    }
    // Percussion: a soft hat on every beat, a little stronger every fourth (reusing per-context grainNoise).
    const hatBuffer = grainNoise(ctx);
    const hatFilter = ctx.createBiquadFilter();
    hatFilter.type = 'highpass'; hatFilter.frequency.setValueAtTime(3500, start); hatFilter.connect(dest.dry);
    for (let beat = 0, at = start; at < end - 0.01; beat++, at = start + beat * secondsPerBeat) {
      const hat = ctx.createBufferSource(), gain = ctx.createGain();
      hat.buffer = hatBuffer;
      gain.gain.setValueAtTime(beat % 4 ? 0.025 : 0.04, at); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      hat.connect(gain); gain.connect(hatFilter); hat.start(at); hat.stop(at + 0.06);
      sources.push(hat); rawSources.push({ node: hat, stopAt: at + 0.06 });
      if (at + 0.06 > latestStop) latestStop = at + 0.06;
    }
    for (const at of accents.map(note => note.at)) {
      const kick = ctx.createOscillator(), gain = ctx.createGain();
      kick.type = 'sine'; kick.frequency.setValueAtTime(150, at); kick.frequency.exponentialRampToValueAtTime(80, at + 0.12);
      gain.gain.setValueAtTime(0.0001, at); gain.gain.linearRampToValueAtTime(0.35, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      kick.connect(gain); gain.connect(dest.dry); kick.start(at); kick.stop(at + 0.2);
      sources.push(kick); rawSources.push({ node: kick, stopAt: at + 0.2 });
      if (at + 0.2 > latestStop) latestStop = at + 0.2;
    }
    const lastRaw = rawSources.reduce((best, item) => (!best || item.stopAt > best.stopAt ? item : best), null);
    if (lastRaw) {
      lastRaw.node.onended = () => { try { pad.disconnect(); hatFilter.disconnect(); } catch {} };
    } else {
      try { pad.disconnect(); hatFilter.disconnect(); } catch {}
    }
    return {
      voicing,
      endTime: latestStop,
      stop() {
        for (const source of sources) { try { source.stop(); } catch {} }
        try { pad.disconnect(); hatFilter.disconnect(); } catch {}
      }
    };
  }

  // options.loop repeats the phrase seamlessly until stopped. Each repeat is scheduled on the audio
  // clock an even number of beats after the last (the melody plus a rest of about four of its own
  // notes, rounded up), and the accompaniment runs through the rest, so the loop stays on one beat.
  function playFanfare(voice, customCtx = null, onNoteCallback = null, options = {}) {
    stopAll();
    const ctx = customCtx || getAudioContext();
    if (!ctx) return { stop() {} };

    const parsed = parseVoiceInfo(voice);
    const master = createFanfareChain(ctx);
    const secondsPerBeat = 60 / parsed.tempoBpm;
    const now = ctx.currentTime + 0.05; // tiny lead-in for smooth scheduling

    const activeNodes = [];
    const timers = new Set();

    const pitches = scalePitches(parsed.scaleIndex), variations = loopVariations(voice);
    const fit = (freq, low) => { while (freq >= low * 2) freq /= 2; while (freq < low) freq *= 2; return freq; };
    const padRoot = fit(parsed.rootFreq, 130), bassRoot = fit(parsed.rootFreq, 80);
    const baseNotes = parsed.notes.map(n => ({ ...n, semi: n.isRest ? null : n.midi - parsed.rootMidi }));
    let previousVoicing = null;

    function pruneFinished() {
      const t = ctx.currentTime;
      let keep = 0;
      for (let i = 0; i < activeNodes.length; i++) {
        if (!(activeNodes[i].endTime <= t)) activeNodes[keep++] = activeNodes[i];
      }
      activeNodes.length = keep;
    }

    function phrase(phraseStart, accompanyUntil = null, variation = null) {
      const notes = variation ? variation(baseNotes, pitches) : baseNotes;
      let currentTime = phraseStart, beat = 0;
      const onsets = [];
      notes.forEach((note, i) => {
        // Groove / swing offset
        let swingOffset = 0;
        if (parsed.grooveIndex === 1 && (i % 2 === 1)) {
          // Light swing
          swingOffset = secondsPerBeat * 0.12;
        } else if (parsed.grooveIndex === 2 && (i % 2 === 1)) {
          // Shuffle
          swingOffset = secondsPerBeat * 0.22;
        }

        const noteStartTime = currentTime + swingOffset;
        const nominalDuration = note.beats * secondsPerBeat;
        // Staccato groove shortens held note
        const playDuration = parsed.grooveIndex === 3 ? nominalDuration * 0.55 : nominalDuration * 0.92;

        if (!note.isRest) {
          // Notes alternate slightly left and right for width, and may ring a little past their
          // length (the DNA decay still caps it) so the line sounds connected rather than chopped.
          let dest = master.lead, panner = null;
          if (ctx.createStereoPanner) {
            panner = ctx.createStereoPanner();
            const fanfarePan = audioMode === 'mono' ? 0 : (i % 2 ? 0.15 : -0.15);
            panner.pan.setValueAtTime(fanfarePan, noteStartTime);
            panner.connect(master.lead);
            dest = panner;
          }
          let freq = parsed.rootFreq * Math.pow(2, note.semi / 12);
          while (freq > 2600) freq /= 2; // variations never climb into shrill registers
          const handle = playTone(ctx, dest, {
            instrument: parsed.instrumentIndex,
            freq,
            startTime: noteStartTime,
            duration: playDuration,
            decay: Math.min(parsed.decaySeconds, playDuration * 1.5),
            timbreMod: parsed.timbreMod,
            volume: FANFARE_LEVELS[parsed.instrumentIndex],
            soft: 0.012,
            cleanupNode: panner
          });
          activeNodes.push(handle);
          onsets.push({ beat, at: noteStartTime, semi: note.semi });
        }

        // Visual callback sync
        if (typeof onNoteCallback === 'function' && !isOfflineContext(ctx)) {
          const delayMs = Math.max(0, (noteStartTime - ctx.currentTime) * 1000);
          const timerId = setTimeout(() => {
            timers.delete(timerId);
            onNoteCallback(i, parsed.notes[note.index]);
          }, delayMs);
          timers.add(timerId);
        }

        currentTime += nominalDuration;
        beat += note.beats;
      });
      // One chord per beat plus the final sounding onset, merging repeats. The last melody
      // note supplies the arrival harmony, including during trailing rests and loop padding.
      const until = accompanyUntil ?? currentTime, chords = [], boundaries = [];
      const finalNote = onsets[onsets.length - 1];
      for (let b = 0; phraseStart + b * secondsPerBeat < until - 0.01; b++) boundaries.push(phraseStart + b * secondsPerBeat);
      if (finalNote && !boundaries.some(at => Math.abs(at - finalNote.at) < 1e-9)) boundaries.push(finalNote.at);
      boundaries.sort((a, b) => a - b);
      for (let k = 0; k < boundaries.length; k++) {
        const at = boundaries[k], b = (at - phraseStart) / secondsPerBeat;
        const sounding = [...onsets].reverse().find(o => o.beat <= b + 1e-9) ?? onsets[0];
        // Hold the final note's compatible harmony through the release/loop gap. A short last
        // note between beats must not land against an unrelated pad or a forced major cadence.
        const chord = finalNote && at >= finalNote.at - 1e-9 ? chordFor(pitches, finalNote.semi)
          : b < beat && sounding ? chordFor(pitches, sounding.semi) : chordFor(pitches, 0);
        const next = boundaries[k + 1] ?? until;
        const previous = chords[chords.length - 1];
        if (previous && previous.root === chord.root) previous.until = next;
        else chords.push({ ...chord, at, until: next });
      }
      const backing = accompany(ctx, master, { start: phraseStart, end: until, secondsPerBeat, chords, padRoot, bassRoot,
        previousVoicing, onsets, looping: !!options.loop });
      previousVoicing = backing.voicing;
      activeNodes.push(backing);
      return currentTime;
    }

    // Final finish callback. The handle stays active while the reverb tail rings, so stopping
    // after the last note still silences the tail, without reporting the finish twice.
    let finished = false;
    if (options.loop) {
      const melodyBeats = parsed.notes.reduce((sum, n) => sum + n.beats, 0);
      const loopBeats = melodyBeats + 4 * melodyBeats / Math.max(1, parsed.notes.length);
      const period = Math.ceil(loopBeats / 2) * 2 * secondsPerBeat;
      let next = now, repeat = 0;
      // Keep at least one full repeat queued ahead of the audio clock.
      const queue = () => {
        pruneFinished();
        while (next < ctx.currentTime + period) { phrase(next, next + period, variations[repeat++ % variations.length]); next += period; }
        if (!isOfflineContext(ctx)) {
          const id = setTimeout(() => { timers.delete(id); queue(); }, period * 500);
          timers.add(id);
        }
      };
      queue();
    } else {
      const end = phrase(now);
      master.disconnectAfter(Math.max(0.5, end - ctx.currentTime + 1.55));
      if (typeof onNoteCallback === 'function' && !isOfflineContext(ctx)) {
        const finishDelayMs = Math.max(0, (end - ctx.currentTime + 0.2) * 1000);
        const finishTimer = setTimeout(() => {
          timers.delete(finishTimer);
          finished = true;
          onNoteCallback(-1, null); // -1 indicates playback finished
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
        if (activePlayback === handle) activePlayback = null;
      }
    };
    activePlayback = handle;
    return handle;
  }

  const api = {
    INSTRUMENTS,
    SCALES,
    TEMPOS,
    GROOVES,
    NOTE_NAMES,
    midiNote,
    noteFrequency,
    noteName,
    decaySeconds,
    scaleDegreeSemitones,
    parseVoiceInfo,
    getAudioContext,
    setupAudioBuses,
    setSoundVolume,
    getSoundVolume,
    setMusicVolume,
    getMusicVolume,
    setAudioMode,
    getAudioMode,
    isStereo,
    setOrientation,
    isPortrait,
    panFromField,
    shareMasterChain,
    playVoice,
    playCollision,
    playBallHit,
    playCoin,
    playPack,
    playUnwrap,
    playUbuMove,
    playSpin,
    playPuckSlide,
    playCarve,
    playSlipstream,
    playSpinStrike,
    playWallHit,
    playFireImpact,
    playSave,
    playFirework,
    playSizzle,
    playGoalHit,
    playFoul,
    playIronSave,
    playSuper,
    playGameStart,
    playFanfare,
    scalePitches,
    chordFor,
    loopVariations,
    stopMotion,
    stop: stopAll
  };

  Object.freeze(api);
  globalThis.ubuAudio = api;
  if (typeof window !== 'undefined') {
    window.ubuAudio = api;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})();
