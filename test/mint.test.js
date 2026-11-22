'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Worker } = require('node:worker_threads');
const { Mint, DEFAULT_BATCH_SIZE, PACK_SIZE } = require('../server/mint.js');
const { openStorage } = require('../server/mint-local.js');
const file = require('../shared/ubu-file.js');
const ubu = require('../shared/ubu.js');
const rarity = require('../shared/rarity.js');
const ability = require('../shared/ability.js');

const mintID = 'A'.repeat(22);
const owner = '123456789012345678';
const request = n => `request_${String(n).padStart(12, '0')}`;

test('starter packs hold one signed ubu from each rarest decile, once per account and UTC day', async t => {
  const f = await fixture(t), mint = new Mint(f.open(), f.options);
  mint.prepare({ batchSize: 30 });
  const inventory = mint.exec('SELECT COUNT(*) AS n FROM inventory')[0].n, day = 86400000;
  let now = 20000 * day + 3600000;
  t.mock.method(Date, 'now', () => now);
  assert.deepEqual(mint.starterStatus(owner), { signup: true, daily: true, seconds: 82800 });

  const signup = await mint.claimStarter({ owner, kind: 'signup' });
  assert.equal(signup.certificates.length, 3);
  const verified = await Promise.all(signup.certificates.map(text => file.read(text, { resolveKey: () => f.keys.publicKey })));
  assert.deepEqual(verified.map(item => Math.min(90, Math.floor(rarity.scoreRarity(ubu.decode(ubu.fromCode(item.dna))).percentile / 10) * 10)), [70, 80, 90]);
  assert.deepEqual(verified.map(item => item.certificate.serial), ['000000000031', '000000000032', '000000000033']);
  assert.deepEqual(await mint.claimStarter({ owner, kind: 'signup' }), signup);
  assert.deepEqual(mint.starterStatus(owner), { signup: false, daily: true, seconds: 82800 });

  // Signup and daily are separate packs, and a retry returns the same daily pack.
  const daily = await mint.claimStarter({ owner, kind: 'daily' });
  assert.notDeepEqual(daily, signup);
  assert.deepEqual(await mint.claimStarter({ owner, kind: 'daily' }), daily);
  assert.equal(mint.starterStatus(owner).daily, false);

  // Skipped days leave nothing behind: only today's pack can be opened.
  now += 3 * day;
  assert.equal(mint.starterStatus(owner).daily, true);
  await mint.claimStarter({ owner, kind: 'daily' });
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM issued WHERE owner=?', owner)[0].n, 9);

  // Starter packs leave regular inventory and the lifetime limit alone.
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM inventory')[0].n, inventory);
  assert.equal(mint.state().remaining, 6);
  const offered = mint.offer({ owner, request: request(1) }, { lifetimeLimit: 1 });
  await mint.issue({ owner, request: offered.request, choice: offered.choices[0].choice }, { lifetimeLimit: 1 });
  assert.throws(() => mint.offer({ owner, request: request(2) }, { lifetimeLimit: 1 }), /Lifetime mint limit reached/);
  await assert.rejects(mint.claimStarter({ owner: 'g_guest', kind: 'daily' }), /Invalid issuance request/);
  await assert.rejects(mint.claimStarter({ owner, kind: 'bonus' }), /Invalid issuance request/);

  // Serials stay unique when the next batch reserves its range.
  mint.prepare({ batchSize: 30, minimumPacks: 3 });
  const serials = mint.exec('SELECT serial FROM issued UNION ALL SELECT serial FROM inventory').map(row => row.serial);
  assert.equal(new Set(serials).size, serials.length);

  // A starter pack interrupted before signing finishes on the next claim, even a day later.
  const f2 = await fixture(t);
  let fail = true;
  const recovering = new Mint(f2.open(), { ...f2.options, resolveSigningKey: async id => {
    if (fail) throw new Error('Signing unavailable.');
    return f2.options.resolveSigningKey(id);
  } });
  await assert.rejects(recovering.claimStarter({ owner, kind: 'daily' }), /Signing unavailable/);
  assert.equal(recovering.starterStatus(owner).daily, false);
  fail = false; now += day;
  await recovering.claimStarter({ owner, kind: 'daily' });
  assert.equal(recovering.exec('SELECT COUNT(*) AS n FROM issued WHERE certificate IS NULL')[0].n, 0);
  assert.equal(recovering.exec('SELECT COUNT(*) AS n FROM issued')[0].n, 6);
});

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
    assert.deepEqual(Object.keys(option).sort(), ['charge', 'choice', 'hints', 'type']);
    assert.ok(Number.isInteger(option.charge) && option.charge >= 0 && option.charge <= 5);
    assert.equal(option.hints.length, 5);
    for (const hint of option.hints) assert.deepEqual(Object.keys(hint).sort(), ['accents', 'background', 'textured']);
  }
  const chosen = offered.choices[1];
  const issued = await reopened.issue({ owner, request: offered.request, choice: chosen.choice }, { lifetimeLimit: 1 });
  let expectedCharge = 0;
  for (let i = 0; i < 5; i++) {
    const verified = await file.read(issued.certificates[i], { resolveKey: () => f.keys.publicKey });
    const decoded = ubu.decode(ubu.fromCode(verified.dna));
    if (ability.isCharged(decoded)) expectedCharge++;
    const attrs = decoded.attributes;
    assert.deepEqual(chosen.hints[i], { background: attrs.background.hex,
      accents: ['eyes', 'irises', 'pupils', 'mouth'].map(role => attrs[role].hex),
      textured: Object.values(attrs).some(a => Boolean(a.texture)) });
  }
  assert.equal(chosen.charge, expectedCharge);
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

