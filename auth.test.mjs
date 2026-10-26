import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as auth from './auth.mjs';
const env = { ORIGIN: 'https://mint.example', DISCORD_CLIENT_ID: '123', DISCORD_CLIENT_SECRET: 'test-only', SESSION_SECRET: Buffer.alloc(32, 7).toString('base64url') };
async function authorize(overrides = {}) {
  const login = await auth.login(new Request(env.ORIGIN + '/auth/discord'), env);
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
  assert.ok(!cookie.includes('temporary'));
  const request = new Request(env.ORIGIN + '/api/session', { headers: { Cookie: cookie.split(';')[0] } });
  const session = await auth.session(request, env);
  assert.equal(session.owner, '123456789012345678');
  assert.equal(auth.mutationAllowed(new Request(env.ORIGIN, { headers: { Origin: env.ORIGIN, 'X-Ubu-CSRF': session.csrf } }), env, session), true);
  assert.equal(auth.mutationAllowed(new Request(env.ORIGIN, { headers: { Origin: env.ORIGIN, 'X-Ubu-CSRF': session.csrf + 'extra' } }), env, session), false);
  assert.equal(auth.mutationAllowed(new Request(env.ORIGIN, { headers: { Origin: env.ORIGIN, 'X-Ubu-CSRF': session.csrf.slice(0, -1) + 'X' } }), env, session), false);
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
