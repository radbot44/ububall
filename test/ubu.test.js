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
  for (let i = 598; i <= 1013; i++) set(b, i, 1, 1);
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
test('corner curvature is one in four conditional on appearance; mouth cuts are independent one in 64', () => {
  for (let i = 0; i < 4; i++) for (let roll = 0; roll < 4; roll++) {
    const dna = neutral(); set(dna, 162 + i * 4, 4, 15); set(dna, 342 + i * 2, 2, roll);
    const m = ubu.decode(dna).mouth;
    assert.equal(m.curved[i], roll === 3);
    assert.equal(ubu.mouthPath(m).includes('Q'), roll === 3);
  }
  for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++) {
    const dna = neutral(); set(dna, 350, 6, a); set(dna, 356, 6, b);
    const m = ubu.decode(dna).mouth;
    assert.equal(m.lipNotch, a === 63); assert.equal(m.horizontalCut, b === 63);
    assert.ok(!/NaN|Infinity/.test(ubu.mouthPath(m)));
  }
  const dna = neutral(); set(dna, 350, 12, 4095);
  const m = ubu.decode(dna).mouth, path = ubu.mouthPath(m);
  assert.equal((path.match(/M/g) || []).length, 2); // Real hole, not a painted overlay.
  assert.ok(m.y - m.height / 2 + m.height / 4 < m.y - m.height / 8);
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

test('one centered lip notch and a 10–110% opening with a fully open range', () => {
  const dna = neutral(); set(dna, 350, 12, 4095);
  const m = ubu.decode(dna).mouth;
  const top = m.y - m.height / 2;
  const outer = ubu.mouthPath(m).split('Z')[0];
  // The top edge reaches its notch depth once, directly below the mouth center.
  const notch = `L${m.x} ${top + m.height / 4}`;
  assert.equal(outer.split(notch).length - 1, 1);
  for (let value = 0; value < 1024; value++) {
    set(dna, 362, 10, value);
    const mouth = ubu.decode(dna).mouth;
    assert.equal(mouth.openingRaw, value);
    close(mouth.openingRatio, .1 + value / 1023);
    const hole = ubu.mouthPath(mouth).split('Z')[1];
    const points = hole.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g).map(Number);
    const width = points[4] - points[0];
    close(width, mouth.width * Math.min(1, mouth.openingRatio));
    close(points[3] - points[1], mouth.height / 4);
    assert.equal(mouth.openingRatio >= 1, value >= 921);
  }
  const inactive = neutral(), before = ubu.mouthPath(ubu.decode(inactive).mouth);
  set(inactive, 362, 10, 1023);
  assert.equal(ubu.mouthPath(ubu.decode(inactive).mouth), before);
  assert.equal(ubu.decode(inactive).rating, 0);
});

