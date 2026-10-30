import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestHarness } from 'wrangler';
import { login, callback } from '../server/auth.mjs';
import file from '../shared/ubu-file.js';
import ubu from '../shared/ubu.js';

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
    const home = await (await fetch('/')).text();
    assert.match(home, /ububall/i);
    assert.match(home, /id="rink"/);
    assert.match(home, /id="roster-dialog"/);
    assert.match(home, /class="mint-entry"/);
    const mint = await (await fetch('/mint.html')).text();
    assert.match(mint, /Packs/);
    assert.match(mint, /id="pack-choices"/);
    assert.match(mint, /id="collection"/);
    assert.match(mint, /id="play-with-ubus"/);
    assert.match(mint, /href="\/\?roster=1"/);
    const legacy = await fetch('/ububall.html?match=fixture-123');
    assert.equal(legacy.status, 200);
    const legacyText = await legacy.text();
    assert.match(legacyText, /location\.replace\('\/' \+ location\.search/);
    for (const path of ['/ubu-render.js', '/demo.html', '/site.js', '/rarity.js', '/mint.html', '/ububall.html', '/ububall.js', '/ububall.css']) assert.equal((await fetch(path)).status, 200);
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
  await t.test('online invites enforce identity and ownership, hide drafts and persist authoritative turns', async () => {
    const guest = await signedIn('456789012345678901');
    const guestHeaders = { ...headers, Cookie: guest.cookie, 'X-Ubu-CSRF': guest.csrf };
    const post = (path, data, h = headers) => fetch(path, { method: 'POST', headers: h, body: JSON.stringify(data) });
    assert.equal((await fetch('/api/ububall', { method: 'POST' })).status, 401);
    assert.equal((await post('/api/ububall', { mode: 'standard', teams: 'practice' }, { ...headers, 'X-Ubu-CSRF': 'wrong' })).status, 403);
    assert.equal((await post('/api/ububall', { mode: 'standard', teams: 'practice', owner: 'forged' })).status, 400);
    const created = await post('/api/ububall', { mode: 'blitz', teams: 'practice' });
    assert.equal(created.status, 200, await created.clone().text());
    const { id } = await created.json(), base = '/api/ububall/' + id;
    assert.equal((await fetch(base + '/state', { headers: guestHeaders })).status, 400);
    assert.equal((await post(base + '/join', {}, guestHeaders)).status, 200);
    const outsider = await signedIn('567890123456789012');
    assert.equal((await post(base + '/join', {}, { ...headers, Cookie: outsider.cookie, 'X-Ubu-CSRF': outsider.csrf })).status, 400);
    assert.equal((await fetch(base + '/socket', { headers: { ...headers, Upgrade: 'websocket', Origin: 'https://evil.example' } })).status, 403);
    async function connect(h) {
      const response = await fetch(base + '/socket', { headers: { ...h, Upgrade: 'websocket' } });
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
      const supers = lobby.practice.map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
      assert.equal((await post(base + '/team', { supers, dna: 'forged' }, h)).status, 400);
      assert.equal((await post(base + '/team', { supers }, h)).status, 200);
    }
    await hostSocket.wait(m => m.phase === 'plan');
    const moves = Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false }));
    const hostMoves = structuredClone(moves); hostMoves[0].power = .25;
    hostSocket.ws.send(JSON.stringify({ type: 'moves', turn: 1, moves: hostMoves, lock: true }));
    const privateView = await guestSocket.wait(m => m.phase === 'plan' && m.locked[0]);
    assert.deepEqual(privateView.moves, moves); assert.equal(privateView.replay, null);
    assert.ok(!JSON.stringify(privateView).includes('123456789012345678'));
    guestSocket.ws.send(JSON.stringify({ type: 'moves', turn: 1, moves, lock: true }));
    const result = await hostSocket.wait(m => m.phase === 'resolving');
    assert.equal(result.game.turn, 2); assert.equal(result.replay.plans.length, 6);
    assert.equal(result.replay.initialBodies.length, 7);
    const nextTurn = await hostSocket.wait(m => m.phase === 'plan' && m.turn === 2);
    assert.equal(nextTurn.locked[0], false);
    guestSocket.ws.close();
    const paused = await hostSocket.wait(m => m.turn === 2 && m.connected[1] === false);
    assert.equal(paused.deadline, null); assert.ok(paused.remaining > 0);
    assert.equal((await post(base + '/forfeit', {})).status, 400);
    hostSocket.ws.close();
    await server.getWorker().evictDurableObject('UBUBALL', { name: id });
    const recovered = await (await fetch(base + '/state', { headers })).json();
    assert.equal(recovered.turn, 2); assert.deepEqual(recovered.game.scores, [0, 0]);

    const owned = await (await post('/api/ububall', { mode: 'classic', teams: 'owned' })).json();
    const ownedBase = '/api/ububall/' + owned.id;
    await post(ownedBase + '/join', {}, guestHeaders);
    const collection = await (await fetch('/api/ubus', { headers })).json();
    const entries = collection.ubus.slice(0, 3);
    const selection = { serials: entries.map(e => e.serial), supers: entries.map(e => ubu.decode(ubu.fromCode(JSON.parse(e.certificate).dna)).supers[0] % 8) };
    assert.equal((await post(ownedBase + '/team', selection, guestHeaders)).status, 400);
    assert.equal((await post(ownedBase + '/team', { ...selection, serials: [selection.serials[0], selection.serials[0], selection.serials[0]] })).status, 400);
    assert.equal((await post(ownedBase + '/team', selection)).status, 200);
  });
  await t.test('guests play practice teams against Discord users, never reach the mint and keep their seat on sign-in', async () => {
    assert.equal((await fetch('/api/guest', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403);
    const start = await fetch('/api/guest', { method: 'POST', headers: { Origin: env.ORIGIN } });
    assert.equal(start.status, 200);
    const guestCookie = start.headers.get('Set-Cookie').split(';')[0], guestSession = await start.json();
    assert.equal(guestSession.owner, null); assert.equal(guestSession.guest, true);
    assert.deepEqual(await (await fetch('/api/session', { headers: { Cookie: guestCookie } })).json(), guestSession);
    const g = { Cookie: guestCookie, Origin: env.ORIGIN, 'X-Ubu-CSRF': guestSession.csrf, 'Content-Type': 'application/json' };
    const post = (path, data, h) => fetch(path, { method: 'POST', headers: h, body: JSON.stringify(data) });
    assert.equal((await fetch('/api/ubus', { headers: g })).status, 403);
    assert.equal((await post('/api/favorites', { serials: [] }, g)).status, 403);
    assert.equal((await post('/api/packs', { request: 'guest-request-000001' }, g)).status, 403);
    assert.equal((await post('/api/mint', { request: 'guest-request-000001' }, g)).status, 403);

    // A guest hosts an owned-team match; the Discord opponent picks owned ubus, the guest gets a practice team.
    const created = await post('/api/ububall', { mode: 'classic', teams: 'owned' }, g);
    assert.equal(created.status, 200, await created.clone().text());
    const match = await created.json(), base = '/api/ububall/' + match.id;
    assert.equal(match.practice.length, 3);
    const joined = await (await post(base + '/join', {}, headers)).json();
    assert.equal(joined.practice, null);
    assert.equal((await post(base + '/team', { serials: ['000000000001', '000000000002', '000000000003'], supers: [0, 0, 0] }, g)).status, 400);

    // Discord sign-in from the guest's browser carries the seat over to the Discord account.
    const begin = await login(new Request(env.ORIGIN + '/auth/discord'), env);
    const state = new URL(begin.headers.get('Location')).searchParams.get('state');
    const signed = await callback(new Request(env.ORIGIN + '/auth/callback?code=fixture&state=' + state, {
      headers: { Cookie: begin.headers.get('Set-Cookie').split(';')[0] + '; ' + guestCookie } }), env,
      async url => Response.json(url.endsWith('/token') ? { access_token: 'test-only', token_type: 'Bearer' } : { id: '678901234567890123' }));
    const discordCookie = signed.headers.getSetCookie().find(c => c.startsWith('__Host-ubu-session=')).split(';')[0];
    const discordSession = await (await fetch('/api/session', { headers: { Cookie: discordCookie } })).json();
    const d = { ...g, Cookie: discordCookie, 'X-Ubu-CSRF': discordSession.csrf };
    const claimed = await (await fetch(base + '/state', { headers: d })).json();
    assert.equal(claimed.seat, 0); assert.equal(claimed.practice, null);
    assert.equal((await fetch(base + '/state', { headers: g })).status, 400);
    const rematch = await post(base + '/rematch', {}, d);
    assert.equal(rematch.status, 400); assert.match((await rematch.json()).error, /not over/);
  });
});
