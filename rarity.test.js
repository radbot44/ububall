'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ubu = require('./ubu.js');
const rarity = require('./rarity.js');
const file = require('./ubu-file.js');

const TOLERANCE = 1e-9;

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < TOLERANCE, `${message}: got ${actual}, expected ${expected}, diff ${Math.abs(actual - expected)}`);
}

test('frozen DNA reference vectors match expected rarity bits within 1e-9', () => {
  const vectors = [
    { name: 'Empty text SHA-256 DNA', code: '47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU', expected: 3.049117452627 },
    { name: 'Text seed 007', code: 'Yp9M-TN7DQx28wXYYPmIlM-ownlRa0JXR1FMqHEN65c', expected: 1.563690625457 },
    { name: 'Text seed  x ', code: '_Bker9nFC-9O7SRNJJUp3pmA_6JARgfA-Y6sRMjadyg', expected: 10.485516409083 },
    { name: 'All-zero DNA', code: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', expected: 50.743507380034 },
    { name: 'All-ones DNA', code: '__________________________________________8', expected: 76.592124695260 }
  ];

  for (const v of vectors) {
    const dna = ubu.fromCode(v.code);
    const model = ubu.decode(dna);
    const score = rarity.scoreRarity(model);
    closeTo(score.bits, v.expected, v.name);
    assert.equal(typeof score.percentile, 'number');
    assert.ok(score.percentile >= 0 && score.percentile <= 100);
  }
});

test('changing only Ubuquity does not change appearance rarity', () => {
  const baseDna = ubu.randomDNA();
  const dna1 = new Uint8Array(baseDna);
  const dna2 = new Uint8Array(baseDna);
  dna1[31] = 0;   // Ubuquity grade B
  dna2[31] = 255; // Ubuquity grade S++

  const model1 = ubu.decode(dna1);
  const model2 = ubu.decode(dna2);
  assert.notEqual(model1.grade, model2.grade);

  const score1 = rarity.scoreRarity(model1);
  const score2 = rarity.scoreRarity(model2);
  closeTo(score1.bits, score2.bits, 'appearance rarity bits invariant to Ubuquity');
  assert.equal(score1.percentile, score2.percentile);
});

test('changing only texture-angle bits does not change appearance rarity', () => {
  const dna1 = ubu.randomDNA();
  // Part 0 texture: byte 9 high nibble = 0b1111 (15), low nibble = 0b1000 (8 -> metallic)
  dna1[9] = 0b11111000;
  // Modify angle bits (byte 8, lower 3 bits)
  const dna2 = new Uint8Array(dna1);
  dna2[8] = (dna2[8] ^ 0b00000101);

  const model1 = ubu.decode(dna1);
  const model2 = ubu.decode(dna2);
  assert.equal(model1.attributes.background.texture, 'metallic');
  assert.equal(model2.attributes.background.texture, 'metallic');
  assert.notEqual(model1.attributes.background.angle, model2.attributes.background.angle);

  const score1 = rarity.scoreRarity(model1);
  const score2 = rarity.scoreRarity(model2);
  closeTo(score1.bits, score2.bits, 'appearance rarity invariant to texture angle');
});

test('two DNA inputs producing identical scored visible categories receive the same score', () => {
  const dna = ubu.randomDNA();
  const model1 = ubu.decode(dna);
  const model2 = ubu.decode(new Uint8Array(dna));
  assert.deepEqual(rarity.scoreRarity(model1), rarity.scoreRarity(model2));
});

test('two ubu files containing the same DNA receive identical scores regardless of metadata', async () => {
  const dna = ubu.randomDNA();
  const dnaCode = ubu.toCode(dna);
  const unsignedFile = file.unsigned(dnaCode);
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const randomId = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
  const signedFile = await file.sign({
    mint: randomId(),
    id: randomId(),
    serial: '000000000042',
    dna: dnaCode,
    issuedAt: 1700000000,
    key: 'test-key'
  }, keys.privateKey);

  const res1 = await file.read(unsignedFile);
  const res2 = await file.read(signedFile, { resolveKey: () => keys.publicKey });

  const score1 = rarity.scoreRarity(ubu.decode(ubu.fromCode(res1.dna)));
  const score2 = rarity.scoreRarity(ubu.decode(ubu.fromCode(res2.dna)));
  assert.equal(score1.bits, score2.bits);
  assert.equal(score1.percentile, score2.percentile);
});

test('a flip at exactly neutral displacement contributes no flip rarity; active flip with non-neutral contributes 10 bits', () => {
  const neutralFlipped = {
    attributes: {
      a: { texture: false, color: 0 },
      b: { texture: false, color: 1 },
      c: { texture: false, color: 2 },
      d: { texture: false, color: 3 },
      e: { texture: false, color: 4 }
    },
    mouth: { corners: [false, false, false, false], raw: [511, 511, 511, 511] },
    eyes: { raw: [511, 511], flipX: true, flipY: true },
    parts: { praenomen: 'A', cognomen: 'B', fullName: 'A B C' }
  };
  const scoreNeutral = rarity.scoreRarity(neutralFlipped);
  assert.equal(scoreNeutral.breakdown.eyeFlips, 0);

  const nonNeutralFlipped = {
    ...neutralFlipped,
    eyes: { raw: [600, 511], flipX: true, flipY: false }
  };
  const scoreNonNeutral = rarity.scoreRarity(nonNeutralFlipped);
  closeTo(scoreNonNeutral.breakdown.eyeFlips, 10, 'active flip with displacement contributes 10 bits');
});

test('one rare finish contributes 8 bits; all five matching colors contribute 20 color bits', () => {
  const modelOneFinish = {
    attributes: {
      a: { texture: 'metallic', color: 0 },
      b: { texture: null, color: 1 },
      c: { texture: null, color: 2 },
      d: { texture: null, color: 3 },
      e: { texture: null, color: 4 }
    },
    mouth: { corners: [false, false, false, false], raw: [511, 511, 511, 511] },
    eyes: { raw: [511, 511], flipX: false, flipY: false },
    parts: { praenomen: 'A', cognomen: 'B', fullName: 'A B C' }
  };
  const scoreOneFinish = rarity.scoreRarity(modelOneFinish);
  const expectedFinishes = 8 + 4 * -Math.log2(63 / 64);
  closeTo(scoreOneFinish.breakdown.finishes, expectedFinishes, 'one rare finish contribution');

  const modelMonochrome = {
    ...modelOneFinish,
    attributes: {
      a: { texture: null, color: 5 },
      b: { texture: null, color: 5 },
      c: { texture: null, color: 5 },
      d: { texture: null, color: 5 },
      e: { texture: null, color: 5 }
    }
  };
  const scoreMonochrome = rarity.scoreRarity(modelMonochrome);
  closeTo(scoreMonochrome.breakdown.colors, 20.0, '5 identical colors contribute 20 bits');
});

test('mundane geometry receives zero bonus; extreme geometry receives correct tail bonus', () => {
  const mundane = {
    attributes: {
      a: { texture: null, color: 0 },
      b: { texture: null, color: 1 },
      c: { texture: null, color: 2 },
      d: { texture: null, color: 3 },
      e: { texture: null, color: 4 }
    },
    mouth: { corners: [false, false, false, false], raw: [511, 511, 511, 511] },
    eyes: { raw: [511, 511], flipX: false, flipY: false },
    parts: { praenomen: 'A', cognomen: 'B', fullName: 'A B C' }
  };
  assert.equal(rarity.scoreRarity(mundane).breakdown.geometry, 0);

  const p0 = rarity.tailProbability(0);
  assert.equal(p0, 2 / 1024);
  const expectedBonus0 = Math.log2(25.6);
  closeTo(expectedBonus0, 4.678071905112637, 'value 0 bonus is ~4.678 bits');

  const extreme = {
    ...mundane,
    mouth: { corners: [false, false, false, false], raw: [0, 511, 511, 511] }
  };
  closeTo(rarity.scoreRarity(extreme).breakdown.geometry, expectedBonus0, 'one extreme value bonus');
});

test('mouth-corner precedence and combinations produce expected probabilities', () => {
  const modelMouth12 = {
    attributes: { a: { texture: null, color: 0 }, b: { texture: null, color: 1 }, c: { texture: null, color: 2 }, d: { texture: null, color: 3 }, e: { texture: null, color: 4 } },
    mouth: { corners: [true, true, false, false], raw: [511, 511, 511, 511] },
    eyes: { raw: [511, 511], flipX: false, flipY: false },
    parts: { praenomen: 'A', cognomen: 'B', fullName: 'A B C' }
  };
  const p12 = (15 / 16) ** 4 * (1 / 16) ** 2 + 15 / 256;
  closeTo(rarity.scoreRarity(modelMouth12).breakdown.corners, -Math.log2(p12), 'mask 12 mouth corner probability');
});

test('rarity calculation does not change decoded model or mutate DNA', () => {
  const dna = ubu.randomDNA();
  const copy = new Uint8Array(dna);
  const model = ubu.decode(dna);
  const serialize = m => JSON.stringify(m, (k, v) => typeof v === 'bigint' ? v.toString() : v);
  const modelJsonBefore = serialize(model);

  rarity.scoreRarity(model);

  assert.deepEqual(dna, copy);
  assert.equal(serialize(model), modelJsonBefore);
});

test('percentile lookup is monotonic: increasing rarity bits cannot decrease percentile', () => {
  let prevPercentile = -1;
  for (let bits = 0; bits <= 80; bits += 0.25) {
    const p = rarity.percentile(bits);
    assert.ok(p >= prevPercentile, `monotonicity failure at ${bits} bits: ${p} < ${prevPercentile}`);
    assert.ok(p >= 0 && p <= 100);
    prevPercentile = p;
  }
});
