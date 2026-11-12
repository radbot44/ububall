'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const list = require('../web/ubu-list.js');
const ubuCore = require('../shared/ubu.js');
const ubuFile = require('../shared/ubu-file.js');
const rarity = require('../shared/rarity.js');
const ubuArchetype = require('../shared/ubu-archetype.js');

const stats = (impulse, size) => ({ impulse, traction: 127, spin: 127, curve: 127, size, mass: 127, bounciness: 127, grip: 127,
  power: 127, reach: 127, strength: 127, stability: 127, efficiency: 127, synergy: 127, chemistry: 127 });
const ubu = (serial, { name, issuedAt, favorite = false, bits = 10, rating = 500, grade = 'B', supers = [0, 0, 0, 0], impulse = 127, size = 127 }) =>
  ({ serial, issuedAt, favorite, rarity: { bits, percentile: bits }, model: { rating, grade, supers, stats: stats(impulse, size), parts: { fullName: name } } });
const items = [
  ubu('000000000001', { name: 'Ekfopo Ruba', issuedAt: 100, bits: 30, rating: 950, grade: 'S+', supers: [3, 11, 3, 4], impulse: 200, size: 40 }),
  ubu('000000000002', { name: 'Ama Tobi', issuedAt: 100, favorite: true, bits: 12, rating: 120, grade: 'C', supers: [1, 1, 1, 1], impulse: 90, size: 220 }),
  ubu('000000001818', { name: 'Zeno Kwa', issuedAt: 300, bits: 20, rating: 760, grade: 'S', supers: [5, 6, 7, 13], impulse: 200, size: 127 }),
  ubu('000000000004', { name: 'Bibo Lu', issuedAt: 200, favorite: true, bits: 5, rating: 640, grade: 'A', supers: [2, 2, 4, 4], impulse: 30, size: 127 }),
  { serial: '000000000005', favorite: false, pending: true }
];
const serials = (state) => list.view(items, state).map(item => item.serial);

test('default order is newest first, ties by serial descending, pending last', () => {
  assert.deepEqual(serials({}), ['000000001818', '000000000004', '000000000002', '000000000001', '000000000005']);
  assert.deepEqual(serials({ reverse: true }), ['000000000002', '000000000001', '000000000004', '000000001818', '000000000005']);
});

test('collection orders use their natural direction and reverse cleanly', () => {
  assert.deepEqual(serials({ sort: 'rarity' }).slice(0, 4), ['000000000001', '000000001818', '000000000002', '000000000004']);
  assert.deepEqual(serials({ sort: 'ubuquity' }).slice(0, 4), ['000000000001', '000000001818', '000000000004', '000000000002']);
  assert.deepEqual(serials({ sort: 'serial' }).slice(0, 4), ['000000000001', '000000000002', '000000000004', '000000001818']);
  assert.deepEqual(serials({ sort: 'serial', reverse: true }).slice(0, 4), ['000000001818', '000000000004', '000000000002', '000000000001']);
  assert.deepEqual(serials({ sort: 'name' }).slice(0, 4), ['000000000002', '000000000004', '000000000001', '000000001818']);
  assert.deepEqual(serials({ sort: 'favorite' }).slice(0, 4), ['000000000004', '000000000002', '000000001818', '000000000001']);
});

test('every stat sorts high to low by default, ties by serial descending', () => {
  for (const [, , keys] of list.STAT_GROUPS) for (const key of keys) assert.ok(list.METRICS[key].stat === key);
  assert.equal(Object.keys(list.METRICS).filter(key => list.METRICS[key].stat).length, 15);
  assert.deepEqual(serials({ sort: 'impulse' }).slice(0, 4), ['000000001818', '000000000001', '000000000002', '000000000004']);
  assert.deepEqual(serials({ sort: 'size', reverse: true }).slice(0, 4), ['000000000001', '000000001818', '000000000004', '000000000002']);
});

