/* Board position heuristic evaluation, spatial feature extraction, neural value blend, and basin deduplication. */
'use strict';
const { P, M, WEIGHTS, SUPER_RESERVE_BONUS, COMPLEX, TWO_PI, RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, RINK_CX, RINK_CY, RINK_SPAN, GOAL_Y_TOP, GOAL_Y_BOT, SKATER_CURVE, SPIN_DECAY, AIR_DRAG, WALL_RESTITUTION, contactRadius, creativityOf } = require('./constants.js');
const { GOAL_APERTURE_YS, shotConePoint, goalPocketPoint, guardReachRadius } = require('./threat.js');
const { NN_INPUT_DIM, encodeObservation, forward } = require('./nn.js');

const slideX = new Float64Array(6), slideY = new Float64Array(6);
const evalObsBuf = new Float32Array(NN_INPUT_DIM);
const evalPermBuf = [0, 1, 2];
const FEATURE_NAMES = Object.freeze(['progress', 'access', 'cover', 'chance', 'meter', 'stun', 'daze']);
const FEATURES = new Float64Array(FEATURE_NAMES.length);
const FEATURE_CAP = 600, WRONG_SIDE = 60;
const unavailable = b => b.carded || b.stunned || b.stunnedNext;

function syncSlidesFromBodies(bodies) {
  for (let i = 0; i < 6; i++) {
    slideX[i] = bodies[i].x;
    slideY[i] = bodies[i].y;
  }
}

// Distance from team t's best-placed skater to the spot behind the ball that strikes it at the goal t attacks.
function strikeAccess(bodies, t, bx, by, ballR) {
  const gx = t ? RINK_LEFT : RINK_RIGHT;
  const gdx = gx - bx, gdy = RINK_CY - by, gd = Math.hypot(gdx, gdy) || 1;
  const ux = gdx / gd, uy = gdy / gd;
  let best = FEATURE_CAP;
  for (let i = t * 3; i < t * 3 + 3; i++) {
    const b = bodies[i];
    if (unavailable(b)) continue;
    const contact = contactRadius(b) + ballR;
    let d = Math.hypot(slideX[i] - (bx - ux * contact), slideY[i] - (by - uy * contact));
    const ahead = (slideX[i] - bx) * ux + (slideY[i] - by) * uy;
    if (ahead > 0) d += Math.min(WRONG_SIDE, ahead * 1.5);
    if (d < best) best = d;
  }
  return best;
}

// Distance from team t's nearest skater to its optimal legal goal-anchor segment (44 px pocket out to 88 px cone).
function coneCover(bodies, t, bx, by, fouls = null) {
  const conePt = shotConePoint(bx, by, t, 88);
  const inDefHalf = t ? bx >= RINK_CX + 20 : bx <= RINK_CX - 20;
  if (!inDefHalf) {
    let bestFar = FEATURE_CAP;
    for (let i = t * 3; i < t * 3 + 3; i++) {
      if (unavailable(bodies[i])) continue;
      const d = Math.hypot(slideX[i] - conePt.x, slideY[i] - conePt.y);
      if (d < bestFar) bestFar = d;
    }
    return bestFar;
  }
  const CREASE_R2 = M.FOULS.crease * M.FOULS.crease;
  const gx = t ? RINK_RIGHT : RINK_LEFT;
  let inC = 0, oppAZ = 0;
  const azLine = M.attackZoneLine(P, t);
  for (let k = 0; k < 3; k++) {
    const sb = bodies[t * 3 + k];
    if (!sb.carded && sb.superActive !== 'stalwart') {
      const dx = slideX[t * 3 + k] - gx, dy = slideY[t * 3 + k] - RINK_CY;
      if (dx * dx + dy * dy < CREASE_R2) inC++;
    }
    const ob = bodies[(1 - t) * 3 + k];
    if (!ob.carded && (t ? slideX[(1 - t) * 3 + k] > azLine : slideX[(1 - t) * 3 + k] < azLine)) oppAZ++;
  }
  const allowPocket = !fouls?.crease?.[t] && inC <= (oppAZ > 1 ? oppAZ : 1);
  const pocketPt = allowPocket ? goalPocketPoint(bx, by, t, true) : conePt;
  const segDx = conePt.x - pocketPt.x, segDy = conePt.y - pocketPt.y;
  const segLen2 = segDx * segDx + segDy * segDy;

  let best = FEATURE_CAP;
  for (let i = t * 3; i < t * 3 + 3; i++) {
    if (unavailable(bodies[i])) continue;
    let d;
    if (segLen2 > 1e-4) {
      const proj = Math.max(0, Math.min(1, ((slideX[i] - pocketPt.x) * segDx + (slideY[i] - pocketPt.y) * segDy) / segLen2));
      d = Math.hypot(slideX[i] - (pocketPt.x + proj * segDx), slideY[i] - (pocketPt.y + proj * segDy));
    } else {
      d = Math.hypot(slideX[i] - conePt.x, slideY[i] - conePt.y);
    }
    if (d < best) best = d;
  }
  return best;
}

