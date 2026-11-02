'use strict';
function ububallOnline(hooks) {
  const $ = id => document.getElementById(id);
  const invite = new URL(location.href).searchParams.get('match');
  let id = null, socket = null, session = null, state = null, retry = null, heartbeat = null;
  let stopped = false, lastPong = 0, offset = 0, lastDraft = '', sentAt = 0;
  // The lobby shows on the team screen; the dialog only creates, joins and ends matches.
  const status = text => { $('online-status').textContent = text; $('lobby-status').textContent = text; };
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
    $('online-login').href = $('lobby-login').href = '/auth/discord?return=' + encodeURIComponent(returnDest);
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
  function receive(next, reopen = false) {
    if (state && next.revision < state.revision) return;
    const before = state; state = next; offset = next.now - Date.now();
    $('online-create-controls').hidden = true;
    $('online-ended').hidden = true;
    $('online-invite').value = location.origin + '/?match=' + id;
    const other = 1 - next.seat, them = next.names[other] || (next.occupied[other] ? 'Your opponent' : 'Opponent'), ready = next.ready[next.seat];
    if (before && !before.occupied[other] && next.occupied[other]) nudge(`${them} joined`);
    if (before && !before.rematch[other] && next.rematch[other]) nudge(`${them} wants a rematch`);
    if (before?.phase === 'lobby' && next.phase === 'plan') nudge('Kickoff');
    if (next.phase === 'lobby') {
      // Entering the lobby (a new match or a rematch) brings up the team screen.
      const note = next.teams === 'practice' ? 'This match uses random practice teams.' :
        next.practice ? 'Guests play with a random practice team. Sign in with Discord to use your own ubus; you keep your seat.' : '';
      hooks.lobby({ state: next, ready, practice: next.practice, guest: Boolean(session?.guest),
        note: note + (note ? ' ' : '') + 'Disconnects pause planning; after 60 seconds your opponent can claim a forfeit.' }, reopen || !before || before.phase !== 'lobby');
      status(!next.occupied[other] ? 'Share the invite link with your opponent.' : ready ? `Team ready. Waiting for ${them}${next.ready[other] ? ' to connect' : ' to choose a team'}.` :
        next.ready[other] ? `${them} is ready. Choose your team, then ready up.` : `${them} joined. Choose your team, then ready up.`);
    } else if (!next.game) {
      // The host left before kickoff: nothing to play, so the dialog explains and offers Leave.
      hooks.closeLobby();
      $('online-ended').hidden = false;
      if (!$('online-dialog').open) $('online-dialog').showModal();
      status(`${them} closed this match.`);
      return;
    } else {
      hooks.closeLobby();
      $('online-dialog').close();
      status('');
    }
    hooks.onState(next);
  }
  // A player waiting in another tab sees what changed in this tab's title.
  const title = document.title;
  function nudge(text) { if (document.hidden) document.title = '● ' + text + ' · ' + title; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = title; });
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
      if (event.code === 4001 || event.code === 4002 || event.code === 4003) {
        stopped = true; status(event.code === 4001 ? 'Match opened in another tab.' : event.code === 4002 ? 'Match expired.' : 'You left this match.'); return;
      }
      status('Reconnecting…'); retry = setTimeout(connect, 1500);
    };
  }
  async function enter(matchId, initial) {
    id = matchId; state = null; stopped = false; lastDraft = '';
    $('online-dialog').close();
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
  // Leaving tells the server, so the opponent isn't left waiting to claim a forfeit.
  async function leave() {
    const live = state && ['plan', 'resolving'].includes(state.phase);
    if (live && !await gameUi.confirm({ title: 'Leave match?', message: `Leaving ends the match and gives ${state.names[1 - state.seat] || 'your opponent'} the win.`,
      confirmLabel: 'Leave', cancelLabel: 'Keep playing', danger: true })) return;
    stopped = true;
    if (id) await api('/api/ububall/' + id + '/leave', {}).catch(() => {});
    clearTimeout(retry); clearInterval(heartbeat); socket?.close(); socket = null; id = null; state = null;
    hooks.closeLobby();
    const url = new URL(location.href); url.pathname = '/'; url.searchParams.delete('match'); history.replaceState(null, '', url);
    $('online-create-controls').hidden = false; $('online-ended').hidden = true; $('online-dialog').close();
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
  $('online-open').onclick = () => { if (!id) hooks.chooseMode(createMode); else if (state?.phase === 'lobby') receive(state, true); else showDialog(); };
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
  // Phones get their share sheet, so the invite goes straight to a chat app.
  $('online-share').hidden = !navigator.share || !matchMedia('(pointer: coarse)').matches;
  $('online-share').onclick = () => navigator.share({ title: 'Ububall', text: 'Play me at Ububall', url: $('online-invite').value }).catch(() => {});
  $('online-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('online-invite').value); status('Invite copied.'); }
    catch { $('online-invite').select(); status('Copy the selected invite link.'); }
  };
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
    leave,
    // Locks in a team: owned seats send serials in Back, Top, Bottom order; every seat sends supers.
    async ready(team) { receive(await api('/api/ububall/' + id + '/team', team)); },
    async unready() { receive(await api('/api/ububall/' + id + '/unready', {})); },
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
