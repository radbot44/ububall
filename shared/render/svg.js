/* Ubu SVG composition, enamel tokens, card material bars, surface lighting, and WebP sprite cache. */
'use strict';
const {
  ubuMod, NS, roles, DESIGNED, fmt, fmt2, getAttr, tagOf, parseHexRgb, EDGE_FINISHES
} = require('./generators.js');
const { createMaterialPainter } = require('./materials.js');

function createUbuRenderer(rawEnv = globalThis) {
  const env = rawEnv === globalThis ? globalThis : new Proxy(rawEnv, { get: (t, k) => k in t ? t[k] : globalThis[k] });
  let serial = 0;
  const { svgNode, material, materialEdge, sandstoneEdge, shapeBounds, disjointCircles, annulusPath, disjointRects, rectBandPath } = createMaterialPainter(env);
function enamelMetal(defs, prefix, grade, effects) {
  // Match the card lettering's grade palette; ordinary grades use satin nickel.
  const palettes = {
    S: [[0, '#fff0d4'], [.34, '#ffc885'], [.48, '#ae6331'], [.52, '#ffe0ad'], [.8, '#ff9954'], [1, '#ffe0ad']],
    'S+': [[0, '#fff3dd'], [.38, '#ffbd89'], [.48, '#aa4f54'], [.51, '#ffe3cf'], [.76, '#ff8dac'], [1, '#ffc48b']],
    U: [[0, '#ffda65'], [.16, '#c350f2'], [.28, '#6431bd'], [.38, '#fff3cf'], [.58, '#ff54b7'], [.82, '#ffc94f'], [1, '#fff3cf']],
    UBU: [[0, '#ffda65'], [.16, '#c350f2'], [.28, '#6431bd'], [.38, '#fff3cf'], [.58, '#ff54b7'], [.82, '#ffc94f'], [1, '#fff3cf']]
  };
  const id = prefix + '-metal';
  const gradient = svgNode('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: 15, y1: 0, x2: 345, y2: 360 });
  for (const [offset, color] of palettes[grade] || [[0, '#f3eee4'], [.25, '#b7b7b2'], [.46, '#727679'], [.5, '#fff8e9'], [.65, '#bfc1be'], [1, '#73787c']]) {
    gradient.append(svgNode('stop', { offset, 'stop-color': color }));
  }
  defs.append(gradient);
  if (effects) effects.push((x, y) => gradient.setAttribute('gradientTransform', `translate(${x * 35} ${y * 35}) rotate(${x * 12 - y * 8} 180 180)`));
  return `url(#${id})`;
}
function enamelDivider(defs, face, shapes, id, metal) {
  const circles = disjointCircles(shapes);
  if (circles) {
    face.append(svgNode('path', { d: annulusPath(circles, 1.25), 'fill-rule': 'evenodd', fill: metal }));
    return;
  }
  const region = shapeBounds(shapes, 4);
  // Erode the filled union, including lid clips and mouth holes. No seam
  // appears inside overlapping eyes, and later layers hide covered borders.
  const filter = svgNode('filter', { id, filterUnits: 'userSpaceOnUse', ...region });
  filter.append(svgNode('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: 1.25, result: 'inside' }),
    svgNode('feComposite', { in: 'SourceAlpha', in2: 'inside', operator: 'out' }));
  const mask = svgNode('mask', { id: id + '-mask', maskUnits: 'userSpaceOnUse', ...region, style: 'mask-type:alpha' });
  const union = svgNode('g', { fill: '#fff', filter: `url(#${id})` });
  for (const shape of shapes) union.append(shape.cloneNode(true));
  mask.append(union); defs.append(filter, mask);
  face.append(svgNode('rect', { ...region, fill: metal, mask: `url(#${id}-mask)` }));
}
function enamelBody(svg, face, metal) {
  svg.setAttribute('viewBox', '-12 -12 384 404');
  // The back is offset downwards to expose a shallow metal sidewall.
  const body = svgNode('g');
  body.append(svgNode('circle', { cx: 180, cy: 187, r: 181, fill: metal }),
    svgNode('circle', { cx: 180, cy: 187, r: 181, fill: '#000', opacity: .3 }),
    svgNode('circle', { cx: 180, cy: 180, r: 181, fill: metal, stroke: '#fff', 'stroke-opacity': .3, 'stroke-width': .7 }));
  svg.insertBefore(body, face);
}
function enamelCoat(defs, face, prefix, effects) {
  const coatId = prefix + '-enamel-coat';
  const coat = svgNode('linearGradient', { id: coatId, gradientUnits: 'userSpaceOnUse', x1: 35, y1: 0, x2: 300, y2: 360 });
  for (const [offset, opacity] of [[0, .22], [.22, .05], [.35, .02], [.43, .16], [.5, .025], [.8, 0], [1, .08]]) {
    coat.append(svgNode('stop', { offset, 'stop-color': '#fff', 'stop-opacity': opacity }));
  }
  defs.append(coat);
  face.append(svgNode('circle', { cx: 180, cy: 180, r: 176, fill: `url(#${coatId})`, 'pointer-events': 'none' }),
    svgNode('circle', { cx: 180, cy: 180, r: 175.5, fill: 'none', stroke: '#000', 'stroke-opacity': .28, 'stroke-width': 1 }));
  if (effects) effects.push((x, y) => coat.setAttribute('gradientTransform', `translate(${x * 25} ${y * 25})`));
}
function renderSVG(m, className = 'oomark', surface = null, extraEffects = null, enamel = false) {
  const effects = className === 'oomark' || enamel ? (extraEffects || []) : null;
  const prefix = 'ubu-' + (++serial);
  const svg = svgNode('svg', { class: className, viewBox: '0 0 360 360', role: 'img', 'aria-label': `${m.parts.fullName}, Ubuquity ${m.grade}` });
  const title = svgNode('title'); title.textContent = `${m.parts.fullName} · ${m.grade}`;
  const defs = svgNode('defs');
  const bounds = svgNode('clipPath', { id: prefix + '-bounds', clipPathUnits: 'userSpaceOnUse' });
  bounds.append(svgNode('circle', { cx: 180, cy: 180, r: 176 })); defs.append(bounds);
  const face = svgNode('g', { 'clip-path': `url(#${prefix}-bounds)` });
  svg.append(title, defs, face);
  const metal = enamel ? enamelMetal(defs, prefix, m.grade, effects) : null;
  if (enamel) enamelBody(svg, face, metal);
  const eyePositions = [[120.55, 145.5, m.eyes.left], [239.44, 145.5, m.eyes.right]];
  const eyeShapes = eyePositions.map(([cx, cy, eye], i) => {
    const shape = svgNode('circle', { cx, cy, r: 66.05 });
    if (!eye.planes.length) return shape;
    const id = prefix + '-lid-' + i;
    const clip = svgNode('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
    clip.append(svgNode('polygon', { points: ubuMod.eyePolygon(eye).map(([x, y]) => `${cx + x},${cy + y}`).join(' ') }));
    defs.append(clip);
    shape.setAttribute('clip-path', `url(#${id})`);
    return shape;
  });
  const shapes = {
    background: [svgNode('circle', { cx: 180, cy: 180, r: 176 })],
    eyes: eyeShapes,
    irises: eyePositions.map(([x, y, eye]) => svgNode('circle', { cx: x + eye.dx, cy: y + eye.dy, r: 30.7126 })),
    pupils: eyePositions.map(([x, y, eye]) => svgNode('circle', { cx: x + eye.dx, cy: y + eye.dy, r: 17 })),
    mouth: [svgNode('path', { d: ubuMod.mouthPath(m.mouth) })]
  };
  let matteFill;
  for (const role of roles) {
    const attribute = m.attributes[role];
    const layer = svgNode('g', { fill: attribute.hex });
    layer.append(...shapes[role]); face.append(layer);
    const clipId = prefix + '-' + role + '-clip';
    const clip = svgNode('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
    for (const shape of shapes[role]) clip.append(shape.cloneNode(true));
    defs.append(clip);
    const designed = DESIGNED.has(attribute.texture);
    const fill = designed
      ? material(defs, attribute, prefix + '-' + role + '-texture', effects)
      : (matteFill ||= material(defs, { texture: 'matte', angle: 0 }, prefix + '-matte', effects));
    const fillBox = shapeBounds(shapes[role], 2);
    face.append(svgNode('rect', { ...fillBox, fill, 'clip-path': `url(#${clipId})` }));
    if (enamel) {
      if (role !== 'background') enamelDivider(defs, face, shapes[role], prefix + '-divider-' + role, metal);
    } else if (designed) {
      const contours = [...shapes[role]];
      if (role === 'eyes' && ['denim','leather','plush'].includes(attribute.texture)) {
        for (const [cx, cy, eye] of eyePositions) if (eye.planes.length) {
          // The union mask trims these lid contours to the actual eye boundary.
          contours.push(svgNode('polygon', { points: ubuMod.eyePolygon(eye).map(([x, y]) => `${cx+x},${cy+y}`).join(' ') }));
        }
      }
      materialEdge(defs, face, shapes[role], attribute, prefix + '-' + role + '-edge', effects, contours);
    }
  }
  if (enamel) {
    enamelCoat(defs, face, prefix, effects);
    attachLighting(svg, effects, surface || svg);
    return svg;
  }
  tokenEdge(defs, face, prefix, m, effects);
  if (effects) attachLighting(svg, effects, surface || svg);
  return svg;
}
// Keep the face flat; only the narrow perimeter rolls into the token edge.
// This overlays the complete face without changing any DNA-derived paths.
function tokenEdge(defs, face, prefix, m, effects) {
  const edgeId = prefix + '-token-edge';
  const edge = svgNode('radialGradient', { id: edgeId, gradientUnits: 'userSpaceOnUse', cx: 178, cy: 176, r: 180 });
  edge.append(
    svgNode('stop', { offset: '0%', 'stop-color': '#000', 'stop-opacity': 0 }),
    svgNode('stop', { offset: '94%', 'stop-color': '#000', 'stop-opacity': 0 }),
    svgNode('stop', { offset: '98%', 'stop-color': '#000', 'stop-opacity': .13 }),
    svgNode('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': .32 })
  );
  const rimId = prefix + '-token-rim';
  const rim = svgNode('linearGradient', { id: rimId, x1: 0, y1: 0, x2: 1, y2: 1 });
  for (const [offset, color, opacity] of [[0, '#fff', .44], [.4, '#fff', .07], [.65, '#000', .06], [1, '#000', .28]]) {
    rim.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
  }
  defs.append(edge, rim);
  face.append(svgNode('circle', { cx: 180, cy: 180, r: 176, fill: `url(#${edgeId})`, 'pointer-events': 'none' }),
    svgNode('circle', { cx: 180, cy: 180, r: 174.5, fill: 'none', stroke: `url(#${rimId})`, 'stroke-width': ['velvet','plush'].includes(m.attributes.background.texture) ? 0 : 3, 'pointer-events': 'none' }));
  if (effects) {
    effects.push((x, y) => {
      rim.setAttribute('x1', String(x * .15));
      rim.setAttribute('y1', String(y * .15));
    });
  }
}
// Back mark centres sit on a true hex grid (rows √3/2 apart, so every neighbour is one 68-unit
// cell away); two rings around the centre mark make a 19-mark hexagon inside a plain margin.
// Each mark turns a quarter from every mark it touches.
const BACK_MARKS = [], BACK_MARK_SCALE = (.85 * 68 / 299).toFixed(5);
for (let row = -2; row <= 2; row++) {
  const odd = ((row % 2) + 2) % 2, count = 5 - Math.abs(row);
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * 68, col = Math.round((x - odd * 34) / 68);
    BACK_MARKS.push({ x: 180 + x, y: +(180 + row * 34 * Math.sqrt(3)).toFixed(2), turn: (((col % 4) + 4) % 4 + 2 * odd) % 4 * 90 });
  }
}
// Paints a back's oomarks: rings in the eye colour and bar in the mouth colour (irises and
// pupils are not used), each with its material, on the background colour and material.
// Enamel backs set each cell in metal; plain backs get the front's material edges.
function paintBack(defs, face, prefix, m, effects, metal = null) {
  const ring = (cx, cy) => `M${cx - 66.0487} ${cy}a66.0487 66.0487 0 1 0 132.0974 0a66.0487 66.0487 0 1 0 -132.0974 0Z`
    + `M${cx - 30.7126} ${cy}a30.7126 30.7126 0 1 0 61.4252 0a30.7126 30.7126 0 1 0 -61.4252 0Z`;
  const shapes = { background: [svgNode('circle', { cx: 180, cy: 180, r: 176 })], eyes: [], mouth: [] };
  for (const { x, y, turn } of BACK_MARKS) {
    const transform = `translate(${x} ${y}) rotate(${turn}) scale(${BACK_MARK_SCALE})`;
    // The rings overlap, so each is its own even-odd path; one path would cancel the overlap.
    for (const cx of [-59.45, 59.44]) shapes.eyes.push(svgNode('path', { d: ring(cx, -34.508), 'fill-rule': 'evenodd', 'clip-rule': 'evenodd', transform }));
    shapes.mouth.push(svgNode('rect', { x: -75.9625, y: 47.54205, width: 151.915, height: 53.0061, transform }));
  }
  let matteFill;
  for (const role of ['background', 'eyes', 'mouth']) {
    const attribute = m.attributes[role], clipId = `${prefix}-${role}-clip`, designed = DESIGNED.has(attribute.texture);
    const layer = svgNode('g', { fill: attribute.hex }), clip = svgNode('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
    layer.append(...shapes[role]);
    for (const shape of shapes[role]) clip.append(shape.cloneNode(true));
    defs.append(clip);
    const texture = designed
      ? material(defs, attribute, `${prefix}-${role}-texture`, effects)
      : (matteFill ||= material(defs, { texture: 'matte', angle: 0 }, `${prefix}-matte`, effects));
    face.append(layer, svgNode('rect', { x: 0, y: 0, width: 360, height: 360, fill: texture, 'clip-path': `url(#${clipId})` }));
    if (metal) { if (role !== 'background') enamelDivider(defs, face, shapes[role], `${prefix}-divider-${role}`, metal); }
    else if (designed) materialEdge(defs, face, shapes[role], attribute, `${prefix}-${role}-edge`, effects);
  }
}
// The canonical back: the ubu's colours as a hexagon of oomarks inside a plain margin, with the
// front's rolled edge. Light effects join the front's, so both faces share one light.
function renderBack(m, effects = null) {
  const prefix = 'ubu-back-' + (++serial);
  const svg = svgNode('svg', { class: 'ubu-back', viewBox: '0 0 360 360', 'aria-hidden': 'true' });
  const defs = svgNode('defs'), face = svgNode('g', { 'clip-path': `url(#${prefix}-bounds)` });
  const bounds = svgNode('clipPath', { id: prefix + '-bounds', clipPathUnits: 'userSpaceOnUse' });
  bounds.append(svgNode('circle', { cx: 180, cy: 180, r: 176 })); defs.append(bounds);
  svg.append(defs, face);
  paintBack(defs, face, prefix, m, effects);
  tokenEdge(defs, face, prefix, m, effects);
  svg.style.filter = 'drop-shadow(0px 8px 9px #0005)';
  return svg;
}
// The token's back: the same marks as enamel cells set in metal on the background enamel.
function renderTokenBack(m, effects = null) {
  const prefix = 'ubu-token-back-' + (++serial);
  const svg = svgNode('svg', { class: 'enamel-token token-back', viewBox: '0 0 360 360', 'aria-hidden': 'true' });
  const defs = svgNode('defs'), face = svgNode('g', { 'clip-path': `url(#${prefix}-bounds)` });
  const bounds = svgNode('clipPath', { id: prefix + '-bounds', clipPathUnits: 'userSpaceOnUse' });
  bounds.append(svgNode('circle', { cx: 180, cy: 180, r: 176 })); defs.append(bounds);
  svg.append(defs, face);
  const metal = enamelMetal(defs, prefix, m.grade, effects);
  enamelBody(svg, face, metal);
  paintBack(defs, face, prefix, m, effects, metal);
  enamelCoat(defs, face, prefix, effects);
  return svg;
}
const surfaceControllers = new WeakMap();
function attachLighting(svg, effects, surface) {
  surfaceControllers.get(surface)?.();
  const reduced = env.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, x = 0, y = 0, targetX = 0, targetY = 0, rect = null, lastPaint = 0;
  let wasConnected = Boolean(surface.isConnected), disposed = false;
  const idle = effects.idle || [];
  function visible() {
    if (surface.isConnected) wasConnected = true;
    else if (wasConnected) { cleanup(); return false; }
    const dialog = typeof surface.closest === 'function' ? surface.closest('dialog') : null;
    const bounds = surface.getBoundingClientRect();
    return bounds.bottom > 0 && bounds.right > 0 && bounds.top < env.innerHeight && bounds.left < env.innerWidth && surface.isConnected && !env.document.hidden && (!dialog || dialog.open) && surface.getClientRects().length > 0;
  }
  svg.style.filter = 'drop-shadow(0px 8px 9px #0005)';
  function paint(time) {
    frame = 0;
    if (disposed || !visible()) return;
    if (idle.length && time - lastPaint < 32) { frame = env.requestAnimationFrame(paint); return; }
    lastPaint = time;
    const moving = x !== targetX || y !== targetY;
    x += (targetX - x) * .18; y += (targetY - y) * .18;
    const settled = Math.abs(targetX - x) + Math.abs(targetY - y) < .001;
    if (settled) { x = targetX; y = targetY; }
    surface.style.transform = `perspective(700px) rotateX(${-y * 12}deg) rotateY(${x * 12}deg)`;
    if (surface !== svg && typeof surface.style?.setProperty === 'function') {
      surface.style.setProperty('--light-x', `${50 + x * 45}%`);
      surface.style.setProperty('--light-y', `${50 + y * 45}%`);
    }
    svg.style.filter = `drop-shadow(${-x * 9}px ${8 - y * 6}px 9px #0005)`;
    if (moving || reduced.matches) for (const effect of effects) effect(x, y);
    for (const effect of idle) effect(x, y, reduced.matches ? 0 : time / 1000);
    if (!settled || (idle.length && !reduced.matches)) frame = env.requestAnimationFrame(paint);
  }
  const schedule = () => {
    if (disposed) return;
    if (surface.isConnected) wasConnected = true;
    else if (wasConnected) { cleanup(); return; }
    if (!frame && visible()) frame = env.requestAnimationFrame(paint);
  };
  const invalidateRect = () => { rect = null; };
  function reset() { targetX = targetY = 0; schedule(); }
  function enter() { rect = surface.getBoundingClientRect(); }
  function down(event) {
    rect = surface.getBoundingClientRect();
    if (event.pointerType === 'touch') {
      try { surface.setPointerCapture(event.pointerId); } catch {}
      move(event);
    }
  }
  function move(event) {
    if (disposed || reduced.matches) return;
    if (event.pointerType === 'touch' && event.buttons === 0) return;
    if (!rect) rect = surface.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    targetX = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
    targetY = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
    schedule();
  }
  function up(event) {
    if (event.pointerType === 'touch') {
      try { surface.releasePointerCapture(event.pointerId); } catch {}
      reset();
    }
  }
  function leave(event) {
    if (event.pointerType !== 'touch') reset();
  }
  function cancel(event) {
    try { surface.releasePointerCapture(event.pointerId); } catch {}
    reset();
  }
  surface.addEventListener('pointerenter', enter);
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerup', up);
  surface.addEventListener('pointerleave', leave);
  surface.addEventListener('pointercancel', cancel);
  function preferenceChanged() {
    if (reduced.matches) targetX = targetY = x = y = 0;
    schedule();
  }
  const visibility = new env.MutationObserver(schedule);
  if (env.document.body) visibility.observe(env.document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['open','hidden'] });
  const intersection = new env.IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) schedule();
    else { env.cancelAnimationFrame(frame); frame = 0; }
  });
  intersection.observe(surface);
  env.document.addEventListener('visibilitychange', schedule);
  env.queueMicrotask(schedule);
  reduced.addEventListener('change', preferenceChanged);
  env.window.addEventListener('blur', reset);
  env.window.addEventListener('resize', invalidateRect);
  env.window.addEventListener('scroll', invalidateRect, true);
  function cleanup() {
    if (disposed) return;
    disposed = true;
    if (surfaceControllers.get(surface) === cleanup) surfaceControllers.delete(surface);
    env.cancelAnimationFrame(frame); frame = 0;
    visibility.disconnect(); intersection.disconnect();
    if (typeof env.document.removeEventListener === 'function') env.document.removeEventListener('visibilitychange', schedule);
    surface.removeEventListener('pointerenter', enter);
    surface.removeEventListener('pointerdown', down);
    surface.removeEventListener('pointermove', move);
    surface.removeEventListener('pointerup', up);
    surface.removeEventListener('pointerleave', leave);
    surface.removeEventListener('pointercancel', cancel);
    reduced.removeEventListener('change', preferenceChanged);
    env.window.removeEventListener('blur', reset);
    env.window.removeEventListener('resize', invalidateRect);
    env.window.removeEventListener('scroll', invalidateRect, true);
  }
  surfaceControllers.set(surface, cleanup);
  svg.disposeLighting = cleanup;
}
function renderCardMaterials(m, effects = null) {
  const CARD_ROLES = ['background', 'eyes', 'mouth', 'irises', 'pupils'];
  const layers = [];
  for (const role of CARD_ROLES) {
    const attr = m.attributes?.[role];
    if (attr?.texture && attr.texture !== 'matte') {
      layers.push({
        role,
        mat: attr,
        // Opposite angles share one stripe orientation and offset sequence.
        angle: ((attr.angle ?? 45) % 180 + 180) % 180
      });
    }
  }
  if (!layers.length) return null;

  const angleCounts = new Map();
  for (const layer of layers) {
    angleCounts.set(layer.angle, (angleCounts.get(layer.angle) || 0) + 1);
  }
  const angleIndices = new Map();
  for (const layer of layers) {
    const idx = angleIndices.get(layer.angle) || 0;
    layer.angleIndex = idx;
    layer.angleTotal = angleCounts.get(layer.angle);
    angleIndices.set(layer.angle, idx + 1);
  }

  const prefix = 'card-mat-' + (++serial);
  const svg = svgNode('svg', {
    class: 'card-materials',
    viewBox: '0 0 480 320',
    preserveAspectRatio: 'xMidYMid slice',
    'aria-hidden': 'true'
  });
  const defs = svgNode('defs');
  svg.append(defs);

  const boundsId = `${prefix}-bounds`;
  const bounds = svgNode('clipPath', { id: boundsId, clipPathUnits: 'userSpaceOnUse' });
  bounds.append(svgNode('rect', { x: 0, y: 0, width: 480, height: 320, rx: 16, ry: 16 }));
  defs.append(bounds);

  const face = svgNode('g', { 'clip-path': `url(#${boundsId})` });
  svg.append(face);

  const S = 44;
  const span = 420;
  // Keep the original generous mask bounds: some browsers clip transformed
  // masks differently when their region is tightened to the card's outline.
  const region = { x: -span, y: -span, width: span * 2 + 480, height: span * 2 + 320 };

  function getLayerRects(layer) {
    const { angleIndex, angleTotal } = layer;
    const cycle = S * 2 * angleTotal;
    const offset = angleIndex * S * 2;
    const start = -Math.ceil((span + cycle) / cycle) * cycle;
    const rects = [];
    for (let base = start; base <= span + 480; base += cycle) {
      rects.push({ x: base + offset, y: -span, width: S, height: span * 2 + 320 });
    }
    return rects;
  }

  for (let i = 0; i < layers.length; i++) {
    layers[i].rects = getLayerRects(layers[i]);
  }

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const { mat, angle, rects } = layer;
    const patId = `${prefix}-pat-${i}`;
    let layerEffects = null;
    if (effects) {
      layerEffects = [];
      layerEffects.idle = effects.idle;
    }
    const fill = material(defs, { ...mat, angle: (mat.angle ?? 45) - angle }, patId, layerEffects, 240, 160);

    const group = svgNode('g', {
      transform: `rotate(${angle} 240 160)`
    });

    // Mask out upper layers so lower layers are never visible beneath upper translucent stripes
    const upperLayers = layers.slice(i + 1);
    if (upperLayers.length > 0) {
      const maskId = `${prefix}-mask-${i}`;
      const mask = svgNode('mask', {
        id: maskId,
        maskUnits: 'userSpaceOnUse', ...region
      });
      mask.append(svgNode('rect', { ...region, fill: '#fff' }));
      for (const upper of upperLayers) {
        const upperGroup = svgNode('g', {
          transform: `rotate(${upper.angle - angle} 240 160)`
        });
        for (const r of upper.rects) {
          upperGroup.append(svgNode('rect', {
            x: r.x, y: r.y, width: r.width, height: r.height, fill: '#000'
          }));
        }
        mask.append(upperGroup);
      }
      defs.append(mask);
      group.setAttribute('mask', `url(#${maskId})`);
    }

    // Compound paths keep the same stripe geometry but rasterize each
    // expensive SVG material pattern once per layer, not once per stripe.
    const stripes = rects.map(r =>
      `M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}Z`).join('');
    group.append(
      svgNode('path', { d: stripes, fill: mat.hex, opacity: .65 }),
      svgNode('path', { d: stripes, fill })
    );

    const rectShapes = rects.map(r => svgNode('rect', { x: r.x, y: r.y, width: r.width, height: r.height }));
    materialEdge(defs, group, rectShapes, mat, `${prefix}-edge-${i}`, layerEffects, rectShapes, {
      bounds: region,
      lightBox: { x1: 60, y1: 0, x2: 420, y2: 320, cx: 240, cy: 160, angle: -angle, shift: 30 }
    });

    if (effects && layerEffects.length) {
      const rad = angle * Math.PI / 180, cosA = Math.cos(rad), sinA = Math.sin(rad);
      effects.push((x, y) => {
        const gx = x * cosA + y * sinA, gy = -x * sinA + y * cosA;
        for (const fn of layerEffects) fn(gx, gy);
      });
    }

    face.append(group);
  }

  return svg;
}

