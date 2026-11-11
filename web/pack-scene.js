'use strict';
// Painted 2D wrappers (cellophane, foil, blob, gumball capsule, egg, gift box, fortune cookie,
// wax-sealed envelope). No 3D engine or geometry.
(() => {
  const clamp = n => Math.max(0, Math.min(1, n));
  const ease = (a, b, t) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
  const mix = (a, b, t) => a + (b - a) * t;
  let sharedGrainCanvas = null, sharedNoise = null;
  function getSharedGrain() {
    if (!sharedGrainCanvas) {
      sharedGrainCanvas = document.createElement('canvas');
      sharedGrainCanvas.width = sharedGrainCanvas.height = 128;
      const gCtx = sharedGrainCanvas.getContext('2d'), pixels = gCtx.createImageData(128, 128);
      sharedNoise = crypto.getRandomValues(new Uint8Array(128 * 128));
      for (let i = 0; i < sharedNoise.length; i++) {
        const value = sharedNoise[i] < 128 ? 0 : 255;
        pixels.data.set([value, value, value, 3 + sharedNoise[i] % 9], i * 4);
      }
      gCtx.putImageData(pixels, 0, 0);
    }
    return sharedGrainCanvas;
  }

  function createPackScene(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    let sheet = null, sheetCtx = null;
    let plasticPrint = null, plasticPrintCtx = null;
    let emboss = null, embossCtx = null;
    const ensureSheet = () => {
      if (!sheet) { sheet = document.createElement('canvas'); sheet.width = 1200; sheet.height = 720; sheetCtx = sheet.getContext('2d'); }
    };
    const ensurePlasticPrint = () => {
      if (!plasticPrint) { plasticPrint = document.createElement('canvas'); plasticPrint.width = 440; plasticPrint.height = 768; plasticPrintCtx = plasticPrint.getContext('2d'); }
    };
    const ensureEmboss = () => {
      if (!emboss) { emboss = document.createElement('canvas'); emboss.width = emboss.height = 320; embossCtx = emboss.getContext('2d'); }
    };
    let frame = 0, progress = 0, started = 0, finish = null, count = 5, pointer = 0, pointerY = 0;
    let aimX = 0, aimY = 0, lastPaint = 0;
    let blobCanvas, blobCtx, blobPixels, blobColors = [], blobFaces = [];
    let packHints = null;
    let color, candyColors, previousColor = -1, currentType = null;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const tokenCache = new Map();
    const logo = new Image(), mark = new Image();
    logo.onload = requestPaint;
    mark.onload = () => { tokenCache.clear(); requestPaint(); };
    logo.src = 'assets/uburoom-wordmark-brand.svg'; mark.src = 'assets/uburoom-oomark-brand.svg';
    const ububallLogo = new Image();
    ububallLogo.onload = requestPaint;
    ububallLogo.src = 'assets/ububall-logo.svg';

    // Fixed fine grain: shared across all pack scenes, so the material never sparkles at rest.
    const grain = getSharedGrain();
    const noise = sharedNoise;
    const grainPattern = ctx.createPattern(grain, 'repeat');

    function paletteColor(index) {
      if (typeof ubu !== 'undefined' && ubu.decode) {
        const dna = new Uint8Array(128); dna[8] = index << 3;
        return ubu.decode(dna).attributes.background.hex;
      }
      return '#3b82f6';
    }

    function tint(hex, amount) {
      const target = amount < 0 ? 0 : 255;
      return '#' + [1, 3, 5].map(i => Math.round(mix(parseInt(hex.slice(i, i + 2), 16), target, Math.abs(amount))).toString(16).padStart(2, '0')).join('');
    }

    function gradient(target, x1, y1, x2, y2, stops) {
      const g = target.createLinearGradient(x1, y1, x2, y2);
      for (const [at, value] of stops) g.addColorStop(at, value);
      return g;
    }

    function hintColors(target) {
      if (!packHints) return;
      target.fillStyle = packHints[0].background; target.fillRect(-135, -135, 270, 270);
      packHints.forEach((hint, i) => {
        const angle = i * Math.PI * 2 / 5 - Math.PI / 2, x = Math.cos(angle) * 58, y = Math.sin(angle) * 58;
        const wash = target.createRadialGradient(x, y, 12, x, y, 125);
        wash.addColorStop(0, hint.background); wash.addColorStop(.4, hint.background + 'dd'); wash.addColorStop(1, hint.background + '00');
        target.fillStyle = wash; target.fillRect(-135, -135, 270, 270);
      });
    }

    // --- Plastic Cellophane Wrapper ---
    let plasticCreases = [];
    function setupPlastic() {
      const rolls = crypto.getRandomValues(new Uint16Array(150));
      plasticCreases = Array.from({ length: 30 }, (_, i) => {
        const r = j => rolls[i * 5 + j] / 65535;
        return { x: r(0) * 220 - 110, y: r(1) * 270 - 135, dx: r(2) * 65 - 32, dy: r(3) * 85 + 15, strength: .08 + r(4) * .25 };
      });
    }

    function plasticSilhouette(flat, target) {
      const y = (closed, opened) => mix(closed, opened, flat);
      target.beginPath(); target.moveTo(-128, y(-12, -135));
      target.bezierCurveTo(-100, y(-14, -135), -108, y(-112, -135), 0, y(-112, -135));
      target.bezierCurveTo(108, y(-112, -135), 100, y(-14, -135), 128, y(-12, -135));
      target.lineTo(128, y(12, 135));
      target.bezierCurveTo(100, y(14, 135), 108, y(112, 135), 0, y(112, 135));
      target.bezierCurveTo(-108, y(112, 135), -100, y(14, 135), -128, y(12, 135));
      target.closePath();
    }

    function plasticFilm(side, flat, untwist, target) {
      const phase = side * (Math.PI * 2 + .18) * (1 - untwist);
      const flip = Math.cos(phase), swing = Math.sin(phase);
      const ribs = [];
      for (let j = 0; j <= 12; j++) {
        const v = j / 6 - 1, rib = [];
        for (let k = 0; k <= 8; k++) {
          const u = k / 8;
          const closedX = 124 + u * (26 + 96 * Math.sqrt(Math.max(0, 1 - v * v)));
          const closedY = mix(v * 12, v * 88, ease(0, 1, u));
          const crinkle = (Math.sin(k * 1.7 + j * 2.3 + side) * 3 + Math.sin(k * .9 - j * 1.8) * 1.4) * u * (1 - flat * .55);
          rib.push({
            x: mix(closedX + untwist * u * 22, 124 + u * 154, flat) + u * v * swing * 10 + Math.sin(j * 2.7 + k * .7) * u * 2,
            y: (mix(closedY, v * 135, flat) + crinkle) * flip + swing * u * (9 + Math.sin(j * 1.9 + side) * 6)
          });
        }
        ribs.push(rib);
      }
      target.save(); target.scale(side, 1);
      target.beginPath(); target.moveTo(ribs[0][0].x, ribs[0][0].y);
      for (let k = 1; k <= 8; k++) target.lineTo(ribs[0][k].x, ribs[0][k].y);
      for (let j = 1; j <= 12; j++) target.lineTo(ribs[j][8].x, ribs[j][8].y);
      for (let k = 7; k >= 0; k--) target.lineTo(ribs[12][k].x, ribs[12][k].y);
      target.closePath();
      target.fillStyle = gradient(target, 110, -96, 264, 94, [[0, '#9ebad72b'], [.2, '#e4f3ff60'], [.37, '#91b1cf1e'], [.57, '#d4e8f73c'], [.78, '#f4faff53'], [1, '#829fbf2c']]);
      target.fill(); target.clip();
      target.fillStyle = gradient(target, 110, 0, 260, 0, [[0, '#0d1b3070'], [.12, '#17283d25'], [.45, '#a5c8ff08'], [.88, '#ffffff33'], [1, '#c6dff50a']]);
      target.fillRect(108, -140, 180, 280);
      // Alternating transparent planes catch light along the gathered folds.
      for (let j = 0; j < 12; j++) {
        target.beginPath(); target.moveTo(ribs[j][0].x, ribs[j][0].y);
        for (let k = 1; k <= 8; k++) target.lineTo(ribs[j][k].x, ribs[j][k].y);
        for (let k = 8; k >= 0; k--) target.lineTo(ribs[j + 1][k].x, ribs[j + 1][k].y);
        target.closePath();
        target.fillStyle = gradient(target, 115, 0, 270, 0, [[0, '#ffffff00'], [.4, j % 2 ? '#15213128' : '#edf6ff25'], [1, '#ffffff00']]);
        target.fill();
      }
      for (const j of [2, 4, 7, 10]) {
        const rib = ribs[j];
        target.beginPath(); target.moveTo(rib[0].x, rib[0].y);
        for (let k = 0; k < 8; k++) {
          target.quadraticCurveTo(rib[k].x, rib[k].y, (rib[k].x + rib[k + 1].x) / 2, (rib[k].y + rib[k + 1].y) / 2);
        }
        target.lineTo(rib[8].x, rib[8].y);
        target.strokeStyle = `rgba(241,249,255,${.075 + .12 * Math.abs(Math.sin(j * .74 + phase * .5))})`;
        target.lineWidth = j === 4 || j === 10 ? 2.2 : 1.2;
        if (j === 4) { target.shadowColor = '#e8f5ff78'; target.shadowBlur = 8; }
        target.stroke(); target.shadowBlur = 0;
      }
      target.beginPath(); target.moveTo(ribs[0][8].x, ribs[0][8].y);
      for (let j = 1; j <= 12; j++) target.lineTo(ribs[j][8].x, ribs[j][8].y);
      target.strokeStyle = '#f0f8ff55'; target.lineWidth = 1; target.stroke();
      target.restore();
    }

    function plasticKnot(side, untwist, target) {
      const release = ease(.45, 1, untwist);
      if (release === 1) return;
      target.save(); target.scale(side, 1);
      target.globalAlpha *= 1 - release;
      target.translate(128, 0);
      target.beginPath(); target.moveTo(-13, -13);
      target.bezierCurveTo(-3, -22, 11, -19, 17, -10);
      target.bezierCurveTo(10, -3, 11, 6, 17, 12);
      target.bezierCurveTo(5, 21, -5, 18, -13, 12);
      target.quadraticCurveTo(-5, 0, -13, -13); target.closePath();
      target.fillStyle = gradient(target, -13, -18, 17, 18, [[0, '#c5d6e98c'], [.3, '#425368dd'], [.5, '#e3eeffb0'], [1, '#5d7498dd']]);
      target.fill(); target.strokeStyle = '#e5efff90'; target.lineWidth = .8; target.stroke();
      for (let i = -1; i <= 1; i++) {
        const shift = i * 7;
        target.beginPath(); target.moveTo(-11, shift - 7);
        target.bezierCurveTo(-4, shift - 3, 4, shift + 8, 13, shift + 5);
        target.strokeStyle = '#07101b95'; target.lineWidth = 3; target.stroke();
        target.strokeStyle = '#eef6ffc0'; target.lineWidth = 1; target.stroke();
      }
      target.restore();
    }

    function plasticTexture(target) {
      target.save(); plasticSilhouette(1, target); target.fillStyle = color; target.fill(); target.clip();
      hintColors(target);
      if (packHints?.some(h => h.textured)) {
        // Pearlescent heat-sealed seams across the top and bottom cellophane indicate a special finish in the pack.
        for (const [seamY, bend] of [[-64, -1], [64, 1]]) {
          target.save();
          const fold = () => {
            target.beginPath(); target.moveTo(-96, seamY);
            target.bezierCurveTo(-32, seamY + bend * 8, 32, seamY - bend * 6, 96, seamY + bend * 2);
          };
          fold();
          target.strokeStyle = '#10121760'; target.lineWidth = 5; target.stroke();
          target.strokeStyle = gradient(target, -80 + pointer * 25, 0, 80 + pointer * 25, 0,
            [[0, '#c8e9ed44'], [.28, '#e8d8f2bb'], [.5, '#fff9e8ee'], [.72, '#c8e9edbb'], [1, '#e8d8f244']]);
          target.lineWidth = 2.8; target.stroke();
          target.save(); target.translate(0, -1); fold();
          target.strokeStyle = '#ffffff85'; target.lineWidth = .7; target.stroke();
          target.restore();
          target.strokeStyle = '#ffffff55'; target.lineWidth = .75;
          for (let cx = -88; cx <= 88; cx += 8) {
            const tNorm = (cx + 96) / 192;
            const cy = seamY + (bend * 8 * (1 - tNorm) - bend * 6 * tNorm) * (1 - Math.abs(tNorm - .5) * 1.8);
            target.beginPath(); target.moveTo(cx, cy - 3); target.lineTo(cx + .5, cy + 3);
            target.stroke();
          }
          target.restore();
        }
      }
      for (const c of plasticCreases) {
        target.beginPath(); target.moveTo(c.x - 5, c.y);
        target.lineTo(c.x + c.dx * .55, c.y + c.dy * .38); target.lineTo(c.x + c.dx, c.y + c.dy);
        target.lineTo(c.x + c.dx * .55 + 8, c.y + c.dy * .38); target.closePath();
        target.fillStyle = gradient(target, c.x - 7, 0, c.x + 12, 0, [[0, '#00000000'], [.4, `rgba(0,0,0,${c.strength * .3})`], [.52, `rgba(255,255,255,${c.strength * .65})`], [1, '#ffffff00']]);
        target.fill();
        target.beginPath(); target.moveTo(c.x, c.y);
        target.lineTo(c.x + c.dx * .55, c.y + c.dy * .38); target.lineTo(c.x + c.dx, c.y + c.dy);
        target.strokeStyle = `rgba(0,0,0,${c.strength * .34})`; target.lineWidth = 1.25; target.stroke();
        target.translate(-.8, -.6); target.strokeStyle = `rgba(255,255,255,${c.strength * .75})`; target.lineWidth = .7; target.stroke(); target.translate(.8, .6);
      }
      const shineX = -70 + pointer * 22;
      target.fillStyle = gradient(target, shineX - 55, -135, shineX + 100, 135, [[0, '#ffffff00'], [.31, '#ffffff00'], [.4, '#ffffff50'], [.43, '#ffffffa0'], [.46, '#ffffff12'], [.57, '#ffffff00'], [.8, '#ffffff22'], [1, '#ffffff00']]);
      target.fillRect(-110, -135, 220, 270);
      // A narrow printed band leaves the colored cellophane visible above and below.
      target.fillStyle = gradient(target, 0, -29, 0, 29, [[0, '#101217b8'], [.5, '#101217e8'], [1, '#101217b8']]);
      target.fillRect(-112, -29, 224, 58);
      target.strokeStyle = '#ffffff40'; target.lineWidth = .6;
      for (const y of [-29, 29]) {
        target.beginPath(); target.moveTo(-110, y); target.lineTo(110, y); target.stroke();
      }
      if (logo.complete && logo.naturalWidth) target.drawImage(logo, -82, -25.6, 164, 51.2);
      // Continuous reflections sit over the ink as well as the film.
      target.fillStyle = gradient(target, shineX - 40, -135, shineX + 80, 135, [[0, '#ffffff00'], [.42, '#ffffff00'], [.46, '#ffffff38'], [.49, '#ffffff08'], [1, '#ffffff00']]);
      target.fillRect(-110, -135, 220, 270);
      target.fillStyle = grainPattern; target.fillRect(-128, -135, 256, 270);
      target.restore();
    }

    function plasticCenter(flat, target) {
      // Project the print onto the rounded body; only the flaps unwind.
      ensurePlasticPrint();
      plasticPrintCtx.resetTransform();
      plasticPrintCtx.fillStyle = color; plasticPrintCtx.fillRect(0, 0, 440, 768);
      plasticPrintCtx.setTransform(2, 0, 0, 2, 220, 384);
      plasticTexture(plasticPrintCtx);
      target.save(); plasticSilhouette(flat, target); target.clip();
      target.fillStyle = color; target.fillRect(-130, -135, 260, 270);
      for (let y = -135; y < 135; y++) {
        const latitude = Math.asin(Math.max(-1, Math.min(1, (y + .5) / 112)));
        const bulge = Math.cos(latitude) * (1 - flat);
        const surfaceY = mix(latitude * (135 / (Math.PI / 2)), y, flat) + pointerY * 7 * bulge;
        const sourceY = surfaceY + 192;
        target.drawImage(plasticPrint, 0, sourceY * 2, 440, 2, -128 + pointer * 7 * bulge, y, 256, 1.1);
      }
      target.globalAlpha *= 1 - flat * .8;
      target.fillStyle = gradient(target, 0, -112, 0, 112, [[0, '#000000a0'], [.16, '#ffffff35'], [.35, '#ffffff12'], [.58, '#00000008'], [.83, '#00000060'], [1, '#000000cc']]);
      target.fillRect(-130, -135, 260, 270);
      target.fillStyle = gradient(target, -128, 0, 128, 0, [[0, '#00000085'], [.18, '#00000020'], [.4, '#ffffff18'], [.68, '#ffffff00'], [.86, '#00000030'], [1, '#00000085']]);
      target.fillRect(-130, -135, 260, 270);
      const glow = target.createRadialGradient(-28 + pointer * 24, -46 + pointerY * 22, 2, -20, -28, 100);
      glow.addColorStop(0, '#ffffff48'); glow.addColorStop(.45, '#ffffff12'); glow.addColorStop(1, '#ffffff00');
      target.fillStyle = glow; target.fillRect(-130, -135, 260, 270);
      // Gathered folds cross the colored shoulders into the clear necks.
      for (const side of [-1, 1]) {
        target.save(); target.scale(side, 1);
        target.fillStyle = gradient(target, 92, 0, 130, 0, [[0, '#dcefff00'], [1, '#dcefff60']]);
        target.fillRect(92, -80, 40, 160);
        for (let i = -2; i <= 2; i++) {
          target.beginPath(); target.moveTo(88, i * 18);
          target.quadraticCurveTo(107, i * 8, 130, i * 4);
          target.strokeStyle = i % 2 ? '#ffffff50' : '#00000030'; target.lineWidth = 1; target.stroke();
        }
        target.restore();
      }
      target.restore();
    }

    function renderPlastic(t) {
      ensureSheet();
      const untwist = ease(.03, .49, t), flat = ease(.49, .65, t), peel = ease(.59, .94, t);
      sheetCtx.resetTransform(); sheetCtx.clearRect(0, 0, sheet.width, sheet.height);
      sheetCtx.setTransform(2, 0, 0, 2, 600, 360);
      sheetCtx.save();
      for (const side of [-1, 1]) plasticFilm(side, flat, untwist, sheetCtx);
      plasticCenter(flat, sheetCtx);
      sheetCtx.restore();
      plasticKnot(-1, untwist, sheetCtx); plasticKnot(1, untwist, sheetCtx);

      ctx.save(); ctx.globalAlpha = 1 - ease(.86, .96, t);
      ctx.rotate(-.09);
      if (!peel) {
        ctx.drawImage(sheet, -300, -180, 600, 360); ctx.restore(); return;
      }
      const fold = mix(-180, 235, peel), radius = 24;
      const foldedY = y => {
        if (y >= fold) return y;
        const distance = fold - y, arc = Math.min(distance / radius, Math.PI);
        return fold - radius * Math.sin(arc) + Math.max(0, distance - Math.PI * radius) * .28;
      };
      for (let y = 179; y >= -180; y--) {
        const top = foldedY(y), bottom = foldedY(y + 1);
        ctx.save(); ctx.translate(0, top); ctx.scale(1, bottom < top ? -1 : 1);
        ctx.drawImage(sheet, 0, (y + 180) * 2, 1200, 2, -300, 0, 600, Math.abs(bottom - top) + .7);
        ctx.restore();
      }
      ctx.restore();
    }

    // --- Crinkly Reflective Circular Foil Wrapper ---
    let foilCreases = [], foilTear = [], foilShards = [], foilRimPoints = [];
    function setupFoil() {
      const rolls = crypto.getRandomValues(new Uint16Array(600));
      let idx = 0;
      const r = () => rolls[idx++ % rolls.length] / 65535;

      // Circular gathered foil rim with organic crumple matching 110px candy radius
      foilRimPoints = [];
      const rimSegments = 36;
      for (let i = 0; i < rimSegments; i++) {
        const theta = (i / rimSegments) * Math.PI * 2;
        const radius = 112 + Math.sin(theta * 3 + .4) * 2 + (r() - 0.5) * 3;
        foilRimPoints.push({
          theta,
          x: Math.cos(theta) * radius,
          y: Math.sin(theta) * radius * 1.06
        });
      }

      foilCreases = [];
      // Micro-crinkles pressed across the circular face
      for (let i = 0; i < 32; i++) {
        const angle = r() * Math.PI * 2;
        const dist = Math.sqrt(r()) * 96;
        const cx = Math.cos(angle) * dist;
        const cy = Math.sin(angle) * dist;
        const creaseAngle = r() * Math.PI * 2;
        const len = 8 + r() * 23;
        foilCreases.push({
          x: cx, y: cy,
          dx: Math.cos(creaseAngle) * len,
          dy: Math.sin(creaseAngle) * len,
          normal: creaseAngle + Math.PI / 2,
          strength: 0.08 + r() * 0.22,
          facet: (r() - 0.5) * 10
        });
      }

      // Radial creases gathered from the perimeter into the candy body
      for (let i = 0; i < 28; i++) {
        const theta = (i / 28) * Math.PI * 2 + (r() - 0.5) * 0.2;
        const rOuter = 114;
        const rInner = 87 + r() * 20;
        const x1 = Math.cos(theta) * rOuter, y1 = Math.sin(theta) * rOuter;
        const x2 = Math.cos(theta) * rInner, y2 = Math.sin(theta) * rInner;
        foilCreases.push({
          x: x1, y: y1,
          dx: x2 - x1, dy: y2 - y1,
          normal: theta + Math.PI / 2,
          strength: 0.12 + r() * 0.22,
          facet: (r() - 0.5) * 8
        });
      }

      // Jagged tear path across the circular candy
      foilTear = [];
      const segments = 16;
      for (let i = 0; i <= segments; i++) {
        const tx = -135 + (270 / segments) * i;
        const wave = Math.sin((i / segments) * Math.PI) * 12 - 6;
        const jagged = (r() - 0.5) * 20;
        foilTear.push({ x: tx, y: wave + jagged });
      }

      // Detached flying foil shards along the rip
      foilShards = Array.from({ length: 6 }, (_, i) => ({
        x: (i - 2.5) * 40 + (r() - 0.5) * 22,
        y: (r() - 0.5) * 20,
        vx: (r() - 0.5) * 130,
        vy: (i % 2 === 0 ? -1 : 1) * (70 + r() * 95),
        rot: (r() - 0.5) * 8,
        size: 7 + r() * 11
      }));
    }

    function foilContour(target) {
      target.beginPath();
      if (!foilRimPoints.length) { target.arc(0, 0, 114, 0, Math.PI * 2); return; }
      const last = foilRimPoints[foilRimPoints.length - 1], first = foilRimPoints[0];
      target.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
      for (let i = 0; i < foilRimPoints.length; i++) {
        const p = foilRimPoints[i], next = foilRimPoints[(i + 1) % foilRimPoints.length];
        target.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
      }
      target.closePath();
    }

    function drawCurledFoilEdge(target, points, dir, rip) {
      const curl = Math.min(22, rip * 28);
      if (curl < 0.5) return;
      const offsetPoints = [];
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const prev = points[Math.max(0, i - 1)];
        const next = points[Math.min(points.length - 1, i + 1)];
        const dx = next.x - prev.x, dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * dir * curl;
        const ny = (dx / len) * dir * curl;
        offsetPoints.push({ x: p.x + nx, y: p.y + ny });
      }
      target.beginPath();
      target.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) target.lineTo(points[i].x, points[i].y);
      for (let i = offsetPoints.length - 1; i >= 0; i--) target.lineTo(offsetPoints[i].x, offsetPoints[i].y);
      target.closePath();
      const grad = gradient(target, 0, -curl, 0, curl, [
        [0, '#ffffff'],
        [0.2, '#eef4fa'],
        [0.45, '#94a3b8'],
        [0.75, '#475569'],
        [0.9, '#cbd5e1'],
        [1, '#ffffff']
      ]);
      target.fillStyle = grad;
      target.fill();
      target.beginPath();
      target.moveTo(offsetPoints[0].x, offsetPoints[0].y);
      for (let i = 1; i < offsetPoints.length; i++) target.lineTo(offsetPoints[i].x, offsetPoints[i].y);
      target.strokeStyle = '#ffffffee';
      target.lineWidth = 1.3;
      target.stroke();
    }

    function renderFoilSheet() {
      ensureSheet();
      sheetCtx.resetTransform(); sheetCtx.clearRect(0, 0, sheet.width, sheet.height);
      sheetCtx.setTransform(2, 0, 0, 2, 600, 360);

      sheetCtx.save();
      foilContour(sheetCtx);
      sheetCtx.fillStyle = color; sheetCtx.fill(); sheetCtx.clip();
      hintColors(sheetCtx);

      // 3D Spherical Volume Shading across circular candy
      const lx = -36 + pointer * 30, ly = -45 + pointerY * 28;
      const spherical = sheetCtx.createRadialGradient(lx, ly, 6, 4, 8, 132);
      spherical.addColorStop(0, packHints ? '#ffffff88' : tint(color, .72));
      spherical.addColorStop(0.25, packHints ? '#ffffff33' : tint(color, 0.38));
      spherical.addColorStop(0.48, packHints ? '#ffffff00' : color);
      spherical.addColorStop(0.78, packHints ? '#00000060' : tint(color, -0.38));
      spherical.addColorStop(1, packHints ? '#000000bb' : tint(color, -0.76));
      sheetCtx.fillStyle = spherical; sheetCtx.fillRect(-135, -135, 270, 270);

      // Crimped / gathered foil flutes around circular rim
      for (const pt of foilRimPoints) {
        const reach = .92 + .035 * Math.sin(pt.theta * 7);
        const innerX = pt.x * reach, innerY = pt.y * reach;
        // Small alternating facets make the gathered edge read as folded metal.
        sheetCtx.beginPath(); sheetCtx.moveTo(pt.x, pt.y);
        sheetCtx.lineTo(innerX, innerY);
        sheetCtx.lineTo(pt.x - Math.sin(pt.theta) * 4, pt.y + Math.cos(pt.theta) * 4);
        sheetCtx.closePath();
        sheetCtx.fillStyle = Math.cos(pt.theta + .8) < 0 ? '#ffffff28' : '#00000028';
        sheetCtx.fill();
        sheetCtx.beginPath(); sheetCtx.moveTo(pt.x, pt.y); sheetCtx.lineTo(innerX, innerY);
        sheetCtx.strokeStyle = 'rgba(0,0,0,0.20)'; sheetCtx.lineWidth = 1.2; sheetCtx.stroke();
        sheetCtx.beginPath(); sheetCtx.moveTo(pt.x + 1.2, pt.y + 0.8); sheetCtx.lineTo(innerX + 1.2, innerY + 0.8);
        sheetCtx.strokeStyle = 'rgba(255,255,255,0.20)'; sheetCtx.lineWidth = .7; sheetCtx.stroke();
      }

      // 3D Crinkles & Creases pressed against the circular candy
      for (const c of foilCreases) {
        const lightAngle = Math.atan2(ly - c.y, lx - c.x);
        const dot = Math.cos(c.normal - lightAngle);
        const glint = Math.max(0, dot), shade = Math.max(0, -dot);

        sheetCtx.beginPath();
        sheetCtx.moveTo(c.x, c.y);
        sheetCtx.lineTo(c.x + c.dx, c.y + c.dy);
        sheetCtx.lineTo(c.x + c.dx * 0.5 + Math.cos(c.normal) * c.facet, c.y + c.dy * 0.5 + Math.sin(c.normal) * c.facet);
        sheetCtx.closePath();
        sheetCtx.fillStyle = `rgba(${glint > shade ? '255,255,255' : '0,0,0'}, ${c.strength * Math.max(glint, shade) * 0.38})`;
        sheetCtx.fill();

        sheetCtx.beginPath(); sheetCtx.moveTo(c.x, c.y);
        sheetCtx.quadraticCurveTo(c.x + c.dx * .5 + Math.cos(c.normal) * c.facet, c.y + c.dy * .5 + Math.sin(c.normal) * c.facet, c.x + c.dx, c.y + c.dy);
        sheetCtx.strokeStyle = `rgba(0,0,0, ${c.strength * (0.35 + 0.55 * shade)})`; sheetCtx.lineWidth = 1.4; sheetCtx.stroke();
        sheetCtx.beginPath(); sheetCtx.moveTo(c.x - 0.7, c.y - 0.5);
        sheetCtx.quadraticCurveTo(c.x + c.dx * .5 + Math.cos(c.normal) * c.facet - .7, c.y + c.dy * .5 + Math.sin(c.normal) * c.facet - .5, c.x + c.dx - .7, c.y + c.dy - .5);
        sheetCtx.strokeStyle = `rgba(255,255,255, ${c.strength * (0.3 + 0.75 * glint)})`; sheetCtx.lineWidth = 0.95; sheetCtx.stroke();
      }

      // Sweeping anisotropic metallic reflection
      const shineX = -40 + pointer * 65;
      sheetCtx.fillStyle = gradient(sheetCtx, shineX - 70, -110, shineX + 90, 110, [
        [0, 'rgba(255,255,255,0)'],
        [0.32, 'rgba(255,255,255,0)'],
        [0.40, 'rgba(255,255,255,0.3)'],
        [0.44, 'rgba(255,255,255,0.48)'],
        [0.48, 'rgba(255,255,255,0.18)'],
        [0.60, 'rgba(255,255,255,0)'],
        [0.76, 'rgba(255,255,255,0.22)'],
        [1, 'rgba(255,255,255,0)']
      ]);
      sheetCtx.fillRect(-135, -135, 270, 270);

      // Tint the SVG alpha mask to the foil: offset light and shade form a relief,
      // while the face picks up the same directional metallic reflection.
      if (mark.complete && mark.naturalWidth) {
        ensureEmboss();
        sheetCtx.save();
        sheetCtx.translate(pointer * 9, pointerY * 8 - 3);
        sheetCtx.scale(.88, .88);
        embossCtx.clearRect(0, 0, 320, 320);
        embossCtx.drawImage(mark, 0, 0, 320, 320);
        embossCtx.globalCompositeOperation = 'source-in';
        embossCtx.fillStyle = tint(color, -.65); embossCtx.fillRect(0, 0, 320, 320);
        sheetCtx.drawImage(emboss, -67 + 1.5, -67 + 1.8, 134, 134);
        embossCtx.fillStyle = tint(color, .8); embossCtx.fillRect(0, 0, 320, 320);
        sheetCtx.drawImage(emboss, -67 - 1, -67 - 1.2, 134, 134);
        embossCtx.fillStyle = gradient(embossCtx, 0, 0, 320, 320, [[0, tint(color, .48)], [.35, tint(color, .12)], [.52, tint(color, .45)], [.6, color], [1, tint(color, -.3)]]);
        embossCtx.fillRect(0, 0, 320, 320);
        sheetCtx.drawImage(emboss, -67, -67, 134, 134);
        embossCtx.globalCompositeOperation = 'source-over';
        sheetCtx.restore();
      }

      sheetCtx.fillStyle = grainPattern; sheetCtx.fillRect(-135, -135, 270, 270);
      if (packHints?.some(h => h.textured)) {
        // An impressed mint seal stamped into the foil indicates a special finish in the pack.
        sheetCtx.save();
        sheetCtx.translate(pointer * 4, 80 + pointerY * 4);
        for (const [offset, stroke] of [[1.1, '#101217a0'], [-0.8, '#ffffffc0']]) {
          sheetCtx.beginPath(); sheetCtx.ellipse(offset, offset, 14, 9, 0, 0, Math.PI * 2);
          sheetCtx.strokeStyle = stroke; sheetCtx.lineWidth = 1.3; sheetCtx.stroke();
        }
        sheetCtx.beginPath(); sheetCtx.ellipse(0, 0, 11, 6.8, 0, 0, Math.PI * 2);
        sheetCtx.strokeStyle = '#ffffff60'; sheetCtx.lineWidth = .7; sheetCtx.stroke();
        sheetCtx.strokeStyle = '#ffffffaa'; sheetCtx.lineWidth = .9;
        for (let j = -2; j <= 2; j++) {
          sheetCtx.beginPath();
          sheetCtx.moveTo(j * 3.5 - 1, -3);
          sheetCtx.lineTo(j * 3.5 + 1, 3);
          sheetCtx.stroke();
        }
        sheetCtx.restore();
      }

      sheetCtx.restore();
    }

    function renderFoil(t) {
      const rip = ease(0.08, 0.65, t);
      renderFoilSheet();

      // Ambient drop shadow ONLY when unopened (never casts on top of revealed ubus)
      if (!rip) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(-pointer * 8, 123 - pointerY * 3, 78, 9, 0, 0, Math.PI * 2);
        ctx.shadowColor = '#00000070'; ctx.shadowBlur = 14;
        ctx.fillStyle = '#00000024';
        ctx.fill();
        ctx.restore();
        // A soft lower shoulder stays behind the domed face as it tilts.
        ctx.save(); ctx.translate(-pointer * 6, 5 - pointerY * 5); ctx.scale(.99, .99);
        foilContour(ctx);
        ctx.fillStyle = gradient(ctx, -90, -100, 90, 120, [[0, tint(color, -.32)], [1, tint(color, -.78)]]);
        ctx.fill(); ctx.restore();
        ctx.drawImage(sheet, -300, -180, 600, 360);
        return;
      }

      // Foil rips away in 3D: separating top and bottom flaps
      const openY = rip * 165, openX = rip * 24, rot = rip * 0.22;
      const fade = 1 - ease(0.80, 0.95, t);

      // Upper torn flap: curls up and peels away
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(-openX, -openY);
      ctx.rotate(-rot);
      ctx.scale(1 - rip * 0.08, 1 - rip * 0.16);
      ctx.beginPath();
      ctx.moveTo(-300, -180);
      ctx.lineTo(300, -180);
      ctx.lineTo(300, foilTear[foilTear.length - 1].y);
      for (let i = foilTear.length - 1; i >= 0; i--) ctx.lineTo(foilTear[i].x, foilTear[i].y);
      ctx.lineTo(-300, foilTear[0].y);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(sheet, -300, -180, 600, 360);
      foilContour(ctx); ctx.clip();
      drawCurledFoilEdge(ctx, foilTear, -1, rip);
      ctx.restore();

      // Lower torn flap: curls down and peels away
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(openX, openY);
      ctx.rotate(rot * 0.85);
      ctx.scale(1 - rip * 0.06, 1 - rip * 0.14);
      ctx.beginPath();
      ctx.moveTo(-300, 180);
      ctx.lineTo(300, 180);
      ctx.lineTo(300, foilTear[foilTear.length - 1].y);
      for (let i = foilTear.length - 1; i >= 0; i--) ctx.lineTo(foilTear[i].x, foilTear[i].y);
      ctx.lineTo(-300, foilTear[0].y);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(sheet, -300, -180, 600, 360);
      foilContour(ctx); ctx.clip();
      drawCurledFoilEdge(ctx, foilTear, 1, rip);
      ctx.restore();

      // Flying detached foil shards
      if (rip > 0.08) {
        ctx.save();
        ctx.globalAlpha = fade;
        for (const s of foilShards) {
          const sz = s.size || 8;
          const sx = s.x + s.vx * rip;
          const sy = s.y + s.vy * rip;
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(s.rot * rip * 3);
          ctx.beginPath();
          ctx.moveTo(-sz, -sz * 0.4);
          ctx.lineTo(sz * 0.8, -sz * 0.7);
          ctx.lineTo(sz * 0.3, sz * 0.8);
          ctx.closePath();
          ctx.fillStyle = gradient(ctx, -sz, -sz, sz, sz, [[0, '#ffffff'], [0.4, '#c8d7e6'], [0.8, color], [1, '#485869']]);
          ctx.fill();
          ctx.strokeStyle = '#ffffff99';
          ctx.lineWidth = 0.9;
          ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      }
    }

    // --- Starter pack: a horizontal foil trading-card pack, crimped at both ends ---
    const STARTER_W = 262, STARTER_H = 132, STARTER_CRIMP = 24;
    let starterLabel = '', starterTear = [];
    function setupStarter() {
      const rolls = crypto.getRandomValues(new Uint8Array(13));
      starterTear = Array.from(rolls, (roll, i) => ({ x: -STARTER_W + 48 + roll / 255 * 12, y: -STARTER_H + i * STARTER_H * 2 / 12 }));
    }
    function starterShape(target) {
      const teeth = 11, step = STARTER_H * 2 / teeth;
      target.beginPath(); target.moveTo(-STARTER_W, -STARTER_H); target.lineTo(STARTER_W, -STARTER_H);
      for (let i = 0; i < teeth; i++) { target.lineTo(STARTER_W - 6, -STARTER_H + (i + .5) * step); target.lineTo(STARTER_W, -STARTER_H + (i + 1) * step); }
      target.lineTo(-STARTER_W, STARTER_H);
      for (let i = teeth; i > 0; i--) { target.lineTo(-STARTER_W + 6, -STARTER_H + (i - .5) * step); target.lineTo(-STARTER_W, -STARTER_H + (i - 1) * step); }
      target.closePath();
    }
    function starterFace() {
      ctx.save();
      starterShape(ctx); ctx.clip();
      ctx.fillStyle = gradient(ctx, -STARTER_W, -STARTER_H, STARTER_W, STARTER_H, [[0, tint(color, -.35)], [.3, color], [.48, tint(color, .34)], [.6, color], [1, tint(color, -.48)]]);
      ctx.fillRect(-STARTER_W, -STARTER_H, STARTER_W * 2, STARTER_H * 2);
      // A band of light follows the pointer across the foil, and fine ridges catch it.
      const shine = pointer * 120;
      ctx.fillStyle = gradient(ctx, shine - 170, -STARTER_H, shine + 170, STARTER_H, [[0, '#ffffff00'], [.5, '#ffffff42'], [1, '#ffffff00']]);
      ctx.fillRect(-STARTER_W, -STARTER_H, STARTER_W * 2, STARTER_H * 2);
      ctx.fillStyle = grainPattern; ctx.fillRect(-STARTER_W, -STARTER_H, STARTER_W * 2, STARTER_H * 2);
      for (const side of [-1, 1]) {
        const edge = side * STARTER_W, inner = edge - side * STARTER_CRIMP;
        ctx.fillStyle = gradient(ctx, inner, 0, edge, 0, [[0, '#0000002e'], [.25, '#ffffff30'], [1, '#00000040']]);
        ctx.fillRect(Math.min(edge, inner), -STARTER_H, STARTER_CRIMP, STARTER_H * 2);
        ctx.strokeStyle = '#ffffff30'; ctx.lineWidth = 1;
        for (let x = 4; x < STARTER_CRIMP; x += 4) { ctx.beginPath(); ctx.moveTo(edge - side * x, -STARTER_H); ctx.lineTo(edge - side * x, STARTER_H); ctx.stroke(); }
      }
      ctx.fillStyle = gradient(ctx, 0, -STARTER_H, 0, STARTER_H, [[0, '#ffffff38'], [.14, '#ffffff00'], [.86, '#00000000'], [1, '#00000052']]);
      ctx.fillRect(-STARTER_W, -STARTER_H, STARTER_W * 2, STARTER_H * 2);
      if (ububallLogo.complete && ububallLogo.naturalWidth) {
        const width = 300, height = width * ububallLogo.naturalHeight / ububallLogo.naturalWidth;
        ctx.save(); ctx.shadowColor = '#00000070'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
        ctx.drawImage(ububallLogo, pointer * 5 - width / 2, pointerY * 3 - height / 2 - 26, width, height);
        ctx.restore();
      }
      ctx.font = "34px 'Uburoom Sans', Inter, sans-serif"; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#00000060'; ctx.fillText(starterLabel, pointer * 5, 79 + pointerY * 3);
      ctx.fillStyle = '#fff'; ctx.fillText(starterLabel, pointer * 5, 77 + pointerY * 3);
      ctx.restore();
    }
    function starterSide(strip) {
      ctx.beginPath(); ctx.moveTo(strip ? -STARTER_W - 8 : STARTER_W + 8, -STARTER_H - 8);
      for (const point of starterTear) ctx.lineTo(point.x, point.y);
      ctx.lineTo(strip ? -STARTER_W - 8 : STARTER_W + 8, STARTER_H + 8); ctx.closePath(); ctx.clip();
    }
    function renderStarter(t) {
      const rip = ease(.05, .3, t), slide = ease(.28, .72, t);
      if (!rip) {
        ctx.save(); ctx.beginPath(); ctx.ellipse(-pointer * 8, STARTER_H + 16, STARTER_W * .8, 11, 0, 0, Math.PI * 2);
        ctx.shadowColor = '#00000070'; ctx.shadowBlur = 14; ctx.fillStyle = '#00000024'; ctx.fill(); ctx.restore();
        starterFace();
        return;
      }
      // The end strip tears away, then the open pack drops to let the ubus out.
      ctx.save(); ctx.globalAlpha = 1 - ease(.25, .5, t);
      ctx.translate(-rip * 70, -rip * 90); ctx.rotate(-rip * .45);
      starterSide(true); starterFace(); ctx.restore();
      ctx.save(); ctx.globalAlpha = 1 - ease(.62, .78, t);
      ctx.translate(0, slide * 300);
      starterSide(false); starterFace(); ctx.restore();
    }

    // Compact-support metaballs merge into one surface, then pinch apart.
    // The small raster is reused; all colors and grain remain fixed per pack.
    function setupBlob() {
      if (!blobCanvas) {
        blobCanvas = document.createElement('canvas');
        blobCanvas.width = 400; blobCanvas.height = 240;
        blobCtx = blobCanvas.getContext('2d');
        blobPixels = blobCtx.createImageData(400, 240);
      }
      const indices = [];
      while (indices.length < 5) {
        const index = crypto.getRandomValues(new Uint8Array(1))[0] & 31;
        if (!indices.includes(index)) indices.push(index);
      }
      blobColors = indices.map(index => {
        const hex = paletteColor(index);
        return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      });
      blobFaces = [];
    }

    function renderBlob(t) {
      const split = ease(.10, .60, t), become = ease(.67, .84, t);
      const radius = mix(96, 66, split);
      const lobes = Array.from({ length: count }, (_, i) => {
        const angle = i * Math.PI * 2 / count - Math.PI / 2;
        return {
          x: mix(Math.cos(angle) * (48 + Math.sin(i * 3) * 12), (i - (count - 1) / 2) * 104, split),
          y: mix(Math.sin(angle) * (43 + Math.cos(i * 2) * 12), 0, split) + Math.sin(t * 12 + i * 2) * 5 * Math.sin(split * Math.PI),
          invRadius2: 1 / (radius * mix(1 + Math.sin(i * 2 + .5) * .13, 1, split)) ** 2
        };
      });
      const pixels = blobPixels.data;
      if (become < 1) {
        for (let py = 0; py < 240; py++) {
          const y = (py + .5) * 1.5 - 180;
          for (let px = 0; px < 400; px++) {
            const x = (px + .5) * 1.5 - 300, offset = (py * 400 + px) * 4;
            let field = 0, nx = 0, ny = 0, red = 0, green = 0, blue = 0, weight = 0;
            for (let i = 0; i < count; i++) {
              const dx = x - lobes[i].x, dy = y - lobes[i].y;
              const invRadius2 = lobes[i].invRadius2;
              const a = Math.max(0, 1 - (dx * dx + dy * dy) * invRadius2);
              if (!a) continue;
              const value = a * a * a, pigment = value * value;
              field += value;
              nx += dx * a * a * invRadius2 * 140;
              ny += dy * a * a * invRadius2 * 140;
              const rgb = blobColors[i % 5];
              red += rgb[0] * pigment; green += rgb[1] * pigment; blue += rgb[2] * pigment; weight += pigment;
            }
            const alpha = clamp((field - .22) * 28);
            pixels[offset + 3] = Math.round(alpha * 255);
            if (!alpha) continue;
            const normal = Math.hypot(nx, ny, .7);
            const light = clamp((nx * (-.38 + pointer * .22) + ny * (-.48 + pointerY * .22) + .64) / normal);
            const sheen = Math.pow(light, 12) * 58;
            const powder = (noise[(py % 128) * 128 + px % 128] / 255 - .5) * 10;
            const shade = .48 + light * .65;
            pixels[offset] = red / weight * shade + sheen + powder;
            pixels[offset + 1] = green / weight * shade + sheen + powder;
            pixels[offset + 2] = blue / weight * shade + sheen + powder;
          }
        }
        blobCtx.putImageData(blobPixels, 0, 0);
        if (packHints?.some(h => h.textured)) {
          blobCtx.save(); blobCtx.globalCompositeOperation = 'source-atop';
          blobCtx.setTransform(2 / 3, 0, 0, 2 / 3, 200, 120);
          // Pearly mica-like flecks embedded throughout the putty body indicate a special finish in the pack.
          for (let i = 0; i < count; i++) {
            const lobe = lobes[i];
            if (!lobe) continue;
            for (let j = 0; j < 18; j++) {
              const angle = j * 2.39996 + i * 1.25, spread = Math.sqrt((j + .5) / 18);
              const x = lobe.x + Math.cos(angle) * spread * 27;
              const y = lobe.y + Math.sin(angle) * spread * 16;
              const glint = .35 + .45 * Math.max(0, Math.cos(angle - pointer * .8 - pointerY * .5));
              blobCtx.beginPath(); blobCtx.ellipse(x, y, 1.1 + (j % 3) * .35, .65, angle, 0, Math.PI * 2);
              blobCtx.fillStyle = `rgba(249,241,221,${glint})`; blobCtx.fill();
              blobCtx.beginPath(); blobCtx.ellipse(x + .4, y + 1, 1, .4, angle, 0, Math.PI * 2);
              blobCtx.fillStyle = '#10121745'; blobCtx.fill();
            }
          }
          blobCtx.restore();
        }
      }
      ctx.save(); ctx.globalAlpha = 1 - ease(.94, 1, t);
      if (become < 1) {
        ctx.save(); ctx.globalAlpha *= 1 - become;
        ctx.drawImage(blobCanvas, -300, -180, 600, 360); ctx.restore();
      }
      if (become) {
        ctx.globalAlpha *= become;
        for (let i = 0; i < count; i++) {
          const { x, y } = lobes[i], face = blobFaces[i];
          if (face) ctx.drawImage(face, x - 43, y - 43, 86, 86);
          else {
            // Standalone previews without minted models use the brand face.
            candy(x, y, `rgb(${blobColors[i % 5].join(',')})`, 0, 42);
          }
        }
      }
      ctx.restore();
    }

    async function prepareBlobFaces(models) {
      if (typeof ubuRender !== 'function') return [];
      return Promise.all(models.slice(0, count).map(async model => {
        let url;
        try {
          const svg = ubuRender(model, 'pack-preview');
          svg.setAttribute('width', '180'); svg.setAttribute('height', '180');
          url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
          const face = new Image(); face.src = url; await face.decode(); return face;
        } catch { return null; }
        finally { if (url) URL.revokeObjectURL(url); }
      }));
    }

    // Shared by the newer wrappers: the pack's hint colours, and whether it holds a special finish.
    const hintHex = i => packHints?.length ? packHints[i % packHints.length].background : candyColors[i % candyColors.length];
    const special = () => Boolean(packHints?.some(h => h.textured));
    function ball(x, y, r, hex) {
      const shade = ctx.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r);
      shade.addColorStop(0, tint(hex, .55)); shade.addColorStop(.45, hex); shade.addColorStop(1, tint(hex, -.4));
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = shade; ctx.fill();
    }

    // --- Gumball Capsule ---
    // A clear dome shows five gumballs in the pack's background colours over an opaque base;
    // glitter in the base plastic hints at a special finish. It twists, pops apart and lets them out.
    let gumballs = [], glitter = [];
    function setupGumball() {
      const rolls = crypto.getRandomValues(new Uint16Array(90)), u = i => rolls[i] / 65535;
      gumballs = [[-54, -24], [0, -26], [54, -24], [-27, -70], [27, -70]].map(([x, y], i) => ({ x: x + u(i) * 6 - 3, y: y + u(i + 5) * 6 - 3 }));
      glitter = Array.from({ length: 36 }, (_, i) => ({ a: .15 + u(10 + i) * 2.85, d: .25 + u(50 + i) * .65, s: .8 + u(i + 20) * 1.6 }));
    }
    function renderGumball(t) {
      const twist = ease(.04, .34, t), pop = ease(.34, .48, t), away = ease(.44, .6, t);
      const R = 112, base = hintHex(0), shake = Math.sin(t * 110) * 2.4 * Math.sin(Math.PI * twist);
      ctx.save(); ctx.translate(shake, 10);
      ctx.save(); ctx.globalAlpha = 1 - away;
      ctx.beginPath(); ctx.ellipse(0, R + 6, R * .8, 10, 0, 0, Math.PI * 2); ctx.fillStyle = '#00000038'; ctx.filter = 'blur(6px)'; ctx.fill(); ctx.filter = 'none';
      ctx.restore();
      // Opaque base half, with a lip at the seam.
      ctx.save(); ctx.globalAlpha = 1 - away; ctx.translate(0, pop * 22 + away * 120);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI); ctx.closePath();
      ctx.fillStyle = gradient(ctx, -R, 0, R * .6, R, [[0, tint(base, .3)], [.45, base], [1, tint(base, -.5)]]); ctx.fill();
      if (special()) {
        for (const g of glitter) {
          const x = Math.cos(g.a) * g.d * R, y = Math.sin(g.a) * g.d * R;
          ctx.globalAlpha = (1 - away) * (.35 + .65 * Math.abs(Math.sin(g.a * 7 + pointer * 2.5 + pointerY)));
          ctx.fillStyle = '#fff8e6'; ctx.fillRect(x - g.s / 2, y - g.s / 2, g.s, g.s);
        }
        ctx.globalAlpha = 1 - away;
      }
      ctx.fillStyle = gradient(ctx, -R, 0, R, 0, [[0, tint(base, .45)], [.5, tint(base, .15)], [1, tint(base, -.3)]]);
      ctx.fillRect(-R, -2, R * 2, 10);
      ctx.restore();
      // Gumballs jump as the dome pops, then give way to the ubus.
      ctx.save(); ctx.globalAlpha = 1 - ease(.44, .58, t);
      gumballs.forEach((g, i) => ball(g.x, g.y - Math.sin(Math.PI * pop) * (22 + i * 4), 25, hintHex(i)));
      ctx.restore();
      // Clear dome: tick marks along its rim travel as it twists; it then flies off.
      ctx.save(); ctx.globalAlpha = 1 - away;
      ctx.translate(away * 60, -pop * 60 - away * 170); ctx.rotate(-pop * .3 - away * .5);
      ctx.beginPath(); ctx.arc(0, 0, R, Math.PI, Math.PI * 2); ctx.closePath();
      ctx.fillStyle = '#ffffff12'; ctx.fill();
      ctx.strokeStyle = '#ffffff66'; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.beginPath(); ctx.arc(-14 + pointer * 10, -6 + pointerY * 6, R * .78, Math.PI * 1.12, Math.PI * 1.42);
      ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke();
      ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 2;
      for (let k = 0; k < 9; k++) {
        const x = ((k * 26 + twist * 140) % 234) - 117;
        if (Math.abs(x) > R - 6) continue;
        ctx.beginPath(); ctx.moveTo(x, -12); ctx.lineTo(x, -3); ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    }

    // --- Speckled Egg ---
    // Speckled in the pack's colours, with an iridescent sheen when a special finish is inside.
    // The player taps it three times to crack it; then it hatches.
    let speckles = [], crack = [], eggTaps = 0, knockAt = -1e9, awaitTap = null;
    function setupEgg() {
      const rolls = crypto.getRandomValues(new Uint16Array(260)), u = i => rolls[i] / 65535;
      speckles = Array.from({ length: 70 }, (_, i) => ({ x: u(i) * 180 - 90, y: u(i + 70) * 230 - 115, r: 1.5 + u(i + 140) * 4.5, c: i % 5 }));
      crack = Array.from({ length: 11 }, (_, i) => ({ x: -96 + i * 19.2, y: -6 + (i % 2 ? -1 : 1) * (6 + u(220 + i) * 8) }));
      eggTaps = 0; knockAt = -1e9; awaitTap = null;
    }
    function eggPath(target) {
      target.beginPath(); target.moveTo(0, -118);
      target.bezierCurveTo(60, -118, 94, -28, 92, 28); target.bezierCurveTo(90, 88, 50, 116, 0, 116);
      target.bezierCurveTo(-50, 116, -90, 88, -92, 28); target.bezierCurveTo(-94, -28, -60, -118, 0, -118);
      target.closePath();
    }
    function eggShell() {
      const pale = tint(hintHex(0), .62);
      eggPath(ctx);
      const body = ctx.createRadialGradient(-30 + pointer * 12, -50 + pointerY * 10, 8, 0, 10, 140);
      body.addColorStop(0, tint(pale, .6)); body.addColorStop(.55, pale); body.addColorStop(1, tint(hintHex(0), .05));
      ctx.fillStyle = body; ctx.fill();
      ctx.save(); eggPath(ctx); ctx.clip();
      for (const sp of speckles) { ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2); ctx.fillStyle = hintHex(sp.c) + 'cc'; ctx.fill(); }
      if (special()) {
        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha *= .32;
        ctx.fillStyle = gradient(ctx, -100 + pointer * 40, -120, 100 + pointer * 40, 120, [[0, '#ff9ad5'], [.3, '#9ec5ff'], [.55, '#a8ffd8'], [.8, '#ffe9a0'], [1, '#ff9ad5']]);
        ctx.fillRect(-100, -120, 200, 240);
      }
      ctx.restore();
      const shown = Math.min(1, eggTaps / 3), mid = (crack.length - 1) / 2;
      if (shown) {
        const pts = crack.filter((_, i) => Math.abs(i - mid) <= mid * shown + .01);
        ctx.beginPath(); pts.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
        ctx.strokeStyle = '#ffffff70'; ctx.lineWidth = 2; ctx.save(); ctx.translate(.8, 1.4); ctx.stroke(); ctx.restore();
        ctx.strokeStyle = tint(hintHex(0), -.7); ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.stroke();
      }
    }
    function renderEgg(t) {
      const now = performance.now(), since = now - knockAt;
      let rock = since < 700 ? Math.sin(since / 34) * Math.exp(-since / 200) * .16 : 0;
      // While it waits for taps, the egg gives an occasional nudge to invite one.
      if (awaitTap && since > 1600) rock += Math.sin(now / 90) * Math.max(0, Math.sin(now / 900)) ** 8 * .08;
      if (awaitTap || since < 700) requestPaint();
      const lift = ease(.02, .3, t), drop = ease(.2, .48, t);
      ctx.save(); ctx.translate(0, 4); ctx.rotate(rock);
      ctx.save(); ctx.globalAlpha = 1 - drop;
      ctx.beginPath(); ctx.ellipse(0, 122, 70, 9, 0, 0, Math.PI * 2); ctx.fillStyle = '#00000038'; ctx.filter = 'blur(6px)'; ctx.fill(); ctx.filter = 'none';
      ctx.restore();
      if (!lift) { eggShell(); ctx.restore(); return; }
      // Hatching: the shell parts along the crack; the cap tips off and the base sinks away.
      // One side of the crack: the cap above it (edge -170) or the base below it (edge 170).
      const half = edge => { ctx.beginPath(); ctx.moveTo(-130, edge); ctx.lineTo(130, edge); for (let i = crack.length - 1; i >= 0; i--) ctx.lineTo(crack[i].x, crack[i].y); ctx.closePath(); };
      ctx.save(); ctx.globalAlpha = 1 - drop; ctx.translate(0, drop * 14);
      half(170); ctx.clip(); eggShell();
      ctx.restore();
      ctx.save(); ctx.globalAlpha = 1 - ease(.18, .4, t); ctx.translate(lift * 50, -lift * 150); ctx.rotate(lift * .7);
      half(-170); ctx.clip(); eggShell();
      ctx.restore();
      ctx.restore();
    }

    // --- Gift Box ---
    // A box seen from slightly above and to the side: front, side and lid top, each wrapped in
    // paper striped in the pack's colours, tied with a satin ribbon, or a gold foil ribbon when a
    // special finish is inside. The view shifts with the pointer. The ribbon slips off, the lid
    // pops and the box falls away.
    function setupGift() {}
    function ribbonFill(x1, y1, x2, y2) {
      return special()
        ? gradient(ctx, x1 + pointer * 30, y1, x2 + pointer * 30, y2, [[0, '#fff0d4'], [.35, '#e2b25e'], [.5, '#8f5f24'], [.62, '#ffe1a8'], [1, '#c48a3c']])
        : gradient(ctx, x1, y1, x2, y2, [[0, '#fbf7f0'], [.6, '#e4dccf'], [1, '#bdb3a4']]);
    }
    function paper(w, h) {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      ctx.fillStyle = tint(hintHex(0), -.12); ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 15;
      for (let k = -14; k < 14; k++) {
        ctx.strokeStyle = hintHex((k + 20) % 5); ctx.beginPath();
        ctx.moveTo(k * 22, h + 10); ctx.lineTo(k * 22 + h + 20, -10); ctx.stroke();
      }
      ctx.restore();
    }
    // Draws in a face's own coordinates (w x h) mapped onto the parallelogram from (x, y) along u and v.
    function face(x, y, u, v, w, h, draw) {
      ctx.save(); ctx.transform(u[0] / w, u[1] / w, v[0] / h, v[1] / h, x, y);
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      draw(w, h);
      ctx.restore();
    }
    // A wrapped block: front w x h at (x, y), with its side and (optionally) top in depth d.
    function block(x, y, w, h, d, top, ribbon, untie) {
      const shade = (w2, h2, fill) => { ctx.fillStyle = fill; ctx.fillRect(0, 0, w2, h2); };
      const band = (fx, fy, fw, fh) => { ctx.save(); ctx.globalAlpha *= 1 - untie; ctx.fillStyle = ribbonFill(fx, fy, fx + fw, fy + fh); ctx.fillRect(fx, fy, fw, fh); ctx.restore(); };
      face(x + w, y, d, [0, h], 60, h, (fw, fh) => { paper(fw, fh); shade(fw, fh, '#00000052'); if (ribbon) band(23, 0, 14, fh); });
      if (top) face(x, y, [w, 0], d, w, 60, (fw, fh) => { paper(fw, fh); shade(fw, fh, '#ffffff1e'); if (ribbon) { band(fw / 2 - 14, 0, 28, fh); band(0, 23, fw, 14); } });
      face(x, y, [w, 0], [0, h], w, h, (fw, fh) => {
        paper(fw, fh);
        shade(fw, fh, gradient(ctx, 0, 0, fw, fh, [[0, '#ffffff22'], [.5, '#ffffff00'], [1, '#00000030']]));
        if (ribbon) band(fw / 2 - 14, 0, 28, fh);
      });
    }
    function renderGift(t) {
      const untie = ease(.04, .3, t), lid = ease(.28, .44, t), fall = ease(.42, .62, t);
      // Depth runs back and up; the pointer turns the box a little.
      const d = [40 + pointer * 14, -26 + pointerY * 7];
      ctx.save(); ctx.translate(-14, 10);
      ctx.save(); ctx.globalAlpha = 1 - fall;
      ctx.beginPath(); ctx.ellipse(14, 112, 124, 11, 0, 0, Math.PI * 2); ctx.fillStyle = '#00000038'; ctx.filter = 'blur(6px)'; ctx.fill(); ctx.filter = 'none';
      ctx.restore();
      ctx.save(); ctx.globalAlpha = 1 - fall; ctx.translate(0, fall * 70);
      block(-96, -28, 192, 134, d, false, true, untie);
      ctx.restore();
      // The lid overhangs the box a little; the bow sits on its top face.
      ctx.save(); ctx.globalAlpha = 1 - ease(.36, .52, t);
      ctx.translate(-lid * 70, -lid * 150); ctx.rotate(-lid * .8);
      block(-104, -64, 208, 36, [d[0] * 1.04, d[1] * 1.04], true, true, untie);
      ctx.fillStyle = '#00000030'; ctx.fillRect(-104, -28, 208, 3);
      ctx.save(); ctx.globalAlpha *= 1 - untie;
      ctx.translate(d[0] / 2, -64 + d[1] / 2 - untie * 30); ctx.scale(1 - untie * .6, 1 - untie * .6);
      for (const side of [-1, 1]) {
        ctx.save(); ctx.rotate(side * .5);
        ctx.beginPath(); ctx.ellipse(side * 30, -10, 32, 17, 0, 0, Math.PI * 2); ctx.fillStyle = ribbonFill(side * 60, -28, 0, 8); ctx.fill();
        ctx.beginPath(); ctx.ellipse(side * 30, -10, 15, 6, 0, 0, Math.PI * 2); ctx.fillStyle = '#00000030'; ctx.fill();
        ctx.restore();
      }
      ctx.beginPath(); ctx.arc(0, -4, 12, 0, Math.PI * 2); ctx.fillStyle = ribbonFill(-12, -16, 12, 8); ctx.fill();
      ctx.restore();
      ctx.restore();
      ctx.restore();
    }

    // --- Fortune Cookie ---
    // A golden folded cookie holding a fortune slip printed with five dots in the pack's colours; a
    // dusting of gold hints at a special finish. It strains, snaps in two and the slip unfurls
    // as the ubus appear.
    let crumbs = [], dust = [], cookieLayer, cookieLayerCtx;
    function setupCookie() {
      const rolls = crypto.getRandomValues(new Uint16Array(160)), u = i => rolls[i] / 65535;
      crumbs = Array.from({ length: 26 }, (_, i) => ({ x: u(i) * 210 - 105, y: u(i + 26) * 90 - 50, r: .8 + u(i + 52) * 1.8 }));
      dust = Array.from({ length: 30 }, (_, i) => ({ x: u(i + 80) * 200 - 100, y: u(i + 110) * 80 - 50 }));
    }
    // Two broad wafer faces overlap in three-quarter view. The long diagonal fold curls into
    // the crown; the rear wing ends above the pointed front wing, leaving an open notch.
    function cookiePath(ctx) {
      ctx.beginPath(); ctx.moveTo(-120, -6);
      ctx.bezierCurveTo(-103, -63, -25, -112, 37, -91);
      ctx.bezierCurveTo(93, -73, 137, -22, 124, 31);
      ctx.bezierCurveTo(112, 86, 27, 120, -64, 104);
      ctx.bezierCurveTo(-88, 100, -84, 86, -72, 65);
      ctx.lineTo(-36, 10);
      ctx.bezierCurveTo(-67, 14, -105, 8, -117, 1);
      ctx.quadraticCurveTo(-122, -2, -120, -6); ctx.closePath();
    }
    function cookieFront(ctx) {
      ctx.beginPath(); ctx.moveTo(-73, 76);
      ctx.bezierCurveTo(-46, 28, -7, -24, 33, -66);
      ctx.bezierCurveTo(46, -80, 35, -85, 25, -75);
      ctx.bezierCurveTo(38, -101, 76, -75, 97, -46);
      ctx.bezierCurveTo(122, -13, 124, 20, 106, 48);
      ctx.bezierCurveTo(80, 88, 14, 109, -56, 96);
      ctx.bezierCurveTo(-77, 93, -82, 92, -73, 76); ctx.closePath();
    }
    function cookieBody(ctx) {
      cookiePath(ctx); ctx.fillStyle = gradient(ctx, -65, -85, 65, 105, [[0, '#f4d496'], [.5, '#e9bd75'], [1, '#bc803d']]); ctx.fill();
      ctx.strokeStyle = '#895025'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.save(); cookiePath(ctx); ctx.clip();
      // The rear face folds down toward the long crease instead of forming a rounded lobe.
      ctx.beginPath(); ctx.moveTo(-119, -5);
      ctx.bezierCurveTo(-77, 25, -9, -29, 29, -73);
      ctx.lineTo(-34, 13); ctx.lineTo(-121, 12); ctx.closePath();
      ctx.fillStyle = '#c28a4670'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-117, -7);
      ctx.quadraticCurveTo(-121, 3, -79, 7);
      ctx.strokeStyle = '#fff0bd'; ctx.lineWidth = 3; ctx.stroke();
      // A dark, tapered pocket follows the front face from its rolled tip into the crown.
      ctx.beginPath(); ctx.moveTo(-69, 92);
      ctx.bezierCurveTo(-40, 34, -3, -17, 35, -63);
      ctx.bezierCurveTo(54, -85, 31, -93, 22, -74);
      ctx.bezierCurveTo(35, -87, 40, -78, 28, -68);
      ctx.bezierCurveTo(-13, -25, -51, 29, -79, 80); ctx.closePath();
      ctx.fillStyle = '#875025'; ctx.fill();
      cookieFront(ctx);
      ctx.fillStyle = gradient(ctx, -35 + pointer * 15, -65, 95 + pointer * 15, 85, [[0, '#ffe3a2'], [.52, '#efc781'], [1, '#d29b53']]);
      ctx.fill();
      ctx.save(); cookieFront(ctx); ctx.clip();
      // A broad crescent of toasted shading gives the folded face depth.
      ctx.beginPath(); ctx.moveTo(67, -76);
      ctx.bezierCurveTo(110, -6, 83, 49, 7, 80);
      ctx.bezierCurveTo(99, 64, 139, 9, 98, -47); ctx.closePath();
      ctx.fillStyle = '#b77a3355'; ctx.fill();
      for (const c of crumbs) { ctx.beginPath(); ctx.ellipse(c.x, c.y, c.r, c.r * .55, -.4, 0, Math.PI * 2); ctx.fillStyle = '#a86a2a40'; ctx.fill(); }
      if (grainPattern) { ctx.fillStyle = grainPattern; ctx.fillRect(-125, -105, 255, 220); }
      ctx.save();
      const shellAlpha = ctx.globalAlpha;
      if (special()) for (const d of dust) {
        ctx.globalAlpha = shellAlpha * (.4 + .6 * Math.abs(Math.sin(d.x * .2 + pointer * 3 + pointerY)));
        ctx.fillStyle = '#fff1c4'; ctx.fillRect(d.x, d.y, 1.8, 1.8);
      }
      ctx.restore();
      ctx.restore();
      // The pale curled lip ends in a thin toasted edge along the bottom of the wafer.
      ctx.beginPath(); ctx.moveTo(23, -77);
      ctx.bezierCurveTo(47, -99, 61, -71, 32, -47);
      ctx.strokeStyle = '#fff0bd'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-72, 79);
      ctx.bezierCurveTo(-87, 94, -49, 98, -18, 98);
      ctx.bezierCurveTo(52, 98, 117, 57, 116, 6);
      ctx.strokeStyle = '#fff0bd'; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-66, 95);
      ctx.bezierCurveTo(-5, 113, 87, 86, 114, 38);
      ctx.strokeStyle = '#945a2a'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.restore();
    }
    function fortuneSlip(ctx, rise, unfurl) {
      ctx.save(); ctx.translate(mix(53, 0, rise), mix(99, 4, rise)); ctx.rotate(.65 * (1 - unfurl));
      const w = mix(70, 220, unfurl), h = mix(22, 48, unfurl), curl = unfurl * 5;
      ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2 + curl);
      ctx.bezierCurveTo(-w / 6, -h / 2 - curl, w / 6, -h / 2 + curl, w / 2, -h / 2);
      ctx.lineTo(w / 2, h / 2 - curl);
      ctx.bezierCurveTo(w / 6, h / 2 + curl, -w / 6, h / 2 - curl, -w / 2, h / 2); ctx.closePath();
      ctx.fillStyle = gradient(ctx, 0, -h / 2, 0, h / 2, [[0, '#fffdf6'], [.6, '#f5f0e2'], [1, '#e4dac4']]); ctx.fill();
      ctx.strokeStyle = '#b7a78c'; ctx.lineWidth = 1; ctx.stroke();
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc((i - 2) * mix(14, 32, unfurl), 0, mix(4.2, 6, unfurl), 0, Math.PI * 2); ctx.fillStyle = hintHex(i); ctx.fill(); }
      ctx.restore();
    }
    function cookieCrease(ctx) {
      ctx.bezierCurveTo(50, -88, 48, -79, 33, -66);
      ctx.bezierCurveTo(10, -46, -16, -18, -36, 10);
    }
    function cookieHalf(ctx, side, turn, apart, shell) {
      ctx.save();
      // Rotate the existing diagonal crease upright. The foreshortened rear wing unfolds as
      // it turns, so both mouths face the fortune instead of cutting across either wafer face.
      ctx.translate((side * 92 + 20) * turn + side * apart * 70, (side < 0 ? 48 : -4) * turn + apart * 55);
      ctx.scale(side < 0 ? 1 + turn * .2 : 1, side < 0 ? 1 + turn * .5 : 1);
      ctx.rotate(-.58 * turn + side * apart * .12);
      if (shell) {
        ctx.beginPath(); ctx.moveTo(37, -140); ctx.lineTo(37, -91);
        cookieCrease(ctx);
        ctx.lineTo(-140, 50); ctx.lineTo(-160, 140);
        ctx.lineTo(side * 160, 140); ctx.lineTo(side * 160, -140); ctx.closePath(); ctx.clip();
        cookieBody(ctx);
      } else if (turn) {
        // Close the cavity against the actual curved cut, including the front wing's rolled
        // tip. A straight chord here leaves a gap at the crown and buries the opposite rim.
        const bx = side < 0 ? -36 : -75, by = side < 0 ? 10 : 91;
        const depth = -side * 42 * turn, nx = depth * .82, ny = depth * .57;
        const rim = () => ctx.bezierCurveTo(mix(37, bx, .75) + nx, mix(-91, by, .75) + ny,
          50 + nx * .65, -88 + ny * .15, 37, -91);
        ctx.beginPath(); ctx.moveTo(37, -91);
        cookieCrease(ctx);
        if (side > 0) { ctx.lineTo(-72, 65); ctx.quadraticCurveTo(-82, 83, bx, by); }
        rim(); ctx.closePath();
        ctx.fillStyle = gradient(ctx, 37, -91, bx, by, [[0, '#6c3517'], [.5, '#8b441c'], [1, '#4d2512']]); ctx.fill();
        ctx.beginPath(); ctx.moveTo(bx, by); rim();
        ctx.strokeStyle = '#a9682c'; ctx.lineWidth = 5; ctx.lineCap = 'butt'; ctx.stroke();
        ctx.strokeStyle = '#f4ce83'; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();
    }
    function renderCookie(t) {
      const strain = ease(.04, .26, t), snap = ease(.26, .49, t), apart = ease(.65, .84, t), slip = ease(.27, .49, t);
      if (apart === 1) return;
      const shiver = Math.sin(t * 160) * 1.6 * strain * (1 - snap);
      let target = ctx;
      // Flatten the opaque shell, hollow and paper before fading. Reuse a screen-sized layer
      // only during the fade, preserving the current device scale and pointer transform.
      if (apart) {
        if (!cookieLayer) { cookieLayer = document.createElement('canvas'); cookieLayerCtx = cookieLayer.getContext('2d'); }
        if (cookieLayer.width !== canvas.width || cookieLayer.height !== canvas.height) {
          cookieLayer.width = canvas.width; cookieLayer.height = canvas.height;
        }
        target = cookieLayerCtx;
        target.resetTransform(); target.clearRect(0, 0, cookieLayer.width, cookieLayer.height);
        target.setTransform(ctx.getTransform());
      }
      target.save(); target.translate(shiver, 14);
      target.save();
      target.beginPath(); target.ellipse(0, 115, 110, 10, 0, 0, Math.PI * 2); target.fillStyle = '#00000038'; target.filter = 'blur(6px)'; target.fill();
      target.restore();
      // Only the tip peeks out at rest; the enlarged fortune bridges the open mouths.
      if (!snap) { fortuneSlip(target, 0, 0); cookieBody(target); target.restore(); return; }
      for (const side of [-1, 1]) cookieHalf(target, side, snap, apart, false);
      fortuneSlip(target, slip, slip);
      for (const side of [-1, 1]) cookieHalf(target, side, snap, apart, true);
      target.restore();
      if (apart) {
        ctx.save(); ctx.resetTransform(); ctx.globalAlpha *= 1 - apart;
        ctx.drawImage(cookieLayer, 0, 0); ctx.restore();
      }
    }

    // --- Wax-Sealed Envelope ---
    // A cream envelope with an airmail border in the pack's colours, closed with a wax seal
    // pressed with the oomark: red wax, or gold when a special finish is inside. The seal cracks,
    // the flap opens and the ubus climb out.
    let sealEdge = [];
    function setupEnvelope() {
      const rolls = crypto.getRandomValues(new Uint16Array(28));
      sealEdge = Array.from(rolls, value => 29 + value / 65535 * 3.5);
    }
    function waxColors() { return special() ? ['#f3cf7c', '#c8922f', '#7d5517'] : ['#d9504f', '#a8232d', '#5e0f16']; }
    function sealBlob(r = 1) {
      ctx.beginPath();
      sealEdge.forEach((radius, i) => { const a = i / sealEdge.length * Math.PI * 2, x = Math.cos(a) * radius * r, y = Math.sin(a) * radius * r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath();
    }
    // The oomark pressed into the wax: two rings and a bar, raised with a light upper edge.
    function sealMark() {
      const draw = (dx, dy, color) => {
        ctx.save(); ctx.translate(dx, dy); ctx.scale(.15, .15); ctx.strokeStyle = color;
        ctx.lineWidth = 35.3; for (const cx of [-59.45, 59.44]) { ctx.beginPath(); ctx.arc(cx, -34.5, 48.38, 0, Math.PI * 2); ctx.stroke(); }
        ctx.lineWidth = 53; ctx.beginPath(); ctx.moveTo(-75.96, 74.05); ctx.lineTo(75.95, 74.05); ctx.stroke();
        ctx.restore();
      };
      const [light, mid, dark] = waxColors();
      draw(.9, 1.1, dark); draw(-.6, -.7, light); draw(0, 0, mid);
    }
    function seal(crackOpen) {
      const [light, mid, dark] = waxColors();
      for (const side of crackOpen ? [-1, 1] : [0]) {
        ctx.save();
        if (side) { ctx.translate(side * crackOpen * 10, crackOpen * 6); ctx.rotate(side * crackOpen * .25); ctx.beginPath(); ctx.rect(side < 0 ? -40 : 0, -40, 40, 80); ctx.clip(); }
        sealBlob(1.06); ctx.fillStyle = dark; ctx.fill();
        sealBlob();
        const wax = ctx.createRadialGradient(-10 + pointer * 6, -12 + pointerY * 5, 3, 0, 0, 34);
        wax.addColorStop(0, light); wax.addColorStop(.5, mid); wax.addColorStop(1, dark);
        ctx.fillStyle = wax; ctx.fill();
        sealMark();
        ctx.restore();
      }
    }
    function envelopeBody() {
      const W = 250, H = 160, x = -W / 2, y = -H / 2;
      ctx.fillStyle = gradient(ctx, x, y, x + W, y + H, [[0, '#fbf6ec'], [1, '#e2d8c6']]);
      ctx.fillRect(x, y, W, H);
      // Airmail border: diagonal dashes cycling through the pack's colours.
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, W, H); ctx.rect(x + 9, y + 9, W - 18, H - 18); ctx.clip('evenodd');
      ctx.lineWidth = 7;
      for (let k = -12; k < 40; k++) { ctx.strokeStyle = hintHex(k % 5 < 0 ? k % 5 + 5 : k % 5); ctx.beginPath(); ctx.moveTo(x + k * 12, y + H + 10); ctx.lineTo(x + k * 12 + H + 20, y - 10); ctx.stroke(); }
      ctx.restore();
      // Side and bottom folds.
      ctx.strokeStyle = '#00000014'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x + 9, y + H - 9); ctx.lineTo(0, 12); ctx.lineTo(x + W - 9, y + H - 9); ctx.stroke();
    }
    function renderEnvelope(t) {
      const crackT = ease(.06, .18, t), open = ease(.18, .42, t), rise = ease(.38, .58, t), fan = ease(.56, .82, t), away = ease(.52, .72, t);
      const W = 250, H = 160, top = -H / 2, drop = 16 + away * 60;
      ctx.save(); ctx.translate(0, drop); ctx.globalAlpha = 1 - away;
      ctx.beginPath(); ctx.ellipse(0, H / 2 + 8, W * .5, 9, 0, 0, Math.PI * 2); ctx.fillStyle = '#00000038'; ctx.filter = 'blur(6px)'; ctx.fill(); ctx.filter = 'none';
      // The flap folds from pointing down over the envelope to standing open behind it.
      const tipY = mix(top + 96, top - 96, open), inside = tipY < top;
      const flap = () => {
        ctx.beginPath(); ctx.moveTo(-W / 2, top); ctx.lineTo(W / 2, top); ctx.lineTo(0, tipY); ctx.closePath();
        ctx.fillStyle = inside ? gradient(ctx, 0, top, 0, tipY, [[0, '#d9cdb8'], [1, '#efe6d6']]) : gradient(ctx, 0, top, 0, tipY, [[0, '#f7f0e2'], [1, '#e6dbc7']]);
        ctx.fill(); ctx.strokeStyle = '#00000020'; ctx.lineWidth = 1.2; ctx.stroke();
      };
      if (inside) flap();
      // The ubus climb out of the opening, small, then spread into the reveal fan. They are drawn
      // before the envelope's panel, so the part still inside stays hidden behind it.
      if (rise) {
        ctx.save(); ctx.translate(0, -drop); ctx.globalAlpha = 1 - ease(.96, 1, t);
        const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.abs(b - (count - 1) / 2) - Math.abs(a - (count - 1) / 2));
        for (const i of order) {
          const slot = i - (count - 1) / 2;
          const x = mix(slot * 36, slot * 88, fan), y = mix(mix(40, -110, rise), -26 + Math.abs(slot) * 14, fan);
          ctx.save(); ctx.translate(x, y); ctx.scale(mix(.45, 1, fan), mix(.45, 1, fan));
          candy(0, 0, candyColors[i % 5], slot * .10 * fan);
          ctx.restore();
        }
        ctx.restore();
      }
      envelopeBody();
      if (!inside) flap();
      // The seal rides the flap's tip until it cracks apart and falls.
      if (!inside || open < .55) {
        ctx.save(); ctx.globalAlpha *= 1 - ease(.18, .32, t); ctx.translate(0, mix(top + 92, top + 92 + 40, ease(.18, .32, t)));
        seal(crackT); ctx.restore();
      }
      ctx.restore();
    }

    // Each wrapper's animation length (ms), when the ubus begin to fan out (null: it shows them
    // itself), and when the wrapper stops drawing.
    const duration = () => currentType?.duration || 3600;

    // Available pack types: randomly chosen when generated
    const PACK_TYPES = [
      { id: 'plastic', name: 'Plastic Cellophane', setup: setupPlastic, render: renderPlastic, duration: 3600, reveal: .59, end: .96 },
      { id: 'foil', name: 'Crinkly Foil', setup: setupFoil, render: renderFoil, duration: 3600, reveal: .18, end: .96 },
      { id: 'blob', name: 'Powdered Alloy', setup: setupBlob, render: renderBlob, duration: 4800, reveal: null, end: 1 },
      { id: 'gumball', name: 'Gumball Capsule', setup: setupGumball, render: renderGumball, duration: 3000, reveal: .46, end: .96 },
      { id: 'egg', name: 'Speckled Egg', setup: setupEgg, render: renderEgg, duration: 2600, reveal: .12, end: .96, taps: 3 },
      { id: 'gift', name: 'Gift Box', setup: setupGift, render: renderGift, duration: 3000, reveal: .38, end: .96 },
      { id: 'cookie', name: 'Fortune Cookie', setup: setupCookie, render: renderCookie, duration: 3200, reveal: .68, end: .96 },
      { id: 'envelope', name: 'Wax-Sealed Envelope', setup: setupEnvelope, render: renderEnvelope, duration: 3000, reveal: null, end: 1 },
      { id: 'starter', name: 'Starter Pack', setup: setupStarter, render: renderStarter, duration: 2600, reveal: .26, end: .96, sound: 'foil' }
    ];

    function settlePending() {
      const tap = awaitTap, done = finish;
      awaitTap = null; finish = null;
      tap?.(); done?.();
    }

    function recolor(packTypeId) {
      settlePending();
      tokenCache.clear();
      packHints = null;
      progress = 0;
      let index;
      do { index = crypto.getRandomValues(new Uint8Array(1))[0] & 31; } while (index === previousColor);
      previousColor = index; color = paletteColor(index); canvas.dataset.color = String(index);
      candyColors = Array.from({ length: 5 }, (_, i) => paletteColor((index + i * 7) & 31));

      if (packTypeId) {
        currentType = PACK_TYPES.find(t => t.id === packTypeId) || PACK_TYPES[0];
      } else {
        const roll = crypto.getRandomValues(new Uint32Array(1))[0];
        currentType = PACK_TYPES[roll % (PACK_TYPES.length - 1)]; // Starter packs are never dealt.
      }
      canvas.dataset.pack = currentType.id;
      currentType.setup();
      requestPaint();
    }

    function renderUbuTo(tCtx, hex, R) {
      // Natural ubu token drop shadow
      tCtx.shadowColor = '#00000055';
      tCtx.shadowBlur = Math.round(9 * (R / 176));
      tCtx.shadowOffsetX = 0;
      tCtx.shadowOffsetY = Math.round(8 * (R / 176));
      tCtx.beginPath(); tCtx.arc(0, 0, R, 0, Math.PI * 2); tCtx.fillStyle = hex; tCtx.fill();
      tCtx.shadowColor = 'transparent';

      // Keep the front flat; surface texture and face detail are clipped to the token circle.
      tCtx.save();
      tCtx.beginPath(); tCtx.arc(0, 0, R, 0, Math.PI * 2); tCtx.clip();

      // Subtle directional diffuse light field matching ubu-render matte
      const diffuse = tCtx.createLinearGradient(-R, -R, R, R);
      diffuse.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
      diffuse.addColorStop(0.5, 'rgba(255, 255, 255, 0.02)');
      diffuse.addColorStop(1, 'rgba(0, 0, 0, 0.07)');
      tCtx.fillStyle = diffuse;
      tCtx.fillRect(-R, -R, R * 2, R * 2);

      // Fine matte surface grain
      if (grainPattern) {
        tCtx.fillStyle = grainPattern;
        tCtx.fillRect(-R, -R, R * 2, R * 2);
      }

      // Brand placeholder oomark face
      if (mark.complete && mark.naturalWidth) {
        const faceSize = R * (136 / 104);
        tCtx.drawImage(mark, -faceSize / 2, -faceSize / 2, faceSize, faceSize);
      }

      // Narrow perimeter rolled edge overlay (94% to 100% of radius)
      const ox = R * (-2 / 176), oy = R * (-4 / 176), edgeR = R * (180 / 176);
      const edge = tCtx.createRadialGradient(ox, oy, 0, ox, oy, edgeR);
      edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
      edge.addColorStop(0.94, 'rgba(0, 0, 0, 0)');
      edge.addColorStop(0.98, 'rgba(0, 0, 0, 0.13)');
      edge.addColorStop(1, 'rgba(0, 0, 0, 0.32)');
      tCtx.fillStyle = edge;
      tCtx.fillRect(-R, -R, R * 2, R * 2);

      tCtx.restore();

      // Token rim stroke
      const rim = tCtx.createLinearGradient(-R, -R, R, R);
      rim.addColorStop(0, 'rgba(255, 255, 255, 0.44)');
      rim.addColorStop(0.4, 'rgba(255, 255, 255, 0.07)');
      rim.addColorStop(0.65, 'rgba(0, 0, 0, 0.06)');
      rim.addColorStop(1, 'rgba(0, 0, 0, 0.28)');
      tCtx.strokeStyle = rim;
      tCtx.lineWidth = Math.max(1, R * (3 / 176));
      tCtx.beginPath();
      tCtx.arc(0, 0, R * (174.5 / 176), 0, Math.PI * 2);
      tCtx.stroke();
    }

    function getToken(hex, R) {
      const hasMark = Boolean(mark.complete && mark.naturalWidth);
      const key = `${hex}:${R}`;
      let cached = tokenCache.get(key);
      if (cached && cached.hasMark === hasMark) return cached;
      const halfSize = Math.ceil(R * 1.35);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = halfSize * 4;
      const tCtx = canvas.getContext('2d');
      tCtx.setTransform(2, 0, 0, 2, halfSize * 2, halfSize * 2);
      renderUbuTo(tCtx, hex, R);
      cached = { canvas, halfSize, hasMark };
      tokenCache.set(key, cached);
      return cached;
    }

    function candy(x, y, hex, angle, R = 104) {
      const token = getToken(hex, R);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.drawImage(token.canvas, -token.halfSize, -token.halfSize, token.halfSize * 2, token.halfSize * 2);
      ctx.restore();
    }

    function paint(now) {
      frame = 0;
      const follow = 1 - Math.exp(-Math.min(64, now - lastPaint) / 85);
      lastPaint = now;
      pointer = mix(pointer, aimX, follow); pointerY = mix(pointerY, aimY, follow);
      const settling = Math.abs(pointer - aimX) + Math.abs(pointerY - aimY) > .001;
      if (!settling) { pointer = aimX; pointerY = aimY; }
      if (finish) progress = clamp((now - started) / duration());
      const dpr = Math.min(devicePixelRatio || 1, 2), width = Math.round(canvas.clientWidth * dpr), height = Math.round(canvas.clientHeight * dpr);
      if (!width || !height) {
        if (settling) requestPaint();
        if (finish) {
          if (progress < 1) requestPaint();
          else { const done = finish; finish = null; done(); }
        }
        return;
      }
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.resetTransform(); ctx.clearRect(0, 0, width, height);
      const scale = width / 600; ctx.setTransform(scale, 0, 0, scale, width / 2, height * .46);

      const revealStart = currentType?.reveal ?? null;
      if (revealStart !== null && progress > revealStart) {
        const reveal = ease(revealStart, revealStart + .14, progress);
        const fan = ease(.36, .78, progress);
        ctx.save();
        ctx.globalAlpha = reveal * (1 - ease(.96, 1, progress));
        const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.abs(b - (count - 1) / 2) - Math.abs(a - (count - 1) / 2));
        for (const i of order) {
          const slot = i - (count - 1) / 2;
          candy(slot * (count === 3 ? 165 : 88) * fan, -26 * fan + Math.abs(slot) * 14 * fan, candyColors[i % 5], slot * .10 * fan);
        }
        ctx.restore();
      }
      if (currentType && progress < currentType.end) {
        ctx.save();
        // Modest foreshortening plus surface parallax and moving light imply
        // volume without a 3D dependency or transforming the interaction target.
        ctx.translate(pointer * 4, pointerY * 3);
        ctx.transform(Math.cos(pointer * .22), pointer * pointerY * .035, -pointer * pointerY * .025, Math.cos(pointerY * .20), 0, 0);
        ctx.rotate(pointer * .025);
        currentType.render(progress);
        ctx.restore();
      }
      if (settling) requestPaint();
      if (finish) {
        if (progress < 1) requestPaint();
        else { const done = finish; finish = null; done(); }
      }
    }

    function requestPaint() { if (!frame) frame = requestAnimationFrame(paint); }

    canvas.parentElement.addEventListener('pointermove', event => {
      if (reduced.matches || event.pointerType === 'touch' || finish) return;
      const r = canvas.getBoundingClientRect();
      aimX = clamp((event.clientX - r.left) / r.width) * 2 - 1;
      aimY = clamp((event.clientY - r.top) / r.height) * 2 - 1;
      requestPaint();
    });
    canvas.parentElement.addEventListener('pointerleave', () => { aimX = aimY = 0; requestPaint(); });
    new ResizeObserver(requestPaint).observe(canvas);
    reduced.addEventListener('change', () => {
      aimX = aimY = pointer = pointerY = 0;
      if (reduced.matches) {
        if (awaitTap) { const tap = awaitTap; awaitTap = null; tap(); }
        if (finish) started = performance.now() - duration();
      }
      requestPaint();
    });

    recolor();

    return {
      async play(amount = 5, models = []) {
        count = amount; aimX = aimY = pointer = pointerY = 0;
        if (reduced.matches) return Promise.resolve();
        if (currentType?.id === 'starter') candyColors = models.map(model => model.attributes.background.hex);
        if (currentType?.id === 'blob') blobFaces = await prepareBlobFaces(models);
        // Tap-to-open wrappers wait here until the player has tapped enough times.
        if (currentType?.taps && eggTaps < currentType.taps) await new Promise(resolve => { awaitTap = resolve; requestPaint(); });
        if (reduced.matches) return;
        started = performance.now(); progress = 0;
        // The opening sounds share this start, so each lands on its step of the animation.
        if (navigator.userActivation?.hasBeenActive) globalThis.ubuAudio?.playUnwrap?.(currentType?.sound || currentType?.id, duration() / 1000);
        return new Promise(resolve => { finish = resolve; requestPaint(); });
      },
      // True while a tap-to-open wrapper is waiting for the player.
      awaitingTap() { return Boolean(awaitTap); },
      tap() {
        if (!awaitTap) return false;
        eggTaps++; knockAt = performance.now();
        if (navigator.userActivation?.hasBeenActive) globalThis.ubuAudio?.playPack?.('crack', { stage: eggTaps });
        if (eggTaps >= currentType.taps) { const resolve = awaitTap; awaitTap = null; resolve(); }
        requestPaint();
        return true;
      },
      reset(newColor = false, packTypeId) {
        settlePending();
        progress = 0; count = 5; eggTaps = 0;
        if (newColor) recolor(packTypeId);
        else requestPaint();
      },
      setType(packTypeId) { recolor(packTypeId); },
      setStarter(label) { starterLabel = label; recolor('starter'); },
      setHints(packTypeId, hints) {
        recolor(packTypeId);
        packHints = hints;
        candyColors = hints.map(hint => hint.background);
        color = candyColors[0];
        blobColors = candyColors.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
        requestPaint();
      },
      getType() { return currentType ? currentType.id : null; }
    };
  }

  createPackScene.types = ['plastic', 'foil', 'blob', 'gumball', 'egg', 'gift', 'cookie', 'envelope'];
  globalThis.createPackScene = createPackScene;
})();
