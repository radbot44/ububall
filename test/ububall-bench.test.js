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
