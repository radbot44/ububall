/* Opponent response portfolio generation and online tendency learning. */
'use strict';
const { HOLD, GUARD, RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, RINK_CX, RINK_CY, GOAL_Y_TOP, GOAL_Y_BOT, SHOT_DRIVE, behindBall, getIntent , roles
} = require('./constants.js');
const { aim, strike } = require('./kinematics.js');
const { shotConePoint, bestBankTargetY, assessOpponentThreat, scanGoalAperture, stickyCarryMove } = require('./threat.js');
const { legacy } = require('./baseline.js');
const { jointTeamPlays } = require('./candidates.js');
const { planBasinKey } = require('./evaluate.js');

function buildOpponentResponses(state, team, classic, count) {
  const oppTeam = 1 - team, oppStart = oppTeam * 3, ownStart = team * 3;
  const ball = state.bodies[6];
  const opponent = legacy(state, oppTeam);
  if (count <= 1) return [opponent];

  const oppGoal = team ? RINK_RIGHT : RINK_LEFT;
  const oppOwnGoal = team ? RINK_LEFT : RINK_RIGHT;
  const ownBodies = [state.bodies[ownStart], state.bodies[ownStart + 1], state.bodies[ownStart + 2]];
  const ownJobs = roles(state, team);
  const ownDefIdx = ownJobs.indexOf('defend');
  const ownGoalie = ownBodies[ownDefIdx >= 0 ? ownDefIdx : 0];
  const oppAp = scanGoalAperture(ball, oppGoal, ownBodies);
  const threatInfo = assessOpponentThreat(state, team, classic);
  const bankInfo = threatInfo.shotDanger ? bestBankTargetY(ball, oppGoal, ownGoalie.y, ownBodies) : null;

  const guardOpponents = [
    state.bodies[oppStart].stunned ? HOLD : GUARD,
    state.bodies[oppStart + 1].stunned ? HOLD : GUARD,
    state.bodies[oppStart + 2].stunned ? HOLD : GUARD
  ];
  if (count === 2) {
    if (threatInfo.shotDanger && threatInfo.oppStrikerIdx >= 0 && !threatInfo.incoming) {
      const si = threatInfo.oppStrikerIdx;
      const sb = state.bodies[oppStart + si];
      const sSup = !classic && sb.meter >= 100 && sb.equippedSuper ? sb.equippedSuper.key?.toLowerCase() : null;
      const armS = (sSup === 'cannonball' || sSup === 'sticky' || sSup === 'ghost') ? sSup : null;
      let shotMv;
      if (!oppAp.open && bankInfo && bankInfo.clear && (!armS || armS === 'cannonball')) {
        shotMv = strike(sb, ball, oppGoal, bankInfo.bankY, armS, 0, 2400);
      } else {
        const targetY = (sSup === 'cannonball' && oppAp.y === RINK_CY) ? (ownGoalie.y >= RINK_CY ? RINK_CY - 30 : RINK_CY + 30) : oppAp.y;
        const spinS = !oppAp.open && oppAp.blocker ? oppAp.blocker.side * 0.85 : 0;
        shotMv = strike(sb, ball, oppGoal, targetY, armS, spinS, 2400);
      }
      shotMv.power = 1;
      if (armS) shotMv.superArm = true;
      const activeThreat2 = guardOpponents.slice();
      activeThreat2[si] = shotMv;
      return [opponent, activeThreat2];
    }
    return [opponent, guardOpponents];
  }

  // On Hard+, keep opponents' other 2 skaters in GUARD while testing a bank / opposite-corner shot ONLY when truly on defense
  // (so offensive setups in the opponent's half still test pure guardOpponents).
  const guardOrBank = guardOpponents.slice();
  if (threatInfo.shotDanger && threatInfo.oppStrikerIdx >= 0 && !threatInfo.incoming &&
      threatInfo.distToOwnGoal < 580 && (threatInfo.oppFirstToBall || threatInfo.distToOwnGoal < 440)) {
    const si = threatInfo.oppStrikerIdx;
    const sb = state.bodies[oppStart + si];
    const sSup = !classic && sb.meter >= 100 && sb.equippedSuper ? sb.equippedSuper.key?.toLowerCase() : null;
    const armS = (sSup === 'cannonball' || sSup === 'ghost') ? sSup : null;
    let altShot;
    if (bankInfo && (!oppAp.open || (bankInfo.clear && Math.abs(ball.y - RINK_CY) > 48))) {
      altShot = strike(sb, ball, oppGoal, bankInfo.bankY, armS, 0, 2400);
    } else {
      const oppAltY = oppAp.y !== RINK_CY ? RINK_CY : (ownGoalie.y >= RINK_CY ? GOAL_Y_TOP + 26 : GOAL_Y_BOT - 26);
      altShot = strike(sb, ball, oppGoal, oppAltY, armS, 0, 2400);
    }
    altShot.power = 1;
    if (armS) altShot.superArm = true;
    guardOrBank[si] = altShot;
  }

  // 3rd opponent scenario (Hard+): open-aperture sniper + striker body-check blitz (keep 'defend' role strictly first!)
  const oppCone = shotConePoint(ball.x, ball.y, oppTeam, 88);
  const oppJobs = roles(state, oppTeam);
  let primaryOwn = ownBodies[0], bestOD = Infinity;
  for (let i = 0; i < 3; i++) {
    const ob = ownBodies[i];
    if (!ob.carded && !ob.stunned) {
      const d = Math.hypot(ob.x - ball.x, ob.y - ball.y) - (ob.holding ? 300 : 0);
      if (d < bestOD) { bestOD = d; primaryOwn = ob; }
    }
  }
  const blitz = new Array(3);
  for (let k = 0; k < 3; k++) {
    const b = state.bodies[oppStart + k];
    if (b.stunned) { blitz[k] = HOLD; continue; }
    const oppSup = !classic && b.meter >= 100 && b.equippedSuper ? b.equippedSuper.key?.toLowerCase() : null;
    if (oppJobs[k] === 'defend') {
      const armD = (oppSup === 'stalwart' || oppSup === 'colossus') ? oppSup : null;
      const mv = aim(b, oppCone.x, oppCone.y, 0, armD, 0);
      if (armD) mv.superArm = true;
      blitz[k] = mv;
    } else if ((oppJobs[k] === 'attack' || k === threatInfo.oppStrikerIdx) && behindBall(b, ball, oppTeam)) {
      const armA = (oppSup === 'cannonball' || oppSup === 'sticky' || oppSup === 'ghost' || oppSup === 'magnet') ? oppSup : null;
      const mv = strike(b, ball, oppGoal, oppAp.y, armA, oppAp.blocker ? oppAp.blocker.side * 0.7 : 0);
      if (threatInfo.shotDanger) mv.power = 1;
      if (armA) mv.superArm = true;
      blitz[k] = mv;
    } else {
      const armK = (oppSup === 'knockout' || oppSup === 'shockwave' || oppSup === 'colossus') ? oppSup : null;
      const mv = aim(b, primaryOwn.x + (primaryOwn.vx || 0) * 0.14, primaryOwn.y + (primaryOwn.vy || 0) * 0.14, 225, armK, 0);
      if (armK) mv.superArm = true;
      blitz[k] = mv;
    }
  }
  if (count === 3) return [opponent, guardOrBank, blitz];

  // 4th opponent scenario (Insane & Ububall God):
  const oppCoverX = oppOwnGoal + (oppTeam ? -88 : 88);
  let attack = null;
  if (threatInfo.shotDanger && threatInfo.oppStrikerIdx >= 0 && threatInfo.oppReceiverIdx >= 0 && threatInfo.distToOwnGoal < 480) {
    const oppJoints = jointTeamPlays(state, oppTeam, opponent, oppJobs);
    const snapPlay = oppJoints.find(jp => getIntent(jp[threatInfo.oppStrikerIdx]) === 'pass' && getIntent(jp[threatInfo.oppReceiverIdx]) === 'shoot');
    if (snapPlay) attack = snapPlay;
  }
  if (!attack) {
    attack = new Array(3);
    for (let k = 0; k < 3; k++) {
      const b = state.bodies[oppStart + k];
      if (b.stunned) {
        attack[k] = HOLD;
      } else {
        const oppSuper = !classic && b.meter >= 100 && b.equippedSuper ? b.equippedSuper.key?.toLowerCase() : null;
        const armAtk = oppSuper === 'cannonball' || oppSuper === 'colossus' || oppSuper === 'sticky' || oppSuper === 'ghost' || oppSuper === 'magnet';
        if (b.holding) {
          attack[k] = stickyCarryMove(b, ball, oppGoal, threatInfo.shotDanger ? oppAp.y : RINK_CY, null, 0);
        } else if (behindBall(b, ball, oppTeam) && !(oppJobs[k] === 'defend' && Math.abs(b.x - oppOwnGoal) < 165)) {
          if (threatInfo.shotDanger && k === threatInfo.oppStrikerIdx) {
            const altY = oppSuper === 'cannonball'
              ? (ownGoalie.y >= RINK_CY ? RINK_CY - 30 : RINK_CY + 30)
              : (ownGoalie.y >= RINK_CY ? GOAL_Y_TOP + 26 : GOAL_Y_BOT - 26);
            const curveSpin = armAtk ? 0 : ((altY < RINK_CY ? 0.92 : -0.92) * (oppTeam ? -1 : 1));
            const mv = strike(b, ball, oppGoal, altY, armAtk ? oppSuper : null, curveSpin);
            mv.power = 1;
            if (armAtk) mv.superArm = true;
            attack[k] = mv;
          } else {
            const mv = strike(b, ball, oppGoal, RINK_CY, armAtk ? oppSuper : null, 0);
            if (threatInfo.shotDanger) mv.power = 1;
            if (armAtk) mv.superArm = true;
            attack[k] = mv;
          }
        } else {
          const armDef = oppSuper === 'stalwart' || oppSuper === 'colossus' || oppSuper === 'shockwave';
          const mv = aim(b, oppCoverX, RINK_CY, 0, armDef ? oppSuper : null, 0);
          if (armDef) mv.superArm = true;
          attack[k] = mv;
        }
      }
    }
  }
  if (count === 4) return [opponent, guardOrBank, blitz, attack];

  const ballR = ball.radius || 18;
  const bankY = ball.y < RINK_CY ? (2 * (RINK_TOP + ballR) - RINK_CY) : (2 * (RINK_BOTTOM - ballR) - RINK_CY);
  const bankResp = attack.map((mv, k) => {
    const b = state.bodies[oppStart + k];
    if (!b.stunned && oppJobs[k] === 'attack' && behindBall(b, ball, oppTeam)) return strike(b, ball, oppGoal, bankY, null, 0);
    return mv;
  });
  return [opponent, guardOrBank, blitz, attack, bankResp];
}

