'use strict';
const {
  rink, DT, SUBSTEPS, BASE_LAUNCH_SPEED, SKATER_CURVE, AIR_DRAG, SPIN_DECAY, SETTLED_SPIN_DECAY, TRUE_GLIDE, HEAT, FIRE_TICKS, HOT_DRIVE, TAILGATE, TAILGATE_MIN_LEAD2, TAILGATE_MIN_FOLLOW2, bodyKE, scratchV2, scratchSpeed, skaterDraftAt, tailgateFactor, ballOnFire, ballCurveFactor, countSlowing, SUPER, ballHitRadius, syncEffectiveStats, clearStriker, emitCollide, getResolved, holder
} = require('./constants.js');
const { walls, triggerShockwave, triggerIronShockwave, endSuper, collide } = require('./collide.js');

let spareRadii = new Float64Array(7), spareDrafts = new Float64Array(7);
let sparePre = {
  x: new Float64Array(7), y: new Float64Array(7),
  vx: new Float64Array(7), vy: new Float64Array(7),
  omega: new Float64Array(7), rot: new Float64Array(7)
};
const shockOpp = new Array(6), shockD = new Float64Array(6), shockDx = new Float64Array(6), shockDy = new Float64Array(6);

function segMinDist2(dx0, dy0, dx1, dy1) {
  const rx = dx1 - dx0, ry = dy1 - dy0;
  const r2 = rx * rx + ry * ry;
  if (r2 <= 1e-12) return dx1 * dx1 + dy1 * dy1;
  const t = -(dx0 * rx + dy0 * ry) / r2;
  const u = t <= 0 ? 0 : (t >= 1 ? 1 : t);
  const cx = dx0 + rx * u, cy = dy0 + ry * u;
  return cx * cx + cy * cy;
}

// Returns 0 when inside clean interior ice, 2 when a wall/post/net impact needs 16x substepping,
// and 1 when near/overlapping a boundary without inward velocity (needs 1x depenetration check).
function bodyWallStepMode(b, x0, y0, stdRink) {
  const r = b.radius, x1 = b.x, y1 = b.y;
  if (stdRink && r <= 90 && x0 >= 150 && x1 >= 150 && x0 <= 850 && x1 <= 850 &&
      y0 >= 60 + r && y1 >= 60 + r && y0 <= 540 - r && y1 <= 540 - r) return 0;
  const k = rink;
  if (x1 >= k.left + r && x1 <= k.right - r && y1 >= k.top + r && y1 <= k.bottom - r &&
      ((x1 >= k.left + k.corner && x1 <= k.right - k.corner) || (y1 >= k.top + k.corner && y1 <= k.bottom - k.corner)) &&
      x0 >= k.left + r && x0 <= k.right - r) return 0;
  if (b.vx === 0 && b.vy === 0) return 1;
  const inGoalY = (y1 > k.goalTop && y1 < k.goalBottom) || (y0 > k.goalTop && y0 < k.goalBottom);
  const inLeftPocket = inGoalY || (x1 < k.left && y1 > k.goalTop - r && y1 < k.goalBottom + r);
  const inRightPocket = inGoalY || (x1 > k.right && y1 > k.goalTop - r && y1 < k.goalBottom + r);

  if (inLeftPocket) {
    if (x1 < k.left - k.goalDepth + r && b.vx < 0) return 2;
    if (x1 < k.left) {
      if ((y1 < k.goalTop + r && b.vy < 0) || (y1 > k.goalBottom - r && b.vy > 0)) return 2;
    } else if (Math.min(x0, x1) < k.left + r) {
      for (let pi = 0; pi < 2; pi++) {
        const py = pi === 0 ? k.goalTop : k.goalBottom;
        const dx0 = k.left - x0, dy0 = py - y0, dx1 = k.left - x1, dy1 = py - y1;
        if (segMinDist2(dx0, dy0, dx1, dy1) < r * r && (dx0 * dx0 + dy0 * dy0 >= r * r || b.vx * dx1 + b.vy * dy1 > 0)) return 2;
      }
    }
  } else if (x1 < k.left + r && b.vx < 0) {
    return 2;
  }

  if (inRightPocket) {
    if (x1 > k.right + k.goalDepth - r && b.vx > 0) return 2;
    if (x1 > k.right) {
      if ((y1 < k.goalTop + r && b.vy < 0) || (y1 > k.goalBottom - r && b.vy > 0)) return 2;
    } else if (Math.max(x0, x1) > k.right - r) {
      for (let pi = 0; pi < 2; pi++) {
        const py = pi === 0 ? k.goalTop : k.goalBottom;
        const dx0 = k.right - x0, dy0 = py - y0, dx1 = k.right - x1, dy1 = py - y1;
        if (segMinDist2(dx0, dy0, dx1, dy1) < r * r && (dx0 * dx0 + dy0 * dy0 >= r * r || b.vx * dx1 + b.vy * dy1 > 0)) return 2;
      }
    }
  } else if (x1 > k.right - r && b.vx > 0) {
    return 2;
  }

  const insidePocket = (x1 < k.left && inLeftPocket) || (x1 > k.right && inRightPocket);
  if (!insidePocket) {
    if ((y1 < k.top + r && b.vy < 0) || (y1 > k.bottom - r && b.vy > 0)) return 2;
    const cx = x1 < k.left + k.corner ? k.left + k.corner : (x1 > k.right - k.corner ? k.right - k.corner : -1);
    const cy = y1 < k.top + k.corner ? k.top + k.corner : (y1 > k.bottom - k.corner ? k.bottom - k.corner : -1);
    if (cx >= 0 && cy >= 0) {
      const dx = x1 - cx, dy = y1 - cy, d2 = dx * dx + dy * dy, limit = k.corner - r;
      if ((limit < 0 || d2 > limit * limit) && (b.vx * dx + b.vy * dy > 0)) return 2;
    }
  }
  return 1;
}

