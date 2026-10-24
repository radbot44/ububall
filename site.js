'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let config = { ready: false }, session = null, current = null, next = null, busy = false;
  const keys = new Map();
  let pack = null, packKey = '', pendingKey = '', collectionVersion = 0;
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
    const label = pack ? 'Continue your pack' : retry ? 'Retry opening your pack' : 'Unwrap your ubu pack';
    $('mint').setAttribute('aria-label', label);
    $('pack-hint').textContent = busy ? 'Unwrapping your originals…' : session?.owner ? label + ' ↗' : 'Sign in to unwrap your pack';
  }
  function tradingCard(item) {
    const card = document.createElement('article');
    card.className = 'trading-card';
    card.style.setProperty('--card-hue', String(155 + item.rarity.percentile * 1.5));
    if (item.rarity.percentile >= 95) card.classList.add('foil');
    const top = document.createElement('div'); top.className = 'card-top';
    const brand = document.createElement('span'); brand.textContent = 'ubu / ORIGINAL';
    const serial = document.createElement('span'); serial.textContent = '#' + item.result.certificate.serial;
    top.append(brand, serial);
    const art = document.createElement('div'); art.className = 'card-art'; art.append(ubuRender(item.model));
    const name = document.createElement('h3'); name.textContent = item.model.parts.fullName;
    const stats = document.createElement('div'); stats.className = 'card-stats';
    for (const [label, value] of [['APPEARANCE RARITY', `${item.rarity.percentile.toFixed(1)} / 100`], ['UBUQUITY', item.model.grade]]) {
      const stat = document.createElement('div'), caption = document.createElement('span'), number = document.createElement('strong');
      caption.textContent = label; number.textContent = value; stat.append(caption, number); stats.append(stat);
    }
    const footer = document.createElement('p'); footer.className = 'card-footer'; footer.textContent = 'MINT SIGNATURE VERIFIED · ONE OF YOUR ORIGINALS';
    card.append(top, art, name, stats, footer);
    return card;
  }
  function showReveal() {
    if (!pack.seen) {
      pack.seen = 1;
      try { savePack(); } catch (error) { pack.seen = 0; throw error; }
    }
    const index = Math.max(0, pack.seen - 1), item = pack.items[index];
    const last = index === pack.items.length - 1;
    $('reveal-title').textContent = last ? (pack.items.length > 1 ? 'The rarest in your pack.' : 'Your little original.') : index === 0 ? 'Meet your first ubu.' : 'Another little original.';
    $('reveal-progress').textContent = `${index + 1} of ${pack.items.length} ubus`;
    $('card-stage').replaceChildren(tradingCard(item));
    $('reveal-dots').replaceChildren(...pack.items.map((_, i) => { const dot = document.createElement('span'); dot.className = i <= index ? 'seen' : ''; return dot; }));
    $('next-ubu').textContent = last ? 'Finish pack ✓' : 'Reveal next ubu →';
    display(item.text, item.result);
    if (!$('reveal').open) $('reveal').showModal();
    $('next-ubu').focus();
  }
  async function refreshCollection() {
    try { await collection(true); } catch (error) { status(`Your pack is saved. Collection could not refresh: ${error.message}`); }
  }
  $('next-ubu').addEventListener('click', () => {
    try {
      if (pack.seen < pack.items.length) {
        pack.seen++;
        try { savePack(); } catch (error) { pack.seen--; throw error; }
        showReveal();
      } else {
        localStorage.removeItem(packKey);
        const count = pack.items.length; pack = null;
        $('reveal').close(); status(`All ${count} ubus revealed. Your originals are in your collection.`);
        updatePackButton();
      }
      void refreshCollection();
    } catch (error) { $('reveal-progress').textContent = `Could not save your place: ${error.message}`; }
  });
  $('pause-reveal').addEventListener('click', () => $('reveal').close());
  $('reveal').addEventListener('close', () => { updatePackButton(); $('mint').focus(); });
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
    current = { text, name: model.parts.fullName };
    $('preview').replaceChildren(ubuRender(model));
    $('ubunym').textContent = model.parts.fullName;
    const rarityText = r ? ` · Rarity ${r.percentile.toFixed(1)} / 100 (${r.bits.toFixed(1)} bits)` : '';
    $('details').textContent = `Ubuquity ${model.grade}${rarityText}` + (result.certificate ? ` · #${result.certificate.serial}` : '');
    $('authenticity').textContent = result.type === 'signed' ? 'Mint signature verified · this file proves issuance, not ownership.' : 'Custom ubu · unsigned';
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
    if (reset && !cards.length) { const empty = document.createElement('p'); empty.textContent = pack ? 'Your ubus will appear here as you reveal them.' : 'No revealed ubus yet.'; $('ubus').append(empty); }
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
      try { showReveal(); await refreshCollection(); } catch (error) { status(error.message); }
      return;
    }
    busy = true; updatePackButton();
    try {
      let request = localStorage.getItem(pendingKey);
      if (!request) { request = crypto.randomUUID(); localStorage.setItem(pendingKey, request); }
      ++collectionVersion;
      $('mint').classList.add('unwrapping');
      status('Unwrapping your pack…');
      const animation = new Promise(resolve => setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1100));
      const data = await api('/api/mint', post({ request }));
      pack = await readPack(data.certificates);
      try { savePack(); } catch (error) { pack = null; throw error; }
      localStorage.removeItem(pendingKey);
      await animation;
      showReveal();
      status('Your pack is open. Discover each ubu to add it to your collection.');
      await refreshCollection();
    } catch (error) { status(error.message); }
    finally { busy = false; $('mint').classList.remove('unwrapping'); updatePackButton(); }
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
        status(config.ready && config.lifetimeLimit ? `Lifetime allowance: ${config.lifetimeLimit} pack${config.lifetimeLimit === 1 ? '' : 's'} per account.` : 'Pack opening is not open yet. You can still view .ubu files.');
        if (pack) status('Your unwrapped pack is waiting. Continue where you left off.');
        else if (localStorage.getItem(pendingKey)) status('Your pack opening was interrupted. Tap the wrapper to safely retry.');
        if (config.ready) await collection(true);
      } else status(config.login ? 'Sign in with Discord to open a pack and see your collection.' : 'Pack opening is not open yet. You can still view custom .ubu files.');
    } catch (error) { status(error.message); }
  })();
})();
