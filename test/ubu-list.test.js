'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const list = require('../web/ubu-list.js');

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

test('mint dates compare by local day, month or year', () => {
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
});

test('terms it cannot read are reported and ignored', () => {
  const parsed = list.parseQuery('power>abc foo:bar sort:nope super:zap grade>x power>200');
  assert.deepEqual(parsed.errors, ['power>abc', 'foo:bar', 'sort:nope', 'super:zap', 'grade>x']);
  assert.equal(parsed.tests.length, 1);
  assert.deepEqual(parsed.compared, ['power']);
});

test('serials show without leading zeros', () => {
  assert.equal(list.serialLabel('000000001084'), '#1084');
  assert.equal(list.serialLabel('999999999999'), '#999999999999');
  assert.deepEqual(serials({ query: '#1818' }), ['000000001818']);
});