// Returns 2 when swept contact needs 16x substeps, 1 when passive overlap / Sticky carrier needs 1x resolveContacts,
// and 0 when all bodies are in clean free flight (safe to skip resolveContacts entirely).
function classifyContactStep(bodies, count, std7, ball, skaterEnd, ballIdx, stdRink, preX, preY, preVx, preVy, hit, host) {
  let mode = host ? 1 : 0;
  for (let i = 0; i < count; i++) {
    const wm = bodyWallStepMode(bodies[i], preX[i], preY[i], stdRink);
    if (wm === 2) return 2;
    if (wm === 1) mode = 1;
  }
  for (let i = 0; i < skaterEnd; i++) {
    if (!std7 && i === ballIdx) continue;
    const a = bodies[i];
    if (a.carded) continue;
    const ax0 = preX[i], ay0 = preY[i], ax1 = a.x, ay1 = a.y, ar = a.radius;
    const avx0 = preVx[i], avy0 = preVy[i];
    for (let j = i + 1; j < skaterEnd; j++) {
      if (!std7 && j === ballIdx) continue;
      const c = bodies[j];
      if (c.carded) continue;
      if (a.team !== c.team && (a.superActive === 'ghost' || c.superActive === 'ghost')) continue;
      const reach = ar + c.radius;
      const dx0 = c.x - ax1, dy0 = c.y - ay1;
      const sx0 = preX[j] - ax0, sy0 = preY[j] - ay0;
      if ((sx0 > reach && dx0 > reach) || (sx0 < -reach && dx0 < -reach) ||
          (sy0 > reach && dy0 > reach) || (sy0 < -reach && dy0 < -reach)) continue;
      const r2 = reach * reach;
      if (segMinDist2(sx0, sy0, dx0, dy0) <= r2) {
        if (sx0 * sx0 + sy0 * sy0 > r2 ||
            (dx0 - sx0) * sx0 + (dy0 - sy0) * sy0 < 0 ||
            (preVx[j] - avx0) * sx0 + (preVy[j] - avy0) * sy0 < 0) return 2;
        mode = 1;
      }
    }
  }
  if (ball) {
    const bh = hit[ballIdx], bx0 = preX[ballIdx], by0 = preY[ballIdx], bx1 = ball.x, by1 = ball.y;
    const bvx0 = preVx[ballIdx], bvy0 = preVy[ballIdx];
    for (let i = 0; i < skaterEnd; i++) {
      if (!std7 && i === ballIdx) continue;
      const s = bodies[i];
      if (s.carded || s.holding) continue;
      const reach = hit[i] + bh;
      const sx0 = bx0 - preX[i], sy0 = by0 - preY[i];
      const dx1 = bx1 - s.x, dy1 = by1 - s.y;
      if ((sx0 > reach && dx1 > reach) || (sx0 < -reach && dx1 < -reach) ||
          (sy0 > reach && dy1 > reach) || (sy0 < -reach && dy1 < -reach)) continue;
      const r2 = reach * reach;
      if (segMinDist2(sx0, sy0, dx1, dy1) <= r2) {
        if (sx0 * sx0 + sy0 * sy0 > r2 ||
            (dx1 - sx0) * sx0 + (dy1 - sy0) * sy0 < 0 ||
            (bvx0 - preVx[i]) * sx0 + (bvy0 - preVy[i]) * sy0 < 0) return 2;
        mode = 1;
      }
    }
  }
  return mode;
}

