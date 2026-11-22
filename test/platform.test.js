'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const platformSource = fs.readFileSync(path.resolve(__dirname, '../web/platform.js'), 'utf8');

function makeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k)
  };
}

function bootPlatform({ native = false, plugins = {}, apiOriginOverride = '', initialLocalStorage = {}, mobileAuthReturnTo = '/collection', readyState = 'complete' } = {}) {
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  if (apiOriginOverride) localStorage.setItem('ububall:api-origin', apiOriginOverride);
  for (const [k, v] of Object.entries(initialLocalStorage)) localStorage.setItem(k, v);
  const fetchCalls = [];
  const winEvents = new Map();
  const docEvents = new Map();
  const scheduled = [];

  const mockWindow = {
    location: {
      origin: native ? 'https://localhost' : 'https://ububall.tch.one',
      protocol: 'https:',
      host: native ? 'localhost' : 'ububall.tch.one',
      pathname: '/',
      search: '',
      hash: '',
      reloadCalled: 0,
      reload() { this.reloadCalled++; }
    },
    localStorage,
    sessionStorage,
    Capacitor: native ? {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: plugins
    } : undefined,
    checkUbuSession: async () => { mockWindow.__sessionChecked = (mockWindow.__sessionChecked || 0) + 1; },
    navigateUbuScreen: async href => { mockWindow.__navigated = href; mockWindow.location.pathname = href.split('?')[0]; },
    addEventListener(type, fn) { if (!winEvents.has(type)) winEvents.set(type, []); winEvents.get(type).push(fn); }
  };

  const mockDocument = {
    readyState,
    documentElement: { classList: { add() {} } },
    body: { dataset: { shot: 'home' } },
    querySelector: () => null,
    addEventListener(type, fn) { if (!docEvents.has(type)) docEvents.set(type, []); docEvents.get(type).push(fn); }
  };

  const sandbox = {
    window: mockWindow,
    document: mockDocument,
    location: mockWindow.location,
    localStorage,
    sessionStorage,
    navigator: {},
    history: { replaceState() {} },
    Headers,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto,
    Date,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout: fn => { scheduled.push(fn); return scheduled.length; },
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      if (String(url).endsWith('/api/auth/mobile')) {
        return {
          ok: true,
          json: async () => ({ owner: '123456', token: 'sealed-mobile-jwt', site: 'https://ububall.tch.one', returnTo: mobileAuthReturnTo })
        };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(platformSource, sandbox);
  return { ubuPlatform: mockWindow.ubuPlatform, mockWindow, fetchCalls, winEvents, docEvents, scheduled };
}

test('web mode preserves fetch/origins while native Android rewrites origins, attaches Bearer tokens, and completes PKCE login including cold-start recovery', async () => {
  const web = bootPlatform({ native: false });
  assert.equal(web.ubuPlatform.isNative, false);
  assert.equal(web.ubuPlatform.apiUrl('/api/session'), '/api/session');
  assert.equal(web.ubuPlatform.wsUrl('/api/ububall/123/socket'), 'wss://ububall.tch.one/api/ububall/123/socket');
  assert.equal(web.ubuPlatform.publicOrigin(), 'https://ububall.tch.one');
  await web.ubuPlatform.fetch('/api/config');
  assert.equal(web.fetchCalls[0].url, '/api/config');
  assert.equal(web.fetchCalls[0].init, undefined);

  // Native mode: origin/WSS rewriting, PKCE login, deep-link completion, and Bearer header attachment.
  const listeners = new Map();
  let browserOpenedUrl = '', browserClosed = false;
  const native = bootPlatform({
    native: true,
    apiOriginOverride: 'https://ububall.tch.one/',
    plugins: {
      App: { addListener: (name, cb) => listeners.set(name, cb), getLaunchUrl: async () => null },
      Browser: { open: async ({ url }) => { browserOpenedUrl = url; }, close: async () => { browserClosed = true; } }
    }
  });
  assert.equal(native.ubuPlatform.isNative, true);
  assert.equal(native.ubuPlatform.apiUrl('/api/session'), 'https://ububall.tch.one/api/session');
  assert.equal(native.ubuPlatform.wsUrl('/api/ububall/abc/socket'), 'wss://ububall.tch.one/api/ububall/abc/socket');

  await native.ubuPlatform.openDiscordLogin('/collection');
  assert.match(browserOpenedUrl, /^https:\/\/ububall\.tch\.one\/auth\/discord\?platform=android&challenge=[A-Za-z0-9_-]{43}&return=%2Fcollection$/);
  await listeners.get('appUrlOpen')({ url: 'ububall://auth#ticket=handoff-xyz' });
  assert.equal(browserClosed, true);
  assert.equal(native.ubuPlatform.getMobileToken(), 'sealed-mobile-jwt');
  assert.equal(native.mockWindow.__navigated, '/collection');

  await native.ubuPlatform.fetch('/api/teams', { method: 'GET' });
  const lastCall = native.fetchCalls[native.fetchCalls.length - 1];
  assert.equal(lastCall.url, 'https://ububall.tch.one/api/teams');
  assert.equal(lastCall.init.headers.get('Authorization'), 'Bearer sealed-mobile-jwt');

  // Cold-start getLaunchUrl recovers persisted PKCE verifier from localStorage and updates in-match session without reload.
  const cold = bootPlatform({
    native: true,
    mobileAuthReturnTo: '/?match=12345678-1234-4000-8000-123456789abc',
    initialLocalStorage: {
      'ububall:oauth-verifier': JSON.stringify({ verifier: 'persisted-verifier', expires: Date.now() + 60000 })
    },
    plugins: {
      App: { addListener() {}, getLaunchUrl: async () => ({ url: 'ububall://auth#ticket=cold-start-ticket' }) },
      Browser: { close: async () => {} }
    }
  });
  cold.mockWindow.location.pathname = '/';
  cold.mockWindow.location.search = '?match=12345678-1234-4000-8000-123456789abc';
  await new Promise(resolve => setImmediate(resolve));
  const authCall = cold.fetchCalls.find(c => String(c.url).endsWith('/api/auth/mobile'));
  assert.ok(authCall, 'cold-start getLaunchUrl exchanges persisted PKCE verifier from localStorage');
  assert.equal(JSON.parse(authCall.init.body).verifier, 'persisted-verifier');
  assert.equal(cold.mockWindow.location.reloadCalled, 0);
});

test('silent OTA lifecycle confirms boot once via markAppReady, throttles update checks, and suppresses confirmation after startup errors', async () => {
  let bootConfirmed = 0;
  const checkCalls = [];
  const otaPlugins = () => ({
    App: { addListener() {}, getLaunchUrl: async () => null },
    OtaUpdater: {
      notifyBootOk: async () => { bootConfirmed++; return { isOta: true }; },
      checkForUpdate: async opts => { checkCalls.push(opts); return { status: 'staged', version: '0123456789abcdef' }; },
      getStatus: async () => ({ activeVersion: '0123456789abcdef', isOta: true })
    }
  });

  const healthy = bootPlatform({ native: true, readyState: 'interactive', plugins: otaPlugins() });
  assert.equal(bootConfirmed, 0, 'must wait until markAppReady before confirming OTA boot');
  for (const fn of (healthy.docEvents.get('DOMContentLoaded') || [])) fn();
  assert.equal(bootConfirmed, 0, 'DOMContentLoaded alone must not confirm OTA boot');
  healthy.ubuPlatform.markAppReady();
  healthy.ubuPlatform.markAppReady();
  assert.equal(bootConfirmed, 1, 'markAppReady confirms once');

  assert.equal(typeof healthy.scheduled[0], 'function');
  healthy.scheduled[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(checkCalls)), [{ origin: 'https://ububall.tch.one' }]);
  assert.equal((await healthy.ubuPlatform.checkForUpdate(false)).status, 'throttled');
  assert.equal(checkCalls.length, 1);
  assert.equal((await healthy.ubuPlatform.checkForUpdate(true)).status, 'staged');
  assert.equal(checkCalls.length, 2);
  assert.equal((await healthy.ubuPlatform.getOtaStatus()).isOta, true);

  // Uncaught startup error suppresses notifyBootOk.
  bootConfirmed = 0;
  const broken = bootPlatform({ native: true, readyState: 'interactive', plugins: otaPlugins() });
  for (const fn of (broken.winEvents.get('error') || [])) fn(new Error('boot syntax/runtime error'));
  broken.ubuPlatform.markAppReady();
  assert.equal(bootConfirmed, 0, 'must not confirm OTA boot after a startup script error');
});

test('prepare-assets generates mobile-manifest.json with accurate SHA-256 hashes, issuedAt, and native compatibility floor', () => {
  const ota = require('../scripts/ota-manifest.cjs');
  const root = path.resolve(__dirname, '..');
  execFileSync(process.execPath, [path.join(root, 'scripts/prepare-assets.cjs')], { cwd: root });
  const manifestPath = path.join(root, 'dist/public/mobile-manifest.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.minNativeVersion, 1);
  assert.ok(Number.isSafeInteger(manifest.issuedAt) && manifest.issuedAt > 1700000000000);
  assert.match(manifest.version, /^[0-9a-f]{16}$/);
  assert.ok(manifest.files['index.html']);
  assert.ok(manifest.files['platform.js']);
  assert.ok(manifest.files['assets/ububall-logo.svg']);
  assert.equal(manifest.files['mobile-manifest.json'], undefined);
  assert.equal(manifest.files['mobile-manifest.sig'], undefined);
  for (const [rel, meta] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(root, 'dist/public', rel));
    assert.equal(bytes.length, meta.size, `size mismatch for ${rel}`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, meta.sha256, `sha256 mismatch for ${rel}`);
  }

  // Test ECDSA P-256 signing & verification and plugin floor resolution via scripts/ota-manifest.cjs
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const sig = ota.signManifest(manifestBytes, privPem);
  assert.equal(ota.verifyManifest(manifestBytes, sig, pubPem), true);
  const tampered = Buffer.from(manifestBytes);
  tampered[10] ^= 1;
  assert.equal(ota.verifyManifest(tampered, sig, pubPem), false);

  const compat = JSON.parse(fs.readFileSync(path.join(root, 'mobile/native-compat.json'), 'utf8'));
  assert.equal(ota.minNativeVersion(new Set(['App', 'Haptics', 'OtaUpdater']), compat), 1);
  assert.throws(() => ota.minNativeVersion(new Set(['App', 'FutureCameraPlugin']), compat), /FutureCameraPlugin/);

  // Test --require-ota-signature fails closed when no OTA signing key is present
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ububall-ota-'));
  try {
    assert.throws(() => {
      execFileSync(process.execPath, [path.join(root, 'scripts/prepare-assets.cjs'), '--require-ota-signature'], {
        cwd: root,
        stdio: 'pipe',
        env: { ...process.env, UBUBALL_OTA_SIGNING_KEY: '', LOCALAPPDATA: tmpDir, HOME: tmpDir, USERPROFILE: tmpDir }
      });
    }, /No OTA signing key found/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    // Restore signed dist/public after negative test
    execFileSync(process.execPath, [path.join(root, 'scripts/prepare-assets.cjs')], { cwd: root });
  }
});
