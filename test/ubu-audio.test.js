'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const audio = require('../shared/ubu-audio.js');

assert.equal(globalThis.ubuAudio, audio);

// Record the actual scheduled sources and graph, enforcing Web Audio AudioParam invariants.
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
    const n = { kind, outputs: [], disconnected: false,
      connect(to) { this.outputs.push(to); },
      disconnect() { this.disconnected = true; },
      start(time = 0) { assert.ok(Number.isFinite(time) && time >= 0); this.started = time; },
      stop(time = 0) { assert.ok(Number.isFinite(time) && time >= 0); this.stopped = time; },
      setPeriodicWave(wave) { this.type = 'custom'; this.periodicWave = wave; } };
    for (const [key, init] of [['gain', 1], ['frequency', 440], ['detune', 0], ['Q', 1],
      ['threshold', -12], ['knee', 30], ['ratio', 4], ['attack', 0.005], ['release', 0.25], ['pan', 0], ['offset', 1]]) {
      n[key] = param(init);
    }
    nodes.push(n);
    return n;
  };
  return { nodes, currentTime: 0, sampleRate: 44100, destination: node('destination'),
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

function reaches(node, match, seen = new Set()) {
  if (seen.has(node)) return false;
  seen.add(node);
  return match(node) || node.outputs.some(to => reaches(to, match, seen));
}

// Each melody note has its own panner. Find its fundamental independently of the
// instrument's waveform or extra harmonic/breath sources.
function leadNotes(ctx) {
  return ctx.nodes.filter(n => n.kind === 'panner').map(panner => {
    const tones = ctx.nodes.filter(n => n.kind === 'oscillator' && reaches(n, to => to === panner));
    assert.ok(tones.length, 'each lead note has a pitched source');
    return tones.reduce((lowest, n) => n.frequency.value < lowest.frequency.value ? n : lowest);
  });
}

test('fanfare sustains a dry bass pulse under a merged chord, with wet lead and pad, and auto-releases its reverb chain', () => {
  const ctx = recordedContext();
  const voice = { instrument: 14, pitch: 24, decay: 6, timbreMod: 0, scale: 0, tempo: 3, groove: 0,
    notes: Array.from({ length: 8 }, () => ({ degree: 0, duration: 2 })) };
  const handle = audio.playFanfare(voice, ctx);
  try {
    const oscillators = ctx.nodes.filter(n => n.kind === 'oscillator');
    const bass = oscillators.filter(n => n.type === 'sine' && Math.abs(n.frequency.value - audio.noteFrequency(48)) < 1e-8);
    assert.equal(bass.length, 8, 'merged eight-beat chord still has eight bass pulses');
    assert.deepEqual(bass.map(n => n.started), Array.from({ length: 8 }, (_, i) => 0.05 + i * 0.5));
    for (let i = 0; i < bass.length - 1; i++) assert.ok(bass[i].stopped < bass[i + 1].started);
    const kicks = oscillators.filter(n => n.frequency.value === 150);
    for (const n of oscillators) {
      assert.equal(reaches(n, to => to.kind === 'room'), !bass.includes(n) && !kicks.includes(n));
    }
    const buffers = ctx.nodes.filter(n => n.kind === 'buffer');
    assert.ok(buffers.length > 0, 'dry percussion is present');
    for (const n of buffers) assert.equal(reaches(n, to => to.kind === 'room'), false);

    // Verify natural completion schedules an audio-clock ConstantSource timer that disconnects the room convolver.
    const releaseTimers = ctx.nodes.filter(n => n.kind === 'constant');
    assert.equal(releaseTimers.length, 1);
    const room = ctx.nodes.find(n => n.kind === 'room');
    assert.equal(room.disconnected, false);
    releaseTimers[0].onended();
    assert.equal(room.disconnected, true, 'fanfare convolver disconnects once reverb tail finishes');
  } finally { handle.stop(); }
});

test('victory accents follow sounding endpoints, preserve modes and stop with playback', () => {
  for (let scale = 0; scale < 8; scale++) {
    for (const notes of [
      Array.from({ length: 8 }, () => ({ degree: 0, duration: 3 })),
      Array.from({ length: 8 }, (_, i) => ({ degree: 1, duration: i === 3 ? 0 : 3 })),
      [{ degree: 0, duration: 2 }, { degree: 1, duration: 0 }, { degree: 4, duration: 3 }],
      [{ degree: 0, duration: 0 }, { degree: 1, duration: 0 }],
      [{ degree: 0, duration: 3 }, { degree: 1, duration: 0 }, { degree: 4, duration: 0 }, { degree: 0, duration: 2 }]
    ]) {
      const ctx = recordedContext();
      const voice = { instrument: 14, pitch: 24, decay: 6, timbreMod: 0, scale, tempo: 7, groove: 2, notes };
      const handle = audio.playFanfare(voice, ctx);
      const brass = ctx.nodes.filter(n => n.kind === 'oscillator' && n.type === 'sawtooth');
      const lead = leadNotes(ctx);
      assert.equal(lead.length, notes.filter(n => n.duration !== 3).length);
      const beat = 60 / 168;
      if (!lead.length) assert.equal(brass.length, 0, 'all rests do not invent a victory melody');
      else {
        const first = lead[0].started, last = lead.at(-1).started;
        const opening = last - first >= beat * 0.5 && lead[1].started - first >= 0.08;
        assert.equal(brass.length, opening ? 7 : 4, 'deduplicate short/single-note accents and tight shuffle entries');
        const finalTones = audio.chordFor(audio.scalePitches(scale), audio.scaleDegreeSemitones(scale,
          notes.findLast(n => n.duration !== 3).degree)).tones;
        for (const n of brass) {
          assert.ok(n.started === first || n.started === last);
          const semitone = Math.round(12 * Math.log2(n.frequency.value / audio.noteFrequency(48)));
          const pitchClass = ((semitone % 12) + 12) % 12;
          assert.ok(audio.scalePitches(scale).includes(pitchClass));
          if (n.started === last) assert.ok(finalTones.includes(pitchClass), 'arrival follows final note, not forced tonic');
        }
        const kicks = ctx.nodes.filter(n => n.kind === 'oscillator' && n.type === 'sine' && n.frequency.value === 150);
        assert.deepEqual(kicks.map(n => n.started), [...new Set(brass.map(n => n.started))]);
      }
      handle.stop();
      for (const n of brass) assert.ok(n.stopped <= 0.015, 'stop cancels scheduled accents');
    }
  }
});

test('fanfare preserves lead pitches, rests and groove timing while pad voices move smoothly', () => {
  for (let groove = 0; groove < 4; groove++) {
    const ctx = recordedContext();
    const voice = { instrument: 14, pitch: 24, decay: 6, timbreMod: 0, scale: 0, tempo: 3, groove,
      notes: [{ degree: 0, duration: 2 }, { degree: 3, duration: 2 }, { degree: 6, duration: 2 },
        { degree: 0, duration: 3 }, { degree: 2, duration: 0 }, { degree: 4, duration: 1 }] };
    const original = JSON.stringify(voice), handle = audio.playFanfare(voice, ctx);
    try {
      const triangles = ctx.nodes.filter(n => n.kind === 'oscillator' && n.type === 'triangle');
      const lead = leadNotes(ctx);
      const parsed = audio.parseVoiceInfo(voice);
      let at = 0.05, index = 0;
      parsed.notes.forEach((note, i) => {
        if (!note.isRest) {
          const swing = i % 2 ? (groove === 1 ? 0.06 : groove === 2 ? 0.11 : 0) : 0;
          assert.ok(Math.abs(lead[index].started - at - swing) < 1e-9);
          assert.ok(Math.abs(lead[index++].frequency.value - note.freq) < 1e-8);
        }
        at += note.beats * 0.5;
      });
      assert.equal(lead.length, index);
      assert.equal(JSON.stringify(voice), original);
      const pad = triangles.filter(n => n.detune.value === -6);
      const semitones = pad.map(n => Math.round(12 * Math.log2(n.frequency.value / audio.noteFrequency(48))));
      // C -> F retains C; F -> G moves each voice just two semitones.
      assert.deepEqual(semitones.slice(0, 9), [0, 4, 7, 0, 5, 9, 2, 7, 11]);
    } finally { handle.stop(); }
  }
});

test('victory accompaniment releases before the next loop and follows each variation', t => {
  let queued;
  t.mock.method(global, 'setTimeout', callback => { queued = callback; return callback; });
  t.mock.method(global, 'clearTimeout', () => {});
  const ctx = recordedContext();
  const voice = { instrument: 14, pitch: 24, decay: 6, timbreMod: 0, scale: 1, tempo: 7, groove: 2,
    notes: Array.from({ length: 8 }, (_, i) => ({ degree: i, duration: i === 7 ? 3 : 0 })) };
  const parsed = audio.parseVoiceInfo(voice);
  const beats = parsed.notes.reduce((sum, n) => sum + n.beats, 0);
  const period = Math.ceil((beats + 4 * beats / 8) / 2) * 2 * 60 / parsed.tempoBpm;
  const handle = audio.playFanfare(voice, ctx, null, { loop: true });
  try {
    for (let repeat = 0; repeat < 4; repeat++) {
      if (repeat) { ctx.currentTime = repeat * period; queued(); }
      const from = 0.05 + repeat * period, next = from + period;
      const brass = ctx.nodes.filter(n => n.kind === 'oscillator' && n.type === 'sawtooth' && n.started >= from - 1e-9);
      assert.ok(brass.length > 0);
      for (const n of brass) {
        assert.ok(n.started < next);
        assert.ok(n.stopped < next, 'brass release fits in the existing loop period');
        const semi = Math.round(12 * Math.log2(n.frequency.value / audio.noteFrequency(48)));
        assert.ok(audio.scalePitches(1).includes(((semi % 12) + 12) % 12));
      }
    }
  } finally { handle.stop(); }
});

test('audio: constants and definitions', () => {
  assert.equal(audio.INSTRUMENTS.length, 16);
  assert.equal(new Set(audio.INSTRUMENTS).size, 16);
  assert.equal(audio.SCALES.length, 8);
  for (const s of audio.SCALES) {
    assert.equal(typeof s.name, 'string');
    assert.equal(s.degrees.length, 8);
    assert.equal(s.degrees[0], 0); // Root is 0
  }
  assert.equal(audio.TEMPOS.length, 8);
  assert.deepEqual(audio.TEMPOS, [84, 96, 108, 120, 132, 144, 156, 168]);
  assert.equal(audio.GROOVES.length, 4);
});

test('audio: pitch and frequency calculations', () => {
  assert.equal(audio.midiNote(0), 36);
  assert.equal(audio.midiNote(24), 60);
  assert.equal(audio.midiNote(33), 69);
  assert.equal(audio.midiNote(63), 99);

  // A4 = 440 Hz
  assert.ok(Math.abs(audio.noteFrequency(69) - 440) < 1e-6);
  // A3 = 220 Hz
  assert.ok(Math.abs(audio.noteFrequency(57) - 220) < 1e-6);
  // C4 = 261.625565... Hz
  assert.ok(Math.abs(audio.noteFrequency(60) - 261.625565) < 0.01);

  assert.equal(audio.noteName(60), 'C4');
  assert.equal(audio.noteName(69), 'A4');
  assert.equal(audio.noteName(36), 'C2');
  assert.equal(audio.noteName(99), 'D#7');
});

test('audio: decay calculation', () => {
  assert.equal(audio.decaySeconds(0), 0.12);
  assert.equal(audio.decaySeconds(15), 0.12 + 15 * 0.06);
  assert.ok(audio.decaySeconds(5) > audio.decaySeconds(4));
});

test('audio: parseVoiceInfo parses decoded voice correctly and tolerates nullish voice', () => {
  assert.equal(audio.parseVoiceInfo(null).instrument, 'Soft Bell');
  const sampleVoice = {
    instrument: 3, // Crystal Chime
    pitch: 24,      // C4 (midi 60)
    decay: 6,
    timbreMod: 1,
    scale: 2,       // Major Pentatonic
    tempo: 3,       // 120 BPM
    groove: 1,      // Light Swing
    notes: [
      { degree: 0, duration: 0 }, // Root 16th
      { degree: 2, duration: 1 }, // 3rd degree 8th
      { degree: 4, duration: 2 }, // 5th degree quarter
      { degree: 0, duration: 3 }, // Rest
      { degree: 5, duration: 1 },
      { degree: 6, duration: 0 },
      { degree: 7, duration: 2 },
      { degree: 3, duration: 1 }
    ]
  };

  const parsed = audio.parseVoiceInfo(sampleVoice);
  assert.equal(parsed.instrument, 'Crystal Chime');
  assert.equal(parsed.instrumentIndex, 3);
  assert.equal(parsed.rootMidi, 60);
  assert.equal(parsed.rootName, 'C4');
  assert.equal(parsed.scale, 'Major Pentatonic');
  assert.equal(parsed.tempoBpm, 120);
  assert.equal(parsed.groove, 'Light Swing');
  assert.equal(parsed.notes.length, 8);

  // Note 0: degree 0 in Pentatonic is +0 semitones -> C4
  assert.equal(parsed.notes[0].isRest, false);
  assert.equal(parsed.notes[0].name, 'C4');
  assert.equal(parsed.notes[0].beats, 0.25);

  // Note 1: degree 2 in Pentatonic [0, 2, 4, 7, 9, 12, 14, 16] is +4 semitones -> E4
  assert.equal(parsed.notes[1].isRest, false);
  assert.equal(parsed.notes[1].name, 'E4');
  assert.equal(parsed.notes[1].beats, 0.5);

  // Note 3: duration 3 is Rest
  assert.equal(parsed.notes[3].isRest, true);
  assert.equal(parsed.notes[3].name, 'Rest');
});

test('audio: all 16 instruments synthesize all 4 timbreMod states with valid Web Audio ramps', () => {
  for (let inst = 0; inst < 16; inst++) {
    const signatures = new Set();
    for (let mod = 0; mod < 4; mod++) {
      const ctx = recordedContext({ currentTime: 1.0, sampleRate: 8000 });
      const v = {
        instrument: inst,
        pitch: 20 + inst,
        decay: 5,
        timbreMod: mod,
        scale: inst % 8,
        tempo: 3,
        groove: 0,
        notes: [{ degree: 0, duration: 1 }]
      };
      const handle = audio.playVoice(v, ctx);
      assert.equal(typeof handle.stop, 'function');
      const snap = JSON.stringify(ctx.nodes.map(n => [n.kind, n.gain.value, n.frequency.value, n.detune.value, n.Q.value]));
      signatures.add(snap);
      handle.stop();
    }
    assert.equal(signatures.size, 4, `instrument ${inst} (${audio.INSTRUMENTS[inst]}) differentiates all 4 timbreMod values`);
  }

  const mockCtx = recordedContext({ currentTime: 1.0, sampleRate: 8000 });
  const testVoice = {
    instrument: 2,
    pitch: 25,
    decay: 6,
    timbreMod: 3,
    scale: 0,
    tempo: 4,
    groove: 1,
    notes: Array.from({ length: 8 }, (_, i) => ({ degree: i, duration: i % 4 }))
  };

  let noteCallbackCount = 0;
  const fanfareHandle = audio.playFanfare(testVoice, mockCtx, () => { noteCallbackCount++; });
  assert.equal(typeof fanfareHandle.stop, 'function');
  assert.equal(mockCtx.nodes.filter(n => n.kind === 'room').length, 1);
  fanfareHandle.stop();
  assert.equal(noteCallbackCount, 1, 'stopping fanfare reports completion once');

  // Looping queues repeats on the audio clock and stops cleanly; offline contexts never start runaway timers.
  const loopHandle = audio.playFanfare(testVoice, mockCtx, null, { loop: true });
  assert.equal(typeof loopHandle.stop, 'function');
  loopHandle.stop();

  const offlineCtx = recordedContext({ constructor: { name: 'OfflineAudioContext' } });
  const offlineLoop = audio.playFanfare(testVoice, offlineCtx, null, { loop: true });
  offlineLoop.stop();

  // Test playGameStart releases its master chain automatically via ConstantSource timer
  const startCtx = recordedContext({ currentTime: 0.5 });
  const startHandle = audio.playGameStart({ ctx: startCtx, volume: 0.9 });
  assert.ok(startCtx.nodes.some(n => n.kind === 'constant'), 'playGameStart schedules master chain auto-disconnect');
  startHandle.stop();

  const collisionHandle = audio.playCollision(testVoice, { ctx: mockCtx, volume: 0.5 });
  collisionHandle.stop();

  audio.playBallHit({ ctx: mockCtx, volume: 0.8 });
  audio.playWallHit({ ctx: mockCtx, volume: 0.6 });
  audio.playGoalHit('post', { ctx: mockCtx, volume: 0.9 });
  audio.playGoalHit('net', { ctx: mockCtx, volume: 0.7 });
});

test('pack, unwrap, coin, sizzle, foul, and iron-save cues obey Web Audio ramp rules and preserve shared chains', () => {
  // All pack & unwrap styles (including sub-3ms crackles) maintain strictly chronological ramps
  for (const kind of ['deal', 'pick', 'crack']) {
    const ctx = recordedContext();
    audio.playPack(kind, { ctx, stage: 3 });
    assert.ok(ctx.nodes.some(n => n.kind === 'constant'), `playPack(${kind}) schedules chain release`);
  }
  for (const kind of ['flick', 'land']) {
    const ctx = recordedContext();
    audio.playCoin(kind, { ctx });
    assert.ok(ctx.nodes.some(n => n.kind === 'oscillator'));
  }

  for (const wrap of ['plastic', 'foil', 'blob', 'gumball', 'egg', 'gift', 'cookie', 'envelope']) {
    const ctx = recordedContext();
    audio.playUnwrap(wrap, 1.2, { ctx });
    assert.ok(ctx.nodes.some(n => n.kind === 'constant'), `playUnwrap(${wrap}) releases private master chain`);
  }
  // Reduced-motion / invalid unwrap durations no-op cleanly without NaN or 0-duration ramps
  const zeroUnwrap = recordedContext();
  audio.playUnwrap('gift', 0, { ctx: zeroUnwrap });
  audio.playUnwrap('plastic', undefined, { ctx: zeroUnwrap });
  assert.equal(zeroUnwrap.nodes.length, 1, 'zero/undefined unwrap duration skips scheduling');

  // Shared master chain lowpass cutoff (7500 Hz) is not mutated by playUnwrap
  const shared = recordedContext();
  audio.shareMasterChain(shared);
  const sharedFilter = shared.nodes.find(n => n.kind === 'filter');
  assert.equal(sharedFilter.frequency.value, 7500);
  audio.playUnwrap('foil', 1.0, { ctx: shared });
  assert.equal(sharedFilter.frequency.value, 7500, 'shared master chain filter cutoff preserved');

  // Zero-volume guards on playFoul, playIronSave, and playSizzle never schedule 0-target exponential ramps
  const validCtx = recordedContext();
  audio.playFoul('warning', { ctx: validCtx, volume: 0.8 });
  audio.playFoul('card', { ctx: validCtx, volume: 0.8 });
  audio.playIronSave({ ctx: validCtx, volume: 0.9 });
  assert.doesNotThrow(() => audio.playFoul('warning', { ctx: validCtx, volume: 0 }));
  assert.doesNotThrow(() => audio.playFoul('card', { ctx: validCtx, volume: 0 }));
  assert.doesNotThrow(() => audio.playIronSave({ ctx: validCtx, volume: 0 }));
  assert.doesNotThrow(() => audio.playSizzle({ ctx: validCtx, volume: 0 }).stop());

  // Offline sizzle cancels future pre-scheduled crackles when stopped early
  const offlineSizzleCtx = recordedContext({ constructor: { name: 'OfflineAudioContext' } });
  const sizzle = audio.playSizzle({ ctx: offlineSizzleCtx, duration: 4, volume: 0.8 });
  offlineSizzleCtx.currentTime = 0.2;
  sizzle.stop();
  const futureCrackles = offlineSizzleCtx.nodes.filter(n => n.kind === 'buffer' && n.started > 0.36);
  assert.ok(futureCrackles.length > 0);
  assert.ok(futureCrackles.every(n => n.stopped === n.started), 'early offline sizzle stop cancels future crackle grains');
});

test('Super synthesis bounds playback, cleans nodes, and throttles Magnet', () => {
  const nodes = [], oscillators = [];
  class Param {
    setValueAtTime(value, time) { assert.ok(Number.isFinite(value) && Number.isFinite(time)); }
    linearRampToValueAtTime(value, time) { this.setValueAtTime(value, time); }
    exponentialRampToValueAtTime(value, time) { assert.ok(value > 0); this.setValueAtTime(value, time); }
    cancelScheduledValues() {}
  }
  function node() {
    const n = { connect() {}, disconnect() { this.disconnected = true; }, start() {},
      stop(time) { assert.ok(Number.isFinite(time)); this.end = time; } };
    for (const key of ['gain','frequency','detune','Q','threshold','knee','ratio','attack','release']) n[key] = new Param();
    nodes.push(n); return n;
  }
  const ctx = { currentTime: 1, destination: {}, sampleRate: 8000, createGain: node, createBiquadFilter: node,
    createDynamicsCompressor: node, createOscillator() { const n = node(); oscillators.push(n); return n; },
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource() { const n = node(); oscillators.push(n); return n; } };
  for (const [key, phase] of [['stalwart','launch'],['stalwart','impact'],['knockout','impact'],['sticky','impact'],
    ['cannonball','impact'],['magnet','pull'],['colossus','launch'],['shockwave','impact'],['ghost','launch']]) {
    const start = nodes.length, oscStart = oscillators.length;
    audio.playSuper(key, phase, { ctx });
    assert.ok(oscillators.length > oscStart, key);
    for (const osc of oscillators.slice(oscStart)) {
      assert.ok(osc.end > ctx.currentTime && osc.end <= ctx.currentTime + 1);
      osc.onended();
    }
    assert.ok(nodes.slice(start).every(n => n.disconnected), key + ' cleans its graph');
  }
  let count = nodes.length;
  audio.playSuper('magnet', 'pull', { ctx });
  audio.playSuper('unknown', 'impact', { ctx });
  audio.playSuper('ghost', 'impact', { ctx });
  audio.playSuper('shockwave', 'impact', { ctx, volume: 0 });
  assert.equal(nodes.length, count);
  ctx.currentTime += .181;
  audio.playSuper('magnet', undefined, { ctx });
  assert.ok(nodes.length > count);
  audio.stop();
  assert.ok(oscillators.at(-1).end <= ctx.currentTime + .021);
  audio.stop();
});

test('fanfare chords follow the melody and loops vary deterministically from the DNA', () => {
  const major = audio.scalePitches(0);
  assert.deepEqual(major, [0, 2, 4, 5, 7, 9, 11]);
  assert.equal(audio.scalePitches(2).length, 5); // pentatonic
  assert.deepEqual(audio.chordFor(major, 0).tones, [0, 4, 7]); // root note: home chord
  assert.deepEqual(audio.chordFor(major, 4).tones, [0, 4, 7]); // E sits in the home chord
  assert.deepEqual(audio.chordFor(major, 5).tones, [5, 9, 0]); // F: the IV chord
  assert.deepEqual(audio.chordFor(major, 11).tones, [7, 11, 2]); // B: the V chord
  for (let scale = 0; scale < 8; scale++) {
    const pitches = audio.scalePitches(scale);
    for (const pc of pitches) assert.ok(audio.chordFor(pitches, pc).tones.includes(pc)); // melody note is always in its chord
  }
  const voice = { instrument: 5, pitch: 28, decay: 4, timbreMod: 1, scale: 1, tempo: 4, groove: 0,
    notes: Array.from({ length: 8 }, (_, i) => ({ degree: (i * 5) % 8, duration: i % 4 })) };
  const cycle = audio.loopVariations(voice);
  assert.equal(cycle.length, 4); assert.equal(cycle[0], null); assert.equal(cycle[2], null);
  assert.ok(cycle[1] && cycle[3] && cycle[1] !== cycle[3]);
  assert.deepEqual(audio.loopVariations({ ...voice }), cycle); // same DNA, same song
  const pitches = audio.scalePitches(voice.scale), info = audio.parseVoiceInfo(voice);
  const notes = info.notes.map(n => ({ ...n, semi: n.isRest ? null : n.midi - info.rootMidi }));
  for (const variation of [cycle[1], cycle[3]]) {
    const varied = variation(notes, pitches);
    assert.deepEqual(varied.map(n => n.beats).sort(), notes.map(n => n.beats).sort()); // same rhythm values
    for (const n of varied) if (!n.isRest) assert.ok(pitches.includes(((n.semi % 12) + 12) % 12)); // stays in key
  }
});

test('short sounds let their chain go once rung out, and a shared chain replaces one per sound', () => {
  const ctx = recordedContext(), voice = { instrument: 0, pitch: 30, decay: 4, timbreMod: 0 };
  audio.playCollision(voice, { ctx });
  const timer = ctx.nodes.find(n => n.kind === 'constant');
  assert.ok(timer && typeof timer.onended === 'function' && timer.stopped > ctx.currentTime);
  const latest = Math.max(...ctx.nodes.filter(n => n.kind === 'oscillator').map(n => n.stopped));
  assert.ok(timer.stopped >= latest, 'the chain outlasts the sound');
  const shared = recordedContext();
  audio.shareMasterChain(shared);
  const before = shared.nodes.filter(n => n.kind === 'compressor').length;
  for (let i = 0; i < 5; i++) { audio.playCollision(voice, { ctx: shared }); audio.playBallHit({ ctx: shared }); audio.playWallHit({ ctx: shared }); }
  assert.equal(before, 1);
  assert.equal(shared.nodes.filter(n => n.kind === 'compressor').length, 1);
  assert.ok(!shared.nodes.some(n => n.kind === 'constant'));
});

test('getAudioContext returns null in environments without user gesture and handles silent no-op playback', () => {
  assert.equal(audio.getAudioContext(), null);

  const voice = { instrument: 0, pitch: 30, decay: 4, timbreMod: 0 };
  const h1 = audio.playCollision(voice);
  assert.equal(typeof h1?.stop, 'function');
  assert.doesNotThrow(() => h1.stop());

  assert.doesNotThrow(() => audio.playBallHit());
  assert.doesNotThrow(() => audio.playWallHit());
  assert.doesNotThrow(() => audio.playGoalHit());

  const h5 = audio.playSuper('shockwave', 'impact');
  assert.equal(typeof h5?.stop, 'function');
  assert.doesNotThrow(() => h5.stop());
});

test('quirk audio cues (Snap crack, spin-inflected post ring, corner carve, slipstream) synthesize cleanly and share master chain', () => {
  assert.doesNotThrow(() => audio.playBallHit({ snap: true }));
  assert.doesNotThrow(() => audio.playGoalHit('post', { spin: 20, speed: 650 }));
  assert.doesNotThrow(() => audio.playCarve({ volume: 0.6 }));
  assert.doesNotThrow(() => audio.playSlipstream({ volume: 0.5 }));

  const plainCtx = recordedContext(), snapCtx = recordedContext();
  audio.playBallHit({ ctx: plainCtx, volume: 0.8 });
  audio.playBallHit({ ctx: snapCtx, volume: 0.8, snap: true });
  assert.ok(snapCtx.nodes.filter(n => n.kind === 'oscillator').length > plainCtx.nodes.filter(n => n.kind === 'oscillator').length);
  assert.ok(snapCtx.nodes.some(n => n.kind === 'buffer'), 'Snap layers crisp noise transient');

  const flatPostCtx = recordedContext(), spinPostCtx = recordedContext();
  audio.playGoalHit('post', { ctx: flatPostCtx, spin: 0, speed: 300 });
  audio.playGoalHit('post', { ctx: spinPostCtx, spin: 24, speed: 720 });
  const flatOsc = flatPostCtx.nodes.filter(n => n.kind === 'oscillator');
  const spinOsc = spinPostCtx.nodes.filter(n => n.kind === 'oscillator');
  assert.ok(spinOsc[0].frequency.value > flatOsc[0].frequency.value, 'high-spin post hit lifts carrier frequency');
  assert.ok(spinOsc[0].stopped > flatOsc[0].stopped, 'high-spin post hit extends ring decay');
  assert.ok(spinOsc[0].stopped <= 0.43, 'post ring stays compact');

  const shared = recordedContext();
  audio.shareMasterChain(shared);
  audio.playCarve({ ctx: shared, volume: 0.7 });
  audio.playSlipstream({ ctx: shared, volume: 0.6 });
  audio.playBallHit({ ctx: shared, snap: true });
  audio.playGoalHit('post', { ctx: shared, spin: 18, speed: 500 });
  assert.equal(shared.nodes.filter(n => n.kind === 'compressor').length, 1, 'all quirk sounds share single export compressor');
});

test('movement wobble, spin wobble, puck slide, spin strike, fire impact, save shing, and firework pop synthesize cleanly', () => {
  assert.doesNotThrow(() => audio.playUbuMove({ speed: 450, mass: 3, radius: 25 }));
  assert.doesNotThrow(() => audio.playSpin({ omega: 14, radius: 25 }));
  assert.doesNotThrow(() => audio.playPuckSlide({ speed: 500 }));
  assert.doesNotThrow(() => audio.playSpinStrike({ spin: 16 }));
  assert.doesNotThrow(() => audio.playFireImpact({ volume: 0.8 }));
  assert.doesNotThrow(() => audio.playSave({ own: false }));
  assert.doesNotThrow(() => audio.playFirework({ ring: true, pan: -0.3 }));
  assert.doesNotThrow(() => audio.stopMotion());

  const slowCtx = recordedContext(), fastCtx = recordedContext();
  const smallCtx = recordedContext(), giantCtx = recordedContext();
  const lightCtx = recordedContext(), heavyCtx = recordedContext();

  audio.playUbuMove({ ctx: slowCtx, id: 0, speed: 120, mass: 3, radius: 25 });
  audio.playUbuMove({ ctx: fastCtx, id: 0, speed: 650, mass: 3, radius: 25 });
  const slowCarrier = slowCtx.nodes.find(n => n.kind === 'oscillator' && n.type === 'triangle');
  const fastCarrier = fastCtx.nodes.find(n => n.kind === 'oscillator' && n.type === 'triangle');
  const initialFastFreq = fastCarrier.frequency.value;
  assert.ok(fastCarrier.frequency.value > slowCarrier.frequency.value, 'faster speed increases wobble carrier pitch');

  audio.playUbuMove({ ctx: smallCtx, id: 0, speed: 400, mass: 3, radius: 17 });
  audio.playUbuMove({ ctx: giantCtx, id: 0, speed: 400, mass: 3, radius: 42 });
  const smallCarrier = smallCtx.nodes.find(n => n.kind === 'oscillator' && n.type === 'triangle');
  const giantCarrier = giantCtx.nodes.find(n => n.kind === 'oscillator' && n.type === 'triangle');
  assert.ok(smallCarrier.frequency.value > giantCarrier.frequency.value, 'larger ubu radius lowers resonant pitch');

  audio.playUbuMove({ ctx: lightCtx, id: 0, speed: 400, mass: 2.4, radius: 25 });
  audio.playUbuMove({ ctx: heavyCtx, id: 0, speed: 400, mass: 5.4, radius: 25 });
  const lightFilter = lightCtx.nodes.filter(n => n.kind === 'filter' && n.type === 'lowpass').at(-1);
  const heavyFilter = heavyCtx.nodes.filter(n => n.kind === 'filter' && n.type === 'lowpass').at(-1);
  assert.ok(heavyFilter.Q.value > lightFilter.Q.value, 'heavier mass increases resonant low-mid body');

  // Updating an existing continuous loop at 60fps interpolates smoothly instead of jumping discontinuously
  const countBeforeUpdate = fastCtx.nodes.filter(n => n.kind === 'oscillator').length;
  fastCtx.currentTime = 0.016;
  audio.playUbuMove({ ctx: fastCtx, id: 0, speed: 300, mass: 3, radius: 25 });
  fastCtx.currentTime = 0.032;
  audio.playUbuMove({ ctx: fastCtx, id: 0, speed: 200, mass: 3, radius: 25 });
  assert.ok(fastCarrier.frequency.value < initialFastFreq && fastCarrier.frequency.value > slowCarrier.frequency.value, '60fps loop update interpolates frequency');
  assert.equal(fastCtx.nodes.filter(n => n.kind === 'oscillator').length, countBeforeUpdate, 'continuous loop reuses oscillators');
  fastCtx.currentTime = 0.1;
  audio.playUbuMove({ ctx: fastCtx, id: 0, speed: 0, mass: 3, radius: 25 });
  assert.ok(fastCarrier.stopped <= 0.135, 'dropping below threshold stops continuous loop');

  const spinCtx = recordedContext();
  audio.playSpin({ ctx: spinCtx, id: 0, omega: 15, radius: 25 });
  const spinSines = spinCtx.nodes.filter(n => n.kind === 'oscillator');
  assert.ok(spinSines.length >= 3, 'spin wobble uses dual harmonic oscillators + LFO');
  assert.ok(spinSines[0].frequency.value > initialFastFreq, 'spin wobble stands out in higher register');
  audio.stopMotion();
  assert.ok(spinSines[0].stopped !== undefined, 'stopMotion stops active spin loop');

  const whipCtx = recordedContext();
  audio.playSpinStrike({ ctx: whipCtx, spin: 18, volume: 0.9 });
  const whipOscs = whipCtx.nodes.filter(n => n.kind === 'oscillator');
  const whipBufs = whipCtx.nodes.filter(n => n.kind === 'buffer');
  assert.ok(whipBufs.length >= 4, 'whipcrack layers whoosh, N-wave crack, highpass tip snap, and arena tail');
  for (const osc of whipOscs) {
    assert.ok(osc.stopped - osc.started <= 0.02, 'any whip transient oscillator is <20 ms percussive snap');
  }

  const shared = recordedContext();
  audio.shareMasterChain(shared);
  audio.playUbuMove({ ctx: shared, speed: 480, mass: 3, radius: 25 });
  audio.playSpin({ ctx: shared, omega: 14, radius: 25 });
  audio.playPuckSlide({ ctx: shared, speed: 550, spin: 12 });
  audio.playSpinStrike({ ctx: shared, spin: 18, volume: 0.9 });
  audio.playFireImpact({ ctx: shared, volume: 0.85 });
  audio.playSave({ ctx: shared, own: false });
  audio.playSave({ ctx: shared, own: true });
  audio.playFirework({ ctx: shared, ring: true, pan: 0.4 });
  assert.equal(shared.nodes.filter(n => n.kind === 'compressor').length, 1, 'all new sounds share export master chain');
});

test('sound and music volume buses, mono/stereo toggle, and true left-right spatial audio', () => {
  // 1. Bus setup & volume control
  const ctx = recordedContext();
  const buses = audio.setupAudioBuses(ctx);
  assert.ok(buses.masterGain && buses.sfxGain && buses.musicGain, 'setupAudioBuses creates master, sfx, and music gains');
  assert.ok(buses.sfxGain.outputs.includes(buses.masterGain), 'sfxGain connects to masterGain');
  assert.ok(buses.musicGain.outputs.includes(buses.masterGain), 'musicGain connects to masterGain');
  assert.ok(buses.masterGain.outputs.includes(ctx.destination), 'masterGain connects to destination');

  audio.setSoundVolume(0.65);
  assert.equal(audio.getSoundVolume(), 0.65);
  assert.equal(buses.sfxGain.gain.value, 0.65);

  audio.setMusicVolume(0.45);
  assert.equal(audio.getMusicVolume(), 0.45);
  assert.equal(buses.musicGain.gain.value, 0.45);

  // 2. Mono / Stereo toggle
  audio.setAudioMode('stereo');
  assert.equal(audio.isStereo(), true);
  assert.equal(audio.getAudioMode(), 'stereo');
  assert.equal(buses.masterGain.channelCount, 2);

  audio.setAudioMode('mono');
  assert.equal(audio.isStereo(), false);
  assert.equal(audio.getAudioMode(), 'mono');
  assert.equal(buses.masterGain.channelCount, 1);
  assert.equal(audio.panFromField(1000, 300), 0, 'mono clamps field pan to center');

  audio.setAudioMode('stereo');
  assert.equal(audio.isStereo(), true);

  // 3. Landscape vs Portrait spatial math (0.75 soft stereo limit)
  audio.setOrientation(false); // landscape
  assert.equal(audio.isPortrait(), false);
  assert.equal(Number(audio.panFromField(500, 300).toFixed(4)), 0);
  assert.equal(Number(audio.panFromField(0, 300).toFixed(4)), -0.75, 'landscape home goal x=0 pans full left (-0.75)');
  assert.equal(Number(audio.panFromField(1000, 300).toFixed(4)), 0.75, 'landscape away goal x=1000 pans full right (+0.75)');
  assert.equal(Number(audio.panFromField(-200, 300).toFixed(4)), -0.75, 'landscape clamp beyond left');
  assert.equal(Number(audio.panFromField(1200, 300).toFixed(4)), 0.75, 'landscape clamp beyond right');

  audio.setOrientation(true); // portrait (rink rotated 90° clockwise in screen space: top boards y=0 is left, bottom y=600 is right)
  assert.equal(audio.isPortrait(), true);
  assert.equal(Number(audio.panFromField(500, 300).toFixed(4)), 0);
  assert.equal(Number(audio.panFromField(500, 0).toFixed(4)), -0.75, 'portrait top boards y=0 pans screen left (-0.75)');
  assert.equal(Number(audio.panFromField(500, 600).toFixed(4)), 0.75, 'portrait bottom boards y=600 pans screen right (+0.75)');
  assert.equal(Number(audio.panFromField(500, -50).toFixed(4)), -0.75, 'portrait clamp beyond left');
  assert.equal(Number(audio.panFromField(500, 750).toFixed(4)), 0.75, 'portrait clamp beyond right');
  audio.setOrientation(false); // restore landscape

  // 4. SFX vs Music bus routing
  const busCtx = recordedContext();
  const testBuses = audio.setupAudioBuses(busCtx);

  // SFX sound routes to sfxGain
  audio.playWallHit({ ctx: busCtx, volume: 0.8, x: 1000, y: 300 });
  const wallPanner = busCtx.nodes.find(n => n.kind === 'panner');
  assert.ok(wallPanner, 'spatial sound creates stereo panner');
  assert.equal(Number(wallPanner.pan.value.toFixed(4)), 0.75, 'panner is panned right at x=1000');
  assert.ok(reaches(wallPanner, n => n === testBuses.sfxGain), 'wall hit routes to sfxGain');

  // Music sound routes to musicGain
  const musicCtx = recordedContext();
  const musicBuses = audio.setupAudioBuses(musicCtx);
  audio.playGameStart({ ctx: musicCtx, volume: 0.8 });
  const musicOsc = musicCtx.nodes.find(n => n.kind === 'oscillator');
  assert.ok(musicOsc, 'game start jingle creates oscillators');
  assert.ok(reaches(musicOsc, n => n === musicBuses.musicGain), 'game start jingle routes to musicGain');

  // 5. Continuous motion loop dynamic panning and mono downmixing
  const motionCtx = recordedContext();
  audio.playUbuMove({ ctx: motionCtx, id: 1, speed: 400, mass: 3, radius: 25, x: 100, y: 300 });
  const movePanner = motionCtx.nodes.find(n => n.kind === 'panner');
  assert.ok(movePanner, 'motion loop creates panner node');
  assert.equal(Number(movePanner.pan.value.toFixed(4)), -0.60, 'motion loop sets initial pan from field coordinate');

  // Updating loop dynamically updates pan
  motionCtx.currentTime = 0.016;
  audio.playUbuMove({ ctx: motionCtx, id: 1, speed: 400, mass: 3, radius: 25, x: 900, y: 300 });
  assert.equal(Number(movePanner.pan.value.toFixed(4)), 0.60, 'motion loop dynamically updates panner pan on frame update');

  // Switching audio mode to mono zeroes out active motion loop panner
  audio.setAudioMode('mono');
  assert.equal(movePanner.pan.value, 0, 'switching to mono zeroes active loop panners');
  audio.stopMotion(motionCtx);
  audio.setAudioMode('stereo');
  audio.setSoundVolume(0.8);
  audio.setMusicVolume(0.8);

  // 6. Puck slide is quiet, lowpass-filtered and smooth (not grainy/sandy)
  const puckCtx = recordedContext();
  audio.playPuckSlide({ ctx: puckCtx, speed: 500, spin: 8, x: 800, y: 300 });
  const puckFilters = puckCtx.nodes.filter(n => n.kind === 'filter').slice(1);
  assert.equal(puckFilters.length, 2, 'puck slide creates dual-filter glide layers');
  assert.ok(puckFilters.every(f => f.type === 'lowpass'), 'puck slide uses lowpass filters to prevent abrasive/sandy grit');
  for (const f of puckFilters) {
    assert.ok(f.frequency.value <= 1100, 'puck slide lowpass cutoffs stay below 1100 Hz');
  }
  const puckGains = puckCtx.nodes.filter(n => n.kind === 'gain' && n.outputs.some(out => out.kind === 'panner' || out.kind === 'filter' || out.kind === 'compressor'));
  for (const g of puckGains) {
    const peakEvent = g.gain.events.find(e => e[2] === 'linear');
    if (peakEvent) {
      assert.ok(peakEvent[0] <= 0.008, 'puck slide gain stays polite and quiet (< 0.008)');
    }
  }

  // 7. Explosive firework pops and big ring shell crackles
  const standardFwCtx = recordedContext();
  audio.playFirework({ ctx: standardFwCtx, ring: false, volume: 0.8 });
  const stdOscs = standardFwCtx.nodes.filter(n => n.kind === 'oscillator');
  const stdBuffers = standardFwCtx.nodes.filter(n => n.kind === 'buffer');
  assert.ok(stdOscs.some(o => o.type === 'triangle'), 'standard firework has concussive triangle sub-thump');
  assert.ok(stdBuffers.length >= 4, 'standard firework layers explosive blast, snap, rumble and sparkles');

  const bigFwCtx = recordedContext();
  audio.playFirework({ ctx: bigFwCtx, ring: true, volume: 0.8 });
  const bigOscs = bigFwCtx.nodes.filter(n => n.kind === 'oscillator');
  const bigBuffers = bigFwCtx.nodes.filter(n => n.kind === 'buffer');
  assert.ok(bigOscs.some(o => o.type === 'triangle'), 'big firework has heavier concussive sub-thump');
  assert.ok(bigBuffers.length >= 12, 'big firework generates rich cascading crackle volley (>= 12 crackle grains)');
  assert.ok(bigOscs.some(o => o.type === 'sine'), 'big firework crackle includes titanium star pings');
});
