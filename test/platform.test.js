'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

function bootPlatform({ native = false, plugins = {}, apiOriginOverride = '', initialLocalStorage = {}, elements = new Map(), mobileAuthReturnTo = '/collection', loadMintScripts = null } = {}) {
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();
  if (apiOriginOverride) localStorage.setItem('ububall:api-origin', apiOriginOverride);
  for (const [k, v] of Object.entries(initialLocalStorage)) localStorage.setItem(k, v);
  const fetchCalls = [];
  const events = new Map();
  const classList = new Set();
  const dialogs = [];

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
    ubuAudio: {
      __calls: [],
      playGoalHit(...args) { this.__calls.push(['playGoalHit', args]); return 'goal-ok'; },
      playCollision(...args) { this.__calls.push(['playCollision', args]); return 'col-ok'; },
      stop() { this.__calls.push(['stop']); },
      getAudioContext: () => ({ state: 'running', suspend() { mockWindow.__suspended = true; }, resume() { mockWindow.__resumed = true; } })
    },
    checkUbuSession: async () => { mockWindow.__sessionChecked = (mockWindow.__sessionChecked || 0) + 1; },
    navigateUbuScreen: async href => { mockWindow.__navigated = href; mockWindow.location.pathname = href.split('?')[0]; },
    loadMintScripts: loadMintScripts || (async () => { mockWindow.__mintScriptsLoaded = true; }),
    addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
    dispatchEvent(ev) {
      if (ev.type === 'keydown') mockWindow.__keyEvents = (mockWindow.__keyEvents || 0) + 1;
      for (const fn of (events.get(ev.type) || [])) fn(ev);
      return true;
    }
  };

  const mockDocument = {
    readyState: 'complete',
    documentElement: { classList: { add: (...names) => names.forEach(n => classList.add(n)) } },
    body: { dataset: { shot: 'home' }, append() {} },
    getElementById: id => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: sel => (sel === 'dialog[open]' ? dialogs : []),
    addEventListener() {},
    dispatchEvent(ev) {
      mockDocument.__lastKey = ev.key;
      mockDocument.__keyEvents = (mockDocument.__keyEvents || 0) + 1;
      if (ev.bubbles) mockWindow.dispatchEvent(ev);
      return true;
    },
    createElement: tag => ({ tag, click() { mockDocument.__clickedDownload = this.download; }, remove() {} })
  };

  const sandbox = {
    window: mockWindow,
    document: mockDocument,
    location: mockWindow.location,
    localStorage,
    sessionStorage,
    navigator: {},
    history: { replaceState: (_s, _t, url) => { mockWindow.__replacedUrl = url; } },
    Headers,
    Blob,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    Event: class Event { constructor(type, init) { this.type = type; this.cancelable = Boolean(init?.cancelable); } },
    KeyboardEvent: class KeyboardEvent { constructor(type, init) { this.type = type; this.key = init?.key; this.bubbles = Boolean(init?.bubbles); this.cancelable = Boolean(init?.cancelable); } },
    crypto,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    performance: { now: () => sandbox.__now },
    setTimeout: () => 1,
    __now: 1000,
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
  return { ubuPlatform: mockWindow.ubuPlatform, mockWindow, mockDocument, fetchCalls, classList, dialogs, sandbox, localStorage };
}

test('web mode no-ops cleanly and preserves exact 1-arg and 2-arg fetch signatures', async () => {
  const { ubuPlatform, fetchCalls, classList } = bootPlatform({ native: false });
  assert.equal(ubuPlatform.isNative, false);
  assert.equal(ubuPlatform.apiUrl('/api/session'), '/api/session');
  assert.equal(ubuPlatform.wsUrl('/api/ububall/123/socket'), 'wss://ububall.tch.one/api/ububall/123/socket');
  assert.equal(ubuPlatform.publicOrigin(), 'https://ububall.tch.one');
  assert.equal(classList.size, 0);

  await ubuPlatform.fetch('/api/config');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, '/api/config');
  assert.equal(fetchCalls[0].init, undefined);
});

