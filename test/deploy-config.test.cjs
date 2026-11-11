const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const helper = path.resolve(__dirname, '../scripts/deploy-config.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ubumint-deploy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'private');
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(root, 'wrangler.jsonc'), JSON.stringify({ main: 'worker.mjs', vars: { LIFETIME_MINT_LIMIT: '0', BATCH_SIZE: '1000' } }));
  const run = (action, input) => spawnSync(process.execPath, [helper, action, home], { cwd: root, input: JSON.stringify(input), encoding: 'utf8' });
  const read = file => JSON.parse(fs.readFileSync(path.join(home, file), 'utf8'));
  const setup = () => {
    const result = run('setup', { name: 'fixture', origin: 'https://mint.example', clientId: '123', clientSecret: 'ephemeral-test-secret' });
    assert.equal(result.status, 0, result.stderr);
    return read('settings.json');
  };
  return { root, home, run, read, setup };
}

test('setup never replaces saved identity; deploy keeps dashboard vars, parses JSONC comments, and separates secrets', t => {
  const f = fixture(t), settings = f.setup();
  assert.equal(settings.vars.LIFETIME_MINT_LIMIT, '0');
  assert.deepEqual(settings.routes, [{ pattern: 'mint.example', custom_domain: true }]);
  assert.equal(settings.workers_dev, false);
  const original = fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8');
  assert.notEqual(f.run('setup', {}).status, 0);
  assert.equal(f.run('recover').status, 0);
  assert.equal(fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8'), original);
  // Allow valid JSONC comments and trailing commas in wrangler.jsonc without mangling URL strings.
  fs.writeFileSync(path.join(f.root, 'wrangler.jsonc'), `{
    // Development template comment with https://url-inside-comment.example
    "main": "worker.mjs", /* block comment */
    "vars": { "LIFETIME_MINT_LIMIT": "0", "BATCH_SIZE": "1000", },
  }\n`);
  assert.equal(f.run('build').status, 0);
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'wrangler.deploy.jsonc'), 'utf8'));
  assert.equal(config.keep_vars, true);
  assert.equal(config.vars.ORIGIN, 'https://mint.example');
  assert.equal(config.vars.MINT_ID, settings.vars.MINT_ID);
  for (const name of Object.keys(settings.secrets)) assert.equal(config.vars[name], undefined);
  assert.equal(config.secrets, undefined);
  assert.deepEqual(f.read('deploy-secrets.json'), settings.secrets);
});

test('recovery preserves production origin, allowance and keys; fills missing public keys from dev vars', t => {
  const f = fixture(t), saved = f.setup();
  fs.unlinkSync(path.join(f.home, 'settings.json'));
  const { MINT_PUBLIC_KEYS, ...vars } = saved.vars;
  vars.LIFETIME_MINT_LIMIT = '1000';
  fs.writeFileSync(path.join(f.root, 'wrangler.local.jsonc'), `{\n  // Legacy production config\n  "name": ${JSON.stringify(saved.name)},\n  "routes": [{ "pattern": "mint.example", "custom_domain": true, }],\n  "vars": ${JSON.stringify(vars)},\n}`);
  fs.writeFileSync(path.join(f.root, '.dev.vars'), Object.entries({ ...saved.vars, ...saved.secrets, ORIGIN: 'http://127.0.0.1:8790' }).map(([k, v]) => `${k}='${v}'`).join('\n'));
  assert.equal(f.run('recover').status, 0);
  const recovered = f.read('settings.json');
  assert.equal(recovered.vars.ORIGIN, saved.vars.ORIGIN);
  assert.equal(recovered.vars.LIFETIME_MINT_LIMIT, '1000');
  assert.equal(recovered.vars.MINT_PUBLIC_KEYS, MINT_PUBLIC_KEYS);
  assert.deepEqual(recovered.secrets, saved.secrets);
  assert.equal(recovered.vars.MINT_PRIVATE_KEYS, undefined);
  assert.deepEqual(recovered.routes, [{ pattern: 'mint.example', custom_domain: true }]);
});

