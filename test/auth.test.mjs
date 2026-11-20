import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as auth from '../server/auth.mjs';
const env = { ORIGIN: 'https://mint.example', DISCORD_CLIENT_ID: '123', DISCORD_CLIENT_SECRET: 'test-only', SESSION_SECRET: Buffer.alloc(32, 7).toString('base64url') };
const getSetCookies = headers => typeof headers.getSetCookie === 'function'
  ? headers.getSetCookie()
  : (headers.get('set-cookie') || '').split(/,\s*(?=__(?:Host|Secure)-)/).filter(Boolean);
async function authorize(overrides = {}, loginPath = '/auth/discord') {
  const login = await auth.login(new Request(env.ORIGIN + loginPath), env);
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const stateCookie = login.headers.get('Set-Cookie').split(';')[0];
  const request = new Request(env.ORIGIN + '/auth/callback?code=test-code&state=' + state, { headers: { Cookie: stateCookie } });
  const calls = [];
  const result = await auth.callback(request, env, async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.endsWith('/token') ? { access_token: 'temporary', token_type: 'Bearer' } : { id: '123456789012345678', ...overrides });
  });
  return { result, calls, state, stateCookie };
}
test('Discord login validates state, exchanges credentials server-side and seals an HttpOnly session', async () => {
  const { result, calls } = await authorize();
  assert.equal(result.status, 302); assert.equal(result.headers.get('Location'), env.ORIGIN + '/');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body.get('client_secret'), env.DISCORD_CLIENT_SECRET);
  assert.equal(calls[0].options.body.get('redirect_uri'), env.ORIGIN + '/auth/callback');
  const cookie = getSetCookies(result.headers).find(value => value.startsWith('__Host-ubu-session='));
  assert.match(cookie, /Secure; HttpOnly; SameSite=Lax/);
  assert.match(cookie, /Max-Age=34560000/);
  assert.ok(!cookie.includes('temporary'));
  const request = new Request(env.ORIGIN + '/api/session', { headers: { Cookie: cookie.split(';')[0] } });
  const session = await auth.session(request, env);
  assert.equal(session.owner, '123456789012345678');
  assert.equal(session.expires, undefined);
  assert.match(auth.refreshCookie(request), /Max-Age=34560000/);
  assert.equal(auth.mutationAllowed(new Request(env.ORIGIN, { headers: { Origin: env.ORIGIN, 'X-Ubu-CSRF': session.csrf } }), env, session), true);
  assert.equal(auth.mutationAllowed(new Request(env.ORIGIN, { headers: { Origin: 'https://evil.example', 'X-Ubu-CSRF': session.csrf } }), env, session), false);
  assert.equal(auth.mutationAllowed(new Request(env.ORIGIN), env, session), false);
  const forged = cookie.split(';')[0].replace('=', '=x');
  assert.equal(await auth.session(new Request(env.ORIGIN, { headers: { Cookie: forged } }), env), null);
  assert.equal(await auth.session(request, { ...env, SESSION_SECRET: Buffer.alloc(32, 8).toString('base64url') }), null);
});
test('invalid OAuth state, oversized codes, placeholder secrets and invalid Discord identities never create a session', async () => {
  let calls = 0;
  const { stateCookie, state } = await authorize();
  const result = await auth.callback(new Request(env.ORIGIN + '/auth/callback?code=x&state=wrong', { headers: { Cookie: stateCookie } }), env,
    async () => { calls++; throw new Error('must not call Discord'); });
  assert.equal(result.status, 400); assert.equal(calls, 0);
  assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.ok(!result.headers.get('Set-Cookie').includes('__Host-ubu-session'));
  const hugeCode = await auth.callback(new Request(env.ORIGIN + '/auth/callback?code=' + 'a'.repeat(1025) + '&state=' + state, { headers: { Cookie: stateCookie } }), env,
    async () => { calls++; throw new Error('must not call Discord on oversized code'); });
  assert.equal(hugeCode.status, 400); assert.equal(calls, 0);
  assert.equal((await authorize({ id: '../bad' })).result.status, 400);
  assert.throws(() => auth.origin({ ORIGIN: 'http://evil.example' }));
  assert.throws(() => auth.origin({ ORIGIN: 'https://mint.example/path' }));
  assert.equal(auth.configured(env), true);
  assert.equal(auth.configured({ ...env, DISCORD_CLIENT_ID: '<Discord application ID>' }), false);
  assert.equal(auth.configured({ ...env, DISCORD_CLIENT_SECRET: '<Discord application secret>' }), false);
  assert.equal(auth.configured({ ...env, SESSION_SECRET: 'A'.repeat(42) + 'B' }), false);
  assert.equal(auth.configured({ ...env, ORIGIN: 'http://evil.example' }), false);
});

