'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const KEY = 'ubumint-dna-preview';
  const LIMIT = 100;
  const roles = ['background', 'eyes', 'irises', 'pupils', 'mouth'];
  let serial = 0, generation = 0, current = null, nav = [], navIndex = -1;
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}
  function entries(value) {
    const valid = [];
    for (const code of Array.isArray(value) ? value : []) {
      try { if (typeof code === 'string' && !valid.includes(code)) { ubu.fromCode(code); valid.push(code); } } catch {}
      if (valid.length === LIMIT) break;
    }
    return valid;
  }
  const saved = entries(stored.saved), history = entries(stored.history);
  const cache = new Map();
  function model(code) {
    if (!cache.has(code)) {
      if (cache.size >= 220) cache.delete(cache.keys().next().value);
      cache.set(code, ubu.decode(ubu.fromCode(code)));
    }
    return cache.get(code);
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ saved, history })); } catch {}
  }
  function node(tag, attrs = {}, text) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function svgNode(tag, attrs = {}) {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  }
  function material(defs, attribute, id, effects) {
    const rotate = `rotate(${attribute.angle} 180 180)`;
    // One global material field: every detail rotates about the outer-circle center.
    const pattern = svgNode('pattern', { id, patternUnits: 'userSpaceOnUse', x: -180, y: -180,
      width: 720, height: 720, viewBox: '-180 -180 720 720', patternTransform: rotate });
    const cover = fill => pattern.append(svgNode('rect', { x: -180, y: -180, width: 720, height: 720, fill }));
    function lighting(name, stops, radial = false, attrs = {}) {
      const key = id + '-' + name;
      const gradient = svgNode(radial ? 'radialGradient' : 'linearGradient', {
        id: key, gradientUnits: 'userSpaceOnUse',
        ...(radial ? { cx: 105, cy: 90, r: 265 } : { x1: 0, y1: 0, x2: 360, y2: 0 }), ...attrs
      });
      for (const [offset, color, opacity] of stops) gradient.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
      if (effects) {
        const base = attrs.gradientTransform || '';
        const radians = attribute.angle * Math.PI / 180;
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
    let state = 173;
    const roll = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    if (attribute.texture === 'metallic') {
      lighting('reflection', [[0, '#000', .58], [.12, '#fff', .18], [.27, '#000', .4],
        [.36, '#000', .62], [.405, '#fff', .85], [.44, '#fff', .38], [.51, '#000', .18],
        [.64, '#000', .52], [.72, '#fff', .58], [.77, '#fff', .12], [1, '#000', .4]]);
      const brush = svgNode('pattern', { id: id + '-brush', patternUnits: 'userSpaceOnUse', width: 72, height: 72 });
      for (let i = 0; i < 64; i++) {
        const y = roll() * 72;
        brush.append(svgNode('path', { d: `M0 ${y}h72`, stroke: i % 3 ? '#fff' : '#000',
          'stroke-width': .18 + roll() * .35, opacity: .025 + roll() * .065 }));
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
    } else if (attribute.texture === 'matte') {
      lighting('diffuse', [[0, '#fff', .19], [.5, '#fff', .03], [1, '#000', .2]], true);
      const grain = svgNode('pattern', { id: id + '-grain', patternUnits: 'userSpaceOnUse', width: 48, height: 48 });
      for (let i = 0; i < 160; i++) {
        grain.append(svgNode('circle', { cx: 1 + roll() * 46, cy: 1 + roll() * 46,
          r: .18 + roll() * .22, fill: i % 2 ? '#fff' : '#000', opacity: .018 + roll() * .032 }));
      }
      defs.append(grain); cover(`url(#${id}-grain)`);
    } else {
      // An irregular triangulated field avoids a visibly repeating gemstone stamp.
      const points = [];
      for (let y = 0; y <= 12; y++) {
        points[y] = [];
        for (let x = 0; x <= 12; x++) points[y][x] = [-180 + x * 60 + (roll() - .5) * 32, -180 + y * 60 + (roll() - .5) * 32];
      }
      for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
        const a = points[y][x], b = points[y][x + 1], c = points[y + 1][x], d = points[y + 1][x + 1];
        const split = roll() < .5;
        const facets = split ? [[a, b, c], [b, d, c]] : [[a, b, d], [a, d, c]];
        for (const triangle of facets) {
          const light = roll(), fill = light > .46 ? '#fff' : '#000';
          const opacity = .08 + Math.abs(light - .46) * .86;
          const facet = svgNode('polygon', { points: triangle.map(p => p.join(',')).join(' '), fill, opacity });
          pattern.append(facet);
          if (effects) {
            const normal = light * Math.PI * 2 + attribute.angle * Math.PI / 180;
            effects.push((x, y) => facet.setAttribute('opacity', Math.max(.025,
              Math.min(.78, opacity + .22 * (x * Math.cos(normal) + y * Math.sin(normal))))));
          }
        }
        if (roll() > .76) pattern.append(svgNode('path', { d: split ? `M${b}L${c}` : `M${a}L${d}`, fill: 'none',
          stroke: '#fff', 'stroke-width': .65, opacity: .38 }));
      }
      if (effects) for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) {
        if ((x + y * 3) % 4) continue;
        const [px, py] = points[y][x];
        const spark = svgNode('path', { d: `M${px - 5} ${py}h10M${px} ${py - 5}v10`,
          stroke: '#fff', 'stroke-width': 1.25, 'stroke-linecap': 'round', opacity: 0 });
        pattern.append(spark);
        const phase = (x * 1.7 + y * 2.3 + attribute.angle * Math.PI / 180);
        effects.push((dx, dy) => {
          const alignment = Math.max(0, Math.cos(phase + dx * 3 + dy * 2));
          spark.setAttribute('opacity', Math.pow(alignment, 22) * Math.min(1, Math.hypot(dx, dy) * 3.4));
        });
      }
      lighting('luster', [[0, '#fff', .3], [.4, '#fff', 0], [1, '#000', .3]], true);
    }
    defs.append(pattern);
    return `url(#${id})`;
  }
  function materialEdge(defs, face, shapes, attribute, id, effects) {
    // Erode the combined silhouette so overlapping eyes never acquire an internal seam.
    const finishes = {
      metallic: { width: 2.4, rim: .65, stops: [[0, '#fff', .85], [.43, '#fff', .12], [.49, '#000', .55], [.56, '#fff', .65], [1, '#000', .6]] },
      glossy: { width: 3.4, rim: 1.1, stops: [[0, '#fff', .65], [.35, '#fff', .24], [.65, '#fff', .02], [1, '#000', .28]] },
      iridescent: { width: 2.5, rim: .7, stops: [[0, '#82fff0', .8], [.28, '#aaa1ff', .65], [.5, '#ff8cdb', .55], [.72, '#ffe6a0', .6], [1, '#53bfff', .7]] },
      crystalline: { width: 2, rim: .45, stops: [[0, '#fff', .9], [.24, '#fff', .55], [.25, '#000', .32], [.49, '#000', .12], [.5, '#fff', .8], [.74, '#fff', .2], [.75, '#000', .42], [1, '#000', .55]] }
    };
    const finish = finishes[attribute.texture];
    const gradient = svgNode('linearGradient', { id: id + '-light', gradientUnits: 'userSpaceOnUse',
      x1: 30, y1: 20, x2: 330, y2: 340, gradientTransform: `rotate(${attribute.angle} 180 180)` });
    for (const [offset, color, opacity] of finish.stops) gradient.append(svgNode('stop', {
      offset, 'stop-color': color, 'stop-opacity': opacity
    }));
    defs.append(gradient);
    if (effects) effects.push((x, y) => gradient.setAttribute('gradientTransform',
      `translate(${x * 38} ${y * 38}) rotate(${attribute.angle} 180 180)`));
    for (const [index, width] of [finish.width, finish.rim].entries()) {
      const key = id + '-' + index;
      const filter = svgNode('filter', { id: key + '-cut', filterUnits: 'userSpaceOnUse',
        x: 0, y: 0, width: 360, height: 360, 'color-interpolation-filters': 'sRGB' });
      filter.append(svgNode('feMorphology', { in: 'SourceAlpha', operator: 'erode', radius: width, result: 'inset' }),
        svgNode('feComposite', { in: 'SourceGraphic', in2: 'inset', operator: 'out' }));
      const mask = svgNode('mask', { id: key + '-mask', maskUnits: 'userSpaceOnUse',
        maskContentUnits: 'userSpaceOnUse', x: 0, y: 0, width: 360, height: 360 });
      const silhouette = svgNode('g', { fill: '#fff', filter: `url(#${key}-cut)` });
      for (const shape of shapes) silhouette.append(shape.cloneNode(true));
      mask.append(silhouette); defs.append(filter, mask);
      face.append(svgNode('rect', { width: 360, height: 360, fill: `url(#${id}-light)`,
        mask: `url(#${key}-mask)`, opacity: index ? .8 : .38 }));
    }
  }
  function renderSVG(m, className = 'oomark') {
    const effects = className === 'oomark' ? [] : null;
    const prefix = 'ubu-' + (++serial);
    const svg = svgNode('svg', { class: className, viewBox: '0 0 360 360', role: 'img', 'aria-label': `${m.parts.fullName}, Ubuquity ${m.grade}` });
    const title = svgNode('title'); title.textContent = `${m.parts.fullName} · ${m.grade}`;
    const defs = svgNode('defs');
    const bounds = svgNode('clipPath', { id: prefix + '-bounds', clipPathUnits: 'userSpaceOnUse' });
    bounds.append(svgNode('circle', { cx: 180, cy: 180, r: 176 })); defs.append(bounds);
    const face = svgNode('g', { 'clip-path': `url(#${prefix}-bounds)` });
    svg.append(title, defs, face);
    const eyePositions = [[120.55, 145.5, m.eyes.leftX, m.eyes.leftY], [239.44, 145.5, m.eyes.dx, m.eyes.dy]];
    const shapes = {
      background: [svgNode('circle', { cx: 180, cy: 180, r: 176 })],
      eyes: eyePositions.map(([cx, cy]) => svgNode('circle', { cx, cy, r: 66.05 })),
      irises: eyePositions.map(([x, y, dx, dy]) => svgNode('circle', { cx: x + dx, cy: y + dy, r: 30.7126 })),
      pupils: eyePositions.map(([x, y, dx, dy]) => svgNode('circle', { cx: x + dx, cy: y + dy, r: 17 })),
      mouth: [svgNode('path', { d: ubu.mouthPath(m.mouth) })]
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
      const fill = attribute.texture
        ? material(defs, attribute, prefix + '-' + role + '-texture', effects)
        : (matteFill ||= material(defs, { texture: 'matte', angle: 0 }, prefix + '-matte', effects));
      face.append(svgNode('rect', { x: 0, y: 0, width: 360, height: 360, fill, 'clip-path': `url(#${clipId})` }));
      if (attribute.texture) materialEdge(defs, face, shapes[role], attribute, prefix + '-' + role + '-edge', effects);
    }
    if (effects) attachLighting(svg, effects);
    return svg;
  }
  let stopLighting = () => {};
  function attachLighting(svg, effects) {
    stopLighting();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, x = 0, y = 0, targetX = 0, targetY = 0, rect;
    function paint() {
      frame = 0;
      x += (targetX - x) * .18; y += (targetY - y) * .18;
      const settled = Math.abs(targetX - x) + Math.abs(targetY - y) < .001;
      if (settled) { x = targetX; y = targetY; }
      svg.style.transform = `perspective(700px) rotateX(${-y * 12}deg) rotateY(${x * 12}deg)`;
      svg.style.filter = x || y ? `drop-shadow(${-x * 9}px ${8 - y * 6}px 9px #0005)` : '';
      for (const effect of effects) effect(x, y);
      if (!settled) frame = requestAnimationFrame(paint);
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    function reset() { targetX = targetY = 0; schedule(); }
    svg.addEventListener('pointerenter', () => { rect = svg.getBoundingClientRect(); });
    svg.addEventListener('pointermove', event => {
      if (reduced.matches || event.pointerType === 'touch' || !rect) return;
      targetX = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      targetY = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
      schedule();
    });
    svg.addEventListener('pointerleave', reset);
    svg.addEventListener('pointercancel', reset);
    function preferenceChanged() {
      if (reduced.matches) { targetX = targetY = x = y = 0; schedule(); }
    }
    reduced.addEventListener('change', preferenceChanged);
    window.addEventListener('blur', reset);
    stopLighting = () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener('change', preferenceChanged);
      window.removeEventListener('blur', reset);
    };
  }
  function fitName() {
    const line = $('name-line');
    const size = matchMedia('(max-width: 560px)').matches ? 40.5 : 51;
    line.style.fontSize = size + 'px';
    const available = $('name-box').clientWidth - 36;
    if (line.scrollWidth > available) line.style.fontSize = size * available / line.scrollWidth + 'px';
  }
  function heart() {
    const isSaved = saved.includes(current);
    $('favorite-toggle').textContent = isSaved ? '♥' : '♡';
    $('favorite-toggle').classList.toggle('is-saved', isSaved);
    $('favorite-toggle').setAttribute('aria-pressed', String(isSaved));
    $('favorite-toggle').setAttribute('aria-label', isSaved ? 'Remove from Ubu Storage' : 'Save to Ubu Storage');
  }
  function toggle(code) {
    const index = saved.indexOf(code);
    if (index >= 0) saved.splice(index, 1); else { saved.unshift(code); saved.length = Math.min(saved.length, LIMIT); }
    persist(); heart(); collections();
  }
  function card(code, caption) {
    const m = model(code);
    const article = node('article', { class: 'ubu-card' });
    const open = node('button', { type: 'button', class: 'ubu-card-main' });
    open.append(renderSVG(m, 'ubu-thumb'), node('span', { class: 'ubu-card-name' }, caption || m.parts.fullName), node('span', { class: 'card-grade' }, m.grade));
    open.addEventListener('click', () => show(code)); article.append(open);
    if (!caption) {
      const save = node('button', { type: 'button', class: 'card-heart' + (saved.includes(code) ? ' is-saved' : ''), 'aria-label': saved.includes(code) ? 'Remove from Ubu Storage' : 'Save to Ubu Storage' }, saved.includes(code) ? '♥' : '♡');
      save.addEventListener('click', () => toggle(code)); article.append(save);
    }
    return article;
  }
  function collections() {
    for (const [id, list] of [['storage', saved], ['history', history]]) {
      $(id + '-count').textContent = list.length;
      $(id + '-panel').replaceChildren(...(list.length ? list.map(code => card(code)) : [node('p', { class: 'empty-state' }, id === 'storage' ? 'No saved ubus yet.' : 'No history yet.')]));
    }
  }
  function show(code, push = true) {
    generation++;
    const m = model(code);
    current = code;
    $('oomark').replaceWith(Object.assign(renderSVG(m), { id: 'oomark' }));
    for (const role of ['praenomen', 'nomen', 'cognomen']) {
      $(role).textContent = m.parts[role]; $(role).parentElement.hidden = !m.parts[role];
    }
    $('grade').textContent = m.grade;
    $('rating').textContent = `${m.rating} / 255`;
    $('dna-output').value = code;
    $('seed').value = code; $('input-mode').value = 'dna';
    $('input-error').textContent = '';
    const notes = [];
    for (const role of roles) if (m.attributes[role].texture) notes.push(`${role}: ${m.attributes[role].texture}`);
    if (m.eyes.flipX) notes.push('Left eye: horizontal flip');
    if (m.eyes.flipY) notes.push('Left eye: vertical flip');
    $('oomark-notes').replaceChildren(...notes.map(text => node('div', {}, text)));
    $('oomark-notes').hidden = !notes.length;
    const body = $('traits');
    body.replaceChildren(...roles.map(role => {
      const a = m.attributes[role], row = node('tr');
      for (const text of [role, a.name, a.texture || 'matte (default)', a.angle + '°']) row.append(node('td', {}, text));
      return row;
    }));
    const f = value => Number(value.toFixed(3));
    $('geometry').textContent = `Mouth: ${f(m.mouth.width)} × ${f(m.mouth.height)}; offset ${f(m.mouth.x - 179.995)}, ${f(m.mouth.y - 254.0531)}. Corners TL/TR/BL/BR: ${m.mouth.corners.map(c => c ? 'cut' : 'square').join(' / ')} (${m.mouth.source}). Eyes: offset ${f(m.eyes.dx)}, ${f(m.eyes.dy)}; left X flip ${m.eyes.flipX ? 'yes' : 'no'}, Y flip ${m.eyes.flipY ? 'yes' : 'no'}.`;
    history.splice(0, history.length, code, ...history.filter(value => value !== code).slice(0, LIMIT - 1));
    if (push && nav[navIndex] !== code) {
      nav = nav.slice(0, navIndex + 1); nav.push(code);
      if (nav.length > LIMIT) nav.shift(); navIndex = nav.length - 1;
    }
    $('back-button').disabled = navIndex <= 0;
    $('forward-button').disabled = navIndex >= nav.length - 1;
    heart(); collections(); persist(); fitName();
  }
  function fail(error) { $('input-error').textContent = error.message || String(error); }
  $('generator-form').addEventListener('submit', async event => {
    event.preventDefault();
    const ticket = ++generation, input = $('seed').value, mode = $('input-mode').value;
    try {
      const dna = mode === 'text' ? await ubu.fromText(input) : ubu.fromCode(input);
      if (ticket !== generation) return;
      show(ubu.toCode(dna));
      $('seed').value = input; $('input-mode').value = mode;
    } catch (error) { if (ticket === generation) fail(error); }
  });
  $('random-button').addEventListener('click', () => { generation++; show(ubu.toCode(ubu.randomDNA())); });
  $('favorite-toggle').addEventListener('click', () => toggle(current));
  $('back-button').addEventListener('click', () => { generation++; show(nav[--navIndex], false); });
  $('forward-button').addEventListener('click', () => { generation++; show(nav[++navIndex], false); });
  for (const id of ['storage', 'history']) $(id + '-tab').addEventListener('click', () => {
    for (const candidate of ['storage', 'history']) {
      $(candidate + '-panel').hidden = candidate !== id;
      $(candidate + '-tab').classList.toggle('is-active', candidate === id);
      $(candidate + '-tab').setAttribute('aria-selected', String(candidate === id));
    }
  });
  $('copy-dna').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(current); $('input-error').textContent = 'DNA copied.'; } catch { $('dna-output').select(); $('input-error').textContent = 'Select and copy the DNA above.'; }
  });
  $('export-ubu').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([ubuFile.unsigned(current)], { type: 'application/json' }));
    const link = node('a', { href: url, download: model(current).parts.fullName.replace(/ /g, '-') + '.ubu' });
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('import-ubu').addEventListener('change', async event => {
    const ticket = ++generation;
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > ubuFile.MAX_BYTES) throw new Error('A .ubu file must contain 1–1024 bytes.');
      // No production mint keys are configured in this local designer.
      const result = await ubuFile.read(new Uint8Array(await file.arrayBuffer()));
      if (ticket === generation) {
        show(result.dna);
        $('input-error').textContent = 'Imported custom ubu (unsigned).';
      }
    } catch (error) { if (ticket === generation) fail(error); }
    event.target.value = '';
  });
  // Real DNA fixtures make rare features inspectable without changing their odds.
  function setBits(dna, start, width, value) {
    for (let i = 0; i < width; i++) {
      const bit = start + i, mask = 1 << (7 - (bit & 7));
      dna[bit >> 3] = (dna[bit >> 3] & ~mask) | (((value >> (width - i - 1)) & 1) ? mask : 0);
    }
  }
  const base = new Uint8Array(32);
  for (const [slot, color] of [31, 28, 13, 31, 27].entries()) setBits(base, 64 + 16 * slot, 5, color);
  for (const start of [168, 178, 188, 198, 208, 218]) setBits(base, start, 10, 511);
  base[31] = 255;
  const specimens = [['Matte (default)', dna => {}]];
  for (const [i, texture] of ['Metallic', 'Glossy', 'Iridescent', 'Crystalline'].entries()) specimens.push([texture, dna => {
    for (let slot = 0; slot < 5; slot++) { setBits(dna, 64 + slot * 16 + 8, 8, 240 | (8 >> i)); setBits(dna, 64 + slot * 16 + 5, 3, slot); }
  }]);
  specimens.push(['Left X flip', dna => { setBits(dna, 208, 10, 1023); setBits(dna, 228, 10, 1023); }],
    ['Left Y flip', dna => { setBits(dna, 218, 10, 0); setBits(dna, 238, 10, 1023); }],
    ['Diagonal eyes', dna => { setBits(dna, 208, 10, 1023); setBits(dna, 218, 10, 1023); }],
    ['Small mouth', dna => { setBits(dna, 168, 10, 0); setBits(dna, 178, 10, 0); }],
    ['Large mouth', dna => { setBits(dna, 168, 10, 1023); setBits(dna, 178, 10, 1023); setBits(dna, 188, 10, 1023); setBits(dna, 198, 10, 1023); }],
    ['Pair cuts', dna => { setBits(dna, 144, 8, 255); }],
    ['Individual cuts', dna => { setBits(dna, 152, 4, 15); setBits(dna, 164, 4, 15); }]);
  $('sample-details').addEventListener('toggle', () => {
    if (!$('sample-details').open || $('samples').childElementCount) return;
    $('samples').replaceChildren(...specimens.map(([caption, change]) => { const dna = new Uint8Array(base); change(dna); return card(ubu.toCode(dna), caption); }));
  });
  window.addEventListener('resize', fitName);
  show(ubu.toCode(ubu.randomDNA()));
})();
