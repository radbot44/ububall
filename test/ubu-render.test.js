'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ubu = require('../shared/ubu.js');

// The card and face renderers only need SVG construction, not a browser layout engine.
class Element {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.style = {}; this.textContent = ''; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  append(...children) { this.children.push(...children); }
  insertBefore(node, ref) {
    const i = this.children.indexOf(ref);
    if (i >= 0) this.children.splice(i, 0, node);
    else this.children.push(node);
  }
  replaceChildren(...children) { this.children = [...children]; }
  cloneNode(deep) {
    const copy = new Element(this.tag);
    copy.attrs = { ...this.attrs };
    copy.textContent = this.textContent;
    if (deep) copy.children = this.children.map(c => c.cloneNode(true));
    return copy;
  }
  addEventListener() {}
  removeEventListener() {}
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return []; }
}
const context = vm.createContext({
  document: {
    createElementNS: (_, tag) => new Element(tag),
    createElement: tag => new Element(tag),
    addEventListener: () => {},
    removeEventListener: () => {},
    body: new Element('body')
  },
  ubu,
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  MutationObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} },
  window: { addEventListener: () => {}, removeEventListener: () => {} },
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  queueMicrotask: () => {},
  innerHeight: 800,
  innerWidth: 1200,
  Math, Object, Array, Set, Map, WeakMap, Float32Array, Uint8Array, Number, String, Boolean, parseInt, parseFloat, Promise
});
context.globalThis = context;
vm.runInContext(fs.readFileSync(require.resolve('../shared/ubu-render.js'), 'utf8'), context);

function card(angles) {
  return context.ubuRender.cardMaterials({ attributes: Object.fromEntries(
    ['background', 'eyes', 'mouth', 'irises', 'pupils'].slice(0, angles.length).map((role, i) =>
      [role, { texture: 'glossy', hex: ['#f00', '#0f0', '#00f', '#ff0', '#0ff'][i], angle: angles[i] }])) });
}
function flatten(node) { return [node, ...node.children.filter(c => typeof c === 'object').flatMap(flatten)]; }
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

test('all 32 materials and matte render across static ubus, interactive oomarks, backs, tokens and cards', () => {
  const textures = [
    null, 'metallic', 'glossy', 'iridescent', 'crystalline', 'pearlescent', 'damascus', 'marble', 'lacquered',
    'velvet', 'frosted', 'woodgrain', 'holographic', 'terrazzo', 'crackle', 'plush', 'opalescent', 'granite',
    'satin', 'sandstone', 'starfield', 'quartz', 'obsidian', 'mosaic', 'hammered-metal', 'kintsugi', 'leather',
    'carbon-fiber', 'denim', 'bubbled', 'lava', 'circuitry', 'liquid'
  ];
  const dna = new Uint8Array(128);
  for (let i = 0; i < 128; i++) dna[i] = (i * 53 + 11) & 0xff;
  const base = ubu.decode(dna);

  for (const texture of textures) {
    const m = structuredClone(base);
    for (const [idx, role] of ['background', 'eyes', 'irises', 'pupils', 'mouth'].entries()) {
      m.attributes[role] = { name: 'Coral', hex: '#ff7d69', texture, angle: idx * 45 };
    }
    const tileSvg = context.ubuRender(m, 'ubu-tile-svg');
    assert.equal(tileSvg.attrs.class, 'ubu-tile-svg');
    const liveEffects = [];
    const liveSvg = context.ubuRender(m, 'oomark', null, liveEffects);
    assert.equal(liveSvg.attrs.class, 'oomark');
    const backSvg = context.ubuRender.back(m);
    assert.equal(backSvg.attrs.class, 'ubu-back');
    const tokenEffects = [];
    const tokenSvg = context.ubuRender.token(m, null, tokenEffects);
    assert.equal(tokenSvg.attrs.class, 'enamel-token');
    const tokenBackSvg = context.ubuRender.tokenBack(m, tokenEffects);
    assert.equal(tokenBackSvg.attrs.class, 'enamel-token token-back');
    const cardSvg = context.ubuRender.cardMaterials(m);
    if (texture) assert.equal(cardSvg.attrs.class, 'card-materials');
    else assert.equal(cardSvg, null);
  }
});

test('disjoint circle roles use analytic rims without feMorphology filters while tight bounds trim eye/mouth filters', () => {
  const dna = new Uint8Array(128);
  const m = ubu.decode(dna);
  for (const role of ['background', 'eyes', 'irises', 'pupils', 'mouth']) {
    m.attributes[role] = { name: 'Volt', hex: '#0066ff', texture: null, angle: 45 };
  }
  m.attributes.background.texture = 'glossy';
  m.attributes.pupils.texture = 'metallic';
  const disjointOnly = context.ubuRender(m, 'ubu-tile-svg');
  const filtersDisjoint = flatten(disjointOnly).filter(n => n.tag === 'filter');
  assert.equal(filtersDisjoint.length, 0, 'background and pupils need zero feMorphology filters');

  m.attributes.mouth.texture = 'glossy';
  const withMouth = context.ubuRender(m, 'ubu-tile-svg');
  const mouthFilters = flatten(withMouth).filter(n => n.tag === 'filter');
  assert.equal(mouthFilters.length, 2);
  for (const f of mouthFilters) {
    assert.ok(+f.attrs.width < 360 && +f.attrs.height < 180, 'mouth filter bounds are tightened to mouth silhouette');
  }

  m.attributes.background.texture = 'damascus';
  const damascusUbu = context.ubuRender(m, 'ubu-tile-svg');
  const etch = flatten(damascusUbu).find(n => n.tag === 'filter' && n.attrs.id.endsWith('-etch'));
  assert.equal(+etch.attrs.width, 360);
  assert.equal(+etch.attrs.height, 360);
  const damascusCard = context.ubuRender.cardMaterials(m);
  const cardEtch = flatten(damascusCard).find(n => n.tag === 'filter' && n.attrs.id.endsWith('-etch'));
  assert.equal(+cardEtch.attrs.width, 720);
  assert.equal(+cardEtch.attrs.height, 720);
});
