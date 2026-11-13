'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const P = require('../shared/ububall-physics.js');
const ububallMatch = require('../shared/ububall-match.js');
const ubu = require('../shared/ubu.js');
const ububallPlayback = require('../web/ububall-playback.js');
const { createBenchServer, WEB_FILES, SHARED_FILES } = require('../scripts/serve-bench.cjs');

test('syncTickBodies updates dynamic kinematics and ball fire state without dirtyMeters churn', () => {
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
  const target = P.kickoff();
  const dirty = new Set();

  const projector = ububallPlayback.createBodyProjector({
    P,
    getEntries: () => entries,
    getShownSim: () => sim,
    getShownSeat: () => 0,
    getTargetBodies: () => target,
    getDirtyMeters: () => dirty
  });

  // Initial full projection populates static traits and adds 6 skaters (never ball) to dirtyMeters
  projector.syncViewBodies(sim, 0, target, false, dirty, entries);
  assert.equal(dirty.size, 7, 'syncViewBodies populates dirtyMeters once per frame');
  dirty.clear();

  // Mutate dynamic kinematics mid-step
  sim[0].x = 412;
  sim[0].y = 275;
  sim[0].vx = 320;
  sim[0].omega = 12;
  sim[0].guarding = true;
  sim[0].ironGuard = true;
  sim[0].superActive = 'magnet';
  sim[6].x = 720;
  sim[6].y = 310;
  sim[6].vx = 890;
  sim[6].onFire = true;
  sim[6].fireTicks = 180;
  sim[6].pace = 3;
  sim[6].strikerTeam = 1;

  // Seat 1 mirror check via syncTickBodies
  projector.syncTickBodies(sim, 1, target);
  assert.equal(dirty.size, 0, 'syncTickBodies does not touch dirtyMeters during intermediate sub-steps');
  assert.equal(target[3].x, 1000 - 412);
  assert.equal(target[3].y, 600 - 275);
  assert.equal(target[3].vx, -320);
  assert.equal(target[3].omega, 12);
  assert.equal(target[3].guarding, true);
  assert.equal(target[3].ironGuard, true);
  assert.equal(target[3].superActive, 'magnet');
  assert.equal(target[6].x, 1000 - 720);
  assert.equal(target[6].onFire, true);
  assert.equal(target[6].fireTicks, 180);
  assert.equal(target[6].pace, 3);
  assert.equal(target[6].strikerTeam, 0, 'seat 1 flips ball strikerTeam');
});

test('shot-spin slider coalesces oninput via dragDirty without saveActiveMatch spam and saves once on onchange', () => {
  const source = fs.readFileSync(require.resolve('../web/ububall.js'), 'utf8');
  const start = source.indexOf('  let saveActiveMatchTimer = 0;');
  const end = source.indexOf("  for (const [id, delta] of [['spin-less'", start);
  assert.ok(start >= 0 && end > start, 'found spin slider handler block');

  const spinElem = {};
  let saves = 0, syncs = 0, draws = 0;
  const sandbox = {
    $: id => { assert.equal(id, 'shot-spin'); return spinElem; },
    Number,
    clearTimeout,
    setTimeout,
    requestAnimationFrame: () => 1,
    selected: 0,
    phase: 'plan',
    dragDirty: false,
    plans: [{ angle: 0, power: 0.5, spin: 0, guard: true }],
    knobEditable: () => true,
    sync: () => { syncs++; },
    draw: () => { draws++; },
    saveActiveMatch: () => { saves++; }
  };

  vm.runInNewContext(source.slice(start, end), sandbox);

  // Simulate 30 rapid slider drag input events
  for (let k = -15; k <= 15; k++) {
    spinElem.value = String(k * 3);
    spinElem.oninput();
  }
  assert.equal(saves, 0, 'oninput never calls saveActiveMatch synchronously during slider drag');
  assert.equal(syncs, 0, 'oninput coalesces sync() into frame() via dragDirty');
  assert.equal(draws, 0, 'oninput coalesces draw() into frame() via dragDirty');
  assert.equal(sandbox.dragDirty, true);
  assert.equal(sandbox.plans[0].guard, false);
  assert.equal(sandbox.plans[0].spin, 0.45);

  // Committing slider flushes pending dirty frame and saves exactly once
  spinElem.onchange();
  assert.equal(sandbox.dragDirty, false);
  assert.equal(syncs, 1);
  assert.equal(draws, 1);
  assert.equal(saves, 1, 'onchange persists match state once on release');
});

