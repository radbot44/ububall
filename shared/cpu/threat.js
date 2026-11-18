/* Goal-pocket geometry, incoming shot threat tracing, and crease legality. */
'use strict';
const { P, M, RINK, RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, RINK_CX, RINK_CY, GOAL_Y_TOP, GOAL_Y_BOT, contactRadius, segmentBlocked, behindBall , roles
} = require('./constants.js');
const { aim , ballTraceKey } = require('./kinematics.js');

const GOAL_APERTURE_YS = [RINK_CY, RINK_CY - 28, RINK_CY + 28, RINK_CY - 50, RINK_CY + 50];

function shotConePoint(ballX, ballY, team, dist = 88) {
  const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
  const dir = team ? -1 : 1;
  const coverX = ownGoalX + dir * dist;
  const t = (coverX - ownGoalX) / ((ballX - ownGoalX) || dir);
  const rawY = t > 0 ? RINK_CY + (ballY - RINK_CY) * Math.min(1, t) * 0.65 : RINK_CY + Math.sign(ballY - RINK_CY) * 24;
  const y = Math.max(RINK_CY - 36, Math.min(RINK_CY + 36, rawY));
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
  const spanX = Math.max(50, Math.abs(ballX - ownGoalX));
  const yRatio = Math.min(0.62, Math.max(0.32, (dist * 1.45) / spanX + 0.26));
  const rawY = RINK_CY + (ballY - RINK_CY) * yRatio;
  const y = Math.max(RINK_CY - 38, Math.min(RINK_CY + 38, rawY));
  return { x: coverX, y };
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
  const slot = team ? "t1" : "t0";
  if (entry[slot] !== undefined) return entry[slot];

  const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
  if (team ? (vx0 < -120 && Math.abs(ball.x - ownGoalX) > 260) : (vx0 > 120 && Math.abs(ball.x - ownGoalX) > 260)) {
    entry[slot] = null;
    return null;
  }
  const sim = [{ ...ball, team: -1, stickOffset: null }];
  const bSim = sim[0];
  let bounces = 0, prevX = bSim.x, prevY = bSim.y;
  const onWall = (_b, _v, type) => { if (type === "wall" || type === "post") bounces++; };
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
  const incoming = traceIncomingShot(ball, team);
  let oppCarrier = null, oppStriker = null, oppStrikerIdx = -1, bestOppT = Infinity;
  let fireballThreat = Boolean(ball.onFire);

  for (let i = 0; i < 3; i++) {
    const op = state.bodies[oppStart + i];
    if (op.carded || op.stunned) continue;
    if (op.holding && !oppCarrier) oppCarrier = op;
    // Ignore a lone opponent goalie parked deep in their own crease (> 600 px away)
    if (oppJobs[i] === 'defend' && Math.abs(op.x - atkGoalX) < 165 && Math.abs(ball.x - atkGoalX) < 340) continue;
    if (behindBall(op, ball, oppTeam)) {
      const d = Math.max(0, Math.hypot(op.x - ball.x, op.y - ball.y) - contactRadius(op) - (ball.radius || 18));
      const t = d / Math.max(200, P.launchSpeed(op));
      if (t < bestOppT) {
        bestOppT = t;
        oppStriker = op;
        oppStrikerIdx = i;
      }
      const opSup = (!classic && (op.meter ?? 0) >= 100 && op.equippedSuper) ? op.equippedSuper.key?.toLowerCase() : null;
      if (d < 290 && (opSup === 'cannonball' || (op.power || 1) >= 1.18)) fireballThreat = true;
    }
  }

  let bestOwnT = Infinity, bestOwnBehindT = Infinity;
  for (let i = 0; i < 3; i++) {
    const ob = state.bodies[ownStart + i];
    if (ob.carded || ob.stunned) continue;
    const d = Math.max(0, Math.hypot(ob.x - ball.x, ob.y - ball.y) - contactRadius(ob) - (ball.radius || 18));
    const rawT = d / Math.max(200, P.launchSpeed(ob));
    const isBeh = behindBall(ob, ball, team);
    if (isBeh && rawT < bestOwnBehindT) bestOwnBehindT = rawT;
    const t = rawT + (isBeh ? 0 : 0.06);
    if (t < bestOwnT) bestOwnT = t;
  }

  const distToOwnGoal = Math.abs(ball.x - ownGoalX);
  const pressingTheirZone = Math.abs(ball.x - atkGoalX) < 380 && bestOwnT < bestOppT;
  const weClearFirst = distToOwnGoal < 185 && bestOwnBehindT + 0.025 < bestOppT;
  const strikerSuper = (oppStriker && !classic && (oppStriker.meter ?? 0) >= 100 && oppStriker.equippedSuper)
    ? oppStriker.equippedSuper.key?.toLowerCase()
    : null;
  const maxShotRange = (strikerSuper === 'cannonball' || (oppStriker && (oppStriker.power || 1) >= 1.15)) ? 590 : 515;
  const canShootThisTurn = !pressingTheirZone && !weClearFirst && Boolean(oppStriker) && bestOppT < 0.42 &&
    distToOwnGoal <= maxShotRange && bestOppT <= bestOwnT + 0.14;

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
    distToOwnGoal,
    pressingTheirZone,
    weClearFirst,
    fireballThreat,
    shotDanger: Boolean(incoming || oppCarrier || canShootThisTurn)
  };
}

function scanGoalAperture(ball, goalX, opponents) {
  let bestY = RINK_CY, bestClear = -1, firstBlocker = null;
  for (let a = 0; a < GOAL_APERTURE_YS.length; a++) {
    const ty = GOAL_APERTURE_YS[a];
    const blk = segmentBlocked(ball.x, ball.y, goalX, ty, opponents, (ball.radius || 18) + 5);
    if (!blk) {
      const dx = goalX - ball.x, dy = ty - ball.y, len2 = dx * dx + dy * dy || 1;
      let minC = 999;
      for (let i = 0; i < opponents.length; i++) {
        const op = opponents[i];
        if (op.carded) continue;
        const t = Math.max(0.05, Math.min(0.98, ((op.x - ball.x) * dx + (op.y - ball.y) * dy) / len2));
        const clr = Math.hypot(op.x - (ball.x + t * dx), op.y - (ball.y + t * dy)) - (op.radius || 25);
        if (clr < minC) minC = clr;
      }
      const sc = minC - Math.abs(ty - RINK_CY) * 0.15;
      if (sc > bestClear) { bestClear = sc; bestY = ty; }
    } else if (!firstBlocker) {
      firstBlocker = blk;
    }
  }
  if (bestClear >= 0) return { y: bestY, open: true, blocker: null };
  return { y: firstBlocker && firstBlocker.body.y >= RINK_CY ? RINK_CY - 50 : RINK_CY + 50, open: false, blocker: firstBlocker };
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
  GOAL_APERTURE_YS, shotConePoint, canOccupyCrease, goalPocketPoint, traceIncomingShot,
  guardReachRadius, guardCoversSegment, assessOpponentThreat, scanGoalAperture,
  stickyCarryMove, rimAroundMove
};
