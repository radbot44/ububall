'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../web/ububall-physics.js');
const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };
test('experimental stat curve preserves endpoints and concentrates values near normal', () => {
  assert.ok(Math.abs(P.multiplier(0) - 2 / 3) < 1e-12);
  assert.equal(P.multiplier(127), 1); assert.equal(P.multiplier(255), 1.5);
  const values = Array.from({ length: 256 }, (_, i) => P.multiplier(i));
  assert.ok(values.every((v, i) => !i || v >= values[i - 1]));
  assert.ok(values.filter(v => v >= .958 && v <= 1.063).length >= 128);
});
test('mass changes launch speed while equal-power momentum stays constant', () => {
  const b = P.kickoff();
  [0, 127, 255].forEach((mass, i) => P.applyStats(b[i], { ...normal, mass }));
  P.launch(b, Array.from({ length: 6 }, () => ({ angle: 0, power: 1 })));
  for (const body of b.slice(0, 3)) assert.ok(Math.abs(body.mass * body.vx - P.IMPULSE) < 1e-9);
  assert.ok(Math.abs(b[0].vx - 1080) < 1e-9); assert.equal(b[1].vx, 720); assert.equal(b[2].vx, 480);
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
  assert.ok(straightSpeed < 69 && straightSpeed > 0);
  assert.ok(outcomes.every(b => Math.abs(Math.hypot(b.vx, b.vy) - straightSpeed) < 1e-8));
});
test('air drag slows both balls and ubus more strongly at higher speeds', () => {
  for (const index of [0, 6]) {
    const losses = [100, 700].map(speed => {
      const body = P.kickoff()[index];
      Object.assign(body, { x: 500, y: 300, vx: speed, vy: 0, friction: 0 });
      P.step([body]);
      return speed - body.vx;
    });
    assert.ok(losses[0] > 0 && losses[1] > losses[0] * 40);
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
test('bounciness scales collision restitution between colliding bodies', () => {
  const bounceResults = [0, 127, 255].map(bounciness => {
    const b = P.kickoff();
    P.applyStats(b[0], { ...normal, bounciness });
    P.applyStats(b[1], { ...normal, bounciness });
    Object.assign(b[0], { x: 400, y: 300, vx: 500 });
    Object.assign(b[1], { x: 430, y: 300, vx: -500 });
    P.step(b, 0);
    return b[1].vx - b[0].vx;
  });
  assert.ok(bounceResults[0] < bounceResults[1] && bounceResults[1] < bounceResults[2]);
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

test('close spin ramps from zero at 1.5 ball diameters to full at hitbox contact', () => {
  for (const spin of [-1, 0, 1]) {
    const bonuses = [54, 27, 0].map(gap => {
      const bodies = closeSpinSetup(gap, spin), control = structuredClone(bodies);
      control[6].openingShot = false;
      strikeCloseSpin(bodies); strikeCloseSpin(control);
      assert.equal(bodies[6].vx, control[6].vx);
      assert.equal(bodies[6].vy, control[6].vy);
      return bodies[6].omega - control[6].omega;
    });
    assert.deepEqual(bonuses, [0, 8 * spin, 16 * spin]);
  }
  const reach = closeSpinSetup(0, 1, 37.5);
  assert.equal(reach[0].closeSpinBonus, 16);
  assert.equal(closeSpinSetup(55)[0].closeSpinBonus, 0);
});

test('leaving close-spin range cancels it permanently even when the ball returns', () => {
  const bodies = closeSpinSetup();
  bodies[6].x = 400 + 25 + 18 + 54 + .01;
  P.step(bodies, 0);
  assert.equal(bodies[0].closeSpinBonus, 0);
  const control = structuredClone(bodies); control[6].openingShot = false;
  strikeCloseSpin(bodies); strikeCloseSpin(control);
  assert.equal(bodies[6].omega, control[6].omega);
});

test('a teammate or opponent touching first cancels the opening spin bonus', () => {
  for (const index of [1, 3]) {
    const bodies = closeSpinSetup(20);
    Object.assign(bodies[index], { x: bodies[6].x + 43, y: 300, vx: 0, vy: 0 });
    P.step(bodies, 0);
    assert.equal(bodies[6].openingShot, false);
    Object.assign(bodies[index], { x: 800, y: 450 });
    const control = structuredClone(bodies); control[0].closeSpinBonus = 0;
    strikeCloseSpin(bodies); strikeCloseSpin(control);
    assert.equal(bodies[6].omega, control[6].omega);
  }
});

test('close spin is single use, with no bonus on simultaneous or separating touches', () => {
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

test('Sticky leaves a full close-spin setup next turn; held and stunned ubus get no bonus', () => {
  const bodies = closeSpinSetup(); bodies[0].superActive = 'sticky';
  strikeCloseSpin(bodies);
  assert.equal(bodies[6].stuckTo, bodies[0]);
  P.stop(bodies);
  P.startTurn(bodies, [{ angle: 0, power: .6, spin: 1 }]);
  assert.ok(Math.abs(bodies[0].closeSpinBonus - 16) < 1e-9);
  for (const stunned of [false, true]) {
    P.stop(bodies); bodies[0].stunned = stunned;
    P.startTurn(bodies, [{ angle: 0, power: stunned ? .6 : 0, spin: 1 }]);
    assert.equal(bodies[0].closeSpinBonus, 0);
  }
});

test('close spin curves the ball in the same way in preview and gameplay', () => {
  const bodies = closeSpinSetup(); P.stop(bodies);
  const before = structuredClone(bodies), plans = [{ angle: 0, power: .6, spin: 1 }];
  const prediction = P.predictTurn(bodies, plans);
  assert.deepEqual(bodies, before);
  P.startTurn(bodies, plans);
  for (let tick = 0; tick < 120; tick++) P.step(bodies);
  const point = prediction.paths[6].find(p => p.tick === 120);
  assert.equal(point.x, bodies[6].x); assert.equal(point.y, bodies[6].y);
  assert.ok(bodies[6].y > 310);
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
  assert.ok(Math.abs(bodies[6].vx - ordinary[6].vx * 2.5) < 1e-9);
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
  assert.ok(b[3].vx > 0);
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
  assert.equal(b[6].stuckTo, b[0]);
  const initialBallX = b[6].x;
  for (let i = 0; i < 20; i++) P.step(b, P.DT);
  assert.ok(b[6].x > initialBallX);
  assert.equal(b[6].stuckTo, b[0]);
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
  assert.ok(cannonVx > normalVx * 2.0);
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
  assert.ok(Math.abs(b[0].radius - origRadius * 1.8) < 1e-6);
  assert.ok(Math.abs(b[0].mass - origMass * 2.5) < 1e-6);
  P.stop(b);
  assert.ok(Math.abs(b[0].radius - origRadius) < 1e-6);
  assert.ok(Math.abs(b[0].mass - origMass) < 1e-6);
});

test('Shockwave propels nearby players and the ball radially outward upon triggering', () => {
  const b = P.kickoff();
  Object.assign(b[0], { x: 400, y: 300 });
  Object.assign(b[1], { x: 450, y: 300, vx: 0, vy: 0 });
  Object.assign(b[6], { x: 400, y: 360, vx: 0, vy: 0 });
  let shockRadius = null;
  P.triggerShockwave(b[0], b, (source, radius) => { shockRadius = radius; });
  assert.equal(shockRadius, 220);
  assert.ok(b[1].vx > 0);
  assert.ok(b[6].vy > 0);
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
  Object.assign(bodies[0], { x: 300, y: 300, superActive: 'magnet' });
  P.step(bodies, P.DT);
  assert.ok(bodies[6].vx < 0);
  const distant = P.kickoff();
  Object.assign(distant[0], { x: 180, y: 300, superActive: 'magnet' });
  P.step(distant, P.DT);
  assert.equal(distant[6].vx, 0);
});
test('shockwaves stay finite at coincident positions and repel nearby bodies', () => {
  const source = { x: 300, y: 300, vx: 0, vy: 0, mass: 3 };
  const center = { x: 300, y: 300, vx: 0, vy: 0, mass: 3 };
  const nearby = { x: 400, y: 300, vx: 0, vy: 0, mass: 1 };
  const far = { x: 600, y: 300, vx: 0, vy: 0, mass: 1 };
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
  assert.equal(b[6].stuckTo, b[0]);
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
  Object.assign(bodies[6], { x: 473, y: 300, stuckTo: bodies[1], stickOffset: { x: 43, y: 0 } });
  const plans = [{ angle: 0, power: 1, spin: .3 }];
  const original = structuredClone(bodies);
  const prediction = P.predictTurn(bodies, plans);
  assert.deepEqual(bodies, original);
  assert.equal(bodies[6].stuckTo, bodies[1]);
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
  assert.equal(supPlans[0].power, 0);
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
    if (stuck) ball.stuckTo = a;
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
