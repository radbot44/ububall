import { DurableObject } from 'cloudflare:workers';

const waitingMs = 20000;
const assignmentMs = 120000;
const matchMs = 86400000;
const CLIENT_LOBBY_ERRORS = new Set([
  'This Activity connection has ended.', 'You have left this Activity.',
  'Could not finish leaving the match.', 'Could not set up the match. Try again.',
  'Could not check the current match.', 'Leave the current game before readying up.',
  'You are already in another queue.', 'Could not cancel the assigned match.',
  'This player is no longer available.', 'Finish your pending challenge first.',
  'This player already has a pending challenge.', 'This challenge is no longer available.',
  'A player is no longer available.'
]);

export class UbuballQueue extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS queue (
      owner TEXT PRIMARY KEY, scope TEXT NOT NULL, guest INTEGER NOT NULL, entered INTEGER NOT NULL,
      expires INTEGER NOT NULL, match TEXT, challenge INTEGER NOT NULL DEFAULT 0
    )`);
    if (!this.sql.exec('PRAGMA table_info(queue)').toArray().some(column => column.name === 'challenge')) {
      this.sql.exec('ALTER TABLE queue ADD COLUMN challenge INTEGER NOT NULL DEFAULT 0');
    }
    this.sql.exec('CREATE INDEX IF NOT EXISTS queue_waiting ON queue(scope, match, entered)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS queue_expiry ON queue(expires)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS activity_matches (id TEXT PRIMARY KEY, scope TEXT NOT NULL, expires INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS activity_recent ON activity_matches(scope, expires DESC)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS activity_expiry ON activity_matches(expires)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lobby_members (
      owner TEXT PRIMARY KEY, scope TEXT NOT NULL, name TEXT, avatar TEXT, expires INTEGER NOT NULL,
      match TEXT, status TEXT NOT NULL DEFAULT 'idle'
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS lobby_scope ON lobby_members(scope, expires)');
    if (!this.sql.exec('PRAGMA table_info(lobby_members)').toArray().some(column => column.name === 'watching')) {
      this.sql.exec('ALTER TABLE lobby_members ADD COLUMN watching TEXT');
    }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS lobby_connections (
      owner TEXT PRIMARY KEY, scope TEXT NOT NULL, launch TEXT NOT NULL, issued INTEGER NOT NULL,
      connection TEXT NOT NULL, closed INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL, matches TEXT NOT NULL DEFAULT '[]'
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, sender TEXT NOT NULL, target TEXT NOT NULL, expires INTEGER NOT NULL
    )`);
  }

  match(id) { return this.env.UBUBALL.get(this.env.UBUBALL.idFromName(id)); }

  async expire(now) {
    for (const row of this.sql.exec(`SELECT c.owner, c.connection FROM lobby_connections c JOIN lobby_members m ON m.owner = c.owner
      WHERE c.closed = 1`).toArray()) {
      try { await this.depart(row.owner, row.connection); }
      catch {
        this.sql.exec('UPDATE lobby_members SET expires = ? WHERE owner = ?', now + 1000, row.owner);
        this.sql.exec('UPDATE lobby_connections SET expires = MAX(expires, ?) WHERE owner = ?', now + 1000, row.owner);
      }
    }
    this.sql.exec('DELETE FROM queue WHERE expires <= ?', now);
    this.sql.exec('DELETE FROM activity_matches WHERE expires <= ?', now);
    this.sql.exec('DELETE FROM lobby_members WHERE expires <= ?', now);
    this.sql.exec('DELETE FROM lobby_connections WHERE expires <= ?', now);
    this.sql.exec(`DELETE FROM challenges WHERE expires <= ? OR NOT EXISTS
      (SELECT 1 FROM lobby_members WHERE owner = sender AND lobby_members.scope = challenges.scope) OR NOT EXISTS
      (SELECT 1 FROM lobby_members WHERE owner = target AND lobby_members.scope = challenges.scope)`, now);
    const next = this.sql.exec(`SELECT min(expires) AS at FROM (SELECT expires FROM queue UNION ALL SELECT expires FROM activity_matches
      UNION ALL SELECT expires FROM lobby_members UNION ALL SELECT expires FROM lobby_connections UNION ALL SELECT expires FROM challenges)`).one().at;
    if (next !== null) await this.ctx.storage.setAlarm(Math.max(now + 1, next));
  }

  async alarm() { return this.ctx.blockConcurrencyWhile(() => this.expire(Date.now())); }

  current(owner, scope, launch, connection) {
    return Boolean(this.sql.exec(`SELECT owner FROM lobby_connections WHERE owner = ? AND scope = ? AND launch = ?
      AND connection = ? AND closed = 0 AND expires > ?`, owner, scope, launch, connection, Date.now()).toArray().length);
  }

  async depart(owner, connection) {
    const lease = this.sql.exec('SELECT * FROM lobby_connections WHERE owner = ?', owner).toArray()[0];
    if (lease && lease.connection !== connection) return;
    this.sql.exec('UPDATE lobby_connections SET closed = 1 WHERE owner = ?', owner);
    const member = this.sql.exec('SELECT * FROM lobby_members WHERE owner = ?', owner).toArray()[0];
    const queued = this.sql.exec('SELECT match FROM queue WHERE owner = ?', owner).toArray()[0];
    this.sql.exec('DELETE FROM queue WHERE owner = ?', owner);
    this.clearChallenges(owner);
    for (const match of new Set([...(lease ? JSON.parse(lease.matches) : []), member?.match, member?.watching, queued?.match].filter(Boolean))) {
      const response = await this.match(match).fetch('https://match/depart', {
        method: 'POST', headers: { 'X-Match-Owner': owner, 'X-Match-Connection': connection || '' }
      });
      if (!response.ok) throw new Error('Could not finish leaving the match.');
      const result = await response.json().catch(() => ({}));
      if (result.created === false) {
        this.sql.exec('DELETE FROM queue WHERE match = ?', match);
        this.sql.exec("UPDATE lobby_members SET match = NULL, status = 'idle' WHERE match = ?", match);
      }
    }
    this.sql.exec('DELETE FROM lobby_members WHERE owner = ?', owner);
  }

  async update(owner, guest, scope, action, id, activity) {
    return this.ctx.blockConcurrencyWhile(() => {
      if (activity && !this.current(owner, 'activity:' + activity.instance, activity.launch, activity.connection)) return { status: 'closed' };
      return this.updateQueue(owner, guest, scope, action, id);
    });
  }

  async updateQueue(owner, guest, scope, action, id) {
    const now = Date.now();
    this.sql.exec('DELETE FROM queue WHERE expires <= ?', now);
    let entry = this.sql.exec('SELECT * FROM queue WHERE owner = ?', owner).toArray()[0];
    if (action === 'ack') {
      this.sql.exec('DELETE FROM queue WHERE owner = ? AND scope = ? AND match = ?', owner, scope, id);
      return { status: 'idle' };
    }
    if (action === 'cancel' && !entry?.match) {
      this.sql.exec('DELETE FROM queue WHERE owner = ? AND scope = ?', owner, scope);
      return { status: 'idle' };
    }
    if (entry && entry.scope !== scope) return { status: 'busy' };
    if (!entry && action !== 'enter') return { status: 'idle' };
    if (!entry) {
      this.sql.exec('INSERT INTO queue (owner, scope, guest, entered, expires, match) VALUES (?, ?, ?, ?, ?, NULL)', owner, scope, Number(guest), now, now + waitingMs);
      entry = { owner, scope };
    }
    if (!entry.match) {
      this.sql.exec('UPDATE queue SET expires = ? WHERE owner = ?', now + waitingMs, owner);
      const opponent = this.sql.exec('SELECT owner FROM queue WHERE scope = ? AND match IS NULL AND owner != ? ORDER BY entered, rowid LIMIT 1',
        scope, owner).toArray()[0];
      if (!opponent) { await this.expire(now); return { status: 'waiting' }; }
      entry.match = crypto.randomUUID();
      this.sql.exec('UPDATE queue SET match = ?, expires = ? WHERE owner IN (?, ?)', entry.match, now + assignmentMs, owner, opponent.owner);
      this.clearChallenges(owner);
      this.clearChallenges(opponent.owner);
    }
    await this.expire(now);
    await this.ensureMatch({ ...entry, scope }, now);
    return { status: 'matched', id: entry.match };
  }

  async ensureMatch(entry, now) {
    // Keep both assignments until creation succeeds. A retry uses the reserved ID and rules flow.
    const players = this.sql.exec('SELECT owner, guest FROM queue WHERE scope = ? AND match = ? ORDER BY entered, rowid',
      entry.scope, entry.match).toArray();
    if (players.length === 2) {
      const response = await this.match(entry.match).fetch('https://match/pair', {
        method: 'POST', body: JSON.stringify({ players, challenge: Boolean(entry.challenge), quickStart: !entry.challenge && entry.scope !== 'public',
          ...(entry.scope.startsWith('activity:') ? { activity: entry.scope.slice(9) } : {}) })
      });
      if (!response.ok) throw new Error('Could not set up the match. Try again.');
      if (entry.scope !== 'public') {
        this.sql.exec('INSERT OR IGNORE INTO activity_matches (id, scope, expires) VALUES (?, ?, ?)', entry.match, entry.scope, now + matchMs);
      }
    }
  }

  clearChallenges(owner) { this.sql.exec('DELETE FROM challenges WHERE sender = ? OR target = ?', owner, owner); }

  async presence(owner, match, key, activity) {
    if (!match) return 'idle';
    const response = await this.match(match).fetch('https://match/presence', {
      headers: { 'X-Match-Owner': owner, ...(key ? { 'X-Match-Watch': key } : {}), ...(activity ? { 'X-Match-Activity': activity } : {}) }
    });
    if (!response.ok) throw new Error('Could not check the current match.');
    return (await response.json()).status;
  }

  reserveChallenge(id, players, scope, now) {
    // Reserve both seats before contacting the match object. A retry creates the same match.
    for (const owner of players) {
      this.sql.exec('INSERT OR REPLACE INTO queue (owner, scope, guest, entered, expires, match, challenge) VALUES (?, ?, 0, ?, ?, ?, 1)', owner, scope, now, now + assignmentMs, id);
      this.sql.exec("UPDATE lobby_members SET match = ?, status = 'balling' WHERE owner = ?", id, owner);
      this.clearChallenges(owner);
    }
  }

  async lobby(owner, scope, profile, data, participants) {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const now = Date.now();
        await this.expire(now);
        const lease = this.sql.exec('SELECT * FROM lobby_connections WHERE owner = ?', owner).toArray()[0];
        if (data.action === 'leave' && (!lease || profile.issued > lease.issued)) {
          if (lease) await this.depart(owner, lease.connection);
          this.sql.exec('INSERT OR REPLACE INTO lobby_connections (owner, scope, launch, issued, connection, closed, expires) VALUES (?, ?, ?, ?, ?, 1, ?)',
            owner, scope, profile.launch, profile.issued, data.connection, profile.expires);
          await this.expire(now);
          return { users: [], challenges: [], assignment: null };
        }
        if (data.action === 'leave' && lease.launch === profile.launch && lease.connection === data.connection) {
          await this.depart(owner, data.connection);
          await this.expire(now);
          return { users: [], challenges: [], assignment: null };
        }
        if (data.action === 'join' && (!lease || lease.launch !== profile.launch || lease.connection !== data.connection)) {
          if (lease && (lease.issued >= profile.issued || lease.launch === profile.launch)) throw new Error('This Activity connection has ended.');
          if (lease) await this.depart(owner, lease.connection);
          else await this.depart(owner, null);
          this.sql.exec('INSERT OR REPLACE INTO lobby_connections (owner, scope, launch, issued, connection, closed, expires) VALUES (?, ?, ?, ?, ?, 0, ?)',
            owner, scope, profile.launch, profile.issued, data.connection, profile.expires);
        }
        if (!this.current(owner, scope, profile.launch, data.connection)) throw new Error('This Activity connection has ended.');
        if (participants) {
          for (const member of this.sql.exec('SELECT owner, connection FROM lobby_connections WHERE scope = ? AND closed = 0 AND issued < ?', scope, participants.checkedBefore).toArray()) {
            if (!participants.users.includes(member.owner)) await this.depart(member.owner, member.connection);
          }
          if (!this.current(owner, scope, profile.launch, data.connection)) throw new Error('You have left this Activity.');
        }
        const previous = this.sql.exec('SELECT * FROM lobby_members WHERE owner = ?', owner).toArray()[0];
        let assignment = this.sql.exec('SELECT * FROM queue WHERE owner = ?', owner).toArray()[0];
        let activeMatch = previous?.match || null;
        let status = await this.presence(owner, activeMatch);
        let watching = null;
        if (status === 'idle' && assignment?.match === activeMatch && activeMatch) status = 'balling';
        if (status === 'idle') activeMatch = null;
        if (data.match && (data.match !== activeMatch || data.watch)) {
          const reported = await this.presence(owner, data.match, data.watch, scope.slice(9));
          if (reported === 'balling') { activeMatch = data.match; status = reported; }
          else if (!activeMatch && reported === 'spectating') { status = reported; watching = data.match; }
        }
        if (!activeMatch && data.cpu) status = 'cpu';
        this.sql.exec('UPDATE lobby_connections SET matches = ? WHERE owner = ?', JSON.stringify([activeMatch, watching].filter(Boolean)), owner);
        this.sql.exec(`INSERT INTO lobby_members (owner, scope, name, avatar, expires, match, status, watching) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(owner) DO UPDATE SET name=excluded.name, avatar=excluded.avatar, expires=excluded.expires,
          match=excluded.match, status=excluded.status, watching=excluded.watching`, owner, scope, profile.name, profile.avatar, now + waitingMs, activeMatch, status, watching);
        if (!['idle', 'cpu'].includes(status)) {
          this.clearChallenges(owner);
          if (assignment && !assignment.match) { this.sql.exec('DELETE FROM queue WHERE owner = ?', owner); assignment = null; }
        }
        if (data.action === 'ack') {
          this.sql.exec('DELETE FROM queue WHERE owner = ? AND scope = ? AND match = ?', owner, scope, data.id);
        } else if (data.action === 'ready') {
          if (!['idle', 'cpu'].includes(status)) throw new Error('Leave the current game before readying up.');
          this.clearChallenges(owner);
          const result = await this.updateQueue(owner, false, scope, 'enter');
          if (result.status === 'busy') throw new Error('You are already in another queue.');
        } else if (data.action === 'unready') {
          this.clearChallenges(owner);
          if (assignment?.match && !data.match) {
            const response = await this.match(assignment.match).fetch('https://match/leave', {
              method: 'POST', headers: { 'X-Match-Owner': owner }
            });
            if (!response.ok && response.status !== 404) throw new Error('Could not cancel the assigned match.');
            if (response.status === 404) {
              this.sql.exec('DELETE FROM queue WHERE match = ?', assignment.match);
              this.sql.exec("UPDATE lobby_members SET match = NULL, status = 'idle' WHERE match = ?", assignment.match);
            } else {
              this.sql.exec("UPDATE lobby_members SET match = NULL, status = 'idle' WHERE owner = ?", owner);
              this.sql.exec('DELETE FROM queue WHERE owner = ?', owner);
            }
          } else if (!assignment?.match) this.sql.exec('DELETE FROM queue WHERE owner = ? AND scope = ?', owner, scope);
        } else if (data.action === 'challenge') {
          const target = this.sql.exec('SELECT * FROM lobby_members WHERE owner = ? AND scope = ?', data.target, scope).toArray()[0];
          const targetQueue = this.sql.exec('SELECT match FROM queue WHERE owner = ?', data.target).toArray()[0];
          if (!['idle', 'cpu'].includes(status) || assignment?.match || assignment && assignment.scope !== scope || !target || target.owner === owner ||
              !['idle', 'cpu'].includes(target.status) || target.match || targetQueue?.match) throw new Error('This player is no longer available.');
          if (this.sql.exec('SELECT id FROM challenges WHERE sender = ? OR target = ?', owner, owner).toArray().length) {
            throw new Error('Finish your pending challenge first.');
          }
          if (this.sql.exec('SELECT id FROM challenges WHERE sender = ? OR target = ?', target.owner, target.owner).toArray().length) {
            throw new Error('This player already has a pending challenge.');
          }
          // Challenging is a deliberate choice; stop the sender from being automatically paired.
          this.sql.exec('DELETE FROM queue WHERE owner = ? AND match IS NULL', owner);
          this.sql.exec('INSERT INTO challenges (id, scope, sender, target, expires) VALUES (?, ?, ?, ?, ?)', crypto.randomUUID(), scope, owner, target.owner, now + 30000);
        } else if (['accept', 'decline', 'cancel'].includes(data.action)) {
          const challenge = this.sql.exec('SELECT * FROM challenges WHERE id = ? AND scope = ?', data.id, scope).toArray()[0];
          if (!challenge || (data.action === 'cancel' ? challenge.sender !== owner : challenge.target !== owner)) {
            throw new Error('This challenge is no longer available.');
          }
          if (data.action === 'accept') {
            const players = [challenge.sender, challenge.target];
            const available = players.every(player => {
              const member = this.sql.exec('SELECT * FROM lobby_members WHERE owner = ? AND scope = ?', player, scope).toArray()[0];
              const queued = this.sql.exec('SELECT * FROM queue WHERE owner = ?', player).toArray()[0];
              return member && ['idle', 'cpu'].includes(member.status) && !member.match && !queued?.match;
            });
            if (!available) throw new Error('A player is no longer available.');
            this.reserveChallenge(challenge.id, players, scope, now);
          } else this.sql.exec('DELETE FROM challenges WHERE id = ?', data.id);
        }
        assignment = this.sql.exec('SELECT * FROM queue WHERE owner = ? AND scope = ?', owner, scope).toArray()[0];
        if (assignment?.match) {
          await this.ensureMatch(assignment, now);
        } else if (assignment) {
          await this.updateQueue(owner, false, scope, 'poll');
          assignment = this.sql.exec('SELECT * FROM queue WHERE owner = ? AND scope = ?', owner, scope).toArray()[0];
        }
        if (assignment?.match) {
          this.sql.exec("UPDATE lobby_members SET match = ?, status = 'balling' WHERE owner IN (SELECT owner FROM queue WHERE match = ?)", assignment.match, assignment.match);
          for (const { owner: player } of this.sql.exec('SELECT owner FROM queue WHERE match = ?', assignment.match)) this.clearChallenges(player);
          this.sql.exec('UPDATE lobby_connections SET matches = ? WHERE owner IN (SELECT owner FROM queue WHERE match = ?)',
            JSON.stringify([assignment.match]), assignment.match);
        }
        await this.expire(now);
        const users = this.sql.exec(`SELECT m.owner, m.name, m.avatar, m.match, m.status = 'cpu' AS cpu,
          CASE WHEN m.status NOT IN ('idle', 'cpu') THEN m.status
          WHEN q.match IS NOT NULL THEN 'balling'
          WHEN q.owner IS NOT NULL AND q.match IS NULL THEN 'ready' WHEN m.status = 'cpu' THEN 'balling' ELSE 'idle' END AS status
          FROM lobby_members m LEFT JOIN queue q ON q.owner = m.owner
          WHERE m.scope = ? ORDER BY m.rowid LIMIT 200`, scope).toArray();
        const challenges = this.sql.exec('SELECT * FROM challenges WHERE scope = ? AND (sender = ? OR target = ?)', scope, owner, owner).toArray();
        const matches = {};
        await Promise.all([...new Set(users.map(user => user.match).filter(Boolean))].map(async match => {
          const response = await this.match(match).fetch('https://match/lobby-info', { headers: { 'X-Match-Activity': scope.slice(9) } });
          if (response.ok) matches[match] = await response.json();
        }));
        return { users, challenges, matches, assignment: assignment?.match || null };
      } catch (error) {
        // A rejected command must not reset the coordinator or invalidate other callers.
        if (CLIENT_LOBBY_ERRORS.has(error.message)) return { error: error.message };
        console.error(error);
        return { error: 'Online lobby unavailable. Try again.' };
      }
    });
  }

  async watch(scope) {
    const candidates = this.sql.exec('SELECT id FROM activity_matches WHERE scope = ? AND expires > ? ORDER BY expires DESC LIMIT 12',
      scope, Date.now()).toArray();
    const activity = scope.startsWith('activity:') ? scope.slice(9) : '';
    const results = await Promise.all(candidates.map(async ({ id }) => {
      const response = await this.match(id).fetch('https://match/watch-info', {
        headers: activity ? { 'X-Match-Activity': activity } : {}
      });
      return response.ok ? { id, ...await response.json() } : null;
    }));
    return results.filter(Boolean);
  }
}
