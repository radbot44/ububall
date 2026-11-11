'use strict';
const rules = require('../shared/ububall-match.js');
const P = require('../web/ububall-physics.js');
const ubu = require('../shared/ubu.js');
const { starterTeam } = require('../shared/rarity.js');
const idle = () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false });
const hold = () => Array.from({ length: 3 }, idle);
// Durable storage adapter will persist this object; no client-supplied owner identities.
class MatchRoom {
  constructor(host, mode, guest = false) {
    if (typeof host !== 'string' || !host || !rules.MODES.includes(mode)) throw new Error('Invalid lobby.');
    this.state = { version: rules.VERSION, mode, players: [host, null], names: [null, null], phase: 'lobby', turn: 1,
      drafts: [hold(), hold()], locked: [false, false], connected: [false, false],
      disconnectedAt: [null, null], deadline: null, remaining: null, winner: null, rematch: [false, false],
      ready: [false, false], left: [false, false] };
    this.state.rosters = [null, null];
    this.state.guestTeams = [null, null];
    this.state.game = null;
    this.state.replay = null;
    this.state.playUntil = null;
    this.state.expires = Date.now() + 86400000;
    if (guest) this.guestTeam(host);
  }
  seat(owner) { const i = this.state.players.indexOf(owner); if (i < 0) throw new Error('Not a match player.'); return i; }
  join(owner, guest = false) {
    const s = this.state;
    if (typeof owner !== 'string' || !owner) throw new Error('Invalid player.');
    if (s.players.includes(owner)) return this.seat(owner);
    if (s.phase !== 'lobby' || s.players[1]) throw new Error('Match is full.');
    s.players[1] = owner;
    // Guests have no collection, so they field three server-generated ubus they cannot keep.
    if (guest) this.guestTeam(owner);
    return 1;
  }
  claim(owner, alias) {
    const s = this.state, i = s.players.indexOf(alias);
    if (!alias || i < 0 || s.players.includes(owner)) return false;
    s.players[i] = owner;
    // A former guest who hasn't readied yet may now pick their own ubus.
    if (s.phase === 'lobby' && !s.ready[i]) { s.guestTeams[i] = null; s.rosters[i] = null; }
    return true;
  }
  // Discord display names label each side; guests have none.
  rename(owner, name) {
    this.state.names[this.seat(owner)] = typeof name === 'string' && name.trim() ? name.trim().slice(0, 32) : null;
  }
  guestTeam(owner) {
    const i = this.seat(owner);
    return this.state.guestTeams[i] ||= starterTeam(ubu).map(dna => ({ dna }));
  }
  selectTeam(owner, entries, supers) {
    const s = this.state, i = this.seat(owner);
    if (s.phase !== 'lobby' || !Array.isArray(entries) || entries.length !== 3 ||
        !Array.isArray(supers) || supers.length !== 3) throw new Error('Invalid team.');
    // Entries come from the registry or the room's guest team, never the browser.
    const roster = entries.map((entry, index) => {
      const model = ubu.decode(ubu.fromCode(entry.dna)), id = supers[index];
      if (!Number.isInteger(id) || !model.supers.map(n => n % 8).includes(id)) throw new Error('Super not available to this ubu.');
      return { dna: entry.dna, serial: entry.serial || null, superId: id };
    });
    s.rosters[i] = roster; s.ready[i] = true;
  }
  // Both players start at once: each owned team comes from the registry, a null seat is a guest's.
  readyPair(teams) {
    this.state.players.forEach((owner, i) => {
      const entries = teams[i]?.entries || this.state.guestTeams[i];
      this.selectTeam(owner, entries, teams[i]?.supers || entries.map(({ dna }) => ubu.decode(ubu.fromCode(dna)).supers[0] % 8));
    });
    this.state.quickStart = true;
  }
  // Until kickoff a ready player may go back and change their team.
  unready(owner, guest = Boolean(this.state.guestTeams[this.seat(owner)])) {
    const s = this.state, i = this.seat(owner);
    if (s.phase !== 'lobby') throw new Error('Match already started.');
    s.ready[i] = false;
    if (!guest && s.guestTeams[i]) { s.guestTeams[i] = null; s.rosters[i] = null; }
  }
  canChangeRules() {
    const s = this.state;
    return !s.left.some(Boolean) && (s.phase === 'lobby' ||
      Boolean(s.quickStart && s.phase === 'plan' && s.turn === 1 && !s.locked.some(Boolean)));
  }
  changeRules(owner, mode, gameNumber) {
    this.seat(owner);
    const s = this.state;
    if (!rules.MODES.includes(mode)) throw new Error('Invalid rules.');
    if (gameNumber !== (s.gameNumber || 0)) throw new Error('The game changed. Reopen the rules to try again.');
    if (!this.canChangeRules()) throw new Error('Rules can only change before the first launch.');
    if (mode === s.mode) return;
    s.mode = mode; s.gameNumber = (s.gameNumber || 0) + 1;
    s.phase = 'lobby'; s.game = null; s.turn = 1; s.replay = null; s.playUntil = null;
    s.deadline = null; s.remaining = null; s.drafts = [hold(), hold()]; s.locked = [false, false];
    s.ready = s.quickStart ? [true, true] : [false, false];
  }
  // Leaving ends the match for both players: a lobby guest frees their seat, anyone else concedes.
  leave(owner, now) {
    const s = this.state, i = this.seat(owner);
    if (s.phase === 'lobby' && i === 1 && !s.paired) {
      s.players[1] = null; s.names[1] = null; s.rosters[1] = null; s.guestTeams[1] = null; s.ready[1] = false;
      s.connected[1] = false; s.disconnectedAt[1] = null;
      if (s.watch) { s.watch.allowed[1] = false; s.watch.key = null; }
      return;
    }
    if (s.phase !== 'over') { s.phase = 'over'; s.winner = s.game ? 1 - i : null; }
    s.left[i] = true; s.rematch = [false, false];
    s.deadline = null; s.remaining = null; s.playUntil = null; s.replay = null;
  }
  kickoff(previous = null) {
    const s = this.state, bodies = P.kickoff(), stats = [];
    s.rosters.flat().forEach((entry, i) => {
      const model = ubu.decode(ubu.fromCode(entry.dna)), b = bodies[i], classic = rules.rule(s.mode, 'classic');
      stats.push(classic ? {} : model.stats);
      rules.applyStats(P, b, stats[i], s.mode);
      b.playerIndex = i;
      const mastery = classic ? null : P.superMastery(model.supers, entry.superId);
      b.equippedSuper = classic ? null : { ...P.SUPERS[entry.superId], ...mastery };
      b.superBonusTicks = mastery?.bonusTicks || 0;
      b.superBonusRefund = mastery?.bonusRefund || 0;
      b.meter = classic ? 0 : previous ? previous[i].meter : Math.min(100, model.rating / 1020 * 100);
      b.stunned = previous ? Boolean(previous[i].stunned) : false;
      b.superArm = false;
    });
    return { bodies, stats };
  }
  advance(now) {
    const s = this.state;
    if (s.phase === 'lobby' && s.ready.every(Boolean) && s.connected.every(Boolean)) {
      s.game = { version: rules.VERSION, mode: s.mode, ...this.kickoff(), scores: [0, 0], turn: 1 };
      this.beginPlanning(now);
    }
    if (s.phase === 'resolving' && s.playUntil !== null && now >= s.playUntil) {
      s.playUntil = null;
      if (s.game.winner !== null) { s.phase = 'over'; s.winner = s.game.winner; return; }
      if (s.game.phase === 'goal') Object.assign(s.game, this.kickoff(s.game.bodies));
      this.beginPlanning(now);
    }
    const moves = this.takeTurn(now);
    if (moves) {
      const result = rules.resolveTurn(P, s.game, moves);
      s.game = result.state; s.replay = result.replay;
      s.turn = s.game.turn;
      // A play is the unbroken motion since the field last rested; a goal waits for its replay.
      const settled = P.settled(s.replay.initialBodies);
      const stops = s.replay.stops.reduce((ms, stop) => ms + stop.ms, 0);
      s.playTicks = (settled ? 0 : s.playTicks || 0) + s.replay.ticks;
      s.playStops = (settled ? 0 : s.playStops || 0) + stops;
      s.playUntil = s.replay.goal === null ? now + Math.ceil(s.replay.ticks * P.DT * 1000) + stops + 750 : null;
      s.replay.startedAt = now;
    }
  }
  skipReplay(owner, startedAt, now) {
    this.seat(owner);
    const s = this.state;
    if (s.phase !== 'resolving' || s.replay?.goal == null || s.replay.startedAt !== startedAt || s.playUntil !== null) return;
    const stops = s.replay.stops.reduce((ms, stop) => ms + stop.ms, 0);
    const firstCycleEnd = startedAt + Math.ceil(s.replay.ticks * P.DT * 1000) + stops + rules.replayMilliseconds(P, s.playTicks) + (s.playStops || 0);
    s.playUntil = Math.max(now, firstCycleEnd);
  }
  connect(owner, now) {
    const s = this.state, i = this.seat(owner);
    s.connected[i] = true; s.disconnectedAt[i] = null;
    if (s.phase === 'plan' && s.connected.every(Boolean) && s.remaining !== null) {
      s.deadline = now + s.remaining; s.remaining = null;
    }
  }
  disconnect(owner, now) {
    const s = this.state, i = this.seat(owner);
    if (!s.connected[i]) return;
    s.connected[i] = false; s.disconnectedAt[i] = now;
    if (s.phase === 'plan' && s.deadline !== null) { s.remaining = Math.max(0, s.deadline - now); s.deadline = null; }
  }
  beginPlanning(now) {
    const s = this.state;
    if (!s.players[1] || !['lobby', 'resolving'].includes(s.phase)) throw new Error('Cannot begin turn.');
    // Guarding ubus stay on guard into the next turn of the same round.
    const keepGuard = s.game?.phase === 'plan';
    s.phase = 'plan'; s.locked = [false, false];
    s.drafts = keepGuard ? s.drafts.map(draft => draft.map(p => ({ ...p, superArm: false }))) : [hold(), hold()];
    s.replay = null;
    const duration = rules.planningMilliseconds(s.mode);
    s.deadline = duration !== null && s.connected.every(Boolean) ? now + duration : null;
    s.remaining = s.deadline === null ? duration : null;
  }
  submit(owner, turn, moves, lock, now) {
    const s = this.state, i = this.seat(owner);
    if (s.phase !== 'plan' || s.turn !== turn || s.locked[i] || !s.connected.every(Boolean) ||
        (s.deadline !== null && now >= s.deadline) || typeof lock !== 'boolean') throw new Error('Turn is not editable.');
    const validated = rules.validatePlans(moves);
    if (rules.rule(s.mode, 'classic') && validated.some(p => p.superArm)) throw new Error('Classic has no supers.');
    if (s.game) validated.forEach((p, index) => {
      const b = s.game.bodies[i * 3 + index];
      if (p.superArm && (b.stunned || b.meter < 100 || !b.equippedSuper)) throw new Error('Super unavailable.');
    });
    s.drafts[i] = validated; s.locked[i] = lock;
  }
  takeTurn(now) {
    const s = this.state;
    if (s.phase !== 'plan' || !s.connected.every(Boolean) || !(s.locked.every(Boolean) || (s.deadline !== null && now >= s.deadline))) return null;
    s.phase = 'resolving'; s.deadline = null;
    return structuredClone(s.drafts.flat());
  }
  claimForfeit(owner, now) {
    const s = this.state, i = this.seat(owner), other = 1 - i;
    if (s.phase === 'over' || !s.players[other] || !s.connected[i] || s.connected[other] ||
        s.disconnectedAt[other] === null || now - s.disconnectedAt[other] < 60000) throw new Error('Forfeit is not available.');
    s.phase = 'over'; s.winner = i; s.deadline = null;
    s.playUntil = null; s.replay = null;
  }
  rematch(owner, now) {
    const s = this.state, i = this.seat(owner);
    if (s.phase !== 'over') throw new Error('Match is not over.');
    if (s.left.some(Boolean)) throw new Error('Your opponent left the match.');
    s.rematch[i] = true;
    // Keep the teams for a rematch. Quick-start players are already ready for kickoff.
    if (s.rematch.every(Boolean)) {
      s.gameNumber = (s.gameNumber || 0) + 1;
      s.rematch = [false, false]; s.ready = s.quickStart ? [true, true] : [false, false]; s.winner = null; s.turn = 1; s.phase = 'lobby';
      s.drafts = [hold(), hold()]; s.locked = [false, false]; s.deadline = null; s.remaining = null; s.playTicks = 0; s.playStops = 0;
      s.game = null; s.replay = null; s.playUntil = null; s.expires = now + 86400000;
    }
  }
  allowWatch(owner, allowed) {
    const seat = this.seat(owner);
    if (typeof allowed !== 'boolean') throw new Error('Choose whether to allow spectators.');
    const watch = this.state.watch ||= { allowed: [false, false], key: null };
    watch.allowed[seat] = allowed;
    watch.key = watch.allowed.every(Boolean) ? this.state.activity ? watch.key : watch.key || crypto.randomUUID() : null;
  }
  shareWatch(owner) {
    this.seat(owner);
    if (!this.state.watch?.allowed.every(Boolean)) throw new Error('Spectating is disabled.');
    this.state.watch.key ||= crypto.randomUUID();
  }
  watchView() {
    const s = this.state;
    return { spectator: true, mode: s.mode, phase: s.phase, turn: s.turn,
      names: [...s.names], connected: [...s.connected], winner: s.winner, deadline: s.deadline, remaining: s.remaining,
      rosters: s.game ? s.rosters.map(team => team.map(({ dna, superId }) => ({ dna, superId }))) : [null, null],
      game: structuredClone(s.game), replay: s.phase === 'resolving' ? structuredClone(s.replay) : null,
      playUntil: s.playUntil };
  }
  view(owner) {
    const s = this.state, seat = this.seat(owner);
    return { version: s.version, seat, mode: s.mode, phase: s.phase, turn: s.turn,
      occupied: s.players.map(Boolean), names: [...s.names], connected: [...s.connected], locked: [...s.locked],
      moves: structuredClone(s.drafts[seat]), deadline: s.deadline, remaining: s.remaining, winner: s.winner,
      ready: [...s.ready], left: [...s.left], rosters: structuredClone(s.rosters),
      guestTeam: structuredClone(s.guestTeams[seat]),
      game: structuredClone(s.game), replay: s.phase === 'resolving' ? structuredClone(s.replay) : null,
      playUntil: s.playUntil, disconnectedAt: [...s.disconnectedAt], rematch: [...s.rematch],
      paired: Boolean(s.paired), challenge: Boolean(s.challenge), quickStart: Boolean(s.quickStart), gameNumber: s.gameNumber || 0,
      matchKind: s.matchKind || 'friend',
      canChangeRules: this.canChangeRules(), watchAllowed: s.watch?.allowed[seat] ?? false, watchKey: s.watch?.key ?? null };
  }
}
module.exports = { MatchRoom };
