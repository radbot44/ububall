/* Goal-pocket geometry, incoming shot threat tracing, moving-defender aperture, and crease legality. */
'use strict';
const { P, M, RINK, RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, RINK_CX, RINK_CY, GOAL_Y_TOP, GOAL_Y_BOT, contactRadius, segmentBlocked, behindBall, roles
} = require('./constants.js');
const { aim, ballTraceKey, traceMovingBall, skaterTravelTime } = require('./kinematics.js');

const GOAL_APERTURE_YS = [RINK_CY, RINK_CY - 28, RINK_CY + 28, RINK_CY - 50, RINK_CY + 50];
const SAFE_SHOT_YS = [RINK_CY, RINK_CY - 28, RINK_CY + 28, GOAL_Y_TOP + 21, GOAL_Y_BOT - 21];

function shotConePoint(ballX, ballY, team, dist = 88) {
  const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
  const dir = team ? -1 : 1;
  const coverX = ownGoalX + dir * dist;
  const spanX = Math.abs(ballX - ownGoalX);
  let rawY;
  if (spanX > dist) {
    const t = dist / spanX;
    rawY = RINK_CY + (ballY - RINK_CY) * Math.min(0.85, t * 1.05);
  } else {
    rawY = RINK_CY + (ballY - RINK_CY) * 0.45;
  }
  const y = Math.max(RINK_CY - 42, Math.min(RINK_CY + 42, rawY));
  return { x: coverX, y };
}

// Legal single-goalie crease pocket: 1 defender in the 80 px crease never triggers M.camping unless warned or joined by a 2nd defender.
function canOccupyCrease(state, team, keepIdx) {
  if (state.fouls?.crease?.[team]) return false;
  const ownStart = team * 3;
  const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
  let oppAZ = 0;
  const oppStart = (1 - team) * 3;
  const azLine = M.attackZoneLine(P, team);
  for (let i = 0; i < 3; i++) {
    const op = state.bodies[oppStart + i];
    if (!op.carded && (team ? op.x > azLine : op.x < azLine)) oppAZ++;
  }
  const allowance = oppAZ > 1 ? oppAZ : 1;
  let othersNearCrease = 0;
  for (let i = 0; i < 3; i++) {
    if (i === keepIdx) continue;
    const b = state.bodies[ownStart + i];
    if (b.carded || b.superActive === 'stalwart') continue;
    const projX = b.x + (b.vx || 0) * 0.22;
    const projY = b.y + (b.vy || 0) * 0.22;
    if (Math.hypot(b.x - ownGoalX, b.y - RINK_CY) < 106 || Math.hypot(projX - ownGoalX, projY - RINK_CY) < 96) {
      othersNearCrease++;
    }
  }
  return othersNearCrease < allowance;
}

function goalPocketPoint(ballX, ballY, team, allowCrease = true) {
  if (!allowCrease) return shotConePoint(ballX, ballY, team, 88);
  const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
  const dir = team ? -1 : 1;
  const dist = 44;
  const coverX = ownGoalX + dir * dist;
  const spanX = Math.max(dist, Math.abs(ballX - ownGoalX));
  const t = dist / spanX;
  const rawY = RINK_CY + (ballY - RINK_CY) * Math.min(0.65, t * 1.15);
  const y = Math.max(RINK_CY - 36, Math.min(RINK_CY + 36, rawY));
  return { x: coverX, y };
}

