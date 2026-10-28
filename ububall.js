'use strict';
(() => {
  const $ = id => document.getElementById(id), P = ububallPhysics;
  const canvas = $('rink'), ctx = canvas.getContext('2d');
  const ballMark = new Image();
  ballMark.src = 'uburoom-oomark-brand.svg';
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
  let elapsed = 0, accumulator = 0, lastTime = 0, drag = null, dragMode = null, dragPoint = null, spinClickStart = null, skaters = [], next = '';
  let isPortrait = false;
  const stadium = document.querySelector('.stadium');
  const stageArea = document.querySelector('.stadium-stage-area');
  const rinkStage = document.querySelector('.rink-stage');
  const rinkWrap = document.querySelector('.rink-wrap');
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
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function clearEffects() {
    trails.forEach(trail => { trail.length = 0; });
    particles.length = fireworks.length = shockwaves.length = 0;
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
  function kickoff(isNewMatch = false) {
    clearEffects();
    lastTouchByTeam = { 0: null, 1: null }; scoringPlayer = null;
    const oldBodies = bodies;
    const result = P.kickoff();
    result.slice(0, 6).forEach((b, i) => {
      P.applyStats(b, stats[i]);
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
        b.superArm = false;
        b.superActive = null;
      }
    });
    return result;
  }
  function gainMeter(b, baseAmount) {
    if (!b || b.team < 0) return;
    const playerIdx = b.playerIndex;
    const eff = stats[playerIdx]?.efficiency ?? 127;
    const effMult = P.multiplier(eff);
    const gain = baseAmount * effMult;
    b.meter = Math.min(100, Math.max(0, (b.meter || 0) + gain));

    const syn = stats[playerIdx]?.synergy ?? 127;
    const synMult = P.multiplier(syn);
    const start = b.team * 3, end = start + 3;
    for (let i = start; i < end; i++) {
      const teammate = bodies[i];
      if (teammate && teammate !== b) {
        const chem = stats[i]?.chemistry ?? 127;
        const chemMult = P.multiplier(chem);
        teammate.meter = Math.min(100, Math.max(0, (teammate.meter || 0) + gain * synMult * chemMult * 0.25));
      }
    }
  }
  function say(message) { $('game-status').textContent = message; }
  function resetPlans() {
    plans = Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0 }));
    cpu = P.cpuPlans(bodies, Math.random, scores); // Commit before any human planning input.
    sync();
  }
  function renderStatsBox(statSource) {
    const wrap = document.createElement('div'); wrap.className = 'ubu-stats-wrap';
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
    wrap.append(compactBox, fullBox);
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
        if (b && b.meter >= 100 && phase === 'plan' && !b.stunned) {
          b.superArm = !b.superArm;
          sync(); draw();
        }
      };
      wrap.append(btn);
    }
    return wrap;
  }
  function sync() {
    const planning = phase === 'plan';
    const isGoal = phase === 'goal';
    $('phase').textContent = phase === 'over' ? 'Match complete' : `${planning ? 'Plan' : isGoal ? 'Goal' : 'In play'} · Turn ${turn}`;
    $('home-score').textContent = scores[0]; $('away-score').textContent = scores[1];
    const curB = bodies[selected];
    const isStunned = Boolean(curB?.stunned);
    if (isStunned) {
      plans[selected].power = plans[selected].spin = 0;
    }
    for (const id of ['angle', 'power', 'shot-spin', 'hold']) $(id).disabled = !planning || isStunned;
    $('launch').disabled = !planning && !isGoal;
    for (const node of $('stat-testing').querySelectorAll('input, select, button')) node.disabled = phase === 'play';
    $('restore-shot').disabled = phase === 'play' || !lastPlans;
    if (!readStats()) $('apply-stats').disabled = true;
    document.querySelector('.stadium')?.classList.toggle('goal-phase', isGoal);
    $('launch').textContent = isGoal ? 'Next kickoff' : 'Launch';
    const angle = Math.round((plans[selected].angle * 180 / Math.PI + 360) % 360);
    $('angle').value = angle; $('angle-value').value = angle + '°';
    $('power').value = Math.round(plans[selected].power * 100); $('power-value').value = $('power').value + '%';
    $('shot-spin').value = Math.round((plans[selected].spin || 0) * 100); $('shot-spin-value').value = $('shot-spin').value + '%';
    [...$('team').children].forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === selected)); button.disabled = !planning;
      const small = button.querySelector('small');
      if (small) {
        if (bodies[i]?.stunned) small.textContent = '💫 Stunned this turn';
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
      hudSuperBtn.classList.toggle('armed', Boolean(curB.superArm));
      if (hudSuperText) {
        if (curB.stunned) {
          hudSuperText.textContent = '💫 STUNNED';
        } else if (curB.superArm) {
          hudSuperText.textContent = '⚡ ARMED';
        } else if (curB.meter >= 100) {
          hudSuperText.textContent = `ARM ${s.name.toUpperCase()}`;
        } else {
          hudSuperText.textContent = `${s.name} ${Math.round(curB.meter || 0)}%`;
        }
      }
    }
  }
  function buildTeam() {
    $('team').replaceChildren();
    if ($('cpu-team')) $('cpu-team').replaceChildren();
    $('skaters').replaceChildren();
    teamEntries = [...roster, ...practice.slice(3)];
    teamEntries.forEach((entry, i) => {
      if (entry.model && entry.model.stats) stats[i] = { ...entry.model.stats };
    });
    skaters = teamEntries.map((entry, i) => {
      const node = document.createElement('div'); node.className = 'skater'; node.append(ubuRender(entry.model, 'ball-ubu')); $('skaters').append(node);
      return node;
    });
    teamEntries.slice(0, 3).forEach((entry, i) => {
      const button = document.createElement('button'); button.type = 'button'; button.id = `player-${i}`;
      const header = document.createElement('div'); header.className = 'card-header';
      const titles = document.createElement('div'); titles.className = 'card-titles';
      const strong = document.createElement('strong'); strong.textContent = `${i + 1}. ${entry.model.parts.fullName}`;
      const small = document.createElement('small'); small.textContent = '0% power · 0% spin';
      titles.append(strong, small);
      header.append(ubuRender(entry.model, 'ball-thumb'), titles);
      button.append(header, renderStatsBox(stats[i] || entry.model.stats || {}), renderSuperPanel(i, false));
      button.onclick = () => { selected = i; sync(); draw(); };
      $('team').append(button);
    });
    if ($('cpu-team')) {
      teamEntries.slice(3, 6).forEach((entry, idx) => {
        const i = idx + 3;
        const card = document.createElement('div'); card.className = 'team-card cpu-card'; card.id = `player-${i}`;
        const header = document.createElement('div'); header.className = 'card-header';
        const titles = document.createElement('div'); titles.className = 'card-titles';
        const strong = document.createElement('strong'); strong.textContent = `${idx + 1}. ${entry.model.parts.fullName}`;
        const small = document.createElement('small'); small.className = 'away'; small.textContent = `CPU ${idx + 1}`;
        titles.append(strong, small);
        header.append(ubuRender(entry.model, 'ball-thumb'), titles);
        card.append(header, renderStatsBox(stats[i] || entry.model.stats || {}), renderSuperPanel(i, true));
        $('cpu-team').append(card);
      });
    }
  }
  function newMatch() {
    window.ubuAudio?.stop();
    roster = [...draft]; teamEntries = [...roster, ...practice.slice(3)]; bodies = kickoff(true); buildTeam(); scores = [0, 0]; turn = 1; selected = 0; phase = 'plan'; elapsed = accumulator = 0; drag = null;
    resetPlans(); say('Pull back from an ubu to aim and launch, or turn its spin dial.'); draw();
  }
  function rounded(x, y, width, height, radius) { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); }
  function line(x1, y1, x2, y2, color, width = 2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  function circle(x, y, r, color, width = 2) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  function computeTrajectory(body, plan, allBodies) {
    return P.computeTrajectory(body, plan, allBodies);
  }
  function drawTrajectory(body, plan, trajectoryData, color) {
    const activeSuper = body.superActive || ((body.superArm && (body.meter ?? 0) >= 100) ? body.equippedSuper?.key : null);
    if (!plan || plan.power <= 0 || body.stunned || activeSuper === 'stalwart') return;
    const points = trajectoryData?.points || [];
    const isColossus = activeSuper === 'colossus';
    const effRadius = body.radius * (isColossus ? 1.8 : 1);
    const impulse = body.impulse || P.IMPULSE;
    const impulseRatio = (impulse / P.IMPULSE) / (isColossus ? 2.5 : 1);
    const ringR = Math.max(effRadius, body.reach || effRadius, 18) + 2;
    const maxArrowDist = Math.max(20, 110 * impulseRatio * plan.power);

    // 1. Dashed trajectory path (separate from the impulse arrow)
    if (points.length > 1) {
      for (let i = 1; i < points.length; i++) {
        const d = points[i].dist;
        if (d < ringR) continue;
        const p0 = points[i - 1].dist < ringR ? {
          x: body.x + (points[i].x - body.x) * (ringR / (points[i].dist || 1)),
          y: body.y + (points[i].y - body.y) * (ringR / (points[i].dist || 1))
        } : points[i - 1];
        const alpha = Math.max(0, Math.min(1, (480 - d) / 180));
        if (alpha <= 0.01) continue;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 2. Solid impulse arrow coming out of the hitbox ring in plan.angle
    const startX = body.x + Math.cos(plan.angle) * ringR;
    const startY = body.y + Math.sin(plan.angle) * ringR;
    const endX = startX + Math.cos(plan.angle) * maxArrowDist;
    const endY = startY + Math.sin(plan.angle) * maxArrowDist;

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
      const impactColor = impact.type === 'knockout' ? '#ff3366' : '#ff9954';
      circle(impact.x, impact.y, 7, impactColor, 2.5);
      ctx.beginPath();
      ctx.arc(impact.x, impact.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
  }
  const trajectoryCache = [null, null, null];
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

    if (!availH || !isFs) {
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
    fitStadium();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); ctx.clearRect(0, 0, 1000, 600);
    if (!themeColors) {
      const theme = getComputedStyle(document.documentElement);
      const color = name => theme.getPropertyValue('--' + name).trim();
      themeColors = { primary: color('primary'), secondary: color('secondary'), text: color('text'),
        border: color('border'), surface: color('elevated'), background: color('background') };
    }
    const { primary, secondary, text, border, surface, background } = themeColors;
    const fieldSignature = phase === 'plan' ? bodies.map(b => [b.x, b.y, b.radius, b.reach, b.mass,
      b.bounciness, b.power, b.grip, b.impulse, b.friction, b.maxSpin, b.curveFactor,
      b.superArm ? b.equippedSuper?.key : '', b.superActive || ''].join(',')).join(';') : '';
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
    shockwaves.forEach(s => {
      const progress = 1 - Math.max(0, s.life / s.duration);
      const r = s.currentRadius + (s.maxRadius - s.currentRadius) * progress;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = s.team === 0 ? primary : secondary;
      ctx.lineWidth = Math.max(1, 6 * (1 - progress));
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.stroke();
      ctx.restore();
    });
    bodies.slice(0, 6).forEach((b, i) => {
      const reachR = Math.max(b.radius, b.reach || b.radius, 18);
      circle(b.x, b.y, reachR + 2, i < 3 ? primary : secondary, 4);

      if (phase === 'goal' && b === scoringPlayer) {
        circle(b.x, b.y, b.radius + 9, '#ff9954', 4);
        circle(b.x, b.y, b.radius + 15, primary, 2);
      }
      if (b.superArm || b.superActive) {
        const activeKey = b.superActive || (b.superArm ? b.equippedSuper?.key : null);
        const auraColor = activeKey === 'cannonball' ? '#ff4d4d'
          : activeKey === 'magnet' ? '#33ccff'
          : activeKey === 'sticky' ? '#44dd66'
          : activeKey === 'stalwart' ? '#ffd166'
          : activeKey === 'knockout' ? '#ff3366'
          : activeKey === 'colossus' ? '#bb66ff'
          : activeKey === 'ghost' ? '#b2ebf2'
          : '#ff7197';
        if (phase === 'plan' && b.superArm && activeKey === 'colossus') {
          ctx.save();
          ctx.setLineDash([5, 5]);
          circle(b.x, b.y, b.radius * 1.8, '#bb66ffaa', 2);
          ctx.restore();
        }
        ctx.save();
        ctx.beginPath();
        const pulse = Math.sin(Date.now() / 120) * 3;
        ctx.arc(b.x, b.y, b.radius + 8 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = auraColor;
        ctx.lineWidth = 3;
        ctx.shadowColor = auraColor;
        ctx.shadowBlur = 14;
        ctx.stroke();

        const superIdx = b.equippedSuper?.id ?? 0;
        const icon = superImages[superIdx];
        if (icon && icon.complete && icon.naturalWidth) {
          const sz = 22;
          ctx.shadowBlur = 8;
          ctx.save();
          if (isPortrait) {
            ctx.translate(b.x + b.radius + sz / 2 + 5, b.y);
            ctx.rotate(Math.PI / 2);
          } else {
            ctx.translate(b.x, b.y - b.radius - sz / 2 - 4);
          }
          ctx.drawImage(icon, -sz / 2, -sz / 2, sz, sz);
          ctx.restore();
        }
        ctx.restore();
      }
      if (b.stunned) {
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
          line(b.x, b.y, ball.x, ball.y, '#33ccff88', 2);
          ctx.restore();
        }
      }
      const style = skaters[i].style;
      const left = b.x / 10 + '%', top = b.y / 6 + '%', width = b.radius / 5 + '%';
      const opacity = b.superActive === 'ghost' ? '0.45' : '1';
      const filter = b.stunned ? 'grayscale(0.8) brightness(0.7)' : '';
      const transform = `translate(-50%, -50%) rotate(${b.rotation}rad)`;
      if (style.left !== left) style.left = left;
      if (style.top !== top) style.top = top;
      if (style.width !== width) style.width = width;
      if (style.opacity !== opacity) style.opacity = opacity;
      if (style.filter !== filter) style.filter = filter;
      if (style.transform !== transform) style.transform = transform;
      ctx.save();
      ctx.font = 'bold 12px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = i < 3 ? primary : secondary;
      if (isPortrait) {
        ctx.translate(b.x - b.radius - 18, b.y);
        ctx.rotate(Math.PI / 2);
      } else {
        ctx.translate(b.x, b.y + b.radius + 18);
      }
      ctx.fillText(String(i % 3 + 1), 0, 0);
      ctx.restore();

      // Curved launch arrow and dashed trajectory (drawn before spin knob so knob is on top)
      if (i < 3 && phase === 'plan' && plans[i].power > 0) {
        const plan = plans[i];
        const key = `${fieldSignature}|${i}|${plan.angle}|${plan.power}|${plan.spin}`;
        let cached = trajectoryCache[i];
        if (!cached || cached.key !== key) {
          cached = { key, data: computeTrajectory(b, plan, bodies) };
          trajectoryCache[i] = cached;
        }
        drawTrajectory(b, plan, cached.data, primary);
      }
    });
    if (bodies[6]?.stuckTo) {
      ctx.save();
      ctx.beginPath();
      ctx.arc((bodies[6].stuckTo.x + bodies[6].x) / 2, (bodies[6].stuckTo.y + bodies[6].y) / 2, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#44dd6688';
      ctx.fill();
      ctx.restore();
    }

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
    bodies.slice(0, 6).forEach(b => {
      if (b.stunnedNext) {
        b.stunned = true;
        delete b.stunnedNext;
      }
      b.superActive = null;
      b.shockwaveFired = false;
      gainMeter(b, 10);
    });
    if (goal !== null) {
      scores[goal]++; phase = scores[goal] >= 5 ? 'over' : 'goal';
      const conceding = 1 - goal;
      bodies.slice(conceding * 3, conceding * 3 + 3).forEach(b => gainMeter(b, 15));
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
    drag = null;
    bodies.slice(0, 3).forEach(b => {
      if (b.superArm && b.meter >= 100) {
        b.meter = 0;
        b.superActive = b.equippedSuper.key;
        b.superArm = false;
      }
    });
    if (!$('cpu-hold').checked) {
      bodies.slice(3, 6).forEach((b, i) => {
        if (b.meter >= 100 && !b.stunned && cpu?.[i]?.superArm) {
          b.meter = 0;
          b.superActive = b.equippedSuper.key;
        }
      });
    }
    P.launch(bodies, [...plans, ...($('cpu-hold').checked ? [] : cpu)]); elapsed = accumulator = 0; phase = 'play'; sync(); say('Turn in motion…');
  };
  for (const id of ['angle', 'power', 'shot-spin']) $(id).oninput = () => { if (phase !== 'plan') return; plans[selected] = { angle: radians(Number($('angle').value)), power: Number($('power').value) / 100, spin: Number($('shot-spin').value) / 100 }; sync(); draw(); };
  $('hold').onclick = () => { plans[selected].power = plans[selected].spin = 0; sync(); draw(); };
  function point(event) {
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
      gainMeter(player, 18);
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
      gainMeter(a, 10);
      gainMeter(b, 10);
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
  function handleShockwave(source, radius) {
    burst(source.x, source.y, source.team, 1, true);
    shockwaves.push({ x: source.x, y: source.y, currentRadius: 10, maxRadius: radius, team: source.team, life: 0.35, duration: 0.35 });
    if (window.ubuAudio) {
      window.ubuAudio.playGoalHit?.('net', { volume: 0.8 });
    }
  }
  function frame(time) {
    const delta = lastTime ? Math.min((time - lastTime) / 1000, .05) : 0; lastTime = time;
    const active = !$('roster-dialog').open && !document.hidden;
    const hadEffects = particles.length || fireworks.length || trails.some(trail => trail.length) || shockwaves.length;
    if (active) updateEffects(delta);
    if (phase === 'play' && active) {
      accumulator += delta;
      while (accumulator >= P.DT && phase === 'play') {
        const goal = P.step(bodies, P.DT, handleCollision, handleWall, handleShockwave); elapsed += P.DT; accumulator -= P.DT;
        recordTrails();
        if (goal !== null || P.settled(bodies) || elapsed >= 12) finishTurn(goal);
      }
      draw();
    } else if (active && hadEffects) draw();
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
      text.textContent = `${i + 1}. ${entry.model.parts.fullName} · ${superObj.name} `;
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
    };
  }
  $('new-match').onclick = () => {
    draft = [...roster]; rosterSlot = 0; rosterSlots(); $('roster-status').textContent = 'Test stats stay with their team slots when changing characters.'; $('roster-dialog').showModal();
  };
  $('start-match').onclick = () => {
    $('roster-dialog').close();
    roster = draft.map(d => ({ ...d }));
    newMatch();
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
      if (bodies[idx]) {
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
    window.ubuAudio?.stop();
    bodies = kickoff(); scores = [0, 0]; turn = 1; phase = 'plan'; elapsed = accumulator = 0; drag = null;
    buildTeam();
    cpu = P.cpuPlans(bodies, () => .5, scores); sync(); previewStats(); draw(); say('Field reset. Your planned launches are preserved.');
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
      if (b && b.meter >= 100 && phase === 'plan' && !b.stunned) {
        b.superArm = !b.superArm;
        sync(); draw();
      }
    };
  }

  function isFullscreenActive() {
    return Boolean(document.fullscreenElement || stadium?.classList.contains('stadium-fullscreen'));
  }

  function updateFullscreenUI() {
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

  showStats();
  document.addEventListener('visibilitychange', () => { lastTime = 0; });
  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);
  if (stadium) ro.observe(stadium);
  if (stageArea) ro.observe(stageArea);
  window.addEventListener('resize', () => draw());
  practice.slice(0, 3).forEach(addOption); newMatch(); requestAnimationFrame(frame);
})();