test('search matches names case-insensitively and digits against serials', () => {
  assert.deepEqual(serials({ query: 'ekf' }), ['000000000001']);
  assert.deepEqual(serials({ query: '  TOBI ' }), ['000000000002']);
  assert.deepEqual(serials({ query: '1818' }), ['000000001818']);
  assert.deepEqual(serials({ query: '#000000000004' }), ['000000000004']);
  assert.deepEqual(serials({ query: 'nobody' }), []);
});

test('quoted phrases work for bare names, field values and negated phrases without parsing quoted operators', () => {
  assert.deepEqual(serials({ query: '"ekfopo ruba"' }), ['000000000001']);
  assert.deepEqual(serials({ query: 'name:"ama tobi"' }), ['000000000002']);
  assert.deepEqual(serials({ query: '-name:"ama tobi"' }), ['000000001818', '000000000004', '000000000001']);
  const quotedOp = list.parseQuery('"sort:power"');
  assert.deepEqual(quotedOp.sorts, []);
  assert.deepEqual(quotedOp.errors, []);
  assert.equal(quotedOp.tests.length, 1);
});

test('filters match any choice within a group and all groups together; pending drops out', () => {
  assert.deepEqual(serials({ grades: ['S', 'S+'] }), ['000000001818', '000000000001']);
  // Super slots count modulo 8: slot value 11 is Cannonball (3), 13 is Colossus (5).
  assert.deepEqual(serials({ supers: [3] }), ['000000000001']);
  assert.deepEqual(serials({ supers: [5, 1] }), ['000000001818', '000000000002']);
  assert.deepEqual(serials({ supers: [4], grades: ['A'] }), ['000000000004']);
  assert.deepEqual(serials({ favoritesOnly: true }), ['000000000004', '000000000002']);
  assert.deepEqual(serials({ favoritesOnly: true, grades: ['S'] }), []);
});

test('rarity scores keep runs of nines visible', () => {
  assert.equal(list.rarityScore(42.123), '42.12');
  assert.equal(list.rarityScore(99.9734), '99.973');
  assert.equal(list.rarityScore(99.99971), '99.9997');
});

test('comparisons cover stats, group and overall averages, grades, supers, mastery and favorites', () => {
  assert.deepEqual(serials({ query: 'impulse>100' }), ['000000001818', '000000000001']);
  assert.deepEqual(serials({ query: 'IMPULSE<=90' }), ['000000000004', '000000000002']);
  assert.deepEqual(serials({ query: 'movement>=145' }), ['000000001818', '000000000001']);
  assert.deepEqual(serials({ query: 'all>130' }), ['000000001818', '000000000002']);
  assert.deepEqual(serials({ query: 'grade>=s' }), ['000000001818', '000000000001']);
  assert.deepEqual(serials({ query: 'grade:a,c' }), ['000000000004', '000000000002']);
  assert.deepEqual(serials({ query: 'super:cannon' }), ['000000000001']);
  assert.deepEqual(serials({ query: 'super:magnet,ghost' }), ['000000001818', '000000000004', '000000000001']);
  assert.deepEqual(serials({ query: '-super:magnet' }), ['000000001818', '000000000002']);
  assert.deepEqual(serials({ query: 'mastery>=3' }), ['000000000002', '000000000001']);
  assert.deepEqual(serials({ query: 'is:fav ubuquity>200' }), ['000000000004']);
  assert.deepEqual(serials({ query: 'rarity>10 rarity<25' }), ['000000001818', '000000000002']);
});

test('several sorts apply in order before the chosen order', () => {
  assert.deepEqual(serials({ query: 'sort:impulse sort:-size' }).slice(0, 4), ['000000000001', '000000001818', '000000000002', '000000000004']);
  assert.deepEqual(serials({ query: 'sort:size,impulse' }).slice(0, 4), ['000000000002', '000000001818', '000000000004', '000000000001']);
  assert.deepEqual(serials({ query: 'sort:movement', sort: 'name' }).slice(0, 4), ['000000000001', '000000001818', '000000000002', '000000000004']);
});