function advanceBallHeatTick(ball, checkSustain = true) {
  if (ball && (ball.vx !== 0 || ball.vy !== 0 || ball.pace || ball.onFire || ball.fireTicks)) {
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    const share = ball.pace / BASE_LAUNCH_SPEED;
    if (ball.onFire) {
      if (checkSustain && share <= HEAT.sustain) { ball.onFire = false; ball.fireTicks = 0; }
    } else {
      if (share > HEAT.fire) ball.fireTicks = Math.min(FIRE_TICKS, (ball.fireTicks || 0) + 1);
      else if (share <= HEAT.sustain) ball.fireTicks = 0;
      if (ball.fireTicks >= FIRE_TICKS && speed > HEAT.fire * BASE_LAUNCH_SPEED) ball.onFire = true;
    }
  }
}

function integrateMotionAndFriction(bodies, dt, std7, ball, skaterEnd, host, spinDecay, drafts) {
  for (let i = 0; i < skaterEnd; i++) {
    const b = bodies[i];
    if (!std7 && b === ball) {
      if (host) continue;
      if (b.vx === 0 && b.vy === 0 && b.omega === 0) continue;
      if (b.omega !== 0) {
        if (b.vx !== 0 || b.vy !== 0) {
          const angle = b.omega * ballCurveFactor(b) * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = b.vx;
          b.vx = vx * cos - b.vy * sin; b.vy = vx * sin + b.vy * cos;
        }
        b.rotation += b.omega * dt;
        b.omega = Math.sign(b.omega) * Math.max(0, Math.abs(b.omega) - spinDecay * dt);
      }
      if (b.vx !== 0 || b.vy !== 0) { b.x += b.vx * dt; b.y += b.vy * dt; }
      continue;
    }
    if (b.vx === 0 && b.vy === 0 && b.omega === 0) continue;
    if (b.omega !== 0) {
      if (b.vx !== 0 || b.vy !== 0) {
        let curve;
        if (b.launchSpin && b.omega * b.launchSpin > 0) {
          curve = b.curveFactor ?? SKATER_CURVE;
        } else {
          const cm = b.curveMult || 1;
          curve = ((b.curveFactor ?? SKATER_CURVE) / cm) * TRUE_GLIDE.involuntaryCurve / (cm > 1 ? cm : 1);
        }
        const angle = b.omega * curve * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = b.vx;
        b.vx = vx * cos - b.vy * sin; b.vy = vx * sin + b.vy * cos;
      }
      b.rotation += b.omega * dt;
      b.omega = Math.sign(b.omega) * Math.max(0, Math.abs(b.omega) - spinDecay * dt);
    }
    if (b.vx !== 0 || b.vy !== 0) {
      b.x += b.vx * dt; b.y += b.vy * dt;
    }
  }
  if (std7 && !host && (ball.vx !== 0 || ball.vy !== 0 || ball.omega !== 0)) {
    if (ball.omega !== 0) {
      if (ball.vx !== 0 || ball.vy !== 0) {
        const angle = ball.omega * ballCurveFactor(ball) * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = ball.vx;
        ball.vx = vx * cos - ball.vy * sin; ball.vy = vx * sin + ball.vy * cos;
      }
      ball.rotation += ball.omega * dt;
      ball.omega = Math.sign(ball.omega) * Math.max(0, Math.abs(ball.omega) - spinDecay * dt);
    }
    if (ball.vx !== 0 || ball.vy !== 0) {
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    }
  }

  for (let i = 0; i < skaterEnd; i++) {
    const b = bodies[i];
    if (!std7 && b === ball) {
      if (host) {
        const off = b.stickOffset || { x: host.radius + b.radius, y: 0 };
        b.x = host.x + off.x; b.y = host.y + off.y;
        b.vx = host.vx; b.vy = host.vy; b.omega = host.omega;
      } else if (b.vx !== 0 || b.vy !== 0) {
        const speed2 = b.vx * b.vx + b.vy * b.vy, decel = (b.friction + AIR_DRAG * speed2) * dt;
        if (speed2 <= decel * decel) { b.vx = b.vy = 0; }
        else { const sp = Math.sqrt(speed2), f = Math.max(0, sp - decel) / sp; b.vx *= f; b.vy *= f; }
      }
      continue;
    }
    if (b.vx !== 0 || b.vy !== 0) {
      const draft = drafts ? drafts[i] : 0;
      const carrying = b.holding ? SUPER.carryFriction : (b.superActive === 'stalwart' ? SUPER.stalwartFriction : 1);
      const effFriction = draft > 0 ? b.friction * carrying * (1 - TAILGATE.frictionCut * draft) : b.friction * carrying;
      const speed2 = b.vx * b.vx + b.vy * b.vy, deceleration = effFriction * dt;
      if (speed2 <= deceleration * deceleration) {
        b.vx = b.vy = 0;
      } else {
        const speed = Math.sqrt(speed2);
        const factor = Math.max(0, speed - deceleration) / speed;
        b.vx *= factor; b.vy *= factor;
      }
    }
  }
  if (std7) {
    if (host) {
      const off = ball.stickOffset || { x: host.radius + ball.radius, y: 0 };
      ball.x = host.x + off.x; ball.y = host.y + off.y;
      ball.vx = host.vx; ball.vy = host.vy; ball.omega = host.omega;
    } else if (ball.vx !== 0 || ball.vy !== 0) {
      const speed2 = ball.vx * ball.vx + ball.vy * ball.vy, deceleration = (ball.friction + AIR_DRAG * speed2) * dt;
      if (speed2 <= deceleration * deceleration) {
        ball.vx = ball.vy = 0;
      } else {
        const speed = Math.sqrt(speed2);
        const factor = Math.max(0, speed - deceleration) / speed;
        ball.vx *= factor; ball.vy *= factor;
      }
    }
  }
  if (ball && (ball.vx !== 0 || ball.vy !== 0 || ball.pace)) {
    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy), pace = ball.pace || 0;
    ball.pace = Math.max(speed, pace - (ball.friction + AIR_DRAG * pace * pace) * dt);
  }
}