test('Discord login return navigation preserves safe paths and rejects malicious or oversized destinations', async () => {
  const normal = await authorize();
  assert.equal(normal.result.headers.get('Location'), env.ORIGIN + '/');

  const mint = await authorize({}, '/auth/discord?return=/mint.html');
  assert.equal(mint.result.headers.get('Location'), env.ORIGIN + '/mint.html');

  const invite = await authorize({}, '/auth/discord?return=/?match=12345678-1234-4000-8000-123456789abc');
  assert.equal(invite.result.headers.get('Location'), env.ORIGIN + '/?match=12345678-1234-4000-8000-123456789abc');

  const returnTo = await authorize({}, '/auth/discord?return_to=/mint.html?sort=favorite');
  assert.equal(returnTo.result.headers.get('Location'), env.ORIGIN + '/mint.html?sort=favorite');

  for (const evil of [
    '/auth/discord?return=https://evil.example/steal',
    '/auth/discord?return=//evil.example/steal',
    '/auth/discord?return=/\\evil.example/steal',
    '/auth/discord?return=\\\\evil.example/steal',
    '/auth/discord?return=javascript:alert(1)',
    '/auth/discord?return=data:text/html,bad',
    '/auth/discord?return=/auth/discord',
    '/auth/discord?return=/api/session',
    '/auth/discord?return=/bad%0D%0ALocation:evil.example',
    '/auth/discord?return=/' + 'a'.repeat(600)
  ]) {
    const res = await authorize({}, evil);
    assert.equal(res.result.headers.get('Location'), env.ORIGIN + '/');
  }

  const login = await auth.login(new Request(env.ORIGIN + '/auth/discord?return=/mint.html'), env);
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const stateCookie = login.headers.get('Set-Cookie').split(';')[0];
  const callbackReq = new Request(env.ORIGIN + '/auth/callback?code=test-code&state=' + state + '&return=https://evil.example', {
    headers: { Cookie: stateCookie }
  });
  const res = await auth.callback(callbackReq, env, async url => Response.json(url.endsWith('/token') ? { access_token: 't', token_type: 'Bearer' } : { id: '123' }));
  assert.equal(res.headers.get('Location'), env.ORIGIN + '/mint.html');
});

test('guest sessions are distinct from Discord identities and Discord login records the replaced guest', async () => {
  const guest = await auth.guest(env);
  const cookie = guest.cookie.split(';')[0];
  const value = await auth.session(new Request(env.ORIGIN, { headers: { Cookie: cookie } }), env);
  assert.equal(value.guest, true); assert.match(value.owner, /^g_[A-Za-z0-9_-]{43}$/);
  const login = await auth.login(new Request(env.ORIGIN + '/auth/discord'), env);
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const result = await auth.callback(new Request(env.ORIGIN + '/auth/callback?code=x&state=' + state, {
    headers: { Cookie: login.headers.get('Set-Cookie').split(';')[0] + '; ' + cookie } }), env,
    async url => Response.json(url.endsWith('/token') ? { access_token: 't', token_type: 'Bearer' } : { id: '123456789012345678' }));
  const discord = getSetCookies(result.headers).find(c => c.startsWith('__Host-ubu-session=')).split(';')[0];
  const upgraded = await auth.session(new Request(env.ORIGIN, { headers: { Cookie: discord } }), env);
  assert.equal(upgraded.owner, '123456789012345678'); assert.equal(upgraded.alias, value.owner); assert.equal(upgraded.guest, undefined);
});

