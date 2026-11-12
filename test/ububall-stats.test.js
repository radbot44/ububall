/* Direct require-based tests for web/ububall-stats.js (MVP, event formatting, filenames, Seat-1 stats). */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../shared/ububall-physics.js');
const ububallMatch = require('../shared/ububall-match.js');
const ububallReplay = require('../shared/ububall-replay.js');
const ubu = require('../shared/ubu.js');
const ububallPlayback = require('../web/ububall-playback.js');
const ububallStats = require('../web/ububall-stats.js');

test('ububall-stats: matchMvp scoring, tie-breaking by topShot, and zero-stat null guard', () => {
  const zero = () => [0, 0, 0, 0, 0, 0];
  assert.equal(ububallStats.matchMvp({
    goals: zero(), assists: zero(), saves: zero(), bigSaves: zero(), checks: zero(), topShot: zero()
  }), null, 'returns null when all stats are zero');

  // Slot 1: 1 goal (3 pts) + topShot 800; Slot 4: 1 assist (2) + 1 big save (2+1 = 3 pts total? No: save=2 + bigSave=1 = 3 pts) + topShot 950
  const tiedPoints = {
    goals: [0, 1, 0, 0, 0, 0],
    assists: zero(),
    saves: [0, 0, 0, 0, 1, 0],
    bigSaves: [0, 0, 0, 0, 1, 0],
    checks: zero(),
    topShot: [0, 800, 0, 0, 950, 0]
  };
  assert.equal(ububallStats.matchMvp(tiedPoints), 4, 'breaks MVP point ties using fastest shot');
});

test('ububall-stats: replayFileName sanitizes custom titles and formats timestamps cleanly', () => {
  const recorded = new Date(2026, 10, 12, 16, 5).getTime();
  assert.equal(ububallStats.replayFileName(recorded, null), 'ububall-20261112-1605');
  assert.equal(ububallStats.replayFileName(recorded, '  Finals: Game #7!!  '), 'Finals-Game-7');
  assert.equal(ububallStats.statsEventLabel({ type: 'Goal', label: 'FIREBALL!' }), 'Goal (FIREBALL!)');
  assert.equal(ububallStats.statsEventLabel({ type: 'Goal', label: 'GOAL' }), 'Goal');
  assert.equal(ububallStats.statsEventTime({ tick: 240 * 65 + 120, turn: 4 }, P.DT), '1:05.5 · Turn 4');
});

test('ububall-stats: replayStats mirrors coordinates, actor indices, control, and rounds for Seat 1', () => {
  const ubus = Array.from({ length: 6 }, (_, i) => ({ dna: ubu.toCode(ubu.randomDNA()), super: i }));
  const rec = ububallReplay.create({ mode: 'standard', seat: 0, names: ['Home', 'Away'], ubus });
  const bodies = P.kickoff();
  const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };
  bodies.slice(0, 6).forEach(b => P.applyStats(b, normal));
  const plans = Array.from({ length: 6 }, (_, i) => ({
    angle: i === 0 ? 0 : Math.PI,
    power: i === 0 ? 1 : 0,
    spin: 0,
    superArm: false,
    guard: false
  }));
  const t = ububallReplay.addTurn(rec, { turn: 1, scores: [0, 0], fouls: ububallMatch.newFouls(), bodies, plans });
  t.ticks = 60;
  t.cards = [];
  t.saves = [];
  t.stops = [];
  t.goal = { team: 0, label: 'GOAL', scorer: 0, assist: null };

  const dummy = () => {};
  const makeController = () => ububallStats.createStatsController({
    $: () => ({ hidden: false, style: { setProperty: dummy }, setAttribute: dummy, replaceChildren: dummy }),
    document: { addEventListener: dummy },
    addEventListener: dummy,
    history: {},
    P,
    ububallMatch,
    ububallReplay,
    ubuRender: dummy,
    gameUi: { icon: dummy },
    onlineOrder: ububallPlayback.onlineOrder,
    viewIndex: ububallPlayback.viewIndex,
    getFieldView: () => ({ entries: [] }),
    getSkaters: () => [],
    getThemeColors: () => ({ home: '#f00', away: '#00f', text: '#fff' }),
    drawRinkSurface: dummy,
    viewTally: () => ({ tally: ububallMatch.newTally(), scores: [0, 0] }),
    getScores: () => [0, 0],
    getPhase: () => 'over',
    getOnline: () => null,
    getTheater: () => null,
    getRecording: () => null,
    getLastCompletedReplay: () => null,
    getLastSaved: () => Promise.resolve(null),
    getShot: () => 'match',
    getCameraMove: () => null,
    replayStore: {},
    libraryEntry: dummy,
    seekReplay: dummy,
    updateReplayBar: dummy,
    watchReplay: dummy,
    matchInProgress: () => false,
    finishCpuMatch: dummy,
    closeFirstTurnGuide: dummy,
    closeSummary: dummy,
    newMatch: dummy,
    exitMatchMode: dummy
  });

  const ctrl = makeController();
  const s0 = ctrl.replayStats({ replay: rec, seat: 0 });
  const s1 = ctrl.replayStats({ replay: rec, seat: 1 });

  assert.equal(s0.goals[0], 1);
  assert.equal(s1.goals[3], 1, 'Seat 1 swaps server player 0 to display index 3');
  assert.equal(s1.rounds[0].team, 1, 'Seat 1 flips scoring round team');
  assert.equal(s1.control[0], s0.control[1], 'Seat 1 reverses control percentages');
  if (s0.events.length) {
    assert.equal(s1.events[0].x, 1000 - s0.events[0].x, 'Seat 1 mirrors event x coordinate');
    assert.equal(s1.events[0].y, 600 - s0.events[0].y, 'Seat 1 mirrors event y coordinate');
  }
});
