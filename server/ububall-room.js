'use strict';
const rules = require('../shared/ububall-match.js');
const P = require('../web/ububall-physics.js');
const ubu = require('../shared/ubu.js');
const hold = () => Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false }));
// Durable storage adapter will persist this object; no client-supplied owner identities.
class MatchRoom {
  constructor(host, mode, teams) {
    if (typeof host !== 'string' || !host || !rules.MODES.includes(mode) || !['owned', 'practice'].includes(teams)) throw new Error('Invalid lobby.');
    this.state = { version: rules.VERSION, mode, teams, players: [host, null], phase: 'lobby', turn: 1,
      scorelessTurns: 0, drafts: [hold(), hold()], locked: [false, false], connected: [false, false],
      disconnectedAt: [null, null], deadline: null, remaining: null, winner: null, rematch: [false, false] };
    this.state.rosters = [null, null];
    this.state.practice = [null, null];
    this.state.game = null;
    this.state.replay = null;
    this.state.playUntil = null;
    this.state.expires = Date.now() + 86400000;
    if (teams === 'practice') this.practiceTeam(host);
  }
  seat(owner) { const i = this.state.players.indexOf(owner); if (i < 0) throw new Error('Not a match player.'); return i; }
  join(owner) {
    const s = this.state;
    if (typeof owner !== 'string' || !owner) throw new Error('Invalid player.');
    if (s.players.includes(owner)) return this.seat(owner);
    if (s.phase !== 'lobby' || s.players[1]) throw new Error('Match is full.');
    s.players[1] = owner;
    if (s.teams === 'practice') this.practiceTeam(owner);
    return 1;
  }
  practiceTeam(owner) {
    const i = this.seat(owner);
    return this.state.practice[i] ||= Array.from({ length: 3 }, () => ({ dna: ubu.toCode(ubu.randomDNA()) }));
  }
  selectTeam(owner, entries, supers) {
    const s = this.state, i = this.seat(owner);
    if (s.phase !== 'lobby' || !Array.isArray(entries) || entries.length !== 3 ||
        !Array.isArray(supers) || supers.length !== 3) throw new Error('Invalid team.');
    // Entries come from the registry or the room's practice roster, never the browser.
    const roster = entries.map((entry, index) => {
      const model = ubu.decode(ubu.fromCode(entry.dna)), id = supers[index];
      if (!Number.isInteger(id) || !model.supers.map(n => n % 8).includes(id)) throw new Error('Super not available to this ubu.');
      return { dna: entry.dna, serial: entry.serial || null, superId: id };
    });
    s.rosters[i] = roster;
  }
  kickoff(previous = null) {
    const s = this.state, bodies = P.kickoff(), stats = [];
    s.rosters.flat().forEach((entry, i) => {
      const model = ubu.decode(ubu.fromCode(entry.dna)), b = bodies[i], classic = s.mode.includes('classic');
      stats.push(classic ? {} : model.stats);
      P.applyStats(b, stats[i]);
      b.playerIndex = i;
      b.equippedSuper = classic ? null : P.SUPERS[entry.superId];
      b.meter = classic ? 0 : previous ? previous[i].meter : Math.min(100, model.rating / 1020 * 100);
      b.stunned = previous ? Boolean(previous[i].stunned) : false;
      b.superArm = false;
    });
    return { bodies, stats };
  }
  advance(now) {
    const s = this.state;
    if (s.phase === 'lobby' && s.rosters.every(Boolean) && s.connected.every(Boolean)) {
      s.game = { version: rules.VERSION, mode: s.mode, ...this.kickoff(), scores: [0, 0], scorelessTurns: 0, turn: 1 };
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
      s.turn = s.game.turn; s.scorelessTurns = s.game.scorelessTurns;
      s.playUntil = now + Math.ceil(s.replay.ticks * P.DT * 1000) + (s.replay.goal !== null ? 2200 : 750);
      s.replay.startedAt = now;
    }
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
    s.phase = 'plan'; s.drafts = [hold(), hold()]; s.locked = [false, false];
    s.replay = null;
    const duration = rules.planningMilliseconds(s.mode, s.scorelessTurns);
    s.deadline = duration !== null && s.connected.every(Boolean) ? now + duration : null;
    s.remaining = s.deadline === null ? duration : null;
  }
  submit(owner, turn, moves, lock, now) {
    const s = this.state, i = this.seat(owner);
    if (s.phase !== 'plan' || s.turn !== turn || s.locked[i] || !s.connected.every(Boolean) ||
        (s.deadline !== null && now >= s.deadline) || typeof lock !== 'boolean') throw new Error('Turn is not editable.');
    const validated = rules.validatePlans(moves);
    if (s.mode.includes('classic') && validated.some(p => p.superArm)) throw new Error('Classic has no supers.');
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
  }
  rematch(owner, now) {
    const s = this.state, i = this.seat(owner);
    if (s.phase !== 'over') throw new Error('Match is not over.');
    s.rematch[i] = true;
    if (s.rematch.every(Boolean) && s.connected.every(Boolean)) {
      s.rematch = [false, false];
      s.winner = null;
      s.turn = 1;
      s.scorelessTurns = 0;
      s.phase = 'lobby';
      s.game = { version: rules.VERSION, mode: s.mode, ...this.kickoff(), scores: [0, 0], scorelessTurns: 0, turn: 1 };
      this.beginPlanning(now);
    }
  }
  view(owner) {
    const s = this.state, seat = this.seat(owner);
    return { version: s.version, seat, mode: s.mode, teams: s.teams, phase: s.phase, turn: s.turn,
      occupied: s.players.map(Boolean), connected: [...s.connected], locked: [...s.locked],
      moves: structuredClone(s.drafts[seat]), deadline: s.deadline, remaining: s.remaining, winner: s.winner,
      ready: s.rosters.map(Boolean), rosters: structuredClone(s.rosters),
      practice: s.teams === 'practice' ? structuredClone(s.practice[seat]) : null,
      game: structuredClone(s.game), replay: s.phase === 'resolving' ? structuredClone(s.replay) : null,
      playUntil: s.playUntil, disconnectedAt: [...s.disconnectedAt], rematch: [...s.rematch] };
  }
}
module.exports = { MatchRoom };
