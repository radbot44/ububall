'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };
test('exponential stat curve preserves endpoints and spreads mid-range stats evenly', () => {
  assert.ok(Math.abs(P.multiplier(0) - 2 / 3) < 1e-12);
  assert.equal(P.multiplier(127), 1); assert.equal(P.multiplier(255), 1.5);
  const values = Array.from({ length: 256 }, (_, i) => P.multiplier(i));
  assert.ok(values.every((v, i) => !i || v > values[i - 1]));
  // Each step is a near-constant percentage, so the middle half spans a real range.
  assert.ok(Math.abs(P.multiplier(64) - (2 / 3) ** (63 / 127)) < 1e-12 && P.multiplier(64) < .82);
  assert.ok(Math.abs(P.multiplier(191) - Math.sqrt(1.5)) < 1e-12);
});
test('mass leaves launch speed alone, so heavier ubus carry more momentum', () => {
  const b = P.kickoff();
  [0, 127, 255].forEach((mass, i) => P.applyStats(b[i], { ...normal, mass }));
  P.launch(b, Array.from({ length: 6 }, () => ({ angle: 0, power: 1 })));
  for (const body of b.slice(0, 3)) assert.ok(Math.abs(body.vx - 720) < 1e-9);
  assert.ok(b[0].mass * b[0].vx < b[1].mass * b[1].vx && b[1].mass * b[1].vx < b[2].mass * b[2].vx);
  // Weight added on top of the ubu's own (Colossus) still slows its launch.
  const heavy = P.kickoff()[0]; P.applyStats(heavy); heavy.mass *= 2.5;
  assert.ok(Math.abs(P.launchSpeed(heavy) - 720 / 2.5) < 1e-9);
});
test('heavier ubus shoot and check harder and are harder to knock away', () => {
  const hit = mass => {
    const b = P.kickoff(); P.applyStats(b[0], { ...normal, mass }); Object.assign(b[0], { x: 300, y: 300, vx: 720 });
    Object.assign(b[6], { x: 343, y: 300 }); P.step(b, 0);
    const c = P.kickoff(); P.applyStats(c[0], { ...normal, mass }); P.applyStats(c[3], normal);
    Object.assign(c[0], { x: 300, y: 300, vx: 720 }); Object.assign(c[3], { x: 349, y: 300 }); P.step(c, 0);
    return { ball: b[6].vx, check: c[3].vx };
  };
  const [light, mid, heavy] = [0, 127, 255].map(hit);
  assert.ok(light.ball < mid.ball && mid.ball < heavy.ball);
  assert.ok(light.check < mid.check && mid.check < heavy.check);
});
test('spin bends travel symmetrically without adding translational speed', () => {
  const outcomes = [-1, 0, 1].map(spin => {
    const b = P.kickoff(); Object.assign(b[0], { x: 400, y: 100 });
    P.launch(b, [{ angle: 0, power: .2, spin }]);
    for (let i = 0; i < 120; i++) P.step(b);
    return b[0];
  });
  assert.ok(outcomes[0].y < 100 && outcomes[2].y > 100);
  assert.ok(Math.abs(outcomes[0].y + outcomes[2].y - 200) < 1e-8);
  const straightSpeed = Math.hypot(outcomes[1].vx, outcomes[1].vy);
  assert.ok(straightSpeed < 70 && straightSpeed > 0);
  assert.ok(outcomes.every(b => Math.abs(Math.hypot(b.vx, b.vy) - straightSpeed) < 1e-8));
});
test('air drag slows the ball more strongly at higher speeds; ubus have none', () => {
  for (const index of [0, 6]) {
    const losses = [100, 700].map(speed => {
      const body = P.kickoff()[index];
      Object.assign(body, { x: 500, y: 300, vx: speed, vy: 0, friction: 0 });
      P.step([body]);
      return speed - body.vx;
    });
    if (index === 6) assert.ok(losses[0] > 0 && losses[1] > losses[0] * 40);
    else assert.deepEqual(losses, [0, 0]);
  }
});
test('impulse scales launch speed independently of mass', () => {
  const b = P.kickoff();
  [0, 127, 255].forEach((impulse, i) => P.applyStats(b[i], { ...normal, impulse }));
  P.launch(b, Array.from({ length: 6 }, () => ({ angle: 0, power: 1 })));
  assert.ok(Math.abs(b[0].vx - 720 * (2 / 3) ** P.ICE_BITE.impulseExp) < 1e-9);
  assert.equal(b[1].vx, 720);
  assert.ok(Math.abs(b[2].vx - 720 * 1.5 ** P.ICE_BITE.impulseExp) < 1e-9);
});
test('curve stat scales trajectory bend for equal spin', () => {
  const outcomes = [0, 127, 255].map(curve => {
    const b = P.kickoff(); Object.assign(b[0], { x: 400, y: 100 });
    P.applyStats(b[0], { ...normal, curve });
    P.launch(b, [{ angle: 0, power: .2, spin: 1 }]);
    for (let i = 0; i < 120; i++) P.step(b);
    return b[0].y;
  });
  assert.ok(outcomes[0] < outcomes[1] && outcomes[1] < outcomes[2]);
});

test('spin transfers sideways impulse and angular momentum during a head-on collision', () => {
  const results = [-8, 0, 8].map(omega => {
    const b = P.kickoff(); Object.assign(b[0], { x: 463.1, y: 300, vx: 600, omega });
    P.step(b, 0); return b;
  });
  assert.ok(results[0][6].vy < 0 && results[2][6].vy > 0);
  assert.equal(results[1][6].vy, 0);
  assert.ok(results[2][0].omega < 8);
});
test('higher grip transfers more spin when contact is slipping', () => {
  const sideways = [0, 127, 255].map(grip => {
    const b = P.kickoff(); P.applyStats(b[0], { ...normal, grip });
    Object.assign(b[0], { x: 457.1, y: 300, vx: 300, omega: 100 });
    P.step(b, 0); assert.equal(b[0].friction, 150); return b[6].vy;
  });
  assert.ok(sideways[0] < sideways[1] && sideways[1] < sideways[2]);
});
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
function resolve(bodies) {
  for (let i = 0; i < 12 / P.DT; i++) {
    const goal = P.step(bodies);
    if (goal !== null) return goal;
    if (P.settled(bodies)) return null;
  }
  assert.fail('Turn failed to settle');
}
test('all six ubus launch simultaneously and the ball starts stationary', () => {
  const b = P.kickoff(); P.launch(b, Array.from({ length: 6 }, () => ({ angle: 0, power: .5 })));
  assert.ok(b.slice(0, 6).every(p => p.vx === 360)); assert.equal(b[6].vx, 0);
});
test('a ball fully crossing either goal scores for the opposite team', () => {
  for (const [x, vx, team] of [[920, 600, 0], [80, -600, 1]]) {
    const b = P.kickoff(); Object.assign(b[6], { x, vx }); assert.equal(resolve(b), team);
  }
});
test('a partial goal crossing does not score', () => {
  const b = P.kickoff(); b[6].x = 945; assert.equal(P.step(b), null);
});
test('touching the back of the net scores a goal', () => {
  const b = P.kickoff();
  b[6].x = 940 + P.rink.goalDepth - b[6].radius;
  assert.equal(P.step(b), 0);
  const b2 = P.kickoff();
  b2[6].x = 60 - P.rink.goalDepth + b2[6].radius;
  assert.equal(P.step(b2), 1);
});
test('fast ball entering goal registers a score without bouncing out', () => {
  const b = P.kickoff();
  Object.assign(b[6], { x: 920, y: 300, vx: 2000 });
  const goal = resolve(b);
  assert.equal(goal, 0);
});
test('ball riding the wall does not jump out at the edge of the net', () => {
  const b = P.kickoff();
  Object.assign(b[6], { x: 60 + b[6].radius, y: 215, vx: 0, vy: 400 });
  for (let i = 0; i < 20; i++) P.step(b);
  assert.ok(b[6].x <= 60 + b[6].radius + 1.0);
  assert.ok(b[6].y > 230);
});
test('ubus can enter the goal net and are contained by the back of the net', () => {
  const b = P.kickoff(); Object.assign(b[0], { x: 90, y: 300, vx: -720 });
  for (let i = 0; i < 20; i++) P.step(b);
  assert.ok(b[0].x < 60 + b[0].radius); assert.ok(b[0].x >= 60 - P.rink.goalDepth + b[0].radius - 0.1); assert.ok(b[0].vx > 0);
});
test('rounded corners reflect diagonally into the rink', () => {
  const b = P.kickoff(); Object.assign(b[6], { x: 100, y: 100, vx: -500, vy: -500 });
  for (let i = 0; i < 15; i++) P.step(b);
  assert.ok(b[6].vx > 0 && b[6].vy > 0);
  assert.ok(Math.hypot(b[6].x - 160, b[6].y - 160) <= 88.01);
});
test('maximum-speed strikes transfer momentum without passing through the ball', () => {
  const b = P.kickoff(); Object.assign(b[0], { x: 440, y: 300, vx: 720 });
  for (let i = 0; i < 20; i++) P.step(b);
  assert.ok(b[6].vx > 500); assert.ok(b[6].x > b[0].x);
});
test('CPU plans depend on field state, are bounded, and do not mutate it', () => {
  const b = P.kickoff(), before = structuredClone(b), plans = P.cpuPlans(b, () => .5);
  assert.deepEqual(b, before); assert.equal(plans.length, 3);
  assert.ok(plans.every(p => Number.isFinite(p.angle) && p.power >= 0 && p.power <= 1));
});
test('repeated crowded turns stay finite, bounded and settle', () => {
  let seed = 9; const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let b = P.kickoff();
  for (let turn = 0; turn < 100; turn++) {
    P.launch(b, [...Array.from({ length: 3 }, () => ({ angle: random() * Math.PI * 2, power: random() })), ...P.cpuPlans(b, random)]);
    const goal = resolve(b);
    assert.ok(b.every(p => [p.x, p.y, p.vx, p.vy].every(Number.isFinite)));
    assert.ok(b.slice(0, 6).every(p => p.x >= 60 - P.rink.goalDepth + p.radius - 0.1 && p.x <= 940 + P.rink.goalDepth - p.radius + 0.1 && p.y >= 84.9 && p.y <= 515.1));
    if (goal !== null) b = P.kickoff(); else P.stop(b);
  }
});
test('CPU can complete a first-to-five match against a stationary team', () => {
  let b = P.kickoff(); const score = [0, 0];
  for (let turn = 0; turn < 150 && Math.max(...score) < 5; turn++) {
    P.launch(b, [...Array.from({ length: 3 }, () => ({ angle: 0, power: 0 })), ...P.cpuPlans(b, () => .5)]);
    const goal = resolve(b);
    if (goal !== null) { score[goal]++; b = P.kickoff(); } else P.stop(b);
  }
  assert.equal(score[1], 5);
});

test('power multiplies impulse transferred to the ball on contact', () => {
  const vBall = [0, 127, 255].map(power => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal, power });
    Object.assign(b[0], { x: 465, y: 300, vx: 500 });
    P.step(b, 0);
    return b[6].vx;
  });
  assert.ok(vBall[0] < vBall[1] && vBall[1] < vBall[2]);
});
test('reach increases ball interaction radius without expanding player-on-player hitbox', () => {
  const hitLow = (() => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal, reach: 0 });
    Object.assign(b[0], { x: 450, y: 300, vx: 500 });
    P.step(b, 0);
    return b[6].vx !== 0;
  })();
  const hitHigh = (() => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal, reach: 255 });
    Object.assign(b[0], { x: 450, y: 300, vx: 500 });
    P.step(b, 0);
    return b[6].vx !== 0;
  })();
  assert.equal(hitLow, false);
  assert.equal(hitHigh, true);

  const pLow = (() => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal, reach: 255 });
    P.applyStats(b[1], { ...normal, reach: 255 });
    Object.assign(b[0], { x: 400, y: 300, vx: 500 });
    Object.assign(b[1], { x: 455, y: 300, vx: 0 });
    P.step(b, 0);
    return b[1].vx !== 0;
  })();
  assert.equal(pLow, false);
});
test('big ubus with low reach still hit the ball with their outer radius', () => {
  const b = P.kickoff();
  P.applyStats(b[0], { ...normal, size: 255, reach: 0 });
  Object.assign(b[0], { x: 500 - 54, y: 300, vx: 500 });
  P.step(b, 0);
  assert.ok(b[6].vx !== 0);
});
test('strength amplifies body-checking force and stability dampens knockback', () => {
  const checkResults = [0, 127, 255].map(strength => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal, strength });
    P.applyStats(b[1], { ...normal });
    Object.assign(b[0], { x: 400, y: 300, vx: 500 });
    Object.assign(b[1], { x: 430, y: 300, vx: 0 });
    P.step(b, 0);
    return b[1].vx;
  });
  assert.ok(checkResults[0] < checkResults[1] && checkResults[1] < checkResults[2]);

  const stabResults = [0, 127, 255].map(stability => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal });
    P.applyStats(b[1], { ...normal, stability });
    Object.assign(b[0], { x: 400, y: 300, vx: 500 });
    Object.assign(b[1], { x: 430, y: 300, vx: 0 });
    P.step(b, 0);
    return b[1].vx;
  });
  assert.ok(stabResults[0] > stabResults[1] && stabResults[1] > stabResults[2]);
});
// Off the top boards at 400 px/s: how fast the ubu comes back.
function offBoards(raw) {
  const b = P.kickoff(); P.applyStats(b[0], { ...normal, ...raw });
  Object.assign(b[0], { x: 500, y: 60 + b[0].radius - 1, vx: 0, vy: -400 });
  P.step([b[0]], 0);
  return b[0].vy;
}
test('bounciness acts on the boards only, and big ubus lose more speed off them', () => {
  const bounce = [0, 127, 255].map(bounciness => offBoards({ bounciness }));
  assert.ok(bounce[0] < bounce[1] && bounce[1] < bounce[2] && bounce[2] <= 400 * .95 + 1e-9);
  const size = [0, 127, 255].map(size => offBoards({ size }));
  assert.ok(size[0] > size[1] && size[1] > size[2]);
  // Body contacts no longer depend on it.
  const contact = [0, 255].map(bounciness => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal, bounciness }); P.applyStats(b[1], { ...normal, bounciness });
    Object.assign(b[0], { x: 400, y: 300, vx: 500 }); Object.assign(b[1], { x: 430, y: 300, vx: -500 });
    P.step(b, 0);
    return b[1].vx - b[0].vx;
  });
  assert.equal(contact[0], contact[1]);
});

function kineticEnergy(bodies) {
  return bodies.reduce((sum, b) => sum + .5 * b.mass * (b.vx ** 2 + b.vy ** 2)
    + .25 * b.mass * b.radius ** 2 * b.omega ** 2, 0);
}

function closeSpinSetup(gap = 0, spin = 1, reach = 25) {
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach(b => P.applyStats(b));
  Object.assign(bodies[0], { x: 400, y: 300, reach, baseReach: reach });
  Object.assign(bodies[6], { x: 400 + reach + 18 + gap, y: 300 });
  P.startTurn(bodies, [{ angle: 0, power: .6, spin }]);
  return bodies;
}
function strikeCloseSpin(bodies) {
  const player = bodies[0], ball = bodies[6];
  ball.x = player.x + Math.max(player.radius, player.reach) + ball.radius - .1;
  ball.y = player.y;
  P.step(bodies, 0);
}

test('spin strike counter-rotates the ball 1x from range, ramping to 2x spin and a power boost within 2 ball diameters', () => {
  for (const spin of [-1, 0, 1]) {
    [15, 15, 22.5, 30].forEach((gain, i) => {
      const gap = [300, 72, 36, 0][i];
      const bodies = closeSpinSetup(gap, spin), control = structuredClone(bodies);
      control[6].openingShot = false;
      strikeCloseSpin(bodies); strikeCloseSpin(control);
      // Within range, the strike adds speed along the ball's heading: half the ubu's 432 px/s at
      // point blank and full spin. From range it adds none.
      const boost = [0, 0, 108, 216][i] * Math.abs(spin), speed = Math.hypot(control[6].vx, control[6].vy);
      assert.ok(Math.abs(Math.hypot(bodies[6].vx, bodies[6].vy) - speed - boost) < 1e-9);
      assert.ok(Math.abs(bodies[6].vx * control[6].vy - bodies[6].vy * control[6].vx) < 1e-6);
      // Contact friction already spins the ball against the ubu; the bonus adds to it, up to the ±24 cap.
      const expected = Math.max(-24, Math.min(24, control[6].omega - gain * spin));
      assert.ok(Math.abs(bodies[6].omega - expected) < 1e-9);
      if (spin) assert.ok(Math.sign(control[6].omega) === -spin);
    });
  }
  assert.equal(closeSpinSetup(0, 1, 37.5)[0].spinStrike, 2);
  assert.equal(closeSpinSetup(300)[0].spinStrike, 1);
});

