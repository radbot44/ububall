'use strict';
(() => {
  const $ = id => document.getElementById(id), P = ububallPhysics;
  const inDiscord = Boolean(window.ubuActivity);
  const liveField = {};
  let fieldView = liveField;
  fieldView.canvas = $('rink');
  fieldView.ctx = null;
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
  let elapsed = 0, accumulator = 0, lastTime = 0, drag = null, dragMode = null, dragDirty = false, drawingDragFrame = false, skaters = [];
  fieldView.portrait = false;
  fieldView.mode = 'standard';
  let planDeadline = 0, planPausedAt = null;
  // Each turn of the current play (motion since the field last rested), for goal replays.
  let playSegments = [], goalReplay = null, goalReplayAt = 0, goalReplayDelayMs = 0, postGoal = null, authoritativeBodies = null;
  fieldView.anonymous = false;
  // The replay viewer (see watchReplay), and the match being recorded for the replay library.
  let theater = null, recording = null, recordingOnline = false, restoredMatch = false;
  let cast = null, shot = location.pathname === '/mint' ? 'mint' : location.pathname === '/collection' ? 'collection' : (inDiscord ? 'lobby' : 'home'), returnShot = inDiscord ? 'lobby' : 'home', returnPortrait = false, handoffToMatch = false;
  if (document.body?.dataset) document.body.dataset.shot = shot;
  // While a video export renders, effects and sounds run on its clock (ms) instead of the wall clock,
  // sounds go to its offline audio, and the field draws at its size.
  let videoClock = null, videoAudio = null, cardShot = false;
  fieldView.field = null;
  const clockNow = () => videoClock ?? activePlayback?.clock ?? performance.now();
  let matchTicks = 0; // Simulated ticks played locally, for meter cooldowns.
  let online = null, onlineRoster = '', onlineTurn = 0, onlineReplay = null, onlineDisconnected = false, onlinePhase = '';
  const cpuClient = createCPUClient();
  const VALID_CPU_LEVELS = typeof ububallCPU === 'object' && ububallCPU?.LEVELS ? Object.keys(ububallCPU.LEVELS) : ['easy', 'medium', 'hard', 'insane', 'god', 'ballistic'];
  let cpuGeneration = 0, cpuReady = Promise.resolve(), cpuDone = false, cpuLevel = 'medium', cpuMode = 'standard', cpuMatchSeed = (Math.random() * 0x100000000) >>> 0;
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
  const bench = typeof window !== 'undefined' && (window.__ubuBench || /[?&]bench(?:=|&|$)/i.test(location.search || ''))
    ? (window.__ubuBench ||= { flags: {}, rec: null }) : null;
  const gameAudio = () => bench?.flags.noAudio ? null : (videoAudio || activePlayback?.audio || (demo ? null : window.ubuAudio));
  const classicMode = () => ububallMatch.rule(fieldView.mode, 'classic');
  const blitzMode = () => ububallMatch.rule(fieldView.mode, 'blitz');
  const pulseMode = () => ububallMatch.rule(fieldView.mode, 'pulse');
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
  let arrowGrab = null, dragStart = null, dragStartClient = null, dragClient = null, dragPointerType = '', dragMoved = false, dragMaxTravel = 0, dragLiftPx = 0, spinDrag = null;
  let pullBehind = false;
  try { pullBehind = localStorage.getItem('ububall-aim-style') === 'pull'; } catch {}
  const firstTurnKey = 'ububall-first-turn-guide';
  let firstTurnSeen = false;
  let superHintSeen = false, superHintFor = null;
  try { superHintSeen = localStorage.getItem('ububall-super-hint') === 'seen'; } catch {}
  let firstTurnStep = null, firstTurnStarted = null;
  try { firstTurnSeen = localStorage.getItem(firstTurnKey) === 'seen'; } catch {}
  // The floating spin slider: off by default (can be enabled in settings).
  let spinSlider = false;
  try { spinSlider = localStorage.getItem('ububall-spin-slider') === 'on'; } catch {}
  // Touch aiming aid on phone screens (Drag arrow scheme): 'offset' (Above finger, default), 'magnifier', or 'off'.
  const TOUCH_AIM_MODES = ['offset', 'magnifier', 'off'];
  const TOUCH_AIM_LABELS = { offset: 'Above finger', magnifier: 'Magnifier', off: 'Off' };
  let touchAim = 'offset';
  try {
    const savedTouchAim = localStorage.getItem('ububall-touch-aim');
    if (TOUCH_AIM_MODES.includes(savedTouchAim)) touchAim = savedTouchAim;
    else if (localStorage.getItem('ububall-aim-magnifier') === 'on') touchAim = 'magnifier';
  } catch {}
  // Pause menu settings: each button shows its options in a segmented pill; clicking a segment picks it and clicking the row cycles it.
  function setSettingPill(el, value) {
    if (!el) return;
    const segs = el.querySelectorAll('.setting-seg');
    if (segs.length) {
      for (const seg of segs) seg.classList.toggle('active', seg.dataset.value === value);
      return;
    }
    const badge = el.querySelector('.setting-value');
    if (badge) badge.textContent = value;
  }
  function clickedSettingValue(e) {
    return e?.target?.closest?.('.setting-seg')?.dataset.value || null;
  }
  function showSetting(id, on) {
    const el = $(id);
    if (!el) return;
    el.setAttribute('aria-pressed', String(Boolean(on)));
    setSettingPill(el, on ? 'on' : 'off');
  }
  setSettingPill($('setting-aim'), pullBehind ? 'pull' : 'drag');
  $('setting-aim').onclick = e => {
    const picked = clickedSettingValue(e);
    pullBehind = picked ? picked === 'pull' : !pullBehind;
    try { localStorage.setItem('ububall-aim-style', pullBehind ? 'pull' : 'drag'); } catch {}
    setSettingPill($('setting-aim'), pullBehind ? 'pull' : 'drag');
    updateFirstTurnGuide();
    updateAimLoupe();
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
  if (shot !== 'home' && shot !== 'lobby') { fieldView.castHidden = true; rinkWrap.classList.add('cast-away'); }
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
    transformSimSeat, viewFouls: projectFouls, createMatchSession, resolveEquippedSuper: calcEquippedSuper,
    formatDrawerSuperStatus, restoreEntry: decodeSavedEntry, createBodyProjector, createPlaybackDriver,
    createMeterController, createPlanClockController, createFrameLoop, createSummaryController,
    createCpuTurnPlanner, createBannerController, bindMatchShortcuts, bindSpinSlider, createDemoFingerController,
    createGoalReplayController, createMatchLifecycleController, createOnlineMatchController,
    createStageController
  } = ububallPlayback;
  const {
    matchMvp, replayFileName, createStatsController
  } = ububallStats;
  const {
    anonymousName: formatAnonymousName, createReplayTheater
  } = ububallTheater;
  const anonymousName = i => formatAnonymousName(ububallReplay, i);
  const viewFouls = (f, seat) => projectFouls(ububallMatch, f, seat);
  const resolveEquippedSuper = (entry, slotIndex = 0) => calcEquippedSuper(P, entry, slotIndex);
  const restoreEntry = saved => decodeSavedEntry(P, ubu, saved, resolveEquippedSuper);
  let activePlayback = null, lastSaved = Promise.resolve(null), lastCompletedReplay = null, onlinePlanFouls = null, guide = null;
  let cameraMove = null, cameraDone = Promise.resolve(), resolveCameraDone = null, cameraStepRaf = 0, pendingExitCollection = null, afterCollectionShrink = null;
  let collectionShownLength = 1000, collectionTargetLength = 1000, collectionLengthRaf = 0, collectionRotateHold = false, collectionLengthOverride = null, collectionShrinkingBox = null, collectionLayout = null, collectionScrollRaf = 0;
  let foulInfo = null, foulInfoKey = '', foulBox = null, fieldBox = null, tapGuards = false;
  let setupFor = 'cpu', changedSlot = -1, lobbyView = null, savedTeams = null, teamIndex = -1, lineupMove = null, lobbyGeneration = 0, rulesGameNumber = 0, fullscreenRequest = null, videoCancelled = false;
  const quickPlayKey = 'ububall-last-cpu-setup';
  let lastCpuSetup = null;
  try {
    const saved = JSON.parse(localStorage.getItem(quickPlayKey));
    if (saved && VALID_CPU_LEVELS.includes(saved.level) && ububallMatch.MODES.includes(saved.mode) &&
        Array.isArray(saved.team) && saved.team.length === 3 &&
        saved.team.every(entry => entry && typeof entry.key === 'string')) lastCpuSetup = saved;
  } catch {}
  const state = createMatchSession({
    $, P, ubu, ububallMatch, ububallReplay, gameUi, bench, VALID_CPU_LEVELS,
    guestTeam, demoClient, starterEntries, idlePlan, normalStats, classicMode,
    setMeterFill, goalTab, callText, resolveEquippedSuper, restoreEntry, viewFouls, anonymousName,
    get ububallCPU() { return typeof ububallCPU !== 'undefined' ? ububallCPU : null; },
    get document() { return typeof document !== 'undefined' ? document : null; },
    get window() { return typeof window !== 'undefined' ? window : null; },
    get performance() { return typeof performance !== 'undefined' ? performance : null; },
    get localStorage() { return typeof localStorage !== 'undefined' ? localStorage : null; },
    get requestAnimationFrame() { return typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null; },
    get setTimeout() { return typeof setTimeout === 'function' ? setTimeout : null; },
    get clearTimeout() { return typeof clearTimeout === 'function' ? clearTimeout : null; },
    get presenter() { return typeof presenter !== 'undefined' ? presenter : null; },
    get reducedMotion() { return typeof reducedMotion !== 'undefined' ? reducedMotion : null; },
    get replaySkip() { return typeof replaySkip !== 'undefined' ? replaySkip : null; },
    get replayStore() { return typeof replayStore !== 'undefined' ? replayStore : null; },
    get guides() { return typeof guides !== 'undefined' ? guides : null; },
    get ubuList() { return typeof ubuList !== 'undefined' ? ubuList : null; },
    get postGoalState() { return typeof postGoalState !== 'undefined' ? postGoalState : null; },
    get fieldBox() { return typeof fieldBox !== 'undefined' ? fieldBox : null; }, set fieldBox(v) { fieldBox = v; },
    get setupFor() { return typeof setupFor !== 'undefined' ? setupFor : 'cpu'; }, set setupFor(v) { setupFor = v; },
    get lineupMove() { return typeof lineupMove !== 'undefined' ? lineupMove : null; }, set lineupMove(v) { lineupMove = v; },
    get onlineRoster() { return onlineRoster; }, set onlineRoster(v) { onlineRoster = v; },
    get onlineTurn() { return onlineTurn; }, set onlineTurn(v) { onlineTurn = v; },
    get onlineDisconnected() { return onlineDisconnected; }, set onlineDisconnected(v) { onlineDisconnected = v; },
    get onlinePhase() { return onlinePhase; }, set onlinePhase(v) { onlinePhase = v; },
    get onlinePlanFouls() { return typeof onlinePlanFouls !== 'undefined' ? onlinePlanFouls : null; }, set onlinePlanFouls(v) { onlinePlanFouls = v; },
    get fieldView() { return fieldView; }, set fieldView(v) { fieldView = v; },
    get fieldEffects() { return typeof fieldEffects !== 'undefined' ? fieldEffects : null; }, set fieldEffects(v) { fieldEffects = v; },
    dirtyMeters,
    get layoutDirty() { return layoutDirty; }, set layoutDirty(v) { layoutDirty = v; },
    get renderWidth() { return renderWidth; }, set renderWidth(v) { renderWidth = v; },
    get renderHeight() { return renderHeight; }, set renderHeight(v) { renderHeight = v; },
    get deviceWidth() { return deviceWidth; }, set deviceWidth(v) { deviceWidth = v; },
    get deviceHeight() { return deviceHeight; }, set deviceHeight(v) { deviceHeight = v; },
    get visibleRinkHeight() { return typeof visibleRinkHeight !== 'undefined' ? visibleRinkHeight : 600; }, set visibleRinkHeight(v) { visibleRinkHeight = v; },
    get roster() { return roster; }, set roster(v) { roster = v; },
    get draft() { return draft; }, set draft(v) { draft = v; },
    get cpuTeam() { return cpuTeam; }, set cpuTeam(v) { cpuTeam = v; },
    get simBodies() { return simBodies; }, set simBodies(v) { simBodies = v; },
    get plans() { return plans; }, set plans(v) { plans = v; },
    get cpu() { return cpu; }, set cpu(v) { cpu = v; },
    get selected() { return selected; }, set selected(v) { selected = v; },
    get scores() { return scores; }, set scores(v) { scores = v; },
    shownScores,
    get turn() { return turn; }, set turn(v) { turn = v; },
    get phase() { return phase; }, set phase(v) { phase = v; },
    get elapsed() { return elapsed; }, set elapsed(v) { elapsed = v; },
    get accumulator() { return accumulator; }, set accumulator(v) { accumulator = v; },
    get lastTime() { return lastTime; }, set lastTime(v) { lastTime = v; },
    get drag() { return drag; }, set drag(v) { drag = v; },
    get dragDirty() { return dragDirty; }, set dragDirty(v) { dragDirty = v; },
    get drawingDragFrame() { return drawingDragFrame; }, set drawingDragFrame(v) { drawingDragFrame = v; },
    get skaters() { return skaters; }, set skaters(v) { skaters = v; },
    rinkWrap,
    get playSegments() { return playSegments; }, set playSegments(v) { playSegments = v; },
    get goalReplay() { return goalReplay; }, set goalReplay(v) { goalReplay = v; },
    get goalReplayAt() { return goalReplayAt; }, set goalReplayAt(v) { goalReplayAt = v; },
    get goalReplayDelayMs() { return goalReplayDelayMs; }, set goalReplayDelayMs(v) { goalReplayDelayMs = v; },
    get postGoal() { return postGoal; }, set postGoal(v) { postGoal = v; },
    get authoritativeBodies() { return authoritativeBodies; }, set authoritativeBodies(v) { authoritativeBodies = v; },
    get theater() { return theater; }, set theater(v) { theater = v; },
    get activePlayback() { return typeof activePlayback !== 'undefined' ? activePlayback : null; }, set activePlayback(v) { activePlayback = v; },
    get recording() { return recording; }, set recording(v) { recording = v; },
    get recordingOnline() { return recordingOnline; }, set recordingOnline(v) { recordingOnline = v; },
    get lastSaved() { return typeof lastSaved !== 'undefined' ? lastSaved : null; }, set lastSaved(v) { lastSaved = v; },
    get lastCompletedReplay() { return typeof lastCompletedReplay !== 'undefined' ? lastCompletedReplay : null; }, set lastCompletedReplay(v) { lastCompletedReplay = v; },
    get cast() { return cast; }, set cast(v) { cast = v; },
    get shot() { return shot; }, set shot(v) { shot = v; },
    get videoClock() { return videoClock; }, set videoClock(v) { videoClock = v; },
    get videoAudio() { return videoAudio; }, set videoAudio(v) { videoAudio = v; },
    get cardShot() { return cardShot; }, set cardShot(v) { cardShot = v; },
    get matchTicks() { return matchTicks; }, set matchTicks(v) { matchTicks = v; },
    get online() { return online; }, set online(v) { online = v; },
    get onlineReplay() { return onlineReplay; }, set onlineReplay(v) { onlineReplay = v; },
    cpuClient,
    inDiscord,
    get cpuGeneration() { return cpuGeneration; }, set cpuGeneration(v) { cpuGeneration = v; },
    get cpuLevel() { return cpuLevel; }, set cpuLevel(v) { cpuLevel = v; },
    get cpuMode() { return cpuMode; }, set cpuMode(v) { cpuMode = v; },
    get cpuDone() { return cpuDone; }, set cpuDone(v) { cpuDone = v; },
    get cpuReady() { return cpuReady; }, set cpuReady(v) { cpuReady = v; },
    get cpuMatchSeed() { return cpuMatchSeed; }, set cpuMatchSeed(v) { cpuMatchSeed = v; },
    get demo() { return demo; }, set demo(v) { demo = v; },
    get demoLevels() { return demoLevels; }, set demoLevels(v) { demoLevels = v; },
    get demoRun() { return demoRun; }, set demoRun(v) { demoRun = v; },
    get demoGame() { return demoGame; }, set demoGame(v) { demoGame = v; },
    DEMO_STOP,
    get planDeadline() { return planDeadline; }, set planDeadline(v) { planDeadline = v; },
    get planPausedAt() { return planPausedAt; }, set planPausedAt(v) { planPausedAt = v; },
    get firstTurnStep() { return firstTurnStep; }, set firstTurnStep(v) { firstTurnStep = v; },
    get firstTurnStarted() { return firstTurnStarted; }, set firstTurnStarted(v) { firstTurnStarted = v; },
    get spinSlider() { return spinSlider; }, set spinSlider(v) { spinSlider = v; },
    get touchAim() { return touchAim; }, set touchAim(v) { touchAim = v; },
    get pullBehind() { return pullBehind; }, set pullBehind(v) { pullBehind = v; },
    get stats() { return stats; }, set stats(v) { stats = v; },
    get play() { return play; }, set play(v) { play = v; },
    get tally() { return tally; }, set tally(v) { tally = v; },
    get scoringPlayer() { return scoringPlayer; }, set scoringPlayer(v) { scoringPlayer = v; },
    get roundTurns() { return roundTurns; }, set roundTurns(v) { roundTurns = v; },
    get fouls() { return fouls; }, set fouls(v) { fouls = v; },
    get hitStopUntil() { return typeof hitStopUntil !== 'undefined' ? hitStopUntil : 0; }, set hitStopUntil(v) { hitStopUntil = v; },
    get foulInfo() { return typeof foulInfo !== 'undefined' ? foulInfo : null; }, set foulInfo(v) { foulInfo = v; },
    get guide() { return typeof guide !== 'undefined' ? guide : null; }, set guide(v) { guide = v; },
    get cameraMove() { return typeof cameraMove !== 'undefined' ? cameraMove : null; }, set cameraMove(v) { cameraMove = v; },
    viewTally: (...a) => viewTally(...a),
    matchMvp: (...a) => matchMvp(...a),
    updateRematch: (...a) => updateRematch(...a),
    saveActiveMatch: (...a) => saveActiveMatch(...a),
    localPlayBlocked: (...a) => localPlayBlocked(...a),
    updateLocalPlanClock: (...a) => updateLocalPlanClock(...a),
    updateClock: (...a) => updateClock(...a),
    networkMoves: (...a) => networkMoves(...a),
    startGoalReplay: (...a) => startGoalReplay(...a),
    banner: (...a) => banner(...a),
    updateReplaySkip: (...a) => updateReplaySkip(...a),
    isHomeShot: (...a) => isHomeShot(...a),
    blitzMode: (...a) => blitzMode(...a),
    pulseMode: (...a) => pulseMode(...a),
    isExporting: (...a) => isExporting(...a),
    clockNow: (...a) => clockNow(...a),
    updatePopups: (...a) => updatePopups(...a),
    updateEffects: (...a) => updateEffects(...a),
    advanceReplay: (...a) => advanceReplay(...a),
    advanceGoalReplay: (...a) => advanceGoalReplay(...a),
    playOnlineReplay: (...a) => playOnlineReplay(...a),
    advancePostGoal: (...a) => advancePostGoal(...a),
    emitSkaterEffects: (...a) => emitSkaterEffects(...a),
    syncViewBodies: (...a) => syncViewBodies(...a),
    syncTickBodies: (...a) => syncTickBodies(...a),
    capturePose: (...a) => capturePose(...a),
    clearPose: (...a) => clearPose(...a),
    syncInterpolatedBodies: (...a) => syncInterpolatedBodies(...a),
    applyTickEvents: (...a) => applyTickEvents(...a),
    noteEvents: (...a) => noteEvents(...a),
    recordTrails: (...a) => recordTrails(...a),
    traceGuide: (...a) => traceGuide(...a),
    finishTurn: (...a) => finishTurn(...a),
    foulsShowing: (...a) => foulsShowing(...a),
    animateFirstTurnGuide: (...a) => animateFirstTurnGuide(...a),
    flushMeters: (...a) => flushMeters(...a),
    knobEditable: (...a) => knobEditable(...a),
    boxPoint: (...a) => boxPoint(...a),
    screenPoint: (...a) => screenPoint(...a),
    impulseGeometry: (...a) => impulseGeometry(...a),
    demoWait: (...a) => demoWait(...a),
    sync: (...a) => sync(...a),
    draw: (...a) => draw(...a),
    gameAudio: (...a) => gameAudio(...a),
    popup: (...a) => popup(...a),
    steamRing: (...a) => steamRing(...a),
    clearEffects: (...a) => clearEffects(...a),
    quench: (...a) => quench(...a),
    lightNet: (...a) => lightNet(...a),
    ballOnFire: (...a) => ballOnFire(...a),
    celebrate: (...a) => celebrate(...a),
    honourText: (...a) => honourText(...a),
    loopFanfare: (...a) => loopFanfare(...a),
    stopFanfare: (...a) => stopFanfare(...a),
    announceFouls: (...a) => announceFouls(...a),
    foulText: (...a) => foulText(...a),
    trailPositions: (...a) => trailPositions(...a),
    clearDiscontinuousTrails: (...a) => clearDiscontinuousTrails(...a),
    dirtyPrediction: (...a) => dirtyPrediction(...a),
    openSummary: (...a) => openSummary(...a),
    closeSummary: (...a) => closeSummary(...a),
    resetPlans: (...a) => resetPlans(...a),
    buildTeam: (...a) => buildTeam(...a),
    say: (...a) => say(...a),
    showMode: (...a) => showMode(...a),
    openSetup: (...a) => openSetup(...a),
    closeLobby: (...a) => closeLobby(...a),
    showLobby: (...a) => showLobby(...a),
    sheetOpen: (...a) => sheetOpen(...a),
    closeSheet: (...a) => closeSheet(...a),
    isSetupShot: (...a) => isSetupShot(...a),
    enterMatch: (...a) => enterMatch(...a),
    exitMatchMode: (...a) => exitMatchMode(...a),
    finishCpuMatch: (...a) => finishCpuMatch(...a),
    matchInProgress: (...a) => matchInProgress(...a),
    ownTeamReady: (...a) => ownTeamReady(...a),
    adoptAccountTeam: (...a) => adoptAccountTeam(...a),
    startCpuMatch: (...a) => startCpuMatch(...a),
    startDemo: (...a) => startDemo(...a),
    stopDemo: (...a) => stopDemo(...a),
    closeFirstTurnGuide: (...a) => closeFirstTurnGuide(...a),
    openFoulInfo: (...a) => openFoulInfo(...a),
    closeFoulInfo: (...a) => closeFoulInfo(...a),
    applyTickEvents: (...a) => applyTickEvents(...a),
    stepPostGoalFrame: (...a) => stepPostGoalFrame(...a),
    runPlaybackTicks: (...a) => runPlaybackTicks(...a),
    stepOnlineTurn: (...a) => stepOnlineTurn(...a),
    handleCollision: (...a) => handleCollision(...a),
    handleWall: (...a) => handleWall(...a),
    handleShockwave: (...a) => handleShockwave(...a),
    handleSuper: (...a) => handleSuper(...a),
    clearReplayViewer: (...a) => clearReplayViewer(...a),
    prepareCPU: (...a) => prepareCPU(...a),
    startPlanClock: (...a) => startPlanClock(...a),
    cancelScheduledSave: (...a) => cancelScheduledSave(...a),
    saveRecording: (...a) => saveRecording(...a),
    clearActiveMatch: (...a) => clearActiveMatch(...a),
    recordSegment: (...a) => recordSegment(...a),
    saveEvent: (...a) => saveEvent(...a),
    beginGuide: (...a) => beginGuide(...a),
    noteTurn: (...a) => noteTurn(...a),
    endGoalReplay: (...a) => endGoalReplay(...a),
    playOnlineReplay: (...a) => playOnlineReplay(...a),
    toViewBody: (...a) => toViewBody(...a),
    replayEvents: (...a) => replayEvents(...a),
    newMatch: (...a) => newMatch(...a),
    cancelExport: (...a) => cancelExport(...a),
    viewBodies: (...a) => viewBodies(...a),
    kickoff: (...a) => kickoff(...a),
    setShot: (...a) => setShot(...a),
    stageArea,
    stadium,
    rinkStage,
    btnFullscreen,
    btnRotate,
    firstTurnKey,
    CARD_TEXT: 'no meter, back to spawn, out for a turn',
    get statDrawer() { return typeof statDrawer !== 'undefined' ? statDrawer : null; },
    get matchMedia() { return typeof matchMedia === 'function' ? matchMedia : null; },
    get location() { return typeof location !== 'undefined' ? location : null; },
    get history() { return typeof history !== 'undefined' ? history : null; },
    get scrollTo() { return typeof scrollTo === 'function' ? scrollTo : null; },
    get scrollY() { return typeof scrollY === 'number' ? scrollY : 0; },
    get cancelAnimationFrame() { return typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null; },
    get CustomEvent() { return typeof CustomEvent !== 'undefined' ? CustomEvent : null; },
    get URL() { return typeof URL !== 'undefined' ? URL : null; },
    get addEventListener() { return typeof addEventListener === 'function' ? addEventListener : null; },
    get ubuRender() { return typeof ubuRender !== 'undefined' ? ubuRender : null; },
    get firstTurnSeen() { return firstTurnSeen; }, set firstTurnSeen(v) { firstTurnSeen = v; },
    get foulInfoKey() { return foulInfoKey; }, set foulInfoKey(v) { foulInfoKey = v; },
    get foulBox() { return foulBox; }, set foulBox(v) { foulBox = v; },
    get tapGuards() { return tapGuards; }, set tapGuards(v) { tapGuards = v; },
    get dragStart() { return dragStart; }, set dragStart(v) { dragStart = v; },
    get dragStartClient() { return dragStartClient; }, set dragStartClient(v) { dragStartClient = v; },
    get dragClient() { return dragClient; }, set dragClient(v) { dragClient = v; },
    get dragPointerType() { return dragPointerType; }, set dragPointerType(v) { dragPointerType = v; },
    get dragMoved() { return dragMoved; }, set dragMoved(v) { dragMoved = v; },
    get dragMaxTravel() { return dragMaxTravel; }, set dragMaxTravel(v) { dragMaxTravel = v; },
    get dragLiftPx() { return dragLiftPx; }, set dragLiftPx(v) { dragLiftPx = v; },
    get spinDrag() { return spinDrag; }, set spinDrag(v) { spinDrag = v; },
    get dragMode() { return dragMode; }, set dragMode(v) { dragMode = v; },
    get arrowGrab() { return arrowGrab; }, set arrowGrab(v) { arrowGrab = v; },
    get returnShot() { return returnShot; }, set returnShot(v) { returnShot = v; },
    get returnPortrait() { return returnPortrait; }, set returnPortrait(v) { returnPortrait = v; },
    get handoffToMatch() { return handoffToMatch; }, set handoffToMatch(v) { handoffToMatch = v; },
    get cameraDone() { return cameraDone; }, set cameraDone(v) { cameraDone = v; },
    get resolveCameraDone() { return resolveCameraDone; }, set resolveCameraDone(v) { resolveCameraDone = v; },
    get cameraStepRaf() { return cameraStepRaf; }, set cameraStepRaf(v) { cameraStepRaf = v; },
    get pendingExitCollection() { return pendingExitCollection; }, set pendingExitCollection(v) { pendingExitCollection = v; },
    get afterCollectionShrink() { return afterCollectionShrink; }, set afterCollectionShrink(v) { afterCollectionShrink = v; },
    get collectionShownLength() { return collectionShownLength; }, set collectionShownLength(v) { collectionShownLength = v; },
    get collectionTargetLength() { return collectionTargetLength; }, set collectionTargetLength(v) { collectionTargetLength = v; },
    get collectionLengthRaf() { return collectionLengthRaf; }, set collectionLengthRaf(v) { collectionLengthRaf = v; },
    get collectionRotateHold() { return collectionRotateHold; }, set collectionRotateHold(v) { collectionRotateHold = v; },
    get collectionLengthOverride() { return collectionLengthOverride; }, set collectionLengthOverride(v) { collectionLengthOverride = v; },
    get collectionShrinkingBox() { return collectionShrinkingBox; }, set collectionShrinkingBox(v) { collectionShrinkingBox = v; },
    get collectionLayout() { return collectionLayout; }, set collectionLayout(v) { collectionLayout = v; },
    get collectionScrollRaf() { return collectionScrollRaf; }, set collectionScrollRaf(v) { collectionScrollRaf = v; },
    get lobbyGeneration() { return lobbyGeneration; }, set lobbyGeneration(v) { lobbyGeneration = v; },
    get lobbyView() { return lobbyView; }, set lobbyView(v) { lobbyView = v; },
    get savedTeams() { return savedTeams; }, set savedTeams(v) { savedTeams = v; },
    get teamIndex() { return teamIndex; }, set teamIndex(v) { teamIndex = v; },
    get rosterSlot() { return rosterSlot; }, set rosterSlot(v) { rosterSlot = v; },
    get lastCpuSetup() { return lastCpuSetup; }, set lastCpuSetup(v) { lastCpuSetup = v; },
    get ballisticAvailable() { return lastCpuSetup?.level === 'ballistic' && hasBallisticWeights(lastCpuSetup.mode); },
    get rulesGameNumber() { return rulesGameNumber; }, set rulesGameNumber(v) { rulesGameNumber = v; },
    get fullscreenRequest() { return fullscreenRequest; }, set fullscreenRequest(v) { fullscreenRequest = v; },
    get videoCancelled() { return videoCancelled; }, set videoCancelled(v) { videoCancelled = v; },
    fitScorebug: (...a) => fitScorebug(...a),
    cornerTeams: (...a) => cornerTeams(...a),
    isCreasing: (...a) => isCreasing(...a),
    stalling: (...a) => stalling(...a),
    sideName: (...a) => sideName(...a),
    sideHas: (...a) => sideHas(...a),
    ubuCount: (...a) => ubuCount(...a),
    warningAt: (...a) => warningAt(...a),
    placeFinger: (...a) => placeFinger(...a),
    hideFinger: (...a) => hideFinger(...a),
    dirtyPrediction: (...a) => dirtyPrediction(...a),
    toggleGuard: (...a) => toggleGuard(...a),
    scheduleSaveActiveMatch: (...a) => scheduleSaveActiveMatch(...a),
    chosenMode: (...a) => chosenMode(...a),
    signedIn: (...a) => signedIn(...a),
    teamSlotsOf: (...a) => teamSlotsOf(...a),
    sameSlots: (...a) => sameSlots(...a),
    loadCollection: (...a) => loadCollection(...a),
    loadTeams: (...a) => loadTeams(...a),
    rosterSlots: (...a) => rosterSlots(...a),
    teamLocked: (...a) => teamLocked(...a),
    fixedTeam: (...a) => fixedTeam(...a),
    rememberTeam: (...a) => rememberTeam(...a),
    accountTeam: (...a) => accountTeam(...a),
    openStats: (...a) => openStats(...a),
    openMatchStats: (...a) => openMatchStats(...a),
    confirmCpuEnd: (...a) => confirmCpuEnd(...a),
    aimHelp: (...a) => aimHelp(...a),
    castTo: (...a) => castTo(...a),
    castHome: (...a) => castHome(...a),
    wheelKnob: (...a) => wheelKnob(...a),
    updateReplayBar: (...a) => updateReplayBar(...a),
    isMatchShot: (...a) => isMatchShot(...a),
    isSetupShot: (...a) => isSetupShot(...a),
    playableShot: (...a) => playableShot(...a),
    openPause: (...a) => openPause(...a),
    ownsFullscreen: (...a) => ownsFullscreen(...a),
    knobValue: (...a) => knobValue(...a),
    setKnob: (...a) => setKnob(...a),
    stagePoint: (...a) => stagePoint(...a),
    openFoulInfo: (...a) => openFoulInfo(...a),
    updateFoulInfo: (...a) => updateFoulInfo(...a),
    updateFirstTurnGuide: (...a) => updateFirstTurnGuide(...a),
    fitOrientation: (...a) => fitOrientation(...a),
    syncFullscreenButton: (...a) => syncFullscreenButton(...a),
    updateFullscreenUI: (...a) => updateFullscreenUI(...a),
    exitOwnedFullscreen: (...a) => exitOwnedFullscreen(...a),
    setPortrait: (...a) => setPortrait(...a),
    toggleRotate: (...a) => toggleRotate(...a),
    point: (...a) => point(...a),
    fieldTarget: (...a) => fieldTarget(...a),
    aimPower: (...a) => aimPower(...a),
    boxPoint: (...a) => boxPoint(...a),
    screenPoint: (...a) => screenPoint(...a),
    measureField: (...a) => measureField(...a),
    updateReplaySkip: (...a) => updateReplaySkip(...a),
    teamHint: (...a) => teamHint(...a),
    setupStep: (...a) => setupStep(...a),
    fitSetupShot: (...a) => fitSetupShot(...a),
    skateLineup: (...a) => skateLineup(...a),
    resetSetupSlots: (...a) => resetSetupSlots(...a),
    stepCollectionLength: (...a) => stepCollectionLength(...a),
    compactPhoneStage: (...a) => compactPhoneStage(...a),
    isHomeShot: (...a) => isHomeShot(...a),
    updateHome: (...a) => updateHome(...a),
    leaveForHome: (...a) => leaveForHome(...a),
    leavePlayOverlays: (...a) => leavePlayOverlays(...a),
    screenTransition: (...a) => screenTransition(...a),
    demoPaused: (...a) => demoPaused(...a),
    get liveFx() { return typeof liveFx !== 'undefined' ? liveFx : null; },
    get replayFx() { return typeof replayFx !== 'undefined' ? replayFx : null; }
  });
  const projector = createBodyProjector({
    P,
    state,
    anonymousName: i => anonymousName(i),
    isClassicMode: () => classicMode(),
    resolveEquippedSuper: (entry, i) => resolveEquippedSuper(entry, i),
    getShownSim: () => shownSim(),
    getShownSeat: () => shownSeat()
  });
  const { projectBody, viewBodies, toViewBody, syncViewBodies, syncTickBodies, capturePose, clearPose, syncInterpolatedBodies } = projector;
  let fieldEffects = createEffectsState([], materialStyles);
  let hitStopUntil = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let visibleRinkHeight = 600, themeColors = null;
  const impulseGeometry = (body, plan) => calcImpulseGeometry(P, body, plan);
  const presenter = createRinkPresenter({
    P,
    ububallMatch,
    ububallReplay,
    state,
    guideShown: (key, g) => guideShown(key, g),
    isReducedMotion: () => reducedMotion.matches,
    clockNow: () => clockNow(),
    gameAudio: () => gameAudio(),
    uiScale: () => gameUi.scale(),
    anonymousName: i => anonymousName(i),
    contactMeter: (a, b, speed, passerSlot) => contactMeter(a, b, speed, passerSlot),
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
  const cpuTurnPlanner = createCpuTurnPlanner({ state });
  const { creditSave, contactMeter, flushMeters } = createMeterController({ state });
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
    traceGuide: (sim, g) => traceGuide(sim, g),
    recordTrails: () => recordTrails()
  });
  const goalReplayCtrl = createGoalReplayController({ state });
  const {
    replayEvents, replayHitStop, currentReplay, activeOnlineSim, shownSim, shownSeat,
    replayView, syncReplay, syncReplayTick, replayFx,
    restartGoalReplay, nextReplaySegment, startGoalReplay, advanceGoalReplay, endGoalReplay
  } = goalReplayCtrl;
  const matchLifecycle = createMatchLifecycleController({ state });
  const {
    recordSegment, saveEvent, noteEvents, libraryEntry, saveRecording, noteTurn,
    makeGuide, beginGuide, traceGuide, guideShown,
    clearActiveMatch, saveActiveMatch, kickoff, restoreActiveMatch, newMatch, finishTurn, onGuestTeam
  } = matchLifecycle;
  const {
    networkMoves, playOnlineReplay, onlineNames, updateRematch,
    recordOnline, recordOnlineTurn, finishOnlineRecording,
    callbacks: onlineCallbacks
  } = createOnlineMatchController({ state });
  const ubuCount = n => `${n} ubu${n === 1 ? '' : 's'}`;
  // Each side by its scoreboard name (You, CPU, an opponent's or a demo team's), so every view reads
  // right; "You" takes the plural verb.
  const sideName = team => $(team ? 'opponent-label' : 'home-label').textContent;
  const sideHas = team => sideName(team) + (sideName(team) === 'You' ? ' have' : ' has');
  const CARD_TEXT = 'no meter, back to spawn, out for a turn';
  const { startPlanClock, localPlayBlocked, updateLocalPlanClock, updateClock, drainClock } = createPlanClockController({ state });
  const stageCtrl = createStageController({ state, actions: { endReplay: (...a) => endReplay(...a) } });
  const {
    homeShot, isHomeShot, isMatchShot, isSetupShot, playableShot, demoPaused,
    openFoulInfo, closeFoulInfo, foulInfoLines, updateFoulInfo,
    updateFirstTurnGuide, positionFirstTurnGuide, animateFirstTurnGuide, closeFirstTurnGuide,
    KNOB_SWEEP, KNOB_RANGE, screenDegrees, knobValue, knobEditable, setKnob,
    aimPower, boxPoint, screenPoint, point, fieldTarget, measureField, stagePoint,
    positionSpinControl, stepCollectionLength, WIDE_STAGE_QUERY, compactPhoneStage,
    settleCameraPromise, clearCameraArtifacts, cancelActiveCamera, finishCameraMove,
    camera, setShot, endCanvasDrag, updateAimLoupe, updateReplaySkip, teamHint, setupStep, wideScreen,
    sheetOpen, fitSetupShot, skateLineup, resetSetupSlots, openSheet, closeSheet,
    cancelSheet, leaveSetupShot, closeLobby, fullscreenTarget, fullscreenDisplay,
    ownsFullscreen, syncFullscreenButton, updateFullscreenUI, exitOwnedFullscreen,
    setPortrait, toggleRotate, portraitScreen, fitOrientation, matchInProgress,
    updateHome, enterMatch, exitMatchMode, openPause, finishCpuMatch,
    leaveForHome, leavePlayOverlays, screenTransition, screenGuard
  } = stageCtrl;
  bindMatchShortcuts({ state });
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
  const { closeSummary, openSummary } = createSummaryController({ state });
  function say(message) { $('game-status').textContent = message; }
  function aimHelp() {
    return pullBehind
      ? 'Pull back from an ubu to aim in the opposite direction. Pull farther for more power.'
      : 'Drag from an ubu toward your target. Drag farther for more power.';
  }
  function prepareCPU(initialPlans = null) { return cpuTurnPlanner.prepareCPU(initialPlans); }
  // Big announcements over the rink. The promise settles once the banner has gone, or as soon as
  // another banner replaces it.
  let planBanner = Promise.resolve();
  const { restartClassAnimation, banner } = createBannerController({ state });
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
  // Up and right increase each knob. Angle wraps and its arrow follows the launch direction.
  const knobs = [];
  function formatKnobValue(kind, value) {
    const shown = Math.round(value) % (kind === 'angle' ? 360 : Infinity);
    return kind === 'angle' ? `${shown}°` : kind === 'spin' && shown > 0 ? `+${shown}` : kind === 'power' ? `${shown}%` : `${shown}`;
  }
  function placeKnobOverlay(el, anchor) {
    const a = anchor.getBoundingClientRect(), scale = gameUi.scale(), gap = 8 * scale, margin = 8 * scale;
    el.style.inset = 'auto';
    el.style.left = el.style.top = '0px';
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(margin, Math.min(a.left + a.width / 2 - w / 2, innerWidth - margin - w));
    let top = a.top - gap - h;
    if (top < margin && a.bottom + gap + h <= innerHeight - margin) top = a.bottom + gap;
    el.style.left = left + 'px';
    el.style.top = Math.max(margin, Math.min(top, innerHeight - margin - h)) + 'px';
  }
  const knobDragPill = document.createElement('div');
  knobDragPill.className = 'knob-drag-pill';
  knobDragPill.hidden = true;
  document.body.append(knobDragPill);
  function showKnobDragPill(knob, value, fine) {
    knobDragPill.textContent = `${formatKnobValue(knob.kind, value)}${fine ? ' · ½×' : ''}`;
    knobDragPill.classList.toggle('fine', Boolean(fine));
    knobDragPill.hidden = false;
    placeKnobOverlay(knobDragPill, knob.svg);
  }
  function hideKnobDragPill() {
    knobDragPill.hidden = true;
    knobDragPill.classList.remove('fine');
  }
  const knobPopover = document.createElement('div');
  knobPopover.className = 'knob-popover game-popover';
  knobPopover.setAttribute('popover', 'auto');
  knobPopover.innerHTML =
    '<button type="button" class="knob-step" data-dir="-1" aria-label="Decrease"><svg class="icon" aria-hidden="true"><use href="#icon-minus"/></svg></button>' +
    '<button type="button" class="knob-readout"></button>' +
    '<button type="button" class="knob-step" data-dir="1" aria-label="Increase"><svg class="icon" aria-hidden="true"><use href="#icon-plus"/></svg></button>';
  document.body.append(knobPopover);
  const knobPopoverReadout = knobPopover.querySelector('.knob-readout');
  let activeKnobPopover = null, knobRepeatTimer = 0;
  function stopKnobRepeat() {
    if (knobRepeatTimer) { clearTimeout(knobRepeatTimer); knobRepeatTimer = 0; }
  }
  function closeKnobPopover() {
    stopKnobRepeat();
    activeKnobPopover = null;
    if (knobPopover.matches?.(':popover-open')) knobPopover.hidePopover?.();
  }
  function syncKnobPopover() {
    if (!activeKnobPopover || !knobPopover.matches?.(':popover-open')) return;
    if (!knobEditable(selected)) { closeKnobPopover(); return; }
    const kind = activeKnobPopover.kind;
    const text = formatKnobValue(kind, knobValue(kind, selected));
    const resettable = kind === 'power' || kind === 'spin';
    knobPopoverReadout.textContent = text;
    knobPopoverReadout.disabled = !resettable;
    knobPopoverReadout.title = resettable ? `Tap to reset ${kind} to 0` : '';
    knobPopoverReadout.setAttribute('aria-label', resettable ? `${text}. Reset ${kind} to 0` : text);
    placeKnobOverlay(knobPopover, activeKnobPopover.svg);
  }
  function openKnobPopover(knob) {
    if (!knobEditable(selected)) return;
    stopKnobRepeat();
    activeKnobPopover = knob;
    if (!knobPopover.matches?.(':popover-open')) knobPopover.showPopover?.();
    syncKnobPopover();
  }
  function stepActiveKnob(dir, shiftKey) {
    if (!activeKnobPopover || !knobEditable(selected)) { stopKnobRepeat(); return; }
    const kind = activeKnobPopover.kind;
    setKnob(kind, selected, knobValue(kind, selected) + dir * (shiftKey ? 10 : 1));
    scheduleSaveActiveMatch();
  }
  for (const btn of knobPopover.querySelectorAll('.knob-step')) {
    const dir = Number(btn.dataset.dir);
    btn.onpointerdown = e => {
      if (e.button !== 0 || !activeKnobPopover || !knobEditable(selected)) return;
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      const shift = e.shiftKey;
      stepActiveKnob(dir, shift);
      stopKnobRepeat();
      let count = 0;
      const tick = () => {
        stepActiveKnob(dir, shift);
        if (!activeKnobPopover || !knobEditable(selected)) return;
        count++;
        const delay = count < 5 ? 140 : count < 11 ? 75 : 38;
        knobRepeatTimer = setTimeout(tick, delay);
      };
      knobRepeatTimer = setTimeout(tick, 380);
    };
    btn.onpointerup = btn.onpointercancel = btn.onlostpointercapture = stopKnobRepeat;
    btn.onclick = e => { if (e.detail === 0) stepActiveKnob(dir, e.shiftKey); };
  }
  knobPopoverReadout.onclick = () => {
    if (!activeKnobPopover || !knobEditable(selected)) return;
    const kind = activeKnobPopover.kind;
    if (kind !== 'power' && kind !== 'spin') return;
    setKnob(kind, selected, 0);
    if (phase === 'plan') saveActiveMatch();
  };
  knobPopover.addEventListener('toggle', e => {
    if (e.newState === 'closed') { stopKnobRepeat(); activeKnobPopover = null; }
  });
  addEventListener('resize', () => {
    if (activeKnobPopover && knobPopover.matches?.(':popover-open')) placeKnobOverlay(knobPopover, activeKnobPopover.svg);
  });
  addEventListener('scroll', e => {
    if (!activeKnobPopover || !knobPopover.matches?.(':popover-open')) return;
    if (e.target === knobPopover || knobPopover.contains?.(e.target)) return;
    placeKnobOverlay(knobPopover, activeKnobPopover.svg);
  }, true);
  function wheelKnob(e, kind, i) {
    if (!e.deltaY || !knobEditable(i)) return;
    e.preventDefault();
    setKnob(kind, i, knobValue(kind, i) - Math.sign(e.deltaY) * (e.shiftKey ? 10 : 1), typeof requestAnimationFrame === 'function');
    scheduleSaveActiveMatch();
  }
  function makeKnob(kind) {
    const wrap = document.createElement('div'); wrap.className = `knob knob-${kind}`;
    const label = kind[0].toUpperCase() + kind.slice(1);
    wrap.innerHTML = (kind === 'angle'
      ? '<svg viewBox="0 0 100 100" role="slider" tabindex="0"><circle class="knob-track" cx="50" cy="50" r="40"/>' +
        '<circle class="knob-face" cx="50" cy="50" r="29"/>' +
        '<path class="knob-arrow" d="M50 71 L50 28 M39 39 L50 28 L61 39"/></svg>'
      : '<svg viewBox="0 0 100 100" role="slider" tabindex="0"><circle class="knob-track" cx="50" cy="50" r="40"/>' +
        '<path class="knob-value"/>' +
        (kind === 'spin' ? '<path class="knob-arc-arrow"/>' : '') +
        '<circle class="knob-face" cx="50" cy="50" r="29"/>' +
        '<line class="knob-needle" x1="50" y1="50" x2="50" y2="26"/></svg>') +
      `<small>${label}</small>`;
    const svg = wrap.querySelector('svg');
    const [min, max] = KNOB_RANGE[kind];
    svg.setAttribute('aria-valuemin', min); svg.setAttribute('aria-valuemax', max);
    const knob = { kind, wrap, svg };
    let grab = null;
    const onFineTouchDown = ev => {
      if (!grab || ev.pointerType !== 'touch' || ev.pointerId === grab.id) return;
      grab.finePointers.add(ev.pointerId);
      if (!grab.fine) {
        grab.fine = true;
        grab.x = grab.lastX; grab.y = grab.lastY;
        grab.value = knobValue(kind, grab.index);
        if (grab.dragged) showKnobDragPill(knob, grab.value, true);
      }
    };
    const onFineTouchEnd = ev => {
      if (!grab || !grab.finePointers.delete(ev.pointerId)) return;
      if (grab.fine && grab.finePointers.size === 0) {
        grab.fine = false;
        grab.x = grab.lastX; grab.y = grab.lastY;
        grab.value = knobValue(kind, grab.index);
        if (grab.dragged) showKnobDragPill(knob, grab.value, false);
      }
    };
    const detachFineTouch = () => {
      removeEventListener('pointerdown', onFineTouchDown, true);
      removeEventListener('pointerup', onFineTouchEnd, true);
      removeEventListener('pointercancel', onFineTouchEnd, true);
    };
    svg.onpointerdown = e => {
      if (grab || e.button !== 0 || !knobEditable(selected)) return;
      const wasOpen = activeKnobPopover === knob && Boolean(knobPopover.matches?.(':popover-open'));
      e.preventDefault(); svg.setPointerCapture(e.pointerId);
      grab = {
        id: e.pointerId, pointerType: e.pointerType, index: selected,
        startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY,
        value: knobValue(kind, selected), dragged: false, fine: false, wasOpen, cancelled: false, finePointers: new Set()
      };
      if (e.pointerType === 'touch') {
        addEventListener('pointerdown', onFineTouchDown, true);
        addEventListener('pointerup', onFineTouchEnd, true);
        addEventListener('pointercancel', onFineTouchEnd, true);
      }
    };
    svg.onpointermove = e => {
      if (grab?.id !== e.pointerId) return;
      grab.lastX = e.clientX; grab.lastY = e.clientY;
      if (!grab.dragged) {
        if (Math.hypot(e.clientX - grab.startX, e.clientY - grab.startY) < 6) return;
        grab.dragged = true;
        grab.x = e.clientX; grab.y = e.clientY;
        grab.value = knobValue(kind, grab.index);
        closeKnobPopover();
      }
      const distance = (e.clientX - grab.x) - (e.clientY - grab.y);
      const sensitivity = (e.shiftKey ? .25 : 1) * (grab.fine ? .5 : 1);
      setKnob(kind, grab.index, grab.value + distance / (KNOB_SWEEP * gameUi.scale()) * (max - min) * sensitivity, typeof requestAnimationFrame === 'function');
      showKnobDragPill(knob, knobValue(kind, grab.index), grab.fine);
    };
    svg.onpointercancel = e => { if (grab?.id === e.pointerId) grab.cancelled = true; };
    svg.onlostpointercapture = () => {
      const finished = grab;
      grab = null;
      detachFineTouch();
      hideKnobDragPill();
      if (!finished) return;
      if (finished.dragged) {
        if (dragDirty) { dragDirty = false; sync(); draw(); }
        if (phase === 'plan') saveActiveMatch();
      } else if (!finished.cancelled) {
        if (finished.wasOpen) closeKnobPopover();
        else openKnobPopover(knob);
      }
    };
    svg.addEventListener('wheel', e => wheelKnob(e, kind, selected), { passive: false });
    svg.onkeydown = e => {
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault(); setKnob(kind, selected, knobValue(kind, selected) + step * (e.shiftKey ? 10 : 1), Boolean(e.repeat && typeof requestAnimationFrame === 'function'));
      if (phase === 'plan') { if (e.repeat) scheduleSaveActiveMatch(); else saveActiveMatch(); }
    };
    knobs.push(knob);
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
      // Power sweeps 270° from lower left; spin runs either way from the top with an arrowhead; angle is an arrow.
      const needle = knob.kind === 'angle' ? value : knob.kind === 'power' ? -135 + 2.7 * value : 1.35 * value;
      if (knob.kind === 'angle') {
        knob.wrap.querySelector('.knob-arrow').setAttribute('transform', `rotate(${needle} 50 50)`);
      } else if (knob.kind === 'power') {
        knob.wrap.querySelector('.knob-value').setAttribute('d', needle + 135 > .5 ? knobArc(-135, needle) : '');
        knob.wrap.querySelector('.knob-needle').setAttribute('transform', `rotate(${needle} 50 50)`);
      } else {
        knob.wrap.querySelector('.knob-needle').setAttribute('transform', `rotate(${needle} 50 50)`);
        const arrow = knob.wrap.querySelector('.knob-arc-arrow');
        if (Math.abs(needle) > .5) {
          const dir = Math.sign(needle);
          const [from, to] = [Math.min(0, needle), Math.max(0, needle)];
          knob.wrap.querySelector('.knob-value').setAttribute('d', to - from > .5 ? knobArc(from, to) : '');
          arrow.setAttribute('d', dir > 0 ? 'M43 3.5 L51 10 L43 16.5' : 'M57 3.5 L49 10 L57 16.5');
          arrow.setAttribute('transform', `rotate(${needle} 50 50)`);
        } else {
          knob.wrap.querySelector('.knob-value').setAttribute('d', '');
          arrow.setAttribute('d', '');
        }
      }
      const shown = Math.round(value) % (knob.kind === 'angle' ? 360 : Infinity);
      const editable = knobEditable(i);
      knob.wrap.classList.toggle('disabled', !editable);
      knob.svg.setAttribute('aria-disabled', String(!editable));
      knob.svg.setAttribute('aria-label', `${knob.kind[0].toUpperCase() + knob.kind.slice(1)} for ${fieldView.entries[i]?.model?.parts.fullName || 'ubu'}`);
      knob.svg.setAttribute('aria-valuenow', Math.round(value));
      knob.svg.setAttribute('aria-valuetext', knob.kind === 'angle' ? `${shown} degrees` : knob.kind === 'power' ? `${shown}% power` :
        shown === 0 ? 'No spin' : `${Math.abs(shown)}% ${shown < 0 ? 'counterclockwise' : 'clockwise'}`);
    }
    syncKnobPopover();
  }
  function sync() {
    const _tSync = bench?.rec ? performance.now() : 0;
    updateFirstTurnGuide();
    if (drag === null) { spinDrag = null; updateAimLoupe(); }
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
    const selPlan = plans[selected];
    const hasResettablePlan = Boolean(selPlan?.power > 0 || selPlan?.spin || selPlan?.guard || curB?.superArm);
    $('shot-guard').disabled = !knobEditable(selected);
    $('shot-reset').disabled = !knobEditable(selected) || !hasResettablePlan;
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
    $('launch-plan').hidden = !planning;
    $('launch-plan').textContent = !planning ? '' : hasMoves
      ? Object.entries(actions).filter(([, count]) => count).map(([action, count]) => count + ' ' + action).join(' · ')
      : 'No moves planned';
    delete $('launch').dataset.tip;
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
      const statusText = b.carded ? 'Carded' : b.stunned ? 'Stunned' : b.superArm ? 'Armed' : b.meter >= 100 ? 'Ready' : `${Math.round(b.meter || 0)}%`;
      if (pctNode) pctNode.textContent = statusText;
      const pill = $(`portrait-pill-${i}`);
      if (pill) {
        const meterVal = Math.max(0, Math.min(100, b.meter || 0));
        pill.style.setProperty('--meter', `${meterVal.toFixed(1)}%`);
        pill.classList.toggle('selected', i < 3 && i === selected);
        pill.classList.toggle('ready', !b.superArm && b.meter >= 100);
        pill.classList.toggle('armed', Boolean(b.superArm));
        pill.classList.toggle('carded', Boolean(b.carded));
        pill.classList.toggle('stunned', Boolean(b.stunned));
        if (i < 3) pill.setAttribute('aria-pressed', String(i === selected));
        const pillSuper = $(`portrait-super-${i}`);
        if (pillSuper && b.equippedSuper?.icon) {
          if (pillSuper.getAttribute('src') !== b.equippedSuper.icon) pillSuper.src = b.equippedSuper.icon;
          if (pillSuper.alt !== superTitle) pillSuper.alt = superTitle;
        }
        const plan = i < 3 ? plans[i] : null;
        const canAct = !b.carded && !b.stunned;
        const pillGuarded = canAct && (i < 3 ? (planning ? Boolean(plan?.guard) : phase === 'play' && Boolean(b.guarding)) : (phase === 'play' && Boolean(b.guarding)));
        const pillAimed = canAct && i < 3 && planning && !pillGuarded && Boolean((plan?.power || 0) > 0 || plan?.spin || b.superArm);
        const stateKind = b.carded ? 'carded'
          : b.stunned ? 'stunned'
          : pillGuarded ? (b.ironGuard ? 'iron-guard' : 'guard')
          : pillAimed ? 'aimed'
          : '';
        const pillState = $(`portrait-state-${i}`);
        if (pillState) {
          pillState.hidden = !stateKind;
          if (pillState.dataset.state !== stateKind) {
            pillState.dataset.state = stateKind;
            if (stateKind === 'carded') {
              const cardMark = document.createElement('span');
              cardMark.className = 'portrait-state-card';
              pillState.replaceChildren(cardMark);
            } else if (stateKind === 'stunned') {
              pillState.replaceChildren(gameUi.icon('sparkles'));
            } else if (stateKind === 'guard' || stateKind === 'iron-guard') {
              pillState.replaceChildren(gameUi.icon('shield'));
            } else if (stateKind === 'aimed') {
              pillState.replaceChildren(gameUi.icon('check'));
            } else {
              pillState.replaceChildren();
            }
          }
        }
        const stateLabel = stateKind === 'carded' ? 'Yellow card'
          : stateKind === 'stunned' ? 'Stunned'
          : stateKind === 'iron-guard' || stateKind === 'guard' ? 'Guarding'
          : stateKind === 'aimed' ? 'Move planned'
          : '';
        const ubuName = fieldView.entries[i]?.model?.parts?.fullName || `Ubu ${i + 1}`;
        pill.setAttribute('aria-label', [ubuName, !classicMode() && `${superTitle} ${statusText}`, stateLabel].filter(Boolean).join(' · '));
      }
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
    if (statDrawer.matches(':popover-open')) updateStatDrawerSuper(Number(statDrawer.dataset.player));
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
  function updateStatDrawerSuper(i) {
    const card = $('stat-drawer-super');
    if (!card || Number(card.dataset.player) !== i) return;
    const body = fieldView.bodies?.[i];
    const meterVal = Math.max(0, Math.min(100, body?.meter || 0));
    card.classList.toggle('armed', Boolean(body?.superArm));
    card.classList.toggle('ready', !body?.superArm && meterVal >= 100);
    const fill = $('stat-drawer-super-fill');
    if (fill) setMeterFill(fill, meterVal);
    const pct = $('stat-drawer-super-pct');
    if (pct) pct.textContent = formatDrawerSuperStatus(body);
  }
  function renderDrawerSuperCard(entry, i) {
    if (classicMode()) return null;
    const body = fieldView.bodies?.[i];
    const rawAbility = body?.equippedSuper || entry?.equippedSuper;
    const ability = rawAbility && rawAbility.copies != null
      ? rawAbility
      : resolveEquippedSuper({ ...entry, equippedSuper: rawAbility }, i);
    if (!ability) return null;
    const meterVal = Math.max(0, Math.min(100, body?.meter || 0));
    const card = document.createElement('div');
    card.id = 'stat-drawer-super';
    card.className = 'stat-drawer-super';
    card.dataset.player = i;
    card.classList.toggle('armed', Boolean(body?.superArm));
    card.classList.toggle('ready', !body?.superArm && meterVal >= 100);
    const top = document.createElement('div');
    top.className = 'stat-drawer-super-head';
    const icon = document.createElement('img');
    icon.className = 'stat-drawer-super-icon';
    icon.src = ability.icon || P.SUPERS[0].icon;
    icon.alt = '';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'stat-drawer-super-title';
    const name = document.createElement('strong');
    name.textContent = ability.displayName || ability.name;
    const pct = document.createElement('span');
    pct.id = 'stat-drawer-super-pct';
    pct.className = 'super-pct';
    pct.textContent = formatDrawerSuperStatus(body);
    titleWrap.append(name, pct);
    const track = document.createElement('div');
    track.className = 'super-meter-track';
    const fill = document.createElement('i');
    fill.id = 'stat-drawer-super-fill';
    fill.className = 'super-meter-fill';
    setMeterFill(fill, meterVal);
    track.append(fill);
    const main = document.createElement('div');
    main.className = 'stat-drawer-super-main';
    main.append(titleWrap, track);
    top.append(icon, main);
    const desc = document.createElement('p');
    desc.className = 'stat-drawer-super-desc';
    desc.textContent = ability.desc || '';
    card.append(top, desc);
    if (ability.copies > 1) {
      const mastery = document.createElement('small');
      mastery.className = 'stat-drawer-super-mastery';
      mastery.textContent = `Mastery (${ability.copies}×): +${(ability.bonusTicks / 240).toFixed(1)}s duration · +${ability.bonusRefund}% meter refund`;
      card.append(mastery);
    }
    return card;
  }
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
    const superCard = renderDrawerSuperCard(entry, i);
    const box = renderStatsBox(stats[i] || entry.model.stats || {});
    statDrawer.dataset.player = i; statDrawer.dataset.side = i < 3 ? 'home' : 'away';
    statDrawer.replaceChildren(head, ...(superCard ? [superCard] : []), box);
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
    skaters = mountSkaterSprites($('skaters'), fieldView.entries, ubuRender, () => draw());
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
    const portraitRoster = $('portrait-roster');
    if (portraitRoster) {
      const makeGroup = (side, start) => {
        const group = document.createElement('div');
        group.className = `portrait-roster-group ${side}`;
        fieldView.entries.slice(start, start + 3).forEach((entry, offset) => {
          const i = start + offset;
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.id = `portrait-pill-${i}`;
          pill.className = 'portrait-pill';
          pill.dataset.team = side;
          pill.style.setProperty('--meter', '0%');
          const ring = document.createElement('span');
          ring.className = 'portrait-pill-ring';
          ring.append(ubuRender.spriteImg ? ubuRender.spriteImg(entry.model, 'portrait-pill-art', 96) : ubuRender(entry.model, 'portrait-pill-art'));
          const superImg = document.createElement('img');
          superImg.id = `portrait-super-${i}`;
          superImg.className = 'portrait-pill-super';
          const initialSuper = entry.equippedSuper || resolveEquippedSuper(entry, i);
          superImg.src = initialSuper?.icon || 'assets/00_stalwart.png';
          superImg.alt = initialSuper?.displayName || initialSuper?.name || '';
          const stateBadge = document.createElement('span');
          stateBadge.id = `portrait-state-${i}`;
          stateBadge.className = 'portrait-pill-state';
          stateBadge.setAttribute('aria-hidden', 'true');
          stateBadge.hidden = true;
          pill.append(ring, superImg, stateBadge);
          pill.onclick = () => {
            if (i < 3 && phase === 'plan' && !theater && !online?.spectating && selected !== i) {
              selected = i;
              sync();
              draw();
              return;
            }
            openStatDrawer(i);
          };
          group.append(pill);
        });
        return group;
      };
      portraitRoster.replaceChildren(makeGroup('home', 0), makeGroup('away', 3));
    }
  }
  function fitStadium() {
    if (!stageArea || !rinkStage || !rinkWrap) return;
    if (collectionShrinkingBox) {
      collectionLayout = null;
      visibleRinkHeight = 600;
      const { left: sx = 0, stageTop = 0, width: sw, length: sl, canvasH = 0 } = collectionShrinkingBox;
      const safeW = Math.max(1, sw);
      const vh = (typeof window !== 'undefined' && window.innerHeight) || document.documentElement?.clientHeight || 800;
      const visTop = Math.max(0, stageTop);
      const wrapH = canvasH > 0 ? canvasH : Math.max(120, Math.min(Math.round(safeW * sl / 600), vh));
      rinkStage.style?.setProperty?.('--shrink-left', `${sx}px`);
      rinkStage.style?.setProperty?.('--shrink-top', `${visTop}px`);
      rinkStage.style.width = `${Math.round(safeW)}px`;
      rinkStage.style.height = `${wrapH}px`;
      rinkWrap.style.width = '100%';
      rinkWrap.style.height = `${wrapH}px`;
      rinkWrap.style.marginBottom = '0px';
      rinkWrap.style.top = '';
      rinkWrap.style.left = '';
      rinkWrap.style.transform = '';
      fieldView.collectionPortrait = {
        length: sl,
        viewTop: Math.max(0, 600 * ((visTop - stageTop) / safeW)),
        viewSpan: 600 * (wrapH / safeW)
      };
      return;
    }
    if (shot === 'collection') {
      visibleRinkHeight = 600;
      rinkStage.style.width = '';
      rinkStage.style.height = '';
      const stageW = Math.max(120, rinkStage.clientWidth || stageArea.clientWidth || stadium?.clientWidth || 600);
      const minH = Math.round(stageW * 5 / 3);
      if (collectionRotateHold) {
        collectionLayout = null;
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
      const scrollTop = typeof window !== 'undefined' ? (window.scrollY || window.pageYOffset || 0) : 0;
      const stickyTop = stageRect.top < 0 && offsetPx < shownH - wrapH ? wrapRect.top : 0;
      collectionLayout = { stageW, shownH, wrapH, stageDocTop: stageRect.top + scrollTop, stickyTop };
      fieldView.collectionPortrait = {
        length: collectionShownLength,
        viewTop: 600 * (offsetPx / stageW),
        viewSpan: 600 * (wrapH / stageW)
      };
      return;
    }
    fieldView.collectionPortrait = null;
    collectionLayout = null;
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
    if (!fieldView.field) {
      updateFoulInfo();
      updateAimLoupe();
    }
    if (bench?.rec) bench.rec.drawMs += (performance.now() - _tDraw);
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
  addEventListener('pagehide', () => {
    flushScheduledSave();
    if (recording && !demo && (online?.active || inDiscord)) saveRecording();
    presenter.dispose?.();
  });
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
    $(`replay-${key}`).onclick = $(`guide-${key}`).onclick = e => {
      const picked = clickedSettingValue(e);
      guides[key] = picked ? picked === 'on' : !guides[key];
      showGuides();
      try { localStorage.setItem('ububall-guides', JSON.stringify(guides)); } catch {}
      draw();
    };
  }
  showGuides();
  const theaterController = createReplayTheater({
    $,
    window,
    document,
    P,
    ubu,
    ububallMatch,
    ububallReplay,
    gameUi,
    state,
    presenter,
    playback: { ...ububallPlayback, runPlaybackTicks, syncViewBodies },
    actions: {
      viewFouls: (f, seat) => viewFouls(f, seat),
      replayEvents: (turnObj, tick, sim) => replayEvents(turnObj, tick, sim),
      getReplayFx: () => replayFx,
      replayHitStop: th => replayHitStop(th),
      syncReplay: th => syncReplay(th),
      makeGuide: (sim, turnPlans, seat, gTurn, gScores) => makeGuide(sim, turnPlans, seat, gTurn, gScores),
      traceGuide: (sim, g) => traceGuide(sim, g),
      goalTab: (team, label, scorer) => goalTab(team, label, scorer),
      replayFileName: (recorded, title) => replayFileName(recorded, title),
      downloadReplay: (file, recorded, title) => downloadReplay(file, recorded, title),
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
      saveActiveMatch: st => saveActiveMatch(st),
      stopDemo: () => stopDemo(),
      closeSummary: () => closeSummary(),
      endGoalReplay: () => endGoalReplay(),
      showMode: m => showMode(m),
      enterMatch: next => enterMatch(next),
      setShot: next => setShot(next),
      updateHome: () => updateHome(),
      say: msg => say(msg),
      sync: () => sync(),
      draw: () => draw()
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
    ubuRender,
    gameUi,
    state,
    presenter,
    theater: theaterController,
    actions: {
      replayStore,
      libraryEntry: (r, file, auto) => libraryEntry(r, file, auto),
      viewTally: () => viewTally(),
      matchInProgress: () => matchInProgress(),
      finishCpuMatch: () => finishCpuMatch(),
      closeFirstTurnGuide: () => closeFirstTurnGuide(),
      closeSummary: () => closeSummary(),
      newMatch: playJingle => newMatch(playJingle),
      exitMatchMode: () => exitMatchMode()
    }
  });
  statsController.bindEvents();
  const {
    replayStats, renderStats, openMatchStats, openStats, downloadReplay, openReplay, openReplays, listReplays
  } = statsController;
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
  const { cancelScheduledSave, flushScheduledSave, scheduleSaveActiveMatch } = bindSpinSlider({ state });
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
  const liveSim = () => postGoal?.sim ?? simBodies;
  const liveView = cb => toViewBody(cb, liveSim(), 0);
  const syncLive = () => (typeof syncTickBodies === 'function' ? syncTickBodies(liveSim(), 0) : syncViewBodies(liveSim(), 0));
  const liveFx = {
    collide: contact => { syncLive(); handleCollision({ ...contact, a: liveView(contact.a), b: liveView(contact.b) }); },
    wall: (body, velocity, wallType, nx, ny, rimmed = false) => { syncLive(); handleWall(liveView(body), velocity, wallType, nx, ny, rimmed); },
    shockwave: (source, radius, type = null) => { syncLive(); handleShockwave(liveView(source), radius, type); },
    super: (key, stage, body, target = null) => { syncLive(); handleSuper(key, stage, liveView(body), target ? liveView(target) : null); }
  };
  const replaySkip = $('skip-goal-replay');
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
  const { postGoalState, frame } = createFrameLoop({ state });
  // The team screen: three positions in kickoff formation (Back by your goal, Top and Bottom
  // ahead), each with its ubu and equipped super. Picks fill empty positions in order; once the
  // team is full, a pick replaces the selected position and stays there.
  const POSITIONS = ['Back', 'Top', 'Bottom'];
  const canDrag = matchMedia('(pointer: fine)').matches;
  const node = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
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
      const hideGuestLabel = fixed && entry.label === 'Guest ubu' && Boolean(arch);
      const subLabel = !hideGuestLabel && entry.label && entry.label !== entry.model.parts.fullName
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
          teamHint(setupClassic()); rosterList.refreshRoles();
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
  function rosterSlots() {
    const classic = setupClassic(), locked = teamLocked(), fixed = fixedTeam();
    $('roster-dialog').toggleAttribute('data-locked', locked);
    $('roster-slots').replaceChildren(...draft.map((entry, i) => slotView(entry, i, classic, locked, fixed)));
    changedSlot = -1;
    teamHint(classic);
    rosterList.refreshRoles();
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
  async function adoptAccountTeam() {
    if (!signedIn() || online?.active || !onGuestTeam()) return;
    const entries = await accountTeam();
    if (!entries || online?.active || !onGuestTeam()) return;
    draft = entries;
    if (demo) newDemoGame(entries); else if (!matchInProgress()) newMatch(false, draft, { standby: true });
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
    if (sheetOpen()) {
      if (!event.detail?.owner && setupFor !== 'lobby') draft = [...guestTeam];
      void loadCollection();
      void loadTeams();
      const step = $('roster-dialog')?.dataset?.step;
      if (step === 'mode') setupStep('mode');
      else rosterSlots();
    }
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
      setSettingPill(btn, audioMode);
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
    audioModeBtn.onclick = e => {
      const picked = clickedSettingValue(e);
      audioMode = picked === 'stereo' || picked === 'mono' ? picked : (audioMode === 'stereo' ? 'mono' : 'stereo');
      updateAudioModeUI();
      window.ubuAudio?.setAudioMode?.(audioMode);
      try { localStorage.setItem('ububall-audio-mode', audioMode); } catch {}
    };
  }
  // The floating spin slider and touch aim aid are preferences kept per device.
  showSetting('setting-spin', spinSlider);
  $('setting-spin').onclick = e => {
    const picked = clickedSettingValue(e);
    spinSlider = picked ? picked === 'on' : !spinSlider;
    showSetting('setting-spin', spinSlider);
    try { localStorage.setItem('ububall-spin-slider', spinSlider ? 'on' : 'off'); } catch {}
    draw();
  };
  const touchAimSetting = $('setting-touch-aim');
  if (touchAimSetting) {
    setSettingPill(touchAimSetting, touchAim);
    touchAimSetting.onclick = e => {
      const picked = clickedSettingValue(e);
      touchAim = picked && TOUCH_AIM_MODES.includes(picked)
        ? picked
        : TOUCH_AIM_MODES[(TOUCH_AIM_MODES.indexOf(touchAim) + 1) % TOUCH_AIM_MODES.length];
      setSettingPill(touchAimSetting, touchAim);
      try { localStorage.setItem('ububall-touch-aim', touchAim); } catch {}
      updateAimLoupe();
    };
  }
  // Match setup: a mode screen (rules and CPU level), then the team screen where only the ubu list
  // scrolls. Online play borrows the mode screen, and its lobby is the same team screen with the
  // invite on top and Ready in place of Start.
  const chosenMode = () => ububallMatch.RULES.filter(rule => $('rule-' + rule).checked).join('-') || 'standard';
  const modeSummary = () => { $('mode-summary').textContent = ububallMatch.modeName(chosenMode()); };
  const cpuLevels = $('cpu-levels');
  const ballisticTier = cpuLevels.querySelector('[data-tier="ballistic"]');
  const ballisticRadio = ballisticTier.querySelector('input');
  const godRadio = cpuLevels.querySelector('[value="god"]');
  const checkedModels = new Map(), availableModels = new Set();
  let preferBallistic = false;
  cpuLevels.addEventListener('change', () => { preferBallistic = ballisticRadio.checked; });

  function hasBallisticWeights(mode) {
    return availableModels.has(ububallMatch.rule(mode, 'pulse'));
  }
  function syncBallisticOption() {
    const available = hasBallisticWeights(chosenMode());
    ballisticTier.hidden = !available;
    if (available && preferBallistic) ballisticRadio.checked = true;
    if (!available && ballisticRadio.checked) godRadio.checked = true;
  }
  function checkBallistic(mode) {
    const pulse = ububallMatch.rule(mode, 'pulse');
    if (!checkedModels.has(pulse)) {
      checkedModels.set(pulse, cpuClient.hasNeuralWeights(pulse).then(available => {
        if (available) availableModels.add(pulse);
        if (setupFor === 'cpu') syncBallisticOption();
        updateHome();
        return available;
      }));
    }
    return checkedModels.get(pulse);
  }
  for (const rule of ububallMatch.RULES) $('rule-' + rule).addEventListener('change', () => {
    modeSummary();
    if (rule === 'pulse' && setupFor === 'cpu') {
      syncBallisticOption();
      void checkBallistic(chosenMode());
    }
  });
  function openSetup(step, purpose = 'cpu', mode = cpuMode, level = cpuLevel, team = roster) {
    setupFor = purpose; resetSetupSlots();
    for (const rule of ububallMatch.RULES) $('rule-' + rule).checked = ububallMatch.rule(mode, rule);
    modeSummary();
    $('rules-status').textContent = '';
    if (purpose === 'rules') rulesGameNumber = online.state.gameNumber;
    preferBallistic = purpose === 'cpu' && level === 'ballistic';
    const levelRadio = document.querySelector(`input[name="cpu-level"][value="${level}"]`) || document.querySelector('input[name="cpu-level"][value="medium"]');
    if (levelRadio) levelRadio.checked = true;
    if (purpose === 'cpu') syncBallisticOption();
    draft = [...team]; rosterSlot = 0; $('roster-status').textContent = '';
    $('roster-scroll').scrollTop = 0;
    void loadCollection();
    setupStep(step);
    openSheet();
    if (purpose === 'cpu') void checkBallistic(mode);
  }
  // The online lobby. A guest seat fields the room's own three ubus; otherwise the player
  // picks from their collection, starting from their current, last or favorite team.
  const lobbyEntries = team => team.map((p, i) => {
    const model = ubu.decode(ubu.fromCode(p.dna));
    return { model, dna: p.dna, label: 'Guest ubu', key: 'online-' + i };
  });
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
      if (demo) newDemoGame(draft); else if (!matchInProgress()) newMatch(false, draft, { standby: true });
      return;
    }
    await startFromSetup($('start-match'));
  };
  $('sheet-start').onclick = () => startFromSetup($('sheet-start'));
  async function startFromSetup(button) {
    if (button.disabled || draft.some(entry => !entry)) return;
    const team = [...draft], mode = chosenMode(), level = document.querySelector('input[name="cpu-level"]:checked').value;
    if (level === 'ballistic' && !hasBallisticWeights(mode)) return;
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
      const canQuickPlay = saved.level !== 'ballistic' || await checkBallistic(saved.mode);
      if (online?.active || matchInProgress() || location.pathname !== '/' || sheetOpen()) return;
      const team = guestSetup && signedIn() ? roster : saved.team.map(entry => entry.dna ? restoreEntry(entry)
        : signedIn() ? restoreTeam([{ serial: entry.key, super: entry.equippedSuper?.id ?? null }]).team[0] : null);
      if (team.some(entry => !entry)) throw new Error('Last team unavailable');
      if (!canQuickPlay) { openSetup('mode', 'cpu', saved.mode, saved.level, team); return; }
      startCpuMatch(team, saved.mode, saved.level);
    } catch {
      if (location.pathname === '/' && !online?.active && !matchInProgress() && !sheetOpen()) {
        openSetup('team', 'cpu', saved.mode, saved.level);
        $('roster-status').textContent = 'Your last team is unavailable. Choose a team to start.';
      }
    } finally { button.disabled = false; }
  };
  $('demo-play').onclick = () => $('home-play').click();
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
  online = ububallOnline(onlineCallbacks);
  $('online-rematch').onclick = () => online.rematch();
  if (!inDiscord) {
    restoredMatch = restoreActiveMatch();
    if (!restoredMatch) newMatch(false, draft, { standby: true });
    if (isMatchShot()) fitOrientation();
    if (!restoredMatch && lastCpuSetup?.level === 'ballistic') void checkBallistic(lastCpuSetup.mode);
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
  const flushCollectionScroll = () => {
    collectionScrollRaf = 0;
    if (shot !== 'collection' || collectionRotateHold || bench?.flags.noCollectionScrollDraw) return;
    if (!layoutDirty && collectionLayout && fieldView.collectionPortrait) {
      const { stageW, shownH, wrapH, stageDocTop, stickyTop } = collectionLayout;
      const scrollTop = window.scrollY || window.pageYOffset || 0;
      const offsetPx = Math.max(0, Math.min(shownH - wrapH, scrollTop + stickyTop - stageDocTop));
      const nextViewTop = 600 * (offsetPx / stageW);
      if (Math.abs(nextViewTop - fieldView.collectionPortrait.viewTop) < 0.01) return;
      fieldView.collectionPortrait.viewTop = nextViewTop;
    }
    draw();
  };
  const scrollCollectionField = () => {
    if (shot !== 'collection' || collectionRotateHold || bench?.flags.noCollectionScrollDraw) return;
    if (collectionScrollRaf) return;
    if (typeof requestAnimationFrame === 'function') collectionScrollRaf = requestAnimationFrame(flushCollectionScroll);
    else flushCollectionScroll();
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
    setSettingPill(sidebarSetting, side);
  }
  sidebarSetting.onclick = e => {
    const picked = clickedSettingValue(e);
    sidebarSide = picked === 'left' || picked === 'right' ? picked : (stadium.dataset.controlsSide === 'left' ? 'right' : 'left');
    try { localStorage.setItem('ububall.controls-side', sidebarSide); } catch {}
    updateTopSide();
  };
  updateTopSide(); screen.orientation?.addEventListener('change', updateTopSide);
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
  const { placeFinger, hideFinger, demoAim } = createDemoFingerController({ state });
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
        cssH: fieldView.canvas.clientHeight,
        ...(presenter.getRendererInfo ? presenter.getRendererInfo() : {})
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
          await window.navigateUbuScreen('/?bench=1');
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
                ability: typeof ability !== 'undefined' ? ability.scoreAbility(model) : null,
                issuedAt: '2026-11-12T00:00:00Z',
                favorite: i < 4
              });
            }
            collectionSeeded = true;
          }
          if (typeof window.navigateUbuScreen === 'function') await window.navigateUbuScreen('/collection?bench=1');
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
          await window.navigateUbuScreen('/?bench=1');
          window.scrollTo(0, 0);
        }
        await this.enterMatchBench();
        newMatch(false);
      }
    };
    if (typeof document !== 'undefined' && document.head) {
      const s = document.createElement('script');
      s.src = 'ububall-bench.js';
      s.async = false;
      document.head.append(s);
    }
  }
})();
