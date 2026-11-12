'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../shared/ububall-cpu.js');
const P = require('../shared/ububall-physics.js');
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
  // Each plan runs once per response, plus twice aimed a little off unless it trails or repeats.
  assert.ok(first.diagnostics.simulations >= 1 && first.diagnostics.simulations <= 18 * 3);
  assert.ok(state.bodies.slice(0, 6).every(b => Number.isFinite(b.meter)));
  M.validatePlans(first.plans);
  assert.throws(() => C.plan(state, 1, { candidates: Infinity }));
  assert.throws(() => C.plan(state, 1, { level: 'impossible' }));
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
test('CPU search accounts for a carried Pulse super', () => {
  const state = S.initialState(9, 'pulse'), active = state.bodies[3];
  active.superActive = 'colossus';
  active.superTicks = P.SUPER.ticks;
  P.syncEffectiveStats(active);
  const expired = structuredClone(state);
  expired.bodies[3].superActive = null;
  expired.bodies[3].superTicks = 0;
  P.syncEffectiveStats(expired.bodies[3]);
  const withSuper = C.plan(state, 1, { level: 'easy', candidates: 1, seed: 9 });
  const withoutSuper = C.plan(expired, 1, { level: 'easy', candidates: 1, seed: 9 });
  assert.notEqual(withSuper.diagnostics.score, withoutSuper.diagnostics.score);
});
test('Hard converts an open shot and defends the goal-threat fixture', () => {
  const results = S.scenarioReport('hard');
  assert.ok(results[0].outcomes.every(o => o.goal === 1));
  assert.ok(results[1].outcomes.every(o => o.goal !== 0));
  assert.ok(results.every(r => r.diagnostics.candidates === 120 && r.diagnostics.simulations <= 120 * (3 + 2)));
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
  state.bodies[0].superActive = 'magnet'; state.bodies[0].superTicks = 400;
  const first = client.plan(state, { level: 'hard' });
  state.bodies[0].x = 999;
  assert.notEqual(workers[0].data.state.bodies[0].x, 999);
  assert.equal(workers[0].data.state.bodies[0].superArm, false);
  assert.equal(workers[0].data.state.bodies[0].superActive, 'magnet');
  assert.equal(workers[0].data.state.bodies[0].superTicks, 400);
  const second = client.plan(state, { level: 'easy' });
  assert.equal(await first, null);
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({ data: { result: { plans: ['stale'] } } });
  workers[1].onmessage({ data: { result: { plans: ['current'] } } });
  assert.deepEqual(await second, { plans: ['current'] });
  // A worker that finished is reused; one that fails is terminated and replaced next time.
  const failed = client.plan(state, {});
  assert.equal(workers.length, 2);
  workers[1].onerror();
  assert.deepEqual(await failed, { error: true });
  assert.equal(workers[1].terminated, true);
  client.plan(state, {});
  assert.equal(workers.length, 3);
});

test('decided() does not cut off search while ball sits in a corner or skater slides toward crease, and Colossus strike accounts for swollen radius', () => {
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach(b => P.applyStats(b));
  Object.assign(bodies[6], { x: 95, y: 95, vx: 0, vy: 0 });
  Object.assign(bodies[0], { x: 500, y: 300, vx: 10, vy: 0 });
  assert.equal(C.decided(bodies), false, 'resting ball in corner is not prematurely marked decided');

  Object.assign(bodies[6], { x: 500, y: 300, vx: 0, vy: 0 });
  Object.assign(bodies[0], { x: 155, y: 300, vx: -200, vy: 0 });
  assert.equal(C.decided(bodies), false, 'skater sliding toward own crease is not prematurely marked decided');

  const shooter = P.kickoff()[0], ball = P.kickoff()[6];
  P.applyStats(shooter);
  Object.assign(shooter, { x: 400, y: 220 });
  Object.assign(ball, { x: 500, y: 300 });
  const normalAim = C.strike(shooter, ball, 940, 300, null);
  const colossusAim = C.strike(shooter, ball, 940, 300, 'colossus');
  assert.notEqual(normalAim.angle, colossusAim.angle, 'Colossus strike adjusts contact angle for uniform 1.5x max radius');
});

