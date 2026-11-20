/* Team-canonical state encoder, policy move decoder, and fp16 inference. */
'use strict';
const {
  P, M, HOLD, TWO_PI, RINK_LEFT, RINK_RIGHT, RINK_CX, RINK_CY
} = require('./constants.js');

const NN_MAGIC = 0x4e4e4255; // ASCII "UBNN" little-endian
const NN_FORMAT = 2;
const SKATER_FLOATS = 47;
const BALL_START = 6 * SKATER_FLOATS;
const MATCH_START = BALL_START + 17;
const NN_INPUT_DIM = MATCH_START + 16;
const NN_HIDDEN_DIM = 256;
const NN_VALUE_DIM = 3;
const NN_POLICY_DIM = 18;
const NN_ROW_FLOATS = NN_INPUT_DIM + NN_POLICY_DIM + 2; // nextGoal, turnsToGoal

const SUPER_KEYS = Object.freeze({
  stalwart: 0, knockout: 1, sticky: 2, cannonball: 3,
  magnet: 4, colossus: 5, shockwave: 6, ghost: 7
});

// Exact signed indices negated under vertical reflection (y -> 600 - y)
const Y_FLIP_OBS_INDICES = Object.freeze([
  ...Array.from({ length: 6 }, (_, i) => [1, 3, 4].map(k => i * SKATER_FLOATS + k)).flat(),
  BALL_START + 1, BALL_START + 3, BALL_START + 4, BALL_START + 16
]);
const Y_FLIP_POL_INDICES = Object.freeze([1, 3, 7, 9, 13, 15]);

let defaultModel = null;
const sharedObs = new Float32Array(NN_INPUT_DIM);
const sharedPerm = [0, 1, 2];
const sharedOppPerm = [0, 1, 2];

// Zero-allocation role ordering ([attack, support, defend] in 0..2) matching constants.roles()
function roleOrderFromCoords(bodies, team, slideX, slideY, bx, by, outPerm, projectSettled = false) {
  const base = team * 3;
  const goalX = team ? RINK_RIGHT : RINK_LEFT;
  let activeMask = 0;
  for (let i = 0; i < 3; i++) {
    const b = bodies[base + i];
    const active = projectSettled ? !b.stunnedNext : (!b.carded && !b.stunned);
    if (active) activeMask |= (1 << i);
  }
  const defMask = activeMask || 7;
  let def = -1, bestDefD = Infinity;
  for (let i = 0; i < 3; i++) {
    if (!(defMask & (1 << i))) continue;
    const x = slideX ? slideX[base + i] : bodies[base + i].x;
    const y = slideY ? slideY[base + i] : bodies[base + i].y;
    const d = Math.hypot(x - goalX, y - RINK_CY);
    if (d < bestDefD) { bestDefD = d; def = i; }
  }
  let restMask = activeMask & ~(1 << def);
  if (!restMask) restMask = 7 & ~(1 << def);
  let atk = -1, bestAtkD = Infinity;
  for (let i = 0; i < 3; i++) {
    if (!(restMask & (1 << i))) continue;
    const x = slideX ? slideX[base + i] : bodies[base + i].x;
    const y = slideY ? slideY[base + i] : bodies[base + i].y;
    const d = Math.hypot(x - bx, y - by);
    if (d < bestAtkD) { bestAtkD = d; atk = i; }
  }
  const sup = 3 - def - atk;
  outPerm[0] = atk;
  outPerm[1] = sup;
  outPerm[2] = def;
  return outPerm;
}

function roleOrderIndices(stateLike, team, outPerm = [0, 1, 2]) {
  const ball = stateLike.bodies[6];
  return roleOrderFromCoords(stateLike.bodies, team, null, null, ball.x, ball.y, outPerm);
}

