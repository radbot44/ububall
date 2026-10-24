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
    let frame = 0, progress = 0, started = 0, finish = null, count = 5, pointer = 0;
    let color, candyColors, previousColor = -1, currentType = null;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const logo = new Image(), mark = new Image();
    logo.onload = mark.onload = requestPaint;
    logo.src = 'uburoom-wordmark-brand.svg'; mark.src = 'uburoom-oomark-brand.svg';

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
      target.beginPath(); target.moveTo(-110, y(-12, -135));
      target.bezierCurveTo(-110, y(-57, -135), -74, y(-109, -135), 0, y(-112, -135));
      target.bezierCurveTo(74, y(-109, -135), 110, y(-57, -135), 110, y(-12, -135));
      target.lineTo(110, y(12, 135));
      target.bezierCurveTo(110, y(57, 135), 74, y(109, 135), 0, y(112, 135));
      target.bezierCurveTo(-74, y(109, 135), -110, y(57, 135), -110, y(12, 135));
      target.closePath();
    }

    function plasticFilm(side, flat, untwist, target) {
      const phase = side * (1 - untwist) * (Math.PI * 2 + .35);
      const flip = Math.cos(phase), swing = Math.sin(phase);
      const ribs = [];
      for (let j = 0; j <= 12; j++) {
        const v = j / 6 - 1, rib = [];
        for (let k = 0; k <= 8; k++) {
          const u = k / 8;
          const closedX = 110 + u * (36 + 104 * Math.sqrt(Math.max(0, 1 - v * v)));
          const closedY = mix(v * 12, v * 88, ease(0, 1, u));
          const crinkle = (Math.sin(k * 1.7 + j * 2.3 + side) * 3 + Math.sin(k * .9 - j * 1.8) * 1.4) * u * (1 - flat * .55);
          rib.push({
            x: mix(closedX, 110 + u * 158, flat) + u * v * swing * 10 + Math.sin(j * 2.7 + k * .7) * u * 2,
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
      target.translate(118 + release * 7, 0);
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
        target.bezierCurveTo(-4, shift - 3 - release * 10, 4, shift + 8 + release * 10, 13, shift + 5);
        target.strokeStyle = '#07101b95'; target.lineWidth = 3; target.stroke();
        target.strokeStyle = '#eef6ffc0'; target.lineWidth = 1; target.stroke();
      }
      target.restore();
    }

    function plasticCenter(flat, untwist, target) {
      target.save(); plasticSilhouette(flat, target); target.fillStyle = color; target.fill(); target.clip();
      const round = target.createRadialGradient(-35 + pointer * 12, -45, 5, 6, 15, 130);
      round.addColorStop(0, '#ffffff70'); round.addColorStop(.35, '#ffffff14'); round.addColorStop(.65, '#00000000'); round.addColorStop(.85, '#00000040'); round.addColorStop(1, '#000000b0');
      target.globalAlpha *= 1 - flat * .75; target.fillStyle = round; target.fillRect(-110, -135, 220, 270);
      target.globalAlpha /= 1 - flat * .75;
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
      const shineX = -70 + pointer * 22 + untwist * 85;
      target.fillStyle = gradient(target, shineX - 55, -135, shineX + 100, 135, [[0, '#ffffff00'], [.31, '#ffffff00'], [.4, '#ffffff50'], [.43, '#ffffffa0'], [.46, '#ffffff12'], [.57, '#ffffff00'], [.8, '#ffffff22'], [1, '#ffffff00']]);
      target.fillRect(-110, -135, 220, 270);
      target.fillStyle = '#101217bb'; target.beginPath(); target.roundRect(-94, -32, 188, 64, 6); target.fill();
      if (logo.complete && logo.naturalWidth) target.drawImage(logo, -88, -27, 176, 55);
      target.restore();
    }

    function renderPlastic(t) {
      const untwist = ease(0, .38, t), flat = ease(.16, .48, t), peel = ease(.36, .91, t);
      sheetCtx.resetTransform(); sheetCtx.clearRect(0, 0, sheet.width, sheet.height);
      sheetCtx.setTransform(2, 0, 0, 2, 600, 360);
      sheetCtx.save();
      for (const side of [-1, 1]) plasticFilm(side, flat, untwist, sheetCtx);
      plasticCenter(flat, untwist, sheetCtx);
      sheetCtx.restore();
      plasticKnot(-1, untwist, sheetCtx); plasticKnot(1, untwist, sheetCtx);

      ctx.save(); ctx.globalAlpha = 1 - ease(.86, .96, t);
      ctx.rotate(mix(-.09, 0, untwist));
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
      const rimSegments = 48;
      for (let i = 0; i < rimSegments; i++) {
        const theta = (i / rimSegments) * Math.PI * 2;
        const radius = 114 + (r() - 0.5) * 6;
        foilRimPoints.push({
          theta,
          x: Math.cos(theta) * radius,
          y: Math.sin(theta) * radius
        });
      }

      foilCreases = [];
      // Micro-crinkles pressed across the circular face
      for (let i = 0; i < 48; i++) {
        const angle = r() * Math.PI * 2;
        const dist = Math.sqrt(r()) * 96;
        const cx = Math.cos(angle) * dist;
        const cy = Math.sin(angle) * dist;
        const creaseAngle = r() * Math.PI * 2;
        const len = 16 + r() * 36;
        foilCreases.push({
          x: cx, y: cy,
          dx: Math.cos(creaseAngle) * len,
          dy: Math.sin(creaseAngle) * len,
          normal: creaseAngle + Math.PI / 2,
          strength: 0.14 + r() * 0.48,
          facet: (r() - 0.5) * 10
        });
      }

      // Radial creases gathered from the perimeter into the candy body
      for (let i = 0; i < 28; i++) {
        const theta = (i / 28) * Math.PI * 2 + (r() - 0.5) * 0.2;
        const rOuter = 114;
        const rInner = 74 + r() * 22;
        const x1 = Math.cos(theta) * rOuter, y1 = Math.sin(theta) * rOuter;
        const x2 = Math.cos(theta) * rInner, y2 = Math.sin(theta) * rInner;
        foilCreases.push({
          x: x1, y: y1,
          dx: x2 - x1, dy: y2 - y1,
          normal: theta + Math.PI / 2,
          strength: 0.22 + r() * 0.45,
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
      target.moveTo(foilRimPoints[0].x, foilRimPoints[0].y);
      for (let i = 1; i < foilRimPoints.length; i++) {
        target.lineTo(foilRimPoints[i].x, foilRimPoints[i].y);
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

      // 3D Spherical Volume Shading across circular candy
      const lx = -36 + pointer * 45, ly = -45;
      const spherical = sheetCtx.createRadialGradient(lx, ly, 6, 4, 8, 122);
      spherical.addColorStop(0, '#ffffffdd');
      spherical.addColorStop(0.25, tint(color, 0.55));
      spherical.addColorStop(0.55, color);
      spherical.addColorStop(0.82, tint(color, -0.42));
      spherical.addColorStop(1, tint(color, -0.78));
      sheetCtx.fillStyle = spherical; sheetCtx.fillRect(-135, -135, 270, 270);

      // Crimped / gathered foil flutes around circular rim
      for (const pt of foilRimPoints) {
        const innerX = pt.x * 0.85, innerY = pt.y * 0.85;
        sheetCtx.beginPath(); sheetCtx.moveTo(pt.x, pt.y); sheetCtx.lineTo(innerX, innerY);
        sheetCtx.strokeStyle = 'rgba(0,0,0,0.45)'; sheetCtx.lineWidth = 1.6; sheetCtx.stroke();
        sheetCtx.beginPath(); sheetCtx.moveTo(pt.x + 1.2, pt.y + 0.8); sheetCtx.lineTo(innerX + 1.2, innerY + 0.8);
        sheetCtx.strokeStyle = 'rgba(255,255,255,0.45)'; sheetCtx.lineWidth = 1.0; sheetCtx.stroke();
      }

      // 3D Crinkles & Creases pressed against the circular candy
      for (const c of foilCreases) {
        const lightAngle = Math.atan2(ly - c.y, lx - c.x);
        const dot = Math.cos(c.normal - lightAngle);
        const glint = Math.max(0, dot), shade = Math.max(0, -dot);

        sheetCtx.beginPath();
        sheetCtx.moveTo(c.x, c.y);
        sheetCtx.lineTo(c.x + c.dx * 0.5, c.y + c.dy * 0.5);
        sheetCtx.lineTo(c.x + c.dx * 0.5 + c.facet, c.y + c.dy * 0.5);
        sheetCtx.closePath();
        sheetCtx.fillStyle = `rgba(${glint > shade ? '255,255,255' : '0,0,0'}, ${c.strength * Math.max(glint, shade) * 0.38})`;
        sheetCtx.fill();

        sheetCtx.beginPath(); sheetCtx.moveTo(c.x, c.y); sheetCtx.lineTo(c.x + c.dx, c.y + c.dy);
        sheetCtx.strokeStyle = `rgba(0,0,0, ${c.strength * (0.35 + 0.55 * shade)})`; sheetCtx.lineWidth = 1.4; sheetCtx.stroke();
        sheetCtx.beginPath(); sheetCtx.moveTo(c.x - 0.9, c.y - 0.6); sheetCtx.lineTo(c.x + c.dx - 0.9, c.y + c.dy - 0.6);
        sheetCtx.strokeStyle = `rgba(255,255,255, ${c.strength * (0.3 + 0.75 * glint)})`; sheetCtx.lineWidth = 0.95; sheetCtx.stroke();
      }

      // Sweeping anisotropic metallic reflection
      const shineX = -40 + pointer * 65;
      sheetCtx.fillStyle = gradient(sheetCtx, shineX - 70, -110, shineX + 90, 110, [
        [0, 'rgba(255,255,255,0)'],
        [0.32, 'rgba(255,255,255,0)'],
        [0.40, 'rgba(255,255,255,0.3)'],
        [0.44, 'rgba(255,255,255,0.85)'],
        [0.48, 'rgba(255,255,255,0.18)'],
        [0.60, 'rgba(255,255,255,0)'],
        [0.76, 'rgba(255,255,255,0.22)'],
        [1, 'rgba(255,255,255,0)']
      ]);
      sheetCtx.fillRect(-135, -135, 270, 270);

      // Raised circular coin inner rim pressed through the foil
      sheetCtx.beginPath();
      sheetCtx.arc(0, 0, 98, 0, Math.PI * 2);
      sheetCtx.strokeStyle = 'rgba(0,0,0,0.38)';
      sheetCtx.lineWidth = 3.0;
      sheetCtx.stroke();
      sheetCtx.beginPath();
      sheetCtx.arc(-1.2, -1.2, 98, 0, Math.PI * 2);
      sheetCtx.strokeStyle = 'rgba(255,255,255,0.45)';
      sheetCtx.lineWidth = 1.4;
      sheetCtx.stroke();

      // Embossed circular 3D brand emblem pressed into the foil
      if (mark.complete && mark.naturalWidth) {
        sheetCtx.save();
        sheetCtx.globalAlpha = 0.5;
        sheetCtx.drawImage(mark, -72 + 2.2, -72 + 2.2, 144, 144);
        sheetCtx.globalAlpha = 0.35;
        sheetCtx.drawImage(mark, -72 - 1.8, -72 - 1.8, 144, 144);
        sheetCtx.globalAlpha = 0.85;
        sheetCtx.drawImage(mark, -72, -72, 144, 144);
        sheetCtx.restore();
      }

      // Metallic rim specular highlight along upper-left curve
      sheetCtx.beginPath();
      sheetCtx.arc(0, 0, 110, -Math.PI * 0.85, -Math.PI * 0.1);
      sheetCtx.strokeStyle = '#ffffff60';
      sheetCtx.lineWidth = 1.4;
      sheetCtx.stroke();

      sheetCtx.restore();
    }

    function renderFoil(t) {
      const rip = ease(0.08, 0.65, t);
      renderFoilSheet();

      // Ambient drop shadow ONLY when unopened (never casts on top of revealed ubus)
      if (!rip) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(6, 16, 110, 30, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
        ctx.fill();
        ctx.restore();
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

    // Available pack types: randomly chosen when generated
    const PACK_TYPES = [
      { id: 'plastic', name: 'Plastic Cellophane', setup: setupPlastic, render: renderPlastic },
      { id: 'foil', name: 'Crinkly Foil', setup: setupFoil, render: renderFoil }
    ];

    function recolor(packTypeId) {
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
      ctx.shadowColor = '#0007'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 12;
      ctx.beginPath(); ctx.arc(7, 9, 110, 0, Math.PI * 2); ctx.fillStyle = tint(hex, -.5); ctx.fill();
      ctx.shadowColor = 'transparent';
      const gloss = ctx.createRadialGradient(-44, -55, 3, 6, 12, 144);
      gloss.addColorStop(0, tint(hex, .55)); gloss.addColorStop(.3, tint(hex, .15)); gloss.addColorStop(.62, hex); gloss.addColorStop(1, tint(hex, -.6));
      ctx.beginPath(); ctx.arc(0, 0, 110, 0, Math.PI * 2); ctx.fillStyle = gloss; ctx.fill();
      ctx.strokeStyle = '#ffffff35'; ctx.lineWidth = 1.4; ctx.stroke();
      if (mark.complete && mark.naturalWidth) ctx.drawImage(mark, -72, -72, 144, 144);
      ctx.beginPath(); ctx.ellipse(-38, -69, 38, 12, -.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff48'; ctx.fill();
      ctx.restore();
    }

    function paint(now) {
      frame = 0;
      if (finish) progress = clamp((now - started) / 3600);
      const dpr = Math.min(devicePixelRatio, 2), width = Math.round(canvas.clientWidth * dpr), height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      ctx.resetTransform(); ctx.clearRect(0, 0, width, height);
      const scale = width / 600; ctx.setTransform(scale, 0, 0, scale, width / 2, height * .46);

      if (progress > 0) {
        const fan = ease(.36, .78, progress);
        ctx.save(); ctx.globalAlpha = ease(0, .12, progress) * (1 - ease(.96, 1, progress));
        const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.abs(b - (count - 1) / 2) - Math.abs(a - (count - 1) / 2));
        for (const i of order) {
          const slot = i - (count - 1) / 2;
          candy(slot * 88 * fan, -26 * fan + Math.abs(slot) * 14 * fan, candyColors[i % 5], slot * .10 * fan);
        }
        ctx.restore();
      }
      if (progress < .96 && currentType) currentType.render(progress);
      if (finish) {
        if (progress < 1) requestPaint();
        else { const done = finish; finish = null; done(); }
      }
    }

    function requestPaint() { if (!frame) frame = requestAnimationFrame(paint); }

    canvas.parentElement.addEventListener('pointermove', event => {
      if (reduced.matches || event.pointerType === 'touch' || finish) return;
      const r = canvas.getBoundingClientRect(); pointer = clamp((event.clientX - r.left) / r.width) * 2 - 1; requestPaint();
    });
    canvas.parentElement.addEventListener('pointerleave', () => { pointer = 0; requestPaint(); });
    new ResizeObserver(requestPaint).observe(canvas);
    reduced.addEventListener('change', () => { pointer = 0; if (reduced.matches && finish) started = performance.now() - 3600; requestPaint(); });

    recolor();

    return {
      play(amount = 5) {
        count = amount; pointer = 0;
        if (reduced.matches) return Promise.resolve();
        started = performance.now(); progress = 0;
        return new Promise(resolve => { finish = resolve; requestPaint(); });
      },
      reset(newColor = false, packTypeId) {
        finish = null; progress = 0; count = 5;
        if (newColor) recolor(packTypeId);
        else requestPaint();
      },
      setType(packTypeId) { recolor(packTypeId); },
      getType() { return currentType ? currentType.id : null; }
    };
  }

  createPackScene.types = ['plastic', 'foil'];
  globalThis.createPackScene = createPackScene;
})();
