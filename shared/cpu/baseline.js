/* Fast personality-weighted baseline heuristic (cpuPlans & legacy). */
'use strict';
const { P, M, RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, RINK_CY, GOAL_Y_TOP, GOAL_Y_BOT, SKATER_CURVE, SPIN_DECAY, contactRadius, skaterDrive, segmentBlocked, copy } = require('./constants.js');
const { matchBallIntercept } = require('./kinematics.js');
const { traceIncomingShot } = require('./threat.js');

function cpuPlans(bodies, random = Math.random, scores = [0, 0]) {
  const ball = bodies[6], humans = [bodies[0], bodies[1], bodies[2]], players = [bodies[3], bodies[4], bodies[5]];
  const homeScore = scores?.[0] ?? 0, cpuScore = scores?.[1] ?? 0;
  const deficit = Math.max(0, homeScore - cpuScore);
  const matchPt = (homeScore >= 4 && cpuScore >= 4) ? 1 : (homeScore >= 4 || cpuScore >= 4) ? 0.85 : 0;
  const pressure = Math.min(1, Math.max(deficit === 1 ? 0.45 : deficit === 2 ? 0.75 : deficit >= 3 ? 1 : 0, matchPt));

  const traits = new Array(3);
  for (let i = 0; i < 3; i++) {
    const p = players[i].personality || {};
    const agg = Math.max(0, Math.min(1, (p.aggression ?? 31.5) / 63));
    const cre = Math.max(0, Math.min(1, (p.creativity ?? 31.5) / 63));
    const tmw = Math.max(0, Math.min(1, (p.teamwork ?? 31.5) / 63));
    const clu = Math.max(0, Math.min(1, (p.clutch ?? 31.5) / 63));
    const surge = pressure * (clu - 0.5) * 2;
    traits[i] = { agg, cre, tmw, clu, surge };
  }

  const strikeScore = i => {
    const b = players[i], { agg, surge } = traits[i];
    const d = Math.hypot(b.x - ball.x, b.y - ball.y);
    return -d + (b.x >= ball.x - 10 ? 75 : -45) + (agg - 0.5) * 110 + Math.max(0, surge) * 35 - (b.stunned ? 10000 : 0);
  };
  const s0 = strikeScore(0), s1 = strikeScore(1), s2 = strikeScore(2);
  const strikerIdx = s1 > s0 ? (s2 > s1 ? 2 : 1) : (s2 > s0 ? 2 : 0);
  const r0 = strikerIdx === 0 ? 1 : 0;
  const r1 = strikerIdx === 2 ? 1 : 2;

  const anchorScore = i => {
    const b = players[i], { agg, surge } = traits[i];
    const sKey = b.equippedSuper?.key || b.superKey;
    const dGoal = Math.hypot(b.x - 850, b.y - RINK_CY);
    return (1 - agg) * 170 - dGoal * 0.45 - surge * 40 + (sKey === 'stalwart' ? 60 : 0) + (b.slot === 0 ? 8 : 0);
  };
  const anchorIdx = anchorScore(r0) >= anchorScore(r1) ? r0 : r1;
  const wingIdx = anchorIdx === r0 ? r1 : r0;
  const wing = players[wingIdx], wTrait = traits[wingIdx];
  const wingOpenY = ball.y < RINK_CY ? 390 : 210;
  const wingOpenX = Math.max(200, Math.min(760, ball.x - 90 + (1 - wTrait.agg) * 180 - Math.max(0, wTrait.surge) * 70));

  const out = new Array(3);
  for (let idx = 0; idx < 3; idx++) {
    const b = players[idx];
    if (b.stunned) { out[idx] = { angle: 0, power: 0, spin: 0, superArm: false, guard: false }; continue; }
    const { agg, cre, tmw, surge } = traits[idx];
    const sKey = b.equippedSuper?.key || b.superKey;
    const canSuper = Boolean(sKey) && (b.meter ?? 0) >= 100 && !b.stunned;
    const reachR = contactRadius(b);
    const contactDist = reachR + ball.radius - 2;
    const dBall = Math.hypot(b.x - ball.x, b.y - ball.y);

    let tx = b.x, ty = b.y, spin = 0, superArm = false, extraDrive = 0;

    if (idx === strikerIdx) {
      if (b.x < ball.x - 14) {
        if (canSuper && sKey === 'magnet' && dBall < 180) {
          superArm = true;
          tx = RINK_LEFT; ty = RINK_CY + (b.y >= ball.y ? 45 : -45);
          extraDrive = 160;
        } else {
          const sideY = b.y < ball.y ? -48 : 48;
          tx = Math.min(890, ball.x + 68);
          ty = Math.max(95, Math.min(505, ball.y + sideY * (1 - Math.abs(b.x - ball.x) / 400)));
          if (cre > 0.3) spin = (sideY < 0 ? 0.55 : -0.55) * cre;
        }
      } else {
        let humanGoalie = humans[0], bestGDist = (humans[0].x - 120) ** 2 + (humans[0].y - RINK_CY) ** 2;
        for (let hi = 1; hi < 3; hi++) {
          const gd = (humans[hi].x - 120) ** 2 + (humans[hi].y - RINK_CY) ** 2;
          if (gd < bestGDist) { bestGDist = gd; humanGoalie = humans[hi]; }
        }
        const cornerY = humanGoalie && humanGoalie.y >= RINK_CY ? 252 : 348;
        const baseGoalY = RINK_CY + Math.max(-34, Math.min(34, (ball.y - RINK_CY) * 0.22));
        const goalY = baseGoalY + (cornerY - baseGoalY) * Math.max(0, Math.min(1, surge * 0.75 + cre * 0.25));
        const goalX = RINK_LEFT;

        const shotBlock = segmentBlocked(ball.x, ball.y, goalX, goalY, humans, 24);
        const approachBlock = segmentBlocked(b.x, b.y, ball.x, ball.y, humans, 20);

        let aimBallX = goalX, aimBallY = goalY;
        if (tmw >= 0.58 && surge < 0.45 && (shotBlock || ball.x > 640) && wing.x < ball.x + 40) {
          aimBallX = Math.max(150, wing.x - 45);
          aimBallY = Math.max(110, Math.min(490, wing.y + (wing.y < RINK_CY ? 25 : -25)));
        } else if (cre >= 0.55 && shotBlock && !(canSuper && (sKey === 'cannonball' || sKey === 'shockwave'))) {
          if (cre >= 0.72 && Math.abs(ball.y - RINK_CY) > 45) {
            aimBallX = (ball.x + goalX) * 0.5;
            aimBallY = ball.y < RINK_CY ? RINK_TOP + 18 : RINK_BOTTOM - 18;
          } else {
            spin = shotBlock.side * Math.min(1, 0.45 + cre * 0.55);
          }
        }
        if (spin === 0 && cre > 0.35) {
          spin = Math.max(-1, Math.min(1, ((b.y - ball.y) / 180) * cre * 0.75));
        }

        let sBallX = ball.x, sBallY = ball.y;
        const rawBallSpd = Math.hypot(ball.vx || 0, ball.vy || 0);
        if (!ball.stickOffset && rawBallSpd > 25) {
          const leadPt = matchBallIntercept(b, ball, contactDist, 900, null, spin, aimBallX, aimBallY);
          if (leadPt) { sBallX = leadPt.x; sBallY = leadPt.y; }
        }
        const bdx = aimBallX - sBallX, bdy = aimBallY - sBallY, bd = Math.hypot(bdx, bdy) || 1;
        const jitterScale = Math.max(0.15, 1 - Math.max(0, -surge) * 0.75);
        const jitter = (random() - 0.5) * 10 * jitterScale;
        tx = sBallX - (bdx / bd) * contactDist;
        ty = sBallY - (bdy / bd) * contactDist + jitter;
        const isDirectGoalShot = aimBallX === goalX;
        extraDrive = isDirectGoalShot
          ? (540 + agg * 280 + Math.max(0, surge) * 320)
          : (240 + agg * 60 + surge * 75);

        if (canSuper) {
          if (sKey === 'cannonball' && dBall < 340) superArm = true;
          else if (sKey === 'sticky' && dBall < 300) superArm = true;
          else if (sKey === 'ghost' && (approachBlock || dBall < 280)) superArm = true;
          else if (sKey === 'magnet' && dBall < 230) superArm = true;
          else if (sKey === 'shockwave' && dBall < 260 && (shotBlock || approachBlock)) superArm = true;
          else if (sKey === 'knockout' && approachBlock && dBall < 280) superArm = true;
          else if (sKey === 'colossus' && dBall < 220 && (agg > 0.55 || surge > 0.3)) superArm = true;
        }
      }
    } else if (idx === anchorIdx) {
      const anchorX = Math.max(700, Math.min(875, 855 - agg * 65 - Math.max(0, surge) * 95 + Math.max(0, -surge) * 18));
      const ySpan = 55 + agg * 25;
      const anchorY = Math.max(RINK_CY - ySpan, Math.min(RINK_CY + ySpan, ball.y));

      const inc = traceIncomingShot(ball, 1);
      if (inc && inc.crosses) {
        tx = Math.min(914, RINK_RIGHT - 32);
        ty = Math.max(GOAL_Y_TOP + 20, Math.min(GOAL_Y_BOT - 20, inc.y));
        extraDrive = Math.hypot(tx - b.x, ty - b.y) > 22 ? 220 : 0;
      } else if (ball.x > 740 && b.x >= ball.x - 8 && dBall < 170 && (agg > 0.25 || ball.x > 810)) {
        const clearY = ball.y < RINK_CY ? 140 : 460;
        const bdx = 200 - ball.x, bdy = clearY - ball.y, bd = Math.hypot(bdx, bdy) || 1;
        tx = ball.x - (bdx / bd) * contactDist;
        ty = ball.y - (bdy / bd) * contactDist;
        extraDrive = 190;
      } else {
        tx = anchorX; ty = anchorY;
      }

      if (canSuper) {
        const inCrease = b.x >= 770 && b.y >= 220 && b.y <= 380;
        const threat = ball.x > 480 || pressure >= 0.45;
        if (sKey === 'stalwart' && inCrease && threat && Math.hypot(tx - b.x, ty - b.y) < 45) superArm = true;
        else if (sKey === 'colossus' && (inCrease || ball.x > 580)) superArm = true;
        else if ((sKey === 'shockwave' || sKey === 'sticky') && ball.x > 680 && dBall < 220) superArm = true;
        else if (sKey === 'magnet' && ball.x > 650 && dBall < 190) superArm = true;
      }
    } else {
      let nearestThreat = humans[0], bestTDist = (humans[0].x - ball.x) ** 2 + (humans[0].y - ball.y) ** 2;
      for (let hi = 1; hi < 3; hi++) {
        const td = (humans[hi].x - ball.x) ** 2 + (humans[hi].y - ball.y) ** 2;
        if (td < bestTDist) { bestTDist = td; nearestThreat = humans[hi]; }
      }
      const dThreat = nearestThreat ? Math.hypot(b.x - nearestThreat.x, b.y - nearestThreat.y) : 999;

      if (nearestThreat && (agg > tmw + 0.18 || (canSuper && (sKey === 'knockout' || sKey === 'shockwave'))) && dThreat < 280 && nearestThreat.x > 280) {
        tx = nearestThreat.x; ty = nearestThreat.y;
        extraDrive = 150 + agg * 70;
        if (canSuper && (sKey === 'knockout' || sKey === 'shockwave' || sKey === 'colossus')) superArm = true;
      } else {
        tx = wingOpenX; ty = wingOpenY;
        if (cre > 0.5) spin = (ty < RINK_CY ? 0.35 : -0.35) * cre;
        if (canSuper) {
          if (sKey === 'magnet' && dBall < 190) superArm = true;
          else if (sKey === 'ghost' && segmentBlocked(b.x, b.y, tx, ty, humans, 18)) superArm = true;
          else if (sKey === 'colossus' && (dBall < 220 || surge > 0.4)) superArm = true;
        }
      }
    }

    const dx = tx - b.x, dy = ty - b.y, distance = Math.hypot(dx, dy);
    const { maxV, effFriction } = skaterDrive(b, superArm ? sKey : null, spin);
    let angle = Math.atan2(dy, dx);
    const power = distance < 10 ? 0 : Math.min(1, Math.sqrt(2 * effFriction * Math.max(0, distance + extraDrive)) / maxV);

    if (Math.abs(spin) > 0.01 && power > 0.05) {
      const omega0 = spin * (b.maxSpin || P.BASE_MAX_SPIN || 20);
      const curveF = b.curveFactor ?? SKATER_CURVE;
      const v0 = Math.max(60, power * maxV);
      const estT = Math.min(1.2, distance / (v0 * 0.72));
      const avgOmega = Math.sign(omega0) * Math.max(0, Math.abs(omega0) - SPIN_DECAY / 2 * estT);
      angle -= avgOmega * curveF * estT * 0.5;
    }

    if (!power) out[idx] = { angle: 0, power: 0, spin: 0, superArm: Boolean(superArm), guard: true };
    else out[idx] = { angle, power, spin: Math.max(-1, Math.min(1, spin)), superArm: Boolean(superArm), guard: false };
  }
  return out;
}

