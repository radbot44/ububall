'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const audio = require('./ubu-audio.js');

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
    }
    connect() {}
    disconnect() {}
    start() {}
    stop() {}
  }

  const mockCtx = {
    currentTime: 1.0,
    destination: new MockNode(),
    createGain() { return new MockNode(); },
    createOscillator() { return new MockNode(); },
    createBiquadFilter() { return new MockNode(); },
    createDynamicsCompressor() { return new MockNode(); }
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
  fanfareHandle.stop();

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
  const ctx = { currentTime: 1, destination: {}, createGain: node, createBiquadFilter: node,
    createDynamicsCompressor: node, createOscillator() { const n = node(); oscillators.push(n); return n; } };
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
