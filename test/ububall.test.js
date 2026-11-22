'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../shared/ububall-physics.js');
const C = require('../shared/ububall-cpu.js');

const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };

function resolve(bodies) {
  for (let i = 0; i < 12 / P.DT; i++) {
    const goal = P.step(bodies);
    if (goal !== null) return goal;
    if (P.settled(bodies)) return null;
  }
  assert.fail('Turn failed to settle');
}

function kineticEnergy(bodies) {
  return bodies.reduce((sum, b) => sum + .5 * b.mass * (b.vx ** 2 + b.vy ** 2)
    + .25 * b.mass * b.radius ** 2 * b.omega ** 2, 0);
}

test('extreme size, traction and spin combinations stay finite and within the field', () => {
  for (let sample = 0; sample < 32; sample++) {
    const b = P.kickoff(), raw = Object.fromEntries(Object.keys(normal).map((key, bit) => [key, sample & (1 << bit) ? 255 : 0]));
    b.slice(0, 6).forEach(body => P.applyStats(body, raw));
    P.launch(b, b.slice(0, 6).map((body, i) => ({ angle: i * 1.3, power: 1, spin: i % 2 ? 1 : -1 })));
    for (let step = 0; step < 2880; step++) {
      if (P.step(b) !== null) break;
      for (const body of b.slice(0, 6)) {
        assert.ok([body.x, body.y, body.vx, body.vy, body.omega].every(Number.isFinite));
        assert.ok(body.x >= 60 - P.rink.goalDepth + body.radius - .1 && body.x <= 940 + P.rink.goalDepth - body.radius + .1);
        assert.ok(body.y >= 60 + body.radius - .1 && body.y <= 540 - body.radius + .1);
      }
    }
  }
});

test('repeated crowded turns stay finite, bounded and settle', () => {
  let seed = 9;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let b = P.kickoff();
  for (let turn = 0; turn < 100; turn++) {
    P.launch(b, [...Array.from({ length: 3 }, () => ({ angle: random() * Math.PI * 2, power: random() })), ...C.cpuPlans(b, random)]);
    const goal = resolve(b);
    assert.ok(b.every(p => [p.x, p.y, p.vx, p.vy].every(Number.isFinite)));
    assert.ok(b.slice(0, 6).every(p => p.x >= 60 - P.rink.goalDepth + p.radius - 0.1 && p.x <= 940 + P.rink.goalDepth - p.radius + 0.1 && p.y >= 84.9 && p.y <= 515.1));
    if (goal !== null) b = P.kickoff(); else P.stop(b);
  }
});

test('ordinary contacts cannot create kinetic energy across stat extremes and spin', () => {
  for (const ballContact of [false, true]) for (const value of [0, 127, 255]) {
    for (const other of [0, 127, 255]) for (const spin of [-12, 0, 12]) {
      const all = P.kickoff(), a = all[0], b = all[ballContact ? 6 : 3];
      P.applyStats(a, { mass: value, power: value, strength: value, stability: other, bounciness: value, grip: value });
      if (!ballContact) P.applyStats(b, { mass: other, strength: other, stability: value, bounciness: other, grip: other });
      Object.assign(a, { x: 400, y: 300, vx: 500, vy: 80, omega: spin });
      Object.assign(b, { x: 400 + a.radius + b.radius - 1, y: 300, vx: -700, vy: -60, omega: -spin });
      const before = kineticEnergy([a, b]);
      P.step([a, b], 0);
      assert.ok(kineticEnergy([a, b]) <= before * (1 + 1e-12), `${ballContact}/${value}/${other}/${spin}`);
    }
  }
});

test('Cannonball boosts the ball once without boosting its shooter or subsequent ricochets', () => {
  const setup = superActive => {
    const bodies = P.kickoff();
    bodies.slice(0, 6).forEach(b => P.applyStats(b, { bounciness: 255, power: 255, strength: 255, stability: 0 }));
    Object.assign(bodies[0], { x: 460, y: 300, vx: 720, superActive });
    return bodies;
  };
  const bodies = setup('cannonball'), ordinary = setup(null);
  let activations = 0;
  P.step(bodies, 0, null, null, null, key => { if (key === 'cannonball') activations++; });
  P.step(ordinary, 0);
  assert.equal(bodies[0].vx, ordinary[0].vx);
  assert.ok(Math.abs(bodies[6].vx - ordinary[6].vx * (1 + P.SUPER.cannonball)) < 1e-9);
  assert.equal(bodies[0].superActive, null);
  let previous = kineticEnergy(bodies), ricochets = 0;
  for (let tick = 0; tick < 2880; tick++) {
    const ball = bodies[6], hot = P.ballOnFire(ball), team = ball.strikerTeam;
    let hotShot = false;
    const goal = P.step(bodies, P.DT, ({ a, b }) => { ricochets++; if (hot && (a === ball ? b : a).team === team) hotShot = true; }, null, null, key => { if (key === 'cannonball') activations++; });
    const energy = kineticEnergy(bodies);
    assert.ok(hotShot || energy <= previous * (1 + 1e-10) + 1e-8, `Ricochet gained energy at tick ${tick}`);
    previous = energy;
    if (goal !== null || P.settled(bodies)) break;
  }
  assert.equal(activations, 1);
  assert.ok(ricochets > 0);
});

