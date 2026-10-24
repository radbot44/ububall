'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ubu = require('../ubu.js');

const STIRLING = [0, 1, 15, 25, 10, 1];

function surprise(p) {
  return -Math.log2(p);
}

function tailProbability(v) {
  const t = Math.abs((v - 511) / (v <= 511 ? 511 : 512));
  const left = Math.floor(511 - 511 * t + 1e-10) + 1;
  const right = 1024 - Math.max(512, Math.ceil(511 + 512 * t - 1e-10));
  return (left + right) / 1024;
}

function scoreRarityBits(model) {
  const a = Object.values(model.attributes);
  let finishes = a.reduce((sum, part) => sum + surprise(part.texture ? 1 / 256 : 63 / 64), 0);
  const k = new Set(a.map(part => part.color)).size;
  let colorP = STIRLING[k] / 32 ** 5;
  for (let i = 0; i < k; i++) colorP *= 32 - i;
  let colors = surprise(colorP);

  const corners = model.mouth.corners;
  const count = corners.filter(Boolean).length;
  const mask = corners.reduce((n, cut) => (n << 1) | Number(cut), 0);
  let cornerP = (15 / 16) ** (6 - count) * (1 / 16) ** count;
  if (mask === 12 || mask === 3) cornerP += 15 / 256;
  if (mask === 15) cornerP += 1 / 256;
  let cornerBits = surprise(cornerP);

  let eyeFlips = 0;
  for (let i = 0; i < 2; i++) {
    if (model.eyes.raw[i] === 511) continue;
    const flipped = i === 0 ? model.eyes.flipX : model.eyes.flipY;
    eyeFlips += surprise(flipped ? 1 / 1024 : 1023 / 1024);
  }

  let geometry = 0;
  for (const v of [...model.mouth.raw, ...model.eyes.raw]) {
    const p = tailProbability(v);
    geometry += Math.max(0, Math.log2(0.05 / p));
  }

  const twoWords = !model.parts.praenomen || !model.parts.cognomen;
  let nameBits = surprise(twoWords ? 1 / 4 : 3 / 4);

  return finishes + colors + cornerBits + eyeFlips + geometry + nameBits;
}

const SAMPLE_SIZE = 1000000;
const STEPS = 1000;

console.log(`Calibrating rarity distribution from ${SAMPLE_SIZE} samples...`);
const scores = new Float64Array(SAMPLE_SIZE);
const buf = new Uint8Array(32);

for (let i = 0; i < SAMPLE_SIZE; i++) {
  crypto.getRandomValues(buf);
  scores[i] = scoreRarityBits(ubu.decode(buf));
}

scores.sort();

const table = [];
for (let i = 0; i <= STEPS; i++) {
  const rank = Math.min(SAMPLE_SIZE - 1, Math.floor(i * (SAMPLE_SIZE / STEPS)));
  table.push(Number(scores[rank].toFixed(6)));
}

const outputPath = path.join(__dirname, '..', 'rarity-table.json');
fs.writeFileSync(outputPath, JSON.stringify({
  sampleSize: SAMPLE_SIZE,
  generatedAt: new Date().toISOString(),
  steps: STEPS,
  min: scores[0],
  max: scores[SAMPLE_SIZE - 1],
  table
}, null, 2) + '\n');

console.log(`Saved ${table.length} quantile thresholds to ${outputPath}.`);
