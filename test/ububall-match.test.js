'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../shared/ububall-match.js');
const P = require('../shared/ububall-physics.js');
const ubu = require('../shared/ubu.js');
const rarity = require('../shared/rarity.js');
const { MatchRoom } = require('../server/ububall-room.js');

const idle = () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false });
const PLAY_KEYS = new Set(Object.keys(M.newPlay()));

function pulseState(mode) {
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach(b => { M.applyStats(P, b, {}, mode); b.meter = 0; });
  return { version: M.VERSION, mode, bodies, stats: [], scores: [0, 0], turn: 1, play: M.newPlay() };
}

function shotState(ball, place = {}, extra = {}) {
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach(b => { P.applyStats(b); b.meter = 0; });
  Object.assign(bodies[6], ball);
  for (const [i, at] of Object.entries(place)) Object.assign(bodies[i], at);
  const playIn = extra.play ? { ...extra.play } : {}, rest = {};
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'play') continue;
    if (PLAY_KEYS.has(k)) playIn[k] = v;
    else rest[k] = v;
  }
  return { version: M.VERSION, mode: 'standard', bodies, stats: [], scores: [0, 0], turn: 1, play: M.newPlay(playIn), ...rest };
}

function foulTurn(fouls, place, ball = { x: 500, y: 300 }) {
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach(b => { P.applyStats(b); b.meter = 100; });
  Object.assign(bodies[6], ball);
  for (const [i, at] of Object.entries(place)) Object.assign(bodies[i], at);
  M.finishTurn(P, bodies, [], [0, 0], null, 'standard', {}, fouls);
  return bodies;
}

test('network move validation rejects forged state and non-finite or out-of-range moves', () => {
  const moves = () => Array.from({ length: 3 }, () => ({ angle: 0, power: .5, spin: 0, superArm: false, guard: false }));
  assert.equal(M.validatePlans(moves()).length, 3);
  for (const patch of [{ power: 2 }, { spin: NaN }, { angle: Infinity }, { meter: 100 }, { superArm: 1 }, { guard: undefined }]) {
    const input = moves();
    Object.assign(input[0], patch);
    assert.throws(() => M.validatePlans(input));
  }
  assert.throws(() => M.validatePlans([]));
  const guarded = moves();
  Object.assign(guarded[0], { guard: true, spin: .5 });
  assert.deepEqual(M.validatePlans(guarded)[0], { angle: 0, power: .5, spin: .5, superArm: false, guard: true });
});

test('private drafts, turn locking, disconnect pause and latest-draft Blitz expiry', () => {
  const room = new MatchRoom('host', 'blitz', true); room.join('guest', true);
  room.connect('host', 0); room.connect('guest', 0); room.beginPlanning(0);
  const moves = Array.from({ length: 3 }, () => ({ angle: 0, power: .8, spin: 0, superArm: false, guard: false }));
  room.submit('host', 1, moves, false, 1000);
  const guestView = room.view('guest');
  assert.equal(guestView.moves[0].power, 0);
  assert.equal(guestView.physicsVersion, P.VERSION);
  assert.equal(room.watchView().physicsVersion, P.VERSION);
  assert.equal(room.watchView().version, room.state.version);
  assert.throws(() => room.view('stranger'));
  room.disconnect('guest', 2000); assert.equal(room.state.remaining, 3000);
  assert.equal(room.takeTurn(50000), null);
  room.connect('guest', 50000); assert.equal(room.state.deadline, 53000);
  assert.equal(room.takeTurn(52999), null);
  const turn = room.takeTurn(53000); assert.equal(turn[0].power, .8); assert.equal(turn[3].power, 0);
  assert.equal(room.takeTurn(53001), null);
  assert.throws(() => room.submit('host', 1, moves, true, 53001));
});

