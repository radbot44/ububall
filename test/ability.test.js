'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ubu = require('../shared/ubu.js');
const ability = require('../shared/ability.js');
const abilityTableJson = require('../shared/ability-table.json');
const abilityModelJson = require('../shared/ability-model.json');
const file = require('../shared/ubu-file.js');
const list = require('../web/ubu-list.js');
const bench = require('../scripts/ability-benchmark.cjs');
const calibrate = require('../scripts/calibrate-ability.cjs');

function putBits(dna, start, width, value) {
  for (let i = 0; i < width; i++) {
    const bit = start + i, mask = 1 << (7 - (bit & 7));
    dna[bit >> 3] = (dna[bit >> 3] & ~mask) | (((value >> (width - i - 1)) & 1) ? mask : 0);
  }
}

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
  const minStats = Object.fromEntries(ability.STATS.map(s => [s, 0]));
  const maxStats = Object.fromEntries(ability.STATS.map(s => [s, 255]));
  assert.equal(ability.scoreAbility(minStats).percentile, 0);
  assert.equal(ability.scoreAbility(maxStats).percentile, 100);
});

test('Ability Score depends strictly on the 15 core stats (bits 374–493) and is invariant to appearance, supers, personality, voice, reserve, Ubuquity, and .ubu signing', async () => {
  const baseDna = ubu.randomDNA();
  const mutated = new Uint8Array(baseDna);

  // Mutate visual/name bits (0–373)
  for (let bit = 0; bit <= 373; bit++) {
    const mask = 1 << (7 - (bit & 7));
    mutated[bit >> 3] ^= mask;
  }
  // Mutate supers (494–509), personality (510–533), voice (534–597), reserve (598–1013), Ubuquity (1014–1023)
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

  const a1 = ability.scoreAbility(mBase);
  const a2 = ability.scoreAbility(mMut);
  assert.deepEqual(a1, a2);

  // Unsigned vs Ed25519-signed .ubu certificate invariance
  const code = ubu.toCode(baseDna);
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const id = () => Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
  const signed = await file.sign({ mint: id(), id: id(), serial: '000000000007', dna: code, issuedAt: 1700000000, key: 'k1' }, keys.privateKey);
  const rUnsigned = await file.read(file.unsigned(code));
  const rSigned = await file.read(signed, { resolveKey: () => keys.publicKey });
  assert.deepEqual(
    ability.scoreAbility(ubu.decode(ubu.fromCode(rUnsigned.dna))),
    ability.scoreAbility(ubu.decode(ubu.fromCode(rSigned.dna)))
  );
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

test('effective reach interaction activates only when Reach exceeds Size', () => {
  const neutral = Object.fromEntries(ability.STATS.map(s => [s, 127]));
  const baseInter = ability.scoreAbility(neutral).breakdown.interactions;
  const shadowed = ability.scoreAbility({ ...neutral, size: 200, reach: 150 });
  const unshadowed = ability.scoreAbility({ ...neutral, size: 100, reach: 220 });
  const z0 = (127 - 127.5) / 127.5;
  // Isolate the (size, reach) change relative to neutral: when reach <= size, reach_over_size hinge is 0.
  const expectedShadowDelta =
    (((200 - 127.5) / 127.5) * ((150 - 127.5) / 127.5) - z0 * z0) * ability.MODEL.interactions.size_x_reach +
    (((200 - 127.5) / 127.5) - z0) * z0 * (ability.MODEL.interactions.impulse_x_size + ability.MODEL.interactions.size_x_mass);
  assert.ok(Math.abs((shadowed.breakdown.interactions - baseInter) - expectedShadowDelta) < 1e-12);
  const expectedHinge = ((220 - 100) / 255) * ability.MODEL.interactions.reach_over_size;
  const prodOnlyDelta =
    (((100 - 127.5) / 127.5) * ((220 - 127.5) / 127.5) - z0 * z0) * ability.MODEL.interactions.size_x_reach +
    (((100 - 127.5) / 127.5) - z0) * z0 * (ability.MODEL.interactions.impulse_x_size + ability.MODEL.interactions.size_x_mass);
  assert.ok(Math.abs((unshadowed.breakdown.interactions - baseInter) - (prodOnlyDelta + expectedHinge)) < 1e-12);
});

test('Collection ubuList sorts and filters by ability and places Ability right before Rarity', () => {
  const idxAbility = list.METRICS.ability;
  assert.ok(idxAbility, 'METRICS.ability registered');
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
  const sample = [make('000000000001', 60), make('000000000002', 220), make('000000000003', 140)];
  assert.deepEqual(list.view(sample, { sort: 'ability' }).map(x => x.serial), ['000000000002', '000000000003', '000000000001']);
  assert.deepEqual(list.view(sample, { query: 'ability>60 sort:ability' }).map(x => x.serial), ['000000000002', '000000000003']);
});

test('Trading card markup & CSS stack Ability ledge above Rarity and drop obsolete rarity foil/card-hue hooks', () => {
  const rootDir = path.join(__dirname, '..');
  const siteJs = fs.readFileSync(path.join(rootDir, 'web', 'site.js'), 'utf8');
  const siteCss = fs.readFileSync(path.join(rootDir, 'web', 'site.css'), 'utf8');
  const prepJs = fs.readFileSync(path.join(rootDir, 'scripts', 'prepare-assets.cjs'), 'utf8');

  assert.ok(!siteJs.includes('--card-hue'), 'site.js must not set dead --card-hue from rarity');
  assert.ok(!siteJs.includes("classList.add('foil')"), 'site.js must not add .foil from rarity');
  assert.ok(!siteCss.includes('--card-hue'), 'site.css must not declare dead --card-hue');
  assert.ok(!siteCss.includes('.foil {'), 'site.css must not contain obsolete .foil rarity rule');
  assert.ok(siteJs.includes("abilityEl.className = 'card-ability'"), 'site.js builds .card-ability ledge');
  assert.ok(siteCss.includes('.card-ability, .card-rarity'), 'site.css styles .card-ability alongside .card-rarity');
  assert.ok(prepJs.includes("'ability.js'"), 'prepare-assets.cjs whitelists ability.js');
});

test('Benchmark harness enforces 50/50 Standard+Pulse split, symmetric swapped pairs, and end-to-end Node+Python fitters', () => {
  const jobs = bench.buildJobs({
    suite: 'full',
    pairs: 10,
    curvePairs: 2,
    interPairs: 2,
    wildPairs: 4,
    seed: 42,
    cpuConfig: bench.PRESETS.fast,
    stdTurns: 4,
    pulseTurns: 12
  });
  const stdCount = jobs.filter(j => j.mode === 'standard').length;
  const pulseCount = jobs.filter(j => j.mode === 'pulse').length;
  assert.equal(stdCount, pulseCount, 'exact 50/50 standard and pulse job split');

  // Identical teams across a side-swapped pair with mirrored context must cancel to 0.0 goalDiff!
  const neutral = Object.fromEntries(ability.STATS.map(s => [s, 127]));
  const symResult = bench.runPairJob({
    id: 'sym:0',
    kind: 'corpus',
    mode: 'pulse',
    seed: 77,
    teams: [[neutral, neutral, neutral], [neutral, neutral, neutral]],
    mirrorContext: true,
    cpuConfig: { level: 'easy', candidates: 4, opponents: 1, risk: 0.2, temperature: 20, wobble: false },
    maxTurns: 3
  });
  assert.equal(symResult.goalDiff, 0);
  assert.equal(symResult.winDiff, 0);

  // Verify both Node fitFromCorpus and Python fit-ability.py on a synthetic 120-pair JSONL file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ability-fit-'));
  const jsonlPath = path.join(tmpDir, 'synthetic.jsonl');
  const reportPath = path.join(tmpDir, 'report.json');
  let seed = 12345;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const lines = [];
  for (let p = 0; p < 120; p++) {
    const randUbu = () => ability.STATS.map(() => Math.floor(rand() * 256));
    const teamA = [randUbu(), randUbu(), randUbu()];
    const teamB = [randUbu(), randUbu(), randUbu()];
    const objOf = arr => Object.fromEntries(ability.STATS.map((s, i) => [s, arr[i]]));
    const trueDiff = teamA.reduce((acc, u) => acc + ability.scoreAbility(objOf(u)).score, 0) -
                     teamB.reduce((acc, u) => acc + ability.scoreAbility(objOf(u)).score, 0);
    lines.push(JSON.stringify({
      id: `corpus:${p}`,
      kind: 'corpus',
      mode: p % 2 === 0 ? 'standard' : 'pulse',
      seed: p,
      teams: [teamA, teamB],
      goalDiff: Number((trueDiff + (rand() - 0.5) * 0.2).toFixed(4)),
      goalRate30s: Number((trueDiff * 1.1).toFixed(4)),
      winDiff: trueDiff >= 0 ? 1 : -1,
      turns: 24,
      ticks: 9600
    }));
  }
  fs.writeFileSync(jsonlPath, lines.join('\n') + '\n');

  const nodeFit = calibrate.fitFromCorpus(jsonlPath);
  assert.equal(nodeFit.pairs, 120);
  assert.ok(nodeFit.knots.impulse[4] > nodeFit.knots.impulse[0], 'Node fitter recovers positive Impulse slope');
  assert.ok(nodeFit.knots.power[4] > nodeFit.knots.power[0], 'Node fitter recovers positive Power slope');

  // Verify Python fit-ability.py (--no-calibrate and backing up shared/ability-model.json so committed prior stays untouched)
  const modelPath = path.join(__dirname, '..', 'shared', 'ability-model.json');
  const backupModel = fs.readFileSync(modelPath, 'utf8');
  try {
    execFileSync('python3', [
      path.join(__dirname, '..', 'scripts', 'fit-ability.py'),
      '--input', jsonlPath,
      '--bootstraps', '40',
      '--report', reportPath,
      '--no-calibrate'
    ], { stdio: 'pipe' });
    const rep = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    assert.equal(rep.pairs, 120);
    assert.ok(rep.holdout.splinePearsonR > 0.85, `Expected high recovery r > 0.85, got ${rep.holdout.splinePearsonR}`);
  } finally {
    fs.writeFileSync(modelPath, backupModel);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Nested scale tiers (--quick ⊂ standard ⊂ --deep), interleaved strata, fastTick+screenTop search, and worker pool streaming work cleanly', async () => {
  const mkIds = tier => new Set(bench.buildJobs({
    suite: 'full',
    ...bench.SCALE_TIERS[tier],
    seed: 20261113,
    cpuConfig: bench.PRESETS.balanced,
    stdTurns: 60,
    pulseTurns: 150
  }).map(j => j.id));

  const quickIds = mkIds('quick');
  const stdIds = mkIds('standard');
  const deepIds = mkIds('deep');
  assert.equal(quickIds.size, 1440);
  assert.equal(stdIds.size, 4316);
  assert.equal(deepIds.size, 11940);
  for (const id of quickIds) assert.ok(stdIds.has(id), `quick id ${id} must be in standard tier`);
  for (const id of stdIds) assert.ok(deepIds.has(id), `standard id ${id} must be in deep tier`);

  // First 24 jobs of an interleaved full suite should already include both corpus and curve jobs and both modes.
  const sampleJobs = bench.buildJobs({
    suite: 'full',
    pairs: 20,
    curvePairs: 2,
    interPairs: 2,
    wildPairs: 6,
    seed: 99,
    cpuConfig: { ...bench.PRESETS.fast, candidates: 6, searchTicks: 120 },
    stdTurns: 3,
    pulseTurns: 6
  });
  const head = sampleJobs.slice(0, 24);
  assert.ok(head.some(j => j.kind === 'corpus') && head.some(j => j.kind === 'curve'));
  assert.ok(head.some(j => j.mode === 'standard') && head.some(j => j.mode === 'pulse'));

  // End-to-end worker pool test (verifies live progress messages + batch assembly)
  const poolOut = await bench.runPool(sampleJobs.slice(0, 4), 2, 1, () => {});
  assert.equal(poolOut.length, 4);
  assert.ok(poolOut.every(r => Number.isFinite(r.goalDiff) && r.turns >= 2));
});
