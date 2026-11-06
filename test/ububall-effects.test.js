'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createEffectsState, updateParticles } = require('../web/ububall-presentation.js');

// Browser-only effects live inside the game closure. Exercise their real source
// with a small canvas stub instead of introducing a production-facing test API.
const source = fs.readFileSync(require.resolve('../web/ububall.js'), 'utf8');
function runInNewContext(code, context) {
  // Existing fixtures expose individual live effect values for assertions.
  const fixtureState = (aliases = {}) => new Proxy({}, {
    get: (_, key) => context[aliases[key] ?? key],
    set: (_, key, value) => { context[aliases[key] ?? key] = value; return true; }
  });
  context.fieldEffects = fixtureState();
  Object.assign(context, { createEffectsState, updateParticles });
  context.fieldView = fixtureState({ mode: 'matchMode', entries: 'teamEntries', anonymous: 'anonymousNames',
    portrait: 'isPortrait', field: 'videoField' });
  return vm.runInNewContext(code, context);
}
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
  runInNewContext(section('function drawTrails(ctx, trails, bodies, home, away) {', 'function drawStickyTether(') +
    '\ndrawTrails(ctx, trails, bodies, "#fff", "#000");', {
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
  runInNewContext(section('function drawParticles(home, away, overlay = false) {', 'function kickoff(') +
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
  const result = runInNewContext(
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
  const ball = { x: 500, y: 300, vx: 0, vy: 600, omega: 0 };
  const bodies = Array.from({ length: 6 }, () => ({})).concat(ball);
  const P = { ...require('../web/ububall-physics.js'), step() { steps++; return null; } };
  const code = section('function goalThreat() {', '// Net ripples and board flex');
  runInNewContext(code + '\ngoalThreat();', { P, bodies });
  assert.equal(steps, 0);
  ball.omega = 24;
  runInNewContext(code + '\ngoalThreat();', { P, bodies });
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
  const api = runInNewContext(
    section('const trailPositions = () =>', 'function drawStickyTether(') +
    '\n({ trailPositions, clearDiscontinuousTrails, recordTrails, drawTrails });',
    { bodies, trails, ctx, reducedMotion: { matches: false },
      ballHeat: () => 0, heatColor: () => '#fff', hexToRgba: () => '#fff' });
  return { ...api, bodies, trails, gradients, drawTrails: (home, away) => api.drawTrails(ctx, trails, bodies, home, away) };
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
  const code = section('function drawBallFace(size, eyeColor, mouthColor) {', 'function draw(exportSession = null) {');
  runInNewContext(code + '\ndrawBallFace(30.6, "#E8CA48", "#AA54D3");', { ctx });
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
  runInNewContext(code + '\npaintPrediction(prediction, "#E8CA48", "#AA54D3");', {
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
    classicMode: () => true, dirtyMeters: new Set(), P: {}, bodies: [], simBodies: [], stats: {}
  };
  runInNewContext(code + '\ncreditSave({ team: 0, x: 0, y: 0, radius: 10 }, true, true);\ncreditSave({ team: 1, x: 0, y: 0, radius: 10 }, false, true);\ncreditSave({ team: 0, x: 0, y: 0, radius: 10 }, false, false);', context);
  assert.equal(popups[0].text, 'Trap!');
  assert.equal(popups[1].text, 'Big save!');
  assert.equal(popups[2].text, 'Save!');
});

test('updatePopups ages popups independently and prunes expired ones', () => {
  const popups = [
    { text: 'Trap!', life: 0.5 },
    { text: 'Spin strike!', life: 0.1 }
  ];
  const code = section('function updatePopups(dt, popups) {', 'function drawPopups(badgeCtx, popups, isPortrait, width, home, away) {');
  runInNewContext(code + '\nupdatePopups(0.2, popups);', { popups, reducedMotion: { matches: false } });
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
  const phase = 'plan', i = 0, fieldPlans = [{ guard: true }], isPortrait = false;
  const predictionCache = { data: { guards: [{ index: 0, held: true }] } };
  const code = section('const inAction = phase === \'play\' || phase === \'replay\' || Boolean(goalReplay);', 'const slow = P.dazeSlow(b);');
  runInNewContext(code, { badgeCtx, b, phase, i, fieldPlans, isPortrait, predictionCache, GUARD_SHIELD, goalReplay: null });
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
  runInNewContext(code, {
    pulseMode, roundTurns, phase, active, clockNow, hitStopUntil, theater,
    delta, popups: [], updatePopups, updateEffects, advanceReplay, ububallMatch: {}, goalReplay: null, postGoal: null
  });
  assert.equal(popupsUpdated, 0, 'popups must not update during RAF while exporting');
  assert.equal(effectsUpdated, 0, 'effects must not update during RAF while exporting');
  assert.equal(replayAdvanced, 0, 'replay must not advance during RAF while exporting');

  // 2. Normal replay playback: theater.exporting is false. Animation loop updates popups and effects.
  theater = { paused: false, exporting: false, speed: 1 };
  runInNewContext(code, {
    pulseMode, roundTurns, phase, active, clockNow, hitStopUntil, theater,
    delta, popups: [], updatePopups, updateEffects, advanceReplay, ububallMatch: {}, goalReplay: null, postGoal: null
  });
  assert.equal(popupsUpdated, 1, 'popups update during normal replay playback');
  assert.equal(effectsUpdated, 1, 'effects update during normal replay playback');
  assert.equal(replayAdvanced, 1, 'replay advances during normal replay playback');

  // 3. Normal gameplay: theater is null. Animation loop updates popups and effects.
  theater = null;
  runInNewContext(code, {
    pulseMode, roundTurns, phase: 'play', active, clockNow, hitStopUntil, theater,
    delta, popups: [], updatePopups, updateEffects, advanceReplay, ububallMatch: {}, goalReplay: null, postGoal: null
  });
  assert.equal(popupsUpdated, 2, 'popups update during gameplay');
  assert.equal(effectsUpdated, 2, 'effects update during gameplay');
});

test('exported video timing advances popups strictly once per export frame', () => {
  const popups = [{ text: 'Big save!', life: 1.0, duration: 1.2 }];
  const code = section('function updatePopups(dt, popups) {', 'function drawPopups(badgeCtx, popups, isPortrait, width, home, away) {');
  const fps = 60;
  const dt = 1 / fps;
  for (let f = 1; f <= 30; f++) {
    runInNewContext(code + '\nupdatePopups(dt, popups);', { popups, reducedMotion: { matches: false }, dt });
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
  const env = runInNewContext(code + '\n;({ setPlayback: p => { activePlayback = p; }, currentReplay, shownSim });', context);
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
  const env = runInNewContext(code + '\n;({ restoreEntry, resolveEquippedSuper });', {
    P, ubu
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
  const practiceDna = sampleDna;
  const restoredPractice = env.restoreEntry({
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
  const code = section('function startPlanClock() {', 'function updateClock() {');
  let now = 100;
  let gameDialog = false;
  const dialog = { open: false };
  const context = {
    performance: { now: () => now }, document: { hidden: false, querySelector: () => gameDialog ? {} : null },
    $: id => id === 'pause-menu' ? dialog : { open: false },
    foulInfo: null, online: null, inMatch: true, demo: false, phase: 'plan', matchMode: 'blitz', blitzMode: () => true,
    ububallMatch: { planningMilliseconds: () => 5000 }, planDeadline: 0, planPausedAt: null
  };
  const { startPlanClock, refresh } = runInNewContext(code +
    '\n;({ startPlanClock, refresh: () => updateLocalPlanClock(localPlayBlocked()) });', context);
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
  now = 15600; context.inMatch = false; refresh();
  now = 19600; context.inMatch = true; refresh();
  assert.equal(context.planDeadline - now, 1500, 'returning home pauses the CPU planning clock');
  context.online = { active: true };
  dialog.open = true; refresh();
  assert.equal(context.planPausedAt, null);
});

test('active match save and restore enforces matching matchVersion and physicsVersion', () => {
  assert.ok(
    source.indexOf('const PRESENTATION_KEYS =') < source.indexOf('restoredMatch = restoreActiveMatch();') &&
    source.indexOf('const viewIndex =') < source.indexOf('restoredMatch = restoreActiveMatch();'),
    'projection constants and viewIndex must initialize before startup match restore/newMatch'
  );
  const code =
    section('function kickoff(isNewMatch = false) {', 'let activeStatsContext') + '\n' +
    section('function clearActiveMatch() {', 'function rounded(x, y, width, height, radius) {') + '\n' +
    section('const PRESENTATION_KEYS =', 'function playOnlineReplay() {');
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
  const env = runInNewContext(code + '\n;({ saveActiveMatch, restoreActiveMatch, clearActiveMatch, newMatch });', {
    Object, Array, Set, Math, Number, String, Boolean,
    P, ububallMatch, ububallReplay, localStorage, structuredClone,
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
  });
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
  const env = runInNewContext(code + '\n;({ creditSave, contactMeter, setPhase: p => { phase = p; } });', {
    phase: 'goal', online: null, goalReplay: null, theater: null,
    bodies: [], simBodies: [], stats: [], classicMode: () => false, matchTicks: 0, elapsed: 0,
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
  const code = section('function kickoff(isNewMatch = false) {', 'let activeStatsContext') +
    '\n' + section('function finishTurn(goal) {', '$(\'launch\').onclick =') +
    '\n' + section('const PRESENTATION_KEYS =', 'function playOnlineReplay() {');
  const P = require('../web/ububall-physics.js');
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
    Object, Array, Set,
    P, ububallMatch, structuredClone,
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

  const env = runInNewContext(code + '\n;({ finishTurn, kickoff, getAuthoritative: () => authoritativeBodies, getBodies: () => bodies, getPostGoal: () => postGoal });', context);

  // 1. Goal scored: finishTurn runs
  env.finishTurn(0);

  // Authoritative bodies were preserved immediately after finishTurn
  const auth = env.getAuthoritative();
  assert.ok(auth, 'authoritativeBodies snapshot was preserved');
  assert.equal(auth[0].meter, 50);

  // 2. Post-goal celebration simulation occurs on live display bodies and postGoal.sim:
  // Skaters collide, mutates bodies / postGoal.sim, runs stepPostGoal, etc.
  const liveBodies = env.getBodies();
  liveBodies[0].meter = 99; // Corrupted / altered during post-goal celebration
  liveBodies[1].meter = 88;
  liveBodies[0].stunned = true;
  env.getPostGoal().sim[0].meter = 99;
  env.getPostGoal().sim[1].meter = 88;
  env.getPostGoal().sim[0].stunned = true;

  // 3. Next kickoff is triggered
  const nextKickoffBodies = env.kickoff();

  // The next kickoff inherits ONLY the authoritative meter, completely ignoring post-goal mutations!
  assert.equal(nextKickoffBodies[0].meter, 50, 'kickoff meter matches authoritative finishTurn state');
  assert.equal(nextKickoffBodies[1].meter, 30, 'kickoff meter was not corrupted by celebration mutations');
  assert.equal(nextKickoffBodies[0].stunned, false, 'kickoff stunned state matches authoritative state');
  assert.equal(env.getAuthoritative(), null, 'authoritativeBodies cleared after consumption');
});

test('predictionKey invalidates on micro angle/power adjustments, fouls, and carded changes', () => {
  const P = require('../web/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const code = section('let predictionCache = null', 'const predictionLayer = {};');
  const bodies = P.kickoff();
  const plans = [
    { angle: 1.234567, power: 0.876543, spin: 0, guard: false },
    { angle: 0, power: 0, spin: 0, guard: false },
    { angle: 0, power: 0, spin: 0, guard: false }
  ];
  let turn = 1;
  const matchMode = 'standard';
  const fouls = ububallMatch.newFouls();

  const context = { bodies, plans, turn, matchMode, fouls };
  const env = runInNewContext(code + '\n;({ predictionKey, dirtyPrediction });', context);

  const initialKey = env.predictionKey();

  // 1. Micro angle change (< 0.0001, which toFixed(4) would have missed)
  plans[0].angle += 0.00001;
  const microAngleKey = env.predictionKey();
  assert.notEqual(microAngleKey, initialKey, 'micro angle change invalidates key');
  plans[0].angle -= 0.00001;

  // 2. Micro power change (< 0.0001)
  plans[0].power += 0.00001;
  const microPowerKey = env.predictionKey();
  assert.notEqual(microPowerKey, initialKey, 'micro power change invalidates key');
  plans[0].power -= 0.00001;

  // 3. Crease foul change
  fouls.crease[0] = true;
  const foulKey = env.predictionKey();
  assert.notEqual(foulKey, initialKey, 'crease foul change invalidates key');
  fouls.crease[0] = false;

  // 4. Skater carded change
  bodies[0].carded = true;
  const cardKey = env.predictionKey();
  assert.notEqual(cardKey, initialKey, 'carded change invalidates key');
  bodies[0].carded = false;

  // 5. dirtyPrediction()
  env.dirtyPrediction();
  const dirtyKey = env.predictionKey();
  assert.notEqual(dirtyKey, initialKey, 'dirtyPrediction increments key revision');
});

test('display projection boundary: seat transforms, gameplay fields, presentation separation, and stable identities', () => {
  const P = require('../web/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const projCode = section('const PRESENTATION_KEYS =', 'function playOnlineReplay() {');

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
    Object, Array, Set,
    P, ububallMatch, structuredClone, teamEntries,
    bodies: initialDisplay, dirtyMeters,
    classicMode: () => false,
    resolveEquippedSuper: (entry, i) => entry?.equippedSuper || P.SUPERS[i % P.SUPERS.length],
    anonymousName: i => `${i < 3 ? 'Saffron' : 'Amethyst'} ${(i % 3) + 1}`,
    shownSim: () => sim,
    shownSeat: () => 0
  };
  Object.defineProperty(context, 'anonymousNames', { get: () => anonymousNames });

  const env = runInNewContext(
    projCode + '\n;({ stripPresentation, projectBody, viewBodies, syncViewBodies, toViewBody, viewIndex });',
    context
  );

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

  // 3. Gameplay properties, special abilities, temporary state, and future gameplay fields are projected
  assert.equal(context.bodies[0].reach, sim[0].reach);
  assert.equal(context.bodies[0].impulse, sim[0].impulse);
  assert.equal(context.bodies[0].guarding, true);
  assert.equal(context.bodies[0].ironGuard, true);
  assert.equal(context.bodies[0].daze, 0.35);
  assert.equal(context.bodies[0].superActive, 'colossus');
  assert.equal(context.bodies[0].stunned, true, 'stunnedNext projects as stunned on display body');
  assert.equal(context.bodies[0].holding, true);
  assert.equal(context.bodies[0].futureGameplayField, 42, 'future gameplay fields automatically project without allowlist edits');
  assert.equal(Array.isArray(context.bodies[0].nestedArray), true, 'array-valued gameplay field stays an Array');
  assert.deepEqual(structuredClone(context.bodies[0].nestedArray), [1, { tag: 'combo', values: [3, 4] }]);
  assert.notEqual(context.bodies[0].nestedArray, sim[0].nestedArray, 'array reference is cloned across boundary');
  assert.notEqual(context.bodies[0].nestedArray[1], sim[0].nestedArray[1], 'nested object inside array is cloned across boundary');
  assert.notEqual(context.bodies[0].nestedArray[1].values, sim[0].nestedArray[1].values, 'nested inner array is cloned across boundary');
  context.bodies[0].nestedArray[1].values.push(99);
  assert.deepEqual(sim[0].nestedArray[1].values, [3, 4], 'mutating nested display array does not mutate simulation state');
  delete sim[0].nestedArray;
  assert.equal(context.bodies[6].onFire, true);
  assert.equal(context.bodies[6].fireTicks, 90);
  assert.equal(context.bodies[6].pace, 420);
  assert.equal(context.bodies[6].curveFactor, 1.18);
  assert.deepEqual({ ...context.bodies[6].stickOffset }, { x: 18, y: -12 });
  assert.notEqual(context.bodies[6].stickOffset, sim[6].stickOffset, 'nested stickOffset is cloned across boundary');

  // 4. Simulation-internal fields (meterTick, pinX, pinY) stay out of display bodies, and presentation fields stay out of sim
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

  // 7. stripPresentation removes presentation keys from any tainted array
  const tainted = [{ x: 100, name: 'Test', voice: {}, playerIndex: 2, _lastHitSound: 10, _lastWallSound: 20 }];
  env.stripPresentation(tainted);
  assert.deepEqual(tainted, [{ x: 100 }]);
});

test('local gameplay and goal replay maintain separate authoritative simBodies and stable display bodies', () => {
  const P = require('../web/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const code =
    section('function kickoff(isNewMatch = false) {', 'let activeStatsContext') + '\n' +
    section('function creditSave(body, own, iron = false) {', 'function setMeterFill(fill, meter) {') + '\n' +
    section('let activePlayback = null;', 'const replayStore = (() => {') + '\n' +
    section('function finishTurn(goal) {', '$(\'launch\').onclick =') + '\n' +
    section('const PRESENTATION_KEYS =', 'function playOnlineReplay() {');

  const normal = { mass: 127, size: 127, traction: 127, spin: 127, grip: 127, impulse: 127, curve: 127 };
  const practice = Array.from({ length: 6 }, () => {
    const dna = ubu.randomDNA();
    return { model: ubu.decode(dna), dna: ubu.toCode(dna), label: 'Practice ubu' };
  });
  const dummy = () => {};
  const context = {
    Object, Array, Set, clearTimeout, setTimeout,
    P, ububallMatch, structuredClone, performance,
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

  const env = runInNewContext(
    code + '\n;({ kickoff, finishTurn, creditSave, contactMeter, startGoalReplay, endGoalReplay, shownSim });',
    context
  );

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

test('replay takeover (watchReplay -> playFromHere -> local turn) transforms simulation state without display contamination', () => {
  const P = require('../web/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');
  const code =
    section('function kickoff(isNewMatch = false) {', 'let activeStatsContext') + '\n' +
    section('let activePlayback = null;', 'const replayStore = (() => {') + '\n' +
    section('function watchReplay(replay, file) {', 'function endReplayTurn() {') + '\n' +
    section('let guide = null;', '$(\'replay-take-over\').onclick = playFromHere;') + '\n' +
    section('const PRESENTATION_KEYS =', 'function playOnlineReplay() {');

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
    Object, Array, Set, Date, Math, Number, String, Boolean,
    P, ubu, ububallMatch, ububallReplay, structuredClone,
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

  const env = runInNewContext(
    code + '\n;({ watchReplay, playFromHere, syncViewBodies });',
    context
  );

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

test('online seat 1 transition (resolving -> playOnlineReplay -> next plan phase) preserves stable display bodies and clean simulation state', () => {
  const P = require('../web/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');
  const onStateCode = section('function onlineNames(s) {', '});\n  $(\'online-rematch\').onclick')
    .replace('online = ububallOnline({', 'const onlineCallbacks = ({') + '});';
  const code =
    section('let lastSaved = Promise.resolve(null);', 'const replayClock =') + '\n' +
    section('let guide = null;', 'function playFromHere() {') + '\n' +
    section('const PRESENTATION_KEYS =', 'function onlineNames(s) {') + '\n' +
    onStateCode;

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
    Object, Array, Set, Math, Number, String, Boolean, JSON, Promise, console,
    addEventListener: dummy,
    P, ubu, ububallMatch, ububallReplay, structuredClone, performance: { now: () => nowMs },
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

  const env = runInNewContext(
    code + '\n;({ onState: onlineCallbacks.onState, playOnlineReplay });',
    context
  );

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
  env.onState(resolvingState);

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
  env.onState(nextPlanState);

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

function createReplayExportHarness({ seat = 0, mode = 'standard' } = {}) {
  const P = require('../web/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');
  const ububallMP4 = require('../web/mp4.js');

  const code =
    section('function popup(body, text) {', 'function drawPopups(') + '\n' +
    section('function kickoff(isNewMatch = false) {', 'let activeStatsContext') + '\n' +
    section('function creditSave(body, own, iron = false) {', 'function setMeterFill(fill, meter) {') + '\n' +
    section('function replayEvents(turn, tick, sim) {', 'const replayStore = (() => {') + '\n' +
    section('const replayClock = ticks =>', '$(\'replay-seek\').oninput =') + '\n' +
    section('const VIDEO = Object.freeze(', '$(\'replay-export-video\').hidden =') + '\n' +
    section('const CARD = {', 'async function openShare() {') + '\n' +
    section('$(\'export-close\').onclick =', '// Guides, remembered on this device') + '\n' +
    section('let guide = null;', 'function drawGuides(home, away, text, guide) {') + '\n' +
    section('const PRESENTATION_KEYS =', 'function playOnlineReplay() {');

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
        playFoul: dummy
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
    clockNow: () => context.videoClock ?? env.currentReplay()?.clock ?? wallClock,
    gameAudio: () => context.videoAudio || env.currentReplay()?.audio || context.window.ubuAudio,
    classicMode: () => ububallMatch.rule(context.matchMode, 'classic'),
    pulseMode: () => ububallMatch.rule(context.matchMode, 'pulse'),
    normalStats: () => ({
      impulse: 127, traction: 127, spin: 127, curve: 127,
      size: 127, mass: 127, bounciness: 127, grip: 127,
      power: 127, reach: 127, strength: 127, stability: 127,
      efficiency: 127, synergy: 127, chemistry: 127
    }),
    idlePlan: () => ({ angle: 0, power: 0, spin: 0, guard: false }),
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
    trailPositions: () => context.bodies.map(b => ({ x: b.x, y: b.y })),
    clearDiscontinuousTrails: before => {
      context.fieldView.bodies.forEach((b, i) => {
        if (before[i] && (before[i].x !== b.x || before[i].y !== b.y)) (env.currentReplay()?.fx?.trails ?? context.trails)[i].length = 0;
      });
    },
    recordTrails: () => {
      context.fieldView.bodies.forEach((b, i) => {
        (env.currentReplay()?.fx?.trails ?? context.trails)[i].push({ x: b.x, y: b.y, life: 0.24, duration: 0.24 });
      });
    },
    emitSkaterEffects: dummy,
    updateEffects: dt => {
      for (const trail of env.currentReplay()?.fx?.trails ?? context.trails) {
        for (const pt of trail) pt.life -= dt;
      }
      if (context.fieldEffects.goalCall && (context.fieldEffects.goalCall.t += dt) >= context.GOAL_CALL_SECONDS) context.fieldEffects.goalCall = null;
    },
    clearEffects: () => {
      if (!context.fieldView.field) context.postGoal = null;
      (env.currentReplay()?.fx?.trails ?? context.trails).forEach(t => { t.length = 0; });
      context.fieldEffects.particles.length = context.fieldEffects.fireworks.length = context.fieldEffects.shockwaves.length = 0;
      context.fieldEffects.skids.length = context.fieldEffects.skidState.length = context.fieldEffects.burns.length = context.fieldEffects.ripples.length = context.fieldEffects.pings.length = 0;
      (env.currentReplay()?.fx?.popups ?? context.popups).length = 0;
      context.fieldEffects.goalSweep = context.fieldEffects.goalCall = null;
    },
    steamRing: dummy,
    impact: ms => {
      const fx = env.currentReplay()?.fx;
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

  const env = runInNewContext(
    code + '\n;({ watchReplay, endReplay, createReplaySession, withPlaybackContext, loadReplayTurn, stepReplay, seekReplay, endReplayTurn, advanceReplay, updateReplayBar, exportSlice, exportVideo, drawShareCard, composeFrame, currentReplay, shownSim, shownSeat, syncViewBodies, cancelExport: () => { videoCancelled = true; }, isExporting });',
    context
  );

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

