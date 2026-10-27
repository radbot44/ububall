'use strict';
// Run on both revisions with: node scripts/bench-ububall.cjs
// Prefer the median over several runs, using the same Node/browser engine.
const { performance } = require('node:perf_hooks');
const P = require('../ububall-physics.js');
const STEPS = 20000;
function benchmark(withSpin) {
  let bodies = P.kickoff(), seed = 20261026;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  function launch() {
    P.launch(bodies, Array.from({ length: 6 }, (_, i) => ({
      angle: i * Math.PI / 3 + random() * 0.2,
      power: 0.5 + random() * 0.5,
      spin: withSpin ? random() * 2 - 1 : 0
    })));
  }
  launch();
  const start = performance.now();
  for (let i = 0; i < STEPS; i++) {
    const goal = P.step(bodies);
    if (goal !== null) bodies = P.kickoff();
    if (goal !== null || P.settled(bodies)) launch();
  }
  return performance.now() - start;
}
for (const withSpin of [false, true]) {
  for (let i = 0; i < 2; i++) benchmark(withSpin); // JIT warmup
  const samples = Array.from({ length: 5 }, () => benchmark(withSpin)).sort((a, b) => a - b);
  console.log(`${withSpin ? 'spin' : 'no spin'}: median ${samples[2].toFixed(1)} ms / ${STEPS} steps`);
}
