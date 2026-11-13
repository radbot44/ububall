'use strict';
// App shell: Play, Ubu Mint and Collection share one page and persistent rink stage, switching by path.
(() => {
  const screens = { '/': 'play', '/mint': 'mint', '/collection': 'collection' };
  const titles = { play: 'Ububall', mint: 'Ubu Mint · Ububall', collection: 'Collection · Ububall' };
  const screenOf = path => Object.hasOwn(screens, path) ? screens[path] : null;
  const appParams = new Set(['match', 'watch', 'roster']);
  const activityParams = window.ubuActivity
    ? [...new URL(location.href).searchParams].filter(([k]) => !appParams.has(k))
    : [];
  const withActivitySearch = href => {
    const url = new URL(href, location.origin);
    for (const [k, v] of activityParams) {
      if (!url.searchParams.has(k)) url.searchParams.set(k, v);
    }
    return url;
  };
  const loadedScripts = new Map();
  let guard = null;
  let screenTransition = (_, apply) => apply();
  let activeScreen = null;
  let playUrl = (screenOf(location.pathname) || 'play') === 'play' ? location.href : withActivitySearch('/').href;
  let navToken = 0;

  // Ubu Mint and Collection share site.js; load it on the first visit to either screen, or when
  // the team picker opens the ubu viewer. Failed scripts evict themselves so later visits can retry.
  function loadScript(src) {
    if (!loadedScripts.has(src)) {
      const promise = new Promise((resolve, reject) => {
        const script = Object.assign(document.createElement('script'), { src, async: false });
        script.onload = resolve;
        script.onerror = () => {
          script.remove();
          loadedScripts.delete(src);
          reject(new Error(`Could not load ${src}.`));
        };
        document.head.append(script);
      });
      loadedScripts.set(src, promise);
    }
    return loadedScripts.get(src);
  }
  function loadMintScripts() {
    return Promise.all(['pack-scene.js', 'site.js'].map(loadScript));
  }
  function loadMp4Script() {
    return loadScript('mp4.js');
  }
  window.loadMintScripts = loadMintScripts;
  window.loadMp4Script = loadMp4Script;
  window.setUbuScreenGuard = fn => { guard = typeof fn === 'function' ? fn : null; };
  window.setUbuScreenTransition = fn => { screenTransition = typeof fn === 'function' ? fn : (_, apply) => apply(); };

  const rememberPlayUrl = () => {
    if ((screenOf(location.pathname) || 'play') === 'play') playUrl = location.href;
  };
  addEventListener('pointerdown', rememberPlayUrl, true);
  addEventListener('keydown', rememberPlayUrl, true);

  function closeTransientUI() {
    for (const id of ['viewer', 'account-dialog']) {
      const dlg = document.getElementById(id);
      if (dlg?.open) dlg.close();
    }
    for (const pop of document.querySelectorAll('.game-popover, #more-menu')) {
      if (pop.matches?.(':popover-open')) {
        try { pop.hidePopover(); } catch {}
      }
    }
  }

  function show() {
    const screen = screenOf(location.pathname) || 'play';
    const prev = activeScreen;
    activeScreen = screen;
    if (screen === 'play') playUrl = location.href;
    if (prev && prev !== screen) closeTransientUI();
    screenTransition(screen, () => {
      for (const el of document.querySelectorAll('[data-screen]')) el.hidden = el.dataset.screen !== screen;
      if (prev && prev !== screen) {
        scrollTo(0, 0);
        document.body?.scrollTo?.(0, 0);
      }
    }, prev);
    for (const link of document.querySelectorAll('.site-nav a')) {
      if (screenOf(new URL(link.href).pathname) === screen) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.title = titles[screen];
    if (screen !== 'play') {
      loadMintScripts().catch(() => {
        const statusEl = document.getElementById(screen === 'mint' ? 'status' : 'collection-status');
        if (statusEl) {
          statusEl.textContent = 'Could not load this screen. Check your connection and try again.';
          statusEl.hidden = false;
        }
      });
    }
    window.dispatchEvent(new CustomEvent('ubu:screen', { detail: screen }));
  }

  async function navigateUbuScreen(href) {
    const raw = new URL(href, location.origin);
    const next = raw.origin === location.origin ? screenOf(raw.pathname) : null;
    if (!next) return false;
    const url = activityParams.length ? withActivitySearch(raw.href) : raw;
    document.getElementById('more-menu')?.hidePopover();
    const current = activeScreen || screenOf(location.pathname) || 'play';
    const token = ++navToken;
    if (current === 'play' && next !== 'play' && guard) {
      rememberPlayUrl();
      if (await guard(next) === false || token !== navToken) return false;
    }
    if (url.href !== location.href) history.pushState(null, '', url);
    show();
    return true;
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !screenOf(url.pathname)) return;
    event.preventDefault();
    void navigateUbuScreen(url.href);
  });

  window.addEventListener('popstate', async () => {
    const next = screenOf(location.pathname) || 'play';
    const current = activeScreen || 'play';
    const savedPlayUrl = playUrl;
    const token = ++navToken;
    if (current === 'play' && next !== 'play' && guard) {
      if (await guard(next) === false) {
        if (token === navToken && location.href !== savedPlayUrl) {
          history.pushState(null, '', savedPlayUrl);
        }
        return;
      }
      if (token !== navToken) return;
    }
    show();
  });

  window.navigateUbuScreen = navigateUbuScreen;
  window.showUbuScreen = show;
  show();
  document.documentElement.classList.remove('booting');
})();