test('spin strike uses the remaining spin, which decays at 5 rad/s while moving and 30 rad/s once linear motion settles', () => {
  const [ubu] = P.kickoff(); P.applyStats(ubu); ubu.vx = 100; ubu.omega = 10;
  P.step([ubu], .2);
  assert.ok(Math.abs(ubu.omega - 9) < 1e-9);
  const [stillSpin] = P.kickoff(); P.applyStats(stillSpin); stillSpin.omega = 10;
  P.step([stillSpin], .2);
  assert.ok(Math.abs(stillSpin.omega - 4) < 1e-9);
  const bodies = closeSpinSetup(300), control = structuredClone(bodies);
  bodies[0].omega = control[0].omega = 4; control[6].openingShot = false;
  strikeCloseSpin(bodies); strikeCloseSpin(control);
  assert.ok(Math.abs(bodies[6].omega - control[6].omega + 4) < 1e-9);
});

test('a wall bounce or another ubu touched first spends the spin strike', () => {
  const walled = closeSpinSetup(300);
  Object.assign(walled[0], { x: 80, y: 150, vx: -100 });
  P.step(walled, 0);
  assert.equal(walled[0].spinStrike, 0);
  for (const index of [1, 3]) {
    const bodies = closeSpinSetup(300);
    Object.assign(bodies[index], { x: bodies[0].x, y: bodies[0].y + 49, vx: 0, vy: 0 });
    P.step(bodies, 0);
    assert.equal(bodies[0].spinStrike, 0);
    Object.assign(bodies[index], { x: 800, y: 450 });
    const control = structuredClone(bodies); control[6].openingShot = false;
    strikeCloseSpin(bodies); strikeCloseSpin(control);
    assert.equal(bodies[6].omega, control[6].omega);
  }
});

test('a teammate or opponent touching first cancels the spin strike', () => {
  for (const index of [1, 3]) {
    const bodies = closeSpinSetup(20);
    Object.assign(bodies[index], { x: bodies[6].x + 43, y: 300, vx: 0, vy: 0 });
    P.step(bodies, 0);
    assert.equal(bodies[6].openingShot, false);
    Object.assign(bodies[index], { x: 800, y: 450 });
    const control = structuredClone(bodies); control[0].spinStrike = 0;
    strikeCloseSpin(bodies); strikeCloseSpin(control);
    assert.equal(bodies[6].omega, control[6].omega);
  }
});

test('spin strike is single use, with no bonus on simultaneous or separating touches', () => {
  const bodies = closeSpinSetup(); strikeCloseSpin(bodies);
  assert.equal(bodies[6].openingShot, false);
  Object.assign(bodies[0], { vx: 500, vy: 0, omega: 0 });
  Object.assign(bodies[6], { vx: 0, vy: 0, omega: 0 });
  strikeCloseSpin(bodies);
  assert.equal(bodies[6].omega, 0);
  const simultaneous = closeSpinSetup();
  Object.assign(simultaneous[1], { x: simultaneous[6].x + 43, y: 300 });
  const control = structuredClone(simultaneous); control[6].openingShot = false;
  P.step(simultaneous); P.step(control);
  assert.equal(simultaneous[6].omega, control[6].omega);
  const separating = closeSpinSetup(); separating[0].vx = -100;
  P.step(separating);
  assert.equal(separating[6].openingShot, false);
});

test('Sticky leaves a point-blank spin strike next turn; held and stunned ubus get no bonus', () => {
  const bodies = closeSpinSetup(); bodies[0].superActive = 'sticky';
  strikeCloseSpin(bodies);
  assert.equal(P.holder(bodies), bodies[0]);
  P.stop(bodies);
  P.startTurn(bodies, [{ angle: 0, power: .6, spin: 1 }]);
  assert.equal(bodies[0].spinStrike, 2);
  for (const stunned of [false, true]) {
    P.stop(bodies); bodies[0].stunned = stunned;
    P.startTurn(bodies, [{ angle: 0, power: stunned ? .6 : 0, spin: 1 }]);
    assert.equal(bodies[0].spinStrike, 0);
  }
});

test('spin strike curves the ball in the same way in preview and gameplay', () => {
  const bodies = closeSpinSetup(); P.stop(bodies);
  const before = structuredClone(bodies), plans = [{ angle: 0, power: .6, spin: 1 }];
  const prediction = P.predictTurn(bodies, plans);
  assert.deepEqual(bodies, before);
  P.startTurn(bodies, plans);
  for (let tick = 0; tick < 120; tick++) P.step(bodies);
  const point = prediction.paths[6].find(p => p.tick === 120);
  assert.equal(point.x, bodies[6].x); assert.equal(point.y, bodies[6].y);
  assert.ok(bodies[6].y < 290);
});

