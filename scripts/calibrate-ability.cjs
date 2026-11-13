'use strict';
// Calibrates the 1,001-step Ability Score percentile table from 1,000,000 random 128-byte DNA samples,
// and optionally fits the 72-parameter physics-equivariant spline + interaction model directly from a JSONL corpus.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomFillSync } = require('node:crypto');
const ubu = require('../shared/ubu.js');
const ability = require('../shared/ability.js');

const SAMPLE_SIZE = 1000000;
const CHUNK_SIZE = 50000;
const STEPS = 1000;

const STATS = ability.STATS;
const STAT_INDEX = Object.fromEntries(STATS.map((s, i) => [s, i]));
const INTERACTIONS = ability.INTERACTIONS;
const REACH_FLOOR = ability.REACH_FLOOR;
const MONO_STATS = new Set(['impulse', 'traction', 'mass', 'power', 'reach', 'strength', 'stability', 'efficiency', 'synergy', 'chemistry']);

function hatBasis4(v, out4) {
  let w0 = 0, w1 = 0, w3 = 0, w4 = 0;
  if (v <= 64) {
    w0 = (64 - v) / 64;
    w1 = v / 64;
  } else if (v <= 127.5) {
    w1 = (127.5 - v) / 63.5;
  } else if (v <= 191) {
    w3 = (v - 127.5) / 63.5;
  } else {
    w3 = (255 - v) / 64;
    w4 = (v - 191) / 64;
  }
  out4[0] = w0;
  out4[1] = w1;
  out4[2] = w3;
  out4[3] = w4;
}

const tmpEff = new Float64Array(4);
const tmpBase = new Float64Array(4);

// Vectorized 72-feature basis for a 15-element stat array, enforcing exact Reach physics invariance.
function ubuFeatures(arr, out, offset) {
  const sz = arr[STAT_INDEX.size];
  const rc = arr[STAT_INDEX.reach];
  const effR = Math.max(sz, rc, REACH_FLOOR);
  const baseR = Math.max(sz, REACH_FLOOR);

  for (let s = 0; s < 15; s++) {
    const base = offset + s * 4;
    if (STATS[s] === 'reach') {
      hatBasis4(effR, tmpEff);
      hatBasis4(baseR, tmpBase);
      out[base] = tmpEff[0] - tmpBase[0];
      out[base + 1] = tmpEff[1] - tmpBase[1];
      out[base + 2] = tmpEff[2] - tmpBase[2];
      out[base + 3] = tmpEff[3] - tmpBase[3];
    } else {
      hatBasis4(arr[s], tmpEff);
      out[base] = tmpEff[0];
      out[base + 1] = tmpEff[1];
      out[base + 2] = tmpEff[2];
      out[base + 3] = tmpEff[3];
    }
  }
  for (let k = 0; k < INTERACTIONS.length; k++) {
    const [, aName, bName, kind] = INTERACTIONS[k];
    const a = arr[STAT_INDEX[aName]], b = arr[STAT_INDEX[bName]];
    out[offset + 60 + k] = kind === 'ext_size'
      ? ((effR - baseR) / 255) * ((sz - 127.5) / 127.5)
      : ((a - 127.5) / 127.5) * ((b - 127.5) / 127.5);
  }
}

// Gauss-Jordan linear system solver with partial pivoting (72x72).
function solveLinear(A, b) {
  const k = b.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) {
      if (Math.abs(aug[r][c]) > Math.abs(aug[p][c])) p = r;
    }
    [aug[c], aug[p]] = [aug[p], aug[c]];
    const diag = aug[c][c];
    if (Math.abs(diag) < 1e-12) throw new Error('Singular matrix during Ability model fit.');
    for (let j = c; j <= k; j++) aug[c][j] /= diag;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = aug[r][c];
      if (f === 0) continue;
      for (let j = c; j <= k; j++) aug[r][j] -= f * aug[c][j];
    }
  }
  return aug.map(row => row[k]);
}

