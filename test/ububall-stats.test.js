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
  const ubus = Array.from({ length: 6 }, () => {
    const dnaBytes = ubu.randomDNA();
    const model = ubu.decode(dnaBytes);
    return { dna: ubu.toCode(dnaBytes), super: model.supers[0] % 8 };
  });
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

test('ububall-stats: imported .ububall replays remain watchable in memory without IndexedDB and file errors are preserved', async () => {
  const ubus = Array.from({ length: 6 }, () => {
    const dnaBytes = ubu.randomDNA();
    const model = ubu.decode(dnaBytes);
    return { dna: ubu.toCode(dnaBytes), super: model.supers[0] % 8 };
  });
  const rec = ububallReplay.create({ mode: 'standard', seat: 0, names: ['Home', 'Away'], ubus });
  const bodies = P.kickoff();
  const plans = Array.from({ length: 6 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false }));
  const t = ububallReplay.addTurn(rec, { turn: 1, scores: [0, 0], fouls: ububallMatch.newFouls(), bodies, plans });
  t.ticks = 10; t.cards = []; t.saves = []; t.stops = [];
  const fileBytes = await ububallReplay.write(rec);

  const makeEl = (tag = 'div') => {
    const classes = new Set();
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      textContent: '',
      value: '',
      hidden: false,
      open: false,
      style: { setProperty() {} },
      dataset: {},
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        contains: c => classes.has(c),
        toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : Boolean(force); if (on) classes.add(c); else classes.delete(c); return on; }
      },
      setAttribute(k, v) { this[k] = v; },
      addEventListener() {},
      close() { this.open = false; },
      showModal() { this.open = true; },
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = [...nodes]; },
      querySelector(sel) {
        if (sel === 'span') return this._span ||= makeEl('span');
        return null;
      },
      get lastChild() { return this.children[this.children.length - 1]; }
    };
    return el;
  };
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, makeEl(id === 'replays-list' ? 'ul' : 'div'));
    return nodes.get(id);
  };
  let watched = null;
  const storageErr = () => Promise.reject(new Error('IndexedDB unavailable'));
  const ctrl = ububallStats.createStatsController({
    $,
    document: { createElement: tag => makeEl(tag), addEventListener() {}, querySelector: () => null },
    addEventListener() {},
    history: {},
    P,
    ububallMatch,
    ububallReplay,
    ubuRender: () => makeEl('svg'),
    gameUi: { icon: () => makeEl('svg'), confirm: async () => true },
    onlineOrder: ububallPlayback.onlineOrder,
    viewIndex: ububallPlayback.viewIndex,
    getFieldView: () => ({ entries: [] }),
    getSkaters: () => [],
    getThemeColors: () => ({ home: '#f00', away: '#00f', text: '#fff' }),
    drawRinkSurface() {},
    viewTally: () => ({ tally: ububallMatch.newTally(), scores: [0, 0] }),
    getScores: () => [0, 0],
    getPhase: () => 'plan',
    getOnline: () => null,
    getTheater: () => null,
    getRecording: () => null,
    getLastCompletedReplay: () => null,
    getLastSaved: () => Promise.resolve(null),
    getShot: () => 'home',
    getCameraMove: () => null,
    replayStore: { all: storageErr, add: storageErr, get: storageErr, put: storageErr, remove: storageErr },
    libraryEntry: (replay, file, auto) => ({
      auto, pinned: false, format: ububallReplay.FORMAT, physics: P.VERSION,
      mode: replay.mode, seat: replay.seat, names: replay.names, scores: [0, 0],
      recorded: replay.recorded, turns: replay.turns.length, final: Boolean(replay.final),
      title: replay.title || null, clip: false, file
    }),
    seekReplay() {},
    updateReplayBar() {},
    watchReplay: (replay, file) => { watched = { replay, file }; },
    matchInProgress: () => false,
    finishCpuMatch() {},
    closeFirstTurnGuide() {},
    closeSummary() {},
    newMatch() {},
    exitMatchMode() {}
  });
  ctrl.bindEvents();

  // Import a valid replay while storage is failing: it should land in session memory and be watchable.
  await $('replays-import').onchange({
    target: {
      files: [{ name: 'match.ububall', size: fileBytes.byteLength, arrayBuffer: async () => fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength) }],
      value: 'match.ububall'
    }
  });
  const listItems = $('replays-list').children;
  assert.equal(listItems.length, 1, 'imported replay renders in list without IndexedDB');
  assert.equal(listItems[0].classList.contains('replays-empty'), false);
  assert.equal($('replays-note').classList.contains('problem'), false, 'session-only note is not flagged as a file error');

  const watchBtn = listItems[0].children[0];
  await watchBtn.onclick();
  assert.ok(watched?.replay, 'watching session-imported replay opens Replay Theater');

  // Importing an invalid file still reports the file error instead of swallowing it behind storage failure.
  const badBytes = new Uint8Array([1, 2, 3, 4]);
  await $('replays-import').onchange({
    target: {
      files: [{ name: 'broken.ububall', size: badBytes.byteLength, arrayBuffer: async () => badBytes.buffer }],
      value: 'broken.ububall'
    }
  });
  assert.equal($('replays-note').classList.contains('problem'), true, 'invalid file error is surfaced');
  assert.match($('replays-note').textContent, /broken\.ububall:/, 'invalid file name is preserved in error message');
});

