'use strict';
const { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve, join } = require('node:path');
const { buildSync } = require('esbuild');
const root = resolve(__dirname, '..');
const target = join(root, 'dist', 'public');
const targetAssets = join(target, 'assets');
const OTA_MIN_NATIVE_VERSION = 1;
mkdirSync(targetAssets, { recursive: true });

// Explicit public files only; repository contents and secrets are never an asset root.
const webFiles = [
  'ububall.html', 'ububall.css', 'ububall.js', 'ububall-webgl.js', 'ububall-presentation.js', 'ububall-playback.js', 'ububall-stats.js', 'ububall-theater.js', 'ububall-bench.js', 'mp4.js', 'ububall-online.js', 'ububall-cpu-worker.js', 'ububall-cpu-client.js',
  'index.html', 'platform.js', 'app.js', 'site.css', 'site.js', 'site-header.js', 'pack-scene.js', 'starter.js', 'ubu-list.js', 'game-ui.js', 'ububall-activity.js',
  'voice.html', 'demo.html', 'demo.js', 'effects.html', 'effects.css', 'effects.js', 'auth-complete.html'
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
const topFiles = [...webFiles, ...sharedFiles, 'discord-sdk.js', 'discord-sdk.js.LEGAL.txt', 'discord-sdk.LICENSE.md', 'mobile-manifest.json', 'assets'];
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

// Generate deterministic SHA-256 manifest for Capacitor Android silent delta OTA updates.
const manifestPaths = [
  ...readdirSync(target).filter(name => name !== 'assets' && name !== 'mobile-manifest.json'),
  ...readdirSync(targetAssets).map(name => `assets/${name}`)
].sort();
const files = {};
const summaryLines = [];
for (const rel of manifestPaths) {
  const bytes = readFileSync(join(target, rel));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  files[rel] = { sha256, size: bytes.length };
  summaryLines.push(`${rel}:${sha256}`);
}
const version = createHash('sha256').update(summaryLines.join('\n')).digest('hex').slice(0, 16);
writeFileSync(
  join(target, 'mobile-manifest.json'),
  JSON.stringify({ schema: 1, minNativeVersion: OTA_MIN_NATIVE_VERSION, version, files }, null, 2) + '\n',
  'utf8'
);