// Compute a realistic flat-wall bank target toward goalX accounting for 0.82 wall restitution, wall-grip slowdown, and 100px corners.
function bestBankTargetY(ball, goalX, goalieY = RINK_CY, blockers = []) {
  const ballR = ball.radius || 18;
  const cornerOff = RINK.corner ?? 100;
  const flatMinX = RINK_LEFT + cornerOff + 12;
  const flatMaxX = RINK_RIGHT - cornerOff - 12;
  const topWallY = RINK_TOP + ballR;
  const botWallY = RINK_BOTTOM - ballR;
  const goalYTop = goalieY <= RINK_CY ? RINK_CY + 30 : RINK_CY + 20;
  const goalYBot = goalieY >= RINK_CY ? RINK_CY - 30 : RINK_CY - 20;
  // Cold rebounds lose normal speed (0.82) AND tangential speed via wall grip (~0.73x), steepening the outgoing angle.
  // Aiming steeper into the flat wall (~1.36x virtual depth) places bounceX cleanly inside [flatMinX, flatMaxX].
  const bankSteep = ball.onFire ? 1.06 : 1.36;
  const candidates = [
    { wallY: topWallY, refY: topWallY + (topWallY - goalYTop) * bankSteep, goalY: goalYTop, side: -1 },
    { wallY: botWallY, refY: botWallY + (botWallY - goalYBot) * bankSteep, goalY: goalYBot, side: 1 }
  ];
  if (ball.y > RINK_CY) candidates.reverse();
  let fallback = null;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const dyTotal = c.refY - ball.y;
    if (Math.abs(dyTotal) < 20) continue;
    const tWall = (c.wallY - ball.y) / dyTotal;
    if (tWall <= 0.08 || tWall >= 0.88) continue;
    const bounceX = ball.x + tWall * (goalX - ball.x);
    if (bounceX < flatMinX || bounceX > flatMaxX) continue;
    if (!fallback) fallback = { bankY: c.refY, wallSide: c.side, bounceX, wallY: c.wallY, goalY: c.goalY };
    const leg1 = segmentBlocked(ball.x, ball.y, bounceX, c.wallY, blockers, ballR + 3);
    const leg2 = segmentBlocked(bounceX, c.wallY, goalX, c.goalY, blockers, ballR + 3);
    if (!leg1 && !leg2) return { bankY: c.refY, wallSide: c.side, bounceX, wallY: c.wallY, goalY: c.goalY, clear: true };
  }
  return fallback ? { ...fallback, clear: false } : null;
}

// Compute a time-matched intercept move for a goalie against an already-moving incoming shot.
function timedGoalieIntercept(body, ball, incoming, team, allowCrease, superKey = null) {
  const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
  const maxV = P.launchSpeed(body);
  const fric = body.friction || 150;
  const samples = traceMovingBall(ball);
  if (samples && samples.length) {
    const maxDistFromGoal = allowCrease ? 115 : 155;
    const minDistFromGoal = allowCrease ? 24 : 84;
    let bestPt = null, bestScore = Infinity;
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = samples[i];
      const dg = Math.abs(s.x - ownGoalX);
      if (dg < minDistFromGoal || dg > maxDistFromGoal) continue;
      if (s.y < GOAL_Y_TOP - 32 || s.y > GOAL_Y_BOT + 32) continue;
      const dist = Math.hypot(s.x - body.x, s.y - body.y);
      const tFast = skaterTravelTime(dist, maxV, fric);
      if (tFast <= s.t + 0.03) {
        const score = dist + Math.max(0, dg - 55) * 0.4;
        if (score < bestScore) {
          bestScore = score;
          bestPt = s;
        }
      }
    }
    if (bestPt) {
      const dist = Math.hypot(bestPt.x - body.x, bestPt.y - body.y);
      const tStop = skaterTravelTime(dist, Math.min(maxV, Math.sqrt(2 * fric * dist)), fric);
      const needDrive = tStop <= bestPt.t - 0.03 ? 0 : Math.min(240, Math.max(40, dist * 1.6));
      return aim(body, bestPt.x, bestPt.y, needDrive, superKey, 0);
    }
  }
  const tx = allowCrease ? incoming.lineX : (ownGoalX + (team ? -88 : 88));
  const ty = incoming.lineY;
  const dist = Math.hypot(tx - body.x, ty - body.y);
  const tStop = skaterTravelTime(dist, Math.min(maxV, Math.sqrt(2 * fric * dist)), fric);
  const needDrive = tStop <= incoming.time - 0.04 ? 0 : Math.min(260, Math.max(60, dist * 1.8));
  return aim(body, tx, ty, needDrive, superKey, 0);
}

