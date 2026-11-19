'use strict';
importScripts('ubu.js', 'ububall-physics.js', 'ububall-match.js', 'ububall-cpu.js');

// Heuristic turns can start without waiting for the optional asset.
let weightsReady;
function loadNeuralWeights() {
  return weightsReady ??= fetch('assets/ububall-net.bin')
    .then(res => (res.ok ? res.arrayBuffer() : null))
    .then(buf => Boolean(ububallCPU.loadWeights(buf)))
    .catch(() => false);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.checkNeuralWeights) {
      self.postMessage({ hasNeuralWeights: await loadNeuralWeights() });
      return;
    }
    if (data.config?.level === 'ballistic' || data.config?.nn) await loadNeuralWeights();
    self.postMessage({ result: ububallCPU.plan(data.state, data.team ?? 1, data.config) });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
