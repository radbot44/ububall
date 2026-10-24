'use strict';
const { sign } = require('./ubu-file.js');
const MAX_SERIAL = 999999999999;
const DEFAULT_BATCH_SIZE = 1000;
const randomCode = size => {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
function integer(value, max, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${label}.`);
}
function identity(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(value);
}

// Internal service only. The caller must authenticate and authorize every issuance.
// storage supplies synchronous exec(sql, ...bindings) and transactionSync(callback).
class Mint {
  constructor(storage, { mint, key, resolveSigningKey }) {
    if (!identity(mint) || typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(key) || typeof resolveSigningKey !== 'function') throw new Error('Invalid mint configuration.');
    this.storage = storage;
    this.mint = mint;
    this.key = key;
    this.resolveSigningKey = resolveSigningKey;
    this.transaction(() => {
      this.exec(`CREATE TABLE IF NOT EXISTS mint_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), mint TEXT NOT NULL,
        next_serial INTEGER NOT NULL, batch INTEGER NOT NULL, size INTEGER NOT NULL,
        prepared INTEGER NOT NULL, remaining INTEGER NOT NULL, start_serial INTEGER NOT NULL) STRICT`);
      this.exec(`CREATE TABLE IF NOT EXISTS inventory (
        slot INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, serial TEXT NOT NULL UNIQUE, dna TEXT NOT NULL) STRICT`);
      this.exec(`CREATE TABLE IF NOT EXISTS issued (
        id TEXT PRIMARY KEY, serial TEXT NOT NULL UNIQUE, dna TEXT NOT NULL,
        batch INTEGER NOT NULL, owner TEXT NOT NULL, revision INTEGER NOT NULL,
        request TEXT NOT NULL, issued_at INTEGER NOT NULL, key TEXT NOT NULL,
        certificate TEXT, UNIQUE(owner, request)) STRICT`);
      this.exec('CREATE INDEX IF NOT EXISTS issued_owner ON issued(owner)');
      this.exec('INSERT OR IGNORE INTO mint_state VALUES (1, ?, 1, 0, 0, 0, 0, 0)', mint);
      if (this.state().mint !== mint) throw new Error('Database belongs to another mint.');
    });
  }
  exec(sql, ...bindings) { return Array.from(this.storage.exec(sql, ...bindings)); }
  transaction(callback) { return this.storage.transactionSync(callback); }
  state() { return this.exec('SELECT * FROM mint_state WHERE singleton=1')[0]; }

  // Each call commits one bounded chunk; an interrupted batch resumes on the next call.
  prepare({ batchSize = DEFAULT_BATCH_SIZE, chunkSize = 100 } = {}) {
    integer(batchSize, 1000000, 'batch size');
    integer(chunkSize, 1000, 'chunk size');
    return this.transaction(() => {
      let state = this.state();
      if (state.prepared === state.size) {
        if (state.remaining) return state;
        if (state.next_serial + batchSize - 1 > MAX_SERIAL) throw new Error('Serial range exhausted.');
        this.exec(`UPDATE mint_state SET batch=batch+1, size=?, prepared=0,
          remaining=0, start_serial=next_serial, next_serial=next_serial+? WHERE singleton=1`, batchSize, batchSize);
        state = this.state();
      }
      const end = Math.min(state.size, state.prepared + chunkSize);
      for (let slot = state.prepared; slot < end; slot++) {
        let id;
        do { id = randomCode(16); } while (this.exec('SELECT id FROM inventory WHERE id=? UNION ALL SELECT id FROM issued WHERE id=?', id, id).length);
        this.exec('INSERT INTO inventory VALUES (?, ?, ?, ?)', slot, id,
          String(state.start_serial + slot).padStart(12, '0'), randomCode(32));
      }
      this.exec('UPDATE mint_state SET prepared=?, remaining=? WHERE singleton=1', end, end);
      return this.state();
    });
  }

  async issue({ owner, request }, { lifetimeLimit } = {}) {
    // owner is an authenticated Discord snowflake supplied by trusted server code.
    if (typeof owner !== 'string' || !/^[1-9][0-9]{0,19}$/.test(owner) ||
        typeof request !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(request)) throw new Error('Invalid issuance request.');
    if (lifetimeLimit !== undefined && (!Number.isSafeInteger(lifetimeLimit) || lifetimeLimit < 0)) throw new Error('Invalid lifetime limit.');
    const record = this.transaction(() => {
      const previous = this.exec('SELECT * FROM issued WHERE owner=? AND request=?', owner, request)[0];
      if (previous) return previous;
      if (lifetimeLimit !== undefined && this.exec('SELECT COUNT(*) AS count FROM issued WHERE owner=?', owner)[0].count >= lifetimeLimit) {
        throw new Error('Lifetime mint limit reached.');
      }
      const state = this.state();
      if (!state.size || state.prepared !== state.size || !state.remaining) throw new Error('Batch preparation required.');
      // Rejection sampling avoids modulo bias, including non-power-of-two pool sizes.
      const limit = 4294967296 - 4294967296 % state.remaining;
      let roll;
      do { roll = crypto.getRandomValues(new Uint32Array(1))[0]; } while (roll >= limit);
      const slot = roll % state.remaining;
      const selected = this.exec('SELECT * FROM inventory WHERE slot=?', slot)[0];
      const issuedAt = Math.floor(Date.now() / 1000);
      this.exec(`INSERT INTO issued VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)`,
        selected.id, selected.serial, selected.dna, state.batch, owner, request, issuedAt, this.key);
      this.exec('DELETE FROM inventory WHERE slot=?', slot);
      if (slot !== state.remaining - 1) this.exec('UPDATE inventory SET slot=? WHERE slot=?', slot, state.remaining - 1);
      this.exec('UPDATE mint_state SET remaining=remaining-1 WHERE singleton=1');
      return this.exec('SELECT * FROM issued WHERE id=?', selected.id)[0];
    });
    if (record.certificate) return record.certificate;
    const privateKey = await this.resolveSigningKey(record.key);
    const certificate = await sign({ mint: this.mint, id: record.id, serial: record.serial,
      dna: record.dna, issuedAt: record.issued_at, key: record.key }, privateKey);
    return this.transaction(() => {
      this.exec('UPDATE issued SET certificate=? WHERE id=? AND certificate IS NULL', certificate, record.id);
      return this.exec('SELECT certificate FROM issued WHERE id=?', record.id)[0].certificate;
    });
  }
}
module.exports = { Mint, DEFAULT_BATCH_SIZE };
