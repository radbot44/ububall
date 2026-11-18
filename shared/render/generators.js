/* Deterministic procedural geometry & Voronoi finish generators for all 32 rare materials. */
'use strict';
const ubuMod = typeof globalThis.ubu === 'object' && globalThis.ubu ? globalThis.ubu : require('../ubu.js');

const NS = 'http://www.w3.org/2000/svg';
const roles = ['background', 'eyes', 'irises', 'pupils', 'mouth'];
const DESIGNED = new Set(['metallic', 'glossy', 'iridescent', 'crystalline', 'pearlescent', 'damascus', 'marble', 'lacquered',
  'velvet', 'frosted', 'woodgrain', 'holographic', 'terrazzo', 'crackle', 'plush', 'opalescent', 'granite', 'satin', 'sandstone', 'starfield', 'quartz', 'obsidian', 'mosaic', 'hammered-metal', 'kintsugi', 'leather', 'carbon-fiber', 'denim', 'bubbled', 'lava', 'circuitry', 'liquid']);
let liquidTones = null;
let liquidShades = null;
const fmt = n => {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s.replace(/^(-?)0\./, '$1.');
};
const fmt2 = n => {
  const s = n.toFixed(2).replace(/\.?0+$/, '');
  return s.replace(/^(-?)0\./, '$1.') || '0';
};
const getAttr = (el, k) => typeof el.getAttribute === 'function' ? el.getAttribute(k) : (el.attrs ? el.attrs[k] : undefined);
const tagOf = el => (el.tagName || el.tag || '').toLowerCase();

