'use strict';
const {
  rink, BASE_LAUNCH_SPEED, IRON_COOLDOWN_TICKS, STRIKE_GAIN, STRIKE_POWER, SPIN_STRIKE_MIN_OMEGA, SURFACES, SIZE, TEMPERED_SHOT, SWEET_SPOT, BOARD_SPRING, TAPE_TO_TAPE, FIRE_TICKS, IRON_KEEP, HOT_DRIVE, SNAP, STRIKE_MIN_SPEED, RIM, HIP_CLIP, bodyKE, ballOnFire, countSlowing, DAZE, daze, SUPER, ballHitRadius, syncEffectiveStats, setStriker, clearHeat, emitCollide, bumpResolved, holder
} = require('./constants.js');

function reflect(b, nx, ny, penetration, wallType = 'wall', onWall = null, isCorner = false, hostCarrier = null) {
  bumpResolved();
  b.x -= nx * penetration; b.y -= ny * penetration;
  const velocity = b.vx * nx + b.vy * ny;
  if (velocity > 0) {
    const surface = SURFACES[wallType];
    const carrier = b.team === -1 ? hostCarrier : null;
    const isMeteor = b.team === -1 && !carrier && ballOnFire(b) && surface.meteorBank;
    const preSpeed = isMeteor ? Math.hypot(b.vx, b.vy) : 0;
    const tx = -ny, ty = nx;
    const vt = b.vx * tx + b.vy * ty;
    const cornerSkater = isCorner && b.team >= 0;
    const rimmed = cornerSkater && velocity <= RIM.maxNormal && Math.abs(vt) >= RIM.minTangent && b.omega * vt < 0;
    const counterRim = cornerSkater && b.omega * vt > 0;
    if (!rimmed) {
      b.spinStrike = 0;
      if (b.team >= 0) b.launchSpin = 0;
    }
    const preRimKE = rimmed && !carrier ? bodyKE(b) : 0;
    const restitutionBody = carrier || b;
    const baseWallRest = wallType === 'wall' ? BOARD_SPRING.wallUbuRestitution : surface.restitution;
    let restitution = restitutionBody.team === -1 ? surface.restitution
      : (rimmed
        ? Math.min(surface.ubuRestitutionCap, baseWallRest * (restitutionBody.sizeMult ?? 1) ** SIZE.boards) * RIM.bounceScale
        : Math.min(surface.ubuRestitutionCap, baseWallRest * (restitutionBody.bounciness ?? 1) * (restitutionBody.sizeMult ?? 1) ** SIZE.boards));
    const effMass = carrier ? carrier.mass + b.mass : b.mass;
    const rebound = 1 + restitution;
    b.vx -= rebound * velocity * nx; b.vy -= rebound * velocity * ny;
    const slip = b.vx * tx + b.vy * ty + b.omega * b.radius;
    const gripScale = surface.gripScale * (counterRim ? RIM.checkGrip : 1);
    const limit = (b.grip * gripScale) * rebound * velocity * effMass;
    const preOmega = b.omega;
    const impulse = Math.max(-limit, Math.min(limit, -slip * effMass / 3));
    b.vx += impulse * tx / effMass; b.vy += impulse * ty / effMass;
    b.omega += 2 * impulse / (effMass * b.radius);
    b.omega *= rimmed ? RIM.spinKeep : (surface.spinKeep ?? 0.5);
    if (rimmed && !carrier) {
      const postRimKE = bodyKE(b);
      const lostKE = preRimKE - postRimKE;
      if (lostKE > 0) {
        const redirectShare = Math.min(0.88, BOARD_SPRING.rimRedirect * (restitutionBody.bounciness ?? 1));
        const curVt = b.vx * tx + b.vy * ty;
        const curVn = b.vx * nx + b.vy * ny;
        const rotKE = .25 * b.mass * b.radius * b.radius * b.omega * b.omega;
        const targetKE = Math.min(preRimKE * (1 - 1e-12), postRimKE + redirectShare * lostKE);
        const availVt2 = Math.max(curVt * curVt, (2 * Math.max(0, targetKE - rotKE)) / b.mass - curVn * curVn);
        const tSign = (curVt || vt) >= 0 ? 1 : -1;
        const newVt = tSign * Math.sqrt(availVt2);
        b.vx = curVn * nx + newVt * tx;
        b.vy = curVn * ny + newVt * ty;
      }
    }
    if (isMeteor && preSpeed > 0) {
      const postSpeed = Math.hypot(b.vx, b.vy);
      if (postSpeed > 0) {
        const scale = preSpeed / postSpeed;
        b.vx *= scale; b.vy *= scale;
      }
    }
    if (typeof onWall === 'function') {
      const absPreOmega = Math.abs(preOmega || 0);
      const spinBite = absPreOmega >= 4 && Math.abs(impulse) > 10
        ? Math.sign(impulse) * Math.min(1, (Math.abs(impulse) / Math.max(1, effMass * 165)) * Math.min(1.25, absPreOmega / 14))
        : 0;
      const counterScuff = counterRim && Math.abs(vt) >= 115 && absPreOmega >= 4.5
        ? Math.min(1, (Math.abs(vt) / 420) * (absPreOmega / 14))
        : 0;
      onWall(b, velocity, wallType, nx, ny, rimmed, spinBite, counterScuff);
    }
  }
}
function walls(b, onWall = null, carrier = null) {
  const r = b.radius;
  if (rink.left === 60 && b.x >= 150 && b.x <= 850 && b.y >= 60 + r && b.y <= 540 - r) return;
  const k = rink;
  if (b.x >= k.left + r && b.x <= k.right - r && b.y >= k.top + r && b.y <= k.bottom - r &&
      ((b.x >= k.left + k.corner && b.x <= k.right - k.corner) || (b.y >= k.top + k.corner && b.y <= k.bottom - k.corner))) return;
  const inGoalY = b.y > k.goalTop && b.y < k.goalBottom, before = b.team === -1 ? Math.hypot(b.vx, b.vy) : 0;
  const inLeftPocket = inGoalY || (b.x < k.left && b.y > k.goalTop - r && b.y < k.goalBottom + r);
  const inRightPocket = inGoalY || (b.x > k.right && b.y > k.goalTop - r && b.y < k.goalBottom + r);

  if (inLeftPocket) {
    const backX = k.left - k.goalDepth + r;
    if (b.x < backX) {
      reflect(b, -1, 0, backX - b.x, 'net', onWall, false, carrier);
      if (b.team === -1) { b.vx *= 0.1; b.vy *= 0.1; }
    }
    if (b.x < k.left) {
      if (b.y < k.goalTop + r) reflect(b, 0, -1, k.goalTop + r - b.y, 'net', onWall, false, carrier);
      if (b.y > k.goalBottom - r) reflect(b, 0, 1, b.y - (k.goalBottom - r), 'net', onWall, false, carrier);
    } else if (b.x < k.left + r) {
      for (let pi = 0; pi < 2; pi++) {
        const y = pi === 0 ? k.goalTop : k.goalBottom;
        const dx = k.left - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < r * r && d2 > 0) { const d = Math.sqrt(d2); reflect(b, dx / d, dy / d, r - d, 'post', onWall, false, carrier); }
      }
    }
  } else {
    if (b.x < k.left + r) reflect(b, -1, 0, k.left + r - b.x, 'wall', onWall, false, carrier);
  }

  if (inRightPocket) {
    const backX = k.right + k.goalDepth - r;
    if (b.x > backX) {
      reflect(b, 1, 0, b.x - backX, 'net', onWall, false, carrier);
      if (b.team === -1) { b.vx *= 0.1; b.vy *= 0.1; }
    }
    if (b.x > k.right) {
      if (b.y < k.goalTop + r) reflect(b, 0, -1, k.goalTop + r - b.y, 'net', onWall, false, carrier);
      if (b.y > k.goalBottom - r) reflect(b, 0, 1, b.y - (k.goalBottom - r), 'net', onWall, false, carrier);
    } else if (b.x > k.right - r) {
      for (let pi = 0; pi < 2; pi++) {
        const y = pi === 0 ? k.goalTop : k.goalBottom;
        const dx = k.right - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
        if (d2 < r * r && d2 > 0) { const d = Math.sqrt(d2); reflect(b, dx / d, dy / d, r - d, 'post', onWall, false, carrier); }
      }
    }
  } else {
    if (b.x > k.right - r) reflect(b, 1, 0, b.x - k.right + r, 'wall', onWall, false, carrier);
  }

  const insidePocket = (b.x < k.left && inLeftPocket) || (b.x > k.right && inRightPocket);
  if (!insidePocket) {
    if (b.y < k.top + r) reflect(b, 0, -1, k.top + r - b.y, 'wall', onWall, false, carrier);
    if (b.y > k.bottom - r) reflect(b, 0, 1, b.y - k.bottom + r, 'wall', onWall, false, carrier);
    const cx = b.x < k.left + k.corner ? k.left + k.corner : (b.x > k.right - k.corner ? k.right - k.corner : -1);
    const cy = b.y < k.top + k.corner ? k.top + k.corner : (b.y > k.bottom - k.corner ? k.bottom - k.corner : -1);
    if (cx >= 0 && cy >= 0) {
      const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy, limit = k.corner - r;
      if (limit < 0 || d2 > limit * limit) {
        const d = Math.sqrt(d2);
        const nx = d > 0 ? dx / d : (cx < 500 ? -Math.SQRT1_2 : Math.SQRT1_2);
        const ny = d > 0 ? dy / d : (cy < 300 ? -Math.SQRT1_2 : Math.SQRT1_2);
        reflect(b, nx, ny, d - limit, 'wall', onWall, true, carrier);
      }
    }
  }
  if (before) countSlowing(b, before);
}
function triggerShockwave(source, bodies, onShockwave, inRange = null) {
  const radius = SUPER.shockRadius;
  if (inRange) {
    for (let i = 0; i < inRange.length; i++) {
      const { opp, d, dx, dy } = inRange[i];
      const force = (1 - d / radius) * SUPER.shockForce;
      const m = opp.mass || 1;
      opp.vx += (dx / d) * force / m;
      opp.vy += (dy / d) * force / m;
    }
  } else {
    const sourceTeam = source.team;
    const limit = bodies.length === 7 && bodies[6].team === -1 ? 6 : bodies.length;
    for (let i = 0; i < limit; i++) {
      const b = bodies[i];
      const isTeammate = sourceTeam !== undefined && b.team !== undefined && b.team === sourceTeam;
      if (b === source || b.team === -1 || isTeammate || b.superActive === 'stalwart' || b.carded) continue;
      const dx = b.x - source.x, dy = b.y - source.y, d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < radius * radius) {
        const d = Math.sqrt(d2);
        const force = (1 - d / radius) * SUPER.shockForce;
        const m = b.mass || 1;
        b.vx += (dx / d) * force / m;
        b.vy += (dy / d) * force / m;
      }
    }
  }
  if (typeof onShockwave === 'function') onShockwave(source, radius);
}
function triggerIronShockwave(source, bodies, onShockwave) {
  const radius = SUPER.shockRadius * 0.5;
  const force = 400;
  const limit = bodies.length === 7 && bodies[6].team === -1 ? 6 : bodies.length;
  for (let i = 0; i < limit; i++) {
    const b = bodies[i];
    if (b === source || b.team === -1 || b.superActive === 'stalwart' || b.carded) continue;
    const dx = b.x - source.x, dy = b.y - source.y, d2 = dx * dx + dy * dy;
    if (d2 > 0 && d2 < radius * radius) {
      const d = Math.sqrt(d2);
      const impulse = (1 - d / radius) * force * (b.team === source.team ? SUPER.shockTeammate : 1);
      const m = b.mass || 1;
      b.vx += (dx / d) * impulse / m;
      b.vy += (dy / d) * impulse / m;
    }
  }
  if (typeof onShockwave === 'function') onShockwave(source, radius, 'iron');
}
function applyDoubledGuard(b) {
  if (!b.guarding) return;
  b.ironGuard = true;
  syncEffectiveStats(b);
}
function endSuper(b, bodies) {
  if (b.holding) {
    b.holding = false;
    const ball = bodies ? (bodies.length === 7 && bodies[6].team === -1 ? bodies[6] : bodies.find(o => o.team === -1)) : null;
    if (ball) ball.stickOffset = null;
  }
  if ((b.superActive || b.usedSuperThisTurn) && !b.superRefunded) {
    b.superRefunded = true;
    const bonusRefund = b.equippedSuper?.bonusRefund ?? b.superBonusRefund ?? 0;
    const whiff = !b.superHit ? SUPER.whiffRefund : 0;
    const refund = bonusRefund + whiff;
    if (refund > 0) b.meter = Math.min(100, (b.meter || 0) + refund);
  }
  b.superActive = null; b.superTicks = 0; b.superHoldTicks = 0; b.shockwaveFired = false; b.superHit = false;
  syncEffectiveStats(b);
}
function collide(a, b, onCollide = null, allBodies = null, onShockwave = null, onSuper = null, deferIronBlast = false) {
  const isBall = a.team === -1 || b.team === -1;
  if (!isBall && (a.carded || b.carded)) return;
  if (isBall && ((a.team !== -1 && a.carded) || (b.team !== -1 && b.carded))) return;
  if (!isBall && a.team !== b.team && (a.superActive === 'ghost' || b.superActive === 'ghost')) return;

  const ball = isBall ? (a.team === -1 ? a : b) : null;
  const player = isBall ? (ball === a ? b : a) : null;
  if (player && player.holding) return;

  const ra = (isBall && a.team !== -1) ? ballHitRadius(a) : a.radius;
  const rb = (isBall && b.team !== -1) ? ballHitRadius(b) : b.radius;
  const dx = b.x - a.x, dy = b.y - a.y, radius = ra + rb;
  const d2 = dx * dx + dy * dy;
  if (d2 > radius * radius) return;
  bumpResolved();
  const d = Math.sqrt(d2);
  const preNx = d ? dx / d : 1, preNy = d ? dy / d : 0;
  const preClosing = (b.vx - a.vx) * preNx + (b.vy - a.vy) * preNy;
  const carrier = isBall && allBodies ? holder(allBodies) : null;
  if (carrier && carrier !== player) {
    if (player.superActive === 'sticky' || (player.team !== carrier.team && preClosing < 0 && (ball.stuckTicks || 0) > 0)) {
      endSuper(carrier, allBodies);
    } else {
      const overlap = radius - d;
      const pIsA = player === a, sign = pIsA ? 1 : -1;
      const cMass = carrier.mass + ball.mass;
      const invP = player.superActive === 'stalwart' ? 0 : 1 / player.mass;
      const invC = carrier.superActive === 'stalwart' ? 0 : 1 / cMass;
      const invSum = invP + invC;
      if (invSum > 0) {
        const corr = overlap / invSum;
        if (invP > 0) { player.x -= sign * preNx * corr * invP; player.y -= sign * preNy * corr * invP; }
        if (invC > 0) { carrier.x += sign * preNx * corr * invC; carrier.y += sign * preNy * corr * invC; }
        if (preClosing < 0) {
          const j = -(1 + .88) * preClosing / invSum;
          if (invP > 0) { player.vx -= sign * j * preNx * invP; player.vy -= sign * j * preNy * invP; }
          if (invC > 0) { carrier.vx += sign * j * preNx * invC; carrier.vy += sign * j * preNy * invC; }
          emitCollide(onCollide, pIsA ? player : carrier, pIsA ? carrier : player, -preClosing, j);
        }
      }
      const off = ball.stickOffset || { x: carrier.radius + ball.radius, y: 0 };
      ball.x = carrier.x + off.x; ball.y = carrier.y + off.y;
      ball.vx = carrier.vx; ball.vy = carrier.vy; ball.omega = carrier.omega;
      return;
    }
  }
  const own = Boolean(player) && player.team === ball.strikerTeam, hot = isBall ? ballOnFire(ball) : false;
  const prePlayerOmega = player ? player.omega : 0;
  const drive = player ? (player.vx * (ball.x - player.x) + player.vy * (ball.y - player.y)) / (d || 1) : 0;
  let closeSpin = 0, strikeBoost = 0;
  let crowdedBall = false;
  if (isBall) {
    const psa = player.superActive;
    if (psa && (psa === 'cannonball' || psa === 'sticky' || psa === 'magnet' || psa === 'ghost' || psa === 'stalwart' || psa === 'colossus')) {
      player.superHit = true;
    }
    if (ball.openingShot && player.spinStrike) {
      const small = (player.sizeMult || 1) ** SIZE.strike;
      closeSpin = -player.spinStrike * player.omega * small * (player.curveMult || 1);
      const ubuSpeed = Math.hypot(player.vx, player.vy);
      if (player.spinStrike > STRIKE_GAIN && ubuSpeed >= STRIKE_MIN_SPEED && drive > 0) {
        strikeBoost = small * STRIKE_POWER * (player.spinStrike - STRIKE_GAIN) * ubuSpeed;
      }
    }
    if (allBodies) {
      const lim = allBodies.length === 7 && allBodies[6].team === -1 ? 6 : allBodies.length;
      for (let k = 0; k < lim; k++) {
        const other = allBodies[k];
        if (other !== player && other.team >= 0 && !other.carded) {
          const cdx = other.x - ball.x, cdy = other.y - ball.y, cr = ballHitRadius(other) + ball.radius;
          if (cdx * cdx + cdy * cdy <= cr * cr) { crowdedBall = true; break; }
        }
      }
    }
    if (crowdedBall) closeSpin = strikeBoost = 0;
    ball.openingShot = false;
  } else {
    a.spinStrike = b.spinStrike = 0;
    a.launchSpin = b.launchSpin = 0;
  }

  const nx = preNx, ny = preNy;
  const closing = preClosing;

  let knockoutChecker = null;
  if (!isBall && a.team !== b.team && closing < 0) {
    if (a.superActive === 'knockout' || a.superActive === 'stalwart' || a.superActive === 'colossus') a.superHit = true;
    if (b.superActive === 'knockout' || b.superActive === 'stalwart' || b.superActive === 'colossus') b.superHit = true;
    if (a.superActive === 'knockout') { b.stunnedNext = true; a.superActive = null; onSuper?.('knockout', 'impact', a, b); knockoutChecker = a; }
    if (b.superActive === 'knockout') { a.stunnedNext = true; b.superActive = null; onSuper?.('knockout', 'impact', b, a); knockoutChecker = knockoutChecker || b; }
    if (a.superActive === 'sticky' && a.holding) endSuper(a, allBodies);
    if (b.superActive === 'sticky' && b.holding) endSuper(b, allBodies);
  }
  const restitution = .88;
  let fireWin = -1, ironSave = false;

  if (isBall && player.superActive === 'sticky') {
    if (allBodies) {
      const lim = allBodies.length === 7 && allBodies[6].team === -1 ? 6 : allBodies.length;
      for (let k = 0; k < lim; k++) {
        const o = allBodies[k];
        if (o.team >= 0 && o.holding && o !== player) endSuper(o, allBodies);
      }
    }
    player.holding = true; ball.stuckTicks = 0;
    onSuper?.('sticky', 'impact', player, ball);
    if (!own) clearHeat(ball);
    setStriker(ball, player);
    const ox = ball === b ? dx : -dx, oy = ball === b ? dy : -dy, od = d || 1;
    const targetDist = player.radius + ball.radius;
    ball.stickOffset = { x: (ox / od) * targetDist, y: (oy / od) * targetDist };
    ball.x = player.x + ball.stickOffset.x;
    ball.y = player.y + ball.stickOffset.y;
    if (player.superActive !== 'stalwart') {
      const totalMass = player.mass + ball.mass;
      player.vx = (player.vx * player.mass + ball.vx * ball.mass) / totalMass;
      player.vy = (player.vy * player.mass + ball.vy * ball.mass) / totalMass;
    }
    ball.vx = player.vx;
    ball.vy = player.vy;
    ball.omega = player.omega;
    emitCollide(onCollide, a, b, Math.max(0, -closing), 0);
    return;
  }

  if (isBall) {
    const isFire = hot;
    const ballSpeed = Math.hypot(ball.vx, ball.vy);
    const isTeammate = ball.strikerTeam !== undefined && ball.strikerTeam >= 0 && ball.strikerTeam === player.team;
    const isFriendlyPass = isTeammate && !isFire && (ballSpeed >= 175 || (ball.pace || 0) >= 175);
    if ((isFire || isFriendlyPass) && player.superActive !== 'cannonball' && closing < 0) {
      const pbx = ball.x - player.x, pby = ball.y - player.y;
      const pbDist = Math.hypot(pbx, pby) || 1;
      const pnx = pbx / pbDist, pny = pby / pbDist;
      if (ballSpeed > 50) {
        const bux = ball.vx / ballSpeed, buy = ball.vy / ballSpeed;
        const delta = Math.max(0, -(bux * pnx + buy * pny));

        let R = 0;
        if (player.superActive === 'stalwart') {
          R = Infinity;
        } else {
          const normMass = (player.baseMass || player.mass) / 3;
          const baseStab = player.baseStability ?? player.stability ?? 1;
          const guardMult = player.guarding ? (player.ironGuard ? 4.0 : 2.0) : 1.0;
          const colossusMult = player.superActive === 'colossus' ? Math.max(1, player.mass / (player.baseMass || player.mass)) : 1.0;
          R = normMass * baseStab * (1 + delta * delta) * guardMult * colossusMult;
        }

        const strikerPow = (ball.strikerPower || 1) ** TEMPERED_SHOT.firePowerExp;
        const E = (ballSpeed / BASE_LAUNCH_SPEED) * strikerPow * 2.8;

        if (isFire && E > R) {
          fireWin = R / E;
        } else if (player.guarding && (!player.ironCooldownTicks || player.ironCooldownTicks <= 0) && (isFriendlyPass || E <= R)) {
          const opposing = ball.strikerTeam !== undefined && ball.strikerTeam >= 0 && ball.strikerTeam !== player.team;
          if (opposing) {
            ball.onFire = false;
            ball.fireTicks = 0;
          }
          ironSave = true;
          player.ironGuard = true;
          player.ironCooldownTicks = IRON_COOLDOWN_TICKS;
          applyDoubledGuard(player);
          if (allBodies && !deferIronBlast) triggerIronShockwave(player, allBodies, onShockwave);
        }
      }
    }
  }

  const stalwartA = a.team >= 0 && a.superActive === 'stalwart';
  const stalwartB = b.team >= 0 && b.superActive === 'stalwart';
  const anchorA = stalwartA && a.vx === 0 && a.vy === 0;
  const anchorB = stalwartB && b.vx === 0 && b.vy === 0;
  const fireW = fireWin >= 0 ? Math.min(1, (1 - fireWin) * 4) : 0;
  const rawInvA = fireWin >= 0 && a.team === -1 ? 1 / (a.mass * (1 - fireW) + (b.mass / fireWin) * fireW) : 1 / a.mass;
  const rawInvB = fireWin >= 0 && b.team === -1 ? 1 / (b.mass * (1 - fireW) + (a.mass / fireWin) * fireW) : 1 / b.mass;
  const invA = anchorA ? 0 : rawInvA;
  const invB = anchorB ? 0 : rawInvB;
  const inverse = invA + invB;

  const overlap = radius - d;
  if (stalwartA && !stalwartB) {
    b.x += nx * overlap; b.y += ny * overlap;
  } else if (stalwartB && !stalwartA) {
    a.x -= nx * overlap; a.y -= ny * overlap;
  } else if (rawInvA + rawInvB > 0) {
    const correction = overlap / (rawInvA + rawInvB);
    a.x -= nx * correction * rawInvA; a.y -= ny * correction * rawInvA;
    b.x += nx * correction * rawInvB; b.y += ny * correction * rawInvB;
  }

  if (closing >= 0) return;
  if (inverse === 0) {
    if (!isBall) {
      if (stalwartA) onSuper?.('stalwart', 'impact', a, b);
      if (stalwartB) onSuper?.('stalwart', 'impact', b, a);
    }
    emitCollide(onCollide, a, b, -closing, 0, false, false, knockoutChecker);
    return;
  }
  const preRvx = b.vx - a.vx, preRvy = b.vy - a.vy;
  const preBallSpeed = isBall ? Math.hypot(ball.vx, ball.vy) : 0;
  const pairKEBefore = isBall ? bodyKE(player) + bodyKE(ball) : 0;
  if (!isBall) {
    if (stalwartA) onSuper?.('stalwart', 'impact', a, b);
    if (stalwartB) onSuper?.('stalwart', 'impact', b, a);
  }

  const baseImpulse = -(1 + restitution) * closing / inverse;

  let impulseA = baseImpulse, impulseB = baseImpulse, sweetMult = 1, pokeFrac = 0;
  if (isBall) {
    const bodyCoreDist = Math.max(player.radius, 25) + ball.radius;
    const maxReachDist = ballHitRadius(player) + ball.radius;
    pokeFrac = d > bodyCoreDist ? Math.min(1, (d - bodyCoreDist) / Math.max(1, maxReachDist - bodyCoreDist)) : 0;
    sweetMult = 1 - (1 - SWEET_SPOT.pokeTipMin) * pokeFrac;
    if (a.team !== -1 && a.power) impulseB *= a.power;
    else if (b.team !== -1 && b.power) impulseA *= b.power;
  } else {
    const strA = a.strength || 1, stabA = a.stability || 1;
    const strB = b.strength || 1, stabB = b.stability || 1;
    impulseB *= (strA / stabB);
    impulseA *= (strB / stabA);
  }

  const normalA = a.vx * nx + a.vy * ny, normalB = b.vx * nx + b.vy * ny;
  const energyBefore = (invA ? a.mass * normalA * normalA : 0)
    + (invB ? b.mass * normalB * normalB : 0);
  const nextA = invA ? normalA - impulseA * invA : 0;
  const nextB = invB ? normalB + impulseB * invB : 0;
  const energyAfter = (invA ? a.mass * nextA * nextA : 0)
    + (invB ? b.mass * nextB * nextB : 0);
  const scale = energyAfter > energyBefore ? Math.sqrt(energyBefore / energyAfter) : 1;
  if (invA) impulseA = (normalA - nextA * scale) / invA;
  if (invB) impulseB = (nextB * scale - normalB) / invB;
  if (isBall && sweetMult < 1) {
    if (a.team === -1) impulseA *= sweetMult;
    else impulseB *= sweetMult;
  }

  let cannon = null, cannonImpulse = 0;
  if (isBall) {
    if (a.team !== -1 && a.superActive === 'cannonball') { cannon = a; cannonImpulse = SUPER.cannonball * impulseB; }
    else if (b.team !== -1 && b.superActive === 'cannonball') { cannon = b; cannonImpulse = -SUPER.cannonball * impulseA; }
  }

  if (invA > 0) {
    a.vx -= impulseA * nx * invA; a.vy -= impulseA * ny * invA;
  }
  if (invB > 0) {
    b.vx += impulseB * nx * invB; b.vy += impulseB * ny * invB;
  }

  let checker = knockoutChecker;
  const knockA = !isBall ? Math.abs(impulseA * invA) : 0;
  const knockB = !isBall ? Math.abs(impulseB * invB) : 0;
  if (!isBall && a.team !== b.team) {
    const driveA = normalA, driveB = -normalB;
    if (!checker) {
      if (driveB > driveA && knockA > DAZE.speed && !stalwartA) checker = b;
      else if (driveA > driveB && knockB > DAZE.speed && !stalwartB) checker = a;
    }
    if (driveB >= driveA) daze(a, knockA);
    if (driveA >= driveB) daze(b, knockB);
  }
  if (fireWin >= 0) {
    if (a.team === -1) daze(b, Math.abs(impulseB * invB)); else daze(a, Math.abs(impulseA * invA));
  }

  const tx = -ny, ty = nx;
  const frictionA = anchorA ? 0 : 1 / a.mass, frictionB = anchorB ? 0 : 1 / b.mass;
  const spinA = !stalwartA, spinB = !stalwartB;
  const rvt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
  const relSpeed = Math.hypot(preRvx, preRvy);
  const hipClip = !isBall && a.team !== b.team && closing < 0 &&
    relSpeed >= HIP_CLIP.minRelSpeed && Math.abs(rvt) >= Math.abs(closing) * HIP_CLIP.glanceRatio;
  const slip = rvt - a.omega * a.radius - b.omega * b.radius;
  const gripPair = Math.sqrt(a.grip * b.grip);
  const massDenom = frictionA + frictionB;
  const limit = gripPair * (fireWin >= 0 && massDenom > 0 ? -(1 + restitution) * closing / massDenom : baseImpulse);
  const slipDenom = massDenom + (spinA ? 2 * frictionA : 0) + (spinB ? 2 * frictionB : 0);
  const effectiveLimit = hipClip && massDenom > 0
    ? limit + gripPair * HIP_CLIP.gripBoost * Math.abs(rvt) / massDenom
    : limit;
  const tangent = slipDenom > 0 ? Math.max(-effectiveLimit, Math.min(effectiveLimit, -slip / slipDenom)) : 0;

  if (frictionA > 0) {
    a.vx -= tangent * tx * frictionA; a.vy -= tangent * ty * frictionA;
    if (spinA) {
      let dOmegaA = -2 * tangent * frictionA / a.radius;
      if (hipClip && Math.abs(a.omega + dOmegaA) > Math.abs(a.omega)) dOmegaA /= Math.max(1, a.stability || 1);
      a.omega += dOmegaA;
    }
  }
  if (frictionB > 0) {
    b.vx += tangent * tx * frictionB; b.vy += tangent * ty * frictionB;
    if (spinB) {
      let dOmegaB = -2 * tangent * frictionB / b.radius;
      if (hipClip && Math.abs(b.omega + dOmegaB) > Math.abs(b.omega)) dOmegaB /= Math.max(1, b.stability || 1);
      b.omega += dOmegaB;
    }
  }

  let snapped = false;
  const pSlot = player ? (player.slot ?? -1) : -1;
  const prevStrikerTeam = isBall ? ball.strikerTeam : -1;
  const prevStrikerSlot = isBall ? (ball.strikerSlot ?? -1) : -1;
  if (isBall && closing < 0 && fireWin < 0 && !ironSave && !hot &&
      player.superActive !== 'sticky' && !player.guarding && !crowdedBall &&
      ball.strikerTeam === player.team && ball.strikerSlot !== undefined &&
      ball.strikerSlot >= 0 && pSlot >= 0 && ball.strikerSlot !== pSlot &&
      preBallSpeed >= SNAP.minPassSpeed && drive >= SNAP.minDrive) {
    const curBallSpeed = Math.hypot(ball.vx, ball.vy);
    const away = ball === b ? 1 : -1;
    const ux = curBallSpeed ? ball.vx / curBallSpeed : nx * away;
    const uy = curBallSpeed ? ball.vy / curBallSpeed : ny * away;
    const tapeMult = ((ball.strikerSynergy || 1) * (player.chemistryMult || 1)) ** TAPE_TO_TAPE.snapExp;
    const targetBallSpeed = curBallSpeed + SNAP.redirect * preBallSpeed * (player.power || 1) * tapeMult;
    let playerTransKE = .5 * player.mass * (player.vx * player.vx + player.vy * player.vy);
    const playerRotKE = .25 * player.mass * player.radius * player.radius * player.omega * player.omega;
    const ballRotKEAfter = .25 * ball.mass * ball.radius * ball.radius * ball.omega * ball.omega;
    let availTransKE = Math.max(0, pairKEBefore - (playerTransKE + playerRotKE) - ballRotKEAfter);
    const desiredTransKE = .5 * ball.mass * targetBallSpeed * targetBallSpeed;
    if (desiredTransKE > availTransKE && playerTransKE > 0 && player.superActive !== 'stalwart') {
      const transferKE = Math.min(desiredTransKE - availTransKE, playerTransKE * .45);
      const pScale = Math.sqrt(Math.max(0, playerTransKE - transferKE) / playerTransKE);
      player.vx *= pScale;
      player.vy *= pScale;
      playerTransKE = .5 * player.mass * (player.vx * player.vx + player.vy * player.vy);
      availTransKE = Math.max(0, pairKEBefore - (playerTransKE + playerRotKE) - ballRotKEAfter);
    }
    let postBallSpeed = Math.max(curBallSpeed, Math.min(targetBallSpeed, Math.sqrt(2 * availTransKE / ball.mass)));
    if (playerTransKE + playerRotKE + ballRotKEAfter + .5 * ball.mass * postBallSpeed * postBallSpeed > pairKEBefore) {
      postBallSpeed *= 1 - 1e-15;
    }
    ball.vx = ux * postBallSpeed;
    ball.vy = uy * postBallSpeed;
    ball.fireTicks = Math.min(FIRE_TICKS, (ball.fireTicks || 0) + SNAP.heatTicks);
    ball.pace = Math.max(ball.pace || 0, postBallSpeed);
    snapped = true;
  }

  if (cannon) {
    ball.vx += cannonImpulse * nx / ball.mass;
    ball.vy += cannonImpulse * ny / ball.mass;
    cannon.superActive = null;
    ball.fireTicks = FIRE_TICKS;
    ball.onFire = true;
    setStriker(ball, cannon);
    onSuper?.('cannonball', 'impact', cannon, ball);
  } else if (isBall && closing < 0 && fireWin < 0) {
    setStriker(ball, player);
    ball.strikerSlot = pSlot;
  } else if (isBall && fireWin < 0) {
    ball.curveMult = player.curveMult ?? 1;
  }

  let struck = false, spinStruck = false;
  if (closeSpin) {
    ball.omega = Math.max(-24, Math.min(24, ball.omega + closeSpin));
  }
  if (strikeBoost > 0) {
    const away = ball === b ? 1 : -1;
    const speed = Math.hypot(ball.vx, ball.vy);
    ball.vx += (speed ? ball.vx / speed : nx * away) * strikeBoost;
    ball.vy += (speed ? ball.vy / speed : ny * away) * strikeBoost;
    struck = true;
    if (Math.abs(prePlayerOmega) >= SPIN_STRIKE_MIN_OMEGA) spinStruck = true;
  }
  if (ironSave) {
    if (!anchorA) { a.vx *= IRON_KEEP; a.vy *= IRON_KEEP; a.omega *= IRON_KEEP; }
    if (!anchorB) { b.vx *= IRON_KEEP; b.vy *= IRON_KEEP; b.omega *= IRON_KEEP; }
  }
  if (ball) {
    const speed = Math.hypot(ball.vx, ball.vy), pace = ball.pace || 0;
    if (!own) ball.pace = speed;
    else if (snapped && speed > pace) ball.pace = speed;
    else if (!ironSave && hot && drive > HOT_DRIVE.min && pace > speed) {
      const t = Math.min(1, (drive - HOT_DRIVE.min) / (HOT_DRIVE.max - HOT_DRIVE.min));
      const target = speed + (pace - speed) * t;
      const ux = speed ? ball.vx / speed : (ball.x - player.x) / (d || 1), uy = speed ? ball.vy / speed : (ball.y - player.y) / (d || 1);
      ball.vx = ux * target; ball.vy = uy * target;
    }
  }

  const passerSlot = (isBall && closing < 0 && fireWin < 0 && !ironSave && !player.guarding &&
    prevStrikerTeam === player.team && prevStrikerSlot >= 0 && pSlot >= 0 && prevStrikerSlot !== pSlot &&
    preBallSpeed >= TAPE_TO_TAPE.minPassSpeed) ? prevStrikerSlot : -1;
  const graze = relSpeed > 1e-3 ? Math.min(1, Math.abs(rvt) / relSpeed) : 0;
  const tangentSign = (rvt || tangent) < 0 ? -1 : 1;
  emitCollide(onCollide, a, b, -closing, baseImpulse, fireWin >= 0, ironSave, checker, snapped, spinStruck, Math.abs(tangent), passerSlot, struck, graze, tangentSign, pokeFrac, knockA, knockB);
}


module.exports = { reflect, walls, triggerShockwave, triggerIronShockwave, applyDoubledGuard, endSuper, collide };
