'use strict';
(() => {
  const appId = /^([1-9][0-9]{0,19})\.discordsays\.com$/.exec(location.hostname)?.[1];
  if (!appId || window.parent === window) return;
  const instance = new URLSearchParams(location.search).get('instance_id');

  let sdk, login;
  async function connect() {
    if (!sdk) {
      const { DiscordSDK } = await import('/discord-sdk.js');
      sdk = new DiscordSDK(appId, { disableConsoleLogOverride: true });
    }
    let timeout;
    try {
      await Promise.race([sdk.ready(), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Discord did not connect. Reopen the Activity to try again.')), 10000);
      })]);
    } finally { clearTimeout(timeout); }
    const { code } = await sdk.commands.authorize({ client_id: appId, response_type: 'code',
      state: crypto.randomUUID(), prompt: 'none', scope: ['identify'] });
    const response = await fetch('/auth/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, instance: sdk.instanceId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Discord sign-in failed.');
    await sdk.commands.authenticate({ access_token: result.access_token });
    const session = await window.checkUbuSession();
    if (!session?.owner || session.instance !== sdk.instanceId) throw new Error('The Discord Activity session could not be saved.');
    return session;
  }

  window.ubuActivity = {
    instance,
    signIn() {
      login ||= connect().finally(() => { login = null; });
      return login;
    },
    async invite() {
      if (!sdk?.isReady) await this.signIn();
      if (!sdk?.guildId) throw new Error('Use Discord’s Join button in this chat to bring a friend into the Activity.');
      return sdk.commands.openInviteDialog();
    }
  };
})();