test('Super events report effects once without changing the simulation', () => {
  for (const key of ['knockout', 'sticky', 'cannonball', 'stalwart']) {
    const all = P.kickoff();
    const a = all[0], b = key === 'sticky' || key === 'cannonball' ? all[6] : all[3];
    Object.assign(a, { x: 400, y: 250, vx: key === 'stalwart' ? 0 : 100, superActive: key });
    Object.assign(b, { x: 400 + a.radius + b.radius - 2, y: 250, vx: -100 });
    const bodies = [a, b], control = structuredClone(bodies), events = [];
    P.step(bodies, P.DT, null, null, null, (k, phase, source, target) => {
      assert.equal(source, a); assert.equal(target, b);
      events.push([k, phase]);
    });
    P.step(control, P.DT);
    assert.deepEqual(bodies, control, key + ' callback is observational');
    assert.deepEqual(events, [[key, 'impact']]);
    if (key !== 'stalwart') {
      for (let i = 0; i < 10; i++) P.step(bodies, P.DT, null, null, null, (k, phase) => events.push([k, phase]));
      assert.equal(events.length, 1, key + ' does not repeat after consumption/grab');
    }
  }
});

test('mirror-symmetric 50/50 kickoff keeps the ball centered with zero team-index bias', () => {
  const b = P.kickoff();
  b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  Object.assign(b[0], { x: 440, y: 300 });
  Object.assign(b[3], { x: 560, y: 300 });
  const stillPlan = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
  P.startTurn(b, [
    { angle: 0, power: 1, spin: 0, superArm: false, guard: false }, stillPlan, stillPlan,
    { angle: Math.PI, power: 1, spin: 0, superArm: false, guard: false }, stillPlan, stillPlan
  ]);
  for (let t = 0; t < 30; t++) P.step(b, P.DT);
  assert.ok(Math.abs(b[6].x - 500) < 1e-9);
  assert.ok(Math.abs(b[6].vx) < 1e-9);
  assert.ok(Math.abs((b[0].x - 500) + (b[3].x - 500)) < 1e-9);
});

test('goal scoring, partial crossing, back-of-net, and anti-tunneling strikes', () => {
  for (const [x, vx, team] of [[920, 600, 0], [80, -600, 1]]) {
    const b = P.kickoff(); Object.assign(b[6], { x, vx }); assert.equal(resolve(b), team);
  }
  const partial = P.kickoff(); partial[6].x = 945; assert.equal(P.step(partial), null);
  const backR = P.kickoff(); backR[6].x = 940 + P.rink.goalDepth - backR[6].radius; assert.equal(P.step(backR), 0);
  const backL = P.kickoff(); backL[6].x = 60 - P.rink.goalDepth + backL[6].radius; assert.equal(P.step(backL), 1);
  const fast = P.kickoff(); Object.assign(fast[6], { x: 920, y: 300, vx: 2000 }); assert.equal(resolve(fast), 0);
  const strike = P.kickoff(); Object.assign(strike[0], { x: 440, y: 300, vx: 720 });
  for (let i = 0; i < 20; i++) P.step(strike);
  assert.ok(strike[6].vx > 500 && strike[6].x > strike[0].x);
});

