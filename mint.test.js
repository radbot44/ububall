'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Worker } = require('node:worker_threads');
const { Mint, DEFAULT_BATCH_SIZE } = require('./mint.js');
const { openStorage } = require('./mint-local.js');
const file = require('./ubu-file.js');
const mintID = 'A'.repeat(22);
const owner = '123456789012345678';
const request = n => `request_${String(n).padStart(12, '0')}`;
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

test('default 1000 batch resumes after reopen and hides incomplete inventory', async t => {
  const f = await fixture(t);
  let storage = f.open(), mint = new Mint(storage, f.options);
  assert.equal(DEFAULT_BATCH_SIZE, 1000);
  const partial = mint.prepare();
  assert.equal(partial.size, 1000); assert.equal(partial.prepared, 100);
  await assert.rejects(mint.issue({ owner, request: request(1) }), /preparation required/);
  storage.close(); f.stores[0] = null;
  storage = f.open(); mint = new Mint(storage, f.options);
  const complete = mint.prepare({ batchSize: 5, chunkSize: 1000 });
  assert.equal(complete.size, 1000); assert.equal(complete.prepared, 1000);
  const rows = storage.exec('SELECT * FROM inventory ORDER BY slot');
  assert.equal(rows[0].serial, '000000000001'); assert.equal(rows[999].serial, '000000001000');
  assert.equal(new Set(rows.map(r => r.id)).size, 1000);
  assert.equal(new Set(rows.map(r => r.dna)).size, 1000);
  assert.ok(rows.every(r => r.dna.length === 43));
  const cert = await mint.issue({ owner, request: request(1) });
  const verified = await file.read(cert, { resolveKey: () => f.keys.publicKey });
  assert.equal(verified.type, 'signed');
  assert.equal(mint.state().remaining, 999);
  assert.equal(await mint.issue({ owner, request: request(1) }), cert);
  assert.equal(mint.prepare({ batchSize: 5 }).batch, 1);
  assert.equal(storage.exec('SELECT owner, revision FROM issued')[0].owner, owner);
  assert.equal(storage.exec('SELECT owner, revision FROM issued')[0].revision, 1);
});

test('draws without replacement, exhausts before next batch and preserves creation serials', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  mint.prepare({ batchSize: 7 });
  const original = storage.exec('SELECT id, serial, dna FROM inventory');
  const issued = await Promise.all(Array.from({ length: 7 }, (_, i) => mint.issue({ owner, request: request(i) })));
  assert.deepEqual(new Set(issued.map(c => JSON.parse(c).id)), new Set(original.map(r => r.id)));
  for (const text of issued) {
    const cert = JSON.parse(text), source = original.find(r => r.id === cert.id);
    assert.equal(cert.serial, source.serial); assert.equal(cert.dna, source.dna);
  }
  assert.equal(storage.exec('SELECT * FROM inventory').length, 0);
  await assert.rejects(mint.issue({ owner, request: request(8) }), /preparation required/);
  assert.equal(await mint.issue({ owner, request: request(0) }), issued[0]);
  assert.equal(mint.prepare({ batchSize: 2 }).batch, 2);
  assert.deepEqual(storage.exec('SELECT serial FROM inventory ORDER BY slot').map(r => r.serial), ['000000000008', '000000000009']);
});

test('failed signing survives restart and retries the same record with its original key', async t => {
  const f = await fixture(t);
  let storage = f.open();
  const broken = new Mint(storage, { ...f.options, resolveSigningKey: () => { throw new Error('key unavailable'); } });
  broken.prepare({ batchSize: 2 });
  await assert.rejects(broken.issue({ owner, request: request(1) }), /key unavailable/);
  const saved = storage.exec('SELECT * FROM issued')[0];
  assert.equal(saved.certificate, null); assert.equal(broken.state().remaining, 1);
  storage.close(); f.stores[0] = null;
  storage = f.open();
  let resolved;
  const mint = new Mint(storage, { ...f.options, key: 'test-2', resolveSigningKey: key => { resolved = key; return f.keys.privateKey; } });
  const cert = JSON.parse(await mint.issue({ owner, request: request(1) }));
  assert.equal(resolved, 'test-1'); assert.equal(cert.id, saved.id);
  assert.equal(cert.issuedAt, saved.issued_at); assert.equal(cert.key, 'test-1');
  assert.equal(mint.state().remaining, 1);
});

