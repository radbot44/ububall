/* Match replays: each turn's starting field and moves, re-simulated to play back. See docs/ububall-file.md. */
(function(root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const P = node ? require('./ububall-physics.js') : root.ububallPhysics;
  const M = node ? require('./ububall-match.js') : root.ububallMatch;
  const U = node ? require('./ubu.js') : root.ubu;
  const FORMAT = 6, MAX_BYTES = 8 << 20, MAX_TEXT = 64 << 20, MAX_TURNS = 5000;
  // Automatically saved matches kept on this device; the oldest unpinned go first.
  const KEEP = 25, MAX_TITLE = 80;
  // Body fields a snapshot keeps, in file order: everything a turn's simulation reads or writes.
  const NUMBERS = ['x', 'y', 'vx', 'vy', 'omega', 'rotation', 'radius', 'mass', 'friction', 'grip', 'maxSpin', 'team', 'slot', 'curveFactor',
    'sizeMult', 'baseMass', 'baseRadius', 'baseFriction', 'baseReach', 'baseStrength', 'baseStability', 'baseBounciness', 'impulse', 'curveMult', 'bounciness', 'power', 'reach', 'strength', 'stability', 'synergyMult', 'chemistryMult',
    'meter', 'meterTick', 'daze', 'spinStrike', 'launchSpin', 'superTicks', 'superHoldTicks', 'superBonusTicks', 'superBonusRefund', 'stuckTicks', 'fireTicks', 'ironCooldownTicks', 'pace', 'strikerPower', 'strikerSynergy', 'strikerTeam', 'strikerSlot'];
  const POSITIVE = new Set(['radius', 'mass', 'maxSpin', 'sizeMult', 'baseMass', 'baseRadius', 'baseReach', 'baseStrength', 'baseStability', 'baseBounciness', 'impulse', 'curveMult', 'bounciness', 'power', 'reach', 'strength', 'stability', 'synergyMult', 'chemistryMult', 'strikerPower', 'strikerSynergy']);
  const NONNEGATIVE = new Set(['friction', 'baseFriction', 'grip', 'curveFactor', 'meter', 'daze', 'spinStrike', 'superTicks', 'superHoldTicks', 'superBonusTicks', 'superBonusRefund', 'stuckTicks', 'fireTicks', 'ironCooldownTicks', 'pace']);
  const FLAGS = ['superArm', 'guarding', 'ironGuard', 'usedSuperThisTurn', 'superHit', 'superRefunded', 'openingShot', 'shockwaveFired', 'carded', 'stunned', 'stunnedNext', 'onFire', 'holding'];
  const BODY = [...NUMBERS, ...FLAGS, 'superActive', 'equippedSuper', 'stickOffset'];
  const REQUIRED = ['x', 'y', 'vx', 'vy', 'omega', 'radius', 'mass', 'team'];
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  // A plain copy of the field: the equipped super becomes its id.
  function snapshot(bodies) {
    return bodies.map(b => {
      const out = {};
      for (const key of BODY) {
        const value = b[key];
        if (value === undefined) continue;
        if (key === 'equippedSuper') out[key] = value ? value.id : null;
        else if (key === 'stickOffset') out[key] = value && { x: value.x, y: value.y };
        else out[key] = value;
      }
      return out;
    });
  }
  function restore(snap) {
    return snap.map(b => {
      const out = { ...b };
      if (b.equippedSuper != null) {
        out.equippedSuper = { ...P.SUPERS[b.equippedSuper], bonusTicks: b.superBonusTicks || 0, bonusRefund: b.superBonusRefund || 0 };
      }
      if (b.stickOffset) out.stickOffset = { ...b.stickOffset };
      P.syncEffectiveStats(out);
      return out;
    });
  }
  // Moves exactly as the turn started with them (angles are not normalised: that would change the launch).
  const plan = p => ({ angle: p.angle, power: p.power, spin: p.spin || 0, superArm: Boolean(p.superArm), guard: Boolean(p.guard) });

  // A recording in progress. `seat` is the team shown on the left; `names` and `ubus` (DNA code and
  // equipped super id) are in rink order, the left team first when seat is 0.
  function create({ mode, seat = 0, names, ubus }) {
    return { mode, seat, title: null, clip: false, anonymous: false, names: [...names], ubus: ubus.map(u => ({ dna: u.dna, super: u.super })),
      recorded: Date.now(), final: null, turns: [] };
  }
  // A clip of turns `from` to `to` (inclusive): a replay of its own, starting from the first one's field.
  function clip(replay, from, to, title = null) {
    return { ...replay, title, clip: true, final: null, turns: replay.turns.slice(from, to + 1) };
  }
  // The round around turn `k`: every turn from the kickoff before it (the replay's start, or the
  // turn after a goal) through the turn that scored, or the replay's end.
  function roundRange(replay, k) {
    const turns = replay.turns;
    let from = k, to = k;
    while (from > 0 && !turns[from - 1].goal) from--;
    while (to + 1 < turns.length && !turns[to].goal) to++;
    return [from, to];
  }
  // A copy without its players' names: the teams become Saffron (shown on the left) and Amethyst, and
  // each ubu's 64-bit name seed is zeroed, so its name is gone while its looks, voice and stats stay.
  // Play is unchanged: turns carry their own fields.
  const ANONYMOUS = ['Saffron', 'Amethyst'];
  function anonymize(replay, title = null) {
    const unnamed = dna => {
      const bytes = Uint8Array.from(atob(dna.replace(/-/g, '+').replace(/_/g, '/') + '='), c => c.charCodeAt(0)).fill(0, 0, 8);
      return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    return { ...replay, title, anonymous: true, names: replay.seat ? [...ANONYMOUS].reverse() : [...ANONYMOUS],
      ubus: replay.ubus.map(u => ({ dna: unnamed(u.dna), super: u.super })) };
  }
  // A turn starting from `bodies` (before P.startTurn) with all six moves. `scores` and `fouls` are as the turn begins.
  function addTurn(replay, { turn, scores, fouls, bodies, plans }) {
    const entry = { turn, scores: [...scores], fouls: { crease: [...fouls.crease], corner: fouls.corner, cornerTurns: fouls.cornerTurns },
      bodies: snapshot(bodies), plans: plans.map(plan), ticks: 0, goal: null, cards: [], saves: [], stops: [] };
    replay.turns.push(entry);
    return entry;
  }
  // Total ticks, and where each turn starts in them.
  function timeline(replay) {
    const starts = [];
    let total = 0;
    for (const t of replay.turns) { starts.push(total); total += t.ticks; }
    return { starts, total };
  }

  function fail(message = 'This is not a valid ububall replay.') { throw new Error(message); }
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  function exact(v, keys) { if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail(); }
  function validNumber(key, v) {
    if (!Number.isFinite(v)) return false;
    if (POSITIVE.has(key)) {
      if (v <= 0) return false;
      if ((key === 'radius' || key === 'baseRadius') && v > 60) return false;
      if ((key === 'mass' || key === 'baseMass') && v > 20) return false;
    } else if (NONNEGATIVE.has(key)) {
      if (v < 0) return false;
      if (key === 'meter' && v > 100) return false;
      if ((key === 'superTicks' || key === 'superHoldTicks') && (!Number.isInteger(v) || v > 2400)) return false;
      if (key === 'fireTicks' && (!Number.isInteger(v) || v > P.FIRE_TICKS)) return false;
      if (key === 'ironCooldownTicks' && (!Number.isInteger(v) || v > P.IRON_COOLDOWN_TICKS)) return false;
    }
    return true;
  }
  function body(b, i) {
    if (!object(b) || Object.keys(b).some(k => !BODY.includes(k)) || REQUIRED.some(k => !Object.hasOwn(b, k))) fail();
    const out = {};
    for (const key of BODY) {
      if (!Object.hasOwn(b, key)) continue;
      const v = b[key];
      if (NUMBERS.includes(key) ? !validNumber(key, v) : FLAGS.includes(key) ? typeof v !== 'boolean'
        : key === 'superActive' ? v !== null && !P.SUPERS.some(s => s.key === v)
        : key === 'equippedSuper' ? v !== null && !int(v, 0, P.SUPERS.length - 1)
        : key === 'stickOffset' ? v !== null && (exact(v, ['x', 'y']), !Number.isFinite(v.x) || !Number.isFinite(v.y))
        : true) fail();
      out[key] = v;
    }
    if (out.team !== (i < 3 ? 0 : i < 6 ? 1 : -1)) fail();
    if (i < 6) {
      if (out.slot !== undefined && out.slot !== i % 3) fail();
    } else if (out.holding || out.equippedSuper != null || out.superActive) {
      fail();
    }
    return out;
  }
  function move(p) {
    exact(p, ['angle', 'power', 'spin', 'superArm', 'guard']);
    if (!Number.isFinite(p.angle) || !(p.power >= 0 && p.power <= 1) || !(p.spin >= -1 && p.spin <= 1) ||
        typeof p.superArm !== 'boolean' || typeof p.guard !== 'boolean') fail();
    return plan(p);
  }
  const index = v => v === null || int(v, 0, 5);
  function turn(t, mode) {
    exact(t, ['turn', 'scores', 'fouls', 'bodies', 'plans', 'ticks', 'goal', 'cards', 'saves', 'stops']);
    const f = t.fouls;
    exact(f, ['crease', 'corner', 'cornerTurns']);
    if (!int(t.turn, 1, 1e6) || !Array.isArray(t.scores) || t.scores.length !== 2 || !t.scores.every(s => int(s, 0, 4)) ||
        !Array.isArray(f.crease) || f.crease.length !== 2 || !f.crease.every(c => typeof c === 'boolean') ||
        !(f.corner === null || int(f.corner, 0, 3)) || !int(f.cornerTurns, 0, M.FOULS.stallTurns) ||
        !Array.isArray(t.bodies) || t.bodies.length !== 7 || !Array.isArray(t.plans) || t.plans.length !== 6 ||
        !int(t.ticks, 1, M.turnTicks(mode)) || !Array.isArray(t.cards) || !t.cards.every(c => int(c, 0, 5)) || new Set(t.cards).size !== t.cards.length) fail();
    let goal = null;
    if (t.goal !== null) {
      exact(t.goal, ['team', 'label', 'scorer', 'assist']);
      const g = t.goal;
      if (!int(g.team, 0, 1) || typeof g.label !== 'string' || g.label.length > 24 || !index(g.scorer) || !index(g.assist)) fail();
      if (g.scorer === null ? g.assist !== null : (Math.floor(g.scorer / 3) !== g.team || (g.assist !== null && (g.assist === g.scorer || Math.floor(g.assist / 3) !== g.team)))) fail();
      goal = { team: g.team, label: g.label, scorer: g.scorer, assist: g.assist };
    }
    // Saves and hit-stops as live play showed them, by tick (1 is the turn's first), in tick order.
    const at = (list, i) => int(list[i].tick, i ? list[i - 1].tick : 1, t.ticks);
    if (!Array.isArray(t.saves) || !t.saves.every((s, i) => (exact(s, ['tick', 'index', 'own', 'iron']), at(t.saves, i) && int(s.index, 0, 5) &&
        typeof s.own === 'boolean' && typeof s.iron === 'boolean')) ||
        !Array.isArray(t.stops) || !t.stops.every((s, i) => (exact(s, ['tick', 'ms']), at(t.stops, i) && int(s.ms, 1, 1000)))) fail();
    const bodies = t.bodies.map(body);
    if (bodies.filter(b => b.holding).length > 1) fail();
    return { turn: t.turn, scores: [...t.scores], fouls: { crease: [...f.crease], corner: f.corner, cornerTurns: f.cornerTurns },
      bodies, plans: t.plans.map(move), ticks: t.ticks, goal, cards: [...t.cards],
      saves: t.saves.map(s => ({ tick: s.tick, index: s.index, own: s.own, iron: s.iron })), stops: t.stops.map(s => ({ tick: s.tick, ms: s.ms })) };
  }
  // The replay in file order, or an error naming why it cannot be played.
  function canonical(r) {
    if (!object(r) || r.type !== 'ububall-replay') fail();
    if (r.format !== FORMAT || r.physics !== P.VERSION) {
      fail(r.format > FORMAT || r.physics > P.VERSION ? 'This replay is from a newer version of ububall.'
        : 'This replay is from an older version of ububall and can no longer be played.');
    }
    exact(r, ['type', 'format', 'physics', 'mode', 'seat', 'title', 'clip', 'anonymous', 'names', 'ubus', 'recorded', 'final', 'turns']);
    if (!M.MODES.includes(r.mode) || !int(r.seat, 0, 1) || !int(r.recorded, 0, 8.64e15) || typeof r.clip !== 'boolean' || typeof r.anonymous !== 'boolean' ||
        !(r.title === null || (typeof r.title === 'string' && r.title.length <= MAX_TITLE && r.title.trim() === r.title && r.title)) ||
        !Array.isArray(r.names) || r.names.length !== 2 || !r.names.every(n => typeof n === 'string' && n.length <= 64) ||
        !Array.isArray(r.ubus) || r.ubus.length !== 6 || !Array.isArray(r.turns) || !r.turns.length || r.turns.length > MAX_TURNS) fail();
    if (r.anonymous) {
      const expectedNames = r.seat ? [ANONYMOUS[1], ANONYMOUS[0]] : ANONYMOUS;
      if (r.names[0] !== expectedNames[0] || r.names[1] !== expectedNames[1]) fail();
    }
    const classic = M.rule(r.mode, 'classic');
    const ubus = r.ubus.map(u => {
      exact(u, ['dna', 'super']);
      // Canonical unpadded base64url for 128 bytes: the last character ends in two zero padding bits.
      // Zeroing the 64-bit name seed zeroes bits 0..63 (10 'A' chars = 60 bits, plus top 4 bits of char 10 = [A-D]).
      if (typeof u.dna !== 'string' || !/^[A-Za-z0-9_-]{170}[AEIMQUYcgkosw048]$/.test(u.dna) ||
          (r.anonymous && !/^A{10}[A-D]/.test(u.dna)) ||
          (classic ? u.super !== null : !int(u.super, 0, P.SUPERS.length - 1))) fail();
      if (!classic && U) {
        const model = U.decode(U.fromCode(u.dna));
        if (!model.supers.some(s => s % 8 === u.super)) fail();
      }
      return { dna: u.dna, super: u.super };
    });
    const turns = r.turns.map(t => turn(t, r.mode));
    let final = null;
    if (r.final !== null) {
      if (r.clip) fail();
      exact(r.final, ['scores', 'winner']);
      if (!Array.isArray(r.final.scores) || r.final.scores.length !== 2 || !r.final.scores.every(s => int(s, 0, 5)) || !int(r.final.winner, 0, 1)) fail();
      const w = r.final.winner, last = turns[turns.length - 1];
      if (r.final.scores[w] !== 5 || r.final.scores[1 - w] >= 5 || !last.goal || last.goal.team !== w ||
          last.scores[0] + (last.goal.team === 0 ? 1 : 0) !== r.final.scores[0] ||
          last.scores[1] + (last.goal.team === 1 ? 1 : 0) !== r.final.scores[1]) fail();
      final = { scores: [...r.final.scores], winner: w };
    }
    return { type: 'ububall-replay', format: FORMAT, physics: P.VERSION, mode: r.mode, seat: r.seat, title: r.title, clip: r.clip, anonymous: r.anonymous, names: [...r.names], ubus,
      recorded: r.recorded, final, turns };
  }
  async function pipe(bytes, stream, limit) {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader(), chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if ((size += value.length) > limit) { await reader.cancel(); fail('This replay is too large.'); }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }
  // The .ububall file: gzip of the replay's canonical UTF-8 JSON.
  async function write(r) {
    const data = { type: 'ububall-replay', format: FORMAT, physics: P.VERSION, mode: r.mode, seat: r.seat, title: r.title, clip: r.clip, anonymous: Boolean(r.anonymous), names: r.names, ubus: r.ubus,
      recorded: r.recorded, final: r.final, turns: r.turns };
    return pipe(encoder.encode(JSON.stringify(canonical(data))), new CompressionStream('gzip'), Infinity);
  }
  async function read(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_BYTES || bytes[0] !== 0x1f || bytes[1] !== 0x8b) fail();
    let text;
    try { text = decoder.decode(await pipe(bytes, new DecompressionStream('gzip'), MAX_TEXT)); } catch (error) { if (/too large/.test(error.message)) throw error; fail(); }
    let data;
    try { data = JSON.parse(text); } catch { fail(); }
    const replay = canonical(data);
    // Exactly what a writer produces: no duplicate or reordered fields, no other number spellings.
    if (JSON.stringify(replay) !== text) fail();
    return replay;
  }
  // Rebuild the box score and Game Log together, in the recording's rink order.
  function stats(replay) {
    const six = () => Array(6).fill(0);
    const engine = M.newTally(), origins = Array(6).fill(null);
    const out = { goals: engine.goals, assists: engine.assists, shots: engine.shots, saves: engine.saves, bigSaves: engine.bigSaves,
      checks: engine.checks, cards: engine.cards, touches: six(), passes: six(), skated: six(),
      control: [0, 0], side: [0, 0], rounds: [], events: [], trails: [], topShot: engine.topSpeed };
    const counts = { Touch: out.touches, Pass: out.passes };
    let play = M.newPlay(), last = null, lastTick = -Infinity, clock = 0, tick, turn, turnIndex, flight = null, lastPost = null;
    const where = body => ({ x: body.x, y: body.y, tick, turn, turnIndex });
    const path = (origin, end) => {
      if (!origin || origin.tick >= end.tick) return null;
      const { x, y, tick, turnIndex } = origin;
      return { from: { x, y, tick, turnIndex }, to: end };
    };
    const add = (type, actor, point, detail = {}) => {
      const event = { ...point, type, actor, team: actor === null ? null : Math.floor(actor / 3), round: out.rounds.length, ...detail };
      out.events.push(event);
      if (actor !== null && counts[type]) counts[type][actor]++;
      return event;
    };
    const shot = (actor, point, outcome, upgradeOnly = false) => {
      const origin = origins[actor];
      if (upgradeOnly && lastPost?.actor === actor && lastPost.outcome === 'Post') {
        lastPost.outcome = `Post, ${outcome.toLowerCase()}`;
        lastPost.path = path(origin, point);
      } else {
        const event = add('Shot', actor, origin || point, { outcome, path: path(origin, point) });
        lastPost = outcome === 'Post' ? event : null;
      }
    };
    let unscored = false;
    for (const [index, t] of replay.turns.entries()) {
      if (!t.ticks) break;
      unscored = true;
      turn = t.turn;
      turnIndex = index;
      const sim = restore(t.bodies), ball = sim[6], fouls = { ...t.fouls, crease: [...t.fouls.crease] };
      let contact;
      const fx = {
        collide({ a, b, speed, plow, checker }) {
          if (checker) add('Check', sim.indexOf(checker), where(checker), { target: sim.indexOf(checker === a ? b : a) });
          const player = !plow && M.toucher(a, b, speed);
          if (!player) return;
          const actor = sim.indexOf(player);
          contact = { ...where(ball), actor };
          origins[actor] = contact;
          if (actor !== last || tick - lastTick > 120) add('Touch', actor, contact);
          last = actor;
          lastTick = tick;
        },
        pass(from, to, body) { add('Pass', from, where(body), { target: to }); },
        shot(shooter, outcome, pos) {
          if (outcome === 'Post') shot(shooter, { ...pos, tick, turn, turnIndex }, 'Post');
        }
      };
      P.startTurn(sim, t.plans);
      // Thirty samples per second, including both ends of every turn. Keep turns
      // separate so kickoffs, penalties and resets never draw a connecting line.
      const stride = sim.length * 2, samples = new Float32Array((Math.ceil(t.ticks / 8) + 1) * stride);
      let offset = 0;
      const sample = () => {
        for (const body of sim) {
          samples[offset++] = body.x;
          samples[offset++] = body.y;
        }
      };
      out.trails.push({ round: out.rounds.length, startTick: clock, endTick: clock + t.ticks, samples });
      sample();
      let saveIndex = 0;
      const before = new Float64Array(12);
      for (let k = 1; k <= t.ticks; k++) {
        tick = ++clock;
        contact = null;
        for (let i = 0; i < 6; i++) { before[i * 2] = sim[i].x; before[i * 2 + 1] = sim[i].y; }
        const incomingBig = play.big;
        M.playTick(P, sim, play, fx, engine, false, true);
        const incoming = flight;
        if (k % 8 === 0 || k === t.ticks) sample();
        if (contact) flight = contact;
        const tickSaves = [];
        while (t.saves[saveIndex]?.tick === k) tickSaves.push(t.saves[saveIndex++]);
        if (tickSaves.length) {
          const point = where(ball);
          M.recordSaves(sim, play, engine, tickSaves, incomingBig, (save, shooter, _big, shotType) => {
            add('Save', save.index, point, { label: save.iron ? 'Iron save' : null, path: path(shooter === null ? incoming : origins[shooter], point) });
            if (shooter !== null && (shotType || (lastPost?.actor === shooter && lastPost.outcome === 'Post'))) {
              shot(shooter, point, 'Saved', !shotType);
            }
          });
        }
        for (let i = 0; i < 6; i++) out.skated[i] += Math.hypot(sim[i].x - before[i * 2], sim[i].y - before[i * 2 + 1]);
        if (last !== null) {
          out.control[Math.floor(last / 3)]++;
          if (ball.x !== 500) out.side[ball.x < 500 ? 0 : 1]++;
        }
        M.lapseFouls(P, sim, fouls);
      }
      M.recordCards(engine, t.cards);
      for (const actor of t.cards) add('Foul', actor, where(sim[actor]), { label: 'Yellow card' });
      if (t.goal) {
        const { team, scorer, assist, label } = t.goal;
        const point = where(ball);
        const wasCounted = play.postCounted;
        M.recordGoal(play, engine, scorer, assist);
        if (scorer !== null) shot(scorer, point, 'Goal', wasCounted);
        add('Goal', scorer, point, { team, label, score: t.scores[team] + 1, path: path(scorer === null ? flight : origins[scorer], point) });
        if (assist !== null) add('Assist', assist, where(ball), { target: scorer });
        out.rounds.push({ team, score: t.scores[team] + 1 });
        unscored = false;
      }
      const corner = M.cornerOf(P, ball.x, ball.y);
      const faceoff = corner !== null && corner === fouls.corner && fouls.cornerTurns >= M.FOULS.stallTurns;
      if (t.goal || faceoff) {
        play = M.newPlay();
        origins.fill(null);
        last = flight = lastPost = null;
      }
    }
    if (unscored) out.rounds.push({ team: null });
    // Events without an attributed strike show the half-second of ball motion leading into them.
    for (const event of out.events) {
      if (event.path) continue;
      const { turnIndex, tick } = event;
      const { startTick, endTick, samples } = out.trails[turnIndex];
      const ballAt = at => {
        const frame = Math.floor((at - startTick) / 8), offset = frame * 14 + 12;
        const previous = startTick + frame * 8, next = Math.min(previous + 8, endTick);
        const mix = next > previous ? (at - previous) / (next - previous) : 0;
        const coord = i => mix ? samples[i] + mix * (samples[i + 14] - samples[i]) : samples[i];
        return { x: coord(offset), y: coord(offset + 1), tick: at, turnIndex };
      };
      event.path = path(ballAt(Math.max(startTick, tick - 120)), ballAt(tick));
    }
    out.events.sort((a, b) => a.tick - b.tick);
    return out;
  }
  const api = { FORMAT, KEEP, MAX_TITLE, ANONYMOUS, snapshot, restore, create, clip, roundRange, anonymize, addTurn, timeline, canonical, write, read, stats };
  if (node) module.exports = api; else root.ububallReplay = api;
})(globalThis);
