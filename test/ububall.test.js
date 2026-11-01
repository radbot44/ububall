'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../web/ububall-physics.js');
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
  assert.ok(Math.abs(b[0].vx - 720 * (2 / 3)) < 1e-9);
  assert.equal(b[1].vx, 720);
  assert.equal(b[2].vx, 1080);
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
  Object.assign(bodies[0], { x: 400, y: 300, reach });
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
    [10, 10, 15, 20].forEach((gain, i) => {
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

test('spin strike uses the remaining spin, which decays at 5 rad/s', () => {
  const [ubu] = P.kickoff(); P.applyStats(ubu); ubu.omega = 10;
  P.step([ubu], .2);
  assert.ok(Math.abs(ubu.omega - 9) < 1e-9);
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
  let previous = kineticEnergy(bodies), ricochets = 0;
  for (let tick = 0; tick < 2880; tick++) {
    const goal = P.step(bodies, P.DT, () => { ricochets++; }, null, null, key => { if (key === 'cannonball') activations++; });
    const energy = kineticEnergy(bodies);
    assert.ok(energy <= previous * (1 + 1e-10) + 1e-8, `Ricochet gained energy at tick ${tick}`);
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
  P.step(b, 0, (bodyA, bodyB, speed, impulse) => {
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
  assert.equal(b[3].stunned, false);
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
  assert.ok(Math.abs(b[0].radius - origRadius * P.SUPER.colossusRadius) < 1e-6);
  assert.ok(Math.abs(b[0].mass - origMass * P.SUPER.colossusMass) < 1e-6);
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
    live[3].superArm = false; live[3].superActive = null;
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
    P.startTurn(b, [{ angle: 0, power: .6, spin: 1 }]);
    b[6].x = 442.9; P.step(b, 0);
    return b[6];
  };
  const [low, high] = [shot(0), shot(255)];
  assert.ok(Math.abs(high.omega) > Math.abs(low.omega));
  assert.equal(Math.sign(high.omega), Math.sign(low.omega)); // Still counter-rotating, never reversed.
  assert.ok(high.curveFactor > low.curveFactor);
});
test('hard checks daze the next launch, stack, and Stability resists them', () => {
  const check = (stability, hits) => {
    const b = P.kickoff(); P.applyStats(b[0], normal); P.applyStats(b[3], { ...normal, stability });
    for (let i = 0; i < hits; i++) { Object.assign(b[0], { x: 300, y: 300, vx: 720, vy: 0 }); Object.assign(b[3], { x: 349, y: 300, vx: 0, vy: 0 }); P.step(b, 0); }
    return b;
  };
  const once = check(127, 1)[3].daze, twice = check(127, 2)[3].daze;
  assert.ok(Math.abs(once - .15) < .005 && twice > once && check(127, 4)[3].daze === P.DAZE.max);
  assert.ok(!check(127, 1)[0].daze); // The attacker is not dazed by its own check.
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
    P.step(b, P.DT, (bodyA, bodyB, speed, impulse, plow) => { hit = { plow, before }; });
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
    P.step(b, P.DT, (bodyA, bodyB, speed, impulse, plow, isIron) => { if (isIron) iron = true; else if (plow) beaten = true; }, null, (src, rad, type) => { if (type === 'iron') shockwave = true; });
  }
  return { ball: b[6], iron, beaten, shockwave };
}
test('Iron Save triggers when an opposing Guard squares up to a full-speed fireball', () => {
  const { ball, iron, shockwave } = guardAgainstFireball(0);
  assert.equal(iron, true, 'the Guard makes an Iron Save');
  assert.equal(P.ballOnFire(ball), false, 'fire is quenched on Iron Save');
  assert.equal(shockwave, true, 'minor shockwave is emitted');
});
test('a glancing full-speed fireball beats a Guard', () => {
  const { ball, iron, beaten } = guardAgainstFireball(20);
  assert.equal(iron, false);
  assert.equal(beaten, true, 'the fireball overpowers the Guard');
  assert.equal(P.ballOnFire(ball), true, 'and keeps its fire');
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
