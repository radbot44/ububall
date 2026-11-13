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
//   full:         Runs curves + interactions + corpus + wild into a unified resumable JSONL dataset.
//
// Designed for high-core-count CPUs (e.g. i9-14900K 32 threads): persistent worker pool, dynamic
// multi-pair micro-batches for P/E-core load balancing, { effects: false } headless turn resolution,
// and append-only JSONL checkpointing (--resume) so large runs can stop and resume cleanly.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker, isMainThread, parentPort } = require('node:worker_threads');
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
  fast: Object.freeze({ level: 'easy', candidates: 28, opponents: 2, risk: 0.30, temperature: 15, wobble: false }),
  balanced: Object.freeze({ level: 'medium', candidates: 56, opponents: 2, risk: 0.35, temperature: 12, wobble: false }),
  deep: Object.freeze({ level: 'hard', candidates: 96, opponents: 3, risk: 0.45, temperature: 10, wobble: true }),
  hard: Object.freeze({ level: 'hard', candidates: 120, opponents: 3, risk: 0.55, temperature: 25, wobble: true })
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

function kickoffReset(state) {
  const positions = P.kickoff();
  state.bodies.forEach((b, i) => {
    b.x = positions[i].x;
    b.y = positions[i].y;
    b.vx = b.vy = b.omega = 0;
    if (i < 6) {
      b.daze = 0;
      delete b.meterTick;
      b.guarding = false;
      b.ironGuard = false;
      b.ironCooldownTicks = 0;
      P.syncEffectiveStats(b);
    }
  });
  state.phase = 'plan';
}

