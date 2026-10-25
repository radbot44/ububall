'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Worker } = require('node:worker_threads');
const { Mint, DEFAULT_BATCH_SIZE, PACK_SIZE } = require('./mint.js');
const { openStorage } = require('./mint-local.js');
const file = require('./ubu-file.js');
const ubu = require('./ubu.js');
const rarity = require('./rarity.js');

const mintID = 'A'.repeat(22);
const owner = '123456789012345678';
const request = n => `request_${String(n).padStart(12, '0')}`;

test('pack hints are stable, private, and exactly match the selected issuance', async t => {
  const f = await fixture(t), mint = new Mint(f.open(), f.options);
  mint.prepare({ batchSize: 30 });
  const offered = mint.offer({ owner, request: request(1) }, { lifetimeLimit: 1 });
  assert.equal(offered.choices.length, 3);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM issued')[0].n, 0);
  assert.equal(mint.state().remaining, 6);
  assert.deepEqual(mint.offer({ owner, request: request(2) }, { lifetimeLimit: 1 }), offered);
  const reopened = new Mint(f.open(), f.options);
  assert.deepEqual(reopened.offer({ owner, request: request(3) }, { lifetimeLimit: 1 }), offered);
  for (const option of offered.choices) {
    assert.deepEqual(Object.keys(option).sort(), ['choice', 'hints', 'type']);
    assert.equal(option.hints.length, 5);
    for (const hint of option.hints) assert.deepEqual(Object.keys(hint).sort(), ['accents', 'background', 'textured']);
  }
  const chosen = offered.choices[1];
  const issued = await reopened.issue({ owner, request: offered.request, choice: chosen.choice }, { lifetimeLimit: 1 });
  for (let i = 0; i < 5; i++) {
    const verified = await file.read(issued.certificates[i], { resolveKey: () => f.keys.publicKey });
    const attrs = ubu.decode(ubu.fromCode(verified.dna)).attributes;
    assert.deepEqual(chosen.hints[i], { background: attrs.background.hex,
      accents: ['eyes', 'irises', 'pupils', 'mouth'].map(role => attrs[role].hex),
      textured: Object.values(attrs).some(a => Boolean(a.texture)) });
  }
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM pack_choices')[0].n, 0);
  assert.equal(mint.state().remaining, 5);
  assert.deepEqual(await mint.issue({ owner, request: offered.request, choice: chosen.choice }, { lifetimeLimit: 0 }), issued);
  assert.deepEqual(mint.offer({ owner, request: offered.request }, { lifetimeLimit: 0 }), { request: offered.request, completed: true });
  assert.throws(() => mint.offer({ owner, request: request(2) }, { lifetimeLimit: 1 }), /limit reached/);
  await assert.rejects(mint.issue({ owner, request: offered.request, choice: offered.choices[0].choice }), /already selected/);
});

test('reservations exclude other owners, survive slot swaps, expire, and cannot be forged', async t => {
  const f = await fixture(t), mint = new Mint(f.open(), f.options), other = '234567890123456789';
  mint.prepare({ batchSize: 30 });
  const first = mint.offer({ owner, request: request(1) });
  const second = mint.offer({ owner: other, request: request(1) });
  assert.equal(mint.exec('SELECT COUNT(DISTINCT anchor) AS n FROM pack_choices')[0].n, 6);
  await assert.rejects(mint.issue({ owner: other, request: second.request, choice: first.choices[0].choice }), /unavailable/);
  await assert.rejects(mint.issue({ owner, request: request(9), choice: first.choices[0].choice }), /unavailable/);
  assert.throws(() => mint.offer({ owner: '345678901234567890', request: request(1) }), /unavailable/);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM pack_offers')[0].n, 2);
  await mint.issue({ owner, request: first.request, choice: first.choices[0].choice });
  assert.deepEqual(mint.offer({ owner: other, request: request(2) }), second);
  mint.exec('UPDATE pack_offers SET expires=0 WHERE owner=?', other);
  await assert.rejects(mint.issue({ owner: other, request: second.request, choice: second.choices[0].choice }), /expired/);
  const renewed = mint.offer({ owner: other, request: request(2) });
  assert.notEqual(renewed.choices[0].choice, second.choices[0].choice);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM issued')[0].n, 5);
});

