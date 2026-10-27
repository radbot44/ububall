'use strict';
(() => {
  const $ = id => document.getElementById(id), P = ububallPhysics;
  const canvas = $('rink'), ctx = canvas.getContext('2d');
  const ballMark = new Image();
  ballMark.src = 'uburoom-oomark-brand.svg';
  ballMark.onload = () => { if (skaters.length) draw(); };
  const practice = Array.from({ length: 6 }, () => ({ model: ubu.decode(ubu.randomDNA()), label: 'Practice ubu' }));
  let roster = practice.slice(0, 3), draft = [...roster], rosterSlot = 0;
  let bodies = P.kickoff(), plans, cpu, selected = 0, scores = [0, 0], turn = 1, phase = 'plan';
  let elapsed = 0, accumulator = 0, lastTime = 0, drag = null, dragMode = null, dragPoint = null, spinClickStart = null, skaters = [], next = '';
  const radians = value => value * Math.PI / 180;
  const normalStats = () => ({
    impulse: 127, traction: 127, spin: 127, curve: 127,
    size: 127, mass: 127, bounciness: 127, grip: 127,
    power: 127, reach: 127, strength: 127, stability: 127,
    efficiency: 127, synergy: 127, chemistry: 127
  });
  let stats = practice.map(p => ({ ...(p.model.stats || normalStats()) }));
  let lastPlans = null, teamEntries = [...roster, ...practice.slice(3)];
  let lastTouchByTeam = { 0: null, 1: null }, scoringPlayer = null;
  const trails = Array.from({ length: 7 }, () => []), particles = [], fireworks = [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function clearEffects() {
    trails.forEach(trail => { trail.length = 0; });
    particles.length = fireworks.length = 0;
  }
  function burst(x, y, team, strength, celebration = false, tangent = 0) {
    if (reducedMotion.matches) return;
    const count = celebration ? 64 : Math.round(3 + strength * 4);
    for (let i = 0; i < count && particles.length < 400; i++) {
      const angle = celebration ? Math.random() * Math.PI * 2
        : tangent + (i % 2 ? Math.PI : 0) + (Math.random() - .5) * .6;
      const speed = celebration ? 60 + Math.random() * 190 : 20 + Math.random() * (35 + strength * 65);
      const life = celebration ? .8 + Math.random() * .8 : .14 + Math.random() * .16;
      particles.push({ x, y, px: x, py: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        team: i % 5 === 0 ? -1 : team, life, duration: life, celebration });
    }
  }
  function updateEffects(dt) {
    if (reducedMotion.matches) { clearEffects(); return; }
    for (const trail of trails) {
      for (const point of trail) point.life -= dt;
      while (trail.length && trail[0].life <= 0) trail.shift();
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.px = p.x; p.py = p.y;
      const drag = Math.exp(-dt * (p.celebration ? 1.2 : 4));
      p.vx *= drag; p.vy = p.vy * drag + (p.celebration ? 95 : 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const f = fireworks[i]; f.delay -= dt;
      if (f.delay <= 0) { burst(f.x, f.y, f.team, 1, true); fireworks.splice(i, 1); }
    }
  }
  function recordTrails() {
    if (reducedMotion.matches) return;
    bodies.forEach((b, i) => {
      if (Math.hypot(b.vx, b.vy) < 25) return;
      const trail = trails[i], previous = trail[trail.length - 1];
      if (!previous || Math.hypot(b.x - previous.x, b.y - previous.y) >= 3) {
        const duration = .24; // Fixed lifetime makes trail length follow speed, not body size.
        trail.push({ x: b.x, y: b.y, life: duration, duration });
        if (trail.length > 40) trail.shift();
      }
    });
  }
  function drawTrails(primary, secondary) {
    ctx.save(); ctx.lineCap = 'round';
    trails.forEach((trail, index) => {
      const b = bodies[index], color = b.team === -1 ? '#ffffff' : b.team === 0 ? primary : secondary;
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i], end = trail[i + 1] || b, fade = Math.max(0, p.life / p.duration);
        ctx.globalAlpha = fade * .23;
        line(p.x, p.y, end.x, end.y, color, b.radius * 2 * fade);
      }
    });
    ctx.restore();
  }
  function drawParticles(primary, secondary) {
    ctx.save(); ctx.lineCap = 'round';
    for (const p of particles) {
      const color = p.team === -1 ? '#ffffff' : p.team === 0 ? primary : secondary;
      ctx.globalAlpha = Math.min(1, p.life / p.duration * 2) * (p.celebration ? 1 : .65);
      ctx.shadowColor = color;
      ctx.shadowBlur = p.celebration ? 12 * canvas.width / 1000 : 0;
      line(p.px, p.py, p.x, p.y, color, p.celebration ? 2.5 : 1.3);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, p.celebration ? 1.8 : .9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function kickoff() {
    clearEffects();
    lastTouchByTeam = { 0: null, 1: null }; scoringPlayer = null;
    const result = P.kickoff();
    result.slice(0, 6).forEach((b, i) => {
      P.applyStats(b, stats[i]);
      const entry = teamEntries[i] || practice[i];
      if (entry?.model) {
        b.playerIndex = i;
        b.voice = entry.model.voice;
        b.name = entry.model.parts?.fullName;
      }
    });
    return result;
  }
  function say(message) { $('game-status').textContent = message; }
  function resetPlans() {
    plans = Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0 }));
    cpu = P.cpuPlans(bodies); // Commit before any human planning input.
    sync();
  }
  function sync() {
    const planning = phase === 'plan';
    $('phase').textContent = phase === 'over' ? 'Match complete' : `${planning ? 'Plan' : phase === 'goal' ? 'Goal' : 'In play'} · Turn ${turn}`;
    $('home-score').textContent = scores[0]; $('away-score').textContent = scores[1];
    for (const id of ['angle', 'power', 'shot-spin', 'hold', 'launch']) $(id).disabled = !planning;
    for (const node of $('stat-testing').querySelectorAll('input, select, button')) node.disabled = phase === 'play';
    $('restore-shot').disabled = phase === 'play' || !lastPlans;
    if (!readStats()) $('apply-stats').disabled = true;
    $('launch').textContent = 'Launch';
    const angle = Math.round((plans[selected].angle * 180 / Math.PI + 360) % 360);
    $('angle').value = angle; $('angle-value').value = angle + '°';
    $('power').value = Math.round(plans[selected].power * 100); $('power-value').value = $('power').value + '%';
    $('shot-spin').value = Math.round((plans[selected].spin || 0) * 100); $('shot-spin-value').value = $('shot-spin').value + '%';
    [...$('team').children].forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === selected)); button.disabled = !planning;
      button.querySelector('small').textContent = `${Math.round(plans[i].power * 100)}% power · ${Math.round((plans[i].spin || 0) * 100)}% spin`;
    });
  }
  function buildTeam() {
    $('team').replaceChildren(); $('skaters').replaceChildren();
    teamEntries = [...roster, ...practice.slice(3)];
    teamEntries.forEach((entry, i) => {
      if (entry.model && entry.model.stats) stats[i] = { ...entry.model.stats };
    });
    skaters = teamEntries.map((entry, i) => {
      const node = document.createElement('div'); node.className = 'skater'; node.append(ubuRender(entry.model, 'ball-ubu')); $('skaters').append(node);
      if (i < 3) {
        const button = document.createElement('button'), text = document.createElement('span'), small = document.createElement('small');
        text.textContent = `${i + 1}. ${entry.model.parts.fullName}`; text.append(small); button.append(ubuRender(entry.model, 'ball-thumb'), text);
        button.onclick = () => { selected = i; sync(); draw(); }; $('team').append(button);
      }
      return node;
    });
  }
  function newMatch() {
    window.ubuAudio?.stop();
    roster = [...draft]; buildTeam(); bodies = kickoff(); scores = [0, 0]; turn = 1; selected = 0; phase = 'plan'; elapsed = accumulator = 0; drag = null;
    resetPlans(); say('Pull back from an ubu to aim and launch, or turn its spin dial.'); draw();
  }
  function rounded(x, y, width, height, radius) { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); }
  function line(x1, y1, x2, y2, color, width = 2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  function circle(x, y, r, color, width = 2) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  function computeBallTrajectory(startX, startY, initVx, initVy, initialSpin) {
    const points = [{ x: startX, y: startY, dist: 0 }];
    let currX = startX, currY = startY;
    let vx = initVx, vy = initVy;
    let omega = (initialSpin || 0) * 8;
    const curve = 0.03;
    const friction = 85;
    const r = 18;
    const k = P.rink;
    const dt = 1 / 120;
    const MAX_PATH_LEN = 480;
    let totalDist = 0;

    for (let s = 0; s < 480; s++) {
      const angle = omega * curve * dt;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const nvx = vx * cos - vy * sin, nvy = vx * sin + vy * cos;
      vx = nvx; vy = nvy;
      omega = Math.sign(omega) * Math.max(0, Math.abs(omega) - 6 * dt);
      currX += vx * dt; currY += vy * dt;

      // Check goal
      const inGoalY = currY >= k.goalTop && currY <= k.goalBottom;
      if (inGoalY) {
        if (currX - r <= k.left - k.goalDepth + 1 || currX + r < k.left ||
            currX + r >= k.right + k.goalDepth - 1 || currX - r > k.right) {
          totalDist += Math.hypot(currX - points[points.length - 1].x, currY - points[points.length - 1].y);
          points.push({ x: currX, y: currY, dist: totalDist, goal: true });
          break;
        }
      }

      // Walls
      if (inGoalY) {
        if (currX < k.left) {
          const backX = k.left - k.goalDepth + r;
          if (currX < backX) { currX = backX; vx = -vx * 0.2; }
          if (currY < k.goalTop + r) { currY = k.goalTop + r; vy = -vy * 0.5; }
          if (currY > k.goalBottom - r) { currY = k.goalBottom - r; vy = -vy * 0.5; }
        }
        if (currX > k.right) {
          const backX = k.right + k.goalDepth - r;
          if (currX > backX) { currX = backX; vx = -vx * 0.2; }
          if (currY < k.goalTop + r) { currY = k.goalTop + r; vy = -vy * 0.5; }
          if (currY > k.goalBottom - r) { currY = k.goalBottom - r; vy = -vy * 0.5; }
        }
      } else {
        if (currX < k.left + r) { currX = k.left + r; vx = -vx * 0.8; }
        if (currX > k.right - r) { currX = k.right - r; vx = -vx * 0.8; }
      }

      const insidePocket = (currX < k.left) || (currX > k.right);
      if (!insidePocket) {
        if (currY < k.top + r) { currY = k.top + r; vy = -vy * 0.8; }
        if (currY > k.bottom - r) { currY = k.bottom - r; vy = -vy * 0.8; }
        const cx = currX < k.left + k.corner ? k.left + k.corner : currX > k.right - k.corner ? k.right - k.corner : null;
        const cy = currY < k.top + k.corner ? k.top + k.corner : currY > k.bottom - k.corner ? k.bottom - k.corner : null;
        if (cx !== null && cy !== null) {
          const dx = currX - cx, dy = currY - cy, d = Math.hypot(dx, dy), limit = k.corner - r;
          if (d > limit) {
            const nx = dx / d, ny = dy / d;
            currX -= nx * (d - limit); currY -= ny * (d - limit);
            const v = vx * nx + vy * ny;
            if (v > 0) { vx -= 1.82 * v * nx; vy -= 1.82 * v * ny; }
          }
        }
      }

      const speed = Math.hypot(vx, vy);
      if (speed < 12) break;
      const factor = Math.max(0, speed - friction * dt) / speed;
      vx *= factor; vy *= factor;

      const prev = points[points.length - 1];
      const stepD = Math.hypot(currX - prev.x, currY - prev.y);
      totalDist += stepD;
      if (s % 2 === 1 || s === 479 || totalDist >= MAX_PATH_LEN) {
        points.push({ x: currX, y: currY, dist: totalDist });
      }
      if (totalDist >= MAX_PATH_LEN) break;
    }
    return points;
  }
  function computeTrajectory(body, plan, allBodies) {
    const points = [{ x: body.x, y: body.y, dist: 0 }];
    const impacts = [];
    let ballTrajectory = null;
    if (!plan || plan.power <= 0) return { points, impacts, ballTrajectory };

    const impulse = body.impulse || P.IMPULSE;
    const v0 = (impulse / body.mass) * plan.power;
    let vx = Math.cos(plan.angle) * v0;
    let vy = Math.sin(plan.angle) * v0;
    let omega = (plan.spin || 0) * (body.maxSpin || 8);
    const curve = body.curveFactor !== undefined ? body.curveFactor : 0.04;
    const friction = body.friction || 150;
    let currX = body.x, currY = body.y;
    const r = body.radius;
    const reach = Math.max(r, body.reach || r, 18);
    const k = P.rink;
    const dt = 1 / 120;
    const MAX_PATH_LEN = 480;
    let totalDist = 0;
    let hasHitBall = false;

    const otherUbus = (allBodies || []).slice(0, 6).filter(b => b !== body);
    const ball = (allBodies || [])[6];

    for (let s = 0; s < 600; s++) {
      const angle = omega * curve * dt;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const nvx = vx * cos - vy * sin;
      const nvy = vx * sin + vy * cos;
      vx = nvx; vy = nvy;
      omega = Math.sign(omega) * Math.max(0, Math.abs(omega) - 6 * dt);
      currX += vx * dt; currY += vy * dt;

      // Walls
      const inGoalY = currY > k.goalTop && currY < k.goalBottom;
      if (inGoalY) {
        if (currX < k.left) {
          const backX = k.left - k.goalDepth + r;
          if (currX < backX) { currX = backX; vx = -vx * 0.5; omega *= 0.5; }
          if (currY < k.goalTop + r) { currY = k.goalTop + r; vy = -vy * 0.5; omega *= 0.5; }
          if (currY > k.goalBottom - r) { currY = k.goalBottom - r; vy = -vy * 0.5; omega *= 0.5; }
        } else if (currX < k.left + r) {
          for (const py of [k.goalTop, k.goalBottom]) {
            const dx = k.left - currX, dy = py - currY, d = Math.hypot(dx, dy);
            if (d < r && d > 0) {
              const nx = dx / d, ny = dy / d;
              currX -= nx * (r - d); currY -= ny * (r - d);
              const v = vx * nx + vy * ny;
              if (v > 0) { vx -= 1.82 * v * nx; vy -= 1.82 * v * ny; omega *= 0.5; }
            }
          }
        }
        if (currX > k.right) {
          const backX = k.right + k.goalDepth - r;
          if (currX > backX) { currX = backX; vx = -vx * 0.5; omega *= 0.5; }
          if (currY < k.goalTop + r) { currY = k.goalTop + r; vy = -vy * 0.5; omega *= 0.5; }
          if (currY > k.goalBottom - r) { currY = k.goalBottom - r; vy = -vy * 0.5; omega *= 0.5; }
        } else if (currX > k.right - r) {
          for (const py of [k.goalTop, k.goalBottom]) {
            const dx = k.right - currX, dy = py - currY, d = Math.hypot(dx, dy);
            if (d < r && d > 0) {
              const nx = dx / d, ny = dy / d;
              currX -= nx * (r - d); currY -= ny * (r - d);
              const v = vx * nx + vy * ny;
              if (v > 0) { vx -= 1.82 * v * nx; vy -= 1.82 * v * ny; omega *= 0.5; }
            }
          }
        }
      } else {
        if (currX < k.left + r) { currX = k.left + r; vx = -vx * 0.8; omega *= 0.5; }
        if (currX > k.right - r) { currX = k.right - r; vx = -vx * 0.8; omega *= 0.5; }
      }

      const insidePocket = (currX < k.left) || (currX > k.right);
      if (!insidePocket) {
        if (currY < k.top + r) { currY = k.top + r; vy = -vy * 0.8; omega *= 0.5; }
        if (currY > k.bottom - r) { currY = k.bottom - r; vy = -vy * 0.8; omega *= 0.5; }
        const cx = currX < k.left + k.corner ? k.left + k.corner : currX > k.right - k.corner ? k.right - k.corner : null;
        const cy = currY < k.top + k.corner ? k.top + k.corner : currY > k.bottom - k.corner ? k.bottom - k.corner : null;
        if (cx !== null && cy !== null) {
          const dx = currX - cx, dy = currY - cy, d = Math.hypot(dx, dy), limit = k.corner - r;
          if (d > limit) {
            const nx = dx / d, ny = dy / d;
            currX -= nx * (d - limit); currY -= ny * (d - limit);
            const v = vx * nx + vy * ny;
            if (v > 0) { vx -= 1.82 * v * nx; vy -= 1.82 * v * ny; omega *= 0.5; }
          }
        }
      }

      // 3. Collision with other Ubus (stationary)
      for (const other of otherUbus) {
        const dx = currX - other.x, dy = currY - other.y, d = Math.hypot(dx, dy);
        const minDist = r + other.radius;
        if (d < minDist && d > 0) {
          const nx = dx / d, ny = dy / d;
          currX = other.x + nx * minDist;
          currY = other.y + ny * minDist;
          const vClosing = -(vx * nx + vy * ny);
          if (vClosing > 0) {
            impacts.push({ x: other.x + nx * other.radius, y: other.y + ny * other.radius, type: 'ubu' });
            const bounce = ((body.bounciness || 1) + (other.bounciness || 1)) / 2;
            const impulseMag = 1.8 * bounce * vClosing * (other.mass / (body.mass + other.mass));
            vx += impulseMag * nx; vy += impulseMag * ny;
            omega *= 0.5;
          }
        }
      }

      // 4. Collision with ball (stationary)
      if (ball && !hasHitBall) {
        const dx = ball.x - currX, dy = ball.y - currY, d = Math.hypot(dx, dy);
        const minDist = reach + ball.radius;
        if (d < minDist && d > 0) {
          hasHitBall = true;
          const nx = dx / d, ny = dy / d;
          const contactX = currX + nx * reach;
          const contactY = currY + ny * reach;
          impacts.push({ x: contactX, y: contactY, type: 'ball' });

          const vClosing = vx * nx + vy * ny;
          if (vClosing > 0) {
            const inverse = 1 / body.mass + 1 / ball.mass;
            const bounce = ((body.bounciness || 1) + 1) / 2;
            const baseImpulse = 1.88 * bounce * vClosing / inverse;
            const impulseToBall = baseImpulse * (body.power || 1);
            const ballVx = impulseToBall * nx / ball.mass;
            const ballVy = impulseToBall * ny / ball.mass;

            ballTrajectory = computeBallTrajectory(ball.x, ball.y, ballVx, ballVy, body.spin || 0);

            vx -= baseImpulse * nx / body.mass;
            vy -= baseImpulse * ny / body.mass;
            omega *= 0.5;
          }
        }
      }

      const speed = Math.hypot(vx, vy);
      if (speed < 10) break;
      const factor = Math.max(0, speed - friction * dt) / speed;
      vx *= factor; vy *= factor;

      const prev = points[points.length - 1];
      const stepD = Math.hypot(currX - prev.x, currY - prev.y);
      totalDist += stepD;
      if (s % 2 === 1 || s === 599 || totalDist >= MAX_PATH_LEN) {
        points.push({ x: currX, y: currY, dist: totalDist });
      }
      if (totalDist >= MAX_PATH_LEN) break;
    }
    return { points, impacts, ballTrajectory };
  }
  function drawTrajectory(body, plan, trajectoryData, color) {
    const points = trajectoryData?.points || [];
    if (points.length < 2) return;
    const impulse = body.impulse || P.IMPULSE;
    const impulseRatio = impulse / P.IMPULSE;
    const ringR = Math.max(body.radius, body.reach || body.radius, 18) + 2;
    const maxArrowDist = Math.max(20, 110 * impulseRatio * plan.power);
    const targetEndDist = ringR + maxArrowDist;

    function getPointAtDist(targetD) {
      if (targetD <= 0) return { x: points[0].x, y: points[0].y, idx: 0 };
      for (let i = 1; i < points.length; i++) {
        if (points[i].dist >= targetD) {
          const p0 = points[i - 1], p1 = points[i];
          const t = (targetD - p0.dist) / (p1.dist - p0.dist || 1);
          return {
            x: p0.x + (p1.x - p0.x) * t,
            y: p0.y + (p1.y - p0.y) * t,
            idx: i
          };
        }
      }
      const last = points[points.length - 1];
      const prev = points[points.length - 2] || { x: body.x, y: body.y };
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      const extra = targetD - last.dist;
      return {
        x: last.x + Math.cos(angle) * extra,
        y: last.y + Math.sin(angle) * extra,
        idx: points.length
      };
    }

    const basePt = getPointAtDist(ringR);
    const endPt = getPointAtDist(targetEndDist);

    // 1. Solid arrow starting from basePt at the hitbox ring up to endPt
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(basePt.x, basePt.y);
    for (let i = basePt.idx; i < Math.min(endPt.idx, points.length); i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.lineTo(endPt.x, endPt.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Arrowhead at endPt
    const pPrev = (endPt.idx > basePt.idx && endPt.idx - 1 < points.length) ? points[endPt.idx - 1] : basePt;
    const tipAngle = Math.atan2(endPt.y - pPrev.y, endPt.x - pPrev.x);
    for (const offset of [-0.55, 0.55]) {
      line(endPt.x, endPt.y, endPt.x - Math.cos(tipAngle + offset) * 14, endPt.y - Math.sin(tipAngle + offset) * 14, color, 4);
    }
    ctx.restore();

    // 2. Dashed trajectory line beyond endPt, fading away at about a rink-height (480px)
    if (endPt.idx < points.length) {
      const d = points[endPt.idx].dist;
      const alpha = Math.max(0, Math.min(1, (480 - d) / 180));
      if (alpha > 0.01) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(endPt.x, endPt.y);
        ctx.lineTo(points[endPt.idx].x, points[endPt.idx].y);
        ctx.stroke();
        ctx.restore();
      }
      for (let i = endPt.idx + 1; i < points.length; i++) {
        const d = points[i].dist;
        const alpha = Math.max(0, Math.min(1, (480 - d) / 180));
        if (alpha <= 0.01) continue;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(points[i - 1].x, points[i - 1].y);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 3. Terminating small circle if path stopped naturally
    const finalPt = points[points.length - 1];
    if (finalPt.dist < 460) {
      circle(finalPt.x, finalPt.y, 4, color, 2);
    }

    // 4. Ball trajectory (if ball is hit)
    const ballTrajectory = trajectoryData?.ballTrajectory;
    if (ballTrajectory && ballTrajectory.length > 1) {
      for (let i = 1; i < ballTrajectory.length; i++) {
        const d = ballTrajectory[i].dist;
        const alpha = Math.max(0, Math.min(1, (480 - d) / 180));
        if (alpha <= 0.01) continue;
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = '#f2efe9';
        ctx.globalAlpha = alpha * 0.9;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(ballTrajectory[i - 1].x, ballTrajectory[i - 1].y);
        ctx.lineTo(ballTrajectory[i].x, ballTrajectory[i].y);
        ctx.stroke();
        ctx.restore();
      }
      const lastBall = ballTrajectory[ballTrajectory.length - 1];
      if (lastBall.goal) {
        circle(lastBall.x, lastBall.y, 6.5, '#ff9954', 2.5);
        circle(lastBall.x, lastBall.y, 2.5, '#ffffff', 2);
      } else if (lastBall.dist < 460) {
        circle(lastBall.x, lastBall.y, 3.5, '#f2efe9', 2);
      }
    }

    // 5. Impact spots
    const impacts = trajectoryData?.impacts || [];
    for (const impact of impacts) {
      circle(impact.x, impact.y, 7, '#ff9954', 2.5);
      ctx.beginPath();
      ctx.arc(impact.x, impact.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
  }
  function draw() {
    const ratio = Math.min(devicePixelRatio || 1, 2), width = Math.max(1, Math.round(canvas.clientWidth * ratio)), height = Math.round(width * .6);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); ctx.clearRect(0, 0, 1000, 600);
    const theme = getComputedStyle(document.documentElement);
    const color = name => theme.getPropertyValue('--' + name).trim();
    const primary = color('primary'), secondary = color('secondary'), text = color('text');
    const border = color('border'), surface = color('elevated'), background = color('background');
    rounded(60, 60, 880, 480, 100); ctx.fillStyle = surface; ctx.fill();
    ctx.strokeStyle = border; ctx.lineWidth = 4; ctx.stroke();
    ctx.setLineDash([6, 10]); line(500, 60, 500, 540, border); ctx.setLineDash([]);
    // Goal pockets interrupt the boundary at the same positions used by physics.
    const depth = P.rink.goalDepth;
    for (const [x, accent] of [[60 - depth, primary], [940, secondary]]) {
      ctx.fillStyle = background; ctx.fillRect(x, 230, depth, 140);
      line(x, 230, x + depth, 230, accent, 4);
      line(x, 370, x + depth, 370, accent, 4);
      line(x === 60 - depth ? x : x + depth, 230, x === 60 - depth ? x : x + depth, 370, accent, 4);
    }
    drawTrails(primary, secondary);
    bodies.slice(0, 6).forEach((b, i) => {
      const reachR = Math.max(b.radius, b.reach || b.radius, 18);
      circle(b.x, b.y, reachR + 2, i < 3 ? primary : secondary, 4);

      if (phase === 'goal' && b === scoringPlayer) {
        circle(b.x, b.y, b.radius + 9, '#ff9954', 4);
        circle(b.x, b.y, b.radius + 15, primary, 2);
      }
      skaters[i].style.left = b.x / 10 + '%'; skaters[i].style.top = b.y / 6 + '%';
      skaters[i].style.width = b.radius / 5 + '%';
      skaters[i].style.transform = `translate(-50%, -50%) rotate(${b.rotation}rad)`;
      ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = i < 3 ? primary : secondary; ctx.fillText(String(i % 3 + 1), b.x, b.y + b.radius + 20);

      // Curved launch arrow and dashed trajectory (drawn before spin knob so knob is on top)
      if (i < 3 && phase === 'plan' && plans[i].power > 0) {
        const trajectoryData = computeTrajectory(b, plans[i], bodies);
        drawTrajectory(b, plans[i], trajectoryData, primary);
      }
    });

    // Spin dial arced line with arrowheads (above arrow in z-index)
    if (phase === 'plan') {
      const b = bodies[selected];
      circle(b.x, b.y, b.radius + 8, text, 2);

      const dialR = b.radius + 18;
      const launchAngle = plans[selected].angle;
      const spin = plans[selected].spin || 0;
      const isSpinOffset = Math.abs(spin) >= 0.06;
      const handleAngle = launchAngle + spin * (Math.PI / 2.2);

      // 0-spin notch along launch angle
      const notchX = b.x + Math.cos(launchAngle) * dialR;
      const notchY = b.y + Math.sin(launchAngle) * dialR;
      circle(notchX, notchY, 2.5, 'rgba(255, 255, 255, 0.7)', 2);

      if (!isSpinOffset) {
        // Spin is 0: show arced line centered on arrow with TWO arrowheads
        const span = 0.35;
        const startA = launchAngle - span;
        const endA = launchAngle + span;
        ctx.beginPath();
        ctx.arc(b.x, b.y, dialR, startA, endA);
        ctx.strokeStyle = '#ff9954';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Arrowhead 1 at startA (pointing CCW)
        const p1x = b.x + Math.cos(startA) * dialR;
        const p1y = b.y + Math.sin(startA) * dialR;
        const t1 = startA - Math.PI / 2;
        line(p1x, p1y, p1x - Math.cos(t1 - 0.55) * 10, p1y - Math.sin(t1 - 0.55) * 10, '#ff9954', 2.5);
        line(p1x, p1y, p1x - Math.cos(t1 + 0.55) * 10, p1y - Math.sin(t1 + 0.55) * 10, '#ff9954', 2.5);

        // Arrowhead 2 at endA (pointing CW)
        const p2x = b.x + Math.cos(endA) * dialR;
        const p2y = b.y + Math.sin(endA) * dialR;
        const t2 = endA + Math.PI / 2;
        line(p2x, p2y, p2x - Math.cos(t2 - 0.55) * 10, p2y - Math.sin(t2 - 0.55) * 10, '#ff9954', 2.5);
        line(p2x, p2y, p2x - Math.cos(t2 + 0.55) * 10, p2y - Math.sin(t2 + 0.55) * 10, '#ff9954', 2.5);
      } else {
        // Spin is away from arrow: show arced line with ONLY ONE arrowhead at the tip
        const startA = Math.min(launchAngle, handleAngle);
        const endA = Math.max(launchAngle, handleAngle);
        ctx.beginPath();
        ctx.arc(b.x, b.y, dialR, startA, endA);
        ctx.strokeStyle = '#ff9954';
        ctx.lineWidth = 3.5;
        ctx.stroke();

        const hx = b.x + Math.cos(handleAngle) * dialR;
        const hy = b.y + Math.sin(handleAngle) * dialR;
        const tangent = handleAngle + (spin > 0 ? Math.PI / 2 : -Math.PI / 2);

        const tipX = hx + Math.cos(tangent) * 4;
        const tipY = hy + Math.sin(tangent) * 4;
        const wing1X = hx - Math.cos(tangent - 0.6) * 13;
        const wing1Y = hy - Math.sin(tangent - 0.6) * 13;
        const wing2X = hx - Math.cos(tangent + 0.6) * 13;
        const wing2Y = hy - Math.sin(tangent + 0.6) * 13;
        const notchBackX = hx - Math.cos(tangent) * 7;
        const notchBackY = hy - Math.sin(tangent) * 7;

        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(wing1X, wing1Y);
        ctx.lineTo(notchBackX, notchBackY);
        ctx.lineTo(wing2X, wing2Y);
        ctx.closePath();
        ctx.fillStyle = '#ff9954';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      // Slingshot pull-back dotted line while dragging backwards
      if (dragMode === 'slingshot' && dragPoint) {
        ctx.setLineDash([4, 6]);
        line(b.x, b.y, dragPoint.x, dragPoint.y, '#ffffffaa', 2);
        ctx.setLineDash([]);
        circle(dragPoint.x, dragPoint.y, 6, primary, 2);
      }
    }
    const ball = bodies[6];
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); ctx.fillStyle = background; ctx.fill(); circle(ball.x, ball.y, ball.radius, text, 2);
    if (ballMark.complete && ballMark.naturalWidth) {
      ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate(ball.rotation);
      const size = ball.radius * 1.7;
      ctx.drawImage(ballMark, -size / 2, -size / 2, size, size); ctx.restore();
    }
    drawParticles(primary, secondary);
  }
  function finishTurn(goal) {
    P.stop(bodies); accumulator = 0;
    if (goal !== null) {
      scores[goal]++; phase = scores[goal] >= 5 ? 'over' : 'goal';
      const ball = bodies[6];
      burst(ball.x, ball.y, goal, 1, true);
      if (!reducedMotion.matches) {
        for (let i = 0; i < 4; i++) fireworks.push({
          x: goal === 0 ? 740 + Math.random() * 110 : 150 + Math.random() * 110,
          y: 160 + Math.random() * 260, team: goal, delay: .18 + i * .22
        });
      }
      const scorer = lastTouchByTeam[goal] || bodies.slice(goal * 3, goal * 3 + 3)[0];
      scoringPlayer = scorer;
      const scorerName = scorer?.name || (goal === 0 ? 'Your ubu' : 'CPU ubu');
      say(phase === 'over'
        ? (goal === 0 ? `You win! Final goal by ${scorerName}. Start a new match for a rematch.` : `CPU wins. Final goal by ${scorerName}. Start a new match to try again.`)
        : `${goal === 0 ? 'You score!' : 'CPU scores.'} Goal by ${scorerName}! Ready for the next kickoff.`
      );
      if (scorer?.voice && window.ubuAudio) {
        window.ubuAudio.playFanfare(scorer.voice);
      }
      sync();
      if (phase === 'goal') { $('launch').disabled = false; $('launch').textContent = 'Next kickoff'; }
    } else {
      turn++; phase = 'plan'; resetPlans(); say('Field settled. Plan your next three launches.');
    }
    draw();
  }
  $('launch').onclick = () => {
    window.ubuAudio?.getAudioContext();
    if (phase === 'goal') {
      window.ubuAudio?.stop();
      bodies = kickoff(); turn++; phase = 'plan'; resetPlans(); say('Kickoff. Plan your next three launches.'); draw(); return;
    }
    if (phase !== 'plan') return;
    window.ubuAudio?.stop();
    lastPlans = structuredClone(plans);
    drag = null; P.launch(bodies, [...plans, ...($('cpu-hold').checked ? [] : cpu)]); elapsed = accumulator = 0; phase = 'play'; sync(); say('Turn in motion…');
  };
  for (const id of ['angle', 'power', 'shot-spin']) $(id).oninput = () => { if (phase !== 'plan') return; plans[selected] = { angle: radians(Number($('angle').value)), power: Number($('power').value) / 100, spin: Number($('shot-spin').value) / 100 }; sync(); draw(); };
  $('hold').onclick = () => { plans[selected].power = plans[selected].spin = 0; sync(); draw(); };
  function point(event) { const r = canvas.getBoundingClientRect(); return { x: (event.clientX - r.left) * 1000 / r.width, y: (event.clientY - r.top) * 600 / r.height }; }
  function updateSpinFromPoint(p, b) {
    const touchAngle = Math.atan2(p.y - b.y, p.x - b.x);
    let diff = touchAngle - plans[selected].angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;
    plans[selected].spin = Math.max(-1, Math.min(1, diff / (Math.PI / 2.2)));
  }
  canvas.onpointerdown = event => {
    window.ubuAudio?.getAudioContext();
    if (phase !== 'plan') return;
    const p = point(event);
    const curB = bodies[selected];
    const dialR = curB.radius + 18;
    const spin = plans[selected]?.spin || 0;
    const isSpinOffset = Math.abs(spin) >= 0.06;
    const handleAngle = plans[selected].angle + spin * (Math.PI / 2.2);
    const hx = curB.x + Math.cos(handleAngle) * dialR;
    const hy = curB.y + Math.sin(handleAngle) * dialR;
    const distToHandle = Math.hypot(p.x - hx, p.y - hy);
    const distToCenter = Math.hypot(p.x - curB.x, p.y - curB.y);

    if (distToHandle <= 18 || (distToCenter >= curB.radius + 8 && distToCenter <= curB.radius + 28)) {
      drag = event.pointerId;
      dragMode = 'spin';
      spinClickStart = (isSpinOffset && distToHandle <= 18) ? { x: p.x, y: p.y } : null;
      canvas.setPointerCapture(drag);
      if (!spinClickStart) updateSpinFromPoint(p, curB);
      sync(); draw();
      return;
    }

    const index = bodies.slice(0, 3).findIndex(b => Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 12);
    if (index < 0) return;
    selected = index;
    drag = event.pointerId;
    dragMode = 'slingshot';
    dragPoint = { x: p.x, y: p.y };
    canvas.setPointerCapture(drag);
    sync(); draw();
  };
  canvas.onpointermove = event => {
    const p = point(event);
    if (drag !== event.pointerId || phase !== 'plan') {
      if (phase === 'plan') {
        const curB = bodies[selected];
        const dialR = curB.radius + 18;
        const spin = plans[selected]?.spin || 0;
        const isSpinOffset = Math.abs(spin) >= 0.06;
        const handleAngle = plans[selected].angle + spin * (Math.PI / 2.2);
        const hx = curB.x + Math.cos(handleAngle) * dialR;
        const hy = curB.y + Math.sin(handleAngle) * dialR;
        const distToHandle = Math.hypot(p.x - hx, p.y - hy);
        const isOverUbu = bodies.slice(0, 3).some(b => Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 8);
        canvas.style.cursor = (isSpinOffset && distToHandle <= 18) ? 'pointer' : (distToHandle <= 18) ? 'grab' : isOverUbu ? 'crosshair' : 'default';
      }
      return;
    }
    const b = bodies[selected];
    if (dragMode === 'slingshot') {
      const MAX_PULL = 120;
      const pullDx = p.x - b.x, pullDy = p.y - b.y;
      const pullDist = Math.hypot(pullDx, pullDy);
      if (pullDist > 4) {
        plans[selected].angle = Math.atan2(-pullDy, -pullDx);
        plans[selected].power = Math.max(0, Math.min(1, (pullDist - 6) / MAX_PULL));
      }
      const clampedDist = Math.min(pullDist, MAX_PULL + 6);
      dragPoint = pullDist > 0 ? {
        x: b.x + (pullDx / pullDist) * clampedDist,
        y: b.y + (pullDy / pullDist) * clampedDist
      } : { x: b.x, y: b.y };
    } else if (dragMode === 'spin') {
      if (spinClickStart && Math.hypot(p.x - spinClickStart.x, p.y - spinClickStart.y) > 6) {
        spinClickStart = null;
      }
      updateSpinFromPoint(p, b);
    }
    sync(); draw();
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    if (dragMode === 'spin' && spinClickStart) {
      plans[selected].spin = 0;
      sync();
    }
    spinClickStart = null;
    drag = null;
    dragMode = null;
    dragPoint = null;
    draw();
  };
  function handleCollision(a, b, speed) {
    if (speed < 15) return;
    const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const x = a.x + (b.x - a.x) * a.radius / distance, y = a.y + (b.y - a.y) * a.radius / distance;
    const tangent = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    burst(x, y, a.team, Math.min(1, speed / 600), false, tangent);
    if (a.team !== b.team) burst(x, y, b.team, Math.min(1, speed / 600), false, tangent);
    const isBall = a.team === -1 || b.team === -1;
    const now = performance.now();
    if (isBall) {
      const player = a.team !== -1 ? a : b;
      lastTouchByTeam[player.team] = player;
      const norm = Math.min(1.0, Math.max(0.0, (speed - 25) / 550));
      const volume = Math.min(1.0, 0.15 + 0.85 * (norm ** 0.8));
      if (!player._lastHitSound || (now - player._lastHitSound) > 55) {
        player._lastHitSound = now;
        if (player.voice && window.ubuAudio) {
          window.ubuAudio.playCollision(player.voice, { volume });
        }
        if (window.ubuAudio) {
          window.ubuAudio.playBallHit({ volume });
        }
      }
    } else if (a.team !== -1 && b.team !== -1) {
      const norm = Math.min(1.0, Math.max(0.0, (speed - 40) / 600));
      const volume = Math.min(1.0, 0.12 + 0.75 * (norm ** 0.8));
      const primary = (Math.hypot(a.vx, a.vy) * a.mass >= Math.hypot(b.vx, b.vy) * b.mass) ? a : b;
      if (primary.voice && window.ubuAudio) {
        if (!primary._lastHitSound || (now - primary._lastHitSound) > 65) {
          primary._lastHitSound = now;
          window.ubuAudio.playCollision(primary.voice, { volume });
        }
      }
    }
  }
  function handleWall(body, velocity, wallType, nx, ny) {
    if (velocity < 20) return;
    const now = performance.now();
    if (body._lastWallSound && (now - body._lastWallSound) < 60) return;
    body._lastWallSound = now;
    burst(body.x + nx * body.radius, body.y + ny * body.radius, body.team,
      Math.min(1, velocity / 500), false, Math.atan2(ny, nx) + Math.PI / 2);
    const norm = Math.min(1.0, Math.max(0.0, (velocity - 20) / 480));
    const volume = Math.min(1.0, 0.15 + 0.85 * (norm ** 0.8));
    if (!window.ubuAudio) return;
    if (wallType === 'post') {
      window.ubuAudio.playGoalHit('post', { volume: Math.min(1.0, volume * 1.1) });
    } else if (wallType === 'net') {
      window.ubuAudio.playGoalHit('net', { volume });
    } else {
      window.ubuAudio.playWallHit({ volume });
    }
  }
  function frame(time) {
    const delta = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0; lastTime = time;
    const active = !$('roster-dialog').open && !document.hidden;
    const hadEffects = particles.length || fireworks.length || trails.some(trail => trail.length);
    if (active) updateEffects(delta);
    if (phase === 'play' && active) {
      accumulator += delta;
      while (accumulator >= P.DT && phase === 'play') {
        const goal = P.step(bodies, P.DT, handleCollision, handleWall); elapsed += P.DT; accumulator -= P.DT;
        recordTrails();
        if (goal !== null || P.settled(bodies) || elapsed >= 12) finishTurn(goal);
      }
      draw();
    } else if (active && hadEffects) draw();
    requestAnimationFrame(frame);
  }
  function rosterSlots() {
    $('roster-slots').replaceChildren();
    draft.forEach((entry, i) => { const button = document.createElement('button'); button.textContent = `${i + 1}. ${entry.model.parts.fullName}`; button.setAttribute('aria-pressed', String(i === rosterSlot)); button.onclick = () => { rosterSlot = i; rosterSlots(); }; $('roster-slots').append(button); });
  }
  function addOption(entry) {
    const button = document.createElement('button'), label = document.createElement('span'); label.textContent = entry.model.parts.fullName + ' · ' + entry.label;
    button.append(ubuRender(entry.model, 'ball-thumb'), label);
    button.onclick = () => {
      const other = draft.indexOf(entry);
      if (other >= 0 && other !== rosterSlot) { $('roster-status').textContent = 'That ubu is already on your team. Choose another character.'; return; }
      draft[rosterSlot] = entry; rosterSlot = (rosterSlot + 1) % 3; rosterSlots(); $('roster-status').textContent = 'Team updated. Select a slot to change it.';
    }; $('roster-options').append(button);
  }
  async function api(path) { const response = await fetch(path); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load collection.'); return data; }
  async function loadCollection() {
    $('load-collection').disabled = $('more-collection').disabled = true; $('roster-status').textContent = 'Loading your collection…';
    try {
      const config = await api('/api/config');
      const data = await api('/api/ubus?sort=recent' + (next ? '&after=' + encodeURIComponent(next) : ''));
      const keys = new Map(); let count = 0;
      const entries = [];
      for (const entry of data.ubus) {
        if (!entry.certificate) continue;
        const result = await ubuFile.read(entry.certificate, { allowUnsigned: false, resolveKey: async (mint, id) => {
          if (!config.ready || mint !== config.mint || !Object.hasOwn(config.keys, id)) return null;
          if (!keys.has(id)) keys.set(id, crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: config.keys[id], ext: true }, 'Ed25519', false, ['verify']));
          return keys.get(id);
        } });
        entries.push({ model: ubu.decode(ubu.fromCode(result.dna)), label: '#' + entry.serial }); count++;
      }
      entries.forEach(addOption); next = data.next || '';
      $('more-collection').hidden = !next; $('load-collection').hidden = true;
      $('roster-status').textContent = count ? `Added ${count} ubus. Select a slot, then choose its character.` : 'No ready ubus on this page. Practice ubus are available below.';
    } catch (error) { $('roster-status').textContent = error.message + ' You can play with practice ubus, or sign in from the mint page.'; }
    finally { $('load-collection').disabled = $('more-collection').disabled = false; }
  }
  $('load-collection').onclick = $('more-collection').onclick = loadCollection;
  $('new-match').onclick = () => {
    draft = [...roster]; rosterSlot = 0; rosterSlots(); $('roster-status').textContent = 'Test stats stay with their team slots when changing characters.'; $('roster-dialog').showModal();
  };
  $('start-match').onclick = () => { $('roster-dialog').close(); newMatch(); };
  $('cancel-roster').onclick = () => $('roster-dialog').close();
  // A modal pauses the simulation; cancelling preserves the current turn.
  for (const key of Object.keys(normalStats())) {
    const label = document.createElement('label'), input = document.createElement('input'), output = document.createElement('output');
    label.textContent = key[0].toUpperCase() + key.slice(1) + ' ';
    input.id = 'stat-' + key; input.type = 'number'; input.min = 0; input.max = 255; input.step = 1;
    output.id = 'mult-' + key; label.append(input, output); $('stat-inputs').append(label);
    input.oninput = previewStats;
  }
  function readStats() {
    const result = {};
    for (const key of Object.keys(normalStats())) {
      const input = $('stat-' + key); if (!input.value || !input.checkValidity()) return null;
      result[key] = Number(input.value);
    }
    return result;
  }
  function previewStats() {
    const raw = readStats(); $('apply-stats').disabled = !raw || phase === 'play';
    if (!raw) { $('stat-preview').textContent = 'Enter whole numbers from 0 to 255.'; return; }
    for (const key of Object.keys(raw)) $('mult-' + key).value = P.multiplier(raw[key]).toFixed(3) + '×';
    const b = {}; P.applyStats(b, raw);
    $('stat-preview').textContent = `Mass ${b.mass.toFixed(2)} · Radius ${b.radius.toFixed(1)} · Slowing ${b.friction.toFixed(1)}/s · Max spin ${b.maxSpin.toFixed(2)} rad/s · Grip ${b.grip.toFixed(3)} · Full-power speed ${(b.impulse / b.mass).toFixed(0)}. DNA-driven physics.`;
  }
  function showStats() { for (const key of Object.keys(normalStats())) $('stat-' + key).value = stats[Number($('stat-player').value)][key]; previewStats(); }
  function resetField() {
    window.ubuAudio?.stop();
    bodies = kickoff(); scores = [0, 0]; turn = 1; phase = 'plan'; elapsed = accumulator = 0; drag = null;
    cpu = P.cpuPlans(bodies, () => .5); sync(); previewStats(); draw(); say('Field reset. Your planned launches are preserved.');
  }
  $('stat-player').onchange = showStats;
  $('apply-stats').onclick = () => { const raw = readStats(); if (!raw || phase === 'play') return; stats[Number($('stat-player').value)] = raw; resetField(); };
  $('normal-stats').onclick = () => { stats = Array.from({ length: 6 }, normalStats); showStats(); resetField(); };
  $('reset-field').onclick = resetField;
  $('restore-shot').onclick = () => { if (!lastPlans) return; plans = structuredClone(lastPlans); resetField(); };
  showStats();
  document.addEventListener('visibilitychange', () => { lastTime = 0; });
  new ResizeObserver(() => draw()).observe(canvas);
  practice.slice(0, 3).forEach(addOption); newMatch(); requestAnimationFrame(frame);
})();
