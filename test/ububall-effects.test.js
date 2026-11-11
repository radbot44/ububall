'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ububallPresentation = require('../web/ububall-presentation.js');
const {
  createEffectsState, updateParticles, updatePopups, drawBallFace, drawTrails,
  drawGuardShield, GUARD_SHIELD, conicRingSprites, conicRingSprite, createRinkPresenter
} = ububallPresentation;

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
  Object.assign(context, { createEffectsState, updateParticles, ububallPresentation });
  context.fieldView = fixtureState({ mode: 'matchMode', entries: 'teamEntries', anonymous: 'anonymousNames',
    portrait: 'isPortrait', field: 'videoField' });
  return vm.runInNewContext(code, context);
}

test('match shortcuts do not hijack focused buttons or other controls', () => {
  let keydown, launches = 0, syncs = 0;
  const context = {
    document: {
      addEventListener(type, listener) { if (type === 'keydown') keydown = listener; },
      querySelector() { return null; }
    },
    inMatch: true, theater: null, foulInfo: null, selected: 0,
    ownsFullscreen: () => false,
    sync: () => { syncs++; }, draw() {},
    $: id => {
      assert.equal(id, 'launch');
      return { click: () => { launches++; } };
    }
  };
  runInNewContext(section("  document.addEventListener('keydown', e => {", '  const portraitScreen = matchMedia'), context);
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
  drawTrails(ctx, trails, bodies, '#fff', '#000', () => 0, (heat, alpha) => heat + ':' + alpha, (color, alpha) => color + ':' + alpha);
  assert.equal(gradients.length, 1);
  assert.ok(gradients[0].stops.some(stop => stop.color.startsWith('3:')), 'intermediate heat was discarded');
});

test('ordinary particles keep their filled endpoint', () => {
  const P = require('../web/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const radii = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    arc(x, y, radius) { radii.push(radius); }, fill() {}
  };
  const fx = createEffectsState([], {});
  fx.particles.push({ x: 20, y: 40, px: 20, py: 40, life: 1, duration: 1, team: 0 });
  const presenter = createRinkPresenter({ P, ububallMatch, getView: () => ({ ctx, badgeCtx: ctx, bodies: P.kickoff() }), getEffects: () => fx });
  presenter.drawParticles('#fff', '#000');
  assert.deepEqual(radii, [.9]);
});

test('aura sprites reuse rounded radii and evict stale entries', () => {
  const doc = { createElement() {
    const c = {
      scale() {}, createConicGradient() { return { addColorStop() {} }; },
      beginPath() {}, arc() {}, stroke() {}
    };
    return { getContext() { return c; } };
  } };
  conicRingSprites.clear();
  const first = conicRingSprite('stalwart', 24.1, 3, doc);
  const same = conicRingSprite('stalwart', 24.4, 3, doc);
  for (let r = 1; r <= 100; r++) conicRingSprite('stalwart', r, 3, doc);
  assert.equal(first === same, true);
  assert.ok(conicRingSprites.size <= 48);
});

test('straight vertical shots skip threat simulation, but curved shots do not', () => {
  let steps = 0;
  const ball = { x: 500, y: 300, vx: 0, vy: 600, omega: 0 };
  const bodies = Array.from({ length: 6 }, () => ({})).concat(ball);
  const P = { ...require('../web/ububall-physics.js'), step() { steps++; return null; } };
  const ububallMatch = require('../shared/ububall-match.js');
  const presenter = createRinkPresenter({ P, ububallMatch, getView: () => ({ bodies }), getEffects: () => createEffectsState([], {}) });
  presenter.goalThreat();
  assert.equal(steps, 0);
  ball.omega = 24;
  presenter.goalThreat();
  assert.ok(steps > 0, 'curved ball was incorrectly rejected');
});

function trailHarness() {
  const P = require('../web/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
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
  const fx = createEffectsState([], {});
  const trails = fx.trails;
  const presenter = createRinkPresenter({
    P, ububallMatch,
    getView: () => ({ ctx, badgeCtx: ctx, bodies }),
    getEffects: () => fx,
    isReducedMotion: () => false
  });
  return {
    trailPositions: presenter.trailPositions,
    clearDiscontinuousTrails: presenter.clearDiscontinuousTrails,
    recordTrails: presenter.recordTrails,
    bodies, trails, gradients,
    drawTrails: (home, away) => drawTrails(ctx, trails, bodies, home, away, () => 0, () => '#fff', () => '#fff')
  };
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
  drawBallFace(ctx, 30.6, '#E8CA48', '#AA54D3');
  assert.deepEqual(strokes, ['#E8CA48', '#E8CA48', '#AA54D3']);
});