test('choice allocation rolls back atomically and signing failures recover without choosing twice', async t => {
  const f = await fixture(t), storage = f.open();
  let failing = true;
  const mint = new Mint(storage, { ...f.options, resolveSigningKey: () => { if (failing) throw new Error('signing failed'); return f.keys.privateKey; } });
  mint.prepare({ batchSize: 20 });
  const offer = mint.offer({ owner, request: request(1) });
  storage.exec("CREATE TRIGGER fail_choice BEFORE INSERT ON pack_selections BEGIN SELECT RAISE(ABORT, 'selection failure'); END");
  const selection = { owner, request: offer.request, choice: offer.choices[0].choice };
  await assert.rejects(mint.issue(selection), /selection failure/);
  assert.equal(mint.state().remaining, 4);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM issued')[0].n, 0);
  assert.deepEqual(mint.offer({ owner, request: request(2) }), offer);
  storage.exec('DROP TRIGGER fail_choice');
  await assert.rejects(mint.issue(selection), /signing failed/);
  assert.equal(mint.state().remaining, 3);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM pack_choices')[0].n, 0);
  failing = false;
  const retry = await mint.issue(selection, { lifetimeLimit: 0 });
  assert.equal(retry.certificates.length, 5);
  assert.equal(mint.state().remaining, 3);
});

