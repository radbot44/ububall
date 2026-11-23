/* Spin-arc integration, moving-ball rebound tracing, and exact scalar point-of-contact shot solver. */
'use strict';
const {
  P, TWO_PI, RINK, RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, RINK_CY,
  GOAL_Y_TOP, GOAL_Y_BOT, SKATER_CURVE, SPIN_DECAY, AIR_DRAG, skaterDrive
} = require('./constants.js');

const CORNER_R = RINK.corner ?? 100;
const BALL_CURVE_COLD = P?.ballCurveFactor ? P.ballCurveFactor({ curveMult: 1 }, false) : 0.06;
const BALL_CURVE_FIRE = P?.ballCurveFactor ? P.ballCurveFactor({ curveMult: 1 }, true) : 0.08;
const WALL_REST = P?.SURFACES?.wall?.restitution ?? 0.82;
const WALL_SPIN_KEEP = P?.SURFACES?.wall?.spinKeep ?? 0.5;
const POKE_TIP_MIN = P?.SWEET_SPOT?.pokeTipMin ?? 0.86;
const HEAT_FIRE = P?.HEAT?.fire ?? (840 / 720);
const HEAT_SUSTAIN = P?.HEAT?.sustain ?? 0.70;
const FIRE_TICKS = P?.FIRE_TICKS ?? 60;
const BASE_SPD = P?.BASE_LAUNCH_SPEED ?? 720;

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

function wrapSignedAngle(a) {
  let r = (a + Math.PI) % TWO_PI;
  if (r < 0) r += TWO_PI;
  return r - Math.PI;
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
  const approxCx = leadX - ux * contact, approxCy = leadY - uy * contact;
  const appDx = approxCx - body.x, appDy = approxCy - body.y;
  const appDist = Math.hypot(appDx, appDy);
  const chordDir = appDist > 1e-4 ? Math.atan2(appDy, appDx) : Math.atan2(uy, ux);
  const normDir = Math.atan2(uy, ux);
  const approachSkew = wrapSignedAngle(chordDir - normDir);

  if (clampedSpin || prox > 0 || Math.abs(approachSkew) > 0.04) {
    // Pre-compensate contact normal for approach skew, tangential grip kick, spinStrike/closeSpin, strikeBoost & Magnus curve.
    const { maxV, effFriction } = skaterDrive(body, superKey, clampedSpin);
    const strikeDrive = clampedSpin ? Math.max(1200, effDrive) : effDrive;
    const v0 = Math.min(maxV, Math.sqrt(2 * effFriction * Math.max(0, appDist + strikeDrive)));
    const arc = clampedSpin
      ? integrateSpinArc(v0, effFriction, appDist, clampedSpin * (body.maxSpin || P.BASE_MAX_SPIN || 20), body.curveFactor ?? SKATER_CURVE)
      : { chordAngle: 0, endTheta: 0, endSpeed: Math.sqrt(Math.max(0, v0 * v0 - 2 * effFriction * appDist)), endOmega: body.omega || 0 };
    const vImp = Math.max(80, arc.endSpeed);
    const clampedSkew = Math.max(-1.05, Math.min(1.05, wrapSignedAngle(approachSkew + arc.endTheta - arc.chordAngle)));
    const vn = Math.max(40, vImp * Math.cos(clampedSkew)), vt = vImp * Math.sin(clampedSkew);
    const mP = body.mass || 3, mB = ball.mass || 1, invSum = 1 / mP + 1 / mB;
    const rest = 0.88;
    const baseImp = (1 + rest) * vn / invSum;
    const elasticCap = (2 * mP / (mP + mB)) * vn;
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
    const burning = postSpeed >= HEAT_FIRE * BASE_SPD * 0.96 || superKey === 'cannonball' || Boolean(ball.onFire);
    const ballFric = (ball.friction ?? 85) + AIR_DRAG * postSpeed * postSpeed * 0.6;
    const bCurveF = (burning ? BALL_CURVE_FIRE : BALL_CURVE_COLD) * (body.curveMult ?? 1);
    const bPass1 = integrateSpinArc(postSpeed, ballFric, d, wBall, bCurveF);
    const bArc = integrateSpinArc(postSpeed, ballFric, d / bPass1.chordRatio, wBall, bCurveF);
    const ballDeflect = Math.atan2(dvtB, dvnB) + bArc.chordAngle;
    const c = Math.cos(-ballDeflect), sn = Math.sin(-ballDeflect);
    const rux = ux * c - uy * sn, ruy = ux * sn + uy * c;
    ux = rux; uy = ruy;
  }
  return aim(body, leadX - ux * contact, leadY - uy * contact, effDrive, superKey, clampedSpin);
}