test('allocation rolls back atomically, signing failures recover with original key, and request IDs are owner-scoped', async t => {
  const f = await fixture(t), storage = f.open();
  assert.throws(() => new Mint(storage, { ...f.options, key: undefined }), /configuration/);
  let failing = true;
  const mint = new Mint(storage, { ...f.options, resolveSigningKey: () => { if (failing) throw new Error('signing failed'); return f.keys.privateKey; } });
  mint.prepare({ batchSize: 20 });
  const original = storage.exec('SELECT * FROM inventory ORDER BY id');
  const offer = mint.offer({ owner, request: request(1) });
  storage.exec("CREATE TRIGGER fail_choice BEFORE INSERT ON pack_selections BEGIN SELECT RAISE(ABORT, 'selection failure'); END");
  const selection = { owner, request: offer.request, choice: offer.choices[0].choice };
  await assert.rejects(mint.issue(selection), /selection failure/);
  assert.equal(mint.state().remaining, 4);
  assert.deepEqual(storage.exec('SELECT * FROM inventory ORDER BY id'), original);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM issued')[0].n, 0);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM mint_account_counts')[0].n, 0);
  assert.deepEqual(mint.offer({ owner, request: request(2) }), offer);
  storage.exec('DROP TRIGGER fail_choice');
  await assert.rejects(mint.issue(selection), /signing failed/);
  assert.equal(mint.state().remaining, 3);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM pack_choices')[0].n, 0);
  assert.equal(mint.exec('SELECT regular_packs FROM mint_account_counts WHERE owner=?', owner)[0].regular_packs, 1);
  const saved = storage.exec('SELECT * FROM issued WHERE owner=? AND request=?', owner, offer.request);
  assert.ok(saved.every(r => r.certificate === null));

  // Reopen with a rotated default key; retry must recover using the original key and persisted rows.
  let resolved;
  const reopened = new Mint(f.open(), { ...f.options, key: 'test-2', resolveSigningKey: key => { resolved = key; return f.keys.privateKey; } });
  const retry = await reopened.issue(selection, { lifetimeLimit: 0 });
  assert.equal(retry.certificates.length, 5);
  assert.equal(resolved, 'test-1');
  for (let i = 0; i < 5; i++) {
    const cert = JSON.parse(retry.certificates[i]);
    assert.equal(cert.id, saved[i].id);
    assert.equal(cert.issuedAt, saved[i].issued_at);
    assert.equal(cert.key, 'test-1');
  }
  assert.equal(reopened.state().remaining, 3);
  assert.equal(reopened.exec('SELECT regular_packs FROM mint_account_counts WHERE owner=?', owner)[0].regular_packs, 1);

  // Persisted certificates are served without re-signing, and request IDs are scoped per owner.
  const noSign = new Mint(f.open(), { ...f.options, resolveSigningKey: () => { throw new Error('must use persisted certificate'); } });
  assert.deepEqual(await noSign.issue({ owner, request: offer.request }), retry);
  failing = false;
  const otherIssued = await mint.issue({ owner: '234567890123456789', request: offer.request });
  assert.notEqual(JSON.parse(retry.certificates[0]).id, JSON.parse(otherIssued.certificates[0]).id);
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
  assert.ok(rows.every(r => r.dna.length === 171));
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
  assert.ok(storage.exec('SELECT favorite FROM issued WHERE owner=?', owner).every(row => row.favorite === 0));

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
      modulePath: require.resolve('../server/mint.js'), storagePath: require.resolve('../server/mint-local.js'),
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

