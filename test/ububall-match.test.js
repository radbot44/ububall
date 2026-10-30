const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../shared/ububall-match.js');
const P = require('../web/ububall-physics.js');
test('network move validation rejects forged state and non-finite or out-of-range moves', () => {
  const moves = () => Array.from({length:3}, () => ({angle:0,power:.5,spin:0,superArm:false,guard:false}));
  assert.equal(M.validatePlans(moves()).length,3);
  for(const patch of [{power:2},{spin:NaN},{angle:Infinity},{meter:100},{superArm:1},{guard:undefined}]) {
    const input=moves(); Object.assign(input[0],patch); assert.throws(()=>M.validatePlans(input));
  }
  assert.throws(()=>M.validatePlans([]));
  const guarded=moves(); Object.assign(guarded[0],{guard:true,spin:.5});
  assert.deepEqual(M.validatePlans(guarded)[0],{angle:0,power:0,spin:0,superArm:false,guard:true});
});
test('Classic, Blitz and Pulse combine independently', () => {
  assert.equal(M.MODES.length,8);
  assert.ok(['standard','classic','blitz','pulse','classic-blitz','classic-pulse','blitz-pulse','classic-blitz-pulse'].every(m=>M.MODES.includes(m)));
  assert.throws(()=>M.rule('pulse-classic','pulse'));
  assert.equal(M.modeName('standard'),'Ububall'); assert.equal(M.modeName('classic-blitz-pulse'),'Ububall Classic Blitz Pulse');
  assert.equal(M.planningMilliseconds('blitz'),5000); assert.equal(M.planningMilliseconds('blitz-pulse'),5000);
  assert.equal(M.planningMilliseconds('classic-pulse'),null);
  assert.equal(M.turnTicks('standard'),2880); assert.equal(M.turnTicks('classic-pulse'),240);
  const a={}, b={}; M.applyStats(P,a,{impulse:200},'blitz'); M.applyStats(P,b,{impulse:200},'classic-pulse');
  assert.equal(a.impulse,P.IMPULSE*P.multiplier(200)); assert.equal(b.impulse,P.IMPULSE/2);
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
  const moves=Array.from({length:3},()=>({angle:0,power:.8,spin:0,superArm:false,guard:false}));
  room.submit('host',1,moves,false,1000);
  assert.equal(room.view('guest').moves[0].power,0);
  assert.throws(()=>room.view('stranger'));
  room.disconnect('guest',2000); assert.equal(room.state.remaining,3000);
  assert.equal(room.takeTurn(50000),null);
  room.connect('guest',50000); assert.equal(room.state.deadline,53000);
  assert.equal(room.takeTurn(52999),null);
  const turn=room.takeTurn(53000); assert.equal(turn[0].power,.8); assert.equal(turn[3].power,0);
  assert.equal(room.takeTurn(53001),null);
  assert.throws(()=>room.submit('host',1,moves,true,53001));
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
  const moves = () => Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false }));
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
  const state={version:M.VERSION,mode:'standard',bodies,stats:Array.from({length:6},()=>({})),scores:[0,0],turn:1};
  const moves=Array.from({length:6},(_,i)=>({angle:i<3?0:Math.PI,power:.8,spin:.3,superArm:false,guard:false}));
  const original=structuredClone(state), first=M.resolveTurn(P,state,moves);
  assert.deepEqual(state,original);assert.deepEqual(first,M.resolveTurn(P,state,moves));
  assert.ok(first.replay.ticks<=2880);assert.equal(first.replay.initialBodies.length,7);
  assert.equal(first.state.turn,2);assert.doesNotThrow(()=>JSON.stringify(first));
  moves[0].superArm=true;assert.throws(()=>M.resolveTurn(P,state,moves));
});
test('goal resolution awards victory once', () => {
  const bodies=P.kickoff();bodies.slice(0,6).forEach(b=>{P.applyStats(b);b.meter=0;});
  Object.assign(bodies[6],{x:959,y:300,vx:400});
  const state={version:M.VERSION,mode:'classic',bodies,stats:[],scores:[4,0],turn:4};
  const moves=Array.from({length:6},()=>({angle:0,power:0,spin:0,superArm:false,guard:false}));
  const result=M.resolveTurn(P,state,moves);
  assert.equal(result.state.winner,0);assert.deepEqual(result.state.scores,[5,0]);
  assert.equal(result.state.phase,'over');assert.ok(result.state.bodies.slice(0,6).every(b=>b.meter===0));
});