test('Discord logins last indefinitely while guest sessions and OAuth states expire', async () => {
  const expiredDiscord = await auth.seal({ purpose: 'session', owner: '123456789012345678', csrf: 'A'.repeat(43), expires: 1000 }, env.SESSION_SECRET);
  const discordSession = await auth.session(new Request(env.ORIGIN, { headers: { Cookie: `__Host-ubu-session=${expiredDiscord}` } }), env);
  assert.equal(discordSession?.owner, '123456789012345678');

  const expiredGuest = await auth.seal({ purpose: 'session', owner: 'g_' + 'A'.repeat(43), guest: true, csrf: 'A'.repeat(43), expires: 1000 }, env.SESSION_SECRET);
  const guestSession = await auth.session(new Request(env.ORIGIN, { headers: { Cookie: `__Host-ubu-session=${expiredGuest}` } }), env);
  assert.equal(guestSession, null);
});

test('Activity sign-in verifies Discord membership and creates a separate partitioned session', async () => {
  const activity = { ...env, DISCORD_ACTIVITY_BOT_TOKEN: 'test-bot' };
  const origin = 'https://123.discordsays.com', instance = 'i-test-instance', owner = '123456789012345678';
  const login = source => new Request(env.ORIGIN + '/auth/activity', { method: 'POST', headers: { Origin: source } });
  const mockDiscord = async (url, options) => {
    if (url.endsWith('/token')) {
      assert.equal(options.body.get('client_secret'), env.DISCORD_CLIENT_SECRET);
      assert.equal(options.body.get('redirect_uri'), null);
      return Response.json({ access_token: 'sdk-token', token_type: 'Bearer', refresh_token: 'private-refresh' });
    }
    if (url.endsWith('/users/@me')) return Response.json({ id: owner });
    assert.equal(options.headers.Authorization, 'Bot test-bot');
    return Response.json({ application_id: '123', instance_id: instance, users: [owner] });
  };
  const payload = { instance, code: 'test-code' };
  assert.equal((await auth.activityLogin(login(env.ORIGIN), activity, payload, () => assert.fail())).status, 403);
  assert.equal((await auth.activityLogin(login(origin), activity, { ...payload, instance: 'i-other' }, mockDiscord)).status, 403);
  const result = await auth.activityLogin(login(origin), activity, payload, mockDiscord);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(await result.json(), { access_token: 'sdk-token' });
  const setCookie = result.headers.get('Set-Cookie');
  assert.match(setCookie, /Domain=123\.discordsays\.com; Path=\/; Secure; HttpOnly; SameSite=None; Partitioned/);
  const Cookie = setCookie.split(';')[0];
  const session = await auth.session(new Request(env.ORIGIN + '/api/session', { headers: { Cookie } }), activity);
  assert.equal(session.instance, instance);
  assert.equal(session.owner, owner);
  assert.equal(await auth.session(new Request(env.ORIGIN, { headers: { Cookie, Origin: env.ORIGIN } }), activity), null);
  const request = new Request(env.ORIGIN, { headers: { Cookie, Origin: origin, 'X-Ubu-CSRF': session.csrf } });
  assert.equal(auth.mutationAllowed(request, activity, session), true);
  assert.equal(auth.mutationAllowed(login(env.ORIGIN), activity, session), false);
  assert.match(auth.logoutCookie(activity, session), /Partitioned; Max-Age=0/);
});

