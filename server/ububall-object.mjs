import { DurableObject } from 'cloudflare:workers';
import roomModule from './ububall-room.js';
const { MatchRoom } = roomModule;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const CLIENT_HTTP_ERRORS = new Set([
  'Match already exists.', 'Invalid lobby.', 'Not a match player.', 'Invalid player.', 'Match is full.',
  'Invalid team.', 'Super not available to this ubu.', 'Match already started.', 'Invalid rules.',
  'The game changed. Reopen the rules to try again.', 'Rules can only change before the first launch.',
  'The game changed. Choose your team again.', 'Guests play with their given team.',
  'Choose three different owned ubus.', 'Ubu not found in your collection.',
  'Forfeit is not available.', 'Match is not over.', 'Your opponent left the match.',
  'Choose whether to allow spectators.', 'Spectating is disabled.'
]);
const CLIENT_WS_ERRORS = new Set([
  'Invalid message.', 'Match is not over.', 'Your opponent left the match.', 'Not a match player.',
  'The game changed. Plan your moves again.', 'Turn is not editable.', 'Classic has no supers.',
  'Super unavailable.', 'Submit exactly three moves.', 'Invalid move.', 'Invalid mode.',
  'Unsupported match rules.', 'Both teams must submit.', 'Cannot begin turn.'
]);