const incomingCache = new WeakMap();
// Exact canonical 1-body physics trace of an already-moving loose ball (including spin curve, flat walls, curved corners & posts).
function traceIncomingShot(ball, team, maxHorizon = 1.2) {
  if (!ball || ball.stickOffset) return null;
  const vx0 = ball.vx || 0, vy0 = ball.vy || 0;
  if (vx0 * vx0 + vy0 * vy0 < 2025) return null;
  let entry = incomingCache.get(ball);
  const maxTicks = Math.min(300, Math.round(maxHorizon / P.DT));
  const sig = ballTraceKey(ball) + ',' + maxTicks;
  if (!entry || entry.sig !== sig) {
    entry = { sig, t0: undefined, t1: undefined };
    incomingCache.set(ball, entry);
  }
  const slot = team ? 't1' : 't0';
  if (entry[slot] !== undefined) return entry[slot];

  const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
  if (team ? (vx0 < -120 && Math.abs(ball.x - ownGoalX) > 260) : (vx0 > 120 && Math.abs(ball.x - ownGoalX) > 260)) {
    entry[slot] = null;
    return null;
  }
  const sim = [{ ...ball, team: -1, stickOffset: null }];
  const bSim = sim[0];
  let bounces = 0, prevX = bSim.x, prevY = bSim.y;
  const onWall = (_b, _v, type) => { if (type === 'wall' || type === 'post') bounces++; };
  let out = null;
  for (let t = 1; t <= maxTicks; t++) {
    prevX = bSim.x; prevY = bSim.y;
    const goal = P.step(sim, P.DT, null, onWall);
    if (goal !== null) {
      if (goal === 1 - team) {
        const dir = team ? -1 : 1;
        const yCross = Math.max(GOAL_Y_TOP + 18, Math.min(GOAL_Y_BOT - 18, bSim.y));
        const slope = (bSim.y - prevY) / ((bSim.x - prevX) || -dir);
        const lineX = ownGoalX + dir * 28, midX = ownGoalX + dir * 56;
        const lineY = Math.max(GOAL_Y_TOP + 20, Math.min(GOAL_Y_BOT - 20, yCross + slope * (lineX - bSim.x)));
        const midY = Math.max(GOAL_Y_TOP + 16, Math.min(GOAL_Y_BOT - 16, yCross + slope * (midX - bSim.x)));
        out = { crosses: true, y: yCross, time: t * P.DT, bounces, lineX, lineY, midX, midY };
      }
      break;
    }
    if (!bSim.vx && !bSim.vy) break;
  }
  if (!out && Math.abs(bSim.x - ownGoalX) < 92 && bSim.y >= GOAL_Y_TOP - 16 && bSim.y <= GOAL_Y_BOT + 16) {
    const dir = team ? -1 : 1;
    const clampY = Math.max(GOAL_Y_TOP + 20, Math.min(GOAL_Y_BOT - 20, bSim.y));
    out = { crosses: false, y: clampY, time: maxHorizon, bounces, lineX: ownGoalX + dir * 34, lineY: clampY, midX: ownGoalX + dir * 58, midY: clampY };
  }
  entry[slot] = out;
  return out;
}

function guardReachRadius(body) {
  const baseR = body.baseRadius ?? body.radius ?? 25;
  const baseReach = body.baseReach ?? body.reach ?? baseR;
  const guardCap = Math.max(37.5, baseR * 1.25);
  return Math.max(baseR, Math.min(guardCap, baseReach * 1.25), 18);
}

function guardCoversSegment(body, ax, ay, bx, by, ballR = 18, margin = 3) {
  const gx = body.x + (body.vx || 0) * 0.06;
  const gy = body.y + (body.vy || 0) * 0.06;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  if (len2 < 1) return false;
  const t = Math.max(0, Math.min(1, ((gx - ax) * dx + (gy - ay) * dy) / len2));
  if (t <= 0.03 || t >= 0.99) return false;
  const dist = Math.hypot(gx - (ax + t * dx), gy - (ay + t * dy));
  return dist <= guardReachRadius(body) + ballR - margin;
}