test('concurrent different choices grant only one pack and later requests cannot bypass allowance', async t => {
  const f = await fixture(t), mint = new Mint(f.open(), f.options);
  mint.prepare({ batchSize: 30 });
  const offer = mint.offer({ owner, request: request(1) }, { lifetimeLimit: 1 });
  const results = await Promise.allSettled(offer.choices.map(option => new Mint(f.open(), f.options).issue({ owner, request: offer.request, choice: option.choice }, { lifetimeLimit: 1 })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM issued')[0].n, 5);
  assert.throws(() => mint.offer({ owner, request: request(2) }, { lifetimeLimit: 1 }), /limit reached/);
});

test('refilling a short inventory preserves leftover packs, batch identity and active reservations', async t => {
  const f = await fixture(t), mint = new Mint(f.open(), f.options);
  mint.prepare({ batchSize: 15 });
  const first = mint.offer({ owner, request: request(1) });
  await mint.issue({ owner, request: first.request, choice: first.choices[0].choice });
  const leftovers = mint.exec('SELECT * FROM inventory ORDER BY id');
  mint.prepare({ batchSize: 10, chunkSize: 3, minimumPacks: 3 });
  assert.equal(mint.state().remaining, 2);
  mint.prepare({ batchSize: 10, minimumPacks: 3 });
  assert.equal(mint.state().remaining, 4);
  for (const item of leftovers) assert.deepEqual(mint.exec('SELECT * FROM inventory WHERE id=?', item.id)[0], item);
  const offer = mint.offer({ owner, request: request(2) });
  const option = offer.choices.find(c => mint.exec('SELECT batch FROM inventory WHERE id=(SELECT anchor FROM pack_choices WHERE token=?)', c.choice)[0].batch === 1);
  assert.ok(option);
  await mint.issue({ owner, request: offer.request, choice: option.choice });
  assert.ok(mint.exec('SELECT batch FROM issued WHERE request=?', offer.request).every(r => r.batch === 1));
});

test('existing pack inventory upgrades without replacement and hints disclose only texture presence', async t => {
  const f = await fixture(t), storage = f.open();
  let mint = new Mint(storage, f.options);
  mint.prepare({ batchSize: 15 });
  const special = Buffer.alloc(64, 255).toString('base64url');
  mint.exec('UPDATE inventory SET dna=? WHERE quintile=5', special);
  const before = mint.exec('SELECT id, serial, dna, pack_slot, quintile FROM inventory ORDER BY id');
  storage.exec('ALTER TABLE inventory DROP COLUMN batch');
  mint = new Mint(storage, f.options);
  assert.deepEqual(mint.exec('SELECT id, serial, dna, pack_slot, quintile FROM inventory ORDER BY id'), before);
  assert.ok(mint.exec('SELECT batch FROM inventory').every(row => row.batch === 1));
  const offer = mint.offer({ owner, request: request(1) }, { lifetimeLimit: 1 });
  assert.ok(offer.choices.every(option => option.hints[4].textured === true));
  assert.ok(offer.choices.every(option => Object.keys(option.hints[4]).length === 3));
  await assert.rejects(mint.issue({ owner, request: offer.request, choice: offer.choices[0].choice }, { lifetimeLimit: 0 }), /limit reached/);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM issued')[0].n, 0);
  assert.deepEqual(mint.offer({ owner, request: request(2) }, { lifetimeLimit: 1 }), offer);
});

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ubumint-'));
  const path = join(directory, 'mint.sqlite');
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const stores = [];
  t.after(() => { for (const store of stores) if (store) store.close(); rmSync(directory, { recursive: true, force: true }); });
  const open = () => { const storage = openStorage(path); stores.push(storage); return storage; };
  const options = { mint: mintID, key: 'test-1', resolveSigningKey: () => keys.privateKey };
  return { path, keys, options, open, stores };
}

test('existing issued records migrate automatically without rewriting certificates', async t => {
  const f = await fixture(t), storage = f.open();
  const historicalDna = 'A'.repeat(86);
  storage.exec(`CREATE TABLE issued (
    id TEXT PRIMARY KEY, serial TEXT NOT NULL UNIQUE, dna TEXT NOT NULL,
    batch INTEGER NOT NULL, owner TEXT NOT NULL, revision INTEGER NOT NULL,
    request TEXT NOT NULL, pack_id TEXT NOT NULL, quintile INTEGER NOT NULL,
    issued_at INTEGER NOT NULL, key TEXT NOT NULL,
    certificate TEXT, UNIQUE(owner, request, id)) STRICT`);
  storage.exec('INSERT INTO issued VALUES (?, ?, ?, 1, ?, 1, ?, ?, 1, ?, ?, ?)',
    'historical-id', '000000000001', historicalDna, owner, request(1), 'historical-pack',
    1792700000, 'test-1', 'original-signed-certificate');
  let mint = new Mint(storage, f.options);
  assert.equal(mint.needsRarityBackfill(), true);
  assert.deepEqual(storage.exec('SELECT favorite, rarity_bits, certificate FROM issued').map(r => ({ ...r })), [
    { favorite: 0, rarity_bits: null, certificate: 'original-signed-certificate' }
  ]);
  assert.equal(mint.backfillRarity(1), 1);
  assert.equal(mint.backfillRarity(1), 0);
  const migrated = storage.exec('SELECT favorite, rarity_bits, certificate FROM issued')[0];
  assert.equal(migrated.favorite, 0);
  assert.ok(Number.isFinite(migrated.rarity_bits));
  assert.equal(migrated.certificate, 'original-signed-certificate');
  storage.close(); f.stores[0] = null;
  mint = new Mint(f.open(), f.options);
  assert.equal(mint.needsRarityBackfill(), false);
  assert.deepEqual(mint.exec('SELECT favorite, rarity_bits, certificate FROM issued')[0], migrated);
});

test('default 1000 batch prepares packs across quintiles, resumes after reopen and hides incomplete inventory', async t => {
  const f = await fixture(t);
  let storage = f.open(), mint = new Mint(storage, f.options);
  assert.equal(DEFAULT_BATCH_SIZE, 1000);
  assert.equal(PACK_SIZE, 5);
  const partial = mint.prepare();
  assert.equal(partial.size, 1000); assert.equal(partial.prepared, 100); assert.equal(partial.remaining, 0);
  await assert.rejects(mint.issue({ owner, request: request(1) }), /preparation required/);
  storage.close(); f.stores[0] = null;
  storage = f.open(); mint = new Mint(storage, f.options);
  const complete = mint.prepare({ batchSize: 1000, chunkSize: 1000 });
  assert.equal(complete.size, 1000); assert.equal(complete.prepared, 1000);
  assert.equal(complete.remaining, 200); // 1000 / 5 = 200 packs
  const rows = storage.exec('SELECT * FROM inventory ORDER BY serial');
  assert.equal(rows[0].serial, '000000000001'); assert.equal(rows[999].serial, '000000001000');
  assert.equal(new Set(rows.map(r => r.id)).size, 1000);
  assert.equal(new Set(rows.map(r => r.dna)).size, 1000);
  assert.ok(rows.every(r => r.dna.length === 86));
  assert.ok(rows.every(r => r.pack_slot >= 0 && r.pack_slot < 200));
  assert.ok(rows.every(r => r.quintile >= 1 && r.quintile <= 5));

  const result = await mint.issue({ owner, request: request(1) });
  assert.equal(result.certificates.length, 5);
  for (const cert of result.certificates) {
    const verified = await file.read(cert, { resolveKey: () => f.keys.publicKey });
    assert.equal(verified.type, 'signed');
  }
  // Remaining packs decreased from 200 to 199
  assert.equal(mint.state().remaining, 199);
  const retry = await mint.issue({ owner, request: request(1) });
  assert.deepEqual(retry.certificates, result.certificates);
  assert.equal(mint.state().remaining, 199);
  assert.equal(storage.exec('SELECT COUNT(*) AS count FROM issued WHERE owner=?', owner)[0].count, 5);
  const indexed = storage.exec('SELECT favorite, rarity_bits FROM issued WHERE owner=?', owner);
  assert.ok(indexed.every(row => row.favorite === 0 && Number.isFinite(row.rarity_bits)));
  assert.equal(mint.needsRarityBackfill(), false);

  // Check that the issued pack contains one ubu from each quintile (1 through 5)
  const issuedRows = storage.exec('SELECT quintile, dna FROM issued WHERE owner=? AND request=? ORDER BY quintile', owner, request(1));
  assert.deepEqual(issuedRows.map(r => r.quintile), [1, 2, 3, 4, 5]);
});

test('draws packs without replacement, exhausts before next batch and preserves creation serials', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  mint.prepare({ batchSize: 15 }); // 3 packs of 5
  assert.equal(mint.state().remaining, 3);
  const original = storage.exec('SELECT id, serial, dna FROM inventory');
  const packs = await Promise.all(Array.from({ length: 3 }, (_, i) => mint.issue({ owner, request: request(i) })));
  const allIssuedCerts = packs.flatMap(p => p.certificates);
  assert.equal(allIssuedCerts.length, 15);
  assert.deepEqual(new Set(allIssuedCerts.map(c => JSON.parse(c).id)), new Set(original.map(r => r.id)));
  for (const text of allIssuedCerts) {
    const cert = JSON.parse(text), source = original.find(r => r.id === cert.id);
    assert.equal(cert.serial, source.serial); assert.equal(cert.dna, source.dna);
  }
  assert.equal(storage.exec('SELECT * FROM inventory').length, 0);
  assert.equal(mint.state().remaining, 0);
  await assert.rejects(mint.issue({ owner, request: request(8) }), /preparation required/);
  const retry = await mint.issue({ owner, request: request(0) });
  assert.deepEqual(retry, packs[0]);
  assert.equal(mint.prepare({ batchSize: 10 }).batch, 2);
  const newInventory = storage.exec('SELECT serial FROM inventory ORDER BY serial');
  assert.equal(newInventory.length, 10);
  assert.equal(newInventory[0].serial, '000000000016');
  assert.equal(newInventory[9].serial, '000000000025');
});