function makeRng(seed = 173) {
  let state = seed;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function parseHexRgb(hex) {
  if (typeof hex === 'string') {
    const m6 = /^#([0-9a-fA-F]{6})$/.exec(hex);
    if (m6) {
      const n = parseInt(m6[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m3 = /^#([0-9a-fA-F]{3})$/.exec(hex);
    if (m3) {
      const [cr, cg, cb] = m3[1];
      return [parseInt(cr + cr, 16), parseInt(cg + cg, 16), parseInt(cb + cb, 16)];
    }
  }
  return [128, 128, 128];
}
function deepFreeze(obj) {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}
const EDGE_FINISHES = deepFreeze({
  terrazzo: { width: 2.2, rim: .6, stops: [[0, '#fff', .55], [.45, '#fff', .16], [.55, '#000', .18], [1, '#000', .42]] },
  crackle: { width: 2.2, rim: .6, stops: [[0, '#fff', .6], [.45, '#fff', .18], [.55, '#000', .18], [1, '#000', .38]] },
  opalescent: { width: 2.6, rim: .7, stops: [[0, '#fff0da', .65], [.35, '#d3f9ee', .45], [.7, '#e7dfff', .35], [1, '#000', .3]] },
  frosted: { width: 2.8, rim: .7, stops: [[0, '#fff', .7], [.48, '#e8f6ff', .32], [.62, '#6285a0', .24], [1, '#39556b', .42]] },
  woodgrain: { width: 2.2, rim: .6, stops: [[0, '#f5e4cd', .5], [.42, '#fff', .18], [.58, '#000', .22], [1, '#000', .48]] },
  holographic: { width: 2.2, rim: .65, stops: [[0, '#b8ffff', .8], [.3, '#ffc9f6', .65], [.6, '#fff2af', .65], [1, '#94bcff', .6]] },
  pearlescent: { width: 2.5, rim: .7, stops: [[0, '#fff4e4', .68], [.42, '#e3efff', .28], [.58, '#000', .16], [1, '#000', .36]] },
  marble: { width: 2.4, rim: .65, stops: [[0, '#fff', .6], [.45, '#fff', .16], [.55, '#000', .2], [1, '#000', .45]] },
  lacquered: { width: 3.2, rim: 1, stops: [[0, '#fff', .85], [.32, '#fff', .3], [.5, '#000', .2], [1, '#000', .52]] },
  metallic: { width: 2.4, rim: .65, stops: [[0, '#fff', .85], [.43, '#fff', .12], [.49, '#000', .55], [.56, '#fff', .65], [1, '#000', .6]] },
  glossy: { width: 3.4, rim: 1.1, stops: [[0, '#fff', .7], [.38, '#fff', .26], [.56, '#000', .14], [1, '#000', .36]] },
  iridescent: { width: 2.5, rim: .7, stops: [[0, '#82fff0', .8], [.28, '#aaa1ff', .65], [.5, '#ff8cdb', .55], [.72, '#ffe6a0', .6], [1, '#53bfff', .7]] },
  crystalline: { width: 2.2, rim: .55, stops: [[0, '#fff', .9], [.24, '#fff', .55], [.25, '#000', .32], [.49, '#000', .18], [.5, '#fff', .8], [.74, '#fff', .2], [.75, '#000', .42], [1, '#000', .55]] },
  granite: { width: 4, rim: .75, stops: [[0, '#fff', .85], [.42, '#fff', .5], [.49, '#fff', .22], [.5, '#000', .35], [1, '#000', .8]] },
  satin: { width: 2.2, rim: .55, stops: [[0, '#fff', .45], [.4, '#fff', .16], [.58, '#000', .16], [1, '#000', .34]] },
  sandstone: { width: 3.2, rim: .7, stops: [[0, '#fff6e5', .42], [.45, '#fff', .14], [.58, '#000', .24], [1, '#000', .52]] },
  starfield: { width: 2.6, rim: .7, stops: [[0, '#d1e8ff', .6], [.35, '#e0b8ff', .35], [.7, '#0f0524', .5], [1, '#000', .7]] },
  quartz: { width: 2.2, rim: .55, stops: [[0, '#fff', .92], [.22, '#fff', .6], [.24, '#000', .28], [.48, '#fff', .82], [.72, '#fff', .25], [.74, '#000', .38], [1, '#000', .55]] },
  obsidian: { width: 3.2, rim: 1, stops: [[0, '#fff', .9], [.25, '#fff', .22], [.58, '#000', .35], [1, '#000', .7]] },
  mosaic: { width: 2.2, rim: .55, stops: [[0, '#fff', .6], [.45, '#fff', .16], [.55, '#000', .18], [1, '#000', .38]] },
  'hammered-metal': { width: 2.6, rim: .7, stops: [[0, '#fff', .88], [.38, '#fff', .18], [.45, '#000', .5], [.52, '#fff', .7], [1, '#000', .6]] },
  kintsugi: { width: 2.4, rim: .65, stops: [[0, '#fff1b6', .6], [.4, '#f0d681', .2], [.6, '#000', .22], [1, '#000', .5]] },
  damascus: { width: 2.2, rim: .55, stops: [[0, '#fff', .65], [.42, '#fff', .2], [.58, '#000', .22], [1, '#000', .4]] },
  'carbon-fiber': { width: 2.6, rim: .7, stops: [[0, '#fff', .85], [.3, '#000', .5], [.6, '#fff', .65], [1, '#000', .7]] },
  bubbled: { width: 2.8, rim: .8, stops: [[0, '#fff', .85], [.3, '#d4f8ff', .4], [.6, '#ffd6f5', .25], [1, '#000', .35]] },
  lava: { width: 2.5, rim: .6, stops: [[0, '#ff9900', .9], [.35, '#ff3300', .6], [.65, '#3a0800', .7], [1, '#110000', .85]] },
  circuitry: { width: 2, rim: .6, stops: [[0, '#e8dfb8', .55], [.4, '#a4a69b', .25], [.6, '#000', .32], [1, '#000', .65]] },
  liquid: { width: 3.2, rim: 1, stops: [[0, '#fff', .9], [.25, '#fff', .35], [.55, '#000', .16], [1, '#000', .45]] }
});

// Minimum distance from (180, 180) to an AABB. Shapes strictly outside r=limit cannot enter
// the ubu's r=176 outer circle clip under any rotation around (180, 180).
function hitsUbuDisc(minX, minY, maxX, maxY, limit = 194) {
  const dx = Math.max(0, 180 - maxX, minX - 180);
  const dy = Math.max(0, 180 - maxY, minY - 180);
  return dx * dx + dy * dy <= limit * limit;
}
function ptsHitUbu(pts, limit = 194) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const x = +pts[i][0], y = +pts[i][1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return hitsUbuDisc(minX, minY, maxX, maxY, limit);
}

function clipVoronoiCell(seed, seeds) {
  let cell = [[-180, -180], [540, -180], [540, 540], [-180, 540]];
  let minX = -180, minY = -180, maxX = 540, maxY = 540;
  const s2 = seed[0] * seed[0] + seed[1] * seed[1];
  for (let k = 0; k < seeds.length; k++) {
    const other = seeds[k];
    if (other === seed || !cell.length) continue;
    const nx = other[0] - seed[0], ny = other[1] - seed[1];
    const limit = (other[0] * other[0] + other[1] * other[1] - s2) * .5;
    if ((nx > 0 ? maxX : minX) * nx + (ny > 0 ? maxY : minY) * ny <= limit) continue;
    const clipped = [];
    let nMinX = Infinity, nMinY = Infinity, nMaxX = -Infinity, nMaxY = -Infinity;
    for (let i = 0; i < cell.length; i++) {
      const a = cell[i], b = cell[(i + 1) % cell.length];
      const da = a[0] * nx + a[1] * ny - limit, db = b[0] * nx + b[1] * ny - limit;
      if (da <= 0) {
        clipped.push(a);
        if (a[0] < nMinX) nMinX = a[0]; if (a[0] > nMaxX) nMaxX = a[0];
        if (a[1] < nMinY) nMinY = a[1]; if (a[1] > nMaxY) nMaxY = a[1];
      }
      if ((da <= 0) !== (db <= 0)) {
        const t = da / (da - db);
        const ix = a[0] + (b[0] - a[0]) * t, iy = a[1] + (b[1] - a[1]) * t;
        clipped.push([ix, iy]);
        if (ix < nMinX) nMinX = ix; if (ix > nMaxX) nMaxX = ix;
        if (iy < nMinY) nMinY = iy; if (iy > nMaxY) nMaxY = iy;
      }
    }
    cell = clipped;
    minX = nMinX; minY = nMinY; maxX = nMaxX; maxY = nMaxY;
  }
  return cell;
}

function getLiquidTones() {
  if (liquidTones) return liquidTones;
  const tau = Math.PI * 2;
  const sinY = new Float32Array(180), cosY = new Float32Array(180);
  const sinX1 = new Float32Array(180), sinX2 = new Float32Array(180);
  for (let y = 0; y < 360; y += 2) {
    sinY[y >> 1] = 18 * Math.sin(tau * y / 180);
    cosY[y >> 1] = 7 * Math.cos(tau * y / 90);
  }
  for (let x = 0; x < 360; x += 2) {
    sinX1[x >> 1] = 9 * Math.sin(tau * x / 120);
    sinX2[x >> 1] = 24 * Math.sin(tau * x / 360);
  }
  const tones = new Uint8Array(180 * 180);
  const waves = [[2, 1, 1.4, .3], [1, 3, .9, 1.3], [4, -2, .6, 2.1], [9, 3, .25, .6], [13, -7, .12, 1.8]];
  for (let gy = 0; gy < 180; gy++) {
    const y = gy * 2, sy = sinY[gy], cy = cosY[gy], rowOff = gy * 180;
    for (let gx = 0; gx < 180; gx++) {
      const x = gx * 2;
      const wx = x + sy + sinX1[gx];
      const wy = y + cy + sinX2[gx];
      let dx = 0, dy = 0, height = 0;
      for (let w = 0; w < 5; w++) {
        const kx = waves[w][0], ky = waves[w][1], amp = waves[w][2], phase = waves[w][3];
        const wave = tau * (kx * wx + ky * wy) / 360 + phase;
        height += amp * Math.sin(wave);
        const c = amp * Math.cos(wave) * tau / 360;
        dx += kx * c; dy += ky * c;
      }
      const length = Math.hypot(dx, dy, 1);
      const spec = Math.pow(Math.max(0, (-dx * .12 + dy * .45 + .885) / length), 64);
      tones[rowOff + gx] = Math.max(0, Math.min(31, Math.round(8 + spec * 12 + Math.exp(-height * height * 2) * 18 - (dx + dy) * 6)));
    }
  }
  return (liquidTones = tones);
}

function getLiquidShades() {
  if (liquidShades) return liquidShades;
  const tones = getLiquidTones();
  const shades = Array.from({ length: 32 }, () => '');
  for (let gy = 0; gy < 180; gy++) {
    const y = gy * 2, rowOff = gy * 180;
    let gx = 0;
    while (gx < 180) {
      const tone = tones[rowOff + gx];
      let end = gx + 1;
      while (end < 180 && tones[rowOff + end] === tone) end++;
      if (tone !== 9) {
        const w = (end - gx) * 2;
        shades[tone] += `M${gx * 2} ${y}h${w}v2h-${w}Z`;
      }
      gx = end;
    }
  }
  return (liquidShades = shades);
}

// Synthesize the 360x360 blurred liquid tile directly into canvas ImageData on first use,
// avoiding a 500 KB SVG path serialize/parse round-trip and boot-time main-thread work.

let cachedMatteData = null;
function getMatteData() {
  if (cachedMatteData) return cachedMatteData;
  const roll = makeRng();
  const white = ['', '', ''], black = ['', '', ''];
  for (let i = 0; i < 160; i++) {
    const cx = 1 + roll() * 46, cy = 1 + roll() * 46;
    const r = .18 + roll() * .22, op = .018 + roll() * .032;
    const bucket = op < .029 ? 0 : op < .039 ? 1 : 2;
    const d = `M${fmt(cx - r)} ${fmt(cy)}a${fmt2(r)} ${fmt2(r)} 0 1 0 ${fmt2(2 * r)} 0a${fmt2(r)} ${fmt2(r)} 0 1 0 ${fmt2(-2 * r)} 0`;
    if (i % 2) white[bucket] += d; else black[bucket] += d;
  }
  return (cachedMatteData = { white, black, opacities: [.024, .034, .045] });
}

let cachedMetallicData = null;
function getMetallicData() {
  if (cachedMetallicData) return cachedMetallicData;
  const roll = makeRng();
  const groups = [];
  const tiers = [[.26, .04], [.36, .058], [.46, .076]];
  for (let c = 0; c < 2; c++) for (let t = 0; t < 3; t++) groups.push({ d: '', color: c ? '#fff' : '#000', width: tiers[t][0], opacity: tiers[t][1] });
  for (let i = 0; i < 64; i++) {
    const y = roll() * 72, w = .18 + roll() * .35, op = .025 + roll() * .065;
    const t = (w - .18) / .35 + (op - .025) / .065;
    const tier = t < .66 ? 0 : t < 1.33 ? 1 : 2;
    groups[(i % 3 ? 3 : 0) + tier].d += `M0 ${fmt2(y)}h72`;
  }
  return (cachedMetallicData = groups.filter(g => g.d));
}

let cachedSatinData = null;
function getSatinData() {
  if (cachedSatinData) return cachedSatinData;
  const roll = makeRng();
  const white = ['', ''], black = ['', ''];
  for (let i = 0; i < 32; i++) {
    const y = i * 1.5, hi = roll() > .5 ? 1 : 0;
    const d = `M0 ${fmt2(y)}q12-.65 24 0t24 0`;
    if (i % 2) white[hi] += d; else black[hi] += d;
  }
  return (cachedSatinData = { white, black, opacities: [.018, .031] });
}

let cachedCarbonData = null;
function getCarbonData() {
  if (cachedCarbonData) return cachedCarbonData;
  let boxHoriz = '', boxVert = '', hWhite = '', hBlack = '', vWhite = '', vBlack = '';
  for (const [bx, by, horiz] of [[0, 0, true], [18, 18, true], [18, 0, false], [0, 18, false]]) {
    const box = `M${bx} ${by}h18v18h-18Z`;
    if (horiz) boxHoriz += box; else boxVert += box;
    for (let s = 0; s < 6; s++) {
      const pos = s * 3 + 1.5;
      if (horiz) {
        const seg = `M${bx} ${by + pos}h18`;
        if (s % 2) hWhite += seg; else hBlack += seg;
      } else {
        const seg = `M${bx + pos} ${by}v18`;
        if (s % 2) vWhite += seg; else vBlack += seg;
      }
    }
  }
  return (cachedCarbonData = { boxHoriz, boxVert, hWhite, hBlack, vWhite, vBlack });
}

let cachedMarbleData = null;
function getMarbleData(isUbu = false) {
  if (!cachedMarbleData) {
    const roll = makeRng();
    const make = () => ({ halos: ['', ''], cores: ['', ''], fine: '', branches: ['', ''] });
    const ubuSet = make(), cardSet = make();
    for (let vein = 0; vein < 17; vein++) {
      let x = -230 + vein * 80, dCard = `M${x} -180`, dUbu = '';
      let minX = x, maxX = x;
      const points = [];
      for (let y = -120; y <= 540; y += 60) {
        const prevX = x, prevY = y - 60;
        const next = x + (roll() - .48) * 140;
        const seg = `C${fmt(prevX + 28)} ${prevY + 20} ${fmt(next - 24)} ${y - 20} ${fmt(next)} ${y}`;
        dCard += seg;
        const sMinX = Math.min(prevX, prevX + 28, next - 24, next), sMaxX = Math.max(prevX, prevX + 28, next - 24, next);
        if (hitsUbuDisc(sMinX, prevY, sMaxX, y, 204)) {
          dUbu += (dUbu ? '' : `M${fmt(prevX)} ${prevY}`) + seg;
        }
        if (next < minX) minX = next;
        if (next > maxX) maxX = next;
        points.push([next, y]); x = next;
      }
      const haloW = 6 + roll() * 9, coreW = 1 + roll() * 2.2;
      const hBucket = haloW < 10.5 ? 0 : 1, cBucket = coreW < 2.1 ? 0 : 1;
      cardSet.halos[hBucket] += dCard;
      cardSet.cores[cBucket] += dCard;
      cardSet.fine += dCard;
      if (dUbu) {
        ubuSet.halos[hBucket] += dUbu;
        ubuSet.cores[cBucket] += dUbu;
        ubuSet.fine += dUbu;
      }
      for (let i = 1; i < points.length; i += 3) {
        const [px, py] = points[i], direction = roll() < .5 ? -1 : 1;
        const bw = .35 + roll() * .65;
        const bBucket = bw < .68 ? 0 : 1;
        const bd = `M${fmt(px)} ${py}q${direction * 35} -18 ${direction * 52} -52t${direction * 48} -65`;
        cardSet.branches[bBucket] += bd;
        const endX = px + direction * 100;
        if (hitsUbuDisc(Math.min(px, endX), py - 117, Math.max(px, endX), py, 198)) {
          ubuSet.branches[bBucket] += bd;
        }
      }
    }
    cachedMarbleData = { ubu: ubuSet, card: cardSet };
  }
  return isUbu ? cachedMarbleData.ubu : cachedMarbleData.card;
}

let cachedCrystallineData = null;
function getCrystallineData() {
  if (cachedCrystallineData) return cachedCrystallineData;
  const roll = makeRng();
  const points = [];
  for (let y = 0; y <= 12; y++) {
    points[y] = [];
    for (let x = 0; x <= 12; x++) points[y][x] = [-180 + x * 60 + (roll() - .5) * 32, -180 + y * 60 + (roll() - .5) * 32];
  }
  const facets = [];
  let ridgesCard = '', ridgesUbu = '';
  const BUCKETS = 6;
  const whiteCard = Array(BUCKETS).fill(''), blackCard = Array(BUCKETS).fill('');
  const whiteUbu = Array(BUCKETS).fill(''), blackUbu = Array(BUCKETS).fill('');
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const a = points[y][x], b = points[y][x + 1], c = points[y + 1][x], d = points[y + 1][x + 1];
    const split = roll() < .5;
    const tris = split ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
    for (const tri of tris) {
      const light = roll(), isWhite = light > .46;
      const opacity = .08 + Math.abs(light - .46) * .86;
      const ptsStr = `${fmt(tri[0][0])},${fmt(tri[0][1])} ${fmt(tri[1][0])},${fmt(tri[1][1])} ${fmt(tri[2][0])},${fmt(tri[2][1])}`;
      const pathStr = `M${fmt(tri[0][0])} ${fmt(tri[0][1])}L${fmt(tri[1][0])} ${fmt(tri[1][1])}L${fmt(tri[2][0])} ${fmt(tri[2][1])}Z`;
      const inUbu = ptsHitUbu(tri, 194);
      facets.push({ ptsStr, fill: isWhite ? '#fff' : '#000', opacity: +opacity.toFixed(3), light, inUbu });
      const bIdx = Math.min(BUCKETS - 1, Math.floor((opacity - .08) / (.47 / BUCKETS)));
      if (isWhite) { whiteCard[bIdx] += pathStr; if (inUbu) whiteUbu[bIdx] += pathStr; }
      else { blackCard[bIdx] += pathStr; if (inUbu) blackUbu[bIdx] += pathStr; }
    }
    if (roll() > .76) {
      const p0 = split ? b : a, p1 = split ? c : d;
      const rd = `M${fmt(p0[0])} ${fmt(p0[1])}L${fmt(p1[0])} ${fmt(p1[1])}`;
      ridgesCard += rd;
      if (ptsHitUbu([p0, p1], 194)) ridgesUbu += rd;
    }
  }
  const bucketOpacities = Array.from({ length: BUCKETS }, (_, i) => +(.08 + (i + .5) * (.47 / BUCKETS)).toFixed(3));
  return (cachedCrystallineData = { points, facets, ridgesCard, ridgesUbu, whiteCard, blackCard, whiteUbu, blackUbu, bucketOpacities });
}

let cachedMosaicData = null;
function getMosaicData(isUbu = false) {
  if (!cachedMosaicData) {
    const roll = makeRng();
    const make = () => ({ tiles: '', topBevels: '', bottomBevels: '', whiteShades: ['', '', '', ''], blackShades: ['', '', '', ''] });
    const ubuSet = make(), cardSet = make();
    for (let row = -10; row < 28; row++) for (let col = -10; col < 28; col++) {
      const x = col * 20 + (row % 2) * 8, y = row * 20;
      const x0 = x + 1 + roll(), y0 = y + 1 + roll();
      const x1 = x + 18 - roll(), y1 = y + 1 + roll();
      const x2 = x + 18 - roll(), y2 = y + 18 - roll();
      const x3 = x + 1 + roll(), y3 = y + 18 - roll();
      const p0 = fmt(x0) + ' ' + fmt(y0), p1 = fmt(x1) + ' ' + fmt(y1);
      const p2 = fmt(x2) + ' ' + fmt(y2), p3 = fmt(x3) + ' ' + fmt(y3);
      const poly = 'M' + p0 + 'L' + p1 + 'L' + p2 + 'L' + p3 + 'Z';
      const topB = 'M' + p3 + 'L' + p0 + 'L' + p1;
      const botB = 'M' + p1 + 'L' + p2 + 'L' + p3;
      const isWhite = roll() > .5;
      const bucket = Math.min(3, Math.floor(roll() * 4));
      cardSet.tiles += poly; cardSet.topBevels += topB; cardSet.bottomBevels += botB;
      if (isWhite) cardSet.whiteShades[bucket] += poly; else cardSet.blackShades[bucket] += poly;
      if (hitsUbuDisc(x, y, x + 19, y + 19, 194)) {
        ubuSet.tiles += poly; ubuSet.topBevels += topB; ubuSet.bottomBevels += botB;
        if (isWhite) ubuSet.whiteShades[bucket] += poly; else ubuSet.blackShades[bucket] += poly;
      }
    }
    cachedMosaicData = { ubu: ubuSet, card: cardSet };
  }
  return isUbu ? cachedMosaicData.ubu : cachedMosaicData.card;
}

let cachedCrackleData = null;
function getCrackleData(isUbu = false) {
  if (!cachedCrackleData) {
    const roll = makeRng();
    const seeds = [];
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
      seeds.push([-180 + (x + .2 + roll() * .6) * 80, -180 + (y + .2 + roll() * .6) * 80]);
    }
    const make = () => ({ dCells: '', shades: ['', '', '', ''], chips0: '', chips1: '' });
    const ubuSet = make(), cardSet = make();
    for (const seed of seeds) {
      const cell = clipVoronoiCell(seed, seeds);
      const rough = [], roughNum = [];
      for (let i = 0; i < cell.length; i++) {
        const a = cell[i], b = cell[(i + 1) % cell.length];
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
        for (let j = 0; j < steps; j++) {
          const x = a[0] + (b[0] - a[0]) * j / steps, y = a[1] + (b[1] - a[1]) * j / steps;
          const rx = +(x + 3.5 * Math.sin(y / 7 + x / 19) + .9 * Math.sin(y * 1.7 + x)).toFixed(1);
          const ry = +(y + 3.5 * Math.sin(x / 8 - y / 23) + .9 * Math.sin(x * 1.5 - y)).toFixed(1);
          roughNum.push([rx, ry]);
          rough.push(fmt(rx) + ',' + fmt(ry));
        }
      }
      const inUbu = ptsHitUbu(roughNum, 196);
      const d = 'M' + rough.join('L') + 'Z';
      const bucket = Math.min(3, Math.floor(roll() * 4));
      cardSet.dCells += d; cardSet.shades[bucket] += d;
      if (inUbu) { ubuSet.dCells += d; ubuSet.shades[bucket] += d; }
      for (let i = 2; i < roughNum.length; i += 5) {
        const [x, y] = roughNum[i];
        const r = .5 + roll() * 1.8;
        const chip = 'M' + fmt(x - 2) + ' ' + fmt(y) + 'l' + fmt(r) + ' ' + fmt(-r) + 'l' + fmt(r * .7) + ' ' + fmt(r * 1.4) + 'Z';
        if (i % 3) { cardSet.chips0 += chip; if (inUbu) ubuSet.chips0 += chip; }
        else { cardSet.chips1 += chip; if (inUbu) ubuSet.chips1 += chip; }
        roll();
      }
    }
    cachedCrackleData = { ubu: ubuSet, card: cardSet };
  }
  return isUbu ? cachedCrackleData.ubu : cachedCrackleData.card;
}

let cachedLavaData = null;
function getLavaData(isUbu = false) {
  if (!cachedLavaData) {
    const roll = makeRng();
    const seeds = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      seeds.push([-180 + (x + 0.2 + roll() * 0.6) * 90, -180 + (y + 0.2 + roll() * 0.6) * 90]);
    }
    const make = () => ({ platesDark: '', platesLight: '', platesAll: '', meltPockets: [] });
    const ubuSet = make(), cardSet = make();
    for (let s = 0; s < seeds.length; s++) {
      const seed = seeds[s];
      const cell = clipVoronoiCell(seed, seeds);
      if (!cell.length) continue;
      const edge = [], edgeNum = [];
      for (let k = 0; k < cell.length; k++) {
        const a = cell[k], b = cell[(k + 1) % cell.length], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4);
        for (let j = 0; j < n; j++) {
          const x = a[0] + (b[0] - a[0]) * j / n, y = a[1] + (b[1] - a[1]) * j / n;
          const rx = +(x + 4 * Math.sin(y * .12) + 1.6 * Math.sin(y * .57)).toFixed(1);
          const ry = +(y + 3 * Math.sin(x * .15) + 1.1 * Math.sin(x * .63)).toFixed(1);
          edgeNum.push([rx, ry]);
          edge.push(fmt(rx) + ',' + fmt(ry));
        }
      }
      const inUbu = ptsHitUbu(edgeNum, 202);
      const d = 'M' + edge.join('L') + 'Z';
      if (s % 3) { cardSet.platesDark += d; if (inUbu) ubuSet.platesDark += d; }
      else { cardSet.platesLight += d; if (inUbu) ubuSet.platesLight += d; }
      roll();
      cardSet.platesAll += d; if (inUbu) ubuSet.platesAll += d;
      roll(); roll(); roll();
    }
    for (let i = 0; i < seeds.length; i += 3) {
      const [x, y] = seeds[i];
      let other = null, distance = Infinity;
      for (const candidate of seeds) if (candidate !== seeds[i]) {
        const dist = Math.hypot(candidate[0] - x, candidate[1] - y);
        if (dist < distance) { distance = dist; other = candidate; }
      }
      const px = (x + other[0]) / 2, py = (y + other[1]) / 2;
      const cxn = +(px + 4 * Math.sin(py * .12) + 1.6 * Math.sin(py * .57)).toFixed(1);
      const cyn = +(py + 3 * Math.sin(px * .15) + 1.1 * Math.sin(px * .63)).toFixed(1);
      const rxn = +(5 + roll() * 9).toFixed(1), ryn = +(4 + roll() * 6).toFixed(1);
      const pocket = { cx: fmt(cxn), cy: fmt(cyn), rx: fmt(rxn), ry: fmt(ryn) };
      cardSet.meltPockets.push(pocket);
      if (hitsUbuDisc(cxn - rxn, cyn - ryn, cxn + rxn, cyn + ryn, 194)) ubuSet.meltPockets.push(pocket);
    }
    const dust = ['', '', ''];
    for (let i = 0; i < 1300; i++) {
      const x = roll() * 96, y = roll() * 96, r = .3 + roll() * 1.6;
      dust[i % 3] += 'M' + fmt(x) + ' ' + fmt(y) + 'l' + fmt(r) + ' ' + fmt(-r * .4) + 'l' + fmt(r * .5) + ' ' + fmt(r) + 'l' + fmt(-r) + ' ' + fmt(r * .4) + 'Z';
    }
    ubuSet.dust = cardSet.dust = dust;
    cachedLavaData = { ubu: ubuSet, card: cardSet };
  }
  return isUbu ? cachedLavaData.ubu : cachedLavaData.card;
}

