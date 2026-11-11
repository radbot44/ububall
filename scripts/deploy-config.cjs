// Production settings live outside the checkout. Never print their contents.
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const { randomBytes, generateKeyPairSync, createPrivateKey, createPublicKey } = require('node:crypto');
const [action, home] = process.argv.slice(2);
const settingsPath = path.join(home, 'settings.json');
function parseJsonc(text) {
  const withoutComments = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, match => match.startsWith('"') ? match : '');
  const withoutTrailingCommas = withoutComments.replace(/"(?:\\.|[^"\\])*"|,\s*([}\]])/g, (match, closer) => closer || match);
  return JSON.parse(withoutTrailingCommas);
}
function parseEnvFallback(text) {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let [, key, value] = match;
    if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    env[key] = value;
  }
  return env;
}
const parseEnv = typeof util.parseEnv === 'function' ? util.parseEnv : parseEnvFallback;
const read = p => {
  const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  return p.endsWith('.jsonc') ? parseJsonc(text) : JSON.parse(text);
};
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const secretNames = ['DISCORD_CLIENT_SECRET', 'SESSION_SECRET', 'MINT_PRIVATE_KEYS'];
const activityToken = 'DISCORD_ACTIVITY_BOT_TOKEN';
function freshIdentity(s) {
  const jwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  Object.assign(s.vars, { MINT_ID: randomBytes(16).toString('base64url'), MINT_KEY_ID: 'mint-1', MINT_PUBLIC_KEYS: JSON.stringify({ 'mint-1': jwk.x }) });
  Object.assign(s.secrets, { SESSION_SECRET: randomBytes(32).toString('base64url'), MINT_PRIVATE_KEYS: JSON.stringify({ 'mint-1': jwk }) });
  return s;
}
function validate(s) {
  const v = s.vars;
  if (!s.name || !v || !s.secrets) throw Error('Incomplete production settings.');
  const origin = new URL(v.ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== v.ORIGIN) throw Error('ORIGIN must be an exact HTTPS origin without a trailing slash.');
  if (!/^[1-9][0-9]{0,19}$/.test(String(v.DISCORD_CLIENT_ID || ''))) throw Error('A Discord application ID is required.');
  for (const name of secretNames) if (!s.secrets[name] || s.secrets[name].includes('<')) throw Error(`Missing saved secret: ${name}`);
  if (Object.hasOwn(v, activityToken)) throw Error(`Store ${activityToken} under secrets.`);
  const token = s.secrets[activityToken];
  if (Object.hasOwn(s.secrets, activityToken) && (typeof token !== 'string' || !token || token.includes('<'))) {
    throw Error(`Invalid saved secret: ${activityToken}`);
  }
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(s.secrets.SESSION_SECRET)) throw Error('Invalid session secret.');
  if (!/^[A-Za-z0-9_-]{21}[AQgw]$/.test(v.MINT_ID)) throw Error('Invalid permanent mint ID.');
  for (const name of ['BATCH_SIZE', 'LIFETIME_MINT_LIMIT']) {
    if (!/^\d+$/.test(String(v[name])) || !Number.isSafeInteger(Number(v[name]))) throw Error(`Invalid ${name}.`);
  }
  const batchSize = Number(v.BATCH_SIZE);
  if (batchSize < 5 || batchSize > 1000000 || batchSize % 5 !== 0) throw Error('BATCH_SIZE must be a multiple of 5 between 5 and 1000000.');
  const privateKeys = JSON.parse(s.secrets.MINT_PRIVATE_KEYS), publicKeys = JSON.parse(v.MINT_PUBLIC_KEYS);
  if (!publicKeys || typeof publicKeys !== 'object' || Array.isArray(publicKeys) ||
      Object.keys(publicKeys).length < 1 || Object.keys(publicKeys).length > 16 ||
      !/^[A-Za-z0-9_-]{1,32}$/.test(v.MINT_KEY_ID || '') || !Object.hasOwn(publicKeys, v.MINT_KEY_ID) ||
      Object.entries(publicKeys).some(([id, x]) => !/^[A-Za-z0-9_-]{1,32}$/.test(id) || typeof x !== 'string' || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(x))) {
    throw Error('Invalid public signing keys.');
  }
  if (!privateKeys || typeof privateKeys !== 'object' || Array.isArray(privateKeys) || !Object.hasOwn(privateKeys, v.MINT_KEY_ID)) {
    throw Error('Active private key is missing.');
  }
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
    for (const name of [...secretNames, activityToken]) {
      if (s.vars[name]) s.secrets[name] = s.vars[name];
      delete s.vars[name];
    }
    validate(s);
    write(settingsPath, s);
    console.log('Recovered production settings and existing keys outside the checkout.');
  } else if (action === 'setup') {
    if (fs.existsSync(settingsPath)) throw Error('Settings already exist; refusing to replace the mint identity.');
    const input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    const s = freshIdentity({ name: input.name, workers_dev: true, preview_urls: false,
      vars: { ORIGIN: input.origin, DISCORD_CLIENT_ID: input.clientId, BATCH_SIZE: '1000', LIFETIME_MINT_LIMIT: '0' },
      secrets: { DISCORD_CLIENT_SECRET: input.clientSecret } });
    const hostname = new URL(input.origin).hostname;
    if (!hostname.endsWith('.workers.dev')) {
      s.workers_dev = false;
      s.routes = [{ pattern: hostname, custom_domain: true }];
    }
    validate(s);
    write(settingsPath, s);
    console.log('Created a NEW mint identity. Issuance remains closed (limit 0).');
  } else if (action === 'reset') {
    const previous = read(settingsPath);
    validate(previous);
    const s = freshIdentity(structuredClone(previous));
    validate(s);
    const backup = path.join(home, 'backups', `reset-${Date.now()}-${randomBytes(4).toString('hex')}`);
    fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
    fs.copyFileSync(settingsPath, path.join(backup, 'settings.json'), fs.constants.COPYFILE_EXCL);
    const pending = path.join(backup, 'new-settings.json');
    write(pending, s);
    fs.renameSync(pending, settingsPath);
    console.log(`Fresh mint identity saved. Previous settings: ${backup}`);
    console.log('After deployment: fresh registry, serials restart at 1, old sessions expire. Previous Cloudflare registry is retained, not erased.');
  }
  if (!['recover', 'setup', 'reset', 'build', 'build-reset'].includes(action)) throw Error('Unknown action.');
  const s = read(settingsPath);
  validate(s);
  if (action === 'build' || action === 'build-reset') {
    const base = read('wrangler.jsonc');
    // Do not send development defaults: even keep_vars overwrites explicitly supplied vars.
    delete base.vars;
    const { secrets, ...production } = s;
    const config = { ...base, ...production, keep_vars: true };
    const generated = 'wrangler.deploy.jsonc';
    fs.writeFileSync(generated, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    const secretsPath = path.join(home, 'deploy-secrets.json');
    // Reset only replaces these two secrets. Leave existing remote Discord and
    // unrelated secrets intact, even if they were changed in the dashboard.
    const payload = action === 'build-reset'
      ? { SESSION_SECRET: secrets.SESSION_SECRET, MINT_PRIVATE_KEYS: secrets.MINT_PRIVATE_KEYS }
      : secrets;
    fs.writeFileSync(secretsPath, JSON.stringify(payload), { mode: 0o600 });
    console.log('Production config validated; dashboard variables will be retained.');
  }
} catch (error) {
  // JSON/crypto parser errors can include input. Report only our own validation messages.
  console.error(error instanceof SyntaxError ? 'Invalid configuration JSON; inspect the saved settings privately.' : error.code ? `Configuration failed (${error.code}).` : error.message);
  process.exitCode = 1;
}