test('maximum bounce and checking stats cannot turn a collision into a speed boost', () => {
  const bodies = P.kickoff().slice(0, 2);
  bodies.forEach(b => P.applyStats(b, { bounciness: 255, strength: 255, stability: 0 }));
  Object.assign(bodies[0], { x: 400, y: 300, vx: 500 });
  Object.assign(bodies[1], { x: 449, y: 300, vx: -500 });
  const before = kineticEnergy(bodies);
  P.step(bodies, 0);
  assert.ok(kineticEnergy(bodies) <= before * (1 + 1e-12));
  assert.ok(bodies.every(b => Math.abs(b.vx) <= 500 + 1e-9));
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
  // A hot shot (the striking team driving into its own burning ball) is the one other designed source.
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

test('Shockwave cannot give an immovable Stalwart velocity for a later collision', () => {
  const bodies = P.kickoff();
  Object.assign(bodies[0], { x: 400, y: 300 });
  Object.assign(bodies[3], { x: 450, y: 300, superActive: 'stalwart' });
  P.triggerShockwave(bodies[0], bodies);
  assert.equal(bodies[3].vx, 0);
  assert.equal(bodies[3].vy, 0);
});

test('step invokes onCollide callback reporting colliding bodies and impact speed', () => {
  const b = P.kickoff();
  Object.assign(b[0], { x: 400, y: 300, vx: 500, vy: 0 });
  Object.assign(b[6], { x: 435, y: 300, vx: 0, vy: 0 });
  let reported = null;
  P.step(b, 0, ({ a: bodyA, b: bodyB, speed, impulse }) => {
    reported = { bodyA, bodyB, speed, impulse };
  });
  assert.ok(reported !== null);
  assert.equal(reported.bodyA, b[0]);
  assert.equal(reported.bodyB, b[6]);
  assert.ok(Math.abs(reported.speed - 500) < 1e-6);
  assert.ok(reported.impulse > 0);
});


test('SUPERS registry exposes all 8 canonical abilities with consistent metadata', () => {
  assert.equal(P.SUPERS.length, 8);
  const keys = ['stalwart', 'knockout', 'sticky', 'cannonball', 'magnet', 'colossus', 'shockwave', 'ghost'];
  P.SUPERS.forEach((s, i) => {
    assert.equal(s.id, i);
    assert.equal(s.key, keys[i]);
    assert.ok(typeof s.name === 'string' && s.name.length > 0);
    assert.ok(typeof s.desc === 'string' && s.desc.length > 0);
    assert.ok(typeof s.icon === 'string' && s.icon.endsWith('.png'));
  });
});

test('Stalwart anchors body at 0 velocity and does not move upon collision', () => {
  const b = P.kickoff();
  b[0].superActive = 'stalwart';
  Object.assign(b[0], { x: 400, y: 300, vx: 0, vy: 0 });
  Object.assign(b[3], { x: 440, y: 300, vx: -600, vy: 0 });
  P.step(b, 0);
  assert.equal(b[0].vx, 0);
  assert.equal(b[0].vy, 0);
  assert.equal(b[0].x, 400);
  assert.ok(b[3].vx > -100, 'skater stopped by anchor');
  const ballField = P.kickoff();
  ballField[0].superActive = 'stalwart';
  Object.assign(ballField[0], { x: 400, y: 300, vx: 0, vy: 0 });
  Object.assign(ballField[6], { x: 440, y: 300, vx: -600, vy: 0 });
  P.step(ballField, 0);
  assert.ok(ballField[6].vx > 0, 'ball rebounds off Stalwart');
});

test('Knockout stuns opponent on contact and prevents them from moving next turn', () => {
  const b = P.kickoff();
  b[0].superActive = 'knockout';
  Object.assign(b[0], { x: 400, y: 300, vx: 500, vy: 0 });
  Object.assign(b[3], { x: 435, y: 300, vx: 0, vy: 0 });
  P.step(b, 0);
  assert.equal(b[3].stunnedNext, true);
  assert.equal(b[0].superActive, null);

  b[3].stunned = b[3].stunnedNext;
  delete b[3].stunnedNext;
  P.launch(b, Array.from({ length: 6 }, () => ({ angle: 0, power: 1 })));
  assert.equal(b[3].vx, 0);
  assert.equal(b[3].vy, 0);
  assert.equal(b[3].stunned, true);
  P.stop(b);
  assert.equal(b[3].stunned, false);
});

test('consumed supers refund mastery exactly once at standard and Pulse turn boundaries', () => {
  for (const key of ['cannonball', 'knockout']) {
    for (const keepMotion of [false, true]) {
      for (const bonusRefund of [0, 5, 10, 20]) {
        const bodies = P.kickoff(), source = bodies[0];
        const target = key === 'cannonball' ? bodies[6] : bodies[3];
        const moves = Array.from({ length: 6 }, () => ({ angle: 0, power: 0 }));
        Object.assign(source, { x: 400, y: 300, meter: 100, superArm: true, equippedSuper: { key, bonusRefund } });
        Object.assign(target, { x: 435, y: 300, vx: 0, vy: 0 });
        P.startTurn(bodies, moves);
        source.vx = 500;
        P.step(bodies, 0);
        assert.equal(source.superActive, null);
        P.stop(bodies, keepMotion);
        assert.equal(source.meter, bonusRefund);
        P.endSuper(source, bodies);
        P.startTurn(bodies, moves);
        P.stop(bodies);
        assert.equal(source.meter, bonusRefund);
      }
    }
  }
});

test('Sticky grabs the ball on contact and carries it along with skater movement', () => {
  const b = P.kickoff();
  b[0].superActive = 'sticky';
  Object.assign(b[0], { x: 460, y: 300, vx: 400, vy: 0 });
  Object.assign(b[6], { x: 500, y: 300, vx: 0, vy: 0 });
  P.step(b, 0);
  assert.equal(P.holder(b), b[0]);
  const initialBallX = b[6].x;
  for (let i = 0; i < 20; i++) P.step(b, P.DT);
  assert.ok(b[6].x > initialBallX);
  assert.equal(P.holder(b), b[0]);
});

test('Cannonball amplifies impulse imparted to the ball on contact', () => {
  const runShot = isSuper => {
    const b = P.kickoff();
    if (isSuper) b[0].superActive = 'cannonball';
    Object.assign(b[0], { x: 460, y: 300, vx: 500, vy: 0 });
    Object.assign(b[6], { x: 500, y: 300, vx: 0, vy: 0 });
    P.step(b, 0);
    return b[6].vx;
  };
  const normalVx = runShot(false);
  const cannonVx = runShot(true);
  assert.ok(cannonVx > normalVx * 1.8);
});

test('Magnet exerts an active attractive pull on the ball while in motion', () => {
  const b = P.kickoff();
  b[0].superActive = 'magnet';
  Object.assign(b[0], { x: 350, y: 300, vx: 100, vy: 0 });
  Object.assign(b[6], { x: 500, y: 300, vx: 0, vy: 0 });
  for (let i = 0; i < 30; i++) P.step(b, P.DT);
  assert.ok(b[6].vx < 0);
});

test('Colossus increases radius and mass during launch and restores them on stop', () => {
  const b = P.kickoff();
  P.applyStats(b[0], normal);
  const origRadius = b[0].radius;
  const origMass = b[0].mass;
  b[0].superActive = 'colossus';
  P.launch(b, [{ angle: 0, power: 0.5 }]);
  assert.ok(Math.abs(b[0].radius - P.SUPER.colossusRadius) < 1e-6);
  assert.ok(Math.abs(b[0].mass - P.SUPER.colossusMass) < 1e-6);
  P.stop(b);
  assert.ok(Math.abs(b[0].radius - origRadius) < 1e-6);
  assert.ok(Math.abs(b[0].mass - origMass) < 1e-6);
});

test('Shockwave propels nearby opponents radially outward, never teammates or the ball', () => {
  const b = P.kickoff();
  Object.assign(b[0], { x: 400, y: 300, team: 0 });
  Object.assign(b[1], { x: 450, y: 300, vx: 0, vy: 0, team: 0 });
  Object.assign(b[3], { x: 450, y: 300, vx: 0, vy: 0, team: 1 });
  Object.assign(b[6], { x: 400, y: 360, vx: 0, vy: 0, team: -1 });
  let shockRadius = null;
  P.triggerShockwave(b[0], b, (source, radius) => { shockRadius = radius; });
  assert.equal(shockRadius, P.SUPER.shockRadius);
  assert.equal(b[1].vx, 0, 'teammate not propelled');
  assert.ok(b[3].vx > 0, 'opponent propelled');
  assert.equal(b[6].vy, 0, 'ball not propelled');
});

test('Ghost phases through opposing players without collision but still hits the ball', () => {
  const b = P.kickoff();
  b[0].superActive = 'ghost';
  Object.assign(b[0], { x: 400, y: 300, vx: 500, vy: 0 });
  Object.assign(b[3], { x: 430, y: 300, vx: 0, vy: 0 });
  P.step(b, 0);
  assert.equal(b[0].vx, 500);
  assert.equal(b[3].vx, 0);

  Object.assign(b[0], { x: 460, y: 300, vx: 500, vy: 0 });
  Object.assign(b[6], { x: 500, y: 300, vx: 0, vy: 0 });
  P.step(b, 0);
  assert.ok(b[6].vx > 0);
});

test('settled keeps a strict velocity boundary after squared-distance optimization', () => {
  const bodies = P.kickoff();
  assert.equal(P.settled(bodies), true);
  bodies[0].vx = 2;
  assert.equal(P.settled(bodies), false);
  bodies[0].vx = 1.999;
  assert.equal(P.settled(bodies), true);
  bodies[0].omega = 0.05;
  assert.equal(P.settled(bodies), false);
});
test('low-speed zero-spin motion brakes to rest without changing position integration', () => {
  const bodies = P.kickoff(), b = bodies[0], dt = P.DT;
  Object.assign(b, { vx: 0.2, vy: -0.3, omega: 0 });
  const x = b.x + b.vx * dt, y = b.y + b.vy * dt;
  P.step(bodies);
  assert.ok(Math.abs(b.x - x) < 1e-12);
  assert.ok(Math.abs(b.y - y) < 1e-12);
  assert.equal(b.vx, 0);
  assert.equal(b.vy, 0);
});
test('magnet attraction respects its distance bounds', () => {
  const bodies = P.kickoff();
  Object.assign(bodies[0], { x: 500 - P.SUPER.magnetRadius + 20, y: 300, superActive: 'magnet' });
  P.step(bodies, P.DT);
  assert.ok(bodies[6].vx < 0);
  const distant = P.kickoff();
  Object.assign(distant[0], { x: 180, y: 300, superActive: 'magnet' });
  P.step(distant, P.DT);
  assert.equal(distant[6].vx, 0);
});
test('shockwaves stay finite at coincident positions and repel nearby bodies', () => {
  const source = { x: 300, y: 300, vx: 0, vy: 0, mass: 3, team: 0 };
  const center = { x: 300, y: 300, vx: 0, vy: 0, mass: 3, team: 1 };
  const nearby = { x: 400, y: 300, vx: 0, vy: 0, mass: 1, team: 1 };
  const far = { x: 600, y: 300, vx: 0, vy: 0, mass: 1, team: 1 };
  P.triggerShockwave(source, [source, center, nearby, far]);
  assert.deepEqual([center.vx, center.vy], [0, 0]);
  assert.ok(nearby.vx > 0);
  assert.equal(far.vx, 0);
  assert.ok([center, nearby, far].every(b => Number.isFinite(b.vx) && Number.isFinite(b.vy)));
});
test('zero-spin full-speed movement stays finite over long physics turns', () => {
  const bodies = P.kickoff();
  const plans = Array.from({ length: 6 }, (_, i) => ({ angle: i * Math.PI / 3, power: 1, spin: 0 }));
  P.launch(bodies, plans);
  for (let i = 0; i < 480; i++) {
    P.step(bodies);
    assert.ok(bodies.every(b => [b.x, b.y, b.vx, b.vy, b.omega].every(Number.isFinite)));
  }
});

test('Sticky with high reach does not self-collide or propel carrier backwards', () => {
  const b = P.kickoff();
  P.applyStats(b[0], { ...normal, reach: 255 });
  b[0].superActive = 'sticky';
  Object.assign(b[0], { x: 455, y: 300, vx: 400, vy: 0 });
  Object.assign(b[6], { x: 500, y: 300, vx: 0, vy: 0 });
  let collisions = 0;
  for (let i = 0; i < 30; i++) P.step(b, P.DT, () => { collisions++; });
  assert.equal(P.holder(b), b[0]);
  assert.equal(collisions, 1);
  assert.ok(b[0].vx > 0 && b[0].x > 455);
});

test('Sticky carrier near wall keeps welded ball strictly inside rink boundaries', () => {
  const b = P.kickoff();
  b[0].superActive = 'sticky';
  Object.assign(b[0], { x: 860, y: 150, vx: 600, vy: -200 });
  Object.assign(b[6], { x: 903, y: 150, vx: 0, vy: 0 });
  for (let i = 0; i < 120; i++) {
    P.step(b, P.DT);
    assert.ok(b[6].x <= P.rink.right - b[6].radius + 1e-6);
    assert.ok(b[6].y >= P.rink.top + b[6].radius - 1e-6);
  }
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
    assert.equal(prediction.paths.length, 7);
    assert.ok(prediction.ticks <= 480);
  }
});

test('prediction preserves opponents active supers from Pulse mode while clearing secret superArm', () => {
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach((b, i) => P.applyStats(b, { ...normal }));
  // Opponent has Colossus active from previous turn
  bodies[3].superActive = 'colossus';
  P.syncEffectiveStats(bodies[3]);
  bodies[3].superTicks = 400;
  // Opponent has secret unlaunched superArm
  bodies[4].superArm = true;
  bodies[4].meter = 100;
  bodies[4].equippedSuper = P.SUPERS[4]; // magnet

  const plans = [{ angle: 0, power: 0.8, spin: 0 }];
  const prediction = P.predictTurn(bodies, plans);

  // Live simulation comparison confirms parity
  const live = structuredClone(bodies);
  live[4].superArm = false; // secret arm cleared
  P.startTurn(live, plans);
  assert.equal(live[3].superActive, 'colossus');
  assert.equal(Boolean(live[4].superActive), false); // unlaunched arm was ignored

  // Step live simulation and verify prediction matches live paths
  for (let tick = 1; tick <= prediction.ticks; tick++) {
    P.step(live, P.DT);
    for (let i = 0; i < live.length; i++) {
      const point = prediction.paths[i].find(p => p.tick === tick);
      if (point) assert.deepEqual([point.x, point.y], [live[i].x, live[i].y], `body ${i} tick ${tick}`);
    }
  }
});

test('shared prediction preserves Sticky references and accounts for a holding teammate being struck', () => {
  const bodies = P.kickoff();
  Object.assign(bodies[0], { x: 350, y: 300 });
  Object.assign(bodies[1], { x: 430, y: 300 });
  Object.assign(bodies[6], { x: 473, y: 300, stickOffset: { x: 43, y: 0 } }); bodies[1].holding = true;
  const plans = [{ angle: 0, power: 1, spin: .3 }];
  const original = structuredClone(bodies);
  const prediction = P.predictTurn(bodies, plans);
  assert.deepEqual(bodies, original);
  assert.equal(P.holder(bodies), bodies[1]);
  assert.ok(prediction.paths[1].some(p => p.x !== 430));
  assert.ok(prediction.paths[6].some(p => p.x !== 473));
  const held = P.predictTurn(bodies, []);
  assert.notDeepEqual(prediction.paths[6], held.paths[6]);
});

test('AI Tactical Brain dynamically assigns roles and behaviors from 24-bit personality', () => {
  // 1. Aggression drives dynamic Striker vs Crease Anchor assignment
  const bRole = P.kickoff();
  bRole[3].personality = { aggression: 0, creativity: 31, teamwork: 31, clutch: 31 };
  bRole[4].personality = { aggression: 63, creativity: 0, teamwork: 0, clutch: 31 };
  bRole[5].personality = { aggression: 63, creativity: 0, teamwork: 0, clutch: 31 };
  const rolePlans = P.cpuPlans(bRole, () => 0.5, [0, 0]);
  assert.ok(rolePlans[0].power < 0.35);
  assert.ok(rolePlans[1].power > 0.5);

  // 2. Creativity unlocks spin curve around a screening defender
  const bCre = P.kickoff();
  Object.assign(bCre[0], { x: 300, y: 300 });
  Object.assign(bCre[4], { x: 580, y: 300, personality: { aggression: 50, creativity: 0, teamwork: 0, clutch: 31 } });
  const linearPlan = P.cpuPlans(bCre, () => 0.5)[1];
  bCre[4].personality = { aggression: 50, creativity: 63, teamwork: 0, clutch: 31 };
  const creativePlan = P.cpuPlans(bCre, () => 0.5)[1];
  assert.equal(linearPlan.spin, 0);
  assert.ok(Math.abs(creativePlan.spin) > 0.4);

  // 3. Teamwork redirects blocked shot into a lead pass for an open wing teammate
  const bTmw = P.kickoff();
  Object.assign(bTmw[0], { x: 320, y: 300 });
  Object.assign(bTmw[4], { x: 580, y: 300, personality: { aggression: 45, creativity: 10, teamwork: 0, clutch: 31 } });
  Object.assign(bTmw[5], { x: 400, y: 160 });
  const soloPlan = P.cpuPlans(bTmw, () => 0.5)[1];
  bTmw[4].personality = { aggression: 45, creativity: 10, teamwork: 63, clutch: 31 };
  const passPlan = P.cpuPlans(bTmw, () => 0.5)[1];
  assert.ok(Math.abs(soloPlan.angle - passPlan.angle) > 0.15);

  // 4. Option A Clutch spectrum: Iceman (0) stays composed in crease vs Hero Ball (63) surges up-ice at match point
  const bClu = P.kickoff();
  for (let i = 3; i < 6; i++) bClu[i].personality = { aggression: 31, creativity: 31, teamwork: 31, clutch: 0 };
  const icemanPlans = P.cpuPlans(bClu, () => 0.9, [4, 3]);
  for (let i = 3; i < 6; i++) bClu[i].personality = { aggression: 31, creativity: 31, teamwork: 31, clutch: 63 };
  const heroPlans = P.cpuPlans(bClu, () => 0.9, [4, 3]);
  assert.ok(heroPlans[0].power > icemanPlans[0].power);
  assert.ok(heroPlans[1].power > icemanPlans[1].power);

  // 5. Tactical Super selection stays hidden on bodies during planning and only arms contextually
  const bSup = P.kickoff();
  Object.assign(bSup[3], { x: 830, y: 300, meter: 100, equippedSuper: P.SUPERS[0], personality: { aggression: 0, creativity: 31, teamwork: 31, clutch: 0 } });
  Object.assign(bSup[4], { x: 570, y: 300, meter: 100, equippedSuper: P.SUPERS[3], personality: { aggression: 60, creativity: 31, teamwork: 31, clutch: 63 } });
  const supPlans = P.cpuPlans(bSup, () => 0.5, [4, 2]);
  assert.equal(supPlans[0].superArm, true); // Anchor arms Stalwart in crease under threat
  assert.ok(supPlans[0].power > 0);
  assert.equal(supPlans[1].superArm, true); // Striker arms Cannonball on clean look
  assert.equal(Boolean(bSup[3].superArm), false); // Body state untouched during planning
});

test('Super events report effects once without changing the simulation', () => {
  for (const key of ['knockout', 'sticky', 'cannonball', 'stalwart']) {
    const all = P.kickoff();
    const a = all[0], b = key === 'sticky' || key === 'cannonball' ? all[6] : all[3];
    Object.assign(a, { x: 400, y: 250, vx: key === 'stalwart' ? 0 : 100, superActive: key });
    Object.assign(b, { x: 400 + a.radius + b.radius - 2, y: 250, vx: -100 });
    const bodies = [a, b], control = structuredClone(bodies), events = [];
    P.step(bodies, P.DT, null, null, null, (key, phase, source, target) => {
      assert.equal(source, a); assert.equal(target, b);
      events.push([key, phase]);
    });
    P.step(control, P.DT);
    assert.deepEqual(bodies, control, key + ' callback is observational');
    assert.deepEqual(events, [[key, 'impact']]);
    if (key !== 'stalwart') {
      for (let i = 0; i < 10; i++) P.step(bodies, P.DT, null, null, null, (key, phase) => events.push([key, phase]));
      assert.equal(events.length, 1, key + ' does not repeat after consumption/grab');
    }
  }
});

test('Magnet pull event only fires inside its active range with a free ball', () => {
  for (const [distance, stuck, expected] of [[150, false, true], [300, false, false], [150, true, false]]) {
    const all = P.kickoff(), a = all[0], ball = all[6];
    Object.assign(a, { x: 400, y: 250, superActive: 'magnet' });
    Object.assign(ball, { x: 400 + distance, y: 250 });
    if (stuck) a.holding = true;
    const bodies = [a, ball], control = structuredClone(bodies), events = [];
    P.step(bodies, P.DT, null, null, null, key => events.push(key));
    P.step(control, P.DT);
    assert.deepEqual(bodies, control);
    assert.deepEqual(events, expected ? ['magnet'] : []);
  }
});


test('prediction stops at goals or its tick budget and respects stun and super charge', () => {
  const bodies = P.kickoff();
  Object.assign(bodies[6], { x: 945, y: 300, vx: 400 });
  const goal = P.predictTurn(bodies, []);
  assert.equal(goal.goal, 0);
  const live = structuredClone(bodies);
  P.startTurn(live, []);
  let goalTick = 0, scored = null;
  while (scored === null && goalTick < 480) { scored = P.step(live, P.DT); goalTick++; }
  assert.equal(goal.ticks, goalTick);
  assert.equal(goal.paths[6].at(-1).tick, goalTick);
  assert.ok(goal.goalTargets);
  assert.equal(goal.goalTargets.length, 7);
  assert.equal(goal.goalTargets[6].index, 6);
  // An ubu launched when a goal is scored continues its path past the goal tick
  const movingUbu = P.kickoff();
  Object.assign(movingUbu[6], { x: 945, y: 300, vx: 400 });
  const movingPrediction = P.predictTurn(movingUbu, [{ angle: 0, power: 1, spin: 0 }]);
  assert.equal(movingPrediction.goal, 0);
  assert.equal(movingPrediction.paths[6].at(-1).tick, goalTick);
  assert.ok(movingPrediction.paths[0].at(-1).tick > goalTick);
  const drifting = P.kickoff();
  Object.assign(drifting[6], { vx: 20, friction: 0 });
  assert.equal(P.predictTurn(drifting, []).ticks, 480);
  const stunned = P.kickoff();
  Object.assign(stunned[0], { stunned: true, superArm: true, meter: 100, equippedSuper: P.SUPERS[5] });
  const plan = [{ angle: 0, power: 1, spin: 1 }];
  const prediction = P.predictTurn(stunned, plan);
  assert.equal(prediction.ticks, 1);
  assert.deepEqual(prediction.paths[0].at(-1), { x: 180, y: 300, tick: 1 });
  stunned[0].stunned = false; stunned[0].meter = 99;
  const undercharged = P.predictTurn(stunned, plan);
  stunned[0].superArm = false;
  assert.deepEqual(undercharged, P.predictTurn(stunned, plan));
});

test('size does not change how an ubu slows down', () => {
  const travel = size => {
    const b = P.kickoff(); P.applyStats(b[0], { ...normal, size });
    Object.assign(b[0], { x: 200, y: 300, vx: 600 });
    for (let i = 0; i < 240; i++) P.step([b[0]]);
    return b[0].x;
  };
  const [small, mid, big] = [0, 127, 255].map(travel);
  assert.equal(small, mid); assert.equal(mid, big);
});

test('small ubus launch faster, curve and re-steer more, and strike spin harder', () => {
  const ubu = size => { const b = P.kickoff()[0]; P.applyStats(b, { ...normal, size }); return b; };
  const [small, mid, big] = [0, 127, 255].map(ubu);
  assert.ok(P.launchSpeed(small) > P.launchSpeed(mid) && P.launchSpeed(mid) > P.launchSpeed(big));
  assert.ok(small.curveFactor > mid.curveFactor && mid.curveFactor > big.curveFactor);
  // Turning a moving ubu straight around: a small one gets further.
  const turn = size => {
    const b = P.kickoff(); P.applyStats(b[0], { ...normal, size }); Object.assign(b[0], { vx: 600, vy: 0 });
    P.launch(b, [{ angle: Math.PI, power: 1 }]);
    return b[0].vx;
  };
  assert.ok(turn(0) < turn(127) && turn(127) < turn(255));
  // Point-blank spin strike: the small striker gives the ball more spin and speed.
  const strike = size => {
    const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal)); P.applyStats(b[0], { ...normal, size });
    Object.assign(b[0], { x: 400, y: 300 }); Object.assign(b[6], { x: 400 + b[0].reach + 18, y: 300 });
    P.startTurn(b, [{ angle: 0, power: .6, spin: .4 }]); // Below the ball's spin cap.
    b[6].x = b[0].x + Math.max(b[0].radius, b[0].reach) + 18 - .1; P.step(b, 0);
    return { spin: Math.abs(b[6].omega), speed: Math.hypot(b[6].vx, b[6].vy) };
  };
  const [s0, s1] = [strike(0), strike(127)];
  assert.ok(s0.spin > s1.spin && s0.speed > s1.speed);
});
test('curve strengthens spin strikes and bends the ball its ubu strikes', () => {
  const shot = curve => {
    const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal)); P.applyStats(b[0], { ...normal, curve });
    Object.assign(b[0], { x: 400, y: 300 }); Object.assign(b[6], { x: 443, y: 300 });
    P.startTurn(b, [{ angle: 0, power: .6, spin: .5 }]);
    b[6].x = 442.9; P.step(b, 0);
    return b[6];
  };
  const [low, high] = [shot(0), shot(255)];
  assert.ok(Math.abs(high.omega) > Math.abs(low.omega));
  assert.equal(Math.sign(high.omega), Math.sign(low.omega)); // Still counter-rotating, never reversed.
  assert.ok(P.ballCurveFactor(high) > P.ballCurveFactor(low));
});
test('hard checks daze the next launch, stack, and Stability resists them', () => {
  const check = (stability, hits, superActive = null) => {
    const b = P.kickoff(); P.applyStats(b[0], normal); P.applyStats(b[3], { ...normal, stability });
    Object.assign(b[3], { superActive, superTicks: 720 });
    for (let i = 0; i < hits; i++) { Object.assign(b[0], { x: 300, y: 300, vx: 720, vy: 0 }); Object.assign(b[3], { x: 349, y: 300, vx: 0, vy: 0 }); P.step(b, 0); }
    return b;
  };
  const once = check(127, 1)[3].daze, twice = check(127, 2)[3].daze;
  assert.ok(Math.abs(once - .15) < .005 && twice > once && check(127, 4)[3].daze === P.DAZE.max);
  assert.ok(!check(127, 1)[0].daze); // The attacker is not dazed by its own check.
  assert.ok(!check(127, 4, 'stalwart')[3].daze);
  const crash = P.kickoff(); P.applyStats(crash[0], normal); P.applyStats(crash[3], normal);
  Object.assign(crash[0], { x: 300, y: 300, vx: 720 }); Object.assign(crash[3], { x: 349, y: 300, vx: -720 }); P.step(crash, 0);
  assert.equal(crash[0].daze, P.DAZE.hit); assert.equal(crash[3].daze, P.DAZE.hit); // Head-on: both, capped per hit.
  assert.ok(check(255, 1)[3].daze < once);
  // A soft bump does nothing.
  const soft = P.kickoff(); P.applyStats(soft[0], normal); P.applyStats(soft[3], normal);
  Object.assign(soft[0], { x: 300, y: 300, vx: 200 }); Object.assign(soft[3], { x: 349, y: 300 }); P.step(soft, 0);
  assert.ok(!soft[3].daze);
  // The next launch is slower, then the daze is gone.
  // Up to 15% a daze does nothing; beyond it the launch slows, reaching 40% at the cap.
  assert.equal(P.dazeSlow({ daze: once }), 0);
  assert.ok(Math.abs(P.dazeSlow({ daze: P.DAZE.max }) - .4) < 1e-12);
  const dazed = check(127, 2), slow = P.dazeSlow(dazed[3]), full = P.launchSpeed({ ...dazed[3], daze: 0 });
  assert.ok(slow > 0);
  Object.assign(dazed[3], { vx: 0, vy: 0 });
  P.launch(dazed, [null, null, null, { angle: 0, power: 1 }]);
  assert.ok(Math.abs(Math.abs(dazed[3].vx) - full * (1 - slow)) < 1e-9);
  assert.equal(dazed[3].daze, 0);
});
test('traction spans a narrower range than other stats', () => {
  const friction = traction => { const b = P.kickoff()[0]; P.applyStats(b, { ...normal, traction }); return b.friction; };
  assert.ok(Math.abs(friction(255) - 150 * 1.5 ** .7) < 1e-9 && Math.abs(friction(0) - 150 * (2 / 3) ** .7) < 1e-9);
});