test('CPU search infers cooldown clock when omitted, sanitizes Classic supers, and curves around blockers', () => {
  const withHighTick = S.initialState(5, 'standard');
  withHighTick.bodies.slice(0, 6).forEach(b => { b.meter = 92; b.meterTick = 5000; });
  delete withHighTick.clock;
  const withExplicitClock = structuredClone(withHighTick);
  withExplicitClock.clock = 5000 + M.METER.cooldownTicks;
  const planInferred = C.plan(withHighTick, 1, { level: 'easy', seed: 5 });
  const planExplicit = C.plan(withExplicitClock, 1, { level: 'easy', seed: 5 });
  assert.deepEqual(planInferred.plans, planExplicit.plans, 'omitted clock infers cooled-down meter clock');
  assert.equal(planInferred.diagnostics.score, planExplicit.diagnostics.score);

  const classicDirty = S.initialState(6, 'classic');
  classicDirty.bodies.slice(0, 6).forEach(b => {
    b.equippedSuper = { ...P.SUPERS[0], bonusTicks: 0, bonusRefund: 0 };
    b.meter = 100;
  });
  const classicPlan = C.plan(classicDirty, 0, { level: 'easy', seed: 6 });
  assert.ok(classicPlan.plans.every(p => p.superArm === false), 'Classic CPU never arms residual supers');

  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach(b => P.applyStats(b));
  bodies.slice(0, 6).forEach((b, i) => Object.assign(b, { x: 780 + (i % 3) * 45, y: i < 3 ? 110 : 490, vx: 0, vy: 0 }));
  bodies[3].personality = { aggression: 60, creativity: 40, teamwork: 10, clutch: 32 };
  Object.assign(bodies[3], { x: 500, y: 300 });
  Object.assign(bodies[6], { x: 420, y: 300, vx: 0, vy: 0 });
  Object.assign(bodies[0], { x: 260, y: 314 });
  const basePlans = C.cpuPlans(bodies, () => 0.5, [0, 0]);
  assert.ok(basePlans[0].spin < 0, `striker chooses negative spin (${basePlans[0].spin}) so counter-rotation bends upward`);
  const sim = structuredClone(bodies);
  const zeroMove = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
  P.startTurn(sim, [zeroMove, zeroMove, zeroMove, ...basePlans]);
  sim[0].y = 500;
  for (let t = 0; t < 180; t++) P.step(sim, P.DT);
  assert.ok(sim[6].y < 260, `counter-rotated ball bends upward (y=${sim[6].y}) away from blocker at y=314`);
});

test('CPU worker client supports dispose(), handles onmessageerror, and catches non-cloneable state', async () => {
  const workers = [];
  const client = createClient(() => {
    const worker = { postMessage(data) { this.data = data; }, terminate() { this.terminated = true; } };
    workers.push(worker);
    return worker;
  });
  const state = S.initialState();
  const p1 = client.plan(state, { level: 'easy' });
  workers[0].onmessage({ data: { result: { plans: ['ok'] } } });
  assert.deepEqual(await p1, { plans: ['ok'] });
  assert.equal(workers[0].terminated, undefined, 'completed worker stays pooled while idle');

  const pErr = client.plan(state, { level: 'easy' });
  workers[0].onmessageerror();
  assert.deepEqual(await pErr, { error: true });
  assert.equal(workers[0].terminated, true, 'onmessageerror terminates corrupted worker');

  const badState = { ...state, uncloneable: () => {} };
  assert.deepEqual(await client.plan(badState, {}), { error: true });

  const pIdle = client.plan(state, { level: 'easy' });
  workers[1].onmessage({ data: { result: { plans: ['pooled'] } } });
  await pIdle;
  const pActive = client.plan(state, { level: 'hard' });
  client.dispose();
  assert.equal(await pActive, null);
  assert.equal(workers[1].terminated, true, 'dispose terminates pooled worker');
});
