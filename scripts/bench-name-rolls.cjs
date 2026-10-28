const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');
const { randomFillSync } = require('node:crypto');
const assert = require('node:assert/strict');
const { scoreRarity } = require('../rarity.js');

// Experimental only: compile all variants identically, without editing ubu.js.
const filename = path.resolve(__dirname, '../ubu.js');
const production = fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n');
const source = fs.readFileSync(path.join(__dirname, 'bench-name-baseline.txt'), 'utf8').replace(/\r\n/g, '\n') +
  production.slice(production.indexOf('  const PALETTE'), production.indexOf('  class NameRandom')) +
  production.slice(production.indexOf('  function checkDNA'));
function compile(text) {
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod._compile(text, filename);
  return mod.exports;
}
function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, 'Generator changed; review benchmark patch');
  return text.replace(from, to);
}
let patched = replaceOnce(source,
  'const showPraenomen = random() < 0.5;\n    const showCognomen = random() < 0.5;',
  'const flags = Math.floor(random() * 32);\n    const showPraenomen = (flags & 16) === 0;\n    const showCognomen = (flags & 8) === 0;');
patched = replaceOnce(patched, 'const frontRoll = random() < 0.125;', 'const frontRoll = (flags & 7) === 0;');
// Experimental packed candidate, not a proven global optimum. Rejection has
// no fixed worst-case draw bound; measured draw counts describe this sample.
// Recycle the unused quotient after each bounded draw instead of discarding
// a whole 53-bit result. Rejection keeps each bounded choice unbiased under
// ideal independent input words. Pool arithmetic stays below 2^46 (< 2^53).
const packedStream = `function randomForState(state) {
    let value = 0, range = 1, low = 0, haveLow = false;
    function next32() {
      if (haveLow) { haveLow = false; return low; }
      state = (state + 0x9e3779b97f4a7c15n) & MASK;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      z ^= z >> 31n;
      low = Number(z & 0xffffffffn);
      haveLow = true;
      return Number(z >> 32n);
    }
    function int(n) {
      for (;;) {
        if (range < n) {
          value = value * 4294967296 + next32();
          range *= 4294967296;
        }
        const limit = range - range % n;
        if (value < limit) {
          const result = value % n;
          value = Math.floor(value / n);
          range = limit / n;
          return result;
        }
        value -= limit;
        range -= limit;
      }
    }
    return { int };
  }
  `;
const streamStart = source.indexOf('function randomForState(state) {');
const streamEnd = source.indexOf('function patternForLength', streamStart);
assert.ok(streamStart >= 0 && streamEnd > streamStart);
let superSource = source.slice(0, streamStart) + packedStream + source.slice(streamEnd);
superSource = replaceOnce(superSource, 'const rand = n => Math.floor(random() * n);', 'const rand = n => random.int(n);');
superSource = replaceOnce(superSource, 'Math.floor(random() * 4)', 'random.int(4)');
superSource = replaceOnce(superSource, 'const before = random() < 0.5;', 'const before = random.int(2) === 0;');
superSource = replaceOnce(superSource, 'const showPraenomen = random() < 0.5;', 'const showPraenomen = random.int(2) === 0;');
superSource = replaceOnce(superSource, 'const showCognomen = random() < 0.5;', 'const showCognomen = random.int(2) === 0;');
superSource = replaceOnce(superSource, 'const frontRoll = random() < 0.125;', 'const frontRoll = random.int(8) === 0;');
// Gemini-inspired hybrid, corrected for weighted pools up to 11,171.
// Fast pre-cased syllable chunks + 24/32-bit split pool (max range < 2^46 < 2^53).
const hybridStream = `class BenchRandom {
    constructor(state) {
      state = (state + 0x9e3779b97f4a7c15n) & MASK;
      this.state = state;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      z ^= z >> 31n;
      const low = Number(z & 0xffffffffn);
      this.flags = low & 0xff;
      this.value = low >>> 8;
      this.range = 0x1000000;
      this.low = Number(z >> 32n);
      this.haveLow = true;
    }
    next32() {
      if (this.haveLow) { this.haveLow = false; return this.low; }
      let state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
      this.state = state;
      let z = state;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
      z ^= z >> 31n;
      this.low = Number(z & 0xffffffffn);
      this.haveLow = true;
      return Number(z >> 32n);
    }
    int(n) {
      for (;;) {
        if (this.range < n) {
          this.value = this.value * 4294967296 + this.next32();
          this.range *= 4294967296;
        }
        const limit = this.range - (this.range % n);
        if (this.value < limit) {
          const result = this.value % n;
          this.value = (this.value - result) / n;
          this.range = limit / n;
          return result;
        }
        this.value -= limit;
        this.range -= limit;
      }
    }
  }
  function randomForState(state) { return new BenchRandom(state); }
  `;
