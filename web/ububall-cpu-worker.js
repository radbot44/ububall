'use strict';
importScripts('ubu.js', 'ububall-physics.js', 'ububall-match.js', 'ububall-cpu.js');

// Preload optional UBNN fp16 weights once per persistent worker; silently falls back to heuristic search if absent.
const weightsReady = typeof fetch === 'function'
  ? fetch('assets/ububall-net.bin')
      .then(res => (res && res.ok ? res.arrayBuffer() : null))
      .then(buf => (buf && buf.byteLength >= 16 ? ububallCPU.loadWeights(buf) : null))
      .catch(() => null)
  : Promise.resolve(null);

self.onmessage = async ({ data }) => {
  try {
    await weightsReady;
    self.postMessage({ result: ububallCPU.plan(data.state, data.team ?? 1, data.config) });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