function writeSkaterFeatures(b, raw, dir, classic, sx, sy, projectSettled, out, base) {
  out[base] = dir * (sx - RINK_CX) / 440;
  out[base + 1] = (sy - RINK_CY) / 240;
  out[base + 2] = dir * (projectSettled ? 0 : (b.vx || 0)) / 720;
  out[base + 3] = (projectSettled ? 0 : (b.vy || 0)) / 720;
  out[base + 4] = dir * (projectSettled ? 0 : (b.omega || 0)) / 20;
  const carded = projectSettled ? false : Boolean(b.carded);
  const stunned = projectSettled ? Boolean(b.stunnedNext) : Boolean(b.stunned);
  out[base + 5] = carded ? -1 : stunned ? 0 : 1;
  out[base + 6] = carded ? 1 : 0;
  out[base + 7] = stunned ? 1 : 0;
  out[base + 8] = (b.daze || 0) / 0.4;
  let meter = b.meter || 0;
  if (projectSettled && !classic && (b.superActive || b.usedSuperThisTurn) && !b.superRefunded) {
    const bonusRefund = b.equippedSuper?.bonusRefund ?? b.superBonusRefund ?? 0;
    const whiff = !b.superHit ? (P.SUPER?.whiffRefund ?? 25) : 0;
    meter = Math.min(100, meter + bonusRefund + whiff);
  }
  out[base + 9] = classic ? 0 : meter / 100;
  out[base + 10] = (!projectSettled && b.holding) ? 1 : 0;
  out[base + 11] = (!projectSettled && b.guarding) ? 1 : 0;
  out[base + 12] = projectSettled ? 0 : (b.ironCooldownTicks || 0) / 48;
  out[base + 13] = (!projectSettled && !classic && b.superActive) ? Math.min(1, (b.superTicks || 360) / 720) : 0;

  out[base + 14] = ((b.baseRadius ?? b.radius ?? 25) - 25) / 12.5;
  out[base + 15] = ((b.baseMass ?? b.mass ?? 3) - 3) / 1.5;
  out[base + 16] = (P.launchSpeed(b) - 720) / 360;
  out[base + 17] = ((b.baseReach ?? b.reach ?? 25) - 25) / 12.5;
  out[base + 18] = (b.power ?? 1) - 1;
  out[base + 19] = (b.curveMult ?? 1) - 1;

  for (let s = 0; s < 8; s++) out[base + 20 + s] = 0;
  if (!classic && b.equippedSuper) {
    const rawId = b.equippedSuper.id;
    const sId = Number.isInteger(rawId) && rawId >= 0 && rawId < 8 ? rawId : SUPER_KEYS[b.equippedSuper.key];
    if (Number.isInteger(sId)) {
      const lvl = b.equippedSuper.level || 1;
      const activeBonus = (!projectSettled && SUPER_KEYS[b.superActive] === sId) ? 0.2 : 0;
      out[base + 20 + sId] = 0.6 + 0.1 * lvl + activeBonus;
    }
  }
  out[base + 28] = (b.baseFriction ?? b.friction ?? 150) / 150 - 1;
  out[base + 29] = (b.maxSpin ?? P.BASE_MAX_SPIN) / P.BASE_MAX_SPIN - 1;
  out[base + 30] = (b.grip ?? 0.3) / 0.3 - 1;
  out[base + 31] = (b.baseBounciness ?? b.bounciness ?? 1) - 1;
  out[base + 32] = (b.baseStrength ?? b.strength ?? 1) - 1;
  out[base + 33] = (b.baseStability ?? b.stability ?? 1) - 1;
  out[base + 34] = classic ? 0 : M.superStat(P, raw?.efficiency) - 1;
  out[base + 35] = (b.synergyMult ?? 1) - 1;
  out[base + 36] = (b.chemistryMult ?? 1) - 1;
  const personality = b.personality;
  out[base + 37] = (personality?.aggression ?? 31.5) / 63;
  out[base + 38] = (personality?.creativity ?? 31.5) / 63;
  out[base + 39] = (personality?.teamwork ?? 31.5) / 63;
  out[base + 40] = (personality?.clutch ?? 31.5) / 63;
  out[base + 41] = (!projectSettled && b.stunnedNext) ? 1 : 0;
  out[base + 42] = (!projectSettled && b.ironGuard) ? 1 : 0;
  out[base + 43] = (!projectSettled && !classic) ? (b.superHoldTicks || 0) / 480 : 0;
  out[base + 44] = (!projectSettled && !classic && b.shockwaveFired) ? 1 : 0;
  out[base + 45] = (!projectSettled && !classic && b.usedSuperThisTurn) ? 1 : 0;
  out[base + 46] = classic ? 0 : (b.superBonusRefund || 0) / 20;
}

