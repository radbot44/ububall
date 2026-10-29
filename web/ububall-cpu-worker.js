'use strict';
importScripts('ububall-physics.js', 'ububall-match.js', 'ububall-cpu.js');
self.onmessage = ({ data }) => {
  try { self.postMessage({ result: ububallCPU.plan(data.state, 1, data.config) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
