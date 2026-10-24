import { DurableObject } from 'cloudflare:workers';
import mintModule from './mint.js';
import * as auth from './auth.mjs';
const { Mint } = mintModule;
const ID = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers
} });
function configuration(env) {
  const keys = JSON.parse(env.MINT_PUBLIC_KEYS || '{}');
  if (!ID.test(env.MINT_ID || '') || !/^[A-Za-z0-9_-]{1,32}$/.test(env.MINT_KEY_ID || '') ||
      !keys || Array.isArray(keys) || typeof keys !== 'object' || Object.keys(keys).length > 16 ||
      !Object.hasOwn(keys, env.MINT_KEY_ID) || Object.entries(keys).some(([id, x]) =>
        !/^[A-Za-z0-9_-]{1,32}$/.test(id) || typeof x !== 'string' || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(x))) throw new Error('Mint is not configured.');
  const limit = Number(env.LIFETIME_MINT_LIMIT ?? '0');
  const batchSize = Number(env.BATCH_SIZE ?? '1000');
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000000) throw new Error('Invalid mint limits.');
  return { mint: env.MINT_ID, key: env.MINT_KEY_ID, keys, limit, batchSize };
}
async function body(request) {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') throw new Error('Expected JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body.');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 512) { await reader.cancel(); throw new Error('Body too large.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { reader.releaseLock(); }
}

export class MintRegistry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.config = configuration(env);
    this.signingKeys = new Map();
    this.mint = new Mint({ exec: (sql, ...bindings) => ctx.storage.sql.exec(sql, ...bindings),
      transactionSync: callback => ctx.storage.transactionSync(callback) }, {
      mint: this.config.mint, key: this.config.key, resolveSigningKey: id => this.signingKey(id)
    });
  }
  signingKey(id) {
    if (!this.signingKeys.has(id)) {
      const keys = JSON.parse(this.env.MINT_PRIVATE_KEYS || '{}');
      const jwk = Object.hasOwn(keys, id) ? keys[id] : null;
      if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || jwk.x !== this.config.keys[id]) throw new Error('Signing key unavailable.');
      // Import only curve/key material: Node and workerd emit different optional JWK alg labels.
      const promise = crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d }, 'Ed25519', false, ['sign']);
      this.signingKeys.set(id, promise);
      promise.catch(() => this.signingKeys.delete(id));
    }
    return this.signingKeys.get(id);
  }
  async ensureBatch() {
    const state = this.mint.state();
    if (!state.size || state.prepared < state.size || !state.remaining) {
      // Set the recovery alarm before doing work, so an interruption cannot strand preparation.
      if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }
  async alarm() {
    const current = this.mint.state();
    if (current.size && current.prepared === current.size && current.remaining) return;
    if (current.prepared === current.size && current.next_serial + this.config.batchSize - 1 > 999999999999) return;
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    const state = this.mint.prepare({ batchSize: this.config.batchSize });
    if (state.prepared === state.size) await this.ctx.storage.deleteAlarm();
  }
  async issue(owner, request) {
    try {
      const result = await this.mint.issue({ owner, request }, { lifetimeLimit: this.config.limit });
      return result;
    } catch (error) {
      if (error.message === 'Lifetime mint limit reached.') return { error: error.message, status: 403 };
      if (error.message === 'Invalid issuance request.') return { error: error.message, status: 400 };
      if (error.message === 'Batch preparation required.') return { error: 'Preparing the next batch. Try again shortly.', status: 503 };
      throw error;
    } finally { await this.ensureBatch(); }
  }
  collection(owner, cursor = '') {
    if (cursor && !/^[0-9]{12}$/.test(cursor)) return { error: 'Invalid cursor.', status: 400 };
    const rows = this.mint.exec('SELECT serial, certificate FROM issued WHERE owner=? AND serial>? ORDER BY serial LIMIT 51', owner, cursor);
    return { ubus: rows.slice(0, 50).map(row => ({ serial: row.serial, certificate: row.certificate })),
      next: rows.length > 50 ? rows[49].serial : null };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (!path.startsWith('/api/') && !path.startsWith('/auth/')) return env.ASSETS.fetch(request);
    try {
      if (path === '/api/config' && request.method === 'GET') {
        let config;
        try { config = configuration(env); } catch { return json({ ready: false, login: auth.configured(env) }); }
        return json({ ready: true, login: auth.configured(env), mint: config.mint, keys: config.keys, lifetimeLimit: config.limit });
      }
      if (!auth.configured(env)) return json({ error: 'Discord login is not configured yet.' }, 503);
      if (url.origin !== auth.origin(env)) return json({ error: 'Invalid site origin.' }, 400);
      if (path === '/auth/discord' && request.method === 'GET') return auth.login(request, env);
      if (path === '/auth/callback' && request.method === 'GET') return auth.callback(request, env);
      const session = await auth.session(request, env);
      if (path === '/api/session' && request.method === 'GET') return json(session ? { owner: session.owner, csrf: session.csrf } : { owner: null });
      if (!session) return json({ error: 'Sign in with Discord first.' }, 401);
      if (request.method !== 'GET' && !auth.mutationAllowed(request, env, session)) return json({ error: 'Invalid request origin or token.' }, 403);
      if (path === '/api/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': auth.logoutCookie() });
      const config = configuration(env);
      const registry = env.MINT.get(env.MINT.idFromName(config.mint));
      if (path === '/api/ubus' && request.method === 'GET') {
        const result = await registry.collection(session.owner, url.searchParams.get('after') || '');
        return json(result, result.status || 200);
      }
      if (path === '/api/mint' && request.method === 'POST') {
        let data;
        try { data = await body(request); } catch { return json({ error: 'Provide a JSON request ID; maximum body size is 512 bytes.' }, 400); }
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 || !Object.hasOwn(data, 'request') ||
            typeof data.request !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.request)) return json({ error: 'Provide only a valid request ID.' }, 400);
        const result = await registry.issue(session.owner, data.request);
        return json(result, result.status || 200, result.status === 503 ? { 'Retry-After': '2' } : {});
      }
      return json({ error: 'Endpoint not found.' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'Mint service unavailable. Retry the same request.' }, 503, { 'Retry-After': '2' });
    }
  }
};
