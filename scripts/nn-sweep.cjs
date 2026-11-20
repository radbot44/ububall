'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { parseArgs } = require('node:util');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const C = require('../shared/ububall-cpu.js');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const S = require('./cpu-simulation.cjs');
const { runReply } = require('./nn-policy-study.cjs');
const { buildOpponentResponses } = require('../shared/cpu/opponent.js');
const { planBasinKey } = require('../shared/cpu/evaluate.js');

const variants = [
  { name: 'uniform', focus: 'uniform' },
  { name: 'combined', focus: 'pulse' },
  { name: 'immediate', focus: 'immediate' },
  { name: 'defense', focus: 'defense' },
  { name: 'near-value', focus: 'uniform', gamma: 0.96 }
];
const shortBudget = {
  candidates: 96, opponents: 3, counterBudget: 12, counterRounds: 1, counterTop: 5,
  godWobble: false, godBridgeDual: false, pulseDepth: 2, lookaheadTop: 3, lookaheadBudget: 24
};

function addHistory(history, state, plans) {
  history.push({ roundTurns: state.roundTurns || 0, bodies: state.bodies, plans });
}

function screenSeed({ seed, models }) {
  const profiles = models.map(({ name, weightsPath }) => {
    const model = C.parseWeights(fs.readFileSync(weightsPath));
    if (!model) throw new Error(`Incompatible model: ${weightsPath}`);
    return { name, model };
  });
  const team = seed % 2;
  const history = [], rows = [];
  let state = S.initialState(seed, 'pulse');
  state.fouls = M.newFouls();
  for (let i = 0; i < 11 && state.winner === null; i++) {
    const opts = { seed: seed + 17 * i, history };
    if (i % 3 === 1) {
      const opponent = C.plan(state, 1 - team, { ...opts, level: 'god' }).plans;
      const replies = new Map([[planBasinKey(opponent), opponent]]);
      for (const reply of buildOpponentResponses(state, team, false, 4)) {
        const key = planBasinKey(reply);
        if (!replies.has(key)) replies.set(key, reply);
      }
      const outcomes = Object.fromEntries(profiles.map(({ name, model }) => {
        const { plans } = C.plan(state, team, { ...opts, level: 'ballistic', nnModel: model });
        return [name, [...replies.values()].map(reply => runReply(state, team, plans, reply).result.goals)];
      }));
      rows.push({ seed, turn: state.turn, team, outcomes });
    }
    const plans = [0, 1].flatMap(side => C.plan(state, side, {
      ...opts, level: side === team && seed % 2 ? 'insane' : 'hard'
    }).plans);
    addHistory(history, state, plans);
    state = M.resolveTurn(P, state, plans, { effects: false }).state;
    if (state.phase === 'goal') S.kickoff(state);
  }
  return rows;
}

function summarizeScreen(rows, models) {
  return models.map(({ name }) => {
    let firstGoals = 0, firstConceded = 0, secondGoals = 0, secondConceded = 0;
    for (const { team, outcomes } of rows) for (const [first, second] of outcomes[name]) {
      if (first === team) firstGoals++;
      if (first === 1 - team) firstConceded++;
      if (second === team) secondGoals++;
      if (second === 1 - team) secondConceded++;
    }
    const firstNet = firstGoals - firstConceded;
    return { name, firstGoals, firstConceded, secondGoals, secondConceded, firstNet, twoTurnNet: firstNet + secondGoals - secondConceded };
  }).sort((a, b) => b.firstNet - a.firstNet || b.twoTurnNet - a.twoTurnNet || a.firstConceded - b.firstConceded);
}

function summarizeMatches(results) {
  const wins = [0, 0], goals = [0, 0], ms = [0, 0];
  let capped = 0, turns = 0;
  for (const match of results) {
    for (const i of [0, 1]) {
      const seat = match.swapped ? 1 - i : i;
      goals[i] += match.scores[seat];
      if (match.winner === seat) wins[i]++;
      ms[i] += match.timing[seat].meanMs * match.turns;
    }
    capped += Number(match.capped);
    turns += match.turns;
  }
  return { wins, goals, capped, turns, meanMsPerTurn: ms.map(n => Math.round(n / Math.max(1, turns))) };
}

async function runJobs(jobs, threads) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(threads, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++, job = jobs[i];
      results[i] = await new Promise((resolve, reject) => {
        const worker = new Worker(__filename, { workerData: job });
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', code => { if (code) reject(new Error(`Sweep worker exited with status ${code}`)); });
      });
      console.error(`${job.label} ${job.seed}${job.swapped ? ' swapped' : ''} done`);
    }
  }));
  return results;
}

