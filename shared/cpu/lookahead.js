/* Selective Turn-2 / Turn-3 discounted look-ahead for Insane and Ububall God levels. */
'use strict';
const {
  P, M, HOLD, GUARD, RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, RINK_CX, RINK_CY,
  GOAL_Y_TOP, GOAL_Y_BOT, SHOT_DRIVE, decided, skaterDrive, segmentBlocked,
  behindBall, isPointBlank, bReach, copy, roles
} = require('./constants.js');
const { aim, strike, traceMovingBall } = require('./kinematics.js');
const { shotConePoint, canOccupyCrease, goalPocketPoint, bestBankTargetY, timedGoalieIntercept, traceIncomingShot, assessOpponentThreat, scanGoalAperture } = require('./threat.js');
const { legacy } = require('./baseline.js');
const { options, jointTeamPlays } = require('./candidates.js');
const { evaluateBodies, planBasinKey } = require('./evaluate.js');
const { buildOpponentResponses } = require('./opponent.js');

function runMultiTurnLookahead(ctx) {
  const {
    settings, evaluated, pulse, fullTurnTicks, state, team, classic,
    weights, tmw, maxGoal, ensureWobbled, responses, combineValues, pruneMargin, nnCtx
  } = ctx;
  let { finalPool, simulations, ticks } = ctx;
  // 7. Selective Multi-Turn Look-Ahead (Insane & Ububall God):
  //    Bridges top distinct finalists through canonical Turn-1 settlement (`finishTurn`: stuns, cards, whiff refunds,
  //    expired Standard supers, or carried Pulse velocity/supers) and solves a Turn-2 simultaneous micro-game
  //    (chaining into Turn 3 in Pulse mode on Ububall God) discounted at gamma = 0.60.
  const lookaheadTop = settings.lookaheadTop || 0;
  if (lookaheadTop > 0 && evaluated > 4 && finalPool.length > 1) {
    const byB = new Map();
    for (let s = 0; s < finalPool.length; s++) {
      const entry = finalPool[s];
      const key = entry.basin || planBasinKey(entry.moves);
      entry.basin = key;
      const prev = byB.get(key);
      if (!prev || entry.value > prev.value) byB.set(key, entry);
    }
    const contenders = Array.from(byB.values()).sort((a, b) => b.value - a.value);
    while (contenders.length && !contenders[0].wobbled) {
      ensureWobbled(contenders[0]);
      contenders.sort((a, b) => b.value - a.value);
    }

    // Skip Turn-2 look-ahead only when #1 already locks in a clean forced Turn-1 goal (>= 9,200) across all scenarios
    if (contenders.length > 1 && contenders[0].value < weights.goal * 0.92) {
      const t2Breadth = settings.lookaheadBreadth || 4;
      const t2Horizon = pulse ? fullTurnTicks : (settings.lookaheadTicks || 320);
      const extraPulseDepth = pulse ? Math.max(0, (settings.pulseDepth || 2) - 2) : 0;
      const maxT2Sims = settings.lookaheadBudget ?? (lookaheadTop * t2Breadth * 4);
      let t2SimsUsed = 0;
      const GAMMA_T2 = 0.60;

      function buildTurn2Portfolio(sNode, side, cap) {
        const sOwn = side * 3, sOpp = (1 - side) * 3;
        const sBall = sNode.bodies[6];
        const sAtkGoal = side ? RINK_LEFT : RINK_RIGHT;
        const sOwnGoal = RINK_LEFT + RINK_RIGHT - sAtkGoal;
        const sEnemies = [sNode.bodies[sOpp], sNode.bodies[sOpp + 1], sNode.bodies[sOpp + 2]];
        const sJobs = roles(sNode, side);
        const sAp = scanGoalAperture(sBall, sAtkGoal, sEnemies);
        const sCone = shotConePoint(sBall.x, sBall.y, side, 88);
        const sBallR = sBall.radius || 18;
        const portfolio = [];
        const seenKeys = new Set();

        const addPlay = play => {
          if (!play || portfolio.length >= cap) return;
          const k = planBasinKey(play);
          if (seenKeys.has(k)) return;
          seenKeys.add(k);
          portfolio.push(play);
        };
        const supKeyOf = idx => {
          const b = sNode.bodies[sOwn + idx];
          return (!classic && !b.stunned && (b.meter ?? 0) >= 100 && b.equippedSuper)
            ? b.equippedSuper.key?.toLowerCase()
            : null;
        };

        const base = legacy(sNode, side);
        addPlay(base);

        let defI = sJobs.indexOf('defend');
        if (defI < 0) defI = 0;
        const defB = sNode.bodies[sOwn + defI];
        const defWarned = Boolean(sNode.fouls?.crease?.[side]) && M.inCrease(P, defB, side);
        const lockdown = base.slice();
        if (!defB.stunned && !defB.carded) {
          const dSup = supKeyOf(defI);
          const sAllowPkt = canOccupyCrease(sNode, side, defI) || dSup === 'stalwart';
          const sIncoming = traceIncomingShot(sBall, side);
          if (sIncoming && sIncoming.crosses) {
            const armD = (dSup === 'stalwart' || dSup === 'colossus') ? dSup : null;
            const mvInc = timedGoalieIntercept(defB, sBall, sIncoming, side, sAllowPkt, armD);
            if (armD) mvInc.superArm = true;
            lockdown[defI] = mvInc;
          } else {
            const sAnchor = Math.abs(sBall.x - sOwnGoal) < 520 ? goalPocketPoint(sBall.x, sBall.y, side, sAllowPkt) : sCone;
            if (!defWarned && Math.hypot(defB.x - sAnchor.x, defB.y - sAnchor.y) < 24 && Math.hypot(defB.vx || 0, defB.vy || 0) < 45) {
              lockdown[defI] = { ...GUARD, superArm: Boolean(dSup === 'stalwart') };
            } else {
              const armD = (Math.abs(sBall.x - sOwnGoal) < 400 && (dSup === 'stalwart' || dSup === 'colossus')) ? dSup : null;
              const mvD = aim(defB, sAnchor.x, sAnchor.y, 0, armD, 0);
              if (armD) mvD.superArm = true;
              lockdown[defI] = mvD;
            }
          }
        }
        let enemyStriker = null, bestEnemyD = Infinity;
        for (let ei = 0; ei < 3; ei++) {
          const eb = sEnemies[ei];
          if (eb.carded || eb.stunned) continue;
          const ed = Math.hypot(eb.x - sBall.x, eb.y - sBall.y) - (eb.holding ? 260 : 0) - (behindBall(eb, sBall, 1 - side) ? 70 : 0);
          if (ed < bestEnemyD) { bestEnemyD = ed; enemyStriker = eb; }
        }
        let chkI = -1, bestChkD = Infinity;
        for (let i = 0; i < 3; i++) {
          if (i === defI || sNode.bodies[sOwn + i].stunned) continue;
          const d = enemyStriker ? Math.hypot(sNode.bodies[sOwn + i].x - enemyStriker.x, sNode.bodies[sOwn + i].y - enemyStriker.y) : 999;
          if (d < bestChkD) { bestChkD = d; chkI = i; }
        }
        if (chkI >= 0 && enemyStriker) {
          const cb = sNode.bodies[sOwn + chkI], cSup = supKeyOf(chkI);
          const armC = (cSup === 'knockout' || cSup === 'shockwave' || cSup === 'colossus') ? cSup : null;
          const mvC = aim(cb, enemyStriker.x + (enemyStriker.vx || 0) * 0.14, enemyStriker.y + (enemyStriker.vy || 0) * 0.14, 220, armC, 0);
          if (armC) mvC.superArm = true;
          lockdown[chkI] = mvC;
        }
        addPlay(lockdown);

        const joint = jointTeamPlays(sNode, side, base, sJobs);
        let bestShooter = -1, bestShootD = Infinity, carrierI = -1;
        for (let i = 0; i < 3; i++) {
          const b = sNode.bodies[sOwn + i];
          if (b.stunned || b.carded) continue;
          if (b.holding) carrierI = i;
          if (behindBall(b, sBall, side)) {
            const d = Math.hypot(b.x - sBall.x, b.y - sBall.y);
            if (d < bestShootD) { bestShootD = d; bestShooter = i; }
          }
        }
        if (carrierI >= 0 && joint.length > 0) {
          addPlay(joint[0]);
        } else if (bestShooter >= 0) {
          const sb = sNode.bodies[sOwn + bestShooter], sSup = supKeyOf(bestShooter);
          const armS = (sSup === 'cannonball' || sSup === 'sticky' || sSup === 'ghost' || sSup === 'magnet') ? sSup : null;
          const snipeSpin = !sAp.open && sAp.blocker ? -sAp.blocker.side * (side ? 1 : -1) : (isPointBlank(sb, sBall) ? (sAp.y <= RINK_CY ? 1 : -1) * (side ? 1 : -1) : 0);
          const snipeTargetY = !sAp.open && sAp.blocker ? (sAp.blocker.body.y >= RINK_CY ? GOAL_Y_TOP + 21 : GOAL_Y_BOT - 21) : sAp.y;
          const snipeMv = strike(sb, sBall, sAtkGoal, snipeTargetY, armS, snipeSpin, SHOT_DRIVE);
          snipeMv.power = 1;
          if (armS) snipeMv.superArm = true;
          const snipePlay = lockdown.slice();
          snipePlay[bestShooter] = snipeMv;
          if (!sAp.open && sAp.blocker) {
            const brkI = 3 - defI - bestShooter;
            if (brkI >= 0 && brkI < 3 && brkI !== bestShooter && !sNode.bodies[sOwn + brkI].stunned) {
              const bb = sNode.bodies[sOwn + brkI], bSup = supKeyOf(brkI);
              const armB = (bSup === 'knockout' || bSup === 'shockwave' || bSup === 'colossus') ? bSup : null;
              const bMv = aim(bb, sAp.blocker.body.x, sAp.blocker.body.y, 230, armB, 0);
              if (armB) bMv.superArm = true;
              snipePlay[brkI] = bMv;
            }
          }
          addPlay(snipePlay);
        } else {
          for (let i = 0; i < 3; i++) {
            const b = sNode.bodies[sOwn + i];
            if (!b.stunned && supKeyOf(i) === 'magnet' && Math.hypot(b.x - sBall.x, b.y - sBall.y) < 330) {
              const mDrag = lockdown.slice();
              const dm = aim(b, sAtkGoal + (side ? 52 : -52), sAp.y, 310, 'magnet', 0);
              dm.superArm = true;
              mDrag[i] = dm;
              addPlay(mDrag);
              break;
            }
          }
        }

        if (bestShooter >= 0 && portfolio.length < cap) {
          const sb = sNode.bodies[sOwn + bestShooter];
          const oppJobs = roles(sNode, 1 - side);
          const oppDefI = oppJobs.indexOf('defend');
          const oppGoalieY = sEnemies[oppDefI >= 0 ? oppDefI : 0]?.y ?? RINK_CY;
          const bInfo = bestBankTargetY(sBall, sAtkGoal, oppGoalieY, sEnemies);
          const chosenBankY = bInfo
            ? bInfo.bankY
            : (sBall.y < RINK_CY ? (2 * (RINK_TOP + sBallR) - (RINK_CY + 24)) : (2 * (RINK_BOTTOM - sBallR) - (RINK_CY - 24)));
          const bankMv = strike(sb, sBall, sAtkGoal, chosenBankY, null, 0, SHOT_DRIVE);
          bankMv.power = 1;
          const bankPlay = lockdown.slice();
          bankPlay[bestShooter] = bankMv;
          addPlay(bankPlay);
        }
        if (portfolio.length < cap) {
          const pureGuard = [0, 1, 2].map(i => {
            const b = sNode.bodies[sOwn + i];
            if (b.stunned) return HOLD;
            if (Boolean(sNode.fouls?.crease?.[side]) && M.inCrease(P, b, side)) return lockdown[i];
            return GUARD;
          });
          addPlay(pureGuard);
        }
        for (let jp = 0; jp < joint.length && portfolio.length < cap; jp++) addPlay(joint[jp]);
        return portfolio;
      }

      function evalMultiTurn(sNode, remPulseDepth, cap) {
        const ourPlays = buildTurn2Portfolio(sNode, team, cap);
        const oppPlays = buildTurn2Portfolio(sNode, 1 - team, cap);
        const nOur = ourPlays.length, nOpp = oppPlays.length;
        const canDecS2 = !pulse && !sNode.fouls?.crease?.[0] && !sNode.fouls?.crease?.[1] && sNode.fouls?.corner === null;
        let bestRowVal = -Infinity;
        let bestSaddleState = null;

        for (let a = 0; a < nOur; a++) {
          const ourMv = ourPlays[a];
          let sumB = 0, minB = Infinity, pruned = false;
          let worstStateRow = null;
          for (let b = 0; b < nOpp; b++) {
            const oppMv = oppPlays[b];
            const m6 = team
              ? [oppMv[0], oppMv[1], oppMv[2], ourMv[0], ourMv[1], ourMv[2]]
              : [ourMv[0], ourMv[1], ourMv[2], oppMv[0], oppMv[1], oppMv[2]];
            let s2Touches = 0, hitDec2 = false;
            const watch2 = canDecS2 ? { collide({ a: ca, b: cb, speed }) { if (M.toucher(ca, cb, speed)) s2Touches++; } } : null;
            const checkDec2 = canDecS2 ? bodies2 => {
              if (s2Touches > 0 && decided(bodies2)) { hitDec2 = true; return true; }
              return false;
            } : null;
            const res2 = M.resolveTurn(P, sNode, m6, {
              effects: false, fastSearch: true, fastTick: true, ticks: t2Horizon,
              decided: checkDec2, watch: watch2, preservePartial: !pulse
            });
            simulations++;
            t2SimsUsed++;
            const tDone2 = res2.replay.ticks;
            ticks += tDone2;
            const eb2 = res2.state.bodies;
            const partial2 = !pulse && !hitDec2 && res2.replay.goal === null && tDone2 < fullTurnTicks && !P.settled(eb2);
            const v = evaluateBodies(eb2, res2.state.fouls, team, res2.replay.goal, weights, 0, null, false, tmw, partial2, pulse, nnCtx);
            sumB += v;
            if (v < minB) {
              minB = v;
              worstStateRow = res2.replay.goal === null ? res2.state : null;
            }

            if (b + 1 < nOpp && bestRowVal > -Infinity) {
              const rem = nOpp - (b + 1);
              const upper = ((sumB + rem * maxGoal) / nOpp) * (1 - settings.risk) + Math.min(minB, maxGoal) * settings.risk;
              if (upper < bestRowVal - 15) {
                pruned = true;
                break;
              }
            }
          }
          if (!pruned) {
            const rowVal = (sumB / nOpp) * (1 - settings.risk) + minB * settings.risk;
            if (rowVal > bestRowVal) {
              bestRowVal = rowVal;
              bestSaddleState = worstStateRow;
            }
          }
        }

        // Deeper Pulse Turn-3 Chaining (Ububall God: 3 continuous 1-second turns of carry-over momentum & supers)
        if (pulse && remPulseDepth > 0 && t2SimsUsed + 4 <= maxT2Sims && bestSaddleState && Math.abs(bestRowVal) < weights.goal * 0.55) {
          const v3 = evalMultiTurn(bestSaddleState, remPulseDepth - 1, 2);
          const clampedV3 = Math.max(-weights.goal * 0.94, Math.min(weights.goal * 0.94, v3));
          bestRowVal = (1 - GAMMA_T2) * bestRowVal + GAMMA_T2 * clampedV3;
        }
        return bestRowVal;
      }

      function bridgeAndEvalTurn2(moves, oppMoves, rawV1) {
        if (t2SimsUsed >= maxT2Sims || rawV1 >= weights.goal * 0.90 || rawV1 <= -weights.goal * 0.85) {
          return { blended: rawV1, delta: 0 };
        }
        const bridgeMoves = team
          ? [oppMoves[0], oppMoves[1], oppMoves[2], moves[0], moves[1], moves[2]]
          : [moves[0], moves[1], moves[2], oppMoves[0], oppMoves[1], oppMoves[2]];
        const bridgeTicks = pulse ? fullTurnTicks : Math.min(fullTurnTicks, 1680);
        const res1 = M.resolveTurn(P, state, bridgeMoves, {
          effects: false, fastSearch: true, fastTick: true, ticks: bridgeTicks,
          decided: null, preservePartial: false
        });
        simulations++;
        t2SimsUsed++;
        ticks += res1.replay.ticks;

        if (res1.replay.goal !== null) {
          const settledGoalVal = res1.replay.goal === team ? weights.goal : -weights.goal;
          return { blended: settledGoalVal, delta: settledGoalVal - rawV1 };
        }
        if (res1.state.winner !== null) {
          return { blended: rawV1, delta: 0 };
        }
        const s2 = res1.state;
        const v1Settled = evaluateBodies(s2.bodies, s2.fouls, team, null, weights, 0, null, false, tmw, false, pulse, nnCtx);
        const v2 = evalMultiTurn(s2, extraPulseDepth, t2Breadth);
        const clampedV2 = Math.max(-weights.goal * 0.96, Math.min(weights.goal * 0.96, v2));
        const swing = clampedV2 - v1Settled;
        const absSwing = Math.abs(swing);
        const isTactical = Math.abs(clampedV2) >= 2200 || absSwing >= 130;
        const gain = isTactical ? GAMMA_T2 : 0.18;
        const settledShift = pulse ? 0 : (v1Settled - rawV1) * 0.5;
        const delta = settledShift + gain * swing;
        return { blended: rawV1 + delta, delta };
      }

      let bestAfterT2 = -Infinity;
      function applyTurn2ToCandidate(cand, allowPrune, rankIdx = 0) {
        if (!cand || cand.t2Checked || !cand.values || !cand.values.length) return;
        ensureWobbled(cand);
        cand.t2Checked = true;
        if (allowPrune && bestAfterT2 > -Infinity && cand.value + weights.goal * 0.58 < bestAfterT2 - pruneMargin) {
          return;
        }
        let worstIdx = 0;
        for (let r = 1; r < cand.values.length; r++) {
          if (cand.values[r] < cand.values[worstIdx]) worstIdx = r;
        }
        const bWorst = bridgeAndEvalTurn2(cand.moves, responses[worstIdx] || responses[0], cand.values[worstIdx]);
        let b0 = null;
        if (worstIdx !== 0 && t2SimsUsed + 6 <= maxT2Sims && ((settings.godBridgeDual && rankIdx < 2) || bWorst.delta > 350 || cand.values[0] >= weights.goal * 0.70)) {
          b0 = bridgeAndEvalTurn2(cand.moves, responses[0], cand.values[0]);
        }

        const nextVals = cand.values.slice();
        nextVals[worstIdx] = bWorst.blended;
        if (b0) nextVals[0] = b0.blended;

        const consDelta = b0 ? Math.min(b0.delta, bWorst.delta) : bWorst.delta;
        if (consDelta > 0) {
          for (let r = 0; r < nextVals.length; r++) {
            if (r === worstIdx || (b0 && r === 0)) continue;
            if (Math.abs(nextVals[r]) < weights.goal * 0.70) {
              nextVals[r] += consDelta * 0.85;
            }
          }
        }
        cand.values = nextVals;
        cand.value = combineValues(nextVals, cand.fit);
        if (cand.value > bestAfterT2) bestAfterT2 = cand.value;
      }

      const nInspect = Math.min(contenders.length, lookaheadTop);
      for (let idx = 0; idx < nInspect; idx++) {
        applyTurn2ToCandidate(contenders[idx], idx > 0, idx);
      }
      contenders.sort((a, b) => b.value - a.value);

      // Lazy promotion guard: if inspected leaders dropped into a Turn-2 trap so an un-inspected candidate rose to #1, verify #1 too!
      let extraChecks = 0;
      while (contenders.length && !contenders[0].t2Checked && t2SimsUsed < maxT2Sims && extraChecks < 2) {
        extraChecks++;
        applyTurn2ToCandidate(contenders[0], false);
        contenders.sort((a, b) => b.value - a.value);
      }
    }
    finalPool = contenders;
  }

  return { finalPool, simulations, ticks };
}

module.exports = { runMultiTurnLookahead };
