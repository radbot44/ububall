const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const installer = path.resolve(__dirname, '../install.ps1');
const updater = path.resolve(__dirname, '../update.ps1');
const deployer = path.resolve(__dirname, '../deploy.ps1');
const windows = { skip: process.platform !== 'win32' };
const stub = `param([string]$Destination,[switch]$DryRun,[switch]$InstallOnly,[switch]$Setup,[switch]$ResetMint,[string]$SettingsDirectory)
@{Destination=$Destination;DryRun=[bool]$DryRun;InstallOnly=[bool]$InstallOnly;Setup=[bool]$Setup;ResetMint=[bool]$ResetMint;SettingsDirectory=$SettingsDirectory} | ConvertTo-Json -Compress`;

function fixture(t, folder = 'ubumint-cloudflare', sourceFolder = 'ubumint') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ubumint-entry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installed = path.join(root, folder), source = path.join(root, sourceFolder), home = path.join(root, 'private');
  for (const dir of [installed, source, home]) fs.mkdirSync(dir);
  fs.copyFileSync(installer, path.join(installed, 'install.ps1'));
  fs.copyFileSync(updater, path.join(installed, 'update.ps1'));
  fs.writeFileSync(path.join(source, 'install.ps1'), stub);
  const run = (...args) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(installed, 'install.ps1'), '-SettingsDirectory', home, ...args], { encoding: 'utf8' });
  const runUpdate = (...args) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(installed, 'update.ps1'), '-SettingsDirectory', home, ...args], { encoding: 'utf8' });
  return { root, source, installed, home, run, runUpdate };
}

test('PowerShell deployment scripts guard wrangler.deploy.jsonc, dry-run backups, and node_modules locks', () => {
  const installSrc = fs.readFileSync(installer, 'utf8');
  const deploySrc = fs.readFileSync(deployer, 'utf8');
  const updateSrc = fs.readFileSync(updater, 'utf8');
  assert.match(installSrc, /wrangler\.deploy\.jsonc/);
  assert.match(installSrc, /\\node_modules\\'/);
  assert.match(deploySrc, /Test-Path 'wrangler\.deploy\.jsonc'/);
  assert.match(deploySrc, /if \(!\$DryRun\)\s*\{\s*\$backup =/);
  assert.match(deploySrc, /\\node_modules\\'/);
  assert.match(updateSrc, /if \(\$here -eq \$resolvedSource\)/);
});

test('installed entry uses sibling source for legacy installs and forwards check switches', windows, t => {
  const f = fixture(t), r = f.run('-DryRun', '-InstallOnly');
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.Destination, f.installed);
  assert.equal(result.SettingsDirectory, f.home);
  assert.equal(result.DryRun, true);
  assert.equal(result.InstallOnly, true);
  assert.equal(result.ResetMint, false);
  assert.deepEqual(fs.readdirSync(f.home), []);
});

test('installed entry uses sibling source when named ububall and forwards check switches', windows, t => {
  const f = fixture(t, 'ubumint-cloudflare', 'ububall');
  const r = f.run('-DryRun', '-InstallOnly');
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.Destination, f.installed);
  assert.equal(result.SettingsDirectory, f.home);
  assert.equal(result.DryRun, true);
  assert.equal(result.InstallOnly, true);
});

test('recorded source supports custom install folders and forwards explicit reset only when requested', windows, t => {
  const f = fixture(t, 'live copy');
  fs.writeFileSync(path.join(f.home, 'installation.json'), JSON.stringify({ source: f.source, destination: f.installed }));
  const r = f.run('-ResetMint');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ResetMint, true);
  const normal = f.run('-InstallOnly');
  assert.equal(normal.status, 0, normal.stderr);
  assert.equal(JSON.parse(normal.stdout).ResetMint, false);
});

test('recorded source pointing to ubumint falls back to sibling ububall if ubumint was renamed', windows, t => {
  const f = fixture(t, 'ubumint-cloudflare', 'ububall');
  // Record old source ubumint in manifest (which doesn't exist on disk)
  fs.writeFileSync(path.join(f.home, 'installation.json'), JSON.stringify({ source: path.join(f.root, 'ubumint'), destination: f.installed }));
  const r = f.run('-DryRun', '-InstallOnly');
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.Destination, f.installed);
  assert.equal(result.DryRun, true);
});

test('recorded source pointing to ububall is preferred over legacy sibling ubumint', windows, t => {
  const f = fixture(t, 'ubumint-cloudflare', 'ububall');
  // Create sibling ubumint with a different stub returning {Legacy: true}
  const legacyDir = path.join(f.root, 'ubumint');
  fs.mkdirSync(legacyDir);
  fs.writeFileSync(path.join(legacyDir, 'install.ps1'), `param([string]$Destination,[switch]$DryRun,[switch]$InstallOnly,[switch]$Setup,[switch]$ResetMint,[string]$SettingsDirectory)
@{Destination=$Destination;Legacy=$true} | ConvertTo-Json -Compress`);
  fs.writeFileSync(path.join(f.home, 'installation.json'), JSON.stringify({ source: f.source, destination: f.installed }));
  const r = f.run('-DryRun', '-InstallOnly');
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.Destination, f.installed);
  assert.equal(result.Legacy, undefined);
});

test('installed entry rejects a missing source without touching saved settings', windows, t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.source, 'install.ps1'));
  fs.writeFileSync(path.join(f.home, 'settings.json'), 'private sentinel');
  const r = f.run('-InstallOnly');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Source installer not found/);
  assert.equal(fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8'), 'private sentinel');
  assert.deepEqual(fs.readdirSync(f.installed).sort(), ['install.ps1', 'update.ps1']);
});

test('update.ps1 forwards to source checkout named ububall or ubumint', windows, t => {
  const f = fixture(t, 'ubumint-cloudflare', 'ububall');
  const r = f.runUpdate('-DryRun', '-InstallOnly');
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.Destination, f.installed);
  assert.equal(result.SettingsDirectory, f.home);
  assert.equal(result.DryRun, true);
  assert.equal(result.InstallOnly, true);
});

test('update.ps1 falls back to sibling ububall when manifest source was ubumint', windows, t => {
  const f = fixture(t, 'ubumint-cloudflare', 'ububall');
  fs.writeFileSync(path.join(f.home, 'installation.json'), JSON.stringify({ source: path.join(f.root, 'ubumint'), destination: f.installed }));
  const r = f.runUpdate('-DryRun', '-InstallOnly');
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.Destination, f.installed);
  assert.equal(result.DryRun, true);
});
