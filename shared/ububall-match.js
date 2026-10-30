/* Shared match rules; callers supply authenticated, server-derived roster data. */
(function(root) {
  'use strict';
  const VERSION = 2;
  // Classic, Blitz and Pulse are independent rules, joined in this order; 'standard' has none.
  const RULES = ['classic', 'blitz', 'pulse'];
  const MODES = Array.from({ length: 8 }, (_, n) => RULES.filter((r, i) => n >> i & 1).join('-') || 'standard');
  const BLITZ_MILLISECONDS = 5000, TURN_TICKS = 2880, PULSE_TICKS = 240;
  const GOAL_REPLAY_DELAY = 1600, GOAL_REPLAY_HOLD = 1200;
  // Goal replays run in real time, then ease to half speed over the last second before the goal.
  function replaySpeed(ticksLeft) { return .5 + .5 * Math.min(1, Math.max(0, (ticksLeft - 72) / 168)); }
  // Wall-clock length of a goal's celebration delay, replay and closing hold.
  function replayMilliseconds(P, ticks) {
    let ms = GOAL_REPLAY_DELAY + GOAL_REPLAY_HOLD;
    for (let left = ticks; left > 0; left--) ms += P.DT * 1000 / replaySpeed(left);
    return Math.ceil(ms);
  }
  function validatePlans(input) {
    if (!Array.isArray(input) || input.length !== 3) throw new Error('Submit exactly three moves.');
    return input.map(p => {
      if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !['angle', 'power', 'spin', 'superArm', 'guard'].includes(k)) ||
          !Number.isFinite(p.angle) || !Number.isFinite(p.power) || !Number.isFinite(p.spin) ||
          p.power < 0 || p.power > 1 || p.spin < -1 || p.spin > 1 || typeof p.superArm !== 'boolean' || typeof p.guard !== 'boolean') throw new Error('Invalid move.');
      // A guarding ubu brakes instead of launching.
      if (p.guard) return { angle: 0, power: 0, spin: 0, superArm: p.superArm, guard: true };
      return { angle: ((p.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), power: p.power, spin: p.spin, superArm: p.superArm, guard: false };
    });
  }
  function rule(mode, name) {
    if (!MODES.includes(mode)) throw new Error('Invalid mode.');
    return mode.split('-').includes(name);
  }
  function modeName(mode) {
    return ['Ububall', ...RULES.filter(r => rule(mode, r)).map(r => r[0].toUpperCase() + r.slice(1))].join(' ');
  }
  function planningMilliseconds(mode) { return rule(mode, 'blitz') ? BLITZ_MILLISECONDS : null; }
  // Pulse turns stop after one second of simulation instead of waiting for the field to settle.
  function turnTicks(mode) { return rule(mode, 'pulse') ? PULSE_TICKS : TURN_TICKS; }
  function applyStats(P, body, raw, mode) {
    P.applyStats(body, rule(mode, 'classic') ? {} : raw);
  }
  // Meter values (owner decision 2026-10-30): meter comes from contact, conceding, aces (a goal on a
  // round's first turn, to the scorer) and saves.
  // Contact counts only for real impacts against the ball or an opponent, at most once per
  // cooldown per ubu, so pinging around the ball or an enemy cannot farm it (cooldown and
  // impact speed are tuning, not owner decisions).
  const METER = Object.freeze({ ball: 8, check: 4, conceded: 6, ace: 10, save: 6, teammate: .15, minSpeed: 60, cooldownTicks: 360 });
  function gainMeter(P, bodies, stats, body, amount, classic = false) {
    const changed = [];
    if (classic || !body || body.team < 0 || body.usedSuperThisTurn) return changed;
    const index = bodies.indexOf(body);
    if (index < 0) return changed;
    const gain = amount * P.multiplier(stats[index]?.efficiency ?? 127);
    body.meter = Math.min(100, Math.max(0, (body.meter || 0) + gain)); changed.push(body);
    const synergy = P.multiplier(stats[index]?.synergy ?? 127);
    bodies.forEach((other, i) => {
      if (other === body || other.team !== body.team || other.usedSuperThisTurn) return;
      other.meter = Math.min(100, Math.max(0, (other.meter || 0) + gain * synergy * P.multiplier(stats[i]?.chemistry ?? 127) * METER.teammate));
      changed.push(other);
    });
    return changed;
  }
  function contactMeter(P, bodies, stats, a, b, speed, tick, classic = false) {
    const ball = a.team === -1 ? a : b.team === -1 ? b : null;
    if (speed < METER.minSpeed || (!ball && a.team === b.team)) return [];
    const changed = [];
    for (const body of ball ? [ball === a ? b : a] : [a, b]) {
      if (tick - (body.meterTick ?? -Infinity) < METER.cooldownTicks) continue;
      body.meterTick = tick;
      changed.push(...gainMeter(P, bodies, stats, body, ball ? METER.ball : METER.check, classic));
    }
    return changed;
  }
  // The ubu behind a real ball contact, or null.
  function toucher(a, b, speed) {
    if (speed < 15 || (a.team === -1) === (b.team === -1)) return null;
    return a.team === -1 ? b : a;
  }
  // Saves among the ubus (by index) that touched the ball in one tick: from the field as it stood
  // before that tick, the ball was heading into the ubu's own goal and would have gone in without it,
  // touching nothing but the posts and net.
  function saves(P, before, touched) {
    const ball = before.find(b => b.team === -1);
    return [...touched].filter(i => {
      const team = before[i].team;
      if (!ball || ball.stuckTo || team < 0 || (team ? ball.vx <= 0 : ball.vx >= 0)) return false;
      return P.wouldScore(before, before[i]) === 1 - team;
    });
  }
  // `ace` is the scorer's index when a goal came on the round's first turn.
  function finishTurn(P, bodies, stats, scores, goal, mode, ace = null) {
    const classic = rule(mode, 'classic');
    // Turn effects end every turn; in Pulse, momentum carries into the next one.
    P.stop(bodies, rule(mode, 'pulse') && goal === null);
    for (const b of bodies.slice(0, 6)) {
      if (b.stunnedNext) { b.stunned = true; delete b.stunnedNext; }
    }
    if (goal !== null) {
      scores[goal]++;
      for (const b of bodies.filter(b => b.team === 1 - goal)) gainMeter(P, bodies, stats, b, METER.conceded, classic);
      if (ace !== null) gainMeter(P, bodies, stats, bodies[ace], METER.ace, classic);
    }
    return goal !== null && scores[goal] >= 5 ? goal : null;
  }
  function resolveTurn(P, state, moves) {
    if (state.version !== VERSION || !MODES.includes(state.mode)) throw new Error('Unsupported match rules.');
    if (!Array.isArray(moves) || moves.length !== 6) throw new Error('Both teams must submit.');
    const plans = [...validatePlans(moves.slice(0, 3)), ...validatePlans(moves.slice(3))];
    const next = structuredClone(state), bodies = next.bodies;
    const classic = rule(state.mode, 'classic'), limit = turnTicks(state.mode);
    bodies.slice(0, 6).forEach((b, i) => {
      if (plans[i].superArm && (classic || b.stunned || b.meter < 100 || !b.equippedSuper)) throw new Error('Super unavailable.');
      b.superArm = false;
    });
    const initialBodies = structuredClone(bodies);
    // Touches persist until a goal, so a Pulse goal credits a touch from an earlier turn.
    const lastTouch = state.lastTouch ? [...state.lastTouch] : [null, null];
    P.startTurn(bodies, plans);
    // The match clock counts simulated ticks across turns for meter cooldowns.
    const clock = state.clock || 0;
    let goal = null, ticks = 0;
    const saved = [], touched = new Set();
    for (let tick = 1; tick <= limit; tick++) {
      const before = bodies.map(b => ({ ...b }));
      touched.clear();
      goal = P.step(bodies, P.DT, (a, b, speed) => {
        const player = toucher(a, b, speed);
        if (player) { lastTouch[player.team] = bodies.indexOf(player); touched.add(bodies.indexOf(player)); }
        contactMeter(P, bodies, next.stats, a, b, speed, clock + tick, classic);
      });
      for (const index of saves(P, before, touched)) {
        saved.push({ tick, index });
        gainMeter(P, bodies, next.stats, bodies[index], METER.save, classic);
      }
      ticks = tick;
      const done = goal !== null || P.settled(bodies) || tick === limit;
      if (done) break;
    }
    // A round runs from kickoff to goal; scoring on its first turn is an ace.
    const ace = goal !== null && !state.roundTurns, scorer = goal === null ? null : lastTouch[goal];
    next.winner = finishTurn(P, bodies, next.stats, next.scores, goal, state.mode, ace ? scorer : null);
    next.roundTurns = goal === null ? (state.roundTurns || 0) + 1 : 0;
    next.clock = clock + ticks;
    next.lastTouch = goal === null ? lastTouch : [null, null];
    next.turn++;
    next.phase = next.winner !== null ? 'over' : goal !== null ? 'goal' : 'plan';
    return { state: next, replay: { version: VERSION, turn: state.turn, plans, ticks, goal, scorer, ace, saves: saved, initialBodies } };
  }
  const api = { VERSION, RULES, MODES, GOAL_REPLAY_DELAY, GOAL_REPLAY_HOLD, replaySpeed, replayMilliseconds, validatePlans, rule, modeName, planningMilliseconds, turnTicks, applyStats, METER, gainMeter, contactMeter, toucher, saves, finishTurn, resolveTurn };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallMatch = api;
})(globalThis);