test('Blitz disconnect pause budget is capped at 60s per player per game', () => {
  const room = new MatchRoom('host', 'blitz', true); room.join('guest', true);
  room.readyPair([null, null]);
  room.connect('host', 0); room.connect('guest', 0); room.advance(0);
  assert.equal(room.state.deadline, 5000);
  room.disconnect('guest', 1000);
  assert.equal(room.state.remaining, 4000);
  assert.equal(room.state.deadline, null);
  assert.equal(room.state.pauseEnds, 61000);
  assert.equal(room.view('host').planOpen, false);
  room.connect('guest', 41000);
  assert.equal(room.state.deadline, 45000);
  assert.equal(room.state.pauseUsed[1], 40000);
  room.disconnect('guest', 42000);
  assert.equal(room.state.remaining, 3000);
  assert.equal(room.state.pauseEnds, 62000);
  room.advance(61999);
  assert.equal(room.state.deadline, null);
  room.advance(62000);
  assert.equal(room.state.deadline, 65000);
  assert.equal(room.state.remaining, null);
  assert.equal(room.view('host').planOpen, true);
  const moves = Array.from({ length: 3 }, () => ({ angle: 0, power: 0.5, spin: 0, superArm: false, guard: false }));
  room.submit('host', 1, moves, false, 63000);
  room.advance(65000);
  assert.equal(room.state.phase, 'resolving');
  assert.equal(room.state.turn, 2);
});

test('changing rules restarts instant play before launch and rejects stale editors and locked turns', () => {
  const room = new MatchRoom('host', 'standard', true); room.join('guest', true); room.readyPair([null, null]);
  room.connect('host', 1000); room.connect('guest', 1000); room.advance(1000);
  const roster = structuredClone(room.state.rosters);
  room.changeRules('guest', 'classic-pulse-blitz', 0); room.advance(2000);
  assert.equal(room.state.game.mode, 'classic-pulse-blitz'); assert.equal(room.state.turn, 1);
  assert.equal(room.state.deadline, 7000); assert.deepEqual(room.state.rosters, roster);
  assert.ok(room.state.game.bodies.slice(0, 6).every(body => body.equippedSuper === null));
  assert.throws(() => room.changeRules('stranger', 'standard', 1), /Not a match player/);
  assert.throws(() => room.changeRules('host', 'standard', 0), /game changed/);
  const moves = Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false }));
  room.submit('host', 1, moves, true, 2100);
  assert.equal(room.view('guest').canChangeRules, false);
  assert.throws(() => room.changeRules('guest', 'standard', 1), /before the first launch/);
  room.submit('guest', 1, moves, true, 2200); room.advance(2200);
  assert.throws(() => room.changeRules('host', 'standard', 1), /before the first launch/);
});

test('forfeit requires a seated connected claimant and sixty disconnected seconds', () => {
  const room = new MatchRoom('host', 'classic'); room.join('guest', true); room.connect('host', 0); room.connect('guest', 0);
  room.disconnect('guest', 100);
  assert.throws(() => room.claimForfeit('host', 60099));
  assert.throws(() => room.claimForfeit('stranger', 60100));
  room.claimForfeit('host', 60100);
  assert.equal(room.state.winner, 0);
});

