'use strict';
const { mkdirSync, copyFileSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');
const target = join(root, 'dist', 'public');
const targetAssets = join(target, 'assets');
mkdirSync(targetAssets, { recursive: true });

// Explicit public files only; repository contents and secrets are never an asset root.
const webFiles = [
  'ububall.html', 'ububall.css', 'ububall.js', 'ububall-physics.js',
  'index.html', 'site.css', 'site.js', 'pack-scene.js',
  'voice.html', 'demo.html', 'demo.js'
];
const sharedFiles = [
  'ubu.js', 'ubu-file.js', 'ubu-render.js', 'ubu-audio.js', 'rarity.js'
];
const assetFiles = [
  'uburoom-wordmark-brand.svg', 'uburoom-oomark-brand.svg',
  '00_stalwart.png', '01_knockout.png', '02_sticky.png', '03_cannonball.png',
  '04_magnet.png', '05_colossus.png', '06_shockwave.png', '07_ghost.png'
];

const topFiles = [...webFiles, ...sharedFiles, 'assets'];
for (const name of readdirSync(target)) {
  if (!topFiles.includes(name)) throw new Error('Unexpected file in public output: ' + name);
}
for (const name of readdirSync(targetAssets)) {
  if (!assetFiles.includes(name)) throw new Error('Unexpected file in public assets output: ' + name);
}

for (const name of webFiles) copyFileSync(join(root, 'web', name), join(target, name));
for (const name of sharedFiles) copyFileSync(join(root, 'shared', name), join(target, name));
for (const name of assetFiles) copyFileSync(join(root, 'web', 'assets', name), join(targetAssets, name));
