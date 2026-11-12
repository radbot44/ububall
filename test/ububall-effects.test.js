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
  const P = require('../shared/ububall-physics.js');
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
  const P = { ...require('../shared/ububall-physics.js'), step() { steps++; return null; } };
  const ububallMatch = require('../shared/ububall-match.js');
  const presenter = createRinkPresenter({ P, ububallMatch, getView: () => ({ bodies }), getEffects: () => createEffectsState([], {}) });
  presenter.goalThreat();
  assert.equal(steps, 0);
  ball.omega = 24;
  presenter.goalThreat();
  assert.ok(steps > 0, 'curved ball was incorrectly rejected');
});

function trailHarness() {
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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

test('heat effect animation time accumulates during updateEffects and freezes during Pulse mode freeze frames', () => {
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const fx = createEffectsState([], {});
  assert.equal(fx.heatTime, 0, 'heatTime initializes to 0');

  const bodies = P.kickoff();
  const presenter = createRinkPresenter({
    P, ububallMatch,
    getView: () => ({ bodies, mode: 'pulse', canvas: { width: 1000, height: 600 }, ctx: {}, badgeCanvas: { width: 1000, height: 600 }, badgeCtx: {} }),
    getEffects: () => fx,
    isReducedMotion: () => false,
    clockNow: () => 1000,
    gameAudio: () => null
  });

  // 1. Simulation advances effects
  presenter.updateEffects(0.016);
  assert.equal(Number(fx.heatTime.toFixed(4)), 0.0160, 'heatTime advances by dt');
  presenter.updateEffects(0.016);
  assert.equal(Number(fx.heatTime.toFixed(4)), 0.0320, 'heatTime accumulates across frames');

  // 2. Pulse mode freeze frames (or paused time) do not advance heatTime
  presenter.updateEffects(0);
  assert.equal(Number(fx.heatTime.toFixed(4)), 0.0320, 'heatTime does not advance with 0 dt');

  // 3. Clear effects resets heatTime
  presenter.clearEffects();
  assert.equal(fx.heatTime, 0, 'clearEffects resets heatTime to 0');
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
  const P = require('../shared/ububall-physics.js');
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
    foulInfo: null, online: null, shot: 'match', demo: false, phase: 'plan', matchMode: 'blitz', blitzMode: () => true,
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
  now = 15600; context.shot = 'home'; refresh();
  now = 19600; context.shot = 'match'; refresh();
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
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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
    shot: 'home',
    document: {
      body: {
        dataset: { shot: 'home' },
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

  const env = runInNewContext(
    code + '\n;({ watchReplay, endReplay, playFromHere, onGuestTeam, newMatch });',
    context
  );

  // 1. watchReplay assigns replay-* keys, enters replay shot, and preserves full superMastery metadata
  env.watchReplay(rec, null);
  assert.equal(context.shot, 'replay');
  assert.equal(context.document.body.dataset.shot, 'replay');
  assert.equal(context.teamEntries[0].key, 'replay-0');
  assert.ok(context.teamEntries[0].equippedSuper.bonusTicks > 0, 'watchReplay preserves superMastery bonusTicks');
  assert.ok(context.teamEntries[0].equippedSuper.copies >= 2, 'watchReplay preserves superMastery copies');

  // 2. playFromHere switches from replay shot to match shot, keeps replay-* keys, and applies mastery bonuses
  env.playFromHere();
  assert.equal(context.shot, 'match');
  assert.equal(context.document.body.dataset.shot, 'match');
  assert.equal(context.roster[0].key, 'replay-0');
  assert.equal(env.onGuestTeam(), false, 'onGuestTeam returns false cleanly without TypeError');
  assert.ok(context.simBodies[0].superBonusTicks > 0, 'playFromHere preserves superBonusTicks on simBodies');
  assert.ok(context.simBodies[0].equippedSuper.bonusTicks > 0, 'playFromHere preserves equippedSuper.bonusTicks');

  // 3. endReplay clears replay state cleanly without starting an unrequested phantom CPU match
  env.watchReplay(rec, null);
  env.endReplay();
  assert.equal(context.theater, null);
  assert.equal(context.phase, 'over', 'endReplay leaves phase === over so exitMatchMode resumes Home demo');
  assert.equal(context.recording, null, 'endReplay does not create a phantom CPU match recording');
  assert.equal(newMatchCalls, 0);

  // 4. Starting newMatch while replay viewer is active clears theater and switches replay shot to match shot (D4-03)
  env.watchReplay(rec, null);
  assert.ok(context.theater);
  assert.equal(context.shot, 'replay');
  env.newMatch();
  assert.equal(context.theater, null, 'newMatch clears active theater');
  assert.equal(context.shot, 'match', 'newMatch folds replay shot into match shot');
  assert.equal(context.document.body.dataset.shot, 'match');
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
  const P = require('../shared/ububall-physics.js');
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
  const P = require('../shared/ububall-physics.js');
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



test('Rink stage Phase 2: shots fold in-match/replay-match/setup-shot, camera guards input/overlays, setup docks mid-match, and CPU match leaves/resumes cleanly', () => {
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const cssSrc = fs.readFileSync(require.resolve('../web/ububall.css'), 'utf8');
  const htmlSrc = fs.readFileSync(require.resolve('../web/index.html'), 'utf8');
  const siteSrc = fs.readFileSync(require.resolve('../web/site.js'), 'utf8');

  // 1. Legacy layout classes/booleans are completely folded into data-shot
  for (const legacy of ['in-match', 'replay-match', 'setup-shot']) {
    assert.equal(source.includes(legacy), false, `ububall.js must not use ${legacy}`);
    assert.equal(cssSrc.includes(legacy), false, `ububall.css must not use ${legacy}`);
    assert.equal(siteSrc.includes(legacy), false, `site.js must not use ${legacy}`);
  }
  assert.equal(source.includes('inMatch'), false, 'ububall.js replaces inMatch with shot state');
  assert.equal(source.includes('setupShot'), false, 'ububall.js replaces setupShot with shot state');
  assert.match(htmlSrc, /<body data-shot="home">/, 'index.html boots on the home shot');
  for (const shotName of ['home', 'rules', 'team', 'match', 'replay']) {
    assert.ok(cssSrc.includes(`[data-shot="${shotName}"]`), `ububall.css defines layout rules for ${shotName} shot`);
  }

  // 2. Exercise setShot, camera move gating (Invariant 2), mid-match docked setup, portrait restore, online lobby handoff, and CPU leave/resume
  const stageCode =
    section('  let cast = null, shot =', '  // While a video export renders') + '\n' +
    section('  function updateFoulInfo() {', '  function kickoff(isNewMatch = false) {') + '\n' +
    section('  function updateFirstTurnGuide() {', '  function prepareCPU(initialPlans = null) {') + '\n' +
    section('  function positionSpinControl() {', '  function fitStadium() {') + '\n' +
    section('  let cameraMove = null;', '  // The cast: whoever is on the ice') + '\n' +
    section('  fieldView.canvas.addEventListener(\'wheel\'', '  function endCanvasDrag() {') + '\n' +
    section('  function updateReplaySkip(replay) {', '  replaySkip.onclick =') + '\n' +
    section('  function setupStep(step) {', '  function openSetup(step,') + '\n' +
    section('  function closeLobby() {', '  // In Discord, Ready to play') + '\n' +
    section('  function syncFullscreenButton() {', '  async function exitOwnedFullscreen() {') + '\n' +
    section('  function fitOrientation() {', '  function openPause() {');

  const listeners = new Map();
  const makeClassList = () => {
    const set = new Set();
    return {
      add: c => set.add(c),
      remove: c => set.delete(c),
      toggle: (c, on) => {
        const next = on === undefined ? !set.has(c) : Boolean(on);
        if (next) set.add(c); else set.delete(c);
        return next;
      },
      contains: c => set.has(c)
    };
  };
  let rectByShot = {
    home: { left: 40, top: 80, width: 640, height: 384 },
    rules: { left: 24, top: 72, width: 1100, height: 660 },
    team: { left: 24, top: 72, width: 1100, height: 660 },
    match: { left: 220, top: 64, width: 960, height: 576 },
    replay: { left: 220, top: 64, width: 960, height: 576 }
  };
  let activeAnim = null;
  const elements = new Map();
  const makeEl = id => {
    const el = {
      id, hidden: false, disabled: false, inert: false, open: false, value: '', textContent: '',
      dataset: {}, style: { visibility: '', cursor: '', setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
      classList: makeClassList(),
      children: [],
      get childElementCount() { return this.children.length; },
      get firstElementChild() { return this.children[0] || { hidden: false, textContent: '' }; },
      append(...nodes) { this.children.push(...nodes); },
      before() {},
      replaceChildren(...nodes) { this.children = [...nodes]; },
      setAttribute(k, v) { this[k] = v; },
      removeAttribute(k) { delete this[k]; },
      toggleAttribute(k, on) { if (on) this[k] = ''; else delete this[k]; },
      querySelector: () => ({ textContent: '', replaceChildren() {}, removeAttribute() {}, setAttribute() {}, classList: makeClassList() }),
      addEventListener(type, fn) { listeners.set(`${id}:${type}`, fn); },
      dispatchEvent() { return true; },
      show() { this.open = true; },
      showModal() { this.open = true; },
      close() {
        if (!this.open) return;
        this.open = false;
        listeners.get(`${id}:close`)?.();
      },
      setPointerCapture() {},
      getBoundingClientRect: () => ({ top: 72, left: 0, width: 1000, height: 600 })
    };
    return el;
  };
  const $ = id => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };
  $('skip-goal-replay').append(makeEl('skip-badge'));

  const rinkCanvas = makeEl('rink');
  const rinkStage = {
    classList: makeClassList(),
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    getBoundingClientRect: () => rectByShot[ctx.document.body.dataset.shot] || rectByShot.home,
    animate(keyframes, opts) {
      const anim = { keyframes, opts, cancelled: false, onfinish: null, cancel() { this.cancelled = true; } };
      activeAnim = anim;
      return anim;
    }
  };
  const stadium = { classList: makeClassList() };
  const rinkWrap = { classList: makeClassList() };
  const foulBox = makeEl('foul-box');
  let castArgs = [], demoStarts = 0, stoppedFanfares = 0, stoppedMotions = 0, pushedStates = 0, wheelSpins = 0;

  const ctx = {
    Object, Array, Set, Map, Math, Number, String, Boolean, JSON, URL, Event: class { constructor(t) { this.type = t; } },
    P, ububallMatch, performance: { now: () => 5000 },
    $,
    canvas: rinkCanvas,
    inDiscord: false,
    location: new URL('https://ububall.com/'),
    scrollY: 0,
    scrollTo() {},
    addEventListener() {},
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    reducedMotion: { matches: false },
    portraitScreen: { matches: false },
    ownsFullscreen: () => false,
    fullscreenDisplay: { matches: false },
    fullscreenRequest: null,
    btnFullscreen: makeEl('btn-fullscreen'),
    exitOwnedFullscreen: async () => {},
    fitScorebug() {},
    setPortrait(val) { ctx.isPortrait = val; },
    isPortrait: false,
    videoField: null,
    bodies: P.kickoff(),
    simBodies: P.kickoff(),
    plans: [{ angle: 0, power: 0, spin: 0, guard: false }, { angle: 0, power: 0, spin: 0, guard: false }, { angle: 0, power: 0, spin: 0, guard: false }],
    selected: 0,
    drag: null,
    dragMode: null,
    dragStart: null,
    dragStartClient: null,
    dragMoved: false,
    dragDirty: false,
    arrowGrab: null,
    endCanvasDrag() { ctx.drag = null; },
    point: e => ({ x: e.clientX, y: e.clientY }),
    fieldTarget: () => ({ mode: 'aim', index: 0 }),
    warningAt: () => null,
    wheelKnob() { wheelSpins++; },
    sync() {},
    spinSlider: true,
    phase: 'plan',
    demo: false,
    online: null,
    theater: null,
    recording: { turns: [{}] },
    goalReplay: { loops: 2, started: 0, elapsedMs: 4000 },
    replaySkip: $('skip-goal-replay'),
    replaySkipHint: $('skip-goal-replay').firstElementChild,
    firstTurnStep: 'aim',
    firstTurnStarted: null,
    pullBehind: false,
    aimPower: () => 0.5,
    impulseGeometry: () => ({ visible: true, ringR: 25, distance: 80, x: 260, y: 300, scale: 120 }),
    placeFinger() {},
    hideFinger() {},
    fieldBox: { left: 0, top: 0, width: 960, height: 576, stageWidth: 960, stageHeight: 576, controlWidth: 140, controlHeight: 44 },
    stagePoint: p => ({ x: p.x, y: p.y }),
    foulInfo: { kind: 'crease', team: 0 },
    foulInfoKey: '',
    foulBox,
    fouls: { crease: [true, false], corner: null, cornerTurns: 0, cards: [] },
    stalling: () => false,
    foulInfoLines: () => ['Goal camping', [{ text: 'Move out', act: true }]],
    gameUi: { scale: () => 1 },
    layoutDirty: false,
    draw() {
      ctx.layoutDirty = false;
      env.positionSpinControl();
      env.updateFoulInfo();
    },
    castTo: away => { castArgs.push(away); },
    castHome() {},
    lobbyGeneration: 0,
    setupFor: 'cpu',
    chosenMode: () => 'standard',
    draft: [{ key: 'g-0', model: {} }, { key: 'g-1', model: {} }, { key: 'g-2', model: {} }],
    signedIn: () => false,
    teamSlotsOf: () => null,
    sameSlots: () => false,
    savedTeams: null,
    teamIndex: -1,
    ubuRender: Object.assign(() => makeEl('svg'), { spriteImg: () => makeEl('img') }),
    lobbyView: null,
    fixedTeam: () => true,
    loadCollection: async () => {},
    loadTeams: async () => {},
    rosterSlots() { $('roster-slots').replaceChildren(makeEl('s0'), makeEl('s1'), makeEl('s2')); },
    lastCpuSetup: null,
    closeFirstTurnGuide() { ctx.firstTurnStep = null; $('first-turn-guide').hidden = true; },
    closeFoulInfo() { ctx.foulInfo = null; foulBox.hidden = true; },
    closeSummary() { $('match-summary').open = false; },
    stopFanfare() { stoppedFanfares++; },
    gameAudio: () => ({ getAudioContext() {}, stopMotion() { stoppedMotions++; } }),
    isExporting: () => false,
    statDrawer: { matches: () => false, hidePopover() {} },
    endReplay() { ctx.theater = null; },
    cpuClient: { dispose() {} },
    demoClient: { dispose() {} },
    startDemo() { if (!ctx.demo && env.getShot() === 'home' && !env.matchInProgress()) { ctx.demo = true; demoStarts++; } },
    stopDemo() { ctx.demo = false; },
    newMatch() {},
    history: { state: null, pushState(s) { this.state = s; pushedStates++; }, replaceState() {} },
    stadium,
    rinkStage,
    rinkWrap,
    document: {
      hidden: false,
      fullscreenElement: null,
      fullscreenEnabled: true,
      addEventListener() {},
      createElement: tag => makeEl(tag),
      body: { dataset: { shot: 'home' }, style: { setProperty(k, v) { this[k] = v; } }, classList: makeClassList() },
      querySelector: sel => sel === '.ball-page' ? { getBoundingClientRect: () => ({ top: 72 }) } : null
    }
  };

  const env = runInNewContext(
    stageCode + '\n;({ getShot: () => shot, setShot, playableShot, enterMatch, exitMatchMode, prepareSheet, openSheet, setupStep, closeLobby, leaveSetupShot, matchInProgress, positionSpinControl, updateFirstTurnGuide, updateFoulInfo });',
    ctx
  );

  // A. Entering match glides from home -> match; during cameraMove, playableShot is false, aiming input is ignored, and overlays stay hidden
  env.enterMatch('match');
  assert.equal(env.getShot(), 'match');
  assert.equal(ctx.document.body.dataset.shot, 'match');
  assert.equal(pushedStates, 1);
  assert.ok(activeAnim && !activeAnim.cancelled, 'camera starts transform glide from home to match');
  assert.equal(env.playableShot(), false, 'rink rejects aiming input while cameraMove is in flight');
  assert.equal($('field-spin').style.visibility, 'hidden', 'spin slider stays hidden during camera glide');
  assert.equal($('first-turn-guide').hidden, true, 'first-turn guide waits until camera rests');
  assert.equal(foulBox.hidden, true, 'foul box hides during camera glide');

  ctx.foulInfo = null;
  rinkCanvas.onpointerdown({ pointerType: 'mouse', button: 0, pointerId: 1, clientX: 180, clientY: 300 });
  listeners.get('rink:wheel')({ ctrlKey: false });
  assert.equal(ctx.drag, null, 'pointerdown aiming rejected while camera is moving');
  assert.equal(wheelSpins, 0, 'wheel spin rejected while camera is moving');

  // Finish camera move -> playableShot becomes true, overlays appear, and aiming input works
  ctx.foulInfo = { kind: 'crease', team: 0 };
  activeAnim.onfinish();
  assert.equal(env.playableShot(), true, 'rink accepts aiming input once camera rests in match shot');
  assert.equal($('field-spin').style.visibility, 'visible', 'spin slider appears once camera rests');
  assert.equal($('first-turn-guide').hidden, false, 'first-turn guide appears once camera rests');
  assert.equal(foulBox.hidden, false, 'foul box appears once camera rests');
  assert.equal($('skip-goal-replay').hidden, false, 'goal replay skip prompt visible in match shot');

  ctx.foulInfo = null;
  rinkCanvas.onpointerdown({ pointerType: 'mouse', button: 0, pointerId: 7, clientX: 180, clientY: 300 });
  assert.equal(ctx.drag, 7, 'pointerdown aiming accepted at rest in match shot');
  ctx.drag = null;
  listeners.get('rink:wheel')({ ctrlKey: false });
  assert.equal(wheelSpins, 1, 'wheel spin accepted at rest in match shot');

  // B. Mid-match Pause -> New match docks sheet in rules shot (forcing landscape), closes pause menu, scatters cast, and cancelling restores match + portrait
  $('pause-menu').open = true;
  ctx.isPortrait = true; // Manually rotated to portrait during match
  castArgs = [];
  env.prepareSheet();
  env.setupStep('mode');
  env.openSheet();
  assert.equal($('pause-menu').open, false, 'docked mid-match setup closes modal pause menu');
  assert.equal($('roster-dialog').classList.contains('docked'), true, 'sheet docks during match on wide desktop');
  assert.equal(env.getShot(), 'rules');
  assert.equal(ctx.document.body.dataset.shot, 'rules');
  assert.equal(ctx.isPortrait, false, 'setup shot always uses landscape rink');
  assert.deepEqual(castArgs, [true], 'current match cast scatters off the ice');
  assert.equal($('skip-goal-replay').hidden, true, 'goal replay skip prompt hides outside match shot');

  // Step from rules -> team updates shot to team
  env.setupStep('team');
  assert.equal(env.getShot(), 'team');
  assert.equal(ctx.document.body.dataset.shot, 'team');

  // Cancel/close docked sheet -> returns to match shot (not home!), restores portrait, and skates match cast back
  $('roster-dialog').close();
  assert.equal(env.getShot(), 'match', 'cancelling mid-match setup returns to match shot');
  assert.equal(ctx.document.body.dataset.shot, 'match');
  assert.equal(ctx.isPortrait, true, 'cancelling mid-match setup restores previous match portrait orientation');
  assert.deepEqual(castArgs, [true, false], 'match cast skates back onto the ice');
  ctx.isPortrait = false;

  // C. Online lobby handoff -> closeLobby when game starts transitions directly from team -> match without bouncing through home
  ctx.setupFor = 'lobby';
  $('roster-dialog').dataset.for = 'lobby';
  ctx.lobbyView = { state: { mode: 'standard', canChangeRules: false }, ready: true };
  env.prepareSheet();
  env.setupStep('team');
  env.openSheet();
  assert.equal(env.getShot(), 'team');
  ctx.online = { active: true, state: { phase: 'plan', game: { bodies: P.kickoff() } } };
  env.closeLobby();
  assert.equal(env.getShot(), 'team', 'closeLobby holds team shot for synchronous enterMatch handoff instead of bouncing to home');
  env.enterMatch('match');
  assert.equal(env.getShot(), 'match');
  ctx.online = null;

  // D. Leaving CPU match for Home preserves match state, stops audio, hides skip button, and does not start demo
  if (activeAnim && !activeAnim.cancelled) activeAnim.onfinish();
  ctx.firstTurnStep = 'aim';
  ctx.foulInfo = { kind: 'crease', team: 0 };
  env.exitMatchMode();
  assert.equal(env.getShot(), 'home');
  assert.equal(ctx.document.body.dataset.shot, 'home');
  assert.equal(env.matchInProgress(), true, 'CPU match stays in progress when left for home');
  assert.equal(demoStarts, 0, 'leaving an active CPU match never starts demo over it');
  assert.equal($('home-play-label').textContent, 'Resume match');
  assert.equal($('home-end-match').hidden, false);
  assert.ok(stoppedFanfares >= 1 && stoppedMotions >= 1, 'looping fanfare and motion audio stop on leaving match');
  assert.equal($('skip-goal-replay').hidden, true, 'goal replay skip overlay stays hidden on home');

  // Resuming CPU match returns cleanly to match shot
  env.enterMatch('match');
  assert.equal(env.getShot(), 'match');
  if (activeAnim && !activeAnim.cancelled) activeAnim.onfinish();
  assert.equal(env.playableShot(), true);

  // Ending CPU match and exiting starts demo and resets Home CTA
  ctx.phase = 'over';
  ctx.recording = null;
  env.exitMatchMode();
  assert.equal(env.getShot(), 'home');
  assert.equal(demoStarts, 1, 'demo starts once no CPU match is in progress');
  assert.equal($('home-play-label').textContent, 'Quick play');
  assert.equal($('home-end-match').hidden, true);
});


test('Rink stage Phase 3: persistent stage shell, Mint lighting & spotlights, on-ice pack reveal choreography, and signup pack handoff', async () => {
  const crypto = require('node:crypto');
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ubu = require('../shared/ubu.js');
  const ubuFile = require('../shared/ubu-file.js');
  const rarity = require('../shared/rarity.js');
  const ubuArchetype = require('../shared/ubu-archetype.js');
  const cssSrc = fs.readFileSync(require.resolve('../web/ububall.css'), 'utf8');
  const siteCssSrc = fs.readFileSync(require.resolve('../web/site.css'), 'utf8');
  const htmlSrc = fs.readFileSync(require.resolve('../web/index.html'), 'utf8');
  const siteSrc = fs.readFileSync(require.resolve('../web/site.js'), 'utf8');

  // 1. Structural & CSS invariants: persistent .arena-layout outside [data-screen], old #reveal modal removed, mint/collection shots defined
  assert.equal(htmlSrc.includes('<dialog id="reveal"'), false, 'modal #reveal dialog replaced outright by #mint-reveal on stage');
  assert.equal(siteCssSrc.includes('#reveal {'), false, 'obsolete #reveal modal styles removed');
  assert.match(htmlSrc, /id="mint-world"/, 'index.html mounts #mint-world inside .rink-stage');
  assert.match(htmlSrc, /id="mint-lights"/, 'index.html mounts #mint-lights spotlight canvas');
  assert.match(htmlSrc, /id="mint-ubus"/, 'index.html mounts #mint-ubus actor layer');
  assert.match(htmlSrc, /id="mint-reveal"/, 'index.html mounts #mint-reveal stage overlay');
  assert.match(htmlSrc, /id="signup-stage-pack"/, 'index.html mounts #signup-stage-pack for Home signup handoff');
  const playBlock = htmlSrc.slice(htmlSrc.indexOf('<main data-screen="play">'), htmlSrc.indexOf('</main>'));
  assert.equal(playBlock.includes('class="arena-layout"'), false, '.arena-layout lives outside <main data-screen="play"> so screen changes never hide the rink');
  assert.ok(cssSrc.includes('[data-shot="mint"]'), 'ububall.css defines mint shot layout');
  assert.ok(cssSrc.includes('[data-shot="collection"]'), 'ububall.css defines collection shot rule');

  // 2. Stage screen transitions (Home <-> Mint): FLIP camera move, castTo(true/false), ubuStageReady(), and demo pause
  const stageSlice =
    section('  let cast = null, shot =', '  // While a video export renders') + '\n' +
    section('  function localPlayBlocked() {', '  function updateLocalPlanClock(') + '\n' +
    section('  function updateFoulInfo() {', '  function kickoff(isNewMatch = false) {') + '\n' +
    section('  function updateFirstTurnGuide() {', '  function prepareCPU(initialPlans = null) {') + '\n' +
    section('  function positionSpinControl() {', '  function fitStadium() {') + '\n' +
    section('  let cameraMove = null;', '  // The cast: whoever is on the ice') + '\n' +
    section('  function updateReplaySkip(replay) {', '  replaySkip.onclick =') + '\n' +
    section('  function syncFullscreenButton() {', '  async function exitOwnedFullscreen() {') + '\n' +
    section('  function fitOrientation() {', '  function openPause() {') + '\n' +
    section('  function leavePlayOverlays() {', '  const screenGuard =') + '\n' +
    section('  function demoPaused() {', '  // Waits count only while');

  const makeClassList = () => {
    const set = new Set();
    return {
      add: c => set.add(c),
      remove: c => set.delete(c),
      toggle: (c, on) => { const next = on === undefined ? !set.has(c) : Boolean(on); if (next) set.add(c); else set.delete(c); return next; },
      contains: c => set.has(c)
    };
  };
  const rectByShot = {
    home: { left: 40, top: 80, width: 640, height: 384 },
    mint: { left: 160, top: 120, width: 1120, height: 672 },
    collection: { left: 0, top: 0, width: 0, height: 0 }
  };
  let activeAnim = null, castCalls = [], beforeEvents = [], domFlips = 0;
  const stageEls = new Map();
  const getStageEl = id => {
    if (!stageEls.has(id)) {
      stageEls.set(id, {
        id, hidden: false, open: false, inert: false,
        style: { visibility: '', setProperty(k, v) { this[k] = v; } },
        classList: makeClassList(),
        children: [],
        get firstElementChild() { return { textContent: '' }; },
        replaceChildren() { this.children = []; }, setAttribute() {},
        close() { this.open = false; }
      });
    }
    return stageEls.get(id);
  };
  const mockWin = {
    dispatchEvent(ev) { beforeEvents.push(ev.detail); }
  };
  const stageCtx = {
    Object, Array, Set, Map, Math, Number, String, Boolean, Promise, URL,
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    window: mockWin,
    P, ububallMatch,
    $: getStageEl,
    inDiscord: false,
    location: { pathname: '/' },
    scrollY: 0,
    scrollTo() {},
    reducedMotion: { matches: false },
    portraitScreen: { matches: false },
    ownsFullscreen: () => false,
    fullscreenDisplay: { matches: false },
    fullscreenRequest: null,
    btnFullscreen: getStageEl('btn-fullscreen'),
    exitOwnedFullscreen: async () => {},
    fitScorebug() {},
    setPortrait() {},
    fitSetupShot() {},
    endCanvasDrag() {},
    drag: null,
    fieldView: { portrait: false, field: null, bodies: P.kickoff(), mode: 'standard' },
    fieldBox: { left: 0, top: 0, width: 640, height: 384, stageWidth: 640, stageHeight: 384, controlWidth: 120, controlHeight: 32 },
    stagePoint: p => ({ x: p.x, y: p.y }),
    impulseGeometry: b => ({ x: b.x, y: b.y - 40 }),
    gameUi: { scale: () => 1 },
    selected: 0,
    plans: [{ angle: 0, power: 0, spin: 0, guard: false }],
    phase: 'plan',
    spinSlider: false,
    firstTurnStep: null,
    foulInfo: null,
    foulBox: getStageEl('foul-box'),
    goalReplay: null,
    replaySkip: getStageEl('skip-goal-replay'),
    demo: true,
    online: null,
    theater: null,
    recording: null,
    lineupMove: null,
    returnPortrait: false,
    closeFirstTurnGuide() {},
    closeFoulInfo() {},
    closeSummary() {},
    stopFanfare() {},
    gameAudio: () => ({ stopMotion() {} }),
    isExporting: () => false,
    statDrawer: { matches: () => false, hidePopover() {} },
    endReplay() {},
    hideFinger() {},
    matchInProgress: () => false,
    cpuClient: { dispose() {} },
    layoutDirty: false,
    draw() { stageCtx.layoutDirty = false; },
    castTo: away => { castCalls.push(away); },
    stadium: { classList: makeClassList() },
    rinkWrap: { classList: makeClassList() },
    rinkStage: {
      classList: makeClassList(),
      getBoundingClientRect: () => rectByShot[stageCtx.document.body.dataset.shot] || rectByShot.home,
      animate(keyframes, opts) {
        activeAnim = { keyframes, opts, cancelled: false, onfinish: null, cancel() { this.cancelled = true; } };
        return activeAnim;
      }
    },
    document: {
      hidden: false,
      fullscreenElement: null,
      fullscreenEnabled: true,
      body: { dataset: { shot: 'home' }, classList: makeClassList() },
      querySelector: () => null
    }
  };

  const stageEnv = runInNewContext(
    stageSlice + '\n;({ getShot: () => shot, screenTransition, localPlayBlocked, demoPaused });',
    stageCtx
  );

  assert.equal(stageEnv.getShot(), 'home');
  assert.equal(stageEnv.localPlayBlocked(), false, 'demo runs unblocked on home shot');
  assert.equal(stageEnv.demoPaused(), false, 'demo walkthrough active on home shot');

  // Transition play -> mint: camera glides, ubuStageReady waits for finish, skaters scatter, demo pauses
  stageCtx.location.pathname = '/mint';
  stageEnv.screenTransition('mint', () => { domFlips++; }, 'play');
  assert.equal(domFlips, 1, 'DOM screen visibility flips inside atomic camera callback');
  assert.equal(stageEnv.getShot(), 'mint');
  assert.equal(stageCtx.document.body.dataset.shot, 'mint');
  assert.deepEqual(beforeEvents, ['mint']);
  assert.deepEqual(castCalls, [true], 'skaters scatter off the ice on entering Mint');
  assert.equal(stageEnv.localPlayBlocked(), true, 'demo physics pause on Mint shot');
  assert.equal(stageEnv.demoPaused(), true, 'demo planner pauses on Mint shot');

  let stageReadySettled = false;
  mockWin.ubuStageReady().then(() => { stageReadySettled = true; });
  await Promise.resolve();
  assert.equal(stageReadySettled, false, 'ubuStageReady stays pending while camera glide is in flight');
  activeAnim.onfinish();
  await Promise.resolve();
  assert.equal(stageReadySettled, true, 'ubuStageReady resolves once camera glide finishes');

  // Transition mint -> play: camera glides back to home, skaters return, demo unpauses
  stageCtx.location.pathname = '/';
  stageEnv.screenTransition('play', () => { domFlips++; }, 'mint');
  assert.equal(stageEnv.getShot(), 'home');
  assert.deepEqual(castCalls, [true, false], 'skaters skate back onto the ice on returning to Home');
  assert.equal(stageEnv.localPlayBlocked(), false, 'demo unpauses once back on Home');

  // 3. Full Mint stage choreography in site.js: 3-pack spotlights, swipe & center unwrap, 5 silhouettes, camera zoom/pan reveal, scamper, re-deal & signup handoff
  const { publicKey, privateKey } = await globalThis.crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const pubJwk = await globalThis.crypto.subtle.exportKey('jwk', publicKey);
  const makeCerts = async (n, startSerial) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const dna = crypto.randomBytes(128);
      const code = ubu.toCode(dna);
      const cert = await ubuFile.sign({
        mint: 'AAAAAAAAAAAAAAAAAAAAAA',
        id: crypto.randomBytes(16).toString('base64url'),
        serial: String(startSerial + i).padStart(12, '0'),
        dna: code,
        issuedAt: 1794441600000 + i,
        key: 'k1'
      }, privateKey);
      const model = ubu.decode(dna);
      out.push({ cert, bg: model.attributes.background.hex, tex: model.attributes.background.material > 0 });
    }
    return out;
  };
  const pack5 = await makeCerts(5, 1);
  const pack3 = await makeCerts(3, 50);

  const mintListeners = new Map();
  const winListeners = new Map();
  const storage = new Map();
  const makeDomNode = (tag, id = '') => {
    const node = {
      tagName: tag.toUpperCase(),
      id,
      hidden: false,
      disabled: false,
      inert: false,
      open: false,
      tabIndex: 0,
      textContent: '',
      value: '',
      parentElement: null,
      dataset: {},
      style: {
        setProperty(k, v) { this[k] = String(v); },
        getPropertyValue(k) { return this[k] || ''; }
      },
      classList: makeClassList(),
      children: [],
      get childElementCount() { return this.children.length; },
      get firstChild() { return this.children[0] || null; },
      append(...kids) {
        for (const k of kids) {
          if (k && typeof k === 'object') k.parentElement = this;
          this.children.push(k);
        }
      },
      after(...kids) {
        if (!this.parentElement) return;
        const idx = this.parentElement.children.indexOf(this);
        this.parentElement.children.splice(idx + 1, 0, ...kids);
      },
      replaceChildren(...kids) {
        this.children = [];
        this.append(...kids);
      },
      setAttribute(k, v) { this[k] = String(v); },
      getAttribute(k) { return this[k] ?? null; },
      removeAttribute(k) { delete this[k]; },
      closest(sel) {
        if (sel === '.pack-shop') return packShopNode;
        if (sel === '[hidden]') {
          let cur = this;
          while (cur) { if (cur.hidden) return cur; cur = cur.parentElement; }
        }
        return null;
      },
      querySelector(sel) {
        if (sel === 'button') return this.children.find(c => c?.tagName === 'BUTTON') || makeDomNode('button');
        if (sel === 'canvas') return this.children.find(c => c?.tagName === 'CANVAS') || makeDomNode('canvas');
        if (sel === 'use') return makeDomNode('use');
        return null;
      },
      querySelectorAll() { return []; },
      addEventListener(type, fn) {
        const key = `${id || tag}:${type}`;
        if (!mintListeners.has(key)) mintListeners.set(key, []);
        mintListeners.get(key).push(fn);
        this[`_on_${type}`] = fn;
      },
      click() {
        const ev = { target: this, detail: 1, clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() {} };
        this._on_click?.(ev);
        if (typeof this.onclick === 'function') this.onclick(ev);
      },
      focus() {},
      close() { this.open = false; },
      showModal() { this.open = true; },
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }),
      getContext: () => ({
        clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, save() {}, restore() {},
        translate() {}, scale() {}, moveTo() {}, lineTo() {}, closePath() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        createLinearGradient: () => ({ addColorStop() {} })
      }),
      animate(keyframes, options) {
        node._lastAnim = { keyframes, options };
        return { onfinish: null, oncancel: null, cancel() {} };
      }
    };
    return node;
  };

  const domById = new Map();
  const getMintEl = id => {
    if (!domById.has(id)) domById.set(id, makeDomNode('div', id));
    return domById.get(id);
  };
  const packShopNode = makeDomNode('section', 'pack-shop');
  packShopNode.append(getMintEl('pack-title'), getMintEl('pack-subtitle'));
  for (const starterId of ['daily-pack', 'signup-stage-pack', 'home-pack']) {
    const wrap = getMintEl(starterId);
    const btn = makeDomNode('button', starterId + '-btn');
    btn.append(makeDomNode('canvas', starterId + '-canvas'));
    wrap.append(btn);
  }
  getMintEl('pack-choices').hidden = true;
  getMintEl('mint-world').hidden = true;
  getMintEl('mint-lights');
  getMintEl('mint-ubus').hidden = true;
  getMintEl('mint-reveal').hidden = true;
  const rinkStageDom = makeDomNode('div', 'rink-stage');
  rinkStageDom.getBoundingClientRect = () => ({ left: 100, top: 80, right: 1100, bottom: 680, width: 1000, height: 600 });
  const stageAreaDom = makeDomNode('div', 'stadium-stage-area');

  let unwrapCalls = [], mintCount = 0, navigatedTo = null, stageReadyGate = Promise.resolve();
  let starterState = { signup: false, daily: false };
  let reduceMotion = false, mockNow = 1000;
  const ownedMap = new Map();
  let importedKey = null;

  const mintWin = {
    location: { pathname: '/mint' },
    navigator: { userActivation: { hasBeenActive: true } },
    devicePixelRatio: 1,
    matchMedia: q => ({
      get matches() { return q.includes('reduce') ? reduceMotion : false; },
      addEventListener() {}
    }),
    requestAnimationFrame: () => 1,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {},
    URL, Blob, TextDecoder,
    crypto: globalThis.crypto,
    localStorage: {
      getItem: k => storage.has(k) ? storage.get(k) : null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    dispatchEvent(ev) {
      for (const fn of (winListeners.get(ev.type) || [])) fn(ev);
    },
    navigateUbuScreen: async href => {
      navigatedTo = href;
      mintWin.location.pathname = '/mint';
      mintDoc.body.dataset.shot = 'mint';
      for (const fn of (winListeners.get('ubu:screen') || [])) fn({ detail: 'mint' });
      return true;
    },
    ubuStageReady: () => stageReadyGate,
    getUbuSession: () => ({ owner: 'acct-1', csrf: 'csrf-tok' }),
    gameUi: {
      icon: name => makeDomNode('svg', 'icon-' + name),
      confirm: async () => false
    },
    ubu, ubuFile, rarity, ubuArchetype, ububallPhysics: P,
    ubuRender: Object.assign(() => makeDomNode('svg'), {
      back: () => makeDomNode('svg'),
      cardMaterials: () => makeDomNode('div'),
      token: () => makeDomNode('svg'),
      tokenBack: () => makeDomNode('svg')
    }),
    ubuAudio: {
      getAudioContext: () => null,
      parseVoiceInfo: () => ({ instrument: 'Sine', rootName: 'C4', rootFreq: 261.6, scale: 'Major', tempoBpm: 120, groove: 'Straight', grooveIndex: 0, notes: [{ midi: 60, name: 'C4', beats: 1, degree: 0, isRest: false }] }),
      playPack() {},
      stop() {}
    },
    ubuStarter: {
      get status() { return starterState; },
      get known() { return true; },
      async refresh() {
        for (const fn of (winListeners.get('ubu:starter') || [])) fn({});
      },
      async claim(kind) {
        starterState = { ...starterState, [kind]: false };
        return { certificates: pack3.map(p => p.cert) };
      }
    },
    ubuList: {
      config: async () => ({ ready: true, login: true, mint: 'AAAAAAAAAAAAAAAAAAAAAA', lifetimeLimit: 10, keys: { k1: pubJwk.x } }),
      trustedKey: async () => {
        importedKey ||= await globalThis.crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: pubJwk.x, ext: true }, { name: 'Ed25519' }, false, ['verify']);
        return importedKey;
      },
      load: async () => {},
      get: serial => ownedMap.get(serial) || null,
      add: entry => { ownedMap.set(entry.serial, entry); },
      setFavorite: async () => {},
      serialLabel: s => '#' + Number(s),
      rarityScore: p => p.toFixed(2),
      heartIcon: () => makeDomNode('svg'),
      mount: () => ({ render() {}, clearFilters() {} })
    },
    createPackScene: () => {
      let packType = 'foil';
      return {
        async play(amount, models, options) {
          unwrapCalls.push({ amount, count: models.length, silhouette: Boolean(options?.silhouette), type: packType });
        },
        awaitingTap: () => false,
        tap: () => false,
        reset() {},
        setStarter() { packType = 'starter'; },
        setHints(type) { packType = type; },
        getSilhouetteTokens(amount = 5) {
          return Array.from({ length: amount }, (_, i) => {
            const slot = i - (amount - 1) / 2;
            return { x: slot * (amount === 3 ? 165 : 88), y: -26 + Math.abs(slot) * 14, diameter: 208 };
          });
        }
      };
    },
    fetch: async (url, init = {}) => {
      const json = obj => ({ ok: true, status: 200, json: async () => obj });
      if (url === '/api/packs') {
        const body = JSON.parse(init.body || '{}');
        const hints = pack5.map(p => ({ background: p.bg, textured: p.tex }));
        return json({
          request: body.request,
          choices: [
            { choice: 'tok-0', type: 'foil', hints },
            { choice: 'tok-1', type: 'gift', hints },
            { choice: 'tok-2', type: 'plastic', hints }
          ]
        });
      }
      if (url === '/api/mint') {
        mintCount++;
        return json({ certificates: pack5.map(p => p.cert) });
      }
      if (url === '/api/favorites') return json({ ok: true });
      return json({});
    }
  };
  const mintDoc = {
    body: { dataset: { shot: 'mint' }, append() {} },
    activeElement: null,
    getElementById: getMintEl,
    createElement: tag => makeDomNode(tag),
    createElementNS: (_, tag) => makeDomNode(tag),
    querySelector: sel => {
      if (sel === '.rink-stage') return rinkStageDom;
      if (sel === '.stadium-stage-area') return stageAreaDom;
      if (sel === 'main[data-screen="collection"]') return makeDomNode('main');
      if (sel === 'main[data-screen="mint"]') return makeDomNode('main');
      return null;
    },
    querySelectorAll: () => []
  };
  mintWin.window = mintWin;
  mintWin.globalThis = mintWin;
  mintWin.document = mintDoc;
  mintWin.performance = { now: () => mockNow };
  mintWin.Object = Object;
  mintWin.Array = Array;
  mintWin.Set = Set;
  mintWin.Map = Map;
  mintWin.Math = Math;
  mintWin.Number = Number;
  mintWin.String = String;
  mintWin.Boolean = Boolean;
  mintWin.Promise = Promise;
  mintWin.JSON = JSON;
  mintWin.Error = Error;
  mintWin.Uint8Array = Uint8Array;

  const waitUntil = async (pred) => {
    for (let i = 0; i < 100; i++) {
      if (pred()) return;
      await new Promise(r => setTimeout(r, 2));
    }
  };
  runInNewContext(siteSrc, mintWin);
  // Wait for async session + initial offer load
  await waitUntil(() => !getMintEl('pack-choices').hidden && getMintEl('pack-choices').children.length === 3);

  assert.equal(getMintEl('pack-choices').hidden, false, '3 pack choices dealt onto the Mint stage');
  assert.equal(getMintEl('pack-choices').children.length, 3);
  assert.deepEqual(
    getMintEl('pack-choices').children.map(c => c.style.getPropertyValue('--pack-x')),
    ['25%', '50%', '75%'],
    'packs positioned across left, center, and right spotlights on the ice'
  );

  // Click pack 0 -> swipes 1 & 2 away, centers pack 0, unwraps in silhouette, silhouettes 5 ubus, zooms onto ubu 0 and reveals its card!
  const pack0Btn = getMintEl('pack-choices').children[0].children[0];
  pack0Btn.click();
  await waitUntil(() => !getMintEl('mint-reveal').hidden && getMintEl('card-stage').children.length === 1);

  assert.equal(mintCount, 1);
  assert.equal(unwrapCalls.length, 1);
  assert.equal(unwrapCalls[0].silhouette, true, 'pack unwrap runs in silhouette mode on the Mint stage');
  assert.equal(getMintEl('mint-ubus').hidden, false, '5 ubus placed onto the ice');
  assert.equal(getMintEl('mint-ubus').children.length, 5);
  assert.equal(rinkStageDom.style.getPropertyValue('--mint-zoom'), '2.4', 'camera zooms in 2.4x onto active ubu');
  assert.equal(rinkStageDom.style.getPropertyValue('--mint-pan-x'), '69.600%', 'camera pans to center ubu 0 (x=21%)');
  assert.equal(rinkStageDom.classList.contains('mint-zoomed'), true);
  assert.equal(getMintEl('mint-reveal').hidden, false, 'arrows and card stage pop up');
  assert.equal(getMintEl('card-stage').children.length, 1, 'active ubu displays its trading card');
  assert.equal(getMintEl('prev-ubu').disabled, true);
  assert.equal(getMintEl('next-ubu').disabled, false);
  assert.equal(getMintEl('finish-pack').hidden, true, 'Done stays hidden until all 5 ubus are revealed');

  // Verify ubu 0 is active (card shown) while ubus 1..4 are silhouetted side ubus on the ice
  const ubuEls = getMintEl('mint-ubus').children;
  assert.equal(ubuEls[0].classList.contains('is-active'), true);
  for (let i = 1; i < 5; i++) {
    assert.equal(ubuEls[i].classList.contains('is-silhouetted'), true, `unseen ubu ${i} stays silhouetted under its spotlight`);
    assert.equal(ubuEls[i].classList.contains('is-active'), false);
  }

  // Click Next arrow -> pans to ubu 1; ubu 0 becomes a plain revealed ubu off to the left, ubu 1 shows its card, ubus 2..4 remain silhouetted
  getMintEl('next-ubu').click();
  await waitUntil(() => getMintEl('reveal-progress').textContent === '2 / 5');
  assert.equal(rinkStageDom.style.getPropertyValue('--mint-pan-x'), '34.800%', 'camera pans to ubu 1 (x=35.5%)');
  assert.equal(ubuEls[0].classList.contains('is-active'), false, 'previous ubu returns to the ice off to the side');
  assert.equal(ubuEls[0].classList.contains('is-revealed'), true, 'previous ubu shows in full color on the ice');
  assert.equal(ubuEls[1].classList.contains('is-active'), true, 'ubu 1 shows its trading card');
  assert.equal(ubuEls[2].classList.contains('is-silhouetted'), true, 'ubu 2 off to the right stays silhouetted');

  // Reveal remaining ubus 2, 3, 4 -> Done button appears
  for (let step = 0; step < 3; step++) {
    const expected = `${step + 3} / 5`;
    getMintEl('next-ubu').click();
    await waitUntil(() => getMintEl('reveal-progress').textContent === expected);
  }
  assert.equal(getMintEl('finish-pack').hidden, false, 'Done appears once all 5 ubus are revealed');

  // Click Done -> zooms back out to 1x, scampers all ubus off the ice, and deals new packs into position
  getMintEl('finish-pack').click();
  await waitUntil(() => getMintEl('mint-ubus').hidden && !getMintEl('pack-choices').hidden);
  assert.equal(rinkStageDom.style.getPropertyValue('--mint-zoom'), '1', 'camera zooms back out to full rink');
  assert.equal(rinkStageDom.style.getPropertyValue('--mint-pan-x'), '0%', 'camera resets pan');
  assert.equal(rinkStageDom.classList.contains('mint-zoomed'), false);
  assert.equal(getMintEl('mint-reveal').hidden, true);
  assert.equal(getMintEl('mint-ubus').hidden, true, 'ubus scamper away and clear the ice');
  assert.equal(getMintEl('pack-choices').hidden, false, 'next set of packs fades into position for another round');

  // 4. Home signup bonus pack (#home-pack) navigates to /mint, waits for camera transition, then opens 3-ubu starter pack on Mint stage
  mintWin.location.pathname = '/';
  mintDoc.body.dataset.shot = 'home';
  starterState = { signup: true, daily: false };
  let releaseTransition;
  stageReadyGate = new Promise(resolve => { releaseTransition = resolve; });
  const homeSignupBtn = getMintEl('home-pack').children[0];
  homeSignupBtn.click();
  await waitUntil(() => navigatedTo === '/mint' && !getMintEl('signup-stage-pack').hidden);
  assert.equal(navigatedTo, '/mint', 'clicking Home signup pack navigates to /mint');
  assert.equal(unwrapCalls.length, 1, 'signup pack waits for camera transition into Mint before unwrapping');
  assert.equal(getMintEl('signup-stage-pack').hidden, false, 'signup pack sits at center ice during camera glide');

  releaseTransition();
  await waitUntil(() => unwrapCalls.length === 2 && !getMintEl('mint-reveal').hidden && getMintEl('reveal-progress').textContent === '1 / 3');
  assert.equal(unwrapCalls.length, 2, 'signup pack unwraps once Mint camera transition completes');
  assert.equal(unwrapCalls[1].amount, 3, 'signup pack unwraps 3 starter ubus');
  assert.equal(unwrapCalls[1].silhouette, true);
  assert.equal(getMintEl('mint-ubus').children.length, 3, '3 starter ubus placed under 3 spotlights');
  // Verify continuous silhouette emergence keyframes: starts at solid opacity 1 and larger pack scale, gliding down to scale 1
  const starterUbu0Anim = getMintEl('mint-ubus').children[0]._lastAnim;
  assert.ok(starterUbu0Anim, 'emerging silhouette ubu animates continuously from pack coordinates to lineup');
  assert.equal(starterUbu0Anim.keyframes[0].opacity, 1, 'emerging silhouette starts solid without fading in from 0');
  assert.equal(starterUbu0Anim.keyframes[1].opacity, 1);
  assert.ok(starterUbu0Anim.keyframes[0].scale > 1 || starterUbu0Anim.keyframes[1].scale === 1);
  assert.equal(rinkStageDom.style.getPropertyValue('--mint-zoom'), '1.85', '3-ubu reveal uses 1.85x zoom');
  assert.equal(rinkStageDom.style.getPropertyValue('--mint-pan-x'), '35.150%', 'camera centers starter ubu 0 (x=31%)');

  // 5. Mobile touch swipe controls step between cards and suppress synthetic post-swipe card clicks
  const cardEl = getMintEl('card-stage').children[0];
  const fireSwipe = (dx) => {
    const base = { pointerId: 9, pointerType: 'touch', isPrimary: true, target: cardEl, clientY: 200 };
    stageAreaDom._on_pointerdown?.({ ...base, clientX: 220 });
    stageAreaDom._on_pointermove?.({ ...base, clientX: 220 + dx * 0.4 });
    stageAreaDom._on_pointermove?.({ ...base, clientX: 220 + dx });
    stageAreaDom._on_pointerup?.({ ...base, clientX: 220 + dx });
  };
  mockNow = 5000;
  fireSwipe(-90); // Swipe left -> advance to starter ubu 1 (index 1, x=50%)
  await waitUntil(() => getMintEl('reveal-progress').textContent === '2 / 3');
  assert.equal(rinkStageDom.style.getPropertyValue('--mint-pan-x'), '0.000%', 'touch swipe left advances to starter ubu 1 at center ice');
  assert.equal(getMintEl('reveal-progress').textContent, '2 / 3');

  // Immediate synthetic click (< 90ms after swipe) does not open the modal viewer
  mockNow = 5040;
  getMintEl('card-stage').children[0].click();
  assert.equal(Boolean(getMintEl('viewer').open), false, 'post-swipe synthetic click does not trigger modal viewer');

  mockNow = 5300;
  fireSwipe(95); // Swipe right -> step back to starter ubu 0 (index 0, x=31%)
  await waitUntil(() => getMintEl('reveal-progress').textContent === '1 / 3');
  assert.equal(rinkStageDom.style.getPropertyValue('--mint-pan-x'), '35.150%', 'touch swipe right returns to starter ubu 0');
  assert.equal(getMintEl('reveal-progress').textContent, '1 / 3');

  // 6. Verify pack-scene.js getSilhouetteTokens returns continuous end-of-unwrap fan geometry
  const packSceneSrc = fs.readFileSync(path.join(__dirname, '../web/pack-scene.js'), 'utf8');
  const noopCtx = () => ({
    setTransform() {}, resetTransform() {}, clearRect() {}, fillRect() {}, strokeRect() {},
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, bezierCurveTo() {},
    arc() {}, ellipse() {}, rect() {}, roundRect() {}, closePath() {}, clip() {}, fill() {}, stroke() {},
    translate() {}, scale() {}, rotate() {}, transform() {}, drawImage() {}, fillText() {}, strokeText() {},
    measureText: () => ({ width: 20 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createImageData: (w = 64, h = 64) => ({ data: new Uint8Array(w * h * 4) }),
    putImageData() {},
    createPattern: () => ({})
  });
  const packSceneCtx = {
    Math, Number, String, Boolean, Array, Object, Map, Set, Promise, Uint8Array, Uint32Array, parseInt,
    crypto: globalThis.crypto,
    navigator: { userActivation: { hasBeenActive: false } },
    devicePixelRatio: 1,
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    ResizeObserver: class { observe() {} },
    Image: class { set src(_) {} },
    document: {
      createElement: () => ({ width: 64, height: 64, dataset: {}, getContext: noopCtx })
    }
  };
  packSceneCtx.globalThis = packSceneCtx;
  runInNewContext(packSceneSrc, packSceneCtx);
  const mockCanvas = {
    clientWidth: 300, clientHeight: 180, width: 300, height: 180, dataset: {},
    parentElement: { addEventListener() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 180 }),
    getContext: noopCtx
  };
  const realScene = packSceneCtx.createPackScene(mockCanvas);
  realScene.setType('foil');
  const tok5 = realScene.getSilhouetteTokens(5);
  assert.equal(tok5.length, 5);
  assert.deepEqual(tok5.map(t => t.x), [-176, -88, 0, 88, 176], '5-ubu foil fan coordinates match pack-scene reveal');
  assert.equal(tok5[2].diameter, 208);
  const tok3 = realScene.getSilhouetteTokens(3);
  assert.deepEqual(tok3.map(t => t.x), [-165, 0, 165], '3-ubu starter fan coordinates match pack-scene reveal');
  realScene.setType('blob');
  assert.equal(realScene.getSilhouetteTokens(5)[0].diameter, 84, 'blob pack reports its 84u silhouette diameter');
});

test('Rink stage Phase 4: stretched portrait Collection rink, repeating markings & center logos, 2-step rotate/stretch & shrink/rotate camera moves, sticky dock, and hybrid on-ice viewer', async () => {
  const crypto = require('node:crypto');
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ubu = require('../shared/ubu.js');
  const ubuFile = require('../shared/ubu-file.js');
  const rarity = require('../shared/rarity.js');
  const ubuArchetype = require('../shared/ubu-archetype.js');
  const pres = require('../web/ububall-presentation.js');
  const cssSrc = fs.readFileSync(require.resolve('../web/ububall.css'), 'utf8');
  const siteCssSrc = fs.readFileSync(require.resolve('../web/site.css'), 'utf8');
  const htmlSrc = fs.readFileSync(require.resolve('../web/index.html'), 'utf8');
  const siteSrc = fs.readFileSync(require.resolve('../web/site.js'), 'utf8');

  // 1. Structural & CSS invariants: Collection lives inside .ball-page with sticky #collection-dock and #collection-world on .rink-stage
  assert.equal(cssSrc.includes('body[data-shot="collection"] .ball-page { display: none; }'), false, '.ball-page is no longer hidden on collection shot');
  const ballPageStart = htmlSrc.indexOf('<div class="ball-page">');
  const viewerDialogStart = htmlSrc.indexOf('<dialog id="viewer"');
  const ballPageRegion = htmlSrc.slice(ballPageStart, viewerDialogStart);
  assert.ok(ballPageRegion.includes('data-screen="collection"'), '<main data-screen="collection"> lives inside shared .ball-page');
  assert.match(htmlSrc, /id="collection-dock"/, 'index.html mounts sticky #collection-dock');
  assert.match(htmlSrc, /id="collection-world"/, 'index.html mounts #collection-world inside .rink-stage');
  assert.match(htmlSrc, /id="collection-viewer-stage"/, 'index.html mounts #collection-viewer-stage for hybrid on-ice viewer');
  assert.match(cssSrc, /body\[data-shot="collection"\] \.collection-dock[\s\S]*?position:\s*sticky/, 'collection dock is sticky above the rink');
  assert.match(cssSrc, /body\[data-shot="collection"\] \.ball-page[\s\S]*?min\(114rem,\s*calc\(100%\s*-\s*3rem\)\)/, 'portrait collection rink matches Ubu Mint width');
  assert.match(siteCssSrc, /\.collection-world[\s\S]*?min-height:\s*calc\(100cqw \* 5 \/ 3\)/, 'collection world enforces minimum 3:5 portrait height');

  // 2. drawPortraitRinkSurface: enforces 3:5 minimum (L >= 1000), draws top/bottom goals & creases, and repeats lines & center logos every 320/640 units
  const recordPortraitDraw = (length, viewTop = 0, viewSpan = null) => {
    const ops = { roundRects: [], lines: [], arcs: [], logos: [], fillRects: [] };
    let curLine = null;
    const g = {
      fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
      save() {}, restore() {}, clip() {}, setLineDash() {},
      beginPath() { curLine = null; },
      roundRect(x, y, w, h, r) { ops.roundRects.push({ x, y, w, h, r }); },
      fill() {},
      stroke() { if (curLine) ops.lines.push({ ...curLine, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth }); },
      moveTo(x, y) { curLine = { x1: x, y1: y, x2: x, y2: y }; },
      lineTo(x, y) { if (curLine) { curLine.x2 = x; curLine.y2 = y; } },
      arc(x, y, r, a0, a1) { ops.arcs.push({ x, y, r, a0, a1 }); },
      fillRect(x, y, w, h) { ops.fillRects.push({ x, y, w, h }); },
      drawImage(_img, x, y, w, h) { ops.logos.push({ cx: x + w / 2, cy: y + h / 2, w, h }); }
    };
    const colors = { surface: '#1b1e26', border: '#393f4d', background: '#101217', home: '#e8ca48', away: '#aa54d3' };
    const logo = { complete: true, naturalWidth: 220, naturalHeight: 44 };
    pres.drawPortraitRinkSurface(g, P, ububallMatch, colors, logo, length, viewTop, viewSpan);
    return ops;
  };

  // Minimum 3:5 clamp: length=480 clamps to L=1000 (boardH = 880)
  const minOps = recordPortraitDraw(480);
  assert.equal(minOps.roundRects[0].w, 480);
  assert.equal(minOps.roundRects[0].h, 880, 'length below 1000 clamps to 3:5 minimum (600x1000, board height 880)');
  assert.deepEqual(minOps.logos.map(l => l.cy), [500], 'regulation 3:5 rink has single center logo at y=500');
  const minHorizLines = minOps.lines.filter(l => l.x1 === 60 && l.x2 === 540).map(l => l.y1);
  assert.deepEqual(minHorizLines, [180, 500, 820], 'regulation 3:5 rink draws top zone (180), center (500), and bottom zone (820) lines');
  assert.equal(minOps.fillRects.length, 2, 'top Away and bottom Home goal pockets drawn');
  assert.equal(minOps.fillRects[0].y, 60 - P.rink.goalDepth, 'top goal sits above y=60');
  assert.equal(minOps.fillRects[1].y, 940, 'bottom goal sits at y=L-60');

  // Stretched rink (L=2600): lines repeat regularly every 320 units and center logos every 640 units
  const longOps = recordPortraitDraw(2600);
  assert.equal(longOps.roundRects[0].h, 2480);
  assert.deepEqual(longOps.logos.map(l => l.cy), [500, 1140, 1780], 'center logos repeat regularly every 640 units as rink stretches');
  const longHorizLines = longOps.lines.filter(l => l.x1 === 60 && l.x2 === 540).map(l => l.y1);
  assert.deepEqual(longHorizLines, [180, 500, 820, 1140, 1460, 1780, 2100], 'interior lines repeat regularly every 320 units down the stretched rink');

  // Viewport slice culling: scrolling to viewTop=1000, viewSpan=700 only draws markings near [1000..1700]
  const sliceOps = recordPortraitDraw(5000, 1000, 700);
  assert.deepEqual(sliceOps.logos.map(l => l.cy), [1140, 1780], 'scrolled slice renders only visible repeating center logos at exact coordinates');

  // 3. Two-step camera choreography in ububall.js: rotate -> stretch on enter, shrink -> rotate on exit, cut on phones
  const stageSlice =
    section('  let cast = null, shot =', '  // While a video export renders') + '\n' +
    section('  function localPlayBlocked() {', '  function updateLocalPlanClock(') + '\n' +
    section('  function updateFoulInfo() {', '  function kickoff(isNewMatch = false) {') + '\n' +
    section('  function updateFirstTurnGuide() {', '  function prepareCPU(initialPlans = null) {') + '\n' +
    section('  function positionSpinControl() {', '  function fitStadium() {') + '\n' +
    section('  let cameraMove = null;', '  // The cast: whoever is on the ice') + '\n' +
    section('  function updateReplaySkip(replay) {', '  replaySkip.onclick =') + '\n' +
    section('  function syncFullscreenButton() {', '  async function exitOwnedFullscreen() {') + '\n' +
    section('  function fitOrientation() {', '  function openPause() {') + '\n' +
    section('  function leavePlayOverlays() {', '  const screenGuard =') + '\n' +
    section('  function demoPaused() {', '  // Waits count only while');

  const makeClassList = () => {
    const set = new Set();
    return {
      add: (...cs) => cs.forEach(c => set.add(c)),
      remove: (...cs) => cs.forEach(c => set.delete(c)),
      toggle: (c, on) => { const next = on === undefined ? !set.has(c) : Boolean(on); if (next) set.add(c); else set.delete(c); return next; },
      contains: c => set.has(c)
    };
  };
  let collectionFullHeight = 2900; // Taller than 3:5 (1200 * 5 / 3 = 2000)
  const animHistory = [];
  let castCalls = [];
  const stageEls = new Map();
  const getStageEl = id => {
    if (!stageEls.has(id)) {
      stageEls.set(id, {
        id, hidden: false, open: false, inert: false,
        style: { visibility: '', setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
        classList: makeClassList(),
        children: [],
        get firstElementChild() { return { textContent: '' }; },
        replaceChildren() { this.children = []; }, setAttribute() {},
        close() { this.open = false; },
        animate() { return { cancel() {} }; }
      });
    }
    return stageEls.get(id);
  };
  const mockWin = { innerHeight: 900, dispatchEvent() {} };
  const rinkStage = {
    classList: makeClassList(),
    style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
    getBoundingClientRect() {
      const s = stageCtx.document.body.dataset.shot;
      if (s === 'collection') {
        const h = this.classList.contains('collection-rotating') ? 2000 : collectionFullHeight;
        return { left: 120, top: 80, width: 1200, height: h };
      }
      if (s === 'mint') return { left: 120, top: 100, width: 1200, height: 720 };
      return { left: 40, top: 80, width: 750, height: 450 };
    },
    animate(keyframes, opts) {
      const anim = { keyframes, opts, cancelled: false, onfinish: null, cancel() { this.cancelled = true; } };
      animHistory.push(anim);
      return anim;
    }
  };
  const stageCtx = {
    Object, Array, Set, Map, Math, Number, String, Boolean, Promise, URL,
    performance: { now: () => 1000 },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    window: mockWin,
    P, ububallMatch,
    $: getStageEl,
    inDiscord: false,
    location: { pathname: '/' },
    scrollY: 0,
    scrollTo() {},
    reducedMotion: { matches: false },
    portraitScreen: { matches: false },
    ownsFullscreen: () => false,
    fullscreenDisplay: { matches: false },
    fullscreenRequest: null,
    btnFullscreen: getStageEl('btn-fullscreen'),
    exitOwnedFullscreen: async () => {},
    fitScorebug() {},
    setPortrait() {},
    fitSetupShot() {},
    endCanvasDrag() {},
    drag: null,
    fieldView: { portrait: false, field: null, bodies: P.kickoff(), mode: 'standard' },
    fieldBox: { left: 0, top: 0, width: 750, height: 450, stageWidth: 750, stageHeight: 450, controlWidth: 120, controlHeight: 32 },
    stagePoint: p => ({ x: p.x, y: p.y }),
    impulseGeometry: b => ({ x: b.x, y: b.y - 40 }),
    gameUi: { scale: () => 1 },
    selected: 0,
    plans: [{ angle: 0, power: 0, spin: 0, guard: false }],
    phase: 'plan',
    spinSlider: false,
    firstTurnStep: null,
    foulInfo: null,
    foulBox: getStageEl('foul-box'),
    goalReplay: null,
    replaySkip: getStageEl('skip-goal-replay'),
    demo: true,
    online: null,
    theater: null,
    recording: null,
    lineupMove: null,
    returnPortrait: false,
    closeFirstTurnGuide() {},
    closeFoulInfo() {},
    closeSummary() {},
    stopFanfare() {},
    gameAudio: () => ({ stopMotion() {} }),
    isExporting: () => false,
    statDrawer: { matches: () => false, hidePopover() {} },
    endReplay() {},
    hideFinger() {},
    matchInProgress: () => false,
    cpuClient: { dispose() {} },
    layoutDirty: false,
    draw() { stageCtx.layoutDirty = false; },
    castTo: away => { castCalls.push(away); },
    stadium: { classList: makeClassList() },
    rinkWrap: { classList: makeClassList(), style: {} },
    rinkStage,
    document: {
      hidden: false,
      fullscreenElement: null,
      fullscreenEnabled: true,
      body: { dataset: { shot: 'home' }, classList: makeClassList() },
      querySelector: () => null
    }
  };
  const stageEnv = runInNewContext(
    stageSlice + '\n;({ getShot: () => shot, screenTransition });',
    stageCtx
  );

  // Enter Collection from Home: Step 1 rotates in-plane (rotate(90deg) -> none) at 3:5, Step 2 stretches height
  stageCtx.location.pathname = '/collection';
  stageEnv.screenTransition('collection', () => {}, 'play');
  assert.equal(stageEnv.getShot(), 'collection');
  assert.deepEqual(castCalls, [true], 'skaters scatter off the ice on entering Collection');
  assert.equal(animHistory.length, 1, 'Step 1 (rotate to portrait) starts immediately');
  assert.match(animHistory[0].keyframes[0].transform, /rotate\(90deg\)/, 'Step 1 rotates landscape rink -90deg CCW into 3:5 portrait');
  assert.equal(rinkStage.classList.contains('collection-rotating'), true, 'rink holds 3:5 unstretched height during rotation');

  let enterSettled = false;
  mockWin.ubuStageReady().then(() => { enterSettled = true; });
  await Promise.resolve();
  assert.equal(enterSettled, false, 'ubuStageReady stays pending during Step 1 rotation');

  // Finish Step 1 -> automatically chains Step 2 (height stretch from 2000 to 2900)
  animHistory[0].onfinish();
  assert.equal(rinkStage.classList.contains('collection-rotating'), false);
  assert.equal(animHistory.length, 2, 'Step 2 (stretch height) chains automatically after rotation');
  assert.match(animHistory[1].keyframes[0].clipPath, /inset\(0 0 900px 0\)/, 'Step 2 grows rink from 3:5 height (2000) to full collection height (2900)');
  await Promise.resolve();
  assert.equal(enterSettled, false, 'ubuStageReady waits until Step 2 stretch completes');

  animHistory[1].onfinish();
  await Promise.resolve();
  assert.equal(enterSettled, true, 'ubuStageReady resolves once both rotate and stretch steps finish');

  // Leave stretched Collection for Play (Home): Step 1 shrinks height first (deferring castTo(false)), Step 2 rotates back (+90deg CW)
  animHistory.length = 0;
  castCalls = [];
  stageCtx.location.pathname = '/';
  stageEnv.screenTransition('play', () => {}, 'collection');
  assert.equal(stageEnv.getShot(), 'home');
  assert.equal(animHistory.length, 1, 'Step 1 (shrink to 3:5) starts first when leaving stretched Collection');
  assert.equal(rinkStage.classList.contains('collection-shrinking'), true);
  assert.deepEqual(castCalls, [], 'skaters wait until portrait shrink finishes before skating back');

  animHistory[0].onfinish();
  assert.equal(rinkStage.classList.contains('collection-shrinking'), false);
  assert.equal(animHistory.length, 2, 'Step 2 (rotate back to landscape) chains after shrink finishes');
  assert.match(animHistory[1].keyframes[0].transform, /rotate\(-90deg\)/, 'Step 2 rotates 3:5 portrait rink +90deg CW back to Home landscape');
  assert.deepEqual(castCalls, [false], 'skaters skate back onto the ice as the rink rotates back to Home');
  animHistory[1].onfinish();

  // Phone portrait skips rotation/stretch moves cleanly
  animHistory.length = 0;
  stageCtx.portraitScreen.matches = true;
  stageCtx.location.pathname = '/collection';
  stageEnv.screenTransition('collection', () => {}, 'play');
  assert.equal(animHistory.length, 0, 'phones skip rotation and stretch camera animations cleanly');
  stageCtx.portraitScreen.matches = false;

  // 4. Hybrid on-ice viewer in site.js: scatter other ubus, grow selected ubu into .viewer.on-ice, Prev/Next navigation, Close & re-open, and Team Picker modal fallback
  const { publicKey, privateKey } = await globalThis.crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const pubJwk = await globalThis.crypto.subtle.exportKey('jwk', publicKey);
  const certs = [];
  for (let i = 1; i <= 3; i++) {
    const dna = crypto.randomBytes(128);
    const cert = await ubuFile.sign({
      mint: 'AAAAAAAAAAAAAAAAAAAAAA',
      id: crypto.randomBytes(16).toString('base64url'),
      serial: String(i).padStart(12, '0'),
      dna: ubu.toCode(dna),
      issuedAt: 1794441600 + i,
      key: 'k1'
    }, privateKey);
    const res = await ubuFile.read(cert, {
      allowUnsigned: false,
      resolveKey: async () => globalThis.crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: pubJwk.x, ext: true }, { name: 'Ed25519' }, false, ['verify'])
    });
    const model = ubu.decode(dna);
    certs.push({ serial: String(i).padStart(12, '0'), certificate: cert, result: res, model, rarity: rarity.scoreRarity(model), favorite: false });
  }

  const domMap = new Map();
  const winEvents = new Map();
  const makeNode = (tag, id = '') => {
    const cl = makeClassList();
    const n = {
      tagName: tag.toUpperCase(), id, hidden: false, disabled: false, open: false, modalOpened: false, textContent: '', value: '',
      dataset: {}, parentElement: null,
      style: { setProperty(k, v) { this[k] = String(v); }, getPropertyValue(k) { return this[k] || ''; }, removeProperty(k) { delete this[k]; } },
      classList: cl,
      children: [],
      get childElementCount() { return this.children.length; },
      get firstChild() { return this.children[0] || null; },
      append(...kids) {
        for (const k of kids) {
          if (k && typeof k === 'object') {
            if (k.parentElement?.children) {
              const idx = k.parentElement.children.indexOf(k);
              if (idx >= 0) k.parentElement.children.splice(idx, 1);
            }
            k.parentElement = this;
          }
          this.children.push(k);
        }
      },
      after(...kids) {
        if (!this.parentElement) return;
        const idx = this.parentElement.children.indexOf(this);
        this.parentElement.children.splice(idx + 1, 0, ...kids);
      },
      replaceChildren(...kids) { this.children = []; this.append(...kids); },
      setAttribute(k, v) { this[k] = String(v); },
      getAttribute(k) { return this[k] ?? null; },
      removeAttribute(k) { delete this[k]; },
      closest: () => null,
      querySelector(sel) {
        if (sel === 'button' || sel === '.ubu-tile-main') return this.children.find(c => c?.tagName === 'BUTTON') || makeNode('button');
        if (sel === 'canvas') return this.children.find(c => c?.tagName === 'CANVAS') || makeNode('canvas');
        if (sel === '.ubu-tile-art') return this._artNode || this;
        if (sel === 'use') return makeNode('use');
        return null;
      },
      querySelectorAll: () => [],
      addEventListener(type, fn) { this[`_on_${type}`] = fn; },
      click() {
        const ev = { target: this, detail: 1, clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() {} };
        this._on_click?.(ev);
      },
      focus() {},
      show() { this.open = true; this.modalOpened = false; },
      showModal() { this.open = true; this.modalOpened = true; },
      close() { this.open = false; this.modalOpened = false; this._on_close?.(); },
      getBoundingClientRect: () => ({ left: 200, top: 200, right: 320, bottom: 360, width: 120, height: 160 }),
      getContext: () => ({
        clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, save() {}, restore() {},
        translate() {}, scale() {}, createRadialGradient: () => ({ addColorStop() {} })
      }),
      animate(keyframes, options) {
        const rec = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
        this._lastAnim = rec;
        return rec;
      }
    };
    return n;
  };
  const getColEl = id => {
    if (!domMap.has(id)) domMap.set(id, makeNode('div', id));
    return domMap.get(id);
  };
  for (const sid of ['daily-pack', 'signup-stage-pack', 'home-pack']) {
    const w = getColEl(sid), b = makeNode('button');
    b.append(makeNode('canvas')); w.append(b);
  }
  getColEl('viewer').getBoundingClientRect = () => ({ left: 260, top: 180, right: 1140, bottom: 640, width: 880, height: 460 });
  const bodyNode = makeNode('body');
  bodyNode.dataset.shot = 'collection';
  bodyNode.append(getColEl('viewer'));

  // Populate 3 mock tiles inside #ubus and capture mount config
  let mountedCollectionOpts = null;
  const tileNodes = certs.map((c, idx) => {
    const t = makeNode('div', 'tile-' + idx);
    t.classList.add('ubu-tile');
    t.dataset.serial = c.serial;
    t.getBoundingClientRect = () => ({ left: 180 + idx * 180, top: 240, right: 320 + idx * 180, bottom: 420, width: 140, height: 180 });
    return t;
  });
  getColEl('ubus').append(...tileNodes);

  let importedVerifyKey = null;
  const colWin = {
    location: { pathname: '/collection' },
    innerHeight: 900,
    navigator: { userActivation: { hasBeenActive: false } },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: () => 1,
    setTimeout: fn => { fn(); return 1; },
    clearTimeout() {},
    URL, Blob, TextDecoder,
    crypto: globalThis.crypto,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener(type, fn) { if (!winEvents.has(type)) winEvents.set(type, []); winEvents.get(type).push(fn); },
    dispatchEvent(ev) { for (const fn of (winEvents.get(ev.type) || [])) fn(ev); },
    getUbuSession: () => ({ owner: 'acct-1', csrf: 'csrf' }),
    gameUi: { icon: () => makeNode('svg'), confirm: async () => false },
    ubu, ubuFile, rarity, ubuArchetype, ububallPhysics: P,
    ubuRender: Object.assign(() => makeNode('svg'), {
      back: () => makeNode('svg'), cardMaterials: () => makeNode('div'), token: () => makeNode('svg'), tokenBack: () => makeNode('svg')
    }),
    ubuAudio: { getAudioContext: () => null, parseVoiceInfo: () => ({ instrument: 'Sine', rootName: 'C4', rootFreq: 261.6, scale: 'Major', tempoBpm: 120, groove: 'Straight', grooveIndex: 0, notes: [] }), stop() {} },
    ubuStarter: { status: { signup: false, daily: true }, known: true, async refresh() {} },
    ubuList: {
      config: async () => ({ ready: true, login: true, mint: 'AAAAAAAAAAAAAAAAAAAAAA', lifetimeLimit: 5, keys: { k1: pubJwk.x } }),
      trustedKey: async () => {
        importedVerifyKey ||= await globalThis.crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: pubJwk.x, ext: true }, { name: 'Ed25519' }, false, ['verify']);
        return importedVerifyKey;
      },
      load: async () => {},
      get: serial => certs.find(c => c.serial === serial) || null,
      add() {},
      setFavorite: async () => {},
      serialLabel: s => '#' + Number(s),
      rarityScore: p => p.toFixed(2),
      heartIcon: () => makeNode('svg'),
      mount: opts => {
        mountedCollectionOpts = opts;
        return { render() {}, clearFilters() {}, shownItems: () => certs, ensureVisible: s => tileNodes.find(t => t.dataset.serial === s) || null };
      }
    },
    createPackScene: () => ({ async play() {}, awaitingTap: () => false, tap: () => false, reset() {}, setStarter() {}, setHints() {} }),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) })
  };
  const colDoc = {
    body: bodyNode,
    activeElement: null,
    getElementById: getColEl,
    createElement: tag => makeNode(tag),
    createElementNS: (_, tag) => makeNode(tag),
    querySelector: sel => sel === '.rink-stage' ? makeNode('div', 'rink-stage') : null,
    querySelectorAll: () => []
  };
  colWin.window = colWin;
  colWin.globalThis = colWin;
  colWin.document = colDoc;
  colWin.performance = { now: () => 2000 };
  colWin.Object = Object; colWin.Array = Array; colWin.Set = Set; colWin.Map = Map;
  colWin.Math = Math; colWin.Number = Number; colWin.String = String; colWin.Boolean = Boolean;
  colWin.Promise = Promise; colWin.JSON = JSON; colWin.Error = Error; colWin.Uint8Array = Uint8Array;

  runInNewContext(siteSrc, colWin);
  await new Promise(r => setTimeout(r, 20));

  // Inspecting ubu 1 on Collection scatters tiles 0 and 2, grows viewer on ice (non-modal!), and shows Prev/Next
  mountedCollectionOpts.inspect(certs[1]);
  const viewerEl = getColEl('viewer');
  assert.equal(viewerEl.open, true, 'on-ice viewer opens on Collection');
  assert.equal(viewerEl.modalOpened, false, 'on-ice viewer uses non-modal show() so rink and sticky toolbar stay visible');
  assert.equal(viewerEl.classList.contains('on-ice'), true, 'viewer gains .on-ice class');
  assert.equal(viewerEl.parentElement, getColEl('collection-viewer-host'), 'viewer docks inside #collection-viewer-host');
  assert.equal(getColEl('ubus').classList.contains('is-scattered'), true, 'other ubus scatter away on the ice');
  assert.ok(tileNodes[0]._lastAnim && tileNodes[2]._lastAnim, 'neighbouring tiles play radial scatter animation');
  assert.equal(getColEl('viewer-prev').hidden, false, 'Prev arrow shown for multi-ubu collection');
  assert.equal(getColEl('viewer-next').hidden, false, 'Next arrow shown for multi-ubu collection');
  assert.equal(getColEl('viewer-prev').disabled, false);
  assert.equal(getColEl('viewer-next').disabled, false);
  assert.equal(getColEl('ubunym').textContent, certs[1].model.parts.fullName);

  // Step Next -> advances to ubu 2 and disables Next at end of list
  getColEl('viewer-next').click();
  assert.equal(getColEl('ubunym').textContent, certs[2].model.parts.fullName, 'Next arrow steps to next ubu in filtered collection');
  assert.equal(getColEl('viewer-next').disabled, true, 'Next disables on last ubu');

  // Close viewer -> cancels close animation cleanly and gathers tiles back; re-opening works cleanly without stale opacity
  getColEl('close-viewer').click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(viewerEl.open, false, 'viewer closes cleanly');
  assert.equal(getColEl('ubus').classList.contains('is-scattered'), false, 'ubu grid gathers back onto the ice');
  assert.equal(Boolean(viewerEl._lastAnim?.cancelled), true, 'close animation is cancelled on cleanup so re-opening never stays transparent');

  // Re-open ubu 0 and verify toolbar filter change closes the on-ice viewer automatically
  mountedCollectionOpts.inspect(certs[0]);
  assert.equal(viewerEl.open, true);
  mountedCollectionOpts.onToolbarChange();
  assert.equal(viewerEl.open, false, 'changing search/sort/filters in sticky dock closes open on-ice viewer');

  // Calling showUbuViewer outside Collection (e.g. Choose Team picker on team shot) opens modal #viewer on document.body
  bodyNode.dataset.shot = 'team';
  colWin.showUbuViewer(certs[0].serial);
  assert.equal(viewerEl.open, true);
  assert.equal(viewerEl.modalOpened, true, 'Choose Team inspect opens modal viewer via showModal()');
  assert.equal(viewerEl.classList.contains('on-ice'), false);
  assert.equal(viewerEl.parentElement, bodyNode, 'modal viewer re-mounts onto document.body outside Collection');
});

