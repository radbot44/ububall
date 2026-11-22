'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ubu = require('../shared/ubu.js');
const ability = require('../shared/ability.js');
const abilityTableJson = require('../shared/ability-table.json');
const abilityModelJson = require('../shared/ability-model.json');
const list = require('../web/ubu-list.js');

test('1024-bit DNA inputs receive deterministic, finite Ability Scores and bounded percentiles', async () => {
  for (const dna of [new Uint8Array(128), new Uint8Array(128).fill(255), await ubu.fromText('ububall')]) {
    const m1 = ubu.decode(dna);
    const m2 = ubu.decode(ubu.fromCode(ubu.toCode(dna)));
    const s1 = ability.scoreAbility(m1);
    const s2 = ability.scoreAbility(m2);
    assert.deepEqual(s1, s2);
    assert.deepEqual(s1, ability.scoreAbility(m1.stats));
    assert.ok(Number.isFinite(s1.score) && s1.percentile >= 0 && s1.percentile <= 100);
  }
  const pickExtremumBuild = cmp => Object.fromEntries(ability.STATS.map(stat => {
    const ys = ability.MODEL.knots[stat];
    let idx = 0;
    for (let i = 1; i < ys.length; i++) if (cmp(ys[i], ys[idx])) idx = i;
    return [stat, Math.floor(ability.KNOTS[idx])];
  }));
  const worstBuild = pickExtremumBuild((a, b) => a < b);
  const bestBuild = pickExtremumBuild((a, b) => a > b);
  assert.equal(ability.scoreAbility(worstBuild).percentile, 0);
  assert.equal(ability.scoreAbility(bestBuild).percentile, 100);
});

test('Ability Score depends strictly on the 15 core stats (bits 374–493) and is invariant to other bits', () => {
  const baseDna = ubu.randomDNA();
  const mutated = new Uint8Array(baseDna);

  for (let bit = 0; bit <= 373; bit++) {
    const mask = 1 << (7 - (bit & 7));
    mutated[bit >> 3] ^= mask;
  }
  for (let bit = 494; bit <= 1023; bit++) {
    const mask = 1 << (7 - (bit & 7));
    mutated[bit >> 3] ^= mask;
  }

  const mBase = ubu.decode(baseDna);
  const mMut = ubu.decode(mutated);
  assert.deepEqual(mBase.stats, mMut.stats);
  assert.notDeepEqual(mBase.supers, mMut.supers);
  assert.notDeepEqual(mBase.personality, mMut.personality);
  assert.notEqual(mBase.rating, mMut.rating);
  assert.deepEqual(ability.scoreAbility(mBase), ability.scoreAbility(mMut));
});

test('inline TABLE and MODEL stay synchronized with shared JSON artifacts and monotonic quantiles', () => {
  assert.equal(ability.TABLE.length, 1001);
  assert.deepEqual([...ability.TABLE], abilityTableJson.table);
  assert.deepEqual(ability.MODEL.knots, abilityModelJson.knots);
  assert.deepEqual(ability.MODEL.interactions, abilityModelJson.interactions);
  for (let i = 1; i < ability.TABLE.length; i++) {
    assert.ok(ability.TABLE[i] >= ability.TABLE[i - 1], `TABLE monotonic at index ${i}`);
  }
});

test('Reach scoring obeys exact ububall-physics baseReach = max(baseRadius, reach, 18) equivariance', () => {
  const neutral = Object.fromEntries(ability.STATS.map(s => [s, 127]));

  // When Reach <= Size (and Size >= 26), raw Reach is physically shadowed by body radius: scores must match identically.
  const bigLowReach = ability.scoreAbility({ ...neutral, size: 200, reach: 0 });
  const bigMidReach = ability.scoreAbility({ ...neutral, size: 200, reach: 127 });
  const bigCapReach = ability.scoreAbility({ ...neutral, size: 200, reach: 200 });
  assert.equal(bigLowReach.score, bigMidReach.score);
  assert.equal(bigMidReach.score, bigCapReach.score);
  assert.equal(bigLowReach.breakdown.stats.reach, 0);

  // Below the 18 px ballHitRadius floor (REACH_FLOOR ≈ 25.32), Reach 0..25 are also physically identical.
  const tinyZero = ability.scoreAbility({ ...neutral, size: 12, reach: 0 });
  const tiny25 = ability.scoreAbility({ ...neutral, size: 12, reach: 25 });
  assert.equal(tinyZero.score, tiny25.score);
  assert.equal(tiny25.breakdown.stats.reach, 0);

  // Once Reach exceeds max(Size, REACH_FLOOR), poke-check extension strictly boosts Ability Score.
  const extended = ability.scoreAbility({ ...neutral, size: 80, reach: 230 });
  const unextended = ability.scoreAbility({ ...neutral, size: 80, reach: 80 });
  assert.ok(extended.breakdown.stats.reach > 0);
  assert.ok(extended.score > unextended.score);
});

test('Collection ubuList sorts and filters by ability', () => {
  assert.ok(list.METRICS.ability, 'METRICS.ability registered');
  const make = (serial, val) => ({
    serial,
    issuedAt: 100,
    favorite: false,
    rarity: { bits: 10, percentile: 50 },
    model: {
      rating: 500,
      grade: 'B',
      supers: [0, 0, 0, 0],
      stats: Object.fromEntries(ability.STATS.map(s => [s, val])),
      parts: { fullName: 'Ubu ' + serial }
    }
  });
  const sample = [make('000000000001', 40), make('000000000002', 235), make('000000000003', 135)];
  assert.deepEqual(list.view(sample, { sort: 'ability' }).map(x => x.serial), ['000000000002', '000000000003', '000000000001']);
  assert.deepEqual(list.view(sample, { query: 'ability>40 sort:ability' }).map(x => x.serial), ['000000000002', '000000000003']);
});

test('isCharged classifies top-decile Ability (>= 90th percentile) identically across raw 128-byte DNA, decoded models, stats, and scored objects', () => {
  assert.equal(ability.CHARGED_PERCENTILE, 90);
  const eliteDna = new Uint8Array(128).fill(255);
  const lowDna = new Uint8Array(128).fill(0);
  const eliteModel = ubu.decode(eliteDna);
  const lowModel = ubu.decode(lowDna);
  assert.equal(ability.scoreAbility(eliteDna).score, ability.scoreAbility(eliteModel).score);
  assert.equal(ability.scoreAbility(lowDna).score, ability.scoreAbility(lowModel).score);
  assert.equal(ability.isCharged(eliteDna), true);
  assert.equal(ability.isCharged(eliteModel), true);
  assert.equal(ability.isCharged(eliteModel.stats), true);
  assert.equal(ability.isCharged(ability.scoreAbility(eliteModel)), true);
  assert.equal(ability.isCharged(lowDna), false);
  assert.equal(ability.isCharged(lowModel), false);
  assert.equal(ability.isCharged({ score: ability.TABLE[900], percentile: 90 }), true);
  assert.equal(ability.isCharged({ score: ability.TABLE[899], percentile: 89.99 }), false);
  assert.equal(ability.isCharged(null), false);
});
