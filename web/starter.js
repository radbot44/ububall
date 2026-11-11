'use strict';
// Starter packs: what this account may open, the daily notification and its countdown.
(() => {
  const $ = id => document.getElementById(id);
  const currentOwner = () => window.getUbuSession?.()?.owner || null;
  const signedIn = () => Boolean(currentOwner());
  let status = null, known = false, deadline = 0, signup = null;
  let refreshRun = 0, inFlight = null, inFlightOwner;

  async function request(init) {
    const response = await fetch('/api/starter', init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The mint is unavailable. Try again.');
    return data;
  }
  function tick() {
    const left = Math.ceil((deadline - Date.now()) / 1000);
    if (status && left <= 0) {
      if (!inFlight) void refresh().catch(() => {});
      return;
    }
    const dailyNext = $('daily-next');
    if (!dailyNext) return;
    dailyNext.hidden = !status || status.daily;
    if (!status || status.daily) return;
    const part = value => String(value).padStart(2, '0');
    dailyNext.textContent = `Next daily pack in ${part(Math.floor(left / 3600))}:${part(Math.floor(left / 60) % 60)}:${part(left % 60)}`;
  }
  function publish() {
    const ready = Boolean(status?.daily);
    for (const link of document.querySelectorAll('.site-nav a[href="/mint"], .mint-entry-cta')) {
      link.classList.toggle('has-notice', ready);
      if (ready) link.setAttribute('aria-description', 'Daily pack ready');
      else link.removeAttribute('aria-description');
    }
    const cta = $('mint-cta-label');
    if (cta) cta.textContent = ready ? 'Open daily pack' : 'Open packs';
    tick();
    window.dispatchEvent(new Event('ubu:starter'));
  }
  function refresh() {
    const owner = currentOwner();
    if (inFlight && inFlightOwner === owner) return inFlight;
    const run = ++refreshRun;
    inFlightOwner = owner;
    const task = (async () => {
      try {
        const next = owner ? await request() : null;
        if (run !== refreshRun || currentOwner() !== owner) return;
        status = next;
        deadline = next ? Date.now() + Math.max(1, next.seconds || 1) * 1000 : 0;
      } catch (error) {
        if (run === refreshRun) { status = null; deadline = 0; }
        throw error;
      } finally {
        if (run === refreshRun) {
          inFlight = null;
          known = true;
          publish();
        }
      }
    })();
    inFlight = task;
    return task;
  }
  // Opening does not publish: the caller shows the pack first, then refreshes.
  async function claim(kind) {
    const csrf = window.getUbuSession?.()?.csrf;
    if (!csrf) throw new Error('Sign in with Discord first.');
    const data = await request({ method: 'POST', body: JSON.stringify({ kind }),
      headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': csrf } });
    if (status) status = { ...status, [kind]: false };
    return data;
  }
  // Starting a match with the signup pack unopened opens it in the background.
  async function ensureSignup() {
    if (!signedIn()) return;
    if (!status) await refresh();
    if (!status?.signup) return;
    signup ||= claim('signup').then(() => ubuList.load({ refresh: true })).finally(() => { signup = null; });
    await signup;
    publish();
  }

  window.ubuStarter = { get status() { return status; }, get known() { return known; }, refresh, claim, ensureSignup };
  window.addEventListener('ubu:session', () => { void refresh().catch(() => {}); });
  if (signedIn()) void refresh().catch(() => {});
  setInterval(tick, 1000);
})();