test('prediction ignition indicator fills with team color', () => {
  const P = require('../web/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const fills = [], strokes = [];
  const ctx = {
    save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, roundRect() {}, arc() {}, rect() {}, clip() {},
    fill() { fills.push(this.fillStyle); },
    stroke() { strokes.push(this.strokeStyle); },
    set fillStyle(val) { this._fillStyle = val; }, get fillStyle() { return this._fillStyle; },
    set strokeStyle(val) { this._strokeStyle = val; }, get strokeStyle() { return this._strokeStyle; }
  };
  const prediction = { paths: [], impacts: [], stops: [], horizon: 240, ignition: { x: 450, y: 300, tick: 60, team: 1 } };
  const bodies = [{ team: 0 }, { team: 0 }, { team: 0 }, { team: 1 }, { team: 1 }, { team: 1 }, { team: -1 }];
  const presenter = createRinkPresenter({
    P, ububallMatch,
    getView: () => ({ ctx, badgeCtx: ctx, bodies, mode: 'standard', portrait: false }),
    getEffects: () => createEffectsState([], {})
  });
  presenter.paintPrediction(prediction, '#E8CA48', '#AA54D3');
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
  updatePopups(0.2, popups, false);
  assert.equal(popups.length, 1);
  assert.equal(popups[0].text, 'Trap!');
  assert.ok(Math.abs(popups[0].life - 0.3) < 1e-6);
});

test('iron guard shield receives #6b7785 border stroke with lineWidth 1.5', () => {
  let strokeStyle = null, lineWidth = null, strokePath = null, fillStyle = null;
  const badgeCtx = {
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    fill(p) { fillStyle = this.fillStyle; },
    stroke(p) { strokeStyle = this.strokeStyle; lineWidth = this.lineWidth; strokePath = p; },
    set fillStyle(val) { this._fillStyle = val; }, get fillStyle() { return this._fillStyle; },
    set strokeStyle(val) { this._strokeStyle = val; }, get strokeStyle() { return this._strokeStyle; },
    set lineWidth(val) { this._lineWidth = val; }, get lineWidth() { return this._lineWidth; }
  };
  const b = { guarding: true, radius: 25, x: 100, y: 100 };
  drawGuardShield(badgeCtx, b, false, true);
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
  const fps = 60;
  const dt = 1 / fps;
  for (let f = 1; f <= 30; f++) {
    updatePopups(dt, popups, false);
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
    section('function clearActiveMatch() {', 'function aimPower(distance, arrow) {') + '\n' +
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
  const code = section('function creditSave(body, own, iron = false) {', 'function flushMeters() {');
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

  // 2. Even if goalReplay or theater is truthy, contactMeter never awards live meter
  const replayEnv = runInNewContext(code + '\n;({ contactMeter });', {
    phase: 'goal', online: null, goalReplay: { sim: [] }, theater: { sim: [] },
    bodies: [], simBodies: [], stats: [], classicMode: () => false, matchTicks: 0, elapsed: 0,
    P, ububallMatch, dirtyMeters, popup: () => {}, steamRing: () => {}, gameAudio: () => null
  });
  replayEnv.contactMeter({}, {}, 200);
  assert.equal(calledContact, 0, 'contact meter rejected during goalReplay and theater');

  // 3. In active play phase, meter functions proceed
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
  const bodies = P.kickoff();
  const plans = [
    { angle: 1.234567, power: 0.876543, spin: 0, guard: false },
    { angle: 0, power: 0, spin: 0, guard: false },
    { angle: 0, power: 0, spin: 0, guard: false }
  ];
  let turn = 1;
  const matchMode = 'standard';
  const fouls = ububallMatch.newFouls();
  const env = createRinkPresenter({
    P, ububallMatch,
    getView: () => ({ bodies, mode: matchMode }),
    getEffects: () => createEffectsState([], {}),
    getPlans: () => plans,
    getTurn: () => turn,
    getFouls: () => fouls
  });

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
    section('function creditSave(body, own, iron = false) {', 'function flushMeters() {') + '\n' +
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
    'function popup(body, text) { const p = fieldEffects.popups; if (!reducedMotion.matches && p.length < 8) p.push({ x: body.x, y: body.y - body.radius - 20, text, team: body.team, life: 1.2, duration: 1.2 }); }\n' +
    'function updatePopups(dt, popups) { ububallPresentation.updatePopups(dt, popups, reducedMotion.matches); }\n' +
    section('function kickoff(isNewMatch = false) {', 'let activeStatsContext') + '\n' +
    section('function creditSave(body, own, iron = false) {', 'function flushMeters() {') + '\n' +
    section('function replayEvents(turn, tick, sim) {', 'const replayStore = (() => {') + '\n' +
    section('const replayClock = ticks =>', '$(\'replay-seek\').oninput =') + '\n' +
    section('const VIDEO = Object.freeze(', '$(\'replay-export-video\').hidden =') + '\n' +
    section('const CARD = {', 'async function openShare() {') + '\n' +
    section('$(\'export-close\').onclick =', '// Guides, remembered on this device') + '\n' +
    section('let guide = null;', '// Play from here:') + '\n' +
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
        playFoul: dummy,
        playIronSave: dummy,
        playFanfare: dummy
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


test("Snap team-color FX, Spin Strike whip, Flaming Ball woosh, Hard Brake & Rim-Around shared sound, Tailgating wind cone, Puck Slide, Fireworks & MP4 offlineAudio", () => {
  const P = require("../web/ububall-physics.js");
  const calls = { ball: [], goal: [], wall: [], carve: [], slip: [], collision: [], move: [], spin: [], puck: [], whip: [], fire: [], firework: [] };
  let now = 1000;
  const mockAudio = {
    playBallHit: o => calls.ball.push(o),
    playGoalHit: (t, o) => calls.goal.push([t, o]),
    playWallHit: o => calls.wall.push(o),
    playCarve: o => calls.carve.push(o),
    playSlipstream: o => calls.slip.push(o),
    playCollision: (v, o) => calls.collision.push(o),
    playUbuMove: o => calls.move.push(o),
    playSpin: o => calls.spin.push(o),
    playPuckSlide: o => calls.puck.push(o),
    playSpinStrike: o => calls.whip.push(o),
    playFireImpact: o => calls.fire.push(o),
    playFirework: o => calls.firework.push(o),
    stopMotion: () => {},
    playSizzle: () => null
  };
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach((b, i) => { P.applyStats(b); b.voice = { instrument: i }; });
  const fx = createEffectsState([], {});
  const popups = fx.popups;
  const ububallMatch = require("../shared/ububall-match.js");
  const drawCalls = { fills: 0, grads: 0 };
  const mockCtx = {
    save() {}, restore() {}, translate() {}, rotate() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, arc() {}, stroke() {},
    fill() { drawCalls.fills++; },
    createLinearGradient() { drawCalls.grads++; return { addColorStop() {} }; }
  };
  const env = createRinkPresenter({
    P,
    ububallMatch,
    getView: () => ({ bodies, ctx: mockCtx, badgeCtx: mockCtx, mode: "standard" }),
    getEffects: () => fx,
    isReducedMotion: () => false,
    clockNow: () => now,
    gameAudio: () => mockAudio,
    contactMeter: () => {}
  });

  // 1. Snap collision: dramatic team-colored shockwave ring, flash & streaks (no white/gold), plus playBallHit({ snap: true })
  Object.assign(bodies[6], { x: 500, y: 300, vx: 650, vy: 0 });
  const pBeforeSnap = fx.particles.length;
  const wBeforeSnap = fx.shockwaves.length;
  env.handleCollision(bodies[4], bodies[6], 340, 500, false, false, true, 0); // Away team (team 1) Snap
  assert.equal(calls.ball.at(-1)?.snap, true, "Snap passes snap: true to playBallHit");
  assert.equal(fx.shockwaves.length, wBeforeSnap + 2, "Snap emits twin team-colored shockwave rings");
  assert.equal(fx.shockwaves.at(-1).team, 1, "Snap shockwave uses redirecting skater team color");
  assert.equal(fx.shockwaves.at(-1).color, null, "Snap shockwave dynamically resolves team color");
  const snapParticles = fx.particles.slice(pBeforeSnap);
  assert.ok(snapParticles.length >= 20, "Snap emits dramatic burst of team-colored particles");
  assert.equal(snapParticles.some(p => p.color === "#ffd76b"), false, "Snap no longer uses hardcoded gold");
  assert.ok(snapParticles.some(p => p.flash && p.team === 1), "Snap includes compact team-colored flash");
  assert.ok(snapParticles.some(p => p.materialShape === "streak" && p.team === 1), "Snap includes team-colored directional streaks");

  // 1b. Spin strike collision triggers playSpinStrike whip sound
  now += 200;
  Object.assign(bodies[6], { x: 460, y: 300, vx: 620, vy: -80, omega: -16, spinStruck: true });
  env.handleCollision(bodies[0], bodies[6], 360, 480, false, false, false, 0);
  bodies[6].spinStruck = false;
  assert.equal(calls.whip.length, 1, "Spin strike triggers playSpinStrike whip sound");

  // 1c. Flaming ball impacts trigger playFireImpact on skater hit and flaming wall bounce (but not on Cannonball ignition tick)
  now += 200;
  Object.assign(bodies[6], { onFire: true, fireTicks: 60, vx: 880, vy: 0 });
  env.handleCollision(bodies[3], bodies[6], 520, 600, true, false, false, 0);
  assert.equal(calls.fire.length, 1, "Flaming ball plow triggers playFireImpact");
  now += 200;
  env.handleWall(bodies[6], 420, "wall", 0, -1, false);
  assert.equal(calls.fire.length, 2, "Flaming ball Meteor Bank board impact triggers playFireImpact");
  bodies[6].onFire = false; bodies[6].fireTicks = 0;

  // 2. Post English hard hit: metallic sparks + spin/speed passed to playGoalHit("post")
  now += 200;
  Object.assign(bodies[6], { x: 922, y: 235, vx: -400, vy: 120, omega: -18 });
  const pBeforePost = fx.particles.length;
  env.handleWall(bodies[6], 380, "post", 1, 0, false);
  assert.equal(calls.goal.at(-1)?.[0], "post");
  assert.equal(calls.goal.at(-1)?.[1]?.spin, 18);
  assert.equal(calls.goal.at(-1)?.[1]?.speed, 380);
  assert.ok(fx.particles.length > pBeforePost + 8, "hard post hit emits metallic tangent sparks");

  // 3. Rim-Around corner carve AND Hard Braking share playCarve + 180 ms cooldown
  now += 200;
  Object.assign(bodies[0], { x: 106, y: 106, vx: 280, vy: -280, omega: -12 });
  env.handleWall(bodies[0], 95, "wall", -Math.SQRT1_2, -Math.SQRT1_2, true);
  assert.equal(calls.carve.length, 1, "Rim-Around triggers playCarve");
  assert.ok(fx.skidState[0]?.time >= 0.2, "Rim-Around feeds skidState for curved skate mark");
  assert.ok(fx.particles.some(p => p.color === "#ffb347" || p.color === "#fff1c1" || p.color === "#ff7a1a"), "Rim-Around emits skate sparks like the hot ball");
  now += 50; // within 180 ms cooldown
  env.handleWall(bodies[0], 80, "wall", -Math.SQRT1_2, -Math.SQRT1_2, true);
  assert.equal(calls.carve.length, 1, "playCarve is cooldown-gated across multi-tick corner carves");
  now += 200; // test Hard Braking in markIce sharing playCarve
  Object.assign(bodies[1], { x: 250, y: 300, vx: 650, vy: 0 });
  env.markIce(bodies[1], 1, 1 / 60);
  bodies[1].x = 258; bodies[1].vx = 120; // slowed by 530 > SKID_SLOWDOWN (220)
  env.markIce(bodies[1], 1, 1 / 60);
  assert.equal(calls.carve.length, 2, "Hard braking triggers the shared playCarve hockey stop sound");

  // 4. Tailgating + Movement + Puck Slide: continuous 85 ms wind grains, front wind cone, ubu wobble, spin wobble, puck slide
  Object.assign(bodies[0], { x: 300, y: 300, vx: 360, vy: 0, omega: 14 });
  Object.assign(bodies[1], { x: 365, y: 300, vx: 520, vy: 0, omega: 0 });
  Object.assign(bodies[6], { x: 500, y: 180, vx: 440, vy: 0 });
  now += 300;
  env.emitSkaterEffects(0.1);
  assert.equal(calls.slip.length, 1, "Tailgating triggers continuous playSlipstream wind grain");
  assert.ok(calls.move.length >= 6, "emitSkaterEffects updates playUbuMove per skater");
  assert.ok(calls.spin.length >= 6, "emitSkaterEffects updates playSpin per skater");
  assert.equal(calls.puck.length, 1, "Moving ball triggers playPuckSlide");
  assert.ok(fx.particles.some(p => p.color === "#d6f6ff"), "Tailgating spawns pale-cyan wake streaks");
  now += 40; // within 85 ms continuous crossfade cadence
  env.emitSkaterEffects(0.04);
  assert.equal(calls.slip.length, 1, "playSlipstream is gated at 85 ms crossfade cadence");
  now += 55; // past 85 ms -> next overlapping wind grain fires for continuous wind
  env.emitSkaterEffects(0.05);
  assert.equal(calls.slip.length, 2, "playSlipstream fires next overlapping grain after 85 ms");

  // Verify drawTailgateCone & tapered drawSpin execute clean gradient polygon fills
  const fillsBefore = drawCalls.fills;
  env.drawTailgateCone(bodies[0], 0.8);
  assert.ok(drawCalls.fills >= fillsBefore + 3, "drawTailgateCone renders front shroud + bow streamlines");
  const fillsBeforeSpin = drawCalls.fills;
  env.drawSpin(bodies[0], "#e8ca48");
  assert.ok(drawCalls.fills > fillsBeforeSpin, "drawSpin renders filled tapered directional spin blades");

  // 5. Goal fireworks play synchronized playFirework pops when shells burst
  fx.fireworks.push({ x: 640, y: 260, vy: -120, fuse: 0.02, delay: 0, team: 0, ring: true });
  env.updateEffects(0.05);
  assert.equal(calls.firework.length, 1, "Exploding firework shell triggers playFirework pop");
  assert.equal(calls.firework[0].ring, true);

  // 6. Hip Clip glancing check: scales spark burst and audio volume even when normal closing speed is modest
  now += 200;
  Object.assign(bodies[2], { x: 400, y: 300, vx: 450, vy: 0 });
  Object.assign(bodies[3], { x: 440, y: 330, vx: -100, vy: 0 });
  const cBefore = calls.collision.length;
  env.handleCollision(bodies[2], bodies[3], 50, 120, false, false, false, 480);
  assert.equal(calls.collision.length, cBefore + 1);
  assert.ok(calls.collision.at(-1).volume > 0.35, "Hip Clip tangential spin impulse scales check audio volume");

  // Strict scope invariant: zero popup banners for any of these mechanics
  assert.equal(popups.length, 0, "none of these mechanics create floating text popups");

  // 7. Offline MP4 export audio adapter exposes all new movement, spin, impact, save, and firework methods
  const exportCode = section("function offlineAudio(offline, seconds) {", "let videoLogoImage = null;");
  let sharedCtx = null;
  const forwarded = [];
  const fakeUbuAudio = {
    shareMasterChain: ctx => { sharedCtx = ctx; },
    stopMotion: ctx => forwarded.push(["stopMotion", Boolean(ctx)]),
    playCollision: (v, o) => forwarded.push(["collision", o]),
    playBallHit: o => forwarded.push(["ball", o]),
    playUbuMove: o => forwarded.push(["move", o]),
    playSpin: o => forwarded.push(["spin", o]),
    playPuckSlide: o => forwarded.push(["puck", o]),
    playCarve: o => forwarded.push(["carve", o]),
    playSlipstream: o => forwarded.push(["slipstream", o]),
    playSpinStrike: o => forwarded.push(["whip", o]),
    playFireImpact: o => forwarded.push(["fire", o]),
    playSave: o => forwarded.push(["save", o]),
    playFirework: o => forwarded.push(["firework", o]),
    playWallHit: o => forwarded.push(["wall", o]),
    playGoalHit: (t, o) => forwarded.push(["goal", t, o]),
    playSuper: () => {}, playSizzle: () => {}, playFoul: () => {}, playIronSave: () => {}, playFanfare: () => {}
  };
  const { offlineAudio } = runInNewContext(exportCode + "\n;({ offlineAudio });", { Proxy, window: { ubuAudio: fakeUbuAudio } });
  const adapter = offlineAudio({ sampleRate: 48000 }, () => 2.5);
  assert.ok(sharedCtx && sharedCtx.currentTime === 2.5);
  adapter.playBallHit({ volume: 0.9, snap: true });
  adapter.playGoalHit("post", { volume: 0.9, spin: 16, speed: 480 });
  adapter.playUbuMove({ id: 0, speed: 400 });
  adapter.playSpin({ id: 0, omega: 12 });
  adapter.playPuckSlide({ speed: 500 });
  adapter.playCarve({ volume: 0.6 });
  adapter.playSlipstream({ volume: 0.5 });
  adapter.playSpinStrike({ spin: 15 });
  adapter.playFireImpact({ volume: 0.8 });
  adapter.playSave({ own: false });
  adapter.playFirework({ ring: false });
  adapter.stop();
  assert.deepEqual(forwarded.map(e => e[0]), [
    "ball", "goal", "move", "spin", "puck", "carve", "slipstream", "whip", "fire", "save", "firework", "stopMotion"
  ]);
  assert.equal(forwarded[0][1].snap, true);
  assert.equal(forwarded[1][2].spin, 16);
});

test('ububall.js shares ububall-presentation.js without duplicating effect implementations, and /effects is unlinked everywhere', () => {
  assert.match(source, /createRinkPresenter\(/, 'ububall.js instantiates the shared createRinkPresenter');
  for (const fn of [
    'function drawTrails(', 'function drawParticles(', 'function drawSuperAura(',
    'function drawStickyTether(', 'function handleCollision(', 'function handleWall(',
    'function handleSuper(', 'function handleShockwave(', 'function drawGoalSweep(',
    'function drawGoalCall(', 'function paintPrediction(', 'function drawBallFace('
  ]) {
    assert.equal(source.includes(fn), false, `ububall.js must not duplicate ${fn}`);
  }

  // Verify no existing page or script links to /effects or effects.html
  for (const rel of ['web/index.html', 'web/demo.html', 'web/voice.html', 'web/ububall.html', 'web/site-header.js', 'web/app.js', 'web/ububall.js', 'web/site.js']) {
    const content = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
    assert.equal(/\/effects(\.html)?\b/.test(content), false, `${rel} must not link to /effects`);
  }

  // Verify effects.html has no site header and loads the real game modules
  const effectsHtml = fs.readFileSync(path.resolve(__dirname, '../web/effects.html'), 'utf8');
  assert.equal(/class="site-header"/.test(effectsHtml), false, 'effects.html must not render the site header');
  for (const script of ['ubu.js', 'ubu-render.js', 'ubu-audio.js', 'ububall-match.js', 'ububall-physics.js', 'ububall-presentation.js', 'effects.js']) {
    assert.ok(effectsHtml.includes(`src="${script}"`), `effects.html loads ${script}`);
  }
});

test('Effects Demo catalog covers all 8 match-flow groups, all match sounds, all supers, all materials, and executes every scenario through createRinkPresenter', () => {
  const P = require('../web/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const { EFFECT_GROUPS, GOAL_CALL_VARIANTS } = require('../web/effects.js');

  assert.deepEqual(
    EFFECT_GROUPS.map(g => g.id),
    ['start', 'planning', 'movement', 'impacts', 'saves', 'supers', 'fouls', 'goals'],
    'groups follow exact match occurrence order'
  );

  // Goal calls include every GOAL_WORDS entry
  for (const label of Object.keys(ububallPresentation.GOAL_WORDS)) {
    assert.ok(GOAL_CALL_VARIANTS.some(v => v.id === label), `goal call variant ${label} is registered`);
  }

  // Every canonical super in P.SUPERS has a dedicated scenario in the supers group
  const superGroup = EFFECT_GROUPS.find(g => g.id === 'supers');
  for (const s of P.SUPERS) {
    assert.ok(superGroup.items.some(item => item.id === `super-${s.key}`), `super ${s.key} has a demo card`);
  }

  // Run every scenario and every variant + sound trigger against a real createRinkPresenter + physics harness
  const audioHits = new Set();
  const superPhases = new Set();
  const mockAudio = {
    playGameStart: () => { audioHits.add('playGameStart'); return { stop() {} }; },
    playCollision: () => { audioHits.add('playCollision'); return { stop() {} }; },
    playBallHit: opts => { audioHits.add(opts?.snap ? 'playBallHit:snap' : 'playBallHit'); },
    playUbuMove: () => { audioHits.add('playUbuMove'); return { stop() {} }; },
    playSpin: () => { audioHits.add('playSpin'); return { stop() {} }; },
    playPuckSlide: () => { audioHits.add('playPuckSlide'); },
    playCarve: () => { audioHits.add('playCarve'); },
    playSlipstream: () => { audioHits.add('playSlipstream'); },
    playSpinStrike: () => { audioHits.add('playSpinStrike'); },
    playWallHit: () => { audioHits.add('playWallHit'); },
    playFireImpact: () => { audioHits.add('playFireImpact'); },
    playSave: () => { audioHits.add('playSave'); },
    playFirework: () => { audioHits.add('playFirework'); },
    playGoalHit: type => { audioHits.add(`playGoalHit:${type}`); },
    playSizzle: () => { audioHits.add('playSizzle'); return { stop() {} }; },
    playIronSave: () => { audioHits.add('playIronSave'); },
    playSuper: (key, stg) => { audioHits.add('playSuper'); superPhases.add(`${key}:${stg}`); return { stop() {} }; },
    playFoul: kind => { audioHits.add(`playFoul:${kind}`); },
    playVoice: () => { audioHits.add('playVoice'); return { stop() {} }; },
    playFanfare: () => { audioHits.add('playFanfare'); return { stop() {} }; },
    stopMotion: () => {},
    stop: () => {}
  };

  const makeMockCtx2d = () => ({
    save() {}, restore() {}, setTransform() {}, clearRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {}, arc() {}, rect() {}, roundRect() {}, clip() {}, fill() {}, stroke() {},
    fillRect() {}, fillText() {}, strokeText() {}, translate() {}, rotate() {}, scale() {},
    setLineDash() {}, drawImage() {}, getTransform: () => ({ a: 1 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createConicGradient: () => ({ addColorStop() {} })
  });
  const docStub = {
    createElement: () => ({ width: 128, height: 128, getContext: makeMockCtx2d })
  };

  const entries = Array.from({ length: 6 }, (_, i) => {
    const dna = ubu.randomDNA();
    const model = ubu.decode(dna);
    return { key: 't-' + i, dna: ubu.toCode(dna), baseModel: model, model, equippedSuper: { ...P.SUPERS[i % 8] } };
  });
  const view = {
    canvas: { width: 1000, height: 600, clientWidth: 1000, clientHeight: 600 },
    ctx: makeMockCtx2d(),
    badgeCanvas: { width: 1000, height: 600 },
    badgeCtx: makeMockCtx2d(),
    bodies: P.kickoff(),
    entries,
    mode: 'standard',
    portrait: false,
    anonymous: false,
    field: null
  };
  const fx = createEffectsState(entries);
  let phase = 'plan', plans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0, guard: false }));
  let fouls = ububallMatch.newFouls(), foulInfo = null, play = ububallMatch.newPlay(), tally = ububallMatch.newTally();
  let clock = 1000, elapsed = 0, goalReplay = null, scoringPlayer = null;
  const stats = entries.map(e => ({ ...e.model.stats }));

  const presenter = createRinkPresenter({
    P, ububallMatch,
    getView: () => view,
    getEffects: () => fx,
    getPhase: () => phase,
    getPlans: () => plans,
    getFouls: () => fouls,
    getFoulInfo: () => foulInfo,
    getScoringPlayer: () => scoringPlayer,
    getGoalReplay: () => goalReplay,
    getElapsed: () => elapsed,
    clockNow: () => clock,
    gameAudio: () => mockAudio,
    doc: docStub
  });

  const liveFx = {
    collide: (a, b, spd, imp, plow, iron, checker, snapped, tang) => presenter.handleCollision(a, b, spd, imp, plow, iron, snapped, tang),
    wall: (b, v, wt, nx, ny, rimmed) => presenter.handleWall(b, v, wt, nx, ny, rimmed),
    shockwave: (srcBody, r, type) => presenter.handleShockwave(srcBody, r, type),
    super: (k, stg, b, tgt) => presenter.handleSuper(k, stg, b, tgt)
  };

  let callbacks = [];
  const ctx = {
    P, ububallMatch, presenter,
    get bodies() { return view.bodies; },
    get entries() { return view.entries; },
    get plans() { return plans; },
    get fouls() { return fouls; },
    get play() { return play; },
    get stats() { return stats; },
    get fx() { return fx; },
    audio: () => mockAudio,
    voice: () => entries[0].model.voice,
    getSelectedMaterial: () => 'lava',
    getSelectedSuperId: () => 3,
    setSelected: () => {},
    idlePlans: () => Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0, guard: false })),
    resetStage: ({ phase: nextPhase = 'plan', mode = 'standard', glow = 0 } = {}) => {
      callbacks = [];
      goalReplay = null; scoringPlayer = null; foulInfo = null;
      view.mode = mode; phase = nextPhase; elapsed = 0;
      fouls = ububallMatch.newFouls(); play = ububallMatch.newPlay(); tally = ububallMatch.newTally();
      plans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0, guard: false }));
      view.bodies = P.kickoff();
      view.bodies.slice(0, 6).forEach((b, i) => {
        ububallMatch.applyStats(P, b, stats[i], mode);
        b.name = entries[i].model.parts.fullName;
        b.voice = entries[i].model.voice;
        b.equippedSuper = { ...P.SUPERS[i % 8] };
      });
      presenter.clearEffects();
      fx.kickoffGlow = glow;
      presenter.dirtyPrediction();
    },
    place: (idx, x, y, extra = {}) => Object.assign(view.bodies[idx], { x, y }, extra),
    boostStats: (idx, overrides) => ububallMatch.applyStats(P, view.bodies[idx], { ...stats[idx], ...overrides }, view.mode),
    equipSuper: (idx, id) => { view.bodies[idx].equippedSuper = { ...P.SUPERS[id] }; },
    setSkaterMaterial: (idx, mat) => {
      const cloned = structuredClone(entries[idx].baseModel.attributes);
      cloned.background.texture = mat;
      entries[idx].model = { ...entries[idx].baseModel, dna: null, attributes: cloned };
      fx.materialEmitters = ububallPresentation.createMaterialEmitters(entries);
    },
    launchPlans: turnPlans => {
      plans = turnPlans; phase = 'play';
      P.startTurn(view.bodies, plans, liveFx.super);
    },
    syncMeters: () => {},
    bugTab: () => {},
    banner: () => {},
    openFoulInfo: info => { foulInfo = info; },
    setForcedGoalLabel: () => {},
    startGoalReplayDemo: () => {
      phase = 'play';
      goalReplay = { total: 40, played: 0, scored: false };
      view.bodies[6].x = 880; view.bodies[6].vx = 520;
    },
    after: (sec, fn) => callbacks.push({ at: sec, fn }),
    playTimedSizzle: () => { mockAudio.playSizzle(); },
    playSampleFanfare: () => { mockAudio.playFanfare(); }
  };

  let totalScenarios = 0;
  for (const group of EFFECT_GROUPS) {
    assert.ok(group.items.length >= 1, `group ${group.id} has items`);
    for (const item of group.items) {
      const variants = item.variants?.length ? item.variants.map(v => v.id) : [undefined];
      for (const variant of variants) {
        totalScenarios++;
        clock += 1000;
        item.run(ctx, variant);
        if (item.playSound) item.playSound(ctx, variant);
        // Step 90 ticks (~0.375s) and render scene to verify live physics + presentation execution
        for (let t = 0; t < 90; t++) {
          clock += P.DT * 1000;
          elapsed += P.DT;
          for (let c = callbacks.length - 1; c >= 0; c--) {
            if (elapsed >= callbacks[c].at) { const fn = callbacks[c].fn; callbacks.splice(c, 1); fn(); }
          }
          if (phase === 'play') {
            const tick = ububallMatch.playTick(P, view.bodies, play, liveFx, tally);
            for (const s of tick.saves) {
              if (s.iron) mockAudio.playIronSave();
              presenter.popup(view.bodies[s.index], s.iron ? (s.own ? 'Trap!' : 'Big save!') : s.own ? 'Save...' : 'Save!');
            }
            if (tick.struck) presenter.popup(view.bodies[6], 'Spin strike!');
            presenter.recordTrails();
            if (tick.goal !== null) {
              scoringPlayer = view.bodies[0];
              presenter.celebrate(tick.goal, view.bodies[6], 'GOAL', scoringPlayer);
              phase = 'goal';
            }
          }
        }
        presenter.emitSkaterEffects(0.05);
        presenter.updatePopups(0.05);
        presenter.updateEffects(0.05);
        presenter.drawScene();
      }
    }
  }
  assert.ok(totalScenarios >= 50, 'all scenarios and variants executed cleanly');

  // Verify every single match audio entrypoint in ubuAudio was exercised!
  for (const expected of [
    'playGameStart', 'playCollision', 'playBallHit', 'playBallHit:snap',
    'playUbuMove', 'playSpin', 'playPuckSlide',
    'playCarve', 'playSlipstream', 'playSpinStrike', 'playWallHit', 'playFireImpact',
    'playSave', 'playFirework', 'playGoalHit:post', 'playGoalHit:net',
    'playSizzle', 'playIronSave', 'playSuper', 'playFoul:warning', 'playFoul:card',
    'playVoice', 'playFanfare'
  ]) {
    assert.ok(audioHits.has(expected), `Effects Demo covers audio entrypoint ${expected}`);
  }
  for (const expectedSuper of [
    'stalwart:launch', 'stalwart:impact', 'knockout:impact', 'sticky:impact',
    'cannonball:impact', 'magnet:pull', 'colossus:launch', 'shockwave:impact', 'ghost:launch'
  ]) {
    assert.ok(superPhases.has(expectedSuper), `Effects Demo covers super sound ${expectedSuper}`);
  }
});

