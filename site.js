'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let config = { ready: false }, session = null, current = null, next = null, busy = false;
  const keys = new Map();
  const status = text => { $('status').textContent = text; };
  async function trustedKey(mint, id) {
    if (!config.ready || mint !== config.mint || !Object.hasOwn(config.keys, id)) return null;
    if (!keys.has(id)) keys.set(id, crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: config.keys[id], ext: true }, 'Ed25519', false, ['verify']));
    return keys.get(id);
  }
  async function inspect(text) { return ubuFile.read(text, { resolveKey: trustedKey }); }
  function display(text, result) {
    const model = ubu.decode(ubu.fromCode(result.dna));
    current = { text, name: model.parts.fullName };
    $('preview').replaceChildren(ubuRender(model));
    $('ubunym').textContent = model.parts.fullName;
    $('details').textContent = `Ubuquity ${model.grade}` + (result.certificate ? ` · #${result.certificate.serial}` : '');
    $('authenticity').textContent = result.type === 'signed' ? 'Mint signature verified · this file proves issuance, not ownership.' : 'Custom ubu · unsigned';
    $('download').hidden = false;
  }
  async function api(path, options) {
    const response = await fetch(path, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The mint could not complete this request.');
    return data;
  }
  const post = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ubu-CSRF': session.csrf }, body: JSON.stringify(data) });
  async function collection(reset = false) {
    const data = await api('/api/ubus' + (!reset && next ? '?after=' + encodeURIComponent(next) : ''));
    const cards = [];
    for (const entry of data.ubus) {
      if (!entry.certificate) {
        const pending = document.createElement('p'); pending.textContent = `#${entry.serial} · Certificate pending`; cards.push(pending); continue;
      }
      const result = await inspect(entry.certificate);
      const model = ubu.decode(ubu.fromCode(result.dna));
      const card = document.createElement('button'); card.className = 'card';
      const name = document.createElement('span'); name.textContent = model.parts.fullName;
      const serial = document.createElement('span'); serial.textContent = '#' + entry.serial;
      card.append(ubuRender(model, 'ubu-thumb'), name, serial);
      card.addEventListener('click', () => { display(entry.certificate, result); status(''); });
      cards.push(card);
    }
    if (reset) $('ubus').replaceChildren(...cards); else $('ubus').append(...cards);
    if (reset && !cards.length) { const empty = document.createElement('p'); empty.textContent = 'No minted ubus yet.'; $('ubus').append(empty); }
    next = data.next; $('more').hidden = !next; $('collection').hidden = false;
  }
  $('import').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > ubuFile.MAX_BYTES) throw new Error('A .ubu file must contain 1–1024 bytes.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await inspect(bytes);
      display(new TextDecoder().decode(bytes), result); status('');
    } catch (error) { status(error.message); }
    finally { event.target.value = ''; }
  });
  $('download').addEventListener('click', () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([current.text], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = current.name.replaceAll(' ', '-') + '.ubu';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('mint').addEventListener('click', async () => {
    if (busy || !session?.owner) return;
    busy = true; $('mint').disabled = true;
    try {
      const storageKey = `ubumint:pending:${config.mint}:${session.owner}`;
      let request = localStorage.getItem(storageKey);
      if (!request) { request = crypto.randomUUID(); localStorage.setItem(storageKey, request); }
      status('Getting your ubu…');
      const data = await api('/api/mint', post({ request }));
      const result = await inspect(data.certificate);
      display(data.certificate, result);
      localStorage.removeItem(storageKey);
      status('Your ubu is ready.');
      await collection(true);
    } catch (error) { status(error.message); }
    finally { busy = false; $('mint').disabled = false; }
  });
  $('logout').addEventListener('click', async () => {
    try { await api('/api/logout', post({})); location.reload(); } catch (error) { status(error.message); }
  });
  $('more').addEventListener('click', async () => {
    $('more').disabled = true;
    try { await collection(); } catch (error) { status(error.message); } finally { $('more').disabled = false; }
  });
  (async () => {
    try {
      config = await api('/api/config');
      $('login').hidden = !config.login;
      if (config.login) session = await api('/api/session');
      if (session?.owner) {
        $('login').hidden = true; $('logout').hidden = false;
        $('mint').disabled = !config.ready || !config.lifetimeLimit;
        status(config.ready && config.lifetimeLimit ? `Lifetime mint limit: ${config.lifetimeLimit} per account.` : 'Minting is not open yet. You can still view .ubu files.');
        if (config.ready) await collection(true);
      } else status(config.login ? 'Sign in with Discord to get an ubu and see your collection.' : 'Minting is not open yet. You can still view custom .ubu files.');
    } catch (error) { status(error.message); }
  })();
})();