test('MatchRoom advance drives full lifecycle from lobby to resolving and next turn planning', () => {
  const room = new MatchRoom('host', 'standard', true);
  room.join('guest', true);
  room.connect('host', 1000);
  room.connect('guest', 1000);
  assert.equal(room.state.phase, 'lobby');
  const hostSupers = room.state.guestTeams[0].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  const guestSupers = room.state.guestTeams[1].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  room.selectTeam('host', room.state.guestTeams[0], hostSupers);
  room.advance(1000);
  assert.equal(room.state.phase, 'lobby');
  assert.equal(room.view('guest').rosters[0], null);
  assert.ok(Array.isArray(room.view('host').rosters[0]));
  room.selectTeam('guest', room.state.guestTeams[1], guestSupers);
  room.advance(1000);
  assert.equal(room.state.phase, 'plan');
  assert.equal(room.state.turn, 1);
  assert.ok(room.state.game);
  assert.equal(room.view('guest').rosters[0].length, 3);
  assert.equal('serial' in room.view('guest').rosters[0][0], false);
  const moves = () => Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false }));
  const launched = moves(); launched[0] = { angle: 1, power: 0.3, spin: 0.2, superArm: false, guard: false };
  room.submit('host', 1, launched, true, 1100);
  room.advance(1100);
  assert.equal(room.state.phase, 'plan');
  assert.equal(room.state.locked[0], true);
  const guarded = moves(); guarded[1] = { angle: 2, power: 0.5, spin: 0, superArm: false, guard: true };
  room.submit('guest', 1, guarded, true, 1200);
  room.advance(1200);
  assert.equal(room.state.phase, 'resolving');
  assert.ok(room.state.replay);
  assert.ok(room.state.playUntil > 1200);
  assert.equal(room.state.turn, 2);
  room.advance(room.state.playUntil - 1);
  assert.equal(room.state.phase, 'resolving');
  room.advance(room.state.playUntil);
  assert.equal(room.state.phase, 'plan');
  assert.equal(room.state.locked[0], false);
  assert.equal(room.state.locked[1], false);
  assert.equal(room.state.replay, null);
  assert.deepEqual(room.state.drafts[1].map(p => p.guard), [false, true, false]);
  assert.equal(room.state.drafts[1][1].power, 0.5);
  assert.deepEqual(room.state.drafts[0].map(p => p.guard), [false, false, false]);
  assert.deepEqual(room.state.drafts[0].map(p => p.power), [0, 0, 0]);
});

test('authoritative resolution is repeatable, immutable, bounded and serializable', () => {
  const bodies = P.kickoff(); bodies.slice(0, 6).forEach(b => { P.applyStats(b); b.meter = 0; });
  const state = { version: M.VERSION, mode: 'standard', bodies, stats: Array.from({ length: 6 }, () => ({})), scores: [0, 0], turn: 1 };
  const moves = Array.from({ length: 6 }, (_, i) => ({ angle: i < 3 ? 0 : Math.PI, power: .8, spin: .3, superArm: false, guard: false }));
  const original = structuredClone(state), first = M.resolveTurn(P, state, moves);
  assert.deepEqual(state, original); assert.deepEqual(first, M.resolveTurn(P, state, moves));
  assert.ok(first.replay.ticks <= 2880); assert.equal(first.replay.initialBodies.length, 7);
  assert.equal(first.state.turn, 2); assert.doesNotThrow(() => JSON.stringify(first));
  moves[0].superArm = true; assert.throws(() => M.resolveTurn(P, state, moves));
});

test('online goal replays wait for either player and protect the first cycle', () => {
  const room = new MatchRoom('host', 'classic', true);
  room.join('guest', true);
  room.connect('host', 0);
  room.connect('guest', 0);
  for (const owner of ['host', 'guest']) {
    const team = room.guestTeam(owner);
    room.selectTeam(owner, team, team.map(entry => ubu.decode(ubu.fromCode(entry.dna)).supers[0] % 8));
  }
  for (const [start, scores, afterSkip] of [[1000, [0, 0], 'plan'], [20000, [4, 0], 'over']]) {
    const bodies = P.kickoff();
    Object.assign(bodies[6], { x: 959, y: 300, vx: 400 });
    Object.assign(room.state, {
      phase: 'plan', turn: 1, locked: [true, true],
      game: { version: M.VERSION, mode: 'classic', bodies, stats: [], scores, turn: 1 }
    });
    room.advance(start);
    assert.equal(room.state.replay.goal, 0);
    assert.equal(room.state.playUntil, null);
    const requestedAt = start + (afterSkip === 'over' ? 10000 : 2000);
    room.advance(requestedAt);
    assert.equal(room.state.phase, 'resolving');
    assert.throws(() => room.skipReplay('stranger', start, requestedAt));
    room.skipReplay('host', start - 1, requestedAt);
    assert.equal(room.state.playUntil, null);
    room.skipReplay('guest', start, requestedAt);
    const cycleEnd = room.state.playUntil;
    if (afterSkip === 'plan') {
      assert.ok(cycleEnd > requestedAt);
      room.advance(cycleEnd - 1);
      assert.equal(room.state.phase, 'resolving');
    } else {
      assert.equal(cycleEnd, requestedAt);
    }
    room.advance(cycleEnd);
    assert.equal(room.state.phase, afterSkip);
  }
});

