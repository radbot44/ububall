/* One public snapshot per turn; private super arming and human arrows are excluded. */
(function(root) {
  'use strict';
  const noop = () => {};
  const TIMEOUT_MS = 10000;
  function createCPUClient(makeWorker = () => new Worker('ububall-cpu-worker.js')) {
    // A worker that finished its plan is kept for the next one, so its scripts stay loaded and its
    // search code stays optimized. A cancelled, disposed or failed worker is terminated and replaced.
    let cancel = noop, idle = null, disposed = false;
    const dropIdle = () => {
      if (!idle) return;
      const w = idle; idle = null;
      w.onmessage = w.onerror = w.onmessageerror = noop;
      w.terminate();
    };
    return {
      cancel() { cancel(); },
      dispose() { disposed = true; cancel(); dropIdle(); },
      hasNeuralWeights(pulse = false) {
        return new Promise(resolve => {
          let worker, timer, done = false;
          const finish = (available, keep = false) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            const reuse = keep && !disposed && !idle && cancel === noop && Boolean(worker);
            if (worker) {
              worker.onmessage = worker.onmessageerror = noop;
              worker.onerror = reuse ? () => { if (idle === worker) dropIdle(); } : noop;
            }
            if (reuse) idle = worker;
            else worker?.terminate();
            resolve(available);
          };
          const failed = () => finish(false, false);
          try {
            worker = idle || makeWorker();
            if (worker === idle) idle = null;
            worker.onmessage = ({ data }) => finish(data?.hasNeuralWeights === true, true);
            worker.onerror = worker.onmessageerror = failed;
            timer = setTimeout(failed, TIMEOUT_MS);
            worker.postMessage({ checkNeuralWeights: true, pulse });
          } catch { failed(); }
        });
      },
      plan(state, config, team = 1) {
        cancel();
        return new Promise(resolve => {
          let worker, timer, done = false;
          const finish = (value, keep = false) => {
            if (done) return;
            done = true; clearTimeout(timer); cancel = noop;
            const reuse = keep && !disposed && Boolean(worker);
            if (worker) {
              worker.onmessage = worker.onmessageerror = noop;
              worker.onerror = reuse ? () => { if (idle === worker) dropIdle(); } : noop;
            }
            if (reuse) {
              if (idle && idle !== worker) dropIdle();
              idle = worker;
            } else {
              worker?.terminate();
            }
            resolve(value);
          };
          cancel = () => finish(null);
          const failed = () => finish({ error: true });
          try {
            const snapshot = structuredClone(state);
            for (const b of snapshot.bodies) b.superArm = false;
            worker = idle || makeWorker(); idle = null;
            worker.onmessage = ({ data }) => data?.result ? finish(data.result, true) : failed();
            worker.onerror = failed;
            worker.onmessageerror = failed;
            timer = setTimeout(failed, TIMEOUT_MS);
            worker.postMessage({ state: snapshot, config, team });
          } catch { failed(); }
        });
      }
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = createCPUClient;
  else root.createCPUClient = createCPUClient;
})(globalThis);
