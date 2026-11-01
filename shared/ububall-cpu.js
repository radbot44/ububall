/* Deterministic, bounded team search. Uses the same turn resolver as matches. */
(function(root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const P = node ? require('../web/ububall-physics.js') : root.ububallPhysics;
  const M = node ? require('./ububall-match.js') : root.ububallMatch;
  const HOLD = Object.freeze({ angle: 0, power: 0, spin: 0, superArm: false, guard: false });
  const GUARD = Object.freeze({ ...HOLD, guard: true });
  // `temperature` loosens the final pick among the best plans (see `choose`): wider on easier levels.
  const LEVELS = Object.freeze({
    easy: Object.freeze({ candidates: 18, opponents: 1, risk: .15, temperature: 80 }),
    medium: Object.freeze({ candidates: 60, opponents: 2, risk: .35, temperature: 50 }),
    hard: Object.freeze({ candidates: 120, opponents: 3, risk: .55, temperature: 25 })
  });
  // `role` rewards each ubu that keeps to its job on the field (see `roles`).
  // `card` and `warning` count against yellow cards and standing goal camping warnings (see M.FOULS);
  // a corner stall counts against the side with more ubus in that corner, up to `warning` once warned.
  const WEIGHTS = Object.freeze({ goal: 10000, progress: 1, access: .35, cover: .3, meter: .35, role: 40, card: 400, warning: 150 });
  // Human-like play (initial tuning, not owner decisions). A plan must still work when aimed a little
  // off: it is also scored with every launch turned by ±`angle` and its power changed by ∓`power`,
  // against the expected response. A goal loses a share of its value for each board bounce or extra
  // touch on the way, less for creative ubus: it keeps `simple` + `creative` × Creativity per step.
  const WOBBLE = Object.freeze({ angle: .035, power: .05 });
  const COMPLEX = Object.freeze({ simple: .45, creative: .4 });
  // The moves that fit each role. Supers keep their move's intent.
  const ROLE_INTENTS = Object.freeze({ attack: ['shoot', 'pass'], support: ['chase', 'clear', 'receive'], defend: ['cover', 'guard', 'hold'] });
  // Each candidate is judged on at most 2 s of play (owner decision 2026-10-30), or sooner once its
  // result is clear.
  const SEARCH_TICKS = 480;
  // Clear: the ball is at rest and loose, no super is running, and no ubu still sliding could reach
  // the ball on its own momentum (a straight-line stopping distance; knock-ons are not followed).
  function decided(bodies) {
    const ball = bodies[6];
    if (ball.vx || ball.vy || ball.stuckTo) return false;
    for (let i = 0; i < 6; i++) {
      const b = bodies[i];
      if (b.superActive) return false;
      const speed2 = b.vx * b.vx + b.vy * b.vy;
      if (!speed2) continue;
      const contact = Math.max(b.radius, b.reach || b.radius, 18) + ball.radius;
      if (Math.hypot(b.x - ball.x, b.y - ball.y) - contact <= speed2 / (2 * b.friction)) return false;
    }
    return true;
  }
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
      spin: (p.spin || 0) * (team ? 1 : -1), superArm: Boolean(p.superArm), guard: Boolean(p.guard)
    }));
  }
  function aim(body, x, y, drive = 0) {
    const distance = Math.hypot(x - body.x, y - body.y);
    return { angle: Math.atan2(y - body.y, x - body.x),
      power: distance < 2 ? 0 : Math.min(1, Math.sqrt(2 * body.friction * (distance + drive)) / ((body.impulse || P.IMPULSE) / body.mass)),
      spin: 0, superArm: false, guard: false };
  }
  function strike(body, ball, x, y) {
    const d = Math.hypot(x - ball.x, y - ball.y) || 1;
    const contact = Math.max(body.radius, body.reach || body.radius) + ball.radius - 1;
    return aim(body, ball.x - (x - ball.x) / d * contact, ball.y - (y - ball.y) / d * contact, 260);
  }
  const creativityOf = body => (body.personality?.creativity ?? 31.5) / 63;
  // A move tagged with its intent; copies made while searching keep it.
  const intents = new WeakMap();
  function tag(move, intent) { intents.set(move, intent); return move; }
  function copy(move) { return tag({ ...move }, intents.get(move)); }
  function options(state, team, index, base) {
    const body = state.bodies[team * 3 + index], ball = state.bodies[6];
    if (body.stunned) return [HOLD];
    const goal = team ? 60 : 940, ownGoal = 1000 - goal;
    const moves = [tag({ ...HOLD }, 'hold'), tag({ ...GUARD }, 'guard'), base];
    for (const y of [300, 250, 350]) {
      const shot = strike(body, ball, goal, y);
      for (const power of [shot.power, shot.power * .75, 1]) moves.push(tag({ ...shot, power }, 'shoot'));
    }
    moves.push(tag(aim(body, ball.x, ball.y, 150), 'chase'));
    // Cover the ball-to-goal line, or clear toward a safe side of midfield.
    const coverX = ownGoal + (team ? -75 : 75);
    const t = (coverX - ownGoal) / ((ball.x - ownGoal) || 1);
    moves.push(tag(aim(body, coverX, Math.max(240, Math.min(360, 300 + (ball.y - 300) * t))), 'cover'));
    for (const y of [130, 470]) moves.push(tag(strike(body, ball, 500, y), 'clear'));
    const creativity = creativityOf(body);
    if (creativity > .3) {
      // Reflected goal supplies bank-shot seeds; exact physics judges each result.
      for (const y of [2 * 78 - 300, 2 * 522 - 300]) moves.push(tag(strike(body, ball, goal, y), 'shoot'));
      for (const spin of [-creativity, creativity]) moves.push(tag({ ...moves[3], spin }, 'shoot'));
    }
    if (!M.rule(state.mode, 'classic') && body.meter >= 100 && body.equippedSuper) {
      for (const move of [...moves]) moves.push(tag({ ...move, superArm: true }, intents.get(move)));
    }
    return moves;
  }
  // Each ubu's job this turn, read from the field so it carries over between turns: the ubu nearest
  // its own goal defends, the one of the others nearest the ball attacks, and the third supports.
  function roles(state, team) {
    const ball = state.bodies[6], body = i => state.bodies[team * 3 + i];
    const nearest = (list, x, y) => list.reduce((a, b) => Math.hypot(body(b).x - x, body(b).y - y) < Math.hypot(body(a).x - x, body(a).y - y) ? b : a);
    const defender = nearest([0, 1, 2], team ? 940 : 60, 300), rest = [0, 1, 2].filter(i => i !== defender);
    const attacker = nearest(rest, ball.x, ball.y);
    return [0, 1, 2].map(i => i === defender ? 'defend' : i === attacker ? 'attack' : 'support');
  }
  // The plan aimed a little off: each launch turned by the wobble (alternating direction by ubu) and
  // its power changed the opposite way.
  function wobble(moves, sign) {
    return moves.map((p, i) => {
      if (!p.power || p.guard) return p;
      const s = i % 2 ? -sign : sign;
      return { ...p, angle: p.angle + s * WOBBLE.angle, power: Math.max(0, Math.min(1, p.power * (1 - s * WOBBLE.power))) };
    });
  }
  // `complexity` counts board bounces and extra touches on the way to a goal; `scorer` took the last touch.
  function evaluate(state, team, goal, weights, complexity = 0, scorer = null) {
    if (goal !== null) {
      if (goal !== team) return -weights.goal;
      return weights.goal * (COMPLEX.simple + COMPLEX.creative * creativityOf(scorer || {})) ** complexity;
    }
    const ball = state.bodies[6], own = state.bodies.slice(team * 3, team * 3 + 3);
    const other = state.bodies.slice((1 - team) * 3, (1 - team) * 3 + 3);
    const direction = team ? -1 : 1, ownGoal = team ? 940 : 60;
    const access = players => Math.min(...players.map(b => Math.hypot(b.x - ball.x, b.y - ball.y) + (b.stunned ? 250 : 0)));
    const cover = Math.min(...own.map(b => Math.hypot(b.x - (ownGoal + direction * 75), b.y - 300)));
    const meter = own.reduce((sum, b) => sum + (b.meter || 0), 0) - other.reduce((sum, b) => sum + (b.meter || 0), 0);
    const cards = own.filter(b => b.carded).length - other.filter(b => b.carded).length;
    const warned = (state.fouls?.crease[team] ? 1 : 0) - (state.fouls?.crease[1 - team] ? 1 : 0);
    let stall = 0;
    if (state.fouls && state.fouls.corner !== null) {
      const inside = list => list.filter(b => M.cornerOf(P, b.x, b.y, b.radius) === state.fouls.corner).length, mine = inside(own), theirs = inside(other);
      if (mine !== theirs) stall = Math.sign(mine - theirs) * Math.min(1, state.fouls.cornerTurns / M.FOULS.stallTurns);
    }
    return direction * (ball.x - 500) * weights.progress + (access(other) - access(own)) * weights.access - cover * weights.cover + meter * weights.meter -
      cards * weights.card - (warned + stall) * weights.warning;
  }
  function plan(input, team = 1, config = {}) {
    if (team !== 0 && team !== 1) throw new Error('Invalid CPU team.');
    const level = config.level || 'medium';
    if (!LEVELS[level]) throw new Error('Invalid CPU level.');
    const settings = { ...LEVELS[level], ...config }, weights = { ...WEIGHTS, ...config.weights };
    if (!Number.isInteger(settings.candidates) || settings.candidates < 1 || settings.candidates > 1000 ||
        !Number.isInteger(settings.opponents) || settings.opponents < 1 || settings.opponents > 3 ||
        !Number.isFinite(settings.risk) || settings.risk < 0 || settings.risk > 1 ||
        !Number.isFinite(settings.temperature) || settings.temperature <= 0 ||
        Object.values(weights).some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid CPU search settings.');
    const started = performance.now(), random = randomSource(config.seed ?? 1);
    // Only public state crosses this boundary. Discard any UI arming flags.
    const state = structuredClone(input);
    // Every candidate copies the state, so presentation fields (voice, name, super descriptions) go.
    for (const b of state.bodies) {
      b.superArm = false; b.superActive = null;
      delete b.voice; delete b.name;
      if (b.equippedSuper) b.equippedSuper = { id: b.equippedSuper.id, key: b.equippedSuper.key, bonusTicks: b.equippedSuper.bonusTicks, bonusRefund: b.equippedSuper.bonusRefund };
    }
    let best = legacy(state, team), simulations = 0, ticks = 0, evaluated = 0;
    const opponent = legacy(state, 1 - team);
    const ball = state.bodies[6], jobs = roles(state, team);
    const attack = state.bodies.slice((1 - team) * 3, (1 - team) * 3 + 3).map(b => b.stunned ? HOLD : strike(b, ball, team ? 940 : 60, 300));
    const responses = [opponent, [HOLD, HOLD, HOLD], attack].slice(0, settings.opponents);
    // One simulated turn, valued with its goal's complexity: board and post bounces after the first
    // touch, plus each change of the ubu touching the ball after the first. A turn is a pure function
    // of its moves, so a repeat (a plan tried twice, or a plan with no launch to aim off) is reused.
    const results = new Map();
    const number = n => Object.is(n, -0) ? '-0' : n;
    function simulate(moves, response, r) {
      const key = r + ':' + moves.map(p => [number(p.angle), number(p.power), number(p.spin), p.superArm, p.guard].join()).join('|');
      if (!results.has(key)) results.set(key, run(moves, response));
      return results.get(key);
    }
    function run(moves, response) {
      let toucher = null, touches = 0, boards = 0;
      const watch = {
        collide(a, b, speed) { const player = M.toucher(a, b, speed); if (player && player !== toucher) { toucher = player; touches++; } },
        wall(body, velocity, type) { if (body.team === -1 && touches && type !== 'net') boards++; }
      };
      const result = M.resolveTurn(P, state, team ? [...response, ...moves] : [...moves, ...response], { effects: false, ticks: SEARCH_TICKS, decided, watch });
      simulations++; ticks += result.replay.ticks;
      return evaluate(result.state, team, result.replay.goal, weights, boards + Math.max(0, touches - 1), toucher);
    }
    // Plans scored in full, from which `choose` picks. A plan whose plain result already trails the
    // best by more than `vetting` × temperature, where `choose` would almost never pick it (under 2%
    // weight), skips the aimed-off runs and is left out of the pick.
    const scored = [], vetting = 4;
    let bestScore = -Infinity;
    function score(moves) {
      // Ubus keeping to their jobs read as a team with a plan.
      const fit = moves.reduce((n, p, i) => n + (ROLE_INTENTS[jobs[i]].includes(intents.get(p)) ? 1 : 0), 0);
      const values = responses.map((response, r) => simulate(moves, response, r));
      const blend = () => values.reduce((a, b) => a + b) / values.length * (1 - settings.risk) + Math.min(...values) * settings.risk + fit * weights.role;
      evaluated++;
      if (blend() < bestScore - vetting * settings.temperature) return blend();
      // Against the expected response, the plan must also hold up when aimed a little off.
      values[0] = (values[0] + simulate(wobble(moves, 1), responses[0], 0) + simulate(wobble(moves, -1), responses[0], 0)) / 3;
      const value = blend();
      scored.push({ moves, value });
      return value;
    }
    bestScore = score(best);
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
      const next = best.slice(); next[i] = tag(strike(sender, ball, x, y), 'pass'); next[j] = tag(aim(receiver, x, y), 'receive');
      consider(next);
    }
    // A fresh team plan gives each ubu one job and a move that fits it: usually the jobs read from
    // the field, every third plan reshuffled so another ubu can take the shot.
    const shuffles = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    function teamPlan() {
      const order = evaluated % 3 ? [0, 1, 2] : shuffles[Math.floor(random() * 6)];
      return [0, 1, 2].map(i => {
        const fitting = choices[i].filter(p => ROLE_INTENTS[jobs[order[i]]].includes(intents.get(p)));
        const pool = fitting.length ? fitting : choices[i];
        return pool[Math.floor(random() * pool.length)];
      });
    }
    while (evaluated < settings.candidates) {
      const next = best.map(copy), i = Math.floor(random() * 3);
      if (state.bodies[team * 3 + i].stunned || next[i].guard) { consider(next); continue; }
      if (evaluated % 4 === 0) {
        next.splice(0, 3, ...teamPlan());
      } else {
        // Fine-tune one ubu within its current intent.
        next[i].angle += (random() - .5) * .28;
        next[i].power = Math.max(0, Math.min(1, next[i].power + (random() - .5) * .25));
        next[i].spin = Math.max(-1, Math.min(1, next[i].spin + (random() - .5) * creativityOf(state.bodies[team * 3 + i]) * .5));
      }
      consider(next);
    }
    const chosen = choose(scored, settings.temperature, random);
    return { plans: M.validatePlans(chosen.moves), diagnostics: { level, candidates: evaluated, simulations, ticks, score: chosen.value, milliseconds: performance.now() - started } };
  }
  // The final pick is not always the single best plan: each plan is chosen with weight
  // e^((value - best) / temperature), so near-equal plans vary and a clearly better one still wins.
  // Spin counts slightly against a plan here, so near-ties go to the plainer one.
  function choose(scored, temperature, random) {
    const plain = c => c.value - 15 * c.moves.reduce((n, p) => n + Math.abs(p.spin || 0), 0);
    const top = Math.max(...scored.map(plain)), weights = scored.map(c => Math.exp((plain(c) - top) / temperature));
    let pick = random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < scored.length; i++) if ((pick -= weights[i]) <= 0) return scored[i];
    return scored[scored.length - 1];
  }
  const api = { LEVELS, WEIGHTS, WOBBLE, COMPLEX, SEARCH_TICKS, HOLD, GUARD, randomSource, legacy, decided, plan };
  if (node) module.exports = api; else root.ububallCPU = api;
})(globalThis);
