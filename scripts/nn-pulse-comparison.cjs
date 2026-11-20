'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseArgs } = require('node:util');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { spawnSync } = require('node:child_process');
const C = require('../shared/ububall-cpu.js');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const NN = require('../shared/cpu/nn.js');
const S = require('./cpu-simulation.cjs');
const { makeMatchState, geomHintsFor } = require('./nn-generate.cjs');
const { runReply } = require('./nn-policy-study.cjs');
const { buildOpponentResponses } = require('../shared/cpu/opponent.js');

function observation(state, team, perm = [0, 1, 2]) {
  return Array.from(NN.encodeState(state, team, geomHintsFor(state, team), new Float32Array(NN.NN_INPUT_DIM), perm));
}

function collect({ seed, turns, incumbent }) {
  const model = NN.parseWeights(fs.readFileSync(incumbent));
  const team = seed % 2, rows = [], history = [];
  let state = makeMatchState(seed, 'pulse');
  for (let t = 0; t < turns && state.winner === null; t++) {
    const config = { seed: seed + t * 17, history };
    const opponent = C.plan(state, 1 - team, { ...config, level: 'god' }).plans;
    const teacher = C.plan(state, team, { ...config, level: 'god' }).plans;
    const own = C.plan(state, team, { ...config, level: 'ballistic', nnModel: model, tracePolicy: true, traceFinalists: true });
    const trace = own.diagnostics.policy;
    const choices = [['teacher', teacher], ['ballistic', own.plans],
      ...trace.proposals.map((p, i) => ['proposal-' + i, p.plans]),
      ...trace.finalists.map((p, i) => [p.lineage?.refined ? 'refinement-' + i : 'finalist-' + i, p.plans])];
    const replies = [opponent, ...buildOpponentResponses(state, team, false, 4)];
    const uniqueReplies = [...new Map(replies.map(p => [JSON.stringify(M.validatePlans(p)), p])).values()];
    const perm = [0, 1, 2], obs = observation(state, team, perm);
    NN.forward(obs, false, model);
    const hidden = Array.from(model.h0);
    const candidates = new Map();
    for (const [source, plans] of choices) {
      const policy = Array.from(NN.encodePlans(plans, team, perm, new Float32Array(NN.NN_POLICY_DIM)));
      const key = JSON.stringify(policy);
      if (candidates.has(key)) { candidates.get(key).sources.push(source); continue; }
      const outcomes = uniqueReplies.map(reply => {
        const run = runReply(state, team, plans, reply);
        return { goals: run.result.goals, net: run.result.netGoals,
          endpoint: run.steps.length > 1 ? observation(run.steps[1].state, team) : null };
      });
      candidates.set(key, { sources: [source], plans, policy, outcomes });
    }
    rows.push({ seed, team, turn: state.turn, obs, hidden, replies: uniqueReplies, candidates: [...candidates.values()] });
    const plans = team ? [...opponent, ...own.plans] : [...own.plans, ...opponent];
    history.push({ roundTurns: state.roundTurns, bodies: state.bodies, plans });
    state = M.resolveTurn(P, state, plans, { effects: false }).state;
    if (state.phase === 'goal') S.kickoff(state);
  }
  return rows;
}

async function jobs(items, threads, run) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(threads, items.length) }, async () => {
    while (cursor < items.length) {
      const job = items[cursor++];
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(__filename, { workerData: job });
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', code => { if (code) reject(new Error('Worker exited ' + code)); });
      });
      run(job, result);
    }
  }));
}

function summarizeGames(results) {
  const bySeed = new Map();
  const totals = { wins: 0, losses: 0, capped: 0, goals: [0, 0], meanMsPerTurn: [0, 0] };
  let turns = 0;
  for (const game of results) {
    const seat = Number(game.swapped);
    const outcome = game.capped ? 0 : game.winner === seat ? 1 : -1;
    totals[outcome > 0 ? 'wins' : outcome < 0 ? 'losses' : 'capped']++;
    const pair = bySeed.get(game.seed) ?? [];
    pair.push(outcome);
    bySeed.set(game.seed, pair);
    turns += game.turns;
    for (const i of [0, 1]) {
      const side = i === 0 ? seat : 1 - seat;
      totals.goals[i] += game.scores[side];
      totals.meanMsPerTurn[i] += game.turns * game.timing[side].meanMs;
    }
  }
  totals.meanMsPerTurn = totals.meanMsPerTurn.map(sum => Math.round(sum / turns));
  // Under exchangeability of the two profiles, swapping a whole pair reverses its net wins.
  // Zero contributes no evidence (split pairs and capped games).
  const nets = [...bySeed.values()].map(pair => pair.reduce((a, b) => a + b, 0));
  let distribution = new Map([[0, 1]]);
  for (const net of nets) {
    const next = new Map();
    for (const [value, prob] of distribution) for (const sign of [-1, 1]) {
      const key = value + sign * net;
      next.set(key, (next.get(key) ?? 0) + prob / 2);
    }
    distribution = next;
  }
  const observed = Math.abs(totals.wins - totals.losses);
  totals.pairedTwoSidedP = [...distribution].reduce((p, [net, prob]) => Math.abs(net) >= observed ? p + prob : p, 0);
  return totals;
}