let hybridSource = source.slice(0, streamStart) + hybridStream + source.slice(streamEnd);

// Precompute contiguous, already-cased weighted chunks for all 16 legal patterns.
// Preserves 100% identical letter weights, allowY rules, BEFORE_X, and C_AFTER_VV_POOL.
const plannedWord = `const VY_UP = [...V].flatMap(v => Array(6).fill(v)).concat('Y');
  const VY_LO = VY_UP.map(v => v.toLowerCase());
  const V5_LO = [...V].map(v => v.toLowerCase());
  const C0_UP = C_POOL;
  const C0_LO = C_POOL.map(c => c.toLowerCase());
  const C1_LO = C_AFTER_VV_POOL.map(c => c.toLowerCase());
  const VV_LO = VOWEL_PAIRS.map(vv => vv.toLowerCase());
  const CC0_LO = PAIRS[0].map(cc => cc.toLowerCase());
  const CC1_LO = PAIRS[1].map(cc => cc.toLowerCase());

  const CAP_CV = C0_UP.flatMap(c => VY_LO.map(v => c + v));     // 3,286
  const LOW_CV = C0_LO.flatMap(c => VY_LO.map(v => c + v));     // 3,286
  const CAP_VC = VY_UP.flatMap(v => C0_LO.map(c => v + c));     // 3,286
  const LOW_VC = VY_LO.flatMap(v => C0_LO.map(c => v + c));     // 3,286
  const WORD_2 = CAP_CV.concat(CAP_VC);                         // 6,572
  const CAP_CVV = C0_UP.flatMap(c => VV_LO.map(vv => c + vv));  // 2,650
  const LOW_VVC1 = VV_LO.flatMap(vv => C1_LO.map(c => vv + c)); // 2,575
  const LOW_C1V = C1_LO.flatMap(c => VY_LO.map(v => c + v));    // 3,193
  const LOW_V5C = V5_LO.flatMap(v => C0_LO.map(c => v + c));    // 530
  const VY_PAIR_HEAD = VY_UP.flatMap(v1 => VY_LO.map(() => v1));// 961
  const VY_PAIR_TAIL = VY_UP.flatMap(() => VY_LO);              // 961
  const V5_VY_HEAD = V5_LO.flatMap(v1 => VY_LO.map(() => v1));  // 155
  const V5_VY_TAIL = V5_LO.flatMap(() => VY_LO);                // 155

  const BENCH_PLANS = new Map([
    ['WORD_2', [{ pool: WORD_2 }]],
    ['CAP_CV', [{ pool: CAP_CV }]], ['LOW_CV', [{ pool: LOW_CV }]],
    ['CAP_VC', [{ pool: CAP_VC }]], ['LOW_VC', [{ pool: LOW_VC }]],
    ['CAP_CVV', [{ pool: CAP_CVV }]], ['LOW_VVC1', [{ pool: LOW_VVC1 }]],
    ['LOW_C1V', [{ pool: LOW_C1V }]], ['LOW_V5C', [{ pool: LOW_V5C }]]
  ]);

  function word6(random) {
    switch (random.int(8)) {
      case 0: return CAP_CV[random.int(3286)] + LOW_CV[random.int(3286)] + LOW_CV[random.int(3286)];
      case 1: return CAP_CV[random.int(3286)] + C0_LO[random.int(106)] + LOW_VVC1[random.int(2575)];
      case 2: return CAP_CVV[random.int(2650)] + CC1_LO[random.int(9581)] + VY_LO[random.int(31)];
      case 3: return CAP_CVV[random.int(2650)] + LOW_C1V[random.int(3193)] + C0_LO[random.int(106)];
      case 4: {
        const vv = random.int(961);
        return VY_PAIR_HEAD[vv] + CC0_LO[random.int(11171)] + LOW_V5C[random.int(530)] + VY_PAIR_TAIL[vv];
      }
      case 5: return VY_UP[random.int(31)] + CC0_LO[random.int(11171)] + LOW_VVC1[random.int(2575)];
      case 6: {
        const vv = random.int(155);
        return CAP_VC[random.int(3286)] + V5_VY_HEAD[vv] + CC0_LO[random.int(11171)] + V5_VY_TAIL[vv];
      }
      default: return CAP_VC[random.int(3286)] + LOW_VC[random.int(3286)] + LOW_VC[random.int(3286)];
    }
  }

  function word(length, random) {
    if (length === 6) return word6(random);
    if (length === 2) return WORD_2[random.int(6572)];
    if (length === 3) {
      return random.int(2) === 0
        ? CAP_CV[random.int(3286)] + C0_LO[random.int(106)]
        : CAP_VC[random.int(3286)] + VY_LO[random.int(31)];
    }
    switch (random.int(4)) {
      case 0: return CAP_CV[random.int(3286)] + LOW_CV[random.int(3286)];
      case 1: {
        const vv = random.int(961);
        return VY_PAIR_HEAD[vv] + CC0_LO[random.int(11171)] + VY_PAIR_TAIL[vv];
      }
      case 2: return CAP_CVV[random.int(2650)] + C1_LO[random.int(103)];
      default: return CAP_VC[random.int(3286)] + LOW_VC[random.int(3286)];
    }
  }
  `;
