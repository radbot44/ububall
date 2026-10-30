'use strict';
(() => {
  const $ = id => document.getElementById(id), P = ububallPhysics;
  const canvas = $('rink');
  let ctx = canvas.getContext('2d');
  let layoutDirty = true, renderWidth = 1, renderHeight = 1;
  const dirtyMeters = new Set();
  let rinkCache = null;
  const ballMark = new Image();
  ballMark.src = 'assets/uburoom-oomark-brand.svg';
  ballMark.onload = () => { if (skaters.length) draw(); };
  const superImages = P.SUPERS.map(s => {
    const img = new Image();
    img.src = s.icon;
    img.onload = () => { if (skaters.length) draw(); };
    return img;
  });
  const practice = Array.from({ length: 6 }, () => ({ model: ubu.decode(ubu.randomDNA()), label: 'Practice ubu' }));
  let roster = practice.slice(0, 3), draft = [...roster], rosterSlot = 0;
  let bodies = P.kickoff(), plans, cpu, selected = 0, scores = [0, 0], turn = 1, phase = 'plan';
  let elapsed = 0, accumulator = 0, lastTime = 0, drag = null, dragMode = null, skaters = [], next = '';
  let isPortrait = false;
  let matchMode = 'standard', planDeadline = 0;
  // Each turn of the current play (motion since the field last rested), for goal replays.
  let playSegments = [], goalReplay = null, goalReplayAt = 0;
  let matchTicks = 0; // Simulated ticks played locally, for meter cooldowns.
  let online = null, onlineRoster = '', onlineTurn = 0, onlineReplay = null, onlineDisconnected = false, onlinePhase = '';
  const cpuClient = createCPUClient();
  let cpuGeneration = 0, cpuReady = Promise.resolve(), cpuLevel = 'medium';
  const classicMode = () => ububallMatch.rule(matchMode, 'classic');
  const blitzMode = () => ububallMatch.rule(matchMode, 'blitz');
  const pulseMode = () => ububallMatch.rule(matchMode, 'pulse');
  const idlePlan = () => ({ angle: 0, power: 0, spin: 0, guard: false });
  function startPlanClock() { planDeadline = performance.now() + (ububallMatch.planningMilliseconds(matchMode) ?? Infinity); }
  function updateClock() {
    if (online?.active) {
      const s = online.state, clock = $('blitz-clock');
      clock.hidden = !blitzMode() || s?.phase !== 'plan';
      if (!clock.hidden) clock.textContent = Math.max(0, Math.ceil((s.deadline === null ? s.remaining : s.deadline - online.now()) / 1000)) + 's';
      const other = s ? 1 - s.seat : 1;
      $('online-forfeit').hidden = !s || s.phase === 'over' || !s.connected[s.seat] || s.connected[other] || s.disconnectedAt[other] === null || online.now() - s.disconnectedAt[other] < 60000;
      return;
    }
    const clock = $('blitz-clock'); clock.hidden = !blitzMode() || phase !== 'plan';
    if (!clock.hidden) clock.textContent = Math.max(0, Math.ceil((planDeadline - performance.now()) / 1000)) + 's';
  }
  let arrowGrab = null, dragStart = null, dragMoved = false;
  let pullBehind = false;
  $('aim-mode').onclick = () => {
    pullBehind = !pullBehind;
    $('aim-mode').textContent = pullBehind ? 'Aim: pull back' : 'Aim: drag arrow';
    $('aim-mode').setAttribute('aria-pressed', String(pullBehind));
  };
  const stadium = document.querySelector('.stadium');
  const stageArea = document.querySelector('.stadium-stage-area');
  const spinLayer = document.createElement('div'); spinLayer.className = 'spin-layer';
  stageArea.append(spinLayer); spinLayer.append($('field-spin'));
  const rinkStage = document.querySelector('.rink-stage');
  const rinkWrap = document.querySelector('.rink-wrap');
  const badgeCanvas = document.createElement('canvas'); badgeCanvas.className = 'field-badges';
  badgeCanvas.setAttribute('aria-hidden', 'true'); rinkWrap.append(badgeCanvas);
  const badgeCtx = badgeCanvas.getContext('2d');
  const btnFullscreen = $('btn-fullscreen'), btnRotate = $('btn-rotate');
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
  const trails = Array.from({ length: 7 }, () => []), particles = [], fireworks = [], shockwaves = [];
  const materialStyles = {
    metallic: ['spark', '#e1eaff'], glossy: ['bubble', '#ffffff'], iridescent: ['spark', 'rainbow'],
    crystalline: ['shard', '#a8eaff'], pearlescent: ['bubble', '#ffe5ed'], marble: ['dust', '#e5ddd1'],
    velvet: ['dust', null], frosted: ['spark', '#c9f4ff'], terrazzo: ['chip', null], crackle: ['spark', '#ffe4a5'],
    holographic: ['shard', 'rainbow'], woodgrain: ['streak', '#bf915f'], plush: ['dust', null],
    lacquered: ['streak', null], damascus: ['streak', '#ccd3e0'], opalescent: ['bubble', 'rainbow'],
    satin: ['streak', null], leather: ['chip', '#b18361'], denim: ['streak', '#8baee0'],
    'carbon-fiber': ['chip', '#83929d'], 'hammered-metal': ['spark', '#d5dbe2'], granite: ['chip', '#b0b0bc'],
    sandstone: ['dust', '#e3c28c'], obsidian: ['shard', '#a690c6'], liquid: ['bubble', null],
    bubbled: ['bubble', '#d2f7ff'], mosaic: ['chip', 'rainbow'], circuitry: ['spark', '#65ffd1'],
    quartz: ['shard', '#f4d7ff'], kintsugi: ['streak', '#ffd36b'], lava: ['spark', '#ff843e'],
    starfield: ['spark', '#e4d5ff']
  };
  let materialEmitters = [];
  function emitMaterialTrails(dt) {
    if (reducedMotion.matches) return;
    materialEmitters.forEach((emitter, i) => {
      const b = bodies[i], speed = Math.hypot(b.vx, b.vy);
      if (speed < 25 || !emitter.styles.length) { emitter.time = 0; return; }
      emitter.time += dt;
      if (emitter.time < 1 / 24) return;
      emitter.time %= 1 / 24;
      for (const effect of emitter.styles) {
        if (particles.length >= 300) break;
        const spread = (Math.random() - .5) * b.radius * 1.4;
        const x = b.x - b.vx / speed * b.radius - b.vy / speed * spread;
        const y = b.y - b.vy / speed * b.radius + b.vx / speed * spread;
        const life = .3 + Math.random() * .3;
        const color = effect.color === 'rainbow' ? `hsl(${Math.floor(Math.random() * 360)} 85% 78%)` : effect.color;
        particles.push({ x, y, px: x, py: y, vx: -b.vx * .06 + (Math.random() - .5) * 28,
          vy: -b.vy * .06 + (Math.random() - .5) * 28, team: b.team, color, life, duration: life,
          materialShape: effect.shape, size: 1.5 + Math.random() * 2, angle: Math.random() * Math.PI });
      }
    });
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function clearEffects() {
    trails.forEach(trail => { trail.length = 0; });
    particles.length = fireworks.length = shockwaves.length = 0;
  }
  function burst(x, y, team, strength, celebration = false, tangent = 0, color = null) {
    if (reducedMotion.matches) return;
    const count = celebration ? 64 : Math.round(3 + strength * 4);
    for (let i = 0; i < count && particles.length < 400; i++) {
      const angle = celebration ? Math.random() * Math.PI * 2
        : tangent + (i % 2 ? Math.PI : 0) + (Math.random() - .5) * .6;
      const speed = celebration ? 60 + Math.random() * 190 : 20 + Math.max(0, strength - 1) * 20 + Math.random() * (35 + strength * 65);
      const life = celebration ? .8 + Math.random() * .8 : .14 + Math.random() * .16 + Math.max(0, strength - 1) * .05;
      particles.push({ x, y, px: x, py: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        team: i % 5 === 0 ? -1 : team, life, duration: life, celebration, color });
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
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const s = shockwaves[i]; s.life -= dt;
      if (s.life <= 0) { shockwaves.splice(i, 1); }
    }
  }
  function recordTrails() {
    if (reducedMotion.matches) return;
    bodies.forEach((b, i) => {
      if (b.vx * b.vx + b.vy * b.vy < 625) return;
      const trail = trails[i], previous = trail[trail.length - 1];
      if (!previous || (b.x - previous.x) ** 2 + (b.y - previous.y) ** 2 >= 9) {
        const duration = .24; // Fixed lifetime makes trail length follow speed, not body size.
        trail.push({ x: b.x, y: b.y, life: duration, duration });
        if (trail.length > 40) trail.shift();
      }
    });
  }
  function drawTrails(home, away) {
    ctx.save(); ctx.lineCap = 'round';
    trails.forEach((trail, index) => {
      const b = bodies[index], color = b.team === -1 ? '#ffffff' : b.team === 0 ? home : away;
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i], end = trail[i + 1] || b, fade = Math.max(0, p.life / p.duration);
        ctx.globalAlpha = fade * .23;
        line(p.x, p.y, end.x, end.y, color, b.radius * 2 * fade);
      }
    });
    ctx.restore();
  }
  function drawStickyTether(host, ball) {
    const dx = ball.x - host.x, dy = ball.y - host.y, d = Math.hypot(dx, dy);
    if (d <= Math.abs(host.radius - ball.radius) || !d) return;
    const ux = dx / d, uy = dy / d;
    const c = (host.radius - ball.radius) / d, t = Math.sqrt(Math.max(0, 1 - c * c));
    // Common external tangents meet both circular surfaces cleanly. Draw behind
    // the skaters and ball, so only the energy bridge between them is exposed.
    const ends = [-1, 1].map(sign => {
      const nx = ux * c - sign * uy * t, ny = uy * c + sign * ux * t;
      return { ax: host.x + nx * host.radius, ay: host.y + ny * host.radius,
        bx: ball.x + nx * ball.radius, by: ball.y + ny * ball.radius };
    });
    ctx.save();
    const pulse = reducedMotion.matches ? .65 : .65 + .15 * Math.sin(elapsed * 14);
    ctx.globalAlpha = pulse;
    ctx.beginPath(); ctx.moveTo(ends[0].ax, ends[0].ay);
    ctx.lineTo(ends[0].bx, ends[0].by); ctx.lineTo(ends[1].bx, ends[1].by);
    ctx.lineTo(ends[1].ax, ends[1].ay); ctx.closePath();
    ctx.fillStyle = '#44dd662b'; ctx.fill();
    ctx.lineCap = 'round'; ctx.shadowColor = '#44dd66';
    ctx.shadowBlur = reducedMotion.matches ? 0 : 8 * canvas.width / 1000;
    for (const e of ends) {
      line(e.ax, e.ay, e.bx, e.by, '#44dd66', 3);
      line(e.ax, e.ay, e.bx, e.by, '#d9ffe3', 1);
    }
    ctx.restore();
  }
  const glowSprites = new Map();
  function glowSprite(color) {
    if (glowSprites.has(color)) return glowSprites.get(color);
    const sprite = document.createElement('canvas'); sprite.width = sprite.height = 128;
    const c = sprite.getContext('2d'); c.fillStyle = color;
    c.shadowColor = color; c.shadowBlur = 14;
    c.beginPath(); c.arc(64, 64, 6, 0, Math.PI * 2);
    c.fill();
    glowSprites.set(color, sprite); return sprite;
  }
  const superGlowSprites = new Map();
  const SUPER_AURA_THEMES = {
    cannonball: ['#ff3344', '#ff9954'], // fiery red & orange
    magnet: ['#3388ff', '#ff3344'],     // blue & red
    sticky: ['#42c66b', '#21845b'],     // emerald green & darker green
    stalwart: ['#ffd166', '#4f5fc2'],   // gold & indigo
    knockout: ['#ee2b47', '#ff7197'],   // crimson & pink
    colossus: ['#ffe043', '#c8961e'],   // yellow & darker yellow
    ghost: ['#33e0ff', '#f8f6f2'],      // cyan & alabaster
    shockwave: ['#ff7197', '#9d467a']   // rose & mulberry
  };
  function hexToRgba(hex, alpha) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }
  function superGlowSprite(key) {
    if (superGlowSprites.has(key)) return superGlowSprites.get(key);
    const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
    const sprite = document.createElement('canvas'); sprite.width = sprite.height = 256;
    const c = sprite.getContext('2d');
    const grad = c.createRadialGradient(128, 128, 10, 128, 128, 124);
    grad.addColorStop(0, hexToRgba(c1, 0.96));
    grad.addColorStop(0.18, hexToRgba(c1, 0.90));
    grad.addColorStop(0.26, hexToRgba(c1, 0.82));
    grad.addColorStop(0.38, hexToRgba(c2, 0.84));
    grad.addColorStop(0.48, hexToRgba(c2, 0.74));
    grad.addColorStop(0.60, hexToRgba(c1, 0.68));
    grad.addColorStop(0.72, hexToRgba(c1, 0.52));
    grad.addColorStop(0.84, hexToRgba(c2, 0.38));
    grad.addColorStop(0.92, hexToRgba(c2, 0.18));
    grad.addColorStop(1, hexToRgba(c2, 0));
    c.fillStyle = grad;
    c.beginPath(); c.arc(128, 128, 124, 0, Math.PI * 2); c.fill();
    superGlowSprites.set(key, sprite); return sprite;
  }
  // Super aura: ready = a ring with a steady sweep and a faint halo; armed and active = full halo,
  // a counter ring and two orbiting sparks. The icon badge names the super.
  function drawSuperAura(b, key, reach) {
    const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
    const level = b.superActive || b.superArm ? 2 : 1, still = reducedMotion.matches;
    const t = still ? 0 : performance.now() / 1000, spin = t * (.6 + level * 1.2);
    const ringR = reach + 6 + level * 2;
    ctx.save();
    const haloR = ringR + 10 + level * 4 + (still ? 0 : Math.sin(t * 3) * 2);
    ctx.globalAlpha = level === 2 ? .45 : .22;
    ctx.drawImage(superGlowSprite(key), b.x - haloR, b.y - haloR, haloR * 2, haloR * 2);
    ctx.lineCap = 'round';
    ctx.globalAlpha = level === 2 ? .75 : .55;
    circle(b.x, b.y, ringR, c1, level === 2 ? 2.5 : 2);
    ctx.globalAlpha = level === 2 ? 1 : .85;
    ctx.shadowBlur = 6 * canvas.width / 1000; ctx.shadowColor = c1;
    for (const [radius, dir] of level === 2 ? [[ringR, 1], [ringR + 5, -1]] : [[ringR, 1]]) {
      const sweep = ctx.createConicGradient(spin * dir, b.x, b.y);
      sweep.addColorStop(0, hexToRgba(c2, 0)); sweep.addColorStop(.3, hexToRgba(c2, .9));
      sweep.addColorStop(.36, hexToRgba(c1, 0)); sweep.addColorStop(1, hexToRgba(c1, 0));
      ctx.strokeStyle = sweep; ctx.lineWidth = level === 2 ? 3.5 : 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, radius, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    if (level === 2 && !still) for (let k = 0; k < 2; k++) {
      const head = spin * 1.5 + k * Math.PI;
      for (let s = 4; s >= 0; s--) {
        const angle = head - s * .08;
        ctx.globalAlpha = (1 - s / 5) * .8;
        ctx.fillStyle = s ? (k ? c2 : c1) : '#ffffff';
        ctx.beginPath(); ctx.arc(b.x + Math.cos(angle) * ringR, b.y + Math.sin(angle) * ringR, 2.2 - s * .3, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }
  // Small upright icon badge naming the ready, armed or active super.
  function drawSuperBadge(b, key) {
    const icon = superImages[b.equippedSuper?.id ?? 0];
    if (!icon?.complete || !icon.naturalWidth) return;
    const [c1] = SUPER_AURA_THEMES[key] || ['#ff7197'];
    const size = b.superActive || b.superArm ? 24 : 20, p = badgePoint(b);
    badgeCtx.save();
    badgeCtx.translate(p.x, p.y); if (isPortrait) badgeCtx.rotate(Math.PI / 2);
    badgeCtx.beginPath(); badgeCtx.arc(0, 0, size / 2 + 2, 0, Math.PI * 2);
    badgeCtx.fillStyle = '#0b0d10d9'; badgeCtx.fill();
    badgeCtx.lineWidth = 1.5; badgeCtx.strokeStyle = c1; badgeCtx.stroke();
    badgeCtx.drawImage(icon, -size / 2, -size / 2, size, size);
    badgeCtx.restore();
  }
  function drawParticles(home, away) {
    ctx.save(); ctx.lineCap = 'round';
    for (const p of particles) {
      const color = p.color || (p.team === -1 ? '#ffffff' : p.team === 0 ? home : away);
      ctx.globalAlpha = Math.min(1, p.life / p.duration * 2) * (p.celebration ? 1 : .65);
      if (p.materialShape) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = 1;
        const size = p.size * Math.min(1, p.life / p.duration * 2);
        ctx.beginPath();
        if (p.materialShape === 'spark') {
          ctx.moveTo(-size, 0); ctx.lineTo(size, 0); ctx.moveTo(0, -size); ctx.lineTo(0, size); ctx.stroke();
        } else if (p.materialShape === 'streak') {
          ctx.moveTo(-size * 2, 0); ctx.lineTo(size * 2, 0); ctx.stroke();
        } else if (p.materialShape === 'shard') {
          ctx.moveTo(0, -size * 1.6); ctx.lineTo(size, size); ctx.lineTo(-size, size); ctx.closePath(); ctx.fill();
        } else if (p.materialShape === 'chip') {
          ctx.fillRect(-size / 2, -size / 2, size, size);
        } else {
          ctx.arc(0, 0, size, 0, Math.PI * 2);
          if (p.materialShape === 'bubble') ctx.stroke(); else ctx.fill();
        }
        ctx.restore(); continue;
      }
      ctx.shadowColor = color;
      ctx.shadowBlur = 0;
      if (p.celebration) ctx.drawImage(glowSprite(color), p.x - 24, p.y - 24, 48, 48);
      line(p.px, p.py, p.x, p.y, color, p.celebration ? 2.5 : 1.3);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, p.celebration ? 1.8 : .9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function kickoff(isNewMatch = false) {
    clearEffects();
    lastTouchByTeam = { 0: null, 1: null }; scoringPlayer = null;
    const oldBodies = bodies;
    const result = P.kickoff();
    result.slice(0, 6).forEach((b, i) => {
      ububallMatch.applyStats(P, b, stats[i], matchMode);
      const entry = teamEntries[i] || practice[i];
      if (entry?.model) {
        b.playerIndex = i;
        b.voice = entry.model.voice;
        b.personality = entry.model.personality;
        b.name = entry.model.parts?.fullName;
        b.equippedSuper = entry.equippedSuper || P.SUPERS[(entry.model.supers?.[0] ?? i) % 8];
        if (isNewMatch) {
          const rating = entry.model.rating ?? 511;
          b.meter = Math.min(100, Math.max(0, (rating / 1020) * 100));
          b.stunned = false;
        } else {
          b.meter = oldBodies?.[i]?.meter ?? 0;
          b.stunned = oldBodies?.[i]?.stunned || false;
        }
        if (classicMode()) { b.meter = 0; b.equippedSuper = null; }
        b.superArm = false;
        b.superActive = null;
      }
    });
    return result;
  }
  // Online meters come from the server; replays never earn meter.
  function contactMeter(a, b, speed) {
    if (online?.active || goalReplay) return;
    const tick = matchTicks + Math.round(elapsed / P.DT);
    for (const changed of ububallMatch.contactMeter(P, bodies, stats, a, b, speed, tick, classicMode())) dirtyMeters.add(changed);
  }
  function flushMeters() {
    for (const body of dirtyMeters) {
      const fill = $(`super-fill-${body.playerIndex}`), pct = $(`super-pct-${body.playerIndex}`);
      if (fill) fill.style.width = body.meter + '%';
      if (pct) pct.textContent = Math.floor(body.meter) + '%';
    }
    dirtyMeters.clear();
  }
  function say(message) { $('game-status').textContent = message; }
  function prepareCPU() {
    const generation = ++cpuGeneration;
    cpuClient.cancel();
    if (online?.active) return;
    cpu = P.cpuPlans(bodies, () => .5, scores);
    cpuReady = cpuClient.plan({ version: ububallMatch.VERSION, mode: matchMode, bodies, stats, scores, turn },
      { level: cpuLevel, seed: turn }).then(result => {
      if (generation !== cpuGeneration || !result || online?.active) return;
      if (result.error) console.warn('CPU search unavailable; using baseline plan.');
      else cpu = result.plans;
    });
  }
  function resetPlans() {
    startPlanClock();
    plans = Array.from({ length: 3 }, idlePlan);
    prepareCPU(); // Snapshot before any human planning input.
    sync();
  }
  function renderStatsBox(statSource) {
    const wrap = document.createElement('div'); wrap.className = 'ubu-stats-wrap';
    const details = document.createElement('details'); details.className = 'stat-details';
    const summary = document.createElement('summary'); summary.textContent = 'Individual stats'; details.append(summary);
    const groups = [
      ['Movement', '#76b9ef', ['impulse', 'traction', 'spin', 'curve']],
      ['Physical', '#42c66b', ['size', 'mass', 'bounciness', 'grip']],
      ['Engagement', '#ff9954', ['power', 'reach', 'strength', 'stability']],
      ['Super', '#ff7197', ['efficiency', 'synergy', 'chemistry']]
    ];
    const compactBox = document.createElement('div'); compactBox.className = 'ubu-stats compact-stats';
    for (const [label, color, keys] of groups) {
      const avg = Math.round(keys.reduce((sum, k) => sum + (statSource[k] ?? 127), 0) / keys.length);
      const row = document.createElement('div'); row.className = 'stat-row';
      const name = document.createElement('span'); name.className = 'stat-lbl'; name.textContent = label;
      const track = document.createElement('div'); track.className = 'stat-track';
      const fill = document.createElement('i');
      fill.style.width = `${Math.min(100, Math.max(0, Math.round(avg / 255 * 100)))}%`;
      fill.style.backgroundColor = color;
      track.append(fill);
      const valSpan = document.createElement('span'); valSpan.className = 'stat-val'; valSpan.textContent = String(avg);
      row.append(name, track, valSpan);
      compactBox.append(row);
    }
    const fullBox = document.createElement('div'); fullBox.className = 'ubu-stats full-stats';
    for (const [groupName, color, keys] of groups) {
      const groupHeading = document.createElement('div');
      groupHeading.className = 'stat-group-title';
      groupHeading.textContent = groupName;
      groupHeading.style.color = color;
      fullBox.append(groupHeading);
      for (const k of keys) {
        const val = statSource[k] ?? 127;
        const row = document.createElement('div'); row.className = 'stat-row';
        const name = document.createElement('span'); name.className = 'stat-lbl';
        name.textContent = k[0].toUpperCase() + k.slice(1);
        const track = document.createElement('div'); track.className = 'stat-track';
        const fill = document.createElement('i');
        fill.style.width = `${Math.min(100, Math.max(0, Math.round(val / 255 * 100)))}%`;
        fill.style.backgroundColor = color;
        track.append(fill);
        const valSpan = document.createElement('span'); valSpan.className = 'stat-val'; valSpan.textContent = String(val);
        row.append(name, track, valSpan);
        fullBox.append(row);
      }
    }
    compactBox.setAttribute('aria-label', 'Category averages');
    compactBox.title = 'Category averages · 0–255';
    details.append(fullBox); wrap.append(compactBox, details);
    details.open = Boolean($('toggle-full-stats')?.checked);
    return wrap;
  }
  function renderSuperPanel(playerIndex, isCpu = false) {
    const wrap = document.createElement('div'); wrap.className = 'super-panel';
    const topRow = document.createElement('div'); topRow.className = 'super-row';
    const label = document.createElement('span'); label.className = 'super-name-badge'; label.id = `super-name-${playerIndex}`;
    const initialSuper = bodies?.[playerIndex]?.equippedSuper || teamEntries[playerIndex]?.equippedSuper || P.SUPERS[0];
    const icon = document.createElement('img');
    icon.className = 'super-icon';
    icon.id = `super-icon-${playerIndex}`;
    icon.src = initialSuper.icon;
    icon.alt = initialSuper.name;
    icon.title = `${initialSuper.name}: ${initialSuper.desc}`;
    const nameSpan = document.createElement('span');
    nameSpan.id = `super-name-text-${playerIndex}`;
    nameSpan.textContent = initialSuper.name;
    label.append(icon, nameSpan);
    const pct = document.createElement('span'); pct.className = 'super-pct'; pct.id = `super-pct-${playerIndex}`;
    pct.textContent = `${Math.round(bodies?.[playerIndex]?.meter ?? 0)}%`;
    topRow.append(label, pct);
    const meterTrack = document.createElement('div'); meterTrack.className = 'super-meter-track';
    const meterFill = document.createElement('i'); meterFill.className = 'super-meter-fill'; meterFill.id = `super-fill-${playerIndex}`;
    meterFill.style.width = `${Math.min(100, Math.round(bodies?.[playerIndex]?.meter ?? 0))}%`;
    meterTrack.append(meterFill);
    wrap.append(topRow, meterTrack);
    if (!isCpu) {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'super-arm-btn'; btn.id = `super-arm-${playerIndex}`;
      btn.textContent = 'ARM SUPER'; btn.disabled = true;
      btn.onclick = e => {
        e.stopPropagation();
        const b = bodies[playerIndex];
        if (!classicMode() && b && b.meter >= 100 && phase === 'plan' && !b.stunned) {
          b.superArm = !b.superArm;
          sync(); draw();
        }
      };
      wrap.append(btn);
    }
    return wrap;
  }
  function sync() {
    layoutDirty = true;
    updateClock();
    const planning = phase === 'plan';
    const isGoal = phase === 'goal';
    $('phase').textContent = phase === 'over' ? 'Match complete' : `${planning ? 'Plan' : isGoal ? 'Goal' : phase === 'cpu-wait' ? 'CPU planning' : 'In play'} · Turn ${turn}`;
    $('home-score').textContent = scores[0]; $('away-score').textContent = scores[1];
    const curB = bodies[selected];
    const isStunned = Boolean(curB?.stunned);
    if (isStunned) {
      plans[selected].power = plans[selected].spin = 0;
    }
    for (const id of ['angle', 'power', 'shot-spin', 'spin-less', 'spin-more', 'hold']) $(id).disabled = !planning || isStunned;
    $('launch').disabled = phase === 'play' || phase === 'cpu-wait';
    for (const node of $('stat-testing').querySelectorAll('input, select, button')) node.disabled = phase === 'play' || phase === 'cpu-wait';
    $('restore-shot').disabled = phase === 'play' || phase === 'cpu-wait' || !lastPlans;
    if (!readStats() || classicMode()) $('apply-stats').disabled = true;
    if (classicMode()) for (const id of ['stat-super', 'fill-meter', 'normal-stats']) $(id).disabled = true;
    document.querySelector('.stadium')?.classList.toggle('goal-phase', isGoal);
    $('launch').textContent = isGoal ? 'Next kickoff' : phase === 'over' ? 'New match' : phase === 'play' ? 'In motion…' : phase === 'cpu-wait' ? 'CPU planning…' : 'Launch team';
    $('selected-name').textContent = teamEntries[selected].model.parts.fullName;
    const launching = plans.filter((p, i) => p.power > 0 && !bodies[i].stunned && !(bodies[i].superArm && bodies[i].equippedSuper?.key === 'stalwart')).length;
    const guarding = plans.filter((p, i) => p.guard && !bodies[i].stunned).length;
    $('plan-summary').textContent = planning ? `${launching} launching · ${guarding} guarding` : '';
    $('hold').setAttribute('aria-pressed', String(Boolean(plans[selected].guard)));
    [...$('team-selector').children].forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === selected));
      button.disabled = !planning;
      button.querySelector('span').textContent = `${bodies[i].stunned ? 'Stunned' : plans[i].guard ? 'Guard' : plans[i].power > 0 ? Math.round(plans[i].power * 100) + '%' : 'Hold'}${bodies[i].superArm ? ' · Armed' : ''}`;
    });
    const angle = Math.round((plans[selected].angle * 180 / Math.PI + 360) % 360);
    $('angle').value = angle; $('angle-value').value = angle + '°';
    $('power').value = Math.round(plans[selected].power * 100); $('power-value').value = $('power').value + '%';
    const spinValue = Math.round((plans[selected].spin || 0) * 100);
    $('shot-spin').value = spinValue;
    $('shot-spin').style.setProperty('--spin-start', Math.min(50, (spinValue + 100) / 2) + '%');
    $('shot-spin').style.setProperty('--spin-end', Math.max(50, (spinValue + 100) / 2) + '%');
    $('shot-spin').setAttribute('aria-valuetext', spinValue === 0 ? 'No spin' : `${Math.abs(spinValue)}% ${spinValue < 0 ? 'counterclockwise' : 'clockwise'}`);
    $('shot-spin').setAttribute('aria-label', `Spin for ${teamEntries[selected].model.parts.fullName}`);
    [...$('team').children].forEach((button, i) => {
      button.classList.toggle('selected', i === selected);
      const select = button.querySelector('.card-select');
      select.setAttribute('aria-pressed', String(i === selected)); select.disabled = !planning;
      const small = button.querySelector('small');
      if (small) {
        if (bodies[i]?.stunned) small.textContent = '💫 Stunned this turn';
        else if (plans[i].guard) small.textContent = 'Guarding';
        else small.textContent = `${Math.round(plans[i].power * 100)}% power · ${Math.round((plans[i].spin || 0) * 100)}% spin`;
      }
    });
    bodies.slice(0, 6).forEach((b, i) => {
      const pctNode = $(`super-pct-${i}`);
      if (pctNode) pctNode.textContent = `${Math.round(b.meter || 0)}%`;
      const fillNode = $(`super-fill-${i}`);
      if (fillNode) fillNode.style.width = `${Math.min(100, Math.round(b.meter || 0))}%`;
      const textNode = $(`super-name-text-${i}`);
      if (textNode) textNode.textContent = b.equippedSuper?.name || 'Stalwart';
      const iconNode = $(`super-icon-${i}`);
      if (iconNode && b.equippedSuper?.icon) {
        iconNode.src = b.equippedSuper.icon;
        iconNode.alt = b.equippedSuper.name;
        iconNode.title = `${b.equippedSuper.name}: ${b.equippedSuper.desc}`;
      }
      if (i < 3) {
        const armBtn = $(`super-arm-${i}`);
        if (armBtn) {
          armBtn.disabled = !planning || (b.meter < 100) || Boolean(b.stunned);
          armBtn.classList.toggle('armed', Boolean(b.superArm));
          armBtn.textContent = b.stunned ? '💫 STUNNED' : b.superArm ? '⚡ ARMED' : 'ARM SUPER';
        }
      }
    });
    const hudSuperBtn = $('stadium-super-btn');
    const hudSuperText = $('stadium-super-text');
    const hudSuperIcon = $('stadium-super-icon');
    if (hudSuperBtn && curB) {
      const s = curB.equippedSuper || P.SUPERS[0];
      if (hudSuperIcon && s?.icon) {
        hudSuperIcon.src = s.icon;
        hudSuperIcon.alt = s.name;
        hudSuperIcon.title = `${s.name}: ${s.desc}`;
      }
      const canArm = planning && (curB.meter >= 100) && !curB.stunned;
      hudSuperBtn.disabled = !canArm;
      hudSuperBtn.setAttribute('aria-pressed', String(Boolean(curB.superArm)));
      hudSuperBtn.classList.toggle('armed', Boolean(curB.superArm));
      if (hudSuperText) {
        if (curB.stunned) {
          hudSuperText.textContent = '💫 STUNNED';
        } else if (curB.superArm) {
          hudSuperText.textContent = '⚡ ARMED';
        } else if (curB.meter >= 100) {
          hudSuperText.textContent = `Arm ${s.name}`;
        } else {
          hudSuperText.textContent = `${s.name} charging ${Math.floor(curB.meter || 0)}%`;
        }
      }
    }
    if (online?.active) {
      $('launch').disabled = phase !== 'plan';
      $('launch').textContent = phase === 'plan' ? 'Lock moves' : phase === 'play' ? 'In motion…' : phase === 'over' ? 'Match complete' : 'Waiting…';
      $('new-match').disabled = true;
      for (const node of $('stat-testing').querySelectorAll('input, select, button')) node.disabled = true;
    }
  }
  function buildTeam() {
    if (!online?.active) teamEntries = [...roster, ...practice.slice(3)];
    materialEmitters = teamEntries.map(entry => {
      const seen = new Set();
      const styles = [];
      for (const attribute of Object.values(entry.model.attributes)) {
        const style = materialStyles[attribute.texture];
        if (!style || seen.has(attribute.texture)) continue;
        seen.add(attribute.texture);
        styles.push({ shape: style[0], color: style[1] || attribute.hex });
      }
      return { styles, time: 0 };
    });
    $('team').replaceChildren();
    $('team-selector').replaceChildren();
    if ($('cpu-team')) $('cpu-team').replaceChildren();
    $('skaters').replaceChildren();
    teamEntries.forEach((entry, i) => {
      if (entry.model && entry.model.stats) stats[i] = classicMode() ? normalStats() : { ...entry.model.stats };
    });
    skaters = teamEntries.map((entry, i) => {
      const node = document.createElement('div'); node.className = 'skater';
      const svg = ubuRender(entry.model, 'ball-ubu'); node.append(svg); $('skaters').append(node);
      // Rasterize once per roster; retain the SVG if decoding is unavailable.
      const image = new Image();
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      image.onload = () => {
        const sprite = document.createElement('canvas'); sprite.width = sprite.height = 256;
        sprite.getContext('2d').drawImage(image, 0, 0, 256, 256);
        node.replaceChildren(sprite); URL.revokeObjectURL(url);
      };
      image.onerror = () => URL.revokeObjectURL(url);
      image.src = url;
      return node;
    });
    teamEntries.slice(0, 3).forEach((entry, i) => {
      const button = document.createElement('div'); button.className = 'team-card'; button.id = `player-${i}`;
      const select = document.createElement('button'); select.type = 'button'; select.className = 'card-select';
      const header = document.createElement('div'); header.className = 'card-header';
      const titles = document.createElement('div'); titles.className = 'card-titles';
      const strong = document.createElement('strong'); strong.textContent = entry.model.parts.fullName;
      const small = document.createElement('small'); small.textContent = '0% power · 0% spin';
      titles.append(strong, small);
      header.append(ubuRender(entry.model, 'ball-thumb'), titles);
      select.append(header);
      button.append(select, renderStatsBox(stats[i] || entry.model.stats || {}), renderSuperPanel(i, false));
      select.onclick = () => { selected = i; sync(); draw(); };
      $('team').append(button);
      const shortcut = document.createElement('button'); shortcut.type = 'button';
      shortcut.setAttribute('aria-label', `Select ${entry.model.parts.fullName}`);
      shortcut.append(ubuRender(entry.model, 'ball-thumb'), document.createElement('span'));
      shortcut.onclick = select.onclick;
      $('team-selector').append(shortcut);
    });
    if ($('cpu-team')) {
      teamEntries.slice(3, 6).forEach((entry, idx) => {
        const i = idx + 3;
        const card = document.createElement('div'); card.className = 'team-card cpu-card'; card.id = `player-${i}`;
        const header = document.createElement('div'); header.className = 'card-header';
        const titles = document.createElement('div'); titles.className = 'card-titles';
        const strong = document.createElement('strong'); strong.textContent = entry.model.parts.fullName;
        const small = document.createElement('small'); small.className = 'away'; small.textContent = online?.active ? 'Opponent' : 'CPU';
        titles.append(strong, small);
        header.append(ubuRender(entry.model, 'ball-thumb'), titles);
        card.append(header, renderStatsBox(stats[i] || entry.model.stats || {}), renderSuperPanel(i, true));
        $('cpu-team').append(card);
      });
    }
  }
  function newMatch(playJingle = false) {
    endGoalReplay(); playSegments = [];
    matchMode = ububallMatch.RULES.filter(rule => $('rule-' + rule).checked).join('-') || 'standard';
    document.body.classList.toggle('classic-match', classicMode());
    $('mode-label').textContent = ububallMatch.modeName(matchMode);
    stats = [...draft, ...practice.slice(3)].map(entry => classicMode() ? normalStats() : { ...(entry.model.stats || normalStats()) });
    window.ubuAudio?.stop();
    roster = [...draft]; teamEntries = [...roster, ...practice.slice(3)]; bodies = kickoff(true); buildTeam(); scores = [0, 0]; turn = 1; selected = 0; phase = 'plan'; elapsed = accumulator = 0; drag = null;
    resetPlans(); say('Drag from an ubu toward your target to aim. Drag its arrowhead to adjust power and direction.'); draw();
    if (playJingle) window.ubuAudio?.playGameStart?.();
  }
  function rounded(x, y, width, height, radius) { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); }
  function line(x1, y1, x2, y2, color, width = 2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  function circle(x, y, r, color, width = 2) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  function impulseGeometry(body, plan) {
    const activeSuper = body.superActive || ((body.superArm && (body.meter ?? 0) >= 100) ? body.equippedSuper?.key : null);
    const isColossus = activeSuper === 'colossus' && !body.colossusApplied;
    const effRadius = body.radius * (isColossus ? 1.8 : 1);
    const scale = 110 * ((body.impulse || P.IMPULSE) / P.IMPULSE) / (isColossus ? 2.5 : 1);
    const ringR = Math.max(effRadius, body.reach || effRadius, 18) + 2;
    const distance = ringR + scale * plan.power;
    return { ringR, scale, distance, x: body.x + Math.cos(plan.angle) * distance, y: body.y + Math.sin(plan.angle) * distance,
      visible: plan.power > 0 && !body.stunned && activeSuper !== 'stalwart' };
  }
  function drawImpulse(body, plan, color) {
    if (!plan) return;
    const arrow = impulseGeometry(body, plan);
    if (!arrow.visible) return;
    const startX = body.x + Math.cos(plan.angle) * arrow.ringR;
    const startY = body.y + Math.sin(plan.angle) * arrow.ringR;
    const endX = arrow.x, endY = arrow.y;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Arrowhead at the tip of the impulse arrow
    const tipAngle = plan.angle;
    for (const offset of [-0.55, 0.55]) {
      line(endX, endY, endX - Math.cos(tipAngle + offset) * 14, endY - Math.sin(tipAngle + offset) * 14, color, 4);
    }
    ctx.restore();

  }
  function screenPoint(p) {
    const r = canvas.getBoundingClientRect();
    return isPortrait ? { x: r.left + p.y / 600 * r.width, y: r.top + (1 - p.x / 1000) * r.height }
      : { x: r.left + p.x / 1000 * r.width, y: r.top + p.y / 600 * r.height };
  }
  function badgePoint(b) {
    return isPortrait ? { x: b.x - b.radius * .65, y: b.y - b.radius * .65 } : { x: b.x - b.radius * .65, y: b.y + b.radius * .65 };
  }
  function fieldTarget(event) {
    const near = p => { const q = screenPoint(p); return Math.hypot(q.x - event.clientX, q.y - event.clientY) <= 22; };
    const own = bodies.slice(0, 3);
    const arrow = own.findIndex((b, i) => { const a = impulseGeometry(b, plans[i]); return a.visible && near(a); });
    if (arrow >= 0) return { mode: 'arrow', index: arrow };
    const p = point(event);
    return { mode: 'aim', index: own.findIndex(b => !b.stunned && Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 12) };
  }
  function positionSpinControl() {
    const control = $('field-spin');
    control.hidden = false;
    const visible = phase === 'plan' && drag === null;
    control.style.visibility = visible ? 'visible' : 'hidden';
    control.inert = !visible;
    if (!visible) return;
    const b = bodies[selected], center = screenPoint(b), stage = stageArea.getBoundingClientRect();
    const r = canvas.getBoundingClientRect();
    const radius = b.radius * (isPortrait ? r.height / 1000 : r.width / 1000);
    const width = control.offsetWidth, height = control.offsetHeight;
    const arrow = screenPoint(impulseGeometry(b, plans[selected]));
    // Prefer the side opposite the arrow, then clamp inside the stage near the edges.
    let y = arrow.y > center.y + 8 ? center.y - radius - height - 24 : center.y + radius + 5;
    const x = Math.max(6, Math.min(stage.width - width - 6, center.x - stage.left - width / 2));
    y = Math.max(6, Math.min(stage.height - height - 6, y - stage.top));
    control.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  const impactStamp = document.createElement('canvas');
  impactStamp.width = impactStamp.height = 128;
  const impactCtx = impactStamp.getContext('2d');
  let predictionCache = null;
  function drawPrediction(home, away) {
    // Include all state and all plans: changing any teammate invalidates the one simulation.
    const key = JSON.stringify([bodies, plans]);
    if (predictionCache?.key !== key) predictionCache = { key, data: P.predictTurn(bodies, plans) };
    const prediction = predictionCache.data;
    prediction.paths.forEach((points, index) => {
      const isBall = bodies[index].team === -1;
      const color = isBall ? '#f2efe9' : bodies[index].team === 0 ? home : away;
      ctx.save();
      ctx.setLineDash(isBall ? [3, 4] : [4, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = isBall ? 2.5 : 2;
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1], to = points[i];
        if (from.x === to.x && from.y === to.y) continue;
        const fade = Math.min(1, (prediction.horizon - to.tick) / 240);
        ctx.globalAlpha = fade * (isBall ? .9 : .65);
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
      }
      ctx.restore();
    });
    for (const stop of prediction.stops) {
      if (!stop.stopped || !prediction.paths[stop.index].some(p => Math.hypot(p.x - stop.x, p.y - stop.y) > 3)) continue;
      const color = bodies[stop.index].team < 0 ? '#fff' : bodies[stop.index].team === 0 ? home : away;
      line(stop.x - 4, stop.y - 4, stop.x + 4, stop.y + 4, color, 2);
      line(stop.x + 4, stop.y - 4, stop.x - 4, stop.y + 4, color, 2);
    }
    for (const hit of prediction.impacts) {
      const team = bodies[hit.index].team;
      const color = team < 0 ? '#ffffff' : team === 0 ? home : away;
      impactCtx.clearRect(0, 0, 128, 128);
      impactCtx.globalCompositeOperation = 'source-over';
      impactCtx.fillStyle = color;
      impactCtx.beginPath(); impactCtx.arc(64, 64, 60, 0, Math.PI * 2); impactCtx.fill();
      ctx.save();
      ctx.translate(hit.x, hit.y);
      if (isPortrait) ctx.rotate(Math.PI / 2);
      const fade = Math.min(1, (prediction.horizon - hit.tick) / 240);
      ctx.globalAlpha = .2 * fade;
      const size = hit.reach * 128 / 60;
      ctx.drawImage(impactStamp, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }
  let themeColors = null;
  const themeObserver = new MutationObserver(() => { themeColors = null; if (skaters.length) draw(); });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeColors = null; if (skaters.length) draw(); });
  function fitStadium() {
    if (!stageArea || !rinkStage || !rinkWrap) return;
    const isFs = isFullscreenActive();

    if (!isPortrait && !isFs) {
      rinkStage.style.width = '';
      rinkStage.style.height = '';
      rinkWrap.style.width = '';
      rinkWrap.style.height = '';
      rinkWrap.style.top = '';
      rinkWrap.style.left = '';
      rinkWrap.style.transform = '';
      return;
    }

    let availW = stageArea.clientWidth || stadium?.clientWidth || 360;
    let availH = stageArea.clientHeight;

    if (!availH || (!isFs && !isPortrait)) {
      const vh = window.innerHeight || document.documentElement.clientHeight || 600;
      availH = isPortrait ? Math.min(vh * 0.72, 680) : Math.min(vh * 0.8, 600);
    }

    availW = Math.max(120, availW);
    availH = Math.max(120, availH);

    if (isPortrait) {
      const targetRatio = 3 / 5;
      let stageW, stageH;
      if (availW / availH > targetRatio) {
        stageH = Math.floor(availH);
        stageW = Math.floor(stageH * targetRatio);
      } else {
        stageW = Math.floor(availW);
        stageH = Math.floor(stageW / targetRatio);
      }

      const wrapW = stageH;
      const wrapH = stageW;

      rinkStage.style.width = stageW + 'px';
      rinkStage.style.height = stageH + 'px';

      rinkWrap.style.width = wrapW + 'px';
      rinkWrap.style.height = wrapH + 'px';
      rinkWrap.style.top = '50%';
      rinkWrap.style.left = '50%';
      rinkWrap.style.transform = 'translate(-50%, -50%) rotate(-90deg)';
    } else {
      const targetRatio = 5 / 3;
      let stageW, stageH;
      if (availW / availH > targetRatio) {
        stageH = Math.floor(availH);
        stageW = Math.floor(stageH * targetRatio);
      } else {
        stageW = Math.floor(availW);
        stageH = Math.floor(stageW / targetRatio);
      }

      rinkStage.style.width = stageW + 'px';
      rinkStage.style.height = stageH + 'px';

      rinkWrap.style.width = '100%';
      rinkWrap.style.height = '100%';
      rinkWrap.style.top = '';
      rinkWrap.style.left = '';
      rinkWrap.style.transform = '';
    }
  }
  function draw() {
    if (layoutDirty) {
      fitStadium();
      renderWidth = canvas.clientWidth; renderHeight = canvas.clientHeight;
      layoutDirty = false;
    }
    positionSpinControl();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(renderWidth * ratio));
    const height = Math.max(1, Math.round(renderHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    if (badgeCanvas.width !== width || badgeCanvas.height !== height) { badgeCanvas.width = width; badgeCanvas.height = height; }
    badgeCtx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); badgeCtx.clearRect(0, 0, 1000, 600);
    ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); ctx.clearRect(0, 0, 1000, 600);
    if (!themeColors) {
      const theme = getComputedStyle(document.documentElement);
      const color = name => theme.getPropertyValue('--' + name).trim();
      themeColors = { primary: color('primary'), secondary: color('secondary'),
        home: color('team-home') || '#E8CA48', away: color('team-away') || '#AA54D3',
        text: color('text'), border: color('border'), surface: color('elevated'), background: color('background') };
    }
    const { primary, secondary, home, away, text, border, surface, background } = themeColors;
    const rinkKey = width + ',' + height + JSON.stringify(themeColors);
    if (rinkCache?.key !== rinkKey) {
      const layer = document.createElement('canvas'); layer.width = width; layer.height = height;
      const mainContext = ctx; ctx = layer.getContext('2d');
      ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0);
    rounded(60, 60, 880, 480, 100); ctx.fillStyle = surface; ctx.fill();
    ctx.strokeStyle = border; ctx.lineWidth = 4; ctx.stroke();
    ctx.setLineDash([6, 10]); line(500, 60, 500, 540, border); ctx.setLineDash([]);
    // Goal pockets interrupt the boundary at the same positions used by physics.
    const depth = P.rink.goalDepth;
    for (const [x, accent] of [[60 - depth, home], [940, away]]) {
      ctx.fillStyle = background; ctx.fillRect(x, 230, depth, 140);
      line(x, 230, x + depth, 230, accent, 4);
      line(x, 370, x + depth, 370, accent, 4);
      line(x === 60 - depth ? x : x + depth, 230, x === 60 - depth ? x : x + depth, 370, accent, 4);
    }
      ctx = mainContext; rinkCache = { key: rinkKey, layer };
    }
    ctx.drawImage(rinkCache.layer, 0, 0, 1000, 600);
    if (phase === 'plan') drawPrediction(home, away);
    drawTrails(home, away);
    shockwaves.forEach(s => {
      const progress = 1 - Math.max(0, s.life / s.duration);
      const r = s.currentRadius + (s.maxRadius - s.currentRadius) * progress;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = s.color || (s.team === 0 ? home : away);
      ctx.lineWidth = Math.max(1, 6 * (1 - progress));
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.stroke();
      ctx.restore();
    });
    bodies.slice(0, 6).forEach((b, i) => {
      const reachR = Math.max(b.radius, b.reach || b.radius, 18);
      const isSuperReady = (b.meter >= 100) || Boolean(b.superArm) || Boolean(b.superActive);

      if (isSuperReady) {
        const activeKey = b.superActive || b.equippedSuper?.key || 'stalwart';

        drawSuperAura(b, activeKey, reachR);

        if (phase === 'plan' && b.superArm && activeKey === 'colossus') {
          ctx.save();
          ctx.setLineDash([5, 5]);
          circle(b.x, b.y, b.radius * 1.8, '#ffe043cc', 2);
          ctx.restore();
        }

        drawSuperBadge(b, activeKey);
      }

      circle(b.x, b.y, reachR + 2, i < 3 ? home : away, 4);

      if ((phase === 'goal' || (onlineReplay?.goalPlayed && phase === 'play')) && b === scoringPlayer) {
        const goalAccent = b.team === 0 ? home : away;
        circle(b.x, b.y, b.radius + 9, goalAccent, 4);
        circle(b.x, b.y, b.radius + 15, goalAccent, 2);
      }
      if ((phase === 'play' && b.guarding) || (phase === 'plan' && i < 3 && plans[i]?.guard)) {
        badgeCtx.save();
        const p = isPortrait ? { x: b.x - b.radius * .65, y: b.y + b.radius * .65 } : { x: b.x + b.radius * .65, y: b.y + b.radius * .65 };
        badgeCtx.translate(p.x, p.y); if (isPortrait) badgeCtx.rotate(Math.PI / 2);
        badgeCtx.scale(1.1, 1.1); badgeCtx.translate(-12, -12); badgeCtx.fillStyle = '#4798ff';
        badgeCtx.fill(new Path2D('M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3'));
        badgeCtx.restore();
      }
      if (b.stunned || b.stunnedNext) {
        ctx.save();
        ctx.font = '16px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (isPortrait) {
          ctx.translate(b.x + b.radius + 14, b.y);
          ctx.rotate(Math.PI / 2);
        } else {
          ctx.translate(b.x, b.y - b.radius - 8);
        }
        ctx.fillText('💫', 0, 0);
        ctx.restore();
      }
      if (b.superActive === 'magnet') {
        const ball = bodies[6];
        const dx = b.x - ball.x, dy = b.y - ball.y;
        if (dx * dx + dy * dy < 260 * 260) {
          ctx.save();
          ctx.setLineDash([4, 6]);
          line(b.x, b.y, ball.x, ball.y, '#3388ffcc', 2.5);
          ctx.restore();
        }
      }
      const style = skaters[i].style;
      const width = b.radius / 5 + '%';
      const opacity = b.superActive === 'ghost' ? '0.45' : '1';
      const filter = b.stunned || b.stunnedNext ? 'grayscale(0.8) brightness(0.7)' : '';
      const transform = `translate(${b.x / 1000 * renderWidth}px, ${b.y / 600 * renderHeight}px) translate(-50%, -50%) rotate(${b.rotation + (isPortrait ? Math.PI / 2 : 0)}rad)`;

      if (style.width !== width) style.width = width;
      if (style.opacity !== opacity) style.opacity = opacity;
      if (style.filter !== filter) style.filter = filter;
      if (style.transform !== transform) style.transform = transform;
      ctx.save();
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = i < 3 ? home : away;
      if (isPortrait) {
        ctx.translate(b.x - b.radius - 18, b.y);
        ctx.rotate(Math.PI / 2);
      } else {
        ctx.translate(b.x, b.y + b.radius + 18);
      }

      ctx.restore();

      if (i < 3 && phase === 'plan') drawImpulse(b, plans[i], home);
    });
    if (bodies[6]?.stuckTo) drawStickyTether(bodies[6].stuckTo, bodies[6]);

    if (phase === 'plan') {
      const b = bodies[selected];
      circle(b.x, b.y, b.radius + 8, text, 2);
    }
    const ball = bodies[6];
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); ctx.fillStyle = background; ctx.fill(); circle(ball.x, ball.y, ball.radius, text, 2);
    if (ballMark.complete && ballMark.naturalWidth) {
      ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate(ball.rotation + (isPortrait ? Math.PI / 2 : 0));
      const size = ball.radius * 1.7;
      ctx.drawImage(ballMark, -size / 2, -size / 2, size, size); ctx.restore();
    }
    drawParticles(home, away);
    if (goalReplay) {
      ctx.save(); ctx.translate(isPortrait ? 30 : 500, isPortrait ? 300 : 32); if (isPortrait) ctx.rotate(Math.PI / 2);
      ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = text;
      const slow = goalReplay.played < goalReplay.total && ububallMatch.replaySpeed(goalReplay.total - goalReplay.played) < 1;
      ctx.fillText(slow ? 'REPLAY · SLOW MOTION' : 'REPLAY', 0, 0);
      ctx.restore();
    }
  }
  function recordSegment(source, turnPlans, ticks = 0) {
    if (P.settled(source)) playSegments = [];
    playSegments.push({ bodies: structuredClone(source), plans: structuredClone(turnPlans), ticks });
  }
  // Replays re-simulate each recorded turn from its exact starting state on a display copy.
  const replayView = cb => toViewBody(cb, goalReplay.sim, goalReplay.seat);
  const syncReplay = () => syncViewBodies(goalReplay.sim, goalReplay.seat);
  const replayFx = {
    hit: (a, b, speed) => { syncReplay(); handleCollision(replayView(a), replayView(b), speed); },
    wall: (body, velocity, wallType, nx, ny) => { syncReplay(); handleWall(replayView(body), velocity, wallType, goalReplay.seat ? -nx : nx, goalReplay.seat ? -ny : ny); },
    shock: (source, radius) => { syncReplay(); handleShockwave(replayView(source), radius); },
    super: (key, stage, body, target = null) => { syncReplay(); handleSuper(key, stage, replayView(body), target ? replayView(target) : null); }
  };
  function restartGoalReplay() {
    Object.assign(goalReplay, { index: -1, played: 0, steps: 0, doneAt: 0 });
    clearEffects(); nextReplaySegment();
  }
  function nextReplaySegment() {
    const r = goalReplay, segment = r.segments[++r.index];
    r.sim = structuredClone(segment.bodies); r.tick = 0;
    P.startTurn(r.sim, segment.plans, replayFx.super);
    syncReplay();
  }
  function startGoalReplay() {
    const segments = playSegments.filter(s => s.ticks);
    if (!segments.length || (online?.active && online.state?.phase !== 'resolving')) return;
    endGoalReplay();
    const real = bodies, scorer = real.indexOf(scoringPlayer);
    goalReplay = { segments, total: segments.reduce((n, s) => n + s.ticks, 0),
      real, display: structuredClone(real), seat: online?.active ? online.state.seat : 0, scorer };
    bodies = goalReplay.display; scoringPlayer = bodies[scorer] || null;
    restartGoalReplay(); draw();
  }
  // The replay loops until the next kickoff (or, online, until the server moves on).
  function advanceGoalReplay(delta) {
    const r = goalReplay;
    if (r.played >= r.total) { if (performance.now() >= r.doneAt) restartGoalReplay(); draw(); return; }
    r.steps += delta / P.DT * ububallMatch.replaySpeed(r.total - r.played);
    for (let n = 0; r.steps >= 1 && r.played < r.total && n < 48; n++) {
      if (r.tick >= r.segments[r.index].ticks) nextReplaySegment();
      P.step(r.sim, P.DT, replayFx.hit, replayFx.wall, replayFx.shock, replayFx.super);
      r.tick++; r.played++; r.steps--;
      syncReplay(); recordTrails();
    }
    if (r.played >= r.total) r.doneAt = performance.now() + ububallMatch.GOAL_REPLAY_HOLD;
    emitMaterialTrails(delta); draw();
  }
  function endGoalReplay() {
    goalReplayAt = 0;
    if (!goalReplay) return;
    bodies = goalReplay.real; scoringPlayer = bodies[goalReplay.scorer] || null; goalReplay = null;
    bodies.slice(0, 6).forEach(b => dirtyMeters.add(b));
    clearEffects(); sync(); draw();
  }
  function finishTurn(goal) {
    const ticks = Math.round(elapsed / P.DT);
    if (playSegments.length) playSegments[playSegments.length - 1].ticks = ticks;
    ububallMatch.finishTurn(P, bodies, stats, scores, goal, matchMode);
    matchTicks += ticks;
    bodies.slice(0, 6).forEach(b => dirtyMeters.add(b));
    accumulator = 0; layoutDirty = true;
    if (goal !== null) {
      phase = scores[goal] >= 5 ? 'over' : 'goal';
      const ball = bodies[6];
      burst(ball.x, ball.y, goal, 1, true);
      if (!reducedMotion.matches) {
        for (let i = 0; i < 4; i++) fireworks.push({
          x: goal === 0 ? 740 + Math.random() * 110 : 150 + Math.random() * 110,
          y: 160 + Math.random() * 260, team: goal, delay: .18 + i * .22
        });
      }
      const scorer = lastTouchByTeam[goal] || bodies.slice(goal * 3, goal * 3 + 3)[0];
      goalReplayAt = performance.now() + ububallMatch.GOAL_REPLAY_DELAY;
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
      turn++; phase = 'plan'; resetPlans();
      say(pulseMode() && !P.settled(bodies) ? 'Pulse paused. Adjust your launches or guard to brake.' : 'Field settled. Plan your next three launches.');
    }
    draw();
  }
  $('launch').onclick = async () => {
    if (online?.active) {
      if (phase === 'plan' && online.send(networkMoves(), true)) { phase = 'waiting'; drag = null; sync(); draw(); }
      return;
    }
    if (phase === 'over') {
      if (isFullscreenActive()) await toggleFullscreen();
      $('new-match').click(); return;
    }
    window.ubuAudio?.getAudioContext();
    if (phase === 'goal') {
      window.ubuAudio?.stop();
      endGoalReplay();
      bodies = kickoff(); turn++; phase = 'plan'; resetPlans(); say('Kickoff. Plan your next three launches.'); draw(); return;
    }
    if (phase !== 'plan') return;
    const generation = cpuGeneration;
    phase = 'cpu-wait'; drag = null; sync(); say('CPU is finishing its plan…');
    await cpuReady;
    if (generation !== cpuGeneration || phase !== 'cpu-wait' || online?.active) return;
    if ($('field-spin').contains(document.activeElement)) document.activeElement.blur();
    window.ubuAudio?.stop();
    lastPlans = structuredClone(plans);
    drag = null;
    const turnPlans = [...plans, ...($('cpu-hold').checked ? [] : cpu)];
    recordSegment(bodies, turnPlans);
    P.startTurn(bodies, turnPlans, handleSuper); elapsed = accumulator = 0; phase = 'play'; sync(); say('Turn in motion…');
  };
  for (const [id, key, scale] of [['angle', 'angle', Math.PI / 180], ['power', 'power', .01], ['shot-spin', 'spin', .01]]) {
    $(id).oninput = () => {
      if (phase !== 'plan' || bodies[selected].stunned) return;
      plans[selected][key] = Number($(id).value) * scale; plans[selected].guard = false;
      sync(); draw();
    };
  }
  for (const [id, delta] of [['spin-less', -.1], ['spin-more', .1]]) {
    $(id).onclick = () => {
      if (phase !== 'plan' || bodies[selected].stunned) return;
      plans[selected].spin = Math.max(-1, Math.min(1, Math.round(((plans[selected].spin || 0) + delta) * 10) / 10)); plans[selected].guard = false;
      sync(); draw();
    };
  }
  // Guarding replaces the launch and brakes the ubu; clearing it leaves the ubu coasting.
  function toggleGuard(i) {
    if (phase !== 'plan' || bodies[i].stunned) return;
    plans[i] = { ...idlePlan(), guard: !plans[i].guard };
    sync(); draw();
  }
  $('hold').onclick = () => toggleGuard(selected);  function point(event) {
    const r = canvas.getBoundingClientRect();
    if (isPortrait) {
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      return {
        x: Math.min(1000, Math.max(0, 500 - (dy / r.height) * 1000)),
        y: Math.min(600, Math.max(0, 300 + (dx / r.width) * 600))
      };
    }
    return {
      x: (event.clientX - r.left) * 1000 / r.width,
      y: (event.clientY - r.top) * 600 / r.height
    };
  }
  canvas.onpointerdown = event => {
    window.ubuAudio?.getAudioContext();
    if (phase !== 'plan') return;
    const p = point(event);
    const target = fieldTarget(event);
    if (target.index < 0) return;
    selected = target.index;
    drag = event.pointerId;
    dragMode = target.mode;
    dragStart = p; dragMoved = false;
    if (dragMode === 'arrow') {
      const arrow = impulseGeometry(bodies[selected], plans[selected]);
      arrowGrab = { x: p.x - arrow.x, y: p.y - arrow.y, distance: arrow.distance, power: plans[selected].power };
    }
    canvas.setPointerCapture(drag);
    sync(); draw();
  };
  canvas.onpointermove = event => {
    const p = point(event);
    if (drag !== event.pointerId || phase !== 'plan') {
      if (phase === 'plan') {
        const target = fieldTarget(event);
        canvas.style.cursor = target.index < 0 ? 'default' : target.mode === 'super' ? 'pointer' : target.mode === 'arrow' ? 'grab' : 'crosshair';
      }
      return;
    }
    const b = bodies[selected];
    // A tap toggles guard; aiming starts once the pointer leaves the tap radius.
    if (!dragMoved && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) < 6) return;
    dragMoved = true; plans[selected].guard = false;
    if (dragMode === 'arrow') {
      const dx = p.x - arrowGrab.x - b.x, dy = p.y - arrowGrab.y - b.y;
      const arrow = impulseGeometry(b, plans[selected]);
      plans[selected].angle = Math.atan2(dy, dx);
      plans[selected].power = Math.max(0, Math.min(1, arrowGrab.power + (Math.hypot(dx, dy) - arrowGrab.distance) / arrow.scale));
    } else if (dragMode === 'aim') {
      const dx = p.x - b.x, dy = p.y - b.y;
      const arrow = impulseGeometry(b, plans[selected]);
      plans[selected].angle = Math.atan2(pullBehind ? -dy : dy, pullBehind ? -dx : dx);
      plans[selected].power = Math.max(0, Math.min(1, pullBehind ? (Math.hypot(dx, dy) - 6) / 120 : (Math.hypot(dx, dy) - arrow.ringR) / arrow.scale));
    }

    sync(); draw();
  };
  canvas.onpointerup = canvas.onpointercancel = event => {
    if (event.type === 'pointerup' && drag === event.pointerId && dragMode === 'aim' && !dragMoved) toggleGuard(selected);
    arrowGrab = null;
    drag = null;
    dragMode = null;
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
    contactMeter(a, b, speed);
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
  const superImpactTimes = new WeakMap();
  function handleSuper(key, phase, body, target = null) {
    // Sustained contact can resolve repeatedly within one animation frame.
    if (key === 'stalwart' && phase === 'impact') {
      const now = performance.now();
      if (now - (superImpactTimes.get(body) ?? -Infinity) < 100) return;
      superImpactTimes.set(body, now);
    }
    if (phase === 'impact' && target && !reducedMotion.matches) {
      const dx = target.x - body.x, dy = target.y - body.y;
      const distance = Math.hypot(dx, dy) || 1;
      const reach = target.team === -1 ? Math.max(body.radius, body.reach || body.radius, 18) : body.radius;
      const x = body.x + dx / distance * reach, y = body.y + dy / distance * reach;
      const tangent = Math.atan2(dy, dx) + Math.PI / 2;
      if (key === 'knockout') {
        burst(x, y, target.team, 3, false, tangent, '#ee2b47');
      } else if (key === 'cannonball' || key === 'stalwart') {
        const color = key === 'cannonball' ? '#ff634d' : '#ffd166';
        burst(x, y, body.team, 3.5, false, tangent, color);
        if (shockwaves.length < 32) shockwaves.push({ x, y, currentRadius: 4,
          maxRadius: key === 'cannonball' ? 48 : 36, team: body.team, color, life: .24, duration: .24 });
      }
    }
    window.ubuAudio?.playSuper?.(key, phase);
  }
  function handleShockwave(source, radius) {
    burst(source.x, source.y, source.team, 1, false, 0, '#ff7197');
    burst(source.x, source.y, source.team, 1, false, 0, '#9d467a');
    shockwaves.push({ x: source.x, y: source.y, currentRadius: 10, maxRadius: radius, team: source.team, color: '#ff7197', life: 0.35, duration: 0.35 });
    shockwaves.push({ x: source.x, y: source.y, currentRadius: 6, maxRadius: radius * 0.88, team: source.team, color: '#9d467a', life: 0.30, duration: 0.30 });
    if (window.ubuAudio) {
      window.ubuAudio.playSuper?.('shockwave', 'impact', { volume: 0.8 });
    }
  }
  function frame(time) {
    const delta = lastTime ? Math.max(0, (time - lastTime) / 1000) : 0; lastTime = time;
    const active = !$('roster-dialog').open && !document.hidden;
    updateClock();
    if (online?.active) {
      if (phase === 'plan') online.send(networkMoves());
      if (goalReplay) { if (active) advanceGoalReplay(delta); }
      else if (onlineReplay && active) playOnlineReplay();
    } else if (blitzMode() && phase === 'plan' && performance.now() >= planDeadline) $('launch').click();
    if (goalReplayAt && performance.now() >= goalReplayAt) { goalReplayAt = 0; startGoalReplay(); }
    if (!active) { lastTime = 0; accumulator = 0; }
    const hadEffects = particles.length || fireworks.length || trails.some(trail => trail.length) || shockwaves.length;
    if (active) updateEffects(delta);
    if (phase === 'play' && active && !online?.active) {
      accumulator += delta;
      let steps = 0;
      while (steps++ < 48 && accumulator >= P.DT && phase === 'play') {
        const goal = P.step(bodies, P.DT, handleCollision, handleWall, handleShockwave, handleSuper); elapsed += P.DT; accumulator -= P.DT;
        recordTrails();
        if (goal !== null || P.settled(bodies) || Math.round(elapsed / P.DT) >= ububallMatch.turnTicks(matchMode)) finishTurn(goal);
      }
      if (phase === 'play') emitMaterialTrails(delta);
      draw();
    } else if (goalReplay && active && !online?.active) advanceGoalReplay(delta);
    else if (active && (hadEffects || (!reducedMotion.matches && bodies.some(b => b.meter >= 100 || b.superArm || b.superActive)))) draw();
    flushMeters();
    requestAnimationFrame(frame);
  }
  function updateRosterSuperPicker() {
    const picker = $('roster-super');
    const grid = $('roster-super-grid');
    if (!picker) return;
    picker.replaceChildren();
    if (grid) grid.replaceChildren();
    const entry = draft[rosterSlot];
    if (!entry) return;
    const available = entry?.model?.supers
      ? Array.from(new Set(entry.model.supers.map(s => s % 8)))
      : [0, 1, 2, 3, 4, 5, 6, 7];
    const list = available.length ? available.map(id => P.SUPERS[id]) : P.SUPERS;
    const currentId = (entry.equippedSuper?.id ?? ((entry.model?.supers?.[0] ?? rosterSlot) % 8));
    list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name}: ${s.desc}`;
      if (s.id === currentId) opt.selected = true;
      picker.append(opt);

      if (grid) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'super-picker-btn';
        btn.setAttribute('aria-pressed', String(s.id === currentId));
        btn.title = `${s.name}: ${s.desc}`;
        const img = document.createElement('img');
        img.src = s.icon;
        img.alt = s.name;
        const txt = document.createElement('span');
        txt.textContent = s.name;
        btn.append(img, txt);
        btn.onclick = () => {
          draft[rosterSlot].equippedSuper = s;
          rosterSlots();
        };
        grid.append(btn);
      }
    });
    picker.onchange = () => {
      draft[rosterSlot].equippedSuper = P.SUPERS[Number(picker.value)];
      rosterSlots();
    };
  }
  function rosterSlots() {
    $('roster-slots').replaceChildren();
    draft.forEach((entry, i) => {
      const button = document.createElement('button');
      const superObj = entry.equippedSuper || P.SUPERS[(entry.model?.supers?.[0] ?? i) % 8];
      const icon = document.createElement('img');
      icon.className = 'slot-super-icon';
      icon.src = superObj.icon;
      icon.alt = superObj.name;
      const text = document.createElement('span');
      text.textContent = `${entry.model.parts.fullName} · ${superObj.name} `;
      button.append(text, icon);
      button.setAttribute('aria-pressed', String(i === rosterSlot));
      button.onclick = () => { rosterSlot = i; rosterSlots(); };
      $('roster-slots').append(button);
    });
    updateRosterSuperPicker();
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
  const toggleFull = $('toggle-full-stats');
  if (toggleFull) {
    toggleFull.onchange = () => {
      document.body.classList.toggle('show-full-stats', toggleFull.checked);
      document.querySelectorAll('.stat-details').forEach(node => { node.open = toggleFull.checked; });
    };
  }
  $('new-match').onclick = () => {
    for (const rule of ububallMatch.RULES) $('rule-' + rule).checked = ububallMatch.rule(matchMode, rule);
    $('cpu-level').value = cpuLevel;
    draft = [...roster]; rosterSlot = 0; rosterSlots(); $('roster-status').textContent = 'Test stats stay with their team slots when changing characters.'; $('roster-dialog').showModal();
  };
  $('start-match').onclick = () => {
    $('roster-dialog').close();
    roster = draft.map(d => ({ ...d }));
    cpuLevel = $('cpu-level').value;
    newMatch(true);
  };
  $('cancel-roster').onclick = () => $('roster-dialog').close();
  // A modal pauses the simulation; cancelling preserves the current turn.
  for (const key of Object.keys(normalStats())) {
    const label = document.createElement('label'), input = document.createElement('input'), output = document.createElement('output');
    label.textContent = key[0].toUpperCase() + key.slice(1) + ' ';
    input.id = 'stat-' + key; input.type = 'number'; input.min = 0; input.max = 255; input.step = 1;
    output.id = 'mult-' + key; label.append(input, output); $('stat-inputs').append(label);
    input.oninput = previewStats;
  }
  const statSuper = $('stat-super');
  if (statSuper) {
    P.SUPERS.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name}: ${s.desc}`;
      statSuper.append(opt);
    });
    statSuper.onchange = () => {
      const idx = Number($('stat-player').value);
      const chosen = P.SUPERS[Number(statSuper.value)];
      if (bodies[idx]) bodies[idx].equippedSuper = chosen;
      if (teamEntries[idx]) teamEntries[idx].equippedSuper = chosen;
      if ($('stat-super-thumb')) $('stat-super-thumb').src = chosen.icon;
      sync(); draw();
    };
  }
  const fillMeter = $('fill-meter');
  if (fillMeter) {
    fillMeter.onclick = () => {
      const idx = Number($('stat-player').value);
      if (!classicMode() && bodies[idx]) {
        bodies[idx].meter = 100;
        sync(); draw();
      }
    };
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
  function showStats() {
    const idx = Number($('stat-player').value);
    for (const key of Object.keys(normalStats())) $('stat-' + key).value = stats[idx][key];
    if ($('stat-super') && bodies?.[idx]) {
      const s = bodies[idx].equippedSuper || P.SUPERS[0];
      $('stat-super').value = s.id;
      if ($('stat-super-thumb')) $('stat-super-thumb').src = s.icon;
    }
    previewStats();
  }
  function resetField() {
    endGoalReplay(); playSegments = [];
    startPlanClock();
    window.ubuAudio?.stop();
    bodies = kickoff(); scores = [0, 0]; turn = 1; phase = 'plan'; elapsed = accumulator = 0; drag = null;
    buildTeam();
    prepareCPU(); sync(); previewStats(); draw(); say('Field reset. Your planned launches are preserved.');
  }
  $('stat-player').onchange = showStats;
  $('apply-stats').onclick = () => { const raw = readStats(); if (!raw || phase === 'play') return; stats[Number($('stat-player').value)] = raw; resetField(); };
  $('normal-stats').onclick = () => { stats = Array.from({ length: 6 }, normalStats); showStats(); resetField(); };
  $('reset-field').onclick = resetField;
  $('restore-shot').onclick = () => { if (!lastPlans) return; plans = structuredClone(lastPlans); resetField(); };
  const hudSuperBtn = $('stadium-super-btn');
  if (hudSuperBtn) {
    hudSuperBtn.onclick = () => {
      const b = bodies[selected];
      if (!classicMode() && b && b.meter >= 100 && phase === 'plan' && !b.stunned) {
        b.superArm = !b.superArm;
        sync(); draw();
      }
    };
  }

  function isFullscreenActive() {
    return Boolean(document.fullscreenElement || stadium?.classList.contains('stadium-fullscreen'));
  }

  function updateFullscreenUI() {
    layoutDirty = true;
    const active = isFullscreenActive();
    if (btnFullscreen) {
      btnFullscreen.setAttribute('aria-pressed', String(active));
      btnFullscreen.title = active ? 'Exit fullscreen' : 'Toggle fullscreen';
      btnFullscreen.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Toggle fullscreen');
      const enterIcon = $('icon-fs-enter');
      const exitIcon = $('icon-fs-exit');
      if (enterIcon && exitIcon) {
        enterIcon.style.display = active ? 'none' : 'block';
        exitIcon.style.display = active ? 'block' : 'none';
      }
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (stadium?.classList.contains('stadium-fullscreen')) {
        stadium.classList.remove('stadium-fullscreen');
        document.body.classList.remove('stadium-fullscreen-active');
        updateFullscreenUI();
        draw();
      } else if (stadium?.requestFullscreen) {
        await stadium.requestFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else {
        stadium?.classList.add('stadium-fullscreen');
        document.body.classList.add('stadium-fullscreen-active');
        updateFullscreenUI();
        draw();
      }
    } catch {
      stadium?.classList.toggle('stadium-fullscreen');
      document.body.classList.toggle('stadium-fullscreen-active');
      updateFullscreenUI();
      draw();
    }
  }

  function toggleRotate() {
    layoutDirty = true;
    isPortrait = !isPortrait;
    stadium?.classList.toggle('portrait-mode', isPortrait);
    if (btnRotate) {
      btnRotate.setAttribute('aria-pressed', String(isPortrait));
      btnRotate.title = isPortrait ? 'Switch to landscape orientation' : 'Switch to portrait orientation';
      btnRotate.setAttribute('aria-label', isPortrait ? 'Switch to landscape orientation' : 'Switch to portrait orientation');
    }
    try {
      localStorage.setItem('ububall-orientation', isPortrait ? 'portrait' : 'landscape');
      if (document.fullscreenElement && screen.orientation?.lock) {
        screen.orientation.lock(isPortrait ? 'portrait' : 'landscape').catch(() => {});
      }
    } catch {}
    draw();
  }

  if (btnFullscreen) btnFullscreen.onclick = toggleFullscreen;
  if (btnRotate) btnRotate.onclick = toggleRotate;
  document.addEventListener('fullscreenchange', () => {
    updateFullscreenUI();
    draw();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && stadium?.classList.contains('stadium-fullscreen')) {
      stadium.classList.remove('stadium-fullscreen');
      document.body.classList.remove('stadium-fullscreen-active');
      updateFullscreenUI();
      draw();
    }
  });

  try {
    if (localStorage.getItem('ububall-orientation') === 'portrait') {
      toggleRotate();
    }
  } catch {}

  [...$('stat-player').options].forEach((option, i) => { option.textContent = teamEntries[i].model.parts.fullName; });
  showStats();
  document.addEventListener('visibilitychange', () => { lastTime = 0; accumulator = 0; });
  const ro = new ResizeObserver(() => { layoutDirty = true; draw(); });
  ro.observe(canvas);
  if (stadium) ro.observe(stadium);
  if (stageArea) ro.observe(stageArea);
  const resizeField = () => { layoutDirty = true; draw(); };
  window.addEventListener('resize', resizeField);
  window.visualViewport?.addEventListener('resize', resizeField);
  practice.slice(0, 3).forEach(addOption); newMatch(); requestAnimationFrame(frame);
  function networkMoves() {
    return plans.map((p, i) => ({ angle: p.angle + (online?.state?.seat ? Math.PI : 0), power: p.power,
      spin: p.spin || 0, superArm: Boolean(bodies[i].superArm), guard: Boolean(p.guard) }));
  }
  function onlineOrder(items, seat) { return seat ? [...items.slice(3, 6), ...items.slice(0, 3), ...items.slice(6)] : items; }
  function viewBodies(items, seat) {
    return onlineOrder(structuredClone(items), seat).map((b, i) => {
      if (seat) { b.x = 1000 - b.x; b.y = 600 - b.y; b.vx = -b.vx; b.vy = -b.vy; b.rotation += Math.PI; }
      b.playerIndex = i; b.team = i < 3 ? 0 : i < 6 ? 1 : -1;
      const entry = teamEntries[i];
      if (entry?.model) {
        b.name = entry.model.parts?.fullName;
        b.voice = entry.model.voice;
        b.personality = entry.model.personality;
        b.equippedSuper = classicMode() ? null : (entry.equippedSuper || b.equippedSuper);
      }
      return b;
    });
  }
  // Maps simulation bodies (server seat-0 order and coordinates) onto the displayed bodies.
  const viewIndex = (i, seat) => seat ? (i < 3 ? i + 3 : i < 6 ? i - 3 : 6) : i;
  function toViewBody(cb, sim = onlineReplay?.simBodies, seat = online?.state?.seat) {
    if (!cb) return null;
    const idx = sim?.indexOf(cb);
    if (idx === undefined || idx < 0) return cb;
    return bodies[viewIndex(idx, seat)] || cb;
  }
  function syncViewBodies(sim = onlineReplay?.simBodies, seat = online?.state?.seat) {
    if (!sim) return;
    sim.forEach((cb, i) => {
      const vb = bodies[viewIndex(i, seat)];
      if (vb) {
        vb.radius = cb.radius;
        if (seat) {
          vb.x = 1000 - cb.x; vb.y = 600 - cb.y;
          vb.vx = -cb.vx; vb.vy = -cb.vy;
          vb.rotation = cb.rotation + Math.PI;
        } else {
          vb.x = cb.x; vb.y = cb.y;
          vb.vx = cb.vx; vb.vy = cb.vy;
          vb.rotation = cb.rotation;
        }
        vb.omega = cb.omega;
        vb.meter = cb.meter ?? 0;
        vb.guarding = Boolean(cb.guarding);
        vb.superActive = cb.superActive || null;
        vb.stunned = Boolean(cb.stunned || cb.stunnedNext);
        vb.stuckTo = cb.stuckTo ? toViewBody(cb.stuckTo, sim, seat) : null;
        dirtyMeters.add(vb);
      }
    });
  }
  function replayCollision(a, b, speed) {
    syncViewBodies();
    handleCollision(toViewBody(a), toViewBody(b), speed);
  }
  function replayWall(body, velocity, wallType, nx, ny) {
    syncViewBodies();
    const seat = online?.state?.seat;
    handleWall(toViewBody(body), velocity, wallType, seat ? -nx : nx, seat ? -ny : ny);
  }
  function replayShockwave(source, radius) {
    syncViewBodies();
    handleShockwave(toViewBody(source), radius);
  }
  function replaySuper(key, phase, body, target = null) {
    syncViewBodies();
    handleSuper(key, phase, toViewBody(body), target ? toViewBody(target) : null);
  }
  function playOnlineReplay() {
    const replay = onlineReplay;
    if (!replay || !replay.simBodies) return;
    const elapsedSec = Math.max(0, (online.now() - replay.startedAt) / 1000);
    const targetTick = Math.min(replay.ticks, Math.floor(elapsedSec / P.DT));
    if (replay.currentTick === undefined) replay.currentTick = 0;

    if (targetTick - replay.currentTick > 60) {
      while (replay.currentTick < targetTick - 8) {
        P.step(replay.simBodies, P.DT);
        replay.currentTick++;
      }
    }

    while (replay.currentTick < targetTick) {
      P.step(replay.simBodies, P.DT, replayCollision, replayWall, replayShockwave, replaySuper);
      replay.currentTick++;
    }
    syncViewBodies();

    if (replay.goal !== null) {
      const preScores = online.state.seat ? [...online.state.game.scores].reverse() : [...online.state.game.scores];
      const viewGoal = replay.goal === online.state.seat ? 0 : 1;
      if (replay.currentTick < replay.ticks) {
        preScores[viewGoal]--;
        scores = preScores;
      } else {
        scores = online.state.seat ? [...online.state.game.scores].reverse() : [...online.state.game.scores];
        if (!replay.goalPlayed) {
          replay.goalPlayed = true;
          goalReplayAt = performance.now() + ububallMatch.GOAL_REPLAY_DELAY;
          const ball = bodies[6];
          burst(ball.x, ball.y, viewGoal, 1, true);
          if (!reducedMotion.matches) {
            for (let i = 0; i < 4; i++) fireworks.push({
              x: viewGoal === 0 ? 740 + Math.random() * 110 : 150 + Math.random() * 110,
              y: 160 + Math.random() * 260, team: viewGoal, delay: .18 + i * .22
            });
          }
          const viewScorerIndex = replay.scorer === null ? null : (online.state.seat ? (replay.scorer < 3 ? replay.scorer + 3 : replay.scorer - 3) : replay.scorer);
          const scorer = viewScorerIndex !== null ? bodies[viewScorerIndex] : bodies[viewGoal * 3];
          scoringPlayer = scorer;
          const scorerName = scorer?.name || (viewGoal === 0 ? 'Your ubu' : 'Opponent ubu');
          say(online.state.game.winner !== null
            ? (viewGoal === 0 ? `You win! Final goal by ${scorerName}.` : `Opponent wins. Final goal by ${scorerName}.`)
            : `${viewGoal === 0 ? 'You score!' : 'Opponent scores.'} Goal by ${scorerName}! Ready for the next kickoff.`
          );
          if (scorer?.voice && window.ubuAudio) window.ubuAudio.playFanfare(scorer.voice);
          sync();
        }
      }
    } else {
      scores = online.state.seat ? [...online.state.game.scores].reverse() : [...online.state.game.scores];
    }

    if (replay.currentTick >= replay.ticks) {
      viewBodies(online.state.game.bodies, online.state.seat).forEach((sample, i) => {
        Object.assign(bodies[i], sample);
        dirtyMeters.add(bodies[i]);
      });
    }

    recordTrails(); emitMaterialTrails(Math.min(.05, 1 / 60)); draw();
  }
  online = ububallOnline({
    onState(s) {
      document.body.classList.add('online-match');
      $('online-open').textContent = 'Online match';
      $('opponent-label').textContent = 'Opponent'; $('opponent-heading').textContent = 'Opponent team';
      $('online-match-status').hidden = false; $('new-match').disabled = true;
      matchMode = s.mode; document.body.classList.toggle('classic-match', classicMode());
      $('mode-label').textContent = 'Online · ' + ububallMatch.modeName(s.mode);
      const rematchBtn = $('online-rematch');
      if (rematchBtn) {
        rematchBtn.hidden = s.phase !== 'over';
        if (s.phase === 'over') {
          const myRematch = s.rematch?.[s.seat];
          const oppRematch = s.rematch?.[1 - s.seat];
          rematchBtn.disabled = Boolean(myRematch);
          rematchBtn.textContent = myRematch ? 'Rematch requested' : oppRematch ? 'Accept rematch' : 'Rematch';
        }
      }
      if (!s.game) { phase = 'waiting'; onlineReplay = null; sync(); draw(); return; }
      const rosterKey = JSON.stringify(s.rosters);
      if (rosterKey !== onlineRoster) {
        onlineRoster = rosterKey;
        teamEntries = onlineOrder(s.rosters.flat(), s.seat).map(entry => ({ model: ubu.decode(ubu.fromCode(entry.dna)), equippedSuper: P.SUPERS[entry.superId] }));
        roster = teamEntries.slice(0, 3); buildTeam();
      }
      const fresh = onlineTurn !== s.turn || onlineDisconnected || (s.phase === 'plan' && onlinePhase !== 'plan');
      onlinePhase = s.phase;
      onlineDisconnected = false;
      const armed = bodies.slice(0, 3).map(b => Boolean(b.superArm));
      if (fresh || !s.connected.every(Boolean) || s.locked[s.seat]) drag = null;
      if (fresh) { onlineTurn = s.turn; scoringPlayer = null; clearEffects(); }
      if (s.phase !== 'resolving') endGoalReplay();
      bodies = viewBodies(s.game.bodies, s.seat);
      // A running goal replay keeps the display; the server state becomes what it restores.
      if (goalReplay) { goalReplay.real = bodies; bodies = goalReplay.display; }
      stats = onlineOrder(s.game.stats, s.seat);
      const rawScores = (s.phase === 'resolving' && s.replay?.goal !== null && !s.replay.goalPlayed)
        ? s.game.scores.map((sc, gi) => gi === s.replay.goal ? sc - 1 : sc)
        : s.game.scores;
      scores = s.seat ? [...rawScores].reverse() : [...rawScores];
      turn = s.turn;
      if (fresh) plans = s.moves.map(p => ({
        ...p,
        angle: p.power === 0 ? 0 : (((p.angle + (s.seat ? Math.PI : 0)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      }));
      plans.forEach((p, i) => { bodies[i].superArm = fresh ? s.moves[i].superArm : armed[i]; });
      if (!s.replay) {
        onlineReplay = null;
      } else if (onlineReplay?.turn !== s.replay.turn) {
        onlineReplay = s.replay;
        onlineReplay.currentTick = 0;
        onlineReplay.simBodies = structuredClone(s.replay.initialBodies);
        const classic = classicMode();
        onlineReplay.simBodies.forEach((b, i) => {
          if (i < 6) {
            const entry = (i < 3 ? s.rosters[0]?.[i] : s.rosters[1]?.[i - 3]);
            if (entry) {
              const model = ubu.decode(ubu.fromCode(entry.dna));
              b.voice = model.voice;
              b.name = model.parts?.fullName;
              b.equippedSuper = classic ? null : P.SUPERS[entry.superId];
            }
          }
        });
        recordSegment(onlineReplay.simBodies, onlineReplay.plans, s.replay.ticks);
        P.startTurn(onlineReplay.simBodies, onlineReplay.plans, replaySuper);
        syncViewBodies();
      }
      phase = s.phase === 'over' ? 'over' : s.phase === 'resolving' ? 'play' : s.connected.every(Boolean) && !s.locked[s.seat] ? 'plan' : 'waiting';
      $('online-match-status').textContent = s.phase === 'over' ? (s.rematch?.[s.seat] ? 'Rematch requested · waiting for opponent' : s.rematch?.[1 - s.seat] ? 'Opponent requested a rematch!' : (s.winner === s.seat ? 'You win!' : 'Opponent wins.')) : !s.connected.every(Boolean) ? 'Disconnected · planning paused' : s.locked[s.seat] ? 'Moves locked · waiting for opponent' : s.phase === 'resolving' ? 'Turn in motion' : 'Plan your moves';
      sync(); if (onlineReplay) playOnlineReplay(); else draw();
    },
    onDisconnect() { onlineDisconnected = true; phase = 'waiting'; drag = null; $('online-match-status').textContent = 'Reconnecting · planning paused'; sync(); draw(); },
    onError(message) { $('online-match-status').textContent = message; },
    onLeave() {
      onlineRoster = ''; onlineTurn = 0; onlineReplay = null; onlinePhase = ''; scoringPlayer = null;
      document.body.classList.remove('online-match');
      $('online-open').textContent = 'Play online';
      $('new-match').disabled = false; $('online-match-status').hidden = true; $('online-forfeit').hidden = true;
      const rematchBtn = $('online-rematch'); if (rematchBtn) rematchBtn.hidden = true;
      $('opponent-label').textContent = 'CPU'; $('opponent-heading').textContent = 'CPU team';
      draft = practice.slice(0, 3); newMatch();
    }
  });
  const rematchBtn = $('online-rematch');
  if (rematchBtn) {
    rematchBtn.onclick = () => { online?.rematch?.(); };
  }
  const rosterParam = new URL(location.href).searchParams.get('roster');
  if (rosterParam !== null) {
    const url = new URL(location.href);
    url.searchParams.delete('roster');
    history.replaceState(null, '', url);
    $('new-match').click();
    loadCollection();
  }
})();