test('demoAim animates via requestAnimationFrame + dragDirty instead of setTimeout double-draws', async () => {
  const source = fs.readFileSync(require.resolve('../web/ububall.js'), 'utf8');
  const start = source.indexOf('  function placeFinger(x, y, rects = null) {');
  const end = source.indexOf('  // Standalone reloads can resume a CPU match', start);
  assert.ok(start >= 0 && end > start, 'found demoAim block');

  let rafCalls = 0, timeoutDragCalls = 0, draws = 0, now = 1000;
  const finger = {
    style: {},
    parentElement: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 500, height: 300 }) },
    toggleAttribute() {},
    classList: { add() {}, remove() {} }
  };
  const sandbox = {
    Math, Promise,
    performance: { now: () => now },
    requestAnimationFrame: cb => {
      rafCalls++;
      now += 300;
      Promise.resolve().then(() => cb(now));
      return rafCalls;
    },
    setTimeout: cb => { timeoutDragCalls++; cb(); return 1; },
    $: id => { assert.equal(id, 'demo-finger'); return finger; },
    fieldView: {
      portrait: false,
      bodies: [{ x: 200, y: 300, radius: 25, stunned: false }],
      canvas: { getBoundingClientRect: () => ({ left: 10, top: 20, width: 500, height: 300 }) }
    },
    boxPoint: (r, p) => ({ x: r.left + p.x / 1000 * r.width, y: r.top + p.y / 600 * r.height }),
    screenPoint: p => ({ x: 10 + p.x * 0.5, y: 20 + p.y * 0.5 }),
    impulseGeometry: (b, plan) => ({ x: b.x + plan.power * 80, y: b.y }),
    demoWait: async () => {},
    DEMO_STOP: Symbol('stop'),
    demoRun: 1,
    selected: 0,
    layoutDirty: false,
    dragDirty: false,
    plans: [{ angle: 0, power: 0, spin: 0, guard: false }],
    sync: () => {},
    draw: () => { draws++; }
  };

  const demoAim = vm.runInNewContext(source.slice(start, end) + '\n;demoAim;', sandbox);
  await demoAim(1, 0, { angle: 0.25, power: 0.8, spin: 0.2, guard: false }, () => true);

  assert.ok(rafCalls >= 3, 'demoAim steps on requestAnimationFrame');
  assert.equal(timeoutDragCalls, 0, 'demoAim never schedules 16ms setTimeout drag ticks when RAF is available');
  assert.equal(draws, 2, 'demoAim calls draw() only at selection start and final commit, coalescing intermediate frames via dragDirty');
  assert.equal(sandbox.plans[0].power, 0.8);
});

test('bench whitelist and server security invariants hold', () => {
  const root = path.resolve(__dirname, '..');
  const prep = fs.readFileSync(path.join(root, 'scripts/prepare-assets.cjs'), 'utf8');
  assert.ok(prep.includes("'ububall-bench.js'"), 'prepare-assets.cjs whitelists ububall-bench.js');
  assert.equal(WEB_FILES.has('ububall-bench.js'), true);
  assert.equal(WEB_FILES.has('package.json'), false, 'serve-bench never exposes repo root files');
  assert.equal(SHARED_FILES.has('ububall-physics.js'), true);
  const srv = createBenchServer();
  assert.equal(typeof srv.listen, 'function');
  srv.close();
});

