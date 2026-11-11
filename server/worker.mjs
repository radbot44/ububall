import { DurableObject } from 'cloudflare:workers';
import mintModule from './mint.js';
import * as auth from './auth.mjs';
export { UbuballQueue } from './ububall-queue.mjs';
export { UbuballMatch } from './ububall-object.mjs';
const { Mint } = mintModule;
const ID = /^[A-Za-z0-9_-]{21}[AQgw]$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuid = new RegExp('^' + UUID + '$');
const watchRoute = new RegExp('^/api/ububall/(' + UUID + ')/(watch-state|watch-socket)$');
const matchRoute = new RegExp('^/api/ububall/(' + UUID + ')/(join|team|rules|unready|state|socket|forfeit|rematch|skip-replay|leave|allow-watch|share-watch|activity-watch-state|activity-watch-socket)$');
const COLLECTION_PAGE = 200;
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers
} });
function configuration(env) {
  const keys = JSON.parse(env.MINT_PUBLIC_KEYS || '{}');
  if (!ID.test(env.MINT_ID || '') || !/^[A-Za-z0-9_-]{1,32}$/.test(env.MINT_KEY_ID || '') ||
      !keys || Array.isArray(keys) || typeof keys !== 'object' || Object.keys(keys).length > 16 ||
      !Object.hasOwn(keys, env.MINT_KEY_ID) || Object.entries(keys).some(([id, x]) =>
        !/^[A-Za-z0-9_-]{1,32}$/.test(id) || typeof x !== 'string' || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(x))) throw new Error('Mint is not configured.');
  const rawLimit = String(env.LIFETIME_MINT_LIMIT ?? '0'), rawBatch = String(env.BATCH_SIZE ?? '1000');
  const limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const batchSize = /^\d+$/.test(rawBatch) ? Number(rawBatch) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isSafeInteger(batchSize) ||
      batchSize < 5 || batchSize > 1000000 || batchSize % 5 !== 0) throw new Error('Invalid mint limits.');
  return { mint: env.MINT_ID, key: env.MINT_KEY_ID, keys, limit, batchSize };
}
async function body(request, maxBytes = 512) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('Expected JSON.');
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
    this.signingOwners = new Map();
    this.mint = new Mint({ exec: (sql, ...bindings) => ctx.storage.sql.exec(sql, ...bindings),
      transactionSync: callback => ctx.storage.transactionSync(callback) }, {
      mint: this.config.mint, key: this.config.key, resolveSigningKey: id => this.signingKey(id)
    });
  }
  async trackSigning(owner, work) {
    const previous = this.signingOwners.get(owner);
    const task = (async () => {
      if (previous) { try { await previous; } catch {} }
      return await work();
    })();
    const tracked = task.then(() => {}, () => {});
    this.signingOwners.set(owner, tracked);
    try { return await task; }
    finally { if (this.signingOwners.get(owner) === tracked) this.signingOwners.delete(owner); }
  }
  signingKey(id) {
    if (!this.signingKeys.has(id)) {
      const keys = JSON.parse(this.env.MINT_PRIVATE_KEYS || '{}');
      const jwk = keys && typeof keys === 'object' && !Array.isArray(keys) && Object.hasOwn(keys, id) ? keys[id] : null;
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
    const batchPacks = Math.floor(this.config.batchSize / 5);
    const targetBuffer = Math.max(batchPacks, 3);
    return (!state.size || state.prepared < state.size || state.remaining <= targetBuffer) &&
      !(state.prepared === state.size && state.next_serial + this.config.batchSize - 1 > 999999999999);
  }
  async ensureBatch() {
    if (this.needsPreparation() && await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }
  async alarm() {
    if (!this.needsPreparation()) return;
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    const batchPacks = Math.floor(this.config.batchSize / 5);
    try {
      this.mint.prepare({ batchSize: this.config.batchSize, minimumPacks: Math.max(batchPacks, 3) + 1 });
    } catch (error) {
      if (/^Invalid |multiple of 5|exhausted/.test(error.message)) await this.ctx.storage.deleteAlarm();
      throw error;
    }
    if (!this.needsPreparation()) await this.ctx.storage.deleteAlarm();
  }
  async offer(owner, request) {
    try {
      if (this.mint.starterStatus(owner).daily) return { error: 'Open your daily pack first.', status: 409 };
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
      return await this.trackSigning(owner, async () => {
        // Request-only calls can recover old allocations, never bypass selection.
        if (choice === undefined && !this.mint.exec('SELECT 1 FROM issued WHERE owner=? AND request=? LIMIT 1', owner, request).length) {
          return { error: 'Choose a pack first.', status: 409 };
        }
        return await this.mint.issue({ owner, request, choice }, { lifetimeLimit: this.config.limit });
      });
    } catch (error) {
      if (error.message === 'Lifetime mint limit reached.') return { error: error.message, status: 403 };
      if (error.message === 'Invalid issuance request.') return { error: error.message, status: 400 };
      if (error.message === 'Invalid pack choice.') return { error: error.message, status: 400 };
      if (['Pack choice expired or unavailable.', 'A different pack was already selected.'].includes(error.message)) return { error: error.message, status: 409 };
      if (error.message === 'Batch preparation required.') return { error: 'Preparing the next batch. Try again shortly.', status: 503 };
      throw error;
    } finally { await this.ensureBatch(); }
  }
  starterStatus(owner) { return this.mint.starterStatus(owner); }
  async claimStarter(owner, kind) {
    try { return await this.trackSigning(owner, () => this.mint.claimStarter({ owner, kind })); }
    catch (error) {
      if (error.message === 'Invalid issuance request.') return { error: 'Choose a starter pack.', status: 400 };
      throw error;
    } finally { await this.ensureBatch(); } // Regular packs come next, so have them ready.
  }
  // Anyone entering a match has a team: an unopened or interrupted starter pack finishes in the background.
  async matchTeam(owner) {
    if (this.mint.starterStatus(owner).signup ||
        this.mint.exec("SELECT 1 FROM issued WHERE owner=? AND request LIKE 'starter:%' AND certificate IS NULL LIMIT 1", owner).length) {
      const claimed = await this.claimStarter(owner, 'signup');
      if (claimed.error) throw new Error(claimed.error);
    }
    return this.mint.matchTeam(owner);
  }
  // Newest first, pending certificates last. Browsers sort and filter the full list themselves.
  async collection(owner, cursor = '') {
    const inflight = this.signingOwners.get(owner);
    if (inflight) await inflight;
    const keys = [['(certificate IS NULL)', 'ASC'], ['issued_at', 'DESC'], ['serial', 'DESC']];
    if (cursor && !/^[0-9]{12}$/.test(cursor)) return { error: 'Invalid collection cursor.', status: 400 };
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
      ' ORDER BY ' + order + ' LIMIT ' + (COLLECTION_PAGE + 1), ...binds);
    return {
      ubus: rows.slice(0, COLLECTION_PAGE).map(row => ({
        serial: row.serial, certificate: row.certificate, favorite: Boolean(row.favorite)
      })),
      next: rows.length > COLLECTION_PAGE ? rows[COLLECTION_PAGE - 1].serial : null
    };
  }
  favorite(owner, data) {
    if (data && typeof data === 'object' && !Array.isArray(data) &&
        Object.keys(data).length === 2 && typeof data.serial === 'string' && /^[0-9]{12}$/.test(data.serial) &&
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
  teams(owner) { return this.mint.teams(owner); }
  saveTeams(owner, data) { return this.mint.saveTeams(owner, data); }
  ububallTeam(owner, serials) {
    if (!Array.isArray(serials) || serials.length !== 3 || new Set(serials).size !== 3 ||
        serials.some(s => typeof s !== 'string' || !/^[0-9]{12}$/.test(s))) return { error: 'Choose three different owned ubus.' };
    const entries = serials.map(serial => this.mint.exec('SELECT serial, dna FROM issued WHERE owner=? AND serial=? AND certificate IS NOT NULL', owner, serial)[0]);
    return entries.every(Boolean) ? { entries } : { error: 'Ubu not found in your collection.' };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    // Ubu Mint and Collection are screens of the single-page app at /.
    if (path === '/mint.html') return Response.redirect(new URL('/mint' + url.search, url), 301);
    if (path === '/mint' || path === '/collection') return env.ASSETS.fetch(new Request(new URL('/', url), request));
    if (path === '/effects.html') return Response.redirect(new URL('/effects' + url.search, url), 301);
    if (path === '/effects') {
      const asset = await env.ASSETS.fetch(request);
      return asset.status === 404 ? env.ASSETS.fetch(new Request(new URL('/effects.html', url), request)) : asset;
    }
    if (!path.startsWith('/api/') && !path.startsWith('/auth/')) return env.ASSETS.fetch(request);
    try {
      if (path === '/api/config' && request.method === 'GET') {
        let config;
        try { config = configuration(env); } catch { return json({ ready: false, login: auth.configured(env) }); }
        return json({ ready: true, login: auth.configured(env), mint: config.mint, keys: config.keys, lifetimeLimit: config.limit });
      }
      if (!auth.configured(env)) return json({ error: 'Discord login is not configured yet.' }, 503);
      const site = auth.origin(env), embedded = auth.activityOrigin(env);
      if (url.origin !== site && url.origin !== embedded) return json({ error: 'Invalid site origin.' }, 400);
      if (path === '/auth/activity' && request.method === 'POST') {
        let data;
        try { data = await body(request, 1536); } catch { return json({ error: 'Invalid Activity sign-in request.' }, 400); }
        return auth.activityLogin(request, env, data);
      }
      if (url.origin === site && request.method === 'GET') {
        if (path === '/auth/discord') return auth.login(request, env);
        if (path === '/auth/callback') return auth.callback(request, env);
      }
      const watch = path.match(watchRoute);
      if (watch && request.method === 'GET') {
        const [, id, action] = watch, key = url.searchParams.get('key');
        const source = request.headers.get('Origin');
        if (action === 'watch-socket' && source !== site && (!embedded || source !== embedded)) return json({ error: 'Invalid socket origin.' }, 403);
        if (!uuid.test(key || '')) return json({ error: 'Invalid watch link.' }, 400);
        const viewer = await auth.session(request, env);
        let activityHeaders = {};
        if ((embedded && (source === embedded || url.origin === embedded)) || viewer?.instance) {
          const connection = request.headers.get('X-Ubu-Connection') || url.searchParams.get('connection');
          const queue = env.QUEUE.get(env.QUEUE.idFromName('ububall'));
          if (!viewer?.instance || !uuid.test(connection || '') || !await queue.current(viewer.owner, 'activity:' + viewer.instance, viewer.launch || '', connection)) {
            return json({ error: 'This Activity connection has ended.' }, 409);
          }
          activityHeaders = { 'X-Match-Owner': viewer.owner, 'X-Match-Connection': connection, 'X-Match-Expires': viewer.expires ? String(viewer.expires * 1000) : '' };
        }
        return env.UBUBALL.get(env.UBUBALL.idFromName(id)).fetch(new Request('https://match/' + action, {
          headers: { 'X-Match-Watch': key, ...activityHeaders, ...(action === 'watch-socket' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket' ? { Upgrade: 'websocket' } : {}) }
        }));
      }
      const session = await auth.session(request, env);
      if (path === '/api/session' && request.method === 'GET') {
        const refresh = session && !session.guest && !session.instance ? auth.refreshCookie(request) : null;
        return json(!session ? { owner: null } :
          session.guest ? { owner: null, guest: true, csrf: session.csrf } :
            { owner: session.owner, name: session.name ?? null, csrf: session.csrf,
              ...(session.instance ? { instance: session.instance, site, avatar: session.avatar, launch: session.launch } : {}) },
          200, refresh ? { 'Set-Cookie': refresh } : {});
      }
      if (path === '/api/guest' && request.method === 'POST') {
        if (request.headers.get('Origin') !== auth.origin(env)) return json({ error: 'Invalid request origin.' }, 403);
        if (session) return json(session.guest ? { owner: null, guest: true, csrf: session.csrf } : { owner: session.owner, name: session.name ?? null, csrf: session.csrf });
        const created = await auth.guest(env);
        return json({ owner: null, guest: true, csrf: created.value.csrf }, 200, { 'Set-Cookie': created.cookie });
      }
      if (!session) return json({ error: 'Sign in with Discord or play as a guest first.' }, 401);
      if (request.method !== 'GET' && !auth.mutationAllowed(request, env, session)) return json({ error: 'Invalid request origin or token.' }, 403);
      if (path === '/api/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': auth.logoutCookie(env, session) });
      if (path === '/api/session/refresh' && request.method === 'POST') {
        if (session.guest) return json({ error: 'Sign in with Discord first.' }, 403);
        const { session: updated, cookie } = await auth.refreshProfile(session, env);
        return json(updated, 200, { 'Set-Cookie': cookie });
      }
      if (path === '/api/ububall/lobby' && request.method === 'POST') {
        let data;
        try { data = await body(request, 1024); } catch { return json({ error: 'Invalid lobby request.' }, 400); }
        const actions = ['join', 'poll', 'reconcile', 'ready', 'unready', 'challenge', 'accept', 'decline', 'cancel', 'ack', 'leave'];
        if (!data || typeof data !== 'object' || Array.isArray(data) || !actions.includes(data.action) ||
            data.instance !== session.instance || !auth.validInstance(data.instance) ||
            typeof data.connection !== 'string' || !uuid.test(data.connection) ||
            !uuid.test(session.launch || '') || !Number.isSafeInteger(session.issued) ||
            Object.keys(data).some(key => !['action', 'instance', 'connection', 'target', 'id', 'match', 'watch', 'cpu'].includes(key)) ||
            (data.cpu !== undefined && typeof data.cpu !== 'boolean') ||
            (data.action === 'challenge' && (typeof data.target !== 'string' || !/^[1-9][0-9]{0,19}$/.test(data.target))) ||
            (['accept', 'decline', 'cancel', 'ack'].includes(data.action) && (typeof data.id !== 'string' || !uuid.test(data.id))) ||
            (data.match !== undefined && (typeof data.match !== 'string' || !uuid.test(data.match))) ||
            (data.watch !== undefined && (typeof data.watch !== 'string' || !uuid.test(data.watch)))) {
          return json({ error: 'Invalid lobby request.' }, 400);
        }
        // The signed Activity session was created only after Discord verified membership.
        const queue = env.QUEUE.get(env.QUEUE.idFromName('ububall'));
        let participants;
        if (data.action === 'reconcile') {
          if (!await queue.current(session.owner, 'activity:' + session.instance, session.launch, data.connection)) return json({ error: 'This Activity connection has ended.' }, 409);
          const checkedBefore = Date.now();
          const users = await auth.activityParticipants(env, session.instance);
          if (!users) return json({ error: 'Discord could not verify the Activity.' }, 503);
          participants = { users, checkedBefore };
        }
        try {
          const result = await queue.lobby(session.owner, 'activity:' + session.instance,
            { name: session.name || 'Player', avatar: session.avatar || null, launch: session.launch, issued: session.issued, expires: session.expires * 1000 }, data, participants);
          return json(result, result.error ? 409 : 200);
        }
        catch (error) { return json({ error: error.message }, 409); }
      }
      const activityConnection = request.headers.get('X-Ubu-Connection') || url.searchParams.get('connection') || '';
      if (path.startsWith('/api/ububall') && session.instance) {
        const queue = env.QUEUE.get(env.QUEUE.idFromName('ububall'));
        if (!uuid.test(activityConnection) || !await queue.current(session.owner, 'activity:' + session.instance, session.launch || '', activityConnection)) {
          return json({ error: 'This Activity connection has ended.' }, 409);
        }
      }
      if (path === '/api/ububall/queue' && request.method === 'POST') {
        let data;
        try { data = await body(request); } catch { return json({ error: 'Invalid queue request.' }, 400); }
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
          !['public', 'friends'].includes(data.queue) || !['enter', 'poll', 'cancel', 'ack'].includes(data.action) ||
          (data.action === 'ack' ? typeof data.id !== 'string' || !uuid.test(data.id) : Object.hasOwn(data, 'id')) ||
          Object.keys(data).some(key => !['queue', 'action', 'id', 'instance'].includes(key))) {
          return json({ error: 'Invalid queue request.' }, 400);
        }
        let scope = 'public';
        if (data.queue === 'friends') {
          if (!session.instance || data.instance !== session.instance || !auth.validInstance(data.instance)) return json({ error: 'Open this queue inside a Discord Activity.' }, 403);
          if (data.action === 'enter' && !await auth.activityMember(env, data.instance, session.owner)) {
            return json({ error: 'Join this Activity in Discord first.' }, 403);
          }
          scope = 'activity:' + data.instance;
        }
        const queue = env.QUEUE.get(env.QUEUE.idFromName('ububall'));
        const result = await queue.update(session.owner, Boolean(session.guest), scope, data.action, data.id ?? null,
          session.instance ? { instance: session.instance, launch: session.launch, connection: activityConnection } : null);
        return result.status === 'closed' ? json({ error: 'This Activity connection has ended.' }, 409) : json(result);
      }
      if (path === '/api/ububall/activity-watch' && request.method === 'GET') {
        const instance = url.searchParams.get('instance');
        if (!session.instance || instance !== session.instance || !await auth.activityMember(env, instance, session.owner)) {
          return json({ error: 'Join this Activity in Discord first.' }, 403);
        }
        const queue = env.QUEUE.get(env.QUEUE.idFromName('ububall'));
        return json(await queue.watch('activity:' + instance));
      }
      if (path === '/api/ububall' && request.method === 'POST') {
        let data;
        try { data = await body(request); } catch { return json({ error: 'Invalid match request.' }, 400); }
        if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.mode !== 'string' || Object.keys(data).some(k => k !== 'mode')) return json({ error: 'Invalid match request.' }, 400);
        const id = crypto.randomUUID();
        const response = await env.UBUBALL.get(env.UBUBALL.idFromName(id)).fetch(new Request('https://match/create', {
          method: 'POST', headers: { 'X-Match-Owner': session.owner, 'X-Match-Guest': session.guest ? '1' : '', 'X-Match-Name': encodeURIComponent(session.name || ''), 'Content-Type': 'application/json' }, body: JSON.stringify(data)
        }));
        const result = await response.json();
        return json(response.ok ? { id, ...result } : result, response.status);
      }
      const match = path.match(matchRoute);
      if (match) {
        const [, id, action] = match, activityWatch = action.startsWith('activity-watch-');
        const socket = action === 'socket' || action === 'activity-watch-socket';
        const get = action === 'state' || socket || activityWatch;
        if (activityWatch && !session.instance) return json({ error: 'Open this match inside its Discord Activity.' }, 403);
        if (request.method !== (get ? 'GET' : 'POST')) return json({ error: 'Method not allowed.' }, 405);
        // Browser sockets cannot carry custom CSRF headers; enforce the exact Origin instead.
        if (socket && request.headers.get('Origin') !== auth.requestOrigin(env, session)) return json({ error: 'Invalid socket origin.' }, 403);
        let data;
        if (!get) { try { data = await body(request, 2048); } catch { return json({ error: 'Invalid match request.' }, 400); } }
        const allowAlias = !get || socket || request.headers.get('X-Ubu-CSRF') === session.csrf;
        return env.UBUBALL.get(env.UBUBALL.idFromName(id)).fetch(new Request('https://match/' + (activityWatch ? action.slice(9) : action), {
          method: request.method,
          headers: { 'X-Match-Owner': session.owner, 'X-Match-Guest': session.guest ? '1' : '', 'X-Match-Alias': allowAlias ? (session.alias || '') : '',
            'X-Match-Name': encodeURIComponent(session.name || ''),
            'X-Match-Expires': session.expires ? String(session.expires * 1000) : '',
            'X-Match-Connection': activityConnection,
            ...(activityWatch ? { 'X-Match-Activity': session.instance } : {}),
            'Content-Type': 'application/json', ...(socket ? { Upgrade: 'websocket' } : {}) },
          body: get ? undefined : JSON.stringify(data)
        }));
      }
      if (session.guest) return json({ error: 'Sign in with Discord to use the mint.' }, 403);
      const config = configuration(env);
      const registry = env.MINT.get(env.MINT.idFromName(config.mint));
      if (path === '/api/ubus' && request.method === 'GET') {
        const result = await registry.collection(session.owner, url.searchParams.get('after') || '');
        return json(result, result.status || 200);
      }
      if (path === '/api/teams' && request.method === 'GET') return json(await registry.teams(session.owner));
      if (path === '/api/teams' && request.method === 'POST') {
        let data;
        try { data = await body(request, 8192); } catch { return json({ error: 'Invalid saved teams body.' }, 400); }
        const result = await registry.saveTeams(session.owner, data);
        return json(result, result.status || 200);
      }
      if (path === '/api/favorites' && request.method === 'POST') {
        let data;
        try { data = await body(request, 2048); } catch { return json({ error: 'Invalid favorite request body.' }, 400); }
        const result = await registry.favorite(session.owner, data);
        return json(result, result.status || 200);
      }
      if (path === '/api/starter' && request.method === 'GET') return json(await registry.starterStatus(session.owner));
      if (path === '/api/starter' && request.method === 'POST') {
        let data;
        try { data = await body(request); } catch { return json({ error: 'Choose a starter pack.' }, 400); }
        const result = await registry.claimStarter(session.owner, data?.kind);
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
      const service = path.startsWith('/api/ububall') ? 'Online play' : 'Mint service';
      return json({ error: `${service} unavailable. Retry the same request.` }, 503, { 'Retry-After': '2' });
    }
  }
};