test('rink, rounded corner, goal-pocket containment, and post-goal pinning', () => {
  const wall = P.kickoff(); Object.assign(wall[6], { x: 60 + wall[6].radius, y: 215, vx: 0, vy: 400 });
  for (let i = 0; i < 20; i++) P.step(wall);
  assert.ok(wall[6].x <= 60 + wall[6].radius + 1.0 && wall[6].y > 230);

  const net = P.kickoff(); Object.assign(net[0], { x: 90, y: 300, vx: -720 });
  for (let i = 0; i < 20; i++) P.step(net);
  assert.ok(net[0].x < 60 + net[0].radius && net[0].x >= 60 - P.rink.goalDepth + net[0].radius - 0.1 && net[0].vx > 0);

  const corner = P.kickoff(); Object.assign(corner[6], { x: 100, y: 100, vx: -500, vy: -500 });
  for (let i = 0; i < 15; i++) P.step(corner);
  assert.ok(corner[6].vx > 0 && corner[6].vy > 0 && Math.hypot(corner[6].x - 160, corner[6].y - 160) <= 88.01);

  const pocket = P.kickoff()[0]; P.applyStats(pocket, normal);
  Object.assign(pocket, { x: 35, y: P.rink.goalTop + pocket.radius - 2, vx: 0, vy: -300 });
  P.step([pocket], P.DT);
  assert.ok(pocket.x < P.rink.left && pocket.y >= P.rink.goalTop + pocket.radius - 1e-9 && pocket.vy >= 0);

  const pg = P.kickoff(); pg.slice(0, 6).forEach(b => P.applyStats(b));
  pg[0].holding = true;
  Object.assign(pg[0], { x: 930, y: 300, vx: 300, vy: 0 });
  Object.assign(pg[6], { x: 960, y: 300, vx: 250, vy: 0, stickOffset: { x: 30, y: 0 } });
  P.stepPostGoal(pg, P.DT);
  assert.equal(pg[0].holding, false);
  assert.equal(pg[6].x, 960); assert.ok(pg[0].vx > 200);
});

test('shared prediction matches live ticks for team plans and every super without mutating inputs', () => {
  for (const ability of P.SUPERS) {
    const bodies = P.kickoff();
    bodies.slice(0, 6).forEach((b, i) => P.applyStats(b, { ...normal, strength: 90 + i * 20, stability: 200 - i * 15, reach: 150 }));
    Object.assign(bodies[0], { x: 410, y: 300, meter: 100, superArm: true, equippedSuper: ability });
    Object.assign(bodies[1], { x: 470, y: 220 });
    Object.assign(bodies[2], { x: 580, y: 350, superActive: 'magnet' });
    Object.assign(bodies[3], { x: 555, y: 300, meter: 100, superArm: true, equippedSuper: P.SUPERS[0], superActive: 'ghost' });
    const plans = [{ angle: .08, power: .9, spin: -.6 }, { angle: 1.2, power: .7, spin: .8 }, { angle: Math.PI, power: .45, spin: -.3 }];
    const original = structuredClone({ bodies, plans });
    const prediction = P.predictTurn(bodies, plans);
    assert.deepEqual({ bodies, plans }, original, ability.key + ' leaves live state untouched');
    const live = structuredClone(bodies);
    live[3].superArm = false;
    P.startTurn(live, plans);
    let goal = null;
    for (let tick = 1; tick <= prediction.ticks; tick++) {
      goal = P.step(live, P.DT);
      for (let i = 0; i < live.length; i++) {
        const point = prediction.paths[i].find(p => p.tick === tick);
        if (point) assert.deepEqual([point.x, point.y], [live[i].x, live[i].y], `${ability.key} body ${i} tick ${tick}`);
      }
      if (goal !== null || P.settled(live)) { assert.equal(tick, prediction.ticks); break; }
    }
    assert.equal(prediction.goal, goal);
    assert.ok(prediction.ticks <= 480);
  }
});

test('prediction preserves active Pulse supers, hides opponent superArm, handles Sticky, and respects stun/budget', () => {
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach(b => P.applyStats(b, normal));
  bodies[3].superActive = 'colossus'; P.syncEffectiveStats(bodies[3]); bodies[3].superTicks = 400;
  Object.assign(bodies[4], { superArm: true, meter: 100, equippedSuper: P.SUPERS[4] });
  const plans = [{ angle: 0, power: 0.8, spin: 0 }];
  const pred = P.predictTurn(bodies, plans);
  const live = structuredClone(bodies); live[4].superArm = false; P.startTurn(live, plans);
  assert.equal(live[3].superActive, 'colossus'); assert.equal(Boolean(live[4].superActive), false);
  for (let tick = 1; tick <= pred.ticks; tick++) {
    P.step(live, P.DT);
    for (let i = 0; i < live.length; i++) {
      const point = pred.paths[i].find(p => p.tick === tick);
      if (point) assert.deepEqual([point.x, point.y], [live[i].x, live[i].y]);
    }
  }

  // Sticky holding teammate struck
  const sticky = P.kickoff();
  Object.assign(sticky[0], { x: 350, y: 300 }); Object.assign(sticky[1], { x: 430, y: 300, holding: true });
  Object.assign(sticky[6], { x: 473, y: 300, stickOffset: { x: 43, y: 0 } });
  const stickyPred = P.predictTurn(sticky, [{ angle: 0, power: 1, spin: .3 }]);
  assert.ok(stickyPred.paths[6].some(p => p.x !== 473));

  // Tick budget & stunned ubu
  const drifting = P.kickoff(); Object.assign(drifting[6], { vx: 20, friction: 0 });
  assert.equal(P.predictTurn(drifting, []).ticks, 480);
  const stunned = P.kickoff();
  Object.assign(stunned[0], { stunned: true, superArm: true, meter: 100, equippedSuper: P.SUPERS[5] });
  assert.deepEqual(P.predictTurn(stunned, [{ angle: 0, power: 1, spin: 1 }]).paths[0].at(-1), { x: 180, y: 300, tick: 1 });
});

