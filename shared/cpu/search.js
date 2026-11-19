/* Two-stage gated rollout search, adversarial counter-search, and Boltzmann style selection. */
'use strict';
const {
  P, M, HOLD, GUARD, LEVELS, WEIGHTS, WOBBLE, COMPLEX, ROLE_INTENTS, SEARCH_TICKS,
  RINK_LEFT, RINK_RIGHT, RINK_TOP, RINK_BOTTOM, RINK_CX, RINK_CY, GOAL_Y_TOP, GOAL_Y_BOT,
  SHOT_DRIVE, decided, randomSource, contactRadius, skaterDrive, segmentBlocked,
  creativityOf, behindBall, isPointBlank, bReach, MOVE_ID, getIntent, copy, fitsRole, roles
} = require('./constants.js');
const { aim, strike, traceMovingBall } = require('./kinematics.js');
const { shotConePoint, canOccupyCrease, goalPocketPoint, bestBankTargetY, traceIncomingShot, guardCoversSegment, assessOpponentThreat, scanGoalAperture } = require('./threat.js');
const { legacy } = require('./baseline.js');
const { options, place3, jointTeamPlays, wobble } = require('./candidates.js');
const { evaluateBodies, planBasinKey } = require('./evaluate.js');
const { buildOpponentResponses, sanitizePredictedMove, learnedOpponentResponses } = require('./opponent.js');
const { runMultiTurnLookahead } = require('./lookahead.js');

function prepareSearchState(input, classic) {
  let maxMeterTick = -Infinity;
  let needCopy = classic;
  const skaterCount = input.bodies.length === 7 && input.bodies[6].team === -1 ? 6 : input.bodies.length;
  for (let i = 0; i < skaterCount; i++) {
    const b = input.bodies[i];
    if (b.superArm) needCopy = true;
    if (Number.isFinite(b.meterTick) && b.meterTick > maxMeterTick) maxMeterTick = b.meterTick;
  }
  let bodies = input.bodies;
  if (needCopy) {
    bodies = new Array(input.bodies.length);
    for (let i = 0; i < skaterCount; i++) {
      const s = input.bodies[i];
      const copyB = { ...s };
      if ('superArm' in copyB) copyB.superArm = false;
      if (classic) {
        copyB.meter = 0;
        copyB.equippedSuper = null;
        if ('superKey' in copyB) copyB.superKey = null;
      }
      bodies[i] = copyB;
    }
    if (input.bodies.length > skaterCount) bodies[skaterCount] = input.bodies[skaterCount];
  }
  const clock = input.clock !== undefined
    ? input.clock
    : (maxMeterTick > -Infinity ? maxMeterTick + M.METER.cooldownTicks : undefined);
  return {
    version: input.version,
    mode: input.mode,
    bodies,
    stats: input.stats || [],
    scores: input.scores ? [input.scores[0], input.scores[1]] : [0, 0],
    turn: input.turn,
    roundTurns: input.roundTurns || 0,
    clock,
    fouls: input.fouls
  };
}

