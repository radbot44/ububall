'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const audio = require('../shared/ubu-audio.js');

// Record the actual scheduled sources and graph, including reverb reachability.
function recordedContext() {
  const nodes = [];
  const param = () => ({ events: [], value: 0,
    setValueAtTime(value, time) { this.events.push([value, time]); this.value = value; },
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const node = kind => {
    const n = { kind, outputs: [], connect(to) { this.outputs.push(to); }, disconnect() {},
      start(time) { this.started = time; }, stop(time) { this.stopped = time; },
      setPeriodicWave(wave) { this.type = 'custom'; this.periodicWave = wave; } };
    for (const key of ['gain', 'frequency', 'detune', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release', 'pan', 'offset']) n[key] = param();
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
    }
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

test('fanfare sustains a dry bass pulse under a merged chord, with wet lead and pad', () => {
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

test('audio: parseVoiceInfo parses decoded voice correctly', () => {
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

test('audio: mock AudioContext synthesis and scheduling', () => {
  // Create a lightweight Web Audio mock to verify all 16 instruments synthesize without throwing
  class MockParam {
    constructor(val = 0) { this.value = val; }
    setValueAtTime() {}
    linearRampToValueAtTime() {}
    exponentialRampToValueAtTime() {}
    cancelScheduledValues() {}
  }

  class MockNode {
    constructor() {
      this.gain = new MockParam(1);
      this.frequency = new MockParam(440);
      this.detune = new MockParam(0);
      this.Q = new MockParam(1);
      this.threshold = new MockParam(-12);
      this.knee = new MockParam(30);
      this.ratio = new MockParam(8);
      this.attack = new MockParam(0.003);
      this.release = new MockParam(0.25);
      this.pan = new MockParam(0);
      this.offset = new MockParam(1);
    }
    connect() {}
    disconnect() {}
    start() {}
    stop() {}
    setPeriodicWave(wave) { this.type = 'custom'; this.periodicWave = wave; }
  }

  let convolvers = 0;
  const mockCtx = {
    currentTime: 1.0,
    sampleRate: 8000,
    destination: new MockNode(),
    createGain() { return new MockNode(); },
    createOscillator() { return new MockNode(); },
    createBiquadFilter() { return new MockNode(); },
    createDynamicsCompressor() { return new MockNode(); },
    createStereoPanner() { return new MockNode(); },
    createBufferSource() { return new MockNode(); },
    createConvolver() { convolvers++; return new MockNode(); },
    createConstantSource() { return new MockNode(); },
    createPeriodicWave(real, imag) {
      assert.equal(real.length, imag.length);
      assert.ok(real.length > 1);
      assert.ok([...real, ...imag].every(Number.isFinite));
      return { real: Float32Array.from(real), imag: Float32Array.from(imag) };
    },
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { sampleRate, getChannelData: channel => data[channel] };
    }
  };

  // Test playVoice for all 16 instruments
  for (let inst = 0; inst < 16; inst++) {
    const v = {
      instrument: inst,
      pitch: 20 + inst,
      decay: 5,
      timbreMod: inst % 4,
      scale: inst % 8,
      tempo: 3,
      groove: 0,
      notes: [{ degree: 0, duration: 1 }]
    };
    const handle = audio.playVoice(v, mockCtx);
    assert.equal(typeof handle.stop, 'function');
    handle.stop();
  }

  // Test playFanfare
  const testVoice = {
    instrument: 2,
    pitch: 25,
    decay: 6,
    timbreMod: 0,
    scale: 0,
    tempo: 4,
    groove: 1,
    notes: Array.from({ length: 8 }, (_, i) => ({ degree: i, duration: i % 4 }))
  };

  let noteCallbackCount = 0;
  const fanfareHandle = audio.playFanfare(testVoice, mockCtx, (idx, note) => {
    noteCallbackCount++;
  });
  assert.equal(typeof fanfareHandle.stop, 'function');
  assert.equal(convolvers, 1); // The fanfare plays through its room reverb.
  fanfareHandle.stop();

  // Looping queues repeats on the audio clock and stops cleanly.
  const loopHandle = audio.playFanfare(testVoice, mockCtx, null, { loop: true });
  assert.equal(typeof loopHandle.stop, 'function');
  loopHandle.stop();

  // Test playGameStart
  const startHandle = audio.playGameStart({ ctx: mockCtx, volume: 0.9 });
  assert.equal(typeof startHandle.stop, 'function');
  startHandle.stop();

  // Test playCollision with volume scaling
  const collisionHandle = audio.playCollision(testVoice, { ctx: mockCtx, volume: 0.5 });
  assert.equal(typeof collisionHandle.stop, 'function');
  collisionHandle.stop();

  // Test physical hit sounds
  audio.playBallHit({ ctx: mockCtx, volume: 0.8 });
  audio.playWallHit({ ctx: mockCtx, volume: 0.6 });
  audio.playGoalHit('post', { ctx: mockCtx, volume: 0.9 });
  audio.playGoalHit('net', { ctx: mockCtx, volume: 0.7 });
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
  const ctx = recordedContext(), voice = { instrument: 0, rootPitch: 30, decay: 4, timbreMod: 0 };
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

  const voice = { instrument: 0, rootPitch: 30, decay: 4, timbreMod: 0 };
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
  // Silent no-op when no AudioContext / user gesture is active
  assert.doesNotThrow(() => audio.playBallHit({ snap: true }));
  assert.doesNotThrow(() => audio.playGoalHit('post', { spin: 20, speed: 650 }));
  assert.doesNotThrow(() => audio.playCarve({ volume: 0.6 }));
  assert.doesNotThrow(() => audio.playSlipstream({ volume: 0.5 }));

  // Normal vs Snap ball hit: Snap layers harmonic crack oscillator + noise grain
  const plainCtx = recordedContext(), snapCtx = recordedContext();
  audio.playBallHit({ ctx: plainCtx, volume: 0.8 });
  audio.playBallHit({ ctx: snapCtx, volume: 0.8, snap: true });
  assert.ok(snapCtx.nodes.filter(n => n.kind === 'oscillator').length > plainCtx.nodes.filter(n => n.kind === 'oscillator').length);
  assert.ok(snapCtx.nodes.some(n => n.kind === 'buffer'), 'Snap layers crisp noise transient');

  // Spin-inflected post ring lifts pitch and extends ring decay up to 0.40s
  const flatPostCtx = recordedContext(), spinPostCtx = recordedContext();
  audio.playGoalHit('post', { ctx: flatPostCtx, spin: 0, speed: 300 });
  audio.playGoalHit('post', { ctx: spinPostCtx, spin: 24, speed: 720 });
  const flatOsc = flatPostCtx.nodes.filter(n => n.kind === 'oscillator');
  const spinOsc = spinPostCtx.nodes.filter(n => n.kind === 'oscillator');
  assert.ok(spinOsc[0].frequency.value > flatOsc[0].frequency.value, 'high-spin post hit lifts carrier frequency');
  assert.ok(spinOsc[0].stopped > flatOsc[0].stopped, 'high-spin post hit extends ring decay');
  assert.ok(spinOsc[0].stopped <= 0.43, 'post ring stays compact');

  // Corner carve (~85 ms) and Slipstream (~110 ms) route through shared master chain for MP4 export
  const shared = recordedContext();
  audio.shareMasterChain(shared);
  audio.playCarve({ ctx: shared, volume: 0.7 });
  audio.playSlipstream({ ctx: shared, volume: 0.6 });
  audio.playBallHit({ ctx: shared, snap: true });
  audio.playGoalHit('post', { ctx: shared, spin: 18, speed: 500 });
  assert.equal(shared.nodes.filter(n => n.kind === 'compressor').length, 1, 'all quirk sounds share single export compressor');
});
