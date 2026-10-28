'use strict';
(function (root) {
  const rink = Object.freeze({ left: 60, right: 940, top: 60, bottom: 540, corner: 100, goalTop: 230, goalBottom: 370, goalDepth: 38 });
  const DT = 1 / 240, MAX_SPEED = 720;
  const IMPULSE = 3 * MAX_SPEED;
  const SUPERS = Object.freeze([
    { id: 0, key: 'stalwart', name: 'Stalwart', desc: 'Become an immovable anchor for this turn.', icon: '00_stalwart.png' },
    { id: 1, key: 'knockout', name: 'Knockout', desc: 'Knock out the next opponent touched; they cannot move next turn.', icon: '01_knockout.png' },
    { id: 2, key: 'sticky', name: 'Sticky', desc: 'Grab onto the ball on contact and hold possession.', icon: '02_sticky.png' },
    { id: 3, key: 'cannonball', name: 'Cannonball', desc: 'Blast the ball with explosive impulse on contact.', icon: '03_cannonball.png' },
    { id: 4, key: 'magnet', name: 'Magnet', desc: 'Pull the ball toward you while moving across the rink.', icon: '04_magnet.png' },
    { id: 5, key: 'colossus', name: 'Colossus', desc: 'Swell in size and mass for massive coverage.', icon: '05_colossus.png' },
    { id: 6, key: 'shockwave', name: 'Shockwave', desc: 'Release a radial shockwave repelling players and the ball.', icon: '06_shockwave.png' },
    { id: 7, key: 'ghost', name: 'Ghost', desc: 'Phase through opposing players without collision.', icon: '07_ghost.png' }
  ]);
  function multiplier(raw) {
    if (!Number.isInteger(raw) || raw < 0 || raw > 255) throw new RangeError('Stat must be an integer from 0 to 255.');
    return raw < 127 ? 1 - ((127 - raw) / 127) ** 3 / 3 : 1 + ((raw - 127) / 128) ** 3 / 2;
  }
  function applyStats(body, raw = {}) {
    body.mass = 3 * multiplier(raw.mass ?? 127);
    body.radius = 25 * multiplier(raw.size ?? 127);
    body.baseMass = body.mass;
    body.baseRadius = body.radius;
    body.friction = 150 * multiplier(raw.traction ?? 127);
    body.maxSpin = 8 * multiplier(raw.spin ?? 127);
    body.grip = .3 * multiplier(raw.grip ?? 127);
    body.impulse = IMPULSE * multiplier(raw.impulse ?? 127);
    body.curveFactor = .04 * multiplier(raw.curve ?? 127);
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
        radius: 25, mass: 3, friction: 150, grip: .3, maxSpin: 8, omega: 0, rotation: 0, team, slot: i });
    }
    bodies.push({ x: 500, y: 300, vx: 0, vy: 0, radius: 18, mass: 1, friction: 85, grip: .3, maxSpin: 8, curveFactor: .03, omega: 0, rotation: 0, team: -1 });
    return bodies;
  }
  function reflect(b, nx, ny, penetration, wallType = 'wall', onWall = null) {
    b.x -= nx * penetration; b.y -= ny * penetration;
    const velocity = b.vx * nx + b.vy * ny;
    if (velocity > 0) {
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
      if (b === source) continue;
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
  function collide(a, b, onCollide = null, allBodies = null, onShockwave = null) {
    const isBall = a.team === -1 || b.team === -1;
    if (!isBall && a.team !== b.team && (a.superActive === 'ghost' || b.superActive === 'ghost')) return;

    if (isBall) {
      const player = a.team !== -1 ? a : b;
      const ball = a.team === -1 ? a : b;
      if (ball.stuckTo === player) return;
    }

    const ra = (isBall && a.team !== -1) ? Math.max(a.radius, a.reach || a.radius, 18) : a.radius;
    const rb = (isBall && b.team !== -1) ? Math.max(b.radius, b.reach || b.radius, 18) : b.radius;
    const dx = b.x - a.x, dy = b.y - a.y, radius = ra + rb;
    const d2 = dx * dx + dy * dy;
    if (d2 >= radius * radius) return;
    const d = Math.sqrt(d2);

    if (!isBall && a.team !== b.team) {
      if (a.superActive === 'knockout') { b.stunnedNext = true; a.superActive = null; }
      if (b.superActive === 'knockout') { a.stunnedNext = true; b.superActive = null; }
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

    const bounce = ((a.bounciness || 1) + (b.bounciness || 1)) / 2;
    const baseImpulse = -1.88 * bounce * closing / inverse;

    let impulseA = baseImpulse, impulseB = baseImpulse;
    if (isBall) {
      if (a.team !== -1 && a.power) impulseB *= a.power;
      else if (b.team !== -1 && b.power) impulseA *= b.power;
      if (a.team !== -1 && a.superActive === 'cannonball') { impulseB *= 2.5; a.superActive = null; }
      else if (b.team !== -1 && b.superActive === 'cannonball') { impulseA *= 2.5; b.superActive = null; }
    } else {
      const strA = a.strength || 1, stabA = a.stability || 1;
      const strB = b.strength || 1, stabB = b.stability || 1;
      impulseB *= (strA / stabB);
      impulseA *= (strB / stabA);
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

    if (typeof onCollide === 'function') onCollide(a, b, -closing, baseImpulse);
  }
  function step(bodies, dt = DT, onCollide = null, onWall = null, onShockwave = null) {
    const ball = bodies.find(b => b.team === -1);
    if (ball && !ball.stuckTo) {
      for (const b of bodies) {
        if (b.team !== -1 && b.superActive === 'magnet') {
          const dx = b.x - ball.x, dy = b.y - ball.y, d2 = dx * dx + dy * dy;
          const minDist = b.radius + ball.radius;
          if (d2 > minDist * minDist && d2 < 260 * 260) {
            const d = Math.sqrt(d2);
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
      const curve = b.curveFactor !== undefined ? b.curveFactor : (b.team === -1 ? .03 : .04);
      if (b.omega !== 0) {
        const angle = b.omega * curve * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = b.vx;
        b.vx = vx * cos - b.vy * sin; b.vy = vx * sin + b.vy * cos;
      }
      b.rotation += b.omega * dt;
      b.omega = Math.sign(b.omega) * Math.max(0, Math.abs(b.omega) - 6 * dt);
      b.x += b.vx * dt; b.y += b.vy * dt;
      const speed2 = b.vx * b.vx + b.vy * b.vy, deceleration = b.friction * dt;
      if (speed2 <= deceleration * deceleration) {
        b.vx = b.vy = 0;
      } else {
        const speed = Math.sqrt(speed2);
        const factor = Math.max(0, speed - deceleration) / speed;
        b.vx *= factor; b.vy *= factor;
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) collide(bodies[i], bodies[j], onCollide, bodies, onShockwave);
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
      const plan = plans[i] || { angle: 0, power: 0 };
      const impulse = b.impulse || IMPULSE;
      const speed = impulse / b.mass * Math.max(0, Math.min(1, plan.power));
      b.vx = Math.cos(plan.angle) * speed; b.vy = Math.sin(plan.angle) * speed;
      b.omega = Math.max(-1, Math.min(1, plan.spin || 0)) * b.maxSpin;
    });
  }
  function settled(bodies) { return bodies.every(b => b.vx * b.vx + b.vy * b.vy < 4 && Math.abs(b.omega) < .05); }
  function stop(bodies) {
    for (const b of bodies) {
      b.vx = b.vy = b.omega = 0;
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
  function cpuPlans(bodies, random = Math.random) {
    const ball = bodies[6], players = bodies.slice(3, 6);
    const attacker = players.reduce((a, b) => ((a.x - ball.x) ** 2 + (a.y - ball.y) ** 2) < ((b.x - ball.x) ** 2 + (b.y - ball.y) ** 2) ? a : b);
    return players.map(b => {
      let x, y;
      if (b === attacker) {
        // Approach the right side of the ball when possible, then strike left.
        x = ball.x + (b.x < ball.x ? 65 : 0); y = ball.y + (random() - .5) * 12;
      } else if (b.slot === 0 || players.indexOf(attacker) === 0 && b.slot === 1) {
        x = 850; y = Math.max(245, Math.min(355, ball.y));
      } else { x = Math.min(790, ball.x + 140); y = ball.y < 300 ? 390 : 210; }
      const dx = x - b.x, dy = y - b.y, distance = Math.sqrt(dx * dx + dy * dy);
      return { angle: Math.atan2(y - b.y, x - b.x), power: distance < 10 ? 0 : Math.min(1, Math.sqrt(2 * b.friction * (distance + (b === attacker ? 220 : 0))) / (IMPULSE / b.mass)) };
    });
  }
  function effectiveSuper(b) {
    if (!b || b.team === -1 || b.stunned) return null;
    if (b.superActive) return b.superActive;
    if (b.superArm && (b.meter === undefined || b.meter >= 100)) return b.equippedSuper?.key || null;
    return null;
  }
  function integrateBody(b, dt) {
    const curve = b.curveFactor !== undefined ? b.curveFactor : (b.team === -1 ? .03 : .04);
    if (b.omega !== 0) {
      const angle = b.omega * curve * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = b.vx;
      b.vx = vx * cos - b.vy * sin; b.vy = vx * sin + b.vy * cos;
    }
    b.rotation = (b.rotation || 0) + b.omega * dt;
    b.omega = Math.sign(b.omega) * Math.max(0, Math.abs(b.omega) - 6 * dt);
    b.x += b.vx * dt; b.y += b.vy * dt;
    const speed2 = b.vx * b.vx + b.vy * b.vy, deceleration = b.friction * dt;
    if (speed2 <= deceleration * deceleration) {
      b.vx = b.vy = 0;
    } else {
      const speed = Math.sqrt(speed2);
      const factor = Math.max(0, speed - deceleration) / speed;
      b.vx *= factor; b.vy *= factor;
    }
  }
  function computeTrajectory(body, plan, allBodies) {
    const points = [{ x: body.x, y: body.y, dist: 0 }];
    const impacts = [];
    let ballTrajectory = null;
    const superKey = effectiveSuper(body);
    if (!plan || plan.power <= 0 || body.stunned || superKey === 'stalwart') {
      return { points, impacts, ballTrajectory };
    }
    const isColossus = superKey === 'colossus';
    const baseR = body.baseRadius || body.radius || 25;
    const baseM = body.baseMass || body.mass || 3;
    const r = baseR * (isColossus ? 1.8 : 1);
    const mass = baseM * (isColossus ? 2.5 : 1);
    const reach = Math.max(r, body.reach || r, 18);
    const impulse = body.impulse || IMPULSE;
    const maxSpin = body.maxSpin ?? 8;
    const power = Math.max(0, Math.min(1, plan.power));
    const v0 = (impulse / mass) * power;
    const sim = {
      x: body.x, y: body.y,
      vx: Math.cos(plan.angle) * v0,
      vy: Math.sin(plan.angle) * v0,
      radius: r, baseRadius: baseR,
      mass, baseMass: baseM,
      reach,
      friction: body.friction ?? 150,
      grip: body.grip ?? .3,
      maxSpin,
      curveFactor: body.curveFactor ?? .04,
      bounciness: body.bounciness ?? 1,
      power: body.power ?? 1,
      strength: body.strength ?? 1,
      stability: body.stability ?? 1,
      omega: Math.max(-1, Math.min(1, plan.spin || 0)) * maxSpin,
      rotation: 0,
      team: body.team ?? 0,
      superActive: superKey,
      shockwaveFired: false
    };
    const otherUbus = (allBodies || []).filter(b => b && b.team !== -1 && b !== body).map(other => {
      const oSuper = effectiveSuper(other);
      const oColossus = oSuper === 'colossus';
      return {
        x: other.x, y: other.y, vx: 0, vy: 0, omega: 0,
        radius: (other.baseRadius || other.radius || 25) * (oColossus ? 1.8 : 1),
        mass: (other.baseMass || other.mass || 3) * (oColossus ? 2.5 : 1),
        grip: other.grip ?? .3,
        bounciness: other.bounciness ?? 1,
        strength: other.strength ?? 1,
        stability: other.stability ?? 1,
        team: other.team,
        superActive: oSuper
      };
    });
    const rawBall = (allBodies || []).find(b => b && b.team === -1) || (allBodies || [])[6];
    const simBall = rawBall ? {
      x: rawBall.x, y: rawBall.y, vx: 0, vy: 0,
      radius: rawBall.radius ?? 18,
      mass: rawBall.mass ?? 1,
      friction: rawBall.friction ?? 85,
      grip: rawBall.grip ?? .3,
      maxSpin: rawBall.maxSpin ?? 8,
      curveFactor: rawBall.curveFactor ?? .03,
      bounciness: rawBall.bounciness ?? 1,
      omega: 0, rotation: 0, team: -1,
      stuckTo: null, stickOffset: null
    } : null;

    const MAX_PATH_LEN = 480, MAX_STEPS = 1200;
    let prevX = sim.x, prevY = sim.y, totalDist = 0, simDone = false;
    let prevBallX = simBall ? simBall.x : 0, prevBallY = simBall ? simBall.y : 0;
    let ballDist = 0, ballStarted = false, ballDone = !simBall;
    const ballPoints = simBall ? [{ x: simBall.x, y: simBall.y, dist: 0 }] : [];
    let hasDirectBallImpact = false;

    for (let s = 0; s < MAX_STEPS; s++) {
      if (simDone && ballDone) break;
      if (!simDone && simBall && !simBall.stuckTo && sim.superActive === 'magnet') {
        const dx = sim.x - simBall.x, dy = sim.y - simBall.y, d2 = dx * dx + dy * dy;
        const minDist = sim.radius + simBall.radius;
        if (d2 > minDist * minDist && d2 < 260 * 260) {
          const d = Math.sqrt(d2);
          const pull = 650 * (1 - d / 260);
          simBall.vx += (dx / d) * pull * DT;
          simBall.vy += (dy / d) * pull * DT;
          ballStarted = true;
        }
      }
      if (!simDone) integrateBody(sim, DT);
      if (simBall && !ballDone) {
        if (simBall.stuckTo === sim) {
          const off = simBall.stickOffset || { x: sim.radius + simBall.radius, y: 0 };
          simBall.x = sim.x + off.x; simBall.y = sim.y + off.y;
          simBall.vx = sim.vx; simBall.vy = sim.vy; simBall.omega = sim.omega;
          ballStarted = true;
        } else if (ballStarted) {
          integrateBody(simBall, DT);
        }
      }
      if (!simDone) {
        for (const other of otherUbus) {
          if (other.team !== sim.team && (sim.superActive === 'ghost' || other.superActive === 'ghost')) continue;
          const dx = other.x - sim.x, dy = other.y - sim.y, minDist = sim.radius + other.radius;
          const d2 = dx * dx + dy * dy;
          if (d2 >= minDist * minDist || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          sim.x = other.x - nx * minDist;
          sim.y = other.y - ny * minDist;
          const closing = -sim.vx * nx - sim.vy * ny;
          if (closing < 0) {
            const isKnockout = sim.superActive === 'knockout' && other.team !== sim.team;
            if (isKnockout) sim.superActive = null;
            impacts.push({
              x: other.x - nx * other.radius,
              y: other.y - ny * other.radius,
              type: isKnockout ? 'knockout' : 'ubu'
            });
            if (sim.superActive === 'shockwave' && !sim.shockwaveFired) {
              sim.shockwaveFired = true;
              if (simBall && !ballDone) {
                const bvx = simBall.vx, bvy = simBall.vy;
                triggerShockwave(sim, [sim, simBall]);
                if (simBall.vx !== bvx || simBall.vy !== bvy) ballStarted = true;
              }
            }
            const invA = 1 / sim.mass;
            const invB = other.superActive === 'stalwart' ? 0 : 1 / other.mass;
            const inverse = invA + invB;
            const bounce = ((sim.bounciness || 1) + (other.bounciness || 1)) / 2;
            const baseImpulse = -1.88 * bounce * closing / inverse;
            const impulseA = baseImpulse * ((other.strength || 1) / (sim.stability || 1));
            sim.vx -= impulseA * nx * invA;
            sim.vy -= impulseA * ny * invA;
            const tx = -ny, ty = nx;
            const slip = -sim.vx * tx - sim.vy * ty - sim.omega * sim.radius;
            const limit = Math.sqrt(sim.grip * other.grip) * baseImpulse;
            const tangent = Math.max(-limit, Math.min(limit, -slip / (3 * inverse)));
            sim.vx -= tangent * tx * invA;
            sim.vy -= tangent * ty * invA;
            sim.omega -= 2 * tangent * invA / sim.radius;
          }
        }
      }
      if (!simDone && simBall && !ballDone && simBall.stuckTo !== sim) {
        const dx = simBall.x - sim.x, dy = simBall.y - sim.y;
        const hitRadius = Math.max(sim.radius, sim.reach || sim.radius, 18) + simBall.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 < hitRadius * hitRadius) {
          const d = Math.sqrt(d2) || 1, nx = dx / d, ny = dy / d;
          const reachR = Math.max(sim.radius, sim.reach || sim.radius, 18);
          if (!hasDirectBallImpact) {
            hasDirectBallImpact = true;
            impacts.push({ x: sim.x + nx * reachR, y: sim.y + ny * reachR, type: 'ball' });
          }
          collide(sim, simBall, null, [sim, simBall], null);
          ballStarted = true;
        }
      }
      if (!simDone) walls(sim);
      if (simBall && !ballDone) {
        if (simBall.stuckTo === sim) {
          const off = simBall.stickOffset || { x: sim.radius + simBall.radius, y: 0 };
          const ex = sim.x + off.x, ey = sim.y + off.y;
          simBall.x = ex; simBall.y = ey;
          simBall.vx = sim.vx; simBall.vy = sim.vy; simBall.omega = sim.omega;
          walls(simBall);
          const dx = simBall.x - ex, dy = simBall.y - ey;
          if (dx !== 0 || dy !== 0) {
            sim.x += dx; sim.y += dy;
            sim.vx = simBall.vx; sim.vy = simBall.vy;
            walls(sim);
            const ox = simBall.x - sim.x, oy = simBall.y - sim.y, od = Math.hypot(ox, oy) || 1;
            const td = sim.radius + simBall.radius;
            simBall.stickOffset = { x: (ox / od) * td, y: (oy / od) * td };
            simBall.x = sim.x + simBall.stickOffset.x;
            simBall.y = sim.y + simBall.stickOffset.y;
          }
        } else if (ballStarted) {
          walls(simBall);
        }
      }
      if (!simDone) {
        const stepD = Math.hypot(sim.x - prevX, sim.y - prevY);
        totalDist += stepD;
        prevX = sim.x; prevY = sim.y;
        const speed2 = sim.vx * sim.vx + sim.vy * sim.vy;
        const settledNow = speed2 < 100 && Math.abs(sim.omega) < .05;
        if (s % 4 === 3 || settledNow || totalDist >= MAX_PATH_LEN) {
          points.push({ x: sim.x, y: sim.y, dist: totalDist });
        }
        if (settledNow || totalDist >= MAX_PATH_LEN) {
          simDone = true;
          if (simBall && simBall.stuckTo === sim) ballDone = true;
        }
      }
      if (simBall && ballStarted && !ballDone) {
        const stepBallD = Math.hypot(simBall.x - prevBallX, simBall.y - prevBallY);
        ballDist += stepBallD;
        prevBallX = simBall.x; prevBallY = simBall.y;
        const inGoalY = simBall.y >= rink.goalTop && simBall.y <= rink.goalBottom;
        const isGoal = inGoalY && (
          simBall.x - simBall.radius <= rink.left - rink.goalDepth + 1 || simBall.x + simBall.radius < rink.left ||
          simBall.x + simBall.radius >= rink.right + rink.goalDepth - 1 || simBall.x - simBall.radius > rink.right
        );
        if (isGoal) {
          ballPoints.push({ x: simBall.x, y: simBall.y, dist: ballDist, goal: true });
          ballDone = true;
          if (simBall.stuckTo === sim) simDone = true;
        } else {
          const bSpeed2 = simBall.vx * simBall.vx + simBall.vy * simBall.vy;
          const bSettled = !simBall.stuckTo && bSpeed2 < 144 && Math.abs(simBall.omega) < .05;
          if (s % 4 === 3 || bSettled || ballDist >= MAX_PATH_LEN) {
            ballPoints.push({ x: simBall.x, y: simBall.y, dist: ballDist });
          }
          if (bSettled || ballDist >= MAX_PATH_LEN) ballDone = true;
        }
      }
    }
    if (ballStarted && ballPoints.length > 1) ballTrajectory = ballPoints;
    return { points, impacts, ballTrajectory };
  }
  const api = { rink, DT, MAX_SPEED, IMPULSE, SUPERS, multiplier, applyStats, kickoff, step, launch, settled, stop, triggerShockwave, cpuPlans, computeTrajectory };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallPhysics = api;
})(globalThis);
