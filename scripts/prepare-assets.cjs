'use strict';
const { mkdirSync, copyFileSync, readdirSync, rmSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');
const target = join(root, 'dist', 'public');
const targetAssets = join(target, 'assets');
mkdirSync(targetAssets, { recursive: true });

// Explicit public files only; repository contents and secrets are never an asset root.
const webFiles = [
  'ububall.html', 'ububall.css', 'ububall.js', 'ububall-physics.js', 'ububall-online.js', 'ububall-cpu-worker.js', 'ububall-cpu-client.js',
  'index.html', 'app.js', 'site.css', 'site.js', 'site-header.js', 'pack-scene.js',
  'voice.html', 'demo.html', 'demo.js', 'auth-complete.html'
];
const sharedFiles = [
  'ububall-match.js', 'ububall-cpu.js', 'ubu.js', 'ubu-file.js', 'ubu-render.js', 'ubu-audio.js', 'rarity.js'
];
const assetFiles = [
  'uburoom-wordmark-brand.svg', 'uburoom-oomark-brand.svg', 'oomark-pattern.svg', 'ububall-logo.svg', 'UburoomSans-Regular.woff2',
  '00_stalwart.png', '01_knockout.png', '02_sticky.png', '03_cannonball.png',
  '04_magnet.png', '05_colossus.png', '06_shockwave.png', '07_ghost.png'
];

// Remove files dropped from the lists so they are never served. The folder itself stays,
// keeping a running wrangler dev watching it.
const topFiles = [...webFiles, ...sharedFiles, 'assets'];
for (const name of readdirSync(target)) if (!topFiles.includes(name)) rmSync(join(target, name), { recursive: true, force: true });
for (const name of readdirSync(targetAssets)) if (!assetFiles.includes(name)) rmSync(join(targetAssets, name), { recursive: true, force: true });

for (const name of webFiles) copyFileSync(join(root, 'web', name), join(target, name));
for (const name of sharedFiles) copyFileSync(join(root, 'shared', name), join(target, name));
for (const name of assetFiles) copyFileSync(join(root, 'web', 'assets', name), join(targetAssets, name));
