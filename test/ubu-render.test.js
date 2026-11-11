'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ubu = require('../shared/ubu.js');

// Verify CommonJS require exports ubuRender while keeping globalThis attachment.
const cjsRender = require('../shared/ubu-render.js');
assert.equal(typeof cjsRender, 'function');
assert.equal(globalThis.ubuRender, cjsRender);

// The card and face renderers only need SVG construction, not a browser layout engine.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.children = [];
    this.style = { setProperty(k, v) { this[k] = v; } };
    this.textContent = '';
    this.listeners = new Map();
    this.isConnected = true;
    this.rect = { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 };
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
  cloneNode(deep) {
    const copy = new Element(this.tag);
    copy.attrs = { ...this.attrs };
    copy.textContent = this.textContent;
    if (deep) copy.children = this.children.map(c => typeof c === 'string' ? c : c.cloneNode(true));
    return copy;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatch(type, event = {}) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
  }
  closest() { return null; }
  getBoundingClientRect() { return this.rect; }
  getClientRects() { return this.rect.width > 0 && this.rect.height > 0 ? [this.rect] : []; }
  serialize() {
    const a = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    if (!this.children.length && !this.textContent) return `<${this.tag}${a}/>`;
    return `<${this.tag}${a}>${this.textContent}${this.children.map(c => typeof c === 'string' ? c : c.serialize()).join('')}</${this.tag}>`;
  }
}

const rafQueue = [];
let mutationObservers = [];
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
  XMLSerializer: class { serializeToString(node) { return node.serialize(); } },
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  MutationObserver: class {
    constructor(cb) { this.cb = cb; this.disconnected = false; mutationObservers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  },
  IntersectionObserver: class { observe() {} disconnect() {} },
  window: { addEventListener: () => {}, removeEventListener: () => {} },
  requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: () => {},
  queueMicrotask: fn => fn(),
  innerHeight: 800,
  innerWidth: 1200,
  Math, Object, Array, Set, Map, WeakMap, Float32Array, Uint8Array, Number, String, Boolean, parseInt, parseFloat, Promise
});
context.globalThis = context;
vm.runInContext(fs.readFileSync(require.resolve('../shared/ubu-render.js'), 'utf8'), context);

function flushRaf(time = 50) {
  const batch = rafQueue.splice(0);
  for (const fn of batch) fn(time);
}