// Zero-allocation scalar 2-body forward shot model matching launch(), collide(), wall grip, Meteor Bank & 240 Hz heat ignition.
function simulateScalarShot(body, ball, angle, power, spin, superKey, goalX, expectWalls = 0) {
  if (ball.stickOffset) return null;
  const isColossus = superKey === 'colossus' && body.superActive !== 'colossus';
  const isStalwart = superKey === 'stalwart' || body.superActive === 'stalwart';
  const effR = isColossus ? Math.max(body.baseRadius ?? body.radius, P.SUPER.colossusRadius) : body.radius;
  const effM = isColossus ? Math.max(body.baseMass ?? body.mass, P.SUPER.colossusMass) : (body.mass || 3);
  const hitR = Math.max(effR, body.reach || effR, 18);
  const ballR = ball.radius || 18;
  const contactR = hitR + ballR;
  const contactR2 = contactR * contactR;

  const clampedSpin = spin ? Math.max(-1, Math.min(1, spin)) : 0;
  const { maxV, effFriction } = skaterDrive(body, superKey, clampedSpin);
  const pwr = Math.max(0, Math.min(1, power));
  if (pwr <= 0) return null;

  let svx = body.vx || 0, svy = body.vy || 0;
  const dxV = Math.cos(angle) * maxV * pwr - svx;
  const dyV = Math.sin(angle) * maxV * pwr - svy;
  const prevSpd = Math.hypot(svx, svy);
  const reSteerMult = (body.sizeMult || 1) ** P.SIZE.agility * ((body.grip ?? 0.3) / 0.3) ** (P.ICE_BITE?.gripCutExp ?? 0);
  const effSteer = 1 + Math.min(1, prevSpd / (maxV || 1)) * (reSteerMult - 1);
  const scaleV = Math.min(1, (maxV * effSteer) / (Math.hypot(dxV, dyV) || 1));
  svx += dxV * scaleV;
  svy += dyV * scaleV;
  const maxSpin = body.maxSpin || P.BASE_MAX_SPIN || 20;
  let sw = Math.max(-maxSpin, Math.min(maxSpin, (body.omega || 0) + clampedSpin * maxSpin));
  const launchSpin = clampedSpin !== 0 ? sw : ((body.launchSpin && sw * body.launchSpin > 0) ? sw : 0);
  const sCurve = body.curveFactor ?? SKATER_CURVE;

  const launchGap = Math.max(0, Math.hypot(ball.x - body.x, ball.y - body.y) - contactR);
  const prox = Math.max(0, 1 - launchGap / (4 * ballR));
  const spinStrike = (P.STRIKE_GAIN ?? 1) + ((P.CLOSE_SPIN_GAIN ?? 2) - (P.STRIKE_GAIN ?? 1)) * prox * prox * (3 - 2 * prox);

  let sx = body.x, sy = body.y;
  let bx = ball.x, by = ball.y, bvx = ball.vx || 0, bvy = ball.vy || 0, bw = ball.omega || 0;
  const bFric = ball.friction ?? 85;
  let bCurveMult = ball.curveMult ?? 1;
  let onFire = Boolean(ball.onFire), fireTicks = ball.fireTicks || 0, pace = ball.pace || 0;

  const dt = 1 / 120;
  let hit = false;
  for (let step = 0; step < 96; step++) {
    const sx0 = sx, sy0 = sy, bx0 = bx, by0 = by;
    if (sw !== 0 && (svx !== 0 || svy !== 0)) {
      const cm = body.curveMult || 1;
      const cf = (launchSpin && sw * launchSpin > 0) ? sCurve : ((sCurve / cm) * 0.55 / (cm > 1 ? cm : 1));
      const ang = sw * cf * dt, c = Math.cos(ang), s = Math.sin(ang), vx0 = svx;
      svx = vx0 * c - svy * s; svy = vx0 * s + svy * c;
      sw = Math.sign(sw) * Math.max(0, Math.abs(sw) - SPIN_DECAY * dt);
    }
    sx += svx * dt; sy += svy * dt;
    if (sy < RINK_TOP + effR && svy < 0) { sy = 2 * (RINK_TOP + effR) - sy; svy = -svy * 0.66; sw = 0; }
    else if (sy > RINK_BOTTOM - effR && svy > 0) { sy = 2 * (RINK_BOTTOM - effR) - sy; svy = -svy * 0.66; sw = 0; }
    const ssp = Math.hypot(svx, svy);
    if (ssp > 0) {
      const f = Math.max(0, ssp - effFriction * dt) / ssp;
      svx *= f; svy *= f;
    }

    if (bvx !== 0 || bvy !== 0) {
      if (bw !== 0) {
        const bcf = (onFire ? BALL_CURVE_FIRE : BALL_CURVE_COLD) * bCurveMult;
        const ang = bw * bcf * dt, c = Math.cos(ang), s = Math.sin(ang), vx0 = bvx;
        bvx = vx0 * c - bvy * s; bvy = vx0 * s + bvy * c;
        bw = Math.sign(bw) * Math.max(0, Math.abs(bw) - SPIN_DECAY * dt);
      }
      bx += bvx * dt; by += bvy * dt;
      if (by < RINK_TOP + ballR && bvy < 0) { by = 2 * (RINK_TOP + ballR) - by; bvy = -bvy * WALL_REST; bw *= WALL_SPIN_KEEP; }
      else if (by > RINK_BOTTOM - ballR && bvy > 0) { by = 2 * (RINK_BOTTOM - ballR) - by; bvy = -bvy * WALL_REST; bw *= WALL_SPIN_KEEP; }
      const bsp = Math.hypot(bvx, bvy);
      const bdec = (bFric + AIR_DRAG * bsp * bsp) * dt;
      if (bsp <= bdec) { bvx = bvy = 0; }
      else { const f = (bsp - bdec) / bsp; bvx *= f; bvy *= f; }
    }

    const rx0 = bx0 - sx0, ry0 = by0 - sy0;
    const rvx = (bx - sx) - rx0, rvy = (by - sy) - ry0;
    const qa = rvx * rvx + rvy * rvy;
    const qb = 2 * (rx0 * rvx + ry0 * rvy);
    const qc = rx0 * rx0 + ry0 * ry0 - contactR2;
    let tau = -1;
    if (qc <= 0) {
      if (qb < 0) tau = 0;
    } else if (qa > 1e-9) {
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) {
        const tHit = (-qb - Math.sqrt(disc)) / (2 * qa);
        if (tHit >= 0 && tHit <= 1) tau = tHit;
      }
    }
    if (tau >= 0) {
      sx = sx0 + (sx - sx0) * tau; sy = sy0 + (sy - sy0) * tau;
      bx = bx0 + (bx - bx0) * tau; by = by0 + (by - by0) * tau;
      hit = true;
      break;
    }
    if (ssp < 5 && bvx === 0 && bvy === 0) break;
  }
  if (!hit) return null;

  const dx = bx - sx, dy = by - sy, d = Math.hypot(dx, dy) || 1;
  const nx = dx / d, ny = dy / d;
  const closing = (bvx - svx) * nx + (bvy - svy) * ny;
  if (closing >= 0) return null;

  const mB = ball.mass || 1;
  const invA = isStalwart && svx === 0 && svy === 0 ? 0 : 1 / effM;
  const invB = 1 / mB;
  const invSum = invA + invB;
  const baseImp = -(1 + 0.88) * closing / invSum;
  const bodyCoreDist = Math.max(effR, 25) + ballR;
  const pokeFrac = d > bodyCoreDist ? Math.min(1, (d - bodyCoreDist) / Math.max(1, contactR - bodyCoreDist)) : 0;
  const sweetMult = 1 - (1 - POKE_TIP_MIN) * pokeFrac;

  let impA = baseImp, impB = baseImp * (body.power || 1);
  const normA = svx * nx + svy * ny, normB = bvx * nx + bvy * ny;
  const eBefore = (invA ? effM * normA * normA : 0) + mB * normB * normB;
  const nextA = invA ? normA - impA * invA : 0, nextB = normB + impB * invB;
  const eAfter = (invA ? effM * nextA * nextA : 0) + mB * nextB * nextB;
  const eScale = eAfter > eBefore ? Math.sqrt(eBefore / eAfter) : 1;
  if (invA) impA = (normA - nextA * eScale) / invA;
  impB = ((nextB * eScale - normB) / invB) * sweetMult;

  const cannonImp = superKey === 'cannonball' ? (P.SUPER.cannonball ?? 1) * impB : 0;
  const preDrive = (svx * dx + svy * dy) / d;
  const prePlayerOmega = sw;
  const prePlayerSpd = Math.hypot(svx, svy);

  if (invA > 0) { svx -= impA * nx * invA; svy -= impA * ny * invA; }
  bvx += impB * nx * invB; bvy += impB * ny * invB;

  const tx = -ny, ty = nx;
  const rvt = (bvx - svx) * tx + (bvy - svy) * ty;
  const slip = rvt - sw * effR - bw * ballR;
  const gripPair = Math.sqrt((body.grip ?? 0.3) * (ball.grip ?? 0.3));
  const limit = gripPair * baseImp;
  const slipDenom = (invA + invB) + (isStalwart ? 0 : 2 * invA) + 2 * invB;
  const tang = Math.max(-limit, Math.min(limit, -slip / slipDenom));
  bvx += tang * tx * invB; bvy += tang * ty * invB;
  bw -= 2 * tang * invB / ballR;

  if (cannonImp) {
    bvx += cannonImp * nx / mB; bvy += cannonImp * ny / mB;
    onFire = true; fireTicks = FIRE_TICKS;
  }
  bCurveMult = body.curveMult ?? 1;

  if (spinStrike > 0) {
    const small = (body.sizeMult || 1) ** (P.SIZE?.strike ?? -0.5);
    const closeSpin = -spinStrike * prePlayerOmega * small * bCurveMult;
    bw = Math.max(-24, Math.min(24, bw + closeSpin));
    if (spinStrike > (P.STRIKE_GAIN ?? 1) && prePlayerSpd >= (P.STRIKE_MIN_SPEED ?? 180) && preDrive > 0) {
      const boost = small * (P.STRIKE_POWER ?? 0.5) * (spinStrike - (P.STRIKE_GAIN ?? 1)) * prePlayerSpd;
      const sp = Math.hypot(bvx, bvy);
      if (sp > 0) { bvx += (bvx / sp) * boost; bvy += (bvy / sp) * boost; }
    }
  } else {
    bw = Math.max(-24, Math.min(24, bw));
  }
  pace = Math.hypot(bvx, bvy);

  if (goalX < bx ? bvx >= -40 : bvx <= 40) return null;

  const bDt = 1 / 120;
  const yMin = RINK_TOP + ballR, yMax = RINK_BOTTOM - ballR;
  let wallHits = 0;
  for (let s = 0; s < 150; s++) {
    const px = bx, py = by;
    for (let h = 0; h < 2; h++) {
      const sp = Math.hypot(bvx, bvy), share = pace / BASE_SPD;
      if (onFire) { if (share <= HEAT_SUSTAIN) { onFire = false; fireTicks = 0; } }
      else {
        if (share > HEAT_FIRE) fireTicks = Math.min(FIRE_TICKS, fireTicks + 1);
        else if (share <= HEAT_SUSTAIN) fireTicks = 0;
        if (fireTicks >= FIRE_TICKS && sp > HEAT_FIRE * BASE_SPD) onFire = true;
      }
    }
    if (bw !== 0) {
      const cf = (onFire ? BALL_CURVE_FIRE : BALL_CURVE_COLD) * bCurveMult;
      const ang = bw * cf * bDt, c = Math.cos(ang), sn = Math.sin(ang), vx0 = bvx;
      bvx = vx0 * c - bvy * sn; bvy = vx0 * sn + bvy * c;
      bw = Math.sign(bw) * Math.max(0, Math.abs(bw) - SPIN_DECAY * bDt);
    }
    bx += bvx * bDt; by += bvy * bDt;
    const bsp = Math.hypot(bvx, bvy);
    const bdec = (bFric + AIR_DRAG * bsp * bsp) * bDt;
    if (bsp <= bdec) return null;
    const f = (bsp - bdec) / bsp;
    bvx *= f; bvy *= f;
    pace = Math.max(bsp * f, pace - (bFric + AIR_DRAG * pace * pace) * bDt);

    const crx = bx < RINK_LEFT + CORNER_R ? RINK_LEFT + CORNER_R : (bx > RINK_RIGHT - CORNER_R ? RINK_RIGHT - CORNER_R : -1);
    const cry = by < RINK_TOP + CORNER_R ? RINK_TOP + CORNER_R : (by > RINK_BOTTOM - CORNER_R ? RINK_BOTTOM - CORNER_R : -1);
    if (crx >= 0 && cry >= 0) {
      const cdx = bx - crx, cdy = by - cry, clim = CORNER_R - ballR;
      if (cdx * cdx + cdy * cdy > clim * clim) return null;
    }

    if ((by < yMin && bvy < 0) || (by > yMax && bvy > 0)) {
      wallHits++;
      if (expectWalls === 0 || wallHits > expectWalls) return null;
      if (expectWalls > 0 && ((expectWalls < 0 && by > RINK_CY) || (expectWalls > 0 && false))) { /* side checked via bankWallSide in caller */ }
      const isTop = by < yMin;
      const wnx = 0, wny = isTop ? -1 : 1;
      by = isTop ? 2 * yMin - by : 2 * yMax - by;
      const velN = bvx * wnx + bvy * wny;
      const preSpd = onFire ? Math.hypot(bvx, bvy) : 0;
      const wtx = -wny, wty = wnx;
      const reb = 1 + WALL_REST;
      bvx -= reb * velN * wnx; bvy -= reb * velN * wny;
      const wSlip = bvx * wtx + bvy * wty + bw * ballR;
      const wLim = (ball.grip ?? 0.3) * reb * velN * mB;
      const wImp = Math.max(-wLim, Math.min(wLim, -wSlip * mB / 3));
      bvx += wImp * wtx / mB; bvy += wImp * wty / mB;
      bw = (bw + 2 * wImp / (mB * ballR)) * WALL_SPIN_KEEP;
      if (onFire && preSpd > 0) {
        const pSp = Math.hypot(bvx, bvy);
        if (pSp > 0) { bvx *= preSpd / pSp; bvy *= preSpd / pSp; }
      } else {
        const afterSp = Math.hypot(bvx, bvy);
        if (afterSp < bsp * f) pace *= afterSp / (bsp * f);
      }
    }

    if ((goalX <= RINK_LEFT && bx <= goalX && px > goalX) ||
        (goalX >= RINK_RIGHT && bx >= goalX && px < goalX)) {
      if (expectWalls > 0 && wallHits !== expectWalls) return null;
      const frac = Math.abs(px - goalX) / Math.max(1e-6, Math.abs(px - bx));
      return py + frac * (by - py);
    }
    if (goalX <= RINK_LEFT ? bvx >= -15 : bvx <= 15) return null;
  }
  return null;
}

