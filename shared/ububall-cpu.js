/* Deterministic, bounded team search. Uses the same turn resolver as matches. */
(function(root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const P = node ? require('./ububall-physics.js') : root.ububallPhysics;
  const M = node ? require('./ububall-match.js') : root.ububallMatch;
  const HOLD = Object.freeze({ angle: 0, power: 0, spin: 0, superArm: false, guard: false });
  const GUARD = Object.freeze({ ...HOLD, guard: true });
  const LEVEL_LABELS = Object.freeze({
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard',
    insane: 'Insane',
    god: 'Ububall God'
  });
  const LEVELS = Object.freeze({
    easy: Object.freeze({ candidates: 14, opponents: 1, searchTicks: 240, wobble: false, risk: .15, temperature: 45 }),
    medium: Object.freeze({ candidates: 48, opponents: 2, searchTicks: 420, wobble: true, risk: .35, temperature: 3.0 }),
    hard: Object.freeze({ candidates: 84, opponents: 3, searchTicks: 500, wobble: true, risk: .53, temperature: 1.5, counterBudget: 13, counterTop: 5, counterRounds: 1, learn: true }),
    insane: Object.freeze({ candidates: 150, opponents: 4, searchTicks: 580, wobble: true, godRefine: true, risk: .55, temperature: .8, counterBudget: 26, counterTop: 8, counterRounds: 1, learn: true, lookaheadTop: 4, lookaheadBreadth: 4, lookaheadTicks: 300, lookaheadBudget: 56, pulseDepth: 2 }),
    god: Object.freeze({ candidates: 240, opponents: 4, searchTicks: 720, wobble: true, godWobble: true, godRefine: true, risk: .55, temperature: .4, counterBudget: 36, counterTop: 10, counterRounds: 2, learn: true, lookaheadTop: 5, lookaheadBreadth: 4, lookaheadTicks: 340, lookaheadBudget: 96, godBridgeDual: true, pulseDepth: 3 })
  });
  const WEIGHTS = Object.freeze({
    goal: 10000, progress: 1, access: .7, cover: .6, chance: 200, meter: .35,
    role: 8, card: 400, warning: 150, stun: 185, daze: 120
  });
  const SUPER_RESERVE_BONUS = 28;
  const WOBBLE = Object.freeze({ angle: .035, power: .05 });
  const COMPLEX = Object.freeze({ simple: 1, creative: .002 });
  const ROLE_INTENTS = Object.freeze({
    attack: ['shoot', 'pass', 'carry', 'magnet'],
    support: ['chase', 'clear', 'receive', 'check', 'pass', 'shoot', 'rim', 'draft', 'magnet'],
    defend: ['cover', 'guard', 'hold', 'clear', 'rim', 'magnet']
  });
  const SEARCH_TICKS = 420;
  const TWO_PI = 2 * Math.PI;

  const RINK = P?.rink ?? { left: 60, right: 940, top: 60, bottom: 540, corner: 100, goalTop: 230, goalBottom: 370 };
  const RINK_LEFT = RINK.left, RINK_RIGHT = RINK.right;
  const RINK_TOP = RINK.top, RINK_BOTTOM = RINK.bottom;
  const RINK_CX = (RINK_LEFT + RINK_RIGHT) * 0.5;
  const RINK_CY = (RINK_TOP + RINK_BOTTOM) * 0.5;
  const RINK_SPAN = RINK_RIGHT - RINK_LEFT;
  const GOAL_Y_TOP = RINK.goalTop ?? (RINK_CY - 70);
  const GOAL_Y_BOT = RINK.goalBottom ?? (RINK_CY + 70);
  const SKATER_CURVE = P?.SKATER_CURVE ?? .06, SPIN_DECAY = P?.SPIN_DECAY ?? 5;
  const AIR_DRAG = P?.AIR_DRAG ?? 0.00015;
  const WALL_RESTITUTION = P?.SURFACES?.wall?.restitution ?? 0.82;
  const SHOT_DRIVE = 2400;

  function decided(bodies) {
    const ball = bodies[6];
    if (ball.vx || ball.vy || ball.onFire || P.holder(bodies)) return false;
    if (M.cornerOf(P, ball.x, ball.y) !== null) return false;
    if (M.camping(P, bodies, 0) || M.camping(P, bodies, 1)) return false;
    const goalY = (GOAL_Y_TOP + GOAL_Y_BOT) * 0.5;
    const az0 = M.attackZoneLine(P, 0), az1 = M.attackZoneLine(P, 1);
    const baseCut = P.TAILGATE?.frictionCut ?? .4;
    const maxPackCut = P.PACK_DRAFT?.maxCut ?? baseCut;
    const packExp = P.PACK_DRAFT?.exp ?? 0.5;
    for (let i = 0; i < 6; i++) {
      const b = bodies[i];
      if (b.superActive) return false;
      const speed2 = b.vx * b.vx + b.vy * b.vy;
      if (!speed2) continue;
      const speed = Math.sqrt(speed2);
      let maxTeamSyn = 1;
      const tStart = b.team === 0 ? 0 : 3;
      for (let k = tStart; k < tStart + 3; k++) {
        if (k !== i && bodies[k] && !bodies[k].carded && (bodies[k].synergyMult ?? 1) > maxTeamSyn) {
          maxTeamSyn = bodies[k].synergyMult ?? 1;
        }
      }
      const packMult = P.PACK_DRAFT ? (maxTeamSyn * (b.chemistryMult ?? 1)) ** packExp : 1;
      const maxCut = Math.min(maxPackCut, Math.max(baseCut, baseCut * packMult));
      const stopDist = speed2 / (2 * b.friction * (1 - maxCut));
      const contact = Math.max(b.radius, b.reach || b.radius, 18) + ball.radius;
      const ballReach = stopDist + contact;
      const dbx = b.x - ball.x, dby = b.y - ball.y, db2 = dbx * dbx + dby * dby;
      if (db2 <= (ballReach + 1e-4) * (ballReach + 1e-4)) {
        if (db2 < (ballReach - 1e-4) * (ballReach - 1e-4) || Math.hypot(dbx, dby) - contact <= stopDist) return false;
      }
      const ownGoalX = b.team ? RINK_RIGHT : RINK_LEFT;
      const creaseReach = stopDist + M.FOULS.crease;
      const dgx = b.x - ownGoalX, dgy = b.y - goalY, dg2 = dgx * dgx + dgy * dgy;
      if (dg2 <= (creaseReach + 1e-4) * (creaseReach + 1e-4)) {
        if (dg2 < (creaseReach - 1e-4) * (creaseReach - 1e-4) || Math.hypot(dgx, dgy) - M.FOULS.crease <= stopDist) return false;
      }
      const stopX = b.x + (b.vx / speed) * stopDist;
      const oppAz = b.team ? az0 : az1;
      if ((b.x - oppAz) * (stopX - oppAz) <= 0) return false;
      const oStart = b.team === 0 ? 3 : 0;
      for (let j = oStart; j < oStart + 3; j++) {
        const o = bodies[j];
        if (o.carded) continue;
        const dx = o.x - b.x, dy = o.y - b.y;
        if (dx * b.vx + dy * b.vy <= 0) continue;
        const oppReach = stopDist + b.radius + o.radius;
        const do2 = dx * dx + dy * dy;
        if (do2 <= (oppReach + 1e-4) * (oppReach + 1e-4)) {
          if (do2 < (oppReach - 1e-4) * (oppReach - 1e-4) || Math.hypot(dx, dy) - b.radius - o.radius <= stopDist) return false;
        }
      }
    }
    return true;
  }

  function randomSource(seed = 1) {
    let value = seed >>> 0;
    return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
  }
  const contactRadius = b => Math.max(b.radius, b.reach || b.radius, 18);

  function skaterDrive(body, superKey = null, spin = 0) {
    const superScale = superKey === 'colossus' && body.superActive !== 'colossus'
      ? (P.SUPER.colossusLaunch ?? (1 / P.SUPER.colossusMass))
      : (superKey === 'stalwart' && body.superActive !== 'stalwart' ? (P.SUPER.stalwartLaunch ?? 0.5) : 1);
    const carveBoost = spin && P.carveDriveBoost ? P.carveDriveBoost(body, spin) : 1;
    const maxV = P.launchSpeed(body) * superScale * carveBoost;
    const frictionMult = (superKey === 'stalwart' || body.superActive === 'stalwart')
      ? (P.SUPER.stalwartFriction ?? 3)
      : (body.holding ? (P.SUPER.carryFriction ?? 1.5) : 1);
    return { maxV, effFriction: body.friction * frictionMult };
  }

  function segmentBlocked(ax, ay, bx, by, obstacles, clearance = 38) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    if (len2 < 1) return null;
    let best = null, bestT = 2;
    for (let i = 0; i < obstacles.length; i++) {
      const ob = obstacles[i];
      const t = Math.max(0, Math.min(1, ((ob.x - ax) * dx + (ob.y - ay) * dy) / len2));
      if (t <= 0.05 || t >= 0.98) continue;
      const px = ax + t * dx, py = ay + t * dy;
      const dist = Math.hypot(ob.x - px, ob.y - py);
      if (dist < (ob.radius || 25) + clearance && t < bestT) {
        bestT = t;
        best = { body: ob, dist, side: (dx * (ob.y - ay) - dy * (ob.x - ax)) >= 0 ? 1 : -1 };
      }
    }
    return best;
  }

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
  function integrateSpinArc(v0, effFriction, arcDist, omega0, curveF) {
    if (v0 <= 1e-6 || arcDist <= 1e-6) return { chordAngle: 0, chordRatio: 1, endTheta: 0, endSpeed: v0, endOmega: omega0 };
    const disc = Math.max(0, v0 * v0 - 2 * effFriction * arcDist);
    const T = effFriction > 0 ? (v0 - Math.sqrt(disc)) / effFriction : arcDist / v0;
    if (T <= 1e-6) return { chordAngle: 0, chordRatio: 1, endTheta: 0, endSpeed: v0, endOmega: omega0 };
    const dt = T * 0.125;
    const absW0 = Math.abs(omega0), signW = omega0 < 0 ? -1 : 1;
    let sx = 0, sy = 0, sArc = 0, th = 0;
    for (let k = 0; k < 8; k++) {
      const t0 = k * dt, tm = t0 + 0.5 * dt, t1 = t0 + dt;
      const effDecel = effFriction + AIR_DRAG * v0 * v0 * 0.55;
      const v = v0 > effDecel * tm ? v0 - effDecel * tm : 0;
      const w0 = absW0 > SPIN_DECAY * t0 ? signW * (absW0 - SPIN_DECAY * t0) : 0;
      const wm = absW0 > SPIN_DECAY * tm ? signW * (absW0 - SPIN_DECAY * tm) : 0;
      const w1 = absW0 > SPIN_DECAY * t1 ? signW * (absW0 - SPIN_DECAY * t1) : 0;
      const thMid = th + curveF * 0.25 * (w0 + wm) * dt;
      sx += v * Math.cos(thMid) * dt;
      sy += v * Math.sin(thMid) * dt;
      sArc += v * dt;
      th += curveF * 0.5 * (w0 + w1) * dt;
    }
    const chord = Math.hypot(sx, sy);
    const endDecel = effFriction + AIR_DRAG * v0 * v0 * 0.55;
    const endSpeed = v0 > endDecel * T ? v0 - endDecel * T : 0;
    const endOmega = absW0 > SPIN_DECAY * T ? signW * (absW0 - SPIN_DECAY * T) : 0;
    return {
      chordAngle: chord > 1e-6 ? Math.atan2(sy, sx) : 0,
      chordRatio: sArc > 1e-6 ? Math.max(0.55, Math.min(1, chord / sArc)) : 1,
      endTheta: th,
      endSpeed,
      endOmega
    };
  }

  function aim(body, x, y, drive = 0, superKey = null, spin = 0) {
    const dx = x - body.x, dy = y - body.y;
    const distance = Math.hypot(dx, dy);
    const clampedSpin = spin ? Math.max(-1, Math.min(1, spin)) : 0;
    const { maxV, effFriction } = skaterDrive(body, superKey, clampedSpin);

    let speed = distance < 2 ? 0 : Math.min(maxV, Math.sqrt(2 * effFriction * Math.max(0, distance + drive)));
    let chordAngle = 0;
    if (clampedSpin && speed > 0 && distance >= 2) {
      const omega0 = clampedSpin * (body.maxSpin || P.BASE_MAX_SPIN || 20);
      const curveF = body.curveFactor ?? SKATER_CURVE;
      const pass1 = integrateSpinArc(speed, effFriction, distance, omega0, curveF);
      const arcDist = distance / pass1.chordRatio;
      speed = Math.min(maxV, Math.sqrt(2 * effFriction * Math.max(0, arcDist + drive)));
      chordAngle = integrateSpinArc(speed, effFriction, arcDist, omega0, curveF).chordAngle;
    }

    const vSpeed = Math.hypot(body.vx || 0, body.vy || 0);
    if (vSpeed <= 10 || speed === 0) {
      return {
        angle: speed === 0 ? Math.atan2(dy, dx) : Math.atan2(dy, dx) - chordAngle,
        power: maxV > 0 ? speed / maxV : 0,
        spin: speed === 0 ? 0 : clampedSpin,
        superArm: false,
        guard: false
      };
    }

    const dist = distance || 1;
    let ux = dx / dist, uy = dy / dist;
    if (chordAngle) {
      const c = Math.cos(-chordAngle), sn = Math.sin(-chordAngle);
      const rux = ux * c - uy * sn, ruy = ux * sn + uy * c;
      ux = rux; uy = ruy;
    }
    const vxTarget = ux * speed, vyTarget = uy * speed;
    const reSteerMult = (body.sizeMult || 1) ** P.SIZE.agility * ((body.grip ?? .3) / .3) ** (P.ICE_BITE?.gripCutExp ?? 0);
    const effSteer = 1 + Math.min(1, vSpeed / (maxV || 1)) * (reSteerMult - 1);
    const steerLimit = maxV * effSteer;
    const deltaX = vxTarget - (body.vx || 0), deltaY = vyTarget - (body.vy || 0);
    const deltaDist = Math.hypot(deltaX, deltaY);

    let aimVx, aimVy;
    if (deltaDist <= steerLimit) {
      aimVx = vxTarget;
      aimVy = vyTarget;
    } else {
      const vbPar = (body.vx || 0) * ux + (body.vy || 0) * uy;
      const vbPerp2 = Math.max(0, ((body.vx || 0) ** 2 + (body.vy || 0) ** 2) - vbPar * vbPar);
      if (steerLimit * steerLimit >= vbPerp2) {
        const k = Math.max(0, Math.min(speed, vbPar + Math.sqrt(steerLimit * steerLimit - vbPerp2)));
        aimVx = ux * k;
        aimVy = uy * k;
      } else {
        aimVx = (body.vx || 0) + (deltaX / deltaDist) * steerLimit;
        aimVy = (body.vy || 0) + (deltaY / deltaDist) * steerLimit;
      }
    }

    const aimSpeed = Math.hypot(aimVx, aimVy);
    return {
      angle: Math.atan2(aimVy, aimVx),
      power: maxV > 0 ? Math.min(1, aimSpeed / maxV) : 0,
      spin: aimSpeed > 0 ? clampedSpin : 0,
      superArm: false,
      guard: false
    };
  }

  function ballTraceKey(ball) {
    return [ball.x, ball.y, ball.vx, ball.vy, ball.omega, ball.radius, ball.friction,
      ball.curveMult, ball.maxSpin, ball.pace, ball.fireTicks, ball.onFire].join(',');
  }

  const movingBallCache = new WeakMap();
  // Memoized 1-body canonical ball trajectory (every 2 ticks up to 0.90s) including spin curve, walls, corners & posts.
  function traceMovingBall(ball) {
    if (!ball || ball.stickOffset) return null;
    const vx0 = ball.vx || 0, vy0 = ball.vy || 0;
    if (vx0 * vx0 + vy0 * vy0 <= 400) return null;
    const sig = ballTraceKey(ball);
    let cached = movingBallCache.get(ball);
    if (cached && cached.sig === sig) return cached.samples;

    const sim = [{ ...ball, team: -1, stickOffset: null }];
    const bSim = sim[0];
    const samples = [];
    const maxTicks = 216; // 0.90s at 240 Hz
    for (let t = 1; t <= maxTicks; t++) {
      const g = P.step(sim, P.DT);
      if (g !== null) break;
      if ((t & 1) === 0) {
        samples.push({ t: t * P.DT, x: bSim.x, y: bSim.y, vx: bSim.vx, vy: bSim.vy });
      }
      if (!bSim.vx && !bSim.vy) break;
    }
    movingBallCache.set(ball, { sig, samples });
    return samples;
  }

  function skaterTravelTime(dist, v0, decel) {
    if (dist <= 1) return 0;
    if (v0 <= 1) return Infinity;
    if (decel <= 1e-4) return dist / v0;
    const disc = v0 * v0 - 2 * decel * dist;
    if (disc >= 0) return (v0 - Math.sqrt(disc)) / decel;
    return Infinity;
  }

  function matchBallIntercept(body, ball, contact, drive, superKey, spin, goalX = null, goalY = null) {
    const samples = traceMovingBall(ball);
    if (!samples || !samples.length) return null;
    const { maxV, effFriction } = skaterDrive(body, superKey, spin);
    const bodySpd = Math.hypot(body.vx || 0, body.vy || 0);
    let best = null, bestErr = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.x < RINK_LEFT + 34 || s.x > RINK_RIGHT - 34 || s.y < RINK_TOP + 30 || s.y > RINK_BOTTOM - 30) continue;
      let cx = s.x, cy = s.y;
      if (goalX !== null && goalY !== null) {
        const gd = Math.hypot(goalX - s.x, goalY - s.y) || 1;
        cx = s.x - ((goalX - s.x) / gd) * contact;
        cy = s.y - ((goalY - s.y) / gd) * contact;
      }
      const dist = Math.hypot(cx - body.x, cy - body.y);
      const vLaunch = Math.min(maxV, Math.sqrt(2 * effFriction * Math.max(0, dist + drive)));
      let vEff = vLaunch;
      if (bodySpd > 25 && dist > 4) {
        const align = ((body.vx || 0) * (cx - body.x) + (body.vy || 0) * (cy - body.y)) / (bodySpd * dist);
        if (align < -0.25) vEff = Math.max(120, vLaunch * 0.84);
      }
      const decel = effFriction + AIR_DRAG * vEff * vEff * 0.45;
      const tReach = skaterTravelTime(dist, vEff, decel);
      const err = Math.abs(tReach - s.t);
      if (tReach <= s.t + 0.035) {
        return s;
      }
      if (err < bestErr) {
        bestErr = err;
        best = s;
      }
    }
    return bestErr < 0.14 ? best : samples[Math.min(samples.length - 1, 18)];
  }

  function strike(body, ball, x, y, superKey = null, spin = 0, drive = null) {
    const effRadius = superKey === 'colossus' && body.superActive !== 'colossus'
      ? Math.max(body.baseRadius ?? body.radius, P.SUPER.colossusRadius)
      : body.radius;
    const contact = Math.max(effRadius, body.reach || effRadius, 18) + ball.radius - 1;
    const clampedSpin = spin ? Math.max(-1, Math.min(1, spin)) : 0;
    const effDrive = drive !== null ? drive : (clampedSpin ? 1200 : 260);

    let leadX = ball.x, leadY = ball.y;
    let leadBvx = ball.vx || 0, leadBvy = ball.vy || 0;
    const ballSpeed = Math.hypot(leadBvx, leadBvy);
    if (!ball.stickOffset && ballSpeed > 20) {
      const hitSample = matchBallIntercept(body, ball, contact, effDrive, superKey, clampedSpin, x, y);
      if (hitSample) {
        leadX = Math.max(RINK_LEFT + 34, Math.min(RINK_RIGHT - 34, hitSample.x));
        leadY = Math.max(RINK_TOP + 30, Math.min(RINK_BOTTOM - 30, hitSample.y));
        leadBvx = hitSample.vx;
        leadBvy = hitSample.vy;
      } else {
        const boost = clampedSpin && P.carveDriveBoost ? P.carveDriveBoost(body, clampedSpin) : 1;
        const tLead = Math.min(0.45, Math.hypot(ball.x - body.x, ball.y - body.y) / Math.max(180, P.launchSpeed(body) * boost));
        const friction = ball.friction ?? 85;
        const decel = friction + AIR_DRAG * ballSpeed * ballSpeed;
        const avgSpeed = Math.max(0, ballSpeed - 0.5 * decel * tLead);
        leadX = Math.max(RINK_LEFT + 40, Math.min(RINK_RIGHT - 40, ball.x + (leadBvx / ballSpeed) * avgSpeed * tLead));
        leadY = Math.max(RINK_TOP + 40, Math.min(RINK_BOTTOM - 40, ball.y + (leadBvy / ballSpeed) * avgSpeed * tLead));
      }
    }

    const d = Math.hypot(x - leadX, y - leadY) || 1;
    let ux = (x - leadX) / d, uy = (y - leadY) / d;

    // Compensate contact normal for incoming lateral ball momentum on moving rebounds / one-timers.
    if (!ball.stickOffset && (leadBvx * leadBvx + leadBvy * leadBvy) > 900) {
      const { maxV, effFriction } = skaterDrive(body, superKey, clampedSpin);
      const approxDist = Math.hypot((leadX - ux * contact) - body.x, (leadY - uy * contact) - body.y);
      const vEst = Math.min(maxV, Math.sqrt(2 * effFriction * Math.max(0, approxDist + effDrive)));
      const estOutSpd = Math.max(240, vEst * (body.power || 1) * 0.95);
      const latBall = leadBvx * (-uy) + leadBvy * ux;
      const latKeep = 0.68;
      const sinComp = Math.max(-0.42, Math.min(0.42, (latBall * latKeep) / estOutSpd));
      const compAng = -Math.asin(sinComp);
      const cc = Math.cos(compAng), cs = Math.sin(compAng);
      const nux = ux * cc - uy * cs, nuy = ux * cs + uy * cc;
      ux = nux; uy = nuy;
    }

    const hitR = P.ballHitRadius ? P.ballHitRadius(body) : Math.max(effRadius, body.reach || effRadius, 18);
    const launchGap = Math.hypot(ball.x - body.x, ball.y - body.y) - hitR - ball.radius;
    const prox = launchGap < 4 * ball.radius ? Math.max(0, Math.min(1, 1 - launchGap / (4 * ball.radius))) : 0;
    if (clampedSpin || prox > 0) {
      // Pre-compensate contact normal for tangential grip kick, canonical spinStrike/closeSpin, point-blank strikeBoost & Magnus curve.
      const approxCx = leadX - ux * contact, approxCy = leadY - uy * contact;
      const appDist = Math.hypot(approxCx - body.x, approxCy - body.y);
      const { maxV, effFriction } = skaterDrive(body, superKey, clampedSpin);
      const strikeDrive = Math.max(1200, effDrive);
      const v0 = Math.min(maxV, Math.sqrt(2 * effFriction * Math.max(0, appDist + strikeDrive)));
      const arc = integrateSpinArc(v0, effFriction, appDist, clampedSpin * (body.maxSpin || P.BASE_MAX_SPIN || 20), body.curveFactor ?? SKATER_CURVE);
      const vImp = Math.max(80, arc.endSpeed);
      const arrivalSkew = arc.endTheta - arc.chordAngle;
      const vn = vImp * Math.cos(arrivalSkew), vt = vImp * Math.sin(arrivalSkew);
      const mP = body.mass || 3, mB = ball.mass || 1, invSum = 1 / mP + 1 / mB;
      const rest = 0.88;
      const baseImp = (1 + rest) * Math.max(40, vn) / invSum;
      const elasticCap = (2 * mP / (mP + mB)) * Math.max(40, vn);
      const dvnB = Math.min(elasticCap, (baseImp * (body.power || 1)) / mB);
      const slip = -vt - arc.endOmega * effRadius;
      const gripPair = Math.sqrt((body.grip ?? 0.3) * (ball.grip ?? 0.3));
      const lim = gripPair * baseImp;
      const tang = Math.max(-lim, Math.min(lim, -slip / (3 * invSum)));
      const dvtB = tang / mB;
      let wBall = Math.max(-24, Math.min(24, -2 * tang / (mB * ball.radius)));

      const spinStrikeGain = (P.STRIKE_GAIN ?? 1) + ((P.CLOSE_SPIN_GAIN ?? 2) - (P.STRIKE_GAIN ?? 1)) * prox * prox * (3 - 2 * prox);
      const small = (body.sizeMult || 1) ** (P.SIZE?.strike ?? -0.5);
      const closeSpin = -spinStrikeGain * arc.endOmega * small * (body.curveMult ?? 1);
      wBall = Math.max(-24, Math.min(24, wBall + closeSpin));

      const strikeBoost = vImp >= (P.STRIKE_MIN_SPEED ?? 180)
        ? small * (P.STRIKE_POWER ?? 0.5) * (spinStrikeGain - 1) * vImp
        : 0;
      const postSpeed = Math.max(160, Math.hypot(dvnB, dvtB) + strikeBoost);
      const ballFric = (ball.friction ?? 85) + AIR_DRAG * postSpeed * postSpeed * 0.6;
      const bCurveF = P.ballCurveFactor ? P.ballCurveFactor({ curveMult: body.curveMult ?? 1 }, false) : SKATER_CURVE * (body.curveMult ?? 1);
      const bPass1 = integrateSpinArc(postSpeed, ballFric, d, wBall, bCurveF);
      const bArc = integrateSpinArc(postSpeed, ballFric, d / bPass1.chordRatio, wBall, bCurveF);
      const ballDeflect = Math.atan2(dvtB, dvnB) + bArc.chordAngle;
      const c = Math.cos(-ballDeflect), sn = Math.sin(-ballDeflect);
      const rux = ux * c - uy * sn, ruy = ux * sn + uy * c;
      ux = rux; uy = ruy;
    }
    return aim(body, leadX - ux * contact, leadY - uy * contact, effDrive, superKey, clampedSpin);
  }

  const creativityOf = body => (body.personality?.creativity ?? 31.5) / 63;
  function behindBall(body, ball, team) {
    return team === 0 ? body.x <= ball.x + 12 : body.x >= ball.x - 12;
  }
  function isPointBlank(body, ball) {
    const reach = Math.max(body.radius, bReach(body), 18);
    return Math.hypot(body.x - ball.x, body.y - ball.y) - reach - ball.radius < 4 * ball.radius;
  }
  function bReach(body) { return body.reach || body.radius; }

  const INTENT = Symbol('intent');
  const MOVE_ID = Symbol('moveId');
  function tag(move, intent) {
    return {
      angle: move.angle, power: move.power, spin: move.spin,
      superArm: move.superArm, guard: move.guard, [INTENT]: intent
    };
  }
  function getIntent(move) { return move ? move[INTENT] : undefined; }
  function copy(move) {
    return {
      angle: move.angle, power: move.power, spin: move.spin,
      superArm: move.superArm, guard: move.guard, [INTENT]: move[INTENT]
    };
  }
  function fitsRole(job, move, body, state) {
    const intent = getIntent(move);
    if (ROLE_INTENTS[job]?.includes(intent)) return true;
    if (job === 'attack' && intent === 'check') {
      const sKey = body?.equippedSuper?.key?.toLowerCase();
      const carrier = state?.bodies && P.holder(state.bodies);
      const opponentHasBall = carrier && carrier.team >= 0 && carrier.team !== body?.team;
      if (opponentHasBall) return true;
      if (move.superArm && (sKey === 'knockout' || sKey === 'shockwave')) return true;
    }
    return false;
  }

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

  function options(state, team, index, base) {
    const body = state.bodies[team * 3 + index], ball = state.bodies[6];
    if (body.stunned) return [HOLD];
    const goal = team ? RINK_LEFT : RINK_RIGHT, ownGoal = RINK_LEFT + RINK_RIGHT - goal;
    const isBehind = behindBall(body, ball, team);
    const pointBlank = isPointBlank(body, ball);
    const dBall = Math.hypot(body.x - ball.x, body.y - ball.y);
    const hasSuper = !M.rule(state.mode, 'classic') && body.meter >= 100 && Boolean(body.equippedSuper);
    const sKey = body.equippedSuper?.key?.toLowerCase() || null;
    const oppStart = (1 - team) * 3;
    const opponents = [state.bodies[oppStart], state.bodies[oppStart + 1], state.bodies[oppStart + 2]];
    const aperture = scanGoalAperture(ball, goal, opponents);
    const cone = shotConePoint(ball.x, ball.y, team, 88);
    const allowPocket = canOccupyCrease(state, team, index);
    const pocket = goalPocketPoint(ball.x, ball.y, team, allowPocket);
    const threatInfo = assessOpponentThreat(state, team, M.rule(state.mode, 'classic'));
    const incoming = threatInfo.incoming;
    const d0 = Math.abs(state.bodies[team * 3].x - ownGoal);
    const d1 = Math.abs(state.bodies[team * 3 + 1].x - ownGoal);
    const d2 = Math.abs(state.bodies[team * 3 + 2].x - ownGoal);
    const isDefSkater = Math.abs(body.x - ownGoal) <= Math.min(d0, d1, d2) + 35;
    const creaseWarned = Boolean(state.fouls?.crease?.[team]) && M.inCrease(P, body, team);

    function generateMoves(superArmKey) {
      const arm = Boolean(superArmKey);
      const moves = [];
      const extraShots = [];
      const specialSupers = [];
      if (creaseWarned) {
        const exitX = ownGoal + (team ? -102 : 102);
        for (const exitY of [RINK_CY, RINK_CY - 55, RINK_CY + 55]) {
          moves.push(tag({ ...aim(body, exitX, exitY, 35, superArmKey, 0), superArm: arm }, 'cover'));
        }
        if (arm && superArmKey === 'stalwart') moves.push(tag({ ...GUARD, superArm: true }, 'guard'));
      } else {
        moves.push(tag({ ...HOLD, superArm: false }, 'hold'));
        moves.push(tag({ ...GUARD, superArm: arm && superArmKey === 'stalwart' }, 'guard'));
      }

      let carrier = null, bestEligible = null, bestEDist = Infinity;
      for (let oi = 0; oi < 3; oi++) {
        const op = opponents[oi];
        if (op.holding && !carrier) carrier = op;
        if (!op.stunned && !op.carded) {
          const ed = Math.hypot(op.x - ball.x, op.y - ball.y);
          if (ed < bestEDist) { bestEDist = ed; bestEligible = op; }
        }
      }
      const threat = carrier || bestEligible;

      // Non-contact Magnet fly-bys (screen pull-around, lead-in goal drag, and defensive crease yank)
      if (arm && superArmKey === 'magnet' && !body.holding) {
        const inDefZone = team ? ball.x > RINK_CX - 25 : ball.x < RINK_CX + 25;
        if (dBall < 340) {
          const openSide = aperture.blocker ? aperture.blocker.side : (ball.y < RINK_CY ? 1 : -1);
          const pullX = Math.max(RINK_LEFT + 48, Math.min(RINK_RIGHT - 48, ball.x + (team ? -145 : 145)));
          const pullY = Math.max(RINK_TOP + 52, Math.min(RINK_BOTTOM - 52, ball.y + openSide * 92));
          specialSupers.push(tag({ ...aim(body, pullX, pullY, 270, 'magnet', 0), superArm: true }, 'magnet'));
          if (!isBehind || !aperture.open) {
            const dragGoalX = goal + (team ? 52 : -52);
            specialSupers.push(tag({ ...aim(body, dragGoalX, aperture.y, 310, 'magnet', 0), superArm: true }, 'magnet'));
          }
        }
        if (inDefZone && dBall < 360) {
          const yankX = Math.max(RINK_LEFT + 120, Math.min(RINK_RIGHT - 120, ownGoal + (team ? -270 : 270)));
          const yankY = ball.y < RINK_CY ? RINK_TOP + 58 : RINK_BOTTOM - 58;
          specialSupers.push(tag({ ...aim(body, yankX, yankY, 250, 'magnet', 0), superArm: true }, 'magnet'));
        }
      }

      // Non-contact Shockwave multi-defender wedge & goal-crease forcefield dive
      if (arm && superArmKey === 'shockwave') {
        let bestPairD = 290, midX = 0, midY = 0, foundCluster = false;
        for (let a = 0; a < 3; a++) {
          const oa = opponents[a];
          if (oa.carded || oa.superActive === 'stalwart') continue;
          for (let b = a + 1; b < 3; b++) {
            const ob = opponents[b];
            if (ob.carded || ob.superActive === 'stalwart') continue;
            const pd = Math.hypot(oa.x - ob.x, oa.y - ob.y);
            if (pd < bestPairD) {
              bestPairD = pd;
              midX = (oa.x + ob.x) * 0.5 + ((oa.vx || 0) + (ob.vx || 0)) * 0.08;
              midY = (oa.y + ob.y) * 0.5 + ((oa.vy || 0) + (ob.vy || 0)) * 0.08;
              foundCluster = true;
            }
          }
        }
        if (foundCluster && Math.hypot(body.x - midX, body.y - midY) < 420) {
          const safeMx = Math.max(RINK_LEFT + 95, Math.min(RINK_RIGHT - 95, midX));
          const safeMy = Math.max(RINK_TOP + 45, Math.min(RINK_BOTTOM - 45, midY));
          specialSupers.push(tag({ ...aim(body, safeMx, safeMy, 215, 'shockwave', 0), superArm: true }, 'check'));
        }
        for (let oi = 0; oi < 3; oi++) {
          const op = opponents[oi];
          if (!op.carded && op.superActive !== 'stalwart' && Math.abs(op.x - goal) < 210 && Math.abs(op.y - RINK_CY) < 115) {
            const creaseClearX = goal + (team ? 112 : -112);
            specialSupers.push(tag({ ...aim(body, creaseClearX, op.y, 205, 'shockwave', 0), superArm: true }, 'check'));
            break;
          }
        }
      }

      if (body.holding) {
        moves.push(tag(stickyCarryMove(body, ball, goal, aperture.y, superArmKey, 0), 'carry'));
        moves.push(tag(stickyCarryMove(body, ball, goal, RINK_CY - 48, superArmKey, 0.75), 'carry'));
        moves.push(tag(stickyCarryMove(body, ball, goal, RINK_CY + 48, superArmKey, -0.75), 'carry'));
      } else if (isBehind && !(isDefSkater && threatInfo.shotDanger && dBall > 135 && Math.abs(ball.x - goal) > 520)) {
        let oppGoalie = opponents[0], bestGoalieD = Math.abs(opponents[0].x - goal);
        for (let oi = 1; oi < 3; oi++) {
          const gd = Math.abs(opponents[oi].x - goal);
          if (gd < bestGoalieD) { bestGoalieD = gd; oppGoalie = opponents[oi]; }
        }
        const goalieY = oppGoalie ? oppGoalie.y : RINK_CY;
        const farCornerY = goalieY >= RINK_CY ? GOAL_Y_TOP + 21 : GOAL_Y_BOT - 21;
        const nearCornerY = goalieY >= RINK_CY ? GOAL_Y_BOT - 21 : GOAL_Y_TOP + 21;
        const yOrder = aperture.open && aperture.y !== RINK_CY
          ? [aperture.y, Math.abs(farCornerY - aperture.y) < 12 ? RINK_CY : farCornerY, nearCornerY]
          : [farCornerY, RINK_CY, nearCornerY];
        const onWing = Math.abs(ball.y - RINK_CY) > 75;
        const benderSpin = sideSign => -sideSign * (team ? 1 : -1);

        // Point-blank Spin Strike (+50% bonus ball speed within 4 * ball.radius = 72 px)
        if (pointBlank) {
          const pbTargetY = aperture.open ? aperture.y : farCornerY;
          const pbSide = pbTargetY <= RINK_CY ? -1 : 1;
          const pbShot = strike(body, ball, goal, pbTargetY, superArmKey, -pbSide * (team ? 1 : -1), SHOT_DRIVE);
          pbShot.power = 1;
          moves.push(tag({ ...pbShot, superArm: arm }, 'shoot'));
        }

        // Full-force fireball-pace straight lasers first across primary open/center/corner lanes
        for (let yi = 0; yi < 3; yi++) {
          const y = yOrder[yi];
          const fullShot = strike(body, ball, goal, y, superArmKey, 0, SHOT_DRIVE);
          fullShot.power = 1;
          moves.push(tag({ ...fullShot, superArm: arm }, 'shoot'));
          if (yi === 0) {
            const controlled = strike(body, ball, goal, y, superArmKey, 0, 280);
            extraShots.push(tag({ ...controlled, superArm: arm }, 'shoot'));
          }
        }

        // Goalie-bypassing curved benders: bow wide past top/bottom shoulder and hook inside each post
        const bendOff = onWing ? 21 : 24;
        const benderScale = Math.min(1, 22 / (body.maxSpin || P.BASE_MAX_SPIN || 20));
        const topBender = strike(body, ball, goal, GOAL_Y_TOP + bendOff, superArmKey, benderSpin(-1) * benderScale, SHOT_DRIVE);
        topBender.power = 1;
        const botBender = strike(body, ball, goal, GOAL_Y_BOT - bendOff, superArmKey, benderSpin(1) * benderScale, SHOT_DRIVE);
        botBender.power = 1;
        const wideTop = strike(body, ball, goal, GOAL_Y_TOP + 15, superArmKey, benderSpin(-1), SHOT_DRIVE);
        wideTop.power = 1;
        const wideBot = strike(body, ball, goal, GOAL_Y_BOT - 15, superArmKey, benderSpin(1), SHOT_DRIVE);
        wideBot.power = 1;
        if (goalieY >= RINK_CY) {
          moves.push(tag({ ...topBender, superArm: arm }, 'shoot'));
          if (!onWing) moves.push(tag({ ...wideTop, superArm: arm }, 'shoot'));
          moves.push(tag({ ...botBender, superArm: arm }, 'shoot'));
          if (!onWing) moves.push(tag({ ...wideBot, superArm: arm }, 'shoot'));
        } else {
          moves.push(tag({ ...botBender, superArm: arm }, 'shoot'));
          if (!onWing) moves.push(tag({ ...wideBot, superArm: arm }, 'shoot'));
          moves.push(tag({ ...topBender, superArm: arm }, 'shoot'));
          if (!onWing) moves.push(tag({ ...wideTop, superArm: arm }, 'shoot'));
        }

        // Full-power Corner Meteor Bank lasers (1.0 wall restitution + zero tangential loss when onFire)
        const ballR = ball.radius || 18;
        const topGoalRefY = goalieY >= RINK_CY - 12 ? GOAL_Y_TOP + 24 : GOAL_Y_BOT - 24;
        const botGoalRefY = goalieY <= RINK_CY + 12 ? GOAL_Y_BOT - 24 : GOAL_Y_TOP + 24;
        const bankTopCorner = strike(body, ball, goal, 2 * (RINK_TOP + ballR) - topGoalRefY, superArmKey, 0, SHOT_DRIVE);
        bankTopCorner.power = 1;
        const bankBotCorner = strike(body, ball, goal, 2 * (RINK_BOTTOM - ballR) - botGoalRefY, superArmKey, 0, SHOT_DRIVE);
        bankBotCorner.power = 1;
        moves.push(tag({ ...bankTopCorner, superArm: arm }, 'shoot'));
        moves.push(tag({ ...bankBotCorner, superArm: arm }, 'shoot'));

        // Tight-wing Post English (1.45x post grip + 100% spin retention at y = 246 / 354 inside 230 / 370 posts)
        if (onWing) {
          const topWing = ball.y < RINK_CY;
          const nearPostY = topWing ? GOAL_Y_TOP + 16 : GOAL_Y_BOT - 16;
          const postSpin = (topWing ? -1 : 1) * (team ? 1 : -1);
          const postEng = strike(body, ball, goal, nearPostY, superArmKey, postSpin, SHOT_DRIVE);
          postEng.power = 1;
          moves.push(tag({ ...postEng, superArm: arm }, 'shoot'));
          const altFar = strike(body, ball, goal, topWing ? GOAL_Y_BOT - 22 : GOAL_Y_TOP + 22, superArmKey, (topWing ? 1 : -1) * (team ? 1 : -1), SHOT_DRIVE);
          altFar.power = 1;
          extraShots.push(tag({ ...altFar, superArm: arm }, 'shoot'));
        }

        // Glancing shoulder fireball overpower against un-guarded blockers & extra-wide benders when screened
        if (!aperture.open && aperture.blocker) {
          const blkBody = aperture.blocker.body;
          const canOverpower = (arm && superArmKey === 'cannonball') || (body.power || 1) >= 1.16 || Boolean(ball.onFire);
          if (canOverpower && !blkBody.guarding) {
            for (const offY of [-28, 28]) {
              const shY = Math.max(GOAL_Y_TOP + 19, Math.min(GOAL_Y_BOT - 19, blkBody.y + offY));
              const ovShot = strike(body, ball, goal, shY, superArmKey, 0, SHOT_DRIVE);
              ovShot.power = 1;
              moves.push(tag({ ...ovShot, superArm: arm }, 'shoot'));
            }
          }
          const openSideSign = blkBody.y >= RINK_CY ? -1 : 1;
          const widePostY = openSideSign < 0 ? GOAL_Y_TOP + 18 : GOAL_Y_BOT - 18;
          const wideBend = strike(body, ball, goal, widePostY, superArmKey, openSideSign * (team ? 1 : -1), SHOT_DRIVE);
          wideBend.power = 1;
          extraShots.push(tag({ ...wideBend, superArm: arm }, 'shoot'));
        }

        // Secondary center-bank & moderate-spin changeups in extraShots
        const centerBankY = ball.y < RINK_CY ? 2 * (RINK_TOP + ballR) - RINK_CY : 2 * (RINK_BOTTOM - ballR) - RINK_CY;
        const cBank = strike(body, ball, goal, centerBankY, superArmKey, 0, SHOT_DRIVE);
        cBank.power = 1;
        extraShots.push(tag({ ...cBank, superArm: arm }, 'shoot'));
        for (const sideSign of [-1, 1]) {
          const midTargetY = sideSign < 0 ? GOAL_Y_TOP + 26 : GOAL_Y_BOT - 26;
          const midBend = strike(body, ball, goal, midTargetY, superArmKey, sideSign * (team ? 1 : -1) * 0.65, SHOT_DRIVE);
          extraShots.push(tag({ ...midBend, superArm: arm }, 'shoot'));
        }
        extraShots.push(tag({ ...aim(body, ball.x, ball.y, 150, superArmKey, 0), superArm: arm }, 'chase'));
      } else {
        const backX = Math.max(RINK_LEFT + 40, Math.min(RINK_RIGHT - 40, ball.x + (team ? 68 : -68)));
        const dyBall = body.y - ball.y;
        const sides = Math.abs(dyBall) > 28 ? [dyBall < 0 ? -55 : 55] : [-54, 54];
        for (const side of sides) {
          const arcY = Math.max(RINK_TOP + 35, Math.min(RINK_BOTTOM - 35, ball.y + side));
          moves.push(tag({ ...aim(body, backX, arcY, 140, superArmKey, 0), superArm: arm }, 'chase'));
          const wrapSpin = (side < 0 ? 0.65 : -0.65) * (team ? 1 : -1);
          moves.push(tag({ ...aim(body, backX, arcY, 140, superArmKey, wrapSpin), superArm: arm }, 'chase'));
        }
      }

      if (incoming && incoming.crosses && !creaseWarned) {
        const tReach = Math.hypot(body.x - incoming.lineX, body.y - incoming.lineY) / Math.max(180, P.launchSpeed(body));
        if (tReach <= incoming.time + 0.28 || isDefSkater) {
          const lineDrive = Math.hypot(body.x - incoming.lineX, body.y - incoming.lineY) > 18 ? 260 : 0;
          moves.unshift(tag({ ...aim(body, incoming.lineX, incoming.lineY, lineDrive, superArmKey, 0), superArm: arm }, 'cover'));
          moves.push(tag({ ...aim(body, incoming.midX, incoming.midY, 210, superArmKey, 0), superArm: arm }, 'cover'));
        }
      }

      if (threatInfo.shotDanger && !creaseWarned && isDefSkater && (allowPocket || (arm && superArmKey === 'stalwart'))) {
        moves.push(tag({ ...aim(body, pocket.x, pocket.y, 140, superArmKey, 0), superArm: arm }, 'cover'));
      }
      moves.push(tag({ ...aim(body, cone.x, cone.y, 0, superArmKey, 0), superArm: arm }, 'cover'));

      if (threatInfo.shotDanger && !creaseWarned && isDefSkater) {
        const saveX = (allowPocket || (arm && superArmKey === 'stalwart')) ? pocket.x : cone.x;
        const farCornerY = body.y >= RINK_CY ? GOAL_Y_TOP + 26 : GOAL_Y_BOT - 26;
        const farDive = aim(body, saveX, farCornerY, 320, superArmKey, 0);
        farDive.power = Math.max(farDive.power, 0.92);
        moves.push(tag({ ...farDive, superArm: arm }, 'cover'));
      }

      if (threat) {
        const check = aim(body, threat.x + (threat.vx || 0) * 0.15, threat.y + (threat.vy || 0) * 0.15, 180, superArmKey);
        moves.push(tag({ ...check, superArm: arm }, 'check'));
      }

      for (let si = 0; si < specialSupers.length; si++) moves.push(specialSupers[si]);
      for (let ei = 0; ei < extraShots.length; ei++) moves.push(extraShots[ei]);

      const nearPerimeter = Math.abs(ball.y - RINK_CY) > 160 || ball.x < RINK_LEFT + 130 || ball.x > RINK_RIGHT - 130;
      if (isBehind && !body.holding) {
        for (const y of [RINK_TOP + 70, RINK_BOTTOM - 70]) {
          moves.push(tag({ ...strike(body, ball, RINK_CX, y, superArmKey, 0), superArm: arm }, 'clear'));
          if (pointBlank || nearPerimeter) {
            moves.push(tag({ ...strike(body, ball, RINK_CX, y, superArmKey, 1), superArm: arm }, 'clear'));
            moves.push(tag({ ...strike(body, ball, RINK_CX, y, superArmKey, -1), superArm: arm }, 'clear'));
          }
        }
      }
      if (nearPerimeter || state.fouls?.corner !== null) {
        moves.push(tag(rimAroundMove(body, ball, team, superArmKey), 'rim'));
      }

      moves.specialSupers = specialSupers;
      return moves;
    }

    const unarmedMoves = generateMoves(null);
    const boostBase = !creaseWarned && isBehind && !body.holding && aperture.open && Math.abs(ball.x - goal) < 560 && base && !base.guard && base.power > 0.35
      ? { ...base, power: Math.max(base.power, 0.96) }
      : base;
    const cleanBase = creaseWarned && base && (!base.power || base.guard) ? unarmedMoves[0] : boostBase;
    if (!hasSuper) {
      return [unarmedMoves[0], unarmedMoves[1], cleanBase, ...unarmedMoves.slice(2)];
    }
    const armedMoves = generateMoves(sKey);
    const moves = [unarmedMoves[0], unarmedMoves[1], cleanBase];
    if (armedMoves[1]?.superArm) moves.push(armedMoves[1]);
    const prioSet = new Set();
    if (armedMoves.specialSupers?.length) {
      const sp = armedMoves.specialSupers[0];
      prioSet.add(sp);
      moves.push(sp);
    }
    const prioCheck = (sKey === 'knockout' || sKey === 'shockwave')
      ? armedMoves.find(m => !prioSet.has(m) && getIntent(m) === 'check')
      : null;
    if (prioCheck) {
      prioSet.add(prioCheck);
      moves.push(prioCheck);
    }
    const maxLen = Math.max(unarmedMoves.length, armedMoves.length);
    for (let k = 2; k < maxLen; k++) {
      if (unarmedMoves[k]) moves.push(unarmedMoves[k]);
      if (armedMoves[k] && !prioSet.has(armedMoves[k])) moves.push(armedMoves[k]);
    }
    return moves;
  }

  function place3(i0, m0, i1, m1, i2, m2) {
    const out = new Array(3);
    out[i0] = m0; out[i1] = m1; out[i2] = m2;
    return out;
  }

  // Coordinated 3-skater plays (Sticky escort drive, Defensive Fire Drill, Screen-breaker check+shot, Snap one-timers, Pack-Draft breakaways)
  function jointTeamPlays(state, team, currentBest, jobs) {
    const ownStart = team * 3, oppStart = (1 - team) * 3;
    const ball = state.bodies[6];
    const classic = M.rule(state.mode, 'classic');
    const atkGoal = team ? RINK_LEFT : RINK_RIGHT, ownGoal = RINK_LEFT + RINK_RIGHT - atkGoal;
    const opponents = [state.bodies[oppStart], state.bodies[oppStart + 1], state.bodies[oppStart + 2]];
    const ownBodies = [state.bodies[ownStart], state.bodies[ownStart + 1], state.bodies[ownStart + 2]];
    const aperture = scanGoalAperture(ball, atkGoal, opponents);
    const oppAperture = scanGoalAperture(ball, ownGoal, ownBodies);
    const cone = shotConePoint(ball.x, ball.y, team, 88);
    const plays = [];

    const superOf = idx => {
      const b = state.bodies[ownStart + idx];
      return (!classic && !b.stunned && b.meter >= 100 && b.equippedSuper) ? b.equippedSuper.key?.toLowerCase() : null;
    };

    let defIdx = jobs.indexOf('defend');
    if (defIdx < 0) defIdx = 0;
    let atkIdx = jobs.indexOf('attack');
    if (atkIdx < 0 || atkIdx === defIdx) atkIdx = (defIdx + 1) % 3;
    const supIdx = 3 - defIdx - atkIdx;
    const defBody = state.bodies[ownStart + defIdx];
    const atkBody = state.bodies[ownStart + atkIdx];
    const supBody = state.bodies[ownStart + supIdx];

    const threatInfo = assessOpponentThreat(state, team, classic);
    const defAllowPocket = threatInfo.shotDanger && canOccupyCrease(state, team, defIdx);
    const defPocket = goalPocketPoint(ball.x, ball.y, team, defAllowPocket);
    const smartCover = defBody.stunned ? HOLD
      : (state.fouls?.crease?.[team] && M.inCrease(P, defBody, team))
        ? tag(aim(defBody, ownGoal + (team ? -102 : 102), defBody.y < RINK_CY ? RINK_CY - 55 : RINK_CY + 55, 35, null, 0), 'cover')
        : (defAllowPocket && Math.hypot(defBody.x - defPocket.x, defBody.y - defPocket.y) < 18 && Math.hypot(defBody.vx || 0, defBody.vy || 0) < 35)
          ? tag({ ...GUARD, superArm: false }, 'guard')
          : tag(aim(defBody, defPocket.x, defPocket.y, threatInfo.shotDanger ? 95 : 0, null, 0), 'cover');

    // 1. Active Sticky Carrier Escort Drive
    for (let cIdx = 0; cIdx < 3; cIdx++) {
      const carrier = state.bodies[ownStart + cIdx];
      if (!carrier.stunned && carrier.holding) {
        let nearestOpp = null, bestOD = Infinity;
        for (let oi = 0; oi < 3; oi++) {
          const op = opponents[oi];
          if (!op.carded && !op.stunned) {
            const d = Math.hypot(op.x - carrier.x, op.y - carrier.y);
            if (d < bestOD) { bestOD = d; nearestOpp = op; }
          }
        }
        const escIdx = cIdx === supIdx ? atkIdx : supIdx;
        const escort = state.bodies[ownStart + escIdx], escS = superOf(escIdx);
        const p1 = currentBest.slice();
        if (defIdx !== cIdx && defIdx !== escIdx) p1[defIdx] = smartCover;
        p1[cIdx] = tag(stickyCarryMove(carrier, ball, atkGoal, aperture.y, null, 0), 'carry');
        if (!escort.stunned && nearestOpp) {
          const armE = (escS === 'knockout' || escS === 'shockwave' || escS === 'colossus') ? escS : null;
          const blk = aim(escort, nearestOpp.x + (nearestOpp.vx || 0) * 0.14, nearestOpp.y + (nearestOpp.vy || 0) * 0.14, 220, armE, 0);
          if (armE) blk.superArm = true;
          p1[escIdx] = tag(blk, 'check');
        }
        plays.push(p1);
      }
    }

    // Helper to build coordinated 2-skater Defensive Fire Drill plays (pocket/goal-line save + striker/receiver disrupt + wing clear)
    let oppCarrier = threatInfo.oppCarrier, oppStriker = threatInfo.oppStriker, bestOppScore = Infinity;
    if (!oppStriker) {
      for (let oi = 0; oi < 3; oi++) {
        const op = opponents[oi];
        if (op.carded || op.stunned) continue;
        const d = Math.hypot(op.x - ball.x, op.y - ball.y) - (behindBall(op, ball, 1 - team) ? 80 : 0);
        if (d < bestOppScore) { bestOppScore = d; oppStriker = op; }
      }
    }
    const oppThreat = oppCarrier || oppStriker;
    const incoming = threatInfo.incoming;
    const ballInOwnZone = team ? ball.x > RINK_CX + 45 : ball.x < RINK_CX - 45;
    const highDanger = Boolean(incoming || oppCarrier) || Math.abs(ball.x - ownGoal) < 225 ||
      (ballInOwnZone && defBody.stunned) || threatInfo.shotDanger;
    const defensivePlays = [];
    if (ballInOwnZone || oppCarrier || threatInfo.shotDanger) {
      let saverIdx = -1, bestSaveT = Infinity;
      const useDeepPocket = threatInfo.shotDanger;
      const blockDist = useDeepPocket ? 52 : Math.max(90, Math.min(185, Math.abs(ball.x - ownGoal) * 0.55));
      const refGoalPt = incoming ? { x: incoming.lineX, y: incoming.lineY } : shotConePoint(ball.x, ball.y, team, blockDist);
      for (let i = 0; i < 3; i++) {
        const b = ownBodies[i];
        if (b.stunned || b.carded) continue;
        const tSave = Math.hypot(b.x - refGoalPt.x, b.y - refGoalPt.y) / Math.max(180, P.launchSpeed(b));
        if (tSave < bestSaveT) { bestSaveT = tSave; saverIdx = i; }
      }
      if (saverIdx >= 0) {
        const saverB = ownBodies[saverIdx], saverS = superOf(saverIdx);
        const saverAllowPocket = useDeepPocket && (canOccupyCrease(state, team, saverIdx) || saverS === 'stalwart');
        const pocketTarget = incoming
          ? { x: saverAllowPocket ? incoming.lineX : cone.x, y: incoming.lineY }
          : (useDeepPocket ? goalPocketPoint(ball.x, oppAperture.y, team, saverAllowPocket) : refGoalPt);

        let disruptIdx = -1, bestDisD = Infinity;
        for (let i = 0; i < 3; i++) {
          if (i === saverIdx || ownBodies[i].stunned || ownBodies[i].carded) continue;
          const refX = oppThreat ? oppThreat.x : ball.x, refY = oppThreat ? oppThreat.y : ball.y;
          const d = Math.hypot(ownBodies[i].x - refX, ownBodies[i].y - refY);
          if (d < bestDisD) { bestDisD = d; disruptIdx = i; }
        }

        const closeGoalThreat = Math.abs(ball.x - ownGoal) < 380 || Boolean(oppCarrier || incoming || threatInfo.fireballThreat);
        const saverWarned = Boolean(state.fouls?.crease?.[team]) && M.inCrease(P, saverB, team);
        const ballR = ball.radius || 18;
        const coversShotInGuard = !saverWarned && Math.hypot(saverB.vx || 0, saverB.vy || 0) < 55 && (
          (Math.hypot(saverB.x - pocketTarget.x, saverB.y - pocketTarget.y) < 22) ||
          (Math.hypot(saverB.x - cone.x, saverB.y - cone.y) < 22) ||
          (threatInfo.fireballThreat && (
            guardCoversSegment(saverB, ball.x, ball.y, ownGoal, RINK_CY, ballR, 0) ||
            guardCoversSegment(saverB, ball.x, ball.y, ownGoal, oppAperture.y, ballR, 0)
          ))
        );

        let saveMv;
        if (coversShotInGuard) {
          saveMv = tag({ ...GUARD, superArm: Boolean(closeGoalThreat && saverS === 'stalwart') }, 'guard');
        } else {
          const armSave = closeGoalThreat && (saverS === 'stalwart' || saverS === 'colossus') ? saverS : null;
          const distToSave = Math.hypot(saverB.x - pocketTarget.x, saverB.y - pocketTarget.y);
          const saveDrive = useDeepPocket ? (distToSave > 32 ? 260 : 120) : 135;
          const rawSave = aim(saverB, pocketTarget.x, pocketTarget.y, saveDrive, armSave, 0);
          if (distToSave > 55 && threatInfo.shotDanger) rawSave.power = Math.max(rawSave.power, 0.94);
          if (armSave) rawSave.superArm = true;
          saveMv = tag(rawSave, 'cover');
        }

        const fireDrill = currentBest.slice();
        fireDrill[saverIdx] = saveMv;
        if (disruptIdx >= 0 && oppThreat) {
          const disB = ownBodies[disruptIdx], disS = superOf(disruptIdx);
          const armDis = closeGoalThreat && (disS === 'knockout' || disS === 'shockwave' || disS === 'colossus') ? disS : null;
          const chkMv = aim(disB, oppThreat.x + (oppThreat.vx || 0) * 0.15, oppThreat.y + (oppThreat.vy || 0) * 0.15, 225, armDis, 0);
          if (armDis) chkMv.superArm = true;
          fireDrill[disruptIdx] = tag(chkMv, 'check');

          const thirdIdx = 3 - saverIdx - disruptIdx;
          const thirdB = ownBodies[thirdIdx], thirdS = superOf(thirdIdx);
          if (!thirdB.stunned && !thirdB.carded) {
            const safeWingY = ball.y < RINK_CY ? RINK_TOP + 68 : RINK_BOTTOM - 68;
            if (behindBall(thirdB, ball, team) && !thirdB.holding) {
              fireDrill[thirdIdx] = tag(strike(thirdB, ball, RINK_CX, safeWingY, null, 0), 'clear');
            } else if (closeGoalThreat && thirdS === 'magnet' && Math.hypot(thirdB.x - ball.x, thirdB.y - ball.y) < 320) {
              const yk = aim(thirdB, ownGoal + (team ? -260 : 260), safeWingY, 250, 'magnet', 0);
              yk.superArm = true;
              fireDrill[thirdIdx] = tag(yk, 'magnet');
            } else if (threatInfo.oppReceiver) {
              const rx = threatInfo.oppReceiver.x, ry = threatInfo.oppReceiver.y;
              const jamX = Math.max(RINK_LEFT + 92, Math.min(RINK_RIGHT - 92, rx + (team ? 26 : -26)));
              fireDrill[thirdIdx] = tag(aim(thirdB, jamX, ry, 210, null, 0), 'check');
            } else {
              const backDoorX = ownGoal + (team ? -135 : 135);
              const backDoorY = ball.y < RINK_CY ? RINK_CY + 56 : RINK_CY - 56;
              fireDrill[thirdIdx] = tag(aim(thirdB, backDoorX, backDoorY, 50, null, 0), 'cover');
            }
          }
        }
        defensivePlays.push(fireDrill);

        if (threatInfo.shotDanger && threatInfo.oppReceiver && disruptIdx >= 0) {
          const slotLock = fireDrill.slice();
          const recv = threatInfo.oppReceiver;
          const postX = saverAllowPocket ? (ownGoal + (team ? -40 : 40)) : cone.x;
          const postY = Math.max(GOAL_Y_TOP + 24, Math.min(GOAL_Y_BOT - 24, RINK_CY + (recv.y - RINK_CY) * 0.52));
          const slideMv = aim(saverB, postX, postY, 260, null, 0);
          slideMv.power = Math.max(slideMv.power, 0.88);
          slotLock[saverIdx] = tag(slideMv, 'cover');
          const disB = ownBodies[disruptIdx], disS = superOf(disruptIdx);
          const armSlot = (disS === 'knockout' || disS === 'shockwave' || disS === 'colossus') ? disS : null;
          // Drive through the cross-slot pass midpoint between ball and receiver to intercept Snap passes cleanly!
          const passMidX = Math.max(RINK_LEFT + 92, Math.min(RINK_RIGHT - 92, ball.x * 0.42 + recv.x * 0.58));
          const passMidY = ball.y * 0.35 + recv.y * 0.65;
          const lockMv = aim(disB, passMidX, passMidY, 260, armSlot, 0);
          lockMv.power = Math.max(lockMv.power, 0.92);
          if (armSlot) lockMv.superArm = true;
          slotLock[disruptIdx] = tag(lockMv, 'cover');
          defensivePlays.push(slotLock);
        }

        // Coordinated Defensive Clear + Wing Breakout when a skater is behind the ball in own zone
        for (let clrIdx = 0; clrIdx < 3; clrIdx++) {
          if (clrIdx === saverIdx) continue;
          const clrB = ownBodies[clrIdx];
          if (clrB.stunned || clrB.carded || clrB.holding || !behindBall(clrB, ball, team)) continue;
          const wingY = ball.y < RINK_CY ? RINK_TOP + 72 : RINK_BOTTOM - 72;
          const outIdx = 3 - saverIdx - clrIdx;
          const outB = ownBodies[outIdx];
          const breakout = currentBest.slice();
          breakout[saverIdx] = smartCover;
          breakout[clrIdx] = M.cornerOf(P, ball.x, ball.y) !== null
            ? tag(rimAroundMove(clrB, ball, team, null), 'rim')
            : tag(strike(clrB, ball, RINK_CX + (team ? -135 : 135), wingY, null, 0), 'clear');
          if (!outB.stunned && !outB.carded) {
            breakout[outIdx] = tag(aim(outB, RINK_CX + (team ? -175 : 175), wingY, 60, null, 0), 'receive');
          }
          defensivePlays.push(breakout);
          break;
        }
      }
    }
    if (highDanger && defensivePlays.length > 0) {
      plays.push(defensivePlays[0]);
      if (threatInfo.shotDanger && threatInfo.oppReceiver && defensivePlays.length > 1) {
        plays.push(defensivePlays[1]);
      }
    }

    // 2. Screen-Breaker Check / Shockwave Crease Blast + Simultaneous Sniper Shot when direct lane is screened
    const screenBlk = aperture.blocker || segmentBlocked(ball.x, ball.y, atkGoal, RINK_CY, opponents, 26);
    if (screenBlk && !atkBody.stunned && !atkBody.holding && behindBall(atkBody, ball, team)) {
      const breakerIdx = !supBody.stunned ? supIdx : (!defBody.stunned && !highDanger ? defIdx : -1);
      if (breakerIdx >= 0) {
        const breakerB = ownBodies[breakerIdx], brkS = superOf(breakerIdx), atkS = superOf(atkIdx);
        const targetOp = screenBlk.body;
        const armBreak = (brkS === 'knockout' || brkS === 'shockwave' || brkS === 'colossus') ? brkS : null;
        const checkMv = aim(breakerB, targetOp.x + (targetOp.vx || 0) * 0.12, targetOp.y + (targetOp.vy || 0) * 0.12, 240, armBreak, 0);
        if (armBreak) checkMv.superArm = true;
        const armShot = (atkS === 'cannonball' || atkS === 'ghost' || atkS === 'sticky') ? atkS : null;
        const laneY = targetOp.y >= RINK_CY ? RINK_CY - 46 : RINK_CY + 46;
        const laneShot = strike(atkBody, ball, atkGoal, laneY, armShot, screenBlk.side * 0.6, SHOT_DRIVE);
        laneShot.power = 1;
        if (armShot) laneShot.superArm = true;
        const otherIdx = 3 - atkIdx - breakerIdx;
        const otherMv = otherIdx === defIdx ? smartCover : currentBest[otherIdx];
        plays.push(place3(otherIdx, otherMv, atkIdx, tag(laneShot, 'shoot'), breakerIdx, tag(checkMv, 'check')));
      }
    }

    // 3. Synchronized Tape-to-Tape Snap One-Timers + Open-Wing Lead Passes
    for (let i = 0; i < 3; i++) {
      const sender = state.bodies[ownStart + i];
      if (sender.stunned || sender.holding) continue;
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        const receiver = state.bodies[ownStart + j];
        if (receiver.stunned) continue;
        if (behindBall(sender, ball, team)) {
          const snapX = Math.max(RINK_LEFT + 100, Math.min(RINK_RIGHT - 100, receiver.x * 0.62 + atkGoal * 0.38));
          const snapY = Math.max(RINK_TOP + 50, Math.min(RINK_BOTTOM - 50, receiver.y * 0.8 + RINK_CY * 0.2));
          const passMove = strike(sender, ball, snapX, snapY, null, 0, 560);
          const vSend0 = Math.max(120, passMove.power * P.launchSpeed(sender));
          const dSend = Math.max(0, Math.hypot(ball.x - sender.x, ball.y - sender.y) - sender.radius - ball.radius + 1);
          const vImp = Math.sqrt(Math.max(6400, vSend0 * vSend0 - 2 * sender.friction * dSend));
          const tSend = sender.friction > 0 ? Math.max(0, (vSend0 - vImp) / sender.friction) : dSend / vSend0;
          const mP = sender.mass || 3, mB = ball.mass || 1;
          const sHitR = P.ballHitRadius ? P.ballHitRadius(sender) : Math.max(sender.radius, sender.reach || sender.radius, 18);
          const sGap = Math.max(0, Math.hypot(ball.x - sender.x, ball.y - sender.y) - sHitR - ball.radius);
          const sProx = sGap < 4 * ball.radius ? Math.max(0, 1 - sGap / (4 * ball.radius)) : 0;
          const sBoost = (sProx > 0 && vImp >= (P.STRIKE_MIN_SPEED ?? 180))
            ? (sender.sizeMult || 1) ** (P.SIZE?.strike ?? -0.5) * (P.STRIKE_POWER ?? 0.5) * ((P.CLOSE_SPIN_GAIN ?? 2) - (P.STRIKE_GAIN ?? 1)) * sProx * sProx * (3 - 2 * sProx) * vImp
            : 0;
          const vPass0 = Math.max(180, Math.min((2 * mP / (mP + mB)) * vImp, (1.88 / (1 / mP + 1 / mB)) * (sender.power || 1) * vImp) + sBoost);
          const dPass = Math.hypot(snapX - ball.x, snapY - ball.y) || 1;
          const tPass = dPass / Math.max(140, vPass0 - 0.5 * (ball.friction ?? 85) * (dPass / vPass0));
          const vPassEnd = Math.max(100, vPass0 - (ball.friction ?? 85) * tPass);
          const pvx = ((snapX - ball.x) / dPass) * vPassEnd;
          const pvy = ((snapY - ball.y) / dPass) * vPassEnd;
          const tBall = Math.max(0.18, Math.min(1.6, tSend + tPass));
          const rContact = Math.max(receiver.radius, receiver.reach || receiver.radius, 18) + ball.radius - 2;
          const rGoalD = Math.hypot(atkGoal - snapX, aperture.y - snapY) || 1;
          const outSpeed = Math.max(420, vPassEnd * 1.45);
          const dvx = ((atkGoal - snapX) / rGoalD) * outSpeed - pvx * 0.85;
          const dvy = ((aperture.y - snapY) / rGoalD) * outSpeed - pvy * 0.85;
          const dvLen = Math.hypot(dvx, dvy) || 1;
          const rTargetX = snapX - (dvx / dvLen) * rContact;
          const rTargetY = snapY - (dvy / dvLen) * rContact;
          const virtBall = { ...ball, x: snapX, y: snapY, vx: pvx, vy: pvy, omega: 0, stickOffset: null };
          const recvMove = strike(receiver, virtBall, atkGoal, aperture.y, null, 0);
          const dRecv = Math.hypot(rTargetX - receiver.x, rTargetY - receiver.y);
          const maxVRecv = P.launchSpeed(receiver);
          if (maxVRecv > 0 && Math.hypot(receiver.vx || 0, receiver.vy || 0) <= 10) {
            const vSync = (dRecv + 14) / tBall + 0.5 * receiver.friction * tBall;
            recvMove.power = Math.max(0.25, Math.min(1, vSync / maxVRecv));
            recvMove.angle = Math.atan2(rTargetY - receiver.y, rTargetX - receiver.x);
          }
          const nextSnap = currentBest.slice();
          nextSnap[i] = tag(passMove, 'pass');
          nextSnap[j] = tag(recvMove, 'shoot');
          plays.push(nextSnap);

          const wx = Math.max(RINK_LEFT + 120, Math.min(RINK_RIGHT - 120, ball.x + (team ? -130 : 130)));
          const wy = ball.y < RINK_CY ? RINK_CY + 90 : RINK_CY - 90;
          const nextLead = currentBest.slice();
          nextLead[i] = tag(strike(sender, ball, wx, wy, null, 0), 'pass');
          nextLead[j] = tag(aim(receiver, wx, wy, 0, null, 0), 'receive');
          plays.push(nextLead);
        }
      }
    }

    for (let dp = highDanger ? 1 : 0; dp < defensivePlays.length; dp++) {
      plays.push(defensivePlays[dp]);
    }

    // 4. Pack-Draft 2-Skater Breakaway (trailer aligns into < 95px slipstream for friction cut)
    for (let lIdx = 0; lIdx < 3; lIdx++) {
      if (lIdx === defIdx) continue;
      const lead = state.bodies[ownStart + lIdx], lMv = currentBest[lIdx];
      if (lead.stunned || !lMv || lMv.guard || lMv.power < 0.6) continue;
      const hCos = Math.cos(lMv.angle), hSin = Math.sin(lMv.angle);
      for (let tIdx = 0; tIdx < 3; tIdx++) {
        if (tIdx === lIdx || tIdx === defIdx) continue;
        const tr = state.bodies[ownStart + tIdx];
        if (tr.stunned) continue;
        const dx = lead.x - tr.x, dy = lead.y - tr.y, dist = Math.hypot(dx, dy);
        const gap = dist - lead.radius - tr.radius;
        if (gap > -5 && gap < 140 && (dx * hCos + dy * hSin) > dist * 0.5) {
          const draftMv = aim(tr, Math.max(RINK_LEFT + 35, Math.min(RINK_RIGHT - 35, lead.x + hCos * 210)), Math.max(RINK_TOP + 35, Math.min(RINK_BOTTOM - 35, lead.y + hSin * 210)), 250, null, 0);
          draftMv.power = Math.max(0.82, draftMv.power);
          const nextD = currentBest.slice();
          nextD[tIdx] = tag(draftMv, 'draft');
          plays.push(nextD);
        }
      }
    }

    // 5. Two-Turn Setup Plays (evaluated by Insane/God budgets & scored via Step 7 Turn-2 look-ahead):
    //    (a) Goalie Knockout / Heavy Screen Check + Soft Slot Park when direct lane is walled off
    if (!aperture.open && screenBlk && !atkBody.stunned && !atkBody.holding && behindBall(atkBody, ball, team)) {
      const hitIdx = !supBody.stunned ? supIdx : (!defBody.stunned && !highDanger ? defIdx : -1);
      if (hitIdx >= 0) {
        const hitB = ownBodies[hitIdx], hitS = superOf(hitIdx);
        const blockerOp = screenBlk.body;
        const armHit = (hitS === 'knockout' || hitS === 'shockwave' || hitS === 'colossus') ? hitS : null;
        const hitMv = aim(hitB, blockerOp.x + (blockerOp.vx || 0) * 0.12, blockerOp.y + (blockerOp.vy || 0) * 0.12, 260, armHit, 0);
        if (armHit) hitMv.superArm = true;
        const slotX = atkGoal + (team ? 180 : -180);
        const slotY = blockerOp.y >= RINK_CY ? RINK_CY - 58 : RINK_CY + 58;
        const chipMv = strike(atkBody, ball, slotX, slotY, null, 0);
        chipMv.power = Math.max(0.22, chipMv.power * 0.52);
        const remIdx = 3 - atkIdx - hitIdx;
        const remMv = remIdx === defIdx ? smartCover : tag(aim(ownBodies[remIdx], slotX + (team ? 55 : -55), slotY, 40, null, 0), 'receive');
        plays.push(place3(remIdx, remMv, atkIdx, tag(chipMv, 'pass'), hitIdx, tag(hitMv, 'check')));
      }
    }

    //    (b) Soft Chip-to-Space + Streaking Wing Setup from neutral/defensive ice
    if (Math.abs(ball.x - atkGoal) > 400 && !atkBody.stunned && !atkBody.holding && behindBall(atkBody, ball, team) && !supBody.stunned) {
      const spaceX = atkGoal + (team ? 215 : -215);
      const spaceY = supBody.y < RINK_CY ? RINK_CY - 78 : RINK_CY + 78;
      const dumpMv = strike(atkBody, ball, spaceX, spaceY, null, 0);
      dumpMv.power = Math.max(0.28, dumpMv.power * 0.64);
      const runMv = aim(supBody, spaceX + (team ? 58 : -58), spaceY, 75, null, 0);
      plays.push(place3(defIdx, smartCover, atkIdx, tag(dumpMv, 'pass'), supIdx, tag(runMv, 'receive')));
    }

    return plays;
  }

  function roles(state, team) {
    const ball = state.bodies[6], body = i => state.bodies[team * 3 + i];
    const nearest = (list, x, y) => list.reduce((a, b) => Math.hypot(body(b).x - x, body(b).y - y) < Math.hypot(body(a).x - x, body(a).y - y) ? b : a);
    const defender = nearest([0, 1, 2], team ? RINK_RIGHT : RINK_LEFT, RINK_CY), rest = [0, 1, 2].filter(i => i !== defender);
    const attacker = nearest(rest, ball.x, ball.y);
    return [0, 1, 2].map(i => i === defender ? 'defend' : i === attacker ? 'attack' : 'support');
  }

  function wobble(moves, sign) {
    const out = new Array(3);
    for (let i = 0; i < 3; i++) {
      const p = moves[i];
      if (!p.power || p.guard) {
        out[i] = p;
      } else {
        const s = i === 1 ? -sign : sign;
        out[i] = {
          angle: p.angle + s * WOBBLE.angle,
          power: Math.max(0, Math.min(1, p.power * (1 - s * WOBBLE.power))),
          spin: p.spin,
          superArm: p.superArm,
          guard: p.guard
        };
      }
    }
    return out;
  }

  // Projected skater positions for the evaluated state (filled by evaluateBodies) and the position features it scores.
  const slideX = new Float64Array(6), slideY = new Float64Array(6);
  const FEATURE_NAMES = Object.freeze(['progress', 'access', 'cover', 'chance', 'meter', 'stun', 'daze']);
  const FEATURES = new Float64Array(FEATURE_NAMES.length);
  const FEATURE_CAP = 600, WRONG_SIDE = 60;
  const unavailable = b => b.carded || b.stunned || b.stunnedNext;

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

  // Team t's next-turn shooting chance: open share of the goal mouth x angle it subtends x striker readiness.
  function shotChance(bodies, t, bx, by, ballR, strikeDist) {
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
        const clr = Math.hypot(slideX[i] - (bx + s * dx), slideY[i] - (by + s * dy)) - ((b.radius || 25) + ballR);
        if (clr < minClear) minClear = clr;
      }
      open += minClear <= 0 ? 0 : minClear >= 20 ? 1 : minClear / 20;
    }
    return (open / GOAL_APERTURE_YS.length) * angle * Math.exp(-strikeDist / 250);
  }

  function evaluateBodies(bodies, fouls, team, goal, weights, complexity = 0, scorer = null, teamTouches = false, tmw = 0.5, partial = false, isPulse = false) {
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

        // Check if any sliding skater intercepts this coast segment before a wall or goal line
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

        // Check unobstructed goal-mouth crossing (Left net scores for Team 1; Right net scores for Team 0)
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
              if (Math.hypot(slideX[di] - goalLineX, slideY[di] - cy) <= contactRadius(db) + ballR + 20) { nearBlocker = true; break; }
            }
            if (!nearBlocker) impendingGoalBonus = sign * weights.goal * (0.76 + 0.12 * freshness);
          } else {
            const crossTime = elapsedT + stepT * tCross;
            let saveable = false;
            for (let di = defStart; di < defStart + 3; di++) {
              const db = bodies[di];
              if (unavailable(db)) continue;
              const distToLine = Math.max(0, Math.hypot(db.x - goalLineX, db.y - cy) - contactRadius(db) - ballR);
              const maxCover = Math.max(P.launchSpeed(db) * 1.18, Math.hypot(db.vx || 0, db.vy || 0)) * (crossTime + 0.04);
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

    // Next-turn position: who can strike the ball goalward, who guards the shot cone, and how open each goal is.
    const strikeOwn = strikeAccess(bodies, team, pbx, pby, ballR);
    const strikeOther = strikeAccess(bodies, 1 - team, pbx, pby, ballR);
    FEATURES[0] = dir * (bx + coastDx - RINK_CX);
    FEATURES[1] = strikeOther - strikeOwn;
    FEATURES[2] = coneCover(bodies, 1 - team, pbx, pby, fouls) - coneCover(bodies, team, pbx, pby, fouls);
    FEATURES[3] = shotChance(bodies, team, pbx, pby, ballR, strikeOwn) - shotChance(bodies, 1 - team, pbx, pby, ballR, strikeOther);
    FEATURES[4] = mDiff;
    FEATURES[5] = sDiff;
    FEATURES[6] = dDiff / DAZE_M;

    // Post-horizon slide-in crease foul penalty when truncated before settlement
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

  function evaluate(state, team, goal, weights, complexity = 0, scorer = null, teamTouches = false, tmw = 0.5) {
    const isPulse = state.mode ? M.rule(state.mode, 'pulse') : false;
    return evaluateBodies(state.bodies, state.fouls, team, goal, weights, complexity, scorer, teamTouches, tmw, false, isPulse);
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

  function buildOpponentResponses(state, team, classic, count) {
    const oppTeam = 1 - team, oppStart = oppTeam * 3, ownStart = team * 3;
    const ball = state.bodies[6];
    const opponent = legacy(state, oppTeam);
    if (count <= 1) return [opponent];

    const oppGoal = team ? RINK_RIGHT : RINK_LEFT;
    const oppOwnGoal = team ? RINK_LEFT : RINK_RIGHT;
    const ownBodies = [state.bodies[ownStart], state.bodies[ownStart + 1], state.bodies[ownStart + 2]];
    const oppAp = scanGoalAperture(ball, oppGoal, ownBodies);
    const threatInfo = assessOpponentThreat(state, team, classic);

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
        const targetY = (sSup === 'cannonball' && oppAp.y === RINK_CY) ? (ownBodies[0].y >= RINK_CY ? RINK_CY - 30 : RINK_CY + 30) : oppAp.y;
        const spinS = !oppAp.open && oppAp.blocker ? oppAp.blocker.side * 0.85 : 0;
        const shotMv = strike(sb, ball, oppGoal, targetY, armS, spinS);
        shotMv.power = 1;
        if (armS) shotMv.superArm = true;
        const activeThreat2 = guardOpponents.slice();
        activeThreat2[si] = shotMv;
        return [opponent, activeThreat2];
      }
      return [opponent, guardOpponents];
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
    if (count === 3) return [opponent, guardOpponents, blitz];

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
                ? (ownBodies[0].y >= RINK_CY ? RINK_CY - 30 : RINK_CY + 30)
                : (ownBodies[0].y >= RINK_CY ? GOAL_Y_TOP + 26 : GOAL_Y_BOT - 26);
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
    if (count === 4) return [opponent, guardOpponents, blitz, attack];

    const ballR = ball.radius || 18;
    const bankY = ball.y < RINK_CY ? (2 * (RINK_TOP + ballR) - RINK_CY) : (2 * (RINK_BOTTOM - ballR) - RINK_CY);
    const bankResp = attack.map((mv, k) => {
      const b = state.bodies[oppStart + k];
      if (!b.stunned && oppJobs[k] === 'attack' && behindBall(b, ball, oppTeam)) return strike(b, ball, oppGoal, bankY, null, 0);
      return mv;
    });
    return [opponent, guardOpponents, blitz, attack, bankResp];
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
        const bankTargetY = bankTopW >= bankBotW ? (2 * (RINK_TOP + ballR) - RINK_CY) : (2 * (RINK_BOTTOM - ballR) - RINK_CY);
        const bMv = strike(atkB, ball, oppAtkGoal, bankTargetY, armAtk, 0);
        bMv.power = Math.min(1, bMv.power * 1.22);
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

  function prepareSearchState(input, classic) {
    let maxMeterTick = -Infinity;
    let needCopy = classic;
    const skaterCount = input.bodies.length === 7 && input.bodies[6].team === -1 ? 6 : input.bodies.length;
    for (let i = 0; i < skaterCount; i++) {
      const b = input.bodies[i];
      if (b.superArm) needCopy = true;
      if (Number.isFinite(b.meterTick) && b.meterTick > maxMeterTick) maxMeterTick = b.meterTick;
    }
    let bodies = input.bodies;
    if (needCopy) {
      bodies = new Array(input.bodies.length);
      for (let i = 0; i < skaterCount; i++) {
        const s = input.bodies[i];
        const copyB = { ...s };
        if ('superArm' in copyB) copyB.superArm = false;
        if (classic) {
          copyB.meter = 0;
          copyB.equippedSuper = null;
          if ('superKey' in copyB) copyB.superKey = null;
        }
        bodies[i] = copyB;
      }
      if (input.bodies.length > skaterCount) bodies[skaterCount] = input.bodies[skaterCount];
    }
    const clock = input.clock !== undefined
      ? input.clock
      : (maxMeterTick > -Infinity ? maxMeterTick + M.METER.cooldownTicks : undefined);
    return {
      version: input.version,
      mode: input.mode,
      bodies,
      stats: input.stats || [],
      scores: input.scores ? [input.scores[0], input.scores[1]] : [0, 0],
      turn: input.turn,
      roundTurns: input.roundTurns || 0,
      clock,
      fouls: input.fouls
    };
  }

  function plan(input, team = 1, config = {}) {
    if (team !== 0 && team !== 1) throw new Error('Invalid CPU team.');
    const level = config.level || 'medium';
    if (!LEVELS[level]) throw new Error('Invalid CPU level.');
    const settings = { ...LEVELS[level], ...config };
    const rawWeights = { ...WEIGHTS, ...config.weights };
    if (!Number.isInteger(settings.candidates) || settings.candidates < 1 || settings.candidates > 1000 ||
        !Number.isInteger(settings.opponents) || settings.opponents < 1 || settings.opponents > 5 ||
        !Number.isFinite(settings.risk) || settings.risk < 0 || settings.risk > 1 ||
        !Number.isFinite(settings.temperature) || settings.temperature <= 0 ||
        (settings.wobble !== undefined && typeof settings.wobble !== 'boolean') ||
        (settings.fastTick !== undefined && typeof settings.fastTick !== 'boolean') ||
        (settings.learn !== undefined && typeof settings.learn !== 'boolean') ||
        (settings.counterBudget !== undefined && (!Number.isInteger(settings.counterBudget) || settings.counterBudget < 0 || settings.counterBudget > 200)) ||
        (settings.counterTop !== undefined && (!Number.isInteger(settings.counterTop) || settings.counterTop < 1 || settings.counterTop > 40)) ||
        (settings.counterRounds !== undefined && (!Number.isInteger(settings.counterRounds) || settings.counterRounds < 0 || settings.counterRounds > 4)) ||
        (settings.searchTicks !== undefined && (!Number.isInteger(settings.searchTicks) || settings.searchTicks < 30 || settings.searchTicks > 2880)) ||
        (settings.lookaheadTop !== undefined && (!Number.isInteger(settings.lookaheadTop) || settings.lookaheadTop < 0 || settings.lookaheadTop > 20)) ||
        (settings.lookaheadBreadth !== undefined && (!Number.isInteger(settings.lookaheadBreadth) || settings.lookaheadBreadth < 2 || settings.lookaheadBreadth > 8)) ||
        (settings.lookaheadTicks !== undefined && (!Number.isInteger(settings.lookaheadTicks) || settings.lookaheadTicks < 60 || settings.lookaheadTicks > 2880)) ||
        (settings.lookaheadBudget !== undefined && (!Number.isInteger(settings.lookaheadBudget) || settings.lookaheadBudget < 0 || settings.lookaheadBudget > 400)) ||
        (settings.pulseDepth !== undefined && (!Number.isInteger(settings.pulseDepth) || settings.pulseDepth < 1 || settings.pulseDepth > 3)) ||
        (settings.godBridgeDual !== undefined && typeof settings.godBridgeDual !== 'boolean') ||
        (settings.screenTop !== undefined && (!Number.isInteger(settings.screenTop) || settings.screenTop < 1 || settings.screenTop > 1000)) ||
        (settings.wobbleTop !== undefined && (!Number.isInteger(settings.wobbleTop) || settings.wobbleTop < 0 || settings.wobbleTop > 1000)) ||
        Object.values(rawWeights).some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid CPU search settings.');

    const started = performance.now(), random = randomSource(config.seed ?? 1);
    const classic = M.rule(input.mode, 'classic');
    const state = prepareSearchState(input, classic);

    const ownStart = team * 3;
    const avgTrait = key => (
      ((state.bodies[ownStart].personality?.[key] ?? 31.5) +
       (state.bodies[ownStart + 1].personality?.[key] ?? 31.5) +
       (state.bodies[ownStart + 2].personality?.[key] ?? 31.5)) / (3 * 63)
    );
    const agg = avgTrait('aggression'), cre = avgTrait('creativity'), tmw = avgTrait('teamwork'), clu = avgTrait('clutch');
    const deficit = Math.max(0, (state.scores?.[1 - team] ?? 0) - (state.scores?.[team] ?? 0));
    const matchPt = (state.scores?.[1 - team] ?? 0) >= 4;
    const pressure = Math.min(1, deficit * 0.25 + (matchPt ? 0.4 : 0));
    const surge = pressure * (clu - 0.5) * 2;
    const style = { agg, cre, tmw, surge, dir: team ? -1 : 1 };

    const weights = { ...rawWeights };

    let best = legacy(state, team), simulations = 0, ticks = 0, evaluated = 0;
    const startCreaseWarned = Boolean(state.fouls?.crease?.[team]);
    const jobs = roles(state, team);
    const primaryAtkIdx = jobs.indexOf('attack');
    const pulse = M.rule(state.mode, 'pulse');
    const fullTurnTicks = M.turnTicks(state.mode);
    const baseHorizon = settings.searchTicks || SEARCH_TICKS;
    const searchTicks = startCreaseWarned ? fullTurnTicks : baseHorizon;

    const results = new Map();
    const activeMasks = new Map();
    const rolloutMeta = new Map();
    const movePool = new Map();
    let nextMoveId = 4;
    const number = n => Object.is(n, -0) ? '-0' : n;
    function getMoveId(p) {
      if (p.guard || !p.power) return 1 + (p.superArm ? 2 : 0) + (p.guard ? 1 : 0);
      let id = p[MOVE_ID];
      if (id !== undefined) return id;
      const sig = `${number(p.angle)},${number(p.power)},${number(p.spin)},${p.superArm}`;
      id = movePool.get(sig);
      if (id === undefined) {
        id = ++nextMoveId;
        movePool.set(sig, id);
      }
      p[MOVE_ID] = id;
      return id;
    }

    function planKey(moves, r) {
      const id0 = getMoveId(moves[0]), id1 = getMoveId(moves[1]), id2 = getMoveId(moves[2]);
      return r + 16 * (id0 + 4096 * (id1 + 4096 * id2));
    }

    const responses = buildOpponentResponses(state, team, classic, settings.opponents);
    if (settings.learn && config.history) {
      const maxLearn = (state.roundTurns || 0) === 0 || settings.opponents >= 4 ? 2 : 1;
      const learnedList = learnedOpponentResponses(state, team, classic, config.history, maxLearn);
      for (let li = 0; li < learnedList.length; li++) {
        const learned = learnedList[li];
        const lKey = planKey(learned, 0);
        if (!responses.some(r => planKey(r, 0) === lKey)) {
          if (responses.length >= 5) responses[responses.length - 1] = learned;
          else responses.push(learned);
        }
      }
    }
    const respCount = responses.length;

    const canDecide = !pulse && !state.fouls?.crease?.[team] && !state.fouls?.crease?.[1 - team] && state.fouls?.corner === null;

    function runRollout(moves, response, evalOpp = false) {
      let toucher = null, touches = 0, boards = 0;
      let firstTeamTouch = null, multiTeamTouch = false;
      let aMask = 0;
      for (let k = 0; k < 3; k++) if (state.bodies[ownStart + k].holding) aMask |= (1 << k);
      const watch = {
        collide({ a, b, speed }) {
          if (a.team === team && a.slot >= 0) aMask |= (1 << a.slot);
          if (b.team === team && b.slot >= 0) aMask |= (1 << b.slot);
          const player = M.toucher(a, b, speed);
          if (player && player !== toucher) {
            toucher = player;
            touches++;
            if (player.team === team) {
              if (firstTeamTouch === null) firstTeamTouch = player;
              else if (firstTeamTouch !== player) multiTeamTouch = true;
            }
          }
        },
        wall(body, _velocity, type) { if (body.team === -1 && touches && type !== 'net') boards++; }
      };
      let hitDec = false;
      const checkDecided = canDecide ? bodies => {
        if (touches > 0 && decided(bodies)) { hitDec = true; return true; }
        return false;
      } : null;
      const allMoves = team
        ? [response[0], response[1], response[2], moves[0], moves[1], moves[2]]
        : [moves[0], moves[1], moves[2], response[0], response[1], response[2]];
      const result = M.resolveTurn(P, state, allMoves, {
        effects: false, fastSearch: true, fastTick: true, ticks: searchTicks,
        decided: checkDecided, watch, preservePartial: true
      });
      simulations++;
      const ticksDone = result.replay.ticks;
      ticks += ticksDone;
      const endBodies = result.state.bodies;
      const partial = !hitDec && result.replay.goal === null && ticksDone < fullTurnTicks && !P.settled(endBodies);
      const comp = boards + Math.max(0, touches - 1);
      const endBall = endBodies[6];
      const goal = result.replay.goal;
      const speedShare = goal === null ? 0 : Math.max(0, 1 - ticksDone / fullTurnTicks);
      const val = evaluateBodies(endBodies, result.state.fouls, team, goal, weights, comp, toucher, multiTeamTouch, tmw, partial, pulse)
        + (goal === team ? weights.goal * 0.0006 * speedShare : 0);
      const valOpp = evalOpp
        ? evaluateBodies(endBodies, result.state.fouls, 1 - team, goal, rawWeights, comp, toucher, false, 0.5, partial, pulse)
          + (goal === 1 - team ? rawWeights.goal * 0.0006 * speedShare : 0)
        : 0;
      return {
        val, valOpp, ticksDone, activeMask: aMask, boards, multiTeamTouch,
        endBallX: endBall.x, endBallY: endBall.y, goalScored: result.replay.goal
      };
    }

    function simulate(moves, response, r) {
      const key = planKey(moves, r);
      let cached = results.get(key);
      if (cached === undefined) {
        const out = runRollout(moves, response);
        cached = out.val;
        results.set(key, cached);
        activeMasks.set(key, out.activeMask);
        if (r === 0) rolloutMeta.set(key, { boards: out.boards, multiTeamTouch: out.multiTeamTouch });
      }
      return cached;
    }

    function activeMaskOf(moves) {
      return activeMasks.get(planKey(moves, 0)) || 0;
    }

    function roleFit(moves) {
      let n = 0;
      for (let i = 0; i < 3; i++) {
        const p = moves[i], b = state.bodies[ownStart + i];
        if (startCreaseWarned && M.inCrease(P, b, team)) {
          if (!p.power || p.guard) {
            const isStalwart = p.superArm && b.equippedSuper?.key?.toLowerCase() === 'stalwart';
            if (!isStalwart) { n -= 20; continue; }
          }
        }
        if (fitsRole(jobs[i], p, b, state)) n++;
      }
      return n;
    }

    function combineValues(vals, fit) {
      let sum = 0, minV = Infinity;
      for (let r = 0; r < vals.length; r++) {
        const vr = vals[r];
        sum += vr;
        if (vr < minV) minV = vr;
      }
      let combined = (sum / vals.length) * (1 - settings.risk) + minV * settings.risk + fit * weights.role;
      if (vals[0] <= -weights.goal * 0.85) {
        combined = Math.min(combined, -weights.goal * 0.65 + fit * weights.role);
      }
      return combined;
    }

    // Ensures an entry has passed ±2° / ±5% execution wobble (+ catastrophic own-goal veto) before winning or entering final sampling.
    function ensureWobbled(entry) {
      if (!entry || entry.wobbled || settings.wobble === false) return entry ? entry.value : -Infinity;
      const wPos = simulate(wobble(entry.moves, 1), responses[0], 0);
      const wNeg = simulate(wobble(entry.moves, -1), responses[0], 0);
      if (entry.values[0] > -weights.goal * 0.5 && (wPos <= -weights.goal * 0.85 || wNeg <= -weights.goal * 0.85)) {
        entry.values[0] = Math.min((entry.values[0] + wPos + wNeg) / 3, -3500);
      } else {
        entry.values[0] = (entry.values[0] + wPos + wNeg) / 3;
      }
      if (settings.godWobble && respCount >= 3 && entry.values.length >= 3) {
        const gwPos = simulate(wobble(entry.moves, 1), responses[2], 2);
        const gwNeg = simulate(wobble(entry.moves, -1), responses[2], 2);
        entry.values[2] = (entry.values[2] + gwPos + gwNeg) / 3;
      }
      entry.value = combineValues(entry.values, entry.fit);
      entry.wobbled = true;
      return entry.value;
    }

    const scored = [], finalists = [];
    const useScreenTop = Number.isInteger(settings.screenTop) && respCount > 1;
    const maxGoal = weights.goal * 1.0066; // Includes the fast-goal tie-break.
    const pruneMargin = Math.max(8, 1.8 * settings.temperature);
    let nearWobbles = 0;
    let bestScore = -Infinity;
    let bestR0 = -Infinity;
    let bestMin = -Infinity;
    let bestAvg01 = -Infinity;

    // Two-Stage Inline Gate:
    // Stage A checks r=0 (legacy) with a generous apples-to-apples reference min(bestScore, bestR0).
    // Stage B finishes r=1..k and runs inline wobble BEFORE updating bestScore so 1-px flukes never hijack search.
    function score(moves, primaryStrike) {
      const fit = roleFit(moves);
      if (useScreenTop) {
        const v0 = simulate(moves, responses[0], 0);
        let quickVal = v0 + fit * weights.role;
        if (respCount > 1 && v0 >= bestScore - 30) {
          const vCheck = simulate(moves, responses[respCount - 1], respCount - 1);
          quickVal = 0.5 * (v0 + vCheck) * (1 - settings.risk) + Math.min(v0, vCheck) * settings.risk + fit * weights.role;
        }
        evaluated++;
        finalists.push({ moves, fit, v0, preVal: quickVal });
        return { value: quickVal, r0: v0 + fit * weights.role, avg01: quickVal };
      }

      const v0 = simulate(moves, responses[0], 0);
      const r0WithFit = v0 + fit * weights.role;
      const meta0 = rolloutMeta.get(planKey(moves, 0));
      if (respCount === 1) {
        evaluated++;
        let val1 = r0WithFit, didWobble = settings.wobble === false;
        if (settings.wobble !== false && (bestScore === -Infinity || val1 >= bestScore - 10)) {
          const wPos = simulate(wobble(moves, 1), responses[0], 0);
          const wNeg = simulate(wobble(moves, -1), responses[0], 0);
          const rawW = (v0 > -weights.goal * 0.5 && (wPos <= -weights.goal * 0.85 || wNeg <= -weights.goal * 0.85))
            ? Math.min((v0 + wPos + wNeg) / 3, -3500)
            : (v0 + wPos + wNeg) / 3;
          val1 = rawW + fit * weights.role;
          didWobble = true;
        }
        scored.push({ moves, value: val1, fit, values: [val1 - fit * weights.role], meta: meta0, wobbled: didWobble });
        return { value: val1, r0: r0WithFit, avg01: val1 };
      }

      if (v0 <= -weights.goal * 0.85 && bestScore > -weights.goal * 0.5) {
        evaluated++;
        return { value: r0WithFit, r0: r0WithFit, avg01: r0WithFit };
      }
      const cleanGoalLocked = bestScore >= weights.goal * 0.995;
      if (cleanGoalLocked && !(primaryStrike && (settings.counterBudget || 0) >= 20) && r0WithFit <= bestScore + 0.25) {
        evaluated++;
        return { value: r0WithFit, r0: r0WithFit, avg01: r0WithFit };
      }
      if (bestScore > -Infinity && v0 < 5000) {
        const minCap = bestMin < 4000 ? bestMin + 30 : bestScore;
        const r0Ref = Math.min(bestScore, bestR0, minCap);
        const r0Gate = (primaryStrike && bestMin < 2000) ? 500 : 120;
        if (r0WithFit < r0Ref - r0Gate) {
          evaluated++;
          return { value: Math.min(r0WithFit, bestScore - 22), r0: r0WithFit, avg01: r0WithFit };
        }
      }

      const values = new Array(respCount);
      values[0] = v0;
      let sumSoFar = v0, minSoFar = v0;
      let candAvg01 = r0WithFit;
      for (let r = 1; r < respCount; r++) {
        const v = simulate(moves, responses[r], r);
        values[r] = v;
        sumSoFar += v;
        if (v < minSoFar) minSoFar = v;
        if (r === 1) {
          candAvg01 = 0.5 * (v0 + v) * (1 - settings.risk) + minSoFar * settings.risk + fit * weights.role;
        }

        if (r + 1 < respCount && bestScore > -Infinity) {
          const rem = respCount - (r + 1);
          const exactUpper = ((sumSoFar + rem * maxGoal) / respCount) * (1 - settings.risk) +
            Math.min(minSoFar, maxGoal) * settings.risk + fit * weights.role;
          if (exactUpper < bestScore - pruneMargin) {
            evaluated++;
            return { value: exactUpper, r0: r0WithFit, avg01: candAvg01 };
          }
          if (r === 1 && v0 < 1800 && v < 1800) {
            const avg01Ref = Math.min(bestScore, bestAvg01);
            if (candAvg01 < avg01Ref - 80) {
              evaluated++;
              return { value: candAvg01, r0: r0WithFit, avg01: candAvg01 };
            }
          }
        }
      }
      evaluated++;
      const preVal = combineValues(values, fit);

      const isChallenger = bestScore === -Infinity || preVal > bestScore + 0.1;
      const isNearTie = !cleanGoalLocked && nearWobbles < 1 && preVal >= bestScore - Math.max(3, settings.temperature);
      const entry = { moves, value: preVal, fit, values, meta: meta0, wobbled: settings.wobble === false };
      if (settings.wobble !== false && (isChallenger || isNearTie)) {
        if (!isChallenger) nearWobbles++;
        ensureWobbled(entry);
        const wAvg01 = 0.5 * (values[0] + values[1]) * (1 - settings.risk) + Math.min(values[0], values[1]) * settings.risk + fit * weights.role;
        scored.push(entry);
        let minW = Infinity;
        for (let r = 0; r < values.length; r++) if (values[r] < minW) minW = values[r];
        return { value: entry.value, r0: values[0] + fit * weights.role, minVal: minW + fit * weights.role, avg01: wAvg01 };
      }
      scored.push(entry);
      return { value: preVal, r0: r0WithFit, minVal: minSoFar + fit * weights.role, avg01: candAvg01 };
    }

    // 1. Seed plan (legacy heuristic — preserves candidates:1 parity)
    const seenPlans = new Set();
    seenPlans.add(planKey(best, 0));
    const seedRes = score(best, true);
    bestScore = seedRes.value;
    bestR0 = seedRes.r0;
    bestMin = seedRes.minVal ?? seedRes.value;
    bestAvg01 = seedRes.avg01;

    function consider(moves, primaryStrike = false) {
      if (evaluated >= settings.candidates) return false;
      const pk = planKey(moves, 0);
      if (seenPlans.has(pk)) return false;
      seenPlans.add(pk);
      const res = score(moves, primaryStrike);
      if (res.value > bestScore + 1e-8) {
        best = moves;
        bestScore = res.value;
        bestR0 = res.r0;
        bestMin = res.minVal ?? res.value;
        bestAvg01 = res.avg01;
        nearWobbles = 0;
      }
      return true;
    }

    // 2. Single-skater interleaved option sweep
    const choices = [0, 1, 2].map(i => options(state, team, i, best[i]));
    const maxChoiceLen = Math.max(choices[0].length, choices[1].length, choices[2].length);
    for (let j = 0; j < maxChoiceLen && evaluated < settings.candidates * 0.52; j++) {
      for (let i = 0; i < 3; i++) {
        const opt = choices[i][j];
        if (opt) {
          const next = best.slice();
          next[i] = opt;
          const intent = getIntent(opt);
          consider(next, i === primaryAtkIdx && j <= 8 && (intent === 'shoot' || intent === 'carry' || intent === 'magnet'));
        }
      }
    }

    // 3. Coordinated 3-player plays (Sticky escort, Defensive Fire Drill, Screen-Breaker, Snap one-timers, Pack-Draft)
    if (evaluated < settings.candidates * 0.68) {
      const joint = jointTeamPlays(state, team, best, jobs);
      for (let jp = 0; jp < joint.length && evaluated < settings.candidates * 0.68; jp++) {
        consider(joint[jp], jp < 6);
      }
    }

    // 4. Active-Toucher Two-Gear Fine-Tuning
    const shuffles = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    function teamPlan() {
      const order = evaluated % 3 ? shuffles[0] : shuffles[Math.floor(random() * 6)];
      const out = new Array(3);
      for (let i = 0; i < 3; i++) {
        const fitting = choices[i].filter(p => fitsRole(jobs[order[i]], p, state.bodies[ownStart + i], state));
        const pool = fitting.length ? fitting : choices[i];
        out[i] = pool[Math.floor(random() * pool.length)];
      }
      return out;
    }

    const anyUnstunned = !state.bodies[ownStart].stunned || !state.bodies[ownStart + 1].stunned || !state.bodies[ownStart + 2].stunned;
    const defRoleIdx = jobs.indexOf('defend');
    const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
    const step4Threat = assessOpponentThreat(state, team, classic);
    const activeBuf = [0, 0, 0], fallbackBuf = [0, 0, 0];
    const refineStart = evaluated;
    const refineSpan = Math.max(1, settings.candidates - refineStart);

    let loopGuard = 0;
    const maxLoopSteps = settings.candidates * 3;
    while (evaluated < settings.candidates && anyUnstunned && ++loopGuard <= maxLoopSteps) {
      const frac = (evaluated - refineStart) / refineSpan;
      if (evaluated % 4 === 0 && frac < 0.85) {
        if (consider(teamPlan(), false)) continue;
      }
      const next = [copy(best[0]), copy(best[1]), copy(best[2])];
      const mask = activeMaskOf(best);
      const concedingCrisis = bestMin <= -weights.goal * 0.5;
      let actLen = 0, fbLen = 0;
      for (let idx = 0; idx < 3; idx++) {
        const skB = state.bodies[ownStart + idx];
        if (skB.stunned) continue;
        if (!next[idx].guard || concedingCrisis) {
          fallbackBuf[fbLen++] = idx;
          const isDef = idx === defRoleIdx || Math.abs(skB.x - ownGoalX) < 190;
          if (((mask & (1 << idx)) && next[idx].power > 0) || (concedingCrisis && isDef)) {
            activeBuf[actLen++] = idx;
          }
        }
      }
      const useActive = actLen > 0 && random() < 0.78;
      const pool = useActive ? activeBuf : fallbackBuf;
      const poolLen = useActive ? actLen : fbLen;
      if (!poolLen) {
        consider(teamPlan(), false);
        continue;
      }
      const fineGear = frac >= 0.60;
      const angSpan = fineGear ? 0.09 : 0.28;
      const pwrSpan = fineGear ? 0.09 : 0.25;
      const dualEdit = settings.godRefine && poolLen >= 2 && random() < 0.30;
      const nEdits = dualEdit ? 2 : 1;
      const pick0 = Math.floor(random() * poolLen);
      for (let e = 0; e < nEdits; e++) {
        const i = e === 0 ? pool[pick0] : pool[(pick0 + 1) % poolLen];
        const sk = state.bodies[ownStart + i];
        if (step4Threat.shotDanger && !startCreaseWarned && i === defRoleIdx && !next[i].guard && Math.hypot(sk.x - ownGoalX, sk.y - RINK_CY) < 105 && random() < 0.08) {
          next[i].angle = 0;
          next[i].power = 0;
          next[i].spin = 0;
          next[i].guard = true;
          next[i].superArm = Boolean(!classic && sk.meter >= 100 && sk.equippedSuper?.key?.toLowerCase() === 'stalwart');
          continue;
        }
        if (next[i].guard) {
          next[i].guard = false;
          const pPt = goalPocketPoint(state.bodies[6].x, state.bodies[6].y, team, canOccupyCrease(state, team, i));
          const rescue = aim(sk, pPt.x, pPt.y, 220, null, 0);
          next[i].angle = rescue.angle;
          next[i].power = Math.max(0.55, rescue.power);
        }
        next[i].angle += (random() - 0.5) * angSpan;
        next[i].power = Math.max(0, Math.min(1, (next[i].power || 0.45) + (random() - 0.5) * pwrSpan));
        if (next[i].power > 0) {
          const sk = state.bodies[ownStart + i];
          const spinSpan = fineGear ? 0.20 : (0.35 + 0.35 * creativityOf(sk));
          next[i].spin = Math.max(-1, Math.min(1, next[i].spin + (random() - 0.5) * spinSpan));
          if (!classic && sk.meter >= 100 && sk.equippedSuper && random() < 0.18) {
            next[i].superArm = !next[i].superArm;
          }
        } else {
          next[i].angle = 0;
          next[i].spin = 0;
        }
      }
      consider(next, false);
    }

    // 5. Optional screenTop path when caller explicitly specifies settings.screenTop
    if (useScreenTop && finalists.length) {
      const byBasin = new Map();
      for (let k = 0; k < finalists.length; k++) {
        const f = finalists[k];
        const bKey = planBasinKey(f.moves);
        f.basin = bKey;
        const prev = byBasin.get(bKey);
        if (!prev || f.preVal > prev.preVal) byBasin.set(bKey, f);
      }
      const distinct = Array.from(byBasin.values());
      distinct.sort((a, b) => b.preVal - a.preVal);
      const topK = Math.min(distinct.length, settings.screenTop);
      for (let idx = 0; idx < topK; idx++) {
        const cand = distinct[idx];
        const values = new Array(respCount);
        values[0] = cand.v0;
        for (let r = 1; r < respCount; r++) {
          values[r] = simulate(cand.moves, responses[r], r);
        }
        const entry = {
          moves: cand.moves,
          value: combineValues(values, cand.fit),
          basin: cand.basin,
          fit: cand.fit,
          values,
          meta: rolloutMeta.get(planKey(cand.moves, 0)),
          wobbled: settings.wobble === false
        };
        ensureWobbled(entry);
        scored.push(entry);
      }
    }

    // 6. Trajectory-Aware Adversarial Counter-Search (Hard+) + Mandatory Runner-Up Wobble Verification
    let finalPool = scored;
    if (settings.counterBudget > 0 && evaluated > 4 && scored.length > 1) {
      const oppTeam = 1 - team, oppStart = oppTeam * 3;
      const oppJobs = roles(state, oppTeam);
      const oppOwnGoal = oppTeam ? RINK_RIGHT : RINK_LEFT;
      const ball = state.bodies[6];
      const byBasin = new Map();
      for (let s = 0; s < scored.length; s++) {
        const entry = scored[s];
        const key = entry.basin || planBasinKey(entry.moves);
        entry.basin = key;
        const prev = byBasin.get(key);
        if (!prev || entry.value > prev.value) byBasin.set(key, entry);
      }
      const ranked = Array.from(byBasin.values()).sort((a, b) => b.value - a.value);
      const topLimit = settings.counterTop || 8;
      const topBasins = ranked.slice(0, topLimit);
      const counterThreat = assessOpponentThreat(state, team, classic);
      if (counterThreat.shotDanger && ranked.length > topLimit && topBasins[0].value < weights.goal * 0.9) {
        const dIdx = jobs.indexOf('defend') >= 0 ? jobs.indexOf('defend') : 0;
        const ourGoalX = team ? RINK_RIGHT : RINK_LEFT;
        const staysInPocket = entry => {
          const b = state.bodies[ownStart + dIdx], m = entry.moves[dIdx];
          if (!m) return false;
          if (m.guard || !m.power) return Math.abs(b.x - ourGoalX) < 105;
          const endX = b.x + Math.cos(m.angle) * m.power * P.launchSpeed(b) * 0.28;
          return Math.abs(endX - ourGoalX) < 75;
        };
        if (!topBasins.some(e => e.moves[dIdx]?.guard)) {
          const bestGuard = ranked.slice(topLimit).find(e => e.moves[dIdx]?.guard);
          if (bestGuard && topBasins.length >= 3) topBasins[topBasins.length - 1] = bestGuard;
        }
        if (topLimit >= 5 && !topBasins.some(staysInPocket)) {
          const bestPocket = ranked.slice(topLimit).find(e => staysInPocket(e) && !topBasins.includes(e));
          if (bestPocket) topBasins[topBasins.length - 2] = bestPocket;
        }
      }
      const usedRespKeys = new Map();
      for (let r = 0; r < responses.length; r++) usedRespKeys.set(planKey(responses[r], 0), r);

      const oppSuperOf = idx => {
        const ob = state.bodies[oppStart + idx];
        return (!classic && !ob.stunned && (ob.meter ?? 0) >= 100 && ob.equippedSuper)
          ? ob.equippedSuper.key?.toLowerCase()
          : null;
      };

      function findCounter(targetMoves, seedOpp, budget) {
        const seenOpp = new Set([planKey(seedOpp, 0)]);
        const seedOut = runRollout(targetMoves, seedOpp, true);
        let oppBest = seedOpp, oppBestScore = seedOut.valOpp, targetValUs = seedOut.val;
        let oppEval = 1;

        function tryOpp(candOpp) {
          if (oppEval >= budget) return false;
          const k = planKey(candOpp, 0);
          if (seenOpp.has(k)) return false;
          seenOpp.add(k);
          const out = runRollout(targetMoves, candOpp, true);
          oppEval++;
          if (out.valOpp > oppBestScore + 1e-8) {
            oppBest = candOpp;
            oppBestScore = out.valOpp;
            targetValUs = out.val;
          }
          return true;
        }

        // Phase A: Targeted intercepts against the actual ball trajectory & active CPU playmakers from seedOut
        const endBx = seedOut.endBallX, endBy = seedOut.endBallY;
        const midX = Math.max(RINK_LEFT + 42, Math.min(RINK_RIGHT - 42, (ball.x + endBx) * 0.5));
        const midY = Math.max(RINK_TOP + 42, Math.min(RINK_BOTTOM - 42, (ball.y + endBy) * 0.5));
        const plugX = oppOwnGoal + (oppTeam ? -88 : 88);
        const plugY = Math.max(RINK_CY - 48, Math.min(RINK_CY + 48, seedOut.goalScored === team ? RINK_CY + (endBy - RINK_CY) * 0.85 : endBy));

        let iPlug = -1, bestPlugD = Infinity, iMid = -1, bestMidD = Infinity;
        for (let i = 0; i < 3; i++) {
          const ob = state.bodies[oppStart + i];
          if (ob.stunned || ob.carded) continue;
          const dp = Math.hypot(ob.x - plugX, ob.y - plugY);
          if (dp < bestPlugD) { bestPlugD = dp; iPlug = i; }
          const dm = Math.hypot(ob.x - midX, ob.y - midY);
          if (dm < bestMidD) { bestMidD = dm; iMid = i; }
        }
        if (iPlug >= 0) {
          const ob = state.bodies[oppStart + iPlug], oSup = oppSuperOf(iPlug);
          const armP = (oSup === 'stalwart' || oSup === 'colossus' || oSup === 'magnet') ? oSup : null;
          const plugMv = aim(ob, plugX, plugY, 115, armP, 0);
          if (armP) plugMv.superArm = true;
          const cPlug = oppBest.slice();
          cPlug[iPlug] = plugMv;
          tryOpp(cPlug);
          if (iMid >= 0 && iMid !== iPlug && seedOut.goalScored === team) {
            const mb = state.bodies[oppStart + iMid], mSup = oppSuperOf(iMid);
            const armM = (mSup === 'sticky' || mSup === 'magnet' || mSup === 'colossus' || mSup === 'shockwave') ? mSup : null;
            const midMv = aim(mb, midX, midY, 195, armM, 0);
            if (armM) midMv.superArm = true;
            const cDouble = cPlug.slice();
            cDouble[iMid] = midMv;
            tryOpp(cDouble);
          }
        }
        if (iMid >= 0) {
          const mb = state.bodies[oppStart + iMid], mSup = oppSuperOf(iMid);
          const armM = (mSup === 'sticky' || mSup === 'magnet' || mSup === 'colossus' || mSup === 'shockwave') ? mSup : null;
          const midMv = aim(mb, midX, midY, 195, armM, 0);
          if (armM) midMv.superArm = true;
          const cMid = oppBest.slice();
          cMid[iMid] = midMv;
          tryOpp(cMid);
        }

        // Body-check the active CPU skater(s) who touched/drove the ball in seedOut
        const aMask = seedOut.activeMask;
        for (let k = 0; k < 3 && oppEval < budget; k++) {
          if (!(aMask & (1 << k))) continue;
          const uk = state.bodies[ownStart + k], mvk = targetMoves[k];
          const ukX = uk.x + (mvk.power > 0 && !mvk.guard ? Math.cos(mvk.angle) * 75 : 0);
          const ukY = uk.y + (mvk.power > 0 && !mvk.guard ? Math.sin(mvk.angle) * 75 : 0);
          let bestChecker = -1, bestChkD = Infinity;
          for (let i = 0; i < 3; i++) {
            const ob = state.bodies[oppStart + i];
            if (ob.stunned || ob.carded) continue;
            const d = Math.hypot(ob.x - ukX, ob.y - ukY);
            if (d < bestChkD) { bestChkD = d; bestChecker = i; }
          }
          if (bestChecker >= 0) {
            const cb = state.bodies[oppStart + bestChecker], cSup = oppSuperOf(bestChecker);
            const armC = (cSup === 'knockout' || cSup === 'shockwave' || cSup === 'colossus') ? cSup : null;
            const chkMv = aim(cb, ukX, ukY, 225, armC, 0);
            if (armC) chkMv.superArm = true;
            const cChk = oppBest.slice();
            cChk[bestChecker] = chkMv;
            tryOpp(cChk);
          }
        }

        // Phase A2: Opponent Scoring Punish — expose empty-net gambles, un-guarded fireball lanes, spin-curves & 2-on-1 Snap passes
        if (seedOut.goalScored !== team && oppEval < budget && counterThreat.shotDanger) {
          const ourGoalX = team ? RINK_RIGHT : RINK_LEFT;
          const oppStr = counterThreat.oppStrikerIdx;
          if (oppStr >= 0 && Math.abs(ball.x - ourGoalX) < 590) {
            const sb = state.bodies[oppStart + oppStr], sSup = oppSuperOf(oppStr);
            const armShot = (sSup === 'cannonball' || sSup === 'sticky' || sSup === 'ghost') ? sSup : null;
            const projOur = [0, 1, 2].map(k => {
              const uk = state.bodies[ownStart + k], mvk = targetMoves[k];
              if (uk.carded) return uk;
              if (!mvk || mvk.guard || !mvk.power) return uk;
              const spd = mvk.power * P.launchSpeed(uk);
              return {
                ...uk,
                x: uk.x + Math.cos(mvk.angle) * spd * 0.28,
                y: uk.y + Math.sin(mvk.angle) * spd * 0.28,
                radius: uk.radius
              };
            });

            if (counterThreat.oppReceiverIdx >= 0 && counterThreat.oppReceiverIdx !== oppStr) {
              const oppJoint = jointTeamPlays(state, oppTeam, oppBest, oppJobs);
              const snapJ = oppJoint.find(jp => getIntent(jp[oppStr]) === 'pass' && getIntent(jp[counterThreat.oppReceiverIdx]) === 'shoot');
              if (snapJ) {
                tryOpp(snapJ);
                if (oppEval < budget) {
                  const crispSnap = snapJ.slice();
                  crispSnap[oppStr] = { ...snapJ[oppStr], power: Math.min(1, snapJ[oppStr].power * 1.14) };
                  tryOpp(crispSnap);
                }
              }
            }

            const dIdx = jobs.indexOf('defend') >= 0 ? jobs.indexOf('defend') : 0;
            const punishAp = scanGoalAperture(ball, ourGoalX, projOur);
            const farCornerY = projOur[dIdx].y <= RINK_CY ? RINK_CY + 35 : RINK_CY - 35;
            const nearCornerY = projOur[dIdx].y <= RINK_CY ? RINK_CY - 35 : RINK_CY + 35;
            const shotYs = punishAp.y !== RINK_CY ? [punishAp.y, farCornerY] : [farCornerY, nearCornerY];
            for (const shotY of shotYs) {
              if (oppEval >= budget) break;
              const cSnipe = oppBest.slice();
              const snipeMv = strike(sb, ball, ourGoalX, shotY, armShot, 0);
              snipeMv.power = 1;
              if (armShot) snipeMv.superArm = true;
              cSnipe[oppStr] = snipeMv;
              tryOpp(cSnipe);
            }

            if (oppEval < budget) {
              if (sSup === 'cannonball') {
                const gy = projOur[dIdx].y;
                for (const offY of [-32, 32]) {
                  if (oppEval >= budget) break;
                  const cGlance = oppBest.slice();
                  const gMv = strike(sb, ball, ourGoalX, Math.max(GOAL_Y_TOP + 18, Math.min(GOAL_Y_BOT - 18, gy + offY)), armShot, 0);
                  gMv.power = 1;
                  if (armShot) gMv.superArm = true;
                  cGlance[oppStr] = gMv;
                  tryOpp(cGlance);
                }
              } else {
                const spinDir = oppTeam ? -1 : 1;
                for (const sideSign of [-1, 1]) {
                  if (oppEval >= budget) break;
                  const cBender = oppBest.slice();
                  const rawAimY = RINK_CY + sideSign * 110;
                  const bMv = strike(sb, ball, ourGoalX, rawAimY, null, 0);
                  bMv.power = 1;
                  bMv.spin = sideSign * spinDir;
                  cBender[oppStr] = bMv;
                  tryOpp(cBender);
                }
              }
            }
          }
        }

        // Phase B: Coordinated opponent team plays (including Defensive Fire Drill & Snap one-timers)
        const jointCap = Math.min(budget, oppEval + Math.max(2, Math.floor(budget * 0.25)));
        if (oppEval < jointCap) {
          const oppJoint = jointTeamPlays(state, oppTeam, oppBest, oppJobs);
          for (let jp = 0; jp < oppJoint.length && oppEval < jointCap; jp++) tryOpp(oppJoint[jp]);
        }

        // Phase C: Single-skater option sweep starting at j=3 (skipping redundant HOLD/GUARD/cleanBase slots)
        if (oppEval < budget) {
          const oppChoices = [0, 1, 2].map(i => options(state, oppTeam, i, oppBest[i]));
          const maxLen = Math.max(oppChoices[0].length, oppChoices[1].length, oppChoices[2].length);
          for (let j = 3; j < maxLen && oppEval < budget; j++) {
            for (let i = 0; i < 3 && oppEval < budget; i++) {
              const opt = oppChoices[i][j];
              if (opt) {
                const nextOpp = oppBest.slice();
                nextOpp[i] = opt;
                tryOpp(nextOpp);
              }
            }
          }
        }
        return { moves: oppBest, valForUs: targetValUs };
      }

      // Ensure #1 entering counter-search is wobble-verified
      while (topBasins.length && !topBasins[0].wobbled) {
        ensureWobbled(topBasins[0]);
        topBasins.sort((a, b) => b.value - a.value);
      }

      let prevTarget = null;
      const rounds = settings.counterRounds || 1;
      for (let round = 0; round < rounds; round++) {
        const target = topBasins[0];
        if (!target || target === prevTarget || !target.values) break;
        prevTarget = target;
        let worstIdx = 0;
        for (let r = 1; r < target.values.length; r++) {
          if (target.values[r] < target.values[worstIdx]) worstIdx = r;
        }
        const counter = findCounter(target.moves, responses[worstIdx] || responses[0], settings.counterBudget);
        const cKey = planKey(counter.moves, 0);
        if (usedRespKeys.has(cKey)) break;
        const rNew = responses.length;
        usedRespKeys.set(cKey, rNew);
        responses.push(counter.moves);
        results.set(planKey(target.moves, rNew), counter.valForUs);

        for (let k = 0; k < topBasins.length; k++) {
          const cand = topBasins[k];
          const vNew = k === 0 ? counter.valForUs : simulate(cand.moves, counter.moves, rNew);
          cand.values.push(vNew);
          cand.value = combineValues(cand.values, cand.fit);
        }
        topBasins.sort((a, b) => b.value - a.value);

        // If counter-search knocked down #1 and promoted an unwobbled runner-up, wobble-verify the new leader immediately!
        while (topBasins.length && !topBasins[0].wobbled) {
          ensureWobbled(topBasins[0]);
          topBasins.sort((a, b) => b.value - a.value);
        }
      }
      finalPool = topBasins;
    }

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
          if (!defB.stunned) {
            const dSup = supKeyOf(defI);
            if (!defWarned && Math.hypot(defB.x - sCone.x, defB.y - sCone.y) < 24 && Math.hypot(defB.vx || 0, defB.vy || 0) < 45) {
              lockdown[defI] = { ...GUARD, superArm: Boolean(dSup === 'stalwart') };
            } else {
              const armD = (Math.abs(sBall.x - sOwnGoal) < 340 && (dSup === 'stalwart' || dSup === 'colossus')) ? dSup : null;
              const mvD = aim(defB, sCone.x, sCone.y, 105, armD, 0);
              if (armD) mvD.superArm = true;
              lockdown[defI] = mvD;
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
            const bankTopY = 2 * (RINK_TOP + sBallR) - RINK_CY;
            const bankBotY = 2 * (RINK_BOTTOM - sBallR) - RINK_CY;
            const topClr = segmentBlocked(sBall.x, sBall.y, (sBall.x + sAtkGoal) * 0.5, RINK_TOP + sBallR, sEnemies, sBallR + 4);
            const chosenBankY = !topClr ? bankTopY : bankBotY;
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
              const v = evaluateBodies(eb2, res2.state.fouls, team, res2.replay.goal, weights, 0, null, false, tmw, partial2, pulse);
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
          const v1Settled = evaluateBodies(s2.bodies, s2.fouls, team, null, weights, 0, null, false, tmw, false, pulse);
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

    // Before final selection, guarantee that the leader and any contender within the style/Boltzmann window is wobble-verified
    if (settings.wobble !== false && finalPool.length > 0) {
      const byBasin = new Map();
      for (let s = 0; s < finalPool.length; s++) {
        const entry = finalPool[s];
        const key = entry.basin || planBasinKey(entry.moves);
        entry.basin = key;
        const prev = byBasin.get(key);
        if (!prev || entry.value > prev.value) byBasin.set(key, entry);
      }
      const distinctPool = Array.from(byBasin.values()).sort((a, b) => b.value - a.value);
      while (distinctPool.length && !distinctPool[0].wobbled) {
        ensureWobbled(distinctPool[0]);
        distinctPool.sort((a, b) => b.value - a.value);
      }
      const leaderVal = distinctPool[0]?.value ?? -Infinity;
      const contendMargin = Math.max(20, 3 * settings.temperature);
      for (let i = 1; i < distinctPool.length; i++) {
        if (!distinctPool[i].wobbled && distinctPool[i].value >= leaderVal - contendMargin) {
          ensureWobbled(distinctPool[i]);
        }
      }
      finalPool = distinctPool;
    }

    const chosen = choose(finalPool, settings.temperature, random, style);
    return {
      plans: M.validatePlans(chosen.moves),
      diagnostics: { level, candidates: evaluated, simulations, ticks, score: chosen.value, milliseconds: performance.now() - started }
    };
  }

  function styleBias(entry, style) {
    if (!style) return 0;
    const moves = entry.moves;
    let pwrSum = 0, spinSum = 0, fwdSum = 0, passScore = 0, checkScore = 0, rimScore = 0, guardCount = 0, armCount = 0;
    for (let i = 0; i < 3; i++) {
      const m = moves[i], intent = getIntent(m);
      if (m.guard || !m.power) { guardCount++; continue; }
      pwrSum += m.power;
      spinSum += Math.abs(m.spin || 0);
      fwdSum += m.power * Math.cos(m.angle) * style.dir;
      if (m.superArm) armCount++;
      if (intent === 'pass' || intent === 'receive' || intent === 'draft') passScore += 0.5;
      else if (intent === 'check') checkScore += 0.5;
      else if (intent === 'rim' || intent === 'magnet') rimScore += 0.5;
    }
    const aggTerm = (style.agg - 0.5) * ((pwrSum / 3 - 0.45) * 4 + (fwdSum / 3) * 2 + checkScore - guardCount * 0.4);
    const tmwTerm = (style.tmw - 0.5) * ((entry.meta?.multiTeamTouch ? 1.5 : 0) + passScore);
    const creTerm = (style.cre - 0.5) * ((spinSum / 3) * 3 + Math.min(2, entry.meta?.boards || 0) * 0.5 + rimScore);
    let spreadTerm = 0;
    if (style.surge && entry.values && entry.values.length > 1) {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < entry.values.length; i++) {
        if (entry.values[i] < lo) lo = entry.values[i];
        if (entry.values[i] > hi) hi = entry.values[i];
      }
      spreadTerm = style.surge * (Math.min(1.5, (hi - lo) / 400) + armCount * 0.4);
    }
    const raw = (aggTerm + tmwTerm + creTerm + spreadTerm) * 4;
    return raw > 8 ? 8 : (raw < -8 ? -8 : raw);
  }

  function choose(scored, temperature, random, style = null) {
    const byBasin = new Map();
    for (let s = 0; s < scored.length; s++) {
      const entry = scored[s];
      const key = entry.basin || planBasinKey(entry.moves);
      const prev = byBasin.get(key);
      if (!prev || entry.value > prev.value) byBasin.set(key, entry);
    }
    const pool = byBasin.size > 0 ? Array.from(byBasin.values()) : scored;
    const nPool = pool.length;
    if (nPool === 1) return pool[0];

    let topObj = -Infinity;
    for (let s = 0; s < nPool; s++) {
      if (pool[s].value > topObj) topObj = pool[s].value;
    }

    const eff = new Float64Array(nPool);
    let effTop = -Infinity, topIdx = 0;
    for (let s = 0; s < nPool; s++) {
      const v = pool[s].value;
      const ev = v + (v >= topObj - 20 ? styleBias(pool[s], style) : 0);
      eff[s] = ev;
      if (ev > effTop) { effTop = ev; topIdx = s; }
    }

    const wArr = new Float64Array(nPool);
    let wSum = 0;
    for (let s = 0; s < nPool; s++) {
      const diff = (eff[s] - effTop) / temperature;
      const w = diff < -40 ? 0 : Math.exp(diff);
      wArr[s] = w;
      wSum += w;
    }
    if (wSum <= 0) return pool[topIdx];
    let pick = random() * wSum;
    for (let i = 0; i < nPool; i++) if ((pick -= wArr[i]) <= 0) return pool[i];
    return pool[topIdx];
  }

  const api = {
    LEVELS, LEVEL_LABELS, WEIGHTS, WOBBLE, COMPLEX, SEARCH_TICKS, HOLD, GUARD,
    randomSource, legacy, decided, plan, aim, strike, behindBall, isPointBlank, evaluate, features, FEATURE_NAMES, options,
    segmentBlocked, cpuPlans, baseline: cpuPlans, shotConePoint, goalPocketPoint, canOccupyCrease, traceIncomingShot, traceMovingBall, guardCoversSegment, assessOpponentThreat, scanGoalAperture, jointTeamPlays,
    learnedOpponentResponse, learnedOpponentResponses
  };
  if (node) module.exports = api; else root.ububallCPU = api;
})(globalThis);