function matchJobs(label, profiles, seeds, maxTurns, budget) {
  const configuredProfiles = profiles.map(profile => ({ ...profile, ...budget }));
  return seeds.flatMap(seed => [false, true].map(swapped => ({
    label, mode: 'pulse', profiles: configuredProfiles, seed, swapped, maxTurns
  })));
}

function runTrainer(python, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(python[0], [...python.slice(1), path.join(__dirname, 'train-nn.py'), ...args], { stdio: 'inherit' });
    proc.once('error', reject);
    proc.once('close', code => code === 0 ? resolve() : reject(new Error(`Trainer exited with status ${code}`)));
  });
}

async function main() {
  const { values: args } = parseArgs({ options: {
    shards: { type: 'string' }, incumbent: { type: 'string' }, out: { type: 'string' }, calibration: { type: 'string' }, resume: { type: 'boolean' },
    python: { type: 'string' }, epochs: { type: 'string', default: '25' }, seed: { type: 'string', default: '15001' },
    'screen-seeds': { type: 'string', default: '6' },
    'short-pairs': { type: 'string', default: '2' }, 'full-pairs': { type: 'string', default: '0' },
    threads: { type: 'string', default: String(Math.min(12, os.availableParallelism())) }
  } });
  const [epochs, seed, screenSeeds, shortPairs, fullPairs, threads] = ['epochs', 'seed', 'screen-seeds', 'short-pairs', 'full-pairs', 'threads'].map(key => Number(args[key]));
  if (!args.shards || !args.incumbent || !args.out || ![epochs, seed, screenSeeds, shortPairs, threads].every(n => Number.isSafeInteger(n) && n > 0) ||
      !Number.isSafeInteger(fullPairs) || fullPairs < 0) {
    throw new Error('Pass --shards DIRECTORY --incumbent FILE --out DIRECTORY. Options: --resume --calibration REPORT --python EXE --epochs N --seed N --screen-seeds N --short-pairs N --full-pairs N --threads N.');
  }
  if (screenSeeds > 1000 || shortPairs > 1000 || seed + 2000 + fullPairs > 0xffffffff) throw new Error('Invalid seed ranges.');
  const seedRange = (start, count) => Array.from({ length: count }, (_, i) => start + i);
  const seeds = { screen: seedRange(seed, screenSeeds), short: seedRange(seed + 1000, shortPairs), full: seedRange(seed + 2000, fullPairs) };
  const python = args.python ? [args.python] : process.platform === 'win32' ? ['py', '-3.11'] : ['python3'];
  const out = path.resolve(args.out);
  const reportPath = path.join(out, 'report.json');
  const existing = args.resume ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  if (!existing && fs.existsSync(reportPath)) throw new Error(`Report already exists: ${reportPath}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(args.shards, 'manifest.json'), 'utf8'));
  if (!manifest.mode?.includes('pulse')) throw new Error('This sweep expects Pulse training shards.');
  if (Object.values(seeds).flat().some(s => s >= manifest.seed && s < manifest.seed + manifest.matches)) {
    throw new Error('Benchmark seeds overlap the training matches. Choose a different --seed.');
  }
  const incumbent = { name: 'incumbent', level: 'ballistic', weightsPath: path.resolve(args.incumbent) };
  if (!C.parseWeights(fs.readFileSync(incumbent.weightsPath))) throw new Error('The incumbent has an incompatible physics version.');
  const calibrationSource = args.calibration ? path.resolve(args.calibration) : null;
  const reference = calibrationSource ? JSON.parse(fs.readFileSync(calibrationSource, 'utf8')) : null;
  if (reference && (!reference.results?.length || reference.profiles?.length !== 2 ||
      !reference.profiles.every(p => p.level === 'ballistic' && p.weightsPath) || reference.results.some(r => r.mode !== 'pulse'))) {
    throw new Error('Calibration requires a Pulse head-to-head report with two Ballistic weight paths.');
  }
  fs.mkdirSync(out, { recursive: true });
  const settings = { shards: path.resolve(args.shards), seeds, epochs, trainSeed: 42, shortBudget, shortTurnCap: 42 };
  const reusableSeeds = existing && { ...existing.seeds, full: existing.full ? existing.seeds.full : seeds.full };
  if (existing && (Object.keys(settings).some(key => JSON.stringify(settings[key]) !== JSON.stringify(key === 'seeds' ? reusableSeeds : existing[key])) ||
      existing.models[0].weightsPath !== incumbent.weightsPath ||
      (existing.calibrationSource !== undefined && existing.calibrationSource !== calibrationSource))) {
    throw new Error('Resume the sweep with its original settings and model paths.');
  }
  const models = existing?.models ?? [incumbent];
  const report = { ...existing, ...settings, calibrationSource, models };
  const save = () => {
    const temporary = `${reportPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n');
    fs.renameSync(temporary, reportPath);
  };
  save();

  for (const { name, focus, gamma } of variants) {
    if (models.some(m => m.name === name)) continue;
    const weightsPath = path.join(out, `${name}.bin`), training = path.join(out, `${name}-training.json`);
    console.error(`Training ${name}`);
    await runTrainer(python, ['--shards', args.shards, '--backend', 'torch', '--hidden', '256', '--epochs', String(epochs),
      '--batch-size', '4096', '--seed', '42', '--policy-focus', focus, '--out', weightsPath, '--report', training,
      ...(gamma === undefined ? [] : ['--gamma', String(gamma)])]);
    models.push({ name, level: 'ballistic', weightsPath, focus, gamma, training });
    save();
  }

  const seen = new Map();
  const distinct = models.filter(model => {
    const hash = createHash('sha256').update(fs.readFileSync(model.weightsPath)).digest('hex');
    if (model.sha256 && model.sha256 !== hash) throw new Error(`Checkpoint changed since the previous run: ${model.weightsPath}`);
    model.sha256 = hash;
    const earlier = seen.get(hash);
    if (earlier) { model.duplicateOf = earlier; return false; }
    delete model.duplicateOf;
    seen.set(hash, model.name);
    return true;
  });
  if (!report.screen) {
    const timer = performance.now();
    const rows = (await runJobs(seeds.screen.map(seed => ({ label: 'screen', seed, models: distinct })), threads)).flat();
    report.screen = { seconds: (performance.now() - timer) / 1000, positions: rows.length, replies: rows.reduce((n, r) => n + r.outcomes.incumbent.length, 0), rows };
  }
  report.screen.standings = summarizeScreen(report.screen.rows, distinct);
  const finalists = report.screen.standings.filter(r => r.name !== 'incumbent').slice(0, 2).map(r => models.find(m => m.name === r.name));
  save();

  if (reference && !report.calibration) {
    const full = summarizeMatches(reference.results);
    const calibrationSeeds = [...new Set(reference.results.map(r => r.seed))];
    const started = performance.now();
    const reduced = await runJobs(matchJobs('calibration', reference.profiles, calibrationSeeds, report.shortTurnCap, shortBudget), threads);
    const short = summarizeMatches(reduced);
    const direction = r => Math.sign(r.wins[0] - r.wins[1] || r.goals[0] - r.goals[1]);
    report.calibration = { seeds: calibrationSeeds, full, short, seconds: (performance.now() - started) / 1000,
      agrees: direction(full) !== 0 && direction(full) === direction(short), matches: reduced };
    save();
  }

  const done = new Map((report.short?.standings ?? []).map(row => [row.name, row]));
  const pending = finalists.filter(model => !done.has(model.name));
  if (pending.length > 0) {
    const started = performance.now();
    const shortResults = await runJobs(pending.flatMap(model => matchJobs(model.name, [model, incumbent], seeds.short, report.shortTurnCap, shortBudget)), threads);
    for (const model of pending) {
      const results = shortResults.filter(r => r.profiles.some(p => p.name === model.name));
      done.set(model.name, { name: model.name, ...summarizeMatches(results), matches: results });
    }
    report.short = { seconds: (report.short?.seconds ?? 0) + (performance.now() - started) / 1000 };
  }
  report.short ??= { seconds: 0 };
  report.short.standings = finalists.map(model => done.get(model.name));
  const ranking = report.short.standings.slice().sort((a, b) => (b.wins[0] - b.wins[1]) - (a.wins[0] - a.wins[1]) ||
    (b.goals[0] - b.goals[1]) - (a.goals[0] - a.goals[1]));
  const enoughDecided = row => row.wins[0] + row.wins[1] >= row.capped;
  const useShort = report.calibration?.agrees === true && enoughDecided(report.calibration.short) && ranking.every(enoughDecided);
  report.candidate = (useShort ? ranking : finalists)[0]?.name ?? null;
  report.selection = useShort ? 'calibrated-short-matches' : 'full-budget-position-screen';
  save();

  if (fullPairs && report.candidate && report.full?.candidate !== report.candidate) {
    const candidate = finalists.find(model => model.name === report.candidate);
    const startedFull = performance.now();
    const matches = await runJobs(matchJobs(`full ${candidate.name}`, [candidate, incumbent], seeds.full, 180, {}), threads);
    report.full = { candidate: candidate.name, seconds: (performance.now() - startedFull) / 1000, ...summarizeMatches(matches), matches };
    save();
  }
  console.log(`Sweep report: ${reportPath}`);
  console.table(report.screen.standings);
  console.log(`Candidate for full evaluation: ${report.candidate} (${report.selection})`);
}

if (isMainThread && require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
else if (!isMainThread) parentPort.postMessage(workerData.models ? screenSeed(workerData) : S.match(workerData));
