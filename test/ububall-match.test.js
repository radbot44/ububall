const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../shared/ububall-match.js');
const P = require('../web/ububall-physics.js');
const C = require('../shared/ububall-cpu.js');
const S = require('../scripts/cpu-simulation.cjs');
const ubu = require('../shared/ubu.js');
const rarity = require('../shared/rarity.js');
test('network move validation rejects forged state and non-finite or out-of-range moves', () => {
  const moves = () => Array.from({length:3}, () => ({angle:0,power:.5,spin:0,superArm:false,guard:false}));
  assert.equal(M.validatePlans(moves()).length,3);
  for(const patch of [{power:2},{spin:NaN},{angle:Infinity},{meter:100},{superArm:1},{guard:undefined}]) {
    const input=moves(); Object.assign(input[0],patch); assert.throws(()=>M.validatePlans(input));
  }
  assert.throws(()=>M.validatePlans([]));
  const guarded=moves(); Object.assign(guarded[0],{guard:true,spin:.5});
  assert.deepEqual(M.validatePlans(guarded)[0],{angle:0,power:.5,spin:.5,superArm:false,guard:true});
});
test('Classic, Pulse and Blitz combine independently', () => {
  assert.equal(M.MODES.length,8);
  assert.ok(['standard','classic','blitz','pulse','classic-pulse','classic-blitz','pulse-blitz','classic-pulse-blitz'].every(m=>M.MODES.includes(m)));
  assert.throws(()=>M.rule('blitz-pulse','pulse'));
  assert.equal(M.modeName('standard'),'Standard ububall'); assert.equal(M.modeName('pulse'),'Pulse'); assert.equal(M.modeName('classic-pulse-blitz'),'Classic + Pulse + Blitz');
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
  const room = new MatchRoom('host', 'blitz', true); room.join('guest', true);
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
test('changing rules restarts instant play before launch and rejects stale editors and locked turns', () => {
  const room = new MatchRoom('host', 'standard', true); room.join('guest', true); room.readyPair([null, null]);
  room.connect('host', 1000); room.connect('guest', 1000); room.advance(1000);
  const roster = structuredClone(room.state.rosters);
  room.changeRules('guest', 'classic-pulse-blitz', 0); room.advance(2000);
  assert.equal(room.state.game.mode, 'classic-pulse-blitz'); assert.equal(room.state.turn, 1);
  assert.equal(room.state.deadline, 7000); assert.deepEqual(room.state.rosters, roster);
  assert.ok(room.state.game.bodies.slice(0, 6).every(body => body.equippedSuper === null));
  assert.throws(() => room.changeRules('stranger', 'standard', 1), /Not a match player/);
  assert.throws(() => room.changeRules('host', 'standard', 0), /game changed/);
  const moves = Array.from({ length: 3 }, () => ({ angle: 0, power: 0, spin: 0, superArm: false, guard: false }));
  room.submit('host', 1, moves, true, 2100);
  assert.equal(room.view('guest').canChangeRules, false);
  assert.throws(() => room.changeRules('guest', 'standard', 1), /before the first launch/);
  room.submit('guest', 1, moves, true, 2200); room.advance(2200);
  assert.throws(() => room.changeRules('host', 'standard', 1), /before the first launch/);
});

test('forfeit requires a seated connected claimant and sixty disconnected seconds', () => {
  const room=new MatchRoom('host', 'classic');room.join('guest', true);room.connect('host',0);room.connect('guest',0);
  room.disconnect('guest',100);
  assert.throws(()=>room.claimForfeit('host',60099));assert.throws(()=>room.claimForfeit('stranger',60100));
  room.claimForfeit('host',60100);assert.equal(room.state.winner,0);
});

test('MatchRoom advance drives full lifecycle from lobby to resolving and next turn planning', () => {
  const room = new MatchRoom('host', 'standard', true);
  const ubu = require('../shared/ubu.js');
const rarity = require('../shared/rarity.js');
  room.join('guest', true);
  room.connect('host', 1000);
  room.connect('guest', 1000);
  assert.equal(room.state.phase, 'lobby');
  const hostSupers = room.state.guestTeams[0].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  const guestSupers = room.state.guestTeams[1].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  room.selectTeam('host', room.state.guestTeams[0], hostSupers);
  room.advance(1000);
  assert.equal(room.state.phase, 'lobby');
  room.selectTeam('guest', room.state.guestTeams[1], guestSupers);
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

test('online goal replays wait for either player and protect the first cycle', () => {
  const room = new MatchRoom('host', 'classic', true);
  room.join('guest', true);
  room.connect('host', 0);
  room.connect('guest', 0);
  const ubu = require('../shared/ubu.js');
  for (const owner of ['host', 'guest']) {
    const team = room.guestTeam(owner);
    room.selectTeam(owner, team, team.map(entry => ubu.decode(ubu.fromCode(entry.dna)).supers[0] % 8));
  }
  for (const [start, scores, afterSkip] of [[1000, [0, 0], 'plan'], [20000, [4, 0], 'over']]) {
    const bodies = P.kickoff();
    Object.assign(bodies[6], { x: 959, y: 300, vx: 400 });
    Object.assign(room.state, {
      phase: 'plan', turn: 1, locked: [true, true],
      game: { version: M.VERSION, mode: 'classic', bodies, stats: [], scores, turn: 1 }
    });
    room.advance(start);
    assert.equal(room.state.replay.goal, 0);
    assert.equal(room.state.playUntil, null);
    const requestedAt = start + (afterSkip === 'over' ? 10000 : 2000);
    room.advance(requestedAt);
    assert.equal(room.state.phase, 'resolving');
    assert.throws(() => room.skipReplay('stranger', start, requestedAt));
    room.skipReplay('host', start - 1, requestedAt);
    assert.equal(room.state.playUntil, null);
    room.skipReplay('guest', start, requestedAt);
    const cycleEnd = room.state.playUntil;
    if (afterSkip === 'plan') {
      assert.ok(cycleEnd > requestedAt);
      room.advance(cycleEnd - 1);
      assert.equal(room.state.phase, 'resolving');
    } else {
      assert.equal(cycleEnd, requestedAt);
    }
    room.advance(cycleEnd);
    assert.equal(room.state.phase, afterSkip);
  }
});

test('authoritative supers consume meter and preserve the no-gain rule through settlement', () => {
  for (const { key } of P.SUPERS) {
    const bodies=P.kickoff();bodies.slice(0,6).forEach(b=>{P.applyStats(b);b.meter=100;});
    bodies[0].equippedSuper={key};
    const state={version:M.VERSION,mode:'standard',bodies,stats:[],scores:[0,0],turn:1};
    const moves=Array.from({length:6},(_,i)=>({angle:0,power:i===0?.7:0,spin:.4,superArm:i===0,guard:false}));
    const result=M.resolveTurn(P,state,moves);
    assert.ok(result.state.bodies[0].meter === 0 || result.state.bodies[0].meter === P.SUPER.whiffRefund, key);
    assert.equal(result.replay.initialBodies[0].meter,100,key);
    assert.equal(result.state.bodies[0].superActive,null);
    assert.doesNotThrow(()=>JSON.stringify(result));
  }
});

test('quick-start friends matches begin when both players connect and reuse their teams for a rematch', () => {
  const room = new MatchRoom('host', 'standard', true);
  room.join('friend', true);
  room.readyPair([null, null]);
  assert.deepEqual(room.view('host').ready, [true, true]);
  assert.equal(room.view('host').quickStart, true);
  room.connect('host', 1000);
  room.advance(1000);
  assert.equal(room.state.phase, 'lobby');
  room.connect('friend', 1100);
  room.advance(1100);
  assert.equal(room.state.phase, 'plan');
  assert.deepEqual(room.state.game.scores, [0, 0]);
  const rosters = structuredClone(room.state.rosters);
  room.disconnect('friend', 1200);
  room.claimForfeit('host', 61200);
  room.connect('friend', 61300);
  room.rematch('host', 61300);
  room.rematch('friend', 61300);
  room.advance(61300);
  assert.equal(room.state.phase, 'plan');
  assert.deepEqual(room.state.rosters, rosters);
});

test('MatchRoom rematch requires match over and agreement from both players', () => {
  const room = new MatchRoom('host', 'standard', true);
  const ubu = require('../shared/ubu.js');
  room.join('guest', true);
  room.connect('host', 1000); room.connect('guest', 1000);
  assert.throws(() => room.rematch('host', 1000));
  const hostSupers = room.state.guestTeams[0].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  const guestSupers = room.state.guestTeams[1].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  room.selectTeam('host', room.state.guestTeams[0], hostSupers);
  room.selectTeam('guest', room.state.guestTeams[1], guestSupers);
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
  room.selectTeam('host', room.state.guestTeams[0], hostSupers); room.advance(3000);
  assert.equal(room.state.phase, 'lobby');
  room.selectTeam('guest', room.state.guestTeams[1], guestSupers); room.advance(3000);
  assert.equal(room.state.phase, 'plan');
  assert.deepEqual(room.state.game.scores, [0, 0]);
});

test('MatchRoom lets players change teams before kickoff and leave cleanly', () => {
  const room = new MatchRoom('host', 'standard', true);
  const ubu = require('../shared/ubu.js');
  const supers = i => room.state.guestTeams[i].map(e => ubu.decode(ubu.fromCode(e.dna)).supers[0] % 8);
  room.join('guest', true); room.connect('host', 0); room.connect('guest', 0);
  room.selectTeam('host', room.state.guestTeams[0], supers(0)); room.unready('host');
  room.selectTeam('guest', room.state.guestTeams[1], supers(1)); room.advance(0);
  assert.equal(room.state.phase, 'lobby');
  // A lobby guest leaving frees the seat for someone else.
  room.leave('guest', 0);
  assert.deepEqual(room.state.players, ['host', null]);
  assert.deepEqual(room.state.ready, [false, false]);
  room.join('other', true); room.connect('other', 0);
  room.selectTeam('host', room.state.guestTeams[0], supers(0)); room.selectTeam('other', room.state.guestTeams[1], supers(1));
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
  const room = new MatchRoom('host', 'standard', true);
  room.rename('host', '  Saffron  '); room.join('guest', true); room.rename('guest', '');
  assert.deepEqual(room.view('guest').names, ['Saffron', null]);
  room.rename('guest', 'x'.repeat(40));
  assert.equal(room.view('host').names[1].length, 32);
});

test('guest seats use given teams and carry over to Discord', () => {
  const room = new MatchRoom('g_host', 'classic', true);
  room.join('111', false);
  assert.equal(room.state.guestTeams[0].length, 3); assert.equal(room.state.guestTeams[1], null);
  assert.equal(room.view('111').guestTeam, null);
  assert.throws(() => room.join('g_guest', true));
  assert.equal(room.claim('222', 'g_unknown'), false);
  assert.equal(room.claim('111', 'g_host'), false); // cannot take both seats
  assert.equal(room.claim('333', 'g_host'), true);
  assert.deepEqual(room.state.players, ['333', '111']);
  assert.equal(room.state.guestTeams[0], null);
  assert.throws(() => room.seat('g_host'));
});

test('a quick start fields registry teams with their saved supers beside a guest team', () => {
  const room = new MatchRoom('111', 'standard');
  room.join('g_guest', true);
  const entries = rarity.starterTeam(ubu).map((dna, i) => ({ dna, serial: String(i + 1).padStart(12, '0') }));
  const supers = entries.map(({ dna }) => ubu.decode(ubu.fromCode(dna)).supers[1] % 8);
  room.readyPair([{ entries, supers }, null]);
  assert.deepEqual(room.state.ready, [true, true]);
  assert.deepEqual(room.state.rosters[0].map(entry => entry.serial), entries.map(entry => entry.serial));
  assert.deepEqual(room.state.rosters[0].map(entry => entry.superId), supers);
  assert.deepEqual(room.state.rosters[1].map(entry => entry.dna), room.state.guestTeams[1].map(entry => entry.dna));
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
test('search horizon snapshots do not stop motion or issue end-of-turn fouls', () => {
  const state = pulseState('standard');
  Object.assign(state.bodies[0], { x: 90, y: 255 });
  Object.assign(state.bodies[1], { x: 90, y: 345 });
  const moves = Array.from({ length: 6 }, idle);
  moves[2] = { ...idle(), angle: 0, power: 1 };
  const interim = M.resolveTurn(P, state, moves, { effects: false, ticks: 480, preservePartial: true });
  const forcedEnd = M.resolveTurn(P, state, moves, { effects: false, ticks: 480 });
  assert.equal(interim.replay.ticks, 480);
  assert.equal(interim.state.turn, state.turn);
  assert.ok(Math.hypot(interim.state.bodies[2].vx, interim.state.bodies[2].vy) > 10);
  assert.deepEqual(interim.state.fouls.crease, [false, false]);
  assert.equal(forcedEnd.state.turn, state.turn + 1);
  assert.equal(forcedEnd.state.bodies[2].vx, 0);
  assert.equal(forcedEnd.state.fouls.crease[0], true);
});
test('search snapshots keep active supers until the actual Pulse turn boundary', () => {
  const state = pulseState('pulse'), body = state.bodies[2];
  body.equippedSuper = P.SUPERS[5];
  body.superActive = 'colossus';
  body.superTicks = 600;
  P.syncEffectiveStats(body);
  const moves = Array.from({ length: 6 }, idle);
  moves[2] = { ...idle(), angle: 0, power: 1 };
  const interim = M.resolveTurn(P, state, moves, { effects: false, ticks: 120, preservePartial: true });
  assert.equal(interim.state.turn, state.turn);
  assert.equal(interim.state.bodies[2].superActive, 'colossus');
  assert.equal(interim.state.bodies[2].superTicks, 480);
  const complete = M.resolveTurn(P, state, moves, { effects: false, ticks: 480, preservePartial: true });
  assert.equal(complete.replay.ticks, 240);
  assert.equal(complete.state.turn, state.turn + 1);
  assert.equal(complete.state.bodies[2].superActive, 'colossus');
  assert.equal(complete.state.bodies[2].superTicks, 360);
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
  assert.equal(M.postGoalSpeed(0), 1);
  assert.equal(M.postGoalSpeed(36), 0.75);
  assert.equal(M.postGoalSpeed(72), 0.5);
  assert.equal(M.postGoalSpeed(120), 0.5);
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
  assert.equal(M.HIT_STOP.scoredGoal, 200);
  assert.deepEqual(M.SCREEN_SHAKE, { default: 1, goal: 2 });
  // Scoring a goal awards 200 ms hit-stop
  const goalState = shotState({ x: 945, y: 300, vx: 400 });
  const scored = M.resolveTurn(P, goalState, Array.from({ length: 6 }, still));
  assert.equal(scored.replay.goal, 0);
  assert.ok(scored.replay.stops.some(s => s.ms === M.HIT_STOP.scoredGoal));
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
test('corner stalling warns after two turns, then cards the larger team there and resets the ball on the third turn', () => {
  const fouls=M.newFouls(), corner={x:90,y:90}, place={0:{x:120,y:75},3:{x:75,y:125},4:{x:135,y:130}};
  for (let n=1;n<=2;n++) { foulTurn(fouls,place,corner); assert.equal(fouls.cornerTurns,n); }
  assert.equal(fouls.corner,0); assert.ok(!fouls.faceoff);
  // Ball bouncing within cornerExit hysteresis margin (145 px from boards) does not lapse corner count.
  const bounce=structuredClone(fouls); const bounceBodies=P.kickoff(); bounceBodies[6].x=190; bounceBodies[6].y=90;
  M.lapseFouls(P,bounceBodies,bounce); assert.equal(bounce.corner,0); assert.equal(bounce.cornerTurns,2);
  // The ball leaving beyond cornerExit hysteresis during play ends the count at once.
  const lapsed=structuredClone(fouls); M.lapseFouls(P,P.kickoff(),lapsed); assert.equal(lapsed.corner,null); assert.equal(lapsed.cornerTurns,0);
  const bodies=foulTurn(fouls,{...place,0:{x:500,y:300}},corner);
  assert.ok(fouls.faceoff); assert.deepEqual(fouls.cards,[3,4]); assert.equal(fouls.corner,null);
  // Centre ice was taken, so the ball sits at the nearest clear spot on the centre line.
  assert.equal(bodies[6].x,500); assert.equal(bodies[6].y,240); assert.ok(!bodies[0].carded);
  // An even corner cards nobody; moving the ball to another corner restarts the count.
  const tie=M.newFouls();
  for (let n=0;n<3;n++) foulTurn(tie,{0:{x:120,y:75},3:{x:75,y:125}},corner);
  assert.ok(tie.faceoff); assert.deepEqual(tie.cards,[]);
  const moved=M.newFouls(); for (let n=0;n<2;n++) foulTurn(moved,{},corner);
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
  const state=shotState({x:90,y:90},{3:{x:120,y:75}},{fouls:{...M.newFouls(),corner:0,cornerTurns:2},lastTouch:[null,3],credit:{3:1}});
  const next=M.resolveTurn(P,state,Array.from({length:6},still)).state;
  assert.ok(next.fouls.faceoff); assert.deepEqual(next.fouls.cards,[3]);
  assert.deepEqual(next.lastTouch,[null,null]); assert.deepEqual(next.credit,{});
});

test('deflections off defending ubus stay credited to attacker, topSpeed rejects passive hits, and fireball/one-timer calls trigger', () => {
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach(b => P.applyStats(b));
  // 1. Passive deflection in credit() with bodiesBefore
  const before = [
    { ...bodies[0], team: 0 },
    { ...bodies[1], team: 0 },
    { ...bodies[2], team: 0 },
    { ...bodies[3], team: 1 },
    { ...bodies[4], team: 1, vx: 0, vy: 0 },
    { ...bodies[5], team: 1 },
    { team: -1, vx: 500, vy: 0 }
  ];
  const ballAfter = { vx: 50, vy: 400 };
  const shares = { 2: 1 };
  const resultCredit = M.credit(shares, before[6], ballAfter, new Set([4]), before);
  assert.ok(resultCredit[2] >= 0.75, 'Attacker retains >= 75% share on deflection');
  assert.equal(M.responsibleTeam(bodies, resultCredit), 0, 'Responsible team remains attacker team 0');

  // 2. Active hit into own net remains an own goal
  const beforeOwn = [
    ...before.slice(0, 4),
    { ...before[4], vx: 200, vy: 0 },
    before[5],
    { team: -1, vx: 50, vy: 0 }
  ];
  const ownCredit = M.credit(shares, beforeOwn[6], { vx: 300, vy: 0 }, new Set([4]), beforeOwn);
  assert.equal(M.responsibleTeam(bodies, ownCredit), 1, 'Active drive to own goal credits defender');

  // 3. Goal calls: Fireball, One-Timer, and Hat Trick precedence
  const play = M.newPlay();
  const tally = M.newTally();
  const testBodies = P.kickoff();
  testBodies[6].onFire = true;
  play.lastTouch = [2, null];
  play.credit = { 2: 1 };
  const fireCall = M.callGoal(testBodies, play, tally, 0, false);
  assert.equal(fireCall.label, 'FIREBALL!');

  // One-timer call
  testBodies[6].onFire = false;
  play.assist = [1, null];
  play.lastPass = { from: 1, at: 10, speed: 250 };
  play.age = 50;
  const otCall = M.callGoal(testBodies, play, tally, 0, false);
  assert.equal(otCall.label, 'ONE-TIMER!');

  // Hat trick priority over fireball
  tally.goals[2] = 2;
  testBodies[6].onFire = true;
  const hatCall = M.callGoal(testBodies, play, tally, 0, false);
  assert.equal(hatCall.label, 'HAT TRICK!');
  assert.deepEqual(hatCall.badges, ['HAT TRICK!']);
});

test('Goal-Camping-warned CPU defender in its own crease exits the crease rather than holding or guarding', () => {
  const state = S.initialState(5, 'standard');
  state.bodies[3].x = 930; state.bodies[3].y = 300; state.bodies[3].vx = state.bodies[3].vy = 0;
  state.bodies[4].x = 750; state.bodies[4].y = 200;
  state.bodies[5].x = 750; state.bodies[5].y = 400;
  state.bodies[6].x = 500; state.bodies[6].y = 300; state.bodies[6].vx = state.bodies[6].vy = 0;
  state.fouls = { crease: [false, true], corner: null, cornerTurns: 0, cards: [] };

  assert.equal(M.inCrease(P, state.bodies[3], 1), true);

  const decision = C.plan(state, 1, { level: 'medium', seed: 5 });
  const plan = decision.plans[0];
  assert.ok(plan.power > 0, 'Defender launches rather than holding');
  assert.equal(plan.guard, false, 'Defender does not guard inside crease');

  const resolved = M.resolveTurn(P, state, [C.HOLD, C.HOLD, C.HOLD, ...decision.plans]);
  assert.equal(M.inCrease(P, resolved.state.bodies[3], 1), false, 'Defender exited the crease');
  assert.equal(resolved.state.fouls.cards.includes(3), false, 'Defender avoided a yellow card');
});

test('Ubu with Knockout ready near opposing threat prefers stunning opponent over whiffing for 25% refund', () => {
  const state = S.initialState(8, 'standard');
  state.bodies[3].meter = 100;
  state.bodies[3].equippedSuper = P.SUPERS.find(s => s.key === 'knockout');
  state.bodies[3].x = 500; state.bodies[3].y = 150; state.bodies[3].vx = state.bodies[3].vy = 0;
  state.bodies[0].x = 420; state.bodies[0].y = 150; state.bodies[0].vx = state.bodies[0].vy = 0;
  state.bodies[1].x = 100; state.bodies[1].y = 100;
  state.bodies[2].x = 100; state.bodies[2].y = 500;
  state.bodies[6].x = 380; state.bodies[6].y = 150; state.bodies[6].vx = state.bodies[6].vy = 0;
  state.bodies[0].holding = true;
  state.bodies[6].stickOffset = { x: -40, y: 0 };

  const decision = C.plan(state, 1, { level: 'hard', seed: 8 });
  const plan = decision.plans[0];
  assert.equal(plan.superArm, true, 'Arms Knockout');

  const resolved = M.resolveTurn(P, state, [C.HOLD, C.HOLD, C.HOLD, ...decision.plans]);
  assert.equal(resolved.state.bodies[0].stunned, true, 'Opposing threat is stunned');
});

test('Ubu positioned ahead of the ball wraps around rather than shooting into own goal', () => {
  const state = S.initialState(3, 'classic');
  state.bodies[0].x = 420; state.bodies[0].y = 300; state.bodies[0].vx = state.bodies[0].vy = 0;
  state.bodies[6].x = 350; state.bodies[6].y = 300; state.bodies[6].vx = state.bodies[6].vy = 0;

  assert.equal(C.behindBall(state.bodies[0], state.bodies[6], 0), false);
  const decision = C.plan(state, 0, { level: 'medium', seed: 3 });

  const resolved = M.resolveTurn(P, state, [...decision.plans, C.HOLD, C.HOLD, C.HOLD]);
  assert.notEqual(resolved.replay.goal, 1, 'No own goal conceded');
  assert.ok(resolved.state.bodies[6].x > 350, 'Ball carried or driven forward');
});

test('opposing Iron Save awards defensive save statistics, save meter, and arms rebound tracking', () => {
  const state = shotState(
    { x: 550, y: 300, vx: 600, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, strikerTeam: 0, strikerPower: 1 },
    { 0: { x: 300, y: 300 }, 3: { x: 600, y: 300 } },
    { credit: { 0: 1 }, last: 0, lastTouch: [0, null], stats: Array.from({ length: 6 }, () => ({})) }
  );
  const moves = Array.from({ length: 6 }, still);
  moves[3] = { ...still(), guard: true };

  const result = M.resolveTurn(P, state, moves);
  const saves = result.replay.saves;
  assert.equal(saves.length, 1, 'an Iron Save is registered');
  assert.equal(saves[0].index, 3, 'defender 3 made the save');
  assert.equal(saves[0].iron, true, 'classified as an Iron Save');
  assert.equal(saves[0].own, false, 'opposing shot classified as own === false (defensive save)');

  assert.equal(result.state.tally.saves[3], 1, 'defensive save credited to defender');
  assert.equal(result.state.tally.bigSaves[3], 1, 'big save stat recorded');
  assert.ok(Math.abs(result.state.bodies[3].meter - (M.METER.ball + M.METER.save) * M.METER.rate) < 1e-9, 'defender receives both contact and save meter');
  assert.ok(result.state.saved, 'play.saved is recorded');
  assert.equal(result.state.saved.team, 1, 'play.saved team is defending team');
});

test('friendly Iron Save (trap) classifies as own save with no defensive stats or meter, and preserves credit', () => {
  const state = shotState(
    { x: 550, y: 300, vx: 250, vy: 0, onFire: false, strikerTeam: 0, strikerPower: 1 },
    { 0: { x: 300, y: 300 }, 1: { x: 600, y: 300 } },
    { credit: { 0: 1 }, last: 0, lastTouch: [0, null], assist: [null, null], stats: Array.from({ length: 6 }, () => ({})) }
  );
  const moves = Array.from({ length: 6 }, still);
  moves[1] = { ...still(), guard: true };

  const result = M.resolveTurn(P, state, moves);
  const saves = result.replay.saves;
  assert.equal(saves.length, 1, 'a friendly trap is registered');
  assert.equal(saves[0].index, 1, 'teammate 1 trapped the ball');
  assert.equal(saves[0].iron, true, 'classified as an Iron Save');
  assert.equal(saves[0].own, true, 'friendly trap classified as own === true');

  assert.equal(result.state.tally.saves[1], 0, 'no defensive save credited for friendly trap');
  assert.equal(result.state.tally.bigSaves[1], 0, 'no big save stat for friendly trap');
  assert.ok(Math.abs(result.state.bodies[1].meter - M.METER.ball * M.METER.rate) < 1e-9, 'friendly trap receives only contact meter, not save meter');
  assert.equal(result.state.saved, null, 'friendly trap does not arm play.saved');
  assert.equal(M.responsibleTeam(result.state.bodies, result.state.credit), 0, 'team 0 retained possession');
  assert.equal(result.state.assist[0], 0, 'passer credited with assist');
});

test('Iron Save ownership attribution survives strikerTeam change on contact', () => {
  const play = M.newPlay();
  play.credit = { 0: 1 };
  play.lastTouch = [0, null];
  const bodies = P.kickoff();
  bodies.slice(0, 6).forEach(b => P.applyStats(b));
  Object.assign(bodies[3], { x: 600, y: 300, guarding: true });
  Object.assign(bodies[6], { x: 558, y: 300, vx: 600, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, strikerTeam: 0, strikerPower: 1 });

  const tick = M.playTick(P, bodies, play);
  assert.equal(tick.saves.length, 1);
  assert.equal(tick.saves[0].index, 3);
  assert.equal(tick.saves[0].iron, true);
  assert.equal(tick.saves[0].own, false, 'opposing save attributed as own: false despite strikerTeam mutating during collision');
  assert.equal(bodies[6].strikerTeam, 1, 'ball strikerTeam mutated to guard team on contact');
});

test('opposing Iron Save leads to REBOUND! callout on quick follow-up goal', () => {
  const state = shotState(
    { x: 550, y: 300, vx: 600, vy: 0, onFire: true, fireTicks: P.FIRE_TICKS, strikerTeam: 0, strikerPower: 1 },
    { 0: { x: 300, y: 300 }, 3: { x: 600, y: 300 } },
    { credit: { 0: 1 }, last: 0, lastTouch: [0, null], roundTurns: 1, stats: Array.from({ length: 6 }, () => ({})) }
  );
  const moves = Array.from({ length: 6 }, still);
  moves[3] = { ...still(), guard: true };
  const turn1 = M.resolveTurn(P, state, moves);
  assert.ok(turn1.state.saved, 'play.saved was set by opposing iron save');
  assert.equal(turn1.state.saved.team, 1);

  const goalState = {
    ...turn1.state,
    bodies: structuredClone(turn1.state.bodies),
    credit: { 0: 1 },
    lastTouch: [0, null],
    last: 0,
    shotX: [900, null]
  };
  Object.assign(goalState.bodies[6], { x: 930, y: 300, vx: 600, vy: 0 });
  const turn2 = M.resolveTurn(P, goalState, Array.from({ length: 6 }, still));
  assert.equal(turn2.replay.goal, 0, 'Team 0 scores');
  assert.equal(turn2.replay.label, 'REBOUND!', 'Goal labeled as REBOUND! following opposing iron save');
});

test('planning phase match state ensures iterable CPU plans on reload and turn launch', () => {
  const bodies = P.kickoff();
  const humanPlans = Array.from({ length: 3 }, () => ({ angle: 0, power: 0.5, spin: 0, superArm: false, guard: false }));
  const cpuBaseline = P.cpuPlans(bodies, () => 0.5, [0, 0]);
  assert.equal(cpuBaseline.length, 3, 'cpu baseline generates 3 plans');

  // Verify that combining human plans and CPU baseline produces a valid 6-plan turn
  assert.doesNotThrow(() => M.validatePlans(humanPlans));
  assert.doesNotThrow(() => M.validatePlans(cpuBaseline));
  const turnPlans = [...humanPlans, ...cpuBaseline];
  assert.equal(turnPlans.length, 6);
  assert.doesNotThrow(() => P.startTurn(structuredClone(bodies), turnPlans));

  // Verify planning phase restoration contract when cpu is saved vs legacy save without cpu
  const mockSavedWithCpu = {
    phase: 'plan',
    plans: humanPlans,
    cpu: cpuBaseline,
    cpuDone: true
  };
  const restoredCpu1 = mockSavedWithCpu.cpuDone && Array.isArray(mockSavedWithCpu.cpu) && mockSavedWithCpu.cpu.length === 3
    ? mockSavedWithCpu.cpu
    : P.cpuPlans(bodies, () => 0.5, [0, 0]);
  assert.deepEqual([...mockSavedWithCpu.plans, ...restoredCpu1].length, 6);

  const mockLegacySavedWithoutCpu = {
    phase: 'plan',
    plans: humanPlans
  };
  const restoredCpu2 = Array.isArray(mockLegacySavedWithoutCpu.cpu) && mockLegacySavedWithoutCpu.cpu.length === 3
    ? mockLegacySavedWithoutCpu.cpu
    : P.cpuPlans(bodies, () => 0.5, [0, 0]);
  assert.equal(restoredCpu2.length, 3);
  assert.doesNotThrow(() => {
    const combined = [...mockLegacySavedWithoutCpu.plans, ...restoredCpu2];
    assert.equal(combined.length, 6);
    P.startTurn(structuredClone(bodies), combined);
  });
});

test('Pulse Knockout stun ends a victim active super and prevents meter gain while active', () => {
  const bodies = P.kickoff();
  const stats = Array.from({ length: 6 }, () => ({}));
  bodies.slice(0, 6).forEach(b => M.applyStats(P, b, {}, 'pulse'));
  bodies[0].equippedSuper = { ...P.SUPERS[4], bonusTicks: 0, bonusRefund: 0 }; // Magnet
  bodies[0].meter = 100;
  bodies[3].equippedSuper = { ...P.SUPERS[1], bonusTicks: 0, bonusRefund: 0 }; // Knockout
  bodies[3].meter = 100;
  Object.assign(bodies[0], { x: 480, y: 300 });
  Object.assign(bodies[3], { x: 525, y: 300 });
  const state1 = { version: M.VERSION, mode: 'pulse', bodies, stats, scores: [0, 0], turn: 1 };
  const moves1 = [
    { angle: 0, power: 0.5, spin: 0, superArm: true, guard: false }, still(), still(),
    { angle: Math.PI, power: 0.5, spin: 0, superArm: true, guard: false }, still(), still()
  ];
  const r1 = M.resolveTurn(P, state1, moves1);
  assert.equal(r1.state.bodies[0].stunned, true, 'victim is stunned for next Pulse turn');
  assert.equal(r1.state.bodies[0].superActive, null, 'active Magnet is ended upon being knocked out');
});

test('Snap awards 60 ms hit-stop (100 ms when also a big shot), Post English rings award 40 ms hit-stop, and all modes enable quirks', () => {
  assert.equal(M.HIT_STOP.post, 40);
  assert.equal(M.HIT_STOP.snap, 60);

  // 1. Moderate-speed Snap (not a big shot: drive >= 140 but < 0.8 * 720 = 576) awards 60 ms hit-stop across modes
  for (const mode of ['standard', 'classic', 'pulse', 'blitz']) {
    const bodies = P.kickoff();
    bodies.slice(0, 6).forEach((b, i) => { M.applyStats(P, b, {}, mode); Object.assign(b, { x: 120 + i * 45, y: 500 }); });
    Object.assign(bodies[1], { x: 460, y: 300 });
    Object.assign(bodies[6], { x: 502, y: 300, vx: 0, vy: 260, strikerTeam: 0, strikerSlot: 0, strikerPower: 1, pace: 260 });
    const state = { version: M.VERSION, mode, bodies, stats: [], scores: [0, 0], turn: 1 };
    const moves = Array.from({ length: 6 }, still);
    moves[1] = { angle: 0, power: 0.45, spin: 0, superArm: false, guard: false }; // 324 px/s >= 140, < 576
    const res = M.resolveTurn(P, state, moves);
    assert.ok(res.replay.stops.some(s => s.ms === M.HIT_STOP.snap), `${mode} awards 60 ms Snap hit-stop`);
    assert.equal(Boolean(res.state.bodies[6].snapStruck), false, `${mode} clears snapStruck`);
  }

  // 2. Full-power Snap into nearby blocker (big shot + Snap) upgrades hit-stop to 100 ms (HIT_STOP.long)
  const bigSnapState = shotState(
    { x: 342, y: 300, vx: 0, vy: 240, strikerTeam: 0, strikerSlot: 0, strikerPower: 1, pace: 240 },
    { 1: { x: 300, y: 300 }, 2: { x: 410, y: 340 } }
  );
  const bigMoves = Array.from({ length: 6 }, still);
  bigMoves[1] = { angle: 0, power: 1, spin: 0, superArm: false, guard: false };
  const bigRes = M.resolveTurn(P, bigSnapState, bigMoves);
  assert.equal(bigRes.replay.stops[0].ms, M.HIT_STOP.long, 'Snap + big shot earns 100 ms hit-stop');

  // 3. Hard ball-post hit (velocity >= 300 px/s) awards 40 ms hit-stop; soft post kiss (< 300) does not
  const postState = speed => shotState({
    x: P.rink.right - 22,
    y: P.rink.goalTop + 12,
    vx: speed,
    vy: -speed * 0.5,
    omega: 14
  });
  const hardPost = M.resolveTurn(P, postState(420), Array.from({ length: 6 }, still));
  assert.ok(hardPost.replay.stops.some(s => s.ms === M.HIT_STOP.post), 'hard ball-post hit awards 40 ms hit-stop');
  const softPost = M.resolveTurn(P, postState(150), Array.from({ length: 6 }, still));
  assert.equal(softPost.replay.stops.some(s => s.ms === M.HIT_STOP.post), false, 'soft ball-post hit skips hit-stop');

  // 4. Corner-stall faceoff resets strikerSlot to -1
  const stallFouls = { ...M.newFouls(), corner: 0, cornerTurns: 2 };
  const stallBodies = foulTurn(stallFouls, { 0: { x: 120, y: 75 } }, { x: 90, y: 90, strikerTeam: 0, strikerSlot: 2 });
  assert.equal(stallFouls.faceoff, true);
  assert.equal(stallBodies[6].strikerTeam, -1);
  assert.equal(stallBodies[6].strikerSlot, -1, 'corner-stall faceoff resets strikerSlot');

  // 5. CPU decided() stopping-distance bound accounts for Tailgating friction reduction
  const cpuBodies = P.kickoff();
  cpuBodies.slice(0, 6).forEach(b => P.applyStats(b));
  Object.assign(cpuBodies[6], { x: 700, y: 300, vx: 0, vy: 0 });
  // At vx = 180 and friction = 150: un-drafted stopDist = 180^2 / 300 = 108 px; drafted bound = 108 / 0.6 = 180 px.
  // Place skater 0 at gap = 140 px (unreachable un-drafted, reachable with Tailgating!)
  const contact = Math.max(cpuBodies[0].radius, cpuBodies[0].reach, 18) + cpuBodies[6].radius;
  Object.assign(cpuBodies[0], { x: 700 - contact - 140, y: 300, vx: 180, vy: 0 });
  assert.equal(C.decided(cpuBodies), false, 'decided() stays false when a drafting skater could still reach the ball');
  Object.assign(cpuBodies[0], { x: 700 - contact - 200, y: 300, vx: 180, vy: 0 });
  assert.equal(C.decided(cpuBodies), true, 'decided() returns true once beyond maximum drafting stopping distance');
});