function resolveContacts(bodies, std7, ball, skaterEnd, count, ballIdx, stdRink, hit, host, onCollide, onWall, onShockwave, guardedOnSuper) {
  for (let pass = 0; pass < 3; pass++) {
    const resolvedBefore = getResolved();
    // 1. Skater-vs-skater contacts.
    for (let i = 0; i < skaterEnd; i++) {
      if (!std7 && i === ballIdx) continue;
      const a = bodies[i], ax = a.x, ay = a.y, ar = a.radius;
      for (let j = i + 1; j < skaterEnd; j++) {
        if (!std7 && j === ballIdx) continue;
        const c = bodies[j], reach = ar + c.radius;
        const dx = ax - c.x, dy = ay - c.y;
        if (dx * dx + dy * dy > reach * reach) continue;
        collide(a, c, onCollide, bodies, onShockwave, guardedOnSuper);
      }
    }
    // 2. Skater-vs-ball contacts.
    if (ball) {
      if (getResolved() !== resolvedBefore) {
        host = holder(bodies);
        if (std7) {
          for (let i = 0; i < 6; i++) {
            const s = bodies[i], r = s.radius, rc = s.reach || r, m = r >= rc ? r : rc;
            hit[i] = m >= 18 ? m : 18;
          }
        } else {
          for (let i = 0; i < count; i++) hit[i] = ballHitRadius(bodies[i]);
        }
      }
      const bh = hit[ballIdx];
      let firstIdx = -1, multi = null;
      for (let i = 0; i < skaterEnd; i++) {
        if (!std7 && i === ballIdx) continue;
        const s = bodies[i];
        if (s.carded || s.holding) continue;
        const reach = hit[i] + bh, dx = s.x - ball.x, dy = s.y - ball.y;
        if (dx * dx + dy * dy > reach * reach) continue;
        if (firstIdx < 0) firstIdx = i;
        else { (multi ??= [firstIdx]).push(i); }
      }
      if (multi && !host) {
        const stickyTeams = new Set();
        for (const idx of multi) if (bodies[idx].superActive === 'sticky') stickyTeams.add(bodies[idx].team);
        if (stickyTeams.size > 1) {
          for (const idx of multi) if (bodies[idx].superActive === 'sticky') { bodies[idx].superHit = true; endSuper(bodies[idx], bodies); }
        }
        const anySticky = multi.some(idx => bodies[idx].superActive === 'sticky');
        if (anySticky) {
          for (const idx of multi) {
            const a = idx < ballIdx ? bodies[idx] : ball, c = idx < ballIdx ? ball : bodies[idx];
            collide(a, c, onCollide, bodies, onShockwave, guardedOnSuper);
          }
        } else {
          let keBudget = bodyKE(ball);
          for (const idx of multi) keBudget += bodyKE(bodies[idx]);
          const ball0 = { ...ball };
          let sumDx = 0, sumDy = 0, sumDvx = 0, sumDvy = 0, sumDomega = 0;
          let energySource = false, anyFireOff = false, anyFireOn = false, maxPace = 0;
          const strikerTeams = new Set(), strikerSlots = new Set();
          let lastStrikerPower = ball0.strikerPower, lastStrikerSynergy = ball0.strikerSynergy ?? 1, lastCurveMult = ball0.curveMult;
          const collideEvents = [], ironSavers = [], superEvents = [];
          for (const idx of multi) {
            const s = bodies[idx], bClone = { ...ball0 };
            const a = idx < ballIdx ? s : bClone, c = idx < ballIdx ? bClone : s;
            const hadCannon = s.superActive === 'cannonball';
            const sDrive = (s.vx * (ball0.x - s.x) + s.vy * (ball0.y - s.y)) / (Math.hypot(ball0.x - s.x, ball0.y - s.y) || 1);
            if (hadCannon || (ballOnFire(ball0) && s.team === ball0.strikerTeam && sDrive > HOT_DRIVE.min)) energySource = true;
            collide(
              a, c,
              ev => {
                if (ev.iron) ironSavers.push(s);
                if (onCollide) collideEvents.push([ev.a === bClone ? ball : ev.a, ev.b === bClone ? ball : ev.b, ev.speed, ev.impulse, ev.plow, ev.iron, ev.checker, ev.snapped, ev.spinStruck, ev.tangentImpulse, ev.passerSlot, ev.struck]);
              },
              bodies,
              null,
              guardedOnSuper ? (k, act, sa, sb) => superEvents.push([k, act, sa === bClone ? ball : sa, sb === bClone ? ball : sb]) : null,
              true
            );
            sumDx += bClone.x - ball0.x; sumDy += bClone.y - ball0.y;
            sumDvx += bClone.vx - ball0.vx; sumDvy += bClone.vy - ball0.vy;
            sumDomega += bClone.omega - ball0.omega;
            if (ball0.onFire && !bClone.onFire) anyFireOff = true;
            if (!ball0.onFire && bClone.onFire) anyFireOn = true;
            if ((bClone.pace || 0) > maxPace) maxPace = bClone.pace || 0;
            if ((bClone.strikerTeam !== ball0.strikerTeam || bClone.strikerSlot !== (ball0.strikerSlot ?? -1)) && bClone.strikerTeam >= 0) {
              strikerTeams.add(bClone.strikerTeam);
              if (bClone.strikerSlot >= 0) strikerSlots.add(bClone.strikerSlot);
              lastStrikerPower = bClone.strikerPower;
              lastStrikerSynergy = bClone.strikerSynergy ?? 1;
              lastCurveMult = bClone.curveMult;
            }
          }
          ball.openingShot = false;
          ball.x = ball0.x + sumDx; ball.y = ball0.y + sumDy;
          ball.vx = ball0.vx + sumDvx; ball.vy = ball0.vy + sumDvy;
          ball.omega = Math.max(-24, Math.min(24, ball0.omega + sumDomega));
          if (!energySource) {
            let skaterKEAfter = 0;
            for (const idx of multi) skaterKEAfter += bodyKE(bodies[idx]);
            const maxBallKE = Math.max(0, keBudget - skaterKEAfter);
            const curBallKE = bodyKE(ball);
            if (curBallKE > maxBallKE && curBallKE > 0) {
              const scale = Math.sqrt(maxBallKE / curBallKE);
              ball.vx *= scale; ball.vy *= scale; ball.omega *= scale;
            }
          }
          if (anyFireOff && !anyFireOn) { ball.onFire = false; ball.fireTicks = 0; }
          else if (anyFireOn) { ball.onFire = true; ball.fireTicks = FIRE_TICKS; }
          if (strikerTeams.size === 1) {
            [ball.strikerTeam] = strikerTeams;
            ball.strikerSlot = strikerSlots.size === 1 ? [...strikerSlots][0] : -1;
            ball.strikerPower = lastStrikerPower;
            ball.strikerSynergy = lastStrikerSynergy;
            ball.curveMult = lastCurveMult;
          } else if (strikerTeams.size > 1) {
            clearStriker(ball);
          }
          const postSpeed = Math.hypot(ball.vx, ball.vy);
          ball.pace = strikerTeams.size === 1 && ball.strikerTeam === ball0.strikerTeam ? Math.max(postSpeed, maxPace) : postSpeed;
          for (const saver of ironSavers) {
            hit[bodies.indexOf(saver)] = ballHitRadius(saver);
            triggerIronShockwave(saver, bodies, onShockwave);
          }
          for (const args of superEvents) guardedOnSuper(...args);
          for (const args of collideEvents) emitCollide(onCollide, ...args);
        }
      } else if (multi && host) {
        for (const idx of multi) {
          const a = idx < ballIdx ? bodies[idx] : ball, c = idx < ballIdx ? ball : bodies[idx];
          collide(a, c, onCollide, bodies, onShockwave, guardedOnSuper);
        }
      } else if (firstIdx >= 0) {
        const a = firstIdx < ballIdx ? bodies[firstIdx] : ball, c = firstIdx < ballIdx ? ball : bodies[firstIdx];
        collide(a, c, onCollide, bodies, onShockwave, guardedOnSuper);
      }
    }
    if (getResolved() !== resolvedBefore) {
      if (std7) {
        for (let i = 0; i < 6; i++) {
          const s = bodies[i], r = s.radius, rc = s.reach || r, m = r >= rc ? r : rc;
          hit[i] = m >= 18 ? m : 18;
        }
      } else {
        for (let i = 0; i < count; i++) hit[i] = ballHitRadius(bodies[i]);
      }
    }
    for (let i = 0; i < skaterEnd; i++) {
      const b = bodies[i];
      if (!std7 && b.team === -1) continue;
      const r = b.radius;
      if (!stdRink || r > 90 || b.x < 150 || b.x > 850 || b.y < 60 + r || b.y > 540 - r) walls(b, onWall);
    }
    if (ball) {
      if (getResolved() !== resolvedBefore) host = holder(bodies);
      if (host) {
        const off = ball.stickOffset || { x: host.radius + ball.radius, y: 0 };
        const ex = host.x + off.x, ey = host.y + off.y;
        ball.x = ex; ball.y = ey;
        ball.vx = host.vx; ball.vy = host.vy; ball.omega = host.omega;
        walls(ball, onWall, host);
        const dx = ball.x - ex, dy = ball.y - ey;
        if (dx !== 0 || dy !== 0) {
          if (host.superActive !== 'stalwart') {
            host.x += dx; host.y += dy;
            host.vx = ball.vx; host.vy = ball.vy;
            walls(host, onWall);
          }
          const ox = ball.x - host.x, oy = ball.y - host.y, od = Math.hypot(ox, oy) || 1;
          const td = host.radius + ball.radius;
          ball.stickOffset = { x: (ox / od) * td, y: (oy / od) * td };
          ball.x = host.x + ball.stickOffset.x;
          ball.y = host.y + ball.stickOffset.y;
          walls(ball, onWall, host);
        }
      } else {
        const br = ball.radius;
        if (!stdRink || br > 90 || ball.x < 150 || ball.x > 850 || ball.y < 60 + br || ball.y > 540 - br) walls(ball, onWall);
      }
    }
    if (getResolved() === resolvedBefore) break;
  }
  return host;
}

