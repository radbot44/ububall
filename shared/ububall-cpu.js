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
    hard: Object.freeze({ candidates: 84, opponents: 3, searchTicks: 500, wobble: true, risk: .53, temperature: 1.0 }),
    insane: Object.freeze({ candidates: 150, opponents: 4, searchTicks: 580, wobble: true, godRefine: true, risk: .55, temperature: .30 }),
    god: Object.freeze({ candidates: 240, opponents: 4, searchTicks: 720, wobble: true, godWobble: true, godRefine: true, risk: .55, temperature: .08 })
  });
  const WEIGHTS = Object.freeze({
    goal: 10000, progress: 1, access: .35, cover: .3, meter: .35,
    role: 8, card: 400, warning: 150, stun: 185, daze: 120
  });
  const WOBBLE = Object.freeze({ angle: .035, power: .05 });
  const COMPLEX = Object.freeze({ simple: 1, creative: .002 });
  const ROLE_INTENTS = Object.freeze({
    attack: ['shoot', 'pass', 'carry'],
    support: ['chase', 'clear', 'receive', 'check', 'pass', 'shoot', 'rim', 'draft'],
    defend: ['cover', 'guard', 'hold', 'clear', 'rim']
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
        const anchorY = Math.max(RINK_CY - ySpan, Math.min(RINK_CY + ySpan, ball.y));

        if (ball.x > 740 && b.x >= ball.x - 8 && dBall < 170 && (agg > 0.25 || ball.x > 810)) {
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
      const omega0 = clampedSpin * (body.maxSpin || 15);
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

  function strike(body, ball, x, y, superKey = null, spin = 0) {
    let leadX = ball.x, leadY = ball.y;
    const ballSpeed = Math.hypot(ball.vx || 0, ball.vy || 0);
    if (!ball.stickOffset && ballSpeed > 20) {
      const boost = spin && P.carveDriveBoost ? P.carveDriveBoost(body, spin) : 1;
      const tLead = Math.min(0.32, Math.hypot(ball.x - body.x, ball.y - body.y) / Math.max(180, P.launchSpeed(body) * boost));
      const friction = ball.friction ?? 85;
      const decel = friction + AIR_DRAG * ballSpeed * ballSpeed;
      const avgSpeed = Math.max(0, ballSpeed - 0.5 * decel * tLead);
      const leadDist = avgSpeed * tLead;
      let bux = (ball.vx || 0) / ballSpeed, buy = (ball.vy || 0) / ballSpeed;
      if (ball.omega && P.ballCurveFactor) {
        const bRot = ball.omega * P.ballCurveFactor(ball, Boolean(ball.onFire)) * tLead * 0.5;
        const bc = Math.cos(bRot), bs = Math.sin(bRot);
        const rx = bux * bc - buy * bs, ry = bux * bs + buy * bc;
        bux = rx; buy = ry;
      }
      leadX = Math.max(RINK_LEFT + 45, Math.min(RINK_RIGHT - 45, ball.x + bux * leadDist));
      leadY = Math.max(RINK_TOP + 45, Math.min(RINK_BOTTOM - 45, ball.y + buy * leadDist));
    }
    const d = Math.hypot(x - leadX, y - leadY) || 1;
    const effRadius = superKey === 'colossus' && body.superActive !== 'colossus'
      ? Math.max(body.baseRadius ?? body.radius, P.SUPER.colossusRadius)
      : body.radius;
    const contact = Math.max(effRadius, body.reach || effRadius, 18) + ball.radius - 1;
    let ux = (x - leadX) / d, uy = (y - leadY) / d;

    const clampedSpin = spin ? Math.max(-1, Math.min(1, spin)) : 0;
    if (clampedSpin) {
      // Pre-compensate contact normal for tangential grip kick + post-impact ball Magnus curve.
      const approxCx = leadX - ux * contact, approxCy = leadY - uy * contact;
      const appDist = Math.hypot(approxCx - body.x, approxCy - body.y);
      const { maxV, effFriction } = skaterDrive(body, superKey, clampedSpin);
      const strikeDrive = 1200;
      const v0 = Math.min(maxV, Math.sqrt(2 * effFriction * Math.max(0, appDist + strikeDrive)));
      const arc = integrateSpinArc(v0, effFriction, appDist, clampedSpin * (body.maxSpin || 15), body.curveFactor ?? SKATER_CURVE);
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
      if (appDist <= 4) {
        const small = (body.sizeMult || 1) ** (P.SIZE?.strike ?? 0);
        wBall = Math.max(-24, Math.min(24, wBall - clampedSpin * (body.maxSpin || 15) * (body.spinStrikeMult ?? 1) * small * 0.8));
      }
      const postSpeed = Math.max(160, Math.hypot(dvnB, dvtB));
      const ballFric = (ball.friction ?? 85) + AIR_DRAG * postSpeed * postSpeed * 0.6;
      const bCurveF = P.ballCurveFactor ? P.ballCurveFactor({ curveMult: body.curveMult ?? 1 }, false) : SKATER_CURVE * (body.curveMult ?? 1);
      const bPass1 = integrateSpinArc(postSpeed, ballFric, d, wBall, bCurveF);
      const bArc = integrateSpinArc(postSpeed, ballFric, d / bPass1.chordRatio, wBall, bCurveF);
      const ballDeflect = Math.atan2(dvtB, dvnB) + bArc.chordAngle;
      const c = Math.cos(-ballDeflect), sn = Math.sin(-ballDeflect);
      const rux = ux * c - uy * sn, ruy = ux * sn + uy * c;
      ux = rux; uy = ruy;
    }
    return aim(body, leadX - ux * contact, leadY - uy * contact, clampedSpin ? 1200 : 260, superKey, clampedSpin);
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
    const hasSuper = !M.rule(state.mode, 'classic') && body.meter >= 100 && Boolean(body.equippedSuper);
    const sKey = body.equippedSuper?.key?.toLowerCase() || null;
    const oppStart = (1 - team) * 3;
    const opponents = [state.bodies[oppStart], state.bodies[oppStart + 1], state.bodies[oppStart + 2]];
    const aperture = scanGoalAperture(ball, goal, opponents);
    const cone = shotConePoint(ball.x, ball.y, team, 88);
    const creaseWarned = Boolean(state.fouls?.crease?.[team]) && M.inCrease(P, body, team);

    function generateMoves(superArmKey) {
      const arm = Boolean(superArmKey);
      const moves = [];
      const extraShots = [];
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

      if (body.holding) {
        moves.push(tag(stickyCarryMove(body, ball, goal, aperture.y, superArmKey, 0), 'carry'));
        moves.push(tag(stickyCarryMove(body, ball, goal, RINK_CY - 48, superArmKey, 0.75), 'carry'));
        moves.push(tag(stickyCarryMove(body, ball, goal, RINK_CY + 48, superArmKey, -0.75), 'carry'));
      } else if (isBehind) {
        const yOrder = aperture.y === RINK_CY ? [RINK_CY, RINK_CY - 50, RINK_CY + 50]
          : (aperture.y < RINK_CY ? [RINK_CY - 50, RINK_CY, RINK_CY + 50] : [RINK_CY + 50, RINK_CY, RINK_CY - 50]);
        for (let yi = 0; yi < 3; yi++) {
          const y = yOrder[yi];
          const shot = strike(body, ball, goal, y, superArmKey, 0);
          moves.push(tag({ ...shot, superArm: arm }, 'shoot'));
          if (shot.power < 0.96) {
            if (yi === 0 || y === RINK_CY) moves.push(tag({ ...shot, power: 1, superArm: arm }, 'shoot'));
            else extraShots.push(tag({ ...shot, power: 1, superArm: arm }, 'shoot'));
          }
          if (yi === 0) extraShots.push(tag({ ...shot, power: shot.power * .75, superArm: arm }, 'shoot'));
        }
        for (const spin of [1, -1]) {
          moves.push(tag({ ...strike(body, ball, goal, RINK_CY, superArmKey, spin), superArm: arm }, 'shoot'));
        }
        const ballR = ball.radius || 18;
        const bankTopY = 2 * (RINK_TOP + ballR) - RINK_CY, bankBotY = 2 * (RINK_BOTTOM - ballR) - RINK_CY;
        for (const y of [bankTopY, bankBotY]) {
          const bank = strike(body, ball, goal, y, superArmKey, 0);
          moves.push(tag({ ...bank, power: Math.min(1, bank.power * 1.25), superArm: arm }, 'shoot'));
        }
        for (const spin of [0.55, -0.55]) {
          extraShots.push(tag({ ...strike(body, ball, goal, aperture.open ? aperture.y : RINK_CY, superArmKey, spin), superArm: arm }, 'shoot'));
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

      moves.push(tag({ ...aim(body, cone.x, cone.y, 0, superArmKey, 0), superArm: arm }, 'cover'));
      if (threat) {
        const check = aim(body, threat.x + (threat.vx || 0) * 0.15, threat.y + (threat.vy || 0) * 0.15, 180, superArmKey);
        moves.push(tag({ ...check, superArm: arm }, 'check'));
      }

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

      return moves;
    }

    const unarmedMoves = generateMoves(null);
    const cleanBase = creaseWarned && base && (!base.power || base.guard) ? unarmedMoves[0] : base;
    if (!hasSuper) {
      return [unarmedMoves[0], unarmedMoves[1], cleanBase, ...unarmedMoves.slice(2)];
    }
    const armedMoves = generateMoves(sKey);
    const moves = [unarmedMoves[0], unarmedMoves[1], cleanBase];
    if (armedMoves[1]?.superArm) moves.push(armedMoves[1]);
    const prioCheck = (sKey === 'knockout' || sKey === 'shockwave')
      ? armedMoves.find(m => getIntent(m) === 'check')
      : null;
    if (prioCheck) moves.push(prioCheck);
    const maxLen = Math.max(unarmedMoves.length, armedMoves.length);
    for (let k = 2; k < maxLen; k++) {
      if (unarmedMoves[k]) moves.push(unarmedMoves[k]);
      if (armedMoves[k] && armedMoves[k] !== prioCheck) moves.push(armedMoves[k]);
    }
    return moves;
  }

  function place3(i0, m0, i1, m1, i2, m2) {
    const out = new Array(3);
    out[i0] = m0; out[i1] = m1; out[i2] = m2;
    return out;
  }

  // Coordinated 3-skater plays (Sticky escort drive, Screen-breaker check+shot, Snap one-timers, Pack-Draft breakaways)
  function jointTeamPlays(state, team, currentBest, jobs) {
    const ownStart = team * 3, oppStart = (1 - team) * 3;
    const ball = state.bodies[6];
    const classic = M.rule(state.mode, 'classic');
    const atkGoal = team ? RINK_LEFT : RINK_RIGHT, ownGoal = RINK_LEFT + RINK_RIGHT - atkGoal;
    const opponents = [state.bodies[oppStart], state.bodies[oppStart + 1], state.bodies[oppStart + 2]];
    const aperture = scanGoalAperture(ball, atkGoal, opponents);
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

    const smartCover = defBody.stunned ? HOLD
      : (state.fouls?.crease?.[team] && M.inCrease(P, defBody, team))
        ? tag(aim(defBody, ownGoal + (team ? -102 : 102), defBody.y < RINK_CY ? RINK_CY - 55 : RINK_CY + 55, 35, null, 0), 'cover')
        : tag(aim(defBody, cone.x, cone.y, 0, null, 0), 'cover');

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

    // 2. Screen-Breaker Check + Simultaneous Sniper Shot when direct lane is screened
    const screenBlk = aperture.blocker || segmentBlocked(ball.x, ball.y, atkGoal, RINK_CY, opponents, 26);
    if (screenBlk && !atkBody.stunned && !atkBody.holding && behindBall(atkBody, ball, team) && !supBody.stunned) {
      const targetOp = screenBlk.body, supS = superOf(supIdx), atkS = superOf(atkIdx);
      const armBreak = (supS === 'knockout' || supS === 'shockwave' || supS === 'colossus') ? supS : null;
      const checkMv = aim(supBody, targetOp.x + (targetOp.vx || 0) * 0.12, targetOp.y + (targetOp.vy || 0) * 0.12, 240, armBreak, 0);
      if (armBreak) checkMv.superArm = true;
      const armShot = (atkS === 'cannonball' || atkS === 'ghost' || atkS === 'sticky') ? atkS : null;
      const laneY = targetOp.y >= RINK_CY ? RINK_CY - 46 : RINK_CY + 46;
      const laneShot = strike(atkBody, ball, atkGoal, laneY, armShot, screenBlk.side * 0.6);
      if (armShot) laneShot.superArm = true;
      plays.push(place3(defIdx, smartCover, atkIdx, tag(laneShot, 'shoot'), supIdx, tag(checkMv, 'check')));
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
          const passMove = strike(sender, ball, snapX, snapY, null, 0);
          const vSend0 = Math.max(120, passMove.power * P.launchSpeed(sender));
          const dSend = Math.max(0, Math.hypot(ball.x - sender.x, ball.y - sender.y) - sender.radius - ball.radius + 1);
          const vImp = Math.sqrt(Math.max(6400, vSend0 * vSend0 - 2 * sender.friction * dSend));
          const tSend = sender.friction > 0 ? Math.max(0, (vSend0 - vImp) / sender.friction) : dSend / vSend0;
          const mP = sender.mass || 3, mB = ball.mass || 1;
          const vPass0 = Math.max(180, Math.min((2 * mP / (mP + mB)) * vImp, (1.88 / (1 / mP + 1 / mB)) * (sender.power || 1) * vImp));
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

  const slideX = new Float64Array(6), slideY = new Float64Array(6);

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
    const ball = bodies[6];

    // 1. Project skater stopping coordinates on truncated Standard/Classic rollouts
    let carrierIdx = -1;
    for (let i = 0; i < 6; i++) {
      const b = bodies[i];
      if (b.holding && !b.carded && carrierIdx < 0) carrierIdx = i;
      const vx = b.vx || 0, vy = b.vy || 0;
      if (coastActive && !b.carded && (vx !== 0 || vy !== 0)) {
        const sp = Math.sqrt(vx * vx + vy * vy);
        const fMult = b.holding ? (P.SUPER.carryFriction ?? 1.5)
          : (b.superActive === 'stalwart' ? (P.SUPER.stalwartFriction ?? 3) : 1.0);
        const slideD = Math.min(180, (sp * sp) / (2 * (b.friction ?? 150) * fMult));
        const nx = b.x + (vx / sp) * slideD;
        const ny = b.y + (vy / sp) * slideD;
        slideX[i] = nx < RINK_LEFT + 25 ? RINK_LEFT + 25 : (nx > RINK_RIGHT - 25 ? RINK_RIGHT - 25 : nx);
        slideY[i] = ny < RINK_TOP + 25 ? RINK_TOP + 25 : (ny > RINK_BOTTOM - 25 ? RINK_BOTTOM - 25 : ny);
      } else {
        slideX[i] = b.x;
        slideY[i] = b.y;
      }
    }

    // 2. Project 4-step curved ball coast on truncated rollouts (field-position look-ahead without distorting settled anchor)
    const bx = ball.x, by = ball.y;
    const bvx0 = ball.vx || 0, bvy0 = ball.vy || 0;
    let coastDx = 0;
    if (carrierIdx >= 0) {
      coastDx = (slideX[carrierIdx] - bodies[carrierIdx].x) * 0.35;
    } else if (coastActive && (bvx0 * bvx0 + bvy0 * bvy0 > 400)) {
      let cx = bx, cy = by, cvx = bvx0, cvy = bvy0, cw = ball.omega || 0;
      const bFric = ball.friction ?? 85;
      const bSpd0 = Math.sqrt(cvx * cvx + cvy * cvy);
      const totalT = Math.min(0.65, bSpd0 / (bFric + AIR_DRAG * bSpd0 * bSpd0 * 0.5));
      const dtC = totalT * 0.25;
      const bCurve = ((ball.onFire ? P.BURNING_BALL_CURVE : P.BALL_CURVE) ?? 0.06) * (ball.curveMult ?? 1);
      const ballR = ball.radius || 18;
      const xMin = RINK_LEFT + ballR, xMax = RINK_RIGHT - ballR;
      const yMin = RINK_TOP + ballR, yMax = RINK_BOTTOM - ballR;
      const gOpenTop = GOAL_Y_TOP + ballR - 2, gOpenBot = GOAL_Y_BOT - ballR + 2;
      for (let s = 0; s < 4 && dtC > 1e-4; s++) {
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
        cx += ux * midSpd * stepT;
        cy += uy * midSpd * stepT;
        if (cy < yMin) { cy = 2 * yMin - cy; cvy = -cvy * WALL_RESTITUTION; cw *= 0.5; }
        else if (cy > yMax) { cy = 2 * yMax - cy; cvy = -cvy * WALL_RESTITUTION; cw *= 0.5; }
        if (cx < xMin && (cy <= gOpenTop || cy >= gOpenBot)) { cx = 2 * xMin - cx; cvx = -cvx * WALL_RESTITUTION; }
        else if (cx > xMax && (cy <= gOpenTop || cy >= gOpenBot)) { cx = 2 * xMax - cx; cvx = -cvx * WALL_RESTITUTION; }
        cx = Math.max(RINK_LEFT - 5, Math.min(RINK_RIGHT + 5, cx));
      }
      coastDx = (cx - bx) * 0.25;
    }

    const ownStart = team * 3, otherStart = (1 - team) * 3;
    const dir = team ? -1 : 1, ownGoalX = team ? RINK_RIGHT : RINK_LEFT, oppGoalX = RINK_LEFT + RINK_RIGHT - ownGoalX;
    const covX = ownGoalX + dir * 88;

    let accOwn = Infinity, accOther = Infinity, cov = Infinity;
    let mDiff = 0, cDiff = 0, sDiff = 0, dDiff = 0;

    for (let k = 0; k < 3; k++) {
      const ob = bodies[ownStart + k];
      const ao = Math.hypot(ob.x - bx, ob.y - by) + (ob.stunned ? 250 : 0);
      if (ao < accOwn) accOwn = ao;
      const cv = Math.hypot(ob.x - covX, ob.y - RINK_CY);
      if (cv < cov) cov = cv;
      mDiff += ob.meter || 0;
      if (ob.carded) cDiff++;
      else if (ob.stunned || ob.stunnedNext) sDiff--;
      const d1 = ob.daze || 0;
      if (d1 > DAZE_F) dDiff -= (d1 - DAZE_F) / (DAZE_M - DAZE_F) * DAZE_M;

      const tb = bodies[otherStart + k];
      const ae = Math.hypot(tb.x - bx, tb.y - by) + (tb.stunned ? 250 : 0);
      if (ae < accOther) accOther = ae;
      mDiff -= tb.meter || 0;
      if (tb.carded) cDiff--;
      else if (tb.stunned || tb.stunnedNext) sDiff++;
      const d2 = tb.daze || 0;
      if (d2 > DAZE_F) dDiff += (d2 - DAZE_F) / (DAZE_M - DAZE_F) * DAZE_M;
    }

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
        ? (38 + 24 * (1 - Math.abs(oppGoalX - bx) / RINK_SPAN))
        : -(42 + 26 * (1 - Math.abs(ownGoalX - bx) / RINK_SPAN));
    }

    const crease0 = fouls?.crease?.[0] ? 1 : 0, crease1 = fouls?.crease?.[1] ? 1 : 0;
    const warned = (team ? crease1 - crease0 : crease0 - crease1);
    const dazes = dDiff / DAZE_M;
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

    return dir * (bx + coastDx - RINK_CX) * weights.progress +
      (accOther - accOwn) * weights.access -
      cov * weights.cover +
      mDiff * weights.meter -
      cDiff * weights.card -
      (warned + stall) * weights.warning +
      sDiff * (weights.stun ?? 185) +
      dazes * (weights.daze ?? 120) +
      postFoul + stickyBonus;
  }

  function evaluate(state, team, goal, weights, complexity = 0, scorer = null, teamTouches = false, tmw = 0.5) {
    const isPulse = state.mode ? M.rule(state.mode, 'pulse') : false;
    return evaluateBodies(state.bodies, state.fouls, team, goal, weights, complexity, scorer, teamTouches, tmw, false, isPulse);
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

    const guardOpponents = [
      state.bodies[oppStart].stunned ? HOLD : GUARD,
      state.bodies[oppStart + 1].stunned ? HOLD : GUARD,
      state.bodies[oppStart + 2].stunned ? HOLD : GUARD
    ];
    if (count === 2) return [opponent, guardOpponents];

    // 3rd opponent scenario (Hard+): open-aperture sniper + striker body-check blitz
    const oppGoal = team ? RINK_RIGHT : RINK_LEFT;
    const ownBodies = [state.bodies[ownStart], state.bodies[ownStart + 1], state.bodies[ownStart + 2]];
    const oppAp = scanGoalAperture(ball, oppGoal, ownBodies);
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
      } else if (oppJobs[k] === 'attack' && behindBall(b, ball, oppTeam)) {
        const armA = (oppSup === 'cannonball' || oppSup === 'sticky' || oppSup === 'ghost' || oppSup === 'magnet') ? oppSup : null;
        const mv = strike(b, ball, oppGoal, oppAp.y, armA, oppAp.blocker ? oppAp.blocker.side * 0.7 : 0);
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

    // 4th opponent scenario (Insane & Ububall God): multi-attacker direct rush + goal-mouth cover
    const oppOwnGoal = team ? RINK_LEFT : RINK_RIGHT;
    const oppCoverX = oppOwnGoal + (oppTeam ? -88 : 88);
    const attack = new Array(3);
    for (let k = 0; k < 3; k++) {
      const b = state.bodies[oppStart + k];
      if (b.stunned) {
        attack[k] = HOLD;
      } else {
        const oppSuper = !classic && b.meter >= 100 && b.equippedSuper ? b.equippedSuper.key?.toLowerCase() : null;
        const armAtk = oppSuper === 'cannonball' || oppSuper === 'colossus' || oppSuper === 'sticky' || oppSuper === 'ghost' || oppSuper === 'magnet';
        if (b.holding) {
          attack[k] = stickyCarryMove(b, ball, oppGoal, RINK_CY, null, 0);
        } else if (behindBall(b, ball, oppTeam)) {
          const mv = strike(b, ball, oppGoal, RINK_CY, armAtk ? oppSuper : null, 0);
          if (armAtk) mv.superArm = true;
          attack[k] = mv;
        } else {
          const armDef = oppSuper === 'stalwart' || oppSuper === 'colossus' || oppSuper === 'shockwave';
          const mv = aim(b, oppCoverX, RINK_CY, 0, armDef ? oppSuper : null, 0);
          if (armDef) mv.superArm = true;
          attack[k] = mv;
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
        (settings.searchTicks !== undefined && (!Number.isInteger(settings.searchTicks) || settings.searchTicks < 30 || settings.searchTicks > 2880)) ||
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
    const startCreaseWarned = Boolean(state.fouls?.crease?.[team]);
    const jobs = roles(state, team);
    const primaryAtkIdx = jobs.indexOf('attack');
    const responses = buildOpponentResponses(state, team, classic, settings.opponents);
    const respCount = responses.length;
    const pulse = M.rule(state.mode, 'pulse');
    const fullTurnTicks = M.turnTicks(state.mode);
    const baseHorizon = settings.searchTicks || SEARCH_TICKS;
    const searchTicks = startCreaseWarned ? fullTurnTicks : baseHorizon;

    const results = new Map();
    const activeMasks = new Map();
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

    function runRollout(moves, response) {
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
      const partial = !hitDec && result.replay.goal === null && ticksDone < fullTurnTicks && !P.settled(result.state.bodies);
      const val = evaluateBodies(result.state.bodies, result.state.fouls, team, result.replay.goal, weights, boards + Math.max(0, touches - 1), toucher, multiTeamTouch, tmw, partial, pulse);
      return { val, ticksDone, activeMask: aMask };
    }

    function planKey(moves, r) {
      const id0 = getMoveId(moves[0]), id1 = getMoveId(moves[1]), id2 = getMoveId(moves[2]);
      return r + 8 * (id0 + 4096 * (id1 + 4096 * id2));
    }

    function simulate(moves, response, r) {
      const key = planKey(moves, r);
      let cached = results.get(key);
      if (cached === undefined) {
        const out = runRollout(moves, response);
        cached = out.val;
        results.set(key, cached);
        activeMasks.set(key, out.activeMask);
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

    const scored = [], finalists = [];
    const useScreenTop = Number.isInteger(settings.screenTop) && respCount > 1;
    const maxGoal = weights.goal * 1.006;
    const pruneMargin = Math.max(8, 1.8 * settings.temperature);
    let nearWobbles = 0;
    let bestScore = -Infinity;
    let bestR0 = -Infinity;
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
      if (respCount === 1) {
        evaluated++;
        let val1 = r0WithFit;
        if (settings.wobble !== false && (bestScore === -Infinity || val1 >= bestScore - 10)) {
          val1 = (v0 + simulate(wobble(moves, 1), responses[0], 0) + simulate(wobble(moves, -1), responses[0], 0)) / 3 + fit * weights.role;
        }
        scored.push({ moves, value: val1 });
        return { value: val1, r0: r0WithFit, avg01: val1 };
      }

      if (v0 <= -weights.goal * 0.85 && bestScore > -weights.goal * 0.5) {
        evaluated++;
        return { value: r0WithFit, r0: r0WithFit, avg01: r0WithFit };
      }
      const cleanGoalLocked = bestScore >= weights.goal * 0.995;
      if (cleanGoalLocked && r0WithFit <= bestScore + 0.25) {
        evaluated++;
        return { value: r0WithFit, r0: r0WithFit, avg01: r0WithFit };
      }
      if (bestScore > -Infinity && v0 < 5000) {
        const r0Ref = Math.min(bestScore, bestR0);
        const r0Gate = (primaryStrike && bestScore < 2000) ? 450 : 120;
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
      let preVal = (sumSoFar / respCount) * (1 - settings.risk) + minSoFar * settings.risk + fit * weights.role;
      if (v0 <= -weights.goal * 0.85) {
        preVal = Math.min(preVal, -weights.goal * 0.65 + fit * weights.role);
      }

      const isChallenger = bestScore === -Infinity || preVal > bestScore + 0.1;
      const isNearTie = !cleanGoalLocked && nearWobbles < 1 && preVal >= bestScore - Math.max(3, settings.temperature);
      if (settings.wobble !== false && (isChallenger || isNearTie)) {
        if (!isChallenger) nearWobbles++;
        const wPos = simulate(wobble(moves, 1), responses[0], 0);
        const wNeg = simulate(wobble(moves, -1), responses[0], 0);
        if (values[0] > -weights.goal * 0.5 && (wPos <= -weights.goal * 0.85 || wNeg <= -weights.goal * 0.85)) {
          values[0] = Math.min((values[0] + wPos + wNeg) / 3, -3500);
        } else {
          values[0] = (values[0] + wPos + wNeg) / 3;
        }
        if (settings.godWobble && respCount >= 3) {
          const gwPos = simulate(wobble(moves, 1), responses[2], 2);
          const gwNeg = simulate(wobble(moves, -1), responses[2], 2);
          values[2] = (values[2] + gwPos + gwNeg) / 3;
        }
        let s2 = 0, m2 = Infinity;
        for (let r = 0; r < respCount; r++) { s2 += values[r]; if (values[r] < m2) m2 = values[r]; }
        let finalVal = (s2 / respCount) * (1 - settings.risk) + m2 * settings.risk + fit * weights.role;
        if (values[0] <= -weights.goal * 0.85) finalVal = Math.min(finalVal, -weights.goal * 0.65 + fit * weights.role);
        const wAvg01 = 0.5 * (values[0] + values[1]) * (1 - settings.risk) + Math.min(values[0], values[1]) * settings.risk + fit * weights.role;
        scored.push({ moves, value: finalVal });
        return { value: finalVal, r0: values[0] + fit * weights.role, avg01: wAvg01 };
      }
      scored.push({ moves, value: preVal });
      return { value: preVal, r0: r0WithFit, avg01: candAvg01 };
    }

    // 1. Seed plan (legacy heuristic — preserves candidates:1 parity)
    const seenPlans = new Set();
    seenPlans.add(planKey(best, 0));
    const seedRes = score(best, true);
    bestScore = seedRes.value;
    bestR0 = seedRes.r0;
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
          consider(next, i === primaryAtkIdx && j <= 10 && (intent === 'shoot' || intent === 'carry'));
        }
      }
    }

    // 3. Coordinated 3-player plays (Snap one-timers, Screen-Breaker check+shot, Sticky escort, Pack-Draft rush)
    if (evaluated < settings.candidates * 0.68) {
      const joint = jointTeamPlays(state, team, best, jobs);
      for (let jp = 0; jp < joint.length && evaluated < settings.candidates * 0.68; jp++) {
        consider(joint[jp], jp < 5);
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
      let actLen = 0, fbLen = 0;
      for (let idx = 0; idx < 3; idx++) {
        if (!state.bodies[ownStart + idx].stunned && !next[idx].guard) {
          fallbackBuf[fbLen++] = idx;
          if ((mask & (1 << idx)) && next[idx].power > 0) activeBuf[actLen++] = idx;
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
        let v0 = cand.v0;
        if (settings.wobble !== false) {
          v0 = (v0 + simulate(wobble(cand.moves, 1), responses[0], 0) + simulate(wobble(cand.moves, -1), responses[0], 0)) / 3;
        }
        let s = v0, m = v0;
        for (let r = 1; r < respCount; r++) {
          let vr = simulate(cand.moves, responses[r], r);
          if (settings.godWobble && r === 2) {
            vr = (vr + simulate(wobble(cand.moves, 1), responses[2], 2) + simulate(wobble(cand.moves, -1), responses[2], 2)) / 3;
          }
          s += vr;
          if (vr < m) m = vr;
        }
        const value = (s / respCount) * (1 - settings.risk) + m * settings.risk + cand.fit * weights.role;
        scored.push({ moves: cand.moves, value, basin: cand.basin });
      }
    }

    const chosen = choose(scored, settings.temperature, random);
    return {
      plans: M.validatePlans(chosen.moves),
      diagnostics: { level, candidates: evaluated, simulations, ticks, score: chosen.value, milliseconds: performance.now() - started }
    };
  }

  function choose(scored, temperature, random) {
    const byBasin = new Map();
    for (let s = 0; s < scored.length; s++) {
      const entry = scored[s];
      const key = entry.basin || planBasinKey(entry.moves);
      const prev = byBasin.get(key);
      if (!prev || entry.value > prev.value) byBasin.set(key, entry);
    }
    const pool = byBasin.size > 0 ? Array.from(byBasin.values()) : scored;
    const nPool = pool.length;
    let top = -Infinity, topIdx = 0;
    for (let s = 0; s < nPool; s++) {
      if (pool[s].value > top) { top = pool[s].value; topIdx = s; }
    }
    if (temperature <= 0.25 || nPool === 1) return pool[topIdx];

    const wArr = new Float64Array(nPool);
    let wSum = 0;
    for (let s = 0; s < nPool; s++) {
      const diff = (pool[s].value - top) / temperature;
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
    randomSource, legacy, decided, plan, aim, strike, behindBall, isPointBlank, evaluate, options,
    segmentBlocked, cpuPlans, baseline: cpuPlans, shotConePoint, scanGoalAperture, jointTeamPlays
  };
  if (node) module.exports = api; else root.ububallCPU = api;
})(globalThis);
