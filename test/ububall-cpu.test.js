'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/ububall-cpu.js');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const S = require('../scripts/cpu-simulation.cjs');
const createClient = require('../web/ububall-cpu-client.js');

test('CPU presets are reproducible and bounded, and missing Ballistic weights fall back to God', () => {
  assert.deepEqual(Object.keys(C.LEVELS), ['easy', 'medium', 'hard', 'insane', 'god', 'ballistic']);

  const state = S.initialState(4), before = structuredClone(state);
  const first = C.plan(state, 1, { level: 'easy', seed: 4 });
  const second = C.plan(state, 1, { level: 'easy', seed: 4 });
  assert.deepEqual(first.plans, second.plans);
  assert.deepEqual(state, before);
  assert.equal(first.diagnostics.candidates, C.LEVELS.easy.candidates);
  assert.ok(first.diagnostics.simulations >= 1 && first.diagnostics.simulations <= C.LEVELS.easy.candidates * 2);
  assert.ok(state.bodies.slice(0, 6).every(b => Number.isFinite(b.meter)));
  M.validatePlans(first.plans);

  for (const level of ['medium', 'hard', 'insane', 'god']) {
    const a = C.plan(state, 1, { level, seed: 12 });
    const b = C.plan(state, 1, { level, seed: 12 });
    assert.deepEqual(a.plans, b.plans, `${level} deterministic`);
    assert.equal(a.diagnostics.candidates, C.LEVELS[level].candidates);
    M.validatePlans(a.plans);
    if (level === 'god') {
      const fallback = C.plan(state, 1, { level: 'ballistic', seed: 12 });
      assert.deepEqual(fallback.plans, a.plans);
      assert.equal(fallback.diagnostics.level, 'god');
      assert.equal(fallback.diagnostics.score, a.diagnostics.score);
    }
  }
  assert.deepEqual(state, before);

  assert.throws(() => C.plan(state, 1, { candidates: Infinity }));
  assert.throws(() => C.plan(state, 1, { opponents: 6 }));
  assert.throws(() => C.plan(state, 1, { level: 'impossible' }));
  assert.throws(() => C.plan(state, 1, { level: 'ballistic', nn: false }), /hybrid neural search/);
});

test('search ignores private arming flags and handles either team and stunned players', () => {
  const state = S.initialState(9);
  state.bodies[1].stunned = true;
  const first = C.plan(state, 0, { level: 'easy' });
  for (const b of state.bodies.slice(3, 6)) b.superArm = true;
  const second = C.plan(state, 0, { level: 'easy' });
  assert.deepEqual(first.plans, second.plans);
  assert.equal(first.plans[1].power, 0);
  assert.equal(first.plans[1].superArm, false);
});

test('CPU supers are legal and full simulations include guard and meter rules', () => {
  const state = S.initialState(17);
  state.bodies.slice(0, 6).forEach((b, i) => { b.meter = 100; b.equippedSuper = P.SUPERS[i]; });
  const a = C.plan(state, 0, { level: 'insane' }).plans, b = C.plan(state, 1, { level: 'god' }).plans;
  const result = M.resolveTurn(P, state, [...a, ...b]);
  assert.ok(result.state.bodies.every(body => Number.isFinite(body.x) && Number.isFinite(body.y)));
  const classic = S.initialState(17, 'classic');
  assert.ok(C.plan(classic, 1, { level: 'god' }).plans.every(p => !p.superArm));
  for (const superType of P.SUPERS) {
    state.bodies.slice(0, 6).forEach(body => { body.equippedSuper = superType; });
    const decision = C.plan(state, 1, { level: 'easy', candidates: 8 });
    assert.doesNotThrow(() => M.resolveTurn(P, state, [C.HOLD, C.HOLD, C.HOLD, ...decision.plans]));
  }
});

test('worker client snapshots public state, cancels stale work, probes neural weights, recovers from errors, and disposes', async () => {
  const workers = [];
  const client = createClient(() => {
    const worker = { postMessage(data) { this.data = data; }, terminate() { this.terminated = true; } };
    workers.push(worker);
    return worker;
  });

  // Snapshot isolation & cancellation of stale plan
  const state = S.initialState();
  state.bodies[0].superArm = true;
  state.bodies[0].superActive = 'magnet';
  state.bodies[0].superTicks = 400;
  const first = client.plan(state, { level: 'god' });
  state.bodies[0].x = 999;
  assert.notEqual(workers[0].data.state.bodies[0].x, 999);
  assert.equal(workers[0].data.state.bodies[0].superArm, false);
  assert.equal(workers[0].data.state.bodies[0].superActive, 'magnet');
  assert.equal(workers[0].data.state.bodies[0].superTicks, 400);

  const second = client.plan(state, { level: 'easy' });
  assert.equal(await first, null);
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: { result: { plans: ['stale'] } } });

  // Concurrent neural-weight probe during active plan uses a separate worker
  const probeOk = client.hasNeuralWeights(true);
  assert.deepEqual(workers[2].data, { checkNeuralWeights: true, pulse: true });
  workers[2].onmessage({ data: { hasNeuralWeights: true } });
  assert.equal(await probeOk, true);
  assert.equal(workers[2].terminated, true);
  assert.equal(workers[1].terminated, undefined);

  workers[1].onmessage({ data: { result: { plans: ['current'] } } });
  assert.deepEqual(await second, { plans: ['current'] });
  assert.equal(workers[1].terminated, undefined, 'completed worker stays pooled while idle');

  // Idle probe error, onerror, onmessageerror, and non-cloneable state recovery
  const probeErr = client.hasNeuralWeights();
  assert.equal(workers.length, 3);
  assert.deepEqual(workers[1].data, { checkNeuralWeights: true, pulse: false });
  workers[1].onerror();
  assert.equal(await probeErr, false);
  assert.equal(workers[1].terminated, true);

  const failed = client.plan(state, {});
  assert.equal(workers.length, 4);
  workers[3].onerror();
  assert.deepEqual(await failed, { error: true });
  assert.equal(workers[3].terminated, true);

  const msgErr = client.plan(state, { level: 'easy' });
  assert.equal(workers.length, 5);
  workers[4].onmessageerror();
  assert.deepEqual(await msgErr, { error: true });
  assert.equal(workers[4].terminated, true);

  const badState = { ...state, uncloneable: () => {} };
  assert.deepEqual(await client.plan(badState, {}), { error: true });

  // dispose() cancels active work and terminates pooled worker
  const pActive = client.plan(state, { level: 'hard' });
  const lastWorker = workers[workers.length - 1];
  client.dispose();
  assert.equal(await pActive, null);
  assert.equal(lastWorker.terminated, true);
});