test('ububall-online boots cleanly on non-HTTPS LAN origins where crypto.randomUUID is undefined', () => {
  const onlineSrc = fs.readFileSync(require.resolve('../web/ububall-online.js'), 'utf8');
  const crypto = require('node:crypto').webcrypto;
  const insecureCrypto = {
    randomUUID: undefined,
    getRandomValues: arr => crypto.getRandomValues(arr)
  };
  const makeEl = () => ({
    hidden: false, disabled: false, value: '', textContent: '', dataset: {}, style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, append() {}, replaceChildren() {},
    querySelector: () => ({ textContent: '' })
  });
  const ctx = {
    URL, URLSearchParams, AbortController, Map, Set, Promise, JSON, Math, Date, String, Boolean, Object, Array, Uint8Array,
    crypto: insecureCrypto,
    window: { location: new URL('http://192.168.1.50:8791/?bench=1&auto=1'), addEventListener() {} },
    document: { getElementById: () => makeEl(), querySelectorAll: () => [], addEventListener() {} },
    navigator: {},
    location: new URL('http://192.168.1.50:8791/?bench=1&auto=1'),
    history: { state: null, replaceState() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false }),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}
  };
  const initOnline = vm.runInNewContext(onlineSrc + '\n;ububallOnline;', ctx);
  const client = initOnline({ lobby() {}, closeLobby() {}, onState() {}, onDisconnect() {}, onError() {}, onOutdated() {}, onLeave() {} });
  assert.equal(typeof client.active, 'boolean');
});

test('incremental iceCache appends new skid/burn points without clearing and rebuilds only on 250ms fade bucket ticks', () => {
  const pres = require('../web/ububall-presentation.js');
  const bodies = P.kickoff();
  const fx = pres.createEffectsState([], {});
  const layers = [];
  const makeCtx = label => {
    const ops = { label, clears: 0, fills: 0, drawImages: [], shadowBlurs: [] };
    const ctx = {
      ops,
      globalAlpha: 1,
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      set shadowBlur(v) { if (v > 0) ops.shadowBlurs.push(v); },
      get shadowBlur() { return 0; },
      shadowColor: 'transparent',
      save() {},
      restore() {},
      setTransform() {},
      getTransform: () => ({ a: 1 }),
      clearRect() { ops.clears++; },
      fillRect() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      rect() {},
      roundRect() {},
      setLineDash() {},
      clip() {},
      stroke() {},
      fill() { ops.fills++; },
      translate() {},
      rotate() {},
      scale() {},
      drawImage(src, ...args) { ops.drawImages.push({ src, args }); },
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createConicGradient: () => ({ addColorStop() {} })
    };
    return ctx;
  };
  const mockDoc = {
    createElement(tag) {
      const c = { tag, width: 0, height: 0, _ctx: makeCtx('offscreen-' + layers.length) };
      c.getContext = () => c._ctx;
      layers.push(c);
      return c;
    }
  };
  const mainCanvas = { width: 1653, height: 990, clientWidth: 551, clientHeight: 330 };
  const badgeCanvas = { width: 1653, height: 990 };
  const view = {
    canvas: mainCanvas,
    ctx: makeCtx('main'),
    badgeCanvas,
    badgeCtx: makeCtx('badge'),
    bodies,
    portrait: false,
    mode: 'standard',
    castHidden: false,
    field: null
  };
  const presenter = pres.createRinkPresenter({
    P,
    ububallMatch,
    getView: () => view,
    getEffects: () => fx,
    getPhase: () => 'play',
    getPlans: () => [],
    getRenderSize: () => ({ renderWidth: 551, renderHeight: 330, deviceWidth: 1653, deviceHeight: 990 }),
    doc: mockDoc
  });

  // Seed one active skid mark with 3 points in fade bucket 0 (age = 0.02s)
  const skid = { width: 18, age: 0.02, points: [{ x: 200, y: 200, depth: 0.8 }, { x: 220, y: 205, depth: 0.9 }, { x: 240, y: 212, depth: 1.0 }] };
  fx.skids.push(skid);

  presenter.drawScene();
  assert.equal(fx.iceCache.rebuilds, 1, 'initial frame builds iceCache once');
  const iceLayerCtx = fx.iceCache.layer.getContext('2d');
  assert.equal(iceLayerCtx.ops.shadowBlurs.length, 0, 'feathered softRibbon uses zero Gaussian shadowBlur passes');
  const clearsAfterInit = iceLayerCtx.ops.clears;

  // Frame 2: skid grows by 2 points within the same 250ms bucket (age = 0.08s -> bucket 0)
  skid.age = 0.08;
  skid.points.push({ x: 262, y: 220, depth: 1.0 }, { x: 285, y: 228, depth: 0.95 });
  presenter.drawScene();
  assert.equal(fx.iceCache.rebuilds, 1, 'growing skid points within same fade bucket does NOT rebuild iceCache');
  assert.equal(fx.iceCache.appends, 1, 'growing skid points appends only the new tail slice');
  assert.equal(iceLayerCtx.ops.clears, clearsAfterInit, 'incremental append does not clear the offscreen ice layer');

  // Frame 3: advance past 0.25s fade bucket boundary -> triggers clean rebuild
  skid.age = 0.26;
  presenter.drawScene();
  assert.equal(fx.iceCache.rebuilds, 2, 'crossing 250ms fade bucket triggers a full iceCache refresh');
});