test('game-ui: dropdown avoids setting reflected HTML align attribute and errorMessage hides raw runtime errors', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const src = fs.readFileSync(path.join(__dirname, '..', 'web', 'game-ui.js'), 'utf8');
  const listeners = [];
  const makeNode = () => {
    const attrs = new Map();
    const node = {
      style: {},
      dataset: {},
      classList: { add() {}, contains: () => false },
      hasAttribute: k => attrs.has(k),
      setAttribute: (k, v) => attrs.set(k, v),
      getAttribute: k => attrs.get(k),
      matches: () => false,
      getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }),
      addEventListener(type, fn) { listeners.push({ node, type, fn }); },
      offsetWidth: 120,
      offsetHeight: 80
    };
    return node;
  };
  const ctx = {
    document: {
      readyState: 'complete',
      documentElement: {},
      querySelectorAll: () => [],
      createElement: () => makeNode(),
      body: { appendChild: n => n }
    },
    getComputedStyle: () => ({ fontSize: '16px' }),
    addEventListener() {},
    matchMedia: () => ({ addEventListener() {} }),
    innerWidth: 1024,
    innerHeight: 768
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(src, ctx);

  const btn = makeNode(), pop = makeNode();
  let alignSetterCalled = false;
  Object.defineProperty(pop, 'align', {
    get: () => '',
    set: () => { alignSetterCalled = true; }
  });
  ctx.gameUi.dropdown(btn, pop, { align: 'end' });
  const clickHandler = listeners.find(l => l.node === btn && l.type === 'click').fn;
  clickHandler({ preventDefault() {} });
  assert.equal(alignSetterCalled, false, 'dropdown must never write reflected HTMLDivElement.align');
  assert.equal(pop._align, 'end', 'dropdown stores alignment on _align');

  assert.equal(
    ctx.gameUi.errorMessage("Cannot read properties of undefined (reading 'file')"),
    'Something went wrong. Please try again.'
  );
  assert.equal(
    ctx.gameUi.errorMessage('This replay is too large.'),
    'This replay is too large.'
  );
});

test('ububall-playback: flushMeters updates stadium super pill and portrait mini-pill live during playback', () => {
  const makeNode = () => {
    const classes = new Set();
    const props = new Map();
    return {
      textContent: '',
      style: { setProperty: (k, v) => props.set(k, v), getPropertyValue: k => props.get(k) || '' },
      classList: {
        contains: c => classes.has(c),
        toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : Boolean(force); if (on) classes.add(c); else classes.delete(c); return on; }
      }
    };
  };
  const map = new Map();
  const $ = id => { if (!map.has(id)) map.set(id, makeNode()); return map.get(id); };
  const body = { playerIndex: 1, meter: 100, superArm: false, carded: false, stunned: false, equippedSuper: { name: 'Knockout' } };
  const state = {
    selected: 1,
    dirtyMeters: new Set([body]),
    P
  };
  const ctrl = ububallPlayback.createMeterController({ state, $, P, ububallMatch, setMeterFill() {} });
  ctrl.flushMeters();
  assert.equal($('super-pct-1').textContent, 'Ready');
  assert.equal($('super-panel-1').classList.contains('ready'), true);
  assert.equal($('stadium-super-text').textContent, 'Knockout 100%');
  assert.equal($('portrait-pill-1').classList.contains('ready'), true);
  assert.equal($('portrait-pill-1').style.getPropertyValue('--meter'), '100.0%');
});

test('ububall-playback: formatDrawerSuperStatus and flushMeters keep open stat-drawer super card in sync', () => {
  assert.equal(ububallPlayback.formatDrawerSuperStatus({ meter: 42.9 }), '42%');
  assert.equal(ububallPlayback.formatDrawerSuperStatus({ meter: 99.7 }), '99%');
  assert.equal(ububallPlayback.formatDrawerSuperStatus({ meter: 100 }), '100% · Ready');
  assert.equal(ububallPlayback.formatDrawerSuperStatus({ meter: 100, superArm: true }), 'Armed · 100%');
  assert.equal(ububallPlayback.formatDrawerSuperStatus({ meter: 84, carded: true }), '84% · Carded');
  assert.equal(ububallPlayback.formatDrawerSuperStatus({ meter: 67, stunned: true }), '67% · Stunned');

  const makeNode = () => {
    const classes = new Set();
    const props = new Map();
    return {
      dataset: {},
      textContent: '',
      style: { setProperty: (k, v) => props.set(k, v), getPropertyValue: k => props.get(k) || '' },
      classList: {
        contains: c => classes.has(c),
        toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : Boolean(force); if (on) classes.add(c); else classes.delete(c); return on; }
      }
    };
  };
  const map = new Map();
  const $ = id => { if (!map.has(id)) map.set(id, makeNode()); return map.get(id); };
  $('stat-drawer-super').dataset.player = '4';

  const filled = [];
  const otherBody = { playerIndex: 1, meter: 55, superArm: false, carded: false, stunned: false, equippedSuper: { name: 'Stalwart' } };
  const awayBody = { playerIndex: 4, meter: 100, superArm: false, carded: false, stunned: false, equippedSuper: { name: 'Knockout' } };
  const state = {
    selected: 0,
    dirtyMeters: new Set([otherBody, awayBody]),
    P
  };
  const ctrl = ububallPlayback.createMeterController({
    state, $, P, ububallMatch,
    setMeterFill(el, m) { filled.push([el, m]); }
  });
  ctrl.flushMeters();
  assert.equal($('stat-drawer-super-pct').textContent, '100% · Ready');
  assert.equal($('stat-drawer-super').classList.contains('ready'), true);
  assert.equal($('stat-drawer-super').classList.contains('armed'), false);
  assert.ok(filled.some(([el, m]) => el === $('stat-drawer-super-fill') && m === 100));
});
