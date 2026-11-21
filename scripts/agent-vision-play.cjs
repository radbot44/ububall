'use strict';
// Strict vision-only Ububall player: browser pixels -> vision model -> mouse moves.
// The playing model never sees DOM, JS objects, game state or CPU plans.
// Run locally: OPENAI_API_KEY=... node scripts/agent-vision-play.cjs
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.VISION_OUTPUT || path.join(root, 'artifacts/vision-only'));
const framesDir = path.join(out, 'frames');
fs.mkdirSync(framesDir, { recursive: true });
const WIDTH = 1440, HEIGHT = 930;
const MODEL = process.env.VISION_MODEL || 'gpt-5.4-mini';
const MAX_STEPS = bounded('VISION_MAX_STEPS', 140, 1, 500);
const MAX_API_CALLS = bounded('VISION_MAX_CALLS', 100, 0, 500);
const MAX_MINUTES = bounded('VISION_MAX_MINUTES', 28, 1, 120);
const MAX_ACTIONS = 4;
const SMOKE = process.argv.includes('--smoke');
const SCREEN_ONLY = process.argv.includes('--screen-only');
const eventLog = [];
let browser, server, ctx, page;
let pageErrors = [], consoleErrors = [], step = 0, apiCalls = 0;
let inputTokens = 0, outputTokens = 0, status = 'not-started';
let serverOutput = '';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const n = v => Number.isFinite(v) ? v : 0;

function bounded(name, fallback, lo, hi) {
  const raw = process.env[name], value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < lo || value > hi) throw Error('Invalid ' + name);
  return value;
}
function log(item) {
  const record = { at: new Date().toISOString(), ...item };
  eventLog.push(record);
  fs.writeFileSync(path.join(out, 'events.json'), JSON.stringify(eventLog, null, 2) + '\n');
  console.log('VISION_EVENT ' + JSON.stringify(record));
}
const PROMPT = [
  'You are an autonomous player in a screenshot-only 3-on-3 turn-based physics hockey game called Ububall.',
  'You see ONLY ordinary browser screenshots and a short text log of YOUR previous choices and reflections.',
  'You do NOT receive game coordinates, velocity, DOM, game source, hidden CPU plans, or a physics simulator.',
  'The opposing team is Easy CPU. First to five goals wins. Your team is on the left; you attack right.',
  'Three ubus launch simultaneously each turn. On the rink, drag from one of your own ubus toward the desired',
  'direction to select angle and power. Long drags give high power. You can also use visible shot controls.',
  'A click on a selected ubu can switch it to Guard. A ready super can be armed using visible UI.',
  'Once all three shots are set, use the visible Launch team button. After a goal, click Next kickoff.',
  'Start from the homepage using Quick play. If a tutorial covers the rink, use Skip.',
  'Every action is performed by real mouse/touch-style browser input with coordinates in the exact',
  '1440 x 930 screenshot. Do NOT assume the rink is 1000x600 browser pixels.',
  'You must inspect how aims visually changed before launching whenever uncertain.',
  'Prefer careful play: protect your own goal, advance the ball, avoid repeated bad ricochets.',
  'After a turn, infer what happened from the sequence of visual frames and remember one specific lesson.',
  'You can use up to FOUR actions in one reply. If uncertain choose ONE action to inspect its effect.',
  'A drag action starts at (x,y) and ends at (to_x,to_y). A click at (x,y).',
  'A launch action clicks the visible launch button and collects early/mid/late animation screenshots.',
  'A wait action pauses without clicking. done is ONLY for a screenshot visibly showing the match is final.',
  'Never invent scores or claims of winning. If you cannot tell, keep inspecting.',
  'Respond with JSON matching the schema. Keep your explanation succinct and specific.'
].join(' ');

const actionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['click', 'drag', 'launch', 'wait', 'done'] },
    x: { type: 'integer' }, y: { type: 'integer' },
    to_x: { type: 'integer' }, to_y: { type: 'integer' },
    wait_ms: { type: 'integer' }
  }, required: ['type', 'x', 'y', 'to_x', 'to_y', 'wait_ms']
};
const decisionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    visible_phase: { type: 'string', enum: ['home', 'setup', 'plan', 'animation', 'goal', 'final', 'unclear'] },
    visible_score: { type: 'string' },
    observation: { type: 'string' }, tactic: { type: 'string' },
    prediction: { type: 'string' }, lesson: { type: 'string' },
    actions: { type: 'array', items: actionSchema }
  },
  required: ['visible_phase', 'visible_score', 'observation', 'tactic', 'prediction', 'lesson', 'actions']
};

