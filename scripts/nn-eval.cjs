#!/usr/bin/env node
'use strict';
/**
 * Multi-threaded side-swapped head-to-head evaluator & hyperparameter sweep for Ububall Neural CPU.
 *
 * Plays side-swapped pairs (Ballistic vs God) with identical DNA rosters across all CPU cores to:
 *   1. Sweep `nnScale` and `nnWeight` on trained `.bin` weights without retraining.
 *   2. Gate new Standard / Pulse specialist weights before promoting them into `web/assets/`.
 *
 * Examples:
 *   node scripts/nn-eval.cjs --weights web/assets/ububall-net-standard.bin --mode standard-pack --pairs 24
 *   node scripts/nn-eval.cjs --weights web/assets/ububall-net-pulse.bin --mode pulse-pack --scales 900,1200,1600 --nn-weights 0.45,0.55,0.70 --preset balanced --pairs 16
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const C = require('../shared/ububall-cpu.js');
const NN = require('../shared/cpu/nn.js');
const { makeMatchState } = require('./nn-generate.cjs');

const KICKOFF_POS = Object.freeze([
  { x: 180, y: 300 }, { x: 310, y: 180 }, { x: 310, y: 420 },
  { x: 820, y: 300 }, { x: 690, y: 180 }, { x: 690, y: 420 },
  { x: 500, y: 300 }
]);
const RESOLVE_OPTS = Object.freeze({ effects: false, fastSearch: true, fastTick: false });

const EVAL_PRESETS = Object.freeze({
  fast: Object.freeze({ level: 'medium', candidates: 36, opponents: 2, searchTicks: 340, wobble: true }),
  balanced: Object.freeze({ level: 'hard', candidates: 68, opponents: 3, searchTicks: 460, wobble: true }),
  strong: Object.freeze({ level: 'insane', candidates: 120, opponents: 4, searchTicks: 540, wobble: true }),
  god: Object.freeze({ level: 'god' })
});

function resetKickoff(state) {
  for (let i = 0; i < state.bodies.length; i++) {
    const b = state.bodies[i];
    b.x = KICKOFF_POS[i].x; b.y = KICKOFF_POS[i].y;
    b.vx = b.vy = b.omega = 0;
    if (i < 6) {
      b.daze = 0;
      b.meterTick = -Infinity;
      b.guarding = false;
      b.ironGuard = false;
      b.ironCooldownTicks = 0;
      P.syncEffectiveStats(b);
    }
  }
  state.phase = 'plan';
}

function playSingleMatch({ seed, mode, maxTurns, nnTeam, nnModel, nnScale, nnWeight, presetName }) {
  const basePreset = EVAL_PRESETS[presetName] || EVAL_PRESETS.god;
  const godCfg = basePreset.level === 'god'
    ? { level: 'god', nn: false }
    : { ...basePreset, nn: false };
  const nnCfg = basePreset.level === 'god'
    ? { level: 'ballistic', nn: true, nnModel, nnScale, nnWeight, nnPolicy: true, nnOpponent: true }
    : { ...basePreset, nn: true, nnModel, nnScale, nnWeight, nnPolicy: true, nnOpponent: true };

  let state = makeMatchState(seed, mode);
  const history = [];
  let turns = 0;
  let nnMs = 0, godMs = 0;

  while (state.winner === null && turns < maxTurns) {
    const seed0 = (seed * 131 + turns * 17) >>> 0;
    const seed1 = (seed * 131 + turns * 17 + 1) >>> 0;
    const histOpt = history.length ? { history } : {};

    const cfg0 = nnTeam === 0 ? nnCfg : godCfg;
    const cfg1 = nnTeam === 1 ? nnCfg : godCfg;
    const dec0 = C.plan(state, 0, { ...cfg0, seed: seed0, ...histOpt });
    const dec1 = C.plan(state, 1, { ...cfg1, seed: seed1, ...histOpt });

    nnMs += (nnTeam === 0 ? dec0 : dec1).diagnostics.milliseconds || 0;
    godMs += (nnTeam === 0 ? dec1 : dec0).diagnostics.milliseconds || 0;

    const allMoves = [...dec0.plans, ...dec1.plans];
    history.push({
      roundTurns: state.roundTurns || 0,
      bodies: state.bodies.map(b => ({ x: b.x, y: b.y, meter: b.meter, stunned: b.stunned, carded: b.carded })),
      plans: allMoves
    });
    if (history.length > 24) history.shift();

    const result = M.resolveTurn(P, state, allMoves, RESOLVE_OPTS);
    state = result.state;
    turns++;
    if (result.replay.goal !== null && state.phase === 'goal') resetKickoff(state);
  }

  const nnGoals = state.scores[nnTeam];
  const godGoals = state.scores[1 - nnTeam];
  const outcome = nnGoals > godGoals ? 1 : nnGoals < godGoals ? -1 : 0;
  return { outcome, nnGoals, godGoals, turns, nnMs, godMs };
}

function playPair(job, nnModel) {
  const m0 = playSingleMatch({ ...job, nnTeam: 0, nnModel });
  const m1 = playSingleMatch({ ...job, nnTeam: 1, nnModel });
  return {
    comboKey: job.comboKey,
    mode: job.mode,
    nnScale: job.nnScale,
    nnWeight: job.nnWeight,
    wins: (m0.outcome === 1 ? 1 : 0) + (m1.outcome === 1 ? 1 : 0),
    draws: (m0.outcome === 0 ? 1 : 0) + (m1.outcome === 0 ? 1 : 0),
    losses: (m0.outcome === -1 ? 1 : 0) + (m1.outcome === -1 ? 1 : 0),
    nnGoals: m0.nnGoals + m1.nnGoals,
    godGoals: m0.godGoals + m1.godGoals,
    turns: m0.turns + m1.turns,
    nnMs: m0.nnMs + m1.nnMs,
    godMs: m0.godMs + m1.godMs
  };
}

if (!isMainThread && require.main === module && workerData && workerData.sharedCtrl) {
  const { sharedCtrl, jobs, weightsPath } = workerData;
  const nnModel = NN.parseWeights(fs.readFileSync(weightsPath));
  if (!nnModel) throw new Error(`Incompatible weights (physics version mismatch): ${weightsPath}`);
  const ctrl = new Int32Array(sharedCtrl);
  const results = [];
  for (;;) {
    const idx = Atomics.add(ctrl, 0, 1);
    if (idx >= jobs.length) break;
    const res = playPair(jobs[idx], nnModel);
    results.push(res);
    Atomics.add(ctrl, 1, 1);
    Atomics.add(ctrl, 2, res.turns);
  }
  parentPort.postMessage(results);
  return;
}

function resolveModes(modeArg) {
  if (modeArg === 'standard-pack') return ['standard', 'classic'];
  if (modeArg === 'pulse-pack') return ['pulse', 'classic-pulse'];
  if (modeArg === 'all') return ['standard', 'classic', 'pulse', 'classic-pulse'];
  if (!M.MODES.includes(modeArg)) throw new Error(`Unknown --mode: ${modeArg}`);
  return [modeArg];
}

function parseNumberList(raw, flag) {
  const list = raw.split(',').map(s => Number(s.trim()));
  if (!list.length || list.some(n => !Number.isFinite(n) || n < 0)) {
    throw new Error(`Invalid number list for ${flag}: ${raw}`);
  }
  return list;
}

function parseCli(argv) {
  const root = path.resolve(__dirname, '..');
  const opts = {
    weights: null,
    mode: 'standard',
    pairs: 20,
    turns: null,
    preset: 'god',
    scales: [1200],
    nnWeights: [C.LEVELS.ballistic.nnWeight],
    seed: 7001,
    threads: Math.max(1, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length),
    out: null
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const val = argv[++i];
    if (val === undefined) throw new Error(`Missing value for ${arg}`);
    if (arg === '--weights') opts.weights = path.resolve(val);
    else if (arg === '--mode') opts.mode = val;
    else if (arg === '--pairs') opts.pairs = Number(val);
    else if (arg === '--turns') opts.turns = Number(val);
    else if (arg === '--preset') opts.preset = val;
    else if (arg === '--scales') opts.scales = parseNumberList(val, '--scales');
    else if (arg === '--nn-weights') opts.nnWeights = parseNumberList(val, '--nn-weights');
    else if (arg === '--seed') opts.seed = Number(val);
    else if (arg === '--threads') opts.threads = Number(val);
    else if (arg === '--out') opts.out = path.resolve(val);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(opts.pairs) || opts.pairs < 1) throw new Error('Invalid --pairs.');
  if (opts.turns !== null && (!Number.isInteger(opts.turns) || opts.turns < 5)) throw new Error('Invalid --turns.');
  if (!Object.hasOwn(EVAL_PRESETS, opts.preset)) throw new Error(`Invalid --preset: ${opts.preset}`);
  if (opts.nnWeights.some(w => w > 1)) throw new Error('--nn-weights values must be in [0, 1].');

  if (!opts.weights) {
    const isPulse = opts.mode.includes('pulse');
    const specialist = path.join(root, 'web', 'assets', isPulse ? 'ububall-net-pulse.bin' : 'ububall-net-standard.bin');
    const general = path.join(root, 'web', 'assets', 'ububall-net.bin');
    opts.weights = fs.existsSync(specialist) ? specialist : general;
  }
  return opts;
}

function summarizeGroup(rows) {
  let wins = 0, draws = 0, losses = 0, nnGoals = 0, godGoals = 0, turns = 0, nnMs = 0, godMs = 0;
  for (const r of rows) {
    wins += r.wins; draws += r.draws; losses += r.losses;
    nnGoals += r.nnGoals; godGoals += r.godGoals;
    turns += r.turns; nnMs += r.nnMs; godMs += r.godMs;
  }
  const matches = wins + draws + losses;
  const score = matches > 0 ? (wins + 0.5 * draws) / matches : 0.5;
  const clamped = Math.max(0.005, Math.min(0.995, score));
  const elo = Math.round(400 * Math.log10(clamped / (1 - clamped)));
  const decided = wins + losses;
  const z = decided > 0 ? (wins - 0.5 * decided) / Math.sqrt(0.25 * decided) : 0;
  return {
    matches, wins, draws, losses,
    scorePct: Number((score * 100).toFixed(1)),
    elo,
    zScore: Number(z.toFixed(2)),
    nnGoals, godGoals,
    goalDiff: nnGoals - godGoals,
    nnMsPerTurn: Number((nnMs / Math.max(1, turns)).toFixed(2)),
    godMsPerTurn: Number((godMs / Math.max(1, turns)).toFixed(2))
  };
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  if (!fs.existsSync(opts.weights)) {
    throw new Error(`Weights file not found: ${opts.weights}`);
  }
  const parsed = NN.parseWeights(fs.readFileSync(opts.weights));
  if (!parsed) throw new Error(`Incompatible weights (physics version mismatch): ${opts.weights}`);

  const modes = resolveModes(opts.mode);
  const jobs = [];
  for (const nnScale of opts.scales) {
    for (const nnWeight of opts.nnWeights) {
      const comboKey = `scale=${nnScale},weight=${nnWeight}`;
      for (let p = 0; p < opts.pairs; p++) {
        const mode = modes[p % modes.length];
        const maxTurns = opts.turns ?? (M.rule(mode, 'pulse') ? 180 : 70);
        jobs.push({
          comboKey,
          seed: opts.seed + p,
          mode,
          maxTurns,
          nnScale,
          nnWeight,
          presetName: opts.preset
        });
      }
    }
  }

  const workerCount = Math.min(opts.threads, jobs.length);
  const sharedCtrl = new SharedArrayBuffer(16);
  const ctrl = new Int32Array(sharedCtrl);
  const started = performance.now();

  console.error(
    `[nn-eval] ${jobs.length} side-swapped pairs (${jobs.length * 2} matches) · preset=${opts.preset} · ` +
    `modes=[${modes.join(',')}] · weights=${path.basename(opts.weights)} (H=${parsed.H}) · ${workerCount} threads`
  );

  const progressTimer = setInterval(() => {
    const done = Atomics.load(ctrl, 1);
    const turns = Atomics.load(ctrl, 2);
    const sec = Math.max(0.001, (performance.now() - started) / 1000);
    console.error(`  ${done}/${jobs.length} pairs | ${turns} turns (${(turns / sec).toFixed(0)} turns/s)`);
  }, 2500);
  progressTimer.unref();

  const batches = await Promise.all(Array.from({ length: workerCount }, (_, w) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { sharedCtrl, jobs, weightsPath: opts.weights }
    });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', code => { if (code !== 0) reject(new Error(`Worker ${w} exited with ${code}`)); });
  })));
  clearInterval(progressTimer);

  const allResults = batches.flat();
  const elapsedSec = Number(((performance.now() - started) / 1000).toFixed(2));
  const byCombo = new Map();
  for (const r of allResults) {
    if (!byCombo.has(r.comboKey)) byCombo.set(r.comboKey, []);
    byCombo.get(r.comboKey).push(r);
  }

  const table = [];
  for (const [comboKey, rows] of byCombo.entries()) {
    const overall = summarizeGroup(rows);
    const byMode = {};
    for (const m of modes) {
      const mRows = rows.filter(r => r.mode === m);
      if (mRows.length) byMode[m] = summarizeGroup(mRows);
    }
    table.push({
      nnScale: rows[0].nnScale,
      nnWeight: rows[0].nnWeight,
      comboKey,
      ...overall,
      byMode
    });
  }
  table.sort((a, b) => b.scorePct - a.scorePct || b.goalDiff - a.goalDiff);

  console.error('');
  console.error('nnScale  nnWeight  W-D-L       Score%   Elo    z     Goals(NN-God)  ms/turn(NN vs God)');
  console.error('-------  --------  ----------  ------  ----  -----  -------------  ------------------');
  for (const row of table) {
    const wdl = `${row.wins}-${row.draws}-${row.losses}`.padEnd(10);
    const goals = `${row.nnGoals}-${row.godGoals} (${row.goalDiff >= 0 ? '+' : ''}${row.goalDiff})`.padEnd(13);
    const eloStr = `${row.elo >= 0 ? '+' : ''}${row.elo}`.padStart(4);
    const zStr = `${row.zScore >= 0 ? '+' : ''}${row.zScore.toFixed(2)}`.padStart(5);
    console.error(
      `${String(row.nnScale).padStart(7)}  ${row.nnWeight.toFixed(2).padStart(8)}  ${wdl}  ` +
      `${row.scorePct.toFixed(1).padStart(5)}%  ${eloStr}  ${zStr}  ${goals}  ` +
      `${row.nnMsPerTurn.toFixed(1)} vs ${row.godMsPerTurn.toFixed(1)}`
    );
  }

  const report = {
    weights: path.basename(opts.weights),
    hiddenDim: parsed.H,
    physVersion: parsed.physVersion,
    preset: opts.preset,
    modes,
    pairsPerConfig: opts.pairs,
    elapsedSeconds: elapsedSec,
    results: table
  };
  if (opts.out) {
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
}

if (isMainThread && require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { playSingleMatch, playPair, summarizeGroup };
