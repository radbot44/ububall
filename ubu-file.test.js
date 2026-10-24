'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verify, createPublicKey } = require('node:crypto');
const file = require('./ubu-file.js');
const dna = 'A'.repeat(43);
const record = { mint: 'A'.repeat(22), id: 'AQEBAQEBAQEBAQEBAQEBAQ', serial: '000000000001', dna, issuedAt: 1792700000, key: 'mint-1' };
const keyPair = () => crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);

test('unsigned files are canonical and never imply mint authority', async () => {
  const text = file.unsigned(dna);
  assert.equal(text, `{"type":"ubu","dna":"${dna}"}`);
  assert.equal(Buffer.byteLength(text), 66);
  assert.deepEqual(await file.read(text), { type: 'unsigned', dna });
  assert.deepEqual(await file.read(new TextEncoder().encode(text)), { type: 'unsigned', dna });
  await assert.rejects(file.read(text, { allowUnsigned: false }), /requires mint-signed/);
  for (const bad of [text + '\n', ' ' + text, text.replace('{', '{"extra":true,'), text.replace('{', '{"dna":"bad",'),
    JSON.stringify({ dna, type: 'ubu' }), JSON.stringify({ type: 'ubu', dna, signature: 'A'.repeat(86) }),
    JSON.stringify({ type: 'ubu-demo', dna }), JSON.stringify({ type: 'ubu', dna: '00'.repeat(32) })]) {
    await assert.rejects(file.read(bad));
  }
});
test('signed certificate round-trips and independently verifies the exact signing bytes', async () => {
  const { privateKey, publicKey } = await keyPair();
  const text = await file.sign(record, privateKey);
  assert.equal(Buffer.byteLength(text), 297);
  const resolveKey = (mint, key) => mint === record.mint && key === record.key ? publicKey : null;
  const result = await file.read(text, { allowUnsigned: false, resolveKey });
  assert.equal(result.type, 'signed'); assert.equal(result.dna, dna);
  assert.equal(result.certificate.id, record.id);
  assert.equal(result.certificate.serial, '000000000001');
  assert.ok(Object.isFrozen(result.certificate));
  const { signature } = JSON.parse(text);
  const payload = { type: 'ubu-signed', ...record };
  const key = createPublicKey({ key: Buffer.from(await crypto.subtle.exportKey('spki', publicKey)), format: 'der', type: 'spki' });
  assert.ok(verify(null, Buffer.from('ubumint:issuance\n' + JSON.stringify(payload)), key, Buffer.from(signature, 'base64url')));
  assert.ok(!verify(null, Buffer.from(JSON.stringify(payload)), key, Buffer.from(signature, 'base64url')));
});
test('tampering with any signed field or signature is rejected, with no unsigned fallback', async () => {
  const { privateKey, publicKey } = await keyPair();
  const text = await file.sign(record, privateKey);
  const parsed = JSON.parse(text), trust = { resolveKey: () => publicKey };
  const changed = {
    mint: record.id, id: record.mint, serial: '000000000002', dna: 'AQ'.repeat(21) + 'A', issuedAt: record.issuedAt + 1, key: 'mint-2',
    signature: Buffer.alloc(64, 1).toString('base64url')
  };
  for (const [field, value] of Object.entries(changed)) {
    await assert.rejects(file.read(JSON.stringify({ ...parsed, [field]: value }), trust), /Invalid mint signature/);
  }
  for (const bad of [{ ...parsed, type: 'ubu' }, { ...parsed, signature: undefined }, { ...parsed, owner: 'attacker' },
    { ...parsed, publicKey: 'attacker' }, { ...parsed, issuedAt: -1 }, { ...parsed, issuedAt: '1792700000' }]) {
    await assert.rejects(file.read(JSON.stringify(bad), trust));
  }
  const unsigned = file.unsigned(parsed.dna);
  assert.equal((await file.read(unsigned)).type, 'unsigned');
  assert.equal((await file.read(unsigned)).certificate, undefined);
});
test('untrusted, wrong and inappropriate keys cannot confer authenticity', async () => {
  const pair = await keyPair(), other = await keyPair();
  const text = await file.sign(record, pair.privateKey);
  await assert.rejects(file.read(text), /not trusted/);
  await assert.rejects(file.read(text, { resolveKey: () => null }), /not trusted/);
  await assert.rejects(file.read(text, { resolveKey: () => other.publicKey }), /Invalid mint signature/);
  await assert.rejects(file.read(text, { resolveKey: () => pair.privateKey }), /public key/);
  await assert.rejects(file.sign({ ...record, owner: 'ignored?' }, pair.privateKey), /exactly/);
  await assert.rejects(file.sign(record, pair.publicKey), /private key/);
  const wrong = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  await assert.rejects(file.sign(record, wrong.privateKey), /Ed25519/);
  await assert.rejects(file.read(text, { resolveKey: () => wrong.publicKey }), /Ed25519/);
});
test('serials preserve twelve digits, exclude zero and support the final number', async () => {
  const pair = await keyPair();
  for (const serial of ['000000000001', '000000000010', '999999999999']) {
    const text = await file.sign({ ...record, serial }, pair.privateKey);
    const result = await file.read(text, { resolveKey: () => pair.publicKey });
    assert.equal(result.certificate.serial, serial);
  }
  const original = JSON.parse(await file.sign(record, pair.privateKey));
  for (const serial of [undefined, null, 1, '1', '000000000000', '1000000000000', '-00000000001', '00000000000x', ' 00000000001']) {
    await assert.rejects(file.sign({ ...record, serial }, pair.privateKey), /serial/);
    await assert.rejects(file.read(JSON.stringify({ ...original, serial })), /serial/);
  }
  await assert.rejects(file.read(JSON.stringify({ type: 'ubu', dna, serial: record.serial })), /Noncanonical/);
});
test('malformed files, encodings and metadata are rejected before trust lookup', async () => {
  let lookups = 0;
  const trust = { resolveKey: () => { lookups++; return null; } };
  for (const bad of ['', ' '.repeat(1025), 'null', '[]', '{}', '\ufeff' + file.unsigned(dna),
    new Uint8Array([0xc3, 0x28]), file.unsigned(dna).replace(dna, 'A'.repeat(42) + 'B')]) {
    await assert.rejects(file.read(bad, trust));
  }
  const pair = await keyPair(), signed = await file.sign(record, pair.privateKey);
  for (const bad of [signed + '\n', signed.replace('{', '{"id":"duplicate",'), signed.replace('mint-1', '../keys'),
    JSON.stringify({ ...JSON.parse(signed), signature: 'A'.repeat(85) + 'B' })]) {
    await assert.rejects(file.read(bad, trust));
  }
  assert.equal(lookups, 0);
});
