'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const C = require('../shared/ububall-cpu.js');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const R = require('../shared/ububall-replay.js');
const U = require('../shared/ubu.js');
const S = require('./cpu-simulation.cjs');
const { roles } = require('../shared/cpu/constants.js');
const { buildOpponentResponses } = require('../shared/cpu/opponent.js');
const { planBasinKey } = require('../shared/cpu/evaluate.js');

const origins = ['god', 'policy', 'ballistic'];
const ablations = {
  'without-own-policy': { nnPolicy: false },
  'without-opponent-policy': { nnOpponent: false },
  'without-value': { nnWeight: 0 }
};
const resolve = (state, moves) => M.resolveTurn(P, state, moves, { effects: false });
const joinPlans = (team, own, opponent) => team ? [...opponent, ...own] : [...own, ...opponent];
const signedGoal = (goal, team) => goal === null ? 0 : goal === team ? 1 : -1;

function makeState(seed, mode) {
  const state = S.initialState(seed, mode);
  state.fouls = M.newFouls();
  return state;
}

function runReply(state, team, plans, reply) {
  const moves = joinPlans(team, plans, reply);
  const first = resolve(state, moves);
  const steps = [{ state, moves }];
  const outcomes = [first];
  if (first.replay.goal === null && M.rule(state.mode, 'pulse')) {
    const next = first.state;
    const follow = [...C.legacy(next, 0), ...C.legacy(next, 1)];
    steps.push({ state: next, moves: follow });
    outcomes.push(resolve(next, follow));
  }
  const last = outcomes.at(-1).state;
  return {
    steps,
    result: {
      goals: outcomes.map(result => result.replay.goal),
      netGoals: outcomes.reduce((sum, result) => sum + signedGoal(result.replay.goal, team), 0),
      ownCards: outcomes.reduce((sum, result) => sum + result.state.fouls.cards.filter(i => Math.floor(i / 3) === team).length, 0),
      ownCreaseWarning: last.fouls.crease[team],
      ball: { x: last.bodies[6].x, y: last.bodies[6].y }
    }
  };
}

function comparePosition(state, team, source, seed, index, nnModel, history) {
  const config = { seed: seed + state.turn * 17, history };
  const god = C.plan(state, team, { level: 'god', ...config });
  const policy = C.plan(state, team, { nn: 'only', nnModel, ...config });
  const ballisticConfig = { level: 'ballistic', nnModel, ...config };
  const ballistic = C.plan(state, team, { ...ballisticConfig, tracePolicy: true });
  const plans = { god: god.plans, policy: policy.plans, ballistic: ballistic.plans };
  for (const [name, options] of Object.entries(ablations)) plans[name] = C.plan(state, team, { ...ballisticConfig, ...options }).plans;

  const opponent = C.plan(state, 1 - team, { level: 'god', ...config }).plans;
  const replies = new Map([[planBasinKey(opponent), { name: 'god', plans: opponent }]]);
  const replyNames = ['heuristic', 'guard-or-bank', 'shot-and-check', 'coordinated'];
  const portfolio = buildOpponentResponses(state, team, M.rule(state.mode, 'classic'), replyNames.length);
  for (const [i, reply] of portfolio.entries()) {
    const key = planBasinKey(reply);
    if (!replies.has(key)) replies.set(key, { name: replyNames[i], plans: reply });
  }

  const comparisons = [], clips = [];
  for (const reply of replies.values()) {
    const byPlanner = {};
    for (const [name, moves] of Object.entries(plans)) byPlanner[name] = runReply(state, team, moves, reply.plans);
    comparisons.push({ ...reply, outcomes: Object.fromEntries(Object.entries(byPlanner).map(([name, run]) => [name, run.result])) });
    const swing = byPlanner.policy.result.netGoals - byPlanner.god.result.netGoals;
    if (swing) clips.push({ reply: reply.name, swing, policy: byPlanner.policy.steps, god: byPlanner.god.steps });
  }

  const tags = [];
  const threat = C.assessOpponentThreat(state, team);
  const ball = state.bodies[6];
  if (source.startsWith('fixture-')) tags.push(source.slice(8));
  else if (!state.roundTurns) tags.push('kickoff');
  if (threat.incoming?.crosses) tags.push('incoming-shot');
  if (threat.shotDanger) tags.push('opponent-threat');
  if (Math.hypot(ball.vx, ball.vy) > 55 && !ball.stickOffset) tags.push('moving-loose-ball');
  if (!ball.stickOffset && Math.min(threat.bestOwnT, threat.bestOppT) < .45 &&
      Math.abs(threat.bestOwnT - threat.bestOppT) < .12) tags.push('loose-ball-race');
  if (state.bodies.slice(0, 6).some(b => b.superActive)) tags.push('active-super');
  if (state.bodies.slice(team * 3, team * 3 + 3).some(b => b.meter >= 100 && b.equippedSuper)) tags.push('own-super-ready');
  if (!tags.length) tags.push('settled-field');
  const row = {
    id: `${state.mode}-${seed}-${source}-${index}`, mode: state.mode, seed, source, turn: state.turn, team,
    tags: [...new Set(tags)], roles: roles(state, team), plans,
    position: { scores: state.scores, bodies: R.snapshot(state.bodies), fouls: state.fouls, stats: state.stats },
    policyTrace: ballistic.diagnostics.policy, replies: comparisons
  };
  return { row, clips, nextMoves: joinPlans(team, plans[source] ?? god.plans, opponent) };
}

