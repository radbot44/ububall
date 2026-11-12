import { DurableObject } from 'cloudflare:workers';

// Synthetic-only SQL benchmark. The query forms intentionally mirror the baseline main
// implementation and the optimization PR; no user data or production bindings are accessed.
const USERS = ['123456789012345678', '234567890123456789'];
const PAGE = 200;

export class SqlReadBenchmark extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS issued (id TEXT PRIMARY KEY, owner TEXT NOT NULL, serial TEXT NOT NULL UNIQUE, request TEXT NOT NULL, issued_at INTEGER NOT NULL, certificate TEXT, favorite INTEGER NOT NULL DEFAULT 0)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS issued_recent_sort ON issued(owner, (certificate IS NULL), issued_at DESC, serial DESC)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS issued_owner ON issued(owner)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS issued_request ON issued(owner, request)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS mint_account_counts (owner TEXT PRIMARY KEY, regular_packs INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, pack_slot INTEGER NOT NULL, quintile INTEGER NOT NULL, batch INTEGER NOT NULL, dna TEXT)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS inventory_pack ON inventory(pack_slot)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS pack_choices (anchor TEXT PRIMARY KEY)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS bench_state (id INTEGER PRIMARY KEY, done INTEGER NOT NULL)');
  }

  query(statement, ...bindings) {
    const cursor = this.sql.exec(statement, ...bindings);
    const rows = cursor.toArray();
    if (!Number.isFinite(cursor.rowsRead)) throw new Error('Cloudflare SQLite rowsRead metric unavailable');
    return { rows, reads: cursor.rowsRead, writes: cursor.rowsWritten };
  }

  seedUser(owner, total, offset) {
    for (let start = 0; start < total; start += 400) {
      const end = Math.min(400, total - start);
      this.sql.exec(
        "WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i < ?) " +
        "INSERT INTO issued (id, serial, owner, request, issued_at, certificate, favorite) " +
        "SELECT ? || ':' || CAST(? + i AS TEXT), printf('%012d', ? + i), ?, " +
        "'request-' || CAST((? + i) / 5 AS INTEGER), " +
        "1700000000 + CAST((? + i) / 5 AS INTEGER), " +
        "CASE WHEN (? + i) % 67 = 0 THEN NULL ELSE 'signed-certificate' END, 0 FROM seq",
        end - 1, owner, start, offset + start, owner, start, start, start
      ).toArray();
    }
    this.sql.exec('INSERT OR REPLACE INTO mint_account_counts (owner, regular_packs) VALUES (?, ?)', owner, total / 5);
  }

  seedInventory(total) {
    for (let start = 0; start < total; start += 400) {
      const end = Math.min(400, total - start);
      this.sql.exec(
        "WITH RECURSIVE seq(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM seq WHERE i < ?) " +
        "INSERT INTO inventory (id, pack_slot, quintile, batch, dna) " +
        "SELECT 'item-' || CAST(? + i AS TEXT), CAST((? + i) / 5 AS INTEGER), " +
        "((? + i) % 5) + 1, 1 + CAST((? + i) / 1000 AS INTEGER), 'dna' FROM seq",
        end - 1, start, start, start, start
      ).toArray();
    }
  }

  async seed(data) {
    if (this.sql.exec('SELECT done FROM bench_state WHERE id=1').toArray().length) throw new Error('Benchmark object already seeded');
    const counts = data.rows;
    if (!Array.isArray(counts) || counts.length !== 2 || counts.some(n => !Number.isInteger(n) || n < 0 || n > 25000 || n % 5)) throw new Error('Invalid row counts');
    this.seedUser(USERS[0], counts[0], 0);
    this.seedUser(USERS[1], counts[1], 100000000);
    this.seedInventory(data.inventory || 0);
    if (data.mode === 'after') this.sql.exec('CREATE INDEX inventory_offer_lookup ON inventory(quintile, batch, pack_slot)');
    this.sql.exec('INSERT INTO bench_state VALUES (1, 1)');
    return { ok: true, rows: counts };
  }

  loadCollection(mode, owner) {
    let after = '', reads = 0, pages = 0, total = 0, hash = 2166136261 >>> 0;
    while (true) {
      let page;
      if (mode === 'before') {
        let binds = [owner], condition = '';
        if (after) {
          const anchor = this.query('SELECT * FROM issued WHERE owner=? AND serial=?', owner, after);
          reads += anchor.reads;
          if (!anchor.rows.length) throw new Error('Baseline cursor missing');
          const row = anchor.rows[0], state = Number(row.certificate === null);
          const keys = [['(certificate IS NULL)', 'ASC', state], ['issued_at', 'DESC', row.issued_at], ['serial', 'DESC', row.serial]];
          const parts = keys.map((key, i) => {
            const terms = [];
            for (let j = 0; j < i; j++) { terms.push(keys[j][0] + '=?'); binds.push(keys[j][2]); }
            terms.push(key[0] + (key[1] === 'ASC' ? '>?' : '<?'));
            binds.push(key[2]);
            return '(' + terms.join(' AND ') + ')';
          });
          condition = ' AND (' + parts.join(' OR ') + ')';
        }
        page = this.query('SELECT serial, certificate, favorite FROM issued WHERE owner=?' + condition +
          ' ORDER BY (certificate IS NULL) ASC, issued_at DESC, serial DESC LIMIT 201', ...binds);
        reads += page.reads;
      } else {
        if (!after) {
          page = this.query('SELECT serial, certificate, favorite FROM issued WHERE owner=? ' +
            'ORDER BY (certificate IS NULL) ASC, issued_at DESC, serial DESC LIMIT 201', owner);
          reads += page.reads;
        } else {
          const anchor = this.query('SELECT serial, issued_at, certificate FROM issued WHERE owner=? AND serial=?', owner, after);
          reads += anchor.reads;
          if (!anchor.rows.length) throw new Error('Optimized cursor missing');
          const row = anchor.rows[0], pending = Number(row.certificate === null);
          page = this.query('SELECT serial, certificate, favorite FROM issued ' +
            'WHERE owner=? AND (certificate IS NULL)=? AND (issued_at, serial) < (?, ?) ' +
            'ORDER BY issued_at DESC, serial DESC LIMIT 201', owner, pending, row.issued_at, row.serial);
          reads += page.reads;
          if (!pending && page.rows.length < 201) {
            const rest = this.query('SELECT serial, certificate, favorite FROM issued WHERE owner=? ' +
              'AND (certificate IS NULL)=1 ORDER BY issued_at DESC, serial DESC LIMIT ?', owner, 201 - page.rows.length);
            reads += rest.reads;
            page.rows.push(...rest.rows);
          }
        }
      }
      pages++;
      const values = page.rows.slice(0, PAGE);
      for (const value of values) {
        total++;
        hash = Math.imul(hash ^ Number(value.serial.slice(-7)), 16777619) >>> 0;
        hash = Math.imul(hash ^ Number(value.certificate === null), 16777619) >>> 0;
      }
      if (page.rows.length <= PAGE) break;
      after = values[values.length - 1].serial;
      if (pages > 150) throw new Error('Pagination did not terminate');
    }
    return { reads, pages, total, hash };
  }

  checkAllowance(mode, owner) {
    return mode === 'before'
      ? this.query("SELECT COUNT(DISTINCT request) AS count FROM issued WHERE owner=? AND request NOT LIKE 'starter:%'", owner)
      : this.query('SELECT regular_packs AS count FROM mint_account_counts WHERE owner=?', owner);
  }

  allocatePack(mode, owner, ordinal) {
    const baseline = mode === 'before';
    let reads = 0;
    // Mirrors the two allowance checks in offer() and issue(), preserving the repeated histories.
    for (let k = 0; k < 2; k++) reads += this.checkAllowance(mode, owner).reads;
    for (let slot = 0; slot < 5; slot++) {
      const n = ordinal * 5 + slot;
      const serial = String((owner === USERS[0] ? 50000000 : 150000000) + n).padStart(12, '0');
      reads += this.query('INSERT INTO issued (id, serial, owner, request, issued_at, certificate, favorite) ' +
        'VALUES (?, ?, ?, ?, ?, ?, 0)', 'mint:' + owner + ':' + n, serial, owner,
        'new-pack-' + ordinal, 1800000000 + ordinal, 'signed-certificate').reads;
    }
    if (!baseline) reads += this.query('UPDATE mint_account_counts SET regular_packs=regular_packs+1 WHERE owner=?', owner).reads;
    return reads;
  }

  selectPack() {
    let reads = 0;
    const oldest = this.query('SELECT batch FROM inventory WHERE quintile=1 AND pack_slot>=0 ' +
      'AND NOT EXISTS (SELECT 1 FROM pack_choices WHERE anchor=inventory.id) ORDER BY batch ASC LIMIT 1');
    reads += oldest.reads;
    if (!oldest.rows.length) throw new Error('Insufficient inventory for selection');
    const where = 'quintile=1 AND pack_slot>=0 AND batch=? AND NOT EXISTS (SELECT 1 FROM pack_choices WHERE anchor=inventory.id)';
    const size = this.query('SELECT COUNT(*) AS count FROM inventory WHERE ' + where, oldest.rows[0].batch);
    reads += size.reads;
    const chosen = this.query('SELECT id, pack_slot FROM inventory WHERE ' + where +
      ' ORDER BY pack_slot LIMIT 1 OFFSET ?', oldest.rows[0].batch, Math.floor(size.rows[0].count / 2));
    reads += chosen.reads;
    if (!chosen.rows.length) throw new Error('No selected inventory item');
    reads += this.query('INSERT INTO pack_choices (anchor) VALUES (?)', chosen.rows[0].id).reads;
    return reads;
  }

  async run(data) {
    const mode = data.mode, kind = data.kind, count = data.count;
    if (!['before', 'after'].includes(mode) || !['collection', 'offers', 'mints', 'inventory'].includes(kind) ||
      !Number.isInteger(count) || count < 1 || count > 100) throw new Error('Invalid benchmark workload');
    const owner = USERS[data.user || 0];
    if (!owner) throw new Error('Invalid owner');
    let reads = 0, pages = 0, returned = 0, hash = null;
    for (let i = 0; i < count; i++) {
      if (kind === 'collection') {
        const result = this.loadCollection(mode, owner);
        reads += result.reads;
        pages += result.pages;
        returned += result.total;
        if (hash !== null && hash !== result.hash) throw new Error('Collection order changed across identical reloads');
        hash = result.hash;
      } else if (kind === 'offers') {
        reads += this.checkAllowance(mode, owner).reads;
      } else if (kind === 'mints') {
        if (!Number.isInteger(data.start)) throw new Error('Missing mint offset');
        reads += this.allocatePack(mode, owner, data.start + i);
      } else {
        reads += this.selectPack();
      }
    }
    return { reads, pages, returned, hash };
  }

  async fetch(request) {
    try {
      const body = await request.json();
      return Response.json(body.op === 'seed' ? await this.seed(body) : await this.run(body));
    } catch (error) {
      return Response.json({ error: String(error?.stack || error) }, { status: 500 });
    }
  }
}

export default {
  fetch(request, env) {
    const name = new URL(request.url).searchParams.get('scenario');
    if (!name || !/^[a-z0-9-]{1,90}$/.test(name)) return new Response('Invalid scenario', { status: 400 });
    return env.BENCH.get(env.BENCH.idFromName(name)).fetch(request);
  }
};
