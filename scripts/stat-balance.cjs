'use strict';
// Measures how much each ubu stat is worth by playing CPU-vs-CPU matches through the real match rules.
//
//   sweep:      one team has a single stat at 0 or 255 on all three ubus, the other is all-neutral;
//               everything else (supers, personalities, starting meter) is mirrored between teams.
//   supers:     one team has a single super on all three ubus, the other has none; stats are neutral.
//   regression: every stat on every ubu is random; a least-squares fit of goal difference on the
//               teams' average stat differences values all stats at once.
//
// Each match is played twice with the teams' sides swapped. Matches run in parallel worker threads
// via lock-free SharedArrayBuffer work stealing and are reproducible from their seed.
const os = require('node:os');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const C = require('../shared/ububall-cpu.js');

const STATS = ['impulse', 'traction', 'spin', 'curve', 'size', 'mass', 'bounciness', 'grip',
  'power', 'reach', 'strength', 'stability', 'efficiency', 'synergy', 'chemistry'];

const KICKOFF_POS = Object.freeze([
  { x: 180, y: 300 }, { x: 310, y: 180 }, { x: 310, y: 420 },
  { x: 820, y: 300 }, { x: 690, y: 180 }, { x: 690, y: 420 },
  { x: 500, y: 300 }
]);
const RESOLVE_OPTS = Object.freeze({ effects: false });