// Calibrated goal-bound shot solver: refines launch angle via 2-3 scalar secant steps (~70 us) and flags impossible shots.
function goalStrike(body, ball, goalX, targetY, superKey = null, spin = 0, drive = 2400, bankWallSide = 0) {
  const ballR = ball.radius || 18;
  let initAimY = targetY;
  if (bankWallSide !== 0) {
    const wallY = bankWallSide < 0 ? (RINK_TOP + ballR) : (RINK_BOTTOM - ballR);
    const mult = (ball.onFire || superKey === 'cannonball') ? 1.08 : 1.38;
    initAimY = wallY + (wallY - targetY) * mult;
  }
  const base = strike(body, ball, goalX, initAimY, superKey, spin, drive);
  const pwr = drive >= 2000 ? 1 : base.power;
  if (pwr < 0.25 || ball.stickOffset) {
    return { ...base, superArm: Boolean(superKey), valid: false, predictedY: null };
  }

  const expWalls = bankWallSide !== 0 ? 1 : 0;
  const dirSign = (goalX <= RINK_LEFT ? 1 : -1) * (targetY <= RINK_CY ? 1 : -1);
  let a0 = base.angle;
  let y0 = simulateScalarShot(body, ball, a0, pwr, base.spin, superKey, goalX, expWalls);
  if (y0 === null) {
    const probes = bankWallSide !== 0
      ? [0.08, -0.08, 0.16, -0.16, 0.26, -0.26, 0.36, -0.36]
      : [0.06, -0.06, 0.14, -0.14, 0.24, -0.24];
    for (let i = 0; i < probes.length; i++) {
      const da = probes[i] * dirSign;
      const yt = simulateScalarShot(body, ball, a0 + da, pwr, base.spin, superKey, goalX, expWalls);
      if (yt !== null) { a0 += da; y0 = yt; break; }
    }
    if (y0 === null) {
      return { ...base, power: pwr, superArm: Boolean(superKey), valid: false, predictedY: null };
    }
  }
  const mouthMin = GOAL_Y_TOP + 11, mouthMax = GOAL_Y_BOT - 11;
  if (Math.abs(y0 - targetY) <= 2.8) {
    return {
      angle: ((a0 % TWO_PI) + TWO_PI) % TWO_PI,
      power: pwr,
      spin: base.spin,
      superArm: Boolean(superKey),
      guard: false,
      valid: y0 >= mouthMin && y0 <= mouthMax,
      predictedY: y0
    };
  }

  const stepA = 0.035 * dirSign;
  let a1 = a0 + stepA;
  let y1 = simulateScalarShot(body, ball, a1, pwr, base.spin, superKey, goalX, expWalls);
  if (y1 === null) {
    a1 = a0 - stepA;
    y1 = simulateScalarShot(body, ball, a1, pwr, base.spin, superKey, goalX, expWalls);
  }
  for (let it = 0; it < 2 && y1 !== null; it++) {
    const err1 = y1 - targetY;
    if (Math.abs(err1) <= 1.0) { a0 = a1; y0 = y1; break; }
    const dy = y1 - y0;
    if (Math.abs(dy) < 0.20) break;
    const da = Math.max(-0.20, Math.min(0.20, -err1 * (a1 - a0) / dy));
    const a2 = a1 + da;
    const y2 = simulateScalarShot(body, ball, a2, pwr, base.spin, superKey, goalX, expWalls);
    if (y2 === null) {
      const aMid = a1 + da * 0.5;
      const yMid = simulateScalarShot(body, ball, aMid, pwr, base.spin, superKey, goalX, expWalls);
      if (yMid === null) break;
      a0 = a1; y0 = y1; a1 = aMid; y1 = yMid;
      continue;
    }
    a0 = a1; y0 = y1;
    a1 = a2; y1 = y2;
  }
  const use1 = y1 !== null && Math.abs(y1 - targetY) < Math.abs(y0 - targetY);
  const bestA = use1 ? a1 : a0;
  const bestY = use1 ? y1 : y0;
  return {
    angle: ((bestA % TWO_PI) + TWO_PI) % TWO_PI,
    power: pwr,
    spin: base.spin,
    superArm: Boolean(superKey),
    guard: false,
    valid: bestY >= mouthMin && bestY <= mouthMax,
    predictedY: bestY
  };
}

module.exports = { ballTraceKey, integrateSpinArc, aim, traceMovingBall, skaterTravelTime, matchBallIntercept, strike, simulateScalarShot, goalStrike };
