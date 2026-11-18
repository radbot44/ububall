/* Direct require-based tests for web/ububall-theater.js (replay theater, export slicing, offline audio, takeover). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../shared/ububall-physics.js');
const ububallMatch = require('../shared/ububall-match.js');
const ububallReplay = require('../shared/ububall-replay.js');
const ubu = require('../shared/ubu.js');
const ububallPresentation = require('../web/ububall-presentation.js');
const ububallPlayback = require('../web/ububall-playback.js');
const ububallStats = require('../web/ububall-stats.js');
const ububallTheater = require('../web/ububall-theater.js');
const { createEffectsState } = ububallPresentation;

test('ububall-theater: pure helpers (replayClock, anonymousName, rangeLabel, winningTurn, offlineAudio)', () => {
  assert.equal(ububallTheater.replayClock(0, P.DT), '0:00');
  assert.equal(ububallTheater.replayClock(240 * 75, P.DT), '1:15');
  assert.equal(ububallTheater.anonymousName(ububallReplay, 0), 'Saffron 1');
  assert.equal(ububallTheater.anonymousName(ububallReplay, 5), 'Amethyst 3');

  const fakeReplay = {
    turns: [
      { turn: 1, scores: [0, 0], goal: null },
      { turn: 2, scores: [0, 0], goal: { team: 0 } },
      { turn: 3, scores: [4, 2], goal: { team: 0 } }
    ]
  };
  assert.equal(ububallTheater.rangeLabel(fakeReplay, 'turn', 0, 0), 'Turn 1');
  assert.equal(ububallTheater.rangeLabel(fakeReplay, 'round', 0, 1), 'Round 1 · Turns 1–2');
  assert.equal(ububallTheater.winningTurn(fakeReplay.turns[1]), false);
  assert.equal(ububallTheater.winningTurn(fakeReplay.turns[2]), true);

  let chainedCtx = null;
  const fanfareCalls = [];
  const audio = ububallTheater.offlineAudio({
    shareMasterChain: ctx => { chainedCtx = ctx; },
    stopMotion: () => {},
    playBallHit: opts => opts,
    playFanfare: (voice, ctx, onNote, opts) => { fanfareCalls.push({ voice, ctx, onNote, opts }); }
  }, { sampleRate: 48000 }, () => 4.5);

  assert.equal(chainedCtx.currentTime, 4.5);
  assert.equal(audio.playBallHit({ snap: true }).ctx, chainedCtx);
  audio.playFanfare({ pitch: 220 }, null, null, { loop: true, volume: 0.7 });
  assert.equal(fanfareCalls[0].ctx, chainedCtx);
  assert.equal(fanfareCalls[0].opts.loop, false, 'offline export forces non-looping fanfare');
});

test('ububall-theater: watchReplay, seekReplay, advanceReplay, exportSlice, withPlaybackContext isolation, and playFromHere takeover', () => {
  const ubus = Array.from({ length: 6 }, (_, i) => ({ dna: ubu.toCode(ubu.randomDNA()), super: i % 8 }));
  const rec = ububallReplay.create({ mode: 'standard', seat: 1, names: ['Host', 'Guest'], ubus });
  rec.title = 'Rivalry Match';

  const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };
  const b1 = P.kickoff();
  b1.slice(0, 6).forEach(b => P.applyStats(b, normal));
  b1[3].x = 760; b1[3].y = 410; b1[3].carded = true;
  const plans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0.4, spin: 0, superArm: false, guard: false }));

  const t1 = ububallReplay.addTurn(rec, {
    turn: 1,
    scores: [0, 1],
    fouls: { ...ububallMatch.newFouls(), crease: [true, false], corner: 0, cornerTurns: 1 },
    bodies: b1,
    plans
  });
  t1.ticks = 20;
  t1.saves = [];
  t1.stops = [];
  t1.goal = { team: 1, label: 'SNIPE!', scorer: 3, assist: null };

  const t2 = ububallReplay.addTurn(rec, {
    turn: 2,
    scores: [0, 2],
    fouls: ububallMatch.newFouls(),
    bodies: P.kickoff(),
    plans
  });
  t2.ticks = 16;
  t2.saves = [];
  t2.stops = [];
  t2.goal = null;

  const dummy = () => {};
  const els = new Map();
  const $ = id => {
    if (!els.has(id)) {
      els.set(id, {
        value: '1', max: 0, textContent: '', hidden: false, disabled: false, checked: false,
        style: {}, dataset: {},
        classList: { toggle: dummy, add: dummy, remove: dummy },
        setAttribute: dummy, replaceChildren: dummy, matches: () => false,
        addEventListener: dummy, closest: () => ({ hidden: false }), querySelectorAll: () => []
      });
    }
    return els.get(id);
  };

  let theater = null, activePlayback = null, videoAudio = null, videoClock = null, hitStopUntil = 0, clock = 1000;
  let shot = 'home', phase = 'plan', scores = [0, 0], turn = 1, fouls = ububallMatch.newFouls();
  let roster = [], simBodies = P.kickoff(), plansState = [], guide = null, recording = null;
  let fieldView = { mode: 'standard', anonymous: false, portrait: false, entries: [], bodies: P.kickoff() };
  let fieldEffects = ububallPresentation.createEffectsState([], {});

  const shownSim = () => (activePlayback || theater)?.sim ?? simBodies;
  const shownSeat = () => (activePlayback || theater)?.seat ?? 0;

  const projector = ububallPlayback.createBodyProjector({
    P,
    getEntries: () => fieldView.entries,
    getAnonymous: () => Boolean(fieldView.anonymous),
    anonymousName: i => ububallTheater.anonymousName(ububallReplay, i),
    isClassicMode: () => ububallMatch.rule(fieldView.mode, 'classic'),
    resolveEquippedSuper: (e, i) => e?.equippedSuper || P.SUPERS[i % 8],
    getShownSim: shownSim,
    getShownSeat: shownSeat,
    getTargetBodies: () => fieldView.bodies
  });

  const driver = ububallPlayback.createPlaybackDriver({
    P,
    ububallMatch,
    clockNow: () => videoClock ?? activePlayback?.clock ?? clock,
    impact: ms => { hitStopUntil = clock + ms; },
    creditSave: dummy,
    popup: dummy,
    getBallView: () => fieldView.bodies[6],
    traceGuide: dummy,
    recordTrails: dummy
  });

  const makeGuide = (sim, turnPlans, seat, gTurn, gScores) => {
    const start = projector.viewBodies(sim, seat);
    return {
      turn: gTurn, goals: gScores[0] + gScores[1], seat, ticks: 0, start,
      paths: start.map(b => [b.x, b.y]),
      moves: ububallPlayback.onlineOrder(turnPlans, seat).map(p => ({ ...p, angle: p.angle + (seat ? Math.PI : 0) }))
    };
  };

  const ctrl = ububallTheater.createReplayTheater({
    $,
    window: {},
    document: {
      body: { dataset: {}, classList: { toggle: dummy } },
      createElement: () => ({ style: {}, setAttribute: dummy, getContext: () => ({}) })
    },
    navigator: null,
    localStorage: { getItem: () => null, setItem: dummy },
    getComputedStyle: () => ({ fontFamily: 'sans-serif' }),
    P,
    ubu,
    ububallMatch,
    ububallReplay,
    gameUi: { select: dummy },
    createEffectsState: ububallPresentation.createEffectsState,
    onlineOrder: ububallPlayback.onlineOrder,
    viewIndex: ububallPlayback.viewIndex,
    stripPresentation: ububallPlayback.stripPresentation,
    transformSimSeat: ububallPlayback.transformSimSeat,
    viewFouls: (f, s) => ububallPlayback.viewFouls(ububallMatch, f, s),
    runPlaybackTicks: driver.runPlaybackTicks,
    replayEvents: dummy,
    getReplayFx: () => ({ hit: dummy, wall: dummy, shock: dummy, super: dummy }),
    replayHitStop: th => th.fx?.hitStopUntil ?? hitStopUntil,
    syncReplay: th => projector.syncViewBodies(th ? th.sim : shownSim(), th ? th.seat : shownSeat(), th?.bodies || fieldView.bodies, th?.anonymous, null, th?.entries),
    makeGuide,
    traceGuide: dummy,
    recordTrails: dummy,
    trailPositions: () => fieldView.bodies.map(b => ({ x: b.x, y: b.y })),
    clearDiscontinuousTrails: dummy,
    emitSkaterEffects: dummy,
    updatePopups: dummy,
    updateEffects: dummy,
    clearEffects: dummy,
    celebrate: dummy,
    loopFanfare: dummy,
    stopFanfare: dummy,
    quench: dummy,
    lightNet: dummy,
    ballOnFire: () => false,
    popup: dummy,
    goalTab: dummy,
    replayFileName: ububallStats.replayFileName,
    downloadReplay: dummy,
    rinkLogo: null,
    getThemeColors: () => ({ home: '#f00', away: '#00f', text: '#fff', surface: '#111', background: '#000' }),
    getSkaters: () => [],
    clockNow: () => videoClock ?? activePlayback?.clock ?? clock,
    gameAudio: () => null,
    classicMode: () => false,
    normalStats: () => normal,
    idlePlan: () => ({ angle: 0, power: 0, spin: 0, guard: false }),
    resolveEquippedSuper: (e, i) => e?.equippedSuper || P.SUPERS[i % 8],
    kickoff: () => { simBodies = P.kickoff(); projector.syncViewBodies(simBodies, 0); return fieldView.bodies; },
    buildTeam: dummy,
    resetPlans: dummy,
    saveRecording: dummy,
    saveActiveMatch: dummy,
    stopDemo: dummy,
    closeSummary: dummy,
    endGoalReplay: dummy,
    showMode: dummy,
    enterMatch: next => { shot = next; },
    setShot: next => { shot = next; },
    updateHome: dummy,
    bumpCpuGeneration: dummy,
    say: dummy,
    sync: dummy,
    draw: dummy,
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
    setCardShot: dummy,
    markLayoutDirty: dummy,
    setHitStopUntil: next => { hitStopUntil = next; },
    getShot: () => shot,
    getScores: () => scores,
    getTurn: () => turn,
    syncShownScores: dummy,
    setFouls: next => { fouls = next; },
    onWatchReplayLoaded: () => { phase = 'replay'; },
    onEndReplayState: () => { phase = 'over'; recording = null; },
    onLoadReplayTurnState: ({ scores: sc, turn: tn, plans: pl, guide: gd }) => {
      scores = sc; turn = tn; plansState = pl; guide = gd;
    },
    onPlayFromHereState: ({ roster: r, simBodies: sb, scores: sc, turn: tn, fouls: fl, recording: nextRec }) => {
      roster = r; simBodies = sb; projector.syncViewBodies(simBodies, 0);
      scores = sc; turn = tn; fouls = fl; recording = nextRec; phase = 'plan';
    }
  });
  ctrl.bindEvents();

  // 1. watchReplay loads Seat-1 replay with reversed names and initial scores [1, 0]
  ctrl.watchReplay(rec, new Uint8Array([9, 9]));
  assert.equal(shot, 'replay');
  assert.equal(phase, 'replay');
  assert.equal($('home-label').textContent, 'Guest');
  assert.deepEqual(scores, [1, 0]);

  // 2. exportSlice produces whole file when unhidden, anonymized copy when hidden, and clipped turn slice
  const whole = ctrl.exportSlice('match', false);
  assert.equal(whole.replay, rec);
  assert.ok(whole.file instanceof Uint8Array);

  const privTurn = ctrl.exportSlice('turn', true);
  assert.equal(privTurn.replay.anonymous, true);
  assert.equal(privTurn.replay.turns.length, 1);
  assert.equal(privTurn.file, null);

  // 3. Offscreen export session runs inside withPlaybackContext without mutating interactive theater
  ctrl.seekReplay(10);
  const interactiveTick = theater.tick;
  const exportSession = ctrl.createReplaySession(rec, { exporting: true, anonymous: true, clock: 0 });
  ctrl.seekReplay(0, exportSession);
  ctrl.advanceReplay(1 / 60, exportSession);
  assert.equal(theater.tick, interactiveTick, 'export session stepping leaves interactive theater untouched');
  assert.equal(exportSession.entries[0].model.parts.fullName, 'Saffron 1');

  // 4. playFromHere converts Seat-1 turn state cleanly into a local Seat-0 CPU match
  ctrl.playFromHere();
  assert.equal(theater, null);
  assert.equal(shot, 'match');
  assert.equal(phase, 'plan');
  assert.deepEqual(scores, [1, 0]);
  assert.equal(simBodies[0].carded, true, 'Seat-1 server body 3 mapped to local simBodies[0]');
  assert.equal(roster.length, 3);
  assert.ok(recording, 'starts fresh local replay recording');
});

test('ububall-theater: createMatchSession drives createReplayTheater, createRinkPresenter, and createBodyProjector without callback bags', () => {
  const ubus = Array.from({ length: 6 }, (_, i) => ({ dna: ubu.toCode(ubu.randomDNA()), super: i % 8 }));
  const rec = ububallReplay.create({ mode: 'standard', seat: 1, names: ['Alpha', 'Beta'], ubus });
  const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };
  const b1 = P.kickoff();
  b1.slice(0, 6).forEach(b => P.applyStats(b, normal));
  b1[3].x = 760; b1[3].y = 410; b1[3].carded = true;
  const plans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0.4, spin: 0, superArm: false, guard: false }));
  const t1 = ububallReplay.addTurn(rec, {
    turn: 1,
    scores: [0, 1],
    fouls: { ...ububallMatch.newFouls(), crease: [true, false], corner: 0, cornerTurns: 1 },
    bodies: b1,
    plans
  });
  t1.ticks = 20;
  t1.saves = [];
  t1.stops = [];
  t1.goal = null;

  const dummy = () => {};
  const els = new Map();
  const $ = id => {
    if (!els.has(id)) {
      els.set(id, {
        value: '1', max: 0, textContent: '', hidden: false, disabled: false, checked: false,
        style: {}, dataset: {},
        classList: { toggle: dummy, add: dummy, remove: dummy },
        setAttribute: dummy, replaceChildren: dummy, matches: () => false,
        addEventListener: dummy, closest: () => ({ hidden: false }), querySelectorAll: () => []
      });
    }
    return els.get(id);
  };
  let cpuCancelled = 0;
  const doc = {
    body: { dataset: {}, classList: { toggle: dummy } },
    createElement: () => ({ style: {}, setAttribute: dummy, getContext: () => ({}) })
  };
  const state = ububallPlayback.createMatchSession({
    fieldView: { mode: 'standard', anonymous: false, portrait: false, entries: [], bodies: P.kickoff() },
    fieldEffects: ububallPresentation.createEffectsState([], {}),
    dirtyMeters: new Set(),
    simBodies: P.kickoff(),
    fouls: ububallMatch.newFouls(),
    cpuClient: { cancel() { cpuCancelled++; }, dispose: dummy }
  });

  const shownSim = () => (state.activePlayback || state.theater)?.sim ?? state.simBodies;
  const shownSeat = () => (state.activePlayback || state.theater)?.seat ?? 0;
  const projector = ububallPlayback.createBodyProjector({
    P,
    state,
    anonymousName: i => ububallTheater.anonymousName(ububallReplay, i),
    isClassicMode: () => ububallMatch.rule(state.fieldView.mode, 'classic'),
    resolveEquippedSuper: (e, i) => e?.equippedSuper || P.SUPERS[i % 8],
    getShownSim: shownSim,
    getShownSeat: shownSeat
  });
  const presenter = ububallPresentation.createRinkPresenter({
    P,
    ububallMatch,
    ububallReplay,
    state,
    clockNow: () => 1000,
    gameAudio: () => null,
    anonymousName: i => ububallTheater.anonymousName(ububallReplay, i)
  });
  const driver = ububallPlayback.createPlaybackDriver({
    P,
    ububallMatch,
    clockNow: () => state.videoClock ?? state.activePlayback?.clock ?? 1000,
    impact: ms => { state.hitStopUntil = 1000 + ms; },
    creditSave: dummy,
    popup: dummy,
    getBallView: () => state.fieldView.bodies[6],
    traceGuide: dummy,
    recordTrails: () => presenter.recordTrails()
  });

  const ctrl = ububallTheater.createReplayTheater({
    $,
    document: doc,
    localStorage: { getItem: () => null, setItem: dummy },
    getComputedStyle: () => ({ fontFamily: 'sans-serif' }),
    P,
    ubu,
    ububallMatch,
    ububallReplay,
    gameUi: { select: dummy },
    state,
    presenter,
    playback: { ...ububallPlayback, runPlaybackTicks: driver.runPlaybackTicks, syncViewBodies: projector.syncViewBodies },
    actions: {
      replayEvents: dummy,
      getReplayFx: () => ({ hit: dummy, wall: dummy, shock: dummy, super: dummy }),
      replayHitStop: th => th.fx?.hitStopUntil ?? state.hitStopUntil,
      syncReplay: th => projector.syncViewBodies(th ? th.sim : shownSim(), th ? th.seat : shownSeat(), th?.bodies || state.fieldView.bodies, th?.anonymous, null, th?.entries),
      makeGuide: (sim, turnPlans, seat, gTurn, gScores) => {
        const start = projector.viewBodies(sim, seat);
        return {
          turn: gTurn, goals: gScores[0] + gScores[1], seat, ticks: 0, start,
          paths: start.map(b => [b.x, b.y]),
          moves: ububallPlayback.onlineOrder(turnPlans, seat).map(p => ({ ...p, angle: p.angle + (seat ? Math.PI : 0) }))
        };
      },
      traceGuide: dummy,
      goalTab: dummy,
      replayFileName: ububallStats.replayFileName,
      downloadReplay: dummy,
      clockNow: () => state.videoClock ?? state.activePlayback?.clock ?? 1000,
      gameAudio: () => null,
      classicMode: () => false,
      normalStats: () => normal,
      idlePlan: () => ({ angle: 0, power: 0, spin: 0, guard: false }),
      resolveEquippedSuper: (e, i) => e?.equippedSuper || P.SUPERS[i % 8],
      kickoff: () => { state.simBodies = P.kickoff(); projector.syncViewBodies(state.simBodies, 0); return state.fieldView.bodies; },
      buildTeam: dummy,
      resetPlans: dummy,
      saveRecording: dummy,
      saveActiveMatch: dummy,
      stopDemo: dummy,
      closeSummary: dummy,
      endGoalReplay: dummy,
      showMode: dummy,
      enterMatch: next => state.setShot(next, doc),
      updateHome: dummy,
      say: dummy,
      sync: dummy,
      draw: dummy
    }
  });
  ctrl.bindEvents();

  ctrl.watchReplay(rec, null);
  assert.equal(state.shot, 'replay');
  assert.equal(doc.body.dataset.shot, 'replay');
  assert.equal(state.phase, 'replay');
  assert.equal(state.cpuGeneration, 1);
  assert.equal(cpuCancelled, 1);
  assert.deepEqual(state.scores, [1, 0]);
  assert.deepEqual(state.shownScores, [1, 0]);

  ctrl.playFromHere();
  assert.equal(state.theater, null);
  assert.equal(state.shot, 'match');
  assert.equal(state.phase, 'plan');
  assert.equal(state.simBodies[0].carded, true);
  assert.equal(state.roster.length, 3);
  assert.ok(state.recording);

  ctrl.watchReplay(rec, null);
  ctrl.endReplay();
  assert.equal(state.theater, null);
  assert.equal(state.phase, 'over');
  assert.equal(state.recording, null);
});

test('video export isolates playback session from interactive theater object', () => {
  const theater = { replay: { title: 'match' }, starts: [0], total: 100, index: 0, tick: 10, sim: [{ x: 100 }] };
  const context = ububallPlayback.wrapSessionState({
    theater, goalReplay: null, onlineReplay: null
  });
  assert.equal(context.currentReplay(), theater, 'interactive theater is active by default');

  const session = { replay: { title: 'slice' }, sim: [{ x: 500 }] };
  context.activePlayback = session;
  assert.equal(context.currentReplay(), session, 'export session routes replay simulation');
  assert.equal(context.shownSim(), session.sim, 'shownSim reads export session simulation');
  assert.equal(theater.replay.title, 'match', 'interactive theater replay object is preserved untouched');
});

test('replay takeover (watchReplay -> playFromHere -> local turn) transforms simulation state without display contamination', () => {
  const P = require('../shared/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');

  const ubus = Array.from({ length: 6 }, (_, i) => {
    const dna = ubu.toCode(ubu.randomDNA());
    return { dna, super: i % 8 };
  });
  const rec = ububallReplay.create({ mode: 'standard', seat: 1, names: ['Host', 'Challenger'], ubus });
  const initialSim = P.kickoff();
  initialSim[0].x = 210; initialSim[0].y = 190; initialSim[0].meter = 25;
  initialSim[3].x = 770; initialSim[3].y = 420; initialSim[3].meter = 65; initialSim[3].stunnedNext = true; initialSim[3].carded = true;
  initialSim[6].x = 520; initialSim[6].y = 280; initialSim[6].strikerTeam = 1;
  const turnPlans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0.4, spin: 0, superArm: false, guard: false }));
  const t = ububallReplay.addTurn(rec, {
    turn: 3,
    scores: [1, 2],
    fouls: { ...ububallMatch.newFouls(), crease: [true, false], corner: 0, cornerTurns: 1 },
    bodies: initialSim,
    plans: turnPlans
  });
  t.ticks = 30;

  const dummy = () => {};
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '1', textContent: '', hidden: false, disabled: false,
        classList: { toggle: dummy, add: dummy, remove: dummy },
        setAttribute: dummy, replaceChildren: dummy
      });
    }
    return elements.get(id);
  };
  const context = {
    P, ubu, ububallMatch, ububallReplay,
    $,
    document: { body: { classList: { toggle: dummy, add: dummy, remove: dummy } } },
    saveRecording: dummy, stopDemo: dummy, closeSummary: dummy, endGoalReplay: dummy,
    stopFanfare: dummy, gameAudio: () => null, saveActiveMatch: dummy,
    cpuGeneration: 0, cpuClient: { cancel: dummy }, videoLogo: dummy,
    showMode: dummy, classicMode: () => false, normalStats: () => ({}),
    resolveEquippedSuper: (entry, i) => entry?.equippedSuper || P.SUPERS[i % P.SUPERS.length],
    anonymousName: i => `Anon ${i}`, anonymousNames: false,
    buildTeam: dummy, replayMarks: dummy, enterMatch: dummy, updateReplayBar: dummy,
    clearEffects: dummy, resetPlans: dummy, say: dummy, sync: dummy, draw: dummy,
    recordTrails: dummy, emitSkaterEffects: dummy, updatePopups: dummy, updateEffects: dummy,
    replayEvents: dummy,
    replayFx: { hit: dummy, wall: dummy, shock: dummy, super: dummy },
    videoAudio: null, videoClock: null, clockNow: () => 1000, hitStopUntil: 0,
    shownScores: [0, 0], scores: [0, 0], turn: 1, phase: 'plan',
    matchMode: 'standard', roster: [], teamEntries: [], stats: [], plans: [],
    fouls: ububallMatch.newFouls(), play: ububallMatch.newPlay(), tally: ububallMatch.newTally(),
    roundTurns: 0, matchTicks: 0, playSegments: [], selected: 0, drag: null, elapsed: 0, accumulator: 0,
    recording: null, theater: null, online: null, onlineReplay: null, goalReplay: null, postGoal: null,
    authoritativeBodies: null, kickoffGlow: 0, netFire: null, dirtyMeters: new Set(),
    bodies: P.kickoff(), simBodies: P.kickoff()
  };

  const env = ububallPlayback.bindMatchHarness(context, { withTheater: true, ububallTheater, createEffectsState });

  const displayRefs = [...context.bodies];

  // 1. Watch seat-1 replay
  env.watchReplay(rec, null);
  assert.equal(context.phase, 'replay');
  assert.ok(context.theater, 'theater active during watchReplay');
  assert.equal(context.theater.seat, 1);

  // 2. Take over from replay (playFromHere)
  env.playFromHere();
  assert.equal(context.theater, null, 'theater cleared on takeover');
  assert.equal(context.phase, 'plan');
  assert.deepEqual([...context.scores], [2, 1], 'scores flipped from seat 1 to local seat 0');
  assert.deepEqual([...context.fouls.crease], [false, true], 'crease fouls flipped to local seat 0');
  assert.equal(context.fouls.corner, 3, 'corner flipped to local seat 0');
  assert.equal(context.simBodies[0].carded, true, 'carded skater index 3 mapped to local simBodies[0]');

  // Display references remain identical
  for (let i = 0; i < 7; i++) {
    assert.equal(context.bodies[i], displayRefs[i], `bodies[${i}] reference preserved across watchReplay -> playFromHere`);
  }

  // Authoritative simBodies is pure simulation state in seat-0 coordinates (never passed through projectBody)
  assert.notEqual(context.simBodies, context.bodies);
  assert.equal(context.simBodies[0].x, 1000 - 770, 'seat-1 skater 3 transformed to seat-0 simBodies[0].x');
  assert.equal(context.simBodies[0].y, 600 - 420, 'seat-1 skater 3 transformed to seat-0 simBodies[0].y');
  assert.equal(context.simBodies[0].meter, 65);
  assert.equal(context.simBodies[0].stunnedNext, true, 'stunnedNext preserved on simBodies[0]');
  assert.equal(context.simBodies[3].x, 1000 - 210, 'seat-1 skater 0 transformed to seat-0 simBodies[3].x');
  assert.equal(context.simBodies[6].x, 1000 - 520, 'ball x transformed to local seat-0 simBodies[6].x');
  assert.equal(context.simBodies[6].strikerTeam, 0, 'ball strikerTeam 1 flipped to 0');

  // Verify no display-only keys leaked into simBodies
  for (let i = 0; i < 7; i++) {
    assert.equal('name' in context.simBodies[i], false, `simBodies[${i}] has no name`);
    assert.equal('voice' in context.simBodies[i], false, `simBodies[${i}] has no voice`);
    assert.equal('playerIndex' in context.simBodies[i], false, `simBodies[${i}] has no playerIndex`);
    assert.equal('meterTick' in context.simBodies[i], false, `simBodies[${i}] has no meterTick`);
  }
  assert.deepEqual(
    Object.keys(context.simBodies[0].equippedSuper).sort(),
    ['bonusRefund', 'bonusTicks', 'id', 'key'],
    'simBodies equippedSuper carries only minimal simulation fields, not full UI description/label'
  );

  // 3. Play a local turn from the taken-over state
  const launchPlans = Array.from({ length: 6 }, (_, i) => ({
    angle: i === 1 ? 0 : 0.5,
    power: i === 1 ? 0.8 : 0.2,
    spin: 0,
    superArm: false,
    guard: false
  }));
  P.startTurn(context.simBodies, launchPlans);
  const tick = ububallMatch.playTick(P, context.simBodies, context.play, {}, context.tally);
  env.syncViewBodies(context.simBodies, 0);
  assert.equal(tick.goal, null);
  assert.equal(context.bodies[1].x, context.simBodies[1].x, 'display body tracks stepped simulation body after takeover');
  assert.equal('name' in context.simBodies[1], false, 'simulation body remains free of presentation keys during play');
});

function createReplayExportHarness({ seat = 0, mode = 'standard' } = {}) {
  const P = require('../shared/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');
  const ububallMP4 = require('../web/mp4.js');

  const ubus = Array.from({ length: 6 }, (_, i) => {
    const dna = ubu.toCode(ubu.randomDNA());
    return { dna, super: i % 8 };
  });
  const rec = ububallReplay.create({ mode, seat, names: ['Solaris', 'Nebula'], ubus });
  rec.title = 'Championship Clip';

  const t1Bodies = P.kickoff();
  t1Bodies[0].x = 240; t1Bodies[0].y = 300; t1Bodies[0].meter = 40;
  t1Bodies[3].x = 760; t1Bodies[3].y = 300; t1Bodies[3].meter = 60;
  t1Bodies[6].x = 480; t1Bodies[6].y = 300;
  const t1Plans = [
    { angle: 0, power: 0.8, spin: 0.2, superArm: false, guard: false },
    { angle: 0.2, power: 0.4, spin: 0, superArm: false, guard: true },
    { angle: -0.2, power: 0.4, spin: 0, superArm: false, guard: false },
    { angle: Math.PI, power: 0.7, spin: -0.1, superArm: false, guard: false },
    { angle: Math.PI, power: 0.3, spin: 0, superArm: false, guard: false },
    { angle: Math.PI, power: 0.3, spin: 0, superArm: false, guard: false }
  ];
  const turn1 = ububallReplay.addTurn(rec, {
    turn: 1,
    scores: [0, 0],
    fouls: { ...ububallMatch.newFouls(), crease: [true, false], corner: 0, cornerTurns: 2 },
    bodies: t1Bodies,
    plans: t1Plans
  });
  turn1.ticks = 16;
  turn1.saves = [{ tick: 4, index: 1, own: false, iron: true }];
  turn1.stops = [{ tick: 8, ms: 80 }];
  turn1.goal = { team: 0, label: 'SNIPE!', scorer: 0, assist: 1 };

  const t2Bodies = P.kickoff();
  t2Bodies[0].meter = 55;
  t2Bodies[3].meter = 70;
  const turn2 = ububallReplay.addTurn(rec, {
    turn: 2,
    scores: [1, 0],
    fouls: ububallMatch.newFouls(),
    bodies: t2Bodies,
    plans: t1Plans
  });
  turn2.ticks = 12;
  turn2.goal = null;

  const dummy = () => {};
  const makeCtx = () => {
    const calls = { fillTexts: [], strokeTexts: [], drawImages: 0, clearRects: 0 };
    return new Proxy(calls, {
      get(target, prop) {
        if (prop === 'fillText') return text => { calls.fillTexts.push(String(text)); };
        if (prop === 'strokeText') return text => { calls.strokeTexts.push(String(text)); };
        if (prop === 'drawImage') return () => { calls.drawImages++; };
        if (prop === 'clearRect') return () => { calls.clearRects++; };
        if (prop in target) return target[prop];
        if (prop === 'measureText') return text => ({ width: String(text).length * 10 });
        if (prop === 'getTransform') return () => ({ a: 1 });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createConicGradient') {
          return () => ({ addColorStop: dummy });
        }
        return dummy;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    });
  };
  const makeCanvas = () => {
    const c = { width: 1000, height: 600, _ctx: makeCtx(), toBlob: cb => cb(new Uint8Array([1, 2, 3])) };
    c.getContext = () => c._ctx;
    return c;
  };
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) {
      const base = id === 'share-card' ? makeCanvas() : {};
      elements.set(id, Object.assign(base, {
        value: '1', max: 0, textContent: '', hidden: false, disabled: false, checked: false, closed: false,
        classList: { toggle: dummy, add: dummy, remove: dummy, contains: () => false },
        setAttribute: dummy, replaceChildren: dummy, matches: () => false,
        addEventListener: dummy,
        closest: () => ({ hidden: false }),
        querySelectorAll: () => [],
        showModal() { this.closed = false; },
        close() { this.closed = true; },
        click: dummy
      }));
    }
    return elements.get(id);
  };

  let wallClock = 5000;
  const liveCanvas = makeCanvas(), liveBadges = makeCanvas();
  const encoderState = {
    instances: [],
    audioInstances: [],
    failWith: null,
    onEncode: null,
    onConfigCheck: null,
    audioFailWith: null
  };

  class MockVideoEncoder {
    constructor({ output, error }) {
      this.output = output;
      this.error = error;
      this.state = 'unconfigured';
      this.encodeQueueSize = 0;
      this.frames = 0;
      this.closed = false;
      encoderState.instances.push(this);
    }
    static async isConfigSupported(config) {
      if (encoderState.onConfigCheck) await encoderState.onConfigCheck(config);
      return { supported: true, config };
    }
    configure() { this.state = 'configured'; }
    encode(frame, opts) {
      this.frames++;
      if (encoderState.onEncode) encoderState.onEncode(this.frames, this);
      if (encoderState.failWith) {
        this.error(encoderState.failWith);
        return;
      }
      const bytes = new Uint8Array([this.frames & 0xff]);
      this.output({
        byteLength: bytes.byteLength,
        type: opts?.keyFrame ? 'key' : 'delta',
        copyTo: dst => dst.set(bytes)
      }, { decoderConfig: { description: new Uint8Array([1, 2, 3, 4]) } });
    }
    async flush() {
      if (encoderState.failWith) throw encoderState.failWith;
    }
    close() {
      this.state = 'closed';
      this.closed = true;
    }
    addEventListener() {}
  }

  class MockOfflineAudioContext {
    constructor(channels, length, sampleRate) {
      this.length = length;
      this.sampleRate = sampleRate;
      this.currentTime = 0;
      this.destination = {};
      this.state = 'suspended';
      this.suspends = [];
      this.resumeCount = 0;
      this._finishRender = null;
      this._rejectRender = null;
      this.renderingDone = false;
      encoderState.audioInstances.push(this);
    }
    suspend(mark) {
      return new Promise(resolve => {
        this.suspends.push({ mark, resolve });
        this.suspends.sort((a, b) => a.mark - b.mark);
      });
    }
    _advance() {
      if (this.suspends.length > 0) {
        const next = this.suspends.shift();
        this.currentTime = next.mark;
        this.state = 'suspended';
        next.resolve();
        return;
      }
      this.state = 'closed';
      this.renderingDone = true;
      if (this._finishRender) {
        const finish = this._finishRender;
        this._finishRender = null;
        finish({
          sampleRate: this.sampleRate,
          length: 480,
          getChannelData: () => new Float32Array(480)
        });
      }
    }
    resume() {
      this.resumeCount++;
      this.state = 'running';
      Promise.resolve().then(() => this._advance());
      return Promise.resolve();
    }
    startRendering() {
      if (encoderState.audioFailWith) {
        this.state = 'closed';
        this.renderingDone = true;
        return Promise.reject(encoderState.audioFailWith);
      }
      this.state = 'running';
      return new Promise((resolve, reject) => {
        this._finishRender = resolve;
        this._rejectRender = reject;
        Promise.resolve().then(() => this._advance());
      });
    }
  }

  const seekCalls = [];
  const syncCalls = [];
  const barCalls = [];
  const tabCalls = [];

  const context = {
    Object, Array, Set, Map, WeakMap, Date, Math, Number, String, Boolean, Promise, Proxy, Uint8Array, Float32Array, ArrayBuffer,
    P, ubu, ububallMatch, ububallReplay, ububallMP4, structuredClone,
    setTimeout: () => 1, clearTimeout: dummy,
    MessageChannel: class {
      constructor() {
        this.port1 = { onmessage: null };
        this.port2 = { postMessage: () => Promise.resolve().then(() => this.port1.onmessage?.()) };
      }
    },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; this.size = 1024; } },
    File: class { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts?.type; } },
    Image: class { constructor() { this.naturalWidth = 100; this.naturalHeight = 40; } decode() { return Promise.resolve(); } },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: dummy },
    HTMLCanvasElement: class {},
    VideoEncoder: MockVideoEncoder,
    OfflineAudioContext: MockOfflineAudioContext,
    VideoFrame: class { constructor(src, opts) { this.src = src; this.opts = opts; } close() {} },
    window: {
      ubuAudio: {
        stop: dummy,
        shareMasterChain: dummy,
        playCollision: dummy,
        playBallHit: dummy,
        playWallHit: dummy,
        playGoalHit: dummy,
        playSuper: dummy,
        playSizzle: () => ({ stop: dummy }),
        playFoul: dummy,
        playIronSave: dummy,
        playFanfare: dummy
      }
    },
    document: {
      body: { classList: { toggle: dummy, add: dummy, remove: dummy } },
      createElement: tag => tag === 'canvas' ? makeCanvas() : { href: '', download: '', click: dummy, style: {}, setAttribute: dummy },
      fonts: { load: () => Promise.resolve() }
    },
    getComputedStyle: () => ({ fontFamily: 'sans-serif' }),
    localStorage: { getItem: () => 'off', setItem: dummy },
    $,
    canvas: liveCanvas,
    ctx: liveCanvas._ctx,
    badgeCanvas: liveBadges,
    badgeCtx: liveBadges._ctx,
    rinkWrap: { style: { translate: '' } },
    rinkLogo: { naturalWidth: 100, naturalHeight: 40 },
    skaters: Array.from({ length: 6 }, () => ({ firstChild: null, querySelector: () => null })),
    themeColors: {
      primary: '#76b9ef', secondary: '#ff9954', home: '#e8ca48', away: '#aa54d3',
      text: '#f8f6f2', border: '#3a3f4b', surface: '#1b1e26', background: '#0b0d10'
    },
    GOAL_CALL_SECONDS: 2.4,
    reducedMotion: { matches: false },
    materialStyles: {},
    materialEmitters: [],
    trails: Array.from({ length: 7 }, () => []),
    particles: [], fireworks: [], shockwaves: [],
    skids: [], skidState: [], burns: [], burnState: {},
    ripples: [], pings: [], popups: [], danger: [0, 0],
    ballFlare: 0, kickoffGlow: 0, goalSweep: null, goalCall: null,
    hitStopUntil: 0, shake: 0, shakeX: 0, shakeY: 0,
    fireTime: 0, sizzle: null, netFire: null,
    superImpactTimes: new WeakMap(),
    iceCache: {}, rinkCache: null,
    shownScores: [0, 0],
    dirtyMeters: new Set(),
    teamEntries: [],
    stats: [],
    bodies: P.kickoff(),
    simBodies: P.kickoff(),
    authoritativeBodies: null,
    play: ububallMatch.newPlay(),
    tally: ububallMatch.newTally(),
    fouls: ububallMatch.newFouls(),
    scores: [0, 0],
    turn: 1,
    phase: 'plan',
    selected: 0,
    drag: null,
    plans: Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, guard: false })),
    isPortrait: false,
    layoutDirty: false,
    matchMode: mode,
    anonymousNames: false,
    theater: null,
    goalReplay: null,
    postGoal: null,
    online: null,
    onlineReplay: null,
    scoringPlayer: null,
    demo: false,
    matchTicks: 0,
    elapsed: 0,
    roundTurns: 0,
    cpuGeneration: 0,
    cpuClient: { cancel: dummy },
    videoClock: null,
    videoAudio: null,
    videoField: null,
    cardShot: false,
    clockNow: () => context.videoClock ?? context.currentReplay?.()?.clock ?? wallClock,
    gameAudio: () => context.videoAudio || context.currentReplay?.()?.audio || context.window.ubuAudio,
    classicMode: () => ububallMatch.rule(context.matchMode, 'classic'),
    pulseMode: () => ububallMatch.rule(context.matchMode, 'pulse'),
    normalStats: () => ({
      impulse: 127, traction: 127, spin: 127, curve: 127,
      size: 127, mass: 127, bounciness: 127, grip: 127,
      power: 127, reach: 127, strength: 127, stability: 127,
      efficiency: 127, synergy: 127, chemistry: 127
    }),
    idlePlan: () => ({ angle: 0, power: 0, spin: 0, guard: false }),
    anonymousName: i => ububallTheater.anonymousName(ububallReplay, i),
    resolveEquippedSuper: (entry, i) => entry?.equippedSuper || P.SUPERS[i % P.SUPERS.length],
    saveRecording: dummy,
    stopDemo: dummy,
    closeSummary: dummy,
    endGoalReplay: dummy,
    stopFanfare: dummy,
    showMode: dummy,
    buildTeam: dummy,
    say: dummy,
    enterMatch: dummy,
    newMatch: dummy,
    replayFileName: (recorded, title) => title ? title.toLowerCase().replace(/\s+/g, '-') : `replay-${recorded}`,
    downloadReplay: dummy,
    popup: (body, text) => {
      const p = context.fieldEffects.popups;
      if (!context.reducedMotion.matches && p.length < 8) {
        p.push({ x: body.x, y: body.y - body.radius - 20, text, team: body.team, life: 1.2, duration: 1.2 });
      }
    },
    updatePopups: (dt, popups) => ububallPresentation.updatePopups(dt, popups, context.reducedMotion.matches),
    trailPositions: () => context.bodies.map(b => ({ x: b.x, y: b.y })),
    clearDiscontinuousTrails: before => {
      context.fieldView.bodies.forEach((b, i) => {
        if (before[i] && (before[i].x !== b.x || before[i].y !== b.y)) (context.currentReplay?.()?.fx?.trails ?? context.trails)[i].length = 0;
      });
    },
    recordTrails: () => {
      context.fieldView.bodies.forEach((b, i) => {
        (context.currentReplay?.()?.fx?.trails ?? context.trails)[i].push({ x: b.x, y: b.y, life: 0.24, duration: 0.24 });
      });
    },
    emitSkaterEffects: dummy,
    updateEffects: dt => {
      for (const trail of context.currentReplay?.()?.fx?.trails ?? context.trails) {
        for (const pt of trail) pt.life -= dt;
      }
      if (context.fieldEffects.goalCall && (context.fieldEffects.goalCall.t += dt) >= context.GOAL_CALL_SECONDS) context.fieldEffects.goalCall = null;
    },
    clearEffects: () => {
      if (!context.fieldView.field) context.postGoal = null;
      (context.currentReplay?.()?.fx?.trails ?? context.trails).forEach(t => { t.length = 0; });
      context.fieldEffects.particles.length = context.fieldEffects.fireworks.length = context.fieldEffects.shockwaves.length = 0;
      context.fieldEffects.skids.length = context.fieldEffects.skidState.length = context.fieldEffects.burns.length = context.fieldEffects.ripples.length = context.fieldEffects.pings.length = 0;
      (context.currentReplay?.()?.fx?.popups ?? context.popups).length = 0;
      context.fieldEffects.goalSweep = context.fieldEffects.goalCall = null;
    },
    steamRing: dummy,
    impact: ms => {
      const fx = context.currentReplay?.()?.fx;
      if (fx) fx.hitStopUntil = context.clockNow() + ms;
      else context.hitStopUntil = context.clockNow() + ms;
    },
    celebrate: (team, ball, label = 'GOAL', scorer = null) => {
      context.fieldEffects.goalCall = { team, label, scorer: scorer ? context.fieldView.bodies.indexOf(scorer) : -1, name: scorer?.name || '', t: 0 };
      context.fieldEffects.fireworks.push({ team, label });
    },
    goalTab: (team, label, scorer) => { tabCalls.push({ team, label, scorer }); },
    handleCollision: dummy,
    handleWall: dummy,
    handleShockwave: dummy,
    handleSuper: dummy,
    sync: () => { syncCalls.push({ scores: [...context.scores], turn: context.turn }); },
    draw: () => { context.ctx.clearRect(0, 0, 1000, 600); },
    setClock: ms => { wallClock = ms; }
  };

  const env = ububallPlayback.bindMatchHarness(context, {
    withTheater: true,
    ububallTheater,
    createEffectsState,
    env: context
  });

  return { P, ubu, ububallMatch, ububallReplay, rec, context, env, elements, encoderState, seekCalls, syncCalls, barCalls, tabCalls };
}

test('video export completion, cancellation, and failure preserve interactive replay state without seeking theater back', async () => {
  const { rec, context, env, elements, encoderState, syncCalls, tabCalls } = createReplayExportHarness({ seat: 0 });
  // Force more hit-stop than the original frame budget could absorb before the final goal.
  rec.turns[1].stops = [{ tick: 1, ms: 1000 }, { tick: 5, ms: 1000 }, { tick: 12, ms: 1000 }];
  rec.turns[1].scores = [4, 0];
  rec.turns[1].goal = { team: 0, label: 'GOAL!', scorer: 0, assist: null };
  const sourceSnapshot = structuredClone(rec);

  env.watchReplay(rec, new Uint8Array([9, 9, 9]));
  // Advance interactive theater midway into turn 1 and pause with custom speed and portrait mode
  env.seekReplay(10);
  const authoritativeSnapshot = structuredClone(context.simBodies);
  context.theater.paused = true;
  context.theater.speed = 2;
  context.isPortrait = true;
  context.popups.push({ x: 300, y: 200, text: 'Interactive popup', team: 0, life: 0.9, duration: 1.2 });
  context.trails[0].push({ x: 250, y: 300, life: 0.2, duration: 0.24 });

  const captureTheaterState = () => ({
    index: context.theater.index,
    tick: context.theater.tick,
    paused: context.theater.paused,
    speed: context.theater.speed,
    steps: context.theater.steps,
    holdUntil: context.theater.holdUntil,
    called: context.theater.called,
    crowned: context.theater.crowned,
    sim: structuredClone(context.theater.sim),
    bodies: structuredClone(context.bodies),
    bodyRefs: [...context.bodies],
    scores: [...context.scores],
    turn: context.turn,
    fouls: structuredClone(context.fouls),
    plans: structuredClone(context.plans),
    guide: structuredClone(context.guide),
    popups: structuredClone(context.popups),
    trail0: structuredClone(context.trails[0]),
    isPortrait: context.isPortrait,
    homeLabel: elements.get('home-label').textContent,
    awayLabel: elements.get('opponent-label').textContent,
    seekSlider: elements.get('replay-seek').value
  });

  const before = captureTheaterState();
  syncCalls.length = 0;
  tabCalls.length = 0;

  // 1. Complete a full anonymized clip export while interactive theater is paused at tick 10
  const slice = env.exportSlice('match', true);
  await env.exportVideo(slice);

  const afterComplete = captureTheaterState();
  assert.deepEqual(afterComplete.sim, before.sim, 'interactive theater.sim untouched after export completion');
  assert.deepEqual(afterComplete.bodies, before.bodies, 'interactive display bodies untouched after export completion');
  for (let i = 0; i < 7; i++) {
    assert.equal(afterComplete.bodyRefs[i], before.bodyRefs[i], `display body[${i}] identity preserved`);
  }
  assert.equal(afterComplete.index, 0);
  assert.equal(afterComplete.tick, 10);
  assert.equal(afterComplete.paused, true);
  assert.equal(afterComplete.speed, 2);
  assert.equal(afterComplete.isPortrait, true, 'isPortrait preserved during and after export');
  assert.deepEqual(afterComplete.scores, before.scores, 'interactive scores preserved');
  assert.equal(afterComplete.turn, before.turn, 'interactive turn preserved');
  assert.deepEqual(afterComplete.fouls, before.fouls, 'interactive fouls preserved');
  assert.deepEqual(afterComplete.plans, before.plans, 'interactive plans preserved');
  assert.deepEqual(afterComplete.guide, before.guide, 'interactive guide preserved');
  assert.deepEqual(afterComplete.popups, before.popups, 'interactive popups preserved');
  assert.deepEqual(afterComplete.trail0, before.trail0, 'interactive trails preserved');
  assert.equal(afterComplete.homeLabel, 'Solaris', 'interactive home DOM label not overwritten by anonymous export');
  assert.equal(afterComplete.awayLabel, 'Nebula', 'interactive opponent DOM label not overwritten by anonymous export');
  assert.equal(afterComplete.seekSlider, before.seekSlider, 'interactive seek bar not reset to 0 during export');
  assert.equal(syncCalls.length, 0, 'export does not trigger live DOM sync()');
  assert.equal(tabCalls.length, 0, 'export does not trigger live scorebug goalTab()');
  assert.equal(encoderState.instances.at(-1).closed, true, 'encoder closed after completion');
  assert.ok(encoderState.instances.at(-1).frames >= (3 + 5 + 1) * 60, 'export includes hit-stops, goal and winner holds, and the final field');
  assert.equal(encoderState.audioInstances.at(-1).state, 'closed', 'offline audio completed after normal export');
  assert.equal(encoderState.audioInstances.at(-1).renderingDone, true, 'offline audio rendering settled');

  // 2. Cancel an export during async codec preparation before rendering starts
  const instancesBeforePrepCancel = encoderState.instances.length;
  const audioBeforePrepCancel = encoderState.audioInstances.length;
  let exportingDuringPrep = false;
  elements.get('export-dialog').showModal();
  encoderState.onConfigCheck = async () => {
    exportingDuringPrep = env.isExporting();
    elements.get('export-close').onclick();
  };
  await env.exportVideo(env.exportSlice('match', false));
  encoderState.onConfigCheck = null;

  assert.equal(exportingDuringPrep, true, 'exportingVideo is true before first await during codec preparation');
  assert.equal(encoderState.instances.length, instancesBeforePrepCancel, 'cancellation during preparation prevents VideoEncoder creation');
  assert.equal(encoderState.audioInstances.length, audioBeforePrepCancel, 'cancellation during preparation prevents OfflineAudioContext creation');
  assert.equal(elements.get('export-dialog').closed, true, 'export dialog closed after preparation cancellation');
  assert.equal(env.isExporting(), false, 'exportingVideo cleared after preparation cancellation');
  assert.deepEqual(captureTheaterState().sim, before.sim, 'interactive theater.sim untouched after preparation cancellation');

  // 3. Cancel an export mid-way while OfflineAudioContext is suspended and verify audio is unblocked
  let suspendedOnCancel = null;
  encoderState.onEncode = frameCount => {
    if (frameCount === 10) {
      suspendedOnCancel = encoderState.audioInstances.at(-1).state;
      elements.get('export-close').onclick();
    }
  };
  await env.exportVideo(env.exportSlice('match', false));
  encoderState.onEncode = null;
  await new Promise(resolve => setImmediate(resolve));

  const afterCancel = captureTheaterState();
  assert.deepEqual(afterCancel.sim, before.sim, 'interactive theater.sim untouched after export cancellation');
  assert.deepEqual(afterCancel.bodies, before.bodies, 'interactive display bodies untouched after export cancellation');
  assert.equal(afterCancel.tick, 10);
  assert.equal(afterCancel.paused, true);
  assert.equal(afterCancel.speed, 2);
  assert.equal(afterCancel.isPortrait, true);
  assert.equal(encoderState.instances.at(-1).frames, 10, 'export stopped immediately on cancellation');
  assert.equal(encoderState.instances.at(-1).closed, true, 'encoder closed on cancellation');
  assert.equal(suspendedOnCancel, 'suspended', 'OfflineAudioContext was suspended at mark when export was canceled');
  assert.equal(encoderState.audioInstances.at(-1).state, 'closed', 'OfflineAudioContext unblocked and drained on cancellation');
  assert.equal(encoderState.audioInstances.at(-1).renderingDone, true, 'OfflineAudioContext rendering settled on cancellation');

  // 4. Encoding failure while OfflineAudioContext is suspended unblocks offline audio and releases encoder
  let suspendedOnFailure = null;
  encoderState.onEncode = frameCount => {
    if (frameCount === 10) {
      suspendedOnFailure = encoderState.audioInstances.at(-1).state;
      encoderState.failWith = new Error('GPU encode failed');
    }
  };
  await env.exportVideo(env.exportSlice('match', false));
  encoderState.onEncode = null;
  encoderState.failWith = null;
  await new Promise(resolve => setImmediate(resolve));

  assert.match(elements.get('export-status').textContent, /GPU encode failed/);
  assert.equal(encoderState.instances.at(-1).closed, true, 'encoder closed on VideoEncoder error');
  assert.equal(suspendedOnFailure, 'suspended', 'OfflineAudioContext was suspended at mark when VideoEncoder failed');
  assert.equal(encoderState.audioInstances.at(-1).state, 'closed', 'OfflineAudioContext unblocked and drained on VideoEncoder failure');
  assert.equal(encoderState.audioInstances.at(-1).renderingDone, true, 'OfflineAudioContext rendering settled on VideoEncoder failure');
  assert.deepEqual(captureTheaterState().sim, before.sim, 'interactive theater.sim untouched after VideoEncoder failure');

  encoderState.audioFailWith = new Error('OfflineAudio failed');
  await env.exportVideo(env.exportSlice('match', false));
  encoderState.audioFailWith = null;

  assert.match(elements.get('export-status').textContent, /OfflineAudio failed/);
  assert.equal(encoderState.instances.at(-1).closed, true, 'encoder closed on audio rendering failure');
  assert.deepEqual(captureTheaterState().sim, before.sim, 'interactive theater.sim untouched after audio failure');
  assert.equal(env.isExporting(), false, 'exporting flag cleared in finally block');

  // 5. Source replay data and authoritative local simBodies are never mutated
  assert.deepEqual(structuredClone(rec), sourceSnapshot, 'replay source data is never mutated by replay or export');
  assert.deepEqual(structuredClone(context.simBodies), authoritativeSnapshot, 'local authoritative simBodies is never mutated by replay or export');
});

test('interactive replay and export session advance through identical deterministic physics states, holds, and seat orientations', () => {
  for (const seat of [0, 1]) {
    const { P, rec, context, env, elements } = createReplayExportHarness({ seat });
    env.watchReplay(rec, null);

    // Verify seat orientation in interactive replay
    assert.equal(elements.get('home-label').textContent, seat ? 'Nebula' : 'Solaris');
    assert.equal(elements.get('opponent-label').textContent, seat ? 'Solaris' : 'Nebula');
    const expectedHomeX = seat ? 1000 - 760 : 240;
    assert.ok(Math.abs(context.bodies[0].x - expectedHomeX) < 1e-6, `seat ${seat} home body x oriented correctly`);

    // Create an isolated export session for the same replay
    const exportSession = env.createReplaySession(rec, {
      speed: 1,
      paused: false,
      anonymous: true,
      exporting: true,
      clock: 5000
    });
    env.seekReplay(0, exportSession);
    env.seekReplay(0, context.theater);

    assert.deepEqual(exportSession.sim, context.theater.sim, `seat ${seat} initial simulation state matches exactly`);
    assert.equal(exportSession.bodies[0].x, context.bodies[0].x, `seat ${seat} initial display x matches`);
    assert.equal(exportSession.bodies[0].name, 'Saffron 1', 'export session uses anonymized ubu names');
    assert.notEqual(context.bodies[0].name, 'Saffron 1', 'interactive session retains real ubu names');

    // Step both sessions frame-by-frame through turn 1 (including save at tick 4, hit-stop at tick 8, and goal at tick 16)
    const dt = 1 / 60;
    for (let step = 0; step < 30; step++) {
      const now = 5000 + (step + 1) * (1000 / 60);
      context.setClock(now);
      env.advanceReplay(dt, context.theater);

      exportSession.clock = now;
      env.withPlaybackContext(exportSession, () => {
        env.advanceReplay(dt, exportSession);
      });

      assert.equal(exportSession.index, context.theater.index, `seat ${seat} frame ${step} turn index matches`);
      assert.equal(exportSession.tick, context.theater.tick, `seat ${seat} frame ${step} tick matches`);
      assert.equal(exportSession.called, context.theater.called, `seat ${seat} frame ${step} goal called state matches`);
      assert.equal(exportSession.holdUntil, context.theater.holdUntil, `seat ${seat} frame ${step} holdUntil matches`);
      assert.equal(exportSession.fx.hitStopUntil, context.hitStopUntil, `seat ${seat} frame ${step} hitStopUntil matches`);
      assert.deepEqual(exportSession.scores, context.scores, `seat ${seat} frame ${step} scores match`);
      assert.deepEqual(exportSession.viewFouls, context.fouls, `seat ${seat} frame ${step} viewFouls match`);
      assert.deepEqual(exportSession.sim, context.theater.sim, `seat ${seat} frame ${step} sim bodies match deterministically`);
    }

    // Both sessions should now be holding on turn 1's goal celebration (holdUntil = clock + 2500)
    assert.equal(context.theater.called, true, 'turn 1 goal called');
    assert.ok(context.theater.holdUntil > 5000, 'goal hold active');
    assert.deepEqual([...context.scores], seat ? [0, 1] : [1, 0], `seat ${seat} goal score incremented for scoring side`);

    // Advance clock past the 2500ms goal hold so both sessions transition to turn 2 and play to completion
    for (let step = 0; step < 20; step++) {
      const now = 8500 + step * (1000 / 60);
      context.setClock(now);
      env.advanceReplay(dt, context.theater);

      exportSession.clock = now;
      env.withPlaybackContext(exportSession, () => {
        env.advanceReplay(dt, exportSession);
      });

      assert.equal(exportSession.index, context.theater.index, `seat ${seat} post-hold step ${step} index matches`);
      assert.equal(exportSession.tick, context.theater.tick, `seat ${seat} post-hold step ${step} tick matches`);
      assert.equal(exportSession.paused, context.theater.paused, `seat ${seat} post-hold step ${step} paused state matches`);
      assert.deepEqual(exportSession.sim, context.theater.sim, `seat ${seat} post-hold step ${step} sim matches`);
    }

    assert.equal(context.theater.index, 1, 'advanced into turn 2');
    assert.equal(context.theater.paused, true, 'paused at end of final turn');
    assert.equal(exportSession.paused, true, 'export session also paused at end of final turn');

    // Share card anonymization does not mutate interactive names or DOM labels
    const homeBefore = elements.get('home-label').textContent;
    const bodyNameBefore = context.bodies[0].name;
    env.drawShareCard(true);
    assert.equal(elements.get('home-label').textContent, homeBefore, 'drawShareCard(true) preserves home DOM label');
    assert.equal(context.bodies[0].name, bodyNameBefore, 'drawShareCard(true) preserves interactive display body name');
  }
});

test('D4-01, D4-03, D4-06: replay entries preserve keys & super mastery on takeover, endReplay avoids phantom CPU match, and newMatch clears theater', () => {
  const P = require('../shared/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');

  // Find or synthesize a DNA with >= 2 copies of a super so mastery bonusTicks > 0
  let masteredDna = null, masteredSuperId = 0;
  for (let attempt = 0; attempt < 200 && !masteredDna; attempt++) {
    const raw = ubu.randomDNA();
    const model = ubu.decode(raw);
    for (let sid = 0; sid < 8; sid++) {
      if (P.superMastery(model.supers, sid).copies >= 2) {
        masteredDna = ubu.toCode(raw);
        masteredSuperId = sid;
        break;
      }
    }
  }
  assert.ok(masteredDna, 'found DNA with super mastery >= II');

  const ubus = Array.from({ length: 6 }, (_, i) => ({
    dna: i === 0 ? masteredDna : ubu.toCode(ubu.randomDNA()),
    super: i === 0 ? masteredSuperId : (i % 8)
  }));
  const rec = ububallReplay.create({ mode: 'standard', seat: 0, names: ['Alpha', 'Beta'], ubus });
  const t = ububallReplay.addTurn(rec, {
    turn: 1, scores: [0, 0], fouls: ububallMatch.newFouls(), bodies: P.kickoff(),
    plans: Array.from({ length: 6 }, () => ({ angle: 0, power: 0.3, spin: 0, superArm: false, guard: false }))
  });
  t.ticks = 12;

  let newMatchCalls = 0;
  const classes = new Set();
  const dummy = () => {};
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '1', textContent: '', hidden: false, disabled: false,
        classList: { toggle: dummy, add: dummy, remove: dummy },
        setAttribute: dummy, replaceChildren: dummy
      });
    }
    return elements.get(id);
  };
  const localTeam = Array.from({ length: 3 }, (_, i) => ({
    key: `guest-${i}`, dna: ubus[i].dna, label: 'Guest ubu', model: ubu.decode(ubu.fromCode(ubus[i].dna))
  }));
  const context = {
    P, ubu, ububallMatch, ububallReplay,
    localStorage: { getItem: () => null, setItem: dummy, removeItem: dummy },
    $,
    shot: 'home',
    document: {
      body: {
        dataset: { shot: 'home' },
        classList: {
          add: c => classes.add(c),
          remove: c => classes.delete(c),
          toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
        }
      },
      querySelector: () => null
    },
    inDiscord: false, demo: false, online: null,
    cpuMode: 'standard', cpuLevel: 'medium', cpuTeam: localTeam,
    starterEntries: () => localTeam,
    draft: [...localTeam], roster: [...localTeam], teamEntries: [], stats: [], plans: [], cpu: [], cpuDone: false,
    idlePlan: () => ({ angle: 0, power: 0, spin: 0, guard: false }),
    saveRecording: dummy, stopDemo: dummy, closeSummary: dummy, endGoalReplay: dummy,
    stopFanfare: dummy, gameAudio: () => ({ stop: dummy }),
    cpuGeneration: 0, cpuClient: { cancel: dummy, dispose: dummy }, videoLogo: dummy,
    showMode: dummy, classicMode: () => false, normalStats: () => ({}),
    anonymousName: i => `Anon ${i}`, anonymousNames: false,
    buildTeam: dummy, replayMarks: dummy,
    enterMatch: (next = 'match') => { context.shot = next; context.document.body.dataset.shot = next; },
    setShot: next => { context.shot = next; context.document.body.dataset.shot = next; },
    updateReplayBar: dummy, updateHome: dummy,
    clearEffects: dummy, resetPlans: dummy, say: dummy, sync: dummy, draw: dummy,
    recordTrails: dummy, emitSkaterEffects: dummy, updatePopups: dummy, updateEffects: dummy,
    replayEvents: dummy, replayFx: { hit: dummy, wall: dummy, shock: dummy, super: dummy },
    videoAudio: null, videoClock: null, clockNow: () => 1000, hitStopUntil: 0,
    shownScores: [0, 0], scores: [0, 0], turn: 1, phase: 'plan',
    matchMode: 'standard', fouls: ububallMatch.newFouls(), play: ububallMatch.newPlay(), tally: ububallMatch.newTally(),
    roundTurns: 0, matchTicks: 0, playSegments: [], selected: 0, drag: null, elapsed: 0, accumulator: 0,
    recording: null, theater: null, onlineReplay: null, goalReplay: null, postGoal: null,
    authoritativeBodies: null, kickoffGlow: 0, netFire: null, dirtyMeters: new Set(),
    bodies: P.kickoff(), simBodies: P.kickoff()
  };

  const env = ububallPlayback.bindMatchHarness(context, { withTheater: true, ububallTheater, createEffectsState });

  // 1. watchReplay assigns replay-* keys, enters replay shot, and preserves full superMastery metadata
  env.watchReplay(rec, null);
  assert.equal(context.shot, 'replay');
  assert.equal(context.document.body.dataset.shot, 'replay');
  assert.equal(context.teamEntries[0].key, 'replay-0');
  assert.ok(context.teamEntries[0].equippedSuper.bonusTicks > 0, 'watchReplay preserves superMastery bonusTicks');
  assert.ok(context.teamEntries[0].equippedSuper.copies >= 2, 'watchReplay preserves superMastery copies');

  // 2. playFromHere switches from replay shot to match shot, keeps replay-* keys, and applies mastery bonuses
  env.playFromHere();
  assert.equal(context.shot, 'match');
  assert.equal(context.document.body.dataset.shot, 'match');
  assert.equal(context.roster[0].key, 'replay-0');
  assert.equal(env.onGuestTeam(), false, 'onGuestTeam returns false cleanly without TypeError');
  assert.ok(context.simBodies[0].superBonusTicks > 0, 'playFromHere preserves superBonusTicks on simBodies');
  assert.ok(context.simBodies[0].equippedSuper.bonusTicks > 0, 'playFromHere preserves equippedSuper.bonusTicks');

  // 3. endReplay clears replay state cleanly without starting an unrequested phantom CPU match
  env.watchReplay(rec, null);
  env.endReplay();
  assert.equal(context.theater, null);
  assert.equal(context.phase, 'over', 'endReplay leaves phase === over so exitMatchMode resumes Home demo');
  assert.equal(context.recording, null, 'endReplay does not create a phantom CPU match recording');
  assert.equal(newMatchCalls, 0);

  // 4. Starting newMatch while replay viewer is active clears theater and switches replay shot to match shot (D4-03)
  env.watchReplay(rec, null);
  assert.ok(context.theater);
  assert.equal(context.shot, 'replay');
  env.newMatch();
  assert.equal(context.theater, null, 'newMatch clears active theater');
  assert.equal(context.shot, 'match', 'newMatch folds replay shot into match shot');
  assert.equal(context.document.body.dataset.shot, 'match');
  assert.equal(context.phase, 'plan');
});

test('D4-04 & D4-07: offlineAudio.playFanfare routes customCtx to OfflineAudioContext with loop:false, and replay/export stop fanfare cleanly', async () => {
  const fanfareCalls = [];
  const fakeUbuAudio = {
    shareMasterChain: () => {},
    stopMotion: () => {},
    playFanfare: (voice, customCtx, onNote, opts) => {
      fanfareCalls.push({ voice, customCtx, onNote, opts });
      return { stop() {} };
    }
  };
  const offlineTarget = { sampleRate: 48000, marker: 'offline-ctx' };
  const adapter = ububallTheater.offlineAudio(fakeUbuAudio, offlineTarget, () => 3.25);

  // Simulate presenter.loopFanfare(voice) calling gameAudio().playFanfare(voice, null, null, { loop: true })
  adapter.playFanfare({ pitch: 220 }, null, null, { loop: true, volume: 0.8 });
  assert.equal(fanfareCalls.length, 1);
  assert.equal(fanfareCalls[0].customCtx.marker, 'offline-ctx', '2nd arg customCtx receives offline AudioContext proxy');
  assert.equal(fanfareCalls[0].customCtx.currentTime, 3.25, 'customCtx reports offline timeline currentTime');
  assert.equal(fanfareCalls[0].opts.loop, false, 'offline export forces loop: false to prevent wall-clock setTimeout leaks');
  assert.equal(fanfareCalls[0].opts.volume, 0.8);

  // Verify stopFanfare() is called across seekReplay, goal turn advance, final turn end, and exportVideo finally
  const harness = createReplayExportHarness({ seat: 0 });
  let stopFanfareCount = 0;
  harness.context.stopFanfare = () => { stopFanfareCount++; };
  harness.env.watchReplay(harness.rec, null);
  stopFanfareCount = 0;

  harness.env.seekReplay(5);
  assert.equal(stopFanfareCount, 1, 'seekReplay stops looping goal fanfare');

  // Step through turn 1 goal and advance past hold into turn 2
  const dt = 1 / 60;
  for (let s = 0; s < 30; s++) {
    harness.context.setClock(5000 + (s + 1) * 20);
    harness.env.advanceReplay(dt, harness.context.theater);
  }
  assert.equal(harness.context.theater.called, true);
  stopFanfareCount = 0;
  harness.context.setClock(9000);
  harness.env.advanceReplay(dt, harness.context.theater);
  assert.ok(stopFanfareCount >= 1, 'advancing from goal hold to next turn stops looping fanfare');

  // Export video calls stopFanfare in finally and zeroes offscreen canvas dimensions
  stopFanfareCount = 0;
  const createdCanvases = [];
  const origCreateElement = harness.context.document.createElement;
  harness.context.document.createElement = tag => {
    const el = origCreateElement(tag);
    if (tag === 'canvas') createdCanvases.push(el);
    return el;
  };
  await harness.env.exportVideo(harness.env.exportSlice('turn', false));
  assert.ok(stopFanfareCount >= 1, 'exportVideo finally stops fanfare');
  assert.ok(createdCanvases.length >= 3 && createdCanvases.every(c => c.width === 0 && c.height === 0), 'exportVideo finally releases offscreen canvas backing stores');
});
