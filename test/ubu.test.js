'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const ubu = require('../shared/ubu.js');
const roles = ['background', 'eyes', 'irises', 'pupils', 'mouth'];
const textures = ['metallic', 'glossy', 'iridescent', 'crystalline', 'pearlescent', 'marble', 'velvet', 'frosted', 'terrazzo', 'crackle', 'holographic', 'woodgrain', 'plush', 'lacquered', 'damascus', 'opalescent', 'satin', 'leather', 'denim', 'carbon-fiber', 'hammered-metal', 'granite', 'sandstone', 'obsidian', 'liquid', 'bubbled', 'mosaic', 'circuitry', 'quartz', 'kintsugi', 'lava', 'starfield'];
function set(dna, start, width, value) {
  for (let i = 0; i < width; i++) {
    const bit = start + i, mask = 1 << (7 - (bit & 7));
    dna[bit >> 3] = (dna[bit >> 3] & ~mask) | (((value >> (width - i - 1)) & 1) ? mask : 0);
  }
}
function neutral() {
  const dna = new Uint8Array(128);
  for (const bit of [178, 188, 198, 208, 218, 228, 282, 302]) set(dna, bit, 10, 511);
  return dna;
}
function close(a, b) { assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`); }
test('neutral and endpoint mouth geometry retain their numeric ranges in the new fields', () => {
  const expected = [[61.4252, 151.915, 250.99], [26.50305, 53.0061, 79.50915],
    [167.995, 179.995, 191.995], [242.0531, 254.0531, 266.0531]];
  for (const [i, key] of ['width', 'height', 'x', 'y'].entries()) for (const [j, value] of [0, 511, 1023].entries()) {
    const dna = neutral(); set(dna, 178 + i * 10, 10, value);
    close(ubu.decode(dna).mouth[key], expected[i][j]);
  }
  for (let slot = 0; slot < 5; slot++) {
    const dna = neutral(); set(dna, 64 + slot * 18, 5, 31);
    const a = ubu.decode(dna).attributes[roles[slot]];
    assert.equal(a.color, 31); assert.equal(a.name, 'Onyx'); assert.equal(a.hex, '#101217');
  }
  assert.equal(ubu.curve(0), -1); assert.equal(ubu.curve(511), 0); assert.equal(ubu.curve(1023), 1);
});
test('packed uburithm matches independently captured benchmark vectors', () => {
  for (const {seed, ...expected} of require('./packed-name-vectors.json')) {
    assert.deepEqual(ubu.ubunym(BigInt('0x' + seed)), expected);
  }
});
test('exact text uses dual SHA-512, and encoding preserves every bit including unassigned bits', async () => {
  for (const text of ['', '007', '7', ' x ', 'x', 'é', 'e\u0301', '\ud800']) {
    const dna = await ubu.fromText(text);
    const h1 = createHash('sha512').update(new TextEncoder().encode(text)).digest();
    const h2 = createHash('sha512').update(new TextEncoder().encode(text + '\x01')).digest();
    assert.deepEqual(Buffer.from(dna), Buffer.concat([h1, h2]));
    assert.equal(ubu.toCode(dna).length, 171);
    assert.deepEqual(ubu.fromCode(ubu.toCode(dna)), dna);
    assert.deepEqual(ubu.fromCode(Buffer.from(dna).toString('hex')), dna);
  }
  const a = neutral(), b = new Uint8Array(a);
  for (let i = 662; i <= 1013; i++) set(b, i, 1, 1);
  assert.notEqual(ubu.toCode(a), ubu.toCode(b));
  const ma = ubu.decode(a), mb = ubu.decode(b);
  delete ma.dna; delete mb.dna;
  assert.deepEqual(ma, mb);
  assert.equal(ubu.randomDNA().length, 128);
  for (const bad of ['', 'A'.repeat(86), '0'.repeat(128), 'A'.repeat(170), 'A'.repeat(172), 'A'.repeat(170) + 'B']) assert.throws(() => ubu.fromCode(bad));
  for (const length of [0, 64, 127, 129]) assert.throws(() => ubu.decode(new Uint8Array(length)));
});
test('each slot has thirty-two mutually exclusive materials at 1/1024 each', () => {
  for (let slot = 0; slot < 5; slot++) {
    const counts = {};
    for (let flags = 0; flags < 1024; flags++) {
      const dna = neutral(); set(dna, 72 + slot * 18, 10, flags);
      const texture = ubu.decode(dna).attributes[roles[slot]].texture;
      counts[texture] = (counts[texture] || 0) + 1;
    }
    assert.equal(counts.null, 992);
    for (const texture of textures) assert.equal(counts[texture], 1);
    for (let angle = 0; angle < 8; angle++) {
      const dna = neutral(); set(dna, 69 + slot * 18, 3, angle);
      assert.equal(ubu.decode(dna).attributes[roles[slot]].angle, angle * 45);
    }
  }
});
test('all 1024 Ubuquity values use the last ten bits and exact approved boundaries', () => {
  const counts = {};
  for (let value = 0; value < 1024; value++) {
    const dna = neutral(); set(dna, 1014, 10, value);
    const m = ubu.decode(dna);
    const expected = value <= 299 ? 'C' : value <= 599 ? 'B' : value <= 749 ? 'A' : value <= 899 ? 'S' : value <= 999 ? 'S+' : value <= 1020 ? 'U' : 'UBU';
    assert.equal(m.rating, value); assert.equal(m.grade, expected);
    counts[m.grade] = (counts[m.grade] || 0) + 1;
  }
  assert.deepEqual(counts, { C: 300, B: 300, A: 150, S: 150, 'S+': 100, U: 21, UBU: 3 });
});
test('mouth and eyelids use pair precedence with independent four-bit individual rolls', () => {
  for (const [start, key] of [[154, 'mouth'], [258, 'eyelids']]) {
    for (let index = 0; index < 6; index++) {
      const dna = neutral(); set(dna, start + index * 4, 4, 15);
      const m = ubu.decode(dna), active = key === 'mouth' ? m.mouth.corners : m.eyelids.active;
      assert.deepEqual(active, [index === 0 || index === 2, index === 0 || index === 3, index === 1 || index === 4, index === 1 || index === 5]);
    }
    const dna = neutral(); set(dna, start, 4, 15); set(dna, start + 20, 4, 15);
    const m = ubu.decode(dna);
    assert.deepEqual(key === 'mouth' ? m.mouth.corners : m.eyelids.active, [true, true, false, false]);
  }
});
test('mouth curvature, cuts, notch curvature, and opening ratio follow their exact bit rolls', () => {
  for (let i = 0; i < 4; i++) for (let roll = 0; roll < 4; roll++) {
    const dna = neutral(); set(dna, 162 + i * 4, 4, 15); set(dna, 342 + i * 2, 2, roll);
    assert.equal(ubu.decode(dna).mouth.curved[i], roll === 3);
  }
  for (const a of [0, 62, 63]) for (const b of [0, 62, 63]) {
    const dna = neutral(); set(dna, 350, 6, a); set(dna, 356, 6, b);
    const m = ubu.decode(dna).mouth;
    assert.equal(m.lipNotch, a === 63);
    assert.equal(m.horizontalCut, b === 63);
    assert.ok(!/NaN|Infinity/.test(ubu.mouthPath(m)));
  }
  const openDna = neutral(); set(openDna, 350, 12, 4095);
  for (const value of [0, 511, 920, 921, 1023]) {
    set(openDna, 362, 10, value);
    const m = ubu.decode(openDna).mouth;
    assert.equal(m.openingRaw, value);
    close(m.openingRatio, 0.1 + value / 1023);
    assert.equal(m.openingRatio >= 1, value >= 921);
  }
  const inactive = neutral(), before = ubu.mouthPath(ubu.decode(inactive).mouth);
  set(inactive, 362, 10, 1023);
  assert.equal(ubu.mouthPath(ubu.decode(inactive).mouth), before);
  assert.equal(ubu.decode(inactive).rating, 0);

  const notchDna = neutral(); set(notchDna, 350, 6, 63);
  for (let roll = 0; roll < 4; roll++) {
    set(notchDna, 372, 2, roll);
    assert.equal(ubu.decode(notchDna).mouth.notchCurved, roll === 3);
  }
  set(notchDna, 350, 6, 0);
  assert.equal(ubu.decode(notchDna).mouth.notchCurved, false);
});
test('eyelid and displacement flips preserve neutral values and act on the left eye only', () => {
  const dna = neutral(); set(dna, 258, 8, 255);
  set(dna, 282, 10, 900); set(dna, 292, 10, 900); set(dna, 312, 10, 100);
  const before = ubu.decode(dna);
  set(dna, 322, 20, 1048575); set(dna, 238, 20, 1048575);
  const after = ubu.decode(dna);
  assert.deepEqual(after.eyes.right, before.eyes.right);
  assert.equal(after.eyes.left.lids[0].angle, -before.eyes.left.lids[0].angle);
  assert.equal(after.eyes.left.lids[0].depth, before.eyes.left.lids[1].depth);
  assert.equal(after.eyes.leftX, 0); assert.equal(after.eyes.leftY, 0);
  for (const bit of [238, 248, 322, 332]) {
    const d = neutral(); set(d, bit, 10, 1022);
    const m = ubu.decode(d); assert.ok(!m.eyes.flipX && !m.eyes.flipY && !m.eyelids.angleFlip && !m.eyelids.depthFlip);
  }
});
test('paired eyelid clips mirror across eyes unless the left-eye angle flip activates', () => {
  for (const raw of [0, 511, 900, 1023]) for (const mask of [0xf0, 0x0f, 0xff]) {
    const dna = neutral(); set(dna, 258, 8, mask);
    set(dna, 282, 10, raw); set(dna, 302, 10, 1023 - raw);
    set(dna, 292, 10, 600); set(dna, 312, 10, 800);
    const { left, right } = ubu.decode(dna).eyes;
    for (let i = 0; i < 2; i++) {
      assert.equal(left.lids[i].active, right.lids[i].active);
      close(left.lids[i].angle, -right.lids[i].angle);
      close(left.lids[i].depth, right.lids[i].depth);
    }
    assert.equal(left.planes.length, right.planes.length);
    for (let i = 0; i < left.planes.length; i++) {
      close(left.planes[i].nx, -right.planes[i].nx);
      close(left.planes[i].ny, right.planes[i].ny);
      close(left.planes[i].distance, right.planes[i].distance);
    }
    const leftPoints = ubu.eyePolygon(left), rightPoints = ubu.eyePolygon(right);
    assert.equal(leftPoints.length, rightPoints.length);
    for (const [x, y] of leftPoints) assert.ok(rightPoints.some(([rx, ry]) =>
      Math.abs(x + rx) < 1e-10 && Math.abs(y - ry) < 1e-10), 'mirrored clip polygon');
    set(dna, 322, 10, 1023);
    const flipped = ubu.decode(dna).eyes.left;
    for (let i = 0; i < 2; i++) close(flipped.lids[i].angle, right.lids[i].angle);
  }
});
test('entire iris and pupil stay inside circles and angled lids at extremes and random inputs', () => {
  const cases = [];
  for (const angle of [0, 511, 1023]) for (const depth of [0, 511, 1023]) for (const x of [0, 511, 1023]) for (const y of [0, 511, 1023]) {
    const dna = neutral(); set(dna, 258, 8, 255);
    for (const bit of [282, 302]) set(dna, bit, 10, angle);
    for (const bit of [292, 312]) set(dna, bit, 10, depth);
    set(dna, 218, 10, x); set(dna, 228, 10, y); cases.push(dna);
  }
  for (let i = 0; i < 1000; i++) cases.push(ubu.randomDNA());
  for (const dna of cases) for (const eye of [ubu.decode(dna).eyes.left, ubu.decode(dna).eyes.right]) {
    assert.ok(Math.hypot(eye.dx, eye.dy) + 30.7126 <= 66.05 + 1e-10);
    for (const [i, lid] of eye.lids.entries()) if (lid.active) {
      const a = lid.angle * Math.PI / 180, side = i ? 1 : -1;
      assert.ok(-side * Math.sin(a) * eye.dx + side * Math.cos(a) * eye.dy + 30.7126 <= 66.05 - lid.depth + 1e-10);
    }
  }
  const dna = neutral(); set(dna, 218, 10, 1023);
  close(ubu.decode(dna).eyes.dx, 35.3374);
  set(dna, 238, 10, 1023); close(ubu.decode(dna).eyes.leftX, -35.3374);
});

test('decodes all 15 core stats, supers, AI personality, voice, and fanfare correctly', () => {
  const statNames = [
    'impulse', 'traction', 'spin', 'curve',
    'size', 'mass', 'bounciness', 'grip',
    'power', 'reach', 'strength', 'stability',
    'efficiency', 'synergy', 'chemistry'
  ];
  const dna = neutral();
  statNames.forEach((name, i) => set(dna, 374 + i * 8, 8, (i * 17) % 256));
  [1, 5, 9, 14].forEach((val, i) => set(dna, 494 + i * 4, 4, val));
  set(dna, 510, 6, 45);
  set(dna, 516, 6, 12);
  set(dna, 522, 6, 60);
  set(dna, 528, 6, 33);
  set(dna, 534, 4, 7);
  set(dna, 538, 6, 42);
  set(dna, 544, 4, 11);
  set(dna, 548, 2, 2);
  set(dna, 550, 3, 5);
  set(dna, 553, 3, 4);
  for (let n = 0; n < 8; n++) set(dna, 556 + n * 5, 5, (n * 3) % 32);
  set(dna, 596, 2, 3);
  set(dna, 598, 3, 6);
  for (let n = 0; n < 8; n++) set(dna, 601 + n * 5, 5, (n * 7 + 5) % 32);
  set(dna, 641, 3, 5);
  set(dna, 644, 4, 13);
  set(dna, 648, 3, 4);
  set(dna, 651, 3, 2);
  set(dna, 654, 3, 7);
  set(dna, 657, 5, 31);

  const m = ubu.decode(dna);
  statNames.forEach((name, i) => assert.equal(m.stats[name], (i * 17) % 256));
  assert.deepEqual(m.supers, [1, 5, 9, 14]);
  assert.deepEqual(m.personality, { aggression: 45, creativity: 12, teamwork: 60, clutch: 33 });
  assert.equal(m.voice.instrument, 7);
  assert.equal(m.voice.pitch, 42);
  assert.equal(m.voice.decay, 11);
  assert.equal(m.voice.timbreMod, 2);
  assert.equal(m.voice.scale, 5);
  assert.equal(m.voice.tempo, 4);
  assert.equal(m.voice.notes.length, 8);
  for (let n = 0; n < 8; n++) {
    const raw = (n * 3) % 32;
    assert.deepEqual(m.voice.notes[n], { degree: raw >> 2, duration: raw & 3 });
  }
  assert.equal(m.voice.groove, 3);
  assert.equal(m.voice.phraseForm, 6);
  assert.equal(m.voice.answerNotes.length, 8);
  for (let n = 0; n < 8; n++) {
    const raw = (n * 7 + 5) % 32;
    assert.deepEqual(m.voice.answerNotes[n], { degree: raw >> 2, duration: raw & 3 });
  }
  assert.equal(m.voice.backingTexture, 5);
  assert.equal(m.voice.drumBass, 13);
  assert.equal(m.voice.harmonyProg, 4);
  assert.equal(m.voice.leadExpr, 2);
  assert.equal(m.voice.acousticStage, 7);
  assert.equal(m.voice.signatureGate, 31);

  // Appearance rarity and gameplay ability remain completely independent of bits 598-661
  const rarity = require('../shared/rarity.js');
  const ability = require('../shared/ability.js');
  const baseDna = neutral();
  const mutatedAnthem = new Uint8Array(baseDna);
  for (let bit = 598; bit <= 661; bit++) set(mutatedAnthem, bit, 1, 1);
  assert.deepEqual(rarity.scoreRarity(ubu.decode(baseDna)), rarity.scoreRarity(ubu.decode(mutatedAnthem)));
  assert.deepEqual(ability.scoreAbility(ubu.decode(baseDna)), ability.scoreAbility(ubu.decode(mutatedAnthem)));
});

test('statMultiplier maps 8-bit values across exponential multiplier curve', () => {
  assert.ok(Math.abs(ubu.statMultiplier(0) - 2 / 3) < 1e-12);
  assert.equal(ubu.statMultiplier(127), 1);
  assert.equal(ubu.statMultiplier(255), 1.5);
  const values = Array.from({ length: 256 }, (_, i) => ubu.statMultiplier(i));
  assert.ok(values.every((v, i) => !i || v >= values[i - 1]));
  assert.throws(() => ubu.statMultiplier(-1));
  assert.throws(() => ubu.statMultiplier(256));
  assert.throws(() => ubu.statMultiplier(1.5));
});

test('public helpers reject non-string seeds/codes and out-of-range ratings, curves and seeds', async () => {
  assert.ok(Object.isFrozen(ubu));
  for (const bad of [undefined, null, 0, 123, {}, ['abc'], new String('abc')]) {
    await assert.rejects(() => ubu.fromText(bad), TypeError);
    assert.throws(() => ubu.fromCode(bad), TypeError);
  }
  assert.throws(() => ubu.fromCode(new String('A'.repeat(171))), TypeError);
  for (const bad of [NaN, undefined, null, -1, 1024, 1.5, Infinity, -Infinity, '511']) {
    assert.throws(() => ubu.grade(bad), RangeError);
    assert.throws(() => ubu.curve(bad), RangeError);
  }
  for (const badSeed of [0, '0', -1n, 1n << 64n, null, undefined]) {
    assert.throws(() => ubu.ubunym(badSeed), RangeError);
  }
  assert.doesNotThrow(() => ubu.ubunym(0n));
  assert.doesNotThrow(() => ubu.ubunym(0xffffffffffffffffn));
});