async function main() {
  const args = parseArgs({ options: Object.fromEntries(Object.entries({
    out: null, incumbent: 'web/assets/ububall-net-pulse.bin', seed: '43001', train: '32',
    holdout: '8', turns: '8', pairs: '4', threads: '10', python: null, 'value-from': null
  }).map(([key, value]) => [key, value === null ? { type: 'string' } : { type: 'string', default: value }])) }).values;
  if (!args.out) throw new Error('Supply a fresh --out directory.');
  const [seed, train, holdout, turns, pairs, threads] = ['seed','train','holdout','turns','pairs','threads'].map(k => Number(args[k]));
  if (![seed, train, holdout, turns, pairs, threads].every(x => Number.isSafeInteger(x) && x > 0) ||
      seed + train + holdout + pairs > 0xffffffff) throw new Error('Invalid seed or count.');
  const dir = path.resolve(args.out);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.mkdirSync(dir);
  const range = (start, n) => Array.from({ length: n }, (_, i) => start + i);
  const save = (name, obj) => {
    const target = path.join(dir, name);
    fs.writeFileSync(target + '.tmp', JSON.stringify(obj) + '\n');
    fs.renameSync(target + '.tmp', target);
  };
  const incumbent = path.join(dir, 'incumbent.bin');
  if (args['value-from']) {
    const source = path.resolve(args['value-from']);
    const original = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
    const used = new Set(Object.values(original.seeds).flat()), test = range(seed, pairs);
    if (test.some(s => used.has(s))) throw new Error('Use independent seeds for the value test.');
    for (const name of ['incumbent.bin', 'one-turn.bin']) fs.copyFileSync(path.join(source, name), path.join(dir, name));
    const incumbentHash = createHash('sha256').update(fs.readFileSync(incumbent)).digest('hex');
    if (incumbentHash !== original.incumbentSHA256) throw new Error('Incumbent snapshot has changed.');
    save('manifest.json', { source, seeds: test, mode: 'pulse', physics: P.VERSION, incumbentSHA256: incumbentHash });
    return evaluate(dir, test, threads, [['one-turn', 'incumbent']], save);
  }
  fs.copyFileSync(args.incumbent, incumbent);
  if (!NN.parseWeights(fs.readFileSync(incumbent))) throw new Error('Incompatible incumbent.');
  const seeds = { train: range(seed, train), holdout: range(seed + train, holdout), match: range(seed + train + holdout, pairs) };
  save('manifest.json', { seeds, turns, mode: 'pulse', physics: P.VERSION, incumbentSHA256: createHash('sha256').update(fs.readFileSync(incumbent)).digest('hex') });
  await jobs([...seeds.train, ...seeds.holdout].map(seed => ({ seed, turns, incumbent })), threads,
    (job, result) => save('seed-' + job.seed + '.json', result));
  const python = args.python ? [args.python] : process.platform === 'win32' ? ['py', '-3.11'] : ['python3'];
  const fitted = spawnSync(python[0], [...python.slice(1), path.join(__dirname, 'fit-pulse-comparison.py'), dir], { stdio: 'inherit' });
  if (fitted.error || fitted.status !== 0) throw fitted.error || new Error('Policy comparison training failed.');
  await evaluate(dir, seeds.match, threads, [['comparison','control'], ['comparison','incumbent'], ['control','incumbent']], save);
}

async function evaluate(dir, seeds, threads, matchups, save) {
  const games = [], report = {};
  for (const names of matchups) {
    const profiles = names.map(name => ({ name, level: 'ballistic', weightsPath: path.join(dir, name + '.bin') }));
    for (const p of profiles) if (!NN.parseWeights(fs.readFileSync(p.weightsPath))) throw new Error('Invalid checkpoint ' + p.name);
    for (const seed of seeds) for (const swapped of [false,true]) games.push({ seed, profiles, swapped, mode:'pulse', fixedRosters:true, maxTurns:180 });
  }
  await jobs(games, threads, (job, game) => {
    const key = job.profiles.map(p => p.name).join('-vs-');
    (report[key] ??= []).push(game);
    save('matches.json', report);
  });
  const standings = Object.fromEntries(Object.entries(report).map(([name, games]) => [name, summarizeGames(games)]));
  save('standings.json', standings);
  console.table(standings);
}

module.exports = { summarizeGames };
if (isMainThread && require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
else if (!isMainThread && require.main === module) parentPort.postMessage(workerData.profiles ? S.match(workerData) : collect(workerData));