function runJob(job) {
  const { mode, seed, source, positions, team, weights } = job;
  const nnModel = C.parseWeights(fs.readFileSync(weights));
  if (!nnModel) throw new Error(`Physics version mismatch in ${weights}`);
  if (source === 'fixtures') {
    const rows = S.scenarios().map(({ name, state: layout }, i) => {
      const state = makeState(seed, mode);
      state.bodies.forEach((body, j) => { body.x = layout.bodies[j].x; body.y = layout.bodies[j].y; });
      return comparePosition(state, 1, `fixture-${name}`, seed, i, nnModel);
    });
    if (mode === 'pulse') {
      const state = makeState(seed, mode);
      Object.assign(state.bodies[6], { x: 725, y: 300, vx: 650, strikerTeam: 0 });
      state.roundTurns = 3;
      rows.push(comparePosition(state, 1, 'fixture-incoming-shot', seed, rows.length, nnModel));
    }
    return rows;
  }
  let state = makeState(seed, mode);
  const rows = [], history = [];
  for (let i = 0; i < positions && state.winner === null; i++) {
    let moves;
    // The opening position is shared by all three trajectories. Count it once per seed.
    if (i === 0 && source !== 'god') {
      const config = { seed: seed + state.turn * 17 };
      const profile = source === 'policy' ? { nn: 'only', nnModel } : { level: 'ballistic', nnModel };
      const own = C.plan(state, team, { ...config, ...profile }).plans;
      const opponent = C.plan(state, 1 - team, { ...config, level: 'god' }).plans;
      moves = joinPlans(team, own, opponent);
    } else {
      const result = comparePosition(state, team, source, seed, i, nnModel, history);
      rows.push(result);
      moves = result.nextMoves;
    }
    history.push({ roundTurns: state.roundTurns || 0, bodies: R.snapshot(state.bodies), plans: moves });
    state = resolve(state, moves).state;
    if (state.phase === 'goal') S.kickoff(state);
  }
  return rows;
}

function summarize(rows, left, right) {
  const totals = { positions: rows.length, replies: 0, better: 0, tied: 0, worse: 0, goalSwing: 0 };
  for (const row of rows) {
    let swing = 0;
    for (const { outcomes } of row.replies) swing += outcomes[left].netGoals - outcomes[right].netGoals;
    totals.replies += row.replies.length;
    totals.goalSwing += swing;
    totals[swing > 0 ? 'better' : swing < 0 ? 'worse' : 'tied']++;
  }
  return totals;
}

async function writeClip(file, title, row, steps) {
  const random = C.randomSource(row.seed);
  const ubus = steps[0].state.bodies.slice(0, 6).map(body => ({
    dna: U.toCode(Uint8Array.from({ length: 128 }, () => Math.floor(random() * 256))),
    super: body.equippedSuper?.id ?? null
  }));
  const names = row.team ? ['Reply', title] : [title, 'Reply'];
  const replay = R.create({ mode: row.mode, names, seat: row.team, ubus });
  replay.clip = true;
  replay.title = `${title} — ${row.tags[0]}`;
  for (const { state, moves } of steps) {
    const actual = M.resolveTurn(P, state, moves);
    const { plans, ticks, goal, scorer, assist, label, saves, stops } = actual.replay;
    const entry = R.addTurn(replay, { ...state, plans });
    for (const body of entry.bodies) if (!Number.isFinite(body.meterTick)) delete body.meterTick;
    Object.assign(entry, {
      ticks,
      goal: goal === null ? null : { team: goal, scorer: label === 'OWN GOAL' ? null : scorer, assist, label },
      cards: actual.state.fouls.cards,
      saves: saves.map(({ tick, index, own, iron }) => ({ tick, index, own, iron: Boolean(iron) })),
      stops
    });
  }
  const bytes = await R.write(replay);
  await R.read(bytes);
  fs.writeFileSync(file, bytes);
}