function assessOpponentThreat(state, team, classic = false) {
  const oppTeam = 1 - team, oppStart = oppTeam * 3, ownStart = team * 3;
  const ball = state.bodies[6];
  const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
  const atkGoalX = RINK_LEFT + RINK_RIGHT - ownGoalX;
  const oppJobs = roles(state, oppTeam);
  const ownJobs = roles(state, team);
  const ownDefIdx = ownJobs.indexOf('defend');
  const incoming = traceIncomingShot(ball, team);
  const bSpd = !ball.stickOffset ? Math.hypot(ball.vx || 0, ball.vy || 0) : 0;
  let leadBalls = null;
  if (bSpd > 35) {
    const samples = traceMovingBall(ball);
    if (samples && samples.length) {
      const s1 = samples[Math.min(samples.length - 1, 21)];
      const s2 = samples.length > 42 ? samples[42] : null;
      leadBalls = s2 ? [s1, s2] : [s1];
    } else {
      leadBalls = [{
        t: 0.18,
        x: Math.max(RINK_LEFT + 28, Math.min(RINK_RIGHT - 28, ball.x + (ball.vx || 0) * 0.18)),
        y: Math.max(RINK_TOP + 28, Math.min(RINK_BOTTOM - 28, ball.y + (ball.vy || 0) * 0.18))
      }];
    }
  }

  let oppCarrier = null, oppStriker = null, oppStrikerIdx = -1, bestOppT = Infinity;
  let fireballThreat = Boolean(ball.onFire);

  for (let i = 0; i < 3; i++) {
    const op = state.bodies[oppStart + i];
    if (op.carded || op.stunned) continue;
    if (op.holding && !oppCarrier) oppCarrier = op;
    if (oppJobs[i] === 'defend' && Math.abs(op.x - atkGoalX) < 165 && Math.abs(ball.x - atkGoalX) < 340) continue;
    const opSup = (!classic && (op.meter ?? 0) >= 100 && op.equippedSuper) ? op.equippedSuper.key?.toLowerCase() : null;
    const behNow = behindBall(op, ball, oppTeam);
    const dNow = Math.max(0, Math.hypot(op.x - ball.x, op.y - ball.y) - contactRadius(op) - (ball.radius || 18));
    let behLead = false, dLead = dNow;
    if (leadBalls) {
      for (let li = 0; li < leadBalls.length; li++) {
        const lb = leadBalls[li];
        const dl = Math.max(0, Math.hypot(op.x - lb.x, op.y - lb.y) - contactRadius(op) - (ball.radius || 18));
        if (behindBall(op, lb, oppTeam) && (!behLead || dl < dLead)) {
          behLead = true;
          dLead = dl;
        }
      }
    }
    const sideAngleOk = (oppTeam === 0 ? op.x <= ball.x + 42 : op.x >= ball.x - 42) && dNow < 150;
    const magnetPullOk = opSup === 'magnet' && dNow < 210;
    if (behNow || behLead || sideAngleOk || magnetPullOk) {
      const effD = behLead && !behNow ? dLead : Math.min(dNow, dLead);
      const penalty = (behNow || behLead) ? 0 : 0.05;
      const t = effD / Math.max(200, P.launchSpeed(op)) + penalty;
      if (t < bestOppT) {
        bestOppT = t;
        oppStriker = op;
        oppStrikerIdx = i;
      }
      if (effD < 320 && (opSup === 'cannonball' || (op.power || 1) >= 1.18)) fireballThreat = true;
    }
  }

  let bestOwnT = Infinity, bestOwnNonDefT = Infinity, bestOwnBehindNonDefT = Infinity;
  for (let i = 0; i < 3; i++) {
    const ob = state.bodies[ownStart + i];
    if (ob.carded || ob.stunned) continue;
    const d = Math.max(0, Math.hypot(ob.x - ball.x, ob.y - ball.y) - contactRadius(ob) - (ball.radius || 18));
    const rawT = d / Math.max(200, P.launchSpeed(ob));
    const isBeh = behindBall(ob, ball, team);
    const t = rawT + (isBeh ? 0 : 0.06);
    if (t < bestOwnT) bestOwnT = t;
    if (i !== ownDefIdx) {
      if (t < bestOwnNonDefT) bestOwnNonDefT = t;
      if (isBeh && rawT < bestOwnBehindNonDefT) bestOwnBehindNonDefT = rawT;
    }
  }

  const distToOwnGoal = Math.abs(ball.x - ownGoalX);
  const pressingTheirZone = Math.abs(ball.x - atkGoalX) < 380 && bestOwnNonDefT < bestOppT;
  const weClearFirst = distToOwnGoal < 185 && bestOwnBehindNonDefT + 0.06 < bestOppT;
  const strikerSuper = (oppStriker && !classic && (oppStriker.meter ?? 0) >= 100 && oppStriker.equippedSuper)
    ? oppStriker.equippedSuper.key?.toLowerCase()
    : null;
  const maxShotRange = (strikerSuper === 'cannonball' || (oppStriker && (oppStriker.power || 1) >= 1.15)) ? 720 : 640;
  const oppFirstToBall = Boolean(oppStriker) && bestOppT <= bestOwnNonDefT + 0.08 && bestOppT <= bestOwnT + 0.06;
  const canShootThisTurn = !pressingTheirZone && !weClearFirst && Boolean(oppStriker) && bestOppT < 0.58 &&
    distToOwnGoal <= maxShotRange && bestOppT <= bestOwnNonDefT + 0.24;

  let oppReceiver = null, oppReceiverIdx = -1, bestRecvScore = Infinity;
  if (oppStriker && !pressingTheirZone && !weClearFirst) {
    for (let i = 0; i < 3; i++) {
      if (i === oppStrikerIdx) continue;
      const mate = state.bodies[oppStart + i];
      if (mate.carded || mate.stunned) continue;
      const dGoal = Math.abs(mate.x - ownGoalX);
      const crossSep = Math.abs(mate.y - ball.y);
      if (dGoal > 95 && dGoal < 460 && crossSep > 95) {
        const score = dGoal - crossSep * 0.35;
        if (score < bestRecvScore) {
          bestRecvScore = score;
          oppReceiver = mate;
          oppReceiverIdx = i;
        }
      }
    }
  }

  return {
    incoming,
    oppCarrier,
    oppStriker,
    oppStrikerIdx,
    oppReceiver,
    oppReceiverIdx,
    bestOppT,
    bestOwnT,
    bestOwnNonDefT,
    oppFirstToBall,
    distToOwnGoal,
    pressingTheirZone,
    weClearFirst,
    fireballThreat,
    shotDanger: Boolean(incoming || oppCarrier || canShootThisTurn)
  };
}

