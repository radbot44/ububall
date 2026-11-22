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

test('CPU presets are reproducible and bounded, and missing Ballistic weights fall back to God', () => {
  assert.deepEqual(Object.keys(C.LEVELS), ['easy', 'medium', 'hard', 'insane', 'god', 'ballistic']);
  assert.equal(C.LEVEL_LABELS.insane, 'Insane');
  assert.equal(C.LEVEL_LABELS.god, 'Ububall God');
  assert.equal(C.LEVEL_LABELS.ballistic, 'Ballistic');
  assert.deepEqual(C.LEVELS.ballistic, { ...C.LEVELS.god, nn: true, nnWeight: .55, nnPolicy: true, nnOpponent: true });

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

test('worker client can check neural availability during an active plan', async t => {
  const workers = [];
  const client = createClient(() => {
    const worker = { postMessage(data) { this.data = data; }, terminate() { this.terminated = true; } };
    workers.push(worker);
    return worker;
  });
  t.after(() => client.dispose());
  const plan = client.plan(S.initialState(), { level: 'god' });
  const available = client.hasNeuralWeights(true);
  assert.deepEqual(workers[1].data, { checkNeuralWeights: true, pulse: true });
  workers[1].onmessage({ data: { hasNeuralWeights: true } });
  assert.equal(await available, true);
  assert.equal(workers[1].terminated, true);
  assert.equal(workers[0].terminated, undefined);
  workers[0].onmessage({ data: { result: { plans: [] } } });
  assert.deepEqual(await plan, { plans: [] });

  const unavailable = client.hasNeuralWeights();
  assert.equal(workers.length, 2);
  assert.deepEqual(workers[0].data, { checkNeuralWeights: true, pulse: false });
  workers[0].onerror();
  assert.equal(await unavailable, false);
  assert.equal(workers[0].terminated, true);
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
  for (let t = 0; t < 120; t++) P.step(sim, P.DT);
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

test('shot-cone geometry clears the crease and six CPU tiers fit in a two-by-three grid', () => {
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
  const fieldset = indexHtml.match(/<fieldset id="cpu-levels"[^>]*>([\s\S]*?)<\/fieldset>/)[1];
  const tiers = [...fieldset.matchAll(/name="cpu-level" value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(tiers, Object.keys(C.LEVELS));
  assert.match(fieldset, /<label data-tier="ballistic" hidden>/);
  assert.ok(indexHtml.includes('<span>Ububall God</span>'), 'web/index.html displays Ububall God label');

  const css = fs.readFileSync(path.join(__dirname, '../web/ububall.css'), 'utf8');
  assert.match(css, /\.cpu-levels \{[^}]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.cpu-levels label \{[^}]*grid-column: span 2/);
  assert.match(css, /\.cpu-levels:has\(\[data-tier="ballistic"\]\[hidden\]\) label:nth-of-type\(n \+ 4\) \{ grid-column: span 3;/);
});

test('Hard+ adapts to resolved history on repeated setups and extreme style traits keep forced goals', () => {
  // Equal-strength style tie-breaking: extreme personality presets still convert an open shot.
  const open = S.initialState(9);
  Object.assign(open.bodies[0], { x: 470, y: 300, vx: 0, vy: 0, omega: 0 });
  Object.assign(open.bodies[1], { x: 180, y: 120, vx: 0, vy: 0, omega: 0 });
  Object.assign(open.bodies[2], { x: 180, y: 480, vx: 0, vy: 0, omega: 0 });
  for (let i = 3; i < 6; i++) Object.assign(open.bodies[i], { x: 120 + i * 35, y: 510, vx: 0, vy: 0, omega: 0 });
  Object.assign(open.bodies[6], { x: 740, y: 300, vx: 0, vy: 0, omega: 0 });
  for (const traits of [
    { aggression: 63, creativity: 0, teamwork: 0, clutch: 63 },
    { aggression: 0, creativity: 63, teamwork: 63, clutch: 0 }
  ]) {
    const s = structuredClone(open);
    for (let i = 0; i < 3; i++) s.bodies[i].personality = traits;
    const dec = C.plan(s, 0, { level: 'medium', seed: 5 });
    const out = M.resolveTurn(P, s, [...dec.plans, C.HOLD, C.HOLD, C.HOLD], { effects: false });
    assert.equal(out.replay.goal, 0, 'extreme style traits never sacrifice a forced goal');
  }

  // Behavior learning: repeated kickoff blitz history lets Hard block an unorthodox rush without mutating inputs.
  const kState = S.initialState(2);
  kState.roundTurns = 0;
  const blitz = [
    C.strike(kState.bodies[0], kState.bodies[6], 940, 300),
    C.aim(kState.bodies[1], 760, 220, 220),
    C.aim(kState.bodies[2], 760, 380, 220)
  ];
  const history = [{ roundTurns: 0, bodies: kState.bodies.map(b => ({ ...b })), plans: [...blitz, C.HOLD, C.HOLD, C.HOLD] }];
  const stateSnap = structuredClone(kState), histSnap = structuredClone(history);

  const withoutHist = C.plan(kState, 1, { level: 'hard', seed: 19 });
  const withHist = C.plan(kState, 1, { level: 'hard', seed: 19, history });
  assert.deepEqual(kState, stateSnap);
  assert.deepEqual(history, histSnap);
  assert.ok(withHist.plans.length === 3 && withoutHist.plans.length === 3);

  const resWithHist = M.resolveTurn(P, kState, [...blitz, ...withHist.plans], { effects: false });
  assert.notEqual(resWithHist.replay.goal, 0, 'Hard with kickoff blitz history prevents the kickoff blitz goal');
});

test('truncated coast distinguishes open nets from goalie blocks, Pulse scores unstoppable carry-over rockets, and charged Supers hold reserve value', () => {
  // 1. Truncated Standard coast sees impending open-net goals and stops at guarding goalies
  const cState = S.initialState(4, 'standard');
  cState.bodies.slice(0, 6).forEach((b, i) => Object.assign(b, { x: 500, y: i < 3 ? 110 : 490, vx: 0, vy: 0, meter: 0 }));
  Object.assign(cState.bodies[3], { x: 340, y: 300 });
  Object.assign(cState.bodies[6], { x: 220, y: 300, vx: 0, vy: 0 });
  const openDec = C.plan(cState, 1, { level: 'easy', candidates: 8, searchTicks: 60, seed: 4 });
  const blockedState = structuredClone(cState);
  Object.assign(blockedState.bodies[0], { x: 95, y: 300, guarding: true });
  const blockedDec = C.plan(blockedState, 1, { level: 'easy', candidates: 8, searchTicks: 60, seed: 4 });
  assert.ok(openDec.diagnostics.score > 7000, `open-net truncated coast awards impending goal equity (got ${openDec.diagnostics.score})`);
  assert.ok(blockedDec.diagnostics.score < 1000, `goalie in crease blocks truncated coast goal credit (got ${blockedDec.diagnostics.score})`);

  // 2. Pulse end-of-turn velocity look-ahead detects unstoppable goal-mouth rockets antisymmetrically
  const pState = S.initialState(4, 'pulse');
  pState.bodies.slice(0, 6).forEach((b, i) => Object.assign(b, { x: 500, y: i < 3 ? 110 : 490, vx: 0, vy: 0, meter: 0 }));
  Object.assign(pState.bodies[6], { x: 890, y: 300, vx: 0, vy: 0 });
  const stoppedEval = C.evaluate(pState, 1, null, C.WEIGHTS);
  pState.bodies[6].vx = 700;
  const ownNetRocket = C.evaluate(pState, 1, null, C.WEIGHTS);
  const oppPerspective = C.evaluate(pState, 0, null, C.WEIGHTS);
  assert.ok(ownNetRocket < stoppedEval - 5000, `Pulse penalizes unstoppable rocket into own net (${ownNetRocket} vs ${stoppedEval})`);
  assert.ok(Math.abs(ownNetRocket + oppPerspective) < 1e-6, 'Pulse velocity evaluation remains antisymmetric');

  // 3. Charged 100-meter Super reserve discourages zero-gain neutral waste
  const rState = S.initialState(8, 'standard');
  rState.bodies.slice(0, 6).forEach(b => { b.meter = 0; });
  rState.bodies[3].meter = 95;
  const at95 = C.evaluate(rState, 1, null, C.WEIGHTS);
  rState.bodies[3].meter = 100;
  const at100 = C.evaluate(rState, 1, null, C.WEIGHTS);
  assert.ok(at100 - at95 > 25, `crossing 100 meter adds charged Super reserve equity (delta=${(at100 - at95).toFixed(2)})`);
});

test('Magnet/Shockwave plays, defensive fire drills, multi-kickoff memory, and offensive habit adaptation work cleanly', () => {
  // 1. Non-contact Magnet fly-by & Shockwave cluster wedge candidates in options()
  const supState = S.initialState(11, 'standard');
  const magnetSuper = P.SUPERS.find(s => s.key === 'magnet');
  const shockSuper = P.SUPERS.find(s => s.key === 'shockwave');
  Object.assign(supState.bodies[3], { x: 380, y: 300, meter: 100, equippedSuper: magnetSuper });
  Object.assign(supState.bodies[6], { x: 460, y: 300 });
  const magOpts = C.options(supState, 1, 0, C.HOLD);
  assert.ok(magOpts.some(m => m.superArm && m.power > 0.4), 'Magnet skater ahead of ball generates armed fly-by pull candidates');

  Object.assign(supState.bodies[0], { x: 160, y: 270 });
  Object.assign(supState.bodies[1], { x: 165, y: 330 });
  Object.assign(supState.bodies[3], { x: 320, y: 300, meter: 100, equippedSuper: shockSuper });
  const shockOpts = C.options(supState, 1, 0, C.HOLD);
  assert.ok(shockOpts.some(m => m.superArm && Math.abs(m.angle - Math.PI) < 0.25 && m.power > 0.4), 'Shockwave skater generates cluster-midpoint crease blast');

  // 2. Coordinated defensive fire drill in jointTeamPlays when own goal is threatened
  const defCrisis = S.initialState(12, 'standard');
  Object.assign(defCrisis.bodies[6], { x: 810, y: 300, vx: 0, vy: 0 });
  Object.assign(defCrisis.bodies[0], { x: 745, y: 300, vx: 0, vy: 0 });
  Object.assign(defCrisis.bodies[3], { x: 840, y: 180, stunned: true });
  Object.assign(defCrisis.bodies[4], { x: 760, y: 190, stunned: false });
  Object.assign(defCrisis.bodies[5], { x: 720, y: 410, stunned: false });
  const baseDef = C.legacy(defCrisis, 1);
  const jointDef = C.jointTeamPlays(defCrisis, 1, baseDef, ['defend', 'attack', 'support']);
  assert.ok(jointDef.length >= 1 && jointDef[0][1].power > 0.3 && jointDef[0][2].power > 0.3, 'Defensive fire drill mobilizes both unstunned skaters during crease crisis');

  // 3. Multi-kickoff memory remembers alternating kickoff plays instead of forgetting play A after decoy B
  const kState = S.initialState(2, 'standard');
  kState.roundTurns = 0;
  const blitzA = [
    C.strike(kState.bodies[0], kState.bodies[6], 940, 300),
    C.aim(kState.bodies[1], 760, 220, 220),
    C.aim(kState.bodies[2], 760, 380, 220)
  ];
  const decoyB = [
    C.aim(kState.bodies[0], 200, 140, 80),
    C.GUARD,
    C.GUARD
  ];
  const altHistory = [
    { roundTurns: 0, bodies: kState.bodies.map(b => ({ ...b })), plans: [...blitzA, C.HOLD, C.HOLD, C.HOLD] },
    { roundTurns: 0, bodies: kState.bodies.map(b => ({ ...b })), plans: [...decoyB, C.HOLD, C.HOLD, C.HOLD] },
    { roundTurns: 0, bodies: kState.bodies.map(b => ({ ...b })), plans: [...blitzA, C.HOLD, C.HOLD, C.HOLD] },
    { roundTurns: 0, bodies: kState.bodies.map(b => ({ ...b })), plans: [...decoyB, C.HOLD, C.HOLD, C.HOLD] }
  ];
  const learnedKickoffs = C.learnedOpponentResponses(kState, 1, false, altHistory, 2);
  assert.equal(learnedKickoffs.length, 2, 'retains both alternating kickoff setups');
  const altDecision = C.plan(kState, 1, { level: 'hard', seed: 19, history: altHistory });
  const altRes = M.resolveTurn(P, kState, [...blitzA, ...altDecision.plans], { effects: false });
  assert.notEqual(altRes.replay.goal, 0, 'Hard blocks recurring blitzA even when decoyB was played most recently');

  // 4. Offensive habit tracking adapts to repeated wall-bank shots on mid-round turns
  const midState = S.initialState(7, 'standard');
  midState.roundTurns = 3;
  Object.assign(midState.bodies[0], { x: 440, y: 260, vx: 0, vy: 0 });
  Object.assign(midState.bodies[6], { x: 520, y: 260, vx: 0, vy: 0 });
  const bankHistory = Array.from({ length: 4 }, (_, idx) => {
    const bx = 520 + (idx + 3) * 35;
    const hBodies = midState.bodies.map((b, bi) => ({ x: bi === 6 ? bx : (bi === 0 ? bx - 80 : b.x), y: b.y, meter: 0, stunned: false, carded: false }));
    const shot = C.strike({ ...midState.bodies[0], x: bx - 80 }, { ...midState.bodies[6], x: bx }, 940, 2 * (60 + 18) - 300);
    return { roundTurns: idx + 1, bodies: hBodies, plans: [shot, C.HOLD, C.HOLD, C.HOLD, C.HOLD, C.HOLD] };
  });
  const legOpp = C.legacy(midState, 0);
  const bankOpp = C.learnedOpponentResponse(midState, 1, false, bankHistory);
  assert.ok(bankOpp && Math.abs(Math.sin(bankOpp[0].angle - legOpp[0].angle)) > 0.2, 'habit model shifts predicted shot toward opponent favored wall bank');
});

test('selective 2-turn look-ahead bridges finishTurn stuns to convert 2-turn Knockout setups and bounds 3-turn Pulse God chains', () => {
  // 1. Walled goal mouth where Turn-1 Knockout stuns defender so Turn 2 converts an open net across two resolved turns
  const koState = S.initialState(6, 'standard');
  const koSuper = P.SUPERS.find(sup => sup.key === 'knockout');
  koState.bodies.slice(0, 6).forEach(b => {
    M.applyStats(P, b, { impulse: 170, power: 180, size: 180 }, 'standard');
    b.meter = 0; b.equippedSuper = null; b.vx = 0; b.vy = 0; b.omega = 0; b.stunned = false;
  });
  Object.assign(koState.bodies[0], { x: 150, y: 300, guarding: true });
  Object.assign(koState.bodies[1], { x: 840, y: 110, stunned: true });
  Object.assign(koState.bodies[2], { x: 840, y: 490, stunned: true });
  Object.assign(koState.bodies[3], { x: 850, y: 300 });
  Object.assign(koState.bodies[4], { x: 355, y: 300 });
  Object.assign(koState.bodies[5], { x: 245, y: 295, meter: 100, equippedSuper: koSuper });
  Object.assign(koState.bodies[6], { x: 270, y: 300 });

  const oneTurn = C.plan(koState, 1, { level: 'insane', candidates: 90, lookaheadTop: 0, seed: 4 });
  const twoTurn = C.plan(koState, 1, { level: 'insane', candidates: 90, seed: 4 });
  assert.ok(twoTurn.diagnostics.score > oneTurn.diagnostics.score + 2000,
    `2-turn look-ahead detects post-Knockout Turn-2 goal (${twoTurn.diagnostics.score} vs ${oneTurn.diagnostics.score})`);

  const t1Res = M.resolveTurn(P, koState, [C.GUARD, C.HOLD, C.HOLD, ...twoTurn.plans], { effects: false });
  assert.equal(t1Res.state.bodies[0].stunned, true, 'screen defender enters Turn 2 stunned after finishTurn');
  const t2Plan = C.plan(t1Res.state, 1, { level: 'insane', candidates: 60, seed: 7 });
  const t2Res = M.resolveTurn(P, t1Res.state, [C.HOLD, C.GUARD, C.GUARD, ...t2Plan.plans], { effects: false });
  assert.ok(t1Res.replay.goal === 1 || t2Res.replay.goal === 1, 'Insane CPU converts walled net within 2 turns via Knockout stun');

  // 2. Ububall God 3-turn Pulse chaining is deterministic, bounded by lookaheadBudget, and leaves state untouched
  const pGodState = S.initialState(10, 'pulse');
  const snapBefore = structuredClone(pGodState);
  const pg1 = C.plan(pGodState, 1, { level: 'god', candidates: 48, seed: 10 });
  const pg2 = C.plan(pGodState, 1, { level: 'god', candidates: 48, seed: 10 });
  const pgNoT2 = C.plan(pGodState, 1, { level: 'god', candidates: 48, lookaheadTop: 0, seed: 10 });
  assert.deepEqual(pg1.plans, pg2.plans, '3-turn Pulse God planning is deterministic');
  assert.deepEqual(pGodState, snapBefore, '3-turn Pulse God leaves input state untouched');
  assert.ok(pg1.diagnostics.simulations > pgNoT2.diagnostics.simulations &&
    pg1.diagnostics.simulations <= pgNoT2.diagnostics.simulations + 120,
    `lookaheadBudget stays bounded (got ${pg1.diagnostics.simulations} vs ${pgNoT2.diagnostics.simulations})`);

  assert.throws(() => C.plan(pGodState, 1, { level: 'god', pulseDepth: 5 }));
  assert.throws(() => C.plan(pGodState, 1, { level: 'god', lookaheadTop: -1 }));
  assert.throws(() => C.plan(pGodState, 1, { level: 'god', lookaheadBudget: 999 }));
});

test('CPU goaltending upgrades: legal crease pocket, live Pulse goal-line saves, midfield Cannonball & Guard Iron Saves', () => {
  // 1. Legal 44 px crease pocket when defender is alone vs 88 px cone fallback when crease-warned or joined by teammate
  const pocketState = S.initialState(15, 'standard');
  pocketState.bodies.slice(0, 6).forEach((b, i) => {
    Object.assign(b, { x: i < 3 ? 260 : 520, y: 150 + (i % 3) * 140, vx: 0, vy: 0, meter: 0, stunned: false, carded: false });
  });
  Object.assign(pocketState.bodies[3], { x: 892, y: 300 });
  Object.assign(pocketState.bodies[6], { x: 640, y: 260, vx: 0, vy: 0 });
  assert.equal(C.canOccupyCrease(pocketState, 1, 0), true, 'lone goalie without warning can occupy crease pocket');
  const pPt = C.goalPocketPoint(640, 260, 1, true);
  assert.ok(940 - pPt.x < M.FOULS.crease && 940 - pPt.x >= 40, `pocket sits legally inside 80 px crease (got x=${pPt.x})`);

  // Second defender near crease blocks pocket entry so CPU avoids 2-defender Goal Camping foul
  Object.assign(pocketState.bodies[4], { x: 865, y: 312 });
  assert.equal(C.canOccupyCrease(pocketState, 1, 0), false, 'teammate near crease disables in-crease pocket');
  const fallbackPt = C.goalPocketPoint(640, 260, 1, false);
  assert.equal(fallbackPt.x, C.shotConePoint(640, 260, 1, 88).x);

  // Active Goal Camping warning also blocks pocket entry
  Object.assign(pocketState.bodies[4], { x: 520, y: 180 });
  pocketState.fouls = { ...M.newFouls(), crease: [false, true] };
  assert.equal(C.canOccupyCrease(pocketState, 1, 0), false, 'active crease warning disables pocket');

  // 2. traceIncomingShot detects direct & wall-banked Pulse rockets and CPU dives to the goal line to save them
  const pulseBank = S.initialState(16, 'pulse');
  pulseBank.bodies.slice(0, 6).forEach((b, i) => {
    M.applyStats(P, b, { impulse: 195 }, 'pulse');
    Object.assign(b, { x: i < 3 ? 260 : 430, y: 140 + (i % 3) * 150, vx: 0, vy: 0, omega: 0, meter: 0 });
  });
  Object.assign(pulseBank.bodies[3], { x: 904, y: 356 });
  let bankVy = -220;
  for (let vy = -140; vy >= -440; vy -= 10) {
    Object.assign(pulseBank.bodies[6], { x: 600, y: 136, vx: 740, vy, omega: 0, strikerTeam: 0 });
    if (M.resolveTurn(P, pulseBank, Array(6).fill(C.HOLD), { effects: false }).replay.goal === 0) { bankVy = vy; break; }
  }
  Object.assign(pulseBank.bodies[6], { x: 600, y: 136, vx: 740, vy: bankVy, omega: 0, strikerTeam: 0 });
  const inc = C.traceIncomingShot(pulseBank.bodies[6], 1);
  assert.ok(inc && inc.crosses && inc.bounces >= 1, 'traceIncomingShot detects top-wall bank into right goal');
  assert.equal(C.traceIncomingShot(pulseBank.bodies[6], 1, inc.time / 2), null, 'a shorter trace does not reuse the longer horizon');
  assert.deepEqual(C.traceIncomingShot(pulseBank.bodies[6], 1), inc, 'a shorter trace does not hide a later shot');
  const pulseSaveDec = C.plan(pulseBank, 1, { level: 'medium', seed: 7 });
  const pulseSaveRes = M.resolveTurn(P, pulseBank, [C.HOLD, C.HOLD, C.HOLD, ...pulseSaveDec.plans], { effects: false });
  assert.notEqual(pulseSaveRes.replay.goal, 0, 'Medium CPU intercepts moving Pulse bank shot at the goal mouth');

  // 3. Midfield Cannonball threat (< x=545) triggers defensive alert & save
  const midCannon = S.initialState(18, 'standard');
  const cannonball = P.SUPERS.find(s => s.key === 'cannonball');
  midCannon.bodies.slice(0, 6).forEach((b, i) => {
    M.applyStats(P, b, i === 0 ? { power: 225, impulse: 195 } : { impulse: 155 }, 'standard');
    Object.assign(b, { vx: 0, vy: 0, omega: 0, meter: 0, equippedSuper: null });
  });
  Object.assign(midCannon.bodies[0], { x: 430, y: 300, meter: 100, equippedSuper: cannonball });
  Object.assign(midCannon.bodies[1], { x: 210, y: 190 });
  Object.assign(midCannon.bodies[2], { x: 210, y: 410 });
  Object.assign(midCannon.bodies[3], { x: 865, y: 375 });
  Object.assign(midCannon.bodies[4], { x: 565, y: 215 });
  Object.assign(midCannon.bodies[5], { x: 350, y: 465 });
  Object.assign(midCannon.bodies[6], { x: 505, y: 300, vx: 0, vy: 0 });
  const threat = C.assessOpponentThreat(midCannon, 1, false);
  assert.equal(threat.shotDanger, true, 'midfield Cannonball at x=505 flags shotDanger');
  assert.equal(threat.fireballThreat, true, 'armed Cannonball striker flags fireballThreat');
  const laser = { ...C.strike(midCannon.bodies[0], midCannon.bodies[6], 940, 258, 'cannonball', 0), power: 1, superArm: true };
  assert.equal(M.resolveTurn(P, midCannon, [laser, C.GUARD, C.GUARD, C.HOLD, C.HOLD, C.HOLD], { effects: false }).replay.goal, 0);
  const midSaveDec = C.plan(midCannon, 1, { level: 'hard', seed: 7 });
  const midSaveRes = M.resolveTurn(P, midCannon, [laser, C.GUARD, C.GUARD, ...midSaveDec.plans], { effects: false });
  assert.notEqual(midSaveRes.replay.goal, 0, 'Hard CPU saves midfield Cannonball top-corner laser');

  // 4. Close fireball Wide-Stance Guard Iron Save (holds ground where un-guarded HOLD concedes)
  const fireGuard = S.initialState(21, 'standard');
  fireGuard.bodies.slice(0, 6).forEach((b, i) => {
    const st = i === 0 ? { power: 255, mass: 240, impulse: 230 }
      : i === 3 ? { mass: 120, stability: 135, size: 127, reach: 210 }
      : {};
    M.applyStats(P, b, st, 'standard');
    Object.assign(b, { vx: 0, vy: 0, omega: 0, meter: 0, equippedSuper: null, guarding: false });
    P.syncEffectiveStats(b);
  });
  Object.assign(fireGuard.bodies[0], { x: 605, y: 300, meter: 100, equippedSuper: cannonball });
  Object.assign(fireGuard.bodies[1], { x: 200, y: 190 });
  Object.assign(fireGuard.bodies[2], { x: 200, y: 410 });
  Object.assign(fireGuard.bodies[4], { x: 350, y: 120 });
  Object.assign(fireGuard.bodies[5], { x: 350, y: 480 });
  Object.assign(fireGuard.bodies[6], { x: 685, y: 300 });
  let glanceShot = null;
  for (const gx of [852, 872, 892]) {
    for (const gy of [300, 308, 314]) {
      Object.assign(fireGuard.bodies[3], { x: gx, y: gy, guarding: false });
      P.syncEffectiveStats(fireGuard.bodies[3]);
      for (let ty = 244; ty <= 356; ty += 2) {
        const opp = [{ ...C.strike(fireGuard.bodies[0], fireGuard.bodies[6], 940, ty, 'cannonball', 0), power: 1, superArm: true }, C.GUARD, C.GUARD];
        const rH = M.resolveTurn(P, fireGuard, [...opp, C.HOLD, C.HOLD, C.HOLD], { effects: false });
        const rG = M.resolveTurn(P, fireGuard, [...opp, C.GUARD, C.HOLD, C.HOLD], { effects: false });
        if (rH.replay.goal === 0 && rG.replay.goal === null) { glanceShot = opp; break; }
      }
      if (glanceShot) break;
    }
    if (glanceShot) break;
  }
  assert.ok(glanceShot, 'constructed glancing Cannonball shot requiring Wide-Stance Guard');
  const fgDec = C.plan(fireGuard, 1, { level: 'hard', seed: 7 });
  const fgRes = M.resolveTurn(P, fireGuard, [...glanceShot, ...fgDec.plans], { effects: false });
  assert.notEqual(fgRes.replay.goal, 0, 'Hard CPU preserves Guard anchor in topBasins and blocks glancing Cannonball');
});

test('CPU shooting upgrades: full-force fireballs, point-blank Spin Strike, shoulder benders, Meteor Banks & wall-rebound one-timers', () => {
  const cannonball = P.SUPERS.find(s => s.key === 'cannonball');
  const mkState = (mode, overrides = {}) => {
    const bodies = P.kickoff();
    const stats = Array.from({ length: 6 }, (_, i) => ({
      impulse: 145, traction: 135, spin: 150, curve: 150,
      size: 127, mass: 127, bounciness: 127, grip: 140,
      power: 165, reach: 135, strength: 140, stability: 135,
      efficiency: 127, synergy: 150, chemistry: 150,
      ...(overrides[i] || {})
    }));
    for (let i = 0; i < 6; i++) {
      M.applyStats(P, bodies[i], stats[i], mode);
      bodies[i].personality = { aggression: 32, creativity: 32, teamwork: 32, clutch: 32 };
      bodies[i].meter = 0;
      bodies[i].equippedSuper = null;
      bodies[i].vx = 0; bodies[i].vy = 0; bodies[i].omega = 0;
    }
    return { version: M.VERSION, mode, bodies, stats, scores: [0, 0], turn: 2, roundTurns: 2, phase: 'plan', winner: null, fouls: M.newFouls() };
  };

  // 1. Full-force priority & fast-goal tie-breaker: Medium CPU launches at full power (1.0) to outrace a diving goalie
  const race = mkState('standard', { 0: { impulse: 220, size: 155 }, 3: { power: 220, impulse: 205 } });
  Object.assign(race.bodies[1], { x: 760, y: 140 });
  Object.assign(race.bodies[2], { x: 760, y: 460 });
  Object.assign(race.bodies[3], { x: 385, y: 300 });
  Object.assign(race.bodies[4], { x: 780, y: 200 });
  Object.assign(race.bodies[5], { x: 860, y: 300 });
  Object.assign(race.bodies[6], { x: 325, y: 300 });
  let diveOpp = null;
  for (const sy of [355, 375, 405, 435]) {
    Object.assign(race.bodies[0], { x: 96, y: sy });
    for (const dy of [248, 258, 270, 285]) {
      for (const pwr of [0.35, 0.50, 0.65, 0.80]) {
        const cand = [{ ...C.aim(race.bodies[0], 96, dy, 260), power: pwr }, C.HOLD, C.HOLD];
        const weak = C.strike(race.bodies[3], race.bodies[6], 60, 252, null, 0);
        const full = { ...weak, power: 1 };
        if (M.resolveTurn(P, race, [...cand, weak, C.HOLD, C.HOLD], { effects: false }).replay.goal === null &&
            M.resolveTurn(P, race, [...cand, full, C.HOLD, C.HOLD], { effects: false }).replay.goal === 1) {
          diveOpp = cand; break;
        }
      }
      if (diveOpp) break;
    }
    if (diveOpp) break;
  }
  assert.ok(diveOpp, 'found speed-race goalie dive');
  const raceDec = C.plan(race, 1, { level: 'medium', seed: 7 });
  assert.ok(raceDec.plans[0].power >= 0.96, `CPU launches full-force shot (got power=${raceDec.plans[0].power})`);
  assert.equal(M.resolveTurn(P, race, [...diveOpp, ...raceDec.plans], { effects: false }).replay.goal, 1, 'full-force shot beats diving goalie');

  // 2. Point-blank Spin Strike (+50% bonus speed) & Goalie-bypassing curved bender around center Guard
  const curveSt = mkState('standard', {
    0: { size: 130, reach: 130, mass: 200, stability: 200 },
    3: { curve: 250, spin: 250, power: 225, impulse: 205 }
  });
  Object.assign(curveSt.bodies[0], { x: 205, y: 300, guarding: true });
  Object.assign(curveSt.bodies[1], { x: 235, y: 88, guarding: true });
  Object.assign(curveSt.bodies[2], { x: 235, y: 512, guarding: true });
  Object.assign(curveSt.bodies[3], { x: 475, y: 300 });
  Object.assign(curveSt.bodies[4], { x: 760, y: 160 });
  Object.assign(curveSt.bodies[5], { x: 860, y: 300 });
  Object.assign(curveSt.bodies[6], { x: 395, y: 300 });
  P.syncEffectiveStats(curveSt.bodies[0]);
  const curveDec = C.plan(curveSt, 1, { level: 'hard', seed: 7 });
  const curveRes = M.resolveTurn(P, curveSt, [C.GUARD, C.GUARD, C.GUARD, ...curveDec.plans], { effects: false });
  assert.equal(curveRes.replay.goal, 1, 'Hard CPU curves shot wide around squared-up slot Guard blocker');
  assert.ok(curveDec.plans[0].power >= 0.65 && Math.abs(curveDec.plans[0].spin) > 0.5, `uses high-power curved shot around blocker (got power=${curveDec.plans[0].power})`);
  const pbSt = mkState('standard', { 0: { impulse: 250, size: 165 }, 3: { power: 25, spin: 250, curve: 100, impulse: 185 } });
  Object.assign(pbSt.bodies[0], { x: 102, y: 382 });
  Object.assign(pbSt.bodies[1], { x: 780, y: 130 });
  Object.assign(pbSt.bodies[2], { x: 780, y: 470 });
  Object.assign(pbSt.bodies[3], { x: 318, y: 300 });
  Object.assign(pbSt.bodies[4], { x: 760, y: 210 });
  Object.assign(pbSt.bodies[5], { x: 860, y: 300 });
  Object.assign(pbSt.bodies[6], { x: 268, y: 300 });
  const pbDec = C.plan(pbSt, 1, { level: 'hard', seed: 7 });
  assert.ok(pbDec.plans[0].power >= 0.96 && Math.abs(pbDec.plans[0].spin) > 0.5, 'point-blank striker unleashes full-power Spin Strike');

  // 3. Screened Corner Meteor Bank & Glancing Fireball Overpower
  const bankSt = mkState('standard', { 3: { power: 240, impulse: 215 } });
  Object.assign(bankSt.bodies[0], { x: 148, y: 282, guarding: true });
  Object.assign(bankSt.bodies[1], { x: 215, y: 255, guarding: true });
  Object.assign(bankSt.bodies[2], { x: 250, y: 95, guarding: true });
  Object.assign(bankSt.bodies[3], { x: 455, y: 175 });
  Object.assign(bankSt.bodies[4], { x: 760, y: 180 });
  Object.assign(bankSt.bodies[5], { x: 860, y: 300 });
  Object.assign(bankSt.bodies[6], { x: 375, y: 250 });
  const bankDec = C.plan(bankSt, 1, { level: 'hard', seed: 7 });
  const bankRes = M.resolveTurn(P, bankSt, [C.GUARD, C.GUARD, C.GUARD, ...bankDec.plans], { effects: false });
  assert.equal(bankRes.replay.goal, 1, 'Hard CPU converts full-power far-corner Meteor Bank behind double screen');
  assert.equal(bankRes.replay.label, 'FIREBALL!', 'corner bank ignites full-speed Meteor Bank fireball');

  // 4. Canonical moving-ball wall-bounce trajectory & Pulse cross-slot / off-board rebound one-timers (> 0.32s lead)
  const bounceSt = mkState('pulse', { 3: { impulse: 215, power: 220 } });
  Object.assign(bounceSt.bodies[0], { x: 108, y: 344, guarding: true });
  Object.assign(bounceSt.bodies[1], { x: 740, y: 130 });
  Object.assign(bounceSt.bodies[2], { x: 740, y: 470 });
  Object.assign(bounceSt.bodies[3], { x: 515, y: 205 });
  Object.assign(bounceSt.bodies[4], { x: 780, y: 420 });
  Object.assign(bounceSt.bodies[5], { x: 865, y: 300 });
  Object.assign(bounceSt.bodies[6], { x: 320, y: 102, vx: -45, vy: -290 });
  const samples = C.traceMovingBall(bounceSt.bodies[6]);
  assert.ok(samples && samples.some(s => s.vy > 100 && s.t > 0.32), 'traceMovingBall captures top-wall rebound past 0.32s');
  const slowBall = { ...bounceSt.bodies[6], friction: 300 };
  const initialSlowTrace = C.traceMovingBall(slowBall);
  slowBall.friction = bounceSt.bodies[6].friction;
  assert.notDeepEqual(C.traceMovingBall(slowBall), initialSlowTrace, 'changing friction invalidates the moving-ball trace');
  const bounceDec = C.plan(bounceSt, 1, { level: 'hard', seed: 7 });
  const bounceRes = M.resolveTurn(P, bounceSt, [C.GUARD, C.HOLD, C.HOLD, ...bounceDec.plans], { effects: false });
  assert.equal(bounceRes.replay.goal, 1, 'Hard CPU intercepts off-wall Pulse rebound past 0.32s and scores');

  // 5. Tight-wing angle snipe / Post English around near-post Guard
  const wingSt = mkState('standard', { 3: { spin: 245, curve: 235, power: 225, impulse: 205, grip: 225 } });
  Object.assign(wingSt.bodies[0], { x: 96, y: 264, guarding: true });
  Object.assign(wingSt.bodies[1], { x: 260, y: 495, guarding: true });
  Object.assign(wingSt.bodies[2], { x: 740, y: 460 });
  Object.assign(wingSt.bodies[3], { x: 248, y: 108 });
  Object.assign(wingSt.bodies[4], { x: 760, y: 200 });
  Object.assign(wingSt.bodies[5], { x: 860, y: 300 });
  Object.assign(wingSt.bodies[6], { x: 196, y: 145 });
  const wingDec = C.plan(wingSt, 1, { level: 'medium', seed: 7 });
  const wingRes = M.resolveTurn(P, wingSt, [C.GUARD, C.GUARD, C.HOLD, ...wingDec.plans], { effects: false });
  assert.equal(wingRes.replay.goal, 1, 'Medium CPU converts tight-wing angle shot past near-post Guard');
  assert.ok(wingDec.plans[0].power >= 0.96, 'tight-wing shot launches at full power');
});

test('CPU goaltending defense: wall-bank awareness, carded-defender handoff, warned-crease saves and crease discipline', () => {
  const mkDef = (overrides = {}) => {
    const bodies = P.kickoff();
    const stats = Array.from({ length: 6 }, (_, i) => ({
      impulse: 155, traction: 140, spin: 150, curve: 150,
      size: 127, mass: 127, bounciness: 127, grip: 140,
      power: 170, reach: 140, strength: 140, stability: 140,
      efficiency: 127, synergy: 140, chemistry: 140,
      ...(overrides[i] || {})
    }));
    for (let i = 0; i < 6; i++) {
      M.applyStats(P, bodies[i], stats[i], 'standard');
      bodies[i].personality = { aggression: 32, creativity: 32, teamwork: 32, clutch: 32 };
      bodies[i].meter = 0;
      bodies[i].equippedSuper = null;
      bodies[i].vx = 0; bodies[i].vy = 0; bodies[i].omega = 0;
      bodies[i].stunned = false; bodies[i].carded = false; bodies[i].guarding = false;
      P.syncEffectiveStats(bodies[i]);
    }
    return { version: M.VERSION, mode: 'standard', bodies, stats, scores: [0, 0], turn: 2, roundTurns: 2, phase: 'plan', winner: null, fouls: M.newFouls() };
  };

  // 1. Midfield top-wall bank shot: Hard/Insane/God adjust into the crease pocket & save the verified bank shot
  const bankSt = mkDef({ 0: { power: 235, impulse: 220 } });
  Object.assign(bankSt.bodies[0], { x: 455, y: 255 });
  Object.assign(bankSt.bodies[1], { x: 260, y: 420 });
  Object.assign(bankSt.bodies[2], { x: 150, y: 300 });
  Object.assign(bankSt.bodies[3], { x: 878, y: 345 });
  Object.assign(bankSt.bodies[4], { x: 660, y: 340 });
  Object.assign(bankSt.bodies[5], { x: 450, y: 460 });
  Object.assign(bankSt.bodies[6], { x: 520, y: 210 });
  let verifiedBank = null;
  for (let gy = 238; gy <= 362; gy += 6) {
    const mv = { ...C.strike(bankSt.bodies[0], bankSt.bodies[6], 940, 2 * (60 + 18) - gy, null, 0, 2400), power: 1 };
    const r = M.resolveTurn(P, bankSt, [mv, C.HOLD, C.HOLD, C.HOLD, C.HOLD, C.HOLD], { effects: false });
    if (r.replay.goal === 0 && (r.replay.label === 'BANK SHOT!' || r.replay.label === 'FIREBALL!')) { verifiedBank = mv; break; }
  }
  assert.ok(verifiedBank, 'constructed verified midfield top-wall bank shot');
  for (const level of ['hard', 'insane', 'god']) {
    const dec = C.plan(bankSt, 1, { level, seed: 7 });
    const res = M.resolveTurn(P, bankSt, [verifiedBank, C.HOLD, C.HOLD, ...dec.plans], { effects: false });
    assert.notEqual(res.replay.goal, 0, `${level} saves midfield top-wall bank shot`);
  }

  // 2. Carded skater at kickoff spot hands defender role to live teammate instead of leaving net empty
  const cardSt = mkDef();
  Object.assign(cardSt.bodies[0], { x: 580, y: 300 });
  Object.assign(cardSt.bodies[1], { x: 250, y: 150 });
  Object.assign(cardSt.bodies[2], { x: 140, y: 300 });
  Object.assign(cardSt.bodies[3], { x: 820, y: 300, carded: true });
  Object.assign(cardSt.bodies[4], { x: 795, y: 352 });
  Object.assign(cardSt.bodies[5], { x: 520, y: 150 });
  Object.assign(cardSt.bodies[6], { x: 645, y: 300 });
  const centerShot = { ...C.strike(cardSt.bodies[0], cardSt.bodies[6], 940, 300, null, 0, 2400), power: 1 };
  assert.equal(M.resolveTurn(P, cardSt, [centerShot, C.HOLD, C.HOLD, C.HOLD, C.HOLD, C.HOLD], { effects: false }).replay.goal, 0);
  const cardDec = C.plan(cardSt, 1, { level: 'medium', seed: 7 });
  const cardRes = M.resolveTurn(P, cardSt, [centerShot, C.HOLD, C.HOLD, ...cardDec.plans], { effects: false });
  assert.notEqual(cardRes.replay.goal, 0, 'live backup defender covers net when kickoff skater is carded');

  // 3. Crease-warned goalie keeps GUARD/save options under live shotDanger instead of fleeing to concede
  const warnSt = mkDef();
  warnSt.fouls = { ...M.newFouls(), crease: [false, true] };
  Object.assign(warnSt.bodies[0], { x: 640, y: 300 });
  Object.assign(warnSt.bodies[1], { x: 260, y: 150 });
  Object.assign(warnSt.bodies[2], { x: 140, y: 300 });
  Object.assign(warnSt.bodies[3], { x: 892, y: 300 });
  Object.assign(warnSt.bodies[4], { x: 520, y: 140 });
  Object.assign(warnSt.bodies[5], { x: 520, y: 460 });
  Object.assign(warnSt.bodies[6], { x: 705, y: 300 });
  const warnOpts = C.options(warnSt, 1, 0, C.HOLD);
  assert.ok(warnOpts.some(m => m.guard), 'warned goalie retains GUARD save option under active shotDanger');
  const warnShot = { ...C.strike(warnSt.bodies[0], warnSt.bodies[6], 940, 300, null, 0, 2400), power: 1 };
  const warnDec = C.plan(warnSt, 1, { level: 'god', seed: 7 });
  const warnRes = M.resolveTurn(P, warnSt, [warnShot, C.HOLD, C.HOLD, ...warnDec.plans], { effects: false });
  assert.notEqual(warnRes.replay.goal, 0, 'Ububall God saves direct shot rather than fleeing warned crease');

  // 4. Baseline anchor does not rush out to clear when an opponent reaches the ball first
  const rushSt = mkDef();
  Object.assign(rushSt.bodies[0], { x: 740, y: 240 });
  Object.assign(rushSt.bodies[1], { x: 260, y: 400 });
  Object.assign(rushSt.bodies[2], { x: 150, y: 300 });
  Object.assign(rushSt.bodies[3], { x: 882, y: 295 });
  Object.assign(rushSt.bodies[4], { x: 520, y: 420 });
  Object.assign(rushSt.bodies[5], { x: 450, y: 160 });
  Object.assign(rushSt.bodies[6], { x: 790, y: 230 });
  rushSt.bodies[3].personality = { aggression: 58, creativity: 32, teamwork: 32, clutch: 32 };
  const baseGoalie = C.legacy(rushSt, 1)[0];
  const vxDir = baseGoalie.power > 0 ? Math.cos(baseGoalie.angle) * baseGoalie.power : 0;
  assert.ok(baseGoalie.guard || vxDir > -0.5, 'baseline anchor stays near crease instead of charging out when beaten to the ball');
});