test('resolving a turn without presentation effects gives the same match state', () => {
  const moves = Array.from({ length: 6 }, (_, i) => ({ angle: i < 3 ? 0 : Math.PI, power: 1, spin: .6, superArm: false, guard: false }));
  const state = shotState({ x: 343, y: 300 }, { 0: { x: 300, y: 300 } });
  const full = M.resolveTurn(P, state, moves), fast = M.resolveTurn(P, state, moves, { effects: false });
  assert.deepEqual(fast.state, full.state); assert.equal(fast.replay.goal, full.replay.goal);
  assert.ok(full.replay.stops.length > 0); assert.deepEqual(fast.replay.stops, []); assert.equal(fast.replay.initialBodies, null);
});

test('Classic, Pulse, and Blitz combine independently, carry Pulse momentum, and award victory once', () => {
  assert.equal(M.MODES.length, 8);
  assert.ok(['standard', 'classic', 'blitz', 'pulse', 'classic-pulse', 'classic-blitz', 'pulse-blitz', 'classic-pulse-blitz'].every(m => M.MODES.includes(m)));
  assert.throws(() => M.rule('blitz-pulse', 'pulse'));
  assert.equal(M.planningMilliseconds('blitz'), 5000);
  assert.equal(M.planningMilliseconds('classic-pulse'), null);
  assert.equal(M.turnTicks('standard'), 2880);
  assert.equal(M.turnTicks('classic-pulse'), 240);
  const a = {}, b = {};
  M.applyStats(P, a, { impulse: 200 }, 'blitz');
  M.applyStats(P, b, { impulse: 200 }, 'classic-pulse');
  assert.ok(a.impulse > P.IMPULSE);
  assert.equal(b.impulse, P.IMPULSE);

  // Pulse carries momentum across 1s turns while standard stops
  const moves = Array.from({ length: 6 }, idle); moves[1] = { ...idle(), power: .5 };
  const start = pulseState('pulse'); start.bodies[4].y = 500;
  const pulse = M.resolveTurn(P, start, moves);
  assert.equal(pulse.replay.ticks, 240);
  assert.ok(pulse.state.bodies[1].vx > 100);
  const coast = M.resolveTurn(P, pulse.state, Array.from({ length: 6 }, idle));
  assert.ok(coast.state.bodies[1].x > pulse.state.bodies[1].x + 50);

  // Goal at 4-0 awards victory once
  const bodies = P.kickoff(); bodies.slice(0, 6).forEach(u => { P.applyStats(u); u.meter = 0; });
  Object.assign(bodies[6], { x: 959, y: 300, vx: 400 });
  const win = M.resolveTurn(P, { version: M.VERSION, mode: 'classic', bodies, stats: [], scores: [4, 0], turn: 4 }, Array.from({ length: 6 }, idle));
  assert.equal(win.state.winner, 0);
  assert.deepEqual(win.state.scores, [5, 0]);
  assert.equal(win.state.phase, 'over');
  assert.ok(win.state.bodies.slice(0, 6).every(u => u.meter === 0));
});