// --- Domain 4 Phase 2 Regression Tests ---

test('D4-01, D4-03, D4-06: replay entries preserve keys & super mastery on takeover, endReplay avoids phantom CPU match, and newMatch clears theater', () => {
  const P = require('../web/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');

  // Find or synthesize a DNA with >= 2 copies of a super so mastery bonusTicks > 0
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

  const ubus = Array.from({ length: 6 }, (_, i) => ({
    dna: i === 0 ? masteredDna : ubu.toCode(ubu.randomDNA()),
    super: i === 0 ? masteredSuperId : (i % 8)
  }));
  const rec = ububallReplay.create({ mode: 'standard', seat: 0, names: ['Alpha', 'Beta'], ubus });
  const t = ububallReplay.addTurn(rec, {
    turn: 1, scores: [0, 0], fouls: ububallMatch.newFouls(), bodies: P.kickoff(),
    plans: Array.from({ length: 6 }, () => ({ angle: 0, power: 0.3, spin: 0, superArm: false, guard: false }))
  });
  t.ticks = 12;

  const code =
    section('function kickoff(isNewMatch = false) {', 'let activeStatsContext') + '\n' +
    section('function clearActiveMatch() {', 'function aimPower(distance, arrow) {') + '\n' +
    section('let activePlayback = null;', 'const replayStore = (() => {') + '\n' +
    section('function watchReplay(replay, file) {', 'function endReplayTurn() {') + '\n' +
    section('let guide = null;', "$('replay-take-over').onclick = playFromHere;") + '\n' +
    section('function resolveEquippedSuper(entry, slotIndex = 0) {', 'const POSITIONS = [') + '\n' +
    section('  const onGuestTeam =', '  async function adoptAccountTeam()') + '\n' +
    section('const PRESENTATION_KEYS =', 'function playOnlineReplay() {');

  let newMatchCalls = 0;
  const classes = new Set();
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
    Object, Array, Set, Date, Math, Number, String, Boolean, JSON,
    P, ubu, ububallMatch, ububallReplay, structuredClone,
    localStorage: { getItem: () => null, setItem: dummy, removeItem: dummy },
    $,
    document: {
      body: {
        classList: {
          add: c => classes.add(c),
          remove: c => classes.delete(c),
          toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
        }
      },
      querySelector: () => null
    },
    inDiscord: false, demo: false, online: null,
    cpuMode: 'standard', cpuLevel: 'medium', cpuTeam: localTeam,
    starterEntries: () => localTeam,
    draft: [...localTeam], roster: [...localTeam], teamEntries: [], stats: [], plans: [], cpu: [], cpuDone: false,
    idlePlan: () => ({ angle: 0, power: 0, spin: 0, guard: false }),
    saveRecording: dummy, stopDemo: dummy, closeSummary: dummy, endGoalReplay: dummy,
    stopFanfare: dummy, gameAudio: () => ({ stop: dummy }),
    cpuGeneration: 0, cpuClient: { cancel: dummy, dispose: dummy }, videoLogo: dummy,
    showMode: dummy, classicMode: () => false, normalStats: () => ({}),
    anonymousName: i => `Anon ${i}`, anonymousNames: false,
    buildTeam: dummy, replayMarks: dummy, enterMatch: dummy, updateReplayBar: dummy, updateHome: dummy,
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

  const env = runInNewContext(
    code + '\n;({ watchReplay, endReplay, playFromHere, onGuestTeam, newMatch });',
    context
  );

  // 1. watchReplay assigns replay-* keys and full superMastery metadata
  env.watchReplay(rec, null);
  assert.equal(classes.has('replay-match'), true);
  assert.equal(context.teamEntries[0].key, 'replay-0');
  assert.ok(context.teamEntries[0].equippedSuper.bonusTicks > 0, 'watchReplay preserves superMastery bonusTicks');
  assert.ok(context.teamEntries[0].equippedSuper.copies >= 2, 'watchReplay preserves superMastery copies');

  // 2. playFromHere keeps replay-* keys (onGuestTeam does not throw) and applies mastery bonuses to simBodies
  env.playFromHere();
  assert.equal(context.roster[0].key, 'replay-0');
  assert.equal(env.onGuestTeam(), false, 'onGuestTeam returns false cleanly without TypeError');
  assert.ok(context.simBodies[0].superBonusTicks > 0, 'playFromHere preserves superBonusTicks on simBodies');
  assert.ok(context.simBodies[0].equippedSuper.bonusTicks > 0, 'playFromHere preserves equippedSuper.bonusTicks');

  // 3. endReplay clears replay state cleanly without starting an unrequested phantom CPU match
  env.watchReplay(rec, null);
  env.endReplay();
  assert.equal(context.theater, null);
  assert.equal(classes.has('replay-match'), false);
  assert.equal(context.phase, 'over', 'endReplay leaves phase === over so exitMatchMode resumes Home demo');
  assert.equal(context.recording, null, 'endReplay does not create a phantom CPU match recording');
  assert.equal(newMatchCalls, 0);

  // 4. Starting newMatch while replay viewer is active clears theater and replay-match class (D4-03)
  env.watchReplay(rec, null);
  assert.ok(context.theater);
  assert.equal(classes.has('replay-match'), true);
  env.newMatch();
  assert.equal(context.theater, null, 'newMatch clears active theater');
  assert.equal(classes.has('replay-match'), false, 'newMatch removes replay-match class');
  assert.equal(context.phase, 'plan');
});

