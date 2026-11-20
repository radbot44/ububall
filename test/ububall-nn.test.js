'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const C = require('../shared/ububall-cpu.js');
const P = require('../shared/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const S = require('../scripts/cpu-simulation.cjs');
const { syncSlidesFromBodies, strikeAccess, coneCover } = require('../shared/cpu/evaluate.js');

function hintsFor(state, team) {
  syncSlidesFromBodies(state.bodies);
  const ball = state.bodies[6], ballR = ball.radius || 18;
  return {
    strikeOwn: strikeAccess(state.bodies, team, ball.x, ball.y, ballR),
    strikeOther: strikeAccess(state.bodies, 1 - team, ball.x, ball.y, ballR),
    coneOwn: coneCover(state.bodies, team, ball.x, ball.y, state.fouls),
    coneOther: coneCover(state.bodies, 1 - team, ball.x, ball.y, state.fouls)
  };
}

function buildSyntheticUbnnBuffer(hiddenDim = 32, physVersion = P.VERSION, seed = 77) {
  const D = C.NN_INPUT_DIM, H = hiddenDim;
  const totalParams =
    (D * H + H * 3) +
    2 * (H * H + H * 3) +
    (H * C.NN_VALUE_DIM + C.NN_VALUE_DIM) +
    (H * C.NN_POLICY_DIM + C.NN_POLICY_DIM);
  const ab = new ArrayBuffer(16 + totalParams * 2);
  const dv = new DataView(ab);
  dv.setUint32(0, C.NN_MAGIC, true);
  dv.setUint16(4, C.NN_FORMAT, true);
  dv.setUint16(6, H, true);
  dv.setUint16(8, D, true);
  dv.setUint16(10, 3, true);
  dv.setUint32(12, physVersion, true);

  const rng = C.randomSource(seed);
  // Write IEEE-754 float16 values deterministically
  const toF16Bits = val => {
    if (val === 0) return 0;
    const sign = val < 0 ? 0x8000 : 0;
    const av = Math.abs(val);
    const exp = Math.floor(Math.log2(av));
    const e = exp + 15;
    if (e <= 0) return sign;
    if (e >= 31) return sign | 0x7c00;
    const mant = Math.round((av / (2 ** exp) - 1) * 1024);
    return sign | (e << 10) | Math.min(1023, mant);
  };

  let idx = 0;
  const putBlock = (count, fn) => {
    for (let i = 0; i < count; i++) {
      dv.setUint16(16 + (idx++) * 2, toF16Bits(fn(i)), true);
    }
  };
  // Stem + b1 + b2: small random weights, 0 bias, 1 gamma, 0 beta
  putBlock(D * H, () => (rng() - 0.5) * 0.25);
  putBlock(H, () => 0);
  putBlock(H, () => 1);
  putBlock(H, () => 0);
  for (let b = 0; b < 2; b++) {
    putBlock(H * H, () => (rng() - 0.5) * 0.2);
    putBlock(H, () => 0);
    putBlock(H, () => 1);
    putBlock(H, () => 0);
  }
  putBlock(H * C.NN_VALUE_DIM, () => (rng() - 0.5) * 0.3);
  putBlock(C.NN_VALUE_DIM, i => (i === 0 ? 0.15 : i === 1 ? -0.1 : 0));
  putBlock(H * C.NN_POLICY_DIM, () => (rng() - 0.5) * 0.3);
  putBlock(C.NN_POLICY_DIM, i => (i % 6 === 2 ? 0.8 : 0));
  assert.equal(idx, totalParams);
  return ab;
}

test('UBNN v2 observes all skater stats and preserves team swap and vertical reflection', () => {
  const st0 = S.initialState(23, 'pulse');
  // Assign distinct asymmetrical positions, velocities, spins, daze, meters, and fouls
  const coords = [
    { x: 215, y: 275, vx: 180, vy: -95, omega: 6.5, daze: 0.22, meter: 100 },
    { x: 465, y: 155, vx: 310, vy: 140, omega: -8.0, daze: 0.05, meter: 45 },
    { x: 390, y: 445, vx: -60, vy: -110, omega: 3.2, daze: 0, meter: 82 },
    { x: 845, y: 320, vx: -120, vy: 65, omega: -4.0, daze: 0.18, meter: 60 },
    { x: 610, y: 210, vx: -250, vy: -80, omega: 9.5, daze: 0, meter: 100 },
    { x: 705, y: 455, vx: 90, vy: 130, omega: -2.5, daze: 0.30, meter: 15 }
  ];
  coords.forEach((c, i) => {
    const b = st0.bodies[i];
    Object.assign(b, c, {
      stunned: i === 2, stunnedNext: i === 1, ironGuard: i === 0, superHoldTicks: 80 * (i + 1),
      shockwaveFired: i === 5, usedSuperThisTurn: i % 2 === 0, superBonusRefund: 2 * (i + 1),
      holding: i === 1, personality: { aggression: i, creativity: 23 + i, teamwork: 44 - i, clutch: 63 - i }
    });
    st0.stats[i].efficiency = 255 - 40 * i;
  });
  Object.assign(st0.bodies[1], { equippedSuper: P.SUPERS[2], superActive: 'sticky', superTicks: 360 });
  Object.assign(st0.bodies[6], {
    x: 560, y: 235, vx: 440, vy: -190, omega: 11.0, onFire: true, fireTicks: 30, pace: 860,
    strikerTeam: 0, strikerSynergy: 1.25, openingShot: true, stickOffset: { x: 28, y: -22 }
  });
  st0.scores = [3, 1];
  st0.roundTurns = 6;
  st0.fouls = { crease: [true, false], corner: 1, cornerTurns: 1, cards: [], faceoff: false };

  // Construct exact horizontal team-swapped mirror (Team 0 <-> Team 1, x -> 1000 - x, vx -> -vx, omega -> -omega)
  const stMirrorX = structuredClone(st0);
  for (let i = 0; i < 3; i++) {
    const a = stMirrorX.bodies[i], b = stMirrorX.bodies[i + 3];
    for (const body of [a, b]) {
      body.x = 1000 - body.x;
      body.vx = -body.vx;
      body.omega = -body.omega;
    }
    stMirrorX.bodies[i] = b;
    stMirrorX.bodies[i + 3] = a;
    b.team = 0;
    a.team = 1;
    [stMirrorX.stats[i], stMirrorX.stats[i + 3]] = [stMirrorX.stats[i + 3], stMirrorX.stats[i]];
  }
  const mb = stMirrorX.bodies[6];
  mb.x = 1000 - mb.x;
  mb.vx = -mb.vx;
  mb.omega = -mb.omega;
  mb.strikerTeam = 1;
  mb.stickOffset.x *= -1;
  stMirrorX.scores = [st0.scores[1], st0.scores[0]];
  stMirrorX.fouls = { crease: [false, true], corner: 0, cornerTurns: 1, cards: [], faceoff: false };

  const obs0 = new Float32Array(C.NN_INPUT_DIM), perm0 = [0, 1, 2];
  const obs1 = new Float32Array(C.NN_INPUT_DIM), perm1 = [0, 1, 2];
  C.encodeState(st0, 0, hintsFor(st0, 0), obs0, perm0);
  C.encodeState(stMirrorX, 1, hintsFor(stMirrorX, 1), obs1, perm1);

  assert.deepEqual(perm0, perm1);
  for (let k = 0; k < C.NN_INPUT_DIM; k++) {
    assert.ok(obs0[k] === obs1[k], `obs[${k}] horizontal symmetry mismatch: ${obs0[k]} vs ${obs1[k]}`);
  }

  const skaterFloats = 47;
  const ballStart = 6 * skaterFloats;
  const permOpp = [0, 1, 2];
  assert.equal(C.encodeState(st0, 1, null, undefined, permOpp)[ballStart + 12], -1);
  const order = [...perm0, ...permOpp.map(i => i + 3)];
  for (const [r, i] of order.entries()) {
    const b = st0.bodies[i], base = r * skaterFloats;
    assert.equal(obs0[base + 5], b.stunned ? 0 : 1);
    assert.equal(obs0[base + 7], Number(b.stunned));
    assert.deepEqual(obs0.slice(base + 14, base + 20), Float32Array.of(
      (b.baseRadius - 25) / 12.5, (b.baseMass - 3) / 1.5, (P.launchSpeed(b) - 720) / 360,
      (b.baseReach - 25) / 12.5, b.power - 1, b.curveMult - 1
    ));
    assert.deepEqual(obs0.slice(base + 28, base + 47), Float32Array.of(
      b.baseFriction / 150 - 1, b.maxSpin / P.BASE_MAX_SPIN - 1, b.grip / .3 - 1,
      b.baseBounciness - 1, b.baseStrength - 1, b.baseStability - 1, M.superStat(P, st0.stats[i].efficiency) - 1,
      b.synergyMult - 1, b.chemistryMult - 1, b.personality.aggression / 63, b.personality.creativity / 63,
      b.personality.teamwork / 63, b.personality.clutch / 63, Number(b.stunnedNext), Number(b.ironGuard),
      b.superHoldTicks / 480, Number(b.shockwaveFired), Number(b.usedSuperThisTurn), b.superBonusRefund / 20
    ));
  }
  assert.deepEqual(obs0.slice(ballStart + 12, ballStart + 17), Float32Array.of(1, .25, 1, 28 / 50, -22 / 50));

  const classic = structuredClone(st0);
  classic.mode = 'classic';
  classic.bodies[1].holding = false;
  classic.bodies[6].strikerTeam = -1;
  const classicObs = C.encodeState(classic, 0);
  assert.deepEqual(classicObs.slice(ballStart + 12, ballStart + 17), Float32Array.of(0, .25, 1, 0, 0));
  for (let base = 0; base < ballStart; base += skaterFloats) {
    assert.equal(classicObs[base + 34], 0, 'Classic has no efficiency contribution');
    assert.deepEqual(classicObs.slice(base + 37, base + 41), obs0.slice(base + 37, base + 41));
    assert.deepEqual(classicObs.slice(base + 43, base + 47), new Float32Array(4));
  }

  // Verify vertical reflection (y -> 600 - y, vy -> -vy, omega -> -omega) matches Y_FLIP_OBS_INDICES
  const stMirrorY = structuredClone(st0);
  for (const b of stMirrorY.bodies) {
    b.y = 600 - b.y;
    b.vy = -b.vy;
    b.omega = -b.omega;
  }
  stMirrorY.bodies[6].stickOffset.y *= -1;
  stMirrorY.fouls.corner = 3; // top-right (1) reflects to bottom-right (3), still opponent end
  const obsY = new Float32Array(C.NN_INPUT_DIM), permY = [0, 1, 2];
  C.encodeState(stMirrorY, 0, hintsFor(stMirrorY, 0), obsY, permY);
  assert.deepEqual(perm0, permY);
  const flipSet = new Set(C.Y_FLIP_OBS_INDICES);
  for (let k = 0; k < C.NN_INPUT_DIM; k++) {
    const expected = flipSet.has(k) ? -obs0[k] : obs0[k];
    assert.ok(obsY[k] === expected, `obs[${k}] vertical symmetry mismatch: ${obsY[k]} vs ${expected}`);
  }

  // Verify plan encode -> decode round-trip & horizontal reflection
  const samplePlans = [
    { angle: 0.42, power: 0.88, spin: -0.65, superArm: true, guard: false },
    { angle: 5.75, power: 0.55, spin: 0.40, superArm: false, guard: false },
    { angle: 0, power: 0, spin: 0, superArm: false, guard: true }
  ];
  const mirrorPlans = samplePlans.map(p => (p.guard ? { ...p } : {
    ...p,
    angle: ((Math.PI - p.angle) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI),
    spin: -p.spin
  }));
  const enc0 = C.encodePlans(samplePlans, 0, perm0, new Float32Array(18));
  const enc1 = C.encodePlans(mirrorPlans, 1, perm1, new Float32Array(18));
  for (let k = 0; k < 18; k++) {
    assert.ok(Math.abs(enc0[k] - enc1[k]) < 1e-6, `plan[${k}] horizontal symmetry mismatch: ${enc0[k]} vs ${enc1[k]}`);
  }
});

test('UBNN fp16 parser, bitwise half-float fallback, version guard, nn:"only", and hybrid search work cleanly', t => {
  t.after(() => C.clearWeights());
  const buf = buildSyntheticUbnnBuffer(32, P.VERSION, 99);

  // Bitwise IEEE-754 fallback matches native getFloat16
  const mNative = C.parseWeights(buf);
  const mBitwise = C.parseWeights(buf, { forceBitwise: true });
  assert.equal(mNative.H, 32);
  assert.deepEqual(Array.from(mNative.sW.slice(0, 64)), Array.from(mBitwise.sW.slice(0, 64)));

  // Mismatched physics version gracefully returns null without throwing
  const staleBuf = buildSyntheticUbnnBuffer(32, P.VERSION + 1, 99);
  assert.equal(C.parseWeights(staleBuf), null);
  const legacyBuf = buf.slice(0);
  new DataView(legacyBuf).setUint16(4, 1, true);
  assert.throws(() => C.parseWeights(legacyBuf), /Unsupported UBNN model shape/);
  const invalidBuf = buf.slice(0);
  new DataView(invalidBuf).setUint16(16, 0x7c00, true);
  assert.throws(() => C.parseWeights(invalidBuf), /Non-finite UBNN weights/);

  // Load weights & test nn: 'only' zero-rollout mode + hybrid rollout mode
  C.loadWeights(buf);
  assert.equal(C.hasWeights(), true);

  const state = S.initialState(11, 'standard');
  state.bodies[1].stunned = true;
  const only0 = C.plan(state, 0, { level: 'hard', nn: 'only', seed: 5 });
  const only0Repeat = C.plan(state, 0, { level: 'hard', nn: 'only', seed: 5 });
  assert.deepEqual(only0.plans, only0Repeat.plans);
  assert.equal(only0.diagnostics.simulations, 0);
  assert.equal(only0.diagnostics.nn, 'only');
  assert.equal(only0.plans[1].power, 0, 'stunned skater remains stationary in nn:"only" mode');
  M.validatePlans(only0.plans);

  // All five other presets ignore installed weights unless explicitly requested.
  const levels = Object.keys(C.LEVELS).filter(level => level !== 'ballistic');
  C.clearWeights();
  const baselines = levels.map(level => C.plan(state, 1, { level, seed: 8 }));
  C.loadWeights(buf);
  for (const [i, level] of levels.entries()) {
    const actual = C.plan(state, 1, { level, seed: 8 });
    assert.deepEqual(actual.plans, baselines[i].plans, level);
    assert.equal(actual.diagnostics.score, baselines[i].diagnostics.score, level);
    assert.equal(actual.diagnostics.nn, undefined, level);
  }

  const hybridA = C.plan(state, 1, { level: 'medium', seed: 8, nn: true, nnWeight: 0.5 });
  const hybridB = C.plan(state, 1, { level: 'medium', seed: 8, nn: true, nnWeight: 0.5 });
  assert.deepEqual(hybridA.plans, hybridB.plans);
  assert.equal(hybridA.diagnostics.nn, true);
  M.validatePlans(hybridA.plans);
});

function startCpuWorker(assets) {
  const requests = [];
  let message, modelWidth;
  const self = { postMessage(data) { message = data; } };
  const source = fs.readFileSync(path.resolve(__dirname, '../web/ububall-cpu-worker.js'), 'utf8');
  vm.runInNewContext(source, {
    self, importScripts() {}, ububallMatch: M,
    ububallCPU: {
      ...C,
      plan(state, team, config) {
        modelWidth = config.nnModel?.H;
        return C.plan(state, team, config);
      }
    },
    async fetch(url) {
      const name = url.replace(/^assets\//, '');
      requests.push(name);
      return { ok: Object.hasOwn(assets, name), async arrayBuffer() { return assets[name]; } };
    }
  });
  return {
    requests,
    async probe(pulse) {
      await self.onmessage({ data: { checkNeuralWeights: true, pulse } });
      return message.hasNeuralWeights;
    },
    async plan(mode, level) {
      const data = { state: S.initialState(1, mode), config: { level, candidates: 1, counterBudget: 0, lookaheadTop: 0 } };
      await self.onmessage({ data });
      return { level: message.result.diagnostics.level, modelWidth };
    }
  };
}

test('CPU worker picks and caches specialist weights for the match rules', async () => {
  const standard = 'ububall-net-standard.bin', pulse = 'ububall-net-pulse.bin';
  const worker = startCpuWorker({
    [standard]: buildSyntheticUbnnBuffer(32),
    [pulse]: buildSyntheticUbnnBuffer(48),
    'ububall-net.bin': buildSyntheticUbnnBuffer(64)
  });
  await worker.plan('standard', 'god');
  assert.deepEqual(worker.requests, [], 'heuristic requests skip weight loading');
  assert.deepEqual(await worker.plan('standard', 'ballistic'), { level: 'ballistic', modelWidth: 32 });
  assert.deepEqual(await worker.plan('pulse', 'ballistic'), { level: 'ballistic', modelWidth: 48 });
  assert.deepEqual(await worker.plan('classic-pulse-blitz', 'ballistic'), { level: 'ballistic', modelWidth: 48 });
  assert.deepEqual(await worker.plan('classic-blitz', 'ballistic'), { level: 'ballistic', modelWidth: 32 });
  assert.equal(await worker.probe(false), true);
  assert.equal(await worker.probe(true), true);
  assert.deepEqual(worker.requests, [standard, pulse]);
});

test('CPU worker uses playable general weights as fallback and keeps other modes isolated', async () => {
  const standard = 'ububall-net-standard.bin', pulse = 'ububall-net-pulse.bin', general = 'ububall-net.bin';
  const valid = buildSyntheticUbnnBuffer();
  const invalid = valid.slice(0);
  new DataView(invalid).setUint16(16, 0x7e00, true);
  const fallback = startCpuWorker({ [standard]: invalid, [general]: buildSyntheticUbnnBuffer(64) });
  assert.equal(await fallback.probe(false), true);
  assert.equal(await fallback.probe(true), true);
  assert.deepEqual(await fallback.plan('standard', 'ballistic'), { level: 'ballistic', modelWidth: 64 });
  assert.deepEqual(await fallback.plan('pulse', 'ballistic'), { level: 'ballistic', modelWidth: 64 });
  assert.deepEqual(fallback.requests, [standard, general, pulse]);

  const missing = startCpuWorker({ [standard]: valid, [pulse]: buildSyntheticUbnnBuffer(48, P.VERSION + 1), [general]: invalid });
  assert.equal(await missing.probe(false), true);
  assert.equal(await missing.probe(true), false);
  assert.deepEqual(await missing.plan('standard', 'ballistic'), { level: 'ballistic', modelWidth: 32 });
  assert.deepEqual(await missing.plan('pulse', 'ballistic'), { level: 'god', modelWidth: undefined });
  assert.deepEqual(missing.requests, [standard, pulse, general]);
});

test('mixed teachers cover Classic-Pulse and split complete matches before scheduling', () => {
  const { buildJobs } = require('../scripts/nn-generate.cjs');
  const jobs = buildJobs({ mode: 'pulse-pack', matches: 100, seed: 910, preset: 'mixed', turns: 70 });
  const classic = jobs.filter(job => job.mode === 'classic-pulse');
  assert.equal(classic.length, 20);
  assert.equal(classic.filter(job => job.presetName === 'god').length, 2);
  assert.equal(jobs.filter(job => job.split === 'val').length, 10);
  assert.ok(jobs.every(job => job.maxTurns === 180));
});

test('paired comparison counts caps separately and swaps the winner back into profile order', () => {
  const { summarizeGames } = require('../scripts/nn-pulse-comparison.cjs');
  const { summarizeGroup } = require('../scripts/nn-eval.cjs');
  const base = { scores: [1, 5], turns: 20, timing: [{ meanMs: 10 }, { meanMs: 30 }] };
  const result = summarizeGames([
    { ...base, seed: 1, swapped: false, winner: 0, capped: false },
    { ...base, seed: 1, swapped: true, winner: 1, capped: false },
    { ...base, seed: 2, swapped: false, winner: null, capped: true },
    { ...base, seed: 2, swapped: true, winner: 0, capped: false }
  ]);
  assert.deepEqual([result.wins, result.losses, result.capped, result.pairedTwoSidedP], [2, 1, 1, 1]);
  assert.deepEqual(result.meanMsPerTurn, [20, 20]);
  const capped = summarizeGroup([{ wins: 0, draws: 0, losses: 0, capped: 2, turns: 2, nnMs: 0, godMs: 0, nnGoals: 3, godGoals: 0 }]);
  assert.deepEqual([capped.matches, capped.scorePct, capped.elo], [2, null, null]);
});

test('end-to-end pipeline: nn-generate.cjs -> train-nn.py -> exported UBNN weights run in CPU planner', t => {
  t.after(() => C.clearWeights());
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ububall-nn-e2e-'));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const shardDir = path.join(tmpDir, 'shards');
  const binOut = path.join(tmpDir, 'ububall-net.bin');
  const repOut = path.join(tmpDir, 'report.json');

  const genRun = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../scripts/nn-generate.cjs'), '--matches', '4', '--turns', '16', '--preset', 'fast', '--threads', '2', '--out', shardDir],
    { encoding: 'utf8' }
  );
  assert.equal(genRun.status, 0, genRun.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(shardDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.physVersion, P.VERSION);
  assert.equal(manifest.format, 2);
  assert.equal(manifest.inputDim, 315);
  assert.equal(manifest.rowFloats, 335);
  assert.ok(manifest.totalRows >= 16);
  const nextGoal = C.NN_INPUT_DIM + C.NN_POLICY_DIM;
  for (const shard of manifest.shards) {
    const rows = fs.readFileSync(path.join(shardDir, shard.file));
    assert.equal(rows.length, shard.rows * C.NN_ROW_FLOATS * 4);
    for (let i = 0; i + 1 < shard.rows; i += 2) {
      const own = i * C.NN_ROW_FLOATS, opp = own + C.NN_ROW_FLOATS;
      const goal = rows.readFloatLE((own + nextGoal) * 4);
      const oppGoal = rows.readFloatLE((opp + nextGoal) * 4);
      assert.ok(
        (goal === -oppGoal && [-1, 0, 1].includes(goal)) || (goal === -2 && oppGoal === -2),
        `unexpected pair nextGoal: ${goal} vs ${oppGoal}`
      );
      const turns = rows.readFloatLE((own + nextGoal + 1) * 4);
      assert.equal(turns, rows.readFloatLE((opp + nextGoal + 1) * 4));
      assert.ok(Number.isInteger(turns) && turns >= 0 && turns < 16);
    }
  }

  const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
  const trainer = path.resolve(__dirname, '../scripts/train-nn.py');
  const manifestPath = path.join(shardDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, format: 1 }));
  const legacyRun = spawnSync(pyCmd, [trainer, '--shards', shardDir, '--out', binOut, '--report', repOut], { encoding: 'utf8' });
  assert.notEqual(legacyRun.status, 0);
  assert.match(legacyRun.stderr, /Incompatible UBNN shard manifest/);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const schemaRun = spawnSync(pyCmd, ['-c',
    'import json, runpy, sys; d = runpy.run_path(sys.argv[1]); print(json.dumps([d["Y_FLIP_OBS"], d["Y_FLIP_POL"]]))', trainer
  ], { encoding: 'utf8' });
  assert.equal(schemaRun.status, 0, schemaRun.stderr);
  assert.deepEqual(JSON.parse(schemaRun.stdout), [C.Y_FLIP_OBS_INDICES, C.Y_FLIP_POL_INDICES]);

  const trainRun = spawnSync(
    pyCmd,
    [trainer, '--shards', shardDir, '--out', binOut, '--report', repOut, '--hidden', '64', '--epochs', '3', '--batch-size', '32'],
    { encoding: 'utf8' }
  );
  assert.equal(trainRun.status, 0, trainRun.stderr || trainRun.stdout);
  assert.ok(fs.existsSync(binOut));
  const report = JSON.parse(fs.readFileSync(repOut, 'utf8'));
  assert.equal(report.physVersion, P.VERSION);
  assert.equal(report.trainRows + report.valRows, manifest.totalRows);
  assert.equal(report.valRows, manifest.shards.flatMap(shard => shard.games)
    .filter(game => game.split === 'val').reduce((sum, game) => sum + game.rows, 0));

  const rawBuf = fs.readFileSync(binOut);
  const loaded = C.loadWeights(rawBuf);
  assert.ok(loaded && loaded.H === 64);

  const st = S.initialState(3, 'standard');
  const fastPlan = C.plan(st, 1, { nn: 'only', seed: 1 });
  const hybPlan = C.plan(st, 1, { level: 'ballistic', seed: 1 });
  const repeated = C.plan(st, 1, { level: 'ballistic', seed: 1 });
  M.validatePlans(fastPlan.plans);
  M.validatePlans(hybPlan.plans);
  assert.equal(hybPlan.diagnostics.level, 'ballistic');
  assert.equal(hybPlan.diagnostics.nn, true);
  assert.equal(hybPlan.diagnostics.candidates, C.LEVELS.god.candidates);
  assert.ok(hybPlan.diagnostics.simulations > 0);
  assert.deepEqual(hybPlan.plans, repeated.plans);
  assert.equal(hybPlan.diagnostics.score, repeated.diagnostics.score);
});

