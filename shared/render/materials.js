/* SVG <defs> material shaders, pattern tile baking, and bevel/stitch edge finishes. */
'use strict';
const {
  NS, fmt, fmt2, getAttr, tagOf, makeRng, parseHexRgb, deepFreeze, EDGE_FINISHES,
  getLiquidTones, getLiquidShades, getMatteData, getMetallicData, getSatinData,
  getCarbonData, getMarbleData, getCrystallineData, getMosaicData, getCrackleData,
  getLavaData, getCircuitryData, getKintsugiData, getPlushData, getSandstoneData,
  getGraniteData, getTerrazzoData, getLeatherData, getWoodgrainData, getBubbledData,
  getObsidianData, getQuartzData, getFrostedData, getDenimData, getHammeredDentPaths,
  getStarfieldData, getSandstoneEdgeData
} = require('./generators.js');

function createMaterialPainter(rawEnv = globalThis) {
  const env = rawEnv === globalThis ? globalThis : new Proxy(rawEnv, { get: (t, k) => k in t ? t[k] : globalThis[k] });
  let liquidTileDataUrl = null;
function prepareLiquidTile() {
  if (liquidTileDataUrl) return liquidTileDataUrl;
  if (typeof env.document === 'undefined' || typeof env.document.createElement !== 'function') return null;
  try {
    const canvas = env.document.createElement('canvas');
    canvas.width = canvas.height = 360;
    const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx || typeof ctx.createImageData !== 'function') return null;
    const tones = getLiquidTones();
    const premulW = new Float32Array(360 * 360);
    const premulA = new Float32Array(360 * 360);
    for (let gy = 0; gy < 180; gy++) {
      const rowOff = gy * 180, y0 = gy * 2 * 360, y1 = y0 + 360;
      for (let gx = 0; gx < 180; gx++) {
        const t = tones[rowOff + gx];
        const a = t < 9 ? (9 - t) * .025 : (t > 9 ? (t - 9) * .035 : 0);
        const w = t > 9 ? a : 0;
        const x0 = gx * 2;
        premulW[y0 + x0] = premulW[y0 + x0 + 1] = premulW[y1 + x0] = premulW[y1 + x0 + 1] = w;
        premulA[y0 + x0] = premulA[y0 + x0 + 1] = premulA[y1 + x0] = premulA[y1 + x0 + 1] = a;
      }
    }
    // Separable 3-tap Gaussian matching feGaussianBlur stdDeviation="0.35" (w1 = exp(-1/(2*.35^2))).
    const w0 = 0.96734, w1 = 0.01633;
    const tmpW = new Float32Array(360 * 360);
    const tmpA = new Float32Array(360 * 360);
    for (let y = 0; y < 360; y++) {
      const r = y * 360;
      for (let x = 0; x < 360; x++) {
        const xl = x > 0 ? x - 1 : 0, xr = x < 359 ? x + 1 : 359;
        tmpW[r + x] = premulW[r + xl] * w1 + premulW[r + x] * w0 + premulW[r + xr] * w1;
        tmpA[r + x] = premulA[r + xl] * w1 + premulA[r + x] * w0 + premulA[r + xr] * w1;
      }
    }
    const imgData = ctx.createImageData(360, 360);
    const out = imgData.data;
    for (let y = 0; y < 360; y++) {
      const ym = (y > 0 ? y - 1 : 0) * 360, yc = y * 360, yp = (y < 359 ? y + 1 : 359) * 360;
      for (let x = 0; x < 360; x++) {
        const pw = tmpW[ym + x] * w1 + tmpW[yc + x] * w0 + tmpW[yp + x] * w1;
        const pa = Math.min(1, tmpA[ym + x] * w1 + tmpA[yc + x] * w0 + tmpA[yp + x] * w1);
        const idx = (yc + x) * 4;
        if (pa > 1e-5) {
          const c = Math.max(0, Math.min(255, Math.round(255 * pw / pa)));
          out[idx] = out[idx + 1] = out[idx + 2] = c;
          out[idx + 3] = Math.round(255 * pa);
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
    liquidTileDataUrl = canvas.toDataURL('image/png');
  } catch {}
  return liquidTileDataUrl;
}

function svgNode(tag, attrs = {}) {
  const element = env.document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

// Precomputed procedural material caches (lazy-evaluated once per session, 100% deterministic).
// Full 720x720 variants serve landscape card stripes; disc-culled variants trim invisible
// offscreen geometry outside r=194 for circular ubus while keeping exact PRNG state.

const bakedTiles = new Map();
function bakePatternTile(key, width, height, populate, onReady) {
  let state = bakedTiles.get(key);
  if (state?.url) {
    if (onReady) onReady(state.url);
    return state.url;
  }
  if (typeof env.Image === 'undefined' || typeof env.XMLSerializer === 'undefined' || typeof env.document === 'undefined' || typeof env.document.createElement !== 'function') return null;
  if (state) {
    if (onReady) state.waiters.push(onReady);
    return null;
  }
  state = { url: null, waiters: onReady ? [onReady] : [] };
  bakedTiles.set(key, state);
  try {
    const pw = width * 2, ph = height * 2;
    const mini = svgNode('svg', { xmlns: NS, viewBox: `0 0 ${width} ${height}`, width: pw, height: ph });
    const localDefs = svgNode('defs');
    mini.append(localDefs);
    populate(mini, localDefs);
    const href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new env.XMLSerializer().serializeToString(mini));
    const source = new env.Image();
    source.onload = () => {
      try {
        const canvas = env.document.createElement('canvas');
        canvas.width = pw; canvas.height = ph;
        const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
        if (context) {
          context.drawImage(source, 0, 0, pw, ph);
          state.url = canvas.toDataURL('image/png');
          for (const fn of state.waiters) fn(state.url);
        } else {
          bakedTiles.delete(key);
        }
      } catch {
        bakedTiles.delete(key);
      }
      state.waiters.length = 0;
    };
    source.onerror = () => { bakedTiles.delete(key); };
    source.src = href;
  } catch {
    bakedTiles.delete(key);
  }
  return state.url;
}
function attachBakedPattern(defs, patternId, cacheKey, width, height, populate) {
  const pat = svgNode('pattern', { id: patternId, patternUnits: 'userSpaceOnUse', width, height });
  const url = bakePatternTile(cacheKey, width, height, populate, readyUrl => {
    if (typeof pat.replaceChildren === 'function' && pat.isConnected) {
      pat.replaceChildren(svgNode('image', { width, height, href: readyUrl }));
    }
  });
  if (url) pat.append(svgNode('image', { width, height, href: url }));
  else populate(pat, defs);
  defs.append(pat);
  return pat;
}

const staticSparkleCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function sparkleStarPath(x, y, r) {
  return `M${fmt(x - r)} ${fmt(y)}l${fmt2(r * .8)} ${fmt2(-r * .2)}l${fmt2(r * .2)} ${fmt2(-r)}l${fmt2(r * .2)} ${fmt2(r)}l${fmt2(r * .8)} ${fmt2(r * .2)}l${fmt2(-r * .8)} ${fmt2(r * .2)}l${fmt2(-r * .2)} ${fmt2(r)}l${fmt2(-r * .2)} ${fmt2(-r)}Z`;
}

function material(defs, attribute, id, effects, cx = 180, cy = 180) {
  const isUbu = cx === 180 && cy === 180;
  // Ubu faces clip strictly inside r=176 around (180, 180) at every rotation angle; keep full
  // 720x720 bounds only for landscape card stripes (cx=240, cy=160).
  const box = isUbu ? (effects ? { x: -24, y: -24, width: 408, height: 408 } : { x: 0, y: 0, width: 360, height: 360 })
    : { x: -180, y: -180, width: 720, height: 720 };
  const matAngle = Number.isFinite(attribute?.angle) ? attribute.angle : 0;
  const rotate = `rotate(${matAngle} ${cx} ${cy})`;
  // One global material field: every detail rotates about the outer-circle center.
  const pattern = svgNode('pattern', { id, patternUnits: 'userSpaceOnUse', x: cx - 360, y: cy - 360,
    width: 720, height: 720, viewBox: '-180 -180 720 720', patternTransform: rotate });
  const cover = fill => { const rect = svgNode('rect', { ...box, fill }); pattern.append(rect); return rect; };
  const rgb = parseHexRgb(attribute?.hex);
  const dark = (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722) / 255 < .25;
  function animate(effect) { if (effects) (effects.idle ||= []).push(effect); }
  function sparkle(points, strength = 1) {
    if (!effects) {
      let joined = staticSparkleCache?.get(points);
      if (joined === undefined) {
        joined = points.map(([x, y, r]) => sparkleStarPath(x, y, r)).join('');
        staticSparkleCache?.set(points, joined);
      }
      if (joined) pattern.append(svgNode('path', { d: joined, fill: '#fff', opacity: .3, 'data-sparkle': '' }));
      return [];
    }
    const groups = Array.from({ length: 6 }, () => svgNode('g', { fill: '#fff', opacity: .3, 'data-sparkle': '' }));
    points.forEach(([x, y, r], i) => {
      groups[i % 6].append(svgNode('path', { d: sparkleStarPath(x, y, r) }));
    });
    pattern.append(...groups);
    animate((x, y, time) => groups.forEach((g, i) => {
      const twinkle = Math.max(0, Math.sin(time * (.65 + i * .09) + i * 2.1)) ** 12;
      const glint = Math.max(0, Math.sin(x * 3 + y * 2 + i * 1.7)) ** 18;
      g.setAttribute('opacity', Math.min(1, .12 + strength * (.72 * twinkle + .55 * glint)));
    }));
    return groups;
  }

  function lighting(name, stops, radial = false, attrs = {}) {
    const key = id + '-' + name;
    const gradient = svgNode(radial ? 'radialGradient' : 'linearGradient', {
      id: key, gradientUnits: 'userSpaceOnUse',
      ...(radial ? { cx: 105, cy: 90, r: 265 } : { x1: 0, y1: 0, x2: 360, y2: 0 }), ...attrs
    });
    for (const [offset, color, opacity] of stops) gradient.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
    if (effects && attribute.texture !== 'starfield') {
      const base = attrs.gradientTransform || '';
      const radians = matAngle * Math.PI / 180;
      const strength = attribute.texture === 'matte' ? 15 : 65;
      effects.push((x, y) => {
        const dx = (x * Math.cos(radians) + y * Math.sin(radians)) * strength;
        const dy = (-x * Math.sin(radians) + y * Math.cos(radians)) * strength;
        gradient.setAttribute('gradientTransform', `translate(${dx} ${dy}) ${base}`);
      });
    }
    defs.append(gradient);
    cover(`url(#${key})`);
  }
  // Fixed procedural detail never consumes DNA or the naming stream.
  if (attribute.texture === 'metallic') {
    lighting('reflection', [[0, '#000', .58], [.12, '#fff', .18], [.27, '#000', .4],
      [.36, '#000', .62], [.405, '#fff', .85], [.44, '#fff', .38], [.51, '#000', .18],
      [.64, '#000', .52], [.72, '#fff', .58], [.77, '#fff', .12], [1, '#000', .4]]);
    const brush = svgNode('pattern', { id: id + '-brush', patternUnits: 'userSpaceOnUse', width: 72, height: 72 });
    for (const g of getMetallicData()) {
      brush.append(svgNode('path', { d: g.d, stroke: g.color, 'stroke-width': g.width, opacity: g.opacity }));
    }
    defs.append(brush); cover(`url(#${id}-brush)`);
  } else if (attribute.texture === 'glossy') {
    lighting('depth', [[0, '#fff', .16], [.3, '#fff', .02], [.7, '#000', .18], [1, '#000', .5]], true);
    lighting('softbox', [[0, '#fff', 0], [.17, '#fff', 0], [.25, '#fff', .12],
      [.30, '#fff', .58], [.34, '#fff', .7], [.38, '#fff', .25], [.46, '#fff', 0], [1, '#fff', 0]]);
    lighting('glint', [[0, '#fff', .85], [.24, '#fff', .48], [.65, '#fff', .08], [1, '#fff', 0]], true,
      { cx: 100, cy: 76, r: 58, gradientTransform: 'translate(0 38) scale(1 .5)' });
    lighting('edge', [[0, '#fff', 0], [.81, '#fff', 0], [.87, '#fff', .2], [.9, '#fff', 0], [1, '#fff', 0]]);
  } else if (attribute.texture === 'iridescent') {
    lighting('oil-depth', [[0, '#fff', .12], [.45, '#000', .06], [1, '#000', .38]], true);
    // Broad thin-film color bands curve across the surface, retaining the base color beneath.
    lighting('interference', [[0, '#8b5cff', .12], [.18, '#735dff', .48], [.3, '#ed61d3', .46],
      [.41, '#ffb66d', .35], [.5, '#e9ef92', .27], [.59, '#69edca', .43],
      [.7, '#49cfea', .5], [.82, '#7272f5', .44], [.94, '#de68ce', .35], [1, '#905cff', .2]], true,
      { cx: 70, cy: 70, r: 330, gradientTransform: 'translate(-20 25) skewX(-18)' });
    lighting('oil-sheen', [[0, '#fff', 0], [.22, '#fff', 0], [.32, '#dcfaff', .12],
      [.37, '#fff', .52], [.4, '#ffe9fa', .21], [.49, '#fff', 0], [1, '#fff', 0]]);
  } else if (attribute.texture === 'pearlescent') {
    lighting('nacre-depth', [[0, '#fff', .32], [.45, '#fff', .08], [1, '#000', .22]], true);
    lighting('nacre-color', [[0, '#d9f5ff', .12], [.25, '#fbe0ef', .3], [.46, '#fff3d7', .38],
      [.63, '#d8f8ed', .22], [.8, '#dcdfff', .28], [1, '#fff', .05]], true,
      { cx: 80, cy: 60, r: 355, gradientTransform: 'skewX(-12)' });
    lighting('pearl-sheen', [[0, '#fff', 0], [.2, '#fff', .04], [.38, '#fff', .38],
      [.5, '#fff', .16], [.7, '#fff', 0], [1, '#fff', 0]]);
  } else if (attribute.texture === 'damascus') {
    // Polished etched alloys: quantized turbulent bands with steel luster.
    const etch = svgNode('filter', { id: id + '-etch', filterUnits: 'userSpaceOnUse',
      ...box, 'color-interpolation-filters': 'sRGB' });
    etch.append(svgNode('feTurbulence', { type: 'fractalNoise', baseFrequency: '.009 .023',
      numOctaves: 4, seed: 173, result: 'folds' }),
      svgNode('feColorMatrix', { type: 'matrix', values: '1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 1' }));
    const bands = svgNode('feComponentTransfer');
    const levels = Array.from({ length: 48 }, (_, i) => i % 4 < 2 ? .06 : .94).join(' ');
    for (const channel of ['R', 'G', 'B']) bands.append(svgNode('feFunc' + channel, { type: 'discrete', tableValues: levels }));
    bands.append(svgNode('feFuncA', { type: 'linear', slope: .42 }));
    etch.append(bands); defs.append(etch);
    pattern.append(svgNode('rect', { ...box, filter: `url(#${id}-etch)` }));
    lighting('steel-flat', [[0, '#fff', .08], [.5, '#fff', .02], [1, '#000', .08]], true);
    lighting('steel-polish', [[0, '#fff', 0], [.2, '#fff', .02], [.36, '#fff', .18],
      [.43, '#fff', .32], [.51, '#fff', .12], [.66, '#fff', 0], [1, '#fff', 0]]);
  } else if (attribute.texture === 'marble') {
    lighting('stone-depth', [[0, '#fff', .24], [.5, '#fff', .04], [1, '#000', .18]], true);
    const cloud = svgNode('filter', { id: id + '-mineral', filterUnits: 'userSpaceOnUse', ...box });
    cloud.append(svgNode('feTurbulence', { type: 'fractalNoise', baseFrequency: '.012 .025', numOctaves: 3, seed: 41 }),
      svgNode('feColorMatrix', { type: 'saturate', values: 0 }));
    defs.append(cloud);
    pattern.append(svgNode('rect', { ...box, filter: `url(#${id}-mineral)`, opacity: .22 }));
    const data = getMarbleData(isUbu);
    const coreColor = dark ? '#adb3b9' : '#000', branchColor = dark ? '#b3b6bb' : '#000';
    for (const [d, w] of [[data.halos[0], 8.2], [data.halos[1], 12.8]]) {
      if (d) pattern.append(svgNode('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': w, opacity: .055 }));
    }
    for (const [d, w] of [[data.cores[0], 1.55], [data.cores[1], 2.65]]) {
      if (d) pattern.append(svgNode('path', { d, fill: 'none', stroke: coreColor, 'stroke-width': w, opacity: .18 }));
    }
    if (data.fine) pattern.append(svgNode('path', { d: data.fine, fill: 'none', stroke: '#fff', 'stroke-width': .35, opacity: .15 }));
    for (const [d, w] of [[data.branches[0], .5], [data.branches[1], .85]]) {
      if (d) pattern.append(svgNode('path', { d, fill: 'none', stroke: branchColor, 'stroke-width': w, opacity: .18 }));
    }
    lighting('stone-polish', [[0, '#fff', .25], [.35, '#fff', .08], [1, '#fff', 0]], true,
      { cx: 95, cy: 70, r: 210 });
  } else if (attribute.texture === 'lacquered') {
    lighting('lacquer-depth', [[0, '#fff', .06], [.35, '#000', .08], [.7, '#000', .32], [1, '#000', .62]], true);
    lighting('lacquer-reflection', [[0, '#fff', 0], [.23, '#fff', 0], [.275, '#fff', .12],
      [.29, '#fff', .85], [.335, '#fff', .72], [.35, '#fff', .1], [.39, '#fff', 0], [1, '#fff', 0]]);
    lighting('lacquer-bounce', [[0, '#fff', 0], [.68, '#fff', 0], [.77, '#fff', .18],
      [.81, '#fff', .3], [.83, '#fff', 0], [1, '#fff', 0]]);
  } else if (attribute.texture === 'velvet') {
    // Fine low-contrast nap with broad brushed patches, never glittering noise.
    lighting('nap-brush', [[0,'#fff',.045],[.4,'#fff',.09],[.7,'#000',.035],[1,'#fff',.02]], true,
      { cx: 80, cy: 160, r: 310, gradientTransform: 'scale(1 .8)' });
    lighting('velvet-diffuse', [[0, '#000', .08], [.5, '#000', .13], [1, '#000', .22]], true);
    const nap = svgNode('filter', { id: id + '-nap', filterUnits: 'userSpaceOnUse',
      ...box, 'color-interpolation-filters': 'sRGB' });
    nap.append(svgNode('feTurbulence', { type: 'fractalNoise', baseFrequency: '.65 .85', numOctaves: 2, seed: 173 }),
      svgNode('feColorMatrix', { type: 'saturate', values: 0 }));
    const napContrast = svgNode('feComponentTransfer');
    for (const channel of ['R', 'G', 'B']) napContrast.append(svgNode('feFunc' + channel,
      { type: 'linear', slope: .8, intercept: .12 }));
    napContrast.append(svgNode('feFuncA', { type: 'linear', slope: 0, intercept: 1 }));
    nap.append(napContrast);
    defs.append(nap);
    pattern.append(svgNode('rect', { ...box, filter: `url(#${id}-nap)`, opacity: .14 }));
  } else if (attribute.texture === 'frosted') {
    lighting('ice-body', [[0, '#e3faff', .42], [.45, '#c9e9fa', .2], [1, '#84accb', .1]], true);
    const frost = svgNode('pattern', { id: id + '-frost', patternUnits: 'userSpaceOnUse', width: 120, height: 120 });
    const data = getFrostedData(isUbu);
    frost.append(
      svgNode('path', { d: data.branchesWhite, fill: 'none', stroke: '#ecfcff', 'stroke-width': .6, 'stroke-linecap': 'round', opacity: .35 }),
      svgNode('path', { d: data.branchesBlue, fill: 'none', stroke: '#648da9', 'stroke-width': .6, 'stroke-linecap': 'round', opacity: .35 }),
      svgNode('path', { d: data.diamonds, fill: '#e6faff', opacity: .25 })
    );
    defs.append(frost); cover(`url(#${id}-frost)`);
    lighting('ice-glint', [[0, '#fff', 0], [.3, '#fff', .03], [.43, '#defaff', .3],
      [.49, '#fff', .04], [1, '#fff', 0]]);
    sparkle(data.sparkles, .85);
  } else if (attribute.texture === 'woodgrain') {
    lighting('wood-depth', [[0, '#fff', .2], [.5, '#fff', .02], [1, '#000', .24]], true);
    if (dark) pattern.append(svgNode('rect', { ...box, fill: '#b7a897', opacity: .075 }));
    const data = getWoodgrainData(isUbu);
    const darkFibers = data.fibersDark[0] + data.fibersDark[1];
    const lightFibers = data.fibersLight[0] + data.fibersLight[1];
    if (dark) {
      if (darkFibers) pattern.append(svgNode('path', { d: darkFibers, fill: 'none', stroke: '#a69a8b', 'stroke-width': 1.2, opacity: .1 }));
      if (lightFibers) pattern.append(svgNode('path', { d: lightFibers, fill: 'none', stroke: '#000', 'stroke-width': 1.2, opacity: .1 }));
    } else {
      if (darkFibers) pattern.append(svgNode('path', { d: darkFibers, fill: 'none', stroke: '#000', 'stroke-width': 1.2, opacity: .18 }));
      if (lightFibers) pattern.append(svgNode('path', { d: lightFibers, fill: 'none', stroke: '#fff', 'stroke-width': 1.2, opacity: .18 }));
    }
    for (let ring = 1; ring <= 5; ring++) pattern.append(svgNode('ellipse', {
      cx: 140, cy: 180, rx: ring * 3, ry: ring * 9, fill: 'none', stroke: dark ? '#a69a8b' : '#000',
      'stroke-width': .7, opacity: .23 - ring * .02 }));
    lighting('wood-satin', [[0, '#fff', 0], [.35, '#fff', .12], [.6, '#fff', .04], [1, '#fff', 0]]);
  } else if (attribute.texture === 'holographic') {
    lighting('foil-depth', [[0, '#fff', .18], [.3, '#000', .18], [.65, '#fff', .22], [1, '#000', .3]]);
    lighting('diffraction', [[0, '#ff709d', .48], [.16, '#ffe66c', .55], [.32, '#84ffaf', .5],
      [.48, '#6be9ff', .6], [.64, '#8b91ff', .55], [.8, '#ed7cff', .58], [1, '#ff709d', .48]], false,
      { x1: 0, y1: 0, x2: 160, y2: 80, spreadMethod: 'reflect' });
    const grooves = svgNode('pattern', { id: id + '-grooves', patternUnits: 'userSpaceOnUse', width: 4, height: 4 });
    grooves.append(svgNode('path', { d: 'M0 0h4', stroke: '#fff', 'stroke-width': .45, opacity: .18 }));
    defs.append(grooves); cover(`url(#${id}-grooves)`);
    lighting('foil-flash', [[0, '#fff', 0], [.38, '#fff', 0], [.46, '#fff', .68],
      [.5, '#fff', .12], [.57, '#fff', 0], [1, '#fff', 0]]);
  } else if (attribute.texture === 'terrazzo') {
    lighting('stone-matrix', [[0, '#fff', .17], [.5, '#fff', .03], [1, '#000', .18]], true);
    const data = getTerrazzoData(isUbu);
    const colors = ['#fff', '#000', '#ead9c5', '#a7b6b7'];
    for (let i = 0; i < 4; i++) if (data.chips[i]) pattern.append(svgNode('path', { d: data.chips[i], fill: colors[i], opacity: .38 }));
    lighting('aggregate-polish', [[0, '#fff', .15], [.4, '#fff', .04], [1, '#fff', 0]], true);
  } else if (attribute.texture === 'crackle') {
    lighting('glaze-depth', [[0, '#fff', .2], [.5, '#fff', .02], [1, '#000', .22]], true);
    const data = getCrackleData(isUbu);
    const shadeOpacities = [0.015, 0.032, 0.048, 0.065];
    for (let i = 0; i < 4; i++) {
      if (data.shades[i]) pattern.append(svgNode('path', { d: data.shades[i], fill: '#fff', 'fill-opacity': shadeOpacities[i] }));
    }
    if (data.dCells) {
      const cellsId = `${id}-cells`;
      defs.append(svgNode('path', { id: cellsId, d: data.dCells }));
      pattern.append(
        svgNode('use', { href: `#${cellsId}`, fill: 'none', stroke: '#fff', 'stroke-opacity': .2, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }),
        svgNode('use', { href: `#${cellsId}`, fill: 'none', stroke: '#000', 'stroke-opacity': .48, 'stroke-width': 1.15, 'stroke-linejoin': 'round' })
      );
    }
    if (data.chips0) pattern.append(svgNode('path', { d: data.chips0, fill: '#000', opacity: .25 }));
    if (data.chips1) pattern.append(svgNode('path', { d: data.chips1, fill: '#fff', opacity: .25 }));
    lighting('glaze-sheen', [[0, '#fff', 0], [.3, '#fff', .04], [.42, '#fff', .25],
      [.55, '#fff', .02], [1, '#fff', 0]]);
  } else if (attribute.texture === 'plush') {
    lighting('plush-depth', [[0, '#fff', .12], [.5, '#000', .04], [1, '#000', .25]], true);
    attachBakedPattern(defs, id + '-tufts', 'plush', 96, 96, target => {
      const data = getPlushData();
      for (let i = 0; i < 3; i++) target.append(svgNode('path', { d: data.paths[i], fill: 'none',
        stroke: i ? '#fff' : '#000', 'stroke-width': i === 2 ? .55 : 1.2,
        'stroke-linecap': 'round', opacity: i === 0 ? .16 : i === 1 ? .12 : .2 }));
    });
    cover(`url(#${id}-tufts)`);
  } else if (attribute.texture === 'opalescent') {
    const roll = makeRng();
    lighting('opal-body', [[0, '#fff', .38], [.5, '#fff', .18], [1, '#000', .16]], true);
    const colors = ['#73efc0', '#ffbd72', '#8da4ff', '#ed8bda', '#8ce6ff'];
    for (let i = 0; i < 28; i++) {
      const color = colors[i % colors.length];
      lighting('opal-fire-' + i, [[0, color, .42], [.45, color, .28], [1, color, 0]], true,
        { cx: -70 + roll() * 500, cy: -70 + roll() * 500, r: 25 + roll() * 50 });
    }
    lighting('opal-polish', [[0, '#fff', .45], [.3, '#fff', .16], [1, '#fff', 0]], true,
      { cx: 105, cy: 80, r: 135 });
  } else if (attribute.texture === 'matte') {
    // Printed matte parts share one flat light field, not individual domes.
    lighting('diffuse', [[0, '#fff', .12], [.5, '#fff', .02], [1, '#000', .07]], false,
      { x1: 0, y1: 0, x2: 360, y2: 360 });
    const grain = svgNode('pattern', { id: id + '-grain', patternUnits: 'userSpaceOnUse', width: 48, height: 48 });
    const data = getMatteData();
    for (let i = 0; i < 3; i++) {
      if (data.black[i]) grain.append(svgNode('path', { d: data.black[i], fill: '#000', opacity: data.opacities[i] }));
      if (data.white[i]) grain.append(svgNode('path', { d: data.white[i], fill: '#fff', opacity: data.opacities[i] }));
    }
    defs.append(grain); cover(`url(#${id}-grain)`);
  } else if (attribute.texture === 'crystalline') {
    // An irregular triangulated field avoids a visibly repeating gemstone stamp.
    const data = getCrystallineData();
    if (effects) {
      for (const item of data.facets) {
        if (isUbu && !item.inUbu) continue;
        const facet = svgNode('polygon', { points: item.ptsStr, fill: item.fill, opacity: item.opacity });
        pattern.append(facet);
        const normal = item.light * Math.PI * 2 + matAngle * Math.PI / 180;
        effects.push((x, y) => facet.setAttribute('opacity', Math.max(.025,
          Math.min(.78, item.opacity + .22 * (x * Math.cos(normal) + y * Math.sin(normal))))));
      }
      const ridges = isUbu ? data.ridgesUbu : data.ridgesCard;
      if (ridges) pattern.append(svgNode('path', { d: ridges, fill: 'none', stroke: '#fff', 'stroke-width': .65, opacity: .38 }));
      for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) {
        if ((x + y * 3) % 4) continue;
        const [px, py] = data.points[y][x];
        const spark = svgNode('path', { d: `M${fmt(px - 5)} ${fmt(py)}h10M${fmt(px)} ${fmt(py - 5)}v10`,
          stroke: '#fff', 'stroke-width': 1.25, 'stroke-linecap': 'round', opacity: 0 });
        pattern.append(spark);
        const phase = (x * 1.7 + y * 2.3 + matAngle * Math.PI / 180);
        effects.push((dx, dy) => {
          const alignment = Math.max(0, Math.cos(phase + dx * 3 + dy * 2));
          spark.setAttribute('opacity', Math.pow(alignment, 22) * Math.min(1, Math.hypot(dx, dy) * 3.4));
        });
      }
    } else {
      const whites = isUbu ? data.whiteUbu : data.whiteCard;
      const blacks = isUbu ? data.blackUbu : data.blackCard;
      for (let i = 0; i < data.bucketOpacities.length; i++) {
        if (whites[i]) pattern.append(svgNode('path', { d: whites[i], fill: '#fff', opacity: data.bucketOpacities[i] }));
        if (blacks[i]) pattern.append(svgNode('path', { d: blacks[i], fill: '#000', opacity: data.bucketOpacities[i] }));
      }
      const ridges = isUbu ? data.ridgesUbu : data.ridgesCard;
      if (ridges) pattern.append(svgNode('path', { d: ridges, fill: 'none', stroke: '#fff', 'stroke-width': .65, opacity: .38 }));
    }
    lighting('luster', [[0, '#fff', .3], [.4, '#fff', 0], [1, '#000', .3]], true);
  } else if (attribute.texture === 'granite') {
    attachBakedPattern(defs, id + '-minerals', 'granite', 144, 144, target => {
      const data = getGraniteData();
      const colors = ['#fff', '#000', '#fff', '#000', '#e3cbbb', '#889098'];
      data.minerals.forEach((d, i) => target.append(svgNode('path', { d, fill: colors[i], opacity: [.22, .32, .4, .17, .18, .22][i] })));
    });
    cover(`url(#${id}-minerals)`);
    lighting('granite-depth', [[0, '#fff', .06], [.5, '#fff', 0], [1, '#000', .13]], true);
  } else if (attribute.texture === 'satin') {
    lighting('satin-depth', [[0, '#fff', .16], [.3, '#fff', .04], [.65, '#000', .03], [1, '#000', .16]], true);
    // Fine silky fibers with alternating thread opacity
    const silk = svgNode('pattern', { id: id + '-silk', patternUnits: 'userSpaceOnUse', width: 48, height: 48 });
    const data = getSatinData();
    for (let i = 0; i < 2; i++) {
      if (data.black[i]) silk.append(svgNode('path', { d: data.black[i], fill: 'none', stroke: '#000000', 'stroke-width': 0.75, opacity: data.opacities[i] }));
      if (data.white[i]) silk.append(svgNode('path', { d: data.white[i], fill: 'none', stroke: '#ffffff', 'stroke-width': 0.75, opacity: data.opacities[i] }));
    }
    defs.append(silk); cover(`url(#${id}-silk)`);
    // Broad curved glints suggest the soft drape of satin rather than metal.
    const silkLight = svgNode('radialGradient', { id: id + '-drape' });
    for (const [offset, opacity] of [[0, .36], [.35, .22], [.7, .06], [1, 0]]) {
      silkLight.append(svgNode('stop', { offset, 'stop-color': '#fff', 'stop-opacity': opacity }));
    }
    defs.append(silkLight);
    for (const [x, y, rx, ry, angle] of [[85, 100, 65, 310, -25], [300, 285, 90, 330, 24]]) {
      pattern.append(svgNode('ellipse', { cx: x, cy: y, rx, ry,
        transform: `rotate(${angle} ${x} ${y})`, fill: `url(#${id}-drape)` }));
    }
    lighting('satin-sheen', [[0, '#fff', 0], [.28, '#fff', .025], [.5, '#fff', .1], [.72, '#fff', .025], [1, '#fff', 0]]);
  } else if (attribute.texture === 'sandstone') {
    const data = getSandstoneData();
    pattern.append(
      svgNode('path', { d: data.strataDark[0], fill: '#000', opacity: .05 }),
      svgNode('path', { d: data.strataDark[1], fill: '#000', opacity: .09 }),
      svgNode('path', { d: data.strataLight[0], fill: '#fff', opacity: .05 }),
      svgNode('path', { d: data.strataLight[1], fill: '#fff', opacity: .09 })
    );
    attachBakedPattern(defs, id + '-sand', 'sandstone', 96, 96, target => {
      data.grains.forEach((d, i) => target.append(svgNode('path', { d, fill: i % 2 ? '#fff' : '#000', opacity: i < 2 ? .28 : .13 })));
    });
    cover(`url(#${id}-sand)`);
    lighting('sandstone-depth', [[0, '#fff', .06], [.5, '#fff', 0], [1, '#000', .1]], true);
  } else if (attribute.texture === 'starfield') {
    lighting('starfield-space', [[0,'#040516',.35],[.6,'#030513',.6],[1,'#000',.8]], true);
    const far=svgNode('g'), near=svgNode('g'), stars=svgNode('g');
    const colors=['#526cbf','#b15add','#408ba8','#d28a9d'];
    const data = getStarfieldData(isUbu);
    data.nebulae.forEach((p, i) => {
      const grad=svgNode('radialGradient',{id:id+'-nebula-'+i});
      for(const [offset,opacity] of [[0,.5],[.35,.23],[1,0]])grad.append(svgNode('stop',{offset,'stop-color':colors[p.colorIdx],'stop-opacity':opacity}));
      defs.append(grad);far.append(svgNode('ellipse',{cx:p.x,cy:p.y,rx:p.rx,ry:p.ry,transform:`rotate(${p.rot} ${p.x} ${p.y})`,fill:`url(#${id}-nebula-${i})`}));
    });
    const dust=svgNode('radialGradient',{id:id+'-depth-dust'});
    for(const [offset,opacity] of [[0,.8],[.45,.38],[1,0]])dust.append(svgNode('stop',{offset,'stop-color':'#030511','stop-opacity':opacity}));
    defs.append(dust);
    for(const d of data.dustEllipses) {
      near.append(svgNode('ellipse',{cx:d.cx,cy:d.cy,rx:d.rx,ry:d.ry,transform:'rotate(-28 180 180)',fill:`url(#${id}-depth-dust)`}));
    }
    if (data.starsWhite) stars.append(svgNode('path', { d: data.starsWhite, fill: '#f4f7ff', opacity: .55 }));
    if (data.starsBlue) stars.append(svgNode('path', { d: data.starsBlue, fill: '#aacbff', opacity: .55 }));
    const wisps=svgNode('filter',{id:id+'-wisps',filterUnits:'userSpaceOnUse',...box,'color-interpolation-filters':'sRGB'});
    wisps.append(svgNode('feTurbulence',{type:'fractalNoise',baseFrequency:'.012 .023',numOctaves:3,seed:67,result:'clouds'}),
      svgNode('feColorMatrix',{in:'clouds',type:'matrix',values:'0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 2 -.45',result:'density'}),
      svgNode('feComposite',{in:'SourceGraphic',in2:'density',operator:'in'}));
    defs.append(wisps);far.setAttribute('filter',`url(#${id}-wisps)`);
    pattern.append(far,near,stars);const starSparkles=sparkle(data.glints,1.1);
    if(effects)effects.push((x,y)=>{
      // Foreground dust moves most; the distant nebula remains almost fixed.
      far.setAttribute('transform',`translate(${-x*3} ${-y*3})`);
      near.setAttribute('transform',`translate(${-x*22} ${-y*22})`);
      stars.setAttribute('transform',`translate(${-x*8} ${-y*8})`);
      for (const group of starSparkles) group.setAttribute('transform',`translate(${-x*8} ${-y*8})`);
    });
  } else if (attribute.texture === 'quartz') {
    lighting('quartz-body', [[0,'#fff',.16],[.5,'#fff',.02],[1,'#000',.18]],true);
    const crystal=svgNode('linearGradient',{id:id+'-crystal',x1:'0%',y1:'0%',x2:'100%',y2:'25%'});
    for(const [offset,color,opacity] of [[0,'#fff',.32],[.24,'#fff',.04],[.55,'#000',.12],[.8,'#fff',.24],[1,'#fff',.06]])
      crystal.append(svgNode('stop',{offset,'stop-color':color,'stop-opacity':opacity}));
    defs.append(crystal);
    const data = getQuartzData(isUbu);
    if (data.dBody) pattern.append(
      svgNode('path', { d: data.dBody, fill: `url(#${id}-crystal)` }),
      svgNode('path', { d: data.dFace1, fill: '#fff', opacity: .14 }),
      svgNode('path', { d: data.dFace2, fill: '#fff', opacity: .32 }),
      svgNode('path', { d: data.dOutlines, fill: 'none', stroke: '#e6f6ff', 'stroke-width': .65, opacity: .35 }),
      svgNode('path', { d: data.dFractures, fill: 'none', stroke: '#fff', 'stroke-width': .5, opacity: .12 })
    );
    sparkle(data.crystalTips);
    lighting('quartz-glint',[[0,'#fff',0],[.3,'#fff',.02],[.45,'#e8faff',.2],[.6,'#fff',.02],[1,'#fff',0]]);
  } else if (attribute.texture === 'obsidian') {
    lighting('obsidian-glass', [[0, '#fff', .08], [.35, '#000', .12], [1, '#000', .55]], true);
    // Broad shell-like fracture surfaces, with glints on selected curved lips.
    const shell = svgNode('linearGradient', { id: id+'-shell', x1: '0%', y1: '0%', x2: '75%', y2: '100%' });
    for (const [offset,color,opacity] of [[0,'#fff',.18],[.12,'#fff',.035],[.55,'#000',.05],[1,'#000',.38]]) {
      shell.append(svgNode('stop', { offset, 'stop-color':color, 'stop-opacity':opacity }));
    }
    defs.append(shell);
    const data = getObsidianData(isUbu);
    if (data.dShells) pattern.append(svgNode('path', { d: data.dShells, fill: `url(#${id}-shell)` }));
    if (data.dLips) pattern.append(svgNode('path', { d: data.dLips, fill: 'none', stroke: '#fff', 'stroke-width': .65, opacity: .12 }));
    lighting('obsidian-reflection', [[0,'#fff',0],[.3,'#fff',.02],[.48,'#fff',.26],[.64,'#fff',.04],[1,'#fff',0]], true,
      { cx:65, cy:35, r:310, gradientTransform:'translate(30 -15) skewX(-25)' });
  } else if (attribute.texture === 'mosaic') {
    cover('rgba(25,23,21,0.4)');
    const glaze = svgNode('linearGradient', { id: id + '-glaze', x1: '0%', y1: '0%', x2: '75%', y2: '100%' });
    for (const [offset, color, opacity] of [[0, '#fff', .3], [.3, '#fff', .04], [.75, '#000', .04], [1, '#000', .16]])
      glaze.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
    defs.append(glaze);
    const data = getMosaicData(isUbu);
    const tilesId = `${id}-tiles`;
    if (data.tiles) {
      defs.append(svgNode('path', { id: tilesId, d: data.tiles }));
      pattern.append(svgNode('use', { href: `#${tilesId}`, fill: attribute.hex }));
    }
    const shadeOpacities = [0.055, 0.09, 0.125, 0.16];
    for (let i = 0; i < 4; i++) {
      if (data.whiteShades[i]) pattern.append(svgNode('path', { d: data.whiteShades[i], fill: '#fff', opacity: shadeOpacities[i] }));
      if (data.blackShades[i]) pattern.append(svgNode('path', { d: data.blackShades[i], fill: '#000', opacity: shadeOpacities[i] }));
    }
    if (data.tiles) {
      pattern.append(
        svgNode('use', { href: `#${tilesId}`, fill: `url(#${id}-glaze)` }),
        svgNode('path', { d: data.topBevels, fill: 'none', stroke: '#fff', 'stroke-width': .85, opacity: .3 }),
        svgNode('path', { d: data.bottomBevels, fill: 'none', stroke: '#000', 'stroke-width': 1.1, opacity: .4 })
      );
    }
  } else if (attribute.texture === 'hammered-metal') {
    lighting('hammered-base', [[0,'#000',.25],[.25,'#fff',.08],[.48,'#fff',.3],[.7,'#000',.08],[1,'#000',.3]]);
    attachBakedPattern(defs, id + '-dents', 'hammered-metal', 160, 160, target => {
      const dentId = id + '-dent';
      const dent = svgNode('linearGradient', { id: dentId, x1: '10%', y1: '0%', x2: '85%', y2: '100%' });
      for (const [offset, color, opacity] of [[0, '#fff', .04], [.2, '#000', .16], [.5, '#000', .025], [.8, '#fff', .15], [1, '#fff', .025]]) {
        dent.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
      }
      target.append(dent);
      const dentFill = `url(#${dentId})`;
      for (const d of getHammeredDentPaths()) target.append(svgNode('path', { d, fill: dentFill }));
    });
    cover(`url(#${id}-dents)`);
  } else if (attribute.texture === 'kintsugi') {
    lighting('kintsugi-glaze',[[0,'#fff',.12],[.5,'#fff',.02],[1,'#000',.2]],true);
    const gold=svgNode('linearGradient',{id:id+'-gold',gradientUnits:'userSpaceOnUse',x1:0,y1:0,x2:300,y2:220,spreadMethod:'reflect'});
    for(const [offset,color] of [[0,'#8b5619'],[.24,'#c79535'],[.45,'#f0d681'],[.49,'#fff1b6'],[.56,'#bf8525'],[1,'#6b4015']])
      gold.append(svgNode('stop',{offset,'stop-color':color}));
    defs.append(gold);
    if(effects) effects.push((x,y)=>gold.setAttribute('gradientTransform',`translate(${x*35} ${y*35})`));
    const data = getKintsugiData(isUbu);
    if (data.whiteTints[0]) pattern.append(svgNode('path', { d: data.whiteTints[0], fill: '#fff', 'fill-opacity': .025 }));
    if (data.whiteTints[1]) pattern.append(svgNode('path', { d: data.whiteTints[1], fill: '#fff', 'fill-opacity': .045 }));
    if (data.blackTints[0]) pattern.append(svgNode('path', { d: data.blackTints[0], fill: '#000', 'fill-opacity': .025 }));
    if (data.blackTints[1]) pattern.append(svgNode('path', { d: data.blackTints[1], fill: '#000', 'fill-opacity': .045 }));
    if (data.dCracks) {
      const cracksId = `${id}-cracks`;
      defs.append(svgNode('path', { id: cracksId, d: data.dCracks }));
      pattern.append(
        svgNode('use', { href: `#${cracksId}`, fill: 'none', stroke: '#382511', 'stroke-width': 3.8, 'stroke-linejoin': 'round' }),
        svgNode('use', { href: `#${cracksId}`, fill: 'none', stroke: `url(#${id}-gold)`, 'stroke-width': 2.25, 'stroke-linejoin': 'round' })
      );
    }
  } else if (attribute.texture === 'leather') {
    lighting('leather-depth', [[0, '#fff', .08], [.4, '#000', .03], [1, '#000', .2]], true);
    attachBakedPattern(defs, id + '-grain', 'leather', 96, 96, target => {
      target.append(svgNode('rect', { width: 96, height: 96, fill: '#000', opacity: .14 }));
      const data = getLeatherData();
      data.cells.forEach((d, i) => target.append(svgNode('path', { d, fill: '#fff', opacity: .04 + i * .02 })));
      target.append(svgNode('path', { d: data.grainGlints, fill: 'none', stroke: '#fff', 'stroke-width': .3, opacity: .07 }));
    });
    cover(`url(#${id}-grain)`);
    lighting('leather-sheen', [[0, '#fff', 0], [.3, '#fff', .02], [.5, '#fff', .07], [.7, '#fff', .02], [1, '#fff', 0]]);
  } else if (attribute.texture === 'carbon-fiber') {
    lighting('carbon-base', [[0, '#000', .35], [.3, '#000', .18], [.5, '#fff', .25], [1, '#000', .45]], true);
    // Tight woven 2x2 checker pattern with alternating reflective strands
    const carbon = svgNode('pattern', { id: id + '-twill', patternUnits: 'userSpaceOnUse', width: 36, height: 36 });
    const data = getCarbonData();
    carbon.append(
      svgNode('path', { d: data.boxHoriz, fill: '#000000', 'fill-opacity': 0.38 }),
      svgNode('path', { d: data.boxVert, fill: '#000000', 'fill-opacity': 0.58 }),
      svgNode('path', { d: data.hWhite, stroke: '#ffffff', 'stroke-width': 0.8, opacity: 0.38 }),
      svgNode('path', { d: data.hBlack, stroke: '#000000', 'stroke-width': 0.8, opacity: 0.22 }),
      svgNode('path', { d: data.vWhite, stroke: '#ffffff', 'stroke-width': 0.8, opacity: 0.18 }),
      svgNode('path', { d: data.vBlack, stroke: '#000000', 'stroke-width': 0.8, opacity: 0.14 })
    );
    defs.append(carbon); cover(`url(#${id}-twill)`);
    lighting('carbon-flash-a', [[0, '#fff', 0], [.38, '#fff', 0], [.46, '#fff', .65], [.5, '#fff', .1], [1, '#fff', 0]]);
    lighting('carbon-flash-b', [[0, '#fff', 0], [.52, '#fff', 0], [.6, '#fff', .45], [.66, '#fff', .08], [1, '#fff', 0]]);
  } else if (attribute.texture === 'denim') {
    lighting('denim-diffuse', [[0, '#fff', .06], [.5, '#000', .02], [1, '#000', .16]], true);
    const twill = svgNode('pattern', { id: id + '-denim', patternUnits: 'userSpaceOnUse', width: 32, height: 32 });
    const data = getDenimData();
    twill.append(
      svgNode('path', { d: data.weft0, stroke: '#fff', 'stroke-width': .65, 'stroke-linecap': 'round', opacity: .16 }),
      svgNode('path', { d: data.weft1, stroke: '#fff', 'stroke-width': .65, 'stroke-linecap': 'round', opacity: .20 }),
      svgNode('path', { d: data.dark0, stroke: '#000', 'stroke-width': .8, 'stroke-linecap': 'round', opacity: .048 }),
      svgNode('path', { d: data.dark1, stroke: '#000', 'stroke-width': .8, 'stroke-linecap': 'round', opacity: .075 }),
      svgNode('path', { d: data.light0, stroke: '#fff', 'stroke-width': .8, 'stroke-linecap': 'round', opacity: .048 }),
      svgNode('path', { d: data.light1, stroke: '#fff', 'stroke-width': .8, 'stroke-linecap': 'round', opacity: .075 })
    );
    defs.append(twill); cover(`url(#${id}-denim)`);
  } else if (attribute.texture === 'bubbled') {
    lighting('bubble-depth', [[0,'#fff',.08],[.5,'#fff',0],[1,'#000',.18]], true);
    const film=svgNode('radialGradient',{id:id+'-film',cx:'45%',cy:'42%',r:'58%'});
    for(const [offset,color,opacity] of [[0,'#fff',0],[.65,'#fff',.015],[.83,'#000',.13],[.94,'#c7d8e4',.25],[1,'#000',.12]])
      film.append(svgNode('stop',{offset,'stop-color':color,'stop-opacity':opacity}));
    const glint=svgNode('radialGradient',{id:id+'-glint'});
    for(const [offset,opacity] of [[0,.8],[.35,.5],[.72,.12],[1,0]]) glint.append(svgNode('stop',{offset,'stop-color':'#fff','stop-opacity':opacity}));
    defs.append(film,glint);
    const reflection = svgNode('g', { id: id+'-reflection' });
    reflection.append(svgNode('ellipse', { cx: -.3, cy: -.45, rx: .32, ry: .13, transform:'rotate(-30 -.3 -.45)', fill:`url(#${id}-glint)` }));
    defs.append(reflection);
    if (effects) effects.push((x,y) => {
      reflection.setAttribute('transform', `translate(${x*.28} ${y*.28}) rotate(${x*18-y*12})`);
      film.setAttribute('cx', `${45+x*15}%`); film.setAttribute('cy', `${42+y*15}%`);
    });
    const data = getBubbledData(isUbu);
    for (const { x, y, r } of data.bubbles) {
      pattern.append(svgNode('circle', { cx: x, cy: y, r, fill: `url(#${id}-film)` }));
      pattern.append(svgNode('use', { href: `#${id}-reflection`, transform: `translate(${x} ${y}) scale(${r})`, opacity: .6 }));
    }
  } else if (attribute.texture === 'lava') {
    lighting('basalt-crust', [[0, '#000', .08], [.5, '#000', .16], [1, '#000', .25]], true);
    const heat=svgNode('radialGradient',{id:id+'-heat'});
    for(const [offset,color,opacity] of [[0,'#ffd16c',.95],[.25,'#ff9c20',.9],[.5,'#ec3a04',.65],[1,'#b72304',0]])
      heat.append(svgNode('stop',{offset,'stop-color':color,'stop-opacity':opacity}));
    defs.append(heat);
    const data = getLavaData(isUbu);
    if (data.platesDark) pattern.append(svgNode('path', { d: data.platesDark, fill: '#000000', 'fill-opacity': 0.22, stroke: '#9e230b', 'stroke-width': 12.5, 'stroke-opacity': .8, 'stroke-linejoin': 'round' }));
    if (data.platesLight) pattern.append(svgNode('path', { d: data.platesLight, fill: '#000000', 'fill-opacity': 0.12, stroke: '#9e230b', 'stroke-width': 12.5, 'stroke-opacity': .8, 'stroke-linejoin': 'round' }));
    if (data.platesAll) {
      const platesId = `${id}-plates`;
      defs.append(svgNode('path', { id: platesId, d: data.platesAll }));
      pattern.append(
        svgNode('use', { href: `#${platesId}`, fill: 'none', stroke: '#f45b0b', 'stroke-width': 5, 'stroke-opacity': .95, 'stroke-linejoin': 'round' }),
        svgNode('use', { href: `#${platesId}`, fill: 'none', stroke: '#ffc34e', 'stroke-width': 1.25, 'stroke-opacity': .8, 'stroke-linejoin': 'round' })
      );
    }
    for (const p of data.meltPockets) {
      pattern.append(svgNode('ellipse', { cx: p.cx, cy: p.cy, rx: p.rx, ry: p.ry, fill: `url(#${id}-heat)` }));
    }
    attachBakedPattern(defs, id + '-crust', 'lava-crust', 96, 96, target => {
      data.dust.forEach((d, i) => target.append(svgNode('path', { d, fill: i ? '#000' : '#b3a09a', opacity: i ? .2 : .14 })));
    });
    cover(`url(#${id}-crust)`);
  } else if (attribute.texture === 'circuitry') {
    lighting('pcb-substrate', [[0,'#fff',.025],[.5,'#000',.04],[1,'#000',.16]], true);
    const board = svgNode('pattern', { id: id + '-board', patternUnits: 'userSpaceOnUse', width: 360, height: 360 });
    const data = getCircuitryData();
    board.append(
      svgNode('path', { d: data.dTraceBacking, fill: 'none', stroke: '#111513', 'stroke-width': 1.8, opacity: .5 }),
      svgNode('path', { d: data.dTraceGold, fill: 'none', stroke: '#958b70', 'stroke-width': .6, opacity: .6 }),
      svgNode('path', { d: data.dTraceSilver, fill: 'none', stroke: '#b7b9ad', 'stroke-width': .6, opacity: .6 }),
      svgNode('path', { d: data.dVias, fill: '#171b18', stroke: '#a49b80', 'stroke-width': .5 }),
      svgNode('path', { d: data.dChips, fill: '#1a1c1c', stroke: '#888b80', 'stroke-width': .55 }),
      svgNode('path', { d: data.dChipPins, stroke: '#b1ae99', 'stroke-width': 1.2 }),
      svgNode('path', { d: data.dMarkings, stroke: '#c7c7b4', 'stroke-width': .5, opacity: .35 }),
      svgNode('path', { d: data.dSmdGold, fill: '#777469', stroke: '#c2b9a1', 'stroke-width': .4 }),
      svgNode('path', { d: data.dSmdDark, fill: '#292c29', stroke: '#c2b9a1', 'stroke-width': .4 })
    );
    defs.append(board); cover(`url(#${id}-board)`);
    lighting('pcb-sheen', [[0,'#fff',.07],[.5,'#fff',.015],[1,'#fff',0]], true);
  } else if (attribute.texture === 'liquid') {
    lighting('liquid-depth', [[0,'#fff',.12],[.4,'#000',.02],[1,'#000',.3]], true);
    // Sample one periodic wave surface; shared normals produce connected reflections.
    const ripples = svgNode('pattern', { id: id + '-ripples', patternUnits: 'userSpaceOnUse', width: 360, height: 360 });
    const tileUrl = prepareLiquidTile();
    if (tileUrl) {
      ripples.append(svgNode('image', { width: 360, height: 360, href: tileUrl }));
    } else {
      const shades = getLiquidShades();
      const soften = svgNode('filter', { id: id + '-ripple-soften', x: '-5%', y: '-5%', width: '110%', height: '110%' });
      soften.append(svgNode('feGaussianBlur', { stdDeviation: .35 })); defs.append(soften);
      const waterSurface = svgNode('g', { filter: `url(#${id}-ripple-soften)` });
      shades.forEach((d, i) => { if (d) waterSurface.append(svgNode('path', { d, fill: i < 9 ? '#000' : '#fff', opacity: i < 9 ? (9 - i) * .025 : (i - 9) * .035 })); });
      ripples.append(waterSurface);
    }
    defs.append(ripples); cover(`url(#${id}-ripples)`);
    animate((x, y, time) => ripples.setAttribute('patternTransform', `translate(${Math.sin(time * .22) * 7 + x * 3} ${Math.cos(time * .17) * 9 + y * 3}) scale(${1 + Math.sin(time * .19) * .025} ${1 + Math.cos(time * .23) * .025})`));
    lighting('liquid-reflection', [[0, '#fff', .03], [.4, '#fff', .13], [.7, '#fff', .02], [1, '#fff', 0]], true);
  }
  defs.append(pattern);
  return `url(#${id})`;
}


function sandstoneEdge(defs, id) {
  const grain = svgNode('pattern', { id, patternUnits: 'userSpaceOnUse', width: 48, height: 48 });
  const data = getSandstoneEdgeData();
  grain.append(
    svgNode('path', { d: data.dark, fill: '#000', opacity: .26 }),
    svgNode('path', { d: data.light, fill: '#fff', opacity: .26 })
  );
  defs.append(grain);
  return `url(#${id})`;
}

const DEFAULT_EDGE_BOUNDS = deepFreeze({ x: 0, y: 0, width: 360, height: 360 });

// Tight bounding box inside `bounds` for shape silhouettes so feMorphology and mask buffers only
// allocate and erode over the feature's actual area instead of the entire canvas.
function shapeBounds(shapes, pad = 4, bounds = DEFAULT_EDGE_BOUNDS) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of shapes) {
    if (getAttr(shape, 'transform')) return { ...bounds };
    const tag = tagOf(shape);
    if (tag === 'circle') {
      const cx = +getAttr(shape, 'cx'), cy = +getAttr(shape, 'cy'), r = +getAttr(shape, 'r');
      if (cx - r < minX) minX = cx - r;
      if (cx + r > maxX) maxX = cx + r;
      if (cy - r < minY) minY = cy - r;
      if (cy + r > maxY) maxY = cy + r;
    } else if (tag === 'rect') {
      const x = +(getAttr(shape, 'x') || 0), y = +(getAttr(shape, 'y') || 0);
      const w = +getAttr(shape, 'width'), h = +getAttr(shape, 'height');
      if (x < minX) minX = x;
      if (x + w > maxX) maxX = x + w;
      if (y < minY) minY = y;
      if (y + h > maxY) maxY = y + h;
    } else if (tag === 'path') {
      const d = getAttr(shape, 'd') || '';
      if (/[aAcCsStThHvVmlq]/.test(d)) return { ...bounds };
      const nums = d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
      if (!nums) return { ...bounds };
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = +nums[i], y = +nums[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    } else {
      return { ...bounds };
    }
  }
  if (!Number.isFinite(minX)) return { ...bounds };
  const x0 = Math.max(bounds.x, Math.floor(minX - pad));
  const y0 = Math.max(bounds.y, Math.floor(minY - pad));
  const x1 = Math.min(bounds.x + bounds.width, Math.ceil(maxX + pad));
  const y1 = Math.min(bounds.y + bounds.height, Math.ceil(maxY + pad));
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

function disjointCircles(shapes) {
  if (!shapes.length || shapes.length > 2) return null;
  const circles = [];
  for (const shape of shapes) {
    if (tagOf(shape) !== 'circle' || getAttr(shape, 'clip-path') || getAttr(shape, 'transform')) return null;
    circles.push({ cx: +getAttr(shape, 'cx'), cy: +getAttr(shape, 'cy'), r: +getAttr(shape, 'r') });
  }
  if (circles.length === 2) {
    const [a, b] = circles;
    if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r) return null;
  }
  return circles;
}

