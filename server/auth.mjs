const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decode(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('Invalid token.');
  const bytes = Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0));
  if (encode(bytes) !== text) throw new Error('Invalid token.');
  return bytes;
}
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
let cachedSecret, cachedKey;
function signingKey(secret) {
  if (typeof secret !== 'string' || secret.length !== 43) throw new Error('Session secret is not configured.');
  if (secret !== cachedSecret) {
    const bytes = decode(secret);
    if (bytes.length !== 32) throw new Error('Invalid session secret.');
    cachedKey = crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    cachedSecret = secret;
  }
  return cachedKey;
}
async function seal(value, secret) {
  const payload = encode(encoder.encode(JSON.stringify(value)));
  return payload + '.' + encode(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload))));
}
async function unseal(token, secret, purpose) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  try {
    const pieces = token.split('.');
    if (pieces.length !== 2 || !await crypto.subtle.verify('HMAC', await signingKey(secret), decode(pieces[1]), encoder.encode(pieces[0]))) return null;
    const value = JSON.parse(decoder.decode(decode(pieces[0])));
    if (value.purpose !== purpose || !Number.isSafeInteger(value.expires) || value.expires <= Date.now() / 1000) return null;
    return value;
  } catch { return null; }
}
function cookie(request, name) {
  const matches = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).filter(s => s.startsWith(name + '='));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}
const setCookie = (name, value, seconds) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
const sessionName = '__Host-ubu-session', stateName = '__Host-ubu-oauth';
const activityName = '__Secure-ubu-activity';
const discordId = /^[1-9][0-9]{0,19}$/;
const activityId = /^[A-Za-z0-9_-]{1,200}$/;
export const validInstance = value => typeof value === 'string' && activityId.test(value);
const activityCookie = (env, value, seconds) =>
  `${activityName}=${value}; Domain=${new URL(activityOrigin(env)).hostname}; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=${seconds}`;
export function configured(env) {
  return !!(env.ORIGIN && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.SESSION_SECRET);
}
export function origin(env) {
  const url = new URL(env.ORIGIN);
  if (url.origin !== env.ORIGIN || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid configured origin.');
  return url.origin;
}
export function activityOrigin(env) {
  return discordId.test(env.DISCORD_CLIENT_ID || '') && env.DISCORD_ACTIVITY_BOT_TOKEN
    ? `https://${env.DISCORD_CLIENT_ID}.discordsays.com` : null;
}
export function requestOrigin(env, value) {
  return value?.instance ? activityOrigin(env) : origin(env);
}
const GUEST = /^g_[A-Za-z0-9_-]{43}$/;
// Guest IDs can never match a Discord ID, so they can never reach a mint collection.
export async function session(request, env) {
  const embedded = activityOrigin(env);
  const source = request.headers.get('Origin');
  const activity = embedded && (source === embedded || (!source &&
    (new URL(request.url).origin === embedded || cookie(request, activityName))));
  const value = await unseal(cookie(request, activity ? activityName : sessionName), env.SESSION_SECRET, activity ? 'activity' : 'session');
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value.csrf)) return null;
  if (activity) return discordId.test(value.owner) && validInstance(value.instance) ? value : null;
  const discord = value.guest === undefined && discordId.test(value.owner) && (value.alias === undefined || GUEST.test(value.alias));
  const guest = value.guest === true && GUEST.test(value.owner) && value.alias === undefined;
  return discord || guest ? value : null;
}
export async function guest(env) {
  const value = { purpose: 'session', owner: 'g_' + random(), guest: true, csrf: random(), expires: Math.floor(Date.now() / 1000) + 604800 };
  return { value, cookie: setCookie(sessionName, await seal(value, env.SESSION_SECRET), 604800) };
}
export function mutationAllowed(request, env, value) {
  return request.headers.get('Origin') === requestOrigin(env, value) && request.headers.get('X-Ubu-CSRF') === value.csrf;
}
export function logoutCookie(env, value) { return value?.instance ? activityCookie(env, '', 0) : setCookie(sessionName, '', 0); }

