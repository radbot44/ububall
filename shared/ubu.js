/* 1024-bit Ubu DNA decoder. See docs/dna.md. */
'use strict';
const { ubunym } = require('./ubu/uburithm.js');

const PALETTE = [
  ['Coral', '#FF7D69'], ['Sienna', '#A56C57'], ['Copper', '#CD7847'], ['Tangerine', '#FF9954'],
  ['Ochre', '#B68720'], ['Saffron', '#E8CA48'], ['Chartreuse', '#B4D858'], ['Olive', '#758C3D'],
  ['Emerald', '#42C66B'], ['Mint', '#B9ECCD'], ['Seafoam', '#89D8B5'], ['Forest', '#21845B'],
  ['Teal', '#138F99'], ['Turquoise', '#47C8DE'], ['Sky', '#76B9EF'], ['Volt', '#0066FF'],
  ['Cobalt', '#2659AC'], ['Cornflower', '#477AE7'], ['Indigo', '#4F5FC2'], ['Periwinkle', '#9E9EED'],
  ['Iris', '#C5A3FF'], ['Amethyst', '#AA54D3'], ['Aubergine', '#673C75'], ['Orchid', '#DA4DB5'],
  ['Mulberry', '#9D467A'], ['Burgundy', '#7C3349'], ['Rose', '#FF7197'], ['Vermilion', '#EE4455'],
  ['Alabaster', '#F8F6F2'], ['Slate', '#706D77'], ['Gunmetal', '#292E38'], ['Onyx', '#101217']
];
const PARTS = ['background', 'eyes', 'irises', 'pupils', 'mouth'];
const TEXTURES = ['metallic', 'glossy', 'iridescent', 'crystalline', 'pearlescent', 'marble',
  'velvet', 'frosted', 'terrazzo', 'crackle', 'holographic', 'woodgrain', 'plush', 'lacquered', 'damascus', 'opalescent',
  'satin', 'leather', 'denim', 'carbon-fiber', 'hammered-metal', 'granite', 'sandstone', 'obsidian',
  'liquid', 'bubbled', 'mosaic', 'circuitry', 'quartz', 'kintsugi', 'lava', 'starfield'];
const EYE_RADIUS = 66.05;
const IRIS_RADIUS = 30.7126;
const EYE_TRAVEL = EYE_RADIUS - IRIS_RADIUS;