// Bounded session cache of rasterized static ubu sprites, shared across Collection, Team Picker,
// Match sidebars, formation slots, lineup previews and Designer thumbnails. Rasterizing once to
// a PNG Blob URL releases the intermediate SVG filter/mask/pattern tree and prevents Blink/WebKit
// from re-running SVG filters when scrolling large collections.
const MAX_SPRITES = 2048;
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const spriteCache = new Map();
const bakeQueue = [];
let activeBakes = 0;
const MAX_CONCURRENT_BAKES = typeof env.matchMedia === 'function' && env.matchMedia('(pointer: coarse)').matches ? 1 : 2;
const SPRITE_WEBP_QUALITY = 0.88;

function pumpBakes() {
  while (activeBakes < MAX_CONCURRENT_BAKES && bakeQueue.length) {
    const job = bakeQueue.shift();
    activeBakes++;
    job(() => { activeBakes--; pumpBakes(); });
  }
}

function revokeSpriteEntry(entry) {
  if (!entry) return;
  entry.evicted = true;
  if (typeof entry.url === 'string' && entry.url.startsWith('blob:') && typeof env.URL !== 'undefined' && typeof env.URL.revokeObjectURL === 'function') {
    env.URL.revokeObjectURL(entry.url);
    entry.url = null;
  }
}