test('Capacitor Android mode rewrites API/WSS origins, attaches Bearer tokens, completes PKCE deep-link login, exports files, and throttles haptics', async () => {
  const listeners = new Map();
  let browserOpenedUrl = '';
  let browserClosed = false;
  let writtenFile = null;
  let sharedPayload = null;
  let minimized = false;
  const hapticsCalls = [];

  const plugins = {
    App: {
      addListener: (name, cb) => { listeners.set(name, cb); },
      getLaunchUrl: async () => null,
      minimizeApp: async () => { minimized = true; }
    },
    Browser: {
      open: async ({ url }) => { browserOpenedUrl = url; },
      close: async () => { browserClosed = true; }
    },
    Filesystem: {
      writeFile: async opts => { writtenFile = opts; },
      getUri: async ({ path: p }) => ({ uri: 'file:///cache/' + p })
    },
    Share: {
      share: async opts => { sharedPayload = opts; }
    },
    Haptics: {
      notification: async opts => { hapticsCalls.push(['notification', opts.type]); },
      impact: async opts => { hapticsCalls.push(['impact', opts.style]); }
    },
    ScreenOrientation: {
      lock: async ({ orientation }) => { plugins.__locked = orientation; }
    }
  };

  const { ubuPlatform, mockWindow, fetchCalls, classList, dialogs, sandbox } = bootPlatform({
    native: true,
    plugins,
    apiOriginOverride: 'https://ububall.tch.one/'
  });

  assert.equal(ubuPlatform.isNative, true);
  assert.ok(classList.has('capacitor-native'));
  assert.equal(ubuPlatform.apiUrl('/api/session'), 'https://ububall.tch.one/api/session');
  assert.equal(ubuPlatform.wsUrl('/api/ububall/abc/socket'), 'wss://ububall.tch.one/api/ububall/abc/socket');

  // PKCE login + deep link completion
  await ubuPlatform.openDiscordLogin('/collection');
  assert.match(browserOpenedUrl, /^https:\/\/ububall\.tch\.one\/auth\/discord\?platform=android&challenge=[A-Za-z0-9_-]{43}&return=%2Fcollection$/);

  await listeners.get('appUrlOpen')({ url: 'ububall://auth#ticket=handoff-xyz' });
  assert.equal(browserClosed, true);
  assert.equal(ubuPlatform.getMobileToken(), 'sealed-mobile-jwt');
  assert.equal(mockWindow.__navigated, '/collection');

  // Subsequent API call carries Bearer header
  await ubuPlatform.fetch('/api/teams', { method: 'GET' });
  const lastCall = fetchCalls[fetchCalls.length - 1];
  assert.equal(lastCall.url, 'https://ububall.tch.one/api/teams');
  assert.equal(lastCall.init.headers.get('Authorization'), 'Bearer sealed-mobile-jwt');

  // Chunked file export writes to CACHE and invokes native Share
  const sampleBlob = new Blob(['{"ubu":1}'], { type: 'application/json' });
  await ubuPlatform.exportFile(sampleBlob, 'Test-Ubu.ubu');
  assert.equal(writtenFile.path, 'Test-Ubu.ubu');
  assert.equal(writtenFile.directory, 'CACHE');
  assert.equal(Buffer.from(writtenFile.data, 'base64').toString('utf8'), '{"ubu":1}');
  assert.deepEqual([...sharedPayload.files], ['file:///cache/Test-Ubu.ubu']);

  // Haptics decorate ubuAudio and throttle rapid light collisions
  mockWindow.ubuAudio.playGoalHit();
  mockWindow.ubuAudio.playCollision();
  mockWindow.ubuAudio.playCollision(); // throttled (<45ms)
  sandbox.__now = 1100;
  mockWindow.ubuAudio.playCollision(); // allowed
  assert.deepEqual(JSON.parse(JSON.stringify(hapticsCalls)), [
    ['notification', 'SUCCESS'],
    ['impact', 'LIGHT'],
    ['impact', 'LIGHT']
  ]);

  // Hardware back button stack: closes dialog -> navigates from /collection to / -> minimizes from home
  let dialogClosed = false;
  dialogs.push({ dataset: {}, dispatchEvent: () => true, close: () => { dialogClosed = true; dialogs.pop(); } });
  listeners.get('backButton')();
  assert.equal(dialogClosed, true);

  mockWindow.location.pathname = '/collection';
  listeners.get('backButton')();
  assert.equal(mockWindow.location.pathname, '/');

  listeners.get('backButton')();
  assert.equal(minimized, true);
});

