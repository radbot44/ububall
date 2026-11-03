'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Browser-only effects live inside the game closure. Exercise their real source
// with a small canvas stub instead of introducing a production-facing test API.
const source = fs.readFileSync(require.resolve('../web/ububall.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'effect source boundary changed');
  return source.slice(a, b);
}

test('trail gradient retains a hot sample between cool endpoints', () => {
  const gradients = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    arc() {}, closePath() {}, fill() {},
    createLinearGradient() {
      const gradient = { stops: [], addColorStop(position, color) { this.stops.push({ position, color }); } };
      gradients.push(gradient);
      return gradient;
    }
  };
  const bodies = Array.from({ length: 6 }, () => ({ team: 0, x: 0, y: 0 }));
  bodies.push({ team: -1, x: 250, y: 300, vx: 250, vy: 0, radius: 18 });
  const trails = Array.from({ length: 7 }, () => []);
  trails[6] = [100, 150, 200].map((x, i) =>
    ({ x, y: 300, life: .2, duration: .24, heat: i === 1 ? 3 : 0 }));
  vm.runInNewContext(section('function drawTrails(home, away) {', 'function drawStickyTether(') +
    '\ndrawTrails("#fff", "#000");', {
      ctx, bodies, trails, ballHeat: () => 0,
      heatColor: (heat, alpha) => heat + ':' + alpha,
      hexToRgba: (color, alpha) => color + ':' + alpha
    });
  assert.equal(gradients.length, 1);
  assert.ok(gradients[0].stops.some(stop => stop.color.startsWith('3:')), 'intermediate heat was discarded');
});

test('ordinary particles keep their filled endpoint', () => {
  const radii = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    arc(x, y, radius) { radii.push(radius); }, fill() {}
  };
  vm.runInNewContext(section('function drawParticles(home, away, overlay = false) {', 'function kickoff(') +
    '\ndrawParticles("#fff", "#000");', {
      ctx, badgeCtx: ctx,
      particles: [{ x: 20, y: 40, px: 20, py: 40, life: 1, duration: 1, team: 0 }]
    });
  assert.deepEqual(radii, [.9]);
});

test('aura sprites reuse rounded radii and evict stale entries', () => {
  const document = { createElement() {
    const c = {
      scale() {}, createConicGradient() { return { addColorStop() {} }; },
      beginPath() {}, arc() {}, stroke() {}
    };
    return { getContext() { return c; } };
  } };
  const result = vm.runInNewContext(
    section('const conicRingSprites = new Map();', '// Super aura: ready') +
    '\nconst first = conicRingSprite("stalwart", 24.1, 3);' +
    '\nconst same = conicRingSprite("stalwart", 24.4, 3);' +
    '\nfor (let r = 1; r <= 100; r++) conicRingSprite("stalwart", r, 3);' +
    '\n({ same: first === same, size: conicRingSprites.size });',
    { document, SUPER_AURA_THEMES: {}, hexToRgba: () => 'rgba(0,0,0,1)' });
  assert.equal(result.same, true);
  assert.ok(result.size <= 48);
});

test('straight vertical shots skip threat simulation, but curved shots do not', () => {
  let steps = 0;
  const ball = { x: 500, y: 300, vx: 0, vy: 600, omega: 0, curveFactor: .045 };
  const bodies = Array.from({ length: 6 }, () => ({})).concat(ball);
  const P = { holder: () => false, DT: 1 / 240, step() { steps++; return null; } };
  const code = section('function goalThreat() {', '// Net ripples and board flex');
  vm.runInNewContext(code + '\ngoalThreat();', { P, bodies });
  assert.equal(steps, 0);
  ball.omega = 24;
  vm.runInNewContext(code + '\ngoalThreat();', { P, bodies });
  assert.ok(steps > 0, 'curved ball was incorrectly rejected');
});

function trailHarness() {
  const gradients = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    arc() {}, closePath() {}, fill() {},
    createLinearGradient(x0, y0, x1, y1) {
      gradients.push({ x0, y0, x1, y1 });
      return { addColorStop() {} };
    }
  };
  const bodies = Array.from({ length: 7 }, (_, i) =>
    ({ team: i === 6 ? -1 : 0, x: 500, y: 300, vx: 0, vy: 0, radius: 18 }));
  const trails = Array.from({ length: 7 }, () => []);
  const api = vm.runInNewContext(
    section('const trailPositions = () =>', 'function drawStickyTether(') +
    '\n({ trailPositions, clearDiscontinuousTrails, recordTrails, drawTrails });',
    { bodies, trails, ctx, reducedMotion: { matches: false },
      ballHeat: () => 0, heatColor: () => '#fff', hexToRgba: () => '#fff' });
  return { ...api, bodies, trails, gradients };
}
const trailPoint = (x, y) => ({ x, y, life: .24, duration: .24, heat: 0 });

