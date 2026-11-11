'use strict';
// The signed-in player's ubus, shared by Collection and the team picker: fetched and verified
// once, then searched, filtered and sorted in memory, so stat orders cover the whole collection.
(function(root) {
  const archetypeApi = typeof module === 'object' && module.exports ? require('../shared/ubu-archetype.js') : root.ubuArchetype;
  function itemArchetype(item) {
    if (!item?.model || !archetypeApi) return null;
    if (item.archetype !== undefined) return item.archetype;
    if (!item.model.stats || !item.model.personality) return null;
    try { return (item.archetype = archetypeApi.describe(item.model)); } catch { return null; }
  }
  function itemNoun(item) {
    const full = itemArchetype(item);
    if (full) return full.noun;
    if (!item?.model?.stats || !archetypeApi) return '';
    try { return archetypeApi.chooseNoun(item.model.stats).noun; } catch { return ''; }
  }
  const STAT_GROUPS = [
    ['Movement', '#76b9ef', ['impulse', 'traction', 'spin', 'curve']],
    ['Physical', '#42c66b', ['size', 'mass', 'bounciness', 'grip']],
    ['Engagement', '#ff9954', ['power', 'reach', 'strength', 'stability']],
    ['Super', '#ff7197', ['efficiency', 'synergy', 'chemistry']]
  ];
  const STATS = STAT_GROUPS.flatMap(([, , keys]) => keys);
  const GRADES = ['C', 'B', 'A', 'S', 'S+', 'U', 'UBU'];
  const TRAITS = ['aggression', 'creativity', 'teamwork', 'clutch'];
  const SUPER_NAMES = ['stalwart', 'knockout', 'sticky', 'cannonball', 'magnet', 'colossus', 'shockwave', 'ghost'];
  const label = key => key[0].toUpperCase() + key.slice(1);
  const average = (item, keys) => keys.reduce((sum, key) => sum + item.model.stats[key], 0) / keys.length;
  const mastery = item => Math.max(...item.model.supers.map(id => item.model.supers.filter(other => other % 8 === id % 8).length));
  // What search terms compare and lists sort by. Orders put the highest value first unless
  // `ascending`; `words` name the natural and reversed directions; `show` formats a tile chip.
  const METRICS = {
    recent: { label: 'Mint date', words: ['Newest', 'Oldest'], value: item => item.issuedAt || 0 },
    favorite: { label: 'Favorites first', words: ['Favorites first', 'Favorites last'], value: item => Number(item.favorite) },
    rarity: { label: 'Rarity', value: item => item.rarity?.percentile ?? 0, show: item => item.rarity ? rarityScore(item.rarity.percentile) : '' },
    ubuquity: { label: 'Ubuquity', color: '#ff7197', value: item => item.model.rating },
    serial: { label: 'Serial number', words: ['Lowest', 'Highest'], ascending: true, value: item => Number(item.serial) },
    name: { label: 'Name', words: ['A–Z', 'Z–A'], ascending: true, compare: (a, b) => a.model.parts.fullName.localeCompare(b.model.parts.fullName) },
    archetype: { label: 'Archetype', words: ['A–Z', 'Z–A'], ascending: true, compare: (a, b) => (itemArchetype(a)?.fullName || '').localeCompare(itemArchetype(b)?.fullName || '') },
    random: { label: 'Random', words: ['Shuffle', 'Shuffle'] },
    all: { label: 'All stats (average)', value: item => average(item, STATS), show: item => average(item, STATS).toFixed(1) },
    grade: { label: 'Grade', value: item => GRADES.indexOf(item.model.grade), show: item => item.model.grade },
    mastery: { label: 'Mastery', value: mastery }
  };
  for (const [group, color, keys] of STAT_GROUPS) {
    METRICS[group.toLowerCase()] = { label: group + ' (average)', color, value: item => average(item, keys), show: item => average(item, keys).toFixed(1) };
    for (const stat of keys) METRICS[stat] = { label: label(stat), color, stat, value: item => item.model.stats[stat] };
  }
  for (const trait of TRAITS) METRICS[trait] = { label: label(trait), value: item => item.model.personality[trait] };
  const ALIASES = { minted: 'recent', date: 'recent', received: 'recent', rating: 'ubuquity', fav: 'favorite', favourite: 'favorite',
    favorites: 'favorite', avg: 'all', average: 'all', stats: 'all', shuffle: 'random' };
  const metricKey = word => { const key = ALIASES[word] || word; return Object.hasOwn(METRICS, key) ? key : null; };
  const DEFAULT_STATE = Object.freeze({ sort: 'recent', reverse: false, seed: 1, query: '', favoritesOnly: false, grades: [], supers: [] });

  const serialLabel = serial => '#' + serial.replace(/^0+(?=[0-9])/, '');
  // A stable pseudo-random order per shuffle seed; it only arranges a list, so it need not be secure.
  function shuffleKey(serial, seed) {
    let h = (seed ^ 2166136261) >>> 0;
    for (let i = 0; i < serial.length; i++) h = Math.imul(h ^ serial.charCodeAt(i), 16777619);
    h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
    return h >>> 0;
  }
  function comparator(key, reverse, seed) {
    const metric = METRICS[key];
    let compare;
    if (key === 'random') compare = (a, b) => shuffleKey(a.serial, seed) - shuffleKey(b.serial, seed);
    else if (metric.compare) compare = metric.compare;
    else compare = metric.ascending ? (a, b) => metric.value(a) - metric.value(b) : (a, b) => metric.value(b) - metric.value(a);
    return reverse ? (a, b) => -compare(a, b) : compare;
  }
  // YYYY, YYYY-MM or YYYY-MM-DD in local time, as its [start, end) span in seconds.
  function dateSpan(text) {
    const match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(text);
    if (!match) return null;
    const y = Number(match[1]);
    const hasM = match[2] !== undefined, m = hasM ? Number(match[2]) : 1;
    const hasD = match[3] !== undefined, d = hasD ? Number(match[3]) : 1;
    if ((hasM && (m < 1 || m > 12)) || (hasD && (d < 1 || d > 31))) return null;
    const localDate = (year, monthIndex, day) => {
      const dt = new Date(0);
      dt.setFullYear(year, monthIndex, day);
      dt.setHours(0, 0, 0, 0);
      return dt;
    };
    const start = localDate(y, m - 1, d);
    if (start.getFullYear() !== y || start.getMonth() !== m - 1 || start.getDate() !== d) return null;
    const end = hasD ? localDate(y, m - 1, d + 1) : hasM ? localDate(y, m, 1) : localDate(y + 1, 0, 1);
    return [start / 1000, end / 1000];
  }
  const OPS = { '>': (v, x) => v > x, '>=': (v, x) => v >= x, '<': (v, x) => v < x, '<=': (v, x) => v <= x, '=': (v, x) => v === x, ':': (v, x) => v === x };
  // A date is a span: after it means from the next day (month, year) on, before it means earlier.
  const SPAN_OPS = { '>': (v, [, end]) => v >= end, '>=': (v, [start]) => v >= start, '<': (v, [start]) => v < start, '<=': (v, [, end]) => v < end,
    '=': (v, [start, end]) => v >= start && v < end, ':': (v, [start, end]) => v >= start && v < end };

  // Search text: words match names and numbers match serials; terms filter and sort. See SEARCH_HELP.
  // A leading - excludes a term. Unknown terms are reported, never guessed.
  function parseQuery(query = '') {
    const tests = [], sorts = [], errors = [], compared = [];
    for (const raw of query.match(/-?(?:[A-Za-z]+(?:>=|<=|>|<|=|:))?"[^"]*"?|\S+/g) || []) {
      const negate = raw.length > 1 && raw[0] === '-';
      const body = (negate ? raw.slice(1) : raw).toLowerCase();
      const add = test => tests.push(negate ? item => !test(item) : test);
      const quotedWhole = body.startsWith('"');
      const term = quotedWhole ? null : /^([a-z]+)(>=|<=|>|<|=|:)(.*)$/.exec(body);
      if (!term) {
        const token = body.replace(/^"|"$/g, '');
        if (!token) continue;
        const digits = /^#?[0-9]+$/.test(token) ? token.replace('#', '').replace(/^0+(?=[0-9])/, '') : null;
        add(digits === null ? item => item.model.parts.fullName.toLowerCase().includes(token) || (itemArchetype(item)?.fullName.toLowerCase().includes(token) ?? false)
          : item => item.serial.replace(/^0+(?=[0-9])/, '').includes(digits));
        continue;
      }
      let [, field, op, value] = term;
      value = value.replace(/^"|"$/g, '');
      if (field === 'before' || field === 'after') { op = field === 'before' ? '<' : '>'; field = 'minted'; }
      const key = metricKey(field), fail = () => errors.push(raw);
      if (field === 'sort' && op === ':') {
        if (negate || !value) { fail(); continue; }
        for (const part of value.split(',')) {
          const sortKey = metricKey(part.replace(/^-/, ''));
          if (sortKey) sorts.push({ key: sortKey, reverse: part.startsWith('-') }); else fail();
        }
      } else if (field === 'is' && op === ':') {
        if (metricKey(value) === 'favorite') add(item => item.favorite); else fail();
      } else if (field === 'name' && op === ':') {
        if (!value) fail();
        else add(item => item.model.parts.fullName.toLowerCase().includes(value));
      } else if (field === 'archetype' && (op === ':' || op === '=')) {
        const parts = value.split(',').map(s => s.trim()).filter(Boolean);
        if (!value || !parts.length) fail();
        else add(item => { const full = itemArchetype(item)?.fullName.toLowerCase() || ''; return parts.some(p => full.includes(p)); });
      } else if ((field === 'adj' || field === 'adjective') && (op === ':' || op === '=')) {
        const parts = value.split(',').map(s => s.trim()).filter(Boolean);
        if (!value || !parts.length) fail();
        else add(item => { const adj = itemArchetype(item)?.adjective.toLowerCase() || ''; return parts.some(p => adj.includes(p)); });
      } else if (field === 'noun' && (op === ':' || op === '=')) {
        const parts = value.split(',').map(s => s.trim()).filter(Boolean);
        if (!value || !parts.length) fail();
        else add(item => { const noun = itemNoun(item).toLowerCase(); return Boolean(noun) && parts.some(p => noun.includes(p)); });
      } else if (field === 'super' && op === ':' && value && !/^[0-9.]+$/.test(value)) {
        const ids = value.split(',').map(name => name ? SUPER_NAMES.findIndex(s => s.startsWith(name)) : -1);
        if (ids.includes(-1)) fail(); else add(item => item.model.supers.some(id => ids.includes(id % 8)));
      } else if (field === 'grade') {
        const grades = value.split(',').map(g => GRADES.indexOf(g.toUpperCase()));
        if (!value || grades.includes(-1) || (grades.length > 1 && op !== ':')) fail();
        else add(item => grades.some(g => OPS[op](GRADES.indexOf(item.model.grade), g)));
      } else if (key === 'recent') {
        const span = dateSpan(value);
        if (span) add(item => SPAN_OPS[op](item.issuedAt || 0, span)); else fail();
      } else {
        const number = Number(value);
        if (!key || !METRICS[key].value || key === 'favorite' || value === '' || !Number.isFinite(number)) { fail(); continue; }
        add(item => OPS[op](METRICS[key].value(item), number));
        if (!negate) compared.push(key);
      }
    }
    return { tests, sorts, errors, compared };
  }
  const SEARCH_HELP = [
    ['power>200', 'any stat; >, >=, <, <=, ='],
    ['movement>=150', 'group average: movement, physical, engagement, super; all for every stat'],
    ['ubuquity>800 rarity>90', 'also mastery, serial, aggression, creativity, teamwork, clutch'],
    ['grade>=s  grade:a,b', 'grades C B A S S+ U UBU'],
    ['super:magnet,ghost', 'has any of these supers'],
    ['is:fav', 'favorites'],
    ['after:2026-10-20  minted:2026-10', 'mint date: before:, after:, minted>= … by day, month or year'],
    ['sort:power  sort:-size', 'sort, highest first; - reverses; several apply in order'],
    ['sort:random', 'shuffle'],
    ['-super:ghost', 'a leading - excludes'],
    ['archetype:piston  adj:peppy', 'filter by archetype, adj: or noun:'],
    ['ruba  pinball  1084', 'words search names and archetypes, numbers search serials']
  ];

  // Pending ubus (no certificate yet) follow the rest and drop out once anything filters.
  // Query sorts come first, then the chosen order, then newest serial.
  function view(items, state = {}) {
    const s = { ...DEFAULT_STATE, ...state };
    const grades = new Set(s.grades), supers = new Set(s.supers), query = parseQuery(s.query);
    const filtering = Boolean(query.tests.length || grades.size || supers.size || s.favoritesOnly);
    const shown = [], pending = [];
    for (const item of items) {
      if (!item.model) { if (!filtering) pending.push(item); continue; }
      if (s.favoritesOnly && !item.favorite) continue;
      if (grades.size && !grades.has(item.model.grade)) continue;
      if (supers.size && !item.model.supers.some(id => supers.has(id % 8))) continue;
      if (!query.tests.every(test => test(item))) continue;
      shown.push(item);
    }
    const order = [...query.sorts, { key: metricKey(s.sort) || 'recent', reverse: s.reverse }].map(({ key, reverse }) => comparator(key, reverse, s.seed));
    shown.sort((a, b) => { for (const compare of order) { const c = compare(a, b); if (c) return c; } return b.serial.localeCompare(a.serial); });
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

  const api = { STAT_GROUPS, GRADES, METRICS, DEFAULT_STATE, parseQuery, view, rarityScore, serialLabel };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }

  const items = new Map(), keys = new Map(), favVersions = new Map(), touchedSerials = new Set();
  let configRequest = null, loading = null, loaded = false, generation = 0, accountEpoch = 0, favSeq = 0, owner;
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
    const cacheKey = `${c.mint}:${id}`;
    if (!keys.has(cacheKey)) {
      const promise = crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: c.keys[id] }, 'Ed25519', false, ['verify']);
      promise.catch(() => keys.delete(cacheKey));
      keys.set(cacheKey, promise);
    }
    return keys.get(cacheKey);
  }
  const changed = () => root.dispatchEvent(new CustomEvent('ubu-list:change'));
  function reset() {
    generation++;
    accountEpoch++;
    items.clear();
    favVersions.clear();
    touchedSerials.clear();
    changing.clear();
    loading = null;
    loaded = false;
    changed();
  }
  // Another account's ubus never linger; the first session report only records the owner.
  root.addEventListener('ubu:session', event => {
    const next = event.detail?.owner || null;
    if (owner !== undefined && next !== owner) reset();
    owner = next;
  });

  async function record(row, pageFavSeq) {
    const override = favVersions.get(row.serial);
    const favorite = override && override.ver > pageFavSeq ? override.favorite : row.favorite;
    const old = items.get(row.serial);
    if (old && old.certificate === row.certificate) return old.favorite === favorite ? old : { ...old, favorite };
    if (!row.certificate) return old?.pending && old.favorite === favorite ? old : { serial: row.serial, favorite, pending: true };
    const result = await ubuFile.read(row.certificate, { allowUnsigned: false, resolveKey: trustedKey });
    const model = ubu.decode(ubu.fromCode(result.dna));
    return { serial: row.serial, certificate: row.certificate, result, model, rarity: root.rarity.scoreRarity(model),
      archetype: archetypeApi ? archetypeApi.describe(model) : null, issuedAt: result.certificate.issuedAt, favorite };
  }
  // Reads every page; `refresh` refetches a loaded collection, keeping verified entries.
  function load({ refresh = false } = {}) {
    if (loading && !refresh) return loading;
    if (loaded && !refresh) return Promise.resolve();
    const run = ++generation;
    const epoch = accountEpoch;
    loading = (async () => {
      // Only entries present at the start can be stale; ubus added meanwhile (a new pack) stay.
      const before = new Set(items.keys());
      const beforePending = new Set([...items.values()].filter(i => i.pending).map(i => i.serial));
      const seen = new Set();
      touchedSerials.clear();
      let after = '', pages = 0;
      try {
        do {
          const pageFavSeq = favSeq;
          const data = await request('/api/ubus' + (after ? '?after=' + encodeURIComponent(after) : ''));
          pages++;
          const page = await Promise.all(data.ubus.map(row => record(row, pageFavSeq)));
          if (run !== generation) return epoch === accountEpoch && loading ? loading : undefined;
          for (const item of page) {
            const latestOverride = favVersions.get(item.serial);
            const merged = latestOverride && latestOverride.ver > pageFavSeq && item.favorite !== latestOverride.favorite
              ? { ...item, favorite: latestOverride.favorite }
              : item;
            seen.add(merged.serial);
            items.set(merged.serial, merged);
          }
          after = data.next;
          if (!after) {
            for (const serial of before) {
              if (!seen.has(serial) && !touchedSerials.has(serial) && !(pages > 1 && beforePending.has(serial))) {
                items.delete(serial);
              }
            }
          }
          changed();
        } while (after);
        loaded = true;
      } finally { if (run === generation) loading = null; }
    })();
    return loading;
  }
  function add(item) { touchedSerials.add(item.serial); items.set(item.serial, item); changed(); }
  async function post(path, data) {
    const session = root.getUbuSession?.() || await request('/api/session');
    if (!session?.csrf) throw new Error('Sign in with Discord first.');
    return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': session.csrf }, body: JSON.stringify(data) });
  }
  // The account's saved ububall teams: { teams: [{ name, slots }], last }, each slot { serial, super }.
  const teams = () => request('/api/teams');
  const saveTeams = data => post('/api/teams', data);
  async function setFavorite(serial, favorite) {
    const item = items.get(serial);
    if (!item || changing.has(serial)) return;
    changing.add(serial);
    const ver = ++favSeq;
    favVersions.set(serial, { ver, favorite });
    try {
      const result = await post('/api/favorites', { serial, favorite });
      favVersions.set(serial, { ver, favorite: result.favorite });
      const current = items.get(serial);
      if (current) {
        if (current.favorite !== result.favorite) items.set(serial, { ...current, favorite: result.favorite });
        changed();
      }
    } catch (error) {
      if (favVersions.get(serial)?.ver === ver) favVersions.delete(serial);
      throw error;
    } finally { changing.delete(serial); }
  }

  // Order, direction, shuffle and filters persist per list; the search box does not.
  function savedState(surface) {
    try {
      const saved = JSON.parse(localStorage.getItem('ububall.list.' + surface) || '{}');
      return {
        ...DEFAULT_STATE,
        sort: SORT_CHOICES.includes(saved.sort) ? saved.sort : DEFAULT_STATE.sort,
        reverse: saved.reverse === true, favoritesOnly: saved.favoritesOnly === true,
        seed: Number.isInteger(saved.seed) ? saved.seed : DEFAULT_STATE.seed,
        grades: Array.isArray(saved.grades) ? saved.grades.filter(g => GRADES.includes(g)) : [],
        supers: Array.isArray(saved.supers) ? saved.supers.filter(id => Number.isInteger(id) && id >= 0 && id < 8) : []
      };
    } catch { return { ...DEFAULT_STATE }; }
  }
  function saveState(surface, { sort, reverse, seed, favoritesOnly, grades, supers }) {
    try { localStorage.setItem('ububall.list.' + surface, JSON.stringify({ sort, reverse, seed, favoritesOnly, grades, supers })); } catch {}
  }

  const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
  const icon = name => gameUi.icon(name);
  const heartIcon = () => icon('heart');
  const SORT_CHOICES = ['recent', 'favorite', 'rarity', 'ubuquity', 'serial', 'name', 'random', 'all', 'movement', 'physical', 'engagement', 'super', ...STATS];
  const NO_CHIP = ['recent', 'favorite', 'serial', 'name', 'random', 'grade'];
  // The tile chip shows the first value a query sorts or compares by, else the chosen order's.
  function chipKey(state, query) {
    return [...query.sorts.map(sort => sort.key), ...query.compared, state.sort].find(key => !NO_CHIP.includes(key));
  }
  function chipValue(item, key) {
    const metric = METRICS[key];
    const text = metric.show ? metric.show(item) : String(metric.value(item));
    return [metric.label.replace('All stats (average)', 'All avg').replace(' (average)', ' avg') + ' ' + text, metric.color || ''];
  }
  const shuffling = (state, query) => state.sort === 'random' || query.sorts.some(sort => sort.key === 'random');

  function toolbar(state, onChange) {
    const search = el('input', { type: 'search', placeholder: 'Search, e.g. power>200 sort:size', className: 'ubu-search' });
    search.setAttribute('aria-label', 'Search ubus');
    const help = el('button', { type: 'button', className: 'ubu-help-toggle', title: 'Search help' }, icon('help'));
    help.setAttribute('aria-label', 'Search help');
    const select = el('select', { className: 'ubu-sort' });
    select.setAttribute('aria-label', 'Sort by');
    const options = keys => keys.map(key => new Option(METRICS[key].label, key));
    select.append(el('optgroup', { label: 'Collection' }, ...options(['recent', 'favorite', 'rarity', 'ubuquity', 'serial', 'name', 'random'])),
      el('optgroup', { label: 'Averages' }, ...options(['all', 'movement', 'physical', 'engagement', 'super'])));
    for (const [group, , statKeys] of STAT_GROUPS) select.append(el('optgroup', { label: group }, ...options(statKeys)));
    const direction = el('button', { type: 'button', className: 'ubu-direction' });
    const favorites = el('button', { type: 'button', className: 'card-heart ubu-favorites-only', title: 'Favorites only' }, heartIcon());
    favorites.setAttribute('aria-label', 'Favorites only');
    const filters = el('button', { type: 'button', className: 'ubu-filters-toggle' });
    const chip = (text, pressed, toggle, image) => {
      const button = el('button', { type: 'button', className: 'ubu-chip' }, ...(image ? [el('img', { src: image, alt: '' })] : []), text);
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
    clear.onclick = () => { state.grades = []; state.supers = []; state.favoritesOnly = false; state.query = ''; changed(true); };
    const gradeGroup = el('div', { className: 'ubu-chip-group' }, ...gradeChips), superGroup = el('div', { className: 'ubu-chip-group' }, ...superChips);
    gradeGroup.setAttribute('role', 'group'); gradeGroup.setAttribute('aria-label', 'Grade');
    superGroup.setAttribute('role', 'group'); superGroup.setAttribute('aria-label', 'Supers');
    const panel = el('div', { className: 'ubu-chips' }, gradeGroup, superGroup, clear);
    // Help examples add themselves to the search.
    const helpPanel = el('dl', { className: 'ubu-help' }, ...SEARCH_HELP.flatMap(([example, text]) => {
      const button = el('button', { type: 'button', className: 'ubu-help-example', textContent: example });
      button.onclick = () => { state.query = (state.query.trim() + ' ' + example.split('  ')[0]).trim(); changed(false); search.focus(); };
      return [el('dt', {}, button), el('dd', { textContent: text })];
    }));
    const note = el('p', { className: 'ubu-query-note', hidden: true });
    note.setAttribute('role', 'status');
    function update() {
      const query = parseQuery(state.query);
      select.value = state.sort; sortUi?.sync();
      if (search.value !== state.query) search.value = state.query;
      if (shuffling(state, query)) {
        direction.replaceChildren(icon('arrows-shuffle'), 'Shuffle');
        direction.setAttribute('aria-label', 'Shuffle again');
      } else {
        const words = METRICS[state.sort].words || ['High–low', 'Low–high'], word = words[state.reverse ? 1 : 0];
        direction.replaceChildren(icon('arrows-sort'), word);
        direction.setAttribute('aria-label', 'Order: ' + word + '. Reverse order');
      }
      favorites.setAttribute('aria-pressed', String(state.favoritesOnly));
      const count = state.grades.length + state.supers.length;
      filters.textContent = count ? `Filters (${count})` : 'Filters';
      for (const button of [...gradeChips, ...superChips]) button.update();
      note.hidden = !query.errors.length;
      note.textContent = query.errors.length ? 'Not understood: ' + query.errors.join(' ') + ' (see search help)' : '';
    }
    function changed(persist) { update(); onChange(persist); }
    let typing = 0;
    search.oninput = () => { clearTimeout(typing); typing = setTimeout(() => { state.query = search.value; changed(false); }, 150); };
    select.onchange = () => { state.sort = select.value; state.reverse = false; changed(true); };
    direction.onclick = () => {
      if (shuffling(state, parseQuery(state.query))) state.seed = Math.floor(Math.random() * 2 ** 31); else state.reverse = !state.reverse;
      changed(true);
    };
    favorites.onclick = () => { state.favoritesOnly = !state.favoritesOnly; changed(true); };
    // Filters and search help drop down over the list; the sort menu is a game dropdown too.
    const bar = el('div', { className: 'ubu-toolbar' }, el('div', { className: 'ubu-toolbar-row' }, el('span', { className: 'ubu-search-box' }, search, help),
      select, direction, favorites, filters), note, helpPanel, panel);
    let sortUi = null;
    sortUi = gameUi.select(select);
    gameUi.dropdown(filters, panel, { align: 'end' });
    gameUi.dropdown(help, helpPanel);
    update();
    return bar;
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
      const badge = el('span', {}, el('img', { src: info.icon, alt: mastery.displayName }));
      badge.dataset.tip = mastery.displayName;
      if (mastery.level > 1) badge.append(el('small', { textContent: mastery.level === 4 ? 'M' : 'I'.repeat(mastery.level) }));
      supers.append(badge);
    }
    const grade = el('span', { className: 'ubu-tile-grade', textContent: model.grade, title: 'Ubuquity ' + model.grade });
    grade.dataset.grade = model.grade;
    const value = el('span', { className: 'ubu-tile-value', hidden: true });
    const archLabel = archetypeApi?.format(model) || '';
    const main = el('button', { type: 'button', className: 'ubu-tile-main' }, artBox,
      el('span', { className: 'ubu-tile-name', textContent: model.parts.fullName }),
      archLabel ? el('span', { className: 'ubu-tile-archetype', textContent: archLabel }) : '',
      el('span', { className: 'ubu-tile-meta' }, grade, el('span', { textContent: caption })), supers, value);
    main.dataset.tileGrade = model.grade;
    return { main, artBox, value };
  }
  // A picker tile's role: a badge for an ubu already chosen (its position) or the action a
  // click takes, shown on hover and read out with the name.
  function describeTile(main, name, { badge = '', action = '' } = {}) {
    let mark = main.querySelector('.ubu-tile-badge');
    if (!mark) { mark = el('span', { className: 'ubu-tile-badge' }); main.append(mark); }
    mark.textContent = badge || action; mark.classList.toggle('is-action', !badge);
    main.setAttribute('aria-pressed', String(Boolean(badge)));
    main.setAttribute('aria-label', name + ', ' + (badge ? badge + ' on your team' : action));
  }
  // Desktop tiles drag onto team positions; the key is the ubu's serial.
  function draggable(main, key) {
    main.draggable = true;
    main.addEventListener('dragstart', event => { event.dataTransfer.setData('application/x-ubu-key', key); event.dataTransfer.effectAllowed = 'copyMove'; });
  }

  // Art is drawn cooperatively with a frame budget, cancelling tiles scrolled past
  // before draw and prioritizing the current viewport (newest intersections first).
  function lazyArt(scrollRoot) {
    if (!('IntersectionObserver' in root)) return { watch: (node, draw) => draw(), unwatch() {} };
    const draws = new Map(), queue = [], inView = new Set();
    let ticking = false;
    function drain() {
      ticking = false;
      const deadline = performance.now() + 5;
      let drew = false;
      while (queue.length && (!drew || performance.now() < deadline)) {
        const target = queue.pop();
        if (!inView.has(target) || !target.isConnected) continue;
        inView.delete(target);
        observer.unobserve(target);
        draws.get(target)?.();
        draws.delete(target);
        drew = true;
      }
      if (queue.length && inView.size) { ticking = true; requestAnimationFrame(drain); }
      else if (!inView.size) queue.length = 0;
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          if (draws.has(entry.target) && !inView.has(entry.target)) {
            inView.add(entry.target);
            queue.push(entry.target);
          }
        } else {
          inView.delete(entry.target);
        }
      }
      if (inView.size && !ticking) { ticking = true; requestAnimationFrame(drain); }
    }, { root: scrollRoot || null, rootMargin: '400px' });
    return {
      watch(node, draw) { draws.set(node, draw); observer.observe(node); },
      unwatch(node) { inView.delete(node); draws.delete(node); observer.unobserve(node); }
    };
  }

  const BATCH = 120;
  // One list surface: a toolbar over a grid of tiles. `pick` makes a click choose the ubu (the
  // team picker) and adds an inspect button; otherwise a click inspects it.
  function mount({ surface, toolbarHost, grid, scrollRoot, status, inspect, pick, describe, drag, hidden, paused, onEmpty }) {
    const state = savedState(surface);
    const tiles = new Map(), art = lazyArt(scrollRoot);
    const sentinel = el('div', { className: 'ubu-sentinel' });
    let visible = [], allView = [], limit = BATCH;
    const sentinelObserver = ('IntersectionObserver' in root) ? new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && limit < allView.length) appendBatch();
    }, { root: scrollRoot || null, rootMargin: '600px' }) : null;

    function tile(item) {
      const cached = tiles.get(item.serial);
      if (cached && Boolean(cached.item.pending) === Boolean(item.pending) && cached.item.certificate === item.certificate) {
        cached.item = item;
        return cached;
      }
      if (cached?.artBox) art.unwatch(cached.artBox);
      const wrap = el('div', { className: 'ubu-tile' });
      wrap.dataset.serial = item.serial;
      if (item.pending) {
        wrap.classList.add('is-pending');
        wrap.append(el('p', { textContent: `${serialLabel(item.serial)} · Certificate pending` }));
        const entry = { item, wrap };
        tiles.set(item.serial, entry);
        return entry;
      }
      const name = item.model.parts.fullName;
      const { main, artBox, value } = tileMain(item.model, serialLabel(item.serial));
      const entry = { item, wrap, main, artBox, heart: null, value };
      main.onclick = () => (pick || inspect)(entry.item);
      if (drag) draggable(main, item.serial);
      wrap.append(main);
      const heart = el('button', { type: 'button', className: 'card-heart ubu-tile-heart', title: 'Favorite' }, heartIcon());
      heart.setAttribute('aria-label', `Favorite ${name}`);
      heart.onclick = () => setFavorite(item.serial, !items.get(item.serial)?.favorite).catch(error => { if (status) status.textContent = 'Could not update favorite: ' + error.message; });
      entry.heart = heart;
      wrap.append(heart);
      if (pick && inspect) {
        const info = el('button', { type: 'button', className: 'ubu-tile-inspect', title: 'Stats and details' }, icon('info-circle'));
        info.setAttribute('aria-label', `Inspect ${name}`);
        info.onclick = () => inspect(entry.item);
        wrap.append(info);
      }
      art.watch(artBox, () => {
        if (artBox.querySelector('.ubu-tile-svg')) return;
        // Share one rasterized PNG Blob sprite per visual DNA across Collection,
        // the team picker and match views, releasing intermediate SVG filter trees.
        if (typeof ubuRender.spriteImg === 'function') {
          artBox.prepend(ubuRender.spriteImg(entry.item.model, 'ubu-tile-svg', 256));
          return;
        }
        const svg = ubuRender(entry.item.model, 'ubu-tile-svg');
        const image = el('img', { className: 'ubu-tile-svg',
          alt: svg.getAttribute('aria-label'), decoding: 'async', draggable: false });
        image.src = 'data:image/svg+xml;charset=utf-8,' +
          encodeURIComponent(new XMLSerializer().serializeToString(svg));
        artBox.prepend(image);
      });
      tiles.set(item.serial, entry);
      return entry;
    }

    function syncTile(entry, key) {
      const { item, main, heart, value } = entry;
      if (!main) return;
      const favorite = items.get(item.serial)?.favorite === true;
      heart.setAttribute('aria-pressed', String(favorite)); heart.classList.toggle('is-favorite', favorite);
      if (describe) describeTile(main, item.model.parts.fullName, describe(item));
      value.hidden = !key;
      if (key) [value.textContent, value.style.color] = chipValue(item, key);
    }

    function appendBatch() {
      const key = chipKey(state, parseQuery(state.query));
      const nextBatch = allView.slice(limit, limit + BATCH).map(tile);
      limit += BATCH;
      for (const entry of nextBatch) syncTile(entry, key);
      visible.push(...nextBatch);
      if (limit < allView.length) {
        sentinel.before(...nextBatch.map(entry => entry.wrap));
      } else {
        sentinelObserver?.unobserve(sentinel);
        sentinel.replaceWith(...nextBatch.map(entry => entry.wrap));
      }
    }

    function render() {
      if (paused?.()) return;
      const all = [...items.values()].filter(item => !hidden?.(item) && !(pick && item.pending));
      allView = view(all, state);
      limit = sentinelObserver ? BATCH : allView.length;
      const key = chipKey(state, parseQuery(state.query));
      visible = allView.slice(0, limit).map(tile);
      for (const entry of visible) syncTile(entry, key);
      sentinelObserver?.disconnect();
      if (allView.length > limit) {
        grid.replaceChildren(...visible.map(entry => entry.wrap), sentinel);
        sentinelObserver?.observe(sentinel);
      } else {
        grid.replaceChildren(...visible.map(entry => entry.wrap));
      }
      if (!allView.length) onEmpty?.(all.length ? 'filtered' : loading ? 'loading' : 'empty');
      else onEmpty?.(null);
    }
    toolbarHost.append(toolbar(state, persist => { if (persist) saveState(surface, state); render(); }));
    root.addEventListener('ubu-list:change', render);
    return { render, clearFilters: () => toolbarHost.querySelector('.ubu-clear').click() };
  }

  root.ubuList = Object.assign(api, {
    config, trustedKey, load, add, setFavorite, teams, saveTeams, heartIcon, tileMain, describeTile, draggable, mount,
    get: serial => items.get(serial), items: () => [...items.values()], loading: () => Boolean(loading)
  });
})(globalThis);