test('failed signing survives restart and retries the same pack with its original key', async t => {
  const f = await fixture(t);
  let storage = f.open();
  const broken = new Mint(storage, { ...f.options, resolveSigningKey: () => { throw new Error('key unavailable'); } });
  broken.prepare({ batchSize: 5 }); // 1 pack
  await assert.rejects(broken.issue({ owner, request: request(1) }), /key unavailable/);
  const saved = storage.exec('SELECT * FROM issued WHERE owner=? AND request=?', owner, request(1));
  assert.equal(saved.length, 5);
  assert.ok(saved.every(r => r.certificate === null));
  assert.equal(broken.state().remaining, 0); // pack slot was allocated

  storage.close(); f.stores[0] = null;
  storage = f.open();
  let resolved;
  const mint = new Mint(storage, { ...f.options, key: 'test-2', resolveSigningKey: key => { resolved = key; return f.keys.privateKey; } });
  const result = await mint.issue({ owner, request: request(1) });
  assert.equal(result.certificates.length, 5);
  assert.equal(resolved, 'test-1');
  for (let i = 0; i < 5; i++) {
    const cert = JSON.parse(result.certificates[i]);
    assert.equal(cert.id, saved[i].id);
    assert.equal(cert.issuedAt, saved[i].issued_at);
    assert.equal(cert.key, 'test-1');
  }
});

