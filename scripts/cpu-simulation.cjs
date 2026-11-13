'use strict';
const os = require('node:os');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const C = require('../shared/ububall-cpu.js');
const U = require('../shared/ubu.js');

const KICKOFF_POS = Object.freeze([
  { x: 180, y: 300 }, { x: 310, y: 180 }, { x: 310, y: 420 },
  { x: 820, y: 300 }, { x: 690, y: 180 }, { x: 690, y: 420 },
  { x: 500, y: 300 }
]);
const RESOLVE_OPTS = Object.freeze({ effects: false });

function initialState(seed = 1, mode = 'standard') {
  const random = C.randomSource(seed), bodies = P.kickoff(), stats = [];
  for (let i = 0; i < 6; i++) {
    const b = bodies[i];
    const model = U.decode(Uint8Array.from({ length: 128 }, () => Math.floor(random() * 256)));
    const classic = M.rule(mode, 'classic'), raw = classic ? {} : model.stats;
    stats.push(raw); M.applyStats(P, b, raw, mode);
    b.personality = model.personality;
    const superId = model.supers[0] % 8;
    const mastery = classic ? null : P.superMastery(model.supers, superId);
    b.equippedSuper = classic ? null : { ...P.SUPERS[superId], ...mastery };
    b.superBonusTicks = mastery?.bonusTicks || 0;
    b.superBonusRefund = mastery?.bonusRefund || 0;
    b.meter = classic ? 0 : Math.min(100, model.rating / 1020 * 100);
  }
  return { version: M.VERSION, mode, bodies, stats, scores: [0, 0], turn: 1, phase: 'plan', winner: null };
}