test('authoritative supers consume meter and preserve the no-gain rule through settlement', () => {
  for (const { key } of P.SUPERS) {
    const bodies=P.kickoff();bodies.slice(0,6).forEach(b=>{P.applyStats(b);b.meter=100;});
    bodies[0].equippedSuper={key};
    const state={version:M.VERSION,mode:'standard',bodies,stats:[],scores:[0,0],turn:1};
    const moves=Array.from({length:6},(_,i)=>({angle:0,power:i===0?.7:0,spin:.4,superArm:i===0,guard:false}));
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

function pulseState(mode) {
  const bodies=P.kickoff(); bodies.slice(0,6).forEach(b=>{M.applyStats(P,b,{},mode);b.meter=0;});
  return {version:M.VERSION,mode,bodies,stats:[],scores:[0,0],turn:1};
}
const idle=()=>({angle:0,power:0,spin:0,superArm:false,guard:false});
test('Pulse turns stop after one second and carry momentum into the next turn', () => {
  const moves=Array.from({length:6},idle); moves[1]={...idle(),power:1};
  const start=pulseState('pulse'); start.bodies[4].y=500; // Clear the lane ahead.
  const pulse=M.resolveTurn(P,start,moves);
  assert.equal(pulse.replay.ticks,240); assert.equal(pulse.state.phase,'plan');
  const moving=pulse.state.bodies[1]; assert.ok(moving.vx>100);
  const coast=M.resolveTurn(P,pulse.state,Array.from({length:6},idle));
  assert.ok(coast.state.bodies[1].x>moving.x+50);
  const boost=M.resolveTurn(P,pulse.state,moves);
  assert.ok(boost.state.bodies[1].x>coast.state.bodies[1].x+50);
  const flat=pulseState('standard'); flat.bodies[4].y=500;
  const standard=M.resolveTurn(P,flat,moves);
  assert.ok(standard.replay.ticks>240); assert.equal(standard.state.bodies[1].vx,0);
  assert.ok(standard.replay.initialBodies[1].impulse===2*pulse.replay.initialBodies[1].impulse);
});
test('guard is explicit and brakes a moving ubu', () => {
  const state=pulseState('pulse'); Object.assign(state.bodies[1],{vx:300,vy:-200});
  const guard=Array.from({length:6},idle); guard[1].guard=true;
  const bodies=structuredClone(state.bodies); P.startTurn(bodies,guard);
  assert.equal(bodies[1].guarding,true); assert.equal(bodies[1].vx,75); assert.equal(bodies[1].vy,-50);
  const coasting=structuredClone(state.bodies); P.startTurn(coasting,Array.from({length:6},idle));
  assert.equal(coasting[1].guarding,false); assert.equal(coasting[1].vx,300);
});
test('a Pulse goal credits the last toucher from an earlier turn', () => {
  const state=pulseState('pulse'); state.lastTouch=[2,null];
  Object.assign(state.bodies[6],{x:930,y:300,vx:300});
  const result=M.resolveTurn(P,state,Array.from({length:6},idle));
  assert.equal(result.replay.goal,0); assert.equal(result.replay.scorer,2);
  assert.deepEqual(result.state.lastTouch,[null,null]);
});
test('goal replays re-simulate a chained Pulse play exactly and ease to half speed', () => {
  let state=pulseState('pulse'); state.bodies[3].y=520; state.bodies[4].y=500; Object.assign(state.bodies[6],{x:420,y:300});
  const moves=Array.from({length:6},idle); moves[0]={...idle(),power:1};
  const segments=[];
  for (let turn=0; turn<20 && state.phase!=='goal'; turn++) {
    const result=M.resolveTurn(P,state,turn<2?moves:Array.from({length:6},idle));
    segments.push(JSON.parse(JSON.stringify(result.replay))); state=result.state;
  }
  assert.equal(state.phase,'goal'); assert.ok(segments.length>1);
  let goal=null;
  for (const segment of segments) {
    const sim=structuredClone(segment.initialBodies); P.startTurn(sim,segment.plans);
    for (let tick=0; tick<segment.ticks; tick++) goal=P.step(sim,P.DT);
  }
  assert.equal(goal,segments.at(-1).goal);
  assert.equal(M.replaySpeed(500),1); assert.equal(M.replaySpeed(240),1); assert.equal(M.replaySpeed(40),.5);
  assert.ok(M.replaySpeed(150)>.5 && M.replaySpeed(150)<1);
  const ms=M.replayMilliseconds(P,480)-M.GOAL_REPLAY_DELAY-M.GOAL_REPLAY_HOLD;
  assert.ok(ms>2000 && ms<3000);
});
