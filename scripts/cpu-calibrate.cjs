'use strict';
// Fits CPU position weights to self-play: which settled positions lead to the next goal, and how soon.
const os = require('node:os');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const C = require('../shared/ububall-cpu.js');
const S = require('./cpu-simulation.cjs');

// One match's settled turn-start positions (team 0's side) and the turns until the next goal and its scorer.
function samples({ seed, mode, level, maxTurns }) {
  let state = S.initialState(seed, mode);
  const open = [], out = [];
  for (let turn = 0; state.winner === null && turn < maxTurns; turn++) {
    open.push({ x: C.features(state, 0), turn });
    const moves = [0, 1].flatMap(team => S.choose(state, team, level, seed * 7919 + turn * 17 + team).plans);
    const result = M.resolveTurn(P, state, moves, { effects: false });
    state = result.state;
    if (result.replay.goal !== null) {
      for (const s of open) out.push({ x: s.x, k: turn - s.turn, scorer: result.replay.goal });
      open.length = 0;
      S.kickoff(state);
    }
  }
  for (const s of open) out.push({ x: s.x, k: maxTurns - s.turn, scorer: null, censored: true });
  return out;
}

// Least squares without intercept (features are antisymmetric between teams); returns coefficients and standard errors.
function fit(rows, labels) {
  const n = rows.length, p = rows[0].length;
  const scale = Array.from({ length: p }, (_, j) => Math.sqrt(rows.reduce((a, r) => a + r[j] * r[j], 0) / n) || 1);
  const xtx = Array.from({ length: p }, () => new Float64Array(p)), xty = new Float64Array(p);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    for (let a = 0; a < p; a++) {
      const va = r[a] / scale[a];
      xty[a] += va * labels[i];
      for (let b = 0; b < p; b++) xtx[a][b] += va * r[b] / scale[b];
    }
  }
  const inv = invert(xtx), beta = inv.map(row => row.reduce((a, v, j) => a + v * xty[j], 0));
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    const pred = rows[i].reduce((a, v, j) => a + v / scale[j] * beta[j], 0);
    sse += (labels[i] - pred) ** 2; sst += labels[i] ** 2;
  }
  const sigma2 = sse / Math.max(1, n - p);
  return {
    coef: beta.map((b, j) => b / scale[j]),
    se: beta.map((_, j) => Math.sqrt(sigma2 * inv[j][j]) / scale[j]),
    r2: 1 - sse / sst, n
  };
}

function invert(m) {
  const p = m.length, a = m.map((row, i) => [...row, ...Array.from({ length: p }, (_, j) => +(i === j))]);
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    [a[c], a[piv]] = [a[piv], a[c]];
    const d = a[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('Singular feature matrix.');
    for (let j = 0; j < 2 * p; j++) a[c][j] /= d;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f) for (let j = 0; j < 2 * p; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map(row => row.slice(p));
}

if (!isMainThread) {
  const ctrl = new Int32Array(workerData.jobCtrl), out = [];
  for (let idx; (idx = Atomics.add(ctrl, 0, 1)) < workerData.jobs.length;) out.push(...samples(workerData.jobs[idx]));
  parentPort.postMessage(out);
  return;
}

async function main() {
  const values = { games: 200, seed: 1, level: 'easy', mode: 'standard', turns: 80, gamma: 0.6, horizon: 8,
    threads: Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 1) };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!(key in values) && key !== 'output') throw new Error('Unknown option: ' + args[i]);
    if (i + 1 >= args.length) throw new Error('Missing value for ' + args[i]);
    values[key] = ['level', 'mode', 'output'].includes(key) ? args[i + 1] : Number(args[i + 1]);
  }
  const jobs = Array.from({ length: values.games }, (_, i) => ({ seed: values.seed + i, mode: values.mode, level: values.level, maxTurns: values.turns }));
  const jobCtrl = new SharedArrayBuffer(4), started = Date.now();
  const chunks = await Promise.all(Array.from({ length: Math.min(values.threads, jobs.length) }, () => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { jobCtrl, jobs } });
    w.on('message', resolve); w.on('error', reject);
  })));
  const all = chunks.flat();
  // Discounted next-goal value: +1 for own goal on the very next turn, gamma^k later, 0 beyond the horizon.
  const kept = all.filter(s => !(s.censored && s.k < values.horizon));
  const labels = kept.map(s => s.scorer === null || s.k >= values.horizon ? 0 : (s.scorer === 0 ? 1 : -1) * values.gamma ** (s.k + 1));
  const result = fit(kept.map(s => s.x), labels);
  const report = {
    settings: values, seconds: (Date.now() - started) / 1000, samples: result.n, r2: result.r2,
    features: C.FEATURE_NAMES.map((name, j) => ({
      name, coef: result.coef[j], se: result.se[j],
      weight: result.coef[j] * C.WEIGHTS.goal, current: C.WEIGHTS[name]
    }))
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values.output) require('node:fs').writeFileSync(values.output, json); else process.stdout.write(json);
}

main().catch(err => { console.error(err); process.exit(1); });
