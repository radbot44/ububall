/* Direct require-based tests for web/ububall-playback.js and unified frame() playback path. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const P = require('../shared/ububall-physics.js');
const ububallMatch = require('../shared/ububall-match.js');
const ubu = require('../shared/ubu.js');
const ububallPlayback = require('../web/ububall-playback.js');

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
  const source = fs.readFileSync(require.resolve('../web/ububall.js'), 'utf8');
  const start = source.indexOf('  const postGoalState = { steps: 0, onTick: null };\n  function frame(time) {');
  const end = source.indexOf('  function resolveEquippedSuper(', start);
  assert.ok(start >= 0 && end > start, 'found frame(time) in web/ububall.js');
  const frameCode = source.slice(start, end);

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

  const runFrame = vm.runInNewContext(frameCode + '\n;frame;', ctx);

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