// Team t's next-turn shooting chance: open share of the goal mouth x angle it subtends x striker readiness,
// with moderate amplification when a wide-open net (>= 60% unobstructed) is left to a close uncontested striker.
function shotChance(bodies, t, bx, by, ballR, strikeDist, oppStrikeDist = FEATURE_CAP) {
  if (strikeDist >= FEATURE_CAP) return 0;
  const gx = t ? RINK_LEFT : RINK_RIGHT, adx = Math.max(10, t ? bx - gx : gx - bx);
  const angle = Math.atan2(GOAL_Y_BOT - by, adx) - Math.atan2(GOAL_Y_TOP - by, adx);
  let open = 0;
  for (let a = 0; a < GOAL_APERTURE_YS.length; a++) {
    const dx = gx - bx, dy = GOAL_APERTURE_YS[a] - by, len2 = dx * dx + dy * dy || 1;
    let minClear = 40;
    for (let i = (1 - t) * 3; i < (1 - t) * 3 + 3; i++) {
      const b = bodies[i];
      if (b.carded) continue;
      const s = ((slideX[i] - bx) * dx + (slideY[i] - by) * dy) / len2;
      if (s <= 0.05 || s >= 1) continue;
      const blkR = b.guarding ? guardReachRadius(b) : contactRadius(b);
      const clr = Math.hypot(slideX[i] - (bx + s * dx), slideY[i] - (by + s * dy)) - (blkR + ballR);
      if (clr < minClear) minClear = clr;
    }
    open += minClear <= 0 ? 0 : minClear >= 20 ? 1 : minClear / 20;
  }
  const openFrac = open / GOAL_APERTURE_YS.length;
  const baseChance = openFrac * angle * Math.exp(-strikeDist / 250);
  if (openFrac < 0.60 || strikeDist >= 260) return baseChance;
  const uncontested = strikeDist < oppStrikeDist
    ? (1.0 + Math.min(0.45, (oppStrikeDist - strikeDist) / 240))
    : 0.60;
  const openDanger = (openFrac - 0.40) * openFrac * Math.min(0.90, angle + 0.15) * Math.exp(-strikeDist / 220) * uncontested * 0.50;
  return baseChance + openDanger;
}