// Only the authenticated Worker routes call this object. No owner IDs come from payloads.
export class UbuballMatch extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Workerd answers heartbeats itself, so pings never wake a hibernating match.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS match_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS retired_connections (connection TEXT PRIMARY KEY)');
    const row = ctx.storage.sql.exec('SELECT data FROM match_state WHERE id=1').toArray()[0];
    if (row) { this.room = Object.create(MatchRoom.prototype); this.room.state = JSON.parse(row.data); }
  }
  seen(ws, a) { return Math.max(a.lastSeen, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0); }
  save() {
    this.room.state.revision = (this.room.state.revision || 0) + 1;
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO match_state (id, data) VALUES (1, ?)', JSON.stringify(this.room.state));
  }
  async schedule(now) {
    const s = this.room.state;
    const deadlines = [s.expires, s.deadline, s.playUntil];
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a.live) deadlines.push(this.seen(ws, a) + 30000, a.expires);
    }
    await this.ctx.storage.setAlarm(Math.max(now + 1, Math.min(...deadlines.filter(v => v !== null))));
  }
  snapshot(owner, now) { return { type: 'state', now, revision: this.room.state.revision, ...this.room.view(owner) }; }
  watchSnapshot(now) { return { type: 'state', now, revision: this.room.state.revision, ...this.room.watchView() }; }
  broadcast(now) {
    let view;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a.live) continue;
      try {
        if (a.watch) {
          if (a.watch !== this.room.state.watch?.key && !(a.activity && a.activity === this.room.state.activity && this.room.state.watch?.allowed.every(Boolean))) this.retire(ws, now, 4003);
          else ws.send(view ??= JSON.stringify(this.watchSnapshot(now)));
        } else if (this.room.state.players.includes(a.owner)) ws.send(JSON.stringify(this.snapshot(a.owner, now)));
      } catch { /* close handler tracks presence */ }
    }
  }
  retire(ws, now, code = 4000) {
    const a = ws.deserializeAttachment();
    if (!a?.live) return;
    a.live = false; ws.serializeAttachment(a);
    try { ws.send(JSON.stringify({ type: 'ended', code })); } catch { /* peer may already have closed */ }
    ws.close(code, 'Reconnect to resume');
    if (!a.watch && this.room.state.players.includes(a.owner) && !this.ctx.getWebSockets().some(other => {
      const b = other.deserializeAttachment(); return b.live && !b.watch && b.owner === a.owner;
    })) this.room.disconnect(a.owner, now);
  }
  sweep(now) {
    let changed = false;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      const seen = a.live ? this.seen(ws, a) : 0;
      if (a.live && (now >= seen + 30000 || now >= a.expires)) {
        const before = this.room ? [...this.room.state.connected] : null;
        this.retire(ws, Math.min(seen + 30000, a.expires));
        if (before && (before[0] !== this.room.state.connected[0] || before[1] !== this.room.state.connected[1])) changed = true;
      }
    }
    if (this.room) {
      for (let i = 0; i < 2; i++) {
        const owner = this.room.state.players[i];
        if (owner && this.room.state.connected[i] && !this.ctx.getWebSockets().some(ws => {
          const a = ws.deserializeAttachment();
          return a?.live && !a.watch && a.owner === owner;
        })) {
          this.room.disconnect(owner, now);
          changed = true;
        }
      }
    }
    return changed;
  }
  watch(request, path, now) {
    const s = this.room?.state, key = s?.watch?.key;
    const activity = request.headers.get('X-Match-Activity');
    const sameActivity = activity && activity === s?.activity && s.watch?.allowed.every(Boolean);
    if (!s || now >= s.expires || (activity ? !sameActivity || !s.game || s.phase === 'over' : !key || request.headers.get('X-Match-Watch') !== key)) {
      return json({ error: 'This match is unavailable to watch.' }, 404);
    }
    if (this.ctx.getWebSockets().filter(ws => {
      const a = ws.deserializeAttachment();
      return a.watch && a.live;
    }).length >= 12) {
      return json({ error: 'This match has reached its viewer limit.' }, 429);
    }
    if (path === '/watch-state') return json(this.watchSnapshot(now));
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required.' }, 426);
    const pair = new WebSocketPair(), client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ watch: sameActivity ? 'activity' : key, activity: sameActivity ? activity : null,
      owner: request.headers.get('X-Match-Owner'), connection: request.headers.get('X-Match-Connection'),
      live: true, lastSeen: now, expires: Number(request.headers.get('X-Match-Expires')) || Number.MAX_SAFE_INTEGER });
    server.send(JSON.stringify(this.watchSnapshot(now)));
    return new Response(null, { status: 101, webSocket: client });
  }
  registry() { return this.env.MINT.get(this.env.MINT.idFromName(this.env.MINT_ID)); }
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now(), path = new URL(request.url).pathname;
      const connection = request.headers.get('X-Match-Connection');
      if (path !== '/depart' && connection && this.ctx.storage.sql.exec('SELECT connection FROM retired_connections WHERE connection = ?', connection).toArray().length) {
        return json({ error: 'This Activity connection has ended.' }, 409);
      }
      if (path === '/pair') {
        if (!this.room) {
          const { players: [first, second], quickStart, challenge, activity } = await request.json();
          // A failure here keeps both queue assignments, so the queue retries this match.
          let teams;
          try {
            teams = await Promise.all([first, second].map(player => player.guest ? null : this.registry().matchTeam(player.owner)));
            if ([first, second].some((player, i) => !player.guest && teams[i]?.entries?.length !== 3)) throw new Error('Incomplete team.');
          } catch { return json({ error: 'Could not prepare the teams.' }, 503); }
          const room = new MatchRoom(first.owner, 'standard', Boolean(first.guest));
          room.join(second.owner, Boolean(second.guest));
          room.state.paired = true;
          room.state.challenge = Boolean(challenge);
          room.state.matchKind = activity ? 'friend' : 'online';
          if (activity) { room.state.activity = activity; room.state.watch = { allowed: [true, true], key: null }; }
          if (quickStart) room.readyPair(teams);
          this.room = room;
          this.save();
          await this.schedule(now);
        }
        return json({ ok: true });
      }
      if (path === '/watch-info') {
        const s = this.room?.state, activity = request.headers.get('X-Match-Activity');
        if (!s?.game || s.phase === 'over' || now >= s.expires || !s.watch?.allowed.every(Boolean) || (activity && s.activity !== activity)) return json({}, 404);
        return json({ names: s.names, scores: s.game.scores });
      }
      if (path === '/lobby-info') {
        const s = this.room?.state;
        if (!s || s.activity !== request.headers.get('X-Match-Activity') || now >= s.expires) return json({}, 404);
        return json({ players: s.players, watchable: Boolean(s.game && s.phase !== 'over' && s.watch?.allowed.every(Boolean)) });
      }
      if (path === '/depart') {
        const owner = request.headers.get('X-Match-Owner');
        if (connection) this.ctx.storage.sql.exec('INSERT OR IGNORE INTO retired_connections (connection) VALUES (?)', connection);
        if (!this.room) return json({ left: true, created: false });
        for (const ws of this.ctx.getWebSockets()) {
          const a = ws.deserializeAttachment();
          if (a.owner === owner && (!connection || !a.connection || a.connection === connection)) this.retire(ws, now, 4003);
        }
        if (this.room.state.players.includes(owner)) this.room.leave(owner, now);
        this.save(); this.broadcast(now); await this.schedule(now);
        return json({ left: true, created: true });
      }
      if (path === '/presence') {
        const s = this.room?.state;
        if (!s || now >= s.expires || s.phase === 'over') return json({ status: 'idle' });
        const owner = request.headers.get('X-Match-Owner');
        if (s.players.includes(owner) && !s.left[s.players.indexOf(owner)]) return json({ status: 'balling' });
        if (s.watch?.key && request.headers.get('X-Match-Watch') === s.watch.key) return json({ status: 'spectating' });
        if (s.activity && request.headers.get('X-Match-Activity') === s.activity && s.watch?.allowed.every(Boolean) && s.game) return json({ status: 'spectating' });
        return json({ status: 'idle' });
      }
      if (path === '/watch-state' || path === '/watch-socket') {
        if (this.room && now < this.room.state.expires) {
          const s = this.room.state, before = `${s.phase}:${s.turn}:${s.playUntil}`;
          const swept = this.sweep(now);
          this.room.advance(now);
          if (swept || `${s.phase}:${s.turn}:${s.playUntil}` !== before) {
            this.save(); this.broadcast(now); await this.schedule(now);
          }
        }
        const response = this.watch(request, path, now);
        if (response.status === 101) await this.schedule(now);
        return response;
      }
      const owner = request.headers.get('X-Match-Owner'), guest = request.headers.get('X-Match-Guest') === '1';
      if (!owner) return json({ error: 'Sign in first.' }, 401);
      try {
        if (path === '/create') {
          if (this.room) throw new Error('Match already exists.');
          const data = await request.json();
          const room = new MatchRoom(owner, data?.mode, guest);
          if (!guest) {
            try { await this.registry().matchTeam(owner); }
            catch { return json({ error: 'Mint service unavailable. Retry the same request.' }, 503); }
          }
          this.room = room;
        } else if (!this.room || now >= this.room.state.expires) return json({ error: 'Match expired or not found.' }, 404);
        this.sweep(now);
        const alias = request.headers.get('X-Match-Alias');
        if (alias && this.room.state.players.includes(alias) && !this.room.state.players.includes(owner)) {
          if (!guest) {
            try { await this.registry().matchTeam(owner); }
            catch { return json({ error: 'Mint service unavailable. Retry the same request.' }, 503); }
          }
          if (this.room.claim(owner, alias)) {
            for (const ws of this.ctx.getWebSockets()) {
              const a = ws.deserializeAttachment();
              if (a.owner === alias) { a.owner = owner; ws.serializeAttachment(a); }
            }
          }
        }
        if (path === '/join') {
          if (!this.room.state.players.includes(owner) && (this.room.state.phase !== 'lobby' || this.room.state.players[1])) {
            throw new Error('Match is full.');
          }
          if (!guest) {
            try { await this.registry().matchTeam(owner); }
            catch { return json({ error: 'Mint service unavailable. Retry the same request.' }, 503); }
          }
          this.room.join(owner, guest);
        }
        else this.room.seat(owner);
        this.room.rename(owner, decodeURIComponent(request.headers.get('X-Match-Name') || ''));
        if (path === '/socket') {
          if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required.' }, 426);
          // One controlling connection per player. Replacing a tab cannot leave a ghost player.
          for (const ws of this.ctx.getWebSockets()) if (ws.deserializeAttachment().owner === owner) this.retire(ws, now, 4001);
          const pair = new WebSocketPair(), client = pair[0], server = pair[1];
          this.ctx.acceptWebSocket(server);
          server.serializeAttachment({ owner, connection: request.headers.get('X-Match-Connection'), live: true, lastSeen: now, expires: Number(request.headers.get('X-Match-Expires')) || Number.MAX_SAFE_INTEGER });
          this.room.connect(owner, now); this.room.advance(now); this.save();
          this.broadcast(now); await this.schedule(now);
          return new Response(null, { status: 101, webSocket: client });
        }
        if (path === '/team') {
          if (this.room.state.phase !== 'lobby') throw new Error('Match already started.');
          const data = await request.json();
          if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['serials', 'supers', 'gameNumber'].includes(k)) ||
              (data.gameNumber || 0) !== (this.room.state.gameNumber || 0)) throw new Error('The game changed. Choose your team again.');
          let entries;
          if (!this.room.state.guestTeams[this.room.seat(owner)]) {
            let result;
            try { result = await this.registry().ububallTeam(owner, data.serials); }
            catch { return json({ error: 'Mint service unavailable. Retry the same request.' }, 503); }
            if (result.error) throw new Error(result.error);
            entries = result.entries;
          } else {
            if (data.serials !== undefined) throw new Error('Guests play with their given team.');
            entries = this.room.guestTeam(owner);
          }
          this.room.selectTeam(owner, entries, data.supers);
        }
        if (path === '/forfeit') this.room.claimForfeit(owner, now);
        if (path === '/unready') this.room.unready(owner, guest);
        if (path === '/rules') {
          const data = await request.json();
          this.room.changeRules(owner, data?.mode, data?.gameNumber);
        }
        if (path === '/allow-watch') this.room.allowWatch(owner, (await request.json())?.allowed);
        if (path === '/share-watch') this.room.shareWatch(owner);
        if (path === '/leave') {
          for (const ws of this.ctx.getWebSockets()) if (ws.deserializeAttachment().owner === owner) this.retire(ws, now, 4003);
          this.room.leave(owner, now);
        }
        if (path === '/rematch') this.room.rematch(owner, now);
        if (path === '/skip-replay') this.room.skipReplay(owner, (await request.json())?.startedAt, now);
        this.room.advance(now); this.save(); this.broadcast(now); await this.schedule(now);
        return json(path === '/leave' ? { left: true } : this.snapshot(owner, now));
      } catch (error) {
        if (CLIENT_HTTP_ERRORS.has(error.message)) return json({ error: error.message }, 400);
        console.error(error);
        return json({ error: 'Online play unavailable. Retry the same request.' }, 503);
      }
    });
  }
  async webSocketMessage(ws, message) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now(), a = ws.deserializeAttachment();
      if (!this.room || !a.live) return;
      if (message === '{"type":"leave"}') {
        this.retire(ws, now, 4003);
        if (!a.watch) this.room.leave(a.owner, now);
        this.save(); this.broadcast(now); await this.schedule(now);
        return;
      }
      if (a.watch) return;
      this.sweep(now);
      if (!ws.deserializeAttachment().live) { this.save(); await this.schedule(now); this.broadcast(now); return; }
      try {
        if (typeof message !== 'string' || message.length > 2048) throw new Error('Invalid message.');
        const data = JSON.parse(message);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid message.');
        a.lastSeen = now; ws.serializeAttachment(a);
        if (data.type === 'rematch') {
          this.room.rematch(a.owner, now);
          this.room.advance(now); this.save(); this.broadcast(now); await this.schedule(now);
          return;
        }
        if (data.type !== 'moves' || Object.keys(data).some(k => !['type', 'turn', 'moves', 'lock', 'gameNumber'].includes(k))) throw new Error('Invalid message.');
        if ((data.gameNumber || 0) !== (this.room.state.gameNumber || 0)) throw new Error('The game changed. Plan your moves again.');
        this.room.submit(a.owner, data.turn, data.moves, data.lock, now);
        this.room.advance(now);
        if (data.lock === false && this.room.state.phase === 'plan') {
          // Persist unlocked drafts across DO hibernation; skip snapshot broadcast and alarm reschedule.
          this.save();
        } else {
          this.save();
          this.broadcast(now);
          await this.schedule(now);
        }
      } catch (error) {
        // Deadline may have passed before the alarm ran; resolve the last accepted draft.
        const s = this.room.state, before = `${s.phase}:${s.turn}:${s.playUntil}`;
        this.room.advance(now);
        if (`${s.phase}:${s.turn}:${s.playUntil}` !== before) {
          this.save(); this.broadcast(now); await this.schedule(now);
        }
        const safeMessage = CLIENT_WS_ERRORS.has(error.message) ? error.message : 'Invalid message.';
        try { ws.send(JSON.stringify({ type: 'error', error: safeMessage })); } catch {}
      }
    });
  }
  async webSocketClose(ws) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (!this.room) return;
      const now = Date.now(); this.retire(ws, now); this.save(); this.broadcast(now); await this.schedule(now);
    });
  }
  async webSocketError(ws) { return this.webSocketClose(ws); }
  async alarm() {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (!this.room) return;
      const now = Date.now();
      if (now >= this.room.state.expires) {
        for (const ws of this.ctx.getWebSockets()) this.retire(ws, now, 4002);
        this.ctx.storage.sql.exec('DELETE FROM match_state'); this.ctx.storage.sql.exec('DELETE FROM retired_connections'); this.room = null; return;
      }
      const s = this.room.state, before = `${s.phase}:${s.turn}:${s.playUntil}`;
      const swept = this.sweep(now);
      this.room.advance(now);
      if (swept || `${s.phase}:${s.turn}:${s.playUntil}` !== before) {
        this.save(); this.broadcast(now);
      }
      await this.schedule(now);
    });
  }
}
