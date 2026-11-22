/* Direct require-based tests for web/ububall-playback.js and pure presentation logic. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../shared/ububall-physics.js');
const ububallMatch = require('../shared/ububall-match.js');
const ububallReplay = require('../shared/ububall-replay.js');
const ubu = require('../shared/ubu.js');
const ububallPlayback = require('../web/ububall-playback.js');
const ububallPresentation = require('../web/ububall-presentation.js');

test('ububall-playback: seat transforms, fixed-field body projection, and PROJECTED_STATIC cache', () => {
  const entries = Array.from({ length: 6 }, (_, i) => {
    const dna = ubu.randomDNA();
    const model = ubu.decode(dna);
    return {
      model,
      dna: ubu.toCode(dna),
      equippedSuper: { ...P.SUPERS[i % P.SUPERS.length], bonusTicks: 24, bonusRefund: 10 }
    };
  });

  const sim = P.kickoff();
  sim.slice(0, 6).forEach((b, i) => ububallMatch.applyStats(P, b, entries[i].model.stats, 'standard'));
  sim[0].x = 240; sim[0].y = 190; sim[0].meterTick = 99;
  sim[6].x = 610; sim[6].y = 260; sim[6].strikerTeam = 0; sim[6].pinX = 950;

  const target = P.kickoff();
  const dirty = new Set();
  let anon = false;
  const projector = ububallPlayback.createBodyProjector({
    P,
    getEntries: () => entries,
    getAnonymous: () => anon,
    anonymousName: i => `Anon ${i}`,
    isClassicMode: () => false,
    resolveEquippedSuper: (e, i) => e?.equippedSuper || P.SUPERS[i],
    getShownSim: () => sim,
    getShownSeat: () => 0,
    getTargetBodies: () => target,
    getDirtyMeters: () => dirty
  });

  projector.syncViewBodies(sim, 0, target, false, dirty, entries);
  assert.equal(target[0].x, 240);
  assert.equal('meterTick' in target[0], false, 'internal meterTick excluded from view body');
  assert.equal('pinX' in target[6], false, 'internal pinX excluded from ball view body');
  const cachedPersonality = target[0].personality;
  const cachedSuper = target[0].equippedSuper;

  projector.syncViewBodies(sim, 0, target, false, dirty, entries);
  assert.equal(target[0].personality, cachedPersonality, 'PROJECTED_STATIC reuses personality object');
  assert.equal(target[0].equippedSuper, cachedSuper, 'PROJECTED_STATIC reuses equippedSuper object');

  projector.syncViewBodies(sim, 1, target, false, dirty, entries);
  assert.equal(target[3].x, 1000 - 240);
  assert.equal(target[3].y, 600 - 190);
  assert.equal(target[6].strikerTeam, 1);

  anon = true;
  projector.syncViewBodies(sim, 0, target, true, dirty, entries);
  assert.equal(target[0].name, 'Anon 0');
});

test('restoreEntry restores Stalwart ID 0 and mastery metadata, preserving null for unsaved', () => {
  const restoreEntry = saved => ububallPlayback.restoreEntry(P, ubu, saved);
  const sampleDna = ubu.toCode(ubu.randomDNA());

  const restoredStalwart = restoreEntry({ dna: sampleDna, label: 'Ubu 1', equippedSuper: { id: 0 } });
  assert.ok(restoredStalwart?.equippedSuper);
  assert.equal(restoredStalwart.equippedSuper.id, 0);
  assert.equal(restoredStalwart.equippedSuper.key, 'stalwart');
  assert.equal(typeof restoredStalwart.equippedSuper.bonusTicks, 'number');

  const restoredNull = restoreEntry({ dna: sampleDna, label: 'Ubu 2', equippedSuper: null });
  assert.equal(restoredNull.equippedSuper, null);

  const restoredPractice = restoreEntry({ key: 'guest-0', dna: sampleDna, equippedSuper: { id: 0 } });
  assert.equal(restoredPractice.dna, sampleDna);
  assert.equal(restoredPractice.equippedSuper.id, 0);
  assert.equal(restoredPractice.equippedSuper.key, 'stalwart');
});

test('local Blitz preserves the deadline across blocked frames and hidden time', () => {
  let now = 100;
  let gameDialog = false;
  const dialog = { open: false };
  const context = {
    performance: { now: () => now },
    document: { hidden: false, querySelector: () => gameDialog ? {} : null },
    $: id => id === 'pause-menu' ? dialog : { open: false },
    foulInfo: null, online: null, shot: 'match', demo: false, phase: 'plan', matchMode: 'blitz', blitzMode: () => true,
    ububallMatch: { planningMilliseconds: () => 5000 }, planDeadline: 0, planPausedAt: null
  };
  const { startPlanClock, localPlayBlocked, updateLocalPlanClock } = ububallPlayback.createPlanClockController(context);
  const refresh = () => updateLocalPlanClock(localPlayBlocked());
  startPlanClock();
  now = 1100; dialog.open = true; refresh();
  now = 6100; context.document.hidden = true; dialog.open = false; refresh();
  now = 8100; context.document.hidden = false; refresh();
  assert.equal(context.planDeadline - now, 4000);
  now = 9100; context.foulInfo = { kind: 'crease' }; refresh();
  now = 10100; context.foulInfo = null; refresh();
  assert.equal(context.planDeadline - now, 3000);
  now = 11100; gameDialog = true; refresh();
  now = 15100; gameDialog = false; refresh();
  assert.equal(context.planDeadline - now, 2000);
  now = 15600; context.shot = 'home'; refresh();
  now = 19600; context.shot = 'match'; refresh();
  assert.equal(context.planDeadline - now, 1500);
  context.online = { active: true };
  dialog.open = true; refresh();
  assert.equal(context.planPausedAt, null);
});

test('active match save and restore enforces matching matchVersion and physicsVersion', () => {
  const store = {};
  const localStorage = {
    getItem(k) { return store[k] || null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
  const dummy = () => {};
  const context = {
    P, ububallMatch, ububallReplay, localStorage,
    inDiscord: false, demo: false, online: null, phase: 'plan', recording: { turns: [] },
    matchMode: 'standard', cpuMode: 'standard', cpuLevel: 'medium', scores: [0, 0], turn: 1, selected: 0,
    elapsed: 0, accumulator: 0, drag: null, playSegments: [],
    cpuTeam: [], starterEntries: () => Array.from({ length: 3 }, () => ({ dna: 'a', label: 'a', model: { stats: {} } })),
    draft: Array.from({ length: 3 }, () => ({ dna: 'a', label: 'a', model: { stats: {} } })),
    fouls: { crease: [false, false], corner: null, cornerTurns: 0, cards: [] },
    tally: {}, roster: [{ dna: 'a', label: 'a' }], teamEntries: [{ dna: 'a', label: 'a' }], stats: [],
    bodies: P.kickoff(), simBodies: P.kickoff(), plans: [], cpu: [], cpuDone: false,
    authoritativeBodies: null, kickoffGlow: 0, netFire: null, scoringPlayer: null, roundTurns: 0, matchTicks: 0, play: {},
    clearEffects: dummy, closeSummary: dummy, saveRecording: dummy, resetPlans: dummy,
    resolveEquippedSuper: () => P.SUPERS[0], anonymousName: i => `Anon ${i}`, anonymousNames: false,
    shownSim: () => P.kickoff(), shownSeat: () => 0,
    endGoalReplay: dummy, showMode: dummy, classicMode: () => false,
    stopFanfare: dummy, gameAudio: () => null, buildTeam: dummy,
    normalStats: () => ({}), idlePlan: () => ({ angle: 0, power: 0, spin: 0 }),
    document: { body: { classList: { toggle: dummy } }, querySelector: () => null },
    restoreEntry: e => e, dirtyMeters: new Set(), startPlanClock: dummy, prepareCPU: dummy,
    sync: dummy, draw: dummy, say: dummy, recordSegment: dummy, beginGuide: dummy, liveFx: { super: dummy }
  };
  const env = ububallPlayback.bindMatchHarness(context);
  env.newMatch();

  env.saveActiveMatch();
  const parsed = JSON.parse(store['ububall-active-match']);
  assert.equal(parsed.version, ububallMatch.VERSION);
  assert.equal(parsed.physics, P.VERSION);

  parsed.level = 'ballistic';
  parsed.play.last = 2;
  parsed.play.assist[0] = 1;
  parsed.play.credit[2] = 1;
  parsed.roundTurns = 3;
  parsed.matchTicks = 701;
  parsed.bodies[2].meterTick = 700;
  store['ububall-active-match'] = JSON.stringify(parsed);
  assert.equal(env.restoreActiveMatch(), true);
  env.saveActiveMatch();
  const resaved = JSON.parse(store['ububall-active-match']);
  assert.equal(resaved.level, 'ballistic');
  assert.deepEqual(resaved.play, parsed.play);
  assert.equal(resaved.roundTurns, 3);
  assert.equal(resaved.matchTicks, 701);
  assert.equal(resaved.bodies[2].meterTick, 700);

  // Mismatched or missing physics version fails and clears storage
  parsed.physics = P.VERSION + 1;
  store['ububall-active-match'] = JSON.stringify(parsed);
  assert.equal(env.restoreActiveMatch(), false);
  assert.equal(store['ububall-active-match'], undefined);

  delete parsed.physics;
  store['ububall-active-match'] = JSON.stringify(parsed);
  assert.equal(env.restoreActiveMatch(), false);
  assert.equal(store['ububall-active-match'], undefined);
});

test('post-goal celebration simulation cannot alter the next kickoffs meter or gameplay state', () => {
  const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };
  const practice = Array.from({ length: 6 }, () => {
    const dna = ubu.randomDNA();
    return { model: ubu.decode(dna), dna: ubu.toCode(dna), label: 'Practice ubu' };
  });

  const simBodies = P.kickoff();
  simBodies.slice(0, 6).forEach(b => P.applyStats(b, normal));
  simBodies[0].meter = 50;
  simBodies[1].meter = 30;
  simBodies[3].meter = 20;

  const dummy = () => {};
  const context = {
    P, ububallMatch,
    clearEffects: dummy, kickoffGlow: 0, netFire: null, stats: Array.from({ length: 6 }, () => normal),
    matchMode: 'standard', teamEntries: practice, classicMode: () => false,
    resolveEquippedSuper: () => null, anonymousName: i => `Anon ${i}`, anonymousNames: false,
    shownSim: () => context.simBodies, shownSeat: () => 0,
    playSegments: [], elapsed: 10, roundTurns: 1, play: ububallMatch.newPlay(),
    tally: ububallMatch.newTally(), ballOnFire: () => false, lightNet: dummy, quench: dummy,
    trailPositions: () => [], clearDiscontinuousTrails: dummy, fouls: ububallMatch.newFouls(),
    noteTurn: dummy, announceFouls: dummy, matchTicks: 0, dirtyMeters: new Set(),
    celebrate: dummy, popup: dummy, queueSummary: dummy, recording: null, clearActiveMatch: dummy,
    goalTab: dummy, say: dummy, loopFanfare: dummy, sync: dummy, draw: dummy, callText: () => '',
    $: () => ({ disabled: false, textContent: '', onclick: null }),
    scores: [0, 0], bodies: P.kickoff(), simBodies, authoritativeBodies: null, postGoal: null, scoringPlayer: null, phase: 'play', performance
  };

  const env = ububallPlayback.bindMatchHarness(context);
  env.finishTurn(0);
  assert.equal(context.authoritativeBodies[0].meter, 50);

  context.bodies[0].meter = 99;
  context.bodies[1].meter = 88;
  context.bodies[0].stunned = true;
  context.postGoal.sim[0].meter = 99;
  context.postGoal.sim[1].meter = 88;
  context.postGoal.sim[0].stunned = true;

  const nextKickoffBodies = env.kickoff();
  assert.equal(nextKickoffBodies[0].meter, 50);
  assert.equal(nextKickoffBodies[1].meter, 30);
  assert.equal(nextKickoffBodies[0].stunned, false);
  assert.equal(context.authoritativeBodies, null);
});

test('online seat-1 replay transition preserves display identity, local roster, score integrity, and ends stale goalReplay', () => {
  const rosters = [
    Array.from({ length: 3 }, (_, i) => ({ serial: `u-0-${i}`, dna: ubu.toCode(ubu.randomDNA()), superId: i })),
    Array.from({ length: 3 }, (_, i) => ({ serial: `u-1-${i}`, dna: ubu.toCode(ubu.randomDNA()), superId: i + 3 }))
  ];
  const initialServerBodies = P.kickoff();
  initialServerBodies.slice(0, 6).forEach((b, i) => {
    const entry = i < 3 ? rosters[0][i] : rosters[1][i - 3];
    ububallMatch.applyStats(P, b, ubu.decode(ubu.fromCode(entry.dna)).stats, 'standard');
    b.meter = 20;
  });
  const serverPlans = Array.from({ length: 6 }, (_, i) => ({
    angle: i === 3 ? Math.PI : 0, power: 0.5, spin: 0, superArm: false, guard: false
  }));
  const postTurnBodies = structuredClone(initialServerBodies);
  P.startTurn(postTurnBodies, serverPlans);
  const ticks = 10;
  for (let t = 0; t < ticks; t++) P.step(postTurnBodies, P.DT);
  P.stop(postTurnBodies);

  const savedLocalRoster = [{ key: 'my-ubu-1' }, { key: 'my-ubu-2' }, { key: 'my-ubu-3' }];
  let nowMs = 1000, endedGoalReplays = 0, clearedReplayViewers = 0;
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
    P, ubu, ububallMatch, ububallReplay, performance: { now: () => nowMs },
    $,
    inDiscord: true, inMatch: false, demo: false,
    matchInProgress: () => true,
    finishCpuMatch: dummy,
    clearReplayViewer: () => { clearedReplayViewers++; },
    cpuClient: { cancel: dummy, dispose: dummy },
    demoClient: { cancel: dummy, dispose: dummy },
    closeFirstTurnGuide: dummy, closeFoulInfo: dummy,
    document: { body: { classList: { contains: () => true, toggle: dummy, add: dummy, remove: dummy } } },
    summaryDialog: null,
    closeLobby: dummy, stopDemo: dummy, enterMatch: dummy, showMode: dummy, closeSummary: dummy,
    classicMode: () => false, buildTeam: dummy, dirtyPrediction: dummy,
    endGoalReplay: () => { endedGoalReplays++; context.goalReplay = null; },
    stopFanfare: dummy, clearEffects: dummy,
    trailPositions: () => context.bodies.map(b => ({ x: b.x, y: b.y })),
    clearDiscontinuousTrails: dummy,
    recordSegment: dummy, saveEvent: (tick, e) => ({ tick, ...e }),
    sync: dummy, draw: dummy, recordTrails: dummy, emitSkaterEffects: dummy,
    announceFouls: dummy, foulText: () => '', say: dummy, popup: dummy, impact: dummy,
    creditSave: dummy, celebrate: dummy, ballOnFire: () => false, lightNet: dummy,
    queueSummary: dummy, goalTab: dummy, callText: () => '', honourText: () => '', loopFanfare: dummy,
    resolveEquippedSuper: (entry, i) => entry?.equippedSuper || P.SUPERS[i % P.SUPERS.length],
    anonymousName: i => `Anon ${i}`, anonymousNames: false,
    replayStore: { add: () => Promise.resolve(1) },
    replayFx: { hit: dummy, wall: dummy, shock: dummy, super: dummy },
    guides: { moves: false, trails: false },
    onlinePhase: 'plan', onlineRoster: '', onlineTurn: 0, onlineDisconnected: false,
    onlineReplay: null, recording: null, recordingOnline: false,
    goalReplay: null, goalReplayAt: 0, scoringPlayer: null, theater: null, postGoal: null,
    matchMode: 'standard', roster: [...savedLocalRoster], teamEntries: [], stats: [],
    plans: Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false })),
    scores: [0, 0], turn: 1, phase: 'plan', drag: null, kickoffGlow: 0,
    fouls: ububallMatch.newFouls(), dirtyMeters: new Set(),
    bodies: P.kickoff(), simBodies: P.kickoff(),
    online: { active: true, spectating: false, now: () => nowMs, state: null }
  };

  const env = ububallPlayback.bindMatchHarness(context);
  const displayRefs = [...context.bodies];
  assert.equal(env.onlineCallbacks.cpuActive(), true);

  // 1. Seat-1 resolving state: mirrored coordinates, no presentation keys in simBodies, local roster preserved
  const resolvingState = {
    seat: 1, spectator: false, mode: 'standard', phase: 'resolving', turn: 1, winner: null,
    names: ['Alice', 'Bob'], occupied: [true, true], connected: [true, true], locked: [true, true],
    left: [false, false], rematch: [false, false], rosters,
    moves: [
      { angle: Math.PI, power: 0.5, spin: 0, superArm: false, guard: false },
      { angle: 0, power: 0.5, spin: 0, superArm: false, guard: false },
      { angle: 0, power: 0.5, spin: 0, superArm: false, guard: false }
    ],
    game: {
      scores: [0, 1],
      bodies: structuredClone(postTurnBodies),
      fouls: { ...ububallMatch.newFouls(), crease: [true, false], corner: 0, cornerTurns: 1, cards: [] },
      stats: Array.from({ length: 6 }, () => ({}))
    },
    replay: {
      turn: 1, startedAt: 1000, ticks,
      initialBodies: structuredClone(initialServerBodies),
      plans: structuredClone(serverPlans),
      saves: [], stops: [], struck: [], goal: 1, label: 'GOAL', scorer: 3, assist: null
    }
  };
  context.online.state = resolvingState;
  env.onlineCallbacks.onState(resolvingState);

  assert.equal(context.phase, 'play');
  assert.ok(clearedReplayViewers >= 1);
  assert.deepEqual(context.roster, savedLocalRoster);
  assert.deepEqual([...context.scores], [0, 0], 'pre-goal score held before goal tick');
  for (let i = 0; i < 7; i++) {
    assert.equal('name' in context.onlineReplay.simBodies[i], false);
    assert.equal(context.bodies[i], displayRefs[i]);
  }
  assert.equal(context.bodies[0].x, 1000 - context.onlineReplay.simBodies[3].x);

  // 2. Step past replay ticks -> goalPlayed updates score to [1, 0] for seat 1, fouls flipped
  nowMs = 1000 + Math.ceil((ticks + 2) * P.DT * 1000);
  env.playOnlineReplay();
  assert.equal(context.onlineReplay.currentTick, ticks);
  assert.equal(context.onlineReplay.goalPlayed, true);
  assert.deepEqual([...context.scores], [1, 0]);
  assert.equal(context.bodies[0].x, 1000 - postTurnBodies[3].x);
  assert.deepEqual([...context.fouls.crease], [false, true]);
  assert.equal(context.fouls.corner, 3);

  // 3. Same-turn re-broadcast keeps score [1, 0] and active goalReplay
  context.goalReplay = { sim: P.kickoff(), seat: 1 };
  const rebroadcast = JSON.parse(JSON.stringify(resolvingState));
  context.online.state = rebroadcast;
  env.onlineCallbacks.onState(rebroadcast);
  assert.deepEqual([...context.scores], [1, 0]);
  assert.ok(context.goalReplay);

  // 4. Fresh resolving turn (skipping plan) tears down stale goalReplay
  endedGoalReplays = 0;
  const turn2Resolving = JSON.parse(JSON.stringify({
    ...resolvingState, turn: 2, game: { ...resolvingState.game, scores: [0, 2] },
    replay: { ...resolvingState.replay, turn: 2, startedAt: nowMs }
  }));
  context.online.state = turn2Resolving;
  env.onlineCallbacks.onState(turn2Resolving);
  assert.ok(endedGoalReplays >= 1);
  assert.equal(context.onlineReplay.turn, 2);

  // 5. Next plan phase rotates seat-1 plan angles by +PI and clears onlineReplay
  const nextPlanState = {
    ...resolvingState, phase: 'plan', turn: 3, locked: [false, false], replay: null,
    moves: [
      { angle: Math.PI / 2, power: 0.75, spin: 0, superArm: true, guard: false },
      { angle: 0, power: 0, spin: 0, superArm: false, guard: false },
      { angle: 0, power: 0, spin: 0, superArm: false, guard: false }
    ]
  };
  context.online.state = nextPlanState;
  env.onlineCallbacks.onState(nextPlanState);
  assert.equal(context.phase, 'plan');
  assert.equal(context.onlineReplay, null);
  assert.ok(Math.abs(context.plans[0].angle - 1.5 * Math.PI) < 1e-9);
  assert.equal(context.bodies[0].superArm, true);
  for (let i = 0; i < 7; i++) assert.equal(context.bodies[i], displayRefs[i]);
});

test('straight vertical shots skip threat simulation, but curved shots do not', () => {
  const bodies = P.kickoff();
  let stepCalls = 0;
  const spyP = { ...P, step: (...args) => { stepCalls++; return P.step(...args); } };
  const presenter = ububallPresentation.createRinkPresenter({
    P: spyP,
    ububallMatch,
    ububallReplay,
    getView: () => ({ bodies, entries: [], mode: 'standard' }),
    getEffects: () => ububallPresentation.createEffectsState([], {})
  });

  // Straight vertical shot near center cannot reach either goal horizontally -> zero simulation steps
  Object.assign(bodies[6], { x: 500, y: 300, vx: 0, vy: 500, omega: 0 });
  assert.equal(presenter.goalThreat(), null);
  assert.equal(stepCalls, 0);

  // Vertical shot with strong spin near the right goal bends toward the mouth -> runs threat simulation
  Object.assign(bodies[6], { x: 850, y: 420, vx: 0, vy: -500, omega: 18 });
  presenter.goalThreat();
  assert.ok(stepCalls > 0, 'curved vertical shot simulates threat');
});

test('predictionKey invalidates on micro angle/power adjustments, fouls, and carded changes', () => {
  const bodies = P.kickoff();
  const fouls = ububallMatch.newFouls();
  const plans = [
    { angle: 0.5, power: 0.6, spin: 0, guard: false, superArm: false },
    { angle: 0, power: 0, spin: 0, guard: false, superArm: false },
    { angle: 0, power: 0, spin: 0, guard: false, superArm: false }
  ];
  const presenter = ububallPresentation.createRinkPresenter({
    P,
    ububallMatch,
    ububallReplay,
    getView: () => ({ bodies, entries: [], mode: 'standard' }),
    getEffects: () => ububallPresentation.createEffectsState([], {}),
    getFouls: () => fouls,
    getPlans: () => plans,
    getTurn: () => 1
  });

  const base = presenter.predictionKey();
  plans[0].angle += 0.0001;
  const afterAngle = presenter.predictionKey();
  assert.notEqual(afterAngle, base);

  plans[0].power += 0.0001;
  const afterPower = presenter.predictionKey();
  assert.notEqual(afterPower, afterAngle);

  fouls.crease[0] = true;
  const afterFoul = presenter.predictionKey();
  assert.notEqual(afterFoul, afterPower);

  bodies[0].carded = true;
  const afterCard = presenter.predictionKey();
  assert.notEqual(afterCard, afterFoul);
});
