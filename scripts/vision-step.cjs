'use strict';
// A manually supervised screenshot-only session: decision arrives as pixel mouse
// commands; the driver does not read DOM, state, physics, CPU or rendered entities.
// Playwright storageState is transported opaquely between ephemeral CI runs.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname,'..');
const base = path.join(root,'artifacts','vision-step');
fs.mkdirSync(base,{recursive:true});
const command = JSON.parse(fs.readFileSync(path.join(root,'scripts','vision-step-command.json'),'utf8'));
if (typeof command !== 'object' || !Array.isArray(command.actions) || command.actions.length > 12) throw Error('Bad actions');
const width=1440,height=930;
function xy(x,y) { if (![x,y].every(Number.isFinite) || x<0 || x>width || y<0 || y>height) throw Error('Out of screen coordinate'); }
let proc,browser;
const log={initial:Boolean(command.initial),previous_run:command.previous_run,actions:command.actions,pageErrors:[]};
async function sleep(ms) {return new Promise(r=>setTimeout(r,ms));}
async function act(page,a) {
 if (a.type==='click'){xy(a.x,a.y);await page.mouse.click(a.x,a.y,{delay:70});}
 else if (a.type==='drag'){xy(a.x,a.y);xy(a.to_x,a.to_y);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(a.to_x,a.to_y,{steps:20});await page.mouse.up();}
 else if (a.type==='wait'){if(!Number.isInteger(a.ms)||a.ms<0||a.ms>20000)throw Error('Bad wait');await sleep(a.ms);}
 else throw Error('Bad action '+a.type);
}
async function capture(page,name){await page.screenshot({path:path.join(base,name+'.jpg'),type:'jpeg',quality:85,animations:'disabled'});}
async function main(){
 const url='http://127.0.0.1:8790/';
 proc=spawn('npm',['run','dev'],{cwd:root,stdio:['ignore','pipe','pipe'],detached:true});
 let tail='';
 for (const s of [proc.stdout,proc.stderr])s.on('data',data=>tail=(tail+data.toString()).slice(-3000));
 let up=false;
 for(let i=0;i<120;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(2000)});if(r.ok){up=true;break;}}catch{}await sleep(1000)}
 if(!up) throw Error('Server failed to boot: '+tail);
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const stateFile=path.join(base,'prior','storage.json');
 if(!command.initial && !fs.existsSync(stateFile))throw Error('Missing previous screenshot-session storage; download prior artifact first');
 const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce',...(command.initial?{}:{storageState:stateFile})});
 await ctx.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
 const page=await ctx.newPage();
 page.on('pageerror',error=>log.pageErrors.push(String(error).slice(0,500)));
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
 await sleep(1000);
 await capture(page,'home');
 // Both Quick Play and Resume Match use the same visible button location.
 await page.mouse.click(1150,110,{delay:60});
 await sleep(1400);
 if(command.initial){await page.mouse.click(719,270,{delay:60});await sleep(300)}
 await capture(page,'ready');
 for(const [i,a] of command.actions.entries()){
  await act(page,a);
  log.lastAction=i+1;
 }
 await sleep(450);
 await capture(page,'after-actions');
 const launched=command.actions.some(a=>a.type==='click'&&a.x>770&&a.x<1040&&a.y>790&&a.y<905);
 if(launched){
  await sleep(900);await capture(page,'motion-1s');
  await sleep(2000);await capture(page,'motion-3s');
  await sleep(11200);await capture(page,'result');
 }
 await ctx.storageState({path:path.join(base,'storage.json')});
 log.completed=true;
 fs.writeFileSync(path.join(base,'step.json'),JSON.stringify(log,null,2)+'\n');
 console.log('VISION_STEP_OK '+JSON.stringify({initial:command.initial,actions:command.actions.length,launched,pageErrors:log.pageErrors}));
}
main().catch(e=>{
 log.failure=String(e.stack||e).slice(0,1500);
 fs.writeFileSync(path.join(base,'step.json'),JSON.stringify(log,null,2)+'\n');
 console.error('VISION_STEP_ERROR '+String(e.message||e).slice(0,1200));process.exitCode=1;
}).finally(async()=>{
 await browser?.close().catch(()=>{});
 if(proc){try{process.kill(-proc.pid,'SIGTERM')}catch{proc.kill('SIGTERM')}proc.stdout?.destroy();proc.stderr?.destroy()}
});