test('search horizon snapshots preserve partial motion and active supers without issuing end-of-turn fouls', () => {
  const state = pulseState('standard');
  Object.assign(state.bodies[0], { x: 90, y: 255 });
  Object.assign(state.bodies[1], { x: 90, y: 345 });
  const moves = Array.from({ length: 6 }, idle);
  moves[2] = { ...idle(), angle: 0, power: 1 };
  const interim = M.resolveTurn(P, state, moves, { effects: false, ticks: 480, preservePartial: true });
  const forcedEnd = M.resolveTurn(P, state, moves, { effects: false, ticks: 480 });
  assert.equal(interim.replay.ticks, 480);
  assert.equal(interim.state.turn, state.turn);
  assert.ok(Math.hypot(interim.state.bodies[2].vx, interim.state.bodies[2].vy) > 10);
  assert.deepEqual(interim.state.fouls.crease, [false, false]);
  assert.equal(forcedEnd.state.turn, state.turn + 1);
  assert.equal(forcedEnd.state.bodies[2].vx, 0);
  assert.equal(forcedEnd.state.fouls.crease[0], true);

  const pState = pulseState('pulse');
  Object.assign(pState.bodies[2], { equippedSuper: P.SUPERS[5], superActive: 'colossus', superTicks: 600 });
  P.syncEffectiveStats(pState.bodies[2]);
  const pInterim = M.resolveTurn(P, pState, moves, { effects: false, ticks: 120, preservePartial: true });
  assert.equal(pInterim.state.turn, pState.turn);
  assert.equal(pInterim.state.bodies[2].superActive, 'colossus');
  assert.equal(pInterim.state.bodies[2].superTicks, 480);
  const pComplete = M.resolveTurn(P, pState, moves, { effects: false, ticks: 480, preservePartial: true });
  assert.equal(pComplete.replay.ticks, 240);
  assert.equal(pComplete.state.turn, pState.turn + 1);
  assert.equal(pComplete.state.bodies[2].superTicks, 360);
});

test('quick-start friends matches, rematch agreement, and lobby leave/concede rules', () => {
  // Quick-start begins on connect and reuses teams on rematch
  const qRoom = new MatchRoom('host', 'standard', true);
  qRoom.join('friend', true);
  qRoom.readyPair([null, null]);
  qRoom.connect('host', 1000); qRoom.advance(1000);
  assert.equal(qRoom.state.phase, 'lobby');
  qRoom.connect('friend', 1100); qRoom.advance(1100);
  assert.equal(qRoom.state.phase, 'plan');
  const rosters = structuredClone(qRoom.state.rosters);
  qRoom.disconnect('friend', 1200);
  qRoom.claimForfeit('host', 61200);
  qRoom.connect('friend', 61300);
  qRoom.rematch('host', 61300); qRoom.rematch('friend', 61300); qRoom.advance(61300);
  assert.equal(qRoom.state.phase, 'plan');
  assert.deepEqual(qRoom.state.rosters, rosters);

  // Lobby unready/leave frees seat; mid-match leave concedes and blocks rematch
  const room = new MatchRoom('host', 'standard', true);
  const supers = i => room.state.guestTeams[i].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  room.join('guest', true); room.connect('host', 0); room.connect('guest', 0);
  assert.throws(() => room.rematch('host', 0));
  room.selectTeam('host', room.state.guestTeams[0], supers(0)); room.unready('host');
  room.selectTeam('guest', room.state.guestTeams[1], supers(1)); room.advance(0);
  assert.equal(room.state.phase, 'lobby');
  room.leave('guest', 0);
  assert.deepEqual(room.state.players, ['host', null]);
  room.join('other', true); room.connect('other', 0);
  room.selectTeam('host', room.state.guestTeams[0], supers(0)); room.selectTeam('other', room.state.guestTeams[1], supers(1));
  room.advance(0);
  assert.equal(room.state.phase, 'plan');
  assert.throws(() => room.unready('host'));
  assert.throws(() => room.rematch('host', 100));
  room.leave('other', 1000);
  assert.equal(room.state.phase, 'over'); assert.equal(room.state.winner, 0);
  assert.throws(() => room.rematch('host', 1000), /left/);
});

test('guest seats, display name limits, registry quick-start, and Discord seat claiming', () => {
  const room = new MatchRoom('g_host', 'classic', true);
  room.rename('g_host', '  Saffron  ');
  room.join('111', false);
  room.rename('111', 'x'.repeat(40));
  assert.equal(room.view('111').names[0], 'Saffron');
  assert.equal(room.view('g_host').names[1].length, 32);
  assert.equal(room.state.guestTeams[0].length, 3);
  assert.equal(room.state.guestTeams[1], null);
  assert.throws(() => room.join('g_guest', true));
  assert.equal(room.claim('222', 'g_unknown'), false);
  assert.equal(room.claim('111', 'g_host'), false);
  assert.equal(room.claim('333', 'g_host'), true);
  assert.deepEqual(room.state.players, ['333', '111']);
  assert.equal(room.state.guestTeams[0], null);
  assert.throws(() => room.seat('g_host'));

  const regRoom = new MatchRoom('111', 'standard');
  regRoom.join('g_guest', true);
  const entries = rarity.starterTeam(ubu).map((dna, i) => ({ dna, serial: String(i + 1).padStart(12, '0') }));
  const supers = entries.map(({ dna }) => ubu.decode(ubu.fromCode(dna)).supers[1] % 8);
  regRoom.readyPair([{ entries, supers }, null]);
  assert.deepEqual(regRoom.state.ready, [true, true]);
  assert.deepEqual(regRoom.state.rosters[0].map(e => e.superId), supers);
});

