'use strict';
const { mkdirSync, copyFileSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');
const target = join(root, 'dist', 'public');
mkdirSync(target, { recursive: true });
// Explicit public files only; repository contents and secrets are never an asset root.
const files = [
  'ububall.html', 'ububall.css', 'ububall.js', 'ububall-physics.js',
  'index.html', 'site.css', 'site.js', 'pack-scene.js',
  'ubu.js', 'ubu-file.js', 'ubu-render.js', 'ubu-audio.js',
  'voice.html', 'demo.html', 'demo.js', 'rarity.js',
  'uburoom-wordmark-brand.svg', 'uburoom-oomark-brand.svg',
  '00_stalwart.png', '01_knockout.png', '02_sticky.png', '03_cannonball.png',
  '04_magnet.png', '05_colossus.png', '06_shockwave.png', '07_ghost.png'
];
for (const name of readdirSync(target)) if (!files.includes(name)) throw new Error('Unexpected file in public output: ' + name);
for (const name of files) copyFileSync(join(root, name), join(target, name));
