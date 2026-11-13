'use strict';
// Zero-dependency local & LAN benchmark server for PC and mobile browsers.
// Run with: node scripts/serve-bench.cjs   (optional: --port 8791)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const webDir = path.join(root, 'web');
const sharedDir = path.join(root, 'shared');
const distDir = path.join(root, 'dist', 'public');
const outDir = path.join(root, 'bench-results');

const portArgIdx = process.argv.indexOf('--port');
const PORT = portArgIdx >= 0 && Number(process.argv[portArgIdx + 1]) ? Number(process.argv[portArgIdx + 1]) : 8791;

// Explicit public whitelist matching scripts/prepare-assets.cjs (never serve repository root or secrets).
const WEB_FILES = new Set([
  'ububall.html', 'ububall.css', 'ububall.js', 'ububall-presentation.js', 'ububall-playback.js',
  'ububall-stats.js', 'ububall-theater.js', 'ububall-bench.js', 'mp4.js', 'ububall-online.js',
  'ububall-cpu-worker.js', 'ububall-cpu-client.js', 'index.html', 'app.js', 'site.css', 'site.js',
  'site-header.js', 'pack-scene.js', 'starter.js', 'ubu-list.js', 'game-ui.js', 'ububall-activity.js',
  'voice.html', 'demo.html', 'demo.js', 'effects.html', 'effects.css', 'effects.js', 'auth-complete.html'
]);
const SHARED_FILES = new Set([
  'ububall-match.js', 'ububall-physics.js', 'ububall-replay.js', 'ububall-cpu.js',
  'ubu.js', 'ubu-archetype.js', 'ubu-file.js', 'ubu-render.js', 'ubu-audio.js', 'rarity.js'
]);
const ASSET_FILES = new Set([
  'uburoom-wordmark-brand.svg', 'uburoom-oomark-brand.svg', 'oomark-pattern.svg',
  'ububall-logo.svg', 'ububall-logo-com.svg', 'UburoomSans-Regular.woff2', 'UburoomSans-Color.woff2',
  '00_stalwart.png', '01_knockout.png', '02_sticky.png', '03_cannonball.png',
  '04_magnet.png', '05_colossus.png', '06_shockwave.png', '07_ghost.png'
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

function lanAddresses() {
  const nets = os.networkInterfaces();
  const list = [];
  for (const entries of Object.values(nets)) {
    for (const info of entries || []) {
      if (info.family === 'IPv4' && !info.internal) list.push(info.address);
    }
  }
  return list;
}

function sanitizeSlug(ua = '') {
  if (/Pixel/i.test(ua)) return 'pixel';
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'device';
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': body.length
  });
  res.end(body);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Content-Length': body.length
  });
  res.end(body);
}

function createBenchServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (req.method === 'POST' && pathname === '/__bench_progress') {
      const chunks = [];
      req.on('data', c => { if (chunks.length < 16) chunks.push(c); });
      req.on('end', () => {
        try {
          const { msg } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const ip = req.socket.remoteAddress || 'client';
          console.log(`[bench ${ip}] ${msg}`);
        } catch {}
        sendJson(res, 200, { ok: true });
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/__bench_report') {
      const chunks = [];
      let total = 0;
      req.on('data', chunk => {
        total += chunk.length;
        if (total <= 4 * 1024 * 1024) chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const report = payload.report || payload;
          const md = typeof payload.markdown === 'string' ? payload.markdown : '';
          fs.mkdirSync(outDir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const tag = sanitizeSlug(report?.device?.userAgent || '');
          const base = `bench-${tag}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
          const jsonFile = path.join(outDir, `${base}.json`);
          fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
          if (md) fs.writeFileSync(path.join(outDir, `${base}.md`), md, 'utf8');

          console.log(`\n=== Benchmark Report Received (${tag}) ===`);
          console.log(`Saved: bench-results/${base}.json${md ? ` + .md` : ''}`);
          if (md) console.log('\n' + md);
          sendJson(res, 200, { ok: true, savedTo: `bench-results/${base}.json` });
        } catch (err) {
          sendJson(res, 400, { error: err.message });
        }
      });
      return;
    }

    // Minimal local offline stubs for session/config endpoints so benchmark screens never error without Wrangler
    if (pathname === '/api/session') return sendJson(res, 200, { owner: null, csrf: 'bench' });
    if (pathname === '/api/starter') return sendJson(res, 200, { signup: false, daily: false });
    if (pathname === '/api/config') return sendJson(res, 200, { ready: false, mint: 'bench', keys: {} });
    if (pathname.startsWith('/api/')) return sendJson(res, 200, { ok: true, items: [] });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }

    if (pathname === '/auto') {
      res.writeHead(302, { Location: '/?bench=1&auto=1', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (pathname === '/' && !url.searchParams.has('bench') && !url.searchParams.has('nobench')) {
      res.writeHead(302, { Location: '/?bench=1', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (pathname === '/' || pathname === '/mint' || pathname === '/collection') {
      return serveFile(res, path.join(webDir, 'index.html'));
    }

    if (pathname === '/discord-sdk.js') {
      const built = path.join(distDir, 'discord-sdk.js');
      if (fs.existsSync(built)) return serveFile(res, built);
      const stub = Buffer.from('export class DiscordSDK {}\n');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': stub.length });
      res.end(stub);
      return;
    }

    if (pathname.startsWith('/assets/')) {
      const name = pathname.slice('/assets/'.length);
      if (ASSET_FILES.has(name)) {
        const assetPath = path.join(webDir, 'assets', name);
        if (fs.existsSync(assetPath)) return serveFile(res, assetPath);
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const clean = pathname.slice(1);
    if (WEB_FILES.has(clean)) {
      const p = path.join(webDir, clean);
      if (fs.existsSync(p)) return serveFile(res, p);
    }
    if (SHARED_FILES.has(clean)) {
      const p = path.join(sharedDir, clean);
      if (fs.existsSync(p)) return serveFile(res, p);
    }

    res.writeHead(404);
    res.end('Not found');
  });
}

if (require.main === module) {
  const server = createBenchServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Ububall Benchmark Server listening on port ${PORT}`);
    console.log(`  PC Interactive : http://127.0.0.1:${PORT}/?bench=1`);
    console.log(`  PC Auto-Run    : http://127.0.0.1:${PORT}/?bench=1&auto=1`);
    for (const ip of lanAddresses()) {
      console.log(`  Phone Auto-Run : http://${ip}:${PORT}/auto`);
      console.log(`  Phone Controls : http://${ip}:${PORT}/`);
    }
    console.log(`\nReports automatically save to: ${outDir}`);
  });
}

module.exports = { createBenchServer, formatSlug: sanitizeSlug, WEB_FILES, SHARED_FILES, ASSET_FILES };