test('preparation rollback, validation, mint binding and serial ceiling', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  storage.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON inventory BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => mint.prepare({ batchSize: 5 }), /test failure/);
  assert.equal(mint.state().next_serial, 1); assert.equal(mint.state().batch, 0);
  storage.exec('DROP TRIGGER fail_insert');
  for (const batchSize of [0, -1, 1.5, '1000', 1000001, 7, 13]) assert.throws(() => mint.prepare({ batchSize }));
  assert.throws(() => mint.prepare({ chunkSize: 1001 }), /chunk size/);
  await assert.rejects(mint.issue({ owner: '', request: request(1) }), /Invalid issuance/);
  await assert.rejects(mint.issue({ owner, request: 'short' }), /Invalid issuance/);
  assert.throws(() => new Mint(storage, { ...f.options, mint: 'AQEBAQEBAQEBAQEBAQEBAQ' }), /another mint/);
  storage.exec('UPDATE mint_state SET next_serial=999999999995');
  assert.throws(() => mint.prepare({ batchSize: 10 }), /range exhausted/);
  mint.prepare({ batchSize: 5 });
  const result = await mint.issue({ owner, request: request(1) });
  const serials = result.certificates.map(c => JSON.parse(c).serial);
  assert.ok(serials.includes('999999999999'));
  assert.throws(() => mint.prepare({ batchSize: 5 }), /range exhausted/);
});

