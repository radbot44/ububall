'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/ububall-cpu.js');
const P = require('../web/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const S = require('../scripts/cpu-simulation.cjs');
const createClient = require('../web/ububall-cpu-client.js');

test('CPU search is reproducible, bounded and leaves public state unchanged', () => {
  const state = S.initialState(4), before = structuredClone(state);
  const first = C.plan(state, 1, { level: 'easy', seed: 4 });
  const second = C.plan(state, 1, { level: 'easy', seed: 4 });
  assert.deepEqual(first.plans, second.plans);
  assert.deepEqual(state, before);
  assert.equal(first.diagnostics.candidates, 18);
  assert.equal(first.diagnostics.simulations, 18);
  assert.ok(state.bodies.slice(0, 6).every(b => Number.isFinite(b.meter)));
  M.validatePlans(first.plans);
  assert.throws(() => C.plan(state, 1, { candidates: Infinity }));
  assert.throws(() => C.plan(state, 1, { level: 'impossible' }));
});
test('search ignores private arming flags and handles either team and stunned players', () => {
  const state = S.initialState(9);
  state.bodies[1].stunned = true;
  const first = C.plan(state, 0, { level: 'easy' });
  for (const b of state.bodies.slice(3, 6)) { b.superArm = true; b.superActive = 'magnet'; }
  const second = C.plan(state, 0, { level: 'easy' });
  assert.deepEqual(first.plans, second.plans);
  assert.equal(first.plans[1].power, 0);
  assert.equal(first.plans[1].superArm, false);
});
test('Hard converts an open shot and defends the goal-threat fixture', () => {
  const results = S.scenarioReport('hard');
  assert.ok(results[0].outcomes.every(o => o.goal === 1));
  assert.ok(results[1].outcomes.every(o => o.goal !== 0));
  assert.ok(results.every(r => r.diagnostics.simulations === 360));
});
test('CPU supers are legal and full simulations include guard and meter rules', () => {
  const state = S.initialState(17);
  state.bodies.slice(0, 6).forEach((b, i) => { b.meter = 100; b.equippedSuper = P.SUPERS[i]; });
  const a = C.plan(state, 0, { level: 'easy' }).plans, b = C.plan(state, 1, { level: 'easy' }).plans;
  const result = M.resolveTurn(P, state, [...a, ...b]);
  assert.ok(result.state.bodies.every(b => Number.isFinite(b.x) && Number.isFinite(b.y)));
  const classic = S.initialState(17, 'classic');
  assert.ok(C.plan(classic, 1, { level: 'easy' }).plans.every(p => !p.superArm));
  for (const superType of P.SUPERS) {
    state.bodies.slice(0, 6).forEach(b => { b.equippedSuper = superType; });
    const decision = C.plan(state, 1, { level: 'easy', candidates: 8 });
    assert.doesNotThrow(() => M.resolveTurn(P, state, [C.HOLD, C.HOLD, C.HOLD, ...decision.plans]));
  }
});
test('simulation records reproducible replays and capped games without declaring a winner', () => {
  const config = { profiles: ['easy', 'hold'], maxTurns: 2, trace: true, seed: 3 };
  const a = S.match(config), b = S.match(config);
  assert.deepEqual(a.trace, b.trace);
  assert.deepEqual(a.scores, b.scores);
  assert.equal(a.capped, true);
  assert.equal(a.winner, null);
  let state = S.initialState(3);
  for (const turn of a.trace) {
    const result = M.resolveTurn(P, state, turn.plans);
    assert.equal(result.replay.goal, turn.goal);
    assert.equal(result.replay.ticks, turn.ticks);
    state = result.state;
    if (state.phase === 'goal') S.kickoff(state);
  }
  assert.deepEqual(state.scores, a.scores);
});
test('worker client snapshots public state, cancels stale work and reports failure', async () => {
  const workers = [];
  const client = createClient(() => {
    const worker = { postMessage(data) { this.data = data; }, terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  });
  const state = S.initialState(); state.bodies[0].superArm = true;
  const first = client.plan(state, { level: 'hard' });
  state.bodies[0].x = 999;
  assert.notEqual(workers[0].data.state.bodies[0].x, 999);
  assert.equal(workers[0].data.state.bodies[0].superArm, false);
  const second = client.plan(state, { level: 'easy' });
  assert.equal(await first, null);
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: { result: { plans: ['stale'] } } });
  workers[1].onmessage({ data: { result: { plans: ['current'] } } });
  assert.deepEqual(await second, { plans: ['current'] });
  const failed = client.plan(state, {}); workers[2].onerror();
  assert.deepEqual(await failed, { error: true });
  assert.equal(workers[2].terminated, true);
});