test('lifetime allowance counts packs atomically across concurrent choices and retries do not consume it twice', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  mint.prepare({ batchSize: 30 }); // 6 packs
  await assert.rejects(mint.issue({ owner, request: request(0) }, { lifetimeLimit: 0 }), /limit reached/);
  assert.equal(mint.state().remaining, 6);
  const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => mint.issue({ owner, request: request(i) }, { lifetimeLimit: 2 })));
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 2);
  assert.ok(outcomes.filter(r => r.status === 'rejected').every(r => /limit reached/.test(r.reason.message)));
  assert.equal(mint.state().remaining, 4);
  const first = outcomes[0].value;
  assert.deepEqual(await mint.issue({ owner, request: request(0) }, { lifetimeLimit: 0 }), first);
  for (const lifetimeLimit of [-1, NaN, '3', 1.5]) await assert.rejects(mint.issue({ owner, request: request(9) }, { lifetimeLimit }), /Invalid lifetime/);

  // Concurrent different choices for one offer grant only one pack and enforce the allowance.
  const other = '234567890123456789';
  const offer = mint.offer({ owner: other, request: request(10) }, { lifetimeLimit: 1 });
  const results = await Promise.allSettled(offer.choices.map(option => new Mint(f.open(), f.options).issue({ owner: other, request: offer.request, choice: option.choice }, { lifetimeLimit: 1 })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM issued WHERE owner=?', other)[0].n, 5);
  assert.throws(() => mint.offer({ owner: other, request: request(11) }, { lifetimeLimit: 1 }), /limit reached/);
});

test('saved teams accept only owned signed ubus with DNA-granted supers, reject coercion, and drive matchTeam fallback', async t => {
  const f = await fixture(t), mint = new Mint(f.open(), f.options);
  mint.prepare({ batchSize: 15 });
  const offer = mint.offer({ owner, request: request(1) });
  await mint.issue({ owner, request: offer.request, choice: offer.choices[0].choice });
  const issuedRows = mint.exec('SELECT serial, dna FROM issued WHERE owner=? ORDER BY serial', owner);
  const serials = issuedRows.map(row => row.serial);
  const firstSuper = row => ubu.decode(ubu.fromCode(row.dna)).supers[0] % 8;
  const missingSuper = row => {
    const allowed = new Set(ubu.decode(ubu.fromCode(row.dna)).supers.map(n => n % 8));
    return [0, 1, 2, 3, 4, 5, 6, 7].find(id => !allowed.has(id));
  };
  const slots = (a, b, c, s = null) => [a, b, c].map(serial => ({ serial, super: s }));
  const validEquippedSlots = issuedRows.slice(0, 3).map(row => ({ serial: row.serial, super: firstSuper(row) }));
  assert.deepEqual(mint.teams(owner), { teams: [], last: null });

  // Before saving a last team, matchTeam picks newest, then prioritizes favorites.
  assert.deepEqual(mint.matchTeam(owner).entries.map(row => row.serial), serials.slice(2).reverse());
  mint.exec('UPDATE issued SET favorite=1 WHERE serial=?', serials[0]);
  assert.equal(mint.matchTeam(owner).entries[0].serial, serials[0]);

  const chosen = ubu.decode(ubu.fromCode(issuedRows[1].dna)).supers[1] % 8;
  const last = [{ serial: serials[1], super: chosen }, { serial: serials[3], super: null }, { serial: serials[2], super: null }];
  const saved = { teams: [{ name: 'Wall', slots: validEquippedSlots }], last };
  assert.deepEqual(mint.saveTeams(owner, saved), saved);
  assert.deepEqual(mint.teams(owner), saved);
  assert.deepEqual(mint.teams('someone-else'), { teams: [], last: null });
  const team = mint.matchTeam(owner);
  assert.deepEqual(team.entries.map(row => row.serial), last.map(slot => slot.serial));
  assert.deepEqual(team.supers, [chosen, firstSuper(issuedRows[3]), firstSuper(issuedRows[2])]);
  assert.deepEqual(mint.matchTeam('987654321098765432'), { entries: [], supers: [] });

  const invalid = [
    null, [], { teams: [] }, { teams: [], last: null, extra: 1 },
    { teams: [{ name: 'Dup', slots: slots(serials[0], serials[0], serials[1]) }], last: null },
    { teams: [{ name: 'ArrDup', slots: [{ serial: [serials[0]], super: null }, { serial: [serials[0]], super: null }, { serial: [serials[0]], super: null }] }], last: null },
    { teams: [{ name: 'NumSerial', slots: [{ serial: 100000000000, super: null }, { serial: serials[1], super: null }, { serial: serials[2], super: null }] }], last: null },
    { teams: [{ name: 'Two', slots: slots(serials[0], serials[1]).slice(0, 2) }], last: null },
    { teams: [{ name: 'Super', slots: slots(serials[0], serials[1], serials[2], 8) }], last: null },
    { teams: [{ name: 'UnavailableSuper', slots: [{ serial: issuedRows[0].serial, super: missingSuper(issuedRows[0]) }, validEquippedSlots[1], validEquippedSlots[2]] }], last: null },
    { teams: Array.from({ length: 31 }, (_, i) => ({ name: 'T' + i, slots: saved.teams[0].slots })), last: null }
  ];
  for (const data of invalid) assert.equal(mint.saveTeams(owner, data).status, 400, JSON.stringify(data));
  const foreign = mint.saveTeams('someone-else', saved);
  assert.equal(foreign.status, 400);
  assert.match(foreign.error, /your collection/);
  assert.deepEqual(mint.teams(owner), saved);
  assert.deepEqual(mint.saveTeams(owner, { teams: [], last: null }), { teams: [], last: null });
  assert.deepEqual(new Mint(f.open(), f.options).teams(owner), { teams: [], last: null });
});

