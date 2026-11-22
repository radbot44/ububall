/* Direct require-based test for web/ububall-theater.js replay takeover and teardown. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../shared/ububall-physics.js');
const ububallMatch = require('../shared/ububall-match.js');
const ububallReplay = require('../shared/ububall-replay.js');
const ubu = require('../shared/ubu.js');
const ububallPresentation = require('../web/ububall-presentation.js');
const ububallPlayback = require('../web/ububall-playback.js');
const ububallTheater = require('../web/ububall-theater.js');
const { createEffectsState } = ububallPresentation;

test('replay takeover transforms seat-1 state without presentation leaks, preserves superMastery, and tears down cleanly', () => {
  // Find a DNA with >= 2 copies of a super so mastery bonusTicks > 0
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

  // Put mastered ubu at server index 3, which becomes local index 0 for a seat-1 replay
  const ubus = Array.from({ length: 6 }, (_, i) => ({
    dna: i === 3 ? masteredDna : ubu.toCode(ubu.randomDNA()),
    super: i === 3 ? masteredSuperId : (i % 8)
  }));
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
  const localTeam = Array.from({ length: 3 }, (_, i) => ({
    key: `guest-${i}`, dna: ubus[i].dna, label: 'Guest ubu', model: ubu.decode(ubu.fromCode(ubus[i].dna))
  }));
  const context = {
    P, ubu, ububallMatch, ububallReplay,
    localStorage: { getItem: () => null, setItem: dummy, removeItem: dummy },
    $,
    shot: 'home',
    document: {
      body: { dataset: { shot: 'home' }, classList: { toggle: dummy, add: dummy, remove: dummy } },
      querySelector: () => null
    },
    inDiscord: false, demo: false, online: null,
    cpuMode: 'standard', cpuLevel: 'medium', cpuTeam: localTeam,
    starterEntries: () => localTeam,
    draft: [...localTeam], roster: [...localTeam], teamEntries: [], stats: [], plans: [], cpu: [], cpuDone: false,
    idlePlan: () => ({ angle: 0, power: 0, spin: 0, guard: false }),
    saveRecording: dummy, stopDemo: dummy, closeSummary: dummy, endGoalReplay: dummy,
    stopFanfare: dummy, gameAudio: () => ({ stop: dummy }), saveActiveMatch: dummy,
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
  const displayRefs = [...context.bodies];

  // 1. Watch seat-1 replay: enters replay shot, assigns replay-* keys, preserves superMastery
  env.watchReplay(rec, null);
  assert.equal(context.shot, 'replay');
  assert.equal(context.phase, 'replay');
  assert.equal(context.theater.seat, 1);
  assert.equal(context.teamEntries[0].key, 'replay-0');
  assert.ok(context.teamEntries[0].equippedSuper.bonusTicks > 0, 'watchReplay preserves superMastery bonusTicks');
  assert.ok(context.teamEntries[0].equippedSuper.copies >= 2, 'watchReplay preserves superMastery copies');

  // 2. Take over from replay (playFromHere): seat-1 -> seat-0 transform, mastery preserved, no presentation leaks
  env.playFromHere();
  assert.equal(context.theater, null);
  assert.equal(context.shot, 'match');
  assert.equal(context.phase, 'plan');
  assert.deepEqual([...context.scores], [2, 1]);
  assert.deepEqual([...context.fouls.crease], [false, true]);
  assert.equal(context.fouls.corner, 3);
  assert.equal(context.roster[0].key, 'replay-0');
  assert.equal(env.onGuestTeam(), false);

  for (let i = 0; i < 7; i++) assert.equal(context.bodies[i], displayRefs[i]);
  assert.notEqual(context.simBodies, context.bodies);
  assert.equal(context.simBodies[0].x, 1000 - 770);
  assert.equal(context.simBodies[0].y, 600 - 420);
  assert.equal(context.simBodies[0].meter, 65);
  assert.equal(context.simBodies[0].stunnedNext, true);
  assert.equal(context.simBodies[0].carded, true);
  assert.ok(context.simBodies[0].superBonusTicks > 0);
  assert.ok(context.simBodies[0].equippedSuper.bonusTicks > 0);
  assert.equal(context.simBodies[3].x, 1000 - 210);
  assert.equal(context.simBodies[6].x, 1000 - 520);
  assert.equal(context.simBodies[6].strikerTeam, 0);

  for (let i = 0; i < 7; i++) {
    assert.equal('name' in context.simBodies[i], false);
    assert.equal('voice' in context.simBodies[i], false);
    assert.equal('playerIndex' in context.simBodies[i], false);
    assert.equal('meterTick' in context.simBodies[i], false);
  }
  assert.deepEqual(Object.keys(context.simBodies[0].equippedSuper).sort(), ['bonusRefund', 'bonusTicks', 'id', 'key']);

  // 3. Step a local turn from the taken-over state without presentation leaks
  const launchPlans = Array.from({ length: 6 }, (_, i) => ({
    angle: i === 1 ? 0 : 0.5, power: i === 1 ? 0.8 : 0.2, spin: 0, superArm: false, guard: false
  }));
  P.startTurn(context.simBodies, launchPlans);
  const tick = ububallMatch.playTick(P, context.simBodies, context.play, {}, context.tally);
  env.syncViewBodies(context.simBodies, 0);
  assert.equal(tick.goal, null);
  assert.equal(context.bodies[1].x, context.simBodies[1].x);
  assert.equal('name' in context.simBodies[1], false);

  // 4. Clean teardown via endReplay (no phantom CPU match) and newMatch (clears active theater)
  env.watchReplay(rec, null);
  env.endReplay();
  assert.equal(context.theater, null);
  assert.equal(context.phase, 'over');
  assert.equal(context.recording, null);

  env.watchReplay(rec, null);
  assert.ok(context.theater);
  env.newMatch();
  assert.equal(context.theater, null);
  assert.equal(context.shot, 'match');
  assert.equal(context.phase, 'plan');
});
