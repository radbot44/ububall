'use strict';
const { mkdirSync, copyFileSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');
const target = join(root, 'dist', 'public');
mkdirSync(target, { recursive: true });
// Explicit public files only; repository contents and secrets are never an asset root.
const files = ['index.html', 'site.css', 'site.js', 'ubu.js', 'ubu-file.js', 'ubu-render.js', 'demo.html', 'demo.js'];
for (const name of readdirSync(target)) if (!files.includes(name)) throw new Error('Unexpected file in public output: ' + name);
for (const name of files) copyFileSync(join(root, name), join(target, name));