async function main() {
  const options = require('node:util').parseArgs({ options: {
    standard: { type: 'string' }, pulse: { type: 'string' }, out: { type: 'string' },
    seed: { type: 'string', default: '9001' }, seeds: { type: 'string', default: '1' },
    positions: { type: 'string', default: '6' }, threads: { type: 'string', default: '4' }
  } }).values;
  const [seed, seeds, positions, threads] = [options.seed, options.seeds, options.positions, options.threads].map(Number);
  if (!options.out || (!options.standard && !options.pulse) || ![seed, seeds, positions, threads].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Pass --out DIRECTORY and --standard FILE and/or --pulse FILE. Optional: --seed N --seeds N --positions N --threads N.');
  }
  const out = path.resolve(options.out);
  fs.mkdirSync(out, { recursive: true });
  const jobs = [];
  const modes = ['standard', 'pulse'].filter(mode => options[mode]);
  for (const mode of modes) {
    const weights = path.resolve(options[mode]);
    jobs.push({ mode, seed, source: 'fixtures', weights });
    for (let s = 0; s < seeds; s++) for (const [index, source] of origins.entries()) {
      jobs.push({ mode, seed: seed + s, source, positions, team: (index + s) % 2, weights });
    }
  }
  const batches = [];
  let nextJob = 0;
  await Promise.all(Array.from({ length: Math.min(threads, jobs.length, os.availableParallelism()) }, async () => {
    while (nextJob < jobs.length) {
      const i = nextJob++, job = jobs[i];
      batches[i] = await new Promise((accept, reject) => {
        const worker = new Worker(__filename, { workerData: { policyStudy: job } });
        worker.on('message', accept);
        worker.on('error', reject);
        worker.on('exit', code => { if (code) reject(new Error(`Study worker exited with status ${code}`)); });
      });
      console.error(`${job.mode} ${job.source} seed ${job.seed}: ${batches[i].length} positions`);
    }
  }));

  const samples = batches.flat();
  const rows = samples.map(sample => sample.row);
  const summary = Object.fromEntries(modes.map(mode => {
    const group = rows.filter(row => row.mode === mode);
    const selection = { direct: 0, tracedRefinement: 0, noTracedLineage: 0 };
    for (const row of group) {
      const match = row.policyTrace.selectedFrom;
      selection[match ? (match.refined ? 'tracedRefinement' : 'direct') : 'noTracedLineage']++;
    }
    return [mode, {
      policyVsGod: summarize(group, 'policy', 'god'),
      ballisticVsGod: summarize(group, 'ballistic', 'god'),
      policySelection: selection,
      ablations: Object.fromEntries(Object.keys(ablations).map(name => [name, summarize(group, 'ballistic', name)])),
      bySituation: Object.fromEntries([...new Set(group.flatMap(row => row.tags))].sort().map(tag => [tag, summarize(group.filter(row => row.tags.includes(tag)), 'policy', 'god')]))
    }];
  }));
  const examples = [];
  for (const mode of modes) for (const direction of [1, -1]) {
    const ranked = samples.filter(s => s.row.mode === mode).flatMap(({ row, clips }) => clips.map(clip => ({ row, clip })))
      .filter(({ clip }) => clip.swing * direction > 0).sort((a, b) => direction * (b.clip.swing - a.clip.swing));
    const picked = new Set();
    for (const { row, clip } of ranked) {
      if (picked.has(row.id)) continue;
      picked.add(row.id);
      const prefix = `${row.id}-${clip.reply}`;
      const policy = `${prefix}-policy.ububall`, god = `${prefix}-god.ububall`;
      await writeClip(path.join(out, policy), 'Pure policy', row, clip.policy);
      await writeClip(path.join(out, god), 'Ububall God', row, clip.god);
      examples.push({ id: row.id, tags: row.tags, reply: clip.reply, swing: clip.swing, policy, god });
      if (picked.size === 3) break;
    }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ seed, seeds, positionsPerGame: positions, summary, examples, rows }, null, 2) + '\n');
  console.log(JSON.stringify({ summary, examples }, null, 2));
}

module.exports = { runReply };

if (!isMainThread && workerData?.policyStudy) parentPort.postMessage(runJob(workerData.policyStudy));
else if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
