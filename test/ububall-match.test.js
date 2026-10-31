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
test('Classic, Pulse and Blitz combine independently', () => {
  assert.equal(M.MODES.length,8);
  assert.ok(['standard','classic','blitz','pulse','classic-pulse','classic-blitz','pulse-blitz','classic-pulse-blitz'].every(m=>M.MODES.includes(m)));
  assert.throws(()=>M.rule('blitz-pulse','pulse'));
  assert.equal(M.modeName('standard'),'Ububall'); assert.equal(M.modeName('classic-pulse-blitz'),'Ububall Classic Pulse Blitz');
  assert.equal(M.planningMilliseconds('blitz'),5000); assert.equal(M.planningMilliseconds('pulse-blitz'),5000);
  assert.equal(M.planningMilliseconds('classic-pulse'),null);
  assert.equal(M.turnTicks('standard'),2880); assert.equal(M.turnTicks('classic-pulse'),240);
  const a={}, b={}; M.applyStats(P,a,{impulse:200},'blitz'); M.applyStats(P,b,{impulse:200},'classic-pulse');
  assert.equal(a.impulse,P.IMPULSE*P.multiplier(200)); assert.equal(b.impulse,P.IMPULSE);
});
test('shared meter rules exclude super users and the opposing team', () => {
  const bodies=P.kickoff(); bodies.forEach(b=>b.meter=0); bodies[1].usedSuperThisTurn=true;
  M.gainMeter(P,bodies,[],bodies[0],18);
  assert.equal(bodies[0].meter,18*M.METER.rate); assert.equal(bodies[1].meter,0); assert.equal(bodies[2].meter,18*M.METER.rate*M.METER.teammate); assert.equal(bodies[3].meter,0);
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
  const guarded = moves(); guarded[1].guard = true;
  room.submit('guest', 1, guarded, true, 1200);
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
  // A guarding ubu stays on guard into the next turn.
  assert.deepEqual(room.state.drafts[1].map(p => p.guard), [false, true, false]);
  assert.deepEqual(room.state.drafts[0].map(p => p.guard), [false, false, false]);
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
  // Both asked: back to the lobby with the teams kept but not ready.
  assert.equal(room.state.phase, 'lobby');
  assert.equal(room.state.turn, 1);
  assert.equal(room.state.winner, null);
  assert.equal(room.state.game, null);
  assert.deepEqual(room.state.rematch, [false, false]);
  assert.deepEqual(room.state.ready, [false, false]);
  assert.ok(room.state.rosters.every(Boolean));
  assert.equal(room.state.expires, 2000 + 86400000);
  room.selectTeam('host', room.state.practice[0], hostSupers); room.advance(3000);
  assert.equal(room.state.phase, 'lobby');
  room.selectTeam('guest', room.state.practice[1], guestSupers); room.advance(3000);
  assert.equal(room.state.phase, 'plan');
  assert.deepEqual(room.state.game.scores, [0, 0]);
});

test('MatchRoom lets players change teams before kickoff and leave cleanly', () => {
  const room = new MatchRoom('host', 'standard', 'practice');
  const ubu = require('../shared/ubu.js');
  const supers = i => room.state.practice[i].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  room.join('guest'); room.connect('host', 0); room.connect('guest', 0);
  room.selectTeam('host', room.state.practice[0], supers(0)); room.unready('host');
  room.selectTeam('guest', room.state.practice[1], supers(1)); room.advance(0);
  assert.equal(room.state.phase, 'lobby');
  // A lobby guest leaving frees the seat for someone else.
  room.leave('guest', 0);
  assert.deepEqual(room.state.players, ['host', null]);
  assert.deepEqual(room.state.ready, [false, false]);
  room.join('other'); room.connect('other', 0);
  room.selectTeam('host', room.state.practice[0], supers(0)); room.selectTeam('other', room.state.practice[1], supers(1));
  room.advance(0);
  assert.equal(room.state.phase, 'plan');
  assert.throws(() => room.unready('host'));
  // Leaving mid-match concedes, and no rematch is offered.
  room.leave('other', 1000);
  assert.equal(room.state.phase, 'over'); assert.equal(room.state.winner, 0);
  assert.deepEqual(room.view('host').left, [false, true]);
  assert.throws(() => room.rematch('host', 1000), /left/);
});

