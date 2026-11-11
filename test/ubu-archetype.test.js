'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ubu = require('../shared/ubu.js');
const arch = require('../shared/ubu-archetype.js');

test('81 adjectives and 90 nouns are frozen, unique, disjoint, and include all approved swaps', () => {
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

  const expectedNounSwaps = [
    [1, 'Curler'], [20, 'Decoy'], [22, 'Fencer'], [28, 'Mascot'], [31, 'Conduit'],
    [41, 'Skipper'], [53, 'Swooper'], [58, 'Piston'], [60, 'Lodestone'],
    [73, 'Furnace'], [74, 'Reactor'], [75, 'Monolith'], [78, 'Bouncer'],
    [86, 'Playmaker'], [87, 'Trapper']
  ];
  for (const [slot, expected] of expectedNounSwaps) {
    assert.equal(arch.NOUN_PROFILES[slot - 1].slot, slot);
    assert.equal(arch.NOUN_PROFILES[slot - 1].noun, expected);
  }

  const expectedAdjSwaps = [
    [2, 'Mellow'], [5, 'Cagey'], [13, 'Shy'], [14, 'Handy'], [38, 'Crisp'],
    [40, 'Jumpy'], [47, 'Solid'], [48, 'Loyal'], [50, 'Chummy'], [57, 'Ironclad'],
    [63, 'Brazen'], [72, 'Maverick'], [74, 'Fierce'], [80, 'Peppy']
  ];
  for (const [slot, expected] of expectedAdjSwaps) {
    assert.equal(arch.ADJECTIVES[slot - 1], expected);
  }

  const retired = [
    'plodder', 'buffer', 'spearman', 'sponsor', 'charger', 'hopper', 'falcon',
    'regulator', 'metronome', 'collector', 'foundry', 'powerplant', 'silo',
    'rebounder', 'quarterback', 'receiver', 'retriever',
    'staid', 'circumspect', 'faltering', 'practical', 'systematic', 'perturbed',
    'obliging', 'helpful', 'trustworthy', 'collegial', 'implacable',
    'swashbuckling', 'trailblazing', 'regimented', 'vocal', 'dynamic'
  ];
  for (const w of retired) {
    assert.ok(!adjLower.has(w) && !nounLower.has(w), `Retired word still present: ${w}`);
  }
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
  assert.equal(arch.chooseAdjective({ aggression: 0, creativity: 0, teamwork: 0, clutch: 0 }).adjective, 'Skittish');
  assert.equal(arch.chooseAdjective({ aggression: 31, creativity: 31, teamwork: 31, clutch: 31 }).adjective, 'Balanced');
  assert.equal(arch.chooseAdjective({ aggression: 63, creativity: 63, teamwork: 63, clutch: 63 }).adjective, 'Electrifying');
});

test('upgraded noun scorer is deterministic, validates 8-bit stats, and keeps all 90 nouns near-uniform', () => {
  assert.throws(() => arch.chooseNoun(null), TypeError);
  const baseStats = Object.fromEntries(arch.STATS.map(k => [k, 127]));
  assert.throws(() => arch.chooseNoun({ ...baseStats, impulse: -1 }), RangeError);
  assert.throws(() => arch.chooseNoun({ ...baseStats, chemistry: 256 }), RangeError);
  assert.throws(() => arch.chooseNoun({ ...baseStats, power: 12.5 }), RangeError);

  // Deterministic seeded 100,000-roll uniform benchmark
  const N = 100000;
  const counts = new Int32Array(90);
  let state = 0x9e3779b9 >>> 0;
  const sample = {};
  let strikerLowPower = 0;
  let rammerLowStrength = 0;
  for (let n = 0; n < N; n++) {
    for (let j = 0; j < 15; j++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      sample[arch.STATS[j]] = state >>> 24;
    }
    const res = arch.chooseNoun(sample, true);
    counts[res.slot - 1]++;
    if (res.noun === 'Striker' && sample.power < 100) strikerLowPower++;
    if (res.noun === 'Rammer' && sample.strength < 100) rammerLowStrength++;
  }

  for (let i = 0; i < 90; i++) {
    const pct = (counts[i] * 100) / N;
    assert.ok(counts[i] > 0, `Noun ${arch.NOUN_PROFILES[i].noun} unreachable`);
    assert.ok(pct >= 0.88 && pct <= 1.35, `Slot ${i + 1} (${arch.NOUN_PROFILES[i].noun}) out of uniform tolerance: ${pct.toFixed(3)}%`);
  }
  for (let f = 0; f < 10; f++) {
    let famCount = 0;
    for (let k = 0; k < 9; k++) famCount += counts[f * 9 + k];
    const famPct = (famCount * 100) / N;
    assert.ok(famPct >= 9.2 && famPct <= 10.8, `Family ${f + 1} share out of tolerance: ${famPct.toFixed(3)}%`);
  }
  assert.equal(strikerLowPower, 0, 'Salience + worst-stat guard prevents weak-Power Strikers');
  assert.equal(rammerLowStrength, 0, 'Salience + worst-stat guard prevents weak-Strength Rammers');
});

test('describe() and format() round-trip deterministically on decoded DNA and ignore unassigned reserve bits', () => {
  for (let i = 0; i < 50; i++) {
    const dna = ubu.randomDNA();
    const decoded = ubu.decode(dna);
    const first = arch.describe(decoded);
    const second = arch.describe(ubu.decode(ubu.fromCode(ubu.toCode(dna))));
    assert.deepEqual(first, second);
    assert.equal(arch.format(decoded), first.fullName);
    assert.equal(first.fullName, `${first.adjective} ${first.noun}`);

    // Flipping unassigned reserve bit 700 must not change archetype
    const copy = new Uint8Array(dna);
    copy[700 >> 3] ^= 1 << (7 - (700 & 7));
    assert.deepEqual(arch.describe(ubu.decode(copy)), first);
  }
  assert.equal(arch.format(null), '');
  assert.equal(arch.format({ stats: {} }), '');
});

test('asset whitelist and HTML pages include ubu-archetype.js in load order', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const prep = fs.readFileSync(path.join(root, 'scripts/prepare-assets.cjs'), 'utf8');
  assert.ok(prep.includes("'ubu-archetype.js'"), 'prepare-assets.cjs must whitelist ubu-archetype.js');
  for (const page of ['web/index.html', 'web/demo.html', 'web/effects.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const ubuIdx = html.indexOf('ubu.js');
    const archIdx = html.indexOf('ubu-archetype.js');
    assert.ok(ubuIdx !== -1 && archIdx > ubuIdx, `${page} must load ubu-archetype.js after ubu.js`);
  }
});
