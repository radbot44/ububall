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
