#!/usr/bin/env node
'use strict';
/**
 * Multi-threaded binary training shard generator for Ububall Neural CPU (Path 1).
 *
 * Spawns lock-free worker_threads across all CPU cores (e.g. 32 threads on i9-14900K) to play
 * mixed Standard / Pulse / Classic matches between strong search teachers + exploratory noise,
 * writing fixed 216-float (864-byte) little-endian Float32 rows to `personal/nn-shards/`:
 *   [0..195]   196 team-canonical observation floats
 *   [196..213]  18 teacher move targets (3 role-ordered skaters x [cosA, sinA, power, spin, super, guard])
 *   [214]        1 next-goal round label (+1 own team scores next, -1 opponent scores next, 0 turn cap)
 *   [215]        1 turnsUntilGoal (0 on scoring turn, k turns before round ends)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const C = require('../shared/ububall-cpu.js');
const U = require('../shared/ubu.js');
const NN = require('../shared/cpu/nn.js');
const { syncSlidesFromBodies, strikeAccess, coneCover } = require('../shared/cpu/evaluate.js');

const KICKOFF_POS = Object.freeze([
  { x: 180, y: 300 }, { x: 310, y: 180 }, { x: 310, y: 420 },
  { x: 820, y: 300 }, { x: 690, y: 180 }, { x: 690, y: 420 },
  { x: 500, y: 300 }
]);
const RESOLVE_OPTS = Object.freeze({ effects: false, fastSearch: true, fastTick: true });

const TEACHER_PRESETS = Object.freeze({
  fast: Object.freeze({ level: 'medium', candidates: 36, opponents: 2, searchTicks: 340, wobble: true, nn: false }),
  balanced: Object.freeze({ level: 'hard', candidates: 68, opponents: 3, searchTicks: 460, wobble: true, nn: false }),
  strong: Object.freeze({ level: 'insane', candidates: 120, opponents: 4, searchTicks: 540, wobble: true, nn: false }),
  god: Object.freeze({ level: 'god', candidates: 200, opponents: 4, searchTicks: 680, wobble: true, nn: false })
});

function makeMatchState(seed, mode) {
  const random = C.randomSource(seed);
  const bodies = P.kickoff();
  const stats = [];
  const classic = M.rule(mode, 'classic');
  for (let i = 0; i < 6; i++) {
    const b = bodies[i];
    const model = U.decode(Uint8Array.from({ length: 128 }, () => Math.floor(random() * 256)));
    const raw = classic ? {} : model.stats;
    stats.push(raw);
    M.applyStats(P, b, raw, mode);
    b.personality = model.personality;
    const superId = model.supers[0] % 8;
    const mastery = classic ? null : P.superMastery(model.supers, superId);
    b.equippedSuper = classic ? null : { ...P.SUPERS[superId], ...mastery };
    b.superBonusTicks = mastery?.bonusTicks || 0;
    b.superBonusRefund = mastery?.bonusRefund || 0;
    b.meter = classic ? 0 : Math.min(100, (model.rating / 1020) * 100);
  }
  return { version: M.VERSION, mode, bodies, stats, scores: [0, 0], turn: 1, roundTurns: 0, phase: 'plan', winner: null, fouls: M.newFouls() };
}

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

function geomHintsFor(state, team) {
  syncSlidesFromBodies(state.bodies);
  const ball = state.bodies[6], ballR = ball.radius || 18;
  return {
    strikeOwn: strikeAccess(state.bodies, team, ball.x, ball.y, ballR),
    strikeOther: strikeAccess(state.bodies, 1 - team, ball.x, ball.y, ballR),
    coneOwn: coneCover(state.bodies, team, ball.x, ball.y, state.fouls),
    coneOther: coneCover(state.bodies, 1 - team, ball.x, ball.y, state.fouls)
  };
}

function maybePerturbPlans(plans, state, team, random, classic) {
  const out = plans.map(m => ({ ...m }));
  const ownStart = team * 3;
  for (let i = 0; i < 3; i++) {
    const b = state.bodies[ownStart + i];
    if (b.carded || b.stunned || out[i].guard || !out[i].power) continue;
    if (random() < 0.45) {
      out[i].angle = (((out[i].angle + (random() - 0.5) * 0.45) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      out[i].power = Math.max(0.05, Math.min(1, out[i].power + (random() - 0.5) * 0.30));
      out[i].spin = Math.max(-1, Math.min(1, (out[i].spin || 0) + (random() - 0.5) * 0.50));
      if (!classic && (b.meter ?? 0) >= 100 && b.equippedSuper && random() < 0.15) {
        out[i].superArm = !out[i].superArm;
      }
    }
  }
  return out;
}

function playAndRecordMatch(job, rowSink) {
  const { seed, mode, presetName, maxTurns } = job;
  const random = C.randomSource(seed ^ 0x9e3779b9);
  const teacherCfg = TEACHER_PRESETS[presetName] || TEACHER_PRESETS.balanced;
  const classic = M.rule(mode, 'classic');
  let state = makeMatchState(seed, mode);
  const history = [];
  const roundBuf = []; // Buffered rows until next goal or match end resolves nextGoal label
  const obsScratch0 = new Float32Array(NN.NN_INPUT_DIM);
  const obsScratch1 = new Float32Array(NN.NN_INPUT_DIM);
  const perm0 = [0, 1, 2], perm1 = [0, 1, 2];

  let turnsPlayed = 0, goalsScored = 0, rowsWritten = 0;

  function flushRound(goalTeam) {
    const n = roundBuf.length;
    for (let k = 0; k < n; k++) {
      const rec = roundBuf[k];
      const turnsToGoal = n - 1 - k;
      rec.row0[214] = goalTeam === null ? 0 : (goalTeam === 0 ? 1 : -1);
      rec.row0[215] = turnsToGoal;
      rec.row1[214] = goalTeam === null ? 0 : (goalTeam === 1 ? 1 : -1);
      rec.row1[215] = turnsToGoal;
      if (rec.keep0) { rowSink(rec.row0); rowsWritten++; }
      if (rec.keep1) { rowSink(rec.row1); rowsWritten++; }
    }
    roundBuf.length = 0;
  }

  while (state.winner === null && turnsPlayed < maxTurns) {
    // 20% of turns inject exploratory noise on one side so Value Net sees suboptimal positions & punishment
    const exploreSide = random() < 0.22 ? (random() < 0.5 ? 0 : 1) : -1;
    const seed0 = (seed * 131 + turnsPlayed * 17) >>> 0;
    const seed1 = (seed * 131 + turnsPlayed * 17 + 1) >>> 0;

    const dec0 = C.plan(state, 0, { ...teacherCfg, seed: seed0, ...(history.length ? { history } : {}) });
    const dec1 = C.plan(state, 1, { ...teacherCfg, seed: seed1, ...(history.length ? { history } : {}) });

    const hints0 = geomHintsFor(state, 0);
    const hints1 = geomHintsFor(state, 1);
    NN.encodeState(state, 0, hints0, obsScratch0, perm0);
    NN.encodeState(state, 1, hints1, obsScratch1, perm1);

    const row0 = new Float32Array(NN.NN_ROW_FLOATS);
    const row1 = new Float32Array(NN.NN_ROW_FLOATS);
    row0.set(obsScratch0, 0);
    row1.set(obsScratch1, 0);
    // Always record the unperturbed teacher plans as policy targets even if execution adds exploration
    NN.encodePlans(dec0.plans, 0, perm0, row0, NN.NN_INPUT_DIM);
    NN.encodePlans(dec1.plans, 1, perm1, row1, NN.NN_INPUT_DIM);

    const exec0 = exploreSide === 0 ? maybePerturbPlans(dec0.plans, state, 0, random, classic) : dec0.plans;
    const exec1 = exploreSide === 1 ? maybePerturbPlans(dec1.plans, state, 1, random, classic) : dec1.plans;

    roundBuf.push({ row0, row1, keep0: true, keep1: true });

    const allMoves = [...exec0, ...exec1];
    history.push({
      roundTurns: state.roundTurns || 0,
      bodies: state.bodies.map(b => ({ x: b.x, y: b.y, meter: b.meter, stunned: b.stunned, carded: b.carded })),
      plans: allMoves
    });
    if (history.length > 24) history.shift();

    const result = M.resolveTurn(P, state, allMoves, RESOLVE_OPTS);
    state = result.state;
    turnsPlayed++;

    if (result.replay.goal !== null) {
      goalsScored++;
      flushRound(result.replay.goal);
      if (state.phase === 'goal') resetKickoff(state);
    }
  }
  if (roundBuf.length > 0) flushRound(null);
  return { turnsPlayed, goalsScored, rowsWritten };
}

if (!isMainThread && workerData && workerData.sharedCtrl) {
  const { workerId, sharedCtrl, jobs, shardPath } = workerData;
  const ctrl = new Int32Array(sharedCtrl);
  const fd = fs.openSync(shardPath, 'w');
  const CHUNK_ROWS = 512;
  const chunkBuf = new Float32Array(CHUNK_ROWS * NN.NN_ROW_FLOATS);
  let buffered = 0, totalRows = 0, totalTurns = 0, totalGoals = 0, matchesDone = 0;

  const flushDisk = () => {
    if (buffered === 0) return;
    const byteLen = buffered * NN.NN_ROW_FLOATS * 4;
    fs.writeSync(fd, Buffer.from(chunkBuf.buffer, 0, byteLen));
    buffered = 0;
  };
  const sink = row => {
    chunkBuf.set(row, buffered * NN.NN_ROW_FLOATS);
    buffered++;
    totalRows++;
    if (buffered >= CHUNK_ROWS) flushDisk();
  };

  for (;;) {
    const idx = Atomics.add(ctrl, 0, 1);
    if (idx >= jobs.length) break;
    const stats = playAndRecordMatch(jobs[idx], sink);
    totalTurns += stats.turnsPlayed;
    totalGoals += stats.goalsScored;
    matchesDone++;
    Atomics.add(ctrl, 1, 1);
    Atomics.add(ctrl, 2, stats.turnsPlayed);
  }
  flushDisk();
  fs.closeSync(fd);
  parentPort.postMessage({ workerId, shardPath, matchesDone, totalTurns, totalGoals, totalRows });
  return;
}

function parseCli(argv) {
  const opts = {
    matches: 400,
    turns: 70,
    seed: 1001,
    mode: 'mixed',
    preset: 'balanced',
    threads: Math.max(1, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length),
    out: path.resolve(__dirname, '../personal/nn-shards')
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--quick') { opts.matches = 32; opts.preset = 'fast'; continue; }
    if (arg === '--deep') { opts.matches = 4000; opts.preset = 'strong'; continue; }
    const val = argv[++i];
    if (val === undefined) throw new Error(`Missing value for ${arg}`);
    if (arg === '--matches') opts.matches = Number(val);
    else if (arg === '--turns') opts.turns = Number(val);
    else if (arg === '--seed') opts.seed = Number(val);
    else if (arg === '--mode') opts.mode = val;
    else if (arg === '--preset') opts.preset = val;
    else if (arg === '--threads') opts.threads = Number(val);
    else if (arg === '--out') opts.out = path.resolve(val);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(opts.matches) || opts.matches < 1 || !Number.isInteger(opts.turns) || opts.turns < 5) {
    throw new Error('Invalid --matches or --turns.');
  }
  return opts;
}

function pickMode(modeArg, idx) {
  if (modeArg !== 'mixed') return modeArg;
  const r = idx % 20;
  if (r < 11) return 'standard';
  if (r < 17) return 'pulse';
  return 'classic';
}

function pickPreset(presetArg, idx) {
  if (presetArg !== 'mixed') return presetArg;
  const r = idx % 10;
  if (r < 5) return 'balanced';
  if (r < 9) return 'strong';
  return 'god';
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  fs.mkdirSync(opts.out, { recursive: true });
  for (const existing of fs.readdirSync(opts.out)) {
    if (existing.endsWith('.bin')) fs.unlinkSync(path.join(opts.out, existing));
  }

  const jobs = Array.from({ length: opts.matches }, (_, i) => ({
    seed: opts.seed + i,
    mode: pickMode(opts.mode, i),
    presetName: pickPreset(opts.preset, i),
    maxTurns: opts.turns
  }));

  const workerCount = Math.min(opts.threads, jobs.length);
  const sharedCtrl = new SharedArrayBuffer(16);
  const ctrl = new Int32Array(sharedCtrl);
  const started = performance.now();

  console.error(`[nn-generate] Running ${jobs.length} matches across ${workerCount} threads -> ${opts.out}`);

  const progressTimer = setInterval(() => {
    const done = Atomics.load(ctrl, 1);
    const turns = Atomics.load(ctrl, 2);
    const sec = Math.max(0.001, (performance.now() - started) / 1000);
    console.error(`  ${done}/${jobs.length} matches | ${turns} turns (${(turns / sec).toFixed(0)} turns/s)`);
  }, 2500);
  progressTimer.unref();

  const summaries = await Promise.all(Array.from({ length: workerCount }, (_, w) => new Promise((resolve, reject) => {
    const shardPath = path.join(opts.out, `shard_${String(w).padStart(2, '0')}.bin`);
    const worker = new Worker(__filename, {
      workerData: { workerId: w, sharedCtrl, jobs, shardPath }
    });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', code => { if (code !== 0) reject(new Error(`Worker ${w} exited with ${code}`)); });
  })));
  clearInterval(progressTimer);

  const elapsedSec = (performance.now() - started) / 1000;
  const shards = summaries
    .filter(s => s.totalRows > 0)
    .map(s => ({ file: path.basename(s.shardPath), rows: s.totalRows, matches: s.matchesDone, goals: s.totalGoals }));
  for (const s of summaries) {
    if (s.totalRows === 0 && fs.existsSync(s.shardPath)) fs.unlinkSync(s.shardPath);
  }
  const totalRows = shards.reduce((a, s) => a + s.rows, 0);
  const totalTurns = summaries.reduce((a, s) => a + s.totalTurns, 0);
  const totalGoals = shards.reduce((a, s) => a + s.goals, 0);

  const manifest = {
    format: NN.NN_FORMAT,
    physVersion: P.VERSION,
    rowFloats: NN.NN_ROW_FLOATS,
    inputDim: NN.NN_INPUT_DIM,
    policyDim: NN.NN_POLICY_DIM,
    matches: jobs.length,
    totalTurns,
    totalGoals,
    totalRows,
    mode: opts.mode,
    preset: opts.preset,
    seed: opts.seed,
    elapsedSeconds: Number(elapsedSec.toFixed(2)),
    turnsPerSecond: Number((totalTurns / Math.max(0.001, elapsedSec)).toFixed(1)),
    shards
  };
  fs.writeFileSync(path.join(opts.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
}

if (isMainThread && require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { playAndRecordMatch, makeMatchState };
