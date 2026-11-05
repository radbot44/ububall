'use strict';
// Starter packs: what this account may open, the daily notification and its countdown.
(() => {
  const $ = id => document.getElementById(id);
  const signedIn = () => Boolean(window.getUbuSession?.()?.owner);
  let status = null, known = false, deadline = 0, signup = null;

  async function request(init) {
    const response = await fetch('/api/starter', init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'The mint is unavailable. Try again.');
    return data;
  }
  function tick() {
    const left = Math.ceil((deadline - Date.now()) / 1000);
    if (status && left <= 0) { void refresh().catch(() => {}); return; }
    $('daily-next').hidden = !status || status.daily;
    if (!status || status.daily) return;
    const part = value => String(value).padStart(2, '0');
    $('daily-next').textContent = `Next daily pack in ${part(Math.floor(left / 3600))}:${part(Math.floor(left / 60) % 60)}:${part(left % 60)}`;
  }
  function publish() {
    const ready = Boolean(status?.daily);
    for (const link of document.querySelectorAll('.site-nav a[href="/mint"], .mint-entry-cta')) {
      link.classList.toggle('has-notice', ready);
      if (ready) link.setAttribute('aria-description', 'Daily pack ready');
      else link.removeAttribute('aria-description');
    }
    $('mint-cta-label').textContent = ready ? 'Open daily pack' : 'Open packs';
    tick();
    window.dispatchEvent(new Event('ubu:starter'));
  }
  async function refresh() {
    try {
      const next = signedIn() ? await request() : null;
      status = next; deadline = Date.now() + (next?.seconds || 0) * 1000;
    } catch (error) { status = null; throw error; }
    finally { known = true; publish(); }
  }
  // Opening does not publish: the caller shows the pack first, then refreshes.
  async function claim(kind) {
    const data = await request({ method: 'POST', body: JSON.stringify({ kind }),
      headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': window.getUbuSession().csrf } });
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
