/* Shared match rules; callers supply authenticated, server-derived roster data. */
(function(root) {
  'use strict';
  const VERSION = 3;
  // Classic, Pulse and Blitz are independent rules, joined in this order; 'standard' has none.
  const RULES = ['classic', 'pulse', 'blitz'];
  const MODES = Array.from({ length: 8 }, (_, n) => RULES.filter((r, i) => n >> i & 1).join('-') || 'standard');
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
  function validatePlans(input) {
    if (!Array.isArray(input) || input.length !== 3) throw new Error('Submit exactly three moves.');
    return input.map(p => {
      if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !['angle', 'power', 'spin', 'superArm', 'guard'].includes(k)) ||
          !Number.isFinite(p.angle) || !Number.isFinite(p.power) || !Number.isFinite(p.spin) ||
          p.power < 0 || p.power > 1 || p.spin < -1 || p.spin > 1 || typeof p.superArm !== 'boolean' || typeof p.guard !== 'boolean') throw new Error('Invalid move.');
      // A guarding ubu brakes instead of launching, but preserves its aimed arrow.
      return { angle: ((p.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), power: p.power, spin: p.spin, superArm: p.superArm, guard: p.guard };
    });
  }
  function rule(mode, name) {
    if (!MODES.includes(mode)) throw new Error('Invalid mode.');
    return mode.split('-').includes(name);
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
  // Meter values: meter comes from contact, conceding, aces (a goal on a
  // round's first turn, to the scorer), saves and assists.
  // Contact counts only for real impacts against the ball or an opponent, at most once per
  // cooldown per ubu, so pinging around the ball or an enemy cannot farm it.
  // Every gain is scaled by `rate` (slightly below the listed amounts).
  const METER = Object.freeze({ ball: 8, check: 4, conceded: 6, ace: 10, save: 6, assist: 4, teammate: .15, rate: .85, minSpeed: 60, cooldownTicks: 360 });
  // Efficiency, Synergy and Chemistry swing harder than other stats: their
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
  // Save tuning: the ball must be within `range` px of the goal mouth's
  // centre and, without the saver, due in within `ticks`.
  const SAVE = Object.freeze({ range: 300, ticks: 240 });
  // The save, if any, among the ubus (by index) that touched the ball in one tick. Only a lone touch
  // counts. From the field as it stood before that tick, the ball was close to and heading into the
  // ubu's own goal, and without it would soon have gone in touching nothing but the posts and net.
  // The touch must also have kept it out: from the field after the tick (`after`), the ball must not
  // go on into that goal, even off the boards, before another ubu touches it.
  // `own` marks a save from a ball the saver's own team was most responsible for (see `credit`).
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
    const anyMagnet = before.some((b, idx) => idx !== i && b.team >= 0 && b.superActive === 'magnet');
    if (!anyMagnet && P.ballRun([ball], { ticks: SAVE.ticks }).goal !== 1 - team) return [];
    if (P.wouldScore(before, before[i], SAVE.ticks) !== 1 - team) return [];
    if (P.ballRun(after, { boards: true, ticks: 2 * SAVE.ticks }).goal === 1 - team) return [];
    return [{ index: i, own: responsibleTeam(before, credit) !== 1 - team }];
  }
  // Responsibility for the ball's velocity, as each ubu's share (by index). After a tick in which ubus
  // touched the ball, the part of its new velocity carried over from its old one stays with whoever
  // gave it; the rest is split among that tick's touchers. A glancing deflection leaves the shot with
  // the shooter, while a ubu that stops or redirects the ball takes it over.
  function credit(shares, before, ball, touched, bodiesBefore = null) {
    if (!touched.size) return shares;
    const speed2 = ball.vx * ball.vx + ball.vy * ball.vy;
    let kept = speed2 ? Math.min(1, Math.max(0, (before.vx * ball.vx + before.vy * ball.vy) / speed2)) : 0;
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
      credit: { ...from.credit }, banked: Boolean(from.banked),
      saved: from.saved ? { ...from.saved } : null, big: Boolean(from.big),
      lastPass: from.lastPass ? { ...from.lastPass } : null };
  }
  // Per-ubu match totals (by index) for the summary (yellow cards included), and each team's deepest deficit.
  function newTally() {
    const six = () => [0, 0, 0, 0, 0, 0];
    return { goals: six(), assists: six(), saves: six(), bigSaves: six(), shots: six(), checks: six(), topSpeed: six(), cards: six(), deficit: [0, 0] };
  }
  // A big shot is a lone touch by an ubu driving into the ball at `share` or more of its own
  // full-launch speed; the ball's own speed does not count, so a fast ball off a still ubu is not one.
  const BIG_SHOT = Object.freeze({ share: .8 });
  // Hit-stop in ms (tuning): `hit` for a real save, a spin strike or a big shot; `long` for a save of
  // a big shot, a spin strike that is also a big shot, or a big shot that will travel a rink height
  // untouched; `goal` for a big shot whose own path (no bounces, no ubus) goes into a goal; `iron` at
  // least, for an Iron Save; `scoredGoal` for a scored goal.
  const HIT_STOP = Object.freeze({ hit: 60, long: 100, goal: 150, iron: 150, scoredGoal: 200 });
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
  // Per-tick scratch and the tick in progress, which the step callbacks below read, so neither is
  // rebuilt every tick. A nested tick would take fresh scratch and restore the outer tick after.
  let spareTick = null, activeTick = null;
  function tickTouch(a, b, speed, impulse, plow = false, iron = false, checker = null) {
    const t = activeTick, player = toucher(a, b, speed);
    if (player && !plow) {
      // A touch passed from a teammate makes that teammate the assist; an opponent's touch clears it unless a light graze.
      const { bodies, play } = t, i = bodies.indexOf(player), team = player.team, last = play.last;
      if (last !== i) {
        if (last !== null && bodies[last].team === team) {
          play.assist[team] = last;
          play.lastPass = { from: last, at: play.age, speed };
          t.fx.pass?.(last, i, t.ball);
        } else if (last !== null && bodies[last].team !== team) {
          if (impulse >= 35) {
            play.assist[team] = null;
            play.lastPass = null;
          }
        }
      }
      play.last = i; play.lastTouch[team] = i; play.shotX[team] = t.ball.x;
      if (last === null || bodies[last].team === team || impulse >= 35) play.banked = false;
      t.touched.add(i);
      if (iron) t.ironSaver = i;
    }
    if (checker !== null && t.tally) {
      const ci = t.bodies.indexOf(checker);
      if (ci >= 0) t.tally.checks[ci]++;
    }
    t.fx.collide?.(a, b, speed, impulse, plow, iron, checker);
  }
  function tickWall(body, velocity, type, nx, ny) {
    const t = activeTick;
    if (body === t.ball && type === 'wall') {
      t.play.banked = true;

    }
    t.fx.wall?.(body, velocity, type, nx, ny);
  }
  // Steps the field one tick and keeps the play (and the tally, if given) current. Returns the goal
  // (as P.step reports it), the tick's saves, whether a close-range spin strike landed and the
  // hit-stop it earns (ms, 0 for none). `fx` receives the step callbacks. Without `effects` (CPU
  // search), the presentation-only hit-stop look-aheads are skipped; rules are unchanged.
  function playTick(P, bodies, play, fx = {}, tally = null, effects = true, skipSaves = false) {
    // Each tick records only motion and who held the ball; the pre-tick field is rebuilt from them when
    // the ball was touched, which is all the save and big-shot checks need. Copying every body each tick
    // was the single largest cost of CPU search. Other fields in the rebuilt field are as after the
    // tick: the checks must not depend on them (a spent Cannonball is known by its impact instead).
    const t = spareTick || { motion: new Float64Array(35), touched: new Set() }, outer = activeTick;
    spareTick = null; activeTick = t;
    if (t.motion.length < bodies.length * 5) t.motion = new Float64Array(bodies.length * 5);
    const { motion, touched } = t, ball = bodies[6]?.team === -1 ? bodies[6] : bodies.find(b => b.team === -1);
    touched.clear(); t.bodies = bodies; t.play = play; t.ball = ball; t.fx = fx; t.tally = tally;
    t.cannon = false; t.incomingCredit = null;
    let held = null;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.holding && !held) held = b;
      motion[i * 5] = b.x; motion[i * 5 + 1] = b.y; motion[i * 5 + 2] = b.vx; motion[i * 5 + 3] = b.vy; motion[i * 5 + 4] = b.omega;
    }
    const incomingStrikerTeam = ball?.strikerTeam ?? -1;
    play.age++;
    t.onShockwave ??= (source, radius, type = null) => {
      activeTick?.fx?.shockwave?.(source, radius, type);
    };
    // A Cannonball spends itself in the hit, so the hit is known by its impact, not by the field after.
    t.onSuper ??= (key, action, body, target) => {
      const at = activeTick;
      if (!at) return;
      if (key === 'cannonball' && action === 'impact') at.cannon = true;
      if (key === 'magnet' && action === 'pull' && body && at.ball) {
        at.incomingCredit ??= { ...at.play.credit };
        const bi = at.bodies.indexOf(body);
        if (bi >= 0) {
          const strikerTeam = at.ball.strikerTeam ?? -1;
          if (body.team === strikerTeam || strikerTeam < 0) {
            at.play.last = bi; at.play.lastTouch[body.team] = bi;
            at.play.credit = { [bi]: 1 }; at.play.shotX[body.team] = at.ball.x;
          } else {
            // Defending magnet: blend credit based on velocity projection with defense protection
            const ballIdx = at.bodies.indexOf(at.ball);
            const bvx = at.motion[ballIdx * 5 + 2], bvy = at.motion[ballIdx * 5 + 3];
            const beforeSpeed = Math.hypot(bvx, bvy), curSpeed = Math.hypot(at.ball.vx, at.ball.vy);
            let kept = beforeSpeed && curSpeed ? Math.max(0, (bvx * at.ball.vx + bvy * at.ball.vy) / (beforeSpeed * beforeSpeed)) : 0;
            kept = Math.max(kept, 0.75);
            const next = {};
            for (const [idx, share] of Object.entries(at.play.credit)) if (share * kept >= 0.01) next[idx] = share * kept;
            next[bi] = (next[bi] || 0) + (1 - kept);
            at.play.credit = next;
            if (1 - kept > 0.5) { at.play.last = bi; at.play.lastTouch[body.team] = bi; at.play.shotX[body.team] = at.ball.x; }
          }
        }
      }
      at.fx?.super?.(key, action, body, target);
    };
    const goal = P.step(bodies, P.DT, tickTouch, tickWall, t.onShockwave, t.onSuper);
    const cannon = t.cannon;
    activeTick = outer;
    const before = touched.size ? bodies.map((b, i) => ({ ...b, x: motion[i * 5], y: motion[i * 5 + 1], vx: motion[i * 5 + 2],
      vy: motion[i * 5 + 3], omega: motion[i * 5 + 4], holding: b === held,
      strikerTeam: b.team === -1 ? incomingStrikerTeam : b.strikerTeam })) : null;
    const needCredit = (!skipSaves && touched.size > 0) || t.ironSaver != null;
    const incomingCredit = needCredit ? (t.incomingCredit || { ...play.credit }) : null;
    const ballIdx = ball === bodies[6] ? 6 : bodies.indexOf(ball);
    const ballBefore = before?.[ballIdx], tickSaves = (!skipSaves && touched.size) ? saves(P, before, bodies, touched, incomingCredit) : [];
    const ironIndex = t.ironSaver ?? null; t.ironSaver = null;
    if (!skipSaves && ironIndex !== null) {
      const existing = tickSaves.find(s => s.index === ironIndex);
      const saverTeam = bodies[ironIndex].team;
      const isOwn = incomingStrikerTeam >= 0 ? saverTeam === incomingStrikerTeam : responsibleTeam(before, incomingCredit) === saverTeam;
      if (existing) {
        existing.iron = true;
        existing.own = Boolean(isOwn);
      } else {
        tickSaves.push({ index: ironIndex, own: Boolean(isOwn), iron: true });
      }
    }
    play.credit = credit(play.credit, ballBefore, ball, touched, before);
    for (const save of tickSaves) if (!save.own) play.saved = { at: play.age, team: bodies[save.index].team };
    // A Cannonball hit always counts as a big shot.
    const speed = (tally && touched.size) ? Math.hypot(ball.vx, ball.vy) : 0;
    const big = cannon || (touched.size ? bigShot(P, before, touched, ball) : false), struck = Boolean(ball.spinStruck);
    const hasIron = tickSaves.some(s => s.iron);
    let stop = effects ? Math.max(hasIron ? HIT_STOP.iron : 0, hitStop(P, bodies, ball, big, struck, tickSaves.some(save => !save.own), play.big)) : 0;
    if (effects && goal !== null) stop = Math.max(stop, HIT_STOP.scoredGoal);
    if (touched.size) play.big = big;
    if (tally) {
      const speedBefore = ballBefore ? Math.hypot(ballBefore.vx, ballBefore.vy) : 0;
      for (const i of touched) {
        const b = before ? before[i] : null;
        let striker = true;
        if (b && ballBefore) {
          const dx = ballBefore.x - b.x, dy = ballBefore.y - b.y, d = Math.hypot(dx, dy) || 1;
          const drive = (b.vx * dx + b.vy * dy) / d;
          striker = drive > 10 || speed > speedBefore + 5;
        }
        if (striker) tally.topSpeed[i] = Math.max(tally.topSpeed[i], speed);
      }
      for (const save of tickSaves) {
        if (!save.own) {
          tally.saves[save.index]++;
          if (save.iron || play.big) tally.bigSaves[save.index]++;
          const shooter = play.lastTouch[1 - bodies[save.index].team];
          if (shooter !== null) tally.shots[shooter]++;
        }
      }
    }
    if (struck) ball.spinStruck = false;
    t.bodies = t.play = t.ball = t.fx = t.tally = null; spareTick = t;
    return { goal, saves: tickSaves, struck, stop, big };
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
    if (!own && scorer !== null && tally) {
      hatTrick = ++tally.goals[scorer] === 3;
      tally.shots[scorer]++;
    }
    if (assist !== null && tally) tally.assists[assist]++;
    const shotX = play.shotX[goal], snipe = shotX !== null && (goal === 0 ? shotX < 500 : shotX > 500);
    const rebound = play.saved?.team === 1 - goal && play.age - play.saved.at <= REBOUND_TICKS;
    const banked = Boolean(play.banked);
    const fireball = Boolean(bodies[6]?.onFire);
    const oneTimer = Boolean(assist !== null && play.lastPass && play.lastPass.from === assist && play.age - play.lastPass.at <= 288 && play.lastPass.speed >= 180);
    const label = own ? 'OWN GOAL' : hatTrick ? 'HAT TRICK!' : fireball ? 'FIREBALL!' : oneTimer ? 'ONE-TIMER!' : banked ? 'BANK SHOT!' : snipe ? 'SNIPE!' : rebound ? 'REBOUND!' : ace ? 'ACE!' : 'GOAL';
    const badges = [hatTrick && 'HAT TRICK!', ace && 'ACE!'].filter(Boolean);
    return { scorer, assist, own, label, badges };
  }
  // After each goal: each team's deepest deficit so far, for the comeback call.
  function noteScore(tally, scores) {
    for (const team of [0, 1]) tally.deficit[team] = Math.max(tally.deficit[team], scores[1 - team] - scores[team]);
  }
  // The full-time honours for a winner: a comeback from 3 or more down, or a shutout.
  function honours(tally, scores, winner) {
    return { comeback: tally.deficit[winner] >= 3, shutout: scores[1 - winner] === 0 };
  }
  // Fouls, called at the end of every turn without a goal.
  // Goal camping: each end has an attack zone, from the end boards to a line across the rink at the
  // rear kickoff spot. A team is camping when more of its ubus have their centres in its own crease
  // than the larger of one and the opposing ubus with their centres in that zone. Camping warns the
  // team; if the next turn also ends with it camping, its ubus in the crease are carded. Corner
  // stalling: when the ball ends `stallTurns` turns in a row in one corner the field is warned; if the
  // next turn ends with it still there, the team with more ubus in that corner has them carded (a tie
  // cards nobody) and the ball is reset to centre ice. A warning lapses the moment it stops applying
  // during play, and a corner count ends once the ball leaves its corner beyond the `cornerExit` hysteresis
  // margin (see `lapseFouls`). A carded ubu loses its meter, returns to its spawn and sits out the next
  // turn, touching nothing. The crease radius around the goal mouth's centre is tuning.
  const FOULS = Object.freeze({ crease: 80, stallTurns: 2, cornerExit: 45 });
  function newFouls() { return { crease: [false, false], corner: null, cornerTurns: 0, cards: [], faceoff: false }; }
  function inCrease(P, b, team) {
    if (b.superActive === 'stalwart') return false;
    return Math.hypot(b.x - (team ? P.rink.right : P.rink.left), b.y - (P.rink.goalTop + P.rink.goalBottom) / 2) < FOULS.crease;
  }
  // The line closing the attack zone in front of a team's goal runs across the rink at its rear kickoff spot.
  function attackZoneLine(P, team) { return P.spawn(team, 0).x; }
  function inAttackZone(P, b, team) { return team ? b.x > attackZoneLine(P, team) : b.x < attackZoneLine(P, team); }
  function camping(P, bodies, team) {
    let inC = 0, curAZ = 0, opp = 1 - team;
    for (let i = 0; i < 6; i++) {
      const b = bodies[i];
      if (b.team === team) { if (inCrease(P, b, team)) inC++; }
      else if (b.team === opp && inAttackZone(P, b, team)) curAZ++;
    }
    return inC > (curAZ > 1 ? curAZ : 1);
  }
  // The corner (0 top left, 1 top right, 2 bottom left, 3 bottom right) whose square, grown by
  // `margin`, holds the point, or null.
  function cornerOf(P, x, y, margin = 0) {
    const k = P.rink, span = k.corner + margin;
    const side = x < k.left + span ? 0 : x > k.right - span ? 1 : null, end = y < k.top + span ? 0 : y > k.bottom - span ? 2 : null;
    return side === null || end === null ? null : side + end;
  }
  // Every tick of play: a crease warning lapses once its team stops camping, and the corner count
  // (with any warning) ends once the ball leaves its corner, until the turn's end calls them again.
  function lapseFouls(P, bodies, fouls) {
    for (const team of [0, 1]) if (fouls.crease[team] && !camping(P, bodies, team)) fouls.crease[team] = false;
    const ball = bodies[6];
    if (fouls.corner !== null && cornerOf(P, ball.x, ball.y, FOULS.cornerExit) !== fouls.corner) { fouls.corner = null; fouls.cornerTurns = 0; }
  }
  function callFouls(P, bodies, fouls) {
    const ubus = bodies.slice(0, 6), ball = bodies[6], carded = new Set();
    for (const team of [0, 1]) {
      const now = camping(P, bodies, team);
      if (now && fouls.crease[team]) ubus.filter(b => b.team === team && inCrease(P, b, team)).forEach(b => carded.add(b));
      fouls.crease[team] = now && !fouls.crease[team];
    }
    const corner = cornerOf(P, ball.x, ball.y);
    fouls.cornerTurns = corner === null ? 0 : corner === fouls.corner ? fouls.cornerTurns + 1 : 1;
    fouls.corner = corner;
    fouls.faceoff = fouls.cornerTurns > FOULS.stallTurns;
    if (fouls.faceoff) {
      const inside = ubus.filter(b => cornerOf(P, b.x, b.y, b.radius) === corner);
      const count = [0, 1].map(team => inside.filter(b => b.team === team).length);
      if (count[0] !== count[1]) inside.filter(b => b.team === (count[0] > count[1] ? 0 : 1)).forEach(b => carded.add(b));
      fouls.corner = null; fouls.cornerTurns = 0;
    }
    for (const b of carded) {
      P.endSuper(b, bodies);
      Object.assign(b, P.spawn(b.team, b.slot), { vx: 0, vy: 0, omega: 0, meter: 0, daze: 0, guarding: false, superArm: false, stunned: true, carded: true });
    }
    if (fouls.faceoff) {
      // Centre ice, or the nearest clear spot along the centre line.
      const clear = y => ubus.every(b => b.carded || Math.hypot(b.x - 500, b.y - y) >= b.radius + ball.radius);
      const y = [300, 240, 360, 180, 420, 120, 480].find(clear) ?? 300;
      Object.assign(ball, { x: 500, y, vx: 0, vy: 0, omega: 0, stickOffset: null,
        fireTicks: 0, onFire: false, pace: 0, strikerPower: 1, strikerTeam: -1 });
      const holding = P.holder(bodies);
      if (holding) holding.holding = false;
    }
    fouls.cards = ubus.flatMap((b, i) => carded.has(b) ? [i] : []);
  }
  // `bonus` names who earns goal bonuses (by index): `ace` for a goal (not an own goal) on the round's
  // first turn, and `assist`. `fouls` (see `callFouls`) is updated in place, and its cards are counted
  // in `tally` when given.
  function finishTurn(P, bodies, stats, scores, goal, mode, bonus = {}, fouls = newFouls(), tally = null) {
    const classic = rule(mode, 'classic');
    // Turn effects end every turn; in Pulse or when keeping motion, momentum carries forward.
    P.stop(bodies, (rule(mode, 'pulse') && goal === null) || Boolean(bonus.keepMotion));
    for (const b of bodies.slice(0, 6)) {
      if (b.stunnedNext) {
        if (b.superActive) P.endSuper(b, bodies);
        b.stunned = true;
        delete b.stunnedNext;
      }
      // A card lasts the turn after it is given.
      b.carded = false;
    }
    if (goal === null) callFouls(P, bodies, fouls);
    else Object.assign(fouls, newFouls());
    if (tally) for (const i of fouls.cards) tally.cards[i]++;
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
  // board hits (step callbacks). `preservePartial` leaves unfinished search states unfinalized.
  function cloneTally(t) {
    if (!t) return newTally();
    return {
      goals: [...t.goals], assists: [...t.assists], saves: [...t.saves], bigSaves: [...t.bigSaves],
      shots: [...t.shots], checks: [...t.checks], topSpeed: [...t.topSpeed], cards: [...t.cards], deficit: [...t.deficit]
    };
  }
  function resolveTurn(P, state, moves, { effects = true, ticks: maxTicks = Infinity, decided = null, watch = null, preservePartial = false, fastSearch = false } = {}) {
    if (state.version !== VERSION || !MODES.includes(state.mode)) throw new Error('Unsupported match rules.');
    if (!Array.isArray(moves) || moves.length !== 6) throw new Error('Both teams must submit.');
    const plans = [...validatePlans(moves.slice(0, 3)), ...validatePlans(moves.slice(3))];
    const bodies = state.bodies.map(b => ({
      ...b,
      stickOffset: b.stickOffset ? { x: b.stickOffset.x, y: b.stickOffset.y } : b.stickOffset,
      equippedSuper: b.equippedSuper ? { ...b.equippedSuper } : b.equippedSuper,
      personality: b.personality ? { ...b.personality } : b.personality
    }));
    const foulsCopy = state.fouls
      ? { crease: [...state.fouls.crease], corner: state.fouls.corner, cornerTurns: state.fouls.cornerTurns, cards: [...(state.fouls.cards || [])], faceoff: Boolean(state.fouls.faceoff) }
      : newFouls();
    const next = { ...state, bodies, stats: state.stats ? state.stats.map(s => (s ? { ...s } : s)) : [], scores: [...state.scores], fouls: foulsCopy };
    const classic = rule(state.mode, 'classic'), limit = Math.min(turnTicks(state.mode), maxTicks);
    for (let i = 0; i < 6; i++) {
      const b = bodies[i];
      if (plans[i].superArm && (classic || b.stunned || b.meter < 100 || !b.equippedSuper)) throw new Error('Super unavailable.');
      b.superArm = false;
    }
    const initialBodies = effects ? structuredClone(bodies) : null;
    // The play persists until a goal, so a Pulse goal credits a touch from an earlier turn.
    const play = newPlay(state);
    P.startTurn(bodies, plans);
    // The match clock counts simulated ticks across turns for meter cooldowns.
    const clock = state.clock || 0;
    let goal = null, ticks = 0, currentTick = 0;
    const saved = [], struck = [], stops = [];
    const tally = fastSearch ? null : cloneTally(state.tally);
    const skipSaves = fastSearch && classic;
    const tickFx = {
      collide: (a, b, speed, impulse, plow, iron) => {
        if (!plow) contactMeter(P, bodies, next.stats, a, b, speed, clock + currentTick, classic);
        watch?.collide?.(a, b, speed, impulse, plow, iron);
      },
      wall: watch?.wall
    };
    for (let tick = 1; tick <= limit; tick++) {
      currentTick = tick;
      const result = playTick(P, bodies, play, tickFx, tally, effects, skipSaves);
      goal = result.goal;
      lapseFouls(P, bodies, next.fouls);
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
    // A search cutoff is not a real turn end: keep live velocity and supers, and do not call fouls.
    const partial = preservePartial && goal === null && ticks < turnTicks(state.mode) && !P.settled(bodies);
    if (!partial) {
      next.winner = finishTurn(P, bodies, next.stats, next.scores, goal, state.mode, { ace: ace && !call.own ? call.scorer : null, assist: call.assist }, next.fouls, tally);
      if (goal !== null && tally) noteScore(tally, next.scores);
      next.roundTurns = goal === null ? (state.roundTurns || 0) + 1 : 0;
      next.turn++;
      next.phase = next.winner !== null ? 'over' : goal !== null ? 'goal' : 'plan';
    }
    next.clock = clock + ticks;
    // A goal or a corner reset starts a fresh play.
    Object.assign(next, goal === null && !next.fouls.faceoff ? play : newPlay(), { tally });
    return { state: next, replay: { version: VERSION, turn: state.turn, plans, ticks, goal, scorer: call.scorer, assist: call.assist,
      label: call.label, saves: saved, struck, stops, initialBodies } };
  }
  const api = { VERSION, RULES, MODES, GOAL_REPLAY_DELAY, GOAL_REPLAY_HOLD, replaySpeed, postGoalSpeed, replayMilliseconds, validatePlans, rule, modeName, planningMilliseconds, turnTicks, applyStats, METER, SAVE, FOULS, newFouls, inCrease, attackZoneLine, inAttackZone, camping, cornerOf, lapseFouls, BIG_SHOT, HIT_STOP, SCREEN_SHAKE, gainMeter, contactMeter, toucher, saves, credit, responsibleTeam, newPlay, newTally, playTick, callGoal, noteScore, honours, finishTurn, resolveTurn };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ububallMatch = api;
})(globalThis);