test('core invariants of Stalwart, Knockout, Sticky, and Cannonball', () => {
  // Stalwart anchors immovable at rest
  const st = P.kickoff(); st[0].superActive = 'stalwart';
  Object.assign(st[0], { x: 400, y: 300, vx: 0, vy: 0 }); Object.assign(st[3], { x: 440, y: 300, vx: -600, vy: 0 });
  P.step(st, 0);
  assert.equal(st[0].vx, 0); assert.equal(st[0].x, 400); assert.ok(st[3].vx > -100);

  // Knockout stuns opponent on contact for next turn
  const ko = P.kickoff(); ko[0].superActive = 'knockout';
  Object.assign(ko[0], { x: 400, y: 300, vx: 500, vy: 0 }); Object.assign(ko[3], { x: 435, y: 300, vx: 0, vy: 0 });
  P.step(ko, 0);
  assert.equal(ko[3].stunnedNext, true); assert.equal(ko[0].superActive, null);
  ko[3].stunned = true; delete ko[3].stunnedNext;
  P.launch(ko, Array.from({ length: 6 }, () => ({ angle: 0, power: 1 })));
  assert.equal(ko[3].vx, 0); P.stop(ko); assert.equal(ko[3].stunned, false);

  // Sticky grabs and carries ball
  const sk = P.kickoff(); sk[0].superActive = 'sticky';
  Object.assign(sk[0], { x: 460, y: 300, vx: 400, vy: 0 }); Object.assign(sk[6], { x: 500, y: 300, vx: 0, vy: 0 });
  P.step(sk, 0); assert.equal(P.holder(sk), sk[0]);
  for (let i = 0; i < 20; i++) P.step(sk, P.DT);
  assert.ok(sk[6].x > 500 && P.holder(sk) === sk[0]);

  // Cannonball amplifies ball impulse
  const shoot = superActive => {
    const b = P.kickoff(); if (superActive) b[0].superActive = 'cannonball';
    Object.assign(b[0], { x: 460, y: 300, vx: 500, vy: 0 }); Object.assign(b[6], { x: 500, y: 300, vx: 0, vy: 0 });
    P.step(b, 0); return b[6].vx;
  };
  assert.ok(shoot(true) > shoot(false) * 1.8);
});

test('core invariants of Magnet, Colossus, Shockwave, and Ghost', () => {
  // Magnet pulls free ball
  const mg = P.kickoff(); mg[0].superActive = 'magnet';
  Object.assign(mg[0], { x: 350, y: 300, vx: 100, vy: 0 }); Object.assign(mg[6], { x: 500, y: 300, vx: 0, vy: 0 });
  for (let i = 0; i < 30; i++) P.step(mg, P.DT);
  assert.ok(mg[6].vx < 0);

  // Colossus scales radius/mass and restores on stop
  const co = P.kickoff(); P.applyStats(co[0], normal);
  const origR = co[0].radius, origM = co[0].mass;
  co[0].superActive = 'colossus'; P.launch(co, [{ angle: 0, power: 0.5 }]);
  assert.ok(co[0].radius > origR && co[0].mass > origM);
  P.stop(co);
  assert.ok(Math.abs(co[0].radius - origR) < 1e-6 && Math.abs(co[0].mass - origM) < 1e-6);

  // Shockwave repels opponents only, never teammates or ball
  const sw = P.kickoff();
  Object.assign(sw[0], { x: 400, y: 300, team: 0 });
  Object.assign(sw[1], { x: 450, y: 300, vx: 0, vy: 0, team: 0 });
  Object.assign(sw[3], { x: 450, y: 300, vx: 0, vy: 0, team: 1 });
  Object.assign(sw[6], { x: 400, y: 360, vx: 0, vy: 0, team: -1 });
  P.triggerShockwave(sw[0], sw);
  assert.equal(sw[1].vx, 0); assert.ok(sw[3].vx > 0); assert.equal(sw[6].vy, 0);

  // Ghost phases through opponents but hits the ball
  const gh = P.kickoff(); gh[0].superActive = 'ghost';
  Object.assign(gh[0], { x: 400, y: 300, vx: 500, vy: 0 }); Object.assign(gh[3], { x: 430, y: 300, vx: 0, vy: 0 });
  P.step(gh, 0); assert.equal(gh[0].vx, 500); assert.equal(gh[3].vx, 0);
  Object.assign(gh[0], { x: 460, y: 300, vx: 500, vy: 0 }); Object.assign(gh[6], { x: 500, y: 300, vx: 0, vy: 0 });
  P.step(gh, 0); assert.ok(gh[6].vx > 0);
});