test('Rink stage Phase 5: Discord Activity lobby shot, docked Activity rules/team setup, Activity query preservation, Mint/Collection session sign-in, and match handoff', async () => {
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const ubu = require('../shared/ubu.js');
  const ubuFile = require('../shared/ubu-file.js');
  const rarity = require('../shared/rarity.js');
  const ubuArchetype = require('../shared/ubu-archetype.js');
  const cssSrc = fs.readFileSync(require.resolve('../web/ububall.css'), 'utf8');
  const siteCssSrc = fs.readFileSync(require.resolve('../web/site.css'), 'utf8');
  const activitySrc = fs.readFileSync(require.resolve('../web/ububall-activity.js'), 'utf8');
  const appSrc = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
  const siteSrc = fs.readFileSync(require.resolve('../web/site.js'), 'utf8');

  // 1. CSS & Activity bootstrap invariants
  assert.ok(cssSrc.includes('body[data-shot="lobby"]'), 'ububall.css defines lobby shot layout');
  assert.equal(cssSrc.includes('.discord-activity body[data-shot="home"]'), false, 'legacy .discord-activity home overrides replaced by lobby shot');
  assert.match(cssSrc, /body\[data-shot="collection"\]\s*\{\s*overflow-x:\s*clip;\s*\}/, 'collection shot clips horizontal scatter overflow while preserving sticky dock');
  assert.match(siteCssSrc, /\.discord-activity \.site-nav\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);\s*\}/, 'portrait Activity nav bar distributes 3 visible tabs evenly');
  assert.match(activitySrc, /document\.body\.dataset\.shot\s*=\s*'lobby'/, 'ububall-activity.js sets initial lobby shot on Play');
  assert.equal(siteSrc.includes('location.reload()'), false, 'site.js retries Mint setup in place without reloading/closing the Activity');

  // 2. app.js preserves Discord Activity launch query params across /mint, /collection, and /?roster=1
  {
    let pushedUrl = 'https://123456.discordsays.com/?instance_id=inst-77&frame_id=f-9&platform=desktop';
    const screens = ['play', 'mint', 'collection'].map(name => ({ dataset: { screen: name }, hidden: name !== 'play' }));
    const appWin = {
      ubuActivity: { instance: 'inst-77' },
      location: new URL(pushedUrl),
      CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
      URL, Map, Set, Object, Promise, Error,
      scrollTo() {},
      addEventListener() {},
      dispatchEvent() {},
      history: {
        pushState(_s, _t, u) {
          pushedUrl = String(u);
          appWin.location = new URL(pushedUrl);
        }
      },
      document: {
        title: 'Ububall',
        documentElement: { classList: { remove() {} } },
        body: { scrollTo() {} },
        head: { append(el) { setImmediate(() => el.onload?.()); } },
        getElementById: () => null,
        createElement: () => ({ remove() {} }),
        querySelectorAll: sel => sel === '[data-screen]' ? screens : [],
        addEventListener() {}
      }
    };
    appWin.window = appWin;
    runInNewContext(appSrc, appWin);
    await appWin.navigateUbuScreen('https://123456.discordsays.com/mint');
    assert.equal(appWin.location.pathname, '/mint');
    assert.equal(appWin.location.searchParams.get('instance_id'), 'inst-77', 'navigating to /mint preserves instance_id');
    assert.equal(appWin.location.searchParams.get('frame_id'), 'f-9', 'navigating to /mint preserves frame_id');
    await appWin.navigateUbuScreen('https://123456.discordsays.com/?roster=1');
    assert.equal(appWin.location.pathname, '/');
    assert.equal(appWin.location.searchParams.get('roster'), '1');
    assert.equal(appWin.location.searchParams.get('instance_id'), 'inst-77', 'navigating to /?roster=1 preserves instance_id alongside roster=1');
  }

  // 3. ububall.js Activity lobby shot, docked rules/team setup, CPU leave/resume, and Mint/Collection -> Match cast restoration
  const stageCode =
    section('  let cast = null, shot =', '  // While a video export renders') + '\n' +
    section('  function localPlayBlocked() {', '  function updateLocalPlanClock(') + '\n' +
    section('  function updateFoulInfo() {', '  function kickoff(isNewMatch = false) {') + '\n' +
    section('  function updateFirstTurnGuide() {', '  function prepareCPU(initialPlans = null) {') + '\n' +
    section('  function positionSpinControl() {', '  function fitStadium() {') + '\n' +
    section('  let cameraMove = null;', '  // The cast: whoever is on the ice') + '\n' +
    section('  function updateReplaySkip(replay) {', '  replaySkip.onclick =') + '\n' +
    section('  function setupStep(step) {', '  function openSetup(step,') + '\n' +
    section('  function closeLobby() {', '  // In Discord, Ready to play') + '\n' +
    section('  function syncFullscreenButton() {', '  async function exitOwnedFullscreen() {') + '\n' +
    section('  function fitOrientation() {', '  function finishCpuMatch() {') + '\n' +
    section('  async function leaveForHome(button, endMatch) {', '  $(\'pause-leave\').onclick =') + '\n' +
    section('  function leavePlayOverlays() {', '  const screenGuard =') + '\n' +
    section('  function demoPaused() {', '  // Waits count only while');

  const makeClassList = () => {
    const set = new Set();
    return {
      add: (...cs) => cs.forEach(c => set.add(c)),
      remove: (...cs) => cs.forEach(c => set.delete(c)),
      toggle: (c, on) => { const next = on === undefined ? !set.has(c) : Boolean(on); if (next) set.add(c); else set.delete(c); return next; },
      contains: c => set.has(c)
    };
  };
  const listeners = new Map();
  const els = new Map();
  const makeEl = id => ({
    id, hidden: false, disabled: false, inert: false, open: false, modalOpened: false, textContent: '', value: '',
    dataset: {}, style: { visibility: '', setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
    classList: makeClassList(),
    children: [],
    get childElementCount() { return this.children.length; },
    get firstElementChild() { return this.children[0] || { hidden: false, textContent: '' }; },
    append(...nodes) { this.children.push(...nodes); },
    prepend(node) { this.children.unshift(node); },
    before() {},
    replaceChildren(...nodes) { this.children = [...nodes]; },
    setAttribute(k, v) { this[k] = v; },
    removeAttribute(k) { delete this[k]; },
    toggleAttribute(k, on) { if (on) this[k] = ''; else delete this[k]; },
    querySelector: () => ({ textContent: '', replaceChildren() {}, classList: makeClassList() }),
    addEventListener(type, fn) { listeners.set(`${id}:${type}`, fn); },
    dispatchEvent() { return true; },
    show() { this.open = true; this.modalOpened = false; },
    showModal() { this.open = true; this.modalOpened = true; },
    close() { if (!this.open) return; this.open = false; this.modalOpened = false; listeners.get(`${id}:close`)?.(); },
    animate() { return { cancel() {} }; }
  });
  const $ = id => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };
  const playHome = makeEl('play-home');
  const rectByShot = {
    lobby: { left: 24, top: 80, width: 800, height: 480 },
    rules: { left: 24, top: 72, width: 1080, height: 648 },
    team: { left: 24, top: 72, width: 1080, height: 648 },
    match: { left: 180, top: 64, width: 960, height: 576 },
    mint: { left: 120, top: 100, width: 1120, height: 672 },
    collection: { left: 120, top: 80, width: 1120, height: 2400 }
  };
  const anims = [];
  const rinkStage = {
    classList: makeClassList(),
    style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    getBoundingClientRect() {
      const s = actCtx.document.body.dataset.shot;
      if (s === 'collection' && this.classList.contains('collection-rotating')) return { left: 120, top: 80, width: 1120, height: 1867 };
      return rectByShot[s] || rectByShot.lobby;
    },
    animate(keyframes, opts) {
      const anim = { keyframes, opts, cancelled: false, onfinish: null, cancel() { this.cancelled = true; } };
      anims.push(anim);
      return anim;
    }
  };
  let castCalls = [], contextUpdates = 0, endedCpu = 0;
  const rinkWrap = { classList: makeClassList(), style: {} };
  const actCtx = {
    Object, Array, Set, Map, Math, Number, String, Boolean, Promise, JSON, URL,
    Event: class { constructor(t) { this.type = t; } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    performance: { now: () => 2000 },
    window: { innerHeight: 720, dispatchEvent() {} },
    P, ububallMatch, $,
    inDiscord: true,
    location: { pathname: '/', href: 'https://123456.discordsays.com/?instance_id=inst-1' },
    scrollY: 0, scrollTo() {}, addEventListener() {},
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    reducedMotion: { matches: false },
    portraitScreen: { matches: false },
    ownsFullscreen: () => false,
    fullscreenDisplay: { matches: false },
    fullscreenRequest: null,
    btnFullscreen: $('btn-fullscreen'),
    exitOwnedFullscreen: async () => {},
    fitScorebug() {},
    setPortrait() {},
    endCanvasDrag() {},
    drag: null,
    fieldView: { portrait: false, field: null, bodies: P.kickoff(), mode: 'standard', castHidden: false },
    fieldBox: { left: 0, top: 0, width: 800, height: 480, stageWidth: 800, stageHeight: 480, controlWidth: 120, controlHeight: 32 },
    stagePoint: p => ({ x: p.x, y: p.y }),
    impulseGeometry: b => ({ x: b.x, y: b.y - 40 }),
    gameUi: { scale: () => 1 },
    selected: 0,
    plans: [{ angle: 0, power: 0, spin: 0, guard: false }],
    phase: 'plan',
    spinSlider: false,
    firstTurnStep: null,
    foulInfo: null,
    foulBox: $('foul-box'),
    goalReplay: null,
    replaySkip: $('skip-goal-replay'),
    demo: true,
    online: { active: false, spectating: false, contextChanged() { contextUpdates++; } },
    theater: null,
    recording: null,
    setupFor: 'pick',
    chosenMode: () => 'standard',
    draft: [{ key: 'u0', model: {} }, { key: 'u1', model: {} }, { key: 'u2', model: {} }],
    signedIn: () => true,
    teamSlotsOf: () => null,
    sameSlots: () => false,
    savedTeams: null,
    teamIndex: -1,
    ubuRender: Object.assign(() => makeEl('svg'), { spriteImg: () => makeEl('img') }),
    lobbyView: null,
    fixedTeam: () => false,
    loadCollection: async () => {},
    loadTeams: async () => {},
    rosterSlots() { $('roster-slots').replaceChildren(makeEl('s0'), makeEl('s1'), makeEl('s2')); },
    lastCpuSetup: null,
    closeFirstTurnGuide() {},
    closeFoulInfo() {},
    closeSummary() {},
    stopFanfare() {},
    gameAudio: () => ({ stopMotion() {} }),
    isExporting: () => false,
    statDrawer: { matches: () => false, hidePopover() {} },
    endReplay() {},
    hideFinger() {},
    cpuClient: { dispose() {} },
    demoClient: { dispose() {} },
    startDemo() { actCtx.demo = true; },
    stopDemo() { actCtx.demo = false; },
    newMatch() {},
    confirmCpuEnd: async () => true,
    finishCpuMatch() { endedCpu++; actCtx.recording = null; actCtx.phase = 'over'; },
    cancelAnimationFrame() {},
    castHome() {},
    castTo: away => {
      castCalls.push(away);
      actCtx.fieldView.castHidden = away;
      rinkWrap.classList.toggle('cast-away', away);
    },
    history: { state: null, pushState(s) { this.state = s; }, replaceState() {}, back() { this.state = null; } },
    layoutDirty: false,
    draw() { actCtx.layoutDirty = false; },
    stadium: { classList: makeClassList() },
    rinkStage,
    rinkWrap,
    document: {
      hidden: false,
      fullscreenElement: null,
      fullscreenEnabled: true,
      body: { dataset: { shot: 'lobby' }, style: { setProperty() {} }, classList: makeClassList() },
      querySelector: sel => {
        if (sel === '.ball-page') return { getBoundingClientRect: () => ({ top: 64 }) };
        if (sel === '.play-home') return playHome;
        return null;
      }
    }
  };
  const actEnv = runInNewContext(
    stageCode + '\n;({ getShot: () => shot, canDock, prepareSheet, setupStep, openSheet, screenTransition, enterMatch, openPause, leaveForHome, matchInProgress, localPlayBlocked, demoPaused });',
    actCtx
  );

  assert.equal(actEnv.getShot(), 'lobby', 'Discord Activity boots on the lobby shot');
  assert.equal(actEnv.localPlayBlocked(), false, 'demo physics run unblocked on lobby shot');
  assert.equal(actEnv.demoPaused(), false, 'demo loop runs unpaused on lobby shot');
  assert.equal(actEnv.canDock(), true, 'wide-screen Discord Activity docks rules/team setup on the stage');

  // Docked Change team in Activity glides lobby -> team and returns to lobby on close
  actEnv.prepareSheet();
  actEnv.setupStep('team');
  actEnv.openSheet();
  assert.equal($('roster-dialog').classList.contains('docked'), true);
  assert.equal(actEnv.getShot(), 'team');
  assert.deepEqual(castCalls, [true], 'demo skaters scatter off the ice for Activity Change team');
  $('roster-dialog').close();
  assert.equal(actEnv.getShot(), 'lobby', 'closing Activity Change team returns to lobby shot, not home');
  assert.deepEqual(castCalls, [true, false], 'demo skaters return to lobby rink');

  // Navigating lobby -> collection -> match (online match starting while browsing Collection) restores skaters onto the ice
  actCtx.location.pathname = '/collection';
  actEnv.screenTransition('collection', () => {}, 'play');
  assert.equal(actEnv.getShot(), 'collection');
  assert.equal(actCtx.fieldView.castHidden, true);
  assert.equal(rinkWrap.classList.contains('cast-away'), true);
  actCtx.location.pathname = '/';
  actEnv.enterMatch('match');
  assert.equal(actEnv.getShot(), 'match');
  assert.equal(actCtx.fieldView.castHidden, false, 'enterMatch clears castHidden when online match starts from Collection/Mint');
  assert.equal(rinkWrap.classList.contains('cast-away'), false, 'enterMatch clears .cast-away so live match skaters are visible');

  // CPU match in Activity: Pause mounts #activity-play in #pause-lobby, shows "Back to lobby", and leaving preserves resumable CPU state
  actCtx.demo = false;
  actCtx.phase = 'plan';
  actCtx.recording = { turns: [{}] };
  assert.equal(actEnv.matchInProgress(), true);
  actEnv.openPause();
  assert.equal($('pause-leave').textContent, 'Back to lobby');
  assert.equal($('pause-lobby').children.includes($('activity-play')), true, 'live Activity lobby moves into pause menu');
  const prevUpdates = contextUpdates;
  await actEnv.leaveForHome($('pause-leave'), false);
  assert.equal(endedCpu, 0, 'Back to lobby keeps CPU match resumable instead of ending it');
  assert.equal(actEnv.matchInProgress(), true);
  assert.equal(actEnv.getShot(), 'lobby');
  assert.ok(contextUpdates > prevUpdates, 'Activity lobby refreshes so Resume CPU label updates immediately');

  // End match button explicitly ends CPU match
  actEnv.enterMatch('match');
  await actEnv.leaveForHome($('pause-end-match'), true);
  assert.equal(endedCpu, 1, 'End match button ends the CPU match after confirmation');

  // 4. site.js awaits ubuActivity.signIn() before rendering Mint/Collection and retries without reloading
  let signInCalls = 0, configFails = true;
  let resolveSignIn;
  const signInPromise = new Promise(resolve => { resolveSignIn = resolve; });
  const siteNodes = new Map();
  const makeSiteNode = (tag, id = '') => ({
    tagName: tag.toUpperCase(), id, hidden: false, disabled: false, open: false, textContent: '', value: '',
    dataset: {}, parentElement: null, children: [],
    style: { setProperty() {}, getPropertyValue: () => '', removeProperty() {} },
    classList: makeClassList(),
    append(...kids) { this.children.push(...kids); },
    replaceChildren(...kids) { this.children = [...kids]; },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {}, closest: () => null,
    querySelector: () => makeSiteNode('button'),
    querySelectorAll: () => [],
    addEventListener(type, fn) { this[`_on_${type}`] = fn; },
    click() { const ev = { target: this, stopPropagation() {}, preventDefault() {} }; this.onclick?.(ev); this._on_click?.(ev); },
    getContext: () => null
  });
  const getSiteEl = id => {
    if (!siteNodes.has(id)) siteNodes.set(id, makeSiteNode('div', id));
    return siteNodes.get(id);
  };
  const siteWin = {
    location: { pathname: '/mint', reload() { throw new Error('location.reload must never run inside Discord Activity'); } },
    ubuActivity: {
      instance: 'inst-77',
      signIn() { signInCalls++; return signInPromise; }
    },
    navigator: { userActivation: { hasBeenActive: false } },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    requestAnimationFrame: () => 1,
    setTimeout: fn => { fn(); return 1; },
    clearTimeout() {},
    URL, Blob, TextDecoder, crypto: globalThis.crypto,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, dispatchEvent() {},
    getUbuSession: () => null,
    checkUbuSession: async () => ({ owner: null }),
    gameUi: { icon: () => makeSiteNode('svg'), confirm: async () => false },
    ubu, ubuFile, rarity, ubuArchetype, ububallPhysics: P,
    ubuRender: Object.assign(() => makeSiteNode('svg'), { back: () => makeSiteNode('svg'), cardMaterials: () => makeSiteNode('div'), token: () => makeSiteNode('svg'), tokenBack: () => makeSiteNode('svg') }),
    ubuAudio: { getAudioContext: () => null, stop() {} },
    ubuStarter: { status: { signup: false, daily: true }, known: true, async refresh() {} },
    ubuList: {
      config: async () => {
        if (configFails) throw new Error('network');
        return { ready: true, login: true, mint: 'AAAAAAAAAAAAAAAAAAAAAA', lifetimeLimit: 5, keys: {} };
      },
      trustedKey: async () => null,
      load: async () => {},
      get: () => null,
      add() {},
      setFavorite: async () => {},
      serialLabel: s => '#' + Number(s),
      rarityScore: p => p.toFixed(2),
      heartIcon: () => makeSiteNode('svg'),
      mount: () => ({ render() {}, clearFilters() {} })
    },
    createPackScene: () => ({ async play() {}, awaitingTap: () => false, tap: () => false, reset() {}, setStarter() {}, setHints() {} }),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) })
  };
  siteWin.window = siteWin;
  siteWin.globalThis = siteWin;
  siteWin.document = {
    body: { dataset: { shot: 'mint' }, append() {} },
    activeElement: null,
    getElementById: getSiteEl,
    createElement: t => makeSiteNode(t),
    createElementNS: (_, t) => makeSiteNode(t),
    querySelector: () => makeSiteNode('div'),
    querySelectorAll: () => []
  };
  siteWin.performance = { now: () => 0 };
  siteWin.Object = Object; siteWin.Array = Array; siteWin.Set = Set; siteWin.Map = Map;
  siteWin.Math = Math; siteWin.Number = Number; siteWin.String = String; siteWin.Boolean = Boolean;
  siteWin.Promise = Promise; siteWin.JSON = JSON; siteWin.Error = Error; siteWin.Uint8Array = Uint8Array;

  getSiteEl('signed-out-panel').hidden = true;
  runInNewContext(siteSrc, siteWin);
  await new Promise(r => setImmediate(r));
  assert.equal(getSiteEl('mint-retry').hidden, false, 'failed initial config exposes #mint-retry');

  // Clicking #mint-retry re-runs bootMint() without calling location.reload() and awaits ubuActivity.signIn()
  configFails = false;
  getSiteEl('mint-retry').click();
  await new Promise(r => setImmediate(r));
  assert.equal(signInCalls, 1, 'bootMint awaits window.ubuActivity.signIn() when session is not yet established');
  assert.equal(getSiteEl('signed-out-panel').hidden, true, 'signed-out panel never flashes while Activity signIn() is in flight');

  resolveSignIn({ owner: '111111111111111111', csrf: 'csrf-act', instance: 'inst-77' });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(getSiteEl('signed-out-panel').hidden, true, 'Activity session signs into Mint cleanly');
  assert.equal(getSiteEl('daily-pack').hidden, false, 'Activity daily pack renders on Mint stage after signIn resolves');
});

