'use strict';
(() => {
  const $ = id => document.getElementById(id), P = ububallPhysics;
  const inDiscord = Boolean(window.ubuActivity);
  const liveField = {};
  let fieldView = liveField;
  fieldView.canvas = $('rink');
  fieldView.ctx = fieldView.canvas.getContext('2d');
  let layoutDirty = true, renderWidth = 1, renderHeight = 1, deviceWidth = 0, deviceHeight = 0;
  const dirtyMeters = new Set();
  // Guests field three ubus they cannot keep; the CPU gets a fresh three each match.
  const starterEntries = (prefix, label) => rarity.starterTeam(ubu).map((dna, i) => ({ model: ubu.decode(ubu.fromCode(dna)), dna, label, key: prefix + '-' + i }));
  const guestTeam = starterEntries('guest', 'Guest ubu');
  let cpuTeam = starterEntries('cpu', 'CPU ubu');
  let roster = guestTeam, draft = [...roster], rosterSlot = 0;
  const idlePlan = () => ({ angle: 0, power: 0, spin: 0, guard: false });
  fieldView.bodies = P.kickoff();
  let simBodies = P.kickoff(), plans = Array.from({ length: 3 }, idlePlan), cpu = [], selected = 0, scores = [0, 0], turn = 1, phase = 'plan';
  let elapsed = 0, accumulator = 0, lastTime = 0, drag = null, dragMode = null, dragDirty = false, skaters = [];
  fieldView.portrait = false;
  fieldView.mode = 'standard';
  let planDeadline = 0, planPausedAt = null;
  // Each turn of the current play (motion since the field last rested), for goal replays.
  let playSegments = [], goalReplay = null, goalReplayAt = 0, goalReplayDelayMs = 0, postGoal = null, authoritativeBodies = null;
  fieldView.anonymous = false;
  // The replay viewer (see watchReplay), and the match being recorded for the replay library.
  let theater = null, recording = null, recordingOnline = false, restoredMatch = false;
  let cast = null, shot = location.pathname === '/mint' ? 'mint' : location.pathname === '/collection' ? 'collection' : (inDiscord ? 'lobby' : 'home'), returnShot = inDiscord ? 'lobby' : 'home', returnPortrait = false, handoffToMatch = false;
  const homeShot = inDiscord ? 'lobby' : 'home';
  const isHomeShot = (s = shot) => s === 'home' || s === 'lobby';
  const isMatchShot = (s = shot) => s === 'match' || s === 'replay';
  const isSetupShot = (s = shot) => s === 'team' || s === 'rules';
  if (document.body?.dataset) document.body.dataset.shot = shot;
  // While a video export renders, effects and sounds run on its clock (ms) instead of the wall clock,
  // sounds go to its offline audio, and the field draws at its size.
  let videoClock = null, videoAudio = null, cardShot = false;
  fieldView.field = null;
  const clockNow = () => videoClock ?? activePlayback?.clock ?? performance.now();
  let matchTicks = 0; // Simulated ticks played locally, for meter cooldowns.
  let online = null, onlineRoster = '', onlineTurn = 0, onlineReplay = null, onlineDisconnected = false, onlinePhase = '';
  const cpuClient = createCPUClient();
  let cpuGeneration = 0, cpuReady = Promise.resolve(), cpuDone = false, cpuLevel = 'medium', cpuMode = 'standard';
  // The home screen demo (CPU against CPU) plays silently.
  let demo = false, demoLevels = ['medium', 'hard'], demoRun = 0, demoGame = 0;
  const demoClient = createCPUClient(), DEMO_STOP = Symbol('demo stopped');
  let soundVolume = 80;
  let musicVolume = 80;
  let audioMode = 'stereo';
  try {
    const legacySound = localStorage.getItem('ububall-sound');
    const savedSound = localStorage.getItem('ububall-sound-volume');
    const savedMusic = localStorage.getItem('ububall-music-volume');
    const savedMode = localStorage.getItem('ububall-audio-mode');
    if (savedSound !== null) soundVolume = Math.max(0, Math.min(100, Number(savedSound) || 0));
    else if (legacySound === 'off') soundVolume = 0;
    if (savedMusic !== null) musicVolume = Math.max(0, Math.min(100, Number(savedMusic) || 0));
    else if (legacySound === 'off') musicVolume = 0;
    if (savedMode === 'mono' || savedMode === 'stereo') audioMode = savedMode;
  } catch {}
  const bench = typeof window !== 'undefined' && location.search.includes('bench=1')
    ? (window.__ubuBench ||= { flags: {}, rec: null }) : null;
  const gameAudio = () => bench?.flags.noAudio ? null : (videoAudio || activePlayback?.audio || (demo ? null : window.ubuAudio));
  const classicMode = () => ububallMatch.rule(fieldView.mode, 'classic');
  const blitzMode = () => ububallMatch.rule(fieldView.mode, 'blitz');
  const pulseMode = () => ububallMatch.rule(fieldView.mode, 'pulse');
  function startPlanClock() {
    const now = performance.now();
    planDeadline = now + (ububallMatch.planningMilliseconds(fieldView.mode) ?? Infinity);
    planPausedAt = localPlayBlocked() ? now : null;
  }
  function localPlayBlocked() {
    return (shot !== 'match' && shot !== 'replay' && !(demo && isHomeShot())) || document.hidden || Boolean($('roster-dialog').classList?.contains('open') || $('roster-dialog').open) || $('pause-menu').open || $('match-help').open || $('stats-dialog').open || Boolean(document.querySelector('.game-dialog[open]')) || Boolean(foulInfo && !online?.active);
  }
  function updateLocalPlanClock(blocked) {
    if (online?.active || phase !== 'plan' || !blitzMode()) return;
    const now = performance.now();
    if (blocked) planPausedAt ??= now;
    else if (planPausedAt !== null) {
      planDeadline += now - planPausedAt;
      planPausedAt = null;
    }
  }
  function updateClock() {
    const setHidden = (el, next) => { if (el && el.hidden !== next) el.hidden = next; };
    const clock = $('blitz-clock');
    if (online?.active) {
      const s = online.state;
      const hideClock = !blitzMode() || s?.phase !== 'plan';
      setHidden(clock, hideClock);
      const left = hideClock ? 0 : Math.max(0, s.deadline === null ? s.remaining : s.deadline - online.now());
      if (!hideClock && clock) {
        const txt = Math.ceil(left / 1000) + 's';
        if (clock.textContent !== txt) clock.textContent = txt;
      }
      drainClock(hideClock, left);
      const other = s ? 1 - s.seat : 1;
      const hideForfeit = !s || s.spectator || s.phase === 'over' || !s.connected[s.seat] || s.connected[other] || s.disconnectedAt[other] === null || online.now() - s.disconnectedAt[other] < 60000;
      setHidden($('online-forfeit'), hideForfeit);
      return;
    }
    const hideClock = !blitzMode() || phase !== 'plan';
    setHidden(clock, hideClock);
    const left = hideClock ? 0 : Math.max(0, planDeadline - (planPausedAt ?? performance.now()));
    if (!hideClock && clock) {
      const txt = Math.ceil(left / 1000) + 's';
      if (clock.textContent !== txt) clock.textContent = txt;
    }
    drainClock(hideClock, left);
  }
  // The scorebug's Blitz strip: the share of planning time left.
  function drainClock(hidden, left) {
    const strip = $('clock-strip');
    if (strip && strip.hidden !== hidden) strip.hidden = hidden;
    if (!hidden && strip?.firstChild) {
      const xf = `scaleX(${Math.min(1, left / ububallMatch.planningMilliseconds('blitz'))})`;
      if (strip.firstChild.style.transform !== xf) strip.firstChild.style.transform = xf;
    }
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
    const compact = getComputedStyle(board.querySelector('.bug-center')).display !== 'flex';
    const edge = (node, side) => node.offsetWidth ? node.getBoundingClientRect()[side] : board.getBoundingClientRect()[side === 'right' ? 'left' : 'right'];
    // On phones the logo and rules sit between the menu and tools: rules in full when they fit there.
    for (const size of compact ? ['compact-words', 'compact'] : BUG_SIZES) {
      board.dataset.size = size;
      fitStatus(status);
      const left = board.querySelector('.bug-left').getBoundingClientRect(), right = compact ? left : board.querySelector('.bug-right').getBoundingClientRect();
      if (left.left >= edge(board.querySelector('.match-tools'), 'right') + 8 * gameUi.scale() && right.right <= edge(board.querySelector('.stadium-toolbar'), 'left') - 8 * gameUi.scale()) break;
    }
  }
  function fitStatus(status) {
    const turnNode = $('turn-label'), phaseNode = $('phase'), clock = $('blitz-clock');
    const saved = [turnNode.textContent, phaseNode.textContent, clock.textContent, clock.hidden];
    const blitz = ububallMatch.rule(bugMode, 'blitz');
    status.style.removeProperty('--status-width'); status.style.width = 'max-content';
    let widest = 0;
    for (const phaseText of ['Plan', 'In play', 'Goal', 'Final', 'Replay', ...(online?.active ? ['Waiting', 'Offline', 'Rejoining'] : ['CPU'])]) {
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
    const scoreBottom = tab.parentElement.querySelector('.bug-home').getBoundingClientRect().bottom;
    const statusBottom = tab.parentElement.querySelector('.bug-status').getBoundingClientRect().bottom;
    tab.style.top = Math.max(scoreBottom, statusBottom) - board.top + 'px';
    tab.classList.add('show');
    bugTabTimer = setTimeout(() => { tab.classList.remove('show'); bugTabTimer = setTimeout(nextBugTab, 300); }, 2600);
  }
  let arrowGrab = null, dragStart = null, dragStartClient = null, dragMoved = false;
  let pullBehind = false;
  try { pullBehind = localStorage.getItem('ububall-aim-style') === 'pull'; } catch {}
  const firstTurnKey = 'ububall-first-turn-guide';
  let firstTurnSeen = false;
  let superHintSeen = false, superHintFor = null;
  try { superHintSeen = localStorage.getItem('ububall-super-hint') === 'seen'; } catch {}
  let firstTurnStep = null, firstTurnStarted = null;
  try { firstTurnSeen = localStorage.getItem(firstTurnKey) === 'seen'; } catch {}
  // The floating spin slider: on by default with a mouse, off on touch screens.
  let spinSlider = !matchMedia('(pointer: coarse)').matches;
  try { spinSlider = (localStorage.getItem('ububall-spin-slider') ?? (spinSlider ? 'on' : 'off')) === 'on'; } catch {}
  // Pause menu settings: each button shows its name and current value, and pressing it switches the value.
  function showSetting(id, on) {
    $(id).setAttribute('aria-pressed', String(Boolean(on)));
    $(id).querySelector('.setting-value').textContent = on ? 'On' : 'Off';
  }
  $('setting-aim').querySelector('.setting-value').textContent = pullBehind ? 'Pull back' : 'Drag arrow';
  $('setting-aim').onclick = () => {
    pullBehind = !pullBehind;
    try { localStorage.setItem('ububall-aim-style', pullBehind ? 'pull' : 'drag'); } catch {}
    $('setting-aim').querySelector('.setting-value').textContent = pullBehind ? 'Pull back' : 'Drag arrow';
    updateFirstTurnGuide();
  };
  const stadium = document.querySelector('.stadium');
  const stageArea = document.querySelector('.stadium-stage-area');
  const spinLayer = document.createElement('div'); spinLayer.className = 'spin-layer';
  stageArea.append(spinLayer); spinLayer.append($('field-spin'));
  let scoreboardWidth = 0;
  new ResizeObserver(([entry]) => {
    if (Math.round(entry.contentRect.width) === scoreboardWidth) return;
    scoreboardWidth = Math.round(entry.contentRect.width); fitScorebug();
  }).observe(document.querySelector('.scoreboard'));
  document.fonts?.ready.then(() => fitScorebug());
  const knobRow = document.querySelector('.stadium-actions .knob-row');
  const rinkStage = document.querySelector('.rink-stage');
  const rinkWrap = document.querySelector('.rink-wrap');
  if (!isHomeShot()) { fieldView.castHidden = true; rinkWrap.classList.add('cast-away'); }
  fieldView.badgeCanvas = document.createElement('canvas'); fieldView.badgeCanvas.className = 'field-badges';
  fieldView.badgeCanvas.setAttribute('aria-hidden', 'true'); rinkWrap.append(fieldView.badgeCanvas);
  fieldView.badgeCtx = fieldView.badgeCanvas.getContext('2d');
  const btnFullscreen = $('btn-fullscreen'), btnRotate = $('btn-rotate');
  const radians = value => value * Math.PI / 180;
  const normalStats = () => ({
    impulse: 127, traction: 127, spin: 127, curve: 127,
    size: 127, mass: 127, bounciness: 127, grip: 127,
    power: 127, reach: 127, strength: 127, stability: 127,
    efficiency: 127, synergy: 127, chemistry: 127
  });
  let stats = [...roster, ...cpuTeam].map(p => ({ ...(p.model.stats || normalStats()) }));
  fieldView.entries = [...roster, ...cpuTeam];
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
  const {
    GOAL_WORDS, callText, MATERIAL_STYLES: materialStyles, GOAL_CALL_SECONDS, GUARD_SHIELD,
    createMaterialEmitters, createEffectsState, setMeterFill, mountSkaterSprites,
    impulseGeometry: calcImpulseGeometry, createRinkPresenter
  } = ububallPresentation;
  const {
    PRESENTATION_KEYS, stripPresentation, onlineOrder, viewIndex, applySeatTransform,
    transformSimSeat, viewFouls: projectFouls, createBodyProjector, createPlaybackDriver
  } = ububallPlayback;
  const {
    matchMvp, replayFileName, createStatsController
  } = ububallStats;
  const {
    anonymousName: formatAnonymousName, createReplayTheater
  } = ububallTheater;
  const anonymousName = i => formatAnonymousName(ububallReplay, i);
  const viewFouls = (f, seat) => projectFouls(ububallMatch, f, seat);
  const { projectBody, viewBodies, toViewBody, syncViewBodies, syncTickBodies } = createBodyProjector({
    P,
    getEntries: () => (typeof fieldView.entries !== 'undefined' ? fieldView.entries : null),
    getAnonymous: () => Boolean(typeof fieldView.anonymous !== 'undefined' && fieldView.anonymous),
    anonymousName: i => anonymousName(i),
    isClassicMode: () => classicMode(),
    resolveEquippedSuper: (entry, i) => resolveEquippedSuper(entry, i),
    getShownSim: () => shownSim(),
    getShownSeat: () => shownSeat(),
    getTargetBodies: () => fieldView.bodies,
    getDirtyMeters: () => dirtyMeters
  });
  let fieldEffects = createEffectsState([], materialStyles);
  let hitStopUntil = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let visibleRinkHeight = 600, themeColors = null;
  const impulseGeometry = (body, plan) => calcImpulseGeometry(P, body, plan);
  const presenter = createRinkPresenter({
    P,
    ububallMatch,
    ububallReplay,
    getView: () => fieldView,
    getEffects: () => fieldEffects,
    getActivePlayback: () => (typeof activePlayback !== 'undefined' ? activePlayback : null),
    getTheater: () => theater,
    getPhase: () => cast ? 'cast' : phase, // No aim arrows or selection while the cast skates off or on.
    getPlans: () => plans,
    getSelected: () => selected,
    getTurn: () => turn,
    getElapsed: () => elapsed,
    getFouls: () => fouls,
    getFoulInfo: () => foulInfo,
    getScoringPlayer: () => scoringPlayer,
    getGoalReplay: () => goalReplay,
    getOnline: () => online,
    getOnlineReplay: () => onlineReplay,
    isCardShot: () => cardShot,
    isMoving: () => {
      const activeReplay = typeof currentReplay === 'function' ? currentReplay() : theater;
      return phase === 'play' || Boolean(postGoal) || Boolean(goalReplay) || Boolean(activeReplay && !activeReplay.paused);
    },
    getGuide: () => (typeof guide !== 'undefined' ? guide : null),
    guideShown: (key, g) => guideShown(key, g),
    getSkaters: () => skaters,
    getRinkWrap: () => rinkWrap,
    getRenderSize: () => ({ renderWidth, renderHeight, deviceWidth, deviceHeight, visibleRinkHeight }),
    isReducedMotion: () => reducedMotion.matches,
    clockNow: () => clockNow(),
    gameAudio: () => gameAudio(),
    uiScale: () => gameUi.scale(),
    anonymousName: i => anonymousName(i),
    contactMeter: (a, b, speed) => contactMeter(a, b, speed),
    setHitStopUntil: until => { hitStopUntil = until; },
    onClearPostGoal: () => { postGoal = null; },
    onAssetLoad: () => { if (skaters.length) draw(); }
  });
  const {
    rinkLogo, clearEffects, updateEffects, emitSkaterEffects,
    ballOnFire, quench, lightNet, burst, steamRing,
    loopFanfare, stopFanfare, celebrate, popup, updatePopups,
    isCreasing, stalling, cornerTeams, foulsShowing, cornerWarningY, warningAt,
    trailPositions, clearDiscontinuousTrails, recordTrails,
    dirtyPrediction, badgePoint, rounded, line, circle,
    drawImpulse, drawSuperBadge, drawGuides, drawRinkSurface,
    handleCollision, handleWall, handleSuper, handleShockwave, impact
  } = presenter;
  function getThemeColors() {
    themeColors = presenter.getThemeColors();
    return themeColors;
  }
  getThemeColors();
  // Calls out the cards and the corner reset just given.
  function announceFouls() {
    for (const i of fouls.cards) popup(fieldView.bodies[i], 'Yellow card');
    for (const team of [0, 1]) {
      const carded = fouls.cards.filter(i => fieldView.bodies[i].team === team);
      if (carded.length === 1) bugTab(`Yellow card · ${fieldView.bodies[carded[0]].name || sideName(team)}`, { team });
      else if (carded.length) bugTab(`${carded.length} yellow cards · ${sideName(team)}`, { team });
    }
    for (const team of [0, 1]) if (fouls.crease[team]) bugTab(`Goal camping · ${sideName(team)}`, { team });
    if (fouls.cornerTurns === ububallMatch.FOULS.stallTurns) bugTab('Corner stalling');
    if (fouls.faceoff) bugTab('Corner reset');
    // The side with more ubus on the ice for the coming turn is on the power play.
    const out = [0, 1].map(team => fieldView.bodies.slice(0, 6).filter(b => b.team === team && b.carded).length);
    if (out[0] !== out[1]) { const team = out[0] < out[1] ? 0 : 1; bugTab(`Power play · ${sideName(team)}`, { team, colour: true }); }
    // A card whistles; a warning only just given sounds its alert.
    if (fouls.cards.length) gameAudio()?.playFoul('card');
    else if (fouls.crease[0] || fouls.crease[1] || fouls.cornerTurns === ububallMatch.FOULS.stallTurns) gameAudio()?.playFoul('warning');
  }
  function foulText() {
    const notes = [];
    if (fouls.faceoff) notes.push('Corner stalling: the ball is reset to centre ice.');
    for (const team of [0, 1]) {
      const carded = fouls.cards.filter(i => fieldView.bodies[i].team === team).length;
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
    const ubus = fieldView.bodies.slice(0, 6);
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
    if (cameraMove) { foulBox.hidden = true; return; }
    foulBox.hidden = false;
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
    const along = fieldView.portrait ? (far ? .27 : .73) : (far ? .7 : .3);
    foulBox.style.width = Math.min(340 * gameUi.scale(), fieldView.portrait ? f.width - 24 * gameUi.scale() : f.width * .46) + 'px';
    foulBox.style.maxHeight = (fieldView.portrait ? f.height * .5 : f.height) - 12 * gameUi.scale() + 'px';
    foulBox.style.left = f.left + f.width * (fieldView.portrait ? .5 : along) + 'px';
    foulBox.style.top = f.top + f.height * (fieldView.portrait ? along : .5) + 'px';
  }
  function kickoff(isNewMatch = false) {
    clearEffects(); fieldEffects.kickoffGlow = 1;
    play = ububallMatch.newPlay(); scoringPlayer = null; roundTurns = 0; fouls = ububallMatch.newFouls();
    fieldEffects.netFire = null;
    if (isNewMatch) { matchTicks = 0; tally = ububallMatch.newTally(); closeSummary(); }
    const oldBodies = authoritativeBodies || simBodies;
    authoritativeBodies = null;
    const result = P.kickoff();
    result.slice(0, 6).forEach((b, i) => {
      ububallMatch.applyStats(P, b, stats[i], fieldView.mode);
      const entry = fieldView.entries[i];
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
    fieldView.bodies.slice(0, 6).forEach(b => { b.superArm = false; });
    return fieldView.bodies;
  }
  let activeStatsContext = null;
  // The tally and scores as this view sees them (the home team first).
  function viewTally() {
    if (!online?.active) return { tally, scores };
    const t = online.state.game?.tally || ububallMatch.newTally(), seat = online.state.seat;
    const order = items => onlineOrder(items, seat);
    return { tally: { goals: order(t.goals), assists: order(t.assists), saves: order(t.saves), topSpeed: order(t.topSpeed), cards: order(t.cards),
      bigSaves: order(t.bigSaves || Array(6).fill(0)), checks: order(t.checks || Array(6).fill(0)), shots: order(t.shots || Array(6).fill(0)),
      deficit: seat ? [...t.deficit].reverse() : t.deficit }, scores };
  }
  function honourText(winner) {
    const { tally: t, scores: sc } = viewTally(), h = ububallMatch.honours(t, sc, winner);
    return (h.comeback ? ' A comeback from 3 down!' : '') + (h.shutout ? ' A shutout!' : '');
  }
  function closeSummary() {
    if ($('stats-dialog')?.open) $('stats-dialog').close();
    if ($('match-summary')?.open) $('match-summary').close();
  }
  function openSummary() {
    const summary = $('match-summary');
    if (demo || summary.open) return;
    const s = online?.state;
    const winner = s ? (s.winner == null ? null : s.winner === s.seat ? 0 : 1)
      : (scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1);
    const winnerName = winner === null ? null : $(winner ? 'opponent-label' : 'home-label').textContent;
    const { tally: t } = viewTally();
    const h = winner === null ? { comeback: false, shutout: false } : ububallMatch.honours(t, scores, winner);
    const mvp = matchMvp({ ...t, topShot: t.topSpeed });
    $('summary-score').textContent = scores.join(' – ');
    $('summary-winner').textContent = winner === null ? 'Match ended' : winner === 0 && !s?.spectator ? 'You win!' : `${winnerName} wins!`;
    $('summary-honours').textContent = s && s.game.winner == null ? (s.left?.some(Boolean) ? 'Opponent left' : 'Won by forfeit') :
      [h.comeback && 'Comeback from 3 down!', h.shutout && 'Shutout!'].filter(Boolean).join(' ');
    $('summary-mvp').textContent = mvp === null ? 'No MVP awarded' : `MVP · ${fieldView.entries[mvp].model.parts.fullName}`;
    $('summary-play-again').hidden = Boolean(s);
    $('summary-rematch').hidden = !s;
    if (s) updateRematch(s);
    else $('summary-rematch-status').textContent = '';
    summary.showModal();
  }
  // A save from a ball the saver's own team was most responsible for is a sheepish "Save..." with no meter.
  function creditSave(body, own, iron = false) {
    if (iron && body) body.ironGuard = true;
    popup(body, iron ? (own ? 'Trap!' : 'Big save!') : own ? 'Save...' : 'Save!');
    if (iron) {
      steamRing(body.x, body.y, body.radius);
      gameAudio()?.playIronSave?.();
    } else {
      gameAudio()?.playSave?.({ own: Boolean(own) });
    }
    if ((typeof phase !== 'undefined' && phase !== 'play') || own || online?.active || goalReplay || theater || (typeof activePlayback !== 'undefined' && activePlayback)) return;
    const idx = fieldView.bodies.indexOf(body);
    const simBody = idx >= 0 && simBodies[idx] ? simBodies[idx] : body;
    for (const changed of ububallMatch.gainMeter(P, simBodies, stats, simBody, ububallMatch.METER.save, classicMode())) {
      const cIdx = simBodies.indexOf(changed);
      const vb = cIdx >= 0 && fieldView.bodies[cIdx] ? fieldView.bodies[cIdx] : changed;
      vb.meter = changed.meter;
      dirtyMeters.add(vb);
    }
  }
  // Online meters come from the server; replays never earn meter.
  function contactMeter(a, b, speed) {
    if ((typeof phase !== 'undefined' && phase !== 'play') || online?.active || goalReplay || theater || (typeof activePlayback !== 'undefined' && activePlayback)) return;
    const tick = matchTicks + Math.round((elapsed + P.DT) / P.DT);
    const ia = fieldView.bodies.indexOf(a), ib = fieldView.bodies.indexOf(b);
    const sa = ia >= 0 && simBodies[ia] ? simBodies[ia] : a;
    const sb = ib >= 0 && simBodies[ib] ? simBodies[ib] : b;
    for (const changed of ububallMatch.contactMeter(P, simBodies, stats, sa, sb, speed, tick, classicMode())) {
      const cIdx = simBodies.indexOf(changed);
      const vb = cIdx >= 0 && fieldView.bodies[cIdx] ? fieldView.bodies[cIdx] : changed;
      vb.meter = changed.meter;
      dirtyMeters.add(vb);
    }
  }
  function flushMeters() {
    for (const body of dirtyMeters) {
      const fill = $(`super-fill-${body.playerIndex}`), pct = $(`super-pct-${body.playerIndex}`);
      if (fill) setMeterFill(fill, body.meter);
      if (pct) {
        const pctTxt = Math.floor(body.meter) + '%';
        if (pct.textContent !== pctTxt) pct.textContent = pctTxt;
      }
    }
    dirtyMeters.clear();
  }
  function say(message) { $('game-status').textContent = message; }
  function aimHelp() {
    return pullBehind
      ? 'Pull back from an ubu to aim in the opposite direction. Pull farther for more power.'
      : 'Drag from an ubu toward your target. Drag farther for more power.';
  }
  function updateFirstTurnGuide() {
    const visible = firstTurnStep !== null && shot === 'match' && !cameraMove && phase === 'plan' && !online?.active;
    $('first-turn-guide').hidden = !visible;
    if (!visible) return;
    if (!drag && plans.some(plan => plan.power > 0)) firstTurnStep = 'launch';
    const tip = firstTurnStep === 'launch'
      ? 'Aim any other ubus, then press Launch team. Both teams move together.'
      : pullBehind ? 'Pull back from an ubu to aim. Pull farther for more power.'
        : 'Drag from an ubu to aim. Drag farther for more power.';
    if ($('first-turn-tip').textContent !== tip) $('first-turn-tip').textContent = tip;
    positionFirstTurnGuide();
  }
  function positionFirstTurnGuide() {
    if (!firstTurnStep || !fieldBox) return;
    const guide = $('first-turn-guide');
    const top = stagePoint(fieldView.portrait ? { x: P.rink.right, y: 300 } : { x: 500, y: P.rink.top });
    guide.style.setProperty('--tip-x', top.x + 'px');
    guide.style.setProperty('--tip-y', Math.max(8, top.y + 10) + 'px');
    guide.style.setProperty('--tip-width', Math.max(130, fieldBox.width * .8) + 'px');
  }
  function animateFirstTurnGuide(time, active) {
    const arrow = $('first-turn-arrow');
    if (!active || shot !== 'match' || cameraMove || firstTurnStep !== 'aim' || phase !== 'plan' || drag !== null || online?.active || !fieldBox) {
      if (firstTurnStarted !== null) {
        firstTurnStarted = null; arrow.removeAttribute('d'); hideFinger();
      }
      return;
    }
    const body = fieldView.bodies[selected];
    if (!body) return;
    firstTurnStarted ??= time;
    const still = reducedMotion.matches, age = still ? 1550 : (time - firstTurnStarted) % 2500;
    if (age >= 2000) { arrow.removeAttribute('d'); hideFinger(); return; }
    const progress = Math.max(0, Math.min(1, (age - 450) / 850));
    const eased = 1 - (1 - progress) ** 3;
    const sample = impulseGeometry(body, { angle: 0, power: .65 });
    const distance = (pullBehind ? 84 : sample.distance) * eased;
    const impulse = impulseGeometry(body, { angle: 0, power: aimPower(distance, sample) });
    placeFinger(body.x + (pullBehind ? -distance : distance), body.y);
    const finger = $('demo-finger');
    finger.toggleAttribute('hidden', false);
    finger.classList.toggle('pressed', !still && age >= 300 && age < 1400);
    if (!impulse.visible) { arrow.removeAttribute('d'); return; }
    const from = stagePoint({ x: body.x + impulse.ringR, y: body.y }), to = stagePoint(impulse);
    const top = stagePoint({ x: impulse.x - 13, y: impulse.y - 8 });
    const bottom = stagePoint({ x: impulse.x - 13, y: impulse.y + 8 });
    arrow.setAttribute('d', `M${from.x} ${from.y} L${to.x} ${to.y} M${top.x} ${top.y} L${to.x} ${to.y} L${bottom.x} ${bottom.y}`);
  }
  function closeFirstTurnGuide(remember = false) {
    if (remember && firstTurnStep !== null) {
      firstTurnSeen = true;
      try { localStorage.setItem(firstTurnKey, 'seen'); } catch {}
    }
    if (firstTurnStep !== null) {
      firstTurnStep = null;
      animateFirstTurnGuide(0, false);
    }
    $('first-turn-guide').hidden = true;
  }
  $('skip-first-turn-guide').onclick = () => {
    closeFirstTurnGuide(true);
    $('launch').focus();
  };
  function prepareCPU(initialPlans = null) {
    const generation = ++cpuGeneration;
    cpuDone = false;
    cpuClient.cancel();
    if (online?.active) return;
    cpu = Array.isArray(initialPlans) && initialPlans.length === 3 ? initialPlans : P.cpuPlans(simBodies, () => .5, scores);
    cpuReady = cpuClient.plan({ version: ububallMatch.VERSION, mode: fieldView.mode, bodies: simBodies, stats, scores, turn, fouls, clock: matchTicks, roundTurns, play: ububallMatch.newPlay(play) },
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
  function restartClassAnimation(el, cls, durationMs = 0) {
    if (!el) return;
    if (!el.classList.contains?.(cls)) {
      el.classList.add(cls);
      return;
    }
    const anims = typeof el.getAnimations === 'function' ? el.getAnimations() : null;
    if (anims && anims.length) {
      for (const a of anims) {
        if (durationMs > 0) a.effect?.updateTiming?.({ duration: durationMs });
        a.cancel?.();
        a.play?.();
      }
    } else {
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    }
  }
  function banner(text, ms = 1200, tone = '') {
    const el = $('field-banner');
    clearTimeout(bannerTimer); bannerGone?.();
    if (el.textContent !== text) el.textContent = text;
    if (el.dataset.tone !== tone) el.dataset.tone = tone;
    el.style.setProperty('--banner-ms', ms + 'ms');
    restartClassAnimation(el, 'show', ms);
    return new Promise(resolve => {
      bannerGone = resolve;
      bannerTimer = setTimeout(() => { el.classList.remove('show'); bannerGone = null; resolve(); }, ms);
    });
  }
  // Between turns, guarding ubus stay on guard (keeping their faded arrow); otherwise plans clear.
  function resetPlans(keepGuard = false) {
    dirtyPrediction();
    startPlanClock();
    if (!online?.active) planBanner = banner('Plan your shot…', 1300, 'plan');
    plans = Array.from({ length: 3 }, (_, i) => keepGuard && plans?.[i]?.guard ? { ...plans[i] } : idlePlan());
    prepareCPU(); // Snapshot before any human planning input.
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
    wrap.append(fullBox);
    return wrap;
  }
  // An ubu's super: its name, meter and charge. Arming is done from the dock.
  function renderSuperPanel(playerIndex) {
    const wrap = document.createElement('div'); wrap.className = 'super-panel'; wrap.id = `super-panel-${playerIndex}`;
    const topRow = document.createElement('div'); topRow.className = 'super-row';
    const label = document.createElement('span'); label.className = 'super-name-badge'; label.id = `super-name-${playerIndex}`;
    const initialSuper = fieldView.bodies?.[playerIndex]?.equippedSuper || fieldView.entries[playerIndex]?.equippedSuper || P.SUPERS[0];
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
    pct.textContent = `${Math.round(fieldView.bodies?.[playerIndex]?.meter ?? 0)}%`;
    topRow.append(label, pct);
    const meterTrack = document.createElement('div'); meterTrack.className = 'super-meter-track';
    const meterFill = document.createElement('i'); meterFill.className = 'super-meter-fill'; meterFill.id = `super-fill-${playerIndex}`;
    setMeterFill(meterFill, fieldView.bodies?.[playerIndex]?.meter ?? 0);
    meterTrack.append(meterFill);
    wrap.append(topRow, meterTrack);
    return wrap;
  }
  // Up and right increase each knob. Angle wraps and its needle follows the launch direction.
  const KNOB_SWEEP = 150, knobs = [];
  const KNOB_RANGE = { angle: [0, 360], power: [0, 100], spin: [-100, 100] };
  // Screen degrees, clockwise from up, of a field angle in radians (portrait turns the rink a quarter).
  const screenDegrees = angle => ((angle * 180 / Math.PI + 90 - (fieldView.portrait ? 90 : 0)) % 360 + 360) % 360;
  function knobValue(kind, i) {
    const plan = plans[i];
    return kind === 'angle' ? screenDegrees(plan.angle) : kind === 'power' ? plan.power * 100 : (plan.spin || 0) * 100;
  }
  const knobEditable = i => phase === 'plan' && Boolean(plans[i] && fieldView.bodies[i] && !fieldView.bodies[i].stunned && !fieldView.bodies[i].carded);
  function setKnob(kind, i, value, deferDraw = false) {
    if (!knobEditable(i)) return;
    const plan = plans[i], [min, max] = KNOB_RANGE[kind];
    if (kind === 'angle') plan.angle = (((value - 90 + (fieldView.portrait ? 90 : 0)) % 360 + 360) % 360) * Math.PI / 180;
    else plan[kind] = Math.max(min, Math.min(max, value)) / 100;
    plan.guard = false;
    if (deferDraw) { dragDirty = true; return; }
    sync(); draw();
  }
  function wheelKnob(e, kind, i) {
    if (!e.deltaY || !knobEditable(i)) return;
    e.preventDefault();
    setKnob(kind, i, knobValue(kind, i) - Math.sign(e.deltaY) * (e.shiftKey ? 10 : 1), typeof requestAnimationFrame === 'function');
    scheduleSaveActiveMatch();
  }
  function makeKnob(kind) {
    const wrap = document.createElement('div'); wrap.className = 'knob';
    wrap.innerHTML = '<svg viewBox="0 0 100 100" role="slider" tabindex="0"><circle class="knob-track" cx="50" cy="50" r="40"/>' +
      '<path class="knob-value"/><circle class="knob-face" cx="50" cy="50" r="29"/><line class="knob-needle" x1="50" y1="50" x2="50" y2="26"/></svg>' +
      `<b></b><small>${kind[0].toUpperCase() + kind.slice(1)}</small>`;
    const svg = wrap.querySelector('svg');
    const [min, max] = KNOB_RANGE[kind];
    svg.setAttribute('aria-valuemin', min); svg.setAttribute('aria-valuemax', max);
    let grab = null;
    svg.onpointerdown = e => {
      if (grab || e.button !== 0 || !knobEditable(selected)) return;
      e.preventDefault(); svg.setPointerCapture(e.pointerId);
      grab = { id: e.pointerId, index: selected, x: e.clientX, y: e.clientY, value: knobValue(kind, selected) };
    };
    svg.onpointermove = e => {
      if (grab?.id !== e.pointerId) return;
      const distance = (e.clientX - grab.x) - (e.clientY - grab.y);
      setKnob(kind, grab.index, grab.value + distance / (KNOB_SWEEP * gameUi.scale()) * (max - min) * (e.shiftKey ? .25 : 1), typeof requestAnimationFrame === 'function');
    };
    svg.onlostpointercapture = () => {
      grab = null;
      if (dragDirty) { dragDirty = false; sync(); draw(); }
      if (phase === 'plan') saveActiveMatch();
    };
    svg.addEventListener('wheel', e => wheelKnob(e, kind, selected), { passive: false });
    svg.onkeydown = e => {
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault(); setKnob(kind, selected, knobValue(kind, selected) + step * (e.shiftKey ? 10 : 1), Boolean(e.repeat && typeof requestAnimationFrame === 'function'));
      if (phase === 'plan') { if (e.repeat) scheduleSaveActiveMatch(); else saveActiveMatch(); }
    };
    if (kind === 'spin') svg.ondblclick = () => { setKnob(kind, selected, 0); if (phase === 'plan') saveActiveMatch(); };
    knobs.push({ kind, wrap, svg });
    return wrap;
  }
  function knobArc(from, to) {
    const point = a => [50 + 40 * Math.sin(a * Math.PI / 180), 50 - 40 * Math.cos(a * Math.PI / 180)];
    const [x0, y0] = point(from), [x1, y1] = point(to);
    return `M${x0} ${y0}A40 40 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  }
  knobRow.append(...['angle', 'power', 'spin'].map(makeKnob));
  function renderKnobs() {
    for (const knob of knobs) {
      const i = selected, b = fieldView.bodies[i];
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
      knob.svg.setAttribute('aria-label', `${knob.kind[0].toUpperCase() + knob.kind.slice(1)} for ${fieldView.entries[i]?.model?.parts.fullName || 'ubu'}`);
      knob.svg.setAttribute('aria-valuenow', Math.round(value));
      knob.svg.setAttribute('aria-valuetext', knob.kind === 'angle' ? `${shown} degrees` : knob.kind === 'power' ? `${shown}% power` :
        shown === 0 ? 'No spin' : `${Math.abs(shown)}% ${shown < 0 ? 'counterclockwise' : 'clockwise'}`);
    }
  }
  function sync() {
    const _tSync = bench?.rec ? performance.now() : 0;
    updateFirstTurnGuide();
    updateClock();
    const planning = phase === 'plan';
    const isGoal = phase === 'goal';
    $('phase').textContent = phase === 'replay' ? 'Replay' : phase === 'over' ? 'Final' : planning ? 'Plan' : isGoal ? 'Goal' : phase === 'cpu-wait' ? 'CPU' :
      phase === 'waiting' ? onlineDisconnected ? 'Rejoining' : online?.state?.connected.includes(false) ? 'Offline' : 'Waiting' : 'In play';
    $('turn-label').textContent = turn;
    for (const team of [0, 1]) {
      // A goal pops the score; a side reaching 4 goals is on match point.
      if (scores[team] > shownScores[team]) {
        const cell = $(team ? 'away-score' : 'home-score').parentElement;
        restartClassAnimation(cell, 'scored');
      }
      if (scores[team] === 4 && shownScores[team] === 3 && phase !== 'over') bugTab(`Match point · ${sideName(team)}`, { team, colour: true });
      shownScores[team] = scores[team];
      $(team ? 'away-score' : 'home-score').textContent = scores[team];
    }
    const curB = fieldView.bodies[selected];
    const isDisabled = Boolean(curB?.stunned || curB?.carded);
    if (isDisabled) {
      plans[selected].power = plans[selected].spin = 0;
    }
    for (const id of ['shot-spin', 'spin-less', 'spin-more']) $(id).disabled = !knobEditable(selected);
    $('launch').disabled = phase === 'play' || phase === 'cpu-wait';
    document.querySelector('.stadium')?.classList.toggle('goal-phase', isGoal);
    $('launch-label').textContent = isGoal ? 'Next kickoff' : phase === 'over' ? 'New match' : phase === 'play' ? 'In motion…' : phase === 'cpu-wait' ? 'CPU planning…' : 'Launch team';
    $('shot-guard').disabled = $('shot-reset').disabled = !knobEditable(selected);
    $('shot-guard').setAttribute('aria-pressed', String(planning && Boolean(plans[selected]?.guard)));
    const actions = { aimed: 0, guarding: 0, idle: 0 };
    const spinValue = Math.round((plans[selected].spin || 0) * 100);
    $('shot-spin').value = spinValue;
    $('shot-spin').style.setProperty('--spin-start', Math.min(50, (spinValue + 100) / 2) + '%');
    $('shot-spin').style.setProperty('--spin-end', Math.max(50, (spinValue + 100) / 2) + '%');
    $('shot-spin').setAttribute('aria-valuetext', spinValue === 0 ? 'No spin' : `${Math.abs(spinValue)}% ${spinValue < 0 ? 'counterclockwise' : 'clockwise'}`);
    $('shot-spin').setAttribute('aria-label', `Spin for ${fieldView.entries[selected].model.parts.fullName}`);
    [...$('team').children].forEach((button, i) => {
      button.classList.toggle('selected', i === selected);
      const select = button.querySelector('.card-select');
      select.setAttribute('aria-pressed', String(i === selected)); select.disabled = !planning;
      const body = fieldView.bodies[i], plan = plans[i];
      const canAct = body && !body.carded && !body.stunned;
      const guarded = canAct && (planning ? plan.guard : phase === 'play' && body.guarding);
      const aimed = canAct && (plan.power > 0 || plan.spin || body.superArm);
      actions[guarded ? 'guarding' : aimed ? 'aimed' : 'idle']++;
      const shield = button.querySelector('.card-guard');
      shield.disabled = !knobEditable(i);
      shield.setAttribute('aria-pressed', String(Boolean(guarded)));
      const small = button.querySelector('small');
      if (small) {
        const spin = Math.round((plan.spin || 0) * 100);
        const dazeCut = body && P.dazeSlow ? Math.round(P.dazeSlow(body) * 100) : 0;
        if (body?.carded) small.textContent = 'Yellow card · sits out this turn';
        else if (body?.stunned) small.textContent = 'Stunned this turn';
        else if (guarded) small.textContent = dazeCut ? `Guarding · Dazed (-${dazeCut}%)` : 'Guarding';
        else if (!aimed) {
          const idleLabel = archetypeOfModel(fieldView.entries[i]?.model) || 'Idle';
          small.textContent = dazeCut ? `${idleLabel} · Dazed (-${dazeCut}%)` : idleLabel;
        }
        else small.textContent = `${Math.round(plan.power * 100)}% power · ${spin ? spin + '% spin' : 'no spin'}${dazeCut ? ` · Dazed (-${dazeCut}%)` : ''}`;
      }
    });
    const hasMoves = Boolean(actions.aimed || actions.guarding);
    $('launch-plan').hidden = !planning || !hasMoves;
    $('launch-plan').textContent = planning && hasMoves
      ? Object.entries(actions).filter(([, count]) => count).map(([action, count]) => count + ' ' + action).join(' · ') : '';
    if (planning && !hasMoves) $('launch').dataset.tip = 'No moves are planned.';
    else delete $('launch').dataset.tip;
    fieldView.bodies.slice(0, 6).forEach((b, i) => {
      const awayCard = i >= 3 ? $(`player-${i}`) : null;
      const shield = awayCard?.querySelector('.card-guard');
      if (shield) shield.hidden = phase !== 'play' || !b.guarding;
      if (awayCard) {
        const awaySmall = awayCard.querySelector('small.away');
        if (awaySmall) {
          const dazeCut = b && P.dazeSlow ? Math.round(P.dazeSlow(b) * 100) : 0;
          const baseLabel = archetypeOfModel(fieldView.entries[i]?.model) || $('opponent-label').textContent;
          awaySmall.textContent = b.carded ? 'Yellow card · sits out this turn'
            : b.stunned ? 'Stunned this turn'
            : dazeCut ? `${baseLabel} · Dazed (-${dazeCut}%)`
            : baseLabel;
        }
      }
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
      if (!superHintSeen && !demo && !theater && !classicMode() && planning && curB.meter >= 100 && !curB.superArm && knobEditable(selected)) {
        superHintSeen = true;
        superHintFor = curB;
        try { localStorage.setItem('ububall-super-hint', 'seen'); } catch {}
      }
      if (!planning || curB.superArm) superHintFor = null;
      const hint = $('super-ready-hint');
      hint.hidden = superHintFor !== curB;
      if (!hint.hidden) hint.textContent = 'Super ready';
      if (hudSuperIcon && s?.icon) {
        if (hudSuperIcon.getAttribute('src') !== s.icon) hudSuperIcon.src = s.icon;
        if (hudSuperIcon.alt !== sName) hudSuperIcon.alt = sName;
        const masteryBonus = s.copies > 1 ? ` (+${(s.bonusTicks / 240).toFixed(1)}s duration, +${s.bonusRefund}% refund)` : '';
        hudSuperIcon.dataset.tip = `${sName}: ${s.desc}${masteryBonus}`;
      }
      const canArm = planning && (curB.meter >= 100) && knobEditable(selected);
      hudSuperBtn.disabled = !canArm;
      hudSuperBtn.setAttribute('aria-pressed', String(Boolean(curB.superArm)));
      hudSuperBtn.classList.toggle('armed', Boolean(curB.superArm));
      if (hudSuperText) {
        if (curB.carded) {
          hudSuperText.textContent = 'Carded';
        } else if (curB.stunned) {
          hudSuperText.textContent = 'Stunned';
        } else if (curB.superArm) {
          hudSuperText.textContent = 'Armed';
        } else if (curB.meter >= 100) {
          hudSuperText.textContent = `Arm ${s.name}`;
        } else {
          hudSuperText.textContent = `${s.name} ${Math.floor(curB.meter || 0)}%`;
        }
      }
    }
    renderKnobs();
    if (online?.active) {
      $('launch').disabled = phase !== 'plan';
      $('launch-label').textContent = phase === 'plan' ? 'Lock moves' : phase === 'play' ? 'In motion…' : phase === 'over' ? 'Match complete' : 'Waiting…';
      $('new-match').disabled = true;
      $('launch').hidden = online.spectating || phase === 'over';
    }
    if (bench?.rec) bench.rec.syncMs += (performance.now() - _tSync);
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
    portrait.append(ubuRender.spriteImg ? ubuRender.spriteImg(entry.model, 'ball-thumb', 256) : ubuRender(entry.model, 'ball-thumb'));
    portrait.onclick = () => openStatDrawer(i);
    return portrait;
  }
  const archetypeOfModel = model => (typeof ubuArchetype !== 'undefined' && model ? ubuArchetype.format(model) : '');
  function openStatDrawer(i) {
    if (drawerClosed.player === i && performance.now() - drawerClosed.at < 400) return;
    const entry = fieldView.entries[i], close = document.createElement('button');
    close.type = 'button'; close.className = 'icon-button'; close.setAttribute('aria-label', 'Close stats'); close.append(gameUi.icon('x'));
    close.onclick = () => statDrawer.hidePopover();
    const titles = document.createElement('div'); titles.className = 'card-titles';
    const sideText = $(i < 3 ? 'home-label' : 'opponent-label').textContent;
    const archText = archetypeOfModel(entry?.model);
    titles.append(Object.assign(document.createElement('strong'), { textContent: entry.model.parts.fullName }),
      Object.assign(document.createElement('small'), { textContent: [archText, sideText].filter(Boolean).join(' · ') }));
    const head = document.createElement('div'); head.className = 'stat-drawer-head';
    head.append(ubuRender.spriteImg ? ubuRender.spriteImg(entry.model, 'stat-drawer-art', 256) : ubuRender(entry.model, 'stat-drawer-art'), titles, close);
    const box = renderStatsBox(stats[i] || entry.model.stats || {});
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
  if (inDiscord) $('btn-sidebars').hidden = true;
  else {
    let sidebarsShown = true;
    try { sidebarsShown = localStorage.getItem('ububall.sidebars') !== 'hidden'; } catch {}
    showSidebars(sidebarsShown);
    $('btn-sidebars').onclick = () => {
      showSidebars(document.body.classList.contains('sidebars-hidden'));
      layoutDirty = true;
      draw();
    };
  }
  function buildTeam() {
    if (statDrawer.matches(':popover-open')) statDrawer.hidePopover();
    fieldEffects.materialEmitters = createMaterialEmitters(fieldView.entries, materialStyles);
    $('team').replaceChildren();
    $('home-lineup').replaceChildren();
    if ($('cpu-team')) $('cpu-team').replaceChildren();
    fieldView.entries.forEach((entry, i) => {
      if (entry.model && entry.model.stats) stats[i] = classicMode() ? normalStats() : { ...entry.model.stats };
    });
    skaters = mountSkaterSprites($('skaters'), fieldView.entries, ubuRender);
    fieldView.entries.slice(0, 3).forEach((entry, i) => {
      const button = document.createElement('div'); button.className = 'team-card'; button.id = `player-${i}`;
      const select = document.createElement('button'); select.type = 'button'; select.className = 'card-select';
      const titles = document.createElement('div'); titles.className = 'card-titles';
      const strong = document.createElement('strong'); strong.textContent = entry.model.parts.fullName;
      const small = document.createElement('small'); small.textContent = archetypeOfModel(entry.model) || 'Idle';
      select.append(strong, small);
      const shield = document.createElement('button'); shield.type = 'button'; shield.className = 'card-guard guard-toggle';
      shield.setAttribute('aria-label', 'Guard with ' + entry.model.parts.fullName);
      shield.append(gameUi.icon('shield'));
      shield.onclick = () => toggleGuard(i);
      titles.append(select, shield);
      const header = document.createElement('div'); header.className = 'card-header';
      header.append(cardPortrait(entry, i), titles);
      button.append(header, renderSuperPanel(i));
      select.onclick = () => { selected = i; sync(); draw(); };
      $('team').append(button);
      const lineup = document.createElement('div'); lineup.className = 'home-ubu';
      const homeArch = archetypeOfModel(entry.model);
      lineup.append(ubuRender.spriteImg ? ubuRender.spriteImg(entry.model, 'home-ubu-art', 256) : ubuRender(entry.model, 'home-ubu-art'),
        Object.assign(document.createElement('strong'), { textContent: entry.model.parts.fullName }),
        ...(homeArch ? [Object.assign(document.createElement('span'), { className: 'home-ubu-archetype', textContent: homeArch })] : []));
      const superInfo = classicMode() ? null : entry.equippedSuper || resolveEquippedSuper(entry, i);
      if (superInfo) {
        const superLabel = document.createElement('small');
        superLabel.append(Object.assign(document.createElement('img'), { src: superInfo.icon, alt: '' }), superInfo.displayName || superInfo.name);
        lineup.append(superLabel);
      }
      $('home-lineup').append(lineup);
    });
    if ($('cpu-team')) {
      fieldView.entries.slice(3, 6).forEach((entry, idx) => {
        const i = idx + 3;
        const card = document.createElement('div'); card.className = 'team-card cpu-card'; card.id = `player-${i}`;
        const header = document.createElement('div'); header.className = 'card-header';
        const titles = document.createElement('div'); titles.className = 'card-titles';
        const strong = document.createElement('strong'); strong.textContent = entry.model.parts.fullName;
        const small = document.createElement('small'); small.className = 'away'; small.textContent = archetypeOfModel(entry.model) || $('opponent-label').textContent;
        const name = document.createElement('div'); name.className = 'card-select'; name.append(strong, small);
        const shield = document.createElement('span'); shield.className = 'card-guard'; shield.hidden = true;
        shield.setAttribute('role', 'img'); shield.setAttribute('aria-label', 'Guarding'); shield.append(gameUi.icon('shield'));
        titles.append(name, shield);
        header.append(cardPortrait(entry, i), titles);
        card.append(header, renderSuperPanel(i));
        $('cpu-team').append(card);
      });
    }
  }
  function restoreEntry(saved) {
    if (!saved || !saved.dna) return null;
    const hasSuper = saved.equippedSuper?.id != null;
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
    if (typeof cancelScheduledSave === 'function') cancelScheduledSave();
    try { localStorage.removeItem('ububall-active-match'); } catch {}
  }
  function saveActiveMatch(launchState = null) {
    if (typeof cancelScheduledSave === 'function') cancelScheduledSave();
    if (inDiscord) return;
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
        mode: fieldView.mode,
        level: cpuLevel,
        scores: [...scores],
        turn,
        phase: launchState ? 'play' : phase,
        fouls: { crease: [...fouls.crease], corner: fouls.corner, cornerTurns: fouls.cornerTurns, cards: [...(fouls.cards || [])] },
        tally,
        play: ububallMatch.newPlay(play),
        roundTurns,
        matchTicks,
        roster: roster.map(entryData),
        teamEntries: fieldView.entries.map(entryData),
        bodies: ububallReplay.snapshot(activeSim),
        turnPlans: launchState ? launchState.turnPlans : null,
        plans: launchState ? null : (Array.isArray(plans) ? plans.map((p, i) => ({ angle: p.angle, power: p.power, spin: p.spin || 0, superArm: Boolean(fieldView.bodies[i]?.superArm || p.superArm), guard: Boolean(p.guard) })) : null),
        cpu: launchState ? null : (Array.isArray(cpu) ? cpu.map(p => ({ angle: p.angle, power: p.power, spin: p.spin || 0, superArm: Boolean(p.superArm), guard: Boolean(p.guard) })) : null),
        cpuDone: launchState ? false : Boolean(cpuDone),
        recording: recording || null
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
      fieldView.mode = cpuMode;
      const radio = document.querySelector(`input[name="cpu-level"][value="${cpuLevel}"]`);
      if (radio) radio.checked = true;
      document.body.classList.toggle('classic-match', classicMode());
      showMode(fieldView.mode);

      roster = saved.roster.map(restoreEntry);
      draft = [...roster];
      fieldView.entries = saved.teamEntries.map(restoreEntry);
      stats = fieldView.entries.map(entry => classicMode() ? normalStats() : { ...(entry?.model?.stats || normalStats()) });
      stopFanfare();
      gameAudio()?.stop();

      scores = [...saved.scores];
      turn = saved.turn;
      fouls = { ...ububallMatch.newFouls(), ...saved.fouls };
      tally = saved.tally || ububallMatch.newTally();
      recording = saved.recording || ububallReplay.create({ mode: fieldView.mode, names: ['You', 'CPU'], ubus: fieldView.entries.map(e => ({ dna: e.dna, super: e.equippedSuper?.id ?? null })) });
      play = ububallMatch.newPlay(saved.play);
      // Older snapshots lack attribution. Use completed turns for the clock and round position.
      matchTicks = saved.matchTicks ?? 0;
      roundTurns = saved.roundTurns ?? 0;
      if (saved.matchTicks == null || saved.roundTurns == null) {
        let ticks = 0, turns = 0;
        for (const entry of recording.turns) {
          if (!entry.ticks) continue;
          ticks += entry.ticks;
          turns = entry.goal ? 0 : turns + 1;
        }
        matchTicks = saved.matchTicks ?? ticks;
        roundTurns = saved.roundTurns ?? turns;
      }
      const restored = ububallReplay.restore(saved.bodies);
      if (saved.matchTicks == null) {
        for (const b of restored) if (b.meterTick > matchTicks) delete b.meterTick;
      }
      buildTeam();
      restored.slice(0, 6).forEach((b, i) => {
        const entry = fieldView.entries[i];
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
  function newMatch(playJingle = false, team = draft) {
    if (typeof clearReplayViewer === 'function') clearReplayViewer();
    authoritativeBodies = null;
    endGoalReplay(); playSegments = []; saveRecording();
    fieldView.mode = cpuMode;
    document.body.classList.toggle('classic-match', classicMode());
    showMode(fieldView.mode);
    cpuTeam = starterEntries('cpu', 'CPU ubu');
    stats = [...team, ...cpuTeam].map(entry => classicMode() ? normalStats() : { ...(entry.model.stats || normalStats()) });
    stopFanfare(); gameAudio()?.stop();
    roster = [...team]; fieldView.entries = [...roster, ...cpuTeam]; fieldView.bodies = kickoff(true); buildTeam(); scores = [0, 0]; turn = 1; selected = 0; phase = 'plan'; elapsed = accumulator = 0; drag = null;
    if (!demo) {
      recording = ububallReplay.create({ mode: fieldView.mode, names: ['You', 'CPU'], ubus: fieldView.bodies.slice(0, 6).map((b, i) => ({ dna: fieldView.entries[i].dna, super: b.equippedSuper?.id ?? null })) });
    }
    resetPlans();
    if (!demo) saveActiveMatch();
    say('Drag from an ubu toward your target to aim. Drag its arrowhead to adjust power and direction.'); draw();
    if (playJingle) gameAudio()?.playGameStart?.();
  }
  function aimPower(distance, arrow) {
    const power = pullBehind ? (distance - 6) / 120 : (distance - arrow.ringR) / arrow.scale;
    return Math.max(0, Math.min(1, power));
  }
  function boxPoint(r, p) {
    return fieldView.portrait ? { x: r.left + p.y / 600 * r.width, y: r.top + (1 - p.x / 1000) * r.height }
      : { x: r.left + p.x / 1000 * r.width, y: r.top + p.y / 600 * r.height };
  }
  const screenPoint = p => boxPoint(fieldView.canvas.getBoundingClientRect(), p);
  function fieldTarget(event) {
    const near = p => { const q = screenPoint(p); return Math.hypot(q.x - event.clientX, q.y - event.clientY) <= 22 * gameUi.scale(); };
    const own = fieldView.bodies.slice(0, 3);
    const arrow = own.findIndex((b, i) => { const a = impulseGeometry(b, plans[i]); return a.visible && near(a); });
    if (arrow >= 0) return { mode: 'arrow', index: arrow };
    const p = point(event);
    return { mode: 'aim', index: own.findIndex(b => !b.stunned && !b.carded && Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 12) };
  }
  // The rink's box within the stage and the spin control's size, measured only when layout changes
  // (and without the rink shake), so placing the control never forces the page to lay out again.
  let fieldBox = null;
  function measureField() {
    const r = fieldView.canvas.getBoundingClientRect(), stage = stageArea.getBoundingClientRect(), control = $('field-spin');
    fieldBox = { left: r.left - stage.left - fieldEffects.shakeX, top: r.top - stage.top - fieldEffects.shakeY, width: r.width, height: r.height,
      stageWidth: stage.width, stageHeight: stage.height, controlWidth: control.offsetWidth, controlHeight: control.offsetHeight };
    positionFirstTurnGuide();
  }
  // A field point in the stage's coordinates (screenPoint, without reading the page).
  const stagePoint = p => boxPoint(fieldBox, p);
  function positionSpinControl() {
    const control = $('field-spin');
    if (control.hidden) control.hidden = false;
    const visible = shot === 'match' && !cameraMove && phase === 'plan' && drag === null && spinSlider;
    const vis = visible ? 'visible' : 'hidden';
    if (control._lastVis !== vis) { control._lastVis = vis; control.style.visibility = vis; }
    const nextInert = !visible;
    if (control.inert !== nextInert) control.inert = nextInert;
    if (!visible) return;
    const b = fieldView.bodies[selected], center = stagePoint(b), r = fieldBox;
    const radius = b.radius * (fieldView.portrait ? r.height / 1000 : r.width / 1000);
    const width = r.controlWidth, height = r.controlHeight;
    const arrow = stagePoint(impulseGeometry(b, plans[selected]));
    // Prefer the side opposite the arrow, then clamp inside the stage near the edges.
    let y = arrow.y > center.y + 8 * gameUi.scale() ? center.y - radius - height - 24 * gameUi.scale() : center.y + radius + 5 * gameUi.scale();
    const x = Math.max(6 * gameUi.scale(), Math.min(r.stageWidth - width - 6 * gameUi.scale(), center.x - width / 2));
    y = Math.max(6 * gameUi.scale(), Math.min(r.stageHeight - height - 6 * gameUi.scale(), y));
    const xf = `translate3d(${x}px, ${y}px, 0)`;
    if (control._lastXf !== xf) { control._lastXf = xf; control.style.transform = xf; }
  }
  let collectionShownLength = 1000, collectionTargetLength = 1000, collectionLengthRaf = 0;
  let collectionRotateHold = false, collectionLengthOverride = null, collectionShrinkingBox = null;
  function stepCollectionLength() {
    collectionLengthRaf = 0;
    if (shot !== 'collection' || collectionLengthOverride !== null || collectionRotateHold) return;
    const diff = collectionTargetLength - collectionShownLength;
    if (Math.abs(diff) <= 1.5 || reducedMotion.matches) {
      collectionShownLength = collectionTargetLength;
      rinkStage.style?.removeProperty?.('--collection-hold-h');
      layoutDirty = true;
      draw();
      return;
    }
    collectionShownLength += diff * 0.24;
    if (rinkStage.clientWidth > 0) {
      rinkStage.style?.setProperty?.('--collection-hold-h', Math.round(rinkStage.clientWidth * collectionShownLength / 600) + 'px');
    }
    layoutDirty = true;
    draw();
    if (typeof requestAnimationFrame === 'function') collectionLengthRaf = requestAnimationFrame(stepCollectionLength);
  }
  function fitStadium() {
    if (!stageArea || !rinkStage || !rinkWrap) return;
    if (collectionShrinkingBox) {
      visibleRinkHeight = 600;
      const { width: sw, height: sh, length: sl } = collectionShrinkingBox;
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      const wrapH = Math.max(120, Math.min(sh, vh));
      rinkStage.style.width = sw + 'px';
      rinkStage.style.height = sh + 'px';
      rinkWrap.style.width = '100%';
      rinkWrap.style.height = wrapH + 'px';
      rinkWrap.style.marginBottom = -wrapH + 'px';
      rinkWrap.style.top = '';
      rinkWrap.style.left = '';
      rinkWrap.style.transform = '';
      fieldView.collectionPortrait = { length: sl, viewTop: 0, viewSpan: 600 * (wrapH / Math.max(1, sw)) };
      return;
    }
    if (shot === 'collection') {
      visibleRinkHeight = 600;
      rinkStage.style.width = '';
      rinkStage.style.height = '';
      const stageW = Math.max(120, rinkStage.clientWidth || stageArea.clientWidth || stadium?.clientWidth || 600);
      const minH = Math.round(stageW * 5 / 3);
      if (collectionRotateHold) {
        rinkWrap.style.width = '100%';
        rinkWrap.style.height = minH + 'px';
        rinkWrap.style.marginBottom = -minH + 'px';
        rinkWrap.style.top = '';
        rinkWrap.style.left = '';
        rinkWrap.style.transform = '';
        collectionShownLength = collectionTargetLength = 1000;
        fieldView.collectionPortrait = { length: 1000, viewTop: 0, viewSpan: 1000 };
        return;
      }
      const naturalH = Math.max(minH, $('collection-world')?.offsetHeight || rinkStage.offsetHeight || minH);
      const desiredLength = Math.max(1000, 600 * (naturalH / stageW));
      if (collectionLengthOverride !== null) {
        collectionShownLength = collectionTargetLength = Math.max(1000, collectionLengthOverride);
      } else if (!collectionShownLength || reducedMotion.matches) {
        collectionShownLength = collectionTargetLength = desiredLength;
      } else if (Math.abs(desiredLength - collectionTargetLength) > 1.5) {
        if (desiredLength < collectionShownLength - 2) {
          const vh = window.innerHeight || 800;
          const sr = rinkStage.getBoundingClientRect();
          const visBottomPx = Math.max(minH, Math.min(stageW * collectionShownLength / 600, vh - sr.top + 180));
          collectionShownLength = Math.min(collectionShownLength, Math.max(desiredLength, 600 * (visBottomPx / stageW)));
          rinkStage.style?.setProperty?.('--collection-hold-h', Math.round(stageW * collectionShownLength / 600) + 'px');
        }
        collectionTargetLength = desiredLength;
        if (!collectionLengthRaf && typeof requestAnimationFrame === 'function') {
          collectionLengthRaf = requestAnimationFrame(stepCollectionLength);
        }
      }
      const shownH = Math.max(naturalH, Math.round(stageW * collectionShownLength / 600));
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      const wrapH = Math.max(120, Math.min(shownH, vh));
      rinkWrap.style.width = '100%';
      rinkWrap.style.height = wrapH + 'px';
      rinkWrap.style.marginBottom = -wrapH + 'px';
      rinkWrap.style.top = '';
      rinkWrap.style.left = '';
      rinkWrap.style.transform = '';
      const stageRect = rinkStage.getBoundingClientRect(), wrapRect = rinkWrap.getBoundingClientRect();
      const offsetPx = Math.max(0, Math.min(shownH - wrapH, wrapRect.top - stageRect.top));
      fieldView.collectionPortrait = {
        length: collectionShownLength,
        viewTop: 600 * (offsetPx / stageW),
        viewSpan: 600 * (wrapH / stageW)
      };
      return;
    }
    fieldView.collectionPortrait = null;
    rinkWrap.style.marginBottom = '';
    rinkStage.style?.removeProperty?.('--collection-hold-h');
    if (!fieldView.portrait && !isMatchShot()) {
      visibleRinkHeight = 600;
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

    if (!availH) {
      const vh = window.innerHeight || document.documentElement.clientHeight || 600;
      availH = fieldView.portrait ? Math.min(vh * 0.72, 680) : Math.min(vh * 0.8, 600);
    }

    availW = Math.max(120, availW);
    availH = Math.max(120, availH);

    // Fit the playable view and trim only the vertical gutters in compact layouts.
    visibleRinkHeight = fieldView.portrait ? 600 : Number(getComputedStyle(stageArea).getPropertyValue('--visible-rink-height')) || 600;
    const scale = fieldView.portrait ? Math.min(availW / 600, availH / 1000) : Math.min(availW / 1000, availH / visibleRinkHeight);
    const stageW = Math.floor(scale * (fieldView.portrait ? 600 : 1000));
    const stageH = Math.floor(scale * (fieldView.portrait ? 1000 : 600));

    rinkStage.style.width = stageW + 'px';
    rinkStage.style.height = stageH + 'px';

    if (fieldView.portrait) {
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
  function draw() {
    const _tDraw = bench?.rec ? performance.now() : 0;
    if (layoutDirty && !fieldView.field) {
      const w0 = fieldView.canvas.clientWidth, h0 = fieldView.canvas.clientHeight;
      fitStadium();
      renderWidth = fieldView.canvas.clientWidth; renderHeight = fieldView.canvas.clientHeight;
      if (renderWidth !== w0 || renderHeight !== h0) { deviceWidth = 0; deviceHeight = 0; }
      measureField();
      layoutDirty = false;
    }
    if (!fieldView.field) positionSpinControl();
    themeColors = presenter.getThemeColors();
    presenter.drawScene();
    if (!fieldView.field) updateFoulInfo();
    if (bench?.rec) bench.rec.drawMs += (performance.now() - _tDraw);
  }
  // The camera. A layout change is made at once, then the rink stage is played from the box it had
  // to the box it now has, so the rink glides between the home, setup and match layouts. Portrait
  // play and reduced motion cut. See docs/rink-stage.md.
  let cameraMove = null;
  let cameraDone = Promise.resolve(), resolveCameraDone = null;
  let cameraStepRaf = 0, pendingExitCollection = null, afterCollectionShrink = null;
  const playableShot = () => shot === 'match' && !cameraMove;
  const WIDE_STAGE_QUERY = '(min-width: 56rem) and (orientation: landscape) and (not ((pointer: coarse) and (max-height: 600px)))';
  const compactPhoneStage = () => Boolean(portraitScreen?.matches) ||
    (typeof wideScreen !== 'undefined' ? !wideScreen.matches : (typeof matchMedia === 'function' && !matchMedia(WIDE_STAGE_QUERY).matches));
  function settleCameraPromise() {
    if (resolveCameraDone) { const done = resolveCameraDone; resolveCameraDone = null; done(); }
  }
  function clearCameraArtifacts() {
    if (cameraStepRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(cameraStepRaf);
    cameraStepRaf = 0;
    afterCollectionShrink = null;
    if (typeof collectionRotateHold !== 'undefined') collectionRotateHold = false;
    if (typeof collectionLengthOverride !== 'undefined') collectionLengthOverride = null;
    if (typeof collectionShrinkingBox !== 'undefined') collectionShrinkingBox = null;
    rinkStage.classList.remove('collection-rotating', 'collection-shrinking');
    rinkStage.style?.removeProperty?.('--shrink-left');
    rinkStage.style?.removeProperty?.('--shrink-top');
  }
  function cancelActiveCamera() {
    if (cameraMove) { cameraMove.cancel(); cameraMove = null; }
    stadium.classList.remove('camera-moving');
    clearCameraArtifacts();
    settleCameraPromise();
  }
  function finishCameraMove() {
    cameraMove = null;
    stadium.classList.remove('camera-moving');
    clearCameraArtifacts();
    settleCameraPromise();
    updateFirstTurnGuide();
    layoutDirty = true; draw(); // The rink's box was measured mid-move.
  }
  function camera(change, prevShot = shot, nextShot = shot) {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    let from = rinkStage.getBoundingClientRect(), turned = fieldView.portrait;
    let fromCollection = prevShot === 'collection' && nextShot !== 'collection';
    let savedExit = null;
    if (fromCollection && from.width > 0) {
      savedExit = { rect: from, at: now, length: typeof collectionShownLength === 'number' ? collectionShownLength : Math.max(1000, 600 * (from.height / from.width)) };
      pendingExitCollection = savedExit;
    } else if (!fromCollection && nextShot !== 'collection' && pendingExitCollection && (now - pendingExitCollection.at) < 40) {
      fromCollection = true;
      savedExit = pendingExitCollection;
      from = savedExit.rect;
    } else {
      pendingExitCollection = null;
    }
    const enteringCollection = prevShot !== 'collection' && nextShot === 'collection';
    if (cameraMove || cameraStepRaf) cancelActiveCamera();

    if (enteringCollection) {
      const canAnim = Boolean(rinkStage.animate) && !compactPhoneStage() && !reducedMotion.matches && !document.hidden && from.width > 0;
      if (!canAnim) {
        change();
        layoutDirty = true; draw();
        return;
      }
      if (typeof collectionRotateHold !== 'undefined') collectionRotateHold = true;
      if (typeof collectionLengthOverride !== 'undefined') collectionLengthOverride = 1000;
      rinkStage.classList.add('collection-rotating');
      change();
      layoutDirty = true; draw();
      const to1 = rinkStage.getBoundingClientRect();
      if (!(to1.width > 0 && to1.height > 0)) {
        clearCameraArtifacts();
        layoutDirty = true; draw();
        return;
      }
      const dx = from.left + from.width / 2 - (to1.left + to1.width / 2);
      const dy = from.top + from.height / 2 - (to1.top + to1.height / 2);
      const startTransform = turned
        ? `translate(${dx}px, ${dy}px) scale(${from.width / to1.width})`
        : `translate(${dx}px, ${dy}px) rotate(90deg) scale(${from.width / to1.height})`;
      stadium.classList.add('camera-moving');
      cameraDone = new Promise(resolve => { resolveCameraDone = resolve; });
      const move1 = cameraMove = rinkStage.animate([{ transform: startTransform }, { transform: 'none' }],
        { duration: 480, easing: 'cubic-bezier(.3, .8, .2, 1)' });
      positionSpinControl(); updateFirstTurnGuide(); updateFoulInfo();
      move1.onfinish = () => {
        if (cameraMove !== move1) return;
        if (typeof collectionRotateHold !== 'undefined') collectionRotateHold = false;
        rinkStage.classList.remove('collection-rotating');
        layoutDirty = true; draw();
        const to2 = rinkStage.getBoundingClientRect();
        const minH = to1.height || (to2.width * 5 / 3);
        const fullH = Math.max(minH, to2.height);
        const cw = $('collection-world');
        cw?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
        if (fullH <= minH + 4) {
          finishCameraMove();
          return;
        }
        const targetLen = Math.max(1000, 600 * (fullH / Math.max(1, to2.width)));
        const dur = 360, t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        if (typeof collectionLengthOverride !== 'undefined') collectionLengthOverride = 1000;
        const move2 = cameraMove = rinkStage.animate([
          { clipPath: `inset(0 0 ${Math.max(0, fullH - minH)}px 0)` },
          { clipPath: 'inset(0 0 0px 0)' }
        ], { duration: dur, easing: 'cubic-bezier(.25, .85, .25, 1)' });
        if (typeof requestAnimationFrame === 'function') {
          const tickStretch = ts => {
            if (cameraMove !== move2) return;
            const p = Math.min(1, Math.max(0, (ts - t0) / dur));
            const eased = 1 - (1 - p) ** 3;
            if (typeof collectionLengthOverride !== 'undefined') {
              collectionLengthOverride = 1000 + (targetLen - 1000) * eased;
            }
            layoutDirty = true; draw();
            if (p < 1) cameraStepRaf = requestAnimationFrame(tickStretch);
          };
          cameraStepRaf = requestAnimationFrame(tickStretch);
        }
        move2.onfinish = () => {
          if (cameraMove !== move2) return;
          if (typeof collectionShownLength !== 'undefined') collectionShownLength = collectionTargetLength = targetLen;
          finishCameraMove();
        };
      };
      return;
    }

    if (fromCollection) {
      change();
      const canAnim = Boolean(rinkStage.animate) && !compactPhoneStage() && !reducedMotion.matches && !document.hidden && from.width > 0;
      if (!canAnim) {
        pendingExitCollection = null;
        layoutDirty = true; draw();
        return;
      }
      const wCol = from.width, hMin = wCol * 5 / 3;
      const startLen = Math.max(1000, savedExit?.length || (600 * (from.height / Math.max(1, wCol))));
      const anchorTop = Math.max(64, from.top);
      stadium.classList.add('camera-moving');
      cameraDone = new Promise(resolve => { resolveCameraDone = resolve; });

      const startRotateBack = () => {
        pendingExitCollection = null;
        if (typeof collectionShrinkingBox !== 'undefined') collectionShrinkingBox = null;
        rinkStage.classList.remove('collection-shrinking');
        rinkStage.style?.removeProperty?.('--shrink-left');
        rinkStage.style?.removeProperty?.('--shrink-top');
        layoutDirty = true; draw();
        const runDeferred = afterCollectionShrink;
        afterCollectionShrink = null;
        runDeferred?.();
        const to = rinkStage.getBoundingClientRect();
        if (!(to.width > 0 && to.height > 0)) {
          finishCameraMove();
          return;
        }
        const dx = (from.left + wCol / 2) - (to.left + to.width / 2);
        const dy = (anchorTop + hMin / 2) - (to.top + to.height / 2);
        const startPose = fieldView.portrait
          ? `translate(${dx}px, ${dy}px) scale(${wCol / to.width})`
          : `translate(${dx}px, ${dy}px) rotate(-90deg) scale(${wCol / to.height})`;
        const rotMove = cameraMove = rinkStage.animate([{ transform: startPose }, { transform: 'none' }],
          { duration: 480, easing: 'cubic-bezier(.3, .8, .2, 1)' });
        positionSpinControl(); updateFirstTurnGuide(); updateFoulInfo();
        rotMove.onfinish = () => {
          if (cameraMove !== rotMove) return;
          finishCameraMove();
        };
      };

      if (startLen > 1006) {
        const vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 860;
        const visCapLen = Math.max(1000, 600 * (Math.max(hMin, vh - anchorTop + 220) / Math.max(1, wCol)));
        const shrinkFromLen = Math.min(startLen, visCapLen);
        const shrinkFromH = Math.round(wCol * shrinkFromLen / 600);
        const hMinRound = Math.round(hMin);
        if (typeof collectionShrinkingBox !== 'undefined') {
          collectionShrinkingBox = { width: Math.round(wCol), height: shrinkFromH, length: shrinkFromLen };
        }
        rinkStage.classList.add('collection-shrinking');
        rinkStage.style?.setProperty?.('--shrink-left', Math.round(from.left) + 'px');
        rinkStage.style?.setProperty?.('--shrink-top', Math.round(anchorTop) + 'px');
        layoutDirty = true; draw();
        const dur = 260, t0 = typeof performance !== 'undefined' ? performance.now() : 0;
        const shrinkMove = cameraMove = rinkStage.animate([
          { clipPath: 'inset(0 0 0px 0)' },
          { clipPath: `inset(0 0 ${Math.max(0, shrinkFromH - hMinRound)}px 0)` }
        ], { duration: dur, easing: 'cubic-bezier(.35, 0, .25, 1)' });
        positionSpinControl(); updateFirstTurnGuide(); updateFoulInfo();
        if (typeof requestAnimationFrame === 'function') {
          const tickShrink = ts => {
            if (cameraMove !== shrinkMove) return;
            const p = Math.min(1, Math.max(0, (ts - t0) / dur));
            const eased = p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2;
            const curLen = shrinkFromLen + (1000 - shrinkFromLen) * eased;
            if (typeof collectionShrinkingBox !== 'undefined' && collectionShrinkingBox) {
              collectionShrinkingBox.length = curLen;
            }
            layoutDirty = true; draw();
            if (p < 1) cameraStepRaf = requestAnimationFrame(tickShrink);
          };
          cameraStepRaf = requestAnimationFrame(tickShrink);
        }
        shrinkMove.onfinish = () => {
          if (cameraMove !== shrinkMove) return;
          if (cameraStepRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(cameraStepRaf);
          cameraStepRaf = 0;
          startRotateBack();
        };
      } else {
        startRotateBack();
      }
      return;
    }

    change();
    layoutDirty = true; draw();
    const to = rinkStage.getBoundingClientRect();
    if (!rinkStage.animate || compactPhoneStage() || turned || fieldView.portrait || reducedMotion.matches || document.hidden || !from.width || !to.width) return;
    const dx = from.left + from.width / 2 - to.left - to.width / 2, dy = from.top + from.height / 2 - to.top - to.height / 2;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(from.width - to.width) < 1) return;
    stadium.classList.add('camera-moving');
    cameraDone = new Promise(resolve => { resolveCameraDone = resolve; });
    const move = cameraMove = rinkStage.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width})` }, { transform: 'none' }],
      { duration: 520, easing: 'cubic-bezier(.3, .8, .2, 1)' });
    positionSpinControl(); updateFirstTurnGuide(); updateFoulInfo();
    move.onfinish = () => {
      if (cameraMove !== move) return;
      finishCameraMove();
    };
  }
  if (typeof window !== 'undefined') window.ubuStageReady = () => cameraDone;
  function setShot(next, { keepPortrait = false, beforeLayout = null } = {}) {
    if (!beforeLayout && shot === next && document.body?.dataset?.shot === next) return;
    if (drag !== null && next !== 'match') endCanvasDrag();
    const prevShot = shot;
    camera(() => {
      beforeLayout?.();
      shot = next;
      if (document.body?.dataset) document.body.dataset.shot = next;
      if (isSetupShot(next)) {
        scrollTo(0, 0);
        setPortrait(false);
        fitSetupShot();
      } else if (isMatchShot(next)) {
        if (keepPortrait) setPortrait(returnPortrait);
        else fitOrientation();
      } else {
        setPortrait(false);
      }
      syncFullscreenButton();
      fitScorebug();
    }, prevShot, next);
    updateReplaySkip(shot === 'match' ? goalReplay : null);
  }
  // The cast: whoever is on the ice (demo, match or replay) can skate off and back without the game
  // knowing. Only displayed positions move, and each is put back exactly; while the cast is away the
  // ice is drawn empty.
  const CAST_SECONDS = .45, CAST_STAGGER = .05;
  function castPose(t) {
    cast.bodies.forEach((b, i) => {
      const home = cast.home[i], shown = cast.shown[i];
      // The game moved this body (a new match, a simulation step): that is its place now.
      if (shown && (b.x !== shown.x || b.y !== shown.y)) { home.x = b.x; home.y = b.y; home.rotation = b.rotation; }
      const local = Math.max(0, Math.min(1, (t - i * CAST_STAGGER) / (1 - 6 * CAST_STAGGER))), far = local * local * 820;
      const ox = home.x - 500, oy = home.y - 300, length = Math.hypot(ox, oy);
      b.x = home.x + (length > 1 ? ox / length : 0) * far; b.y = home.y + (length > 1 ? oy / length : -1) * far;
      b.rotation = home.rotation + local * local * (i % 2 ? -5 : 5);
      cast.shown[i] = { x: b.x, y: b.y };
    });
  }
  function castHome() {
    cast.bodies.forEach((b, i) => {
      const home = cast.home[i], shown = cast.shown[i];
      if (shown && b.x === shown.x && b.y === shown.y) { b.x = home.x; b.y = home.y; b.rotation = home.rotation; }
    });
    cast.shown = [];
  }
  function castTo(away) {
    const bodies = fieldView.bodies;
    if (cast && cast.bodies !== bodies) { cancelAnimationFrame(cast.frame); castHome(); cast = null; }
    if (!cast) {
      if (away === !!fieldView.castHidden) return;
      cast = { bodies, home: bodies.map(b => ({ x: b.x, y: b.y, rotation: b.rotation })), shown: [], t: away ? 0 : 1, frame: 0 };
    }
    cancelAnimationFrame(cast.frame);
    fieldView.castHidden = false; rinkWrap.classList.remove('cast-away');
    let last = performance.now();
    const step = now => {
      if (!cast) return;
      if (fieldView.bodies !== cast.bodies) { castTo(away); draw(); return; }
      const moved = reducedMotion.matches ? 1 : Math.min(.1, (now - last) / 1000) / CAST_SECONDS;
      last = now;
      cast.t = away ? Math.min(1, cast.t + moved) : Math.max(0, cast.t - moved);
      if (away ? cast.t < 1 : cast.t > 0) { castPose(cast.t); draw(); cast.frame = requestAnimationFrame(step); return; }
      castHome(); cast = null;
      fieldView.castHidden = away; rinkWrap.classList.toggle('cast-away', away);
      draw();
    };
    step(last);
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
  let replayTickStruck = false;
  function replayEvents(turn, tick, sim) {
    const saves = turn.saves.filter(s => s.tick === tick), stop = turn.stops.find(s => s.tick === tick)?.ms, struck = replayTickStruck;
    replayTickStruck = false;
    applyTickEvents(sim, { saves, struck, stop, applyIron: true, syncFn: syncReplay, viewFn: b => replayView(b) });
  }
  // Replays re-simulate each recorded turn from its exact starting state on a display copy.
  // The goal replay and the replay viewer share these.
  let activePlayback = null;
  const replayHitStop = th => th.fx?.hitStopUntil ?? hitStopUntil;
  const currentReplay = () => activePlayback || theater;
  const activeOnlineSim = () => {
    const pg = typeof postGoal !== 'undefined' ? postGoal : null;
    const onl = typeof online !== 'undefined' ? online : null;
    if (pg?.sim) return pg.sim;
    if (onlineReplay) {
      if ((onlineReplay.currentTick ?? 0) < onlineReplay.ticks) return onlineReplay.simBodies;
      if (onlineReplay.postGoalSim) return onlineReplay.postGoalSim;
    }
    return onl?.state?.game?.bodies ?? onlineReplay?.simBodies;
  };
  const shownSim = () => {
    const pg = typeof postGoal !== 'undefined' ? postGoal : null;
    const onl = typeof online !== 'undefined' ? online : null;
    return (goalReplay || currentReplay())?.sim ?? (onl?.active ? activeOnlineSim() : (pg?.sim ?? simBodies));
  };
  const shownSeat = () => {
    const pg = typeof postGoal !== 'undefined' ? postGoal : null;
    const onl = typeof online !== 'undefined' ? online : null;
    return goalReplay || currentReplay() ? (goalReplay || currentReplay()).seat : (onl?.active ? (pg?.seat ?? onl.state?.seat ?? 0) : 0);
  };
  const replayView = (cb, th = currentReplay()) => toViewBody(cb, th ? th.sim : shownSim(), th ? th.seat : shownSeat(), th?.bodies || (typeof fieldView.bodies !== 'undefined' ? fieldView.bodies : null));
  const syncReplay = (th = currentReplay()) => syncViewBodies(th ? th.sim : shownSim(), th ? th.seat : shownSeat(), th?.bodies || (typeof fieldView.bodies !== 'undefined' ? fieldView.bodies : null), th ? th.anonymous : undefined, th?.exporting ? null : undefined, th?.entries);
  const syncReplayTick = (th = currentReplay()) => (typeof syncTickBodies === 'function' && !th)
    ? syncTickBodies(shownSim(), shownSeat(), typeof fieldView.bodies !== 'undefined' ? fieldView.bodies : null)
    : syncReplay(th);
  const replayFx = {
    hit: contact => { if (contact.spinStruck && ((typeof goalReplay !== 'undefined' && goalReplay) || currentReplay())) replayTickStruck = true; syncReplayTick(); handleCollision({ ...contact, a: replayView(contact.a), b: replayView(contact.b) }); },
    wall: (body, velocity, wallType, nx, ny, rimmed = false) => { syncReplayTick(); const seat = shownSeat(); handleWall(replayView(body), velocity, wallType, seat ? -nx : nx, seat ? -ny : ny, rimmed); },
    shock: (source, radius, type = null) => { syncReplayTick(); handleShockwave(replayView(source), radius, type); },
    super: (key, stage, body, target = null) => { syncReplayTick(); handleSuper(key, stage, replayView(body), target ? replayView(target) : null); }
  };
  const {
    impactFor, applyTickEvents, stepPostGoalFrame, runPlaybackTicks, advancePostGoal, stepOnlineTurn
  } = createPlaybackDriver({
    P,
    ububallMatch,
    clockNow: () => clockNow(),
    impact: (ms, shake) => impact(ms, shake),
    creditSave: (body, own, iron) => creditSave(body, own, iron),
    popup: (body, text) => popup(body, text),
    getBallView: () => fieldView.bodies[6],
    traceGuide: sim => traceGuide(sim),
    recordTrails: () => recordTrails()
  });
  function restartGoalReplay() {
    Object.assign(goalReplay, { index: -1, played: 0, steps: 0, doneAt: 0, doneHoldMs: 0, loops: (goalReplay.loops || 0) + 1 });
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
    if (postGoal) { if (postGoal.sim) P.stop(postGoal.sim); P.stop(fieldView.bodies); postGoal = null; }
    const segments = playSegments.filter(s => s.ticks);
    if (!segments.length || (online?.active && online.state?.phase !== 'resolving')) {
      if (!online?.active && phase === 'over') openSummary();
      return;
    }
    endGoalReplay();
    const scorer = fieldView.bodies.indexOf(scoringPlayer);
    goalReplay = { segments, total: segments.reduce((n, s) => n + s.ticks, 0),
      seat: online?.active ? online.state.seat : 0, scorer, started: performance.now(), elapsedMs: 0 };
    scoringPlayer = fieldView.bodies[scorer] || null;
    restartGoalReplay(); draw();
  }
  // The replay loops until the next kickoff (or, online, until the server moves on).
  function advanceGoalReplay(delta) {
    delta = Math.min(1 / 15, Math.max(0, delta));
    const r = goalReplay;
    r.elapsedMs = (r.elapsedMs || 0) + delta * 1000;
    if (clockNow() < hitStopUntil) { draw(); return; }
    if (online?.active ? (r.doneAt && performance.now() >= r.doneAt) : (r.doneHoldMs > 0 && (r.doneHoldMs -= delta * 1000) <= 0)) {
      restartGoalReplay();
      draw();
      return;
    }
    const post = r.played >= r.total;
    const speed = post ? 0.5 : ububallMatch.replaySpeed(r.total - r.played);
    let steppedReplay = false;
    runPlaybackTicks(r, delta, speed, 48, () => hitStopUntil, () => {
      steppedReplay = true;
      if (r.played < r.total) {
        if (r.tick >= r.segments[r.index].ticks) nextReplaySegment();
        if (P.step(r.sim, P.DT, replayFx.hit, replayFx.wall, replayFx.shock, replayFx.super) !== null && P.ballOnFire(r.sim[6]) && fieldEffects.netFire) fieldEffects.netFire.lit = true;
        r.tick++; r.played++;
        replayEvents(r.segments[r.index], r.tick, r.sim);
        syncReplayTick(); recordTrails();
        if (r.played >= r.total) { r.doneAt = performance.now() + ububallMatch.GOAL_REPLAY_HOLD; r.doneHoldMs = ububallMatch.GOAL_REPLAY_HOLD; }
      } else if (stepPostGoalFrame(r.sim, replayFx, syncReplayTick)) {
        return 'reset';
      }
    });
    if (steppedReplay && goalReplay) syncReplay();
    emitSkaterEffects(delta * speed); draw();
  }
  function endGoalReplay() {
    goalReplayAt = 0;
    if (typeof goalReplayDelayMs !== 'undefined') goalReplayDelayMs = 0;
    if (!goalReplay) return;
    scoringPlayer = fieldView.bodies[goalReplay.scorer] || null;
    goalReplay = null;
    clearEffects();
    syncReplay();
    fieldView.bodies.slice(0, 6).forEach(b => dirtyMeters.add(b));
    sync(); draw();
  }
  // Replays (shared/ububall-replay.js): every match is recorded turn by turn and saved on this
  // device when it ends or is left. The library keeps the latest ububallReplay.KEEP of these
  // automatic saves that are not pinned; imports stay until deleted. Each entry holds the
  // .ububall file and a summary for the list, with names and scores in rink order.
  const replayStore = (() => {
    let db = null;
    const open = () => {
      if (!db) {
        db = new Promise((resolve, reject) => {
          if (typeof indexedDB === 'undefined' || !indexedDB) {
            reject(new Error('Replays cannot be saved in this browser.'));
            return;
          }
          const request = indexedDB.open('ububall', 1);
          request.onupgradeneeded = () => request.result.createObjectStore('replays', { keyPath: 'id', autoIncrement: true });
          request.onsuccess = () => {
            const handle = request.result;
            handle.onversionchange = () => { handle.close(); db = null; };
            handle.onclose = () => { db = null; };
            resolve(handle);
          };
          request.onerror = () => { db = null; reject(request.error || new Error('Replays cannot be saved in this browser.')); };
          request.onblocked = () => { db = null; reject(new Error('Replay storage is busy in another tab.')); };
        }).catch(error => {
          db = null;
          throw error;
        });
      }
      return db;
    };
    async function run(mode, work) {
      let handle = await open(), tx;
      try { tx = handle.transaction('replays', mode); }
      catch { db = null; handle = await open(); tx = handle.transaction('replays', mode); }
      const request = work(tx.objectStore('replays'));
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
    flushScheduledSave();
    if (recording && !demo && (online?.active || inDiscord)) saveRecording();
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
    lastCompletedReplay = null;
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
    if (s.game.winner != null) recording.final = { scores: [...s.game.scores], winner: s.game.winner };
    saveRecording();
  }
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
  function makeGuide(sim, plans, seat, guideTurn, guideScores) {
    const start = viewBodies(sim, seat);
    return { turn: guideTurn, goals: guideScores[0] + guideScores[1], seat, ticks: 0, start, paths: start.map(b => [b.x, b.y]),
      moves: onlineOrder(plans, seat).map(p => ({ ...p, angle: p.angle + (seat ? Math.PI : 0) })) };
  }
  function beginGuide(sim, plans, seat) { guide = makeGuide(sim, plans, seat, turn, scores); }
  // Every third tick, each body's place joins its path.
  function traceGuide(sim, pathGuide = guide) {
    if (!pathGuide || ++pathGuide.ticks % 3) return;
    const { seat, paths } = pathGuide;
    sim.forEach((b, c) => paths[viewIndex(c, seat)].push(seat ? 1000 - b.x : b.x, seat ? 600 - b.y : b.y));
  }
  function guideShown(key, guide) {
    if (!guides[key] || !guide) return false;
    if (theater || (typeof activePlayback !== 'undefined' && activePlayback)) return true;
    if (demo || goalReplay) return false;
    if (phase === 'play') return guide.turn === turn;
    return key === 'trails' && guide.turn === turn - 1 && guide.goals === scores[0] + scores[1];
  }
  const theaterController = createReplayTheater({
    $,
    window,
    document,
    navigator,
    localStorage,
    getComputedStyle,
    MessageChannel,
    Blob,
    File,
    Image,
    URL,
    HTMLCanvasElement: typeof HTMLCanvasElement !== 'undefined' ? HTMLCanvasElement : null,
    HTMLImageElement: typeof HTMLImageElement !== 'undefined' ? HTMLImageElement : null,
    VideoEncoder: typeof VideoEncoder !== 'undefined' ? VideoEncoder : null,
    VideoFrame: typeof VideoFrame !== 'undefined' ? VideoFrame : null,
    AudioEncoder: typeof AudioEncoder !== 'undefined' ? AudioEncoder : null,
    AudioData: typeof AudioData !== 'undefined' ? AudioData : null,
    OfflineAudioContext: typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null,
    setTimeout,
    P,
    ubu,
    ububallMatch,
    ububallReplay,
    getMp4: () => (typeof ububallMP4 !== 'undefined' ? ububallMP4 : window.ububallMP4),
    gameUi,
    GOAL_CALL_SECONDS,
    materialStyles,
    createEffectsState,
    onlineOrder,
    viewIndex,
    stripPresentation,
    transformSimSeat,
    viewFouls: (f, seat) => viewFouls(f, seat),
    runPlaybackTicks,
    replayEvents: (turnObj, tick, sim) => replayEvents(turnObj, tick, sim),
    getReplayFx: () => replayFx,
    replayHitStop: th => replayHitStop(th),
    syncReplay: th => syncReplay(th),
    makeGuide: (sim, turnPlans, seat, gTurn, gScores) => makeGuide(sim, turnPlans, seat, gTurn, gScores),
    traceGuide: (sim, g) => traceGuide(sim, g),
    recordTrails: () => recordTrails(),
    trailPositions: () => trailPositions(),
    clearDiscontinuousTrails: before => clearDiscontinuousTrails(before),
    emitSkaterEffects: dt => emitSkaterEffects(dt),
    updatePopups: (dt, popups) => updatePopups(dt, popups),
    updateEffects: (dt, fx) => updateEffects(dt, fx),
    clearEffects: () => clearEffects(),
    celebrate: (team, ball, label, scorer) => celebrate(team, ball, label, scorer),
    loopFanfare: voice => loopFanfare(voice),
    stopFanfare: () => stopFanfare(),
    quench: () => quench(),
    lightNet: team => lightNet(team),
    ballOnFire: () => ballOnFire(),
    popup: (body, text) => popup(body, text),
    goalTab: (team, label, scorer) => goalTab(team, label, scorer),
    replayFileName: (recorded, title) => replayFileName(recorded, title),
    downloadReplay: (file, recorded, title) => downloadReplay(file, recorded, title),
    rinkLogo,
    getThemeColors: () => getThemeColors(),
    getSkaters: () => skaters,
    clockNow: () => clockNow(),
    gameAudio: () => gameAudio(),
    classicMode: () => classicMode(),
    normalStats: () => normalStats(),
    idlePlan: () => idlePlan(),
    resolveEquippedSuper: (entry, i) => resolveEquippedSuper(entry, i),
    kickoff: isNew => kickoff(isNew),
    buildTeam: () => buildTeam(),
    resetPlans: keep => resetPlans(keep),
    saveRecording: () => saveRecording(),
    saveActiveMatch: state => saveActiveMatch(state),
    stopDemo: () => stopDemo(),
    closeSummary: () => closeSummary(),
    endGoalReplay: () => endGoalReplay(),
    showMode: m => showMode(m),
    enterMatch: next => enterMatch(next),
    setShot: next => {
      if (typeof setShot === 'function') setShot(next);
      else { shot = next; if (document.body?.dataset) document.body.dataset.shot = next; }
    },
    updateHome: () => updateHome(),
    bumpCpuGeneration: () => { cpuGeneration++; cpuClient.cancel(); cpuClient.dispose?.(); },
    say: msg => say(msg),
    sync: () => sync(),
    draw: () => draw(),
    getTheater: () => theater,
    setTheater: next => { theater = next; },
    getActivePlayback: () => activePlayback,
    setActivePlayback: next => { activePlayback = next; },
    getFieldView: () => fieldView,
    setFieldView: next => { fieldView = next; },
    getFieldEffects: () => fieldEffects,
    setFieldEffects: next => { fieldEffects = next; },
    getVideoAudio: () => videoAudio,
    setVideoAudio: next => { videoAudio = next; },
    getVideoClock: () => videoClock,
    setVideoClock: next => { videoClock = next; },
    setCardShot: next => { cardShot = next; },
    markLayoutDirty: () => { layoutDirty = true; },
    setHitStopUntil: next => { hitStopUntil = next; },
    getShot: () => shot,
    getScores: () => scores,
    getTurn: () => turn,
    syncShownScores: sc => { shownScores.splice(0, 2, ...sc); },
    setFouls: next => { fouls = next; },
    onWatchReplayLoaded: ({ stats: nextStats }) => {
      stats = nextStats;
      phase = 'replay'; selected = 0; drag = null;
    },
    onEndReplayState: () => {
      phase = 'over'; recording = null;
    },
    onLoadReplayTurnState: ({ scores: sc, turn: tn, plans: pl, guide: gd }) => {
      scores = sc; turn = tn; plans = pl; guide = gd;
    },
    onPlayFromHereState: ({ roster: nextRoster, simBodies: nextSim, scores: nextScores, turn: nextTurn, fouls: nextFouls, roundTurns: nextRoundTurns, recording: nextRec }) => {
      roster = nextRoster;
      simBodies = nextSim;
      syncViewBodies(simBodies, 0);
      scores = nextScores; turn = nextTurn; fouls = nextFouls;
      play = ububallMatch.newPlay(); tally = ububallMatch.newTally();
      roundTurns = nextRoundTurns; matchTicks = 0; playSegments = [];
      selected = 0; drag = null; elapsed = accumulator = 0; phase = 'plan';
      recording = nextRec;
    }
  });
  theaterController.bindEvents();
  const {
    isExporting, cancelExport, watchReplay, clearReplayViewer, endReplay,
    seekReplay, advanceReplay, updateReplayBar, playFromHere
  } = theaterController;
  const statsController = createStatsController({
    $,
    document,
    addEventListener,
    history,
    P,
    ububallMatch,
    ububallReplay,
    ubuRender: (model, cls) => ubuRender(model, cls),
    gameUi,
    onlineOrder,
    viewIndex,
    getFieldView: () => fieldView,
    getSkaters: () => skaters,
    getThemeColors: () => getThemeColors(),
    drawRinkSurface: (ctx, colors) => drawRinkSurface(ctx, colors),
    viewTally: () => viewTally(),
    getScores: () => scores,
    getPhase: () => phase,
    getOnline: () => online,
    getTheater: () => theater,
    getRecording: () => recording,
    getLastCompletedReplay: () => lastCompletedReplay,
    getLastSaved: () => lastSaved,
    getShot: () => shot,
    getCameraMove: () => cameraMove,
    replayStore,
    libraryEntry: (r, file, auto) => libraryEntry(r, file, auto),
    seekReplay: (at, th, turnIdx) => seekReplay(at, th, turnIdx),
    updateReplayBar: () => updateReplayBar(),
    watchReplay: (replay, file) => watchReplay(replay, file),
    matchInProgress: () => matchInProgress(),
    finishCpuMatch: () => finishCpuMatch(),
    closeFirstTurnGuide: () => closeFirstTurnGuide(),
    closeSummary: () => closeSummary(),
    newMatch: playJingle => newMatch(playJingle),
    exitMatchMode: () => exitMatchMode()
  });
  statsController.bindEvents();
  const {
    replayStats, renderStats, openMatchStats, openStats, downloadReplay, openReplay, openReplays, listReplays
  } = statsController;
  function finishTurn(goal) {
    const ticks = Math.round(elapsed / P.DT);
    if (playSegments.length) playSegments[playSegments.length - 1].ticks = ticks;
    // A goal on the round's first turn is an ace, earning its scorer extra meter (not for an own goal).
    const ace = goal !== null && !roundTurns, call = goal === null ? null : ububallMatch.callGoal(simBodies, play, tally, goal, ace);
    if (goal !== null && ballOnFire()) lightNet(goal); else quench();
    const before = trailPositions();
    ububallMatch.finishTurn(P, simBodies, stats, scores, goal, fieldView.mode, { ace: ace && !call.own ? call.scorer : null, assist: call?.assist ?? null, keepMotion: goal !== null }, fouls, tally);
    syncViewBodies(simBodies, 0);
    clearDiscontinuousTrails(before);
    if (fouls.faceoff) play = ububallMatch.newPlay();
    noteTurn(ticks, goal === null ? null : { team: goal, label: call.label, scorer: call.own ? null : call.scorer, assist: call.assist }, fouls.cards);
    announceFouls();
    if (goal !== null) ububallMatch.noteScore(tally, scores);
    roundTurns++;
    matchTicks += ticks;
    fieldView.bodies.slice(0, 6).forEach(b => dirtyMeters.add(b));
    accumulator = 0; layoutDirty = true;
    if (goal !== null) {
      const celebSim = structuredClone(simBodies);
      P.stop(simBodies);
      authoritativeBodies = structuredClone(simBodies);
      phase = scores[goal] >= 5 ? 'over' : 'goal';
      celebrate(goal, fieldView.bodies[6], call.label, call.own ? null : fieldView.bodies[call.scorer] || null);
      if (call.assist !== null) popup(fieldView.bodies[call.assist], 'Assist');
      if (phase === 'over') {
        if (recording) { recording.final = { scores: [...scores], winner: goal }; saveRecording(); }
        clearActiveMatch();
      }
      const scorer = fieldView.bodies[call.scorer] || fieldView.bodies.slice(goal * 3, goal * 3 + 3)[0];
      goalReplayAt = performance.now() + ububallMatch.GOAL_REPLAY_DELAY + 800;
      if (typeof goalReplayDelayMs !== 'undefined') goalReplayDelayMs = ububallMatch.GOAL_REPLAY_DELAY + 800;
      postGoal = { ticks: 0, sim: celebSim, seat: 0 };
      scoringPlayer = scorer;
      const scorerName = scorer?.name || (goal === 0 ? 'Your ubu' : 'CPU ubu');
      goalTab(goal, call.label, call.own ? null : scorerName);
      say(phase === 'over'
        ? `${goal === 0 ? 'You win!' : 'CPU wins.'} ${callText(call.label, scorerName)}${honourText(goal)} Tap the replay for results.`
        : `${goal === 0 ? 'You score!' : 'CPU scores.'} ${callText(call.label, scorerName)} Ready for the next kickoff.`
      );
      loopFanfare(scorer?.voice);
      sync();
      if (phase === 'goal') { $('launch').disabled = false; $('launch-label').textContent = 'Next kickoff'; }
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
      openSetup('mode'); return;
    }
    gameAudio()?.getAudioContext();
    if (phase === 'goal') {
      if (postGoal) { if (postGoal.sim) P.stop(postGoal.sim); P.stop(fieldView.bodies); postGoal = null; }
      stopFanfare(); gameAudio()?.stop();
      endGoalReplay();
      fieldView.bodies = kickoff(); turn++; phase = 'plan'; resetPlans(); say('Kickoff. Plan your next three launches.');
      saveActiveMatch();
      draw(); return;
    }
    if (phase !== 'plan') return;
    closeFirstTurnGuide(true);
    const generation = cpuGeneration;
    phase = 'cpu-wait'; drag = null; sync(); say('CPU is finishing its plan…');
    await cpuReady;
    if (generation !== cpuGeneration || phase !== 'cpu-wait' || online?.active) return;
    if ($('field-spin').contains(document.activeElement)) document.activeElement.blur();
    gameAudio()?.stop();
    drag = null;
    const userPlans = ububallMatch.validatePlans(plans.map((p, i) => ({ ...p, superArm: Boolean(fieldView.bodies[i]?.superArm || p.superArm) })));
    const cpuPlans = ububallMatch.validatePlans(cpu);
    const turnPlans = [...userPlans, ...cpuPlans];
    fieldView.bodies.slice(0, 3).forEach(b => { b.superArm = false; });
    recordSegment(simBodies, turnPlans); beginGuide(simBodies, turnPlans, 0);
    if (recording) ububallReplay.addTurn(recording, { turn, scores, fouls, bodies: simBodies, plans: turnPlans });
    saveActiveMatch({ bodies: simBodies, turnPlans });
    P.startTurn(simBodies, turnPlans, liveFx.super);
    syncViewBodies(simBodies, 0);
    elapsed = accumulator = 0; phase = 'play'; sync(); say('Turn in motion…');
    if (!demo && shot === 'match') banner('Launch!', 800, 'launch');
  };
  let saveActiveMatchTimer = 0;
  function cancelScheduledSave() {
    if (!saveActiveMatchTimer) return;
    if (typeof clearTimeout === 'function') clearTimeout(saveActiveMatchTimer);
    saveActiveMatchTimer = 0;
  }
  function flushScheduledSave() {
    if (!saveActiveMatchTimer) return;
    cancelScheduledSave();
    if (phase === 'plan') saveActiveMatch();
  }
  function scheduleSaveActiveMatch() {
    if (phase !== 'plan') return;
    if (typeof setTimeout !== 'function') { saveActiveMatch(); return; }
    cancelScheduledSave();
    saveActiveMatchTimer = setTimeout(() => {
      saveActiveMatchTimer = 0;
      if (phase === 'plan') saveActiveMatch();
    }, 200);
  }
  for (const [id, key, scale] of [['shot-spin', 'spin', .01]]) {
    $(id).oninput = () => {
      if (!knobEditable(selected)) return;
      plans[selected][key] = Number($(id).value) * scale; plans[selected].guard = false;
      if (typeof requestAnimationFrame === 'function') dragDirty = true;
      else { sync(); draw(); }
    };
    $(id).onchange = () => {
      if (dragDirty) { dragDirty = false; sync(); draw(); }
      if (phase === 'plan') saveActiveMatch();
    };
  }
  for (const [id, delta] of [['spin-less', -.1], ['spin-more', .1]]) {
    $(id).onclick = () => {
      if (!knobEditable(selected)) return;
      plans[selected].spin = Math.max(-1, Math.min(1, Math.round(((plans[selected].spin || 0) + delta) * 10) / 10)); plans[selected].guard = false;
      sync(); draw();
      saveActiveMatch();
    };
  }
  // Guarding replaces the launch and brakes the ubu. The arrow stays (faded), so clearing guard
  // brings the launch back.
  function toggleGuard(i) {
    if (!knobEditable(i)) return;
    plans[i] = { ...plans[i], guard: !plans[i].guard };
    sync(); draw();
    saveActiveMatch();
  }
  $('shot-guard').onclick = () => toggleGuard(selected);
  $('shot-reset').onclick = () => {
    if (!knobEditable(selected)) return;
    plans[selected] = idlePlan();
    fieldView.bodies[selected].superArm = false;
    sync(); draw();
    saveActiveMatch();
  };
  function point(event) {
    const r = fieldView.canvas.getBoundingClientRect();
    if (fieldView.portrait) {
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
  fieldView.canvas.addEventListener('wheel', e => {
    if (playableShot() && !foulInfo && !e.ctrlKey) wheelKnob(e, 'spin', selected);
  }, { passive: false });
  let tapGuards = false;
  fieldView.canvas.onpointerdown = event => {
    if (!isMatchShot() || cameraMove) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (drag !== null) return;
    gameAudio()?.getAudioContext();
    // A warning's explanation opens on a tap; a tap elsewhere only closes it.
    const warning = warningAt(point(event));
    if (warning) { openFoulInfo(warning); return; }
    if (foulInfo) { closeFoulInfo(); return; }
    if (!playableShot() || phase !== 'plan') return;
    const p = point(event);
    const target = fieldTarget(event);
    if (target.index < 0) return;
    // Only a tap on the ubu that is already selected toggles guard, so selecting one never loses its arrow.
    tapGuards = selected === target.index;
    selected = target.index;
    drag = event.pointerId;
    dragMode = target.mode;
    dragStart = p;
    dragStartClient = { x: event.clientX, y: event.clientY };
    dragMoved = false;
    if (dragMode === 'arrow') {
      const arrow = impulseGeometry(fieldView.bodies[selected], plans[selected]);
      arrowGrab = { x: p.x - arrow.x, y: p.y - arrow.y, distance: arrow.distance, power: plans[selected].power };
    }
    fieldView.canvas.setPointerCapture(drag);
    sync(); draw();
  };
  fieldView.canvas.onpointermove = event => {
    if (!isMatchShot() || cameraMove) { fieldView.canvas.style.cursor = 'default'; return; }
    const p = point(event);
    if (drag !== event.pointerId || !playableShot() || phase !== 'plan') {
      if (warningAt(p)) fieldView.canvas.style.cursor = 'pointer';
      else if (playableShot() && phase === 'plan') {
        const target = fieldTarget(event);
        fieldView.canvas.style.cursor = target.index < 0 ? 'default' : target.mode === 'arrow' ? 'grab' : 'crosshair';
      } else fieldView.canvas.style.cursor = 'default';
      return;
    }
    const b = fieldView.bodies[selected];
    // A tap toggles guard; aiming starts once the pointer leaves the tap radius in screen pixels.
    const tapRadius = (event.pointerType === 'mouse' ? 5 : 12) * gameUi.scale();
    if (!dragMoved && dragStartClient && Math.hypot(event.clientX - dragStartClient.x, event.clientY - dragStartClient.y) < tapRadius) return;
    dragMoved = true; plans[selected].guard = false;
    if (dragMode === 'arrow') {
      const dx = p.x - arrowGrab.x - b.x, dy = p.y - arrowGrab.y - b.y;
      const arrow = impulseGeometry(b, plans[selected]);
      const rawAngle = Math.atan2(dy, dx);
      plans[selected].angle = ((rawAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      plans[selected].power = Math.max(0, Math.min(1, arrowGrab.power + (Math.hypot(dx, dy) - arrowGrab.distance) / arrow.scale));
    } else if (dragMode === 'aim') {
      const dx = p.x - b.x, dy = p.y - b.y;
      const arrow = impulseGeometry(b, plans[selected]);
      const rawAngle = Math.atan2(pullBehind ? -dy : dy, pullBehind ? -dx : dx);
      plans[selected].angle = ((rawAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      plans[selected].power = aimPower(Math.hypot(dx, dy), arrow);
    }

    dragDirty = true;
  };
  function endCanvasDrag() {
    arrowGrab = null;
    drag = null;
    dragStart = null;
    dragStartClient = null;
    dragMode = null;
    dragDirty = false;
    if (phase === 'plan') saveActiveMatch();
    updateFirstTurnGuide();
    sync(); draw();
  }
  fieldView.canvas.onpointerup = fieldView.canvas.onpointercancel = event => {
    if (drag !== event.pointerId) return;
    if (event.type === 'pointerup' && dragMode === 'aim' && !dragMoved && tapGuards) toggleGuard(selected);
    endCanvasDrag();
  };
  fieldView.canvas.onlostpointercapture = event => {
    if (drag !== event.pointerId) return;
    endCanvasDrag();
  };
  const liveSim = () => postGoal?.sim ?? simBodies;
  const liveView = cb => toViewBody(cb, liveSim(), 0);
  const syncLive = () => (typeof syncTickBodies === 'function' ? syncTickBodies(liveSim(), 0) : syncViewBodies(liveSim(), 0));
  const liveFx = {
    collide: contact => { syncLive(); handleCollision({ ...contact, a: liveView(contact.a), b: liveView(contact.b) }); },
    wall: (body, velocity, wallType, nx, ny, rimmed = false) => { syncLive(); handleWall(liveView(body), velocity, wallType, nx, ny, rimmed); },
    shockwave: (source, radius, type = null) => { syncLive(); handleShockwave(liveView(source), radius, type); },
    super: (key, stage, body, target = null) => { syncLive(); handleSuper(key, stage, liveView(body), target ? liveView(target) : null); }
  };
  const replaySkip = $('skip-goal-replay'), replaySkipHint = replaySkip.firstElementChild;
  function updateReplaySkip(replay) {
    if (!replay || shot !== 'match' || demo || online?.spectating) {
      if (!replaySkip.hidden) replaySkip.hidden = true;
      return;
    }
    if (replaySkip.hidden) replaySkip.hidden = false;
    const requested = online?.active && online.state.playUntil !== null;
    const final = online?.active ? online.state.game.winner !== null : phase === 'over';
    const label = requested ? 'Continuing after replay…' : final ? 'Tap for results' : 'Tap for next round';
    const shownMs = online?.active ? performance.now() - replay.started : (replay.elapsedMs ?? (performance.now() - replay.started));
    const hideHint = !requested && replay.loops < 2 && shownMs < 3000;
    if (replaySkipHint.hidden !== hideHint) replaySkipHint.hidden = hideHint;
    if (replaySkipHint.textContent !== label) replaySkipHint.textContent = label;
  }
  replaySkip.onclick = async () => {
    if (!goalReplay || demo) return;
    if (online?.active) {
      try { await online.skipReplay(); } catch (error) { say(error.message); }
    } else if (phase === 'over') {
      endGoalReplay();
      stopFanfare();
      gameAudio()?.stop();
      openSummary();
    } else {
      $('launch').click();
    }
  };
  const postGoalState = { steps: 0, onTick: null };
  function frame(time) {
    const delta = lastTime ? Math.min(1 / 15, Math.max(0, (time - lastTime) / 1000)) : 0; lastTime = time;
    const active = !localPlayBlocked();
    updateLocalPlanClock(!active);
    updateClock();
    if (online?.active) {
      if (phase === 'plan') online.send(networkMoves());
      if (goalReplayAt && performance.now() >= goalReplayAt) {
        goalReplayAt = 0;
        startGoalReplay();
      }
    } else {
      if (active && blitzMode() && phase === 'plan' && performance.now() >= planDeadline) $('launch').click();
      if (goalReplayAt) {
        if (active) goalReplayDelayMs -= delta * 1000;
        if (active && goalReplayDelayMs <= 0) {
          goalReplayAt = 0; goalReplayDelayMs = 0;
          // The winner is announced once the goal call has cleared (the demo does so after its replays).
          if (phase === 'over' && !demo) banner(scores[0] > scores[1] ? 'You win!' : 'CPU wins!', 3500, scores[0] > scores[1] ? 'home' : 'away');
          startGoalReplay();
        }
      }
    }
    if ((goalReplay && !demo) || !replaySkip.hidden) updateReplaySkip(goalReplay);
    if (!active) { lastTime = 0; accumulator = 0; postGoalState.steps = 0; }
    const hadEffects = fieldEffects.particles.length || fieldEffects.fireworks.length || fieldEffects.trails.some(trail => trail.length) || fieldEffects.shockwaves.length || fieldEffects.goalCall || fieldEffects.fireWarp || fieldEffects.koWarp ||
      fieldEffects.ripples.length || fieldEffects.pings.length || fieldEffects.popups.length || fieldEffects.kickoffGlow || fieldEffects.goalSweep || fieldEffects.danger[0] > .02 || fieldEffects.danger[1] > .02;
    // Effects pause with the replay viewer, and in Pulse mode when time freezes between turns.
    const pulseFrozen = pulseMode() && roundTurns > 0 && (phase === 'plan' || phase === 'cpu-wait' || phase === 'waiting');
    const exporting = typeof isExporting === 'function' ? isExporting() : Boolean(theater?.exporting);
    let speed = 1;
    if (!active || clockNow() < hitStopUntil || pulseFrozen) speed = 0;
    else if (theater) speed = theater.paused || exporting ? 0 : theater.speed;
    else if (goalReplay) speed = goalReplay.played >= goalReplay.total ? 0.5 : ububallMatch.replaySpeed(goalReplay.total - goalReplay.played);
    else if (postGoal) speed = ububallMatch.postGoalSpeed(postGoal.ticks);
    const simDelta = delta * speed;
    if (active && !theater?.paused && !exporting) updatePopups(delta, fieldEffects.popups);
    if (active && !theater?.paused && !exporting && !pulseFrozen) updateEffects(simDelta);
    if (theater) { if (active && !exporting) advanceReplay(delta); }
    else if ((phase === 'play' || postGoal) && active && !online?.active) {
      const _tSim = typeof bench !== 'undefined' && bench?.rec ? performance.now() : 0;
      const stepSync = typeof syncTickBodies === 'function' ? syncTickBodies : syncViewBodies;
      if (postGoal) {
        postGoalState.onTick = () => { elapsed += P.DT; };
        if (!advancePostGoal(postGoal, postGoalState, simDelta, liveFx, () => stepSync(postGoal.sim || simBodies, 0), 48, () => hitStopUntil)) postGoal = null;
        syncViewBodies(postGoal?.sim || simBodies, 0);
      } else {
        if (clockNow() < hitStopUntil) accumulator = 0; else accumulator += simDelta;
        let steps = 0, steppedPlay = false;
        while (steps++ < 48 && accumulator >= P.DT && phase === 'play') {
          steppedPlay = true;
          const tick = ububallMatch.playTick(P, simBodies, play, liveFx, tally), { goal } = tick; elapsed += P.DT; accumulator -= P.DT;
          ububallMatch.lapseFouls(P, simBodies, fouls); traceGuide(simBodies);
          stepSync(simBodies, 0);
          applyTickEvents(simBodies, {
            saves: tick.saves, struck: tick.struck, stop: tick.stop, applyIron: false,
            viewFn: (_, s) => fieldView.bodies[s.index], isGoal: goal !== null,
            onStop: () => { accumulator = 0; }
          });
          noteEvents(Math.round(elapsed / P.DT), tick.saves, tick.stop);
          recordTrails();
          if (goal !== null || P.settled(simBodies) || Math.round(elapsed / P.DT) >= ububallMatch.turnTicks(fieldView.mode)) {
            postGoalState.steps = 0;
            finishTurn(goal);
            if (goal !== null) break;
          }
        }
        if (steppedPlay && phase === 'play') syncViewBodies(simBodies, 0);
      }
      if (typeof bench !== 'undefined' && bench?.rec) bench.rec.simMs += (performance.now() - _tSim);
      if (phase === 'play' || postGoal) emitSkaterEffects(simDelta);
      draw();
    } else if (goalReplay && active) advanceGoalReplay(delta);
    else if (online?.active && active && (postGoal || (onlineReplay && !onlineReplay.settledSynced))) {
      const turnRunning = Boolean(onlineReplay && (onlineReplay.currentTick ?? 0) < onlineReplay.ticks);
      if (turnRunning) playOnlineReplay();
      else if (postGoal) {
        postGoalState.onTick = null;
        const seat = postGoal.seat ?? online.state?.seat ?? 0;
        if (!advancePostGoal(postGoal, postGoalState, simDelta, replayFx, () => syncViewBodies(postGoal.sim, seat), 48, () => hitStopUntil)) postGoal = null;
      }
      if ((onlineReplay && (onlineReplay.currentTick ?? 0) < onlineReplay.ticks) || postGoal) emitSkaterEffects(simDelta);
      draw();
    } else if (active && (dragDirty || hadEffects || (phase === 'plan' && presenter.getPredictionCache()?.data?.goal !== null) || (!reducedMotion.matches && (foulsShowing() || fieldView.bodies.some(b => b.meter >= 100 || b.superArm || b.superActive || (P.dazeSlow && P.dazeSlow(b) > 0)))))) {
      if (dragDirty) { dragDirty = false; sync(); }
      draw();
    }
    if (firstTurnStep !== null) animateFirstTurnGuide(time, active);
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
  const fixedTeam = () => setupFor === 'lobby' ? Boolean(lobbyView?.guestTeam) : !signedIn();
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
    const item = ubuList.get(key);
    return item?.model ? entryFor(item) : null;
  }
  function slotView(entry, i, classic, locked, fixed) {
    const slot = node('div', { className: 'formation-slot' });
    slot.dataset.position = POSITIONS[i].toLowerCase();
    slot.classList.toggle('is-selected', i === rosterSlot);
    slot.classList.toggle('is-empty', !entry);
    slot.classList.toggle('just-changed', i === changedSlot);
    // On the ice the slot is centred on the ubu's kickoff spot and its art is the size it plays at.
    const spot = P.kickoff()[i];
    if (entry) ububallMatch.applyStats(P, spot, entry.model.stats || normalStats(), classic ? 'classic' : 'standard');
    slot.style.setProperty('--x', spot.x / 10 + '%'); slot.style.setProperty('--y', spot.y / 6 + '%'); slot.style.setProperty('--r', spot.radius / 5);
    const pick = node('button', { type: 'button', className: 'formation-pick' }, node('span', { className: 'formation-pos', textContent: POSITIONS[i] }));
    if (entry) {
      const arch = archetypeOfModel(entry.model);
      const subLabel = entry.label && entry.label !== entry.model.parts.fullName
        ? [arch, entry.label].filter(Boolean).join(' · ')
        : (arch || entry.label || '');
      pick.append(ubuRender.spriteImg ? ubuRender.spriteImg(entry.model, 'formation-art', 256) : ubuRender(entry.model, 'formation-art'), node('span', { className: 'formation-name' },
        node('strong', { textContent: entry.model.parts.fullName }), node('small', { textContent: subLabel })));
    }
    else pick.append(node('span', { className: 'formation-art formation-empty-art' }), node('span', { className: 'formation-name' },
      node('strong', { textContent: 'Empty' }), node('small', { textContent: i === rosterSlot ? 'Pick an ubu' : 'Select to fill' })));
    pick.setAttribute('aria-pressed', String(i === rosterSlot));
    pick.setAttribute('aria-label', `${POSITIONS[i]}: ${entry ? entry.model.parts.fullName : 'empty'}`);
    // From the rules step (where the lineup stands on the ice) a position opens the team step.
    pick.onclick = () => { rosterSlot = i; if ($('roster-dialog').dataset.step === 'mode') setupStep('team'); else rosterSlots(); };
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
    const text = teamLocked() ? 'Your team is locked in. Choose Change team to edit it.' :
      fixedTeam() ? (classic ? 'Guests play with these three ubus.' : 'Guests play with these three ubus. Pick each ubu’s super with its super button.') : '';
    $('roster-hint').textContent = text;
  }
  function rosterSlots() {
    const classic = setupClassic(), locked = teamLocked(), fixed = fixedTeam();
    $('roster-dialog').toggleAttribute('data-locked', locked);
    $('roster-slots').replaceChildren(...draft.map((entry, i) => slotView(entry, i, classic, locked, fixed)));
    changedSlot = -1;
    teamHint(classic);
    rosterList.render();
    $('start-match').disabled = draft.some(d => !d);
    updateTeamBar();
  }
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
    paused: () => !sheetOpen() || $('roster-dialog').dataset.step !== 'team',
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
  // one of the player's own ubus (guest ubus change every visit). A null super means the
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
  $('roster-super').addEventListener('toggle', event => { if (event.newState === 'closed' && sheetOpen()) rosterSlots(); });
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
  // Signing in, or gaining a first team, replaces a guest team with the account's own.
  const onGuestTeam = () => roster.length > 0 && roster.every(entry => Boolean(entry?.key?.startsWith('guest-')));
  async function adoptAccountTeam() {
    if (!signedIn() || online?.active || !onGuestTeam()) return;
    const entries = await accountTeam();
    if (!entries || online?.active || !onGuestTeam()) return;
    draft = entries;
    if (demo) newDemoGame(entries); else if (!matchInProgress()) newMatch();
    updateHome();
  }
  // A signed-in player always fields their own ubus. Nothing starts until they have them.
  async function ownTeamReady() {
    for (;;) {
      try { await window.ubuStarter.ensureSignup(); await adoptAccountTeam(); return true; }
      catch (error) {
        if (!await gameUi.confirm({ title: 'Could not get your ubus', message: error.message, confirmLabel: 'Retry' })) return false;
      }
    }
  }
  window.addEventListener('ubu:session', async event => {
    savedTeams = null; teamIndex = -1; updateTeamBar(); updateHome();
    if (event.detail?.owner) try { await adoptAccountTeam(); } catch {}
  });
  // An unopened signup pack takes the place of the home team until it is opened.
  function showSignupPack() {
    const signup = Boolean(window.ubuStarter.status?.signup);
    $('home-pack').hidden = !signup;
    $('home-lineup').hidden = $('new-match').hidden = signup;
    $('home-title').textContent = signup ? 'Signup bonus' : 'Your team';
    if (signup) void window.loadMintScripts();
    const adopted = !signup && signedIn() ? ubuList.load({ refresh: true }).then(adoptAccountTeam).catch(() => {}) : null;
    if (window.ubuStarter.known) void Promise.resolve(adopted).then(() => $('home-pack').parentElement.classList.add('settled'));
  }
  window.addEventListener('ubu:starter', showSignupPack);
  document.addEventListener('DOMContentLoaded', showSignupPack); // The status may have come before this script.
  function updateSoundUI() {
    const slider = $('setting-sound-volume');
    const badge = $('setting-sound-val');
    if (slider) {
      slider.value = soundVolume;
      slider.style.setProperty('--fill-pct', `${soundVolume}%`);
    }
    if (badge) badge.textContent = `${soundVolume}%`;
  }
  function updateMusicUI() {
    const slider = $('setting-music-volume');
    const badge = $('setting-music-val');
    if (slider) {
      slider.value = musicVolume;
      slider.style.setProperty('--fill-pct', `${musicVolume}%`);
    }
    if (badge) badge.textContent = `${musicVolume}%`;
  }
  function updateAudioModeUI() {
    const btn = $('setting-audio-mode');
    if (btn) {
      const isSt = audioMode === 'stereo';
      btn.setAttribute('aria-pressed', isSt ? 'true' : 'false');
      const val = btn.querySelector('.setting-value');
      if (val) val.textContent = isSt ? 'Stereo' : 'Mono';
    }
  }
  function applyAudioSettings() {
    if (window.ubuAudio) {
      window.ubuAudio.setSoundVolume?.(soundVolume / 100);
      window.ubuAudio.setMusicVolume?.(musicVolume / 100);
      window.ubuAudio.setAudioMode?.(audioMode);
      window.ubuAudio.setOrientation?.(fieldView.portrait);
    }
  }

  updateSoundUI();
  updateMusicUI();
  updateAudioModeUI();
  applyAudioSettings();

  const soundSlider = $('setting-sound-volume');
  if (soundSlider) {
    soundSlider.oninput = () => {
      soundVolume = Math.max(0, Math.min(100, Number(soundSlider.value) || 0));
      updateSoundUI();
      window.ubuAudio?.setSoundVolume?.(soundVolume / 100);
      try { localStorage.setItem('ububall-sound-volume', String(soundVolume)); } catch {}
      if (soundVolume === 0) window.ubuAudio?.stopMotion?.();
    };
  }

  const musicSlider = $('setting-music-volume');
  if (musicSlider) {
    musicSlider.oninput = () => {
      musicVolume = Math.max(0, Math.min(100, Number(musicSlider.value) || 0));
      updateMusicUI();
      window.ubuAudio?.setMusicVolume?.(musicVolume / 100);
      try { localStorage.setItem('ububall-music-volume', String(musicVolume)); } catch {}
      if (musicVolume === 0) stopFanfare();
    };
  }

  const audioModeBtn = $('setting-audio-mode');
  if (audioModeBtn) {
    audioModeBtn.onclick = () => {
      audioMode = audioMode === 'stereo' ? 'mono' : 'stereo';
      updateAudioModeUI();
      window.ubuAudio?.setAudioMode?.(audioMode);
      try { localStorage.setItem('ububall-audio-mode', audioMode); } catch {}
    };
  }
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
  let rulesGameNumber = 0;
  const quickPlayKey = 'ububall-last-cpu-setup';
  let lastCpuSetup = null;
  try {
    const saved = JSON.parse(localStorage.getItem(quickPlayKey));
    if (saved && ['easy', 'medium', 'hard'].includes(saved.level) &&
        (saved.mode === 'standard' || typeof saved.mode === 'string' &&
          saved.mode.split('-').every(rule => ububallMatch.RULES.includes(rule))) &&
        Array.isArray(saved.team) && saved.team.length === 3 &&
        saved.team.every(entry => entry && typeof entry.key === 'string')) lastCpuSetup = saved;
  } catch {}
  const chosenMode = () => ububallMatch.RULES.filter(rule => $('rule-' + rule).checked).join('-') || 'standard';
  const modeSummary = () => { $('mode-summary').textContent = ububallMatch.modeName(chosenMode()); };
  for (const rule of ububallMatch.RULES) $('rule-' + rule).addEventListener('change', modeSummary);
  function setupStep(step) {
    const sheet = $('roster-dialog'), hadLineup = $('roster-slots').childElementCount > 0;
    sheet.dataset.step = step; sheet.dataset.for = setupFor;
    $('sheet-next').textContent = setupFor === 'rules' ? 'Apply rules' : setupFor === 'online' ? 'Next: online match' : 'Choose team';
    $('sheet-next').classList.toggle('primary', setupFor !== 'cpu');
    const shortcut = step === 'mode' && setupFor === 'cpu';
    $('sheet-start').hidden = !shortcut;
    if (shortcut) {
      const complete = draft.length === 3 && draft.every(entry => entry?.model);
      const slots = complete && signedIn() ? teamSlotsOf(draft) : null;
      const selected = savedTeams?.teams[teamIndex];
      const name = sameSlots(slots, selected?.slots) ? selected.name : savedTeams?.teams.find(team => sameSlots(slots, team.slots))?.name;
      $('sheet-start').disabled = !complete || (signedIn() && !slots);
      $('sheet-team-name').textContent = name || '';
      $('sheet-team-name').hidden = !name;
      $('sheet-team-preview').replaceChildren(...draft.filter(entry => entry?.model).map(entry => ubuRender.spriteImg ? ubuRender.spriteImg(entry.model, 'sheet-team-art', 256) : ubuRender(entry.model, 'sheet-team-art')));
    }
    $('lobby-panel').hidden = setupFor !== 'lobby';
    $('team-title').textContent = setupFor === 'lobby' ? 'Online match' : 'Your team';
    $('team-back').hidden = setupFor === 'pick' || (setupFor === 'lobby' && !lobbyView?.state.canChangeRules);
    if (step === 'team') {
      $('team-mode').textContent = ububallMatch.modeName(setupFor === 'lobby' ? lobbyView.state.mode : chosenMode());
      if (!fixedTeam()) { void loadCollection(); void loadTeams(); }
      rosterSlots();
    } else {
      // Keep a CPU match's lineup on the ice through the rules step.
      if (setupFor === 'cpu') rosterSlots();
      else if (!sheetOpen()) $('roster-slots').replaceChildren();
    }
    $('start-match').textContent = setupFor === 'pick' ? 'Use team' : setupFor !== 'lobby' ? 'Start match' : lobbyView?.ready ? 'Change team' : 'Ready to play';
    if (sheetOpen()) {
      setShot(step === 'team' ? 'team' : 'rules');
      const wantsLineup = step === 'team' || setupFor === 'cpu';
      if (!hadLineup && wantsLineup && $('roster-slots').childElementCount) skateLineup(true);
      else if (hadLineup && !wantsLineup) skateLineup(false);
    }
  }
  // The rules and team setup shots. On wide screens the team sheet docks over the away half of a
  // game-size rink; on phones it stacks below the rink while the lineup stands at its kickoff spots.
  const wideScreen = matchMedia('(min-width: 56rem) and (orientation: landscape) and (not ((pointer: coarse) and (max-height: 600px)))');
  const sheetOpen = () => $('roster-dialog').classList.contains('open');
  let lineupMove = null;
  function fitSetupShot() {
    if (isSetupShot()) document.body.style.setProperty('--setup-top', Math.round(document.querySelector('.ball-page').getBoundingClientRect().top + scrollY) + 'px');
  }
  function skateLineup(on) {
    const slots = $('roster-slots');
    lineupMove?.cancel(); lineupMove = null;
    slots.inert = !on;
    if (reducedMotion.matches || !slots.animate) { if (!on) slots.replaceChildren(); return; }
    const off = { translate: '-45cqw 0', opacity: 0 }, at = { translate: '0 0', opacity: 1 };
    const move = lineupMove = slots.animate(on ? [off, at] : [at, off], { duration: on ? 480 : 260, delay: on ? 240 : 0, easing: on ? 'cubic-bezier(.2, .8, .2, 1)' : 'ease-in', fill: 'both' });
    move.onfinish = () => {
      if (lineupMove !== move) return;
      if (!on) slots.replaceChildren();
      move.cancel(); lineupMove = null;
    };
  }
  function resetSetupSlots() {
    if (sheetOpen()) return;
    lineupMove?.cancel(); lineupMove = null;
    $('roster-slots').inert = false;
  }
  function openSheet() {
    const sheet = $('roster-dialog');
    handoffToMatch = false;
    if (sheetOpen()) return;
    if (!isSetupShot()) {
      returnShot = setupFor === 'lobby' ? homeShot : shot;
      returnPortrait = setupFor === 'lobby' ? false : fieldView.portrait;
    }
    for (const id of ['pause-menu', 'match-help', 'stats-dialog', 'match-summary', 'replays-dialog', 'online-dialog']) {
      if ($(id)?.open) $(id).close();
    }
    if (statDrawer.matches(':popover-open')) statDrawer.hidePopover();
    closeFoulInfo();
    sheet.classList.add('open');
    setShot(sheet.dataset.step === 'team' ? 'team' : 'rules');
    castTo(true);
    if ($('roster-slots').childElementCount) skateLineup(true);
  }
  function closeSheet() {
    const sheet = $('roster-dialog');
    if (!sheetOpen()) { handoffToMatch = false; return; }
    if ($('roster-super')?.matches?.(':popover-open')) $('roster-super').hidePopover();
    if ($('team-menu')?.matches?.(':popover-open')) $('team-menu').hidePopover();
    sheet.classList.remove('open');
    if (!handoffToMatch) leaveSetupShot(false);
  }
  function cancelSheet() {
    if (!sheetOpen()) return;
    if ($('roster-dialog').dataset.step === 'team' && setupFor !== 'lobby' && setupFor !== 'pick') setupStep('mode');
    else closeSheet();
  }
  // Leaving for a match hands the camera move to enterMatch; the new match's ubus stand where the lineup stood.
  function leaveSetupShot(toMatch = false) {
    handoffToMatch = false;
    if (!isSetupShot()) return;
    if (toMatch) {
      lineupMove?.cancel(); lineupMove = null; $('roster-slots').replaceChildren();
      if (cast) { cancelAnimationFrame(cast.frame); castHome(); cast = null; }
      fieldView.castHidden = false; rinkWrap.classList.remove('cast-away');
      return;
    }
    const back = returnShot === 'replay' && !theater ? homeShot : returnShot;
    setShot(back, { keepPortrait: isMatchShot(back) });
    castTo(false);
    if ($('roster-slots').childElementCount) skateLineup(false);
  }
  wideScreen.addEventListener('change', () => {
    if (!isSetupShot()) return;
    scrollTo(0, 0);
    fitSetupShot();
    layoutDirty = true;
    draw();
  });
  // Escape steps back from team to mode, or closes the docked setup panel.
  addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !isSetupShot() || event.defaultPrevented || document.querySelector('dialog:modal, :popover-open')) return;
    cancelSheet();
  });
  function openSetup(step, purpose = 'cpu', mode = cpuMode, level = cpuLevel, team = roster) {
    setupFor = purpose; resetSetupSlots();
    for (const rule of ububallMatch.RULES) $('rule-' + rule).checked = ububallMatch.rule(mode, rule);
    modeSummary();
    $('rules-status').textContent = '';
    if (purpose === 'rules') rulesGameNumber = online.state.gameNumber;
    document.querySelector(`input[name="cpu-level"][value="${level}"]`).checked = true;
    draft = [...team]; rosterSlot = 0; $('roster-status').textContent = '';
    $('roster-scroll').scrollTop = 0;
    void loadCollection();
    setupStep(step);
    openSheet();
  }
  // The online lobby. A guest seat fields the room's own three ubus; otherwise the player
  // picks from their collection, starting from their current, last or favorite team.
  const lobbyEntries = team => team.map((p, i) => {
    const model = ubu.decode(ubu.fromCode(p.dna));
    return { model, dna: p.dna, label: 'Guest ubu', key: 'online-' + i };
  });
  let lobbyGeneration = 0;
  async function showLobby(view, open) {
    const gen = ++lobbyGeneration;
    const before = lobbyView, entering = setupFor !== 'lobby';
    lobbyView = view;
    const teamChanged = JSON.stringify(before?.guestTeam || null) !== JSON.stringify(view.guestTeam || null);
    if (entering || teamChanged) {
      setupFor = 'lobby'; rosterSlot = 0; resetSetupSlots();
      if (view.guestTeam) draft = lobbyEntries(view.guestTeam);
      else {
        const readyOk = await ownTeamReady(); // The server opened any signup pack as this seat was taken.
        if (gen !== lobbyGeneration || setupFor !== 'lobby' || lobbyView !== view) return;
        if (!readyOk) { await online?.leave(); return; }
        draft = roster.every(entry => ubuList.get(entry.key)?.model) ? roster.map(entry => ({ ...entry })) : [null, null, null];
        if (draft.some(d => !d) && signedIn()) {
          try {
            const team = await accountTeam();
            if (gen !== lobbyGeneration || setupFor !== 'lobby' || lobbyView !== view) return;
            if (team && draft.some(d => !d)) draft = team;
          } catch {}
        }
      }
    }
    if (gen !== lobbyGeneration || setupFor !== 'lobby' || lobbyView !== view) return;
    // Owned-ubu matches take only the player's collection.
    $('roster-scroll').hidden = Boolean(view.guestTeam);
    if (!view.guestTeam) void loadCollection();
    $('lobby-note').textContent = view.note;
    $('lobby-login').hidden = !view.guest;
    if (entering || before?.state.mode !== view.state.mode) {
      for (const rule of ububallMatch.RULES) $('rule-' + rule).checked = ububallMatch.rule(view.state.mode, rule);
      modeSummary();
    }
    if (entering) setupStep(view.state.challenge ? 'mode' : 'team');
    else setupStep($('roster-dialog').dataset.step);
    if (open) openSheet();
  }
  function closeLobby() {
    lobbyGeneration++;
    if (setupFor !== 'lobby') return;
    const toMatch = Boolean(online?.state?.game && online.state.phase !== 'lobby');
    if ($('roster-dialog').dataset.for === 'lobby') {
      if (toMatch && isSetupShot()) handoffToMatch = true;
      closeSheet();
    }
    setupFor = 'cpu'; lobbyView = null;
    $('roster-scroll').hidden = false; $('lobby-panel').hidden = true;
    $('roster-dialog').removeAttribute('data-locked');
  }
  // In Discord, Ready to play fields the chosen team, so choosing one starts nothing.
  $('new-match').onclick = async () => { if (await ownTeamReady()) openSetup('team', inDiscord ? 'pick' : 'cpu'); };
  $('sheet-next').onclick = async () => {
    if (setupFor === 'cpu') { setupStep('team'); return; }
    if (setupFor === 'lobby' || setupFor === 'rules') {
      const button = $('sheet-next'), purpose = setupFor;
      button.disabled = true; $('rules-status').textContent = '';
      try {
        const gameNumber = purpose === 'rules' ? rulesGameNumber : lobbyView.state.gameNumber;
        await online.rules(chosenMode(), gameNumber);
        if (purpose === 'rules') closeSheet();
        else setupStep('team');
      } catch (error) { $('rules-status').textContent = error.message; }
      finally { button.disabled = false; }
      return;
    }
    closeSheet(); online.create(chosenMode());
  };
  $('team-back').onclick = async () => {
    if (setupFor === 'lobby' && lobbyView.ready) {
      try { await online.unready(); }
      catch (error) { $('roster-status').textContent = error.message; return; }
    }
    setupStep('mode');
  };

  $('start-match').onclick = async () => {
    if (setupFor === 'lobby') {
      const button = $('start-match');
      button.disabled = true;
      try {
        if (lobbyView.ready) await online.unready();
        else {
          if (draft.some(d => !d)) return;
          const supers = draft.map((d, i) => resolveEquippedSuper(d, i).id);
          await online.ready(lobbyView.guestTeam ? { supers } : { serials: draft.map(d => d.key), supers });
          if (!lobbyView.guestTeam) rememberTeam();
        }
      } catch (error) { $('roster-status').textContent = error.message; }
      finally { button.disabled = draft.some(d => !d); }
      return;
    }
    if (draft.some(d => !d)) return;
    if (setupFor === 'pick') {
      closeSheet();
      rememberTeam();
      if (demo) newDemoGame(draft); else if (!matchInProgress()) newMatch();
      return;
    }
    await startFromSetup($('start-match'));
  };
  $('sheet-start').onclick = () => startFromSetup($('sheet-start'));
  async function startFromSetup(button) {
    if (button.disabled || draft.some(entry => !entry)) return;
    const team = [...draft], mode = chosenMode(), level = document.querySelector('input[name="cpu-level"]:checked').value;
    button.disabled = true;
    try {
      if (online?.active) {
        if (!await online.leave()) return;
      } else if (matchInProgress()) {
        if (!await confirmCpuEnd(true)) return;
        finishCpuMatch();
      }
      if (isSetupShot()) handoffToMatch = true;
      closeSheet();
      $('pause-menu').close();
      startCpuMatch(team, mode, level);
    } finally { button.disabled = false; }
  }
  function startCpuMatch(team, mode, level) {
    clearReplayViewer();
    stopDemo();
    draft = team.map((entry, idx) => ({ ...entry, key: entry.key || `custom-${idx}`, label: entry.label || 'Custom ubu' }));
    roster = [...draft];
    rememberTeam();
    cpuMode = mode;
    cpuLevel = level;
    lastCpuSetup = {
      mode, level,
      team: draft.map(({ key, dna, label, equippedSuper }) => ({
        key, dna: !ubuList.get(key)?.model ? dna : undefined, label, equippedSuper: equippedSuper ? { id: equippedSuper.id } : null
      }))
    };
    try { localStorage.setItem(quickPlayKey, JSON.stringify(lastCpuSetup)); } catch {}
    newMatch(true);
    enterMatch();
    online?.contextChanged();
    if (!firstTurnSeen) {
      firstTurnStep = 'aim';
      updateFirstTurnGuide();
    }
  }
  $('cancel-roster').onclick = closeSheet;
  $('lobby-leave').onclick = () => online.leave();
  // A modal pauses the simulation; cancelling preserves the current turn.
  const hudSuperBtn = $('stadium-super-btn');
  gameUi.dropdown($('super-info'), $('super-info-panel'), { align: 'end', prepare: () => {
    const ability = fieldView.bodies[selected]?.equippedSuper || P.SUPERS[0];
    $('super-info-name').textContent = ability.displayName || ability.name;
    $('super-info-description').textContent = ability.desc;
  } });
  if (hudSuperBtn) {
    hudSuperBtn.onclick = () => {
      const b = fieldView.bodies[selected];
      if (!classicMode() && b && b.meter >= 100 && knobEditable(selected)) {
        b.superArm = !b.superArm;
        dirtyPrediction();
        sync(); draw();
        saveActiveMatch();
      }
    };
  }

  const fullscreenTarget = document.documentElement;
  const fullscreenDisplay = matchMedia('(display-mode: fullscreen)');
  let fullscreenRequest = null;
  const ownsFullscreen = () => document.fullscreenElement === fullscreenTarget;

  function syncFullscreenButton() {
    const owned = ownsFullscreen();
    const active = Boolean(document.fullscreenElement) || fullscreenDisplay.matches;
    document.body.classList.toggle('match-fullscreen', isMatchShot() && active);
    btnFullscreen.hidden = !isMatchShot() || inDiscord || (!owned && (active || !document.fullscreenEnabled));
    btnFullscreen.disabled = Boolean(fullscreenRequest);
    const label = owned ? 'Exit fullscreen' : 'Enter fullscreen';
    btnFullscreen.title = label;
    btnFullscreen.setAttribute('aria-label', label);
    btnFullscreen.setAttribute('aria-pressed', String(owned));
  }

  function updateFullscreenUI() {
    syncFullscreenButton();
    fitScorebug();
    layoutDirty = true;
    draw();
  }

  async function exitOwnedFullscreen() {
    if (fullscreenRequest) fullscreenRequest.leaving = true;
    if (ownsFullscreen()) await document.exitFullscreen().catch(() => {});
  }

  btnFullscreen.onclick = async () => {
    if (btnFullscreen.hidden || fullscreenRequest) return;
    if (ownsFullscreen()) {
      await exitOwnedFullscreen();
      return;
    }
    const request = { leaving: false };
    fullscreenRequest = request;
    btnFullscreen.disabled = true;
    try {
      await fullscreenTarget.requestFullscreen();
      if (request.leaving) await exitOwnedFullscreen();
    } catch {
      // The browser can deny fullscreen. Keep the layout tied to its actual state.
    } finally {
      fullscreenRequest = null;
      updateFullscreenUI();
    }
  };

  function setPortrait(value) {
    const next = Boolean(value);
    if (fieldView.portrait === next) return;
    layoutDirty = true;
    fieldView.portrait = next;
    stadium?.classList.toggle('portrait-mode', next);
    window.ubuAudio?.setOrientation?.(next);
    if (btnRotate) {
      btnRotate.setAttribute('aria-pressed', String(next));
      btnRotate.title = next ? 'Switch to landscape orientation' : 'Switch to portrait orientation';
      btnRotate.setAttribute('aria-label', next ? 'Switch to landscape orientation' : 'Switch to portrait orientation');
    }
    draw();
  }

  function toggleRotate() {
    setPortrait(!fieldView.portrait);
    try {
      const prefix = portraitScreen?.matches ? 'portrait:' : 'landscape:';
      localStorage.setItem('ububall-orientation', prefix + (fieldView.portrait ? 'portrait' : 'landscape'));
    } catch {}
  }

  if (btnRotate) btnRotate.onclick = toggleRotate;
  document.addEventListener('fullscreenchange', updateFullscreenUI);
  fullscreenDisplay.addEventListener('change', updateFullscreenUI);
  // Match and replay shots: the stadium fills the screen and the site chrome steps aside.
  // Entering adds a history entry, so the system back button opens the menu instead of leaving.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (foulInfo) closeFoulInfo();
      else if (isMatchShot() && !ownsFullscreen() && !document.querySelector('dialog[open]')) openPause();
      return;
    }
    if (!playableShot() || theater || e.ctrlKey || e.altKey || e.metaKey) return;
    if (document.querySelector('dialog[open]') || e.target.closest?.('button, a, input, select, textarea, [tabindex], [contenteditable]')) return;

    if (e.key === ' ') {
      e.preventDefault();
      selected = (selected + 1) % 3;
      sync(); draw();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      $('launch').click();
      return;
    }
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      e.preventDefault();
      selected = Number(e.key) - 1;
      sync(); draw();
      return;
    }
    if (e.key === 'g' || e.key === 'G') {
      e.preventDefault();
      toggleGuard(selected);
      return;
    }
    const repeatDefer = Boolean(e.repeat && typeof requestAnimationFrame === 'function');
    const persistKeyChange = () => { if (e.repeat && typeof scheduleSaveActiveMatch === 'function') scheduleSaveActiveMatch(); else saveActiveMatch(); };
    if (e.key === 'w' || e.key === 'W') {
      if (knobEditable(selected)) {
        e.preventDefault();
        setKnob('power', selected, knobValue('power', selected) + (e.shiftKey ? 10 : 5), repeatDefer);
        persistKeyChange();
      }
      return;
    }
    if (e.key === 's' || e.key === 'S') {
      if (knobEditable(selected)) {
        e.preventDefault();
        setKnob('power', selected, knobValue('power', selected) - (e.shiftKey ? 10 : 5), repeatDefer);
        persistKeyChange();
      }
      return;
    }
    if (e.key === 'a' || e.key === 'A') {
      if (knobEditable(selected)) {
        e.preventDefault();
        setKnob('angle', selected, knobValue('angle', selected) - (e.shiftKey ? 15 : 5), repeatDefer);
        persistKeyChange();
      }
      return;
    }
    if (e.key === 'd' || e.key === 'D') {
      if (knobEditable(selected)) {
        e.preventDefault();
        setKnob('angle', selected, knobValue('angle', selected) + (e.shiftKey ? 15 : 5), repeatDefer);
        persistKeyChange();
      }
      return;
    }
    if (e.key === 'q' || e.key === 'Q') {
      if (knobEditable(selected)) {
        e.preventDefault();
        setKnob('spin', selected, knobValue('spin', selected) - (e.shiftKey ? 20 : 10), repeatDefer);
        persistKeyChange();
      }
      return;
    }
    if (e.key === 'e' || e.key === 'E') {
      if (knobEditable(selected)) {
        e.preventDefault();
        setKnob('spin', selected, knobValue('spin', selected) + (e.shiftKey ? 20 : 10), repeatDefer);
        persistKeyChange();
      }
      return;
    }
  });
  const portraitScreen = matchMedia('(orientation: portrait)');
  function fitOrientation() {
    if (!isMatchShot()) return;
    let want = portraitScreen.matches;
    try {
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('ububall-orientation') : null;
      const prefix = portraitScreen.matches ? 'portrait:' : 'landscape:';
      if (saved === prefix + 'portrait') want = true;
      else if (saved === prefix + 'landscape') want = false;
    } catch {}
    setPortrait(want);
  }
  function matchInProgress() { return !demo && phase !== 'over' && Boolean(recording && !online?.active); }
  function updateHome() {
    const active = online?.active || matchInProgress();
    $('home-play-label').textContent = online?.active ? 'Back to online match' : active ? 'Resume match' : 'Quick play';
    $('home-end-match').hidden = !active || Boolean(online?.spectating);
    $('quick-play-setup').hidden = Boolean(active);
    $('quick-play-signin').hidden = Boolean(active || signedIn());
    const { mode, level, team } = lastCpuSetup || { mode: 'standard', level: 'easy' };
    $('quick-play-setup').textContent = [ububallMatch.modeName(mode), level[0].toUpperCase() + level.slice(1),
      team ? 'Last team' : signedIn() ? 'Your team' : 'Guest team'].join(' · ');
  }
  function enterMatch(next = 'match') {
    if (location.pathname !== '/') return;
    if (demo) { stopDemo(); newMatch(true); }
    if (!history.state?.match) {
      const url = new URL(location.href);
      if (online?.spectating) {
        const home = new URL(url);
        home.searchParams.delete('watch');
        history.replaceState(null, '', home);
      }
      history.pushState({ match: true }, '', url);
    }
    leaveSetupShot(true);
    if (typeof lineupMove !== 'undefined' && lineupMove) { lineupMove.cancel(); lineupMove = null; }
    $('roster-slots')?.replaceChildren?.();
    if (cast) { cancelAnimationFrame(cast.frame); castHome(); cast = null; }
    fieldView.castHidden = false; rinkWrap.classList.remove('cast-away');
    setShot(next);
  }
  function exitMatchMode() {
    closeFirstTurnGuide();
    closeFoulInfo();
    closeSummary();
    stopFanfare();
    gameAudio()?.stopMotion?.();
    if (typeof isExporting === 'function' && isExporting()) { if (typeof cancelExport === 'function') cancelExport(); else { videoCancelled = true; cancelVideo?.(); } }
    returnShot = homeShot;
    returnPortrait = false;
    if (typeof closeSheet === 'function') closeSheet();
    else $('roster-dialog')?.classList?.remove('open');
    for (const dialogId of ['match-help', 'pause-menu', 'replays-dialog', 'export-dialog', 'share-dialog']) {
      if ($(dialogId)?.open) $(dialogId).close();
    }
    if (statDrawer.matches(':popover-open')) statDrawer.hidePopover();
    endReplay();
    if (!matchInProgress()) cpuClient.dispose?.();
    if (location.pathname !== '/') demoClient.dispose?.();
    if (!isHomeShot()) {
      if (typeof lineupMove !== 'undefined' && lineupMove) { lineupMove.cancel(); lineupMove = null; }
      $('roster-slots')?.replaceChildren?.();
      if (cast) { cancelAnimationFrame(cast.frame); castHome(); cast = null; }
      fieldView.castHidden = false; rinkWrap.classList.remove('cast-away');
      setShot(homeShot);
      void exitOwnedFullscreen();
    }
    updateHome();
    online?.contextChanged?.();
    if (!matchInProgress() && location.pathname === '/') startDemo();
  }
  function openPause() {
    const inReplay = Boolean(theater);
    $('pause-title').textContent = inReplay ? 'Replay' : online?.spectating ? 'Watching' : online?.active ? online.state.matchKind === 'online' ? 'Online match' : 'Friend match' : 'CPU match';
    $('pause-resume').textContent = inReplay ? 'Resume replay' : online?.spectating ? 'Resume watching' : online?.active ? 'Resume match' : 'Resume CPU match';
    $('pause-end-match').hidden = inReplay || online?.spectating || !(online?.active || matchInProgress());
    $('pause-leave').textContent = inReplay ? 'Exit replay' : inDiscord ? 'Back to lobby' : 'Back to home';
    $('pause-restart').disabled = $('new-match').disabled;
    $('pause-restart').hidden = Boolean(online?.active);
    if (inDiscord) {
      $('pause-menu').classList.add('has-activity-lobby');
      $('pause-lobby').hidden = false;
      $('pause-lobby').append($('activity-play'));
      online?.contextChanged();
    }
    $('pause-menu').showModal();
  }
  $('pause-menu').addEventListener('close', () => {
    if (inDiscord && !$('pause-menu').open) document.querySelector('.play-home').prepend($('activity-play'));
    online?.contextChanged();
  });
  function finishCpuMatch() {
    saveRecording(); clearActiveMatch();
    cpuGeneration++; cpuClient.cancel(); cpuClient.dispose?.();
    draft = [...roster];
    phase = 'over'; drag = null;
    closeFirstTurnGuide(); closeFoulInfo(); endGoalReplay(); stopFanfare(); gameAudio()?.stop();
  }
  function confirmCpuEnd(replacing = false) {
    return gameUi.confirm({
      title: replacing ? 'Start a new match?' : 'End match?',
      message: replacing ? 'Starting a new match ends your current CPU match.' : 'You won’t be able to resume this CPU match.',
      confirmLabel: replacing ? 'Start new match' : 'End match', cancelLabel: 'Keep match', danger: true
    });
  }
  $('pause').onclick = openPause;
  $('pause-help').onclick = () => {
    $('match-help-aim').textContent = aimHelp();
    $('pause-menu').close();
    $('match-help').showModal();
  };
  $('match-help-back').onclick = () => {
    $('match-help').close();
    openPause();
    $('pause-help').focus();
  };
  $('match-help').addEventListener('cancel', event => {
    event.preventDefault();
    $('match-help-back').click();
  });
  $('match-stats').onclick = () => theater ? openStats() : openMatchStats('pause');
  $('pause-resume').onclick = () => $('pause-menu').close();
  async function leaveForHome(button, endMatch) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      if (online?.active) {
        if (!await online.leave()) return;
      } else if (endMatch && matchInProgress()) {
        if (!await confirmCpuEnd()) return;
        finishCpuMatch();
      }
      exitMatchMode();
      if (history.state?.match) history.back();
      if (!matchInProgress()) startDemo();
    } finally { button.disabled = false; }
  }
  $('pause-leave').onclick = () => leaveForHome($('pause-leave'), false);
  $('pause-end-match').onclick = () => leaveForHome($('pause-end-match'), true);
  $('home-end-match').onclick = () => leaveForHome($('home-end-match'), true);
  async function openNewMatch(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (!await ownTeamReady()) return;
      let team = roster;
      const tempTeam = onGuestTeam() || roster.some(entry => !entry?.key || entry.key.startsWith('replay-'));
      if (online?.active || (signedIn() && tempTeam)) team = signedIn() ? await accountTeam() : guestTeam;
      if (location.pathname === '/' && !sheetOpen()) {
        openSetup('mode', 'cpu', lastCpuSetup?.mode, lastCpuSetup?.level, team || [null, null, null]);
      }
    } catch (error) {
      await gameUi.confirm({ title: 'Could not load your team', message: error.message, confirmLabel: 'OK' });
    } finally { button.disabled = false; }
  }
  $('pause-restart').onclick = $('home-new-match').onclick = openNewMatch;
  $('home-play').onclick = async () => {
    if (online?.active || matchInProgress()) { enterMatch(); return; }
    if (!await ownTeamReady()) return;
    const saved = lastCpuSetup;
    if (!saved) { startCpuMatch(roster, 'standard', 'easy'); return; }
    const button = $('home-play');
    button.disabled = true;
    try {
      const inlineSetup = saved.team.some(entry => Boolean(entry.dna) || entry.key?.startsWith('guest-') || entry.key?.startsWith('replay-') || entry.key?.startsWith('custom-'));
      const guestSetup = saved.team.every(entry => Boolean(entry.key?.startsWith('guest-')));
      if (!inlineSetup && signedIn()) await ubuList.load({ refresh: true });
      if (online?.active || matchInProgress() || location.pathname !== '/' || sheetOpen()) return;
      const team = guestSetup && signedIn() ? roster : saved.team.map(entry => entry.dna ? restoreEntry(entry)
        : signedIn() ? restoreTeam([{ serial: entry.key, super: entry.equippedSuper?.id ?? null }]).team[0] : null);
      if (team.some(entry => !entry)) throw new Error('Last team unavailable');
      startCpuMatch(team, saved.mode, saved.level);
    } catch {
      if (location.pathname === '/' && !online?.active && !matchInProgress() && !sheetOpen()) {
        openSetup('team', 'cpu', saved.mode, saved.level);
        $('roster-status').textContent = 'Your last team is unavailable. Choose a team to start.';
      }
    } finally { button.disabled = false; }
  };
  $('demo-play').onclick = () => $('home-play').click();
  portraitScreen.addEventListener('change', () => {
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem('ububall-orientation'); } catch {}
    gameUi.updateScale?.();
    fitOrientation();
    draw();
  });
  window.addEventListener('popstate', () => {
    if (location.pathname !== '/') return;
    if (history.state?.match) {
      if (online?.active || matchInProgress()) enterMatch('match');
      else if (theater) enterMatch('replay');
    } else if (online?.spectating) void online.leave().then(exitMatchMode);
    else if (isSetupShot() && isMatchShot(returnShot)) {
      history.pushState({ match: true }, '', location.href);
      cancelSheet();
    } else if (isMatchShot()) {
      history.pushState({ match: true }, '', location.href);
      openPause();
    }
  });
  function leavePlayOverlays() {
    closeFirstTurnGuide();
    closeFoulInfo();
    closeSummary();
    stopFanfare();
    gameAudio()?.stopMotion?.();
    if (typeof isExporting === 'function' && isExporting()) { if (typeof cancelExport === 'function') cancelExport(); else { videoCancelled = true; cancelVideo?.(); } }
    returnShot = homeShot;
    returnPortrait = false;
    handoffToMatch = false;
    if (typeof closeSheet === 'function') closeSheet();
    else $('roster-dialog')?.classList?.remove('open');
    for (const dialogId of ['match-help', 'pause-menu', 'replays-dialog', 'export-dialog', 'share-dialog', 'stats-dialog', 'online-dialog']) {
      if ($(dialogId)?.open) $(dialogId).close();
    }
    if (statDrawer.matches(':popover-open')) statDrawer.hidePopover();
    endReplay();
    hideFinger();
    $('field-banner')?.classList.remove('show');
    if (!matchInProgress()) cpuClient.dispose?.();
    lineupMove?.cancel(); lineupMove = null; $('roster-slots').replaceChildren();
  }
  function screenTransition(nextScreen, applyDom, prevScreen) {
    if (!prevScreen || prevScreen === nextScreen) {
      applyDom();
      return;
    }
    window.dispatchEvent(new CustomEvent('ubu:before-screen', { detail: nextScreen }));
    if (nextScreen !== 'play') {
      leavePlayOverlays();
      setShot(nextScreen, { beforeLayout: applyDom });
      void exitOwnedFullscreen();
      castTo(true);
      return;
    }
    setShot(homeShot, { beforeLayout: applyDom });
    if (rinkStage.classList.contains('collection-shrinking')) {
      afterCollectionShrink = () => { if (isHomeShot()) castTo(false); };
    } else {
      castTo(false);
    }
  }
  const screenGuard = async nextScreen => {
    if (nextScreen === 'play') return true;
    if (online?.active && !(await online.leave())) return false;
    return true;
  };
  if (typeof window.setUbuScreenGuard === 'function') window.setUbuScreenGuard(screenGuard);
  else document.addEventListener('DOMContentLoaded', () => window.setUbuScreenGuard?.(screenGuard), { once: true });
  if (typeof window.setUbuScreenTransition === 'function') window.setUbuScreenTransition(screenTransition);
  else document.addEventListener('DOMContentLoaded', () => window.setUbuScreenTransition?.(screenTransition), { once: true });
  document.addEventListener('click', async event => {
    if (typeof window.setUbuScreenGuard === 'function' || !online?.active) return;
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin || url.pathname === '/') return;
    if (url.pathname !== '/mint' && url.pathname !== '/collection') return;
    event.preventDefault();
    event.stopPropagation();
    if (!(await online.leave())) return;
    link.click();
  }, true);
  window.addEventListener('ubu:screen', event => {
    if (event.detail === 'play') {
      if (!isHomeShot() && !isSetupShot() && !isMatchShot()) { setShot(homeShot); castTo(false); }
      updateHome();
      online?.contextChanged?.();
      if (!matchInProgress() && !online?.active && isHomeShot()) startDemo();
    } else if (shot !== event.detail) {
      leavePlayOverlays();
      setShot(event.detail);
      void exitOwnedFullscreen();
      castTo(true);
    }
  });
  function networkMoves() {
    return plans.map((p, i) => ({ angle: p.angle + (online?.state?.seat ? Math.PI : 0), power: p.power,
      spin: p.spin || 0, superArm: Boolean(fieldView.bodies[i].superArm), guard: Boolean(p.guard) }));
  }
  function playOnlineReplay() {
    const replay = onlineReplay;
    if (!replay || !replay.simBodies || !online?.state) return;
    const seat = online.state.seat;
    const syncSim = () => syncViewBodies(replay.simBodies, seat);
    const syncTick = () => (typeof syncTickBodies === 'function' ? syncTickBodies(replay.simBodies, seat) : syncSim());
    const res = stepOnlineTurn({
      replay,
      nowMs: online.now(),
      seat,
      fouls,
      fx: replayFx,
      syncSim,
      syncTick,
      toView: b => toViewBody(b, replay.simBodies, seat),
      onGoalReached: () => {
        goalReplayAt = performance.now() + ububallMatch.GOAL_REPLAY_DELAY;
        const celebSim = structuredClone(replay.simBodies);
        replay.postGoalSim = celebSim;
        postGoal = { ticks: 0, sim: celebSim, seat };
        postGoalState.steps = 0;
        syncViewBodies(celebSim, seat);
        const viewGoal = replay.goal === seat ? 0 : 1;
        const toView = index => index == null ? null : viewIndex(index, seat);
        celebrate(viewGoal, fieldView.bodies[6], replay.label || 'GOAL', replay.label === 'OWN GOAL' ? null : fieldView.bodies[toView(replay.scorer)] || null);
        if (ballOnFire()) lightNet(viewGoal);
        if (toView(replay.assist) !== null) popup(fieldView.bodies[toView(replay.assist)], 'Assist');
        const viewScorerIndex = toView(replay.scorer);
        const scorer = viewScorerIndex !== null ? fieldView.bodies[viewScorerIndex] : fieldView.bodies[viewGoal * 3];
        scoringPlayer = scorer;
        const [home, them] = onlineNames(online.state), scoringTeam = viewGoal === 0 ? home : them;
        const scorerName = scorer?.name || (online.spectating ? `${scoringTeam}'s ubu` : viewGoal === 0 ? 'Your ubu' : `${them}'s ubu`);
        goalTab(viewGoal, replay.label || 'GOAL', replay.label === 'OWN GOAL' ? null : scorerName);
        say(online.spectating ? `${scoringTeam} ${online.state.game.winner !== null ? 'wins' : 'scores'}. ${callText(replay.label || 'GOAL', scorerName)}` : online.state.game.winner !== null
          ? (viewGoal === 0 ? `You win! ${callText(replay.label || 'GOAL', scorerName)}${honourText(0)}` : `${them} wins. ${callText(replay.label || 'GOAL', scorerName)}${honourText(1)}`)
          : `${viewGoal === 0 ? 'You score!' : `${them} scores.`} ${callText(replay.label || 'GOAL', scorerName)} Ready for the next kickoff.`
        );
        loopFanfare(scorer?.voice);
        sync();
      },
      onSettledTurnEnd: () => {
        if (replay.goal === null && !replay.settledSynced) {
          const before = trailPositions();
          syncViewBodies(online.state.game.bodies, seat);
          clearDiscontinuousTrails(before);
          replay.settledSynced = true;
        } else if (replay.goal !== null) {
          replay.settledSynced = true;
        }
        if (!replay.fouled) {
          replay.fouled = true;
          fouls = viewFouls(online.state.game.fouls, seat);
          announceFouls();
          if (replay.goal === null && foulText()) say(foulText());
        }
      }
    });
    if (!replay.fouled) fouls = res.fouls;
    if (replay.goal !== null) {
      const preScores = seat ? [...online.state.game.scores].reverse() : [...online.state.game.scores];
      const viewGoal = replay.goal === seat ? 0 : 1;
      if (replay.currentTick < replay.ticks) preScores[viewGoal]--;
      scores = preScores;
    } else {
      scores = seat ? [...online.state.game.scores].reverse() : [...online.state.game.scores];
    }
  }
  // Each side's Discord display name, mine first; a guest has none.
  function onlineNames(s) {
    if (s.spectator) return s.names.map((name, i) => name || 'Player ' + (i + 1));
    return [s.names[s.seat] || 'Guest', s.occupied[1 - s.seat] ? s.names[1 - s.seat] || 'Guest' : 'Opponent'];
  }
  // The stadium and the full-time summary both offer the rematch; one tap asks, the other accepts.
  function updateRematch(s) {
    if (s.spectator) {
      $('online-rematch').hidden = $('summary-rematch').hidden = true;
      $('summary-rematch-status').textContent = '';
      return;
    }
    const them = onlineNames(s)[1], mine = s.rematch[s.seat], theirs = s.rematch[1 - s.seat];
    for (const button of [$('online-rematch'), $('summary-rematch')]) {
      if (!button) continue;
      button.hidden = s.phase !== 'over' || s.left.some(Boolean); button.disabled = mine;
      button.textContent = mine ? 'Rematch requested' : theirs ? 'Accept rematch' : 'Rematch';
    }
    const note = $('summary-rematch-status');
    if (note) note.textContent = s.phase !== 'over' ? '' : s.left[1 - s.seat] ? `${them} left the match.` :
      mine && !s.connected[1 - s.seat] ? `${them} is offline. They can accept when they return.` : mine ? `Waiting for ${them} to accept.` : theirs ? `${them} wants a rematch.` : '';
  }
  online = ububallOnline({
    async playCpu() { if (await ownTeamReady()) startCpuMatch(roster, 'standard', 'easy'); },
    cpuActive() { return inDiscord && matchInProgress(); },
    resumeCpu() { enterMatch(); $('pause-menu').close(); },
    prepareOnline() {
      if (typeof clearReplayViewer === 'function') clearReplayViewer();
      if (!online?.active && matchInProgress()) finishCpuMatch();
      if (sheetOpen() && setupFor !== 'lobby') {
        if (isSetupShot()) handoffToMatch = true;
        closeSheet();
        lineupMove?.cancel(); lineupMove = null; $('roster-slots').replaceChildren();
      }
      stopDemo();
      cpuClient.cancel(); cpuClient.dispose?.();
      demoClient.dispose?.();
      closeFirstTurnGuide();
      if (typeof closeFoulInfo === 'function') closeFoulInfo();
      $('pause-menu').close(); closeSummary();
    },
    chooseMode(mode) { openSetup('mode', 'online', mode); },
    editRules(mode) { openSetup('mode', 'rules', mode); },
    onNewGame() {
      saveRecording(); onlineRoster = ''; onlineTurn = 0; onlineReplay = null; postGoal = null; onlinePhase = ''; onlinePlanFouls = null;
      closeSummary(); endGoalReplay(); stopFanfare();
    },
    lobby(view, open) { void showLobby(view, open); },
    closeLobby,
    onState(s) {
      if (typeof clearReplayViewer === 'function') clearReplayViewer();
      if (!document.body.classList.contains('online-match')) { stopDemo(); endGoalReplay(); stopFanfare(); }
      document.body.classList.add('online-match');
      if (typeof setupFor !== 'undefined' && setupFor === 'rules' && (!s.canChangeRules || s.phase !== 'plan') && (typeof sheetOpen === 'function' ? sheetOpen() : $('roster-dialog')?.classList?.contains('open'))) { if (typeof closeSheet === 'function') closeSheet(); else $('roster-dialog')?.classList?.remove('open'); }
      if (s.game && s.phase !== 'lobby') enterMatch('match');
      $('online-open-label').textContent = s.spectator ? 'Watching a match' : 'Online match';
      $('online-open-note').hidden = true;
      const [me, them] = onlineNames(s);
      $('home-label').textContent = me; $('opponent-label').textContent = them; $('opponent-heading').textContent = `${them}'s team`;
      $('new-match').disabled = true;
      fieldView.mode = s.mode; document.body.classList.toggle('classic-match', classicMode());
      showMode(s.mode);
      updateRematch(s);
      if (onlinePhase === 'over' && s.phase !== 'over') closeSummary();
      if (!s.game) { phase = 'waiting'; onlineReplay = null; sync(); draw(); return; }
      const rosterKey = JSON.stringify(s.rosters);
      if (rosterKey !== onlineRoster) {
        onlineRoster = rosterKey;
        fieldView.entries = onlineOrder(s.rosters.flat(), s.seat).map((entry, idx) => {
          const model = ubu.decode(ubu.fromCode(entry.dna));
          const mastery = P.superMastery(model.supers, entry.superId);
          const serial = entry.serial || null;
          return {
            key: serial || `online-${idx}`,
            label: serial && typeof ubuList !== 'undefined' && ubuList.serialLabel ? ubuList.serialLabel(serial) : 'Online ubu',
            model,
            dna: entry.dna,
            equippedSuper: { ...P.SUPERS[entry.superId], ...mastery }
          };
        });
        buildTeam();
      }
      if (!s.spectator) recordOnline(s);
      const fresh = onlineTurn !== s.turn || onlineDisconnected || (s.phase === 'plan' && onlinePhase !== 'plan');
      const justFinished = s.phase === 'over' && onlinePhase !== 'over' && s.winner !== null;
      onlinePhase = s.phase;
      onlineDisconnected = false;
      const armed = fieldView.bodies.slice(0, 3).map(b => Boolean(b.superArm));
      if (s.spectator || fresh || !s.connected.every(Boolean) || s.locked[s.seat]) drag = null;
      if (fresh) {
        dirtyPrediction();
        onlineTurn = s.turn; scoringPlayer = null; clearEffects();
        const ball = s.game.bodies[6];
        if (s.phase === 'plan' && ball.x === 500 && ball.y === 300) fieldEffects.kickoffGlow = 1;
      }
      if (s.phase !== 'resolving' || fresh || (onlineReplay && onlineReplay.turn !== s.replay?.turn)) { postGoal = null; endGoalReplay(); stopFanfare(); }
      const before = !fresh && !s.replay && !goalReplay && !postGoal ? trailPositions() : null;
      if (!goalReplay && !postGoal && !(onlineReplay && onlineReplay.postGoalSim)) syncViewBodies(s.game.bodies, s.seat);
      if (before) clearDiscontinuousTrails(before);
      if (!s.replay) fouls = viewFouls(s.game.fouls, s.seat);
      stats = onlineOrder(s.game.stats, s.seat);
      const goalAlreadyShown = Boolean(onlineReplay && onlineReplay.turn === s.replay?.turn && onlineReplay.goalPlayed);
      const rawScores = (s.phase === 'resolving' && s.replay?.goal !== null && !goalAlreadyShown)
        ? s.game.scores.map((sc, gi) => gi === s.replay.goal ? sc - 1 : sc)
        : s.game.scores;
      scores = s.seat ? [...rawScores].reverse() : [...rawScores];
      turn = s.turn;
      if (s.spectator) plans = Array.from({ length: 3 }, idlePlan);
      else if (fresh) plans = s.moves.map(p => ({
        ...p,
        angle: p.power === 0 ? 0 : (((p.angle + (s.seat ? Math.PI : 0)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      }));
      if (!s.spectator) plans.forEach((p, i) => { fieldView.bodies[i].superArm = fresh ? s.moves[i].superArm : armed[i]; });
      if (!s.replay) {
        onlineReplay = null;
      } else if (onlineReplay?.turn !== s.replay.turn) {
        onlineReplay = s.replay;
        onlineReplay.currentTick = 0;
        onlineReplay.simBodies = stripPresentation(structuredClone(s.replay.initialBodies));
        const classic = classicMode();
        const simEntries = Array.isArray(fieldView.entries) && fieldView.entries.length >= 6 ? onlineOrder(fieldView.entries, s.seat) : null;
        onlineReplay.simBodies.forEach((b, i) => {
          if (i < 6) {
            const cached = simEntries?.[i];
            if (cached) {
              const mastery = classic ? null : (cached.equippedSuper?.bonusTicks !== undefined ? cached.equippedSuper : P.superMastery(cached.model?.supers, cached.equippedSuper?.id));
              b.equippedSuper = classic || !cached.equippedSuper ? null : {
                id: cached.equippedSuper.id,
                key: cached.equippedSuper.key || P.SUPERS[cached.equippedSuper.id]?.key,
                bonusTicks: mastery?.bonusTicks || 0,
                bonusRefund: mastery?.bonusRefund || 0
              };
              b.superBonusTicks = mastery?.bonusTicks || 0;
              b.superBonusRefund = mastery?.bonusRefund || 0;
            } else {
              const entry = (i < 3 ? s.rosters[0]?.[i] : s.rosters[1]?.[i - 3]);
              if (entry) {
                const model = ubu.decode(ubu.fromCode(entry.dna));
                const mastery = classic ? null : P.superMastery(model.supers, entry.superId);
                b.equippedSuper = classic ? null : { id: entry.superId, key: P.SUPERS[entry.superId]?.key, bonusTicks: mastery?.bonusTicks || 0, bonusRefund: mastery?.bonusRefund || 0 };
                b.superBonusTicks = mastery?.bonusTicks || 0;
                b.superBonusRefund = mastery?.bonusRefund || 0;
              }
            }
          }
        });
        recordSegment(onlineReplay.simBodies, onlineReplay.plans, s.replay.ticks, s.replay.saves.map(e => saveEvent(e.tick, e)), structuredClone(s.replay.stops));
        if (!s.spectator) recordOnlineTurn(s);
        beginGuide(onlineReplay.simBodies, onlineReplay.plans, s.seat);
        P.startTurn(onlineReplay.simBodies, onlineReplay.plans, replayFx.super);
        syncViewBodies(onlineReplay.simBodies, s.seat);
      }
      if (!s.spectator) finishOnlineRecording(s);
      phase = s.phase === 'over' ? 'over' : s.phase === 'resolving' ? 'play' : !s.spectator && s.connected.every(Boolean) && !s.locked[s.seat] ? 'plan' : 'waiting';
      sync(); if (onlineReplay && !goalReplay && (onlineReplay.currentTick ?? 0) < onlineReplay.ticks) playOnlineReplay(); draw();
      if (justFinished) openSummary();
    },
    onDisconnect(reconnecting) {
      onlineDisconnected = reconnecting; phase = 'waiting'; drag = null;
      sync(); draw();
    },
    onError(message) { say(message); banner(message, 3000); },
    onOutdated() {
      stopDemo();
      phase = 'waiting'; drag = null; postGoal = null;
      endGoalReplay(); stopFanfare(); gameAudio()?.stop?.();
      closeLobby(); closeSummary();
      if (typeof closeFoulInfo === 'function') closeFoulInfo();
      if (typeof sheetOpen === 'function' && sheetOpen() && typeof closeSheet === 'function') closeSheet();
      for (const dlg of document.querySelectorAll('dialog[open]')) {
        if (dlg.dataset.blocking !== 'true') dlg.close();
      }
      for (const pop of document.querySelectorAll('[popover]:popover-open')) {
        try { pop.hidePopover(); } catch {}
      }
      sync(); draw();
      gameUi.blocking({
        title: 'Game updated',
        message: 'Ububall has updated. Refresh the page to continue playing.',
        confirmLabel: 'Refresh'
      });
    },
    onLeave() {
      saveRecording();
      onlineRoster = ''; onlineTurn = 0; onlineReplay = null; postGoal = null; onlinePhase = ''; scoringPlayer = null; onlinePlanFouls = null;
      document.body.classList.remove('online-match');
      $('online-open-label').textContent = 'Play online';
      $('online-open-note').hidden = false;
      $('new-match').disabled = false; $('online-forfeit').hidden = true;
      $('online-rematch').hidden = true; $('launch').hidden = false; closeSummary();
      $('online-change-rules').hidden = true;
      stopDemo();
      phase = 'over'; drag = null;
      endGoalReplay(); stopFanfare(); gameAudio()?.stop();
      if (!roster.length || roster.some(entry => !entry?.model || (!entry.key?.startsWith('guest-') && !ubuList.get(entry.key)?.model))) roster = [...guestTeam];
      draft = [...roster];
      exitMatchMode();
      startDemo();
      // A match may have opened the signup pack on the server.
      void window.ubuStarter.refresh().catch(() => {});
      void adoptAccountTeam().catch(() => {});
    }
  });
  $('online-rematch').onclick = () => online.rematch();
  if (!inDiscord) {
    restoredMatch = restoreActiveMatch();
    if (!restoredMatch) newMatch();
    if (isMatchShot()) fitOrientation();
  } else if (history.state?.match) {
    // Discord opens the friends queue. Online matches and watch links resume through their URLs.
    const { match, ...homeState } = history.state;
    history.replaceState(homeState, '');
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushScheduledSave();
    updateLocalPlanClock(localPlayBlocked());
    lastTime = 0; accumulator = 0;
  });
  const ro = new ResizeObserver(entries => {
    gameUi.updateScale?.();
    for (const entry of entries) {
      if (entry.target === fieldView.canvas) {
        const box = entry.devicePixelContentBoxSize?.[0];
        deviceWidth = box ? box.inlineSize : 0;
        deviceHeight = box ? box.blockSize : 0;
      }
    }
    layoutDirty = true;
    draw();
  });
  try { ro.observe(fieldView.canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(fieldView.canvas); }
  if (stadium) ro.observe(stadium);
  if (stageArea) ro.observe(stageArea);
  if ($('collection-world')) ro.observe($('collection-world'));
  ro.observe($('field-spin')); // Its size places it; it has none until first shown.
  const resizeField = () => { gameUi.updateScale?.(); fitSetupShot(); layoutDirty = true; draw(); };
  const scrollCollectionField = () => {
    if (shot !== 'collection' || collectionRotateHold || bench?.flags.noCollectionScrollDraw) return;
    layoutDirty = true;
    draw();
  };
  window.addEventListener('resize', resizeField);
  window.addEventListener('scroll', scrollCollectionField, { passive: true });
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
  window.addEventListener('ubu:screen', openRosterFromLink);
  // Default to the phone’s top edge in landscape until the player chooses a side.
  let sidebarSide;
  try { sidebarSide = localStorage.getItem('ububall.controls-side'); } catch {}
  const sidebarSetting = $('setting-sidebar');
  function updateTopSide() {
    const angle = screen.orientation?.angle ?? window.orientation;
    const topSide = angle === 270 || angle === -90 ? 'right' : 'left';
    const side = sidebarSide === 'left' || sidebarSide === 'right' ? sidebarSide : topSide;
    stadium.dataset.controlsSide = side;
    layoutDirty = true;
    sidebarSetting.querySelector('.setting-value').textContent = side === 'left' ? 'Left' : 'Right';
  }
  sidebarSetting.onclick = () => {
    sidebarSide = stadium.dataset.controlsSide === 'left' ? 'right' : 'left';
    try { localStorage.setItem('ububall.controls-side', sidebarSide); } catch {}
    updateTopSide();
  };
  updateTopSide(); screen.orientation?.addEventListener('change', updateTopSide);
  // Home screen demo: Saffron (the home team) against Amethyst, one hard CPU and one medium, chosen
  // at random each game. Saffron's planning is acted out with a pointer, as a how-to for new players.
  function demoPaused() { return !isHomeShot() || location.pathname !== '/' || document.hidden || Boolean(foulInfo) || Boolean(document.querySelector('dialog[open]')); }
  // Waits count only while the demo is on screen; a stopped demo ends its walkthrough.
  async function demoWait(run, ms, until = null) {
    let left = ms;
    while (until ? !until() : left > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
      if (run !== demoRun) throw DEMO_STOP;
      if (!demoPaused()) left -= 100;
    }
  }
  function newDemoGame(team = roster) {
    demoLevels = Math.random() < .5 ? ['hard', 'medium'] : ['medium', 'hard'];
    demoGame++; hideFinger(); newMatch(false, team);
    $('home-label').textContent = 'Saffron'; $('opponent-label').textContent = 'Amethyst';
    showMode(fieldView.mode);
  }
  function startDemo() {
    if (demo || !isHomeShot() || matchInProgress() || online?.active) return;
    demo = true; document.body.classList.add('demo-match'); setPortrait(false);
    newDemoGame(); updateHome();
    void demoLoop(++demoRun);
  }
  function stopDemo() {
    if (!demo) return;
    demo = false; demoRun++; demoClient.cancel(); demoClient.dispose?.(); hideFinger();
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
    const planning = demoClient.plan({ version: ububallMatch.VERSION, mode: fieldView.mode, bodies: simBodies, stats, scores, turn, fouls, clock: matchTicks, roundTurns, play: ububallMatch.newPlay(play) },
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
  function placeFinger(x, y, rects = null) {
    const finger = $('demo-finger');
    const stage = rects?.stage || finger.parentElement.getBoundingClientRect();
    const p = rects?.canvas ? boxPoint(rects.canvas, { x, y }) : screenPoint({ x, y });
    finger.style.left = p.x - stage.left + 'px'; finger.style.top = p.y - stage.top + 'px';
  }
  function hideFinger() { $('demo-finger').toggleAttribute('hidden', true); $('demo-finger').classList.remove('pressed'); }
  async function demoAim(run, i, target, current) {
    const b = fieldView.bodies[i];
    selected = i; sync(); draw();
    if (b.stunned || target.guard || !(target.power > 0)) { plans[i] = { ...target }; sync(); draw(); await demoWait(run, 500); return; }
    plans[i] = { ...target, power: 0 };
    placeFinger(b.x, b.y); $('demo-finger').toggleAttribute('hidden', false);
    await demoWait(run, 350);
    if (!current()) { hideFinger(); return; }
    $('demo-finger').classList.add('pressed');
    await demoWait(run, 200);
    const began = performance.now(), ms = 900;
    const useRaf = typeof requestAnimationFrame === 'function';
    const nextTick = useRaf ? requestAnimationFrame : fn => setTimeout(fn, 16);
    const fingerEl = $('demo-finger');
    let rects = !layoutDirty && fingerEl?.parentElement
      ? { stage: fingerEl.parentElement.getBoundingClientRect(), canvas: fieldView.canvas.getBoundingClientRect() }
      : null;
    await new Promise(resolve => {
      const step = () => {
        const now = performance.now();
        if (run !== demoRun || !current()) { resolve(); return; }
        if (layoutDirty || !rects) {
          rects = fingerEl?.parentElement
            ? { stage: fingerEl.parentElement.getBoundingClientRect(), canvas: fieldView.canvas.getBoundingClientRect() }
            : null;
        }
        const k = Math.min(1, (now - began) / ms), eased = 1 - (1 - k) ** 3;
        plans[i] = { ...target, power: target.power * eased };
        const arrow = impulseGeometry(b, plans[i]);
        placeFinger(arrow.x, arrow.y, rects);
        if (useRaf) dragDirty = true; else { sync(); draw(); }
        if (k < 1) nextTick(step); else resolve();
      };
      nextTick(step);
    });
    if (run !== demoRun) throw DEMO_STOP;
    if (!current()) { hideFinger(); return; }
    plans[i] = { ...target }; sync(); draw();
    await demoWait(run, 300);
    hideFinger();
    await demoWait(run, 300);
  }
  // Standalone reloads can resume a CPU match on Play. Discord starts at the Activity bench.
  if (!inDiscord && location.pathname === '/' && (restoredMatch || history.state?.match) && matchInProgress()) enterMatch();
  else if (location.pathname === '/') startDemo();
  openRosterFromLink();
  if (bench) {
    let collectionSeeded = false;
    bench.control = {
      getState: () => ({
        shot,
        phase,
        canvasW: fieldView.canvas.width,
        canvasH: fieldView.canvas.height,
        cssW: fieldView.canvas.clientWidth,
        cssH: fieldView.canvas.clientHeight
      }),
      markDirty: () => { layoutDirty = true; dirtyPrediction(); draw(); },
      prepareRoster() {
        stopDemo();
        cpuClient.cancel(); cpuClient.dispose?.();
        demoClient.cancel(); demoClient.dispose?.();
        let seed = 1337;
        const randByte = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 24) & 0xff; };
        const entries = [];
        for (let i = 0; i < 6; i++) {
          let model, dnaBytes;
          for (let tries = 0; tries < 400; tries++) {
            dnaBytes = Uint8Array.from({ length: 128 }, randByte);
            model = ubu.decode(dnaBytes);
            if (Object.values(model.attributes || {}).some(a => a && a.material && a.material !== 'matte')) break;
          }
          const dna = ubu.toCode(dnaBytes);
          const superId = [4, 5, 6, 2, 1, 7][i];
          const mastery = P.superMastery(model.supers, superId);
          entries.push({
            key: 'bench-' + i,
            dna,
            label: model.parts.fullName,
            model,
            equippedSuper: { ...P.SUPERS[superId], ...mastery }
          });
        }
        roster = entries.slice(0, 3);
        draft = [...roster];
        cpuTeam = entries.slice(3, 6);
        fieldView.entries = [...entries];
        fieldView.mode = 'standard';
        stats = entries.map(e => ({ ...e.model.stats }));
        buildTeam();
      },
      async enterMatchBench() {
        if (location.pathname !== '/' && typeof window.navigateUbuScreen === 'function') {
          await window.navigateUbuScreen('/');
        }
        stopDemo();
        cancelActiveCamera();
        shot = 'match';
        if (document.body?.dataset) document.body.dataset.shot = 'match';
        fieldView.castHidden = false;
        rinkWrap.classList.remove('cast-away');
        fitOrientation();
        layoutDirty = true;
      },
      async startScenario(kind) {
        if (kind === 'collectionCold' || kind === 'collectionWarm') {
          if (typeof window.loadMintScripts === 'function') await window.loadMintScripts();
          if (kind === 'collectionCold' || !collectionSeeded) {
            let seed = 2026;
            const randByte = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 24) & 0xff; };
            for (let i = 0; i < 60; i++) {
              const dnaBytes = Uint8Array.from({ length: 128 }, randByte);
              const dna = ubu.toCode(dnaBytes);
              const model = ubu.decode(dnaBytes);
              const serial = String(900000 + i + 1).padStart(12, '0');
              ubuList.add({
                serial,
                certificate: 'bench-' + serial,
                result: { dna, certificate: { serial, issuedAt: '2026-11-12T00:00:00Z' } },
                model,
                rarity: rarity.scoreRarity(model),
                issuedAt: '2026-11-12T00:00:00Z',
                favorite: i < 4
              });
            }
            collectionSeeded = true;
          }
          if (typeof window.navigateUbuScreen === 'function') await window.navigateUbuScreen('/collection');
          cancelActiveCamera();
          if (kind === 'collectionCold') {
            window.scrollTo(0, 0);
            return f => { if (f % 10 === 0) { window.scrollTo(0, (f * 18) % 900); window.dispatchEvent(new Event('scroll')); } };
          }
          return f => { window.scrollTo(0, (f * 42) % 1400); window.dispatchEvent(new Event('scroll')); };
        }

        await this.enterMatchBench();
        endGoalReplay(); postGoal = null; clearEffects(); recording = null;

        if (kind === 'calm') {
          simBodies = P.kickoff();
          simBodies.slice(0, 6).forEach((b, i) => {
            ububallMatch.applyStats(P, b, stats[i], 'standard');
            b.meter = 40;
            b.equippedSuper = fieldView.entries[i].equippedSuper;
          });
          const turnPlans = [
            { angle: 0.15, power: 0.55, spin: 0, guard: false, superArm: false },
            { angle: -0.2, power: 0.5, spin: 0, guard: false, superArm: false },
            { angle: 0, power: 0.45, spin: 0, guard: false, superArm: false },
            { angle: Math.PI - 0.15, power: 0.55, spin: 0, guard: false, superArm: false },
            { angle: Math.PI + 0.2, power: 0.5, spin: 0, guard: false, superArm: false },
            { angle: Math.PI, power: 0.45, spin: 0, guard: false, superArm: false }
          ];
          play = ububallMatch.newPlay(); tally = ububallMatch.newTally(); fouls = ububallMatch.newFouls();
          P.startTurn(simBodies, turnPlans, liveFx.super);
          syncViewBodies(simBodies, 0);
          elapsed = accumulator = 0; phase = 'play';
          sync(); draw();
          return () => { if (phase !== 'play') { phase = 'play'; elapsed = 0.1; } };
        }

        if (kind === 'chaos' || kind === 'celebration') {
          simBodies = P.kickoff();
          const coords = [[310, 250], [340, 350], [260, 300], [690, 250], [660, 350], [740, 300]];
          simBodies.slice(0, 6).forEach((b, i) => {
            b.x = coords[i][0]; b.y = coords[i][1];
            ububallMatch.applyStats(P, b, stats[i], 'standard');
            b.meter = 100;
            b.equippedSuper = fieldView.entries[i].equippedSuper;
          });
          const turnPlans = [
            { angle: 0.12, power: 1.0, spin: 0.95, guard: false, superArm: true },
            { angle: -0.18, power: 1.0, spin: -0.9, guard: false, superArm: true },
            { angle: 0.02, power: 1.0, spin: 0.85, guard: false, superArm: false },
            { angle: Math.PI - 0.12, power: 1.0, spin: -0.95, guard: false, superArm: true },
            { angle: Math.PI + 0.18, power: 1.0, spin: 0.9, guard: false, superArm: false },
            { angle: Math.PI - 0.02, power: 1.0, spin: -0.85, guard: true, superArm: false }
          ];
          play = ububallMatch.newPlay(); tally = ububallMatch.newTally(); fouls = ububallMatch.newFouls();
          P.startTurn(simBodies, turnPlans, liveFx.super);
          const ball = simBodies[6];
          ball.onFire = true; ball.fireTicks = 600; ball.pace = 3; ball.strikerTeam = 0;
          ball.vx = 680; ball.vy = 190; ball.omega = 20;
          syncViewBodies(simBodies, 0);
          for (let k = 0; k < 16; k++) {
            for (let s = 0; s < 2; s++) ububallMatch.playTick(P, simBodies, play, liveFx, tally);
            syncViewBodies(simBodies, 0);
            presenter.recordTrails();
            presenter.emitSkaterEffects(1 / 60);
            presenter.sparkBall(fieldView.bodies[6], 1 / 60);
            presenter.burnIce(fieldView.bodies[6]);
            presenter.updateEffects(1 / 60);
          }
          simBodies[6].onFire = true; simBodies[6].fireTicks = 720; simBodies[6].pace = 3;
          fieldEffects.fireWarp = { x: fieldView.bodies[6].x, y: fieldView.bodies[6].y, nx: 1, ny: 0, life: 2.5, duration: 2.5, ubuIndex: 0 };
          elapsed = 0.2; accumulator = 0; phase = 'play';
          if (kind === 'celebration') {
            playSegments = [{ bodies: structuredClone(simBodies), plans: turnPlans, ticks: 200, saves: [], stops: [] }];
            scoringPlayer = fieldView.bodies[0];
            presenter.celebrate(0, fieldView.bodies[6], 'BLAZING GOAL!', fieldView.bodies[0]);
            presenter.lightNet(0);
            startGoalReplay();
            return null;
          }
          sync(); draw();
          return () => {
            if (phase !== 'play') { phase = 'play'; elapsed = 0.2; }
            simBodies[6].onFire = true; simBodies[6].fireTicks = 600; simBodies[6].pace = 3;
            if (Math.hypot(simBodies[6].vx, simBodies[6].vy) < 350) { simBodies[6].vx = 620; simBodies[6].vy = -210; }
          };
        }

        if (kind === 'aimDrag' || kind === 'spinSlider') {
          simBodies = P.kickoff();
          simBodies.slice(0, 6).forEach((b, i) => {
            ububallMatch.applyStats(P, b, stats[i], 'standard');
            b.meter = 100; b.superArm = i < 2;
            b.equippedSuper = fieldView.entries[i].equippedSuper;
          });
          syncViewBodies(simBodies, 0);
          fouls = ububallMatch.newFouls();
          fouls.crease = [true, false];
          fouls.corner = 0; fouls.cornerTurns = ububallMatch.FOULS.stallTurns;
          phase = 'plan'; selected = 0;
          plans = [
            { angle: 0.1, power: 0.95, spin: 0.8, guard: false, superArm: true },
            { angle: -0.25, power: 0.9, spin: -0.7, guard: false, superArm: true },
            { angle: 0.05, power: 0.85, spin: 0.4, guard: false, superArm: false }
          ];
          recording = ububallReplay.create({
            mode: 'standard', names: ['You', 'CPU'],
            ubus: fieldView.entries.map(e => ({ dna: e.dna, super: e.equippedSuper.id }))
          });
          for (let t = 1; t <= 30; t++) {
            const entry = ububallReplay.addTurn(recording, { turn: t, scores: [2, 2], fouls, bodies: simBodies, plans: [...plans, ...plans] });
            entry.ticks = 360; entry.cards = []; entry.saves = []; entry.stops = [];
          }
          turn = 30;
          sync(); draw();
          if (kind === 'spinSlider') {
            const spinInput = $('shot-spin');
            return f => { spinInput.value = String(Math.round(Math.sin(f * 0.14) * 90)); spinInput.oninput(); };
          }
          return f => {
            plans[0].angle = 0.08 + Math.sin(f * 0.11) * 0.35;
            plans[0].power = 0.85 + Math.cos(f * 0.07) * 0.14;
            dragDirty = true;
          };
        }
        return null;
      },
      async finishSuite() {
        recording = null;
        clearActiveMatch();
        if (location.pathname !== '/' && typeof window.navigateUbuScreen === 'function') {
          await window.navigateUbuScreen('/');
          window.scrollTo(0, 0);
        }
        await this.enterMatchBench();
        newMatch(false);
      }
    };
    if (typeof document !== 'undefined' && document.head) {
      const s = document.createElement('script');
      s.src = 'ububall-bench.js';
      s.defer = true;
      document.head.append(s);
    }
  }
})();
