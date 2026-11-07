import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as auth from '../server/auth.mjs';
const env = { ORIGIN: 'https://mint.example', DISCORD_CLIENT_ID: '123', DISCORD_CLIENT_SECRET: 'test-only', SESSION_SECRET: Buffer.alloc(32, 7).toString('base64url') };
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
  const cookie = result.headers.getSetCookie().find(value => value.startsWith('__Host-ubu-session='));
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
test('invalid OAuth state and invalid Discord identities never create a session', async () => {
  let calls = 0;
  const { stateCookie } = await authorize();
  const result = await auth.callback(new Request(env.ORIGIN + '/auth/callback?code=x&state=wrong', { headers: { Cookie: stateCookie } }), env,
    async () => { calls++; throw new Error('must not call Discord'); });
  assert.equal(result.status, 400); assert.equal(calls, 0);
  assert.ok(!result.headers.get('Set-Cookie').includes('__Host-ubu-session'));
  assert.equal((await authorize({ id: '../bad' })).result.status, 400);
  assert.throws(() => auth.origin({ ORIGIN: 'http://evil.example' }));
  assert.throws(() => auth.origin({ ORIGIN: 'https://mint.example/path' }));
});

test('Discord login return navigation preserves safe paths and rejects malicious destinations', async () => {
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
    '/auth/discord?return=/bad%0D%0ALocation:evil.example'
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
  const discord = result.headers.getSetCookie().find(c => c.startsWith('__Host-ubu-session=')).split(';')[0];
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

test('refreshProfile updates user identity via Discord bot API without re-auth', async () => {
  const activityEnv = { ...env, DISCORD_ACTIVITY_BOT_TOKEN: 'test-bot' };
  const session = { purpose: 'session', owner: '123456789012345678', name: 'Old Name', csrf: 'A'.repeat(43) };
  let calledUrl = '', calledAuth = '';
  const mockFetch = async (url, options) => {
    calledUrl = url;
    calledAuth = options.headers.Authorization;
    return Response.json({ id: '123456789012345678', global_name: 'New Name' });
  };
  const result = await auth.refreshProfile(session, activityEnv, mockFetch);
  assert.equal(result.session.name, 'New Name');
  assert.equal(calledUrl, 'https://discord.com/api/v10/users/123456789012345678');
  assert.equal(calledAuth, 'Bot test-bot');
  assert.match(result.cookie, /Max-Age=34560000/);

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