test('D4-04 & D4-07: offlineAudio.playFanfare routes customCtx to OfflineAudioContext with loop:false, and replay/export stop fanfare cleanly', async () => {
  const exportCode = section('function offlineAudio(offline, seconds) {', 'let videoLogoImage = null;');
  const fanfareCalls = [];
  const fakeUbuAudio = {
    shareMasterChain: () => {},
    stopMotion: () => {},
    playFanfare: (voice, customCtx, onNote, opts) => {
      fanfareCalls.push({ voice, customCtx, onNote, opts });
      return { stop() {} };
    }
  };
  const { offlineAudio } = runInNewContext(exportCode + '\n;({ offlineAudio });', { Proxy, window: { ubuAudio: fakeUbuAudio } });
  const offlineTarget = { sampleRate: 48000, marker: 'offline-ctx' };
  const adapter = offlineAudio(offlineTarget, () => 3.25);

  // Simulate presenter.loopFanfare(voice) calling gameAudio().playFanfare(voice, null, null, { loop: true })
  adapter.playFanfare({ pitch: 220 }, null, null, { loop: true, volume: 0.8 });
  assert.equal(fanfareCalls.length, 1);
  assert.equal(fanfareCalls[0].customCtx.marker, 'offline-ctx', '2nd arg customCtx receives offline AudioContext proxy');
  assert.equal(fanfareCalls[0].customCtx.currentTime, 3.25, 'customCtx reports offline timeline currentTime');
  assert.equal(fanfareCalls[0].opts.loop, false, 'offline export forces loop: false to prevent wall-clock setTimeout leaks');
  assert.equal(fanfareCalls[0].opts.volume, 0.8);

  // Verify stopFanfare() is called across seekReplay, goal turn advance, final turn end, and exportVideo finally
  const harness = createReplayExportHarness({ seat: 0 });
  let stopFanfareCount = 0;
  harness.context.stopFanfare = () => { stopFanfareCount++; };
  harness.env.watchReplay(harness.rec, null);
  stopFanfareCount = 0;

  harness.env.seekReplay(5);
  assert.equal(stopFanfareCount, 1, 'seekReplay stops looping goal fanfare');

  // Step through turn 1 goal and advance past hold into turn 2
  const dt = 1 / 60;
  for (let s = 0; s < 30; s++) {
    harness.context.setClock(5000 + (s + 1) * 20);
    harness.env.advanceReplay(dt, harness.context.theater);
  }
  assert.equal(harness.context.theater.called, true);
  stopFanfareCount = 0;
  harness.context.setClock(9000);
  harness.env.advanceReplay(dt, harness.context.theater);
  assert.ok(stopFanfareCount >= 1, 'advancing from goal hold to next turn stops looping fanfare');

  // Export video calls stopFanfare in finally and zeroes offscreen canvas dimensions
  stopFanfareCount = 0;
  const createdCanvases = [];
  const origCreateElement = harness.context.document.createElement;
  harness.context.document.createElement = tag => {
    const el = origCreateElement(tag);
    if (tag === 'canvas') createdCanvases.push(el);
    return el;
  };
  await harness.env.exportVideo(harness.env.exportSlice('turn', false));
  assert.ok(stopFanfareCount >= 1, 'exportVideo finally stops fanfare');
  assert.ok(createdCanvases.length >= 3 && createdCanvases.every(c => c.width === 0 && c.height === 0), 'exportVideo finally releases offscreen canvas backing stores');
});

