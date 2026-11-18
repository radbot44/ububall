/* Spin-arc integration, moving-ball rebound tracing, and point-of-contact shot solver. */
'use strict';
const { P, RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, SKATER_CURVE, SPIN_DECAY, AIR_DRAG, skaterDrive } = require('./constants.js');

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


module.exports = { ballTraceKey, integrateSpinArc, aim, traceMovingBall, skaterTravelTime, matchBallIntercept, strike };
