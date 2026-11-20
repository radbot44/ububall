'use strict';
// Native platform adapter (Capacitor Android/iOS). No-ops cleanly on standard Web and Discord Activities.
(() => {
  const DEFAULT_API_ORIGIN = 'https://ububall.tch.one';
  const TOKEN_KEY = 'ububall:mobile-token';
  const SITE_KEY = 'ububall:site-origin';
  const ORIGIN_OVERRIDE_KEY = 'ububall:api-origin';
  const VERIFIER_KEY = 'ububall:oauth-verifier';
  const HAPTICS_KEY = 'ububall-haptics';

  const cap = typeof window !== 'undefined' ? window.Capacitor : null;
  const isNative = Boolean(cap?.isNativePlatform?.());
  const platform = isNative ? (cap.getPlatform?.() || 'android') : 'web';
  const plugins = () => cap?.Plugins || {};

  let memoryToken = '';
  let memorySite = '';
  let pendingVerifier = null;
  let lastHapticAt = 0;
  let lastOtaCheckAt = 0;
  let otaBootConfirmed = false;
  const OTA_CHECK_INTERVAL_MS = 5 * 60 * 1000;

  function readStorage(storage, key) {
    try { return storage?.getItem?.(key) || ''; } catch { return ''; }
  }
  function writeStorage(storage, key, value) {
    try {
      if (value) storage?.setItem?.(key, value);
      else storage?.removeItem?.(key);
    } catch {}
  }

  if (isNative) {
    memoryToken = readStorage(window.localStorage, TOKEN_KEY);
    memorySite = readStorage(window.localStorage, SITE_KEY);
  }

  function apiOrigin() {
    if (!isNative) return '';
    const meta = typeof document !== 'undefined'
      ? document.querySelector('meta[name="ubu-api-origin"]')?.content?.trim()
      : '';
    const override = (typeof window !== 'undefined' && window.UBU_API_ORIGIN) ||
      meta ||
      readStorage(window.localStorage, ORIGIN_OVERRIDE_KEY);
    return (override || DEFAULT_API_ORIGIN).replace(/\/+$/, '');
  }

  function publicOrigin() {
    if (!isNative) return window.location.origin;
    return (memorySite || apiOrigin()).replace(/\/+$/, '');
  }

  function setSiteOrigin(origin) {
    if (!isNative || typeof origin !== 'string' || !origin.startsWith('http')) return;
    const clean = origin.replace(/\/+$/, '');
    memorySite = clean;
    writeStorage(window.localStorage, SITE_KEY, clean);
  }

  function getMobileToken() {
    if (!isNative) return '';
    return memoryToken || readStorage(window.localStorage, TOKEN_KEY);
  }

  function setMobileToken(token) {
    if (!isNative || typeof token !== 'string' || !token) return;
    memoryToken = token;
    writeStorage(window.localStorage, TOKEN_KEY, token);
  }

  function clearMobileToken() {
    memoryToken = '';
    if (isNative) writeStorage(window.localStorage, TOKEN_KEY, '');
  }

  function apiUrl(path) {
    if (!isNative || typeof path !== 'string' || !path.startsWith('/')) return path;
    return apiOrigin() + path;
  }

  function wsUrl(path) {
    if (!isNative) {
      return (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + path;
    }
    const base = new URL(apiOrigin());
    const proto = base.protocol === 'https:' ? 'wss://' : 'ws://';
    return proto + base.host + path;
  }

  async function platformFetch(path, init) {
    if (!isNative) {
      return init === undefined ? fetch(path) : fetch(path, init);
    }
    const url = apiUrl(path);
    const headers = new Headers(init?.headers || {});
    const token = getMobileToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
    }
    const response = await fetch(url, { ...(init || {}), headers });
    return response;
  }

  function encodeBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    const parts = [];
    for (let i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return btoa(parts.join(''));
  }

  async function openDiscordLogin(returnPath = '/') {
    if (!isNative) return false;
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const verifier = encodeBase64Url(verifierBytes);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const challenge = encodeBase64Url(digest);
    const record = JSON.stringify({ verifier, expires: Date.now() + 600000 });
    pendingVerifier = { verifier, expires: Date.now() + 600000 };
    writeStorage(window.localStorage, VERIFIER_KEY, record);

    const url = `${apiOrigin()}/auth/discord?platform=android&challenge=${encodeURIComponent(challenge)}&return=${encodeURIComponent(returnPath)}`;
    const Browser = plugins().Browser;
    if (Browser?.open) {
      await Browser.open({ url, presentationStyle: 'popover' });
      return true;
    }
    window.open(url, '_blank');
    return true;
  }

  function consumeVerifier() {
    let record = pendingVerifier;
    pendingVerifier = null;
    if (!record) {
      try {
        const raw = readStorage(window.localStorage, VERIFIER_KEY);
        if (raw) record = JSON.parse(raw);
      } catch {}
    }
    writeStorage(window.localStorage, VERIFIER_KEY, '');
    if (!record || typeof record.verifier !== 'string' || record.expires <= Date.now()) return '';
    return record.verifier;
  }

  function applyReturnRoute(targetPath) {
    if (typeof targetPath !== 'string' || !targetPath.startsWith('/')) return;
    try {
      const parsed = new URL(targetPath, window.location.origin);
      if (parsed.pathname === '/mint' || parsed.pathname === '/collection') {
        void window.navigateUbuScreen?.(parsed.pathname + parsed.search + parsed.hash);
        return;
      }
      if (parsed.searchParams.has('match') || parsed.searchParams.has('watch')) {
        const currentRoute = window.location.pathname + window.location.search;
        const nextRoute = parsed.pathname + parsed.search;
        if (currentRoute !== nextRoute) {
          history.replaceState(null, '', parsed.pathname + parsed.search + parsed.hash);
          window.dispatchEvent(new CustomEvent('ubu:deep-link', { detail: nextRoute }));
          window.location.reload();
        }
        return;
      }
      if (parsed.searchParams.has('roster')) {
        void window.navigateUbuScreen?.(parsed.pathname + parsed.search + parsed.hash);
        return;
      }
      if (parsed.pathname === '/' && window.location.pathname !== '/') {
        void window.navigateUbuScreen?.('/' + parsed.search + parsed.hash);
      }
    } catch {}
  }

  async function handleIncomingUrl(rawUrl) {
    if (!isNative || typeof rawUrl !== 'string' || !rawUrl) return;
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return; }

    const isAuthCallback = (parsed.protocol === 'ububall:' && parsed.hostname === 'auth') ||
      parsed.pathname === '/auth-complete.html';
    if (isAuthCallback) {
      try { await plugins().Browser?.close?.(); } catch {}
      const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
      const ticket = hashParams.get('ticket') || parsed.searchParams.get('ticket') || '';
      const verifier = consumeVerifier();
      if (!ticket || !verifier) return;
      try {
        const res = await platformFetch('/api/auth/mobile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket, verifier })
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.token) {
          setMobileToken(data.token);
          if (data.site) setSiteOrigin(data.site);
          await window.checkUbuSession?.(true);
          if (data.returnTo && data.returnTo !== '/') applyReturnRoute(data.returnTo);
        }
      } catch {}
      return;
    }

    if (parsed.protocol === 'content:' || parsed.protocol === 'file:') {
      try {
        const Filesystem = plugins().Filesystem;
        if (!Filesystem?.readFile) return;
        const fileRes = await Filesystem.readFile({ path: rawUrl });
        if (!fileRes?.data) return;
        const binary = atob(fileRes.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const lower = rawUrl.toLowerCase();
        if (lower.endsWith('.ubu') || (bytes[0] === 0x7b && !lower.endsWith('.ububall'))) {
          await window.navigateUbuScreen?.('/collection');
          await window.loadMintScripts?.();
          window.dispatchEvent(new CustomEvent('ubu:import-ubu-bytes', { detail: { bytes } }));
        } else {
          await window.navigateUbuScreen?.('/');
          window.dispatchEvent(new CustomEvent('ubu:import-replay-bytes', { detail: { bytes } }));
        }
      } catch {}
      return;
    }

    // Match invite, watch link, or screen deep link (ububall://open?... or ububall://mint or https://ububall.tch.one/...)
    let path = parsed.pathname || '/';
    if (parsed.protocol === 'ububall:') {
      const host = (parsed.hostname || '').toLowerCase();
      const cleanPath = (parsed.pathname || '').replace(/^\/+/, '');
      path = host && host !== 'open' ? ('/' + host + (cleanPath ? '/' + cleanPath : '')) : ('/' + cleanPath);
    }
    applyReturnRoute(path + parsed.search + parsed.hash);
  }

  function canShare() {
    if (isNative && plugins().Share?.share) return true;
    return Boolean(navigator?.share);
  }

  async function shareUrl({ title, text, url }) {
    if (isNative && plugins().Share?.share) {
      await plugins().Share.share({ title, text, url, dialogTitle: title || 'Ububall' });
      return true;
    }
    if (navigator?.share) {
      await navigator.share({ title, text, url });
      return true;
    }
    return false;
  }

  async function exportFile(blob, filename, options = {}) {
    if (isNative && plugins().Filesystem?.writeFile && plugins().Share?.share) {
      const data = await blobToBase64(blob);
      const safeName = String(filename || 'ububall-export').replace(/[\\/:*?"<>|]+/g, '-');
      await plugins().Filesystem.writeFile({ path: safeName, data, directory: 'CACHE' });
      const { uri } = await plugins().Filesystem.getUri({ path: safeName, directory: 'CACHE' });
      await plugins().Share.share({
        title: safeName,
        ...(options.text ? { text: options.text } : {}),
        files: [uri],
        dialogTitle: options.dialogTitle || safeName
      });
      return true;
    }
    if (options.preferWebShare && navigator?.share && typeof File === 'function') {
      const file = blob instanceof File ? blob : new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], ...(options.text ? { text: options.text } : {}) });
        return true;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body?.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  async function setOrientation(portrait) {
    if (!isNative) return;
    const ScreenOrientation = plugins().ScreenOrientation;
    if (!ScreenOrientation?.lock) return;
    try {
      if (portrait === null || portrait === undefined) await ScreenOrientation.unlock();
      else await ScreenOrientation.lock({ orientation: portrait ? 'portrait' : 'landscape' });
    } catch {}
  }

  async function setImmersive(active) {
    if (!isNative) return;
    try {
      const SystemBars = plugins().SystemBars;
      const StatusBar = plugins().StatusBar;
      if (SystemBars?.hide && SystemBars?.show) {
        if (active) await SystemBars.hide({});
        else await SystemBars.show({});
      } else if (StatusBar?.hide && StatusBar?.show) {
        if (active) await StatusBar.hide();
        else await StatusBar.show();
      }
    } catch {}
  }

  function hapticsEnabled() {
    if (!isNative || !plugins().Haptics) return false;
    return readStorage(window.localStorage, HAPTICS_KEY) !== 'off';
  }

  function haptic(kind = 'light') {
    if (!hapticsEnabled()) return;
    if (kind === 'light') {
      const now = performance.now();
      if (now - lastHapticAt < 45) return;
      lastHapticAt = now;
    }
    const Haptics = plugins().Haptics;
    try {
      if (kind === 'goal') void Haptics.notification?.({ type: 'SUCCESS' });
      else if (kind === 'foul') void Haptics.notification?.({ type: 'WARNING' });
      else if (kind === 'heavy') void Haptics.impact?.({ style: 'HEAVY' });
      else if (kind === 'medium') void Haptics.impact?.({ style: 'MEDIUM' });
      else void Haptics.impact?.({ style: 'LIGHT' });
    } catch {}
  }

  function decorateAudioWithHaptics() {
    if (!isNative || !window.ubuAudio || window.ubuAudio.__hapticsWired) return;
    const base = window.ubuAudio;
    const hooks = {
      playGoalHit: 'goal',
      playIronSave: 'heavy',
      playFireImpact: 'heavy',
      playSuper: 'medium',
      playSave: 'medium',
      playFoul: 'foul',
      playUnwrap: 'medium',
      playPack: 'light',
      playCollision: 'light',
      playWallHit: 'light'
    };
    const wrapped = { ...base, __hapticsWired: true };
    for (const [method, style] of Object.entries(hooks)) {
      if (typeof base[method] === 'function') {
        wrapped[method] = (...args) => {
          haptic(style);
          return base[method](...args);
        };
      }
    }
    window.ubuAudio = Object.freeze(wrapped);
    if (typeof globalThis !== 'undefined') globalThis.ubuAudio = window.ubuAudio;
  }

  function handleBackButton() {
    // 1. Close topmost open non-blocking dialog
    const openDialogs = [...document.querySelectorAll('dialog[open]')];
    if (openDialogs.length) {
      const top = openDialogs[openDialogs.length - 1];
      if (top.dataset.blocking !== 'true') {
        if (top.id === 'viewer') {
          const closeViewerBtn = document.getElementById('close-viewer');
          if (closeViewerBtn) {
            closeViewerBtn.click();
            return;
          }
        }
        const cancelEvent = new Event('cancel', { cancelable: true });
        if (top.dispatchEvent(cancelEvent)) {
          top.close();
        }
      } else {
        top.dispatchEvent(new Event('cancel', { cancelable: true }));
      }
      return;
    }
    // 2. Close open popovers
    for (const pop of document.querySelectorAll('.game-popover, #more-menu, .stat-drawer, .super-info-panel')) {
      if (pop.matches?.(':popover-open')) {
        try { pop.hidePopover(); return; } catch {}
      }
    }
    // 3. Close Mint pack reveal overlay before leaving /mint
    if (window.location.pathname === '/mint') {
      const reveal = document.getElementById('mint-reveal');
      if (reveal && !reveal.hidden) {
        document.getElementById('pause-reveal')?.click();
        return;
      }
    }
    // 4. Step back from Mint or Collection to Play
    if (window.location.pathname === '/mint' || window.location.pathname === '/collection') {
      void window.navigateUbuScreen?.('/');
      return;
    }
    // 5. In match, replay theater, or setup sheet on Play screen -> synthesize bubbling Escape on document once
    const shot = document.body?.dataset?.shot || 'home';
    if (shot !== 'home') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return;
    }
    // 6. Home screen with nothing open -> minimize app
    try { void plugins().App?.minimizeApp?.(); } catch {}
  }

  function notifyOtaBootOk() {
    if (!isNative || otaBootConfirmed) return;
    const OtaUpdater = plugins().OtaUpdater;
    if (!OtaUpdater?.notifyBootOk) return;
    otaBootConfirmed = true;
    try { void OtaUpdater.notifyBootOk(); } catch {}
  }

  async function checkForUpdate(force = false) {
    if (!isNative) return null;
    const OtaUpdater = plugins().OtaUpdater;
    if (!OtaUpdater?.checkForUpdate) return null;
    const now = Date.now();
    if (!force && lastOtaCheckAt && now - lastOtaCheckAt < OTA_CHECK_INTERVAL_MS) {
      return { status: 'throttled' };
    }
    lastOtaCheckAt = now;
    try {
      return await OtaUpdater.checkForUpdate({ origin: apiOrigin() });
    } catch {
      return null;
    }
  }

  async function getOtaStatus() {
    if (!isNative) return null;
    const OtaUpdater = plugins().OtaUpdater;
    if (!OtaUpdater?.getStatus) return null;
    try {
      return await OtaUpdater.getStatus();
    } catch {
      return null;
    }
  }

  function initNativeLifecycle() {
    if (!isNative) return;
    document.documentElement.classList.add('capacitor-native', `capacitor-${platform}`);
    decorateAudioWithHaptics();
    const onReady = () => {
      decorateAudioWithHaptics();
      notifyOtaBootOk();
    };
    if (document.readyState === 'complete') {
      onReady();
    } else {
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
      window.addEventListener?.('load', onReady, { once: true });
    }

    const App = plugins().App;
    if (App?.addListener) {
      App.addListener('appUrlOpen', event => (event?.url ? handleIncomingUrl(event.url) : undefined));
      App.addListener('backButton', () => {
        handleBackButton();
      });
      App.addListener('appStateChange', ({ isActive }) => {
        try {
          if (!isActive) {
            window.ubuAudio?.stop?.();
            const ctx = window.ubuAudio?.getAudioContext?.();
            if (ctx?.state === 'running') void ctx.suspend?.();
          } else {
            const ctx = window.ubuAudio?.getAudioContext?.();
            if (ctx?.state === 'suspended') void ctx.resume?.();
            void window.checkUbuSession?.(false);
            void checkForUpdate(false);
          }
        } catch {}
      });
      void App.getLaunchUrl?.().then(launch => {
        if (launch?.url) void handleIncomingUrl(launch.url);
      }).catch(() => {});
    }

    try { void plugins().SplashScreen?.hide?.(); } catch {}
    if (typeof setTimeout === 'function') {
      setTimeout(() => { void checkForUpdate(false); }, 2500);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initNativeLifecycle, { once: true });
    } else {
      initNativeLifecycle();
    }
  }

  const api = Object.freeze({
    isNative,
    platform,
    apiOrigin,
    publicOrigin,
    setSiteOrigin,
    getMobileToken,
    setMobileToken,
    clearMobileToken,
    apiUrl,
    wsUrl,
    fetch: platformFetch,
    openDiscordLogin,
    canShare,
    shareUrl,
    exportFile,
    setOrientation,
    setImmersive,
    haptic,
    checkForUpdate,
    getOtaStatus
  });

  if (typeof window !== 'undefined') window.ubuPlatform = api;
  if (typeof globalThis !== 'undefined') globalThis.ubuPlatform = api;
})();
