'use strict';
// Browser-driven Easy CPU match. Instrumentation is served in-memory via Playwright
// route interception; tracked files on disk are never modified.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'agent-play');
const shots = path.join(out, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const sourcePath = path.join(root, 'web', 'ububall.js');
const original = fs.readFileSync(sourcePath, 'utf8');
const clock = 'const delta = lastTime ? Math.max(0, (time - lastTime) / 1000) : 0;';
const marker = '  requestAnimationFrame(frame);\n  // "Play with my ubus"';
if (!original.includes(clock) || !original.includes(marker)) throw Error('Game UI hook markers changed.');
const hook = [
'  window.__ububallAgent = Object.freeze({',
'    start() {',
"      startCpuMatch([...roster], 'standard', 'easy');",
'      closeFirstTurnGuide(true); window.__agentFast = true;',
'    },',
'    observe() {',
'      return { phase, turn, scores: [...scores], cpuLevel, mode: fieldView.mode,',
'        state: { version: ububallMatch.VERSION, mode: fieldView.mode,',
'          bodies: structuredClone(simBodies), stats: structuredClone(stats),',
'          scores: [...scores], turn, clock: matchTicks, roundTurns,',
'          ...ububallMatch.newPlay(play), fouls: structuredClone(fouls) },',
'        playerNames: fieldView.entries.slice(0, 3).map(e => e.model.parts.fullName) };',
'    },',
'    choose(next) {',
"      if (phase !== 'plan') throw Error('Cannot aim outside planning phase: ' + phase);",
"      if (!Array.isArray(next) || next.length !== 3) throw Error('Expected three moves');",
'      plans = ububallMatch.validatePlans(next);',
'      for (let i = 0; i < 3; i++) fieldView.bodies[i].superArm = Boolean(plans[i].superArm);',
'      dirtyPrediction(); sync(); draw(); saveActiveMatch();',
'      return plans;',
'    },',
"    launch() { document.getElementById('launch').click(); },",
'    next() {',
"      if (phase !== 'goal') throw Error('Not a kickoff phase: ' + phase);",
"      document.getElementById('launch').click();",
'    }',
'  });'
].join('\n') + '\n';
const instrumented = original
  .replace(clock, 'const delta = window.__agentFast ? 0.18 : (lastTime ? Math.max(0, (time - lastTime) / 1000) : 0);')
  .replace(marker, hook + marker);
const isWin = process.platform === 'win32';
const log = [];
const emit = event => { log.push(event); console.log('AGENT_EVENT ' + JSON.stringify(event)); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch('http://127.0.0.1:8790/', { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {}
    await sleep(1000);
  }
  throw Error('Local Worker did not start within 120 seconds');
}
function summary(o) {
  const b = o.state.bodies, ball = b[6];
  return { phase: o.phase, turn: o.turn, scores: o.scores,
    ball: { x: Math.round(ball.x), y: Math.round(ball.y),
      speed: Math.round(Math.hypot(ball.vx || 0, ball.vy || 0)) },
    ubus: b.slice(0, 6).map(v => [Math.round(v.x), Math.round(v.y)]),
    meters: b.slice(0, 3).map(v => Math.round(v.meter || 0)) };
}
function strategy(o, previous) {
  const ownHalf = o.state.bodies[6].x < 460;
  const behind = o.scores[0] < o.scores[1];
  const stale = previous && previous.progress < -80 && previous.goal === null;
  const defend = ownHalf && (behind || stale);
  const protect = o.scores[0] > o.scores[1] && !ownHalf;
  const name = defend ? 'protect-own-goal' : protect ? 'control-the-lead' : 'press-for-goal';
  const weights = defend
    ? { goal: 10000, progress: 1, access: .55, cover: 1.15, role: 65 }
    : protect
      ? { goal: 10000, progress: 1.15, access: .55, cover: .8, role: 50 }
      : { goal: 10000, progress: 1.75, access: .5, cover: .4, role: 40 };
  return { name, level: stale || behind ? 'hard' : 'medium',
    risk: defend ? .6 : protect ? .48 : .4, weights,
    seed: 131 + o.turn * 31 + o.scores[0] * 997 + o.scores[1] * 1009 };
}
let worker, browser;
function stopWorker() {
  if (!worker) return;
  const proc = worker; worker = null;
  if (proc.pid) {
    if (isWin) {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
    }
  }
  proc.stdout?.destroy(); proc.stderr?.destroy();
}
async function play() {
  worker = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
    detached: !isWin
  });
  let serverLogs = '';
  for (const stream of [worker.stdout, worker.stderr]) stream.on('data', chunk => {
    serverLogs = (serverLogs + chunk.toString()).slice(-10000);
  });
  await waitServer().catch(e => { throw Error(e.message + '\n' + serverLogs); });
  emit({ event: 'server-ready' });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 930 },
    deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await context.route('**/ububall.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript; charset=utf-8',
    body: instrumented
  }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', err => errors.push(String(err).slice(0, 500)));
  await page.goto('http://127.0.0.1:8790/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => Boolean(window.__ububallAgent), null, { timeout: 45000 });
  await page.evaluate(() => window.__ububallAgent.start());
  emit({ event: 'game-loaded' });
  await page.waitForFunction(() => window.__ububallAgent.observe().phase === 'plan');
  emit({ event: 'started', cpu: 'easy', mode: 'standard',
    view: summary(await page.evaluate(() => window.__ububallAgent.observe())) });
  let previous = null, final = null;
  for (let n = 0; n < 120; n++) {
    let o = await page.evaluate(() => window.__ububallAgent.observe());
    if (o.phase === 'over') { final = o; break; }
    if (o.phase === 'goal') {
      await page.evaluate(() => window.__ububallAgent.next());
      o = await page.evaluate(() => window.__ububallAgent.observe());
    }
    if (o.phase !== 'plan') throw Error('Unexpected phase ' + o.phase);
    const config = strategy(o, previous);
    const decision = await page.evaluate(opts => {
      const state = window.__ububallAgent.observe().state;
      const result = window.ububallCPU.plan(state, 0, opts);
      window.__ububallAgent.choose(result.plans);
      return result;
    }, config);
    const before = summary(o);
    const label = String(n + 1).padStart(3, '0');
    await page.screenshot({ path: path.join(shots, label + '-aim.png'), animations: 'disabled' });
    await page.evaluate(() => window.__ububallAgent.launch());
    await page.waitForFunction(() => {
      const phase = window.__ububallAgent.observe().phase;
      return phase === 'plan' || phase === 'goal' || phase === 'over';
    }, null, { timeout: 60000, polling: 100 });
    const afterState = await page.evaluate(() => window.__ububallAgent.observe());
    const after = summary(afterState);
    const delta = [after.scores[0] - before.scores[0], after.scores[1] - before.scores[1]];
    const progress = after.ball.x - before.ball.x;
    const goal = delta[0] ? 0 : delta[1] ? 1 : null;
    previous = { progress, goal };
    emit({ event: 'turn', turn: o.turn, tactic: config.name, planner: config.level,
      prediction: { value: Math.round(decision.diagnostics.score), simulations: decision.diagnostics.simulations },
      before, plans: decision.plans.map(p => ({
        angleDeg: Math.round(p.angle * 180 / Math.PI), power: +p.power.toFixed(2),
        spin: +p.spin.toFixed(2), guard: Boolean(p.guard), superArm: Boolean(p.superArm)
      })), after, progress: Math.round(progress), goal });
    if (goal !== null) await page.screenshot({ path: path.join(shots, label + '-goal.png'), animations: 'disabled' });
    if (afterState.phase === 'over') { final = afterState; break; }
  }
  if (!final) final = await page.evaluate(() => window.__ububallAgent.observe());
  const outcome = { event: 'final', scores: final.scores,
    winner: final.phase === 'over' ? (final.scores[0] > final.scores[1] ? 'agent' : 'easy-cpu') : 'capped',
    turns: log.filter(e => e.event === 'turn').length, errors };
  emit(outcome);
  await page.screenshot({ path: path.join(out, 'final.png'), animations: 'disabled' });
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 42, animations: 'disabled' });
  console.log('AGENT_FINAL_IMAGE_BASE64 ' + jpeg.toString('base64'));
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ outcome, log }, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'page-errors.json'), JSON.stringify(errors, null, 2) + '\n');
  if (outcome.winner === 'capped') process.exitCode = 2;
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopWorker(); process.exit(130); });
}
play().catch(error => {
  emit({ event: 'error', message: String(error.stack || error) });
  fs.writeFileSync(path.join(out, 'failure.txt'), String(error.stack || error) + '\n');
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close().catch(() => {});
  stopWorker();
});
