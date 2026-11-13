/* Deterministic, bounded team search. Uses the same turn resolver as matches. */
(function(root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const P = node ? require('./ububall-physics.js') : root.ububallPhysics;
  const M = node ? require('./ububall-match.js') : root.ububallMatch;
  const HOLD = Object.freeze({ angle: 0, power: 0, spin: 0, superArm: false, guard: false });
  const GUARD = Object.freeze({ ...HOLD, guard: true });
  const LEVELS = Object.freeze({
    easy: Object.freeze({ candidates: 18, opponents: 1, risk: .15, temperature: 80 }),
    medium: Object.freeze({ candidates: 60, opponents: 2, risk: .35, temperature: 50 }),
    hard: Object.freeze({ candidates: 120, opponents: 3, risk: .55, temperature: 25 })
  });
  const WEIGHTS = Object.freeze({
    goal: 10000, progress: 1, access: .35, cover: .3, meter: .35,
    role: 40, card: 400, warning: 150, stun: 180, daze: 120
  });
  const WOBBLE = Object.freeze({ angle: .035, power: .05 });
  const COMPLEX = Object.freeze({ simple: .45, creative: .4 });
  const ROLE_INTENTS = Object.freeze({ attack: ['shoot', 'pass'], support: ['chase', 'clear', 'receive', 'check'], defend: ['cover', 'guard', 'hold'] });
  const SEARCH_TICKS = 480;
  const TWO_PI = 2 * Math.PI;

  // Integer super IDs for unboxed TypedArray fastTick kernel (-1 = none).
  const SUP_NONE = -1, SUP_STALWART = 0, SUP_KNOCKOUT = 1, SUP_STICKY = 2,
    SUP_CANNONBALL = 3, SUP_MAGNET = 4, SUP_COLOSSUS = 5, SUP_SHOCKWAVE = 6, SUP_GHOST = 7;
  const SUPER_KEY_TO_ID = Object.freeze({
    stalwart: 0, knockout: 1, sticky: 2, cannonball: 3,
    magnet: 4, colossus: 5, shockwave: 6, ghost: 7
  });

  function decided(bodies) {
    const ball = bodies[6];
    if (ball.vx || ball.vy || ball.onFire || P.holder(bodies)) return false;
    if (M.cornerOf(P, ball.x, ball.y) !== null) return false;
    if (M.camping(P, bodies, 0) || M.camping(P, bodies, 1)) return false;
    const goalY = (P.rink.goalTop + P.rink.goalBottom) / 2;
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
      const ownGoalX = b.team ? P.rink.right : P.rink.left;
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
  const SKATER_CURVE = P?.SKATER_CURVE ?? .06, SPIN_DECAY = P?.SPIN_DECAY ?? 5;
  const contactRadius = b => Math.max(b.radius, b.reach || b.radius, 18);
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
      const dGoal = Math.hypot(b.x - 850, b.y - 300);
      return (1 - agg) * 170 - dGoal * 0.45 - surge * 40 + (sKey === 'stalwart' ? 60 : 0) + (b.slot === 0 ? 8 : 0);
    };
    const anchorIdx = anchorScore(r0) >= anchorScore(r1) ? r0 : r1;
    const wingIdx = anchorIdx === r0 ? r1 : r0;
    const wing = players[wingIdx], wTrait = traits[wingIdx];
    const wingOpenY = ball.y < 300 ? 390 : 210;
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
            tx = 60; ty = 300 + (b.y >= ball.y ? 45 : -45);
            extraDrive = 160;
          } else {
            const sideY = b.y < ball.y ? -48 : 48;
            tx = Math.min(890, ball.x + 68);
            ty = Math.max(95, Math.min(505, ball.y + sideY * (1 - Math.abs(b.x - ball.x) / 400)));
            if (cre > 0.3) spin = (sideY < 0 ? 0.55 : -0.55) * cre;
          }
        } else {
          let humanGoalie = humans[0], bestGDist = (humans[0].x - 120) ** 2 + (humans[0].y - 300) ** 2;
          for (let hi = 1; hi < 3; hi++) {
            const gd = (humans[hi].x - 120) ** 2 + (humans[hi].y - 300) ** 2;
            if (gd < bestGDist) { bestGDist = gd; humanGoalie = humans[hi]; }
          }
          const cornerY = humanGoalie && humanGoalie.y >= 300 ? 252 : 348;
          const baseGoalY = 300 + Math.max(-34, Math.min(34, (ball.y - 300) * 0.22));
          const goalY = baseGoalY + (cornerY - baseGoalY) * Math.max(0, Math.min(1, surge * 0.75 + cre * 0.25));
          const goalX = 60;

          const shotBlock = segmentBlocked(ball.x, ball.y, goalX, goalY, humans, 24);
          const approachBlock = segmentBlocked(b.x, b.y, ball.x, ball.y, humans, 20);

          let aimBallX = goalX, aimBallY = goalY;
          if (tmw >= 0.58 && surge < 0.45 && (shotBlock || ball.x > 640) && wing.x < ball.x + 40) {
            aimBallX = Math.max(150, wing.x - 45);
            aimBallY = Math.max(110, Math.min(490, wing.y + (wing.y < 300 ? 25 : -25)));
          } else if (cre >= 0.55 && shotBlock && !(canSuper && (sKey === 'cannonball' || sKey === 'shockwave'))) {
            if (cre >= 0.72 && Math.abs(ball.y - 300) > 45) {
              aimBallX = (ball.x + goalX) * 0.5;
              aimBallY = ball.y < 300 ? 78 : 522;
            } else {
              spin = shotBlock.side * Math.min(1, 0.45 + cre * 0.55);
            }
          }
          if (spin === 0 && cre > 0.35) {
            spin = Math.max(-1, Math.min(1, ((b.y - ball.y) / 180) * cre * 0.75));
          }

          const bdx = aimBallX - ball.x, bdy = aimBallY - ball.y, bd = Math.hypot(bdx, bdy) || 1;
          const jitterScale = Math.max(0.15, 1 - Math.max(0, -surge) * 0.75);
          const jitter = (random() - 0.5) * 10 * jitterScale;
          tx = ball.x - (bdx / bd) * contactDist;
          ty = ball.y - (bdy / bd) * contactDist + jitter;
          extraDrive = 220 + agg * 50 + surge * 75;

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
        const anchorY = Math.max(300 - ySpan, Math.min(300 + ySpan, ball.y));

        if (ball.x > 740 && b.x >= ball.x - 8 && dBall < 170 && (agg > 0.25 || ball.x > 810)) {
          const clearY = ball.y < 300 ? 140 : 460;
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
          if (cre > 0.5) spin = (ty < 300 ? 0.35 : -0.35) * cre;
          if (canSuper) {
            if (sKey === 'magnet' && dBall < 190) superArm = true;
            else if (sKey === 'ghost' && segmentBlocked(b.x, b.y, tx, ty, humans, 18)) superArm = true;
            else if (sKey === 'colossus' && (dBall < 220 || surge > 0.4)) superArm = true;
          }
        }
      }

      const dx = tx - b.x, dy = ty - b.y, distance = Math.hypot(dx, dy);
      const superLaunchScale = (superArm && sKey === 'colossus' && b.superActive !== 'colossus') ? P.SUPER.colossusLaunch
        : (superArm && sKey === 'stalwart' && b.superActive !== 'stalwart' ? P.SUPER.stalwartLaunch : 1);
      const maxV = P.launchSpeed(b) * (P.carveDriveBoost ? P.carveDriveBoost(b, spin) : 1) * superLaunchScale;
      const effFriction = b.friction * ((superArm && sKey === 'stalwart') || b.superActive === 'stalwart' ? P.SUPER.stalwartFriction : b.holding ? P.SUPER.carryFriction : 1);
      let angle = Math.atan2(dy, dx);
      const power = distance < 10 ? 0 : Math.min(1, Math.sqrt(2 * effFriction * Math.max(0, distance + extraDrive)) / maxV);

      if (Math.abs(spin) > 0.01 && power > 0.05) {
        const omega0 = spin * (b.maxSpin || 15);
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
          x: 1000 - s.x,
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
        x: 1000 - sb.x,
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

  function aim(body, x, y, drive = 0, superKey = null) {
    const dx = x - body.x, dy = y - body.y;
    const distance = Math.hypot(dx, dy);
    const superScale = superKey === 'colossus' && body.superActive !== 'colossus' ? (P.SUPER.colossusLaunch ?? (1 / P.SUPER.colossusMass))
      : (superKey === 'stalwart' && body.superActive !== 'stalwart' ? (P.SUPER.stalwartLaunch ?? 0.5) : 1);
    const maxV = P.launchSpeed(body) * superScale;
    const frictionMult = (superKey === 'stalwart' || body.superActive === 'stalwart') ? (P.SUPER.stalwartFriction ?? 3)
      : (body.holding ? (P.SUPER.carryFriction ?? 1.5) : 1);
    const speed = distance < 2 ? 0 : Math.min(maxV, Math.sqrt(2 * body.friction * frictionMult * Math.max(0, distance + drive)));
    const vSpeed = Math.hypot(body.vx || 0, body.vy || 0);

    if (vSpeed <= 10 || speed === 0) {
      return {
        angle: Math.atan2(dy, dx),
        power: maxV > 0 ? speed / maxV : 0,
        spin: 0,
        superArm: false,
        guard: false
      };
    }

    const dist = distance || 1;
    const ux = dx / dist, uy = dy / dist;
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
      spin: 0,
      superArm: false,
      guard: false
    };
  }

  function strike(body, ball, x, y, superKey = null) {
    let leadX = ball.x, leadY = ball.y;
    const ballSpeed = Math.hypot(ball.vx || 0, ball.vy || 0);
    if (!ball.stickOffset && ballSpeed > 20) {
      const tLead = Math.min(0.32, Math.hypot(ball.x - body.x, ball.y - body.y) / Math.max(180, P.launchSpeed(body)));
      const friction = ball.friction ?? 85;
      const drag = P.AIR_DRAG ?? 0.00015;
      const decel = friction + drag * ballSpeed * ballSpeed;
      const avgSpeed = Math.max(0, ballSpeed - 0.5 * decel * tLead);
      const leadDist = avgSpeed * tLead;
      leadX = Math.max(105, Math.min(895, ball.x + ((ball.vx || 0) / ballSpeed) * leadDist));
      leadY = Math.max(105, Math.min(495, ball.y + ((ball.vy || 0) / ballSpeed) * leadDist));
    }
    const d = Math.hypot(x - leadX, y - leadY) || 1;
    const effRadius = superKey === 'colossus' && body.superActive !== 'colossus'
      ? Math.max(body.baseRadius ?? body.radius, P.SUPER.colossusRadius)
      : body.radius;
    const contact = Math.max(effRadius, body.reach || effRadius, 18) + ball.radius - 1;
    return aim(body, leadX - (x - leadX) / d * contact, leadY - (y - leadY) / d * contact, 260, superKey);
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

  function options(state, team, index, base) {
    const body = state.bodies[team * 3 + index], ball = state.bodies[6];
    if (body.stunned) return [HOLD];
    const goal = team ? 60 : 940, ownGoal = 1000 - goal;
    const creativity = creativityOf(body);
    const isBehind = behindBall(body, ball, team);
    const pointBlank = isPointBlank(body, ball);
    const hasSuper = !M.rule(state.mode, 'classic') && body.meter >= 100 && Boolean(body.equippedSuper);
    const sKey = body.equippedSuper?.key?.toLowerCase() || null;

    function generateMoves(superArmKey) {
      const arm = Boolean(superArmKey);
      const moves = [];
      moves.push(tag({ ...HOLD, superArm: false }, 'hold'));
      moves.push(tag({ ...GUARD, superArm: arm && superArmKey === 'stalwart' }, 'guard'));

      if (isBehind) {
        for (const y of [300, 250, 350]) {
          const shot = strike(body, ball, goal, y, superArmKey);
          for (const power of [shot.power, shot.power * .75, 1]) {
            moves.push(tag({ ...shot, power, superArm: arm }, 'shoot'));
          }
        }
        moves.push(tag({ ...aim(body, ball.x, ball.y, 150, superArmKey), superArm: arm }, 'chase'));
        if (creativity > .3) {
          for (const y of [2 * 78 - 300, 2 * 522 - 300]) {
            moves.push(tag({ ...strike(body, ball, goal, y, superArmKey), superArm: arm }, 'shoot'));
          }
          const primaryShot = strike(body, ball, goal, 300, superArmKey);
          for (const spin of [-creativity, creativity]) {
            moves.push(tag({ ...primaryShot, spin, superArm: arm }, 'shoot'));
          }
        }
        if (pointBlank) {
          const primaryShot = strike(body, ball, goal, 300, superArmKey);
          moves.push(tag({ ...primaryShot, spin: 1, superArm: arm }, 'shoot'));
          moves.push(tag({ ...primaryShot, spin: -1, superArm: arm }, 'shoot'));
        }
      } else {
        const backX = Math.max(100, Math.min(900, ball.x + (team ? 68 : -68)));
        for (const side of [-54, 54]) {
          const arcY = Math.max(95, Math.min(505, ball.y + side));
          const wrap = aim(body, backX, arcY, 140, superArmKey);
          moves.push(tag({ ...wrap, superArm: arm }, 'chase'));
          if (creativity > 0.25) {
            moves.push(tag({ ...wrap, spin: (side < 0 ? 0.5 : -0.5) * (team ? 1 : -1), superArm: arm }, 'chase'));
          }
        }
      }

      const coverX = ownGoal + (team ? -88 : 88);
      const t = (coverX - ownGoal) / ((ball.x - ownGoal) || 1);
      moves.push(tag({ ...aim(body, coverX, Math.max(240, Math.min(360, 300 + (ball.y - 300) * t)), 0, superArmKey), superArm: arm }, 'cover'));

      if (state.fouls?.crease?.[team] && M.inCrease(P, body, team)) {
        const exitX = ownGoal + (team ? -98 : 98);
        for (const exitY of [245, 355]) {
          moves.push(tag({ ...aim(body, exitX, exitY, 0, superArmKey), superArm: arm }, 'cover'));
        }
      }

      for (const y of [130, 470]) {
        const clr = strike(body, ball, 500, y, superArmKey);
        moves.push(tag({ ...clr, superArm: arm }, 'clear'));
        if (isBehind && pointBlank) {
          moves.push(tag({ ...clr, spin: 1, superArm: arm }, 'clear'));
          moves.push(tag({ ...clr, spin: -1, superArm: arm }, 'clear'));
        }
      }

      const oppStart = (1 - team) * 3;
      let carrier = null, bestEligible = null, bestEDist = Infinity;
      for (let oi = oppStart; oi < oppStart + 3; oi++) {
        const op = state.bodies[oi];
        if (op.holding && !carrier) carrier = op;
        if (!op.stunned && !op.carded) {
          const ed = Math.hypot(op.x - ball.x, op.y - ball.y);
          if (ed < bestEDist) { bestEDist = ed; bestEligible = op; }
        }
      }
      const threat = carrier || bestEligible;
      if (threat) {
        const check = aim(body, threat.x + (threat.vx || 0) * 0.15, threat.y + (threat.vy || 0) * 0.15, 180, superArmKey);
        moves.push(tag({ ...check, superArm: arm }, 'check'));
      }

      return moves;
    }

    const unarmedMoves = generateMoves(null);
    const moves = [unarmedMoves[0], unarmedMoves[1], base, ...unarmedMoves.slice(2)];
    if (hasSuper) {
      const armedMoves = generateMoves(sKey);
      moves.push(...armedMoves);
    }
    return moves;
  }

  function roles(state, team) {
    const ball = state.bodies[6], body = i => state.bodies[team * 3 + i];
    const nearest = (list, x, y) => list.reduce((a, b) => Math.hypot(body(b).x - x, body(b).y - y) < Math.hypot(body(a).x - x, body(a).y - y) ? b : a);
    const defender = nearest([0, 1, 2], team ? 940 : 60, 300), rest = [0, 1, 2].filter(i => i !== defender);
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

  function evaluateBodies(bodies, fouls, team, goal, weights, complexity = 0, scorer = null, teamTouches = false, tmw = 0.5) {
    if (goal !== null) {
      if (goal !== team) return -weights.goal;
      const effectiveCreativity = teamTouches ? Math.max(creativityOf(scorer || {}), tmw) : creativityOf(scorer || {});
      return weights.goal * (COMPLEX.simple + COMPLEX.creative * effectiveCreativity) ** complexity;
    }
    const ball = bodies[6];
    const ownStart = team * 3, otherStart = (1 - team) * 3;
    const direction = team ? -1 : 1, ownGoal = team ? 940 : 60;
    const coverTargetX = ownGoal + direction * 88;

    let accessOwn = Infinity, accessOther = Infinity, cover = Infinity;
    let meterDiff = 0, cardDiff = 0, stunDiff = 0, dazeDiff = 0;

    for (let k = 0; k < 3; k++) {
      const b = bodies[ownStart + k];
      const ao = Math.hypot(b.x - ball.x, b.y - ball.y) + (b.stunned ? 250 : 0);
      if (ao < accessOwn) accessOwn = ao;
      const cv = Math.hypot(b.x - coverTargetX, b.y - 300);
      if (cv < cover) cover = cv;
      meterDiff += (b.meter || 0);
      if (b.carded) cardDiff++;
      else if (b.stunned || b.stunnedNext) stunDiff--;
      dazeDiff -= P.dazeSlow(b);

      const o = bodies[otherStart + k];
      const ae = Math.hypot(o.x - ball.x, o.y - ball.y) + (o.stunned ? 250 : 0);
      if (ae < accessOther) accessOther = ae;
      meterDiff -= (o.meter || 0);
      if (o.carded) cardDiff--;
      else if (o.stunned || o.stunnedNext) stunDiff++;
      dazeDiff += P.dazeSlow(o);
    }

    const warned = (fouls?.crease?.[team] ? 1 : 0) - (fouls?.crease?.[1 - team] ? 1 : 0);
    const dazes = dazeDiff / P.DAZE.max;
    let stall = 0;
    if (fouls && fouls.corner !== null) {
      let mine = 0, theirs = 0;
      for (let k = 0; k < 3; k++) {
        const b = bodies[ownStart + k];
        if (M.cornerOf(P, b.x, b.y, b.radius) === fouls.corner) mine++;
        const o = bodies[otherStart + k];
        if (M.cornerOf(P, o.x, o.y, o.radius) === fouls.corner) theirs++;
      }
      if (mine !== theirs) stall = Math.sign(mine - theirs) * Math.min(1, fouls.cornerTurns / M.FOULS.stallTurns);
    }
    return direction * (ball.x - 500) * weights.progress + (accessOther - accessOwn) * weights.access - cover * weights.cover + meterDiff * weights.meter -
      cardDiff * weights.card - (warned + stall) * weights.warning + stunDiff * (weights.stun ?? 180) + dazes * (weights.daze ?? 120);
  }

  function evaluate(state, team, goal, weights, complexity = 0, scorer = null, teamTouches = false, tmw = 0.5) {
    return evaluateBodies(state.bodies, state.fouls, team, goal, weights, complexity, scorer, teamTouches, tmw);
  }

  // =========================================================================
  // Unboxed SoA TypedArray Fast-Tick Kernel (0 Heap Objects, 0 V8 Map Deopts)
  // =========================================================================
  const FACEOFF_YS = [300, 240, 360, 180, 420, 120, 480];

  function createSoAKernel() {
    // Mutable per-rollout state (copied via TypedArray.set in ~10ns per rollout)
    const DYN_F64_LEN = 20 * 8; // 160 floats
    const DYN_I32_LEN = 18 * 8; // 144 ints
    const baseDynF64 = new Float64Array(DYN_F64_LEN);
    const simDynF64 = new Float64Array(DYN_F64_LEN);
    const baseDynI32 = new Int32Array(DYN_I32_LEN);
    const simDynI32 = new Int32Array(DYN_I32_LEN);

    const fView = (buf, slot) => buf.subarray(slot * 8, (slot + 1) * 8);
    const iView = (buf, slot) => buf.subarray(slot * 8, (slot + 1) * 8);

    // Views into simDynF64
    const x = fView(simDynF64, 0);
    const y = fView(simDynF64, 1);
    const vx = fView(simDynF64, 2);
    const vy = fView(simDynF64, 3);
    const omega = fView(simDynF64, 4);
    const radius = fView(simDynF64, 5);
    const mass = fView(simDynF64, 6);
    const friction = fView(simDynF64, 7);
    const reach = fView(simDynF64, 8);
    const strength = fView(simDynF64, 9);
    const stability = fView(simDynF64, 10);
    const bounciness = fView(simDynF64, 11);
    const meter = fView(simDynF64, 12);
    const meterTick = fView(simDynF64, 13);
    const dazeVal = fView(simDynF64, 14);
    const spinStrike = fView(simDynF64, 15);
    const launchSpin = fView(simDynF64, 16);
    const stickX = fView(simDynF64, 17);
    const stickY = fView(simDynF64, 18);
    // Slot 19 holds ball float scalars: [pace, strikerPower, strikerSynergy, ballCurveMult]
    const ballScalars = fView(simDynF64, 19);

    // Views into baseDynF64
    const bx0 = fView(baseDynF64, 0), by0 = fView(baseDynF64, 1), bvx0 = fView(baseDynF64, 2), bvy0 = fView(baseDynF64, 3);
    const bomega0 = fView(baseDynF64, 4), bradius0 = fView(baseDynF64, 5), bmass0 = fView(baseDynF64, 6), bfriction0 = fView(baseDynF64, 7);
    const breach0 = fView(baseDynF64, 8), bstrength0 = fView(baseDynF64, 9), bstability0 = fView(baseDynF64, 10), bbounciness0 = fView(baseDynF64, 11);
    const bmeter0 = fView(baseDynF64, 12), bmeterTick0 = fView(baseDynF64, 13), bdaze0 = fView(baseDynF64, 14);
    const bspinStrike0 = fView(baseDynF64, 15), blaunchSpin0 = fView(baseDynF64, 16), bstickX0 = fView(baseDynF64, 17), bstickY0 = fView(baseDynF64, 18);
    const bballScalars0 = fView(baseDynF64, 19);

    // Views into simDynI32
    const superActive = iView(simDynI32, 0);
    const superTicks = iView(simDynI32, 1);
    const superHoldTicks = iView(simDynI32, 2);
    const ironCooldown = iView(simDynI32, 3);
    const guarding = iView(simDynI32, 4);
    const ironGuard = iView(simDynI32, 5);
    const usedSuper = iView(simDynI32, 6);
    const superHit = iView(simDynI32, 7);
    const superRefunded = iView(simDynI32, 8);
    const shockFired = iView(simDynI32, 9);
    const carded = iView(simDynI32, 10);
    const stunned = iView(simDynI32, 11);
    const stunnedNext = iView(simDynI32, 12);
    const holding = iView(simDynI32, 13);
    const hasStick = iView(simDynI32, 14);
    // Slot 15 holds ball int scalars: [fireTicks, onFire, strikerTeam, strikerSlot, openingShot, stuckTicks]
    const ballInts = iView(simDynI32, 15);
    // Slot 16 holds fouls + scores: [crease0, crease1, corner (-1=null), cornerTurns, faceoff, score0, score1]
    const matchInts = iView(simDynI32, 16);

    const bsuperActive0 = iView(baseDynI32, 0), bsuperTicks0 = iView(baseDynI32, 1), bsuperHoldTicks0 = iView(baseDynI32, 2);
    const bironCooldown0 = iView(baseDynI32, 3), bguarding0 = iView(baseDynI32, 4), bironGuard0 = iView(baseDynI32, 5);
    const busedSuper0 = iView(baseDynI32, 6), bsuperHit0 = iView(baseDynI32, 7), bsuperRefunded0 = iView(baseDynI32, 8);
    const bshockFired0 = iView(baseDynI32, 9), bcarded0 = iView(baseDynI32, 10), bstunned0 = iView(baseDynI32, 11);
    const bstunnedNext0 = iView(baseDynI32, 12), bholding0 = iView(baseDynI32, 13), bhasStick0 = iView(baseDynI32, 14);
    const bballInts0 = iView(baseDynI32, 15), bmatchInts0 = iView(baseDynI32, 16);

    // Static per-plan invariants (computed ONCE per C.plan call)
    const teamOf = new Int32Array([0, 0, 0, 1, 1, 1, -1, -1]);
    const slotOf = new Int32Array([0, 1, 2, 0, 1, 2, -1, -1]);
    const eqSuperId = new Int32Array(8);
    const eqBonusTicks = new Int32Array(8);
    const eqBonusRefund = new Float64Array(8);
    const sizeMult = new Float64Array(8);
    const baseRadius = new Float64Array(8);
    const baseMass = new Float64Array(8);
    const baseFriction = new Float64Array(8);
    const baseReach = new Float64Array(8);
    const baseStrength = new Float64Array(8);
    const baseStability = new Float64Array(8);
    const baseBounciness = new Float64Array(8);
    const grip = new Float64Array(8);
    const maxSpin = new Float64Array(8);
    const impulse = new Float64Array(8);
    const curveMult = new Float64Array(8);
    const curveFactor = new Float64Array(8);
    const involCurve = new Float64Array(8);
    const power = new Float64Array(8);
    const synergyMult = new Float64Array(8);
    const chemistryMult = new Float64Array(8);
    const sizeLaunchMult = new Float64Array(8);
    const reSteerMult = new Float64Array(8);
    const sizeStrikeMult = new Float64Array(8);
    const sizeBoardsMult = new Float64Array(8);
    const carveSc = new Float64Array(8);
    const creativity = new Float64Array(8);
    const effGain = new Float64Array(8);
    const synStat = new Float64Array(8);
    const chemStat = new Float64Array(8);
    const spawnX = new Float64Array(6);
    const spawnY = new Float64Array(6);

    // Scratch arrays inside step
    const planAngle = new Float64Array(6);
    const planPower = new Float64Array(6);
    const planSpin = new Float64Array(6);
    const planSuper = new Int32Array(6);
    const planGuard = new Int32Array(6);
    const hit = new Float64Array(8);
    const drafts = new Float64Array(8);
    const v2Scratch = new Float64Array(8);
    const spScratch = new Float64Array(8);
    const shockIdx = new Int32Array(6);
    const shockD = new Float64Array(6);
    const shockDx = new Float64Array(6);
    const shockDy = new Float64Array(6);
    const pinchList = new Int32Array(6);
    const saveBall = new Float64Array(16);

    // Physics constants cached in closure locals
    const DT = P.DT;
    const BASE_LAUNCH = P.BASE_LAUNCH_SPEED;
    const R_LEFT = P.rink.left, R_RIGHT = P.rink.right, R_TOP = P.rink.top, R_BOTTOM = P.rink.bottom;
    const R_CORNER = P.rink.corner, R_GTOP = P.rink.goalTop, R_GBOTTOM = P.rink.goalBottom, R_GDEPTH = P.rink.goalDepth;
    const GOAL_MID_Y = (R_GTOP + R_GBOTTOM) * 0.5;
    const AIR_DRAG = P.AIR_DRAG;
    const SPIN_DECAY_C = P.SPIN_DECAY, SETTLED_SPIN_DECAY_C = P.SETTLED_SPIN_DECAY;
    const BALL_CURVE_C = P.BALL_CURVE ?? 0.06, BURNING_CURVE_C = P.BURNING_BALL_CURVE ?? 0.08;
    const GUARD_BRAKE = 0.25;
    const IRON_KEEP = 0.1;
    const HOT_DRIVE = 100;
    const FIRE_TICKS = P.FIRE_TICKS;
    const IRON_CD = P.IRON_COOLDOWN_TICKS;
    const DAZE_SPEED = P.DAZE.speed, DAZE_SCALE = P.DAZE.scale, DAZE_HIT = P.DAZE.hit, DAZE_FREE = P.DAZE.free, DAZE_MAX = P.DAZE.max;
    const SUP_TICKS = P.SUPER.ticks, SUP_HOLD = P.SUPER.holdTicks, CARRY_FRIC = P.SUPER.carryFriction;
    const MAG_RAD = P.SUPER.magnetRadius, MAG_RAD2 = MAG_RAD * MAG_RAD, MAG_PULL = P.SUPER.magnetPull;
    const SHK_RAD = P.SUPER.shockRadius, SHK_RAD2 = SHK_RAD * SHK_RAD, SHK_FORCE = P.SUPER.shockForce, SHK_TEAM = P.SUPER.shockTeammate, SHK_REPEL = P.SUPER.shockRepel;
    const COL_RAD = P.SUPER.colossusRadius, COL_MASS = P.SUPER.colossusMass, COL_GROW = P.SUPER.colossusGrowTicks, COL_LAUNCH = P.SUPER.colossusLaunch;
    const STAL_LAUNCH = P.SUPER.stalwartLaunch, STAL_FRIC = P.SUPER.stalwartFriction, WHIFF_REFUND = P.SUPER.whiffRefund;
    const CANNON_MULT = P.SUPER.cannonball;
    const TG_LEAD = P.TAILGATE.minLeadSpeed, TG_SPEED = P.TAILGATE.minSpeed, TG_GAP = P.TAILGATE.maxGap, TG_ALIGN = P.TAILGATE.minAlign, TG_CUT = P.TAILGATE.frictionCut;
    const TG_LEAD2 = TG_LEAD * TG_LEAD - 1e-6, TG_FOLLOW2 = TG_SPEED * TG_SPEED - 1e-6, TG_SPAN = 1 - TG_ALIGN;
    const PD_EXP = P.PACK_DRAFT.exp, PD_MAX_CUT = P.PACK_DRAFT.maxCut, PD_MAX_FACTOR = PD_MAX_CUT / TG_CUT;
    const HC_SPEED = P.HIP_CLIP.minRelSpeed, HC_RATIO = P.HIP_CLIP.glanceRatio, HC_BOOST = P.HIP_CLIP.gripBoost;
    const SNAP_PASS = P.SNAP.minPassSpeed, SNAP_DRIVE = P.SNAP.minDrive, SNAP_REDIR = P.SNAP.redirect, SNAP_HEAT = P.SNAP.heatTicks;
    const RIM_NORM = P.RIM.maxNormal, RIM_TAN = P.RIM.minTangent, RIM_BOUNCE = P.RIM.bounceScale, RIM_SPIN = P.RIM.spinKeep, RIM_GRIP = P.RIM.checkGrip;
    const BS_WALL = P.BOARD_SPRING.wallUbuRestitution, BS_REDIR = P.BOARD_SPRING.rimRedirect;
    const SS_POKE_MIN = P.SWEET_SPOT.pokeTipMin;
    const TS_FIRE_EXP = P.TEMPERED_SHOT.firePowerExp;
    const TT_SNAP_EXP = P.TAPE_TO_TAPE.snapExp, TT_PASS_MIN = P.TAPE_TO_TAPE.minPassSpeed;
    const CD_BOOST = P.CARVE_DRIVE.boost, CD_THRESH = P.CARVE_DRIVE.threshold;
    const HEAT_FIRE = P.HEAT.fire, HEAT_SUSTAIN = P.HEAT.sustain;
    const METER_BALL = M.METER.ball, METER_CHECK = M.METER.check, METER_CONCEDED = M.METER.conceded;
    const METER_PASS = M.METER.pass, METER_TEAM = M.METER.teammate, METER_RATE = M.METER.rate;
    const METER_MIN_SPD = M.METER.minSpeed, METER_CD = M.METER.cooldownTicks;
    const CREASE_R = M.FOULS.crease, CREASE_R2 = CREASE_R * CREASE_R, STALL_TURNS = M.FOULS.stallTurns, CORNER_EXIT = M.FOULS.cornerExit;

    let classicMode = 0;
    let searchTeam = 0;
    let tickClock = 0;
    let toucherIdx = -1;
    let touchesCount = 0;
    let boardsCount = 0;
    let firstTeamTouchIdx = -1;
    let multiTeamTouchFlag = false;
    let resolvedCount = 0;

    function dazeSlowAt(i) {
      const d = dazeVal[i];
      return d <= DAZE_FREE ? 0 : (d - DAZE_FREE) / (DAZE_MAX - DAZE_FREE) * DAZE_MAX;
    }

    function colossusProgAt(i) {
      if (superActive[i] !== SUP_COLOSSUS) return 0;
      const st = superTicks[i];
      if (!st) return 1;
      const total = SUP_TICKS + eqBonusTicks[i];
      const elapsed = total > st ? total - st : 0;
      return elapsed >= COL_GROW ? 1 : elapsed / COL_GROW;
    }

    function syncStatsAt(i) {
      const bR = baseRadius[i], bM = baseMass[i];
      if (superActive[i] === SUP_COLOSSUS) {
        const p = colossusProgAt(i);
        radius[i] = p > 0 ? bR + ((bR > COL_RAD ? bR : COL_RAD) - bR) * p : bR;
        mass[i] = p > 0 ? bM + ((bM > COL_MASS ? bM : COL_MASS) - bM) * p : bM;
      } else {
        radius[i] = bR;
        mass[i] = bM;
      }
      if (guarding[i]) {
        const ig = ironGuard[i];
        const mult = ig ? 1.5 : 1.25;
        const cap = bR * mult > 37.5 ? bR * mult : 37.5;
        const scaledR = baseReach[i] * mult;
        const clampR = scaledR < cap ? scaledR : cap;
        reach[i] = radius[i] > clampR ? radius[i] : clampR;
        const fCap = ig ? 270 : 225, fVal = baseFriction[i] * mult;
        friction[i] = fVal < fCap ? fVal : fCap;
        const sCap = ig ? 2.0 : 1.5;
        const strVal = baseStrength[i] * mult;
        strength[i] = strVal < sCap ? strVal : sCap;
        const stabVal = baseStability[i] * mult;
        stability[i] = stabVal < sCap ? stabVal : sCap;
        if (ig) {
          const bv = baseBounciness[i] * 0.5;
          bounciness[i] = bv > 0.4 ? bv : 0.4;
        } else {
          const bv = baseBounciness[i] * 0.75, floor = 2 / 3;
          bounciness[i] = bv > floor ? bv : floor;
        }
      } else {
        reach[i] = baseReach[i];
        friction[i] = baseFriction[i];
        strength[i] = baseStrength[i];
        stability[i] = baseStability[i];
        bounciness[i] = baseBounciness[i];
      }
      const rNow = radius[i], rcNow = reach[i], mNow = rNow >= rcNow ? rNow : rcNow;
      hit[i] = mNow >= 18 ? mNow : 18;
    }

    function hitRadiusAt(i) {
      if (i === 6) return radius[6] >= 18 ? radius[6] : 18;
      const r = radius[i], rc = reach[i] || r;
      const m = r >= rc ? r : rc;
      return m >= 18 ? m : 18;
    }

    function bodyKEAt(i) {
      const m = mass[i], r = radius[i], vxi = vx[i], vyi = vy[i], w = omega[i];
      return 0.5 * m * (vxi * vxi + vyi * vyi) + 0.25 * m * r * r * w * w;
    }

    function holderIdx() {
      for (let i = 0; i < 6; i++) if (holding[i]) return i;
      return -1;
    }

    function endSuperAt(i) {
      if (holding[i]) {
        holding[i] = 0;
        hasStick[6] = 0;
      }
      if ((superActive[i] !== SUP_NONE || usedSuper[i]) && !superRefunded[i]) {
        superRefunded[i] = 1;
        const refund = eqBonusRefund[i] + (!superHit[i] ? WHIFF_REFUND : 0);
        if (refund > 0) {
          const nm = meter[i] + refund;
          meter[i] = nm < 100 ? nm : 100;
        }
      }
      superActive[i] = SUP_NONE;
      superTicks[i] = 0;
      superHoldTicks[i] = 0;
      shockFired[i] = 0;
      superHit[i] = 0;
      syncStatsAt(i);
    }

    function countSlowingBall(before) {
      const after = Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]);
      if (after < before) ballScalars[0] = ballScalars[0] * after / before;
    }

    function awardMeterAt(idx, amount) {
      if (classicMode || idx < 0 || idx >= 6 || usedSuper[idx]) return;
      const gain = amount * effGain[idx];
      let m = meter[idx] + gain;
      meter[idx] = m > 100 ? 100 : (m < 0 ? 0 : m);
      const syn = synStat[idx];
      const tBase = teamOf[idx] * 3;
      for (let k = tBase; k < tBase + 3; k++) {
        if (k === idx || usedSuper[k]) continue;
        let om = meter[k] + gain * syn * chemStat[k] * METER_TEAM;
        meter[k] = om > 100 ? 100 : (om < 0 ? 0 : om);
      }
    }

    function onContactEvent(ai, bi, speed, plow, passerSlot) {
      if (!plow) {
        const isBall = ai === 6 || bi === 6;
        if (speed >= METER_MIN_SPD && (isBall || teamOf[ai] !== teamOf[bi])) {
          if (isBall) {
            const sk = ai === 6 ? bi : ai;
            if (tickClock - meterTick[sk] >= METER_CD) {
              meterTick[sk] = tickClock;
              if (!classicMode) {
                awardMeterAt(sk, METER_BALL);
                if (passerSlot >= 0) {
                  const tBase = teamOf[sk] * 3;
                  const passerIdx = tBase + passerSlot;
                  if (passerSlot <= 2 && passerIdx !== sk && slotOf[passerIdx] === passerSlot) {
                    const passGain = METER_PASS * METER_RATE * synStat[passerIdx] * chemStat[sk];
                    if (!usedSuper[sk]) {
                      const m1 = meter[sk] + passGain;
                      meter[sk] = m1 > 100 ? 100 : m1;
                    }
                    if (!usedSuper[passerIdx] && !carded[passerIdx]) {
                      const m2 = meter[passerIdx] + passGain * 0.5;
                      meter[passerIdx] = m2 > 100 ? 100 : m2;
                    }
                  }
                }
              }
            }
          } else {
            if (tickClock - meterTick[ai] >= METER_CD) {
              meterTick[ai] = tickClock;
              awardMeterAt(ai, METER_CHECK);
            }
            if (tickClock - meterTick[bi] >= METER_CD) {
              meterTick[bi] = tickClock;
              awardMeterAt(bi, METER_CHECK);
            }
          }
        }
      }
      if (speed >= 15 && (ai === 6) !== (bi === 6)) {
        const pIdx = ai === 6 ? bi : ai;
        if (pIdx !== toucherIdx) {
          toucherIdx = pIdx;
          touchesCount++;
          if (teamOf[pIdx] === searchTeam) {
            if (firstTeamTouchIdx < 0) firstTeamTouchIdx = pIdx;
            else if (firstTeamTouchIdx !== pIdx) multiTeamTouchFlag = true;
          }
        }
      }
    }

    function triggerIronBlast(srcIdx) {
      const rad = SHK_RAD * 0.5, rad2 = rad * rad;
      const sx = x[srcIdx], sy = y[srcIdx], sTeam = teamOf[srcIdx];
      for (let i = 0; i < 6; i++) {
        if (i === srcIdx || superActive[i] === SUP_STALWART || carded[i]) continue;
        const dx = x[i] - sx, dy = y[i] - sy, d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < rad2) {
          const d = Math.sqrt(d2);
          const imp = (1 - d / rad) * 400 * (teamOf[i] === sTeam ? SHK_TEAM : 1);
          const invM = 1 / (mass[i] || 1);
          vx[i] += (dx / d) * imp * invM;
          vy[i] += (dy / d) * imp * invM;
        }
      }
    }

    // wallType: 0 = wall, 1 = post, 2 = net
    function reflectBody(i, nx, ny, pen, wallType, isCorner, hostIdx) {
      resolvedCount++;
      x[i] -= nx * pen;
      y[i] -= ny * pen;
      const vel = vx[i] * nx + vy[i] * ny;
      if (vel > 0) {
        const surfRest = wallType === 0 ? 0.82 : (wallType === 1 ? 0.96 : 0.60);
        const ubuCap = wallType === 1 ? 1.0 : 0.95;
        const surfGrip = wallType === 1 ? 1.45 : 1.0;
        const surfSpin = wallType === 1 ? 1.0 : 0.5;
        const meteorBank = wallType !== 2;

        const carrier = i === 6 ? hostIdx : -1;
        const isMeteor = i === 6 && carrier < 0 && ballInts[1] !== 0 && meteorBank;
        const preSpeed = isMeteor ? Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]) : 0;
        const tx = -ny, ty = nx;
        const vt = vx[i] * tx + vy[i] * ty;
        const cornerSkater = isCorner && i < 6;
        const rimmed = cornerSkater && vel <= RIM_NORM && Math.abs(vt) >= RIM_TAN && omega[i] * vt < 0;
        const counterRim = cornerSkater && omega[i] * vt > 0;
        if (!rimmed) {
          spinStrike[i] = 0;
          if (i < 6) launchSpin[i] = 0;
        }
        const preRimKE = rimmed && carrier < 0 ? bodyKEAt(i) : 0;
        const rbIdx = carrier >= 0 ? carrier : i;
        const baseWallRest = wallType === 0 ? BS_WALL : surfRest;
        let restitution;
        if (rbIdx === 6) {
          restitution = surfRest;
        } else if (rimmed) {
          const capV = baseWallRest * sizeBoardsMult[rbIdx];
          restitution = (capV < ubuCap ? capV : ubuCap) * RIM_BOUNCE;
        } else {
          const capV = baseWallRest * bounciness[rbIdx] * sizeBoardsMult[rbIdx];
          restitution = capV < ubuCap ? capV : ubuCap;
        }
        const effMass = carrier >= 0 ? mass[carrier] + mass[6] : mass[i];
        const rebound = 1 + restitution;
        vx[i] -= rebound * vel * nx;
        vy[i] -= rebound * vel * ny;
        const slip = vx[i] * tx + vy[i] * ty + omega[i] * radius[i];
        const gripScale = surfGrip * (counterRim ? RIM_GRIP : 1);
        const limit = (grip[i] * gripScale) * rebound * vel * effMass;
        let imp = -slip * effMass / 3;
        if (imp < -limit) imp = -limit;
        else if (imp > limit) imp = limit;
        vx[i] += imp * tx / effMass;
        vy[i] += imp * ty / effMass;
        omega[i] += 2 * imp / (effMass * radius[i]);
        omega[i] *= rimmed ? RIM_SPIN : surfSpin;

        if (rimmed && carrier < 0) {
          const postRimKE = bodyKEAt(i);
          const lostKE = preRimKE - postRimKE;
          if (lostKE > 0) {
            const rs = BS_REDIR * bounciness[rbIdx];
            const redirectShare = rs < 0.88 ? rs : 0.88;
            const curVt = vx[i] * tx + vy[i] * ty;
            const curVn = vx[i] * nx + vy[i] * ny;
            const rotKE = 0.25 * mass[i] * radius[i] * radius[i] * omega[i] * omega[i];
            const maxT = preRimKE * (1 - 1e-12), candT = postRimKE + redirectShare * lostKE;
            const targetKE = candT < maxT ? candT : maxT;
            const remKE = targetKE - rotKE;
            const availFromKE = (2 * (remKE > 0 ? remKE : 0)) / mass[i] - curVn * curVn;
            const availVt2 = curVt * curVt > availFromKE ? curVt * curVt : availFromKE;
            const tSign = (curVt || vt) >= 0 ? 1 : -1;
            const newVt = tSign * Math.sqrt(availVt2);
            vx[i] = curVn * nx + newVt * tx;
            vy[i] = curVn * ny + newVt * ty;
          }
        }
        if (isMeteor && preSpeed > 0) {
          const postSpeed = Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]);
          if (postSpeed > 0) {
            const sc = preSpeed / postSpeed;
            vx[6] *= sc; vy[6] *= sc;
          }
        }
        if (i === 6 && touchesCount > 0 && wallType !== 2) boardsCount++;
      }
    }

    function wallsBody(i, hostIdx) {
      const r = radius[i], bx = x[i], by = y[i];
      if (R_LEFT === 60 && bx >= 150 && bx <= 850 && by >= 60 + r && by <= 540 - r) return;
      if (bx >= R_LEFT + r && bx <= R_RIGHT - r && by >= R_TOP + r && by <= R_BOTTOM - r &&
          ((bx >= R_LEFT + R_CORNER && bx <= R_RIGHT - R_CORNER) || (by >= R_TOP + R_CORNER && by <= R_BOTTOM - R_CORNER))) return;

      const inGoalY = by > R_GTOP && by < R_GBOTTOM;
      const before = i === 6 ? Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]) : 0;
      const inLeftPocket = inGoalY || (bx < R_LEFT && by > R_GTOP - r && by < R_GBOTTOM + r);
      const inRightPocket = inGoalY || (bx > R_RIGHT && by > R_GTOP - r && by < R_GBOTTOM + r);

      if (inLeftPocket) {
        const backX = R_LEFT - R_GDEPTH + r;
        if (x[i] < backX) {
          reflectBody(i, -1, 0, backX - x[i], 2, false, hostIdx);
          if (i === 6) { vx[6] *= 0.1; vy[6] *= 0.1; }
        }
        if (x[i] < R_LEFT) {
          if (y[i] < R_GTOP + r) reflectBody(i, 0, -1, R_GTOP + r - y[i], 2, false, hostIdx);
          if (y[i] > R_GBOTTOM - r) reflectBody(i, 0, 1, y[i] - (R_GBOTTOM - r), 2, false, hostIdx);
        } else if (x[i] < R_LEFT + r) {
          for (let pi = 0; pi < 2; pi++) {
            const py = pi === 0 ? R_GTOP : R_GBOTTOM;
            const dx = R_LEFT - x[i], dy = py - y[i], d2 = dx * dx + dy * dy;
            if (d2 < r * r && d2 > 0) { const d = Math.sqrt(d2); reflectBody(i, dx / d, dy / d, r - d, 1, false, hostIdx); }
          }
        }
      } else {
        if (x[i] < R_LEFT + r) reflectBody(i, -1, 0, R_LEFT + r - x[i], 0, false, hostIdx);
      }

      if (inRightPocket) {
        const backX = R_RIGHT + R_GDEPTH - r;
        if (x[i] > backX) {
          reflectBody(i, 1, 0, x[i] - backX, 2, false, hostIdx);
          if (i === 6) { vx[6] *= 0.1; vy[6] *= 0.1; }
        }
        if (x[i] > R_RIGHT) {
          if (y[i] < R_GTOP + r) reflectBody(i, 0, -1, R_GTOP + r - y[i], 2, false, hostIdx);
          if (y[i] > R_GBOTTOM - r) reflectBody(i, 0, 1, y[i] - (R_GBOTTOM - r), 2, false, hostIdx);
        } else if (x[i] > R_RIGHT - r) {
          for (let pi = 0; pi < 2; pi++) {
            const py = pi === 0 ? R_GTOP : R_GBOTTOM;
            const dx = R_RIGHT - x[i], dy = py - y[i], d2 = dx * dx + dy * dy;
            if (d2 < r * r && d2 > 0) { const d = Math.sqrt(d2); reflectBody(i, dx / d, dy / d, r - d, 1, false, hostIdx); }
          }
        }
      } else {
        if (x[i] > R_RIGHT - r) reflectBody(i, 1, 0, x[i] - R_RIGHT + r, 0, false, hostIdx);
      }

      const insidePocket = (x[i] < R_LEFT && inLeftPocket) || (x[i] > R_RIGHT && inRightPocket);
      if (!insidePocket) {
        if (y[i] < R_TOP + r) reflectBody(i, 0, -1, R_TOP + r - y[i], 0, false, hostIdx);
        if (y[i] > R_BOTTOM - r) reflectBody(i, 0, 1, y[i] - R_BOTTOM + r, 0, false, hostIdx);
        const cx = x[i] < R_LEFT + R_CORNER ? R_LEFT + R_CORNER : (x[i] > R_RIGHT - R_CORNER ? R_RIGHT - R_CORNER : -1);
        const cy = y[i] < R_TOP + R_CORNER ? R_TOP + R_CORNER : (y[i] > R_BOTTOM - R_CORNER ? R_BOTTOM - R_CORNER : -1);
        if (cx >= 0 && cy >= 0) {
          const dx = x[i] - cx, dy = y[i] - cy, d2 = dx * dx + dy * dy, lim = R_CORNER - r;
          if (lim < 0 || d2 > lim * lim) {
            const d = Math.sqrt(d2);
            const nx = d > 0 ? dx / d : (cx < 500 ? -Math.SQRT1_2 : Math.SQRT1_2);
            const ny = d > 0 ? dy / d : (cy < 300 ? -Math.SQRT1_2 : Math.SQRT1_2);
            reflectBody(i, nx, ny, d - lim, 0, true, hostIdx);
          }
        }
      }
      if (before) countSlowingBall(before);
    }

    function collidePair(ai, bi, deferIron, emitEvents) {
      const isBall = bi === 6; // In our 7-body layout, ai < bi so bi === 6 iff ball contact!
      if (!isBall) {
        if (carded[ai] || carded[bi]) return 0;
        if (teamOf[ai] !== teamOf[bi] && (superActive[ai] === SUP_GHOST || superActive[bi] === SUP_GHOST)) return 0;
      } else {
        if (carded[ai] || holding[ai]) return 0;
      }

      const ra = isBall ? hitRadiusAt(ai) : radius[ai];
      const rb = radius[bi];
      const dx = x[bi] - x[ai], dy = y[bi] - y[ai], rad = ra + rb;
      const d2 = dx * dx + dy * dy;
      if (d2 > rad * rad) return 0;
      resolvedCount++;
      const d = Math.sqrt(d2);
      const nx = d ? dx / d : 1, ny = d ? dy / d : 0;
      const closing = (vx[bi] - vx[ai]) * nx + (vy[bi] - vy[ai]) * ny;

      if (isBall) {
        const carrier = holderIdx();
        if (carrier >= 0 && carrier !== ai) {
          if (superActive[ai] === SUP_STICKY || (teamOf[ai] !== teamOf[carrier] && closing < 0 && ballInts[5] > 0)) {
            endSuperAt(carrier);
          } else {
            const overlap = rad - d;
            const cMass = mass[carrier] + mass[6];
            const invP = superActive[ai] === SUP_STALWART ? 0 : 1 / mass[ai];
            const invC = superActive[carrier] === SUP_STALWART ? 0 : 1 / cMass;
            const invSum = invP + invC;
            if (invSum > 0) {
              const corr = overlap / invSum;
              if (invP > 0) { x[ai] -= nx * corr * invP; y[ai] -= ny * corr * invP; }
              if (invC > 0) { x[carrier] += nx * corr * invC; y[carrier] += ny * corr * invC; }
              if (closing < 0) {
                const j = -1.88 * closing / invSum;
                if (invP > 0) { vx[ai] -= j * nx * invP; vy[ai] -= j * ny * invP; }
                if (invC > 0) { vx[carrier] += j * nx * invC; vy[carrier] += j * ny * invC; }
                if (emitEvents) onContactEvent(ai, carrier, -closing, false, -1);
              }
            }
            const ox = hasStick[6] ? stickX[6] : radius[carrier] + radius[6];
            const oy = hasStick[6] ? stickY[6] : 0;
            x[6] = x[carrier] + ox; y[6] = y[carrier] + oy;
            vx[6] = vx[carrier]; vy[6] = vy[carrier]; omega[6] = omega[carrier];
            return 0;
          }
        }
      }

      const own = isBall && teamOf[ai] === ballInts[2];
      const hot = isBall && ballInts[1] !== 0;
      const drive = isBall ? (vx[ai] * dx + vy[ai] * dy) / (d || 1) : 0;
      let closeSpin = 0, strikeBoost = 0, crowdedBall = false;

      if (isBall) {
        const psa = superActive[ai];
        if (psa === SUP_CANNONBALL || psa === SUP_STICKY || psa === SUP_MAGNET || psa === SUP_GHOST || psa === SUP_STALWART || psa === SUP_COLOSSUS) {
          superHit[ai] = 1;
        }
        if (ballInts[4] && spinStrike[ai]) {
          const small = sizeStrikeMult[ai];
          closeSpin = -spinStrike[ai] * omega[ai] * small * curveMult[ai];
          const spFrac = Math.abs(omega[ai]) / maxSpin[ai];
          strikeBoost = small * 0.5 * (spinStrike[ai] - 1) * (spFrac < 1 ? spFrac : 1) * Math.sqrt(vx[ai] * vx[ai] + vy[ai] * vy[ai]);
        }
        for (let k = 0; k < 6; k++) {
          if (k !== ai && !carded[k]) {
            const cdx = x[k] - x[6], cdy = y[k] - y[6], cr = hitRadiusAt(k) + radius[6];
            if (cdx * cdx + cdy * cdy <= cr * cr) { crowdedBall = true; break; }
          }
        }
        if (closeSpin && crowdedBall) closeSpin = strikeBoost = 0;
        ballInts[4] = 0; // openingShot = false
      } else {
        spinStrike[ai] = spinStrike[bi] = 0;
        launchSpin[ai] = launchSpin[bi] = 0;
        if (teamOf[ai] !== teamOf[bi] && closing < 0) {
          const saA = superActive[ai], saB = superActive[bi];
          if (saA === SUP_KNOCKOUT || saA === SUP_STALWART || saA === SUP_COLOSSUS) superHit[ai] = 1;
          if (saB === SUP_KNOCKOUT || saB === SUP_STALWART || saB === SUP_COLOSSUS) superHit[bi] = 1;
          if (saA === SUP_KNOCKOUT) { stunnedNext[bi] = 1; superActive[ai] = SUP_NONE; }
          if (saB === SUP_KNOCKOUT) { stunnedNext[ai] = 1; superActive[bi] = SUP_NONE; }
          if (saA === SUP_STICKY && holding[ai]) endSuperAt(ai);
          if (saB === SUP_STICKY && holding[bi]) endSuperAt(bi);
        }
      }

      if (isBall && superActive[ai] === SUP_STICKY) {
        for (let k = 0; k < 6; k++) if (holding[k] && k !== ai) endSuperAt(k);
        holding[ai] = 1;
        ballInts[5] = 0; // stuckTicks = 0
        if (!own) {
          ballInts[0] = 0; ballInts[1] = 0; ballScalars[0] = 0;
        }
        ballScalars[1] = power[ai]; ballScalars[2] = synergyMult[ai]; ballScalars[3] = curveMult[ai];
        ballInts[2] = teamOf[ai]; ballInts[3] = slotOf[ai];
        const od = d || 1, td = radius[ai] + radius[6];
        stickX[6] = (dx / od) * td;
        stickY[6] = (dy / od) * td;
        hasStick[6] = 1;
        x[6] = x[ai] + stickX[6];
        y[6] = y[ai] + stickY[6];
        if (superActive[ai] !== SUP_STALWART) {
          const tm = mass[ai] + mass[6];
          vx[ai] = (vx[ai] * mass[ai] + vx[6] * mass[6]) / tm;
          vy[ai] = (vy[ai] * mass[ai] + vy[6] * mass[6]) / tm;
        }
        vx[6] = vx[ai]; vy[6] = vy[ai]; omega[6] = omega[ai];
        if (emitEvents) onContactEvent(ai, 6, closing < 0 ? -closing : 0, false, -1);
        return 0;
      }

      let fireWin = -1, ironSave = false;
      if (isBall) {
        const ballSpeed = Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]);
        const isTeammate = ballInts[2] >= 0 && ballInts[2] === teamOf[ai];
        const isFriendlyPass = isTeammate && !hot && (ballSpeed >= 175 || ballScalars[0] >= 175);
        if ((hot || isFriendlyPass) && superActive[ai] !== SUP_CANNONBALL && closing < 0 && ballSpeed > 50) {
          const bux = vx[6] / ballSpeed, buy = vy[6] / ballSpeed;
          const delta = Math.max(0, -(bux * nx + buy * ny));
          let R = 0;
          if (superActive[ai] === SUP_STALWART) {
            R = Infinity;
          } else {
            const normMass = baseMass[ai] / 3;
            const guardMult = guarding[ai] ? (ironGuard[ai] ? 4.0 : 2.0) : 1.0;
            const colMult = superActive[ai] === SUP_COLOSSUS ? Math.max(1, mass[ai] / baseMass[ai]) : 1.0;
            R = normMass * baseStability[ai] * (1 + delta * delta) * guardMult * colMult;
          }
          const strikerPow = TS_FIRE_EXP === 0.5 ? Math.sqrt(ballScalars[1]) : ballScalars[1] ** TS_FIRE_EXP;
          const E = (ballSpeed / BASE_LAUNCH) * strikerPow * 2.8;
          if (hot && E > R) {
            fireWin = R / E;
          } else if (guarding[ai] && ironCooldown[ai] <= 0 && (isFriendlyPass || E <= R)) {
            if (ballInts[2] >= 0 && ballInts[2] !== teamOf[ai]) {
              ballInts[1] = 0; ballInts[0] = 0;
            }
            ironSave = true;
            ironGuard[ai] = 1;
            ironCooldown[ai] = IRON_CD;
            syncStatsAt(ai);
            if (!deferIron) triggerIronBlast(ai);
          }
        }
      }

      const stalA = ai < 6 && superActive[ai] === SUP_STALWART;
      const stalB = bi < 6 && superActive[bi] === SUP_STALWART;
      const anchorA = stalA && vx[ai] === 0 && vy[ai] === 0;
      const anchorB = stalB && vx[bi] === 0 && vy[bi] === 0;
      const rawInvA = 1 / mass[ai];
      const rawInvB = fireWin >= 0 && isBall ? fireWin / mass[ai] : 1 / mass[bi];
      const invA = anchorA ? 0 : rawInvA;
      const invB = anchorB ? 0 : rawInvB;
      const inverse = invA + invB;

      const overlap = rad - d;
      if (stalA && !stalB) {
        x[bi] += nx * overlap; y[bi] += ny * overlap;
      } else if (stalB && !stalA) {
        x[ai] -= nx * overlap; y[ai] -= ny * overlap;
      } else if (rawInvA + rawInvB > 0) {
        const corr = overlap / (rawInvA + rawInvB);
        x[ai] -= nx * corr * rawInvA; y[ai] -= ny * corr * rawInvA;
        x[bi] += nx * corr * rawInvB; y[bi] += ny * corr * rawInvB;
      }

      if (closing >= 0) return ironSave ? 1 : 0;
      if (inverse === 0) {
        if (emitEvents) onContactEvent(ai, bi, -closing, false, -1);
        return ironSave ? 1 : 0;
      }

      const preRvx = vx[bi] - vx[ai], preRvy = vy[bi] - vy[ai];
      const preBallSpeed = isBall ? Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]) : 0;
      const pairKEBefore = isBall ? bodyKEAt(ai) + bodyKEAt(6) : 0;

      const baseImpulse = -1.88 * closing / inverse;
      let impulseA = baseImpulse, impulseB = baseImpulse, sweetMult = 1;
      if (isBall) {
        const bodyCoreDist = (radius[ai] > 25 ? radius[ai] : 25) + radius[6];
        const maxReachDist = ra + radius[6];
        const denom = maxReachDist - bodyCoreDist > 1 ? maxReachDist - bodyCoreDist : 1;
        const pokeFrac = d > bodyCoreDist ? (d - bodyCoreDist < denom ? (d - bodyCoreDist) / denom : 1) : 0;
        sweetMult = 1 - (1 - SS_POKE_MIN) * pokeFrac;
        if (power[ai]) impulseB *= power[ai];
      } else {
        impulseB *= (strength[ai] / stability[bi]);
        impulseA *= (strength[bi] / stability[ai]);
      }

      const normalA = vx[ai] * nx + vy[ai] * ny, normalB = vx[bi] * nx + vy[bi] * ny;
      const energyBefore = (invA ? mass[ai] * normalA * normalA : 0) + (invB ? mass[bi] * normalB * normalB : 0);
      const nextA = invA ? normalA - impulseA * invA : 0;
      const nextB = invB ? normalB + impulseB * invB : 0;
      const energyAfter = (invA ? mass[ai] * nextA * nextA : 0) + (invB ? mass[bi] * nextB * nextB : 0);
      const eScale = energyAfter > energyBefore ? Math.sqrt(energyBefore / energyAfter) : 1;
      if (invA) impulseA = (normalA - nextA * eScale) / invA;
      if (invB) impulseB = (nextB * eScale - normalB) / invB;
      if (isBall && sweetMult < 1) impulseB *= sweetMult;

      let hasCannon = false, cannonImpulse = 0;
      if (isBall && superActive[ai] === SUP_CANNONBALL) {
        hasCannon = true;
        cannonImpulse = CANNON_MULT * impulseB;
      }

      if (invA > 0) { vx[ai] -= impulseA * nx * invA; vy[ai] -= impulseA * ny * invA; }
      if (invB > 0) { vx[bi] += impulseB * nx * invB; vy[bi] += impulseB * ny * invB; }

      if (!isBall && teamOf[ai] !== teamOf[bi]) {
        const driveA = normalA, driveB = -normalB;
        const knockA = Math.abs(impulseA * invA), knockB = Math.abs(impulseB * invB);
        if (driveB >= driveA && !stalA && knockA > DAZE_SPEED) {
          const add = (knockA - DAZE_SPEED) / DAZE_SCALE / stability[ai];
          dazeVal[ai] = Math.min(DAZE_MAX, dazeVal[ai] + (add < DAZE_HIT ? add : DAZE_HIT));
        }
        if (driveA >= driveB && !stalB && knockB > DAZE_SPEED) {
          const add = (knockB - DAZE_SPEED) / DAZE_SCALE / stability[bi];
          dazeVal[bi] = Math.min(DAZE_MAX, dazeVal[bi] + (add < DAZE_HIT ? add : DAZE_HIT));
        }
      }
      if (fireWin >= 0 && !stalA) {
        const knock = Math.abs(impulseA * invA);
        if (knock > DAZE_SPEED) {
          const add = (knock - DAZE_SPEED) / DAZE_SCALE / stability[ai];
          dazeVal[ai] = Math.min(DAZE_MAX, dazeVal[ai] + (add < DAZE_HIT ? add : DAZE_HIT));
        }
      }

      const tx = -ny, ty = nx;
      const frictionA = anchorA ? 0 : 1 / mass[ai], frictionB = anchorB ? 0 : 1 / mass[bi];
      const spinA = !stalA, spinB = !stalB;
      const rvt = (vx[bi] - vx[ai]) * tx + (vy[bi] - vy[ai]) * ty;
      const relSpeed = Math.sqrt(preRvx * preRvx + preRvy * preRvy);
      const hipClip = !isBall && teamOf[ai] !== teamOf[bi] && closing < 0 &&
        relSpeed >= HC_SPEED && Math.abs(rvt) >= Math.abs(closing) * HC_RATIO;
      const slip = rvt - omega[ai] * radius[ai] - omega[bi] * radius[bi];
      const gripPair = Math.sqrt(grip[ai] * grip[bi]);
      const limit = gripPair * baseImpulse;
      const massDenom = frictionA + frictionB;
      const slipDenom = massDenom + (spinA ? 2 * frictionA : 0) + (spinB ? 2 * frictionB : 0);
      const effectiveLimit = hipClip && massDenom > 0
        ? limit + gripPair * HC_BOOST * Math.abs(rvt) / massDenom
        : limit;
      let tangent = 0;
      if (slipDenom > 0) {
        tangent = -slip / slipDenom;
        if (tangent < -effectiveLimit) tangent = -effectiveLimit;
        else if (tangent > effectiveLimit) tangent = effectiveLimit;
      }

      if (frictionA > 0) {
        vx[ai] -= tangent * tx * frictionA; vy[ai] -= tangent * ty * frictionA;
        if (spinA) {
          let dO = -2 * tangent * frictionA / radius[ai];
          if (hipClip && Math.abs(omega[ai] + dO) > Math.abs(omega[ai]) && stability[ai] > 1) dO /= stability[ai];
          omega[ai] += dO;
        }
      }
      if (frictionB > 0) {
        vx[bi] += tangent * tx * frictionB; vy[bi] += tangent * ty * frictionB;
        if (spinB) {
          let dO = -2 * tangent * frictionB / radius[bi];
          if (hipClip && Math.abs(omega[bi] + dO) > Math.abs(omega[bi]) && stability[bi] > 1) dO /= stability[bi];
          omega[bi] += dO;
        }
      }

      let snapped = false;
      const pSlot = isBall ? slotOf[ai] : -1;
      const prevStrikerTeam = isBall ? ballInts[2] : -1;
      const prevStrikerSlot = isBall ? ballInts[3] : -1;

      if (isBall && closing < 0 && fireWin < 0 && !ironSave && !hot &&
          superActive[ai] !== SUP_STICKY && !guarding[ai] && !crowdedBall &&
          prevStrikerTeam === teamOf[ai] && prevStrikerSlot >= 0 && pSlot >= 0 && prevStrikerSlot !== pSlot &&
          preBallSpeed >= SNAP_PASS && drive >= SNAP_DRIVE) {
        const curBS = Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]);
        const ux = curBS ? vx[6] / curBS : nx;
        const uy = curBS ? vy[6] / curBS : ny;
        const tapeMult = (ballScalars[2] * chemistryMult[ai]) ** TT_SNAP_EXP;
        const targetBS = curBS + SNAP_REDIR * preBallSpeed * power[ai] * tapeMult;
        let pTransKE = 0.5 * mass[ai] * (vx[ai] * vx[ai] + vy[ai] * vy[ai]);
        const pRotKE = 0.25 * mass[ai] * radius[ai] * radius[ai] * omega[ai] * omega[ai];
        const bRotKE = 0.25 * mass[6] * radius[6] * radius[6] * omega[6] * omega[6];
        let availKE = Math.max(0, pairKEBefore - (pTransKE + pRotKE) - bRotKE);
        const desKE = 0.5 * mass[6] * targetBS * targetBS;
        if (desKE > availKE && pTransKE > 0 && !stalA) {
          const trans = Math.min(desKE - availKE, pTransKE * 0.45);
          const pSc = Math.sqrt(Math.max(0, pTransKE - trans) / pTransKE);
          vx[ai] *= pSc; vy[ai] *= pSc;
          pTransKE = 0.5 * mass[ai] * (vx[ai] * vx[ai] + vy[ai] * vy[ai]);
          availKE = Math.max(0, pairKEBefore - (pTransKE + pRotKE) - bRotKE);
        }
        let postBS = Math.max(curBS, Math.min(targetBS, Math.sqrt(2 * availKE / mass[6])));
        if (pTransKE + pRotKE + bRotKE + 0.5 * mass[6] * postBS * postBS > pairKEBefore) {
          postBS *= 1 - 1e-15;
        }
        vx[6] = ux * postBS;
        vy[6] = uy * postBS;
        const nft = ballInts[0] + SNAP_HEAT;
        ballInts[0] = nft < FIRE_TICKS ? nft : FIRE_TICKS;
        if (postBS > ballScalars[0]) ballScalars[0] = postBS;
        snapped = true;
      }

      if (hasCannon) {
        vx[6] += cannonImpulse * nx / mass[6];
        vy[6] += cannonImpulse * ny / mass[6];
        superActive[ai] = SUP_NONE;
        ballInts[0] = FIRE_TICKS;
        ballInts[1] = 1;
        ballScalars[1] = power[ai]; ballScalars[2] = synergyMult[ai]; ballScalars[3] = curveMult[ai];
        ballInts[2] = teamOf[ai]; ballInts[3] = pSlot;
      } else if (isBall && closing < 0 && fireWin < 0) {
        ballScalars[1] = power[ai]; ballScalars[2] = synergyMult[ai]; ballScalars[3] = curveMult[ai];
        ballInts[2] = teamOf[ai]; ballInts[3] = pSlot;
      } else if (isBall && fireWin < 0) {
        ballScalars[3] = curveMult[ai];
      }

      if (closeSpin) {
        const nw = omega[6] + closeSpin;
        omega[6] = nw < -24 ? -24 : (nw > 24 ? 24 : nw);
        const sp = Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]);
        vx[6] += (sp ? vx[6] / sp : nx) * strikeBoost;
        vy[6] += (sp ? vy[6] / sp : ny) * strikeBoost;
      }

      if (ironSave) {
        if (!anchorA) { vx[ai] *= IRON_KEEP; vy[ai] *= IRON_KEEP; omega[ai] *= IRON_KEEP; }
        vx[6] *= IRON_KEEP; vy[6] *= IRON_KEEP; omega[6] *= IRON_KEEP;
      }

      if (isBall) {
        const sp = Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]), pace = ballScalars[0];
        if (!own) ballScalars[0] = sp;
        else if (snapped && sp > pace) ballScalars[0] = sp;
        else if (!ironSave && hot && drive >= HOT_DRIVE && pace > sp) {
          const ux = sp ? vx[6] / sp : dx / (d || 1), uy = sp ? vy[6] / sp : dy / (d || 1);
          vx[6] = ux * pace; vy[6] = uy * pace;
        }
      }

      if (emitEvents) {
        const passerSlot = (isBall && closing < 0 && fireWin < 0 && !ironSave && !guarding[ai] &&
          prevStrikerTeam === teamOf[ai] && prevStrikerSlot >= 0 && pSlot >= 0 && prevStrikerSlot !== pSlot &&
          preBallSpeed >= TT_PASS_MIN) ? prevStrikerSlot : -1;
        onContactEvent(ai, bi, -closing, fireWin >= 0, passerSlot);
      }
      return ironSave ? 1 : 0;
    }

    function stepKernel() {
      if (ballInts[4]) { // openingShot
        let touching = 0, tIdx = -1;
        const br = radius[6], bx = x[6], by = y[6];
        for (let i = 0; i < 6; i++) {
          if (!carded[i]) {
            const dx = x[i] - bx, dy = y[i] - by, lim = hitRadiusAt(i) + br;
            if (dx * dx + dy * dy <= lim * lim) { touching++; tIdx = i; }
          }
        }
        if (touching > 1 || (touching === 1 && !spinStrike[tIdx])) ballInts[4] = 0;
        else if (touching === 1) {
          if ((vx[6] - vx[tIdx]) * (bx - x[tIdx]) + (vy[6] - vy[tIdx]) * (by - y[tIdx]) >= 0) ballInts[4] = 0;
        }
      }

      let host = -1, hasMag = 0, hasShk = 0, hasTimed = 0;
      for (let i = 0; i < 6; i++) {
        if (holding[i] && host < 0) host = i;
        if (ironCooldown[i] > 0) ironCooldown[i]--;
        const sa = superActive[i];
        if (sa !== SUP_NONE) {
          if (sa === SUP_MAGNET) hasMag = 1;
          else if (sa === SUP_SHOCKWAVE) hasShk = 1;
          if (superTicks[i] > 0) hasTimed = 1;
        }
      }

      if (host < 0 && hasMag) {
        const bx = x[6], by = y[6], br = radius[6];
        for (let i = 0; i < 6; i++) {
          if (!carded[i] && superActive[i] === SUP_MAGNET) {
            const dx = x[i] - bx, dy = y[i] - by, d2 = dx * dx + dy * dy;
            const minD = radius[i] + br;
            if (d2 > minD * minD && d2 < MAG_RAD2) {
              const d = Math.sqrt(d2);
              superHit[i] = 1;
              const pull = MAG_PULL * (1 - d / MAG_RAD);
              const before = teamOf[i] !== ballInts[2] ? Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]) : 0;
              vx[6] += (dx / d) * pull * DT;
              vy[6] += (dy / d) * pull * DT;
              if (teamOf[i] !== ballInts[2]) countSlowingBall(before);
            }
          }
        }
      }

      if (hasTimed) {
        hasShk = 0;
        for (let i = 0; i < 6; i++) {
          if (superActive[i] === SUP_NONE || !superTicks[i]) continue;
          if (--superTicks[i] > 0) {
            if (superActive[i] === SUP_SHOCKWAVE) hasShk = 1;
            else if (superActive[i] === SUP_COLOSSUS && radius[i] < (baseRadius[i] > COL_RAD ? baseRadius[i] : COL_RAD)) syncStatsAt(i);
            continue;
          }
          endSuperAt(i);
          if (i === host) host = -1;
        }
      }

      if (hasShk) {
        for (let i = 0; i < 6; i++) {
          if (superActive[i] === SUP_SHOCKWAVE) {
            let nIn = 0;
            const bTeam = teamOf[i], bx = x[i], by = y[i];
            const oStart = bTeam === 0 ? 3 : 0;
            for (let j = oStart; j < oStart + 3; j++) {
              if (!carded[j] && superActive[j] !== SUP_STALWART) {
                const dx = x[j] - bx, dy = y[j] - by, d2 = dx * dx + dy * dy;
                if (d2 > 0 && d2 < SHK_RAD2) {
                  shockIdx[nIn] = j;
                  shockD[nIn] = Math.sqrt(d2);
                  shockDx[nIn] = dx;
                  shockDy[nIn] = dy;
                  nIn++;
                }
              }
            }
            if (!shockFired[i]) {
              if (nIn > 0) {
                shockFired[i] = 1;
                superHit[i] = 1;
                for (let k = 0; k < nIn; k++) {
                  const oi = shockIdx[k], d = shockD[k];
                  const force = (1 - d / SHK_RAD) * SHK_FORCE / mass[oi];
                  vx[oi] += (shockDx[k] / d) * force;
                  vy[oi] += (shockDy[k] / d) * force;
                }
              }
            } else {
              for (let k = 0; k < nIn; k++) {
                const oi = shockIdx[k], d = shockD[k];
                const repel = SHK_REPEL * (1 - d / SHK_RAD) * DT;
                vx[oi] += (shockDx[k] / d) * repel;
                vy[oi] += (shockDy[k] / d) * repel;
              }
            }
          }
        }
      }

      if (host >= 0 && ++ballInts[5] >= (superHoldTicks[host] || SUP_HOLD)) {
        endSuperAt(host);
        host = -1;
      }

      let settledSpin = -1;
      for (let i = 0; i < 6; i++) {
        const vxi = vx[i], vyi = vy[i], wi = omega[i];
        if (vxi === 0 && vyi === 0 && wi === 0) continue;
        if (wi !== 0) {
          if (vxi !== 0 || vyi !== 0) {
            const curve = (launchSpin[i] !== 0 && wi * launchSpin[i] > 0) ? curveFactor[i] : involCurve[i];
            const ang = wi * curve * DT;
            let cos, sin;
            if (ang >= -0.05 && ang <= 0.05) {
              const a2 = ang * ang;
              cos = 1 - a2 * (0.5 - a2 * 0.041666666666666664);
              sin = ang * (1 - a2 * (0.16666666666666666 - a2 * 0.008333333333333333));
            } else {
              cos = Math.cos(ang); sin = Math.sin(ang);
            }
            vx[i] = vxi * cos - vyi * sin;
            vy[i] = vxi * sin + vyi * cos;
          }
          if (settledSpin < 0) {
            settledSpin = hasMag ? 0 : 1;
            if (settledSpin) {
              for (let j = 0; j < 7; j++) {
                if (vx[j] * vx[j] + vy[j] * vy[j] >= 4) { settledSpin = 0; break; }
              }
            }
          }
          const dec = (settledSpin ? SETTLED_SPIN_DECAY_C : SPIN_DECAY_C) * DT;
          const aw = Math.abs(wi);
          omega[i] = aw <= dec ? 0 : (wi > 0 ? aw - dec : -(aw - dec));
        }
        if (vx[i] !== 0 || vy[i] !== 0) {
          x[i] += vx[i] * DT;
          y[i] += vy[i] * DT;
        }
      }

      if (host < 0) {
        const vxb = vx[6], vyb = vy[6], wb = omega[6];
        if (vxb !== 0 || vyb !== 0 || wb !== 0) {
          if (wb !== 0) {
            if (vxb !== 0 || vyb !== 0) {
              const bCurve = (ballInts[1] ? BURNING_CURVE_C : BALL_CURVE_C) * ballScalars[3];
              const ang = wb * bCurve * DT;
              let cos, sin;
              if (ang >= -0.05 && ang <= 0.05) {
                const a2 = ang * ang;
                cos = 1 - a2 * (0.5 - a2 * 0.041666666666666664);
                sin = ang * (1 - a2 * (0.16666666666666666 - a2 * 0.008333333333333333));
              } else {
                cos = Math.cos(ang); sin = Math.sin(ang);
              }
              vx[6] = vxb * cos - vyb * sin;
              vy[6] = vxb * sin + vyb * cos;
            }
            if (settledSpin < 0) {
              settledSpin = hasMag ? 0 : 1;
              if (settledSpin) {
                for (let j = 0; j < 7; j++) {
                  if (vx[j] * vx[j] + vy[j] * vy[j] >= 4) { settledSpin = 0; break; }
                }
              }
            }
            const dec = (settledSpin ? SETTLED_SPIN_DECAY_C : SPIN_DECAY_C) * DT;
            const aw = Math.abs(wb);
            omega[6] = aw <= dec ? 0 : (wb > 0 ? aw - dec : -(aw - dec));
          }
          if (vx[6] !== 0 || vy[6] !== 0) {
            x[6] += vx[6] * DT;
            y[6] += vy[6] * DT;
          }
        }
      }

      // Slipstream / Tailgate drafts
      let leadCount = 0, followCount = 0;
      for (let i = 0; i < 6; i++) {
        if (!carded[i]) {
          const s2 = vx[i] * vx[i] + vy[i] * vy[i];
          v2Scratch[i] = s2;
          spScratch[i] = 0;
          if (s2 >= TG_FOLLOW2) {
            followCount++;
            if (s2 >= TG_LEAD2) leadCount++;
          }
        } else {
          v2Scratch[i] = 0;
        }
      }
      const hasDrafts = leadCount > 0 && followCount >= 2;
      if (hasDrafts) {
        for (let i = 0; i < 6; i++) {
          if (v2Scratch[i] < TG_FOLLOW2) { drafts[i] = 0; continue; }
          let spd = spScratch[i], maxDraft = 0;
          const bvx = vx[i], bvy = vy[i], bx = x[i], by = y[i], br = radius[i];
          const bTeam = teamOf[i], bChem = chemistryMult[i];
          for (let j = 0; j < 6; j++) {
            if (j === i || v2Scratch[j] < TG_LEAD2) continue;
            const lvx = vx[j], lvy = vy[j];
            const hDot = bvx * lvx + bvy * lvy;
            if (hDot <= 0) continue;
            const dx = x[j] - bx, dy = y[j] - by;
            const aDot = dx * lvx + dy * lvy;
            if (aDot <= 0) continue;
            const lr = radius[j];
            const effGap = TG_GAP * (lr > 25 ? lr / 25 : 1);
            const maxDist = effGap + lr + br;
            if (dx >= maxDist || dx <= -maxDist || dy >= maxDist || dy <= -maxDist) continue;
            let lSpd = spScratch[j];
            if (lSpd === 0) { lSpd = Math.sqrt(v2Scratch[j]); spScratch[j] = lSpd; }
            if (lSpd < TG_LEAD) continue;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d <= 0) continue;
            const gap = d - lr - br;
            if (gap >= effGap) continue;
            const ahead = aDot < d * lSpd ? aDot / (d * lSpd) : 1;
            if (ahead < TG_ALIGN) continue;
            if (spd === 0) {
              spd = Math.sqrt(v2Scratch[i]);
              spScratch[i] = spd;
              if (spd < TG_SPEED) { maxDraft = 0; break; }
            }
            const heading = hDot < spd * lSpd ? hDot / (spd * lSpd) : 1;
            if (heading < TG_ALIGN) continue;
            const rawD = (1 - gap / effGap) * ((ahead - TG_ALIGN) / TG_SPAN) * ((heading - TG_ALIGN) / TG_SPAN);
            const sameT = teamOf[j] === bTeam;
            const tBoost = sameT ? (PD_EXP === 0.5 ? Math.sqrt(synergyMult[j] * bChem) : (synergyMult[j] * bChem) ** PD_EXP) : 1;
            const maxF = sameT ? PD_MAX_FACTOR : 1;
            let dr = rawD * tBoost;
            if (dr > maxF) dr = maxF;
            if (dr > maxDraft) maxDraft = dr;
          }
          drafts[i] = maxDraft;
        }
      }

      // Skater & ball friction
      for (let i = 0; i < 6; i++) {
        const vxi = vx[i], vyi = vy[i];
        if (vxi !== 0 || vyi !== 0) {
          const carrying = holding[i] ? CARRY_FRIC : (superActive[i] === SUP_STALWART ? STAL_FRIC : 1);
          const effF = hasDrafts && drafts[i] > 0 ? friction[i] * carrying * (1 - TG_CUT * drafts[i]) : friction[i] * carrying;
          const s2 = vxi * vxi + vyi * vyi, decel = effF * DT;
          if (s2 <= decel * decel) {
            vx[i] = vy[i] = 0;
          } else {
            const sp = Math.sqrt(s2), fac = (sp - decel) / sp;
            vx[i] = vxi * fac; vy[i] = vyi * fac;
          }
        }
      }
      if (host >= 0) {
        const ox = hasStick[6] ? stickX[6] : radius[host] + radius[6];
        const oy = hasStick[6] ? stickY[6] : 0;
        x[6] = x[host] + ox; y[6] = y[host] + oy;
        vx[6] = vx[host]; vy[6] = vy[host]; omega[6] = omega[host];
      } else if (vx[6] !== 0 || vy[6] !== 0) {
        const s2 = vx[6] * vx[6] + vy[6] * vy[6], decel = (friction[6] + AIR_DRAG * s2) * DT;
        if (s2 <= decel * decel) {
          vx[6] = vy[6] = 0;
        } else {
          const sp = Math.sqrt(s2), fac = (sp - decel) / sp;
          vx[6] *= fac; vy[6] *= fac;
        }
      }

      // Ball heat / fire
      if (vx[6] !== 0 || vy[6] !== 0 || ballScalars[0] !== 0 || ballInts[1] !== 0 || ballInts[0] !== 0) {
        const sp = Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]), pace = ballScalars[0];
        const decPace = pace - (friction[6] + AIR_DRAG * pace * pace) * DT;
        ballScalars[0] = sp > decPace ? sp : decPace;
        const share = ballScalars[0] / BASE_LAUNCH;
        if (ballInts[1]) {
          if (share <= HEAT_SUSTAIN) { ballInts[1] = 0; ballInts[0] = 0; }
        } else {
          if (share > HEAT_FIRE) {
            const nft = ballInts[0] + 1;
            ballInts[0] = nft < FIRE_TICKS ? nft : FIRE_TICKS;
          } else if (share <= HEAT_SUSTAIN) {
            ballInts[0] = 0;
          }
          if (ballInts[0] >= FIRE_TICKS && sp > HEAT_FIRE * BASE_LAUNCH) ballInts[1] = 1;
        }
      }

      // 3-pass collision & wall resolution (hit[0..5] kept current by syncStatsAt)
      const bh = radius[6] >= 18 ? radius[6] : 18;

      for (let pass = 0; pass < 3; pass++) {
        const resBefore = resolvedCount;
        // 1. Skater-vs-skater (15 pairs)
        for (let i = 0; i < 5; i++) {
          const ax = x[i], ay = y[i], ar = radius[i];
          for (let j = i + 1; j < 6; j++) {
            const rch = ar + radius[j];
            const dx = ax - x[j], dy = ay - y[j];
            if (dx * dx + dy * dy > rch * rch) continue;
            collidePair(i, j, false, true);
          }
        }
        // 2. Skater-vs-ball
        if (resolvedCount !== resBefore) {
          host = holderIdx();
        }
        let nPinch = 0;
        const bx = x[6], by = y[6];
        for (let i = 0; i < 6; i++) {
          if (carded[i] || holding[i]) continue;
          const rch = hit[i] + bh, dx = x[i] - bx, dy = y[i] - by;
          if (dx * dx + dy * dy <= rch * rch) pinchList[nPinch++] = i;
        }
        if (nPinch === 1) {
          collidePair(pinchList[0], 6, false, true);
        } else if (nPinch > 1) {
          if (host >= 0) {
            for (let p = 0; p < nPinch; p++) collidePair(pinchList[p], 6, false, true);
          } else {
            let sTeam0 = 0, sTeam1 = 0;
            for (let p = 0; p < nPinch; p++) {
              const idx = pinchList[p];
              if (superActive[idx] === SUP_STICKY) {
                if (teamOf[idx] === 0) sTeam0 = 1; else sTeam1 = 1;
              }
            }
            if (sTeam0 && sTeam1) {
              for (let p = 0; p < nPinch; p++) {
                const idx = pinchList[p];
                if (superActive[idx] === SUP_STICKY) { superHit[idx] = 1; endSuperAt(idx); }
              }
              sTeam0 = 0; sTeam1 = 0;
            }
            if (sTeam0 || sTeam1) {
              for (let p = 0; p < nPinch; p++) collidePair(pinchList[p], 6, false, true);
            } else {
              // Symmetric multi-skater pinch resolution
              let keBudget = bodyKEAt(6);
              for (let p = 0; p < nPinch; p++) keBudget += bodyKEAt(pinchList[p]);
              saveBall[0] = x[6]; saveBall[1] = y[6]; saveBall[2] = vx[6]; saveBall[3] = vy[6]; saveBall[4] = omega[6];
              saveBall[5] = ballScalars[0]; saveBall[6] = ballScalars[1]; saveBall[7] = ballScalars[2]; saveBall[8] = ballScalars[3];
              const b0FireTicks = ballInts[0], b0OnFire = ballInts[1], b0STeam = ballInts[2], b0SSlot = ballInts[3], b0Open = ballInts[4];
              let sumDx = 0, sumDy = 0, sumDvx = 0, sumDvy = 0, sumDw = 0;
              let energySource = false, anyFireOff = false, anyFireOn = false, maxPace = 0;
              let teamMask = 0, slotMask = 0, singleSlot = -1;
              let lastPow = saveBall[6], lastSyn = saveBall[7], lastCurve = saveBall[8];
              let ironMask = 0;

              for (let p = 0; p < nPinch; p++) {
                const idx = pinchList[p];
                x[6] = saveBall[0]; y[6] = saveBall[1]; vx[6] = saveBall[2]; vy[6] = saveBall[3]; omega[6] = saveBall[4];
                ballScalars[0] = saveBall[5]; ballScalars[1] = saveBall[6]; ballScalars[2] = saveBall[7]; ballScalars[3] = saveBall[8];
                ballInts[0] = b0FireTicks; ballInts[1] = b0OnFire; ballInts[2] = b0STeam; ballInts[3] = b0SSlot; ballInts[4] = b0Open;

                const hadCannon = superActive[idx] === SUP_CANNONBALL;
                const ddx = saveBall[0] - x[idx], ddy = saveBall[1] - y[idx];
                const sDrive = (vx[idx] * ddx + vy[idx] * ddy) / (Math.sqrt(ddx * ddx + ddy * ddy) || 1);
                if (hadCannon || (b0OnFire && teamOf[idx] === b0STeam && sDrive >= HOT_DRIVE)) energySource = true;

                if (collidePair(idx, 6, true, true)) ironMask |= (1 << idx);

                sumDx += x[6] - saveBall[0]; sumDy += y[6] - saveBall[1];
                sumDvx += vx[6] - saveBall[2]; sumDvy += vy[6] - saveBall[3];
                sumDw += omega[6] - saveBall[4];
                if (b0OnFire && !ballInts[1]) anyFireOff = true;
                if (!b0OnFire && ballInts[1]) anyFireOn = true;
                if (ballScalars[0] > maxPace) maxPace = ballScalars[0];
                if ((ballInts[2] !== b0STeam || ballInts[3] !== b0SSlot) && ballInts[2] >= 0) {
                  teamMask |= (1 << ballInts[2]);
                  if (ballInts[3] >= 0) { slotMask |= (1 << ballInts[3]); singleSlot = ballInts[3]; }
                  lastPow = ballScalars[1]; lastSyn = ballScalars[2]; lastCurve = ballScalars[3];
                }
              }

              ballInts[4] = 0;
              x[6] = saveBall[0] + sumDx; y[6] = saveBall[1] + sumDy;
              vx[6] = saveBall[2] + sumDvx; vy[6] = saveBall[3] + sumDvy;
              const nw = saveBall[4] + sumDw;
              omega[6] = nw < -24 ? -24 : (nw > 24 ? 24 : nw);

              if (!energySource) {
                let skKE = 0;
                for (let p = 0; p < nPinch; p++) skKE += bodyKEAt(pinchList[p]);
                const maxBKE = keBudget > skKE ? keBudget - skKE : 0;
                const curBKE = bodyKEAt(6);
                if (curBKE > maxBKE && curBKE > 0) {
                  const sc = Math.sqrt(maxBKE / curBKE);
                  vx[6] *= sc; vy[6] *= sc; omega[6] *= sc;
                }
              }
              if (anyFireOff && !anyFireOn) { ballInts[1] = 0; ballInts[0] = 0; }
              else if (anyFireOn) { ballInts[1] = 1; ballInts[0] = FIRE_TICKS; }
              else { ballInts[1] = b0OnFire; ballInts[0] = b0FireTicks; }

              if (teamMask === 1 || teamMask === 2) {
                ballInts[2] = teamMask === 1 ? 0 : 1;
                ballInts[3] = (slotMask & (slotMask - 1)) === 0 && slotMask !== 0 ? singleSlot : -1;
                ballScalars[1] = lastPow; ballScalars[2] = lastSyn; ballScalars[3] = lastCurve;
              } else if (teamMask === 3) {
                ballScalars[1] = 1; ballScalars[2] = 1; ballScalars[3] = 1;
                ballInts[2] = -1; ballInts[3] = -1;
              } else {
                ballInts[2] = b0STeam; ballInts[3] = b0SSlot;
                ballScalars[1] = saveBall[6]; ballScalars[2] = saveBall[7]; ballScalars[3] = saveBall[8];
              }
              const postSp = Math.sqrt(vx[6] * vx[6] + vy[6] * vy[6]);
              ballScalars[0] = ((teamMask === 1 || teamMask === 2) && ballInts[2] === b0STeam && maxPace > postSp) ? maxPace : postSp;

              if (ironMask) {
                for (let i = 0; i < 6; i++) {
                  if (ironMask & (1 << i)) {
                    hit[i] = hitRadiusAt(i);
                    triggerIronBlast(i);
                  }
                }
              }
            }
          }
        }

        if (resolvedCount !== resBefore) {
          host = holderIdx();
        }
        for (let i = 0; i < 6; i++) {
          const r = radius[i], xi = x[i], yi = y[i];
          if (xi < 150 || xi > 850 || yi < 60 + r || yi > 540 - r || r > 90) wallsBody(i, -1);
        }
        if (host >= 0) {
          const ox = hasStick[6] ? stickX[6] : radius[host] + radius[6];
          const oy = hasStick[6] ? stickY[6] : 0;
          const ex = x[host] + ox, ey = y[host] + oy;
          x[6] = ex; y[6] = ey;
          vx[6] = vx[host]; vy[6] = vy[host]; omega[6] = omega[host];
          wallsBody(6, host);
          const ddx = x[6] - ex, ddy = y[6] - ey;
          if (ddx !== 0 || ddy !== 0) {
            if (superActive[host] !== SUP_STALWART) {
              x[host] += ddx; y[host] += ddy;
              vx[host] = vx[6]; vy[host] = vy[6];
              wallsBody(host, -1);
            }
            const nxO = x[6] - x[host], nyO = y[6] - y[host], od = Math.sqrt(nxO * nxO + nyO * nyO) || 1;
            const td = radius[host] + radius[6];
            stickX[6] = (nxO / od) * td; stickY[6] = (nyO / od) * td; hasStick[6] = 1;
            x[6] = x[host] + stickX[6]; y[6] = y[host] + stickY[6];
            wallsBody(6, host);
          }
        } else {
          const br = radius[6], bx2 = x[6], by2 = y[6];
          if (bx2 < 150 || bx2 > 850 || by2 < 60 + br || by2 > 540 - br) wallsBody(6, -1);
        }
        if (resolvedCount === resBefore) break;
      }

      const byEnd = y[6];
      if (byEnd >= R_GTOP && byEnd <= R_GBOTTOM) {
        const bxEnd = x[6], br = radius[6];
        if (bxEnd - br <= R_LEFT - R_GDEPTH + 1 || bxEnd + br < R_LEFT) return 1;
        if (bxEnd + br >= R_RIGHT + R_GDEPTH - 1 || bxEnd - br > R_RIGHT) return 0;
      }
      return -1;
    }

    function settledKernel() {
      if (vx[6] * vx[6] + vy[6] * vy[6] >= 4 || Math.abs(omega[6]) >= 0.05) return false;
      for (let i = 5; i >= 0; i--) {
        if (vx[i] * vx[i] + vy[i] * vy[i] >= 4 || Math.abs(omega[i]) >= 0.05 ||
            (superActive[i] === SUP_COLOSSUS && colossusProgAt(i) < 1)) return false;
      }
      return true;
    }

    function cornerOfKernel(px, py, margin) {
      const span = R_CORNER + margin;
      const side = px < R_LEFT + span ? 0 : (px > R_RIGHT - span ? 1 : -1);
      if (side < 0) return -1;
      const end = py < R_TOP + span ? 0 : (py > R_BOTTOM - span ? 2 : -1);
      return end < 0 ? -1 : side + end;
    }

    function inCreaseKernel(i, team) {
      if (carded[i] || superActive[i] === SUP_STALWART) return false;
      const dx = x[i] - (team ? R_RIGHT : R_LEFT), dy = y[i] - GOAL_MID_Y;
      return dx * dx + dy * dy < CREASE_R2;
    }

    function campingKernel(team) {
      let inC = 0, curAZ = 0;
      const tStart = team * 3, oStart = (1 - team) * 3;
      for (let k = 0; k < 3; k++) {
        if (inCreaseKernel(tStart + k, team)) inC++;
        const oi = oStart + k;
        if (!carded[oi] && (team ? x[oi] > 820 : x[oi] < 180)) curAZ++;
      }
      return inC > (curAZ > 1 ? curAZ : 1);
    }

    function lapseFoulsKernel() {
      if (matchInts[0] && !campingKernel(0)) matchInts[0] = 0;
      if (matchInts[1] && !campingKernel(1)) matchInts[1] = 0;
      if (matchInts[2] >= 0) {
        if (cornerOfKernel(x[6], y[6], CORNER_EXIT) !== matchInts[2]) {
          matchInts[2] = -1; matchInts[3] = 0;
        }
      }
    }

    function decidedKernel() {
      if (vx[6] !== 0 || vy[6] !== 0 || ballInts[1] !== 0 || holderIdx() >= 0) return false;
      if (cornerOfKernel(x[6], y[6], 0) >= 0) return false;
      if (campingKernel(0) || campingKernel(1)) return false;
      const bx = x[6], by = y[6], br = radius[6];
      for (let i = 0; i < 6; i++) {
        if (superActive[i] !== SUP_NONE) return false;
        const s2 = vx[i] * vx[i] + vy[i] * vy[i];
        if (s2 === 0) continue;
        const spd = Math.sqrt(s2);
        let maxSyn = 1;
        const tStart = teamOf[i] * 3;
        for (let k = tStart; k < tStart + 3; k++) {
          if (k !== i && !carded[k] && synergyMult[k] > maxSyn) maxSyn = synergyMult[k];
        }
        const prod = maxSyn * chemistryMult[i];
        const packMult = PD_EXP === 0.5 ? Math.sqrt(prod) : prod ** PD_EXP;
        const cutCand = TG_CUT * packMult;
        const maxCut = cutCand > PD_MAX_CUT ? PD_MAX_CUT : (cutCand > TG_CUT ? cutCand : TG_CUT);
        const stopDist = s2 / (2 * friction[i] * (1 - maxCut));
        const contact = hitRadiusAt(i) + br;
        const dbx = x[i] - bx, dby = y[i] - by;
        const brLim = stopDist + contact;
        if (dbx * dbx + dby * dby <= brLim * brLim) return false;
        const ownGX = teamOf[i] ? R_RIGHT : R_LEFT;
        const dgx = x[i] - ownGX, dgy = y[i] - GOAL_MID_Y;
        const crLim = stopDist + CREASE_R;
        if (dgx * dgx + dgy * dgy <= crLim * crLim) return false;
        const stopX = x[i] + (vx[i] / spd) * stopDist;
        const oppAz = teamOf[i] ? 180 : 820;
        if ((x[i] - oppAz) * (stopX - oppAz) <= 0) return false;
        const oStart = teamOf[i] === 0 ? 3 : 0;
        for (let j = oStart; j < oStart + 3; j++) {
          if (carded[j]) continue;
          const dx = x[j] - x[i], dy = y[j] - y[i];
          if (dx * vx[i] + dy * vy[i] <= 0) continue;
          const opLim = stopDist + radius[i] + radius[j];
          if (dx * dx + dy * dy <= opLim * opLim) return false;
        }
      }
      return true;
    }

    function finishTurnKernel(goal, isPulse) {
      const keepMotion = isPulse && goal < 0;
      for (let i = 0; i < 6; i++) {
        spinStrike[i] = 0;
        guarding[i] = 0; ironGuard[i] = 0; ironCooldown[i] = 0;
        stunned[i] = 0;
        if (!keepMotion) { vx[i] = vy[i] = omega[i] = 0; launchSpin[i] = 0; }
        if (!keepMotion || (superActive[i] === SUP_NONE && usedSuper[i] && !superRefunded[i])) endSuperAt(i);
        syncStatsAt(i);
        if (stunnedNext[i]) {
          if (superActive[i] !== SUP_NONE) endSuperAt(i);
          stunned[i] = 1;
          stunnedNext[i] = 0;
        }
        carded[i] = 0;
      }
      spinStrike[6] = 0;
      ballInts[4] = 0;
      if (!keepMotion) {
        vx[6] = vy[6] = omega[6] = 0;
        hasStick[6] = 0;
        ballInts[0] = 0; ballInts[1] = 0; ballScalars[0] = 0;
        ballScalars[1] = 1; ballScalars[2] = 1; ballScalars[3] = 1;
        ballInts[2] = -1; ballInts[3] = -1;
      }

      if (goal < 0) {
        let cardMask = 0;
        for (let t = 0; t < 2; t++) {
          const now = campingKernel(t) ? 1 : 0;
          if (now && matchInts[t]) {
            const ts = t * 3;
            for (let k = ts; k < ts + 3; k++) if (inCreaseKernel(k, t)) cardMask |= (1 << k);
          }
          matchInts[t] = (now && !matchInts[t]) ? 1 : 0;
        }
        const corner = cornerOfKernel(x[6], y[6], 0);
        matchInts[3] = corner < 0 ? 0 : (corner === matchInts[2] ? matchInts[3] + 1 : 1);
        matchInts[2] = corner;
        matchInts[4] = matchInts[3] > STALL_TURNS ? 1 : 0;
        if (matchInts[4]) {
          let inMask = 0, c0 = 0, c1 = 0;
          for (let i = 0; i < 6; i++) {
            if (!carded[i] && cornerOfKernel(x[i], y[i], radius[i]) === corner) {
              inMask |= (1 << i);
              if (i < 3) c0++; else c1++;
            }
          }
          if (c0 !== c1) {
            const targetStart = c0 > c1 ? 0 : 3;
            for (let i = targetStart; i < targetStart + 3; i++) if (inMask & (1 << i)) cardMask |= (1 << i);
          }
          matchInts[2] = -1; matchInts[3] = 0;
        }
        if (cardMask) {
          for (let i = 0; i < 6; i++) {
            if (!(cardMask & (1 << i))) continue;
            endSuperAt(i);
            x[i] = spawnX[i]; y[i] = spawnY[i];
            vx[i] = vy[i] = omega[i] = launchSpin[i] = 0;
            meter[i] = 0; dazeVal[i] = 0; guarding[i] = 0; stunned[i] = 1; carded[i] = 1;
          }
        }
        if (matchInts[4]) {
          const h = holderIdx();
          if (h >= 0) endSuperAt(h);
          let chosenY = 300;
          for (let yi = 0; yi < FACEOFF_YS.length; yi++) {
            const cy = FACEOFF_YS[yi];
            let clear = true;
            for (let i = 0; i < 6; i++) {
              if (!carded[i]) {
                const dx = x[i] - 500, dy = y[i] - cy, mr = radius[i] + radius[6];
                if (dx * dx + dy * dy < mr * mr) { clear = false; break; }
              }
            }
            if (clear) { chosenY = cy; break; }
          }
          x[6] = 500; y[6] = chosenY;
          vx[6] = vy[6] = omega[6] = 0;
          hasStick[6] = 0; ballInts[5] = 0;
          ballInts[0] = 0; ballInts[1] = 0; ballScalars[0] = 0;
          ballScalars[1] = 1; ballScalars[2] = 1; ballScalars[3] = 1;
          ballInts[2] = -1; ballInts[3] = -1;
        }
      } else {
        matchInts[0] = 0; matchInts[1] = 0; matchInts[2] = -1; matchInts[3] = 0; matchInts[4] = 0;
        matchInts[5 + goal]++;
        if (!classicMode) {
          const concStart = (1 - goal) * 3;
          for (let i = concStart; i < concStart + 3; i++) awardMeterAt(i, METER_CONCEDED);
        }
      }
    }

    function loadTurnState(input, stats, isClassic) {
      classicMode = isClassic ? 1 : 0;
      let maxMT = -Infinity;
      for (let i = 0; i < 6; i++) {
        const b = input.bodies[i];
        const sp = P.spawn(b.team, b.slot ?? (i % 3));
        spawnX[i] = sp.x; spawnY[i] = sp.y;
        bx0[i] = b.x; by0[i] = b.y; bvx0[i] = b.vx; bvy0[i] = b.vy; bomega0[i] = b.omega;
        bradius0[i] = b.radius; bmass0[i] = b.mass; bfriction0[i] = b.friction;
        breach0[i] = b.reach ?? b.radius;
        bstrength0[i] = b.strength ?? 1; bstability0[i] = b.stability ?? 1; bbounciness0[i] = b.bounciness ?? 1;
        bmeter0[i] = isClassic ? 0 : (b.meter || 0);
        const mt = b.meterTick !== undefined ? b.meterTick : -Infinity;
        bmeterTick0[i] = mt;
        if (Number.isFinite(mt) && mt > maxMT) maxMT = mt;
        bdaze0[i] = b.daze || 0; bspinStrike0[i] = b.spinStrike || 0; blaunchSpin0[i] = b.launchSpin || 0;
        bstickX0[i] = 0; bstickY0[i] = 0;

        const saKey = b.superActive;
        bsuperActive0[i] = saKey ? (SUPER_KEY_TO_ID[saKey] ?? SUP_NONE) : SUP_NONE;
        bsuperTicks0[i] = b.superTicks || 0;
        bsuperHoldTicks0[i] = b.superHoldTicks || 0;
        bironCooldown0[i] = b.ironCooldownTicks || 0;
        bguarding0[i] = b.guarding ? 1 : 0;
        bironGuard0[i] = b.ironGuard ? 1 : 0;
        busedSuper0[i] = b.usedSuperThisTurn ? 1 : 0;
        bsuperHit0[i] = b.superHit ? 1 : 0;
        bsuperRefunded0[i] = b.superRefunded ? 1 : 0;
        bshockFired0[i] = b.shockwaveFired ? 1 : 0;
        bcarded0[i] = b.carded ? 1 : 0;
        bstunned0[i] = b.stunned ? 1 : 0;
        bstunnedNext0[i] = b.stunnedNext ? 1 : 0;
        bholding0[i] = b.holding ? 1 : 0;
        bhasStick0[i] = 0;

        if (!isClassic && b.equippedSuper) {
          eqSuperId[i] = SUPER_KEY_TO_ID[b.equippedSuper.key] ?? SUP_NONE;
          eqBonusTicks[i] = b.equippedSuper.bonusTicks ?? b.superBonusTicks ?? 0;
          eqBonusRefund[i] = b.equippedSuper.bonusRefund ?? b.superBonusRefund ?? 0;
        } else {
          eqSuperId[i] = SUP_NONE; eqBonusTicks[i] = 0; eqBonusRefund[i] = 0;
        }

        const sm = b.sizeMult ?? 1;
        sizeMult[i] = sm;
        baseRadius[i] = b.baseRadius ?? b.radius;
        baseMass[i] = b.baseMass ?? b.mass;
        baseFriction[i] = b.baseFriction ?? b.friction;
        baseReach[i] = b.baseReach ?? breach0[i];
        baseStrength[i] = b.baseStrength ?? bstrength0[i];
        baseStability[i] = b.baseStability ?? bstability0[i];
        baseBounciness[i] = b.baseBounciness ?? bbounciness0[i];
        grip[i] = b.grip ?? 0.3;
        maxSpin[i] = b.maxSpin ?? 15;
        impulse[i] = b.impulse ?? P.IMPULSE;
        const cm = b.curveMult ?? 1;
        curveMult[i] = cm;
        const cf = b.curveFactor ?? P.SKATER_CURVE;
        curveFactor[i] = cf;
        involCurve[i] = (cf / cm) * P.TRUE_GLIDE.involuntaryCurve / (cm > 1 ? cm : 1);
        power[i] = b.power ?? 1;
        synergyMult[i] = b.synergyMult ?? 1;
        chemistryMult[i] = b.chemistryMult ?? 1;
        sizeLaunchMult[i] = sm ** P.SIZE.launch;
        reSteerMult[i] = (sm ** P.SIZE.agility) * ((grip[i] / 0.3) ** P.ICE_BITE.gripCutExp);
        sizeStrikeMult[i] = sm ** P.SIZE.strike;
        sizeBoardsMult[i] = sm ** P.SIZE.boards;
        carveSc[i] = Math.sqrt((maxSpin[i] / 15) * cm);
        creativity[i] = (b.personality?.creativity ?? 31.5) / 63;
        const st = stats?.[i];
        effGain[i] = METER_RATE * M.superStat(P, st?.efficiency);
        synStat[i] = M.superStat(P, st?.synergy);
        chemStat[i] = M.superStat(P, st?.chemistry);
      }

      const ball = input.bodies[6];
      bx0[6] = ball.x; by0[6] = ball.y; bvx0[6] = ball.vx; bvy0[6] = ball.vy; bomega0[6] = ball.omega;
      bradius0[6] = ball.radius; bmass0[6] = ball.mass; bfriction0[6] = ball.friction;
      grip[6] = ball.grip ?? 0.3; maxSpin[6] = ball.maxSpin ?? 8;
      if (ball.stickOffset) {
        bstickX0[6] = ball.stickOffset.x; bstickY0[6] = ball.stickOffset.y; bhasStick0[6] = 1;
      } else {
        bstickX0[6] = 0; bstickY0[6] = 0; bhasStick0[6] = 0;
      }
      bballScalars0[0] = ball.pace || 0;
      bballScalars0[1] = ball.strikerPower || 1;
      bballScalars0[2] = ball.strikerSynergy ?? 1;
      bballScalars0[3] = ball.curveMult ?? 1;

      bballInts0[0] = ball.fireTicks || 0;
      bballInts0[1] = ball.onFire ? 1 : 0;
      bballInts0[2] = ball.strikerTeam ?? -1;
      bballInts0[3] = ball.strikerSlot ?? -1;
      bballInts0[4] = ball.openingShot ? 1 : 0;
      bballInts0[5] = ball.stuckTicks || 0;

      const f = input.fouls;
      bmatchInts0[0] = f?.crease?.[0] ? 1 : 0;
      bmatchInts0[1] = f?.crease?.[1] ? 1 : 0;
      bmatchInts0[2] = f && f.corner !== null && f.corner !== undefined ? f.corner : -1;
      bmatchInts0[3] = f?.cornerTurns || 0;
      bmatchInts0[4] = f?.faceoff ? 1 : 0;
      bmatchInts0[5] = input.scores?.[0] || 0;
      bmatchInts0[6] = input.scores?.[1] || 0;

      return input.clock === undefined && maxMT > -Infinity ? maxMT + METER_CD : (input.clock || 0);
    }

    function runRollout(moves, response, team, baseClock, limitTicks, fullTurnTicks, isPulse, canDecide, weights, tmw) {
      simDynF64.set(baseDynF64);
      simDynI32.set(baseDynI32);
      searchTeam = team;
      toucherIdx = -1;
      touchesCount = 0;
      boardsCount = 0;
      firstTeamTouchIdx = -1;
      multiTeamTouchFlag = false;

      const m0 = team ? response : moves;
      const m1 = team ? moves : response;
      for (let i = 0; i < 6; i++) {
        const pm = i < 3 ? m0[i] : m1[i - 3];
        planAngle[i] = ((pm.angle % TWO_PI) + TWO_PI) % TWO_PI;
        planPower[i] = pm.power;
        planSpin[i] = pm.spin || 0;
        planSuper[i] = pm.superArm ? 1 : 0;
        planGuard[i] = pm.guard ? 1 : 0;
        if (planSuper[i] && (classicMode || stunned[i] || meter[i] < 100 || eqSuperId[i] < 0)) {
          throw new Error('Super unavailable.');
        }
      }

      // startTurn + launch
      for (let i = 0; i < 6; i++) {
        if (stunned[i] && superActive[i] !== SUP_NONE) endSuperAt(i);
        guarding[i] = planGuard[i] && !stunned[i] ? 1 : 0;
        ironGuard[i] = 0;
        ironCooldown[i] = 0;
        usedSuper[i] = superActive[i] !== SUP_NONE ? 1 : 0;
        if (!stunned[i] && planSuper[i] && meter[i] >= 100) {
          usedSuper[i] = 1;
          meter[i] = 0;
          superActive[i] = eqSuperId[i];
          const bt = eqBonusTicks[i];
          superTicks[i] = SUP_TICKS + bt;
          superHoldTicks[i] = SUP_HOLD + bt;
          superHit[i] = 0;
          superRefunded[i] = 0;
        }
        syncStatsAt(i);
      }

      for (let i = 0; i < 6; i++) {
        spinStrike[i] = 0;
        syncStatsAt(i);
        if (stunned[i]) {
          vx[i] = 0; vy[i] = 0; omega[i] = 0; dazeVal[i] = 0;
          continue;
        }
        if (guarding[i]) {
          vx[i] *= GUARD_BRAKE; vy[i] *= GUARD_BRAKE; omega[i] *= GUARD_BRAKE; dazeVal[i] = 0;
          continue;
        }
        let spIn = planSpin[i];
        if (spIn < -1) spIn = -1; else if (spIn > 1) spIn = 1;
        const sa = superActive[i];
        const supScale = sa === SUP_COLOSSUS ? COL_LAUNCH : (sa === SUP_STALWART ? STAL_LAUNCH : baseMass[i] / mass[i]);
        const lSpd = (impulse[i] / 3) * supScale * sizeLaunchMult[i] * (1 - dazeSlowAt(i));
        const absSp = Math.abs(spIn);
        const cdBoost = absSp > 0 && carveSc[i] > CD_THRESH ? 1 + CD_BOOST * absSp * (carveSc[i] - CD_THRESH) : 1;
        const full = lSpd * cdBoost;
        let pwr = planPower[i];
        if (pwr < 0) pwr = 0; else if (pwr > 1) pwr = 1;
        dazeVal[i] = 0;
        if (pwr > 0) {
          const ang = planAngle[i];
          const dx = Math.cos(ang) * full * pwr - vx[i], dy = Math.sin(ang) * full * pwr - vy[i];
          const prevSpd = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
          const ratio = full > 0 ? prevSpd / full : prevSpd;
          const effSteer = 1 + (ratio < 1 ? ratio : 1) * (reSteerMult[i] - 1);
          const dMag = Math.sqrt(dx * dx + dy * dy) || 1;
          const sc = (full * effSteer) < dMag ? (full * effSteer) / dMag : 1;
          vx[i] += dx * sc; vy[i] += dy * sc;
          const nw = omega[i] + spIn * maxSpin[i];
          omega[i] = nw < -maxSpin[i] ? -maxSpin[i] : (nw > maxSpin[i] ? maxSpin[i] : nw);
          launchSpin[i] = spIn !== 0 ? omega[i] : (launchSpin[i] !== 0 && omega[i] * launchSpin[i] > 0 ? omega[i] : 0);
          if (omega[i] !== 0) spinStrike[i] = 1;
        }
      }
      spinStrike[6] = 0;
      let anySS = 0;
      for (let i = 0; i < 6; i++) {
        if (!spinStrike[i]) continue;
        anySS = 1;
        const dx = x[i] - x[6], dy = y[i] - y[6];
        const gap = Math.max(0, Math.sqrt(dx * dx + dy * dy) - hitRadiusAt(i) - radius[6]);
        const prox = Math.max(0, 1 - gap / (4 * radius[6]));
        spinStrike[i] += prox * prox * (3 - 2 * prox);
      }
      ballInts[4] = anySS;

      let goal = -1, ticksDone = 0, hitDecided = false;
      let hasFoul = matchInts[0] !== 0 || matchInts[1] !== 0 || matchInts[2] >= 0;

      for (let tick = 1; tick <= limitTicks; tick++) {
        tickClock = baseClock + tick;
        goal = stepKernel();
        if (hasFoul) {
          lapseFoulsKernel();
          hasFoul = matchInts[0] !== 0 || matchInts[1] !== 0 || matchInts[2] >= 0;
        }
        ticksDone = tick;
        if (goal >= 0 || settledKernel() || tick === limitTicks) break;
        if (canDecide && touchesCount > 0 && decidedKernel()) { hitDecided = true; break; }
      }

      const partial = !hitDecided && goal < 0 && ticksDone < fullTurnTicks && !settledKernel();
      if (!partial) {
        finishTurnKernel(goal, isPulse);
      }

      // Evaluate outcome directly on TypedArrays
      let val;
      if (goal >= 0) {
        if (goal !== team) {
          val = -weights.goal;
        } else {
          const scCre = toucherIdx >= 0 ? creativity[toucherIdx] : (31.5 / 63);
          const effCre = multiTeamTouchFlag && tmw > scCre ? tmw : scCre;
          const comp = boardsCount + (touchesCount > 1 ? touchesCount - 1 : 0);
          val = weights.goal * ((COMPLEX.simple + COMPLEX.creative * effCre) ** comp);
        }
      } else {
        const bx = x[6], by = y[6];
        const ownStart = team * 3, otherStart = (1 - team) * 3;
        const dir = team ? -1 : 1, ownGoal = team ? 940 : 60;
        const covX = ownGoal + dir * 88;
        let accOwn = Infinity, accOther = Infinity, cov = Infinity;
        let mDiff = 0, cDiff = 0, sDiff = 0, dDiff = 0;

        for (let k = 0; k < 3; k++) {
          const oi = ownStart + k;
          const dbx1 = x[oi] - bx, dby1 = y[oi] - by;
          const ao = Math.sqrt(dbx1 * dbx1 + dby1 * dby1) + (stunned[oi] ? 250 : 0);
          if (ao < accOwn) accOwn = ao;
          const dcx = x[oi] - covX, dcy = y[oi] - 300;
          const cv = Math.sqrt(dcx * dcx + dcy * dcy);
          if (cv < cov) cov = cv;
          mDiff += meter[oi];
          if (carded[oi]) cDiff++;
          else if (stunned[oi] || stunnedNext[oi]) sDiff--;
          dDiff -= dazeSlowAt(oi);

          const ti = otherStart + k;
          const dbx2 = x[ti] - bx, dby2 = y[ti] - by;
          const ae = Math.sqrt(dbx2 * dbx2 + dby2 * dby2) + (stunned[ti] ? 250 : 0);
          if (ae < accOther) accOther = ae;
          mDiff -= meter[ti];
          if (carded[ti]) cDiff--;
          else if (stunned[ti] || stunnedNext[ti]) sDiff++;
          dDiff += dazeSlowAt(ti);
        }
        const warned = matchInts[team] - matchInts[1 - team];
        const dazes = dDiff / DAZE_MAX;
        let stall = 0;
        const fCorner = matchInts[2];
        if (fCorner >= 0) {
          let mine = 0, theirs = 0;
          for (let k = 0; k < 3; k++) {
            const oi = ownStart + k, ti = otherStart + k;
            if (cornerOfKernel(x[oi], y[oi], radius[oi]) === fCorner) mine++;
            if (cornerOfKernel(x[ti], y[ti], radius[ti]) === fCorner) theirs++;
          }
          if (mine !== theirs) {
            const ratio = matchInts[3] / STALL_TURNS;
            stall = (mine > theirs ? 1 : -1) * (ratio < 1 ? ratio : 1);
          }
        }
        val = dir * (bx - 500) * weights.progress + (accOther - accOwn) * weights.access - cov * weights.cover + mDiff * weights.meter -
          cDiff * weights.card - (warned + stall) * weights.warning + sDiff * (weights.stun ?? 180) + dazes * (weights.daze ?? 120);
      }
      return { val, ticksDone };
    }

    return { loadTurnState, runRollout };
  }

  let spareKernel = null;

  function plan(input, team = 1, config = {}) {
    if (team !== 0 && team !== 1) throw new Error('Invalid CPU team.');
    const level = config.level || 'medium';
    if (!LEVELS[level]) throw new Error('Invalid CPU level.');
    const settings = { ...LEVELS[level], ...config };
    const rawWeights = { ...WEIGHTS, ...config.weights };
    if (!Number.isInteger(settings.candidates) || settings.candidates < 1 || settings.candidates > 1000 ||
        !Number.isInteger(settings.opponents) || settings.opponents < 1 || settings.opponents > 3 ||
        !Number.isFinite(settings.risk) || settings.risk < 0 || settings.risk > 1 ||
        !Number.isFinite(settings.temperature) || settings.temperature <= 0 ||
        (settings.wobble !== undefined && typeof settings.wobble !== 'boolean') ||
        (settings.fastTick !== undefined && typeof settings.fastTick !== 'boolean') ||
        (settings.searchTicks !== undefined && (!Number.isInteger(settings.searchTicks) || settings.searchTicks < 30 || settings.searchTicks > 2880)) ||
        (settings.screenTop !== undefined && (!Number.isInteger(settings.screenTop) || settings.screenTop < 1 || settings.screenTop > 1000)) ||
        Object.values(rawWeights).some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid CPU search settings.');
    const started = performance.now(), random = randomSource(config.seed ?? 1);
    const useFastTick = Boolean(settings.fastTick) && input.bodies.length === 7 && input.bodies[6].team === -1;

    const classic = M.rule(input.mode, 'classic');
    let state;
    let kernel = null;
    let baseClock = 0;

    if (useFastTick) {
      kernel = spareKernel || createSoAKernel();
      spareKernel = null;
      baseClock = kernel.loadTurnState(input, input.stats, classic);
      // Read-only Hidden-Class-preserving view for candidate generation (options, legacy, roles, choose)
      let needCopy = classic;
      if (!needCopy) {
        for (let i = 0; i < 6; i++) {
          if (input.bodies[i].superArm) { needCopy = true; break; }
        }
      }
      let viewBodies;
      if (!needCopy) {
        viewBodies = input.bodies;
      } else {
        viewBodies = new Array(7);
        for (let i = 0; i < 6; i++) {
          const s = input.bodies[i];
          const copy = { ...s };
          if ('superArm' in copy) copy.superArm = false;
          if (classic) {
            copy.meter = 0;
            copy.equippedSuper = null;
            if ('superKey' in copy) copy.superKey = null;
          }
          viewBodies[i] = copy;
        }
        viewBodies[6] = input.bodies[6];
      }
      state = {
        version: input.version,
        mode: input.mode,
        bodies: viewBodies,
        stats: input.stats || [],
        scores: input.scores ? [input.scores[0], input.scores[1]] : [0, 0],
        turn: input.turn,
        roundTurns: input.roundTurns || 0,
        clock: baseClock,
        fouls: input.fouls
      };
    } else {
      state = structuredClone(input);
      let maxMeterTick = -Infinity;
      for (const b of state.bodies) {
        if (b.team >= 0) b.superArm = false;
        if ('voice' in b) b.voice = null;
        if ('name' in b) b.name = null;
        if (classic) {
          b.equippedSuper = null;
          b.superKey = null;
          b.meter = 0;
        } else if (b.equippedSuper) {
          b.equippedSuper = { id: b.equippedSuper.id, key: b.equippedSuper.key, bonusTicks: b.equippedSuper.bonusTicks, bonusRefund: b.equippedSuper.bonusRefund };
        }
        if (Number.isFinite(b.meterTick) && b.meterTick > maxMeterTick) maxMeterTick = b.meterTick;
      }
      if (state.clock === undefined && maxMeterTick > -Infinity) {
        state.clock = maxMeterTick + M.METER.cooldownTicks;
      }
    }

    try {
      const ownStart = team * 3;
      const avgTrait = key => (
        ((state.bodies[ownStart].personality?.[key] ?? 31.5) +
         (state.bodies[ownStart + 1].personality?.[key] ?? 31.5) +
         (state.bodies[ownStart + 2].personality?.[key] ?? 31.5)) / (3 * 63)
      );
      const agg = avgTrait('aggression'), tmw = avgTrait('teamwork'), clu = avgTrait('clutch');
      const deficit = Math.max(0, (state.scores?.[1 - team] ?? 0) - (state.scores?.[team] ?? 0));
      const matchPt = (state.scores?.[1 - team] ?? 0) >= 4;
      const pressure = Math.min(1, deficit * 0.25 + (matchPt ? 0.4 : 0));
      const surge = pressure * (clu - 0.5) * 2;

      const weights = { ...rawWeights };
      if (config.weights?.progress === undefined) weights.progress = WEIGHTS.progress * (1 + 0.35 * (agg - 0.5) + 0.35 * Math.max(0, surge));
      if (config.weights?.access === undefined) weights.access = WEIGHTS.access * (1 + 0.25 * (agg - 0.5) + 0.25 * Math.max(0, surge));
      if (config.weights?.cover === undefined) weights.cover = WEIGHTS.cover * Math.max(0.4, 1 + 0.45 * (0.5 - agg) - 0.3 * Math.max(0, surge));
      if (config.weights?.stun === undefined) weights.stun = WEIGHTS.stun * (1 + 0.3 * (agg - 0.5));
      if (config.weights?.daze === undefined) weights.daze = WEIGHTS.daze * (1 + 0.3 * (agg - 0.5));

      if (config.risk === undefined) {
        settings.risk = Math.max(0.05, Math.min(0.85, settings.risk - 0.12 * surge));
      }

      let best = legacy(state, team), simulations = 0, ticks = 0, evaluated = 0;
      const opponent = legacy(state, 1 - team);
      const ball = state.bodies[6], jobs = roles(state, team);
      const oppTeam = 1 - team, oppStart = oppTeam * 3;
      const guardOpponents = [
        state.bodies[oppStart].stunned ? HOLD : GUARD,
        state.bodies[oppStart + 1].stunned ? HOLD : GUARD,
        state.bodies[oppStart + 2].stunned ? HOLD : GUARD
      ];
      const oppGoal = team ? 940 : 60;
      const oppOwnGoal = team ? 60 : 940;
      const oppCoverX = oppOwnGoal + (oppTeam ? -88 : 88);
      const attack = new Array(3);
      for (let k = 0; k < 3; k++) {
        const b = state.bodies[oppStart + k];
        if (b.stunned) attack[k] = HOLD;
        else if (behindBall(b, ball, oppTeam)) attack[k] = strike(b, ball, oppGoal, 300);
        else attack[k] = aim(b, oppCoverX, 300);
      }
      const responses = [opponent, guardOpponents, attack].slice(0, settings.opponents);
      const pulse = M.rule(state.mode, 'pulse');
      const fullTurnTicks = M.turnTicks(state.mode);
      const baseHorizon = settings.searchTicks || SEARCH_TICKS;
      const searchTicks = state.fouls?.crease?.[team] ? fullTurnTicks : baseHorizon;
      const limitTicks = Math.min(fullTurnTicks, searchTicks);

      const results = new Map();
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

      const canDecide = !pulse && !state.fouls?.crease?.[team] && !state.fouls?.crease?.[1 - team] && state.fouls?.corner === null;

      function runFast(moves, response) {
        const out = kernel.runRollout(moves, response, team, baseClock, limitTicks, fullTurnTicks, pulse, canDecide, weights, tmw);
        simulations++;
        ticks += out.ticksDone;
        return out.val;
      }

      function runStandard(moves, response) {
        let toucher = null, touches = 0, boards = 0;
        let firstTeamTouch = null, multiTeamTouch = false;
        const watch = {
          collide({ a, b, speed }) {
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
        const checkDecided = canDecide ? bodies => touches > 0 && decided(bodies) : null;
        const allMoves = team
          ? [response[0], response[1], response[2], moves[0], moves[1], moves[2]]
          : [moves[0], moves[1], moves[2], response[0], response[1], response[2]];
        const result = M.resolveTurn(P, state, allMoves, { effects: false, fastSearch: true, fastTick: false, ticks: searchTicks, decided: checkDecided, watch, preservePartial: true });
        simulations++; ticks += result.replay.ticks;
        return evaluateBodies(result.state.bodies, result.state.fouls, team, result.replay.goal, weights, boards + Math.max(0, touches - 1), toucher, multiTeamTouch, tmw);
      }

      const run = useFastTick ? runFast : runStandard;

      function simulate(moves, response, r) {
        const id0 = getMoveId(moves[0]), id1 = getMoveId(moves[1]), id2 = getMoveId(moves[2]);
        const key = r + 4 * (id0 + 2048 * (id1 + 2048 * id2));
        let cached = results.get(key);
        if (cached === undefined) {
          cached = run(moves, response);
          results.set(key, cached);
        }
        return cached;
      }

      const scored = [], screened = [], vetting = 4;
      const useScreenTop = Number.isInteger(settings.screenTop) && responses.length > 1;
      let bestScore = -Infinity;

      function roleFit(moves) {
        let n = 0;
        for (let i = 0; i < 3; i++) {
          const p = moves[i], b = state.bodies[ownStart + i];
          if (!fitsRole(jobs[i], p, b, state)) continue;
          const intent = getIntent(p);
          if (state.fouls?.crease?.[team] && M.inCrease(P, b, team)) {
            if (intent === 'hold' || intent === 'guard') {
              const isStalwart = p.superArm && b.equippedSuper?.key?.toLowerCase() === 'stalwart';
              if (!isStalwart) continue;
            }
          }
          n++;
        }
        return n;
      }

      function score(moves) {
        const fit = roleFit(moves);
        if (useScreenTop) {
          const v0 = simulate(moves, responses[0], 0);
          evaluated++;
          const quickVal = v0 + fit * weights.role;
          screened.push({ moves, fit, v0, quickVal });
          return quickVal;
        }
        const respCount = responses.length;
        const values = new Array(respCount);
        const maxEval = Math.max(weights.goal, 3000);
        const cutoff = bestScore - vetting * settings.temperature;
        let sumSoFar = 0, minSoFar = Infinity, pruned = false;
        for (let r = 0; r < respCount; r++) {
          const v = simulate(moves, responses[r], r);
          values[r] = v;
          sumSoFar += v;
          if (v < minSoFar) minSoFar = v;
          if (useFastTick && r + 1 < respCount && bestScore > -Infinity) {
            const rem = respCount - (r + 1);
            const upperBlend = ((sumSoFar + rem * maxEval) / respCount) * (1 - settings.risk) + Math.min(minSoFar, maxEval) * settings.risk + fit * weights.role;
            if (upperBlend < cutoff) { pruned = true; break; }
          }
        }
        evaluated++;
        if (pruned) return cutoff - 1;
        const blend = () => {
          let s = 0, m = Infinity;
          for (let r = 0; r < respCount; r++) { s += values[r]; if (values[r] < m) m = values[r]; }
          return (s / respCount) * (1 - settings.risk) + m * settings.risk + fit * weights.role;
        };
        if (blend() < cutoff) return blend();
        if (settings.wobble !== false) {
          values[0] = (values[0] + simulate(wobble(moves, 1), responses[0], 0) + simulate(wobble(moves, -1), responses[0], 0)) / 3;
        }
        const value = blend();
        scored.push({ moves, value });
        return value;
      }

      bestScore = score(best);
      function consider(moves) {
        if (evaluated >= settings.candidates) return;
        const value = score(moves);
        if (value > bestScore + 1e-8) { best = moves; bestScore = value; }
      }
      const choices = [0, 1, 2].map(i => options(state, team, i, best[i]));
      const maxChoiceLen = Math.max(choices[0].length, choices[1].length, choices[2].length);
      for (let j = 0; j < maxChoiceLen && evaluated < settings.candidates * .65; j++) {
        for (let i = 0; i < 3; i++) if (choices[i][j]) {
          const next = best.slice(); next[i] = choices[i][j]; consider(next);
        }
      }
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        if (i === j || evaluated >= settings.candidates * .8) continue;
        const sender = state.bodies[ownStart + i], receiver = state.bodies[ownStart + j];
        if (sender.stunned || receiver.stunned || (sender.personality?.teamwork ?? 31.5) < 24) continue;
        const x = Math.max(180, Math.min(820, ball.x + (team ? -130 : 130)));
        const y = ball.y < 300 ? 390 : 210;
        const next = best.slice(); next[i] = tag(strike(sender, ball, x, y), 'pass'); next[j] = tag(aim(receiver, x, y), 'receive');
        consider(next);
      }

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
      const editableBuf = [0, 0, 0];
      while (evaluated < settings.candidates && anyUnstunned) {
        const next = [copy(best[0]), copy(best[1]), copy(best[2])];
        let editLen = 0;
        if (evaluated % 4 !== 0) {
          for (let idx = 0; idx < 3; idx++) {
            if (!state.bodies[ownStart + idx].stunned && !next[idx].guard) editableBuf[editLen++] = idx;
          }
        }
        if (!editLen) {
          const tp = teamPlan();
          next[0] = tp[0]; next[1] = tp[1]; next[2] = tp[2];
        } else {
          const i = editableBuf[Math.floor(random() * editLen)];
          next[i].angle += (random() - .5) * .28;
          next[i].power = Math.max(0, Math.min(1, next[i].power + (random() - .5) * .25));
          if (next[i].power > 0) {
            next[i].spin = Math.max(-1, Math.min(1, next[i].spin + (random() - .5) * creativityOf(state.bodies[ownStart + i]) * .5));
          } else {
            next[i].angle = 0;
            next[i].spin = 0;
          }
        }
        consider(next);
      }

      if (useScreenTop && screened.length) {
        screened.sort((a, b) => b.quickVal - a.quickVal);
        const topK = Math.min(screened.length, settings.screenTop);
        const respCount = responses.length;
        for (let idx = 0; idx < topK; idx++) {
          const cand = screened[idx];
          let v0 = cand.v0;
          if (settings.wobble !== false) {
            v0 = (v0 + simulate(wobble(cand.moves, 1), responses[0], 0) + simulate(wobble(cand.moves, -1), responses[0], 0)) / 3;
          }
          let s = v0, m = v0;
          for (let r = 1; r < respCount; r++) {
            const vr = simulate(cand.moves, responses[r], r);
            s += vr;
            if (vr < m) m = vr;
          }
          const value = (s / respCount) * (1 - settings.risk) + m * settings.risk + cand.fit * weights.role;
          scored.push({ moves: cand.moves, value });
        }
      }
      const chosen = choose(scored, settings.temperature, random, state, team);
      return { plans: M.validatePlans(chosen.moves), diagnostics: { level, candidates: evaluated, simulations, ticks, score: chosen.value, milliseconds: performance.now() - started } };
    } finally {
      if (kernel) spareKernel = kernel;
    }
  }

  function choose(scored, temperature, random, state = null, team = null) {
    const ball = state?.bodies?.[6];
    const nScored = scored.length;
    const plains = new Float64Array(nScored);
    let top = -Infinity;
    for (let s = 0; s < nScored; s++) {
      const c = scored[s];
      let spinPen = 0;
      for (let i = 0; i < 3; i++) {
        const skater = (state && team !== null) ? state.bodies[team * 3 + i] : null;
        const waive = skater && ball && isPointBlank(skater, ball);
        if (!waive) spinPen += Math.abs(c.moves[i].spin || 0);
      }
      const pl = c.value - 15 * spinPen;
      plains[s] = pl;
      if (pl > top) top = pl;
    }
    const wArr = new Float64Array(nScored);
    let wSum = 0;
    for (let s = 0; s < nScored; s++) {
      const w = Math.exp((plains[s] - top) / temperature);
      wArr[s] = w;
      wSum += w;
    }
    let pick = random() * wSum;
    for (let i = 0; i < nScored; i++) if ((pick -= wArr[i]) <= 0) return scored[i];
    return scored[nScored - 1];
  }

  const api = {
    LEVELS, WEIGHTS, WOBBLE, COMPLEX, SEARCH_TICKS, HOLD, GUARD,
    randomSource, legacy, decided, plan, aim, strike, behindBall, isPointBlank, evaluate, options,
    segmentBlocked, cpuPlans, baseline: cpuPlans
  };
  if (node) module.exports = api; else root.ububallCPU = api;
})(globalThis);
