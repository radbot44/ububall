/* Local renderer comparison; the production game does not load this page. */
(async function(){
  'use strict';
  const $=id=>document.getElementById(id),P=ububallPhysics,art=[];
  function tile(w,h,paint){const c=document.createElement('canvas');c.width=w;c.height=h;paint(c.getContext('2d'));art.push(c);return art.length-1;}
  try {
    const rink=tile(1000,600,g=>{g.fillStyle='#161c24';g.fillRect(0,0,1000,600);ububallPresentation.drawRinkSurface(g,P,ububallMatch,{surface:'#303947',border:'#536176',background:'#161c24',home:'#ffd05b',away:'#b776ec'});});
    for(let i=0;i<6;i++){const bytes=new Uint8Array(128);let seed=734+i*271;for(let j=0;j<128;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;bytes[j]=seed>>>24;}const model=ubu.decode(bytes);const image=new Image();image.src=await ubuRender.sprite(model,256);await image.decode();art.push(image);}
    const ballTile=tile(64,64,g=>{g.fillStyle='#ffbd4e';g.beginPath();g.arc(32,32,25,0,7);g.fill();g.strokeStyle='#fff1bd';g.lineWidth=3;g.stroke();g.translate(32,32);ububallPresentation.drawBallFace(g,38,'#fff1bd','#e45027');});
    const flame=tile(64,64,g=>{const gradient=g.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'#fffbd9');gradient.addColorStop(.2,'#ffe188');gradient.addColorStop(.5,'#ff792caa');gradient.addColorStop(1,'#ff340000');g.fillStyle=gradient;g.fillRect(0,0,64,64);});
    const soot=tile(64,64,g=>{const gradient=g.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'#100702aa');gradient.addColorStop(.5,'#2b120675');gradient.addColorStop(1,'#2d120600');g.fillStyle=gradient;g.fillRect(0,0,64,64);});
    let renderer=ububallWebGL.create($('gpu'),art),bodies,t=0,acc=0,shot=0,paused=false,heat=true,mode=0,last=0,since=0;
    const trails=[],samples=[[],[]],frames=[];let prior=0;
    function reset(){bodies=P.kickoff();P.launch(bodies,Array.from({length:6},(_,i)=>({angle:i<3?-.6+i*.6:Math.PI-.6+(i-3)*.6,power:.85,spin:i%2?.8:-.8})));Object.assign(bodies[6],{x:420,y:300,vx:760,vy:180,onFire:true,fireTicks:100000,pace:3,strikerTeam:0});shot=0;trails.length=0;}
    function clearStats(){samples.forEach(a=>a.length=0);frames.length=0;prior=0;}
    function resize(){const d=Number($('resolution').value);for(const id of ['cpu','gpu']){const c=$(id);c.width=Math.round(1000*d);c.height=Math.round(600*d);} $('density').textContent=d+'x';clearStats();}
    $('resolution').oninput=resize;
    $('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'Resume':'Pause';last=0;if(!paused)requestAnimationFrame(frame);else render();};
    $('restart').onclick=()=>{reset();render();};
    $('heat').onclick=()=>{heat=!heat;$('heat').setAttribute('aria-pressed',heat);render();};
    $('strength').oninput=()=>render();
    $('mode').onclick=()=>{mode=(mode+1)%3;$('mode').textContent='View: '+['Both','Canvas 2D','WebGL2'][mode];$('reference').hidden=mode===2;$('gpu-panel').hidden=mode===1;document.querySelector('.stages').classList.toggle('solo',mode!==0);clearStats();render();};
    $('gpu').addEventListener('webglcontextlost',e=>{e.preventDefault();paused=true;$('pause').textContent='Resume';$('status').textContent='Graphics context lost. Waiting for restoration...';});
    $('gpu').addEventListener('webglcontextrestored',()=>{try{renderer=ububallWebGL.create($('gpu'),art);$('status').textContent='Graphics restored. Resume when ready.';render();}catch(e){$('status').textContent=e.message;}});
    window.addEventListener('pagehide',()=>renderer.dispose(),{once:true});
    function commands(){const out=[[rink,500,300,1000,600,0,1]];
      for(const p of trails)out.push([soot,p.x,p.y,26,26,0,Math.max(0,1-(t-p.t)/8)]);
      for(let i=0;i<6;i++){const b=bodies[i];out.push([i+1,b.x,b.y,b.radius*2,b.radius*2,b.rotation,1]);}
      const b=bodies[6];
      for(let i=0;i<45;i++){const age=((t*1.8+i/45)%1),a=i*2.399;const x=b.x-b.vx*age*.055+Math.sin(a+t*5)*age*19,y=b.y-b.vy*age*.055+Math.cos(a+t*4)*age*19;out.push([flame,x,y,12+age*24,12+age*24,a,(1-age)*.65]);}
      out.push([ballTile,b.x,b.y,b.radius*2.5,b.radius*2.5,b.rotation,1]);return out;
    }
    function render(){const list=commands();for(let i=0;i<2;i++){if((mode===1&&i===1)||(mode===2&&i===0))continue;const start=performance.now();if(i)renderer.draw(list,bodies[6],t,heat?Number($('strength').value):0);else{const c=$('cpu'),g=c.getContext('2d');g.setTransform(c.width/1000,0,0,c.height/600,0,0);g.clearRect(0,0,1000,600);for(const [id,x,y,w,h,a,opacity] of list){g.save();g.translate(x,y);g.rotate(a);g.globalAlpha=opacity;g.drawImage(art[id],-w/2,-h/2,w,h);g.restore();}}samples[i].push(performance.now()-start);if(samples[i].length>240)samples[i].shift();}}
    function stats(){const percentile=(a,p)=>a.length?a.slice().sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))].toFixed(2):'-';for(let i=0;i<2;i++)$(['cpu-stats','gpu-stats'][i]).textContent='Submit median '+percentile(samples[i],.5)+' ms  /  frame p95 '+percentile(frames,.95)+' ms  /  '+$('cpu').width+' x '+$('cpu').height;}
    function frame(now){if(paused)return;const dt=last?Math.min(.05,(now-last)/1000):0;last=now;if(prior){frames.push(now-prior);if(frames.length>240)frames.shift();}prior=now;t+=dt;shot+=dt;acc+=dt;while(acc>=P.DT){P.step(bodies);acc-=P.DT;}if(shot>5||P.settled(bodies))reset();const b=bodies[6];if(!trails.length||Math.hypot(b.x-trails.at(-1).x,b.y-trails.at(-1).y)>5){trails.push({x:b.x,y:b.y,t});if(trails.length>350)trails.shift();}render();if(now-since>500){stats();since=now;}requestAnimationFrame(frame);}
    reset();resize();$('status').textContent='Ready  /  shared physics, six original ubu sprites, 45 flame sprites, up to 350 burn stamps. Heat distorts the finished GPU scene.';requestAnimationFrame(frame);
    // Small inspection surface for automated local verification.
    window.webglDemo={get renderer(){return renderer;},get bodies(){return bodies;},get time(){return t;},render};
  }catch(e){$('status').textContent=e.message;$('gpu-stats').textContent='Unable to initialize comparison';console.error(e);}
})();