test('yellow-card repositioning immediately removes the old player trail', () => {
  const h = trailHarness();
  h.trails[0].push(trailPoint(760, 200), trailPoint(770, 200));
  Object.assign(h.bodies[0], { x: 770, y: 200 });
  const before = h.trailPositions();
  Object.assign(h.bodies[0], { x: 180, y: 300, vx: 0 });
  h.clearDiscontinuousTrails(before);
  assert.equal(h.trails[0].length, 0, 'the old trail must be erased immediately');
  h.drawTrails('#fff', '#000');
  assert.equal(h.gradients.length, 0, 'no ribbon should remain after the teleport');

  Object.assign(h.bodies[0], { x: 190, vx: 600 });
  h.recordTrails();
  h.bodies[0].x = 200;
  h.recordTrails();
  h.drawTrails('#fff', '#000');
  assert.equal(h.trails[0].length, 2, 'new physical movement starts a fresh trail');
  assert.equal(h.gradients.length, 1, 'only the new movement is rendered');
  assert.equal(h.trails[0][0].x, 190);
});

test('corner faceoff removes only the reset ball trail, not teammate trails', () => {
  const h = trailHarness();
  h.trails[6].push(trailPoint(840, 280), trailPoint(880, 280));
  h.trails[0].push(trailPoint(300, 300), trailPoint(320, 300));
  Object.assign(h.bodies[6], { x: 880, y: 280 });
  Object.assign(h.bodies[0], { x: 320, y: 300 });
  const before = h.trailPositions();
  Object.assign(h.bodies[6], { x: 500, y: 300 });
  h.clearDiscontinuousTrails(before);
  assert.equal(h.trails[6].length, 0, 'reset ball has no trail');
  assert.equal(h.trails[0].length, 2, 'unmoved teammate keeps its trail');
  h.drawTrails('#fff', '#000');
  assert.equal(h.gradients.length, 1, 'only the teammate trail remains visible');
});

test('discrete snapshots without repositioning do not erase trails', () => {
  const h = trailHarness();
  h.trails[0].push(trailPoint(100, 300), trailPoint(120, 300));
  Object.assign(h.bodies[0], { x: 120, y: 300, vx: 250 });
  const before = h.trailPositions();
  h.clearDiscontinuousTrails(before);
  assert.equal(h.trails[0].length, 2);
});

test('legitimate high-speed physical movement remains continuous', () => {
  const h = trailHarness();
  h.trails[0].push(trailPoint(100, 300));
  Object.assign(h.bodies[0], { x: 800, y: 300, vx: 700 });
  h.recordTrails();
  h.drawTrails('#fff', '#000');
  assert.equal(h.trails[0].length, 2);
  assert.ok(h.gradients.some(g => Math.abs(g.x1 - g.x0) > 600));
});

test('local, online, and saved replay state boundaries clear repositioned trails', () => {
  for (const [start, end] of [
    ['function finishTurn(goal) {', "$('launch').onclick"],
    ['function nextReplaySegment() {', 'function startGoalReplay()'],
    ['function endReplayTurn() {', 'const WIN_SECONDS'],
    ['function playOnlineReplay() {', '// Each side\'s Discord'],
    ['const before = !fresh && !s.replay && !goalReplay', 'if (!s.replay) fouls =']
  ]) {
    assert.match(section(start, end), /clearDiscontinuousTrails\(before\)/);
  }
});

test('drawBallFace applies team colors to the ball face', () => {
  const strokes = [];
  const ctx = {
    save() {}, restore() {}, scale() {}, beginPath() {}, arc() {}, moveTo() {}, lineTo() {},
    stroke() { strokes.push(this.strokeStyle); },
    set strokeStyle(val) { this._strokeStyle = val; },
    get strokeStyle() { return this._strokeStyle; }
  };
  const code = section('function drawBallFace(size, eyeColor, mouthColor) {', 'function draw() {');
  vm.runInNewContext(code + '\ndrawBallFace(30.6, "#E8CA48", "#AA54D3");', { ctx });
  assert.deepEqual(strokes, ['#E8CA48', '#E8CA48', '#AA54D3']);
});