test('supers last three seconds of play, carrying across Pulse turns', () => {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  b[0].meter = 100; b[0].equippedSuper = P.SUPERS[4];
  P.startTurn(b, [{ angle: 0, power: 0, spin: 0, superArm: true }]);
  assert.equal(b[0].superActive, 'magnet'); assert.equal(b[0].superTicks, P.SUPER.ticks);
  for (let i = 0; i < 240; i++) P.step(b);
  P.stop(b, true); // A Pulse turn break keeps it running.
  assert.equal(b[0].superActive, 'magnet');
  for (let i = 0; i < P.SUPER.ticks; i++) P.step(b);
  assert.equal(b[0].superActive, null);
  b[0].superActive = 'ghost'; b[0].superTicks = 100; P.stop(b); // A full stop ends it.
  assert.equal(b[0].superActive, null);
});
test('Sticky lets go after its hold time or when an opponent hits the carrier, who skates slower', () => {
  const grab = () => {
    const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
    Object.assign(b[0], { x: 400, y: 300, vx: 200, superActive: 'sticky', superTicks: P.SUPER.ticks });
    Object.assign(b[6], { x: 442, y: 300 }); P.step(b, 0);
    return b;
  };
  const held = grab(); assert.equal(P.holder(held), held[0]);
  for (let i = 0; i < P.SUPER.holdTicks; i++) P.step(held);
  assert.equal(P.holder(held), null); assert.equal(held[0].superActive, null);
  const hit = grab(); Object.assign(hit[3], { x: hit[0].x - 49, y: 300, vx: 400 }); P.step(hit, 0);
  assert.equal(P.holder(hit), null);
  const free = P.kickoff(); P.applyStats(free[0], normal); Object.assign(free[0], { x: 400, y: 300, vx: 200 });
  const carrier = grab(); Object.assign(carrier[0], { vx: 200, vy: 0 });
  P.step(free); P.step(carrier);
  assert.ok(carrier[0].vx < free[0].vx);
});
test('Shockwave bursts on first proximity with an opponent and repels opponents only', () => {
  const field = () => {
    const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
    Object.assign(b[0], { x: 400, y: 300, superActive: 'shockwave', superTicks: P.SUPER.ticks });
    return b;
  };
  const touchBall = field(); Object.assign(touchBall[0], { vx: 300 }); Object.assign(touchBall[6], { x: 442, y: 300 }); P.step(touchBall, 0);
  assert.ok(!touchBall[0].shockwaveFired);
  const touchMate = field(); Object.assign(touchMate[1], { x: 449, y: 300, vx: -300 }); P.step(touchMate, 0);
  assert.ok(!touchMate[0].shockwaveFired);
  const touchFoe = field(); Object.assign(touchFoe[3], { x: 449, y: 300, vx: -100 }); P.step(touchFoe, P.DT);
  assert.ok(touchFoe[0].shockwaveFired);
  assert.ok(touchFoe[3].vx > 0);
  const timed = field(); timed[0].superTicks = 1; Object.assign(timed[1], { x: 480, y: 300 }); Object.assign(timed[3], { x: 400, y: 490 });
  P.step(timed, P.DT);
  assert.equal(timed[1].vx, 0);
  assert.equal(timed[3].vy, 0);
});
test('knocked-out ubus cannot guard, and Colossus launches at a slower pace', () => {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  b[0].stunned = true;
  P.startTurn(b, [{ angle: 0, power: 0, spin: 0, guard: true }]);
  assert.equal(b[0].guarding, false);
  const c = P.kickoff(); P.applyStats(c[0], normal); c[0].superActive = 'colossus';
  P.launch(c, [{ angle: 0, power: 1 }]);
  assert.ok(Math.abs(c[0].vx - 720 * P.SUPER.colossusLaunch) < 1e-9);
});
// A fireball that beats an ubu's resistance hits as the heavier body and deflects it; it never
// passes through it, and the hit adds no energy.
function fireballInto(offset) {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  const ball = b[6], defender = b[3];
  Object.assign(defender, { x: 560, y: 300 + offset, vx: 0, vy: 0 });
  Object.assign(ball, { x: 460, y: 300, vx: 800, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, strikerPower: 1, strikerTeam: 0 });
  let hit = null;
  for (let t = 0; t < 120 && !hit; t++) {
    const before = kineticEnergy(b);
    P.step(b, P.DT, ({ plow }) => { hit = { plow, before }; });
  }
  assert.ok(hit?.plow, 'the hit is a winning fire hit');
  assert.ok(kineticEnergy(b) <= hit.before * (1 + 1e-10), 'the hit adds no energy');
  return { b, ball, defender };
}
test('a winning fireball shoves a head-on ubu ahead and follows behind it', () => {
  const { b, ball, defender } = fireballInto(0);
  assert.ok(ball.vx > 0, 'ball carries on forward');
  assert.ok(defender.vx > ball.vx, 'defender leaves faster than the ball follows');
  assert.ok(defender.daze > 0, 'defender is dazed');
  assert.equal(ball.strikerTeam, 0, 'the overpowered ubu does not become the striker');
  for (let t = 0; t < 120; t++) { P.step(b, P.DT); assert.ok(defender.x > ball.x, `ball stays behind the defender (tick ${t})`); }
});
test('a winning fireball glances off an ubu, keeping close to its line and its fire', () => {
  const { b, ball, defender } = fireballInto(38);
  assert.ok(Math.abs(Math.atan2(ball.vy, ball.vx)) < Math.PI / 6, 'ball keeps close to its line');
  assert.ok(ball.vy < 0 && defender.vy > 0, 'ball and ubu part across the line of contact');
  assert.ok(P.ballOnFire(ball), 'ball keeps its fire');
  for (let t = 0; t < 120; t++) { P.step(b, P.DT); assert.ok(Math.hypot(ball.x - defender.x, ball.y - defender.y) > defender.radius, `ball stays outside the ubu (tick ${t})`); }
});
test('Cannonball instantly sets ball on fire', () => {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  b[0].superActive = 'cannonball';
  Object.assign(b[0], { x: 457, y: 300, vx: 720, vy: 0 });
  Object.assign(b[6], { x: 500, y: 300, vx: 0, vy: 0 });
  P.step(b, 0);
  assert.equal(P.ballOnFire(b[6]), true);
  assert.ok(b[6].fireTicks >= P.FIRE_TICKS);
});
test('Meteor Bank preserves ball speed on board rebound while on fire', () => {
  const b = P.kickoff();
  const ball = b[6];
  Object.assign(ball, { x: P.rink.right - 10, y: 300, vx: 600, vy: 300, onFire: true, fireTicks: P.FIRE_TICKS });
  const preSpeed = Math.hypot(ball.vx, ball.vy);
  P.step(b, 0);
  const postSpeed = Math.hypot(ball.vx, ball.vy);
  assert.ok(Math.abs(preSpeed - postSpeed) < 1e-4, 'Meteor Bank keeps 100% velocity');
});
// A Guard move squared up to a default-power fireball stops it at full speed; a glancing hit beats it.
function guardAgainstFireball(offset) {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  const still = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
  Object.assign(b[3], { x: 600, y: 300 + offset });
  P.startTurn(b, [still, still, still, { ...still, guard: true }, still, still]);
  Object.assign(b[6], { x: 540, y: 300, vx: 1000, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, strikerPower: 1, strikerTeam: 0 });
  let iron = false, beaten = false, shockwave = false;
  for (let t = 0; t < 60 && !iron && !beaten; t++) {
    P.step(b, P.DT, ({ plow, iron: isIron }) => { if (isIron) iron = true; else if (plow) beaten = true; }, null, (src, rad, type) => { if (type === 'iron') shockwave = true; });
  }
  return { ball: b[6], iron, beaten, shockwave };
}
test('Iron Save triggers when an opposing Guard squares up to a full-speed fireball', () => {
  const { ball, iron, shockwave } = guardAgainstFireball(0);
  assert.equal(iron, true, 'the Guard makes an Iron Save');
  assert.equal(P.ballOnFire(ball), false, 'fire is quenched on Iron Save');
  assert.equal(shockwave, true, 'minor shockwave is emitted');
});
test('Iron Save triggers for a teammate pass without extinguishing the fireball', () => {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  const still = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
  Object.assign(b[1], { x: 600, y: 300 });
  P.startTurn(b, [still, { ...still, guard: true }, still, still, still, still]);
  Object.assign(b[6], { x: 540, y: 300, vx: 1000, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, strikerPower: 1, strikerTeam: 0, pace: 1000 });
  let iron = false, shockwave = false;
  for (let t = 0; t < 60 && !iron; t++) {
    P.step(b, P.DT, ({ iron: isIron }) => { if (isIron) iron = true; }, null, (src, rad, type) => { if (type === 'iron') shockwave = true; });
  }
  assert.equal(iron, true, 'the teammate Guard makes an Iron Save');
  assert.equal(shockwave, true, 'iron shockwave is triggered');
  assert.equal(P.ballOnFire(b[6]), true, 'the fireball is not extinguished on teammate Iron Save');
  assert.ok(b[6].pace > 840, 'pace remains high');
});
test('Iron Save triggers for a non-flaming teammate pass at or above 180 px/s, but not below or from opponents', () => {
  const check = (speed, strikerTeam, guardIndex = 1) => {
    const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
    const still = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
    b.slice(0, 6).forEach(x => Object.assign(x, { x: x.team ? 900 : 100, y: 80 + x.slot * 60 }));
    Object.assign(b[guardIndex], { x: 600, y: 300 });
    const plans = Array.from({ length: 6 }, () => still); plans[guardIndex] = { ...still, guard: true };
    P.startTurn(b, plans);
    Object.assign(b[6], { x: 550, y: 300, vx: speed, vy: 0, onFire: false, fireTicks: 0, strikerPower: 1, strikerTeam, pace: speed });
    let iron = false, shockwave = false;
    for (let t = 0; t < 60 && !iron; t++) {
      P.step(b, P.DT, ({ iron: isIron }) => { if (isIron) iron = true; }, null, (src, rad, type) => { if (type === 'iron') shockwave = true; });
    }
    return { iron, shockwave, ball: b[6] };
  };
  const pass180 = check(180, 0);
  assert.equal(pass180.iron, true, 'teammate pass at 180 px/s triggers Iron Save');
  assert.equal(pass180.shockwave, true, 'iron shockwave triggered');
  assert.ok(Math.hypot(pass180.ball.vx, pass180.ball.vy) < 20, 'ball is trapped at guard feet');

  const passFast = check(400, 0);
  assert.equal(passFast.iron, true, 'fast teammate pass triggers Iron Save');

  const passSlow = check(170, 0);
  assert.equal(passSlow.iron, false, 'teammate pass below 180 px/s does not trigger Iron Save');

  const oppShot = check(400, 1);
  assert.equal(oppShot.iron, false, 'opponent non-flaming shot does not trigger Iron Save');
});
test('a glancing full-speed fireball beats a Guard', () => {
  const { ball, iron, beaten } = guardAgainstFireball(20);
  assert.equal(iron, false);
  assert.equal(beaten, true, 'the fireball overpowers the Guard');
  assert.equal(P.ballOnFire(ball), true, 'and keeps its fire');
});
// Pace: slowing by the striking team's own ubus does not count against the ball's fire; anyone else's does.
// A Guard (team 0 at index 1, or team 1 at index 4) stops a 1000 px/s fireball struck by team 0.
function fireballStopped(guard) {
  const still = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  b.slice(0, 6).forEach(x => Object.assign(x, { x: x.team ? 900 : 100, y: 80 + x.slot * 60 }));
  Object.assign(b[guard], { x: 600, y: 300 });
  const plans = Array.from({ length: 6 }, () => still); plans[guard] = { ...still, guard: true };
  P.startTurn(b, plans);
  Object.assign(b[6], { x: 520, y: 300, vx: 1000, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, strikerTeam: 0, strikerPower: 1, pace: 1000 });
  for (let t = 0; t < 120; t++) P.step(b, P.DT);
  return b;
}
test('a teammate stopping a fireball keeps it lit at its pace; an opponent stopping it puts it out', () => {
  const own = fireballStopped(1), ball = own[6];
  assert.ok(Math.hypot(ball.vx, ball.vy) < 504 && ball.pace > 840, 'slowed by a teammate, its pace stays high');
  assert.equal(P.ballOnFire(ball), true);
  assert.equal(P.ballOnFire(fireballStopped(4)[6]), false, 'an opponent Guard Iron Saves it');
});
test('a teammate driving into a trapped fireball fires it at its pace; a passive or opposing touch does not', () => {
  const touch = (index, vx) => {
    const b = fireballStopped(1), ball = b[6];
    Object.assign(b[index], { x: ball.x - 80, y: ball.y, vx, vy: 0 });
    let after = null, pace = null;
    for (let t = 0; t < 60 && after === null; t++) P.step(b, P.DT, ({ a: x, b: y }) => { if (x === ball || y === ball) { after = Math.hypot(ball.vx, ball.vy); pace = ball.pace; } });
    return { after, pace: pace ?? ball.pace, ball };
  };
  const shot = touch(2, 300);
  assert.ok(Math.abs(shot.after - shot.pace) < 15, "a hot shot leaves at the ball's pace");
  assert.ok(touch(2, 60).after < 300, 'a passive teammate touch adds nothing');
  const poke = touch(5, 300);
  assert.equal(poke.ball.strikerTeam, 1);
  assert.ok(Math.abs(poke.ball.pace - Math.hypot(poke.ball.vx, poke.ball.vy)) < 1, 'an opponent takes it over at its real speed');
});
test("a teammate's Sticky keeps a fireball lit; an opponent's smothers it", () => {
  for (const [index, lit] of [[1, true], [4, false]]) {
    const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
    Object.assign(b[index], { x: 600, y: 300, superActive: 'sticky', superTicks: P.SUPER.ticks });
    Object.assign(b[6], { x: 540, y: 300, vx: 900, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, strikerTeam: 0, strikerPower: 1, pace: 900 });
    for (let t = 0; t < 30; t++) P.step(b, P.DT);
    assert.equal(P.holder(b), b[index]);
    assert.equal(P.ballOnFire(b[6]), lit);
  }
});
test("the boards take their share of a hot ball's pace; a burning ball banks free (Meteor Bank)", () => {
  const bounce = onFire => {
    const b = P.kickoff();
    Object.assign(b[6], { x: P.rink.right - 30, y: 150, vx: 300, vy: 0, onFire, fireTicks: onFire ? P.FIRE_TICKS : 30, strikerTeam: 0, pace: 900 });
    b.splice(0, 6);
    for (let t = 0; t < 40; t++) P.step(b, P.DT);
    assert.ok(b[0].vx < 0, 'it bounced');
    return b[0].pace;
  };
  assert.ok(bounce(false) < 800, 'the bounce cost pace as well as speed');
  assert.ok(bounce(true) > 850, 'a burning ball keeps its pace off the boards');
});
// Planning marks where the predicted ball catches fire: not for a soft shot, nor a ball already burning.
test('the planning prediction marks where the ball ignites', () => {
  const still = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
  const shot = (power, burning = false) => {
    const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
    b.slice(1, 6).forEach(x => Object.assign(x, { y: x.team ? 520 : 80 }));
    Object.assign(b[0], { x: 300, y: 300 }); Object.assign(b[6], { x: 350, y: 300 });
    if (burning) Object.assign(b[6], { onFire: true, fireTicks: P.FIRE_TICKS });
    return P.predictTurn(b, [{ ...still, power }, still, still]).ignition;
  };
  const full = shot(1);
  assert.ok(full && full.tick >= P.FIRE_TICKS && full.x > 350, 'a full-power shot catches fire along its path');
  assert.equal(shot(.6), null, 'a soft shot does not');
  assert.equal(shot(1, true), null, 'a burning ball has no ignition point');
});
// Planning shows each guarding ubu a burning ball would hit in the predicted turn, and whether it holds.
test('the planning prediction tells which Guards hold a burning ball', () => {
  const still = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
  const incoming = offset => {
    const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
    Object.assign(b[0], { x: 400, y: 300 + offset });
    Object.assign(b[6], { x: 460, y: 300, vx: -1000, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, strikerPower: 1, strikerTeam: 1 });
    return P.predictTurn(b, [{ ...still, guard: true }, still, still]).guards;
  };
  assert.deepEqual(incoming(0), [{ index: 0, held: true }], 'squared up, the Guard makes an Iron Save');
  assert.deepEqual(incoming(-20), [{ index: 0, held: false }], 'a glancing fireball beats it');
  // A teammate's Cannonball into a guarded ubu: no Iron Save, but the Guard holds it.
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  Object.assign(b[0], { x: 300, y: 300, superActive: 'cannonball', superTicks: P.SUPER.ticks });
  Object.assign(b[6], { x: 345, y: 300 }); Object.assign(b[1], { x: 520, y: 300 });
  assert.deepEqual(P.predictTurn(b, [{ ...still, power: .3 }, { ...still, guard: true }, still]).guards, [{ index: 1, held: true }]);
});
test('flaming ball retains onFire when scoring into goal and callGoal awards FIREBALL!', () => {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  b[0].superActive = 'cannonball';
  Object.assign(b[0], { x: 457, y: 300, vx: 720, vy: 0 });
  Object.assign(b[6], { x: 500, y: 300, vx: 0, vy: 0 });
  // The goalie stands off the shot's line.
  Object.assign(b[3], { y: 480 });
  P.step(b, 0);
  assert.equal(P.ballOnFire(b[6]), true);

  let goal = null;
  for (let t = 0; t < 120; t++) {
    goal = P.step(b, P.DT);
    if (goal !== null) break;
  }
  assert.equal(goal, 0, 'goal scored for team 0');
  assert.equal(b[6].onFire, true, 'ball remains on fire in goal');
  const play = M.newPlay(), tally = M.newTally();
  const call = M.callGoal(b, play, tally, goal, false);
  assert.equal(call.label, 'FIREBALL!', 'goal callout is FIREBALL!');
});