test('Standard settled-turn projection, blitz zeroing, pulse roundTurns scaling, and worker probe reuse', async () => {
  const st = S.initialState(29, 'standard');
  st.roundTurns = 24;
  // Skater 0 was stunned this turn (clears next turn), skater 1 gets stunned next turn, skater 2 whiffed a super.
  Object.assign(st.bodies[0], { stunned: true, stunnedNext: false, vx: 120, vy: -80, omega: 4 });
  Object.assign(st.bodies[1], {
    stunned: false, stunnedNext: true, holding: true, guarding: true, ironGuard: true,
    ironCooldownTicks: 24, superActive: 'sticky', superTicks: 300, superHoldTicks: 180,
    shockwaveFired: true, usedSuperThisTurn: true, superHit: false, superRefunded: false,
    meter: 10, equippedSuper: { ...P.SUPERS[2], level: 2, bonusRefund: 6 }, superBonusRefund: 6
  });
  Object.assign(st.bodies[6], {
    vx: 300, vy: -150, omega: 6, onFire: true, fireTicks: 40, pace: 900,
    curveMult: 1.25, strikerPower: 1.2, strikerTeam: 0, strikerSynergy: 1.15,
    openingShot: true, stickOffset: { x: 20, y: -10 }
  });

  const perm = [0, 1, 2];
  const projObs = C.encodeObservation(st.bodies, st.fouls, 0, {
    mode: 'blitz', stats: st.stats, scores: st.scores, roundTurns: 24, zeroSettledVel: true
  }, new Float32Array(C.NN_INPUT_DIM), perm);

  const skaterFloats = 47;
  const ballStart = 6 * skaterFloats;
  const matchStart = ballStart + 17;

  // Blitz channel stays 0; Standard roundTurns uses /40.
  assert.equal(projObs[matchStart + 2], 0);
  assert.ok(Math.abs(projObs[matchStart + 6] - 24 / 40) < 1e-6);

  // Pulse roundTurns uses /120.
  const pulseObs = C.encodeState({ ...st, mode: 'pulse-blitz', roundTurns: 24 }, 0, null, new Float32Array(C.NN_INPUT_DIM));
  assert.equal(pulseObs[matchStart + 2], 0);
  assert.ok(Math.abs(pulseObs[matchStart + 6] - 24 / 120) < 1e-6);

  // Skater 1 (stunnedNext) promoted to stunned, transient flags cleared, and whiff+bonus refund applied.
  const r1 = perm.indexOf(1);
  const b1 = r1 * skaterFloats;
  assert.equal(projObs[b1 + 5], 0);
  assert.equal(projObs[b1 + 7], 1);
  assert.equal(projObs[b1 + 10], 0); // holding
  assert.equal(projObs[b1 + 11], 0); // guarding
  assert.equal(projObs[b1 + 12], 0); // ironCooldownTicks
  assert.equal(projObs[b1 + 13], 0); // superActive
  assert.equal(projObs[b1 + 41], 0); // stunnedNext
  assert.equal(projObs[b1 + 42], 0); // ironGuard
  assert.equal(projObs[b1 + 43], 0); // superHoldTicks
  assert.equal(projObs[b1 + 44], 0); // shockwaveFired
  assert.equal(projObs[b1 + 45], 0); // usedSuperThisTurn
  const expectedMeter = Math.min(100, 10 + 6 + P.SUPER.whiffRefund) / 100;
  assert.ok(Math.abs(projObs[b1 + 9] - expectedMeter) < 1e-6);

  // Skater 0's expiring Turn-1 stun is cleared.
  const r0 = perm.indexOf(0);
  assert.equal(projObs[r0 * skaterFloats + 5], 1);
  assert.equal(projObs[r0 * skaterFloats + 7], 0);

  // Transient ball fields cleared.
  for (const idx of [2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16]) {
    assert.equal(projObs[ballStart + idx], 0, `ball[${idx}] should clear on settled projection`);
  }

  // CPU client reuses the probed worker on the subsequent plan() call.
  const createCPUClient = require('../web/ububall-cpu-client.js');
  let spawned = 0, terminated = 0;
  const client = createCPUClient(() => {
    spawned++;
    const w = {
      onmessage: null, onerror: null, onmessageerror: null,
      postMessage(msg) {
        queueMicrotask(() => {
          if (msg.checkNeuralWeights) w.onmessage?.({ data: { hasNeuralWeights: true } });
          else w.onmessage?.({ data: { result: { plans: [], diagnostics: {} } } });
        });
      },
      terminate() { terminated++; }
    };
    return w;
  });
  assert.equal(await client.hasNeuralWeights(false), true);
  assert.equal(spawned, 1);
  assert.equal(terminated, 0);
  const res = await client.plan(st, { level: 'ballistic' }, 1);
  assert.ok(res && Array.isArray(res.plans));
  assert.equal(spawned, 1, 'plan() should reuse the warm worker from hasNeuralWeights()');
  client.dispose();
  assert.equal(terminated, 1);
});
