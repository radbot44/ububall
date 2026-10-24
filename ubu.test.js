'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ubu = require('./ubu.js');
const vectors = require('./test/dna-vectors.json');
const roles = ['background', 'eyes', 'irises', 'pupils', 'mouth'];

function set(dna, start, width, value) {
  for (let i = 0; i < width; i++) {
    const bit = start + i, mask = 1 << (7 - (bit & 7));
    dna[bit >> 3] = (dna[bit >> 3] & ~mask) | (((value >> (width - i - 1)) & 1) ? mask : 0);
  }
}
function equal(actual, expected) {
  if (typeof expected === 'number') {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-10, `${actual} != ${expected}`);
  } else if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, i) => equal(actual[i], value));
  } else assert.equal(actual, expected);
}
test('accepted DNA and text reference outputs remain unchanged', async () => {
  for (const v of vectors) {
    const dna = ubu.fromCode(v.code);
    assert.equal(ubu.toCode(dna), v.code);
    if (Object.hasOwn(v, 'text')) assert.equal(ubu.toCode(await ubu.fromText(v.text)), v.code);
    const m = ubu.decode(dna);
    equal([m.parts.praenomen, m.parts.nomen, m.parts.cognomen], v.name);
    equal(Object.values(m.attributes).map(a => [a.color, a.name, a.hex, a.angle, a.texture]), v.attributes);
    equal([m.mouth.raw, m.mouth.corners, m.mouth.source, m.mouth.width, m.mouth.height, m.mouth.x, m.mouth.y], v.mouth);
    equal([m.eyes.raw, m.eyes.dx, m.eyes.dy, m.eyes.leftX, m.eyes.leftY, m.eyes.flipX, m.eyes.flipY], v.eyes);
    equal([m.rating, m.grade], v.rating);
    assert.ok(!/NaN|Infinity/.test(ubu.mouthPath(m.mouth)));
  }
});
test('finish gates, orientation and every Ubuquity boundary retain their meaning', () => {
  for (let slot = 0; slot < 5; slot++) {
    const counts = {};
    for (let flags = 0; flags < 256; flags++) {
      const dna = new Uint8Array(32);
      dna[9 + slot * 2] = flags;
      const finish = ubu.decode(dna).attributes[roles[slot]].texture;
      counts[finish] = (counts[finish] || 0) + 1;
    }
    assert.deepEqual(counts, { null: 252, crystalline: 1, iridescent: 1, glossy: 1, metallic: 1 });
    for (let angle = 0; angle < 8; angle++) {
      const dna = new Uint8Array(32);
      set(dna, 69 + 16 * slot, 3, angle);
      assert.equal(ubu.decode(dna).attributes[roles[slot]].angle, angle * 45);
    }
  }
  const grades = ['B', 'A', 'A+', 'S', 'S+', 'S++'];
  let value = 0;
  for (const [i, count] of [125, 75, 25, 15, 11, 5].entries()) {
    for (let n = 0; n < count; n++, value++) {
      const dna = new Uint8Array(32); dna[31] = value;
      assert.equal(ubu.decode(dna).grade, grades[i]);
      assert.equal(ubu.decode(dna).rating, value);
    }
  }
});
test('corner precedence and neutral, endpoint and flipped eye geometry are permanent', () => {
  const dna = new Uint8Array(32);
  for (const bit of [168, 178, 188, 198, 208, 218]) set(dna, bit, 10, 511);
  for (const bit of [144, 148, 152, 156, 160, 164]) {
    const single = new Uint8Array(dna); set(single, bit, 4, 15);
    const index = (bit - 144) / 4;
    equal(ubu.decode(single).mouth.corners, [index === 0 || index === 2, index === 0 || index === 3, index === 1 || index === 4, index === 1 || index === 5]);
  }
  set(dna, 144, 4, 15); set(dna, 164, 4, 15);
  equal(ubu.decode(dna).mouth.corners, [true, true, false, false]);
  for (const roll of [1022, 1023]) {
    set(dna, 228, 10, roll); set(dna, 238, 10, roll);
    const m = ubu.decode(dna);
    assert.equal(m.eyes.flipX, roll === 1023); assert.equal(m.eyes.flipY, roll === 1023);
    assert.equal(m.eyes.leftX, 0); assert.equal(m.eyes.leftY, 0);
  }
  for (const bit of [208, 218]) for (const value of [0, 1023]) {
    const single = new Uint8Array(dna); set(single, bit, 10, value);
    const e = ubu.decode(single).eyes;
    equal(Math.hypot(e.dx, e.dy), 35.3374);
    equal([e.leftX, e.leftY], [-e.dx, -e.dy]);
  }
  assert.equal(ubu.curve(0), -1); assert.equal(ubu.curve(511), 0); assert.equal(ubu.curve(1023), 1);
});
test('DNA import preserves all bytes and rejects invalid or noncanonical encodings', () => {
  for (const v of vectors) {
    const dna = ubu.fromCode(v.code);
    assert.deepEqual(ubu.fromCode(Buffer.from(dna).toString('hex')), dna);
  }
  for (const invalid of ['', 'A'.repeat(42), 'A'.repeat(44), '!'.repeat(43), 'A'.repeat(42) + 'B']) {
    assert.throws(() => ubu.fromCode(invalid));
  }
  assert.throws(() => ubu.decode(new Uint8Array(31)));
});