let cachedCircuitryData = null;
function getCircuitryData() {
  if (cachedCircuitryData) return cachedCircuitryData;
  const roll = makeRng();
  const rotatePoint = (x, y, cx, cy, angleDeg) => {
    const rad = angleDeg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = x - cx, dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
  let dTraceBacking = '', dTraceGold = '', dTraceSilver = '';
  let dVias = '', dChips = '', dChipPins = '', dMarkings = '';
  let dSmdGold = '', dSmdDark = '';
  for (let row = 0; row < 7; row++) for (let col = 0; col < 7; col++) {
    const cx = col * 52 + 5 + roll() * 10, cy = row * 52 + 5 + roll() * 10;
    const w = 9 + roll() * 14, h = 8 + roll() * 18;
    const rot = Math.floor(roll() * 4) * 90;
    const transformPt = (x, y) => {
      const [rx, ry] = rotatePoint(x, y, 18, 18, rot);
      return [fmt(cx + rx), fmt(cy + ry), +(cx + rx).toFixed(1), +(cy + ry).toFixed(1)];
    };
    for (let pin = 0; pin < 5; pin++) {
      const py = 3 + pin * 3.5, run = 8 + roll() * 13, step = 4 + Math.floor(roll() * 4) * 3;
      const p1 = transformPt(w, py), p2 = transformPt(w + run, py);
      const p3 = transformPt(w + run + step, py + step), p4 = transformPt(w + run + step, py + step + 10 + roll() * 16);
      const pathStr = 'M' + p1[0] + ' ' + p1[1] + 'L' + p2[0] + ' ' + p2[1] + 'L' + p3[0] + ' ' + p3[1] + 'L' + p4[0] + ' ' + p4[1];
      dTraceBacking += pathStr;
      if (pin % 3) dTraceGold += pathStr; else dTraceSilver += pathStr;
      const viaCenter = transformPt(w + run + step, py + step + 10);
      const vx = viaCenter[2], vy = viaCenter[3];
      dVias += 'M' + fmt(vx - 1) + ' ' + fmt(vy) + 'A1 1 0 1 0 ' + fmt(vx + 1) + ' ' + fmt(vy) + 'A1 1 0 1 0 ' + fmt(vx - 1) + ' ' + fmt(vy);
    }
    const c0 = transformPt(0, 0), c1 = transformPt(w, 0), c2 = transformPt(w, h), c3 = transformPt(0, h);
    dChips += 'M' + c0[0] + ' ' + c0[1] + 'L' + c1[0] + ' ' + c1[1] + 'L' + c2[0] + ' ' + c2[1] + 'L' + c3[0] + ' ' + c3[1] + 'Z';
    for (let pin = 2; pin < h - 1; pin += 3) {
      const l1 = transformPt(-3, pin), l2 = transformPt(0, pin);
      const r1 = transformPt(w, pin), r2 = transformPt(w + 3, pin);
      dChipPins += 'M' + l1[0] + ' ' + l1[1] + 'L' + l2[0] + ' ' + l2[1] + 'M' + r1[0] + ' ' + r1[1] + 'L' + r2[0] + ' ' + r2[1];
    }
    const m1 = transformPt(2, 2), m2 = transformPt(w - 2, 2);
    dMarkings += 'M' + m1[0] + ' ' + m1[1] + 'L' + m2[0] + ' ' + m2[1];
    for (let j = 0; j < 3; j++) {
      const px = roll() * 35, py = h + 5 + j * 5, sw = 4 + roll() * 4, sh = 2;
      const s0 = transformPt(px, py), s1 = transformPt(px + sw, py);
      const s2 = transformPt(px + sw, py + sh), s3 = transformPt(px, py + sh);
      const smdPoly = 'M' + s0[0] + ' ' + s0[1] + 'L' + s1[0] + ' ' + s1[1] + 'L' + s2[0] + ' ' + s2[1] + 'L' + s3[0] + ' ' + s3[1] + 'Z';
      if (j % 2) dSmdGold += smdPoly; else dSmdDark += smdPoly;
    }
  }
  return (cachedCircuitryData = { dTraceBacking, dTraceGold, dTraceSilver, dVias, dChips, dChipPins, dMarkings, dSmdGold, dSmdDark });
}

let cachedKintsugiData = null;
function getKintsugiData(isUbu = false) {
  if (!cachedKintsugiData) {
    const roll = makeRng();
    const seeds = [];
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      seeds.push([-180 + (x + 0.2 + roll() * 0.6) * 105, -180 + (y + 0.2 + roll() * 0.6) * 105]);
    }
    const make = () => ({ dCracks: '', whiteTints: ['', ''], blackTints: ['', ''] });
    const ubuSet = make(), cardSet = make();
    for (let s = 0; s < seeds.length; s++) {
      const seed = seeds[s];
      const cell = clipVoronoiCell(seed, seeds);
      if (!cell.length) continue;
      const rough = [], roughNum = [];
      for (let k = 0; k < cell.length; k++) {
        const a = cell[k], b = cell[(k + 1) % cell.length], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 7);
        for (let j = 0; j < n; j++) {
          const x = a[0] + (b[0] - a[0]) * j / n, y = a[1] + (b[1] - a[1]) * j / n;
          const rx = +(x + 1.4 * Math.sin(y * .23) + .7 * Math.sin(y * .67)).toFixed(1);
          const ry = +(y + 1.4 * Math.sin(x * .19)).toFixed(1);
          roughNum.push([rx, ry]);
          rough.push(fmt(rx) + ',' + fmt(ry));
        }
      }
      const inUbu = ptsHitUbu(roughNum, 196);
      const d = 'M' + rough.join('L') + 'Z';
      const tintBucket = Math.min(1, Math.floor(roll() * 2));
      if (s % 2) { cardSet.whiteTints[tintBucket] += d; if (inUbu) ubuSet.whiteTints[tintBucket] += d; }
      else { cardSet.blackTints[tintBucket] += d; if (inUbu) ubuSet.blackTints[tintBucket] += d; }
      cardSet.dCracks += d; if (inUbu) ubuSet.dCracks += d;
      roll();
    }
    cachedKintsugiData = { ubu: ubuSet, card: cardSet };
  }
  return isUbu ? cachedKintsugiData.ubu : cachedKintsugiData.card;
}

