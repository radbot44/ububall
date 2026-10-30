'use strict';
(function (root) {
  const rink = Object.freeze({ left: 60, right: 940, top: 60, bottom: 540, corner: 100, goalTop: 230, goalBottom: 370, goalDepth: 38 });
  const DT = 1 / 240, MAX_SPEED = 720;
  const IMPULSE = 3 * MAX_SPEED;
  const SKATER_CURVE = .06, BALL_CURVE = .045;
  const AIR_DRAG = .00015; // Quadratic drag for balls and ubus; strongest on fast shots.
  const SPIN_DECAY = 5; // Rad/s of spin every body loses each second.
  const STRIKE_GAIN = 1, CLOSE_SPIN_GAIN = 2; // Spin strike multiplier from range and at point blank.
  const STRIKE_POWER = .5; // Point-blank strike's extra ball speed at full spin, as a share of the ubu's speed.
  const GUARD_BRAKE = .25; // Share of velocity and spin a guarding ubu keeps when its turn starts.
  function ballHitRadius(body) { return Math.max(body.radius, body.reach || body.radius, 18); }
  const SUPERS = Object.freeze([
    { id: 0, key: 'stalwart', name: 'Stalwart', desc: 'Become an immovable anchor for this turn.', icon: 'assets/00_stalwart.png' },
    { id: 1, key: 'knockout', name: 'Knockout', desc: 'Knock out the next opponent touched; they cannot move next turn.', icon: 'assets/01_knockout.png' },
    { id: 2, key: 'sticky', name: 'Sticky', desc: 'Grab onto the ball on contact and hold possession.', icon: 'assets/02_sticky.png' },
    { id: 3, key: 'cannonball', name: 'Cannonball', desc: 'Blast the ball with explosive impulse on contact.', icon: 'assets/03_cannonball.png' },
    { id: 4, key: 'magnet', name: 'Magnet', desc: 'Pull the ball toward you while moving across the rink.', icon: 'assets/04_magnet.png' },
    { id: 5, key: 'colossus', name: 'Colossus', desc: 'Swell in size and mass for massive coverage.', icon: 'assets/05_colossus.png' },
    { id: 6, key: 'shockwave', name: 'Shockwave', desc: 'Release a radial shockwave repelling players and the ball.', icon: 'assets/06_shockwave.png' },
    { id: 7, key: 'ghost', name: 'Ghost', desc: 'Phase through opposing players without collision.', icon: 'assets/07_ghost.png' }
  ]);
  function multiplier(raw) {
    if (!Number.isInteger(raw) || raw < 0 || raw > 255) throw new RangeError('Stat must be an integer from 0 to 255.');
    // Exponential: every stat point changes the result by the same percentage, so mid-range
    // stats matter as much as extremes. 0 = 2/3×, 127 = 1×, 255 = 1.5×.
    return raw < 127 ? (2 / 3) ** ((127 - raw) / 127) : 1.5 ** ((raw - 127) / 128);
  }
  function applyStats(body, raw = {}) {
    const size = multiplier(raw.size ?? 127);
    body.mass = 3 * multiplier(raw.mass ?? 127);
    body.radius = 25 * size;
    body.baseMass = body.mass;
    body.baseRadius = body.radius;
    // Bigger ubus drag more on the ice and through the air, in proportion to size (tuning): a
    // counterweight to the reach and coverage their size gives them.
    body.friction = 150 * multiplier(raw.traction ?? 127) * size;
    body.drag = AIR_DRAG * size;
    body.maxSpin = 10 * multiplier(raw.spin ?? 127);
    body.grip = .3 * multiplier(raw.grip ?? 127);
    body.impulse = IMPULSE * multiplier(raw.impulse ?? 127);
    body.curveFactor = SKATER_CURVE * multiplier(raw.curve ?? 127);
    body.bounciness = multiplier(raw.bounciness ?? 127);
    body.power = multiplier(raw.power ?? 127);
    body.reach = Math.max(body.radius, 25 * multiplier(raw.reach ?? 127), 18);
    body.strength = multiplier(raw.strength ?? 127);
    body.stability = multiplier(raw.stability ?? 127);
  }
  function kickoff() {
    const bodies = [];
    for (let team = 0; team < 2; team++) for (let i = 0; i < 3; i++) {
      bodies.push({ x: team ? (i === 0 ? 820 : 690) : (i === 0 ? 180 : 310),
        y: i === 0 ? 300 : i === 1 ? 180 : 420, vx: 0, vy: 0,
        radius: 25, mass: 3, friction: 150, grip: .3, maxSpin: 10, omega: 0, rotation: 0, team, slot: i });
    }
    bodies.push({ x: 500, y: 300, vx: 0, vy: 0, radius: 18, mass: 1, friction: 85, grip: .3, maxSpin: 8, curveFactor: BALL_CURVE, omega: 0, rotation: 0, team: -1 });
    return bodies;
  }
  function reflect(b, nx, ny, penetration, wallType = 'wall', onWall = null) {
    b.x -= nx * penetration; b.y -= ny * penetration;
    const velocity = b.vx * nx + b.vy * ny;
    if (velocity > 0) {
      b.spinStrike = 0; // A wall bounce spends a launching ubu's spin strike.
      b.vx -= 1.82 * velocity * nx; b.vy -= 1.82 * velocity * ny;
      const tx = -ny, ty = nx;
      const slip = b.vx * tx + b.vy * ty + b.omega * b.radius;
      const limit = b.grip * 1.82 * velocity * b.mass;
      const impulse = Math.max(-limit, Math.min(limit, -slip * b.mass / 3));
      b.vx += impulse * tx / b.mass; b.vy += impulse * ty / b.mass;
      b.omega += 2 * impulse / (b.mass * b.radius);
      b.omega *= 0.5; // Dampen spin on wall contact so balls don't curve right back into the wall
      if (typeof onWall === 'function') onWall(b, velocity, wallType, nx, ny);
    }
  }
  function walls(b, onWall = null) {
    const r = b.radius, k = rink;
    const inGoalY = b.y > k.goalTop && b.y < k.goalBottom;

    if (inGoalY) {
      if (b.x < k.left) {
        const backX = k.left - k.goalDepth + r;
        if (b.x < backX) {
          reflect(b, -1, 0, backX - b.x, 'net', onWall);
          if (b.team === -1) { b.vx *= 0.1; b.vy *= 0.1; }
        }
        if (b.y < k.goalTop + r) reflect(b, 0, -1, k.goalTop + r - b.y, 'net', onWall);
        if (b.y > k.goalBottom - r) reflect(b, 0, 1, b.y - (k.goalBottom - r), 'net', onWall);
      } else if (b.x < k.left + r) {
        for (const y of [k.goalTop, k.goalBottom]) {
          const dx = k.left - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < r * r && d2 > 0) { const d = Math.sqrt(d2); reflect(b, dx / d, dy / d, r - d, 'post', onWall); }
        }
      }
    } else {
      if (b.x < k.left + r) reflect(b, -1, 0, k.left + r - b.x, 'wall', onWall);
    }

    if (inGoalY) {
      if (b.x > k.right) {
        const backX = k.right + k.goalDepth - r;
        if (b.x > backX) {
          reflect(b, 1, 0, b.x - backX, 'net', onWall);
          if (b.team === -1) { b.vx *= 0.1; b.vy *= 0.1; }
        }
        if (b.y < k.goalTop + r) reflect(b, 0, -1, k.goalTop + r - b.y, 'net', onWall);
        if (b.y > k.goalBottom - r) reflect(b, 0, 1, b.y - (k.goalBottom - r), 'net', onWall);
      } else if (b.x > k.right - r) {
        for (const y of [k.goalTop, k.goalBottom]) {
          const dx = k.right - b.x, dy = y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < r * r && d2 > 0) { const d = Math.sqrt(d2); reflect(b, dx / d, dy / d, r - d, 'post', onWall); }
        }
      }
    } else {
      if (b.x > k.right - r) reflect(b, 1, 0, b.x - k.right + r, 'wall', onWall);
    }

    const insidePocket = (b.x < k.left) || (b.x > k.right);
    if (!insidePocket) {
      if (b.y < k.top + r) reflect(b, 0, -1, k.top + r - b.y, 'wall', onWall);
      if (b.y > k.bottom - r) reflect(b, 0, 1, b.y - k.bottom + r, 'wall', onWall);
      const cx = b.x < k.left + k.corner ? k.left + k.corner : b.x > k.right - k.corner ? k.right - k.corner : null;
      const cy = b.y < k.top + k.corner ? k.top + k.corner : b.y > k.bottom - k.corner ? k.bottom - k.corner : null;
      if (cx !== null && cy !== null) {
        const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy, limit = k.corner - r;
        if (limit < 0 || d2 > limit * limit) { const d = Math.sqrt(d2); reflect(b, dx / d, dy / d, d - limit, 'wall', onWall); }
      }
    }
  }
  function triggerShockwave(source, bodies, onShockwave) {
    const radius = 220;
    for (const b of bodies) {
      if (b === source || b.superActive === 'stalwart') continue;
      const dx = b.x - source.x, dy = b.y - source.y, d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < radius * radius) {
        const d = Math.sqrt(d2);
        const force = (1 - d / radius) * 1100;
        const m = b.mass || 1;
        b.vx += (dx / d) * force / m;
        b.vy += (dy / d) * force / m;
      }
    }
    if (typeof onShockwave === 'function') onShockwave(source, radius);
  }
  function collide(a, b, onCollide = null, allBodies = null, onShockwave = null, onSuper = null) {
    const isBall = a.team === -1 || b.team === -1;
    if (!isBall && a.team !== b.team && (a.superActive === 'ghost' || b.superActive === 'ghost')) return;

    if (isBall) {
      const player = a.team !== -1 ? a : b;
      const ball = a.team === -1 ? a : b;
      if (ball.stuckTo === player) return;
    }

    const ra = (isBall && a.team !== -1) ? ballHitRadius(a) : a.radius;
    const rb = (isBall && b.team !== -1) ? ballHitRadius(b) : b.radius;
    const dx = b.x - a.x, dy = b.y - a.y, radius = ra + rb;
    const d2 = dx * dx + dy * dy;
    if (d2 > radius * radius) return;
    const d = Math.sqrt(d2);
    // Any ubu contact consumes the opening shot, even a stationary touch. Capture the striker's
    // remaining spin before contact friction changes it; no rebound can re-arm it. The bonus spins
    // the ball against the ubu, the way contact friction already does, like meshing gears.
    // Close in, the strike also drives the ball harder, in proportion to the ubu's spin and speed,
    // so a heavily spun shot still travels.
    let closeSpin = 0, strikeBoost = 0;
    if (isBall) {
      const ball = a.team === -1 ? a : b, player = a.team === -1 ? b : a;
      if (ball.openingShot && player.spinStrike) {
        closeSpin = -player.spinStrike * player.omega;
        strikeBoost = STRIKE_POWER * (player.spinStrike - STRIKE_GAIN) * Math.min(1, Math.abs(player.omega) / player.maxSpin) * Math.hypot(player.vx, player.vy);
      }
      if (closeSpin && allBodies?.some(other => other.team >= 0 && other !== player &&
          (other.x - ball.x) ** 2 + (other.y - ball.y) ** 2 <= (ballHitRadius(other) + ball.radius) ** 2)) closeSpin = strikeBoost = 0;
      ball.openingShot = false;
    } else a.spinStrike = b.spinStrike = 0; // Touching another ubu first spends both strikes.

    if (!isBall && a.team !== b.team) {
      if (a.superActive === 'knockout') { b.stunnedNext = true; a.superActive = null; onSuper?.('knockout', 'impact', a, b); }
      if (b.superActive === 'knockout') { a.stunnedNext = true; b.superActive = null; onSuper?.('knockout', 'impact', b, a); }
    }

    if (allBodies) {
      if (a.superActive === 'shockwave' && !a.shockwaveFired) {
        a.shockwaveFired = true;
        triggerShockwave(a, allBodies, onShockwave);
      }
      if (b.superActive === 'shockwave' && !b.shockwaveFired) {
        b.shockwaveFired = true;
        triggerShockwave(b, allBodies, onShockwave);
      }
    }

    const nx = d ? dx / d : 1, ny = d ? dy / d : 0;
    const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;

    if (isBall) {
      const player = a.team !== -1 ? a : b;
      const ball = a.team === -1 ? a : b;
      if (player.superActive === 'sticky') {
        ball.stuckTo = player;
        onSuper?.('sticky', 'impact', player, ball);
        const ox = ball.x - player.x, oy = ball.y - player.y, od = Math.sqrt(ox * ox + oy * oy) || 1;
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
        if (typeof onCollide === 'function') onCollide(a, b, Math.max(0, -closing), 0);
        return;
      }
    }

    const invA = a.superActive === 'stalwart' ? 0 : 1 / a.mass;
    const invB = b.superActive === 'stalwart' ? 0 : 1 / b.mass;
    const inverse = invA + invB;
    if (inverse === 0) return;

    const correction = (radius - d) / inverse;
    if (invA > 0) { a.x -= nx * correction * invA; a.y -= ny * correction * invA; }
    if (invB > 0) { b.x += nx * correction * invB; b.y += ny * correction * invB; }

    if (closing >= 0) return;
    if (!isBall) {
      if (a.superActive === 'stalwart') onSuper?.('stalwart', 'impact', a, b);
      if (b.superActive === 'stalwart') onSuper?.('stalwart', 'impact', b, a);
    }

    const bounce = ((a.bounciness || 1) + (b.bounciness || 1)) / 2;
    // Restitution describes the rebound, not the entire stopping impulse.
    // Ordinary contacts must never be superelastic, even at maximum stats.
    const restitution = Math.min(1, .88 * bounce);
    const baseImpulse = -(1 + restitution) * closing / inverse;

    let impulseA = baseImpulse, impulseB = baseImpulse;
    if (isBall) {
      if (a.team !== -1 && a.power) impulseB *= a.power;
      else if (b.team !== -1 && b.power) impulseA *= b.power;
    } else {
      const strA = a.strength || 1, stabA = a.stability || 1;
      const strB = b.strength || 1, stabB = b.stability || 1;
      impulseB *= (strA / stabB);
      impulseA *= (strB / stabA);
    }

    // Power/check stats redistribute impact energy; they cannot manufacture it.
    // Preserve tangential motion and bound only the normal collision response.
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

    // Cannonball is an explicit, single-use source of energy for the ball only.
    // Keep its extra impulse out of the ordinary collision's energy budget.
    let cannon = null, cannonImpulse = 0;
    if (isBall) {
      if (a.team !== -1 && a.superActive === 'cannonball') { cannon = a; cannonImpulse = 1.5 * impulseB; }
      else if (b.team !== -1 && b.superActive === 'cannonball') { cannon = b; cannonImpulse = -1.5 * impulseA; }
    }

    if (invA > 0) {
      a.vx -= impulseA * nx * invA; a.vy -= impulseA * ny * invA;
    } else { a.vx = a.vy = a.omega = 0; }
    if (invB > 0) {
      b.vx += impulseB * nx * invB; b.vy += impulseB * ny * invB;
    } else { b.vx = b.vy = b.omega = 0; }

    const tx = -ny, ty = nx;
    const slip = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - a.omega * a.radius - b.omega * b.radius;
    const limit = Math.sqrt(a.grip * b.grip) * baseImpulse;
    const tangent = Math.max(-limit, Math.min(limit, -slip / (3 * inverse)));

    if (invA > 0) {
      a.vx -= tangent * tx * invA; a.vy -= tangent * ty * invA;
      a.omega -= 2 * tangent * invA / a.radius;
    }
    if (invB > 0) {
      b.vx += tangent * tx * invB; b.vy += tangent * ty * invB;
      b.omega -= 2 * tangent * invB / b.radius;
    }

    if (cannon) {
      const ball = a.team === -1 ? a : b;
      ball.vx += cannonImpulse * nx / ball.mass;
      ball.vy += cannonImpulse * ny / ball.mass;
      cannon.superActive = null;
      onSuper?.('cannonball', 'impact', cannon, ball);
    }

    if (closeSpin) {
      const ball = a.team === -1 ? a : b, away = ball === b ? 1 : -1;
      ball.omega = Math.max(-24, Math.min(24, ball.omega + closeSpin));
      // The boost follows the ball's new heading, or straight off the ubu if it was stopped dead.
      const speed = Math.hypot(ball.vx, ball.vy);
      ball.vx += (speed ? ball.vx / speed : nx * away) * strikeBoost;
      ball.vy += (speed ? ball.vy / speed : ny * away) * strikeBoost;
      if (strikeBoost) ball.spinStruck = true; // Read and cleared by the caller, for a callout.
    }

    if (typeof onCollide === 'function') onCollide(a, b, -closing, baseImpulse);
  }
  function step(bodies, dt = DT, onCollide = null, onWall = null, onShockwave = null, onSuper = null) {
    const ball = bodies.find(b => b.team === -1);
    if (ball?.openingShot) {
      // Existing contact must count before motion can separate the bodies.
      // A different ubu already touching also invalidates a close setup.
      const touching = bodies.filter(b => b.team >= 0 && (b.x - ball.x) ** 2 + (b.y - ball.y) ** 2 <= (ballHitRadius(b) + ball.radius) ** 2);
      if (touching.length > 1 || (touching.length === 1 && !touching[0].spinStrike)) ball.openingShot = false;
      if (touching.length === 1) {
        const b = touching[0];
        if ((ball.vx - b.vx) * (ball.x - b.x) + (ball.vy - b.vy) * (ball.y - b.y) >= 0) ball.openingShot = false;
      }
    }
    if (ball && !ball.stuckTo) {
      for (const b of bodies) {
        if (b.team !== -1 && b.superActive === 'magnet') {
          const dx = b.x - ball.x, dy = b.y - ball.y, d2 = dx * dx + dy * dy;
          const minDist = b.radius + ball.radius;
          if (d2 > minDist * minDist && d2 < 260 * 260) {
            const d = Math.sqrt(d2);
            onSuper?.('magnet', 'pull', b);
            const pull = 650 * (1 - d / 260);
            ball.vx += (dx / d) * pull * dt;
            ball.vy += (dy / d) * pull * dt;
          }
        }
      }
    }
    for (const b of bodies) {
      if (b.superActive === 'stalwart') {
        b.vx = b.vy = b.omega = 0;
        continue;
      }
      if (b.team === -1 && b.stuckTo) {
        const host = b.stuckTo;
        const off = b.stickOffset || { x: host.radius + b.radius, y: 0 };
        b.x = host.x + off.x; b.y = host.y + off.y;
        b.vx = host.vx; b.vy = host.vy; b.omega = host.omega;
        continue;
      }
      // Experimental curve: rotate velocity without adding translational energy.
      const curve = b.curveFactor !== undefined ? b.curveFactor : (b.team === -1 ? BALL_CURVE : SKATER_CURVE);
      if (b.omega !== 0) {
        const angle = b.omega * curve * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = b.vx;
        b.vx = vx * cos - b.vy * sin; b.vy = vx * sin + b.vy * cos;
      }
      b.rotation += b.omega * dt;
      b.omega = Math.sign(b.omega) * Math.max(0, Math.abs(b.omega) - SPIN_DECAY * dt);
      b.x += b.vx * dt; b.y += b.vy * dt;
      const speed2 = b.vx * b.vx + b.vy * b.vy, deceleration = (b.friction + (b.drag ?? AIR_DRAG) * speed2) * dt;
      if (speed2 <= deceleration * deceleration) {
        b.vx = b.vy = 0;
      } else {
        const speed = Math.sqrt(speed2);
        const factor = Math.max(0, speed - deceleration) / speed;
        b.vx *= factor; b.vy *= factor;
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        // Bodies further apart than both contact radii cannot touch; collide would return untouched.
        const a = bodies[i], c = bodies[j], reach = ballHitRadius(a) + ballHitRadius(c), dx = a.x - c.x, dy = a.y - c.y;
        if (dx * dx + dy * dy > reach * reach) continue;
        collide(a, c, onCollide, bodies, onShockwave, onSuper);
      }
      for (const b of bodies) {
        if (b.superActive === 'stalwart') {
          b.vx = b.vy = b.omega = 0;
        } else if (b.team !== -1) {
          walls(b, onWall);
        }
      }
      if (ball) {
        if (ball.stuckTo) {
          const host = ball.stuckTo;
          const off = ball.stickOffset || { x: host.radius + ball.radius, y: 0 };
          const ex = host.x + off.x, ey = host.y + off.y;
          ball.x = ex; ball.y = ey;
          ball.vx = host.vx; ball.vy = host.vy; ball.omega = host.omega;
          walls(ball, onWall);
          const dx = ball.x - ex, dy = ball.y - ey;
          if (dx !== 0 || dy !== 0) {
            if (host.superActive !== 'stalwart') {
              host.x += dx; host.y += dy;
              host.vx = ball.vx; host.vy = ball.vy;
              walls(host, onWall);
            }
            const ox = ball.x - host.x, oy = ball.y - host.y, od = Math.hypot(ox, oy) || 1;
            const td = host.radius + ball.radius;
            ball.stickOffset = { x: (ox / od) * td, y: (oy / od) * td };
            ball.x = host.x + ball.stickOffset.x;
            ball.y = host.y + ball.stickOffset.y;
          }
        } else {
          walls(ball, onWall);
        }
      }
    }
    if (ball) {
      const inGoalY = ball.y >= rink.goalTop && ball.y <= rink.goalBottom;
      if (inGoalY) {
        if (ball.x - ball.radius <= rink.left - rink.goalDepth + 1 || ball.x + ball.radius < rink.left) return 1;
        if (ball.x + ball.radius >= rink.right + rink.goalDepth - 1 || ball.x - ball.radius > rink.right) return 0;
      }
    }
    return null;
  }
  function launch(bodies, plans) {
    for (const b of bodies) b.spinStrike = 0;
    bodies.forEach((b, i) => {
      if (b.team < 0) return;
      if (b.stunned) {
        b.vx = 0; b.vy = 0; b.omega = 0;
        b.stunned = false;
        return;
      }
      if (b.superActive === 'stalwart') {
        b.vx = 0; b.vy = 0; b.omega = 0;
        return;
      }
      if (b.superActive === 'colossus' && !b.colossusApplied) {
        b.colossusApplied = true;
        b.radius *= 1.8;
        b.mass *= 2.5;
      }
      if (b.guarding) {
        b.vx *= GUARD_BRAKE; b.vy *= GUARD_BRAKE; b.omega *= GUARD_BRAKE;
        return;
      }
      // A launch steers toward the arrow's velocity using at most one full launch of change,
      // so a moving ubu can turn or brake but its own launches never exceed full-launch speed.
      // From rest this is the plain launch. No power leaves the ubu coasting.
      const plan = plans[i] || { angle: 0, power: 0 };
      const full = (b.impulse || IMPULSE) / b.mass, power = Math.max(0, Math.min(1, plan.power));
      if (power > 0) {
        const dx = Math.cos(plan.angle) * full * power - b.vx, dy = Math.sin(plan.angle) * full * power - b.vy;
        const scale = Math.min(1, full / (Math.hypot(dx, dy) || 1));
        b.vx += dx * scale; b.vy += dy * scale;
      }
      b.omega = Math.max(-b.maxSpin, Math.min(b.maxSpin, b.omega + Math.max(-1, Math.min(1, plan.spin || 0)) * b.maxSpin));
      if (plan.power > 0 && b.omega) b.spinStrike = STRIKE_GAIN;
    });
    // A spinning launch arms a spin strike: if the ball is the first thing the ubu touches, the
    // ball gains the ubu's remaining spin times its gain, counter-rotating, rising to point-blank within 2 ball diameters.
    const ball = bodies.find(b => b.team === -1);
    if (ball) {
      for (const b of bodies) {
        if (!b.spinStrike) continue;
        const gap = Math.max(0, Math.hypot(b.x - ball.x, b.y - ball.y) - ballHitRadius(b) - ball.radius);
        const proximity = Math.max(0, 1 - gap / (4 * ball.radius));
        b.spinStrike += (CLOSE_SPIN_GAIN - STRIKE_GAIN) * proximity * proximity * (3 - 2 * proximity);
      }
      ball.openingShot = bodies.some(b => b.spinStrike);
    }
  }
  function settled(bodies) { return bodies.every(b => b.vx * b.vx + b.vy * b.vy < 4 && Math.abs(b.omega) < .05); }
  // Ends turn effects; keepMotion leaves velocities for a Pulse turn that ends mid-motion.
  function stop(bodies, keepMotion = false) {
    for (const b of bodies) {
      b.spinStrike = 0;
      b.openingShot = false;
      b.spinStruck = false;
      if (b.guardBase) Object.assign(b, b.guardBase);
      b.guardBase = null; b.guarding = false;
      if (!keepMotion) b.vx = b.vy = b.omega = 0;
      if (b.colossusApplied) {
        if (b.baseRadius) b.radius = b.baseRadius;
        if (b.baseMass) b.mass = b.baseMass;
        b.colossusApplied = false;
      }
      b.superActive = null;
      b.shockwaveFired = false;
    }
    const ball = bodies.find(b => b.team === -1);
    if (ball) { ball.stuckTo = null; ball.stickOffset = null; }
  }
  // Follows the ball ahead on a copy of the field (with `removed` taken off it) until it touches an
  // ubu, or the boards unless `boards` allows them (posts and net always count as clear), stops or
  // `ticks` run out. Returns the goal it enters cleanly (as step reports it) or null, and how far it
  // travelled untouched.
  function ballRun(bodies, { removed = null, boards = false, ticks = 960 } = {}) {
    const sim = bodies.filter(b => b !== removed).map(b => ({ ...b, stuckTo: null }));
    const ball = sim.find(b => b.team === -1);
    let clean = Boolean(ball), distance = 0;
    for (let t = 0; t < ticks && clean; t++) {
      const x = ball.x, y = ball.y;
      const goal = step(sim, DT, (a, b) => { if (a === ball || b === ball) clean = false; },
        (b, velocity, type) => { if (b === ball && type === 'wall' && !boards) clean = false; });
      if (clean) distance += Math.hypot(ball.x - x, ball.y - y);
      if (goal !== null) return { goal: clean ? goal : null, distance };
      if (!ball.vx && !ball.vy) break;
    }
    return { goal: null, distance };
  }
  // The goal the ball would enter with one body taken off the field, touching no ubu and no boards.
  function wouldScore(bodies, removed, ticks = 960) { return ballRun(bodies, { removed, ticks }).goal; }
  function segmentBlocked(ax, ay, bx, by, obstacles, clearance = 38) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    if (len2 < 1) return null;
    let best = null, bestT = 2;
    for (const ob of obstacles) {
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
    const ball = bodies[6], humans = bodies.slice(0, 3), players = bodies.slice(3, 6);
    const homeScore = scores?.[0] ?? 0, cpuScore = scores?.[1] ?? 0;
    const deficit = Math.max(0, homeScore - cpuScore);
    const matchPt = (homeScore >= 4 && cpuScore >= 4) ? 1 : (homeScore >= 4 || cpuScore >= 4) ? 0.85 : 0;
    const pressure = Math.min(1, Math.max(deficit === 1 ? 0.45 : deficit === 2 ? 0.75 : deficit >= 3 ? 1 : 0, matchPt));

    const traits = players.map(b => {
      const p = b.personality || {};
      const agg = Math.max(0, Math.min(1, (p.aggression ?? 31.5) / 63));
      const cre = Math.max(0, Math.min(1, (p.creativity ?? 31.5) / 63));
      const tmw = Math.max(0, Math.min(1, (p.teamwork ?? 31.5) / 63));
      const clu = Math.max(0, Math.min(1, (p.clutch ?? 31.5) / 63));
      const surge = pressure * (clu - 0.5) * 2;
      return { agg, cre, tmw, clu, surge };
    });

    const strikeScore = i => {
      const b = players[i], { agg, surge } = traits[i];
      const d = Math.hypot(b.x - ball.x, b.y - ball.y);
      return -d + (b.x >= ball.x - 10 ? 75 : -45) + (agg - 0.5) * 110 + Math.max(0, surge) * 35 - (b.stunned ? 10000 : 0);
    };
    const strikerIdx = [0, 1, 2].reduce((best, i) => strikeScore(i) > strikeScore(best) ? i : best, 0);
    const rem = [0, 1, 2].filter(i => i !== strikerIdx);

    const anchorScore = i => {
      const b = players[i], { agg, surge } = traits[i];
      const sKey = b.equippedSuper?.key || b.superKey;
      const dGoal = Math.hypot(b.x - 850, b.y - 300);
      return (1 - agg) * 170 - dGoal * 0.45 - surge * 40 + (sKey === 'stalwart' ? 60 : 0) + (b.slot === 0 ? 8 : 0);
    };
    const anchorIdx = anchorScore(rem[0]) >= anchorScore(rem[1]) ? rem[0] : rem[1];
    const wingIdx = rem.find(i => i !== anchorIdx);
    const wing = players[wingIdx], wTrait = traits[wingIdx];
    const wingOpenY = ball.y < 300 ? 390 : 210;
    const wingOpenX = Math.max(200, Math.min(760, ball.x - 90 + (1 - wTrait.agg) * 180 - Math.max(0, wTrait.surge) * 70));

    return players.map((b, idx) => {
      if (b.stunned) return { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
      const { agg, cre, tmw, surge } = traits[idx];
      const sKey = b.equippedSuper?.key || b.superKey;
      const canSuper = (b.meter ?? 0) >= 100 && !b.stunned;
      const reachR = Math.max(b.radius, b.reach || b.radius, 18);
      const contactDist = reachR + ball.radius - 2;
      const dBall = Math.hypot(b.x - ball.x, b.y - ball.y);

      let tx = b.x, ty = b.y, spin = 0, superArm = false, extraDrive = 0;

      if (idx === strikerIdx) {
        if (b.x < ball.x - 14) {
          if (canSuper && sKey === 'magnet' && dBall < 245) {
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
          const humanGoalie = humans.reduce((best, h) =>
            Math.hypot(h.x - 120, h.y - 300) < Math.hypot(best.x - 120, best.y - 300) ? h : best, humans[0]);
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
              spin = -shotBlock.side * Math.min(1, 0.45 + cre * 0.55);
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
            else if (sKey === 'magnet' && dBall < 320) superArm = true;
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
          else if (sKey === 'magnet' && ball.x > 650 && dBall < 250) superArm = true;
        }
      } else {
        const nearestThreat = humans.reduce((best, h) =>
          Math.hypot(h.x - ball.x, h.y - ball.y) < Math.hypot(best.x - ball.x, best.y - ball.y) ? h : best, humans[0]);
        const dThreat = nearestThreat ? Math.hypot(b.x - nearestThreat.x, b.y - nearestThreat.y) : 999;

        if (nearestThreat && (agg > tmw + 0.18 || (canSuper && (sKey === 'knockout' || sKey === 'shockwave'))) && dThreat < 280 && nearestThreat.x > 280) {
          tx = nearestThreat.x; ty = nearestThreat.y;
          extraDrive = 150 + agg * 70;
          if (canSuper && (sKey === 'knockout' || sKey === 'shockwave' || sKey === 'colossus')) superArm = true;
        } else {
          tx = wingOpenX; ty = wingOpenY;
          if (cre > 0.5) spin = (ty < 300 ? 0.35 : -0.35) * cre;
          if (canSuper) {
            if (sKey === 'magnet' && dBall < 250) superArm = true;
            else if (sKey === 'ghost' && segmentBlocked(b.x, b.y, tx, ty, humans, 18)) superArm = true;
            else if (sKey === 'colossus' && (dBall < 220 || surge > 0.4)) superArm = true;
          }
        }
      }

      if (superArm && sKey === 'stalwart') {
        return { angle: 0, power: 0, spin: 0, superArm: true, guard: false };
      }

      const dx = tx - b.x, dy = ty - b.y, distance = Math.hypot(dx, dy);
      const effMass = b.mass * (superArm && sKey === 'colossus' ? 2.5 : 1);
      const maxV = (b.impulse || IMPULSE) / effMass;
      let angle = Math.atan2(dy, dx);
      const power = distance < 10 ? 0 : Math.min(1, Math.sqrt(2 * b.friction * Math.max(0, distance + extraDrive)) / maxV);

      if (Math.abs(spin) > 0.01 && power > 0.05) {
        const omega0 = spin * (b.maxSpin || 10);
        const curveF = b.curveFactor ?? SKATER_CURVE;
        const v0 = Math.max(60, power * maxV);
        const estT = Math.min(1.2, distance / (v0 * 0.72));
        const avgOmega = Math.sign(omega0) * Math.max(0, Math.abs(omega0) - SPIN_DECAY / 2 * estT);
        angle -= avgOmega * curveF * estT * 0.5;
      }

      // A baseline ubu with nowhere to go brakes in place.
      if (!power) return { angle: 0, power: 0, spin: 0, superArm: Boolean(superArm), guard: true };
      return { angle, power, spin: Math.max(-1, Math.min(1, spin)), superArm: Boolean(superArm), guard: false };
    });
  }
  // Shared turn preparation for gameplay and prediction. Supers activate before launch.
  function startTurn(bodies, plans, onSuper = null) {
    bodies.forEach((b, i) => {
      if (b.team < 0) return;
      if (b.guardBase) Object.assign(b, b.guardBase);
      b.guardBase = null;
      b.guarding = Boolean(plans[i]?.guard || b.stunned);
      if (b.guarding) {
        b.guardBase = { reach: b.reach, friction: b.friction, strength: b.strength, stability: b.stability, bounciness: b.bounciness };
        b.reach = Math.max(b.radius, Math.min(37.5, (b.reach || b.radius) * 1.25));
        b.friction = Math.min(225, b.friction * 1.25);
        b.strength = Math.min(1.5, (b.strength || 1) * 1.25);
        b.stability = Math.min(1.5, (b.stability || 1) * 1.25);
        b.bounciness = Math.max(2 / 3, (b.bounciness || 1) * .75);
      }
      b.usedSuperThisTurn = Boolean(b.superActive) && !b.stunned;
      if (!b.stunned && (b.superArm || plans[i]?.superArm) && b.meter >= 100) {
        b.usedSuperThisTurn = true;
        b.meter = 0;
        b.superActive = b.equippedSuper.key;
        b.superArm = false;
      }
      if (!b.stunned && ['stalwart', 'colossus', 'ghost'].includes(b.superActive)) {
        onSuper?.(b.superActive, 'launch', b);
      }
    });
    launch(bodies, plans);
  }
  const PREDICTION_TICKS = 480;
  function predictTurn(bodies, plans) {
    // Clone the whole graph so Sticky references point to cloned teammates.
    const sim = structuredClone(bodies);
    const held = { angle: 0, power: 0, spin: 0 };
    const predictedPlans = sim.map((b, i) => {
      if (b.team === 0) return plans[i] || held;
      if (b.team > 0) {
        b.superArm = false;
        b.superActive = null;
        if (b.colossusApplied) {
          b.radius = b.baseRadius; b.mass = b.baseMass; b.colossusApplied = false;
        }
      }
      return held;
    });
    startTurn(sim, predictedPlans);
    const paths = sim.map(b => [{ x: b.x, y: b.y, tick: 0 }]);
    const impacts = [], lastImpact = new Map();
    let goal = null, ticks = 0;
    function recordImpact(b) {
      const index = sim.indexOf(b), last = lastImpact.get(index);
      if (last && (ticks - last.tick < 12 || Math.hypot(b.x - last.x, b.y - last.y) < 8)) return;
      const marker = { index, x: b.x, y: b.y, radius: b.radius, reach: b.team < 0 ? b.radius : Math.max(b.radius, b.reach || b.radius), tick: ticks };
      lastImpact.set(index, marker);
      impacts.push(marker);
    }
    for (let tick = 1; tick <= PREDICTION_TICKS; tick++) {
      ticks = tick;
      goal = step(sim, DT, (a, b) => { recordImpact(a); recordImpact(b); }, recordImpact);
      const done = goal !== null || settled(sim) || tick === PREDICTION_TICKS;
      if (tick % 4 === 0 || done) {
        sim.forEach((b, i) => paths[i].push({ x: b.x, y: b.y, tick }));
      }
      if (done) break;
    }
    return { paths, impacts, stops: sim.map((b, index) => ({ index, x: b.x, y: b.y, stopped: b.vx * b.vx + b.vy * b.vy < 4 })), ticks, goal, horizon: PREDICTION_TICKS };
  }
  const api = { rink, DT, MAX_SPEED, IMPULSE, SUPERS, multiplier, applyStats, kickoff, step, launch, settled, stop, ballRun, wouldScore, triggerShockwave, cpuPlans, startTurn, predictTurn };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallPhysics = api;
})(globalThis);
