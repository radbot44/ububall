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

test('512-bit inputs receive finite, repeatable appearance scores', async () => {
  for (const dna of [new Uint8Array(64), new Uint8Array(64).fill(255), await ubu.fromText('007')]) {
    const a = rarity.scoreRarity(ubu.decode(dna));
    assert.deepEqual(a, rarity.scoreRarity(ubu.decode(ubu.fromCode(ubu.toCode(dna)))));
    assert.ok(Number.isFinite(a.bits) && a.percentile >= 0 && a.percentile <= 100);
  }
});

test('changing only Ubuquity does not change appearance rarity', () => {
  const baseDna = ubu.randomDNA();
  const dna1 = new Uint8Array(baseDna);
  const dna2 = new Uint8Array(baseDna);
  dna1[62] &= 252; dna1[63] = 0; // C
  dna2[62] |= 3; dna2[63] = 255; // UBU

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
  // Slot 0: six-bit gate 63, four-bit selector 0 (metallic).
  dna1[9] = 252; dna1[10] &= 63;
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

test('color harmony rewards related hues without double-counting identical colors', () => {
  const base = ubu.decode(new Uint8Array(64));
  const score = colors => {
    const attributes = Object.fromEntries(
      Object.entries(base.attributes).map(([role, part], i) => [role, { ...part, color: colors[i] }])
    );
    return rarity.scoreRarity({ ...base, attributes }).breakdown;
  };
  assert.equal(score([0, 5, 10, 15, 20]).harmony, 0);
  assert.ok(score([27, 0, 1, 2, 3]).harmony > 0, 'analogous hues wrap around index 27 to 0');
  assert.ok(score([0, 1, 13, 14, 28]).harmony > 0, 'opposing hue families');
  assert.ok(score([0, 1, 28, 29, 30]).harmony > 0, 'neutral accent');
  assert.ok(score([28, 29, 30, 31, 28]).harmony > 0, 'grayscale');
  assert.equal(score([3, 3, 3, 3, 3]).harmony, 0, 'one color is already rewarded');
  assert.equal(score([3, 3, 4, 4, 4]).harmony, 0, 'two colors are already rewarded');
  assert.ok(score([0, 1, 2, 3, 4]).harmony <= 3, 'bonus capped at 3 bits');
  closeTo(score([0, 1, 2, 3, 4]).colors, score([0, 5, 10, 15, 20]).colors,
    'distinct-color score unchanged');
  closeTo(score([0, 1, 13, 14, 28]).harmony, score([28, 14, 13, 1, 0]).harmony,
    'slot ordering does not change harmony');
});

test('one rare finish contributes 10 bits; all five matching colors contribute 20 color bits', () => {
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
  const expectedFinishes = 10 + 4 * -Math.log2(63 / 64);
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
  closeTo(rarity.scoreRarity(modelMouth12).breakdown.corners, -Math.log2(p12) - 2 * Math.log2(3 / 4), 'mask 12 mouth corner probability');
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

test('new expressed mouth and lid traits contribute their specified probabilities', () => {
  const base = ubu.decode(new Uint8Array(64));
  const noCuts = rarity.scoreRarity(base);
  const changed = { ...base, mouth: { ...base.mouth, lipNotch: true, horizontalCut: true } };
  closeTo(rarity.scoreRarity(changed).breakdown.mouthCuts, 12 - Math.log2(3 / 4), 'two independent one-in-64 cuts');
  closeTo(noCuts.breakdown.mouthCuts, -2 * Math.log2(63 / 64), 'two absent cuts');
  const straight = { ...base, mouth: { ...base.mouth, corners: [true, false, false, false], curved: [false, false, false, false] } };
  const curved = { ...straight, mouth: { ...straight.mouth, curved: [true, false, false, false] } };
  closeTo(rarity.scoreRarity(curved).breakdown.corners - rarity.scoreRarity(straight).breakdown.corners, Math.log2(3), 'curvature conditional odds');
  const invisibleFlip = { ...base, eyelids: { ...base.eyelids, active: [true, false, false, false], raw: [511, 10, 1023, 10], angleFlip: true } };
  const invisibleNoFlip = { ...invisibleFlip, eyelids: { ...invisibleFlip.eyelids, angleFlip: false } };
  assert.equal(rarity.scoreRarity(invisibleFlip).breakdown.eyelids, rarity.scoreRarity(invisibleNoFlip).breakdown.eyelids);
});

test('notch curvature contributes only when the notch appears', () => {
  const base = ubu.decode(new Uint8Array(64));
  const straight = { ...base, mouth: { ...base.mouth, lipNotch: true, notchCurved: false } };
  const curved = { ...base, mouth: { ...base.mouth, lipNotch: true, notchCurved: true } };
  closeTo(rarity.scoreRarity(curved).breakdown.mouthCuts - rarity.scoreRarity(straight).breakdown.mouthCuts, Math.log2(3), 'notch curvature odds');
  const inactive = { ...base, mouth: { ...base.mouth, notchCurved: true } };
  assert.equal(rarity.scoreRarity(inactive).bits, rarity.scoreRarity(base).bits);
});
