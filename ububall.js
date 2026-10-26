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
  let elapsed = 0, accumulator = 0, lastTime = 0, drag = null, dragMode = null, dragPoint = null, skaters = [], next = '';
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
  function kickoff() {
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
  function computeTrajectory(body, plan) {
    const points = [{ x: body.x, y: body.y }];
    if (!plan || plan.power <= 0) return points;
    const impulse = body.impulse || P.IMPULSE;
    const v0 = (impulse / body.mass) * plan.power;
    let vx = Math.cos(plan.angle) * v0;
    let vy = Math.sin(plan.angle) * v0;
    let omega = (plan.spin || 0) * (body.maxSpin || 8);
    const curve = body.curveFactor !== undefined ? body.curveFactor : 0.04;
    const friction = body.friction || 150;
    let currX = body.x, currY = body.y;
    const impulseRatio = impulse / P.IMPULSE;
    const maxSteps = Math.min(55, Math.round(10 + plan.power * 32 * impulseRatio));
    const dt = 1 / 60;
    for (let s = 0; s < maxSteps; s++) {
      const angle = omega * curve * dt;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const nvx = vx * cos - vy * sin;
      const nvy = vx * sin + vy * cos;
      vx = nvx; vy = nvy;
      omega = Math.sign(omega) * Math.max(0, Math.abs(omega) - 6 * dt);
      currX += vx * dt; currY += vy * dt;
      points.push({ x: currX, y: currY });
      const speed = Math.hypot(vx, vy);
      if (speed < 12) break;
      const factor = Math.max(0, speed - friction * dt) / speed;
      vx *= factor; vy *= factor;
    }
    return points;
  }
  function drawTrajectory(points, color) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    const pEnd = points[points.length - 1];
    const pPrev = points[Math.max(0, points.length - 3)];
    const tipAngle = Math.atan2(pEnd.y - pPrev.y, pEnd.x - pPrev.x);
    for (const offset of [-0.55, 0.55]) {
      line(pEnd.x, pEnd.y, pEnd.x - Math.cos(tipAngle + offset) * 14, pEnd.y - Math.sin(tipAngle + offset) * 14, color, 4);
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
    bodies.slice(0, 6).forEach((b, i) => {
      circle(b.x, b.y, b.radius + 3, i < 3 ? primary : secondary, 4);
      if (i === selected && phase === 'plan') {
        circle(b.x, b.y, b.radius + 8, text, 2);

        // Spin dial track around the selected ubu
        const dialR = b.radius + 18;
        ctx.setLineDash([3, 5]);
        circle(b.x, b.y, dialR, 'rgba(255, 255, 255, 0.22)', 1.5);
        ctx.setLineDash([]);

        // Straight / 0 spin notch along launch angle
        const notchX = b.x + Math.cos(plans[i].angle) * dialR;
        const notchY = b.y + Math.sin(plans[i].angle) * dialR;
        circle(notchX, notchY, 2.5, 'rgba(255, 255, 255, 0.5)', 2);

        // Spin handle angle
        const spin = plans[i].spin || 0;
        const handleAngle = plans[i].angle + spin * (Math.PI / 2.2);
        const hx = b.x + Math.cos(handleAngle) * dialR;
        const hy = b.y + Math.sin(handleAngle) * dialR;

        // Spin arc from straight notch to handle
        if (Math.abs(spin) > 0.04) {
          ctx.beginPath();
          const startA = Math.min(plans[i].angle, handleAngle);
          const endA = Math.max(plans[i].angle, handleAngle);
          ctx.arc(b.x, b.y, dialR, startA, endA);
          ctx.strokeStyle = '#ff9954';
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        // Spin knob handle
        const isDraggingSpin = dragMode === 'spin';
        ctx.beginPath();
        ctx.arc(hx, hy, 10, 0, Math.PI * 2);
        ctx.fillStyle = isDraggingSpin ? '#ff9954' : '#22252a';
        ctx.fill();
        ctx.strokeStyle = isDraggingSpin ? '#ffffff' : '#ff9954';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.fillStyle = isDraggingSpin ? '#121315' : '#ffffff';
        ctx.beginPath();
        ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Slingshot pull-back dotted line while dragging backwards
        if (dragMode === 'slingshot' && dragPoint) {
          ctx.setLineDash([4, 6]);
          line(b.x, b.y, dragPoint.x, dragPoint.y, '#ffffffaa', 2);
          ctx.setLineDash([]);
          circle(dragPoint.x, dragPoint.y, 6, primary, 2);
        }
      }

      if (phase === 'goal' && b === scoringPlayer) {
        circle(b.x, b.y, b.radius + 9, '#ff9954', 4);
        circle(b.x, b.y, b.radius + 15, primary, 2);
      }
      skaters[i].style.left = b.x / 10 + '%'; skaters[i].style.top = b.y / 6 + '%';
      skaters[i].style.width = b.radius / 5 + '%';
      skaters[i].style.transform = `translate(-50%, -50%) rotate(${b.rotation}rad)`;
      ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = i < 3 ? primary : secondary; ctx.fillText(String(i % 3 + 1), b.x, b.y + b.radius + 20);

      // Curved launch arrow (length based on Impulse stat!)
      if (i < 3 && phase === 'plan' && plans[i].power > 0) {
        const trajectory = computeTrajectory(b, plans[i]);
        drawTrajectory(trajectory, primary);
      }
    });
    const ball = bodies[6];
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); ctx.fillStyle = background; ctx.fill(); circle(ball.x, ball.y, ball.radius, text, 2);
    if (ballMark.complete && ballMark.naturalWidth) {
      ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate(ball.rotation);
      const size = ball.radius * 1.7;
      ctx.drawImage(ballMark, -size / 2, -size / 2, size, size); ctx.restore();
    }
  }
  function finishTurn(goal) {
    P.stop(bodies); accumulator = 0;
    if (goal !== null) {
      scores[goal]++; phase = scores[goal] >= 5 ? 'over' : 'goal';
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
    const handleAngle = plans[selected].angle + spin * (Math.PI / 2.2);
    const hx = curB.x + Math.cos(handleAngle) * dialR;
    const hy = curB.y + Math.sin(handleAngle) * dialR;
    const distToHandle = Math.hypot(p.x - hx, p.y - hy);
    const distToCenter = Math.hypot(p.x - curB.x, p.y - curB.y);

    if (distToHandle <= 16 || (distToCenter >= curB.radius + 8 && distToCenter <= curB.radius + 28)) {
      drag = event.pointerId;
      dragMode = 'spin';
      canvas.setPointerCapture(drag);
      updateSpinFromPoint(p, curB);
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
        const handleAngle = plans[selected].angle + spin * (Math.PI / 2.2);
        const hx = curB.x + Math.cos(handleAngle) * dialR;
        const hy = curB.y + Math.sin(handleAngle) * dialR;
        const distToHandle = Math.hypot(p.x - hx, p.y - hy);
        const isOverUbu = bodies.slice(0, 3).some(b => Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 8);
        canvas.style.cursor = (distToHandle <= 16) ? 'grab' : isOverUbu ? 'crosshair' : 'default';
      }
      return;
    }
    const b = bodies[selected];
    if (dragMode === 'slingshot') {
      dragPoint = { x: p.x, y: p.y };
      const pullDx = p.x - b.x, pullDy = p.y - b.y;
      const pullDist = Math.hypot(pullDx, pullDy);
      if (pullDist > 4) {
        plans[selected].angle = Math.atan2(-pullDy, -pullDx);
        plans[selected].power = Math.max(0, Math.min(1, (pullDist - 6) / 120));
      }
    } else if (dragMode === 'spin') {
      updateSpinFromPoint(p, b);
    }
    sync(); draw();
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    drag = null;
    dragMode = null;
    dragPoint = null;
    draw();
  };
  function handleCollision(a, b, speed) {
    if (speed < 15) return;
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
  function handleWall(body, velocity, wallType) {
    if (velocity < 20) return;
    const now = performance.now();
    if (body._lastWallSound && (now - body._lastWallSound) < 60) return;
    body._lastWallSound = now;
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
    if (phase === 'play' && !$('roster-dialog').open && !document.hidden) {
      accumulator += delta;
      while (accumulator >= P.DT && phase === 'play') {
        const goal = P.step(bodies, P.DT, handleCollision, handleWall); elapsed += P.DT; accumulator -= P.DT;
        if (goal !== null || P.settled(bodies) || elapsed >= 12) finishTurn(goal);
      }
      draw();
    }
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
