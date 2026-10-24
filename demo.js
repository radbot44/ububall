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
  function material(defs, attribute, id) {
    const rotate = `rotate(${attribute.angle} 180 180)`;
    if (attribute.texture === 'metallic' || attribute.texture === 'glossy') {
      const gradient = svgNode('linearGradient', {
        id, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 360, y2: 0, gradientTransform: rotate
      });
      const stops = attribute.texture === 'metallic'
        ? [[0, '#000', .32], [.24, '#fff', .15], [.38, '#000', .28], [.48, '#fff', .82], [.53, '#fff', .1], [.73, '#000', .4], [1, '#fff', .28]]
        : [[0, '#000', .2], [.2, '#fff', 0], [.32, '#fff', .62], [.43, '#fff', .05], [.75, '#000', .12], [1, '#000', .4]];
      for (const [offset, color, opacity] of stops) gradient.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
      defs.append(gradient);
    } else {
      const matte = attribute.texture === 'matte';
      const pattern = svgNode('pattern', { id, patternUnits: 'userSpaceOnUse', width: matte ? 6 : 48, height: matte ? 6 : 48, patternTransform: rotate });
      if (matte) {
        pattern.append(svgNode('rect', { width: 6, height: 6, fill: '#000', opacity: .08 }),
          svgNode('circle', { cx: 1, cy: 1, r: .75, fill: '#fff', opacity: .18 }),
          svgNode('circle', { cx: 4, cy: 4, r: .6, fill: '#000', opacity: .2 }));
      } else {
        for (const [points, fill, opacity] of [
          ['0,0 32,0 16,24', '#fff', .38], ['32,0 48,0 48,32 16,24', '#000', .22],
          ['0,0 16,24 0,48', '#000', .12], ['16,24 48,32 32,48 0,48', '#fff', .12], ['48,32 48,48 32,48', '#fff', .5]
        ]) pattern.append(svgNode('polygon', { points, fill, opacity }));
      }
      defs.append(pattern);
    }
    return `url(#${id})`;
  }
  function renderSVG(m, className = 'oomark') {
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
    for (const role of roles) {
      const attribute = m.attributes[role];
      const layer = svgNode('g', { fill: attribute.hex });
      layer.append(...shapes[role]); face.append(layer);
      if (!attribute.texture) continue;
      const clipId = prefix + '-' + role + '-clip';
      const clip = svgNode('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
      for (const shape of shapes[role]) clip.append(shape.cloneNode(true));
      defs.append(clip);
      const fill = material(defs, attribute, prefix + '-' + role + '-texture');
      face.append(svgNode('rect', { x: 0, y: 0, width: 360, height: 360, fill, 'clip-path': `url(#${clipId})` }));
    }
    return svg;
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
      for (const text of [role, a.name, a.texture || 'none', a.angle + '°']) row.append(node('td', {}, text));
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
    const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'ubu-demo', dna: current })], { type: 'application/json' }));
    const link = node('a', { href: url, download: model(current).parts.fullName.replace(/ /g, '-') + '.ubu' });
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('import-ubu').addEventListener('change', async event => {
    const ticket = ++generation;
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 4096) throw new Error('That file is too large for a demo ubu.');
      const data = JSON.parse(await file.text());
      if (data.type !== 'ubu-demo' || typeof data.dna !== 'string') throw new Error('Choose an unsigned ubu-demo file.');
      const code = ubu.toCode(ubu.fromCode(data.dna));
      if (ticket === generation) show(code);
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
  const specimens = [['Neutral', dna => {}]];
  for (const [i, texture] of ['Metallic', 'Glossy', 'Matte', 'Crystalline'].entries()) specimens.push([texture, dna => {
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