function evaluateBodies(bodies, fouls, team, goal, weights, complexity = 0, scorer = null, teamTouches = false, tmw = 0.5, partial = false, isPulse = false, nnCtx = null) {
  if (goal !== null && goal !== undefined && goal >= 0) {
    if (goal !== team) return -weights.goal;
    const scorerCre = scorer ? creativityOf(scorer) : (31.5 / 63);
    const effCre = teamTouches && tmw > scorerCre ? tmw : scorerCre;
    const comp = complexity > 4 ? 4 : complexity;
    return weights.goal * (COMPLEX.simple + COMPLEX.creative * (effCre - 0.35) * comp);
  }

  const DAZE_F = P.DAZE.free, DAZE_M = P.DAZE.max;
  const CREASE_SQ = M.FOULS.crease * M.FOULS.crease;
  const STALL_T = M.FOULS.stallTurns;
  const coastActive = partial && !isPulse;
  const projectMotion = coastActive || isPulse;
  const ball = bodies[6];
  const ballR = ball.radius || 18;
  const gOpenTop = GOAL_Y_TOP + ballR - 2, gOpenBot = GOAL_Y_BOT - ballR + 2;

  // 1. Project skater stopping slides on truncated Standard/Classic rollouts
  let carrierIdx = -1;
  for (let i = 0; i < 6; i++) {
    const b = bodies[i];
    if (b.holding && !b.carded && carrierIdx < 0) carrierIdx = i;
    const vx = b.vx || 0, vy = b.vy || 0;
    const sp2 = vx * vx + vy * vy;
    if (coastActive && !b.carded && sp2 > 4) {
      const sp = Math.sqrt(sp2);
      const fMult = b.holding ? (P.SUPER.carryFriction ?? 1.5)
        : (b.superActive === 'stalwart' ? (P.SUPER.stalwartFriction ?? 3) : 1.0);
      const decel = (b.friction ?? 150) * fMult + AIR_DRAG * sp2 * 0.5;
      const slideD = Math.min(240, sp2 / (2 * decel));
      const tSlide = Math.min(1.0, sp / decel);
      let ux = vx / sp, uy = vy / sp;
      const w = b.omega || 0;
      if (w !== 0 && tSlide > 0.02) {
        const midW = (w > 0 ? 1 : -1) * Math.max(0, Math.abs(w) - SPIN_DECAY * tSlide * 0.25);
        const rot = midW * (b.curveFactor ?? SKATER_CURVE) * tSlide * 0.5;
        const rc = Math.cos(rot), rs = Math.sin(rot);
        const rux = ux * rc - uy * rs, ruy = ux * rs + uy * rc;
        ux = rux; uy = ruy;
      }
      const nx = b.x + ux * slideD;
      const ny = b.y + uy * slideD;
      slideX[i] = nx < RINK_LEFT + 25 ? RINK_LEFT + 25 : (nx > RINK_RIGHT - 25 ? RINK_RIGHT - 25 : nx);
      slideY[i] = ny < RINK_TOP + 25 ? RINK_TOP + 25 : (ny > RINK_BOTTOM - 25 ? RINK_BOTTOM - 25 : ny);
    } else {
      slideX[i] = b.x;
      slideY[i] = b.y;
    }
  }

  // 2. Project skater-aware curved ball coast & impending open-net goal crossings
  const bx = ball.x, by = ball.y;
  const bvx0 = ball.vx || 0, bvy0 = ball.vy || 0;
  let coastDx = 0, pbx = bx, pby = by, impendingGoalBonus = 0;

  if (carrierIdx >= 0) {
    const cdx = slideX[carrierIdx] - bodies[carrierIdx].x;
    const cdy = slideY[carrierIdx] - bodies[carrierIdx].y;
    coastDx = cdx * 0.35;
    pbx = bx + cdx;
    pby = by + cdy;
    if (!isPulse) {
      if (pbx <= RINK_LEFT + 4 && pby > gOpenTop && pby < gOpenBot) impendingGoalBonus = (team === 1 ? 1 : -1) * weights.goal * 0.76;
      else if (pbx >= RINK_RIGHT - 4 && pby > gOpenTop && pby < gOpenBot) impendingGoalBonus = (team === 0 ? 1 : -1) * weights.goal * 0.76;
    }
  } else if (projectMotion && (bvx0 * bvx0 + bvy0 * bvy0 > 400)) {
    let cx = bx, cy = by, cvx = bvx0, cvy = bvy0, cw = ball.omega || 0;
    const bFric = ball.friction ?? 85;
    const bSpd0 = Math.sqrt(cvx * cvx + cvy * cvy);
    const maxT = isPulse ? 0.30 : 1.35;
    const steps = isPulse ? 4 : 6;
    const totalT = Math.min(maxT, bSpd0 / (bFric + AIR_DRAG * bSpd0 * bSpd0 * 0.5));
    const dtC = totalT / steps;
    const bCurve = ((ball.onFire ? P.BURNING_BALL_CURVE : P.BALL_CURVE) ?? 0.06) * (ball.curveMult ?? 1);
    const xMin = RINK_LEFT + ballR, xMax = RINK_RIGHT - ballR;
    const yMin = RINK_TOP + ballR, yMax = RINK_BOTTOM - ballR;
    let elapsedT = 0;

    for (let s = 0; s < steps && dtC > 1e-4; s++) {
      const bSpd2 = cvx * cvx + cvy * cvy;
      if (bSpd2 < 100) break;
      const bSpd = Math.sqrt(bSpd2);
      const ux0 = cvx / bSpd, uy0 = cvy / bSpd;
      const decel = (bFric + AIR_DRAG * bSpd2) * dtC;
      const nextSpd = bSpd > decel ? bSpd - decel : 0;
      const midSpd = 0.5 * (bSpd + nextSpd);
      const stepT = bSpd > decel ? dtC : bSpd / (bFric + AIR_DRAG * bSpd2);
      let ux = ux0, uy = uy0;
      if (cw !== 0) {
        const hAng = cw * bCurve * stepT * 0.5;
        const hc = Math.cos(hAng), hs = Math.sin(hAng);
        ux = ux0 * hc - uy0 * hs;
        uy = ux0 * hs + uy0 * hc;
        const fAng = cw * bCurve * stepT;
        const fc = Math.cos(fAng), fs = Math.sin(fAng);
        cvx = (ux0 * fc - uy0 * fs) * nextSpd;
        cvy = (ux0 * fs + uy0 * fc) * nextSpd;
        const aw = Math.abs(cw) - SPIN_DECAY * stepT;
        cw = aw > 0 ? (cw > 0 ? aw : -aw) : 0;
      } else {
        cvx = ux0 * nextSpd;
        cvy = uy0 * nextSpd;
      }
      const cx0 = cx, cy0 = cy;
      const nx = cx0 + ux * midSpd * stepT;
      const ny = cy0 + uy * midSpd * stepT;
      const segDx = nx - cx0, segDy = ny - cy0, segLen2 = segDx * segDx + segDy * segDy;

      let hitT = 2;
      if (segLen2 > 1e-4) {
        const frac = (s + 0.5) / steps;
        for (let i = 0; i < 6; i++) {
          const sb = bodies[i];
          if (sb.carded) continue;
          const sx = sb.x + (slideX[i] - sb.x) * frac;
          const sy = sb.y + (slideY[i] - sb.y) * frac;
          if (s === 0 && ((sx - cx0) * segDx + (sy - cy0) * segDy) <= 0) continue;
          const hitR = contactRadius(sb) + ballR;
          const proj = Math.max(0, Math.min(1, ((sx - cx0) * segDx + (sy - cy0) * segDy) / segLen2));
          const px = cx0 + proj * segDx, py = cy0 + proj * segDy;
          const d2 = (sx - px) * (sx - px) + (sy - py) * (sy - py);
          if (d2 <= hitR * hitR && proj < hitT) hitT = proj;
        }
      }
      if (hitT <= 1) {
        cx = cx0 + hitT * segDx;
        cy = cy0 + hitT * segDy;
        break;
      }

      cx = nx;
      cy = ny;

      let goalForTeam = -1, goalLineX = 0, tCross = 1;
      if (cx <= RINK_LEFT && cx0 > RINK_LEFT) {
        tCross = (cx0 - RINK_LEFT) / Math.max(1e-4, cx0 - cx);
        const yCross = cy0 + tCross * (cy - cy0);
        if (yCross > gOpenTop && yCross < gOpenBot) {
          goalForTeam = 1; goalLineX = RINK_LEFT; cy = yCross;
        }
      } else if (cx >= RINK_RIGHT && cx0 < RINK_RIGHT) {
        tCross = (RINK_RIGHT - cx0) / Math.max(1e-4, cx - cx0);
        const yCross = cy0 + tCross * (cy - cy0);
        if (yCross > gOpenTop && yCross < gOpenBot) {
          goalForTeam = 0; goalLineX = RINK_RIGHT; cy = yCross;
        }
      }
      if (goalForTeam >= 0 && midSpd > 35) {
        cx = goalLineX;
        const sign = goalForTeam === team ? 1 : -1;
        const freshness = 1 - s / steps;
        const defTeam = 1 - goalForTeam, defStart = defTeam * 3;
        if (!isPulse) {
          let nearBlocker = false;
          for (let di = defStart; di < defStart + 3; di++) {
            const db = bodies[di];
            if (db.carded) continue;
            const blkR = db.guarding ? guardReachRadius(db) : contactRadius(db);
            if (Math.hypot(slideX[di] - goalLineX, slideY[di] - cy) <= blkR + ballR + 16) { nearBlocker = true; break; }
          }
          if (!nearBlocker) impendingGoalBonus = sign * weights.goal * (0.76 + 0.12 * freshness);
        } else {
          const crossTime = elapsedT + stepT * tCross;
          let saveable = false;
          for (let di = defStart; di < defStart + 3; di++) {
            const db = bodies[di];
            if (unavailable(db)) continue;
            const ddx = goalLineX - db.x, ddy = cy - db.y;
            const dRaw = Math.hypot(ddx, ddy);
            const blkR = db.guarding ? guardReachRadius(db) : contactRadius(db);
            const distToLine = Math.max(0, dRaw - blkR - ballR);
            const vToward = dRaw > 1 ? ((db.vx || 0) * ddx + (db.vy || 0) * ddy) / dRaw : 0;
            const effSpeed = Math.max(P.launchSpeed(db) * 0.92, vToward);
            const maxCover = effSpeed * Math.max(0, crossTime - 0.02);
            if (distToLine <= maxCover) { saveable = true; break; }
          }
          if (!saveable) impendingGoalBonus = sign * weights.goal * (0.70 + 0.12 * freshness);
        }
        break;
      }

      elapsedT += stepT;
      if (cy < yMin) { cy = 2 * yMin - cy; cvy = -cvy * WALL_RESTITUTION; cw *= 0.5; }
      else if (cy > yMax) { cy = 2 * yMax - cy; cvy = -cvy * WALL_RESTITUTION; cw *= 0.5; }
      if (cx < xMin && (cy <= gOpenTop || cy >= gOpenBot)) { cx = 2 * xMin - cx; cvx = -cvx * WALL_RESTITUTION; }
      else if (cx > xMax && (cy <= gOpenTop || cy >= gOpenBot)) { cx = 2 * xMax - cx; cvx = -cvx * WALL_RESTITUTION; }
      cx = Math.max(RINK_LEFT - 5, Math.min(RINK_RIGHT + 5, cx));
    }
    coastDx = (cx - bx) * (isPulse ? 0.20 : 0.25);
    if (!isPulse) {
      pbx = cx;
      pby = cy;
    }
  }

  const ownStart = team * 3, otherStart = (1 - team) * 3;
  const dir = team ? -1 : 1, ownGoalX = team ? RINK_RIGHT : RINK_LEFT, oppGoalX = RINK_LEFT + RINK_RIGHT - ownGoalX;

  let mDiff = 0, cDiff = 0, sDiff = 0, dDiff = 0, superReadyDiff = 0;
  const fullSuperTicks = P.SUPER?.ticks || 720;
  for (let k = 0; k < 3; k++) {
    const ob = bodies[ownStart + k];
    mDiff += ob.meter || 0;
    if (ob.carded) cDiff++;
    else {
      if (ob.stunned || ob.stunnedNext) sDiff--;
      if (ob.equippedSuper) {
        if ((ob.meter || 0) >= 100) superReadyDiff += 1;
        else if (isPulse && ob.superActive && (ob.superTicks || 0) > 45) superReadyDiff += 0.55 * Math.min(1, ob.superTicks / fullSuperTicks);
      }
    }
    const d1 = ob.daze || 0;
    if (d1 > DAZE_F) dDiff -= (d1 - DAZE_F) / (DAZE_M - DAZE_F) * DAZE_M;

    const tb = bodies[otherStart + k];
    mDiff -= tb.meter || 0;
    if (tb.carded) cDiff--;
    else {
      if (tb.stunned || tb.stunnedNext) sDiff++;
      if (tb.equippedSuper) {
        if ((tb.meter || 0) >= 100) superReadyDiff -= 1;
        else if (isPulse && tb.superActive && (tb.superTicks || 0) > 45) superReadyDiff -= 0.55 * Math.min(1, tb.superTicks / fullSuperTicks);
      }
    }
    const d2 = tb.daze || 0;
    if (d2 > DAZE_F) dDiff += (d2 - DAZE_F) / (DAZE_M - DAZE_F) * DAZE_M;
  }

  const strikeOwn = strikeAccess(bodies, team, pbx, pby, ballR);
  const strikeOther = strikeAccess(bodies, 1 - team, pbx, pby, ballR);
  const coneOther = coneCover(bodies, 1 - team, pbx, pby, fouls);
  const coneOwn = coneCover(bodies, team, pbx, pby, fouls);
  FEATURES[0] = dir * (bx + coastDx - RINK_CX);
  FEATURES[1] = strikeOther - strikeOwn;
  FEATURES[2] = coneOther - coneOwn;
  FEATURES[3] = shotChance(bodies, team, pbx, pby, ballR, strikeOwn, strikeOther) - shotChance(bodies, 1 - team, pbx, pby, ballR, strikeOther, strikeOwn);
  FEATURES[4] = mDiff;
  FEATURES[5] = sDiff;
  FEATURES[6] = dDiff / DAZE_M;

  let postFoul = 0;
  if (coastActive) {
    for (let t = 0; t < 2; t++) {
      let inC = 0, oppAZ = 0;
      const ts = t * 3, os = (1 - t) * 3, gx = t ? RINK_RIGHT : RINK_LEFT;
      const oppAzLine = M.attackZoneLine(P, 1 - t);
      for (let k = 0; k < 3; k++) {
        const si = ts + k, sb = bodies[si];
        if (!sb.carded && sb.superActive !== 'stalwart') {
          const cdx = slideX[si] - gx, cdy = slideY[si] - RINK_CY;
          if (cdx * cdx + cdy * cdy < CREASE_SQ) inC++;
        }
        const oi2 = os + k;
        if (!bodies[oi2].carded && (t ? slideX[oi2] > oppAzLine : slideX[oi2] < oppAzLine)) oppAZ++;
      }
      if (inC > (oppAZ > 1 ? oppAZ : 1)) {
        const sign = t === team ? -1 : 0.7;
        postFoul += sign * (fouls?.crease?.[t] ? weights.card * 0.85 : weights.warning * 0.6);
      }
    }
  }

  let stickyBonus = 0;
  if (carrierIdx >= 0) {
    stickyBonus = (carrierIdx >= ownStart && carrierIdx < ownStart + 3)
      ? (38 + 24 * (1 - Math.abs(oppGoalX - pbx) / RINK_SPAN))
      : -(42 + 26 * (1 - Math.abs(ownGoalX - pbx) / RINK_SPAN));
  }

  const superReserve = weights.meter > 0
    ? superReadyDiff * SUPER_RESERVE_BONUS * Math.min(1.5, weights.meter / 0.35)
    : 0;

  const crease0 = fouls?.crease?.[0] ? 1 : 0, crease1 = fouls?.crease?.[1] ? 1 : 0;
  const warned = (team ? crease1 - crease0 : crease0 - crease1);
  const corner = fouls && fouls.corner !== null && fouls.corner !== undefined ? fouls.corner : -1;
  let stall = 0;
  if (corner >= 0) {
    let mine = 0, theirs = 0;
    for (let k = 0; k < 3; k++) {
      const ob = bodies[ownStart + k], tb = bodies[otherStart + k];
      if (!ob.carded && M.cornerOf(P, ob.x, ob.y, ob.radius || 25) === corner) mine++;
      if (!tb.carded && M.cornerOf(P, tb.x, tb.y, tb.radius || 25) === corner) theirs++;
    }
    if (mine !== theirs) {
      const ratio = (fouls?.cornerTurns || 0) / STALL_T;
      stall = (mine > theirs ? 1 : -1) * (ratio < 1 ? ratio : 1);
    }
  }

  if (nnCtx && nnCtx.model && nnCtx.weight > 0 && Math.abs(impendingGoalBonus) < weights.goal * 0.5) {
    encodeObservation(bodies, fouls, team, {
      classic: nnCtx.classic,
      pulse: isPulse,
      blitz: nnCtx.blitz,
      scores: nnCtx.scores,
      roundTurns: nnCtx.roundTurns,
      slideX: coastActive ? slideX : null,
      slideY: coastActive ? slideY : null,
      pbx: !isPulse ? pbx : bx,
      pby: !isPulse ? pby : by,
      zeroSettledVel: coastActive,
      strikeOwn,
      strikeOther,
      coneOwn,
      coneOther
    }, evalObsBuf, evalPermBuf);
    const nnRes = forward(evalObsBuf, false, nnCtx.model);
    if (nnRes) {
      const hPositional =
        FEATURES[0] * weights.progress +
        FEATURES[1] * weights.access +
        FEATURES[2] * weights.cover +
        FEATURES[3] * (weights.chance ?? 0) +
        FEATURES[4] * weights.meter +
        FEATURES[5] * (weights.stun ?? 185) +
        FEATURES[6] * (weights.daze ?? 120) +
        stickyBonus + superReserve;
      const hardRules =
        -cDiff * weights.card -
        (warned + stall) * weights.warning +
        postFoul + impendingGoalBonus;
      const w = nnCtx.weight;
      const scale = nnCtx.scale ?? (weights.goal * 0.45);
      return (1 - w) * hPositional + w * (nnRes.value * scale) + hardRules;
    }
  }

  return FEATURES[0] * weights.progress +
    FEATURES[1] * weights.access +
    FEATURES[2] * weights.cover +
    FEATURES[3] * (weights.chance ?? 0) +
    FEATURES[4] * weights.meter +
    FEATURES[5] * (weights.stun ?? 185) +
    FEATURES[6] * (weights.daze ?? 120) -
    cDiff * weights.card -
    (warned + stall) * weights.warning +
    postFoul + stickyBonus + superReserve + impendingGoalBonus;
}