const projOpponentsBuf = [
  { x: 0, y: 0, radius: 25, carded: false, body: null },
  { x: 0, y: 0, radius: 25, carded: false, body: null },
  { x: 0, y: 0, radius: 25, carded: false, body: null }
];

// Scans open goal lanes against velocity-projected defenders (~0.18s lead + goalie crease recovery),
// keeping corner targets >= 21 px inside posts so shots never clip the 18 px post circle.
function scanGoalAperture(ball, goalX, opponents) {
  const nOpp = Math.min(3, opponents.length);
  const tFlight = Math.min(0.22, Math.max(0.10, Math.abs(goalX - ball.x) / 1500));
  for (let i = 0; i < nOpp; i++) {
    const op = opponents[i], slot = projOpponentsBuf[i];
    slot.body = op;
    slot.carded = Boolean(op.carded);
    slot.radius = op.guarding ? guardReachRadius(op) : (op.radius || 25);
    if (op.carded) { slot.x = op.x; slot.y = op.y; continue; }
    const vx = op.vx || 0, vy = op.vy || 0;
    let px = Math.max(RINK_LEFT + 25, Math.min(RINK_RIGHT - 25, op.x + vx * tFlight));
    let py = Math.max(RINK_TOP + 25, Math.min(RINK_BOTTOM - 25, op.y + vy * tFlight));
    // Anticipate un-stunned goalie sliding partway toward the shot-cone Y when out of position
    if (!op.stunned && !op.guarding && Math.abs(op.x - goalX) < 175 && vx * vx + vy * vy < 900) {
      const targetConeY = Math.max(RINK_CY - 38, Math.min(RINK_CY + 38, RINK_CY + (ball.y - RINK_CY) * 0.25));
      if (Math.abs(py - targetConeY) > 22) py += (targetConeY - py) * 0.22;
    }
    slot.x = px;
    slot.y = py;
  }

  let bestY = RINK_CY, bestClear = -1, firstBlocker = null;
  const ballR = ball.radius || 18;
  for (let a = 0; a < SAFE_SHOT_YS.length; a++) {
    const ty = SAFE_SHOT_YS[a];
    const blk = segmentBlocked(ball.x, ball.y, goalX, ty, projOpponentsBuf, ballR + 5);
    if (!blk) {
      const dx = goalX - ball.x, dy = ty - ball.y, len2 = dx * dx + dy * dy || 1;
      let minC = 999;
      for (let i = 0; i < nOpp; i++) {
        const op = projOpponentsBuf[i];
        if (op.carded) continue;
        const t = Math.max(0.05, Math.min(0.98, ((op.x - ball.x) * dx + (op.y - ball.y) * dy) / len2));
        const clr = Math.hypot(op.x - (ball.x + t * dx), op.y - (ball.y + t * dy)) - op.radius;
        if (clr < minC) minC = clr;
      }
      const sc = minC - Math.abs(ty - RINK_CY) * 0.14;
      if (sc > bestClear) { bestClear = sc; bestY = ty; }
    } else if (!firstBlocker) {
      firstBlocker = { body: blk.body.body || blk.body, dist: blk.dist, side: blk.side };
    }
  }
  if (bestClear >= 0) return { y: bestY, open: true, blocker: null };
  const refBody = firstBlocker ? firstBlocker.body : null;
  return { y: refBody && refBody.y >= RINK_CY ? GOAL_Y_TOP + 21 : GOAL_Y_BOT - 21, open: false, blocker: firstBlocker };
}

