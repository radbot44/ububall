'use strict';
// Painted 2D foil, cellophane and candy wrappers. No 3D engine or geometry.
(() => {
  const clamp = n => Math.max(0, Math.min(1, n));
  const ease = (a, b, t) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
  const mix = (a, b, t) => a + (b - a) * t;

  function createPackScene(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const sheet = document.createElement('canvas');
    sheet.width = 1200; sheet.height = 720;
    const sheetCtx = sheet.getContext('2d');
    const plasticPrint = document.createElement('canvas');
    plasticPrint.width = 440; plasticPrint.height = 768;
    const plasticPrintCtx = plasticPrint.getContext('2d');
    const emboss = document.createElement('canvas');
    emboss.width = emboss.height = 320;
    const embossCtx = emboss.getContext('2d');
    let frame = 0, progress = 0, started = 0, finish = null, count = 5, pointer = 0, pointerY = 0;
    let aimX = 0, aimY = 0, lastPaint = 0;
    let blobCanvas, blobCtx, blobPixels, blobColors = [], blobFaces = [];
    let packHints = null;
    let color, candyColors, previousColor = -1, currentType = null;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const logo = new Image(), mark = new Image();
    logo.onload = mark.onload = requestPaint;
    logo.src = 'uburoom-wordmark-brand.svg'; mark.src = 'uburoom-oomark-brand.svg';

    // Fixed fine grain: generated once, so the material never sparkles at rest.
    const grain = document.createElement('canvas');
    grain.width = grain.height = 128;
    const grainCtx = grain.getContext('2d'), pixels = grainCtx.createImageData(128, 128);
    const noise = crypto.getRandomValues(new Uint8Array(128 * 128));
    for (let i = 0; i < noise.length; i++) {
      const value = noise[i] < 128 ? 0 : 255;
      pixels.data.set([value, value, value, 3 + noise[i] % 9], i * 4);
    }
    grainCtx.putImageData(pixels, 0, 0);
    const grainPattern = ctx.createPattern(grain, 'repeat');

    function paletteColor(index) {
      if (typeof ubu !== 'undefined' && ubu.decode) {
        const dna = new Uint8Array(64); dna[8] = index << 3;
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

    function hintAccents(target) {
      if (!packHints) return;
      packHints.forEach((hint, i) => {
        const angle = i * Math.PI * 2 / 5 - Math.PI / 2, x = Math.cos(angle) * 64, y = Math.sin(angle) * 64;
        target.save(); target.translate(x, y); target.rotate(angle + .6);
        hint.accents.forEach((hex, j) => {
          target.beginPath(); target.ellipse((j - 1.5) * 7, 0, 2.6, 7 - j * .6, .3, 0, Math.PI * 2);
          target.fillStyle = hex; target.fill();
        });
        if (hint.textured) {
          target.beginPath(); target.moveTo(0, 13); target.lineTo(3, 17); target.lineTo(0, 21); target.lineTo(-3, 17); target.closePath();
          target.strokeStyle = '#ffffffcc'; target.lineWidth = 1.2; target.stroke();
        }
        target.restore();
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
      hintAccents(target);
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
      plasticPrintCtx.resetTransform();
      plasticPrintCtx.fillStyle = color; plasticPrintCtx.fillRect(0, 0, 440, 768);
      plasticPrintCtx.setTransform(2, 0, 0, 2, 220, 384);
      plasticTexture(plasticPrintCtx);
      target.save(); plasticSilhouette(flat, target); target.clip();
      target.fillStyle = color; target.fillRect(-130, -135, 260, 270);
      for (let y = -135; y < 135; y++) {
        const latitude = Math.asin(Math.max(-1, Math.min(1, (y + .5) / 112)));
        const surfaceY = mix(latitude * 112 + pointerY * 7, y, flat);
        const sourceY = surfaceY + 192;
        const bulge = Math.cos(latitude) * (1 - flat);
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
      hintAccents(sheetCtx);

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
        if (packHints) {
          blobCtx.save(); blobCtx.globalCompositeOperation = 'source-atop';
          blobCtx.setTransform(2 / 3, 0, 0, 2 / 3, 200, 120);
          packHints.forEach((hint, i) => {
            const lobe = lobes[i];
            if (!lobe) return;
            hint.accents.forEach((hex, j) => {
              const x = lobe.x + (j - 1.5) * 11, y = lobe.y + 10 + Math.sin(j * 2) * 7;
              const accent = blobCtx.createRadialGradient(x, y, 1, x, y, 8);
              accent.addColorStop(0, hex + 'ee'); accent.addColorStop(1, hex + '00');
              blobCtx.fillStyle = accent; blobCtx.fillRect(x - 8, y - 8, 16, 16);
            });
            if (hint.textured) {
              blobCtx.beginPath(); blobCtx.moveTo(lobe.x, lobe.y - 19); blobCtx.lineTo(lobe.x + 3, lobe.y - 14);
              blobCtx.lineTo(lobe.x, lobe.y - 9); blobCtx.lineTo(lobe.x - 3, lobe.y - 14); blobCtx.closePath();
              blobCtx.strokeStyle = '#ffffffbb'; blobCtx.lineWidth = 1.2; blobCtx.stroke();
            }
          });
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
            ctx.fillStyle = `rgb(${blobColors[i % 5].join(',')})`;
            ctx.beginPath(); ctx.arc(x, y, 42, 0, Math.PI * 2); ctx.fill();
            if (mark.complete && mark.naturalWidth) ctx.drawImage(mark, x - 28, y - 28, 56, 56);
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

    const duration = () => currentType?.id === 'blob' ? 4800 : 3600;

    // Available pack types: randomly chosen when generated
    const PACK_TYPES = [
      { id: 'plastic', name: 'Plastic Cellophane', setup: setupPlastic, render: renderPlastic },
      { id: 'foil', name: 'Crinkly Foil', setup: setupFoil, render: renderFoil },
      { id: 'blob', name: 'Powdered Alloy', setup: setupBlob, render: renderBlob }
    ];

    function recolor(packTypeId) {
      packHints = null;
      finish = null; progress = 0;
      let index;
      do { index = crypto.getRandomValues(new Uint8Array(1))[0] & 31; } while (index === previousColor);
      previousColor = index; color = paletteColor(index); canvas.dataset.color = String(index);
      candyColors = Array.from({ length: 5 }, (_, i) => paletteColor((index + i * 7) & 31));

      if (packTypeId) {
        currentType = PACK_TYPES.find(t => t.id === packTypeId) || PACK_TYPES[0];
      } else {
        const roll = crypto.getRandomValues(new Uint32Array(1))[0];
        currentType = PACK_TYPES[roll % PACK_TYPES.length];
      }
      canvas.dataset.pack = currentType.id;
      currentType.setup();
      requestPaint();
    }

    function candy(x, y, hex, angle) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
      ctx.shadowColor = '#0007'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 10;
      ctx.beginPath(); ctx.arc(0, 0, 104, 0, Math.PI * 2); ctx.fillStyle = tint(hex, -.55); ctx.fill();
      ctx.shadowColor = 'transparent';
      const gloss = ctx.createRadialGradient(-40, -50, 3, 5, 10, 136);
      gloss.addColorStop(0, tint(hex, .55)); gloss.addColorStop(.3, tint(hex, .15)); gloss.addColorStop(.65, hex); gloss.addColorStop(1, tint(hex, -.6));
      ctx.beginPath(); ctx.arc(0, 0, 104, 0, Math.PI * 2); ctx.fillStyle = gloss; ctx.fill();
      ctx.strokeStyle = '#ffffff35'; ctx.lineWidth = 1.3; ctx.stroke();
      if (mark.complete && mark.naturalWidth) ctx.drawImage(mark, -68, -68, 136, 136);
      ctx.beginPath(); ctx.ellipse(-36, -65, 36, 11, -.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff48'; ctx.fill();
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
      const dpr = Math.min(devicePixelRatio, 2), width = Math.round(canvas.clientWidth * dpr), height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.resetTransform(); ctx.clearRect(0, 0, width, height);
      const scale = width / 600; ctx.setTransform(scale, 0, 0, scale, width / 2, height * .46);

      const revealStart = currentType && currentType.id === 'plastic' ? .59 : .18;
      if (currentType?.id !== 'blob' && progress > revealStart) {
        const reveal = ease(revealStart, revealStart + .14, progress);
        const fan = ease(.36, .78, progress);
        ctx.save(); ctx.globalAlpha = reveal * (1 - ease(.96, 1, progress));
        const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.abs(b - (count - 1) / 2) - Math.abs(a - (count - 1) / 2));
        for (const i of order) {
          const slot = i - (count - 1) / 2;
          candy(slot * 88 * fan, -26 * fan + Math.abs(slot) * 14 * fan, candyColors[i % 5], slot * .10 * fan);
        }
        ctx.restore();
      }
      if (progress < (currentType?.id === 'blob' ? 1 : .96) && currentType) {
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
    reduced.addEventListener('change', () => { aimX = aimY = pointer = pointerY = 0; if (reduced.matches && finish) started = performance.now() - duration(); requestPaint(); });

    recolor();

    return {
      async play(amount = 5, models = []) {
        count = amount; aimX = aimY = pointer = pointerY = 0;
        if (reduced.matches) return Promise.resolve();
        if (currentType?.id === 'blob') blobFaces = await prepareBlobFaces(models);
        if (reduced.matches) return;
        started = performance.now(); progress = 0;
        return new Promise(resolve => { finish = resolve; requestPaint(); });
      },
      reset(newColor = false, packTypeId) {
        finish = null; progress = 0; count = 5;
        if (newColor) recolor(packTypeId);
        else requestPaint();
      },
      setType(packTypeId) { recolor(packTypeId); },
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

  createPackScene.types = ['plastic', 'foil', 'blob'];
  globalThis.createPackScene = createPackScene;
})();