let cachedPlushData = null;
function getPlushData() {
  if (cachedPlushData) return cachedPlushData;
  const roll = makeRng();
  const paths = ['', '', ''];
  for (let i = 0; i < 1800; i++) {
    const x = roll() * 96, y = roll() * 96, r = 1 + roll() * 2.4, lean = (roll() - .5) * 3;
    for (const dx of [-96, 0, 96]) for (const dy of [-96, 0, 96]) {
      if (x + dx < -5 || x + dx > 101 || y + dy < -5 || y + dy > 101) continue;
      paths[i % 3] += 'M' + fmt(x + dx) + ' ' + fmt(y + dy) + 'q' + fmt(-r) + ' ' + fmt(-r * 1.5) + ' ' + fmt(lean) + ' ' + fmt(-r * 2) + 'q' + fmt(r) + ' ' + fmt(-r * .4) + ' ' + fmt(r * .7) + ' ' + fmt(r);
    }
  }
  return (cachedPlushData = { paths });
}

let cachedSandstoneData = null;
function getSandstoneData() {
  if (cachedSandstoneData) return cachedSandstoneData;
  const roll = makeRng();
  const strataLight = ['', ''], strataDark = ['', ''];
  for (let band = -6; band < 27; band++) {
    const y = band * 26 + Math.sin(band * 1.7) * 9;
    const d = 'M-180 ' + fmt(y) + 'C60 ' + fmt(y - 60) + ' 300 ' + fmt(y + 60) + ' 540 ' + fmt(y) + 'L540 ' + fmt(y + 26) + 'C300 ' + fmt(y + 86) + ' 60 ' + fmt(y - 34) + ' -180 ' + fmt(y + 26) + 'Z';
    const bucket = roll() > .5 ? 1 : 0;
    if (band % 3) strataDark[bucket] += d;
    else strataLight[bucket] += d;
  }
  const grains = ['', '', '', ''];
  for (let i = 0; i < 7000; i++) {
    const x = roll() * 96, y = roll() * 96, r = .4 + roll() * .65;
    const rf = fmt(r);
    grains[i % 4] += 'M' + fmt(x) + ' ' + fmt(y) + 'h' + rf + 'v' + rf + 'h-' + rf + 'Z';
  }
  return (cachedSandstoneData = { strataLight, strataDark, grains });
}