test('random order is a stable shuffle per seed', () => {
  const a = serials({ sort: 'random', seed: 1 }), b = serials({ sort: 'random', seed: 2 });
  assert.deepEqual(serials({ sort: 'random', seed: 1 }), a);
  assert.deepEqual([...a].sort(), [...b].sort());
  const seeds = new Set(Array.from({ length: 12 }, (_, seed) => serials({ query: 'sort:random', seed }).join()));
  assert.ok(seeds.size > 1);
});

test('mint dates compare by local day, month or year and reject out-of-range rollover dates', () => {
  const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h) / 1000;
  const dated = [
    ubu('000000000011', { name: 'A', issuedAt: at(2026, 10, 19) }),
    ubu('000000000012', { name: 'B', issuedAt: at(2026, 10, 20, 0) }),
    ubu('000000000013', { name: 'C', issuedAt: at(2026, 10, 20, 23) }),
    ubu('000000000014', { name: 'D', issuedAt: at(2026, 11, 1) })
  ];
  const find = query => list.view(dated, { query, sort: 'serial' }).map(item => item.serial.slice(-2));
  assert.deepEqual(find('after:2026-10-20'), ['14']);
  assert.deepEqual(find('minted>=2026-10-20'), ['12', '13', '14']);
  assert.deepEqual(find('before:2026-10-20'), ['11']);
  assert.deepEqual(find('received<=2026-10-20'), ['11', '12', '13']);
  assert.deepEqual(find('minted:2026-10'), ['11', '12', '13']);
  assert.deepEqual(find('date:2026'), ['11', '12', '13', '14']);

  const badDates = list.parseQuery('minted:2026-00 minted:2026-13 minted:2026-02-29 minted:2026-04-31');
  assert.deepEqual(badDates.errors, ['minted:2026-00', 'minted:2026-13', 'minted:2026-02-29', 'minted:2026-04-31']);
  assert.equal(badDates.tests.length, 0);
});

test('terms it cannot read (including negated sort and empty values) are reported and ignored', () => {
  const parsed = list.parseQuery('power>abc foo:bar sort:nope -sort:power sort: name: grade: super:zap grade>x power>200');
  assert.deepEqual(parsed.errors, ['power>abc', 'foo:bar', 'sort:nope', '-sort:power', 'sort:', 'name:', 'grade:', 'super:zap', 'grade>x']);
  assert.equal(parsed.tests.length, 1);
  assert.deepEqual(parsed.sorts, []);
  assert.deepEqual(parsed.compared, ['power']);
});

test('serials show without leading zeros', () => {
  assert.equal(list.serialLabel('000000001084'), '#1084');
  assert.equal(list.serialLabel('999999999999'), '#999999999999');
  assert.deepEqual(serials({ query: '#1818' }), ['000000001818']);
});

