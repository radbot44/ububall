/* One public snapshot per turn; private super arming and human arrows are excluded. */
(function(root) {
  'use strict';
  function createCPUClient(makeWorker = () => new Worker('ububall-cpu-worker.js')) {
    let cancel = () => {};
    return {
      cancel() { cancel(); },
      plan(state, config) {
        cancel();
        const snapshot = structuredClone(state);
        for (const b of snapshot.bodies) { b.superArm = false; b.superActive = null; }
        return new Promise(resolve => {
          let worker, timer, done = false;
          const finish = value => {
            if (done) return;
            done = true; clearTimeout(timer); worker?.terminate(); resolve(value);
          };
          cancel = () => finish(null);
          const failed = () => finish({ error: true });
          try {
            worker = makeWorker();
            worker.onmessage = ({ data }) => finish(data.result || { error: true });
            worker.onerror = failed;
            timer = setTimeout(failed, 10000);
            worker.postMessage({ state: snapshot, config });
          } catch { failed(); }
        });
      }
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = createCPUClient;
  else root.createCPUClient = createCPUClient;
})(globalThis);
