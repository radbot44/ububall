'use strict';
(() => {
  const $ = id => document.getElementById(id);

  let currentSession = null;
  let authPopup = null;
  let authTimer = null;
  const authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ubu:auth') : null;
  if (authChannel) {
    authChannel.onmessage = async event => {
      if (event.data?.type === 'session-changed') {
        await checkSession(false);
      }
    };
  }

  function openDiscordLogin(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (window.ubuActivity) {
      return window.ubuActivity.signIn().catch(error => {
        const status = $('online-status');
        if (status && $('online-dialog')?.open) status.textContent = error.message;
        else void gameUi.confirm({ title: 'Discord sign-in', message: error.message, confirmLabel: 'OK' });
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
      authPopup.focus();
      return;
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

    if (!authPopup || authPopup.closed || typeof authPopup.closed === 'undefined') {
      redirect();
      return;
    }

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
    if (event.data?.type === 'ubu-auth-complete') {
      if (authTimer) {
        clearInterval(authTimer);
        authTimer = null;
      }
      if (authPopup && !authPopup.closed) {
        try { authPopup.close(); } catch {}
      }
      await checkSession(true);
      authChannel?.postMessage({ type: 'session-changed' });
    }
  });

  async function checkSession(broadcast = true) {
    try {
      const res = await fetch('/api/session', { signal: window.ubuActivity?.signal });
      if (!res.ok) throw new Error('Session check failed');
      const data = await res.json();
      const prevOwner = currentSession?.owner;
      const prevName = currentSession?.name;
      currentSession = data?.owner ? data : null;
      updateHeaderUI();
      window.dispatchEvent(new CustomEvent('ubu:session', { detail: currentSession }));
      if (broadcast && (prevOwner !== currentSession?.owner || prevName !== currentSession?.name)) {
        authChannel?.postMessage({ type: 'session-changed' });
      }
      return currentSession;
    } catch {
      const prevOwner = currentSession?.owner;
      currentSession = null;
      updateHeaderUI();
      window.dispatchEvent(new CustomEvent('ubu:session', { detail: null }));
      if (broadcast && prevOwner) {
        authChannel?.postMessage({ type: 'session-changed' });
      }
      return null;
    }
  }

  window.checkUbuSession = checkSession;
  window.getUbuSession = () => currentSession;

  function updateHeaderUI() {
    const loginBtn = $('login') || $('site-login-btn');
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
        loginBtn.hidden = false;
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
    if (!currentSession) return;
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
    const accountDialog = $('account-dialog');
    if (accountDialog && accountDialog.open) {
      accountDialog.close();
    }
    await checkSession(true);
    authChannel?.postMessage({ type: 'session-changed' });
    if (location.pathname === '/mint' || location.pathname === '/collection') {
      location.reload();
    }
  }

  function initHeader() {
    const loginBtn = $('login') || $('site-login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', openDiscordLogin);
    }

    for (const id of ['online-login', 'lobby-login']) {
      $(id)?.addEventListener('click', openDiscordLogin);
    }

    const identityBtn = $('identity');
    const accountDialog = $('account-dialog');
    const accountClose = $('account-close');
    const logoutBtn = $('logout') || $('account-logout');
    const refreshBtn = $('account-refresh');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        if (!currentSession?.owner || currentSession.guest) return;
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

    checkSession();

    let lastVisible = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastVisible;
        lastVisible = Date.now();
        if (elapsed > 120000) {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeader);
  } else {
    initHeader();
  }
})();
