const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const installer = path.resolve(__dirname, '../install.ps1');
const windows = { skip: process.platform !== 'win32' };
const stub = `param([string]$Destination,[switch]$DryRun,[switch]$InstallOnly,[switch]$Setup,[switch]$ResetMint,[string]$SettingsDirectory)
@{Destination=$Destination;DryRun=[bool]$DryRun;InstallOnly=[bool]$InstallOnly;Setup=[bool]$Setup;ResetMint=[bool]$ResetMint;SettingsDirectory=$SettingsDirectory} | ConvertTo-Json -Compress`;
function fixture(t, folder = 'ubumint-cloudflare') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ubumint-entry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installed = path.join(root, folder), source = path.join(root, 'ubumint'), home = path.join(root, 'private');
  for (const dir of [installed, source, home]) fs.mkdirSync(dir);
  fs.copyFileSync(installer, path.join(installed, 'install.ps1'));
  fs.writeFileSync(path.join(source, 'install.ps1'), stub);
  const run = (...args) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(installed, 'install.ps1'), '-SettingsDirectory', home, ...args], { encoding: 'utf8' });
  return { source, installed, home, run };
}
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
test('installed entry rejects a missing source without touching saved settings', windows, t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.source, 'install.ps1'));
  fs.writeFileSync(path.join(f.home, 'settings.json'), 'private sentinel');
  const r = f.run('-InstallOnly');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Source installer not found/);
  assert.equal(fs.readFileSync(path.join(f.home, 'settings.json'), 'utf8'), 'private sentinel');
  assert.deepEqual(fs.readdirSync(f.installed), ['install.ps1']);
});