test('refreshProfile updates user identity via Discord bot API, enforces cooldown, and checks user ID', async () => {
  const activityEnv = { ...env, DISCORD_ACTIVITY_BOT_TOKEN: 'test-bot' };
  const session = { purpose: 'session', owner: '123456789012345678', name: 'Old Name', csrf: 'A'.repeat(43) };
  let calledUrl = '', calledAuth = '', fetchCount = 0;
  const mockFetch = async (url, options) => {
    fetchCount++;
    calledUrl = url;
    calledAuth = options.headers.Authorization;
    return Response.json({ id: '123456789012345678', global_name: 'New Name' });
  };
  const result = await auth.refreshProfile(session, activityEnv, mockFetch);
  assert.equal(result.session.name, 'New Name');
  assert.equal(fetchCount, 1);
  assert.equal(calledUrl, 'https://discord.com/api/v10/users/123456789012345678');
  assert.equal(calledAuth, 'Bot test-bot');
  assert.match(result.cookie, /Max-Age=34560000/);

  // Immediate repeat refresh with the newly issued session cookie skips Discord Bot API call.
  const refreshedSession = await auth.session(new Request(env.ORIGIN, { headers: { Cookie: result.cookie.split(';')[0] } }), activityEnv);
  const throttled = await auth.refreshProfile(refreshedSession, activityEnv, () => assert.fail('must throttle repeat bot API fetch'));
  assert.equal(throttled.session.name, 'New Name');

  // Mismatched Discord user.id is ignored safely.
  const mismatch = await auth.refreshProfile(session, activityEnv, async () => Response.json({ id: '999999999999999999', global_name: 'Spoof' }));
  assert.equal(mismatch.session.name, 'Old Name');

  // Activity session clamps Max-Age to remaining lifetime instead of resetting to 86400s.
  const expires = Math.floor(Date.now() / 1000) + 120;
  const actResult = await auth.refreshProfile({ purpose: 'activity', owner: '123456789012345678', instance: 'i-1', launch: 'l-1', issued: 1, expires, csrf: 'A'.repeat(43) },
    activityEnv, async () => Response.json({ id: '123456789012345678', global_name: 'Act', avatar: 'a'.repeat(32) }));
  const maxAge = Number(/Max-Age=(\d+)/.exec(actResult.cookie)[1]);
  assert.ok(maxAge > 0 && maxAge <= 120);

  // If Discord API fails or has no bot token, gracefully keeps existing name and refreshes cookie
  const failingFetch = async () => Response.json({}, { status: 500 });
  const fallback = await auth.refreshProfile(session, activityEnv, failingFetch);
  assert.equal(fallback.session.name, 'Old Name');
  assert.match(fallback.cookie, /Max-Age=34560000/);

  const noBotEnv = { ...env, DISCORD_ACTIVITY_BOT_TOKEN: undefined };
  const noBot = await auth.refreshProfile(session, noBotEnv);
  assert.equal(noBot.session.name, 'Old Name');
  assert.match(noBot.cookie, /Max-Age=34560000/);
});

