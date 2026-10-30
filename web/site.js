'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let config = { ready: false }, session = null, current = null, next = null, busy = false;
  const keys = new Map();
  let packScene = null, offer = null;
  const choiceViews = Array.from({ length: 3 }, (_, i) => {
    const card = document.createElement('article'); card.className = 'pack-option';
    const title = document.createElement('h2'); title.textContent = `Pack ${i + 1}`;
    const button = document.createElement('button'); button.className = 'candy-pack'; button.disabled = true;
    button.setAttribute('aria-label', `Choose pack ${i + 1}`);
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); button.append(canvas);
    const choose = document.createElement('button'); choose.className = 'choose-pack'; choose.textContent = 'Choose this pack'; choose.disabled = true;
    card.append(title, button, choose); $('pack-choices').append(card);
    let scene = null;
    try { scene = createPackScene(canvas); } catch { canvas.hidden = true; button.textContent = `Pack ${i + 1}`; }
    button.addEventListener('click', () => selectPack(i)); choose.addEventListener('click', () => selectPack(i));
    return { card, button, choose, scene };
  });
  let pack = null, packKey = '', pendingKey = '', collectionVersion = 0, revealIndex = 0;
  let viewerView = 'ubu';
  const collectionMap = new Map();

  const FAV_STORAGE_KEY = 'ubumint:favorites';
  const cardMap = new Map();
  const changingFavorites = new Set();
  const isFavorite = serial => collectionMap.get(serial)?.favorite === true;
  function createHeartSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572');
    svg.append(path);
    return svg;
  }
  function createHeartButton(serial) {
    const btn = document.createElement('button');
    btn.className = 'card-heart';
    btn.type = 'button';
    btn.title = 'Favorite';
    btn.setAttribute('aria-label', `Favorite #${serial}`);
    btn.dataset.serial = serial;
    const fav = isFavorite(serial);
    if (fav) {
      btn.classList.add('is-favorite');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.setAttribute('aria-pressed', 'false');
    }
    btn.append(createHeartSvg());
    btn.addEventListener('click', event => {
      event.stopPropagation();
      toggleFavorite(serial);
    });
    return btn;
  }
  function syncFavoriteButtons(serial) {
    const favorite = isFavorite(serial);
    for (const btn of document.querySelectorAll('.card-heart[data-serial="' + serial + '"]')) {
      btn.classList.toggle('is-favorite', favorite);
      btn.setAttribute('aria-pressed', String(favorite));
    }
    if (current?.serial === serial) {
      $('viewer-fav').classList.toggle('is-favorite', favorite);
      $('viewer-fav').setAttribute('aria-pressed', String(favorite));
    }
  }
  async function toggleFavorite(serial) {
    const item = collectionMap.get(serial);
    if (!item || changingFavorites.has(serial)) return;
    changingFavorites.add(serial);
    try {
      const result = await api('/api/favorites', post({ serial, favorite: !item.favorite }));
      item.favorite = result.favorite;
      syncFavoriteButtons(serial);
      if ($('sort-ubus').value === 'favorite') insertCard(item);
    } catch (error) {
      status('Could not update favorite: ' + error.message);
    } finally {
      changingFavorites.delete(serial);
    }
  }
  async function migrateBrowserFavorites() {
    let serials;
    try { serials = JSON.parse(localStorage.getItem(FAV_STORAGE_KEY) || '[]'); } catch { return; }
    if (!Array.isArray(serials)) return;
    serials = [...new Set(serials.filter(serial => typeof serial === 'string' && /^[0-9]{12}$/.test(serial)))];
    for (let i = 0; i < serials.length; i += 50) {
      await api('/api/favorites', post({ serials: serials.slice(i, i + 50) }));
    }
    // Import is idempotent and only updates ubus owned by the signed-in account.
    localStorage.removeItem(FAV_STORAGE_KEY);
  }

  const unseen = serial => pack?.items.slice(pack.seen).some(item => item.result.certificate.serial === serial);
  function savePack() {
    localStorage.setItem(packKey, JSON.stringify({ certificates: pack.items.map(item => item.text), seen: pack.seen }));
  }
  async function readPack(certificates, seen = 0) {
    if (!Array.isArray(certificates) || !certificates.length || !Number.isInteger(seen) || seen < 0 || seen > certificates.length) throw new Error('Could not restore your pack. Your mint request is still safe to retry.');
    const items = await Promise.all(certificates.map(async text => {
      const result = await inspect(text);
      if (result.type !== 'signed') throw new Error('The pack contains an unsigned ubu.');
      const model = ubu.decode(ubu.fromCode(result.dna));
      return { text, result, model, rarity: rarity.scoreRarity(model) };
    }));
    return { items, seen };
  }
  function updatePackButton() {
    const retry = pendingKey && localStorage.getItem(pendingKey);
    $('mint').disabled = busy || !session?.owner || !config.ready || (!pack && !retry && !config.lifetimeLimit);
    const label = pack ? 'Continue pack' : retry ? 'Resume pack choices' : 'Show packs';
    $('mint').textContent = label;
    $('mint').hidden = Boolean(offer && !pack && !busy);
    $('mint').setAttribute('aria-label', label);
    $('pack-hint').textContent = busy ? 'Preparing your pack…' : offer && !pack ? `Choose one pack. These choices are held until ${new Date(offer.expires * 1000).toLocaleString()}.` : session?.owner ? label : '';
    for (const view of choiceViews) view.button.disabled = view.choose.disabled = busy || !offer || Boolean(pack);
  }
  // Above 99 a run of nines extends the display to the first other digit, so rounding never
  // carries into them; six or more nines may round up.
  function rarityScore(percentile) {
    if (percentile <= 99) return percentile.toFixed(2);
    const nines = percentile.toFixed(12).split('.')[1].match(/^9*/)[0].length;
    return percentile.toFixed(nines >= 6 ? 3 : Math.max(3, nines + 1));
  }
  // Short dances a clicked ubu performs, picked at random.
  // Every pose uses the same transform functions, so rotations interpolate by angle (a full
  // turn really turns) instead of blending as matrices along the shortest path.
  const pose = ({ x = 0, y = 0, rx = 0, ry = 0, r = 0, sx = 1, sy = sx } = {}, offset) => ({
    transform: `translate(${x}%, ${y}%) rotateX(${rx}deg) rotateY(${ry}deg) rotate(${r}deg) scale(${sx}, ${sy})`,
    ...(offset === undefined ? {} : { offset })
  });
  // Short dances a clicked ubu performs, picked at random.
  const UBU_DANCES = [
    // Wiggle: quick side-to-side tilts that settle.
    { duration: 900, frames: [0, -14, 12, -10, 7, -3, 0].map(r => pose({ r })) },
    // Hop: crouch, leap with a stretch and a lean, then land with a squash.
    { duration: 1000, frames: [
      pose(), pose({ y: 4, sx: 1.12, sy: .86 }, .15), pose({ y: -16, sx: .92, sy: 1.1 }, .4),
      pose({ y: -18, r: 6 }, .5), pose({ y: 3, sx: 1.1, sy: .88 }, .75), pose()
    ] },
    // Shimmy: fast shakes that lean and fade out.
    { duration: 850, frames: [pose(), ...[-1, 1, -1, 1, -1, 1, -1, 1].map((side, i) => pose({ x: side * (6 - i * .6), r: side * 4 })), pose()] },
    // Sway: leans in 3D one way, then the other, then nods.
    { duration: 1300, frames: [pose(), pose({ ry: -28, r: -6 }), pose({ ry: 28, r: 6 }), pose({ rx: 22 }), pose({ rx: -12 }), pose()] },
    // Twirl: a full spin in the air and a bouncy landing.
    { duration: 1000, frames: [pose(), pose({ y: -10, r: 180, sx: 1.06 }), pose({ r: 360, sx: 1.08, sy: .92 }, .8), pose({ r: 360 })] },
    // Flip: hops and turns right round, showing its stamped back on the way.
    { duration: 1300, frames: [pose(), pose({ y: -12, ry: 180 }, .5), pose({ ry: 360, sx: 1.06, sy: .94 }, .85), pose({ ry: 360 })] },
    // Coin toss: crouches, then tumbles end over end twice in the air.
    { duration: 1500, frames: [
      pose(), pose({ y: 4, sx: 1.1, sy: .9 }, .12), pose({ y: -26, rx: 360 }, .5),
      pose({ rx: 720, sx: 1.1, sy: .9 }, .85), pose({ rx: 720 })
    ] },
    // Peek: turns its back, wobbles there a moment, then turns to face you again.
    { duration: 2000, frames: [
      pose(), pose({ ry: 180 }, .35), pose({ ry: 180, r: -8 }, .5), pose({ ry: 180, r: 8 }, .62),
      pose({ ry: 180 }, .72), pose({ ry: 360 })
    ] }
  ];
  // Engraves the base fanfare melody on a five-line staff. Units are staff spaces; y 0 is the top line.
  function fanfareStaff(parsed) {
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    const add = (tag, attrs, parent = svg) => {
      const el = document.createElementNS(NS, tag);
      for (const key in attrs) el.setAttribute(key, attrs[key]);
      parent.append(el); return el;
    };
    const notes = parsed.notes, LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
    const diatonic = midi => Math.floor(midi / 12) * 7 + LETTER[midi % 12];
    const steps = notes.filter(n => !n.isRest).map(n => diatonic(n.midi));
    // Prefer an unmarked clef; fall back to octave clefs so no note needs more than two ledger lines.
    const clefs = [['treble', 37, 0], ['bass', 25, 0], ['treble', 44, 1], ['bass', 18, -1], ['treble', 51, 2], ['bass', 11, -2]];
    const excess = ([, bottom]) => Math.max(0, ...steps.map(s => Math.abs(4 - (s - bottom) / 2 - 2) - 4));
    const [clef, bottom, octave] = clefs.find(c => excess(c) === 0) || clefs.reduce((a, b) => excess(b) < excess(a) ? b : a);
    const yOf = midi => 4 - (diatonic(midi) - bottom) / 2;
    const ink = { fill: 'currentColor' }, line = w => ({ stroke: 'currentColor', 'stroke-width': w, fill: 'none' });

    if (clef === 'treble') {
      add('path', { d: 'M1.65 3.1C1.2 3.05 1.15 2.45 1.6 2.4C2.2 2.35 2.35 3.35 1.75 3.65C1.1 3.95 .45 3.45 .6 2.75C.75 2.05 1.65 1.6 2 1C2.35 .35 2.2 -.75 1.85 -.8C1.4 -.85 1.2 .2 1.4 1.2L1.95 4.8C2.05 5.35 1.6 5.65 1.25 5.45', ...line(.22), 'stroke-linecap': 'round' });
      add('circle', { cx: 1.3, cy: 5.25, r: .26, ...ink });
    } else {
      add('path', { d: 'M.55 1.15C.6 .25 2.05 .15 2.1 1.25C2.15 2.35 1.25 3.25 .35 3.8', ...line(.26), 'stroke-linecap': 'round' });
      add('circle', { cx: .7, cy: 1.15, r: .32, ...ink });
      for (const cy of [.55, 1.45]) add('circle', { cx: 2.6, cy, r: .15, ...ink });
    }
    if (octave) {
      const mark = add('text', { x: 1.5, y: octave > 0 ? -1.4 : 6.9, 'text-anchor': 'middle', 'font-size': 1.3, ...ink });
      mark.textContent = Math.abs(octave) === 2 ? '15' : '8';
    }

    // Beam eighths and sixteenths that fall within the same beat.
    let x = 3.6, beat = 0;
    const accidentals = new Map(), placed = notes.map(note => {
      const start = beat; beat += note.beats;
      const item = { note, start, group: !note.isRest && note.beats < 1 && Math.floor(start) === Math.ceil(beat - 1e-9) - 1 ? Math.floor(start) : null };
      if (!note.isRest) {
        const sharp = note.name.includes('#'), step = diatonic(note.midi), was = accidentals.get(step) || false;
        if (sharp !== was) { item.accidental = sharp ? 'sharp' : 'natural'; accidentals.set(step, sharp); x += 1.1; }
        item.y = yOf(note.midi);
      }
      item.x = x + .7; x += 1.6 + note.beats * 2;
      return item;
    });
    const groups = [];
    for (const item of placed) {
      const last = groups.at(-1);
      if (item.group !== null && last?.[0].group === item.group && last.at(-1) === placed[placed.indexOf(item) - 1]) last.push(item);
      else groups.push([item]);
    }

    // Justify to a fixed width so every card's staff box has the same height.
    const width = 36, justify = (width - 4.2) / (x - 3.6);
    for (const item of placed) item.x = 3.6 + (item.x - 3.6) * justify;
    for (let ly = 0; ly <= 4; ly++) add('line', { x1: 0, x2: width, y1: ly, y2: ly, ...line(.1) });
    add('line', { x1: width - .75, x2: width - .75, y1: 0, y2: 4, ...line(.12) });
    add('line', { x1: width - .2, x2: width - .2, y1: 0, y2: 4, ...line(.4) });

    // Each note's marks share a group so playback can light the sounding note.
    for (const item of placed) {
      item.g = add('g', { class: 'staff-note' });
      add('circle', { class: 'staff-marker', cx: item.x, cy: item.note.isRest ? 2.4 : item.y, r: 1.15 }, item.g);
    }
    for (const group of groups) {
      const head = group[0];
      if (head.note.isRest) {
        add('path', { d: `M${head.x + .45} 1.55L${head.x - .1} 3.3`, ...line(.18), 'stroke-linecap': 'round' }, head.g);
        add('path', { d: `M${head.x - .45} 1.5C${head.x - .3} 2.1 ${head.x + .2} 1.95 ${head.x + .45} 1.55`, ...line(.16) }, head.g);
        add('circle', { cx: head.x - .3, cy: 1.55, r: .25, ...ink }, head.g);
        continue;
      }
      const up = group.reduce((sum, item) => sum + item.y, 0) / group.length >= 2, dir = up ? -1 : 1;
      for (const item of group) {
        const { x: nx, y: ny } = item;
        for (let ly = -1; ly >= ny - .01; ly--) add('line', { x1: nx - 1, x2: nx + 1, y1: ly, y2: ly, ...line(.1) }, item.g);
        for (let ly = 5; ly <= ny + .01; ly++) add('line', { x1: nx - 1, x2: nx + 1, y1: ly, y2: ly, ...line(.1) }, item.g);
        add('ellipse', { cx: nx, cy: ny, rx: .62, ry: .44, transform: `rotate(-20 ${nx} ${ny})`, ...ink }, item.g);
        if (item.accidental === 'sharp') {
          const ax = nx - 1.55;
          add('path', { d: `M${ax - .2} ${ny - 1.1}V${ny + 1.2}M${ax + .2} ${ny - 1.2}V${ny + 1.1}`, ...line(.1) }, item.g);
          add('path', { d: `M${ax - .5} ${ny - .25}L${ax + .5} ${ny - .55}M${ax - .5} ${ny + .55}L${ax + .5} ${ny + .25}`, ...line(.26) }, item.g);
        } else if (item.accidental === 'natural') {
          const ax = nx - 1.45;
          add('path', { d: `M${ax - .3} ${ny - 1.2}V${ny + .5}M${ax + .3} ${ny - .5}V${ny + 1.2}`, ...line(.1) }, item.g);
          add('path', { d: `M${ax - .3} ${ny - .2}L${ax + .3} ${ny - .4}M${ax - .3} ${ny + .45}L${ax + .3} ${ny + .25}`, ...line(.24) }, item.g);
        }
        if (parsed.grooveIndex === 3) add('circle', { cx: nx, cy: ny - dir * (ny % 1 ? .95 : 1.05), r: .17, ...ink }, item.g);
        item.stemX = up ? nx + .57 : nx - .57;
      }
      if (group.length === 1) {
        const { stemX, y, note } = head, end = y + dir * 3.5;
        add('line', { x1: stemX, x2: stemX, y1: y + dir * .15, y2: end, ...line(.12) }, head.g);
        for (let f = 0; f < (note.beats === .25 ? 2 : note.beats === .5 ? 1 : 0); f++) {
          const fy = end - dir * f * .8;
          add('path', { d: `M${stemX} ${fy}c.1 ${-dir} 1.3 ${-dir * 1.3} 1.1 ${-dir * 2.8}c-.05 ${dir * 1.1} -.6 ${dir * 1.5} -1.1 ${dir * 1.7}z`, ...ink }, head.g);
        }
        continue;
      }
      const first = group[0], last = group.at(-1);
      const slope = Math.max(-.15, Math.min(.15, (last.y - first.y) / (last.stemX - first.stemX)));
      const offset = Math[up ? 'min' : 'max'](...group.map(item => item.y + dir * 3.3 - slope * item.stemX));
      const beamY = bx => offset + slope * bx;
      const beam = (x1, x2, level) => {
        const y1 = beamY(x1) - dir * level * .8, y2 = beamY(x2) - dir * level * .8;
        add('path', { d: `M${x1} ${y1}L${x2} ${y2}L${x2} ${y2 - dir * .5}L${x1} ${y1 - dir * .5}z`, ...ink });
      };
      for (const item of group) add('line', { x1: item.stemX, x2: item.stemX, y1: item.y + dir * .15, y2: beamY(item.stemX), ...line(.12) }, item.g);
      beam(first.stemX, last.stemX, 0);
      group.forEach((item, i) => {
        if (item.note.beats !== .25) return;
        const next = group[i + 1], prev = group[i - 1];
        if (next?.note.beats === .25) beam(item.stemX, next.stemX, 1);
        else if (prev?.note.beats !== .25) beam(next ? item.stemX : item.stemX - 1, next ? item.stemX + 1 : item.stemX, 1);
      });
    }
    svg.setAttribute('viewBox', `0 -3.5 ${width} 11`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Fanfare in ${parsed.scale}: ${notes.map(n => n.isRest ? 'rest' : n.name).join(', ')}`);
    return svg;
  }
  function tradingCard(item) {
    const card = document.createElement('article');
    card.className = 'trading-card';
    card.dataset.finish = item.model.grade;
    card.style.setProperty('--card-hue', String(155 + item.rarity.percentile * 1.5));
    if (item.rarity.percentile >= 95) card.classList.add('foil');
    const signX = Math.random() < .5 ? -1 : 1, signY = Math.random() < .5 ? -1 : 1;
    const dur = 0.58 + Math.random() * 0.14, rest = 20 + Math.random() * 4;
    card.style.setProperty('--wobble-rx', `${((7 + Math.random() * 5) * signX).toFixed(1)}deg`);
    card.style.setProperty('--wobble-ry', `${((6 + Math.random() * 6) * signY).toFixed(1)}deg`);
    card.style.setProperty('--wobble-y', `${(22 + Math.random() * 8).toFixed(1)}px`);
    card.style.setProperty('--wobble-dur', `${dur.toFixed(2)}s`);
    card.style.setProperty('--popout-peak', `${(40 + Math.random() * 10).toFixed(1)}px`);
    card.style.setProperty('--popout-rest', `${rest.toFixed(1)}px`);
    card.style.setProperty('--float-min', `${(17 + Math.random() * 3).toFixed(1)}px`);
    card.style.setProperty('--float-max', `${(24 + Math.random() * 4).toFixed(1)}px`);
    card.style.setProperty('--float-y', `${(-1.5 - Math.random() * 1.5).toFixed(1)}px`);
    card.style.setProperty('--float-dur', `${(3.0 + Math.random() * 1.2).toFixed(2)}s`);
    card.style.setProperty('--float-delay', `${dur.toFixed(2)}s`);
    const cardEffects = [];
    // Share the renderer's smoothed light source with every printed foil surface.
    cardEffects.push((x, y) => {
      card.style.setProperty('--foil-angle', `${125 + x * 30 - y * 20}deg`);
      card.style.setProperty('--foil-shadow-x', `${-x * 1.5}px`);
      card.style.setProperty('--foil-shadow-y', `${2 - y}px`);
      card.style.setProperty('--foil-glint', String(.45 + .5 * Math.abs(x * .7 - y * .3)));
    });
    const cardBg = ubuRender.cardMaterials?.(item.model, cardEffects);
    if (cardBg) card.append(cardBg);
    const hologram = document.createElement('div'); hologram.className = 'card-hologram'; hologram.setAttribute('aria-hidden', 'true');
    card.append(hologram);
    const top = document.createElement('div'); top.className = 'card-top';
    const brand = document.createElement('img'); brand.src = 'assets/uburoom-wordmark-brand.svg'; brand.alt = 'uburoom';
    const serialNum = item.result.certificate?.serial || '';
    const favBtn = createHeartButton(serialNum);
    const serial = document.createElement('span'); serial.textContent = serialNum ? '#' + serialNum : '';
    top.append(brand, favBtn, serial);
    // A two-sided coin: the face, and the stamped back that shows when a dance turns it round.
    // Stacked discs between them form a ridged edge, so it turns as a solid disc, not a flat circle.
    const art = document.createElement('div'), ubuArt = document.createElement('div');
    art.className = 'card-art'; ubuArt.className = 'ubu-coin';
    ubuArt.style.setProperty('--coin-color', item.model.attributes.background.hex);
    const COIN_LAYERS = 12;
    for (let i = 0; i < COIN_LAYERS; i++) {
      const layer = document.createElement('i'); layer.className = 'coin-edge';
      layer.style.setProperty('--depth', ((i + .5) / COIN_LAYERS - .5).toFixed(3)); ubuArt.append(layer);
    }
    ubuArt.append(ubuRender(item.model, 'oomark', card, cardEffects), ubuRender.back(item.model, cardEffects));
    art.append(ubuArt);
    let lastDance = -1, dancing = null;
    const dance = () => {
      if (dancing || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      let pick;
      do pick = Math.floor(Math.random() * UBU_DANCES.length); while (pick === lastDance);
      lastDance = pick;
      const { frames, duration } = UBU_DANCES[pick];
      // Added on top of the pop-out float, so the dance never resets its depth.
      dancing = ubuArt.animate(frames, { duration, easing: 'ease-in-out', composite: 'add' });
      dancing.onfinish = dancing.oncancel = () => { dancing = null; };
    };
    const name = document.createElement('h3'); name.textContent = item.model.parts.fullName;
    const badge = document.createElement('div'); badge.className = 'card-ubuquity'; badge.dataset.grade = item.model.grade;
    const caption = document.createElement('span'); caption.className = 'badge-caption'; caption.textContent = 'Ubuquity';
    const lettering = document.createElement('strong'); lettering.className = 'grade-lettering'; lettering.textContent = item.model.grade;
    badge.append(caption, lettering);
    const stats = document.createElement('section'); stats.className = 'card-stats'; stats.setAttribute('aria-label', 'Average stats by group');
    const statsTitle = document.createElement('h4'); statsTitle.textContent = 'Stat profile'; stats.append(statsTitle);
    const groups = [
      ['Movement', '#76b9ef', ['impulse', 'traction', 'spin', 'curve']],
      ['Physical', '#42c66b', ['size', 'mass', 'bounciness', 'grip']],
      ['Engagement', '#ff9954', ['power', 'reach', 'strength', 'stability']],
      ['Super', '#ff7197', ['efficiency', 'synergy', 'chemistry']]
    ];
    for (const [label, color, keys] of groups) {
      const average = keys.reduce((sum, key) => sum + item.model.stats[key], 0) / keys.length;
      const row = document.createElement('div'), caption = document.createElement('span'), bar = document.createElement('div'), fill = document.createElement('i');
      row.className = 'card-stat'; row.style.setProperty('--stat-color', color);
      caption.textContent = label; bar.className = 'stat-bar';
      bar.setAttribute('role', 'meter'); bar.setAttribute('aria-label', label);
      bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '255'); bar.setAttribute('aria-valuenow', average.toFixed(2));
      fill.style.width = `${average / 255 * 100}%`; bar.append(fill); row.append(caption, bar); stats.append(row);
    }
    // The back of the stat panel lists every stat and the Ubuquity rating.
    const statsBack = document.createElement('section'); statsBack.className = 'card-stats card-stats-back'; statsBack.setAttribute('aria-label', 'All stats');
    const backTitle = document.createElement('h4'), fullStats = document.createElement('div');
    backTitle.textContent = 'Full stats'; fullStats.className = 'full-stats';
    const statRow = (label, value, max, color) => {
      const row = document.createElement('div'), name = document.createElement('span'), number = document.createElement('b');
      row.className = 'full-stat'; row.style.setProperty('--stat-color', color); row.style.setProperty('--stat-fill', `${value / max * 100}%`);
      name.textContent = label; number.textContent = String(value); row.append(name, number);
      return row;
    };
    for (const [label, color, keys] of groups) {
      const group = document.createElement('div'), heading = document.createElement('h5');
      heading.textContent = label; heading.style.color = color; group.append(heading);
      if (label === 'Super') {
        const rating = statRow('Ubuquity', item.model.rating, 1023, color);
        const ratingGrade = document.createElement('em'); ratingGrade.dataset.grade = item.model.grade; ratingGrade.textContent = item.model.grade;
        rating.firstChild.after(ratingGrade); group.append(rating);
      }
      for (const key of keys) group.append(statRow(key[0].toUpperCase() + key.slice(1), item.model.stats[key], 255, color));
      fullStats.append(group);
    }
    statsBack.append(backTitle, fullStats);
    const statFlip = document.createElement('div'); statFlip.className = 'stat-flip';
    statFlip.setAttribute('aria-pressed', 'false');
    statFlip.setAttribute('aria-label', 'Flip between stat profile and full stats'); statsBack.inert = true;
    statFlip.append(stats, statsBack);
    const flipStats = () => {
      const flipped = statFlip.classList.toggle('flipped');
      statFlip.setAttribute('aria-pressed', String(flipped)); stats.inert = flipped; statsBack.inert = !flipped;
    };
    const pressable = (el, action) => {
      el.tabIndex = 0; el.setAttribute('role', 'button');
      el.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); action();
      });
    };
    pressable(statFlip, flipStats);
    art.setAttribute('aria-label', `Make ${item.model.parts.fullName} dance`);
    pressable(art, dance);
    const targets = [[statFlip, flipStats], [art, dance]];
    const rarity = document.createElement('div'); rarity.className = 'card-rarity';
    const rarityCaption = document.createElement('span'), rarityValue = document.createElement('strong');
    rarityCaption.textContent = 'Rarity'; rarityValue.textContent = rarityScore(item.rarity.percentile);
    rarity.append(rarityCaption, rarityValue);
    const supers = document.createElement('section'); supers.className = 'card-supers'; supers.setAttribute('aria-label', 'Supers');
    const supersCaption = document.createElement('span'), supersIcons = document.createElement('div');
    supersCaption.textContent = 'Supers';
    for (const id of new Set(item.model.supers.map(slot => slot % 8))) {
      const power = ububallPhysics.SUPERS[id], icon = document.createElement('img');
      icon.src = power.icon; icon.alt = power.name; icon.title = `${power.name}: ${power.desc}`;
      supersIcons.append(icon);
    }
    supers.append(supersCaption, supersIcons);
    const side = document.createElement('div'); side.className = 'card-side'; side.append(statFlip);
    if (item.model.voice && window.ubuAudio) {
      const parsed = ubuAudio.parseVoiceInfo(item.model.voice);
      const fanfare = document.createElement('section'); fanfare.className = 'card-fanfare';
      const heading = document.createElement('h4'), meta = document.createElement('span');
      heading.textContent = 'Fanfare'; meta.textContent = `${parsed.tempoBpm} BPM · ${parsed.groove}`;
      const staff = fanfareStaff(parsed), marks = staff.querySelectorAll('.staff-note');
      heading.append(meta); fanfare.append(heading, staff); side.append(fanfare);
      fanfare.setAttribute('aria-label', 'Play fanfare'); fanfare.setAttribute('aria-pressed', 'false');
      let playback = null;
      const playFanfare = () => {
        if (playback) { playback.stop(); return; }
        fanfare.classList.add('is-playing'); fanfare.setAttribute('aria-pressed', 'true');
        playback = ubuAudio.playFanfare(item.model.voice, null, index => {
          marks.forEach((mark, i) => mark.classList.toggle('is-playing', i === index));
          if (index !== -1) return;
          playback = null; fanfare.classList.remove('is-playing'); fanfare.setAttribute('aria-pressed', 'false');
        });
      };
      pressable(fanfare, playFanfare);
      targets.push([fanfare, playFanfare]);
    }
    // Touch tilting captures the pointer on the card, so hit-test the panels from the card's clicks.
    card.addEventListener('click', event => {
      for (const [el, action] of targets) {
        const box = el.getBoundingClientRect();
        if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) return action();
      }
    });
    card.append(top, badge, art, name, side, rarity, supers);
    return card;
  }
  function showReveal() {
    if (!pack.seen) {
      pack.seen = 1;
      try { savePack(); } catch (error) { pack.seen = 0; throw error; }
    }
    const index = revealIndex, item = pack.items[index];
    const last = index === pack.items.length - 1;
    $('reveal-progress').textContent = `${index + 1} / ${pack.items.length}`;
    // Render the background first so the visible card owns the shared lighting controller.
    display(item.text, item.result, false);
    $('card-stage').replaceChildren(tradingCard(item));
    $('reveal-dots').replaceChildren(...pack.items.map((_, i) => { const dot = document.createElement('span'); dot.className = i === index ? 'current' : i < pack.seen ? 'seen' : ''; return dot; }));
    $('prev-ubu').disabled = index === 0;
    $('next-ubu').disabled = last;
    $('finish-pack').hidden = pack.seen < pack.items.length;
    showMintedItem(item);
    if (!$('reveal').open) $('reveal').showModal();
  }
  function navigatePack(direction) {
    const target = revealIndex + direction;
    if (!pack || target < 0 || target >= pack.items.length) return;
    try {
      const previousSeen = pack.seen;
      if (target >= pack.seen) {
        pack.seen = target + 1;
        try { savePack(); } catch (error) { pack.seen = previousSeen; throw error; }
      }
      revealIndex = target;
      showReveal();

      if (document.activeElement.disabled) (target === 0 ? $('next-ubu') : $('prev-ubu')).focus();
    } catch (error) { $('reveal-progress').textContent = `Could not save your place: ${error.message}`; }
  }
  $('prev-ubu').addEventListener('click', () => navigatePack(-1));
  $('next-ubu').addEventListener('click', () => navigatePack(1));
  $('reveal').addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); navigatePack(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  function finishPack() {
    if (!pack || pack.seen < pack.items.length) return false;
    try {
      localStorage.removeItem(packKey);
      pack = null;
      offer = null; $('pack-choices').hidden = true; $('pack-legend').hidden = true;
      packScene?.reset();
      status('');
      updatePackButton();

      return true;
    } catch (error) {
      $('reveal-progress').textContent = error.message;
      return false;
    }
  }
  $('finish-pack').addEventListener('click', () => {
    if (finishPack()) $('reveal').close();
  });
  $('pause-reveal').addEventListener('click', () => {
    if (pack && pack.seen >= pack.items.length) finishPack();
    $('reveal').close();
  });
  $('reveal').addEventListener('close', () => {
    if (pack && pack.seen >= pack.items.length) finishPack();
    updatePackButton();
    $('mint').focus();
  });
  const status = text => { $('status').textContent = text; };
  async function trustedKey(mint, id) {
    if (!config.ready || mint !== config.mint || !Object.hasOwn(config.keys, id)) return null;
    if (!keys.has(id)) keys.set(id, crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: config.keys[id], ext: true }, 'Ed25519', false, ['verify']));
    return keys.get(id);
  }
  async function inspect(text) { return ubuFile.read(text, { resolveKey: trustedKey }); }
  function display(text, result, openModal = false) {
    const model = ubu.decode(ubu.fromCode(result.dna));
    const r = window.rarity ? rarity.scoreRarity(model) : null;
    const serial = result.certificate ? result.certificate.serial : null;
    current = { text, result, model, rarity: r, name: model.parts.fullName, serial };

    setViewerView(viewerView);
    $('ubunym').textContent = model.parts.fullName;
    const rarityText = r ? ` · Rarity ${r.percentile.toFixed(3)} / 100 (${r.bits.toFixed(6)} bits)` : '';
    const grade = document.createElement('strong'); grade.dataset.grade = model.grade; grade.textContent = model.grade;
    $('details').replaceChildren('Ubuquity ', grade, rarityText + (serial ? ` · #${serial}` : ''));
    $('authenticity').textContent = result.type === 'signed' ? 'Verified mint certificate' : 'Custom · unsigned';
    $('download').hidden = false;
    window.ubuAudio?.stop();
    renderViewerVoice(model.voice);

    if (serial && collectionMap.has(serial)) {
      $('viewer-fav').hidden = false;
      const fav = isFavorite(serial);
      $('viewer-fav').classList.toggle('is-favorite', fav);
      $('viewer-fav').setAttribute('aria-pressed', String(fav));
    } else {
      $('viewer-fav').hidden = true;
    }

    if (openModal && !$('viewer').open) {
      $('viewer').showModal();
    }
  }

  function setViewerView(view) {
    if (!current) return;
    viewerView = view;
    for (const tab of document.querySelectorAll('.viewer-tabs [role="tab"]')) {
      const selected = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = $(tab.getAttribute('aria-controls'));
      panel.hidden = !selected;
      panel.replaceChildren();
      if (selected) panel.append(view === 'card' ? tradingCard(current)
        : view === 'token' ? tokenCoin(current.model) : ubuRender(current.model));
    }
  }
  // Rim tones for the token's edge, matching each grade's enamel metal (satin nickel otherwise).
  const TOKEN_EDGE = { S: '#c98a55', 'S+': '#c98185', U: '#9a68c4', UBU: '#9a68c4' };
  // The token is a two-sided enamel coin: heads is the ubu, tails its oomarks. Clicking it, or
  // Flip, tosses it end over end to land on a random side.
  function tokenCoin(model) {
    const view = document.createElement('div'), tilt = document.createElement('div'), coin = document.createElement('div');
    view.className = 'token-view'; tilt.className = 'token-tilt'; coin.className = 'token-coin';
    coin.style.setProperty('--edge', TOKEN_EDGE[model.grade] || '#9fa2a2');
    const effects = [], EDGE_LAYERS = 14;
    for (let i = 0; i < EDGE_LAYERS; i++) {
      const layer = document.createElement('i'); layer.className = 'token-edge';
      layer.style.setProperty('--depth', ((i + .5) / EDGE_LAYERS - .5).toFixed(3)); coin.append(layer);
    }
    coin.append(ubuRender.token(model, tilt, effects), ubuRender.tokenBack(model, effects));
    tilt.append(coin);
    const note = document.createElement('p'), flipButton = document.createElement('button'), result = document.createElement('p');
    note.className = 'token-note'; note.textContent = "If it's heads, you live... if it's tails, you die...";
    flipButton.type = 'button'; flipButton.className = 'token-flip'; flipButton.textContent = 'Flip';
    result.className = 'token-result'; result.setAttribute('aria-live', 'polite');
    let side = 0, flipping = false;
    const flip = () => {
      if (flipping) return;
      flipping = true; flipButton.disabled = true; result.textContent = '';
      const land = Math.random() < .5 ? 0 : 1, from = side * 180, to = (4 + Math.floor(Math.random() * 2)) * 360 + land * 180;
      const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1400;
      window.ubuAudio?.playCoin('flick');
      const toss = coin.animate([
        { transform: `translateY(0) rotateX(${from}deg) scale(1)`, easing: 'cubic-bezier(.2, .7, .4, 1)' },
        { transform: `translateY(-42%) rotateX(${(from + to) / 2}deg) scale(1.12)`, offset: .45, easing: 'cubic-bezier(.6, 0, .8, .4)' },
        { transform: `translateY(0) rotateX(${to}deg) scale(1)`, offset: .82, easing: 'ease-out' },
        { transform: `translateY(-3%) rotateX(${to}deg) scale(1)`, offset: .9, easing: 'ease-in' },
        { transform: `translateY(0) rotateX(${to}deg) scale(1)` }
      ], { duration, fill: 'forwards' });
      setTimeout(() => window.ubuAudio?.playCoin('land'), duration * .82);
      toss.onfinish = () => {
        side = land; coin.style.transform = `rotateX(${land * 180}deg)`; toss.cancel();
        flipping = false; flipButton.disabled = false;
        result.textContent = land ? 'Tails. You die.' : 'Heads. You live.';
      };
    };
    tilt.addEventListener('click', flip);
    flipButton.addEventListener('click', flip);
    view.append(tilt, note, flipButton, result);
    return view;
  }
  const viewTabs = [...document.querySelectorAll('.viewer-tabs [role="tab"]')];
  for (const [index, tab] of viewTabs.entries()) {
    tab.addEventListener('click', () => setViewerView(tab.dataset.view));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % viewTabs.length;
      else if (event.key === 'ArrowLeft') next = (index + viewTabs.length - 1) % viewTabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = viewTabs.length - 1;
      else return;
      event.preventDefault();
      setViewerView(viewTabs[next].dataset.view);
      viewTabs[next].focus();
    });
  }

  $('close-viewer').addEventListener('click', () => $('viewer').close());
  $('viewer').addEventListener('click', event => {
    if (event.target === $('viewer')) $('viewer').close();
  });
  $('viewer-fav').addEventListener('click', () => {
    if (current?.serial) void toggleFavorite(current.serial);
  });

  let viewerNoteChips = [];

  function renderViewerVoice(voice) {
    const infoEl = $('viewer-voice-info');
    if (!infoEl) return;
    infoEl.replaceChildren();
    viewerNoteChips = [];
    if (!voice || !window.ubuAudio) return;

    const parsed = window.ubuAudio.parseVoiceInfo(voice);
    const tags = document.createElement('div');
    tags.className = 'voice-tags';

    const makeTag = (label, value) => {
      const tag = document.createElement('span');
      tag.className = 'voice-tag';
      const lbl = document.createElement('span');
      lbl.textContent = label + ':';
      const val = document.createElement('strong');
      val.textContent = value;
      tag.append(lbl, val);
      return tag;
    };

    tags.append(
      makeTag('Voice', parsed.instrument),
      makeTag('Pitch', `${parsed.rootName} (${Math.round(parsed.rootFreq)} Hz)`),
      makeTag('Scale', parsed.scale),
      makeTag('Tempo', `${parsed.tempoBpm} BPM`),
      makeTag('Groove', parsed.groove)
    );

    const fanfareRow = document.createElement('div');
    fanfareRow.className = 'fanfare-notes-strip';

    parsed.notes.forEach((note, i) => {
      const chip = document.createElement('span');
      chip.className = 'fanfare-note-chip' + (note.isRest ? ' is-rest' : '');
      chip.textContent = note.isRest ? '—' : note.name;
      chip.title = note.isRest ? `Note ${i + 1}: Rest` : `Note ${i + 1}: ${note.name} (Degree ${note.degree + 1})`;
      fanfareRow.append(chip);
      viewerNoteChips.push(chip);
    });

    infoEl.append(tags, fanfareRow);
  }

  $('viewer-voice-tone')?.addEventListener('click', () => {
    if (!current?.model?.voice || !window.ubuAudio) return;
    const btn = $('viewer-voice-tone');
    btn.classList.add('is-active');
    window.ubuAudio.playVoice(current.model.voice);
    setTimeout(() => btn.classList.remove('is-active'), 400);
  });

  $('viewer-voice-fanfare')?.addEventListener('click', () => {
    if (!current?.model?.voice || !window.ubuAudio) return;
    const btn = $('viewer-voice-fanfare');
    btn.classList.add('is-active');
    window.ubuAudio.playFanfare(current.model.voice, null, (index, note) => {
      viewerNoteChips.forEach((chip, i) => {
        chip.classList.toggle('is-playing-note', i === index);
      });
      if (index === -1) {
        btn.classList.remove('is-active');
      }
    });
  });

  $('viewer')?.addEventListener('close', () => {
    window.ubuAudio?.stop();
    viewerNoteChips.forEach(chip => chip.classList.remove('is-playing-note'));
    $('viewer-voice-tone')?.classList.remove('is-active');
    $('viewer-voice-fanfare')?.classList.remove('is-active');
  });

  async function api(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || 'The mint could not complete this request.'); error.status = response.status; throw error; }
    return data;
  }
  const post = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': session.csrf }, body: JSON.stringify(data) });

  function compareItems(a, b) {
    if (a.pending !== b.pending) return Number(Boolean(a.pending)) - Number(Boolean(b.pending));
    const sort = $('sort-ubus')?.value || 'recent';
    if (sort === 'serial') return a.serial.localeCompare(b.serial);
    if (sort === 'rarity') return (b.rarity?.bits || 0) - (a.rarity?.bits || 0) || b.serial.localeCompare(a.serial);
    if (sort === 'favorite' && a.favorite !== b.favorite) return Number(b.favorite) - Number(a.favorite);
    if (sort === 'old') return (a.issuedAt || 0) - (b.issuedAt || 0) || a.serial.localeCompare(b.serial);
    return (b.issuedAt || 0) - (a.issuedAt || 0) || b.serial.localeCompare(a.serial);
  }

  function collectionCard(item) {
    if (item.pending) {
      const pending = document.createElement('p');
      pending.textContent = `#${item.serial} · Certificate pending`;
      pending.dataset.serial = item.serial;
      return pending;
    }
    const card = document.createElement('button');
    card.className = 'card';
    card.dataset.serial = item.serial;
    const favBtn = createHeartButton(item.serial);
    const thumb = ubuRender(item.model, 'ubu-thumb');
    const name = document.createElement('span'); name.textContent = item.model.parts.fullName;
    const serial = document.createElement('span'); serial.textContent = '#' + item.serial;
    card.append(favBtn, thumb, name, serial);
    card.addEventListener('click', () => {
      display(item.certificate, item.result, true);
      status('');
    });
    return card;
  }

  // Preserve thumbnail DOM nodes and move only the card whose ordering changed.
  function insertCard(item) {
    const grid = $('ubus');
    let node = cardMap.get(item.serial);
    if (!node) {
      node = collectionCard(item);
      cardMap.set(item.serial, node);
    }
    if (grid.firstElementChild && !grid.firstElementChild.dataset.serial) grid.replaceChildren();
    // Binary search among existing DOM nodes; no sorting or thumbnail regeneration.
    let low = 0, high = grid.children.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      const other = collectionMap.get(grid.children[mid].dataset.serial);
      if (other && compareItems(other, item) < 0) low = mid + 1;
      else high = mid;
    }
    const before = grid.children[low] || null;
    if (before !== node) grid.insertBefore(node, before);
  }

  function showMintedItem(item) {
    const serial = item.result.certificate.serial;
    const old = collectionMap.get(serial);
    if (old?.certificate === item.text) return;
    if (old?.pending) { cardMap.get(serial)?.remove(); cardMap.delete(serial); }
    const record = {
      serial, certificate: item.text, result: item.result, model: item.model,
      rarity: item.rarity, issuedAt: item.result.certificate.issuedAt, favorite: old?.favorite || false
    };
    collectionMap.set(serial, record);
    if (document.querySelector('#ubus > p:not([data-serial])')) $('ubus').replaceChildren();
    insertCard(record);
    if (current?.serial === serial) {
      $('viewer-fav').hidden = false;
      syncFavoriteButtons(serial);
    }
    $('collection').hidden = false;
  }

  const certCache = new Map();
  let pageLoading = false;
  async function collection(reset = false) {
    if (pendingKey && localStorage.getItem(pendingKey + ':choice')) return;
    if (!reset && (pageLoading || !next)) return;
    const version = reset ? ++collectionVersion : collectionVersion;
    const sort = $('sort-ubus').value || 'recent';
    const cursor = reset ? '' : next;
    pageLoading = true;
    try {
      const data = await api('/api/ubus?sort=' + encodeURIComponent(sort) +
        (cursor ? '&after=' + encodeURIComponent(cursor) : ''));
      const items = await Promise.all(data.ubus.map(async entry => {
        if (unseen(entry.serial)) return null;
        if (!entry.certificate) return { serial: entry.serial, favorite: entry.favorite, pending: true };
        let cached = certCache.get(entry.certificate);
        if (!cached) {
          const result = await inspect(entry.certificate);
          const model = ubu.decode(ubu.fromCode(result.dna));
          cached = { result, model, rarity: rarity.scoreRarity(model), issuedAt: result.certificate.issuedAt };
          certCache.set(entry.certificate, cached);
        }
        return { serial: entry.serial, certificate: entry.certificate, favorite: entry.favorite,
          result: cached.result, model: cached.model, rarity: cached.rarity, issuedAt: cached.issuedAt };
      }));
      if (version !== collectionVersion || sort !== $('sort-ubus').value ||
          (pendingKey && localStorage.getItem(pendingKey + ':choice'))) return;

      // Replace the page in one synchronous update on explicit sort/initial load.
      if (reset) {
        collectionMap.clear();
        cardMap.clear();
        $('ubus').replaceChildren();
      }
      for (const item of items) {
        if (!item) continue;
        const previous = collectionMap.get(item.serial);
        if (previous?.pending && !item.pending) {
          cardMap.get(item.serial)?.remove();
          cardMap.delete(item.serial);
        }
        collectionMap.set(item.serial, item);
        insertCard(item);
        if (current?.serial === item.serial) syncFavoriteButtons(item.serial);
      }
      next = data.next;
      // A first-page refresh must retain already revealed pack items not on that page.
      if (reset && pack) for (const item of pack.items.slice(0, pack.seen)) showMintedItem(item);
      if (!collectionMap.size && !next) {
        const empty = document.createElement('p');
        empty.textContent = 'No revealed ubus.';
        $('ubus').append(empty);
      }
      $('collection-sentinel').hidden = !next;
      $('more').hidden = !next || Boolean(observer);
      $('collection').hidden = false;
    } catch (error) {
      if (version === collectionVersion) {
        status('Could not load collection: ' + error.message);
        if (error.message.startsWith('Preparing rarity sorting')) {
          setTimeout(() => {
            if (version === collectionVersion && $('sort-ubus').value === sort) void collection(reset);
          }, 1200);
        }
      }
    } finally {
      if (version === collectionVersion) pageLoading = false;
    }
  }

  function loadMore() { return collection(false); }

  let observer = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && next && !pageLoading && !busy) {
          void loadMore();
        }
      }
    }, { rootMargin: '300px' });
    const sentinel = $('collection-sentinel');
    if (sentinel) observer.observe(sentinel);
  }

  $('sort-ubus').addEventListener('change', () => { void collection(true); });
  $('more').addEventListener('click', () => { void loadMore(); });

  $('import').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > ubuFile.MAX_BYTES) throw new Error('A .ubu file must contain 1–1024 bytes.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await inspect(bytes);
      display(new TextDecoder().decode(bytes), result, true); status('');
    } catch (error) { status(error.message); }
    finally { event.target.value = ''; }
  });
  $('download').addEventListener('click', () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([current.text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = current.name.replaceAll(' ', '-') + '.ubu';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  function showChoices(data) {
    offer = data;
    $('pack-choices').hidden = false; $('pack-legend').hidden = false;
    $('pack-choices').classList.remove('choosing');
    choiceViews.forEach((view, i) => {
      const option = data.choices[i]; view.card.classList.remove('selected');
      view.scene?.setHints(option.type, option.hints);
      const hasSpecial = option.hints.some(h => h.textured);
      const description = `Pack ${i + 1}: backgrounds ${option.hints.map(h => h.background).join(', ')}${hasSpecial ? '; special finish in pack' : '; matte finishes'}`;
      view.button.setAttribute('aria-label', description);
      view.button.title = description;
    });
  }
  async function acceptPack(data) {
    pack = await readPack(data.certificates);
    try { savePack(); } catch (error) { pack = null; throw error; }
    localStorage.removeItem(pendingKey); localStorage.removeItem(pendingKey + ':choice');
    offer = null;
  }
  async function loadChoices() {
    if (busy || !session?.owner || pack) return;
    busy = true; updatePackButton();
    try {
      let request = localStorage.getItem(pendingKey);
      if (!request) { request = crypto.randomUUID(); localStorage.setItem(pendingKey, request); }
      status('');
      const data = await api('/api/packs', post({ request }));
      if (data.completed) {
        await acceptPack(await api('/api/mint', post({ request: data.request })));
        $('pack-choices').hidden = true; $('pack-legend').hidden = true;
        status('Your selected pack is ready. Continue to reveal it.');
      } else {
        localStorage.setItem(pendingKey, data.request);
        localStorage.removeItem(pendingKey + ':choice');
        showChoices(data);
      }
    } catch (error) { status(error.message); }
    finally { busy = false; updatePackButton(); }
  }
  async function selectPack(index) {
    if (busy || pack || !offer) return;
    const option = offer.choices[index], selection = { request: offer.request, choice: option.choice };
    busy = true; updatePackButton();
    try {
      localStorage.setItem(pendingKey + ':choice', JSON.stringify(selection));
      ++collectionVersion;
      const data = await api('/api/mint', post(selection));
      await acceptPack(data);
      packScene = choiceViews[index].scene;
      choiceViews[index].card.classList.add('selected'); $('pack-choices').classList.add('choosing');
      await packScene?.play(pack.items.length, pack.items.map(item => item.model));
      $('pack-choices').hidden = true; $('pack-legend').hidden = true;
      revealIndex = 0;
      showReveal();
      status('');
    } catch (error) {
      // Refresh authoritative state after an ambiguous selection; never submit a
      // second choice automatically. A committed selection is recovered by request.
      offer = null; $('pack-choices').hidden = true; $('pack-legend').hidden = true;
      status(error.message + ' Resume pack choices to recover or try again.');
    } finally { busy = false; packScene?.reset(); updatePackButton(); }
  }
  $('mint').addEventListener('click', async () => {
    if (busy || !session?.owner) return;
    if (pack) {
      try { revealIndex = Math.max(0, pack.seen - 1); showReveal(); } catch (error) { status(error.message); }
    } else await loadChoices();
  });
  $('logout').addEventListener('click', async () => {
    try { await api('/api/logout', post({})); location.reload(); } catch (error) { status(error.message); }
  });
  (async () => {
    try {
      config = await api('/api/config');
      $('login').hidden = !config.login;
      if (config.login) {
        $('login').href = '/auth/discord?return=' + encodeURIComponent((location.pathname === '/index.html' ? '/' : location.pathname) + location.search);
        session = await api('/api/session');
      }
      async function handleSession(s) {
        session = s;
        if (session?.owner) {
          $('login').hidden = true;
          pendingKey = `ubumint:pending:${config.mint}:${session.owner}`;
          packKey = `ubumint:reveal:${config.mint}:${session.owner}`;
          const saved = localStorage.getItem(packKey);
          if (saved) {
            const data = JSON.parse(saved); pack = await readPack(data.certificates, data.seen);
            localStorage.removeItem(pendingKey);
            localStorage.removeItem(pendingKey + ':choice');
          }
          updatePackButton();
          status(config.ready && config.lifetimeLimit ? `${config.lifetimeLimit} pack${config.lifetimeLimit === 1 ? '' : 's'} per account` : 'Minting closed');
          if (pack) status('');
          else if (localStorage.getItem(pendingKey)) status('Opening interrupted. Retry to continue.');
          if (config.ready) {
            try { await migrateBrowserFavorites(); } catch (error) { status('Could not migrate browser favorites: ' + error.message); }
            if (!pack && (config.lifetimeLimit || localStorage.getItem(pendingKey))) await loadChoices();
            await collection(true);
          }
        } else { $('pack-hint').textContent = ''; status(config.login ? 'Sign in to open packs.' : 'Minting closed'); }
      }
      window.addEventListener('ubu:session', event => {
        if (event.detail?.owner && (!session?.owner || session.owner !== event.detail.owner)) {
          handleSession(event.detail);
        }
      });
      await handleSession(session);
    } catch (error) { status(error.message); }
  })();
})();
