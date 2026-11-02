'use strict';
// The signed-in player's ubus, shared by Collection and the team picker: fetched and verified
// once, then searched, filtered and sorted in memory, so stat orders cover the whole collection.
(function(root) {
  const STAT_GROUPS = [
    ['Movement', '#76b9ef', ['impulse', 'traction', 'spin', 'curve']],
    ['Physical', '#42c66b', ['size', 'mass', 'bounciness', 'grip']],
    ['Engagement', '#ff9954', ['power', 'reach', 'strength', 'stability']],
    ['Super', '#ff7197', ['efficiency', 'synergy', 'chemistry']]
  ];
  const GRADES = ['C', 'B', 'A', 'S', 'S+', 'U', 'UBU'];
  const label = key => key[0].toUpperCase() + key.slice(1);
  const higher = value => (a, b) => value(b) - value(a);
  // Each order's natural direction comes first; `reverse` flips it. `words` name both directions.
  const SORTS = {
    recent: { label: 'Mint date', words: ['Newest', 'Oldest'], compare: higher(item => item.issuedAt || 0) },
    favorite: { label: 'Favorites first', words: ['Favorites first', 'Favorites last'], compare: higher(item => Number(item.favorite)) },
    rarity: { label: 'Rarity', compare: higher(item => item.rarity?.bits || 0) },
    ubuquity: { label: 'Ubuquity', compare: higher(item => item.model.rating) },
    serial: { label: 'Serial number', words: ['Lowest', 'Highest'], compare: (a, b) => a.serial.localeCompare(b.serial) },
    name: { label: 'Name', words: ['A–Z', 'Z–A'], compare: (a, b) => a.model.parts.fullName.localeCompare(b.model.parts.fullName) }
  };
  for (const [, color, keys] of STAT_GROUPS) {
    for (const key of keys) SORTS[key] = { label: label(key), color, stat: key, compare: higher(item => item.model.stats[key]) };
  }
  const DEFAULT_STATE = Object.freeze({ sort: 'recent', reverse: false, query: '', favoritesOnly: false, grades: [], supers: [] });

  // Pending ubus (no certificate yet) follow the rest and drop out once anything filters.
  function view(items, state = {}) {
    const s = { ...DEFAULT_STATE, ...state };
    const grades = new Set(s.grades), supers = new Set(s.supers);
    const query = s.query.trim().toLowerCase(), digits = /^#?[0-9]+$/.test(query) ? query.replace('#', '') : null;
    const filtering = Boolean(query || grades.size || supers.size || s.favoritesOnly);
    const shown = [], pending = [];
    for (const item of items) {
      if (!item.model) { if (!filtering) pending.push(item); continue; }
      if (s.favoritesOnly && !item.favorite) continue;
      if (grades.size && !grades.has(item.model.grade)) continue;
      if (supers.size && !item.model.supers.some(id => supers.has(id % 8))) continue;
      if (query && !(digits === null ? item.model.parts.fullName.toLowerCase().includes(query) : item.serial.includes(digits))) continue;
      shown.push(item);
    }
    const order = SORTS[s.sort] || SORTS.recent, sign = s.reverse ? -1 : 1;
    shown.sort((a, b) => sign * order.compare(a, b) || b.serial.localeCompare(a.serial));
    pending.sort((a, b) => b.serial.localeCompare(a.serial));
    return shown.concat(pending);
  }

  // Above 99 a run of nines extends the display to the first other digit, so rounding never
  // carries into them; six or more nines may round up.
  function rarityScore(percentile) {
    if (percentile <= 99) return percentile.toFixed(2);
    const nines = percentile.toFixed(12).split('.')[1].match(/^9*/)[0].length;
    return percentile.toFixed(nines >= 6 ? 3 : Math.max(3, nines + 1));
  }

  const api = { STAT_GROUPS, GRADES, SORTS, DEFAULT_STATE, view, rarityScore };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  const items = new Map(), keys = new Map();
  let configRequest = null, loading = null, loaded = false, generation = 0, owner;
  const changing = new Set();
  async function request(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load your ubus.');
    return data;
  }
  function config() {
    configRequest ||= request('/api/config').catch(error => { configRequest = null; throw error; });
    return configRequest;
  }
  async function trustedKey(mint, id) {
    const c = await config();
    if (!c.ready || mint !== c.mint || !Object.hasOwn(c.keys, id)) return null;
    if (!keys.has(id)) keys.set(id, crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: c.keys[id], ext: true }, 'Ed25519', false, ['verify']));
    return keys.get(id);
  }
  const changed = () => root.dispatchEvent(new CustomEvent('ubu-list:change'));
  function reset() { generation++; items.clear(); loading = null; loaded = false; changed(); }
  // Another account's ubus never linger; the first session report only records the owner.
  root.addEventListener('ubu:session', event => {
    const next = event.detail?.owner || null;
    if (owner !== undefined && next !== owner) reset();
    owner = next;
  });

  async function record(row) {
    const old = items.get(row.serial);
    if (old && old.certificate === row.certificate) return { ...old, favorite: row.favorite };
    if (!row.certificate) return { serial: row.serial, favorite: row.favorite, pending: true };
    const result = await ubuFile.read(row.certificate, { allowUnsigned: false, resolveKey: trustedKey });
    const model = ubu.decode(ubu.fromCode(result.dna));
    return { serial: row.serial, certificate: row.certificate, result, model, rarity: root.rarity.scoreRarity(model),
      issuedAt: result.certificate.issuedAt, favorite: row.favorite };
  }
  // Reads every page; `refresh` refetches a loaded collection, keeping verified entries.
  function load({ refresh = false } = {}) {
    if (loading && !refresh) return loading;
    if (loaded && !refresh) return Promise.resolve();
    const run = ++generation;
    loading = (async () => {
      // Only entries present at the start can be stale; ubus added meanwhile (a new pack) stay.
      const before = new Set(items.keys()), seen = new Set();
      let after = '';
      try {
        do {
          const data = await request('/api/ubus' + (after ? '?after=' + encodeURIComponent(after) : ''));
          const page = await Promise.all(data.ubus.map(record));
          if (run !== generation) return;
          for (const item of page) { seen.add(item.serial); items.set(item.serial, item); }
          after = data.next;
          if (!after) for (const serial of before) if (!seen.has(serial)) items.delete(serial);
          changed();
        } while (after);
        loaded = true;
      } finally { if (run === generation) loading = null; }
    })();
    return loading;
  }
  function add(item) { items.set(item.serial, item); changed(); }
  async function setFavorite(serial, favorite) {
    const item = items.get(serial);
    if (!item || changing.has(serial)) return;
    changing.add(serial);
    try {
      const session = root.getUbuSession?.() || await request('/api/session');
      const result = await request('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': session.csrf },
        body: JSON.stringify({ serial, favorite }) });
      const current = items.get(serial);
      if (current) { current.favorite = result.favorite; changed(); }
    } finally { changing.delete(serial); }
  }

  // Sort, direction and filters persist per list; the search box does not.
  function savedState(surface) {
    try {
      const saved = JSON.parse(localStorage.getItem('ububall.list.' + surface) || '{}');
      return {
        ...DEFAULT_STATE,
        sort: Object.hasOwn(SORTS, saved.sort) ? saved.sort : DEFAULT_STATE.sort,
        reverse: saved.reverse === true, favoritesOnly: saved.favoritesOnly === true,
        grades: Array.isArray(saved.grades) ? saved.grades.filter(g => GRADES.includes(g)) : [],
        supers: Array.isArray(saved.supers) ? saved.supers.filter(id => Number.isInteger(id) && id >= 0 && id < 8) : []
      };
    } catch { return { ...DEFAULT_STATE }; }
  }
  function saveState(surface, { sort, reverse, favoritesOnly, grades, supers }) {
    try { localStorage.setItem('ububall.list.' + surface, JSON.stringify({ sort, reverse, favoritesOnly, grades, supers })); } catch {}
  }

  const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
  function heartIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572');
    svg.append(path);
    return svg;
  }
  const directionWords = sort => SORTS[sort].words || ['High–low', 'Low–high'];
  function chipValue(item, sort) {
    const order = SORTS[sort];
    if (order.stat) return [order.label + ' ' + item.model.stats[order.stat], order.color];
    if (sort === 'ubuquity') return ['Ubuquity ' + item.model.rating, '#ff7197'];
    if (sort === 'rarity' && item.rarity) return ['Rarity ' + rarityScore(item.rarity.percentile), ''];
    return null;
  }

  function toolbar(state, onChange) {
    const search = el('input', { type: 'search', placeholder: 'Search name or serial', className: 'ubu-search' });
    search.setAttribute('aria-label', 'Search ubus');
    const select = el('select', { className: 'ubu-sort' });
    select.setAttribute('aria-label', 'Sort by');
    select.append(el('optgroup', { label: 'Collection' }, ...['recent', 'favorite', 'rarity', 'ubuquity', 'serial', 'name'].map(key => new Option(SORTS[key].label, key))));
    for (const [group, , statKeys] of STAT_GROUPS) select.append(el('optgroup', { label: group }, ...statKeys.map(key => new Option(SORTS[key].label, key))));
    const direction = el('button', { type: 'button', className: 'ubu-direction' });
    const favorites = el('button', { type: 'button', className: 'card-heart ubu-favorites-only', title: 'Favorites only' }, heartIcon());
    favorites.setAttribute('aria-label', 'Favorites only');
    const filters = el('button', { type: 'button', className: 'ubu-filters-toggle' });
    const chip = (text, pressed, toggle, icon) => {
      const button = el('button', { type: 'button', className: 'ubu-chip' }, ...(icon ? [el('img', { src: icon, alt: '' })] : []), text);
      button.onclick = toggle;
      button.update = () => button.setAttribute('aria-pressed', String(pressed()));
      return button;
    };
    const toggleIn = (list, value) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];
    const gradeChips = GRADES.map(grade => {
      const button = chip(grade, () => state.grades.includes(grade), () => { state.grades = toggleIn(state.grades, grade); changed(true); });
      button.dataset.grade = grade;
      return button;
    });
    const superChips = (root.ububallPhysics?.SUPERS || []).map(s =>
      chip(s.name, () => state.supers.includes(s.id), () => { state.supers = toggleIn(state.supers, s.id); changed(true); }, s.icon));
    const clear = el('button', { type: 'button', className: 'ubu-chip ubu-clear', textContent: 'Clear' });
    clear.onclick = () => { state.grades = []; state.supers = []; state.favoritesOnly = false; state.query = ''; search.value = ''; changed(true); };
    const gradeGroup = el('div', { className: 'ubu-chip-group' }, ...gradeChips), superGroup = el('div', { className: 'ubu-chip-group' }, ...superChips);
    gradeGroup.setAttribute('role', 'group'); gradeGroup.setAttribute('aria-label', 'Grade');
    superGroup.setAttribute('role', 'group'); superGroup.setAttribute('aria-label', 'Supers');
    const panel = el('div', { className: 'ubu-chips', hidden: true }, gradeGroup, superGroup, clear);
    filters.onclick = () => { panel.hidden = !panel.hidden; update(); };
    function update() {
      select.value = state.sort; search.value = state.query;
      const words = directionWords(state.sort);
      direction.textContent = '⇅ ' + (state.reverse ? words[1] : words[0]);
      direction.setAttribute('aria-label', 'Order: ' + (state.reverse ? words[1] : words[0]) + '. Reverse order');
      favorites.setAttribute('aria-pressed', String(state.favoritesOnly));
      const count = state.grades.length + state.supers.length;
      filters.textContent = count ? `Filters (${count})` : 'Filters';
      filters.setAttribute('aria-expanded', String(!panel.hidden));
      for (const button of [...gradeChips, ...superChips]) button.update();
    }
    function changed(persist) { update(); onChange(persist); }
    let typing = 0;
    search.oninput = () => { clearTimeout(typing); typing = setTimeout(() => { state.query = search.value; onChange(false); }, 150); };
    select.onchange = () => { state.sort = select.value; state.reverse = false; changed(true); };
    direction.onclick = () => { state.reverse = !state.reverse; changed(true); };
    favorites.onclick = () => { state.favoritesOnly = !state.favoritesOnly; changed(true); };
    update();
    return el('div', { className: 'ubu-toolbar' }, el('div', { className: 'ubu-toolbar-row' }, search, select, direction, favorites, filters), panel);
  }

  // A tile's face: art box (empty, for the caller to fill), name, grade and caption, distinct
  // supers with their mastery level, and a value chip for stat orders.
  function tileMain(model, caption) {
    const artBox = el('span', { className: 'ubu-tile-art' });
    const supers = el('span', { className: 'ubu-tile-supers' });
    for (const id of new Set(model.supers.map(s => s % 8))) {
      const info = root.ububallPhysics?.SUPERS[id];
      if (!info) continue;
      const mastery = root.ububallPhysics.superMastery(model.supers, id);
      const badge = el('span', { title: mastery.displayName }, el('img', { src: info.icon, alt: mastery.displayName }));
      if (mastery.level > 1) badge.append(el('small', { textContent: mastery.level === 4 ? 'M' : 'I'.repeat(mastery.level) }));
      supers.append(badge);
    }
    const grade = el('span', { className: 'ubu-tile-grade', textContent: model.grade, title: 'Ubuquity ' + model.grade });
    grade.dataset.grade = model.grade;
    const value = el('span', { className: 'ubu-tile-value', hidden: true });
    const main = el('button', { type: 'button', className: 'ubu-tile-main' }, artBox,
      el('span', { className: 'ubu-tile-name', textContent: model.parts.fullName }),
      el('span', { className: 'ubu-tile-meta' }, grade, el('span', { textContent: caption })), supers, value);
    return { main, artBox, value };
  }

  // Art is drawn the first time a tile scrolls near view, so large collections stay cheap.
  function lazyArt(scrollRoot) {
    if (!('IntersectionObserver' in root)) return { watch: (node, draw) => draw() };
    const draws = new Map();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target); draws.get(entry.target)?.(); draws.delete(entry.target);
      }
    }, { root: scrollRoot || null, rootMargin: '300px' });
    return { watch(node, draw) { draws.set(node, draw); observer.observe(node); } };
  }

  // One list surface: a toolbar over a grid of tiles. `pick` makes a click choose the ubu (the
  // team picker) and adds an inspect button; otherwise a click inspects it.
  function mount({ surface, toolbarHost, grid, scrollRoot, status, inspect, pick, pressed, hidden, paused, onEmpty }) {
    const state = savedState(surface);
    const tiles = new Map(), art = lazyArt(scrollRoot);
    let shown = [];
    function tile(item) {
      const cached = tiles.get(item.serial);
      if (cached?.item === item) return cached;
      if (cached) cached.item = item;
      const wrap = el('div', { className: 'ubu-tile' });
      wrap.dataset.serial = item.serial;
      if (item.pending) {
        wrap.classList.add('is-pending');
        wrap.append(el('p', { textContent: `#${item.serial} · Certificate pending` }));
        const entry = { item, wrap };
        tiles.set(item.serial, entry);
        return entry;
      }
      const name = item.model.parts.fullName;
      const { main, artBox, value } = tileMain(item.model, '#' + item.serial);
      main.onclick = () => (pick || inspect)(item);
      wrap.append(main);
      const heart = el('button', { type: 'button', className: 'card-heart ubu-tile-heart', title: 'Favorite' }, heartIcon());
      heart.setAttribute('aria-label', `Favorite ${name}`);
      heart.onclick = () => setFavorite(item.serial, !items.get(item.serial)?.favorite).catch(error => { if (status) status.textContent = 'Could not update favorite: ' + error.message; });
      wrap.append(heart);
      if (pick && inspect) {
        const info = el('button', { type: 'button', className: 'ubu-tile-inspect', textContent: 'i', title: 'Stats and details' });
        info.setAttribute('aria-label', `Inspect ${name}`);
        info.onclick = () => inspect(item);
        wrap.append(info);
      }
      art.watch(artBox, () => artBox.prepend(ubuRender(item.model, 'ubu-tile-svg')));
      const entry = { item, wrap, main, heart, value };
      tiles.set(item.serial, entry);
      return entry;
    }
    function render() {
      if (paused?.()) return;
      const all = [...items.values()].filter(item => !hidden?.(item) && !(pick && item.pending));
      const next = view(all, state).map(tile);
      if (next.length !== shown.length || next.some((entry, i) => entry !== shown[i])) grid.replaceChildren(...next.map(entry => entry.wrap));
      shown = next;
      for (const { item, main, heart, value } of shown) {
        if (!main) continue;
        const favorite = items.get(item.serial)?.favorite === true;
        heart.setAttribute('aria-pressed', String(favorite)); heart.classList.toggle('is-favorite', favorite);
        if (pressed) main.setAttribute('aria-pressed', String(pressed(item)));
        const chip = chipValue(item, state.sort);
        value.hidden = !chip;
        if (chip) { value.textContent = chip[0]; value.style.color = chip[1]; }
      }
      if (!shown.length) onEmpty?.(all.length ? 'filtered' : loading ? 'loading' : 'empty');
      else onEmpty?.(null);
    }
    toolbarHost.append(toolbar(state, persist => { if (persist) saveState(surface, state); render(); }));
    root.addEventListener('ubu-list:change', render);
    return { render, clearFilters: () => toolbarHost.querySelector('.ubu-clear').click() };
  }

  root.ubuList = Object.assign(api, {
    config, trustedKey, load, add, setFavorite, heartIcon, tileMain, mount,
    get: serial => items.get(serial), items: () => [...items.values()], loading: () => Boolean(loading)
  });
})(globalThis);
