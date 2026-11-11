'use strict';
// Run on both revisions with: node scripts/bench-materials.cjs
// Measures cold/warm JS SVG DOM construction latency, serialization latency, DOM node/filter counts,
// and SVG byte size across all 32 rare finishes, default matte, and a 120-ubu collection batch.
// Note: runs in a headless Node VM without browser Canvas/Image rasterization, exercising the
// unbaked vector fallback paths for repeating tiles.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const ubu = require('../shared/ubu.js');

class Element {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.style = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...kids) { this.children.push(...kids); }
  insertBefore(node, ref) {
    const idx = this.children.indexOf(ref);
    if (idx >= 0) this.children.splice(idx, 0, node);
    else this.children.push(node);
  }
  replaceChildren(...kids) { this.children = [...kids]; }
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

function createRenderContext() {
  const context = vm.createContext({
    document: {
      createElementNS: (_, tag) => new Element(tag),
      createElement: tag => new Element(tag),
      addEventListener: () => {},
      removeEventListener: () => {},
      body: new Element('body')
    },
    ubu,
    XMLSerializer: class { serializeToString(node) { return node.serialize(); } },
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
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../shared/ubu-render.js'), 'utf8'), context);
  return context.ubuRender;
}

function countStats(node, out = { nodes: 0, filters: 0, masks: 0 }) {
  out.nodes++;
  if (node.tag === 'filter') out.filters++;
  else if (node.tag === 'mask') out.masks++;
  for (const c of node.children) if (typeof c === 'object') countStats(c, out);
  return out;
}

const MATERIALS = [
  'matte', 'metallic', 'glossy', 'iridescent', 'crystalline', 'pearlescent', 'damascus', 'marble', 'lacquered',
  'velvet', 'frosted', 'woodgrain', 'holographic', 'terrazzo', 'crackle', 'plush', 'opalescent', 'granite',
  'satin', 'sandstone', 'starfield', 'quartz', 'obsidian', 'mosaic', 'hammered-metal', 'kintsugi', 'leather',
  'carbon-fiber', 'denim', 'bubbled', 'lava', 'circuitry', 'liquid'
];

console.log('Node VM benchmark (exercises unbaked SVG vector fallback paths without browser Canvas/Image rasterization):');
const render = createRenderContext();
const baseDna = new Uint8Array(128);
for (let i = 0; i < 128; i++) baseDna[i] = (i * 73 + 19) & 0xff;
const baseModel = ubu.decode(baseDna);

const rows = [];
for (const tex of MATERIALS) {
  const m = structuredClone(baseModel);
  for (const role of ['background', 'eyes', 'irises', 'pupils', 'mouth']) {
    m.attributes[role] = { name: 'Vermilion', hex: '#ee4455', texture: null, angle: 45 };
  }
  m.attributes.background.texture = tex === 'matte' ? null : tex;

  const t0 = performance.now();
  const first = render(m, 'ubu-tile-svg');
  const coldMs = performance.now() - t0;

  const renderSamples = [];
  const serializeSamples = [];
  let serialized = '';
  for (let r = 0; r < 5; r++) {
    let lastTree = first;
    const startRender = performance.now();
    for (let i = 0; i < 20; i++) lastTree = render(m, 'ubu-tile-svg');
    renderSamples.push((performance.now() - startRender) / 20);

    const startSerialize = performance.now();
    for (let i = 0; i < 20; i++) serialized = lastTree.serialize();
    serializeSamples.push((performance.now() - startSerialize) / 20);
  }
  renderSamples.sort((a, b) => a - b);
  serializeSamples.sort((a, b) => a - b);
  const st = countStats(first);
  rows.push({
    material: tex,
    coldMs: +coldMs.toFixed(2),
    warmMedianMs: +renderSamples[2].toFixed(3),
    serializeMs: +serializeSamples[2].toFixed(3),
    nodes: st.nodes,
    filters: st.filters,
    masks: st.masks,
    svgKB: +(serialized.length / 1024).toFixed(1),
    dataUrlKB: +(encodeURIComponent(serialized).length / 1024).toFixed(1)
  });
}

rows.sort((a, b) => b.svgKB - a.svgKB);
console.table(rows);

let rng = 42;
const nextByte = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng >>> 24; };
const batchModels = Array.from({ length: 120 }, (_, i) => {
  const dna = new Uint8Array(128);
  for (let j = 0; j < 128; j++) dna[j] = nextByte();
  const mod = ubu.decode(dna);
  mod.attributes.background.texture = MATERIALS[1 + (i % 32)];
  if (i % 2 === 0) mod.attributes.eyes.texture = MATERIALS[1 + ((i * 7) % 32)];
  return mod;
});

function runBatch() {
  let bytes = 0, nodes = 0, filters = 0;
  const start = performance.now();
  for (const mod of batchModels) {
    const svg = render(mod, 'ubu-tile-svg');
    bytes += svg.serialize().length;
    const st = countStats(svg);
    nodes += st.nodes;
    filters += st.filters;
  }
  return { ms: performance.now() - start, bytes, nodes, filters };
}

runBatch();
const runs = Array.from({ length: 5 }, runBatch).sort((a, b) => a.ms - b.ms);
const med = runs[2];
console.log(
  `120-ubu batch (1.5 materials/ubu): median ${med.ms.toFixed(1)} ms, ` +
  `${(med.bytes / 1024 / 1024).toFixed(2)} MB SVG, ${med.nodes} nodes, ${med.filters} filters`
);