function spriteKey(m, size) {
  if (m?.dna instanceof Uint8Array && m.dna.length >= 47) {
    let key = size + ':';
    for (let i = 8; i < 47; i++) key += (m.dna[i] < 16 ? '0' : '') + m.dna[i].toString(16);
    if (m.attributes) {
      for (const role of roles) {
        const a = m.attributes[role];
        if (a) key += `|${a.hex || ''},${a.angle ?? 0},${a.texture || ''}`;
      }
    }
    return key;
  }
  return size + ':' + JSON.stringify([m?.attributes, m?.eyes, m?.mouth]);
}

function renderSprite(m, size = 256, maxEntries = MAX_SPRITES) {
  const key = spriteKey(m, size);
  const hit = spriteCache.get(key);
  if (hit) {
    spriteCache.delete(key);
    spriteCache.set(key, hit);
    return hit.url ? Promise.resolve(hit.url) : hit.promise;
  }
  if (typeof env.XMLSerializer === 'undefined' || typeof env.document === 'undefined') return Promise.resolve(null);
  const limit = Math.max(1, maxEntries | 0);
  while (spriteCache.size >= limit) {
    const oldestKey = spriteCache.keys().next().value;
    revokeSpriteEntry(spriteCache.get(oldestKey));
    spriteCache.delete(oldestKey);
  }
  const entry = { url: null, promise: null, evicted: false };
  entry.promise = new Promise(resolve => {
    bakeQueue.push(done => {
      const svg = renderSVG(m, 'ubu-sprite');
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
      const xml = new env.XMLSerializer().serializeToString(svg);
      const dataUrl = () => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      const finish = (url, isBlob = false) => {
        if (entry.evicted) {
          if (isBlob && typeof env.URL !== 'undefined' && typeof env.URL.revokeObjectURL === 'function') env.URL.revokeObjectURL(url);
          resolve(dataUrl());
          done();
          return;
        }
        entry.url = url;
        resolve(url);
        done();
      };
      const fallback = () => finish(dataUrl(), false);
      if (typeof env.Blob === 'undefined' || typeof env.URL === 'undefined' || typeof env.URL.createObjectURL !== 'function' || typeof env.Image === 'undefined') {
        fallback();
        return;
      }
      const svgUrl = env.URL.createObjectURL(new env.Blob([xml], { type: 'image/svg+xml' }));
      const image = new env.Image();
      image.decoding = 'async';
      image.onload = () => {
        env.URL.revokeObjectURL(svgUrl);
        try {
          if (typeof OffscreenCanvas !== 'undefined') {
            const off = new OffscreenCanvas(size, size);
            const ctx = off.getContext('2d');
            if (ctx && typeof off.convertToBlob === 'function') {
              ctx.drawImage(image, 0, 0, size, size);
              off.convertToBlob({ type: 'image/webp', quality: SPRITE_WEBP_QUALITY }).catch(() => off.convertToBlob({ type: 'image/png' })).then(blob => {
                finish(env.URL.createObjectURL(blob), true);
              }, fallback);
              return;
            }
          }
          const canvas = env.document.createElement('canvas');
          canvas.width = canvas.height = size;
          const ctx = canvas.getContext('2d');
          if (!ctx || typeof canvas.toBlob !== 'function') { fallback(); return; }
          ctx.drawImage(image, 0, 0, size, size);
          canvas.toBlob(blob => {
            if (!blob) { fallback(); return; }
            finish(env.URL.createObjectURL(blob), true);
          }, 'image/webp', SPRITE_WEBP_QUALITY);
        } catch {
          fallback();
        }
      };
      image.onerror = () => {
        env.URL.revokeObjectURL(svgUrl);
        fallback();
      };
      image.src = svgUrl;
    });
    pumpBakes();
  });
  spriteCache.set(key, entry);
  return entry.promise;
}