test('goal camping and corner stalling warn, lapse during play, card offenders, and reset ball cleanly', () => {
  const fouls = M.newFouls(), crowd = { 0: { x: 80, y: 270 }, 1: { x: 80, y: 330 } };
  foulTurn(fouls, { 0: { x: 80, y: 300 } }); assert.deepEqual(fouls.crease, [false, false]);
  foulTurn(fouls, { ...crowd, 3: { x: 160, y: 150 }, 4: { x: 165, y: 450 } }); assert.deepEqual(fouls.crease, [false, false]);
  foulTurn(fouls, crowd); assert.deepEqual(fouls.crease, [true, false]); assert.deepEqual(fouls.cards, []);
  // Leaving during play lapses warning; staying cards defenders and resets them to spawn with 0 meter
  const left = M.resolveTurn(P, shotState({ x: 500, y: 300 }, crowd, { fouls: { ...M.newFouls(), crease: [true, false] } }),
    [idle(), { ...idle(), power: 1 }, idle(), idle(), idle(), idle()]).state;
  assert.deepEqual(left.fouls.crease, [false, false]); assert.deepEqual(left.fouls.cards, []);
  const carded = foulTurn(fouls, { ...crowd, 2: { x: 120, y: 300 } });
  assert.deepEqual(fouls.cards, [0, 1, 2]);
  for (const i of [0, 1, 2]) {
    assert.deepEqual({ x: carded[i].x, y: carded[i].y }, P.spawn(0, i));
    assert.equal(carded[i].meter, 0); assert.ok(carded[i].carded && carded[i].stunned);
  }
  M.finishTurn(P, carded, [], [0, 0], null, 'standard', {}, fouls);
  assert.ok(carded.every(b => !b.carded));

  // Corner stalling warns for 2 turns, lapses beyond exit hysteresis, and cards larger team + faceoff on turn 3
  const cFouls = M.newFouls(), corner = { x: 90, y: 90 }, place = { 0: { x: 120, y: 75 }, 3: { x: 75, y: 125 }, 4: { x: 135, y: 130 } };
  for (let n = 1; n <= 2; n++) { foulTurn(cFouls, place, corner); assert.equal(cFouls.cornerTurns, n); }
  const lapsed = structuredClone(cFouls); M.lapseFouls(P, P.kickoff(), lapsed);
  assert.equal(lapsed.corner, null); assert.equal(lapsed.cornerTurns, 0);
  const reset = foulTurn(cFouls, { ...place, 0: { x: 500, y: 300 } }, corner);
  assert.ok(cFouls.faceoff); assert.deepEqual(cFouls.cards, [3, 4]);
  assert.equal(reset[6].x, 500); assert.equal(reset[6].y, 240);

  // Carded skaters are intangible
  const ghosted = P.kickoff(); ghosted.slice(0, 6).forEach(b => P.applyStats(b));
  Object.assign(ghosted[0], { x: 400, y: 300, carded: true }); Object.assign(ghosted[6], { x: 460, y: 300, vx: -600 });
  for (let t = 0; t < 80; t++) P.step(ghosted, P.DT);
  assert.ok(ghosted[6].x < 330); assert.equal(ghosted[0].x, 400);
});

