'use strict';
const {
  DT, STRIKE_GAIN, CLOSE_SPIN_GAIN, GUARD_BRAKE, SIZE, ICE_BITE, ballOnFire, daze, SUPER, ballHitRadius, carveDriveBoost, launchSpeed, colossusProgress, syncEffectiveStats, clearStriker, clearHeat
} = require('./constants.js');
const { walls, endSuper } = require('./collide.js');
const { step } = require('./step.js');

const ZERO_PLAN = Object.freeze({ angle: 0, power: 0, spin: 0 });
function launch(bodies, plans) {
  const count = bodies.length;
  const std7 = count === 7 && bodies[6].team === -1;
  const skaterEnd = std7 ? 6 : count;
  for (let i = 0; i < skaterEnd; i++) {
    const b = bodies[i];
    if (!std7 && b.team < 0) { b.spinStrike = 0; continue; }
    b.spinStrike = 0;
    syncEffectiveStats(b);
    if (b.stunned) {
      b.vx = 0; b.vy = 0; b.omega = 0;
      b.daze = 0;
      continue;
    }
    if (b.guarding) {
      b.vx *= GUARD_BRAKE; b.vy *= GUARD_BRAKE; b.omega *= GUARD_BRAKE; b.daze = 0;
      continue;
    }
    const plan = plans[i] || ZERO_PLAN;
    const spinInput = Math.max(-1, Math.min(1, plan.spin || 0));
    const full = launchSpeed(b) * carveDriveBoost(b, spinInput), power = Math.max(0, Math.min(1, plan.power));
    b.daze = 0;
    if (power > 0) {
      const dx = Math.cos(plan.angle) * full * power - b.vx, dy = Math.sin(plan.angle) * full * power - b.vy;
      const prevSpeed = Math.hypot(b.vx, b.vy);
      const reSteerMult = (b.sizeMult || 1) ** SIZE.agility * ((b.grip ?? .3) / .3) ** ICE_BITE.gripCutExp;
      const effSteer = 1 + Math.min(1, prevSpeed / (full || 1)) * (reSteerMult - 1);
      const scale = Math.min(1, (full * effSteer) / (Math.hypot(dx, dy) || 1));
      b.vx += dx * scale; b.vy += dy * scale;
      b.omega = Math.max(-b.maxSpin, Math.min(b.maxSpin, b.omega + spinInput * b.maxSpin));
      b.launchSpin = spinInput !== 0 ? b.omega : (b.launchSpin && b.omega * b.launchSpin > 0 ? b.omega : 0);
      b.spinStrike = STRIKE_GAIN;
    }
  }
  const ball = std7 ? bodies[6] : bodies.find(b => b.team === -1);
  if (ball) {
    if (std7) ball.spinStrike = 0;
    let anySpinStrike = false;
    for (let i = 0; i < skaterEnd; i++) {
      const b = bodies[i];
      if (!b.spinStrike) continue;
      anySpinStrike = true;
      const gap = Math.max(0, Math.hypot(b.x - ball.x, b.y - ball.y) - ballHitRadius(b) - ball.radius);
      const proximity = Math.max(0, 1 - gap / (4 * ball.radius));
      b.spinStrike += (CLOSE_SPIN_GAIN - STRIKE_GAIN) * proximity * proximity * (3 - 2 * proximity);
    }
    ball.openingShot = anySpinStrike;
  }
}
function settled(bodies, ignoreBall = false) {
  const count = bodies.length;
  if (count === 7 && bodies[6].team === -1) {
    if (!ignoreBall) {
      const ball = bodies[6];
      if (ball.vx * ball.vx + ball.vy * ball.vy >= 4 || Math.abs(ball.omega) >= .05) return false;
    }
    for (let i = 5; i >= 0; i--) {
      const b = bodies[i];
      if (b.vx * b.vx + b.vy * b.vy >= 4 || Math.abs(b.omega) >= .05 ||
          (b.superActive === 'colossus' && colossusProgress(b) < 1)) return false;
    }
    return true;
  }
  for (let i = count - 1; i >= 0; i--) {
    const b = bodies[i];
    if (ignoreBall && b.team === -1) continue;
    if (b.vx * b.vx + b.vy * b.vy >= 4 || Math.abs(b.omega) >= .05 ||
        (b.team >= 0 && b.superActive === 'colossus' && colossusProgress(b) < 1)) return false;
  }
  return true;
}
function stop(bodies, keepMotion = false) {
  const count = bodies.length;
  const std7 = count === 7 && bodies[6].team === -1;
  for (let i = 0; i < count; i++) {
    const b = bodies[i];
    b.spinStrike = 0;
    b.openingShot = false;
    b.guarding = false; b.ironGuard = false; b.ironCooldownTicks = 0;
    b.stunned = false;
    if (!keepMotion) { b.vx = b.vy = b.omega = 0; if (b.team >= 0) b.launchSpin = 0; }
    if (!keepMotion || (!b.superActive && b.usedSuperThisTurn && !b.superRefunded)) endSuper(b, bodies);
    syncEffectiveStats(b);
  }
  const ball = std7 ? bodies[6] : bodies.find(b => b.team === -1);
  if (ball && !keepMotion) {
    ball.stickOffset = null;
    clearHeat(ball);
    clearStriker(ball);
  }
}
function stepPostGoal(bodies, dt = DT, onCollide = null, onWall = null, onShockwave = null, onSuper = null) {
  const ball = bodies.find(b => b.team === -1);
  const px = ball ? ball.x : 0, py = ball ? ball.y : 0;
  if (ball) {
    if (ball.stickOffset !== null) {
      ball.stickOffset = null;
      for (const b of bodies) if (b.holding) b.holding = false;
    }
    ball.vx = 0; ball.vy = 0; ball.omega = 0;
  }
  const skaters = ball ? bodies.filter(b => b !== ball) : bodies;
  step(skaters, dt, onCollide, onWall, onShockwave, onSuper);
  if (ball) {
    ball.x = px; ball.y = py;
    ball.vx = 0; ball.vy = 0; ball.omega = 0;
  }
}
function ballRun(bodies, { removed = null, boards = false, ticks = 960 } = {}) {
  const sim = [];
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b === removed) continue;
    sim.push(b.team === -1 ? { ...b } : { ...b, holding: false });
  }
  const ball = sim.length > 0 && sim[sim.length - 1].team === -1 ? sim[sim.length - 1] : sim.find(b => b.team === -1);
  let clean = Boolean(ball), distance = 0;
  const onCol = ({ a, b }) => { if (a === ball || b === ball) clean = false; };
  const onWl = (b, velocity, type) => { if (b === ball && type === 'wall' && !boards) clean = false; };
  for (let t = 0; t < ticks && clean; t++) {
    const x = ball.x, y = ball.y;
    const goal = step(sim, DT, onCol, onWl);
    if (clean) distance += Math.hypot(ball.x - x, ball.y - y);
    if (goal !== null) return { goal: clean ? goal : null, distance };
    if (!ball.vx && !ball.vy) break;
  }
  return { goal: null, distance };
}
function wouldScore(bodies, removed, ticks = 960) { return ballRun(bodies, { removed, ticks }).goal; }
function startTurn(bodies, plans, onSuper = null) {
  const count = bodies.length;
  const skaterEnd = count === 7 && bodies[6].team === -1 ? 6 : count;
  const launchedSupers = onSuper ? [] : null;
  for (let i = 0; i < skaterEnd; i++) {
    const b = bodies[i];
    if (b.team < 0) continue;
    if (b.stunned && b.superActive) endSuper(b, bodies);
    const pl = plans[i];
    b.guarding = Boolean(pl?.guard) && !b.stunned;
    b.ironGuard = false;
    b.ironCooldownTicks = 0;
    b.usedSuperThisTurn = Boolean(b.superActive);
    if (!b.stunned && (b.superArm || pl?.superArm) && b.meter >= 100) {
      b.usedSuperThisTurn = true;
      b.meter = 0;
      b.superActive = b.equippedSuper.key;
      const bonusTicks = b.equippedSuper?.bonusTicks ?? b.superBonusTicks ?? 0;
      b.superTicks = SUPER.ticks + bonusTicks;
      b.superHoldTicks = SUPER.holdTicks + bonusTicks;
      if (b.superArm !== undefined) b.superArm = false;
      b.superHit = false;
      b.superRefunded = false;
      const sa = b.superActive;
      if (launchedSupers && (sa === 'stalwart' || sa === 'colossus' || sa === 'ghost')) {
        launchedSupers.push([sa, b]);
      }
    }
    syncEffectiveStats(b);
  }
  launch(bodies, plans);
  if (launchedSupers) {
    for (let i = 0; i < launchedSupers.length; i++) onSuper(launchedSupers[i][0], 'launch', launchedSupers[i][1]);
  }
}
const PREDICTION_TICKS = 480;
function predictTurn(bodies, plans) {
  const sim = bodies.map(b => ({
    ...b,
    stickOffset: b.stickOffset ? { x: b.stickOffset.x, y: b.stickOffset.y } : b.stickOffset,
    equippedSuper: b.equippedSuper ? { ...b.equippedSuper } : b.equippedSuper
  }));
  const held = { angle: 0, power: 0, spin: 0 };
  const predictedPlans = sim.map((b, i) => {
    if (b.team === 0) return plans[i] || held;
    if (b.team > 0 && b.superArm !== undefined) b.superArm = false;
    return held;
  });
  startTurn(sim, predictedPlans);
  const paths = sim.map(b => [{ x: b.x, y: b.y, tick: 0 }]);
  const impacts = [], lastImpact = new Map(), guards = new Map(), ball = sim.find(b => b.team === -1), ballIndex = sim.indexOf(ball);
  const hitThisTick = new Set(), hitPoints = sim.map(() => null);
  let goal = null, ticks = 0, ignition = null, burning = ballOnFire(ball);
  let goalTargets = null, goalTick = null;
  function recordImpact(b) {
    const index = sim.indexOf(b);
    if (index >= 0) {
      hitThisTick.add(index);
      if (!hitPoints[index]) hitPoints[index] = { x: b.x, y: b.y };
    }
    const last = lastImpact.get(index);
    if (last && (ticks - last.tick < 12 || Math.hypot(b.x - last.x, b.y - last.y) < 8)) return;
    const marker = { index, x: b.x, y: b.y, radius: b.radius, reach: b.team < 0 ? b.radius : Math.max(b.radius, b.reach || b.radius), tick: ticks };
    lastImpact.set(index, marker);
    impacts.push(marker);
  }
  let preStepBallSpeed = 0;
  const onCollide = ({ a, b, plow, iron }) => {
    recordImpact(a); recordImpact(b);
    const ubu = a === ball ? b : b === ball ? a : null, index = ubu ? sim.indexOf(ubu) : -1;
    if (ubu?.guarding && !guards.has(index) && (plow || iron || (ballOnFire(ball) && preStepBallSpeed > 50))) guards.set(index, !plow);
  };
  for (let tick = 1; tick <= PREDICTION_TICKS; tick++) {
    hitThisTick.clear();
    for (let i = 0; i < hitPoints.length; i++) hitPoints[i] = null;
    ticks = tick;
    preStepBallSpeed = ball ? Math.hypot(ball.vx, ball.vy) : 0;
    if (goal !== null) {
      stepPostGoal(sim, DT, onCollide, recordImpact);
    } else {
      const stepGoal = step(sim, DT, onCollide, recordImpact);
      if (stepGoal !== null) {
        goal = stepGoal;
        goalTick = tick;
        goalTargets = sim.map((b, i) => ({ x: b.x, y: b.y, index: i, team: b.team }));
        if (ball && ballIndex >= 0) {
          const hp = hitThisTick.has(ballIndex) ? hitPoints[ballIndex] : null;
          if (hp && Math.hypot(ball.x - hp.x, ball.y - hp.y) > 0.05) {
            paths[ballIndex].push({ x: hp.x, y: hp.y, tick: tick - 1e-3, hit: true });
            paths[ballIndex].push({ x: ball.x, y: ball.y, tick });
          } else {
            paths[ballIndex].push({ x: ball.x, y: ball.y, tick, ...(hitThisTick.has(ballIndex) ? { hit: true } : null) });
          }
        }
      }
    }
    if (ball && !burning && ballOnFire(ball)) { burning = true; ignition = { x: ball.x, y: ball.y, tick, team: ball.strikerTeam }; }
    const done = settled(sim, goal !== null) || tick === PREDICTION_TICKS;
    if (tick % 4 === 0 || done || hitThisTick.size > 0) {
      sim.forEach((b, i) => {
        if (goal !== null && b === ball) return;
        const hp = hitThisTick.has(i) ? hitPoints[i] : null;
        if (hp) {
          if (Math.hypot(b.x - hp.x, b.y - hp.y) > 0.05) {
            paths[i].push({ x: hp.x, y: hp.y, tick: tick - 1e-3, hit: true });
            paths[i].push({ x: b.x, y: b.y, tick });
          } else {
            paths[i].push({ x: b.x, y: b.y, tick, hit: true });
          }
        } else if (tick % 4 === 0 || done) {
          paths[i].push({ x: b.x, y: b.y, tick });
        }
      });
    }
    if (done) break;
  }
  return { paths, impacts, stops: sim.map((b, index) => ({ index, x: b.x, y: b.y, stopped: b.vx * b.vx + b.vy * b.vy < 4 })), ticks, goal, horizon: PREDICTION_TICKS,
    guards: [...guards].map(([index, held]) => ({ index, held })), ignition, goalTargets, goalTick };
}

module.exports = { launch, settled, stop, stepPostGoal, ballRun, wouldScore, startTurn, predictTurn };