test('browser ubuList coalesces concurrent refresh loads, protects in-flight setFavorite, and evicts failed key imports', async () => {
  const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const pubJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const mintId = 'A'.repeat(21) + 'A';
  const makeSigned = async (serial, issuedAt) => {
    const idBytes = crypto.getRandomValues(new Uint8Array(16));
    const id = Buffer.from(idBytes).toString('base64url');
    const dna = ubuCore.toCode(ubuCore.randomDNA());
    return ubuFile.sign({ mint: mintId, id, serial, dna, issuedAt, key: 'mint-1' }, keyPair.privateKey);
  };
  const cert1 = await makeSigned('000000000001', 1700000100);
  const cert2 = await makeSigned('000000000002', 1700000200);

  let importFailOnce = true;
  const realSubtle = crypto.subtle;
  const mockedCrypto = {
    getRandomValues: buf => crypto.getRandomValues(buf),
    subtle: {
      importKey(...args) {
        if (importFailOnce) {
          importFailOnce = false;
          return Promise.reject(new Error('transient WebCrypto failure'));
        }
        return realSubtle.importKey(...args);
      },
      verify: (...args) => realSubtle.verify(...args)
    }
  };

  let pageGate = null;
  let ubusCalls = 0;
  let favState = false;
  const listeners = new Map();
  const sandbox = {
    crypto: mockedCrypto,
    ubu: ubuCore,
    ubuFile,
    rarity,
    ubuArchetype,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    Event: class Event { constructor(type) { this.type = type; } },
    localStorage: { getItem: () => null, setItem() {} },
    getUbuSession: () => ({ owner: '123456789012345678', csrf: 'csrf-token' }),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(ev) {
      for (const fn of listeners.get(ev.type) || []) fn(ev);
    },
    fetch: async (url, options) => {
      if (url === '/api/config') {
        return { ok: true, json: async () => ({ ready: true, login: true, mint: mintId, keys: { 'mint-1': pubJwk.x }, lifetimeLimit: 5 }) };
      }
      if (url.startsWith('/api/ubus')) {
        ubusCalls++;
        const callNum = ubusCalls;
        if (callNum === 1) {
          await new Promise(resolve => { pageGate = resolve; });
          return { ok: true, json: async () => ({ ubus: [{ serial: '000000000001', certificate: cert1, favorite: false }], next: null }) };
        }
        if (pageGate) await pageGate;
        return {
          ok: true,
          json: async () => ({
            ubus: [
              { serial: '000000000002', certificate: cert2, favorite: false },
              { serial: '000000000001', certificate: cert1, favorite: favState }
            ],
            next: null
          })
        };
      }
      if (url === '/api/favorites') {
        const body = JSON.parse(options.body);
        favState = body.favorite;
        return { ok: true, json: async () => ({ serial: body.serial, favorite: body.favorite }) };
      }
      throw new Error('Unexpected URL: ' + url);
    }
  };
  sandbox.globalThis = sandbox;
  const code = fs.readFileSync(require.resolve('../web/ubu-list.js'), 'utf8');
  vm.runInNewContext(code, sandbox);

  // 1. First trustedKey call fails transiently, evicts itself, and succeeds on retry.
  await assert.rejects(() => sandbox.ubuList.trustedKey(mintId, 'mint-1'), /transient WebCrypto failure/);
  const recoveredKey = await sandbox.ubuList.trustedKey(mintId, 'mint-1');
  assert.equal(recoveredKey.type, 'public');

  // 2. Superseded load() awaits the active refresh load rather than resolving early with 0 items.
  const firstLoad = sandbox.ubuList.load();
  await new Promise(r => setImmediate(r));
  const releaseFirst = pageGate;
  pageGate = null;
  const secondLoad = sandbox.ubuList.load({ refresh: true });
  releaseFirst();
  await firstLoad;
  assert.equal(sandbox.ubuList.items().length, 2, 'superseded caller must see completed refresh items');
  await secondLoad;

  // 3. Concurrent setFavorite during an in-flight refresh is never clobbered by stale server row data.
  let releaseRefresh;
  pageGate = new Promise(resolve => { releaseRefresh = resolve; });
  favState = false; // Server snapshot read before favorite POST still had false.
  const refreshPromise = sandbox.ubuList.load({ refresh: true });
  await sandbox.ubuList.setFavorite('000000000001', true);
  assert.equal(sandbox.ubuList.get('000000000001').favorite, true);
  favState = false; // Simulate stale GET /api/ubus payload arriving after POST /api/favorites.
  releaseRefresh();
  await refreshPromise;
  assert.equal(sandbox.ubuList.get('000000000001').favorite, true, 'stale page must not overwrite newer favorite toggle');
});