function kickoff(state) {
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

function choose(state, team, profile, seed) {
  const started = performance.now();
  if (profile === 'legacy' || profile === 'hold') {
    const plans = profile === 'legacy' ? C.legacy(state, team, C.randomSource(seed)) : [C.HOLD, C.HOLD, C.HOLD];
    return { plans, diagnostics: { milliseconds: performance.now() - started, simulations: 0 } };
  }
  return C.plan(state, team, { ...(typeof profile === 'string' ? { level: profile } : profile), seed });
}

function match({ seed = 1, mode = 'standard', profiles = ['medium', 'legacy'], maxTurns = 80, swapped = false, trace = false } = {}) {
  let state = initialState(seed, mode);
  if (swapped) {
    const bodies = state.bodies;
    for (let i = 0; i < 3; i++) {
      const a = bodies[i], b = bodies[i + 3];
      a.x = 1000 - a.x; b.x = 1000 - b.x;
      bodies[i] = b; bodies[i + 3] = a;
      b.team = 0; a.team = 1;
      [state.stats[i], state.stats[i + 3]] = [state.stats[i + 3], state.stats[i]];
    }
    profiles = [...profiles].reverse();
  }
  const timing = [[], []], simulations = [0, 0], turns = [];
  const fouls = { campingWarnings: [0, 0], cornerWarnings: 0, cards: [0, 0], cornerResets: 0 };
  let count = 0;
  while (state.winner === null && count < maxTurns) {
    const decisions = profiles.map((p, team) => choose(state, team, p, seed + count * 17 + (swapped ? 1 - team : team)));
    decisions.forEach((d, i) => { timing[i].push(d.diagnostics.milliseconds); simulations[i] += d.diagnostics.simulations; });
    const moves = [...decisions[0].plans, ...decisions[1].plans];
    const result = M.resolveTurn(P, state, moves, RESOLVE_OPTS);
    if (trace) turns.push({ turn: state.turn, plans: moves, goal: result.replay.goal, ticks: result.replay.ticks });
    state = result.state; count++;
    const side = team => swapped ? 1 - team : team, f = state.fouls;
    for (const team of [0, 1]) if (f.crease[team]) fouls.campingWarnings[side(team)]++;
    if (f.cornerTurns === M.FOULS.stallTurns) fouls.cornerWarnings++;
    for (const i of f.cards) fouls.cards[side(state.bodies[i].team)]++;
    if (f.faceoff) fouls.cornerResets++;
    if (state.phase === 'goal') kickoff(state);
  }
  return { seed, mode, swapped, profiles, scores: state.scores, winner: state.winner, turns: count, fouls,
    capped: state.winner === null, simulations, timing: timing.map(values => {
      values.sort((a, b) => a - b);
      return { meanMs: values.reduce((a, b) => a + b, 0) / values.length,
        p95Ms: values[Math.min(values.length - 1, Math.floor(values.length * .95))], maxMs: values[values.length - 1] };
    }), ...(trace ? { trace: turns } : {}) };
}

function scenarios() {
  const make = (name, positions) => {
    const state = initialState(7, 'classic');
    state.bodies.forEach((b, i) => { P.applyStats(b); b.personality = { aggression: 31, creativity: 40, teamwork: 40, clutch: 31 }; Object.assign(b, positions[i]); });
    return { name, state };
  };
  return [
    make('open-shot', [{x:180,y:120},{x:250,y:120},{x:250,y:480},{x:820,y:300},{x:300,y:300},{x:700,y:420},{x:230,y:300}]),
    make('goal-threat', [{x:700,y:300},{x:310,y:180},{x:310,y:420},{x:860,y:300},{x:690,y:180},{x:690,y:420},{x:790,y:300}]),
    make('screened-shot', [{x:180,y:300},{x:280,y:300},{x:310,y:420},{x:820,y:300},{x:560,y:300},{x:400,y:160},{x:490,y:300}]),
    make('corner-recovery', [{x:180,y:300},{x:310,y:180},{x:310,y:420},{x:820,y:300},{x:780,y:140},{x:690,y:420},{x:850,y:105}])
  ];
}

function scenarioReport(profile = 'hard') {
  return scenarios().map(({ name, state }) => {
    const decision = choose(state, 1, profile, 7);
    const outcomes = ['hold', 'legacy'].map(opponent => {
      const result = M.resolveTurn(P, state, [...choose(state, 0, opponent, 7).plans, ...decision.plans], RESOLVE_OPTS);
      return { opponent, goal: result.replay.goal, ball: { x: result.state.bodies[6].x, y: result.state.bodies[6].y } };
    });
    return { name, ...decision, outcomes };
  });
}

if (!isMainThread && workerData && workerData.sharedCtrl) {
  const ctrl = new Int32Array(workerData.sharedCtrl);
  const jobs = workerData.jobs;
  const out = [];
  for (;;) {
    const idx = Atomics.add(ctrl, 0, 1);
    if (idx >= jobs.length) break;
    out.push({ idx, result: match(jobs[idx]) });
  }
  parentPort.postMessage(out);
  return;
}

async function runCli() {
  const args = process.argv.slice(2), values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--games', '--turns', '--seed', '--a', '--b', '--mode', '--config', '--output', '--scenarios', '--trace', '--threads'].includes(key)) {
      throw new Error('Unknown option: ' + key);
    }
    if (['--scenarios', '--trace'].includes(key)) values[key.slice(2)] = true;
    else {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + key);
      values[key.slice(2)] = args[++i];
    }
  }
  const fs = require('node:fs');
  const config = values.config ? JSON.parse(fs.readFileSync(values.config, 'utf8')) : {};
  const profiles = [config.a || values.a || 'medium', config.b || values.b || 'legacy'];
  const games = values.games !== undefined ? Number(values.games) : 1;
  const maxTurns = values.turns !== undefined ? Number(values.turns) : 80;
  const seed = values.seed !== undefined ? Number(values.seed) : 1;
  const hwThreads = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const threads = values.threads !== undefined ? Number(values.threads) : Math.max(1, hwThreads);
  if (![games, maxTurns, seed, threads].every(Number.isInteger) || games < 1 || maxTurns < 1 || games > 1000 || maxTurns > 1000 || threads < 1) {
    throw new Error('Invalid simulation bounds.');
  }

  let results = [];
  if (!values.scenarios) {
    const jobs = [];
    for (let i = 0; i < games; i++) {
      for (const swapped of [false, true]) {
        jobs.push({ seed: seed + i, mode: values.mode || 'classic', profiles, maxTurns, swapped, trace: values.trace });
      }
    }
    if (threads === 1 || jobs.length <= 2) {
      for (const job of jobs) {
        const result = match(job);
        results.push(result);
        console.error(`Seed ${result.seed}${job.swapped ? ' swapped' : ''}: ${result.scores.join('-')}, ${result.turns} turns${result.capped ? ' (capped)' : ''}`);
      }
    } else {
      const sharedCtrl = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
      const workerCount = Math.min(threads, jobs.length);
      results = new Array(jobs.length);
      await new Promise((resolve, reject) => {
        let rem = workerCount;
        const workers = Array.from({ length: workerCount }, () => new Worker(__filename, { workerData: { sharedCtrl, jobs } }));
        for (const w of workers) {
          w.on('message', chunk => {
            for (const { idx, result } of chunk) results[idx] = result;
            w.terminate();
            if (--rem === 0) resolve();
          });
          w.on('error', err => { workers.forEach(wk => wk.terminate()); reject(err); });
        }
      });
      for (const result of results) {
        console.error(`Seed ${result.seed}${result.swapped ? ' swapped' : ''}: ${result.scores.join('-')}, ${result.turns} turns${result.capped ? ' (capped)' : ''}`);
      }
    }
  }
  const report = values.scenarios ? scenarioReport(profiles[0]) : {
    profiles, games: results.length,
    wins: [0, 1].map(p => results.filter(r => r.winner === (r.swapped ? 1 - p : p)).length),
    capped: results.filter(r => r.capped).length,
    fouls: (() => {
      const turns = results.reduce((n, r) => n + r.turns, 0), sum = key => results.reduce((n, r) => n + r.fouls[key], 0);
      const pair = key => [0, 1].map(p => results.reduce((n, r) => n + r.fouls[key][p], 0));
      return { turns, campingWarnings: pair('campingWarnings'), cornerWarnings: sum('cornerWarnings'), cards: pair('cards'), cornerResets: sum('cornerResets') };
    })(),
    results
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.output) fs.writeFileSync(values.output, json); else process.stdout.write(json);
}

if (require.main === module && isMainThread) {
  runCli().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { initialState, kickoff, choose, match, scenarios, scenarioReport };