test('prediction ignition indicator fills with team color', () => {
  const fills = [], strokes = [];
  const ctx = {
    save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, arc() {}, rect() {}, clip() {},
    fill() { fills.push(this.fillStyle); },
    stroke() { strokes.push(this.strokeStyle); },
    set fillStyle(val) { this._fillStyle = val; }, get fillStyle() { return this._fillStyle; },
    set strokeStyle(val) { this._strokeStyle = val; }, get strokeStyle() { return this._strokeStyle; }
  };
  const prediction = { paths: [], impacts: [], stops: [], horizon: 240, ignition: { x: 450, y: 300, tick: 60, team: 1 } };
  const bodies = [{ team: 0 }, { team: 0 }, { team: 0 }, { team: 1 }, { team: 1 }, { team: 1 }, { team: -1 }];
  const IGNITION_FLAME = {};
  const code = section('function paintPrediction(prediction, home, away) {', 'const IGNITION_FLAME =');
  vm.runInNewContext(code + '\npaintPrediction(prediction, "#E8CA48", "#AA54D3");', {
    ctx, bodies, prediction, isPortrait: false, pulseMode: () => false, ububallMatch: { turnTicks: () => 240 },
    line() {}, impactStamp: () => ({}), IGNITION_FLAME, rounded() {}, P: { rink: { goalDepth: 38 } }
  });
  assert.equal(fills[0], '#AA54D3', 'away team color is used for team 1 ignition');
  assert.equal(strokes[0], '#ffffff', 'white outline is used for ignition flame');
});

test('creditSave generates Trap! callout for friendly iron saves and Big save! for opposing', () => {
  const popups = [];
  const popup = (body, text) => popups.push({ text, own: body.team });
  const code = section('function creditSave(body, own, iron = false) {', 'function contactMeter(');
  const context = {
    popup, steamRing() {}, gameAudio: () => ({ playIronSave() {} }),
    online: null, goalReplay: null, theater: null,
    ububallMatch: { gainMeter: () => [], METER: { save: 6 } },
    classicMode: () => true, dirtyMeters: new Set(), P: {}, bodies: [], stats: {}
  };
  vm.runInNewContext(code + '\ncreditSave({ team: 0, x: 0, y: 0, radius: 10 }, true, true);\ncreditSave({ team: 1, x: 0, y: 0, radius: 10 }, false, true);\ncreditSave({ team: 0, x: 0, y: 0, radius: 10 }, false, false);', context);
  assert.equal(popups[0].text, 'Trap!');
  assert.equal(popups[1].text, 'Big save!');
  assert.equal(popups[2].text, 'Save!');
});

test('updatePopups ages popups independently and prunes expired ones', () => {
  const popups = [
    { text: 'Trap!', life: 0.5 },
    { text: 'Spin strike!', life: 0.1 }
  ];
  const code = section('function updatePopups(dt) {', 'function drawPopups(home, away) {');
  vm.runInNewContext(code + '\nupdatePopups(0.2);', { popups, reducedMotion: { matches: false } });
  assert.equal(popups.length, 1);
  assert.equal(popups[0].text, 'Trap!');
  assert.ok(Math.abs(popups[0].life - 0.3) < 1e-6);
});

test('iron guard shield receives #6b7785 border stroke with lineWidth 1.5', () => {
  let strokeStyle = null, lineWidth = null, strokePath = null, fillStyle = null;
  const GUARD_SHIELD = Symbol('GUARD_SHIELD');
  const badgeCtx = {
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    fill(p) { fillStyle = this.fillStyle; },
    stroke(p) { strokeStyle = this.strokeStyle; lineWidth = this.lineWidth; strokePath = p; },
    set fillStyle(val) { this._fillStyle = val; }, get fillStyle() { return this._fillStyle; },
    set strokeStyle(val) { this._strokeStyle = val; }, get strokeStyle() { return this._strokeStyle; },
    set lineWidth(val) { this._lineWidth = val; }, get lineWidth() { return this._lineWidth; }
  };
  const b = { guarding: true, radius: 25, x: 100, y: 100 };
  const phase = 'plan', i = 0, plans = [{ guard: true }], isPortrait = false;
  const predictionCache = { data: { guards: [{ index: 0, held: true }] } };
  const code = section('const inAction = phase === \'play\' || phase === \'replay\' || Boolean(goalReplay);', 'const slow = P.dazeSlow(b);');
  vm.runInNewContext(code, { badgeCtx, b, phase, i, plans, isPortrait, predictionCache, GUARD_SHIELD, goalReplay: null });
  assert.equal(fillStyle, '#c3ccd6', 'iron fill is metallic grey');
  assert.equal(strokeStyle, '#6b7785', 'border stroke is darker grey');
  assert.equal(lineWidth, 1.5, 'border lineWidth is 1.5');
  assert.equal(strokePath, GUARD_SHIELD);
});

