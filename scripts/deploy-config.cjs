// Production settings live outside the checkout. Never print their contents.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { randomBytes, generateKeyPairSync, createPrivateKey, createPublicKey } = require('node:crypto');
const [action, home] = process.argv.slice(2);
const settingsPath = path.join(home, 'settings.json');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const secretNames = ['DISCORD_CLIENT_SECRET', 'SESSION_SECRET', 'MINT_PRIVATE_KEYS'];
function validate(s) {
  const v = s.vars;
  if (!s.name || !v || !s.secrets) throw Error('Incomplete production settings.');
  const origin = new URL(v.ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== v.ORIGIN) throw Error('ORIGIN must be an exact HTTPS origin without a trailing slash.');
  if (!/^\d+$/.test(v.DISCORD_CLIENT_ID)) throw Error('A Discord application ID is required.');
  for (const name of secretNames) if (!s.secrets[name] || s.secrets[name].includes('<')) throw Error(`Missing saved secret: ${name}`);
  if (!/^[A-Za-z0-9_-]{43}$/.test(s.secrets.SESSION_SECRET)) throw Error('Invalid session secret.');
  if (!/^[A-Za-z0-9_-]{22}$/.test(v.MINT_ID)) throw Error('Invalid permanent mint ID.');
  for (const name of ['BATCH_SIZE', 'LIFETIME_MINT_LIMIT']) if (!/^\d+$/.test(String(v[name]))) throw Error(`Invalid ${name}.`);
  if (Number(v.BATCH_SIZE) < 1) throw Error('BATCH_SIZE must be positive.');
  const privateKeys = JSON.parse(s.secrets.MINT_PRIVATE_KEYS), publicKeys = JSON.parse(v.MINT_PUBLIC_KEYS);
  if (!privateKeys[v.MINT_KEY_ID]) throw Error('Active private key is missing.');
  for (const [id, jwk] of Object.entries(privateKeys)) {
    const key = createPrivateKey({ key: jwk, format: 'jwk' });
    if (key.asymmetricKeyType !== 'ed25519' || createPublicKey(key).export({ format: 'jwk' }).x !== publicKeys[id]) throw Error('Saved signing keys do not match public keys.');
  }
}
try {
  if (action === 'recover' && !fs.existsSync(settingsPath)) {
    const legacy = ['wrangler.local.jsonc', 'wrangler.deploy.jsonc'].find(p => fs.existsSync(p));
    if (!legacy) throw Error('No saved production settings found. For a NEW mint only, run deploy.ps1 -Setup. Existing mints must restore settings.json from backup.');
    const local = read(legacy);
    const env = fs.existsSync('.dev.vars') ? parseEnv(fs.readFileSync('.dev.vars', 'utf8')) : {};
    const s = {};
    for (const name of ['name', 'account_id', 'routes', 'workers_dev', 'preview_urls']) if (local[name] !== undefined) s[name] = local[name];
    s.vars = { ...env, ...local.vars };
    s.secrets = {};
    for (const name of secretNames) {
      if (s.vars[name]) s.secrets[name] = s.vars[name];
      delete s.vars[name];
    }
    validate(s);
    write(settingsPath, s);
    console.log('Recovered production settings and existing keys outside the checkout.');
  } else if (action === 'setup') {
    if (fs.existsSync(settingsPath)) throw Error('Settings already exist; refusing to replace the mint identity.');
    const input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
    const s = { name: input.name, workers_dev: true, preview_urls: false,
      vars: { ORIGIN: input.origin, DISCORD_CLIENT_ID: input.clientId, MINT_ID: randomBytes(16).toString('base64url'), MINT_KEY_ID: 'mint-1', MINT_PUBLIC_KEYS: JSON.stringify({ 'mint-1': jwk.x }), BATCH_SIZE: '1000', LIFETIME_MINT_LIMIT: '0' },
      secrets: { DISCORD_CLIENT_SECRET: input.clientSecret, SESSION_SECRET: randomBytes(32).toString('base64url'), MINT_PRIVATE_KEYS: JSON.stringify({ 'mint-1': jwk }) } };
    const hostname = new URL(input.origin).hostname;
    if (!hostname.endsWith('.workers.dev')) {
      s.workers_dev = false;
      s.routes = [{ pattern: hostname, custom_domain: true }];
    }
    validate(s);
    write(settingsPath, s);
    console.log('Created a NEW mint identity. Issuance remains closed (limit 0).');
  }
  if (!['recover', 'setup', 'build'].includes(action)) throw Error('Unknown action.');
  const s = read(settingsPath);
  validate(s);
  if (action === 'build') {
    const base = read('wrangler.jsonc');
    // Do not send development defaults: even keep_vars overwrites explicitly supplied vars.
    delete base.vars;
    const { secrets, ...production } = s;
    const config = { ...base, ...production, keep_vars: true };
    const generated = 'wrangler.deploy.jsonc';
    fs.writeFileSync(generated, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    const secretsPath = path.join(home, 'deploy-secrets.json');
    fs.writeFileSync(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
    console.log('Production config validated; dashboard variables will be retained.');
  }
} catch (error) {
  // JSON/crypto parser errors can include input. Report only our own validation messages.
  console.error(error instanceof SyntaxError ? 'Invalid configuration JSON; inspect the saved settings privately.' : error.code ? `Configuration failed (${error.code}).` : error.message);
  process.exitCode = 1;
}