function evaluate(state, team, goal, weights, complexity = 0, scorer = null, teamTouches = false, tmw = 0.5, nnCtx = null) {
  const isPulse = state.mode ? M.rule(state.mode, 'pulse') : false;
  return evaluateBodies(state.bodies, state.fouls, team, goal, weights, complexity, scorer, teamTouches, tmw, false, isPulse, nnCtx);
}

// Position features of a settled state from team's side (calibration input; see docs/cpu-simulation.md).
function features(state, team) {
  evaluateBodies(state.bodies, state.fouls, team, null, WEIGHTS);
  return Array.from(FEATURES);
}

function planBasinKey(moves) {
  let key = '';
  for (let i = 0; i < 3; i++) {
    const m = moves[i];
    if (m.guard) key += (m.superArm ? 'Gs|' : 'G|');
    else if (!m.power || m.power < 0.02) key += 'H|';
    else {
      const aBin = Math.round((((m.angle % TWO_PI) + TWO_PI) % TWO_PI) * 36); // ~1.6 deg precision
      const pBin = Math.round(m.power * 20);
      const sBin = Math.round((m.spin || 0) * 6);
      key += aBin + ':' + pBin + ':' + sBin + (m.superArm ? 'S|' : '|');
    }
  }
  return key;
}

module.exports = { FEATURE_NAMES, syncSlidesFromBodies, strikeAccess, coneCover, shotChance, evaluateBodies, evaluate, features, planBasinKey };