function annulusPath(circles, width) {
  let d = '';
  for (const { cx, cy, r } of circles) {
    const ri = Math.max(0, r - width);
    const rf = fmt2(r), r2f = fmt2(2 * r);
    d += `M${fmt2(cx - r)} ${fmt2(cy)}a${rf} ${rf} 0 1 0 ${r2f} 0a${rf} ${rf} 0 1 0 -${r2f} 0Z`;
    if (ri > 0) {
      const rif = fmt2(ri), ri2f = fmt2(2 * ri);
      d += `M${fmt2(cx - ri)} ${fmt2(cy)}a${rif} ${rif} 0 1 0 ${ri2f} 0a${rif} ${rif} 0 1 0 -${ri2f} 0Z`;
    }
  }
  return d;
}

function disjointRects(shapes) {
  if (!shapes.length) return null;
  const rects = [];
  for (const shape of shapes) {
    if (tagOf(shape) !== 'rect' || getAttr(shape, 'clip-path') || getAttr(shape, 'transform') || getAttr(shape, 'rx') || getAttr(shape, 'ry')) return null;
    const x = +(getAttr(shape, 'x') || 0), y = +(getAttr(shape, 'y') || 0);
    const w = +getAttr(shape, 'width'), h = +getAttr(shape, 'height');
    if (!(w > 0) || !(h > 0)) return null;
    rects.push({ x, y, w, h });
  }
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) return null;
    }
  }
  return rects;
}

