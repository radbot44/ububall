'use strict';
// Comprehensive CPU-vs-CPU Ability Benchmark Suite for calibrating the 15 core Ubu stats.
//
// Experimental designs (--suite):
//   corpus:       Random 15-stat teams (50% standard, 50% pulse), side-swapped pairs, mirrored
//                 non-stat context (active DNA personality, 4-slot supers + mastery, Ubuquity meter)
//                 for maximum signal-to-noise on the 15 core stats.
//   curves:       Single-ubu focal 5-point sweep (0, 64, 127, 191, 255) across all 15 stats,
//                 rotating focal kickoff slot (0 anchor, 1/2 wings), 50/50 standard & pulse.
//   interactions: Physics-coupled 2D stat grids (size×reach, impulse×power, mass×stability,
//                 spin×curve, efficiency×synergy, size×mass) on focal skaters.
//   wild:         Out-of-sample validation matches using completely independent 128-byte wild DNAs
//                 (unmirrored supers, personalities, Ubuquity) to verify real-match win prediction.
//   full:         Interleaves curves + interactions + corpus + wild into a unified resumable JSONL
//                 dataset so even partial checkpoints cover all 15 stats and modes evenly.
//
// Designed for hybrid high-core CPUs (e.g. i9-14900K 8P+16E / 32 threads): lock-free SharedArrayBuffer
// + Atomics single-pair work stealing, zero-IPC atomic turn/game telemetry, worker-parallel JSONL
// serialization, unboxed TypedArray fastTick search rollouts, and append-only JSONL (--resume).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const C = require('../shared/ububall-cpu.js');

const STATS = Object.freeze([
  'impulse', 'traction', 'spin', 'curve',
  'size', 'mass', 'bounciness', 'grip',
  'power', 'reach', 'strength', 'stability',
  'efficiency', 'synergy', 'chemistry'
]);

const PRESETS = Object.freeze({
  fast: Object.freeze({
    level: 'easy', candidates: 20, opponents: 1,
    risk: 0.25, temperature: 10, wobble: false, fastTick: true, searchTicks: 220
  }),
  balanced: Object.freeze({
    level: 'medium', candidates: 30, opponents: 2, screenTop: 3,
    risk: 0.35, temperature: 10, wobble: false, fastTick: true, searchTicks: 240
  }),
  deep: Object.freeze({
    level: 'medium', candidates: 56, opponents: 2, screenTop: 8,
    risk: 0.35, temperature: 12, wobble: false, fastTick: true, searchTicks: 320
  }),
  hard: Object.freeze({
    level: 'hard', candidates: 96, opponents: 3, screenTop: 8,
    risk: 0.45, temperature: 12, wobble: true, fastTick: true, searchTicks: 400
  })
});

const SCALE_TIERS = Object.freeze({
  quick: Object.freeze({ pairs: 600, curvePairs: 8, interPairs: 5, wildPairs: 120 }),
  standard: Object.freeze({ pairs: 2000, curvePairs: 24, interPairs: 12, wildPairs: 300 }),
  deep: Object.freeze({ pairs: 6000, curvePairs: 60, interPairs: 30, wildPairs: 900 })
});

// Empirical super tier tie-breaker when equipping the highest-mastery unlocked super from 4 DNA slots.
const SUPER_PRIORITY = Object.freeze([3, 5, 4, 2, 6, 1, 7, 0]); // cannonball, colossus, magnet, sticky, shockwave, knockout, ghost, stalwart

function pickEquippedSuper(superSlots) {
  let bestId = superSlots[0] % 8;
  let bestCopies = 0;
  let bestRank = 99;
  for (let i = 0; i < superSlots.length; i++) {
    const id = superSlots[i] % 8;
    let copies = 0;
    for (let j = 0; j < superSlots.length; j++) if ((superSlots[j] % 8) === id) copies++;
    const rank = SUPER_PRIORITY.indexOf(id);
    if (copies > bestCopies || (copies === bestCopies && rank < bestRank)) {
      bestCopies = copies;
      bestRank = rank;
      bestId = id;
    }
  }
  const mastery = P.superMastery(superSlots, bestId);
  return { superId: bestId, equippedSuper: { ...P.SUPERS[bestId], ...mastery }, mastery };
}