test('D4-05, D4-08, D4-01: online onState preserves local roster, prevents mid-replay score regression, and ends stale goalReplay on fresh resolving turn', () => {
  const P = require('../web/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ububallReplay = require('../shared/ububall-replay.js');
  const onStateCode = section('function onlineNames(s) {', "});\n  $('online-rematch').onclick")
    .replace('online = ububallOnline({', 'const onlineCallbacks = ({') + '});';
  const code =
    section('let lastSaved = Promise.resolve(null);', 'const replayClock =') + '\n' +
    section('let guide = null;', 'function playFromHere() {') + '\n' +
    section('const PRESENTATION_KEYS =', 'function onlineNames(s) {') + '\n' +
    onStateCode;

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
    Object, Array, Set, Math, Number, String, Boolean, JSON, Promise, console,
    addEventListener: dummy,
    P, ubu, ububallMatch, ububallReplay, structuredClone, performance: { now: () => nowMs },
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

  const env = runInNewContext(
    code + '\n;({ onlineCallbacks, playOnlineReplay });',
    context
  );

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

  const makeHarness = ({ isActivity }) => {
    elements.clear();
    listeners.clear();
    fetchCalls.length = 0;
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
      WebSocket: Object.assign(function() { this.close = () => {}; this.send = () => {}; }, { OPEN: 1 }),
      navigator: { clipboard: { writeText: async () => {} } },
      matchMedia: () => ({ matches: false }),
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      history: { state: null, replaceState(_s, _t, url) { currentUrl = String(url); win.location = new URL(currentUrl); } },
      location: win.location,
      window: win,
      ububallMatch: { modeName: m => m },
      gameUi: { confirm: async () => true },
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
    let playCpuAwaited = false;
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
      onLeave() {}
    };
    return { client: ububallOnline(hooks), getEl, listeners, fetchCalls, getUrl: () => currentUrl };
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
});

test('D4-11, D4-16, D4-17, D4-18, D4-20, D2-10, D4-02: UI icon/grid rules, clearEffects scrub cooldown reset, null-winner attribution, and cross-domain contracts', () => {
  const P = require('../web/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const presSrc = fs.readFileSync(require.resolve('../web/ububall-presentation.js'), 'utf8');
  const cssSrc = fs.readFileSync(require.resolve('../web/ububall.css'), 'utf8');

  // 1. D4-11: Zero emoji/text-arrow icons in ububall.js and ububall-presentation.js
  assert.equal(source.includes('💫'), false, 'ububall.js has no 💫 emoji icon');
  assert.equal(presSrc.includes('💫'), false, 'ububall-presentation.js has no 💫 emoji icon');
  assert.equal(source.includes("'→'"), false, 'ububall.js has no raw → text icon');
  assert.match(source, /gameUi\.icon\('arrow-narrow-right'\)/, 'stats event log uses Tabler arrow-narrow-right icon');

  // 2. D4-11, D4-16, D4-20: CSS rules verified
  assert.match(cssSrc, /\.roster-grid\s*\{\s*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(max\(7rem,\s*calc\(\(100%\s*-\s*1\.625rem\)\s*\/\s*4\)\),\s*1fr\)\)/, '.roster-grid caps choices at <= 4 per row');
  assert.match(cssSrc, /\.pause-menu :is\(\.pause-heading, \.pause-links\)/, 'landscape phone pause menu spans .pause-heading across full row');
  assert.match(cssSrc, /#super-ready-hint:not\(\[hidden\]\)\s*\{\s*position:\s*absolute;/, '#super-ready-hint floats without resizing stadium');
  assert.match(cssSrc, /\.lobby-status:not\(\[hidden\]\)\s*\{\s*position:\s*absolute;/, '#lobby-status overlays without shifting formation');
  for (const dead of ['.super-picker-grid', '.super-picker-btn', '.super-arm-btn', '.super-select', '.stunned-badge', '#match-mode']) {
    assert.equal(cssSrc.includes(dead), false, `dead CSS selector ${dead} removed`);
  }

  // 3. D4-17: clearEffects resets cooldown maps & _lastWallSound/_lastHitSound so rewound seek clocks still emit VFX
  let clock = 5000;
  const bodies = P.kickoff();
  const fx = createEffectsState([], {});
  const presenter = createRinkPresenter({
    P, ububallMatch,
    getView: () => ({ bodies, mode: 'standard', canvas: { width: 1000, height: 600 }, ctx: {}, badgeCanvas: { width: 1000, height: 600 }, badgeCtx: {} }),
    getEffects: () => fx,
    isReducedMotion: () => false,
    clockNow: () => clock,
    gameAudio: () => null
  });
  presenter.handleWall(bodies[6], 350, 'post', 1, 0, false);
  presenter.handleSuper('stalwart', 'impact', bodies[0], bodies[3]);
  assert.ok(bodies[6]._lastWallSound === 5000);
  assert.ok(fx.particles.length > 0);

  // Rewind clock (as seekReplay does) after clearEffects() -> wall sparks & stalwart shockwaves still fire!
  presenter.clearEffects();
  assert.equal('_lastWallSound' in bodies[6], false, 'clearEffects deletes _lastWallSound');
  clock = 4600;
  presenter.handleWall(bodies[6], 350, 'post', 1, 0, false);
  assert.ok(fx.particles.length > 0, 'post sparks fire cleanly after backward clock seek');
  presenter.handleSuper('stalwart', 'impact', bodies[0], bodies[3]);
  assert.equal(fx.shockwaves.length, 1, 'stalwart shockwave fires cleanly after backward clock seek');

  // 4. D4-18: openSummary handles online.state.winner === null without awarding win to Team 1
  {
    const summaryCode = section('function closeSummary() {', '// A save from a ball');
    const summaryEls = new Map();
    const $ = id => {
      if (!summaryEls.has(id)) summaryEls.set(id, { textContent: '', hidden: false, open: false, showModal() { this.open = true; }, close() {} });
      return summaryEls.get(id);
    };
    $('home-label').textContent = 'Alice';
    $('opponent-label').textContent = 'Bob';
    const env = runInNewContext(summaryCode + '\n;({ openSummary });', {
      $, demo: false, scores: [2, 2],
      online: { state: { winner: null, seat: 0, spectator: false, left: [false, true], game: { winner: null } } },
      viewTally: () => ({ tally: ububallMatch.newTally(), scores: [2, 2] }),
      ububallMatch,
      matchMvp: () => null,
      updateRematch: () => {}
    });
    env.openSummary();
    assert.equal($('summary-winner').textContent, 'Match ended', 'null winner does not declare opponent winner');
  }

  // 5. D2-10 & D4-02: prepareCPU passes clock/roundTurns/play fields, and setUbuScreenGuard is registered
  {
    const prepCode = section('function prepareCPU(initialPlans = null) {', '// Big announcements over the rink.');
    let receivedState = null;
    const play = ububallMatch.newPlay({ age: 42, last: 1, lastTouch: [1, null], banked: true });
    const env = runInNewContext(prepCode + '\n;({ prepareCPU });', {
      Array, console,
      cpuGeneration: 0, cpuDone: false, cpu: [], cpuReady: null,
      online: null, demo: false, demoLevels: ['medium', 'hard'], cpuLevel: 'hard',
      P, ububallMatch, simBodies: P.kickoff(), stats: [], scores: [2, 1], turn: 4,
      fouls: ububallMatch.newFouls(), matchMode: 'pulse', matchTicks: 480, roundTurns: 2, play,
      phase: 'plan', saveActiveMatch: () => {},
      cpuClient: {
        cancel() {},
        plan(state) { receivedState = state; return Promise.resolve({ plans: P.cpuPlans(P.kickoff(), () => 0.5, [0, 0]) }); }
      }
    });
    env.prepareCPU();
    assert.equal(receivedState.clock, 480, 'D2-10: prepareCPU passes matchTicks as clock');
    assert.equal(receivedState.roundTurns, 2, 'D2-10: prepareCPU passes roundTurns');
    assert.equal(receivedState.age, 42, 'D2-10: prepareCPU spreads play state');
    assert.equal(receivedState.last, 1);
    assert.equal(receivedState.banked, true);
  }
  assert.match(source, /window\.setUbuScreenGuard/, 'D4-02: ububall.js registers window.setUbuScreenGuard');
  assert.match(source, /cpuClient\.dispose\?\.\(\)/, 'D2-10: ububall.js disposes cpuClient worker');
  assert.match(source, /demoClient\.dispose\?\.\(\)/, 'D2-10: ububall.js disposes demoClient worker');
});