const wordStart = hybridSource.indexOf('function word(length, random) {');
const wordEnd = hybridSource.indexOf('function ubunym(state)', wordStart);
hybridSource = hybridSource.slice(0, wordStart) + plannedWord + hybridSource.slice(wordEnd);
for (const [from, to] of [
  ['const nomen = word(6, random);', 'const nomen = word6(random);'],
  ['Math.floor(random() * 4)', 'random.flags & 3'],
  ['const before = random() < 0.5;', 'const before = (random.flags & 4) === 0;'],
  ['const showPraenomen = random() < 0.5;', 'const showPraenomen = (random.flags & 8) === 0;'],
  ['const showCognomen = random() < 0.5;', 'const showCognomen = (random.flags & 16) === 0;'],
  ['const frontRoll = random() < 0.125;', 'const frontRoll = (random.flags & 224) === 0;']
]) hybridSource = replaceOnce(hybridSource, from, to);
const variants = [['Original baseline', source], ['Combined flags', patched], ['Packed/recycled', superSource], ['Gemini hybrid/tables', hybridSource], ['Production', production]];
const apis = variants.map(([, text]) => compile(text));
const count = 20000, rounds = 11;
const inputs = Array.from({ length: count }, () => randomFillSync(new Uint8Array(128)));
const seeds = inputs.map(dna => Buffer.from(dna.buffer, dna.byteOffset, 8).readBigUInt64BE());
const diagnostics = [];
for (let v = 0; v < variants.length; v++) {
  let instrumented = variants[v][1].replace("  const V =", "  let benchMixes = 0;\n  const V =");
  instrumented = replaceOnce(instrumented, 'state = (state + 0x9e3779b97f4a7c15n) & MASK;', 'benchMixes++; state = (state + 0x9e3779b97f4a7c15n) & MASK;');
  instrumented = replaceOnce(instrumented, 'const api = { decode,', 'const api = { getMixes: () => benchMixes, decode,');
  if (v >= 3) {
    instrumented = replaceOnce(instrumented, 'let state = (this.state + 0x9e3779b97f4a7c15n) & MASK;',
      'benchMixes++; let state = (this.state + 0x9e3779b97f4a7c15n) & MASK;');
    instrumented = replaceOnce(instrumented, 'this.range *= 4294967296;',
      'this.range *= 4294967296; if (!(this.range > 0 && this.range < 0x400000000000 && this.value >= 0 && this.value < this.range)) throw new Error("Hybrid pool overflow");');
  }
  const api = compile(instrumented);
  let changed = 0, min = Infinity, max = 0;
  const categories = [0, 0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    const before = api.getMixes(), name = api.ubunym(seeds[i]);
    const draws = api.getMixes() - before;
    min = Math.min(min, draws); max = Math.max(max, draws);
    assert.deepEqual(name, apis[v].ubunym(seeds[i]));
    if (v === 4) assert.deepEqual(name, apis[3].ubunym(seeds[i]));
    if (name.fullName !== apis[0].ubunym(seeds[i]).fullName) changed++;
    const pre = name.praenomen, post = name.cognomen;
    const category = pre && post ? (name.cognomenBeforeNomen ? 4 : 3) :
      !pre && !post ? 0 : pre.length + post.length === 6 ? 2 : 1;
    categories[category]++;
  }
  diagnostics.push({variant: variants[v][0], 'mixes min': min, 'mixes max': max,
    'mixes mean': (api.getMixes() / count).toFixed(3),
    'changed names %': (100 * changed / count).toFixed(2),
    'category % (N,short,long,PNC,PCN)': categories.map(n => (100*n/count).toFixed(2)).join(', ')});
}
// The full decoder must differ only in its name; verify outside timed loops.
for (const api of apis.slice(1)) for (let i = 0; i < 128; i++) {
  const a = apis[0].decode(inputs[i]), b = api.decode(inputs[i]);
  delete a.parts; delete b.parts;
  assert.deepEqual(b, a);
}
const planStats = compile(hybridSource.replace('const api = { decode,',
  'const api = { planStats: () => { let entries=0, chars=0; for (const ops of BENCH_PLANS.values()) for (const op of ops) { entries += op.pool.length; for (const word of op.pool) chars += word.length; } return {patterns: BENCH_PLANS.size, entries, chars}; }, decode,')).planStats();