async function shot(name, quality = 82) {
  const file = path.join(framesDir, name + '.jpg');
  const bytes = await page.screenshot({ type: 'jpeg', quality, animations: 'disabled', timeout: 15000 });
  fs.writeFileSync(file, bytes);
  return { file: path.relative(out, file), bytes };
}
async function waitServer() {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw Error('Local Worker exited: ' + serverOutput.slice(-3500));
    try {
      const res = await fetch('http://127.0.0.1:8790/', { signal: AbortSignal.timeout(1800) });
      if (res.ok) return;
    } catch {}
    await sleep(1000);
  }
  throw Error('Worker startup timed out: ' + serverOutput.slice(-3500));
}
async function callModel(observations) {
  if (!process.env.OPENAI_API_KEY) throw Error('OPENAI_API_KEY is not configured; cannot run a vision model.');
  if (apiCalls >= MAX_API_CALLS) throw Error('Maximum API calls reached');
  const recent = eventLog.filter(e => e.kind === 'decision').slice(-8).map(e => ({
    visible_phase: e.visible_phase, score: e.visible_score,
    tactic: e.tactic, prediction: e.prediction, lesson: e.lesson,
    actions: e.actions
  }));
  const images = observations.slice(-4);
  const content = [
    { type: 'input_text', text: 'Step ' + step + '. Image(s) in chronological order, newest LAST. Recent decisions: ' +
      JSON.stringify(recent) + '. Decide your next mouse actions. Current image dimensions: ' +
      WIDTH + ' x ' + HEIGHT + '.' }
  ];
  for (const frame of images) {
    content.push({ type: 'input_text', text: 'Screenshot: ' + frame.file });
    content.push({ type: 'input_image', image_url: 'data:image/jpeg;base64,' + frame.bytes.toString('base64'), detail: 'high' });
  }
  apiCalls++;
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({
      model: MODEL, store: false, max_output_tokens: 900,
      instructions: PROMPT,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name: 'ububall_vision_decision', strict: true, schema: decisionSchema } }
    }),
    signal: AbortSignal.timeout(90000)
  });
  if (!res.ok) {
    const reason = (await res.text()).slice(0, 1000);
    throw Error('Vision API HTTP ' + res.status + ': ' + reason);
  }
  const response = await res.json();
  inputTokens += response.usage?.input_tokens || 0;
  outputTokens += response.usage?.output_tokens || 0;
  const output = response.output?.flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text').map(part => part.text).join('');
  if (!output) throw Error('No model text. Response status: ' + response.status);
  const decision = JSON.parse(output);
  if (!Array.isArray(decision.actions) || decision.actions.length > MAX_ACTIONS) throw Error('Invalid number of actions');
  for (const action of decision.actions) {
    if (!['click','drag','launch','wait','done'].includes(action.type)) throw Error('Unknown action');
    if (![action.x,action.y,action.to_x,action.to_y,action.wait_ms].every(Number.isInteger)) throw Error('Noninteger action');
    if (![-1,0,1].includes(Math.sign(action.wait_ms))) { /* wait bounded below */ }
    if (action.wait_ms < 0 || action.wait_ms > 10000) throw Error('Invalid wait');
    if (['click','drag','launch'].includes(action.type) &&
        (action.x < 0 || action.x >= WIDTH || action.y < 0 || action.y >= HEIGHT)) throw Error('Mouse outside screenshot');
    if (action.type === 'drag' &&
        (action.to_x < 0 || action.to_x >= WIDTH || action.to_y < 0 || action.to_y >= HEIGHT)) throw Error('Drag outside screenshot');
  }
  log({ kind: 'decision', step, model: MODEL, visible_phase: decision.visible_phase,
    visible_score: decision.visible_score.slice(0, 100),
    observation: decision.observation.slice(0, 600), tactic: decision.tactic.slice(0, 500),
    prediction: decision.prediction.slice(0, 600), lesson: decision.lesson.slice(0, 600),
    actions: decision.actions, images: images.map(x => x.file) });
  return decision;
}
async function perform(action, index) {
  if (action.type === 'done') return { done: true, frames: [] };
  const wait = clamp(action.wait_ms, 0, 10000);
  if (action.type === 'click' || action.type === 'launch') {
    await page.mouse.click(action.x, action.y, { delay: 85 });
  } else if (action.type === 'drag') {
    await page.mouse.move(action.x, action.y);
    await page.mouse.down();
    await page.mouse.move(action.to_x, action.to_y, { steps: 14 });
    await page.mouse.up();
  }
  if (action.type === 'wait') await sleep(Math.max(250, wait));
  else if (action.type !== 'launch') await sleep(Math.max(450, wait));
  const prefix = String(step).padStart(3, '0') + '-' + index;
  const frames = [];
  if (action.type === 'launch') {
    // Four independent frames reveal cause/effect; all are literal canvas screenshots.
    for (const [label, ms] of [['early', 600], ['contact', 1300], ['late', 3100], ['settled', 8500]]) {
      await sleep(ms);
      frames.push(await shot(prefix + '-' + label));
    }
  } else {
    frames.push(await shot(prefix + '-after'));
  }
  return { done: false, frames };
}
async function run() {
  status = 'running';
  const began = Date.now();
  if (!SMOKE && !process.env.OPENAI_API_KEY) {
    status = 'missing-key';
    throw Error('OPENAI_API_KEY required. Add it as a GitHub Actions secret or local environment variable.');
  }
  server = spawn('npm', ['run', 'dev'], { cwd: root, detached: true, stdio: ['ignore','pipe','pipe'] });
  server.stdout.on('data', b => { serverOutput = (serverOutput + b.toString()).slice(-8000); });
  server.stderr.on('data', b => { serverOutput = (serverOutput + b.toString()).slice(-8000); });
  await waitServer();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1,
    reducedMotion: 'reduce', acceptDownloads: false,
    recordVideo: { dir: out, size: { width: WIDTH, height: HEIGHT } }
  });
  page = await ctx.newPage();
  page.on('pageerror', err => pageErrors.push(String(err).slice(0, 700)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400)); });
  // The only input to the player is a screenshot. No page.evaluate, DOM queries or JS hooks.
  await page.goto('http://127.0.0.1:8790/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2500);
  let observations = [await shot('000-home')];
  log({ kind: 'ready', viewport: [WIDTH, HEIGHT], mode: 'screenshots-only', model: MODEL,
    smoke: SMOKE, image: observations[0].file });
  if (SMOKE) {
    // Mechanical browser smoke test only, no agent and no gameplay result.
    status = 'smoke-passed'; return;
  }
  for (step = 1; step <= MAX_STEPS && Date.now() - began < MAX_MINUTES * 60000; step++) {
    const decision = await callModel(observations);
    if (decision.visible_phase === 'final' && decision.actions.some(a => a.type === 'done')) {
      status = 'agent-reported-final';
      break;
    }
    if (!decision.actions.length) {
      observations = [await shot(String(step).padStart(3, '0') + '-idle')];
      await sleep(750);
      continue;
    }
    let launched = false, newest = [];
    for (let i = 0; i < decision.actions.length; i++) {
      const a = decision.actions[i];
      if (a.type === 'done') throw Error('done cannot be used without visible final phase');
      const result = await perform(a, i);
      newest.push(...result.frames);
      if (a.type === 'launch') { launched = true; break; }
    }
    observations = launched ? newest.slice(-4) : newest.slice(-2);
  }
  if (status === 'running') status = 'incomplete-budget';
}
run().catch(err => {
  if (status === 'running') status = 'error';
  log({ kind: 'error', message: String(err.stack || err).slice(0, 2000) });
  process.exitCode = 1;
}).finally(async () => {
  const outcome = { status, steps: step, apiCalls, usage: { inputTokens, outputTokens },
    pageErrors, consoleErrors: consoleErrors.slice(-20) };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(outcome, null, 2) + '\n');
  log({ kind: 'outcome', ...outcome });
  try { if (page) await shot('final-observation'); } catch {}
  try { await ctx?.close(); } catch {}
  try { await browser?.close(); } catch {}
  if (server) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); }
    server.stdout?.destroy(); server.stderr?.destroy();
  }
  if (status === 'incomplete-budget') process.exitCode = 2;
});
