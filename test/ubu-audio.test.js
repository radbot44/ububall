'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ubu = require('../shared/ubu.js');
const audio = require('../shared/ubu-audio.js');

assert.equal(globalThis.ubuAudio, audio);

// Minimal WebAudio context that enforces AudioParam spec invariants:
// finite values, monotonic non-negative timestamps, and strictly positive exponential ramp targets.
function recordedContext(extra = {}) {
  const nodes = [];
  const param = (initial = 0) => ({
    events: [],
    value: initial,
    setValueAtTime(value, time) {
      assert.ok(Number.isFinite(value) && Number.isFinite(time) && time >= 0, `invalid setValueAtTime(${value}, ${time})`);
      if (this.events.length) assert.ok(time >= this.events.at(-1)[1] - 1e-12, `out-of-order setValueAtTime ${time} < ${this.events.at(-1)[1]}`);
      this.events.push([value, time, 'set']);
      this.value = value;
    },
    linearRampToValueAtTime(value, time) {
      assert.ok(Number.isFinite(value) && Number.isFinite(time) && time >= 0, `invalid linearRamp(${value}, ${time})`);
      if (this.events.length) assert.ok(time >= this.events.at(-1)[1] - 1e-12, `out-of-order linearRamp ${time} < ${this.events.at(-1)[1]}`);
      this.events.push([value, time, 'linear']);
    },
    exponentialRampToValueAtTime(value, time) {
      assert.ok(Number.isFinite(value) && value > 0 && Number.isFinite(time) && time >= 0, `invalid exponentialRamp(${value}, ${time})`);
      if (this.events.length) {
        assert.ok(time >= this.events.at(-1)[1] - 1e-12, `out-of-order exponentialRamp ${time} < ${this.events.at(-1)[1]}`);
        assert.ok(this.events.at(-1)[0] > 0, `exponentialRamp from non-positive value ${this.events.at(-1)[0]}`);
      }
      this.events.push([value, time, 'exp']);
    },
    cancelScheduledValues(time) {
      assert.ok(Number.isFinite(time) && time >= 0, `invalid cancelScheduledValues(${time})`);
      this.events = this.events.filter(e => e[1] < time);
    }
  });
  const node = kind => {
    const n = {
      kind,
      connect() {},
      disconnect() {},
      start(time = 0) { assert.ok(Number.isFinite(time) && time >= 0); },
      stop(time = 0) { assert.ok(Number.isFinite(time) && time >= 0); },
      setPeriodicWave() {}
    };
    for (const [key, init] of [['gain', 1], ['frequency', 440], ['detune', 0], ['Q', 1],
      ['threshold', -12], ['knee', 30], ['ratio', 4], ['attack', 0.005], ['release', 0.25], ['pan', 0], ['offset', 1]]) {
      n[key] = param(init);
    }
    nodes.push(n);
    return n;
  };
  return {
    nodes, currentTime: 0, sampleRate: 8000, destination: node('destination'),
    createGain: () => node('gain'), createOscillator: () => node('oscillator'),
    createBiquadFilter: () => node('filter'), createDynamicsCompressor: () => node('compressor'),
    createStereoPanner: () => node('panner'), createBufferSource: () => node('buffer'),
    createConvolver: () => node('room'), createConstantSource: () => node('constant'),
    createPeriodicWave: (real, imag) => ({ real: Float32Array.from(real), imag: Float32Array.from(imag) }),
    createBuffer: (channels, length, sampleRate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { sampleRate, getChannelData: channel => data[channel] };
    },
    ...extra
  };
}

