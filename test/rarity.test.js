'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ubu = require('../shared/ubu.js');
const rarity = require('../shared/rarity.js');
const rarityJson = require('../shared/rarity-table.json');

const TOLERANCE = 1e-9;

function closeTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < TOLERANCE, `${message}: got ${actual}, expected ${expected}, diff ${Math.abs(actual - expected)}`);
}

test('1024-bit inputs receive finite, repeatable appearance scores', async () => {
  for (const dna of [new Uint8Array(128), new Uint8Array(128).fill(255), await ubu.fromText('007')]) {
    const a = rarity.scoreRarity(ubu.decode(dna));
    assert.deepEqual(a, rarity.scoreRarity(ubu.decode(ubu.fromCode(ubu.toCode(dna)))));
    assert.ok(Number.isFinite(a.bits) && a.percentile >= 0 && a.percentile <= 100);
  }
});

test('changing only Ubuquity or texture-angle bits does not change appearance rarity', () => {
  const baseDna = ubu.randomDNA();
  const dna1 = new Uint8Array(baseDna);
  const dna2 = new Uint8Array(baseDna);
  dna1[126] &= 252; dna1[127] = 0; // C
  dna2[126] |= 3; dna2[127] = 255; // UBU
  const m1 = ubu.decode(dna1), m2 = ubu.decode(dna2);
  assert.notEqual(m1.grade, m2.grade);
  const s1 = rarity.scoreRarity(m1), s2 = rarity.scoreRarity(m2);
  closeTo(s1.bits, s2.bits, 'appearance rarity bits invariant to Ubuquity');
  assert.equal(s1.percentile, s2.percentile);

  const ang1 = ubu.randomDNA();
  ang1[9] = 248; ang1[10] &= 63; // Slot 0: gate 31, selector 0 (metallic)
  const ang2 = new Uint8Array(ang1);
  ang2[8] ^= 0b00000101;
  const am1 = ubu.decode(ang1), am2 = ubu.decode(ang2);
  assert.equal(am1.attributes.background.texture, 'metallic');
  assert.equal(am2.attributes.background.texture, 'metallic');
  assert.notEqual(am1.attributes.background.angle, am2.attributes.background.angle);
  const as1 = rarity.scoreRarity(am1), as2 = rarity.scoreRarity(am2);
  closeTo(as1.bits, as2.bits, 'appearance rarity invariant to texture angle');
});

test('percentile lookup is monotonic, frozen, matches rarity-table.json, and rejects non-finite inputs', () => {
  assert.ok(Object.isFrozen(rarity));
  assert.ok(Object.isFrozen(rarity.TABLE));
  assert.equal(rarity.TABLE.length, 1001);
  assert.deepEqual([...rarity.TABLE], rarityJson.table);
  assert.throws(() => { rarity.TABLE[0] = 0; }, TypeError);
  for (const bad of [NaN, Infinity, -Infinity, undefined]) {
    assert.throws(() => rarity.percentile(bad), RangeError);
  }
  for (const badV of [-1, 1024, 1.5, NaN]) {
    assert.throws(() => rarity.tailProbability(badV), RangeError);
  }

  let prevPercentile = -1;
  for (let bits = 0; bits <= 80; bits += 0.25) {
    const p = rarity.percentile(bits);
    assert.ok(p >= prevPercentile, `monotonicity failure at ${bits} bits: ${p} < ${prevPercentile}`);
    assert.ok(p >= 0 && p <= 100);
    prevPercentile = p;
  }
});

test('starterTeam draws three canonical DNA codes across the 70, 80 and 90 rarity deciles, including 100th percentile', () => {
  const codes = rarity.starterTeam(ubu);
  assert.equal(codes.length, 3);
  const deciles = codes.map(code => {
    const pct = rarity.scoreRarity(ubu.decode(ubu.fromCode(code))).percentile;
    return Math.min(90, Math.floor(pct / 10) * 10);
  });
  assert.deepEqual(deciles, [70, 80, 90]);

  const maxDna = new Uint8Array(128).fill(255);
  assert.equal(rarity.scoreRarity(ubu.decode(maxDna)).percentile, 100);
  let calls = 0;
  const synthetic = rarity.starterTeam({
    randomDNA: () => (++calls > 200 ? maxDna : ubu.randomDNA()),
    decode: ubu.decode,
    toCode: ubu.toCode
  });
  assert.equal(synthetic.length, 3);
});