console.log('Hybrid table footprint (logical entries, including reused pools; not measured heap bytes):', planStats);
console.log('Additional generated source bytes:', Buffer.byteLength(hybridSource) - Buffer.byteLength(source));
console.table(diagnostics);
console.log('Unbiased independent bounded draws assume independent uniform source words; a 64-bit seeded PRNG cannot provide unlimited exact independence.');
let sink = 0;
const workloads = [
  ['Name only', (api, i) => api.ubunym(seeds[i]).fullName.length],
  ['Full DNA decode', (api, i) => api.decode(inputs[i]).parts.fullName.length],
  ['Decode + rarity', (api, i) => scoreRarity(api.decode(inputs[i])).bits]
];
function run(api, work, n = count) {
  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < n; i++) checksum += work(api, i);
  const elapsed = performance.now() - start;
  sink += checksum;
  return elapsed;
}
function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
console.log(`Node ${process.version}, ${process.platform}/${process.arch}`);
console.log(`${count.toLocaleString()} pre-generated random 128-byte inputs; ${rounds} rounds, rotating variant order.`);
console.log('Input randomness, module loading and validation excluded from timings; warmup included before measurement.');

const rows = [];
for (const [label, work] of workloads) {
  for (let i = 0; i < 3; i++) for (const api of apis) run(api, work);
  const timings = apis.map(() => []);
  for (let i = 0; i < rounds; i++) {
    for (let offset = 0; offset < apis.length; offset++) {
      const v = (i + offset) % apis.length;
      timings[v].push(run(apis[v], work));
    }
  }
  const baseline = median(timings[0]);
  for (let v = 0; v < apis.length; v++) {
    const elapsed = median(timings[v]);
    const savings = timings[v].map((t, i) => 100 * (timings[0][i] - t) / timings[0][i]);
    rows.push({ workload: label, variant: variants[v][0],
      'us/ubu': (elapsed * 1000 / count).toFixed(3),
      'paired median saved %': median(savings).toFixed(2),
      'paired range %': `${Math.min(...savings).toFixed(2)} to ${Math.max(...savings).toFixed(2)}`,
      'saved ms/1000': ((baseline - elapsed) / (count / 1000)).toFixed(3)
    });
  }
}
console.table(rows);
assert.ok(Number.isFinite(sink));
console.log('CPU microbenchmark only; excludes signing, database, rendering, network and cold startup. No runtime generator changes.');

