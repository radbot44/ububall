'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const packShop = () => $('pack-title')?.closest('.pack-shop');
  const rinkStageEl = () => document.querySelector('.rink-stage');
  const motionOff = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const waitMs = ms => motionOff() || ms <= 0 ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, ms));
  const onMintShot = () => document.body?.dataset?.shot === 'mint';
  const onCollectionShot = () => document.body?.dataset?.shot === 'collection';

  let config = { ready: false }, session = null, current = null, busy = false, picking = false;
  let packScene = null, offer = null, pendingSignupOpen = false, fadeNextChoices = false;
  let outOfPacks = false, dealFailed = false, collectionFailed = false;
  let pack = null, packKey = '', pendingKey = '', revealIndex = 0, revealOpen = false, revealSeq = 0, lastSwipeAt = -1e9;
  let coinLandTimer = 0;
  const clearCoinTimer = () => { if (coinLandTimer) { clearTimeout(coinLandTimer); coinLandTimer = 0; } };

  // Stage lighting over the rink interior (60..940, 60..540 on the 1000x600 rink -> inset 10% 6%).
  // Spotlights cut soft pools out of the dark wash so the real ice and markings glow beneath each pack or ubu.
  const mintLights = (() => {
    const canvas = $('mint-lights');
    const ctx = canvas?.getContext?.('2d') || null;
    let active = [], frame = 0, lastAt = 0;
    const hexRgb = hex => {
      if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return [255, 236, 210];
      return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    };
    function paint(now) {
      frame = 0;
      if (!ctx || !canvas) return;
      const dt = lastAt ? Math.min(64, Math.max(1, now - lastAt)) : 16;
      lastAt = now;
      const k = motionOff() ? 1 : 1 - Math.exp(-dt / 95);
      let moving = false;
      for (const s of active) {
        for (const prop of ['x', 'y', 'r', 'alpha']) {
          const diff = s.to[prop] - s[prop];
          if (Math.abs(diff) > .003) { s[prop] += diff * k; moving = true; }
          else s[prop] = s.to[prop];
        }
      }
      active = active.filter(s => s.alpha > .004 || s.to.alpha > 0);
      const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
      const w = Math.round((canvas.clientWidth || 880) * dpr), h = Math.round((canvas.clientHeight || 480) * dpr);
      if (w && h) {
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(6, 9, 15, 0.84)';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        for (const s of active) {
          if (s.alpha <= .005) continue;
          const lx = ((s.x - 6) / 88) * w, ly = ((s.y - 10) / 80) * h, lr = Math.max(4, (s.r / 88) * w);
          const cut = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
          cut.addColorStop(0, `rgba(0, 0, 0, ${(0.95 * s.alpha).toFixed(3)})`);
          cut.addColorStop(0.5, `rgba(0, 0, 0, ${(0.64 * s.alpha).toFixed(3)})`);
          cut.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = cut;
          ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        for (const s of active) {
          if (s.alpha <= .005) continue;
          const lx = ((s.x - 6) / 88) * w, ly = ((s.y - 10) / 80) * h, lr = Math.max(4, (s.r / 88) * w);
          const [r, g, b] = hexRgb(s.color);
          // Feathered overhead spotlight haze above the pool on the ice (no hard polygon edges).
          ctx.save();
          ctx.translate(lx, ly - lr * .55);
          ctx.scale(.68, 1.45);
          const beam = ctx.createRadialGradient(0, -lr * .35, 0, 0, 0, lr * 1.15);
          beam.addColorStop(0, `rgba(255, 244, 224, ${(0.11 * s.alpha).toFixed(3)})`);
          beam.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${(0.06 * s.alpha).toFixed(3)})`);
          beam.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.fillStyle = beam;
          ctx.beginPath(); ctx.arc(0, 0, lr * 1.15, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
          const pool = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
          pool.addColorStop(0, `rgba(255, 244, 224, ${(0.20 * s.alpha).toFixed(3)})`);
          pool.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${(0.14 * s.alpha).toFixed(3)})`);
          pool.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.fillStyle = pool;
          ctx.beginPath(); ctx.arc(lx, ly, lr, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (moving) requestPaint();
      else lastAt = 0;
    }
    function requestPaint() {
      if (!frame && ctx) frame = requestAnimationFrame(paint);
    }
    if (canvas && typeof ResizeObserver === 'function') new ResizeObserver(requestPaint).observe(canvas);
    return {
      setSpots(targets, { immediate = false, seedFrom = null } = {}) {
        const snap = immediate || motionOff();
        const byId = new Map(active.map(s => [s.id, s]));
        for (const s of active) s.to = { ...s.to, alpha: 0 };
        for (const t of targets) {
          const goal = { x: t.x, y: t.y ?? 50, r: t.r ?? 14, alpha: t.alpha ?? 1 };
          let s = byId.get(t.id);
          if (s) {
            s.color = t.color || s.color;
            s.to = goal;
            if (snap) Object.assign(s, goal);
          } else {
            const start = snap ? goal : seedFrom ? { x: seedFrom.x, y: seedFrom.y ?? 50, r: seedFrom.r ?? goal.r, alpha: seedFrom.alpha ?? 0.85 } : { ...goal, alpha: 0 };
            s = { id: t.id, ...start, color: t.color || '#ffecd2', to: goal };
            active.push(s);
          }
        }
        if (snap) paint(performance.now());
        else requestPaint();
      },
      getSpots: () => active.map(s => ({ id: s.id, x: s.to.x, y: s.to.y, r: s.to.r, alpha: s.to.alpha, color: s.color })),
      repaint: () => paint(performance.now())
    };
  })();

  // Positions (% of rink width) and camera zoom for 3-ubu starter/daily packs vs 5-ubu regular packs.
  // Keeping x_0 * zoom >= 50 ensures the zoomed rink canvas always fills 100% of .rink-stage.
  const ubuPositions = count => count <= 3 ? [31, 50, 69] : [21, 35.5, 50, 64.5, 79];
  const ubuZoom = count => count <= 3 ? 1.85 : 2.4;
  function setMintCamera(index, count, { immediate = false } = {}) {
    const stage = rinkStageEl();
    if (!stage) return;
    const xs = ubuPositions(count), x = xs[index] ?? 50, z = ubuZoom(count);
    const panX = (50 - x) * z;
    if (immediate || motionOff()) stage.classList.add('mint-camera-cut');
    else stage.classList.remove('mint-camera-cut');
    stage.classList.add('mint-zoomed');
    stage.style.setProperty('--mint-zoom', String(z));
    stage.style.setProperty('--mint-pan-x', `${panX.toFixed(3)}%`);
    stage.style.setProperty('--mint-pan-y', '0%');
    if (immediate || motionOff()) requestAnimationFrame(() => stage.classList.remove('mint-camera-cut'));
  }
  function resetMintCamera({ immediate = false } = {}) {
    const stage = rinkStageEl();
    if (!stage) return;
    if (immediate || motionOff()) stage.classList.add('mint-camera-cut');
    else stage.classList.remove('mint-camera-cut');
    stage.classList.remove('mint-zoomed');
    stage.style.setProperty('--mint-zoom', '1');
    stage.style.setProperty('--mint-pan-x', '0%');
    stage.style.setProperty('--mint-pan-y', '0%');
    if (immediate || motionOff()) requestAnimationFrame(() => stage.classList.remove('mint-camera-cut'));
  }

  if ($('mint-world')) $('mint-world').hidden = false;
  if ($('collection-world')) $('collection-world').hidden = false;

  const choiceViews = Array.from({ length: 3 }, (_, i) => {
    const card = document.createElement('article'); card.className = 'pack-option';
    card.dataset.slot = String(i);
    card.style.setProperty('--pack-x', `${25 + i * 25}%`);
    const button = document.createElement('button'); button.className = 'candy-pack'; button.disabled = true;
    button.setAttribute('aria-label', `Choose pack ${i + 1}`);
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true'); button.append(canvas);
    const sparkle = document.createElement('span'); sparkle.className = 'pack-sparkle'; sparkle.setAttribute('aria-hidden', 'true');
    for (let s = 0; s < 3; s++) {
      const slot = document.createElement('i');
      slot.append(gameUi.icon('sparkles'));
      sparkle.append(slot);
    }
    card.style.setProperty('--bob-delay', `${-i * .7}s`);
    card.append(button, sparkle); $('pack-choices').append(card);
    let scene = null;
    try { scene = createPackScene(canvas); } catch { canvas.hidden = true; button.textContent = `Pack ${i + 1}`; }
    button.addEventListener('click', () => {
      // A tap-to-open wrapper takes taps on the chosen pack; otherwise a click picks the pack.
      if (!scene?.tap()) { selectPack(i); return; }
      if (!scene.awaitingTap()) {
        button.disabled = true;
        $('pack-hint').textContent = '';
        $('pack-title').textContent = 'Opening pack…';
      }
    });
    return { card, button, scene };
  });
  // Sounds need a page gesture first; packs dealt on page load, or while another screen is up, stay silent.
  const sound = (kind, name, opts) => { if (navigator.userActivation?.hasBeenActive && onMintShot()) window.ubuAudio?.[kind]?.(name, opts); };
  // The signup and daily packs share one horizontal wrapper and open on the Mint stage.
  function starterPack(id, kind, label, bindClick = true) {
    const host = $(id);
    if (!host) return null;
    const button = host.querySelector('button'), canvas = button.querySelector('canvas');
    let scene = null;
    try { scene = createPackScene(canvas); scene.setStarter(label); } catch { canvas.hidden = true; button.textContent = label; }
    const view = { host, button, scene };
    if (bindClick) button.addEventListener('click', () => openStarter(kind, view));
    return view;
  }
  async function openStarter(kind, view) {
    if (busy || !view) return;
    if (pack) { revealIndex = Math.max(0, pack.seen - 1); void beginStageReveal({ freshlyOpened: false }); return; }
    busy = true; view.button.disabled = true; updatePackButton();
    $('pack-choices').hidden = true;
    if (kind === 'signup') $('daily-pack').hidden = true;
    else if ($('signup-stage-pack')) $('signup-stage-pack').hidden = true;
    view.host.hidden = false;
    $('pack-title').textContent = kind === 'signup' ? 'Signup bonus' : 'Your daily pack';
    $('pack-subtitle').textContent = '';
    mintLights.setSpots([{ id: 'starter', x: 50, y: 50, r: 19, alpha: 1, color: '#ffecd2' }]);
    let persisted = false;
    try {
      const data = await ubuStarter.claim(kind);
      pack = await readPack(data.certificates);
      savePack();
      persisted = true;
      await view.scene?.play(pack.items.length, pack.items.map(item => item.model), { silhouette: true });
      const emergeFrom = capturePackEmergence(view.scene, view.button.querySelector('canvas'), pack.items.length);
      view.host.hidden = true;
      revealIndex = 0;
      status('');
      busy = false;
      if (onMintShot()) await beginStageReveal({ freshlyOpened: true, emergeFrom });
      else syncMintStage();
    } catch (error) {
      if (!persisted) pack = null;
      if (await gameUi.confirm({ title: 'Could not open your pack', message: error.message, confirmLabel: 'Retry' })) {
        busy = false; view.button.disabled = false;
        return openStarter(kind, view);
      }
      view.host.hidden = kind === 'signup';
      syncMintStage();
    } finally {
      busy = false; view.button.disabled = false; view.scene?.reset(); updatePackButton();
    }
    void ubuStarter.refresh().catch(() => {});
  }
  // Syncs the Mint stage headings, packs and spotlights when not actively unwrapping or revealing.
  function syncDaily() {
    syncMintStage();
  }
  function syncMintStage() {
    packShop()?.classList.toggle('settled', Boolean(ubuStarter.known || pack || !session?.owner));
    if (!sessionChecked) return;
    if (!session?.owner) {
      $('daily-pack').hidden = true;
      if ($('signup-stage-pack')) $('signup-stage-pack').hidden = true;
      $('pack-choices').hidden = true;
      $('mint-ubus').hidden = true;
      $('mint-reveal').hidden = true;
      if (onMintShot()) {
        $('pack-title').textContent = 'Ubu Mint';
        $('pack-subtitle').textContent = "You're not signed in.";
        mintLights.setSpots([{ id: 'center', x: 50, y: 50, r: 22, alpha: 0.9, color: '#ffecd2' }]);
      }
      return;
    }
    if (pendingSignupOpen) {
      $('daily-pack').hidden = true;
      $('pack-choices').hidden = true;
      $('mint-ubus').hidden = true;
      $('mint-reveal').hidden = true;
      if ($('signup-stage-pack')) $('signup-stage-pack').hidden = false;
      $('pack-title').textContent = 'Signup bonus';
      $('pack-subtitle').textContent = 'Tap it to crack it open!';
      mintLights.setSpots([{ id: 'starter', x: 50, y: 50, r: 19, alpha: 1, color: '#ffecd2' }]);
      return;
    }
    if (busy || revealOpen) return;
    if ($('signup-stage-pack')) $('signup-stage-pack').hidden = true;
    if (pack) {
      $('daily-pack').hidden = true;
      $('pack-choices').hidden = true;
      renderStageUbus();
      const xs = ubuPositions(pack.items.length);
      mintLights.setSpots(pack.items.map((item, i) => ({
        id: 'ubu-' + i, x: xs[i], y: 50, r: 9.5, alpha: i < pack.seen ? 0.95 : 0.8,
        color: i < pack.seen ? item.model.attributes.background.hex : '#ffecd2'
      })));
      $('pack-title').textContent = 'Unfinished pack';
      $('pack-subtitle').textContent = `${pack.seen} of ${pack.items.length} revealed · Continue below or tap an ubu`;
      updatePackButton();
      return;
    }
    $('mint-ubus').hidden = true;
    $('mint-reveal').hidden = true;
    resetMintCamera({ immediate: true });
    const daily = Boolean(ubuStarter.status?.daily);
    $('daily-pack').hidden = !daily;
    if (daily) {
      $('pack-choices').hidden = true;
      $('pack-title').textContent = 'Your daily pack';
      $('pack-subtitle').textContent = 'Tap it to crack it open!';
      status('', true);
      mintLights.setSpots([{ id: 'starter', x: 50, y: 50, r: 19, alpha: 1, color: '#ffecd2' }]);
      if (fadeNextChoices && !motionOff()) {
        fadeNextChoices = false;
        $('daily-pack').animate([{ opacity: 0, scale: .9 }, { opacity: 1, scale: 1 }], { duration: 380, easing: 'ease-out' });
      }
      return;
    }
    if (ubuStarter.status && offer) {
      $('pack-choices').hidden = false;
      $('pack-title').textContent = 'Choose your pack';
      $('pack-subtitle').textContent = 'Pick a pack to crack open!';
      mintLights.setSpots(offer.choices.map((opt, i) => ({
        id: 'pack-' + i, x: 25 + i * 25, y: 50, r: 14.5, alpha: 1, color: opt.hints[0].background
      })));
      return;
    }
    if (ubuStarter.status && config.ready && (config.lifetimeLimit || (pendingKey && localStorage.getItem(pendingKey))) && !outOfPacks && !dealFailed) {
      $('pack-title').textContent = 'Choose your pack';
      $('pack-subtitle').textContent = '';
      mintLights.setSpots([{ id: 'center', x: 50, y: 50, r: 16, alpha: 0.35, color: '#ffecd2' }]);
      void loadChoices();
      return;
    }
    $('pack-choices').hidden = true;
    $('pack-title').textContent = 'Ubu Mint';
    $('pack-subtitle').textContent = '';
    mintLights.setSpots([{ id: 'center', x: 50, y: 50, r: 18, alpha: 0.45, color: '#ffecd2' }]);
  }
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
      const result = await ubuFile.read(text, { allowUnsigned: false, resolveKey: ubuList.trustedKey });
      if (result.type !== 'signed') throw new Error('The pack contains an unsigned ubu.');
      const model = ubu.decode(ubu.fromCode(result.dna));
      return { text, result, model, rarity: rarity.scoreRarity(model) };
    }));
    return { items, seen };
  }
  // The shop deals packs by itself; the one button only continues an unrevealed pack or retries.
  function updatePackButton() {
    $('mint').textContent = pack ? 'Continue pack' : 'Try again';
    $('mint').hidden = busy || revealOpen || !(pack || dealFailed);
    for (const view of choiceViews) view.button.disabled = busy || revealOpen || !offer || Boolean(pack);
  }
  // Short dances a clicked ubu performs, picked at random.
  // Every pose uses the same transform functions, so rotations interpolate by angle (a full
  // turn really turns) instead of blending as matrices along the shortest path.
  const pose = ({ x = 0, y = 0, rx = 0, ry = 0, r = 0, sx = 1, sy = sx } = {}, offset) => ({
    transform: `translate(${x}%, ${y}%) rotateX(${rx}deg) rotateY(${ry}deg) rotate(${r}deg) scale(${sx}, ${sy})`,
    ...(offset === undefined ? {} : { offset })
  });
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
    const serial = document.createElement('span'); serial.textContent = serialNum ? ubuList.serialLabel(serialNum) : '';
    top.append(brand);
    if (serialNum && ubuList.get(serialNum)) top.append(createHeartButton(serialNum));
    top.append(serial);
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
    const nameStack = document.createElement('div'); nameStack.className = 'card-title-stack';
    const name = document.createElement('h3'); name.textContent = item.model.parts.fullName;
    nameStack.append(name);
    const cardArchText = window.ubuArchetype ? ubuArchetype.format(item.model) : '';
    if (cardArchText) {
      const cardArch = document.createElement('p');
      cardArch.className = 'card-archetype';
      cardArch.textContent = cardArchText;
      nameStack.append(cardArch);
    }
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
    const rarityEl = document.createElement('div'); rarityEl.className = 'card-rarity';
    const rarityCaption = document.createElement('span'), rarityValue = document.createElement('strong');
    rarityCaption.textContent = 'Rarity'; rarityValue.textContent = ubuList.rarityScore(item.rarity.percentile);
    rarityEl.append(rarityCaption, rarityValue);
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
      const stateIcon = gameUi.icon('player-play');
      const setFanfarePlaying = playing => {
        fanfare.classList.toggle('is-playing', playing);
        fanfare.setAttribute('aria-pressed', String(playing));
        stateIcon.querySelector('use')?.setAttribute('href', playing ? '#icon-player-stop' : '#icon-player-play');
      };
      heading.append(stateIcon, 'Fanfare');
      meta.textContent = `${parsed.tempoBpm} BPM · ${parsed.groove}`;
      const staff = fanfareStaff(parsed), marks = staff.querySelectorAll('.staff-note');
      heading.append(meta); fanfare.append(heading, staff); side.append(fanfare);
      fanfare.setAttribute('aria-label', 'Play fanfare'); fanfare.setAttribute('aria-pressed', 'false');
      let playback = null;
      const playFanfare = () => {
        if (playback) { playback.stop(); return; }
        if (!ubuAudio.getAudioContext?.()) return;
        setFanfarePlaying(true);
        playback = ubuAudio.playFanfare(item.model.voice, null, index => {
          marks.forEach((mark, i) => mark.classList.toggle('is-playing', i === index));
          if (index !== -1) return;
          playback = null; setFanfarePlaying(false);
        });
      };
      pressable(fanfare, playFanfare);
      targets.push([fanfare, playFanfare]);
    }
    // Touch tilting captures the pointer on the card, so hit-test the panels from the card's clicks;
    // assistive-tech / keyboard synthetic clicks (detail === 0) match the activated target directly.
    card.addEventListener('click', event => {
      if (performance.now() - lastSwipeAt < 90) return;
      if (event.target.closest?.('.card-heart')) return;
      if (event.detail === 0) {
        for (const [el, action] of targets) if (el.contains(event.target)) return action();
      }
      for (const [el, action] of targets) {
        const box = el.getBoundingClientRect();
        if (event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom) return action();
      }
    });
    card.append(top, badge, art, nameStack, side, rarityEl, supers);
    return card;
  }
  function capturePackEmergence(scene, packCanvas, count) {
    if (motionOff() || !scene?.getSilhouetteTokens || !packCanvas) return null;
    const stage = rinkStageEl();
    if (!stage) return null;
    const stageRect = stage.getBoundingClientRect();
    const packRect = (packCanvas.parentElement?.getBoundingClientRect ? packCanvas.parentElement : packCanvas).getBoundingClientRect();
    if (!(stageRect.width > 0) || !(packRect.width > 0)) return null;
    const tokens = scene.getSilhouetteTokens(count);
    const xs = ubuPositions(count);
    const endDiam = stageRect.width * ((count <= 3 ? 6.4 : 5.2) / 100);
    const unit = packRect.width / 600;
    return tokens.map((tok, i) => {
      const startX = packRect.left + packRect.width * 0.5 + tok.x * unit;
      const startY = packRect.top + packRect.height * 0.46 + tok.y * unit;
      const endX = stageRect.left + stageRect.width * (xs[i] / 100);
      const endY = stageRect.top + stageRect.height * 0.5;
      return {
        dxPx: startX - endX,
        dyPx: startY - endY,
        scale: endDiam > 0 ? (tok.diameter * unit) / endDiam : 2
      };
    });
  }

  function renderStageUbus() {
    const host = $('mint-ubus');
    if (!host || !pack) return;
    const count = pack.items.length, xs = ubuPositions(count);
    host.style.setProperty('--ubu-size', count <= 3 ? '6.4%' : '5.2%');
    if (host.childElementCount !== count || host.dataset.packId !== (pack.items[0]?.result.certificate?.serial || '')) {
      host.dataset.packId = pack.items[0]?.result.certificate?.serial || '';
      host.replaceChildren(...pack.items.map((item, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mint-ubu';
        btn.dataset.index = String(i);
        btn.style.setProperty('--ubu-x', `${xs[i]}%`);
        // Match the pack reveal fan's centre-on-top z-order during emergence.
        btn.style.zIndex = String(10 - Math.abs(i * 2 - (count - 1)));
        btn.append(ubuRender(item.model, 'mint-ubu-svg'));
        btn.addEventListener('click', () => {
          if (busy) return;
          if (!revealOpen) {
            revealIndex = i <= pack.seen ? i : pack.seen;
            void beginStageReveal({ freshlyOpened: false });
          } else if (i !== revealIndex && i <= pack.seen) {
            void goToRevealIndex(i);
          }
        });
        return btn;
      }));
    }
    syncStageUbuStates(revealOpen ? revealIndex : -1);
    host.hidden = false;
  }

  function syncStageUbuStates(activeIdx = -1) {
    const host = $('mint-ubus');
    if (!host || !pack) return;
    [...host.children].forEach((el, i) => {
      const seen = i < pack.seen;
      const active = i === activeIdx;
      el.classList.toggle('is-silhouetted', !seen);
      el.classList.toggle('is-revealed', seen);
      el.classList.toggle('is-active', active);
      el.disabled = busy || (revealOpen && i > pack.seen);
      el.setAttribute('aria-label', seen ? `Show ${pack.items[i].model.parts.fullName}` : `Reveal ubu ${i + 1}`);
    });
  }

  function updateRevealLights(activeIdx) {
    if (!pack) return;
    const xs = ubuPositions(pack.items.length);
    mintLights.setSpots(pack.items.map((item, i) => ({
      id: 'ubu-' + i,
      x: xs[i],
      y: 50,
      r: i === activeIdx ? 12.5 : 8.5,
      alpha: i === activeIdx ? 1 : 0.78,
      color: i < pack.seen || i === activeIdx ? item.model.attributes.background.hex : '#ffecd2'
    })));
  }

  function mountRevealCard(index) {
    if (!pack) return;
    const previousSeen = pack.seen;
    const newlyRevealed = index >= previousSeen;
    if (newlyRevealed) {
      pack.seen = index + 1;
      try { savePack(); } catch (error) { pack.seen = previousSeen; throw error; }
    }
    const item = pack.items[index];
    const last = index === pack.items.length - 1;
    $('reveal-progress').textContent = `${index + 1} / ${pack.items.length}`;
    // Add the revealed ubu to the collection first so heart buttons recognize ownership immediately,
    // then render the background before the visible card so the visible card owns shared lighting.
    showMintedItem(item);
    display(item.text, item.result, false);
    syncStageUbuStates(index);
    updateRevealLights(index);
    if (newlyRevealed) sound('playPack', 'reveal');
    const cardStage = $('card-stage');
    cardStage.classList.remove('panning');
    cardStage.replaceChildren(tradingCard(item));
    $('reveal-dots').replaceChildren(...pack.items.map((_, i) => {
      const dot = document.createElement('span');
      dot.className = i === index ? 'current' : i < pack.seen ? 'seen' : '';
      return dot;
    }));
    $('prev-ubu').disabled = index === 0;
    $('next-ubu').disabled = last;
    $('finish-pack').hidden = pack.seen < pack.items.length;
    $('mint-reveal').hidden = false;
    $('pack-title').textContent = 'Pack reveal';
    $('pack-subtitle').textContent = pack.seen >= pack.items.length
      ? 'All revealed · Click Done when ready'
      : `Ubu ${index + 1} of ${pack.items.length}`;
    updatePackButton();
  }

  async function beginStageReveal({ freshlyOpened = false, emergeFrom = null } = {}) {
    if (!pack) return;
    const seq = ++revealSeq;
    revealOpen = true;
    $('pack-choices').hidden = true;
    $('daily-pack').hidden = true;
    if ($('signup-stage-pack')) $('signup-stage-pack').hidden = true;
    updatePackButton();
    renderStageUbus();
    syncStageUbuStates(-1);
    const count = pack.items.length, xs = ubuPositions(count);
    if (freshlyOpened) {
      $('pack-title').textContent = 'Pack opened!';
      $('pack-subtitle').textContent = '';
      $('mint-ubus').classList.add('is-emerging');
      mintLights.setSpots(
        pack.items.map((_, i) => ({ id: 'ubu-' + i, x: xs[i], y: 50, r: 9.5, alpha: 0.92, color: '#ffecd2' })),
        { seedFrom: { x: 50, y: 50, r: 14, alpha: 1 } }
      );
      if (!motionOff()) {
        const stageW = rinkStageEl()?.getBoundingClientRect().width || 0;
        [...$('mint-ubus').children].forEach((el, i) => {
          const from = emergeFrom?.[i];
          const fallbackDx = stageW * ((50 - xs[i]) / 100);
          const startTranslate = from
            ? `calc(-50% + ${from.dxPx.toFixed(1)}px) calc(-50% + ${from.dyPx.toFixed(1)}px)`
            : `calc(-50% + ${fallbackDx.toFixed(1)}px) -50%`;
          const startScale = from ? from.scale : 2.1;
          el.animate?.([
            { translate: startTranslate, scale: startScale, opacity: 1 },
            { translate: '-50% -50%', scale: 1, opacity: 1 }
          ], { duration: 540, easing: 'cubic-bezier(.22, .85, .25, 1)', fill: 'backwards' });
        });
      }
      try {
        await waitMs(640);
      } finally {
        $('mint-ubus').classList.remove('is-emerging');
      }
      if (seq !== revealSeq || !pack || !revealOpen) return;
    }
    setMintCamera(revealIndex, count);
    updateRevealLights(revealIndex);
    await waitMs(freshlyOpened ? 340 : 260);
    if (seq !== revealSeq || !pack || !revealOpen) return;
    try {
      mountRevealCard(revealIndex);
    } catch (error) {
      $('reveal-progress').textContent = `Could not save your place: ${error.message}`;
    }
  }

  async function goToRevealIndex(target) {
    if (!pack || !revealOpen || target < 0 || target >= pack.items.length || target > pack.seen) return;
    const seq = ++revealSeq;
    window.ubuAudio?.stop();
    const unseenTarget = target >= pack.seen;
    revealIndex = target;
    // Restore the previous ubu onto the ice so it slides off to the side while the camera pans.
    syncStageUbuStates(-1);
    $('card-stage').classList.add('panning');
    setMintCamera(target, pack.items.length);
    updateRevealLights(target);
    await waitMs(unseenTarget ? 240 : 140);
    if (seq !== revealSeq || !pack || !revealOpen) return;
    try {
      mountRevealCard(target);
      if (document.activeElement?.disabled) (target === 0 ? $('next-ubu') : $('prev-ubu')).focus();
    } catch (error) {
      $('reveal-progress').textContent = `Could not save your place: ${error.message}`;
    }
  }

  function navigatePack(direction) {
    void goToRevealIndex(revealIndex + direction);
  }
  $('prev-ubu').addEventListener('click', () => navigatePack(-1));
  $('next-ubu').addEventListener('click', () => navigatePack(1));
  addEventListener('keydown', event => {
    if (!revealOpen || !onMintShot() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (document.querySelector('dialog[open], :popover-open')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      navigatePack(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      $('pause-reveal').click();
    }
  });

  // Touch swipe controls across the reveal stage and trading card on mobile/tablet devices.
  const swipeArea = document.querySelector('.stadium-stage-area');
  let activeSwipe = null;
  swipeArea?.addEventListener('pointerdown', event => {
    if (!revealOpen || !onMintShot() || event.pointerType === 'mouse' || !event.isPrimary) return;
    if (event.target?.closest?.('button')) return;
    activeSwipe = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
  });
  swipeArea?.addEventListener('pointermove', event => {
    if (!activeSwipe || event.pointerId !== activeSwipe.id) return;
    const dx = event.clientX - activeSwipe.x, dy = event.clientY - activeSwipe.y;
    if (!activeSwipe.dragging && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      activeSwipe.dragging = true;
    }
    if (activeSwipe.dragging && !motionOff()) {
      const pull = Math.max(-72, Math.min(72, dx * 0.36));
      $('card-stage').style.setProperty('translate', `${pull.toFixed(1)}px 0`);
    }
  });
  const finishSwipe = (event, cancelled) => {
    if (!activeSwipe || event.pointerId !== activeSwipe.id) return;
    const dx = event.clientX - activeSwipe.x, dy = event.clientY - activeSwipe.y;
    const wasDragging = activeSwipe.dragging;
    activeSwipe = null;
    $('card-stage').style.setProperty('translate', '');
    if (cancelled || !revealOpen || !onMintShot()) return;
    if ((wasDragging || Math.abs(dx) >= 40) && Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      lastSwipeAt = performance.now();
      navigatePack(dx < 0 ? 1 : -1);
    }
  };
  swipeArea?.addEventListener('pointerup', event => finishSwipe(event, false));
  swipeArea?.addEventListener('pointercancel', event => finishSwipe(event, true));

  function clearFinishedPackState() {
    localStorage.removeItem(packKey);
    pack = null;
    offer = null;
    $('pack-choices').hidden = true;
    packScene?.reset();
    status('');
  }

  async function finishPackWithScamper() {
    if (!pack || pack.seen < pack.items.length || busy) return false;
    ++revealSeq;
    revealOpen = false;
    busy = true;
    window.ubuAudio?.stop();
    $('mint-reveal').hidden = true;
    $('card-stage').replaceChildren();
    syncStageUbuStates(-1);
    const count = pack.items.length, xs = ubuPositions(count);
    $('pack-title').textContent = 'Ubus collected!';
    $('pack-subtitle').textContent = '';
    resetMintCamera();
    mintLights.setSpots(pack.items.map((item, i) => ({
      id: 'ubu-' + i, x: xs[i], y: 50, r: 10, alpha: 0.9, color: item.model.attributes.background.hex
    })));
    await waitMs(430);
    sound('playPack', 'scamper', { count });
    mintLights.setSpots([{ id: 'center', x: 50, y: 50, r: 16, alpha: 0.32, color: '#ffecd2' }]);
    if (!motionOff()) {
      [...$('mint-ubus').children].forEach((el, i) => {
        const slot = i - (count - 1) / 2;
        const dx = slot * 22 + (i % 2 ? -14 : 14);
        const dy = (i % 2 ? -1 : 1) * (38 + Math.abs(slot) * 6);
        const spin = (i % 2 ? 1 : -1) * 28;
        el.animate?.([
          { translate: '-50% -50%', rotate: '0deg', scale: 1, opacity: 1 },
          { translate: '-50% -68%', rotate: `${-spin * .35}deg`, scale: 1.12, opacity: 1, offset: .2 },
          { translate: `calc(-50% + ${dx}cqw) calc(-50% + ${dy}cqw)`, rotate: `${spin}deg`, scale: .62, opacity: 0 }
        ], { duration: 480, delay: i * 45, easing: 'cubic-bezier(.3, .1, .7, 1)', fill: 'forwards' });
      });
    }
    await waitMs(520);
    $('mint-ubus').hidden = true;
    $('mint-ubus').replaceChildren();
    delete $('mint-ubus').dataset.packId;
    try {
      clearFinishedPackState();
      fadeNextChoices = true;
    } catch (error) {
      busy = false;
      updatePackButton();
      status(error.message);
      return false;
    }
    busy = false;
    updatePackButton();
    syncMintStage();
    return true;
  }

  function closeRevealImmediate() {
    ++revealSeq;
    if (!revealOpen) return;
    revealOpen = false;
    window.ubuAudio?.stop();
    $('mint-reveal').hidden = true;
    $('card-stage').replaceChildren();
    if (pack && pack.seen >= pack.items.length) {
      try { clearFinishedPackState(); } catch {}
      $('mint-ubus').hidden = true;
      $('mint-ubus').replaceChildren();
      delete $('mint-ubus').dataset.packId;
    }
    resetMintCamera({ immediate: true });
    updatePackButton();
  }

  $('finish-pack').addEventListener('click', () => {
    void finishPackWithScamper();
  });
  $('pause-reveal').addEventListener('click', () => {
    if (pack && pack.seen >= pack.items.length) {
      void finishPackWithScamper();
      return;
    }
    ++revealSeq;
    revealOpen = false;
    window.ubuAudio?.stop();
    $('mint-reveal').hidden = true;
    $('card-stage').replaceChildren();
    resetMintCamera();
    syncMintStage();
    if (!$('mint').hidden && !$('mint').closest('[hidden]')) $('mint').focus();
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
  function collectionRecovery({ packs = false, retry = false, importFile = false } = {}) {
    $('collection-recovery').hidden = !(packs || retry || importFile);
    $('collection-packs').hidden = !packs;
    $('collection-retry').hidden = !retry;
    const recImport = $('recovery-import-wrap');
    if (recImport) recImport.hidden = !importFile;
  }
  $('mint-retry').onclick = () => { void bootMint(); };
  $('collection-retry').onclick = () => { void collection(); };
  let collectionViewerOpen = false, collectionViewerFromList = false, collectionViewerClosing = false;
  let scatteredAnims = [], viewerPanelAnim = null;
  function cancelViewerPanelAnim() {
    if (viewerPanelAnim) { try { viewerPanelAnim.cancel(); } catch {} viewerPanelAnim = null; }
  }
  function cancelScatterAnims() {
    for (const anim of scatteredAnims) {
      try { anim.cancel(); } catch {}
    }
    scatteredAnims = [];
  }
  function updateCollectionViewerOffset() {
    const world = $('collection-world');
    if (!world) return;
    const dock = $('collection-dock');
    const dockBottom = dock && dock.offsetHeight ? Math.max(0, dock.getBoundingClientRect().bottom) : 0;
    world.style?.setProperty?.('--collection-viewer-top', `${Math.max(12, Math.round(dockBottom + 10))}px`);
  }
  function syncCollectionViewerNav() {
    const prevBtn = $('viewer-prev'), nextBtn = $('viewer-next');
    if (!prevBtn || !nextBtn) return;
    if (!collectionViewerOpen || !collectionViewerFromList || !current?.serial) {
      prevBtn.hidden = true;
      nextBtn.hidden = true;
      return;
    }
    const items = collectionList?.shownItems?.() || [];
    const idx = items.findIndex(item => item.serial === current.serial);
    const showNav = items.length > 1 && idx >= 0;
    prevBtn.hidden = !showNav;
    nextBtn.hidden = !showNav;
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx < 0 || idx >= items.length - 1;
  }
  function scatterGridTiles(originRect, activeTile) {
    const grid = $('ubus');
    if (!grid) return;
    cancelScatterAnims();
    grid.classList.add('is-scattered');
    if (motionOff()) return;
    const stageRect = rinkStageEl()?.getBoundingClientRect() || { left: 0, top: 0, width: 800, height: 800 };
    const vh = typeof innerHeight === 'number' && innerHeight > 0 ? innerHeight : 800;
    const ox = originRect && originRect.width > 0 ? originRect.left + originRect.width / 2 : stageRect.left + stageRect.width / 2;
    const oy = originRect && originRect.height > 0 ? originRect.top + originRect.height / 2 : Math.min(vh * 0.5, stageRect.top + stageRect.height * 0.35);
    for (const tile of grid.children || []) {
      if (!tile?.classList?.contains?.('ubu-tile')) continue;
      if (tile === activeTile) {
        const hold = tile.animate?.([{ opacity: 0 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });
        if (hold) scatteredAnims.push(hold);
        continue;
      }
      const r = tile.getBoundingClientRect?.();
      if (!r || !r.width || r.bottom < -220 || r.top > vh + 220) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let vx = cx - ox, vy = cy - oy;
      const dist = Math.hypot(vx, vy) || 1;
      const push = 240 + Math.min(220, dist * 0.45);
      vx = (vx / dist) * push;
      vy = (vy / dist) * push * 0.78;
      const spin = (vx >= 0 ? 1 : -1) * (10 + (Math.round(Math.abs(cx + cy)) % 12));
      const delay = Math.min(90, Math.round(dist * 0.08));
      const anim = tile.animate?.([
        { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${vx.toFixed(1)}px, ${vy.toFixed(1)}px) rotate(${spin}deg) scale(.68)`, opacity: 0 }
      ], { duration: 360, delay, easing: 'cubic-bezier(.25, .1, .35, 1)', fill: 'forwards' });
      if (anim) scatteredAnims.push(anim);
    }
  }
  function gatherGridTiles(activeTile) {
    const grid = $('ubus');
    if (!grid) return;
    cancelScatterAnims();
    grid.classList.remove('is-scattered');
    if (motionOff()) return;
    const vh = typeof innerHeight === 'number' && innerHeight > 0 ? innerHeight : 800;
    const stageRect = rinkStageEl()?.getBoundingClientRect() || { left: 0, top: 0, width: 800, height: 800 };
    const ar = activeTile?.getBoundingClientRect?.();
    const ox = ar && ar.width > 0 ? ar.left + ar.width / 2 : stageRect.left + stageRect.width / 2;
    const oy = ar && ar.height > 0 ? ar.top + ar.height / 2 : vh * 0.45;
    for (const tile of grid.children || []) {
      if (!tile?.classList?.contains?.('ubu-tile') || tile === activeTile) continue;
      const r = tile.getBoundingClientRect?.();
      if (!r || !r.width || r.bottom < -180 || r.top > vh + 180) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let vx = cx - ox, vy = cy - oy;
      const dist = Math.hypot(vx, vy) || 1;
      const push = 160 + Math.min(160, dist * 0.32);
      vx = (vx / dist) * push;
      vy = (vy / dist) * push * 0.72;
      const spin = (vx >= 0 ? 1 : -1) * 10;
      tile.animate?.([
        { transform: `translate(${vx.toFixed(1)}px, ${vy.toFixed(1)}px) rotate(${spin}deg) scale(.78)`, opacity: 0 },
        { transform: 'none', opacity: 1 }
      ], { duration: 320, easing: 'cubic-bezier(.2, .85, .25, 1)' });
    }
  }
  function mountViewerDialog(onIce) {
    const viewer = $('viewer');
    if (!viewer) return;
    if (onIce && $('collection-viewer-host')) {
      if (viewer.parentElement !== $('collection-viewer-host')) $('collection-viewer-host').append(viewer);
      viewer.classList.add('on-ice');
    } else {
      if (viewer.parentElement && viewer.parentElement !== document.body) document.body.append(viewer);
      viewer.classList.remove('on-ice');
    }
  }
  function openCollectionStageViewer({ fromList = false, sourceSerial = null } = {}) {
    const viewer = $('viewer'), stageSlot = $('collection-viewer-stage');
    if (!viewer || !stageSlot) {
      if (viewer && !viewer.open) viewer.showModal();
      return;
    }
    const wasAlreadyOpen = collectionViewerOpen;
    const activeTile = sourceSerial
      ? ([...($('ubus')?.children || [])].find(el => el?.dataset?.serial === sourceSerial) || null)
      : null;
    const artNode = activeTile?.querySelector?.('.ubu-tile-art') || activeTile;
    const fromRect = !wasAlreadyOpen && artNode?.getBoundingClientRect ? artNode.getBoundingClientRect() : null;

    collectionViewerOpen = true;
    collectionViewerFromList = fromList;
    collectionViewerClosing = false;
    updateCollectionViewerOffset();
    stageSlot.style?.setProperty?.('--ubu-accent', current?.model?.attributes?.background?.hex || '#ff9954');
    stageSlot.hidden = false;
    $('collection-world')?.classList.add('viewer-open');
    if ($('signed-out-panel') && !$('signed-out-panel').hidden) $('signed-out-panel').classList.add('viewer-behind');

    if (!wasAlreadyOpen) scatterGridTiles(fromRect, activeTile);
    if (viewer.open && !viewer.classList.contains('on-ice')) viewer.close();
    mountViewerDialog(true);
    if (!viewer.open) {
      if (typeof viewer.show === 'function') viewer.show();
      else viewer.open = true;
    }
    syncCollectionViewerNav();

    if (!wasAlreadyOpen && !motionOff() && fromRect && fromRect.width > 0 && viewer.getBoundingClientRect) {
      const toRect = viewer.getBoundingClientRect();
      if (toRect.width > 0 && toRect.height > 0) {
        const dx = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
        const dy = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2);
        const sx = Math.max(0.14, Math.min(1, fromRect.width / toRect.width));
        const sy = Math.max(0.14, Math.min(1, fromRect.height / toRect.height));
        cancelViewerPanelAnim();
        viewerPanelAnim = viewer.animate?.([
          { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`, borderRadius: '3rem', opacity: 0.45 },
          { transform: 'none', borderRadius: '1.5rem', opacity: 1 }
        ], { duration: 400, easing: 'cubic-bezier(.2, .88, .24, 1)' }) || null;
      }
    }
  }
  function cleanupCollectionViewerDom() {
    cancelViewerPanelAnim();
    collectionViewerOpen = false;
    collectionViewerFromList = false;
    collectionViewerClosing = false;
    cancelScatterAnims();
    $('ubus')?.classList.remove('is-scattered');
    $('collection-world')?.classList.remove('viewer-open');
    if ($('collection-viewer-stage')) $('collection-viewer-stage').hidden = true;
    if ($('signed-out-panel')) $('signed-out-panel').classList.remove('viewer-behind');
    syncCollectionViewerNav();
  }
  async function closeCollectionViewer({ immediate = false } = {}) {
    const viewer = $('viewer');
    if (!collectionViewerOpen) {
      if (viewer?.open) viewer.close();
      return;
    }
    if (collectionViewerClosing && !immediate) return;
    collectionViewerClosing = true;
    clearCoinTimer();
    window.ubuAudio?.stop();

    const targetSerial = collectionViewerFromList ? current?.serial : null;
    const targetTile = targetSerial ? (collectionList?.ensureVisible?.(targetSerial) || [...($('ubus')?.children || [])].find(el => el?.dataset?.serial === targetSerial) || null) : null;
    if (!immediate && !motionOff() && viewer?.open) {
      if (targetTile?.scrollIntoView && targetTile.getBoundingClientRect) {
        const tr = targetTile.getBoundingClientRect();
        const vh = typeof innerHeight === 'number' && innerHeight > 0 ? innerHeight : 800;
        if (tr.bottom < 80 || tr.top > vh - 60) {
          try { targetTile.scrollIntoView({ block: 'nearest' }); } catch {}
        }
      }
      const vr = viewer.getBoundingClientRect?.();
      const artNode = targetTile?.querySelector?.('.ubu-tile-art') || targetTile;
      const tr = artNode?.getBoundingClientRect?.();
      gatherGridTiles(targetTile);
      cancelViewerPanelAnim();
      if (vr && vr.width > 0 && tr && tr.width > 0) {
        const dx = (tr.left + tr.width / 2) - (vr.left + vr.width / 2);
        const dy = (tr.top + tr.height / 2) - (vr.top + vr.height / 2);
        const sx = Math.max(0.14, Math.min(1, tr.width / vr.width));
        const sy = Math.max(0.14, Math.min(1, tr.height / vr.height));
        viewerPanelAnim = viewer.animate?.([
          { transform: 'none', opacity: 1 },
          { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`, opacity: 0 }
        ], { duration: 250, easing: 'cubic-bezier(.35, 0, .25, 1)', fill: 'forwards' }) || null;
      } else {
        viewerPanelAnim = viewer.animate?.([{ opacity: 1, scale: 1 }, { opacity: 0, scale: .92 }], { duration: 200, easing: 'ease-in', fill: 'forwards' }) || null;
      }
      await waitMs(250);
      if (!collectionViewerOpen || !onCollectionShot()) {
        cleanupCollectionViewerDom();
        if (viewer?.open) viewer.close();
        return;
      }
    }
    cleanupCollectionViewerDom();
    if (viewer?.open) viewer.close();
    if (onCollectionShot()) targetTile?.querySelector?.('.ubu-tile-main')?.focus?.();
  }
  function stepCollectionViewer(dir) {
    if (!collectionViewerOpen || !collectionViewerFromList || !current?.serial) return;
    const items = collectionList?.shownItems?.() || [];
    const idx = items.findIndex(item => item.serial === current.serial);
    const next = items[idx + dir];
    if (!next?.certificate) return;
    collectionList?.ensureVisible?.(next.serial);
    display(next.certificate, next.result, false);
    $('collection-viewer-stage')?.style?.setProperty?.('--ubu-accent', current?.model?.attributes?.background?.hex || '#ff9954');
    syncCollectionViewerNav();
    if (!motionOff()) {
      $('viewer-display')?.animate?.([
        { translate: `${dir * 20}px 0`, opacity: 0.45 },
        { translate: '0 0', opacity: 1 }
      ], { duration: 190, easing: 'cubic-bezier(.2, .85, .25, 1)' });
    }
  }

  async function inspect(text) { return ubuFile.read(text, { resolveKey: ubuList.trustedKey }); }
  function display(text, result, openModal = false, { fromCollectionList = false, sourceSerial = null } = {}) {
    clearCoinTimer();
    const model = ubu.decode(ubu.fromCode(result.dna));
    const r = window.rarity ? rarity.scoreRarity(model) : null;
    const serial = result.certificate ? result.certificate.serial : null;
    current = { text, result, model, rarity: r, name: model.parts.fullName, serial };

    $('ubunym').textContent = model.parts.fullName;
    const viewerArch = $('viewer-archetype');
    if (viewerArch) {
      const archLabel = window.ubuArchetype ? ubuArchetype.format(model) : '';
      viewerArch.textContent = archLabel;
      viewerArch.hidden = !archLabel;
    }
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

    if (openModal) {
      if (onCollectionShot()) {
        openCollectionStageViewer({ fromList: fromCollectionList, sourceSerial: sourceSerial || serial });
      } else {
        if (collectionViewerOpen) cleanupCollectionViewerDom();
        mountViewerDialog(false);
        if (!$('viewer').open) $('viewer').showModal();
      }
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
    clearCoinTimer();
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
      clearCoinTimer();
      coinLandTimer = setTimeout(() => {
        coinLandTimer = 0;
        if (coin.isConnected && $('viewer')?.open) window.ubuAudio?.playCoin('land');
      }, duration * .82);
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

  $('close-viewer').addEventListener('click', () => {
    if (collectionViewerOpen) void closeCollectionViewer();
    else $('viewer').close();
  });
  $('viewer').addEventListener('click', event => {
    if (event.target === $('viewer') && !collectionViewerOpen) $('viewer').close();
  });
  $('collection-viewer-stage')?.addEventListener('click', event => {
    if (!collectionViewerOpen) return;
    if (event.target?.closest?.('#viewer, .collection-viewer-arrow')) return;
    void closeCollectionViewer();
  });
  $('viewer-prev')?.addEventListener('click', () => stepCollectionViewer(-1));
  $('viewer-next')?.addEventListener('click', () => stepCollectionViewer(1));
  addEventListener('keydown', event => {
    if (!collectionViewerOpen || !onCollectionShot() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (document.querySelector('dialog:modal, :popover-open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      void closeCollectionViewer();
      return;
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !document.activeElement?.closest?.('.viewer-tabs, input, textarea, select')) {
      event.preventDefault();
      stepCollectionViewer(event.key === 'ArrowLeft' ? -1 : 1);
    }
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
    if (!current?.model?.voice || !window.ubuAudio?.getAudioContext?.()) return;
    const btn = $('viewer-voice-tone');
    btn.classList.add('is-active');
    window.ubuAudio.playVoice(current.model.voice);
    setTimeout(() => btn.classList.remove('is-active'), 400);
  });

  $('viewer-voice-fanfare')?.addEventListener('click', () => {
    if (!current?.model?.voice || !window.ubuAudio?.getAudioContext?.()) return;
    const btn = $('viewer-voice-fanfare');
    btn.classList.add('is-active');
    window.ubuAudio.playFanfare(current.model.voice, null, index => {
      viewerNoteChips.forEach((chip, i) => {
        chip.classList.toggle('is-playing-note', i === index);
      });
      if (index === -1) {
        btn.classList.remove('is-active');
      }
    });
  });

  $('viewer')?.addEventListener('close', () => {
    clearCoinTimer();
    window.ubuAudio?.stop();
    viewerNoteChips.forEach(chip => chip.classList.remove('is-playing-note'));
    $('viewer-voice-tone')?.classList.remove('is-active');
    $('viewer-voice-fanfare')?.classList.remove('is-active');
    if (collectionViewerOpen && !collectionViewerClosing) cleanupCollectionViewerDom();
  });

  async function api(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || 'The mint could not complete this request.'); error.status = response.status; throw error; }
    return data;
  }
  const post = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': session?.csrf || '' }, body: JSON.stringify(data) });

  // A pack's ubus join the collection as they are revealed; nothing redraws while a pick is in flight.
  const choosing = () => picking;
  const collectionHidden = () => Boolean(document.querySelector('main[data-screen="collection"]')?.hidden);
  const collectionList = ubuList.mount({
    surface: 'collection', toolbarHost: $('collection-toolbar'), grid: $('ubus'),
    status: $('collection-status'),
    inspect: item => { display(item.certificate, item.result, true, { fromCollectionList: true, sourceSerial: item.serial }); status(''); },
    onToolbarChange: () => { if (collectionViewerOpen) void closeCollectionViewer({ immediate: true }); },
    hidden: item => unseen(item.serial), paused: () => choosing() || collectionHidden(),
    onEmpty: reason => {
      if (session?.owner) {
        if (reason === 'empty') {
          if (collectionFailed) collectionRecovery({ retry: true, importFile: true });
          else collectionRecovery({ packs: true });
        } else {
          collectionRecovery();
        }
      }
      if (!reason || (reason === 'empty' && collectionFailed)) return;
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
    if (session?.owner) $('collection').hidden = false;
    try {
      await ubuList.load({ refresh: true });
      collectionFailed = false;
      collectionStatus('');
      collectionRecovery();
      collectionList.render();
      $('collection').hidden = false;
    } catch (error) {
      collectionFailed = true;
      collectionStatus('Could not load collection: ' + error.message);
      collectionRecovery({ retry: true, importFile: true });
    }
  }

  async function handleImportFile(event) {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > ubuFile.MAX_BYTES) throw new Error('A .ubu file must contain 1–1024 bytes.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await inspect(bytes);
      display(new TextDecoder().decode(bytes), result, true);
      if (session?.owner) status('');
    } catch (error) {
      if (session?.owner) status(error.message);
      else void gameUi.confirm({ title: 'Could not open .ubu file', message: error.message, confirmLabel: 'OK', cancelLabel: null });
    } finally { event.target.value = ''; }
  }
  for (const id of ['import', 'signed-out-import', 'recovery-import']) {
    $(id)?.addEventListener('change', handleImportFile);
  }

  $('download').addEventListener('click', () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([current.text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = current.name.replaceAll(' ', '-') + '.ubu';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  // Packs sit under individual spotlights on the dark ice; after finishing a pack, new packs fade in.
  function showChoices(data) {
    offer = data;
    $('pack-choices').hidden = false;
    $('pack-choices').classList.remove('choosing');
    $('pack-title').textContent = 'Choose your pack';
    $('pack-subtitle').textContent = 'Pick a pack to crack open!';
    const still = motionOff();
    const fadeIn = fadeNextChoices;
    fadeNextChoices = false;
    mintLights.setSpots(data.choices.map((option, i) => ({
      id: 'pack-' + i, x: 25 + i * 25, y: 50, r: 14.5, alpha: 1, color: option.hints[0].background
    })));
    choiceViews.forEach((view, i) => {
      const option = data.choices[i];
      view.card.classList.remove('selected', 'swiped-left', 'swiped-right');
      view.scene?.setHints(option.type, option.hints);
      const hasSpecial = option.hints.some(h => h.textured);
      view.card.classList.toggle('special', hasSpecial);
      view.card.style.setProperty('--pack-glow', option.hints[0].background);
      const description = `Pack ${i + 1}: backgrounds ${option.hints.map(h => h.background).join(', ')}${hasSpecial ? '; special finish in pack' : '; matte finishes'}`;
      view.button.setAttribute('aria-label', description);
      if (!still) {
        view.card.animate?.(fadeIn ? [
          { opacity: 0, scale: .88 },
          { opacity: 1, scale: 1 }
        ] : [
          { transform: `translateY(-2.75rem) rotate(${(i - 1) * 10}deg) scale(.78)`, opacity: 0 },
          { transform: 'translateY(.25rem) rotate(0deg) scale(1.03)', opacity: 1, offset: .7 },
          { transform: 'none', opacity: 1 }
        ], { duration: fadeIn ? 420 : 500, delay: i * 95, easing: fadeIn ? 'ease-out' : 'cubic-bezier(.2, .8, .3, 1)', fill: 'backwards' });
      }
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
      if (!request) { request = (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : (() => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  })()); localStorage.setItem(pendingKey, request); }
      let savedChoice = null;
      try { savedChoice = JSON.parse(localStorage.getItem(pendingKey + ':choice') || 'null'); } catch {}
      status('');
      const data = await api('/api/packs', post({ request }));
      if (data.completed) {
        await acceptPack(await api('/api/mint', post({ request: data.request })));
        $('pack-choices').hidden = true;
        status('Your pack is ready.');
      } else if (savedChoice?.request === data.request && typeof savedChoice.choice === 'string' &&
          data.choices?.some(c => c.choice === savedChoice.choice)) {
        await acceptPack(await api('/api/mint', post({ request: data.request, choice: savedChoice.choice })));
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
      if (outOfPacks && pendingKey) {
        localStorage.removeItem(pendingKey);
        localStorage.removeItem(pendingKey + ':choice');
      }
      dealFailed = !outOfPacks;
      status(outOfPacks ? "You've opened every pack you can. Enjoy your ubus!" : error.message, outOfPacks);
    } finally {
      busy = false;
      updatePackButton();
      if (!offer) syncMintStage();
    }
  }
  async function selectPack(index) {
    if (busy || revealOpen || pack || !offer) return;
    const option = offer.choices[index], selection = { request: offer.request, choice: option.choice };
    busy = true; picking = true; updatePackButton();
    // Swipe the unchosen packs off the rink while the chosen pack and its spotlight glide to centre ice.
    choiceViews.forEach((view, i) => {
      if (i === index) view.card.classList.add('selected');
      else view.card.classList.add(i < index ? 'swiped-left' : 'swiped-right');
    });
    mintLights.setSpots([{ id: 'pack-' + index, x: 50, y: 50, r: 19, alpha: 1, color: option.hints[0].background }]);
    $('pack-title').textContent = 'Opening pack…';
    $('pack-subtitle').textContent = '';
    sound('playPack', 'pick');
    let opened = false;
    try {
      localStorage.setItem(pendingKey + ':choice', JSON.stringify(selection));
      const [data] = await Promise.all([api('/api/mint', post(selection)), waitMs(420)]);
      await acceptPack(data);
      picking = false;
      packScene = choiceViews[index].scene;
      $('pack-choices').classList.add('choosing');
      const opening = packScene?.play(pack.items.length, pack.items.map(item => item.model), { silhouette: true });
      if (packScene?.awaitingTap()) {
        const button = choiceViews[index].button;
        button.disabled = false; button.setAttribute('aria-label', 'Tap to crack it open'); button.focus();
        $('pack-title').textContent = 'Tap to crack it!';
        $('pack-hint').textContent = 'Tap to crack it!';
      }
      await opening;
      var emergeFrom = capturePackEmergence(packScene, choiceViews[index].button.querySelector('canvas'), pack.items.length);
      $('pack-choices').hidden = true;
      $('pack-choices').classList.remove('choosing');
      choiceViews.forEach(v => v.card.classList.remove('selected', 'swiped-left', 'swiped-right'));
      revealIndex = 0;
      status('');
      opened = true;
    } catch (error) {
      // Refresh authoritative state after an ambiguous selection; never submit a
      // second choice automatically. A committed selection is recovered by request.
      offer = null; $('pack-choices').hidden = true;
      $('pack-choices').classList.remove('choosing');
      choiceViews.forEach(v => v.card.classList.remove('selected', 'swiped-left', 'swiped-right'));
      status(error.message + ' Try again to recover your pack.');
    } finally {
      picking = false;
      busy = false;
      $('pack-hint').textContent = '';
      packScene?.reset();
      updatePackButton();
      collectionList.render();
    }
    if (opened && pack) {
      if (onMintShot()) await beginStageReveal({ freshlyOpened: true, emergeFrom });
      else syncMintStage();
    } else if (!opened) {
      syncMintStage();
    }
  }
  $('mint').addEventListener('click', async () => {
    if (busy || !session?.owner) return;
    if (pack) {
      revealIndex = Math.max(0, pack.seen - 1);
      await beginStageReveal({ freshlyOpened: false });
    } else await loadChoices();
  });

  let sessionChecked = false;
  function renderSignedOut() {
    const panel = $('signed-out-panel');
    const path = location.pathname;
    const screen = path === '/mint' ? 'mint' : path === '/collection' ? 'collection' : null;
    panel.hidden = !sessionChecked || Boolean(session?.owner) || !screen;
    if (panel.hidden) return;
    const host = screen === 'mint' ? $('mint-world') : ($('collection-ice') || $('collection-world'));
    if (host && panel.parentElement !== host) host.append(panel);
    const title = screen === 'mint' ? 'Ubu Mint' : 'Collection';
    $('signed-out-title').textContent = title;
    $('signed-out-title').hidden = screen === 'mint';
    $('signed-out-message').textContent = (screen === 'mint' ? '' : "You're not signed in. ") + (config.login
      ? `Sign in with Discord to access ${title}.` : 'Sign-in is unavailable here.');
    const signIn = $('signed-out-signin');
    signIn.hidden = !config.login;
    signIn.href = '/auth/discord?return=' + encodeURIComponent(path);
    signIn.onclick = config.login ? event => window.openDiscordLogin(event) : null;
    const importWrap = $('signed-out-import-wrap');
    if (importWrap) importWrap.hidden = screen !== 'collection';
  }
  window.addEventListener('ubu:before-screen', event => {
    if (event.detail !== 'mint') closeRevealImmediate();
    if (event.detail !== 'collection' && collectionViewerOpen) void closeCollectionViewer({ immediate: true });
  });
  window.addEventListener('ubu:screen', event => {
    renderSignedOut();
    if (event.detail !== 'mint') closeRevealImmediate();
    else syncMintStage();
    if (event.detail !== 'collection' && collectionViewerOpen) void closeCollectionViewer({ immediate: true });
  });

  starterPack('daily-pack', 'daily', 'Daily pack');
  const signupStageView = starterPack('signup-stage-pack', 'signup', 'Signup bonus');
  const homeSignupView = starterPack('home-pack', 'signup', 'Signup bonus', false);
  homeSignupView?.button.addEventListener('click', async () => {
    if (busy) return;
    pendingSignupOpen = true;
    if (location.pathname !== '/mint') {
      const moved = window.navigateUbuScreen ? await window.navigateUbuScreen('/mint') : false;
      if (!moved) { pendingSignupOpen = false; return; }
    } else {
      syncMintStage();
    }
    await (window.ubuStageReady?.() ?? Promise.resolve());
    if (!pendingSignupOpen || location.pathname !== '/mint') return;
    pendingSignupOpen = false;
    await openStarter('signup', signupStageView);
  });
  window.addEventListener('ubu:starter', () => { if (sessionChecked) syncDaily(); });

  function resetAccountState() {
    clearCoinTimer();
    window.ubuAudio?.stop();
    closeRevealImmediate();
    if ($('viewer')?.open) $('viewer').close();
    packScene?.reset();
    for (const view of choiceViews) {
      view.scene?.reset();
      view.card.classList.remove('selected', 'swiped-left', 'swiped-right');
    }
    packScene = null;
    pack = null;
    offer = null;
    current = null;
    packKey = '';
    pendingKey = '';
    revealIndex = 0;
    pendingSignupOpen = false;
    fadeNextChoices = false;
    outOfPacks = false;
    dealFailed = false;
    collectionFailed = false;
    picking = false;
    busy = false;
    $('pack-choices').hidden = true;
    $('daily-pack').hidden = true;
    if ($('signup-stage-pack')) $('signup-stage-pack').hidden = true;
    $('mint-ubus').hidden = true;
    $('mint-ubus').replaceChildren();
    delete $('mint-ubus').dataset.packId;
    $('collection').hidden = true;
    $('mint-recovery').hidden = true;
    $('pack-hint').textContent = '';
    resetMintCamera({ immediate: true });
    status('');
    collectionRecovery();
    updatePackButton();
  }

  let sessionGeneration = 0;
  async function handleSession(s) {
    const gen = ++sessionGeneration;
    const prevOwner = session?.owner || null;
    const nextOwner = s?.owner || null;
    if (prevOwner !== nextOwner || !nextOwner) resetAccountState();
    session = s?.owner ? s : null;
    sessionChecked = true;
    renderSignedOut();
    $('mint-retry').hidden = true;
    if (session?.owner) {
      pendingKey = `ubumint:pending:${config.mint}:${session.owner}`;
      packKey = `ubumint:reveal:${config.mint}:${session.owner}`;
      const saved = localStorage.getItem(packKey);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          const restored = await readPack(data.certificates, data.seen);
          if (gen !== sessionGeneration) return;
          pack = restored;
          localStorage.removeItem(pendingKey);
          localStorage.removeItem(pendingKey + ':choice');
        } catch {
          pack = null;
          localStorage.removeItem(packKey);
        }
      } else {
        pack = null;
      }
      if (gen !== sessionGeneration) return;
      updatePackButton();
      packShop()?.classList.toggle('settled', Boolean(pack));
      const canOpen = pack || (config.ready && (config.lifetimeLimit || localStorage.getItem(pendingKey)));
      status(canOpen ? '' : config.ready ? 'No packs are available for this account.' : 'Minting closed', true);
      $('mint-recovery').hidden = Boolean(canOpen);
      if (config.ready) {
        try { await migrateBrowserFavorites(); } catch (error) { if (gen === sessionGeneration) status('Could not migrate browser favorites: ' + error.message); }
        if (gen !== sessionGeneration) return;
        await ubuStarter.refresh().catch(error => { if (gen === sessionGeneration) { status(error.message); packShop()?.classList.add('settled'); } });
        if (gen !== sessionGeneration) return;
        syncMintStage();
        await collection();
      } else {
        syncMintStage();
        collectionStatus('The collection is unavailable right now.');
        collectionRecovery({ importFile: true });
      }
    } else {
      syncMintStage();
    }
  }

  window.addEventListener('ubu:session', event => {
    const next = event.detail;
    if (next?.owner && (!session?.owner || session.owner !== next.owner)) {
      void handleSession(next).catch(error => status(error.message));
    } else if (next?.owner) {
      session = next; // A new Activity launch renews the CSRF token.
    } else if (!next?.owner && session?.owner) {
      void handleSession(null).catch(() => {});
    }
  });

  async function bootMint() {
    $('mint-recovery').hidden = $('mint-retry').hidden = true;
    try {
      config = await ubuList.config();
      let initialSession = window.getUbuSession?.() || null;
      if (window.ubuActivity && !initialSession?.owner) {
        try { initialSession = await window.ubuActivity.signIn(); } catch {}
      } else if (config.login && !initialSession) {
        initialSession = await (window.checkUbuSession ? window.checkUbuSession(false) : api('/api/session'));
      }
      await handleSession(initialSession);
    } catch {
      status('Could not connect to the mint. Try again.');
      $('mint-recovery').hidden = $('mint-retry').hidden = false;
      collectionRecovery({ retry: true, importFile: true });
    }
  }
  void bootMint();
})();