function rectBandPath(rects, inner, outer) {
  let d = '';
  for (const { x, y, w, h } of rects) {
    const ow = w - inner * 2, oh = h - inner * 2;
    if (ow <= 0 || oh <= 0) continue;
    d += `M${fmt2(x + inner)} ${fmt2(y + inner)}h${fmt2(ow)}v${fmt2(oh)}h${fmt2(-ow)}Z`;
    const iw = w - outer * 2, ih = h - outer * 2;
    if (iw > 0 && ih > 0) {
      d += `M${fmt2(x + outer)} ${fmt2(y + outer)}h${fmt2(iw)}v${fmt2(ih)}h${fmt2(-iw)}Z`;
    }
  }
  return d;
}

function appendFuzzPattern(defs, key, plush) {
  const fuzz = svgNode('pattern', { id: key + '-fuzz', patternUnits: 'userSpaceOnUse', width: 8, height: 8 });
  fuzz.append(svgNode('path', { d: 'M0 1l2 1M4 0l-1 3M7 3l-2 2M1 6l2-1M5 7l2 1', stroke: '#fff', 'stroke-width': plush ? 1.2 : .65, 'stroke-linecap': 'round' }));
  defs.append(fuzz);
  return `url(#${key}-fuzz)`;
}

function appendStitches(seam, seamContours, plush, leather, scaledMark, strokeScale) {
  const baseDash = plush ? [2, 5] : leather ? [2.5, 2.5] : [3, 3];
  const dashAttr = scaledMark ? baseDash.map(v => +(v * strokeScale).toFixed(2)).join(' ') : baseDash.join(' ');
  const widthAttr = scaledMark ? +(16 * strokeScale).toFixed(2) : 16;
  for (const shape of seamContours) {
    const stitch = shape.cloneNode(true);
    stitch.setAttribute('fill', 'none');
    stitch.setAttribute('stroke', plush ? '#d8caba' : leather ? '#b8a58a' : '#c6a36d');
    stitch.setAttribute('stroke-width', widthAttr);
    stitch.setAttribute('stroke-dasharray', dashAttr);
    stitch.setAttribute('stroke-linecap', 'round');
    seam.append(stitch);
  }
}

