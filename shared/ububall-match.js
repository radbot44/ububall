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
  // round's first turn, to the scorer) and saves. The assist amount is a proposal, not yet decided.
  // Contact counts only for real impacts against the ball or an opponent, at most once per
  // cooldown per ubu, so pinging around the ball or an enemy cannot farm it (cooldown and
  // impact speed are tuning, not owner decisions).
  // Every gain is scaled by `rate` (owner decision 2026-10-30: slightly below the listed amounts).
  const METER = Object.freeze({ ball: 8, check: 4, conceded: 6, ace: 10, save: 6, assist: 4, teammate: .15, rate: .85, minSpeed: 60, cooldownTicks: 360 });
  // Efficiency, Synergy and Chemistry swing harder than other stats (owner decision 2026-10-30): their
  // multiplier is squared, 0.44–2.25×, so good super stats matter and poor ones hold a ubu back.
  const superStat = (P, raw) => P.multiplier(raw ?? 127) ** 2;
  function gainMeter(P, bodies, stats, body, amount, classic = false) {
    const changed = [];
    if (classic || !body || body.team < 0 || body.usedSuperThisTurn) return changed;
    const index = bodies.indexOf(body);
    if (index < 0) return changed;
    const gain = amount * METER.rate * superStat(P, stats[index]?.efficiency);
    body.meter = Math.min(100, Math.max(0, (body.meter || 0) + gain)); changed.push(body);
    const synergy = superStat(P, stats[index]?.synergy);
    bodies.forEach((other, i) => {
      if (other === body || other.team !== body.team || other.usedSuperThisTurn) return;
      other.meter = Math.min(100, Math.max(0, (other.meter || 0) + gain * synergy * superStat(P, stats[i]?.chemistry) * METER.teammate));
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
  // Save tuning (not an owner decision): the ball must be within `range` px of the goal mouth's
  // centre and, without the saver, due in within `ticks`.
  const SAVE = Object.freeze({ range: 300, ticks: 240 });
  // The save, if any, among the ubus (by index) that touched the ball in one tick. Only a lone touch
  // counts. From the field as it stood before that tick, the ball was close to and heading into the
  // ubu's own goal, and without it would soon have gone in touching nothing but the posts and net.
  // The touch must also have kept it out: from the field after the tick (`after`), the ball must not
  // go on into that goal, even off the boards, before another ubu touches it.
  // `own` marks a save from a ball the saver's own team was most responsible for (see `credit`).
  function saves(P, before, after, touched, credit = {}) {
    const ball = before.find(b => b.team === -1);
    if (touched.size !== 1 || !ball || ball.stuckTo) return [];
    const [i] = touched, team = before[i].team, mouth = team ? P.rink.right : P.rink.left;
    if (team < 0 || (team ? ball.vx <= 0 : ball.vx >= 0)) return [];
    if (Math.hypot(ball.x - mouth, ball.y - (P.rink.goalTop + P.rink.goalBottom) / 2) > SAVE.range) return [];
    if (P.wouldScore(before, before[i], SAVE.ticks) !== 1 - team) return [];
    if (P.ballRun(after, { boards: true, ticks: 2 * SAVE.ticks }).goal === 1 - team) return [];
    return [{ index: i, own: responsibleTeam(before, credit) !== 1 - team }];
  }
  // Responsibility for the ball's velocity, as each ubu's share (by index). After a tick in which ubus
  // touched the ball, the part of its new velocity carried over from its old one stays with whoever
  // gave it; the rest is split among that tick's touchers. A glancing deflection leaves the shot with
  // the shooter, while a ubu that stops or redirects the ball takes it over.
  function credit(shares, before, ball, touched) {
    if (!touched.size) return shares;
    const speed2 = ball.vx * ball.vx + ball.vy * ball.vy;
    const kept = speed2 ? Math.min(1, Math.max(0, (before.vx * ball.vx + before.vy * ball.vy) / speed2)) : 0;
    const next = {};
    for (const [i, share] of Object.entries(shares)) if (share * kept >= .01) next[i] = share * kept;
    for (const i of touched) next[i] = (next[i] || 0) + (1 - kept) / touched.size;
    return next;
  }
  // The team with the larger share of the ball's velocity, or null before anyone has touched it.
  function responsibleTeam(bodies, shares) {
    const total = [0, 0];
    for (const [i, share] of Object.entries(shares)) total[bodies[i].team] += share;
    return total[0] === total[1] ? null : total[0] > total[1] ? 0 : 1;
  }
  // A play runs from kickoff to goal: its age in ticks, the last toucher (overall and per team), who
  // passed to each team's last toucher, where each team last touched the ball, responsibility for the
  // ball's velocity, whether it has come off the boards since the last touch, the latest save and
  // whether the last touch was a big shot.
  function newPlay(from = {}) {
    return { age: from.age || 0, last: from.last ?? null, lastTouch: from.lastTouch ? [...from.lastTouch] : [null, null],
      assist: from.assist ? [...from.assist] : [null, null], shotX: from.shotX ? [...from.shotX] : [null, null],
      credit: { ...from.credit }, banked: Boolean(from.banked), saved: from.saved ? { ...from.saved } : null, big: Boolean(from.big) };
  }
  // Per-ubu match totals (by index) for the summary, and each team's deepest deficit.
  function newTally() {
    const six = () => [0, 0, 0, 0, 0, 0];
    return { goals: six(), assists: six(), saves: six(), topSpeed: six(), deficit: [0, 0] };
  }
  // A big shot is a lone touch by an ubu driving into the ball at `share` or more of its own
  // full-launch speed; the ball's own speed does not count, so a fast ball off a still ubu is not one.
  const BIG_SHOT = Object.freeze({ share: .8 });
  // Hit-stop in ms (tuning): `hit` for a real save, a spin strike or a big shot; `long` for a save of
  // a big shot, a spin strike that is also a big shot, or a big shot that will travel a rink height
  // untouched; `goal` for a big shot whose own path (no bounces, no ubus) goes into a goal.
  const HIT_STOP = Object.freeze({ hit: 60, long: 100, goal: 150 });
  function bigShot(P, before, touched, ball) {
    if (touched.size !== 1) return false;
    const [i] = touched, b = before[i], dx = ball.x - b.x, dy = ball.y - b.y, d = Math.hypot(dx, dy) || 1;
    return (b.vx * dx + b.vy * dy) / d >= BIG_SHOT.share * P.launchSpeed(b);
  }
  function hitStop(P, bodies, ball, big, struck, save, savedBig) {
    let ms = save || struck || big ? HIT_STOP.hit : 0;
    if ((save && savedBig) || (struck && big)) ms = HIT_STOP.long;
    if (big && P.ballRun(bodies, { boards: true, ticks: 480 }).distance >= P.rink.bottom - P.rink.top) ms = HIT_STOP.long;
    if (big && P.ballRun([ball], { ticks: 960 }).goal !== null) ms = HIT_STOP.goal;
    return ms;
  }
  // Per-tick scratch and the tick in progress, which the step callbacks below read, so neither is
  // rebuilt every tick. A nested tick would take fresh scratch and restore the outer tick after.
  let spareTick = null, activeTick = null;
  function tickTouch(a, b, speed) {
    const t = activeTick, player = toucher(a, b, speed);
    if (player) {
      // A touch passed from a teammate makes that teammate the assist; an opponent's touch clears it.
      const { bodies, play } = t, i = bodies.indexOf(player), team = player.team, last = play.last;
      if (last !== i) play.assist[team] = last !== null && bodies[last].team === team ? last : null;
      play.last = i; play.lastTouch[team] = i; play.shotX[team] = t.ball.x; play.banked = false;
      t.touched.add(i);
    }
    t.fx.collide?.(a, b, speed);
  }
  function tickWall(body, velocity, type, nx, ny) {
    const t = activeTick;
    if (body === t.ball && type === 'wall') t.play.banked = true;
    t.fx.wall?.(body, velocity, type, nx, ny);
  }
  // Steps the field one tick and keeps the play (and the tally, if given) current. Returns the goal
  // (as P.step reports it), the tick's saves, whether a close-range spin strike landed and the
  // hit-stop it earns (ms, 0 for none). `fx` receives the step callbacks. Without `effects` (CPU
  // search), the presentation-only hit-stop look-aheads are skipped; rules are unchanged.
  function playTick(P, bodies, play, fx = {}, tally = null, effects = true) {
    // Each tick records only motion; the full pre-tick field is rebuilt from it when the ball was
    // touched, which is all the save and big-shot checks need. Copying every body each tick was the
    // single largest cost of CPU search.
    const t = spareTick || { motion: new Float64Array(35), touched: new Set() }, outer = activeTick;
    spareTick = null; activeTick = t;
    if (t.motion.length < bodies.length * 5) t.motion = new Float64Array(bodies.length * 5);
    const { motion, touched } = t, ball = bodies.find(b => b.team === -1);
    touched.clear(); t.bodies = bodies; t.play = play; t.ball = ball; t.fx = fx;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      motion[i * 5] = b.x; motion[i * 5 + 1] = b.y; motion[i * 5 + 2] = b.vx; motion[i * 5 + 3] = b.vy; motion[i * 5 + 4] = b.omega;
    }
    const stuck = ball.stuckTo;
    play.age++;
    const goal = P.step(bodies, P.DT, tickTouch, tickWall, fx.shockwave, fx.super);
    activeTick = outer;
    const before = touched.size ? bodies.map((b, i) => ({ ...b, x: motion[i * 5], y: motion[i * 5 + 1], vx: motion[i * 5 + 2],
      vy: motion[i * 5 + 3], omega: motion[i * 5 + 4], stuckTo: b === ball ? stuck : b.stuckTo })) : null;
    const ballBefore = before?.[bodies.indexOf(ball)], tickSaves = touched.size ? saves(P, before, bodies, touched, play.credit) : [];
    play.credit = credit(play.credit, ballBefore, ball, touched);
    for (const save of tickSaves) play.saved = { at: play.age, team: bodies[save.index].team };
    // A Cannonball hit always counts as a big shot.
    const cannon = touched.size > 0 && [...touched].some(i => before[i].superActive === 'cannonball' && bodies[i].superActive !== 'cannonball');
    const speed = Math.hypot(ball.vx, ball.vy), big = cannon || bigShot(P, before, touched, ball), struck = Boolean(ball.spinStruck);
    const stop = effects ? hitStop(P, bodies, ball, big, struck, tickSaves.some(save => !save.own), play.big) : 0;
    if (touched.size) play.big = big;
    if (tally) {
      for (const i of touched) tally.topSpeed[i] = Math.max(tally.topSpeed[i], speed);
      for (const save of tickSaves) if (!save.own) tally.saves[save.index]++;
    }
    if (struck) ball.spinStruck = false;
    t.bodies = t.play = t.ball = t.fx = null; spareTick = t;
    return { goal, saves: tickSaves, struck, stop };
  }
  // A rebound is a goal within this many ticks of the conceding team's save.
  const REBOUND_TICKS = 240;
  // Names a goal and counts it in the tally. The scorer is the scoring team's last toucher, and the
  // assist the teammate who passed to them with no opponent touch in between. It is an own goal when
  // the conceding team was most responsible for the ball; own goals credit no scorer or assist.
  function callGoal(bodies, play, tally, goal, ace) {
    const own = responsibleTeam(bodies, play.credit) === 1 - goal, scorer = play.lastTouch[goal];
    const assist = own || scorer === null ? null : play.assist[goal];
    let hatTrick = false;
    if (!own && scorer !== null) hatTrick = ++tally.goals[scorer] === 3;
    if (assist !== null) tally.assists[assist]++;
    const shotX = play.shotX[goal], snipe = shotX !== null && (goal === 0 ? shotX < 500 : shotX > 500);
    const rebound = play.saved?.team === 1 - goal && play.age - play.saved.at <= REBOUND_TICKS;
    const label = own ? 'OWN GOAL' : hatTrick ? 'HAT TRICK!' : play.banked ? 'BANK SHOT!' : snipe ? 'SNIPE!' : rebound ? 'REBOUND!' : ace ? 'ACE!' : 'GOAL';
    return { scorer, assist, own, label };
  }
  // After each goal: each team's deepest deficit so far, for the comeback call.
  function noteScore(tally, scores) {
    for (const team of [0, 1]) tally.deficit[team] = Math.max(tally.deficit[team], scores[1 - team] - scores[team]);
  }
  // The full-time honours for a winner: a comeback from 3 or more down, or a shutout.
  function honours(tally, scores, winner) {
    return { comeback: tally.deficit[winner] >= 3, shutout: scores[1 - winner] === 0 };
  }
  // `bonus` names who earns goal bonuses (by index): `ace` for a goal (not an own goal) on the round's
  // first turn, and `assist`.
  function finishTurn(P, bodies, stats, scores, goal, mode, bonus = {}) {
    const classic = rule(mode, 'classic');
    // Turn effects end every turn; in Pulse, momentum carries into the next one.
    P.stop(bodies, rule(mode, 'pulse') && goal === null);
    for (const b of bodies.slice(0, 6)) {
      if (b.stunnedNext) { b.stunned = true; delete b.stunnedNext; }
    }
    if (goal !== null) {
      scores[goal]++;
      for (const b of bodies.filter(b => b.team === 1 - goal)) gainMeter(P, bodies, stats, b, METER.conceded, classic);
      if (bonus.ace != null) gainMeter(P, bodies, stats, bodies[bonus.ace], METER.ace, classic);
      if (bonus.assist != null) gainMeter(P, bodies, stats, bodies[bonus.assist], METER.assist, classic);
    }
    return goal !== null && scores[goal] >= 5 ? goal : null;
  }
  // `effects: false` resolves the same turn without presentation-only work (hit-stop look-aheads,
  // the replay's starting snapshot), for fast CPU search. CPU search may also end a turn early: after
  // `ticks`, or once `decided(bodies)` reports its outcome is clear, and may `watch` contacts and
  // board hits (step callbacks). Matches pass none of these.
  function resolveTurn(P, state, moves, { effects = true, ticks: maxTicks = Infinity, decided = null, watch = null } = {}) {
    if (state.version !== VERSION || !MODES.includes(state.mode)) throw new Error('Unsupported match rules.');
    if (!Array.isArray(moves) || moves.length !== 6) throw new Error('Both teams must submit.');
    const plans = [...validatePlans(moves.slice(0, 3)), ...validatePlans(moves.slice(3))];
    const next = structuredClone(state), bodies = next.bodies;
    const classic = rule(state.mode, 'classic'), limit = Math.min(turnTicks(state.mode), maxTicks);
    bodies.slice(0, 6).forEach((b, i) => {
      if (plans[i].superArm && (classic || b.stunned || b.meter < 100 || !b.equippedSuper)) throw new Error('Super unavailable.');
      b.superArm = false;
    });
    const initialBodies = effects ? structuredClone(bodies) : null;
    // The play persists until a goal, so a Pulse goal credits a touch from an earlier turn.
    const play = newPlay(state);
    P.startTurn(bodies, plans);
    // The match clock counts simulated ticks across turns for meter cooldowns.
    const clock = state.clock || 0;
    let goal = null, ticks = 0;
    const saved = [], struck = [], stops = [], tally = state.tally ? structuredClone(state.tally) : newTally();
    for (let tick = 1; tick <= limit; tick++) {
      const result = playTick(P, bodies, play, { collide: (a, b, speed) => { contactMeter(P, bodies, next.stats, a, b, speed, clock + tick, classic); watch?.collide?.(a, b, speed); },
        wall: watch?.wall }, tally, effects);
      goal = result.goal;
      for (const save of result.saves) {
        saved.push({ tick, ...save });
        if (!save.own) gainMeter(P, bodies, next.stats, bodies[save.index], METER.save, classic);
      }
      if (result.struck) struck.push(tick);
      if (result.stop) stops.push({ tick, ms: result.stop });
      ticks = tick;
      const done = goal !== null || P.settled(bodies) || tick === limit || Boolean(decided?.(bodies));
      if (done) break;
    }
    // A round runs from kickoff to goal; scoring on its first turn is an ace.
    const ace = goal !== null && !state.roundTurns;
    const call = goal === null ? { scorer: null, assist: null, own: false, label: null } : callGoal(bodies, play, tally, goal, ace);
    next.winner = finishTurn(P, bodies, next.stats, next.scores, goal, state.mode, { ace: ace && !call.own ? call.scorer : null, assist: call.assist });
    if (goal !== null) noteScore(tally, next.scores);
    next.roundTurns = goal === null ? (state.roundTurns || 0) + 1 : 0;
    next.clock = clock + ticks;
    Object.assign(next, goal === null ? play : newPlay(), { tally });
    next.turn++;
    next.phase = next.winner !== null ? 'over' : goal !== null ? 'goal' : 'plan';
    return { state: next, replay: { version: VERSION, turn: state.turn, plans, ticks, goal, scorer: call.scorer, assist: call.assist,
      label: call.label, saves: saved, struck, stops, initialBodies } };
  }
  const api = { VERSION, RULES, MODES, GOAL_REPLAY_DELAY, GOAL_REPLAY_HOLD, replaySpeed, replayMilliseconds, validatePlans, rule, modeName, planningMilliseconds, turnTicks, applyStats, METER, SAVE, BIG_SHOT, HIT_STOP, gainMeter, contactMeter, toucher, saves, credit, responsibleTeam, newPlay, newTally, playTick, callGoal, noteScore, honours, finishTurn, resolveTurn };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallMatch = api;
})(globalThis);
