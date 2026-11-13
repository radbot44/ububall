'use strict';
function ububallOnline(hooks) {
  const $ = id => document.getElementById(id);
  const params = new URL(location.href).searchParams;
  const watchInvite = params.get('watch'), invite = watchInvite ? null : params.get('match');
  const activity = window.ubuActivity;
  const queueStorageKey = activity ? 'ububall-queue:' + activity.instance : 'ububall-queue';
  let id = null, socket = null, session = null, state = null, retry = null, heartbeat = null;
  let stopped = false, outdated = false, lastPong = 0, offset = 0, lastDraft = '', sentAt = 0;
  let watchKey = null, queue = null, queueTimer, queueTask, leaveTask, switching = false;
  let lobby = null, lobbyTimer, lobbyTask, lobbyStarting = false, lobbyBusy = false;
  let disposed = false, connecting = false, lobbyReady, reconcileTimer;
  let pendingMatch = null, offerBusy = false;
  const connection = (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : (() => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  })()), requests = new AbortController();
  const userCards = new Map(), matchCards = new Map();
  const readJson = response => response.json().catch(() => null);
  const showLoading = () => {
    for (const name of ['activity-loading', 'online-loading']) $(name).hidden = disposed || !(lobbyStarting || lobbyBusy || connecting);
  };
  // The lobby shows on the team screen; the dialog only creates, joins and ends matches.
  const status = (text, error = false) => {
    if (disposed) return;
    for (const name of ['online-status', 'lobby-status', 'activity-status']) {
      $(name).textContent = error ? text : ''; $(name).hidden = !error || !text;
    }
  };
  const playable = () => Boolean(session?.owner || session?.guest);
  function account() {
    $('online-login').hidden = Boolean(session?.owner || queue);
    $('online-guest').hidden = playable() || Boolean(activity || queue);
    $('online-account-status').textContent = session?.owner ? 'Signed in with Discord' :
      session?.guest ? 'Playing as a guest. Sign in with Discord to use your ubus; you keep your seat.' :
        activity ? 'Connect your Discord account to play online.' : 'Sign in with Discord or play as a guest.';
    $('online-create').disabled = !playable();
  }
  async function joinInvite() {
    if (!invite || id || !playable()) return;
    try {
      const result = await api('/api/ububall/' + encodeURIComponent(invite) + '/join', {});
      $('online-dialog').close();
      await enter(invite, result);
    }
    catch (error) { status(error.message, true); }
  }
  async function refreshSession() {
    const response = await fetch('/api/session', { signal: requests.signal });
    const nextSession = response.ok ? await readJson(response) : null;
    if (!response.ok || !nextSession) throw new Error('Could not check your session. Reopen online settings to retry.');
    session = nextSession;
    account();
    const returnDest = invite ? '/?match=' + encodeURIComponent(invite) : (id ? '/?match=' + encodeURIComponent(id) : ((location.pathname === '/index.html' ? '/' : location.pathname) + location.search));
    $('online-login').href = $('lobby-login').href = '/auth/discord?return=' + encodeURIComponent(returnDest);
  }
  window.addEventListener('ubu:session', event => {
    if (!event.detail?.owner) {
      if (session?.owner) { session = null; account(); if (lobby) renderLobby(lobby); }
      return;
    }
    if (session?.owner === event.detail.owner) return;
    const wasGuest = Boolean(session?.guest);
    session = event.detail; account();
    // Reconnecting under the Discord session moves a former guest's seat to their Discord account.
    if (id && wasGuest && !watchKey) { clearTimeout(retry); connect(); }
    else joinInvite();
  }, { signal: requests.signal });
  async function api(path, data) {
    if (disposed) throw new DOMException('Activity closed.', 'AbortError');
    if (activity && path.startsWith('/api/ububall') && path !== '/api/ububall/lobby') await lobbyReady;
    if (!playable()) await refreshSession();
    if (!playable()) throw new Error('Sign in with Discord or play as a guest below.');
    const response = await fetch(path, { signal: requests.signal, headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': session.csrf,
      ...(activity ? { 'X-Ubu-Connection': connection } : {}) }, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) });
    const result = await readJson(response);
    if (disposed) throw new DOMException('Activity closed.', 'AbortError');
    if (activity && (response.status === 401 || response.status === 403 && result?.error === 'Invalid request origin or token.' ||
        response.status === 409 && result?.error === 'This Activity connection has ended.')) {
      dispose(); activity.dispose();
    }
    if (response.status === 401 && !activity) await refreshSession();
    if (!response.ok || !result) throw new Error(result?.error || (response.status >= 500 ? 'Server unavailable. Try again shortly.' : 'Could not reach the match.'));
    return result;
  }
  async function watchState(match, key) {
    const encodedMatch = encodeURIComponent(match);
    if (key === 'activity') return api('/api/ububall/' + encodedMatch + '/activity-watch-state');
    if (activity) await lobbyReady;
    const response = await fetch('/api/ububall/' + encodedMatch + '/watch-state?key=' + encodeURIComponent(key), {
      signal: requests.signal, headers: activity ? { 'X-Ubu-Connection': connection } : {} });
    const result = await readJson(response);
    if (!response.ok || !result) throw new Error(result?.error || (response.status >= 500 ? 'Server unavailable. Try again shortly.' : 'Could not reach the match.'));
    return result;
  }
  function updateWatchControls(next) {
    $('pause-watch-controls').hidden = !next || Boolean(next.spectator);
    for (const location of ['pause']) {
      const toggle = $(location + '-allow-watch');
      toggle.setAttribute('aria-pressed', String(Boolean(next?.watchAllowed)));
      toggle.querySelector('.setting-value').textContent = next?.watchAllowed ? 'On' : 'Off';
      const copy = $(location + '-copy-watch');
      copy.hidden = !next?.watchAllowed;
    }
  }
  function isOutdatedState(next) {
    if (!next || typeof next !== 'object') return false;
    const matchVer = typeof ububallMatch !== 'undefined' ? ububallMatch.VERSION : null;
    const physVer = typeof ububallPhysics !== 'undefined' ? ububallPhysics.VERSION : null;
    if (next.version != null && matchVer != null && next.version !== matchVer) return true;
    if (next.physicsVersion != null && physVer != null && next.physicsVersion !== physVer) return true;
    return false;
  }
  function flagOutdated(next) {
    if (outdated) return;
    outdated = true; stopped = true; connecting = false; showLoading();
    pendingMatch = null;
    clearTimeout(lobbyTimer); clearTimeout(queueTimer); clearTimeout(retry); clearTimeout(reconcileTimer); clearInterval(heartbeat);
    try { socket?.close(); } catch { /* socket may already be closing */ }
    socket = null;
    $('activity-match-offer')?.close?.();
    $('online-dialog')?.close?.();
    if (hooks.onOutdated) hooks.onOutdated(next);
    else if (typeof gameUi !== 'undefined' && gameUi.blocking) {
      gameUi.blocking({ title: 'Game updated', message: 'Ububall has updated. Refresh the page to continue playing.', confirmLabel: 'Refresh' });
    }
  }
  function receive(next, reopen = false) {
    if (disposed || outdated) return;
    if (isOutdatedState(next)) { flagOutdated(next); return; }
    if (state && next.revision < state.revision) return;
    if (next.spectator) next.seat = 0; // Fixed rink orientation for viewers.
    const before = state; state = next; offset = next.now - Date.now();
    $('online-change-rules').hidden = !next.quickStart || !next.canChangeRules || next.spectator;
    if (before && before.gameNumber !== next.gameNumber) { lastDraft = ''; hooks.onNewGame(); }
    $('online-create-controls').hidden = true;
    $('online-ended').hidden = true;
    updateWatchControls(next);
    if (next.spectator) {
      if (next.game) { $('online-dialog').close(); hooks.onState(next); }
      else if (!before) { showDialog(); status(''); }
      else hooks.onState(next);
      return;
    }
    $('lobby-invite').hidden = next.paired;
    $('online-invite').value = location.origin + '/?match=' + id;
    const other = 1 - next.seat, them = next.names[other] || (next.occupied[other] ? 'Your opponent' : 'Opponent'), ready = next.ready[next.seat];
    if (before && !before.occupied[other] && next.occupied[other]) nudge(`${them} joined`);
    if (before && !before.rematch[other] && next.rematch[other]) nudge(`${them} wants a rematch`);
    if (before?.phase === 'lobby' && next.phase === 'plan') nudge('Kickoff');
    if (next.quickStart && next.phase === 'lobby') {
      if (activity) {
        $('online-friends').disabled = true;
        $('activity-cancel').hidden = false;
      }
      status('');
      return;
    }
    if (next.phase === 'lobby') {
      // Entering the lobby (a new match or a rematch) brings up the team screen.
      const note = next.guestTeam ? 'Guests play with three given ubus. Sign in with Discord to use your own ubus; you keep your seat.' : '';
      hooks.lobby({ state: next, ready, guestTeam: next.guestTeam, guest: Boolean(session?.guest),
        note: note + (note ? ' ' : '') + 'Disconnects pause planning; after 60 seconds your opponent can claim a forfeit.' }, reopen || !before || before.phase !== 'lobby');
      status('');
    } else if (!next.game) {
      if (activity && next.quickStart) {
        if (!stopped) void leave().then(() => status(''));
        return;
      }
      // The host left before kickoff: nothing to play, so the dialog explains and offers Leave.
      hooks.closeLobby();
      $('online-ended').hidden = false;
      if (!$('online-dialog').open) $('online-dialog').showModal();
      status('');
      return;
    } else {
      hooks.closeLobby();
      $('online-dialog').close();
      if (activity) $('activity-cancel').hidden = true;
      status('');
    }
    hooks.onState(next);
  }
  // A player waiting in another tab sees what changed in this tab's title.
  const title = document.title;
  function nudge(text) { if (document.hidden) document.title = '● ' + text + ' · ' + title; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = title; }, { signal: requests.signal });
  function connect() {
    if (disposed || stopped || outdated || !id) return;
    connecting = true; showLoading();
    const path = watchKey === 'activity' ? '/activity-watch-socket?connection=' + connection :
      watchKey ? '/watch-socket?key=' + encodeURIComponent(watchKey) + (activity ? '&connection=' + connection : '') : '/socket' + (activity ? '?connection=' + connection : '');
    const current = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ububall/' + encodeURIComponent(id) + path);
    socket = current;
    function ended(code) {
      if (![4001, 4002, 4003].includes(code)) return false;
      connecting = false; stopped = true; showLoading(); hooks.onDisconnect(false);
      const message = code === 4001 ? 'Match opened in another tab.' : code === 4002 ? 'Match expired.' :
        watchKey ? 'Spectating has ended.' : 'You left this match.';
      if (watchKey) void leave().then(() => status(message, true));
      else if (activity && code === 4003) { dispose(); activity.dispose(); }
      else { status(message, true); hooks.onError(message); }
      return true;
    }
    current.onopen = () => { lastPong = Date.now(); connecting = false; showLoading(); };
    current.onmessage = event => {
      if (socket !== current) return;
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      lastPong = Date.now();
      if (data.type === 'ended') { if (!stopped && !ended(data.code)) current.close(); return; }
      if (data.type === 'state') receive(data);
      if (data.type === 'error') { lastDraft = ''; status(data.error, true); hooks.onError(data.error); }
    };
    current.onclose = event => {
      if (disposed || socket !== current || stopped) return;
      if (ended(event.code)) return;
      hooks.onDisconnect(true);
      connecting = true; showLoading();
      retry = setTimeout(async () => {
        try { if (watchKey) await watchState(id, watchKey); }
        catch (error) {
          stopped = true; connecting = false; showLoading();
          if (watchKey) void leave().then(() => status(error.message, true));
          else { status(error.message, true); hooks.onError(error.message); }
          return;
        }
        connect();
      }, 1500);
    };
  }
  async function enter(matchId, initial, key = null) {
    if (disposed || outdated) return;
    if (isOutdatedState(initial)) { flagOutdated(initial); return; }
    hooks.prepareOnline();
    id = matchId; watchKey = key; state = null; stopped = false; lastDraft = '';
    $('online-dialog').close();
    const url = new URL(location.href); url.pathname = '/';
    url.searchParams.delete(key ? 'match' : 'watch');
    if (activity || key === 'activity') { url.searchParams.delete('match'); url.searchParams.delete('watch'); }
    else url.searchParams.set(key ? 'watch' : 'match', key ? id + '.' + key : id);
    history.replaceState(null, '', url);
    window.showUbuScreen?.(); // A match can start while the Activity shows Ubu Mint or Collection.
    receive(initial); connect();
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        if (Date.now() - lastPong > 30000) socket.close();
        else socket.send('{"type":"ping"}'); // must match the server's auto-response request exactly
      }
    }, 10000);
  }
  async function takeMatch(match, initial, ack) {
    if (disposed || outdated || pendingMatch?.id === match) return;
    if (isOutdatedState(initial)) { flagOutdated(initial); return; }
    if (initial.phase === 'over') { await ack(); status('Your opponent left before the match started.', true); return; }
    if (hooks.cpuActive()) {
      pendingMatch = { id: match, ack };
      $('activity-match-offer-error').hidden = true;
      $('activity-match-offer').showModal();
      if (lobby) renderLobby(lobby);
      return;
    }
    await enter(match, initial);
    await ack();
  }
  async function checkOffer() {
    const offer = pendingMatch;
    if (!offer || offerBusy) return;
    try {
      const fresh = await api('/api/ububall/' + encodeURIComponent(offer.id) + '/state');
      if (isOutdatedState(fresh)) { flagOutdated(fresh); return; }
      if (offer !== pendingMatch || offerBusy || fresh.phase !== 'over') return;
      pendingMatch = null; $('activity-match-offer').close();
      await offer.ack();
      status('Your opponent left before the match started.', true);
    } catch (error) {
      if (offer !== pendingMatch || offerBusy) return;
      pendingMatch = null; $('activity-match-offer').close();
      status(error.message, true);
    }
  }
  async function decideOffer(join) {
    const offer = pendingMatch;
    if (!offer || offerBusy) return;
    offerBusy = true;
    $('activity-match-join').disabled = $('activity-match-keep-cpu').disabled = true;
    try {
      const encodedOfferId = encodeURIComponent(offer.id);
      if (join) {
        const fresh = await api('/api/ububall/' + encodedOfferId + '/state');
        if (fresh.phase === 'over') throw new Error('Your opponent left before the match started.');
        pendingMatch = null; $('activity-match-offer').close();
        await enter(offer.id, fresh);
      } else {
        await api('/api/ububall/' + encodedOfferId + '/leave', {});
        pendingMatch = null; $('activity-match-offer').close();
        hooks.resumeCpu();
      }
      await offer.ack();
    } catch (error) {
      if (pendingMatch === offer) {
        $('activity-match-offer-error').textContent = error.message;
        $('activity-match-offer-error').hidden = false;
      } else status(error.message, true);
    } finally {
      offerBusy = false;
      $('activity-match-join').disabled = $('activity-match-keep-cpu').disabled = false;
      if (lobby) renderLobby(lobby);
      void lobbyRequest();
    }
  }
  $('activity-match-join').onclick = () => decideOffer(true);
  $('activity-match-keep-cpu').onclick = () => decideOffer(false);
  $('activity-match-offer').addEventListener('cancel', event => { event.preventDefault(); void decideOffer(false); });
  // Leaving tells the server, so the opponent isn't left waiting to claim a forfeit.
  function leave() {
    leaveTask ||= finishLeave().finally(() => { leaveTask = null; });
    return leaveTask;
  }
  async function finishLeave() {
    if (!id || outdated) return !outdated;
    const historyState = watchKey ? history.state : null;
    const live = !watchKey && state && ['plan', 'resolving'].includes(state.phase);
    if (live && !await gameUi.confirm({ title: 'Forfeit match?', message: `Leaving will forfeit this match and give ${state.names[1 - state.seat] || 'your opponent'} the win.`,
      confirmLabel: 'Forfeit match', cancelLabel: 'Keep playing', danger: true })) return false;
    const wasStopped = stopped;
    stopped = true;
    if (!watchKey) {
      try { await api('/api/ububall/' + encodeURIComponent(id) + '/leave', {}); }
      catch (error) { stopped = wasStopped; hooks.onError(error.message); return false; }
    }
    stopped = true; connecting = false; showLoading();
    clearTimeout(retry); clearInterval(heartbeat); socket?.close(); socket = null; id = null; state = null; watchKey = null;
    hooks.closeLobby();
    const url = new URL(location.href); url.pathname = '/';
    url.searchParams.delete('match'); url.searchParams.delete('watch'); history.replaceState(historyState, '', url);
    updateWatchControls(null);
    if (activity) {
      $('online-friends').disabled = false;
      $('activity-cancel').hidden = true;
    }
    $('online-create-controls').hidden = true; $('online-ended').hidden = true; $('online-dialog').close();
    hooks.onLeave();
    status('');
    if (activity) void lobbyRequest('poll');
    return true;
  }
  // The rules come from the mode screen; this dialog then sets up the invite.
  let createMode = 'standard';
  function showDialog(create = false) {
    $('online-entry').hidden = Boolean(id || create || queue);
    $('online-create-controls').hidden = !create;
    $('online-ended').hidden = !id;
    $('online-leave').textContent = watchKey ? 'Stop watching' : 'Leave online match';
    if (!$('online-dialog').open) $('online-dialog').showModal();
    refreshSession().catch(error => status(error.message, true));
  }
  $('online-open').onclick = () => { if (id && !watchKey && state?.phase === 'lobby') receive(state, true); else showDialog(); };
  $('online-private').onclick = () => { $('online-dialog').close(); hooks.chooseMode(createMode); };
  $('online-mode-change').onclick = () => { $('online-dialog').close(); hooks.chooseMode(createMode); };
  $('online-close').onclick = () => $('online-dialog').close();
  $('online-leave').onclick = leave;
  $('online-create').onclick = async () => {
    $('online-create').disabled = true;
    try {
      const result = await api('/api/ububall', { mode: createMode });
      await enter(result.id, result);
    } catch (error) { status(error.message, true); }
    finally { $('online-create').disabled = !playable(); }
  };
  async function guestSession() {
    const response = await fetch('/api/guest', { method: 'POST', signal: requests.signal });
    const result = await readJson(response);
    if (!response.ok || !result) throw new Error(result?.error || 'Could not start a guest session.');
    session = result; account();
  }
  async function ensureSession() {
    await refreshSession();
    if (activity && (!session?.owner || session.instance !== activity.instance || !Object.hasOwn(session, 'avatar'))) session = await activity.signIn();
    else if (!playable()) await guestSession();
  }
  function setQueue(value) {
    queue = value;
    try {
      if (value) sessionStorage.setItem(queueStorageKey, value);
      else sessionStorage.removeItem(queueStorageKey);
    } catch { /* queue can still run */ }
    $('online-entry').hidden = Boolean(value || id);
    $('online-cancel-queue').hidden = !value;
    $('online-close').disabled = Boolean(value);
    $('online-friends').disabled = value === 'friends';
    $('activity-cancel').hidden = !value;
    account();
  }
  function queueRequest(action) {
    if (disposed) return;
    if (queueTask || !queue) return queueTask;
    clearTimeout(queueTimer);
    queueTask = runQueue(action).finally(() => { queueTask = null; });
    return queueTask;
  }
  async function runQueue(action) {
    $('online-cancel-queue').disabled = true;
    const scope = queue;
    const destination = { queue: scope, ...(scope === 'friends' ? { instance: activity.instance } : {}) };
    try {
      if (action === 'enter') await ensureSession();
      if (disposed || switching && action !== 'cancel') return;
      const result = await api('/api/ububall/queue', { ...destination, action });
      if (disposed || switching && action !== 'cancel') return;
      if (result.status === 'matched') {
        const ack = () => api('/api/ububall/queue', { ...destination, action: 'ack', id: result.id });
        const encodedId = encodeURIComponent(result.id);
        if (action === 'cancel') {
          await api('/api/ububall/' + encodedId + '/leave', {});
          await ack();
          setQueue(null);
          status('');
          return;
        }
        const initial = await api('/api/ububall/' + encodedId + '/join', {});
        if (switching) return;
        setQueue(null);
        await takeMatch(result.id, initial, ack);
      } else if (result.status === 'waiting') {
        status('');
        queueTimer = setTimeout(() => queueRequest('poll'), 2500);
      } else if (scope === 'friends' && action === 'poll' && result.status === 'idle') {
        queueTimer = setTimeout(() => queueRequest('enter'), 0);
      } else {
        setQueue(null);
        if (result.status === 'busy') status('You are already in another queue.', true);
        else if (action !== 'cancel') status('Your queue entry expired.', true);
      }
    } catch (error) {
      if (disposed || switching) return;
      if (action === 'enter' || !playable()) setQueue(null);
      else queueTimer = setTimeout(() => queueRequest('poll'), 4000);
      status(error.message, true);
    } finally {
      $('online-cancel-queue').disabled = false;
    }
  }
  function startQueue(scope) {
    if (queue || id) return;
    setQueue(scope);
    status('');
    void queueRequest('enter');
  }
  $('activity-play').hidden = !activity;
  $('online-private').hidden = Boolean(activity);
  async function switchActivity(next) {
    if (disposed || switching || pendingMatch || queue === next) return false;
    if (next === 'cpu' && hooks.cpuActive()) { hooks.resumeCpu(); return true; }
    switching = true;
    try {
      if (id && !await leave()) return false;
      if (next === 'cpu') { await hooks.playCpu(); status(''); return true; }
      if (next === 'watch' && hooks.cpuActive() && !await gameUi.confirm({ title: 'Watch this match?',
        message: 'Watching will end your CPU match.', confirmLabel: 'Watch match', cancelLabel: 'Keep playing CPU' })) return false;
      clearTimeout(queueTimer);
      if (activity && session?.owner && !await lobbyRequest('unready')) return false;
      await queueTask;
      if (queue && playable()) await queueRequest('cancel');
      setQueue(null);
      status('');
    } finally {
      switching = false;
      if (queue) { clearTimeout(queueTimer); queueTimer = setTimeout(() => queueRequest('poll'), 2500); }
      if (lobby) renderLobby(lobby);
    }
    if (next === 'friends' || next === 'public') startQueue(next);
    if (hooks.cpuActive() && next === 'public') hooks.resumeCpu();
    return true;
  }
  const labels = { idle: 'Not ready', ready: 'Ready', balling: 'Balling', spectating: 'Spectating' };
  function renderLobby(result) {
    lobby = result;
    const owner = session?.owner ?? null;
    const me = owner ? result.users.find(user => user.owner === owner) : null;
    $('activity-online-count').textContent = result.users.length + ' online';
    const challenge = result.challenges[0];
    const available = !pendingMatch && !lobbyBusy && !switching && !challenge;
    const readyButton = $('online-friends');
    readyButton.disabled = !available;
    readyButton.textContent = id && !watchKey && state?.phase !== 'over' ? 'Find another match' : me?.status === 'ready' ? 'Cancel ready' : 'Ready to play';
    readyButton.setAttribute('aria-pressed', String(me?.status === 'ready'));
    $('activity-cpu').textContent = hooks.cpuActive() ? 'Resume CPU' : 'Play vs CPU';
    $('activity-public').textContent = queue === 'public' ? 'Cancel online search' : 'Find Online Match';
    $('activity-cpu').disabled = $('activity-public').disabled = Boolean(pendingMatch || lobbyBusy || switching);
    const present = new Set(), pairs = new Set(), placed = new Set(), nodes = [];
    const focused = document.activeElement, list = $('activity-users');
    const users = result.users.filter(user => !activity.participants || activity.participants.has(user.owner));
    $('activity-online-count').textContent = users.length + ' online';
    for (const user of users) {
      present.add(user.owner);
      let card = userCards.get(user.owner);
      if (!card) {
        card = Object.assign(document.createElement('button'), { type: 'button', className: 'activity-user' });
        card.append(Object.assign(document.createElement('span'), { className: 'activity-user-avatar' }),
          Object.assign(document.createElement('span'), { className: 'activity-user-name' }),
          Object.assign(document.createElement('span'), { className: 'activity-user-status' }));
        card.onclick = async () => {
          const target = lobby?.users.find(player => player.owner === user.owner);
          if (card.getAttribute('aria-disabled') === 'true' || !target) return;
          if (target.status === 'balling' && !target.cpu) { await watchPlayer(target); return; }
          if (await switchActivity('challenge')) {
            const sent = await lobbyRequest('challenge', { target: target.owner });
            if (sent && hooks.cpuActive()) hooks.resumeCpu();
          }
        };
        userCards.set(user.owner, card);
      }
      const own = Boolean(owner && user.owner === owner), name = user.name || 'Player';
      const initials = name.slice(0, 2).toUpperCase();
      const avatar = card.children[0], avatarKey = `${user.avatar || 'default'}:${initials}`;
      if (avatar.dataset.avatar !== avatarKey) {
        avatar.dataset.avatar = avatarKey; avatar.textContent = initials;
        if (user.avatar) {
          const image = Object.assign(document.createElement('img'), { alt: '', referrerPolicy: 'no-referrer',
            src: `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.owner)}/${encodeURIComponent(user.avatar)}.png?size=128` });
          image.onerror = () => { avatar.textContent = initials; }; avatar.replaceChildren(image);
        }
      }
      card.children[1].textContent = name; card.children[2].textContent = labels[user.status];
      card.dataset.status = user.status; card.dataset.self = String(own);
      const watching = user.status === 'balling' && result.matches?.[user.match]?.watchable;
      const disabled = own || !available || (!watching && !user.cpu && !['idle', 'ready'].includes(user.status));
      card.setAttribute('aria-disabled', String(disabled));
      card.setAttribute('aria-label', `${name}${own ? ', you' : ''}, ${labels[user.status]}${disabled ? '' : watching ? '. Watch match' : '. Challenge player'}`);
      card.title = name + (disabled ? '' : watching ? ' · Watch match' : ' · Challenge');
    }
    for (const user of users) {
      if (placed.has(user.owner)) continue;
      const opponent = user.match && result.matches?.[user.match]?.players.find(owner => owner !== user.owner);
      const other = users.find(player => player.owner === opponent && player.match === user.match);
      if (other) {
        let pair = matchCards.get(user.match);
        if (!pair) {
          pair = Object.assign(document.createElement('div'), { className: 'activity-match' });
          pair.append(Object.assign(document.createElement('span'), { className: 'activity-versus', textContent: 'VS' }));
          matchCards.set(user.match, pair);
        }
        const first = userCards.get(user.owner), second = userCards.get(other.owner);
        if (pair.children[0] !== first) pair.prepend(first);
        if (pair.children[1] !== second) pair.insertBefore(second, pair.children[1]);
        nodes.push(pair); placed.add(other.owner); pairs.add(user.match);
      } else nodes.push(userCards.get(user.owner));
      placed.add(user.owner);
    }
    for (const [owner, card] of userCards) if (!present.has(owner)) { card.remove(); userCards.delete(owner); }
    for (const [match, pair] of matchCards) if (!pairs.has(match)) { pair.remove(); matchCards.delete(match); }
    for (let index = 0; index < nodes.length; index++) if (list.children[index] !== nodes[index]) list.insertBefore(nodes[index], list.children[index] || null);
    if (focused?.isConnected && document.activeElement !== focused && list.contains(focused)) focused.focus({ preventScroll: true });
    $('activity-challenge').hidden = !challenge;
    document.querySelector('.site-nav a[href="/"]')?.classList.toggle('has-notice', Boolean(owner && challenge?.target === owner));
    for (const action of ['accept', 'decline', 'cancel']) $('activity-challenge-' + action).disabled = lobbyBusy;
    if (challenge) {
      const incoming = Boolean(owner && challenge.target === owner);
      const other = result.users.find(user => user.owner === (incoming ? challenge.sender : challenge.target));
      $('activity-challenge-message').textContent = incoming ? `${other?.name || 'A player'} challenged you!` : `Challenge to ${other?.name || 'your opponent'}`;
      $('activity-challenge-accept').hidden = $('activity-challenge-decline').hidden = !incoming;
      $('activity-challenge-cancel').hidden = incoming;
    }
  }
  async function lobbyRequest(action = 'poll', extra = {}) {
    if (disposed || !activity || !session?.owner) return;
    // Mutations wait for the current heartbeat, so a click cannot get silently discarded.
    if (lobbyTask) {
      if (action === 'poll') return lobbyTask;
      await lobbyTask;
      return lobbyRequest(action, extra);
    }
    clearTimeout(lobbyTimer);
    lobbyBusy = action !== 'poll';
    showLoading();
    if (lobby) renderLobby(lobby);
    lobbyTask = (async () => {
      try {
        const cpu = !id && hooks.cpuActive();
        const reportedMatch = id || pendingMatch?.id;
        const result = await api('/api/ububall/lobby', { action, instance: activity.instance, connection, ...extra,
          ...(reportedMatch ? { match: reportedMatch, ...(watchKey && watchKey !== 'activity' ? { watch: watchKey } : {}) } : {}), ...(cpu ? { cpu: true } : {}) });
        if (disposed) return false;
        renderLobby(result);
        if (result.assignment && !id && !pendingMatch && !switching) {
          clearTimeout(queueTimer);
          await queueTask;
          if (switching) return true;
          setQueue(null);
          const initial = await api('/api/ububall/' + encodeURIComponent(result.assignment) + '/join', {});
          await takeMatch(result.assignment, initial, () => api('/api/ububall/lobby', {
            action: 'ack', instance: activity.instance, connection, id: result.assignment, match: result.assignment }));
        }
        if (pendingMatch && !offerBusy) await checkOffer();
        if (result.assignment && id === result.assignment && !watchKey) {
          await api('/api/ububall/lobby', { action: 'ack', instance: activity.instance, connection, id: result.assignment, match: result.assignment });
        }
        if (action !== 'poll' && !id) status('');
        return true;
      } catch (error) { status(error.message, true); return false; }
      finally {
        lobbyBusy = false; lobbyTask = null;
        showLoading();
        if (!disposed) {
          if (lobby) renderLobby(lobby);
          lobbyTimer = action === 'join' && !lobby ? setTimeout(startLobby, 4000) : setTimeout(() => lobbyRequest(), 2500);
        }
      }
    })();
    return lobbyTask;
  }
  async function startLobby() {
    if (disposed || lobbyStarting) return;
    lobbyStarting = true; showLoading();
    try { session = await activity.signIn(); account(); status(''); await lobbyRequest('join'); }
    catch (error) { if (!disposed) { status(error.message, true); lobbyTimer = setTimeout(startLobby, 4000); } }
    finally { lobbyStarting = false; showLoading(); }
  }
  async function watchPlayer(user) {
    if (!lobby?.matches?.[user.match]?.watchable || !await switchActivity('watch')) return;
    lobbyBusy = true; showLoading();
    try { await enter(user.match, await watchState(user.match, 'activity'), 'activity'); }
    catch (error) { status(error.message, true); }
    finally { lobbyBusy = false; showLoading(); }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; stopped = true;
    pendingMatch = null; $('activity-match-offer').close();
    clearTimeout(lobbyTimer); clearTimeout(queueTimer); clearTimeout(retry); clearTimeout(reconcileTimer); clearInterval(heartbeat);
    requests.abort();
    try { if (socket?.readyState === WebSocket.OPEN) socket.send('{"type":"leave"}'); } catch { /* socket may already be closing */ }
    try { socket?.close(); } catch { /* teardown still sends the authenticated departure */ }
    socket = null;
    if (activity && session?.owner) {
      void fetch('/api/ububall/lobby', { method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': session.csrf },
        body: JSON.stringify({ action: 'leave', instance: activity.instance, connection }) }).catch(() => {});
    }
    showLoading();
  }
  window.addEventListener('ubu:activity-leave', dispose, { signal: requests.signal });
  window.addEventListener('ubu:activity-participants', event => {
    if (disposed || !lobby || !session?.owner) return;
    if (!event.detail.includes(session.owner)) { dispose(); activity.dispose(); return; }
    renderLobby(lobby);
    clearTimeout(reconcileTimer);
    void (async () => {
      for (let attempt = 0; attempt < 3 && !disposed; attempt++) {
        await lobbyRequest('reconcile');
        if (!lobby?.users.some(user => !event.detail.includes(user.owner))) break;
        await new Promise(resolve => { reconcileTimer = setTimeout(resolve, 300); });
      }
    })();
  }, { signal: requests.signal });
  $('online-friends').onclick = async () => {
    const wasReady = !id && lobby?.users.find(user => user.owner === session?.owner)?.status === 'ready';
    if (!await switchActivity('off')) return;
    if (!wasReady) {
      const ready = await lobbyRequest('ready');
      if (ready && hooks.cpuActive() && !pendingMatch) hooks.resumeCpu();
    }
  };
  for (const action of ['accept', 'decline', 'cancel']) $('activity-challenge-' + action).onclick = () => {
    if (lobby?.challenges[0]) void lobbyRequest(action, { id: lobby.challenges[0].id });
  };
  $('online-change-rules').onclick = () => { if (state?.canChangeRules) hooks.editRules(state.mode); };
  $('activity-public').onclick = () => switchActivity(queue === 'public' ? 'off' : 'public');
  $('activity-cpu').onclick = () => switchActivity('cpu');
  $('activity-cancel').onclick = () => switchActivity('off');
  $('online-public').onclick = () => startQueue('public');
  $('online-cancel-queue').onclick = () => queueRequest('cancel');
  $('online-dialog').addEventListener('cancel', event => { if (queue) event.preventDefault(); });
  $('online-invite-friends').onclick = async () => {
    try { await activity.invite(); }
    catch (error) { status(error.message, true); }
  };
  async function toggleWatch(button) {
    if (!state || watchKey) return;
    button.disabled = true;
    try { receive(await api('/api/ububall/' + encodeURIComponent(id) + '/allow-watch', { allowed: !state.watchAllowed })); }
    catch (error) { status(error.message, true); hooks.onError(error.message); }
    finally { button.disabled = false; }
  }
  function flashCopied(button, message = 'Copied!') {
    const width = button.getBoundingClientRect().width;
    if (width > 0) {
      button.style.boxSizing = 'border-box';
      button.style.minWidth = `${width}px`;
      button.style.maxWidth = `${width}px`;
      button.style.width = `${width}px`;
    }
    const previous = button.dataset.originalText || button.textContent;
    button.dataset.originalText = previous;
    button.textContent = message;
    clearTimeout(button._copyTimer);
    button._copyTimer = setTimeout(() => {
      button.textContent = button.dataset.originalText || previous;
      delete button.dataset.originalText;
      button.style.minWidth = '';
      button.style.maxWidth = '';
      button.style.width = '';
      button.style.boxSizing = '';
    }, 1500);
  }
  for (const location of ['pause']) {
    const button = $(location + '-allow-watch'), copy = $(location + '-copy-watch');
    button.onclick = () => toggleWatch(button);
    copy.onclick = async () => {
      if (!state?.watchAllowed) return;
      try { receive(await api('/api/ububall/' + encodeURIComponent(id) + '/share-watch', {})); }
      catch (error) { status(error.message, true); return; }
      const link = new URL('/', session?.site || window.location.origin);
      link.searchParams.set('watch', id + '.' + state.watchKey);
      try { await navigator.clipboard.writeText(link.href); flashCopied(copy, 'Copied!'); }
      catch {
        void gameUi.confirm({ title: 'Watch link', message: 'Copy this link to share the live match.', confirmLabel: 'Done',
          input: { value: link.href, maxLength: link.href.length, readOnly: true } });
      }
    };
  }
  // Phones get their share sheet, so the invite goes straight to a chat app.
  $('online-share').hidden = !navigator.share || !matchMedia('(pointer: coarse)').matches;
  $('online-share').onclick = () => navigator.share({ title: 'Ububall', text: 'Play me at Ububall', url: $('online-invite').value }).catch(() => {});
  $('online-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('online-invite').value); flashCopied($('online-copy'), 'Copied!'); status(''); }
    catch { $('online-invite').select(); status('Could not copy the invite.', true); }
  };
  $('online-forfeit').onclick = async () => {
    try { receive(await api('/api/ububall/' + encodeURIComponent(id) + '/forfeit', {})); }
    catch (error) { hooks.onError(error.message); }
  };
  $('online-guest').onclick = async () => {
    $('online-guest').disabled = true;
    try {
      await guestSession(); await joinInvite();
    } catch (error) { status(error.message, true); }
    finally { $('online-guest').disabled = false; }
  };
  if (activity) lobbyReady = startLobby();
  if (watchInvite) {
    if (!activity) showDialog();
    const match = /^([0-9a-f-]{36})\.([0-9a-f-]{36})$/.exec(watchInvite);
    if (!match) status('This watch link is invalid.', true);
    else watchState(match[1], match[2]).then(initial => enter(match[1], initial, match[2])).catch(error => status(error.message, true));
  } else if (invite) {
    $('online-entry').hidden = true;
    (activity ? ensureSession() : refreshSession())
      .then(async () => {
        if (playable()) {
          $('online-dialog').close();
          await joinInvite();
        } else {
          showDialog();
          status('Sign in with Discord or play as a guest to join this match.', true);
        }
      }).catch(error => status(error.message, true));
  } else {
    let saved;
    try { saved = sessionStorage.getItem(queueStorageKey); } catch { /* storage can be disabled */ }
    if (!activity && saved === 'public') {
      setQueue(saved);
      showDialog();
      void queueRequest('poll');
    }
  }
  return {
    get active() { return Boolean(id) && !outdated; }, get state() { return state; }, get spectating() { return Boolean(watchKey); },
    contextChanged() { if (!disposed && !outdated && lobby) renderLobby(lobby); },
    leave,
    // Locks in a team: owned seats send serials in Back, Top, Bottom order; every seat sends supers.
    async ready(team) { if (outdated) throw new Error('Game updated.'); receive(await api('/api/ububall/' + encodeURIComponent(id) + '/team', { ...team, gameNumber: state.gameNumber })); },
    async unready() { if (outdated) throw new Error('Game updated.'); receive(await api('/api/ububall/' + encodeURIComponent(id) + '/unready', {})); },
    async rules(mode, gameNumber) { if (outdated) throw new Error('Game updated.'); receive(await api('/api/ububall/' + encodeURIComponent(id) + '/rules', { mode, gameNumber })); },
    create(mode) { if (outdated) return; createMode = mode; $('online-mode-name').textContent = ububallMatch.modeName(mode); showDialog(true); },
    now: () => Date.now() + offset,
    async skipReplay() {
      if (outdated || watchKey || state?.phase !== 'resolving' || state.replay?.goal == null || state.playUntil !== null) return;
      const match = id;
      const next = await api('/api/ububall/' + encodeURIComponent(match) + '/skip-replay', { startedAt: state.replay.startedAt });
      if (id === match) receive(next);
    },
    rematch() {
      if (outdated || watchKey || !state || state.phase !== 'over') return;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'rematch' }));
      } else {
        api('/api/ububall/' + encodeURIComponent(id) + '/rematch', {}).then(receive).catch(error => hooks.onError(error.message));
      }
    },
    send(moves, lock = false) {
      if (outdated || watchKey || !state || state.phase !== 'plan' || state.locked[state.seat] || !state.connected.every(Boolean) || socket?.readyState !== WebSocket.OPEN) return false;
      const text = JSON.stringify({ type: 'moves', turn: state.turn, gameNumber: state.gameNumber, moves, lock });
      if (!lock && (text === lastDraft || Date.now() - sentAt < 120)) return false;
      socket.send(text); lastDraft = text; sentAt = Date.now(); return true;
    }
  };
}