test('independent concurrent SQLite connections cannot allocate twice', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  mint.prepare({ batchSize: 40 }); // 8 packs
  const privateJwk = await crypto.subtle.exportKey('jwk', f.keys.privateKey);
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { Mint } = require(workerData.modulePath);
    const { openStorage } = require(workerData.storagePath);
    (async () => {
      const storage = openStorage(workerData.path);
      try {
        const privateKey = await crypto.subtle.importKey('jwk', workerData.privateJwk, 'Ed25519', false, ['sign']);
        const mint = new Mint(storage, { mint: workerData.mint, key: 'test-1', resolveSigningKey: () => privateKey });
        const results = await Promise.all(workerData.requests.map(request => mint.issue({ owner: workerData.owner, request })));
        parentPort.postMessage(results);
      } finally { storage.close(); }
    })().catch(error => { throw error; });`;
  const outputs = await Promise.all(Array.from({ length: 2 }, (_, group) => new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: {
      modulePath: require.resolve('./mint.js'), storagePath: require.resolve('./mint-local.js'),
      path: f.path, privateJwk, mint: mintID, owner,
      requests: [request(999), ...Array.from({ length: 3 }, (_, i) => request(group * 10 + i))]
    } });
    let result;
    worker.on('message', value => { result = value; });
    worker.on('error', reject);
    worker.on('exit', code => code ? reject(new Error(`Worker exit ${code}`)) : resolve(result));
  })));
  assert.deepEqual(outputs[0][0], outputs[1][0]);
  const allCerts = outputs.flatMap(group => group.flatMap(res => res.certificates.map(text => JSON.parse(text))));
  // 1 shared request (5 ubus) + 3 from group 0 (15 ubus) + 3 from group 1 (15 ubus) = 7 unique packs = 35 unique ubus
  assert.equal(new Set(allCerts.map(c => c.id)).size, 35);
  assert.equal(mint.state().remaining, 1); // 8 - 7 = 1 pack remaining
  assert.equal(storage.exec('SELECT * FROM issued').length, 35);
});

test('allocation rolls back as a unit and request IDs are scoped to the owner', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  assert.throws(() => new Mint(storage, { ...f.options, key: undefined }), /configuration/);
  mint.prepare({ batchSize: 15 }); // 3 packs
  const original = storage.exec('SELECT * FROM inventory ORDER BY id');
  storage.exec("CREATE TRIGGER fail_allocation BEFORE UPDATE OF remaining ON mint_state BEGIN SELECT RAISE(ABORT, 'allocation failure'); END");
  await assert.rejects(mint.issue({ owner, request: request(1) }), /allocation failure/);
  assert.deepEqual(storage.exec('SELECT * FROM inventory ORDER BY id'), original);
  assert.equal(storage.exec('SELECT * FROM issued').length, 0);
  assert.equal(mint.state().remaining, 3);
  storage.exec('DROP TRIGGER fail_allocation');
  const first = await mint.issue({ owner, request: request(1) });
  const second = await mint.issue({ owner: '234567890123456789', request: request(1) });
  assert.notEqual(JSON.parse(first.certificates[0]).id, JSON.parse(second.certificates[0]).id);
  const reopened = new Mint(f.open(), { ...f.options, resolveSigningKey: () => { throw new Error('must use persisted certificate'); } });
  assert.deepEqual(await reopened.issue({ owner, request: request(1) }), first);
  assert.equal(mint.state().remaining, 1);
});

test('lifetime allowance counts packs atomically and retries do not consume it twice', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  mint.prepare({ batchSize: 25 }); // 5 packs
  await assert.rejects(mint.issue({ owner, request: request(0) }, { lifetimeLimit: 0 }), /limit reached/);
  assert.equal(mint.state().remaining, 5);
  const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => mint.issue({ owner, request: request(i) }, { lifetimeLimit: 2 })));
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 2);
  assert.ok(outcomes.filter(r => r.status === 'rejected').every(r => /limit reached/.test(r.reason.message)));
  assert.equal(mint.state().remaining, 3);
  const first = outcomes[0].value;
  assert.deepEqual(await mint.issue({ owner, request: request(0) }, { lifetimeLimit: 0 }), first);
  for (const lifetimeLimit of [-1, NaN, '3', 1.5]) await assert.rejects(mint.issue({ owner, request: request(9) }, { lifetimeLimit }), /Invalid lifetime/);
});

test('seamlessly migrates legacy pre-pack database schema on initialization', async t => {
  const f = await fixture(t);
  const storage = f.open();
  storage.exec(`CREATE TABLE mint_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), mint TEXT NOT NULL,
    next_serial INTEGER NOT NULL, batch INTEGER NOT NULL, size INTEGER NOT NULL,
    prepared INTEGER NOT NULL, remaining INTEGER NOT NULL, start_serial INTEGER NOT NULL) STRICT`);
  storage.exec(`CREATE TABLE inventory (
    slot INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, serial TEXT NOT NULL UNIQUE, dna TEXT NOT NULL) STRICT`);
  storage.exec(`CREATE TABLE issued (
    id TEXT PRIMARY KEY, serial TEXT NOT NULL UNIQUE, dna TEXT NOT NULL,
    batch INTEGER NOT NULL, owner TEXT NOT NULL, revision INTEGER NOT NULL,
    request TEXT NOT NULL, issued_at INTEGER NOT NULL, key TEXT NOT NULL,
    certificate TEXT, UNIQUE(owner, request)) STRICT`);
  storage.exec('CREATE INDEX issued_owner ON issued(owner)');
  storage.exec(`INSERT INTO mint_state VALUES (1, '${mintID}', 6, 1, 10, 10, 5, 1)`);
  storage.exec(`INSERT INTO issued VALUES ('legacy_id_1', '000000000001', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 1, '${owner}', 1, 'legacy_req_1', 1700000000, 'test-1', '{"type":"ubu-signed"}')`);

  const mint = new Mint(storage, f.options);
  const legacyRow = storage.exec('SELECT * FROM issued WHERE id=?', 'legacy_id_1')[0];
  assert.equal(legacyRow.pack_id, 'legacy_req_1');
  assert.equal(legacyRow.quintile, 0);

  const invCols = storage.exec('PRAGMA table_info(inventory)').map(c => c.name);
  assert.ok(invCols.includes('pack_slot'));
  assert.ok(invCols.includes('quintile'));

  mint.prepare({ batchSize: 5 });
  const result = await mint.issue({ owner, request: request(100) });
  assert.equal(result.certificates.length, 5);
});
