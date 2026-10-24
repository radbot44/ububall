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

test('setup never replaces saved identity; deploy keeps dashboard vars and separates secrets', t => {
  const f = fixture(t), settings = f.setup();
  assert.equal(settings.vars.LIFETIME_MINT_LIMIT, '0');
  assert.deepEqual(settings.routes, [{ pattern: 'mint.example', custom_domain: true }]);
  assert.equal(settings.workers_dev, false);
  const original = fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8');
  assert.notEqual(f.run('setup', {}).status, 0);
  assert.equal(f.run('recover').status, 0);
  assert.equal(fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8'), original);
  assert.equal(f.run('build').status, 0);
  const config = JSON.parse(fs.readFileSync(path.join(f.root, 'wrangler.deploy.jsonc'), 'utf8'));
  assert.equal(config.keep_vars, true);
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
  fs.writeFileSync(path.join(f.root, 'wrangler.local.jsonc'), JSON.stringify({ name: saved.name, routes: [{ pattern: 'mint.example', custom_domain: true }], vars }));
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

test('missing settings or mismatched signing keys stop deployment without creating identity', t => {
  const f = fixture(t);
  assert.notEqual(f.run('recover').status, 0);
  assert.equal(fs.existsSync(path.join(f.home, 'settings.json')), false);
  const settings = f.setup();
  settings.vars.MINT_PUBLIC_KEYS = JSON.stringify({ 'mint-1': 'wrong' });
  fs.writeFileSync(path.join(f.home, 'settings.json'), JSON.stringify(settings));
  const result = f.run('build');
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'wrangler.deploy.jsonc')), false);
  assert.ok(!result.stderr.includes(settings.secrets.SESSION_SECRET));
});