test('archetype search matches plain words, archetype:/adj:/noun: filters, negation, and sort:archetype', () => {
  const fullUbu = (serial, name, personality, overrides = {}) => ({
    serial,
    issuedAt: 100,
    favorite: false,
    rarity: { bits: 10, percentile: 10 },
    model: {
      rating: 500,
      grade: 'B',
      supers: [0, 0, 0, 0],
      parts: { fullName: name },
      personality,
      stats: {
        impulse: 127, traction: 127, spin: 127, curve: 127,
        size: 127, mass: 127, bounciness: 127, grip: 127,
        power: 127, reach: 127, strength: 127, stability: 127,
        efficiency: 127, synergy: 127, chemistry: 127,
        ...overrides
      }
    }
  });
  const roster = [
    fullUbu('000000000101', 'Alpha One', { aggression: 60, creativity: 60, teamwork: 60, clutch: 30 }, { impulse: 145, traction: 230, spin: 45, curve: 40, efficiency: 230, synergy: 65, chemistry: 65 }), // Peppy Piston
    fullUbu('000000000102', 'Beta Two', { aggression: 30, creativity: 10, teamwork: 60, clutch: 30 }, { power: 90, reach: 230, strength: 85, stability: 125, efficiency: 135, synergy: 45, chemistry: 235 }), // Solid Trapper
    fullUbu('000000000103', 'Gamma Three', { aggression: 60, creativity: 10, teamwork: 60, clutch: 30 }, { impulse: 45, traction: 210, spin: 35, curve: 40 }) // Fierce Curler
  ];
  const pick = q => list.view(roster, { query: q, sort: 'serial' }).map(x => x.serial.slice(-3));
  assert.deepEqual(pick('piston'), ['101']);
  assert.deepEqual(pick('"solid trapper"'), ['102']);
  assert.deepEqual(pick('adj:peppy,fierce'), ['101', '103']);
  assert.deepEqual(pick('adjective:solid'), ['102']);
  assert.deepEqual(pick('noun:trapper,curler'), ['102', '103']);
  assert.deepEqual(pick('archetype:"fierce curler"'), ['103']);
  assert.deepEqual(pick('-noun:piston'), ['102', '103']);
  assert.deepEqual(list.view(roster, { sort: 'archetype' }).map(x => x.serial.slice(-3)), ['103', '101', '102']);

  const bad = list.parseQuery('archetype: adj: noun:');
  assert.deepEqual(bad.errors, ['archetype:', 'adj:', 'noun:']);
});

