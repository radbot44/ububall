/* Deterministic, bounded team search. Uses the same turn resolver as matches. */
(function(root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const P = node ? require('../web/ububall-physics.js') : root.ububallPhysics;
  const M = node ? require('./ububall-match.js') : root.ububallMatch;
  const HOLD = Object.freeze({ angle: 0, power: 0, spin: 0, superArm: false });
  const LEVELS = Object.freeze({
    easy: Object.freeze({ candidates: 18, opponents: 1, risk: .15 }),
    medium: Object.freeze({ candidates: 60, opponents: 2, risk: .35 }),
    hard: Object.freeze({ candidates: 120, opponents: 3, risk: .55 })
  });
  const WEIGHTS = Object.freeze({ goal: 10000, progress: 1, access: .35, cover: .3, meter: .35 });
  function randomSource(seed = 1) {
    let value = seed >>> 0;
    return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
  }
  // The old planner attacks left. Reflect the complete graph for the other team.
  function legacy(state, team, random = () => .5) {
    const bodies = structuredClone(state.bodies);
    for (const b of bodies) { b.superArm = false; b.superActive = null; }
    if (team === 0) {
      for (const b of bodies) {
        b.x = 1000 - b.x; b.vx = -b.vx; b.omega = -b.omega;
        if (b.team >= 0) b.team = 1 - b.team;
        if (b.stickOffset) b.stickOffset.x = -b.stickOffset.x;
      }
      bodies.splice(0, 6, ...bodies.slice(3, 6), ...bodies.slice(0, 3));
    }
    return P.cpuPlans(bodies, random, team ? state.scores : [...state.scores].reverse()).map(p => ({
      angle: team ? p.angle : Math.PI - p.angle, power: p.power,
      spin: (p.spin || 0) * (team ? 1 : -1), superArm: Boolean(p.superArm)
    }));
  }
  function aim(body, x, y, drive = 0) {
    const distance = Math.hypot(x - body.x, y - body.y);
    return { angle: Math.atan2(y - body.y, x - body.x),
      power: distance < 2 ? 0 : Math.min(1, Math.sqrt(2 * body.friction * (distance + drive)) / ((body.impulse || P.IMPULSE) / body.mass)),
      spin: 0, superArm: false };
  }
  function strike(body, ball, x, y) {
    const d = Math.hypot(x - ball.x, y - ball.y) || 1;
    const contact = Math.max(body.radius, body.reach || body.radius) + ball.radius - 1;
    return aim(body, ball.x - (x - ball.x) / d * contact, ball.y - (y - ball.y) / d * contact, 260);
  }
  function options(state, team, index, base) {
    const body = state.bodies[team * 3 + index], ball = state.bodies[6];
    if (body.stunned) return [HOLD];
    const goal = team ? 60 : 940, ownGoal = 1000 - goal;
    const moves = [HOLD, base];
    for (const y of [300, 250, 350]) {
      const shot = strike(body, ball, goal, y);
      for (const power of [shot.power, shot.power * .75, 1]) moves.push({ ...shot, power });
    }
    moves.push(aim(body, ball.x, ball.y, 150));
    // Cover the ball-to-goal line, or clear toward a safe side of midfield.
    const coverX = ownGoal + (team ? -75 : 75);
    const t = (coverX - ownGoal) / ((ball.x - ownGoal) || 1);
    moves.push(aim(body, coverX, Math.max(240, Math.min(360, 300 + (ball.y - 300) * t))));
    for (const y of [130, 470]) moves.push(strike(body, ball, 500, y));
    const creativity = (body.personality?.creativity ?? 31.5) / 63;
    if (creativity > .3) {
      // Reflected goal supplies bank-shot seeds; exact physics judges each result.
      for (const y of [2 * 78 - 300, 2 * 522 - 300]) moves.push(strike(body, ball, goal, y));
      for (const spin of [-creativity, creativity]) moves.push({ ...moves[2], spin });
    }
    if (!state.mode.includes('classic') && body.meter >= 100 && body.equippedSuper) {
      for (const move of [...moves]) moves.push({ ...move, superArm: true });
    }
    return moves;
  }
  function evaluate(state, team, goal, weights) {
    if (goal !== null) return goal === team ? weights.goal : -weights.goal;
    const ball = state.bodies[6], own = state.bodies.slice(team * 3, team * 3 + 3);
    const other = state.bodies.slice((1 - team) * 3, (1 - team) * 3 + 3);
    const direction = team ? -1 : 1, ownGoal = team ? 940 : 60;
    const access = players => Math.min(...players.map(b => Math.hypot(b.x - ball.x, b.y - ball.y) + (b.stunned ? 250 : 0)));
    const cover = Math.min(...own.map(b => Math.hypot(b.x - (ownGoal + direction * 75), b.y - 300)));
    const meter = own.reduce((sum, b) => sum + (b.meter || 0), 0) - other.reduce((sum, b) => sum + (b.meter || 0), 0);
    return direction * (ball.x - 500) * weights.progress + (access(other) - access(own)) * weights.access - cover * weights.cover + meter * weights.meter;
  }
  function plan(input, team = 1, config = {}) {
    if (team !== 0 && team !== 1) throw new Error('Invalid CPU team.');
    const level = config.level || 'medium';
    if (!LEVELS[level]) throw new Error('Invalid CPU level.');
    const settings = { ...LEVELS[level], ...config }, weights = { ...WEIGHTS, ...config.weights };
    if (!Number.isInteger(settings.candidates) || settings.candidates < 1 || settings.candidates > 1000 ||
        !Number.isInteger(settings.opponents) || settings.opponents < 1 || settings.opponents > 3 ||
        !Number.isFinite(settings.risk) || settings.risk < 0 || settings.risk > 1 ||
        Object.values(weights).some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid CPU search settings.');
    const started = performance.now(), random = randomSource(config.seed ?? 1);
    // Only public state crosses this boundary. Discard any UI arming flags.
    const state = structuredClone(input);
    for (const b of state.bodies) { b.superArm = false; b.superActive = null; }
    let best = legacy(state, team), simulations = 0, ticks = 0, evaluated = 0;
    const opponent = legacy(state, 1 - team);
    const ball = state.bodies[6];
    const attack = state.bodies.slice((1 - team) * 3, (1 - team) * 3 + 3).map(b => b.stunned ? HOLD : strike(b, ball, team ? 940 : 60, 300));
    const responses = [opponent, [HOLD, HOLD, HOLD], attack].slice(0, settings.opponents);
    function score(moves) {
      let sum = 0, worst = Infinity;
      for (const response of responses) {
        const result = M.resolveTurn(P, state, team ? [...response, ...moves] : [...moves, ...response]);
        const value = evaluate(result.state, team, result.replay.goal, weights);
        sum += value; worst = Math.min(worst, value); simulations++; ticks += result.replay.ticks;
      }
      evaluated++;
      return sum / responses.length * (1 - settings.risk) + worst * settings.risk;
    }
    let bestScore = score(best);
    function consider(moves) {
      if (evaluated >= settings.candidates) return;
      const value = score(moves);
      if (value > bestScore + 1e-8) { best = moves; bestScore = value; }
    }
    const choices = [0, 1, 2].map(i => options(state, team, i, best[i]));
    // Round-robin ensures even small budgets try each skater, including holding.
    for (let j = 0; j < Math.max(...choices.map(c => c.length)) && evaluated < settings.candidates * .65; j++) {
      for (let i = 0; i < 3; i++) if (choices[i][j]) {
        const next = best.slice(); next[i] = choices[i][j]; consider(next);
      }
    }
    // Paired pass/receiver candidates move together, rather than passing to an old position.
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (i === j || evaluated >= settings.candidates * .8) continue;
      const sender = state.bodies[team * 3 + i], receiver = state.bodies[team * 3 + j];
      if (sender.stunned || receiver.stunned || (sender.personality?.teamwork ?? 31.5) < 24) continue;
      const x = Math.max(180, Math.min(820, ball.x + (team ? -130 : 130)));
      const y = ball.y < 300 ? 390 : 210;
      const next = best.slice(); next[i] = strike(sender, ball, x, y); next[j] = aim(receiver, x, y);
      consider(next);
    }
    while (evaluated < settings.candidates) {
      const next = best.map(p => ({ ...p })), i = Math.floor(random() * 3);
      if (state.bodies[team * 3 + i].stunned) { consider(next); continue; }
      if (evaluated % 4 === 0) {
        for (let j = 0; j < 3; j++) next[j] = choices[j][Math.floor(random() * choices[j].length)];
      } else {
        next[i].angle += (random() - .5) * .28;
        next[i].power = Math.max(0, Math.min(1, next[i].power + (random() - .5) * .25));
        const creativity = (state.bodies[team * 3 + i].personality?.creativity ?? 31.5) / 63;
        next[i].spin = Math.max(-1, Math.min(1, next[i].spin + (random() - .5) * creativity * .5));
      }
      consider(next);
    }
    return { plans: M.validatePlans(best), diagnostics: { level, candidates: evaluated, simulations, ticks, score: bestScore, milliseconds: performance.now() - started } };
  }
  const api = { LEVELS, WEIGHTS, HOLD, randomSource, legacy, plan };
  if (node) module.exports = api; else root.ububallCPU = api;
})(globalThis);
