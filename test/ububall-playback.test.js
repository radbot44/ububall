/* Direct require-based tests for web/ububall-playback.js and unified frame() playback path. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../shared/ububall-physics.js');
const ububallMatch = require('../shared/ububall-match.js');
const ubu = require('../shared/ubu.js');
const ububallPlayback = require('../web/ububall-playback.js');
const source = fs.readFileSync(require.resolve('../web/ububall.js'), 'utf8');

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

  // Second sync reuses PROJECTED_STATIC references without cloning static identity fields
  projector.syncViewBodies(sim, 0, target, false, dirty, entries);
  assert.equal(target[0].personality, cachedPersonality, 'PROJECTED_STATIC reuses personality object');
  assert.equal(target[0].equippedSuper, cachedSuper, 'PROJECTED_STATIC reuses equippedSuper object');

  // Seat 1 mirrors rink coordinates and flips strikerTeam
  projector.syncViewBodies(sim, 1, target, false, dirty, entries);
  assert.equal(target[3].x, 1000 - 240);
  assert.equal(target[3].y, 600 - 190);
  assert.equal(target[6].strikerTeam, 1);

  // Toggling anonymous invalidates cached name
  anon = true;
  projector.syncViewBodies(sim, 0, target, true, dirty, entries);
  assert.equal(target[0].name, 'Anon 0');
});

test('ububall-playback: stepOnlineTurn records trails on every 240 Hz tick and spawns postGoal slow-mo on online goals', () => {
  const initial = P.kickoff();
  const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };
  initial.slice(0, 6).forEach(b => P.applyStats(b, normal));
  // Fast ball moving 1,440 px/s (6 px per tick -> >5 px threshold every single tick)
  Object.assign(initial[6], { x: 880, y: 300, vx: 1440, vy: 0 });

  const plans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false }));
  const simBodies = ububallPlayback.stripPresentation(structuredClone(initial));
  P.startTurn(simBodies, plans);

  const viewBodies = P.kickoff();
  const projector = ububallPlayback.createBodyProjector({
    P,
    getShownSim: () => simBodies,
    getShownSeat: () => 0,
    getTargetBodies: () => viewBodies
  });

  const trailSamples = [];
  let nowMs = 1000;
  const driver = ububallPlayback.createPlaybackDriver({
    P,
    ububallMatch,
    clockNow: () => nowMs,
    impact: () => {},
    creditSave: () => {},
    popup: () => {},
    getBallView: () => viewBodies[6],
    traceGuide: () => {},
    recordTrails: () => { trailSamples.push({ x: viewBodies[6].x, y: viewBodies[6].y }); }
  });

  const replay = {
    turn: 1,
    startedAt: 1000,
    ticks: 8,
    currentTick: 0,
    simBodies,
    plans,
    saves: [],
    stops: [],
    struck: [],
    goal: 0,
    label: 'GOAL',
    scorer: 0,
    assist: null
  };

  // Advance 1 frame (~4 ticks at 60 Hz): must record 4 distinct per-tick trail samples, not just 1
  nowMs = 1000 + 4 * P.DT * 1000 + 0.1;
  let goalReached = 0;
  driver.stepOnlineTurn({
    replay,
    nowMs,
    seat: 0,
    fouls: ububallMatch.newFouls(),
    fx: {},
    syncSim: () => projector.syncViewBodies(replay.simBodies, 0, viewBodies),
    toView: b => projector.toViewBody(b, replay.simBodies, 0, viewBodies),
    onGoalReached: () => { goalReached++; }
  });
  assert.equal(replay.currentTick, 4);
  assert.equal(trailSamples.length, 4, 'online playback records trails on each stepped 240 Hz tick');
  assert.ok(trailSamples[3].x > trailSamples[0].x + 12);
  assert.equal(goalReached, 0);

  // Advance past goal tick (tick 8): fires onGoalReached and lets advancePostGoal glide skaters in slow-mo
  nowMs = 1000 + 10 * P.DT * 1000;
  let postGoal = null;
  driver.stepOnlineTurn({
    replay,
    nowMs,
    seat: 0,
    fouls: ububallMatch.newFouls(),
    fx: {},
    syncSim: () => projector.syncViewBodies(replay.simBodies, 0, viewBodies),
    toView: b => projector.toViewBody(b, replay.simBodies, 0, viewBodies),
    onGoalReached: () => {
      goalReached++;
      const celebSim = structuredClone(replay.simBodies);
      celebSim[0].vx = 300; // moving celebration skater
      postGoal = { ticks: 0, sim: celebSim, seat: 0 };
    }
  });
  assert.equal(goalReached, 1);
  assert.ok(postGoal, 'online goal spawns postGoal slow-mo state');

  const xBefore = postGoal.sim[0].x;
  const postGoalState = { steps: 0, onTick: null };
  const speed = ububallMatch.postGoalSpeed(postGoal.ticks);
  const stillGliding = driver.advancePostGoal(
    postGoal,
    postGoalState,
    (1 / 60) * speed,
    {},
    () => projector.syncViewBodies(postGoal.sim, 0, viewBodies)
  );
  assert.equal(stillGliding, true, 'moving post-goal skaters continue gliding');
  assert.ok(postGoal.ticks >= 2, 'post-goal stepped multiple ticks');
  assert.ok(postGoal.sim[0].x > xBefore, 'celebrating skater glides forward instead of freezing or snapping to kickoff');
  assert.equal(postGoal.sim[6].vx, 0, 'scored ball stays pinned in the net');
});

test('frame() unified rendering path: single draw() per frame and simDelta passed to emitSkaterEffects online', () => {
  let draws = 0, playOnlineCalls = 0, advanceGoalCalls = 0, postGoalCalls = 0;
  const skaterDeltas = [];
  let hitStopUntil = 0, now = 1000;

  const ctx = {
    Math, Boolean,
    P,
    ububallMatch,
    performance: { now: () => now },
    clockNow: () => now,
    lastTime: 1000,
    accumulator: 0,
    elapsed: 0,
    firstTurnStep: null,
    demo: false,
    phase: 'play',
    roundTurns: 0,
    goalReplay: null,
    goalReplayAt: 0,
    goalReplayDelayMs: 0,
    postGoal: null,
    theater: null,
    dragDirty: false,
    hitStopUntil: 0,
    simBodies: P.kickoff(),
    play: ububallMatch.newPlay(),
    tally: ububallMatch.newTally(),
    fouls: ububallMatch.newFouls(),
    scores: [0, 0],
    liveFx: {},
    replayFx: {},
    replaySkip: { hidden: true },
    reducedMotion: { matches: false },
    presenter: { getPredictionCache: () => null },
    fieldView: { mode: 'standard', bodies: P.kickoff() },
    fieldEffects: {
      particles: [{}], fireworks: [], trails: [[{ x: 0, y: 0 }]], shockwaves: [],
      goalCall: null, fireWarp: 0, koWarp: 0, ripples: [], pings: [], popups: [],
      kickoffGlow: 0, goalSweep: null, danger: [0, 0]
    },
    online: { active: true, state: { seat: 0 } },
    onlineReplay: { currentTick: 0, ticks: 20, settledSynced: false },
    localPlayBlocked: () => false,
    updateLocalPlanClock: () => {},
    updateClock: () => {},
    networkMoves: () => [],
    startGoalReplay: () => {},
    banner: () => {},
    updateReplaySkip: () => {},
    pulseMode: () => false,
    blitzMode: () => false,
    isExporting: () => false,
    updatePopups: () => {},
    updateEffects: () => {},
    advanceReplay: () => { draws++; },
    advanceGoalReplay: () => { advanceGoalCalls++; draws++; },
    playOnlineReplay: () => { playOnlineCalls++; ctx.onlineReplay.currentTick += 3; },
    advancePostGoal: () => { postGoalCalls++; return true; },
    emitSkaterEffects: dt => { skaterDeltas.push(dt); },
    syncViewBodies: () => {},
    applyTickEvents: () => false,
    noteEvents: () => {},
    recordTrails: () => {},
    traceGuide: () => {},
    finishTurn: () => {},
    foulsShowing: () => false,
    sync: () => {},
    draw: () => { draws++; },
    animateFirstTurnGuide: () => {},
    flushMeters: () => {},
    requestAnimationFrame: () => {},
    $: () => ({ click() {} })
  };
  Object.defineProperty(ctx, 'hitStopUntil', { get: () => hitStopUntil });

  const { frame: runFrame } = ububallPlayback.createFrameLoop(ctx);

  // 1. 120 Hz frame (8.333 ms) during online turn playback: exactly ONE draw(), real 8.333ms simDelta (not 1/60)
  now = 1008.333;
  runFrame(now);
  assert.equal(playOnlineCalls, 1);
  assert.equal(draws, 1, 'online turn playback calls draw() exactly once per frame even when hadEffects is true');
  assert.ok(Math.abs(skaterDeltas[0] - 0.008333) < 1e-5, `emitSkaterEffects receives real 120Hz delta (${skaterDeltas[0]}), not hardcoded 1/60`);

  // 2. Hit-stop active during online playback: simDelta is 0
  draws = 0; skaterDeltas.length = 0;
  hitStopUntil = 2000;
  now = 1016.666;
  runFrame(now);
  assert.equal(draws, 1, 'still draws exactly once during online hit-stop');
  assert.equal(skaterDeltas[0], 0, 'emitSkaterEffects receives 0 simDelta during hit-stop');

  // 3. Online postGoal slow-motion glide after turn finishes: uses postGoalSpeed and draws once
  hitStopUntil = 0;
  draws = 0; skaterDeltas.length = 0;
  ctx.onlineReplay.currentTick = 20;
  ctx.postGoal = { ticks: 72, sim: P.kickoff(), seat: 0 }; // at 72 ticks, postGoalSpeed === 0.5
  now = 1032.666; // 16 ms frame
  runFrame(now);
  assert.equal(postGoalCalls, 1, 'online postGoal runs shared advancePostGoal slow-mo driver');
  assert.equal(draws, 1, 'online postGoal draws once');
  assert.ok(Math.abs(skaterDeltas[0] - 0.008) < 1e-5, 'online postGoal scales skater effects by 0.5x slow-mo speed');

  // 4. Online goalReplay: runs advanceGoalReplay once and does NOT fall into trailing hadEffects draw()
  ctx.postGoal = null;
  ctx.onlineReplay.settledSynced = true;
  ctx.goalReplay = { played: 10, total: 100 };
  draws = 0;
  now = 1048.666;
  runFrame(now);
  assert.equal(advanceGoalCalls, 1);
  assert.equal(draws, 1, 'online goalReplay draws once without double-drawing in trailing hadEffects branch');
});

test('render interpolation blends x, y, rotation across fractional alpha and snaps across teleports', () => {
  const sim = P.kickoff();
  sim[0].x = 200; sim[0].y = 300; sim[0].rotation = 1;
  const view = P.kickoff();
  const projector = ububallPlayback.createBodyProjector({
    P,
    getEntries: () => null,
    getAnonymous: () => false,
    anonymousName: i => `Ubu ${i + 1}`,
    isClassicMode: () => false,
    resolveEquippedSuper: () => P.SUPERS[0],
    getShownSim: () => sim,
    getShownSeat: () => 0,
    getTargetBodies: () => view,
    getDirtyMeters: () => null,
    superStats: () => ({})
  });
  projector.syncViewBodies(sim, 0, view);
  projector.capturePose(sim, 0);
  sim[0].x = 210; sim[0].y = 304; sim[0].rotation = 1.4;
  projector.syncInterpolatedBodies(0.25, sim, 0, view);
  assert.ok(Math.abs(view[0].x - 202.5) < 1e-9);
  assert.ok(Math.abs(view[0].y - 301) < 1e-9);
  assert.ok(Math.abs(view[0].rotation - 1.1) < 1e-9);
  // Larger than 80 px jump snaps immediately to sim instead of interpolating across the rink
  projector.capturePose(sim, 0);
  sim[0].x = 400; sim[0].y = 304;
  projector.syncInterpolatedBodies(0.5, sim, 0, view);
  assert.equal(view[0].x, 400);
});

test('match shortcuts do not hijack focused buttons or other controls', () => {
  let keydown, launches = 0, syncs = 0;
  const context = {
    document: {
      addEventListener(type, listener) { if (type === 'keydown') keydown = listener; },
      querySelector() { return null; }
    },
    shot: 'match', cameraMove: null, theater: null, foulInfo: null, selected: 0,
    isMatchShot: () => context.shot === 'match' || context.shot === 'replay',
    playableShot: () => context.shot === 'match' && !context.cameraMove,
    ownsFullscreen: () => false,
    sync: () => { syncs++; }, draw() {},
    $: id => {
      assert.equal(id, 'launch');
      return { click: () => { launches++; } };
    }
  };
  ububallPlayback.bindMatchShortcuts(context);
  const press = (key, control = null) => {
    let prevented = false;
    const target = {
      closest: selector => control && selector.split(',').map(s => s.trim()).includes(control) ? {} : null,
      blur: () => assert.fail('a shortcut must not blur a focused control')
    };
    keydown({ key, target, ctrlKey: false, altKey: false, metaKey: false,
      preventDefault: () => { prevented = true; } });
    return prevented;
  };
  for (const control of ['button', 'a', 'input', 'textarea', '[tabindex]', '[contenteditable]']) {
    assert.equal(press('Enter', control), false, `${control} must keep Enter`);
    assert.equal(press(' ', control), false, `${control} must keep Space`);
  }
  assert.equal(launches, 0);
  assert.equal(context.selected, 0);
  assert.equal(press('Enter'), true);
  assert.equal(launches, 1, 'Enter still launches when the rink has focus');
  assert.equal(press(' '), true);
  assert.equal(context.selected, 1, 'Space still selects the next player');
  assert.equal(syncs, 1);
});

test('local, online, and saved replay state boundaries clear repositioned trails', () => {
  const playbackSrc = fs.readFileSync(require.resolve('../web/ububall-playback.js'), 'utf8');
  for (const [start, end] of [
    ['function finishTurn(goal) {', 'function onGuestTeam()'],
    ['function nextReplaySegment() {', 'function restartGoalReplay()'],
    ['onSettledTurnEnd: () => {', 'if (!replay.fouled)'],
    ['const before = !fresh && !s.replay', 'if (!s.replay) {']
  ]) {
    const a = playbackSrc.indexOf(start);
    const b = playbackSrc.indexOf(end, a);
    assert.ok(a >= 0 && b > a, `playback source boundary missing: ${start} .. ${end}`);
    assert.match(playbackSrc.slice(a, b), /clearDiscontinuousTrails\b[\s\S]*?\(before\)/);
  }
  const theaterSrc = fs.readFileSync(require.resolve('../web/ububall-theater.js'), 'utf8');
  const a = theaterSrc.indexOf('function endReplayTurn(');
  const b = theaterSrc.indexOf('function advanceReplay(', a);
  assert.ok(a >= 0 && b > a);
  assert.match(theaterSrc.slice(a, b), /clearDiscontinuousTrails\(before\)/);
});

test('creditSave generates Trap! callout for friendly iron saves and Big save! for opposing', () => {
  const popups = [];
  const popup = (body, text) => popups.push({ text, own: body.team });
  const context = {
    popup, steamRing() {}, gameAudio: () => ({ playIronSave() {} }),
    online: null, goalReplay: null, theater: null,
    ububallMatch: { gainMeter: () => [], METER: { save: 6 } },
    classicMode: () => true, dirtyMeters: new Set(), P: {}, bodies: [], simBodies: [], stats: {}
  };
  const { creditSave } = ububallPlayback.createMeterController(context);
  creditSave({ team: 0, x: 0, y: 0, radius: 10 }, true, true);
  creditSave({ team: 1, x: 0, y: 0, radius: 10 }, false, true);
  creditSave({ team: 0, x: 0, y: 0, radius: 10 }, false, false);
  assert.equal(popups[0].text, 'Trap!');
  assert.equal(popups[1].text, 'Big save!');
  assert.equal(popups[2].text, 'Save!');
});

test('theater.exporting suppresses popup and effect aging in animation frame loop', () => {
  let popupsUpdated = 0, effectsUpdated = 0, replayAdvanced = 0;
  const updatePopups = () => { popupsUpdated++; };
  const updateEffects = () => { effectsUpdated++; };
  const advanceReplay = () => { replayAdvanced++; };
  const pulseMode = () => false, clockNow = () => 1000, hitStopUntil = 0;
  const delta = 0.016;
  const active = true, roundTurns = 0, phase = 'replay';

  // 1. During video export: theater.exporting is true. Animation loop must NOT age popups or effects.
  let theater = { paused: false, exporting: true, speed: 1 };
  ububallPlayback.stepFrameEffects({
    pulseMode, roundTurns, phase, active, clockNow, hitStopUntil, theater,
    delta, popups: [], updatePopups, updateEffects, advanceReplay, ububallMatch: {}, goalReplay: null, postGoal: null
  });
  assert.equal(popupsUpdated, 0, 'popups must not update during RAF while exporting');
  assert.equal(effectsUpdated, 0, 'effects must not update during RAF while exporting');
  assert.equal(replayAdvanced, 0, 'replay must not advance during RAF while exporting');

  // 2. Normal replay playback: theater.exporting is false. Animation loop updates popups and effects.
  theater = { paused: false, exporting: false, speed: 1 };
  ububallPlayback.stepFrameEffects({
    pulseMode, roundTurns, phase, active, clockNow, hitStopUntil, theater,
    delta, popups: [], updatePopups, updateEffects, advanceReplay, ububallMatch: {}, goalReplay: null, postGoal: null
  });
  assert.equal(popupsUpdated, 1, 'popups update during normal replay playback');
  assert.equal(effectsUpdated, 1, 'effects update during normal replay playback');
  assert.equal(replayAdvanced, 1, 'replay advances during normal replay playback');

  // 3. Normal gameplay: theater is null. Animation loop updates popups and effects.
  theater = null;
  ububallPlayback.stepFrameEffects({
    pulseMode, roundTurns, phase: 'play', active, clockNow, hitStopUntil, theater,
    delta, popups: [], updatePopups, updateEffects, advanceReplay, ububallMatch: {}, goalReplay: null, postGoal: null
  });
  assert.equal(popupsUpdated, 2, 'popups update during gameplay');
  assert.equal(effectsUpdated, 2, 'effects update during gameplay');
});

test('restoreEntry restores Stalwart ID 0 and mastery metadata, preserving null for unsaved', () => {
  const P = require('../shared/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const restoreEntry = saved => ububallPlayback.restoreEntry(P, ubu, saved);

  const sampleDna = ubu.toCode(ubu.randomDNA());
  // 1. Stalwart (id: 0) restored with full mastery object
  const restoredStalwart = restoreEntry({
    dna: sampleDna,
    label: 'Ubu 1',
    equippedSuper: { id: 0 }
  });
  assert.ok(restoredStalwart);
  assert.ok(restoredStalwart.equippedSuper);
  assert.equal(restoredStalwart.equippedSuper.id, 0);
  assert.equal(restoredStalwart.equippedSuper.key, 'stalwart');
  assert.equal(typeof restoredStalwart.equippedSuper.bonusTicks, 'number');

  // 2. Unsaved super (null or missing id) preserves null
  const restoredNull = restoreEntry({
    dna: sampleDna,
    label: 'Ubu 2',
    equippedSuper: null
  });
  assert.ok(restoredNull);
  assert.equal(restoredNull.equippedSuper, null);

  // 3. Practice ubu with Stalwart
  const practiceDna = sampleDna;
  const restoredPractice = restoreEntry({
    key: 'guest-0',
    dna: practiceDna,
    equippedSuper: { id: 0 }
  });
  assert.ok(restoredPractice);
  assert.equal(restoredPractice.dna, practiceDna);
  assert.equal(restoredPractice.model.parts.fullName, ubu.decode(ubu.fromCode(practiceDna)).parts.fullName);
  assert.ok(restoredPractice.equippedSuper);
  assert.equal(restoredPractice.equippedSuper.id, 0);
  assert.equal(restoredPractice.equippedSuper.key, 'stalwart');
});

test('local Blitz preserves the deadline across blocked frames and hidden time', () => {
  let now = 100;
  let gameDialog = false;
  const dialog = { open: false };
  const context = {
    performance: { now: () => now }, document: { hidden: false, querySelector: () => gameDialog ? {} : null },
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
  assert.equal(context.planDeadline - now, 2000, 'match offers preserve the CPU planning clock');
  now = 15600; context.shot = 'home'; refresh();
  now = 19600; context.shot = 'match'; refresh();
  assert.equal(context.planDeadline - now, 1500, 'returning home pauses the CPU planning clock');
  context.online = { active: true };
  dialog.open = true; refresh();
  assert.equal(context.planPausedAt, null);
});

test('active match save and restore enforces matching matchVersion and physicsVersion', () => {
  assert.ok(
    source.indexOf('PRESENTATION_KEYS,') < source.indexOf('restoredMatch = restoreActiveMatch();') &&
    source.indexOf('viewIndex,') < source.indexOf('restoredMatch = restoreActiveMatch();'),
    'projection constants and viewIndex must initialize before startup match restore/newMatch'
  );
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');
  let store = {};
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

  // Save active match: verify physics is written
  env.saveActiveMatch();
  assert.ok(store['ububall-active-match']);
  const parsed = JSON.parse(store['ububall-active-match']);
  assert.equal(parsed.version, ububallMatch.VERSION);
  assert.equal(parsed.physics, P.VERSION);

  // Restore with matching versions succeeds
  parsed.play.last = 2;
  parsed.play.assist[0] = 1;
  parsed.play.credit[2] = 1;
  parsed.roundTurns = 3;
  parsed.matchTicks = 701;
  parsed.bodies[2].meterTick = 700;
  store['ububall-active-match'] = JSON.stringify(parsed);
  const ok = env.restoreActiveMatch();
  assert.equal(ok, true);
  env.saveActiveMatch();
  const resaved = JSON.parse(store['ububall-active-match']);
  assert.deepEqual(resaved.play, parsed.play);
  assert.equal(resaved.roundTurns, 3);
  assert.equal(resaved.matchTicks, 701);
  assert.equal(resaved.bodies[2].meterTick, 700);

  const turnPlans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0.25 }));
  const launch = { ...parsed, phase: 'play', turnPlans };
  store['ububall-active-match'] = JSON.stringify(launch);
  assert.equal(env.restoreActiveMatch(), true);
  env.saveActiveMatch({ bodies: P.kickoff(), turnPlans });
  const resumed = JSON.parse(store['ububall-active-match']);
  assert.equal(resumed.phase, 'play');
  assert.deepEqual(resumed.play, parsed.play);
  assert.equal(resumed.roundTurns, 3);
  assert.equal(resumed.matchTicks, 701);

  const legacy = { ...parsed, recording: { turns: [{ ticks: 240 }, { ticks: 80, goal: { team: 0 } }, { ticks: 120 }] } };
  delete legacy.play;
  delete legacy.roundTurns;
  delete legacy.matchTicks;
  store['ububall-active-match'] = JSON.stringify(legacy);
  assert.equal(env.restoreActiveMatch(), true);
  env.saveActiveMatch();
  const recovered = JSON.parse(store['ububall-active-match']);
  assert.equal(recovered.play.last, null);
  assert.equal(recovered.roundTurns, 1);
  assert.equal(recovered.matchTicks, 440);
  assert.equal(recovered.bodies[2].meterTick, undefined);

  // Restore with mismatched physics version fails and clears storage
  parsed.physics = P.VERSION + 1;
  store['ububall-active-match'] = JSON.stringify(parsed);
  assert.equal(env.restoreActiveMatch(), false);
  assert.equal(store['ububall-active-match'], undefined);

  // Restore with missing physics version (legacy save) fails and clears storage
  delete parsed.physics;
  store['ububall-active-match'] = JSON.stringify(parsed);
  assert.equal(env.restoreActiveMatch(), false);
  assert.equal(store['ububall-active-match'], undefined);

  // Standby setup prepares the rink without creating a recording or saving an active match
  let resetCalls = 0;
  const standbyCtx = {
    Object, Array, Set, Math, Number, String, Boolean,
    P, ububallMatch, ububallReplay, localStorage, structuredClone,
    inDiscord: false, demo: false, online: null, phase: 'plan', recording: null,
    matchMode: 'standard', cpuMode: 'standard', cpuLevel: 'medium', scores: [0, 0], turn: 1, selected: 0,
    elapsed: 0, accumulator: 0, drag: null, playSegments: [],
    cpuTeam: [], starterEntries: () => Array.from({ length: 3 }, () => ({ dna: 'a', label: 'a', model: { stats: {} } })),
    draft: Array.from({ length: 3 }, () => ({ dna: 'a', label: 'a', model: { stats: {} } })),
    fouls: { crease: [false, false], corner: null, cornerTurns: 0, cards: [] },
    tally: {}, roster: [{ dna: 'a', label: 'a' }], teamEntries: [{ dna: 'a', label: 'a' }], stats: [],
    bodies: P.kickoff(), simBodies: P.kickoff(), plans: [], cpu: [], cpuDone: false,
    authoritativeBodies: null, kickoffGlow: 0, netFire: null, scoringPlayer: null, roundTurns: 0, matchTicks: 0, play: {},
    clearEffects: dummy, closeSummary: dummy, saveRecording: () => { standbyCtx.recording = null; },
    resetPlans: () => { resetCalls++; },
    resolveEquippedSuper: () => P.SUPERS[0], anonymousName: i => `Anon ${i}`, anonymousNames: false,
    shownSim: () => P.kickoff(), shownSeat: () => 0,
    endGoalReplay: dummy, showMode: dummy, classicMode: () => false,
    stopFanfare: dummy, gameAudio: () => null, buildTeam: dummy,
    normalStats: () => ({}), idlePlan: () => ({ angle: 0, power: 0, spin: 0 }),
    document: { body: { classList: { toggle: dummy } }, querySelector: () => null },
    restoreEntry: e => e, dirtyMeters: new Set(), startPlanClock: dummy, prepareCPU: dummy,
    sync: dummy, draw: dummy, say: dummy, recordSegment: dummy, beginGuide: dummy, liveFx: { super: dummy }
  };
  const standbyEnv = ububallPlayback.bindMatchHarness(standbyCtx);
  standbyEnv.newMatch(false, standbyCtx.draft, { standby: true });
  assert.equal(standbyCtx.recording, null);
  assert.equal(resetCalls, 0);
  assert.equal(store['ububall-active-match'], undefined);
  assert.equal(standbyEnv.restoreActiveMatch(), false);
});

test('contactMeter and creditSave reject meter awards outside phase === play', () => {
  const P = require('../shared/ububall-physics.js');
  let calledGain = 0, calledContact = 0;
  const ububallMatch = {
    METER: { save: 6 },
    gainMeter() { calledGain++; return []; },
    contactMeter() { calledContact++; return []; }
  };
  const dirtyMeters = new Set();
  const ctx = {
    phase: 'goal', online: null, goalReplay: null, theater: null,
    bodies: [], simBodies: [], stats: [], classicMode: () => false, matchTicks: 0, elapsed: 0,
    P, ububallMatch, dirtyMeters, popup: () => {}, steamRing: () => {}, gameAudio: () => null
  };
  const { creditSave, contactMeter } = ububallPlayback.createMeterController(ctx);

  // 1. Outside play phase (e.g. 'goal', 'over', 'plan'), no meter calls occur
  contactMeter({}, {}, 100);
  assert.equal(calledContact, 0, 'contact meter rejected during post-goal / non-play phase');

  creditSave({}, false);
  assert.equal(calledGain, 0, 'save meter rejected during post-goal / non-play phase');

  // 2. Even if goalReplay or theater is truthy, contactMeter never awards live meter
  const replayEnv = ububallPlayback.createMeterController({
    phase: 'goal', online: null, goalReplay: { sim: [] }, theater: { sim: [] },
    bodies: [], simBodies: [], stats: [], classicMode: () => false, matchTicks: 0, elapsed: 0,
    P, ububallMatch, dirtyMeters, popup: () => {}, steamRing: () => {}, gameAudio: () => null
  });
  replayEnv.contactMeter({}, {}, 200);
  assert.equal(calledContact, 0, 'contact meter rejected during goalReplay and theater');

  // 3. In active play phase, meter functions proceed
  ctx.phase = 'play';
  contactMeter({}, {}, 100);
  assert.equal(calledContact, 1, 'contact meter allowed during active play');

  creditSave({}, false);
  assert.equal(calledGain, 1, 'save meter allowed during active play');
});

test('post-goal celebration simulation cannot alter the next kickoffs meter or gameplay state', () => {
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ubu = require('../shared/ubu.js');
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
  const bodies = P.kickoff();

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
    scores: [0, 0], bodies, simBodies, authoritativeBodies: null, postGoal: null, scoringPlayer: null, phase: 'play', performance
  };

  const env = ububallPlayback.bindMatchHarness(context);

  // 1. Goal scored: finishTurn runs
  env.finishTurn(0);

  // Authoritative bodies were preserved immediately after finishTurn
  const auth = context.authoritativeBodies;
  assert.ok(auth, 'authoritativeBodies snapshot was preserved');
  assert.equal(auth[0].meter, 50);

  // 2. Post-goal celebration simulation occurs on live display bodies and postGoal.sim:
  // Skaters collide, mutates bodies / postGoal.sim, runs stepPostGoal, etc.
  const liveBodies = context.bodies;
  liveBodies[0].meter = 99; // Corrupted / altered during post-goal celebration
  liveBodies[1].meter = 88;
  liveBodies[0].stunned = true;
  context.postGoal.sim[0].meter = 99;
  context.postGoal.sim[1].meter = 88;
  context.postGoal.sim[0].stunned = true;

  // 3. Next kickoff is triggered
  const nextKickoffBodies = env.kickoff();

  // The next kickoff inherits ONLY the authoritative meter, completely ignoring post-goal mutations!
  assert.equal(nextKickoffBodies[0].meter, 50, 'kickoff meter matches authoritative finishTurn state');
  assert.equal(nextKickoffBodies[1].meter, 30, 'kickoff meter was not corrupted by celebration mutations');
  assert.equal(nextKickoffBodies[0].stunned, false, 'kickoff stunned state matches authoritative state');
  assert.equal(context.authoritativeBodies, null, 'authoritativeBodies cleared after consumption');
});

test('display projection boundary: seat transforms, gameplay fields, presentation separation, and stable identities', () => {
  const P = require('../shared/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');

  const teamEntries = Array.from({ length: 6 }, (_, i) => {
    const dna = ubu.randomDNA();
    const model = ubu.decode(dna);
    const s = P.SUPERS[i % P.SUPERS.length];
    return {
      model,
      dna: ubu.toCode(dna),
      equippedSuper: { ...s, bonusTicks: 24, bonusRefund: 10, copies: 2 }
    };
  });

  const sim = P.kickoff();
  sim.slice(0, 6).forEach((b, i) => {
    ububallMatch.applyStats(P, b, teamEntries[i].model.stats, 'standard');
    b.meter = 10 * (i + 1);
  });
  // Populate rich gameplay, special ability, and temporary state on simulation bodies
  sim[0].x = 220; sim[0].y = 180; sim[0].vx = 45; sim[0].vy = -30; sim[0].rotation = 0.5;
  sim[0].guarding = true; sim[0].ironGuard = true; sim[0].daze = 0.35;
  sim[0].superActive = 'colossus'; sim[0].stunnedNext = true; sim[0].holding = true;
  sim[0].superTicks = 25; sim[0].usedSuperThisTurn = true;
  sim[0].futureGameplayField = 42;
  sim[0].nestedArray = [1, { tag: 'combo', values: [3, 4] }];
  sim[0].meterTick = 120; // internal simulation cooldown tick

  sim[3].x = 760; sim[3].y = 410; sim[3].vx = -60; sim[3].vy = 25; sim[3].rotation = 1.25;
  sim[3].carded = true; sim[3].superActive = 'magnet';

  sim[6].x = 640; sim[6].y = 250; sim[6].vx = 310; sim[6].vy = -90; sim[6].rotation = 2.0;
  sim[6].onFire = true; sim[6].fireTicks = 90; sim[6].pace = 420; sim[6].strikerTeam = 0;
  sim[6].curveFactor = 1.18;
  sim[6].stickOffset = { x: 18, y: -12 };
  sim[6].pinX = 950; sim[6].pinY = 300; // internal post-goal pin coordinates

  const initialDisplay = P.kickoff();
  const dirtyMeters = new Set();
  let anonymousNames = false;
  const context = {
    P, ububallMatch, teamEntries,
    bodies: initialDisplay, dirtyMeters,
    classicMode: () => false,
    resolveEquippedSuper: (entry, i) => entry?.equippedSuper || P.SUPERS[i % P.SUPERS.length],
    anonymousName: i => `${i < 3 ? 'Saffron' : 'Amethyst'} ${(i % 3) + 1}`,
    shownSim: () => sim,
    shownSeat: () => 0
  };
  Object.defineProperty(context, 'anonymousNames', { get: () => anonymousNames });

  const env = ububallPlayback.bindMatchHarness(context);

  // 1. Stable display-body references across syncViewBodies (seat 0 and seat 1)
  const refsBefore = [...initialDisplay];
  refsBefore[0]._lastHitSound = 1234;
  refsBefore[0]._lastWallSound = 5678;
  refsBefore[0].superArm = true;

  env.syncViewBodies(sim, 0);
  for (let i = 0; i < 7; i++) {
    assert.equal(context.bodies[i], refsBefore[i], `bodies[${i}] reference stays stable on seat 0 sync`);
    assert.ok(dirtyMeters.has(context.bodies[i]), `bodies[${i}] added to dirtyMeters`);
  }
  assert.equal(context.bodies[0]._lastHitSound, 1234, 'audio hit throttle preserved on display body');
  assert.equal(context.bodies[0]._lastWallSound, 5678, 'audio wall throttle preserved on display body');
  assert.equal(context.bodies[0].superArm, true, 'local armed super preserved when sim body omits superArm');

  // 2. Equivalent display output between viewBodies and syncViewBodies (ignoring transient audio throttles/superArm)
  delete sim[0].superArm;
  refsBefore[0].superArm = false;
  delete refsBefore[0]._lastHitSound;
  delete refsBefore[0]._lastWallSound;
  env.syncViewBodies(sim, 0);
  const projected0 = env.viewBodies(sim, 0);
  assert.deepEqual(structuredClone(context.bodies), structuredClone(projected0), 'syncViewBodies and viewBodies produce identical display state for seat 0');

  // 3. Explicit fixed-field projection forwards canonical gameplay and ability state without forwarding arbitrary keys
  assert.equal(context.bodies[0].reach, sim[0].reach);
  assert.equal(context.bodies[0].impulse, sim[0].impulse);
  assert.equal(context.bodies[0].guarding, true);
  assert.equal(context.bodies[0].ironGuard, true);
  assert.equal(context.bodies[0].daze, 0.35);
  assert.equal(context.bodies[0].superActive, 'colossus');
  assert.equal(context.bodies[0].superTicks, 25);
  assert.equal(context.bodies[0].usedSuperThisTurn, true);
  assert.equal(context.bodies[0].stunned, true, 'stunnedNext projects as stunned on display body');
  assert.equal(context.bodies[0].holding, true);
  assert.equal('futureGameplayField' in context.bodies[0], false, 'unprojected ad-hoc field stays off display body');
  assert.equal('nestedArray' in context.bodies[0], false, 'unprojected nested object stays off display body');
  delete sim[0].futureGameplayField;
  delete sim[0].nestedArray;
  assert.equal(context.bodies[6].onFire, true);
  assert.equal(context.bodies[6].fireTicks, 90);
  assert.equal(context.bodies[6].pace, 420);
  assert.equal(context.bodies[6].curveFactor, 1.18);
  assert.deepEqual({ ...context.bodies[6].stickOffset }, { x: 18, y: -12 });
  assert.notEqual(context.bodies[6].stickOffset, sim[6].stickOffset, 'nested stickOffset is cloned across boundary');

  // 4. Simulation-internal fields (meterTick, pinX, pinY, stunnedNext) stay out of display bodies, and presentation fields stay out of sim
  assert.equal('meterTick' in context.bodies[0], false, 'meterTick excluded from display body');
  assert.equal('pinX' in context.bodies[6], false, 'pinX excluded from display ball');
  assert.equal('pinY' in context.bodies[6], false, 'pinY excluded from display ball');
  assert.equal(context.bodies[0].name, teamEntries[0].model.parts.fullName);
  assert.equal(context.bodies[0].voice, teamEntries[0].model.voice);
  assert.equal(context.bodies[0].playerIndex, 0);
  assert.equal('name' in sim[0], false, 'name never written to simulation body');
  assert.equal('voice' in sim[0], false, 'voice never written to simulation body');
  assert.equal('playerIndex' in sim[0], false, 'playerIndex never written to simulation body');

  // Mutating display body does not mutate simulation body
  context.bodies[0].x = 999;
  context.bodies[0]._lastHitSound = 9999;
  context.bodies[6].stickOffset.x = -999;
  assert.equal(sim[0].x, 220);
  assert.equal('_lastHitSound' in sim[0], false);
  assert.equal(sim[6].stickOffset.x, 18);

  // Clearing a transient property on sim body (e.g. delete stunnedNext after finishTurn) removes it from display body
  delete sim[0].stunnedNext;
  sim[0].stunned = false;
  env.syncViewBodies(sim, 0);
  assert.equal(context.bodies[0].stunned, false);
  assert.equal('stunnedNext' in context.bodies[0], false, 'deleted transient sim key is removed from display body');

  // 5. Seat 1 orientation: team ordering, coordinate & velocity negation, rotation + PI, stickOffset & strikerTeam flip
  delete context.bodies[0]._lastHitSound;
  env.syncViewBodies(sim, 1);
  const projected1 = env.viewBodies(sim, 1);
  assert.deepEqual(structuredClone(context.bodies), structuredClone(projected1), 'syncViewBodies and viewBodies produce identical display state for seat 1');
  for (let i = 0; i < 7; i++) {
    assert.equal(context.bodies[i], refsBefore[i], `bodies[${i}] reference stays stable on seat 1 sync`);
  }
  // In seat 1, sim[3] (team 1 in server order) is projected to display index 0 (team 0 in viewer order)
  assert.equal(context.bodies[0].x, 1000 - sim[3].x);
  assert.equal(context.bodies[0].y, 600 - sim[3].y);
  assert.equal(context.bodies[0].vx, -sim[3].vx);
  assert.equal(context.bodies[0].vy, -sim[3].vy);
  assert.equal(context.bodies[0].rotation, sim[3].rotation + Math.PI);
  assert.equal(context.bodies[0].team, 0);
  assert.equal(context.bodies[0].slot, 0);
  assert.equal(context.bodies[0].playerIndex, 0);
  assert.equal(context.bodies[0].carded, true);
  assert.equal(context.bodies[0].superActive, 'magnet');
  assert.equal(env.toViewBody(sim[3], sim, 1), context.bodies[0]);

  // And sim[0] (team 0 in server order) is projected to display index 3 (team 1 in viewer order)
  assert.equal(context.bodies[3].x, 1000 - sim[0].x);
  assert.equal(context.bodies[3].y, 600 - sim[0].y);
  assert.equal(context.bodies[3].vx, -sim[0].vx);
  assert.equal(context.bodies[3].vy, -sim[0].vy);
  assert.equal(context.bodies[3].rotation, sim[0].rotation + Math.PI);
  assert.equal(context.bodies[3].team, 1);
  assert.equal(context.bodies[3].slot, 0);
  assert.equal(context.bodies[3].playerIndex, 3);
  assert.equal(env.toViewBody(sim[0], sim, 1), context.bodies[3]);

  // Ball in seat 1: coordinates, velocity, stickOffset, and strikerTeam flipped
  assert.equal(context.bodies[6].x, 1000 - sim[6].x);
  assert.equal(context.bodies[6].y, 600 - sim[6].y);
  assert.equal(context.bodies[6].vx, -sim[6].vx);
  assert.equal(context.bodies[6].vy, -sim[6].vy);
  assert.equal(context.bodies[6].rotation, sim[6].rotation + Math.PI);
  assert.deepEqual({ ...context.bodies[6].stickOffset }, { x: -18, y: 12 });
  assert.equal(context.bodies[6].strikerTeam, 1, 'strikerTeam 0 flips to 1 for seat 1');

  // 6. Anonymous names mode is preserved across syncViewBodies
  anonymousNames = true;
  env.syncViewBodies(sim, 1);
  assert.equal(context.bodies[0].name, 'Saffron 1');
  assert.equal(context.bodies[3].name, 'Amethyst 1');
  anonymousNames = false;
  env.syncViewBodies(sim, 1);
  assert.equal(context.bodies[0].name, teamEntries[0].model.parts.fullName);

  // 6b. Repeated ticks keep static UI metadata and stickOffset object references stable (A2)
  const stickBefore = context.bodies[6].stickOffset;
  const persBefore = context.bodies[0].personality;
  const superBefore = context.bodies[0].equippedSuper;
  sim[6].stickOffset = { x: 24, y: -14 };
  env.syncViewBodies(sim, 1);
  assert.equal(context.bodies[6].stickOffset, stickBefore, 'stickOffset mutates in place');
  assert.deepEqual({ ...context.bodies[6].stickOffset }, { x: -24, y: 14 });
  assert.equal(context.bodies[0].personality, persBefore, 'unchanged personality is not re-cloned every tick');
  assert.equal(context.bodies[0].equippedSuper, superBefore, 'unchanged equippedSuper is not re-cloned every tick');

  // 7. stripPresentation removes presentation keys from any tainted array
  const tainted = [{ x: 100, name: 'Test', voice: {}, playerIndex: 2, _lastHitSound: 10, _lastWallSound: 20 }];
  env.stripPresentation(tainted);
  assert.deepEqual(tainted, [{ x: 100 }]);
});

test('local gameplay and goal replay maintain separate authoritative simBodies and stable display bodies', () => {
  const P = require('../shared/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');

  const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };
  const practice = Array.from({ length: 6 }, () => {
    const dna = ubu.randomDNA();
    return { model: ubu.decode(dna), dna: ubu.toCode(dna), label: 'Practice ubu' };
  });
  const dummy = () => {};
  const context = {
    clearTimeout, setTimeout,
    P, ububallMatch, performance,
    clearEffects() { context.postGoal = null; },
    kickoffGlow: 0, netFire: null,
    stats: Array.from({ length: 6 }, () => normal),
    matchMode: 'standard', teamEntries: practice,
    classicMode: () => false, pulseMode: () => false,
    resolveEquippedSuper: (entry, i) => P.SUPERS[i % P.SUPERS.length],
    anonymousName: i => `Anon ${i}`, anonymousNames: false,
    playSegments: [], elapsed: 1, roundTurns: 0, matchTicks: 0,
    play: ububallMatch.newPlay(), tally: ububallMatch.newTally(), fouls: ububallMatch.newFouls(),
    ballOnFire: () => false, lightNet: dummy, quench: dummy,
    trailPositions: () => context.bodies.map(b => ({ x: b.x, y: b.y })),
    clearDiscontinuousTrails: dummy,
    noteTurn: dummy, announceFouls: dummy, foulText: () => '',
    dirtyMeters: new Set(),
    celebrate: dummy, popup: dummy, steamRing: dummy, gameAudio: () => null,
    queueSummary: dummy, closeSummary: dummy, recording: null, clearActiveMatch: dummy, saveActiveMatch: dummy,
    goalTab: dummy, say: dummy, loopFanfare: dummy, sync: dummy, draw: dummy, resetPlans: dummy,
    callText: () => '', honourText: () => '',
    $: () => ({ disabled: false, textContent: '', onclick: null }),
    handleCollision: dummy, handleWall: dummy, handleShockwave: dummy, handleSuper: dummy,
    replayEvents: dummy, recordTrails: dummy, emitSkaterEffects: dummy,
    clockNow: () => 0, hitStopUntil: 0, summaryPending: false, openSummary: dummy,
    scores: [0, 0], turn: 1, phase: 'play',
    bodies: P.kickoff(), simBodies: P.kickoff(),
    authoritativeBodies: null, postGoal: null, goalReplay: null, goalReplayAt: 0,
    theater: null, online: null, onlineReplay: null, scoringPlayer: null
  };

  const env = ububallPlayback.bindMatchHarness(context);

  const initialDisplayRefs = [...context.bodies];

  // 1. kickoff initializes simBodies without presentation keys and projects into existing display bodies in-place
  const returned = env.kickoff(true);
  assert.equal(returned, context.bodies);
  for (let i = 0; i < 7; i++) {
    assert.equal(context.bodies[i], initialDisplayRefs[i], `kickoff preserves bodies[${i}] reference`);
  }
  assert.notEqual(context.simBodies, context.bodies, 'simBodies and bodies are distinct arrays');
  assert.notEqual(context.simBodies[0], context.bodies[0], 'simBodies[0] and bodies[0] are distinct objects');
  assert.equal('name' in context.simBodies[0], false, 'simBodies[0] has no presentation name');
  assert.equal('voice' in context.simBodies[0], false, 'simBodies[0] has no presentation voice');
  assert.equal(context.bodies[0].name, practice[0].model.parts.fullName, 'display body has presentation name');

  // 2. creditSave updates authoritative simBodies meter and projects to display body
  const beforeMeter = context.simBodies[0].meter;
  env.creditSave(context.bodies[0], false, true);
  assert.ok(context.simBodies[0].meter > beforeMeter, 'creditSave increments meter on authoritative simBodies');
  assert.equal(context.bodies[0].meter, context.simBodies[0].meter, 'display body meter matches simBodies meter');
  assert.ok(context.dirtyMeters.has(context.bodies[0]), 'dirtyMeters holds stable display body reference');

  // 3. Goal finishTurn creates isolated postGoal.sim and stops authoritative simBodies
  context.simBodies[0].x = 410;
  context.simBodies[0].vx = 180;
  context.playSegments = [{ bodies: structuredClone(context.simBodies), plans: Array.from({ length: 6 }, () => ({ angle: 0, power: 0.5, spin: 0 })), ticks: 10, saves: [], stops: [] }];
  env.finishTurn(0);

  assert.equal(context.simBodies[0].vx, 0, 'authoritative simBodies is stopped at finishTurn');
  assert.ok(context.postGoal?.sim, 'postGoal has isolated celebration simulation copy');
  assert.notEqual(context.postGoal.sim, context.simBodies, 'postGoal.sim is distinct from simBodies');

  // 4. Starting and ending goalReplay restores display bodies to authoritative simBodies
  env.startGoalReplay();
  assert.ok(context.goalReplay, 'goalReplay started');
  context.goalReplay.sim[0].x = 123;
  env.endGoalReplay();
  assert.equal(context.goalReplay, null);
  assert.equal(context.bodies[0].x, 410, 'ending goalReplay re-projects authoritative simBodies onto display bodies');
});

test('online seat 1 transition (resolving -> playOnlineReplay -> next plan phase) preserves stable display bodies and clean simulation state', () => {
  const P = require('../shared/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');

  const rosters = [
    Array.from({ length: 3 }, (_, i) => ({ dna: ubu.toCode(ubu.randomDNA()), superId: i })),
    Array.from({ length: 3 }, (_, i) => ({ dna: ubu.toCode(ubu.randomDNA()), superId: i + 3 }))
  ];
  const initialServerBodies = P.kickoff();
  initialServerBodies.slice(0, 6).forEach((b, i) => {
    const entry = i < 3 ? rosters[0][i] : rosters[1][i - 3];
    const model = ubu.decode(ubu.fromCode(entry.dna));
    ububallMatch.applyStats(P, b, model.stats, 'standard');
    b.meter = 20;
  });
  const serverPlans = Array.from({ length: 6 }, (_, i) => ({
    angle: i === 3 ? Math.PI : 0,
    power: 0.5,
    spin: 0,
    superArm: false,
    guard: false
  }));
  const postTurnBodies = structuredClone(initialServerBodies);
  P.startTurn(postTurnBodies, serverPlans);
  const ticks = 10;
  for (let t = 0; t < ticks; t++) P.step(postTurnBodies, P.DT);
  P.stop(postTurnBodies);

  let nowMs = 1000;
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
    document: { body: { classList: { contains: () => true, toggle: dummy, add: dummy, remove: dummy } } },
    summaryDialog: null,
    closeLobby: dummy, stopDemo: dummy, enterMatch: dummy, showMode: dummy, closeSummary: dummy,
    classicMode: () => false, buildTeam: dummy, dirtyPrediction: dummy,
    endGoalReplay: dummy, stopFanfare: dummy, clearEffects: dummy,
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
    onlinePhase: 'plan', onlineRoster: '', onlineTurn: 1, onlineDisconnected: false,
    onlineReplay: null, recording: null, recordingOnline: false,
    goalReplay: null, goalReplayAt: 0, scoringPlayer: null, theater: null, postGoal: null,
    matchMode: 'standard', roster: [], teamEntries: [], stats: [],
    plans: Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false })),
    scores: [0, 0], turn: 1, phase: 'plan', drag: null, kickoffGlow: 0,
    fouls: ububallMatch.newFouls(), dirtyMeters: new Set(),
    bodies: P.kickoff(), simBodies: P.kickoff(),
    online: { active: true, now: () => nowMs, state: null }
  };

  const env = ububallPlayback.bindMatchHarness(context);

  const displayRefs = [...context.bodies];

  // 1. Server sends resolving state for turn 1 to player in seat 1
  const resolvingState = {
    seat: 1,
    mode: 'standard',
    phase: 'resolving',
    turn: 1,
    winner: null,
    names: ['Alice', 'Bob'],
    occupied: [true, true],
    connected: [true, true],
    locked: [true, true],
    left: [false, false],
    rematch: [false, false],
    rosters,
    moves: [
      { angle: Math.PI, power: 0.5, spin: 0, superArm: false, guard: false },
      { angle: 0, power: 0.5, spin: 0, superArm: false, guard: false },
      { angle: 0, power: 0.5, spin: 0, superArm: false, guard: false }
    ],
    game: {
      scores: [0, 0],
      bodies: structuredClone(postTurnBodies),
      fouls: { ...ububallMatch.newFouls(), crease: [true, false], corner: 0, cornerTurns: 1, cards: [] },
      stats: Array.from({ length: 6 }, () => ({}))
    },
    replay: {
      turn: 1,
      startedAt: 1000,
      ticks,
      initialBodies: structuredClone(initialServerBodies),
      plans: structuredClone(serverPlans),
      saves: [],
      stops: [],
      struck: [],
      goal: null,
      label: null,
      scorer: null,
      assist: null
    }
  };
  context.online.state = resolvingState;
  env.onlineCallbacks.onState(resolvingState);

  assert.equal(context.phase, 'play');
  assert.ok(context.onlineReplay?.simBodies, 'onlineReplay.simBodies initialized on resolving state');
  assert.equal(context.onlineReplay.currentTick, 0, 'at t=startedAt, 0 ticks have elapsed');
  for (let i = 0; i < 7; i++) {
    assert.equal('name' in context.onlineReplay.simBodies[i], false, `onlineReplay.simBodies[${i}] has no presentation keys`);
    assert.equal(context.bodies[i], displayRefs[i], `bodies[${i}] reference stable on resolving start`);
  }
  // Seat 1 sees server body 3 at display index 0, mirrored across the rink
  assert.equal(context.bodies[0].x, 1000 - context.onlineReplay.simBodies[3].x);
  assert.equal(context.bodies[0].y, 600 - context.onlineReplay.simBodies[3].y);

  // 2. Advance online clock past all replay ticks and run playOnlineReplay()
  nowMs = 1000 + Math.ceil((ticks + 2) * P.DT * 1000);
  env.playOnlineReplay();

  assert.equal(context.onlineReplay.currentTick, ticks, 'onlineReplay stepped to completion');
  // At completion, playOnlineReplay syncs to online.state.game.bodies with seat-1 transform
  assert.equal(context.bodies[0].x, 1000 - postTurnBodies[3].x);
  assert.equal(context.bodies[0].y, 600 - postTurnBodies[3].y);
  assert.equal(context.bodies[3].x, 1000 - postTurnBodies[0].x);
  assert.deepEqual([...context.fouls.crease], [false, true], 'fouls.crease flipped for seat 1 after replay completion');
  assert.equal(context.fouls.corner, 3, 'fouls.corner flipped for seat 1 after replay completion');

  // 3. Server transitions to next turn's plan phase (turn 2)
  const nextPlanState = {
    ...resolvingState,
    phase: 'plan',
    turn: 2,
    locked: [false, false],
    moves: [
      { angle: Math.PI / 2, power: 0.75, spin: 0, superArm: true, guard: false },
      { angle: 0, power: 0, spin: 0, superArm: false, guard: false },
      { angle: 0, power: 0, spin: 0, superArm: false, guard: false }
    ],
    replay: null
  };
  context.online.state = nextPlanState;
  env.onlineCallbacks.onState(nextPlanState);

  assert.equal(context.phase, 'plan');
  assert.equal(context.turn, 2);
  assert.equal(context.onlineReplay, null, 'onlineReplay cleared on next plan phase');
  // Seat 1 move angles are rotated by +PI in local plan view
  assert.ok(Math.abs(context.plans[0].angle - 1.5 * Math.PI) < 1e-9, 'seat 1 plan angle rotated by PI');
  assert.equal(context.bodies[0].superArm, true, 'fresh turn move superArm applied to display body');
  for (let i = 0; i < 7; i++) {
    assert.equal(context.bodies[i], displayRefs[i], `bodies[${i}] reference stable into next plan phase`);
  }
});

test('D4-05, D4-08, D4-01: online onState preserves local roster, prevents mid-replay score regression, and ends stale goalReplay on fresh resolving turn', () => {
  const P = require('../shared/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');

  const rosters = [
    Array.from({ length: 3 }, (_, i) => ({ serial: `u-0-${i}`, dna: ubu.toCode(ubu.randomDNA()), superId: i })),
    Array.from({ length: 3 }, (_, i) => ({ serial: `u-1-${i}`, dna: ubu.toCode(ubu.randomDNA()), superId: i + 3 }))
  ];
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
    goalTab: dummy, callText: () => '', honourText: () => '', loopFanfare: dummy,
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

  // D4-09: cpuActive() detects an unfinished CPU match in Discord even when inMatch === false
  assert.equal(env.onlineCallbacks.cpuActive(), true);

  const makeResolvingGoalState = (turnNum, scores) => JSON.parse(JSON.stringify({
    seat: 0, spectator: false, mode: 'standard', phase: 'resolving', turn: turnNum, winner: null,
    names: ['Alice', 'Bob'], occupied: [true, true], connected: [true, true], locked: [true, true],
    left: [false, false], rematch: [false, false], rosters,
    moves: Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false })),
    game: {
      scores,
      bodies: P.kickoff(),
      fouls: ububallMatch.newFouls(),
      stats: Array.from({ length: 6 }, () => ({}))
    },
    replay: {
      turn: turnNum, startedAt: nowMs, ticks: 4, initialBodies: P.kickoff(),
      plans: Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false })),
      saves: [], stops: [], struck: [], goal: 0, label: 'GOAL', scorer: 0, assist: null
    }
  }));

  // 1. Initial resolving broadcast (before goal tick): score starts pre-goal [0, 0]
  const state1 = makeResolvingGoalState(1, [1, 0]);
  context.online.state = state1;
  env.onlineCallbacks.onState(state1);
  assert.ok(clearedReplayViewers >= 1, 'onState clears any active replay viewer');
  assert.deepEqual(context.roster, savedLocalRoster, 'onState preserves local player roster');
  assert.equal(context.teamEntries[0].key, 'u-0-0', 'onState populates entry.key on fieldView.entries');
  assert.deepEqual([...context.scores], [0, 0], 'pre-goal score held before goal tick');

  // 2. Step past goal tick -> goalPlayed becomes true and score updates to [1, 0]
  nowMs += 500;
  env.playOnlineReplay();
  assert.equal(context.onlineReplay.goalPlayed, true);
  assert.deepEqual([...context.scores], [1, 0], 'post-goal score shown at goal tick');
  context.goalReplay = { sim: P.kickoff(), seat: 0 };

  // 3. Re-broadcast during resolving (fresh JSON without goalPlayed, e.g. /skip-replay or /allow-watch):
  // Score MUST stay [1, 0] instead of regressing back to [0, 0] (D4-05)
  const rebroadcast = makeResolvingGoalState(1, [1, 0]);
  context.online.state = rebroadcast;
  env.onlineCallbacks.onState(rebroadcast);
  assert.deepEqual([...context.scores], [1, 0], 'D4-05: mid-replay state broadcast does not decrement score');
  assert.ok(context.goalReplay, 'same-turn resolving broadcast keeps current goalReplay running');

  // 4. Network hiccup jumps straight from Turn 1 resolving to Turn 2 resolving (skipping plan):
  // Stale Turn 1 goalReplay MUST be ended so Turn 2 replay plays (D4-08)
  endedGoalReplays = 0;
  const turn2Resolving = makeResolvingGoalState(2, [2, 0]);
  context.online.state = turn2Resolving;
  env.onlineCallbacks.onState(turn2Resolving);
  assert.ok(endedGoalReplays >= 1, 'D4-08: fresh resolving turn ends previous turn goalReplay');
  assert.equal(context.onlineReplay.turn, 2, 'Turn 2 onlineReplay loaded cleanly');
});

test('D4-10, D4-14, D4-19: ububall-online.js handles non-JSON 502 errors, null-session lobby renders, standalone queue cancel races, and avatar name updates', async () => {
  const onlineSrc = fs.readFileSync(require.resolve('../web/ububall-online.js'), 'utf8');
  const elements = new Map();
  const makeEl = id => ({
    id, hidden: false, disabled: false, value: '', textContent: '', open: false, dataset: {}, style: {},
    children: [], className: '',
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k] ?? null; },
    querySelector: () => ({ textContent: '' }),
    append(...nodes) { this.children.push(...nodes); },
    prepend(node) { this.children.unshift(node); },
    insertBefore(node, ref) {
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx >= 0) this.children.splice(idx, 0, node);
      else this.children.push(node);
    },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    remove() {},
    contains: () => false,
    addEventListener() {},
    showModal() { this.open = true; },
    close() { this.open = false; },
    select() {},
    getBoundingClientRect: () => ({ width: 80 })
  });
  const getEl = id => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };

  let currentUrl = 'https://12345.discordsays.com/?instance_id=inst-1';
  const listeners = new Map();
  const fetchCalls = [];
  let fetchResponder = async () => ({ ok: true, status: 200, json: async () => ({}) });

  const makeHarness = ({ isActivity, matchVersion, physicsVersion, onOutdated: customOutdated } = {}) => {
    elements.clear();
    listeners.clear();
    fetchCalls.length = 0;
    const sockets = [];
    currentUrl = isActivity ? 'https://12345.discordsays.com/?instance_id=inst-1' : 'https://ububall.com/';
    const navLink = makeEl('nav-play');
    const win = {
      location: new URL(currentUrl),
      ubuActivity: isActivity ? {
        instance: 'inst-1',
        participants: null,
        dispose() {},
        signIn: async () => ({ owner: 'u1', instance: 'inst-1', csrf: 'tok', avatar: null }),
        invite: async () => {}
      } : undefined,
      addEventListener(type, fn) { listeners.set(type, fn); },
      showUbuScreen() {}
    };
    const ctx = {
      URL, URLSearchParams, DOMException, AbortController, encodeURIComponent, Error, Set, Map, Promise, JSON, Math, Date, String, Boolean, Object,
      crypto: { randomUUID: () => 'conn-1' },
      setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {},
      WebSocket: Object.assign(function() {
        this.readyState = 1; this.closed = false; this.sent = [];
        this.close = () => { this.closed = true; this.readyState = 3; };
        this.send = msg => { this.sent.push(msg); };
        sockets.push(this);
      }, { OPEN: 1 }),
      navigator: { clipboard: { writeText: async () => {} } },
      matchMedia: () => ({ matches: false }),
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      history: { state: null, replaceState(_s, _t, url) { currentUrl = String(url); win.location = new URL(currentUrl); } },
      location: win.location,
      window: win,
      ububallMatch: { modeName: m => m, ...(matchVersion != null ? { VERSION: matchVersion } : {}) },
      ...(physicsVersion != null ? { ububallPhysics: { VERSION: physicsVersion } } : {}),
      gameUi: { confirm: async () => true, blocking: () => {} },
      document: {
        title: 'Ububall', hidden: false, activeElement: null,
        getElementById: getEl,
        createElement: tag => makeEl(tag),
        querySelector: () => navLink,
        addEventListener() {}
      },
      fetch: async (path, opts) => {
        fetchCalls.push({ path, opts });
        return fetchResponder(path, opts);
      }
    };
    const ububallOnline = vm.runInNewContext(onlineSrc + '\n;ububallOnline;', ctx);
    let playCpuAwaited = false, outdatedCount = 0;
    const hooks = {
      playCpu: async () => { await Promise.resolve(); playCpuAwaited = true; },
      cpuActive: () => playCpuAwaited,
      resumeCpu() {},
      prepareOnline() {},
      chooseMode() {},
      editRules() {},
      onNewGame() {},
      lobby() {},
      closeLobby() {},
      onState() {},
      onDisconnect() {},
      onError() {},
      onOutdated() { outdatedCount++; customOutdated?.(); },
      onLeave() {}
    };
    return { client: ububallOnline(hooks), getEl, listeners, fetchCalls, sockets, getOutdated: () => outdatedCount, getUrl: () => currentUrl };
  };

  // 1. Standalone: HTML 502 error on /api/guest surfaces clean message (no SyntaxError) & passes AbortSignal (D4-14)
  {
    fetchResponder = async path => {
      if (path === '/api/guest') {
        return { ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token '<'"); } };
      }
      return { ok: true, status: 200, json: async () => ({ csrf: 'c1' }) };
    };
    const h = makeHarness({ isActivity: false });
    await h.getEl('online-guest').onclick();
    assert.equal(h.getEl('online-status').textContent, 'Could not start a guest session.');
    assert.ok(h.fetchCalls.find(c => c.path === '/api/guest')?.opts?.signal, '/api/guest includes AbortSignal');
  }

  // 2. Standalone: Cancel queue when server returns { status: 'matched' } leaves + acks instead of joining (D4-10)
  {
    let phase = 'enter';
    fetchResponder = async (path, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (path === '/api/session') return { ok: true, status: 200, json: async () => ({ owner: 'u1', csrf: 'c1' }) };
      if (path === '/api/ububall/queue' && body.action === 'enter') return { ok: true, status: 200, json: async () => ({ status: 'waiting' }) };
      if (path === '/api/ububall/queue' && body.action === 'cancel') {
        phase = 'cancelled';
        return { ok: true, status: 200, json: async () => ({ status: 'matched', id: 'm-race-1' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const h = makeHarness({ isActivity: false });
    h.getEl('online-public').onclick();
    await new Promise(r => setImmediate(r));
    await h.getEl('online-cancel-queue').onclick();
    assert.equal(phase, 'cancelled');
    assert.equal(h.client.active, false, 'cancelling standalone queue does not enter the matched game');
    assert.ok(h.fetchCalls.some(c => c.path === '/api/ububall/m-race-1/leave'), 'posts /leave for raced match');
    assert.ok(h.fetchCalls.some(c => c.path === '/api/ububall/queue' && JSON.parse(c.opts.body).action === 'ack'), 'acks raced queue assignment');
  }

  // 3. Activity: null session does not crash renderLobby / participants, avatar initials update on rename, and enter() keeps URL clean (D4-10, D4-19)
  {
    let lobbyName = 'al';
    fetchResponder = async (path, opts) => {
      const body = opts?.body ? JSON.parse(opts.body) : null;
      if (path === '/api/ububall/lobby') {
        return {
          ok: true, status: 200,
          json: async () => ({
            users: [{ owner: 'u1', name: lobbyName, avatar: null, status: 'idle' }],
            challenges: [], matches: {}
          })
        };
      }
      if (path === '/api/ububall') {
        return {
          ok: true, status: 200,
          json: async () => ({
            id: 'act-match-9', revision: 1, now: 1000, seat: 0, phase: 'plan', mode: 'standard',
            names: ['Al', 'Bo'], occupied: [true, true], ready: [true, true], rematch: [false, false],
            connected: [true, true], locked: [false, false], left: [false, false],
            rosters: [[], []], moves: [], game: { scores: [0, 0], bodies: [], fouls: {}, stats: [] }
          })
        };
      }
      if (body) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ owner: 'u1', instance: 'inst-1', csrf: 'tok', avatar: null }) };
    };
    const h = makeHarness({ isActivity: true });
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    const userCard = h.getEl('activity-users').children[0];
    assert.equal(userCard.children[0].textContent, 'AL', 'initial fallback avatar initials');

    // Rename user without changing avatar (still null) -> initials update to 'BO' (D4-19)
    lobbyName = 'bo';
    await h.getEl('online-friends').onclick();
    assert.equal(userCard.children[0].textContent, 'BO', 'D4-19: fallback initials refresh when display name changes');

    // Entering a match inside Discord Activity does not pollute URL with ?match= (D4-10)
    await h.getEl('online-create').onclick();
    assert.equal(new URL(h.getUrl()).searchParams.has('match'), false, 'D4-10: Activity URL never receives ?match=');

    // Clearing session via ubu:session then firing contextChanged and ubu:activity-participants does not throw (D4-10)
    h.listeners.get('ubu:session')({ detail: null });
    assert.doesNotThrow(() => h.client.contextChanged());
    assert.doesNotThrow(() => h.listeners.get('ubu:activity-participants')({ detail: [] }));
  }

  // 4. Server physicsVersion or match version mismatch halts online room, closes socket, blocks actions, and locks UI until reload (A7)
  {
    const baseState = (revision, physicsVersion) => ({
      type: 'state', id: 'ver-match-1', version: 2, physicsVersion, revision, now: 1000, seat: 0, phase: 'plan', mode: 'standard',
      names: ['Al', 'Bo'], occupied: [true, true], ready: [true, true], rematch: [false, false],
      connected: [true, true], locked: [false, false], left: [false, false],
      rosters: [[], []], moves: [], game: { scores: [0, 0], bodies: [], fouls: {}, stats: [] }
    });
    fetchResponder = async path => {
      if (path === '/api/session') return { ok: true, status: 200, json: async () => ({ owner: 'u1', csrf: 'c1' }) };
      if (path === '/api/ububall') return { ok: true, status: 200, json: async () => baseState(1, 5) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const h = makeHarness({ isActivity: false, matchVersion: 2, physicsVersion: 5 });
    await h.getEl('online-create').onclick();
    assert.equal(h.client.active, true);
    assert.equal(h.getOutdated(), 0);
    assert.equal(h.sockets.length, 1);

    // Server rolls to newer physicsVersion mid-match -> socket closes, active becomes false, send() is blocked
    h.sockets[0].onmessage({ data: JSON.stringify(baseState(2, 6)) });
    assert.equal(h.getOutdated(), 1, 'physicsVersion mismatch triggers onOutdated');
    assert.equal(h.sockets[0].closed, true, 'mismatch closes socket immediately');
    assert.equal(h.client.active, false, 'outdated client stops active play');
    assert.equal(h.client.send([], true), false, 'outdated client blocks send()');

    // Duplicate state messages do not re-trigger onOutdated
    h.sockets[0].onmessage({ data: JSON.stringify(baseState(3, 6)) });
    assert.equal(h.getOutdated(), 1);
  }
});