test('missing settings, non-canonical secrets, invalid BATCH_SIZE, or mismatched signing keys stop deployment', t => {
  const f = fixture(t);
  assert.notEqual(f.run('recover').status, 0);
  assert.equal(fs.existsSync(path.join(f.home, 'settings.json')), false);
  const base = f.setup();
  const invalidCases = [
    s => { s.vars.MINT_PUBLIC_KEYS = JSON.stringify({ 'mint-1': 'wrong' }); },
    s => { s.vars.MINT_PUBLIC_KEYS = JSON.stringify({ ...JSON.parse(s.vars.MINT_PUBLIC_KEYS), 'retired-bad': 'not-base64url' }); },
    s => { s.vars.BATCH_SIZE = '12'; },
    s => { s.vars.BATCH_SIZE = '3'; },
    s => { s.vars.BATCH_SIZE = '1000005'; },
    s => { s.vars.MINT_ID = 'A'.repeat(21) + 'B'; },
    s => { s.secrets.SESSION_SECRET = 'A'.repeat(42) + 'B'; },
    s => { s.vars.DISCORD_CLIENT_ID = '0123'; }
  ];
  for (const mutate of invalidCases) {
    const broken = structuredClone(base);
    mutate(broken);
    fs.writeFileSync(path.join(f.home, 'settings.json'), JSON.stringify(broken));
    const result = f.run('build');
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(f.root, 'wrangler.deploy.jsonc')), false);
    assert.ok(!result.stderr.includes(broken.secrets.SESSION_SECRET));
  }
});

test('explicit reset backs up settings and changes only identity, signing keys and session secret', t => {
  const f = fixture(t), before = f.setup();
  before.account_id = 'test-account';
  before.vars.BATCH_SIZE = '500';
  before.vars.LIFETIME_MINT_LIMIT = '10000000';
  before.secrets.OTHER_SECRET = 'retain-me';
  const original = JSON.stringify(before);
  fs.writeFileSync(path.join(f.home, 'settings.json'), original);
  const result = f.run('reset');
  assert.equal(result.status, 0, result.stderr);
  const after = f.read('settings.json');
  for (const field of ['MINT_ID', 'MINT_PUBLIC_KEYS']) assert.notEqual(after.vars[field], before.vars[field]);
  for (const field of ['SESSION_SECRET', 'MINT_PRIVATE_KEYS']) assert.notEqual(after.secrets[field], before.secrets[field]);
  const expected = structuredClone(before);
  for (const field of ['MINT_ID', 'MINT_KEY_ID', 'MINT_PUBLIC_KEYS']) expected.vars[field] = after.vars[field];
  for (const field of ['SESSION_SECRET', 'MINT_PRIVATE_KEYS']) expected.secrets[field] = after.secrets[field];
  assert.deepEqual(after, expected);
  const backups = fs.readdirSync(path.join(f.home, 'backups'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(f.home, 'backups', backups[0], 'settings.json'), 'utf8'), original);
  assert.equal(f.run('build').status, 0); // Includes cryptographic public/private match validation.
  assert.equal(f.run('build-reset').status, 0);
  assert.deepEqual(f.read('deploy-secrets.json'), { SESSION_SECRET: after.secrets.SESSION_SECRET, MINT_PRIVATE_KEYS: after.secrets.MINT_PRIVATE_KEYS });
  assert.ok(!result.stdout.includes(after.secrets.SESSION_SECRET));
  assert.ok(!result.stdout.includes(before.secrets.DISCORD_CLIENT_SECRET));
  const saved = fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8');
  assert.equal(f.run('recover').status, 0);
  assert.equal(f.run('build').status, 0);
  assert.equal(fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8'), saved);
});

test('reset stops before replacing settings if backup cannot be created', t => {
  const f = fixture(t);
  assert.notEqual(f.run('reset').status, 0);
  assert.equal(fs.existsSync(path.join(f.home, 'settings.json')), false);
  f.setup();
  const original = fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8');
  fs.writeFileSync(path.join(f.home, 'backups'), 'block backup directory');
  assert.notEqual(f.run('reset').status, 0);
  assert.equal(fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8'), original);
});