function plan(input, team = 1, config = {}) {
  if (team !== 0 && team !== 1) throw new Error('Invalid CPU team.');
  const level = config.level || 'medium';
  if (!LEVELS[level]) throw new Error('Invalid CPU level.');
  const settings = { ...LEVELS[level], ...config };
  const rawWeights = { ...WEIGHTS, ...config.weights };
  if (!Number.isInteger(settings.candidates) || settings.candidates < 1 || settings.candidates > 1000 ||
      !Number.isInteger(settings.opponents) || settings.opponents < 1 || settings.opponents > 5 ||
      !Number.isFinite(settings.risk) || settings.risk < 0 || settings.risk > 1 ||
      !Number.isFinite(settings.temperature) || settings.temperature <= 0 ||
      (settings.wobble !== undefined && typeof settings.wobble !== 'boolean') ||
      (settings.fastTick !== undefined && typeof settings.fastTick !== 'boolean') ||
      (settings.learn !== undefined && typeof settings.learn !== 'boolean') ||
      (settings.counterBudget !== undefined && (!Number.isInteger(settings.counterBudget) || settings.counterBudget < 0 || settings.counterBudget > 200)) ||
      (settings.counterTop !== undefined && (!Number.isInteger(settings.counterTop) || settings.counterTop < 1 || settings.counterTop > 40)) ||
      (settings.counterRounds !== undefined && (!Number.isInteger(settings.counterRounds) || settings.counterRounds < 0 || settings.counterRounds > 4)) ||
      (settings.searchTicks !== undefined && (!Number.isInteger(settings.searchTicks) || settings.searchTicks < 30 || settings.searchTicks > 2880)) ||
      (settings.lookaheadTop !== undefined && (!Number.isInteger(settings.lookaheadTop) || settings.lookaheadTop < 0 || settings.lookaheadTop > 20)) ||
      (settings.lookaheadBreadth !== undefined && (!Number.isInteger(settings.lookaheadBreadth) || settings.lookaheadBreadth < 2 || settings.lookaheadBreadth > 8)) ||
      (settings.lookaheadTicks !== undefined && (!Number.isInteger(settings.lookaheadTicks) || settings.lookaheadTicks < 60 || settings.lookaheadTicks > 2880)) ||
      (settings.lookaheadBudget !== undefined && (!Number.isInteger(settings.lookaheadBudget) || settings.lookaheadBudget < 0 || settings.lookaheadBudget > 400)) ||
      (settings.pulseDepth !== undefined && (!Number.isInteger(settings.pulseDepth) || settings.pulseDepth < 1 || settings.pulseDepth > 3)) ||
      (settings.godBridgeDual !== undefined && typeof settings.godBridgeDual !== 'boolean') ||
      (settings.screenTop !== undefined && (!Number.isInteger(settings.screenTop) || settings.screenTop < 1 || settings.screenTop > 1000)) ||
      (settings.wobbleTop !== undefined && (!Number.isInteger(settings.wobbleTop) || settings.wobbleTop < 0 || settings.wobbleTop > 1000)) ||
      Object.values(rawWeights).some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid CPU search settings.');

  const started = performance.now(), random = randomSource(config.seed ?? 1);
  const classic = M.rule(input.mode, 'classic');
  const state = prepareSearchState(input, classic);

  const ownStart = team * 3;
  const avgTrait = key => (
    ((state.bodies[ownStart].personality?.[key] ?? 31.5) +
     (state.bodies[ownStart + 1].personality?.[key] ?? 31.5) +
     (state.bodies[ownStart + 2].personality?.[key] ?? 31.5)) / (3 * 63)
  );
  const agg = avgTrait('aggression'), cre = avgTrait('creativity'), tmw = avgTrait('teamwork'), clu = avgTrait('clutch');
  const deficit = Math.max(0, (state.scores?.[1 - team] ?? 0) - (state.scores?.[team] ?? 0));
  const matchPt = (state.scores?.[1 - team] ?? 0) >= 4;
  const pressure = Math.min(1, deficit * 0.25 + (matchPt ? 0.4 : 0));
  const surge = pressure * (clu - 0.5) * 2;
  const style = { agg, cre, tmw, surge, dir: team ? -1 : 1 };

  const weights = { ...rawWeights };

  let best = legacy(state, team), simulations = 0, ticks = 0, evaluated = 0;
  const startCreaseWarned = Boolean(state.fouls?.crease?.[team]);
  const jobs = roles(state, team);
  const primaryAtkIdx = jobs.indexOf('attack');
  const defRoleIdx = jobs.indexOf('defend');
  const ownGoalX = team ? RINK_RIGHT : RINK_LEFT;
  const step4Threat = assessOpponentThreat(state, team, classic);
  const pulse = M.rule(state.mode, 'pulse');
  const fullTurnTicks = M.turnTicks(state.mode);
  const baseHorizon = settings.searchTicks || SEARCH_TICKS;
  const searchTicks = startCreaseWarned ? fullTurnTicks : baseHorizon;

  const results = new Map();
  const activeMasks = new Map();
  const rolloutMeta = new Map();
  const movePool = new Map();
  let nextMoveId = 4;
  const number = n => Object.is(n, -0) ? '-0' : n;
  function getMoveId(p) {
    if (p.guard || !p.power) return 1 + (p.superArm ? 2 : 0) + (p.guard ? 1 : 0);
    let id = p[MOVE_ID];
    if (id !== undefined) return id;
    const sig = `${number(p.angle)},${number(p.power)},${number(p.spin)},${p.superArm}`;
    id = movePool.get(sig);
    if (id === undefined) {
      id = ++nextMoveId;
      movePool.set(sig, id);
    }
    p[MOVE_ID] = id;
    return id;
  }

  function planKey(moves, r) {
    const id0 = getMoveId(moves[0]), id1 = getMoveId(moves[1]), id2 = getMoveId(moves[2]);
    return r + 16 * (id0 + 4096 * (id1 + 4096 * id2));
  }

  const responses = buildOpponentResponses(state, team, classic, settings.opponents);
  if (settings.learn && config.history) {
    const maxLearn = (state.roundTurns || 0) === 0 || settings.opponents >= 4 ? 2 : 1;
    const learnedList = learnedOpponentResponses(state, team, classic, config.history, maxLearn);
    for (let li = 0; li < learnedList.length; li++) {
      const learned = learnedList[li];
      const lKey = planKey(learned, 0);
      if (!responses.some(r => planKey(r, 0) === lKey)) {
        if (responses.length >= 5) responses[responses.length - 1] = learned;
        else responses.push(learned);
      }
    }
  }
  const respCount = responses.length;

  const canDecide = !pulse && !state.fouls?.crease?.[team] && !state.fouls?.crease?.[1 - team] && state.fouls?.corner === null;

  function runRollout(moves, response, evalOpp = false) {
    let toucher = null, touches = 0, boards = 0;
    let firstTeamTouch = null, multiTeamTouch = false;
    let aMask = 0;
    for (let k = 0; k < 3; k++) if (state.bodies[ownStart + k].holding) aMask |= (1 << k);
    const watch = {
      collide({ a, b, speed }) {
        if (a.team === team && a.slot >= 0) aMask |= (1 << a.slot);
        if (b.team === team && b.slot >= 0) aMask |= (1 << b.slot);
        const player = M.toucher(a, b, speed);
        if (player && player !== toucher) {
          toucher = player;
          touches++;
          if (player.team === team) {
            if (firstTeamTouch === null) firstTeamTouch = player;
            else if (firstTeamTouch !== player) multiTeamTouch = true;
          }
        }
      },
      wall(body, _velocity, type) { if (body.team === -1 && touches && type !== 'net') boards++; }
    };
    let hitDec = false;
    const checkDecided = canDecide ? bodies => {
      if (touches > 0 && decided(bodies)) { hitDec = true; return true; }
      return false;
    } : null;
    const allMoves = team
      ? [response[0], response[1], response[2], moves[0], moves[1], moves[2]]
      : [moves[0], moves[1], moves[2], response[0], response[1], response[2]];
    const result = M.resolveTurn(P, state, allMoves, {
      effects: false, fastSearch: true, fastTick: true, ticks: searchTicks,
      decided: checkDecided, watch, preservePartial: true
    });
    simulations++;
    const ticksDone = result.replay.ticks;
    ticks += ticksDone;
    const endBodies = result.state.bodies;
    const partial = !hitDec && result.replay.goal === null && ticksDone < fullTurnTicks && !P.settled(endBodies);
    const comp = boards + Math.max(0, touches - 1);
    const endBall = endBodies[6];
    const goal = result.replay.goal;
    const speedShare = goal === null ? 0 : Math.max(0, 1 - ticksDone / fullTurnTicks);
    const val = evaluateBodies(endBodies, result.state.fouls, team, goal, weights, comp, toucher, multiTeamTouch, tmw, partial, pulse)
      + (goal === team ? weights.goal * 0.0006 * speedShare : 0);
    const valOpp = evalOpp
      ? evaluateBodies(endBodies, result.state.fouls, 1 - team, goal, rawWeights, comp, toucher, false, 0.5, partial, pulse)
        + (goal === 1 - team ? rawWeights.goal * 0.0006 * speedShare : 0)
      : 0;
    return {
      val, valOpp, ticksDone, activeMask: aMask, boards, multiTeamTouch,
      endBallX: endBall.x, endBallY: endBall.y, goalScored: result.replay.goal
    };
  }

  function simulate(moves, response, r) {
    const key = planKey(moves, r);
    let cached = results.get(key);
    if (cached === undefined) {
      const out = runRollout(moves, response);
      cached = out.val;
      results.set(key, cached);
      activeMasks.set(key, out.activeMask);
      if (r === 0) rolloutMeta.set(key, { boards: out.boards, multiTeamTouch: out.multiTeamTouch });
    }
    return cached;
  }

  function activeMaskOf(moves) {
    return activeMasks.get(planKey(moves, 0)) || 0;
  }

  function roleFit(moves) {
    let n = 0;
    for (let i = 0; i < 3; i++) {
      const p = moves[i], b = state.bodies[ownStart + i];
      if (startCreaseWarned && M.inCrease(P, b, team)) {
        if (!p.power || p.guard) {
          const isStalwart = p.superArm && b.equippedSuper?.key?.toLowerCase() === 'stalwart';
          if (!isStalwart) { n -= 20; continue; }
        }
      }
      if (fitsRole(jobs[i], p, b, state)) n++;
    }
    return n;
  }

  function combineValues(vals, fit) {
    let minV = Infinity;
    for (let r = 0; r < vals.length; r++) {
      if (vals[r] < minV) minV = vals[r];
    }
    const concedesAny = minV <= -weights.goal * 0.85;
    let sum = 0;
    for (let r = 0; r < vals.length; r++) {
      const vr = vals[r];
      // Do not let a lucky +10,000 windfall against one scenario mask conceding goals in other scenarios.
      sum += (concedesAny && vr > weights.goal * 0.5) ? vr * 0.35 : vr;
    }
    let combined = (sum / vals.length) * (1 - settings.risk) + minV * settings.risk + fit * weights.role;
    if (vals[0] <= -weights.goal * 0.85) {
      combined = Math.min(combined, -weights.goal * 0.65 + fit * weights.role);
    }
    return combined;
  }

  // Ensures an entry has passed ±2° / ±5% execution wobble (+ catastrophic own-goal veto) before winning or entering final sampling.
  function ensureWobbled(entry) {
    if (!entry || entry.wobbled || settings.wobble === false) return entry ? entry.value : -Infinity;
    const wPos = simulate(wobble(entry.moves, 1), responses[0], 0);
    const wNeg = simulate(wobble(entry.moves, -1), responses[0], 0);
    if (entry.values[0] > -weights.goal * 0.5 && (wPos <= -weights.goal * 0.85 || wNeg <= -weights.goal * 0.85)) {
      entry.values[0] = Math.min((entry.values[0] + wPos + wNeg) / 3, -3500);
    } else {
      entry.values[0] = (entry.values[0] + wPos + wNeg) / 3;
    }
    if (settings.godWobble && respCount >= 3 && entry.values.length >= 3) {
      let gwIdx = 2;
      if (step4Threat.shotDanger) {
        let worstV = Infinity;
        for (let r = 1; r < entry.values.length; r++) {
          if (entry.values[r] < worstV) { worstV = entry.values[r]; gwIdx = r; }
        }
      }
      const gwPos = simulate(wobble(entry.moves, 1), responses[gwIdx], gwIdx);
      const gwNeg = simulate(wobble(entry.moves, -1), responses[gwIdx], gwIdx);
      if (entry.values[gwIdx] > -weights.goal * 0.5 && (gwPos <= -weights.goal * 0.85 || gwNeg <= -weights.goal * 0.85)) {
        entry.values[gwIdx] = Math.min((entry.values[gwIdx] + gwPos + gwNeg) / 3, -3500);
      } else {
        entry.values[gwIdx] = (entry.values[gwIdx] + gwPos + gwNeg) / 3;
      }
      entry.threatWobbled = true;
    }
    entry.value = combineValues(entry.values, entry.fit);
    entry.wobbled = true;
    return entry.value;
  }

  // Wobble-verifies a finalist's worst non-legacy threat scenario (e.g. bank shot or counter) during active shotDanger
  // so 1-pixel fluke saves lose to genuinely sturdy goalie positions.
  function ensureThreatWobbled(entry) {
    if (!entry || entry.threatWobbled || settings.wobble === false || !step4Threat.shotDanger) return;
    if (!entry.values || entry.values.length < 2) return;
    let worstR = 1;
    for (let r = 2; r < entry.values.length; r++) {
      if (entry.values[r] < entry.values[worstR]) worstR = r;
    }
    if (entry.values[worstR] <= -weights.goal * 0.5 || !responses[worstR]) {
      entry.threatWobbled = true;
      return;
    }
    const tPos = simulate(wobble(entry.moves, 1), responses[worstR], worstR);
    const tNeg = simulate(wobble(entry.moves, -1), responses[worstR], worstR);
    if (tPos <= -weights.goal * 0.85 || tNeg <= -weights.goal * 0.85) {
      entry.values[worstR] = Math.min((entry.values[worstR] + tPos + tNeg) / 3, -3500);
    } else {
      entry.values[worstR] = (entry.values[worstR] + tPos + tNeg) / 3;
    }
    entry.value = combineValues(entry.values, entry.fit);
    entry.threatWobbled = true;
  }

  const scored = [], finalists = [];
  const useScreenTop = Number.isInteger(settings.screenTop) && respCount > 1;
  const maxGoal = weights.goal * 1.0066; // Includes the fast-goal tie-break.
  const pruneMargin = Math.max(8, 1.8 * settings.temperature);
  let nearWobbles = 0;
  let bestScore = -Infinity;
  let bestR0 = -Infinity;
  let bestMin = -Infinity;
  let bestAvg01 = -Infinity;

  // Two-Stage Inline Gate:
  // Stage A checks r=0 (legacy) with a generous apples-to-apples reference min(bestScore, bestR0).
  // Stage B finishes r=1..k and runs inline wobble BEFORE updating bestScore so 1-px flukes never hijack search.
  function score(moves, primaryStrike, keepDefSafe = false) {
    const fit = roleFit(moves);
    if (useScreenTop) {
      const v0 = simulate(moves, responses[0], 0);
      let quickVal = v0 + fit * weights.role;
      if (respCount > 1 && v0 >= bestScore - 30) {
        const vCheck = simulate(moves, responses[respCount - 1], respCount - 1);
        quickVal = 0.5 * (v0 + vCheck) * (1 - settings.risk) + Math.min(v0, vCheck) * settings.risk + fit * weights.role;
      }
      evaluated++;
      finalists.push({ moves, fit, v0, preVal: quickVal });
      return { value: quickVal, r0: v0 + fit * weights.role, avg01: quickVal };
    }

    const v0 = simulate(moves, responses[0], 0);
    const r0WithFit = v0 + fit * weights.role;
    const meta0 = rolloutMeta.get(planKey(moves, 0));
    if (respCount === 1) {
      evaluated++;
      let val1 = r0WithFit, didWobble = settings.wobble === false;
      if (settings.wobble !== false && (bestScore === -Infinity || val1 >= bestScore - 10)) {
        const wPos = simulate(wobble(moves, 1), responses[0], 0);
        const wNeg = simulate(wobble(moves, -1), responses[0], 0);
        const rawW = (v0 > -weights.goal * 0.5 && (wPos <= -weights.goal * 0.85 || wNeg <= -weights.goal * 0.85))
          ? Math.min((v0 + wPos + wNeg) / 3, -3500)
          : (v0 + wPos + wNeg) / 3;
        val1 = rawW + fit * weights.role;
        didWobble = true;
      }
      scored.push({ moves, value: val1, fit, values: [val1 - fit * weights.role], meta: meta0, wobbled: didWobble });
      return { value: val1, r0: r0WithFit, avg01: val1 };
    }

    if (v0 <= -weights.goal * 0.85 && bestScore > -weights.goal * 0.5) {
      evaluated++;
      return { value: r0WithFit, r0: r0WithFit, avg01: r0WithFit };
    }
    const cleanGoalLocked = bestScore >= weights.goal * 0.995;
    if (cleanGoalLocked && !(primaryStrike && (settings.counterBudget || 0) >= 20) && r0WithFit <= bestScore + 0.25) {
      evaluated++;
      return { value: r0WithFit, r0: r0WithFit, avg01: r0WithFit };
    }
    if (bestScore > -Infinity && v0 < 5000 && !(keepDefSafe && !cleanGoalLocked && v0 > -weights.goal * 0.5)) {
      const minCap = bestMin < 4000 ? bestMin + 30 : bestScore;
      const r0Ref = Math.min(bestScore, bestR0, minCap);
      const r0Gate = (primaryStrike && bestMin < 2000) ? 500 : 120;
      if (r0WithFit < r0Ref - r0Gate) {
        evaluated++;
        return { value: Math.min(r0WithFit, bestScore - 22), r0: r0WithFit, avg01: r0WithFit };
      }
    }

    const values = new Array(respCount);
    values[0] = v0;
    let sumSoFar = v0, minSoFar = v0;
    let candAvg01 = r0WithFit;
    for (let r = 1; r < respCount; r++) {
      const v = simulate(moves, responses[r], r);
      values[r] = v;
      sumSoFar += v;
      if (v < minSoFar) minSoFar = v;
      if (r === 1) {
        candAvg01 = 0.5 * (v0 + v) * (1 - settings.risk) + minSoFar * settings.risk + fit * weights.role;
      }

      if (r + 1 < respCount && bestScore > -Infinity && !(keepDefSafe && !cleanGoalLocked && minSoFar > -weights.goal * 0.5)) {
        const rem = respCount - (r + 1);
        const exactUpper = ((sumSoFar + rem * maxGoal) / respCount) * (1 - settings.risk) +
          Math.min(minSoFar, maxGoal) * settings.risk + fit * weights.role;
        if (exactUpper < bestScore - pruneMargin) {
          evaluated++;
          return { value: exactUpper, r0: r0WithFit, avg01: candAvg01 };
        }
        if (r === 1 && v0 < 1800 && v < 1800) {
          const avg01Ref = Math.min(bestScore, bestAvg01);
          if (candAvg01 < avg01Ref - 80) {
            evaluated++;
            return { value: candAvg01, r0: r0WithFit, avg01: candAvg01 };
          }
        }
      }
    }
    evaluated++;
    const preVal = combineValues(values, fit);

    const isChallenger = bestScore === -Infinity || preVal > bestScore + 0.1;
    const isNearTie = !cleanGoalLocked && nearWobbles < 1 && preVal >= bestScore - Math.max(3, settings.temperature);
    const entry = { moves, value: preVal, fit, values, meta: meta0, wobbled: settings.wobble === false };
    if (settings.wobble !== false && (isChallenger || isNearTie)) {
      if (!isChallenger) nearWobbles++;
      ensureWobbled(entry);
      const wAvg01 = 0.5 * (values[0] + values[1]) * (1 - settings.risk) + Math.min(values[0], values[1]) * settings.risk + fit * weights.role;
      scored.push(entry);
      let minW = Infinity;
      for (let r = 0; r < values.length; r++) if (values[r] < minW) minW = values[r];
      return { value: entry.value, r0: values[0] + fit * weights.role, minVal: minW + fit * weights.role, avg01: wAvg01 };
    }
    scored.push(entry);
    return { value: preVal, r0: r0WithFit, minVal: minSoFar + fit * weights.role, avg01: candAvg01 };
  }

  // 1. Seed plan (legacy heuristic — preserves candidates:1 parity)
  const seenPlans = new Set();
  seenPlans.add(planKey(best, 0));
  const seedRes = score(best, true);
  bestScore = seedRes.value;
  bestR0 = seedRes.r0;
  bestMin = seedRes.minVal ?? seedRes.value;
  bestAvg01 = seedRes.avg01;

  function consider(moves, primaryStrike = false, keepDefSafe = false) {
    if (evaluated >= settings.candidates) return false;
    const pk = planKey(moves, 0);
    if (seenPlans.has(pk)) return false;
    seenPlans.add(pk);
    const res = score(moves, primaryStrike, keepDefSafe);
    if (res.value > bestScore + 1e-8) {
      best = moves;
      bestScore = res.value;
      bestR0 = res.r0;
      bestMin = res.minVal ?? res.value;
      bestAvg01 = res.avg01;
      nearWobbles = 0;
    }
    return true;
  }

  // 2. Single-skater interleaved option sweep
  const choices = [0, 1, 2].map(i => options(state, team, i, best[i]));
  const maxChoiceLen = Math.max(choices[0].length, choices[1].length, choices[2].length);
  for (let j = 0; j < maxChoiceLen && evaluated < settings.candidates * 0.52; j++) {
    for (let i = 0; i < 3; i++) {
      const opt = choices[i][j];
      if (opt) {
        const next = best.slice();
        next[i] = opt;
        const intent = getIntent(opt);
        const keepDef = step4Threat.shotDanger && i === defRoleIdx && j <= 8 && (intent === 'cover' || intent === 'guard');
        consider(next, keepDef || (i === primaryAtkIdx && j <= 8 && (intent === 'shoot' || intent === 'carry' || intent === 'magnet')), keepDef);
      }
    }
  }

  // 3. Coordinated 3-player plays (Sticky escort, Defensive Fire Drill, Screen-Breaker, Snap one-timers, Pack-Draft)
  if (evaluated < settings.candidates * 0.68) {
    const joint = jointTeamPlays(state, team, best, jobs);
    for (let jp = 0; jp < joint.length && evaluated < settings.candidates * 0.68; jp++) {
      consider(joint[jp], jp < 6, step4Threat.shotDanger && jp < 2);
    }
  }

  // 4. Active-Toucher Two-Gear Fine-Tuning
  const shuffles = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  function teamPlan() {
    const order = evaluated % 3 ? shuffles[0] : shuffles[Math.floor(random() * 6)];
    const out = new Array(3);
    for (let i = 0; i < 3; i++) {
      const fitting = choices[i].filter(p => fitsRole(jobs[order[i]], p, state.bodies[ownStart + i], state));
      const pool = fitting.length ? fitting : choices[i];
      out[i] = pool[Math.floor(random() * pool.length)];
    }
    return out;
  }

  const anyUnstunned = !state.bodies[ownStart].stunned || !state.bodies[ownStart + 1].stunned || !state.bodies[ownStart + 2].stunned;
  const activeBuf = [0, 0, 0], fallbackBuf = [0, 0, 0];
  const refineStart = evaluated;
  const refineSpan = Math.max(1, settings.candidates - refineStart);

  let loopGuard = 0;
  const maxLoopSteps = settings.candidates * 3;
  while (evaluated < settings.candidates && anyUnstunned && ++loopGuard <= maxLoopSteps) {
    const frac = (evaluated - refineStart) / refineSpan;
    if (evaluated % 4 === 0 && frac < 0.85) {
      if (consider(teamPlan(), false)) continue;
    }
    const next = [copy(best[0]), copy(best[1]), copy(best[2])];
    const mask = activeMaskOf(best);
    const concedingCrisis = bestMin <= -weights.goal * 0.5;
    let actLen = 0, fbLen = 0;
    for (let idx = 0; idx < 3; idx++) {
      const skB = state.bodies[ownStart + idx];
      if (skB.stunned) continue;
      if (!next[idx].guard || concedingCrisis) {
        fallbackBuf[fbLen++] = idx;
        const isDef = idx === defRoleIdx || Math.abs(skB.x - ownGoalX) < 190;
        if (((mask & (1 << idx)) && next[idx].power > 0) || (concedingCrisis && isDef)) {
          activeBuf[actLen++] = idx;
        }
      }
    }
    const useActive = actLen > 0 && random() < 0.78;
    const pool = useActive ? activeBuf : fallbackBuf;
    const poolLen = useActive ? actLen : fbLen;
    if (!poolLen) {
      consider(teamPlan(), false);
      continue;
    }
    const fineGear = frac >= 0.60;
    const angSpan = fineGear ? 0.09 : 0.28;
    const pwrSpan = fineGear ? 0.09 : 0.25;
    const dualEdit = settings.godRefine && poolLen >= 2 && random() < 0.30;
    const nEdits = dualEdit ? 2 : 1;
    const pick0 = Math.floor(random() * poolLen);
    for (let e = 0; e < nEdits; e++) {
      const i = e === 0 ? pool[pick0] : pool[(pick0 + 1) % poolLen];
      const sk = state.bodies[ownStart + i];
      if (step4Threat.shotDanger && !startCreaseWarned && i === defRoleIdx && !next[i].guard && Math.hypot(sk.x - ownGoalX, sk.y - RINK_CY) < 105 && random() < 0.08) {
        next[i].angle = 0;
        next[i].power = 0;
        next[i].spin = 0;
        next[i].guard = true;
        next[i].superArm = Boolean(!classic && sk.meter >= 100 && sk.equippedSuper?.key?.toLowerCase() === 'stalwart');
        continue;
      }
      if (next[i].guard) {
        next[i].guard = false;
        const pPt = goalPocketPoint(state.bodies[6].x, state.bodies[6].y, team, canOccupyCrease(state, team, i));
        const rescue = aim(sk, pPt.x, pPt.y, 40, null, 0);
        next[i].angle = rescue.angle;
        next[i].power = Math.max(0.25, rescue.power);
      }
      next[i].angle += (random() - 0.5) * angSpan;
      next[i].power = Math.max(0, Math.min(1, (next[i].power || 0.45) + (random() - 0.5) * pwrSpan));
      if (next[i].power > 0) {
        const sk = state.bodies[ownStart + i];
        const spinSpan = fineGear ? 0.20 : (0.35 + 0.35 * creativityOf(sk));
        next[i].spin = Math.max(-1, Math.min(1, next[i].spin + (random() - 0.5) * spinSpan));
        if (!classic && sk.meter >= 100 && sk.equippedSuper && random() < 0.18) {
          next[i].superArm = !next[i].superArm;
        }
      } else {
        next[i].angle = 0;
        next[i].spin = 0;
      }
    }
    consider(next, false);
  }

  // 5. Optional screenTop path when caller explicitly specifies settings.screenTop
  if (useScreenTop && finalists.length) {
    const byBasin = new Map();
    for (let k = 0; k < finalists.length; k++) {
      const f = finalists[k];
      const bKey = planBasinKey(f.moves);
      f.basin = bKey;
      const prev = byBasin.get(bKey);
      if (!prev || f.preVal > prev.preVal) byBasin.set(bKey, f);
    }
    const distinct = Array.from(byBasin.values());
    distinct.sort((a, b) => b.preVal - a.preVal);
    const topK = Math.min(distinct.length, settings.screenTop);
    for (let idx = 0; idx < topK; idx++) {
      const cand = distinct[idx];
      const values = new Array(respCount);
      values[0] = cand.v0;
      for (let r = 1; r < respCount; r++) {
        values[r] = simulate(cand.moves, responses[r], r);
      }
      const entry = {
        moves: cand.moves,
        value: combineValues(values, cand.fit),
        basin: cand.basin,
        fit: cand.fit,
        values,
        meta: rolloutMeta.get(planKey(cand.moves, 0)),
        wobbled: settings.wobble === false
      };
      ensureWobbled(entry);
      scored.push(entry);
    }
  }

  // 6. Trajectory-Aware Adversarial Counter-Search (Hard+) + Mandatory Runner-Up Wobble Verification
  let finalPool = scored;
  if (settings.counterBudget > 0 && evaluated > 4 && scored.length > 1) {
    const oppTeam = 1 - team, oppStart = oppTeam * 3;
    const oppJobs = roles(state, oppTeam);
    const oppOwnGoal = oppTeam ? RINK_RIGHT : RINK_LEFT;
    const ball = state.bodies[6];
    const byBasin = new Map();
    for (let s = 0; s < scored.length; s++) {
      const entry = scored[s];
      const key = entry.basin || planBasinKey(entry.moves);
      entry.basin = key;
      const prev = byBasin.get(key);
      if (!prev || entry.value > prev.value) byBasin.set(key, entry);
    }
    const ranked = Array.from(byBasin.values()).sort((a, b) => b.value - a.value);
    const topLimit = settings.counterTop || 8;
    const topBasins = ranked.slice(0, topLimit);
    const counterThreat = assessOpponentThreat(state, team, classic);
    if (counterThreat.shotDanger && ranked.length > topLimit && topBasins[0].value < weights.goal * 0.9) {
      const dIdx = jobs.indexOf('defend') >= 0 ? jobs.indexOf('defend') : 0;
      const ourGoalX = team ? RINK_RIGHT : RINK_LEFT;
      const staysInPocket = entry => {
        const b = state.bodies[ownStart + dIdx], m = entry.moves[dIdx];
        if (!m) return false;
        if (m.guard || !m.power) return Math.abs(b.x - ourGoalX) < 105;
        const endX = b.x + Math.cos(m.angle) * m.power * P.launchSpeed(b) * 0.28;
        return Math.abs(endX - ourGoalX) < 75;
      };
      if (!topBasins.some(e => e.moves[dIdx]?.guard)) {
        const bestGuard = ranked.slice(topLimit).find(e => e.moves[dIdx]?.guard);
        if (bestGuard && topBasins.length >= 3) topBasins[topBasins.length - 1] = bestGuard;
      }
      if (topLimit >= 5 && !topBasins.some(staysInPocket)) {
        const bestPocket = ranked.slice(topLimit).find(e => staysInPocket(e) && !topBasins.includes(e));
        if (bestPocket) topBasins[topBasins.length - 2] = bestPocket;
      }
      // Also ensure at least one non-conceding pocket/cover plan is in topBasins if top slots are filled by high-variance gambles.
      const zeroConcedePocket = e => staysInPocket(e) && e.values && e.values.every(v => v > -weights.goal * 0.5);
      if (topLimit >= 5 && !topBasins.some(zeroConcedePocket)) {
        const safePkt = ranked.slice(topLimit).find(e => zeroConcedePocket(e) && !topBasins.includes(e));
        if (safePkt) topBasins[topBasins.length - 1] = safePkt;
      }
    }
    const usedRespKeys = new Map();
    for (let r = 0; r < responses.length; r++) usedRespKeys.set(planKey(responses[r], 0), r);

    const oppSuperOf = idx => {
      const ob = state.bodies[oppStart + idx];
      return (!classic && !ob.stunned && (ob.meter ?? 0) >= 100 && ob.equippedSuper)
        ? ob.equippedSuper.key?.toLowerCase()
        : null;
    };

    function findCounter(targetMoves, seedOpp, budget, scoringOnly = false) {
      const seenOpp = new Set([planKey(seedOpp, 0)]);
      const seedOut = runRollout(targetMoves, seedOpp, true);
      let oppBest = seedOpp, oppBestScore = seedOut.valOpp, targetValUs = seedOut.val, oppBestEndY = seedOut.endBallY;
      let oppEval = 1;

      function tryOpp(candOpp) {
        if (oppEval >= budget) return false;
        const k = planKey(candOpp, 0);
        if (seenOpp.has(k)) return false;
        seenOpp.add(k);
        const out = runRollout(targetMoves, candOpp, true);
        oppEval++;
        if (out.valOpp > oppBestScore + 1e-8) {
          oppBest = candOpp;
          oppBestScore = out.valOpp;
          targetValUs = out.val;
          oppBestEndY = out.endBallY;
        }
        return true;
      }

      // Phase A2 helper: Opponent Scoring Punish — expose empty-net gambles, wall banks, un-guarded fireballs, goalie checks & Snap passes
      function runScoringPunish() {
        if (seedOut.goalScored === team || oppEval >= budget || !counterThreat.shotDanger) return;
        const ourGoalX = team ? RINK_RIGHT : RINK_LEFT;
        const oppStr = counterThreat.oppStrikerIdx;
        if (oppStr < 0 || Math.abs(ball.x - ourGoalX) >= 720) return;
        const sb = state.bodies[oppStart + oppStr], sSup = oppSuperOf(oppStr);
        const armShot = (sSup === 'cannonball' || sSup === 'sticky' || sSup === 'ghost') ? sSup : null;
        const tArr = Math.min(0.68, Math.max(0.18, Math.abs(ball.x - ourGoalX) / 860 + Math.min(0.35, counterThreat.bestOppT || 0)));
        const projOur = [0, 1, 2].map(k => {
          const uk = state.bodies[ownStart + k], mvk = targetMoves[k];
          if (uk.carded) return uk;
          if (!mvk || mvk.guard || !mvk.power) return uk;
          const spd = mvk.power * P.launchSpeed(uk);
          const fric = uk.friction || 150;
          const tMove = Math.min(tArr, spd / fric);
          const dMove = spd * tMove - 0.5 * fric * tMove * tMove;
          return {
            ...uk,
            x: uk.x + Math.cos(mvk.angle) * dMove,
            y: uk.y + Math.sin(mvk.angle) * dMove,
            radius: uk.radius
          };
        });

        const dIdx = jobs.indexOf('defend') >= 0 ? jobs.indexOf('defend') : 0;
        const punishAp = scanGoalAperture(ball, ourGoalX, projOur);
        const goalieProj = projOur[dIdx];
        const farCornerY = goalieProj.y <= RINK_CY ? RINK_CY + 38 : RINK_CY - 38;
        const nearCornerY = goalieProj.y <= RINK_CY ? RINK_CY - 38 : RINK_CY + 38;
        const shotYs = [];
        if (punishAp.y !== RINK_CY) shotYs.push(punishAp.y);
        if (Math.abs(goalieProj.y - RINK_CY) > 18 && !shotYs.includes(RINK_CY)) shotYs.push(RINK_CY);
        if (!shotYs.includes(farCornerY)) shotYs.push(farCornerY);
        if (shotYs.length < 2 && !shotYs.includes(nearCornerY)) shotYs.push(nearCornerY);

        for (const shotY of shotYs) {
          if (oppEval >= budget || oppBestScore >= rawWeights.goal * 0.95) break;
          const cSnipe = oppBest.slice();
          const snipeMv = strike(sb, ball, ourGoalX, shotY, armShot, 0, SHOT_DRIVE);
          snipeMv.power = 1;
          if (armShot) snipeMv.superArm = true;
          cSnipe[oppStr] = snipeMv;
          tryOpp(cSnipe);
        }

        // Test flat-wall bank shots (top/bottom wall reflections into open goal mouth)
        if (oppEval < budget && oppBestScore < rawWeights.goal * 0.95) {
          const bInfo = bestBankTargetY(ball, ourGoalX, goalieProj.y, projOur);
          if (bInfo) {
            const cBank = oppBest.slice();
            const bMv = strike(sb, ball, ourGoalX, bInfo.bankY, armShot, 0, SHOT_DRIVE);
            bMv.power = 1;
            if (armShot) bMv.superArm = true;
            cBank[oppStr] = bMv;
            tryOpp(cBank);
          }
          if (oppEval < budget && oppBestScore < rawWeights.goal * 0.95) {
            const ballR = ball.radius || 18;
            const altSide = (bInfo && bInfo.wallSide < 0) ? 1 : -1;
            const altWallY = altSide > 0 ? (RINK_BOTTOM - ballR) : (RINK_TOP + ballR);
            const altGoalY = altSide > 0 ? (RINK_CY - 24) : (RINK_CY + 24);
            const altBankY = 2 * altWallY - altGoalY;
            const cBank2 = oppBest.slice();
            const bMv2 = strike(sb, ball, ourGoalX, altBankY, armShot, 0, SHOT_DRIVE);
            bMv2.power = 1;
            if (armShot) bMv2.superArm = true;
            cBank2[oppStr] = bMv2;
            tryOpp(cBank2);
          }
        }

        // Test 2-on-1 goalie check + shot when a second opponent can knock our goalie out of position
        if (oppEval < budget && oppBestScore < rawWeights.goal * 0.95) {
          let gChecker = -1, bestGD = 260;
          for (let i = 0; i < 3; i++) {
            if (i === oppStr) continue;
            const ob = state.bodies[oppStart + i];
            if (ob.stunned || ob.carded) continue;
            const gd = Math.hypot(ob.x - goalieProj.x, ob.y - goalieProj.y);
            if (gd < bestGD) { bestGD = gd; gChecker = i; }
          }
          if (gChecker >= 0) {
            const cb = state.bodies[oppStart + gChecker], cSup = oppSuperOf(gChecker);
            const armC = (cSup === 'knockout' || cSup === 'shockwave' || cSup === 'colossus') ? cSup : null;
            const chkMv = aim(cb, goalieProj.x, goalieProj.y, 240, armC, 0);
            if (armC) chkMv.superArm = true;
            const cScreen = oppBest.slice();
            const sMv = strike(sb, ball, ourGoalX, RINK_CY, armShot, 0, SHOT_DRIVE);
            sMv.power = 1;
            if (armShot) sMv.superArm = true;
            cScreen[oppStr] = sMv;
            cScreen[gChecker] = chkMv;
            tryOpp(cScreen);
          }
        }

        if (oppEval < budget && oppBestScore < rawWeights.goal * 0.95 && counterThreat.oppReceiverIdx >= 0 && counterThreat.oppReceiverIdx !== oppStr) {
          const oppJoint = jointTeamPlays(state, oppTeam, oppBest, oppJobs);
          const snapJ = oppJoint.find(jp => getIntent(jp[oppStr]) === 'pass' && getIntent(jp[counterThreat.oppReceiverIdx]) === 'shoot');
          if (snapJ) {
            tryOpp(snapJ);
            if (oppEval < budget && oppBestScore < rawWeights.goal * 0.95) {
              const crispSnap = snapJ.slice();
              crispSnap[oppStr] = { ...snapJ[oppStr], power: Math.min(1, snapJ[oppStr].power * 1.14) };
              tryOpp(crispSnap);
            }
          }
        }

        if (oppEval < budget && oppBestScore < rawWeights.goal * 0.95) {
          if (sSup === 'cannonball') {
            const gy = goalieProj.y;
            for (const offY of [-32, 32]) {
              if (oppEval >= budget || oppBestScore >= rawWeights.goal * 0.95) break;
              const cGlance = oppBest.slice();
              const gMv = strike(sb, ball, ourGoalX, Math.max(GOAL_Y_TOP + 18, Math.min(GOAL_Y_BOT - 18, gy + offY)), armShot, 0, SHOT_DRIVE);
              gMv.power = 1;
              if (armShot) gMv.superArm = true;
              cGlance[oppStr] = gMv;
              tryOpp(cGlance);
            }
          } else {
            const spinDir = oppTeam ? -1 : 1;
            for (const sideSign of [-1, 1]) {
              if (oppEval >= budget || oppBestScore >= rawWeights.goal * 0.95) break;
              const cBender = oppBest.slice();
              const rawAimY = RINK_CY + sideSign * 110;
              const bMv = strike(sb, ball, ourGoalX, rawAimY, null, 0, SHOT_DRIVE);
              bMv.power = 1;
              bMv.spin = sideSign * spinDir;
              cBender[oppStr] = bMv;
              tryOpp(cBender);
            }
          }
        }
      }

      // During live shotDanger when CPU didn't already score, prioritize exposing open-net / bank goals FIRST!
      if (counterThreat.shotDanger && seedOut.goalScored !== team) {
        runScoringPunish();
        if (scoringOnly || oppBestScore >= rawWeights.goal * 0.95) {
          return { moves: oppBest, valForUs: targetValUs, endBallY: oppBestEndY };
        }
      }

      // Phase A: Targeted intercepts against the actual ball trajectory & active CPU playmakers from seedOut
      const endBx = seedOut.endBallX, endBy = seedOut.endBallY;
      const midX = Math.max(RINK_LEFT + 42, Math.min(RINK_RIGHT - 42, (ball.x + endBx) * 0.5));
      const midY = Math.max(RINK_TOP + 42, Math.min(RINK_BOTTOM - 42, (ball.y + endBy) * 0.5));
      const plugX = oppOwnGoal + (oppTeam ? -88 : 88);
      const plugY = Math.max(RINK_CY - 48, Math.min(RINK_CY + 48, seedOut.goalScored === team ? RINK_CY + (endBy - RINK_CY) * 0.85 : endBy));

      let iPlug = -1, bestPlugD = Infinity, iMid = -1, bestMidD = Infinity;
      for (let i = 0; i < 3; i++) {
        const ob = state.bodies[oppStart + i];
        if (ob.stunned || ob.carded) continue;
        const dp = Math.hypot(ob.x - plugX, ob.y - plugY);
        if (dp < bestPlugD) { bestPlugD = dp; iPlug = i; }
        const dm = Math.hypot(ob.x - midX, ob.y - midY);
        if (dm < bestMidD) { bestMidD = dm; iMid = i; }
      }
      if (iPlug >= 0) {
        const ob = state.bodies[oppStart + iPlug], oSup = oppSuperOf(iPlug);
        const armP = (oSup === 'stalwart' || oSup === 'colossus' || oSup === 'magnet') ? oSup : null;
        const plugMv = aim(ob, plugX, plugY, 115, armP, 0);
        if (armP) plugMv.superArm = true;
        const cPlug = oppBest.slice();
        cPlug[iPlug] = plugMv;
        tryOpp(cPlug);
        if (iMid >= 0 && iMid !== iPlug && seedOut.goalScored === team) {
          const mb = state.bodies[oppStart + iMid], mSup = oppSuperOf(iMid);
          const armM = (mSup === 'sticky' || mSup === 'magnet' || mSup === 'colossus' || mSup === 'shockwave') ? mSup : null;
          const midMv = aim(mb, midX, midY, 195, armM, 0);
          if (armM) midMv.superArm = true;
          const cDouble = cPlug.slice();
          cDouble[iMid] = midMv;
          tryOpp(cDouble);
        }
      }
      if (iMid >= 0) {
        const mb = state.bodies[oppStart + iMid], mSup = oppSuperOf(iMid);
        const armM = (mSup === 'sticky' || mSup === 'magnet' || mSup === 'colossus' || mSup === 'shockwave') ? mSup : null;
        const midMv = aim(mb, midX, midY, 195, armM, 0);
        if (armM) midMv.superArm = true;
        const cMid = oppBest.slice();
        cMid[iMid] = midMv;
        tryOpp(cMid);
      }

      // Body-check the active CPU skater(s) who touched/drove the ball in seedOut
      const aMask = seedOut.activeMask;
      for (let k = 0; k < 3 && oppEval < budget; k++) {
        if (!(aMask & (1 << k))) continue;
        const uk = state.bodies[ownStart + k], mvk = targetMoves[k];
        const ukX = uk.x + (mvk.power > 0 && !mvk.guard ? Math.cos(mvk.angle) * 75 : 0);
        const ukY = uk.y + (mvk.power > 0 && !mvk.guard ? Math.sin(mvk.angle) * 75 : 0);
        let bestChecker = -1, bestChkD = Infinity;
        for (let i = 0; i < 3; i++) {
          const ob = state.bodies[oppStart + i];
          if (ob.stunned || ob.carded) continue;
          const d = Math.hypot(ob.x - ukX, ob.y - ukY);
          if (d < bestChkD) { bestChkD = d; bestChecker = i; }
        }
        if (bestChecker >= 0) {
          const cb = state.bodies[oppStart + bestChecker], cSup = oppSuperOf(bestChecker);
          const armC = (cSup === 'knockout' || cSup === 'shockwave' || cSup === 'colossus') ? cSup : null;
          const chkMv = aim(cb, ukX, ukY, 225, armC, 0);
          if (armC) chkMv.superArm = true;
          const cChk = oppBest.slice();
          cChk[bestChecker] = chkMv;
          tryOpp(cChk);
        }
      }

      // Phase B: Coordinated opponent team plays (including Defensive Fire Drill & Snap one-timers)
      const jointCap = Math.min(budget, oppEval + Math.max(2, Math.floor(budget * 0.25)));
      if (oppEval < jointCap) {
        const oppJoint = jointTeamPlays(state, oppTeam, oppBest, oppJobs);
        for (let jp = 0; jp < oppJoint.length && oppEval < jointCap; jp++) tryOpp(oppJoint[jp]);
      }

      // Phase C: Single-skater option sweep starting at j=3 (skipping redundant HOLD/GUARD/cleanBase slots)
      if (oppEval < budget) {
        const oppChoices = [0, 1, 2].map(i => options(state, oppTeam, i, oppBest[i]));
        const maxLen = Math.max(oppChoices[0].length, oppChoices[1].length, oppChoices[2].length);
        for (let j = 3; j < maxLen && oppEval < budget; j++) {
          for (let i = 0; i < 3 && oppEval < budget; i++) {
            const opt = oppChoices[i][j];
            if (opt) {
              const nextOpp = oppBest.slice();
              nextOpp[i] = opt;
              tryOpp(nextOpp);
            }
          }
        }
      }
      return { moves: oppBest, valForUs: targetValUs, endBallY: oppBestEndY };
    }

    // Ensure #1 entering counter-search is wobble-verified
    while (topBasins.length && !topBasins[0].wobbled) {
      ensureWobbled(topBasins[0]);
      topBasins.sort((a, b) => b.value - a.value);
    }

    let prevTarget = null;
    const baseRounds = settings.counterRounds || 1;
    let maxRounds = baseRounds;
    for (let round = 0; round < maxRounds; round++) {
      const target = topBasins[0];
      if (!target || target === prevTarget || !target.values) break;
      prevTarget = target;
      let worstIdx = 0;
      for (let r = 1; r < target.values.length; r++) {
        if (target.values[r] < target.values[worstIdx]) worstIdx = r;
      }
      const isExtraDefRound = round >= baseRounds;
      const rBudget = isExtraDefRound ? Math.min(8, settings.counterBudget) : settings.counterBudget;
      const counter = findCounter(target.moves, responses[worstIdx] || responses[0], rBudget, isExtraDefRound);
      const cKey = planKey(counter.moves, 0);
      if (usedRespKeys.has(cKey)) break;
      const rNew = responses.length;
      usedRespKeys.set(cKey, rNew);
      responses.push(counter.moves);
      results.set(planKey(target.moves, rNew), counter.valForUs);

      for (let k = 0; k < topBasins.length; k++) {
        const cand = topBasins[k];
        const vNew = k === 0 ? counter.valForUs : simulate(cand.moves, counter.moves, rNew);
        cand.values.push(vNew);
        cand.value = combineValues(cand.values, cand.fit);
      }
      topBasins.sort((a, b) => b.value - a.value);

      // Post-counter goalie-only rescue pass: if the counter exposed a goal against #1 and EVERY finalist now concedes
      // at least one scenario, test a few targeted defender adjustments on `target` against the new counter first.
      if (counterThreat.shotDanger && counter.valForUs <= -weights.goal * 0.5 &&
          topBasins[0]?.values?.some(v => v <= -weights.goal * 0.85)) {
        const dIdx = defRoleIdx >= 0 ? defRoleIdx : 0;
        const defB = state.bodies[ownStart + dIdx];
        if (!defB.stunned && !defB.carded) {
          const repairOpts = [];
          const seenRep = new Set([getMoveId(target.moves[dIdx])]);
          const addRep = mv => {
            if (!mv || repairOpts.length >= 5) return;
            const id = getMoveId(mv);
            if (seenRep.has(id)) return;
            seenRep.add(id);
            repairOpts.push(mv);
          };
          // Aim directly at the goal-mouth Y where the counter just scored (inside the crease pocket if legal).
          if (Number.isFinite(counter.endBallY) && counter.endBallY >= GOAL_Y_TOP - 20 && counter.endBallY <= GOAL_Y_BOT + 20) {
            const allowP = canOccupyCrease(state, team, dIdx);
            const saveX = allowP ? (ownGoalX + (team ? -44 : 44)) : (ownGoalX + (team ? -88 : 88));
            const clampY = Math.max(GOAL_Y_TOP + 22, Math.min(GOAL_Y_BOT - 22, counter.endBallY));
            addRep(aim(defB, saveX, clampY, 120, null, 0));
          }
          const defChoices = choices[dIdx] || [];
          for (let ci = 0; ci < Math.min(8, defChoices.length) && repairOpts.length < 5; ci++) {
            const c = defChoices[ci];
            const it = getIntent(c);
            if (c.guard || it === 'cover') addRep(c);
          }
          for (let ri = 0; ri < repairOpts.length; ri++) {
            const repMoves = target.moves.slice();
            repMoves[dIdx] = repairOpts[ri];
            const vCounter = simulate(repMoves, counter.moves, rNew);
            if (vCounter <= -weights.goal * 0.5) continue;
            const repVals = new Array(responses.length);
            repVals[rNew] = vCounter;
            let concedesOld = false;
            for (let r = 0; r < rNew; r++) {
              const vr = simulate(repMoves, responses[r], r);
              repVals[r] = vr;
              if (vr <= -weights.goal * 0.85) { concedesOld = true; break; }
            }
            if (!concedesOld) {
              const repFit = roleFit(repMoves);
              const repEntry = {
                moves: repMoves,
                value: combineValues(repVals, repFit),
                basin: planBasinKey(repMoves),
                fit: repFit,
                values: repVals,
                meta: rolloutMeta.get(planKey(repMoves, 0)),
                wobbled: settings.wobble === false
              };
              topBasins.push(repEntry);
              topBasins.sort((a, b) => b.value - a.value);
              if (topBasins.length > topLimit) topBasins.length = topLimit;
              break;
            }
          }
        }
      }

      // If counter-search exposed a goal against #1 during shotDanger and promoted a new leader, verify the new leader too!
      if (round === baseRounds - 1 && counterThreat.shotDanger && counter.valForUs <= -weights.goal * 0.5 && topBasins[0] !== prevTarget) {
        maxRounds = baseRounds + 1;
      }

      // If counter-search knocked down #1 and promoted an unwobbled runner-up, wobble-verify the new leader immediately!
      while (topBasins.length && !topBasins[0].wobbled) {
        ensureWobbled(topBasins[0]);
        topBasins.sort((a, b) => b.value - a.value);
      }
    }
    finalPool = topBasins;
  }

    ({ finalPool, simulations, ticks } = runMultiTurnLookahead({
      settings, evaluated, finalPool, pulse, fullTurnTicks, state, team, classic,
      weights, tmw, maxGoal, ensureWobbled, responses, combineValues, pruneMargin, simulations, ticks
    }));
  // Before final selection, guarantee that the leader and any contender within the style/Boltzmann window is wobble-verified
  if (settings.wobble !== false && finalPool.length > 0) {
    const byBasin = new Map();
    for (let s = 0; s < finalPool.length; s++) {
      const entry = finalPool[s];
      const key = entry.basin || planBasinKey(entry.moves);
      entry.basin = key;
      const prev = byBasin.get(key);
      if (!prev || entry.value > prev.value) byBasin.set(key, entry);
    }
    const distinctPool = Array.from(byBasin.values()).sort((a, b) => b.value - a.value);
    while (distinctPool.length && !distinctPool[0].wobbled) {
      ensureWobbled(distinctPool[0]);
      distinctPool.sort((a, b) => b.value - a.value);
    }
    const leaderVal = distinctPool[0]?.value ?? -Infinity;
    const contendMargin = Math.max(20, 3 * settings.temperature);
    for (let i = 1; i < distinctPool.length; i++) {
      if (!distinctPool[i].wobbled && distinctPool[i].value >= leaderVal - contendMargin) {
        ensureWobbled(distinctPool[i]);
      }
    }
    // Under live shotDanger, also wobble-verify the top 2 finalists against their worst non-legacy threat shot.
    if (step4Threat.shotDanger && responses.length >= 2) {
      distinctPool.sort((a, b) => b.value - a.value);
      const nTW = Math.min(2, distinctPool.length);
      for (let i = 0; i < nTW; i++) ensureThreatWobbled(distinctPool[i]);
      distinctPool.sort((a, b) => b.value - a.value);
    }
    finalPool = distinctPool;
  }

  const chosen = choose(finalPool, settings.temperature, random, style);
  return {
    plans: M.validatePlans(chosen.moves),
    diagnostics: { level, candidates: evaluated, simulations, ticks, score: chosen.value, milliseconds: performance.now() - started }
  };
}

function styleBias(entry, style) {
  if (!style) return 0;
  const moves = entry.moves;
  let pwrSum = 0, spinSum = 0, fwdSum = 0, passScore = 0, checkScore = 0, rimScore = 0, guardCount = 0, armCount = 0;
  for (let i = 0; i < 3; i++) {
    const m = moves[i], intent = getIntent(m);
    if (m.guard || !m.power) { guardCount++; continue; }
    pwrSum += m.power;
    spinSum += Math.abs(m.spin || 0);
    fwdSum += m.power * Math.cos(m.angle) * style.dir;
    if (m.superArm) armCount++;
    if (intent === 'pass' || intent === 'receive' || intent === 'draft') passScore += 0.5;
    else if (intent === 'check') checkScore += 0.5;
    else if (intent === 'rim' || intent === 'magnet') rimScore += 0.5;
  }
  const aggTerm = (style.agg - 0.5) * ((pwrSum / 3 - 0.45) * 4 + (fwdSum / 3) * 2 + checkScore - guardCount * 0.4);
  const tmwTerm = (style.tmw - 0.5) * ((entry.meta?.multiTeamTouch ? 1.5 : 0) + passScore);
  const creTerm = (style.cre - 0.5) * ((spinSum / 3) * 3 + Math.min(2, entry.meta?.boards || 0) * 0.5 + rimScore);
  let spreadTerm = 0;
  if (style.surge && entry.values && entry.values.length > 1) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < entry.values.length; i++) {
      if (entry.values[i] < lo) lo = entry.values[i];
      if (entry.values[i] > hi) hi = entry.values[i];
    }
    spreadTerm = style.surge * (Math.min(1.5, (hi - lo) / 400) + armCount * 0.4);
  }
  const raw = (aggTerm + tmwTerm + creTerm + spreadTerm) * 4;
  return raw > 8 ? 8 : (raw < -8 ? -8 : raw);
}