let cachedGraniteData = null;
function getGraniteData() {
  if (cachedGraniteData) return cachedGraniteData;
  const roll = makeRng();
  const minerals = ['', '', '', '', '', ''];
  for (let y = -1; y < 49; y++) for (let x = -1; x < 49; x++) {
    const px = x * 3 + roll() * 2, py = y * 3 + roll() * 2;
    const r = 1.5 + roll() * 2.5;
    let d = '';
    for (let v = 0; v < 5; v++) {
      const a = v * Math.PI * 2 / 5, size = r * (.65 + roll() * .35);
      d += (v ? 'L' : 'M') + fmt(px + Math.cos(a) * size) + ' ' + fmt(py + Math.sin(a) * size);
    }
    minerals[Math.floor(roll() * 6)] += d + 'Z';
  }
  return (cachedGraniteData = { minerals });
}

let cachedTerrazzoData = null;
function getTerrazzoData(isUbu = false) {
  if (!cachedTerrazzoData) {
    const roll = makeRng();
    const chipsUbu = ['', '', '', ''], chipsCard = ['', '', '', ''];
    for (let i = 0; i < 440; i++) {
      const cx = -180 + roll() * 720, cy = -180 + roll() * 720;
      const radius = 2 + roll() * 8, count = 3 + Math.floor(roll() * 4);
      let d = '';
      for (let vertex = 0; vertex < count; vertex++) {
        const angle = (vertex + roll() * .4) * Math.PI * 2 / count;
        const r = radius * (.55 + roll() * .45);
        d += (vertex ? 'L' : 'M') + fmt(cx + Math.cos(angle) * r) + ' ' + fmt(cy + Math.sin(angle) * r);
      }
      roll();
      d += 'Z';
      chipsCard[i % 4] += d;
      if (Math.hypot(cx - 180, cy - 180) - radius <= 194) chipsUbu[i % 4] += d;
    }
    cachedTerrazzoData = { ubu: { chips: chipsUbu }, card: { chips: chipsCard } };
  }
  return isUbu ? cachedTerrazzoData.ubu : cachedTerrazzoData.card;
}

