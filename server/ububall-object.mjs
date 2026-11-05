import { DurableObject } from 'cloudflare:workers';
import roomModule from './ububall-room.js';
const { MatchRoom } = roomModule;
const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

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
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO match_state VALUES (1, ?)', JSON.stringify(this.room.state));
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
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      const seen = a.live ? this.seen(ws, a) : 0;
      if (a.live && (now >= seen + 30000 || now >= a.expires)) this.retire(ws, Math.min(seen + 30000, a.expires));
    }
  }
  watch(request, path, now) {
    const s = this.room?.state, key = s?.watch?.key;
    const activity = request.headers.get('X-Match-Activity');
    const sameActivity = activity && activity === s?.activity && s.watch?.allowed.every(Boolean);
    if (!s || now >= s.expires || (activity ? !sameActivity || !s.game || s.phase === 'over' : !key || request.headers.get('X-Match-Watch') !== key)) {
      return json({ error: 'This match is unavailable to watch.' }, 404);
    }
    if (this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment().watch && ws.deserializeAttachment().live).length >= 12) {
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
          this.room = new MatchRoom(first.owner, 'standard', challenge ? 'choice' : 'practice', Boolean(first.guest));
          this.room.join(second.owner, Boolean(second.guest));
          if (challenge) for (const player of [first, second]) this.room.practiceTeam(player.owner);
          this.room.state.paired = true;
          this.room.state.matchKind = activity ? 'friend' : 'online';
          if (activity) { this.room.state.activity = activity; this.room.state.watch = { allowed: [true, true], key: null }; }
          if (quickStart) this.room.readyPracticePair();
          this.save();
          await this.schedule(now);
        }
        return json({ ok: true });
      }
      if (path === '/watch-info') {
        const s = this.room?.state;
        if (!s?.watch?.key || !s.game || s.phase === 'over' || now >= s.expires) return json({}, 404);
        return json({ key: s.watch.key, names: s.names, scores: s.game.scores });
      }
      if (path === '/lobby-info') {
        const s = this.room?.state;
        if (!s || s.activity !== request.headers.get('X-Match-Activity') || now >= s.expires) return json({}, 404);
        return json({ players: s.players, watchable: Boolean(s.game && s.phase !== 'over' && s.watch?.allowed.every(Boolean)) });
      }
      if (path === '/depart') {
        if (!this.room) return json({ left: true });
        const owner = request.headers.get('X-Match-Owner'), connection = request.headers.get('X-Match-Connection');
        if (connection) this.ctx.storage.sql.exec('INSERT OR IGNORE INTO retired_connections VALUES (?)', connection);
        for (const ws of this.ctx.getWebSockets()) {
          const a = ws.deserializeAttachment();
          if (a.owner === owner && (!connection || !a.connection || a.connection === connection)) this.retire(ws, now, 4003);
        }
        if (this.room.state.players.includes(owner)) this.room.leave(owner, now);
        this.save(); this.broadcast(now); await this.schedule(now);
        return json({ left: true });
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
          this.room = new MatchRoom(owner, data.mode, data.teams, guest);
        } else if (!this.room || now >= this.room.state.expires) return json({ error: 'Match expired or not found.' }, 404);
        this.sweep(now);
        const alias = request.headers.get('X-Match-Alias');
        if (alias && this.room.claim(owner, alias)) {
          for (const ws of this.ctx.getWebSockets()) {
            const a = ws.deserializeAttachment();
            if (a.owner === alias) { a.owner = owner; ws.serializeAttachment(a); }
          }
        }
        if (path === '/join') this.room.join(owner, guest);
        else this.room.seat(owner);
        this.room.rename(owner, decodeURIComponent(request.headers.get('X-Match-Name') || ''));
        if (path === '/socket') {
          if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'WebSocket required.' }, 426);
          // One controlling connection per player. Replacing a tab cannot leave a ghost player.
          for (const ws of this.ctx.getWebSockets()) if (ws.deserializeAttachment().owner === owner) this.retire(ws, now, 4001);
          const pair = new WebSocketPair(), client = pair[0], server = pair[1];
          this.ctx.acceptWebSocket(server);
          server.serializeAttachment({ owner, connection: request.headers.get('X-Match-Connection'), live: true, lastSeen: now, expires: Number(request.headers.get('X-Match-Expires')) });
          this.room.connect(owner, now); this.room.advance(now); this.save();
          this.broadcast(now); await this.schedule(now);
          return new Response(null, { status: 101, webSocket: client });
        }
        if (path === '/team') {
          if (this.room.state.phase !== 'lobby') throw new Error('Match already started.');
          const data = await request.json();
          if (!data || Object.keys(data).some(k => !['serials', 'supers', 'gameNumber'].includes(k)) ||
              (data.gameNumber || 0) !== (this.room.state.gameNumber || 0)) throw new Error('The game changed. Choose your team again.');
          let entries;
          if (!this.room.state.practice[this.room.seat(owner)]) {
            const registry = this.env.MINT.get(this.env.MINT.idFromName(this.env.MINT_ID));
            const result = await registry.ububallTeam(owner, data.serials);
            if (result.error) throw new Error(result.error);
            entries = result.entries;
          } else {
            if (data.serials !== undefined) throw new Error('This seat uses a practice team.');
            entries = this.room.practiceTeam(owner);
          }
          this.room.selectTeam(owner, entries, data.supers);
        }
        if (path === '/forfeit') this.room.claimForfeit(owner, now);
        if (path === '/unready') this.room.unready(owner);
        if (path === '/team-source') this.room.teamSource(owner, (await request.json())?.practice);
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
      } catch (error) { return json({ error: error.message }, 400); }
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
        if (!data || typeof data !== 'object') throw new Error('Invalid message.');
        a.lastSeen = now; ws.serializeAttachment(a);
        if (data.type === 'rematch') {
          this.room.rematch(a.owner, now);
          this.room.advance(now); this.save(); this.broadcast(now); await this.schedule(now);
          return;
        }
        if (data.type !== 'moves' || Object.keys(data).some(k => !['type', 'turn', 'moves', 'lock', 'gameNumber'].includes(k))) throw new Error('Invalid message.');
        if ((data.gameNumber || 0) !== (this.room.state.gameNumber || 0)) throw new Error('The game changed. Plan your moves again.');
        this.room.submit(a.owner, data.turn, data.moves, data.lock, now);
        this.room.advance(now); this.save();
        if (data.lock === false && this.room.state.phase === 'plan') {
          ws.send(JSON.stringify(this.snapshot(a.owner, now)));
        } else {
          this.broadcast(now);
        }
        await this.schedule(now);
      } catch (error) {
        // Deadline may have passed before the alarm ran; resolve the last accepted draft.
        this.room.advance(now); this.save(); this.broadcast(now); await this.schedule(now);
        ws.send(JSON.stringify({ type: 'error', error: error.message }));
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
      this.sweep(now); this.room.advance(now); this.save(); this.broadcast(now); await this.schedule(now);
    });
  }
}