test('super lifecycle refunds: whiff, mastery, and single-refund guarantee across standard and Pulse', () => {
  for (const key of ['cannonball', 'knockout']) {
    for (const keepMotion of [false, true]) {
      for (const bonusRefund of [0, 5, 20]) {
        const bodies = P.kickoff(), source = bodies[0], target = key === 'cannonball' ? bodies[6] : bodies[3];
        const moves = Array.from({ length: 6 }, () => ({ angle: 0, power: 0 }));
        Object.assign(source, { x: 400, y: 300, meter: 100, superArm: true, equippedSuper: { key, bonusRefund } });
        Object.assign(target, { x: 435, y: 300, vx: 0, vy: 0 });
        P.startTurn(bodies, moves); source.vx = 500; P.step(bodies, 0);
        assert.equal(source.superActive, null);
        P.stop(bodies, keepMotion);
        assert.equal(source.meter, bonusRefund);
        P.endSuper(source, bodies); P.startTurn(bodies, moves); P.stop(bodies);
        assert.equal(source.meter, bonusRefund);
      }
    }
  }

  // Whiffed super refunds whiffRefund + mastery bonusRefund; connected super gets mastery only
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  Object.assign(b[0], { superActive: 'cannonball', meter: 0, superHit: false, equippedSuper: { ...P.SUPERS[3], bonusRefund: 20 } });
  P.endSuper(b[0], b);
  assert.equal(b[0].meter, P.SUPER.whiffRefund + 20);
  Object.assign(b[1], { superActive: 'cannonball', meter: 0, superHit: true, equippedSuper: { ...P.SUPERS[3], bonusRefund: 5 } });
  P.endSuper(b[1], b);
  assert.equal(b[1].meter, 5);
});

test('Fireball/Iron Save contract and re-entrant ballRun safety', () => {
  const still = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
  const runGuard = (guardIdx, offset) => {
    const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
    Object.assign(b[guardIdx], { x: 600, y: 300 + offset });
    const plans = Array.from({ length: 6 }, () => still); plans[guardIdx] = { ...still, guard: true };
    P.startTurn(b, plans);
    Object.assign(b[6], { x: 540, y: 300, vx: 1000, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, strikerPower: 1, strikerTeam: 0, pace: 1000 });
    let iron = false, beaten = false;
    for (let t = 0; t < 60 && !iron && !beaten; t++) {
      P.step(b, P.DT, ({ plow, iron: isIron }) => { if (isIron) iron = true; else if (plow) beaten = true; });
    }
    return { ball: b[6], iron, beaten };
  };

  // Opposing squared Guard makes Iron Save and quenches fire; glancing fireball beats Guard; teammate Guard traps without quenching
  const oppSave = runGuard(3, 0);
  assert.equal(oppSave.iron, true); assert.equal(P.ballOnFire(oppSave.ball), false);
  const glanced = runGuard(3, 20);
  assert.equal(glanced.iron, false); assert.equal(glanced.beaten, true); assert.equal(P.ballOnFire(glanced.ball), true);
  const mateTrap = runGuard(1, 0);
  assert.equal(mateTrap.iron, true); assert.equal(P.ballOnFire(mateTrap.ball), true);

  // Re-entrant P.ballRun inside onCollide never clobbers outer adaptive rollback buffers
  const reentrantA = P.kickoff();
  reentrantA.slice(0, 6).forEach(b => P.applyStats(b, normal));
  Object.assign(reentrantA[0], { x: 460, y: 300, vx: 680, vy: 45, omega: 9 });
  Object.assign(reentrantA[6], { x: 501, y: 304, vx: -120, vy: 0 });
  const reentrantB = structuredClone(reentrantA);
  let innerGoal = undefined;
  P.step(reentrantA, P.DT, () => { innerGoal = P.ballRun(reentrantA, { boards: true, ticks: 120 }).goal; });
  P.step(reentrantB, P.DT);
  assert.notEqual(innerGoal, undefined);
  assert.deepEqual(reentrantA, reentrantB);
});