test('notch sides are 45 degrees and its independent curvature roll is one in four', () => {
  for (const width of [0, 511, 1023]) for (const height of [0, 511, 1023]) {
    const dna = neutral(); set(dna, 178, 10, width); set(dna, 188, 10, height); set(dna, 350, 6, 63);
    const m = ubu.decode(dna).mouth, d = Math.min(m.height / 4, m.width / 6), top = m.y - m.height / 2;
    const path = ubu.mouthPath(m);
    assert.ok(path.includes(`L${m.x - d} ${top}L${m.x} ${top + d}L${m.x + d} ${top}`));
    assert.ok(m.x - d >= m.x - m.width / 6 - 1e-10);
    close((top + d - top) / (m.x - (m.x - d)), 1);
    for (let roll = 0; roll < 4; roll++) {
      set(dna, 372, 2, roll);
      const mouth = ubu.decode(dna).mouth;
      assert.equal(mouth.notchCurved, roll === 3);
      assert.equal(ubu.mouthPath(mouth).includes('Q'), roll === 3);
      if (roll === 3) assert.ok(ubu.mouthPath(mouth).includes(`Q${m.x} ${top + d} ${m.x + d} ${top}`));
    }
    set(dna, 350, 6, 0);
    assert.equal(ubu.decode(dna).mouth.notchCurved, false);
    assert.ok(!ubu.mouthPath(ubu.decode(dna).mouth).includes('Q'));
  }
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

test('packed names retain slots, spelling format and placement for all visible structures', () => {
  const seen = new Set();
  for (const {seed} of require('./packed-name-vectors.json')) {
    const name = ubu.ubunym(BigInt('0x' + seed));
    const {praenomen: p, nomen: n, cognomen: c, cognomenBeforeNomen: front} = name;
    assert.match(n, /^[A-Z][a-z]{5}$/);
    for (const word of [p,c]) if (word) assert.match(word, /^[A-Z][a-z]{1,5}$/);
    assert.equal(name.fullName, (front ? [p,c,n] : [p,n,c]).filter(Boolean).join(' '));
    assert.ok(!front || c);
    seen.add((p ? 'P' : '') + (front ? 'CN' : c ? 'NC' : 'N'));
  }
  assert.deepEqual([...seen].sort(), ['N','NC','CN','PN','PNC','PCN'].sort());
});

// Access private sampler boundaries without expanding the production API.
function packedInternals() {
  const fs = require('node:fs'), Module = require('node:module');
  const filename = require.resolve('../shared/ubu.js');
  const source = fs.readFileSync(filename, 'utf8').replace('const api = { decode,',
    'const api = { NameRandom, word6, word, decode,');
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled._compile(source, filename);
  return compiled.exports;
}
test('packed sampler rejects tails, retains quotient and handles >32-bit refills exactly', () => {
  const { NameRandom } = packedInternals();
  const rng = new NameRandom(0n);
  rng.range = 8; rng.value = 7;
  let refills = 0;
  rng.next32 = () => { refills++; return 0; };
  // Reject [5,8), retaining value=2,range=3, then append one full chunk.
  const value = 2n * 2n**32n, range = 3n * 2n**32n;
  const limit = range - range % 5n;
  assert.equal(rng.int(5), Number(value % 5n));
  assert.equal(refills, 1);
  assert.equal(rng.value, Number(value / 5n));
  assert.equal(rng.range, Number(limit / 5n));
  // Largest supported bound, with a refill near the maximum exact pool size.
  rng.range = 11170; rng.value = 11169;
  const bigValue = 11169n * 2n**32n;
  const bigRange = 11170n * 2n**32n;
  assert.equal(rng.int(11171), Number(bigValue % 11171n));
  assert.equal(rng.value, Number(bigValue / 11171n));
  assert.equal(rng.range, Number((bigRange - bigRange % 11171n) / 11171n));
});
test('packed chunk endpoints obey vowel/consonant contexts for every word pattern', () => {
  const { word6 } = packedInternals();
  const patterns = ['CVCVCV','CVCVVC','CVVCCV','CVVCVC','VCCVCV','VCCVVC','VCVCCV','VCVCVC'];
  for (let pattern = 0; pattern < 8; pattern++) for (const last of [false,true]) {
    let first = true;
    const word = word6({int(n) { if (first) { first=false; assert.equal(n,8); return pattern; } return last ? n-1 : 0; }}).toUpperCase();
    assert.equal(word.length, 6);
    const p = patterns[pattern];
    for (let i=0;i<6;i++) {
      if (p[i] === 'V') {
        const y = i === 0 || i === 5 || (p[i-1] === 'C' && p[i+1] === 'C' && p[i-2] !== 'C' && p[i+2] !== 'C');
        assert.ok((y ? 'AEIOUY' : 'AEIOU').includes(word[i]));
        if (p[i-1] === 'V' || p[i+1] === 'V') assert.notEqual(word[i], 'Y');
      } else {
        assert.ok('BCDFGHJKLMNPQRSTVWXYZ'.includes(word[i]));
        if (p.slice(i-2,i) === 'VV') assert.ok(!(p[i+1] === 'C' ? 'HWY' : 'Y').includes(word[i]));
        if (word[i] === 'X' && p[i-1] === 'C') assert.ok('HLNRSWYXZ'.includes(word[i-1]));
      }
    }
  }
});
