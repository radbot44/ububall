'use strict';
// App shell: Play, Ubu Mint and Collection share one page and switch by path.
(() => {
  const screens = { '/': 'play', '/mint': 'mint', '/collection': 'collection' };
  const titles = { play: 'Ububall', mint: 'Ubu Mint · Ububall', collection: 'Collection · Ububall' };
  const screenOf = path => Object.hasOwn(screens, path) ? screens[path] : null;
  let mintScripts = null;

  // Ubu Mint and Collection share site.js; load it on the first visit to either screen, or when
  // the team picker opens the ubu viewer.
  function loadMintScripts() {
    mintScripts ||= Promise.all(['pack-scene.js', 'site.js'].map(src => new Promise((resolve, reject) => {
      const script = Object.assign(document.createElement('script'), { src, async: false });
      script.onload = resolve; script.onerror = reject;
      document.head.append(script);
    })));
    return mintScripts;
  }
  window.loadMintScripts = loadMintScripts;

  function show() {
    const screen = screenOf(location.pathname) || 'play';
    for (const el of document.querySelectorAll('[data-screen]')) el.hidden = el.dataset.screen !== screen;
    for (const link of document.querySelectorAll('.site-nav a')) {
      if (screenOf(new URL(link.href).pathname) === screen) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.title = titles[screen];
    if (screen !== 'play') void loadMintScripts();
    window.dispatchEvent(new CustomEvent('ubu:screen', { detail: screen }));
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !screenOf(url.pathname)) return;
    event.preventDefault();
    document.getElementById('more-menu')?.hidePopover();
    if (url.href !== location.href) history.pushState(null, '', url);
    show();
    scrollTo(0, 0);
    document.body.scrollTo(0, 0);
  });
  window.addEventListener('popstate', show);
  window.showUbuScreen = show;
  show();
  document.documentElement.classList.remove('booting');
})();
