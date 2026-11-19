'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

test('196-float state encoder and plan encoder satisfy exact left-right team reflection and vertical reflection', () => {
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
  coords.forEach((c, i) => Object.assign(st0.bodies[i], c));
  Object.assign(st0.bodies[6], { x: 560, y: 235, vx: 440, vy: -190, omega: 11.0, onFire: true, fireTicks: 30, pace: 860 });
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
  stMirrorX.scores = [st0.scores[1], st0.scores[0]];
  stMirrorX.fouls = { crease: [false, true], corner: 0, cornerTurns: 1, cards: [], faceoff: false };

  const obs0 = new Float32Array(C.NN_INPUT_DIM), perm0 = [0, 1, 2];
  const obs1 = new Float32Array(C.NN_INPUT_DIM), perm1 = [0, 1, 2];
  C.encodeState(st0, 0, hintsFor(st0, 0), obs0, perm0);
  C.encodeState(stMirrorX, 1, hintsFor(stMirrorX, 1), obs1, perm1);

  assert.deepEqual(perm0, perm1);
  for (let k = 0; k < C.NN_INPUT_DIM; k++) {
    assert.ok(Math.abs(obs0[k] - obs1[k]) < 1e-6, `obs[${k}] horizontal symmetry mismatch: ${obs0[k]} vs ${obs1[k]}`);
  }

  // Verify vertical reflection (y -> 600 - y, vy -> -vy, omega -> -omega) matches Y_FLIP_OBS_INDICES
  const stMirrorY = structuredClone(st0);
  for (const b of stMirrorY.bodies) {
    b.y = 600 - b.y;
    b.vy = -b.vy;
    b.omega = -b.omega;
  }
  stMirrorY.fouls.corner = 3; // top-right (1) reflects to bottom-right (3), still opponent end
  const obsY = new Float32Array(C.NN_INPUT_DIM), permY = [0, 1, 2];
  C.encodeState(stMirrorY, 0, hintsFor(stMirrorY, 0), obsY, permY);
  assert.deepEqual(perm0, permY);
  const flipSet = new Set(C.Y_FLIP_OBS_INDICES);
  for (let k = 0; k < C.NN_INPUT_DIM; k++) {
    const expected = flipSet.has(k) ? -obs0[k] : obs0[k];
    assert.ok(Math.abs(obsY[k] - expected) < 1e-6, `obs[${k}] vertical symmetry mismatch: ${obsY[k]} vs ${expected}`);
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

  // Hybrid search stays deterministic and respects nn: false opt-out
  const baselineBefore = (() => {
    C.clearWeights();
    const r = C.plan(state, 1, { level: 'medium', seed: 8 });
    C.loadWeights(buf);
    return r;
  })();
  const optOut = C.plan(state, 1, { level: 'medium', seed: 8, nn: false });
  assert.deepEqual(optOut.plans, baselineBefore.plans);
  assert.equal(optOut.diagnostics.score, baselineBefore.diagnostics.score);

  const hybridA = C.plan(state, 1, { level: 'medium', seed: 8, nn: true, nnWeight: 0.5 });
  const hybridB = C.plan(state, 1, { level: 'medium', seed: 8, nn: true, nnWeight: 0.5 });
  assert.deepEqual(hybridA.plans, hybridB.plans);
  M.validatePlans(hybridA.plans);
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
  assert.ok(manifest.totalRows >= 16);

  const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
  const trainRun = spawnSync(
    pyCmd,
    [path.resolve(__dirname, '../scripts/train-nn.py'), '--shards', shardDir, '--out', binOut, '--report', repOut, '--hidden', '64', '--epochs', '3', '--batch-size', '32'],
    { encoding: 'utf8' }
  );
  assert.equal(trainRun.status, 0, trainRun.stderr || trainRun.stdout);
  assert.ok(fs.existsSync(binOut));
  const report = JSON.parse(fs.readFileSync(repOut, 'utf8'));
  assert.equal(report.physVersion, P.VERSION);

  const rawBuf = fs.readFileSync(binOut);
  const loaded = C.loadWeights(rawBuf);
  assert.ok(loaded && loaded.H === 64);

  const st = S.initialState(3, 'standard');
  const fastPlan = C.plan(st, 1, { nn: 'only', seed: 1 });
  const hybPlan = C.plan(st, 1, { level: 'hard', nn: true, seed: 1 });
  M.validatePlans(fastPlan.plans);
  M.validatePlans(hybPlan.plans);
});
