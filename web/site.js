'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let config = { ready: false }, session = null, current = null, busy = false;
  let packScene = null, offer = null;
  const choiceViews = Array.from({ length: 3 }, (_, i) => {
    const card = document.createElement('article'); card.className = 'pack-option';
    const button = document.createElement('button'); button.className = 'candy-pack'; button.disabled = true;
    button.setAttribute('aria-label', `Choose pack ${i + 1}`);
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); button.append(canvas);
    const sparkle = document.createElement('span'); sparkle.className = 'pack-sparkle'; sparkle.setAttribute('aria-hidden', 'true');
    for (let s = 0; s < 3; s++) sparkle.append(Object.assign(document.createElement('i'), { textContent: '\u2726' }));
    card.style.setProperty('--bob-delay', `${-i * .7}s`);
    card.append(button, sparkle); $('pack-choices').append(card);
    let scene = null;
    try { scene = createPackScene(canvas); } catch { canvas.hidden = true; button.textContent = `Pack ${i + 1}`; }
    button.addEventListener('click', () => {
      // A tap-to-open wrapper takes taps on the chosen pack; otherwise a click picks the pack.
      if (!scene?.tap()) { selectPack(i); return; }
      if (!scene.awaitingTap()) { button.disabled = true; $('pack-hint').textContent = ''; }
    });
    return { card, button, scene };
  });
  // Sounds need a page gesture first; packs dealt on page load, or while another screen is up, stay silent.
  const sound = (kind, name) => { if (navigator.userActivation?.hasBeenActive && !$('pack-choices').closest('[data-screen]').hidden) window.ubuAudio?.[kind]?.(name); };
  // The signup and daily packs share one horizontal wrapper and the regular reveal.
  function starterPack(id, kind, label) {
    const button = $(id).querySelector('button'), canvas = button.querySelector('canvas');
    let scene = null;
    try { scene = createPackScene(canvas); scene.setStarter(label); } catch { canvas.hidden = true; button.textContent = label; }
    const view = { button, scene };
    button.addEventListener('click', () => openStarter(kind, view));
    return view;
  }
  async function openStarter(kind, view) {
    if (busy) return;
    if (pack) { revealIndex = Math.max(0, pack.seen - 1); showReveal(); return; } // Finish the pack in progress first.
    busy = true; view.button.disabled = true; updatePackButton();
    try {
      const data = await ubuStarter.claim(kind);
      pack = await readPack(data.certificates);
      savePack();
      await view.scene?.play(pack.items.length, pack.items.map(item => item.model));
      revealIndex = 0;
      showReveal();
      status('');
    } catch (error) {
      pack = null;
      if (await gameUi.confirm({ title: 'Could not open your pack', message: error.message, confirmLabel: 'Retry' })) {
        busy = false; view.button.disabled = false;
        return openStarter(kind, view);
      }
    } finally {
      busy = false; view.button.disabled = false; view.scene?.reset(); updatePackButton();
    }
    void ubuStarter.refresh().catch(() => {});
  }
  // The daily pack comes before the shop; regular packs are dealt once it is opened.
  function syncDaily() {
    const daily = Boolean(session?.owner && ubuStarter.status?.daily);
    $('pack-title').parentElement.classList.toggle('settled', ubuStarter.known);
    $('daily-pack').hidden = !daily || Boolean(pack);
    $('pack-title').textContent = daily ? 'Your daily pack' : 'Choose your pack';
    $('pack-subtitle').textContent = daily ? 'Tap it to crack it open!' : 'Pick a pack to crack open!';
    if (daily) { $('pack-choices').hidden = true; status('', true); }
    else if (ubuStarter.status && offer) $('pack-choices').hidden = false;
    else if (ubuStarter.status && !pack && config.ready && (config.lifetimeLimit || localStorage.getItem(pendingKey))) void loadChoices();
  }
  let outOfPacks = false, dealFailed = false;
  let pack = null, packKey = '', pendingKey = '', revealIndex = 0;
  let viewerView = 'ubu';
  const FAV_STORAGE_KEY = 'ubumint:favorites';
  const isFavorite = serial => ubuList.get(serial)?.favorite === true;
  function toggleFavorite(serial) {
    ubuList.setFavorite(serial, !isFavorite(serial)).catch(error => status('Could not update favorite: ' + error.message));
  }
  function createHeartButton(serial) {
    const btn = document.createElement('button');
    btn.className = 'card-heart';
    btn.type = 'button';
    btn.title = 'Favorite';
    btn.setAttribute('aria-label', `Favorite ${ubuList.serialLabel(serial)}`);
    btn.dataset.serial = serial;
    btn.classList.toggle('is-favorite', isFavorite(serial));
    btn.setAttribute('aria-pressed', String(isFavorite(serial)));
    btn.append(ubuList.heartIcon());
    btn.addEventListener('click', event => {
      event.stopPropagation();
      toggleFavorite(serial);
    });
    return btn;
  }
  // Reveal and viewer hearts follow the shared list; its tiles update themselves.
  function syncFavoriteButtons() {
    for (const btn of document.querySelectorAll('.card-heart[data-serial]')) {
      const favorite = isFavorite(btn.dataset.serial);
      btn.classList.toggle('is-favorite', favorite);
      btn.setAttribute('aria-pressed', String(favorite));
    }
    if (current?.serial) {
      $('viewer-fav').hidden = !ubuList.get(current.serial);
      $('viewer-fav').classList.toggle('is-favorite', isFavorite(current.serial));
      $('viewer-fav').setAttribute('aria-pressed', String(isFavorite(current.serial)));
    }
  }
  window.addEventListener('ubu-list:change', syncFavoriteButtons);
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
  // The shop deals packs by itself; the one button only continues an unrevealed pack or retries.
  function updatePackButton() {
    $('mint').textContent = pack ? 'Continue pack' : 'Try again';
    $('mint').hidden = busy || !(pack || dealFailed);
    for (const view of choiceViews) view.button.disabled = busy || !offer || Boolean(pack);
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
    card.style.setProperty('--wobble-y', `${((22 + Math.random() * 8) / 16).toFixed(4)}rem`);
    card.style.setProperty('--wobble-dur', `${dur.toFixed(2)}s`);
    card.style.setProperty('--popout-peak', `${((40 + Math.random() * 10) / 16).toFixed(4)}rem`);
    card.style.setProperty('--popout-rest', `${(rest / 16).toFixed(4)}rem`);
    card.style.setProperty('--float-min', `${((17 + Math.random() * 3) / 16).toFixed(4)}rem`);
    card.style.setProperty('--float-max', `${((24 + Math.random() * 4) / 16).toFixed(4)}rem`);
    card.style.setProperty('--float-y', `${((-1.5 - Math.random() * 1.5) / 16).toFixed(4)}rem`);
    card.style.setProperty('--float-dur', `${(3.0 + Math.random() * 1.2).toFixed(2)}s`);
    card.style.setProperty('--float-delay', `${dur.toFixed(2)}s`);
    const cardEffects = [];
    // Share the renderer's smoothed light source with every printed foil surface.
    cardEffects.push((x, y) => {
      card.style.setProperty('--foil-angle', `${125 + x * 30 - y * 20}deg`);
      card.style.setProperty('--foil-shadow-x', `${(-x * 1.5 / 16).toFixed(4)}rem`);
      card.style.setProperty('--foil-shadow-y', `${((2 - y) / 16).toFixed(4)}rem`);
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
    const serial = document.createElement('span'); serial.textContent = serialNum ? ubuList.serialLabel(serialNum) : '';
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
    rarityCaption.textContent = 'Rarity'; rarityValue.textContent = ubuList.rarityScore(item.rarity.percentile);
    rarity.append(rarityCaption, rarityValue);
    const supers = document.createElement('section'); supers.className = 'card-supers'; supers.setAttribute('aria-label', 'Supers');
    const supersCaption = document.createElement('span'), supersIcons = document.createElement('div');
    supersCaption.textContent = 'Supers';
    for (const id of new Set(item.model.supers.map(slot => slot % 8))) {
      const mastery = ububallPhysics.superMastery(item.model.supers, id);
      const power = ububallPhysics.SUPERS[id], icon = document.createElement('img');
      icon.src = power.icon; icon.alt = mastery.displayName;
      const masteryDesc = mastery.copies > 1 ? ` (+${(mastery.bonusTicks / 240).toFixed(1)}s duration, +${mastery.bonusRefund}% refund)` : '';
      icon.title = `${mastery.displayName}: ${power.desc}${masteryDesc}`;
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
      offer = null; $('pack-choices').hidden = true;
      packScene?.reset();
      status('');
      updatePackButton();
      syncDaily();
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
  // Collection shares this status line except for pack-only messages.
  const status = (text, packOnly = false) => {
    $('status').textContent = text;
    if (!packOnly) collectionStatus(text);
  };
  function collectionStatus(note) {
    $('collection-status').textContent = note;
    $('collection-status').hidden = !note;
  }
  function collectionRecovery({ packs = false, retry = false } = {}) {
    $('collection-recovery').hidden = false;
    $('collection-packs').hidden = !packs;
    $('collection-retry').hidden = !retry;
  }
  for (const id of ['mint-retry', 'collection-retry']) $(id).onclick = () => location.reload();
  async function inspect(text) { return ubuFile.read(text, { resolveKey: ubuList.trustedKey }); }
  function display(text, result, openModal = false) {
    const model = ubu.decode(ubu.fromCode(result.dna));
    const r = window.rarity ? rarity.scoreRarity(model) : null;
    const serial = result.certificate ? result.certificate.serial : null;
    current = { text, result, model, rarity: r, name: model.parts.fullName, serial };

    $('ubunym').textContent = model.parts.fullName;
    const rarityText = r ? ` · Rarity ${r.percentile.toFixed(3)} / 100 (${r.bits.toFixed(6)} bits)` : '';
    const grade = document.createElement('strong'); grade.dataset.grade = model.grade; grade.textContent = model.grade;
    $('details').replaceChildren('Ubuquity ', grade, rarityText + (serial ? ' · ' + ubuList.serialLabel(serial) : ''));
    $('authenticity').textContent = result.type === 'signed' ? 'Verified mint certificate' : 'Custom · unsigned';
    $('download').hidden = false;
    window.ubuAudio?.stop();
    renderViewerVoice(model.voice);
    setViewerView(viewerView);

    $('viewer-fav').hidden = true;
    syncFavoriteButtons();

    if (openModal && !$('viewer').open) {
      $('viewer').showModal();
    }
  }

  function renderViewerStats(model) {
    const container = $('viewer-stats');
    if (!container) return;
    container.replaceChildren();
    const groups = [
      ['Movement', '#76b9ef', ['impulse', 'traction', 'spin', 'curve']],
      ['Physical', '#42c66b', ['size', 'mass', 'bounciness', 'grip']],
      ['Engagement', '#ff9954', ['power', 'reach', 'strength', 'stability']],
      ['Super', '#ff7197', ['efficiency', 'synergy', 'chemistry']]
    ];
    for (const [groupName, color, keys] of groups) {
      const groupEl = document.createElement('div');
      groupEl.className = 'viewer-stat-group';
      const heading = document.createElement('h4');
      heading.textContent = groupName;
      heading.style.color = color;
      groupEl.append(heading);
      if (groupName === 'Super') {
        const row = document.createElement('div'), name = document.createElement('span'),
          bar = document.createElement('div'), fill = document.createElement('i'), val = document.createElement('b');
        row.className = 'viewer-stat-row';
        row.style.setProperty('--stat-color', color);
        name.textContent = 'Ubuquity';
        bar.className = 'viewer-stat-track';
        fill.style.width = `${(model.rating / 1023 * 100).toFixed(1)}%`;
        bar.append(fill);
        val.textContent = String(model.rating);
        const gradeTag = document.createElement('em');
        gradeTag.dataset.grade = model.grade;
        gradeTag.textContent = model.grade;
        row.append(name, bar, gradeTag, val);
        groupEl.append(row);
      }
      for (const key of keys) {
        const value = model.stats[key] ?? 127;
        const row = document.createElement('div'), name = document.createElement('span'),
          bar = document.createElement('div'), fill = document.createElement('i'), val = document.createElement('b');
        row.className = 'viewer-stat-row';
        row.style.setProperty('--stat-color', color);
        name.textContent = key[0].toUpperCase() + key.slice(1);
        bar.className = 'viewer-stat-track';
        fill.style.width = `${(value / 255 * 100).toFixed(1)}%`;
        bar.append(fill);
        val.textContent = String(value);
        row.append(name, bar, val);
        groupEl.append(row);
      }
      container.append(groupEl);
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
      if (!panel) continue;
      panel.hidden = !selected;
      if (selected) {
        if (view === 'card') {
          panel.replaceChildren(tradingCard(current));
        } else if (view === 'token') {
          panel.replaceChildren(tokenCoin(current.model));
        } else if (view === 'ubu') {
          $('preview').replaceChildren(ubuRender(current.model));
          renderViewerStats(current.model);
        } else if (view === 'sound') {
          window.ubuAudio?.stop();
        }
      } else {
        if (tab.dataset.view === 'card' || tab.dataset.view === 'token') {
          panel.replaceChildren();
        }
        if (tab.dataset.view === 'sound') {
          window.ubuAudio?.stop();
          viewerNoteChips.forEach(chip => chip.classList.remove('is-playing-note'));
          $('viewer-voice-tone')?.classList.remove('is-active');
          $('viewer-voice-fanfare')?.classList.remove('is-active');
        }
      }
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

  // A pack's ubus join the collection as they are revealed; nothing redraws while a pick is in flight.
  const choosing = () => Boolean(pendingKey && localStorage.getItem(pendingKey + ':choice'));
  const collectionHidden = () => Boolean(document.querySelector('main[data-screen="collection"]')?.hidden);
  const collectionList = ubuList.mount({
    surface: 'collection', toolbarHost: $('collection-toolbar'), grid: $('ubus'),
    status: $('collection-status'),
    inspect: item => { display(item.certificate, item.result, true); status(''); },
    hidden: item => unseen(item.serial), paused: () => choosing() || collectionHidden(),
    onEmpty: reason => {
      if (session?.owner) {
        if (reason === 'empty') collectionRecovery({ packs: true });
        else $('collection-recovery').hidden = true;
      }
      if (!reason) return;
      const note = document.createElement('p');
      note.textContent = reason === 'filtered' ? 'No ubus match. ' : reason === 'loading' ? 'Loading your ubus…' : 'No revealed ubus.';
      if (reason === 'filtered') {
        const clear = Object.assign(document.createElement('button'), { type: 'button', className: 'quiet', textContent: 'Clear filters' });
        clear.onclick = () => collectionList.clearFilters();
        note.append(clear);
      }
      $('ubus').replaceChildren(note);
    }
  });
  window.addEventListener('ubu:screen', event => { if (event.detail === 'collection') collectionList.render(); });
  window.showUbuViewer = serial => {
    const item = ubuList.get(serial);
    if (item?.certificate) display(item.certificate, item.result, true);
  };

  function showMintedItem(item) {
    const serial = item.result.certificate.serial;
    const old = ubuList.get(serial);
    if (old?.certificate === item.text) { collectionList.render(); return; }
    ubuList.add({
      serial, certificate: item.text, result: item.result, model: item.model,
      rarity: item.rarity, issuedAt: item.result.certificate.issuedAt, favorite: old?.favorite || false
    });
    $('collection').hidden = false;
  }

  async function collection() {
    if (choosing()) return;
    try {
      await ubuList.load({ refresh: true });
      collectionStatus('');
      collectionList.render();
      $('collection').hidden = false;
    } catch (error) {
      collectionStatus('Could not load collection: ' + error.message);
      collectionRecovery({ retry: true });
    }
  }

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
  // Packs are dealt onto the table one after another, then bob in place until one is picked.
  function showChoices(data) {
    offer = data;
    $('pack-choices').hidden = false;
    $('pack-choices').classList.remove('choosing');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    choiceViews.forEach((view, i) => {
      const option = data.choices[i]; view.card.classList.remove('selected', 'leaving');
      view.scene?.setHints(option.type, option.hints);
      const hasSpecial = option.hints.some(h => h.textured);
      view.card.classList.toggle('special', hasSpecial);
      view.card.style.setProperty('--pack-glow', option.hints[0].background);
      const description = `Pack ${i + 1}: backgrounds ${option.hints.map(h => h.background).join(', ')}${hasSpecial ? '; special finish in pack' : '; matte finishes'}`;
      view.button.setAttribute('aria-label', description);
      if (!still) view.card.animate([
        { transform: `translateY(-4.375rem) rotate(${(i - 1) * 14}deg) scale(.7)`, opacity: 0 },
        { transform: 'translateY(.5rem) rotate(0deg) scale(1.04)', opacity: 1, offset: .7 },
        { transform: 'none', opacity: 1 }
      ], { duration: 520, delay: i * 120, easing: 'cubic-bezier(.2, .8, .3, 1)', fill: 'backwards' });
    });
    sound('playPack', 'deal');
  }
  async function acceptPack(data) {
    pack = await readPack(data.certificates);
    try { savePack(); } catch (error) { pack = null; throw error; }
    localStorage.removeItem(pendingKey); localStorage.removeItem(pendingKey + ':choice');
    offer = null;
  }
  async function loadChoices() {
    if (busy || !session?.owner || pack || !ubuStarter.status || ubuStarter.status.daily) return;
    busy = true; dealFailed = false; updatePackButton();
    try {
      let request = localStorage.getItem(pendingKey);
      if (!request) { request = crypto.randomUUID(); localStorage.setItem(pendingKey, request); }
      status('');
      const data = await api('/api/packs', post({ request }));
      if (data.completed) {
        await acceptPack(await api('/api/mint', post({ request: data.request })));
        $('pack-choices').hidden = true;
        status('Your pack is ready.');
      } else {
        localStorage.setItem(pendingKey, data.request);
        localStorage.removeItem(pendingKey + ':choice');
        showChoices(data);
      }
      $('mint-recovery').hidden = true;
      collectionList.render();
    } catch (error) {
      outOfPacks = error.message === 'Lifetime mint limit reached.';
      dealFailed = !outOfPacks;
      status(outOfPacks ? "You've opened every pack you can. Enjoy your ubus!" : error.message, outOfPacks);
    } finally { busy = false; updatePackButton(); }
  }
  async function selectPack(index) {
    if (busy || pack || !offer) return;
    const option = offer.choices[index], selection = { request: offer.request, choice: option.choice };
    busy = true; updatePackButton();
    // The pick lands at once: the others fly off while the mint confirms the choice.
    choiceViews.forEach((view, i) => view.card.classList.toggle(i === index ? 'selected' : 'leaving', true));
    sound('playPack', 'pick');
    try {
      localStorage.setItem(pendingKey + ':choice', JSON.stringify(selection));
      const [data] = await Promise.all([api('/api/mint', post(selection)), new Promise(resolve => setTimeout(resolve, 380))]);
      await acceptPack(data);
      packScene = choiceViews[index].scene;
      $('pack-choices').classList.add('choosing');
      const opening = packScene?.play(pack.items.length, pack.items.map(item => item.model));
      if (packScene?.awaitingTap()) {
        const button = choiceViews[index].button;
        button.disabled = false; button.setAttribute('aria-label', 'Tap to crack it open'); button.focus();
        $('pack-hint').textContent = 'Tap to crack it!';
      }
      await opening;
      $('pack-choices').hidden = true;
      revealIndex = 0;
      showReveal();
      status('');
    } catch (error) {
      // Refresh authoritative state after an ambiguous selection; never submit a
      // second choice automatically. A committed selection is recovered by request.
      offer = null; $('pack-choices').hidden = true;
      status(error.message + ' Try again to recover your pack.');
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
  let sessionChecked = false;
  function renderSignedOut() {
    const panel = $('signed-out-panel');
    const path = location.pathname;
    const screen = path === '/mint' ? 'mint' : path === '/collection' ? 'collection' : null;
    panel.hidden = !sessionChecked || Boolean(session?.owner) || !screen;
    if (panel.hidden) return;
    const host = document.querySelector(`main[data-screen="${screen}"]`);
    if (panel.parentElement !== host) host.append(panel);
    const title = screen === 'mint' ? 'Ubu Mint' : 'Collection';
    $('signed-out-title').textContent = title;
    $('signed-out-message').textContent = "You're not signed in. " + (config.login
      ? `Sign in with Discord to access ${title}.` : 'Sign-in is unavailable here.');
    const signIn = $('signed-out-signin');
    signIn.hidden = !config.login;
    signIn.href = '/auth/discord?return=' + encodeURIComponent(path);
    signIn.onclick = window.ubuActivity ? event => window.openDiscordLogin(event) : null;
  }
  window.addEventListener('ubu:screen', renderSignedOut);
  // A match starting in the Activity takes over from a pack in progress; Continue pack resumes it.
  window.addEventListener('ubu:screen', event => { if (event.detail === 'play' && $('reveal').open) $('reveal').close(); });
  starterPack('daily-pack', 'daily', 'Daily pack');
  starterPack('home-pack', 'signup', 'Signup bonus');
  window.addEventListener('ubu:starter', () => { if (sessionChecked) syncDaily(); });

  (async () => {
    try {
      config = await ubuList.config();
      if (!config.login) $('login').hidden = true;
      if (config.login) {
        $('login').href = '/auth/discord?return=' + encodeURIComponent((location.pathname === '/index.html' ? '/' : location.pathname) + location.search);
        session = await api('/api/session');
      }
      async function handleSession(s) {
        session = s;
        sessionChecked = true;
        renderSignedOut();
        $('mint-retry').hidden = true;
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
          $('pack-title').parentElement.classList.toggle('settled', Boolean(pack));
          const canOpen = pack || (config.ready && (config.lifetimeLimit || localStorage.getItem(pendingKey)));
          status(canOpen ? '' : config.ready ? 'No packs are available for this account.' : 'Minting closed', true);
          $('mint-recovery').hidden = Boolean(canOpen);
          if (config.ready) {
            try { await migrateBrowserFavorites(); } catch (error) { status('Could not migrate browser favorites: ' + error.message); }
            await ubuStarter.refresh().catch(error => { status(error.message); $('pack-title').parentElement.classList.add('settled'); });
            await collection();
          } else {
            collectionStatus('The collection is unavailable right now.');
            collectionRecovery();
          }
        }
      }
      window.addEventListener('ubu:session', event => {
        if (event.detail?.owner && (!session?.owner || session.owner !== event.detail.owner)) {
          handleSession(event.detail);
        } else if (event.detail?.owner) {
          session = event.detail; // A new Activity launch renews the CSRF token.
        } else if (!event.detail?.owner && session?.owner) {
          handleSession(null);
        }
      });
      await handleSession(session);
    } catch (error) {
      status('Could not connect to the mint. Try again.');
      $('mint-recovery').hidden = $('mint-retry').hidden = false;
      collectionRecovery({ retry: true });
    }
  })();
})();
