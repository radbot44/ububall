'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('./ububall-physics.js');
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
  assert.ok(outcomes.every(b => Math.abs(Math.hypot(b.vx, b.vy) - 69) < 1e-8));
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
