'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Browser-only effects live inside the game closure. Exercise their real source
// with a small canvas stub instead of introducing a production-facing test API.
const source = fs.readFileSync(require.resolve('../web/ububall.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'effect source boundary changed');
  return source.slice(a, b);
}

test('trail gradient retains a hot sample between cool endpoints', () => {
  const gradients = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    arc() {}, closePath() {}, fill() {},
    createLinearGradient() {
      const gradient = { stops: [], addColorStop(position, color) { this.stops.push({ position, color }); } };
      gradients.push(gradient);
      return gradient;
    }
  };
  const bodies = Array.from({ length: 6 }, () => ({ team: 0, x: 0, y: 0 }));
  bodies.push({ team: -1, x: 250, y: 300, vx: 250, vy: 0, radius: 18 });
  const trails = Array.from({ length: 7 }, () => []);
  trails[6] = [100, 150, 200].map((x, i) =>
    ({ x, y: 300, life: .2, duration: .24, heat: i === 1 ? 3 : 0 }));
  vm.runInNewContext(section('function drawTrails(home, away) {', 'function drawStickyTether(') +
    '\ndrawTrails("#fff", "#000");', {
      ctx, bodies, trails, ballHeat: () => 0,
      heatColor: (heat, alpha) => heat + ':' + alpha,
      hexToRgba: (color, alpha) => color + ':' + alpha
    });
  assert.equal(gradients.length, 1);
  assert.ok(gradients[0].stops.some(stop => stop.color.startsWith('3:')), 'intermediate heat was discarded');
});

test('ordinary particles keep their filled endpoint', () => {
  const radii = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    arc(x, y, radius) { radii.push(radius); }, fill() {}
  };
  vm.runInNewContext(section('function drawParticles(home, away, overlay = false) {', 'function kickoff(') +
    '\ndrawParticles("#fff", "#000");', {
      ctx, badgeCtx: ctx,
      particles: [{ x: 20, y: 40, px: 20, py: 40, life: 1, duration: 1, team: 0 }]
    });
  assert.deepEqual(radii, [.9]);
});

test('aura sprites reuse rounded radii and evict stale entries', () => {
  const document = { createElement() {
    const c = {
      scale() {}, createConicGradient() { return { addColorStop() {} }; },
      beginPath() {}, arc() {}, stroke() {}
    };
    return { getContext() { return c; } };
  } };
  const result = vm.runInNewContext(
    section('const conicRingSprites = new Map();', '// Super aura: ready') +
    '\nconst first = conicRingSprite("stalwart", 24.1, 3);' +
    '\nconst same = conicRingSprite("stalwart", 24.4, 3);' +
    '\nfor (let r = 1; r <= 100; r++) conicRingSprite("stalwart", r, 3);' +
    '\n({ same: first === same, size: conicRingSprites.size });',
    { document, SUPER_AURA_THEMES: {}, hexToRgba: () => 'rgba(0,0,0,1)' });
  assert.equal(result.same, true);
  assert.ok(result.size <= 48);
});

test('straight vertical shots skip threat simulation, but curved shots do not', () => {
  let steps = 0;
  const ball = { x: 500, y: 300, vx: 0, vy: 600, omega: 0, curveFactor: .045 };
  const bodies = Array.from({ length: 6 }, () => ({})).concat(ball);
  const P = { holder: () => false, DT: 1 / 240, step() { steps++; return null; } };
  const code = section('function goalThreat() {', '// Net ripples and board flex');
  vm.runInNewContext(code + '\ngoalThreat();', { P, bodies });
  assert.equal(steps, 0);
  ball.omega = 24;
  vm.runInNewContext(code + '\ngoalThreat();', { P, bodies });
  assert.ok(steps > 0, 'curved ball was incorrectly rejected');
});
