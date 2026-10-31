/* Match replays: each turn's starting field and moves, re-simulated to play back. See docs/ububall-file.md. */
(function(root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const P = node ? require('../web/ububall-physics.js') : root.ububallPhysics;
  const M = node ? require('./ububall-match.js') : root.ububallMatch;
  const FORMAT = 1, MAX_BYTES = 8 << 20, MAX_TEXT = 64 << 20, MAX_TURNS = 5000;
  // Saved replays kept on this device by default; the oldest go first.
  const KEEP = 25;
  // Body fields a snapshot keeps, in file order: everything a turn's simulation reads or writes.
  const NUMBERS = ['x', 'y', 'vx', 'vy', 'omega', 'rotation', 'radius', 'mass', 'friction', 'grip', 'maxSpin', 'team', 'slot', 'curveFactor',
    'sizeMult', 'baseMass', 'baseRadius', 'impulse', 'curveMult', 'bounciness', 'wallBounce', 'power', 'reach', 'strength', 'stability',
    'meter', 'meterTick', 'daze', 'spinStrike', 'superTicks', 'stuckTicks'];
  const FLAGS = ['superArm', 'guarding', 'usedSuperThisTurn', 'openingShot', 'spinStruck', 'shockwaveFired', 'carded', 'colossusApplied', 'stunned', 'stunnedNext'];
  const GUARD = ['reach', 'friction', 'strength', 'stability', 'bounciness'];
  const BODY = [...NUMBERS, ...FLAGS, 'superActive', 'equippedSuper', 'guardBase', 'stuckTo', 'stickOffset'];
  const REQUIRED = ['x', 'y', 'vx', 'vy', 'omega', 'radius', 'mass', 'team'];
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  // A plain copy of the field: references become indexes, the equipped super its id.
  function snapshot(bodies) {
    return bodies.map(b => {
      const out = {};
      for (const key of BODY) {
        const value = b[key];
        if (value === undefined) continue;
        if (key === 'equippedSuper') out[key] = value ? value.id : null;
        else if (key === 'stuckTo') out[key] = value ? bodies.indexOf(value) : null;
        else if (key === 'stickOffset') out[key] = value && { x: value.x, y: value.y };
        else if (key === 'guardBase') out[key] = value && Object.fromEntries(GUARD.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
        else out[key] = value;
      }
      return out;
    });
  }
  function restore(snap) {
    const bodies = snap.map(b => {
      const out = { ...b };
      if (b.equippedSuper != null) out.equippedSuper = P.SUPERS[b.equippedSuper];
      if (b.guardBase) out.guardBase = { ...b.guardBase };
      if (b.stickOffset) out.stickOffset = { ...b.stickOffset };
      return out;
    });
    for (const b of bodies) if (b.stuckTo != null) b.stuckTo = bodies[b.stuckTo];
    return bodies;
  }
  // Moves exactly as the turn started with them (angles are not normalised: that would change the launch).
  const plan = p => ({ angle: p.angle, power: p.power, spin: p.spin || 0, superArm: Boolean(p.superArm), guard: Boolean(p.guard) });

  // A recording in progress. `seat` is the team shown on the left; `names` and `ubus` (DNA code and
  // equipped super id) are in rink order, the left team first when seat is 0.
  function create({ mode, seat = 0, names, ubus }) {
    return { mode, seat, names: [...names], ubus: ubus.map(u => ({ dna: u.dna, super: u.super })), recorded: Date.now(), final: null, turns: [] };
  }
  // A turn starting from `bodies` (before P.startTurn) with all six moves. `scores` and `fouls` are as the turn begins.
  function addTurn(replay, { turn, scores, fouls, bodies, plans }) {
    const entry = { turn, scores: [...scores], fouls: { crease: [...fouls.crease], corner: fouls.corner, cornerTurns: fouls.cornerTurns },
      bodies: snapshot(bodies), plans: plans.map(plan), ticks: 0, goal: null, cards: [] };
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
  function body(b, i) {
    if (!object(b) || Object.keys(b).some(k => !BODY.includes(k)) || REQUIRED.some(k => !Object.hasOwn(b, k))) fail();
    const out = {};
    for (const key of BODY) {
      if (!Object.hasOwn(b, key)) continue;
      const v = b[key];
      if (NUMBERS.includes(key) ? !Number.isFinite(v) : FLAGS.includes(key) ? typeof v !== 'boolean'
        : key === 'superActive' ? v !== null && !P.SUPERS.some(s => s.key === v)
        : key === 'equippedSuper' ? v !== null && !int(v, 0, P.SUPERS.length - 1)
        : key === 'stuckTo' ? v !== null && !int(v, 0, 5)
        : key === 'stickOffset' ? v !== null && (exact(v, ['x', 'y']), !Number.isFinite(v.x) || !Number.isFinite(v.y))
        : v !== null && (!object(v) || Object.keys(v).some(k => !GUARD.includes(k) || !Number.isFinite(v[k])))) fail();
      out[key] = key === 'guardBase' && v ? Object.fromEntries(GUARD.filter(k => Object.hasOwn(v, k)).map(k => [k, v[k]])) : v;
    }
    if (out.team !== (i < 3 ? 0 : i < 6 ? 1 : -1)) fail();
    return out;
  }
  function move(p) {
    exact(p, ['angle', 'power', 'spin', 'superArm', 'guard']);
    if (!Number.isFinite(p.angle) || !(p.power >= 0 && p.power <= 1) || !(p.spin >= -1 && p.spin <= 1) ||
        typeof p.superArm !== 'boolean' || typeof p.guard !== 'boolean') fail();
    return plan(p);
  }
  const index = v => v === null || int(v, 0, 5);
  function turn(t) {
    exact(t, ['turn', 'scores', 'fouls', 'bodies', 'plans', 'ticks', 'goal', 'cards']);
    const f = t.fouls;
    exact(f, ['crease', 'corner', 'cornerTurns']);
    if (!int(t.turn, 1, 1e6) || !Array.isArray(t.scores) || t.scores.length !== 2 || !t.scores.every(s => int(s, 0, 4)) ||
        !Array.isArray(f.crease) || f.crease.length !== 2 || !f.crease.every(c => typeof c === 'boolean') ||
        !(f.corner === null || int(f.corner, 0, 3)) || !int(f.cornerTurns, 0, M.FOULS.stallTurns) ||
        !Array.isArray(t.bodies) || t.bodies.length !== 7 || !Array.isArray(t.plans) || t.plans.length !== 6 ||
        !int(t.ticks, 1, M.turnTicks('standard')) || !Array.isArray(t.cards) || !t.cards.every(c => int(c, 0, 5)) || new Set(t.cards).size !== t.cards.length) fail();
    let goal = null;
    if (t.goal !== null) {
      exact(t.goal, ['team', 'label', 'scorer', 'assist']);
      const g = t.goal;
      if (!int(g.team, 0, 1) || typeof g.label !== 'string' || g.label.length > 24 || !index(g.scorer) || !index(g.assist)) fail();
      goal = { team: g.team, label: g.label, scorer: g.scorer, assist: g.assist };
    }
    return { turn: t.turn, scores: [...t.scores], fouls: { crease: [...f.crease], corner: f.corner, cornerTurns: f.cornerTurns },
      bodies: t.bodies.map(body), plans: t.plans.map(move), ticks: t.ticks, goal, cards: [...t.cards] };
  }
  // The replay in file order, or an error naming why it cannot be played.
  function canonical(r) {
    if (!object(r) || r.type !== 'ububall-replay') fail();
    if (r.format !== FORMAT || r.physics !== P.VERSION) {
      fail(r.format > FORMAT || r.physics > P.VERSION ? 'This replay is from a newer version of ububall.'
        : 'This replay is from an older version of ububall and can no longer be played.');
    }
    exact(r, ['type', 'format', 'physics', 'mode', 'seat', 'names', 'ubus', 'recorded', 'final', 'turns']);
    if (!M.MODES.includes(r.mode) || !int(r.seat, 0, 1) || !int(r.recorded, 0, 8.64e15) ||
        !Array.isArray(r.names) || r.names.length !== 2 || !r.names.every(n => typeof n === 'string' && n.length <= 64) ||
        !Array.isArray(r.ubus) || r.ubus.length !== 6 || !Array.isArray(r.turns) || !r.turns.length || r.turns.length > MAX_TURNS) fail();
    const classic = M.rule(r.mode, 'classic');
    const ubus = r.ubus.map(u => {
      exact(u, ['dna', 'super']);
      // Canonical unpadded base64url for 128 bytes: the last character ends in two zero padding bits.
      if (typeof u.dna !== 'string' || !/^[A-Za-z0-9_-]{170}[AEIMQUYcgkosw048]$/.test(u.dna) || (classic ? u.super !== null : !int(u.super, 0, P.SUPERS.length - 1))) fail();
      return { dna: u.dna, super: u.super };
    });
    let final = null;
    if (r.final !== null) {
      exact(r.final, ['scores', 'winner']);
      if (!Array.isArray(r.final.scores) || r.final.scores.length !== 2 || !r.final.scores.every(s => int(s, 0, 5)) || !int(r.final.winner, 0, 1)) fail();
      final = { scores: [...r.final.scores], winner: r.final.winner };
    }
    return { type: 'ububall-replay', format: FORMAT, physics: P.VERSION, mode: r.mode, seat: r.seat, names: [...r.names], ubus,
      recorded: r.recorded, final, turns: r.turns.map(turn) };
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
    const data = { type: 'ububall-replay', format: FORMAT, physics: P.VERSION, mode: r.mode, seat: r.seat, names: r.names, ubus: r.ubus,
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
  const api = { FORMAT, KEEP, snapshot, restore, create, addTurn, timeline, canonical, write, read };
  if (node) module.exports = api; else root.ububallReplay = api;
})(globalThis);