let cachedLeatherData = null;
function getLeatherData() {
  if (cachedLeatherData) return cachedLeatherData;
  const roll = makeRng();
  const corners = Array.from({ length: 24 }, () => Array.from({ length: 24 }, () => [(roll() - .5) * 2.8, (roll() - .5) * 2.8]));
  const corner = (x, y) => {
    const jitter = corners[(y + 24) % 24][(x + 24) % 24];
    return [x * 4 + jitter[0], y * 4 + jitter[1]];
  };
  const cells = ['', '', '', ''];
  let grainGlints = '';
  for (let row = -1; row <= 24; row++) {
    for (let col = -1; col <= 24; col++) {
      const points = [corner(col, row), corner(col + 1, row), corner(col + 1, row + 1), corner(col, row + 1)];
      const center = points.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
      const inset = points.map(p => p.map((v, i) => center[i] + (v - center[i]) * .9));
      const mids = inset.map((p, i) => p.map((v, j) => (v + inset[(i + 1) % 4][j]) / 2));
      let d = 'M' + fmt(mids[3][0]) + ' ' + fmt(mids[3][1]);
      for (let i = 0; i < 4; i++) d += 'Q' + fmt(inset[i][0]) + ' ' + fmt(inset[i][1]) + ' ' + fmt(mids[i][0]) + ' ' + fmt(mids[i][1]);
      cells[Math.floor(roll() * 4)] += d + 'Z';
      grainGlints += 'M' + fmt(mids[3][0]) + ' ' + fmt(mids[3][1]) + 'Q' + fmt(inset[0][0]) + ' ' + fmt(inset[0][1]) + ' ' + fmt(mids[0][0]) + ' ' + fmt(mids[0][1]);
    }
  }
  return (cachedLeatherData = { cells, grainGlints });
}

let cachedWoodgrainData = null;
function getWoodgrainData(isUbu = false) {
  if (!cachedWoodgrainData) {
    const roll = makeRng();
    const make = () => ({ fibersDark: ['', ''], fibersLight: ['', ''] });
    const ubuSet = make(), cardSet = make();
    for (let fiber = -28; fiber <= 100; fiber++) {
      const baseX = fiber * 6 + roll() * 3;
      let dCard = '', dUbu = '', penDown = false;
      let prevX = 0, prevY = -180;
      for (let y = -180; y <= 540; y += 8) {
        const distance = baseX - 140;
        const bend = Math.sign(distance) * 26 * Math.exp(-distance * distance / 1800 - (y - 180) ** 2 / 6500);
        const x = baseX + bend + 3 * Math.sin(y / 65 + fiber * .16) + 1.2 * Math.sin(y / 19 + fiber);
        dCard += (y === -180 ? 'M' : 'L') + fmt(x) + ' ' + y;
        if (y > -180) {
          if (hitsUbuDisc(Math.min(prevX, x), prevY, Math.max(prevX, x), y, 194)) {
            if (!penDown) { dUbu += 'M' + fmt(prevX) + ' ' + prevY; penDown = true; }
            dUbu += 'L' + fmt(x) + ' ' + y;
          } else {
            penDown = false;
          }
        }
        prevX = x; prevY = y;
      }
      roll(); roll();
      if (fiber % 4) { cardSet.fibersDark[fiber % 2] += dCard; if (dUbu) ubuSet.fibersDark[fiber % 2] += dUbu; }
      else { cardSet.fibersLight[fiber % 2] += dCard; if (dUbu) ubuSet.fibersLight[fiber % 2] += dUbu; }
    }
    cachedWoodgrainData = { ubu: ubuSet, card: cardSet };
  }
  return isUbu ? cachedWoodgrainData.ubu : cachedWoodgrainData.card;
}

