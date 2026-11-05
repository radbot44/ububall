import { DurableObject } from 'cloudflare:workers';

const waitingMs = 20000;
const assignmentMs = 120000;
const matchMs = 86400000;

export class UbuballQueue extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS queue (
      owner TEXT PRIMARY KEY, scope TEXT NOT NULL, guest INTEGER NOT NULL, entered INTEGER NOT NULL,
      expires INTEGER NOT NULL, match TEXT
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS queue_waiting ON queue(scope, match, entered)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS queue_expiry ON queue(expires)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS activity_matches (id TEXT PRIMARY KEY, scope TEXT NOT NULL, expires INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS activity_recent ON activity_matches(scope, expires DESC)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS activity_expiry ON activity_matches(expires)');
  }

  match(id) { return this.env.UBUBALL.get(this.env.UBUBALL.idFromName(id)); }

  async expire(now) {
    this.sql.exec('DELETE FROM queue WHERE expires <= ?', now);
    this.sql.exec('DELETE FROM activity_matches WHERE expires <= ?', now);
    const next = this.sql.exec('SELECT min(expires) AS at FROM (SELECT expires FROM queue UNION ALL SELECT expires FROM activity_matches)').one().at;
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  async alarm() { await this.expire(Date.now()); }

  async update(owner, guest, scope, action, id) {
    return this.ctx.blockConcurrencyWhile(async () => {
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
        this.sql.exec('INSERT INTO queue VALUES (?, ?, ?, ?, ?, NULL)', owner, scope, Number(guest), now, now + waitingMs);
        entry = { owner, scope };
      }
      if (!entry.match) {
        this.sql.exec('UPDATE queue SET expires = ? WHERE owner = ?', now + waitingMs, owner);
        const opponent = this.sql.exec('SELECT owner FROM queue WHERE scope = ? AND match IS NULL AND owner != ? ORDER BY entered, rowid LIMIT 1',
          scope, owner).toArray()[0];
        if (!opponent) { await this.expire(now); return { status: 'waiting' }; }
        entry.match = crypto.randomUUID();
        this.sql.exec('UPDATE queue SET match = ?, expires = ? WHERE owner IN (?, ?)', entry.match, now + assignmentMs, owner, opponent.owner);
      }
      // Keep both assignments until the room confirms creation. A retry uses the same match ID.
      const players = this.sql.exec('SELECT owner, guest FROM queue WHERE scope = ? AND match = ? ORDER BY entered, rowid',
        scope, entry.match).toArray();
      await this.expire(now);
      if (players.length === 2) {
        const response = await this.match(entry.match).fetch('https://match/pair', {
          method: 'POST', body: JSON.stringify({ players, quickStart: scope !== 'public' })
        });
        if (!response.ok) throw new Error('Could not set up the match. Try again.');
        if (scope !== 'public') {
          this.sql.exec('INSERT OR IGNORE INTO activity_matches VALUES (?, ?, ?)', entry.match, scope, now + matchMs);
        }
      }
      return { status: 'matched', id: entry.match };
    });
  }

  async watch(scope) {
    const candidates = this.sql.exec('SELECT id FROM activity_matches WHERE scope = ? AND expires > ? ORDER BY expires DESC LIMIT 12',
      scope, Date.now()).toArray();
    const results = await Promise.all(candidates.map(async ({ id }) => {
      const response = await this.match(id).fetch('https://match/watch-info');
      return response.ok ? { id, ...await response.json() } : null;
    }));
    return results.filter(Boolean);
  }
}
