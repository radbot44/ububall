'use strict';
function ububallOnline(hooks) {
  const $ = id => document.getElementById(id);
  const params = new URL(location.href).searchParams;
  const watchInvite = params.get('watch'), invite = watchInvite ? null : params.get('match');
  const activity = window.ubuActivity;
  const queueStorageKey = activity ? 'ububall-queue:' + activity.instance : 'ububall-queue';
  let id = null, socket = null, session = null, state = null, retry = null, heartbeat = null;
  let stopped = false, lastPong = 0, offset = 0, lastDraft = '', sentAt = 0;
  let watchKey = null, queue = null, queueTimer, queueTask, leaveTask, switching = false;
  // The lobby shows on the team screen; the dialog only creates, joins and ends matches.
  const status = text => {
    $('online-status').textContent = text; $('lobby-status').textContent = text;
    if (activity) {
      const label = $('activity-status'), message = text || 'Same Activity. Straight to the rink.';
      if (label.textContent !== message) label.textContent = message;
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
    if (id && wasGuest && !watchKey) { clearTimeout(retry); connect(); }
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
  async function watchState(match, key) {
    const response = await fetch('/api/ububall/' + match + '/watch-state?key=' + encodeURIComponent(key));
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not reach the match.');
    return result;
  }
  function updateWatchControls(next) {
    $('pause-watch-controls').hidden = !next || Boolean(next.spectator);
    for (const location of ['lobby', 'pause']) {
      const toggle = $(location + '-allow-watch');
      toggle.setAttribute('aria-pressed', String(Boolean(next?.watchAllowed)));
      toggle.textContent = next?.watchAllowed ? next.watchKey ? 'Spectators allowed' : 'Waiting for opponent to allow spectators' : 'Allow spectators';
      const copy = $(location + '-copy-watch');
      copy.hidden = !next?.watchKey;
      if (!next?.watchKey) copy.textContent = 'Copy watch link';
    }
  }
  function receive(next, reopen = false) {
    if (state && next.revision < state.revision) return;
    if (next.spectator) next.seat = 0; // Fixed rink orientation for viewers.
    const before = state; state = next; offset = next.now - Date.now();
    $('online-create-controls').hidden = true;
    $('online-ended').hidden = true;
    updateWatchControls(next);
    if (next.spectator) {
      if (next.game) { $('online-dialog').close(); hooks.onState(next); }
      else if (!before) { showDialog(); status(next.phase === 'over' ? 'This match has ended.' : 'Waiting for kickoff…'); }
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
      status('Friend found. Getting the rink ready…');
      return;
    }
    if (next.phase === 'lobby') {
      // Entering the lobby (a new match or a rematch) brings up the team screen.
      const note = next.teams === 'practice' ? 'This match uses random practice teams.' :
        next.practice ? 'Guests play with a random practice team. Sign in with Discord to use your own ubus; you keep your seat.' : '';
      hooks.lobby({ state: next, ready, practice: next.practice, guest: Boolean(session?.guest),
        note: note + (note ? ' ' : '') + 'Disconnects pause planning; after 60 seconds your opponent can claim a forfeit.' }, reopen || !before || before.phase !== 'lobby');
      status(!next.occupied[other] ? 'Share the invite link with your opponent.' : ready ? `Team ready. Waiting for ${them}${next.ready[other] ? ' to connect' : ' to choose a team'}.` :
        next.ready[other] ? `${them} is ready. Choose your team, then ready up.` : `${them} joined. Choose your team, then ready up.`);
    } else if (!next.game) {
      if (activity && next.quickStart) {
        if (!stopped) void leave().then(() => status('Your friend left. Tap Play with Friends to queue again.'));
        return;
      }
      // The host left before kickoff: nothing to play, so the dialog explains and offers Leave.
      hooks.closeLobby();
      $('online-ended').hidden = false;
      if (!$('online-dialog').open) $('online-dialog').showModal();
      status(`${them} closed this match.`);
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = title; });
  function connect() {
    if (stopped || !id) return;
    const path = watchKey ? '/watch-socket?key=' + encodeURIComponent(watchKey) : '/socket';
    const current = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ububall/' + id + path);
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
      const ended = [4001, 4002, 4003].includes(event.code);
      hooks.onDisconnect(!ended);
      if (ended) {
        stopped = true;
        const message = event.code === 4001 ? 'Match opened in another tab.' : event.code === 4002 ? 'Match expired.' :
          watchKey ? 'Spectating has ended.' : 'You left this match.';
        status(message); hooks.onError(message);
        return;
      }
      status('Reconnecting…');
      retry = setTimeout(async () => {
        try { if (watchKey) await watchState(id, watchKey); }
        catch (error) { stopped = true; status(error.message); hooks.onError(error.message); return; }
        connect();
      }, 1500);
    };
  }
  async function enter(matchId, initial, key = null) {
    id = matchId; watchKey = key; state = null; stopped = false; lastDraft = '';
    $('online-dialog').close();
    const url = new URL(location.href); url.pathname = '/';
    url.searchParams.delete(key ? 'match' : 'watch');
    url.searchParams.set(key ? 'watch' : 'match', key ? id + '.' + key : id);
    history.replaceState(null, '', url);
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
  function leave() {
    leaveTask ||= finishLeave().finally(() => { leaveTask = null; });
    return leaveTask;
  }
  async function finishLeave() {
    if (!id) return true;
    const historyState = watchKey ? history.state : null;
    const live = !watchKey && state && ['plan', 'resolving'].includes(state.phase);
    if (live && !await gameUi.confirm({ title: 'Leave match?', message: `Leaving ends the match and gives ${state.names[1 - state.seat] || 'your opponent'} the win.`,
      confirmLabel: 'Leave', cancelLabel: 'Keep playing', danger: true })) return false;
    if (!watchKey) {
      try { await api('/api/ububall/' + id + '/leave', {}); }
      catch (error) { hooks.onError(error.message); return false; }
    }
    stopped = true;
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
    return true;
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
  function showDialog(create = false) {
    $('online-entry').hidden = Boolean(id || create || queue);
    $('online-create-controls').hidden = !create;
    $('online-ended').hidden = !id;
    $('online-leave').textContent = watchKey ? 'Stop watching' : 'Leave online match';
    if (!$('online-dialog').open) $('online-dialog').showModal();
    refreshSession().catch(error => status(error.message));
  }
  $('online-open').onclick = () => { if (id && !watchKey && state?.phase === 'lobby') receive(state, true); else showDialog(); };
  $('online-private').onclick = () => { $('online-dialog').close(); hooks.chooseMode(createMode); };
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
  async function guestSession() {
    const response = await fetch('/api/guest', { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not start a guest session.');
    session = result; account();
  }
  async function ensureSession() {
    await refreshSession();
    if (switching) return;
    if (activity && (!session?.owner || session.instance !== activity.instance)) session = await activity.signIn();
    else if (!playable()) await guestSession();
  }
  function setQueue(value) {
    queue = value;
    try {
      if (value) sessionStorage.setItem(queueStorageKey, value);
      else sessionStorage.removeItem(queueStorageKey);
    } catch { /* queue can still run */ }
    $('online-entry').hidden = Boolean(value || id);
    if (value && $('online-watch-list').matches(':popover-open')) $('online-watch-list').hidePopover();
    $('online-cancel-queue').hidden = !value;
    $('online-close').disabled = Boolean(value);
    $('online-friends').disabled = value === 'friends';
    $('activity-cancel').hidden = !value;
    account();
  }
  function queueRequest(action) {
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
      if (switching && action !== 'cancel') return;
      const result = await api('/api/ububall/queue', { ...destination, action });
      if (switching && action !== 'cancel') return;
      if (result.status === 'matched') {
        const ack = () => api('/api/ububall/queue', { ...destination, action: 'ack', id: result.id });
        if (activity && action === 'cancel') {
          await api('/api/ububall/' + result.id + '/leave', {});
          await ack();
          setQueue(null);
          return;
        }
        const initial = await api('/api/ububall/' + result.id + '/join', {});
        if (switching) return;
        setQueue(null);
        await enter(result.id, initial);
        void ack().catch(() => {});
      } else if (result.status === 'waiting') {
        status(scope === 'friends' ? 'Waiting for a friend to join this Activity…' : 'Finding an online opponent…');
        queueTimer = setTimeout(() => queueRequest('poll'), 2500);
      } else if (scope === 'friends' && action === 'poll' && result.status === 'idle') {
        queueTimer = setTimeout(() => queueRequest('enter'), 0);
      } else {
        setQueue(null);
        status(result.status === 'busy' ? 'You are already in another queue. Cancel it there to switch.' :
          action === 'cancel' ? 'Queue canceled.' : 'Your queue entry expired. Queue up again to play.');
      }
    } catch (error) {
      if (switching) return;
      if (action === 'enter' || !playable()) setQueue(null);
      else queueTimer = setTimeout(() => queueRequest('poll'), 4000);
      status(error.message);
    } finally {
      $('online-cancel-queue').disabled = false;
    }
  }
  function startQueue(scope) {
    if (queue || id) return;
    setQueue(scope);
    status(activity && !session?.owner ? 'Connecting to Discord…' :
      scope === 'friends' ? 'Joining your friends’ queue…' : 'Finding an online opponent…');
    void queueRequest('enter');
  }
  $('activity-play').hidden = !activity;
  $('online-private').hidden = Boolean(activity);
  async function switchActivity(next) {
    if (switching || (id && (!state?.quickStart || state.game)) || queue === next) return false;
    switching = true;
    clearTimeout(queueTimer);
    try {
      if (id && !await leave()) return false;
      if (next === 'cpu') hooks.playCpu();
      await queueTask;
      if (queue && playable()) await queueRequest('cancel');
      setQueue(null);
      status('');
    } finally { switching = false; }
    if (next === 'friends' || next === 'public') startQueue(next);
    return true;
  }
  $('online-friends').onclick = () => switchActivity('friends');
  $('activity-public').onclick = () => switchActivity('public');
  $('activity-cpu').onclick = () => switchActivity('cpu');
  $('activity-cancel').onclick = () => switchActivity('off');
  $('online-public').onclick = () => startQueue('public');
  $('online-cancel-queue').onclick = () => queueRequest('cancel');
  $('online-dialog').addEventListener('cancel', event => { if (queue) event.preventDefault(); });
  $('online-invite-friends').onclick = async () => {
    try { await activity.invite(); }
    catch (error) { status(error.message); }
  };
  async function listActivityMatches() {
    const list = $('online-watch-list');
    const note = Object.assign(document.createElement('p'), { textContent: 'Looking for live matches…' });
    note.setAttribute('role', 'status');
    list.replaceChildren(note);
    try {
      if (!await switchActivity('watch')) { note.textContent = 'Try again in a moment.'; return; }
      await ensureSession();
      const matches = await api('/api/ububall/activity-watch?instance=' + encodeURIComponent(activity.instance));
      if (!list.contains(note)) return;
      note.textContent = matches.length ? 'Choose a match to watch.' : 'No matches are open to spectators in this Activity.';
      for (const { id: match, key, names, scores } of matches) {
        const label = names.map((name, i) => name || 'Player ' + (i + 1));
        const button = Object.assign(document.createElement('button'), { type: 'button',
          textContent: `${label[0]} ${scores[0]} – ${scores[1]} ${label[1]}` });
        button.onclick = async () => {
          button.disabled = true;
          try {
            const initial = await watchState(match, key);
            if (!id && !queue && list.matches(':popover-open')) {
              list.hidePopover();
              await enter(match, initial, key);
            }
          }
          catch (error) { status(error.message); }
          finally { button.disabled = false; }
        };
        list.append(button);
      }
      if (list.matches(':popover-open')) gameUi.place(list, $('online-watch'), 'end');
    } catch (error) { note.textContent = error.message; }
  }
  if (activity) gameUi.dropdown($('online-watch'), $('online-watch-list'), { align: 'end', prepare: listActivityMatches });
  async function toggleWatch(button) {
    if (!state || watchKey) return;
    button.disabled = true;
    try { receive(await api('/api/ububall/' + id + '/allow-watch', { allowed: !state.watchAllowed })); }
    catch (error) { status(error.message); hooks.onError(error.message); }
    finally { button.disabled = false; }
  }
  for (const location of ['lobby', 'pause']) {
    const button = $(location + '-allow-watch'), copy = $(location + '-copy-watch');
    button.onclick = () => toggleWatch(button);
    copy.onclick = async () => {
      if (!state?.watchKey) return;
      const link = new URL('/', session?.site || window.location.origin);
      link.searchParams.set('watch', id + '.' + state.watchKey);
      try { await navigator.clipboard.writeText(link.href); copy.textContent = 'Watch link copied'; }
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
      await guestSession(); await joinInvite();
    } catch (error) { status(error.message); }
    finally { $('online-guest').disabled = false; }
  };
  if (watchInvite) {
    if (!activity) showDialog();
    const match = /^([0-9a-f-]{36})\.([0-9a-f-]{36})$/.exec(watchInvite);
    if (!match) status('This watch link is invalid.');
    else watchState(match[1], match[2]).then(initial => enter(match[1], initial, match[2])).catch(error => status(error.message));
  } else if (invite) {
    if (!activity) showDialog();
    $('online-entry').hidden = true;
    (activity ? ensureSession() : refreshSession())
      .then(() => playable() ? joinInvite() : status('Sign in with Discord or play as a guest to join this match.')).catch(error => status(error.message));
  } else {
    let saved;
    try { saved = sessionStorage.getItem(queueStorageKey); } catch { /* storage can be disabled */ }
    if (activity && (location.pathname === '/' || location.pathname === '/index.html')) {
      startQueue(saved === 'public' ? 'public' : 'friends');
    } else if (!activity && saved === 'public') {
      setQueue(saved);
      showDialog();
      void queueRequest('poll');
    }
  }
  return {
    get active() { return Boolean(id); }, get state() { return state; }, get spectating() { return Boolean(watchKey); },
    leave,
    // Locks in a team: owned seats send serials in Back, Top, Bottom order; every seat sends supers.
    async ready(team) { receive(await api('/api/ububall/' + id + '/team', team)); },
    async unready() { receive(await api('/api/ububall/' + id + '/unready', {})); },
    create(mode) { createMode = mode; $('online-mode-name').textContent = ububallMatch.modeName(mode); showDialog(true); },
    now: () => Date.now() + offset,
    async skipReplay() {
      if (watchKey || state?.phase !== 'resolving' || state.replay?.goal == null || state.playUntil !== null) return;
      const match = id;
      const next = await api('/api/ububall/' + match + '/skip-replay', { startedAt: state.replay.startedAt });
      if (id === match) receive(next);
    },
    rematch() {
      if (watchKey || !state || state.phase !== 'over') return;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'rematch' }));
      } else {
        api('/api/ububall/' + id + '/rematch', {}).then(receive).catch(error => hooks.onError(error.message));
      }
    },
    send(moves, lock = false) {
      if (watchKey || !state || state.phase !== 'plan' || state.locked[state.seat] || !state.connected.every(Boolean) || socket?.readyState !== WebSocket.OPEN) return false;
      const text = JSON.stringify({ type: 'moves', turn: state.turn, moves, lock });
      if (!lock && (text === lastDraft || Date.now() - sentAt < 120)) return false;
      socket.send(text); lastDraft = text; sentAt = Date.now(); return true;
    }
  };
}