function rollContextSlot(random) {
  const superSlots = [
    Math.floor(random() * 16),
    Math.floor(random() * 16),
    Math.floor(random() * 16),
    Math.floor(random() * 16)
  ];
  const rating = Math.floor(random() * 1024);
  const { superId, equippedSuper, mastery } = pickEquippedSuper(superSlots);
  return {
    superSlots,
    superId,
    equippedSuper,
    bonusTicks: mastery.bonusTicks || 0,
    bonusRefund: mastery.bonusRefund || 0,
    rating,
    meter: Math.min(100, rating / 1020 * 100),
    personality: {
      aggression: Math.floor(random() * 64),
      creativity: Math.floor(random() * 64),
      teamwork: Math.floor(random() * 64),
      clutch: Math.floor(random() * 64)
    }
  };
}

const KICKOFF_POS = Object.freeze([
  { x: 180, y: 300 }, { x: 310, y: 180 }, { x: 310, y: 420 },
  { x: 820, y: 300 }, { x: 690, y: 180 }, { x: 690, y: 420 },
  { x: 500, y: 300 }
]);

function kickoffReset(state) {
  for (let i = 0; i < 7; i++) {
    const b = state.bodies[i];
    b.x = KICKOFF_POS[i].x;
    b.y = KICKOFF_POS[i].y;
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

const RESOLVE_OPTS = Object.freeze({ effects: false });

// Plays one match (one side orientation) and returns scores, ticks, turns, territorial tiebreak, and per-ubu tallies.
function playSingleMatch({ teams, contexts, mode, seed, swapped, cpuConfig, maxTurns, onProgress = null }) {
  const bodies = P.kickoff();
  const stats = [];
  const teamOrder = swapped ? [teams[1], teams[0]] : teams;
  const ctxOrder = swapped ? [contexts[1], contexts[0]] : contexts;

  for (let i = 0; i < 6; i++) {
    const b = bodies[i];
    const sideIdx = i < 3 ? 0 : 1;
    const slotIdx = i % 3;
    const raw = teamOrder[sideIdx][slotIdx];
    const ctx = ctxOrder[sideIdx][slotIdx];
    stats.push(raw);
    M.applyStats(P, b, raw, mode);
    b.openingShot = false;
    b.meter = ctx.meter;
    b.meterTick = -Infinity;
    b.superArm = false;
    b.superBonusTicks = ctx.bonusTicks;
    b.superBonusRefund = ctx.bonusRefund;
    b.equippedSuper = { ...ctx.equippedSuper };
    b.personality = { ...ctx.personality };
  }

  let state = {
    version: M.VERSION,
    mode,
    bodies,
    stats,
    scores: [0, 0],
    turn: 1,
    phase: 'plan',
    winner: null,
    tally: M.newTally()
  };

  const planCfg0 = { ...cpuConfig, seed: 0 };
  const planCfg1 = { ...cpuConfig, seed: 0 };
  const moveBuf = new Array(6);

  let turns = 0;
  let unreportedTurns = 0;
  let ballXSum = 0;
  while (state.winner === null && turns < maxTurns) {
    const baseTurnSeed = Math.imul(seed, 2654435761) + turns * 97;
    planCfg0.seed = (baseTurnSeed + (swapped ? 1 : 0)) >>> 0;
    planCfg1.seed = (baseTurnSeed + (swapped ? 0 : 1)) >>> 0;
    const p0 = C.plan(state, 0, planCfg0).plans;
    const p1 = C.plan(state, 1, planCfg1).plans;
    moveBuf[0] = p0[0]; moveBuf[1] = p0[1]; moveBuf[2] = p0[2];
    moveBuf[3] = p1[0]; moveBuf[4] = p1[1]; moveBuf[5] = p1[2];
    state = M.resolveTurn(P, state, moveBuf, RESOLVE_OPTS).state;
    turns++;
    unreportedTurns++;
    ballXSum += (state.bodies[6].x - 500);
    if (state.phase === 'goal') kickoffReset(state);
    if (onProgress && unreportedTurns >= 8) {
      onProgress(unreportedTurns, 0);
      unreportedTurns = 0;
    }
  }
  if (onProgress) onProgress(unreportedTurns, 1);

  const [aGoals, bGoals] = swapped ? [state.scores[1], state.scores[0]] : state.scores;
  const winner = state.winner === null ? null : (state.winner === (swapped ? 1 : 0) ? 1 : -1);
  const t = state.tally || M.newTally();
  const mapSix = arr => swapped ? [arr[3], arr[4], arr[5], arr[0], arr[1], arr[2]] : [...arr];
  const territory = (swapped ? -1 : 1) * (ballXSum / Math.max(1, turns)) / 440;

  return {
    aGoals,
    bGoals,
    diff: aGoals - bGoals,
    winner: winner ?? 0,
    capped: state.winner === null,
    turns,
    ticks: state.clock || 0,
    territory,
    tally: {
      goals: mapSix(t.goals),
      assists: mapSix(t.assists),
      saves: mapSix(t.saves),
      bigSaves: mapSix(t.bigSaves),
      shots: mapSix(t.shots),
      checks: mapSix(t.checks),
      cards: mapSix(t.cards)
    }
  };
}

// Plays a side-swapped pair (swapped=false and swapped=true) and aggregates exact symmetric outcomes.
function runPairJob(job, onProgress = null) {
  const { id, kind, tag, mode, seed, teams, mirrorContext, cpuConfig, maxTurns } = job;
  const rng = C.randomSource(seed ^ 0x9e3779b9);
  const ctxA = [rollContextSlot(rng), rollContextSlot(rng), rollContextSlot(rng)];
  const ctxB = mirrorContext
    ? ctxA.map(c => ({
        ...c,
        superSlots: [...c.superSlots],
        equippedSuper: { ...c.equippedSuper },
        personality: { ...c.personality }
      }))
    : [rollContextSlot(rng), rollContextSlot(rng), rollContextSlot(rng)];

  const m0 = playSingleMatch({ teams, contexts: [ctxA, ctxB], mode, seed, swapped: false, cpuConfig, maxTurns, onProgress });
  const m1 = playSingleMatch({ teams, contexts: [ctxA, ctxB], mode, seed, swapped: true, cpuConfig, maxTurns, onProgress });

  const goalDiff = (m0.diff + m1.diff) / 2;
  const winDiff = (m0.winner + m1.winner) / 2;
  const totalTicks = m0.ticks + m1.ticks;
  const totalTurns = m0.turns + m1.turns;
  const cappedCount = Number(m0.capped) + Number(m1.capped);
  const territory = (m0.territory + m1.territory) / 2;
  const rawRate = totalTicks > 0 ? ((m0.diff + m1.diff) / totalTicks) * 7200 : 0;
  const goalRate30s = Math.max(-10, Math.min(10, rawRate));

  const sumSix = key => m0.tally[key].map((v, i) => v + m1.tally[key][i]);
  const encodeTeam = team => team.map(u => STATS.map(s => u[s]));

  const out = {
    id,
    physicsVersion: P.VERSION,
    kind,
    mode,
    seed,
    teams: [encodeTeam(teams[0]), encodeTeam(teams[1])],
    goalDiff: Number(goalDiff.toFixed(4)),
    goalRate30s: Number(goalRate30s.toFixed(5)),
    winDiff: Number(winDiff.toFixed(4)),
    territory: Number(territory.toFixed(5)),
    turns: totalTurns,
    ticks: totalTicks,
    capped: cappedCount,
    tally: {
      goals: sumSix('goals'),
      assists: sumSix('assists'),
      saves: sumSix('saves'),
      bigSaves: sumSix('bigSaves'),
      shots: sumSix('shots'),
      checks: sumSix('checks'),
      cards: sumSix('cards')
    }
  };
  if (tag) out.tag = tag;
  if (!mirrorContext) {
    out.ratings = [ctxA.map(c => c.rating), ctxB.map(c => c.rating)];
    out.supers = [ctxA.map(c => [c.superId, c.equippedSuper.level]), ctxB.map(c => [c.superId, c.equippedSuper.level])];
  }
  return out;
}

const neutralStats = () => Object.fromEntries(STATS.map(s => [s, 127]));
const randomStats = rng => Object.fromEntries(STATS.map(s => [s, Math.floor(rng() * 256)]));

// Interleaves job buckets deterministically using Bresenham-style proportional scheduling.
function interleaveBuckets(buckets) {
  const nonEmpty = buckets.filter(b => b.length > 0);
  if (nonEmpty.length <= 1) return nonEmpty[0] || [];
  const total = nonEmpty.reduce((s, b) => s + b.length, 0);
  const cursors = new Array(nonEmpty.length).fill(0);
  const out = [];
  for (let step = 0; step < total; step++) {
    let bestIdx = -1;
    let bestDeficit = -Infinity;
    for (let b = 0; b < nonEmpty.length; b++) {
      if (cursors[b] >= nonEmpty[b].length) continue;
      const target = ((step + 1) * nonEmpty[b].length) / total;
      const deficit = target - cursors[b];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        bestIdx = b;
      }
    }
    out.push(nonEmpty[bestIdx][cursors[bestIdx]++]);
  }
  return out;
}

function buildJobs({ suite, pairs, curvePairs, interPairs, wildPairs, seed, cpuConfig, stdTurns, pulseTurns }) {
  const modeAt = idx => (idx % 2 === 0 ? 'standard' : 'pulse');
  const turnsFor = mode => (mode === 'pulse' ? pulseTurns : stdTurns);

  const curveBucket = [];
  const interBucket = [];
  const corpusBucket = [];
  const wildBucket = [];

  if (suite === 'curves' || suite === 'full') {
    const knots = [0, 64, 191, 255];
    for (let p = 0; p < curvePairs; p++) {
      const mode = modeAt(p);
      const slot = p % 3;
      const baseSeed = seed + 100000 + p;
      for (const stat of STATS) {
        for (const value of knots) {
          const bgRng = C.randomSource(baseSeed ^ 0x517cc1b7);
          const bgTeam = [randomStats(bgRng), randomStats(bgRng), randomStats(bgRng)];
          const teamA = bgTeam.map(u => ({ ...u }));
          const teamB = bgTeam.map(u => ({ ...u }));
          teamA[slot] = { ...neutralStats(), [stat]: value };
          teamB[slot] = neutralStats();
          curveBucket.push({
            id: `curve:${stat}:${value}:${p}`,
            kind: 'curve',
            tag: { stat, value, slot },
            mode,
            seed: baseSeed,
            teams: [teamA, teamB],
            mirrorContext: true,
            cpuConfig,
            maxTurns: turnsFor(mode)
          });
        }
      }
    }
  }

  if (suite === 'interactions' || suite === 'full') {
    const pairs2D = [
      ['size', 'reach'],
      ['impulse', 'power'],
      ['mass', 'stability'],
      ['spin', 'curve'],
      ['efficiency', 'synergy'],
      ['size', 'mass']
    ];
    const gridVals = [24, 127, 232];
    for (let p = 0; p < interPairs; p++) {
      const mode = modeAt(p);
      const slot = p % 3;
      const baseSeed = seed + 300000 + p;
      for (const [s1, s2] of pairs2D) {
        for (const v1 of gridVals) {
          for (const v2 of gridVals) {
            if (v1 === 127 && v2 === 127) continue;
            const bgRng = C.randomSource(baseSeed ^ 0x85ebca6b);
            const bgTeam = [randomStats(bgRng), randomStats(bgRng), randomStats(bgRng)];
            const teamA = bgTeam.map(u => ({ ...u }));
            const teamB = bgTeam.map(u => ({ ...u }));
            teamA[slot] = { ...neutralStats(), [s1]: v1, [s2]: v2 };
            teamB[slot] = neutralStats();
            interBucket.push({
              id: `inter:${s1}_${s2}:${v1}_${v2}:${p}`,
              kind: 'interaction',
              tag: { s1, s2, v1, v2, slot },
              mode,
              seed: baseSeed,
              teams: [teamA, teamB],
              mirrorContext: true,
              cpuConfig,
              maxTurns: turnsFor(mode)
            });
          }
        }
      }
    }
  }

  if (suite === 'corpus' || suite === 'full') {
    for (let p = 0; p < pairs; p++) {
      const mode = modeAt(p);
      const pairSeed = seed + 500000 + p;
      const rng = C.randomSource(pairSeed ^ 0xc2b2ae35);
      const teamA = [randomStats(rng), randomStats(rng), randomStats(rng)];
      const teamB = [randomStats(rng), randomStats(rng), randomStats(rng)];
      corpusBucket.push({
        id: `corpus:${p}`,
        kind: 'corpus',
        mode,
        seed: pairSeed,
        teams: [teamA, teamB],
        mirrorContext: true,
        cpuConfig,
        maxTurns: turnsFor(mode)
      });
    }
  }

  if (suite === 'wild' || suite === 'full') {
    for (let p = 0; p < wildPairs; p++) {
      const mode = modeAt(p);
      const pairSeed = seed + 900000 + p;
      const rng = C.randomSource(pairSeed ^ 0x27d4eb2f);
      const teamA = [randomStats(rng), randomStats(rng), randomStats(rng)];
      const teamB = [randomStats(rng), randomStats(rng), randomStats(rng)];
      wildBucket.push({
        id: `wild:${p}`,
        kind: 'wild',
        mode,
        seed: pairSeed,
        teams: [teamA, teamB],
        mirrorContext: false,
        cpuConfig,
        maxTurns: turnsFor(mode)
      });
    }
  }

  return interleaveBuckets([corpusBucket, curveBucket, interBucket, wildBucket]);
}

// --- Worker Thread Entry Point (Lock-Free Atomic Work Stealing) ---
if (!isMainThread && workerData && workerData.sharedCtrl) {
  const ctrl = new Int32Array(workerData.sharedCtrl);
  const stepSize = Math.max(1, workerData.batchSize || 1);
  const serializeOnly = Boolean(workerData.serializeOnly);
  const flushLimit = Math.max(1, workerData.flushEvery || 1);

  const localJobs = workerData.buildParams
    ? (() => {
        const all = buildJobs(workerData.buildParams);
        const idxArr = new Int32Array(workerData.pendingIndicesBuf);
        return { all, idxArr, length: idxArr.length };
      })()
    : { all: workerData.jobs, idxArr: null, length: workerData.jobs.length };

  const onProgress = (turns, games) => {
    if (turns > 0) Atomics.add(ctrl, 3, turns);
    if (games > 0) Atomics.add(ctrl, 2, games);
  };

  const outResults = [];
  const outLines = [];
  let lastFlush = Date.now();

  const flush = () => {
    if (serializeOnly) {
      if (outLines.length > 0) {
        parentPort.postMessage({ type: 'jsonl', count: outLines.length, chunk: outLines.join('\n') + '\n' });
        outLines.length = 0;
      }
    } else if (outResults.length > 0) {
      parentPort.postMessage({ type: 'batch', results: outResults.splice(0, outResults.length) });
    }
    lastFlush = Date.now();
  };

  for (;;) {
    const base = Atomics.add(ctrl, 0, stepSize);
    if (base >= localJobs.length) break;
    const end = Math.min(localJobs.length, base + stepSize);
    for (let k = base; k < end; k++) {
      const job = localJobs.idxArr ? localJobs.all[localJobs.idxArr[k]] : localJobs.all[k];
      const res = runPairJob(job, onProgress);
      Atomics.add(ctrl, 4, res.turns);
      Atomics.add(ctrl, 1, 1);
      if (serializeOnly) outLines.push(JSON.stringify(res));
      else outResults.push(res);
    }
    const buffered = serializeOnly ? outLines.length : outResults.length;
    if (buffered >= flushLimit || Date.now() - lastFlush >= 80) flush();
  }
  flush();
  parentPort.postMessage({ type: 'done' });
  return;
}

// --- Main Thread: Experiment Generation, Lock-Free Worker Pool & Live Summary ---

function loadCompletedIds(outputPath, expectedPhysics = P.VERSION) {
  const done = new Set();
  if (!outputPath || !fs.existsSync(outputPath)) return done;
  const content = fs.readFileSync(outputPath, 'utf8');
  let staleVersion = null;
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const rowVer = row?.physicsVersion ?? 27;
      if (rowVer !== expectedPhysics) {
        staleVersion = rowVer;
        break;
      }
      if (row && row.id) done.add(row.id);
    } catch {
      // Ignore partial trailing line from an interrupted run.
    }
  }
  if (staleVersion !== null) {
    const parsed = path.parse(outputPath);
    let archivePath = path.join(parsed.dir, `${parsed.name}.v${staleVersion}${parsed.ext}`);
    let suffix = 1;
    while (fs.existsSync(archivePath)) {
      archivePath = path.join(parsed.dir, `${parsed.name}.v${staleVersion}-${suffix++}${parsed.ext}`);
    }
    fs.renameSync(outputPath, archivePath);
    console.error(`[ability-benchmark] Archived prior physics v${staleVersion} corpus -> ${archivePath} (starting clean v${expectedPhysics} run).`);
    return new Set();
  }
  return done;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rem}` : `${m}:${rem}`;
}

function runPool(jobs, threads, batchSize, onBatch, opts = null) {
  if (!jobs.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const serializeOnly = Boolean(opts && opts.onJsonChunk);
    const allResults = serializeOnly ? null : [];
    const totalJobs = jobs.length;
    const stepSize = Math.max(1, batchSize || 1);
    const workerCount = Math.min(threads, Math.ceil(totalJobs / stepSize));

    // ctrl: [0] cursor, [1] completedPairs, [2] liveGames, [3] liveTurns, [4] finishedPairTurns
    const sharedCtrl = new SharedArrayBuffer(5 * Int32Array.BYTES_PER_ELEMENT);
    const ctrl = new Int32Array(sharedCtrl);

    const flushEvery = serializeOnly
      ? Math.min(4, Math.max(1, Math.floor(totalJobs / Math.max(1, workerCount * 8))))
      : 1;

    const wData = opts && opts.buildParams && opts.pendingIndicesBuf
      ? {
          sharedCtrl,
          batchSize: stepSize,
          flushEvery,
          serializeOnly,
          buildParams: opts.buildParams,
          pendingIndicesBuf: opts.pendingIndicesBuf
        }
      : {
          sharedCtrl,
          batchSize: stepSize,
          flushEvery,
          serializeOnly,
          jobs
        };

    let lastRender = 0;
    const started = Date.now();

    const renderProgress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastRender < 200) return;
      lastRender = now;
      const completedPairs = Atomics.load(ctrl, 1);
      const liveGames = Atomics.load(ctrl, 2);
      const liveTurns = Atomics.load(ctrl, 3);
      const finishedPairTurns = Atomics.load(ctrl, 4);

      const elapsed = Math.max(0.1, (now - started) / 1000);
      const turnsRate = liveTurns / elapsed;
      const obsTurnsPerPair = completedPairs >= 4 ? finishedPairTurns / completedPairs : 125;
      const priorWeight = Math.max(0, 1 - completedPairs / Math.max(8, workerCount));
      const estTurnsPerPair = priorWeight * 125 + (1 - priorWeight) * obsTurnsPerPair;
      const inFlightTurns = Math.max(0, liveTurns - finishedPairTurns);
      const inFlightPairs = Math.min(workerCount * stepSize * 0.95, inFlightTurns / Math.max(20, estTurnsPerPair));
      const effectivePairs = Math.min(totalJobs, completedPairs + inFlightPairs);
      const pairRate = effectivePairs / elapsed;
      const gamesRate = pairRate * 2;
      const remainingPairs = Math.max(0, totalJobs - effectivePairs);
      const etaStr = liveTurns >= 8 ? formatEta(remainingPairs / Math.max(1e-6, pairRate)) : 'warming...';
      process.stderr.write(
        `\r[${completedPairs}/${totalJobs} pairs · ${liveGames} games · ${liveTurns} turns] ` +
        `${gamesRate.toFixed(2)} games/s · ${Math.round(turnsRate)} turns/s · ETA ${etaStr}   `
      );
    };

    const heartbeat = setInterval(() => renderProgress(false), 250);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    const workers = Array.from({ length: workerCount }, () => new Worker(__filename, { workerData: wData }));
    let remainingWorkers = workerCount;
    let settled = false;

    for (const worker of workers) {
      worker.on('message', msg => {
        if (!msg || settled) return;
        if (msg.type === 'jsonl') {
          opts.onJsonChunk(msg.chunk, msg.count);
          renderProgress(false);
          return;
        }
        if (msg.type === 'batch') {
          if (onBatch) onBatch(msg.results);
          if (allResults) {
            for (let i = 0; i < msg.results.length; i++) allResults.push(msg.results[i]);
          }
          renderProgress(false);
          return;
        }
        if (msg.type === 'done') {
          worker.terminate();
          if (--remainingWorkers === 0) {
            settled = true;
            clearInterval(heartbeat);
            renderProgress(true);
            process.stderr.write('\n');
            resolve(allResults || []);
          }
        }
      });
      worker.on('error', err => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        workers.forEach(w => w.terminate());
        reject(err);
      });
    }
  });
}

function printQuickSummary(outputPath) {
  if (!outputPath || !fs.existsSync(outputPath)) return;
  const rows = [];
  for (const line of fs.readFileSync(outputPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch {}
  }
  const byKind = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  console.log(`\nDataset summary (${outputPath}): ${rows.length} pairs (${rows.length * 2} games) —`, byKind);

  const curveRows = rows.filter(r => r.kind === 'curve' && r.tag);
  if (curveRows.length) {
    console.log('\nFocal single-ubu marginal swings (50/50 Standard + Pulse, 1 focal ubu vs neutral):');
    console.log('Stat'.padEnd(13) + 'at 0'.padStart(10) + 'at 64'.padStart(10) + 'at 191'.padStart(10) + 'at 255'.padStart(10) + '255-0'.padStart(10));
    const table = STATS.map(stat => {
      const meanAt = v => {
        const sub = curveRows.filter(r => r.tag.stat === stat && r.tag.value === v);
        return sub.length ? sub.reduce((a, r) => a + r.goalDiff, 0) / sub.length : 0;
      };
      const m0 = meanAt(0), m64 = meanAt(64), m191 = meanAt(191), m255 = meanAt(255);
      return { stat, m0, m64, m191, m255, swing: m255 - m0 };
    }).sort((a, b) => b.swing - a.swing);
    for (const r of table) {
      const fmt = x => (x >= 0 ? '+' : '') + x.toFixed(3);
      console.log(
        r.stat.padEnd(13) +
        fmt(r.m0).padStart(10) +
        fmt(r.m64).padStart(10) +
        fmt(r.m191).padStart(10) +
        fmt(r.m255).padStart(10) +
        fmt(r.swing).padStart(10)
      );
    }
  }
}

async function main() {
  const known = [
    'suite', 'preset', 'scale', 'pairs', 'curve-pairs', 'inter-pairs', 'wild-pairs',
    'seed', 'threads', 'batch', 'std-turns', 'pulse-turns', 'wobble', 'output', 'resume'
  ];
  const rawArgs = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const tok = rawArgs[i];
    if (tok === '--resume') { args.resume = 'true'; continue; }
    if (tok === '--no-resume') { args.resume = 'false'; continue; }
    if (tok === '--quick') { args.scale = 'quick'; continue; }
    if (tok === '--deep') { args.scale = 'deep'; continue; }
    if (!tok.startsWith('--')) throw new Error('Unexpected argument: ' + tok);
    const key = tok.slice(2);
    if (!known.includes(key)) throw new Error('Unknown option: --' + key);
    if (i + 1 >= rawArgs.length || rawArgs[i + 1].startsWith('--')) throw new Error('Missing value for --' + key);
    args[key] = rawArgs[++i];
  }

  const suite = args.suite || 'full';
  const presetName = args.preset || 'balanced';
  const scaleName = args.scale || 'standard';
  if (!['full', 'corpus', 'curves', 'interactions', 'wild'].includes(suite)) {
    throw new Error(`Invalid --suite ${suite}`);
  }
  if (!PRESETS[presetName]) throw new Error(`Invalid --preset ${presetName}`);
  if (!SCALE_TIERS[scaleName]) throw new Error(`Invalid --scale ${scaleName}`);

  const tier = SCALE_TIERS[scaleName];
  const cpuConfig = { ...PRESETS[presetName] };
  if (args.wobble !== undefined) cpuConfig.wobble = args.wobble === 'true';

  const pairs = args.pairs !== undefined ? Number(args.pairs) : tier.pairs;
  const curvePairs = args['curve-pairs'] !== undefined ? Number(args['curve-pairs']) : tier.curvePairs;
  const interPairs = args['inter-pairs'] !== undefined ? Number(args['inter-pairs']) : tier.interPairs;
  const wildPairs = args['wild-pairs'] !== undefined ? Number(args['wild-pairs']) : (args.pairs !== undefined ? Math.max(120, Math.round(pairs * 0.15)) : tier.wildPairs);
  const seed = args.seed !== undefined ? Number(args.seed) : 20261113;
  const hwThreads = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  // Default to full hardware thread count (e.g. all 32 threads on i9-14900K) for maximum throughput.
  const threads = args.threads !== undefined ? Number(args.threads) : Math.max(1, hwThreads);
  const batchSize = args.batch !== undefined ? Number(args.batch) : 1;
  const stdTurns = args['std-turns'] !== undefined ? Number(args['std-turns']) : 60;
  const pulseTurns = args['pulse-turns'] !== undefined ? Number(args['pulse-turns']) : 150;
  const outputPath = args.output || path.join(__dirname, '..', 'personal', 'ability-corpus.jsonl');
  const resume = args.resume !== 'false';

  if (![pairs, curvePairs, interPairs, wildPairs, seed, threads, batchSize, stdTurns, pulseTurns].every(Number.isInteger) ||
      threads < 1 || batchSize < 1 || stdTurns < 1 || pulseTurns < 1) {
    throw new Error('Invalid integer options.');
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const buildParams = { suite, pairs, curvePairs, interPairs, wildPairs, seed, cpuConfig, stdTurns, pulseTurns };
  const allJobs = buildJobs(buildParams);
  const doneIds = resume ? loadCompletedIds(outputPath) : new Set();
  if (!resume && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  const pendingIndices = [];
  const pending = [];
  for (let i = 0; i < allJobs.length; i++) {
    if (!doneIds.has(allJobs[i].id)) {
      pendingIndices.push(i);
      pending.push(allJobs[i]);
    }
  }

  console.error(
    `Ability Benchmark [${suite} · scale=${scaleName} · preset=${presetName} · 50/50 Standard(${stdTurns}t)+Pulse(${pulseTurns}t) · ${threads} threads]: ` +
    `${allJobs.length} total pairs (${doneIds.size} cached, ${pending.length} to simulate)`
  );

  if (pending.length > 0) {
    const pendingIndicesBuf = new SharedArrayBuffer(pendingIndices.length * Int32Array.BYTES_PER_ELEMENT);
    new Int32Array(pendingIndicesBuf).set(pendingIndices);

    const stream = fs.createWriteStream(outputPath, { flags: 'a' });
    try {
      await runPool(pending, threads, batchSize, null, {
        buildParams,
        pendingIndicesBuf,
        onJsonChunk: chunk => {
          stream.write(chunk);
        }
      });
    } finally {
      await new Promise(res => stream.end(res));
    }
  }

  printQuickSummary(outputPath);
  console.error(`\nNext steps:\n  1. Fit spline + interaction model (RTX 4090 / Python): python scripts/fit-ability.py --input ${outputPath}\n  2. Or fit + calibrate 1M DNA quantiles in Node:        npm run calibrate:ability -- --corpus ${outputPath}`);
}

if (require.main === module && isMainThread) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { STATS, PRESETS, SCALE_TIERS, pickEquippedSuper, playSingleMatch, runPairJob, buildJobs, loadCompletedIds, runPool };
