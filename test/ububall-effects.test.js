'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ububallPresentation = require('../web/ububall-presentation.js');
const ububallPlayback = require('../web/ububall-playback.js');
const ububallStats = require('../web/ububall-stats.js');
const ububallTheater = require('../web/ububall-theater.js');
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
  Object.assign(context, { createEffectsState, updateParticles, ububallPresentation, ububallPlayback, ububallStats, ububallTheater, createPlaybackDriver: ububallPlayback.createPlaybackDriver, matchMvp: ububallStats.matchMvp, replayFileName: ububallStats.replayFileName });
  context.fieldView = fixtureState({ mode: 'matchMode', entries: 'teamEntries', anonymous: 'anonymousNames',
    portrait: 'isPortrait', field: 'videoField' });
  return vm.runInNewContext(code, context);
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

  // Sub-pixel rounding drift (<= 1px) does not erase trails; jumps > 1px do
  h.bodies[0].x += 0.5;
  h.clearDiscontinuousTrails(before);
  assert.equal(h.trails[0].length, 2, 'sub-pixel drift retains trail');
  h.bodies[0].x += 2;
  h.clearDiscontinuousTrails(before);
  assert.equal(h.trails[0].length, 0, 'real discontinuity (>1px) clears trail');
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

test('updatePopups ages popups independently and prunes expired ones', () => {
  const popups = [
    { text: 'Trap!', life: 0.5 },
    { text: 'Spin strike!', life: 0.1 }
  ];
  updatePopups(0.2, popups, false);
  assert.equal(popups.length, 1);
  assert.equal(popups[0].text, 'Trap!');
  assert.ok(Math.abs(popups[0].life - 0.3) < 1e-6);

  // Reduced motion keeps and ages popups instead of wiping them immediately
  updatePopups(0.1, popups, true);
  assert.equal(popups.length, 1);
  assert.ok(Math.abs(popups[0].life - 0.2) < 1e-6);
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

test('heat effect animation time accumulates during updateEffects and freezes during Pulse mode freeze frames', () => {
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const fx = createEffectsState([], {});
  assert.equal(fx.heatTime, 0, 'heatTime initializes to 0');

  const bodies = P.kickoff();
  let reduced = false, clearedPostGoal = 0, sizzleStopped = 0;
  fx.sizzle = { stop() { sizzleStopped++; } };
  const presenter = createRinkPresenter({
    P, ububallMatch,
    getView: () => ({ bodies, mode: 'pulse', canvas: { width: 1000, height: 600 }, ctx: {}, badgeCanvas: { width: 1000, height: 600 }, badgeCtx: {} }),
    getEffects: () => fx,
    isReducedMotion: () => reduced,
    onClearPostGoal: () => { clearedPostGoal++; },
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

  // 3. Reduced motion clears transient VFX without wiping postGoal, goalCall, popups, throttles, or sizzle audio
  reduced = true;
  fx.particles.push({ x: 10, y: 10, px: 10, py: 10, vx: 0, vy: 0, life: 0.5, duration: 0.5 });
  fx.shake = 1;
  fx.goalCall = { team: 0, label: 'GOAL', scorer: 0, name: 'Test', t: 0 };
  fx.lastFireHitSound = 500;
  presenter.popup(bodies[0], 'Save!');
  assert.equal(fx.popups.length, 1, 'popup shows even with reduced motion enabled');
  presenter.updateEffects(0.2);
  assert.equal(fx.particles.length, 0, 'reduced motion clears transient particles');
  assert.equal(fx.shake, 0, 'reduced motion clears shake');
  assert.equal(clearedPostGoal, 0, 'reduced motion does not abort postGoal');
  assert.equal(sizzleStopped, 0, 'reduced motion does not call quench every frame');
  assert.equal(fx.lastFireHitSound, 500, 'reduced motion preserves sound throttles');
  assert.equal(fx.popups.length, 1, 'reduced motion preserves active popups');
  assert.ok(Math.abs(fx.goalCall.t - 0.2) < 1e-6, 'reduced motion ages goalCall cleanly');
  reduced = false;

  // 4. Clear effects resets heatTime and full state
  presenter.clearEffects();
  assert.equal(fx.heatTime, 0, 'clearEffects resets heatTime to 0');
  assert.equal(clearedPostGoal, 1, 'clearEffects still resets postGoal outside reduced motion');
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
    playSpinTwirl: o => (calls.twirl ||= []).push(o),
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
  env.handleCollision({ a: bodies[4], b: bodies[6], speed: 340, impulse: 500, plow: false, iron: false, snapped: true, spinStruck: false, tangentImpulse: 0 }); // Away team (team 1) Snap
  assert.equal(calls.ball.at(-1)?.snap, true, "Snap passes snap: true to playBallHit");
  assert.equal(fx.shockwaves.length, wBeforeSnap + 2, "Snap emits twin team-colored shockwave rings");
  assert.equal(fx.shockwaves.at(-1).team, 1, "Snap shockwave uses redirecting skater team color");
  assert.equal(fx.shockwaves.at(-1).color, null, "Snap shockwave dynamically resolves team color");
  const snapParticles = fx.particles.slice(pBeforeSnap);
  assert.ok(snapParticles.length >= 20, "Snap emits dramatic burst of team-colored particles");
  assert.equal(snapParticles.some(p => p.color === "#ffd76b"), false, "Snap no longer uses hardcoded gold");
  assert.ok(snapParticles.some(p => p.flash && p.team === 1), "Snap includes compact team-colored flash");
  assert.ok(snapParticles.some(p => p.materialShape === "streak" && p.team === 1), "Snap includes team-colored directional streaks");

  // 1b. Point-blank plain strike gets whip sound + impact ring without twirl; Spin strike (>=10 rad/s) adds playSpinTwirl & ubu twirl
  now += 200;
  const wBeforePlain = fx.shockwaves.length;
  Object.assign(bodies[6], { x: 460, y: 300, vx: 620, vy: 0, omega: 0 });
  Object.assign(bodies[0], { x: 416, y: 300, omega: 0 });
  env.handleCollision({ a: bodies[0], b: bodies[6], speed: 360, impulse: 480, plow: false, iron: false, snapped: false, struck: true, spinStruck: false, tangentImpulse: 0 });
  assert.equal(calls.whip.length, 1, "Point-blank plain strike triggers playSpinStrike whip sound");
  assert.equal((calls.twirl || []).length, 0, "Plain strike does not trigger playSpinTwirl");
  assert.equal(fx.shockwaves.slice(wBeforePlain).some(s => s.spinTwirl), false, "Plain strike does not spawn ubu twirl");
  assert.ok(fx.shockwaves.slice(wBeforePlain).length >= 1, "Plain strike emits impact ring");

  now += 200;
  const wBeforeSpin = fx.shockwaves.length;
  Object.assign(bodies[6], { x: 460, y: 300, vx: 620, vy: -80, omega: -16 });
  Object.assign(bodies[0], { x: 416, y: 300, omega: 14 });
  env.handleCollision({ a: bodies[0], b: bodies[6], speed: 360, impulse: 480, plow: false, iron: false, snapped: false, struck: true, spinStruck: true, tangentImpulse: 0 });
  assert.equal(calls.whip.length, 2, "Spin strike triggers playSpinStrike whip sound");
  assert.equal((calls.twirl || []).length, 1, "Spin strike adds playSpinTwirl twirling sound");
  const twirlWave = fx.shockwaves.slice(wBeforeSpin).find(s => s.spinTwirl);
  assert.ok(twirlWave && twirlWave.target === bodies[0], "Spin strike spawns spinTwirl vortex over the striking ubu");

  // 1c. Flaming ball impacts trigger playFireImpact on skater hit and flaming wall bounce (but not on Cannonball ignition tick)
  now += 200;
  Object.assign(bodies[6], { onFire: true, fireTicks: 60, vx: 880, vy: 0 });
  env.handleCollision({ a: bodies[3], b: bodies[6], speed: 520, impulse: 600, plow: true, iron: false, snapped: false, spinStruck: false, tangentImpulse: 0 });
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
  env.handleCollision({ a: bodies[2], b: bodies[3], speed: 50, impulse: 120, plow: false, iron: false, snapped: false, spinStruck: false, tangentImpulse: 480 });
  assert.equal(calls.collision.length, cBefore + 1);
  assert.ok(calls.collision.at(-1).volume > 0.35, "Hip Clip tangential spin impulse scales check audio volume");

  // Strict scope invariant: zero popup banners for any of these mechanics
  assert.equal(popups.length, 0, "none of these mechanics create floating text popups");

  // 7. Offline MP4 export audio adapter exposes all new movement, spin, impact, save, and firework methods
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
    playSpinTwirl: o => forwarded.push(["twirl", o]),
    playFireImpact: o => forwarded.push(["fire", o]),
    playSave: o => forwarded.push(["save", o]),
    playFirework: o => forwarded.push(["firework", o]),
    playWallHit: o => forwarded.push(["wall", o]),
    playGoalHit: (t, o) => forwarded.push(["goal", t, o]),
    playSuper: () => {}, playSizzle: () => {}, playFoul: () => {}, playIronSave: () => {}, playFanfare: () => {}
  };
  const adapter = ububallTheater.offlineAudio(fakeUbuAudio, { sampleRate: 48000 }, () => 2.5);
  assert.ok(sharedCtx && sharedCtx.currentTime === 2.5);
  adapter.playBallHit({ volume: 0.9, snap: true });
  adapter.playGoalHit("post", { volume: 0.9, spin: 16, speed: 480 });
  adapter.playUbuMove({ id: 0, speed: 400 });
  adapter.playSpin({ id: 0, omega: 12 });
  adapter.playPuckSlide({ speed: 500 });
  adapter.playCarve({ volume: 0.6 });
  adapter.playSlipstream({ volume: 0.5 });
  adapter.playSpinStrike({ spin: 15 });
  adapter.playSpinTwirl({ spin: 15 });
  adapter.playFireImpact({ volume: 0.8 });
  adapter.playSave({ own: false });
  adapter.playFirework({ ring: false });
  adapter.stop();
  assert.deepEqual(forwarded.map(e => e[0]), [
    "ball", "goal", "move", "spin", "puck", "carve", "slipstream", "whip", "twirl", "fire", "save", "firework", "stopMotion"
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
  for (const rel of ['web/index.html', 'web/demo.html', 'web/voice.html', 'web/ububall.html', 'web/site-header.js', 'web/app.js', 'web/ububall.js', 'web/ububall-playback.js', 'web/ububall-stats.js', 'web/ububall-theater.js', 'web/site.js']) {
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
    ['start', 'planning', 'movement', 'impacts', 'saves', 'supers', 'fouls', 'goals', 'stage'],
    'groups follow exact match + stage occurrence order'
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
    playSpinTwirl: () => { audioHits.add('playSpinTwirl'); },
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
    playPack: kind => { audioHits.add(`playPack:${kind}`); },
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
    collide: contact => presenter.handleCollision(contact),
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
    runStageCast: mode => { view.castHidden = mode !== 'return'; },
    runStageLineup: variant => { view.castHidden = variant === 'arrive'; },
    runStageMint: variant => {
      view.castHidden = true;
      if (variant === 'deal') mockAudio.playPack('deal');
      else if (variant === 'pick') callbacks.push({ at: 0.1, fn: () => mockAudio.playPack('pick') });
      else if (variant === 'crack') callbacks.push({ at: 0.1, fn: () => mockAudio.playPack('crack') });
      else {
        callbacks.push({ at: 0.1, fn: () => mockAudio.playPack('reveal') });
        callbacks.push({ at: 0.25, fn: () => mockAudio.playPack('scamper') });
      }
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
    'playCarve', 'playSlipstream', 'playSpinStrike', 'playSpinTwirl', 'playWallHit', 'playFireImpact',
    'playSave', 'playFirework', 'playGoalHit:post', 'playGoalHit:net',
    'playSizzle', 'playIronSave', 'playSuper', 'playFoul:warning', 'playFoul:card',
    'playVoice', 'playFanfare',
    'playPack:deal', 'playPack:pick', 'playPack:crack', 'playPack:reveal', 'playPack:scamper'
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

test('D4-11, D4-16, D4-17, D4-18, D4-20, D2-10, D4-02: UI icon/grid rules, clearEffects scrub cooldown reset, null-winner attribution, and cross-domain contracts', () => {
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const presSrc = fs.readFileSync(require.resolve('../web/ububall-presentation.js'), 'utf8');
  const playbackSrc = fs.readFileSync(require.resolve('../web/ububall-playback.js'), 'utf8');
  const statsSrc = fs.readFileSync(require.resolve('../web/ububall-stats.js'), 'utf8');
  const theaterSrc = fs.readFileSync(require.resolve('../web/ububall-theater.js'), 'utf8');
  const cssSrc = fs.readFileSync(require.resolve('../web/ububall.css'), 'utf8');

  // 1. D4-11: Zero emoji/text-arrow icons across ububall.js and extracted modules
  for (const [name, txt] of [['ububall.js', source], ['ububall-presentation.js', presSrc], ['ububall-playback.js', playbackSrc], ['ububall-stats.js', statsSrc], ['ububall-theater.js', theaterSrc]]) {
    assert.equal(txt.includes('💫'), false, `${name} has no 💫 emoji icon`);
    assert.equal(txt.includes("'→'"), false, `${name} has no raw → text icon`);
  }
  assert.match(statsSrc, /gameUi\.icon\('arrow-narrow-right'\)/, 'stats event log uses Tabler arrow-narrow-right icon');

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
    const summaryEls = new Map();
    const $ = id => {
      if (!summaryEls.has(id)) summaryEls.set(id, { textContent: '', hidden: false, open: false, showModal() { this.open = true; }, close() {} });
      return summaryEls.get(id);
    };
    $('home-label').textContent = 'Alice';
    $('opponent-label').textContent = 'Bob';
    const env = ububallPlayback.createSummaryController({
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
    const ububallCPU = require('../shared/ububall-cpu.js');
    let receivedState = null;
    const play = ububallMatch.newPlay({ age: 42, last: 1, lastTouch: [1, null], banked: true });
    const env = ububallPlayback.createCpuTurnPlanner({
      cpuGeneration: 0, cpuDone: false, cpu: [], cpuReady: null,
      online: null, demo: false, demoLevels: ['medium', 'hard'], cpuLevel: 'hard',
      P, ububallCPU, ububallMatch, simBodies: P.kickoff(), stats: [], scores: [2, 1], turn: 4,
      fouls: ububallMatch.newFouls(), matchMode: 'pulse', matchTicks: 480, roundTurns: 2, play,
      phase: 'plan', saveActiveMatch: () => {},
      cpuClient: {
        cancel() {},
        plan(state) { receivedState = state; return Promise.resolve({ plans: ububallCPU.cpuPlans(P.kickoff(), () => 0.5, [0, 0]) }); }
      }
    });
    env.prepareCPU();
    assert.equal(receivedState.clock, 480, 'D2-10: prepareCPU passes matchTicks as clock');
    assert.equal(receivedState.roundTurns, 2, 'D2-10: prepareCPU passes roundTurns');
    assert.equal(receivedState.play.age, 42, 'D2-10 & A6: prepareCPU nests play state under state.play');
    assert.equal(receivedState.play.last, 1);
    assert.equal(receivedState.play.banked, true);
    assert.equal(receivedState.age, undefined);
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

  const env = ububallPlayback.createStageController(ctx);

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
  env.resetSetupSlots();
  env.setupStep('mode');
  env.openSheet();
  assert.equal($('pause-menu').open, false, 'docked mid-match setup closes modal pause menu');
  assert.equal(env.sheetOpen(), true, 'setup panel opens in docked rules shot during match');
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
  env.closeSheet();
  assert.equal(env.getShot(), 'match', 'cancelling mid-match setup returns to match shot');
  assert.equal(ctx.document.body.dataset.shot, 'match');
  assert.equal(ctx.isPortrait, true, 'cancelling mid-match setup restores previous match portrait orientation');
  assert.deepEqual(castArgs, [true, false], 'match cast skates back onto the ice');
  ctx.isPortrait = false;

  // C. Online lobby handoff -> closeLobby when game starts transitions directly from team -> match without bouncing through home
  ctx.setupFor = 'lobby';
  $('roster-dialog').dataset.for = 'lobby';
  ctx.lobbyView = { state: { mode: 'standard', canChangeRules: false }, ready: true };
  env.resetSetupSlots();
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

  const stageEnv = ububallPlayback.createStageController(stageCtx);

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
    const canvas = makeDomNode('canvas', starterId + '-canvas');
    if (starterId === 'signup-stage-pack') {
      // Simulate the oversized 200% x 280% Mint canvas inside the .candy-pack button box.
      btn.getBoundingClientRect = () => ({ left: 410, top: 270, right: 790, bottom: 500, width: 380, height: 230 });
      canvas.getBoundingClientRect = () => ({ left: 220, top: 75, right: 980, bottom: 719, width: 760, height: 644 });
    }
    btn.append(canvas);
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
    ubu, ubuFile, rarity, ability: require('../shared/ability.js'), ubuArchetype, ububallPhysics: P,
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
      let packType = 'foil', packCharge = 0;
      return {
        async play(amount, models, options) {
          unwrapCalls.push({ amount, count: models.length, silhouette: Boolean(options?.silhouette), type: packType, charge: packCharge });
        },
        awaitingTap: () => false,
        tap: () => false,
        reset() {},
        setStarter() { packType = 'starter'; packCharge = 0; },
        setHints(type, _hints, charge = 0) { packType = type; packCharge = charge; },
        getCharge: () => packCharge,
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
            { choice: 'tok-0', type: 'foil', charge: 3, hints },
            { choice: 'tok-1', type: 'gift', charge: 0, hints },
            { choice: 'tok-2', type: 'plastic', charge: 5, hints }
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
  assert.ok(Math.abs(starterUbu0Anim.keyframes[0].scale - (208 * 380 / 600) / 64) < 1e-4, 'capturePackEmergence scales against the .candy-pack button rather than the overflowing canvas');
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
  let rafCallback = null;
  const packSceneCtx = {
    Math, Number, String, Boolean, Array, Object, Map, Set, Promise, Uint8Array, Uint32Array, parseInt,
    crypto: globalThis.crypto,
    navigator: { userActivation: { hasBeenActive: false } },
    devicePixelRatio: 1,
    performance: { now: () => 0 },
    requestAnimationFrame: fn => { rafCallback = fn; return 1; },
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

  const transforms = [];
  const paddedBtn = {
    clientWidth: 300, clientHeight: 180,
    getBoundingClientRect: () => ({ left: 100, top: 100, width: 300, height: 180 }),
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }
  };
  const paddedCanvas = {
    clientWidth: 600, clientHeight: 504, width: 600, height: 504,
    offsetLeft: -150, offsetTop: -153, offsetParent: paddedBtn, parentElement: paddedBtn, dataset: {},
    getBoundingClientRect: () => ({ left: -50, top: -53, width: 600, height: 504 }),
    getContext: () => ({ ...noopCtx(), setTransform: (...args) => transforms.push(args) })
  };
  const paddedScene = packSceneCtx.createPackScene(paddedCanvas);
  paddedScene.setType('egg');
  rafCallback(16);
  assert.deepEqual(transforms.at(-1), [0.5, 0, 0, 0.5, 300, 180 * 0.46 + 153],
    'pack-scene centers and scales transform to .candy-pack host when canvas overflows');

  // Verify Charged Packs Stages 1..5, coexistence with Special packs, silhouetted crackle/sparkle, and first-open vs revisit card effects
  const abilityMod = require('../shared/ability.js');
  // Re-deal checks on pack-choices
  const dealtCards = getMintEl('pack-choices').children;
  assert.equal(dealtCards[0].classList.contains('charged'), true, 'Stage 3 choice gets .charged class');
  assert.equal(dealtCards[0].dataset.charge, '3', 'Stage 3 choice records data-charge=3');
  assert.equal(dealtCards[1].classList.contains('charged'), false, 'Stage 0 choice is uncharged');
  assert.equal(dealtCards[2].classList.contains('charged'), true, 'Stage 5 choice gets .charged class');
  assert.equal(dealtCards[2].dataset.charge, '5', 'Stage 5 choice records data-charge=5');
  assert.equal(dealtCards[2].style.getPropertyValue('--pack-glow'), '#0066ff', 'Stage 5 pack glow reaches pure Volt #0066FF');
  assert.match(dealtCards[0].children[0].getAttribute('aria-label'), /charged stage 3 of 5/, 'accessible label announces charge stage');

  // Verify real pack-scene.js handles all 8 wrappers across Stages 0..5 and respects prefers-reduced-motion
  let scheduledFrames = 0;
  let reducedPref = false;
  let unwrapChargedCall = null;
  const chargedSceneCtx = {
    Math, Number, String, Boolean, Array, Object, Map, Set, Promise, Uint8Array, Uint16Array, Uint32Array, parseInt,
    crypto: globalThis.crypto,
    navigator: { userActivation: { hasBeenActive: true } },
    devicePixelRatio: 1,
    performance: { now: () => 320 },
    requestAnimationFrame: fn => { scheduledFrames++; rafCallback = fn; return scheduledFrames; },
    cancelAnimationFrame() {},
    matchMedia: () => ({ get matches() { return reducedPref; }, addEventListener() {} }),
    ResizeObserver: class { observe() {} },
    Image: class { set src(_) {} },
    ubuAudio: {
      playUnwrap(type, dur, opts) { unwrapChargedCall = { type, dur, charge: opts?.charge }; },
      playPack() {}
    },
    document: { createElement: () => ({ width: 64, height: 64, dataset: {}, getContext: noopCtx }) }
  };
  chargedSceneCtx.globalThis = chargedSceneCtx;
  runInNewContext(packSceneSrc, chargedSceneCtx);
  const sampleHints = Array.from({ length: 5 }, (_, idx) => ({ background: '#ff9954', accents: ['#fff', '#fff', '#fff', '#fff'], textured: idx === 4 }));
  for (const wType of chargedSceneCtx.createPackScene.types) {
    const c = {
      clientWidth: 300, clientHeight: 180, width: 300, height: 180, dataset: {},
      parentElement: { addEventListener() {} },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 180 }),
      getContext: noopCtx
    };
    const sc = chargedSceneCtx.createPackScene(c);
    sc.setHints(wType, sampleHints, 4);
    assert.equal(sc.getCharge(), 4);
    assert.equal(c.dataset.charge, '4');
    const beforeRaf = scheduledFrames;
    rafCallback(400);
    assert.equal(scheduledFrames, beforeRaf + 1, `${wType} Charged Pack animates electric particles when motion is allowed`);
    reducedPref = true;
    const reducedBefore = scheduledFrames;
    rafCallback(460);
    assert.equal(scheduledFrames, reducedBefore, `${wType} Charged Pack skips continuous RAF loop under prefers-reduced-motion`);
    reducedPref = false;
  }
  const unwrapCanvas = {
    clientWidth: 300, clientHeight: 180, width: 300, height: 180, dataset: {},
    parentElement: { addEventListener() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 180 }),
    getContext: noopCtx
  };
  const unwrapScene = chargedSceneCtx.createPackScene(unwrapCanvas);
  unwrapScene.setHints('gift', sampleHints, 5);
  void unwrapScene.play(5, [], { silhouette: true });
  assert.equal(unwrapChargedCall?.charge, 5, 'unwrap forwards pack charge stage to ubuAudio.playUnwrap');
});

test('Charged & Material silhouetted ubus and first-open vs revisited tradingCard effects', async () => {
  const crypto = require('node:crypto');
  const P = require('../shared/ububall-physics.js');
  const ubu = require('../shared/ubu.js');
  const ubuFile = require('../shared/ubu-file.js');
  const rarity = require('../shared/rarity.js');
  const ability = require('../shared/ability.js');
  const ubuArchetype = require('../shared/ubu-archetype.js');
  const siteSrc = fs.readFileSync(path.join(__dirname, '../web/site.js'), 'utf8');

  const keys = await crypto.webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pubJwk = await crypto.webcrypto.subtle.exportKey('jwk', keys.publicKey);

  // Build 5 deterministic ubus:
  // [0]: Charged + Matte (max stats, matte finishes)
  // [1]: Uncharged + Material (low stats, starfield material gate=31 on background)
  // [2]: Charged + Material (max stats + material)
  // [3..4]: Uncharged + Matte
  const makeDna = ({ highAbility, material }) => {
    const dna = new Uint8Array(128);
    // Bits 374..493 = 15 stats
    for (let s = 0; s < 15; s++) {
      const val = highAbility ? 250 : 20;
      const bit = 374 + s * 8, byte = bit >> 3, shift = bit & 7;
      dna[byte] = (dna[byte] & ~(0xff >> shift)) | (val >> shift);
      dna[byte + 1] = (dna[byte + 1] & ~((0xff << (8 - shift)) & 0xff)) | ((val << (8 - shift)) & 0xff);
    }
    if (material) {
      // Slot 0 gate starts at bit 64 + 8 = 72 (byte 9, bits 0..4 = 31 -> 0xF8)
      dna[9] |= 0xf8;
    }
    return dna;
  };
  const dnas = [
    makeDna({ highAbility: true, material: false }),
    makeDna({ highAbility: false, material: true }),
    makeDna({ highAbility: true, material: true }),
    makeDna({ highAbility: false, material: false }),
    makeDna({ highAbility: false, material: false })
  ];
  assert.equal(ability.isCharged(dnas[0]), true);
  assert.equal(ability.isCharged(dnas[1]), false);
  assert.equal(ability.isCharged(dnas[2]), true);

  const certs = await Promise.all(dnas.map((d, idx) => ubuFile.sign({
    mint: 'AAAAAAAAAAAAAAAAAAAAAA',
    id: Buffer.alloc(16, idx + 1).toString('base64url'),
    serial: String(idx + 1).padStart(12, '0'),
    dna: ubu.toCode(d),
    issuedAt: 1790000000 + idx,
    key: 'k1'
  }, keys.privateKey)));

  const makeNode = (tag, id = '') => {
    const classes = new Set();
    const attrs = new Map();
    const props = new Map();
    const listeners = {};
    const node = {
      tagName: tag.toUpperCase(), id, hidden: false, disabled: false, textContent: '', dataset: {}, children: [], parentElement: null,
      classList: {
        add: (...cs) => cs.forEach(c => c && classes.add(c)),
        remove: (...cs) => cs.forEach(c => classes.delete(c)),
        toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : Boolean(f); if (on) classes.add(c); else classes.delete(c); return on; },
        contains: c => classes.has(c)
      },
      set className(v) { classes.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
      get className() { return [...classes].join(' '); },
      style: { setProperty: (k, v) => props.set(k, String(v)), getPropertyValue: k => props.get(k) || '' },
      get firstChild() { return node.children[0] || null; },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => attrs.get(k) ?? null,
      removeAttribute: k => attrs.delete(k),
      after(...kids) {
        if (!node.parentElement) return;
        for (const k of kids) if (k && typeof k === 'object') k.parentElement = node.parentElement;
        const idx = node.parentElement.children.indexOf(node);
        node.parentElement.children.splice(idx + 1, 0, ...kids.filter(k => k && typeof k === 'object'));
      },
      append(...kids) { for (const k of kids) if (k && typeof k === 'object') { k.parentElement = node; node.children.push(k); } },
      replaceChildren(...kids) { node.children = []; node.append(...kids); },
      querySelector: sel => {
        const cls = sel.startsWith('.') ? sel.slice(1) : null;
        const visit = n => {
          for (const ch of n.children || []) {
            if ((cls && ch.classList?.contains(cls)) || ch.tagName?.toLowerCase() === sel) return ch;
            const found = visit(ch);
            if (found) return found;
          }
          return null;
        };
        return visit(node);
      },
      querySelectorAll: () => [],
      closest: () => null,
      contains: target => target === node,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120 }),
      addEventListener: (t, fn) => { listeners[t] = fn; },
      click() { if (!node.disabled) listeners.click?.({ preventDefault() {}, stopPropagation() {}, target: node, detail: 1 }); },
      focus() {},
      animate: () => ({ onfinish: null, oncancel: null, cancel() {} })
    };
    return node;
  };
  const els = new Map();
  const getEl = id => { if (!els.has(id)) els.set(id, makeNode('div', id)); return els.get(id); };
  for (const sid of ['daily-pack', 'signup-stage-pack', 'home-pack']) {
    const w = getEl(sid), b = makeNode('button'), c = makeNode('canvas');
    b.append(c); w.append(b);
  }
  getEl('pack-choices').hidden = true;
  getEl('mint-ubus').hidden = true;
  getEl('mint-reveal').hidden = true;
  const stageDom = makeNode('div', 'rink-stage');
  const revealCalls = [];
  const store = new Map();
  let pubKey = null;
  const win = {
    location: { pathname: '/mint' },
    navigator: { userActivation: { hasBeenActive: true } },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    requestAnimationFrame: () => 1,
    setTimeout: fn => { fn(); return 1; },
    clearTimeout() {},
    URL, Blob, TextDecoder, crypto: crypto.webcrypto,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener() {}, dispatchEvent() {},
    getUbuSession: () => ({ owner: 'acct-2', csrf: 'tok' }),
    gameUi: { icon: name => makeNode('svg', 'icon-' + name), confirm: async () => false },
    ubu, ubuFile, rarity, ability, ubuArchetype, ububallPhysics: P,
    ubuRender: Object.assign(() => makeNode('svg'), { back: () => makeNode('svg'), cardMaterials: () => makeNode('div'), token: () => makeNode('svg'), tokenBack: () => makeNode('svg') }),
    ubuAudio: {
      getAudioContext: () => null,
      parseVoiceInfo: () => ({ instrument: 'Sine', rootName: 'C4', rootFreq: 261.6, scale: 'Major', tempoBpm: 120, groove: 'Straight', grooveIndex: 0, notes: [{ midi: 60, name: 'C4', beats: 1, degree: 0, isRest: false }] }),
      playPack(kind, opts) { if (kind === 'reveal') revealCalls.push(opts); },
      stop() {}
    },
    ubuStarter: { status: { signup: false, daily: false }, known: true, async refresh() {}, async claim() { return { certificates: [] }; } },
    ubuList: {
      config: async () => ({ ready: true, login: true, mint: 'AAAAAAAAAAAAAAAAAAAAAA', lifetimeLimit: 5, keys: { k1: pubJwk.x } }),
      trustedKey: async () => (pubKey ||= await crypto.webcrypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: pubJwk.x, ext: true }, { name: 'Ed25519' }, false, ['verify'])),
      load: async () => {}, get: () => null, add() {}, setFavorite: async () => {},
      serialLabel: s => '#' + Number(s), rarityScore: p => p.toFixed(2), heartIcon: () => makeNode('svg'),
      mount: () => ({ render() {}, clearFilters() {} })
    },
    createPackScene: () => ({ async play() {}, awaitingTap: () => false, tap: () => false, reset() {}, setStarter() {}, setHints() {}, getSilhouetteTokens: () => [] }),
    fetch: async url => ({
      ok: true, status: 200,
      json: async () => url === '/api/packs'
        ? { request: 'req_0000000000000001', choices: [
            { choice: 'c0', type: 'foil', charge: 2, hints: dnas.map((_, i) => ({ background: '#0066FF', textured: i === 1 || i === 2 })) },
            { choice: 'c1', type: 'gift', charge: 0, hints: dnas.map(() => ({ background: '#FF9954', textured: false })) },
            { choice: 'c2', type: 'egg', charge: 1, hints: dnas.map(() => ({ background: '#42C66B', textured: false })) }
          ] }
        : url === '/api/mint' ? { certificates: certs } : {}
    })
  };
  const doc = {
    body: { dataset: { shot: 'mint' }, append() {} }, activeElement: null,
    getElementById: getEl, createElement: t => makeNode(t), createElementNS: (_, t) => makeNode(t),
    querySelector: sel => sel === '.rink-stage' ? stageDom : makeNode('div'),
    querySelectorAll: () => []
  };
  win.window = win; win.globalThis = win; win.document = doc;
  win.performance = { now: () => 1000 };
  Object.assign(win, { Object, Array, Set, Map, Math, Number, String, Boolean, Promise, JSON, Error, Uint8Array });

  const wait = async pred => { for (let i = 0; i < 80 && !pred(); i++) await new Promise(r => setTimeout(r, 2)); };
  runInNewContext(siteSrc, win);
  await wait(() => getEl('pack-choices').children.length === 3 && !getEl('pack-choices').hidden);

  // Pack 0 has both special (textured) and charge: 2 -> both classes coexist!
  const p0 = getEl('pack-choices').children[0];
  assert.equal(p0.classList.contains('special') && p0.classList.contains('charged'), true, 'Special + Charged coexist on pack option');

  // Open Pack 0 -> check silhouetted ubus 0..4 and first-open Card 0 (Charged, Matte)
  p0.children[0].click();
  await wait(() => !getEl('mint-reveal').hidden && getEl('card-stage').children.length === 1);

  const stageBtns = getEl('mint-ubus').children;
  assert.equal(stageBtns[0].classList.contains('is-charged'), true, 'ubu 0 marked .is-charged on stage');
  assert.equal(stageBtns[0].classList.contains('is-material'), false);
  assert.ok(stageBtns[1].querySelector('.ubu-material-fx'), 'silhouetted material ubu 1 mounts .ubu-material-fx sparkles');
  assert.ok(stageBtns[2].querySelector('.ubu-charge-fx') && stageBtns[2].querySelector('.ubu-material-fx'),
    'silhouetted dual ubu 2 mounts both .ubu-charge-fx and .ubu-material-fx');

  // Card 0 on first open: .is-first-open.is-charged-ubu, .card-art-charge-fx, .card-ability.is-charged + .ledge-charge-fx
  const card0 = getEl('card-stage').children[0];
  assert.equal(card0.classList.contains('is-first-open'), true);
  assert.equal(card0.classList.contains('is-charged-ubu'), true);
  assert.equal(card0.classList.contains('is-material-ubu'), false);
  assert.ok(card0.querySelector('.card-art-charge-fx'), 'Charged ubu mounts crackling arcs around .ubu-coin');
  assert.ok(card0.querySelector('.card-ability')?.classList.contains('is-charged'), 'Ability ledge marked .is-charged');
  assert.ok(card0.querySelector('.ledge-charge-fx'), 'Ability ledge mounts first-open .ledge-charge-fx');
  assert.deepEqual({ ...revealCalls[0] }, { charged: true, material: false });

  // Step to ubu 1 (Uncharged + Material) -> first open triggers material burst & Rarity ledge callout
  getEl('next-ubu').click();
  await wait(() => getEl('reveal-progress').textContent === '2 / 5');
  const card1 = getEl('card-stage').children[0];
  assert.equal(card1.classList.contains('is-first-open'), true);
  assert.equal(card1.classList.contains('is-material-ubu'), true);
  assert.ok(card1.querySelector('.card-art-material-fx'), 'Material ubu mounts sparkles around .ubu-coin');
  assert.ok(card1.querySelector('.card-rarity')?.classList.contains('is-material'), 'Rarity ledge marked .is-material');
  assert.ok(card1.querySelector('.ledge-material-fx'), 'Rarity ledge mounts first-open .ledge-material-fx');
  assert.deepEqual({ ...revealCalls[1] }, { charged: false, material: true });

  // Step back to already-seen ubu 0 -> .is-charged-ubu persists, but .is-first-open burst does NOT replay!
  getEl('prev-ubu').click();
  await wait(() => getEl('reveal-progress').textContent === '1 / 5');
  const card0Revisit = getEl('card-stage').children[0];
  assert.equal(card0Revisit.classList.contains('is-charged-ubu'), true);
  assert.equal(card0Revisit.classList.contains('is-first-open'), false, 'revisiting an already-seen card omits .is-first-open');
  assert.equal(revealCalls.length, 2, 'revisiting an already-seen card does not replay reveal chime');
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
  const stageEnv = ububallPlayback.createStageController(stageCtx);

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

  // Leaving Collection at mid-scroll and deep-scroll keeps the rink in view with exact scroll-matched viewTop & rotate origin
  {
    const ububallCssSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'ububall.css'), 'utf8');
    assert.match(ububallCssSrc, /\.rink-stage\.collection-shrinking\s*\{[^}]*display:\s*block\s*!important/s,
      'collection-shrinking forces display: block so flex centering never pushes #rink off-screen');
    assert.match(ububallCssSrc, /\.rink-stage\.collection-shrinking\s*>\s*:not\(\.rink-wrap\)\s*\{\s*display:\s*none\s*!important/s,
      'collection-shrinking hides target-shot stage overlays until portrait shrink finishes');

    let mockCollectionTop = -650; // mid-scroll: -650 + 2000 = 1350 >= innerHeight (900)
    const origGetRect = rinkStage.getBoundingClientRect;
    rinkStage.getBoundingClientRect = function () {
      const s = stageCtx.document.body.dataset.shot;
      if (s === 'collection') return { left: 120, top: mockCollectionTop, width: 1200, height: collectionFullHeight, bottom: mockCollectionTop + collectionFullHeight };
      return origGetRect.call(this);
    };

    stageCtx.document.body.dataset.shot = 'collection';
    stageCtx.location.pathname = '/collection';
    stageEnv.screenTransition('collection', () => {}, 'collection');
    // Force internal shot back to collection cleanly
    stageEnv.screenTransition('collection', () => {}, 'play');
    animHistory.at(-1)?.onfinish?.();
    animHistory.at(-1)?.onfinish?.();

    // Mid-scroll exit to Mint: stageTop stays at -650 (no snap to +64px) and rotates from cy0 = -650 + 1000 = 350
    animHistory.length = 0;
    stageCtx.location.pathname = '/mint';
    stageEnv.screenTransition('mint', () => {}, 'collection');
    assert.equal(rinkStage.classList.contains('collection-shrinking'), true);
    assert.equal(rinkStage.style['--shrink-top'], '0px', 'scrolled portrait rink stays flush at viewport top instead of snapping down to 64px');
    animHistory[0].onfinish();
    // Mint box is { left: 120, top: 100, width: 1200, height: 720 } -> center Y = 460; rotStageTop = -650 -> cy0 = 350 -> dy = -110
    assert.match(animHistory[1].keyframes[0].transform, /translate\(0px,\s*-110px\)\s*rotate\(-90deg\)/,
      'mid-scroll Collection -> Mint rotates directly from the scrolled portrait pose without vertical jump');
    animHistory[1].onfinish();

    // Deep-scroll exit (scrolled near bottom of 2900px rink: top = -1800, bottom = 1100 > 900) retracts to rotStageTop = 900 - 2000 = -1100
    stageCtx.location.pathname = '/collection';
    stageEnv.screenTransition('collection', () => {}, 'mint');
    animHistory.at(-1)?.onfinish?.();
    animHistory.at(-1)?.onfinish?.();
    mockCollectionTop = -1800;
    animHistory.length = 0;
    stageCtx.location.pathname = '/';
    stageEnv.screenTransition('play', () => {}, 'collection');
    assert.equal(rinkStage.classList.contains('collection-shrinking'), true);
    animHistory[0].onfinish();
    // Home box is { left: 40, top: 80, width: 750, height: 450 } -> center Y = 305; rotStageTop = -1100 -> cy0 = -100 -> dy = -405
    assert.match(animHistory[1].keyframes[0].transform, /translate\(305px,\s*-405px\)\s*rotate\(-90deg\)/,
      'deep-scroll Collection -> Play retracts to viewport-covering 3:5 bottom (-1100px) and rotates seamlessly');
    animHistory[1].onfinish();

    rinkStage.getBoundingClientRect = origGetRect;
  }

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
    let scrolledInsideApply = false, inTransition = false, popHandler = null;
    appWin.addEventListener = (t, fn) => { if (t === 'popstate') popHandler = fn; };
    appWin.scrollTo = () => { if (inTransition) scrolledInsideApply = true; };
    runInNewContext(appSrc, appWin);
    appWin.setUbuScreenTransition((_next, apply) => {
      inTransition = true;
      scrolledInsideApply = false;
      apply();
      assert.equal(scrolledInsideApply, true, 'app.js resets scroll inside applyDom before target shot measurement');
      inTransition = false;
    });
    await appWin.navigateUbuScreen('https://123456.discordsays.com/?roster=1');
    assert.equal(appWin.location.pathname, '/');
    assert.equal(appWin.location.searchParams.get('roster'), '1');
    assert.equal(appWin.location.searchParams.get('instance_id'), 'inst-77', 'navigating to /?roster=1 preserves instance_id alongside roster=1');
    appWin.location = new URL('https://123456.discordsays.com/collection?instance_id=inst-77');
    await popHandler?.();
    appWin.location = new URL('https://123456.discordsays.com/mint?instance_id=inst-77');
    scrolledInsideApply = false;
    await popHandler?.();
  }

  // 3. ububall.js Activity lobby shot, docked rules/team setup, CPU leave/resume, and Mint/Collection -> Match cast restoration
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
  const actEnv = ububallPlayback.createStageController(actCtx);

  assert.equal(actEnv.getShot(), 'lobby', 'Discord Activity boots on the lobby shot');
  assert.equal(actEnv.localPlayBlocked(), false, 'demo physics run unblocked on lobby shot');
  assert.equal(actEnv.demoPaused(), false, 'demo loop runs unpaused on lobby shot');

  // Docked Change team in Activity glides lobby -> team and returns to lobby on close
  actEnv.resetSetupSlots();
  actEnv.setupStep('team');
  actEnv.openSheet();
  assert.equal(actEnv.sheetOpen(), true);
  assert.equal(actEnv.getShot(), 'team');
  assert.deepEqual(castCalls, [true], 'demo skaters scatter off the ice for Activity Change team');
  actEnv.closeSheet();
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

  // 1. CSS invariants for stacked phone shots
  assert.match(cssSrc, /html:has\(body\[data-shot="collection"\]\)\s*\{\s*overflow-x:\s*clip;\s*\}/, 'html clips horizontal scatter overflow on Collection');
  assert.match(cssSrc, /@media \(orientation: portrait\), \(width < 56rem\), \(\(pointer: coarse\) and \(max-height: 600px\)\)[\s\S]*?body:is\(\[data-shot="team"\], \[data-shot="rules"\]\) \.ball-page/, 'ububall.css defines stacked flex layout for phone rules/team shots');
  assert.equal(/\.team-sheet\s*\{[^}]*allow-discrete/.test(cssSrc.slice(cssSrc.indexOf('Phones and narrow screens stack'))), false, 'stacked in-flow .team-sheet omits allow-discrete display hold so closing never leaves a flex box');
  assert.match(cssSrc, /@media \(max-height: 37\.5rem\)[\s\S]*?body\[data-shot="mint"\] \.rink-stage/, 'ububall.css caps Mint rink width by container height on short landscape phones');
  assert.match(siteCssSrc, /@media \(max-width: 47\.99rem\) and \(min-height: 37\.5625rem\)[\s\S]*?\.collection-viewer-host[\s\S]*?grid-column:\s*1 \/ -1/, 'narrow portrait Collection viewer spans full width with Prev/Next row below');
  assert.match(siteCssSrc, /@media \(max-height: 37\.5rem\)[\s\S]*?\.collection-viewer-frame[\s\S]*?position:\s*fixed/, 'short landscape Collection viewer frames cleanly across full viewport height');
  assert.match(cssSrc, /body:is\(\[data-shot="team"\], \[data-shot="rules"\]\) :is\(\.site-header, \.site-nav\)\s*\{\s*display:\s*none;\s*\}/, 'mobile rules/team setup hides outer site header and bottom nav');
  assert.match(cssSrc, /@media \(max-width: 47\.99rem\)[\s\S]*?body\[data-shot="collection"\] \.rink-stage[\s\S]*?width:\s*calc\(100% \* 600 \/ 484\)/, 'mobile Collection aligns portrait rink boards edge-to-edge without side gutters');
  assert.match(cssSrc, /@media \(max-width: 34rem\)[\s\S]*?\.team-sheet \.roster-grid[\s\S]*?repeat\(3,\s*minmax\(0,\s*1fr\)\)/, 'mobile Change Team scales picker ubu tiles to 3 per row');
  assert.match(siteCssSrc, /@media \(orientation: portrait\) and \(max-width: 34rem\)[\s\S]*?\.collection-ice \.ubu-grid[\s\S]*?repeat\(3,\s*minmax\(0,\s*1fr\)\)/, 'mobile portrait Collection scales ubu buttons to 3 per row');

  // 2. Exercise phone canDock, stacked rules/team, wideScreen resize preservation, compactPhoneStage camera cuts, orientation isolation, and portrait play geometry
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
    draft: [{ key: 'u0', model: { parts: { fullName: 'Piwoce Umet' } } }, { key: 'u1', model: { parts: { fullName: 'Atil Ujotat Ke' } } }, { key: 'u2', model: { parts: { fullName: 'Ejka Evusmu Aj' } } }],
    signedIn: () => true,
    teamSlotsOf: () => null,
    sameSlots: () => false,
    savedTeams: null,
    teamIndex: -1,
    ubuRender: Object.assign(() => makeEl('svg'), { spriteImg: () => makeEl('img') }),
    POSITIONS: ['Back', 'Top', 'Bottom'],
    rosterSlot: 0,
    canDrag: true,
    teamLocked: () => false,
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

  const env = ububallPlayback.createStageController(phoneCtx);

  // A. Stacked rules & team setup on portrait phone: opens docked .team-sheet panel with on-ice #roster-slots, cuts camera without FLIP
  assert.equal(env.compactPhoneStage(), true, 'portrait phone activates compactPhoneStage()');
  env.resetSetupSlots();
  env.setupStep('mode');
  env.openSheet();
  assert.equal(env.sheetOpen(), true, '#roster-dialog opens as docked .team-sheet panel on phone');
  assert.equal($('roster-dialog').modalOpened, false, '#roster-dialog never calls showModal()');
  assert.equal($('roster-slots').childElementCount, 3, 'CPU kickoff lineup populates #roster-slots on phone setup');
  assert.equal(env.getShot(), 'rules');
  assert.equal(animCalls, 0, 'phone cuts directly to rules shot without FLIP camera animation');
  assert.deepEqual(castCalls, [true], 'cast still scatters off the ice on phone setup');

  // Step to team shot & rotate phone to short landscape (isPortraitScreen=false, isWide=false) -> sheet stays open!
  env.setupStep('team');
  assert.equal(env.getShot(), 'team');
  isPortraitScreen = false;
  isWide = false;
  mediaListeners.get('wide')?.();
  assert.equal(env.sheetOpen(), true, 'rotating/resizing between portrait and landscape keeps docked setup open');
  assert.equal(env.compactPhoneStage(), true, 'short landscape phone (wideScreen.matches === false) also activates compactPhoneStage()');

  // B. Short landscape phone cuts camera across Mint and Collection (skipping rotate/stretch) AND playableShot() is immediately true on Match
  env.closeSheet();
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

  // E. teamHint omits routine "Picking an ubu puts..." copy during unlocked team editing (leaving #roster-hint empty) and compact tile/toolbar CSS invariants hold
  env.teamHint(false);
  assert.equal($('roster-hint').textContent, '', 'unlocked team editing keeps #roster-hint empty so controls stay 3 rows');
  assert.match(siteCssSrc, /\.ubu-tile-adj\s*\{[^}]*text-overflow:\s*ellipsis/, 'archetype adjective truncates with ellipsis before noun');
  assert.match(siteCssSrc, /\.ubu-tile-noun\s*\{[^}]*flex:\s*0 0 auto/, 'archetype noun stays unshrunk across all screen sizes');
  assert.match(siteCssSrc, /@media \(max-width: 47\.99rem\)[\s\S]*?\.ubu-tile-meta\s*\{\s*display:\s*none;\s*\}/, 'small screens hide grade and serial row on tiles');
  assert.match(siteCssSrc, /\.ubu-tile-value\s*\{[^}]*position:\s*absolute/, 'stat sort value overlays bottom-right of ubu art');
});

test('Rink stage Phase 7: dead layout CSS & modal setup dialog code removed, scoreboard-strip header styled, Group 9 Stage & Mint catalog added, and handoff doc completed', () => {
  const cssSrc = fs.readFileSync(require.resolve('../web/ububall.css'), 'utf8');
  const siteCssSrc = fs.readFileSync(require.resolve('../web/site.css'), 'utf8');
  const htmlSrc = fs.readFileSync(require.resolve('../web/index.html'), 'utf8');
  const siteJsSrc = fs.readFileSync(require.resolve('../web/site.js'), 'utf8');
  const headerJsSrc = fs.readFileSync(require.resolve('../web/site-header.js'), 'utf8');
  const effectsHtmlSrc = fs.readFileSync(require.resolve('../web/effects.html'), 'utf8');
  const rinkDocSrc = fs.readFileSync(require.resolve('../docs/rink-stage.md'), 'utf8');
  const { EFFECT_GROUPS } = require('../web/effects.js');

  // 1. #roster-dialog is a plain docked <section>, #roster-slots lives permanently in .rink-stage, and dead modal/CSS paths are gone
  assert.equal(htmlSrc.includes('<dialog id="roster-dialog"'), false, '#roster-dialog is no longer a <dialog>');
  assert.match(htmlSrc, /<section id="roster-dialog" class="team-sheet"/, '#roster-dialog is a docked <section class="team-sheet">');
  const rinkStageChunk = htmlSrc.slice(htmlSrc.indexOf('<div class="rink-stage">'), htmlSrc.indexOf('<div id="mint-reveal"'));
  assert.match(rinkStageChunk, /id="roster-slots" class="roster-slots"/, '#roster-slots lives permanently inside .rink-stage');

  for (const deadJs of ['canDock', 'sheetDocked', 'prepareSheet']) {
    assert.equal(source.includes(deadJs), false, `ububall.js removes legacy ${deadJs} fallback`);
  }
  assert.equal(headerJsSrc.includes('site-login-btn'), false, 'site-header.js removes dead #site-login-btn fallback');
  assert.equal(headerJsSrc.includes('account-logout'), false, 'site-header.js removes dead #account-logout fallback');
  assert.equal(siteJsSrc.includes('main[data-screen="mint"]'), false, 'site.js removes dead pre-stage <main> fallback host');

  for (const deadUbuballCss of ['.formation {', '.formation::before', '.formation::after', '.formation.on-ice', '.team-sheet.docked', '.team-sheet::backdrop', '.online-options', 'main:has(> #signed-out-panel']) {
    assert.equal(cssSrc.includes(deadUbuballCss), false, `ububall.css removes dead rule ${deadUbuballCss}`);
  }
  for (const deadSiteCss of ['main[data-screen="collection"]', '.pack-fallback', '.super-arm-btn', '.super-picker-btn']) {
    assert.equal(siteCssSrc.includes(deadSiteCss), false, `site.css removes dead rule ${deadSiteCss}`);
  }

  // 2. Scoreboard-strip .site-header styling pass
  assert.match(siteCssSrc, /\.site-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/, 'landscape .site-header uses 3-zone scoreboard grid');
  assert.match(siteCssSrc, /\.site-header::before\s*\{[\s\S]*?var\(--team-home\)[\s\S]*?var\(--team-away\)/, '.site-header carries Saffron home and Amethyst away scoreboard end-caps');
  assert.match(siteCssSrc, /\.site-nav\s*\{[\s\S]*?box-shadow:\s*inset/, '.site-nav forms a recessed scoreboard cell bay');

  // 3. Group 9 (9. Stage & Mint) in effects.html / effects.js
  assert.match(effectsHtmlSrc, /id="fx-lineup"/, 'effects.html mounts #fx-lineup stage layer');
  assert.match(effectsHtmlSrc, /id="fx-mint"/, 'effects.html mounts #fx-mint spotlight & ubu layer');
  const stageGroup = EFFECT_GROUPS.find(g => g.id === 'stage');
  assert.ok(stageGroup, 'EFFECT_GROUPS includes 9. Stage & Mint');
  assert.equal(stageGroup.title, '9. Stage & Mint');
  assert.deepEqual(
    stageGroup.items.map(i => i.id),
    ['stage-cast-scatter', 'stage-lineup-arrival', 'stage-mint-scamper'],
    'Group 9 covers cast scatter/return, lineup skate-in/out, and Mint spotlight/scamper'
  );

  // 4. Design contract docs/rink-stage.md marks all 7 phases complete and links to the archived log
  assert.match(rinkDocSrc, /All 7 phases \(Phases 1–7\) are built and complete\./, 'docs/rink-stage.md Status marks all 7 phases complete');
  assert.match(rinkDocSrc, /archive\/rink-stage-implementation-2026-11\.md/, 'docs/rink-stage.md links to archived implementation plan and log');
});

test('mobile trace fixes: offscreen goalCall/goalSweep/popup caches, skaterStyleCache CSSOM guard, updateClock hidden guard, and Portrait top REPLAY watermark', () => {
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const { createRinkPresenter, createEffectsState } = require('../web/ububall-presentation.js');

  let offscreenFillTextCalls = 0, badgeFillTextCalls = 0, badgeDrawImageCalls = 0, mainShadowBlurs = 0;
  function makeMockCtx(kind) {
    let sb = 0;
    return {
      get shadowBlur() { return sb; },
      set shadowBlur(v) { sb = v; if (kind === 'main' && v > 0) mainShadowBlurs++; },
      shadowColor: '', globalAlpha: 1, font: '', lineWidth: 1, strokeStyle: '', fillStyle: '',
      textAlign: '', textBaseline: '', lineCap: '', lineJoin: '', globalCompositeOperation: 'source-over',
      save() {}, restore() {}, setTransform() {}, clearRect() {}, translate() {}, rotate() {}, scale() {},
      beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {}, roundRect() {}, rect() {}, clip() {}, createPattern: () => ({}),
      stroke() {}, fill() {}, fillRect() {}, setLineDash() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      measureText: t => ({ width: String(t).length * 24 }),
      strokeText() {},
      fillText(t, x, y) {
        if (kind === 'offscreen') offscreenFillTextCalls++;
        if (kind === 'badge') badgeFillTextCalls++;
        if (kind === 'main') lastMainText = { text: t, lastTranslate };
      },
      drawImage() {
        if (kind === 'badge') badgeDrawImageCalls++;
      }
    };
  }
  let lastTranslate = null, lastMainText = null;
  const mainCtx = makeMockCtx('main');
  const origTranslate = mainCtx.translate;
  mainCtx.translate = (x, y) => { lastTranslate = [x, y]; origTranslate(x, y); };
  const badgeCtx = makeMockCtx('badge');
  const docMock = {
    createElement(tag) {
      if (tag !== 'canvas') return {};
      return { width: 0, height: 0, getContext: () => makeMockCtx('offscreen') };
    }
  };

  // Skater DOM elements simulating Chromium CSSOM 6-digit float rounding on style.transform getter
  let transformWrites = 0;
  const makeSkaterNode = () => {
    let rawTf = '';
    const style = {
      width: '', opacity: '', filter: '',
      get transform() { return rawTf.replace(/\d+\.\d{4,}/g, m => Number(m).toFixed(2)); },
      set transform(v) { rawTf = v; transformWrites++; }
    };
    return { style, querySelector: () => ({ width: 132, height: 132 }) };
  };
  const skaters = Array.from({ length: 6 }, makeSkaterNode);
  const bodies = P.kickoff();
  bodies[0].x = 180.123456789; bodies[0].y = 300.987654321; bodies[0].rotation = Math.PI / 3;
  const fx = createEffectsState();
  fx.goalCall = { team: 0, label: 'GOAL', scorer: 0, name: 'Ijul Ecgait', t: 0.1 };
  fx.goalSweep = { team: 0, p: 0.2 };
  fx.popups.push({ x: 500, y: 300, text: 'Assist', team: 0, life: 1.0, duration: 1.2 });

  let goalReplayObj = null;
  const view = {
    canvas: { width: 1653, height: 990, clientWidth: 551, clientHeight: 330 },
    ctx: mainCtx,
    badgeCanvas: { width: 1653, height: 990 },
    badgeCtx,
    bodies,
    portrait: true,
    mode: 'standard',
    anonymous: false
  };
  const presenter = createRinkPresenter({
    P, ububallMatch, ububallReplay: { ANONYMOUS: ['Saffron', 'Amethyst'] },
    getView: () => view,
    getEffects: () => fx,
    getPhase: () => 'goal',
    getPlans: () => [],
    getFouls: () => ububallMatch.newFouls(),
    getFoulInfo: () => null,
    getSelected: () => 0,
    getScoringPlayer: () => bodies[0],
    getGoalReplay: () => goalReplayObj,
    getOnlineReplay: () => null,
    getTheater: () => null,
    getActivePlayback: () => null,
    getGuide: () => null,
    guideShown: () => false,
    getSkaters: () => skaters,
    getRinkWrap: () => ({ style: { translate: '' } }),
    getRenderSize: () => ({ renderWidth: 551, renderHeight: 330, deviceWidth: 1653, deviceHeight: 990, visibleRinkHeight: 600 }),
    isReducedMotion: () => false,
    clockNow: () => 1000,
    gameAudio: () => null,
    uiScale: () => 1,
    anonymousName: i => `Anon ${i}`,
    contactMeter: () => {},
    doc: docMock
  });

  // Frame 1 populates offscreen caches for goalCall (2 lines), popup (1 line), and goalSweep
  presenter.drawScene();
  const firstOffscreenTexts = offscreenFillTextCalls;
  const firstMainBlurs = mainShadowBlurs;
  const firstTransformWrites = transformWrites;
  assert.equal(firstOffscreenTexts, 3, 'goalCall label + scorer name + popup rendered once to offscreen canvases');
  assert.equal(badgeFillTextCalls, 0, 'badgeCanvas uses cached drawImage instead of direct blurred fillText');
  assert.equal(badgeDrawImageCalls, 2, 'goalCall and popup blitted onto badgeCanvas via drawImage');
  assert.equal(firstTransformWrites, 6, 'initial frame writes 6 skater transforms');

  // Frames 2..10 reuse cached sprites with zero additional text rasterization, zero main shadowBlur, and zero stationary transform writes
  for (let frameIdx = 0; frameIdx < 9; frameIdx++) {
    fx.goalCall.t += 0.05;
    fx.goalSweep.p += 0.05;
    fx.popups[0].life -= 0.05;
    presenter.drawScene();
  }
  assert.equal(offscreenFillTextCalls, firstOffscreenTexts, 'subsequent celebration frames perform zero blurred fillText calls');
  assert.equal(mainShadowBlurs, firstMainBlurs, 'subsequent goalSweep frames perform zero main-canvas shadowBlur passes');
  assert.equal(transformWrites, firstTransformWrites, 'stationary skaters do not rewrite style.transform despite CSSOM float rounding');

  // Portrait goalReplay watermark renders at top (x = 990) instead of bottom (x = 30)
  fx.goalCall = null; fx.goalSweep = null; fx.popups.length = 0;
  goalReplayObj = { played: 100, total: 100 };
  presenter.drawScene();
  assert.equal(lastMainText?.text, 'REPLAY · SLOW MOTION');
  assert.deepEqual(lastMainText?.lastTranslate, [990, 300], 'Portrait REPLAY watermark sits at top (990, 300) clear of bottom Tap for next round');

  // updateClock skips redundant .hidden setter writes on steady-state non-Blitz frames
  let hiddenWrites = 0;
  const makeHiddenEl = () => {
    let h = true;
    return {
      get hidden() { return h; },
      set hidden(v) { h = v; hiddenWrites++; },
      textContent: '',
      firstChild: { style: { transform: '' } }
    };
  };
  const els = { 'blitz-clock': makeHiddenEl(), 'clock-strip': makeHiddenEl(), 'online-forfeit': makeHiddenEl() };
  const clockEnv = ububallPlayback.createPlanClockController({
    $: id => els[id],
    online: null,
    blitzMode: () => false,
    phase: 'play',
    planDeadline: 0,
    planPausedAt: null,
    performance: { now: () => 500 },
    ububallMatch
  });
  for (let i = 0; i < 60; i++) clockEnv.updateClock();
  assert.equal(hiddenWrites, 0, 'updateClock performs zero .hidden DOM writes when hidden state is unchanged');
});

test('positionSpinControl guards .inert/visibility/transform writes, and banner + setMeterFill avoid offsetWidth forced reflow', () => {
  const P = require('../shared/ububall-physics.js');
  const { setMeterFill, impulseGeometry } = require('../web/ububall-presentation.js');

  // 1. positionSpinControl skips redundant .hidden, .inert, style.visibility, and style.transform writes
  let inertWrites = 0, hiddenWrites = 0, visWrites = 0, xfWrites = 0;
  let curInert = true, curHidden = true, curVis = 'hidden', curXf = '';
  const controlEl = {
    get hidden() { return curHidden; },
    set hidden(v) { curHidden = v; hiddenWrites++; },
    get inert() { return curInert; },
    set inert(v) { curInert = v; inertWrites++; },
    style: {
      get visibility() { return curVis; },
      set visibility(v) { curVis = v; visWrites++; },
      get transform() { return curXf; },
      set transform(v) { curXf = v; xfWrites++; }
    }
  };
  const bodies = P.kickoff();
  const plans = [{ angle: 0, power: 0.5, spin: 0, guard: false }, { angle: 0, power: 0, spin: 0, guard: false }, { angle: 0, power: 0, spin: 0, guard: false }];
  const spinCtx = {
    $: () => controlEl,
    P,
    shot: 'match',
    cameraMove: null,
    phase: 'plan',
    drag: null,
    spinSlider: true,
    bodies,
    fieldView: { bodies, portrait: true },
    selected: 0,
    plans,
    fieldBox: { left: 0, top: 0, width: 330, height: 551, stageWidth: 360, stageHeight: 580, controlWidth: 146, controlHeight: 44 },
    stagePoint: p => ({ x: p.y / 600 * 330, y: (1 - p.x / 1000) * 551 }),
    impulseGeometry: (b, pl) => impulseGeometry(P, b, pl),
    gameUi: { scale: () => 1 }
  };
  ububallPlayback.positionSpinControl(spinCtx);
  assert.equal(hiddenWrites, 1);
  assert.equal(inertWrites, 1);
  assert.equal(visWrites, 1);
  assert.equal(xfWrites, 1);
  for (let i = 0; i < 60; i++) ububallPlayback.positionSpinControl(spinCtx);
  assert.equal(hiddenWrites, 1, 'steady-state frames perform zero .hidden writes on #field-spin');
  assert.equal(inertWrites, 1, 'steady-state frames perform zero .inert writes on #field-spin');
  assert.equal(visWrites, 1, 'steady-state frames perform zero style.visibility writes on #field-spin');
  assert.equal(xfWrites, 1, 'steady-state frames perform zero style.transform writes on #field-spin');

  // 2. banner() restarts animation without reading offsetWidth
  let offsetReads = 0, animCancels = 0, animPlays = 0;
  const classes = new Set();
  const bannerEl = {
    textContent: '',
    dataset: {},
    style: { setProperty() {} },
    classList: {
      contains: c => classes.has(c),
      add: c => classes.add(c),
      remove: c => classes.delete(c)
    },
    get offsetWidth() { offsetReads++; return 300; },
    getAnimations: () => [{ effect: { updateTiming() {} }, cancel() { animCancels++; }, play() { animPlays++; } }]
  };
  const timers = [];
  const bannerEnv = ububallPlayback.createBannerController({
    $: () => bannerEl,
    clearTimeout: () => {},
    setTimeout: (fn, ms) => { timers.push(fn); return timers.length; }
  });
  bannerEnv.banner('Plan your shot…', 1300, 'plan');
  assert.equal(classes.has('show'), true);
  assert.equal(offsetReads, 0, 'fresh banner never reads offsetWidth');
  bannerEnv.banner('Launch!', 900, 'launch');
  assert.equal(offsetReads, 0, 'interrupting banner restarts via getAnimations() with zero offsetWidth reflow');
  assert.equal(animCancels, 1);
  assert.equal(animPlays, 1);

  // 3. setMeterFill skips unchanged values and avoids offsetWidth reflow via getAnimations()
  let meterOffsetReads = 0, meterWidthWrites = 0;
  const meterClasses = new Set();
  const fillEl = {
    dataset: {},
    style: { set width(_v) { meterWidthWrites++; } },
    classList: {
      contains: c => meterClasses.has(c),
      add: c => meterClasses.add(c),
      remove: c => meterClasses.delete(c),
      toggle: (c, force) => force ? meterClasses.add(c) : meterClasses.delete(c)
    },
    get offsetWidth() { meterOffsetReads++; return 100; },
    getAnimations: () => [{ cancel() {}, play() {} }]
  };
  setMeterFill(fillEl, 40);
  setMeterFill(fillEl, 40);
  setMeterFill(fillEl, 40);
  assert.equal(meterWidthWrites, 1, 'setMeterFill skips redundant width writes when meter is unchanged');
  setMeterFill(fillEl, 55);
  setMeterFill(fillEl, 70);
  assert.equal(meterOffsetReads, 0, 'setMeterFill never forces synchronous offsetWidth layout when getAnimations is present');
});

test('v29 substep FX throttling: Rim-Around corner carves cap sparks to once per 20 ms and wall ripples deduplicate same-surface substeps while keeping post-to-net ricochets', () => {
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  let clock = 1000;
  const bodies = P.kickoff();
  Object.assign(bodies[0], { x: 106, y: 106, vx: 320, vy: -320, omega: -14 });
  const fx = createEffectsState([], {});
  const presenter = createRinkPresenter({
    P, ububallMatch,
    getView: () => ({ bodies, mode: 'standard', canvas: { width: 1000, height: 600 }, ctx: {}, badgeCanvas: { width: 1000, height: 600 }, badgeCtx: {} }),
    getEffects: () => fx,
    isReducedMotion: () => false,
    clockNow: () => clock,
    gameAudio: () => null
  });

  // Simulate 16 Rim-Around substeps within a single 1/240s tick (~4.16 ms total)
  for (let sub = 0; sub < 16; sub++) {
    clock = 1000 + sub * (1000 / 240 / 16);
    presenter.handleWall(bodies[0], 90, 'wall', -Math.SQRT1_2, -Math.SQRT1_2, true);
  }
  const firstTickSparks = fx.particles.length;
  assert.ok(firstTickSparks >= 7 && firstTickSparks <= 13, `16 substeps emit one spark burst (${firstTickSparks}), not 16x`);

  // Advance past 20 ms cooldown -> next Rim-Around burst emits cleanly
  clock = 1025;
  presenter.handleWall(bodies[0], 90, 'wall', -Math.SQRT1_2, -Math.SQRT1_2, true);
  assert.ok(fx.particles.length >= firstTickSparks + 7, 'Rim-Around sparks emit again after 20 ms');

  // Same-surface substep wall hits within 16 ms emit 1 ripple, whereas post -> net ricochet in the same tick emits both post ping and net ripple
  clock = 2000;
  for (let sub = 0; sub < 8; sub++) {
    presenter.handleWall(bodies[6], 360, 'wall', 0, -1, false);
  }
  assert.equal(fx.ripples.length, 1, '8 same-wall substeps in one tick add 1 board ripple');

  clock = 2100;
  presenter.handleWall(bodies[6], 360, 'post', 1, 0, false);
  presenter.handleWall(bodies[6], 280, 'net', 1, 0, false);
  assert.equal(fx.pings.length, 1, 'post contact emits post ping');
  assert.equal(fx.ripples.length, 2, 'immediate post-to-net ricochet still emits net ripple');

  // clearEffects resets rimSparkTimes and wallEffectTimes for backward replay seeks
  presenter.clearEffects();
  clock = 900;
  presenter.handleWall(bodies[0], 90, 'wall', -Math.SQRT1_2, -Math.SQRT1_2, true);
  assert.ok(fx.particles.length >= 7, 'clearEffects resets rimSparkTimes on backward seek');
});

test('Colossus launch and Cannonball impact activation leave ground marks, emit particles, growth lines, and lateral fireball jets', () => {
  const P = require('../shared/ububall-physics.js');
  const ububallMatch = require('../shared/ububall-match.js');
  const { SKID_LIFE } = ububallPresentation;

  // 1. startTurn emits onSuper('launch') for colossus, not for cannonball (which activates on impact)
  const launchEvents = [];
  const bodies = P.kickoff();
  bodies[0].equippedSuper = { ...P.SUPERS[5] }; // colossus
  bodies[0].meter = 100;
  bodies[1].equippedSuper = { ...P.SUPERS[3] }; // cannonball
  bodies[1].meter = 100;
  const plans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0 }));
  plans[0] = { angle: 0, power: 1, spin: 0, superArm: true };
  plans[1] = { angle: 0.4, power: 0.9, spin: 0, superArm: true };
  P.startTurn(bodies, plans, (key, stage, body) => {
    launchEvents.push({ key, stage, speed: Math.hypot(body.vx, body.vy) });
  });
  assert.deepEqual(launchEvents.map(e => `${e.key}:${e.stage}`), ['colossus:launch']);
  assert.ok(launchEvents[0].speed > 100, 'launch velocity is set before onSuper launch callbacks');

  // 2. Colossus presenter activation: circular dent with cracks, particles, growth lines & milestone rings
  const make2dCtx = () => ({
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, roundRect() {}, clip() {}, fill() {}, stroke() {}, fillRect() {}, clearRect() {},
    drawImage() {}, setTransform() {}, setLineDash() {}, translate() {}, rotate() {}, scale() {},
    createRadialGradient() { return { addColorStop() {} }; },
    createLinearGradient() { return { addColorStop() {} }; }
  });
  const docStub = {
    createElement() {
      const ctx2d = make2dCtx();
      return { width: 1000, height: 600, getContext: () => ctx2d };
    }
  };
  let clock = 1000;
  const fx = createEffectsState([], {});
  const view = {
    bodies: P.kickoff(),
    mode: 'standard',
    canvas: { width: 1000, height: 600, clientWidth: 1000, clientHeight: 600 },
    ctx: make2dCtx(),
    badgeCanvas: { width: 1000, height: 600 },
    badgeCtx: make2dCtx()
  };
  const presenter = createRinkPresenter({
    P, ububallMatch,
    getView: () => view,
    getEffects: () => fx,
    getPhase: () => 'play',
    isMoving: () => true,
    isReducedMotion: () => false,
    clockNow: () => clock,
    gameAudio: () => null,
    doc: docStub
  });

  view.bodies[0].equippedSuper = { ...P.SUPERS[5] };
  view.bodies[0].meter = 100;
  P.startTurn(view.bodies, [
    { angle: 0, power: 1, spin: 0, superArm: true },
    ...Array.from({ length: 5 }, () => ({ angle: 0, power: 0, spin: 0 }))
  ], (k, stg, b) => presenter.handleSuper(k, stg, b));

  assert.equal(fx.skids.find(s => s.dent), undefined, 'Colossus does not place dent at launch before reaching full size');
  assert.ok(fx.particles.some(p => p.growthLine), 'Colossus activation emits radial growth lines');
  assert.ok(fx.shockwaves.some(s => s.colossusGrowth), 'Colossus activation emits expanding growth ring wave');

  const launchX = view.bodies[0].x;
  const initialGrowthWaves = fx.shockwaves.filter(s => s.colossusGrowth).length;
  let fullSizePos = null;
  for (let tick = 0; tick < 42; tick++) {
    P.step(view.bodies, P.DT);
    presenter.emitSkaterEffects(P.DT);
    if (!fullSizePos && fx.skids.some(s => s.dent)) {
      fullSizePos = { x: view.bodies[0].x, y: view.bodies[0].y, p: P.colossusProgress(view.bodies[0]) };
    }
  }
  const dent = fx.skids.find(s => s.dent);
  assert.ok(dent, 'Colossus places circular dent once it reaches full size');
  assert.ok(fullSizePos && fullSizePos.p >= 1, 'Colossus dent appears only after colossusProgress reaches 1');
  assert.ok(dent.x > launchX + 40, 'Colossus dent is placed down-ice at full size, not at launch spot');
  assert.ok(Math.hypot(dent.x - fullSizePos.x, dent.y - fullSizePos.y) < 1e-6, 'Colossus dent is placed at full-size body position');
  assert.ok(dent.radius >= P.SUPER.colossusRadius, 'Colossus dent is sized at least to colossus radius');
  assert.ok(Array.isArray(dent.cracks) && dent.cracks.length >= 10, 'Colossus dent includes branching cracks');
  assert.ok(fx.particles.some(p => p.materialShape === 'shard' || p.materialShape === 'chip'), 'Colossus emits ice shard/chip particles on full-size dent slam');
  assert.ok(fx.shockwaves.filter(s => s.colossusGrowth).length > initialGrowthWaves, 'Colossus emits milestone growth waves while expanding');
  presenter.drawScene();

  // Dent ages and fades out over SKID_LIFE just like skidmarks
  presenter.updateEffects(SKID_LIFE + 0.1);
  assert.equal(fx.skids.length, 0, 'Colossus dent expires after SKID_LIFE');

  // 3. Cannonball activation on impact: ground scorch at impact spot & lateral fireball flame jets
  presenter.clearEffects();
  view.bodies = P.kickoff();
  view.bodies[0].equippedSuper = { ...P.SUPERS[3] };
  view.bodies[0].meter = 100;
  Object.assign(view.bodies[0], { x: 350, y: 300 });
  Object.assign(view.bodies[6], { x: 380, y: 300 });
  P.startTurn(view.bodies, [
    { angle: 0, power: 0.9, spin: 0, superArm: true },
    ...Array.from({ length: 5 }, () => ({ angle: 0, power: 0, spin: 0 }))
  ], (k, stg, b, tgt) => presenter.handleSuper(k, stg, b, tgt));

  assert.equal(fx.burns.length, 0, 'Cannonball does not scorch on launch before impact');
  assert.equal(fx.particles.filter(p => p.flame).length, 0, 'Cannonball does not emit fireball puffs on launch before impact');

  let impactCount = 0;
  for (let tick = 0; tick < 20 && impactCount === 0; tick++) {
    P.step(view.bodies, P.DT, null, null, null, (k, stg, b, tgt) => {
      if (k === 'cannonball' && stg === 'impact') impactCount++;
      presenter.handleSuper(k, stg, b, tgt);
    });
  }
  const ballSpeed = Math.hypot(view.bodies[6].vx, view.bodies[6].vy);
  assert.equal(impactCount, 1, 'Cannonball fires on impact with the ball');
  assert.equal(fx.burns.length, 1, 'Cannonball impact scorches the ground under the impact spot');
  const scorchPts = fx.burns[0].points;
  assert.equal(scorchPts.length, 3);
  assert.ok(scorchPts[0].x > scorchPts[1].x && scorchPts[2].x > scorchPts[1].x, 'scorch V-arms spread forward toward the ball');
  assert.ok(scorchPts[0].y < scorchPts[1].y && scorchPts[2].y > scorchPts[1].y, 'scorch V-arms spread out along +-45 deg');
  assert.ok(fx.particles.filter(p => p.flame).length >= 40, 'Cannonball impact emits a quick burst of fireball flame particles');
  assert.ok(fx.particles.some(p => p.flame && p.vx > 0 && p.vy > 100) && fx.particles.some(p => p.flame && p.vx > 0 && p.vy < -100), 'fireball flame particles fan forward at ~45 deg toward the ball');

  const smokePuffs = fx.particles.filter(p => p.materialShape === 'circle');
  assert.ok(smokePuffs.length >= 10, 'Cannonball impact shoots smoke puffs in the ball direction');
  const avgSmokeSpeed = smokePuffs.reduce((sum, p) => sum + Math.hypot(p.vx, p.vy), 0) / smokePuffs.length;
  assert.ok(avgSmokeSpeed > ballSpeed * 0.35 && avgSmokeSpeed < ballSpeed * 0.65, `smoke puffs travel at ~50% ball speed (${avgSmokeSpeed.toFixed(1)} vs ${ballSpeed.toFixed(1)})`);
  assert.ok(smokePuffs.every(p => p.vx > 0 && p.drag < 2), 'smoke puffs shoot forward with low drag to carry further');

  presenter.drawScene();
  presenter.updateEffects(0.32);
  assert.equal(fx.particles.filter(p => p.flame).length, 0, 'quick burst fireball puffs clear within ~0.3s');

  // 4. Stalwart leaves continuous skidmarks everywhere it goes while live
  presenter.clearEffects();
  view.bodies = P.kickoff();
  view.bodies[0].equippedSuper = { ...P.SUPERS[0] };
  view.bodies[0].meter = 100;
  P.startTurn(view.bodies, [
    { angle: 0, power: 1, spin: 0, superArm: true },
    ...Array.from({ length: 5 }, () => ({ angle: 0, power: 0, spin: 0 }))
  ], (k, stg, b, tgt) => presenter.handleSuper(k, stg, b, tgt));
  assert.equal(view.bodies[0].superActive, 'stalwart');
  for (let tick = 0; tick < 24; tick++) {
    P.step(view.bodies, P.DT);
    presenter.emitSkaterEffects(P.DT);
  }
  const stalwartSkids = fx.skids.filter(s => !s.dent);
  assert.equal(stalwartSkids.length, 1, 'Stalwart lays a continuous skidmark path while live');
  assert.ok(stalwartSkids[0].points.length >= 10, `Stalwart skidmark path grows continuously (got ${stalwartSkids[0].points.length} pts)`);
  assert.ok(stalwartSkids[0].points.every(pt => pt.depth >= 0.7), 'Stalwart skidmark points have strong depth');

  // 5. Sticky emits particles on both ball grab and release
  presenter.clearEffects();
  view.bodies = P.kickoff();
  view.bodies[0].equippedSuper = { ...P.SUPERS[2] };
  view.bodies[0].meter = 100;
  Object.assign(view.bodies[0], { x: 440, y: 300 });
  Object.assign(view.bodies[6], { x: 472, y: 300 });
  P.startTurn(view.bodies, [
    { angle: 0, power: 0.7, spin: 0, superArm: true },
    ...Array.from({ length: 5 }, () => ({ angle: 0, power: 0, spin: 0 }))
  ], (k, stg, b, tgt) => presenter.handleSuper(k, stg, b, tgt));

  let stickyGrabCount = 0;
  for (let tick = 0; tick < 20 && stickyGrabCount === 0; tick++) {
    P.step(view.bodies, P.DT, null, null, null, (k, stg, b, tgt) => {
      if (k === 'sticky' && stg === 'impact') stickyGrabCount++;
      presenter.handleSuper(k, stg, b, tgt);
    });
    presenter.emitSkaterEffects(P.DT);
  }
  assert.equal(stickyGrabCount, 1, 'Sticky fires impact callback when grabbing the ball');
  assert.equal(fx.stickyHolderIdx, 0, 'presenter tracks the sticky ball holder index');
  const stickyColors = new Set(['#44dd66', '#d9ffe3', '#7ef29a', '#21845b']);
  const grabParticles = fx.particles.filter(p => stickyColors.has(p.color) && !p.flash);
  assert.ok(grabParticles.length >= 12, `Sticky emits emerald particles on grab (got ${grabParticles.length})`);
  assert.ok(fx.shockwaves.length >= 1, 'Sticky emits a shockwave ring on grab');

  fx.particles.length = 0;
  fx.shockwaves.length = 0;
  view.bodies[0].holding = false;
  view.bodies[0].holdTicks = 0;
  view.bodies[6].heldBy = null;
  presenter.updateEffects(P.DT);
  assert.equal(fx.stickyHolderIdx, -1, 'presenter clears stickyHolderIdx on release');
  const releaseParticles = fx.particles.filter(p => stickyColors.has(p.color) && !p.flash);
  assert.ok(releaseParticles.length >= 12, `Sticky emits emerald particles on release (got ${releaseParticles.length})`);
  assert.ok(fx.shockwaves.length >= 1, 'Sticky emits a shockwave ring on release');
});