test('DNA voice & anthem parsing, pitch math, and panFromField spatial math', () => {
  assert.equal(audio.midiNote(0), 36);
  assert.equal(audio.midiNote(24), 60);
  assert.equal(audio.midiNote(63), 99);
  assert.ok(Math.abs(audio.noteFrequency(69) - 440) < 1e-6);
  assert.ok(Math.abs(audio.noteFrequency(57) - 220) < 1e-6);
  assert.equal(audio.noteName(60), 'C4');
  assert.equal(audio.noteName(69), 'A4');

  assert.equal(audio.parseVoiceInfo(null).instrument, 'Soft Bell');
  const parsed = audio.parseVoiceInfo({
    instrument: 3, pitch: 24, decay: 6, timbreMod: 1, scale: 2, tempo: 3, groove: 1,
    notes: [{ degree: 0, duration: 0 }, { degree: 2, duration: 1 }, { degree: 4, duration: 2 }, { degree: 0, duration: 3 }]
  });
  assert.equal(parsed.instrument, 'Crystal Chime');
  assert.equal(parsed.rootMidi, 60);
  assert.equal(parsed.tempoBpm, 120);
  assert.equal(parsed.notes[0].name, 'C4');
  assert.equal(parsed.notes[1].name, 'E4');
  assert.equal(parsed.notes[3].isRest, true);

  // 1/32 signature drop gate across bits 657-661
  let activeCount = 0;
  for (let g = 0; g < 32; g++) {
    const info = audio.parseVoiceInfo({
      pitch: 24, scale: 0, notes: [{ degree: 0, duration: 1 }],
      answerNotes: [{ degree: 2, duration: 1 }], phraseForm: g % 8, signatureGate: g
    });
    assert.equal(info.hasSignatureDrop, g === 31);
    if (info.hasSignatureDrop) {
      activeCount++;
      assert.equal(info.signatureDrop, audio.SIGNATURE_DROPS[(g % 8) & 3]);
    } else {
      assert.equal(info.signatureDrop, null);
    }
  }
  assert.equal(activeCount, 1);

  // All 8 phrase forms decode from 1024-bit DNA into in-key 16-note anthems
  const dna = new Uint8Array(128);
  const setBits = (buf, start, width, val) => {
    for (let i = 0; i < width; i++) {
      const bit = start + i, mask = 1 << (7 - (bit & 7));
      buf[bit >> 3] = (buf[bit >> 3] & ~mask) | (((val >> (width - i - 1)) & 1) ? mask : 0);
    }
  };
  setBits(dna, 534, 4, 3);
  setBits(dna, 538, 6, 24);
  setBits(dna, 550, 3, 0);
  for (let i = 0; i < 8; i++) {
    setBits(dna, 556 + i * 5, 5, ((i % 7) << 2) | (i % 3));
    setBits(dna, 601 + i * 5, 5, (((7 - i) % 7) << 2) | ((i + 1) % 3));
  }
  const majorPitches = audio.scalePitches(0);
  for (let form = 0; form < 8; form++) {
    setBits(dna, 598, 3, form);
    const info = audio.parseVoiceInfo(ubu.decode(dna).voice);
    assert.equal(info.hasAnthem, true);
    assert.equal(info.anthemNotes.length, 16);
    for (const n of info.anthemNotes) {
      if (!n.isRest) assert.ok(majorPitches.includes((((n.midi - info.rootMidi) % 12) + 12) % 12));
    }
    if (form === 1 || form === 6 || form === 7) {
      const last = info.effectiveAnswerNotes.findLast(n => !n.isRest);
      assert.equal((((last.midi - info.rootMidi) % 12) + 12) % 12, 0);
    }
    if (form === 5) assert.equal(info.effectiveAnswerNotes[0].midi, info.answerNotes[0].midi + 12);
  }

  // Spatial panFromField math (landscape, portrait, mono)
  audio.setAudioMode('mono');
  assert.equal(audio.panFromField(1000, 300), 0);
  audio.setAudioMode('stereo');
  audio.setOrientation(false);
  assert.equal(Number(audio.panFromField(500, 300).toFixed(4)), 0);
  assert.equal(Number(audio.panFromField(0, 300).toFixed(4)), -0.75);
  assert.equal(Number(audio.panFromField(1000, 300).toFixed(4)), 0.75);
  assert.equal(Number(audio.panFromField(-200, 300).toFixed(4)), -0.75);
  assert.equal(Number(audio.panFromField(1200, 300).toFixed(4)), 0.75);
  audio.setOrientation(true);
  assert.equal(Number(audio.panFromField(500, 300).toFixed(4)), 0);
  assert.equal(Number(audio.panFromField(500, 0).toFixed(4)), -0.75);
  assert.equal(Number(audio.panFromField(500, 600).toFixed(4)), 0.75);
  audio.setOrientation(false);
});