test('approach B refills without replacing leftovers, dispenses oldest batch first, and spills over below three packs', async t => {
  const f = await fixture(t), storage = f.open(), mint = new Mint(storage, f.options);
  mint.prepare({ batchSize: 15 });
  const offer1 = mint.offer({ owner, request: request(1) });
  const batchOfChoice = token => mint.exec('SELECT batch FROM inventory WHERE id=(SELECT anchor FROM pack_choices WHERE token=?)', token)[0].batch;
  assert.ok(offer1.choices.every(c => batchOfChoice(c.choice) === 1));

  await mint.issue({ owner, request: offer1.request, choice: offer1.choices[0].choice });
  assert.ok(mint.exec('SELECT batch FROM issued WHERE request=?', offer1.request).every(r => r.batch === 1));
  const leftovers = mint.exec('SELECT * FROM inventory ORDER BY id');

  // Chunked refill preserves leftover batch-1 packs while preparing batch 2.
  mint.prepare({ batchSize: 10, chunkSize: 3, minimumPacks: 3 });
  assert.equal(mint.state().remaining, 2);
  mint.prepare({ batchSize: 10, minimumPacks: 3 });
  assert.equal(mint.state().remaining, 4);
  for (const item of leftovers) assert.deepEqual(mint.exec('SELECT * FROM inventory WHERE id=?', item.id)[0], item);

  const otherOwner = '234567890123456789';
  const offer2 = mint.offer({ owner: otherOwner, request: request(2) });
  assert.equal(offer2.choices.length, 3);
  const batches = offer2.choices.map(c => batchOfChoice(c.choice));
  assert.deepEqual(batches, [1, 1, 2]);

  const now = Math.floor(Date.now() / 1000);
  assert.ok(offer2.expires >= now + 3590 && offer2.expires <= now + 3610);

  mint.exec('UPDATE pack_offers SET expires=0 WHERE owner=?', otherOwner);
  mint.expireOffers();
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM pack_choices WHERE owner=?', otherOwner)[0].n, 0);
  assert.equal(mint.exec('SELECT COUNT(*) AS n FROM pack_offers WHERE owner=?', otherOwner)[0].n, 0);
});
