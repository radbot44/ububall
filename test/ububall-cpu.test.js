'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../shared/ububall-cpu.js');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const S = require('../scripts/cpu-simulation.cjs');
const createClient = require('../web/ububall-cpu-client.js');

test('all 5 CPU difficulty tiers (Easy through Ububall God) are reproducible, bounded and leave public state unchanged', () => {
  assert.deepEqual(Object.keys(C.LEVELS), ['easy', 'medium', 'hard', 'insane', 'god']);
  assert.equal(C.LEVEL_LABELS.insane, 'Insane');
  assert.equal(C.LEVEL_LABELS.god, 'Ububall God');

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
  }
  assert.deepEqual(state, before);

  assert.throws(() => C.plan(state, 1, { candidates: Infinity }));
  assert.throws(() => C.plan(state, 1, { opponents: 6 }));
  assert.throws(() => C.plan(state, 1, { level: 'impossible' }));
});

test('two-rung adversarial screening keeps Medium and Hard simulation counts lean while converting tactical fixtures', () => {
  for (const level of ['hard', 'insane', 'god']) {
    const results = S.scenarioReport(level);
    assert.ok(results[0].outcomes.every(o => o.goal === 1), `${level} converts open-shot fixture`);
    assert.ok(results[1].outcomes.every(o => o.goal !== 0), `${level} defends goal-threat fixture`);
    assert.ok(results.every(r => r.diagnostics.candidates === C.LEVELS[level].candidates));
  }
  const medReport = S.scenarioReport('medium');
  const hardReport = S.scenarioReport('hard');
  const avgSims = list => list.reduce((n, r) => n + r.diagnostics.simulations, 0) / list.length;
  assert.ok(avgSims(medReport) <= 130, `Medium averages <= 130 simulations (got ${avgSims(medReport).toFixed(1)})`);
  assert.ok(avgSims(hardReport) <= 220, `Hard averages <= 220 simulations (got ${avgSims(hardReport).toFixed(1)})`);
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

test('CPU search accounts for a carried Pulse super and drives an active Sticky ball carrier into goal', () => {
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

  // Sticky carrier starting a Pulse turn near opponent goal drives ball across the goal line instead of stalling
  const stickyState = S.initialState(14, 'pulse');
  stickyState.bodies.slice(0, 6).forEach((b, i) => {
    Object.assign(b, { x: i < 3 ? 620 + i * 60 : 780, y: i < 3 ? 115 : 460, vx: 0, vy: 0, omega: 0, meter: 0 });
  });
  const carrier = stickyState.bodies[3], ball = stickyState.bodies[6];
  carrier.x = 240; carrier.y = 300;
  carrier.superActive = 'sticky';
  carrier.holding = true;
  carrier.superTicks = 480;
  carrier.superHoldTicks = 480;
  ball.stickOffset = { x: -(carrier.radius + ball.radius), y: 0 };
  ball.x = carrier.x + ball.stickOffset.x;
  ball.y = carrier.y;
  const carryDecision = C.plan(stickyState, 1, { level: 'hard', seed: 14 });
  const carryRes = M.resolveTurn(P, stickyState, [C.HOLD, C.HOLD, C.HOLD, ...carryDecision.plans], { effects: false });
  assert.equal(carryRes.replay.goal, 1, 'Sticky carrier drives ball directly into open net');
});

test('CPU supers are legal across all 5 levels and full simulations include guard and meter rules', () => {
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

test('spin-compensated aim/strike hits targets cleanly at Curve=255, Spin=255 where uncompensated spin whiffs', () => {
  const bodies = P.kickoff();
  for (let i = 0; i < 6; i++) {
    M.applyStats(P, bodies[i], { curve: 255, spin: 255, impulse: 180 }, 'standard');
    Object.assign(bodies[i], { x: 140 + i * 70, y: 500, vx: 0, vy: 0, omega: 0 });
  }
  const shooter = bodies[0], ball = bodies[6];
  Object.assign(shooter, { x: 470, y: 300, vx: 0, vy: 0, omega: 0 });
  Object.assign(ball, { x: 740, y: 300, vx: 0, vy: 0, omega: 0 });

  const compShot = C.strike(shooter, ball, 940, 300, null, 1);
  const rawStraight = C.strike(shooter, ball, 940, 300, null, 0);
  const uncompShot = { ...rawStraight, spin: 1 };

  const state = { version: M.VERSION, mode: 'standard', bodies, stats: Array(6).fill({ curve: 255, spin: 255, impulse: 180 }), scores: [0, 0], turn: 1, phase: 'plan', winner: null };
  const hold = C.HOLD;
  const resComp = M.resolveTurn(P, state, [compShot, hold, hold, hold, hold, hold], { effects: false });
  const resUncomp = M.resolveTurn(P, state, [uncompShot, hold, hold, hold, hold, hold], { effects: false });

  assert.equal(resComp.replay.goal, 0, 'spin-compensated Curve=255 strike converts open 260px shot');
  assert.equal(resUncomp.replay.goal, null, 'uncompensated straight angle with spin=1 curves wide and misses');
});

test('tactical puzzles: CPU converts screened bank/curve shot and finds zero-teamwork cross-ice one-timer pass in under 40 candidates', () => {
  const mkBase = mode => {
    const bodies = P.kickoff();
    const stats = Array.from({ length: 6 }, () => ({ impulse: 160, power: 170, spin: 200, curve: 200, synergy: 210, chemistry: 210 }));
    for (let i = 0; i < 6; i++) {
      M.applyStats(P, bodies[i], stats[i], mode);
      bodies[i].personality = { aggression: 32, creativity: 5, teamwork: 0, clutch: 32 };
      bodies[i].meter = 0;
    }
    return { version: M.VERSION, mode, bodies, stats, scores: [0, 0], turn: 1, phase: 'plan', winner: null };
  };

  // Puzzle 1: Direct lane to goal (940, 300) is screened by two defenders at x=820, y=280 & y=320; bank/curve lane is wide open
  const screened = mkBase('standard');
  Object.assign(screened.bodies[0], { x: 560, y: 300 });
  Object.assign(screened.bodies[1], { x: 200, y: 180 });
  Object.assign(screened.bodies[2], { x: 200, y: 420 });
  Object.assign(screened.bodies[3], { x: 820, y: 280, guarding: true });
  Object.assign(screened.bodies[4], { x: 820, y: 320, guarding: true });
  Object.assign(screened.bodies[5], { x: 180, y: 510 });
  Object.assign(screened.bodies[6], { x: 640, y: 300 });
  const decScreened = C.plan(screened, 0, {
    level: 'medium', candidates: 34, opponents: 2, wobble: false, temperature: 1, seed: 11
  });
  const outScreened = M.resolveTurn(P, screened, [...decScreened.plans, C.GUARD, C.GUARD, C.HOLD], { effects: false });
  assert.equal(outScreened.replay.goal, 0, 'Medium CPU converts screened shot via bank/curve in 34 candidates despite creativity=5');

  // Puzzle 2: Shooter at (565, 112) behind ball at (610, 165) has direct shot/bank walled off, while slot 1 sits open at (610, 360) with teamwork=0
  const passState = mkBase('standard');
  Object.assign(passState.bodies[0], { x: 565, y: 112 });
  Object.assign(passState.bodies[1], { x: 610, y: 360 });
  Object.assign(passState.bodies[2], { x: 180, y: 300 });
  Object.assign(passState.bodies[3], { x: 770, y: 220, guarding: true });
  Object.assign(passState.bodies[4], { x: 830, y: 255, guarding: true });
  Object.assign(passState.bodies[5], { x: 200, y: 500 });
  Object.assign(passState.bodies[6], { x: 610, y: 165 });
  const decPass = C.plan(passState, 0, {
    level: 'medium', candidates: 34, opponents: 2, wobble: false, temperature: 1, seed: 23
  });
  const outPass = M.resolveTurn(P, passState, [...decPass.plans, C.GUARD, C.GUARD, C.HOLD], { effects: false });
  assert.equal(outPass.replay.goal, 0, 'Medium CPU finds cross-ice Snap one-timer goal in 34 candidates even when teamwork=0');
});

test('shot-cone geometry stays strictly outside the 80 px crease and UI markup exposes all 5 CPU tiers in <= 3-per-row grid', () => {
  for (const team of [0, 1]) {
    for (const bx of [120, 350, 500, 750, 890]) {
      for (const by of [90, 200, 300, 420, 510]) {
        const pt = C.shotConePoint(bx, by, team, 88);
        const ownGoalX = team ? 940 : 60;
        assert.ok(Math.hypot(pt.x - ownGoalX, pt.y - 300) > M.FOULS.crease + 4, 'shotConePoint always clears crease radius');
      }
    }
  }

  const indexHtml = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  for (const val of ['easy', 'medium', 'hard', 'insane', 'god']) {
    assert.ok(indexHtml.includes(`name="cpu-level" value="${val}"`), `web/index.html includes radio for ${val}`);
  }
  assert.ok(indexHtml.includes('<span>Ububall God</span>'), 'web/index.html displays Ububall God label');

  const css = fs.readFileSync(path.join(__dirname, '../web/ububall.css'), 'utf8');
  assert.ok(css.includes('grid-template-columns: repeat(6, minmax(0, 1fr))'), '6-column spanned 3+2 grid keeps <= 3 items per row');
});
