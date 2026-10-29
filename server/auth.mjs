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
export function configured(env) {
  return !!(env.ORIGIN && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.SESSION_SECRET);
}
export function origin(env) {
  const url = new URL(env.ORIGIN);
  if (url.origin !== env.ORIGIN || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid configured origin.');
  return url.origin;
}
export async function session(request, env) {
  const value = await unseal(cookie(request, sessionName), env.SESSION_SECRET, 'session');
  return value && /^[1-9][0-9]{0,19}$/.test(value.owner) && /^[A-Za-z0-9_-]{43}$/.test(value.csrf) ? value : null;
}
export function mutationAllowed(request, env, value) {
  return request.headers.get('Origin') === origin(env) && request.headers.get('X-Ubu-CSRF') === value.csrf;
}
export function logoutCookie() { return setCookie(sessionName, '', 0); }

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
    const response = await fetchDiscord('https://discord.com/api/v10/oauth2/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: origin(env) + '/auth/callback' }) });
    if (!response.ok) return failed();
    const token = await response.json();
    if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer') return failed();
    const userResponse = await fetchDiscord('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10000) });
    if (!userResponse.ok) return failed();
    const user = await userResponse.json();
    if (typeof user.id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(user.id)) return failed();
    const returnTo = safeReturnPath(state.returnTo, env);
    const sessionToken = await seal({ purpose: 'session', owner: user.id, csrf: random(), expires: Math.floor(Date.now() / 1000) + 86400 }, env.SESSION_SECRET);
    const headers = new Headers({ Location: origin(env) + returnTo, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    headers.append('Set-Cookie', setCookie(stateName, '', 0));
    headers.append('Set-Cookie', setCookie(sessionName, sessionToken, 86400));
    return new Response(null, { status: 302, headers });
  } catch { return failed(); }
}