function sanitizePredictedMove(body, mv, classic) {
  if (!body || body.stunned) return HOLD;
  if (!mv) return HOLD;
  const guard = Boolean(mv.guard);
  const power = guard ? 0 : Math.max(0, Math.min(1, Number(mv.power) || 0));
  const hasSuper = !classic && (body.meter ?? 0) >= 100 && Boolean(body.equippedSuper);
  return {
    angle: Number.isFinite(mv.angle) ? mv.angle : 0,
    power,
    spin: power > 0 ? Math.max(-1, Math.min(1, Number(mv.spin) || 0)) : 0,
    superArm: Boolean(mv.superArm && hasSuper),
    guard
  };
}

// Learns up to `maxLearned` opponent responses for Hard+ from resolved match history:
// 1. Multi-pattern kickoff / setup memory (remembers alternating kickoff plays instead of only the last one).
// 2. Offensive & defensive habit tracking (corner-sniping, wall-banking, cross-ice passing, guard, checks, supers, spin).
// Never accesses current-turn private inputs.
function learnedOpponentResponses(state, team, classic, history, maxLearned = 2) {
  if (!Array.isArray(history) || history.length === 0 || maxLearned <= 0) return [];
  const oppTeam = 1 - team, oppStart = oppTeam * 3, ownStart = team * 3;
  const ball = state.bodies[6];
  const isKickoff = (state.roundTurns || 0) === 0;
  const out = [];

  // 1. Frequency + recency weighted state-similarity memory (retains up to 2 distinct kickoff/setup patterns)
  const patternMap = new Map();
  const maxScan = Math.min(history.length, 32);
  let matchOrdinal = 0;
  for (let age = 0; age < maxScan; age++) {
    const h = history[history.length - 1 - age];
    if (!h || !Array.isArray(h.bodies) || h.bodies.length < 7 || !Array.isArray(h.plans) || h.plans.length < 6) continue;
    if (isKickoff) {
      if (h.roundTurns !== undefined && h.roundTurns !== 0) continue;
    } else if (h.roundTurns === 0) {
      continue;
    }
    const hb = h.bodies[6];
    const ballDist = Math.hypot((hb.x ?? ball.x) - ball.x, (hb.y ?? ball.y) - ball.y);
    let skaterDist = 0;
    for (let k = 0; k < 3; k++) {
      const ho = h.bodies[oppStart + k], co = state.bodies[oppStart + k];
      skaterDist += Math.hypot((ho.x ?? co.x) - co.x, (ho.y ?? co.y) - co.y);
    }
    skaterDist /= 3;
    const totalDist = ballDist + skaterDist;
    const thresh = isKickoff ? 35 : 85;
    if (totalDist <= thresh) {
      const moves = [0, 1, 2].map(k => sanitizePredictedMove(state.bodies[oppStart + k], h.plans[oppStart + k], classic));
      const bKey = planBasinKey(moves);
      const proxWeight = 1 - totalDist / (thresh * 2);
      const recWeight = (0.86 ** matchOrdinal) * proxWeight;
      matchOrdinal++;
      const prev = patternMap.get(bKey);
      if (prev) {
        prev.weight += recWeight + 0.35;
        prev.count++;
      } else {
        patternMap.set(bKey, { moves, weight: recWeight, count: 1, minAge: age });
      }
    }
  }
  if (patternMap.size > 0) {
    const patterns = Array.from(patternMap.values()).sort((a, b) => {
      if (Math.abs(b.weight - a.weight) > 0.14) return b.weight - a.weight;
      return a.minAge - b.minAge;
    });
    const take = Math.min(maxLearned, patterns.length);
    for (let p = 0; p < take; p++) out.push(patterns[p].moves);
    if (out.length >= maxLearned) return out;
  }

  // 2. Tendency adaptation across recent turns (both offensive shot/bank/pass tendencies and defensive/check/super habits)
  let moveW = 0, anchorTotalW = 0, anchorGuardW = 0;
  let launchW = 0, checkW = 0, spinAbsSum = 0;
  let superAvailW = 0, superArmW = 0;
  let topCornerW = 0, botCornerW = 0, midGoalW = 0, bankTopW = 0, bankBotW = 0, passW = 0, shotSampleW = 0;
  let validTurns = 0;
  const oppOwnGoal = oppTeam ? RINK_RIGHT : RINK_LEFT;
  const oppAtkGoal = oppTeam ? RINK_LEFT : RINK_RIGHT;
  const habitScan = Math.min(history.length, 16);
  for (let age = 0; age < habitScan; age++) {
    const h = history[history.length - 1 - age];
    if (!h || !Array.isArray(h.bodies) || h.bodies.length < 7 || !Array.isArray(h.plans) || h.plans.length < 6) continue;
    validTurns++;
    const w = 0.85 ** age;
    const hb = h.bodies[6];
    const hbx = hb.x ?? RINK_CX, hby = hb.y ?? RINK_CY;
    let anchorK = 0, bestAnchorD = Infinity;
    for (let k = 0; k < 3; k++) {
      const ob = h.bodies[oppStart + k];
      const d = Math.hypot((ob.x ?? RINK_CX) - oppOwnGoal, (ob.y ?? RINK_CY) - RINK_CY);
      if (d < bestAnchorD) { bestAnchorD = d; anchorK = k; }
    }
    for (let k = 0; k < 3; k++) {
      const ob = h.bodies[oppStart + k], mv = h.plans[oppStart + k];
      if (!mv || ob.stunned || ob.carded) continue;
      const obx = ob.x ?? RINK_CX, oby = ob.y ?? RINK_CY;
      moveW += w;
      const isPassive = mv.guard || !(mv.power > 0.04);
      if (k === anchorK) {
        anchorTotalW += w;
        if (isPassive) anchorGuardW += w;
      }
      if (!classic && (ob.meter ?? 0) >= 100) {
        superAvailW += w;
        if (mv.superArm) superArmW += w;
      }
      if (!isPassive) {
        launchW += w;
        spinAbsSum += Math.abs(mv.spin || 0) * w;
        const toBallAng = Math.atan2(hby - oby, hbx - obx);
        const ballAngDiff = Math.abs(Math.atan2(Math.sin(mv.angle - toBallAng), Math.cos(mv.angle - toBallAng)));
        const dToBall = Math.hypot(hbx - obx, hby - oby);
        const oppBehind = oppTeam === 0 ? obx <= hbx + 15 : obx >= hbx - 15;

        const uxL = Math.cos(mv.angle), uyL = Math.sin(mv.angle);
        const dxB = hbx - obx, dyB = hby - oby;
        const tProj = dxB * uxL + dyB * uyL;
        const perp = dxB * uyL - dyB * uxL;
        const hitsBall = tProj > 0 && dToBall < 440 && Math.abs(perp) < 46 && mv.power > 0.18;
        if (!hitsBall && ballAngDiff > 0.42) {
          for (let ek = 0; ek < 3; ek++) {
            const eb = h.bodies[ownStart + ek];
            const toEnemyAng = Math.atan2((eb.y ?? RINK_CY) - oby, (eb.x ?? RINK_CX) - obx);
            const eDiff = Math.abs(Math.atan2(Math.sin(mv.angle - toEnemyAng), Math.cos(mv.angle - toEnemyAng)));
            if (eDiff < 0.36) { checkW += w; break; }
          }
        } else if (hitsBall && oppBehind) {
          // Exact circle-impact normal gives true outgoing puck direction (including steep wall-bank cuts)
          const contactR = 44;
          const tImp = Math.max(0, tProj - Math.sqrt(Math.max(0, contactR * contactR - perp * perp)));
          const impX = obx + uxL * tImp, impY = oby + uyL * tImp;
          const puckAng = Math.atan2(hby - impY, hbx - impX) - (mv.spin || 0) * 0.16;
          let matchedPass = false;
          for (let tk = 0; tk < 3; tk++) {
            if (tk === k) continue;
            const mate = h.bodies[oppStart + tk];
            if (mate.stunned || mate.carded) continue;
            const mx = mate.x ?? RINK_CX, my = mate.y ?? RINK_CY;
            const dMate = Math.hypot(mx - hbx, my - hby);
            if (dMate > 90 && Math.abs(my - hby) > 55) {
              const toMateAng = Math.atan2(my - hby, mx - hbx);
              const mDiff = Math.abs(Math.atan2(Math.sin(puckAng - toMateAng), Math.cos(puckAng - toMateAng)));
              const goalAng = Math.atan2(RINK_CY - hby, oppAtkGoal - hbx);
              const gDiff = Math.abs(Math.atan2(Math.sin(puckAng - goalAng), Math.cos(puckAng - goalAng)));
              if (mDiff < 0.32 && gDiff > 0.30) { matchedPass = true; break; }
            }
          }
          if (matchedPass) {
            passW += w;
          } else {
            const dxG = oppAtkGoal - hbx;
            const cosP = Math.cos(puckAng);
            if (dxG * cosP > 35 && Math.abs(cosP) > 0.15) {
              const projY = hby + (Math.sin(puckAng) / cosP) * dxG;
              if (projY < RINK_TOP + 10) { bankTopW += w; shotSampleW += w; }
              else if (projY > RINK_BOTTOM - 10) { bankBotW += w; shotSampleW += w; }
              else if (projY >= GOAL_Y_TOP - 45 && projY <= GOAL_Y_BOT + 45) {
                shotSampleW += w;
                if (projY < RINK_CY - 16) topCornerW += w;
                else if (projY > RINK_CY + 16) botCornerW += w;
                else midGoalW += w;
              }
            }
          }
        }
      }
    }
  }
  if (validTurns < 2 || moveW <= 0) return out;

  const anchorGuardRate = anchorTotalW > 0 ? anchorGuardW / anchorTotalW : 0;
  const checkRate = launchW > 0 ? checkW / launchW : 0;
  const superEagerness = superAvailW > 0 ? superArmW / superAvailW : 0.5;
  const avgAbsSpin = launchW > 0 ? spinAbsSum / launchW : 0;
  const totalOffW = shotSampleW + passW;
  const bankW = bankTopW + bankBotW;

  const base = legacy(state, oppTeam);
  const oppJobs = roles(state, oppTeam);
  const atkK = oppJobs.indexOf('attack');
  const supK = oppJobs.indexOf('support');
  const defK = oppJobs.indexOf('defend');

  // Adapt attacker/wing to observed bank-shot, cross-ice pass, or corner-sniping habits
  const atkB = atkK >= 0 ? state.bodies[oppStart + atkK] : null;
  if (atkB && !atkB.stunned && !atkB.holding && behindBall(atkB, ball, oppTeam) && totalOffW >= 0.75) {
    const aKey = !classic && (atkB.meter ?? 0) >= 100 && superEagerness >= 0.4 ? atkB.equippedSuper?.key?.toLowerCase() : null;
    const armAtk = (aKey === 'cannonball' || aKey === 'sticky' || aKey === 'ghost') ? aKey : null;
    const ballR = ball.radius || 18;
    if (bankW / totalOffW >= 0.28) {
      const bankTargetY = bankTopW >= bankBotW
        ? (2 * (RINK_TOP + ballR) - (RINK_CY + 24))
        : (2 * (RINK_BOTTOM - ballR) - (RINK_CY - 24));
      const bMv = strike(atkB, ball, oppAtkGoal, bankTargetY, armAtk, 0, SHOT_DRIVE);
      bMv.power = 1;
      if (armAtk) bMv.superArm = true;
      base[atkK] = bMv;
    } else if (passW / totalOffW >= 0.26 && supK >= 0 && !state.bodies[oppStart + supK].stunned) {
      const supB = state.bodies[oppStart + supK];
      const passX = Math.max(RINK_LEFT + 110, Math.min(RINK_RIGHT - 110, supB.x * 0.64 + oppAtkGoal * 0.36));
      const passY = Math.max(RINK_TOP + 55, Math.min(RINK_BOTTOM - 55, supB.y * 0.82 + RINK_CY * 0.18));
      base[atkK] = strike(atkB, ball, passX, passY, null, 0);
      const virtBall = { ...ball, x: passX, y: passY, vx: 0, vy: 0, omega: 0, stickOffset: null };
      base[supK] = strike(supB, virtBall, oppAtkGoal, RINK_CY, null, 0);
    } else if (shotSampleW >= 0.75 && (topCornerW + botCornerW) / shotSampleW >= 0.32) {
      const favY = topCornerW >= botCornerW ? GOAL_Y_TOP + 22 : GOAL_Y_BOT - 22;
      const favSpin = avgAbsSpin > 0.22 ? (favY < RINK_CY ? -avgAbsSpin : avgAbsSpin) * (oppTeam ? 1 : -1) : 0;
      const cMv = strike(atkB, ball, oppAtkGoal, favY, armAtk, favSpin);
      if (armAtk) cMv.superArm = true;
      base[atkK] = cMv;
    }
  }

  if (anchorGuardRate > 0.45 && defK >= 0 && !state.bodies[oppStart + defK].stunned) {
    base[defK] = { ...GUARD };
  }
  if (checkRate > 0.28 && supK >= 0) {
    const supB = state.bodies[oppStart + supK];
    if (supB && !supB.stunned) {
      let targetOwn = state.bodies[ownStart], bestD = Infinity;
      for (let ek = 0; ek < 3; ek++) {
        const eb = state.bodies[ownStart + ek];
        if (eb.carded || eb.stunned) continue;
        const d = Math.hypot(eb.x - ball.x, eb.y - ball.y) - (eb.holding ? 300 : 0);
        if (d < bestD) { bestD = d; targetOwn = eb; }
      }
      const sKey = !classic && (supB.meter ?? 0) >= 100 ? supB.equippedSuper?.key?.toLowerCase() : null;
      const armS = (sKey === 'knockout' || sKey === 'shockwave' || sKey === 'colossus') ? sKey : null;
      const mv = aim(supB, targetOwn.x + (targetOwn.vx || 0) * 0.14, targetOwn.y + (targetOwn.vy || 0) * 0.14, 210, armS, 0);
      if (armS) mv.superArm = true;
      base[supK] = mv;
    }
  }
  for (let k = 0; k < 3; k++) {
    const ob = state.bodies[oppStart + k];
    if (ob.stunned) { base[k] = HOLD; continue; }
    const hasSuper = !classic && (ob.meter ?? 0) >= 100 && Boolean(ob.equippedSuper);
    if (hasSuper && superAvailW > 0) {
      if (superEagerness < 0.25) base[k].superArm = false;
      else if (superEagerness > 0.65 && (base[k].power > 0.2 || ob.equippedSuper?.key?.toLowerCase() === 'stalwart')) {
        base[k].superArm = true;
      }
    }
    if (avgAbsSpin > 0.45 && base[k].power > 0.15 && Math.abs(base[k].spin) > 0.05) {
      base[k].spin = Math.sign(base[k].spin) * Math.min(1, Math.max(Math.abs(base[k].spin), avgAbsSpin));
    }
  }
  out.push(base);
  return out;
}

// Backward-compatible single-response wrapper
function learnedOpponentResponse(state, team, classic, history) {
  const list = learnedOpponentResponses(state, team, classic, history, 1);
  return list.length ? list[0] : null;
}


module.exports = { buildOpponentResponses, sanitizePredictedMove, learnedOpponentResponses, learnedOpponentResponse };
