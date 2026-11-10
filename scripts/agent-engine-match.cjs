'use strict';
// Deterministic engine-level companion to the real-browser screenshot harness.
// Uses the actual Standard rules, resolveTurn physics, and Easy CPU planner.
const fs = require('node:fs');
const path = require('node:path');
const S = require('./cpu-simulation.cjs');
const P = require('../web/ububall-physics.js');
const M = require('../shared/ububall-match.js');
const C = require('../shared/ububall-cpu.js');

const out = path.resolve(__dirname, '../artifacts/agent-engine');
fs.mkdirSync(out, { recursive: true });
const state0 = S.initialState(11, 'standard');
let state = state0, previous = null;
const turns = [], maxTurns = 100;

function strategy(s, prev) {
  const ownHalf = s.bodies[6].x < 460;
  const behind = s.scores[0] < s.scores[1];
  const stale = prev && prev.progress < -80 && prev.goal === null;
  const defend = ownHalf && (behind || stale);
  const protect = s.scores[0] > s.scores[1] && !ownHalf;
  return {
    tactic: defend ? 'protect-own-goal' : protect ? 'control-the-lead' : 'press-for-goal',
    level: stale || behind ? 'hard' : 'medium',
    risk: defend ? .6 : protect ? .48 : .4,
    weights: defend
      ? { goal: 10000, progress: 1, access: .55, cover: 1.15, role: 65 }
      : protect ? { goal: 10000, progress: 1.15, access: .55, cover: .8, role: 50 }
      : { goal: 10000, progress: 1.75, access: .5, cover: .4, role: 40 },
    seed: 131 + s.turn * 31 + s.scores[0] * 997 + s.scores[1] * 1009
  };
}
function view(s, plans) {
  const bodies = s.bodies;
  const players = bodies.slice(0, 6).map((b, i) => {
    const fill = i < 3 ? '#e8ca48' : '#aa54d3';
    const arrow = i < 3 && plans?.[i] && plans[i].power > 0 ? (() => {
      const p=plans[i], x=b.x+Math.cos(p.angle)*p.power*110, y=b.y+Math.sin(p.angle)*p.power*110;
      return '<line x1="' + b.x + '" y1="' + b.y + '" x2="' + x + '" y2="' + y +
        '" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>';
    })() : '';
    return arrow+'<circle cx="'+b.x+'" cy="'+b.y+'" r="'+Math.max(12,b.radius||22)+'" fill="'+fill+
      '" stroke="#18202a" stroke-width="3"/><text x="'+b.x+'" y="'+(b.y+6)+'" text-anchor="middle" font-size="18" fill="#13131e">'+(i+1)+'</text>';
  }).join('\n');
  const b=bodies[6];
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650" viewBox="0 0 1000 650">'+
    '<rect width="1000" height="650" fill="#162736"/><rect x="20" y="40" width="960" height="570" rx="110" fill="#8ec4d7" stroke="#f1faff" stroke-width="8"/>'+
    '<path d="M500 40V610" stroke="#ffffff" stroke-width="3" stroke-dasharray="16 12" fill="none"/>'+
    '<circle cx="500" cy="325" r="90" fill="none" stroke="#fff" stroke-width="3"/>'+
    '<rect x="20" y="250" width="20" height="150" rx="4" fill="#ec6173"/>'+
    '<rect x="960" y="250" width="20" height="150" rx="4" fill="#ec6173"/>'+
    '<text x="500" y="28" text-anchor="middle" fill="white" font-size="23">YOU '+s.scores[0]+' — '+s.scores[1]+' EASY CPU | Turn '+s.turn+'</text>'+
    players+'<circle cx="'+b.x+'" cy="'+b.y+'" r="'+Math.max(9,b.radius||11)+'" fill="#fff" stroke="#151f29" stroke-width="4"/>'+
    '</svg>';
}
for(let n=0;n<maxTurns && state.winner===null;n++){
  const config=strategy(state,previous);
  const decision=C.plan(state,0,config);
  const opponent=C.plan(state,1,{level:'easy',seed:state.turn});
  const before={x:state.bodies[6].x,y:state.bodies[6].y,scores:[...state.scores]};
  const filename=String(n+1).padStart(3,'0');
  fs.writeFileSync(path.join(out,filename+'-aim.svg'),view(state,decision.plans));
  const result=M.resolveTurn(P,state,[...decision.plans,...opponent.plans]);
  state=result.state;
  const progress=state.bodies[6].x-before.x;
  const goal=result.replay.goal;
  previous={progress,goal};
  const turn={turn:n+1,tactic:config.tactic,planner:config.level,
    before, plans:decision.plans, result:{ball:{x:state.bodies[6].x,y:state.bodies[6].y},
      scores:[...state.scores], goal, ticks:result.replay.ticks, progress:Math.round(progress)}};
  turns.push(turn);
  console.log('ENGINE_TURN '+JSON.stringify({turn:turn.turn,tactic:turn.tactic,score:turn.result.scores,goal,progress:turn.result.progress}));
  fs.writeFileSync(path.join(out,filename+'-result.svg'),view(state));
  if(state.phase==='goal') S.kickoff(state);
}
const summary={winner:state.winner===null?'capped':state.winner===0?'agent':'easy-cpu',
  score:state.scores,turns:turns.length,goals:turns.filter(x=>x.result.goal!==null).length,
  tactics:Object.fromEntries(['press-for-goal','protect-own-goal','control-the-lead'].map(k=>[k,turns.filter(t=>t.tactic===k).length])),
  positiveTerritory:turns.filter(t=>t.result.progress>50).length,negativeTerritory:turns.filter(t=>t.result.progress< -50).length};
console.log('ENGINE_RESULT '+JSON.stringify(summary));
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({summary,turns},null,2)+'\n');
if(summary.winner==='capped') process.exitCode=2;