/**
 * Encodes any match state (or rollout projected state) into a canonical observation
 * where `team` always attacks toward +x, with zero heap allocations.
 */
function encodeObservation(bodies, fouls, team, hints, out = sharedObs, permOut = sharedPerm) {
  const dir = team === 0 ? 1 : -1;
  const mode = hints?.mode || 'standard';
  const classic = hints?.classic !== undefined ? Boolean(hints.classic) : M.rule(mode, 'classic');
  const pulse = hints?.pulse !== undefined ? Boolean(hints.pulse) : M.rule(mode, 'pulse');

  const slideX = hints?.slideX || null;
  const slideY = hints?.slideY || null;
  const projectSettled = Boolean(hints?.zeroSettledVel);

  const ball = bodies[6];
  const bx = hints?.pbx !== undefined ? hints.pbx : ball.x;
  const by = hints?.pby !== undefined ? hints.pby : ball.y;

  roleOrderFromCoords(bodies, team, slideX, slideY, bx, by, permOut, projectSettled);
  roleOrderFromCoords(bodies, 1 - team, slideX, slideY, bx, by, sharedOppPerm, projectSettled);

  const ownStart = team * 3, oppStart = (1 - team) * 3;
  const stats = hints?.stats;
  for (let r = 0; r < 6; r++) {
    const idx = r < 3 ? ownStart + permOut[r] : oppStart + sharedOppPerm[r - 3];
    const b = bodies[idx];
    const sx = slideX ? slideX[idx] : b.x;
    const sy = slideY ? slideY[idx] : b.y;
    writeSkaterFeatures(b, stats?.[idx], dir, classic, sx, sy, projectSettled, out, r * SKATER_FLOATS);
  }

  const bvx = projectSettled ? 0 : (ball.vx || 0);
  const bvy = projectSettled ? 0 : (ball.vy || 0);
  const bom = projectSettled ? 0 : (ball.omega || 0);
  const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
  const oppGoalX = RINK_LEFT + RINK_RIGHT - ownGoalX;

  out[BALL_START] = dir * (bx - RINK_CX) / 440;
  out[BALL_START + 1] = (by - RINK_CY) / 240;
  out[BALL_START + 2] = dir * bvx / 1200;
  out[BALL_START + 3] = bvy / 1200;
  out[BALL_START + 4] = dir * bom / 20;
  out[BALL_START + 5] = (!projectSettled && ball.onFire) ? 1 : 0;
  out[BALL_START + 6] = projectSettled ? 0 : (ball.fireTicks || 0) / 60;
  out[BALL_START + 7] = projectSettled ? 0 : (ball.pace || 0) / 1200;
  out[BALL_START + 8] = projectSettled ? 0 : (ball.curveMult ?? 1) - 1;
  out[BALL_START + 9] = projectSettled ? 0 : (ball.strikerPower ?? 1) - 1;
  out[BALL_START + 10] = Math.hypot(oppGoalX - bx, RINK_CY - by) / 900;
  out[BALL_START + 11] = Math.hypot(ownGoalX - bx, RINK_CY - by) / 900;
  out[BALL_START + 12] = projectSettled ? 0 : (ball.strikerTeam === team ? 1 : ball.strikerTeam === 1 - team ? -1 : 0);
  out[BALL_START + 13] = projectSettled ? 0 : (ball.strikerSynergy ?? 1) - 1;
  out[BALL_START + 14] = (!projectSettled && ball.openingShot) ? 1 : 0;
  const stickOffset = (!projectSettled && ball.stickOffset && P.holder(bodies)) ? ball.stickOffset : null;
  out[BALL_START + 15] = stickOffset ? dir * stickOffset.x / 50 : 0;
  out[BALL_START + 16] = stickOffset ? stickOffset.y / 50 : 0;

  const scores = hints?.scores;
  const ownScore = scores?.[team] || 0, oppScore = scores?.[1 - team] || 0;
  const corner = fouls && fouls.corner !== null && fouls.corner !== undefined ? fouls.corner : M.cornerOf(P, bx, by);
  const inOwnCorner = corner !== null && ((corner & 1) === team) ? 1 : 0;
  const inOppCorner = corner !== null && ((corner & 1) !== team) ? 1 : 0;

  out[MATCH_START] = classic ? 1 : 0;
  out[MATCH_START + 1] = pulse ? 1 : 0;
  // Blitz only sets the human planning timer, not physics or match rules; keep 0 so Blitz shares trained weights.
  out[MATCH_START + 2] = 0;
  out[MATCH_START + 3] = (ownScore - oppScore) / 5;
  out[MATCH_START + 4] = Math.max(0, 4 - ownScore) / 4;
  out[MATCH_START + 5] = Math.max(0, 4 - oppScore) / 4;
  out[MATCH_START + 6] = Math.min(1, (hints?.roundTurns || 0) / (pulse ? 120 : 40));
  out[MATCH_START + 7] = fouls?.crease?.[team] ? 1 : 0;
  out[MATCH_START + 8] = fouls?.crease?.[1 - team] ? 1 : 0;
  out[MATCH_START + 9] = inOwnCorner;
  out[MATCH_START + 10] = inOppCorner;
  out[MATCH_START + 11] = Math.min(1, (fouls?.cornerTurns || 0) / 2);
  out[MATCH_START + 12] = Math.min(1, (hints?.strikeOwn ?? 300) / 600);
  out[MATCH_START + 13] = Math.min(1, (hints?.strikeOther ?? 300) / 600);
  out[MATCH_START + 14] = Math.min(1, (hints?.coneOwn ?? 300) / 600);
  out[MATCH_START + 15] = Math.min(1, (hints?.coneOther ?? 300) / 600);
  return out;
}