test('Stalwart performs short anchor slide with 0.5x launch and 3.0x friction and has camping immunity', () => {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  b[0].superActive = 'stalwart';
  P.launch(b, [{ angle: 0, power: 1 }]);
  assert.ok(Math.abs(b[0].vx - 720 * P.SUPER.stalwartLaunch) < 1e-9, 'launches at 50% speed');
  assert.equal(b[0].vy, 0);

  // Stepping with 3.0x friction (450 px/s²) stops the 360 px/s slide in 192 ticks (0.8s)
  for (let i = 0; i < 240; i++) P.step(b, P.DT);
  assert.equal(b[0].vx, 0, 'slides to complete stop');

  // Stalwart has camping immunity in crease
  Object.assign(b[0], { x: P.rink.left + 10, y: 300 });
  const M = require('../shared/ububall-match.js');
  assert.equal(M.inCrease(P, b[0], 0), false, 'immune to camping check');
});

test('Shockwave executes Phase 1 proximity burst and Phase 2 continuous repulsion aura', () => {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  b[0].superActive = 'shockwave';
  b[0].superTicks = P.SUPER.ticks;
  Object.assign(b[0], { x: 400, y: 300, vx: 0, vy: 0 });
  Object.assign(b[1], { x: 460, y: 300, vx: 0, vy: 0 }); // Teammate within 170px
  Object.assign(b[3], { x: 500, y: 300, vx: 0, vy: 0 }); // Opponent within 170px (d = 100)
  Object.assign(b[6], { x: 450, y: 300, vx: 0, vy: 0 }); // Ball within 170px

  // Phase 1: Proximity burst
  P.step(b, P.DT);
  assert.equal(b[0].shockwaveFired, true, 'burst fired on proximity');
  assert.equal(b[0].superHit, true, 'superHit set');
  assert.equal(b[1].vx, 0, 'teammate ignored');
  assert.equal(b[6].vx, 0, 'ball ignored');
  assert.ok(b[3].vx > 0, 'opponent repelled radially');

  // Phase 2: Continuous repulsion aura
  const vBefore = b[3].vx;
  P.step(b, P.DT);
  assert.ok(b[3].vx > vBefore, 'repulsion aura accelerates opponent further');
  assert.equal(b[1].vx, 0, 'teammate still ignored');
  assert.equal(b[6].vx, 0, 'ball still ignored');
});

test('Whiffed supers refund 25% meter in endSuper while connected supers refund 0%', () => {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  b[0].superActive = 'cannonball';
  b[0].meter = 0;
  b[0].superHit = false;
  P.endSuper(b[0], b);
  assert.equal(b[0].meter, P.SUPER.whiffRefund, 'whiffed super refunded 25%');

  b[1].superActive = 'cannonball';
  b[1].meter = 0;
  b[1].superHit = true;
  P.endSuper(b[1], b);
  assert.equal(b[1].meter, 0, 'connected super receives no refund');
});

test('Super Mastery derives level, suffix, duration and refund bonus from DNA duplicates', () => {
  // 1 copy = Base
  const base = P.superMastery([0, 1, 2, 3], 0);
  assert.equal(base.level, 1);
  assert.equal(base.suffix, '');
  assert.equal(base.displayName, 'Stalwart');
  assert.equal(base.bonusTicks, 0);
  assert.equal(base.bonusRefund, 0);

  // 2 copies = Level 2 (II)
  const l2 = P.superMastery([3, 1, 3, 2], 3);
  assert.equal(l2.level, 2);
  assert.equal(l2.suffix, ' II');
  assert.equal(l2.displayName, 'Cannonball II');
  assert.equal(l2.bonusTicks, 120);
  assert.equal(l2.bonusRefund, 5);

  // 3 copies = Level 3 (III)
  const l3 = P.superMastery([4, 4, 1, 4], 4);
  assert.equal(l3.level, 3);
  assert.equal(l3.suffix, ' III');
  assert.equal(l3.displayName, 'Magnet III');
  assert.equal(l3.bonusTicks, 240);
  assert.equal(l3.bonusRefund, 10);

  // 4 copies = Master
  const master = P.superMastery([5, 5, 5, 5], 5);
  assert.equal(master.level, 4);
  assert.equal(master.suffix, ' Master');
  assert.equal(master.displayName, 'Colossus Master');
  assert.equal(master.bonusTicks, 480);
  assert.equal(master.bonusRefund, 20);
});

test('Super Mastery extends super duration and Sticky hold duration', () => {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  b[0].meter = 100;
  const mastery = P.superMastery([4, 4, 1, 2], 4); // 2 copies -> +120 ticks
  b[0].equippedSuper = { ...P.SUPERS[4], ...mastery };
  P.startTurn(b, [{ angle: 0, power: 0, spin: 0, superArm: true }]);
  assert.equal(b[0].superActive, 'magnet');
  assert.equal(b[0].superTicks, P.SUPER.ticks + 120);

  // Sticky hold duration
  const stickyMaster = P.superMastery([2, 2, 2, 2], 2); // 4 copies -> +480 ticks
  const bs = P.kickoff(); bs.slice(0, 6).forEach(x => P.applyStats(x, normal));
  bs[0].meter = 100;
  bs[0].equippedSuper = { ...P.SUPERS[2], ...stickyMaster };
  P.startTurn(bs, [{ angle: 0, power: 0, spin: 0, superArm: true }]);
  assert.equal(bs[0].superHoldTicks, P.SUPER.holdTicks + 480);
});

test('Super Mastery grants refund on hit and stacks with whiff refund, without double refunding', () => {
  const b = P.kickoff(); b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  // Level 2 (5% bonus refund): connected super gets 5%
  b[0].superActive = 'cannonball';
  b[0].meter = 0;
  b[0].superHit = true;
  b[0].equippedSuper = { ...P.SUPERS[3], bonusRefund: 5 };
  P.endSuper(b[0], b);
  assert.equal(b[0].meter, 5, 'connected Level 2 super refunded 5% mastery bonus');

  // Second endSuper call does not grant duplicate refund
  P.endSuper(b[0], b);
  assert.equal(b[0].meter, 5, 'duplicate endSuper call does not grant double refund');

  // Master Level (20% bonus refund): whiffed super gets 20% + 25% = 45%
  b[1].superActive = 'cannonball';
  b[1].meter = 0;
  b[1].superHit = false;
  b[1].equippedSuper = { ...P.SUPERS[3], bonusRefund: 20 };
  P.endSuper(b[1], b);
  assert.equal(b[1].meter, 45, 'whiffed Master super refunded 45% (25% whiff + 20% mastery)');
});

test('launch spin scales with base maxSpin of 15 rad/s and DNA spin stat', () => {
  const b = P.kickoff();
  P.applyStats(b[0], { ...normal, spin: 127 });
  assert.equal(b[0].maxSpin, 15, 'base stat 127 yields maxSpin 15 rad/s');

  P.applyStats(b[1], { ...normal, spin: 0 });
  assert.ok(Math.abs(b[1].maxSpin - 10) < 1e-6, 'min spin stat 0 yields 10 rad/s (2/3x)');

  P.applyStats(b[2], { ...normal, spin: 255 });
  assert.ok(Math.abs(b[2].maxSpin - 22.5) < 1e-6, 'max spin stat 255 yields 22.5 rad/s (1.5x)');

  P.launch([b[0]], [{ angle: 0, power: 1, spin: 1 }]);
  assert.equal(b[0].omega, 15, 'launch with spin 1 applies full maxSpin 15 rad/s');

  b[0].omega = 0;
  P.launch([b[0]], [{ angle: 0, power: 1, spin: -0.5 }]);
  assert.equal(b[0].omega, -7.5, 'launch from rest with spin -0.5 applies -7.5 rad/s');
});

test('iron guard status starts false on play start, turns true upon iron save, and persists', () => {
  const b = P.kickoff();
  b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  P.startTurn(b, [{ angle: 0, power: 0, spin: 0, guard: true }]);
  assert.equal(b[0].guarding, true);
  assert.equal(b[0].ironGuard, false, 'guard starts as blue guard (ironGuard false) on play start');

  const ball = b[6];
  ball.x = b[0].x + 40;
  ball.y = b[0].y;
  ball.vx = -600;
  ball.vy = 0;
  ball.onFire = true;
  ball.fireTicks = 60;
  ball.strikerTeam = 1;

  let shockType = null;
  P.step(b, P.DT, null, null, (src, r, type) => { shockType = type; });
  assert.equal(shockType, 'iron', 'iron shockwave triggered');
  assert.equal(b[0].ironGuard, true, 'ironGuard becomes true upon successful iron save');

  P.step(b, P.DT);
  assert.equal(b[0].ironGuard, true, 'ironGuard remains true for the rest of the play');

  P.stop(b);
  assert.equal(b[0].ironGuard, false, 'ironGuard resets when turn stops');
});

test('iron save triggers ~200 ms cooldown and doubles guard effects for the rest of the turn', () => {
  const b = P.kickoff();
  b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  P.startTurn(b, [{ angle: 0, power: 0, spin: 0, guard: true }]);

  const baseReach = b[0].baseReach;
  const baseFriction = b[0].baseFriction;
  const baseStrength = b[0].baseStrength;
  const baseStability = b[0].baseStability;
  const baseBounciness = b[0].baseBounciness;

  // Regular guard starts at 1.25x (+25%)
  assert.equal(b[0].reach, Math.min(37.5, baseReach * 1.25));
  assert.equal(b[0].friction, baseFriction * 1.25);
  assert.equal(b[0].strength, baseStrength * 1.25);
  assert.equal(b[0].stability, baseStability * 1.25);
  assert.equal(b[0].bounciness, baseBounciness * 0.75);
  assert.equal(b[0].ironCooldownTicks, 0);

  const ball = b[6];
  ball.x = b[0].x + 40; ball.y = b[0].y;
  ball.vx = -600; ball.vy = 0;
  ball.onFire = true; ball.fireTicks = 60; ball.strikerTeam = 1;

  let shockCount = 0;
  P.step(b, P.DT, null, null, (src, r, type) => { if (type === 'iron') shockCount++; });
  assert.equal(shockCount, 1, 'first hit triggers iron save shockwave');
  assert.equal(b[0].ironGuard, true);
  assert.equal(b[0].ironCooldownTicks, P.IRON_COOLDOWN_TICKS, 'iron cooldown is 48 ticks (~200 ms)');

  // Guard effects are doubled (+50% over base)
  assert.equal(b[0].reach, Math.min(37.5, baseReach * 1.5));
  assert.equal(b[0].friction, baseFriction * 1.5);
  assert.equal(b[0].strength, baseStrength * 1.5);
  assert.equal(b[0].stability, baseStability * 1.5);
  assert.equal(b[0].bounciness, baseBounciness * 0.5);

  // During cooldown: second fireball hit does not trigger an iron save
  ball.x = b[0].x + 40; ball.y = b[0].y;
  ball.vx = -600; ball.vy = 0;
  ball.onFire = true; ball.fireTicks = 60; ball.strikerTeam = 1;
  let secondIron = false;
  P.step(b, P.DT, ({ iron: isIron }) => { if (isIron) secondIron = true; }, null, (src, r, type) => { if (type === 'iron') shockCount++; });
  assert.equal(secondIron, false, 'no iron save during cooldown');
  assert.equal(shockCount, 1, 'no second iron shockwave during cooldown');
  assert.equal(ball.onFire, true, 'fire is not quenched during cooldown');

  // Advance remaining cooldown ticks
  const remaining = b[0].ironCooldownTicks;
  for (let t = 0; t < remaining; t++) P.step(b, P.DT);
  assert.equal(b[0].ironCooldownTicks, 0, 'cooldown elapsed');

  // After cooldown: subsequent fireball hit CAN trigger iron save again
  ball.x = b[0].x + 40; ball.y = b[0].y;
  ball.vx = -600; ball.vy = 0;
  ball.onFire = true; ball.fireTicks = 60; ball.strikerTeam = 1;
  let thirdIron = false;
  P.step(b, P.DT, ({ iron: isIron }) => { if (isIron) thirdIron = true; }, null, (src, r, type) => { if (type === 'iron') shockCount++; });
  assert.equal(thirdIron, true, 'iron save triggers again after cooldown');
  assert.equal(shockCount, 2, 'second iron shockwave triggers');
  assert.equal(ball.onFire, false, 'fire quenched by new iron save');

  P.stop(b);
  assert.equal(b[0].reach, baseReach, 'reach restored on turn stop');
  assert.equal(b[0].friction, baseFriction, 'friction restored on turn stop');
  assert.equal(b[0].strength, baseStrength, 'strength restored on turn stop');
  assert.equal(b[0].stability, baseStability, 'stability restored on turn stop');
  assert.equal(b[0].bounciness, baseBounciness, 'bounciness restored on turn stop');
  assert.equal(b[0].ironGuard, false);
  assert.equal(b[0].ironCooldownTicks, 0);
});

test('stat model: repeated guard toggles and iron guard preserve immutable base stats without drift', () => {
  const b = P.kickoff();
  P.applyStats(b[0], normal);
  const { baseReach, baseFriction, baseStrength, baseStability, baseBounciness, baseRadius, baseMass } = b[0];

  for (let i = 0; i < 10; i++) {
    P.startTurn(b, [{ angle: 0, power: 0, spin: 0, guard: true }]);
    assert.equal(b[0].guarding, true);
    assert.equal(b[0].baseReach, baseReach);
    assert.equal(b[0].baseFriction, baseFriction);
    assert.equal(b[0].friction, Math.min(225, baseFriction * 1.25));

    if (i === 5) {
      P.applyDoubledGuard(b[0]);
      assert.equal(b[0].ironGuard, true);
      assert.equal(b[0].friction, Math.min(270, baseFriction * 1.5));
    }

    P.stop(b);
    assert.equal(b[0].guarding, false);
    assert.equal(b[0].ironGuard, false);
    assert.equal(b[0].reach, baseReach);
    assert.equal(b[0].friction, baseFriction);
    assert.equal(b[0].strength, baseStrength);
    assert.equal(b[0].stability, baseStability);
    assert.equal(b[0].bounciness, baseBounciness);
    assert.equal(b[0].radius, baseRadius);
    assert.equal(b[0].mass, baseMass);
  }
});

test('stat model: colossus scales effective radius and mass without altering base stats, and restores on expiration', () => {
  const b = P.kickoff();
  P.applyStats(b[0], normal);
  const { baseRadius, baseMass } = b[0];

  b[0].superActive = 'colossus';
  P.syncEffectiveStats(b[0]);

  assert.equal(b[0].radius, Math.max(baseRadius, P.SUPER.colossusRadius));
  assert.equal(b[0].mass, Math.max(baseMass, P.SUPER.colossusMass));
  assert.equal(b[0].baseRadius, baseRadius);
  assert.equal(b[0].baseMass, baseMass);

  P.endSuper(b[0], b);
  assert.equal(b[0].radius, baseRadius);
  assert.equal(b[0].mass, baseMass);
  assert.equal(b[0].superActive, null);
});

