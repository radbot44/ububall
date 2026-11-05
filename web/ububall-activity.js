'use strict';
(() => {
  const appId = /^([1-9][0-9]{0,19})\.discordsays\.com$/.exec(location.hostname)?.[1];
  if (!appId || window.parent === window) return;
  const instance = new URLSearchParams(location.search).get('instance_id');
  document.documentElement.classList.add('discord-activity');

  let sdk, login, closed = false, participants = null;
  const lifetime = new AbortController();
  function updateParticipants(data) {
    if (closed) return;
    participants = new Set(data.participants.map(user => user.id));
    window.dispatchEvent(new CustomEvent('ubu:activity-participants', { detail: [...participants] }));
  }
  function dispose() {
    if (closed) return;
    closed = true;
    window.dispatchEvent(new Event('ubu:activity-leave'));
    lifetime.abort();
    if (sdk) {
      void sdk.unsubscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', updateParticipants).catch(() => {});
      sdk.close(1000, 'Activity closed');
    }
  }
  window.addEventListener('pagehide', dispose, { once: true });
  async function connect() {
    if (!sdk) {
      const { DiscordSDK } = await import('/discord-sdk.js');
      if (closed) throw new DOMException('Activity closed.', 'AbortError');
      sdk = new DiscordSDK(appId, { disableConsoleLogOverride: true });
    }
    let timeout, canceled;
    try {
      await Promise.race([sdk.ready(), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Discord did not connect. Reopen the Activity to try again.')), 10000);
        canceled = () => reject(new DOMException('Activity closed.', 'AbortError'));
        lifetime.signal.addEventListener('abort', canceled, { once: true });
      })]);
    } finally { clearTimeout(timeout); lifetime.signal.removeEventListener('abort', canceled); }
    if (closed) throw new DOMException('Activity closed.', 'AbortError');
    const { code } = await sdk.commands.authorize({ client_id: appId, response_type: 'code',
      state: crypto.randomUUID(), prompt: 'none', scope: ['identify'] });
    if (closed) throw new DOMException('Activity closed.', 'AbortError');
    const response = await fetch('/auth/activity', { method: 'POST', signal: lifetime.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, instance: sdk.instanceId }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Discord sign-in failed.');
    await sdk.commands.authenticate({ access_token: result.access_token });
    if (closed) throw new DOMException('Activity closed.', 'AbortError');
    await sdk.subscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', updateParticipants);
    if (closed) throw new DOMException('Activity closed.', 'AbortError');
    const before = participants;
    const initial = await sdk.commands.getActivityInstanceConnectedParticipants();
    if (participants === before) updateParticipants(initial);
    if (closed) throw new DOMException('Activity closed.', 'AbortError');
    const session = await window.checkUbuSession();
    if (!session?.owner || session.instance !== sdk.instanceId) throw new Error('The Discord Activity session could not be saved.');
    return session;
  }

  window.ubuActivity = {
    instance,
    get signal() { return lifetime.signal; },
    get participants() { return participants; },
    dispose,
    signIn() {
      if (closed) return Promise.reject(new DOMException('Activity closed.', 'AbortError'));
      login ||= connect().catch(error => {
        login = null;
        if (!closed && sdk) void sdk.unsubscribe('ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE', updateParticipants).catch(() => {});
        throw error;
      });
      return login;
    },
    async invite() {
      if (!sdk?.isReady) await this.signIn();
      if (!sdk?.guildId) throw new Error('Use Discord’s Join button in this chat to bring a friend into the Activity.');
      return sdk.commands.openInviteDialog();
    }
  };
})();