function stickyCarryMove(body, ball, goalX, targetY, superKey = null, spin = 0) {
  const offX = ball.stickOffset ? ball.stickOffset.x : (goalX > body.x ? 35 : -35);
  const offY = ball.stickOffset ? ball.stickOffset.y : 0;
  const tx = Math.max(RINK_LEFT - 5, Math.min(RINK_RIGHT + 5, goalX - offX * 0.6));
  const ty = Math.max(RINK_TOP + 35, Math.min(RINK_BOTTOM - 35, targetY - offY * 0.6));
  const mv = aim(body, tx, ty, 380, superKey, spin);
  mv.superArm = Boolean(superKey);
  return mv;
}

function rimAroundMove(body, ball, team, superKey = null) {
  const topHalf = (ball.y + body.y) * 0.5 < RINK_CY;
  const rightHalf = body.x > RINK_CX;
  const cornerOff = RINK.corner ?? 100;
  const cx = rightHalf ? RINK_RIGHT - cornerOff : RINK_LEFT + cornerOff;
  const cy = topHalf ? RINK_TOP + cornerOff : RINK_BOTTOM - cornerOff;
  const cNx = rightHalf ? Math.SQRT1_2 : -Math.SQRT1_2;
  const cNy = topHalf ? -Math.SQRT1_2 : Math.SQRT1_2;
  const arcX = cx + cNx * 72, arcY = cy + cNy * 72;
  const txWall = -cNy, tyWall = cNx;
  const vtSign = ((arcX - body.x) * txWall + (arcY - body.y) * tyWall) >= 0 ? 1 : -1;
  const mv = aim(body, arcX, arcY, 225, superKey, -vtSign * 0.85);
  mv.superArm = Boolean(superKey);
  return mv;
}

module.exports = {
  GOAL_APERTURE_YS, shotConePoint, canOccupyCrease, goalPocketPoint, bestBankTargetY,
  timedGoalieIntercept, traceIncomingShot,
  guardReachRadius, guardCoversSegment, assessOpponentThreat, scanGoalAperture,
  stickyCarryMove, rimAroundMove
};