test('Rink stage Phase 6: stacked phone shots, docked phone rules/team with on-ice lineup, camera cuts, orientation isolation, and portrait play geometry', () => {
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const cssSrc = fs.readFileSync(require.resolve('../web/ububall.css'), 'utf8');
  const siteCssSrc = fs.readFileSync(require.resolve('../web/site.css'), 'utf8');
  const rinkDocSrc = fs.readFileSync(require.resolve('../docs/rink-stage.md'), 'utf8');

  // 1. CSS & handoff doc invariants for stacked phone shots
  assert.match(cssSrc, /html:has\(body\[data-shot="collection"\]\)\s*\{\s*overflow-x:\s*clip;\s*\}/, 'html clips horizontal scatter overflow on Collection');
  assert.match(cssSrc, /@media \(orientation: portrait\), \(width < 56rem\), \(\(pointer: coarse\) and \(max-height: 600px\)\)[\s\S]*?body:is\(\[data-shot="team"\], \[data-shot="rules"\]\) \.ball-page/, 'ububall.css defines stacked flex layout for phone rules/team shots');
  assert.equal(/\.team-sheet\.docked\s*\{[^}]*allow-discrete/.test(cssSrc.slice(cssSrc.indexOf('Phones and narrow screens stack'))), false, 'stacked in-flow .team-sheet.docked omits allow-discrete display hold so closing never leaves a flex box');
  assert.match(cssSrc, /@media \(max-height: 37\.5rem\)[\s\S]*?body\[data-shot="mint"\] \.rink-stage/, 'ububall.css caps Mint rink width by container height on short landscape phones');
  assert.match(siteCssSrc, /@media \(max-width: 47\.99rem\) and \(min-height: 37\.5625rem\)[\s\S]*?\.collection-viewer-host[\s\S]*?grid-column:\s*1 \/ -1/, 'narrow portrait Collection viewer spans full width with Prev/Next row below');
  assert.match(siteCssSrc, /@media \(max-height: 37\.5rem\)[\s\S]*?\.collection-viewer-frame[\s\S]*?position:\s*fixed/, 'short landscape Collection viewer frames cleanly across full viewport height');
  assert.match(rinkDocSrc, /Phase 6 is built/, 'docs/rink-stage.md Status updated for Phase 6');
  assert.match(rinkDocSrc, /Next step: Phase 7/, 'docs/rink-stage.md advances Next step to Phase 7');

  // 2. Exercise phone canDock, stacked rules/team, wideScreen resize preservation, compactPhoneStage camera cuts, orientation isolation, and portrait play geometry
  const stageCode =
    section('  let cast = null, shot =', '  // While a video export renders') + '\n' +
    section('  function updateFoulInfo() {', '  function kickoff(isNewMatch = false) {') + '\n' +
    section('  function updateFirstTurnGuide() {', '  function prepareCPU(initialPlans = null) {') + '\n' +
    section('  const KNOB_SWEEP =', '  function wheelKnob(') + '\n' +
    section('  function aimPower(distance, arrow) {', '  let fieldBox = null;') + '\n' +
    section('  let fieldBox = null;', '  let collectionShownLength =') + '\n' +
    section('  let cameraMove = null;', '  // The cast: whoever is on the ice') + '\n' +
    section('  function point(event) {', '  fieldView.canvas.addEventListener(\'wheel\'') + '\n' +
    section('  function updateReplaySkip(replay) {', '  replaySkip.onclick =') + '\n' +
    section('  function setupStep(step) {', '  function openSetup(step,') + '\n' +
    section('  const fullscreenTarget =', '  document.addEventListener(\'keydown\', e => {') + '\n' +
    section('  const portraitScreen = matchMedia', '  function openPause() {') + '\n' +
    section('  portraitScreen.addEventListener(\'change\'', '  window.addEventListener(\'popstate\'') + '\n' +
    section('  function leavePlayOverlays() {', '  const screenGuard =');

  const makeClassList = () => {
    const set = new Set();
    return {
      add: (...cs) => cs.forEach(c => set.add(c)),
      remove: (...cs) => cs.forEach(c => set.delete(c)),
      toggle: (c, on) => { const next = on === undefined ? !set.has(c) : Boolean(on); if (next) set.add(c); else set.delete(c); return next; },
      contains: c => set.has(c)
    };
  };

  let isWide = false; // Phone mode!
  let isPortraitScreen = true; // Portrait phone (e.g. 390x844)
  const mediaListeners = new Map();
  const mockMatchMedia = query => {
    const key = query.includes('min-width: 56rem') ? 'wide' : query.includes('orientation: portrait') ? 'portrait' : 'other';
    return {
      get matches() {
        if (key === 'wide') return isWide;
        if (key === 'portrait') return isPortraitScreen;
        return false;
      },
      addEventListener(_type, fn) { mediaListeners.set(key, fn); }
    };
  };

  const storage = new Map();
  const mockStorage = {
    getItem: k => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
  };

  const closeListeners = new Map();
  const els = new Map();
  const makeEl = id => ({
    id, hidden: false, disabled: false, inert: false, open: false, modalOpened: false, textContent: '', value: '',
    offsetWidth: 140, offsetHeight: 40,
    dataset: {},
    style: { visibility: '', transform: '', width: '', maxHeight: '', left: '', top: '', setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
    classList: makeClassList(),
    children: [],
    get childElementCount() { return this.children.length; },
    get firstElementChild() { return this.children[0] || { hidden: false, textContent: '' }; },
    append(...nodes) { this.children.push(...nodes); },
    before() {},
    replaceChildren(...nodes) { this.children = [...nodes]; },
    setAttribute(k, v) { this[k] = String(v); },
    getAttribute(k) { return this[k] ?? null; },
    removeAttribute(k) { delete this[k]; },
    toggleAttribute(k, on) { if (on) this[k] = ''; else delete this[k]; },
    querySelector: () => ({ textContent: '', replaceChildren() {}, onclick: null, classList: makeClassList() }),
    addEventListener(type, fn) { if (type === 'close') closeListeners.set(id, fn); },
    dispatchEvent: () => true,
    show() { this.open = true; this.modalOpened = false; },
    showModal() { this.open = true; this.modalOpened = true; },
    close() { if (!this.open) return; this.open = false; this.modalOpened = false; closeListeners.get(id)?.(); },
    animate() { return { onfinish: null, cancel() {} }; }
  });
  const $ = id => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };

  let animCalls = 0, castCalls = [], audioOrientations = [];
  const canvasRect = () => phoneCtx.fieldView.portrait
    ? { left: 18, top: 110, width: 354, height: 590 }
    : { left: 187, top: 0, width: 650, height: 390 };
  const stageRect = () => phoneCtx.fieldView.portrait
    ? { left: 0, top: 100, width: 390, height: 610 }
    : { left: 180, top: 0, width: 664, height: 390 };

  const rinkStage = {
    classList: makeClassList(),
    style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } },
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    getBoundingClientRect: () => ({ left: 8, top: 62, width: 374, height: 224 }),
    animate() {
      animCalls++;
      return { onfinish: null, cancel() {} };
    }
  };
  const stadium = { classList: makeClassList() };
  const rinkWrap = { classList: makeClassList(), style: {} };
  const btnRotate = $('btn-rotate');
  const btnFullscreen = $('btn-fullscreen');

  const phoneCtx = {
    Object, Array, Set, Map, Math, Number, String, Boolean, Promise, JSON, URL,
    Event: class { constructor(t) { this.type = t; } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    performance: { now: () => 3000 },
    window: { innerHeight: 844, dispatchEvent() {}, ubuAudio: { setOrientation: p => audioOrientations.push(p) } },
    localStorage: mockStorage,
    P, ububallMatch, $,
    inDiscord: false,
    location: new URL('https://ububall.com/'),
    scrollY: 0, scrollTo() {}, addEventListener() {},
    matchMedia: mockMatchMedia,
    reducedMotion: { matches: false },
    stageArea: { getBoundingClientRect: stageRect },
    btnRotate,
    btnFullscreen,
    canvas: { getBoundingClientRect: canvasRect },
    bodies: P.kickoff(),
    shakeX: 0, shakeY: 0, isPortrait: false, videoField: null, matchMode: 'standard',
    fieldView: {
      portrait: false,
      field: null,
      bodies: P.kickoff(),
      mode: 'standard',
      castHidden: false,
      canvas: { getBoundingClientRect: canvasRect }
    },
    pullBehind: false,
    impulseGeometry: (b, plan) => ({
      visible: plan.power > 0,
      ringR: 25,
      scale: 120,
      distance: 25 + plan.power * 120,
      x: b.x + Math.cos(plan.angle) * (25 + plan.power * 120),
      y: b.y + Math.sin(plan.angle) * (25 + plan.power * 120)
    }),
    gameUi: { scale: () => 1, updateScale() {} },
    selected: 0,
    plans: [
      { angle: 0, power: 0.6, spin: 0, guard: false },
      { angle: 0, power: 0, spin: 0, guard: false },
      { angle: 0, power: 0, spin: 0, guard: false }
    ],
    phase: 'plan',
    spinSlider: true,
    drag: null,
    endCanvasDrag() {},
    sync() {},
    firstTurnStep: 'aim',
    firstTurnStarted: null,
    placeFinger() {},
    hideFinger() {},
    foulInfo: null,
    foulInfoKey: '',
    foulBox: $('foul-box'),
    fouls: { crease: [true, false], corner: null, cornerTurns: 0, cards: [] },
    foulInfoLines: () => ['Goal camping', [{ text: 'Move out', act: true }]],
    stalling: () => false,
    isCreasing: () => true,
    cornerTeams: () => [[], []],
    sideName: t => t ? 'CPU' : 'You',
    sideHas: t => t ? 'CPU has' : 'You have',
    ubuCount: n => `${n} ubus`,
    CARD_TEXT: 'out for a turn',
    goalReplay: null,
    replaySkip: $('skip-goal-replay'),
    demo: true,
    online: null,
    theater: null,
    recording: null,
    setupFor: 'cpu',
    chosenMode: () => 'standard',
    draft: [{ key: 'u0', model: {} }, { key: 'u1', model: {} }, { key: 'u2', model: {} }],
    signedIn: () => true,
    teamSlotsOf: () => null,
    sameSlots: () => false,
    savedTeams: null,
    teamIndex: -1,
    ubuRender: Object.assign(() => makeEl('svg'), { spriteImg: () => makeEl('img') }),
    lobbyView: null,
    fixedTeam: () => false,
    loadCollection: async () => {},
    loadTeams: async () => {},
    rosterSlots() { $('roster-slots').replaceChildren(makeEl('s0'), makeEl('s1'), makeEl('s2')); },
    lastCpuSetup: null,
    fitScorebug() {},
    closeFirstTurnGuide() { phoneCtx.firstTurnStep = null; },
    closeFoulInfo() { phoneCtx.foulInfo = null; },
    closeSummary() {},
    stopFanfare() {},
    gameAudio: () => ({ stopMotion() {} }),
    isExporting: () => false,
    statDrawer: { matches: () => false, hidePopover() {} },
    endReplay() {},
    cpuClient: { dispose() {} },
    demoClient: { dispose() {} },
    startDemo() { phoneCtx.demo = true; },
    stopDemo() { phoneCtx.demo = false; },
    newMatch() {},
    cancelAnimationFrame() {},
    castHome() {},
    castTo: away => { castCalls.push(away); },
    history: { state: null, pushState(s) { this.state = s; }, replaceState() {} },
    layoutDirty: false,
    draw() {
      phoneCtx.layoutDirty = false;
      env.measureField();
      env.positionSpinControl();
      env.updateFoulInfo();
    },
    stadium,
    rinkStage,
    rinkWrap,
    document: {
      hidden: false,
      fullscreenElement: null,
      fullscreenEnabled: true,
      addEventListener() {},
      createElement: tag => makeEl(tag),
      body: { dataset: { shot: 'home' }, style: { setProperty(k, v) { this[k] = v; } }, classList: makeClassList() },
      querySelector: sel => sel === '.ball-page' ? { getBoundingClientRect: () => ({ top: 56 }) } : null
    }
  };

  const env = runInNewContext(
    stageCode + '\n;({ getShot: () => shot, compactPhoneStage, playableShot, canDock, prepareSheet, setupStep, openSheet, enterMatch, screenTransition, toggleRotate, setPortrait, fitOrientation, point, stagePoint, measureField, positionSpinControl, updateFoulInfo, screenDegrees, setKnob, knobValue });',
    phoneCtx
  );

  // A. Stacked rules & team setup on portrait phone: canDock is true, docks #roster-dialog + .formation.on-ice, cuts camera without FLIP
  assert.equal(env.compactPhoneStage(), true, 'portrait phone activates compactPhoneStage()');
  assert.equal(env.canDock(), true, 'phones dock #roster-dialog on / instead of falling back to modal');
  env.prepareSheet();
  env.setupStep('mode');
  env.openSheet();
  assert.equal($('roster-dialog').classList.contains('docked'), true, '#roster-dialog receives .docked on phone');
  assert.equal($('roster-dialog').modalOpened, false, '#roster-dialog uses non-modal show() on phone');
  assert.equal($('roster-slots').classList.contains('on-ice'), true, '#roster-slots mounts .on-ice inside .rink-stage on phone');
  assert.equal(rinkStage.children.includes($('roster-slots')), true);
  assert.equal(env.getShot(), 'rules');
  assert.equal(animCalls, 0, 'phone cuts directly to rules shot without FLIP camera animation');
  assert.deepEqual(castCalls, [true], 'cast still scatters off the ice on phone setup');

  // Step to team shot & rotate phone to short landscape (isPortraitScreen=false, isWide=false) -> sheet stays open!
  env.setupStep('team');
  assert.equal(env.getShot(), 'team');
  isPortraitScreen = false;
  isWide = false;
  mediaListeners.get('wide')?.();
  assert.equal($('roster-dialog').open, true, 'rotating/resizing between portrait and landscape keeps docked setup open');
  assert.equal(env.compactPhoneStage(), true, 'short landscape phone (wideScreen.matches === false) also activates compactPhoneStage()');

  // B. Short landscape phone cuts camera across Mint and Collection (skipping rotate/stretch) AND playableShot() is immediately true on Match
  $('roster-dialog').close();
  assert.equal(env.getShot(), 'home');
  assert.equal(animCalls, 0, 'short landscape phone cuts back to home without FLIP');

  phoneCtx.location = new URL('https://ububall.com/collection');
  env.screenTransition('collection', () => {}, 'play');
  assert.equal(env.getShot(), 'collection');
  assert.equal(animCalls, 0, 'short landscape phone cuts into Collection without rotate/stretch steps');
  assert.equal(phoneCtx.fieldView.portrait, false, 'Collection never sets stadium .portrait-mode');

  phoneCtx.location = new URL('https://ububall.com/mint');
  env.screenTransition('mint', () => {}, 'collection');
  assert.equal(env.getShot(), 'mint');
  assert.equal(animCalls, 0, 'short landscape phone cuts from Collection to Mint without shrink/rotate');

  phoneCtx.location = new URL('https://ububall.com/');
  env.screenTransition('play', () => {}, 'mint');
  env.enterMatch('match');
  assert.equal(env.getShot(), 'match');
  assert.equal(animCalls, 0, 'short landscape phone cuts into Match without FLIP delay');
  assert.equal(env.playableShot(), true, 'aiming input is immediately playable on phone Match entry');
  assert.equal(phoneCtx.fieldView.portrait, false, 'landscape phone Match defaults to landscape rink');

  // C. Portrait play orientation & isolation: portrait phone enters portrait play without polluting localStorage; manual #btn-rotate scopes to screen orientation
  isPortraitScreen = true;
  mediaListeners.get('portrait')?.();
  assert.equal(phoneCtx.fieldView.portrait, true, 'rotating phone to portrait during Match enters portrait play');
  assert.equal(stadium.classList.contains('portrait-mode'), true);
  assert.equal(mockStorage.getItem('ububall-orientation'), null, 'automatic portrait play does not pollute localStorage');

  // Manual toggleRotate on portrait screen stores 'portrait:landscape', which does NOT force landscape screen into portrait or vice versa
  env.toggleRotate();
  assert.equal(phoneCtx.fieldView.portrait, false);
  assert.equal(mockStorage.getItem('ububall-orientation'), 'portrait:landscape');

  // Switching back to portrait manually stores 'portrait:portrait'; rotating to landscape screen ignores portrait-only override and clears on change
  env.toggleRotate();
  assert.equal(phoneCtx.fieldView.portrait, true);
  assert.equal(mockStorage.getItem('ububall-orientation'), 'portrait:portrait');

  // Leaving Match for Mint resets portrait-mode to false WITHOUT erasing saved match orientation
  phoneCtx.location = new URL('https://ububall.com/mint');
  env.screenTransition('mint', () => {}, 'play');
  assert.equal(phoneCtx.fieldView.portrait, false, 'Mint never inherits .portrait-mode');
  assert.equal(stadium.classList.contains('portrait-mode'), false);
  assert.equal(mockStorage.getItem('ububall-orientation'), 'portrait:portrait', 'non-match setPortrait(false) preserves saved match orientation');

  // Returning to Match on a landscape desktop/phone does NOT inherit 'portrait:portrait'
  isPortraitScreen = false;
  phoneCtx.location = new URL('https://ububall.com/');
  env.enterMatch('match');
  assert.equal(phoneCtx.fieldView.portrait, false, 'landscape screen ignores portrait-screen manual override');

  // Switch back to portrait play to verify portrait coordinate mapping, knobs, spin slider, guide, and foul box
  isPortraitScreen = true;
  mediaListeners.get('portrait')?.();
  assert.equal(phoneCtx.fieldView.portrait, true);
  env.measureField();

  // D. Portrait play coordinate round-trip (stagePoint <-> point), quarter-turn angle knob, spin control, and foul warning placement
  const cr = canvasRect();
  for (const sample of [{ x: 180, y: 300 }, { x: 500, y: 300 }, { x: 820, y: 120 }, { x: 310, y: 480 }]) {
    const clientX = cr.left + (sample.y / 600) * cr.width;
    const clientY = cr.top + (1 - sample.x / 1000) * cr.height;
    const mapped = env.point({ clientX, clientY });
    assert.ok(Math.abs(mapped.x - sample.x) < 1e-6 && Math.abs(mapped.y - sample.y) < 1e-6, 'point() inverts portrait rink transform');
  }

  // Field angle 0 (toward opponent goal at x=1000, top of portrait screen) is 0 screen degrees (up); 90° screen (right) is +y (Math.PI / 2)
  assert.equal(Math.round(env.screenDegrees(0)), 0, 'field angle 0 points straight up (0°) in portrait play');
  env.setKnob('angle', 0, 90);
  assert.ok(Math.abs(phoneCtx.plans[0].angle - Math.PI / 2) < 1e-6, '90° knob angle points right (+y) in portrait play');
  env.setKnob('angle', 0, 0);
  assert.ok(Math.abs(phoneCtx.plans[0].angle) < 1e-6, '0° knob angle points up (+x) in portrait play');

  // Spin control sits below skater 0 when aiming upward in portrait play
  env.positionSpinControl();
  assert.equal($('field-spin').style.visibility, 'visible');
  const skaterStage = env.stagePoint(phoneCtx.fieldView.bodies[0]);
  const spinMatch = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec($('field-spin').style.transform);
  assert.ok(spinMatch, 'spin control has 3d transform in portrait play');
  assert.ok(Number(spinMatch[2]) > skaterStage.y, 'spin control places below skater opposite upward aim arrow in portrait play');

  // Foul info box for home crease (team 0, bottom of portrait rink) places over the far top half (along = 0.27)
  phoneCtx.foulInfo = { kind: 'crease', team: 0 };
  env.updateFoulInfo();
  assert.equal($('foul-box').hidden, false);
  assert.ok(parseFloat($('foul-box').style.top) < stageRect().height * 0.45, 'home-crease foul box sits over far top half of portrait rink');
});
