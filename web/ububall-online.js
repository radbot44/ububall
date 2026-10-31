'use strict';
function ububallOnline(hooks) {
  const $ = id => document.getElementById(id);
  const invite = new URL(location.href).searchParams.get('match');
  let id = null, socket = null, session = null, state = null, retry = null, heartbeat = null;
  let stopped = false, lastPong = 0, offset = 0, choices = [], collection = [], cursor = '', lastDraft = '', sentAt = 0;
  const status = text => { $('online-status').textContent = text; };
  const playable = () => Boolean(session?.owner || session?.guest);
  function account() {
    $('online-login').hidden = Boolean(session?.owner);
    $('online-guest').hidden = playable();
    $('online-account-status').textContent = session?.owner ? 'Signed in with Discord' :
      session?.guest ? 'Playing as a guest. Sign in with Discord to use your ubus; you keep your seat.' : 'Sign in with Discord or play as a guest.';
    $('online-create').disabled = !playable();
  }
  async function joinInvite() {
    if (!invite || id || !playable()) return;
    try { const result = await api('/api/ububall/' + encodeURIComponent(invite) + '/join', {}); await enter(invite, result); }
    catch (error) { status(error.message); }
  }
  async function refreshSession() {
    const response = await fetch('/api/session');
    if (!response.ok) throw new Error('Could not check your session. Reopen online settings to retry.');
    session = await response.json();
    account();
    const returnDest = invite ? '/?match=' + encodeURIComponent(invite) : (id ? '/?match=' + encodeURIComponent(id) : ((location.pathname === '/index.html' ? '/' : location.pathname) + location.search));
    $('online-login').href = '/auth/discord?return=' + encodeURIComponent(returnDest);
  }
  window.addEventListener('ubu:session', event => {
    if (!event.detail?.owner || session?.owner === event.detail.owner) return;
    const wasGuest = Boolean(session?.guest);
    session = event.detail; account();
    // Reconnecting under the Discord session moves a former guest's seat to their Discord account.
    if (id && wasGuest) { clearTimeout(retry); connect(); }
    else joinInvite();
  });
  async function api(path, data) {
    if (!playable()) await refreshSession();
    if (!playable()) throw new Error('Sign in with Discord or play as a guest below.');
    const response = await fetch(path, data === undefined ? {} : { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': session.csrf }, body: JSON.stringify(data) });
    const result = await response.json();
    if (response.status === 401) await refreshSession();
    if (!response.ok) throw new Error(result.error || 'Could not reach the match.');
    return result;
  }
  function teamPicker() {
    const container = $('online-team'); container.replaceChildren();
    if (!state || state.phase !== 'lobby') return;
    const practice = Boolean(state.practice), entries = practice ? state.practice : collection;
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div'); row.className = 'online-team-slot';
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Team character');
      const available = practice ? [entries[i]] : entries;
      if (!available.length) select.add(new Option('Load your collection', ''));
      available.forEach((entry, index) => {
        const model = ubu.decode(ubu.fromCode(entry.dna));
        select.add(new Option(model.parts.fullName, String(index)));
      });
      if (choices[i] && !practice) select.value = String(Math.max(0, entries.findIndex(e => e.serial === choices[i].serial)));
      else if (!practice && entries[i]) select.value = String(i);
      const portrait = document.createElement('div'), supers = document.createElement('select');
      supers.setAttribute('aria-label', 'Equipped super');
      function selected() {
        const entry = available[Number(select.value)];
        portrait.replaceChildren(); supers.replaceChildren();
        if (!entry) return;
        const model = ubu.decode(ubu.fromCode(entry.dna)), previous = choices[i];
        choices[i] = { ...entry, superId: previous?.dna === entry.dna ? previous.superId : model.supers[0] % 8 };
        portrait.append(ubuRender(model, 'ball-thumb'));
        for (const superId of new Set(model.supers.map(n => n % 8))) supers.add(new Option(ububallPhysics.SUPERS[superId].name, String(superId)));
        supers.value = choices[i].superId;
      }
      select.onchange = selected; selected();
      supers.onchange = () => { choices[i].superId = Number(supers.value); };
      supers.hidden = state.mode.includes('classic');
      select.disabled = practice;
      row.append(portrait, select, supers); container.append(row);
    }
  }
  function receive(next) {
    if (state && next.revision < state.revision) return;
    const before = state; state = next; offset = next.now - Date.now();
    $('online-create-controls').hidden = true;
    $('online-lobby').hidden = false;
    $('online-invite').value = location.origin + '/?match=' + id;
    $('online-ready').hidden = next.phase !== 'lobby';
    $('online-load').hidden = next.phase !== 'lobby' || Boolean(next.practice);
    $('online-ready').disabled = next.ready[next.seat];
    $('online-ready').textContent = next.ready[next.seat] ? 'Team ready' : 'Ready to play';
    if (before && Boolean(before.practice) !== Boolean(next.practice)) choices = [];
    if (!before || before.phase !== next.phase || (!choices.length && next.phase === 'lobby')) teamPicker();
    if (next.phase === 'lobby' && !next.practice && !collection.length && !loadingCollection) loadCollection();
    if (next.phase === 'lobby') status(!next.occupied[1] ? 'Share the invite link with your opponent.' : next.ready[next.seat] ? 'Waiting for your opponent to choose a team.' : 'Choose your team, then ready up.');
    else {
      $('online-dialog').close();
      $('online-status').textContent = '';
    }
    hooks.onState(next);
  }
  function connect() {
    if (stopped || !id) return;
    const current = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ububall/' + id + '/socket');
    socket = current;
    current.onopen = () => { lastPong = Date.now(); };
    current.onmessage = event => {
      if (socket !== current) return;
      const data = JSON.parse(event.data); lastPong = Date.now();
      if (data.type === 'state') receive(data);
      if (data.type === 'error') { lastDraft = ''; status(data.error); hooks.onError(data.error); }
    };
    current.onclose = event => {
      if (socket !== current || stopped) return;
      hooks.onDisconnect();
      if (event.code === 4001 || event.code === 4002) { stopped = true; status(event.code === 4001 ? 'Match opened in another tab.' : 'Match expired.'); return; }
      status('Reconnecting…'); retry = setTimeout(connect, 1500);
    };
  }
  async function enter(matchId, initial) {
    id = matchId; state = null; choices = []; stopped = false; lastDraft = '';
    const url = new URL(location.href); url.pathname = '/'; url.searchParams.set('match', id); history.replaceState(null, '', url);
    receive(initial); connect();
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        if (Date.now() - lastPong > 30000) socket.close();
        else socket.send('{"type":"ping"}'); // must match the server's auto-response request exactly
      }
    }, 10000);
  }
  function leave() {
    stopped = true; clearTimeout(retry); clearInterval(heartbeat); socket?.close(); socket = null; id = null; state = null;
    const url = new URL(location.href); url.pathname = '/'; url.searchParams.delete('match'); history.replaceState(null, '', url);
    $('online-create-controls').hidden = false; $('online-lobby').hidden = true; $('online-dialog').close();
    hooks.onLeave();
  }
  const settings = { policy: 'practice' };
  $('online-policy').onclick = event => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    settings.policy = button.dataset.value;
    for (const option of $('online-policy').children) option.setAttribute('aria-pressed', String(option === button));
  };
  // The rules come from the mode screen; this dialog then sets up the invite.
  let createMode = 'standard';
  function showDialog() {
    $('online-dialog').showModal();
    refreshSession().catch(error => status(error.message));
  }
  $('online-open').onclick = () => { if (id) showDialog(); else hooks.chooseMode(createMode); };
  $('online-mode-change').onclick = () => { $('online-dialog').close(); hooks.chooseMode(createMode); };
  $('online-close').onclick = () => $('online-dialog').close();
  $('online-leave').onclick = leave;
  $('online-create').onclick = async () => {
    $('online-create').disabled = true;
    try {
      const result = await api('/api/ububall', { mode: createMode, teams: settings.policy });
      await enter(result.id, result);
    } catch (error) { status(error.message); }
    finally { $('online-create').disabled = !playable(); }
  };
  $('online-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('online-invite').value); status('Invite copied.'); }
    catch { $('online-invite').select(); status('Copy the selected invite link.'); }
  };
  $('online-ready').onclick = async () => {
    $('online-ready').disabled = true;
    try {
      if (choices.length !== 3 || choices.some(c => !c)) throw new Error('Choose three ubus first.');
      receive(await api('/api/ububall/' + id + '/team', {
        ...(!state.practice ? { serials: choices.map(c => c.serial) } : {}), supers: choices.map(c => c.superId)
      }));
    } catch (error) { status(error.message); $('online-ready').disabled = false; }
  };
  let loadingCollection = false;
  async function loadCollection() {
    if (loadingCollection) return;
    loadingCollection = true;
    $('online-load').disabled = true;
    try {
      const data = await api('/api/ubus?sort=recent' + (cursor ? '&after=' + cursor : ''));
      for (const entry of data.ubus) if (entry.certificate && !collection.some(c => c.serial === entry.serial)) {
        collection.push({ serial: entry.serial, dna: JSON.parse(entry.certificate).dna });
      }
      cursor = data.next || ''; teamPicker();
      $('online-load').textContent = cursor ? 'Load more ubus' : 'Refresh collection';
    } catch (error) { status(error.message); }
    finally { loadingCollection = false; $('online-load').disabled = false; }
  }
  $('online-load').onclick = loadCollection;
  $('online-forfeit').onclick = async () => {
    try { receive(await api('/api/ububall/' + id + '/forfeit', {})); }
    catch (error) { hooks.onError(error.message); }
  };
  $('online-guest').onclick = async () => {
    $('online-guest').disabled = true;
    try {
      const response = await fetch('/api/guest', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not start a guest session.');
      session = result; account(); await joinInvite();
    } catch (error) { status(error.message); }
    finally { $('online-guest').disabled = false; }
  };
  if (invite) {
    $('online-dialog').showModal();
    refreshSession().then(() => playable() ? joinInvite() : status('Sign in with Discord or play as a guest to join this match.'))
      .catch(error => status(error.message));
  }
  return {
    get active() { return Boolean(id); }, get state() { return state; },
    create(mode) { createMode = mode; $('online-mode-name').textContent = ububallMatch.modeName(mode); showDialog(); },
    now: () => Date.now() + offset,
    rematch() {
      if (!state || state.phase !== 'over') return;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'rematch' }));
      } else {
        api('/api/ububall/' + id + '/rematch', {}).then(receive).catch(error => hooks.onError(error.message));
      }
    },
    send(moves, lock = false) {
      if (!state || state.phase !== 'plan' || state.locked[state.seat] || !state.connected.every(Boolean) || socket?.readyState !== WebSocket.OPEN) return false;
      const text = JSON.stringify({ type: 'moves', turn: state.turn, moves, lock });
      if (!lock && (text === lastDraft || Date.now() - sentAt < 120)) return false;
      socket.send(text); lastDraft = text; sentAt = Date.now(); return true;
    }
  };
}