test('tileMain mounts stat value inside artBox, splits archetype into adj + noun, omits tile badge, and packs sort controls into filter popover', () => {
  const makeNode = (tag, props = {}) => {
    const attrs = new Map();
    const getSet = n => new Set((n.className || '').split(/\s+/).filter(Boolean));
    const setSet = (n, st) => { n.className = [...st].join(' '); };
    const node = {
      tagName: tag.toUpperCase(),
      className: props.className || '',
      textContent: props.textContent || '',
      hidden: Boolean(props.hidden),
      value: props.value || '',
      dataset: {},
      style: {},
      children: [],
      classList: {
        add: (...cs) => { const st = getSet(node); cs.forEach(c => st.add(c)); setSet(node, st); },
        remove: (...cs) => { const st = getSet(node); cs.forEach(c => st.delete(c)); setSet(node, st); },
        toggle: (c, on) => { const st = getSet(node); const v = on === undefined ? !st.has(c) : Boolean(on); if (v) st.add(c); else st.delete(c); setSet(node, st); return v; },
        contains: c => getSet(node).has(c)
      },
      append(...kids) {
        for (const k of kids) {
          if (k === '' || k == null) continue;
          this.children.push(typeof k === 'string' ? { textContent: k, children: [] } : k);
        }
      },
      prepend(...kids) { this.children.unshift(...kids.filter(Boolean)); },
      replaceChildren(...kids) { this.children = []; this.append(...kids); },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      querySelector(sel) {
        const cls = sel.startsWith('.') ? sel.slice(1) : null;
        const visit = n => {
          for (const ch of n.children || []) {
            if (cls && ch.classList?.contains(cls)) return ch;
            const found = visit(ch);
            if (found) return found;
          }
          return null;
        };
        return visit(this);
      },
      addEventListener() {}
    };
    return Object.assign(node, props);
  };

  const sandbox = {
    ubuArchetype,
    ububallPhysics: {
      SUPERS: Array.from({ length: 8 }, (_, id) => ({ id, name: 'S' + id, icon: id + '.png' })),
      superMastery: (_s, id) => ({ id, level: 2, displayName: 'Super ' + id + ' II' })
    },
    localStorage: { getItem: () => null, setItem() {} },
    addEventListener() {},
    dispatchEvent() {},
    Option: function(label, val) { return makeNode('option', { textContent: label, value: val }); },
    Event: class { constructor(t) { this.type = t; } },
    CustomEvent: class { constructor(t) { this.type = t; } },
    gameUi: {
      icon: name => makeNode('svg', { iconName: name }),
      select: sel => ({ sync() {}, button: sel }),
      dropdown: () => {}
    },
    document: { createElement: tag => makeNode(tag) }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/ubu-list.js'), 'utf8'), sandbox);

  const decoded = ubuCore.decode(ubuCore.randomDNA());
  const { main, artBox, value } = sandbox.ubuList.tileMain(decoded, '#5037');
  assert.equal(artBox.children.includes(value), true, 'stat value badge lives inside .ubu-tile-art for bottom-right overlay');
  assert.equal(main.children.includes(value), false, 'stat value is no longer a bottom row inside .ubu-tile-main');
  const archEl = main.querySelector('.ubu-tile-archetype');
  assert.ok(archEl.querySelector('.ubu-tile-adj') && archEl.querySelector('.ubu-tile-noun'), 'archetype splits into .ubu-tile-adj and .ubu-tile-noun');
  sandbox.ubuList.describeTile(main, decoded.parts.fullName, { badge: 'Back' });
  assert.equal(main.querySelector('.ubu-tile-badge'), null, 'describeTile omits .ubu-tile-badge element');
  assert.equal(main.getAttribute('aria-pressed'), 'true', 'describeTile still sets aria-pressed for picked teammates');

  let isWide = false, mediaListener = null;
  sandbox.matchMedia = () => ({
    get matches() { return isWide; },
    addEventListener(_t, fn) { mediaListener = fn; }
  });
  // Add before() helper on nodes for wide-screen inline insertion
  const origCreate = sandbox.document.createElement;
  sandbox.document.createElement = tag => {
    const n = origCreate(tag);
    const wrapChildren = parent => {
      for (const ch of parent.children) ch._parent = parent;
    };
    const origAppend = n.append.bind(n);
    n.append = (...kids) => {
      for (const k of kids) {
        if (k && typeof k === 'object' && k._parent) {
          k._parent.children = k._parent.children.filter(x => x !== k);
        }
      }
      origAppend(...kids);
      wrapChildren(n);
    };
    n.before = (...items) => {
      const p = n._parent;
      if (!p) return;
      for (const it of items) {
        if (it._parent) it._parent.children = it._parent.children.filter(x => x !== it);
        it._parent = p;
      }
      const idx = p.children.indexOf(n);
      p.children.splice(idx, 0, ...items);
    };
    return n;
  };

  const toolbarHost = sandbox.document.createElement('div');
  const grid = sandbox.document.createElement('div');
  sandbox.ubuList.mount({ surface: 'roster', toolbarHost, grid });
  const row = toolbarHost.querySelector('.ubu-toolbar-row');
  const chips = toolbarHost.querySelector('.ubu-chips');
  const sortRow = chips.querySelector('.ubu-sort-row');
  assert.equal(row.children.length, 2, 'narrow screens keep only search box and filter-2 toggle on toolbar row');
  assert.equal(row.children[1].classList.contains('ubu-filters-toggle'), true);
  assert.equal(row.children[1].children[0].iconName, 'filter-2', 'filter toggle uses Tabler filter-2 icon');
  assert.equal(sortRow.hidden, false, 'narrow screens show sort, direction, and favorites inside filter popover');

  isWide = true;
  mediaListener?.();
  assert.equal(row.children.length, 5, 'large screens place search, sort, direction, favorites, and filter-2 inline on one row');
  assert.equal(sortRow.hidden, true, 'large screens hide duplicate sort row inside filter popover');
});
