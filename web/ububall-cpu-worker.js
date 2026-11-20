'use strict';
importScripts('ubu.js', 'ububall-physics.js', 'ububall-match.js', 'ububall-cpu.js');

// Keep individual models cached so a worker can plan for either mode.
const weightFiles = new Map();
function loadWeights(file) {
  if (!weightFiles.has(file)) {
    weightFiles.set(file, fetch(`assets/${file}`)
      .then(res => (res.ok ? res.arrayBuffer() : null))
      .then(buf => ububallCPU.parseWeights(buf))
      .catch(() => null));
  }
  return weightFiles.get(file);
}

async function loadNeuralModel(pulse) {
  const specialist = pulse ? 'ububall-net-pulse.bin' : 'ububall-net-standard.bin';
  return await loadWeights(specialist) ?? await loadWeights('ububall-net.bin');
}

self.onmessage = async ({ data }) => {
  try {
    if (data.checkNeuralWeights) {
      self.postMessage({ hasNeuralWeights: Boolean(await loadNeuralModel(data.pulse)) });
      return;
    }
    let config = data.config;
    if ((config?.level === 'ballistic' || config?.nn) && !config.nnModel) {
      const pulse = ububallMatch.rule(data.state.mode || 'standard', 'pulse');
      const nnModel = await loadNeuralModel(pulse);
      if (nnModel) config = { ...config, nnModel };
    }
    self.postMessage({ result: ububallCPU.plan(data.state, data.team ?? 1, config) });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