test('stat model: colossus and guard compose correctly without compound drift', () => {
  const b = P.kickoff();
  P.applyStats(b[0], normal);
  const { baseRadius, baseMass, baseReach, baseFriction } = b[0];

  b[0].superActive = 'colossus';
  b[0].guarding = true;
  P.syncEffectiveStats(b[0]);

  assert.equal(b[0].radius, Math.max(baseRadius, P.SUPER.colossusRadius));
  assert.equal(b[0].mass, Math.max(baseMass, P.SUPER.colossusMass));
  assert.equal(b[0].friction, Math.min(225, baseFriction * 1.25));
  assert.equal(b[0].reach, Math.max(b[0].radius, Math.min(37.5, baseReach * 1.25)));

  // End colossus while maintaining guard
  b[0].superActive = null;
  P.syncEffectiveStats(b[0]);
  assert.equal(b[0].radius, baseRadius);
  assert.equal(b[0].mass, baseMass);
  assert.equal(b[0].friction, Math.min(225, baseFriction * 1.25));

  // Uniform 1.5x max Colossus regardless of base size, growing over colossusGrowTicks without settling prematurely
  const smallCol = P.kickoff()[0], stillGrow = { angle: 0, power: 0, spin: 0, guard: false, superArm: true };
  P.applyStats(smallCol, { size: 0, reach: 127, mass: 0, stability: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 });
  smallCol.equippedSuper = { ...P.SUPERS[5], bonusTicks: 0, bonusRefund: 0 }; smallCol.meter = 100;
  P.startTurn([smallCol], [stillGrow]);
  assert.equal(smallCol.radius, smallCol.baseRadius, 'Colossus begins growth from baseRadius at tick 0');
  assert.equal(P.settled([smallCol]), false, 'growing Colossus keeps turn alive past tick 0');
  for (let tick = 1; tick < P.SUPER.colossusGrowTicks; tick++) P.step([smallCol], P.DT);
  assert.ok(smallCol.radius > smallCol.baseRadius && smallCol.radius < P.SUPER.colossusRadius, 'Colossus grows gradually before tick 40');
  assert.equal(P.settled([smallCol]), false, 'Colossus not settled before growth finishes');
  P.step([smallCol], P.DT);
  assert.equal(smallCol.radius, P.SUPER.colossusRadius, 'small ubu reaches uniform 1.5x max Colossus radius at tick 40');
  assert.equal(smallCol.mass, P.SUPER.colossusMass, 'small ubu reaches uniform 1.5x max Colossus mass at tick 40');
  assert.equal(P.settled([smallCol]), true, 'stationary Colossus settles once 40-tick growth completes');

  // Stop turn
  P.stop(b);
  assert.equal(b[0].radius, baseRadius);
  assert.equal(b[0].mass, baseMass);
  assert.equal(b[0].friction, baseFriction);
  assert.equal(b[0].reach, baseReach);
});

test('opponent checking a Sticky-held ball directly knocks it loose instead of bouncing off a phantom ball', () => {
  const b = P.kickoff();
  b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  const carrier = b[0], defender = b[3], ball = b[6];
  Object.assign(carrier, { x: 400, y: 300, vx: 500, vy: 0, superActive: 'sticky', superTicks: P.SUPER.ticks, holding: true });
  Object.assign(ball, { x: 443, y: 300, vx: 500, vy: 0, stickOffset: { x: 43, y: 0 }, stuckTicks: 10, strikerTeam: 0 });
  Object.assign(defender, { x: 480, y: 300, vx: -400, vy: 0 });
  const keBefore = kineticEnergy(b);
  P.step(b, P.DT);
  assert.equal(carrier.holding, false, 'Sticky hold is knocked loose when opponent checks the held ball');
  assert.equal(carrier.superActive, null, 'Sticky super ends cleanly');
  assert.ok(carrier.vx < 400, 'carrier absorbs real recoil from the pinched ball rather than coasting at 499 px/s');
  assert.ok(kineticEnergy(b) <= keBefore * (1 + 1e-12), 'collision strictly preserves kinetic energy bound');

  // Side poke-check cleanly strips the held ball in one single contact
  const side = P.kickoff();
  side.slice(0, 6).forEach(x => P.applyStats(x, normal));
  Object.assign(side[0], { x: 400, y: 300, vx: 300, vy: 0, superActive: 'sticky', superTicks: P.SUPER.ticks, holding: true });
  Object.assign(side[6], { x: 443, y: 300, vx: 300, vy: 0, stickOffset: { x: 43, y: 0 }, stuckTicks: 10, strikerTeam: 0 });
  Object.assign(side[3], { x: 443, y: 342, vx: 0, vy: -400 });
  let sideHits = 0;
  P.step(side, P.DT, () => { sideHits++; });
  assert.equal(side[0].holding, false);
  assert.equal(sideHits, 1, 'side poke-check strips held ball in a single clean contact');
});

test('a second Sticky skater stealing a held ball ends the first Sticky without multi-pass ping-pong', () => {
  const b = P.kickoff();
  b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  Object.assign(b[0], { x: 465, y: 300, vx: 100, superActive: 'sticky', superTicks: P.SUPER.ticks, holding: true });
  Object.assign(b[6], { x: 508, y: 300, stickOffset: { x: 43, y: 0 } });
  Object.assign(b[3], { x: 540, y: 300, vx: -100, superActive: 'sticky', superTicks: P.SUPER.ticks });
  let stickyImpacts = 0;
  P.step(b, P.DT, null, null, null, (k, act) => { if (k === 'sticky' && act === 'impact') stickyImpacts++; });
  assert.equal(stickyImpacts, 1, 'exactly one Sticky transfer occurs in the tick');
  assert.equal(b[0].superActive, null, 'previous holder Sticky is ended');
  assert.equal(P.holder(b), b[3], 'new Sticky skater holds the ball');
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
  assert.ok(Math.abs(b[6].x - 500) < 1e-9, `ball stays centered at x=500 (got ${b[6].x})`);
  assert.ok(Math.abs(b[6].vx) < 1e-9, `ball vx cancels symmetrically (got ${b[6].vx})`);
  assert.ok(Math.abs((b[0].x - 500) + (b[3].x - 500)) < 1e-9, 'skaters rebound symmetrically');
});

test('even head-on checks do not bias checker credit toward Team 1, and Colossus checks credit when dazed', () => {
  const sym = P.kickoff();
  sym.slice(0, 6).forEach(x => P.applyStats(x, normal));
  Object.assign(sym[0], { x: 480, y: 300, vx: 500 });
  Object.assign(sym[3], { x: 520, y: 300, vx: -500 });
  let symChecker = 'unset';
  P.step(sym, P.DT, ({ checker: chk }) => { symChecker = chk; });
  assert.equal(symChecker, null, 'symmetric head-on tie awards neither side a unilateral check');

  const col = P.kickoff();
  col.slice(0, 6).forEach(x => P.applyStats(x, normal));
  Object.assign(col[0], { x: 460, y: 300, vx: 0, superActive: 'colossus' });
  P.syncEffectiveStats(col[0]);
  Object.assign(col[3], { x: 525, y: 300, vx: -700, strength: 1.5 });
  let colChecker = null;
  P.step(col, P.DT, ({ checker: chk }) => { colChecker = chk; });
  assert.ok(col[0].daze > 0 && colChecker === col[3], 'attacker dazing a Colossus receives check credit');
});

test('a moving Guard making a teammate Iron Save traps the fireball rather than firing a Hot Shot', () => {
  const b = P.kickoff();
  b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  Object.assign(b[0], { x: 400, y: 300, vx: 150, vy: 0, guarding: true });
  P.syncEffectiveStats(b[0]);
  Object.assign(b[6], { x: 440, y: 300, vx: -600, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, pace: 950, strikerTeam: 0, strikerPower: 0.8 });
  let iron = false;
  P.step(b, P.DT, ({ iron: isIron }) => { if (isIron) iron = true; });
  assert.equal(iron, true, 'teammate Iron Save triggers');
  assert.ok(Math.hypot(b[6].vx, b[6].vy) < 150, 'ball stays trapped at Iron Save speed instead of blasting at 950 px/s');
  assert.ok(b[6].pace > 840 && P.ballOnFire(b[6]), 'fireball stays loaded for a follow-up Hot Shot');
});

test('Snap redirects a live teammate pass within the pair KE budget and adds pre-heat, rejecting self, opponent, slow or passive touches', () => {
  const runSnap = ({ strikerTeam = 0, strikerSlot = 0, shooterIdx = 1, passVy = 320, shooterVx = 520, guarding = false, onFire = false, crowd = false }) => {
    const b = P.kickoff();
    b.slice(0, 6).forEach(x => P.applyStats(x, normal));
    b.slice(0, 6).forEach((x, idx) => Object.assign(x, { x: 120 + idx * 45, y: 500, vx: 0, vy: 0 }));
    const shooter = b[shooterIdx], ball = b[6];
    Object.assign(shooter, { x: 460, y: 300, vx: shooterVx, vy: 0, guarding });
    P.syncEffectiveStats(shooter);
    Object.assign(ball, { x: 500, y: 300, vx: 0, vy: passVy, strikerTeam, strikerSlot, strikerPower: 1, onFire, fireTicks: onFire ? P.FIRE_TICKS : 0, pace: onFire ? 900 : Math.abs(passVy) });
    if (crowd) Object.assign(b[2], { x: 538, y: 300, vx: 0, vy: 0 });
    const keBefore = kineticEnergy([shooter, ball]);
    let snapFlag = false;
    P.step(b, 0, ({ snapped }) => { if (snapped) snapFlag = true; });
    return { ball, shooter, speedAfter: Math.hypot(ball.vx, ball.vy), keBefore, keAfter: kineticEnergy([shooter, ball]), snapFlag };
  };

  // Valid teammate one-timer (slot 0 -> slot 1) vs control with no prior passer (strikerTeam: -1)
  const snap = runSnap({});
  const plain = runSnap({ strikerTeam: -1, strikerSlot: -1 });
  assert.equal(snap.snapFlag, true, 'Snap triggers on live pass from a different teammate');
  assert.equal('snapStruck' in snap.ball, false, 'Snap reports via contact event without mutating ball.snapStruck');
  assert.ok(snap.speedAfter > plain.speedAfter + 25, `Snap redirects incoming pass speed (${snap.speedAfter} vs ${plain.speedAfter})`);
  assert.equal(snap.ball.fireTicks, P.SNAP.heatTicks, 'Snap adds pre-heat fireTicks');
  assert.ok(snap.ball.pace >= snap.speedAfter - 1e-9, 'ball.pace updates to snapped speed');
  assert.equal(snap.ball.strikerSlot, 1, 'strikerSlot updates to the new shooter');
  assert.ok(snap.keAfter <= snap.keBefore * (1 + 1e-12), 'Snap strictly respects pair kinetic energy bound');

  // Self-touch (strikerSlot === shooter.slot) does not trigger Snap
  const selfTouch = runSnap({ strikerTeam: 0, strikerSlot: 1, shooterIdx: 1 });
  assert.equal(selfTouch.snapFlag, false, 'self-touch does not trigger Snap');
  assert.equal('snapStruck' in selfTouch.ball, false);
  assert.ok(Math.abs(selfTouch.speedAfter - plain.speedAfter) < 1e-9);

  // Opponent shot (strikerTeam !== shooter.team) does not trigger Snap
  const oppTouch = runSnap({ strikerTeam: 1, strikerSlot: 0, shooterIdx: 1 });
  assert.equal(oppTouch.snapFlag, false, 'opponent pass/shot does not trigger Snap');
  assert.equal(oppTouch.ball.fireTicks, 0);

  // Slow pass (< 180 px/s) and passive/stationary shooter (< 140 px/s) do not trigger Snap
  assert.equal(runSnap({ passVy: 150 }).snapFlag, false, 'slow pass below 180 px/s does not Snap');
  assert.equal(runSnap({ shooterVx: 100 }).snapFlag, false, 'passive shooter drive below 140 px/s does not Snap');
  assert.equal(runSnap({ shooterVx: 0, passVy: -350 }).snapFlag, false, 'stationary touch does not Snap');
  assert.equal(runSnap({ guarding: true }).snapFlag, false, 'guarding skater does not Snap');
  assert.equal(runSnap({ onFire: true }).snapFlag, false, 'already burning ball uses Hot Shot rather than Snap');
  assert.equal(runSnap({ crowd: true }).snapFlag, false, 'crowded simultaneous contact does not Snap');
});

test('Post English deflects opposite ball spins symmetrically off a goalpost, preserves spin, and respects KE bounds', () => {
  const hitPost = omega => {
    const b = P.kickoff();
    const ball = b[6];
    // Aim ball obliquely onto the right top goalpost (940, 230) from inside the rink so normal velocity > 0
    const px = P.rink.right, py = P.rink.goalTop;
    const angle = -Math.PI / 4; // normal from post (940,230) to ball center: ball at (940 - d*cos45, 230 + d*sin45)
    const dist = ball.radius - 0.5;
    Object.assign(ball, {
      x: px - Math.SQRT1_2 * dist,
      y: py + Math.SQRT1_2 * dist,
      vx: 420 * Math.SQRT1_2,
      vy: -420 * Math.SQRT1_2,
      omega
    });
    const before = kineticEnergy([ball]);
    let wallHit = null;
    P.step([ball], 0, null, (body, vel, wt) => { wallHit = wt; });
    assert.equal(wallHit, 'post');
    assert.ok(kineticEnergy([ball]) <= before * (1 + 1e-12), `Post reflection preserves KE for omega=${omega}`);
    return ball;
  };

  const pos = hitPost(20);
  const zero = hitPost(0);
  const neg = hitPost(-20);

  // Symmetric inward vs outward deflection around the unspun normal bounce (vx = -vy)
  const tanZero = (zero.vx + zero.vy) * Math.SQRT1_2;
  const tanPos = (pos.vx + pos.vy) * Math.SQRT1_2;
  const tanNeg = (neg.vx + neg.vy) * Math.SQRT1_2;
  assert.ok(Math.abs(tanZero) < 1e-9, 'unspun head-on post hit bounces purely along normal');
  assert.ok(tanPos < -40 && tanNeg > 40, 'opposite spins bite strongly in opposite tangential directions');
  assert.ok(Math.abs(tanPos + tanNeg) < 1e-9, 'opposite spins deflect with exact symmetry');
  assert.ok(Math.abs(pos.omega + neg.omega) < 1e-9, 'remaining spin is symmetric');
  // spinKeep === 1 preserves all remaining post-impulse spin (unlike flat walls which halve it)
  assert.equal(P.SURFACES.post.spinKeep, 1);
  assert.equal(P.SURFACES.post.gripScale, 1.45);
  assert.ok(Math.abs(pos.omega) > 6, `post preserves remaining spin without 0.5x halving (got ${pos.omega})`);
});

test('Rim-Arounds preserve spinStrike and omega for co-spinning skaters on curved corners while checking counter-spin and leaving flat walls/balls unchanged', () => {
  // Top-left corner center is (160, 160), arc radius 100, skater radius 25 -> center orbit radius 75.
  // At 45 degrees: normal outward is (-sqrt(1/2), -sqrt(1/2)), tangent (tx=-ny, ty=nx) is (+sqrt(1/2), -sqrt(1/2)).
  // Moving up-and-right (vt > 0) with shallow normal entry (velocity <= 190): omega < 0 co-spins (omega * vt < 0).
  const cornerSetup = (omega, isBall = false) => {
    const bodies = P.kickoff();
    bodies.slice(0, 6).forEach(x => P.applyStats(x, normal));
    const r = isBall ? bodies[6].radius : bodies[0].radius;
    const limit = P.rink.corner - r;
    const d = limit + 0.6;
    const nx = -Math.SQRT1_2, ny = -Math.SQRT1_2;
    const tx = -ny, ty = nx; // (+0.707, -0.707)
    const vn = 120, vt = 360;
    const target = isBall ? bodies[6] : bodies[0];
    Object.assign(target, {
      x: 160 + nx * d,
      y: 160 + ny * d,
      vx: nx * vn + tx * vt,
      vy: ny * vn + ty * vt,
      omega,
      spinStrike: isBall ? 0 : 1.5
    });
    if (!isBall) bodies[6].openingShot = true;
    const beforeKE = kineticEnergy([target]);
    let rimmedFlag = null;
    P.step([target], 0, null, (body, vel, wt, wnx, wny, rimmed) => { rimmedFlag = rimmed; });
    assert.ok(kineticEnergy([target]) <= beforeKE * (1 + 1e-12), 'corner reflection preserves KE bound');
    return { target, rimmedFlag, nx, ny, tx, ty };
  };

  const coSpin = cornerSetup(-15, false);
  const unspun = cornerSetup(0, false);
  const counterSpin = cornerSetup(15, false);
  const ballCorner = cornerSetup(-15, true);

  assert.equal(coSpin.rimmedFlag, true, 'co-spinning skater triggers Rim-Around');
  assert.equal(coSpin.target.spinStrike, 1.5, 'co-spinning Rim-Around preserves spinStrike');
  assert.ok(Math.abs(coSpin.target.omega) > 12, `co-spinning Rim-Around retains 92% spin (got ${coSpin.target.omega})`);

  // Normal rebound speed inward (-vn_after) is much smaller on Rim-Around than unspun bounce, hugging the corner
  const inwardCo = -(coSpin.target.vx * coSpin.nx + coSpin.target.vy * coSpin.ny);
  const inwardUnspun = -(unspun.target.vx * unspun.nx + unspun.target.vy * unspun.ny);
  assert.ok(inwardCo < inwardUnspun * 0.5, `co-spinning skater hugs corner glass (${inwardCo} vs ${inwardUnspun})`);
  assert.equal(unspun.target.spinStrike, 0, 'unspun corner hit spends spinStrike');

  // Counter-spin checks tangential speed harder and spends spinStrike
  assert.equal(counterSpin.rimmedFlag, false, 'counter-spin is not a Rim-Around');
  assert.equal(counterSpin.target.spinStrike, 0, 'counter-spin spends spinStrike');
  const vtCo = coSpin.target.vx * coSpin.tx + coSpin.target.vy * coSpin.ty;
  const vtCounter = counterSpin.target.vx * counterSpin.tx + counterSpin.target.vy * counterSpin.ty;
  assert.ok(vtCounter < vtCo - 30, `counter-spin checks tangential speed (${vtCounter} vs ${vtCo})`);
  assert.ok(Math.abs(counterSpin.target.omega) < Math.abs(coSpin.target.omega) * 0.6, 'counter-spin halves remaining omega');

  // Ball on curved corner never triggers skater-only Rim-Around and still halves spin
  assert.equal(ballCorner.rimmedFlag, false, 'ball does not Rim-Around');
  assert.ok(Math.abs(ballCorner.target.omega) < 10, 'ball halves spin on corner boards');

  // Flat wall with co-rotating spin still spends spinStrike and halves omega
  const flat = P.kickoff()[0];
  P.applyStats(flat, normal);
  Object.assign(flat, { x: 400, y: 60 + flat.radius - 0.5, vx: 360, vy: -120, omega: -15, spinStrike: 1.5 });
  let flatRimmed = null;
  P.step([flat], 0, null, (b, v, wt, wnx, wny, rim) => { flatRimmed = rim; });
  assert.equal(flatRimmed, false, 'flat boards never Rim-Around');
  assert.equal(flat.spinStrike, 0, 'flat boards spend spinStrike');
  assert.ok(Math.abs(flat.omega) < 8, 'flat boards halve omega');
});

