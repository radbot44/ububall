const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../shared/ububall-match.js');
const P = require('../web/ububall-physics.js');
test('network move validation rejects forged state and non-finite or out-of-range moves', () => {
  const moves = () => Array.from({length:3}, () => ({angle:0,power:.5,spin:0,superArm:false}));
  assert.equal(M.validatePlans(moves()).length,3);
  for(const patch of [{power:2},{spin:NaN},{angle:Infinity},{meter:100},{superArm:1}]) {
    const input=moves(); Object.assign(input[0],patch); assert.throws(()=>M.validatePlans(input));
  }
  assert.throws(()=>M.validatePlans([]));
});
test('Blitz deadline switches only after ten scoreless turns', () => {
  assert.equal(M.planningMilliseconds('blitz',9),10000);
  assert.equal(M.planningMilliseconds('classic-blitz',10),5000);
  assert.equal(M.planningMilliseconds('blitz',0),10000);
  assert.equal(M.planningMilliseconds('classic',15),null);
});
test('shared meter rules exclude super users and the opposing team', () => {
  const bodies=P.kickoff(); bodies.forEach(b=>b.meter=0); bodies[1].usedSuperThisTurn=true;
  M.gainMeter(P,bodies,[],bodies[0],18);
  assert.equal(bodies[0].meter,18); assert.equal(bodies[1].meter,0); assert.equal(bodies[2].meter,4.5); assert.equal(bodies[3].meter,0);
  M.gainMeter(P,bodies,[],bodies[1],18); assert.equal(bodies[1].meter,0);
});

const { MatchRoom } = require('../server/ububall-room.js');
test('private drafts, turn locking, disconnect pause and latest-draft Blitz expiry', () => {
  const room = new MatchRoom('host','blitz','practice'); room.join('guest');
  room.connect('host',0); room.connect('guest',0); room.beginPlanning(0);
  const moves=Array.from({length:3},()=>({angle:0,power:.8,spin:0,superArm:false}));
  room.submit('host',1,moves,false,1000);
  assert.equal(room.view('guest').moves[0].power,0);
  assert.throws(()=>room.view('stranger'));
  room.disconnect('guest',2000); assert.equal(room.state.remaining,8000);
  assert.equal(room.takeTurn(50000),null);
  room.connect('guest',50000); assert.equal(room.state.deadline,58000);
  assert.equal(room.takeTurn(57999),null);
  const turn=room.takeTurn(58000); assert.equal(turn[0].power,.8); assert.equal(turn[3].power,0);
  assert.equal(room.takeTurn(58001),null);
  assert.throws(()=>room.submit('host',1,moves,true,58001));
});
test('forfeit requires a seated connected claimant and sixty disconnected seconds', () => {
  const room=new MatchRoom('host','classic','owned');room.join('guest');room.connect('host',0);room.connect('guest',0);
  room.disconnect('guest',100);
  assert.throws(()=>room.claimForfeit('host',60099));assert.throws(()=>room.claimForfeit('stranger',60100));
  room.claimForfeit('host',60100);assert.equal(room.state.winner,0);
});

test('MatchRoom advance drives full lifecycle from lobby to resolving and next turn planning', () => {
  const room = new MatchRoom('host', 'standard', 'practice');
  const ubu = require('../shared/ubu.js');
  room.join('guest');
  room.connect('host', 1000);
  room.connect('guest', 1000);
  assert.equal(room.state.phase, 'lobby');
  const hostSupers = room.state.practice[0].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  const guestSupers = room.state.practice[1].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  room.selectTeam('host', room.state.practice[0], hostSupers);
  room.advance(1000);
  assert.equal(room.state.phase, 'lobby');
  room.selectTeam('guest', room.state.practice[1], guestSupers);
  room.advance(1000);
  assert.equal(room.state.phase, 'plan');
  assert.equal(room.state.turn, 1);
  assert.ok(room.state.game);
  const moves = () => Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false }));
  room.submit('host', 1, moves(), true, 1100);
  room.advance(1100);
  assert.equal(room.state.phase, 'plan');
  assert.equal(room.state.locked[0], true);
  room.submit('guest', 1, moves(), true, 1200);
  room.advance(1200);
  assert.equal(room.state.phase, 'resolving');
  assert.ok(room.state.replay);
  assert.ok(room.state.playUntil > 1200);
  assert.equal(room.state.turn, 2);
  room.advance(room.state.playUntil - 1);
  assert.equal(room.state.phase, 'resolving');
  room.advance(room.state.playUntil);
  assert.equal(room.state.phase, 'plan');
  assert.equal(room.state.locked[0], false);
  assert.equal(room.state.locked[1], false);
  assert.equal(room.state.replay, null);
});