const discordApi = 'https://discord.com/api/v10';
async function exchange(env, code, redirect, fetchDiscord) {
  const params = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code', code });
  if (redirect) params.set('redirect_uri', redirect);
  const response = await fetchDiscord(discordApi + '/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000), body: params });
  if (!response.ok) throw new Error('Discord code exchange failed.');
  const token = await response.json();
  if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer') throw new Error('Invalid Discord token.');
  const identity = await fetchDiscord(discordApi + '/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10000) });
  if (!identity.ok) throw new Error('Discord identity unavailable.');
  const user = await identity.json();
  if (typeof user.id !== 'string' || !discordId.test(user.id)) throw new Error('Invalid Discord account.');
  const name = [user.global_name, user.username].find(n => typeof n === 'string' && n.trim())?.trim().slice(0, 32);
  const avatar = typeof user.avatar === 'string' && /^(a_)?[0-9a-f]{32}$/.test(user.avatar) ? user.avatar : null;
  return { owner: user.id, name, avatar, accessToken: token.access_token };
}

export async function activityParticipants(env, instance, fetchDiscord = fetch) {
  if (!activityOrigin(env) || !validInstance(instance)) return null;
  const response = await fetchDiscord(`${discordApi}/applications/${env.DISCORD_CLIENT_ID}/activity-instances/${instance}`, {
    headers: { Authorization: `Bot ${env.DISCORD_ACTIVITY_BOT_TOKEN}` }, signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error('Discord could not verify the Activity. Try again shortly.');
  const data = await response.json();
  if (data.application_id !== env.DISCORD_CLIENT_ID || data.instance_id !== instance) return null;
  if (!Array.isArray(data.users) || data.users.some(owner => typeof owner !== 'string' || !discordId.test(owner))) throw new Error('Invalid Activity participants.');
  return data.users;
}
export async function activityMember(env, instance, owner, fetchDiscord = fetch) {
  return (await activityParticipants(env, instance, fetchDiscord))?.includes(owner) ?? false;
}

export async function activityLogin(request, env, data, fetchDiscord = fetch) {
  const embedded = activityOrigin(env);
  const json = (value, status, cookieHeader) => Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', ...(cookieHeader ? { 'Set-Cookie': cookieHeader } : {})
  } });
  if (!embedded || request.headers.get('Origin') !== embedded) return json({ error: 'Invalid Activity origin.' }, 403);
  const { code, instance } = data || {};
  if (typeof code !== 'string' || !code || code.length > 1024 || !validInstance(instance)) {
    return json({ error: 'Invalid Activity sign-in request.' }, 400);
  }
  try {
    const { owner, name, avatar, accessToken } = await exchange(env, code, null, fetchDiscord);
    if (!await activityMember(env, instance, owner, fetchDiscord)) return json({ error: 'Join this Activity in Discord first.' }, 403);
    const seconds = 86400;
    const token = await seal({ purpose: 'activity', owner, name, avatar, instance, launch: crypto.randomUUID(), issued: Date.now(), csrf: random(),
      expires: Math.floor(Date.now() / 1000) + seconds }, env.SESSION_SECRET);
    // Discord's RPC authenticate needs the access token once. The refresh token is discarded.
    return json({ access_token: accessToken }, 200, activityCookie(env, token, seconds));
  } catch { return json({ error: 'Could not sign in to the Discord Activity. Try again.' }, 502); }
}

export function safeReturnPath(raw, env) {
  if (!raw || typeof raw !== 'string' || /[\x00-\x1F\x7F]/.test(raw)) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('\\')) return '/';
  try {
    const base = origin(env);
    const parsed = new URL(raw, base);
    if (parsed.origin !== base) return '/';
    const target = parsed.pathname + parsed.search + parsed.hash;
    if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/';
    if (target.startsWith('/auth/') || target.startsWith('/api/')) return '/';
    return target;
  } catch {
    return '/';
  }
}

export async function login(request, env) {
  const reqUrl = new URL(request.url);
  const returnTo = safeReturnPath(reqUrl.searchParams.get('return') || reqUrl.searchParams.get('return_to'), env);
  const nonce = random();
  const token = await seal({ purpose: 'oauth', nonce, returnTo, expires: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);
  const url = new URL('https://discord.com/oauth2/authorize');
  url.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', scope: 'identify',
    redirect_uri: origin(env) + '/auth/callback', state: nonce }).toString();
  return new Response(null, { status: 302, headers: { Location: url.href, 'Set-Cookie': setCookie(stateName, token, 600), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
export async function callback(request, env, fetchDiscord = fetch) {
  const url = new URL(request.url);
  const state = await unseal(cookie(request, stateName), env.SESSION_SECRET, 'oauth');
  const failed = () => new Response('Discord login failed. Please try again.', { status: 400,
    headers: { 'Set-Cookie': setCookie(stateName, '', 0), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  if (!state || state.nonce !== url.searchParams.get('state') || !url.searchParams.get('code') || url.searchParams.has('error')) return failed();
  try {
    const { owner, name } = await exchange(env, url.searchParams.get('code'), origin(env) + '/auth/callback', fetchDiscord);
    const returnTo = safeReturnPath(state.returnTo, env);
    // A guest signing in keeps their match seats: the Discord session names the guest ID it replaced.
    const previous = await session(request, env);
    // The display name is shown in the header; the ID never is.
    const sessionToken = await seal({ purpose: 'session', owner, ...(name ? { name } : {}), csrf: random(), expires: Math.floor(Date.now() / 1000) + 86400,
      ...(previous?.guest ? { alias: previous.owner } : {}) }, env.SESSION_SECRET);
    const headers = new Headers({ Location: origin(env) + returnTo, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    headers.append('Set-Cookie', setCookie(stateName, '', 0));
    headers.append('Set-Cookie', setCookie(sessionName, sessionToken, 86400));
    return new Response(null, { status: 302, headers });
  } catch { return failed(); }
}
