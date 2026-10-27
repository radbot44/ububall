import { DurableObject } from 'cloudflare:workers';
import mintModule from './mint.js';
import * as auth from './auth.mjs';
const { Mint } = mintModule;
const ID = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', ...headers
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
async function body(request, maxBytes = 512) {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') throw new Error('Expected JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body.');
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw new Error('Body too large.'); }
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
  needsPreparation() {
    const state = this.mint.state();
    return (!state.size || state.prepared < state.size || state.remaining < 3) &&
      !(state.prepared === state.size && state.next_serial + this.config.batchSize - 1 > 999999999999);
  }
  async ensureBatch() {
    if ((this.needsPreparation() || this.mint.needsRarityBackfill()) &&
        await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }
  async alarm() {
    if (!this.needsPreparation() && !this.mint.needsRarityBackfill()) return;
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    // Don't let a large historical rarity migration block mint inventory preparation.
    if (this.needsPreparation()) this.mint.prepare({ batchSize: this.config.batchSize, minimumPacks: 3 });
    else if (this.mint.needsRarityBackfill()) this.mint.backfillRarity();
    if (!this.needsPreparation() && !this.mint.needsRarityBackfill()) await this.ctx.storage.deleteAlarm();
  }
  async offer(owner, request) {
    try {
      return this.mint.offer({ owner, request }, { lifetimeLimit: this.config.limit });
    } catch (error) {
      if (error.message === 'Lifetime mint limit reached.') return { error: error.message, status: 403 };
      if (error.message === 'Invalid issuance request.') return { error: error.message, status: 400 };
      if (error.message === 'Batch preparation required.') return { error: 'Preparing three packs. Try again shortly.', status: 503 };
      if (error.message === 'Pack choices unavailable.') return { error: 'Available packs are reserved. Try again later.', status: 503 };
      throw error;
    } finally { await this.ensureBatch(); }
  }
  async issue(owner, request, choice) {
    try {
      // Request-only calls can recover old allocations, never bypass selection.
      if (choice === undefined && !this.mint.exec('SELECT 1 FROM issued WHERE owner=? AND request=? LIMIT 1', owner, request).length) {
        return { error: 'Choose a pack first.', status: 409 };
      }
      const result = await this.mint.issue({ owner, request, choice }, { lifetimeLimit: this.config.limit });
      return result;
    } catch (error) {
      if (error.message === 'Lifetime mint limit reached.') return { error: error.message, status: 403 };
      if (error.message === 'Invalid issuance request.') return { error: error.message, status: 400 };
      if (error.message === 'Invalid pack choice.') return { error: error.message, status: 400 };
      if (['Pack choice expired or unavailable.', 'A different pack was already selected.'].includes(error.message)) return { error: error.message, status: 409 };
      if (error.message === 'Batch preparation required.') return { error: 'Preparing the next batch. Try again shortly.', status: 503 };
      throw error;
    } finally { await this.ensureBatch(); }
  }
  async collection(owner, sort = 'recent', cursor = '') {
    const keys = {
      recent: [['(certificate IS NULL)', 'ASC'], ['issued_at', 'DESC'], ['serial', 'DESC']],
      old: [['(certificate IS NULL)', 'ASC'], ['issued_at', 'ASC'], ['serial', 'ASC']],
      rarity: [['(certificate IS NULL)', 'ASC'], ['rarity_bits', 'DESC'], ['serial', 'DESC']],
      serial: [['(certificate IS NULL)', 'ASC'], ['serial', 'ASC']],
      favorite: [['(certificate IS NULL)', 'ASC'], ['favorite', 'DESC'], ['issued_at', 'DESC'], ['serial', 'DESC']]
    }[sort];
    if (!Array.isArray(keys) || (cursor && !/^[0-9]{12}$/.test(cursor))) return { error: 'Invalid collection sort or cursor.', status: 400 };
    if (this.mint.needsRarityBackfill() && await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
    if (sort === 'rarity' && this.mint.needsRarityBackfill()) {
      return { error: 'Preparing rarity sorting. Try again shortly.', status: 503 };
    }
    const binds = [owner];
    let after = '';
    if (cursor) {
      const anchor = this.mint.exec('SELECT * FROM issued WHERE owner=? AND serial=?', owner, cursor)[0];
      if (!anchor) return { error: 'Invalid collection cursor.', status: 400 };
      const value = expression => expression === '(certificate IS NULL)' ? Number(anchor.certificate === null) : anchor[expression];
      const parts = keys.map((key, i) => {
        const terms = [];
        for (let j = 0; j < i; j++) { terms.push(keys[j][0] + '=?'); binds.push(value(keys[j][0])); }
        terms.push(key[0] + (key[1] === 'ASC' ? '>?' : '<?'));
        binds.push(value(key[0]));
        return '(' + terms.join(' AND ') + ')';
      });
      after = ' AND (' + parts.join(' OR ') + ')';
    }
    const order = keys.map(([expression, direction]) => expression + ' ' + direction).join(', ');
    const rows = this.mint.exec('SELECT serial, certificate, favorite FROM issued WHERE owner=?' + after +
      ' ORDER BY ' + order + ' LIMIT 51', ...binds);
    return {
      ubus: rows.slice(0, 50).map(row => ({
        serial: row.serial, certificate: row.certificate, favorite: Boolean(row.favorite)
      })),
      next: rows.length > 50 ? rows[49].serial : null
    };
  }
  favorite(owner, data) {
    if (data && typeof data === 'object' && !Array.isArray(data) &&
        Object.keys(data).length === 2 && /^[0-9]{12}$/.test(data.serial) &&
        typeof data.favorite === 'boolean') {
      const updated = this.mint.exec('UPDATE issued SET favorite=? WHERE owner=? AND serial=? RETURNING serial',
        Number(data.favorite), owner, data.serial);
      return updated.length ? { serial: data.serial, favorite: data.favorite } : { error: 'Ubu not found in your collection.', status: 404 };
    }
    if (data && typeof data === 'object' && !Array.isArray(data) &&
        Object.keys(data).length === 1 && Array.isArray(data.serials) &&
        data.serials.length <= 50 && data.serials.every(serial => typeof serial === 'string' && /^[0-9]{12}$/.test(serial))) {
      if (data.serials.length) this.mint.exec('UPDATE issued SET favorite=1 WHERE owner=? AND serial IN (' +
        data.serials.map(() => '?').join(',') + ')', owner, ...data.serials);
      return { ok: true };
    }
    return { error: 'Invalid favorite request.', status: 400 };
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
        const result = await registry.collection(session.owner, url.searchParams.get('sort') || 'recent', url.searchParams.get('after') || '');
        return json(result, result.status || 200);
      }
      if (path === '/api/favorites' && request.method === 'POST') {
        let data;
        try { data = await body(request, 2048); } catch { return json({ error: 'Invalid favorite request body.' }, 400); }
        const result = await registry.favorite(session.owner, data);
        return json(result, result.status || 200);
      }
      if ((path === '/api/packs' || path === '/api/mint') && request.method === 'POST') {
        let data;
        try { data = await body(request); } catch { return json({ error: 'Provide a JSON request ID; maximum body size is 512 bytes.' }, 400); }
        const allowed = path === '/api/packs' ? ['request'] : ['request', 'choice'];
        if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !allowed.includes(key)) ||
            typeof data.request !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.request) ||
            (Object.hasOwn(data, 'choice') && (typeof data.choice !== 'string' || !ID.test(data.choice)))) return json({ error: 'Provide a valid request ID and pack choice.' }, 400);
        const result = path === '/api/packs' ? await registry.offer(session.owner, data.request) : await registry.issue(session.owner, data.request, data.choice);
        return json(result, result.status || 200, result.status === 503 ? { 'Retry-After': '2' } : {});
      }
      return json({ error: 'Endpoint not found.' }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: 'Mint service unavailable. Retry the same request.' }, 503, { 'Retry-After': '2' });
    }
  }
};