test('preparation rollback, validation, mint binding and serial ceiling', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  storage.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON inventory BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => mint.prepare({ batchSize: 2 }), /test failure/);
  assert.equal(mint.state().next_serial, 1); assert.equal(mint.state().batch, 0);
  storage.exec('DROP TRIGGER fail_insert');
  for (const batchSize of [0, -1, 1.5, '1000', 1000001]) assert.throws(() => mint.prepare({ batchSize }), /batch size/);
  assert.throws(() => mint.prepare({ chunkSize: 1001 }), /chunk size/);
  await assert.rejects(mint.issue({ owner: '', request: request(1) }), /Invalid issuance/);
  await assert.rejects(mint.issue({ owner, request: 'short' }), /Invalid issuance/);
  assert.throws(() => new Mint(storage, { ...f.options, mint: 'AQEBAQEBAQEBAQEBAQEBAQ' }), /another mint/);
  storage.exec('UPDATE mint_state SET next_serial=999999999999');
  assert.throws(() => mint.prepare({ batchSize: 2 }), /range exhausted/);
  mint.prepare({ batchSize: 1 });
  const cert = JSON.parse(await mint.issue({ owner, request: request(1) }));
  assert.equal(cert.serial, '999999999999');
  assert.throws(() => mint.prepare({ batchSize: 1 }), /range exhausted/);
});

test('independent concurrent SQLite connections cannot allocate twice', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  mint.prepare({ batchSize: 40 });
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
  const outputs = await Promise.all(Array.from({ length: 3 }, (_, group) => new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: {
      modulePath: require.resolve('./mint.js'), storagePath: require.resolve('./mint-local.js'),
      path: f.path, privateJwk, mint: mintID, owner,
      requests: [request(999), ...Array.from({ length: 10 }, (_, i) => request(group * 10 + i))]
    } });
    let result;
    worker.on('message', value => { result = value; });
    worker.on('error', reject);
    worker.on('exit', code => code ? reject(new Error(`Worker exit ${code}`)) : resolve(result));
  })));
  assert.equal(outputs[0][0], outputs[1][0]); assert.equal(outputs[1][0], outputs[2][0]);
  const certificates = outputs.flat().map(text => JSON.parse(text));
  assert.equal(new Set(certificates.map(c => c.id)).size, 31);
  assert.equal(mint.state().remaining, 9);
  assert.equal(storage.exec('SELECT * FROM issued').length, 31);
  for (const text of outputs.flat()) await file.read(text, { resolveKey: () => f.keys.publicKey });
});

test('allocation rolls back as a unit and request IDs are scoped to the owner', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  assert.throws(() => new Mint(storage, { ...f.options, key: undefined }), /configuration/);
  mint.prepare({ batchSize: 3 });
  const original = storage.exec('SELECT * FROM inventory ORDER BY slot');
  storage.exec("CREATE TRIGGER fail_allocation BEFORE UPDATE OF remaining ON mint_state BEGIN SELECT RAISE(ABORT, 'allocation failure'); END");
  await assert.rejects(mint.issue({ owner, request: request(1) }), /allocation failure/);
  assert.deepEqual(storage.exec('SELECT * FROM inventory ORDER BY slot'), original);
  assert.equal(storage.exec('SELECT * FROM issued').length, 0);
  assert.equal(mint.state().remaining, 3);
  storage.exec('DROP TRIGGER fail_allocation');
  const first = await mint.issue({ owner, request: request(1) });
  const second = await mint.issue({ owner: '234567890123456789', request: request(1) });
  assert.notEqual(JSON.parse(first).id, JSON.parse(second).id);
  const reopened = new Mint(f.open(), { ...f.options, resolveSigningKey: () => { throw new Error('must use persisted certificate'); } });
  assert.equal(await reopened.issue({ owner, request: request(1) }), first);
  assert.equal(mint.state().remaining, 1);
});
