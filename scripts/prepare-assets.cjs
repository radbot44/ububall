'use strict';
const { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { resolve, join } = require('node:path');
const { buildSync } = require('esbuild');
const ota = require('./ota-manifest.cjs');
const root = resolve(__dirname, '..');
const target = join(root, 'dist', 'public');
const targetAssets = join(target, 'assets');
const requireOtaSignature = process.argv.includes('--require-ota-signature');
mkdirSync(targetAssets, { recursive: true });

// Explicit public files only; repository contents and secrets are never an asset root.
const webFiles = [
  'ububall.html', 'ububall.css', 'ububall.js', 'ububall-webgl.js', 'ububall-presentation.js', 'ububall-playback.js', 'ububall-stats.js', 'ububall-theater.js', 'ububall-bench.js', 'mp4.js', 'ububall-online.js', 'ububall-cpu-worker.js', 'ububall-cpu-client.js',
  'index.html', 'platform.js', 'app.js', 'site.css', 'site.js', 'site-header.js', 'pack-scene.js', 'starter.js', 'ubu-list.js', 'game-ui.js', 'ububall-activity.js',
  'voice.html', 'demo.html', 'demo.js', 'effects.html', 'effects.css', 'effects.js', 'auth-complete.html',
  'favicon.svg', 'favicon.ico', 'apple-touch-icon.png'
];
const sharedFiles = [
  'ububall-match.js', 'ububall-physics.js', 'ububall-replay.js', 'ububall-cpu.js', 'ubu.js', 'ubu-archetype.js', 'ubu-file.js', 'ubu-render.js', 'ubu-audio.js', 'rarity.js', 'ability.js'
];
const optionalAssets = ['ububall-net-standard.bin', 'ububall-net-pulse.bin', 'ububall-net.bin']
  .filter(name => existsSync(join(root, 'web', 'assets', name)));
const assetFiles = [
  'uburoom-wordmark-brand.svg', 'uburoom-oomark-brand.svg', 'oomark-pattern.svg', 'ububall-logo.svg', 'ububall-logo-com.svg', 'UburoomSans-Regular.woff2',
  '00_stalwart.png', '01_knockout.png', '02_sticky.png', '03_cannonball.png',
  '04_magnet.png', '05_colossus.png', '06_shockwave.png', '07_ghost.png',
  ...optionalAssets
];

// Remove files dropped from the lists so they are never served. The folder itself stays,
// keeping a running wrangler dev watching it.
const topFiles = [...webFiles, ...sharedFiles, 'discord-sdk.js', 'discord-sdk.js.LEGAL.txt', 'discord-sdk.LICENSE.md', ota.MANIFEST_NAME, ota.SIGNATURE_NAME, 'assets'];
for (const name of readdirSync(target)) if (!topFiles.includes(name)) rmSync(join(target, name), { recursive: true, force: true });
for (const name of readdirSync(targetAssets)) if (!assetFiles.includes(name)) rmSync(join(targetAssets, name), { recursive: true, force: true });

for (const name of webFiles) copyFileSync(join(root, 'web', name), join(target, name));
const bundledShared = new Set(['ubu.js', 'ubu-render.js', 'ubu-audio.js', 'ububall-physics.js', 'ububall-cpu.js']);
for (const name of sharedFiles) {
  if (bundledShared.has(name)) {
    buildSync({ entryPoints: [join(root, 'shared', name)], outfile: join(target, name), bundle: true, format: 'iife', absWorkingDir: root });
  } else {
    copyFileSync(join(root, 'shared', name), join(target, name));
  }
}
for (const name of assetFiles) copyFileSync(join(root, 'web', 'assets', name), join(targetAssets, name));
buildSync({ stdin: { contents: "export { DiscordSDK } from '@discord/embedded-app-sdk';", resolveDir: root },
  outfile: join(target, 'discord-sdk.js'), bundle: true, format: 'esm', minify: true, legalComments: 'linked', absWorkingDir: root });
copyFileSync(join(root, 'node_modules', '@discord', 'embedded-app-sdk', 'LICENSE.md'), join(target, 'discord-sdk.LICENSE.md'));

// Signed SHA-256 manifest for Capacitor Android silent delta OTA updates (scripts/ota-manifest.cjs).
// The native floor follows the Capacitor plugins the web code uses (mobile/native-compat.json).
const nativeCompat = JSON.parse(readFileSync(join(root, 'mobile', 'native-compat.json'), 'utf8'));
const usedPlugins = ota.nativePluginsUsed(webFiles.filter(name => name.endsWith('.js')).map(name => readFileSync(join(root, 'web', name), 'utf8')));
const { bytes: manifestBytes } = ota.buildManifest(target, { minNativeVersion: ota.minNativeVersion(usedPlugins, nativeCompat), issuedAt: Date.now() });
writeFileSync(join(target, ota.MANIFEST_NAME), manifestBytes);
const signaturePath = join(target, ota.SIGNATURE_NAME);
const keyPath = ota.signingKeyPath();
if (keyPath) {
  const signature = ota.signManifest(manifestBytes, readFileSync(keyPath, 'utf8'));
  const publicKeyPath = process.env.UBUBALL_OTA_PUBLIC_KEY || join(root, 'mobile', 'ota-public-key.pem');
  if (!ota.verifyManifest(manifestBytes, signature, readFileSync(publicKeyPath, 'utf8'))) {
    throw new Error(`OTA signing key ${keyPath} does not match ${publicKeyPath}; installed apps would reject this manifest.`);
  }
  writeFileSync(signaturePath, signature + '\n');
} else {
  rmSync(signaturePath, { force: true });
  if (requireOtaSignature) throw new Error('No OTA signing key found (UBUBALL_OTA_SIGNING_KEY or %LOCALAPPDATA%\\ubumint\\ota-signing-key.pem); refusing to publish an unsigned mobile manifest.');
}
