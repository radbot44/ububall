'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
// The card renderer only needs SVG construction, not a browser layout engine.
class Element {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  append(...children) { this.children.push(...children); }
}
const context = vm.createContext({ document: { createElementNS: (_, tag) => new Element(tag) } });
vm.runInContext(fs.readFileSync(require.resolve('./ubu-render.js'), 'utf8'), context);
function card(angles) {
  return context.ubuRender.cardMaterials({ attributes: Object.fromEntries(
    ['background', 'eyes', 'mouth', 'irises', 'pupils'].slice(0, angles.length).map((role, i) =>
      [role, { texture: 'glossy', hex: ['#f00', '#0f0', '#00f', '#ff0', '#0ff'][i], angle: angles[i] }])) });
}
function flatten(node) { return [node, ...node.children.flatMap(flatten)]; }
function stripes(group) {
  const path = group.children.find(n => n.tag === 'path');
  return [...path.attrs.d.matchAll(/M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v([\d.]+)/g)]
    .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
}
test('card material canvas matches landscape and cannot stretch texture aspect ratio', () => {
  const svg = card([45]);
  const [, , w, h] = svg.attrs.viewBox.split(' ').map(Number);
  assert.equal(w / h, 1.5);
  assert.equal(svg.attrs.preserveAspectRatio, 'xMidYMid slice');
  const bounds = flatten(svg).find(n => n.tag === 'clipPath').children[0];
  assert.equal(+bounds.attrs.width, w); assert.equal(+bounds.attrs.height, h);
});
test('parallel card materials retain separate visible stripes, including opposite angles', () => {
  for (const angle of [0, 45, 90, 135]) {
    for (let count = 2; count <= 5; count++) {
      const svg = card(Array.from({ length: count }, (_, i) => angle + (i % 2) * 180));
      const groups = svg.children[1].children;
      // Test the rendered stripe footprints, before any masking can hide a color.
      for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
        assert.equal(groups[i].attrs.transform, groups[j].attrs.transform);
        for (const a of stripes(groups[i])) for (const b of stripes(groups[j])) {
          assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x, 'parallel colors overlap');
        }
      }
      const patterns = svg.children[0].children.filter(n => n.tag === 'pattern' && /-pat-\d+$/.test(n.attrs.id));
      for (let i = 0; i < patterns.length; i++) {
        const rotation = +patterns[i].attrs.patternTransform.match(/rotate\(([-\d.]+)/)[1];
        assert.equal(rotation + angle, angle + (i % 2) * 180, 'material orientation preserved');
      }
    }
  }
});