test('drawHeatMirage composites offscreen rinkCache + iceCache and never self-copies view.canvas', () => {
  const pres = require('../web/ububall-presentation.js');
  const bodies = P.kickoff();
  bodies[6].onFire = true;
  bodies[6].fireTicks = 300;
  bodies[6].pace = 3;
  const fx = pres.createEffectsState([], {});
  fx.wasOnFire = true;
  fx.heatTime = 0.5;
  fx.skids.push({ width: 16, age: 0.05, points: [{ x: 480, y: 295, depth: 1 }, { x: 505, y: 302, depth: 1 }] });

  const makeCtx = () => {
    const drawSources = [];
    return {
      drawSources,
      globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, shadowBlur: 0, shadowColor: '#000',
      save() {}, restore() {}, setTransform() {}, getTransform: () => ({ a: 1 }),
      clearRect() {}, fillRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
      arc() {}, rect() {}, roundRect() {}, setLineDash() {}, clip() {}, stroke() {}, fill() {}, translate() {}, rotate() {}, scale() {},
      drawImage(src) { drawSources.push(src); },
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createConicGradient: () => ({ addColorStop() {} })
    };
  };
  const mockDoc = {
    createElement(tag) {
      const c = { tag, width: 0, height: 0, _ctx: makeCtx() };
      c.getContext = () => c._ctx;
      return c;
    }
  };
  const mainCanvas = { id: 'live-main-canvas', width: 1920, height: 1152, clientWidth: 1280, clientHeight: 768 };
  const view = {
    canvas: mainCanvas,
    ctx: makeCtx(),
    badgeCanvas: { width: 1920, height: 1152 },
    badgeCtx: makeCtx(),
    bodies,
    portrait: false,
    mode: 'standard',
    castHidden: false,
    field: null
  };
  const presenter = pres.createRinkPresenter({
    P,
    ububallMatch,
    getView: () => view,
    getEffects: () => fx,
    getPhase: () => 'play',
    getPlans: () => [],
    getRenderSize: () => ({ renderWidth: 1280, renderHeight: 768, deviceWidth: 1920, deviceHeight: 1152 }),
    doc: mockDoc
  });

  presenter.drawScene();
  assert.ok(fx.mirageCanvas, 'mirageCanvas created when ball is on fire');
  const mirageSources = fx.mirageCtx.drawSources;
  assert.equal(mirageSources.includes(mainCanvas), false, 'mirageCtx NEVER copies from live view.canvas');
  assert.equal(mirageSources.includes(fx.rinkCache.layer), true, 'mirageCtx samples finished offscreen rinkCache');
  assert.equal(mirageSources.includes(fx.iceCache.layer), true, 'mirageCtx samples finished offscreen iceCache');
});