function checkDNA(dna) {
  if (!(dna instanceof Uint8Array) || dna.length !== 128) throw new TypeError('DNA must contain exactly 128 bytes.');
}
function read(dna, start, width) {
  const i = start >> 3;
  const b2 = i + 2 < 128 ? dna[i + 2] : 0;
  return (((dna[i] << 16) | (dna[i + 1] << 8) | b2) >>> (24 - (start & 7) - width)) & ((1 << width) - 1);
}
function curve(value) {
  if (!Number.isInteger(value) || value < 0 || value > 1023) {
    throw new RangeError('Curve value must be an integer from 0 to 1023.');
  }
  const t = (value - 511) / (value <= 511 ? 511 : 512);
  return t * t * t;
}
function statMultiplier(raw) {
  if (!Number.isInteger(raw) || raw < 0 || raw > 255) throw new RangeError('Stat must be an integer from 0 to 255.');
  return raw < 127 ? (2 / 3) ** ((127 - raw) / 127) : 1.5 ** ((raw - 127) / 128);
}
function size(value, min, normal, max) {
  const c = curve(value);
  return normal + c * (c <= 0 ? normal - min : max - normal);
}
function grade(value) {
  if (!Number.isInteger(value) || value < 0 || value > 1023) {
    throw new RangeError('Ubuquity rating must be an integer from 0 to 1023.');
  }
  return value < 300 ? 'C' : value < 600 ? 'B' : value < 750 ? 'A' : value < 900 ? 'S' : value < 1000 ? 'S+' : value < 1021 ? 'U' : 'UBU';
}
function pairRolls(dna, start) {
  const pairs = read(dna, start, 8);
  const top = (pairs >>> 4) === 15, bottom = (pairs & 15) === 15;
  if (top || bottom) return { active: [top, top, bottom, bottom], source: 'pairs' };
  const indiv = read(dna, start + 8, 16);
  return {
    active: [(indiv >>> 12) === 15, ((indiv >>> 8) & 15) === 15, ((indiv >>> 4) & 15) === 15, (indiv & 15) === 15],
    source: 'individual'
  };
}
function eyeGeometry(px, py, lids) {
  const planes = [];
  for (let i = 0; i < 2; i++) {
    const lid = lids[i];
    if (!lid.active) continue;
    const angle = lid.angle * Math.PI / 180, side = i ? 1 : -1;
    planes.push({ nx: -side * Math.sin(angle), ny: side * Math.cos(angle), distance: EYE_RADIUS - lid.depth });
  }
  const length = (px === 0 && py === 0) ? 0 : Math.hypot(px, py);
  let travel = EYE_TRAVEL;
  if (length) for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    const projection = (p.nx * px + p.ny * py) / length;
    if (projection > 0) travel = Math.min(travel, Math.max(0, p.distance - IRIS_RADIUS) / projection);
  }
  const scale = length ? travel * Math.min(1, length) / length : 0;
  return { dx: px === 0 ? 0 : px * scale, dy: py === 0 ? 0 : py * scale, lids, planes };
}
// Construct SVG clipping detail only when rendering, not when scoring mint inventory.
function eyePolygon(eye) {
  let polygon = [[-EYE_RADIUS, -EYE_RADIUS], [EYE_RADIUS, -EYE_RADIUS],
    [EYE_RADIUS, EYE_RADIUS], [-EYE_RADIUS, EYE_RADIUS]];
  for (const p of eye.planes) {
    const clipped = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const da = p.nx * a[0] + p.ny * a[1] - p.distance;
      const db = p.nx * b[0] + p.ny * b[1] - p.distance;
      if (da <= 0) clipped.push(a);
      if ((da <= 0) !== (db <= 0)) {
        const t = da / (da - db);
        clipped.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    polygon = clipped;
  }
  return polygon;
}
function decode(dna) {
  checkDNA(dna);
  let nameSeed = 0n;
  for (let i = 0; i < 8; i++) nameSeed = (nameSeed << 8n) | BigInt(dna[i]);
  const attributes = {};
  for (let i = 0; i < 5; i++) {
    const start = 64 + 18 * i;
    const color = read(dna, start, 5);
    const textureIndex = read(dna, start + 13, 5);
    attributes[PARTS[i]] = {
      color, name: PALETTE[color][0], hex: PALETTE[color][1], angle: read(dna, start + 5, 3) * 45,
      texture: read(dna, start + 8, 5) === 31 ? TEXTURES[textureIndex] : null
    };
  }
  const mouthRolls = pairRolls(dna, 154), lidRolls = pairRolls(dna, 258);
  const corners = mouthRolls.active;
  const rawMouth = [178, 188, 198, 208].map(bit => read(dna, bit, 10));
  const rawEyes = [218, 228].map(bit => read(dna, bit, 10));
  const px = curve(rawEyes[0]), py = curve(rawEyes[1]);
  const flipX = read(dna, 238, 10) === 1023, flipY = read(dna, 248, 10) === 1023;
  const rawLids = [282, 292, 302, 312].map(bit => read(dna, bit, 10));
  const angleFlip = read(dna, 322, 10) === 1023, depthFlip = read(dna, 332, 10) === 1023;
  const angles = [curve(rawLids[0]) * 30, curve(rawLids[2]) * 30];
  const depths = [rawLids[1], rawLids[3]].map(v => EYE_TRAVEL * v / 1023);
  // Mirror left-eye lid slopes by default; the rare angle flip cancels that mirroring.
  const makeLids = left => [0, 1].map(i => ({ active: lidRolls.active[i * 2 + (left ? 0 : 1)],
    angle: left && !angleFlip ? -angles[i] : angles[i], depth: depths[left && depthFlip ? 1 - i : i] }));
  const right = eyeGeometry(px, py, makeLids(false));
  const left = eyeGeometry(flipX ? -px : px, flipY ? -py : py, makeLids(true));
  const rating = read(dna, 1014, 10);
  const openingRaw = read(dna, 362, 10);
  const stats = {
    impulse: read(dna, 374, 8),
    traction: read(dna, 382, 8),
    spin: read(dna, 390, 8),
    curve: read(dna, 398, 8),
    size: read(dna, 406, 8),
    mass: read(dna, 414, 8),
    bounciness: read(dna, 422, 8),
    grip: read(dna, 430, 8),
    power: read(dna, 438, 8),
    reach: read(dna, 446, 8),
    strength: read(dna, 454, 8),
    stability: read(dna, 462, 8),
    efficiency: read(dna, 470, 8),
    synergy: read(dna, 478, 8),
    chemistry: read(dna, 486, 8)
  };
  const supers = [read(dna, 494, 4), read(dna, 498, 4), read(dna, 502, 4), read(dna, 506, 4)];
  const personality = {
    aggression: read(dna, 510, 6),
    creativity: read(dna, 516, 6),
    teamwork: read(dna, 522, 6),
    clutch: read(dna, 528, 6)
  };
  const voice = {
    instrument: read(dna, 534, 4),
    pitch: read(dna, 538, 6),
    decay: read(dna, 544, 4),
    timbreMod: read(dna, 548, 2),
    scale: read(dna, 550, 3),
    tempo: read(dna, 553, 3),
    notes: Array.from({ length: 8 }, (_, i) => {
      const raw = read(dna, 556 + i * 5, 5);
      return { degree: raw >> 2, duration: raw & 3 };
    }),
    groove: read(dna, 596, 2),
    phraseForm: read(dna, 598, 3),
    answerNotes: Array.from({ length: 8 }, (_, i) => {
      const raw = read(dna, 601 + i * 5, 5);
      return { degree: raw >> 2, duration: raw & 3 };
    }),
    backingTexture: read(dna, 641, 3),
    drumBass: read(dna, 644, 4),
    harmonyProg: read(dna, 648, 3),
    leadExpr: read(dna, 651, 3),
    acousticStage: read(dna, 654, 3),
    signatureGate: read(dna, 657, 5)
  };
  return {
    dna: new Uint8Array(dna), nameSeed, parts: ubunym(nameSeed), attributes,
    mouth: {
      raw: rawMouth, corners, source: mouthRolls.source,
      curved: corners.map((active, i) => active && read(dna, 342 + i * 2, 2) === 3),
      lipNotch: read(dna, 350, 6) === 63, horizontalCut: read(dna, 356, 6) === 63,
      notchCurved: read(dna, 350, 6) === 63 && read(dna, 372, 2) === 3,
      openingRaw, openingRatio: .1 + openingRaw / 1023,
      width: size(rawMouth[0], IRIS_RADIUS * 2, 151.915, 250.99),
      height: size(rawMouth[1], 26.50305, 53.0061, 79.50915),
      x: 179.995 + 12 * curve(rawMouth[2]), y: 254.0531 + 12 * curve(rawMouth[3])
    },
    eyes: { raw: rawEyes, dx: right.dx, dy: right.dy, flipX, flipY, leftX: left.dx, leftY: left.dy, left, right },
    eyelids: { raw: rawLids, active: lidRolls.active, source: lidRolls.source, angleFlip, depthFlip },
    stats, supers, personality, voice,
    rating, grade: grade(rating)
  };
}
function mouthPath(mouth) {
  const { width, height, corners: [tl, tr, bl, br], curved = [] } = mouth;
  const x = mouth.x - width / 2, y = mouth.y - height / 2;
  const x2 = x + width, y2 = y + height;
  const cut = Math.min(height / 3, width / 3);
  const turn = (i, cx, cy, ex, ey) => curved[i] ? `Q${cx} ${cy} ${ex} ${ey}` : `L${ex} ${ey}`;
  let path = `M${tl ? x + cut : x} ${y}`;
  if (mouth.lipNotch) {
    const c = mouth.x, d = Math.min(height / 4, width / 6);
    path += `L${c - d} ${y}`;
    path += mouth.notchCurved ? `Q${c} ${y + d} ${c + d} ${y}` : `L${c} ${y + d}L${c + d} ${y}`;
  }
  path += `L${tr ? x2 - cut : x2} ${y}`;
  if (tr) path += turn(1, x2, y, x2, y + cut);
  path += `L${x2} ${br ? y2 - cut : y2}`;
  if (br) path += turn(3, x2, y2, x2 - cut, y2);
  path += `L${bl ? x + cut : x} ${y2}`;
  if (bl) path += turn(2, x, y2, x, y2 - cut);
  path += `L${x} ${tl ? y + cut : y}`;
  if (tl) path += turn(0, x, y, x + cut, y);
  path += 'Z';
  if (mouth.horizontalCut) {
    // Saturate at the silhouette edges: oversized openings must not add fill outside it.
    const opening = width * Math.min(1, mouth.openingRatio);
    const a = mouth.x - opening / 2, b = mouth.x + opening / 2;
    const t = mouth.y - height / 8, btm = mouth.y + height / 8;
    path += `M${a} ${t}L${a} ${btm}L${b} ${btm}L${b} ${t}Z`;
  }
  return path;
}
const textEncoder = new TextEncoder();
async function fromText(text) {
  if (typeof text !== 'string') throw new TypeError('Text seed must be a string.');
  const [h1, h2] = await Promise.all([
    globalThis.crypto.subtle.digest('SHA-512', textEncoder.encode(text)),
    globalThis.crypto.subtle.digest('SHA-512', textEncoder.encode(text + '\x01'))
  ]);
  const dna = new Uint8Array(128);
  dna.set(new Uint8Array(h1), 0);
  dna.set(new Uint8Array(h2), 64);
  return dna;
}
function randomDNA() {
  return globalThis.crypto.getRandomValues(new Uint8Array(128));
}
function toCode(dna) {
  checkDNA(dna);
  return btoa(String.fromCharCode(...dna)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromCode(text) {
  if (typeof text !== 'string') throw new TypeError('DNA code must be a string.');
  if (/^[0-9a-fA-F]{256}$/.test(text)) return Uint8Array.from(text.match(/../g), pair => parseInt(pair, 16));
  if (!/^[A-Za-z0-9_-]{171}$/.test(text)) throw new Error('Use 171-character base64url DNA or 256 hexadecimal characters.');
  const bytes = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='), ch => ch.charCodeAt(0));
  if (toCode(bytes) !== text) throw new Error('DNA has noncanonical padding bits.');
  return bytes;
}
const api = { decode, fromText, randomDNA, toCode, fromCode, mouthPath, eyePolygon, grade, curve, statMultiplier, ubunym, PALETTE, read };
Object.freeze(api);
if (typeof globalThis !== 'undefined') globalThis.ubu = api;
if (typeof module === 'object' && module.exports) module.exports = api;
