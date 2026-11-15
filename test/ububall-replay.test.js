const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const U = require('../shared/ubu.js');
const R = require('../shared/ububall-replay.js');

function seededRandom(seed = 1) {
  let value = seed >>> 0;
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Pure deterministic physics/replay move generator (zero dependency on ububall-cpu.js)
// Exercises full [-1, 1] spin, Carve Drive, Spin Strike, guards/Iron Saves, passes, and supers.
function seededPlans(state, seed) {
  const rng = seededRandom(seed);
  const ball = state.bodies[6];
  const plans = new Array(6);
  const imminentGoal = ball.x > 890 || ball.x < 110;
  for (let i = 0; i < 6; i++) {
    const b = state.bodies[i];
    if (b.stunned) {
      plans[i] = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
      continue;
    }
    const slot = i % 3;
    if (imminentGoal && b.team === 1 && ball.x > 890) {
      plans[i] = { angle: Math.PI, power: 0.4, spin: 0, superArm: false, guard: false };
      continue;
    }
    if (slot === 1 && rng() < 0.28) {
      plans[i] = { angle: 0, power: 0, spin: 0, superArm: false, guard: true };
      continue;
    }
    const tx = slot === 0 ? ball.x : (slot === 1 ? (b.team ? 140 : 860) : ball.x + (rng() - 0.5) * 140);
    const ty = slot === 0 ? ball.y : (slot === 1 ? 300 + (rng() - 0.5) * 120 : 120 + rng() * 360);
    const angle = Math.atan2(ty - b.y, tx - b.x) + (rng() - 0.5) * 0.22;
    const power = 0.45 + rng() * 0.55;
    const spin = Math.max(-1, Math.min(1, (rng() * 2 - 1)));
    plans[i] = { angle, power, spin, superArm: false, guard: false };
  }
  return plans;
}

function setup(seed, mode) {
  const random = seededRandom(seed), bodies = P.kickoff(), stats = [], ubus = [];
  for (const b of bodies.slice(0, 6)) {
    const dna = Uint8Array.from({ length: 128 }, () => Math.floor(random() * 256)), model = U.decode(dna);
    const classic = M.rule(mode, 'classic'), raw = classic ? {} : model.stats;
    stats.push(raw); M.applyStats(P, b, raw, mode);
    const mastery = classic ? null : P.superMastery(model.supers, model.supers[0] % 8);
    b.equippedSuper = classic ? null : { ...P.SUPERS[model.supers[0] % 8], ...mastery };
    b.superBonusTicks = mastery?.bonusTicks || 0;
    b.superBonusRefund = mastery?.bonusRefund || 0;
    // Full meters, so supers are armed and replayed too.
    b.meter = classic ? 0 : 100;
    ubus.push({ dna: U.toCode(dna), super: b.equippedSuper?.id ?? null });
  }
  return { state: { version: M.VERSION, mode, bodies, stats, scores: [0, 0], turn: 1, phase: 'plan', winner: null }, ubus };
}
// Plays CPU turns, recording each as a match does, and returns the replay with each turn's
// end-of-play field as the live loop left it (before the turn's end rules).
function record(seed, mode, turns, each = null) {
  let { state, ubus } = setup(seed, mode);
  const replay = R.create({ mode, names: ['Left', 'Right'], ubus }), ends = [];
  for (let n = 0; n < turns && state.winner === null; n++) {
    if (state.phase === 'goal') {
      const spots = P.kickoff();
      state.bodies.forEach((b, i) => Object.assign(b, { x: spots[i].x, y: spots[i].y, vx: 0, vy: 0, omega: 0 }));
    }
    if (each) each(state, n);
    const moves = seededPlans(state, Math.imul(seed + 1, 2654435761) + n * 97);
    moves.forEach((m, i) => { if (i % 3 === 0 && state.bodies[i].meter >= 100 && !state.bodies[i].stunned) m.superArm = true; });
    // As resolveTurn does, arming comes from the moves alone.
    state.bodies.forEach(b => { if (b.team >= 0) b.superArm = false; });
    // The moves exactly as resolveTurn plays them (it normalises angles again, which can move a launch by a bit).
    const plans = [...M.validatePlans(moves.slice(0, 3)), ...M.validatePlans(moves.slice(3))];
    const entry = R.addTurn(replay, { turn: state.turn, scores: state.scores, fouls: state.fouls || M.newFouls(), bodies: state.bodies, plans });
    const live = structuredClone(state.bodies), play = M.newPlay();
    P.startTurn(live, plans);
    let ticks = 0;
    for (let tick = 1; tick <= M.turnTicks(mode); tick++) {
      ticks = tick;
      if (M.playTick(P, live, play, {}, null, false).goal !== null || P.settled(live)) break;
    }
    const result = M.resolveTurn(P, state, moves);
    assert.equal(result.replay.ticks, ticks);
    entry.ticks = ticks; ends.push(R.snapshot(live));
    if (result.replay.goal !== null) entry.goal = { team: result.replay.goal, label: result.replay.label, scorer: result.replay.scorer, assist: result.replay.assist };
    entry.cards = [...result.state.fouls.cards];
    entry.saves = result.replay.saves.map(e => ({ tick: e.tick, index: e.index, own: e.own, iron: Boolean(e.iron) }));
    entry.stops = result.replay.stops;
    state = result.state;
  }
  return { replay, ends };
}
function replayTurn(t) {
  const sim = R.restore(t.bodies);
  P.startTurn(sim, t.plans);
  for (let tick = 0; tick < t.ticks; tick++) P.step(sim, P.DT);
  return R.snapshot(sim);
}

test('a saved replay re-simulates every turn exactly, through the .ububall file', async () => {
  for (const mode of ['standard', 'pulse', 'classic']) {
    const { replay, ends } = record(7, mode, mode === 'pulse' ? 40 : 12);
    const file = await R.write(replay), back = await R.read(file);
    assert.equal(back.turns.length, replay.turns.length);
    // JSON keeps every value exactly except the sign of zero, which no position depends on.
    back.turns.forEach((t, i) => assert.equal(JSON.stringify(replayTurn(t)), JSON.stringify(ends[i]), `${mode} turn ${i + 1}`));
    assert.deepEqual(await R.read(await R.write(back)), back);
  }
});

// Scripted turns for what CPU matches may rarely reach: every super armed into a shot and into a
// check, fire hits head-on and glancing, an Iron Save, and a Sticky hold carried across a Pulse turn
// through JSON, as online state is. Returns each turn's end field; `each` also gets the turn's starting
// state as JSON, its moves and its result.
const still = { angle: 0, power: 0, spin: 0, superArm: false, guard: false };
function field(mode, place) {
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach(b => { M.applyStats(P, b, {}, mode); b.meter = 0; });
  for (const [i, at] of Object.entries(place)) Object.assign(bodies[i], at);
  return { version: M.VERSION, mode, bodies, stats: [], scores: [0, 0], turn: 1, phase: 'plan', winner: null };
}
const armed = (state, key) => Object.assign(state.bodies[0], { equippedSuper: { ...P.SUPERS.find(s => s.key === key) }, meter: 100 });

test('Game Log counts big post shots once and credits passes to the teammate who sent the ball', () => {
  function gameLog(y, power, teammate = false) {
    const state = field('standard', {
      0: { x: 720, y }, 1: teammate ? { x: 850, y } : { x: 265, y: 430 },
      2: { x: 350, y: 430 }, 3: { x: 435, y: 430 }, 4: { x: 520, y: 430 }, 5: { x: 605, y: 430 },
      6: { x: 775, y }
    });
    const replay = { turns: [] }, plans = [{ ...still, power }, still, still, still, still, still];
    const t = R.addTurn(replay, { ...state, fouls: M.newFouls(), plans });
    const { replay: result, state: after } = M.resolveTurn(P, { ...state, tally: M.newTally() }, plans);
    t.ticks = result.ticks;
    t.saves = result.saves;
    if (result.goal !== null) t.goal = { team: result.goal, scorer: result.scorer, assist: result.assist, label: result.label };
    const out = R.stats(replay);
    for (const k of ['goals', 'assists', 'shots', 'saves', 'bigSaves', 'checks', 'cards']) assert.deepEqual(out[k], after.tally[k], `S4 ${k}`);
    assert.deepEqual(out.topShot, after.tally.topSpeed, 'S4 topShot');
    return out;
  }
  const post = gameLog(235, 1);
  assert.equal(post.shots[0], 1);
  assert.equal(post.events.find(event => event.type === 'Shot').outcome, 'Post');
  const postPath = post.events.find(event => event.type === 'Shot').path;
  assert.ok(postPath.from.tick < postPath.to.tick);
  assert.ok(postPath.from.x < postPath.to.x);
  assert.deepEqual(post.rounds, [{ team: null }]);
  assert.equal(gameLog(235, .6).shots[0], 0);
  const goal = gameLog(245, 1);
  assert.equal(goal.shots[0], 1);
  assert.equal(goal.goals[0], 1);
  const scoringPath = goal.events.find(event => event.type === 'Goal').path;
  assert.deepEqual(goal.events.find(event => event.type === 'Shot').path, scoringPath);
  assert.equal(scoringPath.to.tick, goal.trails[0].endTick);
  assert.deepEqual(goal.rounds, [{ team: 0, score: 1 }]);
  const pass = gameLog(300, 1, true);
  const sent = pass.events.filter(event => event.type === 'Pass' && event.actor === 0);
  assert.ok(sent.length > 0);
  assert.equal(pass.passes[0], sent.length);
  const event = pass.events.find(event => event.type === 'Pass');
  assert.equal(event.target, 1);
  assert.ok(event.tick > 0);
  assert.equal(event.turnIndex, 0);
  assert.ok(pass.events.every(({ path, tick }) => path.from.tick < path.to.tick && path.to.tick >= tick));
  assert.equal(event.path.to.tick, event.tick);
  assert.ok(event.tick - event.path.from.tick <= 120);
  const [{ samples }] = pass.trails;
  assert.deepEqual([...samples.slice(12, 14)], [775, 300]);
  assert.ok(samples.some((value, index) => index % 14 === 12 && value > 775));
});

function scripted(each = () => {}) {
  const ends = [], play = (state, moves) => {
    const json = JSON.stringify(state), result = M.resolveTurn(P, state, moves, { effects: false });
    each(json, moves, result);
    ends.push(R.snapshot(result.state.bodies));
    return result.state;
  };
  const shoot = [{ ...still, power: 1, superArm: true }, still, still, still, still, still];
  for (const { key } of P.SUPERS) {
    for (const place of [{ 0: { x: 400, y: 300 }, 6: { x: 450, y: 300 }, 3: { x: 600, y: 300 } }, { 0: { x: 400, y: 300 }, 3: { x: 520, y: 300 }, 6: { x: 500, y: 480 } }]) {
      const state = field('standard', place); armed(state, key); play(state, shoot);
    }
  }
  for (const [offset, guard] of [[0, false], [36, false], [0, true], [20, true]]) {
    play(field('standard', { 3: { x: 600, y: 300 + offset }, 6: { x: 450, y: 300, vx: 720, onFire: true, fireTicks: P.FIRE_TICKS, strikerTeam: 0, strikerPower: 1 } }),
      [still, still, still, { ...still, guard }, still, still]);
  }
  const pulse = field('pulse', { 0: { x: 440, y: 300 } }); armed(pulse, 'sticky');
  const held = play(pulse, [{ ...still, power: .5, superArm: true }, still, still, still, still, still]);
  play(JSON.parse(JSON.stringify(held)), [{ ...still, angle: Math.PI / 2, power: .6 }, still, still, still, still, still]);
  // A loaded ball: a Cannonball into a teammate's Guard stays lit at its pace into the next Pulse turn,
  // where another teammate's soft shot fires it off at that pace.
  const loaded = field('pulse', { 0: { x: 300, y: 300 }, 6: { x: 345, y: 300 }, 1: { x: 470, y: 300 }, 2: { x: 370, y: 420 } }); armed(loaded, 'cannonball');
  const lit = play(loaded, [{ ...still, power: 1, superArm: true }, { ...still, guard: true }, still, still, still, still]);
  const [shooter, ball] = [lit.bodies[2], lit.bodies[6]];
  play(JSON.parse(JSON.stringify(lit)), [still, { ...still, guard: true }, { ...still, angle: Math.atan2(ball.y - shooter.y, ball.x - shooter.x), power: .4 }, still, still, still]);
  // A Pulse pass from slot 0 carried across JSON into a Snap one-timer by slot 1, and a corner Rim-Around keeping spinStrike.
  const snapPass = play(field('pulse', { 0: { x: 300, y: 180 }, 6: { x: 344, y: 180 }, 1: { x: 360, y: 320 } }),
    [{ ...still, angle: Math.PI / 2, power: .7 }, still, still, still, still, still]);
  const [oneTimer, liveBall] = [snapPass.bodies[1], snapPass.bodies[6]];
  play(JSON.parse(JSON.stringify(snapPass)),
    [still, { ...still, angle: Math.atan2(liveBall.y - oneTimer.y, liveBall.x - oneTimer.x), power: .85 }, still, still, still, still]);
  const rimStart = field('standard', { 0: { x: 92, y: 210 }, 6: { x: 220, y: 92 } });
  play(JSON.parse(JSON.stringify(rimStart)), [{ ...still, angle: -Math.PI * .44, power: .9, spin: -1 }, still, still, still, still, still]);
  return ends;
}

// The physics this version of the replay format plays back. A change to how turns play out must
// bump P.VERSION, which makes older replays refuse to play; then record the new fingerprint here.
const FINGERPRINTS = { 1: '25fc28df601f6fcd', 2: '010e56666f6547fd', 3: '554a0eeae1fd368f', 4: 'acb65e3b3be77ac8', 5: 'b40578a293ecbf1e', 6: 'e06866ac1d001c31', 7: '37a23456c784360a', 8: '83873175fc525045', 9: '09b47d9873e6c0d2', 10: 'c4a526d87f85f50d', 11: 'c149d32f71adb8f2', 12: 'a685065b99430f89', 13: 'dc91a880c4ee68be', 14: '2ac13b21775f0ea2', 15: '248086ed8e0fd514', 16: '9d8b34db2268210c', 17: '972e69182193ab24', 18: 'ae483586854f6d31', 19: '204a59c696047c0b', 20: '7a6a6fce3eaf5650', 21: '5062c20061903979', 22: '0ee5630f69ba5d66', 23: '5a3b47bd871862e7', 24: '2a3f920af1689fe1', 25: '9da10598a7eb12a9', 26: '9a31e6fbed5fe191', 27: '48448020ef8eeb55', 28: '130fc9e43b8c2555', 29: '19c7029a508d02c0' };
test('the physics fingerprint matches P.VERSION', () => {
  const { replay } = record(11, 'pulse', 16), standard = record(12, 'standard', 4).replay;
  const ends = [...[...replay.turns, ...standard.turns].map(replayTurn), ...scripted()];
  const print = createHash('sha256').update(JSON.stringify(ends)).digest('hex').slice(0, 16);
  assert.equal(print, FINGERPRINTS[P.VERSION], `Physics changed: bump VERSION in shared/ububall-physics.js and record ${print} for it.`);
});

// Online state crosses JSON (the server's storage and every client update), so no turn may play out
// differently from a JSON copy of its state: no references, Sets or other values JSON cannot keep.
test('every scripted turn plays the same from a JSON copy of its state', () => {
  let turns = 0;
  scripted((json, moves, result) => {
    turns++;
    assert.equal(JSON.stringify(M.resolveTurn(P, JSON.parse(json), moves, { effects: false })), JSON.stringify(result), `scripted turn ${turns}`);
  });
  assert.ok(turns > 20);
});

// Online state crosses JSON (the server's storage and every client update), so a Sticky hold must
// carry into the next Pulse turn from a JSON copy exactly as it does in memory.
test('a Sticky hold survives JSON into the next Pulse turn', () => {
  const pulse = field('pulse', { 0: { x: 440, y: 300 } }); armed(pulse, 'sticky');
  const held = M.resolveTurn(P, pulse, [{ ...still, power: .5, superArm: true }, still, still, still, still, still]).state;
  assert.equal(P.holder(held.bodies), held.bodies[0], 'the turn ends with the ball held');
  const moves = [{ ...still, angle: Math.PI / 2, power: .6 }, still, still, still, still, still];
  const memory = M.resolveTurn(P, structuredClone(held), moves).state, json = M.resolveTurn(P, JSON.parse(JSON.stringify(held)), moves).state;
  assert.equal(JSON.stringify(R.snapshot(json.bodies)), JSON.stringify(R.snapshot(memory.bodies)));
  assert.ok(Math.abs(memory.bodies[6].y - 300) > 50, 'the ball went with its carrier');
});

test('replays refuse other versions and any file a writer would not produce', async () => {
  const { replay } = record(3, 'standard', 2);
  const good = R.canonical({ type: 'ububall-replay', format: R.FORMAT, physics: P.VERSION, ...replay });
  const gzip = async text => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  await assert.rejects(R.read(await gzip(JSON.stringify({ ...good, physics: P.VERSION - 1 }))), /older version/);
  await assert.rejects(R.read(await gzip(JSON.stringify({ ...good, physics: P.VERSION + 1 }))), /newer version/);
  await assert.rejects(R.read(await gzip(JSON.stringify({ ...good, extra: 1 }))), /not a valid/);
  await assert.rejects(R.read(await gzip(JSON.stringify(good, null, 1))), /not a valid/);
  await assert.rejects(R.read(new TextEncoder().encode(JSON.stringify(good))), /not a valid/);
  const forged = structuredClone(good);
  forged.turns[0].bodies[0].__proto__ = 1;
  await assert.rejects(R.read(await gzip(JSON.stringify(forged).replace('"x":', '"__proto__":{"polluted":1},"x":'))), /not a valid/);
  for (const patch of [t => { t.bodies[0].x = 'a'; }, t => { t.bodies[6].team = 0; }, t => { t.plans[0].power = 2; }, t => { t.ticks = 0; }, t => { t.bodies[1].holding = 1; },
    t => { t.stops = [{ tick: 0, ms: 60 }]; }, t => { t.stops = [{ tick: 2, ms: 60 }, { tick: 1, ms: 60 }]; }, t => { t.saves = [{ tick: 1, index: 0, own: false }]; }]) {
    const bad = structuredClone(good); patch(bad.turns[0]);
    await assert.rejects(R.read(await gzip(JSON.stringify(bad))), /not a valid/);
  }
  const badDna = structuredClone(good); badDna.ubus[0].dna = badDna.ubus[0].dna.slice(0, 170) + 'B';
  await assert.rejects(R.read(await gzip(JSON.stringify(badDna))), /not a valid/);
  assert.deepEqual(await R.read(await gzip(JSON.stringify(good))), good);
});

test('clips keep a turn or a round as a titled replay of its own', async () => {
  for (const mode of ['standard', 'pulse']) {
    const { replay, ends } = record(1, mode, 4, (s, n) => {
      if (n === 0 || n === 2) Object.assign(s.bodies[6], { x: 920, y: 300, vx: 500, vy: 0 });
    });
    const goals = replay.turns.flatMap((t, i) => t.goal ? [i] : []);
    assert.ok(goals.length >= 2, `${mode} has goals to test rounds against`);
    // A round runs from the turn after a goal through the next goal, whatever the mode.
    const k = goals[0] + 1 + Math.floor((goals[1] - goals[0] - 1) / 2);
    assert.deepEqual(R.roundRange(replay, k), [goals[0] + 1, goals[1]]);
    assert.deepEqual(R.roundRange(replay, 0), [0, goals[0]]);
    const back = await R.read(await R.write(R.clip({ ...replay, final: { scores: [5, 0], winner: 0 } }, goals[0] + 1, goals[1], 'Round 2')));
    assert.equal(back.clip, true); assert.equal(back.title, 'Round 2'); assert.equal(back.final, null);
    back.turns.forEach((t, i) => assert.equal(JSON.stringify(replayTurn(t)), JSON.stringify(ends[goals[0] + 1 + i])));
  }
  const { replay } = record(9, 'standard', 4);
  const good = R.canonical({ type: 'ububall-replay', format: R.FORMAT, physics: P.VERSION, ...R.clip(replay, 0, 1, 'Two turns') });
  for (const patch of [{ final: { scores: [1, 0], winner: 0 } }, { title: ' padded' }, { title: '' }, { title: 'x'.repeat(R.MAX_TITLE + 1) }, { clip: 1 }, { anonymous: true }]) {
    assert.throws(() => R.canonical({ ...good, ...patch }), /not a valid/);
  }
});

test('replay snapshot and restore preserves ironGuard flag', () => {
  const bodies = P.kickoff();
  bodies[0].guarding = true;
  bodies[0].ironGuard = true;
  bodies[1].guarding = true;
  bodies[1].ironGuard = false;
  const snap = R.snapshot(bodies);
  const restored = R.restore(snap);
  assert.equal(restored[0].guarding, true);
  assert.equal(restored[0].ironGuard, true);
  assert.equal(restored[1].guarding, true);
  assert.equal(restored[1].ironGuard, false);
});

test('privacy keeps the play, looks and voices but drops every name', async () => {
  const { replay, ends } = record(4, 'standard', 6);
  const hidden = await R.read(await R.write(R.anonymize({ ...replay, seat: 1, title: 'Me vs Bob' })));
  assert.equal(hidden.anonymous, true); assert.equal(hidden.title, null);
  assert.deepEqual(hidden.names, ['Amethyst', 'Saffron'], 'Saffron is the team shown on the left');
  hidden.ubus.forEach((u, i) => {
    const before = U.fromCode(replay.ubus[i].dna), after = U.fromCode(u.dna);
    assert.deepEqual([...after.subarray(0, 8)], [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(after.subarray(8), before.subarray(8));
    const a = U.decode(before), b = U.decode(after);
    assert.notEqual(b.parts.fullName, a.parts.fullName);
    assert.deepEqual([b.attributes, b.voice, b.stats], [a.attributes, a.voice, a.stats]);
  });
  hidden.turns.forEach((t, i) => assert.equal(JSON.stringify(replayTurn(t)), JSON.stringify(ends[i])));
});

test('Snap and Rim-Around turns round-trip identically through .ububall files and JSON state copies', async () => {
  const { state: initState, ubus } = setup(21, 'pulse');
  // Place slot 0 passing down into slot 1 driving right for a Snap one-timer, while slot 2 carves the bottom-left corner
  initState.bodies.slice(0, 6).forEach((b, i) => { b.meter = 0; Object.assign(b, { x: 200 + i * 90, y: 460, vx: 0, vy: 0, omega: 0 }); });
  Object.assign(initState.bodies[0], { x: 380, y: 170 });
  Object.assign(initState.bodies[1], { x: 340, y: 300 });
  Object.assign(initState.bodies[2], { x: 92, y: 390 });
  Object.assign(initState.bodies[6], { x: 380, y: 214, vx: 0, vy: 0 });

  const replay = R.create({ mode: 'pulse', names: ['Home', 'Away'], ubus });
  const turnMoves = [
    [
      { angle: Math.PI / 2, power: 0.65, spin: 0, superArm: false, guard: false },
      { angle: 0, power: 0.75, spin: 0, superArm: false, guard: false },
      { angle: Math.PI * 0.44, power: 0.9, spin: 1, superArm: false, guard: false },
      still, still, still
    ],
    [
      still,
      { angle: 0, power: 0.8, spin: 0.5, superArm: false, guard: false },
      { angle: 0, power: 0.6, spin: 0, superArm: false, guard: false },
      still, still, still
    ]
  ];

  let cur = initState;
  const liveEnds = [];
  let sawSnapStop = false;
  for (const rawMoves of turnMoves) {
    const jsonState = JSON.parse(JSON.stringify(cur));
    const plans = [...M.validatePlans(rawMoves.slice(0, 3)), ...M.validatePlans(rawMoves.slice(3))];
    const entry = R.addTurn(replay, { turn: cur.turn, scores: cur.scores, fouls: cur.fouls || M.newFouls(), bodies: cur.bodies, plans });
    const live = structuredClone(cur.bodies), play = M.newPlay();
    P.startTurn(live, plans);
    let ticks = 0;
    for (let tick = 1; tick <= M.turnTicks('pulse'); tick++) {
      ticks = tick;
      const stepRes = M.playTick(P, live, play, {}, null, true);
      if (stepRes.snapped && stepRes.stop >= M.HIT_STOP.snap) sawSnapStop = true;
      if (stepRes.goal !== null || P.settled(live)) break;
    }
    const resMem = M.resolveTurn(P, cur, rawMoves);
    const resJson = M.resolveTurn(P, jsonState, rawMoves);
    assert.equal(JSON.stringify(resJson), JSON.stringify(resMem), 'JSON state copy resolves identically');
    entry.ticks = ticks;
    entry.cards = [...resMem.state.fouls.cards];
    entry.saves = resMem.replay.saves.map(e => ({ tick: e.tick, index: e.index, own: e.own, iron: Boolean(e.iron) }));
    entry.stops = resMem.replay.stops;
    if (resMem.replay.goal !== null) entry.goal = { team: resMem.replay.goal, label: resMem.replay.label, scorer: resMem.replay.scorer, assist: resMem.replay.assist };
    liveEnds.push(R.snapshot(live));
    cur = resMem.state;
  }
  assert.equal(sawSnapStop, true, 'scripted pass triggered Snap and recorded Snap hit-stop');
  const bytes = await R.write(replay);
  const parsed = await R.read(bytes);
  parsed.turns.forEach((t, idx) => {
    assert.equal(JSON.stringify(replayTurn(t)), JSON.stringify(liveEnds[idx]), `re-simulated turn ${idx + 1} matches live end`);
  });
});

test('replay validator rejects invalid physics bounds, oversized turn ticks, forged final winners, and leaky anonymization', async () => {
  const { replay } = record(3, 'pulse', 2);
  const good = R.canonical({ type: 'ububall-replay', format: R.FORMAT, physics: P.VERSION, ...replay });
  const gzip = async text => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());

  for (const patch of [
    r => { r.turns[0].bodies[0].mass = 0; },
    r => { r.turns[0].bodies[0].radius = -5; },
    r => { r.turns[0].bodies[0].friction = -1; },
    r => { r.turns[0].bodies[6].curveMult = 0; },
    r => { r.turns[0].bodies[0].daze = -0.1; },
    r => { r.turns[0].ticks = M.turnTicks('pulse') + 1; },
    r => { r.final = { scores: [5, 0], winner: 1 }; },
    r => { r.final = { scores: [2, 2], winner: 0 }; }
  ]) {
    const bad = structuredClone(good);
    patch(bad);
    await assert.rejects(R.read(await gzip(JSON.stringify(bad))), /not a valid/);
  }

  const anon = R.canonical({ type: 'ububall-replay', format: R.FORMAT, physics: P.VERSION, ...R.anonymize(replay) });
  assert.deepEqual(await R.read(await gzip(JSON.stringify(anon))), JSON.parse(JSON.stringify(anon)));

  const leakyName = structuredClone(anon);
  leakyName.names = ['RealName', 'Saffron'];
  await assert.rejects(R.read(await gzip(JSON.stringify(leakyName))), /not a valid/);

  const leakyDna = structuredClone(anon);
  leakyDna.ubus[0].dna = 'AAAAAAAAAAE' + leakyDna.ubus[0].dna.slice(11);
  await assert.rejects(R.read(await gzip(JSON.stringify(leakyDna))), /not a valid/);
});

test('R.stats counts bigSaves from recorded turn saves without duplicate counterfactual simulation', () => {
  const state = field('pulse', { 0: { x: 300, y: 300 }, 3: { x: 860, y: 300 }, 6: { x: 500, y: 300, vx: 0, vy: 0 } });
  const replay = { turns: [] };
  const plans = Array.from({ length: 6 }, () => still);
  const entry = R.addTurn(replay, { ...state, fouls: M.newFouls(), plans });
  entry.ticks = 5;
  entry.saves = [{ tick: 2, index: 3, own: false, iron: true }, { tick: 4, index: 0, own: true, iron: false }];
  const stats = R.stats(replay);
  assert.deepEqual(stats.bigSaves, [0, 0, 0, 1, 0, 0], 'bigSaves reflects recorded non-own saves even in clipped/Pulse turns');
  assert.equal(stats.events.filter(e => e.type === 'Save').length, 1);
});

const GOLDEN_V29_REPLAY_B64 = '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';
test('authentic pre-existing v29 .ububall binary archive plays back bit-for-bit identically', async () => {
  const bytes = Uint8Array.from(Buffer.from(GOLDEN_V29_REPLAY_B64, 'base64'));
  const parsed = await R.read(bytes);
  assert.equal(parsed.turns.length, 3);
  const ends = parsed.turns.map(replayTurn);
  const print = createHash('sha256').update(JSON.stringify(ends)).digest('hex').slice(0, 16);
  assert.equal(print, 'd2a45c7dd9b4ee43');
});
