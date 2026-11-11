'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const list = require('../web/ubu-list.js');
const ubuCore = require('../shared/ubu.js');
const ubuFile = require('../shared/ubu-file.js');
const rarity = require('../shared/rarity.js');

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
