'use strict';
(() => {
  const $ = id => document.getElementById(id);

  let currentSession = null;
  let loginConfigured = false;
  let sessionSeq = 0;
  let loggingOut = false;
  let authPopup = null;
  let authTimer = null;
  let authPendingUntil = 0;
  const authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ubu:auth') : null;

  async function completeAuthPopup(fromBroadcast = false) {
    authPendingUntil = 0;
    if (authTimer) {
      clearInterval(authTimer);
      authTimer = null;
    }
    if (authPopup && !authPopup.closed) {
      try { authPopup.close(); } catch {}
    }
    authPopup = null;
    await checkSession(!fromBroadcast);
  }

  if (authChannel) {
    authChannel.onmessage = async event => {
      if (event.data?.type === 'ubu-auth-complete') {
        await completeAuthPopup(true);
      } else if (event.data?.type === 'session-changed') {
        await checkSession(false);
      }
    };
  }

  window.addEventListener('storage', event => {
    if (event.key === 'ubu:auth-complete' && event.newValue) {
      void completeAuthPopup(true);
    }
  });

  function openDiscordLogin(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (window.ubuActivity) {
      return window.ubuActivity.signIn().catch(error => {
        const status = $('online-status');
        if (status && $('online-dialog')?.open) status.textContent = error.message;
        else if (window.gameUi?.confirm) void window.gameUi.confirm({ title: 'Discord sign-in', message: error.message, confirmLabel: 'OK', cancelLabel: null });
      });
    }
    const returnPath = (location.pathname === '/index.html' ? '/' : location.pathname) + location.search + location.hash;
    const redirect = () => {
      location.assign('/auth/discord?return=' + encodeURIComponent(returnPath));
    };
    if (document.fullscreenElement) {
      redirect();
      return;
    }
    if (authPopup && !authPopup.closed) {
      try { authPopup.focus(); return; } catch {}
    }
    const width = 520;
    const height = 750;
    const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - height) / 2));
    const returnDest = '/auth-complete.html';
    const authUrl = '/auth/discord?return=' + encodeURIComponent(returnDest);

    authPopup = window.open(
      authUrl,
      'ubu_discord_auth',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,status=no,resizable=yes`
    );

    if (!authPopup || typeof authPopup.closed === 'undefined') {
      redirect();
      return;
    }

    authPendingUntil = Date.now() + 600000;
    if (authTimer) clearInterval(authTimer);
    authTimer = setInterval(async () => {
      if (!authPopup || authPopup.closed) {
        clearInterval(authTimer);
        authTimer = null;
        await checkSession();
      }
    }, 600);
  }

  window.openDiscordLogin = openDiscordLogin;

  window.addEventListener('message', async event => {
    if (event.origin !== window.location.origin) return;
    if (authPopup && event.source && event.source !== authPopup) return;
    if (event.data?.type === 'ubu-auth-complete') {
      await completeAuthPopup(false);
    }
  });

  window.addEventListener('focus', () => {
    if (authPendingUntil > Date.now()) {
      void checkSession();
    }
  });

  async function checkSession(broadcast = true) {
    const seq = ++sessionSeq;
    try {
      const res = await fetch('/api/session', { signal: window.ubuActivity?.signal });
      if (seq !== sessionSeq) return currentSession;
      if (res.status === 503) {
        const err = await res.json().catch(() => ({}));
        if (err?.error?.includes('not configured')) {
          loginConfigured = false;
          updateHeaderUI();
        }
        return currentSession;
      }
      if (res.status === 401 || res.status === 403) {
        const prevOwner = currentSession?.owner || null;
        currentSession = null;
        updateHeaderUI();
        window.dispatchEvent(new CustomEvent('ubu:session', { detail: null }));
        if (broadcast && prevOwner) authChannel?.postMessage({ type: 'session-changed' });
        return null;
      }
      if (!res.ok) return currentSession;
      loginConfigured = true;
      const data = await res.json();
      if (seq !== sessionSeq) return currentSession;
      const prevOwner = currentSession?.owner || null;
      const prevName = currentSession?.name || null;
      currentSession = (data?.owner || data?.guest) ? data : null;
      const nextOwner = currentSession?.owner || null;
      const nextName = currentSession?.name || null;
      if (nextOwner) authPendingUntil = 0;
      updateHeaderUI();
      window.dispatchEvent(new CustomEvent('ubu:session', { detail: currentSession }));
      if (broadcast && (prevOwner !== nextOwner || prevName !== nextName)) {
        authChannel?.postMessage({ type: 'session-changed' });
      }
      return currentSession;
    } catch {
      if (seq === sessionSeq && currentSession === null) updateHeaderUI();
      return currentSession;
    }
  }

  window.checkUbuSession = checkSession;
  window.getUbuSession = () => currentSession;

  function updateHeaderUI() {
    const loginBtn = $('login');
    const identityBtn = $('identity');
    const accountDialog = $('account-dialog');
    const discordIdentity = $('discord-identity');

    if (currentSession?.owner) {
      if (loginBtn) loginBtn.hidden = true;
      if (identityBtn) {
        identityBtn.hidden = false;
        identityBtn.disabled = false;
        identityBtn.title = `Signed in with Discord as ${currentSession.name || 'your Discord account'}`;
        const nameSpan = identityBtn.querySelector('.identity-name');
        if (nameSpan) nameSpan.textContent = currentSession.name || 'Account';
      }
      if (discordIdentity) {
        discordIdentity.textContent = currentSession.name ? `Connected as ${currentSession.name}` : 'Connected';
      }
    } else {
      if (loginBtn) {
        loginBtn.hidden = !loginConfigured;
        loginBtn.disabled = false;
      }
      if (identityBtn) {
        identityBtn.hidden = true;
      }
      if (accountDialog && accountDialog.open) {
        accountDialog.close();
      }
    }
  }

  async function logout() {
    if (!currentSession || loggingOut) return;
    loggingOut = true;
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ubu-CSRF': currentSession.csrf || ''
        },
        body: JSON.stringify({})
      });
    } catch {}
    try {
      const accountDialog = $('account-dialog');
      if (accountDialog && accountDialog.open) {
        accountDialog.close();
      }
      await checkSession(true);
    } finally {
      loggingOut = false;
    }
  }

  function wireMoreMenu() {
    const moreBtn = document.querySelector('.nav-more');
    const moreMenu = $('more-menu');
    if (!moreBtn || !moreMenu || moreMenu.dataset.wired) return;
    moreMenu.dataset.wired = '1';
    if (window.gameUi?.dropdown) {
      window.gameUi.dropdown(moreBtn, moreMenu, { align: 'end' });
      return;
    }
    moreBtn.setAttribute('aria-haspopup', 'true');
    moreBtn.setAttribute('aria-expanded', 'false');
    const placeFallback = () => {
      moreMenu.style.inset = 'auto';
      moreMenu.style.left = '0px';
      moreMenu.style.top = '0px';
      const a = moreBtn.getBoundingClientRect();
      const gap = 6, margin = 8;
      const w = Math.min(moreMenu.offsetWidth, innerWidth - margin * 2);
      const h = moreMenu.offsetHeight;
      const left = Math.max(margin, Math.min(a.right - w, innerWidth - margin - w));
      let top = a.bottom + gap;
      if (top + h > innerHeight - margin && a.top - gap - h >= margin) top = a.top - gap - h;
      moreMenu.style.left = left + 'px';
      moreMenu.style.top = Math.max(margin, Math.min(top, innerHeight - margin - h)) + 'px';
    };
    moreMenu.addEventListener('toggle', event => {
      const open = event.newState === 'open';
      moreBtn.setAttribute('aria-expanded', String(open));
      if (open) placeFallback();
    });
    window.addEventListener('resize', () => {
      if (moreMenu.matches(':popover-open')) placeFallback();
    });
  }

  function initHeader() {
    wireMoreMenu();
    const loginBtn = $('login');
    if (loginBtn) {
      loginBtn.addEventListener('click', openDiscordLogin);
    }

    for (const id of ['online-login', 'lobby-login']) {
      $(id)?.addEventListener('click', openDiscordLogin);
    }

    const identityBtn = $('identity');
    const accountDialog = $('account-dialog');
    const accountClose = $('account-close');
    const logoutBtn = $('logout');
    const refreshBtn = $('account-refresh');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        if (!currentSession?.owner || currentSession.guest) return;
        const requestOwner = currentSession.owner;
        refreshBtn.disabled = true;
        const originalText = refreshBtn.textContent;
        refreshBtn.textContent = 'Refreshing…';
        try {
          const res = await fetch('/api/session/refresh', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Ubu-CSRF': currentSession.csrf || ''
            },
            body: JSON.stringify({})
          });
          if (res.ok) {
            const data = await res.json();
            if (currentSession?.owner !== requestOwner) return;
            currentSession = { ...currentSession, ...data };
            updateHeaderUI();
            window.dispatchEvent(new CustomEvent('ubu:session', { detail: currentSession }));
            authChannel?.postMessage({ type: 'session-changed' });
            refreshBtn.textContent = 'Refreshed';
            setTimeout(() => {
              refreshBtn.textContent = originalText;
              refreshBtn.disabled = false;
            }, 1200);
            return;
          }
        } catch {}
        refreshBtn.textContent = originalText;
        refreshBtn.disabled = false;
      });
    }

    if (identityBtn && accountDialog) {
      identityBtn.addEventListener('click', () => {
        if (!currentSession?.owner) return;
        if (!accountDialog.open) {
          accountDialog.showModal();
        }
      });
    }

    if (accountClose && accountDialog) {
      accountClose.addEventListener('click', () => {
        accountDialog.close();
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
    }

    if (accountDialog) {
      accountDialog.addEventListener('click', event => {
        if (event.target === accountDialog) {
          accountDialog.close();
        }
      });
    }

    void checkSession();

    let lastVisible = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastVisible;
        lastVisible = Date.now();
        if (elapsed > 120000 || authPendingUntil > Date.now()) {
          void checkSession(false);
        }
      } else {
        lastVisible = Date.now();
      }
    });
    window.addEventListener('online', () => {
      void checkSession(false);
    });
  }

  document.addEventListener('DOMContentLoaded', initHeader, { once: true });
  if (document.readyState === 'complete') {
    initHeader();
  }
})();
