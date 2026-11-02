'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const list = require('../web/ubu-list.js');

const stats = (impulse, size) => ({ impulse, traction: 127, spin: 127, curve: 127, size, mass: 127, bounciness: 127, grip: 127,
  power: 127, reach: 127, strength: 127, stability: 127, efficiency: 127, synergy: 127, chemistry: 127 });
const ubu = (serial, { name, issuedAt, favorite = false, bits = 10, rating = 500, grade = 'B', supers = [0, 0, 0, 0], impulse = 127, size = 127 }) =>
  ({ serial, issuedAt, favorite, rarity: { bits, percentile: 50 }, model: { rating, grade, supers, stats: stats(impulse, size), parts: { fullName: name } } });
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
  for (const [, , keys] of list.STAT_GROUPS) for (const key of keys) assert.ok(list.SORTS[key].stat === key);
  assert.equal(Object.keys(list.SORTS).filter(key => list.SORTS[key].stat).length, 15);
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