test('theater.exporting suppresses popup and effect aging in animation frame loop', () => {
  let popupsUpdated = 0, effectsUpdated = 0, replayAdvanced = 0;
  const updatePopups = () => { popupsUpdated++; };
  const updateEffects = () => { effectsUpdated++; };
  const advanceReplay = () => { replayAdvanced++; };
  const pulseMode = () => false, clockNow = () => 1000, hitStopUntil = 0;
  const delta = 0.016;
  const active = true, roundTurns = 0, phase = 'replay';
  const code = section("const pulseFrozen = pulseMode() && roundTurns > 0 && (phase === 'plan' || phase === 'cpu-wait' || phase === 'waiting');", "else if ((phase === 'play' || postGoal) && active && !online?.active) {");

  // 1. During video export: theater.exporting is true. Animation loop must NOT age popups or effects.
  let theater = { paused: false, exporting: true, speed: 1 };
  vm.runInNewContext(code, {
    pulseMode, roundTurns, phase, active, clockNow, hitStopUntil, theater,
    delta, updatePopups, updateEffects, advanceReplay, ububallMatch: {}, goalReplay: null, postGoal: null
  });
  assert.equal(popupsUpdated, 0, 'popups must not update during RAF while exporting');
  assert.equal(effectsUpdated, 0, 'effects must not update during RAF while exporting');
  assert.equal(replayAdvanced, 0, 'replay must not advance during RAF while exporting');

  // 2. Normal replay playback: theater.exporting is false. Animation loop updates popups and effects.
  theater = { paused: false, exporting: false, speed: 1 };
  vm.runInNewContext(code, {
    pulseMode, roundTurns, phase, active, clockNow, hitStopUntil, theater,
    delta, updatePopups, updateEffects, advanceReplay, ububallMatch: {}, goalReplay: null, postGoal: null
  });
  assert.equal(popupsUpdated, 1, 'popups update during normal replay playback');
  assert.equal(effectsUpdated, 1, 'effects update during normal replay playback');
  assert.equal(replayAdvanced, 1, 'replay advances during normal replay playback');

  // 3. Normal gameplay: theater is null. Animation loop updates popups and effects.
  theater = null;
  vm.runInNewContext(code, {
    pulseMode, roundTurns, phase: 'play', active, clockNow, hitStopUntil, theater,
    delta, updatePopups, updateEffects, advanceReplay, ububallMatch: {}, goalReplay: null, postGoal: null
  });
  assert.equal(popupsUpdated, 2, 'popups update during gameplay');
  assert.equal(effectsUpdated, 2, 'effects update during gameplay');
});

test('exported video timing advances popups strictly once per export frame', () => {
  const popups = [{ text: 'Big save!', life: 1.0, duration: 1.2 }];
  const code = section('function updatePopups(dt) {', 'function drawPopups(home, away) {');
  const fps = 60;
  const dt = 1 / fps;
  for (let f = 1; f <= 30; f++) {
    vm.runInNewContext(code + '\nupdatePopups(dt);', { popups, reducedMotion: { matches: false }, dt });
  }
  assert.equal(popups.length, 1);
  assert.ok(Math.abs(popups[0].life - (1.0 - 30 * dt)) < 1e-6, 'popups advance deterministically by export-frame delta');
});

test('video export isolates playback session from interactive theater object', () => {
  const code = section('let activePlayback = null;', 'const replayFx = {');
  const theater = { replay: { title: 'match' }, starts: [0], total: 100, index: 0, tick: 10, sim: [{ x: 100 }] };
  const context = {
    theater, goalReplay: null, onlineReplay: null,
    toViewBody: cb => cb,
    syncViewBodies: () => {}
  };
  const env = vm.runInNewContext(code + '\n;({ setPlayback: p => { activePlayback = p; }, currentReplay, shownSim });', context);
  assert.equal(env.currentReplay(), theater, 'interactive theater is active by default');

  const session = { replay: { title: 'slice' }, sim: [{ x: 500 }] };
  env.setPlayback(session);
  assert.equal(env.currentReplay(), session, 'export session routes replay simulation');
  assert.equal(env.shownSim(), session.sim, 'shownSim reads export session simulation');
  assert.equal(theater.replay.title, 'match', 'interactive theater replay object is preserved untouched');
});