function encodeState(state, team, geomHints = null, out = sharedObs, permOut = sharedPerm) {
  return encodeObservation(state.bodies, state.fouls, team, {
    mode: state.mode || 'standard',
    stats: state.stats,
    scores: state.scores,
    roundTurns: state.roundTurns || 0,
    ...(geomHints || {})
  }, out, permOut);
}

function encodePlans(plans, team, perm, out, offset = 0) {
  const dir = team === 0 ? 1 : -1;
  for (let r = 0; r < 3; r++) {
    const m = plans[perm[r]] || HOLD;
    const base = offset + r * 6;
    const moving = !m.guard && (m.power || 0) > 0.01;
    out[base] = moving ? dir * Math.cos(m.angle || 0) : 1;
    out[base + 1] = moving ? Math.sin(m.angle || 0) : 0;
    out[base + 2] = m.guard ? 0 : Math.max(0, Math.min(1, m.power || 0));
    out[base + 3] = moving ? Math.max(-1, Math.min(1, dir * (m.spin || 0))) : 0;
    out[base + 4] = m.superArm ? 1 : 0;
    out[base + 5] = m.guard ? 1 : 0;
  }
  return out;
}

function sigmoid(x) {
  if (x >= 0) { const z = Math.exp(-x); return 1 / (1 + z); }
  const z = Math.exp(x);
  return z / (1 + z);
}

