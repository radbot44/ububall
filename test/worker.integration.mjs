import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from 'wrangler';
import { login, callback, activityLogin, session as activitySession } from '../server/auth.mjs';
import file from '../shared/ubu-file.js';
import ubu from '../shared/ubu.js';

test('Cloudflare Worker, assets, OAuth sessions and SQLite Durable Object', { timeout: 60000 }, async t => {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const privateKey = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const env = {
    ORIGIN: 'http://127.0.0.1', DISCORD_CLIENT_ID: '123', DISCORD_CLIENT_SECRET: 'test-only', DISCORD_ACTIVITY_BOT_TOKEN: 'test-bot',
    SESSION_SECRET: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
    MINT_ID: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'), MINT_KEY_ID: 'test-1',
    MINT_PUBLIC_KEYS: JSON.stringify({ 'test-1': privateKey.x }), MINT_PRIVATE_KEYS: JSON.stringify({ 'test-1': privateKey }),
    BATCH_SIZE: '10', LIFETIME_MINT_LIMIT: '3'
  };
  const server = createTestHarness({ workers: [{ configPath: './wrangler.jsonc', vars: {
    ORIGIN: env.ORIGIN, MINT_ID: env.MINT_ID, MINT_KEY_ID: env.MINT_KEY_ID, MINT_PUBLIC_KEYS: env.MINT_PUBLIC_KEYS,
    DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID, BATCH_SIZE: env.BATCH_SIZE, LIFETIME_MINT_LIMIT: env.LIFETIME_MINT_LIMIT
  }, secrets: { SESSION_SECRET: env.SESSION_SECRET, MINT_PRIVATE_KEYS: env.MINT_PRIVATE_KEYS, DISCORD_CLIENT_SECRET: env.DISCORD_CLIENT_SECRET,
    DISCORD_ACTIVITY_BOT_TOKEN: env.DISCORD_ACTIVITY_BOT_TOKEN } }] });
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
    const sessionRes = await fetch('/api/session', { headers: { Cookie: cookie } });
    assert.match(sessionRes.headers.get('Set-Cookie') || '', /Max-Age=34560000/);
    const session = await sessionRes.json();
    return { cookie, csrf: session.csrf };
  }
  const user = await signedIn('123456789012345678');
  const headers = { Cookie: user.cookie, Origin: env.ORIGIN, 'X-Ubu-CSRF': user.csrf, 'Content-Type': 'application/json' };
  const offer = (request, h = headers) => fetch('/api/packs', { method: 'POST', headers: h, body: JSON.stringify({ request }) });
  const starter = (kind, h = headers) => fetch('/api/starter', { method: 'POST', headers: h, body: JSON.stringify({ kind }) });
  const select = (request, choice, h = headers) => fetch('/api/mint', { method: 'POST', headers: h, body: JSON.stringify({ request, choice }) });
  async function issue(request, h = headers) {
    await starter('daily', h); // The daily pack comes before regular packs.
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
    const home = await (await fetch('/')).text();
    assert.match(home, /ububall/i);
    assert.match(home, /id="rink"/);
    assert.match(home, /id="roster-dialog"/);
    assert.match(home, /class="mint-entry"/);
    assert.match(home, /src="app.js"/);
    const effectsRedirect = await fetch('/effects.html?filter=fire', { redirect: 'manual' });
    assert.equal(effectsRedirect.status, 301);
    assert.equal(new URL(effectsRedirect.headers.get('Location')).pathname + new URL(effectsRedirect.headers.get('Location')).search, '/effects?filter=fire');
    const effectsRes = await fetch('/effects');
    assert.equal(effectsRes.status, 200);
    const effectsHtml = await effectsRes.text();
    assert.match(effectsHtml, /Effects Demo/);
    assert.match(effectsHtml, /src="effects\.js"/);
    const oldMint = await fetch('/mint.html?sort=favorite', { redirect: 'manual' });
    assert.equal(oldMint.status, 301);
    assert.equal(new URL(oldMint.headers.get('Location')).pathname + new URL(oldMint.headers.get('Location')).search, '/mint?sort=favorite');
    assert.equal(await (await fetch('/collection')).text(), home);
    const mint = await (await fetch('/mint')).text();
    assert.match(mint, /Choose your pack/);
    assert.match(mint, /id="pack-choices"/);
    assert.match(mint, /id="collection"/);
    assert.match(mint, /id="play-with-ubus"/);
    assert.match(mint, /href="\/\?roster=1"/);
    const legacy = await fetch('/ububall.html?match=fixture-123');
    assert.equal(legacy.status, 200);
    const legacyText = await legacy.text();
    assert.match(legacyText, /location\.replace\('\/' \+ location\.search/);
    for (const path of ['/ubu-render.js', '/demo.html', '/site.js', '/rarity.js', '/app.js', '/ububall.html', '/ububall.js', '/ububall.css',
      '/ububall-activity.js', '/discord-sdk.js']) assert.equal((await fetch(path)).status, 200);
    for (const path of ['/worker.mjs', '/mint.js', '/auth.mjs', '/AGENTS.md', '/.dev.vars', '/state/mint.sqlite']) assert.equal((await fetch(path)).status, 404);
    const response = await fetch('/api/config'), config = await response.json();
    assert.equal(config.lifetimeLimit, 3); assert.equal(config.keys['test-1'], privateKey.x);
    assert.ok(!JSON.stringify(config).includes(privateKey.d));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });
  await t.test('OAuth return paths navigate correctly through worker endpoints', async () => {
    const mintStart = await fetch('/auth/discord?return=/mint.html', { redirect: 'manual' });
    assert.equal(mintStart.status, 302);
    const stateCookie = mintStart.headers.get('Set-Cookie').split(';')[0];
    const mintState = new URL(mintStart.headers.get('Location')).searchParams.get('state');

    const mintCallback = await callback(new Request(env.ORIGIN + '/auth/callback?code=fixture&state=' + mintState, {
      headers: { Cookie: stateCookie }
    }), env, async url => Response.json(url.endsWith('/token') ? { access_token: 't', token_type: 'Bearer' } : { id: '999999999999999999' }));
    assert.equal(mintCallback.status, 302);
    assert.equal(mintCallback.headers.get('Location'), env.ORIGIN + '/mint.html');

    const matchId = '12345678-1234-4000-8000-123456789abc';
    const matchStart = await fetch('/auth/discord?return=/?match=' + matchId, { redirect: 'manual' });
    assert.equal(matchStart.status, 302);
    const matchStateCookie = matchStart.headers.get('Set-Cookie').split(';')[0];
    const matchState = new URL(matchStart.headers.get('Location')).searchParams.get('state');

    const matchCallback = await callback(new Request(env.ORIGIN + '/auth/callback?code=fixture&state=' + matchState, {
      headers: { Cookie: matchStateCookie }
    }), env, async url => Response.json(url.endsWith('/token') ? { access_token: 't', token_type: 'Bearer' } : { id: '999999999999999999' }));
    assert.equal(matchCallback.status, 302);
    assert.equal(matchCallback.headers.get('Location'), env.ORIGIN + '/?match=' + matchId);

    const evilStart = await fetch('/auth/discord?return=https://evil.example/phish', { redirect: 'manual' });
    assert.equal(evilStart.status, 302);
    const evilCookie = evilStart.headers.get('Set-Cookie').split(';')[0];
    const evilState = new URL(evilStart.headers.get('Location')).searchParams.get('state');
    const evilCallback = await callback(new Request(env.ORIGIN + '/auth/callback?code=fixture&state=' + evilState, {
      headers: { Cookie: evilCookie }
    }), env, async url => Response.json(url.endsWith('/token') ? { access_token: 't', token_type: 'Bearer' } : { id: '999999999999999999' }));
    assert.equal(evilCallback.status, 302);
    assert.equal(evilCallback.headers.get('Location'), env.ORIGIN + '/');
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
  let firstCertificates, dailyCertificates;
  await t.test('starter packs are private to the account, exactly-once and come before regular packs', async () => {
    assert.equal((await fetch('/api/starter')).status, 401);
    assert.equal((await starter('daily', { ...headers, 'X-Ubu-CSRF': 'wrong' })).status, 403);
    assert.equal((await starter('bonus')).status, 400);
    const status = await (await fetch('/api/starter', { headers })).json();
    assert.equal(status.signup, true); assert.equal(status.daily, true);
    assert.ok(status.seconds > 0 && status.seconds <= 86400);
    const blocked = await offer('first_request_0001');
    assert.equal(blocked.status, 409); assert.match((await blocked.json()).error, /daily pack/);
    const attempts = await Promise.all(Array.from({ length: 4 }, () => starter('daily')));
    const packs = await Promise.all(attempts.map(response => response.json()));
    for (const pack of packs) assert.deepEqual(pack, packs[0]);
    dailyCertificates = packs[0].certificates;
    assert.equal(dailyCertificates.length, 3);
    for (const text of dailyCertificates) assert.equal((await file.read(text, { resolveKey: () => keys.publicKey })).type, 'signed');
    const after = await (await fetch('/api/starter', { headers })).json();
    assert.equal(after.signup, true); assert.equal(after.daily, false);
  });
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
    assert.equal(collection.ubus.length, 8);
    const storage = await server.getWorker().getDurableObjectStorage('MINT', { name: env.MINT_ID });
    assert.equal((await storage.exec('SELECT remaining FROM mint_state'))[0].remaining, 3);
    assert.equal((await storage.exec('SELECT COUNT(*) AS count FROM issued'))[0].count, 8);
  });
  await t.test('collection pages and owner-backed favorites survive reloads and reject cross-account writes', async () => {
    const readCollection = async (after = '') => {
      const response = await fetch('/api/ubus' + (after ? '?after=' + after : ''), { headers });
      assert.equal(response.status, 200);
      return response.json();
    };
    const serials = [...firstCertificates, ...dailyCertificates].map(text => JSON.parse(text).serial);
    const recent = await readCollection();
    assert.deepEqual(recent.ubus.map(row => row.serial), [...serials].sort().reverse());
    const middle = recent.ubus[2].serial;
    assert.deepEqual((await readCollection(middle)).ubus.map(row => row.serial),
      recent.ubus.slice(3).map(row => row.serial));
    // The retired sort parameter is ignored, so cached pages from older sites still load.
    assert.deepEqual(await (await fetch('/api/ubus?sort=rarity', { headers })).json(), recent);
    assert.equal((await fetch('/api/ubus?after=000000999999', { headers })).status, 400);
    assert.equal((await fetch('/api/ubus?after=not-a-serial', { headers })).status, 400);

    const favorite = (data, h = headers) => fetch('/api/favorites', {
      method: 'POST', headers: h, body: JSON.stringify(data)
    });
    const target = [...serials].sort()[0];
    assert.equal((await favorite({ serial: target, favorite: true })).status, 200);
    assert.equal((await favorite({ serial: target, favorite: true })).status, 200);
    assert.equal((await favorite({ serial: [target], favorite: true })).status, 400);
    assert.equal((await favorite({ serial: 100000000000, favorite: true })).status, 400);
    let favorites = await readCollection();
    assert.deepEqual(favorites.ubus.filter(row => row.favorite).map(row => row.serial), [target]);
    const another = [...serials].sort()[1];
    assert.equal((await favorite({ serials: [another, '000000999999'] })).status, 200);
    favorites = await readCollection();
    assert.deepEqual(favorites.ubus.filter(row => row.favorite).map(row => row.serial).sort(), [target, another].sort());

    const other = await signedIn('234567890123456789');
    const outsider = { ...headers, Cookie: other.cookie, 'X-Ubu-CSRF': other.csrf };
    assert.equal((await favorite({ serial: target, favorite: false }, outsider)).status, 404);
    assert.equal((await fetch('/api/ubus', { headers: outsider })).status, 200);
    assert.equal((await favorite({ serial: target, favorite: false }, { ...headers, 'X-Ubu-CSRF': 'wrong' })).status, 403);
    assert.equal((await favorite({ serials: [target, 'not-a-serial'] })).status, 400);
    const teams = { teams: [{ name: 'First', slots: serials.slice(0, 3).map(serial => ({ serial, super: null })) }], last: null };
    const postTeams = (data, h = headers) => fetch('/api/teams', { method: 'POST', headers: h, body: JSON.stringify(data) });
    assert.deepEqual(await (await fetch('/api/teams', { headers })).json(), { teams: [], last: null });
    assert.equal((await postTeams(teams)).status, 200);
    assert.equal((await postTeams({ teams: [{ name: 'BadArr', slots: [{ serial: [serials[0]], super: null }, { serial: [serials[0]], super: null }, { serial: [serials[0]], super: null }] }], last: null })).status, 400);
    assert.equal((await postTeams(teams, outsider)).status, 400);
    assert.equal((await postTeams(teams, { ...headers, 'X-Ubu-CSRF': 'wrong' })).status, 403);
    assert.deepEqual(await (await fetch('/api/teams', { headers: outsider })).json(), { teams: [], last: null });
    await server.getWorker().evictDurableObject('MINT', { name: env.MINT_ID });
    assert.deepEqual(await (await fetch('/api/teams', { headers })).json(), teams);
    favorites = await readCollection();
    assert.equal(favorites.ubus.filter(row => row.favorite).length, 2);
    assert.equal((await favorite({ serial: target, favorite: false })).status, 200);
    favorites = await readCollection();
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
    const collection = await (await fetch('/api/ubus', { headers: otherHeaders })).json(); assert.equal(collection.ubus.length, 8);
    const refresh = await fetch('/api/session/refresh', { method: 'POST', headers: otherHeaders });
    assert.equal(refresh.status, 200);
    const refreshed = await refresh.json();
    assert.equal(refreshed.owner, '234567890123456789');
    assert.match(refresh.headers.get('Set-Cookie') || '', /Max-Age=34560000/);
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
    assert.equal(record.next_serial, 209); // The daily pack took three serials ahead of the batch.
  });
  await t.test('pagination walks a collection larger than one page, newest first with pending last', async () => {
    await server.update(options => ({ workers: options.workers.map(worker => ({
      ...worker, vars: { ...worker.vars, LIFETIME_MINT_LIMIT: '20' }
    })) }));
    for (let i = 0; i < 11; i++) {
      const response = await issue('pagination_request_' + String(i).padStart(5, '0'));
      assert.equal(response.status, 200, await response.clone().text());
    }
    const all = await server.getWorker().getDurableObjectStorage('MINT', { name:
      (await (await fetch('/api/config')).json()).mint });
    assert.equal((await all.exec('SELECT COUNT(*) AS n FROM issued WHERE owner=?', '123456789012345678'))[0].n, 63);
    // Pad the collection past one 200-ubu page with stand-in rows (some pending, some sharing a
    // mint time) and remove them afterwards; the endpoint only orders and pages rows.
    for (let i = 0; i < 160; i++) {
      await all.exec(`INSERT INTO issued (id, serial, dna, batch, owner, revision, request, pack_id, quintile, issued_at, key, certificate, favorite)
        VALUES (?, ?, 'x', 0, ?, 1, ?, 'padding', 1, ?, 'test', ?, 0)`, 'padding-' + i, '9000000' + String(i).padStart(5, '0'),
        '123456789012345678', 'padding_' + i, 1700000000 + (i >> 2), i % 10 === 0 ? null : 'padding-certificate');
    }
    try {
      const expected = (await all.exec(`SELECT serial FROM issued WHERE owner=?
        ORDER BY (certificate IS NULL) ASC, issued_at DESC, serial DESC`, '123456789012345678')).map(row => row.serial);
      assert.equal(expected.length, 223);
      const results = [], sizes = [];
      let cursor = '';
      do {
        const response = await fetch('/api/ubus' + (cursor ? '?after=' + cursor : ''), { headers });
        assert.equal(response.status, 200, await response.clone().text());
        const page = await response.json();
        sizes.push(page.ubus.length);
        results.push(...page.ubus.map(row => row.serial));
        cursor = page.next;
      } while (cursor);
      assert.deepEqual(sizes, [200, 23]);
      assert.deepEqual(results, expected);
    } finally {
      await all.exec("DELETE FROM issued WHERE pack_id='padding'");
    }
  });
  await t.test('online invites enforce identity and ownership, hide drafts and persist authoritative turns', async () => {
    const guest = await signedIn('456789012345678901');
    const guestHeaders = { ...headers, Cookie: guest.cookie, 'X-Ubu-CSRF': guest.csrf };
    const post = (path, data, h = headers) => fetch(path, { method: 'POST', headers: h, body: JSON.stringify(data) });
    assert.equal((await fetch('/api/ububall', { method: 'POST' })).status, 401);
    assert.equal((await post('/api/ububall', { mode: 'standard' }, { ...headers, 'X-Ubu-CSRF': 'wrong' })).status, 403);
    assert.equal((await post('/api/ububall', { mode: 'standard', owner: 'forged' })).status, 400);
    assert.equal((await post('/api/ububall', { mode: 'standard', teams: 'owned' })).status, 400);
    assert.equal((await post('/api/ububall', [], guestHeaders)).status, 400);
    assert.equal((await post('/api/ububall', { mode: 'invalid' }, guestHeaders)).status, 400);
    // Invalid match creation requests must not open the caller's signup starter pack as a side effect.
    assert.equal((await (await fetch('/api/starter', { headers: guestHeaders })).json()).signup, true);
    const created = await post('/api/ububall', { mode: 'blitz' });
    assert.equal(created.status, 200, await created.clone().text());
    const { id } = await created.json(), base = '/api/ububall/' + id;
    assert.equal((await fetch(base + '/state', { headers: guestHeaders })).status, 400);
    assert.equal((await post(base + '/join', {}, guestHeaders)).status, 200);
    // Taking a seat opened the joining player's signup pack in the background.
    assert.equal((await (await fetch('/api/starter', { headers: guestHeaders })).json()).signup, false);
    assert.equal((await (await fetch('/api/ubus', { headers: guestHeaders })).json()).ubus.length, 3);
    const outsider = await signedIn('567890123456789012');
    assert.equal((await post(base + '/join', {}, { ...headers, Cookie: outsider.cookie, 'X-Ubu-CSRF': outsider.csrf })).status, 400);
    assert.equal((await (await fetch('/api/starter', { headers: { ...headers, Cookie: outsider.cookie, 'X-Ubu-CSRF': outsider.csrf } })).json()).signup, true);
    assert.equal((await fetch(base + '/socket', { headers: { ...headers, Upgrade: 'websocket', Origin: 'https://evil.example' } })).status, 403);
    async function connect(h, path = '/socket') {
      const response = await fetch(base + path, { headers: { ...h, Upgrade: 'websocket' } });
      assert.equal(response.status, 101, response.status === 101 ? '' : await response.text());
      const ws = response.webSocket, messages = [];
      ws.addEventListener('message', event => messages.push(JSON.parse(event.data))); ws.accept();
      return { ws, messages, async wait(predicate) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const found = messages.find(predicate); if (found) return found;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.fail('Timed out waiting for match state: ' + JSON.stringify(messages.map(m => ({ type: m.type, phase: m.phase, error: m.error }))));
      } };
    }
    const hostSocket = await connect(headers), guestSocket = await connect(guestHeaders);
    t.after(() => { for (const s of [hostSocket, guestSocket]) { try { s.ws.close(); } catch {} } });
    hostSocket.ws.send('{"type":"ping"}');
    await hostSocket.wait(m => m.type === 'pong');
    for (const h of [headers, guestHeaders]) {
      const lobby = await (await fetch(base + '/state', { headers: h })).json();
      assert.equal(lobby.guestTeam, null);
      const { ubus } = await (await fetch('/api/ubus', { headers: h })).json(), team = ubus.slice(0, 3);
      const selection = { serials: team.map(e => e.serial), supers: team.map(e => ubu.decode(ubu.fromCode(JSON.parse(e.certificate).dna)).supers[0] % 8) };
      assert.equal((await post(base + '/team', { ...selection, dna: 'forged' }, h)).status, 400);
      assert.equal((await post(base + '/team', { supers: selection.supers }, h)).status, 400);
      assert.equal((await post(base + '/team', selection, h)).status, 200);
    }
    await hostSocket.wait(m => m.phase === 'plan');
    const watchOff = await (await post(base + '/allow-watch', { allowed: true })).json();
    assert.equal(watchOff.watchKey, null);
    assert.equal((await fetch(base + '/watch-state?key=' + crypto.randomUUID())).status, 404);
    const watchOn = await (await post(base + '/allow-watch', { allowed: true }, guestHeaders)).json();
    assert.ok(watchOn.watchKey);
    const watchQuery = '?key=' + watchOn.watchKey;
    // Standalone watch-state works even when DISCORD_ACTIVITY_BOT_TOKEN is unconfigured (null === null regression).
    await server.update(options => ({ workers: options.workers.map(worker => {
      const { DISCORD_ACTIVITY_BOT_TOKEN, ...restSecrets } = worker.secrets;
      return { ...worker, secrets: restSecrets };
    }) }));
    assert.equal((await fetch(base + '/watch-state' + watchQuery)).status, 200);
    await server.update(options => ({ workers: options.workers.map(worker => ({
      ...worker, secrets: { ...worker.secrets, DISCORD_ACTIVITY_BOT_TOKEN: env.DISCORD_ACTIVITY_BOT_TOKEN }
    })) }));
    const viewer = await connect({ Origin: env.ORIGIN }, '/watch-socket' + watchQuery);
    t.after(() => { try { viewer.ws.close(); } catch {} });
    const watching = await viewer.wait(m => m.phase === 'plan');
    assert.deepEqual(watching.connected, [true, true]);
    assert.equal(watching.spectator, true);
    assert.equal(Object.hasOwn(watching, 'moves'), false);
    assert.equal(Object.hasOwn(watching, 'guestTeam'), false);
    assert.equal(Object.hasOwn(watching, 'seat'), false);
    assert.ok(watching.rosters.flat().every(r => !Object.hasOwn(r, 'serial')));
    const moves = Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false }));
    const hostMoves = structuredClone(moves); hostMoves[0].power = .25;
    hostSocket.ws.send(JSON.stringify({ type: 'moves', turn: 1, moves: hostMoves, lock: true }));
    const privateView = await guestSocket.wait(m => m.phase === 'plan' && m.locked[0]);
    assert.deepEqual(privateView.moves, moves); assert.equal(privateView.replay, null);
    assert.ok(!JSON.stringify(privateView).includes('123456789012345678'));
    viewer.ws.send(JSON.stringify({ type: 'moves', turn: 1, moves, lock: true }));
    const watchPlan = await viewer.wait(m => m.revision === privateView.revision);
    assert.equal(watchPlan.replay, null);
    assert.equal(Object.hasOwn(watchPlan, 'moves'), false);
    guestSocket.ws.send(JSON.stringify({ type: 'moves', turn: 1, moves, lock: true }));
    const result = await hostSocket.wait(m => m.phase === 'resolving');
    assert.equal(result.game.turn, 2); assert.equal(result.replay.plans.length, 6);
    assert.equal(result.replay.initialBodies.length, 7);
    const observed = await viewer.wait(m => m.phase === 'resolving');
    assert.deepEqual(observed.replay.plans, result.replay.plans);
    const nextTurn = await hostSocket.wait(m => m.phase === 'plan' && m.turn === 2);
    assert.equal(nextTurn.locked[0], false);
    // Unlocked drafts persist across Durable Object hibernation/eviction, and missing sockets mark disconnected.
    const unlockedDraft = structuredClone(moves); unlockedDraft[1].power = .4;
    hostSocket.ws.send(JSON.stringify({ type: 'moves', turn: 2, moves: unlockedDraft, lock: false }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const viewerClosed = new Promise(resolve => viewer.ws.addEventListener('close', e => resolve(e.code), { once: true }));
    const revoked = await (await post(base + '/allow-watch', { allowed: false })).json();
    assert.deepEqual(revoked.connected, [true, true]);
    assert.equal(await viewerClosed, 4003);
    assert.equal((await fetch(base + '/watch-state' + watchQuery)).status, 404);
    guestSocket.ws.close();
    const paused = await hostSocket.wait(m => m.turn === 2 && m.connected[1] === false);
    assert.equal(paused.deadline, null); assert.ok(paused.remaining > 0);
    assert.equal((await post(base + '/forfeit', {})).status, 400);
    hostSocket.ws.close();
    await server.getWorker().evictDurableObject('UBUBALL', { name: id });
    const recovered = await (await fetch(base + '/state', { headers })).json();
    assert.equal(recovered.turn, 2); assert.deepEqual(recovered.game.scores, [0, 0]);
    assert.equal(recovered.moves[1].power, .4);
    assert.deepEqual(recovered.connected, [false, false]);

    const owned = await (await post('/api/ububall', { mode: 'classic' })).json();
    const ownedBase = '/api/ububall/' + owned.id;
    await post(ownedBase + '/join', {}, guestHeaders);
    const collection = await (await fetch('/api/ubus', { headers })).json();
    const entries = collection.ubus.slice(0, 3);
    const selection = { serials: entries.map(e => e.serial), supers: entries.map(e => ubu.decode(ubu.fromCode(JSON.parse(e.certificate).dna)).supers[0] % 8) };
    assert.equal((await post(ownedBase + '/team', selection, guestHeaders)).status, 400);
    assert.equal((await post(ownedBase + '/team', { ...selection, serials: [selection.serials[0], selection.serials[0], selection.serials[0]] })).status, 400);
    assert.equal((await post(ownedBase + '/team', selection)).status, 200);
  });
  await t.test('public queue pairs Activity and standalone accounts with a persistent reserved match', async () => {
    const owner = '789012345678901234', instance = 'i-test-activity', origin = 'https://123.discordsays.com';
    const connected = await activityLogin(new Request(env.ORIGIN + '/auth/activity', { headers: { Origin: origin } }),
      env, { code: 'fixture', instance }, async url => Response.json(url.endsWith('/token') ?
        { access_token: 'test-only', token_type: 'Bearer' } : url.endsWith('/users/@me') ? { id: owner } :
          { application_id: '123', instance_id: instance, users: [owner] }));
    const cookie = connected.headers.get('Set-Cookie').split(';')[0];
    const session = await (await fetch('/api/session', { headers: { Cookie: cookie } })).json();
    assert.equal(session.instance, instance);
    const connection = crypto.randomUUID();
    const embedded = { ...headers, Cookie: cookie, Origin: origin, 'X-Ubu-CSRF': session.csrf, 'X-Ubu-Connection': connection };
    assert.equal((await fetch('/api/ububall/lobby', { method: 'POST', headers: embedded, body: JSON.stringify({ action: 'join', instance, connection }) })).status, 200);
    const post = (path, data, h) => fetch(path, { method: 'POST', headers: h, body: JSON.stringify(data) });
    const queuePath = '/api/ububall/queue';
    const queue = (action, h = headers, extra = {}) => post(queuePath, { action, queue: 'public', ...extra }, h);
    assert.equal((await queue('enter', headers, { queue: 'friends' })).status, 403);
    assert.equal((await queue('enter', { ...embedded, Origin: env.ORIGIN })).status, 401);
    assert.deepEqual(await (await queue('enter')).json(), { status: 'waiting' });
    assert.deepEqual(await (await queue('enter')).json(), { status: 'waiting' });
    assert.deepEqual(await (await queue('cancel')).json(), { status: 'idle' });
    assert.deepEqual(await (await queue('poll')).json(), { status: 'idle' });
    assert.deepEqual(await (await queue('enter')).json(), { status: 'waiting' });
    const response = await queue('enter', embedded);
    assert.equal(response.status, 200, await response.clone().text());
    const paired = await response.json();
    assert.equal(paired.status, 'matched');
    assert.deepEqual(await (await queue('poll', embedded, { queue: 'friends', instance })).json(), { status: 'busy' });
    await server.getWorker().evictDurableObject('QUEUE', { name: 'ububall' });
    assert.deepEqual(await (await queue('poll')).json(), paired);
    const path = '/api/ububall/' + paired.id;
    const lobby = await (await post(path + '/join', {}, embedded)).json();
    assert.equal(lobby.seat, 1);
    assert.equal(lobby.matchKind, 'online');
    assert.deepEqual(lobby.occupied, [true, true]);
    const embeddedSocket = await fetch(path + '/socket', { headers: { ...embedded, Upgrade: 'websocket' } });
    assert.equal(embeddedSocket.status, 101, embeddedSocket.status === 101 ? '' : await embeddedSocket.text());
    embeddedSocket.webSocket.accept();
    embeddedSocket.webSocket.close();
    const outsider = await signedIn('890123456789012345');
    assert.equal((await post(path + '/join', {}, { ...headers, Cookie: outsider.cookie, 'X-Ubu-CSRF': outsider.csrf })).status, 400);
    assert.deepEqual(await (await queue('ack', embedded, { id: paired.id })).json(), { status: 'idle' });
    assert.deepEqual(await (await queue('poll')).json(), paired);
    assert.deepEqual(await (await queue('ack', headers, { id: paired.id })).json(), { status: 'idle' });
  });
  await t.test('Activity lobbies isolate members and reserve challenges and instant matches without double pairing', async () => {
    const instance = 'lobby-fixture', origin = 'https://123.discordsays.com';
    async function member(owner, lobby = instance, join = true) {
      const response = await activityLogin(new Request(env.ORIGIN + '/auth/activity', { headers: { Origin: origin } }), env,
        { code: 'fixture', instance: lobby }, async url => Response.json(url.endsWith('/token') ?
          { access_token: 'fixture', token_type: 'Bearer' } : url.endsWith('/users/@me') ?
            { id: owner, global_name: 'Player ' + owner, avatar: 'a'.repeat(32) } :
            { application_id: '123', instance_id: lobby, users: [owner] }));
      const Cookie = response.headers.get('Set-Cookie').split(';')[0];
      const session = await (await fetch('/api/session', { headers: { Cookie } })).json();
      const connection = crypto.randomUUID();
      const player = { owner, instance: lobby, connection,
        profile: await activitySession(new Request(env.ORIGIN, { headers: { Cookie, Origin: origin } }), env),
        headers: { Cookie, Origin: origin, 'X-Ubu-CSRF': session.csrf, 'X-Ubu-Connection': connection, 'Content-Type': 'application/json' } };
      if (join) {
        const joined = await fetch('/api/ububall/lobby', { method: 'POST', headers: player.headers,
          body: JSON.stringify({ action: 'join', instance: lobby, connection }) });
        assert.equal(joined.status, 200, await joined.clone().text());
      }
      return player;
    }
    const a = await member('111111111111111111'), b = await member('222222222222222222');
    const c = await member('333333333333333333'), outsider = await member('444444444444444444', 'other-lobby');
    const post = (path, data, player) => fetch(path, { method: 'POST', headers: player.headers, body: JSON.stringify(data) });
    const lobby = (player, action = 'poll', extra = {}) => post('/api/ububall/lobby', { instance: player.instance, connection: player.connection, action, ...extra }, player);
    const checked = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
    assert.equal((await post('/api/ububall/lobby', { action: 'poll', instance }, { headers })).status, 400);
    assert.equal((await lobby(outsider, 'poll', { instance })).status, 400);
    assert.equal((await lobby(a, 'poll', { target: a.owner, forged: true })).status, 400);
    assert.equal((await lobby(a, 'challenge', { target: [b.owner] })).status, 400);
    assert.equal((await post('/api/ububall/lobby', { instance: a.instance, connection: [a.connection], action: 'poll' }, a)).status, 400);
    const first = await checked(await lobby(a));
    assert.equal(first.users[0].status, 'idle'); assert.equal(first.assignment, null);
    assert.equal(first.users[0].avatar, 'a'.repeat(32));
    await checked(await lobby(b)); await checked(await lobby(c));
    assert.equal((await checked(await lobby(outsider))).users.length, 1);
    const cpuReady = await checked(await lobby(a, 'ready', { cpu: true }));
    assert.equal(cpuReady.users.find(user => user.owner === a.owner).status, 'ready');
    const cpuWaiting = await checked(await lobby(a, 'poll', { cpu: true }));
    assert.equal(cpuWaiting.users.find(user => user.owner === a.owner).status, 'ready');
    await checked(await lobby(a, 'unready', { cpu: true }));
    assert.equal((await lobby(a, 'challenge', { target: outsider.owner })).status, 409);
    let pending = await checked(await lobby(a, 'challenge', { target: b.owner, cpu: true }));
    const cpuChallenge = await checked(await lobby(a, 'poll', { cpu: true }));
    assert.equal(cpuChallenge.challenges[0].id, pending.challenges[0].id);
    const expired = pending.challenges[0].id;
    assert.equal((await lobby(c, 'accept', { id: expired })).status, 409);
    assert.equal((await lobby(a, 'accept', { id: expired })).status, 409);
    const queueStorage = await server.getWorker().getDurableObjectStorage('QUEUE', { name: 'ububall' });
    await queueStorage.exec('UPDATE challenges SET expires = 0 WHERE id = ?', expired);
    assert.equal((await lobby(b, 'accept', { id: expired })).status, 409);
    pending = await checked(await lobby(a, 'challenge', { target: b.owner }));
    await checked(await lobby(b, 'decline', { id: pending.challenges[0].id }));
    assert.equal((await lobby(b, 'accept', { id: expired })).status, 409);
    pending = await checked(await lobby(a, 'challenge', { target: b.owner }));
    await checked(await lobby(a, 'cancel', { id: pending.challenges[0].id }));
    await checked(await post('/api/ububall/queue', { queue: 'public', action: 'enter' }, b));
    assert.equal((await checked(await lobby(b))).users.find(user => user.owner === b.owner).status, 'ready');
    pending = await checked(await lobby(a, 'challenge', { target: b.owner }));
    const attempts = await Promise.all([lobby(b, 'accept', { id: pending.challenges[0].id }), lobby(b, 'accept', { id: pending.challenges[0].id })]);
    assert.deepEqual(attempts.map(response => response.status).sort(), [200, 409]);
    const accepted = await checked(attempts.find(response => response.ok));
    assert.ok(accepted.assignment);
    assert.equal((await checked(await lobby(a))).assignment, accepted.assignment);
    const path = '/api/ububall/' + accepted.assignment;
    let setup = await checked(await post(path + '/join', {}, a));
    assert.equal(setup.phase, 'lobby'); assert.equal(setup.quickStart, false); assert.equal(setup.challenge, true);
    assert.equal((await lobby(b, 'ready')).status, 409);
    await checked(await lobby(a, 'ack', { id: accepted.assignment, match: accepted.assignment }));
    await checked(await lobby(b, 'ack', { id: accepted.assignment, match: accepted.assignment }));
    assert.equal((await lobby(c, 'challenge', { target: a.owner })).status, 409);
    setup = await checked(await post(path + '/rules', { mode: 'classic-pulse', gameNumber: 0 }, a));
    assert.equal(setup.mode, 'classic-pulse'); assert.equal(setup.gameNumber, 1);
    assert.equal((await post(path + '/rules', { mode: 'blitz', gameNumber: 0 }, b)).status, 400);
    assert.equal((await post(path + '/rules', { mode: 'standard', gameNumber: 1 }, c)).status, 400);
    assert.equal(setup.guestTeam, null);
    assert.equal((await post(path + '/team', { serials: ['000000000001'], supers: [0, 0, 0], gameNumber: 1 }, a)).status, 400);
    await checked(await post(path + '/leave', {}, a));
    await checked(await lobby(a)); await checked(await lobby(b));
    const waiting = await checked(await lobby(a, 'ready'));
    assert.equal(waiting.users.find(user => user.owner === a.owner).status, 'ready');
    const paired = await checked(await lobby(b, 'ready'));
    const quickPath = '/api/ububall/' + paired.assignment;
    assert.ok(paired.assignment); assert.notEqual(paired.assignment, accepted.assignment);
    const quick = await checked(await post(quickPath + '/join', {}, a));
    assert.equal(quick.quickStart, true); assert.deepEqual(quick.ready, [true, true]);
    // Ready to play fields each player's own ubus, opening a signup pack that was left unopened.
    for (const player of [a, b]) {
      assert.equal((await (await fetch('/api/starter', { headers: player.headers })).json()).signup, false);
      assert.ok((await (await fetch('/api/ubus', { headers: player.headers })).json()).ubus.length >= 3);
    }
    const sockets = [];
    for (const player of [a, b]) {
      const socket = await fetch(quickPath + '/socket', { headers: { ...player.headers, Upgrade: 'websocket' } });
      assert.equal(socket.status, 101); socket.webSocket.accept(); sockets.push(socket.webSocket);
    }
    setup = await checked(await post(quickPath + '/rules', { mode: 'classic', gameNumber: 0 }, b));
    assert.equal(setup.phase, 'plan'); assert.equal(setup.game.mode, 'classic');
    assert.deepEqual(setup.game.scores, [0, 0]); assert.equal(setup.turn, 1);
    assert.equal(setup.canChangeRules, true);
    async function sendAndWait(socket, payload, predicate) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error('Socket response timed out.')); }, 5000);
        function receive(event) {
          const result = JSON.parse(event.data);
          if (predicate(result)) { clearTimeout(timer); socket.removeEventListener('message', receive); resolve(result); }
        }
        socket.addEventListener('message', receive); socket.send(JSON.stringify(payload));
      });
    }
    const moves = Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false }));
    const stale = await sendAndWait(sockets[0], { type: 'moves', turn: 1, gameNumber: 0, moves, lock: true }, result => result.type === 'error');
    assert.match(stale.error, /game changed/);
    await sendAndWait(sockets[0], { type: 'moves', turn: 1, gameNumber: 1, moves, lock: true }, result => result.type === 'state' && result.locked[0]);
    assert.equal((await post(quickPath + '/rules', { mode: 'pulse', gameNumber: 1 }, b)).status, 400);
    await checked(await post(quickPath + '/allow-watch', { allowed: true }, a));
    const openWatch = await checked(await post(quickPath + '/allow-watch', { allowed: true }, b));
    assert.equal(openWatch.watchAllowed, true); assert.equal(openWatch.watchKey, null);
    assert.equal((await fetch(quickPath + '/activity-watch-state', { headers: c.headers })).status, 200);
    assert.equal((await fetch(quickPath + '/activity-watch-state', { headers: outsider.headers })).status, 404);
    assert.equal((await fetch(quickPath + '/watch-state?key=' + crypto.randomUUID())).status, 404);
    const shared = await checked(await post(quickPath + '/share-watch', {}, a));
    assert.ok(shared.watchKey);
    assert.equal((await fetch(quickPath + '/watch-state?key=' + shared.watchKey)).status, 200);
    const viewerResponse = await fetch(quickPath + '/activity-watch-socket', { headers: { ...c.headers, Upgrade: 'websocket' } });
    assert.equal(viewerResponse.status, 101);
    const viewer = viewerResponse.webSocket;
    const viewerClosed = new Promise(resolve => viewer.addEventListener('close', resolve, { once: true }));
    const viewerEnded = new Promise(resolve => viewer.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.type === 'ended') resolve(message);
    }));
    viewer.accept();
    await sendAndWait(viewer, { type: 'ping' }, result => result.type === 'pong');
    const watching = await checked(await lobby(c, 'poll', { match: paired.assignment }));
    assert.equal(watching.users.find(user => user.owner === c.owner).status, 'spectating');
    await checked(await post(quickPath + '/allow-watch', { allowed: false }, a));
    assert.equal((await viewerEnded).code, 4003);
    try { viewer.close(); } catch { /* close handshake may already be complete */ }
    await Promise.race([viewerClosed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Viewer was not disconnected.')), 3000); timer.unref(); })]);
    assert.equal((await fetch(quickPath + '/activity-watch-state', { headers: c.headers })).status, 404);
    assert.equal((await fetch(quickPath + '/watch-state?key=' + shared.watchKey)).status, 404);
    const revoked = await checked(await lobby(c, 'poll', { match: paired.assignment }));
    assert.equal(revoked.users.find(user => user.owner === c.owner).status, 'idle');
    await queueStorage.exec('UPDATE lobby_members SET expires = 0 WHERE owner = ?', c.owner);
    assert.equal((await checked(await lobby(a))).users.some(user => user.owner === c.owner), false);
    assert.equal((await checked(await lobby(a))).assignment, paired.assignment);
    // Discord's verified membership list drives departure even if the closing client's request is lost.
    await checked(await lobby(c, 'ready'));
    const runtime = await server.getWorker().getEnv();
    const coordinator = runtime.QUEUE.get(runtime.QUEUE.idFromName('ububall'));
    const reconciled = await coordinator.lobby(b.owner, 'activity:' + instance,
      { ...b.profile, name: b.profile.name || 'Player', avatar: b.profile.avatar || null, expires: b.profile.expires * 1000 },
      { action: 'reconcile', connection: b.connection, match: paired.assignment }, { users: [a.owner, b.owner], checkedBefore: Date.now() });
    assert.equal(reconciled.error, undefined);
    assert.equal((await lobby(c)).status, 409);
    assert.equal((await checked(await lobby(b))).users.some(user => user.owner === c.owner), false);
    // A fresh verified Activity replaces the previous connection, forfeiting its game immediately.
    const reopened = await member(a.owner, 'new-activity');
    const ended = await checked(await fetch(quickPath + '/state', { headers: b.headers }));
    assert.equal(ended.phase, 'over'); assert.equal(ended.winner, 1); assert.equal(ended.left[0], true);
    assert.equal((await lobby(a)).status, 409);
    assert.equal((await lobby(a, 'leave')).status, 409);
    const staleQueue = await coordinator.update(a.owner, false, 'activity:' + instance, 'enter', null,
      { instance, launch: a.profile.launch, connection: a.connection });
    assert.equal(await staleQueue.status, 'closed');
    assert.equal((await checked(await lobby(reopened))).users.some(user => user.owner === a.owner), true);
    await checked(await lobby(reopened, 'leave'));
    assert.equal((await lobby(reopened, 'join')).status, 409);
    assert.equal((await fetch(quickPath + '/state', { headers: a.headers })).status, 409);
    const canceledLaunch = await member('555555555555555555', instance, false);
    await checked(await lobby(canceledLaunch, 'leave'));
    await checked(await lobby(canceledLaunch, 'leave'));
    assert.equal((await lobby(canceledLaunch, 'join')).status, 409);
    const beforeReconnect = Date.now();
    await new Promise(resolve => setTimeout(resolve, 2));
    const reconnected = await member(c.owner);
    await coordinator.lobby(b.owner, 'activity:' + instance,
      { ...b.profile, name: b.profile.name, avatar: b.profile.avatar, expires: b.profile.expires * 1000 },
      { action: 'reconcile', connection: b.connection }, { users: [b.owner], checkedBefore: beforeReconnect });
    assert.equal((await lobby(reconnected)).status, 200, 'an older membership snapshot cannot evict a newer connection');
    for (const socket of sockets) socket.close();
  });
  await t.test('guests play given teams against Discord users, never reach the mint and keep their seat on sign-in', async () => {
    assert.equal((await fetch('/api/guest', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
    const start = await fetch('/api/guest', { method: 'POST', headers: { Origin: env.ORIGIN } });
    assert.equal(start.status, 200);
    const guestCookie = start.headers.get('Set-Cookie').split(';')[0], guestSession = await start.json();
    assert.equal(guestSession.owner, null); assert.equal(guestSession.guest, true);
    assert.deepEqual(await (await fetch('/api/session', { headers: { Cookie: guestCookie } })).json(), guestSession);
    const g = { Cookie: guestCookie, Origin: env.ORIGIN, 'Content-Type': 'application/json', 'X-Ubu-CSRF': guestSession.csrf };
    const post = (path, data, h) => fetch(path, { method: 'POST', headers: h, body: JSON.stringify(data) });
    assert.equal((await fetch('/api/ubus', { headers: g })).status, 403);
    assert.equal((await post('/api/favorites', { serials: [] }, g)).status, 403);
    assert.equal((await post('/api/packs', { request: 'guest-request-000001' }, g)).status, 403);
    assert.equal((await post('/api/mint', { request: 'guest-request-000001' }, g)).status, 403);
    assert.equal((await fetch('/api/starter', { headers: g })).status, 403);
    assert.equal((await post('/api/starter', { kind: 'daily' }, g)).status, 403);

    // A guest hosts a match; the Discord opponent picks owned ubus, the guest gets a given team.
    const created = await post('/api/ububall', { mode: 'classic' }, g);
    assert.equal(created.status, 200, await created.clone().text());
    const match = await created.json(), base = '/api/ububall/' + match.id;
    assert.equal(match.guestTeam.length, 3);
    const joined = await (await post(base + '/join', {}, headers)).json();
    assert.equal(joined.guestTeam, null);
    assert.equal((await post(base + '/team', { serials: ['000000000001', '000000000002', '000000000003'], supers: [0, 0, 0] }, g)).status, 400);

    // Discord sign-in from the guest's browser carries the seat over to the Discord account.
    const begin = await login(new Request(env.ORIGIN + '/auth/discord'), env);
    const state = new URL(begin.headers.get('Location')).searchParams.get('state');
    const signed = await callback(new Request(env.ORIGIN + '/auth/callback?code=fixture&state=' + state, {
      headers: { Cookie: begin.headers.get('Set-Cookie').split(';')[0] + '; ' + guestCookie } }), env,
      async url => Response.json(url.endsWith('/token') ? { access_token: 'test-only', token_type: 'Bearer' } : { id: '678901234567890123', username: 'ubufan', global_name: '  Ubu Fan  ' }));
    const discordCookie = signed.headers.getSetCookie().find(c => c.startsWith('__Host-ubu-session=')).split(';')[0];
    const discordSession = await (await fetch('/api/session', { headers: { Cookie: discordCookie } })).json();
    assert.equal(discordSession.name, 'Ubu Fan');
    // Unauthenticated cross-site GET without X-Ubu-CSRF cannot mutate/claim the guest seat.
    assert.equal((await fetch(base + '/state', { headers: { Cookie: discordCookie } })).status, 400);
    const d = { ...g, Cookie: discordCookie, 'X-Ubu-CSRF': discordSession.csrf };
    const claimed = await (await fetch(base + '/state', { headers: d })).json();
    assert.equal(claimed.seat, 0); assert.equal(claimed.guestTeam, null);
    assert.equal((await (await fetch('/api/ubus', { headers: d })).json()).ubus.length, 3);
    assert.equal((await fetch(base + '/state', { headers: g })).status, 400);
    const rematch = await post(base + '/rematch', {}, d);
    assert.equal(rematch.status, 400); assert.match((await rematch.json()).error, /not over/);
    const skip = await post(base + '/skip-replay', { startedAt: 1000 }, d);
    assert.equal(skip.status, 200);
    assert.equal((await skip.json()).phase, 'lobby');
    assert.equal((await post(base + '/skip-replay', { startedAt: 1000 }, g)).status, 400);
    assert.deepEqual(claimed.names, ['Ubu Fan', null]);
    // The lobby opponent leaving frees their seat; the host leaving closes the match.
    assert.deepEqual(await (await post(base + '/leave', {}, headers)).json(), { left: true });
    assert.equal((await fetch(base + '/state', { headers })).status, 400);
    assert.equal((await (await fetch(base + '/state', { headers: d })).json()).occupied[1], false);
    assert.equal((await post(base + '/leave', {}, d)).status, 200);
    assert.equal((await (await fetch(base + '/state', { headers: d })).json()).phase, 'over');
  });
});