test('PKCE cold-start recovery, .ubu script preload order, in-match auth return, custom scheme links, and back-button stack', async () => {
  const listeners = new Map();
  let mintLoadedBeforeImport = false;
  let mintScriptsReady = false;
  let revealClosed = false;
  let viewerClosed = false;
  const elements = new Map([
    ['mint-reveal', { hidden: false }],
    ['pause-reveal', { click: () => { revealClosed = true; elements.get('mint-reveal').hidden = true; } }],
    ['close-viewer', { click: () => { viewerClosed = true; dialogs.pop(); } }]
  ]);

  const plugins = {
    App: {
      addListener: (name, cb) => { listeners.set(name, cb); },
      getLaunchUrl: async () => ({ url: 'ububall://auth#ticket=cold-start-ticket' }),
      minimizeApp: async () => {}
    },
    Browser: { close: async () => {} },
    Filesystem: {
      readFile: async () => ({ data: Buffer.from('{"ubu":true}').toString('base64') })
    }
  };

  const { mockWindow, mockDocument, fetchCalls, dialogs } = bootPlatform({
    native: true,
    plugins,
    elements,
    mobileAuthReturnTo: '/?match=12345678-1234-4000-8000-123456789abc',
    initialLocalStorage: {
      'ububall:oauth-verifier': JSON.stringify({ verifier: 'persisted-verifier', expires: Date.now() + 60000 })
    },
    loadMintScripts: async () => { mintScriptsReady = true; }
  });

  // Simulate already being on the match screen when guest upgrades via Discord OAuth.
  mockWindow.location.pathname = '/';
  mockWindow.location.search = '?match=12345678-1234-4000-8000-123456789abc';
  await new Promise(resolve => setImmediate(resolve));

  const authCall = fetchCalls.find(c => String(c.url).endsWith('/api/auth/mobile'));
  assert.ok(authCall, 'cold-start getLaunchUrl exchanges persisted PKCE verifier from localStorage');
  assert.equal(JSON.parse(authCall.init.body).verifier, 'persisted-verifier');
  assert.equal(mockWindow.location.reloadCalled, 0, 'in-match auth upgrade updates session without reloading');

  // Incoming content:// .ubu awaits loadMintScripts() before firing ubu:import-ubu-bytes.
  mockWindow.addEventListener('ubu:import-ubu-bytes', () => {
    mintLoadedBeforeImport = mintScriptsReady;
  });
  await listeners.get('appUrlOpen')({ url: 'content://com.android.providers.downloads/document/42' });
  assert.equal(mintLoadedBeforeImport, true);

  // ububall://mint routes to /mint via navigateUbuScreen.
  await listeners.get('appUrlOpen')({ url: 'ububall://mint' });
  assert.equal(mockWindow.location.pathname, '/mint');

  // Back button closes Mint pack reveal before leaving /mint, clicks #close-viewer for #viewer, and fires Escape once.
  listeners.get('backButton')();
  assert.equal(revealClosed, true);
  assert.equal(mockWindow.location.pathname, '/mint');

  dialogs.push({ id: 'viewer', dataset: {}, dispatchEvent: () => true, close: () => assert.fail('must use #close-viewer') });
  listeners.get('backButton')();
  assert.equal(viewerClosed, true);

  listeners.get('backButton')();
  assert.equal(mockWindow.location.pathname, '/');

  mockDocument.body.dataset.shot = 'match';
  listeners.get('backButton')();
  assert.equal(mockDocument.__lastKey, 'Escape');
  assert.equal(mockDocument.__keyEvents, 1);
  assert.equal(mockWindow.__keyEvents, 1);
});

test('asset allowlist, index.html script load order, install.ps1 mobile exclusion, and Capacitor JSON configs stay aligned', () => {
  const root = path.resolve(__dirname, '..');
  const prepareSrc = fs.readFileSync(path.join(root, 'scripts/prepare-assets.cjs'), 'utf8');
  assert.match(prepareSrc, /'platform\.js'/);

  const indexHtml = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  const platIdx = indexHtml.indexOf('src="platform.js"');
  const actIdx = indexHtml.indexOf('src="ububall-activity.js"');
  const headIdx = indexHtml.indexOf('src="site-header.js"');
  assert.ok(platIdx !== -1 && platIdx < actIdx && actIdx < headIdx, 'platform.js must load before ububall-activity.js and site-header.js');

  const installSrc = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
  assert.match(installSrc, /-notlike 'mobile\/\*'/);

  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /\*\.keystore/);
  assert.match(gitignore, /\*\.jks/);
  assert.match(gitignore, /mobile\/node_modules\//);

  const capConfigPath = path.join(root, 'mobile/capacitor.config.json');
  if (fs.existsSync(capConfigPath)) {
    const capConfig = JSON.parse(fs.readFileSync(capConfigPath, 'utf8'));
    assert.equal(capConfig.webDir, '../dist/public');
    assert.equal(capConfig.server.androidScheme, 'https');
    assert.equal(capConfig.server.hostname, 'localhost');
  }

  const mobPkgPath = path.join(root, 'mobile/package.json');
  if (fs.existsSync(mobPkgPath)) {
    const mobPkg = JSON.parse(fs.readFileSync(mobPkgPath, 'utf8'));
    assert.ok(mobPkg.dependencies['@capacitor/android']);
    assert.ok(mobPkg.dependencies['@capacitor/browser']);
    assert.ok(mobPkg.dependencies['@capacitor/haptics']);
  }
});

