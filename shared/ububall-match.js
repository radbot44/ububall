/* Shared match rules; callers supply authenticated, server-derived roster data. */
(function(root) {
  'use strict';
  const VERSION = 5;
  // Classic, Pulse and Blitz are independent rules, joined in this order; 'standard' has none.
  const RULES = ['classic', 'pulse', 'blitz'];
  const MODES = Array.from({ length: 8 }, (_, n) => RULES.filter((r, i) => n >> i & 1).join('-') || 'standard');
  const RULE_BIT = { classic: 1, pulse: 2, blitz: 4 };
  const MODE_MASK = Object.create(null);
  MODES.forEach((m, n) => { MODE_MASK[m] = n; });

  const BLITZ_MILLISECONDS = 5000, TURN_TICKS = 2880, PULSE_TICKS = 240;
  const GOAL_REPLAY_DELAY = 1600, GOAL_REPLAY_HOLD = 1200;
  // Goal replays run in real time, then ease to half speed over the last second before the goal.
  function replaySpeed(ticksLeft) { return .5 + .5 * Math.min(1, Math.max(0, (ticksLeft - 72) / 168)); }
  // Post-goal motion eases from full speed down to half speed over 300 ms (72 ticks).
  function postGoalSpeed(ticksElapsed) { return Math.max(.5, 1 - .5 * Math.min(1, ticksElapsed / 72)); }
  // Wall-clock length of a goal's celebration delay, replay and closing hold.
  function replayMilliseconds(P, ticks) {
    let ms = GOAL_REPLAY_DELAY + GOAL_REPLAY_HOLD;
    for (let left = ticks; left > 0; left--) ms += P.DT * 1000 / replaySpeed(left);
    return Math.ceil(ms);
  }
  const PLAN_KEYS = { angle: 1, power: 1, spin: 1, superArm: 1, guard: 1 };
  function validatePlans(input) {
    if (!Array.isArray(input) || input.length !== 3) throw new Error('Submit exactly three moves.');
    const out = new Array(3);
    for (let i = 0; i < 3; i++) {
      const p = input[i];
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('Invalid move.');
      for (const k in p) {
        if (Object.prototype.hasOwnProperty.call(p, k) && !PLAN_KEYS[k]) throw new Error('Invalid move.');
      }
      if (!Number.isFinite(p.angle) || !Number.isFinite(p.power) || !Number.isFinite(p.spin) ||
          p.power < 0 || p.power > 1 || p.spin < -1 || p.spin > 1 || typeof p.superArm !== 'boolean' || typeof p.guard !== 'boolean') throw new Error('Invalid move.');
      out[i] = { angle: ((p.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), power: p.power, spin: p.spin, superArm: p.superArm, guard: p.guard };
    }
    return out;
  }
  function rule(mode, name) {
    const mask = MODE_MASK[mode];
    if (mask === undefined) throw new Error('Invalid mode.');
    const bit = RULE_BIT[name];
    return bit ? (mask & bit) !== 0 : false;
  }
  // "Standard ububall" with no rules on, otherwise the rules in play: "Pulse + Blitz".
  function modeName(mode) {
    return RULES.filter(r => rule(mode, r)).map(r => r[0].toUpperCase() + r.slice(1)).join(' + ') || 'Standard ububall';
  }
  function planningMilliseconds(mode) { return rule(mode, 'blitz') ? BLITZ_MILLISECONDS : null; }
  // Pulse turns stop after one second of simulation instead of waiting for the field to settle.
  function turnTicks(mode) { return rule(mode, 'pulse') ? PULSE_TICKS : TURN_TICKS; }
  function applyStats(P, body, raw, mode) {
    P.applyStats(body, rule(mode, 'classic') ? {} : raw);
  }
  const METER = Object.freeze({ ball: 8, check: 4, conceded: 6, ace: 10, save: 6, assist: 4, pass: 4, teammate: .28, rate: .85, minSpeed: 60, cooldownTicks: 360 });
  const SUPER_STAT_TABLE = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const m = i < 127 ? (2 / 3) ** ((127 - i) / 127) : 1.5 ** ((i - 127) / 128);
    SUPER_STAT_TABLE[i] = m * m;
  }
  const superStat = (P, raw) => {
    const r = raw ?? 127;
    return (Number.isInteger(r) && r >= 0 && r <= 255) ? SUPER_STAT_TABLE[r] : P.multiplier(r) ** 2;
  };
  function gainMeter(P, bodies, stats, body, amount, classic = false) {
    const changed = [];
    if (classic || !body || body.team < 0 || body.usedSuperThisTurn) return changed;
    const index = bodies.indexOf(body);
    if (index < 0) return changed;
    const gain = amount * METER.rate * superStat(P, stats[index]?.efficiency);
    body.meter = Math.min(100, Math.max(0, (body.meter || 0) + gain)); changed.push(body);
    const synergy = superStat(P, stats[index]?.synergy);
    const skaterEnd = bodies.length === 7 && bodies[6].team === -1 ? 6 : bodies.length;
    for (let i = 0; i < skaterEnd; i++) {
      const other = bodies[i];
      if (other === body || other.team !== body.team || other.usedSuperThisTurn) continue;
      other.meter = Math.min(100, Math.max(0, (other.meter || 0) + gain * synergy * superStat(P, stats[i]?.chemistry) * METER.teammate));
      changed.push(other);
    }
    return changed;
  }
  function gainMeterSilent(P, bodies, stats, body, index, amount) {
    if (!body || body.team < 0 || body.usedSuperThisTurn || index < 0) return;
    const gain = amount * METER.rate * superStat(P, stats[index]?.efficiency);
    body.meter = Math.min(100, Math.max(0, (body.meter || 0) + gain));
    const synergy = superStat(P, stats[index]?.synergy);
    const skaterEnd = bodies.length === 7 && bodies[6].team === -1 ? 6 : bodies.length;
    for (let i = 0; i < skaterEnd; i++) {
      const other = bodies[i];
      if (i === index || other.team !== body.team || other.usedSuperThisTurn) continue;
      other.meter = Math.min(100, Math.max(0, (other.meter || 0) + gain * synergy * superStat(P, stats[i]?.chemistry) * METER.teammate));
    }
  }
  function contactMeter(P, bodies, stats, a, b, speed, tick, classic = false, passerSlot = -1) {
    const ball = a.team === -1 ? a : b.team === -1 ? b : null;
    if (speed < METER.minSpeed || (!ball && a.team === b.team)) return [];
    const changed = [];
    for (const body of ball ? [ball === a ? b : a] : [a, b]) {
      if (tick - (body.meterTick ?? -Infinity) < METER.cooldownTicks) continue;
      body.meterTick = tick;
      changed.push(...gainMeter(P, bodies, stats, body, ball ? METER.ball : METER.check, classic));
      if (!classic && ball && passerSlot >= 0) {
        const recvIdx = bodies.indexOf(body);
        const passerIdx = bodies.findIndex(o => o.team === body.team && o.slot === passerSlot);
        if (recvIdx >= 0 && passerIdx >= 0 && passerIdx !== recvIdx) {
          const passGain = METER.pass * METER.rate * superStat(P, stats?.[passerIdx]?.synergy) * superStat(P, stats?.[recvIdx]?.chemistry);
          if (!body.usedSuperThisTurn) {
            body.meter = Math.min(100, Math.max(0, (body.meter || 0) + passGain));
            if (!changed.includes(body)) changed.push(body);
          }
          const passer = bodies[passerIdx];
          if (passer && !passer.usedSuperThisTurn && !passer.carded) {
            passer.meter = Math.min(100, Math.max(0, (passer.meter || 0) + passGain * .5));
            if (!changed.includes(passer)) changed.push(passer);
          }
        }
      }
    }
    return changed;
  }
  function contactMeterSilent(P, bodies, stats, a, b, speed, tick, classic = false, passerSlot = -1) {
    const ball = a.team === -1 ? a : b.team === -1 ? b : null;
    if (speed < METER.minSpeed || (!ball && a.team === b.team)) return;
    const skaterEnd = bodies.length === 7 && bodies[6].team === -1 ? 6 : bodies.length;
    if (ball) {
      const body = ball === a ? b : a;
      if (tick - (body.meterTick ?? -Infinity) < METER.cooldownTicks) return;
      body.meterTick = tick;
      if (classic) return;
      const recvIdx = bodies.indexOf(body);
      gainMeterSilent(P, bodies, stats, body, recvIdx, METER.ball);
      if (passerSlot >= 0 && recvIdx >= 0) {
        let passerIdx = -1;
        for (let i = 0; i < skaterEnd; i++) {
          const o = bodies[i];
          if (o.team === body.team && o.slot === passerSlot) { passerIdx = i; break; }
        }
        if (passerIdx >= 0 && passerIdx !== recvIdx) {
          const passGain = METER.pass * METER.rate * superStat(P, stats?.[passerIdx]?.synergy) * superStat(P, stats?.[recvIdx]?.chemistry);
          if (!body.usedSuperThisTurn) {
            body.meter = Math.min(100, Math.max(0, (body.meter || 0) + passGain));
          }
          const passer = bodies[passerIdx];
          if (passer && !passer.usedSuperThisTurn && !passer.carded) {
            passer.meter = Math.min(100, Math.max(0, (passer.meter || 0) + passGain * .5));
          }
        }
      }
    } else {
      for (let pair = 0; pair < 2; pair++) {
        const body = pair === 0 ? a : b;
        if (tick - (body.meterTick ?? -Infinity) < METER.cooldownTicks) continue;
        body.meterTick = tick;
        if (!classic) gainMeterSilent(P, bodies, stats, body, bodies.indexOf(body), METER.check);
      }
    }
  }
  // The ubu behind a real ball contact, or null.
  function toucher(a, b, speed) {
    if (speed < 15 || (a.team === -1) === (b.team === -1)) return null;
    return a.team === -1 ? b : a;
  }
  const SAVE = Object.freeze({ range: 300, ticks: 240 });
  function saves(P, before, after, touched, credit = {}) {
    const ball = before.length === 7 && before[6].team === -1 ? before[6] : before.find(b => b.team === -1);
    if (touched.size !== 1 || !ball || P.holder(before)) return [];
    const [i] = touched, team = before[i].team, mouth = team ? P.rink.right : P.rink.left;
    if (team < 0 || (team ? ball.vx <= 0 : ball.vx >= 0)) return [];
    if (Math.hypot(ball.x - mouth, ball.y - (P.rink.goalTop + P.rink.goalBottom) / 2) > SAVE.range) return [];
    const speed = Math.hypot(ball.vx, ball.vy), horizon = SAVE.ticks * P.DT;
    const turn = Math.abs(ball.omega || 0) * P.ballCurveFactor(ball, true) * horizon;
    const horizontalReach = horizon * (Math.abs(ball.vx) + speed * Math.min(1, turn));
    if (Math.abs(ball.x - mouth) - ball.radius > horizontalReach) return [];
    let anyMagnet = false;
    const skaterEnd = before.length === 7 && before[6].team === -1 ? 6 : before.length;
    for (let idx = 0; idx < skaterEnd; idx++) {
      if (idx !== i && before[idx].team >= 0 && before[idx].superActive === 'magnet') { anyMagnet = true; break; }
    }
    if (!anyMagnet && P.ballRun([ball], { ticks: SAVE.ticks }).goal !== 1 - team) return [];
    if (P.wouldScore(before, before[i], SAVE.ticks) !== 1 - team) return [];
    if (P.ballRun(after, { boards: true, ticks: 2 * SAVE.ticks }).goal === 1 - team) return [];
    return [{ index: i, own: responsibleTeam(before, credit) !== 1 - team }];
  }
  const EMPTY_SAVES = Object.freeze([]);
  const SHOT_SURVIVE_TICKS = 120;
  function credit(shares, before, ball, touched, bodiesBefore = null) {
    if (!touched.size) return shares;
    const speed2 = ball.vx * ball.vx + ball.vy * ball.vy;
    let kept = speed2 ? Math.min(1, Math.max(0, (before.vx * ball.vx + before.vy * ball.vy) / speed2)) : 0;
    if ((before.vx > 50 && ball.vx < -50) || (before.vx < -50 && ball.vx > 50)) kept = 0;
    if (bodiesBefore && touched.size === 1) {
      const [i] = touched, b = bodiesBefore[i];
      if (b && b.team >= 0) {
        const ballToOwnBefore = b.team === 0 ? before.vx < -50 : before.vx > 50;
        const ballToOwnAfter = b.team === 0 ? ball.vx < -20 : ball.vx > 20;
        const driveToOwn = b.team === 0 ? -b.vx : b.vx;
        if (ballToOwnBefore && ballToOwnAfter && driveToOwn < 60) kept = Math.max(kept, 0.75);
      }
    }
    const next = {};
    for (const [i, share] of Object.entries(shares)) if (share * kept >= .01) next[i] = share * kept;
    for (const i of touched) next[i] = (next[i] || 0) + (1 - kept) / touched.size;
    return next;
  }
  function responsibleTeam(bodies, shares) {
    const total = [0, 0];
    for (const [i, share] of Object.entries(shares)) total[bodies[i].team] += share;
    return total[0] === total[1] ? null : total[0] > total[1] ? 0 : 1;
  }
  function newPlay(from = {}) {
    return { age: from.age || 0, last: from.last ?? null, lastTouch: from.lastTouch ? [...from.lastTouch] : [null, null],
      assist: from.assist ? [...from.assist] : [null, null], shotX: from.shotX ? [...from.shotX] : [null, null],
      credit: { ...from.credit }, banked: Boolean(from.banked),
      saved: from.saved ? { ...from.saved } : null, big: Boolean(from.big),
      lastPass: from.lastPass ? { ...from.lastPass } : null,
      passOrigin: from.passOrigin ? { ...from.passOrigin } : null,
      shot: from.shot ? { ...from.shot } : null,
      checks: from.checks ? from.checks.map(c => (c ? { ...c } : null)) : Array(6).fill(null),
      postCounted: Boolean(from.postCounted) };
  }
  function newTally() {
    const six = () => [0, 0, 0, 0, 0, 0];
    return { goals: six(), assists: six(), saves: six(), bigSaves: six(), shots: six(), checks: six(), topSpeed: six(), cards: six(), deficit: [0, 0] };
  }
  const BIG_SHOT = Object.freeze({ share: .8 });
  const HIT_STOP = Object.freeze({ fire: 35, post: 40, hit: 60, snap: 60, long: 100, goal: 150, iron: 150, scoredGoal: 200 });
  const SCREEN_SHAKE = Object.freeze({ default: 1, goal: 2 });
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
  function applyBallPossession(bodies, play, ball, i, impulse, preBallSpeed, age, fx, deferPasses = null) {
    const team = bodies[i].team, last = play.last;
    let passSender = -1;
    if (last !== null && bodies[last].team !== team) {
      if (impulse >= 35) {
        play.assist[1 - team] = null;
        play.assist[team] = null;
        play.lastPass = null;
        play.last = i;
        play.banked = false;
        play.postCounted = false;
        passSender = i;
      }
      play.lastTouch[team] = i;
      play.shotX[team] = ball.x;
    } else {
      if (last !== null && last !== i) {
        play.assist[team] = last;
        const origin = play.passOrigin?.from === last ? play.passOrigin : null;
        play.lastPass = {
          from: last,
          to: i,
          at: origin ? origin.at : age,
          speed: Math.max(preBallSpeed || 0, origin ? origin.speed : 0),
          touches: 1
        };
        if (deferPasses) deferPasses.push({ from: last, to: i });
        else fx.pass?.(last, i, ball);
      } else if (last === i) {
        if (play.lastPass && play.lastPass.to === i) play.lastPass.touches = (play.lastPass.touches || 1) + 1;
        if (play.assist[team] === i) play.assist[team] = null;
      }
      play.last = i;
      play.lastTouch[team] = i;
      play.shotX[team] = ball.x;
      play.banked = false;
      play.postCounted = false;
      passSender = i;
    }
    return passSender;
  }
  let spareTick = null, activeTick = null;
  function findSkaterIdx(bodies, target) {
    const n = bodies.length === 7 ? 6 : bodies.length;
    for (let i = 0; i < n; i++) if (bodies[i] === target) return i;
    return -1;
  }
  function getTickPreBallSpeed(t) {
    if (t.preBallSpeed < 0) {
      t.preBallSpeed = t.ball ? Math.hypot(t.curBvx, t.curBvy) : 0;
    }
    return t.preBallSpeed;
  }
  function tickTouch(contact) {
    const { a, b, speed, impulse, plow, iron, checker, snapped, spinStruck } = contact;
    const t = activeTick, player = toucher(a, b, speed);
    if (snapped) t.snapped = true;
    if (spinStruck) t.spinStruck = true;
    if ((a.team === -1 || b.team === -1) && speed >= 15 && (plow || t.preOnFire || (t.ball?.onFire && !t.cannon))) {
      t.fireHit = true;
    }
    if (a.team >= 0 && b.team >= 0) {
      const ai = findSkaterIdx(t.bodies, a), bi = findSkaterIdx(t.bodies, b);
      if (checker !== null) {
        const ci = checker === a ? ai : bi, vi = checker === a ? bi : ai;
        if (ci >= 0 && vi >= 0) t.checked.push({ ci, vi, team: checker.team });
        if (t.tally && ci >= 0) t.tally.checks[ci]++;
      } else {
        if (ai >= 0) t.bumped.add(ai);
        if (bi >= 0) t.bumped.add(bi);
      }
    } else if (checker !== null && t.tally) {
      const ci = findSkaterIdx(t.bodies, checker);
      if (ci >= 0) t.tally.checks[ci]++;
    }
    if (player && !plow) {
      const { bodies, play } = t, i = findSkaterIdx(bodies, player);
      const ps = applyBallPossession(bodies, play, t.ball, i, impulse, getTickPreBallSpeed(t), play.age, t.fx, play.checks?.[i] ? t.deferredPasses : null);
      if (ps >= 0) t.passSender = ps;
      t.touched.add(i);
      if (iron) t.ironSaver = i;
    }
    t.fx.collide?.(contact);
  }
  function tickWall(body, velocity, type, nx, ny, rimmed = false) {
    const t = activeTick;
    if (body === t.ball && type === 'wall') {
      t.play.banked = true;
    } else if (body === t.ball && type === 'post') {
      t.postSide = body.x > 500 ? 0 : 1;
      t.postX = body.x; t.postY = body.y;
      if (velocity >= 300) t.postRing = true;
    } else if (body !== t.ball && body.team >= 0) {
      const bi = findSkaterIdx(t.bodies, body);
      if (bi >= 0) t.wallBumped.add(bi);
    }
    t.fx.wall?.(body, velocity, type, nx, ny, rimmed);
  }
  function recordSaves(bodies, play, tally, tickSaves, incomingBig, onSave = null) {
    for (const save of tickSaves) {
      if (save.own) continue;
      play.saved = { at: play.age, team: bodies[save.index].team };
      const shooter = play.lastTouch[1 - bodies[save.index].team];
      const big = Boolean(save.iron || incomingBig);
      if (tally) {
        tally.saves[save.index]++;
        if (big) tally.bigSaves[save.index]++;
      }
      let shotType = null;
      if (shooter !== null && !play.postCounted) {
        if (tally) tally.shots[shooter]++;
        play.postCounted = true;
        shotType = 'Saved';
      }
      onSave?.(save, shooter, big, shotType);
    }
  }
  function recordGoal(play, tally, scorer, assist) {
    let hatTrick = false;
    if (scorer !== null && tally) {
      hatTrick = ++tally.goals[scorer] === 3;
      if (!play.postCounted) {
        tally.shots[scorer]++;
        play.postCounted = true;
      }
    }
    if (assist !== null && tally) tally.assists[assist]++;
    return hatTrick;
  }
  function recordCards(tally, cards) {
    if (!tally || !cards) return;
    for (let i = 0; i < cards.length; i++) tally.cards[cards[i]]++;
  }
  function playTick(P, bodies, play, fx = {}, tally = null, effects = true, skipSaves = false) {
    const t = spareTick || {
      motion: new Float64Array(35), daze: new Float64Array(7), iron: new Uint8Array(7), sup: new Array(7),
      touched: new Set(), attrSet: new Set(), checked: [], bumped: new Set(), wallBumped: new Set(), deferredPasses: []
    }, outer = activeTick;
    spareTick = null; activeTick = t;
    if (t.motion.length < bodies.length * 5) t.motion = new Float64Array(bodies.length * 5);
    if (t.daze.length < bodies.length) { t.daze = new Float64Array(bodies.length); t.iron = new Uint8Array(bodies.length); t.sup = new Array(bodies.length); }
    const { motion, touched } = t;
    const std7 = bodies.length === 7 && bodies[6].team === -1;
    const ball = std7 ? bodies[6] : bodies.find(b => b.team === -1);
    if (touched.size) touched.clear();
    if (t.bumped.size) t.bumped.clear();
    if (t.wallBumped.size) t.wallBumped.clear();
    if (t.checked.length) t.checked.length = 0;
    if (t.deferredPasses.length) t.deferredPasses.length = 0;
    t.bodies = bodies; t.play = play; t.ball = ball; t.fx = fx; t.tally = tally;
    t.cannon = false; t.fireHit = false; t.snapped = false; t.spinStruck = false; t.postRing = false; t.postSide = -1; t.postX = 0; t.postY = 0;
    t.incomingCredit = null; t.passSender = -1; t.stickyGrab = -1; t.ironSaver = -1; t.magnetTeam = -1;
    t.preBallX = ball ? ball.x : 0; t.preBallY = ball ? ball.y : 0;
    t.preBallSpeed = -1;
    t.preOnFire = Boolean(ball?.onFire);
    t.curBvx = ball ? ball.vx : 0; t.curBvy = ball ? ball.vy : 0;
    let held = null;
    if (std7) {
      for (let i = 0; i < 6; i++) {
        const b = bodies[i];
        if (b.holding && !held) held = b;
        const base = i * 5;
        motion[base] = b.x; motion[base + 1] = b.y; motion[base + 2] = b.vx; motion[base + 3] = b.vy; motion[base + 4] = b.omega;
        t.daze[i] = b.daze || 0; t.iron[i] = b.ironGuard ? 1 : 0; t.sup[i] = b.superActive || null;
      }
      motion[30] = ball.x; motion[31] = ball.y; motion[32] = ball.vx; motion[33] = ball.vy; motion[34] = ball.omega;
      t.daze[6] = 0; t.iron[6] = 0; t.sup[6] = null;
    } else {
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.team >= 0 && b.holding && !held) held = b;
        motion[i * 5] = b.x; motion[i * 5 + 1] = b.y; motion[i * 5 + 2] = b.vx; motion[i * 5 + 3] = b.vy; motion[i * 5 + 4] = b.omega;
        t.daze[i] = b.team >= 0 ? (b.daze || 0) : 0;
        t.iron[i] = b.team >= 0 && b.ironGuard ? 1 : 0;
        t.sup[i] = b.team >= 0 ? (b.superActive || null) : null;
      }
    }
    const incomingStrikerTeam = ball?.strikerTeam ?? -1;
    const preCurveMult = ball?.curveMult ?? 1, preOnFire = Boolean(ball?.onFire), preFireTicks = ball?.fireTicks || 0, prePace = ball?.pace || 0;
    let anyChecks = false;
    if (play.checks) {
      for (let i = 0; i < play.checks.length; i++) if (play.checks[i]) { anyChecks = true; break; }
    }
    const preCheckPlay = anyChecks ? {
      lt0: play.lastTouch[0], lt1: play.lastTouch[1],
      sx0: play.shotX[0], sx1: play.shotX[1]
    } : null;
    play.age++;
    t.onShockwave ??= (source, radius, type = null) => {
      activeTick?.fx?.shockwave?.(source, radius, type);
    };
    t.onSuper ??= (key, action, body, target) => {
      const at = activeTick;
      if (!at) return;
      if (key === 'cannonball' && action === 'impact') at.cannon = true;
      if (key === 'sticky' && action === 'impact' && body && body.team >= 0 && at.ball) {
        const bi = at.bodies.indexOf(body);
        if (bi >= 0) {
          at.stickyGrab = bi;
          if (at.play.last !== bi) {
            const ps = applyBallPossession(at.bodies, at.play, at.ball, bi, Infinity, getTickPreBallSpeed(at), at.play.age, at.fx, null);
            if (ps >= 0) at.passSender = ps;
          }
        }
      }
      if (key === 'magnet' && action === 'pull' && body && at.ball) {
        at.incomingCredit ??= { ...at.play.credit };
        const bi = at.bodies.indexOf(body);
        if (bi >= 0) {
          const bvx = at.curBvx, bvy = at.curBvy;
          const beforeSpeed2 = bvx * bvx + bvy * bvy, curSpeed2 = at.ball.vx * at.ball.vx + at.ball.vy * at.ball.vy;
          const denom = Math.max(beforeSpeed2, curSpeed2);
          let kept = denom ? Math.min(1, Math.max(0, (bvx * at.ball.vx + bvy * at.ball.vy) / denom)) : 0;
          const strikerTeam = at.ball.strikerTeam ?? -1;
          if (body.team === strikerTeam || strikerTeam < 0) {
            if (at.play.lastTouch[body.team] === null || 1 - kept > 0.05) {
              if (at.play.last !== null && at.play.last !== bi && at.bodies[at.play.last].team === body.team) {
                at.play.assist[body.team] = at.play.last;
              } else if (at.play.assist[body.team] === bi) {
                at.play.assist[body.team] = null;
              }
              at.play.last = bi; at.play.lastTouch[body.team] = bi; at.play.shotX[body.team] = at.ball.x;
            }
            at.magnetTeam = body.team;
            if (strikerTeam < 0) {
              at.play.credit = { [bi]: 1 };
            } else {
              const next = {};
              for (const [idx, share] of Object.entries(at.play.credit)) if (share * kept >= 0.01) next[idx] = share * kept;
              next[bi] = (next[bi] || 0) + (1 - kept);
              at.play.credit = next;
            }
          } else {
            const ballToOwnBefore = body.team === 0 ? bvx < -50 : bvx > 50;
            const ballToOwnAfter = body.team === 0 ? at.ball.vx < -20 : at.ball.vx > 20;
            const driveToOwn = body.team === 0 ? -body.vx : body.vx;
            if (ballToOwnBefore && ballToOwnAfter && driveToOwn < 60) kept = Math.max(kept, 0.75);
            const next = {};
            for (const [idx, share] of Object.entries(at.play.credit)) if (share * kept >= 0.01) next[idx] = share * kept;
            next[bi] = (next[bi] || 0) + (1 - kept);
            at.play.credit = next;
            if (responsibleTeam(at.bodies, next) === body.team) {
              at.play.assist[1 - body.team] = null;
              at.play.lastPass = null;
              if (at.play.assist[body.team] === bi) at.play.assist[body.team] = null;
              at.play.last = bi; at.play.lastTouch[body.team] = bi; at.play.shotX[body.team] = at.ball.x;
              at.magnetTeam = body.team;
            }
          }
          at.curBvx = at.ball.vx; at.curBvy = at.ball.vy;
        }
      }
      at.fx?.super?.(key, action, body, target);
    };
    let needSuperCb = Boolean(fx.super);
    if (!needSuperCb) {
      const lim = std7 ? 6 : bodies.length;
      for (let i = 0; i < lim; i++) {
        const sa = bodies[i].superActive;
        if (sa === 'cannonball' || sa === 'sticky' || sa === 'magnet') { needSuperCb = true; break; }
      }
    }
    const swCb = fx.shockwave ? t.onShockwave : null;
    const supCb = needSuperCb ? t.onSuper : null;
    let goal;
    if (outer === null) {
      goal = P.step(bodies, P.DT, tickTouch, tickWall, swCb, supCb);
      activeTick = null;
    } else {
      try {
        goal = P.step(bodies, P.DT, tickTouch, tickWall, swCb, supCb);
      } finally {
        activeTick = outer;
      }
    }
    const cannon = t.cannon, postRing = t.postRing, postSide = t.postSide;
    if (play.checks && t.bumped.size) {
      for (const bi of t.bumped) play.checks[bi] = null;
    }
    let s1a = null;
    if (ball && touched.size === 1 && t.stickyGrab < 0 && t.ironSaver < 0 && play.checks) {
      const [only] = touched, chk = play.checks[only];
      if (chk && bodies[chk.checker]) {
        const gap = play.age - chk.at;
        if (gap > 0 && gap <= 60 && chk.dvToward >= 60 && chk.postToward >= 60) {
          const vPreVx = motion[only * 5 + 2], vPreVy = motion[only * 5 + 3];
          const dot = vPreVx * chk.postVx + vPreVy * chk.postVy;
          const mag = (Math.hypot(vPreVx, vPreVy) || 1) * (Math.hypot(chk.postVx, chk.postVy) || 1);
          const ballToOwn = chk.team === 0 ? ball.vx < -20 : ball.vx > 20;
          if (dot / mag > 0.35 && !ballToOwn) s1a = chk;
        }
      }
    }
    if (play.checks) {
      if (touched.size) for (const i of touched) play.checks[i] = null;
      for (let ci = 0; ci < t.checked.length; ci++) {
        const c = t.checked[ci];
        const preVx = motion[c.vi * 5 + 2], preVy = motion[c.vi * 5 + 3];
        const dx = t.preBallX - motion[c.vi * 5], dy = t.preBallY - motion[c.vi * 5 + 1];
        const dist = Math.hypot(dx, dy) || 1;
        const preToward = (preVx * dx + preVy * dy) / dist;
        const post = bodies[c.vi];
        const postToward = (post.vx * dx + post.vy * dy) / dist;
        play.checks[c.vi] = {
          checker: c.ci, team: c.team, at: play.age,
          preToward, postToward, dvToward: postToward - preToward,
          postVx: post.vx, postVy: post.vy
        };
      }
      if (t.wallBumped.size) for (const bi of t.wallBumped) play.checks[bi] = null;
    }
    if (s1a && preCheckPlay && ball) {
      play.assist[0] = null; play.assist[1] = null; play.lastPass = null;
      play.last = s1a.checker;
      play.lastTouch[0] = preCheckPlay.lt0; play.lastTouch[1] = preCheckPlay.lt1;
      play.shotX[0] = preCheckPlay.sx0; play.shotX[1] = preCheckPlay.sx1;
      play.lastTouch[s1a.team] = s1a.checker;
      play.shotX[s1a.team] = ball.x;
      play.banked = false;
      play.postCounted = false;
      t.passSender = s1a.checker;
      t.deferredPasses.length = 0;
    } else if (t.deferredPasses.length && ball) {
      for (let pi = 0; pi < t.deferredPasses.length; pi++) {
        const p = t.deferredPasses[pi];
        fx.pass?.(p.from, p.to, ball);
      }
    }
    if (t.passSender >= 0 && ball) {
      play.passOrigin = { from: t.passSender, at: play.age, speed: Math.hypot(ball.vx, ball.vy) };
    }
    const before = touched.size ? bodies.map((b, i) => {
      if (b.team === -1) {
        return { ...b, x: motion[i * 5], y: motion[i * 5 + 1], vx: motion[i * 5 + 2], vy: motion[i * 5 + 3], omega: motion[i * 5 + 4],
          strikerTeam: incomingStrikerTeam, curveMult: preCurveMult, onFire: preOnFire, fireTicks: preFireTicks, pace: prePace };
      }
      const prevIron = Boolean(t.iron[i]), prevSup = t.sup[i];
      const copy = { ...b, x: motion[i * 5], y: motion[i * 5 + 1], vx: motion[i * 5 + 2], vy: motion[i * 5 + 3], omega: motion[i * 5 + 4],
        holding: b === held, daze: t.daze[i], ironGuard: prevIron, superActive: prevSup };
      if (prevIron !== Boolean(b.ironGuard) || prevSup !== (b.superActive || null)) P.syncEffectiveStats(copy);
      return copy;
    }) : null;
    const needCredit = (!skipSaves && touched.size > 0) || t.ironSaver >= 0;
    const incomingCredit = needCredit ? (t.incomingCredit || { ...play.credit }) : null;
    const ballIdx = std7 ? 6 : bodies.indexOf(ball);
    const ballBefore = before ? before[ballIdx] : null; let tickSaves = (!skipSaves && touched.size) ? saves(P, before, bodies, touched, incomingCredit) : EMPTY_SAVES;
    const ironIndex = t.ironSaver; t.ironSaver = -1;
    if (!skipSaves && ironIndex >= 0) {
      const existing = tickSaves.find(s => s.index === ironIndex);
      const saverTeam = bodies[ironIndex].team;
      const isOwn = incomingStrikerTeam >= 0 ? saverTeam === incomingStrikerTeam : responsibleTeam(before, incomingCredit) === saverTeam;
      if (existing) {
        existing.iron = true;
        existing.own = Boolean(isOwn);
      } else if (isOwn) {
        if (tickSaves === EMPTY_SAVES) tickSaves = [];
        tickSaves.push({ index: ironIndex, own: true, iron: true });
      }
    }
    if (t.stickyGrab >= 0) {
      play.credit = { [t.stickyGrab]: 1 };
    } else if (s1a) {
      t.attrSet.clear(); t.attrSet.add(s1a.checker);
      play.credit = credit(play.credit, ballBefore, ball, t.attrSet, before);
    } else if (touched.size) {
      play.credit = credit(play.credit, ballBefore, ball, touched, before);
    }
    if (ball) {
      if (t.stickyGrab >= 0) {
        const st = bodies[t.stickyGrab].team;
        if (st >= 0 && (st === 0 ? ball.vx > 60 : ball.vx < -60)) play.shot = { team: st, at: play.age };
      } else if (s1a) {
        if (s1a.team === 0 ? ball.vx > 60 : ball.vx < -60) play.shot = { team: s1a.team, at: play.age };
      } else if (touched.size) {
        for (const i of touched) {
          const b = before[i];
          if (b && b.team >= 0 && (b.team === 0 ? ball.vx > 60 : ball.vx < -60)) play.shot = { team: b.team, at: play.age };
        }
      } else if (t.magnetTeam >= 0 && (t.magnetTeam === 0 ? ball.vx > 60 : ball.vx < -60)) {
        play.shot = { team: t.magnetTeam, at: play.age };
      }
    }
    const speed = (tally && touched.size) ? Math.hypot(ball.vx, ball.vy) : 0;
    const incomingBig = play.big;
    const big = cannon || (touched.size ? bigShot(P, before, touched, ball) : false), struck = t.spinStruck;
    const snapped = t.snapped;
    const hasIron = tickSaves.length > 0 && tickSaves.some(s => s.iron);
    let stop = effects ? Math.max(hasIron ? HIT_STOP.iron : 0, hitStop(P, bodies, ball, big, struck, tickSaves.length > 0 && tickSaves.some(save => !save.own), incomingBig)) : 0;
    if (effects) {
      if (t.fireHit) stop = Math.max(stop, HIT_STOP.fire);
      if (snapped) stop = Math.max(stop, big ? HIT_STOP.long : HIT_STOP.snap);
      if (postRing) stop = Math.max(stop, HIT_STOP.post);
      if (goal !== null) stop = Math.max(stop, HIT_STOP.scoredGoal);
    }
    if (touched.size) play.big = big;
    if (tally && touched.size) {
      const speedBefore = ballBefore ? Math.hypot(ballBefore.vx, ballBefore.vy) : 0;
      for (const i of touched) {
        const b = before ? before[i] : null;
        let striker = true;
        if (b && ballBefore) {
          const dx = ballBefore.x - b.x, dy = ballBefore.y - b.y, d = Math.hypot(dx, dy) || 1;
          const drive = (b.vx * dx + b.vy * dy) / d;
          striker = drive > 10 || speed > speedBefore + 5;
        }
        if (striker && speed > tally.topSpeed[i]) tally.topSpeed[i] = speed;
      }
    }
    if (postSide >= 0 && play.big && !play.postCounted) {
      const shooter = play.lastTouch[postSide];
      if (shooter !== null) {
        if (tally) tally.shots[shooter]++;
        play.postCounted = true;
        fx.shot?.(shooter, 'Post', { x: t.postX, y: t.postY });
      }
    }
    if (tickSaves.length) {
      recordSaves(bodies, play, tally, tickSaves, incomingBig, (_save, shooter, _big, shotType) => {
        if (shotType) fx.shot?.(shooter, shotType);
      });
    }
    t.bodies = t.play = t.ball = t.fx = t.tally = null; spareTick = t;
    return { goal, saves: tickSaves, struck, snapped, stop, big };
  }
  const REBOUND_TICKS = 240;
  function callGoal(bodies, play, tally, goal, ace) {
    let own = responsibleTeam(bodies, play.credit) === 1 - goal;
    if (own && play.shot && play.shot.team === goal && play.age - play.shot.at <= SHOT_SURVIVE_TICKS) own = false;
    const scorer = own ? null : play.lastTouch[goal];
    const assist = own || scorer === null || play.assist[goal] === scorer ? null : play.assist[goal];
    const hatTrick = recordGoal(play, tally, scorer, assist);
    const shotX = play.shotX[goal], snipe = shotX !== null && (goal === 0 ? shotX < 500 : shotX > 500);
    const rebound = play.saved?.team === 1 - goal && play.age - play.saved.at <= REBOUND_TICKS;
    const banked = Boolean(play.banked);
    const fireball = Boolean(bodies[6]?.onFire);
    const oneTimer = Boolean(
      assist !== null && play.lastPass && play.lastPass.from === assist &&
      (play.lastPass.to === undefined || play.lastPass.to === scorer) &&
      (play.lastPass.touches ?? 1) === 1 &&
      play.age - play.lastPass.at <= 288 && play.lastPass.speed >= 180
    );
    const label = own ? 'OWN GOAL' : hatTrick ? 'HAT TRICK!' : fireball ? 'FIREBALL!' : oneTimer ? 'ONE-TIMER!' : banked ? 'BANK SHOT!' : snipe ? 'SNIPE!' : rebound ? 'REBOUND!' : ace ? 'ACE!' : 'GOAL';
    const badges = [!own && hatTrick && 'HAT TRICK!', !own && ace && 'ACE!'].filter(Boolean);
    return { scorer, assist, own, label, badges };
  }
  function noteScore(tally, scores) {
    for (let team = 0; team < 2; team++) tally.deficit[team] = Math.max(tally.deficit[team], scores[1 - team] - scores[team]);
  }
  function honours(tally, scores, winner) {
    return { comeback: tally.deficit[winner] >= 3, shutout: scores[1 - winner] === 0 };
  }
  const FOULS = Object.freeze({ crease: 80, stallTurns: 2, cornerExit: 45 });
  function newFouls() { return { crease: [false, false], corner: null, cornerTurns: 0, cards: [], faceoff: false }; }
  function inCrease(P, b, team) {
    if (b.carded || b.superActive === 'stalwart') return false;
    const dx = b.x - (team ? P.rink.right : P.rink.left);
    const dy = b.y - (P.rink.goalTop + P.rink.goalBottom) / 2;
    const d2 = dx * dx + dy * dy, r2 = FOULS.crease * FOULS.crease;
    if (d2 > r2 + 1e-4) return false;
    if (d2 < r2 - 1e-4) return true;
    return Math.hypot(dx, dy) < FOULS.crease;
  }
  function attackZoneLine(P, team) { return team ? 820 : 180; }
  function inAttackZone(P, b, team) {
    if (b.carded) return false;
    return team ? b.x > 820 : b.x < 180;
  }
  function camping(P, bodies, team) {
    let inC = 0, curAZ = 0, opp = 1 - team;
    for (let i = 0; i < 6; i++) {
      const b = bodies[i];
      if (b.team === team) { if (inCrease(P, b, team)) inC++; }
      else if (b.team === opp && inAttackZone(P, b, team)) curAZ++;
    }
    return inC > (curAZ > 1 ? curAZ : 1);
  }
  function cornerOf(P, x, y, margin = 0) {
    const k = P.rink, span = k.corner + margin;
    const side = x < k.left + span ? 0 : x > k.right - span ? 1 : -1;
    if (side < 0) return null;
    const end = y < k.top + span ? 0 : y > k.bottom - span ? 2 : -1;
    return end < 0 ? null : side + end;
  }
  function lapseFouls(P, bodies, fouls) {
    if (fouls.crease[0] && !camping(P, bodies, 0)) fouls.crease[0] = false;
    if (fouls.crease[1] && !camping(P, bodies, 1)) fouls.crease[1] = false;
    if (fouls.corner !== null) {
      const ball = bodies[6];
      if (cornerOf(P, ball.x, ball.y, FOULS.cornerExit) !== fouls.corner) { fouls.corner = null; fouls.cornerTurns = 0; }
    }
  }
  const FACEOFF_YS = [300, 240, 360, 180, 420, 120, 480];
  function callFouls(P, bodies, fouls) {
    const ball = bodies[6];
    let cardMask = 0;
    for (let team = 0; team < 2; team++) {
      const now = camping(P, bodies, team);
      if (now && fouls.crease[team]) {
        for (let i = 0; i < 6; i++) {
          const b = bodies[i];
          if (b.team === team && inCrease(P, b, team)) cardMask |= (1 << i);
        }
      }
      fouls.crease[team] = now && !fouls.crease[team];
    }
    const corner = cornerOf(P, ball.x, ball.y);
    fouls.cornerTurns = corner === null ? 0 : corner === fouls.corner ? fouls.cornerTurns + 1 : 1;
    fouls.corner = corner;
    fouls.faceoff = fouls.cornerTurns > FOULS.stallTurns;
    if (fouls.faceoff) {
      let insideMask = 0, c0 = 0, c1 = 0;
      for (let i = 0; i < 6; i++) {
        const b = bodies[i];
        if (!b.carded && cornerOf(P, b.x, b.y, b.radius) === corner) {
          insideMask |= (1 << i);
          if (b.team === 0) c0++; else c1++;
        }
      }
      if (c0 !== c1) {
        const targetTeam = c0 > c1 ? 0 : 1;
        for (let i = 0; i < 6; i++) {
          if ((insideMask & (1 << i)) && bodies[i].team === targetTeam) cardMask |= (1 << i);
        }
      }
      fouls.corner = null; fouls.cornerTurns = 0;
    }
    if (cardMask !== 0) {
      for (let i = 0; i < 6; i++) {
        if (!(cardMask & (1 << i))) continue;
        const b = bodies[i];
        P.endSuper(b, bodies);
        const sp = P.spawn(b.team, b.slot);
        b.x = sp.x; b.y = sp.y;
        b.vx = 0; b.vy = 0; b.omega = 0; b.launchSpin = 0;
        b.meter = 0; b.daze = 0; b.guarding = false; b.stunned = true; b.carded = true;
        if (b.superArm !== undefined) b.superArm = false;
      }
    }
    if (fouls.faceoff) {
      const holding = P.holder(bodies);
      if (holding) P.endSuper(holding, bodies);
      let chosenY = 300;
      for (let yi = 0; yi < FACEOFF_YS.length; yi++) {
        const y = FACEOFF_YS[yi];
        let clear = true;
        for (let i = 0; i < 6; i++) {
          const b = bodies[i];
          if (!b.carded && Math.hypot(b.x - 500, b.y - y) < b.radius + ball.radius) { clear = false; break; }
        }
        if (clear) { chosenY = y; break; }
      }
      ball.x = 500; ball.y = chosenY;
      ball.vx = 0; ball.vy = 0; ball.omega = 0;
      ball.stickOffset = null; ball.stuckTicks = 0;
      P.clearHeat(ball);
      P.clearStriker(ball);
    }
    if (cardMask === 0) {
      fouls.cards = [];
    } else {
      const cards = [];
      for (let i = 0; i < 6; i++) if (cardMask & (1 << i)) cards.push(i);
      fouls.cards = cards;
    }
  }
  function finishTurn(P, bodies, stats, scores, goal, mode, bonus = {}, fouls = newFouls(), tally = null) {
    const classic = rule(mode, 'classic');
    P.stop(bodies, (rule(mode, 'pulse') && goal === null) || Boolean(bonus.keepMotion));
    for (let i = 0; i < 6; i++) {
      const b = bodies[i];
      if (b.stunnedNext) {
        if (b.superActive) P.endSuper(b, bodies);
        b.stunned = true;
        b.stunnedNext = false;
      }
      b.carded = false;
    }
    if (goal === null) callFouls(P, bodies, fouls);
    else {
      fouls.crease[0] = false; fouls.crease[1] = false;
      fouls.corner = null; fouls.cornerTurns = 0;
      fouls.cards = []; fouls.faceoff = false;
    }
    recordCards(tally, fouls.cards);
    if (goal !== null) {
      scores[goal]++;
      const concededTeam = 1 - goal;
      if (!classic) {
        for (let i = 0; i < 6; i++) {
          const b = bodies[i];
          if (b.team === concededTeam) gainMeterSilent(P, bodies, stats, b, i, METER.conceded);
        }
        if (bonus.ace != null) gainMeterSilent(P, bodies, stats, bodies[bonus.ace], bonus.ace, METER.ace);
        if (bonus.assist != null) gainMeterSilent(P, bodies, stats, bodies[bonus.assist], bonus.assist, METER.assist);
      }
    }
    return goal !== null && scores[goal] >= 5 ? goal : null;
  }
  function cloneTally(t) {
    if (!t) return newTally();
    return {
      goals: [...t.goals], assists: [...t.assists], saves: [...t.saves], bigSaves: [...t.bigSaves],
      shots: [...t.shots], checks: [...t.checks], topSpeed: [...t.topSpeed], cards: [...t.cards], deficit: [...t.deficit]
    };
  }
  const TWO_PI = 2 * Math.PI;
  function fastNormalizePlans(moves) {
    const out = new Array(6);
    for (let i = 0; i < 6; i++) {
      const p = moves[i];
      out[i] = { angle: ((p.angle % TWO_PI) + TWO_PI) % TWO_PI, power: p.power, spin: p.spin, superArm: p.superArm, guard: p.guard };
    }
    return out;
  }
  function resolveTurn(P, state, moves, { effects = true, ticks: maxTicks = Infinity, decided = null, watch = null, preservePartial = false, fastSearch = false, fastTick = false } = {}) {
    if (!fastSearch && (state.version !== VERSION || MODE_MASK[state.mode] === undefined)) throw new Error('Unsupported match rules.');
    if (!Array.isArray(moves) || moves.length !== 6) throw new Error('Both teams must submit.');
    const plans = fastSearch ? fastNormalizePlans(moves) : [...validatePlans(moves.slice(0, 3)), ...validatePlans(moves.slice(3))];
    const bodies = new Array(state.bodies.length);
    for (let i = 0; i < state.bodies.length; i++) {
      const b = state.bodies[i];
      if (b.team === -1) {
        bodies[i] = { ...b, stickOffset: b.stickOffset ? { x: b.stickOffset.x, y: b.stickOffset.y } : null };
      } else if (fastSearch) {
        bodies[i] = { ...b };
      } else {
        const copy = { ...b, equippedSuper: b.equippedSuper ? { ...b.equippedSuper } : null };
        if (copy.personality) copy.personality = { ...copy.personality };
        bodies[i] = copy;
      }
    }
    const foulsCopy = state.fouls
      ? { crease: [state.fouls.crease[0], state.fouls.crease[1]], corner: state.fouls.corner, cornerTurns: state.fouls.cornerTurns, cards: state.fouls.cards ? [...state.fouls.cards] : [], faceoff: Boolean(state.fouls.faceoff) }
      : newFouls();
    const next = { ...state, bodies, stats: fastSearch ? (state.stats || []) : (state.stats ? state.stats.map(s => (s ? { ...s } : s)) : []), scores: [state.scores[0], state.scores[1]], fouls: foulsCopy };
    const classic = rule(state.mode, 'classic'), limit = Math.min(turnTicks(state.mode), maxTicks);
    for (let i = 0; i < 6; i++) {
      const b = bodies[i];
      if (plans[i].superArm && (classic || b.stunned || b.meter < 100 || !b.equippedSuper)) throw new Error('Super unavailable.');
      if (b.superArm !== undefined) b.superArm = false;
    }
    const initialBodies = effects ? structuredClone(bodies) : null;
    const useFastTick = fastSearch && fastTick;
    const play = useFastTick ? null : newPlay(state.play);
    P.startTurn(bodies, plans);
    const clock = state.clock || 0;
    let goal = null, ticks = 0, currentTick = 0, hitDecided = false;
    const saved = [], struck = [], stops = [];
    const tally = fastSearch ? null : cloneTally(state.tally);
    let hasFoul = next.fouls.crease[0] || next.fouls.crease[1] || next.fouls.corner !== null;
    if (useFastTick) {
      const onCollide = contact => {
        if (!contact.plow) contactMeterSilent(P, bodies, next.stats, contact.a, contact.b, contact.speed, clock + currentTick, classic, contact.passerSlot);
        if (watch?.collide) watch.collide(contact);
      };
      const onWall = watch?.wall || null;
      for (let tick = 1; tick <= limit; tick++) {
        currentTick = tick;
        goal = P.step(bodies, P.DT, onCollide, onWall, null, null);
        if (hasFoul) {
          lapseFouls(P, bodies, next.fouls);
          hasFoul = next.fouls.crease[0] || next.fouls.crease[1] || next.fouls.corner !== null;
        }
        ticks = tick;
        if (goal !== null || P.settled(bodies) || tick === limit) break;
        if (decided && decided(bodies)) { hitDecided = true; break; }
      }
    } else {
      const skipSaves = fastSearch && classic;
      const tickFx = {
        collide: contact => {
          if (!contact.plow) contactMeterSilent(P, bodies, next.stats, contact.a, contact.b, contact.speed, clock + currentTick, classic, contact.passerSlot);
          watch?.collide?.(contact);
        },
        wall: watch?.wall
      };
      for (let tick = 1; tick <= limit; tick++) {
        currentTick = tick;
        const result = playTick(P, bodies, play, tickFx, tally, effects, skipSaves);
        goal = result.goal;
        if (hasFoul) {
          lapseFouls(P, bodies, next.fouls);
          hasFoul = next.fouls.crease[0] || next.fouls.crease[1] || next.fouls.corner !== null;
        }
        for (let si = 0; si < result.saves.length; si++) {
          const save = result.saves[si];
          saved.push({ tick, ...save });
          if (!save.own && !classic) gainMeterSilent(P, bodies, next.stats, bodies[save.index], save.index, METER.save);
        }
        if (result.struck) struck.push(tick);
        if (result.stop) stops.push({ tick, ms: result.stop });
        ticks = tick;
        const settled = P.settled(bodies);
        if (goal !== null || settled || tick === limit) break;
        if (decided?.(bodies)) { hitDecided = true; break; }
      }
    }
    const ace = goal !== null && !state.roundTurns;
    const call = (goal === null || useFastTick)
      ? { scorer: null, assist: null, own: false, label: null }
      : callGoal(bodies, play, tally, goal, ace);
    const partial = preservePartial && !hitDecided && goal === null && ticks < turnTicks(state.mode) && !P.settled(bodies);
    if (!partial) {
      next.winner = finishTurn(P, bodies, next.stats, next.scores, goal, state.mode, { ace: ace && !call.own ? call.scorer : null, assist: call.assist }, next.fouls, tally);
      if (goal !== null && tally) noteScore(tally, next.scores);
      next.roundTurns = goal === null ? (state.roundTurns || 0) + 1 : 0;
      next.turn++;
      next.phase = next.winner !== null ? 'over' : goal !== null ? 'goal' : 'plan';
    }
    next.clock = clock + ticks;
    next.play = useFastTick ? null : (goal === null && !next.fouls.faceoff ? play : newPlay());
    next.tally = tally;
    return { state: next, replay: { version: VERSION, turn: state.turn, plans, ticks, goal, scorer: call.scorer, assist: call.assist,
      label: call.label, saves: saved, struck, stops, initialBodies } };
  }
  const api = { VERSION, RULES, MODES, GOAL_REPLAY_DELAY, GOAL_REPLAY_HOLD, SHOT_SURVIVE_TICKS, replaySpeed, postGoalSpeed, replayMilliseconds, validatePlans, rule, modeName, planningMilliseconds, turnTicks, applyStats, METER, SAVE, FOULS, newFouls, inCrease, attackZoneLine, inAttackZone, camping, cornerOf, lapseFouls, BIG_SHOT, HIT_STOP, SCREEN_SHAKE, superStat, gainMeter, contactMeter, toucher, saves, credit, responsibleTeam, newPlay, newTally, recordSaves, recordGoal, recordCards, playTick, callGoal, noteScore, honours, finishTurn, resolveTurn };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallMatch = api;
})(globalThis);
