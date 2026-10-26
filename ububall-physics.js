'use strict';
(function (root) {
  const rink = Object.freeze({ left: 60, right: 940, top: 60, bottom: 540, corner: 100, goalTop: 230, goalBottom: 370, goalDepth: 38 });
  const DT = 1 / 240, MAX_SPEED = 720;
  const IMPULSE = 3 * MAX_SPEED;
  function multiplier(raw) {
    if (!Number.isInteger(raw) || raw < 0 || raw > 255) throw new RangeError('Stat must be an integer from 0 to 255.');
    return raw < 127 ? 1 - ((127 - raw) / 127) ** 3 / 3 : 1 + ((raw - 127) / 128) ** 3 / 2;
  }
  function applyStats(body, raw = {}) {
    body.mass = 3 * multiplier(raw.mass ?? 127);
    body.radius = 25 * multiplier(raw.size ?? 127);
    body.friction = 150 * multiplier(raw.traction ?? 127);
    body.maxSpin = 8 * multiplier(raw.spin ?? 127);
    body.grip = .3 * multiplier(raw.grip ?? 127);
    body.impulse = IMPULSE * multiplier(raw.impulse ?? 127);
    body.curveFactor = .018 * multiplier(raw.curve ?? 127);
    body.bounciness = multiplier(raw.bounciness ?? 127);
    body.power = multiplier(raw.power ?? 127);
    body.reach = 25 * multiplier(raw.reach ?? 127);
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
    bodies.push({ x: 500, y: 300, vx: 0, vy: 0, radius: 18, mass: 1, friction: 85, grip: .3, maxSpin: 8, curveFactor: .012, omega: 0, rotation: 0, team: -1 });
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
      if (typeof onWall === 'function') onWall(b, velocity, wallType);
    }
  }
  function walls(b, onWall = null) {
    const r = b.radius, k = rink;
    const inGoalY = b.y >= k.goalTop + r && b.y <= k.goalBottom - r;

    if (b.x < k.left + r) {
      if (inGoalY) {
        const backX = k.left - k.goalDepth + r;
        if (b.x < backX) reflect(b, -1, 0, backX - b.x, 'net', onWall);
      } else {
        reflect(b, -1, 0, k.left + r - b.x, 'wall', onWall);
      }
    }
    if (b.x > k.right - r) {
      if (inGoalY) {
        const backX = k.right + k.goalDepth - r;
        if (b.x > backX) reflect(b, 1, 0, b.x - backX, 'net', onWall);
      } else {
        reflect(b, 1, 0, b.x - k.right + r, 'wall', onWall);
      }
    }

    const insidePocket = (b.x < k.left) || (b.x > k.right);
    if (insidePocket) {
      if (b.y < k.goalTop + r) reflect(b, 0, -1, k.goalTop + r - b.y, 'net', onWall);
      if (b.y > k.goalBottom - r) reflect(b, 0, 1, b.y - (k.goalBottom - r), 'net', onWall);
    } else {
      if (b.y < k.top + r) reflect(b, 0, -1, k.top + r - b.y, 'wall', onWall);
      if (b.y > k.bottom - r) reflect(b, 0, 1, b.y - k.bottom + r, 'wall', onWall);
      const cx = b.x < k.left + k.corner ? k.left + k.corner : b.x > k.right - k.corner ? k.right - k.corner : null;
      const cy = b.y < k.top + k.corner ? k.top + k.corner : b.y > k.bottom - k.corner ? k.bottom - k.corner : null;
      if (cx !== null && cy !== null) {
        const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), limit = k.corner - r;
        if (d > limit) reflect(b, dx / d, dy / d, d - limit, 'wall', onWall);
      }
    }

    // Goal posts
    for (const x of [k.left, k.right]) for (const y of [k.goalTop, k.goalBottom]) {
      const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy), limit = r + 5;
      if (d < limit && d > 0) reflect(b, dx / d, dy / d, limit - d, 'post', onWall);
    }
  }
  function collide(a, b, onCollide = null) {
    const isBall = a.team === -1 || b.team === -1;
    const ra = (isBall && a.team !== -1) ? (a.reach || a.radius) : a.radius;
    const rb = (isBall && b.team !== -1) ? (b.reach || b.radius) : b.radius;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), radius = ra + rb;
    if (d >= radius) return;
    const nx = d ? dx / d : 1, ny = d ? dy / d : 0, inverse = 1 / a.mass + 1 / b.mass;
    const correction = (radius - d) / inverse;
    a.x -= nx * correction / a.mass; a.y -= ny * correction / a.mass;
    b.x += nx * correction / b.mass; b.y += ny * correction / b.mass;
    const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (closing >= 0) return;

    const bounce = ((a.bounciness || 1) + (b.bounciness || 1)) / 2;
    const baseImpulse = -1.88 * bounce * closing / inverse;

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

    a.vx -= impulseA * nx / a.mass; a.vy -= impulseA * ny / a.mass;
    b.vx += impulseB * nx / b.mass; b.vy += impulseB * ny / b.mass;
    const tx = -ny, ty = nx;
    const slip = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty - a.omega * a.radius - b.omega * b.radius;
    const limit = Math.sqrt(a.grip * b.grip) * baseImpulse;
    const tangent = Math.max(-limit, Math.min(limit, -slip / (3 * inverse)));
    a.vx -= tangent * tx / a.mass; a.vy -= tangent * ty / a.mass;
    b.vx += tangent * tx / b.mass; b.vy += tangent * ty / b.mass;
    a.omega -= 2 * tangent / (a.mass * a.radius); b.omega -= 2 * tangent / (b.mass * b.radius);
    if (typeof onCollide === 'function') onCollide(a, b, -closing, baseImpulse);
  }
  function step(bodies, dt = DT, onCollide = null, onWall = null) {
    for (const b of bodies) {
      // Experimental curve: rotate velocity without adding translational energy.
      const curve = b.curveFactor !== undefined ? b.curveFactor : .015;
      const angle = b.omega * curve * dt, cos = Math.cos(angle), sin = Math.sin(angle), vx = b.vx;
      b.vx = vx * cos - b.vy * sin; b.vy = vx * sin + b.vy * cos;
      b.rotation += b.omega * dt;
      b.omega = Math.sign(b.omega) * Math.max(0, Math.abs(b.omega) - 6 * dt);
      b.x += b.vx * dt; b.y += b.vy * dt;
      const speed = Math.hypot(b.vx, b.vy), factor = speed ? Math.max(0, speed - b.friction * dt) / speed : 0;
      b.vx *= factor; b.vy *= factor;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) collide(bodies[i], bodies[j], onCollide);
      for (const b of bodies) walls(b, onWall);
    }
    const ball = bodies.find(b => b.team === -1);
    if (ball.y >= rink.goalTop + ball.radius && ball.y <= rink.goalBottom - ball.radius) {
      if (ball.x + ball.radius < rink.left) return 1;
      if (ball.x - ball.radius > rink.right) return 0;
    }
    return null;
  }
  function launch(bodies, plans) {
    bodies.forEach((b, i) => {
      if (b.team < 0) return;
      const plan = plans[i] || { angle: 0, power: 0 };
      const impulse = b.impulse || IMPULSE;
      const speed = impulse / b.mass * Math.max(0, Math.min(1, plan.power));
      b.vx = Math.cos(plan.angle) * speed; b.vy = Math.sin(plan.angle) * speed;
      b.omega = Math.max(-1, Math.min(1, plan.spin || 0)) * b.maxSpin;
    });
  }
  function settled(bodies) { return bodies.every(b => Math.hypot(b.vx, b.vy) < 2 && Math.abs(b.omega) < .05); }
  function stop(bodies) { for (const b of bodies) b.vx = b.vy = b.omega = 0; }
  function cpuPlans(bodies, random = Math.random) {
    const ball = bodies[6], players = bodies.slice(3, 6);
    const attacker = players.reduce((a, b) => Math.hypot(a.x - ball.x, a.y - ball.y) < Math.hypot(b.x - ball.x, b.y - ball.y) ? a : b);
    return players.map(b => {
      let x, y;
      if (b === attacker) {
        // Approach the right side of the ball when possible, then strike left.
        x = ball.x + (b.x < ball.x ? 65 : 0); y = ball.y + (random() - .5) * 12;
      } else if (b.slot === 0 || players.indexOf(attacker) === 0 && b.slot === 1) {
        x = 850; y = Math.max(245, Math.min(355, ball.y));
      } else { x = Math.min(790, ball.x + 140); y = ball.y < 300 ? 390 : 210; }
      const distance = Math.hypot(x - b.x, y - b.y);
      return { angle: Math.atan2(y - b.y, x - b.x), power: distance < 10 ? 0 : Math.min(1, Math.sqrt(2 * b.friction * (distance + (b === attacker ? 220 : 0))) / (IMPULSE / b.mass)) };
    });
  }
  const api = { rink, DT, MAX_SPEED, IMPULSE, multiplier, applyStats, kickoff, step, launch, settled, stop, cpuPlans };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallPhysics = api;
})(globalThis);