test('Tailgating reduces friction in the slipstream wake of fast teammates or opponents without mutating friction or affecting the ball', () => {
  const runDraft = (leadTeam, offsetY = 0, gap = 20, leadSpeed = 500) => {
    const b = P.kickoff();
    b.slice(0, 6).forEach(x => P.applyStats(x, normal));
    b.forEach((x, idx) => Object.assign(x, { x: 100 + idx * 40, y: 500, vx: 0, vy: 0 }));
    const trailer = b[0];
    const lead = leadTeam === null ? null : (leadTeam === 0 ? b[1] : b[3]);
    Object.assign(trailer, { x: 250, y: 300 + offsetY, vx: 320, vy: 0 });
    if (lead) Object.assign(lead, { x: 250 + trailer.radius + lead.radius + gap, y: 300, vx: leadSpeed, vy: 0 });
    const baseFric = trailer.friction;
    const initialDraft = P.tailgateFactor(b, trailer);
    for (let t = 0; t < 96; t++) P.step(b, P.DT);
    assert.equal(trailer.friction, baseFric, 'b.friction is never mutated');
    assert.equal(trailer.baseFriction, baseFric, 'b.baseFriction is never mutated');
    return { endVx: trailer.vx, endX: trailer.x, initialDraft };
  };

  const solo = runDraft(null);
  const behindTeammate = runDraft(0);
  const behindOpponent = runDraft(1);
  assert.ok(behindTeammate.initialDraft > 0.7, 'strong draft directly behind fast teammate');
  assert.ok(Math.abs(behindTeammate.initialDraft - behindOpponent.initialDraft) < 1e-12, 'teammates and opponents grant identical slipstream');
  assert.ok(behindTeammate.endVx > solo.endVx + 9, `drafting skater retains more speed (${behindTeammate.endVx} vs ${solo.endVx})`);
  assert.ok(behindOpponent.endVx > solo.endVx + 9, 'drafting behind opponent retains more speed');

  // Off-axis, distant, and slow-lead skaters grant zero draft
  assert.equal(runDraft(0, 65, 20).initialDraft, 0, 'off-axis skater outside wake cone gets zero draft');
  assert.equal(runDraft(0, 0, 120).initialDraft, 0, 'distant skater beyond maxGap gets zero draft');
  assert.equal(runDraft(0, 0, 20, 180).initialDraft, 0, 'slow lead below 240 px/s grants zero draft');

  // Colossus casts a wider wake (effectiveMaxGap scaled by lead.radius / 25 = 1.8)
  const colBodies = P.kickoff();
  colBodies.slice(0, 6).forEach(x => P.applyStats(x, normal));
  colBodies[1].superActive = 'colossus';
  P.syncEffectiveStats(colBodies[1]);
  Object.assign(colBodies[0], { x: 250, y: 300, vx: 320, vy: 0 });
  Object.assign(colBodies[1], { x: 250 + colBodies[0].radius + colBodies[1].radius + 120, y: 300, vx: 500, vy: 0 });
  assert.ok(P.tailgateFactor(colBodies, colBodies[0]) > 0.2, 'Colossus casts a proportionally wider slipstream wake');

  // Ball neither grants nor receives Tailgating
  const ballTest = P.kickoff();
  Object.assign(ballTest[0], { x: 250, y: 300, vx: 320, vy: 0 });
  Object.assign(ballTest[6], { x: 305, y: 300, vx: 600, vy: 0 });
  assert.equal(P.tailgateFactor(ballTest, ballTest[0]), 0, 'ball does not grant Tailgating to trailing skater');
  Object.assign(ballTest[0], { x: 360, y: 300, vx: 600, vy: 0 });
  assert.equal(P.tailgateFactor(ballTest, ballTest[6]), 0, 'ball receives zero tailgateFactor');
});

test('Hip Clips impart higher spin on fast glancing opponent checks, bend trajectory via SKATER_CURVE, scale down with Stability, and preserve KE', () => {
  const glanceCheck = ({ oppTeam = 1, stability = 127, grip = 64 }) => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal, grip });
    const target = oppTeam === 1 ? b[3] : b[1];
    P.applyStats(target, { ...normal, grip, stability });
    // Glancing 68-degree offset: nx = cos(68°), ny = sin(68°) -> |rvt| / |closing| = tan(68°) ≈ 2.47 > 1.05
    const ang = 68 * Math.PI / 180;
    const dist = b[0].radius + target.radius - 0.5;
    Object.assign(b[0], { x: 400, y: 300, vx: 520, vy: 0, omega: 0 });
    Object.assign(target, { x: 400 + Math.cos(ang) * dist, y: 300 + Math.sin(ang) * dist, vx: -120, vy: 0, omega: 0 });
    const pair = [b[0], target];
    const before = kineticEnergy(pair);
    P.step(pair, 0);
    assert.ok(kineticEnergy(pair) <= before * (1 + 1e-12), 'Hip Clip strictly conserves/dissipates pair KE');
    return { attacker: b[0], target };
  };

  const oppLowStab = glanceCheck({ oppTeam: 1, stability: 0 });
  const oppMidStab = glanceCheck({ oppTeam: 1, stability: 127 });
  const oppHighStab = glanceCheck({ oppTeam: 1, stability: 255 });
  const mateGraze = glanceCheck({ oppTeam: 0, stability: 127 }); // Teammate bumps do not trigger opponent Hip Clip

  assert.ok(Math.abs(oppMidStab.target.omega) > Math.abs(mateGraze.target.omega) * 1.4,
    `opponent Hip Clip imparts substantially more spin than ordinary Coulomb graze (${oppMidStab.target.omega} vs ${mateGraze.target.omega})`);
  assert.ok(Math.abs(oppHighStab.target.omega) < Math.abs(oppLowStab.target.omega) * 0.72,
    `high Stability resists Hip Clip spin-out (${oppHighStab.target.omega} vs ${oppLowStab.target.omega})`);

  // Verify the imparted spin visibly curves a moving skater off its straight-line post-impact heading
  const curved = structuredClone(oppMidStab.target);
  curved.vx = 360; curved.vy = 0;
  const straight = { ...curved, omega: 0 };
  for (let t = 0; t < 120; t++) { P.step([curved], P.DT); P.step([straight], P.DT); }
  assert.ok(Math.abs(curved.y - straight.y) > 5, 'clipped skater visibly curves off its straight line via SKATER_CURVE');

  // Sweep glancing angles, spins, and stat extremes to verify strict KE bound on all Hip Clips
  for (const deg of [48, 60, 75, 84]) for (const stab of [0, 127, 255]) for (const spin of [-15, 0, 15]) {
    const all = P.kickoff(), a = all[0], c = all[3];
    P.applyStats(a, { ...normal, grip: 255, strength: 255, stability: stab });
    P.applyStats(c, { ...normal, grip: 255, strength: 0, stability: 255 - stab });
    const rad = deg * Math.PI / 180, d = a.radius + c.radius - 0.5;
    Object.assign(a, { x: 400, y: 300, vx: 650, vy: 50, omega: spin });
    Object.assign(c, { x: 400 + Math.cos(rad) * d, y: 300 + Math.sin(rad) * d, vx: -400, vy: -90, omega: -spin });
    const ke0 = kineticEnergy([a, c]);
    P.step([a, c], 0);
    assert.ok(kineticEnergy([a, c]) <= ke0 * (1 + 1e-12), `Hip Clip KE invariant failed at deg=${deg}, stab=${stab}, spin=${spin}`);
  }
});

test('Sticky-held ball checks all overlapping skaters, strips on opponent contact, and reports carrier on friendly bumps', () => {
  const b = P.kickoff();
  b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  Object.assign(b[0], { x: 400, y: 300, vx: 0, vy: 0, superActive: 'sticky', superTicks: 400, holding: true });
  Object.assign(b[6], { x: 443, y: 300, vx: 0, vy: 0, stickOffset: { x: 43, y: 0 }, stuckTicks: 10, strikerTeam: 0 });
  Object.assign(b[1], { x: 443, y: 300 - (b[1].radius + b[6].radius - 1), vx: 0, vy: 0 });
  Object.assign(b[3], { x: 443 + b[3].radius + b[6].radius - 1, y: 300, vx: -500, vy: 0 });
  P.step([b[0], b[1], b[3], b[6]], P.DT);
  assert.equal(b[0].holding, false, 'opponent knocks Sticky ball loose even when a 3rd skater overlaps');

  const fb = P.kickoff();
  fb.slice(0, 6).forEach(x => P.applyStats(x, normal));
  Object.assign(fb[0], { x: 400, y: 300, vx: 0, vy: 0, superActive: 'sticky', superTicks: 400, holding: true });
  Object.assign(fb[6], { x: 443, y: 300, vx: 0, vy: 0, stickOffset: { x: 43, y: 0 }, stuckTicks: 10, strikerTeam: 0 });
  Object.assign(fb[1], { x: 443 + fb[1].radius + fb[6].radius - 1, y: 300, vx: -260, vy: 0 });
  const pairs = [];
  P.step([fb[0], fb[1], fb[6]], 0, ({ a: x, b: y }) => pairs.push([x, y]));
  assert.equal(fb[0].holding, true, 'teammate bump does not strip Sticky carrier');
  assert.ok(pairs.length > 0 && pairs.every(([x, y]) => x.team !== -1 && y.team !== -1),
    'non-stripping Sticky assembly bump reports skater-skater contact so ball credit stays with carrier');
});

test('Stalwart preserves KE when sliding, stays immovable at rest, and does not zero pinch KE budgets', () => {
  const s = P.kickoff();
  P.applyStats(s[0], { ...normal, strength: 255 });
  P.applyStats(s[3], { ...normal, stability: 0 });
  s[0].superActive = 'stalwart';
  s[0].superTicks = 400;
  Object.assign(s[0], { x: 400, y: 300, vx: 360, vy: 0 });
  Object.assign(s[3], { x: 400 + s[0].radius + s[3].radius - 0.5, y: 300, vx: 0, vy: 0 });
  const slidePair = [s[0], s[3]];
  const keBeforeSlide = kineticEnergy(slidePair);
  P.step(slidePair, 0);
  assert.ok(kineticEnergy(slidePair) <= keBeforeSlide * (1 + 1e-12), 'sliding Stalwart check respects pair KE budget');
  assert.equal(s[0].omega, 0, 'Stalwart takes zero spin');

  const a = P.kickoff();
  P.applyStats(a[0], normal);
  P.applyStats(a[3], { ...normal, strength: 255, stability: 0 });
  a[0].superActive = 'stalwart';
  a[0].superTicks = 400;
  Object.assign(a[0], { x: 400, y: 300, vx: 0, vy: 0 });
  Object.assign(a[3], { x: 400 + a[0].radius + a[3].radius - 0.5, y: 300, vx: -500, vy: 0 });
  const anchorPair = [a[0], a[3]];
  const keBeforeAnchor = kineticEnergy(anchorPair);
  P.step(anchorPair, 0);
  assert.equal(a[0].vx, 0);
  assert.equal(a[0].vy, 0);
  assert.ok(kineticEnergy(anchorPair) <= keBeforeAnchor * (1 + 1e-12), 'stationary Stalwart rebound respects incoming KE');

  const p = P.kickoff();
  P.applyStats(p[0], normal);
  P.applyStats(p[3], normal);
  p[0].superActive = 'stalwart';
  p[0].superTicks = 400;
  Object.assign(p[0], { x: 400, y: 300, vx: 0, vy: 0 });
  Object.assign(p[6], { x: 400 + p[0].radius + p[6].radius - 0.5, y: 300, vx: 0, vy: 0 });
  Object.assign(p[3], { x: p[6].x + p[3].radius + p[6].radius - 0.5, y: 300, vx: -550, vy: 0 });
  const pinch = [p[0], p[3], p[6]];
  const kePinch0 = kineticEnergy(pinch);
  P.step(pinch, 0);
  assert.ok(Math.hypot(p[3].vx, p[3].vy) > 10 || Math.hypot(p[6].vx, p[6].vy) > 10, 'pinch against Stalwart does not zero all velocities');
  assert.ok(kineticEnergy(pinch) <= kePinch0 * (1 + 1e-12), 'Stalwart pinch preserves total KE');
});

test('goal-pocket walls contain skaters nudged into net roof/floor, corner center overlap stays finite, and zero-power launch keeps spin', () => {
  const pocket = P.kickoff()[0];
  P.applyStats(pocket, normal);
  Object.assign(pocket, { x: 35, y: P.rink.goalTop + pocket.radius - 2, vx: 0, vy: -300 });
  P.step([pocket], P.DT);
  assert.ok(pocket.x < P.rink.left, 'skater remains in goal pocket');
  assert.ok(pocket.y >= P.rink.goalTop + pocket.radius - 1e-9, `goal roof contains skater (y=${pocket.y})`);
  assert.ok(pocket.vy >= 0, 'goal roof reflects upward velocity downward');

  const deg = P.kickoff()[0];
  P.applyStats(deg, normal);
  Object.assign(deg, { x: 160, y: 160, vx: -100, vy: -100 });
  P.step([deg], 0);
  assert.ok(Number.isFinite(deg.x) && Number.isFinite(deg.y) && Number.isFinite(deg.vx) && Number.isFinite(deg.vy));

  const coast = P.kickoff();
  P.applyStats(coast[0], normal);
  Object.assign(coast[0], { vx: 250, vy: 0, omega: 4 });
  P.launch(coast, [{ angle: 0, power: 0, spin: 1 }]);
  assert.equal(coast[0].omega, 4, 'power=0 launch leaves existing omega untouched');

  // stepPostGoal pins ball & clears Sticky carrier without pinning/colliding skaters against the pinned ball
  const pg = P.kickoff();
  pg.slice(0, 6).forEach(b => P.applyStats(b));
  pg[0].holding = true;
  Object.assign(pg[0], { x: 930, y: 300, vx: 300, vy: 0 });
  Object.assign(pg[6], { x: 960, y: 300, vx: 250, vy: 0, stickOffset: { x: 30, y: 0 } });
  P.stepPostGoal(pg, P.DT);
  assert.equal(pg[0].holding, false, 'stepPostGoal releases Sticky holding when pinning scored ball');
  assert.equal(pg[6].x, 960); assert.equal(pg[6].y, 300);
  assert.ok(pg[0].vx > 200, 'skater continues past pinned ball without rebounding off it');
});

