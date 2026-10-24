'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let config = { ready: false }, session = null, current = null, next = null, busy = false;
  const keys = new Map();
  let packScene = null;
  try { packScene = createPackScene($('pack-canvas')); } catch { /* Keep opening usable without canvas. */ }
  if (!packScene) { $('pack-canvas').hidden = true; $('pack-canvas').nextElementSibling.hidden = false; }
  let pack = null, packKey = '', pendingKey = '', collectionVersion = 0, revealIndex = 0;
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
    items.sort((a, b) => a.rarity.bits - b.rarity.bits || a.result.certificate.serial.localeCompare(b.result.certificate.serial));
    return { items, seen };
  }
  function updatePackButton() {
    const retry = pendingKey && localStorage.getItem(pendingKey);
    $('mint').disabled = busy || !session?.owner || !config.ready || (!pack && !retry && !config.lifetimeLimit);
    const label = pack ? 'Continue pack' : retry ? 'Retry pack' : 'Unwrap pack';
    $('mint').setAttribute('aria-label', label);
    $('pack-hint').textContent = busy ? 'Unwrapping…' : session?.owner ? label : '';
  }
  function tradingCard(item) {
    const card = document.createElement('article');
    card.className = 'trading-card';
    card.style.setProperty('--card-hue', String(155 + item.rarity.percentile * 1.5));
    if (item.rarity.percentile >= 95) card.classList.add('foil');
    const signX = Math.random() < .5 ? -1 : 1, signY = Math.random() < .5 ? -1 : 1;
    const dur = 0.58 + Math.random() * 0.14, rest = 13 + Math.random() * 3;
    card.style.setProperty('--wobble-rx', `${((7 + Math.random() * 5) * signX).toFixed(1)}deg`);
    card.style.setProperty('--wobble-ry', `${((6 + Math.random() * 6) * signY).toFixed(1)}deg`);
    card.style.setProperty('--wobble-y', `${(22 + Math.random() * 8).toFixed(1)}px`);
    card.style.setProperty('--wobble-dur', `${dur.toFixed(2)}s`);
    card.style.setProperty('--popout-peak', `${(27 + Math.random() * 8).toFixed(1)}px`);
    card.style.setProperty('--popout-rest', `${rest.toFixed(1)}px`);
    card.style.setProperty('--float-min', `${(10 + Math.random() * 2).toFixed(1)}px`);
    card.style.setProperty('--float-max', `${(15 + Math.random() * 3).toFixed(1)}px`);
    card.style.setProperty('--float-y', `${(-1.5 - Math.random() * 1.5).toFixed(1)}px`);
    card.style.setProperty('--float-dur', `${(3.0 + Math.random() * 1.2).toFixed(2)}s`);
    card.style.setProperty('--float-delay', `${dur.toFixed(2)}s`);
    const top = document.createElement('div'); top.className = 'card-top';
    const brand = document.createElement('img'); brand.src = 'uburoom-wordmark-brand.svg'; brand.alt = 'uburoom';
    const serial = document.createElement('span'); serial.textContent = '#' + item.result.certificate.serial;
    top.append(brand, serial);
    const art = document.createElement('div'); art.className = 'card-art'; art.append(ubuRender(item.model, 'oomark', card));
    const name = document.createElement('h3'); name.textContent = item.model.parts.fullName;
    const stats = document.createElement('div'); stats.className = 'card-stats';
    for (const [label, value] of [['Rarity', `${item.rarity.percentile.toFixed(1)} / 100`], ['Ubuquity', item.model.grade]]) {
      const stat = document.createElement('div'), caption = document.createElement('span'), number = document.createElement('strong');
      caption.textContent = label; number.textContent = value; stat.append(caption, number); stats.append(stat);
    }
    card.append(top, art, name, stats);
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
    display(item.text, item.result);
    $('card-stage').replaceChildren(tradingCard(item));
    $('reveal-dots').replaceChildren(...pack.items.map((_, i) => { const dot = document.createElement('span'); dot.className = i === index ? 'current' : i < pack.seen ? 'seen' : ''; return dot; }));
    $('prev-ubu').disabled = index === 0;
    $('next-ubu').disabled = last;
    $('finish-pack').hidden = pack.seen < pack.items.length;
    if (!$('reveal').open) $('reveal').showModal();
  }
  async function refreshCollection() {
    try { await collection(true); } catch (error) { status(`Your pack is saved. Collection could not refresh: ${error.message}`); }
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
      if (pack.seen !== previousSeen) void refreshCollection();
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
  $('finish-pack').addEventListener('click', () => {
    if (!pack || pack.seen < pack.items.length) return;
    try {
      localStorage.removeItem(packKey); pack = null;
      packScene?.reset(true);
      $('reveal').close(); status(''); updatePackButton();
    } catch (error) { $('reveal-progress').textContent = error.message; }
  });
  $('pause-reveal').addEventListener('click', () => $('reveal').close());
  $('reveal').addEventListener('close', () => {
    if (current) display(current.text, current.result);
    updatePackButton(); $('mint').focus();
  });
  const status = text => { $('status').textContent = text; };
  async function trustedKey(mint, id) {
    if (!config.ready || mint !== config.mint || !Object.hasOwn(config.keys, id)) return null;
    if (!keys.has(id)) keys.set(id, crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: config.keys[id], ext: true }, 'Ed25519', false, ['verify']));
    return keys.get(id);
  }
  async function inspect(text) { return ubuFile.read(text, { resolveKey: trustedKey }); }
  function display(text, result) {
    const model = ubu.decode(ubu.fromCode(result.dna));
    const r = window.rarity ? rarity.scoreRarity(model) : null;
    current = { text, result, name: model.parts.fullName };
    $('preview').replaceChildren(ubuRender(model));
    $('ubunym').textContent = model.parts.fullName;
    const rarityText = r ? ` · Rarity ${r.percentile.toFixed(1)} / 100 (${r.bits.toFixed(1)} bits)` : '';
    $('details').textContent = `Ubuquity ${model.grade}${rarityText}` + (result.certificate ? ` · #${result.certificate.serial}` : '');
    $('authenticity').textContent = result.type === 'signed' ? 'Verified mint certificate' : 'Custom · unsigned';
    $('download').hidden = false;
  }
  async function api(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The mint could not complete this request.');
    return data;
  }
  const post = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': session.csrf }, body: JSON.stringify(data) });
  async function collection(reset = false) {
    // Until an interrupted mint is recovered, its newly allocated serials are unknown.
    if (pendingKey && localStorage.getItem(pendingKey)) return;
    const version = ++collectionVersion;
    const data = await api('/api/ubus' + (!reset && next ? '?after=' + encodeURIComponent(next) : ''));
    const cards = [];
    for (const entry of data.ubus) {
      if (unseen(entry.serial)) continue;
      if (!entry.certificate) {
        const pending = document.createElement('p'); pending.textContent = `#${entry.serial} · Certificate pending`; cards.push(pending); continue;
      }
      const result = await inspect(entry.certificate);
      const model = ubu.decode(ubu.fromCode(result.dna));
      const card = document.createElement('button'); card.className = 'card';
      const name = document.createElement('span'); name.textContent = model.parts.fullName;
      const serial = document.createElement('span'); serial.textContent = '#' + entry.serial;
      card.append(ubuRender(model, 'ubu-thumb'), name, serial);
      card.addEventListener('click', () => { display(entry.certificate, result); status(''); });
      cards.push(card);
    }
    if (version !== collectionVersion || (pendingKey && localStorage.getItem(pendingKey))) return;
    if (reset) $('ubus').replaceChildren(...cards); else $('ubus').append(...cards);
    if (reset && !cards.length) { const empty = document.createElement('p'); empty.textContent = 'No revealed ubus.'; $('ubus').append(empty); }
    next = data.next; $('more').hidden = !next; $('collection').hidden = false;
  }
  $('import').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > ubuFile.MAX_BYTES) throw new Error('A .ubu file must contain 1–1024 bytes.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await inspect(bytes);
      display(new TextDecoder().decode(bytes), result); status('');
    } catch (error) { status(error.message); }
    finally { event.target.value = ''; }
  });
  $('download').addEventListener('click', () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([current.text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = current.name.replaceAll(' ', '-') + '.ubu';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('mint').addEventListener('click', async () => {
    if (busy || !session?.owner) return;
    if (pack) {
      try { revealIndex = Math.max(0, pack.seen - 1); showReveal(); await refreshCollection(); } catch (error) { status(error.message); }
      return;
    }
    busy = true; updatePackButton();
    try {
      let request = localStorage.getItem(pendingKey);
      if (!request) { request = crypto.randomUUID(); localStorage.setItem(pendingKey, request); }
      ++collectionVersion;
      $('mint').classList.add('unwrapping');
      status('');
      const data = await api('/api/mint', post({ request }));
      pack = await readPack(data.certificates);
      try { savePack(); } catch (error) { pack = null; throw error; }
      localStorage.removeItem(pendingKey);
      await packScene?.play(pack.items.length);
      revealIndex = 0;
      showReveal();
      status('');
      await refreshCollection();
    } catch (error) { status(error.message); }
    finally { busy = false; packScene?.reset(); $('mint').classList.remove('unwrapping'); updatePackButton(); }
  });
  $('logout').addEventListener('click', async () => {
    try { await api('/api/logout', post({})); location.reload(); } catch (error) { status(error.message); }
  });
  $('more').addEventListener('click', async () => {
    $('more').disabled = true;
    try { await collection(); } catch (error) { status(error.message); } finally { $('more').disabled = false; }
  });
  (async () => {
    try {
      config = await api('/api/config');
      $('login').hidden = !config.login;
      if (config.login) session = await api('/api/session');
      if (session?.owner) {
        $('login').hidden = true; $('logout').hidden = false;
        pendingKey = `ubumint:pending:${config.mint}:${session.owner}`;
        packKey = `ubumint:reveal:${config.mint}:${session.owner}`;
        const saved = localStorage.getItem(packKey);
        if (saved) {
          const data = JSON.parse(saved); pack = await readPack(data.certificates, data.seen);
          localStorage.removeItem(pendingKey);
        }
        updatePackButton();
        status(config.ready && config.lifetimeLimit ? `${config.lifetimeLimit} pack${config.lifetimeLimit === 1 ? '' : 's'} per account` : 'Minting closed');
        if (pack) status('');
        else if (localStorage.getItem(pendingKey)) status('Opening interrupted. Retry to continue.');
        if (config.ready) await collection(true);
      } else { $('pack-hint').textContent = ''; status(config.login ? 'Sign in to open packs.' : 'Minting closed'); }
    } catch (error) { status(error.message); }
  })();
})();