function checkGoal(ball) {
  if (!ball) return null;
  const inGoalY = ball.y >= rink.goalTop && ball.y <= rink.goalBottom;
  if (inGoalY) {
    if (ball.x - ball.radius <= rink.left - rink.goalDepth + 1 || ball.x + ball.radius < rink.left) return 1;
    if (ball.x + ball.radius >= rink.right + rink.goalDepth - 1 || ball.x - ball.radius > rink.right) return 0;
  }
  return null;
}

function step(bodies, dt = DT, onCollide = null, onWall = null, onShockwave = null, onSuper = null) {
  let hasStalwart = false;
  if (onSuper) {
    for (let i = 0; i < bodies.length; i++) {
      if (bodies[i].team >= 0 && bodies[i].superActive === 'stalwart') { hasStalwart = true; break; }
    }
  }
  let stalwartHits = 0;
  const guardedOnSuper = !onSuper ? null : (!hasStalwart ? onSuper : (key, action, a, b) => {
    if (key === 'stalwart' && action === 'impact') {
      const bit = 1 << ((bodies.indexOf(a) * 6 + bodies.indexOf(b)) & 30);
      if (stalwartHits & bit) return;
      stalwartHits |= bit;
    }
    onSuper(key, action, a, b);
  });

  const count = bodies.length;
  const std7 = count === 7 && bodies[6].team === -1;
  const ball = std7 ? bodies[6] : bodies.find(b => b.team === -1);
  const skaterEnd = std7 ? 6 : count;

  if (ball && ball.openingShot) {
    let touching = 0, b = null;
    const br = ball.radius;
    for (let i = 0; i < skaterEnd; i++) {
      const other = bodies[i];
      if (!std7 && other.team < 0) continue;
      if (!other.carded) {
        const dx = other.x - ball.x, dy = other.y - ball.y, lim = ballHitRadius(other) + br;
        if (dx * dx + dy * dy <= lim * lim) { touching++; b = other; }
      }
    }
    if (touching > 1 || (touching === 1 && !b.spinStrike)) ball.openingShot = false;
    if (touching === 1) {
      if ((ball.vx - b.vx) * (ball.x - b.x) + (ball.vy - b.vy) * (ball.y - b.y) >= 0) ball.openingShot = false;
    }
  }

  let host = null, hasMagnet = false, hasShockwave = false, hasTimedSuper = false;
  for (let i = 0; i < skaterEnd; i++) {
    const b = bodies[i];
    if (!std7 && b.team < 0) continue;
    if (b.holding && !host) host = b;
    if (b.ironCooldownTicks > 0) b.ironCooldownTicks--;
    const sa = b.superActive;
    if (sa) {
      if (sa === 'magnet') hasMagnet = true;
      if (sa === 'shockwave') hasShockwave = true;
      if (b.superTicks > 0) hasTimedSuper = true;
    }
  }
  if (!ball) host = null;

  if (ball && !host && hasMagnet) {
    const magR2 = SUPER.magnetRadius * SUPER.magnetRadius;
    for (let i = 0; i < skaterEnd; i++) {
      const b = bodies[i];
      if (!std7 && b.team < 0) continue;
      if (!b.carded && b.superActive === 'magnet') {
        const dx = b.x - ball.x, dy = b.y - ball.y, d2 = dx * dx + dy * dy;
        const minDist = b.radius + ball.radius;
        if (d2 > minDist * minDist && d2 < magR2) {
          const d = Math.sqrt(d2);
          b.superHit = true;
          const pull = SUPER.magnetPull * (1 - d / SUPER.magnetRadius), before = Math.hypot(ball.vx, ball.vy);
          ball.vx += (dx / d) * pull * dt;
          ball.vy += (dy / d) * pull * dt;
          if (b.team !== ball.strikerTeam) countSlowing(ball, before);
          onSuper?.('magnet', 'pull', b);
        }
      }
    }
  }

  if (hasTimedSuper) {
    hasShockwave = false;
    for (let i = 0; i < skaterEnd; i++) {
      const b = bodies[i];
      if (!std7 && b.team < 0) continue;
      if (!b.superActive || !b.superTicks) continue;
      if (--b.superTicks > 0) {
        if (b.superActive === 'shockwave') hasShockwave = true;
        if (b.superActive === 'colossus' && b.radius < Math.max(b.baseRadius ?? b.radius, SUPER.colossusRadius)) syncEffectiveStats(b);
        continue;
      }
      endSuper(b, bodies);
      if (b === host) host = null;
    }
  }

  if (hasShockwave) {
    const shockR2 = SUPER.shockRadius * SUPER.shockRadius;
    for (let i = 0; i < skaterEnd; i++) {
      const b = bodies[i];
      if (!std7 && b.team < 0) continue;
      if (b.superActive === 'shockwave') {
        let nInRange = 0;
        for (let j = 0; j < skaterEnd; j++) {
          const opp = bodies[j];
          if (!std7 && opp.team < 0) continue;
          if (opp.team !== b.team && !opp.carded && opp.superActive !== 'stalwart') {
            const dx = opp.x - b.x, dy = opp.y - b.y, d2 = dx * dx + dy * dy;
            if (d2 > 0 && d2 < shockR2) {
              shockOpp[nInRange] = opp;
              shockD[nInRange] = Math.sqrt(d2);
              shockDx[nInRange] = dx;
              shockDy[nInRange] = dy;
              nInRange++;
            }
          }
        }
        if (!b.shockwaveFired) {
          if (nInRange > 0) {
            b.shockwaveFired = true;
            b.superHit = true;
            const radius = SUPER.shockRadius;
            for (let k = 0; k < nInRange; k++) {
              const opp = shockOpp[k], d = shockD[k];
              const force = (1 - d / radius) * SUPER.shockForce;
              const m = opp.mass || 1;
              opp.vx += (shockDx[k] / d) * force / m;
              opp.vy += (shockDy[k] / d) * force / m;
            }
            if (typeof onShockwave === 'function') onShockwave(b, radius);
          }
        } else {
          for (let k = 0; k < nInRange; k++) {
            const opp = shockOpp[k], d = shockD[k];
            const repel = SUPER.shockRepel * (1 - d / SUPER.shockRadius);
            opp.vx += (shockDx[k] / d) * repel * dt;
            opp.vy += (shockDy[k] / d) * repel * dt;
          }
        }
        for (let k = 0; k < nInRange; k++) shockOpp[k] = null;
      }
    }
  }

  if (host && ++ball.stuckTicks >= (host.superHoldTicks || SUPER.holdTicks)) { endSuper(host, bodies); host = null; }

  let spinDecay = SPIN_DECAY;
  if (!hasMagnet) {
    let allSlow = true;
    for (let j = 0; j < skaterEnd; j++) {
      const o = bodies[j];
      if (!std7 && o.team < 0) continue;
      if (o.vx * o.vx + o.vy * o.vy >= 4) { allSlow = false; break; }
    }
    if (allSlow && ball && ball.vx * ball.vx + ball.vy * ball.vy >= 4) allSlow = false;
    if (allSlow) spinDecay = SETTLED_SPIN_DECAY;
  }

  let drafts = null;
  if (dt > 0) {
    let leadCount = 0, followCount = 0;
    const pureSkaters = std7 || !ball;
    if (pureSkaters && skaterEnd <= 8) {
      for (let i = 0; i < skaterEnd; i++) {
        const b = bodies[i];
        if (!b.carded) {
          const v2 = b.vx * b.vx + b.vy * b.vy;
          scratchV2[i] = v2;
          scratchSpeed[i] = 0;
          if (v2 >= TAILGATE_MIN_FOLLOW2) {
            followCount++;
            if (v2 >= TAILGATE_MIN_LEAD2) leadCount++;
          }
        } else {
          scratchV2[i] = 0;
        }
      }
      if (leadCount > 0 && followCount >= 2) {
        drafts = spareDrafts && spareDrafts.length >= count ? spareDrafts : new Float64Array(count);
        spareDrafts = null;
        for (let i = 0; i < skaterEnd; i++) {
          drafts[i] = scratchV2[i] >= TAILGATE_MIN_FOLLOW2 ? skaterDraftAt(bodies, skaterEnd, i, bodies[i]) : 0;
        }
      }
    } else {
      for (let i = 0; i < count; i++) {
        const b = bodies[i];
        if (b.team >= 0 && !b.carded) {
          const v2 = b.vx * b.vx + b.vy * b.vy;
          if (v2 >= TAILGATE_MIN_FOLLOW2) {
            followCount++;
            if (v2 >= TAILGATE_MIN_LEAD2) leadCount++;
          }
        }
      }
      if (leadCount > 0 && followCount >= 2) {
        drafts = spareDrafts && spareDrafts.length >= count ? spareDrafts : new Float64Array(count);
        spareDrafts = null;
        for (let i = 0; i < count; i++) {
          const b = bodies[i];
          drafts[i] = (b.team >= 0 && !b.carded && b.vx * b.vx + b.vy * b.vy >= TAILGATE_MIN_FOLLOW2) ? tailgateFactor(bodies, b) : 0;
        }
      }
    }
  }

  const hit = spareRadii && spareRadii.length >= count ? spareRadii : new Float64Array(count);
  spareRadii = null;
  if (std7) {
    for (let i = 0; i < 6; i++) {
      const s = bodies[i], r = s.radius, rc = s.reach || r, m = r >= rc ? r : rc;
      hit[i] = m >= 18 ? m : 18;
    }
    hit[6] = ball.radius >= 18 ? ball.radius : 18;
  } else {
    for (let i = 0; i < count; i++) hit[i] = ballHitRadius(bodies[i]);
  }
  const ballIdx = ball ? (std7 ? 6 : bodies.indexOf(ball)) : -1;
  const stdRink = rink.left === 60 && rink.right === 940 && rink.top === 60 && rink.bottom === 540 && rink.corner === 100;

  const doAdaptive = dt >= DT * 0.99;
  let pre = null, preX = null, preY = null, preVx = null, preVy = null, preOmega = null, preRot = null, preBallPace = 0;
  if (doAdaptive) {
    pre = sparePre && sparePre.x.length >= count ? sparePre : {
      x: new Float64Array(count), y: new Float64Array(count),
      vx: new Float64Array(count), vy: new Float64Array(count),
      omega: new Float64Array(count), rot: new Float64Array(count)
    };
    sparePre = null;
    preX = pre.x; preY = pre.y; preVx = pre.vx; preVy = pre.vy; preOmega = pre.omega; preRot = pre.rot;
    for (let i = 0; i < count; i++) {
      const b = bodies[i];
      preX[i] = b.x; preY[i] = b.y; preVx[i] = b.vx; preVy[i] = b.vy; preOmega[i] = b.omega; preRot[i] = b.rotation;
    }
    if (ball) preBallPace = ball.pace || 0;
  }

  integrateMotionAndFriction(bodies, dt, std7, ball, skaterEnd, host, spinDecay, drafts);

  let goal = null;
  const stepMode = doAdaptive
    ? classifyContactStep(bodies, count, std7, ball, skaterEnd, ballIdx, stdRink, preX, preY, preVx, preVy, hit, host)
    : 1;
  if (stepMode === 2) {
    for (let i = 0; i < count; i++) {
      const b = bodies[i];
      b.x = preX[i]; b.y = preY[i]; b.vx = preVx[i]; b.vy = preVy[i]; b.omega = preOmega[i]; b.rotation = preRot[i];
    }
    if (ball) ball.pace = preBallPace;
    const subDt = dt / SUBSTEPS;
    const resAtTickStart = getResolved();
    for (let sub = 0; sub < SUBSTEPS; sub++) {
      integrateMotionAndFriction(bodies, subDt, std7, ball, skaterEnd, host, spinDecay, drafts);
      if (ball && ball.onFire && getResolved() === resAtTickStart && goal === null) {
        if (ball.pace / BASE_LAUNCH_SPEED <= HEAT.sustain) { ball.onFire = false; ball.fireTicks = 0; }
      }
      if (sub === SUBSTEPS - 1 && (!ball || !ball.onFire)) {
        advanceBallHeatTick(ball, false);
      }
      host = resolveContacts(bodies, std7, ball, skaterEnd, count, ballIdx, stdRink, hit, host, onCollide, onWall, onShockwave, guardedOnSuper);
      if (goal === null && ball) goal = checkGoal(ball);
    }
  } else {
    advanceBallHeatTick(ball, true);
    if (stepMode === 1) {
      resolveContacts(bodies, std7, ball, skaterEnd, count, ballIdx, stdRink, hit, host, onCollide, onWall, onShockwave, guardedOnSuper);
    }
    if (ball && (!stdRink || ball.x < 78 || ball.x > 922)) goal = checkGoal(ball);
  }

  if (pre) sparePre = pre;
  if (drafts) spareDrafts = drafts;
  spareRadii = hit;
  return goal;
}


module.exports = { step };