test('Sticky grab sets strikerTeam/strikerSlot/strikerPower/curveMult so released ball counts as carrier team pass for teammate Snaps and friendly Guard traps', () => {
  const M = require('../shared/ububall-match.js');
  const b = P.kickoff();
  b.slice(0, 6).forEach(x => P.applyStats(x, normal));
  // Team 1 carrier (b[3], slot 3 in kickoff, team 1) catches an incoming Team 0 shot
  const carrier = b[3], teammateShooter = b[4], teammateGuard = b[5], ball = b[6];
  carrier.power = 1.25;
  carrier.curveMult = 1.15;
  Object.assign(carrier, { x: 600, y: 300, vx: -260, vy: 0, superActive: 'sticky', superTicks: P.SUPER.ticks, superHoldTicks: P.SUPER.holdTicks });
  Object.assign(ball, { x: 560, y: 300, vx: 380, vy: 0, strikerTeam: 0, strikerSlot: 1, strikerPower: 0.9, curveMult: 0.85 });

  for (let t = 0; t < 30 && !carrier.holding; t++) P.step(b, P.DT);
  assert.equal(carrier.holding, true, 'Team 1 Sticky carrier catches Team 0 shot');
  assert.equal(ball.strikerTeam, 1, 'Sticky grab updates ball.strikerTeam to carrier team');
  assert.equal(ball.strikerSlot, carrier.slot, 'Sticky grab updates ball.strikerSlot to carrier slot');
  assert.equal(ball.strikerPower, 1.25, 'Sticky grab updates ball.strikerPower');
  assert.equal(ball.curveMult, 1.15, 'Sticky grab updates ball.curveMult');

  // Release without another touch while moving fast enough (>= 180 px/s) for a teammate Snap one-timer
  carrier.vx = -320; carrier.vy = 0;
  ball.vx = -320; ball.vy = 0;
  P.endSuper(carrier, b);
  assert.equal(carrier.holding, false);
  assert.equal(ball.strikerTeam, 1, 'released ball retains Sticky carrier team');

  // 1) Different Team 1 teammate driving >= 140 px/s into the Sticky-released ball triggers Snap
  const snapSim = structuredClone(b);
  snapSim.slice(0, 6).forEach((x, idx) => Object.assign(x, { x: 100 + idx * 45, y: 520, vx: 0, vy: 0 }));
  Object.assign(snapSim[6], { x: 500, y: 300, vx: 0, vy: 280 });
  Object.assign(snapSim[4], { x: 538, y: 300, vx: -500, vy: 0, guarding: false });
  let snapped = false;
  P.step(snapSim, 0, ({ snapped: isSnap }) => { if (isSnap) snapped = true; });
  assert.equal(snapped, true, 'teammate Snap one-timer triggers off a Sticky-released pass');

  // 2) Team 1 teammate in Guard stance catching the Sticky-released ball (>= 175 px/s) triggers friendly Trap! (own: true)
  const trapSim = structuredClone(b);
  trapSim.slice(0, 6).forEach((x, idx) => Object.assign(x, { x: 100 + idx * 45, y: 520, vx: 0, vy: 0 }));
  trapSim[5].guarding = true;
  P.syncEffectiveStats(trapSim[5]);
  Object.assign(trapSim[5], { x: 460, y: 300, vx: 0, vy: 0 });
  Object.assign(trapSim[6], { x: 460 + trapSim[5].reach + trapSim[6].radius - 1, y: 300, vx: -260, vy: 0 });
  const play = M.newPlay({ credit: { 3: 1 }, last: 3, lastTouch: [null, 3] });
  const tick = M.playTick(P, trapSim, play, {}, M.newTally(), true);
  assert.equal(tick.saves.length, 1, 'friendly Guard trap registers on Sticky-released pass');
  assert.equal(tick.saves[0].iron, true);
  assert.equal(tick.saves[0].own, true, 'counted as friendly Trap! rather than opposing Iron Save');
});

test('A4 & A5: makeUbu/makeBall pre-initialize stable shapes, helpers manage striker/heat, and onCollide reuses one contact object without body flags', () => {
  const u0 = P.makeUbu(0, 0), u4 = P.makeUbu(1, 1), ball = P.makeBall();
  assert.deepEqual(Object.keys(u0), Object.keys(u4), 'makeUbu produces identical key order across teams/slots');
  assert.equal('superArm' in u0, false, 'makeUbu omits UI-only superArm');
  assert.equal(ball.team, -1);
  assert.equal(ball.strikerTeam, -1);
  assert.equal(ball.strikerSlot, -1);
  assert.equal(ball.stickOffset, null);

  u4.power = 1.18;
  u4.curveMult = 1.25;
  P.setStriker(ball, u4);
  assert.equal(ball.strikerTeam, 1);
  assert.equal(ball.strikerSlot, 1);
  assert.equal(ball.strikerPower, 1.18);
  assert.equal(ball.curveMult, 1.25);

  ball.onFire = true; ball.fireTicks = 120; ball.pace = 820;
  P.clearHeat(ball);
  assert.equal(ball.onFire, false);
  assert.equal(ball.fireTicks, 0);
  assert.equal(ball.pace, 0);

  P.clearStriker(ball);
  assert.equal(ball.strikerTeam, -1);
  assert.equal(ball.strikerSlot, -1);
  assert.equal(ball.strikerPower, 1);
  assert.equal(ball.curveMult, 1);

  // Reused contact event object & zero spinStruck/snapStruck properties on bodies
  const sim = P.kickoff();
  sim.slice(0, 6).forEach(x => P.applyStats(x, normal));
  sim.slice(0, 6).forEach((x, idx) => Object.assign(x, { x: 120 + idx * 50, y: 500, vx: 0, vy: 0 }));
  Object.assign(sim[0], { x: 400, y: 300, vx: 420, vy: 0, omega: 14, spinStrike: 2 });
  Object.assign(sim[6], { x: 441, y: 300, vx: 0, vy: 0, openingShot: true });
  const refs = [], snapshots = [];
  P.step(sim, 0, ev => {
    refs.push(ev);
    snapshots.push({ ...ev });
  });
  Object.assign(sim[1], { x: 460, y: 300, vx: 520, vy: 0 });
  Object.assign(sim[6], { x: 500, y: 300, vx: 0, vy: 320, strikerTeam: 0, strikerSlot: 0, strikerPower: 1 });
  P.step(sim, 0, ev => {
    refs.push(ev);
    snapshots.push({ ...ev });
  });
  assert.equal(refs.length, 2);
  assert.equal(refs[0], refs[1], 'onCollide reuses a single contact event object across contacts');
  assert.equal(snapshots[0].spinStruck, true, 'spin strike reported on contact event');
  assert.equal(snapshots[1].snapped, true, 'Snap reported on contact event');
  for (const body of sim) {
    assert.equal('spinStruck' in body, false);
    assert.equal('snapStruck' in body, false);
  }

  // stepPostGoal pins ball at current coordinates without adding/deleting pinX/pinY
  Object.assign(sim[6], { x: 962, y: 304, vx: 400, vy: -50, omega: 9 });
  P.stepPostGoal(sim, P.DT);
  assert.equal(sim[6].x, 962);
  assert.equal(sim[6].y, 304);
  assert.equal('pinX' in sim[6], false);
  assert.equal('pinY' in sim[6], false);
});

test('v28 Ice Bite & Carve Drive: Grip fuels launch thrust and moving cuts, and high Spin×Curve boosts spinning launches only', () => {
  // Ice Bite: Grip contributes to launch speed and sharpens high-speed cuts; from rest, big ubus get full effSteer = 1
  const lowGrip = P.kickoff()[0], highGrip = P.kickoff()[0], bigRest = P.kickoff()[0];
  P.applyStats(lowGrip, { ...normal, impulse: 180, grip: 0 });
  P.applyStats(highGrip, { ...normal, impulse: 180, grip: 255 });
  P.applyStats(bigRest, { ...normal, size: 255, grip: 0 });
  assert.ok(P.launchSpeed(highGrip) > P.launchSpeed(lowGrip) * 1.14, 'high Grip increases Ice Bite launch speed');
  P.launch([bigRest], [{ angle: 0, power: 1, spin: 0 }]);
  assert.ok(Math.abs(bigRest.vx - P.launchSpeed(bigRest)) < 1e-9, 'stationary big ubu gets full launch speed without double size penalty');

  const cutLow = P.kickoff()[0], cutHigh = P.kickoff()[0];
  P.applyStats(cutLow, { ...normal, grip: 0 });
  P.applyStats(cutHigh, { ...normal, grip: 255 });
  cutLow.vx = cutHigh.vx = 600;
  P.launch([cutLow], [{ angle: Math.PI, power: 1, spin: 0 }]);
  P.launch([cutHigh], [{ angle: Math.PI, power: 1, spin: 0 }]);
  assert.ok(cutHigh.vx < cutLow.vx - 120, `high Grip reverses moving momentum sharper (${cutHigh.vx} vs ${cutLow.vx})`);

  // Carve Drive: neutral and low Spin×Curve get 0% boost; 255/255 gets +10% at full spin
  const bruiser = P.kickoff()[0], carver = P.kickoff()[0];
  P.applyStats(bruiser, { ...normal, spin: 40, curve: 40 });
  P.applyStats(carver, { ...normal, spin: 255, curve: 255 });
  assert.equal(P.carveDriveBoost(bruiser, 1), 1, 'below-neutral Spin×Curve gets no Carve Drive boost');
  assert.ok(Math.abs(P.carveDriveBoost(carver, 1) - 1.1) < 1e-9, '255/255 Spin×Curve gets +10% Carve Drive at |spin|=1');
  assert.equal(P.carveDriveBoost(carver, 0), 1, 'zero spin gets no Carve Drive boost');
  P.launch([carver], [{ angle: 0, power: 1, spin: -1 }]);
  assert.ok(Math.abs(carver.vx - P.launchSpeed(carver) * 1.1) < 1e-9, 'launch applies Carve Drive symmetrically on negative spin');
});

test('v28 True Glide: intentional spin launches keep full Curve while involuntary check spin-outs are damped on high-Curve skaters', () => {
  const intentional = P.kickoff()[0], clippedHigh = P.kickoff()[0], clippedNeutral = P.kickoff()[0];
  P.applyStats(intentional, { ...normal, curve: 255, spin: 255 });
  P.applyStats(clippedHigh, { ...normal, curve: 255, spin: 255 });
  P.applyStats(clippedNeutral, { ...normal, curve: 127, spin: 255 });

  Object.assign(intentional, { x: 250, y: 300 });
  P.launch([intentional], [{ angle: 0, power: 0.8, spin: 1 }]);
  Object.assign(clippedHigh, { x: 250, y: 300, vx: intentional.vx, vy: 0, omega: intentional.omega, launchSpin: 0 });
  Object.assign(clippedNeutral, { x: 250, y: 300, vx: intentional.vx, vy: 0, omega: intentional.omega, launchSpin: 0 });

  for (let t = 0; t < 48; t++) {
    P.step([intentional], P.DT);
    P.step([clippedHigh], P.DT);
    P.step([clippedNeutral], P.DT);
  }
  const dyIntent = Math.abs(intentional.y - 300);
  const dyClipHigh = Math.abs(clippedHigh.y - 300);
  const dyClipNeut = Math.abs(clippedNeutral.y - 300);
  assert.ok(dyIntent > dyClipHigh * 3.5, `True Glide preserves intentional curve while damping involuntary spin-out (${dyIntent} vs ${dyClipHigh})`);
  assert.ok(dyClipHigh < dyClipNeut, `high Curve suffers less involuntary drift than neutral Curve (${dyClipHigh} vs ${dyClipNeut})`);

  // Skater-vs-skater collision clears launchSpin so post-collision spin uses True Glide damping
  const a = P.kickoff()[0], c = P.kickoff()[3];
  P.applyStats(a, { ...normal, curve: 255, spin: 255 });
  P.applyStats(c, normal);
  Object.assign(a, { x: 400, y: 300 });
  Object.assign(c, { x: 448, y: 310, vx: -200, vy: 0 });
  P.launch([a], [{ angle: 0, power: 0.8, spin: 1 }]);
  assert.ok(a.launchSpin > 0);
  P.step([a, c], P.DT);
  assert.equal(a.launchSpin, 0, 'skater collision clears launchSpin');
});

test('v28 Tempered Shot, Sweet Spot & Wide Stance: Power is tempered, extended Reach tips hit softer than body core, and big Guards get proportional reach', () => {
  // Tempered Shot exponent
  const shooter = P.kickoff()[0];
  P.applyStats(shooter, { ...normal, power: 255 });
  assert.ok(Math.abs(shooter.power - 1.5 ** P.TEMPERED_SHOT.powerExp) < 1e-9);

  // Sweet Spot: core contact (d <= max(radius, 25) + 18) transfers more ball speed than outer poke tip (d near 37.5 + 18)
  const hitAt = dist => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal, size: 127, reach: 255, power: 200 });
    Object.assign(b[0], { x: 400, y: 300, vx: 600, vy: 0 });
    Object.assign(b[6], { x: 400 + dist, y: 300, vx: 0, vy: 0 });
    const before = kineticEnergy([b[0], b[6]]);
    P.step([b[0], b[6]], 0);
    assert.ok(kineticEnergy([b[0], b[6]]) <= before * (1 + 1e-12));
    return b[6].vx;
  };
  const coreSpeed = hitAt(25 + 18 - 0.2);
  const tipSpeed = hitAt(37.5 + 18 - 0.2);
  assert.ok(coreSpeed > tipSpeed * 1.12, `Sweet Spot core hits harder than extended Reach poke tip (${coreSpeed} vs ${tipSpeed})`);

  // Big ubu (size=255, radius=37.5) hits at 100% Sweet Spot even at its outer 37.5 px body edge
  const bigHit = (() => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal, size: 255, reach: 0, mass: 127, power: 200 });
    Object.assign(b[0], { x: 400, y: 300, vx: 600, vy: 0 });
    Object.assign(b[6], { x: 400 + 37.5 + 18 - 0.2, y: 300, vx: 0, vy: 0 });
    P.step([b[0], b[6]], 0);
    return b[6].vx;
  })();
  assert.ok(Math.abs(bigHit - coreSpeed) < 1e-6, 'big ubu outer body edge gets 100% Sweet Spot transfer');

  // Wide Stance: Size=255 Guard reach scales to 37.5 * 1.25 = 46.875 px (56.25 px on Iron Guard) instead of 0 bonus
  const bigGuard = P.kickoff()[0];
  P.applyStats(bigGuard, { ...normal, size: 255, reach: 0 });
  assert.equal(bigGuard.reach, 37.5);
  bigGuard.guarding = true;
  P.syncEffectiveStats(bigGuard);
  assert.ok(Math.abs(bigGuard.reach - 37.5 * 1.25) < 1e-9, `Wide Stance gives Size=255 Guard reach 46.875 (got ${bigGuard.reach})`);
  P.applyDoubledGuard(bigGuard);
  assert.ok(Math.abs(bigGuard.reach - 37.5 * 1.5) < 1e-9, `Wide Stance gives Size=255 Iron Guard reach 56.25 (got ${bigGuard.reach})`);
});

test('v28 Board Spring & Pack Draft: Bounciness unclips above 175 and boosts corner Rim-Around exit speed within KE bounds, and Synergy×Chemistry strengthens teammate slipstream', () => {
  // Board Spring unclips Bounciness between 175 and 235 on flat boards
  const wallRebound = bounciness => {
    const u = P.kickoff()[0];
    P.applyStats(u, { ...normal, bounciness });
    Object.assign(u, { x: 400, y: 60 + u.radius - 0.5, vx: 0, vy: -500 });
    P.step([u], 0);
    return u.vy;
  };
  assert.ok(wallRebound(235) > wallRebound(175) + 35, 'Bounciness 175->235 stays unclipped on rink boards');

  // Board Spring redirects dissipated corner Rim-Around energy into tangential speed while strictly preserving KE
  const cornerCarve = bounciness => {
    const u = P.kickoff()[0];
    P.applyStats(u, { ...normal, bounciness });
    const nx = -Math.SQRT1_2, ny = -Math.SQRT1_2, tx = -ny, ty = nx;
    const d = P.rink.corner - u.radius + 0.6;
    Object.assign(u, { x: 160 + nx * d, y: 160 + ny * d, vx: nx * 130 + tx * 360, vy: ny * 130 + ty * 360, omega: -15, spinStrike: 1.5 });
    const ke0 = kineticEnergy([u]);
    P.step([u], 0);
    const ke1 = kineticEnergy([u]);
    assert.ok(ke1 <= ke0 * (1 + 1e-12), `Board Spring corner carve preserves KE (${ke1} <= ${ke0})`);
    return u.vx * tx + u.vy * ty;
  };
  assert.ok(cornerCarve(255) > cornerCarve(0) + 12, 'higher Bounciness exits corner Rim-Around with faster tangential speed');

  // Pack Draft: high Synergy lead + high Chemistry trailer cuts more friction than opponent drafting
  const bodies = P.kickoff();
  P.applyStats(bodies[0], { ...normal, chemistry: 255 });
  P.applyStats(bodies[1], { ...normal, synergy: 255 });
  P.applyStats(bodies[3], { ...normal, synergy: 255 });
  Object.assign(bodies[1], { x: 460, y: 240, vx: 520, vy: 0 });
  Object.assign(bodies[0], { x: 395, y: 240, vx: 440, vy: 0 });
  const teamDraft = P.tailgateFactor(bodies, bodies[0]);

  Object.assign(bodies[1], { x: 100, y: 500, vx: 0, vy: 0 });
  Object.assign(bodies[3], { x: 460, y: 240, vx: 520, vy: 0 });
  const oppDraft = P.tailgateFactor(bodies, bodies[0]);
  assert.ok(teamDraft > oppDraft * 1.4, `Pack Draft boosts teammate slipstream (${teamDraft} vs ${oppDraft})`);
  assert.ok(teamDraft * P.TAILGATE.frictionCut <= P.PACK_DRAFT.maxCut + 1e-9, 'Pack Draft respects maxCut ceiling');
});
