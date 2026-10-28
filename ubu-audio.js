'use strict';
(() => {
  const INSTRUMENTS = [
    'Soft Bell',      // 0: Warm sine/harmonic chime
    'Woodblock',      // 1: Snappy triangle percussive click
    'Metal Ping',     // 2: Metallic FM resonant ring
    'Crystal Chime',  // 3: Glassy dual sine with shimmer
    'Square Chip',    // 4: Retro 8-bit square wave with vibrato
    'Pulse Pluck',    // 5: Resonant lowpass filter sweep pluck
    'Warm Pad',       // 6: Soft swell sine + fifth harmonic
    'Sub Pluck',      // 7: Deep punchy sine with transient
    'Kalimba',        // 8: Acoustic thumb piano with overtone ping
    'Marimba',        // 9: Hollow wooden mallet pop
    'Vibraphone',     // 10: Sine with warm tremolo wobble
    'Brass Ping',     // 11: Sawtooth with envelope filter swell
    'Electric Piano', // 12: Bell transient + Rhodes tine warmth
    'Synth Bass',     // 13: Punchy filtered saw/square bite
    'Flute',          // 14: Breathy smooth tone
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

  function getAudioContext() {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedContext || sharedContext.state === 'closed') {
      sharedContext = new AudioCtx();
    }
    if (sharedContext.state === 'suspended') {
      sharedContext.resume().catch(() => {});
    }
    return sharedContext;
  }

  function createMasterChain(ctx, cleanup = null) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.knee.setValueAtTime(30, ctx.currentTime);
    compressor.ratio.setValueAtTime(8, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.22, ctx.currentTime);

    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);
    if (cleanup) cleanup.push(compressor, masterGain);
    return compressor;
  }

  function playTone(ctx, dest, params) {
    const {
      instrument = 0,
      freq = 440,
      startTime = ctx.currentTime,
      duration = 0.3,
      decay = 0.3,
      timbreMod = 0,
      pitchBend = 0, // semitone pitch bend for voice tone inflection
      volume = 1.0
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

    envGain.connect(volGain);
    volGain.connect(dest);

    // Timbre modifiers: detune or overtone
    const detuneCents = timbreMod === 1 ? 7 : 0;
    const resonanceBoost = timbreMod === 2 ? 4 : 0;

    switch (instrument) {
      // 0: Soft Bell (warm sine with octave chime)
      case 0: {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(freq, startTime);
        osc2.frequency.setValueAtTime(freq * 2, startTime);
        if (pitchBend) {
          osc1.frequency.exponentialRampToValueAtTime(freq, startTime + 0.05);
          osc1.frequency.setValueAtTime(freq * Math.pow(2, pitchBend / 12), startTime);
        }

        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.35, startTime);
        g2.gain.exponentialRampToValueAtTime(0.001, startTime + targetDecay * 0.4);

        osc1.connect(envGain);
        osc2.connect(g2);
        g2.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.7, startTime + 0.008);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

        osc1.start(startTime);
        osc2.start(startTime);
        osc1.stop(endTime);
        osc2.stop(endTime);
        stopNodes.push(osc1, osc2);
        break;
      }

      // 1: Woodblock (triangle through bandpass with rapid drop)
      case 1: {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        osc.type = 'triangle';
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(Math.max(400, Math.min(2200, freq * 1.5)), startTime);
        filter.Q.setValueAtTime(3.5 + resonanceBoost, startTime);

        osc.frequency.setValueAtTime(freq * 1.9, startTime);
        osc.frequency.exponentialRampToValueAtTime(freq, startTime + 0.025);

        osc.connect(filter);
        filter.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.85, startTime + 0.003);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(0.18, targetDecay * 0.5));

        osc.start(startTime);
        osc.stop(endTime);
        stopNodes.push(osc);
        break;
      }

      // 2: Metal Ping (FM synthesis)
      case 2: {
        const carrier = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();

        carrier.type = 'sine';
        mod.type = 'sine';
        carrier.frequency.setValueAtTime(freq, startTime);
        mod.frequency.setValueAtTime(freq * 2.756, startTime);

        modGain.gain.setValueAtTime(freq * (1.8 + resonanceBoost * 0.5), startTime);
        modGain.gain.exponentialRampToValueAtTime(0.1, startTime + targetDecay * 0.35);

        mod.connect(modGain);
        modGain.connect(carrier.frequency);

        carrier.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.65, startTime + 0.005);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

        carrier.start(startTime);
        mod.start(startTime);
        carrier.stop(endTime);
        mod.stop(endTime);
        stopNodes.push(carrier, mod);
        break;
      }

      // 3: Crystal Chime (dual glassy sine with detune)
      case 3: {
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        o1.type = 'sine'; o2.type = 'sine';
        o1.frequency.setValueAtTime(freq, startTime);
        o2.frequency.setValueAtTime(freq * 2.5, startTime);
        o1.detune.setValueAtTime(detuneCents - 4, startTime);
        o2.detune.setValueAtTime(detuneCents + 6, startTime);

        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.4, startTime);

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
        osc.frequency.setValueAtTime(freq, startTime);

        // Subtle vibrato
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(6.0, startTime);
        lfoGain.gain.setValueAtTime(freq * 0.015, startTime);
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

      // 5: Pulse Pluck (saw wave with resonant lowpass filter sweep)
      case 5: {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, startTime);

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

      // 6: Warm Pad (sine + fifth harmonic with soft attack)
      case 6: {
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        o1.type = 'sine'; o2.type = 'triangle';
        o1.frequency.setValueAtTime(freq, startTime);
        o2.frequency.setValueAtTime(freq * 1.498, startTime); // Fifth harmonic

        o1.connect(envGain);
        o2.connect(envGain);

        const attack = 0.035;
        envGain.gain.linearRampToValueAtTime(0.4, startTime + attack);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

        o1.start(startTime); o2.start(startTime);
        o1.stop(endTime); o2.stop(endTime);
        stopNodes.push(o1, o2);
        break;
      }

      // 7: Sub Pluck (deep round punch)
      case 7: {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        // Drop an octave if too high for bass
        const subFreq = freq > 320 ? freq * 0.5 : freq;
        osc.frequency.setValueAtTime(subFreq, startTime);

        osc.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.75, startTime + 0.006);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

        osc.start(startTime);
        osc.stop(endTime);
        stopNodes.push(osc);
        break;
      }

      // 8: Kalimba (sine with high wooden tine ping)
      case 8: {
        const osc1 = ctx.createOscillator(), osc2 = ctx.createOscillator();
        osc1.type = 'sine'; osc2.type = 'sine';
        osc1.frequency.setValueAtTime(freq, startTime);
        osc2.frequency.setValueAtTime(freq * 3.85, startTime);

        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.45, startTime);
        g2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.035);

        osc1.connect(envGain);
        osc2.connect(g2);
        g2.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.65, startTime + 0.004);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

        osc1.start(startTime); osc2.start(startTime);
        osc1.stop(endTime); osc2.stop(endTime);
        stopNodes.push(osc1, osc2);
        break;
      }

      // 9: Marimba (triangle through resonant wooden bandpass)
      case 9: {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(freq, startTime);
        filter.Q.setValueAtTime(4.5 + resonanceBoost, startTime);

        osc.connect(filter);
        filter.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.7, startTime + 0.004);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(0.3, targetDecay * 0.6));

        osc.start(startTime);
        osc.stop(endTime);
        stopNodes.push(osc);
        break;
      }

      // 10: Vibraphone (sine with tremolo)
      case 10: {
        const osc = ctx.createOscillator();
        const trem = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(5.4, startTime);
        lfoGain.gain.setValueAtTime(0.25, startTime);
        trem.gain.setValueAtTime(0.75, startTime);

        lfo.connect(lfoGain);
        lfoGain.connect(trem.gain);

        osc.connect(trem);
        trem.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.6, startTime + 0.01);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

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
        osc.frequency.setValueAtTime(freq, startTime);

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

      // 12: Electric Piano (bell transient + warm Rhodes body)
      case 12: {
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        o1.type = 'sine'; o2.type = 'triangle';
        o1.frequency.setValueAtTime(freq, startTime);
        o2.frequency.setValueAtTime(freq * 2, startTime);

        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.3, startTime);
        g2.gain.exponentialRampToValueAtTime(0.001, startTime + 0.1);

        o1.connect(envGain);
        o2.connect(g2);
        g2.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.6, startTime + 0.008);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

        o1.start(startTime); o2.start(startTime);
        o1.stop(endTime); o2.stop(endTime);
        stopNodes.push(o1, o2);
        break;
      }

      // 13: Synth Bass (saw + square with resonant lowpass bite)
      case 13: {
        const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        o1.type = 'sawtooth'; o2.type = 'square';
        o1.frequency.setValueAtTime(freq, startTime);
        o2.frequency.setValueAtTime(freq, startTime);
        o2.detune.setValueAtTime(detuneCents + 8, startTime);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(Math.min(3200, freq * 5), startTime);
        filter.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.9), startTime + targetDecay * 0.6);
        filter.Q.setValueAtTime(5.0 + resonanceBoost, startTime);

        o1.connect(filter);
        o2.connect(filter);
        filter.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.42, startTime + 0.008);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

        o1.start(startTime); o2.start(startTime);
        o1.stop(endTime); o2.stop(endTime);
        stopNodes.push(o1, o2);
        break;
      }

      // 14: Flute (gentle breathy sine/triangle)
      case 14: {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);

        osc.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.5, startTime + 0.035);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + targetDecay);

        osc.start(startTime);
        osc.stop(endTime);
        stopNodes.push(osc);
        break;
      }

      // 15: Space Zap (retro downward pitch sweep)
      case 15:
      default: {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * 3.2, startTime);
        osc.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.6), startTime + 0.08);

        osc.connect(envGain);

        envGain.gain.linearRampToValueAtTime(0.6, startTime + 0.004);
        envGain.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.min(0.22, targetDecay * 0.5));

        osc.start(startTime);
        osc.stop(endTime);
        stopNodes.push(osc);
        break;
      }
    }

    return {
      stop() {
        try {
          envGain.gain.cancelScheduledValues(ctx.currentTime);
          envGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.01);
          volGain.gain.cancelScheduledValues(ctx.currentTime);
          volGain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.01);
          for (const node of stopNodes) {
            try { node.stop(ctx.currentTime + 0.015); } catch {}
          }
        } catch {}
      }
    };
  }

  // Active playback tracker for stop()
  let activePlayback = null;

  function stopAll() {
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
    const master = createMasterChain(ctx);
    const now = ctx.currentTime;
    const volume = options.volume ?? 1.0;

    // A friendly signature voice chirp / call
    const toneHandle = playTone(ctx, master, {
      instrument: parsed.instrumentIndex,
      freq: parsed.rootFreq,
      startTime: now,
      duration: parsed.decaySeconds,
      decay: parsed.decaySeconds,
      timbreMod: parsed.timbreMod,
      pitchBend: 2.5, // subtle upward scoop into pitch gives personality!
      volume
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
    const master = createMasterChain(ctx);
    const now = ctx.currentTime;
    const volume = Math.max(0.05, Math.min(1.0, options.volume ?? 1.0));

    // Collision sound: snappy, responsive impact chirp with scaled loudness
    const duration = Math.min(parsed.decaySeconds, 0.22);
    const toneHandle = playTone(ctx, master, {
      instrument: parsed.instrumentIndex,
      freq: parsed.rootFreq,
      startTime: now,
      duration: duration,
      decay: duration,
      timbreMod: parsed.timbreMod,
      pitchBend: 1.8,
      volume
    });
    return toneHandle;
  }

  function playBallHit(options = {}) {
    const ctx = options.ctx || getAudioContext();
    if (!ctx) return;
    const master = createMasterChain(ctx);
    const now = ctx.currentTime;
    const volume = Math.max(0.04, Math.min(1.0, options.volume ?? 0.8));

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.05);

    gain.gain.setValueAtTime(0.7 * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  function playWallHit(options = {}) {
    const ctx = options.ctx || getAudioContext();
    if (!ctx) return;
    const master = createMasterChain(ctx);
    const now = ctx.currentTime;
    const volume = Math.max(0.04, Math.min(1.0, options.volume ?? 0.6));

    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.06);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);

    gain.gain.setValueAtTime(0.6 * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  function playGoalHit(type = 'post', options = {}) {
    const ctx = options.ctx || getAudioContext();
    if (!ctx) return;
    const master = createMasterChain(ctx);
    const now = ctx.currentTime;
    const volume = Math.max(0.05, Math.min(1.0, options.volume ?? 0.8));

    if (type === 'post') {
      const carrier = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      const gain = ctx.createGain();

      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(1650, now);
      mod.type = 'sine';
      mod.frequency.setValueAtTime(2780, now);

      modGain.gain.setValueAtTime(1200, now);
      modGain.gain.exponentialRampToValueAtTime(0.1, now + 0.12);
      mod.connect(modGain);
      modGain.connect(carrier.frequency);

      gain.gain.setValueAtTime(0.55 * volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);

      carrier.connect(gain);
      gain.connect(master);
      carrier.start(now);
      mod.start(now);
      carrier.stop(now + 0.3);
      mod.stop(now + 0.3);
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.09);

      gain.gain.setValueAtTime(0.5 * volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 0.13);
    }
  }

  const superPlayback = new Set();
  const magnetTimes = new WeakMap();
  function playSuper(key, phase = key === 'magnet' ? 'pull' : 'impact', options = {}) {
    const phases = { stalwart: ['launch', 'impact'], knockout: ['impact'], sticky: ['impact'],
      cannonball: ['impact'], magnet: ['pull'], colossus: ['launch'], shockwave: ['impact'], ghost: ['launch'] };
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
    const master = createMasterChain(ctx, nodes), bus = ctx.createGain();
    bus.gain.setValueAtTime(volume, now); bus.connect(master);
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
    function oscillator(type, from, to, duration, dest, detune = 0) {
      const osc = ctx.createOscillator(); osc.type = type;
      osc.frequency.setValueAtTime(from, now);
      osc.frequency.exponentialRampToValueAtTime(to, now + duration);
      osc.detune.setValueAtTime(detune, now);
      osc.connect(dest); nodes.push(osc); oscillators.push(osc);
      osc.onended = () => {
        if (++ended === oscillators.length) {
          for (const node of nodes) node.disconnect();
          superPlayback.delete(handle);
        }
      };
      osc.start(now); osc.stop(now + duration + .01);
      return osc;
    }
    function tone(type, from, to, duration, level, attack = .003, filter = null, detune = 0) {
      const gain = ctx.createGain(); nodes.push(gain);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + attack);
      gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
      gain.connect(bus);
      let dest = gain;
      if (filter) {
        dest = ctx.createBiquadFilter(); nodes.push(dest);
        dest.type = filter[0]; dest.frequency.setValueAtTime(filter[1], now);
        dest.frequency.exponentialRampToValueAtTime(filter[2], now + duration);
        dest.Q.setValueAtTime(filter[3], now); dest.connect(gain);
      }
      return oscillator(type, from, to, duration, dest, detune);
    }
    function modulate(carrier, type, hz, depth, duration) {
      const gain = ctx.createGain(); nodes.push(gain);
      gain.gain.setValueAtTime(depth, now);
      gain.gain.exponentialRampToValueAtTime(.01, now + duration);
      gain.connect(carrier.frequency);
      oscillator(type, hz, hz, duration, gain);
    }
    if (key === 'stalwart') {
      const hit = phase === 'impact', duration = hit ? .18 : .38;
      const carrier = tone('sine', 110, hit ? 65 : 100, duration, .65, .003,
        hit ? ['lowpass', 700, 220, 1] : null);
      modulate(carrier, 'sine', 303, hit ? 125 : 220, duration);
    } else if (key === 'knockout') {
      const carrier = tone('sawtooth', 960, 140, .19, .28, .002, ['lowpass', 3400, 550, 1]);
      modulate(carrier, 'square', 65, 100, .19);
    } else if (key === 'sticky') {
      tone('triangle', 180, 520, .12, .8, .002, ['bandpass', 180, 520, 3]);
    } else if (key === 'cannonball') {
      tone('sine', 130, 38, .32, .9);
      tone('sawtooth', 260, 65, .075, .2, .002, ['lowpass', 1600, 100, 5]);
    } else if (key === 'magnet') {
      const carrier = tone('sine', 165, 145, .22, .12, .035);
      modulate(carrier, 'sine', 32, 18, .22);
    } else if (key === 'colossus') {
      tone('triangle', 65, 130, .55, .55, .09, null, -7);
      tone('sawtooth', 65, 130, .55, .15, .09, ['lowpass', 240, 500, .7], 7);
    } else if (key === 'shockwave') {
      tone('sine', 160, 32, .5, .9);
      tone('sawtooth', 320, 45, .16, .2, .002, ['lowpass', 1800, 90, 9]);
    } else if (key === 'ghost') {
      tone('sine', 880, 880, .75, .24, .08, null, -5);
      tone('sine', 1320, 1320, .8, .17, .09, null, 5);
      tone('sine', 1760, 1760, .85, .09, .1, null, -3);
    }
    superPlayback.add(handle);
    return handle;
  }

  function playFanfare(voice, customCtx = null, onNoteCallback = null) {
    stopAll();
    const ctx = customCtx || getAudioContext();
    if (!ctx) return { stop() {} };

    const parsed = parseVoiceInfo(voice);
    const master = createMasterChain(ctx);
    const secondsPerBeat = 60 / parsed.tempoBpm;
    const now = ctx.currentTime + 0.05; // tiny lead-in for smooth scheduling

    const activeNodes = [];
    const timers = [];
    let currentTime = now;

    parsed.notes.forEach((note, i) => {
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

      if (!note.isRest && note.freq) {
        const handle = playTone(ctx, master, {
          instrument: parsed.instrumentIndex,
          freq: note.freq,
          startTime: noteStartTime,
          duration: playDuration,
          decay: Math.min(parsed.decaySeconds, playDuration * 1.2),
          timbreMod: parsed.timbreMod
        });
        activeNodes.push(handle);
      }

      // Visual callback sync
      if (typeof onNoteCallback === 'function') {
        const delayMs = Math.max(0, (noteStartTime - ctx.currentTime) * 1000);
        const timerId = setTimeout(() => {
          onNoteCallback(i, note);
        }, delayMs);
        timers.push(timerId);
      }

      currentTime += nominalDuration;
    });

    // Final finish callback
    if (typeof onNoteCallback === 'function') {
      const finishDelayMs = Math.max(0, (currentTime - ctx.currentTime + 0.2) * 1000);
      const finishTimer = setTimeout(() => {
        onNoteCallback(-1, null); // -1 indicates playback finished
        if (activePlayback === handle) activePlayback = null;
      }, finishDelayMs);
      timers.push(finishTimer);
    }

    const handle = {
      stop() {
        for (const timer of timers) clearTimeout(timer);
        for (const node of activeNodes) node.stop();
        if (typeof onNoteCallback === 'function') onNoteCallback(-1, null);
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
    playVoice,
    playCollision,
    playBallHit,
    playWallHit,
    playGoalHit,
    playSuper,
    playFanfare,
    stop: stopAll
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.ubuAudio = api;
  }
})();
