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
  // `stun` and `daze` reward putting opponents out of position or slowing them down.
  const WEIGHTS = Object.freeze({
    goal: 10000, progress: 1, access: .35, cover: .3, meter: .35,
    role: 40, card: 400, warning: 150, stun: 180, daze: 120
  });
  // Human-like play (initial tuning, not owner decisions). A plan must still work when aimed a little
  // off: it is also scored with every launch turned by ±`angle` and its power changed by ∓`power`,
  // against the expected response. A goal loses a share of its value for each board bounce or extra
  // touch on the way, less for creative ubus: it keeps `simple` + `creative` × Creativity per step.
  const WOBBLE = Object.freeze({ angle: .035, power: .05 });
  const COMPLEX = Object.freeze({ simple: .45, creative: .4 });
  // The moves that fit each role. Supers keep their move's intent.
  const ROLE_INTENTS = Object.freeze({ attack: ['shoot', 'pass'], support: ['chase', 'clear', 'receive', 'check'], defend: ['cover', 'guard', 'hold'] });
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
  function aim(body, x, y, drive = 0, superKey = null) {
    const dx = x - body.x, dy = y - body.y;
    const distance = Math.hypot(dx, dy);
    const superScale = superKey === 'colossus' && !body.colossusApplied ? (P.SUPER.colossusLaunch ?? (1 / P.SUPER.colossusMass))
      : superKey === 'stalwart' ? (P.SUPER.stalwartLaunch ?? 0.5) : 1;
    const maxV = P.launchSpeed(body) * superScale;
    const speed = distance < 2 ? 0 : Math.min(maxV, Math.sqrt(2 * body.friction * Math.max(0, distance + drive)));
    const vSpeed = Math.hypot(body.vx || 0, body.vy || 0);

    if (vSpeed <= 10 || speed === 0) {
      return {
        angle: Math.atan2(dy, dx),
        power: maxV > 0 ? speed / maxV : 0,
        spin: 0,
        superArm: false,
        guard: false
      };
    }

    const dist = distance || 1;
    const ux = dx / dist, uy = dy / dist;
    const vxTarget = ux * speed, vyTarget = uy * speed;
    const steerLimit = maxV * (body.sizeMult || 1) ** P.SIZE.agility;
    const deltaX = vxTarget - (body.vx || 0), deltaY = vyTarget - (body.vy || 0);
    const deltaDist = Math.hypot(deltaX, deltaY);

    let aimVx, aimVy;
    if (deltaDist <= steerLimit) {
      aimVx = vxTarget;
      aimVy = vyTarget;
    } else {
      const vbPar = (body.vx || 0) * ux + (body.vy || 0) * uy;
      const vbPerp2 = Math.max(0, ((body.vx || 0) ** 2 + (body.vy || 0) ** 2) - vbPar * vbPar);
      if (steerLimit * steerLimit >= vbPerp2) {
        const k = Math.max(0, Math.min(speed, vbPar + Math.sqrt(steerLimit * steerLimit - vbPerp2)));
        aimVx = ux * k;
        aimVy = uy * k;
      } else {
        aimVx = (body.vx || 0) + (deltaX / deltaDist) * steerLimit;
        aimVy = (body.vy || 0) + (deltaY / deltaDist) * steerLimit;
      }
    }

    const aimSpeed = Math.hypot(aimVx, aimVy);
    return {
      angle: Math.atan2(aimVy, aimVx),
      power: maxV > 0 ? Math.min(1, aimSpeed / maxV) : 0,
      spin: 0,
      superArm: false,
      guard: false
    };
  }
  function strike(body, ball, x, y, superKey = null) {
    let leadX = ball.x, leadY = ball.y;
    const ballSpeed = Math.hypot(ball.vx || 0, ball.vy || 0);
    if (!ball.stuckTo && ballSpeed > 20) {
      const tLead = Math.min(0.32, Math.hypot(ball.x - body.x, ball.y - body.y) / Math.max(180, P.launchSpeed(body)));
      const friction = ball.friction ?? 85;
      const drag = P.AIR_DRAG ?? 0.00015;
      const decel = friction + drag * ballSpeed * ballSpeed;
      const avgSpeed = Math.max(0, ballSpeed - 0.5 * decel * tLead);
      const leadDist = avgSpeed * tLead;
      leadX = Math.max(105, Math.min(895, ball.x + ((ball.vx || 0) / ballSpeed) * leadDist));
      leadY = Math.max(105, Math.min(495, ball.y + ((ball.vy || 0) / ballSpeed) * leadDist));
    }
    const d = Math.hypot(x - leadX, y - leadY) || 1;
    const contact = Math.max(body.radius, body.reach || body.radius) + ball.radius - 1;
    return aim(body, leadX - (x - leadX) / d * contact, leadY - (y - leadY) / d * contact, 260, superKey);
  }
  const creativityOf = body => (body.personality?.creativity ?? 31.5) / 63;
  function behindBall(body, ball, team) {
    return team === 0 ? body.x <= ball.x + 12 : body.x >= ball.x - 12;
  }
  function isPointBlank(body, ball) {
    const reach = Math.max(body.radius, body.reach || body.radius, 18);
    return Math.hypot(body.x - ball.x, body.y - ball.y) - reach - ball.radius < 4 * ball.radius;
  }
  // A move tagged with its intent; copies made while searching keep it.
  const intents = new WeakMap();
  function tag(move, intent) { intents.set(move, intent); return move; }
  function copy(move) { return tag({ ...move }, intents.get(move)); }
  function fitsRole(job, move, body, state) {
    const intent = intents.get(move);
    if (ROLE_INTENTS[job]?.includes(intent)) return true;
    if (job === 'attack' && intent === 'check') {
      const sKey = body?.equippedSuper?.key?.toLowerCase();
      const carrier = state?.bodies?.[6]?.stuckTo;
      const opponentHasBall = carrier && carrier.team >= 0 && carrier.team !== body?.team;
      if (opponentHasBall) return true;
      if (move.superArm && (sKey === 'knockout' || sKey === 'shockwave')) return true;
    }
    return false;
  }
  function options(state, team, index, base) {
    const body = state.bodies[team * 3 + index], ball = state.bodies[6];
    if (body.stunned) return [HOLD];
    const goal = team ? 60 : 940, ownGoal = 1000 - goal;
    const creativity = creativityOf(body);
    const isBehind = behindBall(body, ball, team);
    const pointBlank = isPointBlank(body, ball);
    const hasSuper = !M.rule(state.mode, 'classic') && body.meter >= 100 && Boolean(body.equippedSuper);
    const sKey = body.equippedSuper?.key?.toLowerCase() || null;

    function generateMoves(superArmKey) {
      const arm = Boolean(superArmKey);
      const moves = [];
      moves.push(tag({ ...HOLD, superArm: arm }, 'hold'));
      moves.push(tag({ ...GUARD, superArm: arm }, 'guard'));

      if (isBehind) {
        for (const y of [300, 250, 350]) {
          const shot = strike(body, ball, goal, y, superArmKey);
          for (const power of [shot.power, shot.power * .75, 1]) {
            moves.push(tag({ ...shot, power, superArm: arm }, 'shoot'));
          }
        }
        moves.push(tag({ ...aim(body, ball.x, ball.y, 150, superArmKey), superArm: arm }, 'chase'));
        if (creativity > .3) {
          for (const y of [2 * 78 - 300, 2 * 522 - 300]) {
            moves.push(tag({ ...strike(body, ball, goal, y, superArmKey), superArm: arm }, 'shoot'));
          }
          const primaryShot = strike(body, ball, goal, 300, superArmKey);
          for (const spin of [-creativity, creativity]) {
            moves.push(tag({ ...primaryShot, spin, superArm: arm }, 'shoot'));
          }
        }
        if (pointBlank) {
          const primaryShot = strike(body, ball, goal, 300, superArmKey);
          moves.push(tag({ ...primaryShot, spin: 1, superArm: arm }, 'shoot'));
          moves.push(tag({ ...primaryShot, spin: -1, superArm: arm }, 'shoot'));
        }
      } else {
        const backX = Math.max(100, Math.min(900, ball.x + (team ? 68 : -68)));
        for (const side of [-54, 54]) {
          const arcY = Math.max(95, Math.min(505, ball.y + side));
          const wrap = aim(body, backX, arcY, 140, superArmKey);
          moves.push(tag({ ...wrap, superArm: arm }, 'chase'));
          if (creativity > 0.25) {
            moves.push(tag({ ...wrap, spin: (side < 0 ? 0.5 : -0.5) * (team ? 1 : -1), superArm: arm }, 'chase'));
          }
        }
      }

      // Cover the ball-to-goal line, or clear toward a safe side of midfield.
      const coverX = ownGoal + (team ? -88 : 88);
      const t = (coverX - ownGoal) / ((ball.x - ownGoal) || 1);
      moves.push(tag({ ...aim(body, coverX, Math.max(240, Math.min(360, 300 + (ball.y - 300) * t)), 0, superArmKey), superArm: arm }, 'cover'));

      if (state.fouls?.crease?.[team] && M.inCrease(P, body, team)) {
        const exitX = ownGoal + (team ? -98 : 98);
        for (const exitY of [245, 355]) {
          moves.push(tag({ ...aim(body, exitX, exitY, 0, superArmKey), superArm: arm }, 'cover'));
        }
      }

      for (const y of [130, 470]) {
        const clr = strike(body, ball, 500, y, superArmKey);
        moves.push(tag({ ...clr, superArm: arm }, 'clear'));
        if (isBehind && pointBlank) {
          moves.push(tag({ ...clr, spin: 1, superArm: arm }, 'clear'));
          moves.push(tag({ ...clr, spin: -1, superArm: arm }, 'clear'));
        }
      }

      const opponents = state.bodies.slice((1 - team) * 3, (1 - team) * 3 + 3);
      const carrier = ball.stuckTo && opponents.includes(ball.stuckTo) ? ball.stuckTo : null;
      const eligible = opponents.filter(b => !b.stunned && !b.carded);
      const threat = carrier || (eligible.length ? eligible.reduce((best, b) =>
        Math.hypot(b.x - ball.x, b.y - ball.y) < Math.hypot(best.x - ball.x, best.y - ball.y) ? b : best
      ) : null);
      if (threat) {
        const check = aim(body, threat.x + (threat.vx || 0) * 0.15, threat.y + (threat.vy || 0) * 0.15, 180, superArmKey);
        moves.push(tag({ ...check, superArm: arm }, 'check'));
      }

      return moves;
    }

    const unarmedMoves = generateMoves(null);
    const moves = [unarmedMoves[0], unarmedMoves[1], base, ...unarmedMoves.slice(2)];
    if (hasSuper) {
      const armedMoves = generateMoves(sKey);
      moves.push(...armedMoves);
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
  function evaluate(state, team, goal, weights, complexity = 0, scorer = null, teamTouches = false, tmw = 0.5) {
    if (goal !== null) {
      if (goal !== team) return -weights.goal;
      const effectiveCreativity = teamTouches ? Math.max(creativityOf(scorer || {}), tmw) : creativityOf(scorer || {});
      return weights.goal * (COMPLEX.simple + COMPLEX.creative * effectiveCreativity) ** complexity;
    }
    const ball = state.bodies[6], own = state.bodies.slice(team * 3, team * 3 + 3);
    const other = state.bodies.slice((1 - team) * 3, (1 - team) * 3 + 3);
    const direction = team ? -1 : 1, ownGoal = team ? 940 : 60;
    const access = players => Math.min(...players.map(b => Math.hypot(b.x - ball.x, b.y - ball.y) + (b.stunned ? 250 : 0)));
    const cover = Math.min(...own.map(b => Math.hypot(b.x - (ownGoal + direction * 88), b.y - 300)));
    const meter = own.reduce((sum, b) => sum + (b.meter || 0), 0) - other.reduce((sum, b) => sum + (b.meter || 0), 0);
    const cards = own.filter(b => b.carded).length - other.filter(b => b.carded).length;
    const warned = (state.fouls?.crease?.[team] ? 1 : 0) - (state.fouls?.crease?.[1 - team] ? 1 : 0);
    const stuns = other.filter(b => b.stunned && !b.carded).length - own.filter(b => b.stunned && !b.carded).length;
    const dazes = (other.reduce((s, b) => s + P.dazeSlow(b), 0) - own.reduce((s, b) => s + P.dazeSlow(b), 0)) / P.DAZE.max;
    let stall = 0;
    if (state.fouls && state.fouls.corner !== null) {
      const inside = list => list.filter(b => M.cornerOf(P, b.x, b.y, b.radius) === state.fouls.corner).length, mine = inside(own), theirs = inside(other);
      if (mine !== theirs) stall = Math.sign(mine - theirs) * Math.min(1, state.fouls.cornerTurns / M.FOULS.stallTurns);
    }
    return direction * (ball.x - 500) * weights.progress + (access(other) - access(own)) * weights.access - cover * weights.cover + meter * weights.meter -
      cards * weights.card - (warned + stall) * weights.warning + stuns * (weights.stun ?? 180) + dazes * (weights.daze ?? 120);
  }
  function plan(input, team = 1, config = {}) {
    if (team !== 0 && team !== 1) throw new Error('Invalid CPU team.');
    const level = config.level || 'medium';
    if (!LEVELS[level]) throw new Error('Invalid CPU level.');
    const settings = { ...LEVELS[level], ...config };
    const rawWeights = { ...WEIGHTS, ...config.weights };
    if (!Number.isInteger(settings.candidates) || settings.candidates < 1 || settings.candidates > 1000 ||
        !Number.isInteger(settings.opponents) || settings.opponents < 1 || settings.opponents > 3 ||
        !Number.isFinite(settings.risk) || settings.risk < 0 || settings.risk > 1 ||
        !Number.isFinite(settings.temperature) || settings.temperature <= 0 ||
        Object.values(rawWeights).some(v => !Number.isFinite(v) || v < 0)) throw new Error('Invalid CPU search settings.');
    const started = performance.now(), random = randomSource(config.seed ?? 1);
    // Only public state crosses this boundary. Discard any UI arming flags.
    const state = structuredClone(input);
    // Every candidate copies the state, so presentation fields (voice, name, super descriptions) go.
    for (const b of state.bodies) {
      b.superArm = false; b.superActive = null;
      delete b.voice; delete b.name;
      if (b.equippedSuper) b.equippedSuper = { id: b.equippedSuper.id, key: b.equippedSuper.key };
    }

    const ownUbus = state.bodies.slice(team * 3, team * 3 + 3);
    const avgTrait = key => ownUbus.reduce((sum, b) => sum + ((b.personality?.[key] ?? 31.5) / 63), 0) / 3;
    const agg = avgTrait('aggression'), cre = avgTrait('creativity'), tmw = avgTrait('teamwork'), clu = avgTrait('clutch');
    const deficit = Math.max(0, (state.scores?.[1 - team] ?? 0) - (state.scores?.[team] ?? 0));
    const matchPt = (state.scores?.[1 - team] ?? 0) >= 4;
    const pressure = Math.min(1, deficit * 0.25 + (matchPt ? 0.4 : 0));
    const surge = pressure * (clu - 0.5) * 2;

    const weights = { ...rawWeights };
    if (config.weights?.progress === undefined) weights.progress = WEIGHTS.progress * (1 + 0.35 * (agg - 0.5) + 0.35 * Math.max(0, surge));
    if (config.weights?.access === undefined) weights.access = WEIGHTS.access * (1 + 0.25 * (agg - 0.5) + 0.25 * Math.max(0, surge));
    if (config.weights?.cover === undefined) weights.cover = WEIGHTS.cover * Math.max(0.4, 1 + 0.45 * (0.5 - agg) - 0.3 * Math.max(0, surge));
    if (config.weights?.stun === undefined) weights.stun = WEIGHTS.stun * (1 + 0.3 * (agg - 0.5));
    if (config.weights?.daze === undefined) weights.daze = WEIGHTS.daze * (1 + 0.3 * (agg - 0.5));

    if (config.risk === undefined) {
      settings.risk = Math.max(0.05, Math.min(0.85, settings.risk - 0.12 * surge));
    }

    let best = legacy(state, team), simulations = 0, ticks = 0, evaluated = 0;
    const opponent = legacy(state, 1 - team);
    const ball = state.bodies[6], jobs = roles(state, team);
    const guardOpponents = state.bodies.slice((1 - team) * 3, (1 - team) * 3 + 3).map(b => b.stunned ? HOLD : GUARD);
    const oppTeam = 1 - team;
    const oppGoal = team ? 940 : 60;
    const oppOwnGoal = team ? 60 : 940;
    const oppCoverX = oppOwnGoal + (oppTeam ? -88 : 88);
    const attack = state.bodies.slice((1 - team) * 3, (1 - team) * 3 + 3).map(b => {
      if (b.stunned) return HOLD;
      if (behindBall(b, ball, oppTeam)) return strike(b, ball, oppGoal, 300);
      return aim(b, oppCoverX, 300);
    });
    const responses = [opponent, guardOpponents, attack].slice(0, settings.opponents);
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
      const teammatesTouched = new Set();
      const watch = {
        collide(a, b, speed) {
          const player = M.toucher(a, b, speed);
          if (player && player !== toucher) {
            toucher = player;
            touches++;
            if (player.team === team) teammatesTouched.add(player);
          }
        },
        wall(body, velocity, type) { if (body.team === -1 && touches && type !== 'net') boards++; }
      };
      const result = M.resolveTurn(P, state, team ? [...response, ...moves] : [...moves, ...response], { effects: false, ticks: SEARCH_TICKS, decided, watch });
      simulations++; ticks += result.replay.ticks;
      return evaluate(result.state, team, result.replay.goal, weights, boards + Math.max(0, touches - 1), toucher, teammatesTouched.size > 1, tmw);
    }
    // Plans scored in full, from which `choose` picks. A plan whose plain result already trails the
    // best by more than `vetting` × temperature, where `choose` would almost never pick it (under 2%
    // weight), skips the aimed-off runs and is left out of the pick.
    const scored = [], vetting = 4;
    let bestScore = -Infinity;
    function score(moves) {
      // Ubus keeping to their jobs read as a team with a plan.
      const fit = moves.reduce((n, p, i) => {
        const b = state.bodies[team * 3 + i];
        if (!fitsRole(jobs[i], p, b, state)) return n;
        const intent = intents.get(p);
        if (state.fouls?.crease?.[team] && M.inCrease(P, b, team)) {
          if (intent === 'hold' || intent === 'guard') {
            const isStalwart = p.superArm && b.equippedSuper?.key?.toLowerCase() === 'stalwart';
            if (!isStalwart) return n;
          }
        }
        return n + 1;
      }, 0);
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
        const fitting = choices[i].filter(p => fitsRole(jobs[order[i]], p, state.bodies[team * 3 + i], state));
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
    const chosen = choose(scored, settings.temperature, random, state, team);
    return { plans: M.validatePlans(chosen.moves), diagnostics: { level, candidates: evaluated, simulations, ticks, score: chosen.value, milliseconds: performance.now() - started } };
  }
  // The final pick is not always the single best plan: each plan is chosen with weight
  // e^((value - best) / temperature), so near-equal plans vary and a clearly better one still wins.
  // Spin counts slightly against a plan here, so near-ties go to the plainer one (unless point-blank).
  function choose(scored, temperature, random, state = null, team = null) {
    const ball = state?.bodies?.[6];
    const plain = c => c.value - 15 * c.moves.reduce((n, p, i) => {
      const skater = (state && team !== null) ? state.bodies[team * 3 + i] : null;
      const waive = skater && ball && isPointBlank(skater, ball);
      return n + (waive ? 0 : Math.abs(p.spin || 0));
    }, 0);
    const top = Math.max(...scored.map(plain)), weights = scored.map(c => Math.exp((plain(c) - top) / temperature));
    let pick = random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < scored.length; i++) if ((pick -= weights[i]) <= 0) return scored[i];
    return scored[scored.length - 1];
  }
  const api = {
    LEVELS, WEIGHTS, WOBBLE, COMPLEX, SEARCH_TICKS, HOLD, GUARD,
    randomSource, legacy, decided, plan, aim, strike, behindBall, isPointBlank, evaluate, options
  };
  if (node) module.exports = api; else root.ububallCPU = api;
})(globalThis);
