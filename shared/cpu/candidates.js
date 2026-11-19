/* Single-skater tactical options, coordinated 3-player plays, role assignment, and wobble. */
'use strict';
const { P, M, HOLD, GUARD, WOBBLE, RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, RINK_CX, RINK_CY, GOAL_Y_TOP, GOAL_Y_BOT, SHOT_DRIVE, segmentBlocked, behindBall, isPointBlank, tag, getIntent } = require('./constants.js');
const { aim, strike } = require('./kinematics.js');
const { aimInTime, estShotArrival, shotConePoint, canOccupyCrease, goalPocketPoint, timedGoalieIntercept, guardCoversSegment, assessOpponentThreat, scanGoalAperture, stickyCarryMove, rimAroundMove } = require('./threat.js');

function options(state, team, index, base) {
  const body = state.bodies[team * 3 + index], ball = state.bodies[6];
  if (body.stunned || body.carded) return [HOLD];
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
  let minDefD = Infinity;
  for (let k = 0; k < 3; k++) {
    const tb = state.bodies[team * 3 + k];
    if (!tb.carded && !tb.stunned) {
      const dk = Math.abs(tb.x - ownGoal);
      if (dk < minDefD) minDefD = dk;
    }
  }
  const isDefSkater = Math.abs(body.x - ownGoal) <= minDefD + 35;
  const creaseWarned = Boolean(state.fouls?.crease?.[team]) && M.inCrease(P, body, team);
  const defPriority = isDefSkater && (threatInfo.shotDanger || Math.abs(ball.x - ownGoal) < 440);
  const skipGoalieOffense = isDefSkater && !body.holding && threatInfo.shotDanger && (threatInfo.oppFirstToBall || dBall > 115);

  function generateMoves(superArmKey) {
    const arm = Boolean(superArmKey);
    const moves = [];
    const extraShots = [];
    const specialSupers = [];
    const defMoves = [];
    if (creaseWarned) {
      const exitX = ownGoal + (team ? -102 : 102);
      // Even when warned, keep GUARD available during live shotDanger so the CPU can prevent a -10,000 goal over a -400 card.
      if (threatInfo.shotDanger) {
        moves.push(tag({ ...GUARD, superArm: arm && superArmKey === 'stalwart' }, 'guard'));
      }
      for (const exitY of [RINK_CY, RINK_CY - 55, RINK_CY + 55]) {
        moves.push(tag({ ...aim(body, exitX, exitY, 35, superArmKey, 0), superArm: arm }, 'cover'));
      }
      if (!threatInfo.shotDanger && arm && superArmKey === 'stalwart') {
        moves.push(tag({ ...GUARD, superArm: true }, 'guard'));
      }
    } else {
      moves.push(tag({ ...HOLD, superArm: false }, 'hold'));
      moves.push(tag({ ...GUARD, superArm: arm && superArmKey === 'stalwart' }, 'guard'));
    }

    // Build goalie / defensive positioning & save candidates first so defending skaters always test saves early.
    const canPocketNow = allowPocket || (arm && superArmKey === 'stalwart');
    if (incoming && incoming.crosses) {
      const tReach = Math.hypot(body.x - incoming.lineX, body.y - incoming.lineY) / Math.max(180, P.launchSpeed(body));
      if (tReach <= incoming.time + 0.30 || isDefSkater) {
        const timedMv = timedGoalieIntercept(body, ball, incoming, team, canPocketNow || !creaseWarned, superArmKey);
        defMoves.push(tag({ ...timedMv, superArm: arm }, 'cover'));
        const lineX = (canPocketNow || threatInfo.shotDanger) ? incoming.lineX : cone.x;
        const lineDist = Math.hypot(body.x - lineX, body.y - incoming.lineY);
        const lineDrive = lineDist > 52 ? 160 : 0;
        defMoves.push(tag({ ...aim(body, lineX, incoming.lineY, lineDrive, superArmKey, 0), superArm: arm }, 'cover'));
        defMoves.push(tag({ ...aim(body, incoming.midX, incoming.midY, 90, superArmKey, 0), superArm: arm }, 'cover'));
      }
    }

    if (isDefSkater && (threatInfo.shotDanger || defPriority)) {
      const saveX = (canPocketNow || (creaseWarned && threatInfo.shotDanger)) ? (ownGoal + (team ? -44 : 44)) : cone.x;
      if (canPocketNow || (creaseWarned && threatInfo.shotDanger)) {
        const pkt = goalPocketPoint(ball.x, ball.y, team, true);
        // Constant-glide (~120 px) pocket slide: crisp (~0.28s) on lateral shifts without slamming into the back net on retreats.
        defMoves.push(tag({ ...aim(body, pkt.x, pkt.y, threatInfo.shotDanger ? 120 : 0, superArmKey, 0), superArm: arm }, 'cover'));
        if (threatInfo.shotDanger) {
          // Centered deep crease anchor (deduplicated against pkt): seals wall-bank angles & dual-corner snipes.
          if (Math.abs(pkt.y - RINK_CY) > 8) {
            defMoves.push(tag({ ...aim(body, saveX, RINK_CY, 120, superArmKey, 0), superArm: arm }, 'cover'));
          }
          // Bank-corridor / near-side post seal placed early so Medium+ sweeps & keepDef always evaluate it.
          if (Math.abs(ball.y - RINK_CY) > 45) {
            const bankSealY = ball.y < RINK_CY ? GOAL_Y_TOP + 22 : GOAL_Y_BOT - 22;
            defMoves.push(tag({ ...aim(body, saveX, bankSealY, 95, superArmKey, 0), superArm: arm }, 'cover'));
          }
        }
        if (Math.hypot(body.x - saveX, body.y - RINK_CY) > 22) {
          defMoves.push(tag({ ...aim(body, saveX, RINK_CY, 0, superArmKey, 0), superArm: arm }, 'cover'));
        }
      }
      defMoves.push(tag({ ...aim(body, cone.x, cone.y, threatInfo.shotDanger ? 120 : 0, superArmKey, 0), superArm: arm }, 'cover'));
      if (threatInfo.shotDanger) {
        const farCornerY = body.y >= RINK_CY ? GOAL_Y_TOP + 26 : GOAL_Y_BOT - 26;
        const farDist = Math.hypot(body.x - saveX, body.y - farCornerY);
        defMoves.push(tag({ ...aim(body, saveX, farCornerY, 150, superArmKey, 0), superArm: arm }, 'cover'));
        if (farDist > 58) {
          const farDive = aim(body, saveX, farCornerY, 260, superArmKey, 0);
          farDive.power = Math.max(farDive.power, 0.90);
          defMoves.push(tag({ ...farDive, superArm: arm }, 'cover'));
        }
        // Slide-through save that exits a warned crease while crossing the shot line.
        if (creaseWarned) {
          const exitX = ownGoal + (team ? -98 : 98);
          const slideY = Math.max(GOAL_Y_TOP + 16, Math.min(GOAL_Y_BOT - 16, RINK_CY + (ball.y - RINK_CY) * 0.25));
          defMoves.push(tag({ ...aim(body, exitX, slideY, 90, superArmKey, 0), superArm: arm }, 'cover'));
        }
      }
    } else {
      defMoves.push(tag({ ...aim(body, cone.x, cone.y, 0, superArmKey, 0), superArm: arm }, 'cover'));
    }

    if (defPriority) {
      for (let di = 0; di < defMoves.length; di++) moves.push(defMoves[di]);
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
    } else if (isBehind && !skipGoalieOffense) {
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
      if (!aperture.open && aperture.blocker && !onWing && (body.curveMult ?? 1) >= 1.32 && (body.maxSpin ?? 20) >= 25) {
        const openSideSign = aperture.blocker.body.y >= RINK_CY ? -1 : 1;
        const widePostY = openSideSign < 0 ? GOAL_Y_TOP - 80 : GOAL_Y_BOT + 80;
        const wideBend = strike(body, ball, goal, widePostY, superArmKey, -openSideSign * (team ? 1 : -1), SHOT_DRIVE);
        wideBend.power = 1;
        moves.push(tag({ ...wideBend, superArm: arm }, 'shoot'));
      }
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

      // Glancing shoulder fireball overpower against un-guarded blockers when screened
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
    } else if (!skipGoalieOffense) {
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

    if (!defPriority) {
      if (incoming && incoming.crosses && defMoves.length) {
        moves.unshift(defMoves[0]);
        for (let di = 1; di < defMoves.length; di++) moves.push(defMoves[di]);
      } else {
        for (let di = 0; di < defMoves.length; di++) moves.push(defMoves[di]);
      }
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
  const boostBase = !creaseWarned && isBehind && !skipGoalieOffense && !body.holding && aperture.open && Math.abs(ball.x - goal) < 560 && base && !base.guard && base.power > 0.35
    ? { ...base, power: Math.max(base.power, 0.96) }
    : base;
  const cleanBase = creaseWarned && !threatInfo.shotDanger && base && (!base.power || base.guard) ? unarmedMoves[0] : boostBase;
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
  const smartCover = (defBody.stunned || defBody.carded) ? HOLD
    : (state.fouls?.crease?.[team] && M.inCrease(P, defBody, team) && !threatInfo.shotDanger)
      ? tag(aim(defBody, ownGoal + (team ? -102 : 102), defBody.y < RINK_CY ? RINK_CY - 55 : RINK_CY + 55, 35, null, 0), 'cover')
      : (defAllowPocket && Math.hypot(defBody.x - defPocket.x, defBody.y - defPocket.y) < 18 && Math.hypot(defBody.vx || 0, defBody.vy || 0) < 35)
        ? tag({ ...GUARD, superArm: false }, 'guard')
        : tag(aim(defBody, defPocket.x, defPocket.y, 0, null, 0), 'cover');

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
        : (useDeepPocket ? goalPocketPoint(ball.x, ball.y, team, saverAllowPocket) : refGoalPt);

      let disruptIdx = -1, bestDisD = Infinity;
      for (let i = 0; i < 3; i++) {
        if (i === saverIdx || ownBodies[i].stunned || ownBodies[i].carded) continue;
        const refX = oppThreat ? oppThreat.x : ball.x, refY = oppThreat ? oppThreat.y : ball.y;
        const d = Math.hypot(ownBodies[i].x - refX, ownBodies[i].y - refY);
        if (d < bestDisD) { bestDisD = d; disruptIdx = i; }
      }

      const closeGoalThreat = Math.abs(ball.x - ownGoal) < 420 || Boolean(oppCarrier || incoming || threatInfo.fireballThreat);
      const saverWarned = Boolean(state.fouls?.crease?.[team]) && M.inCrease(P, saverB, team);
      const ballR = ball.radius || 18;
      const coversShotInGuard = (!saverWarned || threatInfo.shotDanger) && Math.hypot(saverB.vx || 0, saverB.vy || 0) < 55 && (
        (Math.hypot(saverB.x - pocketTarget.x, saverB.y - pocketTarget.y) < 22) ||
        (Math.hypot(saverB.x - cone.x, saverB.y - cone.y) < 22) ||
        (threatInfo.fireballThreat && (
          guardCoversSegment(saverB, ball.x, ball.y, ownGoal, RINK_CY, ballR, 0) ||
          guardCoversSegment(saverB, ball.x, ball.y, ownGoal, oppAperture.y, ballR, 0)
        ))
      );

      let saveMv;
      if (incoming && incoming.crosses) {
        const armSave = closeGoalThreat && (saverS === 'stalwart' || saverS === 'colossus') ? saverS : null;
        const rawInc = timedGoalieIntercept(saverB, ball, incoming, team, saverAllowPocket || threatInfo.shotDanger, armSave);
        if (armSave) rawInc.superArm = true;
        saveMv = tag(rawInc, 'cover');
      } else if (coversShotInGuard) {
        saveMv = tag({ ...GUARD, superArm: Boolean(closeGoalThreat && saverS === 'stalwart') }, 'guard');
      } else {
        const armSave = closeGoalThreat && (saverS === 'stalwart' || saverS === 'colossus') ? saverS : null;
        const rawSave = aim(saverB, pocketTarget.x, pocketTarget.y, threatInfo.shotDanger ? 120 : 0, armSave, 0);
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

module.exports = { options, place3, jointTeamPlays, wobble };