function renderSpriteImg(m, className = 'ubu-tile-svg', size = 256) {
  if (typeof env.document === 'undefined' || typeof env.document.createElement !== 'function' || typeof env.XMLSerializer === 'undefined') {
    return renderSVG(m, className);
  }
  const label = `${m.parts.fullName}, Ubuquity ${m.grade}`;
  const image = env.document.createElement('img');
  image.className = className;
  image.decoding = 'async';
  image.draggable = false;
  const hit = spriteCache.get(spriteKey(m, size));
  if (hit?.url) {
    image.alt = label;
    image.src = hit.url;
  } else {
    // Keep a valid transparent 1x1 src and empty alt while the sprite bakes so browsers
    // never show a broken-image icon or duplicate alt text over empty tile slots.
    image.alt = '';
    image.src = BLANK_PIXEL;
    renderSprite(m, size).then(url => {
      if (!url) return;
      image.onload = () => { image.alt = label; image.onload = null; };
      image.src = url;
    });
  }
  return image;
}
  renderSVG.token = (m, surface = null, effects = null) => renderSVG(m, 'enamel-token', surface, effects, true);
  renderSVG.tokenBack = renderTokenBack;
  renderSVG.back = renderBack;
  renderSVG.cardMaterials = renderCardMaterials;
  renderSVG.sprite = renderSprite;
  renderSVG.spriteImg = renderSpriteImg;
  if (rawEnv && typeof rawEnv === 'object') rawEnv.ubuRender = renderSVG;
  return renderSVG;
}

module.exports = { createUbuRenderer };