function choose(scored, temperature, random, style = null) {
  const byBasin = new Map();
  for (let s = 0; s < scored.length; s++) {
    const entry = scored[s];
    const key = entry.basin || planBasinKey(entry.moves);
    const prev = byBasin.get(key);
    if (!prev || entry.value > prev.value) byBasin.set(key, entry);
  }
  const pool = byBasin.size > 0 ? Array.from(byBasin.values()) : scored;
  const nPool = pool.length;
  if (nPool === 1) return pool[0];

  let topObj = -Infinity;
  for (let s = 0; s < nPool; s++) {
    if (pool[s].value > topObj) topObj = pool[s].value;
  }

  const eff = new Float64Array(nPool);
  let effTop = -Infinity, topIdx = 0;
  for (let s = 0; s < nPool; s++) {
    const v = pool[s].value;
    const ev = v + (v >= topObj - 20 ? styleBias(pool[s], style) : 0);
    eff[s] = ev;
    if (ev > effTop) { effTop = ev; topIdx = s; }
  }

  const wArr = new Float64Array(nPool);
  let wSum = 0;
  for (let s = 0; s < nPool; s++) {
    const diff = (eff[s] - effTop) / temperature;
    const w = diff < -40 ? 0 : Math.exp(diff);
    wArr[s] = w;
    wSum += w;
  }
  if (wSum <= 0) return pool[topIdx];
  let pick = random() * wSum;
  for (let i = 0; i < nPool; i++) if ((pick -= wArr[i]) <= 0) return pool[i];
  return pool[topIdx];
}


module.exports = { prepareSearchState, plan, styleBias, choose };
