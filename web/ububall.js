'use strict';
(() => {
  const $ = id => document.getElementById(id), P = ububallPhysics;
  let canvas = $('rink');
  let ctx = canvas.getContext('2d');
  let layoutDirty = true, renderWidth = 1, renderHeight = 1, deviceWidth = 0, deviceHeight = 0;
  const dirtyMeters = new Set();
  let rinkCache = null;
  const ballMark = new Image();
  ballMark.src = 'assets/uburoom-oomark-brand.svg';
  ballMark.onload = () => { if (skaters.length) draw(); };
  const rinkLogo = new Image();
  rinkLogo.src = 'assets/ububall-logo.svg';
  rinkLogo.onload = () => { rinkCache = null; if (skaters.length) draw(); };
  const superImages = P.SUPERS.map(s => {
    const img = new Image();
    img.src = s.icon;
    img.onload = () => { if (skaters.length) draw(); };
    return img;
  });
  const practice = Array.from({ length: 6 }, () => { const dna = ubu.randomDNA(); return { model: ubu.decode(dna), dna: ubu.toCode(dna), label: 'Practice ubu' }; });
  let roster = practice.slice(0, 3), draft = [...roster], rosterSlot = 0;
  const idlePlan = () => ({ angle: 0, power: 0, spin: 0, guard: false });
  let bodies = P.kickoff(), simBodies = P.kickoff(), plans = Array.from({ length: 3 }, idlePlan), cpu = [], selected = 0, scores = [0, 0], turn = 1, phase = 'plan';
  let elapsed = 0, accumulator = 0, lastTime = 0, drag = null, dragMode = null, skaters = [];
  let isPortrait = false;
  let matchMode = 'standard', planDeadline = 0;
  // Each turn of the current play (motion since the field last rested), for goal replays.
  let playSegments = [], goalReplay = null, goalReplayAt = 0, postGoal = null, authoritativeBodies = null;
  let anonymousNames = false;
  // The replay viewer (see watchReplay), and the match being recorded for the replay library.
  let theater = null, recording = null, recordingOnline = false, restoredMatch = false;
  // While a video export renders, effects and sounds run on its clock (ms) instead of the wall clock,
  // sounds go to its offline audio, and the field draws at its size.
  let videoClock = null, videoAudio = null, videoField = null, cardShot = false;
  const clockNow = () => videoClock ?? performance.now();
  let matchTicks = 0; // Simulated ticks played locally, for meter cooldowns.
  let online = null, onlineRoster = '', onlineTurn = 0, onlineReplay = null, onlineDisconnected = false, onlinePhase = '';
  const cpuClient = createCPUClient();
  let cpuGeneration = 0, cpuReady = Promise.resolve(), cpuDone = false, cpuLevel = 'medium', cpuMode = 'standard';
  // The home screen demo (CPU against CPU) plays silently.
  let demo = false, demoLevels = ['medium', 'hard'];
  const gameAudio = () => videoAudio || (demo ? null : window.ubuAudio);
  const classicMode = () => ububallMatch.rule(matchMode, 'classic');
  const blitzMode = () => ububallMatch.rule(matchMode, 'blitz');
  const pulseMode = () => ububallMatch.rule(matchMode, 'pulse');
  function startPlanClock() { planDeadline = performance.now() + (ububallMatch.planningMilliseconds(matchMode) ?? Infinity); }
  function updateClock() {
    if (online?.active) {
      const s = online.state, clock = $('blitz-clock');
      clock.hidden = !blitzMode() || s?.phase !== 'plan';
      const left = clock.hidden ? 0 : Math.max(0, s.deadline === null ? s.remaining : s.deadline - online.now());
      if (!clock.hidden) clock.textContent = Math.ceil(left / 1000) + 's';
      drainClock(clock.hidden, left);
      const other = s ? 1 - s.seat : 1;
      $('online-forfeit').hidden = !s || s.phase === 'over' || !s.connected[s.seat] || s.connected[other] || s.disconnectedAt[other] === null || online.now() - s.disconnectedAt[other] < 60000;
      return;
    }
    const clock = $('blitz-clock'); clock.hidden = !blitzMode() || phase !== 'plan';
    const left = clock.hidden ? 0 : Math.max(0, planDeadline - performance.now());
    if (!clock.hidden) clock.textContent = Math.ceil(left / 1000) + 's';
    drainClock(clock.hidden, left);
  }
  // The scorebug's Blitz strip: the share of planning time left.
  function drainClock(hidden, left) {
    const strip = $('clock-strip'); strip.hidden = hidden;
    if (!hidden) strip.firstChild.style.transform = `scaleX(${Math.min(1, left / ububallMatch.planningMilliseconds('blitz'))})`;
  }
  // The scorebug's rules, in order, each in its colour (a letter on narrow scorebugs).
  let bugMode = 'standard';
  function showMode(mode) {
    bugMode = mode;
    $('mode-tags').replaceChildren(...ububallMatch.RULES.filter(rule => ububallMatch.rule(mode, rule)).map(rule => {
      const tag = document.createElement('span'); tag.className = 'bug-mode'; tag.dataset.rule = rule; tag.title = rule[0].toUpperCase() + rule.slice(1);
      tag.append(Object.assign(document.createElement('span'), { textContent: tag.title }), Object.assign(document.createElement('b'), { textContent: rule[0].toUpperCase() }));
      return tag;
    }));
    fitScorebug();
  }
  // The largest scorebug size whose sides clear the menu and tools (see the scorebug CSS). Then the turn cell holds the widest text this match can show (two-digit turns,
  // its phases, and Blitz seconds), so text changes never move the score.
  const BUG_SIZES = ['full', 'letters', 'short', 'small', 'tiny'];
  function fitScorebug() {
    const board = document.querySelector('.scoreboard'), status = board.querySelector('.bug-status');
    if (!board.offsetWidth) return;
    const compact = getComputedStyle(board.querySelector('.bug-center')).display === 'contents';
    const edge = (node, side) => node.offsetWidth ? node.getBoundingClientRect()[side] : board.getBoundingClientRect()[side === 'right' ? 'left' : 'right'];
    // On phones the logo and rules sit between the menu and tools: rules in full when they fit there.
    for (const size of compact ? ['compact-words', 'compact'] : BUG_SIZES) {
      board.dataset.size = size;
      fitStatus(status);
      const left = board.querySelector('.bug-left').getBoundingClientRect(), right = compact ? left : board.querySelector('.bug-right').getBoundingClientRect();
      if (left.left >= edge($('pause'), 'right') + 8 * gameUi.scale() && right.right <= edge(board.querySelector('.stadium-toolbar'), 'left') - 8 * gameUi.scale()) break;
    }
  }
  function fitStatus(status) {
    const turnNode = $('turn-label'), phaseNode = $('phase'), clock = $('blitz-clock');
    const saved = [turnNode.textContent, phaseNode.textContent, clock.textContent, clock.hidden];
    const blitz = ububallMatch.rule(bugMode, 'blitz');
    status.style.removeProperty('--status-width'); status.style.width = 'max-content';
    let widest = 0;
    for (const phaseText of ['Plan', 'In play', 'Goal', 'Final', online?.active ? 'Waiting' : 'CPU']) {
      turnNode.textContent = '88'; phaseNode.textContent = phaseText; clock.textContent = '5s'; clock.hidden = !blitz;
      widest = Math.max(widest, status.getBoundingClientRect().width);
    }
    [turnNode.textContent, phaseNode.textContent, clock.textContent, clock.hidden] = saved;
    status.style.width = ''; status.style.setProperty('--status-width', Math.ceil(widest) + 'px');
  }
  // Event tabs drop from under the scorebug one at a time: goals, cards, warnings, power plays, match
  // point. A tab about a side (`team`) hangs under that side's score cell, kept inside the scoreboard;
  // `colour` paints it in that side's colour, otherwise it is amber.
  const bugTabs = [];
  let bugTabTimer = 0;
  function bugTab(text, { team = null, colour = false } = {}) {
    bugTabs.push({ text, team, colour });
    if (!bugTabTimer) nextBugTab();
  }
  function nextBugTab() {
    const tab = $('bug-tab'), next = bugTabs.shift();
    if (!next) { tab.classList.remove('show'); bugTabTimer = 0; return; }
    tab.textContent = next.text; tab.dataset.tone = next.colour ? (next.team ? 'away' : 'home') : '';
    const board = tab.parentElement.getBoundingClientRect(), width = tab.offsetWidth;
    const cell = next.team === null ? null : tab.parentElement.querySelector(next.team ? '.bug-away' : '.bug-home').getBoundingClientRect();
    const x = cell ? cell.left - board.left + cell.width / 2 : board.width / 2;
    tab.style.left = Math.max(width / 2, Math.min(board.width - width / 2, x)) + 'px';
    tab.style.top = tab.parentElement.querySelector('.bug-home').getBoundingClientRect().bottom - board.top + 'px';
    tab.classList.add('show');
    bugTabTimer = setTimeout(() => { tab.classList.remove('show'); bugTabTimer = setTimeout(nextBugTab, 300); }, 2600);
  }
  let arrowGrab = null, dragStart = null, dragMoved = false;
  let pullBehind = false;
  // The floating spin slider: on by default with a mouse, off on touch screens.
  let spinSlider = !matchMedia('(pointer: coarse)').matches;
  try { spinSlider = (localStorage.getItem('ububall-spin-slider') ?? (spinSlider ? 'on' : 'off')) === 'on'; } catch {}
  // Pause menu settings: each button shows its name and current value, and pressing it switches the value.
  function showSetting(id, on) {
    $(id).setAttribute('aria-pressed', String(Boolean(on)));
    $(id).querySelector('.setting-value').textContent = on ? 'On' : 'Off';
  }
  $('setting-aim').onclick = () => {
    pullBehind = !pullBehind;
    $('setting-aim').querySelector('.setting-value').textContent = pullBehind ? 'Pull back' : 'Drag arrow';
  };
  const stadium = document.querySelector('.stadium');
  const stageArea = document.querySelector('.stadium-stage-area');
  const spinLayer = document.createElement('div'); spinLayer.className = 'spin-layer';
  stageArea.append(spinLayer); spinLayer.append($('field-spin'));
  // Without team columns (phones and narrow windows), the ubu picker and the selected ubu's knobs sit
  // together in a dock beside or below the rink.
  let scoreboardWidth = 0;
  new ResizeObserver(([entry]) => {
    if (Math.round(entry.contentRect.width) === scoreboardWidth) return;
    scoreboardWidth = Math.round(entry.contentRect.width); fitScorebug();
  }).observe(document.querySelector('.scoreboard'));
  document.fonts?.ready.then(() => fitScorebug());
  const knobDock = document.createElement('div'); knobDock.className = 'knob-dock';
  $('game-status').after(knobDock); knobDock.append($('team-selector'));
  const rinkStage = document.querySelector('.rink-stage');
  const rinkWrap = document.querySelector('.rink-wrap');
  let badgeCanvas = document.createElement('canvas'); badgeCanvas.className = 'field-badges';
  badgeCanvas.setAttribute('aria-hidden', 'true'); rinkWrap.append(badgeCanvas);
  let badgeCtx = badgeCanvas.getContext('2d');
  const btnFullscreen = $('btn-fullscreen'), btnRotate = $('btn-rotate');
  const radians = value => value * Math.PI / 180;
  const normalStats = () => ({
    impulse: 127, traction: 127, spin: 127, curve: 127,
    size: 127, mass: 127, bounciness: 127, grip: 127,
    power: 127, reach: 127, strength: 127, stability: 127,
    efficiency: 127, synergy: 127, chemistry: 127
  });
  let stats = practice.map(p => ({ ...(p.model.stats || normalStats()) }));
  let teamEntries = [...roster, ...practice.slice(3)];
  let play = ububallMatch.newPlay(), tally = ububallMatch.newTally(), scoringPlayer = null, roundTurns = 0;
  // Goal camping and corner stalling warnings and cards, as this view sees them (see ububallMatch.FOULS).
  let fouls = ububallMatch.newFouls();
  // A goal's tab names the call and its scorer (an own goal names no one).
  function goalTab(team, label, scorer) {
    const call = label.replace(/!$/, '').toLowerCase();
    bugTab(scorer ? `${call} · ${scorer}` : call, { team, colour: true });
  }
  // Scores as the scorebug last showed them, to pop a goal and call match point once.
  const shownScores = [0, 0];
  // The status line's wording for each goal call.
  const GOAL_WORDS = { 'OWN GOAL': 'Own goal', 'HAT TRICK!': 'Hat trick', 'FIREBALL!': 'Fireball', 'ONE-TIMER!': 'One-timer', 'BANK SHOT!': 'Bank shot', 'SNIPE!': 'Snipe', 'REBOUND!': 'Rebound', 'ACE!': 'Ace', GOAL: 'Goal' };
  const callText = (label, name) => label === 'OWN GOAL' ? 'Own goal!' : `${GOAL_WORDS[label] || label.replace(/!$/, '')} by ${name}!`;
  let trails = Array.from({ length: 7 }, () => []), particles = [], fireworks = [], shockwaves = [];
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
  // Field details. All are cosmetic and cleared with the other effects; reduced motion disables them.
  let skids = [], skidState = [], burns = [], burnState = {}, ripples = [], pings = [], popups = [], danger = [0, 0];
  let ballFlare = 0, kickoffGlow = 0, goalSweep = null, goalCall = null, hitStopUntil = 0, shake = 0, shakeX = 0, shakeY = 0;
  const SKID_LIFE = 12; // Seconds of play before a skid mark fades out.
  // A sharp loss of speed (hard guard braking or a heavy hit) starts a short skid: an ubu-wide mark
  // whose depth at each point follows how hard the ubu slowed there. Friction and drag slow an ubu by
  // only a few px/s per frame and gentle stops stay under the threshold, so only sharp stops skid.
  const SKID_SLOWDOWN = 220;
  function markIce(b, i, dt) {
    const s = skidState[i] ||= { time: 0 }, prev = s.prev;
    s.prev = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
    if (!prev || dt <= 0) return;
    if (Math.hypot(b.x - prev.x, b.y - prev.y) > 60) { s.time = 0; s.path = null; return; }
    const slowed = Math.hypot(prev.vx, prev.vy) - Math.hypot(b.vx, b.vy);
    if (slowed > SKID_SLOWDOWN) Object.assign(s, { time: .3, strength: Math.max(s.time > 0 ? s.strength : 0, Math.min(1, slowed / 600)) });
    if (s.time <= 0) { s.path = null; return; }
    const depth = s.strength * s.time / .3;
    s.time -= dt;
    if (!s.path) {
      s.path = { points: [{ x: prev.x, y: prev.y, depth }], width: b.radius * 1.7, age: 0 };
      skids.push(s.path); if (skids.length > 30) skids.shift();
    }
    s.path.points.push({ x: b.x, y: b.y, depth }); s.path.age = 0;
  }
  // Ball heat by pace (P.HEAT): a faint orange, then sparks and a muted red, then red hot, so a ball
  // its own team has trapped still shows how hot it is. On fire (as the physics says) it runs fully
  // red and scorches the ice until it goes out.
  const { HEAT } = P;
  const BURN_LIFE = 20; // Seconds of play before a burn mark fades out.
  const paceShare = ball => Math.max(Math.hypot(ball.vx, ball.vy), ball.pace || 0) / P.MAX_SPEED;
  let fireTime = 0, sizzle = null; // How long the ball has been burning.
  // A burning ball that scores sets that goal alight and keeps burning in the net until kickoff.
  let netFire = null;
  const ballOnFire = () => Boolean(netFire?.lit) || P.ballOnFire(bodies?.[6]);
  // A burning ball sizzles softly until it goes out.
  function quench() { sizzle?.stop(); sizzle = null; }
  // 0 is white, 1 orange, 2 red hot and 3 on fire. A Cannonball flare runs it orange.
  function ballHeat(b) {
    if (b.team === -1 && P.ballOnFire?.(b)) return 3;
    if (ballOnFire()) return 3;
    const s = paceShare(b);
    const level = s < HEAT.red ? (s - HEAT.orange) / (HEAT.red - HEAT.orange) : 1 + (s - HEAT.red) / (HEAT.redHot - HEAT.red);
    return Math.max(ballFlare, Math.min(2, Math.max(0, level)));
  }
  function sparkBall(ball, dt) {
    const speed = Math.hypot(ball.vx, ball.vy), share = paceShare(ball);
    fireTime = P.ballOnFire(ball) ? fireTime + dt : 0;
    if (ballOnFire() && !sizzle) sizzle = gameAudio()?.playSizzle?.() || null;
    else if (!ballOnFire()) quench();
    const level = Math.max(ballFlare, (share - HEAT.red) / (HEAT.redHot - HEAT.red));
    const ux = speed ? ball.vx / speed : 0, uy = speed ? ball.vy / speed : -1;
    if (ballOnFire()) flames(ball.x - ux * ball.radius * .5, ball.y - uy * ball.radius * .5, ball.radius * 1.4, -ball.vx * .12, -ball.vy * .12, dt * 120);
    if (level <= 0 || speed < 1) return;
    const count = Math.ceil(dt * 90 * Math.min(1, level));
    for (let k = 0; k < count && particles.length < 360; k++) {
      const x = ball.x - ux * ball.radius, y = ball.y - uy * ball.radius, life = .2 + Math.random() * .2;
      particles.push({ x, y, px: x, py: y, vx: -ball.vx * .25 + (Math.random() - .5) * 160, vy: -ball.vy * .25 + (Math.random() - .5) * 160,
        team: -1, color: Math.random() < .5 ? '#ffb347' : '#fff1c1', life, duration: life });
    }
  }
  // Flickering flames around (x, y) within `spread`, drifting with (vx, vy).
  function flames(x, y, spread, vx, vy, amount) {
    for (let k = Math.ceil(amount); k > 0 && particles.length < 380; k--) {
      const fx = x + (Math.random() - .5) * spread, fy = y + (Math.random() - .5) * spread, life = .18 + Math.random() * .22;
      particles.push({ x: fx, y: fy, px: fx, py: fy, vx: vx + (Math.random() - .5) * 50, vy: vy + (Math.random() - .5) * 50,
        team: -1, color: ['#fff3b0', '#ffc43d', '#ff7a1a', '#ff3b1a'][Math.floor(Math.random() * 4)], life, duration: life, flame: 10 + Math.random() * 12 });
    }
  }
  // The burning net: flames all along it, with the sizzle kept going.
  function burnNet(dt) {
    if (!netFire?.lit || reducedMotion.matches) return;
    const back = netFire.mouth < 500 ? netFire.mouth - P.rink.goalDepth : netFire.mouth + P.rink.goalDepth;
    flames((netFire.mouth + back) / 2, 300, P.rink.goalDepth, 0, 0, dt * 40);
    flames(netFire.mouth, 300, 30, 0, 0, dt * 20);
    for (const y of [P.rink.goalTop, P.rink.goalBottom]) flames((netFire.mouth + back) / 2, y, 30, 0, 0, dt * 15);
    const ball = bodies[6];
    if (ball) flames(ball.x, ball.y, ball.radius * 1.2, 0, 0, dt * 60);
    if (!sizzle) sizzle = gameAudio()?.playSizzle?.() || null;
  }
  function lightNet(team) { netFire = { mouth: team ? P.rink.left : P.rink.right, lit: true }; }
  // A burning ball scorches a dark streak into the ice along its path.
  function burnIce(ball) {
    const last = burnState.path?.points.at(-1);
    if (netFire?.lit) return;
    if (!ballOnFire() || (last && Math.hypot(ball.x - last.x, ball.y - last.y) > 60)) burnState.path = null;
    if (!ballOnFire()) return;
    if (!burnState.path) {
      burnState.path = { points: [], width: ball.radius * 1.3, age: 0 };
      burns.push(burnState.path); if (burns.length > 30) burns.shift();
    }
    const points = burnState.path.points, previous = points.at(-1);
    // A fresh burn starts faint and deepens over its first half second, like a fire taking hold.
    const depth = .2 + .8 * Math.min(1, fireTime / .5);
    if (!previous || Math.hypot(ball.x - previous.x, ball.y - previous.y) >= 3) points.push({ x: ball.x, y: ball.y, depth });
    burnState.path.age = 0;
  }
  function emitSkaterEffects(dt) {
    if (reducedMotion.matches) return;
    bodies.slice(0, 6).forEach((b, i) => markIce(b, i, dt));
    sparkBall(bodies[6], dt);
    burnIce(bodies[6]);
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
    if (!videoField) postGoal = null;
    trails.forEach(trail => { trail.length = 0; });
    particles.length = fireworks.length = shockwaves.length = 0;
    skids.length = skidState.length = burns.length = ripples.length = pings.length = popups.length = 0; burnState.path = null; fireTime = 0; quench();
    if (netFire) netFire.lit = false;
    shake = shakeX = shakeY = 0; if (!videoField && rinkWrap) rinkWrap.style.translate = '';
    danger[0] = danger[1] = ballFlare = kickoffGlow = 0; goalSweep = goalCall = null;
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
        team: i % 5 === 0 ? -1 : team, life, duration: life, celebration, color, overlay: celebration });
    }
  }
  // The scorer's fanfare loops seamlessly until the next kickoff (or a new match).
  let fanfareLoop = null;
  function loopFanfare(voice) {
    stopFanfare();
    if (voice && gameAudio()) fanfareLoop = gameAudio().playFanfare(voice, null, null, { loop: true });
  }
  function stopFanfare() {
    fanfareLoop?.stop(); fanfareLoop = null;
  }
  // Goal celebration: a burst at the ball, the goal light sweep, then a volley of rockets over the
  // scoring half that break into peony and ring shells in the team colour, white and gold.
  // `scorer` is the scoring ubu's body, or null (an own goal names no one).
  function celebrate(team, ball, label = 'GOAL', scorer = null) {
    goalCall = { team, label, scorer: scorer ? bodies.indexOf(scorer) : -1, name: scorer?.name || '', t: 0 };
    if (reducedMotion.matches) return;
    burst(ball.x, ball.y, team, 1, true);
    goalSweep = { team, p: 0 };
    for (let i = 0; i < 9; i++) fireworks.push({ x: team === 0 ? 560 + Math.random() * 340 : 100 + Math.random() * 340, y: 560,
      vy: -(430 + Math.random() * 160), fuse: .55 + Math.random() * .3, delay: .1 + i * .17, team, ring: i % 3 === 2 });
  }
  function explodeShell(f) {
    particles.push({ x: f.x, y: f.y, px: f.x, py: f.y, vx: 0, vy: 0, team: f.team, life: .3, duration: .3, flash: true, overlay: true });
    for (let k = 0; k < 72 && particles.length < 700; k++) {
      const angle = f.ring ? k / 72 * Math.PI * 2 : Math.random() * Math.PI * 2;
      const speed = f.ring ? 210 : 60 + Math.random() * 200, life = 1 + Math.random() * .7;
      particles.push({ x: f.x, y: f.y, px: f.x, py: f.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, team: f.team,
        color: k % 4 === 0 ? '#ffffff' : k % 5 === 0 ? '#ffd76b' : null, life, duration: life,
        celebration: true, overlay: true, crackle: Math.random() < .3 });
    }
  }
  function crackle(p) {
    for (let k = 0; k < 3 && particles.length < 700; k++) {
      const angle = Math.random() * Math.PI * 2, life = .12 + Math.random() * .1;
      particles.push({ x: p.x, y: p.y, px: p.x, py: p.y, vx: Math.cos(angle) * 60, vy: Math.sin(angle) * 60,
        team: -1, color: '#ffffff', life, duration: life, overlay: true });
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
      if (p.life <= 0) {
        particles[i] = particles[particles.length - 1];
        particles.pop();
        if (p.crackle) crackle(p);
        continue;
      }
      p.px = p.x; p.py = p.y;
      const drag = Math.exp(-dt * (p.celebration ? 1.2 : 4));
      p.vx *= drag; p.vy = p.vy * drag + (p.celebration ? 95 : 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = fireworks.length - 1; i >= 0; i--) {
      const f = fireworks[i];
      if ((f.delay -= dt) > 0) continue;
      f.y += f.vy * dt; f.vy += 320 * dt; f.fuse -= dt;
      if (particles.length < 700) particles.push({ x: f.x, y: f.y, px: f.x, py: f.y, vx: (Math.random() - .5) * 30, vy: 30,
        team: f.team, color: '#ffe9b0', life: .3, duration: .3, overlay: true });
      if (f.fuse <= 0) {
        explodeShell(f);
        fireworks[i] = fireworks[fireworks.length - 1];
        fireworks.pop();
      }
    }
    for (let i = shockwaves.length - 1; i >= 0; i--) {
      const s = shockwaves[i]; s.life -= dt;
      if (s.life <= 0) {
        shockwaves[i] = shockwaves[shockwaves.length - 1];
        shockwaves.pop();
      }
    }
    const activeReplay = typeof currentReplay === 'function' ? currentReplay() : theater;
    const moving = phase === 'play' || Boolean(postGoal) || Boolean(goalReplay) || Boolean(activeReplay && !activeReplay.paused);
    if (moving) for (const s of skids) s.age += dt;
    for (let i = skids.length - 1; i >= 0; i--) if (skids[i].age >= SKID_LIFE) skids.splice(i, 1);
    if (moving) for (const s of burns) s.age += dt;
    for (let i = burns.length - 1; i >= 0; i--) if (burns[i].age >= BURN_LIFE) burns.splice(i, 1);
    for (const list of [ripples, pings]) {
      for (let i = list.length - 1; i >= 0; i--) if ((list[i].life -= dt) <= 0) list.splice(i, 1);
    }
    const threat = moving ? goalThreat() : null;
    for (const side of [0, 1]) danger[side] += ((threat?.side === side ? threat.level : 0) - danger[side]) * Math.min(1, dt * 10);
    burnNet(dt);
    shake = Math.max(0, shake - dt / .2);
    shakeX = shake ? Number(((Math.random() - .5) * 5 * gameUi.scale() * shake).toFixed(2)) : 0;
    shakeY = shake ? Number(((Math.random() - .5) * 5 * gameUi.scale() * shake).toFixed(2)) : 0;
    if (!videoField && rinkWrap) rinkWrap.style.translate = shake ? `${shakeX}px ${shakeY}px` : '';
    ballFlare = Math.max(0, ballFlare - dt / .8);
    kickoffGlow = Math.max(0, kickoffGlow - dt / 1.5);
    if (goalSweep && (goalSweep.p += dt / 1.5) >= 1) goalSweep = null;
    if (goalCall && (goalCall.t += dt) >= GOAL_CALL_SECONDS) goalCall = null;
  }
  // Which goal the ball really threatens, and how strongly: its own path (curve and slowing
  // included, off nothing but posts and net) carries it in within ~0.9 seconds, faster and sooner
  // glowing brighter. Side 0 is the left goal (defended by the home team in every view), side 1 the right.
  function goalThreat() {
    const ball = bodies[6];
    if (!ball || P.holder(bodies)) return null;
    const speed = Math.hypot(ball.vx, ball.vy), horizon = .9;
    if (speed < 120) return null;
    // Spin may curve the shot, but vertical motion alone cannot reach a goal.
    // |delta vx| <= speed * angular travel before a collision or drag slows the ball.
    const turn = Math.abs(ball.omega || 0) * Math.abs(ball.curveFactor ?? 1) * horizon;
    const horizontalReach = horizon * (Math.abs(ball.vx) + speed * Math.min(1, turn));
    if (ball.x - horizontalReach > 60 && ball.x + horizontalReach < 940) return null;
    const sim = [{ ...ball }], limit = Math.round(horizon / P.DT);
    let boards = false;
    const onWall = (b, v, type) => { if (type === 'wall') boards = true; };
    for (let t = 1; t <= limit && !boards; t++) {
      const goal = P.step(sim, P.DT, null, onWall);
      if (goal !== null) return { side: goal === 1 ? 0 : 1, level: Math.min(1, speed / 500) * (1 - t / limit) };
    }
    return null;
  }
  // Net ripples and board flex bulge outward from a hard contact; posts flash.
  function addWallEffect(body, velocity, wallType, nx, ny) {
    if (reducedMotion.matches) return;
    const x = body.x + nx * body.radius, y = body.y + ny * body.radius;
    if (wallType === 'post') {
      const px = x < 500 ? 60 : 940, py = y < 300 ? 230 : 370;
      if (pings.length < 12) pings.push({ x: px, y: py, life: .4, duration: .4 });
    } else if ((wallType === 'net' || velocity > 220) && ripples.length < 24) {
      // Find the hit on the drawn wall, then bulge only that stretch, never past its ends.
      const net = wallType === 'net', half = (net ? 26 : 60) / WALL_STEP;
      let best = null;
      for (const run of net ? NET_RUNS : BOARD_RUNS) run.forEach((p, k) => {
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (!best || d < best.d) best = { d, run, k };
      });
      ripples.push({ run: best.run, lo: Math.max(0, best.k - half), hi: Math.min(best.run.length - 1, best.k + half),
        net, side: x < 500 ? 0 : 1, amp: Math.min(1, velocity / 500), life: .6, duration: .6 });
    }
  }
  // The drawn walls as runs of points with outward normals, every WALL_STEP px. Boards break at the
  // goal mouths; each net side and back is its own run, so a bulge cannot wrap a sharp corner.
  const WALL_STEP = 2;
  function wallRun(pieces) {
    const run = [];
    for (const piece of pieces) {
      const n = Math.max(1, Math.round(piece.length / WALL_STEP));
      for (let k = 0; k < n; k++) run.push(piece.at(k / n));
    }
    run.push(pieces[pieces.length - 1].at(1));
    return run;
  }
  const straight = (x1, y1, x2, y2, nx, ny) => ({ length: Math.hypot(x2 - x1, y2 - y1), at: t => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t, nx, ny }) });
  const corner = (cx, cy, a1, a2) => ({ length: Math.abs(a2 - a1) * P.rink.corner,
    at: t => { const a = a1 + (a2 - a1) * t; return { x: cx + Math.cos(a) * P.rink.corner, y: cy + Math.sin(a) * P.rink.corner, nx: Math.cos(a), ny: Math.sin(a) }; } });
  const BOARD_RUNS = [
    wallRun([straight(60, 230, 60, 160, -1, 0), corner(160, 160, Math.PI, 1.5 * Math.PI), straight(160, 60, 840, 60, 0, -1),
      corner(840, 160, -.5 * Math.PI, 0), straight(940, 160, 940, 230, 1, 0)]),
    wallRun([straight(940, 370, 940, 440, 1, 0), corner(840, 440, 0, .5 * Math.PI), straight(840, 540, 160, 540, 0, 1),
      corner(160, 440, .5 * Math.PI, Math.PI), straight(60, 440, 60, 370, -1, 0)])
  ];
  const NET_RUNS = [60, 940].flatMap(mouth => {
    const out = mouth < 500 ? -1 : 1, back = mouth + out * P.rink.goalDepth;
    return [wallRun([straight(mouth, 230, back, 230, 0, -1)]), wallRun([straight(back, 230, back, 370, out, 0)]),
      wallRun([straight(back, 370, mouth, 370, 0, 1)])];
  });
  // Fills a band along points whose width can change at every point.
  function ribbon(points, widthAt) {
    const left = [], right = [];
    points.forEach((p, k) => {
      const a = points[Math.max(0, k - 1)], b = points[Math.min(points.length - 1, k + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len, half = widthAt(p) / 2;
      left.push([p.x + nx * half, p.y + ny * half]); right.push([p.x - nx * half, p.y - ny * half]);
    });
    ctx.beginPath(); ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath(); ctx.fill();
  }
  // A ribbon with a Gaussian edge. Canvas shadows blur in every browser, so the shape is drawn far
  // off-canvas and only its blurred shadow lands back on the ice.
  function softRibbon(points, widthAt, blur, color) {
    const scale = ctx.getTransform().a, offset = 4000;
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = blur * scale; ctx.shadowOffsetX = offset;
    ctx.translate(-offset / scale, 0);
    ribbon(points, widthAt);
    ctx.restore();
  }
  // Muted tints up to red hot (heat 2); only a burning ball (heat 3) runs fully red.
  const HEAT_COLORS = [[255, 255, 255], [255, 214, 170], [255, 158, 120], [255, 70, 30]];
  function heatColor(h, alpha = 1) {
    const k = Math.min(2, Math.floor(h)), t = Math.min(1, h - k), [a, b] = [HEAT_COLORS[k], HEAT_COLORS[k + 1]];
    const [r, g, bl] = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgba(${r}, ${g}, ${bl}, ${alpha})`;
  }
  function inRink(paint) { ctx.save(); rounded(60, 60, 880, 480, 100); ctx.clip(); paint(); ctx.restore(); }
  // A layer over the rink canvas, repainted only when `key` changes and otherwise drawn as one image.
  // For content that stays still across many frames, such as the plan-phase prediction. `scale`
  // paints soft, heavily blurred content at a fraction of the canvas resolution.
  function cachedLayer(cache, key, paint, scale = 1) {
    if (cache.key !== key) {
      const width = Math.max(1, Math.round(canvas.width * scale)), height = Math.max(1, Math.round(canvas.height * scale)), main = ctx;
      cache.layer ||= document.createElement('canvas');
      if (cache.layer.width !== width || cache.layer.height !== height) { cache.layer.width = width; cache.layer.height = height; }
      ctx = cache.layer.getContext('2d');
      ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); ctx.clearRect(0, 0, 1000, 600);
      ctx.save();
      try { paint(); } finally { ctx.restore(); ctx = main; }
      cache.key = key;
    }
    ctx.drawImage(cache.layer, 0, 0, 1000, 600);
  }
  let iceCache = {};
  // Drawn on the ice beneath bodies and trails.
  function drawFieldUnder(colors) {
    const { primary, home, away } = colors;
    if (kickoffGlow) {
      ctx.save(); ctx.globalAlpha = kickoffGlow; ctx.shadowColor = primary; ctx.shadowBlur = 12 * canvas.width / 1000;
      circle(500, 300, 70 + (1 - kickoffGlow) * 10, primary, 3); ctx.restore();
    }
    // Skid and burn marks only change while play runs, so planning reuses one painted layer. Their
    // edges are blurred far wider than a field unit, so the layer is painted at one pixel per field
    // unit at most (half resolution on a 2× screen): the blur costs a quarter, with no visible change.
    if (skids.length || burns.length) {
      let key = canvas.width + ',' + canvas.height;
      for (const s of skids) key += ',' + Math.floor(s.age * 4) + ':' + s.points.length;
      key += '|';
      for (const s of burns) key += ',' + Math.floor(s.age * 4) + ':' + s.points.length;
      cachedLayer(iceCache, key, paintIce, Math.min(1, 1000 / canvas.width));
    }
    if (phase === 'plan' && pulseMode() && !P.settled(bodies)) inRink(() => { ctx.fillStyle = 'rgba(120,170,255,.07)'; ctx.fillRect(60, 60, 880, 480); });
    danger.forEach((glow, side) => {
      if (glow < .02) return;
      const x = side ? 940 : 60, color = side ? away : home;
      ctx.save(); ctx.globalAlpha = Math.min(1, glow) * .4; ctx.shadowColor = color; ctx.shadowBlur = 8 * glow * canvas.width / 1000;
      line(x, 230, x, 370, color, 5); ctx.restore();
    });
  }
  function paintIce() {
    for (const s of skids) {
      // A blurred body and a tighter blurred core darken the ice: soft edges, deepest where braking
      // was hardest. Fading also thins the mark, so its 8-bit opacity steps never show as one jump.
      const age = Math.floor(s.age * 4) / 4;
      const t = age / SKID_LIFE, fade = 1 - t * t * (3 - 2 * t), thin = .6 + .4 * fade;
      ctx.globalAlpha = .12 * fade;
      softRibbon(s.points, p => s.width * .7 * (.4 + .6 * p.depth) * thin, s.width * .45, '#000000');
      ctx.globalAlpha = .08 * fade;
      softRibbon(s.points, p => s.width * .3 * p.depth * thin, s.width * .2, '#000000');
    }
    for (const s of burns) {
      if (s.points.length < 2) continue;
      const age = Math.floor(s.age * 4) / 4;
      const t = age / BURN_LIFE, fade = 1 - t * t * (3 - 2 * t);
      ctx.globalAlpha = .3 * fade;
      softRibbon(s.points, p => s.width * (.5 + .5 * p.depth), s.width * .35, '#2b1206');
      ctx.globalAlpha = .22 * fade;
      softRibbon(s.points, p => s.width * .35 * p.depth, s.width * .15, '#000000');
    }
  }
  // Drawn above bodies: ripples, post flashes, the goal light sweep and the Pulse turn timer.
  function drawFieldOver(colors) {
    const { border, text, home, away } = colors;
    for (const r of ripples) {
      // Drawing only: the physics walls never move. The bulge follows the wall's own shape, easing
      // to zero at both ends of its stretch so it stays on the wall around corners and nets.
      const p = 1 - r.life / r.duration, bulge = r.amp * (r.net ? 9 : 8) * (1 - p) * Math.cos(p * Math.PI * 5);
      ctx.save(); ctx.globalAlpha = (1 - p) * .9; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let k = r.lo; k <= r.hi; k++) {
        const w = r.run[k], d = bulge * Math.sin(Math.PI * (k - r.lo) / Math.max(1, r.hi - r.lo)) ** 2;
        ctx.lineTo(w.x + w.nx * d, w.y + w.ny * d);
      }
      ctx.strokeStyle = r.net ? (r.side ? away : home) : border; ctx.lineWidth = 4; ctx.stroke(); ctx.restore();
    }
    for (const g of pings) {
      const p = 1 - g.life / g.duration;
      ctx.save(); ctx.globalAlpha = 1 - p; circle(g.x, g.y, 4 + p * 16, text, 2);
      ctx.fillStyle = text; ctx.beginPath(); ctx.arc(g.x, g.y, 3 * (1 - p) + 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (goalSweep) drawGoalSweep(goalSweep, goalSweep.team ? away : home);
    if (goalCall) drawGoalCall(goalCall, goalCall.team ? away : home);
    if (pulseMode() && !goalReplay && !cardShot) {
      const turnSeconds = ububallMatch.turnTicks(matchMode) * P.DT;
      const activeReplay = typeof currentReplay === 'function' ? currentReplay() : theater;
      const progress = activeReplay ? activeReplay.tick * P.DT / turnSeconds : phase !== 'play' ? 0 : online?.active ? (onlineReplay?.currentTick ?? 0) * P.DT / turnSeconds : elapsed / turnSeconds;
      ctx.save(); ctx.lineCap = 'round';
      ctx.globalAlpha = .25; line(160, 556, 840, 556, border, 4);
      if (progress > 0) { ctx.globalAlpha = .9; line(160, 556, 160 + 680 * Math.min(1, progress), 556, '#DA4DB5', 4); }
      ctx.restore();
    }
  }
  // Goal light: a team-colour wash and a wide glowing band with a white core sweeping out from the
  // scored goal, the goal frame flaring, and "GOAL" (or "ACE!" on a round's first turn) popping in above the ubus.
  function drawGoalSweep(sweep, color) {
    const p = sweep.p, x = sweep.team ? 60 + p * 880 : 940 - p * 880;
    inRink(() => {
      ctx.fillStyle = hexToRgba(color, .12 * Math.sin(Math.PI * p)); ctx.fillRect(60, 60, 880, 480);
      const band = ctx.createLinearGradient(x - 220, 0, x + 220, 0);
      band.addColorStop(0, hexToRgba(color, 0)); band.addColorStop(.4, hexToRgba(color, .32));
      band.addColorStop(.5, 'rgba(255,255,255,.5)'); band.addColorStop(.6, hexToRgba(color, .32)); band.addColorStop(1, hexToRgba(color, 0));
      ctx.globalAlpha = 1 - p * .6; ctx.fillStyle = band; ctx.fillRect(60, 60, 880, 480);
    });
    const mouth = sweep.team ? 60 : 940, back = sweep.team ? mouth - P.rink.goalDepth : mouth + P.rink.goalDepth;
    ctx.save(); ctx.globalAlpha = 1 - p; ctx.shadowColor = color; ctx.shadowBlur = 24 * canvas.width / 1000;
    line(mouth, 230, back, 230, color, 6); line(back, 230, back, 370, color, 6); line(mouth, 370, back, 370, color, 6);
    line(mouth, 230, mouth, 370, '#ffffff', 3);
    ctx.restore();
  }
  // The goal call over the rink: the scorer's face in a ring of the team's colour, the call ("GOAL",
  // "BANK SHOT!"...) and the scorer's name. It pops in (still, with reduced motion) and fades at the end.
  const GOAL_CALL_SECONDS = 2.4;
  function drawGoalCall(call, color) {
    const pop = reducedMotion.matches ? 1 : Math.min(1, call.t / .27), scale = 1 + 2.70158 * (pop - 1) ** 3 + 1.70158 * (pop - 1) ** 2;
    const face = skaters[call.scorer]?.querySelector('canvas'), top = face ? 40 : 0;
    const write = (text, y, size) => {
      badgeCtx.font = `900 ${size}px system-ui, sans-serif`; badgeCtx.lineWidth = size / 14; badgeCtx.strokeStyle = color;
      badgeCtx.strokeText(text, 0, y); badgeCtx.fillStyle = '#ffffff'; badgeCtx.fillText(text, 0, y);
    };
    badgeCtx.save(); badgeCtx.translate(500, 300); if (isPortrait) badgeCtx.rotate(Math.PI / 2); badgeCtx.scale(scale, scale);
    badgeCtx.globalAlpha = Math.max(0, Math.min(1, (GOAL_CALL_SECONDS - call.t) / .5));
    badgeCtx.shadowColor = color; badgeCtx.shadowBlur = 30 * canvas.width / 1000;
    if (face) {
      badgeCtx.beginPath(); badgeCtx.arc(0, -82, 74, 0, Math.PI * 2); badgeCtx.fillStyle = color; badgeCtx.fill();
      badgeCtx.shadowBlur = 0; badgeCtx.drawImage(face, -66, -148, 132, 132);
      badgeCtx.shadowBlur = 30 * canvas.width / 1000;
    }
    badgeCtx.textAlign = 'center'; badgeCtx.textBaseline = 'middle';
    const callLabel = anonymousNames && call.scorer < 0 && call.label.endsWith(' WINS!')
      ? `${ububallReplay.ANONYMOUS[call.team].toUpperCase()} WINS!`
      : call.label;
    const callName = anonymousNames && call.scorer >= 0 ? anonymousName(call.scorer) : call.name;
    write(callLabel, top, 88);
    if (callName) write(callName, top + 66, 34);
    badgeCtx.restore();
  }
  // Short callouts ("Save!") that pop in over an ubu and drift up as they fade.
  function popup(body, text) {
    if (!reducedMotion.matches && popups.length < 8) popups.push({ x: body.x, y: body.y - body.radius - 20, text, team: body.team, life: 1.2, duration: 1.2 });
  }
  function updatePopups(dt) {
    if (reducedMotion.matches) { popups.length = 0; return; }
    for (let i = popups.length - 1; i >= 0; i--) if ((popups[i].life -= dt) <= 0) popups.splice(i, 1);
  }
  function drawPopups(home, away) {
    for (const p of popups) {
      const age = 1 - p.life / p.duration, t = Math.min(1, age / .2), scale = 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
      const color = p.team ? away : home;
      badgeCtx.save(); badgeCtx.translate(p.x, p.y - age * 22); if (isPortrait) badgeCtx.rotate(Math.PI / 2); badgeCtx.scale(scale, scale);
      badgeCtx.globalAlpha = age < .7 ? 1 : (1 - age) / .3;
      badgeCtx.font = '900 26px system-ui, sans-serif'; badgeCtx.textAlign = 'center'; badgeCtx.textBaseline = 'middle';
      badgeCtx.shadowColor = color; badgeCtx.shadowBlur = 12 * canvas.width / 1000;
      badgeCtx.lineWidth = 4; badgeCtx.strokeStyle = color; badgeCtx.strokeText(p.text, 0, 0);
      badgeCtx.fillStyle = '#ffffff'; badgeCtx.fillText(p.text, 0, 0);
      badgeCtx.restore();
    }
  }
  function isCreasing(b, team) {
    const i = bodies.indexOf(b);
    const plan = phase === 'plan' && i >= 0 ? plans[i] : null;
    const stalwartArmed = Boolean(plan?.superArm || b.superArm) && (b.meter ?? 0) >= 100 && (b.equippedSuper?.key === 'stalwart' || b.superKey === 'stalwart');
    if (b.superActive === 'stalwart' || stalwartArmed) return false;
    return ububallMatch.inCrease(P, b, team);
  }
  // The ubus a standing warning would card: a warned team's ubus in its crease, and the larger
  // team's ubus in a stalled corner.
  function offenders() {
    const list = bodies.slice(0, 6).filter(b => fouls.crease[b.team] && isCreasing(b, b.team));
    if (stalling()) {
      const [home, away] = cornerTeams();
      if (home.length !== away.length) list.push(...(home.length > away.length ? home : away).filter(b => !list.includes(b)));
    }
    return list;
  }
  const stalling = () => fouls.corner !== null && fouls.cornerTurns >= ububallMatch.FOULS.stallTurns;
  // Each team's ubus overlapping the stalled corner.
  function cornerTeams() {
    const inside = bodies.slice(0, 6).filter(b => ububallMatch.cornerOf(P, b.x, b.y, b.radius) === fouls.corner);
    return [0, 1].map(team => inside.filter(b => b.team === team));
  }
  const foulsShowing = () => fouls.crease[0] || fouls.crease[1] || stalling() || bodies.some(b => b.carded);
  // Lucide alert-triangle, on its 24-unit grid.
  const ALERT = new Path2D('M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z M12 9v4 M12 17h.01');
  function drawAlert(x, y, size, alpha = 1) {
    badgeCtx.save(); badgeCtx.translate(x, y); if (isPortrait) badgeCtx.rotate(Math.PI / 2);
    badgeCtx.globalAlpha = alpha; badgeCtx.scale(size / 24, size / 24); badgeCtx.translate(-12, -12);
    badgeCtx.fillStyle = '#0b0d10d9'; badgeCtx.fill(ALERT);
    badgeCtx.lineWidth = 2; badgeCtx.lineCap = badgeCtx.lineJoin = 'round'; badgeCtx.strokeStyle = '#ffb020'; badgeCtx.stroke(ALERT);
    badgeCtx.restore();
  }
  // A warning sits just outside the boards by the goal or corner it is about, its name beneath.
  function drawFieldWarning(x, y, words, color, cleared = false) {
    if (cleared) drawCheck(isPortrait ? x + 13 : x, isPortrait ? y : y - 13, 24);
    else drawAlert(isPortrait ? x + 13 : x, isPortrait ? y : y - 13, 24);
    badgeCtx.save(); badgeCtx.translate(x, y); if (isPortrait) badgeCtx.rotate(Math.PI / 2);
    badgeCtx.font = '700 11px system-ui, sans-serif'; badgeCtx.textAlign = 'center'; badgeCtx.textBaseline = 'middle'; badgeCtx.fillStyle = color;
    words.forEach((word, i) => badgeCtx.fillText(word, 0, 7 + i * 12));
    badgeCtx.restore();
  }
  // A yellow card, tilted, on the ubu's top right.
  function drawCard(b) {
    const r = b.radius * .7;
    badgeCtx.save(); badgeCtx.translate(b.x + r, isPortrait ? b.y + r : b.y - r); badgeCtx.rotate((isPortrait ? Math.PI / 2 : 0) + .2);
    badgeCtx.beginPath(); badgeCtx.roundRect(-6, -8, 12, 16, 2); badgeCtx.fillStyle = '#ffd60a'; badgeCtx.fill();
    badgeCtx.lineWidth = 1.5; badgeCtx.strokeStyle = '#0b0d10'; badgeCtx.stroke();
    badgeCtx.restore();
  }
  // Lucide check, on its 24-unit grid, on a dark disc: a warning the planned turn is predicted to clear.
  const CHECK = new Path2D('M20 6 9 17l-5-5');
  function drawCheck(x, y, size) {
    badgeCtx.save(); badgeCtx.translate(x, y); if (isPortrait) badgeCtx.rotate(Math.PI / 2);
    badgeCtx.scale(size / 24, size / 24);
    badgeCtx.beginPath(); badgeCtx.arc(0, 0, 12, 0, Math.PI * 2); badgeCtx.fillStyle = '#0b0d10d9'; badgeCtx.fill();
    badgeCtx.translate(-12, -12); badgeCtx.scale(.8, .8); badgeCtx.translate(3, 3);
    badgeCtx.lineWidth = 3; badgeCtx.lineCap = badgeCtx.lineJoin = 'round'; badgeCtx.strokeStyle = '#3ddc84'; badgeCtx.stroke(CHECK);
    badgeCtx.restore();
  }
  // What the planned turn is predicted to do to the standing warnings (opponents held, as the
  // prediction plays them): which lapse along the way, and which crease offenders' centres leave.
  function predictFouls(prediction) {
    const result = { crease: [false, false], corner: false, left: new Set() };
    if (!fouls.crease[0] && !fouls.crease[1] && !stalling()) return result;
    const copy = structuredClone(fouls), samples = Math.max(...prediction.paths.map(path => path.length));
    const meta = bodies.map((b, i) => {
      const plan = plans[i];
      const stalwartArmed = Boolean(plan?.superArm || b.superArm) && (b.meter ?? 0) >= 100 && (b.equippedSuper?.key === 'stalwart' || b.superKey === 'stalwart');
      return {
        team: b.team,
        radius: b.radius,
        superActive: b.superActive === 'stalwart' || stalwartArmed ? 'stalwart' : b.superActive,
        wasCreasing: i < 6 && fouls.crease[b.team] && isCreasing(b, b.team)
      };
    });
    for (let k = 1; k < samples; k++) {
      const field = meta.map((m, i) => {
        const path = prediction.paths[i], at = path[Math.min(k, path.length - 1)];
        return { team: m.team, radius: m.radius, x: at.x, y: at.y, superActive: m.superActive };
      });
      ububallMatch.lapseFouls(P, field, copy);
      for (let i = 0; i < 6; i++) {
        if (meta[i].wasCreasing && !isCreasing(field[i], meta[i].team)) result.left.add(i);
      }
    }
    result.crease = [0, 1].map(team => fouls.crease[team] && !copy.crease[team]);
    result.corner = stalling() && copy.corner === null;
    return result;
  }
  function drawFouls(text) {
    // While planning, a warning the plan is predicted to clear (and each offender predicted to get
    // out) shows a green check in place of its alert.
    const predicted = phase === 'plan' ? predictionCache?.fouls : null;
    for (const team of [0, 1]) if (fouls.crease[team]) drawFieldWarning(team ? 970 : 30, 180, ['Goal', 'Camping'], text, predicted?.crease[team]);
    if (stalling()) drawFieldWarning(fouls.corner % 2 ? 970 : 30, fouls.corner > 1 ? 570 : 30, ['Corner', 'Stalling'], text, predicted?.corner);
    const flash = reducedMotion.matches ? 1 : .35 + .65 * (.5 + .5 * Math.cos(clockNow() / 1000 * Math.PI * 2.4));
    const creasing = new Set(bodies.slice(0, 6).filter(b => fouls.crease[b.team] && isCreasing(b, b.team)));
    for (const b of offenders()) {
      if (b.carded) continue;
      const x = b.x + b.radius * .8, y = isPortrait ? b.y + b.radius * .8 : b.y - b.radius * .8;
      if (predicted && (creasing.has(b) ? predicted.left.has(bodies.indexOf(b)) : predicted.corner)) drawCheck(x, y, 24);
      else drawAlert(x, y, 26, flash);
    }
    for (const b of bodies.slice(0, 6)) if (b.carded) drawCard(b);
  }
  // Calls out the cards and the corner reset just given.
  function announceFouls() {
    for (const i of fouls.cards) popup(bodies[i], 'Yellow card');
    for (const team of [0, 1]) {
      const carded = fouls.cards.filter(i => bodies[i].team === team);
      if (carded.length === 1) bugTab(`Yellow card · ${bodies[carded[0]].name || sideName(team)}`, { team });
      else if (carded.length) bugTab(`${carded.length} yellow cards · ${sideName(team)}`, { team });
    }
    for (const team of [0, 1]) if (fouls.crease[team]) bugTab(`Goal camping · ${sideName(team)}`, { team });
    if (fouls.cornerTurns === ububallMatch.FOULS.stallTurns) bugTab('Corner stalling');
    if (fouls.faceoff) bugTab('Corner reset');
    // The side with more ubus on the ice for the coming turn is on the power play.
    const out = [0, 1].map(team => bodies.slice(0, 6).filter(b => b.team === team && b.carded).length);
    if (out[0] !== out[1]) { const team = out[0] < out[1] ? 0 : 1; bugTab(`Power play · ${sideName(team)}`, { team, colour: true }); }
    // A card whistles; a warning only just given sounds its alert.
    if (fouls.cards.length) gameAudio()?.playFoul('card');
    else if (fouls.crease[0] || fouls.crease[1] || fouls.cornerTurns === ububallMatch.FOULS.stallTurns) gameAudio()?.playFoul('warning');
  }
  function foulText() {
    const notes = [];
    if (fouls.faceoff) notes.push('Corner stalling: the ball is reset to centre ice.');
    for (const team of [0, 1]) {
      const carded = fouls.cards.filter(i => bodies[i].team === team).length;
      if (carded) notes.push(`Yellow card: ${sideHas(team)} ${ubuCount(carded)} out for a turn.`);
    }
    for (const team of [0, 1]) if (fouls.crease[team]) notes.push(`Goal camping: ${sideName(team)} must thin out the crease this turn.`);
    if (stalling()) notes.push('Corner stalling: clear the ball from the corner this turn.');
    return notes.join(' ');
  }
  // Tapping a warning beside the boards explains that foul (`foulInfo`, null when closed): who is
  // offending, what must happen to clear it and what happens if it is not, with its areas lit on the
  // rink. The box sits in the unrotated stage, on the side away from the foul, and closes once the
  // warning lapses.
  let foulInfo = null, foulInfoKey = '';
  const foulBox = document.createElement('section'); foulBox.className = 'foul-info'; foulBox.hidden = true;
  foulBox.setAttribute('role', 'dialog'); foulBox.setAttribute('aria-labelledby', 'foul-info-title');
  foulBox.innerHTML = '<h3 id="foul-info-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z M12 9v4 M12 17h.01"/></svg><span></span></h3>' +
    '<div></div><button type="button">Got it</button>';
  stageArea.append(foulBox);
  foulBox.querySelector('button').onclick = () => closeFoulInfo();
  // The warning drawn beside the boards at a field point, if any (see drawFouls).
  function warningAt(p) {
    const near = (x, y) => Math.abs(p.x - x) < 32 && Math.abs(p.y - y) < 34;
    for (const team of [0, 1]) if (fouls.crease[team] && near(team ? 970 : 30, 180)) return { kind: 'crease', team };
    if (stalling() && near(fouls.corner % 2 ? 970 : 30, fouls.corner > 1 ? 570 : 30)) return { kind: 'corner' };
    return null;
  }
  function openFoulInfo(info) { foulInfo = info; foulInfoKey = ''; foulBox.hidden = false; draw(); }
  function closeFoulInfo() { if (!foulInfo) return; foulInfo = null; foulBox.hidden = true; draw(); }
  const ubuCount = n => `${n} ubu${n === 1 ? '' : 's'}`;
  // Each side by its scoreboard name (You, CPU, an opponent's or a demo team's), so every view reads
  // right; "You" takes the plural verb.
  const sideName = team => $(team ? 'opponent-label' : 'home-label').textContent;
  const sideHas = team => sideName(team) + (sideName(team) === 'You' ? ' have' : ' has');
  const CARD_TEXT = 'no meter, back to spawn, out for a turn';
  // The explanation as paragraphs; `act` marks what must happen to clear the warning.
  function foulInfoLines() {
    const ubus = bodies.slice(0, 6);
    if (foulInfo.kind === 'corner') {
      const [home, away] = cornerTeams().map(list => list.length);
      return ['Corner stalling', [
        { text: `The ball has been in this corner for ${fouls.cornerTurns} turns.` },
        { text: 'Clear it out this turn.', act: true },
        { text: `Otherwise it resets to centre ice and the side with more ubus here is yellow-carded: ${CARD_TEXT}.` },
        { text: home !== away ? `${sideName(home > away ? 0 : 1)} would be carded (${Math.max(home, away)} to ${Math.min(home, away)}).`
          : home ? `Even at ${home} each, so nobody would be carded.` : 'Nobody is here, so nobody would be carded.' }]];
    }
    const t = foulInfo.team, crease = ubus.filter(b => b.team === t && isCreasing(b, t)).length;
    const allowed = Math.max(1, ubus.filter(b => b.team === 1 - t && ububallMatch.inAttackZone(P, b, t)).length);
    return ['Goal camping', [
      { text: `${sideHas(t)} ${ubuCount(crease)} in the crease. Only ${allowed} ${allowed === 1 ? 'is' : 'are'} allowed: one per opponent in the attack zone, at least one.` },
      { text: `${sideName(t)} must move ${Math.max(1, crease - allowed)} out this turn.`, act: true },
      { text: `Otherwise every ubu left in the crease is yellow-carded: ${CARD_TEXT}.` }
    ]];
  }
  // Keeps the open box current with the field, or closes it once its warning has lapsed.
  function updateFoulInfo() {
    if (!foulInfo) return;
    if (foulInfo.kind === 'crease' ? !fouls.crease[foulInfo.team] : !stalling()) { foulInfo = null; foulBox.hidden = true; return; }
    const [title, lines] = foulInfoLines(), key = title + JSON.stringify(lines);
    if (key !== foulInfoKey) {
      foulInfoKey = key;
      foulBox.querySelector('span').textContent = title;
      foulBox.querySelector('div').replaceChildren(...lines.map(line => {
        const p = document.createElement('p'); p.textContent = line.text; if (line.act) p.className = 'act'; return p;
      }));
    }
    // Over the field's far half from the foul, so the lit areas stay in view.
    const f = fieldBox, far = foulInfo.kind === 'crease' ? foulInfo.team === 0 : fouls.corner % 2 === 0;
    const along = isPortrait ? (far ? .27 : .73) : (far ? .7 : .3);
    foulBox.style.width = Math.min(340 * gameUi.scale(), isPortrait ? f.width - 24 * gameUi.scale() : f.width * .46) + 'px';
    foulBox.style.maxHeight = (isPortrait ? f.height * .5 : f.height) - 12 * gameUi.scale() + 'px';
    foulBox.style.left = f.left + f.width * (isPortrait ? .5 : along) + 'px';
    foulBox.style.top = f.top + f.height * (isPortrait ? along : .5) + 'px';
  }
  // The open foul's areas, lit under the ubus: the crease and attack zone, or the corner, with the
  // ubus that count ringed (the side that would be carded in amber).
  function drawFoulFocus(text) {
    if (!foulInfo) return;
    const amber = '#ffb020', ring = (list, dashed) => list.forEach(b => {
      ctx.save(); if (dashed) ctx.setLineDash([4, 5]); circle(b.x, b.y, Math.max(b.radius, b.reach || b.radius) + 7, dashed ? text : amber, 2.5); ctx.restore();
    });
    const label = (words, x, y) => {
      ctx.save(); ctx.translate(x, y); if (isPortrait) ctx.rotate(Math.PI / 2);
      ctx.font = '800 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = '#101217'; ctx.strokeText(words, 0, 0); ctx.fillStyle = amber; ctx.fillText(words, 0, 0); ctx.restore();
    };
    const ubus = bodies.slice(0, 6);
    ctx.save();
    if (foulInfo.kind === 'crease') {
      const t = foulInfo.team, mouth = t ? 940 : 60, zone = ububallMatch.attackZoneLine(P, t), from = t ? Math.PI / 2 : -Math.PI / 2;
      inRink(() => { ctx.globalAlpha = .1; ctx.fillStyle = amber; ctx.fillRect(Math.min(mouth, zone), 60, Math.abs(zone - mouth), 480); });
      ctx.globalAlpha = .8; line(zone, 60, zone, 540, amber, 2);
      ctx.beginPath(); ctx.moveTo(mouth, 300); ctx.arc(mouth, 300, ububallMatch.FOULS.crease, from, from + Math.PI); ctx.closePath();
      ctx.globalAlpha = .22; ctx.fillStyle = amber; ctx.fill(); ctx.globalAlpha = .9; ctx.strokeStyle = amber; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = 1;
      label('Attack zone', (mouth + zone) / 2, isPortrait ? 112 : 80);
      label('Crease', mouth + (t ? -40 : 40), 300 - ububallMatch.FOULS.crease - 16);
      ring(ubus.filter(b => b.team === t && isCreasing(b, t)), false);
      ring(ubus.filter(b => b.team === 1 - t && ububallMatch.inAttackZone(P, b, t)), true);
    } else {
      const c = fouls.corner, x = c % 2 ? 840 : 60, y = c > 1 ? 440 : 60;
      inRink(() => { ctx.globalAlpha = .16; ctx.fillStyle = amber; ctx.fillRect(x, y, 100, 100); });
      ctx.globalAlpha = .8; ctx.setLineDash([6, 6]);
      line(c % 2 ? 840 : 160, y, c % 2 ? 840 : 160, y + 100, amber, 2); line(x, c > 1 ? 440 : 160, x + 100, c > 1 ? 440 : 160, amber, 2);
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      label('Corner', c % 2 ? 790 : 210, c > 1 ? 430 : 170);
      const [home, away] = cornerTeams();
      ring(home, home.length <= away.length); ring(away, away.length <= home.length);
    }
    ctx.restore();
  }
  // Arcs around a spinning ubu or ball, turning with it. Harder spins (up to 24 rad/s; ubus top out at
  // 22.5, the ball at 24) draw more, longer and bolder arcs, and an outer ring past halfway.
  function drawSpin(b, color) {
    const spin = Math.abs(b.omega);
    if (spin < 2.5 || reducedMotion.matches) return;
    const power = Math.min(1, (spin - 2.5) / 20), arcs = spin >= 8 ? 3 : 2, sweep = (.8 + 1.2 * power) * Math.sign(b.omega), back = b.omega < 0;
    ctx.save(); ctx.strokeStyle = color; ctx.lineCap = 'round';
    for (let k = 0; k < arcs; k++) {
      const start = b.rotation + k * 2 * Math.PI / arcs;
      ctx.globalAlpha = .2 + .6 * power; ctx.lineWidth = 1.5 + 2.5 * power;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 4, start, start + sweep, back); ctx.stroke();
      if (power > .5) {
        ctx.globalAlpha = power - .5; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 10, start + sweep * .4, start + sweep, back); ctx.stroke();
      }
    }
    ctx.restore();
  }
  // Discrete rule and snapshot updates may move bodies without physics.
  // Clear only the trails whose bodies were repositioned; normal motion keeps its trail.
  const trailPositions = () => bodies.map(b => ({ x: b.x, y: b.y }));
  function clearDiscontinuousTrails(before) {
    bodies.forEach((b, i) => {
      if (before[i] && (before[i].x !== b.x || before[i].y !== b.y)) trails[i].length = 0;
    });
  }
  function recordTrails() {
    if (reducedMotion.matches) return;
    bodies.forEach((b, i) => {
      if (b.vx * b.vx + b.vy * b.vy < 625) return;
      const trail = trails[i], previous = trail[trail.length - 1];
      if (!previous || (b.x - previous.x) ** 2 + (b.y - previous.y) ** 2 >= 25) {
        const duration = .24; // Fixed lifetime makes trail length follow speed, not body size.
        // The ball's trail heats from white to orange with speed, and flares after a Cannonball.
        const heat = b.team === -1 ? ballHeat(b) : 0;
        trail.push({ x: b.x, y: b.y, life: duration, duration, heat });
        if (trail.length > 40) trail.shift();
      }
    });
  }
  function drawTrails(home, away) {
    ctx.save();

    trails.forEach((trail, index) => {
      if (!trail.length) return;
      const b = bodies[index], color = b.team === -1 ? '#ffffff' : b.team === 0 ? home : away;
      const last = trail[trail.length - 1];
      const near = (b.x - last.x) ** 2 + (b.y - last.y) ** 2 < 4;
      const count = near ? trail.length - 1 : trail.length;
      const pts = [];
      for (let j = 0; j < count; j++) {
        trail[j].origIndex = j;
        trail[j].isHead = false;
        pts.push(trail[j]);
      }
      pts.push({ x: b.x, y: b.y, radius: b.radius, life: .24, duration: .24, heat: b.team === -1 ? ballHeat(b) : 0, origIndex: trail.length, isHead: true });

      const u = [];
      for (let j = 0; j < pts.length - 1; j++) {
        const dx = pts[j + 1].x - pts[j].x, dy = pts[j + 1].y - pts[j].y, len = Math.hypot(dx, dy);
        u.push(len > 0.001 ? { x: dx / len, y: dy / len } : (j > 0 ? u[j - 1] : { x: 1, y: 0 }));
      }

      const sections = [];
      let cur = [pts[0]];
      for (let j = 0; j < pts.length - 1; j++) {
        cur.push(pts[j + 1]);
        if (j < pts.length - 2) {
          const dot = u[j].x * u[j + 1].x + u[j].y * u[j + 1].y;
          if (dot < 0.2) {
            if (cur.length >= 2) sections.push(cur);
            cur = [pts[j + 1]];
          }
        }
      }
      if (cur.length >= 2) sections.push(cur);

      for (const sec of sections) {
        const m = sec.length - 1;
        if (m < 1) continue;
        const S0 = sec[0], Sm = sec[m];

        const L = [], R = [];
        for (let k = 0; k <= m; k++) {
          const pt = sec[k];
          let tx = 1, ty = 0;
          if (k === m && pt.isHead && b.vx * b.vx + b.vy * b.vy > 1) {
            const vlen = Math.hypot(b.vx, b.vy);
            tx = b.vx / vlen; ty = b.vy / vlen;
          } else {
            let dx, dy;
            if (k === 0) { dx = sec[1].x - sec[0].x; dy = sec[1].y - sec[0].y; }
            else if (k === m) { dx = sec[m].x - sec[m - 1].x; dy = sec[m].y - sec[m - 1].y; }
            else { dx = sec[k + 1].x - sec[k - 1].x; dy = sec[k + 1].y - sec[k - 1].y; }
            const d = Math.hypot(dx, dy);
            if (d > 0.001) { tx = dx / d; ty = dy / d; }
            else if (k > 0 && L[k - 1]) { tx = L[k - 1].tx; ty = L[k - 1].ty; }
          }

          const nx = -ty, ny = tx;
          const fade = pt.isHead ? 1 : Math.max(0, pt.life / pt.duration);
          const w = b.radius * fade;
          L.push({ x: pt.x + nx * w, y: pt.y + ny * w, tx, ty, w, fade, heat: pt.heat || 0 });
          R.push({ x: pt.x - nx * w, y: pt.y - ny * w, tx, ty, w, fade, heat: pt.heat || 0 });
        }

        const w0 = L[0].w;
        const backX = S0.x - L[0].tx * w0, backY = S0.y - L[0].ty * w0;
        if (Math.hypot(Sm.x - backX, Sm.y - backY) < 1) continue;

        ctx.beginPath();
        ctx.moveTo(L[0].x, L[0].y);
        for (let k = 1; k <= m; k++) ctx.lineTo(L[k].x, L[k].y);
        ctx.lineTo(R[m].x, R[m].y);
        for (let k = m - 1; k >= 0; k--) ctx.lineTo(R[k].x, R[k].y);

        if (w0 > 0.5) {
          const angR = Math.atan2(R[0].y - S0.y, R[0].x - S0.x);
          const angL = Math.atan2(L[0].y - S0.y, L[0].x - S0.x);
          ctx.arc(S0.x, S0.y, w0, angR, angL, true);
        }
        ctx.closePath();

        const grad = ctx.createLinearGradient(backX, backY, Sm.x, Sm.y);
        // Preserve each recorded heat value, including a brief hot spot between cool ends.
        // Distance-based stops avoid stretching closely spaced samples over the whole trail.
        const positions = [0];
        let length = 0;
        for (let k = 1; k <= m; k++) {
          length += Math.hypot(sec[k].x - sec[k - 1].x, sec[k].y - sec[k - 1].y);
          positions.push(length);
        }
        for (let k = 0; k <= m; k++) {
          const s = length > 0 ? positions[k] / length : k / m;
          const f = k === 0 && S0.origIndex === 0 ? 0 : L[k].fade;
          if (b.team === -1) {
            const h = L[k].heat;
            const base = 0.23 + Math.min(2, h) * 0.05 + Math.max(0, h - 2) * 0.3;
            const alpha = 1 - Math.pow(1 - Math.min(0.99, base * f), 18 * f);
            grad.addColorStop(s, heatColor(h, alpha));
          } else {
            const alpha = 1 - Math.pow(1 - 0.23 * f, 18 * f);
            grad.addColorStop(s, hexToRgba(color, alpha));
          }
        }
        ctx.fillStyle = grad;
        ctx.fill();
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
  const conicRingSprites = new Map();
  const MAX_CONIC_RING_SPRITES = 48;
  function conicRingSprite(key, radius, lineWidth) {
    const ringRadius = Math.round(radius);
    const spriteKey = `${key}:${ringRadius}:${lineWidth}`;
    const cached = conicRingSprites.get(spriteKey);
    if (cached) {
      conicRingSprites.delete(spriteKey);
      conicRingSprites.set(spriteKey, cached);
      return cached;
    }
    const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
    const pad = 16, size = Math.ceil((ringRadius + lineWidth + pad) * 2), scale = 2;
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = size * scale;
    sprite.size = size;
    const c = sprite.getContext('2d');
    c.scale(scale, scale);
    const cx = size / 2, cy = size / 2;
    const sweep = c.createConicGradient(0, cx, cy);
    sweep.addColorStop(0, hexToRgba(c2, 0)); sweep.addColorStop(.3, hexToRgba(c2, .9));
    sweep.addColorStop(.36, hexToRgba(c1, 0)); sweep.addColorStop(1, hexToRgba(c1, 0));
    c.strokeStyle = sweep; c.lineWidth = lineWidth;
    c.shadowBlur = 6; c.shadowColor = c1;
    c.beginPath(); c.arc(cx, cy, ringRadius, 0, Math.PI * 2); c.stroke();
    conicRingSprites.set(spriteKey, sprite);
    if (conicRingSprites.size > MAX_CONIC_RING_SPRITES) conicRingSprites.delete(conicRingSprites.keys().next().value);
    return sprite;
  }
  // Super aura: ready = a ring with a steady sweep and a faint halo; armed and active = full halo,
  // a counter ring and two orbiting sparks. The icon badge names the super.
  function drawSuperAura(b, key, reach) {
    const [c1, c2] = SUPER_AURA_THEMES[key] || ['#ff7197', '#ff9954'];
    const level = b.superActive || b.superArm ? 2 : 1, still = reducedMotion.matches;
    const t = still ? 0 : clockNow() / 1000, spin = t * (.6 + level * 1.2);
    const ringR = reach + 6 + level * 2;
    ctx.save();
    const haloR = ringR + 10 + level * 4 + (still ? 0 : Math.sin(t * 3) * 2);
    ctx.globalAlpha = level === 2 ? .45 : .22;
    ctx.drawImage(superGlowSprite(key), b.x - haloR, b.y - haloR, haloR * 2, haloR * 2);
    ctx.lineCap = 'round';
    ctx.globalAlpha = level === 2 ? .75 : .55;
    circle(b.x, b.y, ringR, c1, level === 2 ? 2.5 : 2);
    ctx.globalAlpha = level === 2 ? 1 : .85;
    for (const [radius, dir] of level === 2 ? [[ringR, 1], [ringR + 5, -1]] : [[ringR, 1]]) {
      const sprite = conicRingSprite(key, radius, level === 2 ? 3.5 : 3), size = sprite.size;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(spin * dir);
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
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
  // Overlay particles (fireworks) draw on the badge layer, above the ubu sprites.
  function drawParticles(home, away, overlay = false) {
    const c = overlay ? badgeCtx : ctx;
    c.save(); c.lineCap = 'round';
    const flames = [];
    for (const p of particles) {
      if (Boolean(p.overlay) !== overlay) continue;
      const color = p.color || (p.team === -1 ? '#ffffff' : p.team === 0 ? home : away), fade = p.life / p.duration;
      c.globalAlpha = Math.min(1, fade * 2) * (p.celebration ? 1 : .65);
      if (p.flash) {
        const size = 170 * fade; c.globalAlpha = fade * .8;
        c.drawImage(glowSprite(color), p.x - size / 2, p.y - size / 2, size, size); continue;
      }
      if (p.materialShape) {
        c.save(); c.translate(p.x, p.y); c.rotate(p.angle);
        c.strokeStyle = c.fillStyle = color; c.lineWidth = 1;
        const size = p.size * Math.min(1, fade * 2);
        c.beginPath();
        if (p.materialShape === 'spark') {
          c.moveTo(-size, 0); c.lineTo(size, 0); c.moveTo(0, -size); c.lineTo(0, size); c.stroke();
        } else if (p.materialShape === 'streak') {
          c.moveTo(-size * 2, 0); c.lineTo(size * 2, 0); c.stroke();
        } else if (p.materialShape === 'shard') {
          c.moveTo(0, -size * 1.6); c.lineTo(size, size); c.lineTo(-size, size); c.closePath(); c.fill();
        } else if (p.materialShape === 'chip') {
          c.fillRect(-size / 2, -size / 2, size, size);
        } else {
          c.arc(0, 0, size, 0, Math.PI * 2);
          if (p.materialShape === 'bubble') c.stroke(); else c.fill();
        }
        c.restore(); continue;
      }
      if (p.flame) {
        flames.push({ x: p.x, y: p.y, r: p.flame * .45 * (.4 + .6 * fade), color, alpha: c.globalAlpha });
        continue;
      }
      if (p.celebration) c.drawImage(glowSprite(color), p.x - 24, p.y - 24, 48, 48);
      const px = p.px === p.x && p.py === p.y ? p.x - 0.01 : p.px;
      c.beginPath(); c.moveTo(px, p.py); c.lineTo(p.x, p.y); c.strokeStyle = color; c.lineWidth = p.celebration ? 2.5 : 1.3; c.stroke();
      c.fillStyle = color; c.beginPath(); c.arc(p.x, p.y, p.celebration ? 1.8 : .9, 0, Math.PI * 2); c.fill();
    }
    if (flames.length) {
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const f of flames) {
        c.globalAlpha = f.alpha; c.fillStyle = f.color;
        c.beginPath(); c.arc(f.x, f.y, f.r, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
    c.restore();
  }
  function kickoff(isNewMatch = false) {
    clearEffects(); kickoffGlow = 1;
    play = ububallMatch.newPlay(); scoringPlayer = null; roundTurns = 0; fouls = ububallMatch.newFouls();
    netFire = null;
    if (isNewMatch) { tally = ububallMatch.newTally(); closeSummary(); }
    const oldBodies = authoritativeBodies || simBodies;
    authoritativeBodies = null;
    const result = P.kickoff();
    result.slice(0, 6).forEach((b, i) => {
      ububallMatch.applyStats(P, b, stats[i], matchMode);
      const entry = teamEntries[i] || practice[i];
      if (entry?.model) {
        b.personality = entry.model.personality;
        const sObj = entry.equippedSuper || resolveEquippedSuper(entry, i);
        b.equippedSuper = sObj ? { id: sObj.id, key: sObj.key, bonusTicks: sObj.bonusTicks || 0, bonusRefund: sObj.bonusRefund || 0 } : null;
        b.superBonusTicks = sObj?.bonusTicks || 0;
        b.superBonusRefund = sObj?.bonusRefund || 0;
        if (isNewMatch) {
          const rating = entry.model.rating ?? 511;
          b.meter = Math.min(100, Math.max(0, (rating / 1020) * 100));
          b.stunned = false;
        } else {
          b.meter = oldBodies?.[i]?.meter ?? 0;
          b.stunned = oldBodies?.[i]?.stunned || false;
        }
        if (classicMode()) { b.meter = 0; b.equippedSuper = null; b.superBonusTicks = 0; b.superBonusRefund = 0; }
        b.superArm = false;
        b.superActive = null;
      }
    });
    simBodies = result;
    syncViewBodies(simBodies, 0);
    bodies.slice(0, 6).forEach(b => { b.superArm = false; });
    return bodies;
  }
  // A save pops a callout over the saver; offline it also earns meter (online, the server credits it).
  // Full time: a summary of the result (with any comeback or shutout) and each ubu's goals, assists,
  // saves and fastest shot, naming the MVP. It opens after the final goal's replay has played once.
  let summaryPending = false, summaryTimer = 0;
  let activeStatsContext = null;
  // The tally and scores as this view sees them (the home team first).
  function viewTally() {
    if (!online?.active) return { tally, scores };
    const t = online.state.game?.tally || ububallMatch.newTally(), seat = online.state.seat;
    const order = items => onlineOrder(items, seat);
    return { tally: { goals: order(t.goals), assists: order(t.assists), saves: order(t.saves), topSpeed: order(t.topSpeed), cards: order(t.cards),
      deficit: seat ? [...t.deficit].reverse() : t.deficit }, scores };
  }
  function honourText(winner) {
    const { tally: t, scores: sc } = viewTally(), h = ububallMatch.honours(t, sc, winner);
    return (h.comeback ? ' A comeback from 3 down!' : '') + (h.shutout ? ' A shutout!' : '');
  }
  function queueSummary() {
    summaryPending = true; clearTimeout(summaryTimer);
    // Without a replay to wait for, it opens on its own.
    summaryTimer = setTimeout(openSummary, 9000);
  }
  function closeSummary() {
    summaryPending = false; clearTimeout(summaryTimer);
    if ($('stats-dialog')?.open) $('stats-dialog').close();
  }
  function openSummary() {
    if (!summaryPending || demo) return;
    summaryPending = false; clearTimeout(summaryTimer);
    openMatchStats('game');
  }
  function steamRing(x, y, r) {
    if (reducedMotion.matches) return;
    for (let i = 0; i < 24 && particles.length < 380; i++) {
      const angle = (i / 24) * Math.PI * 2 + (Math.random() - .5) * 0.2;
      const dist = r * (0.8 + Math.random() * 0.4);
      const px = x + Math.cos(angle) * dist, py = y + Math.sin(angle) * dist;
      const speed = 70 + Math.random() * 90;
      const life = 0.35 + Math.random() * 0.25;
      particles.push({
        x: px, y: py, px, py,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        team: -1, color: Math.random() < 0.6 ? '#ffffff' : '#d2f2ff',
        life, duration: life, size: 2 + Math.random() * 3
      });
    }
  }
  // A save from a ball the saver's own team was most responsible for is a sheepish "Save..." with no meter.
  function creditSave(body, own, iron = false) {
    if (iron && body) body.ironGuard = true;
    popup(body, iron ? (own ? 'Trap!' : 'Big save!') : own ? 'Save...' : 'Save!');
    if (iron) {
      steamRing(body.x, body.y, body.radius);
      gameAudio()?.playIronSave?.();
    }
    if ((typeof phase !== 'undefined' && phase !== 'play') || own || online?.active || goalReplay || theater || (typeof activePlayback !== 'undefined' && activePlayback)) return;
    const idx = bodies.indexOf(body);
    const simBody = idx >= 0 && simBodies[idx] ? simBodies[idx] : body;
    for (const changed of ububallMatch.gainMeter(P, simBodies, stats, simBody, ububallMatch.METER.save, classicMode())) {
      const cIdx = simBodies.indexOf(changed);
      const vb = cIdx >= 0 && bodies[cIdx] ? bodies[cIdx] : changed;
      vb.meter = changed.meter;
      dirtyMeters.add(vb);
    }
  }
  // Online meters come from the server; replays never earn meter.
  function contactMeter(a, b, speed) {
    if ((typeof phase !== 'undefined' && phase !== 'play') || online?.active || goalReplay || theater || (typeof activePlayback !== 'undefined' && activePlayback)) return;
    const tick = matchTicks + Math.round(elapsed / P.DT);
    const ia = bodies.indexOf(a), ib = bodies.indexOf(b);
    const sa = ia >= 0 && simBodies[ia] ? simBodies[ia] : a;
    const sb = ib >= 0 && simBodies[ib] ? simBodies[ib] : b;
    for (const changed of ububallMatch.contactMeter(P, simBodies, stats, sa, sb, speed, tick, classicMode())) {
      const cIdx = simBodies.indexOf(changed);
      const vb = cIdx >= 0 && bodies[cIdx] ? bodies[cIdx] : changed;
      vb.meter = changed.meter;
      dirtyMeters.add(vb);
    }
  }
  // A gain flashes a glint at the bar's growing end; a full bar shimmers.
  function setMeterFill(fill, meter) {
    const value = Math.min(100, Math.max(0, meter || 0)), previous = Number(fill.dataset.value ?? value);
    fill.style.width = value + '%'; fill.dataset.value = value;
    if (value > previous + .2) { fill.classList.remove('gain'); void fill.offsetWidth; fill.classList.add('gain'); }
    fill.classList.toggle('full', value >= 100);
  }
  function flushMeters() {
    for (const body of dirtyMeters) {
      const fill = $(`super-fill-${body.playerIndex}`), pct = $(`super-pct-${body.playerIndex}`);
      if (fill) setMeterFill(fill, body.meter);
      if (pct) pct.textContent = Math.floor(body.meter) + '%';
    }
    dirtyMeters.clear();
  }
  function say(message) { $('game-status').textContent = message; }
  function prepareCPU(initialPlans = null) {
    const generation = ++cpuGeneration;
    cpuDone = false;
    cpuClient.cancel();
    if (online?.active) return;
    cpu = Array.isArray(initialPlans) && initialPlans.length === 3 ? initialPlans : P.cpuPlans(simBodies, () => .5, scores);
    cpuReady = cpuClient.plan({ version: ububallMatch.VERSION, mode: matchMode, bodies: simBodies, stats, scores, turn, fouls },
      { level: demo ? demoLevels[1] : cpuLevel, seed: turn }).then(result => {
      if (generation !== cpuGeneration || !result || online?.active) return;
      if (result.error) console.warn('CPU search unavailable; using baseline plan.');
      else {
        cpu = result.plans;
        cpuDone = true;
        if (phase === 'plan') saveActiveMatch();
      }
    });
  }
  // Big announcements over the rink. The promise settles once the banner has gone, or as soon as
  // another banner replaces it.
  let bannerTimer = 0, bannerGone = null, planBanner = Promise.resolve();
  function banner(text, ms = 1200, tone = '') {
    const el = $('field-banner');
    clearTimeout(bannerTimer); bannerGone?.();
    el.textContent = text; el.dataset.tone = tone; el.style.setProperty('--banner-ms', ms + 'ms');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    return new Promise(resolve => {
      bannerGone = resolve;
      bannerTimer = setTimeout(() => { el.classList.remove('show'); bannerGone = null; resolve(); }, ms);
    });
  }
  // Between turns, guarding ubus stay on guard (keeping their faded arrow); otherwise plans clear.
  function resetPlans(keepGuard = false) {
    dirtyPrediction();
    startPlanClock();
    if (!online?.active) planBanner = banner('Plan your shot…', 1300);
    plans = Array.from({ length: 3 }, (_, i) => keepGuard && plans?.[i]?.guard ? { ...plans[i] } : idlePlan());
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
    const makeStatRow = (label, val, color) => {
      const row = document.createElement('div'); row.className = 'stat-row';
      const name = document.createElement('span'); name.className = 'stat-lbl'; name.textContent = label;
      const track = document.createElement('div'); track.className = 'stat-track';
      const fill = document.createElement('i');
      fill.style.width = `${Math.min(100, Math.max(0, Math.round(val / 255 * 100)))}%`;
      fill.style.backgroundColor = color;
      track.append(fill);
      const valSpan = document.createElement('span'); valSpan.className = 'stat-val'; valSpan.textContent = String(val);
      row.append(name, track, valSpan);
      return row;
    };
    const compactBox = document.createElement('div'); compactBox.className = 'ubu-stats compact-stats';
    for (const [label, color, keys] of groups) {
      const avg = Math.round(keys.reduce((sum, k) => sum + (statSource[k] ?? 127), 0) / keys.length);
      compactBox.append(makeStatRow(label, avg, color));
    }
    const fullBox = document.createElement('div'); fullBox.className = 'ubu-stats full-stats';
    for (const [groupName, color, keys] of groups) {
      const groupHeading = document.createElement('div');
      groupHeading.className = 'stat-group-title';
      groupHeading.textContent = groupName;
      groupHeading.style.color = color;
      fullBox.append(groupHeading);
      for (const k of keys) {
        fullBox.append(makeStatRow(k[0].toUpperCase() + k.slice(1), statSource[k] ?? 127, color));
      }
    }
    compactBox.setAttribute('aria-label', 'Category averages');
    compactBox.title = 'Category averages · 0–255';
    details.append(fullBox); wrap.append(compactBox, details);
    return wrap;
  }
  // An ubu's super: its name, meter and charge. Arming is done from the dock.
  function renderSuperPanel(playerIndex) {
    const wrap = document.createElement('div'); wrap.className = 'super-panel'; wrap.id = `super-panel-${playerIndex}`;
    const topRow = document.createElement('div'); topRow.className = 'super-row';
    const label = document.createElement('span'); label.className = 'super-name-badge'; label.id = `super-name-${playerIndex}`;
    const initialSuper = bodies?.[playerIndex]?.equippedSuper || teamEntries[playerIndex]?.equippedSuper || P.SUPERS[0];
    const icon = document.createElement('img');
    icon.className = 'super-icon';
    icon.id = `super-icon-${playerIndex}`;
    icon.src = initialSuper.icon;
    icon.alt = initialSuper.name;
    icon.dataset.tip = `${initialSuper.name}: ${initialSuper.desc}`;
    const nameSpan = document.createElement('span');
    nameSpan.id = `super-name-text-${playerIndex}`;
    nameSpan.textContent = initialSuper.name;
    label.append(icon, nameSpan);
    const pct = document.createElement('span'); pct.className = 'super-pct'; pct.id = `super-pct-${playerIndex}`;
    pct.textContent = `${Math.round(bodies?.[playerIndex]?.meter ?? 0)}%`;
    topRow.append(label, pct);
    const meterTrack = document.createElement('div'); meterTrack.className = 'super-meter-track';
    const meterFill = document.createElement('i'); meterFill.className = 'super-meter-fill'; meterFill.id = `super-fill-${playerIndex}`;
    setMeterFill(meterFill, bodies?.[playerIndex]?.meter ?? 0);
    meterTrack.append(meterFill);
    wrap.append(topRow, meterTrack);
    return wrap;
  }
  // Knobs set a launch finely. Angle turns like a dial, relative to where it is grabbed so a tap never
  // jumps, and its needle points the way the launch arrow does on screen. Power and spin rise as the
  // pointer moves up or right and fall down or left, a full sweep over KNOB_SWEEP px (a quarter as
  // fast with Shift). The wheel and arrow keys step 1° or 1% (10 with Shift); double-clicking spin
  // centres it. A knob with no fixed ubu follows the selected one.
  const KNOB_SWEEP = 150, knobs = [];
  const KNOB_RANGE = { angle: [0, 360], power: [0, 100], spin: [-100, 100] };
  // Screen degrees, clockwise from up, of a field angle in radians (portrait turns the rink a quarter).
  const screenDegrees = angle => ((angle * 180 / Math.PI + 90 - (isPortrait ? 90 : 0)) % 360 + 360) % 360;
  function knobValue(kind, i) {
    const plan = plans[i];
    return kind === 'angle' ? screenDegrees(plan.angle) : kind === 'power' ? plan.power * 100 : (plan.spin || 0) * 100;
  }
  const knobEditable = i => phase === 'plan' && !bodies[i]?.stunned;
  function setKnob(kind, i, value) {
    if (!knobEditable(i)) return;
    const plan = plans[i], [min, max] = KNOB_RANGE[kind];
    if (kind === 'angle') plan.angle = (((value - 90 + (isPortrait ? 90 : 0)) % 360 + 360) % 360) * Math.PI / 180;
    else plan[kind] = Math.max(min, Math.min(max, value)) / 100;
    plan.guard = false;
    sync(); draw();
  }
  function makeKnob(kind, fixed = null) {
    const wrap = document.createElement('div'); wrap.className = 'knob';
    wrap.innerHTML = '<svg viewBox="0 0 100 100" role="slider" tabindex="0"><circle class="knob-track" cx="50" cy="50" r="40"/>' +
      '<path class="knob-value"/><circle class="knob-face" cx="50" cy="50" r="29"/><line class="knob-needle" x1="50" y1="50" x2="50" y2="26"/></svg>' +
      `<b></b><small>${kind[0].toUpperCase() + kind.slice(1)}</small>`;
    const svg = wrap.querySelector('svg'), index = () => fixed ?? selected;
    const [min, max] = KNOB_RANGE[kind];
    svg.setAttribute('aria-valuemin', min); svg.setAttribute('aria-valuemax', max);
    let grab = null;
    const turnOf = e => { const r = svg.getBoundingClientRect(); return Math.atan2(e.clientX - r.left - r.width / 2, r.top + r.height / 2 - e.clientY) * 180 / Math.PI; };
    svg.onpointerdown = e => {
      const i = index();
      if (!knobEditable(i)) return;
      e.preventDefault(); svg.setPointerCapture(e.pointerId);
      if (fixed !== null && selected !== i) { selected = i; sync(); draw(); }
      grab = { x: e.clientX, y: e.clientY, value: knobValue(kind, i), turn: turnOf(e) };
    };
    svg.onpointermove = e => {
      if (!grab) return;
      const i = index();
      if (kind === 'angle') {
        const turn = turnOf(e), delta = ((turn - grab.turn + 540) % 360) - 180;
        grab.turn = turn; setKnob(kind, i, knobValue(kind, i) + delta * (e.shiftKey ? .25 : 1));
      } else setKnob(kind, i, grab.value + ((e.clientX - grab.x) - (e.clientY - grab.y)) / (KNOB_SWEEP * gameUi.scale()) * (max - min) * (e.shiftKey ? .25 : 1));
    };
    svg.onpointerup = svg.onpointercancel = () => { grab = null; if (phase === 'plan') saveActiveMatch(); };
    svg.onwheel = e => { e.preventDefault(); setKnob(kind, index(), knobValue(kind, index()) - Math.sign(e.deltaY) * (e.shiftKey ? 10 : 1)); if (phase === 'plan') saveActiveMatch(); };
    svg.onkeydown = e => {
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault(); setKnob(kind, index(), knobValue(kind, index()) + step * (e.shiftKey ? 10 : 1));
      if (phase === 'plan') saveActiveMatch();
    };
    if (kind === 'spin') svg.ondblclick = () => { setKnob(kind, index(), 0); if (phase === 'plan') saveActiveMatch(); };
    knobs.push({ kind, wrap, svg, index });
    return wrap;
  }
  function knobArc(from, to) {
    const point = a => [50 + 40 * Math.sin(a * Math.PI / 180), 50 - 40 * Math.cos(a * Math.PI / 180)];
    const [x0, y0] = point(from), [x1, y1] = point(to);
    return `M${x0} ${y0}A40 40 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  }
  function renderKnobs() {
    for (const knob of knobs) {
      const i = knob.index(), b = bodies[i];
      if (!b || !plans[i]) continue;
      const value = knobValue(knob.kind, i);
      // Power sweeps 270° from lower left; spin runs either way from the top; angle is all needle.
      const needle = knob.kind === 'angle' ? value : knob.kind === 'power' ? -135 + 2.7 * value : 1.35 * value;
      const [from, to] = knob.kind === 'power' ? [-135, needle] : knob.kind === 'spin' ? [Math.min(0, needle), Math.max(0, needle)] : [0, 0];
      knob.wrap.querySelector('.knob-value').setAttribute('d', to - from > .5 ? knobArc(from, to) : '');
      knob.wrap.querySelector('.knob-needle').setAttribute('transform', `rotate(${needle} 50 50)`);
      const shown = Math.round(value) % (knob.kind === 'angle' ? 360 : Infinity);
      knob.wrap.querySelector('b').textContent = knob.kind === 'angle' ? `${shown}°` : knob.kind === 'spin' && shown > 0 ? `+${shown}` : knob.kind === 'power' ? `${shown}%` : `${shown}`;
      const editable = knobEditable(i);
      knob.wrap.classList.toggle('disabled', !editable);
      knob.svg.setAttribute('aria-disabled', String(!editable));
      knob.svg.setAttribute('aria-label', `${knob.kind[0].toUpperCase() + knob.kind.slice(1)} for ${teamEntries[i]?.model?.parts.fullName || 'ubu'}`);
      knob.svg.setAttribute('aria-valuenow', Math.round(value));
      knob.svg.setAttribute('aria-valuetext', knob.kind === 'angle' ? `${shown} degrees` : knob.kind === 'power' ? `${shown}% power` :
        shown === 0 ? 'No spin' : `${Math.abs(shown)}% ${shown < 0 ? 'counterclockwise' : 'clockwise'}`);
    }
  }
  function sync() {
    updateClock();
    const planning = phase === 'plan';
    const isGoal = phase === 'goal';
    $('phase').textContent = phase === 'replay' ? 'Replay' : phase === 'over' ? 'Final' : planning ? 'Plan' : isGoal ? 'Goal' : phase === 'cpu-wait' ? 'CPU' : phase === 'waiting' ? 'Waiting' : 'In play';
    $('turn-label').textContent = turn;
    for (const team of [0, 1]) {
      // A goal pops the score; a side reaching 4 goals is on match point.
      if (scores[team] > shownScores[team]) {
        const cell = $(team ? 'away-score' : 'home-score').parentElement;
        cell.classList.remove('scored'); void cell.offsetWidth; cell.classList.add('scored');
      }
      if (scores[team] === 4 && shownScores[team] === 3 && phase !== 'over') bugTab(`Match point · ${sideName(team)}`, { team, colour: true });
      shownScores[team] = scores[team];
      $(team ? 'away-score' : 'home-score').textContent = scores[team];
    }
    const curB = bodies[selected];
    const isStunned = Boolean(curB?.stunned);
    if (isStunned) {
      plans[selected].power = plans[selected].spin = 0;
    }
    for (const id of ['shot-spin', 'spin-less', 'spin-more']) $(id).disabled = !planning || isStunned;
    $('launch').disabled = phase === 'play' || phase === 'cpu-wait';
    document.querySelector('.stadium')?.classList.toggle('goal-phase', isGoal);
    $('launch').textContent = isGoal ? 'Next kickoff' : phase === 'over' ? 'New match' : phase === 'play' ? 'In motion…' : phase === 'cpu-wait' ? 'CPU planning…' : 'Launch team';
    const launching = plans.filter((p, i) => p.power > 0 && !bodies[i].stunned && !(bodies[i].superArm && bodies[i].equippedSuper?.key === 'stalwart')).length;
    const guarding = plans.filter((p, i) => p.guard && !bodies[i].stunned).length;
    $('plan-summary').textContent = planning ? `${launching} launching · ${guarding} guarding` : '';
    [...$('team-selector').children].forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === selected));
      button.disabled = !planning;
      button.querySelector('span').textContent = `${bodies[i].carded ? 'Carded' : bodies[i].stunned ? 'Stunned' : plans[i].guard ? 'Guard' : plans[i].power > 0 ? Math.round(plans[i].power * 100) + '%' : 'Hold'}${bodies[i].superArm ? ' · Armed' : ''}`;
    });
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
        if (bodies[i]?.carded) small.textContent = 'Yellow card · sits out this turn';
        else if (bodies[i]?.stunned) small.textContent = '💫 Stunned this turn';
        else if (plans[i].guard) small.textContent = 'Guarding';
        else if (bodies[i] && P.dazeSlow(bodies[i]) > 0) small.textContent = `Dazed · launch −${Math.round(P.dazeSlow(bodies[i]) * 100)}%`;
        else small.textContent = `${Math.round(plans[i].power * 100)}% power · ${Math.round((plans[i].spin || 0) * 100)}% spin`;
      }
    });
    bodies.slice(0, 6).forEach((b, i) => {
      const pctNode = $(`super-pct-${i}`);
      const fillNode = $(`super-fill-${i}`);
      if (fillNode) setMeterFill(fillNode, b.meter);
      const textNode = $(`super-name-text-${i}`);
      const superTitle = b.equippedSuper?.displayName || b.equippedSuper?.name || 'Stalwart';
      if (textNode) textNode.textContent = superTitle;
      const iconNode = $(`super-icon-${i}`);
      if (iconNode && b.equippedSuper?.icon) {
        if (iconNode.getAttribute('src') !== b.equippedSuper.icon) iconNode.src = b.equippedSuper.icon;
        if (iconNode.alt !== superTitle) iconNode.alt = superTitle;
        const masteryBonus = b.equippedSuper?.copies > 1 ? ` (+${(b.equippedSuper.bonusTicks / 240).toFixed(1)}s duration, +${b.equippedSuper.bonusRefund}% refund)` : '';
        iconNode.dataset.tip = `${superTitle}: ${b.equippedSuper.desc}${masteryBonus}`;
      }
      const panel = $(`super-panel-${i}`);
      panel?.classList.toggle('armed', Boolean(b.superArm));
      panel?.classList.toggle('ready', !b.superArm && b.meter >= 100);
      if (pctNode) pctNode.textContent = b.carded ? 'Carded' : b.stunned ? 'Stunned' : b.superArm ? 'Armed' : b.meter >= 100 ? 'Ready' : `${Math.round(b.meter || 0)}%`;
    });
    const hudSuperBtn = $('stadium-super-btn');
    const hudSuperText = $('stadium-super-text');
    const hudSuperIcon = $('stadium-super-icon');
    if (hudSuperBtn && curB) {
      const s = curB.equippedSuper || P.SUPERS[0];
      const sName = s.displayName || s.name;
      if (hudSuperIcon && s?.icon) {
        if (hudSuperIcon.getAttribute('src') !== s.icon) hudSuperIcon.src = s.icon;
        if (hudSuperIcon.alt !== sName) hudSuperIcon.alt = sName;
        const masteryBonus = s.copies > 1 ? ` (+${(s.bonusTicks / 240).toFixed(1)}s duration, +${s.bonusRefund}% refund)` : '';
        hudSuperIcon.dataset.tip = `${sName}: ${s.desc}${masteryBonus}`;
      }
      const canArm = planning && (curB.meter >= 100) && !curB.stunned;
      hudSuperBtn.disabled = !canArm;
      hudSuperBtn.setAttribute('aria-pressed', String(Boolean(curB.superArm)));
      hudSuperBtn.classList.toggle('armed', Boolean(curB.superArm));
      if (hudSuperText) {
        if (curB.carded) {
          hudSuperText.textContent = 'CARDED';
        } else if (curB.stunned) {
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
    renderKnobs();
    if (online?.active) {
      $('launch').disabled = phase !== 'plan';
      $('launch').textContent = phase === 'plan' ? 'Lock moves' : phase === 'play' ? 'In motion…' : phase === 'over' ? 'Match complete' : 'Waiting…';
      $('new-match').disabled = true;
      $('launch').hidden = phase === 'over';
    }
  }
  // A sidebar card's portrait opens that ubu's stats in a drawer from its team's side of the screen.
  // Light dismiss closes it; tapping the same portrait again leaves it closed.
  const statDrawer = Object.assign(document.createElement('aside'), { className: 'stat-drawer', popover: 'auto' });
  document.body.append(statDrawer);
  let drawerClosed = { player: -1, at: 0 };
  statDrawer.addEventListener('toggle', event => {
    if (event.newState === 'closed') drawerClosed = { player: Number(statDrawer.dataset.player), at: performance.now() };
  });
  function cardPortrait(entry, i) {
    const portrait = document.createElement('button'); portrait.type = 'button'; portrait.className = 'card-portrait';
    portrait.setAttribute('aria-label', `Stats for ${entry.model.parts.fullName}`);
    portrait.append(ubuRender(entry.model, 'ball-thumb'));
    portrait.onclick = () => openStatDrawer(i);
    return portrait;
  }
  function openStatDrawer(i) {
    if (drawerClosed.player === i && performance.now() - drawerClosed.at < 400) return;
    const entry = teamEntries[i], close = document.createElement('button');
    close.type = 'button'; close.className = 'icon-button'; close.setAttribute('aria-label', 'Close stats'); close.append(gameUi.icon('x'));
    close.onclick = () => statDrawer.hidePopover();
    const titles = document.createElement('div'); titles.className = 'card-titles';
    titles.append(Object.assign(document.createElement('strong'), { textContent: entry.model.parts.fullName }),
      Object.assign(document.createElement('small'), { textContent: $(i < 3 ? 'home-label' : 'opponent-label').textContent }));
    const head = document.createElement('div'); head.className = 'stat-drawer-head';
    head.append(ubuRender(entry.model, 'stat-drawer-art'), titles, close);
    const box = renderStatsBox(stats[i] || entry.model.stats || {});
    box.querySelector('.stat-details').open = true;
    statDrawer.dataset.player = i; statDrawer.dataset.side = i < 3 ? 'home' : 'away';
    statDrawer.replaceChildren(head, box);
    if (!statDrawer.matches(':popover-open')) statDrawer.showPopover();
  }
  // Sidebars can be hidden for a bigger rink; each device remembers the choice.
  function showSidebars(shown) {
    document.body.classList.toggle('sidebars-hidden', !shown);
    $('btn-sidebars').setAttribute('aria-pressed', String(!shown));
    $('btn-sidebars').dataset.tip = shown ? 'Hide sidebars' : 'Show sidebars';
    try { localStorage.setItem('ububall.sidebars', shown ? 'shown' : 'hidden'); } catch {}
  }
  let sidebarsShown = true;
  try { sidebarsShown = localStorage.getItem('ububall.sidebars') !== 'hidden'; } catch {}
  showSidebars(sidebarsShown);
  $('btn-sidebars').onclick = () => showSidebars(document.body.classList.contains('sidebars-hidden'));
  function buildTeam() {
    if (statDrawer.matches(':popover-open')) statDrawer.hidePopover();
    if (!knobDock.querySelector('.knob-row')) {
      const row = document.createElement('div'); row.className = 'knob-row';
      row.append(...['angle', 'power', 'spin'].map(kind => makeKnob(kind)));
      knobDock.append(row);
    }
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
    for (let k = knobs.length - 1; k >= 0; k--) if (!knobs[k].wrap.isConnected || $('team').contains(knobs[k].wrap)) knobs.splice(k, 1);
    $('team-selector').replaceChildren();
    $('home-lineup').replaceChildren();
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
      const titles = document.createElement('div'); titles.className = 'card-titles';
      const strong = document.createElement('strong'); strong.textContent = entry.model.parts.fullName;
      const small = document.createElement('small'); small.textContent = '0% power · 0% spin';
      titles.append(strong, small); select.append(titles);
      const header = document.createElement('div'); header.className = 'card-header';
      header.append(cardPortrait(entry, i), select);
      button.append(header, renderSuperPanel(i));
      select.onclick = () => { selected = i; sync(); draw(); };
      $('team').append(button);
      const shortcut = document.createElement('button'); shortcut.type = 'button';
      shortcut.setAttribute('aria-label', `Select ${entry.model.parts.fullName}`);
      shortcut.append(ubuRender(entry.model, 'ball-thumb'), document.createElement('span'));
      shortcut.onclick = select.onclick;
      $('team-selector').append(shortcut);
      const lineup = document.createElement('div'); lineup.className = 'home-ubu';
      lineup.append(ubuRender(entry.model, 'home-ubu-art'), Object.assign(document.createElement('strong'), { textContent: entry.model.parts.fullName }));
      const superInfo = classicMode() ? null : entry.equippedSuper || resolveEquippedSuper(entry, i);
      if (superInfo) {
        const superLabel = document.createElement('small');
        superLabel.append(Object.assign(document.createElement('img'), { src: superInfo.icon, alt: '' }), superInfo.displayName || superInfo.name);
        lineup.append(superLabel);
      }
      $('home-lineup').append(lineup);
    });
    if ($('cpu-team')) {
      teamEntries.slice(3, 6).forEach((entry, idx) => {
        const i = idx + 3;
        const card = document.createElement('div'); card.className = 'team-card cpu-card'; card.id = `player-${i}`;
        const header = document.createElement('div'); header.className = 'card-header';
        const titles = document.createElement('div'); titles.className = 'card-titles';
        const strong = document.createElement('strong'); strong.textContent = entry.model.parts.fullName;
        const small = document.createElement('small'); small.className = 'away'; small.textContent = $('opponent-label').textContent;
        titles.append(strong, small);
        header.append(cardPortrait(entry, i), titles);
        card.append(header, renderSuperPanel(i));
        $('cpu-team').append(card);
      });
    }
  }
  function restoreEntry(saved) {
    if (!saved || !saved.dna) return null;
    const hasSuper = saved.equippedSuper?.id != null;
    if (typeof saved.key === 'string' && saved.key.startsWith('practice-')) {
      const idx = Number(saved.key.slice(9));
      if (practice[idx]) {
        return {
          ...practice[idx],
          equippedSuper: hasSuper ? resolveEquippedSuper({ model: practice[idx].model, equippedSuper: saved.equippedSuper }) : null
        };
      }
    }
    const rawDNA = ubu.fromCode(saved.dna);
    const model = ubu.decode(rawDNA);
    return {
      key: saved.key || ('custom-' + saved.dna.slice(0, 8)),
      dna: saved.dna,
      label: saved.label || model.parts.fullName,
      model,
      equippedSuper: hasSuper ? resolveEquippedSuper({ model, equippedSuper: saved.equippedSuper }) : null
    };
  }
  function clearActiveMatch() {
    try { localStorage.removeItem('ububall-active-match'); } catch {}
  }
  function saveActiveMatch(launchState = null) {
    if (demo || online?.active || phase === 'over' || !recording) {
      clearActiveMatch();
      return;
    }
    try {
      const entryData = e => e ? {
        key: e.key,
        dna: e.dna,
        label: e.label,
        equippedSuper: e.equippedSuper ? { id: e.equippedSuper.id } : null
      } : null;
      const activeSim = launchState ? launchState.bodies : simBodies;
      const data = {
        version: ububallMatch.VERSION,
        physics: P.VERSION,
        mode: matchMode,
        level: cpuLevel,
        scores: [...scores],
        turn,
        phase: launchState ? 'play' : phase,
        fouls: { crease: [...fouls.crease], corner: fouls.corner, cornerTurns: fouls.cornerTurns, cards: [...(fouls.cards || [])] },
        tally: structuredClone(tally),
        roster: roster.map(entryData),
        teamEntries: teamEntries.map(entryData),
        bodies: ububallReplay.snapshot(activeSim),
        turnPlans: launchState ? launchState.turnPlans : null,
        plans: launchState ? null : (Array.isArray(plans) ? plans.map((p, i) => ({ angle: p.angle, power: p.power, spin: p.spin || 0, superArm: Boolean(bodies[i]?.superArm || p.superArm), guard: Boolean(p.guard) })) : null),
        cpu: launchState ? null : (Array.isArray(cpu) ? cpu.map(p => ({ angle: p.angle, power: p.power, spin: p.spin || 0, superArm: Boolean(p.superArm), guard: Boolean(p.guard) })) : null),
        cpuDone: launchState ? false : Boolean(cpuDone),
        recording: recording ? structuredClone(recording) : null
      };
      localStorage.setItem('ububall-active-match', JSON.stringify(data));
    } catch {}
  }
  function restoreActiveMatch() {
    try {
      const raw = localStorage.getItem('ububall-active-match');
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== ububallMatch.VERSION || saved.physics !== P.VERSION || !saved.bodies || !saved.roster || !saved.teamEntries) {
        clearActiveMatch();
        return false;
      }
      authoritativeBodies = null;
      endGoalReplay();
      playSegments = [];
      cpuMode = saved.mode || 'standard';
      cpuLevel = saved.level || 'medium';
      matchMode = cpuMode;
      const radio = document.querySelector(`input[name="cpu-level"][value="${cpuLevel}"]`);
      if (radio) radio.checked = true;
      document.body.classList.toggle('classic-match', classicMode());
      showMode(matchMode);

      roster = saved.roster.map(restoreEntry);
      draft = [...roster];
      teamEntries = saved.teamEntries.map(restoreEntry);
      stats = teamEntries.map(entry => classicMode() ? normalStats() : { ...(entry?.model?.stats || normalStats()) });
      stopFanfare();
      gameAudio()?.stop();

      scores = [...saved.scores];
      turn = saved.turn;
      fouls = { ...ububallMatch.newFouls(), ...saved.fouls };
      tally = saved.tally || ububallMatch.newTally();
      recording = saved.recording || ububallReplay.create({ mode: matchMode, names: ['You', 'CPU'], ubus: teamEntries.map(e => ({ dna: e.dna, super: e.equippedSuper?.id ?? null })) });
      const restored = ububallReplay.restore(saved.bodies);
      buildTeam();
      restored.slice(0, 6).forEach((b, i) => {
        const entry = teamEntries[i];
        if (entry?.model) {
          b.personality = entry.model.personality;
          const sObj = classicMode() ? null : (entry.equippedSuper || b.equippedSuper || resolveEquippedSuper(entry, i));
          b.equippedSuper = sObj ? { id: sObj.id, key: sObj.key, bonusTicks: sObj.bonusTicks || 0, bonusRefund: sObj.bonusRefund || 0 } : null;
          b.superBonusTicks = sObj?.bonusTicks || 0;
          b.superBonusRefund = sObj?.bonusRefund || 0;
        }
      });
      simBodies = stripPresentation(restored);
      syncViewBodies(simBodies, 0);
      selected = 0;
      drag = null;

      if (saved.phase === 'play' && Array.isArray(saved.turnPlans) && saved.turnPlans.length === 6) {
        plans = saved.turnPlans.slice(0, 3);
        recordSegment(simBodies, saved.turnPlans);
        beginGuide(simBodies, saved.turnPlans, 0);
        P.startTurn(simBodies, saved.turnPlans, typeof liveFx !== 'undefined' ? liveFx.super : handleSuper);
        syncViewBodies(simBodies, 0);
        elapsed = accumulator = 0;
        phase = 'play';
        say('Turn in motion…');
      } else {
        phase = 'plan';
        if (typeof dirtyPrediction === 'function') dirtyPrediction();
        if (Array.isArray(saved.plans) && saved.plans.length === 3) {
          plans = saved.plans;
        } else {
          plans = Array.from({ length: 3 }, () => idlePlan());
        }
        startPlanClock();
        if (saved.cpuDone && Array.isArray(saved.cpu) && saved.cpu.length === 3) {
          cpu = saved.cpu;
          cpuDone = true;
          cpuReady = Promise.resolve();
        } else {
          prepareCPU(Array.isArray(saved.cpu) && saved.cpu.length === 3 ? saved.cpu : null);
        }
        say('Plan your next three launches.');
      }
      sync();
      draw();
      return true;
    } catch {
      clearActiveMatch();
      return false;
    }
  }
  function newMatch(playJingle = false) {
    authoritativeBodies = null;
    endGoalReplay(); playSegments = []; saveRecording();
    matchMode = cpuMode;
    document.body.classList.toggle('classic-match', classicMode());
    showMode(matchMode);
    stats = [...draft, ...practice.slice(3)].map(entry => classicMode() ? normalStats() : { ...(entry.model.stats || normalStats()) });
    stopFanfare(); gameAudio()?.stop();
    roster = [...draft]; teamEntries = [...roster, ...practice.slice(3)]; bodies = kickoff(true); buildTeam(); scores = [0, 0]; turn = 1; selected = 0; phase = 'plan'; elapsed = accumulator = 0; drag = null;
    if (!demo) {
      recording = ububallReplay.create({ mode: matchMode, names: ['You', 'CPU'], ubus: bodies.slice(0, 6).map((b, i) => ({ dna: teamEntries[i].dna, super: b.equippedSuper?.id ?? null })) });
      saveActiveMatch();
    }
    resetPlans(); say('Drag from an ubu toward your target to aim. Drag its arrowhead to adjust power and direction.'); draw();
    if (playJingle) gameAudio()?.playGameStart?.();
  }
  function rounded(x, y, width, height, radius) { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); }
  function line(x1, y1, x2, y2, color, width = 2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  function circle(x, y, r, color, width = 2) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }
  function impulseGeometry(body, plan) {
    if (!body || !plan) return { ringR: 0, scale: 0, distance: 0, x: body?.x || 0, y: body?.y || 0, visible: false };
    const activeSuper = body.superActive || ((body.superArm && (body.meter ?? 0) >= 100) ? body.equippedSuper?.key : null);
    const isColossus = activeSuper === 'colossus';
    const isStalwart = activeSuper === 'stalwart';
    const effRadius = body.radius * (isColossus && body.superActive !== 'colossus' ? (P.SUPER?.colossusRadius || 1.8) : 1);
    const superScale = isColossus ? (P.SUPER?.colossusLaunch || 0.75) : (isStalwart ? (P.SUPER?.stalwartLaunch || 0.5) : 1);
    const scale = 110 * ((body.impulse || P.IMPULSE) / P.IMPULSE) * superScale;
    const ringR = Math.max(effRadius, body.reach || effRadius, 18) + 2;
    const distance = ringR + scale * plan.power;
    return { ringR, scale, distance, x: body.x + Math.cos(plan.angle) * distance, y: body.y + Math.sin(plan.angle) * distance,
      visible: plan.power > 0 && !body.stunned };
  }
  function drawImpulse(body, plan, color) {
    if (!plan) return;
    const arrow = impulseGeometry(body, plan);
    if (!arrow.visible) return;
    const startX = body.x + Math.cos(plan.angle) * arrow.ringR;
    const startY = body.y + Math.sin(plan.angle) * arrow.ringR;
    const endX = arrow.x, endY = arrow.y;

    ctx.save();
    if (plan.guard) ctx.globalAlpha = .25; // Kept while guarding, ready to come back.
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
  function boxPoint(r, p) {
    return isPortrait ? { x: r.left + p.y / 600 * r.width, y: r.top + (1 - p.x / 1000) * r.height }
      : { x: r.left + p.x / 1000 * r.width, y: r.top + p.y / 600 * r.height };
  }
  const screenPoint = p => boxPoint(canvas.getBoundingClientRect(), p);
  function badgePoint(b) {
    return isPortrait ? { x: b.x - b.radius * .65, y: b.y - b.radius * .65 } : { x: b.x - b.radius * .65, y: b.y + b.radius * .65 };
  }
  function fieldTarget(event) {
    const near = p => { const q = screenPoint(p); return Math.hypot(q.x - event.clientX, q.y - event.clientY) <= 22 * gameUi.scale(); };
    const own = bodies.slice(0, 3);
    const arrow = own.findIndex((b, i) => { const a = impulseGeometry(b, plans[i]); return a.visible && near(a); });
    if (arrow >= 0) return { mode: 'arrow', index: arrow };
    const p = point(event);
    return { mode: 'aim', index: own.findIndex(b => !b.stunned && Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 12) };
  }
  // The rink's box within the stage and the spin control's size, measured only when layout changes
  // (and without the rink shake), so placing the control never forces the page to lay out again.
  let fieldBox = null;
  function measureField() {
    const r = canvas.getBoundingClientRect(), stage = stageArea.getBoundingClientRect(), control = $('field-spin');
    fieldBox = { left: r.left - stage.left - shakeX, top: r.top - stage.top - shakeY, width: r.width, height: r.height,
      stageWidth: stage.width, stageHeight: stage.height, controlWidth: control.offsetWidth, controlHeight: control.offsetHeight };
  }
  // A field point in the stage's coordinates (screenPoint, without reading the page).
  const stagePoint = p => boxPoint(fieldBox, p);
  function positionSpinControl() {
    const control = $('field-spin');
    control.hidden = false;
    const visible = phase === 'plan' && drag === null && spinSlider;
    control.style.visibility = visible ? 'visible' : 'hidden';
    control.inert = !visible;
    if (!visible) return;
    const b = bodies[selected], center = stagePoint(b), r = fieldBox;
    const radius = b.radius * (isPortrait ? r.height / 1000 : r.width / 1000);
    const width = r.controlWidth, height = r.controlHeight;
    const arrow = stagePoint(impulseGeometry(b, plans[selected]));
    // Prefer the side opposite the arrow, then clamp inside the stage near the edges.
    let y = arrow.y > center.y + 8 * gameUi.scale() ? center.y - radius - height - 24 * gameUi.scale() : center.y + radius + 5 * gameUi.scale();
    const x = Math.max(6 * gameUi.scale(), Math.min(r.stageWidth - width - 6 * gameUi.scale(), center.x - width / 2));
    y = Math.max(6 * gameUi.scale(), Math.min(r.stageHeight - height - 6 * gameUi.scale(), y));
    control.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
  const impactStamps = new Map();
  function impactStamp(color) {
    if (impactStamps.has(color)) return impactStamps.get(color);
    const stamp = document.createElement('canvas'); stamp.width = stamp.height = 128;
    const c = stamp.getContext('2d'); c.fillStyle = color;
    c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
    impactStamps.set(color, stamp); return stamp;
  }
  let predictionCache = null, predictionRev = 0;
  function dirtyPrediction() { predictionRev++; }
  function predictionKey() {
    const ball = bodies[6];
    let k = `${predictionRev}|${turn}|${matchMode}|${fouls.crease[0] ? 1 : 0},${fouls.crease[1] ? 1 : 0}|${ball ? ball.x + ',' + ball.y : ''}`;
    for (let i = 0; i < 3; i++) {
      const p = plans[i], b = bodies[i];
      if (p) k += `|${p.angle},${p.power},${p.spin || 0},${p.guard ? 1 : 0},${b?.superArm || p.superArm ? 1 : 0},${b?.carded ? 1 : 0}`;
    }
    return k;
  }
  const predictionLayer = {};
  function drawPrediction(home, away) {
    const key = predictionKey();
    if (predictionCache?.key !== key) {
      const data = P.predictTurn(bodies, plans);
      predictionCache = { key, data, fouls: predictFouls(data) };
    }
    cachedLayer(predictionLayer, [canvas.width, canvas.height, home, away, isPortrait, matchMode, key].join(), () => paintPrediction(predictionCache.data, home, away));
  }
  function drawPredictedGoalGlow(home, away) {
    const data = predictionCache?.data;
    if (!data || data.goal === null || data.goalTick == null) return;
    const defendingSide = data.goal === 1 ? 0 : 1;
    const color = defendingSide === 0 ? home : away;

    const arrival = data.goalTick * P.DT;
    const horizon = (data.horizon || 480) * P.DT;
    const u = Math.max(0, Math.min(1, 1 - arrival / horizon));

    // Rate: slow and steady at first (1.2 Hz), speeding up to 5.5 Hz as expected arrival shortens
    const freq = 1.2 + 4.3 * u;
    const now = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(now * Math.PI * 2 * freq);

    // Intensity: steady soft glow when far, ramping up to bright beacon pulses when near
    const baseAlpha = 0.25 + 0.15 * (1 - u);
    const peakAlpha = 0.45 + 0.55 * u;
    const alpha = baseAlpha + (peakAlpha - baseAlpha) * pulse;
    const blur = (8 + 20 * u * (0.6 + 0.4 * pulse)) * (canvas.width / 1000);

    const depth = P.rink.goalDepth;
    const mouthX = defendingSide ? 940 : 60;
    const backX = defendingSide ? 940 + depth : 60 - depth;
    const minX = Math.min(mouthX, backX);

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = (0.04 + 0.16 * u) * (0.6 + 0.4 * pulse);
    ctx.fillRect(minX, 230, depth, 140);

    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.lineWidth = 4 + 3 * u;
    ctx.beginPath();
    ctx.moveTo(mouthX, 230);
    ctx.lineTo(backX, 230);
    ctx.lineTo(backX, 370);
    ctx.lineTo(mouthX, 370);
    ctx.stroke();

    ctx.lineWidth = 5 + 4 * u;
    line(mouthX, 230, mouthX, 370, color, 5 + 4 * u);
    ctx.restore();
  }
  function paintPrediction(prediction, home, away) {
    prediction.paths.forEach((points, index) => {
      if (points.length < 2) return;
      const isBall = bodies[index].team === -1;
      const color = isBall ? '#f2efe9' : bodies[index].team === 0 ? home : away;
      const baseAlpha = isBall ? .9 : .65;
      ctx.save();
      ctx.setLineDash(isBall ? [3, 4] : [4, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = isBall ? 2.5 : 2;

      let splitIdx = 0;
      while (splitIdx < points.length && prediction.horizon - points[splitIdx].tick >= 240) splitIdx++;
      const solidEnd = Math.min(points.length - 1, splitIdx);
      if (solidEnd >= 1) {
        ctx.globalAlpha = baseAlpha;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i <= solidEnd; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();
      }

      if (solidEnd < points.length - 1) {
        const remaining = points.length - 1 - solidEnd;
        const BUCKETS = 5, step = Math.ceil(remaining / BUCKETS);
        for (let b = 0; b < BUCKETS; b++) {
          const start = solidEnd + b * step;
          if (start >= points.length - 1) break;
          const end = Math.min(points.length - 1, start + step);
          const midTick = points[Math.floor((start + end) / 2)].tick;
          const fade = Math.max(0, Math.min(1, (prediction.horizon - midTick) / 240));
          ctx.globalAlpha = fade * baseAlpha;
          ctx.beginPath();
          ctx.moveTo(points[start].x, points[start].y);
          for (let i = start + 1; i <= end; i++) ctx.lineTo(points[i].x, points[i].y);
          ctx.stroke();
        }
      }
      ctx.restore();
    });
    // In Pulse, a short tick across each moving path marks where the turn is expected to end.
    const end = pulseMode() ? ububallMatch.turnTicks(matchMode) : 0;
    prediction.paths.forEach((points, index) => {
      const k = end ? points.findIndex(p => p.tick >= end) : -1;
      if (k < 1) return;
      const from = points[k - 1], to = points[k], dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
      if (!d) return;
      const t = (end - from.tick) / (to.tick - from.tick), x = from.x + dx * t, y = from.y + dy * t;
      const isBall = bodies[index].team === -1, half = isBall ? 6 : 8, nx = -dy / d * half, ny = dx / d * half;
      ctx.save(); ctx.globalAlpha = isBall ? .95 : .8;
      line(x - nx, y - ny, x + nx, y + ny, isBall ? '#f2efe9' : bodies[index].team === 0 ? home : away, 2.5);
      ctx.restore();
    });
    // Where the predicted ball catches fire: a small flame on its path.
    if (prediction.ignition) {
      const { x, y, team } = prediction.ignition;
      const ignitionColor = team === 1 ? away : home;
      ctx.save(); ctx.translate(x, y); if (isPortrait) ctx.rotate(Math.PI / 2);
      ctx.translate(-12, -12);
      ctx.globalAlpha = .95; ctx.fillStyle = ignitionColor; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.fill(IGNITION_FLAME); ctx.stroke(IGNITION_FLAME);
      ctx.restore();
    }
    if (prediction.goalTargets) {
      for (const target of prediction.goalTargets) {
        if (target.team >= 0 && !prediction.paths[target.index].some(p => Math.hypot(p.x - prediction.paths[target.index][0].x, p.y - prediction.paths[target.index][0].y) > 3)) continue;
        const isBall = target.team < 0;
        const color = isBall ? '#f2efe9' : target.team === 0 ? home : away;
        ctx.save();
        ctx.translate(target.x, target.y);
        if (isPortrait) ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(11, 13, 16, 0.75)';
        ctx.fill();
        ctx.scale(13 / 24, 13 / 24);
        ctx.translate(-12, -12);
        ctx.lineWidth = 1.8;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.strokeStyle = color;
        ctx.stroke(TARGET_ICON);
        ctx.restore();
      }
    }
    for (const stop of prediction.stops) {
      if (!stop.stopped || !prediction.paths[stop.index].some(p => Math.hypot(p.x - stop.x, p.y - stop.y) > 3)) continue;
      if (prediction.goalTargets?.some(t => t.index === stop.index && Math.hypot(t.x - stop.x, t.y - stop.y) < 5)) continue;
      const color = bodies[stop.index].team < 0 ? '#fff' : bodies[stop.index].team === 0 ? home : away;
      line(stop.x - 4, stop.y - 4, stop.x + 4, stop.y + 4, color, 2);
      line(stop.x + 4, stop.y - 4, stop.x - 4, stop.y + 4, color, 2);
    }
    // Keep wall-contact markers inside the playable ice and goal pockets, not spilling past the boards.
    ctx.save(); rounded(60, 60, 880, 480, 100);
    ctx.rect(60 - P.rink.goalDepth, 230, P.rink.goalDepth, 140); ctx.rect(940, 230, P.rink.goalDepth, 140); ctx.clip();
    for (const hit of prediction.impacts) {
      const team = bodies[hit.index].team;
      const color = team < 0 ? '#ffffff' : team === 0 ? home : away;
      ctx.save();
      ctx.translate(hit.x, hit.y);
      if (isPortrait) ctx.rotate(Math.PI / 2);
      const fade = Math.min(1, (prediction.horizon - hit.tick) / 240);
      ctx.globalAlpha = .2 * fade;
      const size = hit.reach * 128 / 60;
      ctx.drawImage(impactStamp(color), -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.restore();
  }
  const IGNITION_FLAME = new Path2D('M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.294 -2.333 5.588c0 3.704 3.134 6.706 7 6.706c3.866 0 7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235Z');
  const GUARD_SHIELD = new Path2D('M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3');
  const TARGET_ICON = new Path2D('M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0 M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0');
  let themeColors = null;
  const themeObserver = new MutationObserver(() => { themeColors = null; if (skaters.length) draw(); });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeColors = null; if (skaters.length) draw(); });
  function getThemeColors() {
    if (!themeColors) {
      const theme = getComputedStyle(document.documentElement);
      const color = name => theme.getPropertyValue('--' + name).trim();
      themeColors = {
        primary: color('primary'),
        secondary: color('secondary'),
        home: color('team-home') || '#E8CA48',
        away: color('team-away') || '#AA54D3',
        text: color('text'),
        border: color('border'),
        surface: color('elevated'),
        background: color('background')
      };
    }
    return themeColors;
  }
  function drawRinkSurface(g, colors = getThemeColors()) {
    const { surface, border, background, home, away } = colors;
    g.beginPath();
    g.roundRect(60, 60, 880, 480, 100);
    g.fillStyle = surface;
    g.fill();
    g.strokeStyle = border;
    g.lineWidth = 4;
    g.stroke();

    g.setLineDash([6, 10]);
    g.beginPath();
    g.moveTo(500, 60);
    g.lineTo(500, 540);
    g.strokeStyle = border;
    g.lineWidth = 2;
    g.stroke();
    g.setLineDash([]);

    // Centre ice: face-off circle and faint logo.
    g.fillStyle = surface;
    g.beginPath();
    g.arc(500, 300, 70, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(500, 300, 70, 0, Math.PI * 2);
    g.strokeStyle = border;
    g.lineWidth = 2;
    g.stroke();
    if (rinkLogo.complete && rinkLogo.naturalWidth) {
      const w = 110, h = w * rinkLogo.naturalHeight / rinkLogo.naturalWidth;
      g.save();
      g.globalAlpha = .08;
      g.drawImage(rinkLogo, 500 - w / 2, 300 - h / 2, w, h);
      g.restore();
    }

    // Each goal's crease and attack zone line.
    g.setLineDash([6, 10]);
    for (const team of [0, 1]) {
      const x = team ? 940 : 60, from = team ? Math.PI / 2 : -Math.PI / 2, zone = ububallMatch.attackZoneLine(P, team);
      g.beginPath();
      g.arc(x, 300, ububallMatch.FOULS.crease, from, from + Math.PI);
      g.strokeStyle = border;
      g.lineWidth = 2;
      g.stroke();

      g.beginPath();
      g.moveTo(zone, 60);
      g.lineTo(zone, 540);
      g.strokeStyle = border;
      g.lineWidth = 2;
      g.stroke();
    }
    g.setLineDash([]);

    // Goal pockets: board cutout with open mouth, 3-sided net frame.
    const depth = P.rink.goalDepth;
    for (const [x, accent] of [[60 - depth, home], [940, away]]) {
      g.fillStyle = background;
      g.fillRect(x, 230, depth, 140);
      g.beginPath();
      g.moveTo(x, 230);
      g.lineTo(x + depth, 230);
      g.strokeStyle = accent;
      g.lineWidth = 4;
      g.stroke();

      g.beginPath();
      g.moveTo(x, 370);
      g.lineTo(x + depth, 370);
      g.strokeStyle = accent;
      g.lineWidth = 4;
      g.stroke();

      const backX = x === 60 - depth ? x : x + depth;
      g.beginPath();
      g.moveTo(backX, 230);
      g.lineTo(backX, 370);
      g.strokeStyle = accent;
      g.lineWidth = 4;
      g.stroke();
    }
  }
  function fitStadium() {
    if (!stageArea || !rinkStage || !rinkWrap) return;
    const isFs = isFullscreenActive() || document.body.classList.contains('in-match');

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

    const targetRatio = isPortrait ? 3 / 5 : 5 / 3;
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

    if (isPortrait) {
      rinkWrap.style.width = stageH + 'px';
      rinkWrap.style.height = stageW + 'px';
      rinkWrap.style.top = '50%';
      rinkWrap.style.left = '50%';
      rinkWrap.style.transform = 'translate(-50%, -50%) rotate(-90deg)';
    } else {
      rinkWrap.style.width = '100%';
      rinkWrap.style.height = '100%';
      rinkWrap.style.top = '';
      rinkWrap.style.left = '';
      rinkWrap.style.transform = '';
    }
  }
  // The oomark face on the ball: eyes and mouth match brand SVG, recoloured with team colors on fire.
  function drawBallFace(size, eyeColor, mouthColor) {
    const scale = size / 298.99;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.lineCap = 'butt';
    ctx.strokeStyle = eyeColor;
    ctx.lineWidth = 35.3374;
    for (const cx of [-59.445, 59.445]) {
      ctx.beginPath();
      ctx.arc(cx, -34.503, 48.3813, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = mouthColor;
    ctx.lineWidth = 53.0061;
    ctx.beginPath();
    ctx.moveTo(-75.9575, 74.0501);
    ctx.lineTo(75.9575, 74.0501);
    ctx.stroke();
    ctx.restore();
  }
  function draw() {
    if (layoutDirty && !videoField) {
      const w0 = canvas.clientWidth, h0 = canvas.clientHeight;
      fitStadium();
      renderWidth = canvas.clientWidth; renderHeight = canvas.clientHeight;
      if (renderWidth !== w0 || renderHeight !== h0) { deviceWidth = 0; deviceHeight = 0; }
      measureField();
      layoutDirty = false;
    }
    if (!videoField) positionSpinControl();
    const dpr = devicePixelRatio || 1;
    const rawW = deviceWidth || Math.round(renderWidth * dpr), rawH = deviceHeight || Math.round(renderHeight * dpr);
    const cap = Math.min(1, 3840 / Math.max(1, rawW, rawH));
    const width = videoField?.width ?? Math.max(1, Math.round(rawW * cap));
    const height = videoField?.height ?? Math.max(1, Math.round(rawH * cap));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    if (badgeCanvas.width !== width || badgeCanvas.height !== height) { badgeCanvas.width = width; badgeCanvas.height = height; }
    badgeCtx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); badgeCtx.clearRect(0, 0, 1000, 600);
    ctx.setTransform(width / 1000, 0, 0, height / 600, 0, 0); ctx.clearRect(0, 0, 1000, 600);
    const colors = getThemeColors();
    const { text, home, away, background } = colors;
    const rinkKey = width + ',' + height + JSON.stringify(colors);
    if (rinkCache?.key !== rinkKey) {
      const layer = document.createElement('canvas'); layer.width = width; layer.height = height;
      const layerCtx = layer.getContext('2d');
      layerCtx.setTransform(width / 1000, 0, 0, height / 600, 0, 0);
      drawRinkSurface(layerCtx, colors);
      rinkCache = { key: rinkKey, layer };
    }
    ctx.drawImage(rinkCache.layer, 0, 0, 1000, 600);
    drawFieldUnder(themeColors);
    if (!videoField) drawFoulFocus(text);
    if (phase === 'plan') {
      drawPrediction(home, away);
      drawPredictedGoalGlow(home, away);
    }
    drawTrails(home, away);
    drawGuides(home, away, text);
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

      if (!b.carded) circle(b.x, b.y, reachR + 2, i < 3 ? home : away, 4);

      if ((phase === 'goal' || (onlineReplay?.goalPlayed && phase === 'play')) && b === scoringPlayer) {
        const goalAccent = b.team === 0 ? home : away;
        circle(b.x, b.y, b.radius + 9, goalAccent, 4);
        circle(b.x, b.y, b.radius + 15, goalAccent, 2);
      }
      const inAction = phase === 'play' || phase === 'replay' || Boolean(goalReplay);
      if ((inAction && b.guarding) || (phase === 'plan' && i < 3 && plans[i]?.guard)) {
        badgeCtx.save();
        const p = isPortrait ? { x: b.x - b.radius * .65, y: b.y + b.radius * .65 } : { x: b.x + b.radius * .65, y: b.y + b.radius * .65 };
        badgeCtx.translate(p.x, p.y); if (isPortrait) badgeCtx.rotate(Math.PI / 2);
        // While planning, a Guard the predicted turn's burning ball would not beat turns iron.
        // During play and replays, guards start blue and turn iron once an iron save successfully occurs.
        const iron = phase === 'plan'
          ? Boolean(predictionCache?.data.guards.some(g => g.index === i && g.held))
          : Boolean(b.ironGuard);
        badgeCtx.scale(1.1, 1.1); badgeCtx.translate(-12, -12); badgeCtx.fillStyle = iron ? '#c3ccd6' : '#4798ff';
        badgeCtx.fill(GUARD_SHIELD);
        if (iron) {
          badgeCtx.strokeStyle = '#6b7785';
          badgeCtx.lineWidth = 1.5;
          badgeCtx.stroke(GUARD_SHIELD);
        }
        badgeCtx.restore();
      }
      // Dazed enough to slow its launch: a dizzy swirl turns above the ubu, larger and stronger the
      // deeper the daze.
      const slow = P.dazeSlow(b);
      if (slow > 0 && !b.stunned) {
        const depth = slow / P.DAZE.max, spin = reducedMotion.matches ? 0 : clockNow() / 300;
        ctx.save();
        ctx.translate(isPortrait ? b.x + b.radius + 12 : b.x, isPortrait ? b.y : b.y - b.radius - 12);
        ctx.rotate(spin); ctx.globalAlpha = .55 + .45 * depth;
        ctx.strokeStyle = '#c3cbff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 3.5; a += .2) { const r = 1 + a * (.7 + .4 * depth); a ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(r, 0); }
        ctx.stroke(); ctx.restore();
      }
      if ((b.stunned || b.stunnedNext) && !b.carded) {
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
      if (i < 3 && phase === 'plan') drawImpulse(b, plans[i], home);
      // A video export draws the ubus itself (see composeFrame).
      if (videoField) return;
      const style = skaters[i].style;
      const width = b.radius / 5 + '%';
      // A carded ubu fades out of play.
      const opacity = b.carded ? '0.3' : b.superActive === 'ghost' ? '0.45' : '1';
      const filter = (b.stunned || b.stunnedNext) && !b.carded ? 'grayscale(0.8) brightness(0.7)' : '';
      const transform = `translate(${b.x / 1000 * renderWidth}px, ${b.y / 600 * renderHeight}px) translate(-50%, -50%) rotate(${b.rotation + (isPortrait ? Math.PI / 2 : 0)}rad)`;

      if (style.width !== width) style.width = width;
      if (style.opacity !== opacity) style.opacity = opacity;
      if (style.filter !== filter) style.filter = filter;
      if (style.transform !== transform) style.transform = transform;
    });
    const holding = P.holder(bodies);
    if (holding && bodies[6]) drawStickyTether(holding, bodies[6]);

    if (phase === 'plan') {
      const b = bodies[selected];
      circle(b.x, b.y, b.radius + 8, text, 2);
    }
    const ball = bodies[6];
    ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); ctx.fillStyle = background; ctx.fill(); circle(ball.x, ball.y, ball.radius, text, 2);
    // From red, the ball itself glows with its heat, faintly until it catches fire.
    const heat = ballHeat(ball), glow = Math.max(0, heat - 1) / 2;
    if (glow > 0) {
      ctx.save(); ctx.globalAlpha = .75 * glow; ctx.shadowColor = heatColor(heat); ctx.shadowBlur = 16 * glow * canvas.width / 1000;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); ctx.fillStyle = heatColor(heat); ctx.fill(); ctx.restore();
    }
    const size = ball.radius * 1.7;
    const hot = ballOnFire(ball) || (ball.team === -1 && P.ballOnFire?.(ball));
    const paceTeam = ball.strikerTeam;
    if (hot && paceTeam !== undefined && paceTeam >= 0) {
      const teamColor = paceTeam === 0 ? home : away;
      ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate(ball.rotation + (isPortrait ? Math.PI / 2 : 0));
      drawBallFace(size, teamColor, teamColor);
      ctx.restore();
    } else if (ballMark.complete && ballMark.naturalWidth) {
      ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate(ball.rotation + (isPortrait ? Math.PI / 2 : 0));
      ctx.drawImage(ballMark, -size / 2, -size / 2, size, size);
      ctx.restore();
    } else {
      ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate(ball.rotation + (isPortrait ? Math.PI / 2 : 0));
      drawBallFace(size, '#F8F7F4', '#FF7197');
      ctx.restore();
    }
    bodies.slice(0, 6).forEach(b => { if (!b.carded) drawSpin(b, b.team ? away : home); });
    drawSpin(ball, text);
    drawParticles(home, away);
    drawFieldOver(themeColors);
    drawFouls(text);
    if (!videoField) updateFoulInfo();
    drawPopups(home, away);
    drawParticles(home, away, true);
    if (goalReplay) {
      ctx.save(); ctx.translate(isPortrait ? 30 : 500, isPortrait ? 300 : 32); if (isPortrait) ctx.rotate(Math.PI / 2);
      ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = text;
      const slow = goalReplay.played >= goalReplay.total || ububallMatch.replaySpeed(goalReplay.total - goalReplay.played) < 1;
      ctx.fillText(slow ? 'REPLAY · SLOW MOTION' : 'REPLAY', 0, 0);
      ctx.restore();
    }
  }
  function recordSegment(source, turnPlans, ticks = 0, saves = [], stops = []) {
    if (P.settled(source)) playSegments = [];
    playSegments.push({ bodies: structuredClone(source), plans: structuredClone(turnPlans), ticks, saves, stops });
  }
  // A save as a replay keeps it: `tick` counts from 1 at the turn's first.
  const saveEvent = (tick, s) => ({ tick, index: s.index, own: s.own, iron: Boolean(s.iron) });
  // Notes the live tick's saves and hit-stop for the goal replay and the recording.
  function noteEvents(tick, saves, stop) {
    for (const turn of [playSegments.at(-1), recording?.turns.at(-1)]) {
      if (!turn) continue;
      for (const s of saves) turn.saves.push(saveEvent(tick, s));
      if (stop) turn.stops.push({ tick, ms: stop });
    }
  }
  // A replayed tick's saves, spin strike and hit-stop, shown as live play showed them.
  function replayEvents(turn, tick, sim) {
    const saves = turn.saves.filter(s => s.tick === tick), stop = turn.stops.find(s => s.tick === tick)?.ms, struck = sim[6].spinStruck;
    sim[6].spinStruck = false;
    if (saves.length || struck) syncReplay();
    for (const s of saves) {
      if (s.iron && sim[s.index]) sim[s.index].ironGuard = true;
      creditSave(replayView(sim[s.index]), s.own, s.iron);
    }
    if (struck) popup(bodies[6], 'Spin strike!');
    if (stop) impact(stop, stop >= (ububallMatch.HIT_STOP?.scoredGoal ?? 200) ? (ububallMatch.SCREEN_SHAKE?.goal ?? 2) : (ububallMatch.SCREEN_SHAKE?.default ?? 1));
  }
  // Replays re-simulate each recorded turn from its exact starting state on a display copy.
  // The goal replay and the replay viewer share these.
  let activePlayback = null;
  const currentReplay = () => activePlayback || theater;
  const activeOnlineSim = () => (onlineReplay && (onlineReplay.currentTick ?? 0) < onlineReplay.ticks) ? onlineReplay.simBodies : (online?.state?.game?.bodies ?? onlineReplay?.simBodies);
  const shownSim = () => (goalReplay || currentReplay())?.sim ?? (online?.active ? activeOnlineSim() : (postGoal?.sim ?? simBodies));
  const shownSeat = () => (goalReplay || currentReplay() ? (goalReplay || currentReplay()).seat : (online?.active ? (online.state?.seat ?? 0) : 0));
  const replayView = (cb, th = currentReplay()) => toViewBody(cb, th ? th.sim : shownSim(), th ? th.seat : shownSeat(), th?.bodies || (typeof bodies !== 'undefined' ? bodies : null));
  const syncReplay = (th = currentReplay()) => syncViewBodies(th ? th.sim : shownSim(), th ? th.seat : shownSeat(), th?.bodies || (typeof bodies !== 'undefined' ? bodies : null), th ? th.anonymous : undefined, th?.exporting ? null : undefined, th?.entries);
  const replayFx = {
    hit: (a, b, speed, impulse, plow = false, iron = false) => { syncReplay(); handleCollision(replayView(a), replayView(b), speed, impulse, plow, iron); },
    wall: (body, velocity, wallType, nx, ny) => { syncReplay(); const seat = shownSeat(); handleWall(replayView(body), velocity, wallType, seat ? -nx : nx, seat ? -ny : ny); },
    shock: (source, radius, type = null) => { syncReplay(); handleShockwave(replayView(source), radius, type); },
    super: (key, stage, body, target = null) => { syncReplay(); handleSuper(key, stage, replayView(body), target ? replayView(target) : null); }
  };
  function restartGoalReplay() {
    Object.assign(goalReplay, { index: -1, played: 0, steps: 0, doneAt: 0, loops: (goalReplay.loops || 0) + 1 });
    clearEffects(); nextReplaySegment();
  }
  function nextReplaySegment() {
    const before = trailPositions();
    const r = goalReplay, segment = r.segments[++r.index];
    r.sim = stripPresentation(structuredClone(segment.bodies)); r.tick = 0;
    P.startTurn(r.sim, segment.plans, replayFx.super);
    syncReplay();
    clearDiscontinuousTrails(before);
  }
  function startGoalReplay() {
    if (postGoal) { if (postGoal.sim) P.stop(postGoal.sim); P.stop(bodies); postGoal = null; }
    const segments = playSegments.filter(s => s.ticks);
    if (!segments.length || (online?.active && online.state?.phase !== 'resolving')) return;
    endGoalReplay();
    const scorer = bodies.indexOf(scoringPlayer);
    goalReplay = { segments, total: segments.reduce((n, s) => n + s.ticks, 0),
      seat: online?.active ? online.state.seat : 0, scorer };
    scoringPlayer = bodies[scorer] || null;
    restartGoalReplay(); draw();
  }
  // The replay loops until the next kickoff (or, online, until the server moves on).
  function advanceGoalReplay(delta) {
    const r = goalReplay;
    if (clockNow() < hitStopUntil) { draw(); return; }
    if (r.doneAt && performance.now() >= r.doneAt) {
      if (summaryPending) openSummary();
      restartGoalReplay();
      draw();
      return;
    }
    const post = r.played >= r.total;
    const speed = post ? 0.5 : ububallMatch.replaySpeed(r.total - r.played);
    r.steps += delta / P.DT * speed;
    for (let n = 0; r.steps >= 1 && n < 48; n++) {
      r.steps--;
      if (r.played < r.total) {
        if (r.tick >= r.segments[r.index].ticks) nextReplaySegment();
        if (P.step(r.sim, P.DT, replayFx.hit, replayFx.wall, replayFx.shock, replayFx.super) !== null && P.ballOnFire(r.sim[6]) && netFire) netFire.lit = true;
        r.tick++; r.played++;
        replayEvents(r.segments[r.index], r.tick, r.sim);
        syncReplay(); recordTrails();
        if (r.played >= r.total) r.doneAt = performance.now() + ububallMatch.GOAL_REPLAY_HOLD;
        if (clockNow() < hitStopUntil) { r.steps = 0; break; }
      } else {
        P.stepPostGoal(r.sim, P.DT, replayFx.hit, replayFx.wall, replayFx.shock, replayFx.super);
        syncReplay(); recordTrails();
        if (P.settled(r.sim.slice(0, 6))) { P.stop(r.sim); r.steps = 0; break; }
        if (clockNow() < hitStopUntil) { r.steps = 0; break; }
      }
    }
    emitSkaterEffects(delta * speed); draw();
  }
  function endGoalReplay() {
    goalReplayAt = 0;
    if (!goalReplay) return;
    scoringPlayer = bodies[goalReplay.scorer] || null;
    goalReplay = null;
    clearEffects();
    syncReplay();
    bodies.slice(0, 6).forEach(b => dirtyMeters.add(b));
    sync(); draw();
  }
  // Replays (shared/ububall-replay.js): every match is recorded turn by turn and saved on this
  // device when it ends or is left. The library keeps the latest ububallReplay.KEEP of these
  // automatic saves that are not pinned; imports stay until deleted. Each entry holds the
  // .ububall file and a summary for the list, with names and scores in rink order.
  const replayStore = (() => {
    let db = null;
    const open = () => db ||= new Promise((resolve, reject) => {
      const request = indexedDB.open('ububall', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('replays', { keyPath: 'id', autoIncrement: true });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { db = null; reject(request.error); };
    });
    async function run(mode, work) {
      const tx = (await open()).transaction('replays', mode), request = work(tx.objectStore('replays'));
      return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error); });
    }
    return {
      // Ids rise with age, so adding one drops the oldest automatic saves beyond the limit.
      add: entry => run('readwrite', store => {
        const request = store.add(entry);
        store.getAll().onsuccess = event => event.target.result.filter(e => e.auto && !e.pinned).slice(0, -ububallReplay.KEEP).forEach(e => store.delete(e.id));
        return request;
      }),
      put: entry => run('readwrite', store => store.put(entry)),
      all: () => run('readonly', store => store.getAll()),
      get: id => run('readonly', store => store.get(id)),
      remove: id => run('readwrite', store => store.delete(id))
    };
  })();
  // The id of the replay saved last, or null.
  let lastSaved = Promise.resolve(null);
  let lastCompletedReplay = null;
  // Saves the recording, an unfinished match up to its last whole turn, and stops it.
  function saveRecording() {
    const r = recording;
    recording = null; recordingOnline = false;
    if (!r) return lastSaved;
    r.turns = r.turns.filter(t => t.ticks);
    if (!r.turns.length) return lastSaved;
    lastCompletedReplay = r;
    lastSaved = ububallReplay.write(r).then(file => replayStore.add(libraryEntry(r, file, true)))
      .catch(error => { console.warn('Replay not saved.', error); return null; });
    return lastSaved;
  }
  // `auto` marks a match saved automatically, which may be dropped for newer ones.
  function libraryEntry(r, file, auto) {
    const last = r.turns.at(-1);
    return { format: ububallReplay.FORMAT, physics: P.VERSION, recorded: r.recorded, mode: r.mode, seat: r.seat, title: r.title, clip: r.clip,
      names: r.names, scores: r.final?.scores || last.scores.map((n, team) => n + (last.goal?.team === team ? 1 : 0)),
      final: Boolean(r.final), turns: r.turns.length, auto, pinned: false, file };
  }
  addEventListener('pagehide', () => {
    if (online?.active || phase === 'over' || !recording) saveRecording();
  });
  // Completes the local turn just played.
  function noteTurn(ticks, goal, cards) {
    const t = recording?.turns.at(-1);
    if (t && !t.ticks) Object.assign(t, { ticks, goal, cards: [...cards] });
  }
  // Online, the server's turns are recorded in its (seat 0) order and the replay shows this seat's side.
  let onlinePlanFouls = null;
  function recordOnline(s) {
    if (s.phase === 'plan') onlinePlanFouls = structuredClone(s.game.fouls);
    if (recordingOnline || s.phase === 'over') return;
    saveRecording();
    const [me, them] = onlineNames(s), classic = ububallMatch.rule(s.mode, 'classic');
    recording = ububallReplay.create({ mode: s.mode, seat: s.seat, names: s.seat ? [them, me] : [me, them],
      ubus: s.rosters.flat().map(entry => ({ dna: entry.dna, super: classic ? null : entry.superId })) });
    recordingOnline = true;
  }
  function recordOnlineTurn(s) {
    if (!recordingOnline) return;
    const r = s.replay, scores = s.game.scores.map((n, team) => team === r.goal ? n - 1 : n);
    const t = ububallReplay.addTurn(recording, { turn: r.turn, scores, fouls: onlinePlanFouls || ububallMatch.newFouls(), bodies: r.initialBodies, plans: r.plans });
    Object.assign(t, { ticks: r.ticks, cards: [...(s.game.fouls?.cards || [])], saves: r.saves.map(e => saveEvent(e.tick, e)), stops: structuredClone(r.stops),
      goal: r.goal === null ? null : { team: r.goal, label: r.label, scorer: r.label === 'OWN GOAL' ? null : r.scorer, assist: r.assist } });
  }
  function finishOnlineRecording(s) {
    if (!recordingOnline || s.phase !== 'over') return;
    // A match left early has no winner from play.
    if (s.game.winner !== null) recording.final = { scores: [...s.game.scores], winner: s.game.winner };
    saveRecording();
  }
  // The replay viewer re-simulates each turn from its recorded start, as goal replays do. Seeking
  // starts from the nearest turn's start and simulates forward without effects.
  const replayClock = ticks => { const sec = Math.floor(ticks * P.DT); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
  function watchReplay(replay, file) {
    saveRecording(); stopDemo(); closeSummary(); endGoalReplay(); stopFanfare(); gameAudio()?.stop();
    cpuGeneration++; cpuClient.cancel(); videoLogo();
    const seat = replay.seat, names = seat ? [...replay.names].reverse() : replay.names;
    matchMode = replay.mode; document.body.classList.toggle('classic-match', classicMode()); showMode(matchMode);
    teamEntries = onlineOrder(replay.ubus.map(u => ({ model: ubu.decode(ubu.fromCode(u.dna)), dna: u.dna, equippedSuper: u.super === null ? null : P.SUPERS[u.super] })), seat);
    // A replay without names calls its ubus by team and place.
    if (replay.anonymous) teamEntries.forEach((entry, i) => { entry.model.parts = { ...entry.model.parts, fullName: anonymousName(i) }; });
    stats = teamEntries.map(entry => classicMode() ? normalStats() : { ...entry.model.stats });
    $('home-label').textContent = names[0]; $('opponent-label').textContent = names[1]; $('opponent-heading').textContent = `${names[1]}'s team`;
    bodies = kickoff(true); buildTeam(); phase = 'replay'; selected = 0; drag = null;
    theater = createReplaySession(replay, { file, speed: Number($('replay-speed').value), anonymous: Boolean(replay.anonymous) });
    theater.bodies = bodies;
    document.body.classList.add('replay-match');
    say(`Replay · ${names[0]} vs ${names[1]} · ${new Date(replay.recorded).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`);
    replayMarks(); enterMatch(); seekReplay(0, theater);
  }
  // Leaves the viewer for a fresh match.
  function endReplay() {
    if (!theater) return;
    theater = null; document.body.classList.remove('replay-match'); clearEffects();
    $('home-label').textContent = 'You'; $('opponent-label').textContent = 'CPU'; $('opponent-heading').textContent = 'CPU team';
    newMatch();
  }
  function createEffectsState(entries = typeof teamEntries !== 'undefined' ? teamEntries : null) {
    const stylesMap = typeof materialStyles !== 'undefined' ? materialStyles : {};
    return {
      trails: Array.from({ length: 7 }, () => []),
      particles: [],
      fireworks: [],
      shockwaves: [],
      skids: [],
      skidState: [],
      burns: [],
      burnState: {},
      ripples: [],
      pings: [],
      popups: [],
      danger: [0, 0],
      ballFlare: 0,
      kickoffGlow: 0,
      goalSweep: null,
      goalCall: null,
      hitStopUntil: 0,
      shake: 0,
      shakeX: 0,
      shakeY: 0,
      fireTime: 0,
      sizzle: null,
      netFire: null,
      superImpactTimes: typeof WeakMap !== 'undefined' ? new WeakMap() : new Map(),
      materialEmitters: (entries || []).map(entry => {
        const seen = new Set(), styles = [];
        for (const attribute of Object.values(entry?.model?.attributes || {})) {
          const style = stylesMap[attribute.texture];
          if (!style || seen.has(attribute.texture)) continue;
          seen.add(attribute.texture);
          styles.push({ shape: style[0], color: style[1] || attribute.hex });
        }
        return { styles, time: 0 };
      }),
      iceCache: {},
      rinkCache: null
    };
  }
  function createReplaySession(replay, { file = null, speed = 1, paused = false, anonymous = false, exporting = false, clock = null, audio = null, field = null } = {}) {
    const seat = replay.seat ?? 0, anon = Boolean(anonymous || replay.anonymous);
    const names = anon ? [...ububallReplay.ANONYMOUS] : (seat ? [...replay.names].reverse() : [...replay.names]);
    const orderedUbus = Array.isArray(replay.ubus) ? onlineOrder(replay.ubus, seat) : [];
    const liveEntries = typeof teamEntries !== 'undefined' ? teamEntries : null;
    const reuseLive = Array.isArray(liveEntries) && liveEntries.length === orderedUbus.length && orderedUbus.every((u, i) => liveEntries[i]?.dna === u.dna && (liveEntries[i]?.equippedSuper?.id ?? null) === (u.super ?? null));
    const entries = reuseLive ? liveEntries.map((entry, i) => {
      if (!anon) return entry;
      return { ...entry, model: { ...entry.model, parts: { ...entry.model.parts, fullName: anonymousName(i) } } };
    }) : orderedUbus.map((u, i) => {
      const model = typeof ubu !== 'undefined' && u.dna ? ubu.decode(ubu.fromCode(u.dna)) : { parts: { fullName: `Ubu ${i + 1}` }, attributes: {}, stats: typeof normalStats === 'function' ? normalStats() : {} };
      if (anon) model.parts = { ...model.parts, fullName: anonymousName(i) };
      return { model, dna: u.dna, equippedSuper: u.super === null || u.super === undefined ? null : P.SUPERS[u.super] };
    });
    const canCanvas = exporting && typeof document !== 'undefined' && typeof document.createElement === 'function';
    const offscreen = canCanvas ? document.createElement('canvas') : null;
    const offscreenBadges = canCanvas ? document.createElement('canvas') : null;
    return {
      replay,
      file,
      seat,
      mode: replay.mode || (typeof matchMode !== 'undefined' ? matchMode : 'standard'),
      ...ububallReplay.timeline(replay),
      speed,
      paused,
      steps: 0,
      holdUntil: 0,
      index: 0,
      tick: 0,
      called: false,
      crowned: false,
      exporting: Boolean(exporting),
      anonymous: anon,
      names,
      entries,
      bodies: exporting ? P.kickoff() : (typeof bodies !== 'undefined' ? bodies : P.kickoff()),
      sim: null,
      fouls: ububallMatch.newFouls(),
      viewFouls: ububallMatch.newFouls(),
      scores: [0, 0],
      turn: replay.turns?.[0]?.turn ?? 1,
      plans: Array.from({ length: 3 }, () => (typeof idlePlan === 'function' ? idlePlan() : { angle: 0, power: 0, spin: 0, guard: false })),
      guide: null,
      portrait: false,
      clock,
      audio,
      field,
      canvas: offscreen,
      ctx: offscreen ? offscreen.getContext('2d') : null,
      badgeCanvas: offscreenBadges,
      badgeCtx: offscreenBadges ? offscreenBadges.getContext('2d') : null,
      fx: exporting ? createEffectsState(entries) : null,
      _live: {}
    };
  }
  function withPlaybackContext(th, fn) {
    if (!th || activePlayback === th) return fn();
    if (th === theater && !th.exporting) {
      const prev = activePlayback;
      activePlayback = th;
      try {
        return fn();
      } finally {
        activePlayback = prev;
      }
    }
    const saved = th._live || (th._live = {});
    saved.activePlayback = activePlayback;
    saved.bodies = bodies;
    saved.scores = scores;
    saved.turn = turn;
    saved.fouls = fouls;
    saved.plans = typeof plans !== 'undefined' ? plans : undefined;
    saved.guide = typeof guide !== 'undefined' ? guide : undefined;
    saved.matchMode = typeof matchMode !== 'undefined' ? matchMode : undefined;
    saved.teamEntries = typeof teamEntries !== 'undefined' ? teamEntries : undefined;
    saved.anonymousNames = typeof anonymousNames !== 'undefined' ? anonymousNames : undefined;
    saved.isPortrait = typeof isPortrait !== 'undefined' ? isPortrait : undefined;
    saved.videoClock = videoClock;
    saved.videoAudio = videoAudio;
    saved.videoField = typeof videoField !== 'undefined' ? videoField : undefined;
    saved.hitStopUntil = typeof hitStopUntil !== 'undefined' ? hitStopUntil : undefined;
    const swapCanvas = Boolean(th.canvas && typeof canvas !== 'undefined');
    if (swapCanvas) {
      saved.canvas = canvas; saved.ctx = ctx;
      saved.badgeCanvas = badgeCanvas; saved.badgeCtx = badgeCtx;
    }
    const fx = th.fx, swapFx = Boolean(fx && typeof trails !== 'undefined');
    if (swapFx) {
      saved.trails = trails; saved.particles = particles; saved.fireworks = fireworks; saved.shockwaves = shockwaves;
      saved.skids = skids; saved.skidState = skidState; saved.burns = burns; saved.burnState = burnState;
      saved.ripples = ripples; saved.pings = pings; saved.popups = popups; saved.danger = danger;
      saved.ballFlare = ballFlare; saved.kickoffGlow = kickoffGlow; saved.goalSweep = goalSweep; saved.goalCall = goalCall;
      saved.shake = shake; saved.shakeX = shakeX; saved.shakeY = shakeY;
      saved.fireTime = fireTime; saved.sizzle = sizzle; saved.netFire = netFire;
      saved.superImpactTimes = superImpactTimes; saved.materialEmitters = materialEmitters;
      saved.iceCache = iceCache; saved.rinkCache = rinkCache;
    }
    activePlayback = th;
    if (th.bodies) bodies = th.bodies;
    if (th.scores) scores = th.scores;
    if (th.turn !== undefined) turn = th.turn;
    if (th.viewFouls) fouls = th.viewFouls;
    if (th.plans && typeof plans !== 'undefined') plans = th.plans;
    if (typeof guide !== 'undefined') guide = th.guide ?? null;
    if (th.mode && typeof matchMode !== 'undefined') matchMode = th.mode;
    if (th.entries && typeof teamEntries !== 'undefined') teamEntries = th.entries;
    if (typeof anonymousNames !== 'undefined') anonymousNames = Boolean(th.anonymous);
    if (typeof isPortrait !== 'undefined') isPortrait = Boolean(th.portrait);
    if (th.clock !== undefined) videoClock = th.clock;
    if (th.audio !== undefined) videoAudio = th.audio;
    if (th.field !== undefined && typeof videoField !== 'undefined') videoField = th.field;
    if (fx && typeof hitStopUntil !== 'undefined') hitStopUntil = fx.hitStopUntil;
    if (swapCanvas) {
      canvas = th.canvas; ctx = th.ctx;
      badgeCanvas = th.badgeCanvas; badgeCtx = th.badgeCtx;
    }
    if (swapFx) {
      trails = fx.trails; particles = fx.particles; fireworks = fx.fireworks; shockwaves = fx.shockwaves;
      skids = fx.skids; skidState = fx.skidState; burns = fx.burns; burnState = fx.burnState;
      ripples = fx.ripples; pings = fx.pings; popups = fx.popups; danger = fx.danger;
      ballFlare = fx.ballFlare; kickoffGlow = fx.kickoffGlow; goalSweep = fx.goalSweep; goalCall = fx.goalCall;
      shake = fx.shake; shakeX = fx.shakeX; shakeY = fx.shakeY;
      fireTime = fx.fireTime; sizzle = fx.sizzle; netFire = fx.netFire;
      superImpactTimes = fx.superImpactTimes; materialEmitters = fx.materialEmitters;
      iceCache = fx.iceCache; rinkCache = fx.rinkCache;
    }
    try {
      return fn();
    } finally {
      th.bodies = bodies;
      th.scores = scores;
      th.turn = turn;
      th.viewFouls = fouls;
      if (typeof plans !== 'undefined') th.plans = plans;
      if (typeof guide !== 'undefined') th.guide = guide;
      if (th.clock !== undefined) th.clock = videoClock;
      if (th.audio !== undefined) th.audio = videoAudio;
      if (th.field !== undefined && typeof videoField !== 'undefined') th.field = videoField;
      if (fx && typeof hitStopUntil !== 'undefined') fx.hitStopUntil = hitStopUntil;
      if (swapFx) {
        fx.ballFlare = ballFlare; fx.kickoffGlow = kickoffGlow; fx.goalSweep = goalSweep; fx.goalCall = goalCall;
        fx.shake = shake; fx.shakeX = shakeX; fx.shakeY = shakeY;
        fx.fireTime = fireTime; fx.sizzle = sizzle; fx.netFire = netFire;
        fx.superImpactTimes = superImpactTimes; fx.materialEmitters = materialEmitters;
        fx.iceCache = iceCache; fx.rinkCache = rinkCache;
        trails = saved.trails; particles = saved.particles; fireworks = saved.fireworks; shockwaves = saved.shockwaves;
        skids = saved.skids; skidState = saved.skidState; burns = saved.burns; burnState = saved.burnState;
        ripples = saved.ripples; pings = saved.pings; popups = saved.popups; danger = saved.danger;
        ballFlare = saved.ballFlare; kickoffGlow = saved.kickoffGlow; goalSweep = saved.goalSweep; goalCall = saved.goalCall;
        shake = saved.shake; shakeX = saved.shakeX; shakeY = saved.shakeY;
        fireTime = saved.fireTime; sizzle = saved.sizzle; netFire = saved.netFire;
        superImpactTimes = saved.superImpactTimes; materialEmitters = saved.materialEmitters;
        iceCache = saved.iceCache; rinkCache = saved.rinkCache;
      }
      if (swapCanvas) {
        canvas = saved.canvas; ctx = saved.ctx;
        badgeCanvas = saved.badgeCanvas; badgeCtx = saved.badgeCtx;
      }
      if (typeof hitStopUntil !== 'undefined') hitStopUntil = saved.hitStopUntil;
      if (typeof videoField !== 'undefined') videoField = saved.videoField;
      videoAudio = saved.videoAudio;
      videoClock = saved.videoClock;
      if (typeof isPortrait !== 'undefined') isPortrait = saved.isPortrait;
      if (typeof anonymousNames !== 'undefined') anonymousNames = saved.anonymousNames;
      if (typeof teamEntries !== 'undefined') teamEntries = saved.teamEntries;
      if (typeof matchMode !== 'undefined') matchMode = saved.matchMode;
      if (typeof guide !== 'undefined') guide = saved.guide;
      if (typeof plans !== 'undefined') plans = saved.plans;
      fouls = saved.fouls;
      turn = saved.turn;
      scores = saved.scores;
      bodies = saved.bodies;
      activePlayback = saved.activePlayback;
    }
  }
  function loadReplayTurn(k, fx, th = currentReplay()) {
    return withPlaybackContext(th, () => {
      const t = th.replay.turns[k];
      th.index = k; th.tick = 0; th.called = th.crowned = false; th.sim = ububallReplay.restore(t.bodies);
      beginGuide(ububallReplay.restore(t.bodies), t.plans, th.seat);
      th.guide = typeof guide !== 'undefined' ? guide : null;
      th.fouls = { ...ububallMatch.newFouls(), ...structuredClone(t.fouls) };
      th.scores = scores = th.seat ? [...t.scores].reverse() : [...t.scores];
      th.turn = turn = t.turn;
      // The home cards show the moves this turn was played with.
      th.plans = plans = onlineOrder(t.plans, th.seat).slice(0, 3).map(p => ({ ...p, angle: p.angle + (th.seat ? Math.PI : 0) }));
      P.startTurn(th.sim, t.plans, fx ? replayFx.super : null);
      th.viewFouls = fouls = viewFouls(th.fouls, th.seat);
    });
  }
  function stepReplay(fx, th = currentReplay()) {
    return withPlaybackContext(th, () => {
      const sim = th.sim;
      if (fx) P.step(sim, P.DT, replayFx.hit, replayFx.wall, replayFx.shock, replayFx.super); else P.step(sim, P.DT);
      ububallMatch.lapseFouls(P, sim, th.fouls);
      th.tick++;
      if (fx) replayEvents(th.replay.turns[th.index], th.tick, sim); else sim[6].spinStruck = false;
      traceGuide(sim);
    });
  }
  function seekReplay(at, th = currentReplay(), turnIndex = null) {
    return withPlaybackContext(th, () => {
      const turns = th.replay.turns;
      at = Math.max(0, Math.min(th.total, Math.round(at)));
      let k = turnIndex ?? 0;
      if (turnIndex === null) while (k + 1 < turns.length && th.starts[k + 1] <= at) k++;
      loadReplayTurn(k, false, th);
      const target = Math.min(at - th.starts[k], turns[k].ticks), span = Math.min(target, Math.round(SEEK_EFFECTS / P.DT));
      while (th.tick < target - span) stepReplay(false, th);
      th.holdUntil = 0; th.steps = 0;
      clearEffects(); syncReplay(th);
      // The last moment before `at` plays with its effects, silently, so the field shows its motion trails,
      // contact effects and spin as they were then.
      if (span) {
        const audio = videoAudio, clock = videoClock, dt = 1 / 60;
        videoAudio = silentAudio; videoClock = clockNow() - span * P.DT * 1000;
        try {
          while (th.tick < target) {
            for (let n = 0; n < dt / P.DT && th.tick < target; n++) { stepReplay(true, th); syncReplay(th); recordTrails(); }
            th.viewFouls = fouls = viewFouls(th.fouls, th.seat); emitSkaterEffects(dt);
            videoClock += dt * 1000; updatePopups(dt); updateEffects(dt);
          }
        } finally { videoAudio = audio; videoClock = clock; }
      }
      // A hit-stop met on the way (or left from play, on another clock) does not hold the new moment.
      hitStopUntil = 0;
      if (th.fx) th.fx.hitStopUntil = 0;
      th.viewFouls = fouls = viewFouls(th.fouls, th.seat);
      if (!th.exporting) {
        if (typeof shownScores !== 'undefined') shownScores.splice(0, 2, ...scores);
        sync(); updateReplayBar();
      }
      draw();
    });
  }
  const SEEK_EFFECTS = .4;
  const silentAudio = new Proxy({}, { get: () => () => null });
  // At a turn's end its goal is called and held a moment; at the replay's end it pauses. False stops this frame's steps.
  function endReplayTurn() {
    const th = arguments[0] || currentReplay();
    if (typeof withPlaybackContext === 'function' && th && activePlayback !== th && (th !== theater || th.exporting)) {
      return withPlaybackContext(th, () => endReplayTurn(th));
    }
    const t = th.replay.turns[th.index];
    if (t.goal && !th.called) {
      th.called = true; th.steps = 0; th.holdUntil = clockNow() + 2500;
      const team = th.seat ? 1 - t.goal.team : t.goal.team, scorer = t.goal.scorer === null ? null : bodies[viewIndex(t.goal.scorer, th.seat)];
      scores[team]++;
      if (th.scores && th.scores !== scores) th.scores[team] = scores[team];
      if (!th.exporting) sync();
      celebrate(team, bodies[6], t.goal.label, scorer);
      if (!th.exporting) goalTab(team, t.goal.label, scorer?.name || null);
      return false;
    }
    // The match's winning goal: once its call clears, the winner is called before the replay goes on.
    if (winningTurn(t) && !th.crowned) {
      th.crowned = true; th.steps = 0; th.holdUntil = clockNow() + WIN_SECONDS * 1000;
      const team = th.seat ? 1 - t.goal.team : t.goal.team, name = (th.names || [$('home-label').textContent, $('opponent-label').textContent])[team];
      // A comeback from 3 or more down, or a shutout, as at full time.
      const deficit = Math.max(...th.replay.turns.map(r => r.scores[1 - t.goal.team] - r.scores[t.goal.team]));
      celebrate(team, bodies[6], name === 'You' ? 'YOU WIN!' : `${name.toUpperCase().slice(0, 16)} WINS!`);
      goalCall.name = [`${scores[0]}–${scores[1]}`, deficit >= 3 && 'Comeback from 3 down!', !scores[1 - team] && 'Shutout!'].filter(Boolean).join(' · ');
      return false;
    }
    if (th.index + 1 >= th.replay.turns.length) { th.paused = true; th.steps = 0; return false; }
    if (t.goal) clearEffects();
    const before = trailPositions();
    loadReplayTurn(th.index + 1, true); syncReplay();
    clearDiscontinuousTrails(before);
    if (!th.exporting) sync();
    return true;
  }
  // The winner's call holds as long as a goal's call shows.
  const WIN_SECONDS = GOAL_CALL_SECONDS + .6;
  const winningTurn = t => Boolean(t.goal) && t.scores[t.goal.team] + 1 >= 5;
  function advanceReplay(delta, th = currentReplay()) {
    return withPlaybackContext(th, () => {
      if (!th.paused && clockNow() >= th.holdUntil && clockNow() >= hitStopUntil) {
        th.steps += delta / P.DT * th.speed;
        for (let n = 0; th.steps >= 1 && n < 240; n++) {
          if (th.tick >= th.replay.turns[th.index].ticks) { if (!endReplayTurn(th)) break; continue; }
          stepReplay(true, th); th.steps--; syncReplay(th); recordTrails();
          if (clockNow() < hitStopUntil) { th.steps = 0; break; }
        }
        th.viewFouls = fouls = viewFouls(th.fouls, th.seat);
        emitSkaterEffects(delta * th.speed);
      }
      if (!th.exporting) updateReplayBar();
      draw();
    });
  }
  function updateReplayBar() {
    const th = theater || currentReplay(), at = th.starts[th.index] + th.tick, seek = $('replay-seek'), play = $('replay-play');
    seek.max = th.total;
    if (!seek.matches(':active')) seek.value = at;
    $('replay-time').textContent = `${replayClock(at)} / ${replayClock(th.total)}`;
    play.classList.toggle('paused', th.paused);
    play.setAttribute('aria-label', th.paused ? 'Play' : 'Pause');
  }
  // Goals (tap to watch from just before) and cards along the timeline.
  function replayMarks() {
    const th = theater, marks = [];
    th.replay.turns.forEach((t, k) => {
      const end = th.starts[k] + t.ticks, left = `${end / th.total * 100}%`;
      if (t.goal) {
        const team = th.seat ? 1 - t.goal.team : t.goal.team, scorer = t.goal.scorer === null ? null : teamEntries[viewIndex(t.goal.scorer, th.seat)];
        const mark = document.createElement('button'); mark.type = 'button'; mark.className = `replay-mark ${team ? 'away' : 'home'}`; mark.style.left = left;
        mark.title = [t.goal.label, scorer?.model.parts.fullName].filter(Boolean).join(' · ');
        mark.setAttribute('aria-label', mark.title);
        mark.onclick = () => seekReplay(Math.max(th.starts[k], end - 3 / P.DT));
        marks.push(mark);
      }
      if (t.cards.length) {
        const mark = document.createElement('span'); mark.className = 'replay-mark card'; mark.style.left = left;
        marks.push(mark);
      }
    });
    $('replay-marks').replaceChildren(...marks);
  }
  $('replay-seek').oninput = event => { if (theater) seekReplay(Number(event.target.value)); };
  $('replay-play').onclick = () => {
    const th = theater;
    if (!th) return;
    if (th.paused && th.index === th.replay.turns.length - 1 && th.tick >= th.replay.turns[th.index].ticks) seekReplay(0);
    th.paused = !th.paused; th.steps = 0; updateReplayBar();
  };
  $('replay-prev').onclick = () => { const th = theater; if (th) seekReplay(th.starts[Math.max(0, th.tick > 120 ? th.index : th.index - 1)]); };
  $('replay-next').onclick = () => { const th = theater; if (th && th.index + 1 < th.replay.turns.length) seekReplay(th.starts[th.index + 1]); };
  gameUi.select($('replay-speed'));
  $('replay-speed').onchange = event => { if (theater) theater.speed = Number(event.target.value); };
  // Video export: the replay renders frame by frame on its own clock, faster than real time, into a
  // 1080p60 H.264 MP4 (web/mp4.js) at a constant 1.5 Mb/s: the flat field needs little, and the
  // encoder's variable mode overshot low targets several times over. Its sounds are scheduled into
  // an offline audio context at each frame's time, then encoded as AAC, or Opus where AAC is unavailable.
  // The frame is laid out in 1920×1080 units and scaled to `width`. The field fills the width, cropped
  // to the boards, goals and Pulse strip (field y 42–564), under a scorebug band `bug` high: the
  // field's empty margin above the boards runs beneath the band.
  const VIDEO = Object.freeze({ width: 1920, height: 1080, fps: 60, bitrate: 1.5e6, keySeconds: 5, hold: 1, bug: 78,
    field: { x: 0, y: 78 - 42 * 1.92, width: 1920, height: 1152 } });
  const yieldTask = () => new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => resolve(); channel.port2.postMessage(0); });
  const ownBytes = d => d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  // The game's sound calls, played into `offline` at `seconds()` on the video's timeline.
  function offlineAudio(offline, seconds) {
    const A = window.ubuAudio, ctx = new Proxy(offline, {
      get: (target, key) => key === 'currentTime' ? seconds() : typeof target[key] === 'function' ? target[key].bind(target) : target[key]
    });
    // One compressor for the export's mix: a chain per sound made the render several times slower,
    // and changes loudness by well under a decibel.
    A.shareMasterChain(ctx);
    const into = (options = {}) => ({ ...options, ctx });
    return { getAudioContext: () => ctx, stop() {}, playCollision: (voice, o) => A.playCollision(voice, into(o)), playBallHit: o => A.playBallHit(into(o)),
      playWallHit: o => A.playWallHit(into(o)), playGoalHit: (type, o) => A.playGoalHit(type, into(o)), playSuper: (key, phase, o) => A.playSuper(key, phase, into(o)),
      playSizzle: o => A.playSizzle(into(o)), playFoul: (kind, o) => A.playFoul(kind, into(o)) };
  }
  // Videos and share cards carry the ububall.com logo, loaded the first time one is made.
  let videoLogoImage = null;
  function videoLogo() {
    videoLogoImage ||= Object.assign(new Image(), { src: 'assets/ububall-logo-com.svg' });
    return videoLogoImage.decode().catch(() => {});
  }
  const videoFieldSize = () => ({ width: Math.round(VIDEO.field.width * VIDEO.width / 1920), height: Math.round(VIDEO.field.height * VIDEO.width / 1920) });
  // A frame: the field, its ubus and their badges, as the stadium shows them, under the scorebug. The
  // scorebug only changes with a score or turn, so it is drawn once each and reused.
  let videoBug = null;
  function composeFrame(v, th = currentReplay()) {
    const f = VIDEO.field, k = VIDEO.width / 1920;
    const names = th?.names || [$('home-label').textContent, $('opponent-label').textContent];
    const frameScores = th?.scores || scores, frameTurn = th?.turn ?? turn;
    const key = `${names}|${frameScores}|${frameTurn}`;
    if (videoBug?.key !== key) {
      const { home, away, text, surface } = themeColors, cx = 960, font = videoBug?.font || getComputedStyle(document.body).fontFamily;
      const layer = videoBug?.layer || Object.assign(document.createElement('canvas'), { width: VIDEO.width, height: Math.ceil(VIDEO.bug * k) }), b = layer.getContext('2d');
      b.setTransform(k, 0, 0, k, 0, 0); b.clearRect(0, 0, 1920, VIDEO.bug);
      b.beginPath(); b.roundRect(cx - 560, 9, 1120, 60, 14); b.fillStyle = surface; b.fill();
      const logo = videoLogoImage?.naturalWidth ? videoLogoImage : rinkLogo, logoHeight = logo.naturalWidth ? 170 * logo.naturalHeight / logo.naturalWidth : 0;
      if (logoHeight) b.drawImage(logo, cx - 548, 39 - logoHeight / 2, 170, logoHeight);
      b.textBaseline = 'middle';
      for (const team of [0, 1]) {
        const left = team ? cx : cx - 360;
        b.fillStyle = team ? away : home; b.fillRect(left, 9, 360, 60);
        b.fillStyle = team ? '#ffffff' : '#1b1e26';
        b.font = `800 25px ${font}`; b.textAlign = team ? 'right' : 'left';
        b.fillText(names[team].toUpperCase().slice(0, 16), team ? left + 344 : left + 16, 40);
        b.font = `800 38px ${font}`; b.textAlign = 'center';
        b.fillText(String(frameScores[team]), team ? left + 40 : left + 320, 40);
      }
      b.fillStyle = text; b.textAlign = 'center'; b.font = `800 23px ${font}`;
      b.fillText(`T${frameTurn}  REPLAY`, cx + 460, 40);
      videoBug = { key, font, layer };
    }
    v.setTransform(1, 0, 0, 1, 0, 0);
    v.fillStyle = themeColors.background; v.fillRect(0, 0, VIDEO.width, VIDEO.height);
    v.setTransform(k, 0, 0, k, 0, 0);
    paintField(v, f.x, f.y, f.width, f.height, th);
    v.setTransform(1, 0, 0, 1, 0, 0);
    v.drawImage(videoBug.layer, 0, 0);
  }
  // The field, its ubus and their badges, the whole 1000×600 field at (x, y) in `width`×`height`.
  function paintField(v, x, y, width, height, th = currentReplay()) {
    const scale = width / 1000, fieldCanvas = th?.canvas || canvas, fieldBadges = th?.badgeCanvas || badgeCanvas, view = th?.bodies || bodies;
    v.drawImage(fieldCanvas, x, y, width, height);
    view.slice(0, 6).forEach((b, i) => {
      const sprite = skaters[i]?.firstChild;
      if (!(sprite instanceof HTMLCanvasElement)) return;
      const size = 2 * b.radius * scale;
      v.save();
      v.globalAlpha = b.carded ? .3 : b.superActive === 'ghost' ? .45 : 1;
      if ((b.stunned || b.stunnedNext) && !b.carded) v.filter = 'grayscale(0.8) brightness(0.7)';
      v.translate(x + b.x * scale, y + b.y * scale); v.rotate(b.rotation);
      v.drawImage(sprite, -size / 2, -size / 2, size, size);
      v.restore();
    });
    v.drawImage(fieldBadges, x, y, width, height);
  }
  async function encodeAudio(buffer) {
    if (!('AudioEncoder' in window)) return null;
    const rate = buffer.sampleRate;
    for (const [codec, bitrate, frame] of [['mp4a.40.2', 160000, 1024], ['opus', 128000, 960]]) {
      const config = { codec, bitrate, sampleRate: rate, numberOfChannels: 2 };
      if (!(await AudioEncoder.isConfigSupported(config).catch(() => ({}))).supported) continue;
      const samples = [];
      let description = null, failure = null;
      const encoder = new AudioEncoder({ error: error => { failure = error; }, output: (chunk, meta) => {
        if (meta?.decoderConfig?.description) description = ownBytes(meta.decoderConfig.description);
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        samples.push({ data, duration: chunk.duration ? Math.round(chunk.duration * rate / 1e6) : frame });
      } });
      encoder.configure(config);
      const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      for (let at = 0; at < buffer.length; at += 4800) {
        const n = Math.min(4800, buffer.length - at), data = new Float32Array(n * 2);
        data.set(left.subarray(at, at + n)); data.set(right.subarray(at, at + n), n);
        const audio = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(at * 1e6 / rate), data });
        encoder.encode(audio); audio.close();
      }
      await encoder.flush(); encoder.close();
      if (failure) throw failure;
      const opus = codec === 'opus';
      // AAC-LC at 48 kHz in stereo, should the encoder not describe itself.
      return { codec: opus ? 'opus' : 'mp4a', channels: 2, sampleRate: rate, timescale: rate, bitrate, samples,
        description: opus ? null : description || Uint8Array.of(0x11, 0x90), preSkip: opus ? ububallMP4.opusPreSkip(description) : undefined };
    }
    return null;
  }
  let videoCancelled = false, exportingVideo = false;
  const isExporting = () => exportingVideo || Boolean(theater?.exporting);
  // Renders `slice` (see exportSlice) in the export dialog, which is already open.
  async function exportVideo(slice) {
    const dialog = $('export-dialog'), status = $('export-status'), progress = $('export-progress'), close = $('export-close');
    videoCancelled = false; exportingVideo = true; progress.value = 0; progress.hidden = false; status.textContent = 'Preparing…';
    let session = null, encoder = null, blob = null, stopAudio = null;
    try {
      let config = null;
      search: for (const codec of ['avc1.64002A', 'avc1.4D402A', 'avc1.42E02A']) {
        for (const bitrateMode of ['constant', 'variable']) {
          if (videoCancelled) break search;
          const option = { codec, width: VIDEO.width, height: VIDEO.height, bitrate: VIDEO.bitrate, bitrateMode, framerate: VIDEO.fps, avc: { format: 'avc' } };
          if ((await VideoEncoder.isConfigSupported(option).catch(() => ({}))).supported) { config = option; break search; }
        }
      }
      if (!videoCancelled && !config) { status.textContent = 'This browser cannot encode MP4 video.'; progress.hidden = true; close.textContent = 'Close'; return; }
      if (!videoCancelled) await videoLogo();
      if (!videoCancelled) {
        session = createReplaySession(slice.replay, {
          file: slice.file,
          speed: 1,
          paused: false,
          anonymous: Boolean(slice.hidden || slice.replay.anonymous),
          exporting: true,
          clock: 0,
          field: videoFieldSize()
        });
        // Every turn at full speed, each goal's hold and the winner's, then a moment on the final field.
        const seconds = session.total * P.DT + session.replay.turns.filter(t => t.goal).length * 2.5 + (winningTurn(session.replay.turns.at(-1)) ? WIN_SECONDS : 0) + VIDEO.hold;
        const frames = Math.ceil(seconds * VIDEO.fps), rate = 48000;
        const offline = new OfflineAudioContext(2, Math.ceil(frames / VIDEO.fps * rate), rate);
        const out = document.createElement('canvas'); out.width = VIDEO.width; out.height = VIDEO.height;
        const v = out.getContext('2d'), samples = [];
        let description = null, failure = null;
        encoder = new VideoEncoder({ error: error => { failure = error; }, output: (chunk, meta) => {
          if (meta?.decoderConfig?.description) description = ownBytes(meta.decoderConfig.description);
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
          samples.push({ data, duration: 90000 / VIDEO.fps, key: chunk.type === 'key' });
        } });
        encoder.configure(config);
        session.audio = offlineAudio(offline, () => session.clock / 1000);
        // The sound renders alongside the video, a second behind it: it pauses at each second until the
        // video has scheduled every sound up to the next, so nothing is scheduled where it has already rendered.
        let waiting = null, videoDone = false;
        const pump = () => {
          if (waiting !== null && (videoDone || session.clock / 1000 >= waiting + 1)) {
            waiting = null;
            try { offline.resume()?.catch?.(() => {}); } catch {}
          }
        };
        stopAudio = () => {
          if (session) session.audio = null;
          videoDone = true;
          pump();
        };
        for (let mark = 1; mark < offline.length / rate; mark++) offline.suspend(mark).then(() => { waiting = mark; pump(); }, () => {});
        const rendering = offline.startRendering();
        rendering?.catch?.(() => {});
        videoBug = null; gameAudio()?.stop();
        seekReplay(0, session);
        for (let f = 0; f < frames && !videoCancelled && !failure; f++) {
          withPlaybackContext(session, () => {
            if (f) {
              videoClock = session.clock += 1000 / VIDEO.fps;
              updatePopups(1 / VIDEO.fps);
              updateEffects(1 / VIDEO.fps);
              advanceReplay(1 / VIDEO.fps, session);
            }
            composeFrame(v, session);
          });
          const frame = new VideoFrame(out, { timestamp: Math.round(f * 1e6 / VIDEO.fps), duration: Math.round(1e6 / VIDEO.fps) });
          encoder.encode(frame, { keyFrame: f % (VIDEO.keySeconds * VIDEO.fps) === 0 }); frame.close();
          pump();
          while (encoder.encodeQueueSize > 4 && !videoCancelled && !failure) {
            await new Promise(resolve => encoder.addEventListener('dequeue', resolve, { once: true }));
          }
          if (f % 15 === 0) { progress.value = .9 * f / frames; status.textContent = `Rendering ${replayClock(f / VIDEO.fps / P.DT)} of ${replayClock(seconds / P.DT)}…`; await yieldTask(); }
        }
        if (!videoCancelled && !failure) await encoder.flush();
        if (failure) throw failure;
        if (!videoCancelled) {
          stopAudio();
          status.textContent = 'Mixing sound…';
          const audio = await encodeAudio(await rendering);
          if (!videoCancelled) {
            blob = new Blob(ububallMP4.write({ width: VIDEO.width, height: VIDEO.height, timescale: 90000, description, samples }, audio), { type: 'video/mp4' });
            if (!audio) status.textContent = 'This browser cannot encode sound, so the video is silent.';
          }
        }
      }
    } catch (error) {
      status.textContent = `The video could not be made: ${error.message}`;
    } finally {
      stopAudio?.();
      if (encoder && encoder.state !== 'closed') encoder.close();
      if (session?.fx?.sizzle) { session.fx.sizzle.stop?.(); session.fx.sizzle = null; }
      exportingVideo = false;
    }
    close.textContent = 'Close';
    if (videoCancelled) { dialog.close(); return; }
    if (!blob) return;
    progress.value = 1;
    const name = replayFileName(slice.replay.recorded, slice.replay.title) + '.mp4';
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 60000);
    status.textContent = `${status.textContent.startsWith('This browser') ? status.textContent + ' ' : ''}Saved ${name} (${(blob.size / 1e6).toFixed(1)} MB).`;
  }
  // Export: the whole replay, the round around the current turn (from its kickoff through its goal;
  // see ububallReplay.roundRange) or the turn alone, as an MP4 video or a .ububall file. With names
  // hidden, the teams become Saffron and Amethyst and the ubus lose their names (ububallReplay.anonymize).
  let exportKind = 'video';
  const anonymousName = i => `${ububallReplay.ANONYMOUS[i < 3 ? 0 : 1]} ${i % 3 + 1}`;
  function exportRange(range) {
    const th = theater, last = th.replay.turns.length - 1;
    return range === 'match' ? [0, last] : range === 'round' ? ububallReplay.roundRange(th.replay, th.index) : [th.index, th.index];
  }
  // Rounds are numbered by the goals before them.
  function rangeLabel(r, range, from, to) {
    const turns = from === to ? `Turn ${r.turns[from].turn}` : `Turns ${r.turns[from].turn}–${r.turns[to].turn}`;
    return range === 'round' ? `Round ${r.turns[from].scores[0] + r.turns[from].scores[1] + 1} · ${turns}` : turns;
  }
  // The replay to export, with its stored file when that is exactly it; a part becomes a clip named after its turns.
  function exportSlice(range, hidden) {
    const th = theater, r = th.replay, [from, to] = exportRange(range), whole = from === 0 && to === r.turns.length - 1;
    hidden &&= !r.anonymous;
    const names = hidden ? ububallReplay.ANONYMOUS : th.seat ? [...r.names].reverse() : r.names;
    const title = whole ? (hidden ? null : r.title) : `${rangeLabel(r, range, from, to)} · ${names[0]} vs ${names[1]}`.slice(0, ububallReplay.MAX_TITLE).trim();
    const replay = whole ? r : ububallReplay.clip(r, from, to, title);
    return { replay: hidden ? ububallReplay.anonymize(replay, title) : replay, file: whole && !hidden ? th.file : null, hidden };
  }
  function openExport(kind) {
    const th = theater;
    if (!th || isExporting()) return;
    exportKind = kind;
    $('export-title').textContent = kind === 'video' ? 'Export video' : 'Export replay';
    $('export-note').textContent = kind === 'video' ? 'Saves an MP4 video with sound.' : 'Saves a .ububall file to watch in ububall.';
    for (const button of $('export-options').querySelectorAll('button')) {
      const [from, to] = exportRange(button.dataset.range);
      button.querySelector('small').textContent = `${rangeLabel(th.replay, button.dataset.range, from, to)} · ${replayClock(th.replay.turns.slice(from, to + 1).reduce((n, t) => n + t.ticks, 0))}`;
    }
    // A replay already without names has none to hide.
    $('export-private').closest('label').hidden = th.replay.anonymous;
    try { $('export-private').checked = localStorage.getItem('ububall-export-private') === 'on'; } catch {}
    $('export-options').hidden = false; $('export-progress').hidden = true; $('export-status').textContent = ''; $('export-close').textContent = 'Cancel';
    $('export-dialog').showModal();
  }
  $('export-private').onchange = event => { try { localStorage.setItem('ububall-export-private', event.target.checked ? 'on' : 'off'); } catch {} };
  $('export-options').onclick = async event => {
    const range = event.target.closest('button')?.dataset.range;
    if (!range || !theater) return;
    $('export-options').hidden = true;
    const slice = exportSlice(range, $('export-private').checked);
    if (exportKind === 'video') { await exportVideo(slice); return; }
    try {
      downloadReplay(slice.file || await ububallReplay.write(slice.replay), slice.replay.recorded, slice.replay.title);
      $('export-status').textContent = `Saved ${replayFileName(slice.replay.recorded, slice.replay.title)}.ububall.`;
    } catch (error) { $('export-status').textContent = error.message; }
    $('export-close').textContent = 'Close';
  };
  $('replay-export-video').hidden = !('VideoEncoder' in window && 'OfflineAudioContext' in window);
  $('replay-export-video').onclick = () => openExport('video');
  $('replay-export-file').onclick = () => openExport('replay');
  // Share: the moment on screen as a 1080×980 card, the scorebug over the field (cropped to the boards
  // and goals, y 42–550, leaving out the Pulse timer) with its effects and any moves or trails, and a
  // line inviting others to play over the logo and what ububall is. It draws straight into the dialog's canvas and is
  // encoded only when shared or saved.
  const CARD = { width: 1080, height: 980, field: 146, crop: [42, 550], cta: 'Collect & Collide at', tagline: '3v3 turn-based hockey' };
  let cardImage = null;
  function drawShareCard(hidden) {
    const th = theater, out = $('share-card'), g = out.getContext('2d'), { home, away, text, surface, background } = themeColors;
    const anon = Boolean(hidden || th.replay.anonymous), portrait = isPortrait, prevAnon = anonymousNames;
    const names = anon ? ububallReplay.ANONYMOUS : (th.names || [$('home-label').textContent, $('opponent-label').textContent]);
    const cardScores = th.scores || scores, cardTurn = th.turn ?? turn;
    const font = getComputedStyle(document.body).fontFamily;
    const k = CARD.width / 1000, [cropTop, cropBottom] = CARD.crop, fieldBottom = CARD.field + (cropBottom - cropTop) * k;
    g.fillStyle = background; g.fillRect(0, 0, CARD.width, CARD.height);
    try {
      isPortrait = false; cardShot = true; anonymousNames = anon; videoField = { width: CARD.width, height: 600 * k }; draw();
      g.save(); g.beginPath(); g.rect(0, CARD.field, CARD.width, fieldBottom - CARD.field); g.clip();
      paintField(g, 0, CARD.field - cropTop * k, CARD.width, 600 * k, th);
      g.restore();
    } finally {
      videoField = null; cardShot = false; anonymousNames = prevAnon; isPortrait = portrait; layoutDirty = true; draw();
    }
    // Scorebug, as wide as the rink's flat top (x 160–840): each team's name and score, the turn between them.
    const bugLeft = 160 * k, bugWidth = 680 * k, middle = 110, side = (bugWidth - middle) / 2;
    g.textBaseline = 'middle';
    g.save(); g.beginPath(); g.roundRect(bugLeft, 36, bugWidth, 90, 18); g.clip();
    for (const team of [0, 1]) {
      const left = team ? bugLeft + side + middle : bugLeft;
      g.fillStyle = team ? away : home; g.fillRect(left, 36, side, 90);
      g.fillStyle = team ? '#ffffff' : '#1b1e26';
      g.font = `800 52px ${font}`; g.textAlign = 'center';
      g.fillText(String(cardScores[team]), team ? left + 42 : left + side - 42, 83);
      // Names shrink to fit beside the score.
      const name = names[team].toUpperCase().slice(0, 16), room = side - 100;
      let size = 28;
      do g.font = `800 ${size}px ${font}`; while (g.measureText(name).width > room && --size > 14);
      g.textAlign = team ? 'right' : 'left';
      g.fillText(name, team ? left + side - 18 : left + 18, 82, room);
    }
    g.fillStyle = surface; g.fillRect(bugLeft + side, 36, middle, 90);
    g.fillStyle = text; g.textAlign = 'center'; g.font = `800 28px ${font}`; g.fillText(`T${cardTurn}`, CARD.width / 2, 82);
    g.restore();
    // The invitation, the logo and what the game is.
    g.textBaseline = 'alphabetic'; g.textAlign = 'center'; g.fillStyle = text; g.font = `400 34px 'Uburoom Sans', ${font}`;
    g.fillText(CARD.cta, CARD.width / 2, fieldBottom + 60);
    const logo = videoLogoImage, logoWidth = 500, logoHeight = logo?.naturalWidth ? logoWidth * logo.naturalHeight / logo.naturalWidth : 0;
    if (logoHeight) g.drawImage(logo, (CARD.width - logoWidth) / 2, fieldBottom + 80, logoWidth, logoHeight);
    g.font = `400 40px 'Uburoom Sans', ${font}`; g.fillStyle = text;
    g.fillText(CARD.tagline, CARD.width / 2, fieldBottom + 100 + logoHeight + 30);
    // Encoding starts now so sharing does not wait on it.
    const name = `${replayFileName(th.replay.recorded, hidden ? null : th.replay.title)}-turn-${cardTurn}.png`;
    cardImage = new Promise(resolve => out.toBlob(blob => resolve(new File([blob], name, { type: 'image/png' })), 'image/png'));
  }
  async function openShare() {
    const th = theater;
    if (!th || isExporting()) return;
    await Promise.all([videoLogo(), document.fonts.load(`40px 'Uburoom Sans'`).catch(() => {})]);
    $('share-private').closest('label').hidden = th.replay.anonymous;
    try { $('share-private').checked = localStorage.getItem('ububall-export-private') === 'on'; } catch {}
    drawShareCard($('share-private').checked);
    $('share-dialog').showModal();
  }
  // Devices that can share files get Share and Save; others only Save.
  const canShareFiles = Boolean(navigator.canShare?.({ files: [new File([], 'card.png', { type: 'image/png' })] }));
  $('share-send').hidden = !canShareFiles;
  $('share-save').classList.toggle('primary', !canShareFiles);
  $('replay-card').onclick = openShare;
  $('share-private').onchange = event => {
    try { localStorage.setItem('ububall-export-private', event.target.checked ? 'on' : 'off'); } catch {}
    drawShareCard(event.target.checked);
  };
  $('share-send').onclick = async () => {
    try { await navigator.share({ files: [await cardImage], text: 'A moment from ububall. Play at https://ububall.com' }); } catch {}
  };
  $('share-save').onclick = async () => {
    const file = await cardImage, link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  };
  $('share-close').onclick = () => $('share-dialog').close();
  // Closing while a video renders cancels it.
  $('export-close').onclick = () => { if (isExporting()) videoCancelled = true; else $('export-dialog').close(); };
  $('export-dialog').addEventListener('cancel', event => { if (isExporting()) { event.preventDefault(); videoCancelled = true; } });
  // Guides, remembered on this device and set from the pause menu or the replay viewer: Moves draws each
  // ubu's launch (its guard and armed super) from where the turn started; Trails draws the path each body
  // has taken this turn. In play, Moves shows while the turn plays and Trails until the next launch (not
  // across a goal); in replays, videos and share cards, both show for the turn on screen.
  const guides = { moves: false, trails: false };
  try { Object.assign(guides, JSON.parse(localStorage.getItem('ububall-guides') || '{}')); } catch {}
  function showGuides() {
    for (const key of ['moves', 'trails']) {
      $(`replay-${key}`).setAttribute('aria-pressed', String(Boolean(guides[key])));
      showSetting(`guide-${key}`, guides[key]);
    }
  }
  for (const key of ['moves', 'trails']) {
    $(`replay-${key}`).onclick = $(`guide-${key}`).onclick = () => {
      guides[key] = !guides[key]; showGuides();
      try { localStorage.setItem('ububall-guides', JSON.stringify(guides)); } catch {}
      draw();
    };
  }
  showGuides();
  // The turn's start, moves and paths in this view's order and orientation, from the simulation's
  // bodies (before P.startTurn) and plans; `seat` 1 sees the field turned around.
  let guide = null;
  function beginGuide(sim, plans, seat) {
    const start = viewBodies(sim, seat);
    guide = { turn, goals: scores[0] + scores[1], seat, ticks: 0, start, paths: start.map(b => [b.x, b.y]),
      moves: onlineOrder(plans, seat).map(p => ({ ...p, angle: p.angle + (seat ? Math.PI : 0) })) };
  }
  // Every third tick, each body's place joins its path.
  function traceGuide(sim) {
    if (!guide || ++guide.ticks % 3) return;
    sim.forEach((b, c) => guide.paths[viewIndex(c, guide.seat)].push(guide.seat ? 1000 - b.x : b.x, guide.seat ? 600 - b.y : b.y));
  }
  function guideShown(key) {
    if (!guides[key] || !guide) return false;
    if (theater || (typeof activePlayback !== 'undefined' && activePlayback)) return true;
    if (demo || goalReplay) return false;
    if (phase === 'play') return guide.turn === turn;
    return key === 'trails' && guide.turn === turn - 1 && guide.goals === scores[0] + scores[1];
  }
  function drawGuides(home, away, text) {
    if (guideShown('trails')) {
      ctx.save(); ctx.lineCap = ctx.lineJoin = 'round';
      guide.paths.forEach((path, i) => {
        const color = i < 3 ? home : i < 6 ? away : text;
        ctx.globalAlpha = .6; ctx.lineWidth = i < 6 ? 3 : 2; ctx.strokeStyle = color;
        ctx.beginPath(); ctx.moveTo(path[0], path[1]);
        for (let k = 2; k < path.length; k += 2) ctx.lineTo(path[k], path[k + 1]);
        ctx.stroke();
        ctx.globalAlpha = .9; ctx.beginPath(); ctx.arc(path[0], path[1], i < 6 ? 4 : 3, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      });
      ctx.restore();
    }
    if (guideShown('moves')) {
      guide.start.slice(0, 6).forEach((b, i) => {
        const plan = guide.moves[i], color = i < 3 ? home : away;
        ctx.save(); ctx.globalAlpha = .7; ctx.setLineDash([4, 6]); circle(b.x, b.y, b.radius, color, 2); ctx.restore();
        drawImpulse(b, plan, color);
        if (plan.guard && !b.stunned) {
          badgeCtx.save(); badgeCtx.translate(b.x + b.radius * .65, b.y + b.radius * .65); if (isPortrait) badgeCtx.rotate(Math.PI / 2);
          const guideIron = Boolean(b.ironGuard);
          badgeCtx.globalAlpha = .85; badgeCtx.scale(1.1, 1.1); badgeCtx.translate(-12, -12);
          badgeCtx.fillStyle = guideIron ? '#c3ccd6' : '#4798ff'; badgeCtx.fill(GUARD_SHIELD);
          if (guideIron) {
            badgeCtx.strokeStyle = '#6b7785';
            badgeCtx.lineWidth = 1.5;
            badgeCtx.stroke(GUARD_SHIELD);
          }
          badgeCtx.restore();
        }
        if ((plan.superArm || b.superArm) && b.equippedSuper && b.meter >= 100 && !b.stunned) drawSuperBadge({ ...b, superArm: true }, b.equippedSuper.key);
      });
    }
  }
  // Play from here: a match against the CPU from the start of the turn on screen, playing the left team.
  function playFromHere() {
    const th = theater;
    if (!th || (typeof isExporting === 'function' ? isExporting() : th.exporting)) return;
    const t = th.replay.turns[th.index], [roundStart] = ububallReplay.roundRange(th.replay, th.index), entries = teamEntries;
    const field = stripPresentation(transformSimSeat(ububallReplay.restore(t.bodies), th.seat));
    field.forEach((b, i) => {
      // Meter cooldowns counted the recorded match's clock; this match starts its own.
      delete b.meterTick;
      if (i < 6) {
        b.personality = entries[i]?.model?.personality;
        const sObj = classicMode() ? null : (entries[i]?.equippedSuper || resolveEquippedSuper(entries[i], i));
        b.equippedSuper = sObj ? { id: sObj.id, key: sObj.key, bonusTicks: sObj.bonusTicks || 0, bonusRefund: sObj.bonusRefund || 0 } : null;
        b.superBonusTicks = sObj?.bonusTicks || 0;
        b.superBonusRefund = sObj?.bonusRefund || 0;
      }
    });
    stopFanfare(); gameAudio()?.stop();
    theater = null; document.body.classList.remove('replay-match'); clearEffects();
    $('home-label').textContent = 'You'; $('opponent-label').textContent = 'CPU'; $('opponent-heading').textContent = 'CPU team';
    roster = entries.slice(0, 3);
    simBodies = field;
    syncViewBodies(simBodies, 0);
    scores = th.seat ? [...t.scores].reverse() : [...t.scores]; turn = t.turn;
    fouls = viewFouls({ ...ububallMatch.newFouls(), ...structuredClone(t.fouls) }, th.seat);
    play = ububallMatch.newPlay(); tally = ububallMatch.newTally(); roundTurns = th.index - roundStart; matchTicks = 0; playSegments = [];
    selected = 0; drag = null; elapsed = accumulator = 0; phase = 'plan';
    recording = ububallReplay.create({ mode: matchMode, names: ['You', 'CPU'], ubus: simBodies.slice(0, 6).map((b, i) => ({ dna: entries[i].dna, super: b.equippedSuper?.id ?? null })) });
    buildTeam(); resetPlans(); say('Playing from the replay. Plan your launches.'); draw();
  }
  $('replay-take-over').onclick = playFromHere;
  function replayStats({ replay, seat }) {
    const s = ububallReplay.stats(replay);
    s.seat = seat;
    for (const key of ['goals', 'assists', 'shots', 'saves', 'bigSaves', 'checks', 'touches', 'passes', 'topShot', 'skated', 'cards']) {
      s[key] = onlineOrder(s[key], seat);
    }
    if (seat) {
      s.control.reverse();
      s.side.reverse();
      for (const round of s.rounds) if (round.team !== null) round.team = 1 - round.team;
      for (const event of s.events) {
        if (event.actor !== null) event.actor = viewIndex(event.actor, seat);
        if (event.target != null) event.target = viewIndex(event.target, seat);
        if (event.team !== null) event.team = 1 - event.team;
        event.x = 1000 - event.x;
        event.y = 600 - event.y;
      }
    }
    return s;
  }
  function updateStatsRinkWidth() {
    const rw = $('rink')?.getBoundingClientRect().width || 1000;
    $('stats-dialog').style.setProperty('--rink-w', `${rw}px`);
  }
  function getStatsForContext(ctx) {
    if (ctx.type === 'replay') {
      const th = ctx.theater;
      th.stats ||= replayStats(th);
      return th.stats;
    }
    if (ctx.stats) return ctx.stats;
    const replay = ctx.replay;
    if (replay) {
      ctx.stats = replayStats({ replay, seat: replay.seat });
      return ctx.stats;
    }
    const { tally: t } = viewTally();
    const six = () => [0, 0, 0, 0, 0, 0];
    ctx.stats = {
      goals: [...t.goals], assists: [...t.assists], saves: [...t.saves],
      shots: [...(t.shots || six())], checks: [...(t.checks || six())],
      touches: six(), passes: six(), topShot: [...t.topSpeed], skated: six(),
      cards: [...t.cards], control: [50, 50], side: [50, 50], events: [], rounds: [], trails: [],
      bigSaves: t.bigSaves
    };
    return ctx.stats;
  }
  const statsMajor = new Set(['Goal', 'Shot', 'Save', 'Foul']);
  function statsEventLabel(event) {
    const detail = event.outcome || (event.label?.toLowerCase() !== event.type.toLowerCase() ? event.label : null);
    return detail ? `${event.type} (${detail})` : event.type;
  }
  function statsEventText(event, names) {
    const name = i => teamEntries[i]?.model.parts.fullName;
    const actor = event.actor === null ? names[event.team] : name(event.actor);
    const target = event.target == null ? '' : ` → ${name(event.target)}`;
    return `${statsEventLabel(event)} · ${actor}${target}`;
  }
  function statsEventTime(event) {
    const tenths = Math.floor(event.tick * P.DT * 10);
    const seconds = String(Math.floor(tenths / 10) % 60).padStart(2, '0');
    return `${Math.floor(tenths / 600)}:${seconds}.${tenths % 10} · Turn ${event.turn}`;
  }
  function showStatsTab(ctx) {
    const log = ctx.tab === 'log';
    $('stats-box').hidden = log;
    $('stats-log').hidden = !log;
    $('stats-box-tab').setAttribute('aria-pressed', String(!log));
    $('stats-log-tab').setAttribute('aria-pressed', String(log));
    if (log) renderGameLog(ctx);
  }
  function renderGameLog(ctx) {
    const { events, rounds, trails, seat } = getStatsForContext(ctx);
    const { names } = ctx;
    const roundName = round => round.team === null ? 'Unscored' : `${names[round.team]} #${round.score}`;
    const filters = $('stats-rounds');
    filters.replaceChildren();
    for (const [index, label] of ['ALL', ...rounds.map(roundName)].entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      const team = rounds[index - 1]?.team;
      if (team != null) button.dataset.team = team;
      button.onclick = () => { ctx.round = index - 1; updateLog(); };
      filters.append(button);
    }
    const map = $('stats-map'), detail = $('stats-map-detail'), log = $('stats-events');
    // Crop the rink's vertical gutter while keeping marks and trails in field coordinates.
    const mapTop = (P.rink.top + P.rink.bottom - map.height) / 2;
    const highlights = $('stats-highlights');
    const g = map.getContext('2d');
    const { home, away, text } = getThemeColors();
    const rows = new Map();
    const portraits = ctx.portraits ??= teamEntries.slice(0, 6).map(entry => {
      const svg = new XMLSerializer().serializeToString(ubuRender(entry.model));
      return `data:image/svg+xml,${encodeURIComponent(svg)}`;
    });
    function pill(index) {
      const player = document.createElement('span'), image = document.createElement('img');
      player.className = 'stats-player';
      player.dataset.team = index < 3 ? 0 : 1;
      image.alt = '';
      image.src = portraits[index];
      player.append(image, teamEntries[index].model.parts.fullName);
      return player;
    }
    let visible, shown, hovered = null, preview = [], marked = [];
    ctx.pinned ??= [];
    const active = event => ctx.round == null || ctx.round < 0 || event.round === ctx.round;
    const radius = event => event.type === 'Goal' ? 11 : statsMajor.has(event.type) ? 8 : 4;
    function drawMap() {
      g.resetTransform();
      g.clearRect(0, 0, map.width, map.height);
      g.translate(0, -mapTop);
      drawRinkSurface(g, themeColors);
      if (marked.length || ctx.ballTrail || ctx.ubuTrails) {
        g.save();
        if (seat) g.transform(-1, 0, 0, -1, map.width, P.rink.top + P.rink.bottom);
        g.lineCap = g.lineJoin = 'round';
        for (let i = 0; i < 7; i++) {
          if (i === 6 ? !ctx.ballTrail : !ctx.ubuTrails) continue;
          g.strokeStyle = i === 6 ? text : ((i < 3) !== Boolean(seat) ? home : away);
          g.globalAlpha = i === 6 ? 0.8 : 0.45;
          g.lineWidth = i === 6 ? 3 : 2;
          g.beginPath();
          for (const trail of trails) {
            if (!active(trail)) continue;
            const { samples } = trail, start = i * 2;
            g.moveTo(samples[start], samples[start + 1]);
            for (let n = start + 14; n < samples.length; n += 14) g.lineTo(samples[n], samples[n + 1]);
          }
          g.stroke();
        }
        for (const event of marked) {
          if (!event.path) continue;
          const { from, to } = event.path;
          g.strokeStyle = event.team === 0 ? home : away;
          g.globalAlpha = 1;
          g.lineWidth = 4;
          g.beginPath();
          for (let i = from.turnIndex; i <= to.turnIndex; i++) {
            const { startTick, endTick, samples } = trails[i];
            if (i === from.turnIndex) g.moveTo(from.x, from.y);
            else g.moveTo(samples[12], samples[13]);
            for (let n = 26, k = 1; n < samples.length; n += 14, k++) {
              const tick = Math.min(endTick, startTick + k * 8);
              if (tick > from.tick && tick < to.tick) g.lineTo(samples[n], samples[n + 1]);
            }
            if (i === to.turnIndex) g.lineTo(to.x, to.y);
          }
          g.stroke();
          g.fillStyle = g.strokeStyle;
          g.beginPath();
          g.arc(to.x, to.y, 3, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      }
      for (const layer of [shown.filter(event => !active(event)), visible.filter(event => !statsMajor.has(event.type)), visible.filter(event => statsMajor.has(event.type))]) {
        for (const event of layer) {
          g.globalAlpha = !active(event) ? 0.13 : statsMajor.has(event.type) ? 1 : 0.65;
          g.fillStyle = event.team === 0 ? home : away;
          g.beginPath();
          g.arc(event.x, event.y, radius(event), 0, Math.PI * 2);
          g.fill();
          if (statsMajor.has(event.type)) {
            g.strokeStyle = text;
            g.lineWidth = event.type === 'Goal' ? 4 : 2;
            g.stroke();
          }
        }
      }
      g.globalAlpha = 1;
      for (const event of marked) {
        g.strokeStyle = text;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(event.x, event.y, radius(event) + 6, 0, Math.PI * 2);
        g.stroke();
      }
    }
    function updateMarks() {
      for (const event of marked) rows.get(event)?.classList.remove('highlighted');
      marked = [...new Set([...ctx.pinned, ...preview])];
      for (const event of marked) rows.get(event)?.classList.add('highlighted');
      drawMap();
    }
    function pin(events) {
      const same = events.length === ctx.pinned.length && events.every((event, i) => event === ctx.pinned[i]);
      ctx.pinned = same ? [] : events;
      updateMarks();
    }
    function updateLog() {
      [...filters.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i - 1 === (ctx.round ?? -1))));
      highlights.setAttribute('aria-pressed', String(Boolean(ctx.highlights)));
      highlights.textContent = ctx.highlights ? 'Highlights only' : 'All events';
      shown = ctx.highlights ? events.filter(event => statsMajor.has(event.type)) : events;
      visible = shown.filter(active);
      ctx.pinned = ctx.pinned.filter(event => visible.includes(event));
      preview = [];
      hovered = null;
      detail.textContent = 'Hover to preview. Click to pin or unpin.';
      rows.clear();
      const content = document.createDocumentFragment();
      if (!visible.length) {
        const empty = document.createElement('p');
        empty.textContent = ctx.type === 'pause' && !events.length ? 'Events appear here after the first completed turn.' : 'No events in this selection.';
        content.append(empty);
      }
      let currentRound = -1, list;
      for (const event of visible) {
        if (event.round !== currentRound) {
          currentRound = event.round;
          const heading = document.createElement('h3');
          heading.textContent = roundName(rounds[currentRound]);
          list = document.createElement('ol');
          list.className = 'stats-events';
          content.append(heading, list);
        }
        const row = document.createElement('li'), time = document.createElement(ctx.theater ? 'button' : 'span');
        row.classList.toggle('major', statsMajor.has(event.type));
        row.tabIndex = 0;
        const markRow = () => { preview = [event]; updateMarks(); };
        const unmarkRow = () => {
          if (preview[0] === event) { preview = []; updateMarks(); }
        };
        row.onpointerenter = markRow;
        row.onpointerleave = () => { if (!row.contains(document.activeElement)) unmarkRow(); };
        row.addEventListener('focusin', markRow);
        row.addEventListener('focusout', focus => {
          if (!row.contains(focus.relatedTarget) && !row.matches(':hover')) unmarkRow();
        });
        row.onclick = click => {
          if (!click.target.closest('button')) pin([event]);
        };
        row.onkeydown = key => {
          if (key.target === row && (key.key === 'Enter' || key.key === ' ')) {
            key.preventDefault();
            pin([event]);
          }
        };
        time.className = 'stats-event-time';
        time.textContent = statsEventTime(event);
        if (ctx.theater) {
          time.type = 'button';
          time.onclick = () => {
            const th = ctx.theater;
            $('stats-dialog').close();
            th.paused = true;
            seekReplay(event.tick, th, event.turnIndex);
          };
        }
        const entry = document.createElement('span');
        entry.className = 'stats-event-entry';
        entry.append(statsEventLabel(event), event.actor === null ? document.createElement('span') : pill(event.actor));
        if (event.actor === null) entry.lastChild.textContent = names[event.team];
        if (event.target != null) entry.append('→', pill(event.target));
        row.append(time, entry);
        rows.set(event, row);
        list.append(row);
      }
      log.replaceChildren(content);
      log.scrollTop = 0;
      updateMarks();
    }
    function inspectMark(pointer) {
      const rect = map.getBoundingClientRect();
      const x = (pointer.clientX - rect.left) * map.width / rect.width;
      const y = mapTop + (pointer.clientY - rect.top) * map.height / rect.height;
      const hitRadius = 12 * map.width / rect.width;
      let closest = null, distance = hitRadius;
      for (const event of visible) {
        const gap = Math.hypot(event.x - x, event.y - y);
        if (gap <= distance) { closest = event; distance = gap; }
      }
      if (closest !== hovered || pointer.type === 'click') {
        hovered = closest;
        preview = closest ? visible.filter(event =>
          Math.hypot(event.x - closest.x, event.y - closest.y) <= radius(event) + radius(closest)
        ) : [];
        detail.textContent = preview.length ? preview.map(event => `${statsEventText(event, names)} · ${statsEventTime(event)}`).join('\n') : 'Hover to preview. Click to pin or unpin.';
        if (pointer.type === 'click') {
          pin(preview);
          const row = rows.get(preview[0]);
          if (row) {
            const viewport = log.getBoundingClientRect(), bounds = row.getBoundingClientRect();
            log.scrollTo({ top: log.scrollTop + bounds.top - viewport.top - (log.clientHeight - bounds.height) / 2, behavior: 'smooth' });
          }
        } else {
          updateMarks();
        }
      }
    }
    map.onpointermove = inspectMark;
    map.onclick = inspectMark;
    map.onpointerleave = () => {
      hovered = null;
      preview = [];
      updateMarks();
      detail.textContent = 'Hover to preview. Click to pin or unpin.';
    };
    highlights.onclick = () => { ctx.highlights = !ctx.highlights; updateLog(); };
    for (const [id, key, label] of [['stats-ball-trail', 'ballTrail', 'ball trail'], ['stats-ubu-trails', 'ubuTrails', 'ubu trails']]) {
      const button = $(id);
      const update = () => {
        button.setAttribute('aria-pressed', String(Boolean(ctx[key])));
        button.textContent = `${ctx[key] ? 'Hide' : 'Show'} ${label}`;
      };
      update();
      button.onclick = () => {
        ctx[key] = !ctx[key];
        update();
        drawMap();
      };
    }
    updateLog();
  }
  $('stats-box-tab').onclick = () => { activeStatsContext.tab = 'box'; showStatsTab(activeStatsContext); };
  $('stats-log-tab').onclick = () => { activeStatsContext.tab = 'log'; showStatsTab(activeStatsContext); };
  function renderStats(ctx = activeStatsContext) {
    if (!ctx) return;
    activeStatsContext = ctx;
    updateStatsRinkWidth();

    const s = getStatsForContext(ctx);
    const isGame = ctx.type === 'game';
    const names = [$('home-label').textContent, $('opponent-label').textContent];
    ctx.names = names;
    showStatsTab(ctx);

    $('stats-title').textContent = 'Game stats';
    $('stats-watch-replay').hidden = !isGame;

    const honoursEl = $('stats-honours');
    if (isGame) {
      const { tally: t, scores: sc } = viewTally();
      const w = sc[0] > sc[1] ? 0 : 1;
      const h = ububallMatch.honours(t, sc, w);
      honoursEl.textContent = [h.comeback && 'Comeback from 3 down!', h.shutout && 'Shutout!'].filter(Boolean).join(' ');
      honoursEl.hidden = !honoursEl.textContent;
    } else {
      honoursEl.textContent = '';
      honoursEl.hidden = true;
    }

    let winner = null;
    if (isGame) {
      winner = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : null;
    } else if (ctx.theater?.replay?.final) {
      const fin = ctx.theater.replay.final;
      winner = ctx.theater.seat ? 1 - fin.winner : fin.winner;
    } else {
      winner = scores[0] > scores[1] ? 0 : scores[1] > scores[0] ? 1 : null;
    }

    const rating = i => s.goals[i] * 3 + s.assists[i] * 2 + s.saves[i] * 2 + (s.bigSaves?.[i] || 0) + (s.checks?.[i] || 0) * 0.5 + (s.topShot?.[i] || 0) / 10000;
    const mvp = [0, 1, 2, 3, 4, 5].reduce((best, i) => rating(i) > rating(best) ? i : best, 0);
    const hasMvp = rating(mvp) > 0;

    const table = document.createElement('table'), head = table.createTHead().insertRow();
    const headers = ['', 'Ubu', 'Goals', 'Assists', 'Shots', 'Saves', 'Checks', 'Touches', 'Passes', 'Top shot', 'Distance', 'Fouls'];
    for (const label of headers) {
      const th = document.createElement('th');
      th.textContent = label;
      head.append(th);
    }

    const rows = table.createTBody();
    teamEntries.slice(0, 6).forEach((entry, i) => {
      const team = i < 3 ? 0 : 1;
      const isWinner = winner !== null && team === winner;
      const row = rows.insertRow();
      row.className = `team-${team}`;

      const trophyCell = row.insertCell();
      trophyCell.className = `col-trophy${isWinner ? ` team-${team}-win` : ''}`;
      if (isWinner) trophyCell.append(gameUi.icon('trophy'));

      const nameCell = row.insertCell();
      nameCell.className = `col-name team-${team}`;
      const nameSpan = document.createElement('span');
      nameSpan.className = 'ubu-name';
      nameSpan.textContent = entry.model.parts.fullName;
      nameCell.append(nameSpan);
      if (hasMvp && i === mvp) {
        const badge = document.createElement('span');
        badge.className = 'mvp-badge';
        badge.textContent = 'MVP';
        nameCell.append(' ', badge);
      }

      const values = [
        s.goals[i],
        s.assists[i],
        s.shots?.[i] || 0,
        s.saves[i],
        s.checks?.[i] || 0,
        s.touches[i],
        s.passes[i],
        s.topShot[i] ? Math.round(s.topShot[i]) : '–',
        (s.skated[i] / 880).toFixed(1),
        s.cards[i]
      ];
      for (const val of values) {
        row.insertCell().textContent = val;
      }
    });
    $('stats-table').replaceChildren(table);

    const totalControl = s.control[0] + s.control[1] || 1;
    $('stats-control').replaceChildren(...[0, 1].map(team => {
      const part = document.createElement('span');
      part.className = team ? 'away' : 'home';
      part.style.flexGrow = String(s.control[team] || 0.001);
      part.textContent = `${names[team]} ${Math.round(s.control[team] / totalControl * 100)}%`;
      return part;
    }));

    const totalSide = s.side[0] + s.side[1] || 1;
    $('stats-side').replaceChildren(...[0, 1].map(team => {
      const part = document.createElement('span');
      part.className = team ? 'away' : 'home';
      part.style.flexGrow = String(s.side[team] || 0.001);
      part.textContent = `${names[team]} ${Math.round(s.side[team] / totalSide * 100)}%`;
      return part;
    }));

    $('stats-note').textContent = "Top shot is the ball speed off that ubu's fastest touch. Distance is in rink lengths. Shots include goals, saved attempts and high-power strikes off the post. Checks are hard hits inflicting daze or stuns. Fouls are yellow cards.";

    const actionsEl = $('stats-actions');
    if (isGame) {
      actionsEl.hidden = false;
      if (online?.active) {
        $('stats-play-again').hidden = true;
        $('stats-rematch').hidden = false;
        $('stats-leave').hidden = false;
        updateRematch(online.state);
      } else {
        $('stats-play-again').hidden = false;
        $('stats-rematch').hidden = true;
        $('stats-leave').hidden = false;
        $('stats-rematch-status').textContent = '';
      }
    } else {
      actionsEl.hidden = true;
      $('stats-rematch-status').textContent = '';
    }
  }
  function openMatchStats(type) {
    if (type === 'replay') {
      const th = theater;
      if (!th || th.exporting) return;
      th.paused = true;
      th.steps = 0;
      updateReplayBar();
      renderStats({ type: 'replay', theater: th });
    } else {
      const replay = type === 'pause' && phase !== 'over' ? recording : lastCompletedReplay;
      renderStats({ type, replay });
    }
    if (!$('stats-dialog').open) $('stats-dialog').showModal();
  }
  function openStats() {
    openMatchStats('replay');
  }
  $('replay-stats').onclick = openStats;
  $('stats-close').onclick = () => $('stats-dialog').close();
  $('stats-watch-replay').onclick = async () => {
    const id = await lastSaved;
    if (id) {
      closeSummary();
      openReplay(id);
    }
  };
  $('stats-play-again').onclick = () => {
    closeSummary();
    newMatch(true);
  };
  $('stats-rematch').onclick = () => {
    if (online?.active) online.rematch();
  };
  $('stats-leave').onclick = () => {
    closeSummary();
    if (online?.active) {
      $('online-leave').click();
    } else {
      exitMatchMode();
      if (history.state?.match) history.back();
    }
  };
  addEventListener('resize', updateStatsRinkWidth);
  $('replay-exit').onclick = () => { exitMatchMode(); if (history.state?.match) history.back(); };
  // Space plays and pauses and the arrows step by turn, unless a control has focus.
  document.addEventListener('keydown', event => {
    if (!theater || document.querySelector('dialog[open]') || event.target.closest?.('button, input, select, textarea')) return;
    const button = { ' ': 'replay-play', ArrowLeft: 'replay-prev', ArrowRight: 'replay-next' }[event.key];
    if (button) { event.preventDefault(); $(button).click(); }
  });
  // A file name from the replay's name, or the time it was recorded.
  function replayFileName(recorded, title = null) {
    const d = new Date(recorded), two = n => String(n).padStart(2, '0');
    return title?.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) ||
      `ububall-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
  }
  function downloadReplay(file, recorded, title = null) {
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([file], { type: 'application/gzip' })), download: `${replayFileName(recorded, title)}.ububall` });
    link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  async function openReplay(id) {
    if (online?.active) { replaysNote('Leave your online match to watch a replay.'); return; }
    if (matchInProgress() && !theater && !await gameUi.confirm({ title: 'Watch replay?', message: 'Watching a replay ends your current match.', confirmLabel: 'Watch replay' })) return;
    try {
      const entry = await replayStore.get(id), replay = await ububallReplay.read(entry.file);
      if ($('replays-dialog').open) $('replays-dialog').close();
      watchReplay(replay, entry.file);
    } catch (error) { replaysNote(error.message); }
  }
  // Tabler outline icons (MIT), as in uburoom web/icons.js.
  const ICONS = {
    play: ['M7 4v16l13 -8l-13 -8'],
    edit: ['M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1', 'M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415', 'M16 5l3 3'],
    download: ['M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2', 'M7 11l5 5l5 -5', 'M12 4l0 12'],
    trash: ['M4 7l16 0', 'M10 11l0 6', 'M14 11l0 6', 'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12', 'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3'],
    undo: ['M9 14l-4 -4l4 -4', 'M5 10h11a4 4 0 1 1 0 8h-1'],
    pin: ['M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4', 'M9 15l-4.5 4.5', 'M14.5 4l5.5 5.5']
  };
  function iconButton(name, label, run, className = 'icon-button') {
    const button = document.createElement('button'); button.type = 'button'; button.className = className; button.title = label;
    button.setAttribute('aria-label', label); button.onclick = run;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name]) { const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path); }
    button.append(svg);
    return button;
  }
  // Deleted entries, newest last, for undo while the library stays open.
  const deletedReplays = [];
  // Renaming rewrites the file too, so an export carries the name.
  async function renameReplay(entry, title) {
    const replay = await ububallReplay.read(entry.file);
    await replayStore.put({ ...entry, title, file: await ububallReplay.write({ ...replay, title }) });
  }
  // The library: pinned first, then newest first. Replays from another physics or file version can
  // never play again (see P.VERSION), so they are removed.
  async function openReplays() {
    deletedReplays.length = 0; replaysNote();
    if (!$('replays-dialog').open) $('replays-dialog').showModal();
    await listReplays();
  }
  // The note under the title, or a problem in its place.
  function replaysNote(problem = '') {
    $('replays-note').textContent = problem || `Your latest ${ububallReplay.KEEP} matches are kept automatically. Pinned and imported replays stay until you delete them.`;
    $('replays-note').classList.toggle('problem', Boolean(problem));
  }
  async function listReplays(problem = '') {
    const list = $('replays-list');
    let entries;
    try { entries = await replayStore.all(); } catch { replaysNote('Replays cannot be saved in this browser.'); return; }
    const stale = entries.filter(e => e.physics !== P.VERSION || e.format !== ububallReplay.FORMAT);
    await Promise.all(stale.map(e => replayStore.remove(e.id)));
    entries = entries.filter(e => !stale.includes(e)).sort((a, b) => b.pinned - a.pinned || b.id - a.id);
    replaysNote(problem);
    const undo = $('replays-undo'), last = deletedReplays.at(-1);
    undo.classList.toggle('idle', !last);
    if (last) undo.querySelector('span').textContent = last.title ? `Deleted “${last.title}”.` : `Deleted a ${last.clip ? 'clip' : 'replay'}.`;
    const empty = Object.assign(document.createElement('li'), { className: 'replays-empty', textContent: 'No replays yet. Matches are saved here automatically.' });
    list.replaceChildren(...(entries.length ? entries.map(replayItem) : [empty]));
  }
  function replayItem(e) {
    const names = e.seat ? [...e.names].reverse() : e.names, sc = e.seat ? [...e.scores].reverse() : e.scores, score = `${names[0]} ${sc[0]}–${sc[1]} ${names[1]}`;
    const item = document.createElement('li'), heading = document.createElement('div'), name = document.createElement('strong'), meta = document.createElement('small');
    item.classList.toggle('pinned', Boolean(e.pinned));
    heading.className = 'replay-heading'; name.textContent = e.title || score;
    meta.textContent = [e.title && score, e.clip ? 'Clip' : ububallMatch.modeName(e.mode), new Date(e.recorded).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
      `${e.turns} turn${e.turns === 1 ? '' : 's'}`, !e.clip && !e.final && 'Unfinished'].filter(Boolean).join(' · ');
    const pin = iconButton('pin', e.pinned ? 'Unpin' : 'Pin', async () => { await replayStore.put({ ...e, pinned: !e.pinned }); listReplays(); });
    pin.setAttribute('aria-pressed', String(Boolean(e.pinned)));
    const rename = () => {
      const input = Object.assign(document.createElement('input'), { value: e.title || '', maxLength: ububallReplay.MAX_TITLE, placeholder: score, className: 'replay-name' });
      input.setAttribute('aria-label', 'Replay name');
      heading.replaceWith(input); input.focus(); input.select();
      let done = false;
      const finish = async save => {
        if (done) return;
        done = true;
        const title = input.value.trim() || null;
        let message = '';
        try { if (save && title !== e.title) await renameReplay(e, title); } catch (error) { message = error.message; }
        listReplays(message);
      };
      input.onkeydown = event => {
        if (event.key === 'Enter') finish(true);
        else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      };
      input.onblur = () => finish(true);
    };
    // Watch leads the row; the name carries its own small rename button.
    heading.append(name, iconButton('edit', 'Rename', rename, 'icon-button replay-rename'));
    const actions = document.createElement('div'); actions.className = 'replay-actions';
    actions.append(pin, iconButton('download', 'Export .ububall', () => downloadReplay(e.file, e.recorded, e.title)),
      iconButton('trash', 'Delete', async () => { await replayStore.remove(e.id); deletedReplays.push(e); listReplays(); }));
    item.append(iconButton('play', 'Watch', () => openReplay(e.id), 'icon-button primary replay-watch'), heading, meta, actions);
    return item;
  }
  $('replays-undo').append(iconButton('undo', 'Undo delete', async () => {
    const entry = deletedReplays.pop();
    if (entry) await replayStore.put(entry);
    listReplays();
  }, 'quiet'));
  $('replays-undo').lastChild.append('Undo');
  // Imported replays are checked like any other and stay until deleted.
  $('replays-import').onchange = async event => {
    const files = [...event.target.files], problems = [];
    event.target.value = '';
    for (const file of files) {
      try {
        if (file.size > 8 << 20) throw new Error('This replay is too large.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        await replayStore.add(libraryEntry(await ububallReplay.read(bytes), bytes, false));
      } catch (error) { problems.push(`${file.name}: ${error.message}`); }
    }
    listReplays(problems.join(' '));
  };
  $('replays-open').onclick = openReplays;
  $('replays-close').onclick = () => $('replays-dialog').close();
  function finishTurn(goal) {
    const ticks = Math.round(elapsed / P.DT);
    if (playSegments.length) playSegments[playSegments.length - 1].ticks = ticks;
    // A goal on the round's first turn is an ace, earning its scorer extra meter (not for an own goal).
    const ace = goal !== null && !roundTurns, call = goal === null ? null : ububallMatch.callGoal(simBodies, play, tally, goal, ace);
    if (goal !== null && ballOnFire()) lightNet(goal); else quench();
    const before = trailPositions();
    ububallMatch.finishTurn(P, simBodies, stats, scores, goal, matchMode, { ace: ace && !call.own ? call.scorer : null, assist: call?.assist ?? null, keepMotion: goal !== null }, fouls, tally);
    syncViewBodies(simBodies, 0);
    clearDiscontinuousTrails(before);
    if (fouls.faceoff) play = ububallMatch.newPlay();
    noteTurn(ticks, goal === null ? null : { team: goal, label: call.label, scorer: call.own ? null : call.scorer, assist: call.assist }, fouls.cards);
    announceFouls();
    if (goal !== null) ububallMatch.noteScore(tally, scores);
    roundTurns++;
    matchTicks += ticks;
    bodies.slice(0, 6).forEach(b => dirtyMeters.add(b));
    accumulator = 0; layoutDirty = true;
    if (goal !== null) {
      const celebSim = structuredClone(simBodies);
      P.stop(simBodies);
      authoritativeBodies = structuredClone(simBodies);
      phase = scores[goal] >= 5 ? 'over' : 'goal';
      celebrate(goal, bodies[6], call.label, call.own ? null : bodies[call.scorer] || null);
      if (call.assist !== null) popup(bodies[call.assist], 'Assist');
      if (phase === 'over') {
        queueSummary();
        if (recording) { recording.final = { scores: [...scores], winner: goal }; saveRecording(); }
        clearActiveMatch();
      }
      const scorer = bodies[call.scorer] || bodies.slice(goal * 3, goal * 3 + 3)[0];
      goalReplayAt = performance.now() + ububallMatch.GOAL_REPLAY_DELAY + 800;
      postGoal = { ticks: 0, sim: celebSim };
      scoringPlayer = scorer;
      const scorerName = scorer?.name || (goal === 0 ? 'Your ubu' : 'CPU ubu');
      goalTab(goal, call.label, call.own ? null : scorerName);
      say(phase === 'over'
        ? (goal === 0 ? `You win! ${callText(call.label, scorerName)}${honourText(0)} Start a new match for a rematch.` : `CPU wins. ${callText(call.label, scorerName)}${honourText(1)} Start a new match to try again.`)
        : `${goal === 0 ? 'You score!' : 'CPU scores.'} ${callText(call.label, scorerName)} Ready for the next kickoff.`
      );
      loopFanfare(scorer?.voice);
      sync();
      if (phase === 'goal') { $('launch').disabled = false; $('launch').textContent = 'Next kickoff'; }
    } else {
      turn++; phase = 'plan'; resetPlans(true);
      saveActiveMatch();
      say(foulText() || (pulseMode() && !P.settled(simBodies) ? 'Pulse paused. Adjust your launches or guard to brake.' : 'Field settled. Plan your next three launches.'));
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
      openSetup('mode'); return;
    }
    gameAudio()?.getAudioContext();
    if (phase === 'goal') {
      if (postGoal) { if (postGoal.sim) P.stop(postGoal.sim); P.stop(bodies); postGoal = null; }
      stopFanfare(); gameAudio()?.stop();
      endGoalReplay();
      bodies = kickoff(); turn++; phase = 'plan'; resetPlans(); say('Kickoff. Plan your next three launches.');
      saveActiveMatch();
      draw(); return;
    }
    if (phase !== 'plan') return;
    const generation = cpuGeneration;
    phase = 'cpu-wait'; drag = null; sync(); say('CPU is finishing its plan…');
    await cpuReady;
    if (generation !== cpuGeneration || phase !== 'cpu-wait' || online?.active) return;
    if ($('field-spin').contains(document.activeElement)) document.activeElement.blur();
    gameAudio()?.stop();
    drag = null;
    const turnPlans = [...plans.map((p, i) => ({ ...p, superArm: Boolean(bodies[i]?.superArm || p.superArm) })), ...cpu];
    bodies.slice(0, 3).forEach(b => { b.superArm = false; });
    recordSegment(simBodies, turnPlans); beginGuide(simBodies, turnPlans, 0);
    if (recording) ububallReplay.addTurn(recording, { turn, scores, fouls, bodies: simBodies, plans: turnPlans });
    saveActiveMatch({ bodies: simBodies, turnPlans });
    P.startTurn(simBodies, turnPlans, liveFx.super);
    syncViewBodies(simBodies, 0);
    elapsed = accumulator = 0; phase = 'play'; sync(); say('Turn in motion…');
    if (!demo) banner('Launch!', 800, 'launch');
  };
  for (const [id, key, scale] of [['shot-spin', 'spin', .01]]) {
    $(id).oninput = () => {
      if (phase !== 'plan' || bodies[selected].stunned) return;
      plans[selected][key] = Number($(id).value) * scale; plans[selected].guard = false;
      sync(); draw();
      saveActiveMatch();
    };
  }
  for (const [id, delta] of [['spin-less', -.1], ['spin-more', .1]]) {
    $(id).onclick = () => {
      if (phase !== 'plan' || bodies[selected].stunned) return;
      plans[selected].spin = Math.max(-1, Math.min(1, Math.round(((plans[selected].spin || 0) + delta) * 10) / 10)); plans[selected].guard = false;
      sync(); draw();
      saveActiveMatch();
    };
  }
  // Guarding replaces the launch and brakes the ubu. The arrow stays (faded), so clearing guard
  // brings the launch back.
  function toggleGuard(i) {
    if (phase !== 'plan' || bodies[i].stunned) return;
    plans[i] = { ...plans[i], guard: !plans[i].guard };
    sync(); draw();
    saveActiveMatch();
  }
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
  let tapGuards = false;
  canvas.onpointerdown = event => {
    gameAudio()?.getAudioContext();
    // A warning's explanation opens on a tap; a tap elsewhere only closes it.
    const warning = warningAt(point(event));
    if (warning) { openFoulInfo(warning); return; }
    if (foulInfo) { closeFoulInfo(); return; }
    if (phase !== 'plan') return;
    const p = point(event);
    const target = fieldTarget(event);
    if (target.index < 0) return;
    // Only a tap on the ubu that is already selected toggles guard, so selecting one never loses its arrow.
    tapGuards = selected === target.index;
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
      if (warningAt(p)) canvas.style.cursor = 'pointer';
      else if (phase === 'plan') {
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
    if (event.type === 'pointerup' && drag === event.pointerId && dragMode === 'aim' && !dragMoved && tapGuards) toggleGuard(selected);
    arrowGrab = null;
    drag = null;
    dragMode = null;
    if (phase === 'plan') saveActiveMatch();
    draw();
  };
  function handleCollision(a, b, speed, impulse, plow = false, iron = false) {
    if (iron) {
      if (a?.guarding) a.ironGuard = true;
      if (b?.guarding) b.ironGuard = true;
    }
    if (speed < 15) return;
    const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const x = a.x + (b.x - a.x) * a.radius / distance, y = a.y + (b.y - a.y) * a.radius / distance;
    const tangent = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    burst(x, y, a.team, Math.min(1, speed / 600), false, tangent);
    if (a.team !== b.team) burst(x, y, b.team, Math.min(1, speed / 600), false, tangent);
    if (plow) flames(x, y, 40, (b.vx || a.vx) * 0.1, (b.vy || a.vy) * 0.1, 15);
    const isBall = a.team === -1 || b.team === -1;
    const now = clockNow();
    if (!plow) contactMeter(a, b, speed);
    if (isBall) {
      const player = a.team !== -1 ? a : b;
      const norm = Math.min(1.0, Math.max(0.0, (speed - 25) / 550));
      const volume = Math.min(1.0, 0.15 + 0.85 * (norm ** 0.8));
      if (!player._lastHitSound || (now - player._lastHitSound) > 55) {
        player._lastHitSound = now;
        if (player.voice && gameAudio()) {
          gameAudio().playCollision(player.voice, { volume });
        }
        if (gameAudio()) {
          gameAudio().playBallHit({ volume });
        }
      }
    } else if (a.team !== -1 && b.team !== -1) {
      const norm = Math.min(1.0, Math.max(0.0, (speed - 40) / 600));
      const volume = Math.min(1.0, 0.12 + 0.75 * (norm ** 0.8));
      const primary = (Math.hypot(a.vx, a.vy) * a.mass >= Math.hypot(b.vx, b.vy) * b.mass) ? a : b;
      if (primary.voice && gameAudio()) {
        if (!primary._lastHitSound || (now - primary._lastHitSound) > 65) {
          primary._lastHitSound = now;
          gameAudio().playCollision(primary.voice, { volume });
        }
      }
    }
  }
  function handleWall(body, velocity, wallType, nx, ny) {
    if (velocity < 20) return;
    addWallEffect(body, velocity, wallType, nx, ny);
    const now = clockNow();
    if (body._lastWallSound && (now - body._lastWallSound) < 60) return;
    body._lastWallSound = now;
    burst(body.x + nx * body.radius, body.y + ny * body.radius, body.team,
      Math.min(1, velocity / 500), false, Math.atan2(ny, nx) + Math.PI / 2);
    const norm = Math.min(1.0, Math.max(0.0, (velocity - 20) / 480));
    const volume = Math.min(1.0, 0.15 + 0.85 * (norm ** 0.8));
    if (!gameAudio()) return;
    if (wallType === 'post') {
      gameAudio().playGoalHit('post', { volume: Math.min(1.0, volume * 1.1) });
    } else if (wallType === 'net') {
      gameAudio().playGoalHit('net', { volume });
    } else {
      gameAudio().playWallHit({ volume });
    }
  }
  let superImpactTimes = new WeakMap();
  function handleSuper(key, phase, body, target = null) {
    // Sustained contact can resolve repeatedly within one animation frame.
    if (key === 'stalwart' && phase === 'impact') {
      const now = clockNow();
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
        if (key === 'cannonball') ballFlare = 1;
        burst(x, y, body.team, 3.5, false, tangent, color);
        if (shockwaves.length < 32) shockwaves.push({ x, y, currentRadius: 4,
          maxRadius: key === 'cannonball' ? 48 : 36, team: body.team, color, life: .24, duration: .24 });
      }
    }
    gameAudio()?.playSuper?.(key, phase);
  }
  function handleShockwave(source, radius, type = null) {
    if (type === 'iron') {
      burst(source.x, source.y, source.team, 0.7, false, 0, '#ffffff');
      burst(source.x, source.y, source.team, 0.7, false, 0, '#d2f2ff');
      shockwaves.push({ x: source.x, y: source.y, currentRadius: 8, maxRadius: radius, team: source.team, color: '#e3faff', life: 0.25, duration: 0.25 });
      return;
    }
    burst(source.x, source.y, source.team, 1, false, 0, '#ff7197');
    burst(source.x, source.y, source.team, 1, false, 0, '#9d467a');
    shockwaves.push({ x: source.x, y: source.y, currentRadius: 10, maxRadius: radius, team: source.team, color: '#ff7197', life: 0.35, duration: 0.35 });
    shockwaves.push({ x: source.x, y: source.y, currentRadius: 6, maxRadius: radius * 0.88, team: source.team, color: '#9d467a', life: 0.30, duration: 0.30 });
    if (gameAudio()) {
      gameAudio().playSuper?.('shockwave', 'impact', { volume: 0.8 });
    }
  }
  const liveSim = () => postGoal?.sim ?? simBodies;
  const liveView = cb => toViewBody(cb, liveSim(), 0);
  const syncLive = () => syncViewBodies(liveSim(), 0);
  const liveFx = {
    collide: (a, b, speed, impulse, plow = false, iron = false) => { syncLive(); handleCollision(liveView(a), liveView(b), speed, impulse, plow, iron); },
    wall: (body, velocity, wallType, nx, ny) => { syncLive(); handleWall(liveView(body), velocity, wallType, nx, ny); },
    shockwave: (source, radius, type = null) => { syncLive(); handleShockwave(liveView(source), radius, type); },
    super: (key, stage, body, target = null) => { syncLive(); handleSuper(key, stage, liveView(body), target ? liveView(target) : null); }
  };
  // Hit-stop: play freezes for the tick's earned ms (see ububallMatch.HIT_STOP), and the rink gives
  // a tiny shake (or double shake for a scored goal).
  function impact(ms, shakeLevel = (ububallMatch.SCREEN_SHAKE?.default ?? 1)) {
    hitStopUntil = clockNow() + ms;
    if (!reducedMotion.matches) shake = shakeLevel;
  }
  function frame(time) {
    const delta = lastTime ? Math.max(0, (time - lastTime) / 1000) : 0; lastTime = time;
    // An open foul explanation holds local play (and the demo) still while it is read.
    const active = !$('roster-dialog').open && !$('pause-menu').open && !document.hidden && !(foulInfo && !online?.active);
    updateClock();
    if (online?.active) {
      if (phase === 'plan') online.send(networkMoves());
      if (goalReplay) { if (active) advanceGoalReplay(delta); }
      else if (onlineReplay && active) playOnlineReplay();
    } else if (blitzMode() && phase === 'plan' && performance.now() >= planDeadline) $('launch').click();
    if (goalReplayAt && performance.now() >= goalReplayAt) {
      goalReplayAt = 0;
      // The winner is announced once the goal call has cleared (the demo does so after its replays).
      if (phase === 'over' && !demo && !online?.active) banner(scores[0] > scores[1] ? 'You win!' : 'CPU wins!', 3500, scores[0] > scores[1] ? 'home' : 'away');
      startGoalReplay();
    }
    if (!active) { lastTime = 0; accumulator = 0; }
    const hadEffects = particles.length || fireworks.length || trails.some(trail => trail.length) || shockwaves.length || goalCall ||
      ripples.length || pings.length || popups.length || kickoffGlow || goalSweep || danger[0] > .02 || danger[1] > .02;
    // Effects pause with the replay viewer, and in Pulse mode when time freezes between turns.
    const pulseFrozen = pulseMode() && roundTurns > 0 && (phase === 'plan' || phase === 'cpu-wait' || phase === 'waiting');
    const exporting = typeof isExporting === 'function' ? isExporting() : Boolean(theater?.exporting);
    let speed = 1;
    if (!active || clockNow() < hitStopUntil || pulseFrozen) speed = 0;
    else if (theater) speed = theater.paused || exporting ? 0 : theater.speed;
    else if (goalReplay) speed = goalReplay.played >= goalReplay.total ? 0.5 : ububallMatch.replaySpeed(goalReplay.total - goalReplay.played);
    else if (postGoal) speed = ububallMatch.postGoalSpeed(postGoal.ticks);
    const simDelta = delta * speed;
    if (active && !theater?.paused && !exporting) updatePopups(delta);
    if (active && !theater?.paused && !exporting && !pulseFrozen) updateEffects(simDelta);
    if (theater) { if (active && !exporting) advanceReplay(delta); }
    else if ((phase === 'play' || postGoal) && active && !online?.active) {
      if (clockNow() < hitStopUntil) accumulator = 0; else accumulator += simDelta;
      let steps = 0;
      while (steps++ < 48 && accumulator >= P.DT && (phase === 'play' || postGoal)) {
        if (postGoal) {
          const celeb = postGoal.sim || simBodies;
          elapsed += P.DT; accumulator -= P.DT;
          postGoal.ticks++;
          P.stepPostGoal(celeb, P.DT, liveFx.collide, liveFx.wall, liveFx.shockwave, liveFx.super);
          syncViewBodies(celeb, 0);
          traceGuide(celeb);
          recordTrails();
          if (P.settled(celeb.slice(0, 6))) { P.stop(celeb); syncViewBodies(celeb, 0); postGoal = null; break; }
        } else {
          const tick = ububallMatch.playTick(P, simBodies, play, liveFx, tally), { goal } = tick; elapsed += P.DT; accumulator -= P.DT;
          ububallMatch.lapseFouls(P, simBodies, fouls); traceGuide(simBodies);
          syncViewBodies(simBodies, 0);
          for (const save of tick.saves) creditSave(bodies[save.index], save.own, Boolean(save.iron));
          if (tick.struck) popup(bodies[6], 'Spin strike!');
          if (tick.stop) {
            impact(tick.stop, goal !== null ? (ububallMatch.SCREEN_SHAKE?.goal ?? 2) : (ububallMatch.SCREEN_SHAKE?.default ?? 1));
            accumulator = 0;
          }
          noteEvents(Math.round(elapsed / P.DT), tick.saves, tick.stop);
          recordTrails();
          if (goal !== null || P.settled(simBodies) || Math.round(elapsed / P.DT) >= ububallMatch.turnTicks(matchMode)) {
            finishTurn(goal);
            if (goal !== null) break;
          }
        }
      }
      if (phase === 'play' || postGoal) emitSkaterEffects(simDelta);
      draw();
    } else if (goalReplay && active && !online?.active) advanceGoalReplay(delta);
    else if (active && (hadEffects || (phase === 'plan' && predictionCache?.data?.goal !== null) || (!reducedMotion.matches && (foulsShowing() || bodies.some(b => b.meter >= 100 || b.superArm || b.superActive))))) draw();
    flushMeters();
    requestAnimationFrame(frame);
  }
  function resolveEquippedSuper(entry, slotIndex = 0) {
    if (!entry) return P.SUPERS[0];
    const id = entry.equippedSuper?.id ?? ((entry.model?.supers?.[0] ?? slotIndex) % 8);
    const mastery = P.superMastery(entry.model?.supers, id);
    return { ...P.SUPERS[id], ...mastery };
  }
  // The team screen: three positions in kickoff formation (Back by your goal, Top and Bottom
  // ahead), each with its ubu and equipped super. Picks fill empty positions in order; once the
  // team is full, a pick replaces the selected position and stays there.
  const POSITIONS = ['Back', 'Top', 'Bottom'];
  const canDrag = matchMedia('(pointer: fine)').matches;
  const node = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
  let changedSlot = -1, lobbyView = null, savedTeams = null, teamIndex = -1;
  const teamLocked = () => setupFor === 'lobby' && Boolean(lobbyView?.ready);
  const fixedTeam = () => setupFor === 'lobby' && Boolean(lobbyView?.practice);
  const setupClassic = () => ububallMatch.rule(setupFor === 'lobby' && lobbyView ? lobbyView.state.mode : chosenMode(), 'classic');
  const superBonus = s => s.copies > 1 ? ` (+${(s.bonusTicks / 240).toFixed(1)} s, +${s.bonusRefund}% meter refund)` : '';
  const nextEmpty = from => { for (let i = 1; i <= 3; i++) if (!draft[(from + i) % 3]) return (from + i) % 3; return from; };
  function changed(slot) { changedSlot = slot; rosterSlots(); }
  function swapSlots(a, b) {
    if (a === b || teamLocked() || fixedTeam()) return;
    [draft[a], draft[b]] = [draft[b], draft[a]]; rosterSlot = b; changed(b);
  }
  // A pick for a position: a teammate already elsewhere trades places with what is there.
  function place(entry, slot = rosterSlot) {
    if (teamLocked() || fixedTeam() || !entry) return;
    const other = draft.findIndex(d => d?.key === entry.key);
    if (other === slot) return;
    if (other >= 0) [draft[other], draft[slot]] = [draft[slot], draft[other]];
    else draft[slot] = entry;
    rosterSlot = draft.some(d => !d) ? nextEmpty(slot) : slot;
    changed(slot);
  }
  // A click on a teammate selects its position; any other ubu goes into the selected position.
  function choose(entry) {
    const other = draft.findIndex(d => d?.key === entry.key);
    if (other >= 0) { rosterSlot = other; rosterSlots(); }
    else place(entry);
  }
  function describe(key) {
    const at = draft.findIndex(d => d?.key === key), current = draft[rosterSlot];
    if (at >= 0) return { badge: POSITIONS[at] };
    if (teamLocked() || fixedTeam()) return { action: '' };
    return { action: current ? `Swap in for ${current.model.parts.fullName}` : `Put in ${POSITIONS[rosterSlot]}` };
  }
  function entryForKey(key) {
    if (key.startsWith('practice-')) return practice[Number(key.slice(9))];
    const item = ubuList.get(key);
    return item?.model ? entryFor(item) : null;
  }
  function slotView(entry, i, classic, locked, fixed) {
    const slot = node('div', { className: 'formation-slot' });
    slot.dataset.position = POSITIONS[i].toLowerCase();
    slot.classList.toggle('is-selected', i === rosterSlot);
    slot.classList.toggle('is-empty', !entry);
    slot.classList.toggle('just-changed', i === changedSlot);
    const pick = node('button', { type: 'button', className: 'formation-pick' }, node('span', { className: 'formation-pos', textContent: POSITIONS[i] }));
    if (entry) pick.append(ubuRender(entry.model, 'formation-art'), node('span', { className: 'formation-name' },
      node('strong', { textContent: entry.model.parts.fullName }), node('small', { textContent: entry.label })));
    else pick.append(node('span', { className: 'formation-art formation-empty-art' }), node('span', { className: 'formation-name' },
      node('strong', { textContent: 'Empty' }), node('small', { textContent: i === rosterSlot ? 'Pick an ubu below' : 'Select to fill' })));
    pick.setAttribute('aria-pressed', String(i === rosterSlot));
    pick.setAttribute('aria-label', `${POSITIONS[i]}: ${entry ? entry.model.parts.fullName : 'empty'}`);
    pick.onclick = () => { rosterSlot = i; rosterSlots(); };
    slot.append(pick);
    if (entry && !classic) {
      const current = resolveEquippedSuper(entry, i);
      const button = node('button', { type: 'button', className: 'formation-super', disabled: locked },
        node('img', { src: current.icon, alt: '' }), node('span', { textContent: current.displayName }), gameUi.icon('chevron-down'));
      button.dataset.tip = current.displayName + ': ' + current.desc + superBonus(current);
      button.setAttribute('aria-label', `Super for ${entry.model.parts.fullName}: ${current.displayName}. Change super`);
      // The super choices drop down from this button, for this position. Selection updates in
      // place, since rebuilding the cards would detach the button that opens the dropdown.
      gameUi.dropdown(button, $('roster-super'), { prepare: () => {
        if (rosterSlot !== i) {
          rosterSlot = i;
          [...$('roster-slots').children].forEach((card, at) => card.classList.toggle('is-selected', at === i));
          teamHint(setupClassic()); rosterList.render();
        }
        superChoices();
      } });
      slot.append(button);
    }
    const tools = node('span', { className: 'formation-tools' });
    if (!locked && !fixed && i !== rosterSlot && (entry || draft[rosterSlot])) {
      const swap = node('button', { type: 'button', className: 'formation-tool' }, gameUi.icon('arrows-left-right'));
      swap.setAttribute('aria-label', `Swap ${POSITIONS[i]} with ${POSITIONS[rosterSlot]}`);
      swap.dataset.tip = `Swap with ${POSITIONS[rosterSlot]}`;
      swap.onclick = () => swapSlots(i, rosterSlot);
      tools.append(swap);
    }
    if (entry && !locked && !fixed) {
      const clear = node('button', { type: 'button', className: 'formation-tool' }, gameUi.icon('x'));
      clear.setAttribute('aria-label', `Remove ${entry.model.parts.fullName} from ${POSITIONS[i]}`);
      clear.dataset.tip = 'Remove';
      clear.onclick = () => { draft[i] = null; rosterSlot = i; changed(i); };
      tools.append(clear);
    }
    slot.append(tools);
    // Desktop: drag ubus from the list onto a position, or positions onto each other.
    if (canDrag && !locked) {
      if (entry && !fixed) {
        pick.draggable = true;
        pick.addEventListener('dragstart', event => { event.dataTransfer.setData('application/x-ubu-slot', String(i)); event.dataTransfer.effectAllowed = 'move'; });
      }
      slot.addEventListener('dragover', event => {
        const types = event.dataTransfer.types;
        if (!types.includes('application/x-ubu-slot') && (fixed || !types.includes('application/x-ubu-key'))) return;
        event.preventDefault(); slot.classList.add('drop-target');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('drop-target'));
      slot.addEventListener('drop', event => {
        event.preventDefault(); slot.classList.remove('drop-target');
        const from = event.dataTransfer.getData('application/x-ubu-slot');
        if (from !== '') swapSlots(Number(from), i);
        else place(entryForKey(event.dataTransfer.getData('application/x-ubu-key')), i);
      });
    }
    return slot;
  }
  function superChoices() {
    const entry = draft[rosterSlot];
    if (!entry) return;
    const current = resolveEquippedSuper(entry, rosterSlot), ids = [...new Set(entry.model.supers.map(s => s % 8))];
    $('roster-super-title').textContent = `Super for ${entry.model.parts.fullName} (${POSITIONS[rosterSlot]})`;
    $('roster-super-grid').style.setProperty('--cols', Math.min(ids.length, 4));
    $('roster-super-grid').style.setProperty('--cols-narrow', Math.min(ids.length, 2));
    $('roster-super-grid').replaceChildren(...ids.map(id => {
      const choice = resolveEquippedSuper({ model: entry.model, equippedSuper: P.SUPERS[id] });
      const button = node('button', { type: 'button', className: 'super-choice' }, node('img', { src: choice.icon, alt: '' }),
        node('strong', { textContent: choice.displayName }), node('small', { textContent: choice.desc + superBonus(choice) }));
      button.setAttribute('aria-pressed', String(choice.id === current.id));
      button.onclick = () => { $('roster-super').hidePopover(); draft[rosterSlot] = { ...entry, equippedSuper: choice }; changed(rosterSlot); };
      return button;
    }));
  }
  function teamHint(classic) {
    const entry = draft[rosterSlot], position = POSITIONS[rosterSlot];
    let text = teamLocked() ? 'Your team is locked in. Choose Change team to edit it.' :
      fixedTeam() ? (classic ? 'This match gives you a practice team.' : 'This match gives you a practice team. Pick each ubu’s super with its super button.') :
      !entry ? `Pick an ubu for ${position}.` : `Picking an ubu puts it in ${position}, replacing ${entry.model.parts.fullName}.`;
    if (!teamLocked() && !fixedTeam()) {
      if (canDrag) text += ' You can also drag ubus onto any position.';
      if (classic) text += ' Classic: supers are off.';
    }
    $('roster-hint').textContent = text;
  }
  function rosterSlots() {
    const classic = setupClassic(), locked = teamLocked(), fixed = fixedTeam();
    $('roster-dialog').toggleAttribute('data-locked', locked);
    $('roster-slots').replaceChildren(...draft.map((entry, i) => slotView(entry, i, classic, locked, fixed)));
    changedSlot = -1;
    teamHint(classic);
    rosterList.render();
    for (const option of document.querySelectorAll('#roster-practice .roster-option')) {
      describePractice(option);
    }
    $('start-match').disabled = draft.some(d => !d);
    updateTeamBar();
  }
  function describePractice(option) {
    const entry = practice[Number(option.dataset.key.slice(9))];
    ubuList.describeTile(option, entry.model.parts.fullName, describe(entry.key));
  }
  function addOption(entry, container) {
    const { main, artBox } = ubuList.tileMain(entry.model, entry.label);
    artBox.prepend(ubuRender(entry.model, 'ubu-tile-svg'));
    main.classList.add('roster-option'); main.dataset.key = entry.key;
    main.onclick = () => choose(entry);
    if (canDrag) ubuList.draggable(main, entry.key);
    const tile = document.createElement('div'); tile.className = 'ubu-tile';
    tile.append(main);
    $(container).append(tile);
  }
  practice.forEach((entry, i) => { entry.key = 'practice-' + i; });
  // The player's collection, keyed by serial, as team entries; one entry per ubu keeps keys stable.
  const collectionEntries = new Map();
  function entryFor(item) {
    let entry = collectionEntries.get(item.serial);
    if (entry?.dna !== item.result.dna) {
      entry = { model: item.model, dna: item.result.dna, label: ubuList.serialLabel(item.serial), key: item.serial };
      collectionEntries.set(item.serial, entry);
    }
    return entry;
  }
  function collectionNote(text, clear = false) {
    const note = $('roster-collection-status');
    note.textContent = text;
    if (clear) {
      const button = Object.assign(document.createElement('button'), { type: 'button', className: 'quiet', textContent: 'Clear filters' });
      button.onclick = () => rosterList.clearFilters();
      note.append(' ', button);
    }
  }
  const rosterList = ubuList.mount({
    surface: 'picker', toolbarHost: $('roster-toolbar'), grid: $('roster-options'), scrollRoot: $('roster-scroll'),
    status: $('roster-collection-status'),
    pick: item => choose(entryFor(item)),
    // The viewer belongs to the Collection screen's script, loaded on first use.
    inspect: async item => {
      try { await window.loadMintScripts(); window.showUbuViewer(item.serial); } catch { collectionNote('Could not open the ubu viewer.'); }
    },
    describe: item => describe(item.serial), drag: canDrag,
    onEmpty: reason => collectionNote(reason === 'filtered' ? 'No ubus match.' : reason === 'loading' ? 'Loading your ubus…' :
      reason === 'empty' ? 'No ubus yet. Open packs in Ubu Mint to get some.' : '', reason === 'filtered')
  });
  async function loadCollection() {
    if (!window.getUbuSession?.()?.owner) { $('roster-signin').hidden = false; return; }
    $('roster-signin').hidden = true;
    try { await ubuList.load(); rosterList.render(); } catch (error) { collectionNote(error.message); }
  }
  $('roster-signin-btn').onclick = () => window.openDiscordLogin?.();

  // Saved teams belong to the signed-in account. A team saves only when every position holds
  // one of the player's own ubus (practice ubus change every visit). A null super means the
  // ubu's default.
  const signedIn = () => Boolean(window.getUbuSession?.()?.owner);
  const teamSlotsOf = team => team.every(e => e && ubuList.get(e.key)?.model) ? team.map(e => ({ serial: e.key, super: e.equippedSuper?.id ?? null })) : null;
  const sameSlots = (a, b) => Boolean(a && b) && a.every((s, i) => s.serial === b[i].serial && s.super === b[i].super);
  function restoreTeam(slots) {
    const missing = [];
    const team = slots.map(slot => {
      const item = ubuList.get(slot.serial);
      if (!item?.model) { missing.push(ubuList.serialLabel(slot.serial)); return null; }
      const entry = entryFor(item);
      return slot.super !== null && item.model.supers.some(s => s % 8 === slot.super)
        ? { ...entry, equippedSuper: resolveEquippedSuper({ model: item.model, equippedSuper: P.SUPERS[slot.super] }) } : entry;
    });
    return { team, missing };
  }
  async function loadTeams() {
    if (!signedIn()) { savedTeams = null; teamIndex = -1; updateTeamBar(); return null; }
    try { savedTeams ||= await ubuList.teams(); } catch (error) { $('roster-status').textContent = 'Could not load saved teams: ' + error.message; }
    updateTeamBar();
    return savedTeams;
  }
  async function persistTeams(next) {
    try { savedTeams = await ubuList.saveTeams(next); $('roster-status').textContent = ''; return true; }
    catch (error) { $('roster-status').textContent = 'Could not save teams: ' + error.message; return false; }
    finally { updateTeamBar(); }
  }
  async function useSavedTeam(index) {
    if (!savedTeams?.teams[index] || teamLocked()) return;
    try { await ubuList.load(); } catch (error) { $('roster-status').textContent = error.message; return; }
    const { team, missing } = restoreTeam(savedTeams.teams[index].slots);
    draft = team; teamIndex = index; rosterSlot = Math.max(0, draft.findIndex(d => !d));
    rosterSlots();
    $('roster-status').textContent = missing.length ? `${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} no longer in your collection.` : '';
  }
  // The team played last opens next time, on any device.
  function rememberTeam() {
    const slots = teamSlotsOf(draft);
    if (savedTeams && slots && !sameSlots(slots, savedTeams.last)) void persistTeams({ ...savedTeams, last: slots });
  }
  function updateTeamBar() {
    const show = Boolean(savedTeams) && !fixedTeam();
    $('team-bar').hidden = !show;
    if (!show) return;
    const locked = teamLocked(), slots = teamSlotsOf(draft), saved = savedTeams.teams[teamIndex];
    const edited = !saved || !sameSlots(slots, saved.slots), count = savedTeams.teams.length;
    const select = $('team-select');
    select.replaceChildren(...(edited ? [new Option(saved ? saved.name + ' (edited)' : count ? 'Unsaved team' : 'No saved teams yet', 'current')] : []),
      ...savedTeams.teams.map((team, i) => new Option(team.name, String(i))));
    select.value = edited ? 'current' : String(teamIndex); teamSelectUi.sync();
    select.disabled = locked || !count;
    $('team-prev').disabled = $('team-next').disabled = locked || !count || (count === 1 && !edited);
    $('team-save').textContent = saved ? 'Save changes' : 'Save team';
    $('team-save').disabled = locked || !slots || !edited || (!saved && count >= 30);
    $('team-save').title = slots ? '' : 'Fill every position with your own ubus to save the team';
    $('team-save-new').disabled = locked || !slots || count >= 30;
    $('team-rename').disabled = $('team-delete').disabled = locked || !saved;
  }
  // Names come from a game dialog: a new team, or a new name for the current one.
  async function nameTeam(mode) {
    $('team-menu').hidePopover();
    const renaming = mode === 'rename';
    const typed = await gameUi.ask({ title: renaming ? 'Rename team' : 'Save team', confirmLabel: 'Save',
      input: { label: 'Team name', maxLength: 40, value: renaming ? savedTeams.teams[teamIndex].name : `Team ${savedTeams.teams.length + 1}` } });
    const name = typed?.trim().replace(/\s+/g, ' ').slice(0, 40), slots = teamSlotsOf(draft);
    if (!name || (!renaming && !slots)) return;
    const teams = renaming ? savedTeams.teams.map((team, i) => i === teamIndex ? { ...team, name } : team) : [...savedTeams.teams, { name, slots }];
    if (await persistTeams({ ...savedTeams, teams }) && !renaming) { teamIndex = savedTeams.teams.length - 1; updateTeamBar(); }
  }
  $('team-select').onchange = () => { if ($('team-select').value !== 'current') void useSavedTeam(Number($('team-select').value)); };
  const stepTeam = step => { const n = savedTeams?.teams.length; if (n) void useSavedTeam(teamIndex < 0 ? (step > 0 ? 0 : n - 1) : (teamIndex + step + n) % n); };
  $('team-prev').onclick = () => stepTeam(-1);
  $('team-next').onclick = () => stepTeam(1);
  $('team-save').onclick = async () => {
    const slots = teamSlotsOf(draft);
    if (!slots) return;
    if (teamIndex < 0) { void nameTeam('new'); return; }
    await persistTeams({ ...savedTeams, teams: savedTeams.teams.map((team, i) => i === teamIndex ? { ...team, slots } : team) });
  };
  $('team-save-new').onclick = () => nameTeam('new');
  $('team-rename').onclick = () => nameTeam('rename');
  $('team-delete').onclick = async () => {
    $('team-menu').hidePopover();
    const team = savedTeams?.teams[teamIndex];
    if (!team || !await gameUi.confirm({ title: 'Delete team?', message: `“${team.name}” will be removed from your saved teams. Your ubus stay in your collection.`,
      confirmLabel: 'Delete', danger: true })) return;
    if (await persistTeams({ ...savedTeams, teams: savedTeams.teams.filter((_, i) => i !== teamIndex) })) teamIndex = -1;
    updateTeamBar();
  };
  gameUi.dropdown($('team-more'), $('team-menu'), { align: 'end' });
  // Closing the super choices brings the cards' tools in line with the selected position.
  $('roster-super').addEventListener('toggle', event => { if (event.newState === 'closed' && $('roster-dialog').open) rosterSlots(); });
  const teamSelectUi = gameUi.select($('team-select'));
  // Signed-in players start with the team they played last, else their top three favorites.
  async function accountTeam() {
    const [teamsDoc] = await Promise.all([loadTeams(), ubuList.load()]);
    if (teamsDoc?.last) {
      const { team } = restoreTeam(teamsDoc.last);
      if (team.every(Boolean)) { teamIndex = teamsDoc.teams.findIndex(t => sameSlots(t.slots, teamsDoc.last)); return team; }
    }
    const favorites = ubuList.view(ubuList.items(), { sort: 'favorite' }).filter(item => item.model).slice(0, 3).map(entryFor);
    return favorites.length === 3 ? favorites : null;
  }
  window.addEventListener('ubu:session', async event => {
    savedTeams = null; teamIndex = -1; updateTeamBar();
    if (!event.detail?.owner || !roster.every(entry => practice.includes(entry))) return;
    try {
      const entries = await accountTeam();
      if (!entries || !roster.every(entry => practice.includes(entry))) return;
      draft = entries;
      if (demo) newDemoGame(); else if (!matchInProgress()) newMatch();
      updateHome();
    } catch {}
  });
  // The floating spin slider is a preference kept per device.
  showSetting('setting-spin', spinSlider);
  $('setting-spin').onclick = () => {
    spinSlider = !spinSlider; showSetting('setting-spin', spinSlider);
    try { localStorage.setItem('ububall-spin-slider', spinSlider ? 'on' : 'off'); } catch {}
    draw();
  };
  // Match setup: a mode screen (rules and CPU level), then the team screen where only the ubu list
  // scrolls. Online play borrows the mode screen, and its lobby is the same team screen with the
  // invite on top and Ready in place of Start.
  let setupFor = 'cpu';
  const chosenMode = () => ububallMatch.RULES.filter(rule => $('rule-' + rule).checked).join('-') || 'standard';
  const modeSummary = () => { $('mode-summary').textContent = ububallMatch.modeName(chosenMode()); };
  for (const rule of ububallMatch.RULES) $('rule-' + rule).addEventListener('change', modeSummary);
  function setupStep(step) {
    const sheet = $('roster-dialog');
    sheet.dataset.step = step; sheet.dataset.for = setupFor;
    $('sheet-next').textContent = setupFor === 'online' ? 'Next: online match' : 'Next: choose team';
    $('lobby-panel').hidden = setupFor !== 'lobby';
    $('team-title').textContent = setupFor === 'lobby' ? 'Online match' : 'Your team';
    if (step === 'team') {
      $('team-mode').textContent = ububallMatch.modeName(setupFor === 'lobby' ? lobbyView.state.mode : chosenMode());
      if (!fixedTeam()) { void loadCollection(); void loadTeams(); }
      rosterSlots();
    }
    $('start-match').textContent = setupFor !== 'lobby' ? 'Start match' : lobbyView?.ready ? 'Change team' : 'Ready to play';
  }
  function rosterTab(tab) {
    for (const name of ['yours', 'practice']) {
      $('tab-' + name).setAttribute('aria-selected', String(name === tab));
      $('roster-' + name).hidden = name !== tab;
    }
    $('roster-scroll').scrollTop = 0;
    if (tab === 'yours') void loadCollection();
  }
  function openSetup(step, purpose = 'cpu', mode = cpuMode) {
    setupFor = purpose;
    for (const rule of ububallMatch.RULES) $('rule-' + rule).checked = ububallMatch.rule(mode, rule);
    modeSummary();
    document.querySelector(`input[name="cpu-level"][value="${cpuLevel}"]`).checked = true;
    draft = [...roster]; rosterSlot = 0; $('roster-status').textContent = '';
    rosterTab(signedIn() ? 'yours' : 'practice');
    setupStep(step);
    if (!$('roster-dialog').open) $('roster-dialog').showModal();
  }
  // The online lobby. A practice seat fields the room's own three ubus; otherwise the player
  // picks from their collection, starting from their current, last or favorite team.
  const lobbyEntries = practiceTeam => practiceTeam.map((p, i) => {
    const model = ubu.decode(ubu.fromCode(p.dna));
    return { model, dna: p.dna, label: 'Practice ubu', key: 'online-' + i };
  });
  async function showLobby(view, open) {
    const before = lobbyView, entering = setupFor !== 'lobby';
    lobbyView = view;
    const practiceChanged = JSON.stringify(before?.practice || null) !== JSON.stringify(view.practice || null);
    if (entering || practiceChanged) {
      setupFor = 'lobby'; rosterSlot = 0;
      if (view.practice) draft = lobbyEntries(view.practice);
      else {
        draft = roster.every(entry => ubuList.get(entry.key)?.model) ? roster.map(entry => ({ ...entry })) : [null, null, null];
        if (draft.some(d => !d) && signedIn()) {
          try { const team = await accountTeam(); if (team && lobbyView === view && draft.some(d => !d)) draft = team; } catch {}
        }
      }
    }
    // Owned-ubu matches take only the player's collection.
    $('roster-tabs').hidden = $('roster-scroll').hidden = Boolean(view.practice);
    $('tab-practice').hidden = true;
    if (!view.practice) rosterTab('yours');
    $('lobby-note').textContent = view.note;
    $('lobby-login').hidden = !view.guest;
    setupStep('team');
    if (open && !$('roster-dialog').open) $('roster-dialog').showModal();
  }
  function closeLobby() {
    if (setupFor !== 'lobby') return;
    if ($('roster-dialog').dataset.for === 'lobby') $('roster-dialog').close();
    setupFor = 'cpu'; lobbyView = null;
    $('roster-tabs').hidden = $('roster-scroll').hidden = $('tab-practice').hidden = false; $('lobby-panel').hidden = true;
    $('roster-dialog').removeAttribute('data-locked');
  }
  $('new-match').onclick = () => openSetup('team');
  $('sheet-next').onclick = () => {
    if (setupFor === 'cpu') { setupStep('team'); return; }
    $('roster-dialog').close(); online.create(chosenMode());
  };
  $('team-back').onclick = () => setupStep('mode');
  $('tab-yours').onclick = () => rosterTab('yours');
  $('tab-practice').onclick = () => rosterTab('practice');
  // Back (Escape, or a phone's back gesture) steps from the team screen to the mode screen.
  $('roster-dialog').addEventListener('cancel', event => {
    if ($('roster-dialog').dataset.step === 'team' && setupFor !== 'lobby') { event.preventDefault(); setupStep('mode'); }
  });
  $('start-match').onclick = async () => {
    if (setupFor === 'lobby') {
      const button = $('start-match');
      button.disabled = true;
      try {
        if (lobbyView.ready) await online.unready();
        else {
          if (draft.some(d => !d)) return;
          const supers = draft.map((d, i) => resolveEquippedSuper(d, i).id);
          await online.ready(lobbyView.practice ? { supers } : { serials: draft.map(d => d.key), supers });
          if (!lobbyView.practice) rememberTeam();
        }
      } catch (error) { $('roster-status').textContent = error.message; }
      finally { button.disabled = draft.some(d => !d); }
      return;
    }
    if (draft.some(d => !d)) return;
    $('roster-dialog').close();
    stopDemo();
    roster = draft.map(d => ({ ...d }));
    rememberTeam();
    cpuMode = chosenMode();
    cpuLevel = document.querySelector('input[name="cpu-level"]:checked').value;
    newMatch(true);
    enterMatch();
  };
  $('cancel-roster').onclick = () => $('roster-dialog').close();
  $('lobby-leave').onclick = () => online.leave();
  // A modal pauses the simulation; cancelling preserves the current turn.
  const hudSuperBtn = $('stadium-super-btn');
  if (hudSuperBtn) {
    hudSuperBtn.onclick = () => {
      const b = bodies[selected];
      if (!classicMode() && b && b.meter >= 100 && phase === 'plan' && !b.stunned) {
        b.superArm = !b.superArm;
        dirtyPrediction();
        sync(); draw();
        saveActiveMatch();
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
    } else if (e.key === 'Escape' && foulInfo) closeFoulInfo();
    else if (e.key === 'Escape' && inMatch && !document.querySelector('dialog[open]')) openPause();
  });

  // Match mode: the field fills the screen and the site chrome hides. Entering adds a history
  // entry, so the system back button opens the menu instead of leaving the match.
  let inMatch = false;
  const portraitScreen = matchMedia('(orientation: portrait)');
  function setPortrait(value) { if (isPortrait !== value) toggleRotate(); }
  function fitOrientation() { if (inMatch) setPortrait(portraitScreen.matches); }
  function matchInProgress() { return !demo && phase !== 'over' && Boolean(recording && !online?.active); }
  function updateHome() { $('home-play').textContent = online?.active ? 'Back to online match' : matchInProgress() ? 'Resume match' : 'Play vs CPU'; }
  function enterMatch() {
    if (location.pathname !== '/') return;
    if (demo) { stopDemo(); newMatch(true); }
    if (!history.state?.match) history.pushState({ match: true }, '', location.href);
    if (inMatch) return;
    inMatch = true; document.body.classList.add('in-match');
    fitOrientation(); layoutDirty = true; draw();
  }
  function exitMatchMode() {
    if ($('pause-menu').open) $('pause-menu').close();
    endReplay();
    if (!inMatch) return;
    inMatch = false; document.body.classList.remove('in-match');
    setPortrait(false); layoutDirty = true; updateHome();
    if (!matchInProgress()) startDemo();
  }
  function openPause() {
    $('pause-title').textContent = online?.active ? 'Menu' : 'Paused';
    $('pause-restart').disabled = $('new-match').disabled;
    $('pause-stats').hidden = demo && !theater;
    $('pause-menu').showModal();
  }
  $('pause').onclick = openPause;
  $('pause-stats').onclick = () => theater ? openStats() : openMatchStats('pause');
  $('pause-resume').onclick = () => $('pause-menu').close();
  $('pause-restart').onclick = () => { $('pause-menu').close(); endReplay(); clearActiveMatch(); openSetup('mode'); };
  $('pause-leave').onclick = () => { exitMatchMode(); if (history.state?.match) history.back(); };
  $('home-play').onclick = () => { if (online?.active || matchInProgress()) enterMatch(); else openSetup('mode'); };
  $('demo-play').onclick = () => $('home-play').click();
  portraitScreen.addEventListener('change', () => { gameUi.updateScale?.(); fitOrientation(); draw(); });
  window.addEventListener('popstate', () => {
    if (location.pathname !== '/') return;
    if (history.state?.match) enterMatch();
    else if (inMatch) { history.pushState({ match: true }, '', location.href); openPause(); }
  });
  window.addEventListener('ubu:screen', event => { if (event.detail !== 'play') exitMatchMode(); else updateHome(); });
  function networkMoves() {
    return plans.map((p, i) => ({ angle: p.angle + (online?.state?.seat ? Math.PI : 0), power: p.power,
      spin: p.spin || 0, superArm: Boolean(bodies[i].superArm), guard: Boolean(p.guard) }));
  }
  // Presentation-only and internal-simulation body keys. Presentation keys live only on display
  // bodies (`bodies`); internal simulation keys stay out of display bodies. All other simulation
  // fields are projected through `projectBody` so new physics/gameplay properties are preserved.
  const PRESENTATION_KEYS = new Set(['playerIndex', 'name', 'voice', '_lastHitSound', '_lastWallSound']);
  const SIM_INTERNAL_KEYS = new Set(['meterTick', 'pinX', 'pinY']);
  function stripPresentation(sim) {
    if (!Array.isArray(sim)) return sim;
    for (const b of sim) {
      if (!b || typeof b !== 'object') continue;
      for (const k of PRESENTATION_KEYS) delete b[k];
    }
    return sim;
  }
  function cloneSimValue(v) {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(cloneSimValue);
    const out = {};
    for (const [k, item] of Object.entries(v)) out[k] = cloneSimValue(item);
    return out;
  }
  function onlineOrder(items, seat) { return seat ? [...items.slice(3, 6), ...items.slice(0, 3), ...items.slice(6)] : items; }
  // Maps simulation bodies (server seat-0 order and coordinates) onto the displayed bodies.
  const viewIndex = (i, seat) => seat ? (i < 3 ? i + 3 : i < 6 ? i - 3 : 6) : i;
  function applySeatTransform(src, dst, i, seat = 0) {
    if (seat) {
      dst.x = 1000 - src.x; dst.y = 600 - src.y;
      dst.vx = -src.vx; dst.vy = -src.vy;
      dst.rotation = (src.rotation || 0) + Math.PI;
      if (src.stickOffset) dst.stickOffset = { x: -src.stickOffset.x, y: -src.stickOffset.y };
    } else {
      dst.x = src.x; dst.y = src.y;
      dst.vx = src.vx; dst.vy = src.vy;
      dst.rotation = src.rotation;
      if (src.stickOffset) dst.stickOffset = { x: src.stickOffset.x, y: src.stickOffset.y };
    }
    dst.team = i < 3 ? 0 : i < 6 ? 1 : -1;
    if (i < 6) dst.slot = i % 3;
    else {
      delete dst.slot;
      if (src.strikerTeam !== undefined || dst.strikerTeam !== undefined) {
        dst.strikerTeam = src.strikerTeam === undefined || src.strikerTeam < 0 ? -1 : (seat ? 1 - src.strikerTeam : src.strikerTeam);
      }
    }
    return dst;
  }
  // Pure simulation-to-simulation seat transform (used when taking over a replay from seat 1).
  function transformSimSeat(sim, seat = 0) {
    return onlineOrder(structuredClone(sim), seat).map((b, i) => applySeatTransform(b, b, i, seat));
  }
  function projectBody(cb, vb, i, seat = 0, entries = typeof teamEntries !== 'undefined' ? teamEntries : null, anonymous = typeof anonymousNames !== 'undefined' && anonymousNames) {
    const armed = vb.superArm;
    for (const k of Object.keys(vb)) {
      if (!PRESENTATION_KEYS.has(k) && (SIM_INTERNAL_KEYS.has(k) || !(k in cb))) delete vb[k];
    }
    for (const [k, v] of Object.entries(cb)) {
      if (PRESENTATION_KEYS.has(k) || SIM_INTERNAL_KEYS.has(k)) continue;
      vb[k] = cloneSimValue(v);
    }
    applySeatTransform(cb, vb, i, seat);
    vb.playerIndex = i;
    if (i < 6) {
      vb.meter = cb.meter ?? 0;
      vb.guarding = Boolean(cb.guarding);
      vb.ironGuard = Boolean(cb.ironGuard);
      vb.daze = cb.daze || 0;
      vb.superActive = cb.superActive || null;
      vb.superArm = cb.superArm !== undefined ? Boolean(cb.superArm) : Boolean(armed);
      vb.stunned = Boolean(cb.stunned || cb.stunnedNext);
      vb.carded = Boolean(cb.carded);
      vb.holding = Boolean(cb.holding);
      const entry = entries ? entries[i] : null;
      if (entry?.model) {
        vb.name = anonymous ? anonymousName(i) : entry.model.parts?.fullName;
        vb.voice = entry.model.voice;
        vb.personality = cloneSimValue(entry.model.personality);
        const sObj = entry.equippedSuper || (cb.equippedSuper ? { ...P.SUPERS[cb.equippedSuper.id], ...cb.equippedSuper } : resolveEquippedSuper(entry, i));
        vb.equippedSuper = classicMode() ? null : cloneSimValue(sObj || null);
      } else if (anonymous) {
        vb.name = anonymousName(i);
      }
    } else {
      vb.onFire = Boolean(cb.onFire);
      vb.fireTicks = cb.fireTicks || 0;
      vb.pace = cb.pace || 0;
      vb.strikerTeam = cb.strikerTeam === undefined || cb.strikerTeam < 0 ? -1 : (seat ? 1 - cb.strikerTeam : cb.strikerTeam);
    }
    return vb;
  }
  function viewBodies(items, seat = 0, entries = typeof teamEntries !== 'undefined' ? teamEntries : null, anonymous = typeof anonymousNames !== 'undefined' && anonymousNames) {
    if (!items) return [];
    return onlineOrder(items, seat).map((cb, i) => projectBody(cb, {}, i, seat, entries, anonymous));
  }
  // The server's fouls as this seat sees them: teams swapped and the rink turned half round.
  function viewFouls(f, seat) {
    if (!f) return ububallMatch.newFouls();
    if (!seat) return structuredClone(f);
    return { ...f, crease: [f.crease[1], f.crease[0]], corner: f.corner === null ? null : 3 - f.corner, cards: f.cards.map(i => viewIndex(i, seat)) };
  }
  function toViewBody(cb, sim = shownSim(), seat = shownSeat(), targetBodies = bodies) {
    if (!cb) return null;
    const idx = sim?.indexOf(cb);
    if (idx === undefined || idx < 0) return cb;
    return targetBodies[viewIndex(idx, seat)] || cb;
  }
  function syncViewBodies(sim = shownSim(), seat = shownSeat(), targetBodies = bodies, anonymous = typeof anonymousNames !== 'undefined' && anonymousNames, meters = dirtyMeters, entries = typeof teamEntries !== 'undefined' ? teamEntries : null) {
    if (!sim) return targetBodies;
    for (let i = 0; i < sim.length; i++) {
      const vi = viewIndex(i, seat);
      const vb = targetBodies[vi] ||= {};
      projectBody(sim[i], vb, vi, seat, entries, anonymous);
      if (meters) meters.add(vb);
    }
    return targetBodies;
  }
  function playOnlineReplay() {
    const replay = onlineReplay;
    if (!replay || !replay.simBodies) return;
    const elapsedSec = Math.max(0, (online.now() - replay.startedAt - (replay.paused || 0)) / 1000);
    const targetTick = Math.min(replay.ticks, Math.floor(elapsedSec / P.DT));
    if (replay.currentTick === undefined) replay.currentTick = 0;

    // Warnings lapse during the replay as they did on the server.
    const simFouls = viewFouls(fouls, online.state.seat);
    if (targetTick - replay.currentTick > 60) {
      while (replay.currentTick < targetTick - 8) {
        P.step(replay.simBodies, P.DT); traceGuide(replay.simBodies);
        replay.currentTick++;
        ububallMatch.lapseFouls(P, replay.simBodies, simFouls);
      }
    }

    while (replay.currentTick < targetTick) {
      P.step(replay.simBodies, P.DT, replayFx.hit, replayFx.wall, replayFx.shock, replayFx.super); traceGuide(replay.simBodies);
      replay.currentTick++;
      ububallMatch.lapseFouls(P, replay.simBodies, simFouls);
      const now = replay.currentTick, saves = (replay.saves || []).filter(s => s.tick === now), struck = replay.struck?.includes(now);
      if (saves.length || struck) syncViewBodies(replay.simBodies, online.state.seat);
      for (const s of saves) {
        if (s.iron && replay.simBodies[s.index]) replay.simBodies[s.index].ironGuard = true;
        creditSave(toViewBody(replay.simBodies[s.index], replay.simBodies, online.state.seat), s.own, Boolean(s.iron));
      }
      if (struck) popup(bodies[6], 'Spin strike!');
      // Hit-stop holds the replay clock back so the rest of the turn plays on after the pause.
      const stop = replay.stops?.find(s => s.tick === now)?.ms;
      if (stop) { replay.paused = (replay.paused || 0) + stop; impact(stop, stop >= (ububallMatch.HIT_STOP?.scoredGoal ?? 200) ? (ububallMatch.SCREEN_SHAKE?.goal ?? 2) : (ububallMatch.SCREEN_SHAKE?.default ?? 1)); break; }
    }
    syncViewBodies(replay.simBodies, online.state.seat);
    if (!replay.fouled) fouls = viewFouls(simFouls, online.state.seat);

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
          const toView = index => index == null ? null : viewIndex(index, online.state.seat);
          celebrate(viewGoal, bodies[6], replay.label || 'GOAL', replay.label === 'OWN GOAL' ? null : bodies[toView(replay.scorer)] || null);
          if (ballOnFire()) lightNet(viewGoal);
          if (toView(replay.assist) !== null) popup(bodies[toView(replay.assist)], 'Assist');
          if (online.state.game.winner !== null) queueSummary();
          const viewScorerIndex = toView(replay.scorer);
          const scorer = viewScorerIndex !== null ? bodies[viewScorerIndex] : bodies[viewGoal * 3];
          scoringPlayer = scorer;
          const them = onlineNames(online.state)[1], scorerName = scorer?.name || (viewGoal === 0 ? 'Your ubu' : `${them}'s ubu`);
          goalTab(viewGoal, replay.label || 'GOAL', replay.label === 'OWN GOAL' ? null : scorerName);
          say(online.state.game.winner !== null
            ? (viewGoal === 0 ? `You win! ${callText(replay.label || 'GOAL', scorerName)}${honourText(0)}` : `${them} wins. ${callText(replay.label || 'GOAL', scorerName)}${honourText(1)}`)
            : `${viewGoal === 0 ? 'You score!' : `${them} scores.`} ${callText(replay.label || 'GOAL', scorerName)} Ready for the next kickoff.`
          );
          loopFanfare(scorer?.voice);
          sync();
        }
      }
    } else {
      scores = online.state.seat ? [...online.state.game.scores].reverse() : [...online.state.game.scores];
    }

    if (replay.currentTick >= replay.ticks) {
      const before = trailPositions();
      syncViewBodies(online.state.game.bodies, online.state.seat);
      clearDiscontinuousTrails(before);
      if (!replay.fouled) {
        replay.fouled = true; fouls = viewFouls(online.state.game.fouls, online.state.seat); announceFouls();
        if (replay.goal === null && foulText()) say(foulText());
      }
    }

    recordTrails(); emitSkaterEffects(Math.min(.05, 1 / 60)); draw();
  }
  // Each side's Discord display name, mine first; a guest has none.
  function onlineNames(s) {
    return [s.names[s.seat] || 'Guest', s.occupied[1 - s.seat] ? s.names[1 - s.seat] || 'Guest' : 'Opponent'];
  }
  // The stadium and the full-time summary both offer the rematch; one tap asks, the other accepts.
  function updateRematch(s) {
    const them = onlineNames(s)[1], mine = s.rematch[s.seat], theirs = s.rematch[1 - s.seat];
    for (const button of [$('online-rematch'), $('stats-rematch')]) {
      if (!button) continue;
      button.hidden = s.phase !== 'over' || s.left.some(Boolean); button.disabled = mine;
      button.textContent = mine ? 'Rematch requested' : theirs ? 'Accept rematch' : 'Rematch';
    }
    const note = $('stats-rematch-status');
    if (note) note.textContent = s.phase !== 'over' ? '' : s.left[1 - s.seat] ? `${them} left the match.` :
      mine && !s.connected[1 - s.seat] ? `${them} is offline. They can accept when they return.` : mine ? `Waiting for ${them} to accept.` : theirs ? `${them} wants a rematch.` : '';
  }
  online = ububallOnline({
    chooseMode(mode) { openSetup('mode', 'online', mode); },
    lobby(view, open) { void showLobby(view, open); },
    closeLobby,
    onState(s) {
      if (!document.body.classList.contains('online-match')) { stopDemo(); enterMatch(); }
      document.body.classList.add('online-match');
      $('online-open').textContent = 'Online match';
      const [me, them] = onlineNames(s);
      $('home-label').textContent = me; $('opponent-label').textContent = them; $('opponent-heading').textContent = `${them}'s team`;
      $('online-match-status').hidden = false; $('new-match').disabled = true;
      matchMode = s.mode; document.body.classList.toggle('classic-match', classicMode());
      showMode(s.mode);
      updateRematch(s);
      if (onlinePhase === 'over' && s.phase !== 'over') closeSummary();
      $('online-match-status').textContent = s.phase === 'lobby' ? 'Choosing teams' : s.phase === 'over' ? (s.left[1 - s.seat] ? `${them} left the match.` : s.rematch[s.seat] ? `Rematch requested · waiting for ${them}` :
        s.rematch[1 - s.seat] ? `${them} wants a rematch!` : (s.winner === s.seat ? 'You win!' : `${them} wins.`)) : !s.connected.every(Boolean) ? `${them} disconnected · planning paused` :
        s.locked[s.seat] ? `Moves locked · waiting for ${them}` : s.phase === 'resolving' ? 'Turn in motion' : 'Plan your moves';
      if (!s.game) { phase = 'waiting'; onlineReplay = null; sync(); draw(); return; }
      const rosterKey = JSON.stringify(s.rosters);
      if (rosterKey !== onlineRoster) {
        onlineRoster = rosterKey;
        teamEntries = onlineOrder(s.rosters.flat(), s.seat).map(entry => {
          const model = ubu.decode(ubu.fromCode(entry.dna));
          const mastery = P.superMastery(model.supers, entry.superId);
          return { model, dna: entry.dna, equippedSuper: { ...P.SUPERS[entry.superId], ...mastery } };
        });
        roster = teamEntries.slice(0, 3); buildTeam();
      }
      recordOnline(s);
      const fresh = onlineTurn !== s.turn || onlineDisconnected || (s.phase === 'plan' && onlinePhase !== 'plan');
      onlinePhase = s.phase;
      onlineDisconnected = false;
      const armed = bodies.slice(0, 3).map(b => Boolean(b.superArm));
      if (fresh || !s.connected.every(Boolean) || s.locked[s.seat]) drag = null;
      if (fresh) {
        dirtyPrediction();
        onlineTurn = s.turn; scoringPlayer = null; clearEffects();
        const ball = s.game.bodies[6];
        if (s.phase === 'plan' && ball.x === 500 && ball.y === 300) kickoffGlow = 1;
      }
      if (s.phase !== 'resolving') { endGoalReplay(); stopFanfare(); }
      const before = !fresh && !s.replay && !goalReplay ? trailPositions() : null;
      if (!goalReplay) syncViewBodies(s.game.bodies, s.seat);
      if (before) clearDiscontinuousTrails(before);
      if (!s.replay) fouls = viewFouls(s.game.fouls, s.seat);
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
        onlineReplay.simBodies = stripPresentation(structuredClone(s.replay.initialBodies));
        const classic = classicMode();
        onlineReplay.simBodies.forEach((b, i) => {
          if (i < 6) {
            const entry = (i < 3 ? s.rosters[0]?.[i] : s.rosters[1]?.[i - 3]);
            if (entry) {
              const model = ubu.decode(ubu.fromCode(entry.dna));
              const mastery = classic ? null : P.superMastery(model.supers, entry.superId);
              b.equippedSuper = classic ? null : { id: entry.superId, key: P.SUPERS[entry.superId]?.key, bonusTicks: mastery?.bonusTicks || 0, bonusRefund: mastery?.bonusRefund || 0 };
              b.superBonusTicks = mastery?.bonusTicks || 0;
              b.superBonusRefund = mastery?.bonusRefund || 0;
            }
          }
        });
        recordSegment(onlineReplay.simBodies, onlineReplay.plans, s.replay.ticks, s.replay.saves.map(e => saveEvent(e.tick, e)), structuredClone(s.replay.stops));
        recordOnlineTurn(s); beginGuide(onlineReplay.simBodies, onlineReplay.plans, s.seat);
        P.startTurn(onlineReplay.simBodies, onlineReplay.plans, replayFx.super);
        syncViewBodies(onlineReplay.simBodies, s.seat);
      }
      finishOnlineRecording(s);
      phase = s.phase === 'over' ? 'over' : s.phase === 'resolving' ? 'play' : s.connected.every(Boolean) && !s.locked[s.seat] ? 'plan' : 'waiting';
      sync(); if (onlineReplay) playOnlineReplay(); else draw();
    },
    onDisconnect() { onlineDisconnected = true; phase = 'waiting'; drag = null; $('online-match-status').textContent = 'Reconnecting · planning paused'; sync(); draw(); },
    onError(message) { $('online-match-status').textContent = message; },
    onLeave() {
      saveRecording();
      onlineRoster = ''; onlineTurn = 0; onlineReplay = null; onlinePhase = ''; scoringPlayer = null;
      document.body.classList.remove('online-match');
      $('online-open').textContent = 'Play online';
      $('new-match').disabled = false; $('online-match-status').hidden = true; $('online-forfeit').hidden = true;
      $('online-rematch').hidden = true; $('launch').hidden = false; closeSummary();
      $('home-label').textContent = 'You'; $('opponent-label').textContent = 'CPU'; $('opponent-heading').textContent = 'CPU team';
      draft = practice.slice(0, 3); newMatch();
    }
  });
  $('online-rematch').onclick = () => online.rematch();
  practice.slice(0, 3).forEach(entry => addOption(entry, 'roster-practice'));
  restoredMatch = restoreActiveMatch();
  if (!restoredMatch) newMatch();
  try {
    if (localStorage.getItem('ububall-orientation') === 'portrait') {
      toggleRotate();
    }
  } catch {}
  document.addEventListener('visibilitychange', () => { lastTime = 0; accumulator = 0; });
  const ro = new ResizeObserver(entries => {
    gameUi.updateScale?.();
    for (const entry of entries) {
      if (entry.target === canvas) {
        const box = entry.devicePixelContentBoxSize?.[0];
        deviceWidth = box ? box.inlineSize : 0;
        deviceHeight = box ? box.blockSize : 0;
      }
    }
    layoutDirty = true;
    draw();
  });
  try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(canvas); }
  if (stadium) ro.observe(stadium);
  if (stageArea) ro.observe(stageArea);
  ro.observe($('field-spin')); // Its size places it; it has none until first shown.
  const resizeField = () => { gameUi.updateScale?.(); layoutDirty = true; draw(); };
  window.addEventListener('resize', resizeField);
  window.visualViewport?.addEventListener('resize', resizeField);
  requestAnimationFrame(frame);
  // "Play with my ubus" arrives as /?roster=1, on load or from the Collection screen.
  function openRosterFromLink() {
    const url = new URL(location.href);
    if (url.pathname !== '/' || !url.searchParams.has('roster')) return;
    url.searchParams.delete('roster');
    history.replaceState(null, '', url);
    $('new-match').click();
    loadCollection();
  }
  openRosterFromLink();
  window.addEventListener('ubu:screen', openRosterFromLink);
  // The phone's top edge in landscape, so the match sidebar can sit there.
  function updateTopSide() { const angle = screen.orientation?.angle ?? window.orientation; document.body.dataset.topSide = angle === 270 || angle === -90 ? 'right' : 'left'; }
  updateTopSide(); screen.orientation?.addEventListener('change', updateTopSide);
  // Home screen demo: Saffron (the home team) against Amethyst, one hard CPU and one medium, chosen
  // at random each game. Saffron's planning is acted out with a pointer, as a how-to for new players.
  const demoClient = createCPUClient(), DEMO_STOP = Symbol('demo stopped');
  let demoRun = 0, demoGame = 0;
  function demoPaused() { return inMatch || document.hidden || Boolean(foulInfo) || $('field-banner').closest('[data-screen]').hidden || Boolean(document.querySelector('dialog[open]')); }
  // Waits count only while the demo is on screen; a stopped demo ends its walkthrough.
  async function demoWait(run, ms, until = null) {
    let left = ms;
    while (until ? !until() : left > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (run !== demoRun) throw DEMO_STOP;
      if (!demoPaused()) left -= 100;
    }
  }
  function newDemoGame() {
    demoLevels = Math.random() < .5 ? ['hard', 'medium'] : ['medium', 'hard'];
    demoGame++; hideFinger(); newMatch();
    $('home-label').textContent = 'Saffron'; $('opponent-label').textContent = 'Amethyst';
    showMode(matchMode);
  }
  function startDemo() {
    if (demo || inMatch || online?.active) return;
    demo = true; document.body.classList.add('demo-match'); setPortrait(false);
    newDemoGame(); updateHome();
    void demoLoop(++demoRun);
  }
  function stopDemo() {
    if (!demo) return;
    demo = false; demoRun++; demoClient.cancel(); hideFinger();
    document.body.classList.remove('demo-match');
    $('home-label').textContent = 'You'; $('opponent-label').textContent = 'CPU';
  }
  async function demoLoop(run) {
    try {
      for (;;) {
        await demoWait(run, 100);
        if (phase === 'plan') await demoPlanTurn(run);
        else if (phase === 'goal' || phase === 'over') await demoAfterGoal(run);
      }
    } catch (error) { if (error !== DEMO_STOP) throw error; }
  }
  // Each goal replays twice; a win is announced and lingers before the next game.
  async function demoAfterGoal(run) {
    const scored = performance.now();
    await demoWait(run, 0, () => (goalReplay?.loops ?? 0) >= 3 || (!goalReplay && !goalReplayAt && performance.now() - scored > 3000));
    if (phase === 'over') {
      const home = scores[0] > scores[1];
      endGoalReplay();
      await banner(home ? 'Saffron wins!' : 'Amethyst wins!', 4000, home ? 'home' : 'away');
      await demoWait(run, 800);
      newDemoGame();
    } else $('launch').click();
  }
  // A walkthrough belongs to one turn of one game. If the game is replaced underneath it (say,
  // the player's own ubus arrive after sign-in), it stops and the loop starts the new turn's.
  async function demoPlanTurn(run) {
    const game = demoGame, t = turn, current = () => game === demoGame && phase === 'plan' && turn === t;
    const planning = demoClient.plan({ version: ububallMatch.VERSION, mode: matchMode, bodies: simBodies, stats, scores, turn, fouls },
      { level: demoLevels[0], seed: turn }, 0);
    await planBanner; await demoWait(run, 600);
    const result = await planning;
    if (run !== demoRun) throw DEMO_STOP;
    if (!result || result.error || !current()) return;
    for (let i = 0; i < 3; i++) {
      await demoAim(run, i, result.plans[i], current);
      if (!current()) return;
    }
    await demoWait(run, 500);
    if (!current()) return;
    await banner('Launch!', 900, 'launch');
    await demoWait(run, 400);
    if (current()) $('launch').click();
  }
  // The pointer's fingertip sits on a field point, through the inverse of the pointer-input mapping.
  function placeFinger(x, y) {
    const finger = $('demo-finger'), stage = finger.parentElement.getBoundingClientRect(), p = screenPoint({ x, y });
    finger.style.left = p.x - stage.left + 'px'; finger.style.top = p.y - stage.top + 'px';
  }
  function hideFinger() { $('demo-finger').toggleAttribute('hidden', true); $('demo-finger').classList.remove('pressed'); }
  async function demoAim(run, i, target, current) {
    const b = bodies[i];
    selected = i; sync(); draw();
    if (b.stunned || target.guard || !(target.power > 0)) { plans[i] = { ...target }; sync(); draw(); await demoWait(run, 500); return; }
    plans[i] = { ...target, power: 0 };
    placeFinger(b.x, b.y); $('demo-finger').toggleAttribute('hidden', false);
    await demoWait(run, 350);
    if (!current()) { hideFinger(); return; }
    $('demo-finger').classList.add('pressed');
    await demoWait(run, 200);
    const began = performance.now(), ms = 900;
    await new Promise(resolve => {
      const step = () => {
        const now = performance.now();
        if (run !== demoRun || !current()) { resolve(); return; }
        const k = Math.min(1, (now - began) / ms), eased = 1 - (1 - k) ** 3;
        plans[i] = { ...target, power: target.power * eased };
        const arrow = impulseGeometry(b, plans[i]);
        placeFinger(arrow.x, arrow.y);
        sync(); draw();
        if (k < 1) setTimeout(step, 16); else resolve();
      };
      step();
    });
    if (run !== demoRun) throw DEMO_STOP;
    if (!current()) { hideFinger(); return; }
    plans[i] = { ...target }; sync(); draw();
    await demoWait(run, 300);
    hideFinger();
    await demoWait(run, 300);
  }
  // A reload during a match returns to match mode; otherwise the home rink plays a demo.
  if (restoredMatch || history.state?.match) {
    if (matchInProgress()) enterMatch();
    else startDemo();
  } else {
    startDemo();
  }
})();