test('haptics decoration wires ubuAudio even when platform.js executes before ubu-audio.js during interactive defer load', () => {
  const hapticsCalls = [];
  const docEvents = new Map();
  const mockWindow = {
    location: { origin: 'https://localhost', protocol: 'https:', host: 'localhost', pathname: '/', search: '', hash: '' },
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        App: { addListener() {}, getLaunchUrl: async () => null },
        Haptics: { impact: async opts => { hapticsCalls.push(opts.style); } }
      }
    },
    addEventListener() {}
  };
  const mockDocument = {
    readyState: 'interactive',
    documentElement: { classList: { add() {} } },
    body: { dataset: { shot: 'home' } },
    querySelector: () => null,
    addEventListener(type, fn) { if (!docEvents.has(type)) docEvents.set(type, []); docEvents.get(type).push(fn); }
  };
  const sandbox = {
    window: mockWindow,
    document: mockDocument,
    location: mockWindow.location,
    localStorage: mockWindow.localStorage,
    sessionStorage: mockWindow.sessionStorage,
    navigator: {},
    performance: { now: () => 500 },
    URL,
    URLSearchParams
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(platformSource, sandbox);

  // ubu-audio.js loads after platform.js while document.readyState is 'interactive'
  mockWindow.ubuAudio = { playCollision() { return 'ok'; } };
  for (const fn of (docEvents.get('DOMContentLoaded') || [])) fn();

  assert.equal(mockWindow.ubuAudio.__hapticsWired, true);
  assert.equal(mockWindow.ubuAudio.playCollision(), 'ok');
  assert.deepEqual(hapticsCalls, ['LIGHT']);
});

test('silent OTA lifecycle confirms boot via notifyBootOk and throttles background checkForUpdate', async () => {
  let bootConfirmed = 0;
  const checkCalls = [];
  const docEvents = new Map();
  let scheduledFn = null;

  const mockWindow = {
    location: { origin: 'https://localhost', protocol: 'https:', host: 'localhost', pathname: '/', search: '', hash: '' },
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        App: { addListener() {}, getLaunchUrl: async () => null },
        OtaUpdater: {
          notifyBootOk: async () => { bootConfirmed++; return { isOta: true }; },
          checkForUpdate: async opts => { checkCalls.push(opts); return { status: 'staged', version: '0123456789abcdef' }; },
          getStatus: async () => ({ activeVersion: '0123456789abcdef', isOta: true })
        }
      }
    },
    addEventListener() {}
  };
  const mockDocument = {
    readyState: 'interactive',
    documentElement: { classList: { add() {} } },
    body: { dataset: { shot: 'home' } },
    querySelector: () => null,
    addEventListener(type, fn) { if (!docEvents.has(type)) docEvents.set(type, []); docEvents.get(type).push(fn); }
  };
  const sandbox = {
    window: mockWindow,
    document: mockDocument,
    location: mockWindow.location,
    localStorage: mockWindow.localStorage,
    sessionStorage: mockWindow.sessionStorage,
    navigator: {},
    performance: { now: () => 500 },
    setTimeout: fn => { scheduledFn = fn; return 1; },
    Date,
    URL,
    URLSearchParams
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(platformSource, sandbox);

  assert.equal(bootConfirmed, 0, 'must wait until DOMContentLoaded before confirming OTA boot');
  for (const fn of (docEvents.get('DOMContentLoaded') || [])) fn();
  assert.equal(bootConfirmed, 1);

  assert.equal(typeof scheduledFn, 'function');
  scheduledFn();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(checkCalls)), [{ origin: 'https://ububall.tch.one' }]);

  const throttled = await mockWindow.ubuPlatform.checkForUpdate(false);
  assert.equal(throttled.status, 'throttled');
  assert.equal(checkCalls.length, 1);

  const forced = await mockWindow.ubuPlatform.checkForUpdate(true);
  assert.equal(forced.status, 'staged');
  assert.equal(checkCalls.length, 2);

  const status = await mockWindow.ubuPlatform.getOtaStatus();
  assert.equal(status.isOta, true);
});

test('prepare-assets generates mobile-manifest.json with accurate SHA-256 hashes for dist/public', () => {
  const { execFileSync } = require('node:child_process');
  const { createHash } = require('node:crypto');
  const root = path.resolve(__dirname, '..');
  execFileSync(process.execPath, [path.join(root, 'scripts/prepare-assets.cjs')], { cwd: root });
  const manifestPath = path.join(root, 'dist/public/mobile-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.minNativeVersion, 1);
  assert.match(manifest.version, /^[0-9a-f]{16}$/);
  assert.ok(manifest.files['index.html']);
  assert.ok(manifest.files['platform.js']);
  assert.ok(manifest.files['assets/ububall-logo.svg']);
  for (const [rel, meta] of Object.entries(manifest.files)) {
    const bytes = fs.readFileSync(path.join(root, 'dist/public', rel));
    assert.equal(bytes.length, meta.size, `size mismatch for ${rel}`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, meta.sha256, `sha256 mismatch for ${rel}`);
  }
});