// One match: `teams` holds each team's three raw stat objects; `swapped` puts team A on the right.
// `supers` optionally fixes each team's super ([team A, team B], an index into P.SUPERS or null for none).
function match({ teams, seed, swapped, level, maxTurns, supers = null, fastTick = true }) {
  const random = C.randomSource(seed), bodies = P.kickoff(), stats = [];
  // Mirrored loadout: each slot gets the same 4-slot super pool, personality and starting meter on both sides.
  const slots = [0, 1, 2].map(() => {
    const superSlots = Array.from({ length: 4 }, () => Math.floor(random() * 16));
    return {
      superSlots, superId: superSlots[0] % 8, meter: Math.floor(random() * 60),
      personality: { aggression: Math.floor(random() * 64), creativity: Math.floor(random() * 64),
        teamwork: Math.floor(random() * 64), clutch: Math.floor(random() * 64) }
    };
  });
  const order = swapped ? [teams[1], teams[0]] : teams;
  for (let i = 0; i < 6; i++) {
    const b = bodies[i];
    const raw = order[Math.floor(i / 3)][i % 3], slot = slots[i % 3];
    stats.push(raw); M.applyStats(P, b, raw, 'standard');
    const own = supers ? supers[(i < 3) === !swapped ? 0 : 1] : slot.superId;
    const mastery = own === null ? null : P.superMastery(supers ? [own] : slot.superSlots, own);
    b.openingShot = false;
    b.meter = slot.meter;
    b.meterTick = -Infinity;
    b.superArm = false;
    b.superBonusTicks = mastery?.bonusTicks || 0;
    b.superBonusRefund = mastery?.bonusRefund || 0;
    b.equippedSuper = own === null ? null : { ...P.SUPERS[own], ...mastery };
    b.personality = slot.personality;
  }
  let state = { version: M.VERSION, mode: 'standard', bodies, stats, scores: [0, 0], turn: 1, phase: 'plan', winner: null };
  let turns = 0;
  const cfg0 = { level, fastTick, seed: 0 };
  const cfg1 = { level, fastTick, seed: 0 };
  const moves = new Array(6);
  while (state.winner === null && turns < maxTurns) {
    cfg0.seed = seed * 1009 + turns * 17;
    cfg1.seed = cfg0.seed + 1;
    const p0 = C.plan(state, 0, cfg0).plans;
    const p1 = C.plan(state, 1, cfg1).plans;
    moves[0] = p0[0]; moves[1] = p0[1]; moves[2] = p0[2];
    moves[3] = p1[0]; moves[4] = p1[1]; moves[5] = p1[2];
    state = M.resolveTurn(P, state, moves, RESOLVE_OPTS).state; turns++;
    if (state.phase === 'goal') {
      for (let i = 0; i < 7; i++) {
        const b = state.bodies[i];
        b.x = KICKOFF_POS[i].x; b.y = KICKOFF_POS[i].y; b.vx = b.vy = b.omega = 0;
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
  }
  const [a, b] = swapped ? [state.scores[1], state.scores[0]] : state.scores;
  const winner = state.winner === null ? null : (state.winner === (swapped ? 1 : 0) ? 'a' : 'b');
  return { diff: a - b, winner, turns };
}

if (!isMainThread && workerData && workerData.sharedCtrl) {
  const ctrl = new Int32Array(workerData.sharedCtrl);
  const jobs = workerData.jobs;
  const out = [];
  for (;;) {
    const id = Atomics.add(ctrl, 0, 1);
    if (id >= jobs.length) break;
    out.push({ id, ...match(jobs[id]) });
    Atomics.add(ctrl, 1, 1);
    if (out.length >= 8) parentPort.postMessage({ type: 'batch', results: out.splice(0, out.length) });
  }
  if (out.length > 0) parentPort.postMessage({ type: 'batch', results: out });
  parentPort.postMessage({ type: 'done' });
  return;
}

// --- Main thread: experiment design, scheduling and statistics. ---
const neutral = () => Object.fromEntries(STATS.map(s => [s, 127]));
const team = patch => [0, 1, 2].map(() => ({ ...neutral(), ...patch }));

function run(jobs, threads) {
  if (!jobs.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const results = new Array(jobs.length);
    const sharedCtrl = new SharedArrayBuffer(2 * Int32Array.BYTES_PER_ELEMENT);
    const ctrl = new Int32Array(sharedCtrl);
    const started = Date.now();
    let lastRender = 0;
    const workerCount = Math.min(threads, jobs.length);
    const workers = Array.from({ length: workerCount }, () => new Worker(__filename, { workerData: { sharedCtrl, jobs } }));
    let remaining = workerCount;

    const render = (force = false) => {
      const now = Date.now();
      if (!force && now - lastRender < 200) return;
      lastRender = now;
      const done = Atomics.load(ctrl, 1);
      const elapsed = Math.max(0.05, (now - started) / 1000);
      process.stderr.write(`\r${done}/${jobs.length} matches · ${(done / elapsed).toFixed(1)} games/s · ${elapsed.toFixed(1)}s   `);
    };

    for (const worker of workers) {
      worker.on('message', msg => {
        if (msg.type === 'batch') {
          for (let i = 0; i < msg.results.length; i++) {
            const r = msg.results[i];
            results[r.id] = r;
          }
          render(false);
        } else if (msg.type === 'done') {
          worker.terminate();
          if (--remaining === 0) {
            render(true);
            process.stderr.write('\n');
            resolve(results);
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

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
function summarise(results) {
  const pairs = [];
  for (let i = 0; i < results.length; i += 2) pairs.push((results[i].diff + results[i + 1].diff) / 2);
  const m = mean(pairs), sd = Math.sqrt(pairs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, pairs.length - 1));
  const decided = results.filter(r => r.winner), wins = decided.filter(r => r.winner === 'a').length;
  return { goalDiff: m, ci: 1.96 * sd / Math.sqrt(pairs.length), winRate: decided.length ? wins / decided.length : null,
    games: results.length, capped: results.length - decided.length };
}

function regress(rows, ys) {
  const k = rows[0].length, n = rows.length;
  if (n <= k) throw new Error(`Regression requires more pairs (${n}) than model parameters (${k}).`);
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => rows.reduce((a, r) => a + r[i] * r[j], 0)));
  const xty = Array.from({ length: k }, (_, i) => rows.reduce((a, r, t) => a + r[i] * ys[t], 0));
  const inv = xtx.map((row, i) => [...row, ...Array.from({ length: k }, (_, j) => +(i === j))]);
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(inv[r][c]) > Math.abs(inv[p][c])) p = r;
    [inv[c], inv[p]] = [inv[p], inv[c]];
    const d = inv[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('Singular design matrix in regression; increase --pairs.');
    for (let j = 0; j < 2 * k; j++) inv[c][j] /= d;
    for (let r = 0; r < k; r++) if (r !== c) { const f = inv[r][c]; for (let j = 0; j < 2 * k; j++) inv[r][j] -= f * inv[c][j]; }
  }
  const xinv = inv.map(row => row.slice(k));
  const beta = xinv.map(row => row.reduce((a, v, j) => a + v * xty[j], 0));
  const residual = rows.reduce((a, r, t) => a + (ys[t] - r.reduce((s, v, j) => s + v * beta[j], 0)) ** 2, 0) / (n - k);
  return beta.map((b, i) => ({ beta: b, se: Math.sqrt(Math.max(0, residual * xinv[i][i])) }));
}

async function main() {
  const known = ['experiment', 'pairs', 'seed', 'level', 'turns', 'threads', 'stats', 'output'];
  const rawArgs = process.argv.slice(2), args = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const token = rawArgs[i];
    if (!token.startsWith('--')) throw new Error('Unexpected argument: ' + token);
    const key = token.slice(2);
    if (!known.includes(key)) throw new Error('Unknown option: --' + key);
    if (i + 1 >= rawArgs.length || rawArgs[i + 1].startsWith('--')) throw new Error('Missing value for --' + key);
    args[key] = rawArgs[++i];
  }
  const experiment = args.experiment || 'sweep';
  const pairs = args.pairs !== undefined ? Number(args.pairs) : 20;
  const seed = args.seed !== undefined ? Number(args.seed) : 1;
  const level = args.level || 'easy';
  const maxTurns = args.turns !== undefined ? Number(args.turns) : 60;
  const hwThreads = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const threads = args.threads !== undefined ? Number(args.threads) : Math.max(1, hwThreads);
  const stats = args.stats ? String(args.stats).split(',') : STATS;
  if (!['sweep', 'regression', 'supers'].includes(experiment) || !stats.every(s => STATS.includes(s)) ||
      ![pairs, seed, maxTurns, threads].every(Number.isInteger) || pairs < 1 || maxTurns < 1 || threads < 1) {
    throw new Error('Invalid options.');
  }
  if (experiment === 'regression' && pairs <= stats.length + 1) {
    throw new Error(`Regression requires --pairs > ${stats.length + 1}.`);
  }
  const common = { level, maxTurns, fastTick: true };
  const pairJobs = (teams, s, supers = null) => [false, true].map(swapped => ({ ...common, teams, seed: s, swapped, supers }));
  let report;
  if (experiment === 'sweep') {
    const cells = [];
    for (const stat of stats) for (const value of [0, 255]) cells.push({ stat, value });
    const jobs = [];
    for (const cell of cells) for (let p = 0; p < pairs; p++) jobs.push(...pairJobs([team({ [cell.stat]: cell.value }), team({})], seed + p));
    const results = await run(jobs, threads);
    const per = 2 * pairs;
    const rows = cells.map((cell, i) => ({ ...cell, ...summarise(results.slice(i * per, (i + 1) * per)) }));
    const value = stat => {
      const lo = rows.find(r => r.stat === stat && r.value === 0), hi = rows.find(r => r.stat === stat && r.value === 255);
      return { stat, low: lo.goalDiff, lowCi: lo.ci, high: hi.goalDiff, highCi: hi.ci, swing: hi.goalDiff - lo.goalDiff, winHigh: hi.winRate, winLow: lo.winRate };
    };
    report = { experiment, level, pairs, seed, maxTurns, stats: stats.map(value).sort((a, b) => b.swing - a.swing), rows };
    console.log(`\nGoal difference per match for a team with the stat on all three ubus vs an all-neutral team (${level} CPU, ${pairs} side-swapped pairs each).`);
    console.log('stat'.padEnd(12) + 'at 0'.padStart(15) + 'at 255'.padStart(15) + 'swing'.padStart(8) + '  win% at 255');
    for (const r of report.stats) console.log(r.stat.padEnd(12) + `${r.low.toFixed(2)} ± ${r.lowCi.toFixed(2)}`.padStart(15) + `${r.high.toFixed(2)} ± ${r.highCi.toFixed(2)}`.padStart(15) + r.swing.toFixed(2).padStart(8) + `  ${r.winHigh === null ? '–' : Math.round(r.winHigh * 100) + '%'}`);
  } else if (experiment === 'supers') {
    const jobs = [];
    for (let id = 0; id < P.SUPERS.length; id++) for (let p = 0; p < pairs; p++) jobs.push(...pairJobs([team({}), team({})], seed + p, [id, null]));
    const results = await run(jobs, threads), per = 2 * pairs;
    const rows = P.SUPERS.map((sup, id) => ({ super: sup.name, ...summarise(results.slice(id * per, (id + 1) * per)) })).sort((a, b) => b.goalDiff - a.goalDiff);
    report = { experiment, level, pairs, seed, maxTurns, supers: rows };
    console.log(`\nGoal difference per match for a team with one super on all three ubus vs a team with none (${level} CPU, ${pairs} side-swapped pairs each).\n`);
    console.log('super'.padEnd(12) + 'goal diff'.padStart(16) + '  win%');
    for (const r of rows) console.log(r.super.padEnd(12) + `${r.goalDiff.toFixed(2)} ± ${r.ci.toFixed(2)}`.padStart(16) + `  ${r.winRate === null ? '–' : Math.round(r.winRate * 100) + '%'}`);
  } else {
    const random = C.randomSource(seed), jobs = [], designs = [];
    const randomTeam = () => [0, 1, 2].map(() => ({ ...neutral(), ...Object.fromEntries(stats.map(s => [s, Math.floor(random() * 256)])) }));
    for (let p = 0; p < pairs; p++) { const teams = [randomTeam(), randomTeam()]; designs.push(teams); jobs.push(...pairJobs(teams, seed + p)); }
    const results = await run(jobs, threads);
    const rows = designs.map(([a, b]) => [1, ...stats.map(s => (mean(a.map(u => u[s])) - mean(b.map(u => u[s]))) / 128)]);
    const ys = designs.map((_, p) => (results[2 * p].diff + results[2 * p + 1].diff) / 2);
    const fit = regress(rows, ys);
    report = { experiment, level, pairs, seed, maxTurns, intercept: fit[0],
      stats: stats.map((stat, i) => ({ stat, ...fit[i + 1] })).sort((a, b) => b.beta - a.beta) };
    console.log(`\nGoal difference per match from a +128 team-average stat edge, all stats random (${level} CPU, ${pairs} side-swapped pairs).\n`);
    console.log('stat'.padEnd(12) + 'effect'.padStart(16));
    for (const r of report.stats) console.log(r.stat.padEnd(12) + `${r.beta.toFixed(2)} ± ${(1.96 * r.se).toFixed(2)}`.padStart(16));
  }
  if (args.output) require('node:fs').writeFileSync(args.output, JSON.stringify(report, null, 2) + '\n');
}
if (require.main === module && isMainThread) main().catch(error => { console.error(error); process.exit(1); });
module.exports = { STATS, match, regress };
