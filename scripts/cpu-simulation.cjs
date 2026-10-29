'use strict';
const P = require('../web/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const C = require('../shared/ububall-cpu.js');
const U = require('../shared/ubu.js');

function initialState(seed = 1, mode = 'standard') {
  const random = C.randomSource(seed), bodies = P.kickoff(), stats = [];
  for (const b of bodies.slice(0, 6)) {
    const model = U.decode(Uint8Array.from({ length: 128 }, () => Math.floor(random() * 256)));
    const raw = mode.includes('classic') ? {} : model.stats;
    stats.push(raw); P.applyStats(b, raw);
    b.personality = model.personality;
    b.equippedSuper = mode.includes('classic') ? null : P.SUPERS[model.supers[0] % 8];
    b.meter = mode.includes('classic') ? 0 : Math.min(100, model.rating / 1020 * 100);
  }
  return { version: 1, mode, bodies, stats, scores: [0, 0], turn: 1, scorelessTurns: 0, phase: 'plan', winner: null };
}
function kickoff(state) {
  const positions = P.kickoff();
  state.bodies.forEach((b, i) => {
    b.x = positions[i].x; b.y = positions[i].y;
    b.vx = b.vy = b.omega = 0;
  });
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
  let count = 0;
  while (state.winner === null && count < maxTurns) {
    const decisions = profiles.map((p, team) => choose(state, team, p, seed + count * 17 + (swapped ? 1 - team : team)));
    decisions.forEach((d, i) => { timing[i].push(d.diagnostics.milliseconds); simulations[i] += d.diagnostics.simulations; });
    const moves = decisions.flatMap(d => d.plans);
    const result = M.resolveTurn(P, state, moves);
    if (trace) turns.push({ turn: state.turn, plans: moves, goal: result.replay.goal, ticks: result.replay.ticks });
    state = result.state; count++;
    if (state.phase === 'goal') kickoff(state);
  }
  return { seed, mode, swapped, profiles, scores: state.scores, winner: state.winner, turns: count,
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
      const result = M.resolveTurn(P, state, [...choose(state, 0, opponent, 7).plans, ...decision.plans]);
      return { opponent, goal: result.replay.goal, ball: { x: result.state.bodies[6].x, y: result.state.bodies[6].y } };
    });
    return { name, ...decision, outcomes };
  });
}
if (require.main === module) {
  const args = process.argv.slice(2), values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--games', '--turns', '--seed', '--a', '--b', '--mode', '--config', '--output', '--scenarios', '--trace'].includes(key)) throw new Error('Unknown option: ' + key);
    values[key.slice(2)] = ['--scenarios', '--trace'].includes(key) ? true : args[++i];
  }
  const fs = require('node:fs');
  const config = values.config ? JSON.parse(fs.readFileSync(values.config, 'utf8')) : {};
  const profiles = [config.a || values.a || 'medium', config.b || values.b || 'legacy'];
  const games = Number(values.games || 1), maxTurns = Number(values.turns || 80), seed = Number(values.seed || 1);
  if (![games, maxTurns, seed].every(Number.isInteger) || games < 1 || maxTurns < 1 || games > 1000 || maxTurns > 1000) throw new Error('Invalid simulation bounds.');
  const results = [];
  if (!values.scenarios) for (let i = 0; i < games; i++) for (const swapped of [false, true]) {
    const result = match({ seed: seed + i, mode: values.mode || 'classic', profiles, maxTurns, swapped, trace: values.trace });
    results.push(result);
    console.error(`Seed ${result.seed}${swapped ? ' swapped' : ''}: ${result.scores.join('-')}, ${result.turns} turns${result.capped ? ' (capped)' : ''}`);
  }
  const report = values.scenarios ? scenarioReport(profiles[0]) : {
    profiles, games: results.length,
    wins: [0, 1].map(p => results.filter(r => r.winner === (r.swapped ? 1 - p : p)).length),
    capped: results.filter(r => r.capped).length, results
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.output) fs.writeFileSync(values.output, json); else process.stdout.write(json);
}
module.exports = { initialState, kickoff, choose, match, scenarios, scenarioReport };