// Plays one match (one side orientation) and returns scores, ticks, turns, territorial tiebreak, and per-ubu tallies.
function playSingleMatch({ teams, contexts, mode, seed, swapped, cpuConfig, maxTurns }) {
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
    b.personality = { ...ctx.personality };
    b.equippedSuper = { ...ctx.equippedSuper };
    b.superBonusTicks = ctx.bonusTicks;
    b.superBonusRefund = ctx.bonusRefund;
    b.meter = ctx.meter;
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

  let turns = 0;
  let ballXSum = 0;
  while (state.winner === null && turns < maxTurns) {
    const p0 = C.plan(state, 0, { ...cpuConfig, seed: (seed * 2654435761 + turns * 97 + (swapped ? 1 : 0)) >>> 0 }).plans;
    const p1 = C.plan(state, 1, { ...cpuConfig, seed: (seed * 2654435761 + turns * 97 + (swapped ? 0 : 1)) >>> 0 }).plans;
    state = M.resolveTurn(P, state, [...p0, ...p1], { effects: false }).state;
    turns++;
    ballXSum += (state.bodies[6].x - 500);
    if (state.phase === 'goal') kickoffReset(state);
  }

  const [aGoals, bGoals] = swapped ? [state.scores[1], state.scores[0]] : state.scores;
  const winner = state.winner === null ? null : (state.winner === (swapped ? 1 : 0) ? 1 : -1);
  // Map 6-ubu tallies back to canonical [TeamA_0..2, TeamB_0..2] order.
  const t = state.tally || M.newTally();
  const mapSix = arr => swapped ? [arr[3], arr[4], arr[5], arr[0], arr[1], arr[2]] : [...arr];
  const territory = (swapped ? -1 : 1) * (ballXSum / Math.max(1, turns)) / 440; // [-1, +1] average field tilt

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
function runPairJob(job) {
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

  const m0 = playSingleMatch({ teams, contexts: [ctxA, ctxB], mode, seed, swapped: false, cpuConfig, maxTurns });
  const m1 = playSingleMatch({ teams, contexts: [ctxA, ctxB], mode, seed, swapped: true, cpuConfig, maxTurns });

  const goalDiff = (m0.diff + m1.diff) / 2;
  const winDiff = (m0.winner + m1.winner) / 2;
  const totalTicks = m0.ticks + m1.ticks;
  const totalTurns = m0.turns + m1.turns;
  const cappedCount = Number(m0.capped) + Number(m1.capped);
  const territory = (m0.territory + m1.territory) / 2;
  // Pace-adjusted goal rate (goals per 7,200 ticks = 30s simulated play, soft-clamped at ±10 to prevent 2-s fluke spikes).
  const rawRate = totalTicks > 0 ? ((m0.diff + m1.diff) / totalTicks) * 7200 : 0;
  const goalRate30s = Math.max(-10, Math.min(10, rawRate));

  const sumSix = key => m0.tally[key].map((v, i) => v + m1.tally[key][i]);
  const encodeTeam = team => team.map(u => STATS.map(s => u[s]));

  const out = {
    id,
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

if (!isMainThread) {
  parentPort.on('message', batch => {
    const results = batch.map(runPairJob);
    parentPort.postMessage(results);
  });
  return;
}

// --- Main Thread: Experiment Generation, Checkpointed Worker Pool & Live Summary ---

const neutralStats = () => Object.fromEntries(STATS.map(s => [s, 127]));
const randomStats = rng => Object.fromEntries(STATS.map(s => [s, Math.floor(rng() * 256)]));

function buildJobs({ suite, pairs, curvePairs, interPairs, wildPairs, seed, cpuConfig, stdTurns, pulseTurns }) {
  const jobs = [];
  const modeAt = idx => (idx % 2 === 0 ? 'standard' : 'pulse');
  const turnsFor = mode => (mode === 'pulse' ? pulseTurns : stdTurns);

  // 1. Single-ubu focal 5-point marginal curves (0, 64, 127, 191, 255), rotating slots 0, 1, 2.
  if (suite === 'curves' || suite === 'full') {
    const knots = [0, 64, 127, 191, 255];
    let idx = 0;
    for (const stat of STATS) {
      for (const value of knots) {
        if (value === 127) continue; // vs baseline neutral is identically 0 by symmetry; saves 20% compute
        for (let p = 0; p < curvePairs; p++) {
          const mode = modeAt(p);
          const slot = p % 3;
          const baseSeed = seed + 100000 + p;
          const bgRng = C.randomSource(baseSeed ^ 0x517cc1b7);
          // Shared background teammates on both sides (CRN) so ONLY the focal ubu's stat differs!
          const bgTeam = [randomStats(bgRng), randomStats(bgRng), randomStats(bgRng)];
          const teamA = bgTeam.map(u => ({ ...u }));
          const teamB = bgTeam.map(u => ({ ...u }));
          teamA[slot] = { ...neutralStats(), [stat]: value };
          teamB[slot] = neutralStats();
          jobs.push({
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
          idx++;
        }
      }
    }
  }

  // 2. Targeted 2D physics interaction grids on focal ubu.
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
    for (const [s1, s2] of pairs2D) {
      for (const v1 of gridVals) {
        for (const v2 of gridVals) {
          if (v1 === 127 && v2 === 127) continue;
          for (let p = 0; p < interPairs; p++) {
            const mode = modeAt(p);
            const slot = p % 3;
            const baseSeed = seed + 300000 + p;
            const bgRng = C.randomSource(baseSeed ^ 0x85ebca6b);
            const bgTeam = [randomStats(bgRng), randomStats(bgRng), randomStats(bgRng)];
            const teamA = bgTeam.map(u => ({ ...u }));
            const teamB = bgTeam.map(u => ({ ...u }));
            // Note: for efficiency×synergy, give teammates random chemistry (identical on both sides) so synergy transfers realistically.
            teamA[slot] = { ...neutralStats(), [s1]: v1, [s2]: v2 };
            teamB[slot] = neutralStats();
            jobs.push({
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

  // 3. Large random-stat 6-ubu corpus (50% standard, 50% pulse, mirrored non-stat context).
  if (suite === 'corpus' || suite === 'full') {
    for (let p = 0; p < pairs; p++) {
      const mode = modeAt(p);
      const pairSeed = seed + 500000 + p;
      const rng = C.randomSource(pairSeed ^ 0xc2b2ae35);
      const teamA = [randomStats(rng), randomStats(rng), randomStats(rng)];
      const teamB = [randomStats(rng), randomStats(rng), randomStats(rng)];
      jobs.push({
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

  // 4. Unmirrored wild 128-byte DNA validation split (tests real match win-rate prediction).
  if (suite === 'wild' || suite === 'full') {
    const wildCpu = cpuConfig.candidates < 56 ? PRESETS.balanced : cpuConfig;
    for (let p = 0; p < wildPairs; p++) {
      const mode = modeAt(p);
      const pairSeed = seed + 900000 + p;
      const rng = C.randomSource(pairSeed ^ 0x27d4eb2f);
      const teamA = [randomStats(rng), randomStats(rng), randomStats(rng)];
      const teamB = [randomStats(rng), randomStats(rng), randomStats(rng)];
      jobs.push({
        id: `wild:${p}`,
        kind: 'wild',
        mode,
        seed: pairSeed,
        teams: [teamA, teamB],
        mirrorContext: false,
        cpuConfig: wildCpu,
        maxTurns: turnsFor(mode)
      });
    }
  }

  return jobs;
}

function loadCompletedIds(outputPath) {
  const done = new Set();
  if (!outputPath || !fs.existsSync(outputPath)) return done;
  const content = fs.readFileSync(outputPath, 'utf8');
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.id) done.add(row.id);
    } catch {
      // Ignore partial trailing line from an interrupted run.
    }
  }
  return done;
}

function runPool(jobs, threads, batchSize, onBatch) {
  if (!jobs.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const allResults = [];
    let cursor = 0;
    let completed = 0;
    let totalTurns = 0;
    const started = Date.now();
    const workerCount = Math.min(threads, Math.ceil(jobs.length / batchSize));
    const workers = Array.from({ length: workerCount }, () => new Worker(__filename));

    const dispatch = worker => {
      if (cursor >= jobs.length) return false;
      const slice = jobs.slice(cursor, cursor + batchSize);
      cursor += slice.length;
      worker.postMessage(slice);
      return true;
    };

    let activeWorkers = 0;
    for (const worker of workers) {
      if (dispatch(worker)) activeWorkers++;
      worker.on('message', batchResults => {
        onBatch(batchResults);
        for (const r of batchResults) {
          allResults.push(r);
          totalTurns += r.turns;
        }
        completed += batchResults.length;
        const elapsed = Math.max(0.001, (Date.now() - started) / 1000);
        const rate = completed / elapsed;
        const etaSec = Math.round((jobs.length - completed) / Math.max(1e-6, rate));
        const etaMin = Math.floor(etaSec / 60), etaRem = String(etaSec % 60).padStart(2, '0');
        process.stderr.write(
          `\r[${completed}/${jobs.length} pairs · ${completed * 2} games] ` +
          `${(rate * 2).toFixed(1)} games/s · ${Math.round(totalTurns / elapsed)} turns/s · ETA ${etaMin}:${etaRem}   `
        );
        if (!dispatch(worker)) {
          activeWorkers--;
          worker.terminate();
          if (activeWorkers === 0) {
            process.stderr.write('\n');
            resolve(allResults);
          }
        }
      });
      worker.on('error', err => {
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
    'suite', 'preset', 'pairs', 'curve-pairs', 'inter-pairs', 'wild-pairs',
    'seed', 'threads', 'batch', 'std-turns', 'pulse-turns', 'wobble', 'output', 'resume'
  ];
  const rawArgs = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const tok = rawArgs[i];
    if (tok === '--resume') { args.resume = 'true'; continue; }
    if (tok === '--no-resume') { args.resume = 'false'; continue; }
    if (!tok.startsWith('--')) throw new Error('Unexpected argument: ' + tok);
    const key = tok.slice(2);
    if (!known.includes(key)) throw new Error('Unknown option: --' + key);
    if (i + 1 >= rawArgs.length || rawArgs[i + 1].startsWith('--')) throw new Error('Missing value for --' + key);
    args[key] = rawArgs[++i];
  }

  const suite = args.suite || 'full';
  const presetName = args.preset || 'balanced';
  if (!['full', 'corpus', 'curves', 'interactions', 'wild'].includes(suite)) {
    throw new Error(`Invalid --suite ${suite}`);
  }
  if (!PRESETS[presetName]) throw new Error(`Invalid --preset ${presetName}`);

  const cpuConfig = { ...PRESETS[presetName] };
  if (args.wobble !== undefined) cpuConfig.wobble = args.wobble === 'true';

  const pairs = args.pairs !== undefined ? Number(args.pairs) : 6000;
  const curvePairs = args['curve-pairs'] !== undefined ? Number(args['curve-pairs']) : 60;
  const interPairs = args['inter-pairs'] !== undefined ? Number(args['inter-pairs']) : 30;
  const wildPairs = args['wild-pairs'] !== undefined ? Number(args['wild-pairs']) : Math.max(200, Math.round(pairs * 0.15));
  const seed = args.seed !== undefined ? Number(args.seed) : 20261113;
  const hwThreads = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const threads = args.threads !== undefined ? Number(args.threads) : Math.max(1, hwThreads - 2);
  const batchSize = args.batch !== undefined ? Number(args.batch) : 2;
  const stdTurns = args['std-turns'] !== undefined ? Number(args['std-turns']) : 80;
  const pulseTurns = args['pulse-turns'] !== undefined ? Number(args['pulse-turns']) : stdTurns * 3;
  const outputPath = args.output || path.join(__dirname, '..', 'personal', 'ability-corpus.jsonl');
  const resume = args.resume !== 'false';

  if (![pairs, curvePairs, interPairs, wildPairs, seed, threads, batchSize, stdTurns, pulseTurns].every(Number.isInteger) ||
      threads < 1 || batchSize < 1 || stdTurns < 1 || pulseTurns < 1) {
    throw new Error('Invalid integer options.');
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const allJobs = buildJobs({ suite, pairs, curvePairs, interPairs, wildPairs, seed, cpuConfig, stdTurns, pulseTurns });
  const doneIds = resume ? loadCompletedIds(outputPath) : new Set();
  if (!resume && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  const pending = allJobs.filter(j => !doneIds.has(j.id));
  console.error(
    `Ability Benchmark [${suite} · preset=${presetName} · 50/50 Standard(${stdTurns}t)+Pulse(${pulseTurns}t) · ${threads} threads]: ` +
    `${allJobs.length} total pairs (${doneIds.size} cached, ${pending.length} to simulate)`
  );

  if (pending.length > 0) {
    const stream = fs.createWriteStream(outputPath, { flags: 'a' });
    try {
      await runPool(pending, threads, batchSize, batchResults => {
        const chunk = batchResults.map(r => JSON.stringify(r)).join('\n') + '\n';
        stream.write(chunk);
      });
    } finally {
      await new Promise(res => stream.end(res));
    }
  }

  printQuickSummary(outputPath);
  console.error(`\nNext steps:\n  1. Fit spline + interaction model (RTX 4090 / Python): python scripts/fit-ability.py --input ${outputPath}\n  2. Or fit + calibrate 1M DNA quantiles in Node:        npm run calibrate:ability -- --corpus ${outputPath}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { STATS, PRESETS, pickEquippedSuper, playSingleMatch, runPairJob, buildJobs };