test('chordFor and loopVariations stay in key and deterministic from DNA', () => {
  const major = audio.scalePitches(0);
  assert.deepEqual(major, [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(audio.chordFor(major, 0).tones, [0, 4, 7]);
  assert.deepEqual(audio.chordFor(major, 5).tones, [5, 9, 0]);
  for (let hp = 0; hp < 8; hp++) {
    for (let scale = 0; scale < 8; scale++) {
      const pitches = audio.scalePitches(scale);
      for (const pc of pitches) {
        const ch = audio.chordFor(pitches, pc, hp, 2);
        assert.ok(ch.tones.includes(pc));
        assert.equal(ch.pedal, hp === 3);
      }
    }
  }
  const voice = {
    instrument: 5, pitch: 28, decay: 4, timbreMod: 1, scale: 1, tempo: 4, groove: 0,
    notes: Array.from({ length: 8 }, (_, i) => ({ degree: (i * 5) % 8, duration: i % 4 }))
  };
  const cycle = audio.loopVariations(voice);
  assert.equal(cycle.length, 4);
  assert.equal(cycle[0], null);
  assert.equal(cycle[2], null);
  assert.ok(cycle[1] && cycle[3] && cycle[1] !== cycle[3]);
  assert.deepEqual(audio.loopVariations({ ...voice }), cycle);
  const pitches = audio.scalePitches(voice.scale), info = audio.parseVoiceInfo(voice);
  const notes = info.notes.map(n => ({ ...n, semi: n.isRest ? null : n.midi - info.rootMidi }));
  for (const variation of [cycle[1], cycle[3]]) {
    const varied = variation(notes, pitches);
    assert.deepEqual(varied.map(n => n.beats).sort(), notes.map(n => n.beats).sort());
    for (const n of varied) if (!n.isRest) assert.ok(pitches.includes(((n.semi % 12) + 12) % 12));
  }
});

test('null AudioContext safely no-ops across playback entrypoints', () => {
  assert.equal(audio.getAudioContext(), null);
  const voice = { instrument: 0, pitch: 30, decay: 4, timbreMod: 0 };
  assert.doesNotThrow(() => audio.playCollision(voice).stop());
  assert.doesNotThrow(() => audio.playSuper('shockwave', 'impact').stop());
  assert.doesNotThrow(() => audio.playBallHit({ snap: true }));
  assert.doesNotThrow(() => audio.playWallHit());
  assert.doesNotThrow(() => audio.playGoalHit('post', { spin: 20, speed: 650 }));
  assert.doesNotThrow(() => audio.playCarve({ volume: 0.6 }));
  assert.doesNotThrow(() => audio.playSlipstream({ volume: 0.5 }));
  assert.doesNotThrow(() => audio.playUbuMove({ speed: 450, mass: 3, radius: 25 }));
  assert.doesNotThrow(() => audio.playSpin({ omega: 14, radius: 25 }));
  assert.doesNotThrow(() => audio.playPuckSlide({ speed: 500 }));
  assert.doesNotThrow(() => audio.playSpinStrike({ spin: 16 }));
  assert.doesNotThrow(() => audio.playSpinTwirl({ spin: 16 }));
  assert.doesNotThrow(() => audio.playFireImpact({ volume: 0.8 }));
  assert.doesNotThrow(() => audio.playAimScrape({ speed: 520, power: 0.8 }).stop());
  assert.doesNotThrow(() => audio.playGuardToggle(true));
  assert.doesNotThrow(() => audio.playGuardToggle(false));
  assert.doesNotThrow(() => audio.playGuardHit({ strength: 0.75, graze: 0.2 }));
  assert.doesNotThrow(() => audio.playBallHit({ graze: 0.85, poke: true, pokeFrac: 0.9 }));
  assert.doesNotThrow(() => audio.playBallHit({ graze: 0.1, tape: true }));
  assert.doesNotThrow(() => audio.playLaunchPush({ power: 0.9, mass: 2.3, radius: 18 }));
  assert.doesNotThrow(() => audio.playLaunchPush({ power: 0.9, mass: 4.8, radius: 37 }));
  assert.doesNotThrow(() => audio.playSpinTick({ spin: 0.65, center: false }));
  assert.doesNotThrow(() => audio.playSpinTick({ spin: 0, center: true }));
  assert.doesNotThrow(() => audio.playWallHit({ speed: 480, spinBite: 0.9, scuff: 0 }));
  assert.doesNotThrow(() => audio.playWallHit({ speed: 340, spinBite: 0, scuff: 0.85 }));
  assert.doesNotThrow(() => audio.playBodyBump({ speed: 360, massA: 4.8, massB: 2.3, asymmetry: 0.75 }));
  assert.doesNotThrow(() => audio.playCarve({ brake: true, speed: 500 }));
  assert.doesNotThrow(() => audio.playSave({ own: false }));
  assert.doesNotThrow(() => audio.playFirework({ ring: true, pan: -0.3 }));
  assert.doesNotThrow(() => audio.stopMotion());
});

test('all synthesis entrypoints satisfy WebAudio AudioParam spec invariants', () => {
  for (let inst = 0; inst < 16; inst++) {
    for (let mod = 0; mod < 4; mod++) {
      const ctx = recordedContext({ currentTime: 1.0 });
      const handle = audio.playVoice({
        instrument: inst, pitch: 20 + inst, decay: 5, timbreMod: mod,
        scale: inst % 8, tempo: 3, groove: 0, notes: [{ degree: 0, duration: 1 }]
      }, ctx);
      handle.stop();
    }
  }

  const baseVoice = {
    instrument: 11, pitch: 24, decay: 6, timbreMod: 1, scale: 2, tempo: 4, groove: 1,
    notes: Array.from({ length: 8 }, (_, i) => ({ degree: i % 8, duration: i === 4 ? 3 : (i % 3) })),
    phraseForm: 0,
    answerNotes: Array.from({ length: 8 }, (_, i) => ({ degree: (7 - i) % 8, duration: i === 6 ? 3 : ((i + 1) % 3) })),
    backingTexture: 0, drumBass: 0, harmonyProg: 0, leadExpr: 0, acousticStage: 0, signatureGate: 0
  };
  for (let b = 0; b < 8; b++) audio.playFanfare({ ...baseVoice, backingTexture: b }, recordedContext()).stop();
  for (let db = 0; db < 16; db++) audio.playFanfare({ ...baseVoice, drumBass: db }, recordedContext()).stop();
  for (let hp = 0; hp < 8; hp++) audio.playFanfare({ ...baseVoice, harmonyProg: hp }, recordedContext()).stop();
  for (let expr = 0; expr < 8; expr++) audio.playFanfare({ ...baseVoice, leadExpr: expr }, recordedContext()).stop();
  for (let st = 0; st < 8; st++) audio.playFanfare({ ...baseVoice, acousticStage: st }, recordedContext()).stop();
  for (let drop = 0; drop < 4; drop++) {
    audio.playFanfare({ ...baseVoice, phraseForm: drop, signatureGate: 31 }, recordedContext()).stop();
    audio.playFanfare({ ...baseVoice, phraseForm: drop, signatureGate: 31 }, recordedContext({ constructor: { name: 'OfflineAudioContext' } })).stop();
  }
  audio.playFanfare(baseVoice, recordedContext(), null, { loop: true }).stop();

  const ctx = recordedContext({ currentTime: 0.5 });
  audio.playGameStart({ ctx, volume: 0.9 }).stop();
  audio.playCollision(baseVoice, { ctx, volume: 0.5 }).stop();
  audio.playBallHit({ ctx, volume: 0.8, graze: 0, pokeFrac: 0 });
  audio.playBallHit({ ctx, volume: 0.8, graze: 0.15, poke: true, pokeFrac: 0.92 });
  audio.playBallHit({ ctx, volume: 0.8, graze: 0.12, tape: true, pokeFrac: 0.25 });
  audio.playBallHit({ ctx, volume: 0.8, graze: 0.9, poke: true });
  audio.playBallHit({ ctx, volume: 0.8, snap: true });
  audio.playLaunchPush({ ctx, power: 0.95, mass: 2.2, radius: 17, x: 220, y: 300 });
  audio.playLaunchPush({ ctx, power: 0.95, mass: 4.9, radius: 38, x: 420, y: 300 });
  audio.playSpinTick({ ctx, spin: 0.72, center: false, x: 300, y: 300 });
  audio.playSpinTick({ ctx, spin: 0, center: true, x: 300, y: 300 });
  audio.playWallHit({ ctx, volume: 0.78, speed: 490, spinBite: 0.92, scuff: 0, x: 500, y: 60 });
  audio.playWallHit({ ctx, volume: 0.72, speed: 350, spinBite: 0, scuff: 0.88, x: 110, y: 90 });
  audio.playBodyBump({ ctx, speed: 380, massA: 4.8, massB: 2.3, asymmetry: 0.78, x: 500, y: 300 });
  audio.playBodyBump({ ctx, speed: 260, massA: 2.2, massB: 2.3, asymmetry: 0.05, x: 500, y: 300 });
  audio.playAimScrape({ ctx, speed: 620, power: 0.85 }).stop();
  audio.playAimScrape({ ctx, id: 0, speed: 680, power: 0.9, x: 240, y: 300 });
  audio.playAimScrape({ ctx, id: 0, speed: 120, power: 0.9, x: 245, y: 302 });
  audio.playAimScrape({ ctx, id: 0, speed: 0 });
  audio.playGuardToggle(true, { ctx, volume: 0.8, x: 180, y: 300 });
  audio.playGuardToggle(false, { ctx, volume: 0.8, x: 180, y: 300 });
  audio.playGuardHit({ ctx, strength: 0.15, graze: 0.6, volume: 0.5, x: 300, y: 300 });
  audio.playGuardHit({ ctx, strength: 0.95, graze: 0.05, volume: 0.95, x: 150, y: 300 });
  audio.playCarve({ ctx, cut: 0.85, speed: 540, volume: 0.65, x: 450, y: 260 });
  audio.playCarve({ ctx, brake: true, speed: 580, volume: 0.75, x: 450, y: 260 });
  audio.playWallHit({ ctx, volume: 0.6, x: 1000, y: 300 });
  audio.playGoalHit('post', { ctx, volume: 0.9, spin: 24, speed: 720 });
  audio.playGoalHit('net', { ctx, volume: 0.7 });
  audio.playCarve({ ctx, volume: 0.7 });
  audio.playSlipstream({ ctx, volume: 0.6 });
  for (const kind of ['deal', 'pick', 'charge', 'crack', 'reveal', 'scamper']) {
    audio.playPack(kind, { ctx: recordedContext(), stage: 3, charge: 4, charges: [0, 2, 5], charged: true, material: true });
  }
  for (const kind of ['flick', 'land']) audio.playCoin(kind, { ctx: recordedContext() });
  for (const wrap of ['plastic', 'foil', 'blob', 'gumball', 'egg', 'gift', 'cookie', 'envelope']) {
    audio.playUnwrap(wrap, 1.2, { ctx: recordedContext() });
  }
  audio.playUnwrap('gift', 0, { ctx: recordedContext() });
  audio.playUnwrap('plastic', undefined, { ctx: recordedContext() });
  audio.playFoul('warning', { ctx, volume: 0.8 });
  audio.playFoul('card', { ctx, volume: 0.8 });
  audio.playFoul('warning', { ctx, volume: 0 });
  audio.playFoul('card', { ctx, volume: 0 });
  audio.playIronSave({ ctx, volume: 0.9 });
  audio.playIronSave({ ctx, volume: 0 });
  audio.playSizzle({ ctx, volume: 0 }).stop();
  audio.playSizzle({ ctx: recordedContext({ constructor: { name: 'OfflineAudioContext' } }), duration: 4, volume: 0.8 }).stop();
  for (const [key, phase] of [['stalwart', 'launch'], ['stalwart', 'impact'], ['knockout', 'impact'], ['sticky', 'impact'],
    ['cannonball', 'impact'], ['magnet', 'pull'], ['colossus', 'launch'], ['shockwave', 'impact'], ['ghost', 'launch']]) {
    audio.playSuper(key, phase, { ctx });
  }
  audio.playSuper('unknown', 'impact', { ctx });
  audio.playSuper('shockwave', 'impact', { ctx, volume: 0 });
  audio.playUbuMove({ ctx, id: 0, speed: 480, mass: 3, radius: 25, x: 100, y: 300 });
  audio.playSpin({ ctx, id: 0, omega: 14, radius: 25 });
  audio.playPuckSlide({ ctx, speed: 550, spin: 12, x: 800, y: 300 });
  audio.playSpinStrike({ ctx, spin: 18, volume: 0.9 });
  audio.playSpinTwirl({ ctx, spin: 16, volume: 0.9 });
  audio.playFireImpact({ ctx, volume: 0.85 });
  audio.playSave({ ctx, own: false });
  audio.playSave({ ctx, own: true });
  audio.playFirework({ ctx, ring: false, volume: 0.8 });
  audio.playFirework({ ctx, ring: true, volume: 0.8, pan: 0.4 });
  audio.stopMotion(ctx);
  audio.stop();
});