let cachedBubbledData = null;
function getBubbledData(isUbu = false) {
  if (!cachedBubbledData) {
    const roll = makeRng();
    const bubblesCard = [];
    for (let i = 0; i < 180; i++) {
      const x = -150 + roll() * 660, y = -150 + roll() * 660, r = 7 + roll() ** 2 * 40;
      if (bubblesCard.some(b => Math.hypot(x - b.x, y - b.y) < (r + b.r) * .83)) continue;
      bubblesCard.push({ x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), r: Number(r.toFixed(1)) });
    }
    const bubblesUbu = bubblesCard.filter(b => Math.hypot(b.x - 180, b.y - 180) - b.r <= 190);
    cachedBubbledData = { ubu: { bubbles: bubblesUbu }, card: { bubbles: bubblesCard } };
  }
  return isUbu ? cachedBubbledData.ubu : cachedBubbledData.card;
}

let cachedObsidianData = null;
function getObsidianData(isUbu = false) {
  if (!cachedObsidianData) {
    const roll = makeRng();
    let dShellsCard = '', dLipsCard = '', dShellsUbu = '', dLipsUbu = '';
    for (let row = -1; row < 5; row++) for (let col = -1; col < 5; col++) {
      const x = col * 150 + (roll() - .5) * 80, y = row * 145 + (roll() - .5) * 70;
      const w = 75 + roll() * 90, h = 55 + roll() * 85;
      const lip = 'M' + fmt(x - w) + ' ' + fmt(y) + 'C' + fmt(x - w * .4) + ' ' + fmt(y - h * .9) + ' ' + fmt(x + w * .35) + ' ' + fmt(y - h * .6) + ' ' + fmt(x + w) + ' ' + fmt(y + h * .2);
      const d = lip + 'Q' + fmt(x + w * .4) + ' ' + fmt(y + h * .85) + ' ' + fmt(x - w * .5) + ' ' + fmt(y + h) + 'Q' + fmt(x - w * .7) + ' ' + fmt(y + h * .25) + ' ' + fmt(x - w) + ' ' + fmt(y) + 'Z';
      const inUbu = hitsUbuDisc(x - w, y - h, x + w, y + h, 194);
      dShellsCard += d; if (inUbu) dShellsUbu += d;
      if ((row + col) % 3 === 0) { dLipsCard += lip; if (inUbu) dLipsUbu += lip; }
    }
    cachedObsidianData = { ubu: { dShells: dShellsUbu, dLips: dLipsUbu }, card: { dShells: dShellsCard, dLips: dLipsCard } };
  }
  return isUbu ? cachedObsidianData.ubu : cachedObsidianData.card;
}

let cachedQuartzData = null;
function getQuartzData(isUbu = false) {
  if (!cachedQuartzData) {
    const roll = makeRng();
    const make = () => ({ dBody: '', dFace1: '', dFace2: '', dOutlines: '', dFractures: '', crystalTips: [] });
    const ubuSet = make(), cardSet = make();
    for (let i = 0; i < 85; i++) {
      const cx = -160 + roll() * 680, cy = -160 + roll() * 680, w = 10 + roll() * 20, h = 32 + roll() * 85;
      const angle = (-45 + roll() * 90) * Math.PI / 180;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const tf = (px, py) => [fmt(cx + px * cos - py * sin), fmt(cy + px * sin + py * cos)];
      const tip = [cx + h * Math.sin(angle), cy - h * Math.cos(angle), 1.4 + roll() * 1.7];
      const extent = Math.hypot(w, h);
      const inUbu = Math.hypot(cx - 180, cy - 180) - extent <= 194;
      cardSet.crystalTips.push(tip);
      if (Math.hypot(tip[0] - 180, tip[1] - 180) <= 194) ubuSet.crystalTips.push(tip);
      const pTop = tf(0, -h), pTR = tf(w, -h + w), pMR = tf(w, h * .45), pBot = tf(0, h * .65), pML = tf(-w, h * .45), pTL = tf(-w, -h + w);
      const body = 'M' + pTop[0] + ' ' + pTop[1] + 'L' + pTR[0] + ' ' + pTR[1] + 'L' + pMR[0] + ' ' + pMR[1] + 'L' + pBot[0] + ' ' + pBot[1] + 'L' + pML[0] + ' ' + pML[1] + 'L' + pTL[0] + ' ' + pTL[1] + 'Z';
      const pF1Mid = tf(w * .2, -h + w * 1.5), pF1Bot = tf(w * .2, h * .6);
      roll();
      const f1 = 'M' + pTop[0] + ' ' + pTop[1] + 'L' + pF1Mid[0] + ' ' + pF1Mid[1] + 'L' + pF1Bot[0] + ' ' + pF1Bot[1] + 'L' + pML[0] + ' ' + pML[1] + 'L' + pTL[0] + ' ' + pTL[1] + 'Z';
      roll();
      const f2 = 'M' + pTop[0] + ' ' + pTop[1] + 'L' + pF1Mid[0] + ' ' + pF1Mid[1] + 'L' + pTR[0] + ' ' + pTR[1] + 'Z';
      const pOutBot = tf(-w, h * .3);
      const outl = 'M' + pOutBot[0] + ' ' + pOutBot[1] + 'L' + pTL[0] + ' ' + pTL[1] + 'L' + pTop[0] + ' ' + pTop[1];
      const frac = -h * .5 + roll() * h * .7;
      const f0 = tf(-w * .8, frac), f1p = tf(w * .1, frac - w * .3), f2p = tf(w * .8, frac + w * .2);
      const fracD = 'M' + f0[0] + ' ' + f0[1] + 'L' + f1p[0] + ' ' + f1p[1] + 'L' + f2p[0] + ' ' + f2p[1];
      cardSet.dBody += body; cardSet.dFace1 += f1; cardSet.dFace2 += f2; cardSet.dOutlines += outl; cardSet.dFractures += fracD;
      if (inUbu) {
        ubuSet.dBody += body; ubuSet.dFace1 += f1; ubuSet.dFace2 += f2; ubuSet.dOutlines += outl; ubuSet.dFractures += fracD;
      }
    }
    cachedQuartzData = { ubu: ubuSet, card: cardSet };
  }
  return isUbu ? cachedQuartzData.ubu : cachedQuartzData.card;
}

let cachedFrostedData = null;
function getFrostedData(isUbu = false) {
  if (!cachedFrostedData) {
    const roll = makeRng();
    let branchesWhite = '', branchesBlue = '';
    for (let i = 0; i < 46; i++) {
      const px = roll() * 120, py = roll() * 120, length = 5 + roll() * 15;
      const angle = roll() * 360 * Math.PI / 180;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const tf = (x, y) => [fmt(px + x * cos - y * sin), fmt(py + x * sin + y * cos)];
      const p0 = tf(0, 0), p1 = tf(0, -length);
      let d = 'M' + p0[0] + ' ' + p0[1] + 'L' + p1[0] + ' ' + p1[1];
      for (let j = 1; j <= 5; j++) {
        const yb = -length * j / 6, branch = length * (1 - j / 7) * .3;
        const b0 = tf(0, yb), b1 = tf(branch, yb - branch), b2 = tf(-branch, yb - branch);
        d += 'M' + b0[0] + ' ' + b0[1] + 'L' + b1[0] + ' ' + b1[1] + 'M' + b0[0] + ' ' + b0[1] + 'L' + b2[0] + ' ' + b2[1];
      }
      roll(); roll();
      if (i % 4) branchesWhite += d;
      else branchesBlue += d;
    }
    let diamonds = '';
    for (let i = 0; i < 150; i++) {
      const x = roll() * 120, y = roll() * 120, r = .5 + roll() * 1.3;
      roll();
      diamonds += 'M' + fmt(x) + ' ' + fmt(y - r) + 'l' + fmt(r * .5) + ' ' + fmt(r) + 'l' + fmt(-r * .5) + ' ' + fmt(r) + 'l' + fmt(-r * .5) + ' ' + fmt(-r) + 'Z';
    }
    const sparklesCard = Array.from({ length: 85 }, () => [
      Number((-160 + roll() * 680).toFixed(1)),
      Number((-160 + roll() * 680).toFixed(1)),
      Number((1 + roll() * 1.5).toFixed(1))
    ]);
    const sparklesUbu = sparklesCard.filter(([x, y, r]) => Math.hypot(x - 180, y - 180) - r <= 194);
    cachedFrostedData = {
      ubu: { branchesWhite, branchesBlue, diamonds, sparkles: sparklesUbu },
      card: { branchesWhite, branchesBlue, diamonds, sparkles: sparklesCard }
    };
  }
  return isUbu ? cachedFrostedData.ubu : cachedFrostedData.card;
}

