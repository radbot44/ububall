'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ubu = require('../shared/ubu.js');
const arch = require('../shared/ubu-archetype.js');

test('81 adjectives and 90 nouns are frozen, unique, and disjoint', () => {
  assert.ok(Object.isFrozen(arch));
  assert.ok(Object.isFrozen(arch.ADJECTIVES));
  assert.ok(Object.isFrozen(arch.NOUN_PROFILES));
  assert.equal(arch.ADJECTIVES.length, 81);
  assert.equal(arch.NOUN_PROFILES.length, 90);

  const adjLower = new Set(arch.ADJECTIVES.map(a => a.toLowerCase()));
  const nounLower = new Set(arch.NOUN_PROFILES.map(p => p.noun.toLowerCase()));
  assert.equal(adjLower.size, 81);
  assert.equal(nounLower.size, 90);
  for (const w of adjLower) assert.ok(!nounLower.has(w), `Cross-list collision on ${w}`);
});

test('adjective classifier maps 0..63 tiers exhaustively across all 81 slots and rejects bad inputs', () => {
  for (const [raw, tier] of [[0, 0], [20, 0], [21, 1], [42, 1], [43, 2], [63, 2]]) {
    assert.equal(arch.personalityTier(raw), tier);
  }
  for (const bad of [-1, 64, 1.5, NaN, null, undefined, '31']) {
    assert.throws(() => arch.personalityTier(bad), RangeError);
  }
  assert.throws(() => arch.chooseAdjective(null), TypeError);
  assert.throws(() => arch.chooseAdjective({ aggression: 10, creativity: 10, teamwork: 10 }), RangeError);

  const reps = [10, 31, 53];
  const labels = ['Low', 'Medium', 'High'];
  const seen = new Set();
  let totalOutcomes = 0;
  const binCounts = [21, 22, 21];
  for (let ai = 0; ai < 3; ai++) {
    for (let ti = 0; ti < 3; ti++) {
      for (let ci = 0; ci < 3; ci++) {
        for (let ki = 0; ki < 3; ki++) {
          const res = arch.chooseAdjective({
            aggression: reps[ai],
            creativity: reps[ci],
            teamwork: reps[ti],
            clutch: reps[ki]
          });
          const expectedSlot = (ai * 3 + ti) * 9 + ci * 3 + ki + 1;
          assert.equal(res.slot, expectedSlot);
          assert.equal(res.family, ai * 3 + ti + 1);
          assert.equal(res.adjective, arch.ADJECTIVES[expectedSlot - 1]);
          assert.deepEqual(res.tiers, {
            aggression: labels[ai],
            creativity: labels[ci],
            teamwork: labels[ti],
            clutch: labels[ki]
          });
          seen.add(res.adjective);
          totalOutcomes += binCounts[ai] * binCounts[ti] * binCounts[ci] * binCounts[ki];
        }
      }
    }
  }
  assert.equal(seen.size, 81);
  assert.equal(totalOutcomes, 64 ** 4);
});

test('describe() and format() round-trip deterministically on decoded DNA, ignore reserve bits, and chooseNoun rejects bad inputs', () => {
  assert.throws(() => arch.chooseNoun(null), TypeError);
  const baseStats = Object.fromEntries(arch.STATS.map(k => [k, 127]));
  assert.throws(() => arch.chooseNoun({ ...baseStats, impulse: -1 }), RangeError);
  assert.throws(() => arch.chooseNoun({ ...baseStats, chemistry: 256 }), RangeError);
  assert.throws(() => arch.chooseNoun({ ...baseStats, power: 12.5 }), RangeError);

  for (let i = 0; i < 5; i++) {
    const dna = ubu.randomDNA();
    const decoded = ubu.decode(dna);
    const first = arch.describe(decoded);
    const second = arch.describe(ubu.decode(ubu.fromCode(ubu.toCode(dna))));
    assert.deepEqual(first, second);
    assert.equal(arch.format(decoded), first.fullName);
    assert.equal(first.fullName, `${first.adjective} ${first.noun}`);

    const copy = new Uint8Array(dna);
    copy[700 >> 3] ^= 1 << (7 - (700 & 7));
    assert.deepEqual(arch.describe(ubu.decode(copy)), first);
  }
  assert.equal(arch.format(null), '');
  assert.equal(arch.format({ stats: {} }), '');
});
