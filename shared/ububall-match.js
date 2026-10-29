/* Shared match rules; callers supply authenticated, server-derived roster data. */
(function(root) {
  'use strict';
  const VERSION = 1;
  const MODES = ['standard', 'classic', 'blitz', 'classic-blitz'];
  function validatePlans(input) {
    if (!Array.isArray(input) || input.length !== 3) throw new Error('Submit exactly three moves.');
    return input.map(p => {
      if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !['angle', 'power', 'spin', 'superArm'].includes(k)) ||
          !Number.isFinite(p.angle) || !Number.isFinite(p.power) || !Number.isFinite(p.spin) ||
          p.power < 0 || p.power > 1 || p.spin < -1 || p.spin > 1 || typeof p.superArm !== 'boolean') throw new Error('Invalid move.');
      return { angle: ((p.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), power: p.power, spin: p.spin, superArm: p.superArm };
    });
  }
  function planningMilliseconds(mode, scorelessTurns) {
    if (!MODES.includes(mode)) throw new Error('Invalid mode.');
    return mode.includes('blitz') ? (scorelessTurns >= 10 ? 5000 : 10000) : null;
  }
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
      other.meter = Math.min(100, Math.max(0, (other.meter || 0) + gain * synergy * P.multiplier(stats[i]?.chemistry ?? 127) * .25));
      changed.push(other);
    });
    return changed;
  }
  function finishTurn(P, bodies, stats, scores, goal, classic = false) {
    P.stop(bodies);
    for (const b of bodies.slice(0, 6)) {
      if (b.stunnedNext) { b.stunned = true; delete b.stunnedNext; }
      gainMeter(P, bodies, stats, b, 10, classic);
    }
    if (goal !== null) {
      scores[goal]++;
      for (const b of bodies.filter(b => b.team === 1 - goal)) gainMeter(P, bodies, stats, b, 15, classic);
    }
    return goal !== null && scores[goal] >= 5 ? goal : null;
  }
  function resolveTurn(P, state, moves) {
    if (state.version !== VERSION || !MODES.includes(state.mode)) throw new Error('Unsupported match rules.');
    if (!Array.isArray(moves) || moves.length !== 6) throw new Error('Both teams must submit.');
    const plans = [...validatePlans(moves.slice(0, 3)), ...validatePlans(moves.slice(3))];
    const next = structuredClone(state), bodies = next.bodies;
    const classic = state.mode.includes('classic');
    bodies.slice(0, 6).forEach((b, i) => {
      if (plans[i].superArm && (classic || b.stunned || b.meter < 100 || !b.equippedSuper)) throw new Error('Super unavailable.');
      b.superArm = false;
    });
    const frames = [], lastTouch = [null, null];
    const record = tick => frames.push({ tick, bodies: bodies.map(b => ({ x: b.x, y: b.y, rotation: b.rotation,
      vx: b.vx, vy: b.vy, omega: b.omega, radius: b.radius, reach: b.reach ?? b.radius, meter: b.meter ?? 0, guarding: Boolean(b.guarding),
      superActive: b.superActive || null, stunned: Boolean(b.stunned || b.stunnedNext) })) });
    P.startTurn(bodies, plans); record(0);
    let goal = null, ticks = 0;
    for (let tick = 1; tick <= 2880; tick++) {
      goal = P.step(bodies, P.DT, (a, b, speed) => {
        if (speed < 15) return;
        if (a.team === -1 || b.team === -1) {
          const player = a.team === -1 ? b : a;
          lastTouch[player.team] = bodies.indexOf(player);
          gainMeter(P, bodies, next.stats, player, 18, classic);
        } else {
          gainMeter(P, bodies, next.stats, a, 10, classic);
          gainMeter(P, bodies, next.stats, b, 10, classic);
        }
      });
      ticks = tick;
      const done = goal !== null || P.settled(bodies) || tick === 2880;
      if (tick % 8 === 0 || done) record(tick);
      if (done) break;
    }
    next.winner = finishTurn(P, bodies, next.stats, next.scores, goal, classic);
    next.scorelessTurns = goal === null ? next.scorelessTurns + 1 : 0;
    next.turn++;
    next.phase = next.winner !== null ? 'over' : goal !== null ? 'goal' : 'plan';
    return { state: next, replay: { version: VERSION, turn: state.turn, plans, ticks, goal,
      scorer: goal === null ? null : lastTouch[goal], frames } };
  }
  const api = { VERSION, MODES, validatePlans, planningMilliseconds, gainMeter, finishTurn, resolveTurn };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallMatch = api;
})(globalThis);