test('core meter, save, and assist rules enforce cooldowns, true saves, and interception clearing', () => {
  // Meter excludes super users, teammates on contact, and enforces cooldown
  const bodies = P.kickoff(); bodies.forEach(b => { b.meter = 0; });
  bodies[1].usedSuperThisTurn = true;
  M.gainMeter(P, bodies, [], bodies[0], 18);
  assert.equal(bodies[0].meter, 18 * M.METER.rate);
  assert.equal(bodies[1].meter, 0);
  assert.equal(bodies[2].meter, 18 * M.METER.rate * M.METER.teammate);
  assert.equal(bodies[3].meter, 0);

  const cb = P.kickoff(); cb.forEach(b => { b.meter = 0; });
  const { minSpeed, cooldownTicks, rate } = M.METER;
  M.contactMeter(P, cb, [], cb[0], cb[6], minSpeed - 1, 0); assert.equal(cb[0].meter, 0);
  M.contactMeter(P, cb, [], cb[0], cb[1], 500, 0); assert.equal(cb[0].meter, 0);
  M.contactMeter(P, cb, [], cb[6], cb[0], minSpeed, 0); assert.equal(cb[0].meter, M.METER.ball * rate);
  M.contactMeter(P, cb, [], cb[0], cb[6], 500, cooldownTicks - 1); assert.equal(cb[0].meter, M.METER.ball * rate);
  M.contactMeter(P, cb, [], cb[0], cb[6], 500, cooldownTicks); assert.equal(cb[0].meter, 2 * M.METER.ball * rate);

  // Conceding awards conceded bonus; plain turns award no meter
  const tb = P.kickoff(); tb.forEach(b => { b.meter = 0; });
  M.finishTurn(P, tb, [], [0, 0], null, 'standard'); assert.ok(tb.every(b => b.meter === 0));
  M.finishTurn(P, tb, [], [0, 0], 0, 'standard');
  assert.ok(tb.slice(0, 3).every(b => b.meter === 0));
  assert.ok(tb[3].meter > 0);

  // Saves require an on-target shot that stays out of goal (not wide, covered, or deflected in)
  const blocked = M.resolveTurn(P, shotState({ x: 260, y: 300, vx: -600 }, { 0: { x: 130, y: 300 } }, { credit: { 3: 1 } }), Array.from({ length: 6 }, idle));
  assert.deepEqual(blocked.replay.saves.map(s => s.index), [0]);
  const wide = M.resolveTurn(P, shotState({ x: 260, y: 150, vx: -600 }, { 0: { x: 130, y: 150 } }), Array.from({ length: 6 }, idle));
  assert.deepEqual(wide.replay.saves, []);
  const deflected = M.resolveTurn(P, shotState({ x: 800, y: 250, vx: 700 }, { 3: { x: 905, y: 300 } }, { credit: { 0: 1 } }), Array.from({ length: 6 }, idle));
  assert.equal(deflected.replay.goal, 0); assert.deepEqual(deflected.replay.saves, []);

  // Assists credit passer, survive scorer self-touch, and clear on opponent touch
  const ab = P.kickoff(); ab.slice(0, 6).forEach((b, i) => { P.applyStats(b); Object.assign(b, { x: 100 + i * 30, y: 100 }); });
  const play = M.newPlay(), touch = i => {
    Object.assign(ab[6], { x: 500, y: 300, vx: 0, vy: 0 });
    Object.assign(ab[i], { x: 457.5, y: 300, vx: 300, vy: 0 });
    M.playTick(P, ab, play);
    Object.assign(ab[i], { x: 100 + i * 30, y: 100, vx: 0, vy: 0 });
  };
  touch(1); touch(2); assert.equal(play.assist[0], 1);
  touch(2); assert.equal(play.assist[0], 1);
  touch(4); touch(2); assert.equal(play.assist[0], null);
  const goalRes = M.resolveTurn(P, shotState({ x: 930, y: 300, vx: 300 }, {}, { lastTouch: [2, null], last: 2, assist: [1, null], credit: { 2: 1 }, roundTurns: 1 }), Array.from({ length: 6 }, idle));
  assert.equal(goalRes.replay.assist, 1);
  assert.deepEqual(goalRes.state.tally.assists, [0, 1, 0, 0, 0, 0]);
});