function decodePolicyPlans(polOut, state, team, perm, classic = false, jitter = 0, random = Math.random) {
  const dir = team === 0 ? 1 : -1;
  const ownStart = team * 3;
  const creaseWarned = Boolean(state.fouls?.crease?.[team]);
  const out = [HOLD, HOLD, HOLD];
  for (let r = 0; r < 3; r++) {
    const slot = perm[r];
    const b = state.bodies[ownStart + slot];
    if (!b || b.carded || b.stunned) {
      out[slot] = { ...HOLD };
      continue;
    }
    const base = r * 6;
    const cosA = polOut[base];
    const sinA = polOut[base + 1];
    const pwrProb = sigmoid(polOut[base + 2]);
    const spinRaw = Math.tanh(polOut[base + 3]);
    const supProb = sigmoid(polOut[base + 4]);
    const grdProb = sigmoid(polOut[base + 5]);

    const canSuper = !classic && (b.meter ?? 0) >= 100 && Boolean(b.equippedSuper);
    const isStalwart = canSuper && b.equippedSuper?.key?.toLowerCase() === 'stalwart';
    const superArm = canSuper && supProb > (jitter > 0 ? 0.5 + (random() - 0.5) * jitter : 0.5);

    const forbidGuardInCrease = creaseWarned && M.inCrease(P, b, team) && !(superArm && isStalwart);
    if (grdProb > 0.52 && !forbidGuardInCrease) {
      out[slot] = { angle: 0, power: 0, spin: 0, superArm: Boolean(superArm && isStalwart), guard: true };
      continue;
    }
    let power = pwrProb;
    if (jitter > 0) power = Math.max(0, Math.min(1, power + (random() - 0.5) * jitter * 0.6));
    if (power < 0.03 && !forbidGuardInCrease) {
      out[slot] = { ...HOLD };
      continue;
    }
    if (forbidGuardInCrease && power < 0.25) power = 0.35;

    let angle = Math.atan2(sinA, dir * cosA);
    if (!Number.isFinite(angle)) angle = team ? Math.PI : 0;
    if (jitter > 0) angle += (random() - 0.5) * jitter * 0.45;
    angle = ((angle % TWO_PI) + TWO_PI) % TWO_PI;

    let spin = dir * spinRaw;
    if (jitter > 0) spin += (random() - 0.5) * jitter * 0.5;
    spin = Math.max(-1, Math.min(1, spin));

    out[slot] = { angle, power, spin, superArm, guard: false };
  }
  return out;
}

function decodeF16Slice(dv, byteOffset, count, forceBitwise = false) {
  const out = new Float32Array(count);
  const useNative = !forceBitwise && typeof dv.getFloat16 === 'function';
  for (let i = 0; i < count; i++) {
    const off = byteOffset + i * 2;
    if (useNative) { out[i] = dv.getFloat16(off, true); continue; }
    const u = dv.getUint16(off, true);
    const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, m = u & 0x03ff;
    out[i] = e === 0 ? s * 5.960464477539063e-8 * m
      : e === 31 ? (m ? NaN : s * Infinity)
      : s * (2 ** (e - 15)) * (1 + m / 1024);
  }
  return out;
}

function parseWeights(bufferLike, opts = {}) {
  if (!bufferLike) return null;
  const ab = bufferLike instanceof ArrayBuffer
    ? bufferLike
    : (ArrayBuffer.isView(bufferLike)
      ? bufferLike.buffer.slice(bufferLike.byteOffset, bufferLike.byteOffset + bufferLike.byteLength)
      : null);
  if (!ab || ab.byteLength < 16) throw new Error('Invalid UBNN weight buffer.');
  const dv = new DataView(ab);
  if (dv.getUint32(0, true) !== NN_MAGIC) throw new Error('Bad UBNN magic header.');
  const format = dv.getUint16(4, true);
  const H = dv.getUint16(6, true);
  const D = dv.getUint16(8, true);
  const layers = dv.getUint16(10, true);
  const physVersion = dv.getUint32(12, true);
  if (format !== NN_FORMAT || D !== NN_INPUT_DIM || layers !== 3 || H < 16 || H > 2048) {
    throw new Error('Unsupported UBNN model shape.');
  }
  if (!opts.ignorePhysVersion && physVersion !== P.VERSION) {
    return null;
  }
  const expectedParams =
    (D * H + H * 3) +
    2 * (H * H + H * 3) +
    (H * NN_VALUE_DIM + NN_VALUE_DIM) +
    (H * NN_POLICY_DIM + NN_POLICY_DIM);
  if (ab.byteLength < 16 + expectedParams * 2) {
    throw new Error('Truncated UBNN weight file.');
  }

  let off = 16;
  const take = n => {
    const arr = decodeF16Slice(dv, off, n, Boolean(opts.forceBitwise));
    if (!arr.every(Number.isFinite)) throw new Error('Non-finite UBNN weights.');
    off += n * 2;
    return arr;
  };
  return {
    format, D, H, layers, physVersion, paramCount: expectedParams,
    sW: take(D * H), sb: take(H), sg: take(H), sbe: take(H),
    b1W: take(H * H), b1b: take(H), b1g: take(H), b1be: take(H),
    b2W: take(H * H), b2b: take(H), b2g: take(H), b2be: take(H),
    vW: take(H * NN_VALUE_DIM), vb: take(NN_VALUE_DIM),
    pW: take(H * NN_POLICY_DIM), pb: take(NN_POLICY_DIM),
    h0: new Float32Array(H),
    h1: new Float32Array(H),
    valLogits: new Float32Array(NN_VALUE_DIM),
    polOut: new Float32Array(NN_POLICY_DIM)
  };
}