test('MatchRoom shows each seat its players\' display names', () => {
  const room = new MatchRoom('host', 'standard', 'practice');
  room.rename('host', '  Saffron  '); room.join('guest'); room.rename('guest', '');
  assert.deepEqual(room.view('guest').names, ['Saffron', null]);
  room.rename('guest', 'x'.repeat(40));
  assert.equal(room.view('host').names[1].length, 32);
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
  const moves=Array.from({length:6},idle); moves[1]={...idle(),power:.5};
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
  const moves=Array.from({length:6},idle); moves[0]={...idle(),power:.5};
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
test('launches steer toward the arrow velocity and cannot exceed full-launch speed', () => {
  const body=P.kickoff()[0]; M.applyStats(P,body,{},'pulse'); const full=body.impulse/body.mass;
  const launch=(angle,power)=>P.launch([body],[{angle,power,spin:0}]);
  launch(0,1); assert.equal(body.vx,full); assert.equal(body.vy,0);
  launch(0,1); assert.equal(body.vx,full); // Repeating a full launch adds nothing.
  launch(Math.PI,1); assert.ok(Math.abs(body.vx)<1e-9); // A full reverse at top speed brakes to a stop.
  body.vx=full; launch(Math.PI/2,1); assert.ok(Math.hypot(body.vx,body.vy)<=full+1e-9); assert.ok(body.vy>0);
  body.vx=2*full; body.vy=0; launch(0,0); assert.equal(body.vx,2*full); // No power coasts.
  launch(0,1); assert.equal(body.vx,full); // Over-speed from a hit is reined in toward the arrow.
});
test('contact meter needs real impacts and cools down so pinging cannot farm it', () => {
  const bodies=P.kickoff(); bodies.forEach(b=>b.meter=0); const [a,mate]=bodies, enemy=bodies[3], ball=bodies[6];
  const {minSpeed,cooldownTicks,rate}=M.METER, award=M.METER.ball*rate, check=M.METER.check*rate;
  M.contactMeter(P,bodies,[],a,ball,minSpeed-1,0); assert.equal(a.meter,0);
  M.contactMeter(P,bodies,[],a,mate,500,0); assert.equal(a.meter,0); // Teammate bumps never count.
  M.contactMeter(P,bodies,[],ball,a,minSpeed,0); assert.equal(a.meter,award); assert.equal(ball.meter,0);
  M.contactMeter(P,bodies,[],a,ball,500,cooldownTicks-1); M.contactMeter(P,bodies,[],a,enemy,500,cooldownTicks-1);
  assert.equal(a.meter,award); assert.equal(enemy.meter,check); // Cooldown covers ball and enemy alike.
  M.contactMeter(P,bodies,[],a,ball,500,cooldownTicks); assert.equal(a.meter,2*award);
});
test('turns earn no meter; conceding a goal earns the conceded bonus', () => {
  const bodies=P.kickoff(); bodies.forEach(b=>b.meter=0);
  M.finishTurn(P,bodies,[],[0,0],null,'standard'); assert.ok(bodies.every(b=>b.meter===0));
  M.finishTurn(P,bodies,[],[0,0],0,'standard');
  assert.ok(bodies.slice(0,3).every(b=>b.meter===0));
  assert.ok(Math.abs(bodies[3].meter-M.METER.conceded*M.METER.rate*(1+2*M.METER.teammate))<1e-9);
});

// `extra` adds match state, such as who is responsible for the ball (`credit`).
function shotState(ball, place = {}, extra = {}) {
  const bodies=P.kickoff(); bodies.slice(0,6).forEach(b=>{P.applyStats(b);b.meter=0;});
  Object.assign(bodies[6],ball);
  for (const [i,at] of Object.entries(place)) Object.assign(bodies[i],at);
  return {version:M.VERSION,mode:'standard',bodies,stats:[],scores:[0,0],turn:1,...extra};
}
const still=()=>({angle:0,power:0,spin:0,superArm:false,guard:false});
test('a goal on the first turn of a round is an ace and earns the scorer extra meter', () => {
  const state=shotState({x:930,y:300,vx:300}); state.lastTouch=[2,null];
  const ace=M.resolveTurn(P,state,Array.from({length:6},still));
  assert.equal(ace.replay.label,'ACE!'); assert.equal(ace.state.roundTurns,0);
  assert.ok(Math.abs(ace.state.bodies[2].meter-M.METER.ace*M.METER.rate)<1e-9);
  assert.ok(Math.abs(ace.state.bodies[0].meter-M.METER.ace*M.METER.rate*M.METER.teammate)<1e-9);
  const later=M.resolveTurn(P,{...structuredClone(state),roundTurns:2},Array.from({length:6},still));
  assert.equal(later.replay.label,'GOAL'); assert.equal(later.state.bodies[2].meter,0);
  const quiet=M.resolveTurn(P,shotState({x:500,y:300}),Array.from({length:6},still));
  assert.equal(quiet.replay.label,null); assert.equal(quiet.state.roundTurns,1);
});
test('a save needs a ball that would have gone in untouched without the saver', () => {
  const blocked=M.resolveTurn(P,shotState({x:260,y:300,vx:-600},{0:{x:130,y:300}},{credit:{3:1}}),Array.from({length:6},still));
  assert.deepEqual(blocked.replay.saves.map(s=>s.index),[0]);
  assert.ok(Math.abs(blocked.state.bodies[0].meter-(M.METER.ball+M.METER.save)*M.METER.rate)<1e-9);
  // Wide of the goal, the boards would have stopped it first.
  const wide=M.resolveTurn(P,shotState({x:260,y:150,vx:-600},{0:{x:130,y:150}}),Array.from({length:6},still));
  assert.deepEqual(wide.replay.saves,[]);
  // A teammate behind would have stopped it anyway.
  const covered=M.resolveTurn(P,shotState({x:260,y:300,vx:-600},{0:{x:150,y:300},1:{x:95,y:300}}),Array.from({length:6},still));
  assert.deepEqual(covered.replay.saves,[]);
  // Too far out to count, though it would have gone in.
  const far=M.resolveTurn(P,shotState({x:500,y:300,vx:-900},{0:{x:400,y:300},3:{x:820,y:120}}),Array.from({length:6},still));
  assert.deepEqual(far.replay.saves,[]);
  // Two ubus meeting the ball in the same tick is a scramble, not a save.
  const lone=M.resolveTurn(P,shotState({x:260,y:300,vx:-600},{0:{x:217.5,y:300}},{credit:{3:1}}),Array.from({length:6},still));
  assert.deepEqual(lone.replay.saves.map(s=>s.index),[0]);
  const scramble=M.resolveTurn(P,shotState({x:260,y:300,vx:-600},{0:{x:217.5,y:300},4:{x:260,y:257.5,vy:300}}),Array.from({length:6},still));
  assert.deepEqual(scramble.replay.saves,[]);
  // Blocking a shot at the opponents' goal is never a save; blocking one at your own is.
  const away=M.resolveTurn(P,shotState({x:260,y:300,vx:600},{0:{x:300,y:100},1:{x:390,y:300}}),Array.from({length:6},still));
  assert.deepEqual(away.replay.saves,[]);
  const own=M.resolveTurn(P,shotState({x:740,y:300,vx:600},{3:{x:870,y:300}}),Array.from({length:6},still));
  assert.deepEqual(own.replay.saves.map(s=>s.index),[3]);
});

test('responsibility stays with the shooter through a glancing deflection and passes on a block', () => {
  const touched=new Set([4]);
  const glance=M.credit({0:1},{vx:-600,vy:0},{vx:-590,vy:60},touched);
  assert.ok(glance[0]>.95 && glance[4]<.05);
  const block=M.credit({0:1},{vx:-600,vy:0},{vx:400,vy:0},touched);
  assert.deepEqual(block,{4:1});
  const bodies=P.kickoff();
  assert.equal(M.responsibleTeam(bodies,glance),0); assert.equal(M.responsibleTeam(bodies,{}),null);
});
test('own goals, bank shots and hat tricks are called, and own-goal saves earn nothing', () => {
  const idle=()=>Array.from({length:6},still);
  // Team 1 last sent the ball toward its own goal.
  const own=M.resolveTurn(P,shotState({x:930,y:300,vx:300},{},{lastTouch:[2,4],credit:{4:1}}),idle());
  assert.equal(own.replay.label,'OWN GOAL'); assert.equal(own.state.bodies[2].meter,0);
  assert.deepEqual(own.state.tally.goals,[0,0,0,0,0,0]);
  const bank=M.resolveTurn(P,shotState({x:930,y:300,vx:300},{},{lastTouch:[2,null],credit:{2:1},banked:true,roundTurns:1}),idle());
  assert.equal(bank.replay.label,'BANK SHOT!');
  const hat=M.resolveTurn(P,shotState({x:930,y:300,vx:300},{},{lastTouch:[2,null],credit:{2:1},tally:{...M.newTally(),goals:[0,0,2,0,0,0]},roundTurns:1}),idle());
  assert.equal(hat.replay.label,'HAT TRICK!'); assert.deepEqual(hat.state.tally.goals,[0,0,3,0,0,0]);
  // The ball comes off the boards, and a later touch would clear it.
  const play=M.newPlay(), bodies=P.kickoff(); Object.assign(bodies[6],{x:500,y:80,vy:-300});
  for(let t=0;t<20;t++) M.playTick(P,bodies,play);
  assert.equal(play.banked,true);
  const ownSave=M.resolveTurn(P,shotState({x:260,y:300,vx:-600},{0:{x:130,y:300}},{credit:{1:1}}),idle());
  assert.deepEqual(ownSave.replay.saves.map(s=>[s.index,s.own]),[[0,true]]);
  assert.ok(Math.abs(ownSave.state.bodies[0].meter-M.METER.ball*M.METER.rate)<1e-9);
});
test('a close-range spin strike is reported for its callout', () => {
  const state=shotState({x:443,y:300},{0:{x:400,y:300}});
  const moves=Array.from({length:6},still); moves[0]={angle:0,power:.6,spin:1,superArm:false,guard:false};
  const result=M.resolveTurn(P,state,moves);
  assert.equal(result.replay.struck.length,1);
  assert.ok(result.state.bodies.every(b=>!b.spinStruck));
});

test('an assist goes to the teammate who passed to the scorer, unless an opponent touched it between', () => {
  const bodies=P.kickoff(); bodies.slice(0,6).forEach(b=>P.applyStats(b));
  bodies.forEach((b,i)=>{ if(i<6) Object.assign(b,{x:100+i*30,y:100}); });
  const play=M.newPlay(), touch=i=>{
    Object.assign(bodies[6],{x:500,y:300,vx:0,vy:0}); Object.assign(bodies[i],{x:457.5,y:300,vx:300,vy:0});
    M.playTick(P,bodies,play); Object.assign(bodies[i],{x:100+i*30,y:100,vx:0,vy:0});
  };
  touch(1); touch(2);
  assert.equal(play.lastTouch[0],2); assert.equal(play.assist[0],1);
  touch(2); assert.equal(play.assist[0],1); // The scorer's own touches keep the pass.
  touch(4); touch(2); assert.equal(play.assist[0],null);
  // Awarded at the goal, with assist meter, and carried in the match state between turns.
  const state=shotState({x:930,y:300,vx:300},{},{lastTouch:[2,null],last:2,assist:[1,null],credit:{2:1},roundTurns:1});
  const result=M.resolveTurn(P,state,Array.from({length:6},still));
  assert.equal(result.replay.assist,1); assert.deepEqual(result.state.tally.assists,[0,1,0,0,0,0]);
  assert.ok(Math.abs(result.state.bodies[1].meter-M.METER.assist*M.METER.rate)<1e-9);
});
test('snipes, rebounds, comebacks, shutouts and huge shots are recognised', () => {
  const idle=()=>Array.from({length:6},still), base={lastTouch:[2,null],last:2,credit:{2:1},roundTurns:1};
  const snipe=M.resolveTurn(P,shotState({x:930,y:300,vx:300},{},{...base,shotX:[420,null]}),idle());
  assert.equal(snipe.replay.label,'SNIPE!');
  const bankedSnipe=M.resolveTurn(P,shotState({x:930,y:300,vx:300},{},{...base,shotX:[420,null],banked:true}),idle());
  assert.equal(bankedSnipe.replay.label,'BANK SHOT!');
  const rebound=M.resolveTurn(P,shotState({x:930,y:300,vx:300},{},{...base,shotX:[900,null],age:100,saved:{at:90,team:1}}),idle());
  assert.equal(rebound.replay.label,'REBOUND!');
  const stale=M.resolveTurn(P,shotState({x:930,y:300,vx:300},{},{...base,shotX:[900,null],age:500,saved:{at:90,team:1}}),idle());
  assert.equal(stale.replay.label,'GOAL');
  const tally=M.newTally();
  for (const scores of [[0,1],[0,2],[0,3],[5,3]]) M.noteScore(tally,scores);
  assert.deepEqual(M.honours(tally,[5,3],0),{comeback:true,shutout:false});
  assert.deepEqual(M.honours(M.newTally(),[5,0],0),{comeback:false,shutout:true});
  const moves=idle(); moves[0]={angle:0,power:1,spin:0,superArm:false,guard:false};
  const blast=M.resolveTurn(P,shotState({x:343,y:300},{0:{x:300,y:300}}),moves);
  assert.ok(blast.state.tally.topSpeed[0]>P.MAX_SPEED);
});
test('a touch is only a save if the ball then stays out of the goal', () => {
  const keeper=y=>M.resolveTurn(P,shotState({x:800,y,vx:700},{3:{x:905,y:300}},{credit:{0:1}}),Array.from({length:6},still));
  const deflected=keeper(250);
  assert.equal(deflected.replay.goal,0); assert.deepEqual(deflected.replay.saves,[]);
  assert.equal(deflected.state.tally.saves[3],0);
  assert.deepEqual(keeper(300).replay.saves.map(s=>s.index),[3]);
});
test('hit-stop comes from the hitting ubu, longer for shots that travel or head into goal', () => {
  const shoot=(angle,power,place)=>{
    const moves=Array.from({length:6},still); moves[0]={angle,power,spin:0,superArm:false,guard:false};
    return M.resolveTurn(P,shotState({x:300+43*Math.cos(angle),y:300+43*Math.sin(angle)},{0:{x:300,y:300},...place}),moves).replay.stops;
  };
  // Straight at the far goal: its own path goes in, whoever is in the way.
  assert.deepEqual(shoot(0,1)[0],{tick:1,ms:M.HIT_STOP.goal});
  // Off the boards and a long way untouched.
  const away={3:{x:820,y:540},4:{x:690,y:540},5:{x:690,y:540}};
  assert.equal(shoot(-1.2,1,{1:{x:310,y:540},2:{x:310,y:540},...away})[0].ms,M.HIT_STOP.long);
  // Straight into a nearby ubu: a big shot, but stopped at once.
  assert.equal(shoot(-1.2,1,{1:{x:345,y:150}})[0].ms,M.HIT_STOP.hit);
  // A soft touch is not a big shot.
  assert.deepEqual(shoot(0,.5).filter(s=>s.tick===1),[]);
  // A fast ball off a still ubu is not a big shot either.
  const ping=M.resolveTurn(P,shotState({x:400,y:200,vx:1000},{3:{x:520,y:200}}),Array.from({length:6},still));
  assert.deepEqual(ping.replay.stops,[]);
});

test('resolving a turn without presentation effects gives the same match state', () => {
  const moves=Array.from({length:6},(_,i)=>({angle:i<3?0:Math.PI,power:1,spin:.6,superArm:false,guard:false}));
  const state=shotState({x:343,y:300},{0:{x:300,y:300}});
  const full=M.resolveTurn(P,state,moves), fast=M.resolveTurn(P,state,moves,{effects:false});
  assert.deepEqual(fast.state,full.state); assert.equal(fast.replay.goal,full.replay.goal);
  assert.ok(full.replay.stops.length>0); assert.deepEqual(fast.replay.stops,[]); assert.equal(fast.replay.initialBodies,null);
});

test('super stats swing meter gain harder than other stats', () => {
  const gained = efficiency => { const bodies=P.kickoff(); bodies.forEach(b=>b.meter=0); M.gainMeter(P,bodies,[{efficiency}],bodies[0],10); return bodies[0].meter; };
  assert.ok(Math.abs(gained(255)-10*M.METER.rate*2.25)<1e-9 && Math.abs(gained(0)-10*M.METER.rate*4/9)<1e-9);
  const shared = (synergy, chemistry) => { const bodies=P.kickoff(); bodies.forEach(b=>b.meter=0); M.gainMeter(P,bodies,[{synergy},{chemistry}],bodies[0],10); return bodies[1].meter; };
  assert.ok(Math.abs(shared(255,255)-10*M.METER.rate*M.METER.teammate*2.25**2)<1e-9);
});

test('a Cannonball hit always earns big-shot hit-stop', () => {
  const state=shotState({x:343,y:300},{0:{x:300,y:300}});
  state.bodies[0].superActive='cannonball'; state.bodies[0].superTicks=P.SUPER.ticks;
  const moves=Array.from({length:6},still); moves[0]={angle:0,power:.4,spin:0,superArm:false,guard:false};
  const plain=M.resolveTurn(P,shotState({x:343,y:300},{0:{x:300,y:300}}),moves);
  // The soft shot itself earns no pause; the Cannonball version pauses on the hit.
  const first=r=>r.replay.stops[0]?.tick ?? Infinity, cannon=M.resolveTurn(P,state,moves);
  assert.ok(first(cannon)<first(plain) && cannon.replay.stops[0].ms>=M.HIT_STOP.hit);
});
// Fouls: places ubus (by index) and the ball, then ends a quiet turn.
function foulTurn(fouls, place, ball = {x:500,y:300}) {
  const bodies=P.kickoff(); bodies.slice(0,6).forEach(b=>{P.applyStats(b);b.meter=100;});
  Object.assign(bodies[6],ball);
  for (const [i,at] of Object.entries(place)) Object.assign(bodies[i],at);
  M.finishTurn(P,bodies,[],[0,0],null,'standard',{},fouls);
  return bodies;
}
test('goal camping warns a crowded crease, then cards its defenders if it stays crowded', () => {
  const fouls=M.newFouls(), crowd={0:{x:80,y:270},1:{x:80,y:330}};
  // A lone goalie is fine, and each attacker past the zone line (crease or not) allows a defender.
  foulTurn(fouls,{0:{x:80,y:300}}); assert.deepEqual(fouls.crease,[false,false]);
  foulTurn(fouls,{...crowd,3:{x:160,y:150},4:{x:165,y:450}}); assert.deepEqual(fouls.crease,[false,false]);
  foulTurn(fouls,{...crowd,3:{x:160,y:150},4:{x:200,y:450}}); assert.deepEqual(fouls.crease,[true,false]);
  M.lapseFouls(P,foulTurn(M.newFouls(),{}),fouls); assert.deepEqual(fouls.crease,[false,false]);
  // Only a ubu with its centre in the crease counts.
  foulTurn(fouls,{0:{x:80,y:300},1:{x:150,y:300}}); assert.deepEqual(fouls.crease,[false,false]);
  foulTurn(fouls,crowd); assert.deepEqual(fouls.crease,[true,false]); assert.deepEqual(fouls.cards,[]);
  // Fully leaving clears the warning.
  foulTurn(fouls,{0:{x:80,y:300}}); assert.deepEqual(fouls.crease,[false,false]);
  foulTurn(fouls,crowd);
  const bodies=foulTurn(fouls,{...crowd,2:{x:120,y:300}});
  assert.deepEqual(fouls.cards,[0,1,2]); assert.deepEqual(fouls.crease,[false,false]);
  for (const i of [0,1,2]) {
    const b=bodies[i]; assert.deepEqual({x:b.x,y:b.y},P.spawn(0,i));
    assert.equal(b.meter,0); assert.ok(b.carded && b.stunned); assert.ok(!M.inCrease(P,b,0));
  }
  // The card lasts one turn.
  M.finishTurn(P,bodies,[],[0,0],null,'standard',{},fouls); assert.ok(bodies.every(b=>!b.carded));
});
test('corner stalling warns after four turns, then cards the larger team there and resets the ball', () => {
  const fouls=M.newFouls(), corner={x:90,y:90}, place={0:{x:120,y:75},3:{x:75,y:125},4:{x:135,y:130}};
  for (let n=1;n<=4;n++) { foulTurn(fouls,place,corner); assert.equal(fouls.cornerTurns,n); }
  assert.equal(fouls.corner,0); assert.ok(!fouls.faceoff);
  // The ball leaving its corner during play ends the count at once.
  const lapsed=structuredClone(fouls); M.lapseFouls(P,P.kickoff(),lapsed); assert.equal(lapsed.corner,null); assert.equal(lapsed.cornerTurns,0);
  const bodies=foulTurn(fouls,{...place,0:{x:500,y:300}},corner);
  assert.ok(fouls.faceoff); assert.deepEqual(fouls.cards,[3,4]); assert.equal(fouls.corner,null);
  // Centre ice was taken, so the ball sits at the nearest clear spot on the centre line.
  assert.equal(bodies[6].x,500); assert.equal(bodies[6].y,240); assert.ok(!bodies[0].carded);
  // An even corner cards nobody; moving the ball to another corner restarts the count.
  const tie=M.newFouls();
  for (let n=0;n<5;n++) foulTurn(tie,{0:{x:120,y:75},3:{x:75,y:125}},corner);
  assert.ok(tie.faceoff); assert.deepEqual(tie.cards,[]);
  const moved=M.newFouls(); for (let n=0;n<3;n++) foulTurn(moved,{},corner);
  foulTurn(moved,{},{x:910,y:510}); assert.equal(moved.corner,3); assert.equal(moved.cornerTurns,1);
});
test('a camping warning lapses during play once a defender leaves the crease, and the turn end only warns again', () => {
  const state=shotState({x:500,y:300},{0:{x:80,y:270},1:{x:80,y:330}},{fouls:{...M.newFouls(),crease:[true,false]}});
  const leave={angle:0,power:1,spin:0,superArm:false,guard:false};
  // One leaves; the warning lapses and nobody is carded.
  const left=M.resolveTurn(P,state,[still(),leave,still(),still(),still(),still()]).state;
  assert.deepEqual(left.fouls.crease,[false,false]); assert.deepEqual(left.fouls.cards,[]);
  // Staying put keeps the warning, and the turn end cards both.
  const stayed=M.resolveTurn(P,state,Array.from({length:6},still)).state;
  assert.deepEqual(stayed.fouls.cards,[0,1]); assert.deepEqual(stayed.tally.cards,[1,1,0,0,0,0]);
  // Lapsed during play then crowded again by the turn's end: a fresh warning, not a card.
  const fouls={...M.newFouls(),crease:[true,false]}; M.lapseFouls(P,P.kickoff(),fouls);
  foulTurn(fouls,{0:{x:80,y:270},1:{x:80,y:330}}); assert.deepEqual(fouls.crease,[true,false]); assert.deepEqual(fouls.cards,[]);
});
test('a carded ubu touches nothing, and a corner reset starts a fresh play', () => {
  const bodies=P.kickoff(); bodies.slice(0,6).forEach(b=>P.applyStats(b));
  Object.assign(bodies[0],{x:400,y:300,carded:true}); Object.assign(bodies[6],{x:460,y:300,vx:-600});
  for (let t=0;t<80;t++) P.step(bodies,P.DT);
  assert.ok(bodies[6].x<330); assert.equal(bodies[0].x,400);
  const state=shotState({x:90,y:90},{3:{x:120,y:75}},{fouls:{...M.newFouls(),corner:0,cornerTurns:4},lastTouch:[null,3],credit:{3:1}});
  const next=M.resolveTurn(P,state,Array.from({length:6},still)).state;
  assert.ok(next.fouls.faceoff); assert.deepEqual(next.fouls.cards,[3]);
  assert.deepEqual(next.lastTouch,[null,null]); assert.deepEqual(next.credit,{});
});