test('authoritative resolution is repeatable, immutable, bounded and serializable', () => {
  const bodies=P.kickoff(); bodies.slice(0,6).forEach(b=>{P.applyStats(b);b.meter=0;});
  const state={version:M.VERSION,mode:'standard',bodies,stats:Array.from({length:6},()=>({})),scores:[0,0],scorelessTurns:0,turn:1};
  const moves=Array.from({length:6},(_,i)=>({angle:i<3?0:Math.PI,power:.8,spin:.3,superArm:false}));
  const original=structuredClone(state), first=M.resolveTurn(P,state,moves);
  assert.deepEqual(state,original);assert.deepEqual(first,M.resolveTurn(P,state,moves));
  assert.ok(first.replay.ticks<=2880);assert.equal(first.replay.initialBodies.length,7);
  assert.equal(first.state.turn,2);assert.doesNotThrow(()=>JSON.stringify(first));
  moves[0].superArm=true;assert.throws(()=>M.resolveTurn(P,state,moves));
});
test('goal resolution awards victory and resets scoreless count once', () => {
  const bodies=P.kickoff();bodies.slice(0,6).forEach(b=>{P.applyStats(b);b.meter=0;});
  Object.assign(bodies[6],{x:959,y:300,vx:400});
  const state={version:M.VERSION,mode:'classic',bodies,stats:[],scores:[4,0],scorelessTurns:12,turn:4};
  const moves=Array.from({length:6},()=>({angle:0,power:0,spin:0,superArm:false}));
  const result=M.resolveTurn(P,state,moves);
  assert.equal(result.state.winner,0);assert.deepEqual(result.state.scores,[5,0]);assert.equal(result.state.scorelessTurns,0);
  assert.equal(result.state.phase,'over');assert.ok(result.state.bodies.slice(0,6).every(b=>b.meter===0));
});

test('authoritative supers consume meter and preserve the no-gain rule through settlement', () => {
  for (const { key } of P.SUPERS) {
    const bodies=P.kickoff();bodies.slice(0,6).forEach(b=>{P.applyStats(b);b.meter=100;});
    bodies[0].equippedSuper={key};
    const state={version:M.VERSION,mode:'standard',bodies,stats:[],scores:[0,0],scorelessTurns:0,turn:1};
    const moves=Array.from({length:6},(_,i)=>({angle:0,power:i===0?.7:0,spin:.4,superArm:i===0}));
    const result=M.resolveTurn(P,state,moves);
    assert.equal(result.state.bodies[0].meter,0,key);
    assert.equal(result.replay.initialBodies[0].meter,100,key);
    assert.equal(result.state.bodies[0].superActive,null);
    assert.doesNotThrow(()=>JSON.stringify(result));
  }
});

test('MatchRoom rematch requires match over and agreement from both players', () => {
  const room = new MatchRoom('host', 'standard', 'practice');
  const ubu = require('../shared/ubu.js');
  room.join('guest');
  room.connect('host', 1000); room.connect('guest', 1000);
  assert.throws(() => room.rematch('host', 1000));
  const hostSupers = room.state.practice[0].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  const guestSupers = room.state.practice[1].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  room.selectTeam('host', room.state.practice[0], hostSupers);
  room.selectTeam('guest', room.state.practice[1], guestSupers);
  room.advance(1000);
  assert.equal(room.state.phase, 'plan');
  assert.throws(() => room.rematch('host', 1000));
  room.state.phase = 'over'; room.state.winner = 0; room.state.turn = 10;
  room.rematch('host', 2000);
  assert.deepEqual(room.state.rematch, [true, false]);
  assert.equal(room.state.phase, 'over');
  room.rematch('guest', 2000);
  assert.equal(room.state.phase, 'plan');
  assert.equal(room.state.turn, 1);
  assert.equal(room.state.winner, null);
  assert.deepEqual(room.state.rematch, [false, false]);
  assert.deepEqual(room.state.game.scores, [0, 0]);
});

test('guest seats use practice teams in owned matches and carry over to Discord', () => {
  const room = new MatchRoom('g_host', 'classic', 'owned', true);
  room.join('111', false);
  assert.equal(room.state.practice[0].length, 3); assert.equal(room.state.practice[1], null);
  assert.equal(room.view('111').practice, null);
  assert.throws(() => room.join('g_guest', true));
  assert.equal(room.claim('222', 'g_unknown'), false);
  assert.equal(room.claim('111', 'g_host'), false); // cannot take both seats
  assert.equal(room.claim('333', 'g_host'), true);
  assert.deepEqual(room.state.players, ['333', '111']);
  assert.equal(room.state.practice[0], null);
  assert.throws(() => room.seat('g_host'));
});
