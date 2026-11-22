'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ubu = require('../shared/ubu.js');

const cjsRender = require('../shared/ubu-render.js');
assert.equal(typeof cjsRender, 'function');
assert.equal(globalThis.ubuRender, cjsRender);

class Element {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.style = { setProperty(k, v) { this[k] = v; } };
    this.textContent = '';
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  append(...children) { this.children.push(...children); }
  insertBefore(node, ref) {
    const i = this.children.indexOf(ref);
    if (i >= 0) this.children.splice(i, 0, node);
    else this.children.push(node);
  }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener() {}
  removeEventListener() {}
  closest() { return null; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 }; }
  getClientRects() { return [this.getBoundingClientRect()]; }
  cloneNode(deep) {
    const copy = new Element(this.tag);
    copy.attrs = { ...this.attrs };
    copy.textContent = this.textContent;
    if (deep) copy.children = this.children.map(c => typeof c === 'string' ? c : c.cloneNode(true));
    return copy;
  }
  serialize() {
    const a = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    if (!this.children.length && !this.textContent) return `<${this.tag}${a}/>`;
    return `<${this.tag}${a}>${this.textContent}${this.children.map(c => typeof c === 'string' ? c : c.serialize()).join('')}</${this.tag}>`;
  }
}

const context = vm.createContext({
  document: {
    hidden: false,
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
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  queueMicrotask: fn => fn(),
  window: { addEventListener: () => {}, removeEventListener: () => {} },
  Math, Object, Array, Set, Map, WeakMap, Float32Array, Uint8Array, Number, String, Boolean, parseInt, parseFloat
});
context.globalThis = context;
context.ubuRender = cjsRender.createUbuRenderer(context);

test('all 32 materials, matte, and malformed hex colors render cleanly across all render modes', () => {
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
    assert.equal(context.ubuRender(m, 'ubu-tile-svg').attrs.class, 'ubu-tile-svg');
    assert.equal(context.ubuRender(m, 'oomark', null, []).attrs.class, 'oomark');
    assert.equal(context.ubuRender.back(m).attrs.class, 'ubu-back');
    const tokenEffects = [];
    assert.equal(context.ubuRender.token(m, null, tokenEffects).attrs.class, 'enamel-token');
    assert.equal(context.ubuRender.tokenBack(m, tokenEffects).attrs.class, 'enamel-token token-back');
    assert.equal(context.ubuRender.tokenBack(m).attrs.class, 'enamel-token token-back');
    const cardSvg = context.ubuRender.cardMaterials(m);
    if (texture) assert.equal(cardSvg.attrs.class, 'card-materials');
    else assert.equal(cardSvg, null);
  }

  const malformed = structuredClone(base);
  malformed.attributes.background = { name: 'DarkShort', hex: '#111', texture: 'woodgrain', angle: undefined };
  malformed.attributes.eyes = { name: 'Malformed', hex: '#0', texture: 'marble' };
  malformed.attributes.mouth = { name: 'Empty', hex: '', texture: 'crystalline' };
  const safeSvg = context.ubuRender(malformed, 'oomark', null, []).serialize();
  assert.ok(!safeSvg.includes('undefined') && !safeSvg.includes('NaN'));
});
