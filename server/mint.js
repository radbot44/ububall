'use strict';
const { sign } = require('../shared/ubu-file.js');
const { decode, fromCode } = require('../shared/ubu.js');
const { scoreRarity } = require('../shared/rarity.js');

const MAX_SERIAL = 999999999999;
const DEFAULT_BATCH_SIZE = 1000;
const PACK_SIZE = 5;

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

function issuanceRequest(owner, request, lifetimeLimit) {
  if (typeof owner !== 'string' || !/^[1-9][0-9]{0,19}$/.test(owner) ||
      typeof request !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(request)) throw new Error('Invalid issuance request.');
  if (lifetimeLimit !== undefined && (!Number.isSafeInteger(lifetimeLimit) || lifetimeLimit < 0)) throw new Error('Invalid lifetime limit.');
}

// A pack's wrapper comes from its random choice token, so each pack is independently random yet
// stays the same when an offer is shown again. Summing the 6-bit digits keeps the bias negligible.
const PACK_TYPES = ['plastic', 'foil', 'blob', 'gumball', 'egg', 'gift', 'cookie', 'envelope'];
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const packType = token => PACK_TYPES[[...token].reduce((sum, digit) => sum + BASE64URL.indexOf(digit), 0) % PACK_TYPES.length];

function randomBelow(size) {
  const limit = 4294967296 - (4294967296 % size);
  let roll;
  do { roll = crypto.getRandomValues(new Uint32Array(1))[0]; } while (roll >= limit);
  return roll % size;
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

      // Seamless migration from pre-pack single-ubu schema
      const hasInventory = this.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory'").length > 0;
      if (hasInventory) {
        const invCols = this.exec('PRAGMA table_info(inventory)').map(c => c.name);
        if (!invCols.includes('pack_slot')) {
          this.exec('DROP TABLE inventory');
          const state = this.exec('SELECT * FROM mint_state WHERE singleton=1')[0];
          if (state && (state.remaining > 0 || state.prepared < state.size)) {
            this.exec('UPDATE mint_state SET prepared=size, remaining=0 WHERE singleton=1');
          }
        }
      }

      this.exec(`CREATE TABLE IF NOT EXISTS inventory (
        pack_slot INTEGER NOT NULL, quintile INTEGER NOT NULL, id TEXT NOT NULL UNIQUE, serial TEXT NOT NULL UNIQUE, dna TEXT NOT NULL) STRICT`);
      this.exec('CREATE INDEX IF NOT EXISTS inventory_pack ON inventory(pack_slot)');

      const hasIssued = this.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='issued'").length > 0;
      if (hasIssued) {
        const issuedCols = this.exec('PRAGMA table_info(issued)').map(c => c.name);
        if (!issuedCols.includes('pack_id')) {
          this.exec(`CREATE TABLE issued_new (
            id TEXT PRIMARY KEY, serial TEXT NOT NULL UNIQUE, dna TEXT NOT NULL,
            batch INTEGER NOT NULL, owner TEXT NOT NULL, revision INTEGER NOT NULL,
            request TEXT NOT NULL, pack_id TEXT NOT NULL, quintile INTEGER NOT NULL,
            issued_at INTEGER NOT NULL, key TEXT NOT NULL,
            certificate TEXT, UNIQUE(owner, request, id)) STRICT`);
          this.exec(`INSERT INTO issued_new (id, serial, dna, batch, owner, revision, request, pack_id, quintile, issued_at, key, certificate)
            SELECT id, serial, dna, batch, owner, revision, request, request, 0, issued_at, key, certificate FROM issued`);
          this.exec('DROP TABLE issued');
          this.exec('ALTER TABLE issued_new RENAME TO issued');
        }
      } else {
        this.exec(`CREATE TABLE IF NOT EXISTS issued (
          id TEXT PRIMARY KEY, serial TEXT NOT NULL UNIQUE, dna TEXT NOT NULL,
          batch INTEGER NOT NULL, owner TEXT NOT NULL, revision INTEGER NOT NULL,
          request TEXT NOT NULL, pack_id TEXT NOT NULL, quintile INTEGER NOT NULL,
          issued_at INTEGER NOT NULL, key TEXT NOT NULL,
          certificate TEXT, UNIQUE(owner, request, id)) STRICT`);
      }

      // Add account-scoped favorites without touching certificates. ALTER is transactional and
      // safe on an existing Durable Object or local SQLite database.
      const columns = this.exec('PRAGMA table_info(issued)').map(column => column.name);
      if (!columns.includes('favorite')) this.exec('ALTER TABLE issued ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK(favorite IN (0,1))');
      // Browsers sort collections themselves; drop the retired server sort keys and their indexes.
      for (const index of ['issued_old_sort', 'issued_rarity_sort', 'issued_serial_sort', 'issued_favorite_sort', 'issued_rarity_backfill']) {
        this.exec('DROP INDEX IF EXISTS ' + index);
      }
      if (columns.includes('rarity_bits')) this.exec('ALTER TABLE issued DROP COLUMN rarity_bits');
      this.exec('DROP TABLE IF EXISTS rarity_revision');
      this.exec('CREATE INDEX IF NOT EXISTS issued_recent_sort ON issued(owner, (certificate IS NULL), issued_at DESC, serial DESC)');
      this.exec('CREATE INDEX IF NOT EXISTS issued_owner ON issued(owner)');
      this.exec('CREATE INDEX IF NOT EXISTS issued_request ON issued(owner, request)');
      this.exec('INSERT OR IGNORE INTO mint_state VALUES (1, ?, 1, 0, 0, 0, 0, 0)', mint);
      if (this.state().mint !== mint) throw new Error('Database belongs to another mint.');
      if (!this.exec('PRAGMA table_info(inventory)').some(c => c.name === 'batch')) {
        this.exec('ALTER TABLE inventory ADD COLUMN batch INTEGER NOT NULL DEFAULT 0');
        this.exec('UPDATE inventory SET batch=?', this.state().batch);
      }
      this.exec(`CREATE TABLE IF NOT EXISTS pack_offers (
        owner TEXT PRIMARY KEY, request TEXT NOT NULL, expires INTEGER NOT NULL) STRICT`);
      this.exec(`CREATE TABLE IF NOT EXISTS pack_choices (
        token TEXT PRIMARY KEY, owner TEXT NOT NULL, position INTEGER NOT NULL,
        anchor TEXT NOT NULL UNIQUE, UNIQUE(owner, position)) STRICT`);
      this.exec(`CREATE TABLE IF NOT EXISTS pack_selections (
        owner TEXT NOT NULL, request TEXT NOT NULL, choice TEXT NOT NULL, PRIMARY KEY(owner, request)) STRICT`);
    });
  }
  exec(sql, ...bindings) { return Array.from(this.storage.exec(sql, ...bindings)); }
  transaction(callback) { return this.storage.transactionSync(callback); }
  state() { return this.exec('SELECT * FROM mint_state WHERE singleton=1')[0]; }
  // Each call commits one bounded chunk; an interrupted batch resumes on the next call.
  prepare({ batchSize = DEFAULT_BATCH_SIZE, chunkSize = 100, minimumPacks = 1 } = {}) {
    integer(batchSize, 1000000, 'batch size');
    if (batchSize % PACK_SIZE !== 0) throw new Error('Batch size must be a multiple of 5.');
    integer(chunkSize, 1000, 'chunk size');
    integer(minimumPacks, 3, 'minimum pack inventory');
    return this.transaction(() => {
      let state = this.state();
      if (state.prepared === state.size) {
        if (state.remaining >= minimumPacks) return state;
        if (state.next_serial + batchSize - 1 > MAX_SERIAL) throw new Error('Serial range exhausted.');
        this.exec(`UPDATE mint_state SET batch=batch+1, size=?, prepared=0,
          start_serial=next_serial, next_serial=next_serial+? WHERE singleton=1`, batchSize, batchSize);
        state = this.state();
      }
      const end = Math.min(state.size, state.prepared + chunkSize);
      for (let slot = state.prepared; slot < end; slot++) {
        let id;
        do { id = randomCode(16); } while (this.exec('SELECT id FROM inventory WHERE id=? UNION ALL SELECT id FROM issued WHERE id=?', id, id).length);
        this.exec('INSERT INTO inventory (pack_slot, quintile, id, serial, dna, batch) VALUES (-1, 0, ?, ?, ?, ?)', id,
          String(state.start_serial + slot).padStart(12, '0'), randomCode(128), state.batch);
      }
      if (end === state.size) {
        // Sort entire batch into 5 rarity quintiles and assemble packs
        const rows = this.exec('SELECT id, dna FROM inventory WHERE pack_slot = -1');
        const scored = rows.map(r => ({
          id: r.id,
          bits: scoreRarity(decode(fromCode(r.dna))).bits
        }));
        scored.sort((a, b) => a.bits - b.bits || a.id.localeCompare(b.id));
        const numPacks = state.size / PACK_SIZE;
        const quintiles = [];
        for (let q = 0; q < PACK_SIZE; q++) {
          const slice = scored.slice(q * numPacks, (q + 1) * numPacks);
          for (let i = slice.length - 1; i > 0; i--) {
            const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
            const temp = slice[i]; slice[i] = slice[j]; slice[j] = temp;
          }
          quintiles.push(slice);
        }
        for (let p = 0; p < numPacks; p++) {
          for (let q = 0; q < PACK_SIZE; q++) {
            this.exec('UPDATE inventory SET pack_slot=?, quintile=? WHERE id=?', state.remaining + p, q + 1, quintiles[q][p].id);
          }
        }
        this.exec('UPDATE mint_state SET prepared=?, remaining=remaining+? WHERE singleton=1', state.size, numPacks);
      } else {
        this.exec('UPDATE mint_state SET prepared=? WHERE singleton=1', end);
      }
      return this.state();
    });
  }

  checkAllowance(owner, lifetimeLimit) {
    if (lifetimeLimit !== undefined && this.exec('SELECT COUNT(DISTINCT request) AS count FROM issued WHERE owner=?', owner)[0].count >= lifetimeLimit) {
      throw new Error('Lifetime mint limit reached.');
    }
  }
  expireOffers() {
    const now = Math.floor(Date.now() / 1000);
    this.exec('DELETE FROM pack_choices WHERE owner IN (SELECT owner FROM pack_offers WHERE expires<=?)', now);
    this.exec('DELETE FROM pack_offers WHERE expires<=?', now);
  }
  availablePack() {
    const where = 'quintile=1 AND pack_slot>=0 AND NOT EXISTS (SELECT 1 FROM pack_choices WHERE anchor=inventory.id)';
    const size = this.exec('SELECT COUNT(*) AS count FROM inventory WHERE ' + where)[0].count;
    if (!size) throw new Error('Pack choices unavailable.');
    return this.exec('SELECT id, pack_slot FROM inventory WHERE ' + where + ' ORDER BY pack_slot LIMIT 1 OFFSET ?', randomBelow(size))[0];
  }
  offer({ owner, request }, { lifetimeLimit } = {}) {
    issuanceRequest(owner, request, lifetimeLimit);
    return this.transaction(() => {
      if (this.exec('SELECT 1 FROM issued WHERE owner=? AND request=? LIMIT 1', owner, request).length) return { request, completed: true };
      this.checkAllowance(owner, lifetimeLimit);
      this.expireOffers();
      let offer = this.exec('SELECT * FROM pack_offers WHERE owner=?', owner)[0];
      if (!offer) {
        if (this.state().remaining < 3) throw new Error('Batch preparation required.');
        offer = { owner, request, expires: Math.floor(Date.now() / 1000) + 86400 };
        this.exec('INSERT INTO pack_offers VALUES (?, ?, ?)', owner, request, offer.expires);
        for (let i = 0; i < 3; i++) {
          const pack = this.availablePack();
          this.exec('INSERT INTO pack_choices VALUES (?, ?, ?, ?)', randomCode(16), owner, i, pack.id);
        }
      }
      const choices = this.exec('SELECT * FROM pack_choices WHERE owner=? ORDER BY position', owner).map(choice => {
        const items = this.exec('SELECT dna FROM inventory WHERE pack_slot=(SELECT pack_slot FROM inventory WHERE id=?) ORDER BY quintile', choice.anchor);
        return { choice: choice.token, type: packType(choice.token), hints: items.map(item => {
          const attributes = decode(fromCode(item.dna)).attributes;
          return {
            background: attributes.background.hex,
            accents: ['eyes', 'irises', 'pupils', 'mouth'].map(role => attributes[role].hex),
            textured: Object.values(attributes).some(attribute => Boolean(attribute.texture))
          };
        }) };
      });
      return { request: offer.request, expires: offer.expires, choices };
    });
  }

  async issue({ owner, request, choice }, { lifetimeLimit } = {}) {
    // owner is an authenticated Discord snowflake supplied by trusted server code.
    issuanceRequest(owner, request, lifetimeLimit);
    if (choice !== undefined && !identity(choice)) throw new Error('Invalid pack choice.');

    const records = this.transaction(() => {
      const previous = this.exec('SELECT * FROM issued WHERE owner=? AND request=? ORDER BY quintile', owner, request);
      if (previous.length > 0) {
        if (choice !== undefined && this.exec('SELECT choice FROM pack_selections WHERE owner=? AND request=?', owner, request)[0]?.choice !== choice) throw new Error('A different pack was already selected.');
        return previous;
      }
      this.checkAllowance(owner, lifetimeLimit);
      this.expireOffers();
      const state = this.state();
      let chosenPack;
      if (choice !== undefined) {
        const selected = this.exec(`SELECT inventory.pack_slot FROM pack_choices
          JOIN pack_offers USING(owner) JOIN inventory ON inventory.id=pack_choices.anchor
          WHERE pack_choices.owner=? AND pack_offers.request=? AND token=?`, owner, request, choice)[0];
        if (!selected) throw new Error('Pack choice expired or unavailable.');
        chosenPack = selected.pack_slot;
      } else {
        if (!state.size || !state.remaining) throw new Error('Batch preparation required.');
        chosenPack = this.availablePack().pack_slot;
      }

      const packItems = this.exec('SELECT * FROM inventory WHERE pack_slot=? ORDER BY quintile', chosenPack);
      const issuedAt = Math.floor(Date.now() / 1000);
      const packId = randomCode(16);

      for (const item of packItems) {
        this.exec(`INSERT INTO issued
          (id, serial, dna, batch, owner, revision, request, pack_id, quintile, issued_at, key, certificate, favorite)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, 0)`,
          item.id, item.serial, item.dna, item.batch, owner, request, packId, item.quintile, issuedAt, this.key);
      }

      this.exec('DELETE FROM inventory WHERE pack_slot=?', chosenPack);
      if (chosenPack !== state.remaining - 1) {
        this.exec('UPDATE inventory SET pack_slot=? WHERE pack_slot=?', chosenPack, state.remaining - 1);
      }
      this.exec('UPDATE mint_state SET remaining=remaining-1 WHERE singleton=1');
      if (choice !== undefined) {
        this.exec('INSERT INTO pack_selections VALUES (?, ?, ?)', owner, request, choice);
        this.exec('DELETE FROM pack_choices WHERE owner=?', owner);
        this.exec('DELETE FROM pack_offers WHERE owner=?', owner);
      }
      return this.exec('SELECT * FROM issued WHERE owner=? AND request=? ORDER BY quintile', owner, request);
    });

    const certificates = [];
    for (const record of records) {
      if (record.certificate) {
        certificates.push(record.certificate);
      } else {
        const privateKey = await this.resolveSigningKey(record.key);
        const cert = await sign({
          mint: this.mint, id: record.id, serial: record.serial,
          dna: record.dna, issuedAt: record.issued_at, key: record.key
        }, privateKey);
        this.transaction(() => {
          this.exec('UPDATE issued SET certificate=? WHERE id=? AND certificate IS NULL', cert, record.id);
        });
        certificates.push(cert);
      }
    }
    return { certificates };
  }
}

module.exports = { Mint, DEFAULT_BATCH_SIZE, PACK_SIZE };
