/* One public snapshot per turn; private super arming and human arrows are excluded. */
(function(root) {
  'use strict';
  function createCPUClient(makeWorker = () => new Worker('ububall-cpu-worker.js')) {
    // A worker that finished its plan is kept for the next one, so its scripts stay loaded and its
    // search code stays optimized. A cancelled or failed worker is terminated and later replaced.
    let cancel = () => {}, idle = null;
    return {
      cancel() { cancel(); },
      plan(state, config, team = 1) {
        cancel();
        const snapshot = structuredClone(state);
        for (const b of snapshot.bodies) b.superArm = false;
        return new Promise(resolve => {
          let worker, timer, done = false;
          const finish = (value, keep = false) => {
            if (done) return;
            done = true; clearTimeout(timer);
            if (keep) idle = worker; else worker?.terminate();
            resolve(value);
          };
          cancel = () => finish(null);
          const failed = () => finish({ error: true });
          try {
            worker = idle || makeWorker(); idle = null;
            worker.onmessage = ({ data }) => data.result ? finish(data.result, true) : failed();
            worker.onerror = failed;
            timer = setTimeout(failed, 10000);
            worker.postMessage({ state: snapshot, config, team });
          } catch { failed(); }
        });
      }
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = createCPUClient;
  else root.createCPUClient = createCPUClient;
})(globalThis);
