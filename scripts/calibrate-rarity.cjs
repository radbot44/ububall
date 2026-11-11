'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomFillSync } = require('node:crypto');
const ubu = require('../shared/ubu.js');
const { scoreRarity } = require('../shared/rarity.js');

const SAMPLE_SIZE = 1000000;
const STEPS = 1000;

console.log(`Calibrating rarity distribution from ${SAMPLE_SIZE} samples...`);
const scores = new Float64Array(SAMPLE_SIZE);
const buf = new Uint8Array(128);

for (let i = 0; i < SAMPLE_SIZE; i++) {
  randomFillSync(buf);
  scores[i] = scoreRarity(ubu.decode(buf)).bits;
}

scores.sort();

const table = [];
for (let i = 0; i <= STEPS; i++) {
  const rank = Math.min(SAMPLE_SIZE - 1, Math.floor(i * (SAMPLE_SIZE / STEPS)));
  table.push(Number(scores[rank].toFixed(6)));
}

const sharedDir = path.join(__dirname, '..', 'shared');
const outputPath = path.join(sharedDir, 'rarity-table.json');
fs.writeFileSync(outputPath, JSON.stringify({
  sampleSize: SAMPLE_SIZE,
  generatedAt: new Date().toISOString(),
  steps: STEPS,
  min: scores[0],
  max: scores[SAMPLE_SIZE - 1],
  table
}, null, 2) + '\n');

console.log(`Saved ${table.length} quantile thresholds to ${outputPath}.`);

const rarityPath = path.join(sharedDir, 'rarity.js');
const raritySource = fs.readFileSync(rarityPath, 'utf8');
const updatedSource = raritySource.replace(/const TABLE = \[[^\n]*?\];/, 'const TABLE = ' + JSON.stringify(table) + ';');
assert.notEqual(updatedSource, raritySource, 'Failed to locate TABLE declaration in shared/rarity.js');
fs.writeFileSync(rarityPath, updatedSource);
