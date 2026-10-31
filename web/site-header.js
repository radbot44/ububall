'use strict';
(() => {
  const $ = id => document.getElementById(id);

  let currentSession = null;
  let authPopup = null;
  let authTimer = null;

  function openDiscordLogin(event) {
    if (event && event.preventDefault) event.preventDefault();
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
      window.location.href = authUrl;
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
      await checkSession();
    }
  });

  async function checkSession() {
    try {
      const res = await fetch('/api/session');
      if (!res.ok) throw new Error('Session check failed');
      const data = await res.json();
      currentSession = data?.owner ? data : null;
      updateHeaderUI();
      window.dispatchEvent(new CustomEvent('ubu:session', { detail: currentSession }));
      return currentSession;
    } catch {
      currentSession = null;
      updateHeaderUI();
      window.dispatchEvent(new CustomEvent('ubu:session', { detail: null }));
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
    await checkSession();
    if (location.pathname === '/mint' || location.pathname === '/collection') {
      location.reload();
    }
  }

  function initHeader() {
    const loginBtn = $('login') || $('site-login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', openDiscordLogin);
    }

    const onlineLogin = $('online-login');
    if (onlineLogin) {
      onlineLogin.addEventListener('click', openDiscordLogin);
    }

    const identityBtn = $('identity');
    const accountDialog = $('account-dialog');
    const accountClose = $('account-close');
    const logoutBtn = $('logout') || $('account-logout');

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHeader);
  } else {
    initHeader();
  }
})();