test('restoreEntry restores Stalwart ID 0 and mastery metadata, preserving null for unsaved', () => {
  const code = section('function restoreEntry(saved) {', 'function clearActiveMatch() {') +
    '\n' + section('function resolveEquippedSuper(entry, slotIndex = 0) {', 'const POSITIONS = [');
  const P = require('../web/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const practice = [{ model: ubu.decode(ubu.fromCode(ubu.toCode(ubu.randomDNA()))), dna: 'dummy', label: 'Practice' }];
  const env = vm.runInNewContext(code + '\n;({ restoreEntry, resolveEquippedSuper });', {
    P, ubu, practice
  });

  const sampleDna = ubu.toCode(ubu.randomDNA());
  // 1. Stalwart (id: 0) restored with full mastery object
  const restoredStalwart = env.restoreEntry({
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
  const restoredNull = env.restoreEntry({
    dna: sampleDna,
    label: 'Ubu 2',
    equippedSuper: null
  });
  assert.ok(restoredNull);
  assert.equal(restoredNull.equippedSuper, null);

  // 3. Practice ubu with Stalwart
  const practiceDna = practice[0].dna;
  const restoredPractice = env.restoreEntry({
    key: 'practice-0',
    dna: practiceDna,
    equippedSuper: { id: 0 }
  });
  assert.ok(restoredPractice);
  assert.ok(restoredPractice.equippedSuper);
  assert.equal(restoredPractice.equippedSuper.id, 0);
  assert.equal(restoredPractice.equippedSuper.key, 'stalwart');
});

test('active match save and restore enforces matching matchVersion and physicsVersion', () => {
  const code = section('function clearActiveMatch() {', 'function newMatch(playJingle = false) {');
  const P = require('../web/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');
  let store = {};
  const localStorage = {
    getItem(k) { return store[k] || null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
  const dummy = () => {};
  const env = vm.runInNewContext(code + '\n;({ saveActiveMatch, restoreActiveMatch, clearActiveMatch });', {
    P, ububallMatch, ububallReplay, localStorage, structuredClone,
    demo: false, online: null, phase: 'plan', recording: { turns: [] },
    matchMode: 'standard', cpuLevel: 'medium', scores: [0, 0], turn: 1,
    fouls: { crease: [false, false], corner: null, cornerTurns: 0, cards: [] },
    tally: {}, roster: [{ dna: 'a', label: 'a' }], teamEntries: [{ dna: 'a', label: 'a' }],
    bodies: P.kickoff(), plans: [], cpu: [], cpuDone: false,
    endGoalReplay: dummy, showMode: dummy, classicMode: () => false,
    stopFanfare: dummy, gameAudio: () => null, buildTeam: dummy,
    normalStats: () => ({}), idlePlan: () => ({ angle: 0, power: 0, spin: 0 }),
    document: { body: { classList: { toggle: dummy } }, querySelector: () => null },
    restoreEntry: e => e, dirtyMeters: new Set(), startPlanClock: dummy, prepareCPU: dummy,
    sync: dummy, draw: dummy, say: dummy
  });

  // Save active match: verify physics is written
  env.saveActiveMatch();
  assert.ok(store['ububall-active-match']);
  const parsed = JSON.parse(store['ububall-active-match']);
  assert.equal(parsed.version, ububallMatch.VERSION);
  assert.equal(parsed.physics, P.VERSION);

  // Restore with matching versions succeeds
  const ok = env.restoreActiveMatch();
  assert.equal(ok, true);

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
});

test('contactMeter and creditSave reject meter awards outside phase === play', () => {
  const code = section('function creditSave(body, own, iron = false) {', 'function setMeterFill(fill, meter) {');
  const P = require('../web/ububall-physics.js');
  let calledGain = 0, calledContact = 0;
  const ububallMatch = {
    METER: { save: 6 },
    gainMeter() { calledGain++; return []; },
    contactMeter() { calledContact++; return []; }
  };
  const dirtyMeters = new Set();
  const env = vm.runInNewContext(code + '\n;({ creditSave, contactMeter, setPhase: p => { phase = p; } });', {
    phase: 'goal', online: null, goalReplay: null, theater: null,
    bodies: [], stats: [], classicMode: () => false, matchTicks: 0, elapsed: 0,
    P, ububallMatch, dirtyMeters, popup: () => {}, steamRing: () => {}, gameAudio: () => null
  });

  // 1. Outside play phase (e.g. 'goal', 'over', 'plan'), no meter calls occur
  env.contactMeter({}, {}, 100);
  assert.equal(calledContact, 0, 'contact meter rejected during post-goal / non-play phase');

  env.creditSave({}, false);
  assert.equal(calledGain, 0, 'save meter rejected during post-goal / non-play phase');

  // 2. In active play phase, meter functions proceed
  env.setPhase('play');
  env.contactMeter({}, {}, 100);
  assert.equal(calledContact, 1, 'contact meter allowed during active play');

  env.creditSave({}, false);
  assert.equal(calledGain, 1, 'save meter allowed during active play');
});

test('post-goal celebration simulation cannot alter the next kickoffs meter or gameplay state', () => {
  const code = section('function kickoff(isNewMatch = false) {', 'function creditSave(') +
    '\n' + section('function finishTurn(goal) {', '$(\'launch\').onclick =');
  const P = require('../web/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ubu = require('../shared/ubu.js');
  const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };
  const practice = Array.from({ length: 6 }, () => {
    const dna = ubu.randomDNA();
    return { model: ubu.decode(dna), dna: ubu.toCode(dna), label: 'Practice ubu' };
  });

  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach((b, i) => P.applyStats(b, normal));
  bodies[0].meter = 50;
  bodies[1].meter = 30;
  bodies[3].meter = 20;

  const dummy = () => {};
  const context = {
    P, ububallMatch, structuredClone,
    clearEffects: dummy, kickoffGlow: 0, netFire: null, stats: Array.from({ length: 6 }, () => normal),
    matchMode: 'standard', teamEntries: practice, practice, classicMode: () => false,
    resolveEquippedSuper: () => null,
    playSegments: [], elapsed: 10, roundTurns: 1, play: ububallMatch.newPlay(),
    tally: ububallMatch.newTally(), ballOnFire: () => false, lightNet: dummy, quench: dummy,
    trailPositions: () => [], clearDiscontinuousTrails: dummy, fouls: ububallMatch.newFouls(),
    noteTurn: dummy, announceFouls: dummy, matchTicks: 0, dirtyMeters: new Set(),
    celebrate: dummy, popup: dummy, queueSummary: dummy, recording: null, clearActiveMatch: dummy,
    goalTab: dummy, say: dummy, loopFanfare: dummy, sync: dummy, draw: dummy, callText: () => '',
    $: () => ({ disabled: false, textContent: '', onclick: null }),
    scores: [0, 0], bodies, authoritativeBodies: null, phase: 'play', performance
  };

  const env = vm.runInNewContext(code + '\n;({ finishTurn, kickoff, getAuthoritative: () => authoritativeBodies, getBodies: () => bodies, setBodies: b => { bodies = b; } });', context);

  // 1. Goal scored: finishTurn runs
  env.finishTurn(0);

  // Authoritative bodies were preserved immediately after finishTurn
  const auth = env.getAuthoritative();
  assert.ok(auth, 'authoritativeBodies snapshot was preserved');
  assert.equal(auth[0].meter, 50);

  // 2. Post-goal celebration simulation occurs on live bodies:
  // Skaters collide, mutates bodies, runs stepPostGoal, etc.
  const liveBodies = env.getBodies();
  liveBodies[0].meter = 99; // Corrupted / altered during post-goal celebration
  liveBodies[1].meter = 88;
  liveBodies[0].stunned = true;

  // 3. Next kickoff is triggered
  const nextKickoffBodies = env.kickoff();

  // The next kickoff inherits ONLY the authoritative meter, completely ignoring post-goal mutations!
  assert.equal(nextKickoffBodies[0].meter, 50, 'kickoff meter matches authoritative finishTurn state');
  assert.equal(nextKickoffBodies[1].meter, 30, 'kickoff meter was not corrupted by celebration mutations');
  assert.equal(nextKickoffBodies[0].stunned, false, 'kickoff stunned state matches authoritative state');
  assert.equal(env.getAuthoritative(), null, 'authoritativeBodies cleared after consumption');
});