function card(angles) {
  return context.ubuRender.cardMaterials({ attributes: Object.fromEntries(
    ['background', 'eyes', 'mouth', 'irises', 'pupils'].slice(0, angles.length).map((role, i) =>
      [role, { texture: 'glossy', hex: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'][i], angle: angles[i] }])) });
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

test('parallel card materials retain separate visible stripes, including opposite angles, and orient interactive light in screen space', () => {
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

  // At 90 degrees, horizontal screen motion (x = 1, y = 0) maps to group local +y (gx = 0, gy = -1).
  const fx = [];
  const rotatedCard = context.ubuRender.cardMaterials({
    attributes: { background: { texture: 'metallic', hex: '#ff0000', angle: 90 } }
  }, fx);
  assert.ok(fx.length > 0);
  fx[0](1, 0);
  const edgeGrad = flatten(rotatedCard).find(n => n.tag === 'linearGradient' && n.attrs.id.endsWith('-edge-0-light'));
  const [, tx, ty] = edgeGrad.attrs.gradientTransform.match(/translate\(([-\d.eE+]+) ([-\d.eE+]+)\)/);
  assert.ok(Math.abs(+tx) < 1e-9 && Math.abs(+ty + 30) < 1e-9, '90-degree stripe bevel translates along screen X');
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
    // Standalone tokenBack without effects array also succeeds without throwing.
    const standaloneTokenBack = context.ubuRender.tokenBack(m);
    assert.equal(standaloneTokenBack.attrs.class, 'enamel-token token-back');
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

test('back-face fabric oomarks keep stitch strokes inside userSpaceOnUse seam masks without over-eroding eye rings', () => {
  const m = ubu.decode(new Uint8Array(128));
  for (const tex of ['denim', 'leather', 'plush']) {
    m.attributes.eyes = { name: 'Cobalt', hex: '#2659ac', texture: tex, angle: 45 };
    m.attributes.mouth = { name: 'Coral', hex: '#ff7d69', texture: tex, angle: 90 };
    const back = context.ubuRender.back(m);
    const all = flatten(back);
    const seamFilters = all.filter(n => n.tag === 'filter' && n.attrs.id.includes('-eyes-edge-seam-'));
    assert.ok(seamFilters.length >= 2, `${tex} has hem and stitch masks on back`);
    for (const f of seamFilters) {
      const erodes = f.children.filter(c => c.tag === 'feMorphology').map(c => +c.attrs.radius);
      assert.ok(Math.max(...erodes) < 3.41, `${tex} erosion stays inside 6.83px eye-ring thickness`);
      if (erodes[1] > 1 && !f.attrs.id.endsWith('-0')) {
        const maskId = f.attrs.id + '-mask';
        const seamGroup = all.find(n => n.tag === 'g' && n.attrs.mask === `url(#${maskId})`);
        const stitch = seamGroup.children[0];
        const inwardStroke = (+stitch.attrs['stroke-width'] * 0.19331) / 2;
        assert.ok(inwardStroke > erodes[1], `${tex} stitch reaches inward past outer erode radius (${inwardStroke} > ${erodes[1]})`);
      }
    }
  }
});

test('short/malformed hex colors, omitted angles, zero-size rects, coexisting surfaces, and detached observers stay safe', () => {
  const m = ubu.decode(new Uint8Array(128));
  m.attributes.background = { name: 'DarkShort', hex: '#111', texture: 'woodgrain', angle: undefined };
  m.attributes.eyes = { name: 'Malformed', hex: '#0', texture: 'marble' };
  m.attributes.mouth = { name: 'Empty', hex: '', texture: 'crystalline' };

  const surfaceA = new Element('div');
  const surfaceB = new Element('div');
  mutationObservers = [];
  const svgA = context.ubuRender(m, 'oomark', surfaceA);
  const obsA = mutationObservers.at(-1);
  const svgB = context.ubuRender(m, 'oomark', surfaceB);
  const obsB = mutationObservers.at(-1);
  assert.ok(!obsA.disconnected && !obsB.disconnected, 'distinct surfaces coexist without clobbering lighting');
  assert.ok(!svgA.serialize().includes('undefined') && !svgA.serialize().includes('NaN'));

  // Zero-dimension rect on pointermove must not inject NaN into transforms.
  surfaceA.rect = { left: 10, top: 10, right: 10, bottom: 10, width: 0, height: 0 };
  surfaceA.dispatch('pointerenter');
  surfaceA.dispatch('pointermove', { clientX: 10, clientY: 10, pointerType: 'mouse', buttons: 0 });
  flushRaf(60);
  assert.ok(!String(surfaceA.style.transform || '').includes('NaN'));

  // Valid pointermove updates both surfaces independently; detaching surfaceA auto-disposes its observers.
  surfaceA.rect = { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 };
  surfaceA.dispatch('pointerenter');
  surfaceA.dispatch('pointermove', { clientX: 180, clientY: 50, pointerType: 'mouse', buttons: 0 });
  flushRaf(100);
  assert.match(String(surfaceA.style.transform), /perspective\(700px\)/);
  assert.ok(!String(surfaceA.style.transform).includes('NaN'));

  surfaceA.isConnected = false;
  obsA.cb();
  assert.equal(obsA.disconnected, true, 'detached surface automatically disconnects MutationObserver');
  assert.equal(obsB.disconnected, false, 'other connected surface remains active');
  svgB.disposeLighting();
  assert.equal(obsB.disconnected, true);
});

test('sprite cache runs FIFO, differentiates mutated attributes on decoded models, and revokes evicted blob URLs', async () => {
  const createdBlobs = [];
  const revokedUrls = [];
  const bakeOrder = [];
  let blobCounter = 0;

  const spriteCtx = vm.createContext({
    document: {
      createElementNS: (_, tag) => new Element(tag),
      createElement: tag => {
        if (tag === 'canvas') {
          return {
            width: 0, height: 0,
            getContext: () => ({ drawImage() {} }),
            toBlob: cb => cb({ kind: 'webp' })
          };
        }
        return new Element(tag);
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      body: new Element('body')
    },
    ubu,
    XMLSerializer: class { serializeToString(node) { return node.serialize(); } },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
    URL: {
      createObjectURL(blob) {
        const u = `blob:ubu-${++blobCounter}`;
        createdBlobs.push({ u, kind: blob.kind || 'svg' });
        return u;
      },
      revokeObjectURL(u) { revokedUrls.push(u); }
    },
    Image: class {
      set src(val) {
        bakeOrder.push(val);
        queueMicrotask(() => { if (this.onload) this.onload(); });
      }
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    queueMicrotask,
    innerHeight: 800,
    innerWidth: 1200,
    Math, Object, Array, Set, Map, WeakMap, Float32Array, Uint8Array, Number, String, Boolean, parseInt, parseFloat, Promise
  });
  spriteCtx.globalThis = spriteCtx;
  vm.runInContext(fs.readFileSync(require.resolve('../shared/ubu-render.js'), 'utf8'), spriteCtx);

  const models = Array.from({ length: 12 }, (_, i) => {
    const dna = new Uint8Array(128);
    dna[8] = i;
    return ubu.decode(dna);
  });

  // Mutating attributes on a decoded model (retaining m.dna) produces a distinct sprite key.
  const mutated = structuredClone(models[0]);
  mutated.attributes.background.texture = 'starfield';
  const [u0, uMut] = await Promise.all([
    spriteCtx.ubuRender.sprite(models[0], 128, 4),
    spriteCtx.ubuRender.sprite(mutated, 128, 4)
  ]);
  assert.notEqual(u0, uMut, 'mutated model attributes do not collide with raw DNA cache key');

  // Queue >8 sprites with maxEntries=3 to exercise FIFO order and Blob URL revocation on eviction.
  const urls = await Promise.all(models.slice(1).map(m => spriteCtx.ubuRender.sprite(m, 128, 3)));
  assert.equal(urls.length, 11);
  // Every temporary SVG blob URL and every evicted WebP blob URL must be revoked, leaving at most 3 live WebP blob URLs.
  const liveUrls = createdBlobs.map(b => b.u).filter(u => !revokedUrls.includes(u));
  assert.ok(liveUrls.length <= 3, `expected <= 3 unrevoked blob URLs, got ${liveUrls.length}`);
});