function legacy(state, team, random = () => .5) {
  const classic = state.mode ? M.rule(state.mode, 'classic') : false;
  const src = state.bodies;
  let bodies;
  if (team === 0) {
    bodies = new Array(7);
    for (let i = 0; i < 6; i++) {
      const s = src[i < 3 ? i + 3 : i - 3];
      const copy = {
        ...s,
        x: RINK_LEFT + RINK_RIGHT - s.x,
        vx: -s.vx,
        omega: -s.omega,
        launchSpin: s.launchSpin ? -s.launchSpin : s.launchSpin,
        team: 1 - s.team,
        meter: classic ? 0 : s.meter,
        equippedSuper: classic ? null : s.equippedSuper
      };
      if (classic && 'superKey' in copy) copy.superKey = null;
      if (copy.stickOffset) copy.stickOffset = { x: -copy.stickOffset.x, y: copy.stickOffset.y };
      bodies[i] = copy;
    }
    const sb = src[6];
    bodies[6] = {
      ...sb,
      x: RINK_LEFT + RINK_RIGHT - sb.x,
      vx: -sb.vx,
      omega: -sb.omega,
      stickOffset: sb.stickOffset ? { x: -sb.stickOffset.x, y: sb.stickOffset.y } : sb.stickOffset
    };
  } else if (classic) {
    bodies = new Array(7);
    for (let i = 0; i < 6; i++) {
      const s = src[i];
      const copy = { ...s, meter: 0, equippedSuper: null };
      if ('superKey' in copy) copy.superKey = null;
      bodies[i] = copy;
    }
    bodies[6] = src[6];
  } else {
    bodies = src;
  }
  const sc = team ? state.scores : [state.scores[1], state.scores[0]];
  const rawPlans = cpuPlans(bodies, random, sc);
  const out = new Array(3);
  for (let i = 0; i < 3; i++) {
    const p = rawPlans[i];
    out[i] = {
      angle: team ? p.angle : Math.PI - p.angle,
      power: p.power,
      spin: (p.spin || 0) * (team ? 1 : -1),
      superArm: Boolean(p.superArm),
      guard: Boolean(p.guard)
    };
  }
  return out;
}

// Integrates curved skater deceleration trajectory over `arcDist` in 8 quadrature substeps
// so high-Curve / high-Spin launches compensate both chord angle deflection and arc-to-chord shortening.

module.exports = { cpuPlans, legacy };
