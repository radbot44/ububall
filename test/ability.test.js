'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ubu = require('../shared/ubu.js');
const ability = require('../shared/ability.js');
const abilityTableJson = require('../shared/ability-table.json');
const abilityModelJson = require('../shared/ability-model.json');
const file = require('../shared/ubu-file.js');
const list = require('../web/ubu-list.js');
const bench = require('../scripts/ability-benchmark.cjs');
const calibrate = require('../scripts/calibrate-ability.cjs');

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
  const worstBuild = {
    impulse: 0, traction: 0, spin: 127, curve: 255,
    size: 255, mass: 0, bounciness: 255, grip: 255,
    power: 0, reach: 0, strength: 0, stability: 0,
    efficiency: 0, synergy: 0, chemistry: 0
  };
  const bestBuild = {
    impulse: 255, traction: 255, spin: 0, curve: 0,
    size: 0, mass: 255, bounciness: 0, grip: 0,
    power: 255, reach: 255, strength: 255, stability: 255,
    efficiency: 255, synergy: 255, chemistry: 255
  };
  assert.equal(ability.scoreAbility(worstBuild).percentile, 0);
  assert.equal(ability.scoreAbility(bestBuild).percentile, 100);
});

test('Ability Score depends strictly on the 15 core stats (bits 374–493) and is invariant to appearance, supers, personality, voice, reserve, Ubuquity, and .ubu signing', async () => {
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

  const a1 = ability.scoreAbility(mBase);
  const a2 = ability.scoreAbility(mMut);
  assert.deepEqual(a1, a2);

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
  assert.ok(extended.breakdown.stats.reach > 0.25);
  assert.ok(extended.score > unextended.score + 0.25);
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
  const sample = [make('000000000001', 40), make('000000000002', 235), make('000000000003', 135)];
  assert.deepEqual(list.view(sample, { sort: 'ability' }).map(x => x.serial), ['000000000002', '000000000003', '000000000001']);
  assert.deepEqual(list.view(sample, { query: 'ability>40 sort:ability' }).map(x => x.serial), ['000000000002', '000000000003']);
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

function writeSyntheticCorpus(jsonlPath, pairCount = 140) {
  let seed = 12345;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const objOf = arr => Object.fromEntries(ability.STATS.map((s, i) => [s, arr[i]]));
  const randUbu = () => ability.STATS.map(() => Math.floor(rand() * 256));
  const lines = [];
  for (let p = 0; p < pairCount; p++) {
    const teamA = [randUbu(), randUbu(), randUbu()];
    const teamB = [randUbu(), randUbu(), randUbu()];
    const trueDiff = teamA.reduce((acc, u) => acc + ability.scoreAbility(objOf(u)).score, 0) -
                     teamB.reduce((acc, u) => acc + ability.scoreAbility(objOf(u)).score, 0);
    lines.push(JSON.stringify({
      id: `corpus:${p}`,
      kind: 'corpus',
      mode: p % 2 === 0 ? 'standard' : 'pulse',
      seed: p,
      teams: [teamA, teamB],
      goalDiff: Number((trueDiff + (rand() - 0.5) * 0.15).toFixed(4)),
      goalRate30s: Number((trueDiff * 1.1).toFixed(4)),
      winDiff: trueDiff >= 0 ? 1 : -1,
      turns: 24,
      ticks: 9600
    }));
  }
  fs.writeFileSync(jsonlPath, lines.join('\n') + '\n');
}

function findPythonWithNumpy() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push([process.env.PYTHON]);
  if (process.platform === 'win32') {
    candidates.push(['python'], ['py', '-3'], ['py', '-3.11'], ['py', '-3.10'], ['py', '-3.12'], ['python3']);
  } else {
    candidates.push(['python3'], ['python']);
  }
  for (const [cmd, ...prefix] of candidates) {
    const probe = spawnSync(cmd, [...prefix, '-c', 'import sys, numpy; sys.exit(0 if sys.version_info >= (3, 8) else 1)'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return { cmd, prefix };
  }
  return null;
}

test('Benchmark harness enforces 50/50 Standard+Pulse split, symmetric swapped pairs, and Node fitter', t => {
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ability-fit-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const jsonlPath = path.join(tmpDir, 'synthetic.jsonl');
  writeSyntheticCorpus(jsonlPath);

  const nodeFit = calibrate.fitFromCorpus(jsonlPath);
  assert.equal(nodeFit.pairs, 140);
  assert.ok(nodeFit.knots.impulse[4] > nodeFit.knots.impulse[0], 'Node fitter recovers positive Impulse slope');
  assert.ok(nodeFit.knots.power[4] > nodeFit.knots.power[0], 'Node fitter recovers positive Power slope');
});

test('Python fit-ability.py recovers spline weights from synthetic corpus', t => {
  const py = findPythonWithNumpy();
  if (!py) {
    t.skip('Python 3 with numpy is not available');
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ability-pyfit-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const jsonlPath = path.join(tmpDir, 'synthetic.jsonl');
  const modelPath = path.join(tmpDir, 'ability-model.json');
  const reportPath = path.join(tmpDir, 'report.json');
  writeSyntheticCorpus(jsonlPath);

  execFileSync(py.cmd, [
    ...py.prefix,
    path.join(__dirname, '..', 'scripts', 'fit-ability.py'),
    '--input', jsonlPath,
    '--bootstraps', '20',
    '--model', modelPath,
    '--report', reportPath,
    '--no-calibrate'
  ], { stdio: 'pipe' });

  const rep = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const fittedModel = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  assert.equal(rep.pairs, 140);
  assert.equal(fittedModel.pairs, 140);
  assert.ok(rep.holdout.splineCVPearsonR > 0.85, `Expected high CV recovery r > 0.85, got ${rep.holdout.splineCVPearsonR}`);
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

  const poolOut = await bench.runPool(sampleJobs.slice(0, 4), 2, 1, () => {});
  assert.equal(poolOut.length, 4);
  assert.ok(poolOut.every(r => Number.isFinite(r.goalDiff) && r.turns >= 2));
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

test('loadCompletedIds auto-archives stale physicsVersion corpora and resumes matching P.VERSION corpora', t => {
  const P = require('../shared/ububall-physics.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ability-ver-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const corpusPath = path.join(tmpDir, 'ability-corpus.jsonl');

  // Legacy v27 row (no physicsVersion field) -> archived to .v27.jsonl and returns empty Set
  fs.writeFileSync(corpusPath, JSON.stringify({ id: 'corpus:0', goalDiff: 1 }) + '\n');
  const afterStale = bench.loadCompletedIds(corpusPath, P.VERSION);
  assert.equal(afterStale.size, 0);
  assert.equal(fs.existsSync(corpusPath), false);
  assert.equal(fs.existsSync(path.join(tmpDir, 'ability-corpus.v27.jsonl')), true);

  // Matching P.VERSION row -> kept and resumed
  fs.writeFileSync(corpusPath, JSON.stringify({ id: 'corpus:0', physicsVersion: P.VERSION, goalDiff: 1 }) + '\n');
  const afterMatch = bench.loadCompletedIds(corpusPath, P.VERSION);
  assert.equal(afterMatch.has('corpus:0'), true);
});