let cachedDenimData = null;
function getDenimData() {
  if (cachedDenimData) return cachedDenimData;
  const roll = makeRng();
  let weft0 = '', weft1 = '';
  let dark0 = '', dark1 = '';
  let light0 = '', light1 = '';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const weft = (x + y) % 4 === 0;
      if (weft) {
        const d = 'M' + fmt(x * 2 + .2) + ' ' + (y * 2 + 1) + 'h1.6';
        if (roll() > .5) weft1 += d; else weft0 += d;
      } else {
        const d = 'M' + (x * 2 + 1) + ' ' + fmt2(y * 2 + .15) + 'v1.7';
        const isDark = x % 3 !== 0;
        const hi = roll() > .5;
        if (isDark) { if (hi) dark1 += d; else dark0 += d; }
        else { if (hi) light1 += d; else light0 += d; }
      }
    }
  }
  return (cachedDenimData = { weft0, weft1, dark0, dark1, light0, light1 });
}

let cachedHammeredDentPaths = null;
function getHammeredDentPaths() {
  if (cachedHammeredDentPaths) return cachedHammeredDentPaths;
  const roll = makeRng();
  const grid = Array.from({ length: 13 }, (_, y) => Array.from({ length: 13 }, (_, x) => [-16 + x * 16 + (roll() - .5) * 13, -16 + y * 16 + (roll() - .5) * 13]));
  const paths = [];
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const pts = [grid[y][x], grid[y][x + 1], grid[y + 1][x + 1], grid[y + 1][x]];
    const mid = pts.map((p, i) => p.map((v, j) => (v + pts[(i + 1) % 4][j]) / 2));
    let d = 'M' + fmt(mid[3][0]) + ' ' + fmt(mid[3][1]);
    for (let i = 0; i < 4; i++) d += 'Q' + fmt(pts[i][0]) + ' ' + fmt(pts[i][1]) + ' ' + fmt(mid[i][0]) + ' ' + fmt(mid[i][1]);
    paths.push(d + 'Z');
  }
  return (cachedHammeredDentPaths = paths);
}

let cachedStarfieldData = null;
function getStarfieldData(isUbu = false) {
  if (!cachedStarfieldData) {
    const roll = makeRng();
    const nebulaeCard = [], nebulaeUbu = [];
    for (let i = 0; i < 22; i++) {
      const x = -150 + roll() * 650, y = -150 + roll() * 650, r = 45 + roll() * 120;
      const item = {
        x: Number(x.toFixed(1)), y: Number(y.toFixed(1)),
        rx: Number(r.toFixed(1)), ry: Number((r * (.35 + roll() * .5)).toFixed(1)),
        rot: Number((roll() * 180).toFixed(1)), colorIdx: i % 4
      };
      nebulaeCard.push(item);
      if (Math.hypot(item.x - 180, item.y - 180) - Math.max(item.rx, item.ry) <= 212) nebulaeUbu.push(item);
    }
    const dustCard = [], dustUbu = [];
    for (let i = 0; i < 12; i++) {
      const item = {
        cx: Number((-150 + roll() * 650).toFixed(1)),
        cy: Number((-150 + roll() * 650).toFixed(1)),
        rx: Number((80 + roll() * 100).toFixed(1)),
        ry: Number((16 + roll() * 35).toFixed(1))
      };
      dustCard.push(item);
      if (Math.hypot(item.cx - 180, item.cy - 180) - item.rx <= 212) dustUbu.push(item);
    }
    let starsWhiteCard = '', starsBlueCard = '', starsWhiteUbu = '', starsBlueUbu = '';
    const glintsCard = [], glintsUbu = [];
    for (let i = 0; i < 220; i++) {
      const x = -160 + roll() * 680, y = -160 + roll() * 680, r = .15 + roll() ** 3 * 1.1;
      const rf = fmt(r), r2f = fmt(2 * r);
      const d = 'M' + fmt(x - r) + ' ' + fmt(y) + 'a' + rf + ' ' + rf + ' 0 1 0 ' + r2f + ' 0a' + rf + ' ' + rf + ' 0 1 0 ' + fmt(-2 * r) + ' 0';
      roll();
      const inUbu = Math.hypot(x - 180, y - 180) <= 212;
      if (i % 4) { starsWhiteCard += d; if (inUbu) starsWhiteUbu += d; }
      else { starsBlueCard += d; if (inUbu) starsBlueUbu += d; }
      if (r > .65) {
        const g = [Number(x.toFixed(1)), Number(y.toFixed(1)), Number((r * 3).toFixed(1))];
        glintsCard.push(g);
        if (inUbu) glintsUbu.push(g);
      }
    }
    cachedStarfieldData = {
      ubu: { nebulae: nebulaeUbu, dustEllipses: dustUbu, starsWhite: starsWhiteUbu, starsBlue: starsBlueUbu, glints: glintsUbu },
      card: { nebulae: nebulaeCard, dustEllipses: dustCard, starsWhite: starsWhiteCard, starsBlue: starsBlueCard, glints: glintsCard }
    };
  }
  return isUbu ? cachedStarfieldData.ubu : cachedStarfieldData.card;
}

let cachedSandstoneEdge = null;
function getSandstoneEdgeData() {
  if (cachedSandstoneEdge) return cachedSandstoneEdge;
  const roll = makeRng(317);
  let dark = '', light = '';
  for (let i = 0; i < 260; i++) {
    const x = roll() * 48, y = roll() * 48, r = .35 + roll() * 1.35;
    const d = 'M' + fmt(x) + ' ' + fmt(y - r) + 'l' + fmt(r) + ' ' + fmt(r * .8) + 'l' + fmt(-r * .45) + ' ' + fmt(r) + 'l' + fmt(-r * 1.2) + ' ' + fmt(-r * .35) + 'Z';
    roll();
    if (i % 3) dark += d;
    else light += d;
  }
  return (cachedSandstoneEdge = { dark, light });
}


module.exports = {
  ubuMod, NS, roles, DESIGNED, fmt, fmt2, getAttr, tagOf, makeRng, parseHexRgb, deepFreeze,
  EDGE_FINISHES, hitsUbuDisc, ptsHitUbu, clipVoronoiCell, getLiquidTones, getLiquidShades,
  getMatteData, getMetallicData, getSatinData, getCarbonData, getMarbleData,
  getCrystallineData, getMosaicData, getCrackleData, getLavaData, getCircuitryData,
  getKintsugiData, getPlushData, getSandstoneData, getGraniteData, getTerrazzoData,
  getLeatherData, getWoodgrainData, getBubbledData, getObsidianData, getQuartzData,
  getFrostedData, getDenimData, getHammeredDentPaths, getStarfieldData, getSandstoneEdgeData
};
