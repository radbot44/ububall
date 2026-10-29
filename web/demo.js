'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const KEY = 'ubumint-dna-preview';
  const LIMIT = 100;
  const roles = ['background', 'eyes', 'irises', 'pupils', 'mouth'];
  let generation = 0, current = null, nav = [], navIndex = -1;
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
  const renderSVG = ubuRender;
  function fitName() {
    const line = $('name-line');
    const size = matchMedia('(max-width: 560px)').matches ? 40.5 : 51;
    line.style.fontSize = size + 'px';
    const available = $('name-box').clientWidth - 36;
    if (line.scrollWidth > available) line.style.fontSize = size * available / line.scrollWidth + 'px';
  }
  function heart() {
    const isSaved = saved.includes(current);
    const label = isSaved ? 'Remove from Ubu Storage' : 'Save to Ubu Storage';
    $('favorite-toggle').textContent = isSaved ? '♥' : '♡';
    $('favorite-toggle').classList.toggle('is-saved', isSaved);
    $('favorite-toggle').setAttribute('aria-pressed', String(isSaved));
    $('favorite-toggle').setAttribute('aria-label', label);
    $('favorite-toggle').setAttribute('title', label);
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
    open.append(renderSVG(m, 'ubu-thumb'), node('span', { class: 'ubu-card-name' }, caption || m.parts.fullName), node('span', { class: 'card-grade', 'data-grade': m.grade }, m.grade));
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
    $('grade').dataset.grade = m.grade;
    $('rating').textContent = `${m.rating} / 1023`;
    if (window.rarity) {
      const r = rarity.scoreRarity(m);
      $('rarity-percentile').textContent = `${r.percentile.toFixed(3)} / 100`;
      $('rarity-bits').textContent = `${r.bits.toFixed(6)} bits`;
      $('rarity-breakdown').textContent = `Rarity breakdown: finishes ${r.breakdown.finishes.toFixed(2)}b, material preference ${r.breakdown.materialPreference.toFixed(2)}b, colors ${r.breakdown.colors.toFixed(2)}b, harmony ${r.breakdown.harmony.toFixed(2)}b, contrast ${r.breakdown.contrast.toFixed(2)}b, corners ${r.breakdown.corners.toFixed(2)}b, mouth cuts ${r.breakdown.mouthCuts.toFixed(2)}b, eyelids ${r.breakdown.eyelids.toFixed(2)}b, eye flips ${r.breakdown.eyeFlips.toFixed(2)}b, geometry ${r.breakdown.geometry.toFixed(2)}b, feature geometry ${r.breakdown.featureGeometry.toFixed(2)}b, name ${r.breakdown.name.toFixed(2)}b.`;
    }
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
    $('geometry').textContent = `Mouth: ${f(m.mouth.width)} × ${f(m.mouth.height)}; offset ${f(m.mouth.x - 179.995)}, ${f(m.mouth.y - 254.0531)}. Corners TL/TR/BL/BR: ${m.mouth.corners.map((c, i) => c ? m.mouth.curved[i] ? 'curved' : 'straight' : 'square').join(' / ')} (${m.mouth.source}). Eyes: offset ${f(m.eyes.dx)}, ${f(m.eyes.dy)}; left X flip ${m.eyes.flipX ? 'yes' : 'no'}, Y flip ${m.eyes.flipY ? 'yes' : 'no'}.`;
    $('geometry').textContent += ` Lip notch: ${m.mouth.lipNotch ? m.mouth.notchCurved ? 'curved' : 'straight' : 'none'}; horizontal cut: ${m.mouth.horizontalCut}; opening width: ${f(m.mouth.openingRatio * 100)}%. Eyelids TL/TR/BL/BR: ${m.eyelids.active.join(' / ')}; angle/depth flips: ${m.eyelids.angleFlip} / ${m.eyelids.depthFlip}.`;
    if (window.ubuAudio && m.voice) {
      window.ubuAudio.stop();
      const p = window.ubuAudio.parseVoiceInfo(m.voice);
      $('voice-summary').textContent = `Instrument: ${p.instrument} (#${p.instrumentIndex}) · Root Pitch: ${p.rootName} (${Math.round(p.rootFreq)} Hz, pitch code ${p.pitchIndex}) · Decay: ${p.decaySeconds.toFixed(2)}s · Timbre Mod: ${p.timbreMod} · Scale: ${p.scale} · Tempo: ${p.tempoBpm} BPM · Groove: ${p.groove}`;
      const chips = p.notes.map((note, i) => {
        const chip = node('button', {
          type: 'button',
          class: 'fanfare-note-chip' + (note.isRest ? ' is-rest' : ''),
          title: note.isRest ? `Note ${i + 1}: Rest` : `Note ${i + 1}: ${note.name} (${note.beats} beats) - click to audition`
        }, note.isRest ? '—' : note.name);
        chip.addEventListener('click', () => {
          if (!note.isRest && note.freq) {
            window.ubuAudio.playVoice({
              instrument: p.instrumentIndex,
              pitch: note.midi - 36,
              decay: m.voice.decay,
              timbreMod: p.timbreMod
            });
          }
        });
        return chip;
      });
      $('fanfare-strip').replaceChildren(...chips);
    }
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
  $('voice-play-tone')?.addEventListener('click', () => {
    if (!current) return;
    const m = model(current);
    if (m?.voice && window.ubuAudio) window.ubuAudio.playVoice(m.voice);
  });
  $('voice-play-fanfare')?.addEventListener('click', () => {
    if (!current) return;
    const m = model(current);
    if (!m?.voice || !window.ubuAudio) return;
    const chips = Array.from($('fanfare-strip').children);
    window.ubuAudio.playFanfare(m.voice, null, (idx) => {
      chips.forEach((c, i) => c.classList.toggle('is-playing-note', i === idx));
    });
  });
  $('voice-stop')?.addEventListener('click', () => {
    window.ubuAudio?.stop();
    Array.from($('fanfare-strip').children).forEach(c => c.classList.remove('is-playing-note'));
  });
  for (const id of ['storage', 'history']) $(id + '-tab').addEventListener('click', () => {
    for (const candidate of ['storage', 'history']) {
      $(candidate + '-panel').hidden = candidate !== id;
      $(candidate + '-tab').classList.toggle('is-active', candidate === id);
      $(candidate + '-tab').setAttribute('aria-selected', String(candidate === id));
    }
  });
  let copyTimeout;
  $('copy-dna').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(current);
      const btn = $('copy-dna');
      btn.textContent = 'Copied!';
      clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      $('input-error').textContent = '';
    } catch {
      $('dna-output').select();
      $('input-error').textContent = 'Select and copy the DNA above.';
    }
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
  const base = new Uint8Array(128);
  for (const [slot, color] of [31, 28, 13, 31, 27].entries()) setBits(base, 64 + 18 * slot, 5, color);
  for (const start of [178, 188, 198, 208, 218, 228, 282, 302]) setBits(base, start, 10, 511);
  setBits(base, 1014, 10, 1023);
  setBits(base, 362, 10, 239);
  const specimens = [['Matte (default)', dna => {}]];
  for (const [i, texture] of [[0, 'Metallic'], [1, 'Glossy'], [2, 'Iridescent'], [3, 'Crystalline'],
    [4, 'Pearlescent'], [14, 'Damascus'], [5, 'Marble'], [13, 'Lacquered'],
    [6, 'Velvet'], [7, 'Frosted'], [11, 'Woodgrain'], [10, 'Holographic'],
    [8, 'Terrazzo'], [9, 'Crackle'], [12, 'Plush'], [15, 'Opalescent'],
    [16, 'Satin'], [20, 'Hammered Metal'], [21, 'Granite'], [22, 'Sandstone'],
    [17, 'Leather'], [18, 'Denim'], [19, 'Carbon Fiber'], [23, 'Obsidian'], [24, 'Liquid'], [25, 'Bubbled'], [26, 'Mosaic'], [27, 'Circuitry'], [28, 'Quartz'], [29, 'Kintsugi'], [30, 'Lava'], [31, 'Starfield']]) specimens.push([texture, dna => {
    for (let slot = 0; slot < 5; slot++) { setBits(dna, 64 + slot * 18 + 8, 10, (31 << 5) | i); setBits(dna, 64 + slot * 18 + 5, 3, slot); }
  }]);
  specimens.push(['Left X flip', dna => { setBits(dna, 218, 10, 1023); setBits(dna, 238, 10, 1023); }],
    ['Left Y flip', dna => { setBits(dna, 228, 10, 0); setBits(dna, 248, 10, 1023); }],
    ['Diagonal eyes', dna => { setBits(dna, 218, 10, 1023); setBits(dna, 228, 10, 1023); }],
    ['Small mouth', dna => { setBits(dna, 178, 10, 0); setBits(dna, 188, 10, 0); }],
    ['Large mouth', dna => { setBits(dna, 178, 10, 1023); setBits(dna, 188, 10, 1023); setBits(dna, 198, 10, 1023); setBits(dna, 208, 10, 1023); }],
    ['Pair cuts', dna => { setBits(dna, 154, 8, 255); }],
    ['Individual cuts', dna => { setBits(dna, 162, 4, 15); setBits(dna, 174, 4, 15); }]);
  specimens.push(['Curved corners', dna => { setBits(dna, 154, 8, 255); setBits(dna, 342, 8, 255); }],
    ['Lip notch', dna => setBits(dna, 350, 6, 63)],
    ['Curved lip notch', dna => { setBits(dna, 350, 6, 63); setBits(dna, 372, 2, 3); }],
    ['Horizontal cut', dna => setBits(dna, 356, 6, 63)],
    ['10% opening', dna => { setBits(dna, 356, 6, 63); setBits(dna, 362, 10, 0); }],
    ['Fully open mouth', dna => { setBits(dna, 350, 12, 4095); setBits(dna, 362, 10, 1023); }],
    ['Both mouth cuts', dna => { setBits(dna, 350, 12, 4095); }],
    ['Top lids', dna => { setBits(dna, 258, 4, 15); setBits(dna, 292, 10, 800); }],
    ['Both lids, flipped', dna => { setBits(dna, 258, 8, 255); setBits(dna, 282, 10, 1023); setBits(dna, 292, 10, 900); setBits(dna, 312, 10, 600); setBits(dna, 322, 20, 1048575); }]);
  $('sample-details').addEventListener('toggle', () => {
    if (!$('sample-details').open || $('samples').childElementCount) return;
    $('samples').replaceChildren(...specimens.map(([caption, change]) => { const dna = new Uint8Array(base); change(dna); return card(ubu.toCode(dna), caption); }));
  });
  window.addEventListener('resize', fitName);
  show(ubu.toCode(ubu.randomDNA()));
})();