function materialEdge(defs, face, shapes, attribute, id, effects, seamContours = shapes, options = null) {
  const bounds = options?.bounds || DEFAULT_EDGE_BOUNDS;
  const region = shapeBounds(shapes, 6, bounds);
  let scaleFactor = 1;
  for (const shape of shapes) {
    const m = /\bscale\(\s*([\d.]+)/.exec(getAttr(shape, 'transform') || '');
    if (m && +m[1] > 0 && +m[1] < scaleFactor) scaleFactor = +m[1];
  }
  const scaledMark = scaleFactor < 0.5;
  const rects = disjointRects(shapes);
  if (['denim', 'leather', 'plush', 'velvet'].includes(attribute.texture)) {
    const plush = attribute.texture === 'plush', velvet = attribute.texture === 'velvet', leather = attribute.texture === 'leather';
    // Erode the union, so the joined eyes have no seam through their overlap.
    // Clip dashed boundary strokes to two inset bands; tiny pupils get a hem only.
    // Back-face scaled oomarks scale erosion bands & inverse-scale stitch stroke-width/dasharray
    // so stitches fall cleanly inside userSpaceOnUse masks without eroding through 6.8px eye rings.
    const small = shapes.every(shape => Number(getAttr(shape, 'r')) > 0 && Number(getAttr(shape, 'r')) <= 17);
    const bandScale = scaledMark ? 0.45 : 1;
    const strokeScale = bandScale / scaleFactor;
    const rawBands = [[0, 0, plush || velvet ? 3 : 2], ...(!small && !velvet ? (plush ? [[1, 2, 6]] : leather ? [[1, 3, 4.5]] : [[1, 3, 4], [2, 6, 7]]) : [])];
    for (const [index, rawInner, rawOuter] of rawBands) {
      const inner = scaledMark ? +(rawInner * bandScale).toFixed(2) : rawInner;
      const outer = scaledMark ? +(rawOuter * bandScale).toFixed(2) : rawOuter;
      const key = `${id}-seam-${index}`;
      if (rects) {
        const band = rectBandPath(rects, inner, outer);
        if (!band) continue;
        if (!index) {
          const seam = svgNode('g', { opacity: velvet ? .48 : plush ? .38 : .2 });
          seam.append(svgNode('path', { d: band, 'fill-rule': 'evenodd', fill: '#000' }));
          if (velvet || plush) seam.append(svgNode('path', { d: band, 'fill-rule': 'evenodd', fill: appendFuzzPattern(defs, key, plush) }));
          face.append(seam);
        } else {
          const clip = svgNode('clipPath', { id: key + '-clip', clipPathUnits: 'userSpaceOnUse' });
          clip.append(svgNode('path', { d: band, 'clip-rule': 'evenodd' }));
          defs.append(clip);
          const seam = svgNode('g', { 'clip-path': `url(#${key}-clip)`, opacity: plush ? .85 : .65 });
          appendStitches(seam, seamContours, plush, leather, scaledMark, strokeScale);
          face.append(seam);
        }
        continue;
      }
      const filter = svgNode('filter', { id: key, filterUnits: 'userSpaceOnUse', ...region });
      filter.append(svgNode('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: inner, result: 'outer' }),
        svgNode('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: outer, result: 'inner' }),
        svgNode('feComposite', { in: 'outer', in2: 'inner', operator: 'out' }));
      const mask = svgNode('mask', { id: key + '-mask', maskUnits: 'userSpaceOnUse', ...region,
        style: 'mask-type:alpha' });
      const union = svgNode('g', { fill: '#fff', filter: `url(#${key})` });
      for (const shape of shapes) union.append(shape.cloneNode(true));
      mask.append(union); defs.append(filter, mask);
      const seam = svgNode('g', { mask: `url(#${key}-mask)`, opacity: index ? (plush ? .85 : .65) : (velvet || plush ? .12 : .2) });
      if (!index) {
        seam.append(svgNode('rect', { ...region, fill: '#000' }));
        if (velvet || plush) {
          seam.setAttribute('opacity', velvet ? .48 : .38);
          seam.append(svgNode('rect', { ...region, fill: appendFuzzPattern(defs, key, plush) }));
        }
      } else {
        appendStitches(seam, seamContours, plush, leather, scaledMark, strokeScale);
      }
      face.append(seam);
    }
    return;
  }
  // Erode the combined silhouette so overlapping eyes never acquire an internal seam.
  const finish = EDGE_FINISHES[attribute.texture];
  if (!finish) return;
  const matAngle = Number.isFinite(attribute?.angle) ? attribute.angle : 0;
  const light = options?.lightBox || { x1: 30, y1: 20, x2: 330, y2: 340, cx: 180, cy: 180, angle: matAngle, shift: 38 };
  const gradient = svgNode('linearGradient', { id: id + '-light', gradientUnits: 'userSpaceOnUse',
    x1: light.x1, y1: light.y1, x2: light.x2, y2: light.y2, gradientTransform: `rotate(${light.angle} ${light.cx} ${light.cy})` });
  for (const [offset, color, opacity] of finish.stops) gradient.append(svgNode('stop', {
    offset, 'stop-color': color, 'stop-opacity': opacity
  }));
  defs.append(gradient);
  if (effects) effects.push((x, y) => gradient.setAttribute('gradientTransform',
    `translate(${x * light.shift} ${y * light.shift}) rotate(${light.angle} ${light.cx} ${light.cy})`));
  const crumbs = attribute.texture === 'sandstone' ? sandstoneEdge(defs, id+'-crumbs') : null;
  const rimScale = scaledMark ? 0.55 : 1;
  // Disjoint unclipped circles and rects need no feMorphology or mask surfaces:
  // an even-odd path draws the exact inset rim directly.
  const circles = !crumbs ? disjointCircles(shapes) : null;
  const analytic = circles ? w => annulusPath(circles, w) : rects ? w => rectBandPath(rects, 0, w) : null;
  if (analytic) {
    for (const [index, rawWidth] of [finish.width, finish.rim].entries()) {
      const width = scaledMark ? +(rawWidth * rimScale).toFixed(2) : rawWidth;
      const d = analytic(width);
      if (!d) continue;
      face.append(svgNode('path', {
        d,
        'fill-rule': 'evenodd',
        fill: `url(#${id}-light)`,
        opacity: index ? .8 : attribute.texture === 'granite' ? .68 : .38
      }));
      if (crumbs && !index) face.append(svgNode('path', { d, 'fill-rule': 'evenodd', fill: crumbs }));
    }
    return;
  }
  for (const [index, rawWidth] of [finish.width, finish.rim].entries()) {
    const width = scaledMark ? +(rawWidth * rimScale).toFixed(2) : rawWidth;
    const key = id + '-' + index;
    const filter = svgNode('filter', { id: key + '-cut', filterUnits: 'userSpaceOnUse',
      ...region, 'color-interpolation-filters': 'sRGB' });
    filter.append(svgNode('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: Math.max(.5, width), result: 'inset' }));
    if (crumbs) filter.append(
      svgNode('feTurbulence', { type:'fractalNoise', baseFrequency:.28, numOctaves:2, seed:317, result:'grain' }),
      svgNode('feDisplacementMap', { in:'inset', in2:'grain', scale:(index ? 1.4 : 4) * rimScale, xChannelSelector:'R', yChannelSelector:'G', result:'inset' }));
    filter.append(svgNode('feComposite', { in: 'SourceGraphic', in2: 'inset', operator: 'out' }));
    const mask = svgNode('mask', { id: key + '-mask', maskUnits: 'userSpaceOnUse',
      maskContentUnits: 'userSpaceOnUse', ...region });
    const silhouette = svgNode('g', { fill: '#fff', filter: `url(#${key}-cut)` });
    for (const shape of shapes) silhouette.append(shape.cloneNode(true));
    mask.append(silhouette); defs.append(filter, mask);
    face.append(svgNode('rect', { ...region, fill: `url(#${id}-light)`,
      mask: `url(#${key}-mask)`, opacity: index ? .8 : attribute.texture === 'granite' ? .68 : .38 }));
    if (crumbs && !index) face.append(svgNode('rect', { ...region, fill:crumbs, mask:`url(#${key}-mask)` }));
  }
}
  return { svgNode, material, materialEdge, sandstoneEdge, shapeBounds, disjointCircles, annulusPath, disjointRects, rectBandPath };
}

module.exports = { createMaterialPainter };
