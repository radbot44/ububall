import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from 'wrangler';
import { login, callback } from '../auth.mjs';
import file from '../ubu-file.js';
import ubu from '../ubu.js';

test('Cloudflare Worker, assets, OAuth sessions and SQLite Durable Object', { timeout: 60000 }, async t => {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const privateKey = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const env = {
    ORIGIN: 'http://127.0.0.1', DISCORD_CLIENT_ID: '123', DISCORD_CLIENT_SECRET: 'test-only',
    SESSION_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
    MINT_ID: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'), MINT_KEY_ID: 'test-1',
    MINT_PUBLIC_KEYS: JSON.stringify({ 'test-1': privateKey.x }), MINT_PRIVATE_KEYS: JSON.stringify({ 'test-1': privateKey }),
    BATCH_SIZE: '10', LIFETIME_MINT_LIMIT: '3'
  };
  const server = createTestHarness({ workers: [{ configPath: './wrangler.jsonc', vars: {
    ORIGIN: env.ORIGIN, MINT_ID: env.MINT_ID, MINT_KEY_ID: env.MINT_KEY_ID, MINT_PUBLIC_KEYS: env.MINT_PUBLIC_KEYS,
    DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID, BATCH_SIZE: env.BATCH_SIZE, LIFETIME_MINT_LIMIT: env.LIFETIME_MINT_LIMIT
  }, secrets: { SESSION_SECRET: env.SESSION_SECRET, MINT_PRIVATE_KEYS: env.MINT_PRIVATE_KEYS, DISCORD_CLIENT_SECRET: env.DISCORD_CLIENT_SECRET } }] });
  t.after(() => server.close());
  await server.listen();
  const fetch = (path, options) => server.fetch(env.ORIGIN + path, options);
  async function signedIn(owner) {
    const start = await login(new Request(env.ORIGIN + '/auth/discord'), env);
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const response = await callback(new Request(env.ORIGIN + '/auth/callback?code=fixture&state=' + state, {
      headers: { Cookie: start.headers.get('Set-Cookie').split(';')[0] }
    }), env, async url => Response.json(url.endsWith('/token') ? { access_token: 'test-only', token_type: 'Bearer' } : { id: owner }));
    const cookie = response.headers.getSetCookie().find(c => c.startsWith('__Host-ubu-session=')).split(';')[0];
    const session = await (await fetch('/api/session', { headers: { Cookie: cookie } })).json();
    return { cookie, csrf: session.csrf };
  }
  const user = await signedIn('123456789012345678');
  const headers = { Cookie: user.cookie, Origin: env.ORIGIN, 'X-Ubu-CSRF': user.csrf, 'Content-Type': 'application/json' };
  const offer = (request, h = headers) => fetch('/api/packs', { method: 'POST', headers: h, body: JSON.stringify({ request }) });
  const select = (request, choice, h = headers) => fetch('/api/mint', { method: 'POST', headers: h, body: JSON.stringify({ request, choice }) });
  async function issue(request, h = headers) {
    const response = await offer(request, h);
    if (!response.ok) return response;
    const data = await response.json();
    return select(data.request, data.completed ? undefined : data.choices[0].choice, h);
  }
  async function readyIssue(request) {
    const deadline = Date.now() + 20000;
    while (true) {
      const response = await issue(request);
      if (response.status !== 503 || Date.now() >= deadline) return response;
      await response.text();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  await t.test('only allowlisted frontend assets and trusted public configuration are served', async () => {
    assert.match(await (await fetch('/')).text(), /Ubu Mint/);
    for (const path of ['/ubu-render.js', '/demo.html', '/site.js', '/rarity.js']) assert.equal((await fetch(path)).status, 200);
    for (const path of ['/worker.mjs', '/mint.js', '/auth.mjs', '/AGENTS.md', '/.dev.vars', '/state/mint.sqlite']) assert.equal((await fetch(path)).status, 404);
    const response = await fetch('/api/config'), config = await response.json();
    assert.equal(config.lifetimeLimit, 3); assert.equal(config.keys['test-1'], privateKey.x);
    assert.ok(!JSON.stringify(config).includes(privateKey.d));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  });
  await t.test('public mint endpoint rejects missing auth, CSRF, forged owner and oversized input', async () => {
    const unauthenticated = await fetch('/api/mint', { method: 'POST' });
    assert.equal(unauthenticated.status, 401);
    assert.equal((await fetch('/api/mint', { method: 'POST', headers: { Cookie: user.cookie } })).status, 403);
    assert.equal((await fetch('/api/mint', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    for (const body of [JSON.stringify({ request: 'a'.repeat(16), owner: 'attacker' }), ' '.repeat(513), '{']) {
      assert.equal((await fetch('/api/mint', { method: 'POST', headers, body })).status, 400);
    }
    const response = await fetch('/auth/callback?code=x&state=forged');
    assert.equal(response.status, 400);
    assert.equal((await select('unoffered_request_1')).status, 409);
    assert.equal((await fetch('/api/packs', { method: 'POST' })).status, 401);
    assert.equal((await offer('offer_request_0001', { ...headers, 'X-Ubu-CSRF': 'wrong' })).status, 403);
    assert.equal((await fetch('/api/packs', { method: 'POST', headers, body: JSON.stringify({ request: 'offer_request_0001', dna: 'forged' }) })).status, 400);
  });
  let firstCertificates;
  await t.test('alarms prepare batches and concurrent retries return one verified issuance', async () => {
    const preparing = await issue('first_request_0001');
    assert.equal(preparing.status, 503); assert.equal(preparing.headers.get('Retry-After'), '2');
    let offered;
    const deadline = Date.now() + 20000;
    do {
      const response = await offer('first_request_0001');
      if (response.ok) { offered = await response.json(); break; }
      assert.equal(response.status, 503);
      await response.text(); await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(offered);
    assert.equal(offered.choices.length, 3);
    assert.ok(!JSON.stringify(offered).includes('dna'));
    await server.getWorker().evictDurableObject('MINT', { name: env.MINT_ID });
    assert.deepEqual(await (await offer('different_request_0001')).json(), offered);
    const outsider = await signedIn('345678901234567890');
    assert.equal((await select(offered.request, offered.choices[0].choice, { ...headers, Cookie: outsider.cookie, 'X-Ubu-CSRF': outsider.csrf })).status, 409);
    const ready = await select(offered.request, offered.choices[0].choice);
    assert.equal(ready.status, 200, await ready.clone().text());
    firstCertificates = (await ready.json()).certificates;
    assert.equal(firstCertificates.length, 5);
    for (let i = 0; i < firstCertificates.length; i++) {
      const verified = await file.read(firstCertificates[i], { resolveKey: () => keys.publicKey });
      const attrs = ubu.decode(ubu.fromCode(verified.dna)).attributes;
      assert.deepEqual(offered.choices[0].hints[i], { background: attrs.background.hex,
        accents: ['eyes', 'irises', 'pupils', 'mouth'].map(role => attrs[role].hex),
        textured: Object.values(attrs).some(a => Boolean(a.texture)) });
    }
    assert.equal((await select(offered.request, offered.choices[1].choice)).status, 409);
    const retries = await Promise.all(Array.from({ length: 8 }, () => issue('first_request_0001')));
    for (const retry of retries) assert.deepEqual((await retry.json()).certificates, firstCertificates);
    const collection = await (await fetch('/api/ubus', { headers })).json();
    assert.equal(collection.ubus.length, 5);
    const storage = await server.getWorker().getDurableObjectStorage('MINT', { name: env.MINT_ID });
    assert.equal((await storage.exec('SELECT remaining FROM mint_state'))[0].remaining, 3);
    assert.equal((await storage.exec('SELECT COUNT(*) AS count FROM issued'))[0].count, 5);
  });
  await t.test('sort pages and owner-backed favorites survive reloads and reject cross-account writes', async () => {
    const readCollection = async (sort, after = '') => {
      const response = await fetch('/api/ubus?sort=' + sort + (after ? '&after=' + after : ''), { headers });
      assert.equal(response.status, 200);
      return response.json();
    };
    const serials = firstCertificates.map(text => JSON.parse(text).serial);
    const recent = await readCollection('recent');
    assert.deepEqual(recent.ubus.map(row => row.serial), [...serials].sort().reverse());
    assert.deepEqual((await readCollection('old')).ubus.map(row => row.serial), [...serials].sort());
    assert.deepEqual((await readCollection('serial')).ubus.map(row => row.serial), [...serials].sort());
    const middle = recent.ubus[2].serial;
    assert.deepEqual((await readCollection('recent', middle)).ubus.map(row => row.serial),
      recent.ubus.slice(3).map(row => row.serial));
    const storage = await server.getWorker().getDurableObjectStorage('MINT', { name: env.MINT_ID });
    const rarityExpected = (await storage.exec('SELECT serial FROM issued WHERE owner=? ORDER BY rarity_bits DESC, serial DESC',
      '123456789012345678')).map(row => row.serial);
    assert.deepEqual((await readCollection('rarity')).ubus.map(row => row.serial), rarityExpected);
    assert.equal((await fetch('/api/ubus?sort=unexpected', { headers })).status, 400);
    assert.equal((await fetch('/api/ubus?after=000000999999', { headers })).status, 400);

    const favorite = (data, h = headers) => fetch('/api/favorites', {
      method: 'POST', headers: h, body: JSON.stringify(data)
    });
    const target = [...serials].sort()[0];
    assert.equal((await favorite({ serial: target, favorite: true })).status, 200);
    assert.equal((await favorite({ serial: target, favorite: true })).status, 200);
    let favorites = await readCollection('favorite');
    assert.equal(favorites.ubus[0].serial, target);
    assert.equal(favorites.ubus[0].favorite, true);
    const another = [...serials].sort()[1];
    assert.equal((await favorite({ serials: [another, '000000999999'] })).status, 200);
    favorites = await readCollection('favorite');
    assert.deepEqual(favorites.ubus.filter(row => row.favorite).map(row => row.serial).sort(), [target, another].sort());

    const other = await signedIn('234567890123456789');
    const outsider = { ...headers, Cookie: other.cookie, 'X-Ubu-CSRF': other.csrf };
    assert.equal((await favorite({ serial: target, favorite: false }, outsider)).status, 404);
    assert.equal((await fetch('/api/ubus?sort=favorite', { headers: outsider })).status, 200);
    assert.equal((await favorite({ serial: target, favorite: false }, { ...headers, 'X-Ubu-CSRF': 'wrong' })).status, 403);
    assert.equal((await favorite({ serials: [target, 'not-a-serial'] })).status, 400);
    await server.getWorker().evictDurableObject('MINT', { name: env.MINT_ID });
    favorites = await readCollection('favorite');
    assert.equal(favorites.ubus.filter(row => row.favorite).length, 2);
    assert.equal((await favorite({ serial: target, favorite: false })).status, 200);
    favorites = await readCollection('favorite');
    assert.equal(favorites.ubus.find(row => row.serial === target).favorite, false);
  });
  await t.test('state survives object eviction and short inventories refill for three choices', async () => {
    await server.getWorker().evictDurableObject('MINT', { name: env.MINT_ID });
    assert.deepEqual((await (await issue('first_request_0001')).json()).certificates, firstCertificates);
    const second = await readyIssue('second_request_0002'); assert.equal(second.status, 200);
    const secondCertificates = (await second.json()).certificates;
    assert.equal(secondCertificates.length, 5);
    const third = await readyIssue('third_request_0003'); assert.equal(third.status, 200, await third.clone().text());
    const thirdCertificates = (await third.json()).certificates;
    assert.equal(thirdCertificates.length, 5);
    const certificates = [...firstCertificates, ...secondCertificates, ...thirdCertificates];
    assert.equal(new Set(certificates.map(c => JSON.parse(c).serial)).size, 15);
    const storage = await server.getWorker().getDurableObjectStorage('MINT', { name: env.MINT_ID });
    assert.ok((await storage.exec('SELECT batch FROM mint_state'))[0].batch >= 3);
    assert.equal((await issue('fourth_request_0004')).status, 403);
    assert.deepEqual((await (await issue('first_request_0001')).json()).certificates, firstCertificates);
  });
  await t.test('concurrent new requests respect lifetime limit and collections are private', async () => {
    const other = await signedIn('234567890123456789');
    const otherHeaders = { ...headers, Cookie: other.cookie, 'X-Ubu-CSRF': other.csrf };
    const empty = await (await fetch('/api/ubus', { headers: otherHeaders })).json(); assert.equal(empty.ubus.length, 0);
    // Three current pack issuances already consume the first owner's lifetime allowance.
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => issue('over_limit_request_' + i)));
    assert.ok(results.every(r => r.status === 403));
    const otherResult = await issue('other_owner_request_1', otherHeaders);
    assert.equal(otherResult.status, 200);
    const collection = await (await fetch('/api/ubus', { headers: otherHeaders })).json(); assert.equal(collection.ubus.length, 5);
    const logout = await fetch('/api/logout', { method: 'POST', headers });
    assert.equal(logout.status, 200); assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/);
  });
  await t.test('multi-chunk alarm preparation resumes after object eviction', async () => {
    const chunkedMint = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
    await server.update(options => ({ workers: options.workers.map(worker => ({ ...worker,
      vars: { ...worker.vars, MINT_ID: chunkedMint, BATCH_SIZE: '205' }
    })) }));
    assert.equal((await issue('chunked_request_0001')).status, 503);
    const storage = await server.getWorker().getDurableObjectStorage('MINT', { name: chunkedMint });
    const deadline = Date.now() + 10000;
    let state;
    do {
      state = (await storage.exec('SELECT prepared, size FROM mint_state'))[0];
      if (state.prepared > 0) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.equal(state.prepared, 100); assert.equal(state.size, 205);
    await server.getWorker().evictDurableObject('MINT', { name: chunkedMint });
    const ready = await readyIssue('chunked_request_0001');
    assert.equal(ready.status, 200, await ready.clone().text());
    const record = (await storage.exec('SELECT prepared, remaining, next_serial FROM mint_state'))[0];
    assert.equal(record.prepared, 205); assert.equal(record.remaining, 40); // 205/5 = 41 packs, 1 issued -> 40 packs remaining
    assert.equal(record.next_serial, 206);
  });
  await t.test('pagination walks a collection larger than one page in every sort mode', async () => {
    await server.update(options => ({ workers: options.workers.map(worker => ({
      ...worker, vars: { ...worker.vars, LIFETIME_MINT_LIMIT: '20' }
    })) }));
    for (let i = 0; i < 11; i++) {
      const response = await issue('pagination_request_' + String(i).padStart(5, '0'));
      assert.equal(response.status, 200, await response.clone().text());
    }
    const all = await server.getWorker().getDurableObjectStorage('MINT', { name:
      (await (await fetch('/api/config')).json()).mint });
    const expected = await all.exec('SELECT serial FROM issued WHERE owner=?', '123456789012345678');
    assert.equal(expected.length, 60);
    for (const sort of ['recent', 'old', 'rarity', 'serial', 'favorite']) {
      const results = [];
      let cursor = '';
      do {
        const response = await fetch('/api/ubus?sort=' + sort + (cursor ? '&after=' + cursor : ''), { headers });
        assert.equal(response.status, 200, await response.clone().text());
        const page = await response.json();
        results.push(...page.ubus.map(row => row.serial));
        cursor = page.next;
      } while (cursor);
      assert.equal(results.length, 60);
      assert.equal(new Set(results).size, 60);
      assert.deepEqual([...results].sort(), expected.map(row => row.serial).sort());
    }
  });
});