// Pool-Adjacent-Violators projection onto k0 <= k1 <= 0 <= k3 <= k4 for a 4-parameter spline block.
function projectMonotoneBlock(theta, base) {
  // Enforce non-positivity on k1 <= 0 and non-negativity on k3 >= 0, plus ordering k0 <= k1 and k3 <= k4.
  let k0 = theta[base], k1 = theta[base + 1], k3 = theta[base + 2], k4 = theta[base + 3];
  if (k0 > k1) { const m = 0.5 * (k0 + k1); k0 = m; k1 = m; }
  if (k1 > 0) { k1 = 0; if (k0 > 0) k0 = 0; }
  if (k3 > k4) { const m = 0.5 * (k3 + k4); k3 = m; k4 = m; }
  if (k3 < 0) { k3 = 0; if (k4 < 0) k4 = 0; }
  theta[base] = k0;
  theta[base + 1] = k1;
  theta[base + 2] = k3;
  theta[base + 3] = k4;
}

function fitFromCorpus(corpusPath) {
  const rows = [];
  for (const line of fs.readFileSync(corpusPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && ['corpus', 'curve', 'interaction'].includes(r.kind)) rows.push(r);
    } catch {}
  }
  if (rows.length < 80) {
    throw new Error(`Need at least 80 benchmark pairs in ${corpusPath} to fit 72 parameters (found ${rows.length}).`);
  }

  const n = rows.length;
  let pulseCount = 0;
  for (const r of rows) {
    if (r.mode === 'pulse') pulseCount++;
  }
  const stdCount = n - pulseCount;

  const K = 72;
  const xtx = Array.from({ length: K }, () => new Float64Array(K));
  const xty = new Float64Array(K);
  const uFeat = new Float64Array(K);
  const rowX = new Float64Array(K);

  for (let t = 0; t < n; t++) {
    const r = rows[t];
    const w = (pulseCount > 0 && stdCount > 0)
      ? (r.mode === 'pulse' ? (0.5 * n / pulseCount) : (0.5 * n / stdCount))
      : 1;
    const y = Number(r.goalDiff);

    rowX.fill(0);
    for (let i = 0; i < 3; i++) {
      ubuFeatures(r.teams[0][i], uFeat, 0);
      for (let j = 0; j < K; j++) rowX[j] += uFeat[j];
      ubuFeatures(r.teams[1][i], uFeat, 0);
      for (let j = 0; j < K; j++) rowX[j] -= uFeat[j];
    }

    for (let i = 0; i < K; i++) {
      const wi = w * rowX[i];
      if (wi === 0) continue;
      xty[i] += wi * y;
      const targetRow = xtx[i];
      for (let j = i; j < K; j++) targetRow[j] += wi * rowX[j];
    }
  }
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < i; j++) xtx[i][j] = xtx[j][i];
  }

  // Scale smoothness & ridge proportionally to sample size (1100 at n=11040, gentle on tiny synthetic tests).
  const scale = Math.max(0.08, n / 11040);
  const lamSmooth = Number((1100.0 * scale).toFixed(2));
  const lamRidge = Number((20.0 * scale).toFixed(2));
  const lamInter = Number((100.0 * scale).toFixed(2));
  const dtd = [
    [1, -2, 0, 0],
    [-2, 5, 1, 0],
    [0, 1, 5, -2],
    [0, 0, -2, 1]
  ];
  const A = Array.from({ length: K }, (_, i) => Array.from(xtx[i]));
  for (let s = 0; s < 15; s++) {
    const b = s * 4;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) A[b + r][b + c] += lamSmooth * dtd[r][c];
      A[b + r][b + r] += lamRidge;
    }
  }
  for (let k = 0; k < 12; k++) A[60 + k][60 + k] += lamInter;

  // Initialize via unconstrained solve, then refine via projected block coordinate descent for MONO_STATS.
  const theta = solveLinear(A, Array.from(xty));
  for (let iter = 0; iter < 60; iter++) {
    for (let i = 0; i < K; i++) {
      let rhs = xty[i];
      const row = A[i];
      for (let j = 0; j < K; j++) if (j !== i) rhs -= row[j] * theta[j];
      theta[i] = rhs / row[i];
    }
    for (let s = 0; s < 15; s++) {
      if (MONO_STATS.has(STATS[s])) projectMonotoneBlock(theta, s * 4);
    }
  }

  const knots = {};
  for (let s = 0; s < 15; s++) {
    const name = STATS[s];
    knots[name] = [
      Number(theta[s * 4].toFixed(6)),
      Number(theta[s * 4 + 1].toFixed(6)),
      0,
      Number(theta[s * 4 + 2].toFixed(6)),
      Number(theta[s * 4 + 3].toFixed(6))
    ];
  }
  const interactions = {};
  for (let k = 0; k < INTERACTIONS.length; k++) {
    interactions[INTERACTIONS[k][0]] = Number(theta[60 + k].toFixed(6));
  }
  return {
    version: 2,
    source: 'empirical-fit-node',
    pairs: n,
    modeMix: { standard: 0.5, pulse: 0.5 },
    regularization: { smooth: lamSmooth, ridge: lamRidge, interaction: lamInter },
    knots,
    interactions
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) throw new Error('Unexpected argument: ' + tok);
    const key = tok.slice(2);
    if (!['corpus', 'model', 'samples'].includes(key)) throw new Error('Unknown option: --' + key);
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error('Missing value for --' + key);
    out[key] = argv[++i];
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sharedDir = path.join(__dirname, '..', 'shared');
  const modelPath = args.model ? path.resolve(args.model) : path.join(sharedDir, 'ability-model.json');
  const sampleSize = args.samples ? Number(args.samples) : SAMPLE_SIZE;
  assert.ok(Number.isInteger(sampleSize) && sampleSize >= 1000, 'Invalid --samples count.');

  if (args.corpus) {
    const fitted = fitFromCorpus(path.resolve(args.corpus));
    fs.writeFileSync(modelPath, JSON.stringify(fitted, null, 2) + '\n');
    console.log(`Fitted 72-parameter Ability model from ${fitted.pairs} benchmark pairs -> ${modelPath}`);
  }

  const rawModel = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  const inlineModel = {
    version: rawModel.version || 2,
    source: rawModel.source || 'calibrated',
    pairs: rawModel.pairs || 0,
    modeMix: rawModel.modeMix || { standard: 0.5, pulse: 0.5 },
    knots: rawModel.knots,
    interactions: rawModel.interactions
  };

  console.log(`Calibrating Ability Score distribution from ${sampleSize} random 128-byte DNA samples...`);
  const scores = new Float64Array(sampleSize);
  const chunkBuf = new Uint8Array(Math.min(CHUNK_SIZE, sampleSize) * 128);

  let offset = 0;
  while (offset < sampleSize) {
    const count = Math.min(CHUNK_SIZE, sampleSize - offset);
    const view = chunkBuf.subarray(0, count * 128);
    randomFillSync(view);
    for (let i = 0; i < count; i++) {
      const dna = view.subarray(i * 128, (i + 1) * 128);
      scores[offset + i] = ability.scoreAbility(ubu.decode(dna), inlineModel).score;
    }
    offset += count;
  }

  scores.sort();

  const table = [];
  for (let i = 0; i <= STEPS; i++) {
    const rank = Math.min(sampleSize - 1, Math.floor(i * (sampleSize / STEPS)));
    table.push(Number(scores[rank].toFixed(6)));
  }

  const outputPath = path.join(sharedDir, 'ability-table.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    sampleSize,
    generatedAt: new Date().toISOString(),
    modelSource: inlineModel.source,
    modelPairs: inlineModel.pairs,
    steps: STEPS,
    min: Number(scores[0].toFixed(6)),
    median: Number(scores[Math.floor(sampleSize / 2)].toFixed(6)),
    max: Number(scores[sampleSize - 1].toFixed(6)),
    table
  }, null, 2) + '\n');
  console.log(`Saved ${table.length} quantile thresholds to ${outputPath}.`);

  const abilityPath = path.join(sharedDir, 'ability.js');
  const source = fs.readFileSync(abilityPath, 'utf8');
  const modelRe = /const MODEL = \{[^\n]*?\};/;
  const tableRe = /const TABLE = \[[^\n]*?\];/;
  assert.ok(modelRe.test(source), 'Failed to locate MODEL declaration in shared/ability.js');
  assert.ok(tableRe.test(source), 'Failed to locate TABLE declaration in shared/ability.js');
  const updated = source
    .replace(modelRe, 'const MODEL = ' + JSON.stringify(inlineModel) + ';')
    .replace(tableRe, 'const TABLE = ' + JSON.stringify(table) + ';');
  fs.writeFileSync(abilityPath, updated);
  console.log(`Updated inline MODEL and TABLE in ${abilityPath}.`);
}

if (require.main === module) main();
module.exports = { ubuFeatures, fitFromCorpus };