function loadWeights(bufferLike, opts = {}) {
  defaultModel = parseWeights(bufferLike, opts);
  return defaultModel;
}

function clearWeights() {
  defaultModel = null;
}

function getModel(config = null) {
  if (config && config.nn === false) return null;
  if (config && config.nnModel) return config.nnModel;
  return defaultModel;
}

function hasWeights() {
  return defaultModel !== null;
}

function linearLnSilu(x, inDim, W, b, g, beta, out, residual) {
  const H = b.length;
  out.set(b);
  for (let i = 0; i < inDim; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const row = i * H;
    for (let j = 0; j < H; j++) out[j] += xi * W[row + j];
  }
  let mean = 0;
  for (let j = 0; j < H; j++) mean += out[j];
  mean /= H;
  let m2 = 0;
  for (let j = 0; j < H; j++) {
    const d = out[j] - mean;
    m2 += d * d;
  }
  const invStd = 1 / Math.sqrt(m2 / H + 1e-5);
  if (residual) {
    for (let j = 0; j < H; j++) {
      const z = (out[j] - mean) * invStd * g[j] + beta[j];
      out[j] = residual[j] + z / (1 + Math.exp(-z));
    }
  } else {
    for (let j = 0; j < H; j++) {
      const z = (out[j] - mean) * invStd * g[j] + beta[j];
      out[j] = z / (1 + Math.exp(-z));
    }
  }
}

function forward(obs, needPolicy = false, model = defaultModel) {
  if (!model) return null;
  const { D, H, h0, h1, valLogits, polOut } = model;
  linearLnSilu(obs, D, model.sW, model.sb, model.sg, model.sbe, h0, null);
  linearLnSilu(h0, H, model.b1W, model.b1b, model.b1g, model.b1be, h1, h0);
  linearLnSilu(h1, H, model.b2W, model.b2b, model.b2g, model.b2be, h0, h1);

  valLogits[0] = model.vb[0];
  valLogits[1] = model.vb[1];
  valLogits[2] = model.vb[2];
  const vW = model.vW;
  for (let i = 0; i < H; i++) {
    const hi = h0[i], r = i * 3;
    valLogits[0] += hi * vW[r];
    valLogits[1] += hi * vW[r + 1];
    valLogits[2] += hi * vW[r + 2];
  }
  const m = Math.max(valLogits[0], valLogits[1], valLogits[2]);
  const e0 = Math.exp(valLogits[0] - m);
  const e1 = Math.exp(valLogits[1] - m);
  const e2 = Math.exp(valLogits[2] - m);
  const invS = 1 / (e0 + e1 + e2);
  const pScore = e0 * invS, pConcede = e1 * invS, pDraw = e2 * invS;
  const value = pScore - pConcede;

  if (needPolicy) {
    polOut.set(model.pb);
    const pW = model.pW;
    for (let i = 0; i < H; i++) {
      const hi = h0[i], r = i * NN_POLICY_DIM;
      for (let j = 0; j < NN_POLICY_DIM; j++) polOut[j] += hi * pW[r + j];
    }
  }
  return { value, pScore, pConcede, pDraw, polOut };
}

module.exports = {
  NN_MAGIC, NN_FORMAT, NN_INPUT_DIM, NN_HIDDEN_DIM, NN_VALUE_DIM, NN_POLICY_DIM, NN_ROW_FLOATS,
  Y_FLIP_OBS_INDICES, Y_FLIP_POL_INDICES,
  roleOrderFromCoords, roleOrderIndices, encodeObservation, encodeState, encodePlans, decodePolicyPlans,
  decodeF16Slice, parseWeights, loadWeights, clearWeights, getModel, hasWeights, forward
};