test('mobile PKCE OAuth flow issues Bearer session, upgrades mobile guests, and enforces https://localhost origin', async () => {
  const verifier = Buffer.alloc(32, 9).toString('base64url');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString('base64url');

  // Missing or malformed challenge on android login fails closed.
  assert.equal((await auth.login(new Request(env.ORIGIN + '/auth/discord?platform=android'), env)).status, 400);
  assert.equal((await auth.login(new Request(env.ORIGIN + '/auth/discord?platform=android&challenge=short'), env)).status, 400);

  // Start mobile guest session first to verify seat alias preservation.
  const guestCreated = await auth.guest(env, { mobile: true });
  assert.equal(guestCreated.cookie, null);
  assert.ok(guestCreated.token);
  const guestReq = new Request(env.ORIGIN + '/api/session', {
    headers: { Origin: auth.MOBILE_ORIGIN, Authorization: `Bearer ${guestCreated.token}` }
  });
  const guestSession = await auth.session(guestReq, env);
  assert.equal(guestSession.guest, true);
  assert.equal(guestSession.mobile, true);

  // Start mobile Discord OAuth in Custom Tabs.
  const start = await auth.login(new Request(
    `${env.ORIGIN}/auth/discord?platform=android&challenge=${challenge}&return=${encodeURIComponent('/?match=12345678-1234-4000-8000-123456789abc')}`
  ), env);
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const stateCookie = start.headers.get('Set-Cookie').split(';')[0];

  const cb = await auth.callback(new Request(`${env.ORIGIN}/auth/callback?code=mob-code&state=${state}`, {
    headers: { Cookie: stateCookie }
  }), env, async url => Response.json(url.endsWith('/token') ? { access_token: 'tok', token_type: 'Bearer' } : { id: '123456789012345678', global_name: 'PixelPlayer' }));
  assert.equal(cb.status, 302);
  const redirectLoc = cb.headers.get('Location');
  assert.ok(redirectLoc.startsWith(env.ORIGIN + '/auth-complete.html?mobile=1#ticket='));
  assert.ok(!(cb.headers.get('Set-Cookie') || '').includes('__Host-ubu-session='));
  const ticket = new URL(redirectLoc).hash.slice('#ticket='.length);

  // Wrong origin or wrong PKCE verifier is rejected.
  const wrongOrigin = await auth.mobileExchange(new Request(env.ORIGIN + '/api/auth/mobile', {
    method: 'POST', headers: { Origin: env.ORIGIN }
  }), env, { ticket, verifier });
  assert.equal(wrongOrigin.status, 403);

  const wrongVerifier = await auth.mobileExchange(new Request(env.ORIGIN + '/api/auth/mobile', {
    method: 'POST', headers: { Origin: auth.MOBILE_ORIGIN }
  }), env, { ticket, verifier: Buffer.alloc(32, 5).toString('base64url') });
  assert.equal(wrongVerifier.status, 403);

  // Valid exchange from https://localhost upgrades guest session and returns Bearer token + CORS header.
  const exReq = new Request(env.ORIGIN + '/api/auth/mobile', {
    method: 'POST',
    headers: { Origin: auth.MOBILE_ORIGIN, Authorization: `Bearer ${guestCreated.token}` }
  });
  const exRes = await auth.mobileExchange(exReq, env, { ticket, verifier });
  assert.equal(exRes.status, 200);
  assert.equal(exRes.headers.get('Access-Control-Allow-Origin'), auth.MOBILE_ORIGIN);
  const exBody = await exRes.json();
  assert.equal(exBody.owner, '123456789012345678');
  assert.equal(exBody.name, 'PixelPlayer');
  assert.equal(exBody.returnTo, '/?match=12345678-1234-4000-8000-123456789abc');
  assert.ok(exBody.token);

  // Authenticated mobile request validates Bearer + https://localhost + X-Ubu-CSRF, rejecting evil origins or cookie mixups.
  const authedReq = new Request(env.ORIGIN + '/api/teams', {
    method: 'POST',
    headers: { Origin: auth.MOBILE_ORIGIN, Authorization: `Bearer ${exBody.token}`, 'X-Ubu-CSRF': exBody.csrf }
  });
  const mobSession = await auth.session(authedReq, env);
  assert.equal(mobSession.owner, '123456789012345678');
  assert.equal(mobSession.alias, guestSession.owner);
  assert.equal(mobSession.mobile, true);
  assert.equal(auth.mutationAllowed(authedReq, env, mobSession), true);
  assert.equal(auth.mutationAllowed(new Request(env.ORIGIN + '/api/teams', {
    method: 'POST', headers: { Origin: env.ORIGIN, Authorization: `Bearer ${exBody.token}`, 'X-Ubu-CSRF': exBody.csrf }
  }), env, mobSession), false);
  assert.equal(await auth.session(new Request(env.ORIGIN + '/api/session', {
    headers: { Origin: 'https://evil.example', Authorization: `Bearer ${exBody.token}` }
  }), env), null);

  // Profile refresh for mobile returns updated Bearer token with null cookie.
  const refreshed = await auth.refreshProfile(mobSession, { ...env, DISCORD_ACTIVITY_BOT_TOKEN: 'bot' },
    async () => Response.json({ id: '123456789012345678', global_name: 'RenamedPixel' }));
  assert.equal(refreshed.cookie, null);
  assert.equal(refreshed.session.name, 'RenamedPixel');
  assert.ok(refreshed.session.token);
});

test('match-scoped WebSocket tickets bind strictly to match ID and expire cleanly', async () => {
  const matchA = '12345678-1234-4000-8000-123456789abc';
  const matchB = '87654321-1234-4000-8000-123456789abc';
  const mobSession = { purpose: 'mobile', mobile: true, owner: '123456789012345678', name: 'PixelPlayer', csrf: 'A'.repeat(43) };
  const ticket = await auth.issueSocketTicket(mobSession, matchA, env);
  const verified = await auth.verifySocketTicket(ticket, matchA, env);
  assert.equal(verified.owner, '123456789012345678');
  assert.equal(verified.mobile, true);
  assert.equal(auth.requestOrigin(env, verified), auth.MOBILE_ORIGIN);
  assert.equal(await auth.verifySocketTicket(ticket, matchB, env), null);

  const expired = await auth.seal({
    purpose: 'socket', match: matchA, owner: '123456789012345678', mobile: true, csrf: 'A'.repeat(43), expires: 1000
  }, env.SESSION_SECRET);
  assert.equal(await auth.verifySocketTicket(expired, matchA, env), null);
});