test('drawPrediction skips predictionLayer allocation during active drag and 2560px cap preserves native phone 1653x990', () => {
  const pres = require('../web/ububall-presentation.js');
  const bodies = P.kickoff();
  const fx = pres.createEffectsState([], {});
  const plans = [
    { angle: 0.1, power: 0.8, spin: 0.2, guard: false, superArm: false },
    { angle: 0, power: 0.5, spin: 0, guard: false, superArm: false },
    { angle: -0.1, power: 0.6, spin: 0, guard: false, superArm: false }
  ];
  let dragging = true;
  const createdCanvases = [];
  const makeCtx = () => ({
    globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, shadowBlur: 0, shadowColor: '#000',
    save() {}, restore() {}, setTransform() {}, getTransform: () => ({ a: 1 }),
    clearRect() {}, fillRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, rect() {}, roundRect() {}, setLineDash() {}, clip() {}, stroke() {}, fill() {}, translate() {}, rotate() {}, scale() {},
    setLineDash() {}, drawImage() {}, fillText() {}, strokeText() {}, measureText: () => ({ width: 40 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createConicGradient: () => ({ addColorStop() {} })
  });
  const mockDoc = {
    createElement(tag) {
      const c = { tag, width: 0, height: 0, _ctx: makeCtx() };
      c.getContext = () => c._ctx;
      createdCanvases.push(c);
      return c;
    }
  };

  let renderSize = { renderWidth: 551, renderHeight: 330, deviceWidth: 1653, deviceHeight: 990 };
  const mainCanvas = { width: 0, height: 0, clientWidth: 551, clientHeight: 330 };
  const badgeCanvas = { width: 0, height: 0 };
  const view = {
    canvas: mainCanvas, ctx: makeCtx(), badgeCanvas, badgeCtx: makeCtx(),
    bodies, portrait: false, mode: 'standard', castHidden: false, field: null
  };
  const presenter = pres.createRinkPresenter({
    P, ububallMatch,
    getView: () => view,
    getEffects: () => fx,
    getPhase: () => 'plan',
    getPlans: () => plans,
    isDragging: () => dragging,
    getRenderSize: () => renderSize,
    doc: mockDoc
  });

  // 1. Native phone match size (1653x990) stays 100% untouched, and active drag allocates only rinkCache (1 canvas, no predictionLayer)
  for (let f = 0; f < 5; f++) {
    plans[0].angle = 0.1 + f * 0.05;
    presenter.drawScene();
  }
  assert.equal(mainCanvas.width, 1653);
  assert.equal(mainCanvas.height, 990);
  assert.equal(createdCanvases.filter(c => c.width === 1653 && c.height === 990).length, 1, 'active drag allocates only rinkCache (no full-screen predictionLayer)');

  // 2. Once stationary in plan phase, 2nd frame at same plan caches predictionLayer
  dragging = false;
  presenter.drawScene();
  presenter.drawScene();
  assert.equal(createdCanvases.filter(c => c.width === 1653 && c.height === 990).length, 2, 'stationary plan allocates predictionLayer once after plan settles');

  // 3. Oversized 3840x2304 desktop-mode buffer caps cleanly to 2560x1536
  renderSize = { renderWidth: 1280, renderHeight: 768, deviceWidth: 3840, deviceHeight: 2304 };
  presenter.drawScene();
  assert.equal(mainCanvas.width, 2560);
  assert.equal(mainCanvas.height, 1536);

  // 4. Collection portrait caches offscreen rink across scroll frames and skips badgeCanvas resize
  badgeCanvas.width = 300; badgeCanvas.height = 180;
  view.castHidden = true;
  view.collectionPortrait = { length: 2400, viewTop: 0, viewSpan: 950 };
  renderSize = { renderWidth: 524, renderHeight: 828, deviceWidth: 1572, deviceHeight: 2484 };
  presenter.drawScene(); // Frame 1 settles length
  presenter.drawScene(); // Frame 2 bakes portraitRinkCache
  for (let s = 1; s <= 10; s++) {
    view.collectionPortrait.viewTop = s * 120;
    presenter.drawScene();
  }
  assert.equal(fx.portraitRinkCache.builds, 1, 'portrait rink surface baked once across 10 scroll offsets');
  assert.ok(fx.portraitRinkCache.hits >= 11, 'subsequent scroll offsets hit offscreen portraitRinkCache');
  assert.equal(badgeCanvas.width, 300, 'collectionPortrait skips resizing hidden badgeCanvas');
});

test('paintPrediction skips stationary bodies, decimates redundant polyline vertices while keeping bounce kinks, and skips clip when impacts is empty', () => {
  const pres = require('../web/ububall-presentation.js');
  const bodies = P.kickoff();
  const ops = { strokes: 0, lineTos: [], clips: 0, images: 0 };
  const ctx = {
    globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    setLineDash() {},
    beginPath() {},
    moveTo() {},
    lineTo(x, y) { ops.lineTos.push([x, y]); },
    stroke() { ops.strokes++; },
    fill() {},
    arc() {},
    rect() {},
    roundRect() {},
    clip() { ops.clips++; },
    drawImage() { ops.images++; }
  };
  const mockDoc = {
    createElement() {
      return { width: 0, height: 0, getContext: () => ({ fillStyle: '#000', beginPath() {}, arc() {}, fill() {} }) };
    }
  };
  const presenter = pres.createRinkPresenter({
    P,
    ububallMatch,
    getView: () => ({ ctx, badgeCtx: ctx, bodies, mode: 'standard', portrait: false }),
    getEffects: () => pres.createEffectsState([], {}),
    doc: mockDoc
  });

  // Build 1 moving path with a sharp wall bounce at (300, 60) + decelerating sub-pixel tail, and 6 stationary 121-point paths
  const moving = [];
  for (let i = 0; i <= 40; i++) {
    // Straight approach to top board (200,110) -> (300,60), then bounce to (400,110)
    const u = i / 20;
    if (i <= 20) moving.push({ x: 200 + u * 100, y: 110 - u * 50, tick: i * 4 });
    else moving.push({ x: 300 + (u - 1) * 100, y: 60 + (u - 1) * 50, tick: i * 4 });
  }
  // Add 50 decelerating sub-pixel points bunched near (401, 110.5)
  for (let k = 1; k <= 50; k++) {
    moving.push({ x: 400 + (1 - Math.exp(-k * 0.2)), y: 110 + 0.5 * (1 - Math.exp(-k * 0.2)), tick: 160 + k * 4 });
  }
  const still = Array.from({ length: 121 }, (_, k) => ({ x: 780, y: 300, tick: k * 4 }));
  const prediction = {
    paths: [moving, still, still, still, still, still, still],
    impacts: [],
    stops: [],
    horizon: 480,
    guards: [],
    ignition: null,
    goalTargets: null
  };

  presenter.paintPrediction(prediction, '#E8CA48', '#AA54D3');
  assert.equal(ops.clips, 0, 'skips rounded-rink + goal clip mask when prediction.impacts is empty');
  assert.ok(ops.lineTos.length <= 16, `expected <= 16 emitted lineTo vertices (from 91 raw + 726 stationary), got ${ops.lineTos.length}`);
  assert.equal(ops.lineTos.some(([x, y]) => Math.abs(x - 300) < 1e-6 && Math.abs(y - 60) < 1e-6), true, 'preserves exact wall-bounce apex vertex');

  // Verify non-empty impacts still clips and renders stamp
  prediction.impacts = [{ index: 0, x: 300, y: 80, radius: 25, reach: 28, tick: 80 }];
  presenter.paintPrediction(prediction, '#E8CA48', '#AA54D3');
  assert.equal(ops.clips, 1, 'applies rink + goal clip when impacts are present');
  assert.equal(ops.images, 1, 'draws impact stamp inside clip');
});
